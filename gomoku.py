# -*- coding: utf-8 -*-
"""오목 — 규칙과 다이아가 둘 자리.

체스·끝말잇기와 같은 자리다. **규칙은 서버가 쥔다.** 무슨 말을 할지는
개체(avatar.py)가 정하고, 어디에 둘지는 여기가 정한다.

판은 15x15. 칸을 문자열 225자로 들고 다닌다 — 기억에 그대로 넣고
화면에 그대로 보내려면 이 편이 다루기 쉽다.

  '.' 빈 칸   'b' 검은 돌   'w' 흰 돌

검은 쪽이 먼저 둔다. 오목은 먼저 두는 쪽이 유리해서, 사람에게
검은 쪽을 준다.

## 두는 눈

수를 깊게 읽지 않는다. **줄을 세어 점수를 매긴다.**

다섯 칸짜리 창을 판 전체에 훑으면서, 그 창에 내 돌이 몇이고 상대
돌이 몇인지로 값을 매긴다. 오목은 '몇 줄을 만들고 몇 줄을 막는가'
가 거의 전부라 이것만으로도 꽤 둔다.

깊게 읽는 것보다 이 편이 나은 까닭 — 오목은 가지가 225개라 두 수만
읽어도 5만 갈래다. 체스처럼 가지를 쳐내기도 어렵다. 줄 세기는 한 수에
0.05초면 끝나고, 사람이 느끼기에는 충분히 세다.
"""
import random

SIZE = 15
EMPTY = "."
BLACK = "b"
WHITE = "w"

WIN = 5

# 네 방향. 반대쪽은 같은 줄이라 안 본다.
DIRS = ((0, 1), (1, 0), (1, 1), (1, -1))


# ============================================================
# 판
# ============================================================

def new_board():
    return EMPTY * (SIZE * SIZE)


def at(board, r, c):
    if r < 0 or r >= SIZE or c < 0 or c >= SIZE:
        return None
    return board[r * SIZE + c]


def put(board, r, c, stone):
    i = r * SIZE + c
    return board[:i] + stone + board[i + 1:]


def empties(board):
    return [i for i, ch in enumerate(board) if ch == EMPTY]


def is_full(board):
    return EMPTY not in board


def other(stone):
    return WHITE if stone == BLACK else BLACK


# ============================================================
# 이겼는가
# ============================================================

def winner_at(board, r, c):
    """방금 (r,c)에 둔 돌로 다섯이 됐는가. 됐으면 그 돌, 아니면 None."""
    me = at(board, r, c)

    if not me or me == EMPTY:
        return None

    for dr, dc in DIRS:
        n = 1

        for sign in (1, -1):
            rr, cc = r + dr * sign, c + dc * sign

            while at(board, rr, cc) == me:
                n += 1
                rr += dr * sign
                cc += dc * sign

        if n >= WIN:
            return me

    return None


def winner(board):
    """판 전체에서 이긴 쪽. 없으면 None."""
    for r in range(SIZE):
        for c in range(SIZE):
            if board[r * SIZE + c] != EMPTY:
                w = winner_at(board, r, c)
                if w:
                    return w

    return None


# ============================================================
# 줄 세기
#
# 다섯 칸짜리 창 하나에 내 돌만 있으면 값이 있고, 상대 돌이 섞여
# 있으면 값이 없다. 그 창은 이제 다섯이 될 수 없기 때문이다.
#
# 값은 돌 수에 가파르게 준다. 넷은 셋보다 훨씬 급하다 —
# 넷을 놓치면 다음 수에 진다.
# ============================================================

SCORE = {0: 0, 1: 1, 2: 12, 3: 120, 4: 2400, 5: 200000}


