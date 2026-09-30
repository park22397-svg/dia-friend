"""끝말잇기 차례 — 대화 창에서 오가는 끝말잇기를 받는다.

시스템 쪽이다. 원래 ai_brain.py 에 있던 것을 옮겼다(2026-09-30).
"""

import random as _rnd  # noqa: F401

from avatar import AVATAR
from memory_manager import (
    load_memory_data,
    load_relationship,
    save_memory_data,
    save_relationship,
)
from system.games import GAMES


def _wc_load():
    from memory_manager import load_memory_data

    g = (load_memory_data() or {}).get("word_chain")

    return g if isinstance(g, dict) else {}


def _wc_save(game):
    from memory_manager import load_memory_data, save_memory_data

    data = load_memory_data()
    data["word_chain"] = game or {}
    save_memory_data(data)


def _wc_bump(delta):
    """놀이로 얻는 호감은 작게. 가위바위보와 같은 자리."""
    if not delta:
        return

    try:
        from memory_manager import load_relationship, save_relationship

        rel = load_relationship() or {}
        grants = AVATAR.gate_grants(rel)

        aff = AVATAR.clamp_affinity(
            int(rel.get("affinity", 0)) + int(delta), grants=grants)

        st = AVATAR.stage_for_affinity(aff, grants)

        save_relationship(aff, st.key if st else rel.get("stage", "distant"))

    except Exception as e:
        print(f"[끝말잇기 호감 오류]: {e}")


def _word_chain_turn(user_text, stage):
    """끝말잇기 한 수. 이 자리에서 처리했으면 답을, 아니면 None.

    반환: {"line", "expression", "motion"} 또는 None
    """
    from system.games import word_chain as WC

    try:
        game = _wc_load()
        on = bool(game.get("on"))
        text = str(user_text or "").strip()

        # --- 시작하자는 말 ---
        if not on and GAMES.is_word_chain(text):
            level = GAMES.wc_level().get("key", "normal")
            first = WC.pick(None, set(), level)

            if not first:
                return None

            _wc_save({"on": True, "last": first, "used": [first],
                      "level": level})

            say = GAMES.wc_say("open", stage, word=first)
            print(f"[끝말잇기]: 시작 — {first}")

            return say

        if not on:
            return None

        # --- 그만하자는 말 ---
        if GAMES.wc_stop(text):
            n = len(game.get("used") or [])
            _wc_save({})
            print(f"[끝말잇기]: 그만 — {n}번")

            return GAMES.wc_say("stop", stage, n=n)

        # --- 낱말을 낸 것인가 ---
        #
        # 놀이 중이라도 사람은 딴 이야기를 할 수 있다. 한 낱말짜리
        # 한글만 낱말로 본다. 문장이면 모델에게 넘긴다 — 그러지 않으면
        # "오늘 힘들었어" 가 '없는 말' 로 걸려서 대화가 막힌다.
        #
        # ★ 그 전에 붙임표를 뗀다. 사람은 "자라!" 라고 친다.
        #   느낌표 하나 때문에 이 검사를 못 넘으면 그 한 수가 **모델에게
        #   새어 나가고**, 모델이 없는 낱말을 지어낸다. 엔진은 제자리에
        #   멈춰 있어서 다음 수부터 엉뚱한 글자를 요구한다.
        #   실제로 그랬다 — 자라! → (모델) 라무스 → 엔진이 '자'를 요구.
        #
        #   낱말 사이에 든 공백은 떼지 않는다. 그건 문장이다.
        text = text.strip(" 	!?.…~,·'\"“”‘’()[]<>「」『』。!?、")

        if not WC.HANGUL.match(text):
            return None

        used = set(game.get("used") or [])
        last = game.get("last") or ""

        ok, why = WC.judge(last, text, used)

        if not ok:
            head = WC.heads_for(last[-1])[0] if last else ""
            return GAMES.wc_say("wrong", stage, why=why, head=head)

        used.add(text)

        # --- 다이아가 받는다 ---
        level = game.get("level") or "normal"

        try:
            from memory_manager import load_relationship
            aff = (load_relationship() or {}).get("affinity", 0)
        except Exception:
            aff = 0

        # 사이가 깊으면 가끔 봐준다. 한방을 쥐고도 안 쓴다.
        import random as _rnd

        if _rnd.random() < GAMES.wc_mercy(aff):
            level = "soft"

        mine = WC.pick(text, used, level)

        if not mine:
            # 낼 것이 없다. 진다.
            _wc_save({})
            say = GAMES.wc_say("lost", stage,
                                head=WC.heads_for(text[-1])[0])
            _wc_bump(say.get("affinity", 0))
            print(f"[끝말잇기]: 다이아가 졌습니다 ({text})")

            return say

        used.add(mine)

        # 사람이 이어 갈 수 있는가. 없으면 다이아가 이긴 것이다.
        if not WC.can_continue(mine, used):
            _wc_save({})
            say = GAMES.wc_say("won", stage)
            _wc_bump(say.get("affinity", 0))
            say["line"] = "%s… %s" % (mine, say["line"])
            print(f"[끝말잇기]: 다이아가 이겼습니다 ({mine})")

            return say

        _wc_save({"on": True, "last": mine, "used": sorted(used),
                  "level": game.get("level") or "normal"})

        return GAMES.wc_say("reply", stage, word=mine)

    except Exception as e:
        print(f"[끝말잇기 오류]: {e}")
        return None
