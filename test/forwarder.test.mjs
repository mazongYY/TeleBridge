import assert from "node:assert/strict";
import test from "node:test";

import {
  extractMessage,
  forwardUpdate,
  handleRequest,
  shouldForwardMessage
} from "../src/index.js";

const baseEnv = {
  TELEGRAM_BOT_TOKEN: "123:test-token",
  TARGET_CHAT_ID: "-100123",
  WEBHOOK_SECRET: "secret",
  ADMIN_TOKEN: "admin",
  FORWARD_MODE: "copy",
  IGNORE_BOT_MESSAGES: "true"
};

test("forwards normal messages with copyMessage", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return jsonTelegramResponse({ ok: true, result: { message_id: 999 } });
  };

  const result = await forwardUpdate(
    {
      update_id: 1,
      message: {
        message_id: 10,
        chat: { id: 12345 },
        from: { is_bot: false }
      }
    },
    baseEnv,
    fetcher
  );

  assert.equal(result.ok, true);
  assert.equal(result.method, "copyMessage");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.telegram.org/bot123:test-token/copyMessage");
  assert.deepEqual(calls[0].body, {
    chat_id: "-100123",
    from_chat_id: 12345,
    message_id: 10
  });
});

test("honors allowed source chat filter", async () => {
  const env = {
    ...baseEnv,
    ALLOWED_SOURCE_CHAT_IDS: "777,888"
  };

  const result = await forwardUpdate(
    {
      message: {
        message_id: 10,
        chat: { id: 12345 },
        from: { is_bot: false }
      }
    },
    env,
    async () => {
      throw new Error("fetch should not be called");
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "source_chat_not_allowed");
});

test("supports business_message updates", () => {
  const extracted = extractMessage(
    {
      business_message: {
        message_id: 22,
        chat: { id: 9988 }
      }
    },
    baseEnv
  );

  assert.equal(extracted.updateType, "business_message");
  assert.equal(extracted.message.message_id, 22);
});

test("rejects webhook calls with invalid secret token", async () => {
  const request = new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": "wrong"
    },
    body: JSON.stringify({ update_id: 1 })
  });

  const response = await handleRequest(request, baseEnv);
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error, "invalid_webhook_secret");
});

test("blocks bot-originated messages by default", () => {
  const decision = shouldForwardMessage(
    {
      chat: { id: 1 },
      from: { is_bot: true }
    },
    baseEnv
  );

  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "bot_message_ignored");
});

test("falls back to forwardMessage when copyMessage fails and fallback is enabled", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (url.endsWith("/copyMessage")) {
      return jsonTelegramResponse({ ok: false, description: "message can't be copied" }, 400);
    }
    return jsonTelegramResponse({ ok: true, result: { message_id: 1234 } });
  };

  const result = await forwardUpdate(
    {
      message: {
        message_id: 44,
        chat: { id: -900 },
        from: { is_bot: false }
      }
    },
    { ...baseEnv, FALLBACK_TO_FORWARD: "true" },
    fetcher
  );

  assert.equal(result.ok, true);
  assert.equal(result.method, "forwardMessage");
  assert.equal(result.fallback_from, "copyMessage");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.telegram.org/bot123:test-token/copyMessage");
  assert.equal(calls[1].url, "https://api.telegram.org/bot123:test-token/forwardMessage");
});

test("admin endpoints require bearer authorization", async () => {
  const response = await handleRequest(
    new Request("https://example.com/admin/webhook-info"),
    baseEnv
  );
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error, "unauthorized");
});

function jsonTelegramResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
