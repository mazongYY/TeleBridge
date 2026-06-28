const DAY_MS = 24 * 60 * 60 * 1000;
const CHAT_TYPE_LABELS = {
  private: "私聊",
  group: "群聊",
  channel: "频道",
  official: "官方通知",
  unknown: "未知类型"
};

const SKIP_REASON_LABELS = {
  target_chat_skipped: "跳过目标会话",
  source_chat_not_allowed: "来源不在白名单",
  blocked_source_chat: "来源在黑名单",
  outgoing_message_skipped: "跳过自己发出的消息",
  muted_chat: "来源会话已静音",
  restricted_forward_skipped: "受限来源禁止转发",
  restricted_forward_media_skipped: "受限媒体无可复制文本",
  missing_message_id: "缺少消息 ID",
  missing_source_peer: "缺少来源会话",
  unknown_chat_type: "未知会话类型"
};

const ERROR_REASON_LABELS = {
  connection_error: "连接错误",
  forward_error: "转发失败",
  forward_queue_error: "转发队列错误",
  CHAT_FORWARDS_RESTRICTED: "来源禁止转发",
  restricted_forward_fallback_error: "受限消息复制失败",
  keepalive_send_error: "保活消息发送失败",
  daily_report_send_error: "日报发送失败",
  feishu_webhook_error: "飞书通知发送失败"
};

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8"
};

export function createRuntimeState(now = new Date()) {
  return {
    startedAt: now.toISOString(),
    connected: false,
    authorized: false,
    targetPeerId: "",
    lastForwardedAt: "",
    lastKeepaliveAt: "",
    lastDailyReportAt: "",
    lastError: "",
    metrics: createDailyMetrics(now)
  };
}

export function createDailyMetrics(now = new Date()) {
  return {
    windowStartedAt: now.toISOString(),
    forwarded: 0,
    skipped: 0,
    errors: 0,
    byType: {
      private: 0,
      group: 0,
      channel: 0,
      official: 0,
      unknown: 0
    },
    skipReasons: {},
    errorReasons: {}
  };
}

export function recordForwarded(state, chatType, now = new Date()) {
  state.metrics.forwarded += 1;
  state.metrics.byType[chatType] = (state.metrics.byType[chatType] || 0) + 1;
  state.lastForwardedAt = now.toISOString();
}

export function recordSkipped(state, reason) {
  state.metrics.skipped += 1;
  state.metrics.skipReasons[reason] = (state.metrics.skipReasons[reason] || 0) + 1;
}

export function recordError(state, reason) {
  state.metrics.errors += 1;
  state.metrics.errorReasons[reason] = (state.metrics.errorReasons[reason] || 0) + 1;
}

export function resetDailyMetrics(state, now = new Date()) {
  state.metrics = createDailyMetrics(now);
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

export function formatKeepaliveMessage(state, config, now = new Date()) {
  const template = config.keepaliveMessage || "📡 转发器保活提醒";
  const timezoneOffset = config.dailyReportTimezoneOffset;
  return [
    formatKeepaliveTitle(template),
    `🕒 当前时间：${formatLocalDateTime(timezoneOffset, now)}`,
    "",
    "✅ 运行状态",
    `• 连接状态：${formatBooleanStatus(state.connected)}`,
    `• 授权状态：${formatBooleanStatus(state.authorized)}`,
    `• 目标会话：${state.targetPeerId || "未解析"}`,
    "",
    "📨 今日统计",
    `• 已转发：${state.metrics.forwarded}`,
    `• 错误数：${state.metrics.errors}`,
    `• 最近转发：${formatTimestamp(state.lastForwardedAt, timezoneOffset)}`,
    `• 最近错误：${formatLastErrorForNotification(state.lastError)}`,
    "",
    "🛠️ 错误原因",
    formatReasonMap(state.metrics.errorReasons, ERROR_REASON_LABELS)
  ].join("\n");
}

export function formatDailyReport(state, config, now = new Date()) {
  const metrics = state.metrics;
  const timezoneOffset = config.dailyReportTimezoneOffset;
  return [
    "📊 转发日报",
    `📅 日期：${formatLocalDate(timezoneOffset, now)}`,
    `🕒 统计开始：${formatTimestamp(metrics.windowStartedAt, timezoneOffset)}`,
    "",
    "✅ 运行状态",
    `• 目标会话：${state.targetPeerId || "未解析"}`,
    `• 连接状态：${formatBooleanStatus(state.connected)}`,
    `• 授权状态：${formatBooleanStatus(state.authorized)}`,
    "",
    "📨 转发统计",
    `• 今日转发：${metrics.forwarded}`,
    `• ${CHAT_TYPE_LABELS.private}：${metrics.byType.private || 0}`,
    `• ${CHAT_TYPE_LABELS.group}：${metrics.byType.group || 0}`,
    `• ${CHAT_TYPE_LABELS.channel}：${metrics.byType.channel || 0}`,
    `• ${CHAT_TYPE_LABELS.official}：${metrics.byType.official || 0}`,
    `• ${CHAT_TYPE_LABELS.unknown}：${metrics.byType.unknown || 0}`,
    "",
    "⚠️ 异常摘要",
    `• 已跳过：${metrics.skipped}`,
    `• 错误数：${metrics.errors}`,
    `• 最近转发：${formatTimestamp(state.lastForwardedAt, timezoneOffset)}`,
    `• 最近错误：${formatLastErrorForNotification(state.lastError)}`,
    "",
    "🧭 跳过原因",
    formatReasonMap(metrics.skipReasons, SKIP_REASON_LABELS),
    "",
    "🛠️ 错误原因",
    formatReasonMap(metrics.errorReasons, ERROR_REASON_LABELS)
  ].join("\n");
}

export function getNextDailyReportDelayMs(reportTime, timezoneOffset, now = new Date()) {
  const { hour, minute } = parseDailyReportTime(reportTime);
  const offsetMinutes = parseTimezoneOffset(timezoneOffset);
  const localNow = new Date(now.getTime() + offsetMinutes * 60 * 1000);
  let candidateLocalMs = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate(),
    hour,
    minute,
    0,
    0
  );
  let candidateUtcMs = candidateLocalMs - offsetMinutes * 60 * 1000;

  if (candidateUtcMs <= now.getTime()) {
    candidateUtcMs += DAY_MS;
  }

  return candidateUtcMs - now.getTime();
}

