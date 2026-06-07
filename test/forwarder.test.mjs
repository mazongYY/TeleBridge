import assert from "node:assert/strict";
import test from "node:test";

import {
  extractMessage,
  formatFeishuNotification,
  forwardUpdate,
  handleRequest,
  sendFeishuText,
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

test("sends Feishu notification after successful forwarding", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (String(url).includes("open.feishu.cn")) {
      return jsonTelegramResponse({ code: 0, msg: "success" });
    }
    return jsonTelegramResponse({ ok: true, result: { message_id: 999 } });
  };

  const result = await forwardUpdate(
    {
      update_id: 1,
      message: {
        message_id: 10,
        text: "hello",
        chat: { id: 12345, title: "Source Group" },
        from: { is_bot: false, first_name: "Alice" }
      }
    },
    {
      ...baseEnv,
      FEISHU_WEBHOOK_URL: "https://open.feishu.cn/open-apis/bot/v2/hook/test-token"
    },
    fetcher
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.feishu, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://open.feishu.cn/open-apis/bot/v2/hook/test-token");
  assert.deepEqual(calls[1].body, {
    msg_type: "text",
    content: {
      text: [
        "📬 消息转发成功",
        "🧩 消息类型：普通消息",
        "💬 来源会话：Source Group (12345)",
        "👤 发送者：Alice",
        "🔢 消息编号：10",
        "",
        "📝 消息内容",
        "hello"
      ].join("\n")
    }
  });
});

test("formats Feishu media notification with Chinese labels", () => {
  const notification = formatFeishuNotification("channel_post", {
    message_id: 20,
    photo: [{ file_id: "photo" }],
    chat: { id: -100888, title: "频道" },
    sender_chat: { id: -100888, title: "频道" }
  });

  assert.equal(
    notification,
    [
      "📬 消息转发成功",
      "🧩 消息类型：频道消息",
      "💬 来源会话：频道 (-100888)",
      "👤 发送者：频道 (-100888)",
      "🔢 消息编号：20",
      "",
      "📎 消息摘要",
      "图片消息"
    ].join("\n")
  );
});

test("reports Feishu webhook API errors without failing forwarding", async () => {
  const fetcher = async (url) => {
    if (String(url).includes("open.feishu.cn")) {
      return jsonTelegramResponse({ code: 19001, msg: "invalid webhook" });
    }
    return jsonTelegramResponse({ ok: true, result: { message_id: 999 } });
  };

  const result = await forwardUpdate(
    {
      message: {
        message_id: 11,
        chat: { id: 12345 },
        from: { is_bot: false }
      }
    },
    {
      ...baseEnv,
      FEISHU_WEBHOOK_URL: "https://open.feishu.cn/open-apis/bot/v2/hook/test-token"
    },
    fetcher
  );

  assert.equal(result.ok, true);
  assert.equal(result.feishu.ok, false);
  assert.equal(result.feishu.error, "feishu_webhook_error");
  assert.equal(result.feishu.status, 200);
  assert.equal(result.feishu.description, "invalid webhook");
});

test("reports Feishu network errors without failing forwarding", async () => {
  const fetcher = async (url) => {
    if (String(url).includes("open.feishu.cn")) {
      throw new Error("network down");
    }
    return jsonTelegramResponse({ ok: true, result: { message_id: 999 } });
  };

  const result = await forwardUpdate(
    {
      message: {
        message_id: 12,
        chat: { id: 12345 },
        from: { is_bot: false }
      }
    },
    {
      ...baseEnv,
      FEISHU_WEBHOOK_URL: "https://open.feishu.cn/open-apis/bot/v2/hook/test-token"
    },
    fetcher
  );

  assert.equal(result.ok, true);
  assert.equal(result.feishu.ok, false);
  assert.equal(result.feishu.error, "feishu_webhook_error");
  assert.match(result.feishu.description, /network down/);
});

test("does not send Feishu notification when Telegram forwarding fails", async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    return jsonTelegramResponse({ ok: false, description: "telegram failed" }, 400);
  };

  const result = await forwardUpdate(
    {
      message: {
        message_id: 13,
        chat: { id: 12345 },
        from: { is_bot: false }
      }
    },
    {
      ...baseEnv,
      FEISHU_WEBHOOK_URL: "https://open.feishu.cn/open-apis/bot/v2/hook/test-token"
    },
    fetcher
  );

  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
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

test("sendFeishuText skips empty webhook url", async () => {
  const result = await sendFeishuText("", "hello", async () => {
    throw new Error("fetch should not be called");
  });

  assert.deepEqual(result, {
    ok: true,
    skipped: true,
    reason: "missing_FEISHU_WEBHOOK_URL"
  });
});

function jsonTelegramResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
