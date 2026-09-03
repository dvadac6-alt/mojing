"""Story maps (realms), named terrains, incremental doodle strokes, and
uploaded background images."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import MapStroke, StoryMap, Terrain
from ..schemas import (
    StoryMapCreate, StoryMapResponse, StoryMapUpdate,
    StrokeCreate, StrokeResponse,
    TerrainCreate, TerrainResponse, TerrainUpdate,
)
from .helpers import _get_novel, _story_map, _stroke, _terrain, sniff_image_ext

router = APIRouter()

# ---------------------------------------------------------------- story maps (realms)
@router.get("/novels/{novel_id}/maps", response_model=list[StoryMapResponse])
def list_maps(novel_id: str, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    return [_story_map(m) for m in database.scalars(
        select(StoryMap).where(StoryMap.novel_id == novel_id).order_by(StoryMap.created_at))]


@router.post("/novels/{novel_id}/maps", response_model=StoryMapResponse, status_code=201)
def create_map(novel_id: str, payload: StoryMapCreate, database: Session = Depends(get_db)):
    _get_novel(database, novel_id)
    story_map = StoryMap(novel_id=novel_id, **payload.model_dump())
    database.add(story_map)
    database.commit()
    database.refresh(story_map)
    return _story_map(story_map)


@router.put("/maps/{map_id}", response_model=StoryMapResponse)
def update_map(map_id: str, payload: StoryMapUpdate, database: Session = Depends(get_db)):
    story_map = database.get(StoryMap, map_id)
    if not story_map:
        raise HTTPException(status_code=404, detail="Map not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(story_map, field, value)
    database.commit()
    database.refresh(story_map)
    return _story_map(story_map)


@router.delete("/maps/{map_id}", status_code=204)
def delete_map(map_id: str, database: Session = Depends(get_db)):
    story_map = database.get(StoryMap, map_id)
    if not story_map:
        raise HTTPException(status_code=404, detail="Map not found")
    database.delete(story_map)  # terrains cascade; locations keep map_id → NULL
    database.commit()


# ---------------------------------------------------------------- terrains (named colors)
@router.get("/maps/{map_id}/terrains", response_model=list[TerrainResponse])
def list_terrains(map_id: str, database: Session = Depends(get_db)):
    if not database.get(StoryMap, map_id):
        raise HTTPException(status_code=404, detail="Map not found")
    return [_terrain(t) for t in database.scalars(
        select(Terrain).where(Terrain.map_id == map_id).order_by(Terrain.created_at))]


@router.post("/maps/{map_id}/terrains", response_model=TerrainResponse, status_code=201)
def create_terrain(map_id: str, payload: TerrainCreate, database: Session = Depends(get_db)):
    if not database.get(StoryMap, map_id):
        raise HTTPException(status_code=404, detail="Map not found")
    terrain = Terrain(map_id=map_id, **payload.model_dump())
    database.add(terrain)
    database.commit()
    database.refresh(terrain)
    return _terrain(terrain)


@router.put("/terrains/{terrain_id}", response_model=TerrainResponse)
def update_terrain(terrain_id: str, payload: TerrainUpdate, database: Session = Depends(get_db)):
    terrain = database.get(Terrain, terrain_id)
    if not terrain:
        raise HTTPException(status_code=404, detail="Terrain not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(terrain, field, value)
    database.commit()
    database.refresh(terrain)
    return _terrain(terrain)


@router.delete("/terrains/{terrain_id}", status_code=204)
def delete_terrain(terrain_id: str, database: Session = Depends(get_db)):
    terrain = database.get(Terrain, terrain_id)
    if not terrain:
        raise HTTPException(status_code=404, detail="Terrain not found")
    database.delete(terrain)
    database.commit()


# ---------------------------------------------------------------- map strokes (incremental doodles)
@router.get("/maps/{map_id}/strokes", response_model=list[StrokeResponse])
def list_strokes(map_id: str, database: Session = Depends(get_db)):
    if not database.get(StoryMap, map_id):
        raise HTTPException(status_code=404, detail="Map not found")
    return [_stroke(s) for s in database.scalars(
        select(MapStroke).where(MapStroke.map_id == map_id).order_by(MapStroke.seq))]


@router.post("/maps/{map_id}/strokes", response_model=StrokeResponse, status_code=201)
def create_stroke(map_id: str, payload: StrokeCreate, database: Session = Depends(get_db)):
    if not database.get(StoryMap, map_id):
        raise HTTPException(status_code=404, detail="Map not found")
    # seq = current max + 1, so order is stable without a timestamp tiebreak.
    # 优化审查 4.2：(map_id, seq) 唯一索引兜住并发竞态——撞上时重读 max 重试。
    from sqlalchemy.exc import IntegrityError
    stroke = None
    for attempt in range(3):
        next_seq = (database.scalar(
            select(func.max(MapStroke.seq)).where(MapStroke.map_id == map_id)) or 0) + 1
        stroke = MapStroke(map_id=map_id, seq=next_seq, **payload.model_dump())
        database.add(stroke)
        try:
            database.commit()
            break
        except IntegrityError:
            database.rollback()
            if attempt == 2:
                raise HTTPException(status_code=409, detail="笔画保存冲突，请重试")
    database.refresh(stroke)
    return _stroke(stroke)


@router.delete("/maps/{map_id}/strokes/last", status_code=204)
def undo_last_stroke(map_id: str, database: Session = Depends(get_db)):
    """Undo = drop the highest-seq stroke. O(1) instead of rewriting the whole blob."""
    if not database.get(StoryMap, map_id):
        raise HTTPException(status_code=404, detail="Map not found")
    last = database.scalar(
        select(MapStroke).where(MapStroke.map_id == map_id).order_by(MapStroke.seq.desc()).limit(1))
    if last:
        database.delete(last)
        database.commit()


@router.delete("/maps/{map_id}/strokes", status_code=204)
def clear_strokes(map_id: str, database: Session = Depends(get_db)):
    if not database.get(StoryMap, map_id):
        raise HTTPException(status_code=404, detail="Map not found")
    database.query(MapStroke).filter(MapStroke.map_id == map_id).delete(synchronize_session=False)
    database.commit()


@router.delete("/maps/{map_id}/strokes/by-color")
def clear_strokes_by_color(map_id: str, color: str = Query(...), database: Session = Depends(get_db)):
    """Drop every stroke of one color — used by the terrain panel's per-color
    delete (removes both the paint and, from the UI's view, the terrain entry)."""
    if not database.get(StoryMap, map_id):
        raise HTTPException(status_code=404, detail="Map not found")
    count = database.query(MapStroke).filter(
        MapStroke.map_id == map_id, MapStroke.color == color
    ).delete(synchronize_session=False)
    database.commit()
    return {"deleted": count}


# ---------------------------------------------------------------- map background image
_ALLOWED_BG_TYPES = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif",
}


