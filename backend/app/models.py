import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, JSON, String, Text, func
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
    world_settings: Mapped[list["WorldSetting"]] = relationship(
        back_populates="novel", cascade="all, delete-orphan", order_by="WorldSetting.created_at"
    )
    plot_threads: Mapped[list["PlotThread"]] = relationship(
        back_populates="novel", cascade="all, delete-orphan", order_by="PlotThread.created_at"
    )


class Chapter(Base):
    __tablename__ = "chapters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    novel_id: Mapped[str] = mapped_column(String(36), ForeignKey("novels.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[ChapterStatus] = mapped_column(Enum(ChapterStatus), default=ChapterStatus.DRAFT, nullable=False)
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    novel_id: Mapped[str] = mapped_column(String(36), ForeignKey("novels.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    type: Mapped[str] = mapped_column(String(50), default="", nullable=False)
    parent_location_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("locations.id", ondelete="SET NULL"), nullable=True)
    first_appearance_chapter_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("chapters.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    novel: Mapped[Novel] = relationship(back_populates="locations")
    children: Mapped[list["Location"]] = relationship(
        back_populates="parent", cascade="all, delete-orphan"
    )
    parent: Mapped["Location | None"] = relationship(
        back_populates="children", remote_side="Location.id", foreign_keys=[parent_location_id]
    )


class WorldSetting(Base):
    __tablename__ = "world_settings"

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
    is_active: Mapped[bool] = mapped_column(default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class AIUsage(Base):
    """Per-call token accounting for AI generations. One row per completed
    streaming generation; aggregated by day/model on the overview usage panel."""
    __tablename__ = "ai_usage"

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