export function parseDailyReportTime(value) {
  const match = String(value || "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    throw new Error("USERBOT_DAILY_REPORT_TIME must use HH:mm format");
  }

  return {
    hour: Number.parseInt(match[1], 10),
    minute: Number.parseInt(match[2], 10)
  };
}

export function parseTimezoneOffset(value) {
  const match = String(value || "").match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error("USERBOT_DAILY_REPORT_TIMEZONE_OFFSET must use +HH:mm or -HH:mm format");
  }

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number.parseInt(match[2], 10);
  const minutes = Number.parseInt(match[3], 10);

  if (hours > 14 || minutes > 59) {
    throw new Error("USERBOT_DAILY_REPORT_TIMEZONE_OFFSET is out of range");
  }

  return sign * (hours * 60 + minutes);
}

export function formatLocalDate(timezoneOffset, now = new Date()) {
  const offsetMinutes = parseTimezoneOffset(timezoneOffset);
  const local = new Date(now.getTime() + offsetMinutes * 60 * 1000);
  return [
    local.getUTCFullYear(),
    pad2(local.getUTCMonth() + 1),
    pad2(local.getUTCDate())
  ].join("-");
}

export function formatLocalDateTime(timezoneOffset, now = new Date()) {
  const offsetMinutes = parseTimezoneOffset(timezoneOffset);
  const local = new Date(now.getTime() + offsetMinutes * 60 * 1000);
  return `${formatLocalDate(timezoneOffset, now)} ${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}:${pad2(local.getUTCSeconds())} ${timezoneOffset}`;
}

function formatTimestamp(value, timezoneOffset) {
  if (!value) {
    return "无";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return formatLocalDateTime(timezoneOffset, date);
}

function formatBooleanStatus(value) {
  return value ? "正常" : "异常";
}

function formatReasonMap(map, labels) {
  const entries = Object.entries(map);
  if (entries.length === 0) {
    return "• 无";
  }

  return entries.map(([reason, count]) => `• ${formatReasonLabel(reason, labels)}：${count}`).join("\n");
}

function formatReasonLabel(reason, labels) {
  if (labels[reason]) {
    return labels[reason];
  }

  const chatTypeMatch = String(reason).match(/^chat_type_(.+)_not_monitored$/);
  if (chatTypeMatch) {
    const chatType = CHAT_TYPE_LABELS[chatTypeMatch[1]] || "未知类型";
    return `未监听${chatType}`;
  }

  return "未分类原因";
}

function formatLastErrorForNotification(value) {
  return value ? "有错误，请查看运行日志" : "无";
}

function formatKeepaliveTitle(value) {
  const title = String(value || "").trim() || "转发器保活提醒";
  return title.startsWith("📡") ? title : `📡 ${title}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}
