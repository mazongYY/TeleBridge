import assert from "node:assert/strict";
import test from "node:test";

import {
  loadUserbotConfig,
  parseList,
  parseMonitoredChatTypes,
  resolveMonitoredChatType,
  shouldForwardUserChatType,
  shouldForwardUserMessage,
  validateLoginConfig
} from "../scripts/userbot-config.mjs";

test("loads required userbot config from env", () => {
  const config = loadUserbotConfig({
    TELEGRAM_API_ID: "12345",
    TELEGRAM_API_HASH: "hash",
    TELEGRAM_USER_SESSION: "session",
    TELEGRAM_TARGET: "-100777",
    USERBOT_ALLOWED_SOURCE_CHATS: "1, 2",
    USERBOT_SKIP_TARGET_CHAT: "false",
    FEISHU_WEBHOOK_URL: "https://open.feishu.cn/open-apis/bot/v2/hook/test-token"
  });

  assert.equal(config.apiId, 12345);
  assert.equal(config.apiHash, "hash");
  assert.equal(config.session, "session");
  assert.equal(config.target, "-100777");
  assert.deepEqual(config.allowedSourceChats, ["1", "2"]);
  assert.deepEqual(config.monitoredChatTypes, ["channel", "official"]);
  assert.equal(config.skipTargetChat, false);
  assert.equal(config.feishuWebhookUrl, "https://open.feishu.cn/open-apis/bot/v2/hook/test-token");
  assert.equal(config.healthHost, "0.0.0.0");
  assert.equal(config.healthPort, 7860);
});

test("loads configured monitored chat types", () => {
  const config = loadUserbotConfig({
    TELEGRAM_API_ID: "12345",
    TELEGRAM_API_HASH: "hash",
    TELEGRAM_USER_SESSION: "session",
    TELEGRAM_TARGET: "-100777",
    USERBOT_MONITORED_CHAT_TYPES: "group, channel"
  });

  assert.deepEqual(config.monitoredChatTypes, ["group", "channel"]);
});

test("rejects invalid monitored chat types", () => {
  assert.throws(
    () => parseMonitoredChatTypes("private,secret"),
    /USERBOT_MONITORED_CHAT_TYPES contains invalid values: secret/
  );
});

test("resolves monitored chat type from event flags", () => {
  assert.equal(resolveMonitoredChatType({ isPrivate: true }, "777000"), "official");
  assert.equal(resolveMonitoredChatType({ isPrivate: true }, "123"), "private");
  assert.equal(resolveMonitoredChatType({ isGroup: true }, "-123"), "group");
  assert.equal(resolveMonitoredChatType({ isChannel: true }, "-100123"), "channel");
  assert.equal(resolveMonitoredChatType({}, "42"), "unknown");
});

test("filters by monitored chat type", () => {
  const config = {
    monitoredChatTypes: ["group", "channel"]
  };

  assert.equal(shouldForwardUserChatType("group", config).ok, true);
  assert.equal(shouldForwardUserChatType("private", config).ok, false);
  assert.equal(shouldForwardUserChatType("private", config).reason, "chat_type_private_not_monitored");
});

test("uses PORT for health checks when provided", () => {
  const config = loadUserbotConfig({
    TELEGRAM_API_ID: "12345",
    TELEGRAM_API_HASH: "hash",
    TELEGRAM_USER_SESSION: "session",
    TELEGRAM_TARGET: "-100777",
    PORT: "9000"
  });

  assert.equal(config.healthPort, 9000);
});

test("validates login config without requiring a session", () => {
  const config = validateLoginConfig({
    TELEGRAM_API_ID: "12345",
    TELEGRAM_API_HASH: "hash"
  });

  assert.equal(config.apiId, 12345);
  assert.equal(config.apiHash, "hash");
  assert.equal(config.existingSession, "");
});

test("skips target chat by default to avoid forwarding loops", () => {
  const decision = shouldForwardUserMessage(
    { id: 99 },
    "-100777",
    "-100777",
    {
      skipTargetChat: true,
      includeOutgoing: true,
      allowedSourceChats: [],
      blockedSourceChats: []
    }
  );

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "target_chat_skipped");
});

test("applies allowlist, blocklist, and outgoing filters", () => {
  assert.equal(
    shouldForwardUserMessage(
      { id: 1 },
      "10",
      "99",
      {
        skipTargetChat: true,
        includeOutgoing: true,
        allowedSourceChats: ["20"],
        blockedSourceChats: []
      }
    ).reason,
    "source_chat_not_allowed"
  );

  assert.equal(
    shouldForwardUserMessage(
      { id: 1 },
      "10",
      "99",
      {
        skipTargetChat: true,
        includeOutgoing: true,
        allowedSourceChats: [],
        blockedSourceChats: ["10"]
      }
    ).reason,
    "blocked_source_chat"
  );

  assert.equal(
    shouldForwardUserMessage(
      { id: 1, out: true },
      "10",
      "99",
      {
        skipTargetChat: true,
        includeOutgoing: false,
        allowedSourceChats: [],
        blockedSourceChats: []
      }
    ).reason,
    "outgoing_message_skipped"
  );
});

test("parseList trims empty values", () => {
  assert.deepEqual(parseList(" 1, ,2,, 3 "), ["1", "2", "3"]);
});
