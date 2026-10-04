"""생각 — 다이아가 말을 듣고, 느끼고, 답한다.

다이아 쪽이다(2026-10-01, 나누기 2단계). 원래 ai_brain.py 에 섞여 있던
다이아의 몫을 옮겼다 — 모델에게 묻기, 답 읽기(표정·몸짓·속마음),
혼자 말 잇기. 대화의 진행(놀이 가로채기·만지기·고백)은 system/chat.py 다.
"""

import re

import requests

import config
from avatar import AVATAR, is_emoji
from config import MAX_HISTORY_MESSAGES, OLLAMA_MODEL, OLLAMA_OPTIONS, OLLAMA_THINK
from dia import heart as HEART
from memory_manager import (
    append_message,
    load_memory,
    load_relationship,
    load_user_name,
)
from system.world import WORLD


SYSTEM_PROMPT = AVATAR.system_prompt()


# ============================================================
# 화면에 보이지 않는 표시 걷어내기
#
# 모델은 답변에 이모지(표정)와 괄호(몸짓)를 섞어 쓴다.
# 그 표시는 유저 화면에 글자로 나가면 안 되지만,
# 어느 지점에서 나왔는지는 제스처 엔진에 필요하다.
#
# 그래서 지우기 전에 '정제된 본문 기준 위치'를 함께 기록해 둔다.
# ============================================================

_BRACKET_RE = re.compile(r"[（(]\s*([^()（）]{1,20})\s*[)）]")


