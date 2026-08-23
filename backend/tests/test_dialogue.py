"""F10 多角色对话生成 — 校验（少于 2 人 / 角色不存在）与 SSE 通路。"""
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


def test_dialogue_validation_and_stream():
    client, headers = _client()
    novel = client.post("/api/novels", headers=headers, json={"title": "对话测试"}).json()
    a = client.post(f"/api/novels/{novel['id']}/characters", headers=headers,
                    json={"name": "沈砚", "personality": "克制、话少", "description": "捕头"}).json()
    b = client.post(f"/api/novels/{novel['id']}/characters", headers=headers,
                    json={"name": "柳三变", "personality": "洒脱、爱调侃", "description": "乐师",
                          "relationships": {"沈砚": "旧识，欠他一条命"}}).json()

    # 少于 2 人 → 422（Pydantic min_length）。
    r = client.post("/api/ai/dialogue", headers=headers,
                    json={"novel_id": novel["id"], "character_ids": [a["id"]], "scene": "酒楼"})
    assert r.status_code == 422
    # 角色不属于该作品 → 404。
    r = client.post("/api/ai/dialogue", headers=headers,
                    json={"novel_id": novel["id"], "character_ids": [a["id"], "不存在的id"], "scene": ""})
    assert r.status_code == 404
    # 正常请求 → SSE 流（mock 离线模型也走同一条通路，以 data: 事件返回）。
    r = client.post("/api/ai/dialogue", headers=headers,
                    json={"novel_id": novel["id"], "character_ids": [a["id"], b["id"]], "scene": "雨夜酒楼对坐"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    assert "data:" in r.text
