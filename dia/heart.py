"""마음 — 다이아가 지금 무엇을 얼마나 느끼는가.

다이아 쪽이다(2026-10-01, 나누기 2단계).

예전에는 '기분 0~6칸' 하나였다. 상해 있는 정도만 있어서, 기쁘면서
설레는 것, 서운하면서도 보고 싶은 것을 담을 자리가 없었다.
여기서는 감정마다 세기(0~1)를 따로 쥔다.

**감정은 규칙이 정하지 않는다.** 다이아가 답을 하면서 자기 속마음을
한 줄 적는다 — (마음: 서운함 6, 애정 4 — 아까 져서 아직 분하다).
그 줄은 화면에 안 나가고 여기로 온다. 다이아가 느낀 것을 다이아가
말하게 두는 것이다. [[dia-autonomy]]

시스템이 알려 주는 일(놀이에서 졌다, 만졌다)은 살짝 밀어 줄 뿐이고,
그 일에 대해 어떻게 느끼는지는 다음 답에서 다이아가 다시 적는다.

시간이 지나면 가라앉는다. 뒤에서 시계를 돌리지 않고 읽을 때마다
지난 시간을 재서 깎는다(기분과 같은 방식). 애정은 사이가 정하는
바닥까지만 내려가고, 오래 못 보면 외로움이 쌓인다.
"""

import math
import re
import time

# 이름, 반감기(분), 몸이 지을 얼굴
#
# 얼굴은 다이아의 표정 표(avatar.py)에 있는 것만 쓴다.
EMOTIONS = [
    ("기쁨",     40, "joy"),
    ("설렘",     30, "fun"),
    ("애정",    240, "fun"),
    ("슬픔",     90, "sorrow"),
    ("서운함",  120, "sorrow"),
    ("짜증",     45, "angry"),
    ("불안",     60, "sorrow"),
    ("부끄러움", 15, "fun"),
    ("외로움",  180, "sorrow"),
]

NAMES = [e[0] for e in EMOTIONS]
_HALF = {e[0]: e[1] for e in EMOTIONS}
_FACE = {e[0]: e[2] for e in EMOTIONS}

# 같은 뜻의 다른 말. 다이아가 표에 없는 이름을 적어도 버리지 않는다.
_ALIAS = {
    "행복": "기쁨", "즐거움": "기쁨", "신남": "기쁨", "반가움": "기쁨",
    "두근거림": "설렘", "기대": "설렘", "들뜸": "설렘",
    "좋아함": "애정", "사랑": "애정", "다정함": "애정", "그리움": "외로움",
    "속상함": "서운함", "섭섭함": "서운함", "실망": "서운함", "억울함": "서운함",
    "분함": "짜증", "화": "짜증", "분노": "짜증", "질투": "짜증", "답답함": "짜증",
    "걱정": "불안", "초조함": "불안", "두려움": "불안", "긴장": "불안",
    "쑥스러움": "부끄러움", "민망함": "부끄러움", "창피함": "부끄러움",
    "쓸쓸함": "외로움", "심심함": "외로움",
    "우울": "슬픔", "슬픔": "슬픔",
}

# 속생각을 얼마나 오래 들고 있는가(초). 이보다 지나면 다음 답에 안 건넨다.
THOUGHT_TTL = 45 * 60

# 이보다 약하면 없는 것으로 친다
FLOOR = 0.12

_MARK_RE = re.compile(r"[（(]\s*마음\s*[:：]\s*([^()（）]*?)\s*[)）]")


def _clamp(v):
    return max(0.0, min(1.0, float(v)))


# ------------------------------------------------------------
# 바닥 — 시간이 지나도 이 아래로는 안 내려간다
# ------------------------------------------------------------

def baseline(affinity=0, lover=False):
    """사이가 정하는 바닥. 애정만 바닥이 있다."""
    a = max(0.0, float(affinity or 0))
    fond = min(0.45, a / 600.0) + (0.15 if lover else 0.0)
    return {"애정": round(fond, 3)}


# ------------------------------------------------------------
# 읽기 — 지난 시간만큼 가라앉힌다
# ------------------------------------------------------------

def settle(state, now=None, affinity=0, lover=False):
    """지난 시간만큼 가라앉힌 마음을 돌려준다(저장은 안 한다)."""
    now = time.time() if now is None else now
    state = dict(state or {})
    feel = dict(state.get("feel") or {})
    at = state.get("at")
    at = now if at is None else float(at)
    mins = max(0.0, (now - at) / 60.0)
    base = baseline(affinity, lover)

    out = {}
    for name in NAMES:
        v = _clamp(feel.get(name, 0.0))
        b = base.get(name, 0.0)
        if mins > 0 and v != b:
            k = math.pow(0.5, mins / _HALF[name])
            v = b + (v - b) * k
        if v >= 0.01 or b:
            out[name] = round(max(v, 0.0), 3)

    state["feel"] = out
    state["at"] = now
    return state


# ------------------------------------------------------------
# 다이아가 적은 속마음 읽기
# ------------------------------------------------------------