def extract_cues(text):
    """표시를 걷어낸 본문과, 그 표시가 있던 자리 목록을 돌려준다.

    반환: (clean_text, cues)
      cues = [{"at": 정제본문에서의 위치, "type": "expression"|"motion",
               "key": ..., "hold_ms": ...}, ...]
    """

    if not text:
        return "", []

    motion_map = AVATAR.motion_cue_map()
    expr_map = AVATAR.expression_cue_map()

    # 표정 신호 중 이모지만 골라 위치를 잡는다.
    # 'ㅋㅋ' 같은 한글 신호는 평범한 말이므로 화면에 그대로 남긴다.
    emoji_to_expr = {}
    for e in AVATAR.expressions:
        for t in e.live_triggers:
            if is_emoji(t):
                emoji_to_expr[t] = e

    out = []
    cues = []
    i = 0
    n = len(text)

    while i < n:

        # 괄호 몸짓
        m = _BRACKET_RE.match(text, i)
        if m:
            inner = m.group(1).strip()

            # 자리를 옮기는 표시인가 — (배경: 공원)
            #
            # 몸짓·얼굴과 달리 이것은 '어디에 있는가' 라서 문장 속
            # 위치와 상관이 없다. 그래서 at 을 안 적고 따로 모은다.
            #
            # 갈 수 없는 곳이면 부르는 쪽에서 버린다. 없는 곳으로
            # 옮기는 시늉을 하면 말과 화면이 어긋난다.
            # 옷 갈아입기 표시. 장소와 똑같이 다룬다.
            want_wear = WORLD.wear_marker(inner)

            if want_wear:
                cues.append({
                    "at": len(out),
                    "type": "wear",
                    "key": want_wear,
                })
                i = m.end()
                while i < n and text[i] == " " and (not out or out[-1] == " "):
                    i += 1
                continue

            # 노래 한 줄. (노래: 반짝이는 오늘도)
            #
            # 옷·장소와 같은 자리에서 같은 방식으로 걷어낸다. 다른
            # 것은 하나뿐이다 — 이건 **말이 아니라 소리**라서 본문에
            # 남기지 않는다. 가사를 글로도 적고 부르기까지 하면
            # 같은 말을 두 번 하는 꼴이 된다.
            want_song = AVATAR.song_marker(inner)

            if want_song:
                cues.append({
                    "at": len(out),
                    "type": "song",
                    "line": want_song,
                })
                i = m.end()
                while i < n and text[i] == " " and (not out or out[-1] == " "):
                    i += 1
                continue

            # 사진을 찍자. (찍자)
            if WORLD.is_shoot(inner):
                cues.append({
                    "at": len(out),
                    "type": "shoot",
                })
                i = m.end()
                while i < n and text[i] == " " and (not out or out[-1] == " "):
                    i += 1
                continue

            want_place = WORLD.place_marker(inner)

            if want_place:
                # at 은 안 쓰지만 적어 둔다. 아래에서 모든 표시의
                # 자리를 본문 길이에 맞춰 손보는데, 없으면 거기서 터진다.
                cues.append({
                    "at": len(out),
                    "type": "place",
                    "key": want_place,
                })
                i = m.end()
                while i < n and text[i] == " " and (not out or out[-1] == " "):
                    i += 1
                continue

            key = motion_map.get(inner)
            if key:
                cue = {
                    "at": len(out),
                    "type": "motion",
                    "key": key,
                }

                # 쑥스러워하는 몸짓은 세기가 있다.
                # 말끝에 슬쩍 붙인 것과 얼굴을 못 들 만큼인 것이
                # 같은 몸짓일 수는 없다. 문장 전체를 보고 정한다.
                # 상처받은 몸짓(팔짱·등돌리기)은 어떤 마음인지가 같이 간다.
                # 슬프면 슬픔, 화나면 화남, 삐치면 삐죽. 등을 돌린 채
                # 머무는 시간도 마음의 크기가 정한다.
                hurt = AVATAR.hurt_reaction(text)
                if hurt and key in ("cross", "turn_back"):
                    cue["key"] = hurt["motion"]
                    cue["face"] = hurt["expression"]
                    cue["linger_ms"] = hurt.get("linger_ms", 0)

                if key in AVATAR.shy_motions():
                    lv = AVATAR.shy_level(text)
                    if lv:
                        cue["key"] = lv["motion"]
                        cue["level"] = lv["level"]
                        # 표정은 센 단계에서만 함께 간다.
                        # 낮으면 웃으면서 쑥스러워할 수 있어야 한다.
                        if lv["expression"]:
                            cue["face"] = lv["expression"]

                cues.append(cue)
                i = m.end()
                # 표시를 지우면서 생긴 공백 중복을 정리
                while i < n and text[i] == " " and (not out or out[-1] == " "):
                    i += 1
                continue
            # 몸짓이 아니면 얼굴 이름인지 본다.
            #
            # (표정: 째려보기) 또는 (째려보기) 둘 다 받는다.
            # 만화의 얼굴은 이모지로 고를 수 없어서 이름으로 부른다.
            want = inner
            for head in ("표정:", "표정 :", "얼굴:", "얼굴 :"):
                if want.startswith(head):
                    want = want[len(head):].strip()
                    break

            ekey = expr_map.get(want) or expr_map.get(want.replace(" ", ""))
            if ekey:
                e = AVATAR.expression(ekey)
                cues.append({
                    "at": len(out),
                    "type": "expression",
                    "key": ekey,
                    "hold_ms": e.hold_ms if e else 3000,
                })
                i = m.end()
                while i < n and text[i] == " " and (not out or out[-1] == " "):
                    i += 1
                continue

            # 몸짓 이름도 얼굴 이름도 아닌 괄호는 '상황' 이다.
            #
            # 예전에는 버렸다. 그래서 다이아는 몸짓 표에 있는 것만
            # 할 수 있었고, 표에 없는 짓은 아무리 적어도 사라졌다.
            # 이제 괄호째 남겨 화면에 내보낸다 — 상대가
            # (다이아를 지긋이 바라본다) 라고 쓰는 것과 같은 자리다.
            #
            # 한 글자씩 넣는 것이 중요하다. 아래에서 표시가 있던 자리를
            # len(out) 으로 재는데, 여기서 통째로 넣으면 칸 수가 어긋나
            # **그 뒤의 표정과 몸짓이 전부 엉뚱한 자리에서 터진다.**
            at = len(out)
            out.extend(m.group(0))
            i = m.end()

            # 적어 놓고 안 하면 안 적은 것보다 어색하다.
            #
            # (멋쩍은 듯 눈동자가 흔들리며) 라고 써 놓고 얼굴이 가만히
            # 있으면, 글은 흔들린다는데 눈은 멀쩡하다. 그래서 문장을
            # 읽어 얼굴과 몸으로 옮긴다. 못 읽는 문장이 훨씬 많고,
            # 그때는 글자로만 나온다 — 지금까지와 같다.
            act = AVATAR.act_reaction(inner)

            if act:
                if act.get("motion"):
                    cue = {
                        "at": at,
                        "type": "motion",
                        "key": act["motion"],
                    }
                    if act.get("expression"):
                        cue["face"] = act["expression"]
                    cues.append(cue)

                elif act.get("expression"):
                    e = AVATAR.expression(act["expression"])
                    cues.append({
                        "at": at,
                        "type": "expression",
                        "key": act["expression"],
                        "hold_ms": e.hold_ms if e else 3000,
                    })

            continue

        # 이모지 표정
        matched = None
        for token in emoji_to_expr:
            if text.startswith(token, i):
                if matched is None or len(token) > len(matched):
                    matched = token
        if matched:
            e = emoji_to_expr[matched]
            cues.append({
                "at": len(out),
                "type": "expression",
                "key": e.key,
                "hold_ms": e.hold_ms,
            })
            i += len(matched)
            while i < n and text[i] == " " and (not out or out[-1] == " "):
                i += 1
            continue

        out.append(text[i])
        i += 1

    clean = "".join(out)
    clean = re.sub(r"[ \t]{2,}", " ", clean)
    clean = re.sub(r"\s+([,.!?])", r"\1", clean)
    clean = clean.strip()

    # 본문이 줄어든 만큼 위치가 밖으로 나가지 않게 맞춘다
    for c in cues:
        c["at"] = max(0, min(c["at"], len(clean)))

    return clean, cues


