"""F5 灵感收集箱 — 碎片想法的一进一出：随手记 → 一键转化为
角色 / 伏笔 / 章节并回写转化标记。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Chapter, Character, ChapterStatus, Idea, Novel, PlotThread, ThreadPriority, ThreadStatus
from ..schemas import IdeaConvertRequest, IdeaCreate, IdeaResponse, IdeaUpdate
from ..utils import count_words
from .helpers import _get_novel

router = APIRouter()

_VALID_STATUSES = {"inbox", "discarded"}


def _idea(row: Idea) -> IdeaResponse:
    return IdeaResponse.model_validate(row)


def _get_idea(database: Session, idea_id: int) -> Idea:
    row = database.get(Idea, idea_id)
    if not row:
        raise HTTPException(status_code=404, detail="Idea not found")
    return row


@router.get("/ideas", response_model=list[IdeaResponse])
def list_ideas(novel_id: str | None = None, status: str | None = None,
               database: Session = Depends(get_db)):
    """novel_id 给定时返回该作品的灵感 + 全局灵感；不给则返回全部。
    status 过滤（inbox/discarded/converted）。"""
    stmt = select(Idea)
    if novel_id:
        stmt = stmt.where((Idea.novel_id == novel_id) | (Idea.novel_id.is_(None)))
    if status:
        if status not in _VALID_STATUSES | {"converted"}:
            raise HTTPException(status_code=422, detail="无效的 status 筛选")
        stmt = stmt.where(Idea.status == status)
    return [_idea(r) for r in database.scalars(stmt.order_by(Idea.created_at.desc()))]


@router.post("/ideas", response_model=IdeaResponse, status_code=201)
def create_idea(payload: IdeaCreate, database: Session = Depends(get_db)):
    if payload.novel_id:
        _get_novel(database, payload.novel_id)
    row = Idea(novel_id=payload.novel_id, content=payload.content.strip())
    database.add(row)
    database.commit()
    database.refresh(row)
    return _idea(row)


@router.put("/ideas/{idea_id}", response_model=IdeaResponse)
def update_idea(idea_id: int, payload: IdeaUpdate, database: Session = Depends(get_db)):
    row = _get_idea(database, idea_id)
    changes = payload.model_dump(exclude_none=True)
    if "content" in changes:
        row.content = changes["content"].strip()
    if "status" in changes:
        row.status = changes["status"]
    database.commit()
    database.refresh(row)
    return _idea(row)


@router.delete("/ideas/{idea_id}", status_code=204)
def delete_idea(idea_id: int, database: Session = Depends(get_db)):
    row = _get_idea(database, idea_id)
    database.delete(row)
    database.commit()


@router.post("/ideas/{idea_id}/convert", response_model=IdeaResponse)
def convert_idea(idea_id: int, payload: IdeaConvertRequest, database: Session = Depends(get_db)):
    """把灵感转化为目标实体：标题默认取内容前缀（可在目标页编辑），转化后
    灵感标记 converted 并记录 kind/id，方便回跳。"""
    row = _get_idea(database, idea_id)
    if row.status == "converted":
        raise HTTPException(status_code=409, detail="该灵感已转化过")
    novel = _get_novel(database, payload.novel_id)
    content = row.content.strip()
    title = (payload.title or "").strip() or content[:20]

    if payload.kind == "character":
        target = Character(novel_id=novel.id, name=title[:100], description=content)
        database.add(target)
        database.flush()
        row.converted_id = target.id
    elif payload.kind == "thread":
        target = PlotThread(
            novel_id=novel.id, title=title[:200], description=content,
            status=ThreadStatus.PLANTED, priority=ThreadPriority.MINOR,
        )
        database.add(target)
        database.flush()
        row.converted_id = target.id
    else:  # chapter
        next_order = database.scalar(
            select(Chapter.order).where(Chapter.novel_id == novel.id)
            .order_by(Chapter.order.desc()).limit(1)
        ) or 0
        target = Chapter(
            novel_id=novel.id, title=title[:200] or "灵感章节", content="",
            order=next_order + 1, word_count=count_words(""), status=ChapterStatus.DRAFT,
        )
        database.add(target)
        database.flush()
        # F2：新建章节正文为空，无需登场扫描。
        row.converted_id = target.id
    row.converted_kind = payload.kind
    row.status = "converted"
    database.commit()
    database.refresh(row)
    return _idea(row)
