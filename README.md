# 墨境（Mojing）

本地优先的 AI 小说创作工作台。Electron + React + FastAPI + SQLite，所有数据存在本地，无需联网。

## 开发

```bash
npm install                      # 前端依赖
pip install -r backend/requirements.txt   # 后端依赖
npm run dev          # 开发模式（前后端，浏览器访问 http://127.0.0.1:5175）
npm run desktop      # Electron 桌面开发模式
npm run typecheck    # 类型检查
npm run lint         # ESLint
npm run test         # 后端 pytest
```

> **Python 版本**：建议 3.12/3.13。3.14 过新，部分依赖可能未适配。

## 数据与备份

- 全部创作数据存储在一个 SQLite 文件（默认 `墨境数据/mojing.db`）
- **自动备份**（#2）：每次启动 + 每天首次写作自动创建滚动备份（保留最近 10 份），位于 `墨境数据/backups/`。设置页「数据与备份」可查看备份列表并手动创建
- 设置页可自定义数据保存位置（迁移时自动携带现有数据）

## 安全说明（#7）

本地 API（`127.0.0.1:8765`）使用 bearer token 鉴权，token 在后端启动时生成并持久化。Electron 主进程通过 `/api/health` 获取 token 并经 preload 注入渲染进程。

**已知权衡**：`/api/health` 是开放端点且返回 token，这意味着本机任意进程 `curl 127.0.0.1:8765/api/health` 即可拿到令牌。在单用户本机场景下，"能跑本机进程"基本等价于"能直接读取 SQLite 文件"，因此这不是新增攻击面——浏览器跨域读取已被 CORS 拦截。`health` 响应中的 `handshake_open` 字段标识是否处于启动握手窗口内，便于后续收紧。如需更高强度，可改为 Electron 主进程直接读 `storage.json` 拿 token，health 不再下发。

## 发布（#10 / #11）

- `npm run dist` 构建并发布到 GitHub Releases（需 `GH_TOKEN`），electron-updater 据此实现自动更新
- **代码签名**（#11）：当前未购买 OV 证书，Windows SmartScreen 会弹"未知发布者"警告。首次分发时请在发布说明中预告此提示；长期建议签名

## 测试

后端核心逻辑（鉴权、密钥加密、版本节流、备份、数据目录迁移）有 pytest 覆盖：

```bash
npm run test       # 或 python -m pytest backend/tests -q
```
