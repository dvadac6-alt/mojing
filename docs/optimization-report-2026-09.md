# 墨境项目优化审查报告（2026-09-03）

> 审查范围：`src/` React/Vite 前端、`backend/app/` FastAPI/SQLAlchemy/SQLite 后端、`electron/` 桌面壳、CI 与打包配置。  
> 审查依据：当前工作树代码、已有 v3/v4/v5 优化文档、静态检查与构建结果。

## 1. 结论摘要

项目已经从“功能验证期”进入“可持续使用期”：Electron + React + FastAPI + SQLite 的主链路完整，鉴权、密钥加密、自动备份、版本快照、RAG、AI 流式输出、错误边界、懒加载和自动更新等基础能力已经落地。当前最值得投入的不是继续堆功能，而是控制大数据量和慢外部服务下的响应时间，并提高缓存、后台任务和发布环境的一致性。

当前建议按以下顺序推进：

| 优先级 | 主题 | 主要收益 | 建议周期 |
|---|---|---|---|
| P0 | 搜索/导出/前情提要的内存与结果上限 | 防止大作品拖垮后端或界面 | 1-2 天 |
| P0 | RAG 重建、资料导入、角色重扫改后台任务 | API 不再被外部 embedding 或全书扫描阻塞 | 3-5 天 |
| P1 | 缓存一致性与请求取消 | 切换作品、快速切页时减少旧数据覆盖 | 1-2 天 |
| P1 | 数据库复合索引、并发序号与迁移测试 | 大数据量下稳定、避免边界竞态 | 1-2 天 |
| P1 | 上传/导出/导入流式化与文件校验 | 降低内存峰值，提高文件安全性 | 2-3 天 |
| P2 | 开发环境、类型生成、CI 与可观测性 | 降低新机器和发布回归成本 | 2-3 天 |

## 2. 已完成能力与总体评价

以下能力在当前代码中已有实现，后续文档不再重复作为“待办”：

- `database.py` 已启用 SQLite 外键、WAL、读写锁和数据目录切换；`backup.py` 提供在线备份与滚动备份。
- `/workspace` 已返回章节摘要而非正文；实体列表由 `useEntityList` 按需加载；前端路由已做 `React.lazy` 分包。
- 地图涂鸦已拆为 `map_strokes` 增量写入，并使用双 canvas 分层绘制。
- AI key 只写入加密值，AI 流式错误会透传；Electron 已有 CSP、导航拦截、子进程清理、窗口状态和自动更新。
- 前端 `typecheck`、`lint`、`build`、`test:ui` 本次均通过；后端测试命令在本机因 `.venv` 的 uv trampoline 返回 `permission denied (os error 5)` 未能启动 Python，不能据此判断后端测试结果。

## 3. P0：大数据量与慢任务

### 3.1 搜索接口没有结果上限，且读取了所有正文

**证据**：`backend/app/routers/novels.py:336-345` 对 `Chapter.content` 使用 `LIKE`，没有 `LIMIT`；随后 `:361-364` 为每个命中章节生成摘要。语义搜索还会额外加载整本小说的章节元数据（`:383-386`）。

**风险**：搜索词常见时，数百章正文会一次性进入 Python 内存和 JSON 响应；用户搜索时可能出现明显卡顿，极端情况下造成进程内存峰值。

**方案**：

1. 增加 `limit`（默认 50，最大 200）和 `offset` 或游标参数，响应返回 `has_more`。
2. LIKE 路径使用 `load_only(id, title, order, word_count)`，命中正文改为按命中 id 二次查询并只取固定长度 snippet。
3. 当正文规模达到阈值（建议单库 20-50 MB）时引入 SQLite FTS5；保留 LIKE 作为迁移/降级路径。
4. 对 `q` 做 Unicode 归一化和长度上限，避免超长查询字符串放大 SQL 与响应。

**验收**：10,000 章、单章 100 KB 的测试库中，搜索响应始终不超过 200 条，正文峰值内存不随总章节数线性增长；P95 < 300 ms（未启用 embedding 时）。

