from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .database import get_db
from .models import Chapter, ChapterStatus, ChapterVersion, Novel
from .schemas import ChapterCreate, ChapterResponse, ChapterUpdate, NovelResponse, WorkspaceResponse
from .seed import count_words


router = APIRouter(prefix="/api")


def chapter_response(chapter: Chapter) -> ChapterResponse:
    return ChapterResponse(
        id=chapter.id,
        novel_id=chapter.novel_id,
        title=chapter.title,
        content=chapter.content,
        order=chapter.order,
        word_count=chapter.word_count,
        status=chapter.status.value,
        created_at=chapter.created_at,
        updated_at=chapter.updated_at,
    )


def novel_response(novel: Novel, database: Session) -> NovelResponse:
    total_words = database.scalar(
        select(func.coalesce(func.sum(Chapter.word_count), 0)).where(Chapter.novel_id == novel.id)
    ) or 0
    chapter_count = database.scalar(
        select(func.count(Chapter.id)).where(Chapter.novel_id == novel.id)
    ) or 0
    return NovelResponse(
        id=novel.id,
        title=novel.title,
        description=novel.description,
        author=novel.author,
        genre=novel.genre,
        target_words=novel.target_words,
        status=novel.status.value,
        total_words=total_words,
        chapter_count=chapter_count,
    )


@router.get("/health")
def health():
    return {"status": "ok", "storage": "sqlite", "version": "0.2.0"}


@router.get("/workspace", response_model=WorkspaceResponse)
def get_workspace(database: Session = Depends(get_db)):
    novel = database.scalar(select(Novel).order_by(Novel.updated_at.desc()).limit(1))
    if not novel:
        raise HTTPException(status_code=404, detail="Workspace not found")
    chapters = database.scalars(
        select(Chapter).where(Chapter.novel_id == novel.id).order_by(Chapter.order)
    ).all()
    return WorkspaceResponse(
        novel=novel_response(novel, database),
        chapters=[chapter_response(chapter) for chapter in chapters],
    )


@router.post("/novels/{novel_id}/chapters", response_model=ChapterResponse, status_code=201)
def create_chapter(novel_id: str, payload: ChapterCreate, database: Session = Depends(get_db)):
    if not database.get(Novel, novel_id):
        raise HTTPException(status_code=404, detail="Novel not found")
    next_order = database.scalar(
        select(func.coalesce(func.max(Chapter.order), 0)).where(Chapter.novel_id == novel_id)
    ) or 0
    chapter = Chapter(
        novel_id=novel_id,
        title=payload.title.strip(),
        content=payload.content,
        order=next_order + 1,
        word_count=count_words(payload.content),
        status=ChapterStatus.DRAFT,
    )
    database.add(chapter)
    database.commit()
    database.refresh(chapter)
    return chapter_response(chapter)


@router.put("/chapters/{chapter_id}", response_model=ChapterResponse)
def update_chapter(chapter_id: str, payload: ChapterUpdate, database: Session = Depends(get_db)):
    chapter = database.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    changes = payload.model_dump(exclude_none=True)
    next_content = changes.get("content", chapter.content)
    content_changed = next_content != chapter.content

    if content_changed:
        current_version = database.scalar(
            select(func.coalesce(func.max(ChapterVersion.version_number), 0)).where(
                ChapterVersion.chapter_id == chapter.id
            )
        ) or 0
        database.add(
            ChapterVersion(
                chapter_id=chapter.id,
                content=chapter.content,
                word_count=chapter.word_count,
                version_number=current_version + 1,
            )
        )
        chapter.content = next_content
        chapter.word_count = count_words(next_content)

    if "title" in changes:
        chapter.title = changes["title"].strip()
    if "status" in changes:
        try:
            chapter.status = ChapterStatus(changes["status"])
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Invalid chapter status") from error

    database.commit()
    database.refresh(chapter)
    return chapter_response(chapter)

