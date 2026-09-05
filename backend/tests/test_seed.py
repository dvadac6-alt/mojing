"""seed 演示数据注入规则 — 只进全新空库，绝不碰已有作品。

回归背景：旧实现挑"最近更新的作品"注入，用户新建空作品后重启后端，
整套《雾隐长街》演示章节/角色/设定会被灌进用户作品里。"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from app.models import Character, Chapter, Novel, StoryMap  # noqa: E402
from app.seed import seed_demo_workspace  # noqa: E402


def _session():
    from app.database import SessionLocal, init_db
    init_db()
    return SessionLocal()


def test_seed_populates_empty_db():
    with _session() as db:
        seed_demo_workspace(db)
        novels = db.query(Novel).all()
        assert len(novels) == 1
        assert novels[0].title == "雾隐长街（测试用例）"
        assert db.query(Chapter).count() == len(novels[0].chapters) > 0
        # 演示作品自带地图：地图页的涂鸦/地形功能都挂在地图名下
        assert db.query(StoryMap).filter_by(novel_id=novels[0].id).count() == 1


def test_seed_never_touches_existing_novels():
    with _session() as db:
        # 用户先建了一部空作品（模拟真实事故场景：新建 → 重启后端）。
        db.add(Novel(title="我的新书"))
        db.commit()
        seed_demo_workspace(db)
        assert db.query(Novel).count() == 1  # 没有新增演示作品
        assert db.query(Chapter).count() == 0  # 也没有向已有作品注入章节
        assert db.query(Character).count() == 0
