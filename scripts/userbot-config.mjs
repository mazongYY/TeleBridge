export function loadUserbotConfig(env = process.env) {
  const config = {
    apiId: parseRequiredInteger(env.TELEGRAM_API_ID, "TELEGRAM_API_ID"),
    apiHash: requiredString(env.TELEGRAM_API_HASH, "TELEGRAM_API_HASH"),
    session: stringValue(env.TELEGRAM_USER_SESSION),
    target: requiredString(env.TELEGRAM_TARGET, "TELEGRAM_TARGET"),
    allowedSourceChats: parseList(env.USERBOT_ALLOWED_SOURCE_CHATS),
    blockedSourceChats: parseList(env.USERBOT_BLOCKED_SOURCE_CHATS),
    monitoredChatTypes: parseMonitoredChatTypes(env.USERBOT_MONITORED_CHAT_TYPES),
    skipTargetChat: parseBoolean(env.USERBOT_SKIP_TARGET_CHAT, true),
    includeOutgoing: parseBoolean(env.USERBOT_INCLUDE_OUTGOING, true),
    silent: parseBoolean(env.USERBOT_SILENT, false),
    dropAuthor: parseBoolean(env.USERBOT_DROP_AUTHOR, false),
    noForwards: parseBoolean(env.USERBOT_PROTECT_CONTENT, false),
    keepaliveEnabled: parseBoolean(env.USERBOT_KEEPALIVE_ENABLED, true),
    keepaliveIntervalMinutes: parseInteger(env.USERBOT_KEEPALIVE_INTERVAL_MINUTES, 360),
    keepaliveMessage: stringValue(env.USERBOT_KEEPALIVE_MESSAGE) || "Telegram 转发器保活",
    dailyReportEnabled: parseBoolean(env.USERBOT_DAILY_REPORT_ENABLED, true),
    dailyReportTime: stringValue(env.USERBOT_DAILY_REPORT_TIME) || "23:55",
    dailyReportTimezoneOffset: stringValue(env.USERBOT_DAILY_REPORT_TIMEZONE_OFFSET) || "+08:00",
    reconnectDelayMs: parseInteger(env.USERBOT_RECONNECT_DELAY_MS, 5000),
    healthHost: stringValue(env.USERBOT_HEALTH_HOST) || "0.0.0.0",
    healthPort: parseInteger(env.PORT || env.USERBOT_HEALTH_PORT, 7860),
    logLevel: stringValue(env.USERBOT_LOG_LEVEL) || "info"
  };

  if (config.reconnectDelayMs < 1000) {
    throw new Error("USERBOT_RECONNECT_DELAY_MS must be at least 1000");
  }

  if (config.keepaliveIntervalMinutes < 1) {
    throw new Error("USERBOT_KEEPALIVE_INTERVAL_MINUTES must be at least 1");
  }

  validateDailyReportTime(config.dailyReportTime);
  validateTimezoneOffset(config.dailyReportTimezoneOffset);

  if (config.healthPort < 0 || config.healthPort > 65535) {
    throw new Error("PORT or USERBOT_HEALTH_PORT must be between 0 and 65535");
  }

  return config;
}

export function validateLoginConfig(env = process.env) {
  return {
    apiId: parseRequiredInteger(env.TELEGRAM_API_ID, "TELEGRAM_API_ID"),
    apiHash: requiredString(env.TELEGRAM_API_HASH, "TELEGRAM_API_HASH"),
    existingSession: stringValue(env.TELEGRAM_USER_SESSION)
  };
}

export function shouldForwardUserMessage(message, sourcePeerId, targetPeerId, config) {
  if (!message?.id) {
    return { ok: false, reason: "missing_message_id" };
  }

  const source = normalizeId(sourcePeerId);
  if (!source) {
    return { ok: false, reason: "missing_source_peer" };
  }

  if (config.skipTargetChat && targetPeerId && source === normalizeId(targetPeerId)) {
    return { ok: false, reason: "target_chat_skipped" };
  }

  if (config.allowedSourceChats?.length > 0 && !matchesIdList(source, config.allowedSourceChats)) {
    return { ok: false, reason: "source_chat_not_allowed" };
  }

  if (config.blockedSourceChats?.length > 0 && matchesIdList(source, config.blockedSourceChats)) {
    return { ok: false, reason: "blocked_source_chat" };
  }

  if (!config.includeOutgoing && message.out) {
    return { ok: false, reason: "outgoing_message_skipped" };
  }

  return { ok: true };
}

export function shouldForwardUserChatType(chatType, config) {
  if (!chatType) {
    return { ok: false, reason: "unknown_chat_type" };
  }

  if (!config.monitoredChatTypes?.includes(chatType)) {
    return { ok: false, reason: `chat_type_${chatType}_not_monitored` };
  }

  return { ok: true };
}

export function resolveMonitoredChatType(event, sourcePeerId) {
  if (normalizeId(sourcePeerId) === "777000") {
    return "official";
  }

  if (event?.isGroup) {
    return "group";
  }

  if (event?.isChannel) {
    return "channel";
  }

  if (event?.isPrivate) {
    return "private";
  }

  return "unknown";
}

export function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseMonitoredChatTypes(value) {
  const types = parseList(value || "private,group,channel,official")
    .map((type) => type.toLowerCase())
    .map((type) => {
      if (type === "groups") return "group";
      if (type === "channels") return "channel";
      if (type === "privates" || type === "private_chat") return "private";
      if (type === "official_notification" || type === "telegram") return "official";
      return type;
    });
  const allowed = new Set(["private", "group", "channel", "official"]);
  const invalid = types.filter((type) => !allowed.has(type));

  if (invalid.length > 0) {
    throw new Error(`USERBOT_MONITORED_CHAT_TYPES contains invalid values: ${invalid.join(", ")}`);
  }

  return [...new Set(types)];
}

export function normalizeId(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function matchesIdList(value, list) {
  const normalizedValue = normalizeId(value);
  return list.map(normalizeId).includes(normalizedValue);
}

function parseRequiredInteger(value, name) {
  const parsed = Number.parseInt(requiredString(value, name), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseInteger(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  return ["1", "true", "yes", "y", "on"].includes(String(value).toLowerCase());
}

function validateDailyReportTime(value) {
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(String(value || ""))) {
    throw new Error("USERBOT_DAILY_REPORT_TIME must use HH:mm format");
  }
}

function validateTimezoneOffset(value) {
  const match = String(value || "").match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error("USERBOT_DAILY_REPORT_TIMEZONE_OFFSET must use +HH:mm or -HH:mm format");
  }

  const hours = Number.parseInt(match[2], 10);
  const minutes = Number.parseInt(match[3], 10);
  if (hours > 14 || minutes > 59) {
    throw new Error("USERBOT_DAILY_REPORT_TIMEZONE_OFFSET is out of range");
  }
}

function requiredString(value, name) {
  const normalized = stringValue(value);
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function stringValue(value) {
  return String(value || "").trim();
}
