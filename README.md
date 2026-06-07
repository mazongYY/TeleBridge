---
title: Telegram User Forwarder
emoji: 📬
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
---

# Telegram User Forwarder

一个 Docker 优先的 Telegram 消息转发器项目，包含两种模式：

- `userbot` 常驻模式：用个人账号登录 MTProto，转发该账号可见的新消息到指定群组/用户；这是容器默认主进程
- `worker` webhook 模式：运行在 Cloudflare Workers 上，用 Bot API 转发 bot 可见的消息

## 能做什么

- 用个人账号转发私聊、群聊、频道里该账号可见的新消息
- 将 bot 收到的私聊、群聊、频道消息转发到 `TARGET_CHAT_ID`
- 支持 Telegram Business 连接账号产生的 `business_message`
- 支持 `copyMessage` 和 `forwardMessage` 两种模式
- 支持来源白名单、黑名单、bot 消息过滤
- 提供受保护的管理接口来设置/删除/查看 webhook

## 个人账号全量转发

个人账号全量转发必须运行一个常驻 Node 进程。Cloudflare Workers 适合 HTTPS webhook，但不适合长期保持 MTProto 监听连接。

### 1. 获取 Telegram API 凭证

到 `https://my.telegram.org/apps` 创建应用，拿到：

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`

### 2. 安装依赖

```bash
npm install
```

### 3. 生成个人账号会话

设置环境变量后运行登录命令：

```bash
TELEGRAM_API_ID=123456 TELEGRAM_API_HASH=your_api_hash npm run user:login
```

按提示输入手机号、验证码和二步验证密码。命令会输出 `TELEGRAM_USER_SESSION`，这是个人账号登录凭据，必须保密。

### 4. 启动个人账号转发

```bash
TELEGRAM_API_ID=123456 \
TELEGRAM_API_HASH=your_api_hash \
TELEGRAM_USER_SESSION=your_string_session \
TELEGRAM_TARGET=-1001234567890 \
npm run user:forward
```

`TELEGRAM_TARGET` 可以是目标用户、群组、超级群组或频道，例如 `123456789`、`-1001234567890`、`@username`。

常用可选项：

- `USERBOT_ALLOWED_SOURCE_CHATS`: 只转发这些来源会话，逗号分隔；留空表示不限制
- `USERBOT_BLOCKED_SOURCE_CHATS`: 不转发这些来源会话，逗号分隔
- `USERBOT_MONITORED_CHAT_TYPES`: 需要监控的会话类别，逗号分隔，支持 `private`、`group`、`channel`、`official`，默认全部启用
- `USERBOT_SKIP_TARGET_CHAT`: 是否跳过目标会话，默认 `true`，用于避免转发环路
- `USERBOT_INCLUDE_OUTGOING`: 是否包含自己发出的消息，默认 `true`
- `USERBOT_SILENT`: 是否静默转发，默认 `false`
- `USERBOT_DROP_AUTHOR`: 是否隐藏原作者，默认 `false`
- `USERBOT_PROTECT_CONTENT`: 是否保护转发后的内容，默认 `false`
- `USERBOT_KEEPALIVE_ENABLED`: 是否发送保活消息到目标会话，默认 `true`
- `USERBOT_KEEPALIVE_INTERVAL_MINUTES`: 保活消息间隔分钟数，默认 `360`
- `USERBOT_KEEPALIVE_MESSAGE`: 保活消息标题，默认 `Telegram 转发器保活`
- `USERBOT_DAILY_REPORT_ENABLED`: 是否发送每日转发汇总，默认 `true`
- `USERBOT_DAILY_REPORT_TIME`: 日报发送时间，格式 `HH:mm`，默认 `23:55`
- `USERBOT_DAILY_REPORT_TIMEZONE_OFFSET`: 日报时间对应时区，格式 `+08:00`，默认 `+08:00`
- `USERBOT_RECONNECT_DELAY_MS`: 断线重连间隔，默认 `5000`
- `USERBOT_LOG_LEVEL`: `info` 或 `debug`

示例：

```text
# 只转发群聊和频道
USERBOT_MONITORED_CHAT_TYPES=group,channel

# 只转发私聊，不转发 Telegram 官方服务通知
USERBOT_MONITORED_CHAT_TYPES=private

# 只转发 Telegram 官方服务通知账号 777000
USERBOT_MONITORED_CHAT_TYPES=official

# 每 2 小时发送一次保活消息
USERBOT_KEEPALIVE_ENABLED=true
USERBOT_KEEPALIVE_INTERVAL_MINUTES=120

# 每天北京时间 23:55 发送当日转发汇总
USERBOT_DAILY_REPORT_ENABLED=true
USERBOT_DAILY_REPORT_TIME=23:55
USERBOT_DAILY_REPORT_TIMEZONE_OFFSET=+08:00
```

容器会在 `PORT` 指定端口提供健康检查，默认 `7860`：

```bash
curl http://localhost:7860/healthz
```

即使 Telegram Secrets 缺失或登录失败，容器也会保持健康检查端口在线，并在 `/healthz` 的 `lastError` 字段显示错误；修正 Hugging Face Secrets 后重启 Space 即可重新连接。注意：这只能避免应用自身退出，不能绕过 Hugging Face 免费 Space 的平台休眠策略；需要持续在线时应使用 Hugging Face 的付费硬件/保持运行能力。

## Docker 运行

先生成 `TELEGRAM_USER_SESSION`，再运行容器：

```bash
docker build -t telegram-user-forwarder .
docker run --rm -p 7860:7860 \
  -e TELEGRAM_API_ID=123456 \
  -e TELEGRAM_API_HASH=your_api_hash \
  -e TELEGRAM_USER_SESSION=your_string_session \
  -e TELEGRAM_TARGET=-1001234567890 \
  telegram-user-forwarder
