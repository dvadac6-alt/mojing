"""优化审查修复（optimization-report-2026-09.md）的回归测试。

覆盖：3.1 搜索上限与超长 q 拒绝 / 4.2 笔画序号唯一索引 / 5.1 导出临时
文件 / 5.2 图片 magic bytes 校验 / 5.3 导入符号链接拒绝。"""
import io
import sys
import zipfile
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))


def _client():
    from fastapi.testclient import TestClient
    from app.database import init_db
    from app.security import get_auth_token
    import main as main_mod

    init_db()
    client = TestClient(main_mod.app)
    headers = {"Authorization": f"Bearer {get_auth_token()}"}
    return client, headers


# ---------- 3.1 搜索上限 ----------
def test_search_respects_limit_and_q_length():
    client, headers = _client()
    novel = client.post("/api/novels", headers=headers, json={"title": "搜索上限"}).json()
    for i in range(60):
        client.post(f"/api/novels/{novel['id']}/chapters", headers=headers,
                    json={"title": f"章{i}", "content": "雨夜长街的旧案线索。"})
    r = client.get(f"/api/novels/{novel['id']}/search", headers=headers,
                   params={"q": "旧案", "limit": 50})
    assert r.status_code == 200
    data = r.json()
    assert len(data["chapters"]) <= 50
    assert data["semantic"] is False
    # 超长查询串直接 422，不进 SQL。
    r2 = client.get(f"/api/novels/{novel['id']}/search", headers=headers,
                    params={"q": "雨" * 200})
    assert r2.status_code == 422


# ---------- 4.2 笔画序号唯一索引 ----------
def test_map_stroke_seq_unique_index_present():
    from sqlalchemy import text
    from app.database import engine, init_db

    init_db()  # 建表 + 迁移都跑在本测试的临时引擎上
    with engine.connect() as conn:
        rows = conn.exec_driver_sql("PRAGMA index_list(map_strokes)").fetchall()
    names = {row[1] for row in rows}
    assert "uq_map_strokes_map_seq" in names
    # 索引确实是唯一的（index_list 第 3 列非 0 表示 unique）。
    unique = {row[1]: row[2] for row in rows}
    assert unique["uq_map_strokes_map_seq"] == 1


def test_map_stroke_migration_renumbers_duplicates(tmp_path, monkeypatch):
    """直接构造带重复序号的 map_strokes，跑迁移函数验证按 id 重编号 + 建索引。"""
    from sqlalchemy import create_engine
    from app.database import _migrate_map_stroke_seq_unique

    eng = create_engine(f"sqlite:///{(tmp_path / 't.db').as_posix()}")
    with eng.begin() as conn:
        conn.exec_driver_sql(
            "CREATE TABLE map_strokes (id INTEGER PRIMARY KEY, map_id TEXT, seq INTEGER)")
        # 同图两条 seq=1 的历史竞态 + 一条正常 seq=2。
        conn.exec_driver_sql(
            "INSERT INTO map_strokes (map_id, seq) VALUES ('m', 1), ('m', 1), ('m', 2)")
    monkeypatch.setattr("app.database.engine", eng)
    _migrate_map_stroke_seq_unique()
    with eng.connect() as conn:
        seqs = conn.exec_driver_sql(
            "SELECT id, seq FROM map_strokes ORDER BY id").fetchall()
        idx = conn.exec_driver_sql("PRAGMA index_list(map_strokes)").fetchall()
    assert [s for _, s in seqs] == [1, 2, 3]          # 按 id 保序重编号
    assert any(row[1] == "uq_map_strokes_map_seq" and row[2] == 1 for row in idx)


# ---------- 5.1 导出走临时文件 ----------
def test_export_streams_zip_and_cleans_up():
    from app.database import DATA_DIR

    client, headers = _client()
    r = client.get("/api/storage/export", headers=headers)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/zip")
    assert zipfile.is_zipfile(io.BytesIO(r.content))
    # BackgroundTask 在响应完成后删除临时文件。
    leftovers = list(DATA_DIR.parent.glob("mojing-export-*"))
    assert leftovers == []


# ---------- 5.2 上传 magic bytes ----------
def test_cover_upload_rejects_disguised_file():
    client, headers = _client()
    novel = client.post("/api/novels", headers=headers, json={"title": "封面上传"}).json()
    # 声称 image/png，内容是文本 → 400。
    r = client.post(f"/api/novels/{novel['id']}/cover",
                    headers={**headers, "Content-Type": "image/png"},
                    content=b"this is definitely not an image")
    assert r.status_code == 400


# ---------- 5.3 导入拒绝符号链接条目 ----------
def test_import_rejects_symlink_entries(tmp_path):
    from fastapi import HTTPException
    from app.routers.system import _extract_import_zip

    zip_path = tmp_path / "evil.zip"
    with zipfile.ZipFile(zip_path, "w") as zf:
        info = zipfile.ZipInfo("link.txt")
        # unix symlink 模式位（0o120000 << 16）。
        info.external_attr = 0o120000 << 16
        zf.writestr(info, "/etc/passwd")
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    with pytest.raises(HTTPException) as exc:
        _extract_import_zip(zip_path, data_dir)
    assert "不是普通文件" in exc.value.detail
