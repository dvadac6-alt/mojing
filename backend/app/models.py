import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class NovelStatus(str, enum.Enum):
    PLANNING = "planning"
    WRITING = "writing"
    COMPLETED = "completed"


class ChapterStatus(str, enum.Enum):
    DRAFT = "draft"
    WRITING = "writing"
    COMPLETED = "completed"


class ThreadStatus(str, enum.Enum):
    PLANTED = "planted"
    HINTED = "hinted"
    DEVELOPING = "developing"
    RESOLVED = "resolved"


class ThreadPriority(str, enum.Enum):
    MAJOR = "major"
    MINOR = "minor"
    DETAIL = "detail"


class Novel(Base):
    __tablename__ = "novels"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    author: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    genre: Mapped[str] = mapped_column(String(50), default="", nullable=False)
    target_words: Mapped[int] = mapped_column(Integer, default=200_000, nullable=False)
    status: Mapped[NovelStatus] = mapped_column(Enum(NovelStatus), default=NovelStatus.WRITING, nullable=False)
    # F11 文风画像：analyze_style 的结果 JSON；存在时续写 prompt 注入文风约束。
    style_profile: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # 封面图文件名（DATA_DIR/novel_covers/ 下；空 = 未设置，卡片用色调占位）。
    cover_image: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    chapters: Mapped[list["Chapter"]] = relationship(
        back_populates="novel",
        cascade="all, delete-orphan",
        order_by="Chapter.order",
    )
    characters: Mapped[list["Character"]] = relationship(
        back_populates="novel", cascade="all, delete-orphan", order_by="Character.created_at"
    )
    locations: Mapped[list["Location"]] = relationship(
        back_populates="novel", cascade="all, delete-orphan", order_by="Location.created_at"
    )
    maps: Mapped[list["StoryMap"]] = relationship(
        back_populates="novel", cascade="all, delete-orphan", order_by="StoryMap.created_at"
    )
    world_settings: Mapped[list["WorldSetting"]] = relationship(
        back_populates="novel", cascade="all, delete-orphan", order_by="WorldSetting.created_at"
    )
    plot_threads: Mapped[list["PlotThread"]] = relationship(
        back_populates="novel", cascade="all, delete-orphan", order_by="PlotThread.created_at"
    )


