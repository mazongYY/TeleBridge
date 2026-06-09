---
title: TeleBridge
emoji: 📬
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
---

# TeleBridge

TeleBridge 是一个 Docker 优先的 Telegram 消息桥接器。它使用个人账号的 MTProto 会话监听该账号可见的新消息，并把消息转发到指定用户、群组、超级群或频道。

## 功能

- 个人账号全量转发：私聊、群聊、超级群、频道、Telegram 官方服务通知
- 按类别过滤来源：`private`、`group`、`channel`、`official`
- 来源白名单和黑名单
- 自动跳过目标会话，避免转发环路
- 飞书自定义机器人 Webhook 通知
- 保活消息通知
- 当日转发汇总日报
- `/healthz` 健康检查和运行状态输出
- 配置错误时容器不退出，便于 Hugging Face Space 保持端口在线并显示错误

## 运行模型

TeleBridge 的个人账号转发需要长期保持 Telegram MTProto 连接，因此必须作为常驻 Node 进程运行。Docker / Hugging Face Space 是推荐部署方式。

注意：代码可以避免应用自身因为配置错误退出，但不能绕过 Hugging Face 免费 Space 的平台休眠策略。需要持续在线时，应使用 Hugging Face 的付费硬件或其他常驻服务器。

## 必填配置

在 Hugging Face Space 的 Settings 中添加以下 Secrets：

```text
TELEGRAM_API_ID
TELEGRAM_API_HASH
TELEGRAM_USER_SESSION
TELEGRAM_TARGET
```

说明：

- `TELEGRAM_API_ID`: 转发号使用，在 `https://my.telegram.org/apps` 创建应用后获得
- `TELEGRAM_API_HASH`: 转发号使用，同上
- `TELEGRAM_USER_SESSION`: 转发号登录后生成的会话字符串
- `TELEGRAM_TARGET`: 接收方，可以是用户 ID、群组 ID、频道 ID 或 `@username`

`TELEGRAM_API_HASH` 和 `TELEGRAM_USER_SESSION` 都是敏感信息，不要提交到 Git，也不要公开发到聊天里。

可选飞书通知：

```text
FEISHU_WEBHOOK_URL
```

`FEISHU_WEBHOOK_URL` 是飞书自定义机器人的 Webhook 地址。配置后，每次 Telegram 消息成功转发时，TeleBridge 会额外发送一条飞书文本通知；不配置则关闭飞书通知。Webhook 地址包含机器人凭据，建议在 Hugging Face Space Secrets 或 Docker 环境变量中保存。

## 生成 TELEGRAM_USER_SESSION

在本机生成，不建议在 Hugging Face Space 中交互式登录。

PowerShell：

```powershell
$env:TELEGRAM_API_ID="123456"
$env:TELEGRAM_API_HASH="your_api_hash"
npm run user:login
```

Bash：

```bash
TELEGRAM_API_ID=123456 TELEGRAM_API_HASH=your_api_hash npm run user:login
```

按提示输入手机号、验证码和二步验证密码。成功后会输出：

```text
TELEGRAM_USER_SESSION=
一长串字符串
```

把这串值保存为 Hugging Face Space Secret。

## Hugging Face Spaces 部署

本项目 README 顶部已配置 Docker Space 元数据：

```yaml
sdk: docker
app_port: 7860
```

创建 Hugging Face Space 时选择 Docker SDK，然后推送代码：

```bash
git remote add space https://huggingface.co/spaces/你的用户名/你的Space名
git push space main
```

当前示例 Space：

```text
https://huggingface.co/spaces/MorningGalaxyDawn/Telegram
```

## Docker 本地运行

```bash
docker build -t telebridge .
docker run --rm -p 7860:7860 \
  -e TELEGRAM_API_ID=123456 \
  -e TELEGRAM_API_HASH=your_api_hash \
  -e TELEGRAM_USER_SESSION=your_string_session \
  -e TELEGRAM_TARGET=-1001234567890 \
  -e FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/your-token \
  telebridge
```

或使用 Compose：

```bash
docker compose up --build
```

## 健康检查

