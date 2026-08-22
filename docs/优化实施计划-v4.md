# 墨境 · 优化实施计划 v4

> 基于 v3 之后新增功能（多地图 + 涂鸦 + 地形命名 + 桌面打包）的代码审查。
> 本文档既是优化建议清单，也是后续迭代的实施依据。每项含**现状 / 问题 / 方案 / 工作量 / 收益**。

---

## 一、优化项总览

| 编号 | 优化项 | 优先级 | 工作量 | 收益 |
|---|---|---|---|---|
| #1 | 涂鸦数据全量传输 → 增量 API | 🔴 高 | 中 | 涂鸦多了保存不卡 |
| #2 | workspace 全量加载 → 分页懒加载 | 🔴 高 | 大 | 首屏/切换明显变快 |
| #3 | N+1 查询清理 | 🔴 高 | 小 | 列表加载提速 |
| #4 | 地图画布分层离屏渲染 | 🟡 中 | 中 | 大量笔画拖动不卡 |
| #5 | 编辑器大文本性能 | 🟡 中 | 中 | 几十万字章节输入流畅 |
| #6 | API 类型自动同步 | 🟡 中 | 小(配置) | 前后端类型不再漂移 |
| #7 | AI 调用健壮性 | 🟡 中 | 中 | 减少误判"不可用" |
| #8 | 跨设备同步 / 迁移 | 🟢 低 | 大 | 换电脑一键迁移 |
| #9 | 工程化（测试/CI/上报） | 🟢 低 | 大 | 长期质量保障 |
| #10 | UI/UX 细节（快捷键/a11y/暗色） | 🟢 低 | 中 | 体验提升 |

---

## 二、高优先级详解

### #1 涂鸦数据全量传输 → 增量 API

**现状**
`StoryMap.doodles` 是一个 JSON 列，存所有笔画 `[{color,width,eraser,points:[[x%,y%],...]}]`。
前端每画完一笔 `PUT /maps/{id}` 传**全部笔画**；撤销/清空也是全量。

**问题**
- 涂鸦 N 笔后，每次保存传输 O(N) 数据，写库也是整列重写
- 笔画多时（地形复杂的手绘地图）保存明显变慢
- 并发编辑风险：全量覆盖会丢别人的笔画

**方案**
新建 `map_strokes` 表，每笔一行：
```
map_strokes: id, map_id(FK CASCADE), color, width, eraser(BOOL),
             points(JSON), seq(INT), created_at
```
端点改为增量：
- `POST /maps/{map_id}/strokes` → 追加一笔，返回新 stroke
- `DELETE /maps/{map_id}/strokes/last` → 撤销最后一笔
- `DELETE /maps/{map_id}/strokes` → 清空
- `GET /maps/{map_id}/strokes` → 列出全部（地图加载时）

前端：`strokeRef` 提交时只发当前一笔；撤销/清空调对应端点。
迁移：`init_db` 里把历史 `story_maps.doodles` JSON 拆入 `map_strokes`，然后该列废弃。

**工作量**：后端 ~120 行（模型+schema+端点+迁移），前端 ~60 行。独立、低风险。

**收益**：保存复杂度从 O(N) 降到 O(1)；为后续多人/多端协同打底。

---

### #2 workspace 全量加载 → 分页懒加载

**现状**
`GET /api/novels/{id}` 一次返回所有章节（含正文）、角色、地点、世界观、伏笔、关系。
随数据增长，首屏和每次 `reload()` 越来越慢（用户反馈过"读取特别慢"）。

**问题**
- 单次响应体可达 MB 级，解析+渲染阻塞
- 改一个角色触发整个 workspace reload，浪费

**方案**
- workspace 端点瘦身：只返回**元数据**（章节标题/计数、各实体数量、小说信息）
- 章节正文已按需加载（`getChapter`），保持
- 各列表页（角色/地点/伏笔/世界观）改为各自拉取 list 端点（已存在）
- 前端引入轻量缓存（SWR 或自写 `useApi` hook），避免重复请求

