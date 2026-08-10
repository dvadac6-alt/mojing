# 墨境（InkForge）项目优化建议 v3

> 分析时间：2026-08-10 ｜ 范围：前端（React/Vite）、后端（FastAPI/SQLite）、桌面壳（Electron）、打包配置
>
> v3 说明：v2 建议的 17 项中 **13 项已完整落地、1 项部分落地**，本文档先给出核对结果，再列出**剩余的 4 项**与**新发现的 6 项**。项目当前已无 P0 级安全/数据阻断问题，优化重心从"救火"转向"防灾与降本"。

---

## 〇、v2 落地情况核对

| v2 编号 | 事项 | 状态 | 证据 |
|---|---|---|---|
| #1 | 鉴权 + CORS 收窄 + Key 加密不下发 | ✅ 已完成 | `main.py:19-95`（白名单 + TokenAuthMiddleware + dev 折中）、`security.py`（Fernet 加密 + mask_key）、`routes.py:157-163`（只回 has_key/key_hint） |
| #2 | 版本节流 + 上限 + AI 取消 | ✅ 已完成 | `routes.py:184-225`（节流窗口 + auto 版本滚动清理 + label 版本永生）、`workspaceApi.ts:217-227`（AbortSignal） |
| #3 | PyInstaller 打包 exe | ✅ 已完成 | `package.json:14,40-42`（backend:dist + extraResources）、`main.cjs:66-74` |
| #4 | 端口指纹 + 递增 + 动态注入 | ✅ 已完成 | `main.cjs:16-93`（app/pid/started_at 指纹、8765→8784 扫描、IPC 下发实际端口） |
| #5 | set_data_dir 读写锁 | ✅ 已完成 | `database.py:42-108`（_ReadersWriterLock）、`167-177`（get_db 持读锁）、`242-267`（切换持写锁） |
| #6 | App.tsx 拆分 | ✅ 已完成 | App.tsx 从 987 行降至 105 行，pages/ 11 个页面 + components/ + hooks/ |
| #7 | 章节懒加载 | ✅ 已完成 | `routes.py:86-89,305`（ChapterSummary 不含正文）、`WritingPage.tsx:131`（getChapter 按需取全文） |
| #8 | 源码空字节 | ✅ 已完成 | 全量二进制扫描 0 处 `\x00`（WritingPage 改用 SIG_SEP 常量） |
| #10 | PRAGMA foreign_keys | ✅ 已完成 | `database.py:157-164`（含引擎重建后重新绑定，`261` 行） |
| #11 | 小 Bug 清单 | ✅ 已完成 | temperature 显式 Float（models.py:242）、count_words 移入 utils.py、流式 404 前置校验（routes.py:873）、重复逻辑已统一 |
| #12 | Pydantic from_attributes | ⚠️ 部分 | schemas.py:8 基类已配 ConfigDict，但 routes.py 仍保留 `_chapter/_novel/_character` 等手工构造函数（见本文 #3） |
| #14 | asar 开启 | ✅ 已完成 | package.json:37 |
| #16 | vite 端口统一 | ✅ 已完成 | vite.config.ts:10 与 dev:ui 统一 5175 |
| #9 | 测试 / lint / CI | ❌ 未做 | 无 tests 目录、无 ESLint 配置（见本文 #1） |
| #13 | 全局错误边界 | ❌ 未做 | 全 src 无 ErrorBoundary（见本文 #4） |
| #15 | docx 导出 | ❌ 未做 | 仍只有 txt/markdown（routes.py:1189-1195）（见本文 #5） |
| #17 | 窗口状态记忆 | ❌ 未做 | main.cjs:146-149 仍固定 1440×900（见本文 #6） |
| A/B/C | N+1 / FTS5 / WAL | ⏸ 触发式保留 | 单用户本地场景未达触发条件，维持 v2 结论 |

---

## 一、P1：建议近期处理

### 1. 仍无自动化测试与静态检查（v2 #9 遗留，现为最高优先级缺口）

**现状**：`backend/` 无 tests 目录；`package.json` scripts 无 test/lint；无 ESLint 配置；唯一的质量关卡是 `build` 里的 `tsc` 和 Electron 冒烟测试（`main.cjs:144,166-170`）。

