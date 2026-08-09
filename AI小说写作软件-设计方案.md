# AI 小说写作软件 - 设计方案

> 一款桌面端 AI 辅助小说写作工具，支持多模型接入、完整写作工作流，并以**伏笔管理**作为核心差异化功能。

---

## 1. 产品定位

为小说作者提供一站式的写作工具，结合 AI 能力辅助创作，同时提供结构化的世界观、角色、伏笔管理，解决长篇小说创作中"写到后面忘记前面埋了什么伏笔"的核心痛点。

### 核心亮点

- **多模型 AI 辅助**：支持 Claude / GPT / DeepSeek 等多家 AI 模型，统一调度，按需切换
- **伏笔全生命周期管理**：从"埋"到"收"的完整追踪，Kanban 看板 + 关系网络图
- **上下文感知 AI**：AI 续写时自动注入人物/地点/世界观/未收束伏笔，确保前后一致
- **本地优先**：数据存储在本地 SQLite，无需联网即可使用核心功能

---

## 2. 技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 桌面壳 | **Electron** | 跨平台桌面应用框架 |
| 后端 | **Python FastAPI** | 异步高性能，AI/LLM 生态最好 |
| 前端 | **React 18 + TypeScript** | 类型安全，组件化开发 |
| 编辑器 | **TipTap (ProseMirror)** | 可扩展的富文本编辑器 |
| 数据库 | **SQLite** | 本地存储，零配置 |
| ORM | **SQLAlchemy** | Python 最成熟的 ORM |
| AI 调度 | **litellm / 自研调度器** | 统一多模型调用接口 |
| 状态管理 | **Zustand** | 轻量、TypeScript 友好 |

---

## 3. 系统架构

```
┌─────────────────────────────────────────────────┐
│                  Electron Shell                  │
│  ┌───────────────────────────────────────────┐  │
│  │          React Frontend (Renderer)         │  │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌─────────┐  │  │
│  │  │编辑器│ │大纲  │ │角色  │ │伏笔追踪 │  │  │
│  │  │模块  │ │管理  │ │地点  │ │模块     │  │  │
│  │  └──────┘ └──────┘ └──────┘ └─────────┘  │  │
│  │         ↕ HTTP REST API (localhost)       │  │
│  ├───────────────────────────────────────────┤  │
│  │        Python FastAPI Backend             │  │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌─────────┐  │  │
│  │  │小说  │ │章节  │ │AI    │ │导出     │  │  │
│  │  │CRUD  │ │版本  │ │调度  │ │模块     │  │  │
│  │  └──────┘ └──────┘ └──────┘ └─────────┘  │  │
│  │              ↕ SQLAlchemy                  │  │
│  │           ┌──────────┐                     │  │
│  │           │  SQLite   │                     │  │
│  │           └──────────┘                     │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

**进程模型：**
- Electron Main Process：管理窗口，启动/停止 FastAPI 子进程
- Python FastAPI：本地 HTTP 服务（`127.0.0.1:随机端口`），处理业务逻辑和 AI 调用
- React Renderer：纯前端 UI，通过 HTTP 与 FastAPI 通信

---

## 4. 数据模型

### 4.1 Novel（小说）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| title | str | 书名 |
| description | str? | 简介 |
| author | str? | 作者笔名 |
| genre | str? | 流派（玄幻/都市/科幻/历史...） |
| target_words | int? | 目标字数 |
| status | enum | planning / writing / completed |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 4.2 Chapter（章节）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| novel_id | FK→Novel | 所属小说 |
| title | str | 章节标题 |
| content | str | 内容（富文本/HTML） |
| order | int | 排序序号 |
| word_count | int | 字数 |
| status | enum | draft / writing / completed |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 4.3 ChapterVersion（章节版本历史）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| chapter_id | FK→Chapter | 所属章节 |
| content | str | 版本内容快照 |
| word_count | int | 该版本字数 |
| version_number | int | 版本号（自增） |
| created_at | datetime | 快照时间 |

### 4.4 Character（角色）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| novel_id | FK→Novel | 所属小说 |
| name | str | 姓名 |
| aliases | str? | 别名/称号 |
| description | str? | 角色简介 |
| personality | str? | 性格特征 |
| background | str? | 背景故事 |
| appearance | str? | 外貌描述 |
| abilities | str? | 能力/技能 |
| relationships | JSON? | 与其他角色的关系 |
| first_appearance_chapter_id | FK? | 首次登场章节 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 4.5 Location（地点）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| novel_id | FK→Novel | 所属小说 |
| name | str | 地点名称 |
| description | str? | 描述 |
| type | str? | 类型（城市/建筑/秘境...） |
| parent_location_id | FK? | 父级地点（支持层级） |
| first_appearance_chapter_id | FK? | 首次出现章节 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 4.6 WorldSetting（世界观设定）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| novel_id | FK→Novel | 所属小说 |
| name | str | 设定名称 |
| category | str | 分类（修炼体系/势力分布/历史/规则...） |
| description | str | 详细说明 |
| related_settings | JSON? | 关联的其他设定 |
| chapter_references | JSON? | 在哪些章节中被使用 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 4.7 PlotThread（伏笔）⭐核心差异化

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| novel_id | FK→Novel | 所属小说 |
| title | str | 伏笔标题 |
| description | str | 伏笔内容描述 |
| status | enum | **planted**(已埋) → **hinted**(已暗示) → **developing**(发展中) → **resolved**(已收束) |
| planted_chapter_id | FK→Chapter | 埋下伏笔的章节 |
| resolved_chapter_id | FK?→Chapter | 收束伏笔的章节 |
| related_characters | JSON? | 关联角色 ID 列表 |
| related_locations | JSON? | 关联地点 ID 列表 |
| related_threads | JSON? | 关联其他伏笔 ID（构建伏笔网） |
| priority | enum | major(主线) / minor(支线) / detail(细节) |
| notes | str? | 备注/收束计划 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

---

## 5. API 设计

### 5.1 小说管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/novels` | 获取小说列表 |
| POST | `/api/novels` | 创建小说 |
| GET | `/api/novels/{id}` | 获取小说详情（含统计） |
| PUT | `/api/novels/{id}` | 更新小说信息 |
| DELETE | `/api/novels/{id}` | 删除小说（级联删除所有关联数据） |

