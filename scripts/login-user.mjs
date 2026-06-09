import readline from "node:readline";
import { stdin, stdout } from "node:process";

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
  phoneNumber: async () => promptText("Phone number: "),
  password: async () => promptPassword("2FA password, if enabled: "),
  phoneCode: async () => promptText("Login code: "),
  onError: (error) => console.error(error)
});

const session = client.session.save();
console.log("");
console.log("TELEGRAM_USER_SESSION=");
console.log(session);
console.log("");
console.log("Store this value as an environment variable. Keep it secret.");

await client.disconnect();

function promptText(question) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptPassword(question) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return promptText(question);
  }

  return new Promise((resolve) => {
    const chars = [];
    const wasRaw = stdin.isRaw;

    function cleanup() {
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
    }

    function onKeypress(value, key = {}) {
      if (key.name === "return" || key.name === "enter") {
        cleanup();
        stdout.write("\n");
        resolve(chars.join(""));
        return;
      }

      if (key.name === "backspace") {
        if (chars.length > 0) {
          chars.pop();
          stdout.write("\b \b");
        }
        return;
      }

      if (key.ctrl && key.name === "c") {
        cleanup();
        stdout.write("\n");
        process.kill(process.pid, "SIGINT");
        return;
      }

      if (value && !key.ctrl && !key.meta) {
        chars.push(value);
        stdout.write("*");
      }
    }

    readline.emitKeypressEvents(stdin);
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("keypress", onKeypress);
  });
}