def _background_dir() -> Path:
    from ..database import DATA_DIR
    d = DATA_DIR / "map_backgrounds"
    d.mkdir(parents=True, exist_ok=True)
    return d


_ALLOWED_BG_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def _background_path(background_image: str) -> Path | None:
    """Resolve a stored background filename to a path inside map_backgrounds/,
    or None if it isn't a plain filename with an allowed extension. The value
    comes from the DB — a malicious imported database could store '../../...'
    or an absolute path, so never trust it for direct joining (path traversal)."""
    filename = Path(background_image)
    if filename.name != background_image or not filename.suffix:
        return None
    if filename.suffix.lower() not in _ALLOWED_BG_EXTS:
        return None
    path = _background_dir() / filename
    if path.parent.resolve() != _background_dir().resolve():
        return None
    return path


@router.get("/maps/{map_id}/background")
def get_map_background(map_id: str, database: Session = Depends(get_db)):
    """Stream the uploaded background image for a map. Returns 404 (no body) if
    none set, so the frontend can fall back to the default parchment background."""
    story_map = database.get(StoryMap, map_id)
    if not story_map or not story_map.background_image:
        raise HTTPException(status_code=404, detail="No background image")
    path = _background_path(story_map.background_image)
    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail="Background file missing")
    return FileResponse(path)


@router.post("/maps/{map_id}/background", response_model=StoryMapResponse)
async def upload_map_background(map_id: str, request: Request, database: Session = Depends(get_db)):
    """Accept a raw image body (Content-Type image/*) and store it as the map's
    background. The image lives under DATA_DIR/map_backgrounds/, keyed by map id
    so re-uploading replaces cleanly."""
    story_map = database.get(StoryMap, map_id)
    if not story_map:
        raise HTTPException(status_code=404, detail="Map not found")
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    ext = _ALLOWED_BG_TYPES.get(content_type)
    if not ext:
        raise HTTPException(
            status_code=415,
            detail=f"仅支持图片格式：{', '.join(_ALLOWED_BG_TYPES.values())}",
        )
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="未收到图片内容")
    # A few MB is plenty for a map background; reject anything absurd.
    if len(body) > 12 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="图片过大（>12MB），请压缩后上传")
    # 优化审查 5.2：同封面上传——magic bytes 验真实格式，扩展名以真实格式为准。
    sniffed = sniff_image_ext(body)
    if not sniffed or f".{sniffed}" not in _ALLOWED_BG_TYPES.values():
        raise HTTPException(
            status_code=400,
            detail="文件内容不是有效的图片（PNG/JPG/WebP/GIF），可能已损坏或伪装",
        )
    ext = f".{sniffed}"
    filename = f"{map_id}{ext}"
    (_background_dir() / filename).write_bytes(body)
    # Remove a previous file with a different extension (e.g. png → jpg swap).
    # _background_path refuses traversal-style names that could delete or
    # touch files outside map_backgrounds/ (value may come from an imported DB).
    if story_map.background_image and story_map.background_image != filename:
        old = _background_path(story_map.background_image)
        if old and old.exists():
            try:
                old.unlink()
            except OSError:
                pass
    story_map.background_image = filename
    database.commit()
    database.refresh(story_map)
    return _story_map(story_map)


@router.delete("/maps/{map_id}/background", response_model=StoryMapResponse)
def delete_map_background(map_id: str, database: Session = Depends(get_db)):
    story_map = database.get(StoryMap, map_id)
    if not story_map:
        raise HTTPException(status_code=404, detail="Map not found")
    if story_map.background_image:
        old = _background_path(story_map.background_image)
        if old and old.exists():
            try:
                old.unlink()
            except OSError:
                pass
        story_map.background_image = ""
        database.commit()
        database.refresh(story_map)
    return _story_map(story_map)


