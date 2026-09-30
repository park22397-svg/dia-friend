"""대화 진행 — 말이 들어오면 무엇을 할지 가른다.

시스템 쪽이다(2026-10-01, 나누기 2단계). 원래 ai_brain.process_chat 이었다.
놀이(끝말잇기) 가로채기, 글로 만지기, 고백·이별, 침묵 같은 '틀리면 안 되는
일' 을 여기서 정하고, 그 밖의 상황(시간·곳·옷·장면·판)을 모아 다이아에게
건넨다. 다이아가 무엇을 느끼고 뭐라고 할지는 dia/mind.py 가 정한다.
"""

import re

import memory_manager
from avatar import AVATAR
from dia import heart as HEART
from dia import mind as MIND
from dia.mind import _fallback, log_cues
from dia.relation import update_relationship
from memory_manager import (
    append_message,
    load_mood,
    load_relationship,
    load_user_name,
    save_mood,
    save_relationship,
    save_user_name,
)
from system.games import GAMES
from system.games.word_turn import _wc_load, _word_chain_turn
from system.world import WORLD
from system import world_state as WS


_NAME_PATTERNS = [
    r"(?:내|제)\s*이름은\s*([가-힣A-Za-z][가-힣A-Za-z0-9]{0,9})",
    r"(?:나는|저는|난|전)\s*([가-힣A-Za-z][가-힣A-Za-z0-9]{0,9})(?:이야|야|이에요|예요|입니다|이라고|라고)",
    r"([가-힣A-Za-z][가-힣A-Za-z0-9]{0,9})(?:이|)\s*라고\s*(?:불러|부르|해)",
    r"([가-힣A-Za-z][가-힣A-Za-z0-9]{0,9})(?:님|씨)\s*라고\s*(?:불러|부르)",
]

# 이름 자리에 들어오면 안 되는 말
_NOT_NAMES = {
    "그냥", "진짜", "정말", "아니", "네가", "내가", "당신", "너", "나",
    "사람", "누구", "뭐", "이거", "그거", "여기", "거기", "다이아",
    "유저", "사용자", "유주",
}


def detect_user_name(text):
    if not text:
        return None

    for pat in _NAME_PATTERNS:
        m = re.search(pat, text)
        if not m:
            continue
        name = m.group(1).strip()
        if not name or name in _NOT_NAMES or len(name) < 1:
            continue
        return name

    return None


