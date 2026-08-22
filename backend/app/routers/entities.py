"""Characters, locations, world settings, and plot threads — the
reference data the writing context is built from."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Character, Location, PlotThread, ThreadPriority, ThreadStatus, WorldSetting
from ..schemas import (
    CharacterCreate, CharacterResponse, CharacterUpdate,
    LocationCreate, LocationResponse, LocationUpdate,
    PlotThreadCreate, PlotThreadResolve, PlotThreadResponse, PlotThreadUpdate,
    WorldSettingCreate, WorldSettingResponse, WorldSettingUpdate,
)
from .helpers import _character, _get_novel, _location, _setting, _thread

router = APIRouter()

# ---------------------------------------------------------------- characters
@router.get("/novels/{novel_id}/characters", response_model=list[CharacterResponse])
def list_characters(novel_id: str, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    return [_character(c) for c in database.scalars(
        select(Character).where(Character.novel_id == novel_id).order_by(Character.created_at))]


@router.post("/novels/{novel_id}/characters", response_model=CharacterResponse, status_code=201)
def create_character(novel_id: str, payload: CharacterCreate, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    character = Character(novel_id=novel_id, **payload.model_dump())
    database.add(character)
    database.commit()
    database.refresh(character)
    return _character(character)


@router.put("/characters/{character_id}", response_model=CharacterResponse)
def update_character(character_id: str, payload: CharacterUpdate, database: Session = Depends(get_db)):
    character = database.get(Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(character, field, value)
    database.commit()
    database.refresh(character)
    return _character(character)


@router.delete("/characters/{character_id}", status_code=204)
def delete_character(character_id: str, database: Session = Depends(get_db)):
    character = database.get(Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    database.delete(character)
    database.commit()


# ---------------------------------------------------------------- locations
@router.get("/novels/{novel_id}/locations", response_model=list[LocationResponse])
def list_locations(novel_id: str, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    return [_location(l) for l in database.scalars(
        select(Location).where(Location.novel_id == novel_id).order_by(Location.created_at))]


@router.post("/novels/{novel_id}/locations", response_model=LocationResponse, status_code=201)
def create_location(novel_id: str, payload: LocationCreate, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    location = Location(novel_id=novel_id, **payload.model_dump())
    database.add(location)
    database.commit()
    database.refresh(location)
    return _location(location)


@router.put("/locations/{location_id}", response_model=LocationResponse)
def update_location(location_id: str, payload: LocationUpdate, database: Session = Depends(get_db)):
    location = database.get(Location, location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(location, field, value)
    database.commit()
    database.refresh(location)
    return _location(location)


@router.delete("/locations/{location_id}", status_code=204)
def delete_location(location_id: str, database: Session = Depends(get_db)):
    location = database.get(Location, location_id)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    database.delete(location)
    database.commit()


# ---------------------------------------------------------------- world settings
@router.get("/novels/{novel_id}/settings", response_model=list[WorldSettingResponse])
def list_settings(novel_id: str, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    return [_setting(s) for s in database.scalars(
        select(WorldSetting).where(WorldSetting.novel_id == novel_id).order_by(WorldSetting.created_at))]


@router.post("/novels/{novel_id}/settings", response_model=WorldSettingResponse, status_code=201)
def create_setting(novel_id: str, payload: WorldSettingCreate, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    setting = WorldSetting(novel_id=novel_id, **payload.model_dump())
    database.add(setting)
    database.commit()
    database.refresh(setting)
    return _setting(setting)


@router.put("/settings/{setting_id}", response_model=WorldSettingResponse)
def update_setting(setting_id: str, payload: WorldSettingUpdate, database: Session = Depends(get_db)):
    setting = database.get(WorldSetting, setting_id)
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(setting, field, value)
    database.commit()
    database.refresh(setting)
    return _setting(setting)


@router.delete("/settings/{setting_id}", status_code=204)
def delete_setting(setting_id: str, database: Session = Depends(get_db)):
    setting = database.get(WorldSetting, setting_id)
    if not setting:
        raise HTTPException(status_code=404, detail="Setting not found")
    database.delete(setting)
    database.commit()


# ---------------------------------------------------------------- plot threads
@router.get("/novels/{novel_id}/plot-threads", response_model=list[PlotThreadResponse])
def list_threads(novel_id: str, status: str | None = None, priority: str | None = None,
                 database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    # Invalid enum values must answer 422 (client error), not blow up as 500.
    try:
        status_enum = ThreadStatus(status) if status else None
        priority_enum = ThreadPriority(priority) if priority else None
    except ValueError as error:
        raise HTTPException(status_code=422, detail=f"无效的筛选参数：{error}") from error
    stmt = select(PlotThread).where(PlotThread.novel_id == novel_id)
    if status_enum:
        stmt = stmt.where(PlotThread.status == status_enum)
    if priority_enum:
        stmt = stmt.where(PlotThread.priority == priority_enum)
    return [_thread(t) for t in database.scalars(stmt.order_by(PlotThread.created_at))]


@router.get("/novels/{novel_id}/plot-threads/unresolved", response_model=list[PlotThreadResponse])
def list_unresolved(novel_id: str, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    stmt = select(PlotThread).where(PlotThread.novel_id == novel_id, PlotThread.status != ThreadStatus.RESOLVED)
    return [_thread(t) for t in database.scalars(stmt.order_by(PlotThread.created_at))]


@router.get("/novels/{novel_id}/plot-thread-web")
def plot_thread_web(novel_id: str, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    threads = database.scalars(select(PlotThread).where(PlotThread.novel_id == novel_id)).all()
    nodes = [{"id": t.id, "title": t.title, "status": t.status.value, "priority": t.priority.value} for t in threads]
    edges = []
    for t in threads:
        for other in t.related_threads or []:
            edges.append({"from": t.id, "to": other})
    return {"nodes": nodes, "edges": edges}


@router.post("/novels/{novel_id}/plot-threads", response_model=PlotThreadResponse, status_code=201)
def create_thread(novel_id: str, payload: PlotThreadCreate, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    data = payload.model_dump()
    try:
        data["status"] = ThreadStatus(data["status"])
        data["priority"] = ThreadPriority(data["priority"])
    except ValueError as e:
        raise HTTPException(status_code=422, detail="Invalid thread status/priority") from e
    thread = PlotThread(novel_id=novel_id, **data)
    database.add(thread)
    database.commit()
    database.refresh(thread)
    return _thread(thread)


@router.get("/plot-threads/{thread_id}", response_model=PlotThreadResponse)
def get_thread(thread_id: str, database: Session = Depends(get_db)):
    thread = database.get(PlotThread, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return _thread(thread)


@router.put("/plot-threads/{thread_id}", response_model=PlotThreadResponse)
def update_thread(thread_id: str, payload: PlotThreadUpdate, database: Session = Depends(get_db)):
    thread = database.get(PlotThread, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    changes = payload.model_dump(exclude_none=True)
    if "status" in changes:
        try:
            thread.status = ThreadStatus(changes.pop("status"))
        except ValueError as e:
            raise HTTPException(status_code=422, detail="Invalid thread status") from e
    if "priority" in changes:
        try:
            thread.priority = ThreadPriority(changes.pop("priority"))
        except ValueError as e:
            raise HTTPException(status_code=422, detail="Invalid thread priority") from e
    for field, value in changes.items():
        setattr(thread, field, value)
    database.commit()
    database.refresh(thread)
    return _thread(thread)


@router.put("/plot-threads/{thread_id}/resolve", response_model=PlotThreadResponse)
def resolve_thread(thread_id: str, payload: PlotThreadResolve, database: Session = Depends(get_db)):
    thread = database.get(PlotThread, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    thread.status = ThreadStatus.RESOLVED
    thread.resolved_chapter_id = payload.resolved_chapter_id
    database.commit()
    database.refresh(thread)
    return _thread(thread)


@router.delete("/plot-threads/{thread_id}", status_code=204)
def delete_thread(thread_id: str, database: Session = Depends(get_db)):
    thread = database.get(PlotThread, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    database.delete(thread)
    database.commit()