### 3.2 前情提要和风格画像仍按请求同步扫描大文本

**证据**：`backend/app/routers/chapters.py:308-325` 的 recap 读取整本小说章节并保留正文 ORM 字段，`backend/app/routers/novels.py:417-431` 的 style profile 最多同步读取 500 章全文。

**方案**：

- recap 先只读 `id/order/title/summary`，仅对最近两章单独查询 `content`；给 recap 设最大章节数和最大字符数。
- style profile 改为后台任务或分批处理，记录 `job_id/status/progress/error`，前端轮询；任务期间允许取消。
- 对章节摘要增加“正文版本号/更新时间”，只重新计算过期摘要，避免每次全量扫描。

**验收**：recap 在 10,000 章数据下读取行数与“最近两章 + 摘要”成正比；style profile 请求立即返回任务 id，UI 不再长时间 loading。

### 3.3 RAG 重建与资料导入占用请求线程

**证据**：`backend/app/routers/rag.py:28-32` 直接调用 `rag_indexer.rebuild_all`；`backend/app/services/rag/indexer.py:112-133` 一次加载所有章节、资料文档和已有块，并在循环内调用 embedding API。资料导入（`rag.py:72-100`）也会在请求期间切块并请求 embedding。

**风险**：外部 API 慢、网络失败或作品较大时，请求会持续数分钟；SQLite 写锁和连接占用会影响正常写作。重建中途进程退出也可能留下“部分新索引”。

**方案**：

- 新增轻量任务表或内存任务管理器：`POST /rag/rebuild` 立即返回 `job_id`，提供状态、进度、错误和取消接口。
- 任务分批读取（每批 50-200 章/文档），embedding 批量调用；每批事务提交，并写入 `embedding_model`。
- 使用临时索引版本（如 `index_generation`）或 staging 表，完成后原子切换，避免检索看到半成品。
- 资料导入先保存文档元数据和原文文件/临时内容，再异步切块；失败状态可重试，不重复创建文档。

**验收**：重建接口 1 秒内返回；前台写作请求不被重建阻塞；任务失败可重试且不会产生重复 chunk；进度可恢复或明确标记失败。

### 3.4 角色登场重扫为同步全量操作

**证据**：`backend/app/routers/entities.py:30-40`、`:49-56`、`:117-120` 在角色创建、更新、删除时调用 `rescan_novel`；`backend/app/services/presence.py:65-71` 遍历小说所有章节，并对每章重新读取所有角色。

**方案**：

- 角色修改时创建可合并的后台 rescan 任务，同一 `novel_id` 只保留一个 pending 任务。
- 保存正文时继续只扫描当前章节；角色变更完成后在后台全量重扫。
- 为 `character_appearances` 增加扫描版本/时间戳，UI 显示“结果可能正在更新”。
- 角色名很多时，构造一次编译后的匹配器，避免每章重复排序和字符串替换。

**验收**：角色编辑接口不因章节数增长而变慢；任务可见、可重试；扫描完成前旧结果仍可读。

## 4. P1：数据一致性、并发与缓存

### 4.1 `useEntityList` 是无 TTL、无订阅的模块级缓存

**证据**：`src/hooks/useEntityList.ts:11-23` 使用全局 `Map`；`:35-47` 请求完成后直接写入缓存；`:59-65` 的 `patch` 只更新当前 hook 的 React state。缓存没有 TTL、版本号或订阅通知。

**风险**：一个页面修改实体后，另一个已挂载页面可能继续显示旧列表；切换作品再切回时可能永久复用旧数据；并发 refresh 与 patch 的完成顺序可能让旧响应覆盖新状态。

**方案**：

- 引入 TanStack Query，或将现有缓存改为 `items/promise/updatedAt/version/subscribers`。
- mutation 成功后按 key 广播更新或使查询失效；请求携带递增 request id，只接受最新响应。
- 默认 TTL 30-120 秒，窗口重新获得焦点时后台刷新；切换数据目录、导入和删除作品时全量失效。
- 列表接口统一返回 `updated_at` 或资源版本，必要时使用 ETag/If-None-Match。

