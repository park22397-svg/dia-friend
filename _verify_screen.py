# _verify_screen.py
# 화면 스크립트가 끝까지 실행되는가.
#
# 잡으려는 것은 값이 맞는지가 아니라 **끝까지 가는지** 다.
#
# index.html 의 스크립트는 한 덩어리라, 한가운데서 오류가 나면 거기서
# 통째로 멈춘다. animate() 가 파일 한가운데서 한 번 불리는데 그 안에서
# 쓰는 값을 아래쪽에서 const 로 선언해 두면 첫 프레임에
# ReferenceError 가 나고, 파일 끝의 loadAvatar() 까지 못 간다.
# 그러면 **아바타가 아예 안 나온다** — 화면은 멀쩡히 뜨는데 다이아만 없다.
#
# 2026-08-19 에 실제로 이걸 겪었다(시선 추적을 붙이면서 eye/gaze 를
# 그리기 고리보다 아래에 선언했다). 콘솔을 안 열어 보면 원인이 안 보인다.
#
# 브라우저 없이 node 로 한 번 통과시켜 본다. THREE 도 document 도
# 가짜를 물려 주므로 그림이 맞는지는 못 본다. 멈추는지만 본다.

import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PAGES = ["templates/index.html", "templates/test.html",
         "templates/rig.html", "templates/model_test.html"]

STUB = r"""
const fs = require('fs');
const vm = require('vm');
// 파일을 여럿 받으면 **하나씩 따로** 돌린다. 브라우저가 <script> 를 하나씩
// 돌리는 것과 같다 — 전역(const·let 포함)은 함께 쓰지만, 함수 끌어올리기는
// 그 파일 안에서만 된다. 이어 붙여 돌리면 이 차이를 못 잡는다.
const files = process.argv.slice(2);

function fake(name) {
  const f = function () { return proxy; };
  const proxy = new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'valueOf') return () => 0;
      if (k === 'toString') return () => name;
      if (k === 'length') return 0;
      if (k === 'then') return undefined;
      if (k === Symbol.iterator) return function* () {};
      return proxy;
    },
    apply() { return proxy; },
    construct() { return proxy; },
    has() { return true; },
    set() { return true; },
  });
  return proxy;
}

let reached = false;
const sandbox = {
  THREE: fake('THREE'),
  document: fake('document'),
  navigator: fake('navigator'),
  fetch: () => Promise.resolve(fake('res')),
  performance: { now: () => 0 },
  console: { log() {}, warn() {}, error() {} },
  setTimeout: () => 0, setInterval: () => 0,
  clearTimeout: () => {}, clearInterval: () => {},
  requestAnimationFrame: () => 0,
  Image: function () { return fake('img'); },
  URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
  Blob: function () { return fake('blob'); },
  Audio: function () { return fake('audio'); },
  SpeechSynthesisUtterance: function () { return fake('u'); },
  speechSynthesis: fake('speechSynthesis'),
  atob: () => '', btoa: () => '',
  __done: () => { reached = true; },
};
sandbox.addEventListener = () => {};
sandbox.removeEventListener = () => {};
sandbox.matchMedia = () => fake('mq');
sandbox.localStorage = fake('ls');
sandbox.location = fake('loc');
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);
for (const f of files) {
  try {
    vm.runInContext(fs.readFileSync(f, 'utf8'), ctx,
                    { filename: f, timeout: 20000 });
  } catch (e) {
    const at = (e.stack || '').split('\n').slice(1, 3).join(' / ');
    console.log('STOP ' + e.name + ': ' + e.message + ' | ' + at);
    process.exit(1);
  }
}
vm.runInContext('__done();', ctx);
process.exit(reached ? 0 : 1);
"""


