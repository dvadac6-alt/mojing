"""System endpoints: health/readiness, storage location, cross-device
export/import, and rolling backups."""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from ..database import reset_data_dir, session_scope, set_data_dir, storage_info
from ..schemas import LintWordlistImport, LintWordlistUpdate, StoragePathUpdate, WebDavConfigUpdate

logger = logging.getLogger(__name__)
router = APIRouter()

# Captured once at import so the desktop shell can tell a real Mojing backend
# apart from whatever else might happen to be listening on the same port.
_INSTANCE_PID = os.getpid()
_INSTANCE_STARTED_AT = time.time()

# ---------------------------------------------------------------- backup (#2)
@router.post("/backup")
def create_backup():
    """On-demand snapshot via the online backup API. Safe under load."""
    from ..backup import backup_once
    result = backup_once()
    if not result:
        raise HTTPException(status_code=409, detail="No database to back up yet")
    return result


@router.get("/backups")
def list_backups_endpoint():
    """Recent rolling backups (newest-first) for the settings page."""
    from ..backup import list_backups, should_daily_backup
    return {"backups": list_backups(), "daily_due": should_daily_backup()}


def _daily_backup_if_due():
    """Best-effort first-write-of-day backup. The file backup (sqlite3 backup
    over the whole DB) runs in a daemon thread so the save request that
    triggered it doesn't stall on disk I/O. F12: 备份成功后若配置了 WebDAV，
    在同一线程里顺势上传（失败只记日志，绝不影响本地备份）。"""
    from ..backup import backup_once, should_daily_backup

    def _run():
        try:
            if should_daily_backup():
                result = backup_once()
                if result:
                    _upload_backup_if_configured(result)
        except Exception:
            logger.warning("daily backup trigger failed", exc_info=True)

    threading.Thread(target=_run, daemon=True, name="daily-backup").start()


def _upload_backup_if_configured(result: dict) -> None:
    """F12 每日备份后的自动 WebDAV 上传（fire-and-forget）。"""
    try:
        from ..models import WebDavConfig
        from ..services.webdav import upload_backup
        with session_scope() as database:
            cfg = database.get(WebDavConfig, 1)
            if not cfg or not cfg.url:
                return
            ok, detail = upload_backup(cfg, result["path"], result["name"])
        if ok:
            logger.info("webdav backup uploaded: %s", detail)
        else:
            logger.warning("webdav backup upload failed: %s", detail)
    except Exception:
        logger.warning("webdav auto upload failed", exc_info=True)


# ---------------------------------------------------------------- webdav backup (F12)
@router.get("/webdav/config")
def get_webdav_config():
    from ..models import WebDavConfig
    from ..security import decrypt_key
    with session_scope() as database:
        cfg = database.get(WebDavConfig, 1)
        return {
            "configured": bool(cfg and cfg.url),
            "url": cfg.url if cfg else "",
            "username": cfg.username if cfg else "",
            "has_password": bool(cfg and decrypt_key(cfg.password)),
            "keep": cfg.keep if cfg else 5,
        }


@router.put("/webdav/config")
def save_webdav_config(payload: WebDavConfigUpdate):
    from ..models import WebDavConfig
    from ..security import encrypt_key
    with session_scope() as database:
        cfg = database.get(WebDavConfig, 1)
        if not cfg:
            cfg = WebDavConfig(id=1)
            database.add(cfg)
        changes = payload.model_dump(exclude_none=True)
        if "url" in changes:
            cfg.url = changes["url"].strip().rstrip("/")
        if "username" in changes:
            cfg.username = changes["username"].strip()
        if "password" in changes:
            # None=保留（exclude_none 已滤）；""=清除；非空=覆盖（加密落库）。
            cfg.password = encrypt_key(changes["password"])
        if "keep" in changes:
            cfg.keep = changes["keep"]
        database.commit()
    return get_webdav_config()


@router.post("/webdav/config/test")
def test_webdav_config():
    """连接测试（用已保存的配置）。前端先保存再测试，避免明文密码走请求体。"""
    from ..models import WebDavConfig
    from ..services.webdav import probe
    with session_scope() as database:
        cfg = database.get(WebDavConfig, 1)
        if not cfg or not cfg.url:
            return {"ok": False, "detail": "尚未配置 WebDAV 地址"}
        ok, detail = probe(cfg)
    return {"ok": ok, "detail": detail}