### 5.2 章节管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/novels/{id}/chapters` | 获取章节列表（含排序） |
| POST | `/api/novels/{id}/chapters` | 创建新章节 |
| GET | `/api/chapters/{id}` | 获取章节详情（含完整内容） |
| PUT | `/api/chapters/{id}` | 更新章节内容（自动创建版本快照） |
| DELETE | `/api/chapters/{id}` | 删除章节 |
| PUT | `/api/chapters/{id}/reorder` | 调整章节顺序（拖拽排序） |
| GET | `/api/chapters/{id}/versions` | 获取版本历史列表 |
| POST | `/api/chapters/{id}/rollback/{version_id}` | 回滚到指定版本 |

### 5.3 角色管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/novels/{id}/characters` | 获取角色列表 |
| POST | `/api/novels/{id}/characters` | 创建角色 |
| GET | `/api/characters/{id}` | 获取角色详情 |
| PUT | `/api/characters/{id}` | 更新角色信息 |
| DELETE | `/api/characters/{id}` | 删除角色 |

### 5.4 地点管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/novels/{id}/locations` | 获取地点列表（含层级） |
| POST | `/api/novels/{id}/locations` | 创建地点 |
| PUT | `/api/locations/{id}` | 更新地点 |
| DELETE | `/api/locations/{id}` | 删除地点 |

### 5.5 世界观管理

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/novels/{id}/settings` | 获取世界观设定列表 |
| POST | `/api/novels/{id}/settings` | 创建设定 |
| PUT | `/api/settings/{id}` | 更新设定 |
| DELETE | `/api/settings/{id}` | 删除设定 |

### 5.6 伏笔管理（核心差异化）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/novels/{id}/plot-threads` | 获取所有伏笔（支持按状态/优先级筛选） |
| POST | `/api/novels/{id}/plot-threads` | 创建伏笔 |
| GET | `/api/plot-threads/{id}` | 获取伏笔详情 |
| PUT | `/api/plot-threads/{id}` | 更新伏笔 |
| DELETE | `/api/plot-threads/{id}` | 删除伏笔 |
| PUT | `/api/plot-threads/{id}/resolve` | 收束伏笔（设置 resolved 状态 + 收束章节） |
| GET | `/api/novels/{id}/plot-threads/unresolved` | 获取未收束伏笔（用于 AI 上下文注入 + 提醒） |
| GET | `/api/novels/{id}/plot-thread-web` | 获取伏笔关系网数据（用于可视化） |