def process_chat(user_text, seeing=None, cut_off=False, woke=False):
    """상대의 말에 답한다.

    seeing 은 지금 눈에 보이는 것이다(카메라나 사진).
    그림을 보는 모델이 적어 준 글이고, 그것을 읽고 무슨 말을 할지는
    여기서 다이아가 정한다. 눈이 대신 말하게 두지 않는다.

    cut_off 는 방금 말하던 것을 상대가 끊고 들어왔는가다.

    woke 는 자고 있다가 이 말에 깨어났는가다. 서버는 다이아가 자는지
    모르므로 화면이 알려 준다.
    """

    if not user_text:
        return {
            "expression": "neutral",
            "reply": "잘 못 들었어요. 다시 말씀해 주시겠어요?",
            "cues": [],
        }

    user_text = str(user_text).strip()

    # 관계부터 갱신한다. 이번 답변의 말투가 여기서 정해진다.
    stage, transition = update_relationship(user_text)

    # 화면이 친밀도 눈금을 그리려면 숫자도 알아야 한다
    try:
        affinity_now = (load_relationship() or {}).get(
            "affinity",
            AVATAR.relationship.get("start_affinity", 0)
        )
    except Exception:
        affinity_now = None

    # 이번 말에 호칭을 알려줬다면 바로 붙잡아 기억한다
    try:
        told = detect_user_name(user_text)
        if told:
            save_user_name(told)
            print(f"[호칭 기억]: {told}")
        user_name = load_user_name()
    except Exception as e:
        print(f"[호칭 처리 오류]: {e}")
        user_name = None

    # 다정한 말로 깨웠는지. 자다 깬 얼굴을 놀람에서 무엇으로 바꿀지 화면이 이걸로 정한다.
    warm = False
    try:
        low = str(user_text).lower()
        sig = AVATAR.relationship.get("signals", {})
        warm = any(w in low for w in sig.get("positive", [])) and \
            not any(w in low for w in sig.get("negative", []))
    except Exception:
        warm = False

    # 기분이 상하는 일.
    #
    # 모진 말을 들었거나 상처 주는 말을 들으면 기분이 상한다.
    # 친밀도와는 따로 움직인다 — 사이가 좋아도 지금 상해 있을 수 있다.
    import time as _time

    mood_now = 0
    try:
        _saved = load_mood()
        _now = _time.time()
        mood_now = AVATAR.mood_now(
            _saved.get("raw", 0), _saved.get("since"), _now)

        _conf = AVATAR.mood_conf().get("hurt", {})
        _up = 0

        if AVATAR.hurt_reaction(user_text):
            _up = max(_up, _conf.get("words", 3))
        elif AVATAR.score_message(user_text) < 0:
            _up = max(_up, _conf.get("negative", 2))

        if _up:
            before = mood_now
            mood_now = AVATAR.mood_clamp(mood_now + _up)
            if mood_now != before:
                save_mood(mood_now, _now)
                print(f"[기분]: {before} -> {mood_now} (말)")

    except Exception as e:
        print(f"[기분 처리 오류]: {e}")
        mood_now = 0

    # 같이 걷자는 말인지 미리 읽어 둔다.
    # 대화 중에는 제자리에 서 있다가, 이 말이 나오면 발이 풀린다.
    try:
        walk = AVATAR.walk_invite(user_text)
    except Exception:
        walk = None

    # 가까이 오라는 말인지도 같이 읽는다.
    # 평소 서는 거리에서는 손이 닿지 않아서, 걸어가는 대신
    # 부를 수도 있어야 한다.
    try:
        approach = AVATAR.come_invite(user_text)
    except Exception:
        approach = None

    def done(reply, expression="neutral", cues=None, silent=False, motion=None):
        # 침묵은 남길 말이 없다. 빈 줄을 기록에 넣으면
        # 나중에 그 자리가 '아무 말도 안 한 답변'처럼 모델에게 보인다.
        if reply:
            try:
                append_message("assistant", reply)
            except Exception as e:
                print(f"[AI 답변 기억 저장 오류]: {e}")
        return {
            "expression": expression,
            "reply": reply,
            "cues": cues or [],
            "silent": silent,
            "motion": motion,
            "warm": warm,
            # 같이 걷자고 했는가. 화면이 이걸 보고 발을 풀거나 묶는다.
            "walk": walk,
            # 가까이 오라고 했는가. 'near' 면 손이 닿는 데까지 온다.
            "approach": approach,
            # 지금 얼마나 상해 있는가
            "mood": mood_now,
            # 연인인가. 아니면 호감이 광기 앞에서 멈춘다.
            "lover": bool((load_relationship() or {}).get("lover", False)),
            "relationship": {
                "stage": stage.key,
                "label": stage.label,
                "changed_from": transition,
                "affinity": affinity_now,
            },
            "user_name": user_name,
        }

    try:
        append_message("user", user_text)
    except Exception as e:
        print(f"[기억 저장 오류]: {e}")

    # ----------------------------------------------------------
    # 상대가 괄호로 쓴 행동을 읽는다.
    #
    # "(머리를 쓰다듬는다)" 는 말이 아니라 손짓이다. 마우스로 만진 것과
    # 같은 표를 태워, 자리·도구·친밀도 규칙이 두 벌로 갈라지지 않게 한다.
    # 뜻을 모르는 행동은 손대지 않는다. 그건 모델이 상황으로 읽는다.
    # ----------------------------------------------------------

    touch = None
    spoken = user_text

    try:
        acts, spoken = AVATAR.parse_action(user_text)
        known = [a for a in acts if a.get("zone")]

        if known:
            a = known[0]
            touch = AVATAR.touch_reaction(
                AVATAR.touch_zone(a["zone"]),
                a["kind"],
                stage,
                affinity_now if affinity_now is not None else 0,
                tool=AVATAR.touch_tool(a["tool"]),
            )

        if touch:
            base = affinity_now if affinity_now is not None else 0
            affinity_now = AVATAR.clamp_affinity(
                base + touch.get("affinity_delta", 0)
            )
            stage = AVATAR.next_stage(affinity_now, stage.key)
            save_relationship(affinity_now, stage.key)
            print(f"[글로 만지기]: {a['raw']} -> {touch['label']} "
                  f"({touch['affinity_delta']:+d})")

    except Exception as e:
        print(f"[행동 읽기 오류]: {e}")
        touch = None

    # ----------------------------------------------------------
    # 고백
    #
    # 사귀자는 말은 모델에게 맡기지 않는다. 받아들일지 말지는 사이가
    # 정하는 것이지 그때그때 문장으로 정할 일이 아니고, 받아들인 순간
    # 관계 자체가 달라지기 때문이다.
    # ----------------------------------------------------------

    # ----------------------------------------------------------
    # 친구가 되기
    #
    # 말을 놓자는 말도 모델에게 맡기지 않는다. 고백과 같은 이유다 —
    # 받아들일지 말지는 사이가 정하는 것이고, 받아들인 순간부터
    # 말투가 통째로 달라지기 때문이다.
    #
    # 고백보다 **먼저** 본다. 말을 놓아야 친구고, 친구가 되어야
    # 그다음으로 넘어간다.
    # ----------------------------------------------------------
    # 끝말잇기
    #
    # **규칙은 서버가 쥔다.** 모델에게 맡기면 없는 낱말을 지어내고
    # 끝 글자를 안 맞춘다(gemma3:4b 로 재 봤을 때 0/3). 낱말은
    # word_chain.py 가 고르고, 무슨 말을 할지는 개체가 정한다.
    #
    # 모델을 안 부르므로 곧바로 답한다. 놀이는 박자다.
    # ----------------------------------------------------------

    _wc = _word_chain_turn(user_text, stage)

    if _wc is not None:
        return done(
            _wc["line"],
            expression=_wc.get("expression") or "neutral",
            motion=_wc.get("motion"),
        )

    if AVATAR.is_confession(user_text):
        try:
            _saved = load_relationship() or {}
            _lover = bool(_saved.get("lover", False))
            _aff = _saved.get(
                "affinity", AVATAR.relationship.get("start_affinity", 0))

            r = AVATAR.confess_reply(_aff, stage, _lover)

            if r["accepted"]:
                _aff = AVATAR.clamp_affinity(
                    _aff + r["affinity_delta"], lover=True)
                stage = AVATAR.next_stage(_aff, stage.key)
                save_relationship(_aff, stage.key,
                                  0, True)
                affinity_now = _aff
                print(f"[고백]: 받아들였습니다. 이제 연인이고, "
                      f"호감이 {_aff} 로 올랐습니다.")
            else:
                print(f"[고백]: {'이미 연인' if _lover else '아직 이르다'}")

            if r["reply"]:
                return done(
                    r["reply"],
                    expression=r["expression"],
                    motion=r.get("motion"),
                )

        except Exception as e:
            print(f"[고백 처리 오류]: {e}")

    # ----------------------------------------------------------
    # 이별
    #
    # 고백과 같은 이유로 모델에게 맡기지 않는다. 헤어지자는 말은
    # 그때그때 문장으로 정할 일이 아니다 — 그 말 한마디로 사이가
    # 통째로 달라지고, 그 뒤의 모든 말투가 거기서 갈린다.
    #
    # 헤어져도 친구로는 남는다. 갈 곳이 거기뿐이기도 하다.
    # ----------------------------------------------------------

    if AVATAR.is_breakup(user_text):
        try:
            _saved = load_relationship() or {}
            _lover = bool(_saved.get("lover", False))
            _aff = _saved.get(
                "affinity", AVATAR.relationship.get("start_affinity", 0))

            r = AVATAR.breakup_reply(_lover, "said")

            if r["broke"]:
                _aff = AVATAR.clamp_affinity(_aff + r["affinity"], lover=False)
                stage = AVATAR.next_stage(
                    _aff, stage.key, AVATAR.gate_grants(_saved, lover=False))
                save_relationship(_aff, stage.key, 0, False)
                affinity_now = _aff
                print(f"[이별]: 헤어졌습니다. 이제 친구이고, 호감 {_aff}.")
            else:
                print("[이별]: 연인이 아니다")

            if r["line"]:
                return done(
                    r["line"],
                    expression=r["expression"],
                    motion=r.get("motion"),
                )

        except Exception as e:
            print(f"[이별 처리 오류]: {e}")

    # 입을 닫은 단계에서는 모델을 부르지 않는다.
    #
    # 부르면 무슨 말이든 하게 되고, 그러면 '대답하지 않는다'가 아니라
    # '차갑게 대답한다'가 되어 버린다. 침묵은 짧은 대답이 아니라 없는 대답이다.
    # 상대의 말은 기억에 남긴다. 나중에 사이가 풀리면 그동안의 이야기가 이어진다.
    if getattr(stage, "silent", False):
        conf = AVATAR.relationship.get("silence", {})
        print(f"[침묵]: {stage.label} 단계라 답하지 않습니다.")
        return done(
            "",
            expression=conf.get("expression", "angry"),
            silent=True,
        )

    # 손짓만 하고 아무 말도 하지 않았다면 모델을 부를 것이 없다.
    # 정해 둔 반응이 이미 그 자리에 맞는 말이고, 기다릴 이유도 없다.
    if touch and not spoken and touch.get("reply"):
        return done(
            touch["reply"],
            expression=touch.get("expression", "neutral"),
            motion=touch.get("motion"),
        )

    _rel = load_relationship() or {}

    # 갈 수 있는 곳은 배경 폴더가 정한다. 파일을 넣으면 곳이 는다.
    try:
        _places, _here = WS._places_now(), WS._place_here()
    except Exception as e:
        print(f"[장소 읽기 오류]: {e}")
        _places, _here = [], None

    # 옷장. 장소와 같은 자리에서 같은 방식으로 준다.
    try:
        _wardrobe, _worn = WS._wardrobe_now(), WS._worn_now()
    except Exception as e:
        print(f"[옷장 읽기 오류]: {e}")
        _wardrobe, _worn = [], None

    # 갈 수 있는 곳·입을 수 있는 옷은 시스템(WORLD)이 글로 만들고,
    # 다이아는 받아서 프롬프트에 끼운다.
    _world_blocks = [
        b for b in (
            WORLD.places_block(_places, _here) if _places else None,
            WORLD.wardrobe_block(_wardrobe, _worn) if _wardrobe else None,
        ) if b
    ]

    # 여기서부터는 **상황만 모은다.** 프롬프트를 짓고 모델에게 묻고
    # 답을 읽는 것은 다이아(dia/mind.py)가 한다. 모은 것은 기록 뒤,
    # 말투 지시 앞에 들어간다.
    messages = []

    # 손짓을 알아들었다면 무엇을 한 것인지 짚어 준다.
    # 괄호만 보고 모델이 알아서 읽게 두면 글자로 받아치는 일이 생긴다.
    if touch:
        messages.append({
            "role": "system",
            "content": (
                f"상대가 방금 너의 {touch['label']}을(를) 만졌다. "
                f"그 행동에 반응해서 답하라. "
                f"괄호 안의 말을 따라 적지는 마라."
            ),
        })

    # 말하던 것을 끊고 들어왔다.
    #
    # 아무 일도 없었던 것처럼 이어 말하면 끊긴 티가 안 난다.
    # 무슨 말을 하라고는 적지 않는다 — 사이가 정할 일이다.
    # 친구라면 웃으며 넘어가고, 집착이라면 말을 자른 것을 짚는다.
    if cut_off:
        messages.append({
            "role": "system",
            "content": (
                "[방금 네가 말하던 중에 상대가 끼어들어 말을 끊었다] "
                "하던 말을 처음부터 다시 하지 마라. "
                "끊긴 것을 알고 있는 사람으로서 답하라."
            ),
        })

    # 지금이 언제인가.
    #
    # 기분과 같은 자리에 같은 방식으로 넣는다. 무슨 말을 하라고는
    # 적지 않는다 — 새벽이라는 것만 알면 사이에 맞는 말이 알아서 나온다.
    try:
        from memory_manager import touch_session
        _before = touch_session()
        _when = AVATAR.time_note(last_talk=_before)
    except Exception as e:
        print(f"[시간 읽기 오류]: {e}")
        _before, _when = None, None

    # 오래 못 봤으면 그만큼 보고 싶었다. 얼마나인지는 사이가 정한다.
    # 무엇을 느끼는지만 마음에 적고, 뭐라고 할지는 다이아가 정한다.
    try:
        if _before:
            MIND.feel_absence(_time.time() - float(_before), _rel)
    except Exception as e:
        print(f"[못 본 사이 오류]: {e}")

    if _when:
        messages.append({
            "role": "system",
            "content": f"[지금] {_when}",
        })

    # 지금 어디에 있는가.
    #
    # 시간·기분과 같은 자리에 같은 방식으로 넣는다. 안 주면 공원에
    # 있으면서 "우리 공원 갈까?" 라고 한다.
    #
    # 프롬프트에 이어 붙이지 않는다 — 그러면 말투 지시가 끝에서 밀린다.
    _wh = WORLD.place_note(_here)

    if _wh:
        messages.append({
            "role": "system",
            "content": f"[있는 곳] {_wh}",
        })

    # 지금 무엇을 입고 있는가.
    #
    # 있는 곳과 같은 이유다. 안 주면 교복을 입고 있으면서
    # "교복 입어 볼까?" 라고 한다.
    _wr = WORLD.wear_note(_worn)

    if _wr:
        messages.append({
            "role": "system",
            "content": f"[입은 옷] {_wr}",
        })

    # 지금 이 사람 폰에서 무엇이 나오고 있는가.
    #
    # 곳·옷과 같은 자리다. 옆에 떠 있는데 무슨 노래를 듣는지 모르면
    # 그냥 그림이 하나 떠 있는 것이다. 제목과 가수만 알아도 말이 트인다.
    #
    # **제목과 가수뿐이다.** 가사는 없다 — 다이아는 제 말로 이야기한다.
    # 아무것도 안 나오면 한 자도 안 붙는다.
    try:
        _media = memory_manager.load_media()
    except Exception as e:
        print(f"[지금 나오는 것 읽기 오류]: {e}")
        _media = None

    _mn = WORLD.media_note(_media)

    if _mn:
        messages.append({
            "role": "system",
            "content": f"[지금 나오는 것] {_mn}",
        })

    # 지금이 어떤 자리인가.
    #
    # 시간·곳·옷과 같은 자리에 같은 방식으로 넣는다. 다른 것은
    # 하나뿐이다 — **이 자리에서만 할 수 있는 일이 따라붙는다.**
    #
    # 노래방에 있다는 것은 배경이 노래방이라는 뜻이 아니라
    # 노래를 부를 수 있다는 뜻이다. 그래서 곳 한 줄로는 모자라다.
    #
    # 자리를 벗어나면 그 몇 줄은 사라진다. 평소 프롬프트는
    # 한 자도 안 는다. [[dia-autonomy]]
    try:
        _scene = WS._scene_update(user_text, _here)
    except Exception as e:
        print(f"[장면 읽기 오류]: {e}")
        _scene = None

    if _scene:
        _sn = WORLD.scene_note(_scene)

        if _sn:
            messages.append({
                "role": "system",
                "content": f"[지금 하는 일] {_sn}",
            })

        _sb = WORLD.scene_block(_scene)

        if _sb:
            messages.append({"role": "system", "content": _sb})

    # 자고 있다가 깨어났는가.
    #
    # 이것을 안 알려 주면 시간만 보고 **자기가 상대를 깨운 줄 알고
    # 사과한다.** 실제로 "갑자기 깨워서 죄송해요" 라고 답한 적이 있다.
    if woke:
        messages.append({
            "role": "system",
            "content": "[깨어남] " + AVATAR.woke_note(),
        })

    # 가위바위보를 얼마나 했나.
    #
    # 놀아 놓고 다음 대화에서 모르면 같이 논 것이 아니다.
    # 체스판과 같은 방식으로 상황만 준다.
    try:
        from memory_manager import load_memory_data as _lmd
        _rps = GAMES.rps_note((_lmd() or {}).get("rps"))
    except Exception as e:
        print(f"[가위바위보 전적 읽기 오류]: {e}")
        _rps = None

    if _rps:
        messages.append({
            "role": "system",
            "content": f"[가위바위보] {_rps}",
        })

    # 체스를 두는 중인가.
    #
    # 판은 따로 저장되어 있는데 대화 쪽에서는 그걸 몰랐다. 그래서
    # 한 판 두고 나서 "아까 체스 어땠어?" 하고 물으면 무슨 소리인지
    # 몰랐다. 시간을 알려 주는 것과 같은 방식으로 상황만 넣는다 —
    # 무슨 말을 하라고는 적지 않는다.
    try:
        from memory_manager import load_memory_data
        _game = (load_memory_data() or {}).get("chess")
        _chess = GAMES.chess_note(_game)
    except Exception as e:
        print(f"[체스판 읽기 오류]: {e}")
        _chess = None

    if _chess:
        messages.append({
            "role": "system",
            "content": f"[체스] {_chess}",
        })

    # 끝말잇기를 하는 중인가. 체스판과 같은 방식으로 상황만 준다.
    try:
        _chain = GAMES.wc_note(_wc_load())
    except Exception as e:
        print(f"[끝말잇기 상황 오류]: {e}")
        _chain = None

    if _chain:
        messages.append({
            "role": "system",
            "content": f"[끝말잇기] {_chain}",
        })

    # 지금 눈에 보이는 것.
    #
    # 이 글은 그림을 보는 모델이 적은 것이지 다이아가 적은 것이 아니다.
    # 그래서 '설명을 따라 적지 마라' 를 같이 준다 — 안 그러면
    # "파란 배경에 노란 사각형이 보이네" 같은 남의 말투가 그대로 나온다.
    if seeing:
        messages.append({
            "role": "system",
            "content": (
                f"[지금 네 눈에 보이는 것] {seeing}\n"
                f"이건 네가 본 것이다. 설명문을 따라 적지 말고 "
                f"본 사람으로서 네 말로 반응하라. "
                f"보이는 것을 다 짚지 말고 눈에 걸리는 것 하나만 말해도 된다."
            ),
        })

    # ----------------------------------------------------------
    # 다이아에게 건넨다. 프롬프트·기록·속마음·말투 지시는 다이아가 붙인다.
    # ----------------------------------------------------------
    thought = MIND.think(
        stage=stage,
        transition=transition,
        user_name=user_name,
        notes=messages,
        world_blocks=_world_blocks,
        mood=mood_now,
        affinity=_rel.get("affinity"),
        lover=bool(_rel.get("lover", False)),
        # 한 말은 아래 done() 이 기록에 남긴다
        remember=False,
    )

    if not thought.get("ok"):
        # 무엇이 잘못됐는지가 말에 드러나야 한다(닿지도 못했는데
        # '생각이 오래 걸린다' 고 하면 원인을 못 찾는다).
        say = _TROUBLE.get(thought.get("why"), _TROUBLE["other"])
        return done(_fallback(stage, *say))

    clean_text = thought["reply"]
    expression = thought["expression"]
    cues = thought["cues"]

    # 상대가 "알겠어?" 하고 확인하면 고개를 끄덕인다.
    # 말로 "응" 하는 것보다 끄덕이는 쪽이 먼저 나오는 반응이다.
    # 만져서 나온 몸짓이 이미 있으면 그쪽이 우선이다.
    motion = touch.get("motion") if touch else None
    if motion is None:
        motion = AVATAR.asks_understood(user_text)

    # 걷어낸 표시를 따로 적어 둔다. 안 그러면 무엇이 왜 나왔는지
    # 나중에 따져볼 방법이 없다.
    log_cues(user_text, clean_text, cues,
             extra=(f"동작 {motion}" if motion else None),
             feel=thought.get("mark"))

    out = done(clean_text, expression, cues, motion=motion)
    out["feel"] = thought.get("feel")
    return out


