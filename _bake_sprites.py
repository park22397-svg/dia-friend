# -*- coding: utf-8 -*-
"""다이아를 그림으로 굽는다 — 3D 를 2D 연속그림으로.

## 왜 굽는가

휴대폰 화면 위에 늘 떠 있으려면 3D 를 계속 돌릴 수 없다. 배터리도
배터리지만, 오버레이 창에서 WebGL 을 켜 두는 것 자체가 무겁다.
**미리 돌려서 그림으로 구워 두면** 그 뒤로는 그림 한 장씩 넘기는
일밖에 안 남는다. 애니메이션·버츄버가 2D 로 보이는 까닭과 같다.

## 어떻게

`/bake` 자리를 헤드리스 크롬으로 열고, 동작마다 t 를 조금씩 밀며
한 칸씩 찍는다. 그리는 고리를 안 돌리고 **부를 때만** 그리므로
같은 t 는 늘 같은 그림이 나온다.

  python _bake_sprites.py                     # 기본 몇 개만
  python _bake_sprites.py --all               # 동작 전부
  python _bake_sprites.py --chibi 1.5         # 머리 큰 2등신 쪽으로
  python _bake_sprites.py --motions idle,wave --fps 12 --size 256

나온 것은 `static/sprites/` 에 들어간다.

  sprites.json        무엇이 몇 칸이고 몇 fps 인지
  idle.png            한 동작이 한 장 (가로로 이어 붙인 시트)
  idle/frame_000.png  낱장도 같이 둔다 (안드로이드에서 골라 쓰기 쉽게)

## 조심할 것

* **배경이 투명해야 한다.** 굽는 자리가 알파를 켜 두었다. 바탕이
  같이 구워지면 오버레이에 네모난 판이 떠다닌다.
* **헤드리스 크롬은 반드시 죽인다.** 남으면 CPU 100% 가 된다.
* 로그인이 필요하다(아바타 파일이 로그인 뒤에 있다). 굽기 전용
  계정을 하나 만들어 쓴다 — 없으면 만들고, 있으면 그대로 쓴다.
"""

import argparse
import io as _io

# 윈도우 콘솔은 cp949 라 줄표(—)나 가운뎃점에서 통째로 터진다.
# 다 구워 놓고 마지막 print 에서 죽는 일이 실제로 있었다.
try:
    sys_stdout = __import__('sys').stdout
    if hasattr(sys_stdout, 'buffer'):
        __import__('sys').stdout = _io.TextIOWrapper(
            sys_stdout.buffer, encoding='utf-8', errors='replace')
except Exception:
    pass

import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9411

BASE = os.environ.get("BAKE_BASE", "http://127.0.0.1:5000")
OUT = os.path.join(HERE, "static", "sprites")

# 굽기 전용 계정. 사람 계정을 안 쓴다 — 기억이 섞이면 안 된다.
BAKE_ID = "bakebot"
BAKE_PW = "bakebot1234"

# 처음에 구울 것. 떠다니는 다이아에게 가장 먼저 필요한 것들이다.
DEFAULT = ["idle", "wave", "nod", "shake", "walk"]


# ============================================================
# 서버에 들어가기
# ============================================================

def _post(path, body):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST")

    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8")), r.headers.get_all("Set-Cookie")
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8")), None
        except Exception:
            return {"ok": False, "error": str(e)}, None
    except Exception as e:
        return {"ok": False, "error": str(e)}, None


def session_token(code=""):
    """굽기 계정으로 들어가 쿠키를 얻는다."""

    out, cookies = _post("/api/login", {"id": BAKE_ID, "password": BAKE_PW})

    if not out.get("ok"):
        made, cookies = _post("/api/signup", {
            "id": BAKE_ID, "password": BAKE_PW, "again": BAKE_PW, "code": code})

        if not made.get("ok"):
            print("굽기 계정을 못 만들었습니다:", made.get("error"))
            print("가입 암호가 걸려 있으면 --code 로 넣어 주세요.")
            return None

        print("굽기 계정을 만들었습니다:", BAKE_ID)

    for c in (cookies or []):
        if c.startswith("session="):
            return c.split("=", 1)[1].split(";")[0]

    return None