# 모양마다의 값. 'x' 가 내 돌, 'o' 가 상대 돌(과 판 가장자리), '.' 이 빈 칸.
#
# 열린 넷(.xxxx.)은 막을 수가 없다 — 양쪽을 한 번에 못 막는다. 그래서
# 넷 중에서도 따로 크게 친다. 열린 셋은 다음 수에 그 열린 넷이 되므로
# 막힌 넷과 비슷한 값을 줘야 제때 막는다.
PATTERNS = (
    ("xxxxx", 200000),      # 다섯. 끝난 판.
    (".xxxx.", 20000),      # 열린 넷 — 못 막는다
    ("xxxx.", 3000), (".xxxx", 3000),                    # 막힌 넷
    ("xx.xx", 3000), ("x.xxx", 3000), ("xxx.x", 3000),   # 사이가 뜬 넷
    (".xxx.", 2200),        # 열린 셋 — 안 막으면 진다
    (".xx.x.", 1400), (".x.xx.", 1400),                  # 사이가 뜬 열린 셋
    ("xxx.", 180), (".xxx", 180),                        # 막힌 셋
    ("xx.x", 180), ("x.xx", 180),
    ("..xx..", 160),        # 널널한 둘 — 여기서 열린 셋이 나온다
    (".xx.", 110),
    (".x.x.", 90),
    ("xx.", 14), (".xx", 14),
    (".x.", 6),
)


def _lines():
    """판의 모든 줄(가로·세로·대각 둘)을 자리 번호로 미리 뽑아 둔다.

    다섯 칸짜리 창이 아니라 **줄 하나를 통째로** 쥔다. 창으로 세면
    돌이 몇인지만 보이고 양 끝이 열렸는지가 안 보이기 때문이다.

    길이가 다섯보다 짧은 줄은 뺀다 — 거기서는 다섯이 안 나온다.
    매번 만들면 한 수에 수천 번 도는 자리라 눈에 띄게 느려진다.
    """
    out = []

    for dr, dc in DIRS:
        for r in range(SIZE):
            for c in range(SIZE):
                # 그 방향으로 한 칸 뒤가 판 안이면 줄의 머리가 아니다.
                # 안 그러면 같은 줄을 열다섯 번 뽑는다.
                pr, pc = r - dr, c - dc

                if 0 <= pr < SIZE and 0 <= pc < SIZE:
                    continue

                line = []
                rr, cc = r, c

                while 0 <= rr < SIZE and 0 <= cc < SIZE:
                    line.append(rr * SIZE + cc)
                    rr, cc = rr + dr, cc + dc

                if len(line) >= WIN:
                    out.append(tuple(line))

    return out


LINES = _lines()


def _lines_at():
    """자리마다 그 자리를 지나는 줄들. 한 자리는 많아야 넷이다.

    한 수를 재는 데 판 전체를 다시 셀 까닭이 없다. **돌 하나를 놓아
    값이 달라지는 줄은 그 자리를 지나는 넷뿐이다.** 판 전체가 일흔두
    줄이니 열여덟 배 빠르다 — 이 덕에 한 수 앞을 볼 여유가 생긴다.
    """
    out = [[] for _ in range(SIZE * SIZE)]

    for line in LINES:
        for i in line:
            out[i].append(line)

    return out


LINES_AT = _lines_at()

# 막는 값을 조금 더 쳐 준다.
#
# 같은 값으로 보면 상대가 넷을 만들어도 자기 셋을 놓는다. 오목은
# 한 수만 늦어도 지는 놀이다.
DEFEND = 1.15


def _text(board, line, me, him):
    """줄 하나를 글자로. 양 끝에 'o' 를 붙인다 — 가장자리는 막힌 것이다."""
    return "o" + "".join(
        "x" if board[i] == me else ("o" if board[i] == him else ".")
        for i in line
    ) + "o"


def _worth(text):
    """글자로 적은 줄 하나의 값."""
    if "x" not in text:
        return 0

    total = 0

    for pat, val in PATTERNS:
        n = text.count(pat)

        if n:
            total += val * n

    return total