容器监听 `0.0.0.0:7860`，用于 Hugging Face 判断服务是否启动，也用于查看 TeleBridge 状态。

```bash
curl http://localhost:7860/healthz
```

返回字段包含：

- `ok`: 是否已连接且已授权
- `connected`: 是否连接 Telegram
- `authorized`: 账号会话是否有效
- `targetPeerId`: 目标会话
- `lastForwardedAt`: 最近转发时间
- `lastKeepaliveAt`: 最近保活时间
- `lastDailyReportAt`: 最近日报时间
- `lastError`: 最近错误
- `metrics`: 当日统计

Telegram 消息监听和转发走 MTProto 连接，不走 `7860` 端口。

## 可选配置

```text
USERBOT_MONITORED_CHAT_TYPES=private,group,channel,official
USERBOT_ALLOWED_SOURCE_CHATS=
USERBOT_BLOCKED_SOURCE_CHATS=
USERBOT_SKIP_TARGET_CHAT=true
USERBOT_INCLUDE_OUTGOING=true
USERBOT_SILENT=false
USERBOT_DROP_AUTHOR=false
USERBOT_PROTECT_CONTENT=false
USERBOT_KEEPALIVE_ENABLED=true
USERBOT_KEEPALIVE_INTERVAL_MINUTES=360
USERBOT_KEEPALIVE_MESSAGE=📡 转发器保活提醒
USERBOT_DAILY_REPORT_ENABLED=true
USERBOT_DAILY_REPORT_TIME=23:55
USERBOT_DAILY_REPORT_TIMEZONE_OFFSET=+08:00
FEISHU_WEBHOOK_URL=
USERBOT_RECONNECT_DELAY_MS=5000
USERBOT_LOG_LEVEL=info
```

飞书通知内容包含来源类型、来源会话、消息 ID 和文本/媒体摘要。飞书 Webhook 请求失败只会记录到运行状态和日志，不会阻断 Telegram 转发。

类别过滤示例：

```text
# 只转发群聊和频道
USERBOT_MONITORED_CHAT_TYPES=group,channel

# 只转发私聊，不转发 Telegram 官方服务通知
USERBOT_MONITORED_CHAT_TYPES=private

# 只转发 Telegram 官方服务通知账号 777000
USERBOT_MONITORED_CHAT_TYPES=official
```

保活和日报示例：

```text
# 每 2 小时发送一次保活消息
USERBOT_KEEPALIVE_ENABLED=true
USERBOT_KEEPALIVE_INTERVAL_MINUTES=120

# 每天北京时间 23:55 发送当日转发汇总
USERBOT_DAILY_REPORT_ENABLED=true
USERBOT_DAILY_REPORT_TIME=23:55
USERBOT_DAILY_REPORT_TIMEZONE_OFFSET=+08:00
```

## 保活消息

保活消息会发送到 `TELEGRAM_TARGET`，用于确认 TeleBridge 仍在运行。默认每 6 小时发送一次。

保活通知使用中文和 emoji 展示，内容包括：

- 当前时间
- 连接状态
- 授权状态
- 目标会话
- 当日已转发数量
- 当日错误数量
- 最近转发时间
- 最近错误状态
- 错误原因统计

## 当日转发汇总日报

日报默认按 `+08:00` 时区每天 `23:55` 发送到 `TELEGRAM_TARGET`。

日报通知使用中文和 emoji 分段展示，内容包括：

- 当日转发总数
- 私聊、群聊、频道、官方通知分类数量
- 跳过数量
- 错误数量
- 最近转发时间
- 最近错误
- 跳过原因统计
- 错误原因统计

## GitHub

目标仓库：

```text
git@github.com:mazongYY/TeleBridge.git
```

推荐远端名：

```bash
git remote add origin git@github.com:mazongYY/TeleBridge.git
git push -u origin main
```

## 开发检查

```bash
npm install
npm run check
```

当前测试覆盖：

- userbot 来源过滤
- 监控类别过滤
- 飞书通知发送结果处理
- 保活消息格式
- 日报格式与定时计算
- 健康检查端口配置
