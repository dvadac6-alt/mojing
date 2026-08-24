from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class OrmModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Novel ----------
class NovelBase(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    author: str = ""
    genre: str = ""
    target_words: int = 200_000
    status: str = "writing"


class NovelCreate(NovelBase):
    pass


class NovelUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    author: str | None = None
    genre: str | None = None
    target_words: int | None = None
    status: str | None = None


class NovelResponse(OrmModel):
    id: str
    title: str
    description: str
    author: str
    genre: str
    target_words: int
    status: str
    # F11 文风画像（服务端计算，客户端只读）
    style_profile: dict | None = None
    # 封面图文件名（空 = 未设置）；图片本体走 GET /novels/{id}/cover
    cover_image: str = ""
    total_words: int = 0
    chapter_count: int = 0
    created_at: datetime
    updated_at: datetime


# ---------- Chapter ----------
class ChapterResponse(OrmModel):
    id: str
    novel_id: str
    title: str
    content: str
    order: int
    word_count: int
    status: str
    # F1 章节摘要链：摘要可手改可 AI 生成，经 PUT /chapters 落库。
    summary: str = ""
    summary_updated_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ChapterSummary(OrmModel):
    """Lightweight chapter row for lists: omits the (potentially large) body so
    the workspace payload stays small. Full content is fetched on demand via
    GET /chapters/{id} when a chapter is opened for editing."""
    id: str
    novel_id: str
    title: str
    order: int
    word_count: int
    status: str
    created_at: datetime
    updated_at: datetime


class ChapterCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = ""


class ChapterUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = None
    status: str | None = None
    # F1：摘要单独保存（不影响正文版本快照，也不触碰 word_count）。
    summary: str | None = None


class ChapterReorder(BaseModel):
    order: int


class ChapterVersionResponse(OrmModel):
    id: str
    chapter_id: str
    content: str
    word_count: int
    version_number: int
    label: str
    created_at: datetime


# ---------- Scene (outline mind-map leaf) ----------
class SceneSummary(OrmModel):
    id: str
    chapter_id: str
    title: str
    order: int
    created_at: datetime
    updated_at: datetime


class SceneCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class SceneUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)


# ---------- Graph edge (manual mind-map connector) ----------
class GraphEdgeOut(OrmModel):
    id: str
    novel_id: str
    kind: str
    from_id: str
    to_id: str
    label: str
    created_at: datetime


class GraphEdgeCreate(BaseModel):
    kind: str = Field(min_length=1, max_length=20)
    from_id: str = Field(min_length=1)
    to_id: str = Field(min_length=1)
    label: str = Field(default="", max_length=60)


class GraphEdgeUpdate(BaseModel):
    label: str = Field(default="", max_length=60)


# ---------- Character ----------
class CharacterCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    aliases: str = ""
    role: str = ""
    color: str = "#5b6b66"
    description: str = ""
    personality: str = ""
    background: str = ""
    appearance: str = ""
    abilities: str = ""
    relationships: dict[str, Any] = Field(default_factory=dict)
    first_appearance_chapter_id: str | None = None


class CharacterUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    aliases: str | None = None
    role: str | None = None
    color: str | None = None
    description: str | None = None
    personality: str | None = None
    background: str | None = None
    appearance: str | None = None
    abilities: str | None = None
    relationships: dict[str, Any] | None = None
    first_appearance_chapter_id: str | None = None


class CharacterResponse(OrmModel):
    id: str
    novel_id: str
    name: str
    aliases: str
    role: str
    color: str
    description: str
    personality: str
    background: str
    appearance: str
    abilities: str
    relationships: dict[str, Any]
    first_appearance_chapter_id: str | None = None
    created_at: datetime
    updated_at: datetime


# ---------- Location ----------
class LocationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    type: str = ""
    parent_location_id: str | None = None
    map_id: str | None = None
    first_appearance_chapter_id: str | None = None


class LocationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    type: str | None = None
    parent_location_id: str | None = None
    map_id: str | None = None
    first_appearance_chapter_id: str | None = None


class LocationResponse(OrmModel):
    id: str
    novel_id: str
    name: str
    description: str
    type: str
    parent_location_id: str | None = None
    map_id: str | None = None
    first_appearance_chapter_id: str | None = None
    created_at: datetime
    updated_at: datetime


# ---------- Story maps (multi-map / realms) ----------
class StoryMapCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    doodles: list[dict[str, Any]] = []


class StoryMapUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    doodles: list[dict[str, Any]] | None = None


class StoryMapResponse(OrmModel):
    id: str
    novel_id: str
    name: str
    description: str
    doodles: list[dict[str, Any]] = []
    background_image: str = ""
    created_at: datetime
    updated_at: datetime


# ---------- Terrains (named doodle colors) ----------
class TerrainCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    color: str = Field(min_length=4, max_length=20)


class TerrainUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    color: str | None = Field(default=None, min_length=4, max_length=20)


class TerrainResponse(OrmModel):
    id: str
    map_id: str
    name: str
    color: str
    created_at: datetime