**为什么现在该做了**：v2 时期这是"性价比"问题，如今项目已有鉴权中间件、读写锁、版本节流、密钥加密这些**正确性敏感**的逻辑——它们恰恰是手工测试最难覆盖、回归代价最高的部分。每次改 `database.py`/`security.py` 都在裸奔。

**建议**（按性价比排序）：
- 后端 pytest + FastAPI TestClient：优先覆盖 ① TokenAuthMiddleware 的 dev/prod 双模式判定；② set_data_dir 切换前后读写一致性；③ 版本节流/清理规则（auto 上限、label 永生）；④ encrypt/decrypt_key 往返与 legacy 明文回退。这四块各 2-3 个用例即可，临时 SQLite 做 fixture，一天内可完成；
- 把 `MOJING_SMOKE_TEST` 冒烟流程脚本化进 CI（GitHub Actions 或本地 pre-push hook）；
- 前端补 ESLint（`typescript-eslint` 官方模板即可），`tsc --noEmit` 单列脚本进 CI。

### 2. 无数据自动备份机制（新发现，写作软件的命脉）

**现状**：全部身家 = 一个 SQLite 文件（默认 `墨境数据/mojing.db`）。版本快照（chapter_versions）防的是"误删内容"，防不了**文件级损坏/误删/磁盘故障/同步软件冲突**（用户若把数据目录指到 OneDrive/坚果云，SQLite 被同步锁损坏是真实高发事故）。

**建议**：
- 启动时 + 每日首次保存时做滚动备份：复用 `database.py:180-197` 现有的 `_copy_db`（online backup API，热备安全），在数据目录下建 `backups/mojing-YYYYMMDD-HHmm.db`，保留最近 10 份滚动删除；
- 设置页展示最近一次备份时间 + "立即备份"按钮（`storage_info()` 已有，扩展一个字段即可）；
- 💡 顺带：检测数据目录是否落在常见云同步路径（OneDrive/Dropbox/坚果云），若是则在设置页给出"建议关闭该目录的按需同步"提示——这是本地 SQLite 应用的标准防护。

### 3. 手写 ORM→响应构造函数未清理（v2 #12 只完成了一半）

**位置**：`routes.py:79-130`（`_chapter`、`_novel`、`_character` 等 7 个手工构造函数仍在逐字段赋值）

`schemas.py:8` 的基类已配 `from_attributes=True`，但路由层没有切换过去，等于地基打了没用。每加一个字段仍要改三处。

**建议**：响应模型逐个改为 `XxxResponse.model_validate(obj)`，删除手工构造函数。注意 `_novel` 带聚合字段（total_words/chapter_count 需二次查询），可保留薄封装但内部仍用 model_validate 填基础字段。约可删 100+ 行样板。

---

## 二、P2：体验与健壮性

### 4. 无全局错误边界（v2 #13 遗留）

任一组件渲染抛错 → 整个白屏，写了一半的内容虽在库里，但用户观感是"软件崩了"。页面已拆分后包一层成本极低：在 `App.tsx` 根组件外包 ErrorBoundary，fallback 提供"重新加载"按钮（`location.reload()`），配合已有的 loadError 重连 UI。

### 5. 导出仍只有 txt/markdown（v2 #15 遗留）

对小说作者，投稿/排版场景 docx 是高频需求。后端加 `python-docx`（纯 Python，PyInstaller 打包无坑），按章节生成标题层级 + 正文段落即可。注意把依赖加进 `backend/requirements.txt` 和 `mojing-backend.spec` 的 hiddenimports（如需）。

### 6. 窗口尺寸/位置不记忆（v2 #17 遗留）

`main.cjs:146-149` 固定 1440×900。引入 `electron-window-state`（无原生依赖，asar 兼容），三行接入。

### 7. `/api/health` 明文下发 auth_token（新发现，架构性权衡需记录）

**位置**：`routes.py:233-245`

health 是无鉴权开放端点且直接返回 `auth_token`。当前安全模型下：
- ✅ 浏览器网页打不通这条路径（跨域读取被 CORS 拦截，且 TokenAuthMiddleware 之外无 ACAO 头）；
- ⚠️ 但**本机任意进程**（其他软件、脚本）`curl 127.0.0.1:8765/api/health` 即可拿到令牌获得全部读写权。

