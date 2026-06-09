import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

import { TelegramClient } from "telegram";
import { NewMessage } from "telegram/events/index.js";
import { StringSession } from "telegram/sessions/index.js";

import {
  loadUserbotConfig,
  normalizeId,
  resolveMonitoredChatType,
  shouldForwardUserChatType,
  shouldForwardUserMessage
} from "./userbot-config.mjs";
import {
  createRuntimeState,
  formatDailyReport,
  formatKeepaliveMessage,
  getNextDailyReportDelayMs,
  recordError,
  recordForwarded,
  recordSkipped,
  resetDailyMetrics,
  sendFeishuText
} from "./userbot-runtime.mjs";

let config;
let queue = Promise.resolve();
let stopping = false;
const state = createRuntimeState();
const USERBOT_CHAT_TYPE_LABELS = {
  private: "私聊",
  group: "群聊",
  channel: "频道",
  official: "官方通知",
  unknown: "未知类型"
};

try {
  config = loadUserbotConfig();
} catch (error) {
  config = loadFallbackConfig();
  state.lastError = formatError(error);
  console.error("User forwarder config error:", state.lastError);
}

const healthServer = startHealthServer(config, state);

process.on("SIGINT", () => {
  stopping = true;
  console.log("Received SIGINT, shutting down...");
});

process.on("SIGTERM", () => {
  stopping = true;
  console.log("Received SIGTERM, shutting down...");
});

while (!stopping) {
  if (!isRunnableConfig(config)) {
    await sleep(config.reconnectDelayMs);
    continue;
  }

  const client = new TelegramClient(
    new StringSession(config.session),
    config.apiId,
    config.apiHash,
    {
      connectionRetries: 5
    }
  );

  try {
    await client.connect();
    state.connected = true;
    const authorized = await client.checkAuthorization();
    state.authorized = authorized;
    if (!authorized) {
      throw new Error("Saved TELEGRAM_USER_SESSION is not authorized. Run `npm run user:login` again.");
    }

    const targetEntity = await client.getInputEntity(config.target);
    const targetPeerId = await client.getPeerId(config.target, true);
    state.targetPeerId = String(targetPeerId);
    state.lastError = "";
    console.log(`User forwarder is running. Target peer: ${targetPeerId}`);

    client.addEventHandler((event) => {
      queue = queue
        .then(() => handleNewMessage(client, event, targetEntity, targetPeerId, config))
        .catch((error) => {
          const reason = formatError(error);
          state.lastError = reason;
          recordError(state, "forward_queue_error");
          console.error("Forward queue error:", reason);
        });
    }, new NewMessage({ incoming: config.includeOutgoing ? undefined : true }));

    const stopSchedulers = startNotificationSchedulers(client, targetEntity, config, state);
    while (!stopping) {
      await sleep(1000);
    }
    stopSchedulers();
  } catch (error) {
    state.connected = false;
    state.authorized = false;
    state.lastError = formatError(error);
    recordError(state, error?.errorMessage || error?.code || "connection_error");
    console.error("User forwarder error:", state.lastError);
    if (!stopping) {
      console.log(`Reconnecting in ${config.reconnectDelayMs}ms...`);
      await sleep(config.reconnectDelayMs);
    }
  } finally {
    await client.disconnect().catch(() => undefined);
    state.connected = false;
  }
}

await new Promise((resolve) => healthServer.close(resolve));

