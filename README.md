# TeleBridge

Telegram 消息桥接转发器。使用个人账号 MTProto 会话监听新消息，转发到指定会话，并可同步通知到飞书。

## 功能

- 个人账号全量转发：私聊、群聊、超级群、频道、官方服务通知
- 按类别过滤来源：`private`、`group`、`channel`、`official`
- 来源白名单 / 黑名单
- 自动跳过目标会话，避免转发环路
- 飞书自定义机器人 Webhook 通知
- 保活消息（默认每 6 小时）
- 当日转发汇总日报（默认 23:55 发送）
- `/healthz` 健康检查端口

## 快速开始

### 1. 获取 Telegram 凭据

在 [my.telegram.org/apps](https://my.telegram.org/apps) 创建应用，获取 `API_ID` 和 `API_HASH`。

### 2. 生成 Session

```bash
# Bash
TELEGRAM_API_ID=123456 TELEGRAM_API_HASH=your_hash npm run user:login

# PowerShell
$env:TELEGRAM_API_ID="123456"; $env:TELEGRAM_API_HASH="your_hash"; npm run user:login
```

按提示输入手机号、验证码和两步验证密码。成功后输出 `TELEGRAM_USER_SESSION` 字符串。

### 3. 部署

拉取 Docker Hub 镜像即可运行：

```bash
docker run -d --name telebridge --restart unless-stopped \
  -p 7860:7860 \
  -e TELEGRAM_API_ID=123456 \
  -e TELEGRAM_API_HASH=your_hash \
  -e TELEGRAM_USER_SESSION=your_session \
  -e TELEGRAM_TARGET=-100xxxxxxxxxx \
  m3184876/telebridge:latest
```

## Docker Compose 部署

```yaml
services:
  telebridge:
    image: m3184876/telebridge:latest
    ports:
      - "7860:7860"
    environment:
      PORT: "7860"
      TELEGRAM_API_ID: "你的API_ID"
      TELEGRAM_API_HASH: "你的API_HASH"
      TELEGRAM_USER_SESSION: "你的SESSION"
      TELEGRAM_TARGET: "目标会话ID"
      FEISHU_WEBHOOK_URL: ""
      USERBOT_MONITORED_CHAT_TYPES: "private,group,channel,official"
      USERBOT_KEEPALIVE_ENABLED: "true"
      USERBOT_KEEPALIVE_INTERVAL_MINUTES: "360"
      USERBOT_DAILY_REPORT_ENABLED: "true"
      USERBOT_DAILY_REPORT_TIME: "23:55"
      USERBOT_DAILY_REPORT_TIMEZONE_OFFSET: "+08:00"
      USERBOT_LOG_LEVEL: "info"
    restart: unless-stopped
```

## 1Panel 面板部署

详见 [docs/1panel-deploy.md](docs/1panel-deploy.md)。

简要步骤：1Panel → 容器 → 编排 → 创建编排，粘贴上方 Compose 内容，填入实际环境变量值即可。

## 环境变量

### 必填

| 变量 | 说明 |
|------|------|
| `TELEGRAM_API_ID` | Telegram 应用 API ID |
| `TELEGRAM_API_HASH` | Telegram 应用 API Hash |
| `TELEGRAM_USER_SESSION` | 登录后生成的会话字符串 |
| `TELEGRAM_TARGET` | 转发目标（用户/群组/频道 ID 或 `@username`） |

### 可选

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FEISHU_WEBHOOK_URL` | 空 | 飞书机器人 Webhook 地址 |
| `USERBOT_MONITORED_CHAT_TYPES` | `private,group,channel,official` | 监控的聊天类型 |
| `USERBOT_ALLOWED_SOURCE_CHATS` | 空 | 来源白名单（逗号分隔 ID） |
| `USERBOT_BLOCKED_SOURCE_CHATS` | 空 | 来源黑名单 |
| `USERBOT_SKIP_TARGET_CHAT` | `true` | 跳过目标会话的消息 |
| `USERBOT_INCLUDE_OUTGOING` | `true` | 转发自己发出的消息 |
| `USERBOT_SILENT` | `false` | 静默转发（不触发通知） |
| `USERBOT_DROP_AUTHOR` | `false` | 不显示原始作者 |
| `USERBOT_PROTECT_CONTENT` | `false` | 禁止转发内容被再次转发 |
| `USERBOT_KEEPALIVE_ENABLED` | `true` | 启用保活消息 |
| `USERBOT_KEEPALIVE_INTERVAL_MINUTES` | `360` | 保活间隔（分钟） |
| `USERBOT_KEEPALIVE_MESSAGE` | `📡 转发器保活提醒` | 保活消息文本 |
| `USERBOT_DAILY_REPORT_ENABLED` | `true` | 启用日报 |
| `USERBOT_DAILY_REPORT_TIME` | `23:55` | 日报发送时间 |
| `USERBOT_DAILY_REPORT_TIMEZONE_OFFSET` | `+08:00` | 日报时区 |
| `USERBOT_RECONNECT_DELAY_MS` | `5000` | 重连延迟（毫秒） |
| `USERBOT_LOG_LEVEL` | `info` | 日志级别 |

## 健康检查

```bash
curl http://localhost:7860/healthz
```

返回 JSON 包含连接状态、授权状态、转发统计、最近错误等信息。

## CI/CD

推送到 `main` 分支时，GitHub Actions 自动构建 `linux/amd64` 和 `linux/arm64` 镜像并推送到 [Docker Hub](https://hub.docker.com/r/m3184876/telebridge)。

打版本 tag（如 `v1.0.0`）会额外推送对应版本号标签。

## 开发

```bash
npm install
npm run check
```

测试覆盖：来源过滤、类别过滤、飞书通知、保活消息格式、日报格式与定时、健康检查端口。

## 安全提示

`TELEGRAM_API_HASH` 和 `TELEGRAM_USER_SESSION` 是敏感信息，不要提交到 Git 或公开分享。使用环境变量或 Secrets 管理。