**工作量**：大。触及所有页面的数据来源，需逐页改造 + 回归测试。建议单独一个迭代周期。

**收益**：首屏 < 200ms（从秒级），切换流畅。

**风险**：影响面广，需充分回归。**建议作为下一阶段专项，本次不做。**

---

### #3 N+1 查询清理

**现状**
- list 端点逐行 `model_validate`，关系字段触发懒加载（每行一次查询）
- 前端 `locations.filter(l => l.parent_location_id === id)` 每个节点全表扫

**问题**
数据量上千时查询次数爆炸，列表加载慢。

**方案**
- 后端 list 端点加 `selectinload`/`joinedload` 预加载关系
- 前端建 `Map<id, entity>` 索引，O(1) 查父子关系

**工作量**：小。每个 list 端点加一行 `options`。

**收益**：列表查询从 O(N) 次 SQL 降到 1~2 次。

---

## 三、中优先级详解

### #4 地图画布分层离屏渲染

**现状**：`redraw()` 每帧重画**全部笔画**（含拖动中）。涂鸦几十笔后拖动卡顿。

**方案**：双 canvas 分层——底层离屏缓存已保存笔画（仅在 strokes 变化时重绘），顶层只画当前进行中的 stroke。每帧 = `drawImage(底层) + drawStroke(当前)`。

### #5 编辑器大文本性能

**现状**：transparent textarea + backdrop div，每输入一字重算分页 + 高亮。几十万字时输入延迟。

**方案**：
- backdrop 高亮只在 AI 补写时重算，普通输入跳过
- 分页 debounce 已有（300ms），可进一步：输入时不重算 backdrop
- 超大章节评估 Monaco/CodeMirror 6（成本高，后期再说）

### #6 API 类型自动同步

**现状**：前端 `workspaceApi.ts` 手写类型，后端 Pydantic 改了前端易漏（如 `map_id` 要前后端各改）。

**方案**：`openapi-typescript` 从 FastAPI `/openapi.json` 生成 `src/api-types.ts`，前端引用生成的类型。一次 schema 变更自动同步。

### #7 AI 调用健壮性

**现状**：流式失败无重试；first-token 延迟 20-30s 时用户以为"不可用"。

**方案**：
- 首字超时 30s → 自动重试 1 次（退避）
- 失败明确提示 + 手动重试按钮
- 埋点单次调用耗时，定位慢请求

---

## 四、低优先级详解

### #8 跨设备同步 / 迁移
- 一键导出/导入 `墨境数据/` 压缩包（最简，优先做）
- WebDAV/对象存储加密增量同步（复杂，后期）
- 作品快照 diff（chapter_versions 已有基础）

### #9 工程化
- 前端测试：Playwright（交互）+ Vitest（逻辑），关键路径覆盖
- CI/CD：GitHub Actions 跑 tsc + pytest + 打包，tag 触发 Release（electron-updater 已配）
- 错误上报：本地日志文件 + 可选匿名上报

### #10 UI/UX
- 键盘快捷键：Ctrl+S 保存、章节切换、AI 补写
- 可访问性：图标按钮 `aria-label`、Tab 导航
- 暗色模式（长时间写作护眼）
- 空状态引导文案 / 示例数据

---

## 五、实施进度（持续更新）

### ✅ 已完成（7 项）

