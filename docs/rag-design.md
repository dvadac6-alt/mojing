# 墨境 RAG 设计方案 v1（API Embedding 版）

> 撰写时间：2026-08-21 ｜ 范围：后端（FastAPI/SQLite）+ 前端接入
>
> 范围约定（按需求确认）：
> - **只做 API 调用**的 embedding（复用 OpenAI 兼容 `/v1/embeddings` 端点）；本地 ONNX、rerank、向量库等**本期不做**，仅在架构上留位。
> - 三个场景全做：① 自身作品跨章检索 ② 资料库检索 ③ 语义搜索替代 LIKE。
>
> 设计原则：**本地优先不动摇**——正文与索引全部存本地 SQLite；只有 embedding 计算走 API（设置页明示）。无 embedding 配置时全部功能优雅降级（检索跳过、搜索回退 LIKE）。

---

## 一、总体架构

```
                      ┌────────────────────────────────────────────┐
 写作页自动保存 ──节流──▶│ Chunker 切块 ──▶ Embedding Client(API) ──▶│ document_chunks 表
 资料库导入 TXT ────────▶│ (场景聚合切块)    (批量, /v1/embeddings)  │ (SQLite, 向量存 BLOB)
                      └────────────────────────────────────────────┘
                                            │
 ┌──────────────────────────────────────────┼─────────────────────────────┐
 │ ① 生成注入                                │ ③ 语义搜索                  │
 │ _prepare_generation                       │ GET /novels/{id}/search    │
 │   → 当前章节结尾做 query 向量              │   → query 向量              │
 │   → 检索前文/资料 top-k                    │   → 向量召回 + LIKE 召回     │
 │   → prompt_builder 注入"相关参考"段         │   → 分数融合排序             │
 │ ② 资料库                                  │                            │
 │ LibraryPage 导入/管理/检索测试              │                            │
 └──────────────────────────────────────────┴─────────────────────────────┘
```

三个场景共用同一套基础设施（切块器、embedding 客户端、chunks 表、余弦检索器），只是 `source_type` 与注入/展示方式不同。

---

## 二、Embedding 配置设计

### 2.1 模型配置（复用 ai_config 表，新增专列）

不另建配置体系——在 `AIConfig` 上加 embedding 专用字段，一个配置同时描述"生成模型 + 可选的 embedding 端点"：

```python
# models.py · AIConfig 新增列
embed_base_url: Mapped[str] = mapped_column(String(255), default="", nullable=False)  # 留空=用 base_url
embed_model: Mapped[str] = mapped_column(String(120), default="", nullable=False)    # 如 BAAI/bge-m3
embed_api_key: Mapped[str] = mapped_column(String(255), default="", nullable=False)  # 留空=用 api_key（加密存储同现有逻辑）
```

- **默认行为**：`embed_model` 为空 = 未启用 RAG；`embed_base_url/embed_api_key` 为空则回退到生成配置的 `base_url/api_key`（多数服务商同域提供 embeddings）
- 加密：`embed_api_key` 走现有 `security.encrypt_key`，响应同样只回 `has_embed_key` 掩码
- **索引与模型绑定**：chunks 表记录 `embedding_model`；切换 embed 模型后面板提示"需重建索引"（维度/语义空间不同，不混用）

### 2.2 服务商建议（写入设置页提示文案）

| 服务商 | 端点 | 模型 | 说明 |
|---|---|---|---|
| 硅基流动 SiliconFlow | `https://api.siliconflow.cn/v1` | `BAAI/bge-m3` | 中文效果好，免费额度充足，推荐默认 |
| OpenAI | `https://api.openai.com/v1` | `text-embedding-3-small` | 通用 |
| 其他 OpenAI 兼容 | 任意 | — | 只要实现 `/v1/embeddings` |

设置页 AI 模型卡新增"检索增强"分组：embed 模型 ID、独立 base_url/key（可留空）、「测试连通」（发一条 8 字文本验证返回维度）、「重建索引」按钮。

---

## 三、数据模型

### 3.1 document_chunks 表

```sql
CREATE TABLE document_chunks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id        VARCHAR(36) NULL,            -- NULL=全局资料库
    source_type     VARCHAR(20) NOT NULL,        -- chapter | library
    source_id       VARCHAR(64)  NOT NULL,       -- chapter_id 或 library_doc_id
    title           VARCHAR(200) NOT NULL,       -- "第37章 · 玉佩上的裂痕" / 资料文档名
    chunk_index     INTEGER NOT NULL,            -- 块序号（同 source 内）
    text            TEXT NOT NULL,               -- 块原文（注入 prompt 的内容）
    embedding       BLOB NULL,                   -- float32 数组序列化；NULL=待向量化
    embedding_model VARCHAR(120) NOT NULL,       -- 建立时所用模型，换模型需重建
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_chunks_source ON document_chunks(source_type, source_id);
CREATE INDEX ix_chunks_novel  ON document_chunks(novel_id);
```