**验收**：快速连续切换作品、连续编辑同一实体 20 次，最终 UI 与数据库一致；旧请求返回不能覆盖新数据；页面切换不产生重复请求。

### 4.2 地图笔画序号存在并发竞态

**证据**：`backend/app/routers/maps.py:115-123` 先查询 `max(MapStroke.seq)+1`，再插入；`MapStroke` 没有 `(map_id, seq)` 唯一约束。

**风险**：两个请求同时落笔时可能得到相同 `seq`，撤销或排序结果不稳定。

**方案**：增加 `UniqueConstraint("map_id", "seq")`；插入失败捕获 `IntegrityError` 后重试，或使用 SQLite 事务锁/单调 ID 作为排序键。为迁移脚本补已有重复序号修复。

### 4.3 索引覆盖不完整

**证据**：常用实体的 `novel_id` 已有索引，但 `DocumentChunk` 的删除条件是 `(source_type, source_id)`，检索还按 `(novel_id, source_type, embedding_model)` 过滤；`AIUsage` 只有 `(novel_id, created_at)`，跨作品统计 `:783-786` 主要按 `created_at`。

**方案**：补充并验证以下复合索引：

- `document_chunks(source_type, source_id)`；
- `document_chunks(novel_id, source_type, embedding_model)`；
- `document_chunks(novel_id, source_type, chunk_index)`；
- `ai_usage(created_at)` 或 `(created_at, model)`；
- `character_appearances(character_id, chapter_id)`（与唯一约束的查询方向匹配）。

用 `EXPLAIN QUERY PLAN` 固化关键查询，迁移执行后运行一次 `ANALYZE`。

## 5. P1：文件 I/O、上传与导出

### 5.1 导出 ZIP 在内存中构建完整副本

**证据**：`backend/app/routers/system.py:248-276` 用 `io.BytesIO()` 将整个数据目录压缩后再返回。

**风险**：大型数据库、封面和地图图片会造成“数据库大小 + ZIP 大小”的额外内存峰值。

**方案**：先写入数据目录旁的临时文件，再用 `FileResponse` 返回并在响应结束后清理；或使用可迭代的临时文件流。WAL checkpoint、压缩和文件枚举放到线程池，避免阻塞事件循环。

### 5.2 图片上传虽有限额，但仍整块读入内存且只信任 Content-Type

**证据**：`backend/app/routers/novels.py:199-228`、`backend/app/routers/maps.py:205-230` 使用 `await request.body()`，并依据请求头选择扩展名。

**方案**：流式写临时文件，超过 12 MB 立即中止；使用图片 magic bytes/Pillow 校验真实格式和像素尺寸，拒绝伪装文件；写入完成后 `os.replace` 原子替换，避免进程中断留下半文件。

### 5.3 导入临时目录命名可能冲突，压缩包校验还应覆盖符号链接

**证据**：`backend/app/routers/system.py:320-322` 以 `int(time.time())` 命名导入目录；`:300-322` 校验路径和大小后直接 `extractall`。

**方案**：使用 `tempfile.mkdtemp` 或 UUID；拒绝 ZIP 符号链接条目；对每个成员解析 `target / member` 的真实路径，确认仍位于目标目录；校验成功后再原子改名。

## 6. P2：工程化与发布

### 6.1 开发脚本依赖仓库内 `.venv`，与 CI/新机器不一致

**证据**：`package.json:9,14,17-18` 固定调用 `.venv\\Scripts\\python.exe`；CI 则使用 `python -m pytest`。本机本次运行后端测试即因该解释器的 uv trampoline 权限错误失败。

**方案**：

