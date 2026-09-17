# _verify_expressions.py
# 표정이 아바타 파일과 맞는지 본다.
#
# 2026-09-17 에 옛 아바타에서 맞춘 수치를 지우고, 기본 표정을 아바타 파일
# (static/avatar.vrm)의 표정 그룹 그대로 쓰기로 했다. 그래서 잠근 값과
# 대조하던 것을 그만두고, 파일에 정말 있는 이름인지를 본다.
#
#   - 표정이 쓰는 그룹 이름이 파일에 있는가 (없으면 화면에서 조용히 빠진다)
#   - 표정이 쓰는 조각 이름이 얼굴 메시에 있는가
#   - 기본 표정의 값이 파일 그대로(100)인가 — 배합기로 덮은 것은 따로 알린다
#   - 동작·만지기·낱말 표가 부르는 표정이 다 있는가
#
#   python _verify_expressions.py

import json
import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from avatar import AVATAR, _EXPR_ORIGINAL

HERE = os.path.dirname(os.path.abspath(__file__))
VRM = os.path.join(HERE, "static", "avatar.vrm")

# 기본 표정이 파일의 어느 그룹 하나를 100 으로 쓰는가
BASE = {
    "sorrow": "sorrow", "angry": "angry", "surprised": "Surprised",
    "fun": "fun", "joy": "joy", "wink": "blink_l", "wink_r": "blink_r",
    "eyes_closed": "blink",
}


def read_vrm(path):
    with open(path, "rb") as f:
        f.read(12)
        n, _ = struct.unpack("<II", f.read(8))
        g = json.loads(f.read(n))
    groups = set()
    for bg in g["extensions"]["VRM"]["blendShapeMaster"]["blendShapeGroups"]:
        groups.add(bg["name"])
        if bg.get("presetName") and bg["presetName"] != "unknown":
            groups.add(bg["presetName"])
    morphs = set()
    for m in g["meshes"]:
        names = (m.get("extras") or {}).get("targetNames") or \
            (m["primitives"][0].get("extras") or {}).get("targetNames") or []
        morphs.update(names)
    return groups, morphs


def main():
    fails = []

    if not os.path.exists(VRM):
        print("static/avatar.vrm 이 없어 건너뛴다.")
        return 0

    groups, morphs = read_vrm(VRM)
    keys = {e.key for e in AVATAR.expressions}

    print("=" * 66)
    print(f"표정 {len(keys)}개  /  파일의 그룹 {len(groups)}개 · 조각 {len(morphs)}개")
    print("=" * 66)

    for e in AVATAR.expressions:
        for n in e.blendshapes:
            if n not in groups:
                fails.append(f"{e.label}({e.key}): 그룹 '{n}' 이 파일에 없다")
        for n in e.morphs:
            if n not in morphs:
                fails.append(f"{e.label}({e.key}): 조각 '{n}' 이 얼굴에 없다")

    for key, group in BASE.items():
        e = AVATAR.expression(key)
        if not e:
            fails.append(f"기본 표정 {key} 가 없다")
            continue
        if key in _EXPR_ORIGINAL:
            continue
        if e.blendshapes != {group: 1.0} or e.morphs:
            fails.append(f"{e.label}({key}): 파일 그대로가 아니다 — {e.blendshapes} {e.morphs}")

    # 부르는 자리
    src = open(os.path.join(HERE, "avatar.py"), encoding="utf-8").read()
    src += open(os.path.join(HERE, "main.py"), encoding="utf-8").read()
    called = set(re.findall(r'expression"\s*:\s*"([a-z_]+)"', src))
    called |= set(re.findall(r'expression="([a-z_]+)"', src))
    for k in sorted(called - keys):
        fails.append(f"없는 표정 '{k}' 을 부르는 자리가 있다")

    html = open(os.path.join(HERE, "templates", "index.html"), encoding="utf-8").read()
    for k in sorted(set(re.findall(r"applyExpression\('([a-z_]+)'\)", html)) - keys):
        fails.append(f"index.html 이 없는 표정 '{k}' 을 부른다")

    if _EXPR_ORIGINAL:
        print(f"\n배합기에서 만들거나 고친 표정 {len(_EXPR_ORIGINAL)}개")
        for k, o in _EXPR_ORIGINAL.items():
            print(f"   * {k}" + ("  — 새로 만듦" if o is None else "  — 덮어씀"))

    print()
    print("=" * 66)
    if fails:
        for f in fails:
            print("   ! " + f)
        print("=" * 66)
        return 1

    print("전부 통과")
    print("=" * 66)
    return 0


if __name__ == "__main__":
    sys.exit(main())
