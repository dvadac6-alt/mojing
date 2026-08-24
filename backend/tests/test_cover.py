"""作品封面 — 上传/读取/替换/删除 + 删除作品时清理封面文件。"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# 1x1 红色 PNG（最小合法图片，仅测试用）。
PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108020000009077"
    "53de0000000c4944415408d763f8cfc00000030101"
    "00c9fe92ef0000000049454e44ae426082"
)


def _client():
    from fastapi.testclient import TestClient
    from app.database import init_db
    from app.security import get_auth_token
    import main as main_mod

    init_db()
    client = TestClient(main_mod.app)
    headers = {"Authorization": f"Bearer {get_auth_token()}"}
    return client, headers


def test_cover_upload_get_delete_cycle():
    client, headers = _client()
    nid = client.post("/api/novels", headers=headers, json={"title": "封面测试"}).json()["id"]

    # 未设置封面：GET 404，列表里 cover_image 为空串。
    assert client.get(f"/api/novels/{nid}/cover", headers=headers).status_code == 404
    assert client.get("/api/novels", headers=headers).json()[0]["cover_image"] == ""

    # 上传 → 字段落库 + 文件落盘 + GET 回读字节一致。
    up = client.post(f"/api/novels/{nid}/cover",
                     headers={**headers, "Content-Type": "image/png"}, content=PNG_1PX)
    assert up.status_code == 200, up.text
    assert up.json()["cover_image"] == f"{nid}.png"
    got = client.get(f"/api/novels/{nid}/cover", headers=headers)
    assert got.status_code == 200
    assert got.content == PNG_1PX

    # 删除封面 → 字段清空 + GET 404；幂等（再删不报错）。
    deleted = client.delete(f"/api/novels/{nid}/cover", headers=headers)
    assert deleted.status_code == 200
    assert deleted.json()["cover_image"] == ""
    assert client.get(f"/api/novels/{nid}/cover", headers=headers).status_code == 404
    assert client.delete(f"/api/novels/{nid}/cover", headers=headers).status_code == 200


def test_cover_upload_rejects_bad_content_type_and_empty_body():
    client, headers = _client()
    nid = client.post("/api/novels", headers=headers, json={"title": "封面校验"}).json()["id"]

    bad_type = client.post(f"/api/novels/{nid}/cover",
                           headers={**headers, "Content-Type": "text/plain"}, content=b"hello")
    assert bad_type.status_code == 415

    empty = client.post(f"/api/novels/{nid}/cover",
                        headers={**headers, "Content-Type": "image/png"}, content=b"")
    assert empty.status_code == 400

    missing = client.post("/api/novels/does-not-exist/cover",
                          headers={**headers, "Content-Type": "image/png"}, content=PNG_1PX)
    assert missing.status_code == 404


def test_delete_novel_removes_cover_file():
    from app.database import DATA_DIR
    client, headers = _client()
    nid = client.post("/api/novels", headers=headers, json={"title": "封面清理"}).json()["id"]
    client.post(f"/api/novels/{nid}/cover",
                headers={**headers, "Content-Type": "image/png"}, content=PNG_1PX)
    cover_path = DATA_DIR / "novel_covers" / f"{nid}.png"
    assert cover_path.exists()

    assert client.delete(f"/api/novels/{nid}", headers=headers).status_code == 204
    assert not cover_path.exists()
