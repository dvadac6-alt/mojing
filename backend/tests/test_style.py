"""F11 文风分析 — 指标纯函数 + 画像端点 + style_note 生成。"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.services.style import analyze_style, style_note_from_profile  # noqa: E402


def test_analyze_style_metrics():
    text = (
        "他推门进来，什么也没说。\n"          # 句1：9字（去空白后 9）
        "雨下了一整夜，屋檐的水线像帘子。\n"  # 句2
        "“你来了。”她说。\n"                   # 句3（含对话的段落）
        "他点头，坐下，把刀放在桌上。\n"       # 句4
    )
    p = analyze_style([text])
    assert p["total_chars"] > 0
    # “你来了。”她说。 里的引号内句号也切出一句 → 4 行共 5 句。
    assert p["sentences"] == 5
    assert 0 < p["avg_sentence_len"] <= 15
    assert p["dialogue_ratio"] == 0.25  # 4 段中 1 段含对话
    assert p["comma_per_1000"] > 0
    assert p["exclam_per_1000"] == 0


def test_analyze_style_empty():
    empty = analyze_style(["", "   "])
    assert empty["total_chars"] == 0 and empty["sentences"] == 0


def test_style_note_renders():
    p = analyze_style(["他说了。她走了。夜里很长，雨一直没停。"])
    note = style_note_from_profile(p)
    assert note.startswith("文风参考")
    assert "句均" in note and "对话" in note
    # 坏数据不炸——返回空串由调用方跳过。
    assert style_note_from_profile({}) == ""


def test_profile_endpoint_persists():
    from fastapi.testclient import TestClient
    from app.database import init_db
    from app.security import get_auth_token
    import main as main_mod

    init_db()
    client = TestClient(main_mod.app)
    headers = {"Authorization": f"Bearer {get_auth_token()}"}
    novel = client.post("/api/novels", headers=headers, json={"title": "文风测试"}).json()
    for i in range(3):
        client.post(f"/api/novels/{novel['id']}/chapters", headers=headers,
                    json={"title": f"c{i}", "content": "他推门。雨未停，灯还亮着。“你来了。”她说。"})

    r = client.post(f"/api/novels/{novel['id']}/style-profile", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["chapters_analyzed"] == 3 and body["total_chars"] > 0

    # 画像随 novel 详情返回（workspace / novels 列表）。
    listed = client.get("/api/novels", headers=headers).json()
    mine = next(n for n in listed if n["id"] == novel["id"])
    assert mine["style_profile"]["chapters_analyzed"] == 3