@router.post("/webdav/backup/upload")
def upload_backup_to_webdav():
    """立即备份并上传（设置页手动触发）。"""
    from ..backup import backup_once
    from ..models import WebDavConfig
    from ..services.webdav import upload_backup

    result = backup_once()
    if not result:
        raise HTTPException(status_code=409, detail="No database to back up yet")
    with session_scope() as database:
        cfg = database.get(WebDavConfig, 1)
        if not cfg or not cfg.url:
            raise HTTPException(status_code=422, detail="尚未配置 WebDAV")
        ok, detail = upload_backup(cfg, result["path"], result["name"])
    return {"ok": ok, "detail": detail, "name": result["name"], "size_kb": result["size_kb"]}


# ---------------------------------------------------------------- health / workspace
@router.get("/health")
def health():
    """Open endpoint (no token) used by the desktop shell to (a) wait for the
    backend to come up and (b) confirm the port owner is actually Mojing via
    the pid/started_at fingerprint.

    Security (#7, tightened): the bearer token is no longer returned here — the
    Electron shell reads it directly from storage.json (the same file the
    backend persists it to), so no local process can curl an open endpoint and
    walk away with full API access."""
    age = time.time() - _INSTANCE_STARTED_AT
    return {
        "status": "ok",
        "storage": "sqlite",
        "version": "0.3.0",
        "app": "mojing",
        "pid": _INSTANCE_PID,
        "started_at": _INSTANCE_STARTED_AT,
        "handshake_open": age < 60,
    }


# ---------------------------------------------------------------- storage / data location
@router.get("/storage")
def get_storage():
    return storage_info()


@router.post("/storage/path")
def set_storage_path(payload: StoragePathUpdate):
    data_dir = payload.data_dir.strip()
    if not data_dir:
        raise HTTPException(status_code=422, detail="data_dir is required")
    try:
        return set_data_dir(data_dir)
    except OSError as error:
        raise HTTPException(status_code=400, detail=f"无法使用该路径：{error}") from error


@router.post("/storage/reset")
def reset_storage_path():
    return reset_data_dir()


# ---------------------------------------------------------------- lint wordlist (F3)
def _lint_data_dir() -> Path:
    """词库随数据目录走：运行期切换 data dir 后这里拿到的是新目录。"""
    from .. import database
    return Path(database.DATA_DIR)


@router.get("/wordlists/sensitive")
def get_sensitive_words():
    from ..services.lint import load_sensitive_words
    words = load_sensitive_words(_lint_data_dir())
    return {"words": words, "count": len(words)}


@router.put("/wordlists/sensitive")
def replace_sensitive_words(payload: LintWordlistUpdate):
    from ..services.lint import load_sensitive_words, save_sensitive_words
    save_sensitive_words(_lint_data_dir(), payload.words)
    words = load_sensitive_words(_lint_data_dir())
    return {"words": words, "count": len(words)}


@router.post("/wordlists/sensitive/import")
def import_sensitive_words(payload: LintWordlistImport):
    """追加导入（与已有词库合并去重），不覆盖用户手动添加的词。"""
    from ..services.lint import load_sensitive_words, parse_wordlist_text, save_sensitive_words
    existing = load_sensitive_words(_lint_data_dir())
    merged = sorted(set(existing) | set(parse_wordlist_text(payload.content)))
    count = save_sensitive_words(_lint_data_dir(), merged)
    return {"count": count, "added": count - len(existing)}


# ---------------------------------------------------------------- naming tool (F9)
@router.get("/tools/names")
def generate_names(kind: str = Query("person"), count: int = Query(10, ge=1, le=20)):
    """本地词库随机起名（人名/地名/门派/功法/丹药）。不调 AI、不上传任何数据。"""
    from ..services.naming import KIND_LABELS, generate
    try:
        names = generate(kind, count, _lint_data_dir())
    except KeyError as error:
        raise HTTPException(
            status_code=422,
            detail=f"无效的类别「{kind}」，可选：{'、'.join(KIND_LABELS)}",
        ) from error
    return {"kind": kind, "label": KIND_LABELS.get(kind, kind), "names": names}


