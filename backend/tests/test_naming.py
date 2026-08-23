"""F9 命名生成器 — 五类名字生成 + 用户词库合并 + 参数校验。"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.services.naming import generate  # noqa: E402


def test_generate_all_kinds_unique():
    for kind in ("person", "place", "sect", "skill", "pill"):
        names = generate(kind, 8)
        assert len(names) == 8
        assert len(set(names)) == 8
        assert all(n for n in names)
    # 人名 = 姓 + 1~2 字
    assert all(2 <= len(n) <= 3 for n in generate("person", 20))


def test_generate_unknown_kind_raises():
    try:
        generate("unknown", 5)
    except KeyError:
        pass
    else:
        raise AssertionError("unknown kind should raise KeyError")


def test_user_word_override_merges(tmp_path):
    from app.services.naming import _merged_banks
    wordlists = tmp_path / "wordlists"
    wordlists.mkdir()
    (wordlists / "names.json").write_text(
        '{"person": {"姓": ["曜"]}, "place": {"前缀": ["镜"]}}', encoding="utf-8",
    )
    merged = _merged_banks(tmp_path)
    # 语义是"补充"：内置词保留，用户词追加进同一槽位。
    assert "曜" in merged["person"]["姓"] and "沈" in merged["person"]["姓"]
    assert "镜" in merged["place"]["前缀"]
    # 未覆盖的类别不受影响。
    assert merged["skill"]["风格"]
    assert generate("skill", 5, tmp_path)
    assert generate("person", 10, tmp_path)


def test_names_endpoint():
    from fastapi.testclient import TestClient
    from app.database import init_db
    from app.security import get_auth_token
    import main as main_mod

    init_db()
    client = TestClient(main_mod.app)
    headers = {"Authorization": f"Bearer {get_auth_token()}"}
    r = client.get("/api/tools/names", headers=headers, params={"kind": "sect", "count": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["label"] == "门派" and len(body["names"]) == 5
    assert client.get("/api/tools/names", headers=headers, params={"kind": "nope"}).status_code == 422
    assert client.get("/api/tools/names", headers=headers, params={"count": 99}).status_code == 422
