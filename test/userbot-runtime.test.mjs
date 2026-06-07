import assert from "node:assert/strict";
import test from "node:test";

import {
  createRuntimeState,
  formatDailyReport,
  formatKeepaliveMessage,
  getNextDailyReportDelayMs,
  parseDailyReportTime,
  parseTimezoneOffset,
  recordError,
  recordForwarded,
  recordSkipped,
  resetDailyMetrics
} from "../scripts/userbot-runtime.mjs";

const config = {
  dailyReportTime: "23:55",
  dailyReportTimezoneOffset: "+08:00",
  keepaliveMessage: "保活测试"
};

test("records forwarded, skipped, and error metrics", () => {
  const state = createRuntimeState(new Date("2026-06-07T00:00:00.000Z"));

  recordForwarded(state, "group", new Date("2026-06-07T01:00:00.000Z"));
  recordSkipped(state, "target_chat_skipped");
  recordError(state, "forward_error");

  assert.equal(state.metrics.forwarded, 1);
  assert.equal(state.metrics.byType.group, 1);
  assert.equal(state.metrics.skipped, 1);
  assert.equal(state.metrics.skipReasons.target_chat_skipped, 1);
  assert.equal(state.metrics.errors, 1);
  assert.equal(state.metrics.errorReasons.forward_error, 1);
  assert.equal(state.lastForwardedAt, "2026-06-07T01:00:00.000Z");
});

test("formats keepalive and daily reports", () => {
  const state = createRuntimeState(new Date("2026-06-07T00:00:00.000Z"));
  state.connected = true;
  state.authorized = true;
  state.targetPeerId = "-1001";
  recordForwarded(state, "private", new Date("2026-06-07T01:00:00.000Z"));
  recordSkipped(state, "target_chat_skipped");
  recordError(state, "feishu_webhook_error");
  state.lastError = "飞书 Webhook 返回错误";

  const keepalive = formatKeepaliveMessage(state, config, new Date("2026-06-07T02:00:00.000Z"));
  assert.match(keepalive, /保活测试/);
  assert.match(keepalive, /forwarded_today: 1/);

  const report = formatDailyReport(state, config, new Date("2026-06-07T15:55:00.000Z"));
  assert.match(report, /📊 TeleBridge 转发日报/);
  assert.match(report, /✅ 运行状态/);
  assert.match(report, /📨 转发统计/);
  assert.match(report, /• 今日转发：1/);
  assert.match(report, /• 私聊：1/);
  assert.match(report, /⚠️ 异常摘要/);
  assert.match(report, /• 已跳过：1/);
  assert.match(report, /• 错误数：1/);
  assert.match(report, /🧭 跳过原因/);
  assert.match(report, /• 跳过目标会话：1/);
  assert.match(report, /🛠️ 错误原因/);
  assert.match(report, /• 飞书通知发送失败：1/);
});

test("calculates next daily report delay with timezone offset", () => {
  const before = getNextDailyReportDelayMs("23:55", "+08:00", new Date("2026-06-07T15:50:00.000Z"));
  assert.equal(before, 5 * 60 * 1000);

  const after = getNextDailyReportDelayMs("23:55", "+08:00", new Date("2026-06-07T16:00:00.000Z"));
  assert.equal(after, 23 * 60 * 60 * 1000 + 55 * 60 * 1000);
});

test("validates report time and timezone offset", () => {
  assert.deepEqual(parseDailyReportTime("09:30"), { hour: 9, minute: 30 });
  assert.equal(parseTimezoneOffset("+08:00"), 480);
  assert.equal(parseTimezoneOffset("-05:30"), -330);
  assert.throws(() => parseDailyReportTime("24:00"), /HH:mm/);
  assert.throws(() => parseTimezoneOffset("8"), /\+HH:mm or -HH:mm/);
});

test("resets daily metrics", () => {
  const state = createRuntimeState(new Date("2026-06-07T00:00:00.000Z"));
  recordForwarded(state, "channel");

  resetDailyMetrics(state, new Date("2026-06-08T00:00:00.000Z"));

  assert.equal(state.metrics.forwarded, 0);
  assert.equal(state.metrics.byType.channel, 0);
  assert.equal(state.metrics.windowStartedAt, "2026-06-08T00:00:00.000Z");
});
