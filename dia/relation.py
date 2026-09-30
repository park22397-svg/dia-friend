"""사이 — 지금 어떤 사이인가, 이름표는 무엇인가.

다이아 쪽이다. 원래 main.py 에 있던 도우미 둘을 옮겼다(2026-09-30).
"""

import memory_manager
from avatar import AVATAR
from memory_manager import load_relationship, save_relationship


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


# 원래 ai_brain.py 에 있던 것(2026-10-01).
def update_relationship(user_text):
    """
    반환: (stage, transition_label)
      transition_label 은 이번에 단계가 바뀐 경우에만 이전 단계 이름이 들어간다.
    """

    try:
        saved = load_relationship() or {}
    except Exception as e:
        print(f"[관계 불러오기 오류]: {e}")
        saved = {}

    affinity = saved.get(
        "affinity",
        AVATAR.relationship.get("start_affinity", 0)
    )

    prev_key = saved.get("stage")
    lover = bool(saved.get("lover", False))

    try:
        here = AVATAR.stage(prev_key) if prev_key else None
        delta = AVATAR.score_message(user_text)

        affinity = AVATAR.apply_delta(affinity, delta, here, lover=lover)

    except Exception as e:
        print(f"[관계 점수 계산 오류]: {e}")

    stage = AVATAR.next_stage(affinity, prev_key,
                              AVATAR.gate_grants(saved))

    transition = None
    if prev_key and prev_key != stage.key:
        before = AVATAR.stage(prev_key)
        if before is not None:
            transition = before.label

    try:
        # 연인인데 호감이 바닥나면 저절로 헤어진다.
        #
        # 사람은 미워하면서 사귀지 않는다. 다만 친구로는 남는다 —
        # 갈 곳이 거기뿐이기도 하다. 헤어졌다는 말은 다음 답에 얹는다.
        if lover and AVATAR.breakup_faded(affinity, lover):
            lover = False
            stage = AVATAR.next_stage(
                affinity, stage.key, AVATAR.gate_grants(saved, lover=False))
            print(f"[이별]: 호감이 {affinity} 까지 떨어져 저절로 끝났습니다.")

        save_relationship(affinity, stage.key, 0, lover)
    except Exception as e:
        print(f"[관계 저장 오류]: {e}")

    return stage, transition
