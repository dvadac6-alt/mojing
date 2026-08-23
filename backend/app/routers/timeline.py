"""F8 时间线/大事记 — CRUD + AI 上下文格式化（纯函数部分可单测）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, load_only

from ..database import get_db
from ..models import Chapter, TimelineEvent
from ..schemas import TimelineEventCreate, TimelineEventResponse, TimelineEventUpdate
from .helpers import _get_novel

router = APIRouter()


def _event(row: TimelineEvent) -> TimelineEventResponse:
    return TimelineEventResponse.model_validate(row)


def _ordered_events(database: Session, novel_id: str) -> list[TimelineEvent]:
    """计划中（未挂章）置顶，其余按章节 order + order_hint 排序。"""
    events = database.scalars(
        select(TimelineEvent).where(TimelineEvent.novel_id == novel_id)
    ).all()
    chapter_orders = {
        c.id: c.order for c in database.scalars(
            select(Chapter).options(load_only(Chapter.id, Chapter.order))
            .where(Chapter.novel_id == novel_id)
        )
    }
    return sorted(
        events,
        key=lambda e: (
            0 if e.chapter_id is None else 1,                    # 计划中在前
            chapter_orders.get(e.chapter_id, 0) if e.chapter_id else 0,
            e.order_hint,
        ),
    )


@router.get("/novels/{novel_id}/timeline-events", response_model=list[TimelineEventResponse])
def list_events(novel_id: str, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    return [_event(e) for e in _ordered_events(database, novel_id)]


@router.post("/novels/{novel_id}/timeline-events", response_model=TimelineEventResponse, status_code=201)
def create_event(novel_id: str, payload: TimelineEventCreate, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    chapter_id = payload.chapter_id or None
    if chapter_id:
        chapter = database.get(Chapter, chapter_id)
        if not chapter or chapter.novel_id != novel_id:
            raise HTTPException(status_code=404, detail="Chapter not found")
    row = TimelineEvent(
        novel_id=novel_id, title=payload.title.strip(), description=payload.description,
        story_time=payload.story_time.strip(), chapter_id=chapter_id,
        order_hint=payload.order_hint,
    )
    database.add(row)
    database.commit()
    database.refresh(row)
    return _event(row)


def _get_event(database: Session, event_id: str) -> TimelineEvent:
    row = database.get(TimelineEvent, event_id)
    if not row:
        raise HTTPException(status_code=404, detail="Timeline event not found")
    return row


@router.put("/timeline-events/{event_id}", response_model=TimelineEventResponse)
def update_event(event_id: str, payload: TimelineEventUpdate, database: Session = Depends(get_db)):
    row = _get_event(database, event_id)
    changes = payload.model_dump(exclude_none=True)
    # "" 是"解除章节锚点"的显式信号（None = 不改动，Pydantic 语义如此约定）。
    if "chapter_id" in changes:
        anchor = changes.pop("chapter_id") or None
        if anchor:
            chapter = database.get(Chapter, anchor)
            if not chapter or chapter.novel_id != row.novel_id:
                raise HTTPException(status_code=404, detail="Chapter not found")
        row.chapter_id = anchor
    for field, value in changes.items():
        if field == "title" or field == "story_time":
            value = value.strip()
        setattr(row, field, value)
    database.commit()
    database.refresh(row)
    return _event(row)


@router.delete("/timeline-events/{event_id}", status_code=204)
def delete_event(event_id: str, database: Session = Depends(get_db)):
    row = _get_event(database, event_id)
    database.delete(row)
    database.commit()


# ---------------------------------------------------------------- AI 上下文注入
def format_events_for_context(rows: list[tuple[int, str, str, str, str]]) -> str:
    """rows = (chapter_order|0, chapter_title|"计划中", story_time, title, description)
    → 注入 prompt 的事件行。description 截断到 60 字保持上下文精简。"""
    lines = []
    for order, chapter_title, story_time, title, description in rows:
        where = "计划中" if order == 0 else f"第{order}章《{chapter_title}》"
        when = f"（{story_time}）" if story_time else ""
        brief = (description or "").strip()
        if len(brief) > 60:
            brief = brief[:60] + "…"
        line = f"- [{where}]{when} {title}" + (f"：{brief}" if brief else "")
        lines.append(line)
    return "\n".join(lines)
