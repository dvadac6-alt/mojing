# 墨境（InkForge）项目优化建议 v2

> 分析时间：2026-08-09 ｜ 范围：前端（React/Vite）、后端（FastAPI/SQLite）、桌面壳（Electron）、打包配置
>
> v2 修订说明：根据评审反馈修正——删除过时的 #19；将 N+1、FTS5、WAL 从 P1 降级为"数据量触发"项；#12 拆分为 foreign_keys（正确性，立即做）与 WAL（缓做）；#1 补充开发模式折中；新增 set_data_dir 竞态、Key 不下发两项；AI 取消与版本节流合并实施。
>
> 项目整体评价：架构清晰（Electron + 本地 FastAPI + SQLite 的设计是合理的），代码可读性好，但存在**几个会导致数据膨胀、密钥泄露的真实风险**，以及明显的可维护性瓶颈。按优先级整理如下。

---

## 一、P0：安全与数据风险（建议优先处理）

### 1. 本地 API 无鉴权 + CORS 全开放 + API Key 下发前端

**位置**：`backend/main.py:22-28`、`backend/app/routes.py:114-119`、`backend/app/models.py:200`

当前三个问题叠加后风险很高：

- `CORSMiddleware(allow_origins=["*"])`：任何网页（包括恶意网站）里的 JS 都可以直接 `fetch('http://127.0.0.1:8765/api/...')`；
- 接口无任何 token 校验；
- `AIConfigResponse` 把 `api_key` **明文返回**给前端（`_ai_config()` 全字段透出），数据库里也明文存储。

**后果**：用户浏览器里打开的任意网页都能读取/修改/删除小说数据，并窃取 AI 服务商的 API Key 盗刷额度。

**建议**（v2 修正版，含两条评审意见）：
- 后端启动时生成随机 token，Electron 通过 preload 注入渲染进程。**注意开发模式折中**：`npm run dev` 下前端是浏览器直连 127.0.0.1:5175，不能"拒绝一切浏览器"——token 校验仅对 Electron 渲染进程强制，开发态额外放开 `http://127.0.0.1:5175` origin 免 token（或用环境变量显式声明 dev 模式）。
- CORS 白名单收窄到 `http://127.0.0.1:5175`（开发）与 `null`/`app://`（打包后 file 协议）。
- **Key 永不下发前端**（比"掩码返回"更彻底：掩码防不住进入浏览器内存后被 devtools 抓到）。做法：Key 只在创建/更新配置时上行，响应永不回传（更新时留空表示不改动）；"测试连通性"走专用接口由后端代发请求。存储侧至少做对称加密或仅存 OS 钥匙串。

### 2. 章节版本表无上限膨胀（与 AI 流式取消一起做）

**位置**：`backend/app/routes.py:264-298`（`update_chapter`）、`src/workspaceApi.ts:177`（`streamAI`）

写作页前端是 **1 秒防抖自动保存**（`App.tsx` WritingPage），后端每次 `content` 变化都会把**整章全文**写入 `chapter_versions` 一行。写一章 5000 字、触发 200 次自动保存 = 数据库存 200 份全文快照，且永不清理。长篇使用数月后 DB 体积会失控。

**建议**：
- 版本快照节流：距上一版本不足 N 分钟（如 10 分钟）则覆盖而非新增；
- 每章保留上限（如 50 个自动版本），超出滚动删除；手动打标（`label != 'auto'`）的版本永不清理；
- 长期可改为增量 diff 存储。
- **顺带做（同处写作页链路）**：`streamAI` 目前无 AbortController，用户无法取消跑偏的长生成。fetch 传入 `signal` 即可，与版本节流的改动位置相邻，建议一次完成。

### 3. 打包分发依赖用户机器安装 Python

**位置**：`package.json:38`（files 包含 `backend/**/*`）、`electron/main.cjs:67`（`spawn('python', ...)`）

打包后的安装包只带了 `.py` 源码，`spawn('python', ...)` 假设目标机器全局装有 Python 且 pip 装好了 fastapi/uvicorn/sqlalchemy/httpx。**普通用户机器上几乎必挂**，这是发布前必须解决的阻断性问题。

**建议**：用 PyInstaller 把后端打成单文件 exe（`pyinstaller --onefile backend/main.py`），Electron 改为 spawn 该 exe；`electron-builder` 配置中把 exe 放进 `extraResources`，`main.cjs` 中按 `app.isPackaged` 切换路径。

### 4. 固定端口 8765 冲突无回退，且会"静默复用"别人的服务

**位置**：`electron/main.cjs:53-57`