async function handleNewMessage(client, event, targetEntity, targetPeerId, runtimeConfig) {
  const message = event.message;
  const sourcePeer = message.peerId || event.chatId || message.chatId;
  const sourcePeerId = sourcePeer ? await client.getPeerId(sourcePeer, true) : "";
  const chatType = resolveMonitoredChatType(event, sourcePeerId);
  const chatTypeDecision = shouldForwardUserChatType(chatType, runtimeConfig);

  if (!chatTypeDecision.ok) {
    recordSkipped(state, chatTypeDecision.reason);
    logDebug(`Skipped message ${message.id}: ${chatTypeDecision.reason}`);
    return;
  }

  const decision = shouldForwardUserMessage(message, sourcePeerId, targetPeerId, runtimeConfig);

  if (!decision.ok) {
    recordSkipped(state, decision.reason);
    logDebug(`Skipped message ${message.id}: ${decision.reason}`);
    return;
  }

  try {
    await client.forwardMessages(targetEntity, {
      messages: [message.id],
      fromPeer: sourcePeer,
      silent: runtimeConfig.silent,
      dropAuthor: runtimeConfig.dropAuthor,
      noforwards: runtimeConfig.noForwards
    });

    recordForwarded(state, chatType);
    console.log(`Forwarded message ${message.id} from ${normalizeId(sourcePeerId)} to ${targetPeerId}`);
    await sendFeishuForwardNotification(runtimeConfig, event, message, sourcePeerId, chatType);
  } catch (error) {
    state.lastError = formatError(error);
    recordError(state, error?.errorMessage || error?.code || "forward_error");
    console.error(`Failed to forward message ${message.id} from ${normalizeId(sourcePeerId)}:`, state.lastError);
  }
}

async function sendFeishuForwardNotification(runtimeConfig, event, message, sourcePeerId, chatType) {
  if (!runtimeConfig.feishuWebhookUrl) {
    return;
  }

  try {
    const result = await sendFeishuText(
      runtimeConfig.feishuWebhookUrl,
      formatUserbotFeishuNotification(event, message, sourcePeerId, chatType)
    );
    if (!result.ok) {
      state.lastError = result.description || result.error || "feishu_webhook_error";
      recordError(state, "feishu_webhook_error");
      console.error("Failed to send Feishu notification:", state.lastError);
    }
  } catch (error) {
    state.lastError = formatError(error);
    recordError(state, "feishu_webhook_error");
    console.error("Failed to send Feishu notification:", state.lastError);
  }
}

function formatUserbotFeishuNotification(event, message, sourcePeerId, chatType) {
  const lines = [
    "📬 消息转发成功",
    `🧩 来源类型：${formatUserbotChatTypeLabel(chatType)}`,
    `💬 来源会话：${formatUserbotChatLabel(event?.chat)}`,
    `🆔 来源会话编号：${normalizeId(sourcePeerId)}`,
    `🔢 消息编号：${message.id}`
  ];

  const preview = getUserbotMessagePreview(message);
  if (preview) {
    lines.push("", formatUserbotPreviewTitle(message), preview);
  }

  return lines.join("\n");
}

function formatUserbotChatTypeLabel(chatType) {
  return USERBOT_CHAT_TYPE_LABELS[chatType] || "未知类型";
}

function formatUserbotChatLabel(chat) {
  if (!chat) {
    return "未知来源";
  }

  return chat.title ||
    [chat.firstName, chat.lastName].filter(Boolean).join(" ") ||
    chat.username ||
    "未命名会话";
}

function getUserbotMessagePreview(message) {
  const text = message.message || message.text;
  if (text) {
    return truncateText(text, 1800);
  }

  if (message.media) {
    return formatUserbotMediaLabel(message.media.className);
  }

  return "";
}

function formatUserbotPreviewTitle(message) {
  return message.message || message.text ? "📝 消息内容" : "📎 消息摘要";
}

function formatUserbotMediaLabel(className) {
  const labels = {
    MessageMediaPhoto: "图片消息",
    MessageMediaDocument: "文件消息",
    MessageMediaGeo: "位置消息",
    MessageMediaContact: "联系人消息",
    MessageMediaPoll: "投票消息",
    MessageMediaWebPage: "网页预览消息",
    MessageMediaDice: "骰子消息",
    MessageMediaVenue: "地点消息",
    MessageMediaGame: "游戏消息"
  };

  return labels[className] || "媒体消息";
}