单机场景下"能跑本机进程"基本等于"能直接读 SQLite 文件"，所以这不是新增攻击面，**可接受**——但建议二选一做轻量加固，并把结论写进 README 安全说明：
- 方案 A：Electron 主进程改为直接读 `storage.json` 拿 token（它本来就知道 CONFIG_PATH 的推导规则），health 不再返回 token；
- 方案 B：health 仅在启动后 60 秒握手窗口内返回 token，之后只返回指纹。

### 8. 数据目录迁移的边界情况（新发现）

**位置**：`database.py:242-267`

`set_data_dir` 只在目标库**不存在**时才复制当前库过去（`252` 行）。若用户把目录指到**一个已有旧 mojing.db 的文件夹**，会静默挂载旧库——这可能是用户想要的（找回旧数据），也可能是事故（以为会带走当前作品，结果打开了半年前的库）。建议：目标已存在库时返回明确提示（"检测到已有数据，将打开该数据"vs"覆盖为当前数据"二选一），而不是静默二选一。

### 9. schema 迁移靠手写 ALTER，会随迭代腐烂（新发现）

**位置**：`database.py:215-226`

`_migrate_legacy_columns` 目前只有一条 ADD COLUMN，尚可维护。但项目处于快速迭代期（大纲思维导图、分页编辑都是近期加的），列会越来越多。建议趁清单还短，二选一：
- 轻量：维持现有模式，但给每条迁移加幂等性测试（并入 #1 的 pytest）；
- 正规：引入 Alembic（对单文件 SQLite 稍重，但一劳永逸）。

---

## 三、发布链路（新议题，v2 未覆盖）

### 10. 无自动更新机制

`electron-builder` 已配好 NSIS，但没有 `electron-updater`。分发后用户永远停在初版，bug 修复无法触达。建议：electron-updater + GitHub Releases（私有项目可用 generic 静态服务器），主进程加 `autoUpdater.checkForUpdatesAndNotify()`，约半天工作量，**建议在首次对外分发前就位**——第一批用户无法被自动召回。

### 11. 安装包未代码签名

Windows SmartScreen 会对未签名 exe 弹"未知发布者"警告，直接劝退非技术用户。OV 证书有成本，若暂不购买，至少在发布说明中预告此提示；长期建议签名。

---

## 四、触发式项（维持 v2 结论，触发条件更新）

| 项 | 位置 | 触发条件 | 做法 |
|---|---|---|---|
| N+1 查询 | routes.py:280-282（list_novels 仍循环 `_novel` 逐本聚合） | 小说 > 20 本或列表页可感知变慢 | 单条 GROUP BY 聚合 + Python 侧 join |
| FTS5 搜索 | routes.py 搜索接口仍 LIKE 全表扫 | 单库正文 > 50MB 或搜索 P95 > 200ms | chapters_fts 虚表 + 触发器，中文按字索引 |
| WAL 模式 | database.py（connect 事件处加一行即可） | 后台 AI 任务与前台写作并发可感知卡顿 | `PRAGMA journal_mode=WAL` + 外键列索引 |

---

## 建议实施顺序（v3）

| 阶段 | 内容 | 理由 |
|---|---|---|
| 第一步 | #10 自动更新 | 首次分发前必须在位，否则第一批用户流失 |
| 第二步 | #2 自动备份 | 数据无价，复用现有 _copy_db，成本最低收益最高 |
| 第三步 | #1 pytest 四块核心 + ESLint | 给已有的正确性敏感逻辑上保险 |
| 第四步 | #3 手工构造函数清理、#4 ErrorBoundary | 降本 + 防白屏 |
| 第五步 | #5 docx、#6 窗口记忆、#8 目录冲突提示 | 体验打磨 |
| 第六步 | #7 health token 加固（选方案并写入 README）、#9 迁移方案、#11 签名 | 加固与合规 |
| 触发式 | N+1 / FTS5 / WAL | 达到触发条件再动 |

---

## 总体评价

v2 的执行质量很高：13/17 完整落地，且实现有超出建议的细节（如端口递增扫描、读写锁、legacy 明文密钥回退兼容）。项目已从"有真实风险"进入"健壮但缺保险"的阶段——剩余工作里没有紧急项，**自动备份（#2）和自动更新（#10）是唯二与"用户真实数据/真实分发"强相关的**，建议优先；测试体系（#1）是保障后续迭代不翻车的地基。
