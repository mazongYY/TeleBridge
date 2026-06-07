const DAY_MS = 24 * 60 * 60 * 1000;

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

export function formatKeepaliveMessage(state, config, now = new Date()) {
  const template = config.keepaliveMessage || "Telegram forwarder keepalive";
  return [
    template,
    `time: ${formatLocalDateTime(config.dailyReportTimezoneOffset, now)}`,
    `connected: ${state.connected}`,
    `authorized: ${state.authorized}`,
    `target: ${state.targetPeerId || "unresolved"}`,
    `forwarded_today: ${state.metrics.forwarded}`,
    `errors_today: ${state.metrics.errors}`
  ].join("\n");
}

export function formatDailyReport(state, config, now = new Date()) {
  const metrics = state.metrics;
  return [
    "Telegram 转发日报",
    `date: ${formatLocalDate(config.dailyReportTimezoneOffset, now)}`,
    `window_started_at: ${metrics.windowStartedAt}`,
    `target: ${state.targetPeerId || "unresolved"}`,
    `connected: ${state.connected}`,
    `authorized: ${state.authorized}`,
    "",
    `forwarded: ${metrics.forwarded}`,
    `private: ${metrics.byType.private || 0}`,
    `group: ${metrics.byType.group || 0}`,
    `channel: ${metrics.byType.channel || 0}`,
    `official: ${metrics.byType.official || 0}`,
    `unknown: ${metrics.byType.unknown || 0}`,
    "",
    `skipped: ${metrics.skipped}`,
    `errors: ${metrics.errors}`,
    `last_forwarded_at: ${state.lastForwardedAt || "none"}`,
    `last_error: ${state.lastError || "none"}`,
    "",
    `skip_reasons: ${formatReasonMap(metrics.skipReasons)}`,
    `error_reasons: ${formatReasonMap(metrics.errorReasons)}`
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

function formatReasonMap(map) {
  const entries = Object.entries(map);
  if (entries.length === 0) {
    return "none";
  }

  return entries.map(([reason, count]) => `${reason}=${count}`).join(", ");
}

function pad2(value) {
  return String(value).padStart(2, "0");
}
