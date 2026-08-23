"""F2 角色登场追踪 — 名字扫描纯函数 + 保存钩子 + presence 端点。"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.services.presence import character_names, scan_mentions  # noqa: E402


class _FakeCharacter:
    def __init__(self, name: str, aliases: str = ""):
        self.name = name
        self.aliases = aliases


def test_scan_mentions_longest_name_wins():
    counts = scan_mentions("江离别看了江离一眼，江离没说话。", ["江离", "江离别"])
    assert counts["江离别"] == 1
    assert counts["江离"] == 2  # 长名命中后占位，短名只数剩余的


def test_scan_mentions_empty_and_blank_names():
    assert scan_mentions("", ["沈砚"]) == {}
    assert scan_mentions("正文", ["", "  "]) == {}


def test_character_names_splits_aliases():
    names = character_names(_FakeCharacter("沈砚", "沈捕头、阿砚，沈大人"))
    assert names == ["沈砚", "沈捕头", "阿砚", "沈大人"]


def _client():
    from fastapi.testclient import TestClient
    from app.database import init_db
    from app.security import get_auth_token
    import main as main_mod

    init_db()
    client = TestClient(main_mod.app)
    headers = {"Authorization": f"Bearer {get_auth_token()}"}
    return client, headers


def test_presence_flow_via_api():
    client, headers = _client()
    novel = client.post("/api/novels", headers=headers, json={"title": "登场测试"}).json()
    nid = novel["id"]
    # 两个角色：主角 + 一个别名。
    hero = client.post(f"/api/novels/{nid}/characters", headers=headers,
                       json={"name": "沈砚", "aliases": "沈捕头"}).json()
    other = client.post(f"/api/novels/{nid}/characters", headers=headers,
                        json={"name": "柳三变"}).json()
    # 注意：创建角色发生在章节之前 → 此时全书无登场。建章后由保存钩子扫描。
    c1 = client.post(f"/api/novels/{nid}/chapters", headers=headers,
                     json={"title": "第1章", "content": "沈砚走进长街，沈捕头的刀还在滴血。"}).json()
    c2 = client.post(f"/api/novels/{nid}/chapters", headers=headers,
                     json={"title": "第2章", "content": "柳三变弹了一支曲子。沈砚听着。"}).json()
    c3 = client.post(f"/api/novels/{nid}/chapters", headers=headers,
                     json={"title": "第3章", "content": "雨还在下，没有人在说话。"}).json()

    body = client.get(f"/api/novels/{nid}/characters/presence", headers=headers).json()
    assert body["latest_chapter"] == 3
    by_id = {c["character_id"]: c for c in body["characters"]}
    hero_row = by_id[hero["id"]]
    assert hero_row["first_chapter"] == 1 and hero_row["last_chapter"] == 2
    assert hero_row["chapter_count"] == 2
    assert hero_row["hits"] == 3  # 沈砚×1 + 沈捕头×1（第1章） + 沈砚×1（第2章）
    assert hero_row["gap"] == 1   # 最新第 3 章，最后登场第 2 章
    assert by_id[other["id"]]["gap"] == 1  # 最后登场第 2 章，最新第 3 章

    # 改写第 3 章让沈砚回归 → gap 归零。
    client.put(f"/api/chapters/{c3['id']}", headers=headers,
               json={"content": "沈砚终于开口。"})
    body = client.get(f"/api/novels/{nid}/characters/presence", headers=headers).json()
    by_id = {c["character_id"]: c for c in body["characters"]}
    assert by_id[hero["id"]]["gap"] == 0
    assert by_id[hero["id"]]["last_chapter"] == 3

    # 角色改名 → 全量重扫：旧名记录被替换。
    client.put(f"/api/characters/{hero['id']}", headers=headers,
               json={"name": "砚哥", "aliases": ""})
    body = client.get(f"/api/novels/{nid}/characters/presence", headers=headers).json()
    by_name = {c["name"]: c for c in body["characters"]}
    assert by_name["砚哥"]["chapter_count"] == 0  # 新名字从未出现

    # 手动 rescan 恢复（把名字改回去再 rescan）。
    client.put(f"/api/characters/{hero['id']}", headers=headers,
               json={"name": "沈砚", "aliases": "沈捕头"})
    res = client.post(f"/api/novels/{nid}/characters/rescan", headers=headers).json()
    # 记录数 = 角色×章节：ch1(沈砚) + ch2(沈砚,柳三变) + ch3(沈砚) = 4。
    assert res["appearances"] == 4

    # 删除章节 → 登场记录级联清理（该章贡献的记录消失）。
    client.delete(f"/api/chapters/{c3['id']}", headers=headers)
    body = client.get(f"/api/novels/{nid}/characters/presence", headers=headers).json()
    by_name = {c["name"]: c for c in body["characters"]}
    assert by_name["沈砚"]["last_chapter"] == 2
