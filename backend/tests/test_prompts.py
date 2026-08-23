"""F6 自定义 Prompt 模板 — CRUD。"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))


def test_prompt_templates_crud():
    from fastapi.testclient import TestClient
    from app.database import init_db
    from app.security import get_auth_token
    import main as main_mod

    init_db()
    client = TestClient(main_mod.app)
    headers = {"Authorization": f"Bearer {get_auth_token()}"}

    assert client.get("/api/prompt-templates", headers=headers).json() == []

    t1 = client.post("/api/prompt-templates", headers=headers,
                     json={"name": "环境描写", "content": "为当前场景补充克制的环境描写"}).json()
    t2 = client.post("/api/prompt-templates", headers=headers,
                     json={"name": "对话口语化", "content": "把这段对话改得更口语"}).json()
    listed = client.get("/api/prompt-templates", headers=headers).json()
    assert [t["id"] for t in listed] == [t1["id"], t2["id"]]

    r = client.put(f"/api/prompt-templates/{t1['id']}", headers=headers,
                   json={"name": "环境描写+"})
    assert r.json()["name"] == "环境描写+" and r.json()["content"] == t1["content"]

    assert client.delete(f"/api/prompt-templates/{t2['id']}", headers=headers).status_code == 204
    assert len(client.get("/api/prompt-templates", headers=headers).json()) == 1
    assert client.delete(f"/api/prompt-templates/{t2['id']}", headers=headers).status_code == 404
