# _verify_first_again.py
# 놀이 시작 전 선공 가위바위보, 그리고 끝난 뒤 '한 판 더'
#
#   1. 오목·장기·할리갈리·끝말잇기가 가위바위보로 선공을 정하는가
#      (비기면 다시, 다이아가 이기면 다이아 먼저, 사람이 이기면 고른다)
#   2. 다이아가 먼저면 판을 열자마자 다이아가 첫 수를 두는가
#   3. 판이 끝나면 한 판 더 할지 묻는가 (기권에는 안 묻는다)
#   4. "그래 한판 더 하자" / "그만할래" 를 알아듣는가
#
# 진짜 계정과 기억을 안 건드리도록 임시 자리에서 돈다.

import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.chdir(HERE)

SANDBOX = tempfile.mkdtemp(prefix="dia_first_")

import store  # noqa: E402

# **먼저 자리를 옮긴다.** 안 옮기면 진짜 계정 파일에 쓴다.
store.HERE = SANDBOX

import accounts  # noqa: E402
import gomoku as GO  # noqa: E402
import janggi as JG  # noqa: E402
import main  # noqa: E402
import memory_manager  # noqa: E402
import who  # noqa: E402
from avatar import AVATAR  # noqa: E402

accounts.ITERATIONS = 1000

app = main.app
app.config["TESTING"] = True

fails = []


def ok(cond, what, detail=""):
    if cond:
        print("  PASS  " + what)
    else:
        print("  FAIL  " + what + ("  -- " + str(detail) if detail else ""))
        fails.append(what)


def signup(c, name):
    return c.post("/api/signup", json={
        "id": name, "password": "pw1234", "again": "pw1234"}).get_json()


def poke(name, key, value):
    """그 사람의 기억에 판을 직접 놓는다."""
    who.set_current(accounts.slot_of(name))
    data = memory_manager.load_memory_data()
    data[key] = value
    memory_manager.save_memory_data(data)


def decide(c, game, want):
    """want(you|dia) 가 먼저 두게 될 때까지 가위바위보를 낸다."""
    r = c.post("/api/first/start", json={"game": game}).get_json()
    assert r["ok"] and r["deciding"], r

    for _ in range(60):
        r = c.post("/api/first/rps", json={"hand": "rock"}).get_json()

        if r.get("first") == "dia":
            if want == "dia":
                return r
            # 다이아가 가져갔다. 사람이 먼저 두는 판이 필요하면 다시.
            c.post("/api/first/start", json={"game": game})
            continue

        if r.get("choose"):
            return c.post("/api/first/choose", json={"first": want}).get_json()

    raise AssertionError("가위바위보가 60번 안에 안 갈렸다")


print("한 판 더 — 대답 가르기")

for text, want in [
    ("그래 한판 더 하자", "yes"),
    ("한판 더 할레", "yes"),
    ("한 판 더 할래", "yes"),
    ("다시 하자", "yes"),
    ("응", "yes"),
    ("좋아!", "yes"),
    ("ㅇㅇ", "yes"),
    ("그만 할래", "no"),
    ("그만할레", "no"),
    ("아니 됐어", "no"),
    ("나중에 하자", "no"),
    ("안 할래", "no"),
    ("그래 그만하자", "no"),
    ("아니 한판 더 하자", "yes"),
    ("오늘 뭐 먹었어?", None),
    ("응 근데 오늘 학교에서 있었던 일 말해줄까", None),
]:
    got = AVATAR.again_answer(text)
    ok(got == want, f"'{text}' -> {want}", got)


print()
print("선공 가위바위보")

