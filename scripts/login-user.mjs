import input from "input";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

import { validateLoginConfig } from "./userbot-config.mjs";

const config = validateLoginConfig();
const client = new TelegramClient(
  new StringSession(config.existingSession || ""),
  config.apiId,
  config.apiHash,
  {
    connectionRetries: 5
  }
);

console.log("Starting Telegram user authorization...");

await client.start({
  phoneNumber: async () => input.text("Phone number: "),
  password: async () => input.password("2FA password, if enabled: "),
  phoneCode: async () => input.text("Login code: "),
  onError: (error) => console.error(error)
});

const session = client.session.save();
console.log("");
console.log("TELEGRAM_USER_SESSION=");
console.log(session);
console.log("");
console.log("Store this value as an environment variable. Keep it secret.");

await client.disconnect();