# ============================================================
# 크롬 (CDP)
# ============================================================

class Chrome:

    def __init__(self, width, height):
        import websocket

        self.proc = subprocess.Popen([
            CHROME,
            "--headless=new",
            "--remote-debugging-port=%d" % PORT,
            "--remote-allow-origins=*",
            "--user-data-dir=%s" % os.path.join(HERE, "_bake_profile"),
            "--no-first-run", "--no-default-browser-check",
            "--hide-scrollbars",
            "--window-size=%d,%d" % (width + 40, height + 80),
        ])

        for _ in range(60):
            try:
                with urllib.request.urlopen(
                        "http://127.0.0.1:%d/json/version" % PORT, timeout=1):
                    break
            except Exception:
                time.sleep(0.25)

        req = urllib.request.Request(
            "http://127.0.0.1:%d/json/new?about:blank" % PORT, method="PUT")
        tab = json.loads(urllib.request.urlopen(req).read().decode("utf-8"))

        self.ws = websocket.create_connection(
            tab["webSocketDebuggerUrl"], timeout=120)
        self.n = 0

        self.send("Page.enable")
        self.send("Network.enable")
        self.send("Runtime.enable")

    def send(self, method, params=None):
        self.n += 1
        mid = self.n

        self.ws.send(json.dumps(
            {"id": mid, "method": method, "params": params or {}}))

        while True:
            got = json.loads(self.ws.recv())

            if got.get("id") == mid:
                if "error" in got:
                    raise RuntimeError("%s: %s" % (method, got["error"]))
                return got.get("result", {})

    def cookie(self, value):
        self.send("Network.setCookie", {
            "name": "session", "value": value,
            "domain": "127.0.0.1", "path": "/"})

    def go(self, url):
        self.send("Page.navigate", {"url": url})

    def js(self, expr):
        r = self.send("Runtime.evaluate", {
            "expression": expr, "returnByValue": True, "awaitPromise": True})

        res = r.get("result", {})

        if r.get("exceptionDetails"):
            raise RuntimeError(str(r["exceptionDetails"])[:200])

        return res.get("value")

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass

        try:
            self.proc.terminate()
            self.proc.wait(timeout=10)
        except Exception:
            try:
                self.proc.kill()
            except Exception:
                pass


# ============================================================
# 굽기
# ============================================================

def save_png(data_url, path):
    if not data_url or not data_url.startswith("data:"):
        return False

    raw = base64.b64decode(data_url.split(",", 1)[1])

    with open(path, "wb") as f:
        f.write(raw)

    return True