- 提供 `scripts/check-env` 或 `npm run doctor`，启动前检查 Node/Python/依赖和可执行权限。
- 使用跨平台 `python`/`py -3` 入口，或由脚本自动选择 `.venv`、系统 Python；不要把 Windows 路径写死在 npm script。
- CI 增加 `npm run doctor`、打包冒烟和最小 API health/auth 测试；本地保留明确的 venv 创建命令。

### 6.2 OpenAPI 类型生成尚未成为构建门禁

**证据**：`package.json:23` 提供 `gen:types`，但生成文件被删除且 `workspaceApi.ts` 仍维护大量手写接口类型。

**方案**：将类型生成放入可复现流程：启动临时后端 → 生成到 `src/api-types.ts` → `git diff --exit-code` 检查 schema 漂移；或者直接使用生成类型封装 `request`。至少为高风险请求体（AI、存储、地图笔画、导入导出）去掉 `Partial<T>`，改成精确 DTO。

### 6.3 Electron 后端启动失败时可能遗留子进程

**证据**：`electron/main.cjs:137-161` 的 `trySpawn` 在 `waitForBackend` 失败时直接 `resolve(false)`，没有显式终止本次已启动的 `backendProcess`，随后 `startBackend` 会尝试下一个端口。

**方案**：失败分支中终止并等待子进程退出，清空 `backendProcess`；为每次尝试绑定一次性 `exit/error` 监听并设置超时。增加“端口被占用、后端启动失败、健康检查超时”的自动化测试。

### 6.4 错误日志与指标需要脱敏和结构化

当前已有滚动文件日志，但 AI/RAG/上传失败日志后续应统一事件字段：`operation`, `novel_id`（可哈希）, `duration_ms`, `status`, `error_code`。禁止记录 API key、完整 prompt、正文和上传文件内容。可增加本地诊断导出，默认不联网。

## 7. 推荐实施路线

### 第 1 周：先控制风险

1. 给搜索、recap、style profile、版本列表和所有可增长列表加上限与分页。
2. 修复导出内存峰值、图片流式上传、导入 UUID 临时目录。
3. 增加地图 `(map_id, seq)` 唯一约束及复合索引迁移。
4. 为以上行为补后端测试和 10,000 章/大文件性能夹具。

### 第 2 周：后台任务与缓存

1. 落地 RAG 重建/资料导入/角色重扫任务模型、状态查询和取消。
2. 将 `useEntityList` 改为可失效、可订阅、带 TTL 的查询缓存。
3. 增加请求竞态测试、任务失败重试测试和应用退出测试。

### 第 3 周：工程化收口

1. 统一 Python 启动方式并增加 `doctor`。
2. 将 OpenAPI 生成与漂移检查接入 CI。
3. 补 Electron 后端启动失败清理、发布包冒烟、升级回滚演练。
4. 以真实作品数据记录搜索、保存、AI 首字节、RAG 检索 P50/P95，形成基线。

## 8. 建议新增的质量门禁

| 门禁 | 目标 |
|---|---|
| `typecheck` + `lint` + `test:ui` + `build` | 每个 PR 必须通过 |
| 后端 pytest（含临时 SQLite） | 覆盖鉴权、迁移、备份、版本、导入安全、分页和任务状态 |
| API 性能夹具 | 搜索/recap/列表 P95 与响应大小有上限 |
| 端到端冒烟 | 启动、建作、保存、切换、AI 失败重试、导入导出、退出清理 |
| 数据兼容测试 | 旧 schema、旧 `doodles`、旧明文 key 均可迁移或给出可恢复错误 |
| 依赖与打包检查 | `npm audit`/pip 依赖锁定、PyInstaller 资源完整、安装包可启动 |

## 9. 本次验证记录

- 通过：`npm run typecheck`
- 通过：`npm run lint`
- 通过：`npm run test:ui`（21 项）
- 通过：`npm run build`
- 未完成：`npm run test:backend`。当前机器执行 `.venv\\Scripts\\python.exe` 时，uv trampoline 报 `permission denied (os error 5)`；应先修复虚拟环境解释器权限，再重新运行后端测试，不能将本次失败归因于业务代码。