# ============================================================
# 감정 및 대화 추출 기능
# ============================================================

# 어떤 감정을 돌려줄 수 있는지도 아바타가 정한다.
VALID_EXPRESSIONS = AVATAR.reply_expression_keys()

def extract_expression(text):
    """문장 속 이모티콘을 역추적하여 감정을 추출합니다.

    이모지와 감정의 대응 관계는 아바타 개체가 소유한다.
    여기서는 대괄호 태그를 걷어내고 판단을 아바타에게 넘긴다.
    """
    if not text:
        return "neutral", ""

    clean_text = text.strip()

    # 과거용 대괄호 감정 태그가 있다면 본문에서 제거
    match = re.search(
        r"\[\s*(joy|happy|sorrow|sad|angry|surprised|fun|neutral)\s*\]",
        clean_text,
        re.IGNORECASE
    )

    if match:
        clean_text = re.sub(
            r"\[\s*(happy|sad|angry|surprised|neutral|joy|sorrow|fun)\s*\]",
            "",
            clean_text,
            flags=re.IGNORECASE
        ).strip()

    return AVATAR.detect_expression(clean_text), clean_text

def clean_reply(text):
    """AI 답변에서 불필요한 연출 기호나 소설식 괄호를 정밀 제거합니다."""
    if not text:
        return ""

    result = text.strip()
    
    # 수동 대괄호 태그가 남아있다면 일괄 청소
    result = re.sub(r"\[(happy|sad|angry|surprised|neutral|joy|sorrow|fun)\]", "", result, flags=re.IGNORECASE).strip()
    # 내부 판단 메모 흔적 청소
    result = re.sub(r"^(감정|표정|emotion)\s*:\s*.*?\n", "", result, flags=re.IGNORECASE).strip()
    # 🌟 소설식 괄호체 표현 완벽 제거 (말풍선 및 기억 오염 방지)

    return result


def _polite(stage):
    """지금 단계가 존댓말을 쓰는지."""
    return stage is None or stage.speech.startswith("존댓말")


def _fallback(stage, polite_text, casual_text):
    """말투가 어긋나면 맥락이 깨지므로 대체 응답도 단계를 따른다."""
    return polite_text if _polite(stage) else casual_text


# ============================================================
# 생각하기
#
# 시스템은 상황만 모아 건넨다(notes). 여기서 다이아가
#   1. 자기 프롬프트를 짓고(성격·사이·기분·할 수 있는 것)
#   2. 지난 이야기를 떠올리고
#   3. 지금 마음을 곁에 두고
#   4. 말투를 다잡은 뒤
# 모델에게 묻는다. 답을 받으면 속마음 줄을 떼어 마음에 쌓고,
# 표정·몸짓 표시를 걷어 낸다.
#
# 순서가 중요하다 — 말투 지시는 **맨 끝**이어야 한다. 모델은 끝을 가장
# 세게 따른다. 마음은 그 바로 앞이다: 상황 중 가장 가까이 두어야
# 방금 느낀 것이 말에 묻어난다. [[dia-autonomy]]
# ============================================================

def _recent(history):
    """보낼 기록. 오래된 것까지 보내면 옛 말투가 예시가 되어 끌려간다."""
    out = []
    for item in history or []:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role not in ("user", "assistant", "system") or not isinstance(content, str):
            continue
        content = content.strip()
        if content:
            out.append({"role": role, "content": content})
    if MAX_HISTORY_MESSAGES > 0:
        out = out[-MAX_HISTORY_MESSAGES:]
    return out