def sheet(frames, size, path):
    """낱장을 가로로 이어 붙인다. 안드로이드는 한 장을 끊어 쓰는 편이 싸다."""
    try:
        from PIL import Image
    except ImportError:
        print("  (PIL 이 없어 시트는 안 만듭니다)")
        return False

    if not frames:
        return False

    out = Image.new("RGBA", (size * len(frames), size), (0, 0, 0, 0))

    for i, p in enumerate(frames):
        out.paste(Image.open(p).convert("RGBA"), (i * size, 0))

    out.save(path)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--motions", default="",
                    help="쉼표로. 비우면 기본 몇 개")
    ap.add_argument("--all", action="store_true", help="동작 전부")
    ap.add_argument("--fps", type=int, default=12)
    ap.add_argument("--size", type=int, default=256)
    ap.add_argument("--chibi", type=float, default=1.0,
                    help="머리를 몇 배로. 1.4~1.6 이면 2등신 쪽")
    ap.add_argument("--code", default="", help="가입 암호(걸려 있으면)")
    args = ap.parse_args()

    token = session_token(args.code)

    if not token:
        return 1

    os.makedirs(OUT, exist_ok=True)

    br = Chrome(args.size, args.size)

    try:
        br.cookie(token)
        br.go(BASE + "/bake")

        # 아바타가 15MB 다. 올 때까지 기다린다.
        for _ in range(120):
            time.sleep(0.5)

            try:
                if br.js("!!(window.bake && window.bake.ready)"):
                    break

                err = br.js("window.bake && window.bake.error")

                if err:
                    print("굽는 자리가 실패했습니다:", err)
                    return 1
            except Exception:
                pass
        else:
            print("굽는 자리가 준비되지 않았습니다(아바타를 못 불렀을 수 있습니다).")
            return 1

        br.js("bake.setSize(%d, %d)" % (args.size, args.size))

        if abs(args.chibi - 1.0) > 0.001:
            br.js("bake.setChibi(%f)" % args.chibi)

        have = br.js("JSON.stringify(bake.list())")
        have = json.loads(have or "[]")
        by_key = {m["key"]: m for m in have}

        if args.all:
            want = [m["key"] for m in have]
        elif args.motions:
            want = [k.strip() for k in args.motions.split(",") if k.strip()]
        else:
            want = [k for k in DEFAULT if k in by_key]

        # 앞서 구운 것을 **지우지 않는다.**
        #
        # 처음에는 돌 때마다 명세서를 새로 썼는데, 그러면 동작 하나만
        # 다시 구워도 나머지가 목록에서 사라졌다. 그림 파일은 남아
        # 있는데 앱은 없는 줄 아는 꼴이다.
        book = {"motions": {}}

        old = os.path.join(OUT, "sprites.json")

        if os.path.exists(old):
            try:
                with open(old, encoding="utf-8") as f:
                    book = json.load(f)
                book.setdefault("motions", {})
            except Exception:
                book = {"motions": {}}

        book["size"] = args.size
        book["fps"] = args.fps
        book["chibi"] = args.chibi
        book["made"] = time.strftime("%Y-%m-%d %H:%M")

        for key in want:
            m = by_key.get(key)

            if not m:
                print("  없는 동작이라 건너뜁니다:", key)
                continue

            folder = os.path.join(OUT, key)
            os.makedirs(folder, exist_ok=True)

            dur = float(m.get("duration") or 1.0)
            count = max(1, int(round(dur * args.fps)))

            # 도는 동작(loop)은 마지막 칸이 첫 칸과 같으므로 한 칸 뺀다.
            # 안 빼면 넘길 때 한 칸 멈칫한다.
            step = dur / count if m.get("loop") else dur / max(1, count - 1)

            paths = []
            t0 = time.time()

            for i in range(count):
                t = min(dur, i * step)

                url = br.js("bake.frame('%s', %f)" % (key, t))
                p = os.path.join(folder, "frame_%03d.png" % i)

                if save_png(url, p):
                    paths.append(p)

            made = sheet(paths, args.size, os.path.join(OUT, key + ".png"))

            book["motions"][key] = {
                "label": m.get("label") or key,
                "frames": len(paths),
                "duration": dur,
                "loop": bool(m.get("loop")),
                "sheet": ("/static/sprites/%s.png" % key) if made else None,
                "dir": "/static/sprites/%s/" % key,
            }

            print("  %-10s %2d칸 · %.1f초 · %.1f초 걸림"
                  % (key, len(paths), dur, time.time() - t0))

        with open(os.path.join(OUT, "sprites.json"), "w", encoding="utf-8") as f:
            json.dump(book, f, ensure_ascii=False, indent=2)

        total = sum(v["frames"] for v in book["motions"].values())
        print()
        print("구웠습니다: 동작 %d개, 그림 %d장, %dpx"
              % (len(book["motions"]), total, args.size))
        print("  ", OUT)

        return 0

    finally:
        br.close()


if __name__ == "__main__":
    sys.exit(main())