```

也可以用 `docker-compose.yml`：

```bash
docker compose up --build
```

## 部署到 Hugging Face Spaces

Hugging Face Docker Space 会读取 README 顶部的 YAML 元数据；本项目已设置：

- `sdk: docker`
- `app_port: 7860`

创建 Space 时选择 Docker SDK，然后在 Space 的 Settings 中添加以下 Secrets：

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_USER_SESSION`
- `TELEGRAM_TARGET`

可选 Variables：

- `USERBOT_ALLOWED_SOURCE_CHATS`
- `USERBOT_BLOCKED_SOURCE_CHATS`
- `USERBOT_MONITORED_CHAT_TYPES`
- `USERBOT_SKIP_TARGET_CHAT`
- `USERBOT_INCLUDE_OUTGOING`
- `USERBOT_SILENT`
- `USERBOT_DROP_AUTHOR`
- `USERBOT_PROTECT_CONTENT`
- `USERBOT_KEEPALIVE_ENABLED`
- `USERBOT_KEEPALIVE_INTERVAL_MINUTES`
- `USERBOT_KEEPALIVE_MESSAGE`
- `USERBOT_DAILY_REPORT_ENABLED`
- `USERBOT_DAILY_REPORT_TIME`
- `USERBOT_DAILY_REPORT_TIMEZONE_OFFSET`
- `USERBOT_RECONNECT_DELAY_MS`
- `USERBOT_LOG_LEVEL`

用 Git 推送到 Space：

```bash
git init
git add .
git commit -m "deploy telegram user forwarder"
git remote add space https://huggingface.co/spaces/你的用户名/你的Space名
git push space main
```

如果使用 Hugging Face token：

```bash
git remote add space https://你的用户名:你的HF_TOKEN@huggingface.co/spaces/你的用户名/你的Space名
git push space main
```

## Cloudflare Worker Bot 模式

这部分只适用于 bot/Business webhook，不是个人账号全量转发。

### 配置项

必填密钥：

- `TELEGRAM_BOT_TOKEN`: BotFather 生成的 bot token
- `WEBHOOK_SECRET`: Telegram webhook secret token
- `ADMIN_TOKEN`: 管理接口 bearer token

必填变量：

- `TARGET_CHAT_ID`: 目标用户、群组、超级群组或频道 ID，例如 `123456789`、`-1001234567890`，也可以是部分支持场景下的 `@username`

可选变量：

- `FORWARD_MODE`: `copy` 或 `forward`，默认 `copy`
- `ALLOWED_SOURCE_CHAT_IDS`: 允许转发的来源 chat id，逗号分隔；留空表示不限制
- `BLOCKED_SOURCE_CHAT_IDS`: 禁止转发的来源 chat id，逗号分隔
- `IGNORE_BOT_MESSAGES`: 是否忽略 bot 发出的消息，默认 `true`
- `FORWARD_EDITED_MESSAGES`: 是否转发编辑消息，默认 `false`
- `FALLBACK_TO_FORWARD`: `copyMessage` 失败后是否尝试 `forwardMessage`，默认 `false`
- `DISABLE_NOTIFICATION`: 是否静默发送，默认 `false`
- `PROTECT_CONTENT`: 是否保护转发后的内容，默认 `false`
- `TARGET_MESSAGE_THREAD_ID`: 目标论坛话题 ID，可选
- `ALLOWED_UPDATES`: 自定义 webhook allowed_updates，逗号分隔
- `PUBLIC_WEBHOOK_URL`: 显式 webhook 地址；留空时管理接口会使用当前 Worker 域名拼出 `/webhook`

### 本地开发

本地密钥写入 `.dev.vars`：

```bash
TELEGRAM_BOT_TOKEN=123456:your-bot-token
WEBHOOK_SECRET=change-me-webhook-secret
ADMIN_TOKEN=change-me-admin-token
TARGET_CHAT_ID=-1001234567890
```

启动本地 Worker：

```bash
npm run dev
```

运行检查：

```bash
npm run check
```

### 部署

设置 Cloudflare Worker secrets：

```bash
npm run set-secret:bot
npm run set-secret:webhook
npm run set-secret:admin
```

编辑 `wrangler.jsonc` 中的 `TARGET_CHAT_ID`，然后部署：

```bash
npm run deploy
```

部署后设置 webhook：

```bash
curl -X POST "https://你的-worker域名/admin/set-webhook?drop_pending_updates=true" \
  -H "Authorization: Bearer 你的ADMIN_TOKEN"
```

查看 webhook：

```bash
curl "https://你的-worker域名/admin/webhook-info" \
  -H "Authorization: Bearer 你的ADMIN_TOKEN"
```

测试 bot token：

```bash
curl "https://你的-worker域名/admin/get-me" \
  -H "Authorization: Bearer 你的ADMIN_TOKEN"
```

删除 webhook：

```bash
curl -X POST "https://你的-worker域名/admin/delete-webhook" \
  -H "Authorization: Bearer 你的ADMIN_TOKEN"
```

## 使用前准备

1. 用 BotFather 创建 bot，拿到 `TELEGRAM_BOT_TOKEN`
2. 把 bot 加入目标群组/频道，并确保它有发送消息权限
3. 把 bot 加入需要监听的群组/频道；私聊转发需要用户主动和 bot 对话
4. 如果转发 Telegram Business 账号消息，将 bot 连接到对应 Business 账号，并保持 webhook 的 `allowed_updates` 包含 `business_message`
