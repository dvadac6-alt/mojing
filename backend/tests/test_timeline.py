"""F8 时间线/大事记 — CRUD/排序/章节删除转计划中 + 上下文格式化。"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.routers.timeline import format_events_for_context  # noqa: E402


def test_format_events_lines():
    text = format_events_for_context([
        (0, "", "第三年春", "旧案重启", "沈砚翻出三年前的卷宗。"),
        (4, "雨夜", "", "来客被杀", ""),
    ])
    assert "- [计划中]（第三年春） 旧案重启：沈砚翻出三年前的卷宗。" in text
    assert "- [第4章《雨夜》] 来客被杀" in text


def _client():
    from fastapi.testclient import TestClient
    from app.database import init_db
    from app.security import get_auth_token
    import main as main_mod

    init_db()
    client = TestClient(main_mod.app)
    headers = {"Authorization": f"Bearer {get_auth_token()}"}
    return client, headers


def test_timeline_crud_ordering_and_unanchor():
    client, headers = _client()
    novel = client.post("/api/novels", headers=headers, json={"title": "时间线测试"}).json()
    nid = novel["id"]
    c1 = client.post(f"/api/novels/{nid}/chapters", headers=headers, json={"title": "起风"}).json()
    c2 = client.post(f"/api/novels/{nid}/chapters", headers=headers, json={"title": "落雨"}).json()

    # 挂章事件 + 计划中事件。
    e2 = client.post(f"/api/novels/{nid}/timeline-events", headers=headers,
                     json={"title": "落雨夜的命案", "story_time": "第三年春", "chapter_id": c2["id"]}).json()
    e1 = client.post(f"/api/novels/{nid}/timeline-events", headers=headers,
                     json={"title": "旧案重启", "description": "翻出卷宗。", "chapter_id": c1["id"]}).json()
    plan = client.post(f"/api/novels/{nid}/timeline-events", headers=headers,
                       json={"title": "终局对决（计划）"}).json()

    listed = client.get(f"/api/novels/{nid}/timeline-events", headers=headers).json()
    ids = [e["id"] for e in listed]
    assert ids == [plan["id"], e1["id"], e2["id"]]  # 计划中置顶 → 章节顺序

    # 更新：解除锚点（chapter_id 传 ""）→ 归入计划中。
    r = client.put(f"/api/timeline-events/{e1['id']}", headers=headers, json={"chapter_id": ""})
    assert r.json()["chapter_id"] is None
    listed = client.get(f"/api/novels/{nid}/timeline-events", headers=headers).json()
    assert listed[0]["id"] == e1["id"] or listed[1]["id"] == e1["id"]

    # 删除章节 → 事件 SET NULL 转计划中，不消失。
    client.delete(f"/api/chapters/{c2['id']}", headers=headers)
    body = client.get(f"/api/novels/{nid}/timeline-events", headers=headers).json()
    by_id = {e["id"]: e for e in body}
    assert by_id[e2["id"]]["chapter_id"] is None

    # 一致性检查包含时间线摘要。
    findings = client.post("/api/ai/check-consistency", headers=headers,
                           json={"novel_id": nid}).json()["findings"]
    assert any("时间线共 3 个事件" in f["message"] for f in findings)

    # 删除事件。
    assert client.delete(f"/api/timeline-events/{plan['id']}", headers=headers).status_code == 204
    assert len(client.get(f"/api/novels/{nid}/timeline-events", headers=headers).json()) == 2