配套两张业务表：

```sql
CREATE TABLE library_docs (          -- 资料库文档（LibraryPage 实装）
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    novel_id VARCHAR(36) NULL,       -- 可选：绑定某部作品；NULL=全部作品共享
    name VARCHAR(200) NOT NULL,
    category VARCHAR(50) DEFAULT '写作技法',
    source VARCHAR(20) DEFAULT 'txt',  -- txt | paste
    size_chars INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 3.2 容量估算

bge-m3 输出 1024 维 float32 ≈ 4KB/块。一部 200 万字小说 ≈ 3000 块 ≈ 12MB 向量 + 原文 —— SQLite 完全无压力。全量载入内存做余弦：3000 块 < 5ms。

---

## 四、切块策略（小说定制）

通用滑窗会切碎场景，检索出来的片段支离破碎。墨境的切块器（`app/services/rag/chunker.py`）：

**正文（source_type=chapter）**
1. 按空行分段（写作页天然按段落保存）
2. 相邻段贪心聚合：累计 500-800 字成一块；超 800 字的单段按句号硬切
3. 块间**重叠一段**（相邻块共享最后一段），避免关键句落在边界被切碎
4. 每块 title = `第N章 · 章节名`，text 保留原文

**资料（source_type=library）**
1. TXT 导入：识别行首标题（`第X节`/`一、`/短独立行）为切分锚点
2. 标题 + 所属小节段落聚合为块（500 字目标）
3. 无结构文本回退为正文同款策略

---

## 五、后端服务设计

新目录 `backend/app/services/rag/`：

```
rag/
  embedder.py     # EmbeddingClient：读 active 配置，POST {base}/embeddings
                  #   embed(texts: list[str]) -> list[list[float]]
                  #   批量 ≤32 条/次，失败重试 1 次，429 退避 2s
  chunker.py      # 上文策略，纯函数可单测
  indexer.py      # reindex_chapter(db, chapter_id) / reindex_library_doc / rebuild_all(novel_id)
                  #   先删旧块再插新块；embedding 为 NULL 的块由后台补
  retriever.py    # search(db, novel_id, query_vec, source_types, top_k, exclude_source_id)
                  #   numpy 载入候选块 → cosine → top-k（排除当前正在写的章节自身）
```

**增量索引挂点**：`routes.update_chapter` 里已有的版本节流分支（内容变化时）追加 `indexer.reindex_chapter` 调用——用现有 10 分钟节流信号做 debounce，不额外加定时器。embed API 失败时块以 `embedding=NULL` 落库，下次保存重试补齐。

**生成时检索注入**（场景①）：
- `routes._prepare_generation` 中，若启用 embed 且 `context.prior_chapters 或 context.library`：取 `current_content` 结尾 600 字做 query → `retriever.search(top_k=4, exclude_source_id=当前章)` → 传给 `build_messages`
- `prompt_builder.build_messages` 新增两个 section（插在"活跃伏笔"之后、"最近剧情摘要"之前）：

```
## 前文相关片段（与当前情节相关的历史正文，写作时保持一致）
【第37章 · 玉佩上的裂痕】…块原文…
【第12章 · 无名渡口】…

## 参考资料片段（外部素材，仅供风格与知识参考，不要照抄）
【资料 · 江南城镇建筑资料】…块原文…
```

- `AIContextOptions` 新增：`prior_chapters: bool = True`、`library: bool = True`（前端 QuickAI 上下文盒子加两个按钮）

---

## 六、API 设计

### 新增端点

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/library/docs` | GET | 资料文档列表（含块数/索引状态） |
| `/api/library/docs` | POST | 导入：`{name, content, category, novel_id?}`（paste 与 TXT 前端读取后同走此接口）→ 建档+切块+向量化的同步接口（<2MB 文档秒级） |
| `/api/library/docs/{id}` | DELETE | 删除文档及其块 |
| `/api/rag/status` | GET | 索引状态：各 source_type 块数、pending(NULL embedding) 数、当前 embed 模型 |
| `/api/rag/rebuild` | POST | 全量重建索引（换 embed 模型后用） |
| `/api/rag/test-search` | POST | `{novel_id, query, source_types}` 检索调试：返回命中块+分数+来源 |
| `/api/ai/configs/{id}/test-embed` | POST | 测 embedding 连通（返回维度） |

