"""F3 发布前自检 — lint 纯函数 + 词库端点 + 章节自检端点。

敏感词库不内置：全部由用户手动维护（PUT 整表 / import 追加）。
"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.services.lint import (  # noqa: E402
    lint_text, parse_wordlist_text,
)


def test_lint_sensitive_word_offsets():
    issues = lint_text("他握紧了刀，刀光一闪。", ["刀"])
    hits = [i for i in issues if i["type"] == "sensitive"]
    assert [i["offset"] for i in hits] == [4, 6]  # 他0握1紧2了3刀4，5刀6
    assert hits[0]["word"] == "刀"


def test_lint_duplicate_and_punct_and_quotes():
    text = "我的的感受！！！好极了吗，。"  # 的的 + ！！！ + ，。相邻
    issues = lint_text(text, [])
    types = {i["type"] for i in issues}
    assert "duplicate" in types
    assert "punct" in types
    dup = next(i for i in issues if i["type"] == "duplicate")
    assert dup["word"] == "的的"
    # 省略号（两个 U+2026）不算连续标点。
    assert lint_text("他说……然后沉默……", [])[0:] == [] or all(
        i["type"] != "punct" or "……" not in i["word"] for i in lint_text("他说……", [])
    )
    # 引号不配对
    quote_issues = [i for i in lint_text("“你好。”他说：“再见。", []) if "引号" in i["message"]]
    assert len(quote_issues) == 1


def test_lint_empty_text():
    assert lint_text("", ["任何"]) == []


def test_parse_wordlist_text():
    words = parse_wordlist_text("刀\n血腥、暴力\nkill, dead\n\n  空行跳过  ")
    assert words == ["dead", "kill", "刀", "暴力", "空行跳过", "血腥"]


def _client():
    from fastapi.testclient import TestClient
    from app.database import init_db
    from app.security import get_auth_token
    import main as main_mod

    init_db()
    client = TestClient(main_mod.app)
    headers = {"Authorization": f"Bearer {get_auth_token()}"}
    return client, headers


def test_wordlist_and_lint_endpoints():
    client, headers = _client()
    # 手动添加词（整表替换语义）。
    r = client.put("/api/wordlists/sensitive", headers=headers, json={"words": ["刀", "血腥"]})
    assert r.status_code == 200 and r.json()["count"] == 2
    assert client.get("/api/wordlists/sensitive", headers=headers).json()["words"] == ["刀", "血腥"]

    # 导入追加，不覆盖已有词。
    r = client.post("/api/wordlists/sensitive/import", headers=headers,
                    json={"content": "暴力\n刀"})
    assert r.json() == {"count": 3, "added": 1}

    # 建章 → 自检：命中用户词库。
    novel = client.post("/api/novels", headers=headers, json={"title": "自检测试"}).json()
    chapter = client.post(f"/api/novels/{novel['id']}/chapters", headers=headers,
                          json={"title": "第1章", "content": "他握紧了刀，血腥味漫开。我的的手在抖？？？？"}).json()
    r = client.post(f"/api/novels/{novel['id']}/chapters/{chapter['id']}/lint", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["counts"]["sensitive"] == 2   # 刀 + 血腥
    assert body["counts"]["duplicate"] == 1   # 的的
    assert body["counts"]["punct"] == 1       # ？？？？
    sensitive = [i for i in body["issues"] if i["type"] == "sensitive"]
    assert sensitive[0]["word"] == "刀"

    # 清空词库后不再报敏感词（其余规则不受影响）。
    client.put("/api/wordlists/sensitive", headers=headers, json={"words": []})
    body = client.post(f"/api/novels/{novel['id']}/chapters/{chapter['id']}/lint", headers=headers).json()
    assert body["counts"]["sensitive"] == 0
    assert body["counts"]["duplicate"] == 1
