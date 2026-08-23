"""F5 灵感收集箱 — CRUD + 全局/作品灵感 + 三类转化。"""
import sys
from pathlib import Path

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


def test_ideas_crud_scope_and_convert():
    client, headers = _client()
    n1 = client.post("/api/novels", headers=headers, json={"title": "灵感A"}).json()
    n2 = client.post("/api/novels", headers=headers, json={"title": "灵感B"}).json()

    # 作品灵感 + 全局灵感。
    a1 = client.post("/api/ideas", headers=headers,
                     json={"novel_id": n1["id"], "content": "让配角在雨夜递出一把伞"}).json()
    g1 = client.post("/api/ideas", headers=headers, json={"content": "写一个只出现三次的扫地僧"}).json()

    # 范围：n1 的列表含作品 + 全局；n2 的列表只含全局。
    ids1 = {i["id"] for i in client.get(f"/api/ideas?novel_id={n1['id']}", headers=headers).json()}
    ids2 = {i["id"] for i in client.get(f"/api/ideas?novel_id={n2['id']}", headers=headers).json()}
    assert {a1["id"], g1["id"]} <= ids1
    assert g1["id"] in ids2 and a1["id"] not in ids2

    # 编辑 + 丢弃。
    r = client.put(f"/api/ideas/{a1['id']}", headers=headers, json={"content": "改成雪夜"})
    assert r.json()["content"] == "改成雪夜"
    r = client.put(f"/api/ideas/{a1['id']}", headers=headers, json={"status": "discarded"})
    assert r.json()["status"] == "discarded"
    # converted 不允许经 PUT 手动设置（防绕过转化端点）。
    assert client.put(f"/api/ideas/{a1['id']}", headers=headers, json={"status": "converted"}).status_code == 422

    # 三类转化。
    for kind in ("character", "thread", "chapter"):
        idea = client.post("/api/ideas", headers=headers,
                           json={"novel_id": n1["id"], "content": f"{kind}素材：一条灵感"}).json()
        r = client.post(f"/api/ideas/{idea['id']}/convert", headers=headers,
                        json={"kind": kind, "novel_id": n1["id"]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "converted" and body["converted_kind"] == kind
        assert body["converted_id"]
        # 重复转化 → 409。
        again = client.post(f"/api/ideas/{idea['id']}/convert", headers=headers,
                            json={"kind": kind, "novel_id": n1["id"]})
        assert again.status_code == 409

    # 转化确实创建了实体：角色 1、伏笔 1、章节 1（标题取内容前缀）。
    chars = client.get(f"/api/novels/{n1['id']}/characters", headers=headers).json()
    threads = client.get(f"/api/novels/{n1['id']}/plot-threads", headers=headers).json()
    chapters = client.get(f"/api/novels/{n1['id']}/chapters", headers=headers).json()
    assert len(chars) == 1 and len(threads) == 1 and len(chapters) == 1
    assert chars[0]["name"].startswith("character素材")

    # 删除作品 → 其灵感级联清理，全局灵感保留。
    client.delete(f"/api/novels/{n1['id']}", headers=headers)
    all_ids = {i["id"] for i in client.get("/api/ideas", headers=headers).json()}
    assert a1["id"] not in all_ids and g1["id"] in all_ids

    # 全局灵感转化时必须指定存在的作品。
    r = client.post(f"/api/ideas/{g1['id']}/convert", headers=headers,
                    json={"kind": "thread", "novel_id": n2["id"]})
    assert r.status_code == 200
    # 删除灵感。
    assert client.delete(f"/api/ideas/{g1['id']}", headers=headers).status_code == 204
