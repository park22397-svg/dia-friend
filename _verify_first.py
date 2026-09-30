# _verify_first.py
# 오목·할리갈리·장기도 선공을 가위바위보로 정하는가
#
#   1. 가위바위보 없이 새 판(/api/<놀이>/new)을 부르면 막는다
#   2. 정하자고 말하고 손 셋을 준다
#   3. 다이아가 이기면 판이 바로 열리고 다이아가 먼저 한다
#   4. 사람이 이기면 고르라고 하고, 고른 대로 열린다 (먼저·나중 둘 다)
#   5. 정하는 중이 아니면 손을 내도 막는다
#   6. 모르는 놀이·로그인 없이는 못 쓴다
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
import main  # noqa: E402

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


def signup(c, who):
    return c.post("/api/signup", json={
        "id": who, "password": "pw1234", "again": "pw1234"}).get_json()


def toss(c, game):
    """결판이 날 때까지 낸다. 마지막 답을 돌려준다."""
    r = {}
    for _ in range(40):
        r = c.post(f"/api/first/{game}/rps", json={"hand": "rock"}).get_json()
        if r.get("ok") is False or not r.get("deciding") or r.get("choose"):
            break
    return r


def stones(rows):
    return sum(1 for row in rows for ch in row if ch != ".")


# 놀이마다 '판이 열렸다' 와 '누가 먼저인가' 를 읽는 법이 다르다
GAMES = {
    "gomoku": {
        "opened": lambda r: bool(r.get("open")),
        # 다이아가 먼저면 돌이 하나 놓여 있다
        "dia_first": lambda r: stones(r.get("rows") or []) == 1,
        "you_first": lambda r: stones(r.get("rows") or []) == 0,
    },
    "janggi": {
        "opened": lambda r: bool(r.get("open")),
        # 다이아가 먼저면 이미 한 수 뒀다
        "dia_first": lambda r: isinstance(r.get("spot"), int),
        "you_first": lambda r: r.get("spot") is None,
    },
    "halli": {
        "opened": lambda r: bool(r.get("on")),
        "dia_first": lambda r: r.get("turn") == "dia",
        "you_first": lambda r: r.get("turn") == "you",
    },
}


for game, how in GAMES.items():
    print()
    print(game)

    with app.test_client() as c:
        signup(c, "p_" + game)

        r = c.post(f"/api/{game}/new", json={}).get_json()
        ok(r.get("ok") is False and r.get("need_first"),
           "가위바위보 없이는 새 판이 안 열린다", r)

        r = c.post(f"/api/first/{game}/rps", json={"hand": "rock"}).get_json()
        ok(r.get("ok") is False, "정하기 전에 손을 내면 막는다", r)

        r = c.post(f"/api/first/{game}/start", json={}).get_json()
        ok(r.get("deciding") is True, "정하는 중으로 연다", r)
        ok(not how["opened"](r), "아직 판은 안 열렸다", r)
        ok(len(r.get("hands") or []) == 3, "손 셋을 준다", r.get("hands"))
        ok(bool(r.get("reply")), "정하자고 말한다", r.get("reply"))

        # 다이아가 이기는 판과 내가 이기는 판(먼저·나중)을 다 볼 때까지
        seen = set()

        for _ in range(60):
            if {"dia_won", "you_first", "you_later"} <= seen:
                break

            c.post(f"/api/first/{game}/start", json={})
            r = toss(c, game)

            ok(r.get("ok") is not False, "손을 받는다", r)
            if r.get("ok") is False:
                break

            if not r.get("deciding"):
                # 다이아가 이겼다
                if "dia_won" not in seen:
                    ok(r.get("result") == "win", "다이아가 이긴 판이다", r.get("result"))
                    ok(bool(r.get("motion")), "다이아가 낸 손 동작을 준다", r.get("motion"))
                    ok(how["opened"](r), "다이아가 이기면 판이 바로 열린다", r)
                    ok(how["dia_first"](r), "다이아가 이기면 다이아가 먼저 한다", r)
                    ok(bool(r.get("reply")), "이겼다고 말한다", r.get("reply"))

                    again = c.post(f"/api/{game}/new", json={}).get_json()
                    ok(again.get("ok") is False,
                       "열린 뒤에 가위바위보 없이 또 열 수는 없다", again)
                seen.add("dia_won")
                continue

            ok(r.get("choose") is True, "내가 이기면 고르라고 한다", r)

            want = "you" if "you_first" not in seen else "dia"
            r = c.post(f"/api/{game}/new", json={"first": want}).get_json()
            ok(how["opened"](r), "고르면 판이 열린다", r)

            if want == "you":
                ok(how["you_first"](r), "먼저 하겠다고 하면 내가 먼저", r)
                seen.add("you_first")
            else:
                ok(how["dia_first"](r), "나중에 하겠다고 하면 다이아가 먼저", r)
                seen.add("you_later")

            r = c.post(f"/api/first/{game}/rps", json={"hand": "rock"}).get_json()
            ok(r.get("ok") is False, "판이 열린 뒤에는 손을 내도 막는다", r)

        ok({"dia_won", "you_first", "you_later"} <= seen,
           "세 갈래를 다 봤다", seen)


print()
print("두어 보기")

with app.test_client() as c:
    signup(c, "mover")

    # 내가 먼저 두는 오목에서 실제로 두어진다
    for _ in range(60):
        c.post("/api/first/gomoku/start", json={})
        r = toss(c, "gomoku")
        if r.get("choose"):
            break
    r = c.post("/api/gomoku/new", json={"first": "you"}).get_json()
    r = c.post("/api/gomoku/move", json={"spot": 0}).get_json()
    ok(r.get("ok") and stones(r.get("rows") or []) == 2,
       "내가 먼저 두면 한 수씩 오간다", r)


print()
print("모르는 놀이 · 로그인 없이")

with app.test_client() as c:
    signup(c, "nobody")
    ok(c.post("/api/first/baduk/start", json={}).status_code == 404,
       "모르는 놀이는 막는다")

with app.test_client() as c:
    for game in GAMES:
        for step in ("start", "rps"):
            path = f"/api/first/{game}/{step}"
            ok(c.post(path, json={}).status_code == 401,
               "로그인 없이 못 쓴다 " + path)


print()
shutil.rmtree(SANDBOX, ignore_errors=True)

if fails:
    print("실패 " + str(len(fails)) + "건")
    for f in fails:
        print("  - " + f)
    sys.exit(1)

print("전부 통과")