| # | 优化项 | 提交 | 要点 |
|---|---|---|---|
| #1 | 涂鸦增量 API | `1bd2f72` | `map_strokes` 表，一笔一行，append/undo/clear O(1) + 历史迁移 |
| #3 | N+1 查询清理 | `741f597` | 前端 parent→children Map（O(N²)→O(N)）；后端 list_novels 单次聚合 |
| #4 | 画布分层渲染 | `83d2fe5` | base/live 双 canvas，拖动每帧 O(1) 不重画全部笔画 |
| #6 | API 类型同步 | `48f47d4` | `npm run gen:types` 从 OpenAPI 生成 `src/api-types.ts`（基础设施） |
| #7 | AI 调用健壮性 | `05cfe33` | 错误透传（不再吞 429/401/超时）+ read timeout 90s + 首字重试 + 计时反馈 |
| #8 | 跨设备导出/导入 | `08b7ac6` | `/storage/export`+`/storage/import`，一键 zip 迁移换电脑 |
| #10 | 写作快捷键 | `343d007` | Ctrl+S 保存、Ctrl+Enter 触发 QuickAI |
| #5 | 编辑器大文本性能 | 见本次 | measureTextHeight 复用持久 probe（消除每次 create/destroy DOM，分页测量 ~320 次→只 set value）；renderBackdrop useMemo（backdrop 只在翻页/AI 补写时重算） |

### ⏸️ 待实施

| # | 优化项 | 状态 | 备注 |
|---|---|---|---|
| #2 | workspace 懒加载 | ✅ 已完成（见第九节） | 瘦身 + useEntityList 缓存 + 10 页面迁移，全部落地 |
| #9 | 工程化（测试/CI/上报） | ✅ 已完成（见第九节） | 前端 node:test 16 项；CI 补 build/test:ui + 发布工作流；后端滚动文件日志 |
| #10 | 暗色模式 / 空状态 / a11y | ✅ 已完成 | 暗色模式此前已就绪；空状态各页已有；本轮补齐 icon-only 按钮 aria-label |

---

## 六、实施路线图

```
✅ #1 涂鸦增量 API
✅ #3 N+1 查询清理
✅ #4 画布分层渲染
✅ #6 API 类型同步（基础设施）
✅ #7 AI 调用健壮性
✅ #8 跨设备导出/导入
✅ #10 写作快捷键
✅ #5 编辑器大文本性能（measure probe 复用 + backdrop memo）
✅ #2 workspace 懒加载（slim workspace + 实体按需拉取，见第九节）
✅ #9 工程化（前端测试 / CI / 发布工作流 / 文件日志）
✅ #10 剩余（a11y 补齐）
```

> 低风险高收益的优化已全部完成。剩余项均为大重构（#2）或工程化（#9），建议按专项推进，每个单独周期 + 充分回归。


---

## 七、v5 全量修复（2026-08-22，前后端深度审查后的批量落地）

> 本轮为新一轮全代码审查（前端 src/ + electron/、后端 app/ 全量）后的批量修复，pytest 17 项 + 端到端冒烟（保存/版本/回滚/AI 流/activity/导入导出/搜索/RAG 配置）全部通过，typecheck/lint/build 通过。

### 数据正确性（最高优先级）
- ✅ **切页/关窗丢字**：写作页卸载与 beforeunload 兜底落盘（keepalive），切换作品时同样先补存（`WritingPage.tsx`）
- ✅ **Ctrl+S 双监听**：删除重复注册，一次按键不再触发两次并发 PUT
- ✅ **storage.json 覆写丢 token**：`_write_config`/`reset_data_dir` 改读-改-写，切数据目录后令牌保持稳定
- ✅ **AI 生成双倍准备**：`_prepare_generation` 只在同步路由（线程池）执行一次，结果传入流式生成器；同时消除了 async 生成器内同步 embedding HTTP 阻塞事件循环的问题
- ✅ **python-dotenv 隐式依赖**：补进 requirements.txt 与 PyInstaller hiddenimports