### 5.7 AI 写作辅助

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ai/generate` | AI 续写（SSE 流式返回） |
| POST | `/api/ai/polish` | AI 润色 |
| POST | `/api/ai/expand` | AI 扩写场景 |
| POST | `/api/ai/suggest-threads` | AI 伏笔建议（分析未收束伏笔） |
| POST | `/api/ai/check-consistency` | AI 一致性检查（角色、设定、伏笔、时间线） |
| GET | `/api/ai/models` | 获取已配置的可用模型列表 |
| POST | `/api/ai/config` | 保存 AI 模型配置 |

### 5.8 全局

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/novels/{id}/search?q=keyword` | 全文搜索（跨章节/角色/伏笔） |
| POST | `/api/novels/{id}/export` | 导出小说（支持 TXT/EPUB/Markdown 格式） |
| POST | `/api/novels/import` | 导入小说 |

---

## 6. 前端页面设计

### 6.1 小说列表页 `/novels`

- 卡片网格展示所有小说，显示书名、流派、字数、进度
- 新建小说按钮 → 弹出创建表单
- 搜索 & 筛选

### 6.2 写作工作台 `/novels/:id/write`（主工作区）

三栏布局：

```
┌──────────┬────────────────────────┬──────────┐
│ 章节树   │    TipTap 富文本编辑器   │  AI 面板  │
│          │                        │          │
│ ├ 第1章  │   [工具栏]             │ 续写     │
│ ├ 第2章  │                        │ 润色     │
│ ├ 第3章  │   正文内容...           │ 扩写     │
│ └ 第4章  │                        │ ───────  │
│          │                        │ 上下文：  │
│ [+新增]  │                        │ ☑ 角色   │
│          │                        │ ☑ 地点   │
│          │                        │ ☑ 伏笔   │
└──────────┴────────────────────────┴──────────┘
```

- **章节树**：可拖拽排序，右键菜单（重命名/删除/新建子章节）
- **编辑器**：富文本编辑 + Markdown 快捷输入
- **AI 面板**：可选择上下文注入范围（角色/地点/设定/伏笔），流式展示 AI 生成内容

### 6.3 大纲管理 `/novels/:id/outline`

- 树状大纲编辑器，节点可折叠展开
- 节点可关联角色、地点、伏笔
- 节点可拖拽连接到对应章节
- 支持导出为思维导图

### 6.4 角色管理 `/novels/:id/characters`

- 角色卡片列表（头像/姓名/简介）
- 点击展开详情面板
- AI 一键生成角色（根据小说背景自动创建）
- 角色关系图谱可视化

### 6.5 地点管理 `/novels/:id/locations`

- 层级地点树（世界 → 大陆 → 国家 → 城市 → 具体场所）
- 地点详情编辑

### 6.6 世界观设定 `/novels/:id/world-settings`

- 分类标签页（修炼体系 / 势力分布 / 历史背景 / 规则设定）
- 设定卡片 + 详情编辑
- 关联图可视化

### 6.7 伏笔看板 `/novels/:id/plot-threads` ⭐

- **Kanban 视图**：四列状态（已埋 → 已暗示 → 发展中 → 已收束）
- **列表视图**：表格形式，支持按优先级/状态/时间排序
- **伏笔卡片**：显示标题、描述摘要、优先级标签、关联章节、埋下时长
- **关系网络图**：节点连线可视化伏笔之间的关联
- **收束提醒**：顶部 Banner 显示"你有 X 个主线伏笔超过 Y 章未收束"
- **AI 建议按钮**：扫描未收束伏笔，为当前章节推荐收束时机

### 6.8 设置页 `/settings`

- AI 模型配置：API Key 输入、模型选择、参数调整（temperature/max_tokens）
- 编辑器设置：字体大小、主题（亮色/暗色）、自动保存间隔
- 数据管理：导出/导入数据库、备份路径设置

---

## 7. AI 集成方案

### 7.1 统一调度器

```python
class AIDispatcher:
    """多模型统一调度，按模型名称路由到对应的 provider"""
    
    def get_provider(self, model: str) -> BaseProvider:
        if model.startswith("claude"):
            return ClaudeProvider(self.config)
        elif model.startswith("gpt"):
            return OpenAIProvider(self.config)
        elif model.startswith("deepseek"):
            return DeepSeekProvider(self.config)
        # ... 可扩展
    
    async def generate_stream(self, model, messages, **params):
        """流式生成，返回 AsyncGenerator[str]"""
        provider = self.get_provider(model)
        async for chunk in provider.stream(messages, **params):
            yield chunk
```

### 7.2 Prompt 构建策略

AI 续写时，系统自动构建包含上下文的 Prompt：