# 모델에게 못 물었을 때 하는 말 — (존댓말, 반말)
_TROUBLE = {
    "http": ("지금 연결이 잠깐 이상한 것 같아요. 다시 말씀해 주시겠어요?",
             "지금 연결이 잠깐 이상한 것 같아. 다시 말해줄래?"),
    "json": ("응답이 이상하게 왔어요. 한 번만 다시 말씀해 주세요.",
             "응답이 이상하게 왔어. 한 번만 다시 말해줄래?"),
    "empty": ("잠깐 생각이 멈췄어요. 다시 한 번 말씀해 주세요.",
              "잠깐 생각이 멈췄어. 다시 한 번 말해줄래?"),
    "garbled": ("잠깐 말이 꼬였어요. 다시 이야기해 주세요.",
                "잠깐 말이 꼬였네. 다시 이야기해줄래?"),
    "connect": ("지금 서버와 연결이 안 되는 것 같아요. 잠시 후에 다시 해볼까요?",
                "지금 서버랑 연결이 안 되는 것 같아. 잠깐 있다 다시 해보자."),
    "timeout": ("생각하는 데 시간이 조금 걸리고 있어요. 잠깐만요.",
                "생각하는 데 시간이 좀 걸리네. 잠깐만."),
    "other": ("뭔가 꼬인 것 같아요. 다시 이야기해 주세요.",
              "뭔가 꼬인 것 같아. 다시 이야기해보자."),
}