# ---------- Map strokes (one row per doodle stroke) ----------
class StrokeCreate(BaseModel):
    color: str = Field(min_length=4, max_length=20)
    width: float = Field(ge=0, le=100)  # 0 for rect grid-fill strokes (width is irrelevant)
    eraser: bool = False
    shape: str = Field(default="path", pattern="^(path|rect)$")
    points: list[list[float]] = Field(min_length=1)


class StrokeResponse(OrmModel):
    id: str
    map_id: str
    color: str
    width: float
    eraser: bool
    shape: str = "path"
    points: list[list[float]]
    seq: int
    created_at: datetime


# ---------- WorldSetting ----------
class WorldSettingCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    category: str = "世界规则"
    description: str = ""
    related_settings: dict[str, Any] = Field(default_factory=dict)
    chapter_references: dict[str, Any] = Field(default_factory=dict)


class WorldSettingUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    category: str | None = None
    description: str | None = None
    related_settings: dict[str, Any] | None = None
    chapter_references: dict[str, Any] | None = None


class WorldSettingResponse(OrmModel):
    id: str
    novel_id: str
    name: str
    category: str
    description: str
    related_settings: dict[str, Any]
    chapter_references: dict[str, Any]
    created_at: datetime
    updated_at: datetime


# ---------- PlotThread ----------
class PlotThreadCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    status: str = "planted"
    priority: str = "minor"
    planted_chapter_id: str | None = None
    resolved_chapter_id: str | None = None
    related_characters: list[str] = Field(default_factory=list)
    related_locations: list[str] = Field(default_factory=list)
    related_threads: list[str] = Field(default_factory=list)
    notes: str = ""


class PlotThreadUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    status: str | None = None
    priority: str | None = None
    planted_chapter_id: str | None = None
    resolved_chapter_id: str | None = None
    related_characters: list[str] | None = None
    related_locations: list[str] | None = None
    related_threads: list[str] | None = None
    notes: str | None = None


class PlotThreadResolve(BaseModel):
    resolved_chapter_id: str | None = None


class PlotThreadResponse(OrmModel):
    id: str
    novel_id: str
    title: str
    description: str
    status: str
    priority: str
    planted_chapter_id: str | None = None
    resolved_chapter_id: str | None = None
    related_characters: list[str]
    related_locations: list[str]
    related_threads: list[str]
    notes: str
    created_at: datetime
    updated_at: datetime


# ---------- AI ----------
class AIConfigCreate(BaseModel):
    provider: str = "openai"
    name: str = "默认模型"
    model: str = "mock"
    base_url: str = ""
    api_key: str = ""
    temperature: float = 0.85
    max_tokens: int = 1200
    context_length: int | None = None
    is_active: bool = False


class AIConfigUpdate(BaseModel):
    provider: str | None = None
    name: str | None = None
    model: str | None = None
    base_url: str | None = None
    # None => "leave the stored key untouched"; an explicit string (incl. "")
    # overwrites it. This is how the frontend edits a config without ever
    # having to know the real key.
    api_key: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    context_length: int | None = None
    is_active: bool | None = None


class AIConfigResponse(OrmModel):
    id: int
    provider: str
    name: str
    model: str
    base_url: str
    # The key itself is never returned — only whether one is set and a masked
    # hint, so the UI can render "••••••••5678" without ever holding the secret.
    has_key: bool = False
    key_hint: str = ""
    temperature: float
    max_tokens: int
    # Model context window (tokens) from the provider's /models metadata.
    context_length: int | None = None
    is_active: bool
    created_at: datetime


class AIContextOptions(BaseModel):
    characters: bool = True
    locations: bool = False
    settings: bool = True
    threads: bool = True
    recent_chapters: int = 2
    # RAG 检索增强（未启用 embedding 时静默跳过）
    prior_chapters: bool = True   # 前文相关片段（跨章检索）
    library: bool = True          # 资料库参考片段
    # F1 前情提要：更早章节的摘要串 + 最近章节结尾（按字数预算拼装）注入
    recap: bool = True
    # F8 时间线：当前章前后挂载的大事记事件（默认关闭，按需勾选）
    timeline: bool = False


class AIGenerateRequest(BaseModel):
    novel_id: str
    chapter_id: str | None = None
    instruction: str = ""
    mode: str = "continue"
    target_words: int = 800
    # Pick a specific AI config (model) for this call; omit to use the active one.
    config_id: int | None = None
    context: AIContextOptions = Field(default_factory=AIContextOptions)


class AIConsistencyRequest(BaseModel):
    novel_id: str
    chapter_id: str | None = None


class AIConfigTestRequest(BaseModel):
    """Probe a config's connectivity. api_key is optional: omit it to test the
    already-stored (encrypted) key; pass a new value to test before saving."""
    model: str | None = None
    base_url: str | None = None
    api_key: str | None = None


class AIModelsRequest(BaseModel):
    """Fetch the provider's model list (with context windows). Works without a
    saved config too (new-form flow); key is sent upstream, never returned."""
    base_url: str = ""
    api_key: str | None = None
    config_id: int | None = None