def side_score(board, me):
    """내 돌만 놓고 봤을 때 이 판이 얼마나 좋은가."""
    him = other(me)

    return sum(_worth(_text(board, line, me, him)) for line in LINES)


def evaluate(board, me):
    """지금 판이 나에게 얼마나 좋은가. 내 모양 - 상대 모양."""
    return side_score(board, me) - int(side_score(board, other(me)) * DEFEND)


def move_value(board, i, me):
    """그 자리에 두면 얼마나 좋은가.

    **얻는 것과 막는 것을 같이 센다.** 내 모양이 얼마나 자라는가와,
    상대의 모양을 얼마나 무너뜨리는가다. 값이 달라지는 줄은 그 자리를
    지나는 넷뿐이라 판 전체를 다시 셀 까닭이 없다.
    """
    him = other(me)
    r, c = divmod(i, SIZE)
    after = put(board, r, c, me)

    gain = 0

    for line in LINES_AT[i]:
        gain += _worth(_text(after, line, me, him))
        gain -= _worth(_text(board, line, me, him))

        # 상대에게서 빼앗은 것
        gain += int((_worth(_text(board, line, him, me))
                     - _worth(_text(after, line, him, me))) * DEFEND)

    return gain


# ============================================================
# 어디에 둘까
# ============================================================

def _near(board, gap=2):
    """이미 놓인 돌 둘레만 본다.

    빈 판 225칸을 다 재면 느리기도 하고, 아무도 없는 구석에 두는
    이상한 수가 나온다. 오목은 돌이 모인 데서 승부가 난다.
    """
    if all(ch == EMPTY for ch in board):
        mid = SIZE // 2
        return [mid * SIZE + mid]

    seen = set()

    for i, ch in enumerate(board):
        if ch == EMPTY:
            continue

        r, c = divmod(i, SIZE)

        for dr in range(-gap, gap + 1):
            for dc in range(-gap, gap + 1):
                rr, cc = r + dr, c + dc

                if 0 <= rr < SIZE and 0 <= cc < SIZE:
                    j = rr * SIZE + cc
                    if board[j] == EMPTY:
                        seen.add(j)

    return sorted(seen)


LEVELS = {
    # blunder 는 한눈파는 확률, look 은 한 수 앞을 보는가,
    # wide 는 한 수 앞에서 몇 자리까지 헤아리는가다.
    "easy": {"label": "쉬움", "blunder": 0.35, "look": False, "wide": 0},
    "normal": {"label": "보통", "blunder": 0.06, "look": False, "wide": 0},
    "hard": {"label": "어려움", "blunder": 0.0, "look": True, "wide": 8},
    # 봐주지도, 한눈팔지도 않는다. 열린 셋을 보면 반드시 막고
    # 자기 열린 셋은 반드시 만든다.
    "sharp": {"label": "독하게", "blunder": 0.0, "look": True, "wide": 14},
}

# 이 값이 넘는 수는 '못 막는 수' 다 — 열린 넷이거나 다섯이다.
# 봐주기도 한눈팔기도 여기서는 멈춘다.
FORCING = 18000


