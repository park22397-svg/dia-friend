"""사이 — 지금 어떤 사이인가, 이름표는 무엇인가.

다이아 쪽이다. 원래 main.py 에 있던 도우미 둘을 옮겼다(2026-09-30).
"""

import memory_manager
from avatar import AVATAR


def stage_now(affinity, before=None):
    """지금 어떤 사이인가. **말투까지 정해진 것으로** 돌려준다.

    단계 표에는 친구부터 '반말' 이라 적혀 있지만, 말은 누군가 놓자고
    하고 상대가 받아야 놓는 것이다. 아직이면 존댓말로 되돌린다.

    말투를 보는 자리가 열두 군데라 여기 한 곳을 지나게 한다 —
    한 군데만 빠뜨려도 거기서만 반말이 튀어나온다.
    """

    saved = memory_manager.load_relationship() or {}
    grants = AVATAR.gate_grants(saved)

    return AVATAR.next_stage(affinity, before, grants)


def stage_label(stage):
    """화면에 적을 이름표.

    넘을 수 있는 문턱이 있으면 괄호로 붙는다 — '서먹함(친구 가능)'.
    안 알려 주면 사람은 그 자리가 열린 줄 모른다. 호감만 오르고
    이름표는 그대로여서 고장 난 것처럼 보인다.
    """
    saved = memory_manager.load_relationship() or {}

    return AVATAR.stage_label(stage, saved.get("affinity", 0),
                              AVATAR.gate_grants(saved))
