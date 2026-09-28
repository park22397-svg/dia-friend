# _verify_touch_api.py
# 아바타를 누르면 서버가 정말 반응을 돌려주는가
#
# _verify_touch.py 는 판정구와 대사표만 보고 /api/touch 를 부르지 않는다.
# 그래서 2026-09-16 부터 만질 때마다 500 이 나던 것을 못 잡았다
# (반응을 만드는 줄이 지워져 'result' 가 없었다). 여기서는 진짜로 누른다.
#
# 진짜 계정과 기억을 안 건드리도록 임시 자리에서 돈다.

import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.chdir(HERE)

SANDBOX = tempfile.mkdtemp(prefix="dia_touch_")

import store  # noqa: E402

# **먼저 자리를 옮긴다.** 안 옮기면 진짜 계정 파일에 쓴다.
store.HERE = SANDBOX

import accounts  # noqa: E402
import main  # noqa: E402
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


def touch(c, bone, kind="tap", tool="hand", count=1):
    return c.post("/api/touch", json={
        "bone": bone, "zone": None, "local": [0, 0, 0],
        "kind": kind, "count": count, "tool": tool,
        "kiss_ready": False, "undressed": [],
    })


print("누르면 반응한다")

with app.test_client() as c:
    c.post("/api/signup", json={"id": "toucher", "password": "pw1234",
                                "again": "pw1234"})

    bones = sorted({h["bone"] for h in AVATAR.touch.get("hitboxes", [])})
    ok(bool(bones), "판정구가 있다", len(bones))

    for bone in ("head", "upperChest", "leftHand"):
        if bone not in bones:
            continue

        r = touch(c, bone)
        d = r.get_json() or {}
        ok(r.status_code == 200, f"{bone} 누름이 오류 없이 돈다", (r.status_code, d))
        ok(d.get("hit") is True and bool(d.get("reply")),
           f"{bone} 을 누르면 대답한다", d.get("reply") or d)

    r = touch(c, "head", kind="stroke", count=3)
    d = r.get_json() or {}
    ok(r.status_code == 200 and d.get("hit"), "쓰다듬어도 반응한다", (r.status_code, d))

    r = touch(c, "없는뼈")
    ok(r.status_code == 200 and (r.get_json() or {}).get("hit") is False,
       "없는 자리는 조용히 넘긴다", r.status_code)


shutil.rmtree(SANDBOX, ignore_errors=True)

print()
print("=" * 60)
if fails:
    print(f"실패 {len(fails)}개")
    for f in fails:
        print("  - " + f)
    sys.exit(1)
print("전부 통과")
