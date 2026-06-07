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

const config = loadUserbotConfig();

if (!config.session) {
  throw new Error("TELEGRAM_USER_SESSION is required. Run `npm run user:login` first.");
}

let stopping = false;
let queue = Promise.resolve();
const state = {
  startedAt: new Date().toISOString(),
  connected: false,
  authorized: false,
  targetPeerId: "",
  lastForwardedAt: "",
  lastError: ""
};

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
        .catch((error) => console.error("Forward queue error:", formatError(error)));
    }, new NewMessage({ incoming: config.includeOutgoing ? undefined : true }));

    while (!stopping) {
      await sleep(1000);
    }
  } catch (error) {
    state.connected = false;
    state.authorized = false;
    state.lastError = formatError(error);
    console.error("User forwarder error:", formatError(error));
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
    logDebug(`Skipped message ${message.id}: ${chatTypeDecision.reason}`);
    return;
  }

  const decision = shouldForwardUserMessage(message, sourcePeerId, targetPeerId, runtimeConfig);

  if (!decision.ok) {
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

    state.lastForwardedAt = new Date().toISOString();
    console.log(`Forwarded message ${message.id} from ${normalizeId(sourcePeerId)} to ${targetPeerId}`);
  } catch (error) {
    state.lastError = formatError(error);
    console.error(`Failed to forward message ${message.id} from ${normalizeId(sourcePeerId)}:`, formatError(error));
  }
}

function startHealthServer(runtimeConfig, runtimeState) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || "/", "http://localhost");
    const body = {
      ok: runtimeState.connected && runtimeState.authorized,
      service: "telegram-user-forwarder",
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
