import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
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


class ChapterVersion(Base):
    __tablename__ = "chapter_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    chapter_id: Mapped[str] = mapped_column(String(36), ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    chapter: Mapped[Chapter] = relationship(back_populates="versions")