`startBackend()` 检测到 8765 已有健康服务就直接复用。如果占用端口的是上次崩溃残留的进程（`before-quit` 的 `kill()` 在崩溃时不会执行）、或干脆是其他程序，应用会连上错误的数据目录且无任何提示。

**建议**：启动时先检查端口占用者是否为墨境（健康接口加实例指纹，如启动时间戳/pid）；端口被占用时自动递增（8765→8766…）并通过 preload 把实际端口告诉前端，而不是把端口硬编码在 `preload.cjs` 里。

### 5. `set_data_dir` 与在飞请求存在竞态（v2 新增）

**位置**：`backend/app/database.py:138-159`

`set_data_dir` 里有 `_lock`，但 `get_db` 的 session 不走这个锁：在飞请求持有的旧 session 在 `engine.dispose()` 后仍可写完事务（dispose 只归还空闲连接），出现"切换目录后旧库仍被写入"的窗口。单用户下触发概率低，但修法便宜。

**建议**：把 `_lock` 改成读写锁——所有 DB 路由进读锁、`set_data_dir` 进写锁；或给目录切换操作排队，等当前请求排空后再执行。

---

## 二、P1：架构与可维护性

### 6. `App.tsx` 单文件 987 行 / 86KB / 约 50 个组件

**位置**：`src/App.tsx`

所有页面（Projects、Overview、Writing、Characters、Locations、World、Threads、Settings…）、表单、弹窗全在一个文件里，160 处 `useState/useEffect`。这已经是改一处怕全身的状态。

**建议**按页面拆分（工作量中等、收益最大）：

```
src/
  pages/        OverviewPage.tsx, WritingPage.tsx, CharactersPage.tsx ...
  components/   TitleBar.tsx, Sidebar.tsx, Modal.tsx, Field.tsx ...
  hooks/        useWorkspace.ts（把 workspace/reload/patchWorkspace 收进去）
```

### 7. 整本作品全量加载进内存

**位置**：`backend/app/routes.py:193-207`（`_detail`）、`src/workspaceApi.ts:222`（`load()`）

`/api/workspace` 一次返回所有章节的**全文 content** + 全部角色/地点/设定/伏笔。一部长篇（200 章 × 数千字）会是几十 MB 的 JSON，且前端任何小编辑都触发整个 workspace 对象的 React 重渲染。

**建议**：
- 章节列表只返回摘要（id/title/order/word_count/status），正文用 `GET /chapters/{id}` 按需加载——后端这个接口已经存在，前端改掉 `load()` 的用法即可；
- 前端按页面拆分后，用 `React.memo` + 按章节 id 的局部状态隔离重渲染；更彻底的做法是引入 zustand/jotai 做细粒度状态。

### 8. 源码中混入 `\x00` 空字节

**位置**：`src/App.tsx` 共 5 处（如 24572 字节处：`${preferred.title}\x00${preferred.content}`）

作者用空字节当"标题/正文"的拼接分隔符来做脏检查。这导致 git、grep、部分编辑器把整个文件识别为**二进制文件**（本次分析时 ripgrep 就拒绝按文本搜索它），diff、代码审查、全文搜索全部失效。

**建议**：改用转义写法 `'\u0000'`（语义完全相同但源码是 ASCII），或改用不可能出现在文本里的分隔方案（如 JSON 序列化后比较）。

### 9. 无测试、无 lint、无 CI

**位置**：`package.json`（scripts 里无 test/lint）

**建议**（按性价比排序）：
- 后端先加 pytest：`routes.py` 的 CRUD 是纯函数式路由，用 FastAPI TestClient + 临时 SQLite 很容易覆盖；
- 前端加 ESLint + `tsc --noEmit` 进 CI（`build` 已含 tsc，但 dev 流程没有）；
- 后端加 ruff 做格式/静态检查。

---

## 三、P1：后端正确性问题

### 10. `PRAGMA foreign_keys` 未开启（正确性，立即做）

**位置**：`backend/app/database.py:61-64`

SQLite 默认关闭外键约束，`ondelete="CASCADE"` 在 DB 层是哑弹——目前删除章节/小说靠 ORM 层 cascade 兜住，但绕过 ORM 直接操作 DB 时会留下孤儿数据。这是一行代码的正确性修复，与数据量无关，建议立即做：连接后执行 `PRAGMA foreign_keys=ON;`。

### 11. 小逻辑 Bug 清单