with app.test_client() as c:
    signup(c, "tosser")

    r = c.post("/api/first/start", json={"game": "nope"})
    ok(r.status_code == 400, "없는 놀이는 막는다", r.status_code)

    r = c.post("/api/first/rps", json={"hand": "rock"}).get_json()
    ok(r["ok"] is False, "시작 전에는 가위바위보를 못 낸다", r)

    r = c.post("/api/first/start", json={"game": "gomoku"}).get_json()
    ok(r["ok"] and r["deciding"] and len(r["hands"]) == 3,
       "정하는 중으로 열고 손 셋을 준다", r)
    ok(bool(r.get("line")), "가위바위보로 정하자고 말한다", r.get("line"))

    r = c.post("/api/first/start",
               json={"game": "gomoku", "again": True}).get_json()
    ok(r["line"] and "가위바위보" in r["line"],
       "한 판 더로 온 것이면 반기는 말 + 가위바위보", r.get("line"))

    seen = set()
    for _ in range(60):
        c.post("/api/first/start", json={"game": "halli"})
        r = c.post("/api/first/rps", json={"hand": "paper"}).get_json()
        ok(r["ok"], "가위바위보를 낸다", r) if not seen else None
        seen.add(r["result"])

        if r["result"] == "draw":
            ok(r.get("deciding") and not r.get("first") and not r.get("choose"),
               "비기면 다시 낸다", r) if "draw_ok" not in seen else None
            seen.add("draw_ok")
        elif r["result"] == "win":
            ok(r.get("first") == "dia" and r.get("deciding") is False,
               "다이아가 이기면 다이아가 먼저", r) if "win_ok" not in seen else None
            seen.add("win_ok")
        else:
            ok(r.get("choose") is True, "사람이 이기면 고르게 한다", r) \
                if "lose_ok" not in seen else None
            r2 = c.post("/api/first/rps", json={"hand": "rock"}).get_json()
            ok(r2["ok"] is False, "고르는 중에는 또 못 낸다", r2) \
                if "lose_ok" not in seen else None
            r3 = c.post("/api/first/choose", json={"first": "dia"}).get_json()
            ok(r3["ok"] and r3["first"] == "dia", "나중에 하기를 고를 수 있다", r3) \
                if "lose_ok" not in seen else None
            seen.add("lose_ok")

        if {"draw_ok", "win_ok", "lose_ok"} <= seen:
            break

    ok({"win_ok", "lose_ok"} <= seen, "이기고 지는 것이 다 나온다", seen)


print()
print("오목 — 다이아가 먼저")

with app.test_client() as c:
    signup(c, "go1")

    decide(c, "gomoku", "dia")
    r = c.post("/api/gomoku/new", json={"first": "dia"}).get_json()
    stones = "".join(r["rows"])
    ok(r["open"] and r["dia"] == "b" and r["you"] == "w",
       "다이아가 검은 돌, 사람이 흰 돌", (r.get("dia"), r.get("you")))
    ok(stones.count("b") == 1 and stones.count("w") == 0,
       "다이아가 첫 수를 둔다", stones.count("b"))
    ok(isinstance(r.get("spot"), int), "둔 자리를 알려 준다", r.get("spot"))

    free = next(i for i, ch in enumerate(stones) if ch == ".")
    r = c.post("/api/gomoku/move", json={"spot": free}).get_json()
    stones = "".join(r["rows"])
    ok(r["ok"] and stones.count("w") == 1 and stones.count("b") == 2,
       "사람은 흰 돌로 두고 다이아가 받는다", (stones.count("w"), stones.count("b")))

    r = c.get("/api/gomoku/state").get_json()
    ok(r["dia"] == "b", "창을 닫았다 열어도 돌 색이 남는다", r.get("dia"))

    r = c.post("/api/gomoku/level", json={"level": "easy"}).get_json()
    r = c.get("/api/gomoku/state").get_json()
    ok(r["dia"] == "b", "세기를 바꿔도 돌 색이 남는다", r.get("dia"))

with app.test_client() as c:
    signup(c, "go2")

    decide(c, "gomoku", "you")
    r = c.post("/api/gomoku/new", json={"first": "you"}).get_json()
    ok(r["dia"] == "w" and "b" not in "".join(r["rows"]),
       "사람이 먼저면 빈 판, 사람이 검은 돌", r.get("dia"))


print()
print("오목 — 끝나면 한 판 더")

with app.test_client() as c:
    signup(c, "go3")
    c.post("/api/gomoku/new", json={"first": "you"})

    # 사람(검은 돌)이 한 수면 다섯이 되는 판
    board = GO.new_board()
    for col in range(4):
        board = GO.put(board, 7, col, GO.BLACK)
    board = GO.put(board, 0, 14, GO.WHITE)
    poke("go3", "gomoku", {"board": board, "level": "normal", "dia": "w"})

    r = c.post("/api/gomoku/move", json={"spot": 7 * GO.SIZE + 4}).get_json()
    ok(r["ok"] and r["open"] is False and r["winner"] == "b",
       "사람이 이긴다", r.get("winner"))
    ok(r.get("again") == "gomoku", "한 판 더 할지 묻는다 (again)", r.get("again"))
    ok("한 판 더" in (r.get("reply") or ""), "말에 '한 판 더' 가 있다", r.get("reply"))

    c.post("/api/gomoku/new", json={"first": "you"})
    r = c.post("/api/gomoku/resign").get_json()
    ok(not r.get("again"), "기권하면 안 묻는다", r)


print()
print("장기 — 다이아가 먼저")

with app.test_client() as c:
    signup(c, "jg1")

    decide(c, "janggi", "dia")
    r = c.post("/api/janggi/new", json={"first": "dia"}).get_json()
    fresh = JG.new_board()
    now = "".join(r["rows"])
    ok(r["open"] and now != fresh, "다이아가 첫 수를 둔다")
    ok(isinstance(r.get("spot"), int) and isinstance(r.get("from"), int),
       "둔 자리를 알려 준다", (r.get("from"), r.get("spot")))

    you = JG.other(AVATAR.jg_side())
    moves = JG.legal_moves(now, you)
    ok(bool(moves), "이어서 사람이 둘 수 있다")
    frm, to = moves[0]
    r = c.post("/api/janggi/move", json={"from": frm, "to": to}).get_json()
    ok(r["ok"], "사람이 한 수 두고 다이아가 받는다", r)

