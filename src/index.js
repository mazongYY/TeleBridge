const TELEGRAM_API_BASE = "https://api.telegram.org";
const DEFAULT_ALLOWED_UPDATES = ["message", "channel_post", "business_message"];

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8"
};

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  }
};

export async function handleRequest(request, env, ctx = {}) {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/") {
    return jsonResponse({
      ok: true,
      service: "telegram-cloudflare-forwarder",
      webhook: "/webhook",
      admin: ["/admin/set-webhook", "/admin/delete-webhook", "/admin/webhook-info", "/admin/get-me"]
    });
  }

  if (url.pathname.startsWith("/admin/")) {
    return handleAdminRequest(request, env, url);
  }

  if (url.pathname !== "/webhook") {
    return jsonResponse({ ok: false, error: "not_found" }, 404);
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  const secretError = validateWebhookSecret(request, env);
  if (secretError) {
    return secretError;
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400);
  }

  const forwardPromise = forwardUpdate(update, env);
  if (ctx.waitUntil) {
    ctx.waitUntil(forwardPromise);
    return jsonResponse({ ok: true, queued: true });
  }

  const result = await forwardPromise;
  return jsonResponse(result, result.ok ? 200 : 200);
}

export async function forwardUpdate(update, env, fetcher = fetch) {
  const configError = validateRuntimeConfig(env);
  if (configError) {
    return { ok: false, error: configError };
  }

  const messageInfo = extractMessage(update, env);
  if (!messageInfo) {
    return { ok: true, skipped: true, reason: "unsupported_update" };
  }

  const { message, updateType } = messageInfo;
  const filterDecision = shouldForwardMessage(message, env);
  if (!filterDecision.ok) {
    return {
      ok: true,
      skipped: true,
      reason: filterDecision.reason,
      update_type: updateType,
      source_chat_id: normalizeChatId(message.chat?.id)
    };
  }

  const primaryMethod = getForwardMode(env) === "forward" ? "forwardMessage" : "copyMessage";
  const primaryResult = await sendTelegramForward(primaryMethod, message, env, fetcher);

  if (primaryResult.ok || primaryMethod === "forwardMessage" || !truthy(env.FALLBACK_TO_FORWARD)) {
    const result = {
      ...primaryResult,
      update_type: updateType,
      source_chat_id: normalizeChatId(message.chat?.id),
      message_id: message.message_id,
      method: primaryMethod
    };
    return attachFeishuNotification(result, message, updateType, env, fetcher);
  }

  const fallbackResult = await sendTelegramForward("forwardMessage", message, env, fetcher);
  const result = {
    ...fallbackResult,
    update_type: updateType,
    source_chat_id: normalizeChatId(message.chat?.id),
    message_id: message.message_id,
    method: "forwardMessage",
    fallback_from: "copyMessage",
    primary_error: primaryResult.description || primaryResult.error
  };
  return attachFeishuNotification(result, message, updateType, env, fetcher);
}

export function extractMessage(update, env) {
  const candidates = [
    ["message", update?.message],
    ["channel_post", update?.channel_post],
    ["business_message", update?.business_message]
  ];

  if (truthy(env.FORWARD_EDITED_MESSAGES)) {
    candidates.push(
      ["edited_message", update?.edited_message],
      ["edited_channel_post", update?.edited_channel_post],
      ["edited_business_message", update?.edited_business_message]
    );
  }

  const found = candidates.find(([, message]) => message?.chat?.id && message?.message_id);
  if (!found) {
    return null;
  }

  return { updateType: found[0], message: found[1] };
}

export function shouldForwardMessage(message, env) {
  const chatId = normalizeChatId(message.chat?.id);
  if (!chatId) {
    return { ok: false, reason: "missing_chat_id" };
  }

  if (truthy(env.IGNORE_BOT_MESSAGES) && message.from?.is_bot) {
    return { ok: false, reason: "bot_message_ignored" };
  }

  const blocked = parseIdList(env.BLOCKED_SOURCE_CHAT_IDS);
  if (blocked.has(chatId)) {
    return { ok: false, reason: "blocked_source_chat" };
  }

  const allowed = parseIdList(env.ALLOWED_SOURCE_CHAT_IDS);
  if (allowed.size > 0 && !allowed.has(chatId)) {
    return { ok: false, reason: "source_chat_not_allowed" };
  }

  return { ok: true };
}