| 位置 | 问题 |
|---|---|
| `routes.py:687` | `age = max(0, chapter_count - (int(t.planted_chapter_id and 1) or 0))` 是无效启发式——`planted_chapter_id` 存在时恒为 `chapter_count - 1`，建议改用章节序号差 |
| `routes.py:637` | `_ai_generate_stream` 在生成器内 `_get_novel` 抛 404，但 `StreamingResponse` 已返回 200，错误只会变成一条断掉的流。应在返回 Response 之前校验 novel 存在 |
| `routes.py:585-588` | `create_ai_config` 调用了定义在 630 行的 `update_all_inactive()`（运行时解析虽可用，但 `update_ai_config:601` 又用循环做了同样的事，两处逻辑应统一） |
| `seed.py:89` | 通用工具函数 `count_words` 放在 seed 模块里，被 routes 引用，应移到 `app/utils.py` |
| `models.py:201` | `temperature` 列未显式声明 `Float` 类型（靠 `Mapped[float]` 推断，建议显式） |

### 12. 手写 ORM→响应转换，未用 Pydantic 能力

**位置**：`backend/app/routes.py:60-119`

`_chapter()`、`_novel()`、`_character()` 等 7 个手工构造函数，每加一个字段要改三处（model、schema、构造函数）。`schemas.py` 的响应模型改为 `model_config = ConfigDict(from_attributes=True)` 后可直接 `ChapterResponse.model_validate(c)`，几百行样板代码可删除。

---

## 四、P2：体验与打磨

13. **无全局错误边界**：任一组件抛错整个白屏。包一层 `ErrorBoundary`，配合已有的 `loadError` 重连 UI。
14. **`asar: false`**（`package.json:36`）：打包应开启 asar（配合 PyInstaller 方案后，asar 内只放 JS，exe 走 `extraResources`）。
15. **导出仅 txt/markdown**：可考虑 docx（后端 python-docx）——对小说作者这是高频需求。
16. **`vite.config.ts` 端口 5174 与 `package.json` dev:ui 的 5175 不一致**：`dev:ui` 用 `--port 5175` 覆盖了配置，建议统一删掉一处，避免后来者踩坑。
17. **窗口状态不记忆**：`main.cjs` 固定 1440×900，可用 `electron-window-state` 记住用户调整过的尺寸/位置。

---

## 五、数据量触发项（v2 降级：单用户本地场景下当前无感，达到触发条件再做）

> 评审结论：本地 SQLite + 单用户 + 几百章规模下，以下三项均为亚毫秒~毫秒级开销，**现在不做**。但触发条件现在就写死，避免拖到用户抱怨才想起。

### A. N+1 查询（原 #10）

**位置**：`routes.py:67-76`（`_novel` 每本小说 2 次聚合查询）、`171-174`（`list_novels` 循环调用）
**触发条件**：小说数量 > 20 本，或作品列表页加载可感知变慢。
**做法**：一条 `GROUP BY novel_id` 聚合查询一次算好所有小说的 total_words/chapter_count，Python 侧 join。

### B. 搜索 LIKE 全表扫 → FTS5（原 #11）

**位置**：`routes.py:721-742`
**触发条件**：单库正文总量 > 50MB，或搜索 P95 延迟 > 200ms。
**做法**：建 `chapters_fts` 虚表（title, content）+ 触发器同步；中文用 simple 分词或按字建索引。

### C. SQLite WAL 模式（从原 #12 拆出）

**位置**：`database.py:61-64`
**触发条件**：出现并发读写需求（如后台 AI 任务与前台写作并行）或崩溃后恢复时间可感知。
**做法**：连接后执行 `PRAGMA journal_mode=WAL;`。
**注意**：同处还有"外键列缺索引"（所有 `novel_id`/`chapter_id` 列，SQLite 不自动给外键建索引），可并入本项一起做，均为一行级改动。

---

## 建议实施顺序（v2 更新）

| 阶段 | 内容 | 理由 |
|---|---|---|
| 第一步 | #3 打包 Python → exe | 不解决就无法分发给真实用户 |
| 第二步 | #1 鉴权 + Key 不下发（含 dev 折中）、#2 版本节流 + AI 取消、#5 set_data_dir 读写锁 | 数据与资产安全；#5 改动小顺带做 |
| 第三步 | #10 foreign_keys（一行修复）、#11 小 Bug 清单 | 正确性，成本极低 |
| 第四步 | #6 App.tsx 拆分 + #7 章节懒加载 | 后续所有功能迭代的地基 |
| 第五步 | #9 测试体系、#12 Pydantic 清理 | 降本增效 |
| 第六步 | #13~#17 体验项 | 锦上添花 |
| 触发式 | 附录 A/B/C | 达到触发条件再动 |