# ---------------------------------------------------------------- cross-device export / import (#8)
@router.get("/storage/export")
def export_data():
    """Bundle the whole data dir into a zip for backup / moving to another
    machine. WAL is checkpointed first so the snapshot is self-contained (no
    -wal/-shm sidecar files needed to restore). The rolling backups/ folder and
    the local logs/ folder are excluded — backups can hold up to 10 full DB
    copies (and re-import would re-snapshot them, compounding every round-trip);
    logs are machine-local diagnostics, not user data."""
    import io
    import zipfile
    from ..database import DATA_DIR, engine
    with engine.connect() as conn:
        conn.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")
        conn.commit()
    buf = io.BytesIO()
    base = DATA_DIR
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in base.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(base)
            if rel.parts and rel.parts[0] in ("backups", "logs"):
                continue
            zf.write(path, rel)
    buf.seek(0)
    fname = f"mojing-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# Zip-bomb guardrails for /storage/import: a malicious or corrupted backup can
# claim tiny compressed sizes but expand to gigabytes. Cap the request body,
# entry count, total *uncompressed* size, and per-entry compression ratio
# before extractall touches the disk.
_IMPORT_MAX_BODY = 1 * 1024 * 1024 * 1024        # 1 GB request body
_IMPORT_MAX_FILES = 2_000
_IMPORT_MAX_UNCOMPRESSED = 2 * 1024 * 1024 * 1024  # 2 GB expanded total
_IMPORT_MAX_RATIO = 100                          # file_size / compress_size


def _extract_import_zip(zip_path: Path, data_dir: Path) -> Path:
    """Validate + extract an uploaded backup zip (sync, runs in a worker
    thread). Raises HTTPException on any guardrail breach; returns the target
    directory containing the extracted data."""
    import zipfile
    try:
        zf = zipfile.ZipFile(zip_path)
    except zipfile.BadZipFile as error:
        raise HTTPException(status_code=400, detail="不是有效的 zip 备份") from error
    with zf:
        # Reject absolute paths / parent traversal (zip-slip).
        unsafe = [n for n in zf.namelist() if n.startswith("/") or ".." in n.split("/")]
        if unsafe:
            raise HTTPException(status_code=400, detail="压缩包含不安全路径，已拒绝")
        # Zip-bomb guardrails: cap entry count, total uncompressed size and
        # per-entry compression ratio *before* extracting anything.
        infos = zf.infolist()
        if len(infos) > _IMPORT_MAX_FILES:
            raise HTTPException(status_code=400, detail=f"备份内文件数过多（{len(infos)}），已拒绝")
        total = 0
        for info in infos:
            total += info.file_size
            if info.compress_size > 0 and info.file_size / info.compress_size > _IMPORT_MAX_RATIO \
                    and info.file_size > 10 * 1024 * 1024:
                raise HTTPException(
                    status_code=400,
                    detail=f"「{info.filename}」压缩比异常（疑似 zip 炸弹），已拒绝",
                )
        if total > _IMPORT_MAX_UNCOMPRESSED:
            raise HTTPException(status_code=400, detail="备份解压后超过 2GB，已拒绝")
        target = data_dir.parent / f"墨境数据-imported-{int(time.time())}"
        target.mkdir(parents=True, exist_ok=True)
        zf.extractall(target)
    if not (target / "mojing.db").exists():
        raise HTTPException(status_code=400, detail="备份中未找到 mojing.db，确认是否为墨境备份")
    return target


@router.post("/storage/import")
async def import_data(request: Request):
    """Restore from a backup zip: extract into a fresh sibling directory and
    switch to it via set_data_dir (rebinds the engine + persists the choice).
    The previous data dir is left intact on disk, so a bad import is revertible
    by pointing storage back at the old folder."""
    from ..database import DATA_DIR, set_data_dir
    # Stream the body to a temp file, enforcing the size cap as bytes arrive —
    # `await request.body()` used to buffer the whole (up to 1GB) upload in RAM
    # before the limit was even checked.
    tmp = tempfile.NamedTemporaryFile(prefix="mojing-import-", suffix=".zip", delete=False)
    tmp_name = tmp.name
    received = 0
    try:
        async for chunk in request.stream():
            received += len(chunk)
            if received > _IMPORT_MAX_BODY:
                raise HTTPException(status_code=413, detail="备份过大（>1GB），请检查是否选错了文件")
            tmp.write(chunk)
        tmp.close()
        if not received:
            raise HTTPException(status_code=400, detail="未收到备份内容")
        # Validation + extraction are CPU/disk-bound sync work — keep them off
        # the event loop so heartbeats/other requests stay responsive.
        target = await asyncio.to_thread(_extract_import_zip, Path(tmp_name), DATA_DIR)
    finally:
        try:
            tmp.close()
        except Exception:
            pass
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
    return set_data_dir(target)
