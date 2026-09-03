"""使用统计页（GET /ai/usage/stats）— 跨作品聚合、缓存命中拆分、按模型分类。

直接往 ai_usage 表插带 cached_tokens 的行（绕过真实 provider），校验
聚合口径：cached / uncached_input / by_model 排序与每日序列连续性。"""
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


def _seed(novel_id: str):
    """两个模型 × 不同缓存比例的用量行。"""
    from app.database import SessionLocal
    from app.models import AIUsage
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    rows = [
        AIUsage(novel_id=novel_id, model="deepseek-v4-flash", mode="continue",
                prompt_tokens=1000, cached_tokens=600, completion_tokens=200, total_tokens=1200,
                created_at=now),
        AIUsage(novel_id=novel_id, model="deepseek-v4-flash", mode="continue",
                prompt_tokens=500, cached_tokens=500, completion_tokens=100, total_tokens=600,
                created_at=now),
        AIUsage(novel_id=None, model="gpt-4o-mini", mode="synopsis",
                prompt_tokens=300, cached_tokens=0, completion_tokens=80, total_tokens=380,
                created_at=now),
    ]
    with SessionLocal() as db:
        db.add_all(rows)
        db.commit()


def test_usage_stats_aggregation():
    client, headers = _client()
    novel = client.post("/api/novels", headers=headers, json={"title": "统计测试"}).json()
    _seed(novel["id"])

    r = client.get("/api/ai/usage/stats", headers=headers, params={"days": 7})
    assert r.status_code == 200
    data = r.json()

    t = data["totals"]
    assert t["calls"] == 3
    assert t["prompt"] == 1800
    assert t["cached"] == 1100
    assert t["uncached_input"] == 700
    assert t["completion"] == 380
    assert t["total"] == 2180

    # 按合计降序：deepseek-v4-flash (1800) 在 gpt-4o-mini (380) 前。
    models = [m["model"] for m in data["by_model"]]
    assert models.index("deepseek-v4-flash") < models.index("gpt-4o-mini")
    ds = next(m for m in data["by_model"] if m["model"] == "deepseek-v4-flash")
    assert ds["calls"] == 2 and ds["cached"] == 1100 and ds["prompt"] == 1500

    # 每日序列：7 天连续（含空天），今天的数值正确落位。
    assert len(data["series"]) == 7
    today = data["series"][-1]
    assert today["total"] == 2180 and today["calls"] == 3 and today["cached"] == 1100