### 性能
- ✅ RAG 重索引节流：自动保存（~1次/秒）不再每次全量重切+调 embedding API，30s 节流 + 延迟补一次（后台线程）
- ✅ activity/版本列表/_detail/search 大文本列全部 `load_only`/`defer` 排除（此前每次请求把全书正文载入内存）
- ✅ `/storage/import` 流式落盘 + 边收边限额（1GB 不再整体驻留内存），解压移入线程池
- ✅ 版本列表只回元数据（全文仅在回滚时服务端自查）+ limit 分页参数
- ✅ RAG 检索 defer(text)：打分只载入向量，命中后再取块文本；rebuild_all 的 rag_config 查询 N+1 消除
- ✅ 每日备份移出请求路径（后台线程）
- ✅ 前端：React.lazy 路由级代码分割（主 bundle 大幅瘦身）+ react 独立 chunk；AI 等待计时隔离为 memo 小组件（不再 500ms 重渲染整页编辑器）；ModelSelect 请求缓存（TTL 去重）；EdgeOverlay 坐标浅比较 + rAF 节流；GraphCanvas/MindMap/ThreadsPage 的 O(N) 查找改 Map 索引；SettingsPage/LibraryPage 串行请求并行化
- ✅ HTTP 层默认 30s 超时（慢端点显式加长），后端卡死不再无限转圈

### 安全与健壮性
- ✅ Electron：生产构建注入 CSP meta；`setWindowOpenHandler` 拒绝 + `will-navigate` 拦截（外部链接转系统浏览器）；后端子进程退出兜底（exit/信号），不再产生孤儿进程
- ✅ token 校验改 `secrets.compare_digest`；mock 提供方 hash→crc32（跨进程确定性）
- ✅ 三个裸 dict 请求体（storage/path、rag/config、rag/config/test）改 Pydantic 模型
- ✅ 错误处理补齐：listVersions 失败不再永久 loading、removeMap 失败不再卡确认态、switchNovel/createMap/uploadBackground 等静默失败全部接 toast；删除「恢复默认」路径补确认弹窗
- ✅ sqlite 备份连接 try/finally（Windows 句柄泄漏）；chunker 逐字符拼接 O(n²) 改切片；`datetime.utcnow()` 弃用告警清零；关键静默 except 补 logging

### 功能修复
- ✅ 搜索框接通：章节目录（按标题）、角色、地点（搜索时扁平展示命中）、命令面板（实时过滤 + 移除未实现的快捷键提示文案）
- ✅ 角色关系图预览改用真实数据（共同伏笔连线，规则与大纲页一致），删除硬编码演示数据与假「适应画布」按钮
- ✅ 修正 AI 面板「90 秒自动重试」的不实文案（实际无自动重试）

### 明确不做（维持 v4 结论）
- ⏸️ workspace 懒加载专项（#2）、routes.py 拆分、表单弹窗抽象：结构性大重构，仍按专项推进
- ⏸️ `/api/health` 下发 token：README 已记录的接受权衡；收紧会破坏 Electron 的「复用已运行后端」流程（后端可能启动超过 60s 握手窗口），需与桌面壳读 storage.json 的方案 A 一并设计

---

## 八、v5 续：遗留项收尾（2026-08-22 第二批）

> 上轮"明确不做"清单中的可行项已落地；唯一保留的 workspace 懒加载见文末说明。pytest 17 项 + 全模块端点冒烟 + 真实服务器验证 + typecheck/lint/build 全部通过。

### 安全（README 已同步更新）
- ✅ **`/api/health` 不再下发 token（#7 方案 A 落地）**：token 由后端在 lifespan 启动时持久化到 `storage.json`；Electron 主进程确认端口指纹后直接读该文件（`backendConfigPath()` 与后端 `_resolve_config_path` 镜像，含生成后短暂轮询）。真实服务器验证：health 响应无 `auth_token`，storage.json 启动即含 token。本机任意进程 curl 开放端点不再能拿到令牌。

### 结构
- ✅ **routes.py 拆分**（2163 行 → `app/routers/` 8 个领域模块）：helpers / system（health+storage+备份+导入导出）/ novels（含搜索、activity、导出）/ chapters（含 scenes、graph edges、RAG 节流）/ entities / maps / ai / rag。`app/routes.py` 保留为兼容 shim（测试与 main.py 的导入不变）。拆分后 96 条路由与拆分前一致，全模块冒烟通过。
- ✅ **表单弹窗去重**：新增 `FormFooter`（note/extra 按钮位/错误/取消/提交/自定义禁用），替换 9 处复制粘贴的表单底栏（角色/地点/设定/伏笔/作品/RAG 配置/模型/大纲节点/资料导入）。

