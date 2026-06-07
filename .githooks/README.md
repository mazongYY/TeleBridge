# TeleBridge Git 提交规范

## 📋 提交信息格式

```
<中文类型>(<作用域>): <emoji> <中文简短描述>
```

### 示例
```
功能(userbot): ✨ 增加保活消息通知
修复(forwarder): 🐛 修复消息转发失败问题
文档(README): 📝 重写部署说明
维护(docker): 🔧 优化容器构建流程
测试(config): ✅ 增加配置验证测试
```

## 🎯 中文类型（9种）

| 类型 | 说明 | Emoji |
|------|------|-------|
| **功能** | 新功能开发 | ✨ |
| **修复** | Bug 修复 | 🐛 |
| **文档** | 文档变更 | 📝 |
| **样式** | 代码格式调整（不影响运行） | 💄 |
| **重构** | 代码重构（非新功能/修Bug） | ♻️ |
| **性能** | 性能优化 | ⚡ |
| **测试** | 添加或修正测试 | ✅ |
| **维护** | 构建、依赖、配置变更 | 🔧 |
| **回滚** | 回滚提交 | ⏪ |

## 📦 推荐作用域

根据项目模块划分的作用域：

| 作用域 | 说明 | 相关文件 |
|--------|------|----------|
| `userbot` | Telegram UserBot 核心逻辑 | `scripts/userbot-*.mjs` |
| `forwarder` | 消息转发器 | `scripts/user-forwarder.mjs` |
| `config` | 配置管理 | `scripts/userbot-config.mjs` |
| `runtime` | 运行时逻辑 | `scripts/userbot-runtime.mjs` |
| `login` | 登录认证 | `scripts/login-user.mjs` |
| `cloudflare` | Cloudflare Workers | `src/index.js`, `wrangler.jsonc` |
| `docker` | Docker 配置 | `Dockerfile`, `docker-compose.yml` |
| `scripts` | 其他脚本文件 | `scripts/*.mjs` |
| `test` | 测试代码 | `test/*.test.mjs` |
| `docs` | 文档 | `README.md` |
| `deps` | 依赖管理 | `package.json`, `package-lock.json` |
| `workflow` | CI/CD 工作流 | `.github/workflows/*` |

## ✍️ 完整提交示例

### 简单提交
```bash
git commit -m "功能(userbot): ✨ 增加保活消息通知"
```

### 详细提交（含正文和页脚）
```bash
git commit -m "修复(forwarder): 🐛 修复消息转发失败问题

当目标用户不存在时，转发器会抛出未捕获异常导致进程退出。
现在添加了错误处理和重试机制。

Closes #123"
```

## 🚫 常见错误

### ❌ 错误示例
```
feat: add new feature                    # 必须使用中文
功能: 增加新功能                         # 缺少作用域
功能() 增加新功能                        # 缺少 emoji
功能(userbot): 增加新功能                # 缺少 emoji
功能(userbot): ✨ 增加新功能。           # 结尾不要加句号
```

### ✅ 正确示例
```
功能(userbot): ✨ 增加保活消息通知
修复(docker): 🐛 修复容器权限问题
文档(README): 📝 更新部署指南
```

## 🔧 自动化工具

项目已配置 Git hooks 自动检查提交格式：
- Hook 位置：`.githooks/commit-msg`
- 模板文件：`.gitmessage`
- 配置命令：`git config core.hooksPath .githooks`

如果提交格式不符合规范，Git 会自动拒绝提交并显示错误提示。

## 💡 最佳实践

1. **保持简短**：标题控制在 50 字符以内
2. **使用现在时**：如"增加"而非"增加了"
3. **首字母小写**：中文无需考虑大小写
4. **不加标点**：标题结尾不加句号
5. **关联 Issue**：在页脚中使用 `Closes #123` 关联问题

## 📚 更多信息

- Git 提交模板：查看 `.gitmessage` 文件
- Hook 脚本：查看 `.githooks/commit-msg` 文件
- 项目 README：[README.md](../README.md)