def _ask(messages):
    """모델에게 묻는다. 반환: (답 글, None) 또는 (None, 까닭)."""
    payload = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
        "options": dict(OLLAMA_OPTIONS),
    }
    # 속생각은 화면에 쓰이지 않는데 생성 시간은 다 든다. 끄면 3배 빨라진다.
    if OLLAMA_THINK is not None:
        payload["think"] = OLLAMA_THINK

    try:
        res = requests.post(config.ollama_url(), json=payload, timeout=60)

        # 서버가 이 항목을 모르는 판이면 빼고 한 번만 다시 보낸다.
        if res.status_code == 400 and "think" in payload:
            print("[알림] 서버가 think 항목을 받지 않아 빼고 다시 보냅니다.")
            payload.pop("think")
            res = requests.post(config.ollama_url(), json=payload, timeout=60)

        if res.status_code != 200:
            return None, "http"

        try:
            data = res.json()
        except ValueError:
            return None, "json"

        raw = (data.get("message") or {}).get("content", "")
        if not isinstance(raw, str) or not raw.strip():
            return None, "empty"

        return raw.strip(), None

    # 연결이 안 된 것을 먼저 잡는다. ConnectTimeout 은 ConnectionError 이면서
    # Timeout 이기도 해서, 순서가 바뀌면 닿지도 못한 것을 '생각이 오래
    # 걸린다' 고 답한다(실제로 그래서 원인을 한참 못 찾았다).
    except requests.exceptions.ConnectionError as e:
        print("[모델 서버에 못 닿음]:", e)
        return None, "connect"
    except requests.exceptions.Timeout as e:
        print("[모델이 제때 답을 못 줌]:", e)
        return None, "timeout"
    except Exception as e:
        print("[모델 묻기 오류]:", e)
        return None, "other"


def read(raw):
    """다이아가 한 말을 읽는다 — 속마음·표정·몸짓을 떼어 낸다.

    반환: {"reply", "expression", "cues", "mark"} (reply 가 비면 말이 꼬인 것)
    """
    # 속마음 줄은 **가장 먼저** 뗀다. 몸짓 괄호를 읽는 쪽은 20자가 넘는
    # 괄호를 글로 남기므로, 거기 먼저 가면 속마음이 화면에 새어 나간다.
    text, mark = HEART.read_mark(raw)
    expression, text = extract_expression(text)
    text = clean_reply(text)
    clean, cues = extract_cues(text)
    return {"reply": clean, "expression": expression, "cues": cues, "mark": mark}


def feel_absence(gap_sec, rel=None):
    """오래 못 봤다. 마음에 외로움을 쌓는다(말은 다이아가 알아서)."""
    rel = rel or {}
    state = HEART.load(rel.get("affinity", 0), bool(rel.get("lover")))
    after = HEART.missed(state, gap_sec, rel.get("affinity", 0))
    if after is not state:
        HEART.save(after)
        print(f"[마음]: {gap_sec / 3600:.1f}시간 만 — {HEART.words(after)}")


def heart_view(rel=None):
    """몸이 쓸 지금 마음. 화면을 처음 띄울 때 묻는다."""
    rel = rel or load_relationship() or {}
    state = HEART.load(rel.get("affinity", 0), bool(rel.get("lover")))
    return {"now": HEART.to_view(state), "face": HEART.face(state)}


def feel_event(deltas, rel=None):
    """시스템이 알려 준 일로 마음을 살짝 민다."""
    if not deltas:
        return
    rel = rel or load_relationship() or {}
    state = HEART.load(rel.get("affinity", 0), bool(rel.get("lover")))
    HEART.save(HEART.nudge(state, deltas))


# 일이 났을 때 마음이 어디로 기우는가. 살짝만 민다 — 얼마나 느끼는지는
# 다이아가 답하면서 (마음: ...) 으로 다시 적는다.
_OUTCOME_FEEL = {
    "dia_won":        {"기쁨": 0.3},
    "dia_lost":       {"서운함": 0.15, "짜증": 0.15},
    "draw":           {},
    "you_quit":       {"서운함": 0.1},
    "dia_pressed":    {"기쁨": 0.1, "설렘": 0.05},
    "dia_pressed_on": {"불안": 0.15},
    "dia_slip":       {"부끄러움": 0.25},
    "you_slip":       {"기쁨": 0.1},
}


