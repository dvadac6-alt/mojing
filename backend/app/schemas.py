from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class NovelResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    description: str
    author: str
    genre: str
    target_words: int
    status: str
    total_words: int = 0
    chapter_count: int = 0


class ChapterResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    novel_id: str
    title: str
    content: str
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


class WorkspaceResponse(BaseModel):
    novel: NovelResponse
    chapters: list[ChapterResponse]