```
[System]
你是专业的小说作家，擅长{genre}类型小说。
当前你正在写作的小说《{novel_title}》，整体风格为{style}。

以下是需要你了解的小说设定：

## 相关角色
{selected_characters_info}

## 相关地点
{selected_locations_info}

## 活跃伏笔（请留意并在合适的时机自然收回）
{active_plot_threads}

## 世界观设定参考
{relevant_world_settings}

## 最近的剧情（前文摘要）
{recent_chapters_summary}

[User]
请根据以上设定，续写以下内容。保持文风一致，角色性格不崩坏，
如有合适的时机可自然地收束伏笔。生成约{target_words}字。

{current_content}
```

### 7.3 AI 伏笔建议

- 扫描所有 `planted/hinted/developing` 状态的伏笔
- 对比当前章节内容，识别"接近可以收束"的伏笔
- 标记超过 N 章未更新的伏笔为"僵尸伏笔"
- 生成建议：在哪些场景/对话中可自然收束

### 7.4 AI 一致性检查

- 角色一致性：检查角色名称、性格、外貌描述是否前后矛盾
- 设定一致性：检查世界观设定是否被违反
- 伏笔完整性：列出所有未收束的伏笔，评估遗漏风险
- 时间线检查：核实事件发生的时间顺序

---

## 8. 关键流程

### 8.1 写作 + AI 辅助流程

```
用户编辑 → 自动保存(debounce 2s) → 本地持久化
    │
用户选中文字 / 光标定位 → 打开 AI 面板
    │
选择操作（续写/润色/扩写）→ 勾选上下文 → 点击生成
    │
后端构建 Prompt → 注入上下文 → 调用 AI API → SSE 流式返回
    │
前端实时渲染 → 用户预览
    │
接受 → 插入编辑器  /  拒绝 → 丢弃  /  修改 → 手动调整后保留
```

### 8.2 伏笔管理流程

```
写作中标记文字 → "设为伏笔" → 弹出表单
    │
填写标题/描述/优先级/关联角色 → 保存 → 进入 Kanban "已埋"列
    │
后续章节中手动更新伏笔状态: 已埋 → 已暗示 → 发展中
    │
AI 辅助时自动检测相关伏笔并提醒用户
    │
在合适章节标记 → "收束伏笔" → 选择收束章节 → 移至"已收束"列
    │
伏笔网视图：查看伏笔间的关联关系
```

### 8.3 版本管理流程

```
章节保存(手动保存/自动保存) → 内容 hash 对比
    │
内容有变化 → 创建新版本快照 → 存入 chapter_versions 表
    │
用户查看版本历史 → 选择两个版本对比 → 高亮差异
    │
回滚操作 → 将选中版本内容恢复到编辑器 → 同时创建新快照(标记为回滚)
```

---

## 9. 项目文件结构

