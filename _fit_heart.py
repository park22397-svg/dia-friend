# _fit_heart.py
# 머리 위 하트를 맞춘다 — 두 손끝이 만나야 하트다.
#
# 눈대중으로 팔을 올렸더니 손이 머리 위에서 한 뼘씩 벌어져
# 만세가 됐다. 손끝이 닿는 자리를 찾아서 넣는다.
#
# 왼팔은 풀지 않는다. **좌우 같은 자세는 x 그대로, y·z 부호 반전**이
# 이 아바타에서 맞는 규칙이라 오른팔만 풀고 뒤집는다.
#
#   python _fit_heart.py

import numpy as np

import _fit_pose as F
from avatar import AVATAR
from _body_shape import BodyShape, BodyCapsules

VRM = "static/avatar.vrm"

rig = F.Rig(VRM)
caps = BodyCapsules(BodyShape(VRM))

BASE = AVATAR.base_pose

LIM = {
    "sh": (-22, 14),
    "ux": (-35, 35),
    "uy": (-85, 20),
    "uz": (-60, 10),       # 위로 들수록 0 쪽 (오른팔)
    "ly": (-30, 30),
    "lz": (20, 140),       # 팔을 든 채 접는 축
    "hx": (-40, 50),
    "hz": (-40, 40),
}

START = {"sh": -14, "ux": 0, "uy": -10, "uz": -34, "ly": 0, "lz": 62,
         "hx": 0, "hz": -24}


def mirror(v):
    """오른팔 값을 왼팔로 뒤집는다."""
    return {
        "sh": -v["sh"], "ux": v["ux"], "uy": -v["uy"], "uz": -v["uz"],
        "ly": -v["ly"], "lz": -v["lz"], "hx": v["hx"], "hz": -v["hz"],
    }


def pose_of(v):
    p = {k: list(x) for k, x in BASE.items()}
    m = mirror(v)

    p["rightShoulder"] = [0, 0, v["sh"]]
    p["rightUpperArm"] = [v["ux"], v["uy"], v["uz"]]
    p["rightLowerArm"] = [0, v["ly"], v["lz"]]
    p["rightHand"] = [v["hx"], 0, v["hz"]]

    p["leftShoulder"] = [0, 0, m["sh"]]
    p["leftUpperArm"] = [m["ux"], m["uy"], m["uz"]]
    p["leftLowerArm"] = [0, m["ly"], m["lz"]]
    p["leftHand"] = [m["hx"], 0, m["hz"]]

    p["head"] = [-6, 0, 0]
    p["chest"] = [-3, 0, 0]
    return p


def arm_points(pose, side):
    sh = rig.pos(f"{side}UpperArm", pose)
    el = rig.pos(f"{side}LowerArm", pose)
    wr = rig.pos(f"{side}Hand", pose)
    tip = rig.pos(f"{side}MiddleProximal", pose)

    pts = [sh + (el - sh) * t for t in np.linspace(0.45, 1.0, 5)]
    pts += [el + (wr - el) * t for t in np.linspace(0.15, 1.0, 6)]
    pts += [wr, tip]
    return np.array(pts)


def target():
    """손끝이 만나는 자리 — 정수리 위.

    눈에서 재서 머리 꼭대기를 어림한다(눈보다 9cm 위). 거기서
    한 뼘 더 위가 하트의 한가운데다.
    """
    eye = (rig.pos("leftEye", BASE) + rig.pos("rightEye", BASE)) / 2
    return np.array([0.0, eye[1] + 0.09 + 0.15, eye[2] - 0.02])


TOP = target()


def score(v):
    p = pose_of(v)

    rtip = rig.pos("rightMiddleProximal", p)
    ltip = rig.pos("leftMiddleProximal", p)

    # 두 손끝이 꼭짓점에서 만나야 한다. 다만 딱 붙으면 손이
    # 겹치므로 서로 6cm 는 떨어져 있게 둔다 — 그 사이가 하트의 골이다.
    mid = (rtip + ltip) / 2
    s = float(np.linalg.norm(mid - TOP)) * 2.0

    gap = float(np.linalg.norm(rtip - ltip))
    s += abs(gap - 0.06) * 6.0

    # 손목이 손끝보다 바깥에 있어야 하트의 곡선이 생긴다
    rw = rig.pos("rightHand", p)
    s += max(0.0, 0.10 - (rw[0] - rtip[0])) * 0.8

    deep = 0.0
    for side in ("left", "right"):
        d = caps.depths(arm_points(p, side), head_world=rig.world("head", p))
        deep = max(deep, float(d.max()))

    s += max(0.0, deep) * 30

    return s, deep, rtip, ltip


def main():
    best = dict(START)
    bs = score(best)[0]
    step = {k: 10.0 for k in LIM}

    for _ in range(9):
        moved = True
        while moved:
            moved = False
            for k in LIM:
                for d in (1, -1):
                    v = dict(best)
                    v[k] += step[k] * d
                    if not (LIM[k][0] <= v[k] <= LIM[k][1]):
                        continue
                    s = score(v)[0]
                    if s < bs - 1e-6:
                        bs, best, moved = s, v, True
        for k in step:
            step[k] = max(0.25, step[k] / 2)

    s, deep, rtip, ltip = score(best)
    m = mirror(best)

    print("오른팔")
    for k in LIM:
        print(f"  {k:3} {best[k]:8.2f}")

    print("\n왼팔(뒤집은 값)")
    for k in LIM:
        print(f"  {k:3} {m[k]:8.2f}")

    mid = (rtip + ltip) / 2
    print(f"\n손끝 사이 {np.linalg.norm(rtip - ltip) * 100:.1f}cm"
          f"  꼭짓점에서 {np.linalg.norm(mid - TOP) * 100:.1f}cm")
    print(f"몸에 박힌 깊이 {deep * 1000:.1f}mm")
    print(f"오른손끝 {rtip.round(3).tolist()}  목표 {TOP.round(3).tolist()}")


if __name__ == "__main__":
    main()
