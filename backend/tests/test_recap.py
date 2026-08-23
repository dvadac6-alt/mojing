"""F1 章节摘要链 — 滚动前情提要。

覆盖：build_recap 纯函数（降级/预算截断/结尾段）、GET /novels/{id}/recap
端点、PUT /chapters 的 summary 落库与 summary_updated_at 记录。
端点测试与 test_auth_and_datadir 相同的模式：dev app + 手动 init_db +
显式携带本地令牌（TestClient 的 client host 不是 loopback，走不了 dev 放行）。
"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.services.recap import RecapEntry, build_recap  # noqa: E402


def test_build_recap_empty():
    assert build_recap([]) == ""


def test_build_recap_recent_entries_carry_tail():
    entries = [
        RecapEntry(order=1, title="旧案", summary="主角发现旧案卷宗。"),
        RecapEntry(order=2, title="雨夜", summary="雨夜来客敲门。", tail="他敲了三下门，然后沉默。"),
        RecapEntry(order=3, title="长街", summary="长街尽头有人等他。", tail="灯灭了。"),
    ]
    text = build_recap(entries)
    # 更早章节只有摘要；最近两章附带结尾段。
    assert "第1章《旧案》：主角发现旧案卷宗。" in text
    assert "（本章结尾）他敲了三下门" in text
    assert "（本章结尾）灯灭了" in text
    # 章节顺序保持升序。
    assert text.index("第1章") < text.index("第2章") < text.index("第3章")


def test_build_recap_missing_summary_degrades_to_title():
    entries = [RecapEntry(order=1, title="空章"), RecapEntry(order=2, title="有摘", summary="内容。")]
    text = build_recap(entries, recent_full=0)
    assert "第1章《空章》" in text and "（未写摘要）" in text
    assert "第2章《有摘》：内容。" in text


def test_build_recap_budget_drops_oldest_first():
    entries = [
        RecapEntry(order=i, title=f"章{i}", summary="字" * 200)
        for i in range(1, 6)
    ]
    text = build_recap(entries, budget=500, recent_full=0)
    # 每行 ~210 字，预算 500 → 只留最新的两三章；最旧的必须被丢弃，
    # 最新的一章无论多长都保底保留。
    assert "第5章" in text
    assert "第1章" not in text


def test_build_recap_budget_always_keeps_newest():
    entries = [RecapEntry(order=1, title="a", summary="x" * 50), RecapEntry(order=2, title="b", summary="y" * 4000)]
    text = build_recap(entries, budget=100, recent_full=0)
    assert "第2章" in text


# ---------------------------------------------------------------- endpoints
def _client():
    from fastapi.testclient import TestClient
    from app.database import init_db
    from app.security import get_auth_token
    import main as main_mod

    init_db()
    client = TestClient(main_mod.app)
    headers = {"Authorization": f"Bearer {get_auth_token()}"}
    return client, headers


def _make_novel_with_chapters(client, headers):
    novel = client.post("/api/novels", headers=headers,
                        json={"title": "recap测试", "genre": "悬疑"}).json()
    chapters = []
    for i in range(1, 4):
        chapter = client.post(f"/api/novels/{novel['id']}/chapters", headers=headers,
                              json={"title": f"第{i}章", "content": f"第{i}章正文。" + "情节" * 10}).json()
        chapters.append(chapter)
    return novel, chapters


def test_recap_endpoint_and_summary_roundtrip():
    client, headers = _client()
    novel, chapters = _make_novel_with_chapters(client, headers)

    # 未写任何摘要：recap 降级为标题行 + 最近章结尾段，missing 计数为 3。
    r = client.get(f"/api/novels/{novel['id']}/recap", headers=headers,
                   params={"before_chapter_id": chapters[2]["id"]})
    assert r.status_code == 200
    body = r.json()
    assert body["chapters"] == 2  # 只含第 3 章之前
    assert body["missing_summaries"] == 2
    assert "第1章《第1章》" in body["recap"]
    assert "附本章结尾" in body["recap"]  # 无摘要的最近章仍带结尾段

    # 保存第 1 章摘要：落库 + summary_updated_at 记录。
    r = client.put(f"/api/chapters/{chapters[0]['id']}", headers=headers,
                   json={"summary": "主角入城，初闻旧案。"})
    assert r.status_code == 200
    updated = r.json()
    assert updated["summary"] == "主角入城，初闻旧案。"
    assert updated["summary_updated_at"] is not None
    # 只改摘要不触发正文版本快照。
    versions = client.get(f"/api/chapters/{chapters[0]['id']}/versions", headers=headers).json()
    assert versions == []

    # 再次取 recap：摘要进入拼装。
    body = client.get(f"/api/novels/{novel['id']}/recap", headers=headers,
                      params={"before_chapter_id": chapters[2]["id"]}).json()
    assert "主角入城，初闻旧案。" in body["recap"]
    assert body["missing_summaries"] == 1


def test_summarize_chapter_requires_chapter_id():
    client, headers = _client()
    novel = client.post("/api/novels", headers=headers, json={"title": "无章节"}).json()
    r = client.post("/api/ai/summarize-chapter", headers=headers,
                    json={"novel_id": novel["id"]})
    assert r.status_code == 422