with app.test_client() as c:
    signup(c, "jg2")
    r = c.post("/api/janggi/new", json={"first": "you"}).get_json()
    ok("".join(r["rows"]) == JG.new_board(), "사람이 먼저면 빈 수로 연다")


print()
print("할리갈리 — 다이아가 먼저")

with app.test_client() as c:
    signup(c, "hg1")

    r = c.post("/api/halli/new", json={"first": "dia"}).get_json()
    ok(r["on"] and r["turn"] == "dia", "다이아 차례로 연다", r.get("turn"))
    ok(not r.get("reply"), "'먼저 뒤집으세요' 를 안 한다", r.get("reply"))

    r = c.post("/api/halli/new", json={"first": "you"}).get_json()
    ok(r["turn"] == "you" and r.get("reply"), "사람이 먼저면 사람 차례", r.get("turn"))

    # 다이아가 뒤집을 패가 없는 판 — 뒤집으면 다이아가 진다
    g = dict(r)
    import halli as HG
    game = HG.new_game()
    game["turn"] = "dia"
    game["hand"]["dia"] = []
    poke("hg1", "halli", game)

    r = c.post("/api/halli/flip").get_json()
    ok(r.get("winner") == "you" and r.get("again") == "halli",
       "끝나면 한 판 더 할지 묻는다", (r.get("winner"), r.get("again")))


print()
print("끝말잇기 — 사람이 먼저")

with app.test_client() as c:
    signup(c, "wc1")

    r = c.get("/api/wordchain/state").get_json()
    ok(r["on"] is False, "처음에는 판이 없다", r)

    r = c.post("/api/wordchain/new", json={"first": "you"}).get_json()
    ok(r["ok"] and r["on"] and r.get("reply"), "먼저 내라고 하며 연다", r)

    r = c.get("/api/wordchain/state").get_json()
    ok(r["on"] is True, "판이 켜져 있다", r)

    who.set_current(accounts.slot_of("wc1"))
    import ai_brain
    say = ai_brain._word_chain_turn("사과", AVATAR.stage_for_affinity(0))
    ok(say and say.get("line"), "첫 낱말을 아무 글자로나 받는다", say)
    g = ai_brain._wc_load()
    ok(g.get("on") and "사과" in (g.get("used") or []),
       "받은 낱말이 판에 남는다", g)

with app.test_client() as c:
    signup(c, "wc2")
    r = c.post("/api/wordchain/new", json={"first": "dia"}).get_json()
    who.set_current(accounts.slot_of("wc2"))
    import ai_brain
    g = ai_brain._wc_load()
    ok(r["ok"] and g.get("last") and len(g.get("used") or []) == 1,
       "다이아가 먼저면 첫 낱말을 낸다", g)


print()
print("체스 — 끝나면 한 판 더")

with app.test_client() as c:
    signup(c, "ch1")
    c.post("/api/chess/new", json={})

    # 흰 쪽(사람)이 한 수면 메이트인 자리
    poke("ch1", "chess", {"fen": "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1",
                          "dia": "black", "moves": []})

    r = c.post("/api/chess/move", json={"move": "a1a8"}).get_json()
    ok(r["ok"] and r.get("over"), "메이트로 끝난다", r.get("over"))
    ok(r.get("again") == "chess", "한 판 더 할지 묻는다 (again)", r.get("again"))
    ok("한 판 더" in (r.get("line") or ""), "말에 '한 판 더' 가 있다", r.get("line"))


print()
print("한 판 더 — 대답 받기")

with app.test_client() as c:
    signup(c, "again1")

    r = c.post("/api/again/answer",
               json={"game": "gomoku", "text": "그만할래"}).get_json()
    ok(r["answer"] == "no" and r.get("line"), "그만하자는 말을 받는다", r)

    r = c.post("/api/again/answer",
               json={"game": "gomoku", "text": "그래 한판 더 하자"}).get_json()
    ok(r["answer"] == "yes", "다시 하자는 말을 받는다", r)

    r = c.post("/api/again/answer",
               json={"game": "gomoku", "text": "배고프다"}).get_json()
    ok(r["answer"] is None, "딴 이야기는 흘려보낸다", r)


shutil.rmtree(SANDBOX, ignore_errors=True)

print()
print("=" * 60)
if fails:
    print(f"실패 {len(fails)}개")
    for f in fails:
        print("  - " + f)
    sys.exit(1)
print("전부 통과")