class Chapter(Base):
    __tablename__ = "chapters"

    # Hot query paths (list-by-novel / strokes-by-map) hit these columns on
    # every request; SQLite does not index FK columns on its own.
    __table_args__ = (
        (Index("ix_chapters_novel_id", "novel_id"),)
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    novel_id: Mapped[str] = mapped_column(String(36), ForeignKey("novels.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[ChapterStatus] = mapped_column(Enum(ChapterStatus), default=ChapterStatus.DRAFT, nullable=False)
    # ── F1 章节摘要链：AI 生成/手写的剧情摘要。滚动前情提要（续写上下文注入）
    #    的数据源；summary_updated_at 用于判断"正文在摘要之后又改过"（过期提示）。
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    summary_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    novel: Mapped[Novel] = relationship(back_populates="chapters")
    versions: Mapped[list["ChapterVersion"]] = relationship(
        back_populates="chapter",
        cascade="all, delete-orphan",
        order_by="ChapterVersion.version_number",
    )
    scenes: Mapped[list["Scene"]] = relationship(
        back_populates="chapter",
        cascade="all, delete-orphan",
        order_by="Scene.order",
    )


class ChapterVersion(Base):
    __tablename__ = "chapter_versions"

    # Hot query paths (list-by-novel / strokes-by-map) hit these columns on
    # every request; SQLite does not index FK columns on its own.
    __table_args__ = (
        (Index("ix_chapter_versions_chapter_id", "chapter_id"),)
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    chapter_id: Mapped[str] = mapped_column(String(36), ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(String(40), default="auto", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    chapter: Mapped[Chapter] = relationship(back_populates="versions")


class Scene(Base):
    """A beat/scene under a chapter — the second level of the outline mind map.
    Deleted together with its chapter (cascade)."""
    __tablename__ = "scenes"

    # Hot query paths (list-by-novel / strokes-by-map) hit these columns on
    # every request; SQLite does not index FK columns on its own.
    __table_args__ = (
        (Index("ix_scenes_chapter_id", "chapter_id"),)
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    chapter_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    chapter: Mapped[Chapter] = relationship(back_populates="scenes")


class GraphEdge(Base):
    """A user-drawn connector between two nodes on an outline mind map
    (chapters / threads / characters), optionally with a small text label.
    `kind` scopes an edge to one of the three graphs; from_id/to_id reference
    the node ids of that graph (chapter/scene/thread/character). Auto-edges
    (e.g. a thread's related_threads) are never stored here — only manual ones."""
    __tablename__ = "graph_edges"

    # Hot query paths (list-by-novel / strokes-by-map) hit these columns on
    # every request; SQLite does not index FK columns on its own.
    __table_args__ = (
        (Index("ix_graph_edges_novel_id", "novel_id"),)
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    novel_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("novels.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    from_id: Mapped[str] = mapped_column(String(36), nullable=False)
    to_id: Mapped[str] = mapped_column(String(36), nullable=False)
    label: Mapped[str] = mapped_column(String(60), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Character(Base):
    __tablename__ = "characters"

    # Hot query paths (list-by-novel / strokes-by-map) hit these columns on
    # every request; SQLite does not index FK columns on its own.
    __table_args__ = (
        (Index("ix_characters_novel_id", "novel_id"),)
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    novel_id: Mapped[str] = mapped_column(String(36), ForeignKey("novels.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    aliases: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    role: Mapped[str] = mapped_column(String(50), default="", nullable=False)
    color: Mapped[str] = mapped_column(String(20), default="#5b6b66", nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    personality: Mapped[str] = mapped_column(Text, default="", nullable=False)
    background: Mapped[str] = mapped_column(Text, default="", nullable=False)
    appearance: Mapped[str] = mapped_column(Text, default="", nullable=False)
    abilities: Mapped[str] = mapped_column(Text, default="", nullable=False)
    relationships: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    first_appearance_chapter_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("chapters.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    novel: Mapped[Novel] = relationship(back_populates="characters")


class Location(Base):
    __tablename__ = "locations"

    # Hot query paths (list-by-novel / strokes-by-map) hit these columns on
    # every request; SQLite does not index FK columns on its own.
    __table_args__ = (
        (Index("ix_locations_novel_id", "novel_id"), Index("ix_locations_map_id", "map_id"),)
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    novel_id: Mapped[str] = mapped_column(String(36), ForeignKey("novels.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    type: Mapped[str] = mapped_column(String(50), default="", nullable=False)
    parent_location_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True)
    map_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("story_maps.id", ondelete="SET NULL"), nullable=True)
    first_appearance_chapter_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("chapters.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    novel: Mapped[Novel] = relationship(back_populates="locations")
    story_map: Mapped["StoryMap | None"] = relationship(back_populates="locations")
    children: Mapped[list["Location"]] = relationship(
        back_populates="parent", cascade="all, delete-orphan"
    )
    parent: Mapped["Location | None"] = relationship(
        back_populates="children", remote_side="Location.id", foreign_keys=[parent_location_id]
    )


class StoryMap(Base):
    """A map canvas inside a novel — different maps are different realms/areas
    (e.g. 凡界 / 灵界 after a xianxia ascension). Each map owns its terrains
    (named colors) and the free-hand doodle strokes drawn on its canvas."""

    __tablename__ = "story_maps"

    # Hot query paths (list-by-novel / strokes-by-map) hit these columns on
    # every request; SQLite does not index FK columns on its own.
    __table_args__ = (
        (Index("ix_story_maps_novel_id", "novel_id"),)
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    novel_id: Mapped[str] = mapped_column(String(36), ForeignKey("novels.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    # Stroke list: [{color, width, eraser, points: [[x%, y%], ...]}] — points are
    # stored as percentages so the canvas stays proportional at any size.
    doodles: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    # Filename of an optional uploaded background image (stored under
    # DATA_DIR/map_backgrounds/). Empty = use the default parchment background.
    background_image: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    novel: Mapped[Novel] = relationship(back_populates="maps")
    terrains: Mapped[list["Terrain"]] = relationship(
        back_populates="map", cascade="all, delete-orphan", order_by="Terrain.created_at"
    )
    strokes: Mapped[list["MapStroke"]] = relationship(
        back_populates="map", cascade="all, delete-orphan", order_by="MapStroke.seq"
    )
    locations: Mapped[list[Location]] = relationship(back_populates="story_map")


class Terrain(Base):
    """A named color used for doodling (绿色=草地, 紫色=沼泽, ...)."""

    __tablename__ = "terrains"

    # Hot query paths (list-by-novel / strokes-by-map) hit these columns on
    # every request; SQLite does not index FK columns on its own.
    __table_args__ = (
        (Index("ix_terrains_map_id", "map_id"),)
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    map_id: Mapped[str] = mapped_column(String(36), ForeignKey("story_maps.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    map: Mapped[StoryMap] = relationship(back_populates="terrains")


class MapStroke(Base):
    """A single free-hand stroke on a map canvas. Stored one-row-per-stroke so
    appending / undoing / clearing is O(1) instead of rewriting the whole
    doodle blob on every pen-up. Points are 0-100 percentages (size-independent)."""

    __tablename__ = "map_strokes"

    # Hot query paths (list-by-novel / strokes-by-map) hit these columns on
    # every request; SQLite does not index FK columns on its own.
    __table_args__ = (
        (Index("ix_map_strokes_map_seq", "map_id", "seq"), Index("ix_map_strokes_map_color", "map_id", "color"),)
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    map_id: Mapped[str] = mapped_column(String(36), ForeignKey("story_maps.id", ondelete="CASCADE"), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False)
    width: Mapped[float] = mapped_column(Float, nullable=False, default=6)
    eraser: Mapped[bool] = mapped_column(default=False, nullable=False)
    # 'path' = free-hand line (points are [[x%,y%], ...] along the stroke);
    # 'rect' = grid-fill brush (points are [[x1%,y1%,x2%,y2%], ...] rectangle
    # corners — one entry per filled grid cell, so a 2×2 drag is 4 corners).
    shape: Mapped[str] = mapped_column(String(20), default="path", nullable=False)
    points: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    map: Mapped[StoryMap] = relationship(back_populates="strokes")


class WorldSetting(Base):
    __tablename__ = "world_settings"

    # Hot query paths (list-by-novel / strokes-by-map) hit these columns on
    # every request; SQLite does not index FK columns on its own.
    __table_args__ = (
        (Index("ix_world_settings_novel_id", "novel_id"),)
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    novel_id: Mapped[str] = mapped_column(String(36), ForeignKey("novels.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(50), default="世界规则", nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    related_settings: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    chapter_references: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    novel: Mapped[Novel] = relationship(back_populates="world_settings")


class PlotThread(Base):
    __tablename__ = "plot_threads"

    # Hot query paths (list-by-novel / strokes-by-map) hit these columns on
    # every request; SQLite does not index FK columns on its own.
    __table_args__ = (
        (Index("ix_plot_threads_novel_id", "novel_id"),)
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    novel_id: Mapped[str] = mapped_column(String(36), ForeignKey("novels.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[ThreadStatus] = mapped_column(Enum(ThreadStatus), default=ThreadStatus.PLANTED, nullable=False)
    priority: Mapped[ThreadPriority] = mapped_column(Enum(ThreadPriority), default=ThreadPriority.MINOR, nullable=False)
    planted_chapter_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("chapters.id", ondelete="SET NULL"), nullable=True
    )
    resolved_chapter_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("chapters.id", ondelete="SET NULL"), nullable=True
    )
    related_characters: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    related_locations: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    related_threads: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    novel: Mapped[Novel] = relationship(back_populates="plot_threads")


class CharacterAppearance(Base):
    """F2 角色登场追踪：章节保存时扫描正文命中的角色名/别名（含 Character.aliases
    顿号分隔项），一章一角色一行。空窗章数（距最新章）由查询时按章节 order 计算。"""

    __tablename__ = "character_appearances"

    __table_args__ = (
        Index("ix_character_appearances_novel", "novel_id"),
        Index("ix_character_appearances_chapter", "chapter_id"),
        UniqueConstraint("character_id", "chapter_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    novel_id: Mapped[str] = mapped_column(String(36), ForeignKey("novels.id", ondelete="CASCADE"), nullable=False)
    character_id: Mapped[str] = mapped_column(String(36), ForeignKey("characters.id", ondelete="CASCADE"), nullable=False)
    chapter_id: Mapped[str] = mapped_column(String(36), ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False)
    hits: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class AIConfig(Base):
    __tablename__ = "ai_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    provider: Mapped[str] = mapped_column(String(40), default="openai", nullable=False)
    name: Mapped[str] = mapped_column(String(80), default="默认模型", nullable=False)
    model: Mapped[str] = mapped_column(String(120), default="mock", nullable=False)
    base_url: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    api_key: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    temperature: Mapped[float] = mapped_column(Float, default=0.85, nullable=False)
    max_tokens: Mapped[int] = mapped_column(Integer, default=1200, nullable=False)
    # Model context window (tokens) fetched from the provider's /models metadata.
    context_length: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    # ── RAG embedding 配置（embed_model 为空 = 未启用语义检索）──
    # embed_base_url / embed_api_key 为空时回退到生成配置的 base_url / api_key。
    embed_base_url: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    embed_model: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    embed_api_key: Mapped[str] = mapped_column(String(255), default="", nullable=False)


class RagConfig(Base):
    """RAG embedding 的独立配置（单例行，id=1）：与写作模型完全解耦——
    写作用 A 家 API、检索向量化可用 B 家，互不影响。"""
    __tablename__ = "rag_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    base_url: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    model: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    api_key: Mapped[str] = mapped_column(String(255), default="", nullable=False)  # 加密存储
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class WebDavConfig(Base):
    """F12 WebDAV 备份配置（单例行，id=1）。密码用 ai_config 同款加密存储；
    keep = 远端保留份数（超出轮换删除）。"""

    __tablename__ = "webdav_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    url: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    username: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    password: Mapped[str] = mapped_column(String(255), default="", nullable=False)  # 加密存储
    keep: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class DocumentChunk(Base):
    """RAG 索引块：正文章节与资料库共用。embedding 为 float32 数组序列化的 BLOB；
    NULL 表示待向量化（API 失败时落库，下次保存补齐）。"""
    __tablename__ = "document_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    novel_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    source_type: Mapped[str] = mapped_column(String(20), default="chapter", nullable=False, index=True)
    source_id: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    embedding: Mapped[bytes | None] = mapped_column(nullable=True)
    embedding_model: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class LibraryDoc(Base):
    """资料库文档（写作参考素材）。novel_id 为空表示全部作品共享。"""
    __tablename__ = "library_docs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    novel_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(50), default="写作技法", nullable=False)
    source: Mapped[str] = mapped_column(String(20), default="txt", nullable=False)
    size_chars: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Idea(Base):
    """F5 灵感收集箱：随手记的碎片想法，可一键转化为角色/伏笔/章节。
    novel_id 为空 = 全局灵感（不属于任何作品，转化时再指定目标）。"""

    __tablename__ = "ideas"

    __table_args__ = (
        Index("ix_ideas_novel_status", "novel_id", "status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    novel_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("novels.id", ondelete="CASCADE"), nullable=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # inbox = 待处理 / converted = 已转化 / discarded = 已丢弃
    status: Mapped[str] = mapped_column(String(20), default="inbox", nullable=False)
    converted_kind: Mapped[str] = mapped_column(String(20), default="", nullable=False)
    converted_id: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class PromptTemplate(Base):
    """F6 自定义 Prompt 模板：用户沉淀的常用 AI 写作指令，点击即填入
    AI 面板的"写作要求"。全局共享（不挂作品）。"""

    __tablename__ = "prompt_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class TimelineEvent(Base):
    """F8 时间线/大事记：按章节锚点排序的故事事件。

    story_time 是自由文本（"第三年春""大战后三日"）——网文纪年体系千奇百怪，
    强制结构化是伪需求；排序一律按章节 order（挂章事件）+ order_hint（同章内），
    story_time 只做展示。chapter_id 为空 = 计划中事件；删除章节时 SET NULL
    转为计划中（事件是作者资产，不应随章节消失）。"""

    __tablename__ = "timeline_events"

    __table_args__ = (
        Index("ix_timeline_events_novel", "novel_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    novel_id: Mapped[str] = mapped_column(String(36), ForeignKey("novels.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    story_time: Mapped[str] = mapped_column(String(60), default="", nullable=False)
    chapter_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("chapters.id", ondelete="SET NULL"), nullable=True
    )
    order_hint: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class AIUsage(Base):
    """Per-call token accounting for AI generations. One row per completed
    streaming generation; aggregated by day/model on the overview usage panel."""
    __tablename__ = "ai_usage"

    # Hot query paths (list-by-novel / strokes-by-map) hit these columns on
    # every request; SQLite does not index FK columns on its own.
    __table_args__ = (
        (Index("ix_ai_usage_novel_created", "novel_id", "created_at"),)
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    novel_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("novels.id", ondelete="SET NULL"), nullable=True
    )
    model: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    mode: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
