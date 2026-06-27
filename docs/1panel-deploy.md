# TeleBridge 1Panel VPS 部署指南

本文档详细介绍如何将 TeleBridge 部署到使用 1Panel 管理的 VPS 上。

---

## 前置条件

- VPS 已安装 1Panel 面板
- 1Panel 已安装 Docker 和 Docker Compose（1Panel 默认自带）
- 已获取以下 Telegram 凭据：
  - `TELEGRAM_API_ID`
  - `TELEGRAM_API_HASH`
  - `TELEGRAM_USER_SESSION`（在本机通过 `npm run user:login` 生成）
  - `TELEGRAM_TARGET`

---

## 方式一：通过 1Panel 编排部署（推荐）

### 第 1 步：上传项目文件到 VPS

将项目代码上传到 VPS 的 `/opt/telebridge/` 目录（路径可自选）。

**方法 A — 通过 1Panel 文件管理器上传**

1. 登录 1Panel 面板
2. 进入 **主机** → **文件**
3. 导航到 `/opt/`，新建文件夹 `telebridge`
4. 将本地项目文件打包为 `telebridge.zip`（**排除 `node_modules/` 目录**），上传并解压

**方法 B — 通过 Git 拉取（推荐）**

在 1Panel 的 **主机** → **终端** 中执行：

```bash
cd /opt
git clone https://github.com/mazongYY/TeleBridge.git telebridge
cd telebridge
```

### 第 2 步：创建 .env 配置文件

在项目目录 `/opt/telebridge/` 下创建 `.env` 文件：

```bash
cd /opt/telebridge
cp .env.example .env
vi .env
```

填入实际值：

```ini
TELEGRAM_API_ID=你的API_ID
TELEGRAM_API_HASH=你的API_HASH
TELEGRAM_USER_SESSION=你的SESSION字符串
TELEGRAM_TARGET=你的目标会话ID或@username

# 可选：飞书通知
FEISHU_WEBHOOK_URL=

# 可选：按需调整过滤规则
USERBOT_MONITORED_CHAT_TYPES=private,group,channel,official
```

> **安全提示**：`.env` 文件包含敏感信息，确保文件权限为 `600`：
> ```bash
> chmod 600 /opt/telebridge/.env
> ```

### 第 3 步：通过 1Panel 创建 Compose 编排

1. 登录 1Panel 面板
2. 进入 **容器** → **编排**
3. 点击 **创建编排**
4. 填写信息：
   - **名称**：`telebridge`
   - **路径**：选择 `/opt/telebridge/`（即包含 `docker-compose.yml` 的目录）
5. 1Panel 会自动识别 `docker-compose.yml`
6. 点击 **确认** 创建并启动

1Panel 会自动执行 `docker compose up --build`，构建镜像并启动容器。

### 第 4 步：验证部署

在 1Panel **容器** 列表中确认 `telebridge` 容器状态为 `running`。

查看日志：

```bash
docker logs -f telebridge-telebridge-1
```

健康检查：

```bash
curl http://localhost:7860/healthz
```

返回 `ok: true` 即表示部署成功。

---

## 方式二：通过 1Panel 终端手动部署

如果不想使用 1Panel 的编排功能，可以直接在终端操作。

### 构建并启动

```bash
cd /opt/telebridge
docker compose up --build -d
```

### 查看日志

```bash
docker compose logs -f
```

### 停止/重启

```bash
docker compose down      # 停止
docker compose restart   # 重启
docker compose up -d     # 启动（不重新构建）
docker compose up --build -d  # 重新构建并启动
```

---

## 常见运维操作

### 更新代码

```bash
cd /opt/telebridge
git pull
docker compose up --build -d
```

### 修改配置

编辑 `.env` 文件后重启容器：

```bash
cd /opt/telebridge
vi .env
docker compose restart
```

### 查看运行状态

```bash
curl http://localhost:7860/healthz | python3 -m json.tool
```

### 设置容器自动更新（可选）

1Panel 应用商店中的 Watchtower 可以自动更新镜像。但 TeleBridge 使用本地构建，建议手动更新。

---

## 网络与防火墙配置

### 端口说明

| 端口 | 用途 | 是否需要对外暴露 |
|------|------|-----------------|
| 7860 | 健康检查 / 状态查询 | **否**（仅本地访问即可） |

TeleBridge 的消息收发走 Telegram MTProto 协议（出站连接），不需要任何入站端口开放。

### 防火墙建议

- **不需要**在 1Panel 防火墙或云服务商安全组中开放 7860 端口
- 确保 VPS 能正常访问 Telegram 服务器（部分 VPS 可能需要配置代理）

### 如果 VPS 无法直连 Telegram

在 `docker-compose.yml` 中添加代理环境变量：

```yaml
environment:
  HTTP_PROXY: "http://你的代理地址:端口"
  HTTPS_PROXY: "http://你的代理地址:端口"
```

或在 1Panel 中安装代理工具（如 xray）确保网络可达。

---

## 数据持久化

当前配置下，TeleBridge 不产生需要持久化的本地数据。Session 信息通过环境变量注入，容器重建后自动恢复连接。

如果未来需要持久化日志或数据库，可在 `docker-compose.yml` 中添加 volumes 映射。

---

## 故障排查

### 容器启动后立即退出

```bash
docker logs telebridge-telebridge-1
```

常见原因：
- `.env` 文件缺少必填项
- `TELEGRAM_USER_SESSION` 无效或过期
- `TELEGRAM_TARGET` 格式错误

### Telegram 连接失败

1. 确认 VPS 网络可以访问 Telegram
2. 检查代理配置是否正确
3. 查看 `healthz` 中的 `lastError` 字段

### Session 过期

Session 过期后需要重新在本机执行 `npm run user:login` 生成新的 `TELEGRAM_USER_SESSION`，然后更新 `.env` 并重启容器。

---

## 部署架构概览

```
┌─────────────────────────────────────────┐
│                 VPS                     │
│  ┌───────────────────────────────────┐  │
│  │            1Panel 面板            │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │     Docker Engine           │  │  │
│  │  │  ┌───────────────────────┐  │  │  │
│  │  │  │  telebridge 容器       │  │  │  │
│  │  │  │  (Node.js 22)         │  │  │  │
│  │  │  │  :7860 (healthz)      │  │  │  │
│  │  │  │  MTProto 出站连接      │  │  │  │
│  │  │  └──────────┬────────────┘  │  │  │
│  │  └─────────────┼───────────────┘  │  │
│  └────────────────┼───────────────────┘  │
└───────────────────┼─────────────────────┘
                    │ MTProto (出站)
                    ▼
           ┌────────────────┐
           │ Telegram 服务器 │
           └────────────────┘
```