# ---------- Library / RAG ----------
class LibraryDocCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)
    category: str = "写作技法"
    novel_id: str | None = None


class LibraryDocResponse(OrmModel):
    id: int
    novel_id: str | None = None
    name: str
    category: str
    source: str
    size_chars: int
    chunks: int = 0
    created_at: datetime


class RagTestSearchRequest(BaseModel):
    novel_id: str | None = None
    query: str = Field(min_length=1)
    source_types: list[str] = Field(default_factory=lambda: ["chapter", "library"])


# ---------- Workspace / misc ----------
class StoragePathUpdate(BaseModel):
    """POST /api/storage/path — previously a bare dict, bypassing validation."""
    data_dir: str = Field(min_length=1, max_length=1000)


class WorkspaceCounts(BaseModel):
    """Entity counts for the shell (sidebar badges / statusbar) — the slim
    workspace payload no longer carries the entity rows themselves."""
    scenes: int = 0
    characters: int = 0
    locations: int = 0
    world_settings: int = 0
    plot_threads: int = 0
    unresolved_threads: int = 0
    unresolved_major: int = 0
    graph_edges: int = 0


class WorkspaceResponse(OrmModel):
    """Slim workspace (#2)：novel + 章节元数据 + 各实体计数。角色/地点/设定/
    伏笔/场景/连线由各页面的独立 list 端点按需拉取，不再整包下发。"""
    novel: NovelResponse
    chapters: list[ChapterSummary]
    counts: WorkspaceCounts = Field(default_factory=WorkspaceCounts)


class ExportRequest(BaseModel):
    format: str = "txt"
    chapter_ids: list[str] | None = None


class RagConfigUpdate(BaseModel):
    """PUT /api/rag/config & POST /api/rag/config/test — same shape: fields are
    optional; an omitted field keeps the stored value, "" clears it."""
    model: str | None = Field(default=None, max_length=120)
    base_url: str | None = Field(default=None, max_length=255)
    api_key: str | None = Field(default=None, max_length=500)


# ---------- F3 发布前自检 ----------
class LintWordlistUpdate(BaseModel):
    """PUT /api/wordlists/sensitive — 整表替换（面板的添加/清空都走这里）。"""
    words: list[str] = Field(default_factory=list, max_length=5000)


class LintWordlistImport(BaseModel):
    """POST /api/wordlists/sensitive/import — 追加导入文本（每行一词）。"""
    content: str = Field(min_length=1, max_length=2_000_000)


# ---------- F5 灵感收集箱 ----------
class IdeaCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    # None = 全局灵感（不挂在具体作品下）
    novel_id: str | None = None


class IdeaUpdate(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=2000)
    # 手动状态切换只允许 inbox/discarded；converted 由转化端点写入。
    status: str | None = Field(default=None, pattern="^(inbox|discarded)$")


class IdeaResponse(OrmModel):
    id: int
    novel_id: str | None = None
    content: str
    status: str
    converted_kind: str
    converted_id: str
    created_at: datetime
    updated_at: datetime


class IdeaConvertRequest(BaseModel):
    """转化目标：character / thread / chapter。全局灵感必须显式指定 novel_id；
    作品内灵感默认转入所属作品。"""
    kind: str = Field(pattern="^(character|thread|chapter)$")
    novel_id: str
    title: str | None = Field(default=None, max_length=200)


# ---------- F6 自定义 Prompt 模板 ----------
class PromptTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    content: str = Field(min_length=1, max_length=2000)


class PromptTemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    content: str | None = Field(default=None, min_length=1, max_length=2000)


class PromptTemplateResponse(OrmModel):
    id: int
    name: str
    content: str
    created_at: datetime
    updated_at: datetime


# ---------- F8 时间线/大事记 ----------
class TimelineEventCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    story_time: str = Field(default="", max_length=60)
    chapter_id: str | None = None
    order_hint: int = 0


class TimelineEventUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    story_time: str | None = Field(default=None, max_length=60)
    chapter_id: str | None = None
    order_hint: int | None = None


class TimelineEventResponse(OrmModel):
    id: str
    novel_id: str
    title: str
    description: str
    story_time: str
    chapter_id: str | None = None
    order_hint: int
    created_at: datetime
    updated_at: datetime


# ---------- F10 多角色对话生成 ----------
class AIDialogueRequest(BaseModel):
    novel_id: str
    chapter_id: str | None = None
    character_ids: list[str] = Field(min_length=2, max_length=6)
    scene: str = Field(default="", max_length=500)
    config_id: int | None = None


# ---------- F12 WebDAV 备份 ----------
class WebDavConfigUpdate(BaseModel):
    """PUT /api/webdav/config。password: None=保留已存，""=清除，非空=覆盖（加密落库）。"""
    url: str | None = Field(default=None, max_length=255)
    username: str | None = Field(default=None, max_length=120)
    password: str | None = Field(default=None, max_length=500)
    keep: int | None = Field(default=None, ge=1, le=50)