def choose(board, me, level="normal", mercy=0.0, rng=None):
    """다이아가 둘 자리. 둘 데가 없으면 None.

    blunder 는 이 확률로 한눈을 파는 것이다. 깊이만 낮추면 아무리
    낮춰도 잘 안 진다 — 줄을 세는 눈은 그대로라서 공짜로 주는 법이
    없기 때문이다. 체스에서 배운 것과 같다.

    **다만 한 수면 이기는 자리와 막아야 하는 자리는 안 놓친다.**
    눈앞의 다섯을 못 보는 것은 쉬운 상대가 아니라 이상한 상대다.

    봐주기도 한눈팔기도 **급한 자리에서는 멈춘다.** 상대가 열린 셋을
    놓았는데 딴 데 두는 것은 봐주는 것이 아니라 그냥 지는 것이다.
    """
    rng = rng or random

    conf = LEVELS.get(level) or LEVELS["normal"]
    spots = _near(board)

    if not spots:
        return None

    him = other(me)

    # 1. 두면 이기는 자리
    for i in spots:
        r, c = divmod(i, SIZE)
        if winner_at(put(board, r, c, me), r, c) == me:
            return i

    # 2. 안 막으면 지는 자리
    for i in spots:
        r, c = divmod(i, SIZE)
        if winner_at(put(board, r, c, him), r, c) == him:
            return i

    # 3. 한 수씩 값을 매긴다. 얻는 것과 막는 것을 같이 센다.
    scored = sorted(((move_value(board, i, me), i) for i in spots),
                    reverse=True)

    # 지금이 급한 자리인가 — 열린 넷을 만들 수 있거나 막아야 하는가.
    urgent = bool(scored) and scored[0][0] >= FORCING

    # 4. 봐주기 — 사이가 깊으면 가끔 느슨하게 둔다.
    #
    # 예전에는 아무 빈 칸이나 골랐다. 오목에서 그것은 봐주는 것이
    # 아니라 한 판을 통째로 내주는 것이다 — 한 수만 놓쳐도 열린 셋이
    # 열린 넷이 된다. 좋은 자리 몇 개 중 아래쪽을 고르는 정도로 둔다.
    if mercy and not urgent and rng.random() < mercy:
        soft = [i for _, i in scored[2:7]] or [i for _, i in scored[:3]]
        return rng.choice(soft)

    # 5. 한눈팔기 — 쉬운 세기에서만. 급한 자리에서는 안 한다.
    if conf["blunder"] and not urgent and rng.random() < conf["blunder"]:
        return rng.choice(spots)

    # 6. 한 수 앞 — 내가 두면 상대가 어디를 둘까.
    #
    # **상대의 답도 좋은 것부터 봐야 한다.** 처음에는 상대가 둘 수
    # 있는 자리를 판 왼쪽 위에서 열두 개 집어 봤는데, 그러면 좋은
    # 답이 아니라 아무 답이나 보는 것이라 오히려 약해졌다 —
    # 열여섯 판에서 보통에게 7승밖에 못 했다.
    #
    # 내 후보도 좋은 것 몇 개만 본다. 나머지는 어차피 안 고른다.
    if conf["look"] and scored and not urgent:
        deep = []

        for v, i in scored[:max(2, conf["wide"])]:
            b2 = put(board, *divmod(i, SIZE), me)

            # 상대가 가장 잘 두는 답
            reply = max((move_value(b2, j, him) for j in _near(b2)),
                        default=0)

            # 내가 얻은 것에서 상대가 얻을 것을 뺀다.
            # 조금 깎는 것은 '내 차례가 먼저' 라는 값이다.
            deep.append((v - int(reply * 0.9), i))

        scored = sorted(deep, reverse=True)

    # 값이 같은 자리가 여럿이면 그중에서 고른다. 늘 같은 데 두면 심심하다.
    best = scored[0][0]
    top = [i for v, i in scored if v == best]

    return rng.choice(top)


# ============================================================
# 화면에 보낼 한 벌
# ============================================================

def view(board, dia_stone):
    """화면이 그릴 것.

    rows 는 15줄짜리 문자열 목록이다. 화면이 한 글자씩 읽어 그린다.
    """
    return {
        "size": SIZE,
        "rows": [board[r * SIZE:(r + 1) * SIZE] for r in range(SIZE)],
        "dia": dia_stone,
        "you": other(dia_stone),
        "moves": empties(board),
        "full": is_full(board),
    }


def coord(i):
    """225 자리 번호를 (줄, 칸)으로."""
    return divmod(i, SIZE)


def name(i):
    """사람이 읽는 자리 이름. A1 ~ O15."""
    r, c = divmod(i, SIZE)
    return "%s%d" % (chr(ord("A") + c), r + 1)