def react(event):
    """방금 일어난 일에 반응한다(놀이가 끝났다, 장군을 불렀다 …).

    event 는 system/games/events.rebuild 가 다시 지은 것이어야 한다.
    반환은 think() 와 같다. 입을 닫은 사이면 {"ok": False, "why": "silent"}.
    """
    if not event or not event.get("note"):
        return {"ok": False, "why": "no_event"}

    saved = load_relationship() or {}
    affinity = saved.get(
        "affinity", AVATAR.relationship.get("start_affinity", 0))
    stage = AVATAR.next_stage(affinity, saved.get("stage"),
                              AVATAR.gate_grants(saved))

    # 입을 닫은 사이에서는 놀이에도 말하지 않는다(대화와 같다)
    if getattr(stage, "silent", False):
        return {"ok": False, "why": "silent"}

    feel_event(_OUTCOME_FEEL.get(event.get("outcome")), saved)

    note = "[방금 일어난 일] " + event["note"]
    if event.get("again"):
        note += " 판이 끝났다. 한 판 더 할지는 네가 묻고 싶으면 묻는다."

    got = think(
        stage=stage,
        user_name=load_user_name(),
        notes=[{"role": "system", "content": note}],
        affinity=saved.get("affinity"),
        lover=bool(saved.get("lover", False)),
    )

    if got.get("ok"):
        print(f"[반응] {event.get('game')}/{event.get('kind')}: {got['reply'][:40]}")

    return got


def think(stage, transition=None, user_name=None, notes=None,
          world_blocks=None, mood=0, affinity=None, lover=False, remember=True):
    """상황을 받아 생각하고 답한다.

    반환: {"ok": True, "reply", "expression", "cues", "mark", "feel"}
          또는 {"ok": False, "why": http|json|empty|garbled|connect|timeout|other}

    remember=True 면 한 말을 기록에 남긴다(부르는 쪽이 남기면 False).
    지금은 부르는 쪽(system/chat 의 done)이 남기므로 기본값을 쓰는 곳은
    react·keep_talking 이다.
    """
    prompt = AVATAR.system_prompt(
        world_blocks=world_blocks,
        stage=stage,
        transition=transition,
        mood=mood,
        lover=lover,
        # 같은 친구라도 살가운 날이 있고 시무룩한 날이 있다
        affinity=affinity,
    )
    if user_name:
        prompt += "\n" + AVATAR.address_block(user_name)

    try:
        history = load_memory()
    except Exception as e:
        print(f"[기억 불러오기 오류]: {e}")
        history = []

    messages = [{"role": "system", "content": prompt}]
    messages += _recent(history if isinstance(history, list) else [])
    messages += list(notes or [])

    # 지금 마음. 무엇을 느끼는지만 적는다 — 어떻게 말하라고는 안 적는다.
    state = HEART.load(affinity or 0, lover)
    feel_now = HEART.words(state)
    if feel_now:
        messages.append({"role": "system", "content": f"[지금 네 마음] {feel_now}"})

    reminder = AVATAR.tone_reminder(stage, transition, user_name)
    if reminder:
        messages.append({"role": "system", "content": reminder})

    raw, why = _ask(messages)
    if raw is None:
        return {"ok": False, "why": why}

    got = read(raw)
    if not got["reply"]:
        return {"ok": False, "why": "garbled"}

    # 다이아가 적은 속마음을 마음에 쌓는다. 안 적었으면 가라앉기만 한다.
    if got["mark"]:
        state = HEART.absorb(state, got["mark"])
        print(f"[마음]: {HEART.words(state)}")
    HEART.save(state)

    if remember:
        try:
            append_message("assistant", got["reply"])
        except Exception as e:
            print(f"[답 기억 저장 오류]: {e}")

    got["ok"] = True
    got["feel"] = {"now": HEART.to_view(state), "face": HEART.face(state)}
    return got


# ============================================================
# 혼자 말 잇기
#
# 대답이 없어도 말을 멈추지 않는 단계가 있다(Stage.keeps_talking).
# 얀데레가 그렇다. 상대가 조용한 것을 기다림으로 받아들이지 않는다.
#
# 정해둔 문장(first_talk)을 꺼내는 것과는 다르다. 그건 몇 번 듣고 나면
# 같은 말이 돌아오는 게 보인다. 여기서는 매번 새로 생각한다.
# "안녕" 이라고 했는데 답이 없으면 "안녕이라고 했는데 왜 대답 안 해?" 가
# 나오는 자리다. 그러려면 자기가 방금 뭐라고 했는지를 알아야 하므로
# 대화 기록을 그대로 태운다.
#
# 몇 번째로 혼자 말하는 중인지는 기록의 꼬리를 세어 알아낸다.
# 끝에 assistant 만 이어져 있으면 그만큼 답을 못 받은 것이다.
# ============================================================