export async function sendTelegramForward(method, message, env, fetcher = fetch) {
  const payload = {
    chat_id: env.TARGET_CHAT_ID,
    from_chat_id: message.chat.id,
    message_id: message.message_id
  };

  const topicId = normalizeOptionalInteger(env.TARGET_MESSAGE_THREAD_ID);
  if (topicId !== undefined) {
    payload.message_thread_id = topicId;
  }

  if (truthy(env.DISABLE_NOTIFICATION)) {
    payload.disable_notification = true;
  }

  if (truthy(env.PROTECT_CONTENT)) {
    payload.protect_content = true;
  }

  const response = await fetcher(telegramUrl(env, method), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });

  let body;
  try {
    body = await response.json();
  } catch {
    body = { ok: false, description: "Telegram returned a non-JSON response" };
  }

  if (!response.ok || !body.ok) {
    return {
      ok: false,
      error: "telegram_api_error",
      status: response.status,
      description: body.description || response.statusText
    };
  }

  return { ok: true, result: body.result };
}

export async function sendFeishuText(webhookUrl, text, fetcher = fetch) {
  const normalizedUrl = String(webhookUrl || "").trim();
  if (!normalizedUrl) {
    return {
      ok: true,
      skipped: true,
      reason: "missing_FEISHU_WEBHOOK_URL"
    };
  }

  const response = await fetcher(normalizedUrl, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      msg_type: "text",
      content: {
        text
      }
    })
  });

  let body;
  try {
    body = await response.json();
  } catch {
    body = { msg: "Feishu returned a non-JSON response" };
  }

  const responseCode = body.code ?? body.StatusCode;
  if (!response.ok || responseCode !== 0) {
    return {
      ok: false,
      error: "feishu_webhook_error",
      status: response.status,
      description: body.msg || body.StatusMessage || response.statusText
    };
  }

  return { ok: true };
}

export function formatFeishuNotification(updateType, message) {
  const lines = [
    "📬 消息转发成功",
    `🧩 消息类型：${formatUpdateTypeLabel(updateType)}`,
    `💬 来源会话：${formatChatLabel(message.chat)}`,
    `👤 发送者：${formatSenderLabel(message)}`,
    `🔢 消息编号：${message.message_id}`
  ];

  const preview = getMessagePreview(message);
  if (preview) {
    lines.push("", formatMessagePreviewTitle(message), preview);
  }

  return lines.join("\n");
}

async function attachFeishuNotification(result, message, updateType, env, fetcher) {
  if (!result.ok || !env.FEISHU_WEBHOOK_URL) {
    return result;
  }

  let feishu;
  try {
    feishu = await sendFeishuText(
      env.FEISHU_WEBHOOK_URL,
      formatFeishuNotification(updateType, message),
      fetcher
    );
  } catch (error) {
    feishu = {
      ok: false,
      error: "feishu_webhook_error",
      description: formatError(error)
    };
  }

  return {
    ...result,
    feishu
  };
}

async function handleAdminRequest(request, env, url) {
  const authError = validateAdminAuth(request, env);
  if (authError) {
    return authError;
  }

  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  if (!env.TELEGRAM_BOT_TOKEN) {
    return jsonResponse({ ok: false, error: "missing_TELEGRAM_BOT_TOKEN" }, 500);
  }

  if (url.pathname === "/admin/get-me") {
    return proxyTelegramMethod(env, "getMe", {});
  }

  if (url.pathname === "/admin/webhook-info") {
    return proxyTelegramMethod(env, "getWebhookInfo", {});
  }

  if (url.pathname === "/admin/delete-webhook") {
    const dropPending = url.searchParams.get("drop_pending_updates") === "true";
    return proxyTelegramMethod(env, "deleteWebhook", { drop_pending_updates: dropPending });
  }

  if (url.pathname === "/admin/set-webhook") {
    const webhookUrl = resolveWebhookUrl(request, env, url);
    if (!webhookUrl) {
      return jsonResponse({ ok: false, error: "missing_webhook_url" }, 400);
    }

    const allowedUpdates = parseAllowedUpdates(env);
    const payload = {
      url: webhookUrl,
      allowed_updates: allowedUpdates,
      drop_pending_updates: url.searchParams.get("drop_pending_updates") === "true"
    };

    if (env.WEBHOOK_SECRET) {
      payload.secret_token = env.WEBHOOK_SECRET;
    }

    return proxyTelegramMethod(env, "setWebhook", payload);
  }

  return jsonResponse({ ok: false, error: "not_found" }, 404);
}