### 性能与体验
- ✅ 概览页 activity/usage 加 60s 时间窗缓存（切页往返不再重复请求）
- ✅ 作品列表单一数据源：ProjectsPage 复用 App 持有的 novels（此前同一数据两份 state、两次请求）
- ✅ 写作页脏检查改对象比较（两个 `===` 短路），消除每键一次的整章签名拼接
- ✅ TitleBar 最大化状态改主进程事件推送（去掉每个 resize tick 的同步 IPC）
- ✅ 删除未被引用的 `src/api-types.ts`（4382 行生成产物，`npm run gen:types` 可再生）

### 本轮仍保留
- ⏸️ **workspace 懒加载专项（#2）**：其主要动机（workspace 携带全部章节正文）已由 `load_only` 消除；剩余收益（实体列表分页拉取 + patchWorkspace 全面乐观更新）需补 3 个 list 端点并迁移 10 个页面，维持"专项推进"结论。
- ⏸️ 写作页章节列表 memo：需要把 selectChapter 重写为纯 ref 驱动的稳定回调才能生效，收益（几十个小按钮的重渲染）不抵引入的间接层，暂缓。


---

## 九、v6：v4 计划收尾（2026-08-22 第三批，#2/#9/#10 全部落地）

> 按本文档第五节"待实施"清单完成。验证：pytest 17 项、前端 node:test 16 项、workspace 形状冒烟、
> 真实浏览器全页走查（概览/角色/伏笔/大纲/关系图/地图/写作）、typecheck/lint/build 全绿。

### #2 workspace 懒加载（专项完成）
- **后端**：`GET /workspace` 与 `GET /novels/{id}` 瘦身为 `novel + chapters(元数据) + counts`（角色/地点/设定/伏笔/未收束等 8 项计数）；新增 `GET /novels/{id}/chapters|scenes|graph-edges` 三个独立列表端点（补齐调研时记录的阻塞点）。
- **前端**：新增 `useEntityList` hook——按 (novelId, kind) 键控的模块级缓存 + 请求去重；角色/地点/设定/伏笔/场景/连线六类实体由各页按需拉取，跨页共享。
- **10 页面迁移**：概览/角色/地点/世界观/伏笔/大纲（含 MindMap 签名改造）/地图/设置/侧栏/状态栏。mutations 改为 patch（接口返回新实体），仅影响计数的增删补一次轻量 reload——"改一个角色不再整包重拉 workspace"。
- 浏览器实测：新建角色列表即时出现且侧栏计数同步、伏笔状态推进即时移列、地图 8 标记、大纲双关系图 6+6 节点、写作页 6 章节正常。

### #9 工程化
- **前端测试**：4 个纯函数抽到 `src/lib/`（graph/parseSetting/mapLayout/stats），node:test + Node 24 类型剥离，16 个用例零依赖运行（`npm run test:ui`）。
- **CI**：分支修正为 master、Node 24、新增 test:ui 与 build 步骤；新增 `release.yml`（tag `v*` 触发 → PyInstaller 后端 + electron-builder → GitHub Releases，electron-updater 自动更新链路就位）。
- **错误上报（本地日志）**：后端启动时挂 RotatingFileHandler（`DATA_DIR/logs/mojing.log`，2MB×3），此前 RAG/备份/用量落库的静默失败从此有迹可查；导出 zip 排除 logs 目录。

### #10 a11y
- PaneHead 新建按钮、写作页工具栏、地图页（新建/删除地图/撤销/清空/关闭详情/删颜色）等 icon-only 按钮补齐 aria-label；伏笔卡片"更多操作"此前已补。

### 至此
v4 计划中列出的全部优化项（#1–#10）均已落地。后续新增需求按第十节（v5/v6）节奏追加记录。