function truncateText(value, maxLength) {
  const normalized = String(value || "").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function startNotificationSchedulers(client, targetEntity, runtimeConfig, runtimeState) {
  const timers = [];

  if (runtimeConfig.keepaliveEnabled) {
    timers.push(setInterval(() => {
      sendServiceMessage(
        client,
        targetEntity,
        formatKeepaliveMessage(runtimeState, runtimeConfig),
        "keepalive"
      ).then((ok) => {
        if (ok) {
          runtimeState.lastKeepaliveAt = new Date().toISOString();
        }
      });
    }, runtimeConfig.keepaliveIntervalMinutes * 60 * 1000));
  }

  if (runtimeConfig.dailyReportEnabled) {
    scheduleNextDailyReport(client, targetEntity, runtimeConfig, runtimeState, timers);
  }

  return () => {
    for (const timer of timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
  };
}

function scheduleNextDailyReport(client, targetEntity, runtimeConfig, runtimeState, timers) {
  const delay = getNextDailyReportDelayMs(
    runtimeConfig.dailyReportTime,
    runtimeConfig.dailyReportTimezoneOffset
  );
  const timer = setTimeout(async () => {
    const ok = await sendServiceMessage(
      client,
      targetEntity,
      formatDailyReport(runtimeState, runtimeConfig),
      "daily_report"
    );
    if (ok) {
      runtimeState.lastDailyReportAt = new Date().toISOString();
      resetDailyMetrics(runtimeState);
    }
    scheduleNextDailyReport(client, targetEntity, runtimeConfig, runtimeState, timers);
  }, delay);

  timers.push(timer);
}

async function sendServiceMessage(client, targetEntity, message, reason) {
  try {
    await client.sendMessage(targetEntity, {
      message,
      silent: true,
      noforwards: true
    });
    console.log(`Sent ${reason} message`);
    return true;
  } catch (error) {
    state.lastError = formatError(error);
    recordError(state, `${reason}_send_error`);
    console.error(`Failed to send ${reason} message:`, state.lastError);
    return false;
  }
}

function startHealthServer(runtimeConfig, runtimeState) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    const body = {
      ok: runtimeState.connected && runtimeState.authorized,
      service: "telebridge",
      ...runtimeState
    };

    if (url.pathname === "/" || url.pathname === "/healthz") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(body));
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: false, error: "not_found" }));
  });

  server.listen(runtimeConfig.healthPort, runtimeConfig.healthHost, () => {
    console.log(`Health server listening on ${runtimeConfig.healthHost}:${runtimeConfig.healthPort}`);
  });

  return server;
}

function isRunnableConfig(runtimeConfig) {
  return Boolean(
    runtimeConfig.apiId &&
      runtimeConfig.apiHash &&
      runtimeConfig.session &&
      runtimeConfig.target
  );
}

function loadFallbackConfig() {
  return {
    apiId: 0,
    apiHash: "",
    session: "",
    target: "",
    monitoredChatTypes: ["private", "group", "channel", "official"],
    allowedSourceChats: [],
    blockedSourceChats: [],
    skipTargetChat: true,
    includeOutgoing: true,
    silent: false,
    dropAuthor: false,
    noForwards: false,
    keepaliveEnabled: false,
    keepaliveIntervalMinutes: 360,
    keepaliveMessage: "📡 转发器保活提醒",
    dailyReportEnabled: false,
    dailyReportTime: "23:55",
    dailyReportTimezoneOffset: "+08:00",
    feishuWebhookUrl: String(process.env.FEISHU_WEBHOOK_URL || "").trim(),
    reconnectDelayMs: 5000,
    healthHost: String(process.env.USERBOT_HEALTH_HOST || "0.0.0.0"),
    healthPort: Number.parseInt(String(process.env.PORT || process.env.USERBOT_HEALTH_PORT || "7860"), 10) || 7860,
    logLevel: "info"
  };
}

function logDebug(message) {
  if (config.logLevel === "debug") {
    console.log(message);
  }
}

function formatError(error) {
  if (!error) {
    return "unknown error";
  }

  if (error.stack) {
    return error.stack;
  }

  return String(error);
}