async function proxyTelegramMethod(env, method, payload) {
  const response = await fetch(telegramUrl(env, method), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({ ok: false, description: "non_json_response" }));
  return jsonResponse(body, response.ok ? 200 : response.status);
}

function resolveWebhookUrl(request, env, url) {
  const explicitUrl = url.searchParams.get("url") || env.PUBLIC_WEBHOOK_URL;
  if (explicitUrl) {
    return explicitUrl;
  }

  const requestUrl = new URL(request.url);
  return `${requestUrl.origin}/webhook`;
}

function validateRuntimeConfig(env) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return "missing_TELEGRAM_BOT_TOKEN";
  }
  if (!env.TARGET_CHAT_ID) {
    return "missing_TARGET_CHAT_ID";
  }
  return null;
}

function validateWebhookSecret(request, env) {
  if (!env.WEBHOOK_SECRET) {
    return null;
  }

  const received = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (received !== env.WEBHOOK_SECRET) {
    return jsonResponse({ ok: false, error: "invalid_webhook_secret" }, 401);
  }

  return null;
}

function validateAdminAuth(request, env) {
  if (!env.ADMIN_TOKEN) {
    return jsonResponse({ ok: false, error: "missing_ADMIN_TOKEN" }, 500);
  }

  const expected = `Bearer ${env.ADMIN_TOKEN}`;
  if (request.headers.get("Authorization") !== expected) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  return null;
}

function parseAllowedUpdates(env) {
  const configured = splitCsv(env.ALLOWED_UPDATES);
  if (configured.length > 0) {
    return configured;
  }

  if (truthy(env.FORWARD_EDITED_MESSAGES)) {
    return [
      ...DEFAULT_ALLOWED_UPDATES,
      "edited_message",
      "edited_channel_post",
      "edited_business_message"
    ];
  }

  return DEFAULT_ALLOWED_UPDATES;
}

function getForwardMode(env) {
  return String(env.FORWARD_MODE || "copy").toLowerCase() === "forward" ? "forward" : "copy";
}

function parseIdList(value) {
  return new Set(splitCsv(value).map(normalizeChatId).filter(Boolean));
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeChatId(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function normalizeOptionalInteger(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return undefined;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function formatChatLabel(chat) {
  if (!chat) {
    return "未知来源";
  }

  const name = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.username || "未命名会话";
  const id = normalizeChatId(chat.id);
  return id ? `${name} (${id})` : name;
}

function formatSenderLabel(message) {
  const sender = message.from || message.sender_chat;
  if (!sender) {
    return "未知发送者";
  }

  const name = sender.title || [sender.first_name, sender.last_name].filter(Boolean).join(" ") || sender.username || "未命名发送者";
  const id = normalizeChatId(sender.id);
  return id ? `${name} (${id})` : name;
}

function formatUpdateTypeLabel(updateType) {
  const labels = {
    message: "普通消息",
    channel_post: "频道消息",
    business_message: "商务消息",
    edited_message: "编辑后的普通消息",
    edited_channel_post: "编辑后的频道消息",
    edited_business_message: "编辑后的商务消息"
  };

  return labels[updateType] || "未知消息类型";
}

function formatMessagePreviewTitle(message) {
  return message.text || message.caption ? "📝 消息内容" : "📎 消息摘要";
}

function getMessagePreview(message) {
  const text = message.text || message.caption;
  if (text) {
    return truncateText(text, 1800);
  }

  if (message.photo) return "图片消息";
  if (message.video) return "视频消息";
  if (message.document) return "文件消息";
  if (message.audio) return "音频消息";
  if (message.voice) return "语音消息";
  if (message.video_note) return "视频便签";
  if (message.sticker) return "贴纸消息";
  if (message.animation) return "动画消息";
  if (message.contact) return "联系人消息";
  if (message.location) return "位置消息";
  if (message.poll) return "投票消息";
  return "";
}

function truncateText(value, maxLength) {
  const normalized = String(value || "").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function formatError(error) {
  if (!error) {
    return "unknown error";
  }

  return error.message || String(error);
}

function truthy(value) {
  return ["1", "true", "yes", "y", "on"].includes(String(value || "").toLowerCase());
}

function telegramUrl(env, method) {
  return `${TELEGRAM_API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}