### 改造端点

| 端点 | 改动 |
|---|---|
| `GET /novels/{id}/search`（场景③） | 混合检索：向量召回（权重 0.7）+ LIKE 召回（权重 0.3）做分数融合（RRF 简化版：`score = 0.7*cos + 0.3*(命中=1)`）；结果项增加 `snippet`（命中块前后各 30 字）与 `source_type`；**未启用 embed 时行为与现在完全一致** |
| `POST /ai/generate` 系列 | 经 `_prepare_generation` 注入（见五），请求体无变化（context 新字段向后兼容，默认 true 但未启用 embed 时静默跳过） |
| `GET/PUT /ai/configs` | 新增 embed 三字段的读写（key 掩码同现有） |

---

## 七、前端改动

1. **QuickAI（写作页辅助中心）**：上下文盒子从 4 个按钮变 6 个——新增 `前文`、`资料`（默认开）；选中"前文"时生成请求带 `context.prior_chapters`
2. **LibraryPage 实装**（现为占位页）：
   - 左栏：分类导航 + 文档列表（名称/字数/块数）+ 「导入 TXT」（FileReader 读文本→POST）/「粘贴资料」
   - 右栏：文档详情（预览前几块）+ 底部「检索测试」输入框 → 调 `/rag/test-search` 展示命中块与分数（调试体验核心）
3. **SettingsPage · AI 模型卡**：新增"检索增强（RAG）"分组（embed 模型/独立端点/独立 Key/测试/重建索引按钮 + 索引状态行）
4. **全局搜索（标题栏 Ctrl+K）**：一期不动，搜索框语义化在搜索页自身（`/novels/{id}/search` 的消费方）

---

## 八、边界与降级

| 情况 | 行为 |
|---|---|
| 未配置 embed 模型 | 检索不注入、搜索走 LIKE（现状）、LibraryPage 可导入但提示"未启用语义检索"；不报错 |
| embed API 调用失败 | 生成不受影响（跳过注入 + toast 一次）；块 pending，下次保存自动补 |
| 切换 embed 模型 | 状态栏黄色提示"向量模型已变更，需重建索引" + 一键重建（旧维度向量不可比） |
| 超长文档导入 | >2MB 拒绝并提示拆分（与现有 LibraryPage 文案一致） |
| 删除章节/作品 | 级联清理 chunks（FK ondelete + indexer 钩子） |
| 隐私 | 设置页 embedding 分组旁固定提示："启用后，切块文本将发送至所选服务商做向量化；正文与索引仍完整保存在本地" |

**成本参考**：bge-m3（硅基流动）免费额度内可索引数百万字；200 万字小说全量索引一次性约 200 万 token 输入，日常增量（每次保存几百字）可忽略。

---

## 九、实施计划与验收

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| **R1 基建** | AIConfig 三列 + 迁移；rag/ 四模块；`/rag/status`、`/test-embed`；设置页 embed 分组 | 配置硅基流动后 test-embed 返回 1024 维；状态接口正确 |
| **R2 场景①** | update_chapter 挂增量索引；_prepare_generation + build_messages 注入；QuickAI 两个新开关 | 写第 N 章生成时，请求 prompt 中可见前文章节片段；改第 37 章内容后 10 分钟内其索引更新 |
| **R3 场景②** | library_docs 表 + 4 个端点；LibraryPage 实装（导入/列表/删除/检索测试） | 导入 TXT → 块数>0 → 检索测试返回带来源命中 → 生成时注入资料片段 |
| **R4 场景③** | search_novel 混合检索 + snippet；未配置回退 LIKE | 搜"旧信物"能命中只写"玉佩"的段落（语义召回生效）；关掉 embed 后搜索行为与现状一致 |
| R5 打磨 | 重建索引进度、错误重试、文档 | 换模型 → 提示 → 重建 → 检索恢复正常 |

依赖变更：`requirements.txt` 新增 `numpy`（余弦计算；PyInstaller 打包无碍）。前端无新依赖。

---

## 十、本期明确不做（留位）

- 本地 ONNX embedding（离线模式）——接口已按"客户端可替换"设计，二期加 `LocalEmbeddingClient` 即可
- rerank 精排、混合召回调参面板
- sqlite-vec / 专用向量库（块数 >5 万再考虑）
- 命令面板（Ctrl+K）的语义化