```
ai-novel-writer/
├── electron/                        # Electron 主进程
│   ├── main.ts                      # 入口：窗口管理、应用生命周期
│   ├── preload.ts                   # 预加载脚本（安全暴露 API）
│   └── python-bridge.ts             # FastAPI 子进程管理
│
├── backend/                         # Python FastAPI 后端
│   ├── main.py                      # 应用入口
│   ├── config.py                    # 配置管理
│   ├── database.py                  # SQLAlchemy 引擎 & Session
│   ├── models/                      # 数据模型
│   │   ├── __init__.py
│   │   ├── novel.py
│   │   ├── chapter.py
│   │   ├── chapter_version.py
│   │   ├── character.py
│   │   ├── location.py
│   │   ├── world_setting.py
│   │   └── plot_thread.py
│   ├── schemas/                     # Pydantic 响应/请求 Schema
│   │   ├── __init__.py
│   │   ├── novel.py
│   │   ├── chapter.py
│   │   ├── character.py
│   │   ├── location.py
│   │   ├── world_setting.py
│   │   ├── plot_thread.py
│   │   └── ai.py
│   ├── routes/                      # API 路由
│   │   ├── __init__.py
│   │   ├── novels.py
│   │   ├── chapters.py
│   │   ├── characters.py
│   │   ├── locations.py
│   │   ├── settings.py
│   │   ├── plot_threads.py
│   │   └── ai.py
│   ├── services/                    # 业务逻辑层
│   │   ├── __init__.py
│   │   ├── novel_service.py
│   │   ├── chapter_service.py
│   │   ├── plot_thread_service.py
│   │   └── ai/
│   │       ├── __init__.py
│   │       ├── dispatcher.py        # AI 调度器
│   │       ├── prompt_builder.py    # Prompt 构建
│   │       └── providers/
│   │           ├── __init__.py
│   │           ├── base.py          # 抽象基类
│   │           ├── claude.py
│   │           ├── openai.py
│   │           └── deepseek.py
│   └── requirements.txt
│
├── frontend/                        # React 前端
│   ├── public/
│   ├── src/
│   │   ├── main.tsx                 # 入口
│   │   ├── App.tsx                  # 路由配置
│   │   ├── api/                     # API 调用封装
│   │   │   ├── client.ts            # Axios 实例
│   │   │   ├── novels.ts
│   │   │   ├── chapters.ts
│   │   │   ├── characters.ts
│   │   │   ├── locations.ts
│   │   │   ├── settings.ts
│   │   │   ├── plotThreads.ts
│   │   │   └── ai.ts
│   │   ├── types/                   # TypeScript 类型定义
│   │   │   ├── novel.ts
│   │   │   ├── chapter.ts
│   │   │   ├── character.ts
│   │   │   ├── location.ts
│   │   │   ├── worldSetting.ts
│   │   │   ├── plotThread.ts
│   │   │   └── ai.ts
│   │   ├── stores/                  # Zustand 状态管理
│   │   │   ├── useNovelStore.ts
│   │   │   ├── useChapterStore.ts
│   │   │   ├── useCharacterStore.ts
│   │   │   ├── usePlotThreadStore.ts
│   │   │   └── useSettingsStore.ts
│   │   ├── layouts/
│   │   │   └── MainLayout.tsx       # 主布局（侧边栏+内容区）
│   │   ├── pages/
│   │   │   ├── NovelList.tsx
│   │   │   ├── WritingWorkspace.tsx
│   │   │   ├── OutlineManager.tsx
│   │   │   ├── CharacterManager.tsx
│   │   │   ├── LocationManager.tsx
│   │   │   ├── WorldSettings.tsx
│   │   │   ├── PlotThreadBoard.tsx
│   │   │   └── Settings.tsx
│   │   ├── components/
│   │   │   ├── editor/              # TipTap 编辑器及扩展
│   │   │   ├── ai-panel/            # AI 助手面板
│   │   │   ├── plot-thread/         # 伏笔 Kanban / 网络图
│   │   │   └── shared/              # 通用组件
│   │   └── styles/
│   │       └── globals.css
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── tailwind.config.ts
│
├── package.json                     # 根 package.json（Electron 相关脚本）
└── README.md
```

---

## 10. 实施路线图

### Phase 1：基础框架（MVP）

- [ ] 项目骨架搭建（Electron + FastAPI + React 工程化）
- [ ] SQLite 数据库初始化 + 数据模型建表
- [ ] 前端路由 + MainLayout 布局框架
- [ ] 小说创建 & 列表展示
- [ ] 基础章节编辑器（TipTap 集成）

### Phase 2：核心写作功能

- [ ] 章节版本管理（自动快照 + 版本对比 + 回滚）
- [ ] 角色 CRUD + 管理页面
- [ ] 地点 CRUD + 层级管理
- [ ] 世界观设定管理
- [ ] 大纲编辑器

### Phase 3：AI 集成

- [ ] AI 统一调度器 + 多 Provider 实现
- [ ] AI 续写（SSE 流式输出）
- [ ] AI 润色 + AI 扩写
- [ ] Prompt 构建器（上下文注入：角色/设定/伏笔）
- [ ] AI 模型配置页面

### Phase 4：伏笔系统 ⭐

- [ ] 伏笔 CRUD（标记/编辑/删除）
- [ ] 伏笔看板（Kanban 四列拖拽）
- [ ] 伏笔关系网络图
- [ ] 伏笔收束提醒（Banner + 通知）
- [ ] AI 伏笔建议 & 一致性检查

### Phase 5：打磨与发布

- [ ] 全文搜索 & 替换
- [ ] 数据导出（TXT / EPUB / Markdown）
- [ ] 自动保存 + 离线容错
- [ ] 暗色模式
- [ ] 性能优化（大文档渲染、虚拟滚动）
- [ ] 安装包打包（Windows/Mac/Linux）

---

## 11. 验收标准

1. Electron 启动 → FastAPI 自动启动 → 前端正常加载
2. 创建小说 → 新建章节 → 在编辑器中编写内容 → 自动保存生效
3. 创建角色/地点/世界观 → AI 续写时验证上下文是否被正确注入
4. 标记伏笔 → Kanban 看板切换状态 → 伏笔关系网正确展示
5. 配置多个 AI 模型 → 切换模型 → 分别验证可用性
6. 章节版本历史 → 版本对比 → 回滚到指定版本
7. 导出 TXT/EPUB/Markdown → 文件内容完整
