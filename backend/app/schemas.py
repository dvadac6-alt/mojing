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
    first_appearance_chapter_id: str | None = None


class LocationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    type: str | None = None
    parent_location_id: str | None = None
    first_appearance_chapter_id: str | None = None


class LocationResponse(OrmModel):
    id: str
    novel_id: str
    name: str
    description: str
    type: str
    parent_location_id: str | None = None
    first_appearance_chapter_id: str | None = None
    created_at: datetime
    updated_at: datetime


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


class AIGenerateRequest(BaseModel):
    novel_id: str
    chapter_id: str | None = None
    instruction: str = ""
    mode: str = "continue"
    target_words: int = 800
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


# ---------- Workspace / misc ----------
class WorkspaceResponse(BaseModel):
    novel: NovelResponse
    chapters: list[ChapterResponse]


class NovelDetailResponse(OrmModel):
    novel: NovelResponse
    chapters: list[ChapterSummary]
    scenes: list[SceneSummary]
    characters: list[CharacterResponse]
    locations: list[LocationResponse]
    world_settings: list[WorldSettingResponse]
    plot_threads: list[PlotThreadResponse]
    graph_edges: list[GraphEdgeOut]


class ExportRequest(BaseModel):
    format: str = "txt"
    chapter_ids: list[str] | None = None


class SearchRequest(BaseModel):
    q: str = Field(min_length=1)


class SearchResponse(BaseModel):
    chapters: list[dict[str, Any]]
    characters: list[dict[str, Any]]
    threads: list[dict[str, Any]]