def _unanswered_count(history):
    n = 0
    for item in reversed(history or []):
        if not isinstance(item, dict):
            continue
        if item.get("role") == "assistant":
            n += 1
        elif item.get("role") == "user":
            break
    return n


def _nudge_note(n):
    """혼자 말을 이어갈 때 붙이는 지시. 횟수에 따라 온도가 달라진다."""

    if n <= 1:
        return ("상대가 아직 아무 말도 하지 않았다. 방금 네가 한 말에 답이 없다. "
                "기다리지 말고 네가 먼저 말을 이어라. "
                "왜 대답이 없는지 짚어도 되고, 다른 말을 꺼내도 된다.")

    if n <= 3:
        return (f"네가 {n}번 말했는데 상대는 한 번도 답하지 않았다. "
                "같은 말을 되풀이하지 마라. 앞에서 한 말을 이어받아 "
                "한 걸음 더 들어가라.")

    return (f"네가 {n}번째 혼자 말하고 있다. 상대는 계속 조용하다. "
            "그래도 멈추지 않는다. 화를 내지도 매달리지도 마라. "
            "혼잣말처럼 조용히, 그러나 분명하게 이어라.")


def keep_talking():
    """대답이 없어도 스스로 생각해서 다음 말을 만든다.

    부를 수 없는 상태(모델 오류 등)면 None 을 돌려준다.
    그때는 부르는 쪽이 정해둔 문장으로 넘어간다.
    """

    saved = load_relationship() or {}
    affinity = saved.get(
        "affinity", AVATAR.relationship.get("start_affinity", 0))
    stage = AVATAR.next_stage(affinity, saved.get("stage"),
                              AVATAR.gate_grants(saved))

    try:
        history = load_memory()
        if not isinstance(history, list):
            history = []
    except Exception as e:
        print(f"[혼자 말 잇기 - 기억 오류]: {e}")
        history = []

    n = _unanswered_count(history)

    got = think(
        stage=stage,
        user_name=load_user_name(),
        notes=[{"role": "system", "content": _nudge_note(n)}],
        affinity=saved.get("affinity"),
        lover=bool(saved.get("lover", False)),
    )

    if not got.get("ok"):
        return None

    print(f"[혼자 말 잇기]: {n + 1}번째 · {stage.label}")

    return {
        "reply": got["reply"],
        "cues": got["cues"],
        "expression": got["expression"],
        "unanswered": n + 1,
        "feel": got.get("feel"),
    }


# ============================================================
# 표시 기록
#
# 괄호 몸짓과 이모지 표정은 화면에 내보내기 전에 걷어낸다. 그래서
# 대화 기록만 봐서는 다이아가 무엇을 했는지 알 수 없다 —
# "기지개를 켰다" 는 말을 들어도 로그에 그 흔적이 없다.
#
# 무엇이 왜 나왔는지 뒤늦게 따져 보려면 걷어낸 것을 따로 적어 두어야 한다.
# ============================================================

CUE_LOG = "_cue_log.txt"


def log_cues(user_text, reply, cues, extra=None, feel=None):
    if not cues and not extra and not feel:
        return
    try:
        import datetime
        now = datetime.datetime.now().strftime("%m-%d %H:%M:%S")
        with open(CUE_LOG, "a", encoding="utf-8") as f:
            print(f"[{now}] 상대: {str(user_text)[:60]}", file=f)
            print(f"           다이아: {str(reply)[:60]}", file=f)
            for c in (cues or []):
                if c.get("type") == "motion":
                    bits = [f"몸짓 {c.get('key')}"]
                    if c.get("face"):
                        bits.append(f"+ 표정 {c.get('face')}")
                    if c.get("linger_ms"):
                        bits.append(f"머묾 {c.get('linger_ms')}ms")
                    if c.get("level"):
                        bits.append(f"{c.get('level')}단계")
                    print("           " + " ".join(bits), file=f)
                else:
                    print(f"           표정 {c.get('key')}", file=f)
            if extra:
                print(f"           {extra}", file=f)
            if feel:
                print(f"           마음 {feel.get('feel')} · {feel.get('thought') or ''}", file=f)
            print("", file=f)
    except Exception:
        pass