def scripts_in(path):
    """<script> ... </script> 안쪽을 뽑는다.

    src= 로 불러오는 것 중 **우리가 만든 것**(/static/*.js)은 그 파일을
    읽어 앞에 붙인다. 안 붙이면 거기 있는 이름을 못 찾아 없다고 한다.
    unpkg 같은 남의 것은 건너뛴다 — 가짜(THREE)로 대신한다.
    """
    import io
    import re

    text = io.open(path, encoding="utf-8").read()

    # 쪽에 나온 차례대로 (이름, 코드). 그 차례가 곧 브라우저가 돌리는 차례다.
    out = []

    for m in re.finditer(
            r'<script[^>]*src="(/static/[^"?]+\.js)(?:\?[^"]*)?"[^>]*>\s*</script>'
            r'|<script>(.*?)</script>', text, flags=re.S):
        if m.group(1):
            f = os.path.join(HERE, m.group(1).lstrip("/").replace("/", os.sep))
            if os.path.isfile(f):
                out.append((m.group(1), io.open(f, encoding="utf-8").read()))
        else:
            out.append(("(안쪽 스크립트)", m.group(2)))

    return out


def main():
    node = shutil.which("node")
    if not node:
        print("node 가 없어 건너뜁니다. (설치하면 이 검사가 돕니다)")
        return 0

    tmp = tempfile.mkdtemp(prefix="diamond_screen_")
    stub = os.path.join(tmp, "stub.js")
    with open(stub, "w", encoding="utf-8") as f:
        f.write(STUB)

    fails = 0

    for rel in PAGES:
        path = os.path.join(HERE, rel)
        if not os.path.isfile(path):
            continue

        chunks = scripts_in(path)
        if not chunks:
            print(f"  건너뜀  {rel}  (안쪽 스크립트 없음)")
            continue

        # 한 쪽의 스크립트는 한 자리(전역)에서 차례대로 돈다
        paths = []
        for i, (name, code) in enumerate(chunks):
            js = os.path.join(tmp, f"{os.path.basename(rel)}.{i:02d}."
                                   + os.path.basename(name).replace("(", "").replace(")", "")
                                   .replace(" ", "_") + ("" if name.endswith(".js") else ".js"))
            with open(js, "w", encoding="utf-8") as f:
                f.write(code)
            paths.append(js)

        r = subprocess.run([node, stub] + paths,
                           capture_output=True, text=True, timeout=120)

        total = sum(len(code.splitlines()) for _n, code in chunks)

        if r.returncode == 0:
            print(f"  PASS  {rel}  (스크립트 {len(chunks)}개 · {total}줄, 끝까지 갔다)")
        else:
            fails += 1
            print(f"  FAIL  {rel}")
            for line in (r.stdout or r.stderr).strip().split("\n")[:3]:
                print(f"        {line}")

    shutil.rmtree(tmp, ignore_errors=True)

    fails += no_wake_surprise()

    print("\n" + ("전부 통과" if fails == 0 else f"{fails}건 실패"))
    return 0 if fails == 0 else 1


def no_wake_surprise():
    """자다 깨면서 놀라는 기믹이 되살아나지 않았는가.

    깨울 때마다 놀란 얼굴이 스치는 것이 어색해서 통째로 걷어냈다.
    자기를 부르는 사람에게 놀랄 이유가 없다.

    놀람 자체를 없앤 것은 아니다 — 부끄러울 때, 다가올 때, 말이
    끊겼을 때는 그대로 쓴다. 여기서 막는 것은 **깰 때** 하나다.
    """
    import io

    print()

    banned = ("surprise_upto", "wake_surprise", "wakeMs")

    look = ["avatar.py"] + PAGES
    # 화면 스크립트를 파일로 나눈 뒤로는 거기도 본다
    for dirpath, _d, names in os.walk(os.path.join(HERE, "static", "js")):
        for n in names:
            if n.endswith(".js"):
                look.append(os.path.relpath(os.path.join(dirpath, n), HERE))
    bad = []

    for rel in look:
        path = os.path.join(HERE, rel)

        if not os.path.isfile(path):
            continue

        text = io.open(path, encoding="utf-8").read()

        for word in banned:
            if word in text:
                bad.append(f"{rel} 에 {word}")

    if bad:
        print("  FAIL  깰 때 놀라는 기믹이 남아 있다")
        for b in bad:
            print("        " + b)
        return 1

    print("  PASS  깰 때 놀라는 기믹이 없다")
    return 0


if __name__ == "__main__":
    sys.exit(main())