def read_mark(text):
    """(마음: 서운함 6, 애정 4 — 아까 져서 분하다) 를 찾아 걷어 낸다.

    반환: (걷어 낸 글, {"feel": {이름: 0~1}, "thought": str} 또는 None)
    여럿이면 마지막 것을 쓴다(말하다가 마음이 바뀐 것이다).
    """
    if not text:
        return text, None

    found = None
    for m in _MARK_RE.finditer(text):
        found = m.group(1)
    if found is None:
        return text, None

    clean = _MARK_RE.sub("", text)
    clean = re.sub(r"[ \t]{2,}", " ", clean).strip()

    # 감정 목록과 속생각을 가른다. 대시·세로줄·빗금·띄운 줄표(' - ') 뒤가 속생각이다.
    parts = re.split(r"\s*(?:—|–|--|\||/)\s*|\s+-\s+", found, maxsplit=1)
    feels_txt = parts[0]
    thought = parts[1].strip() if len(parts) > 1 else ""

    feel = {}
    for name, num in re.findall(r"([가-힣]+)\s*(\d+(?:\.\d+)?)", feels_txt):
        key = name if name in _HALF else _ALIAS.get(name)
        if not key:
            # '서운함이' 처럼 조사가 붙었을 수 있다
            for n in NAMES:
                if name.startswith(n):
                    key = n
                    break
        if not key:
            continue
        v = float(num)
        v = v / 10.0 if v > 1 else v
        feel[key] = max(feel.get(key, 0.0), _clamp(v))

    # 숫자 없이 이름만 적었으면 보통 세기로 친다
    if not feel:
        for word in re.findall(r"[가-힣]+", feels_txt):
            key = word if word in _HALF else _ALIAS.get(word)
            if key:
                feel[key] = max(feel.get(key, 0.0), 0.5)

    if not feel and not thought:
        return clean, None

    return clean, {"feel": feel, "thought": thought[:80]}


def absorb(state, mark, now=None):
    """다이아가 적은 속마음을 받아들인다.

    적은 감정은 그 값 쪽으로 크게 옮긴다(방금 느낀 것이 가장 정확하다).
    안 적은 감정은 건드리지 않는다 — 가라앉는 것은 settle 이 한다.
    """
    now = time.time() if now is None else now
    state = dict(state or {})
    feel = dict(state.get("feel") or {})

    for name, v in (mark or {}).get("feel", {}).items():
        old = feel.get(name, 0.0)
        feel[name] = round(_clamp(old * 0.3 + v * 0.7), 3)

    state["feel"] = feel
    state["at"] = now

    thought = (mark or {}).get("thought")
    if thought:
        state["thought"] = thought
        state["thought_at"] = now

    return state


def nudge(state, deltas, now=None):
    """시스템이 알려 준 일로 살짝 민다. deltas = {이름: +-0.x}"""
    now = time.time() if now is None else now
    state = dict(state or {})
    feel = dict(state.get("feel") or {})
    for name, d in (deltas or {}).items():
        if name in _HALF:
            feel[name] = round(_clamp(feel.get(name, 0.0) + float(d)), 3)
    state["feel"] = feel
    state["at"] = now
    return state


def missed(state, gap_sec, affinity=0, now=None):
    """오래 못 봤다. 사이가 가까울수록 외로움이 더 쌓인다."""
    if not gap_sec or gap_sec < 3 * 3600:
        return state
    hours = gap_sec / 3600.0
    close = min(1.0, max(0.0, float(affinity or 0) / 300.0))
    add = min(0.6, 0.08 * math.log2(hours / 1.5)) * (0.4 + 0.6 * close)
    return nudge(state, {"외로움": add}, now)


# ------------------------------------------------------------
# 건네기 — 다이아에게, 몸에게
# ------------------------------------------------------------

def strongest(state, n=3):
    feel = (state or {}).get("feel") or {}
    items = [(k, v) for k, v in feel.items() if v >= FLOOR]
    items.sort(key=lambda kv: -kv[1])
    return items[:n]


def _how(v):
    if v >= 0.8:
        return "몹시 "
    if v >= 0.6:
        return "꽤 "
    if v >= 0.35:
        return ""
    return "조금 "


def words(state, now=None):
    """지금 마음을 한두 줄로. 적을 것이 없으면 None.

    무슨 말을 하라고는 적지 않는다. 시간·곳과 같은 방식으로 상황만 준다.
    """
    now = time.time() if now is None else now
    top = strongest(state)
    lines = []

    if top:
        lines.append(", ".join(f"{_how(v)}{k}" for k, v in top) + ".")

    t = (state or {}).get("thought")
    t_at = (state or {}).get("thought_at") or 0
    if t and now - t_at <= THOUGHT_TTL:
        lines.append(f"방금 속으로 한 생각: {t}")

    return " ".join(lines) if lines else None


def face(state):
    """가장 센 감정이 짓는 얼굴. 없으면 None. (몸이 쓴다)"""
    top = strongest(state, 1)
    if not top:
        return None
    name, v = top[0]
    return {"emotion": name, "level": round(v, 2), "expression": _FACE[name]}


def to_view(state):
    """화면에 줄 모양 — 감정마다 세기."""
    feel = (state or {}).get("feel") or {}
    return {k: round(v, 2) for k, v in feel.items() if v >= 0.05}


# ------------------------------------------------------------
# 저장소
# ------------------------------------------------------------

def load(affinity=0, lover=False, now=None):
    from memory_manager import load_heart
    return settle(load_heart(), now, affinity, lover)


def save(state):
    from memory_manager import save_heart
    return save_heart(state)
