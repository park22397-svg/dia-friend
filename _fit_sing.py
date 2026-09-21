# _fit_sing.py
# 노래하는 팔을 찾는다 — 마이크를 입 앞에 두면서 몸은 안 뚫게.
#
# 브라우저에서 손 위치만 보고 풀었더니 아래팔이 허벅지를 2.24cm
# 뚫었다. 손만 보면 반드시 이렇게 된다 — 팔이 지나가는 길은
# 안 보기 때문이다.
#
# 그래서 **검사기와 같은 판정구**로 푼다. 검사에서 쓰는 몸 캡슐을
# 그대로 조건에 넣으면, 나온 값은 검사를 통과할 수밖에 없다.
#
#   python _fit_sing.py

import numpy as np

import _fit_pose as F
from avatar import AVATAR
from _body_shape import BodyShape, BodyCapsules

VRM = "static/avatar.vrm"

rig = F.Rig(VRM)
caps = BodyCapsules(BodyShape(VRM))

BASE = AVATAR.base_pose

# 관절이 갈 수 있는 데까지.
#
# 한계를 안 걸면 쇄골을 55도 돌려서라도 거리를 0 으로 만든다.
LIM = {
    "sh": (-12, 6),        # 쇄골 z
    "ux": (-30, 25),       # 위팔 x — 앞뒤
    "uy": (-10, 45),       # 위팔 y — 몸 쪽으로 모으기
    "uz": (-80, -40),      # 위팔 z — -68.75 가 팔을 내린 자리
    "ly": (40, 135),       # 팔꿈치 (오른팔은 +가 앞으로 접힘)
    "lz": (-25, 25),
    "hx": (-40, 60),       # 손목
}

START = {"sh": 4, "ux": -10, "uy": 20, "uz": -62, "ly": 110, "lz": 0, "hx": 20}


# 지금 sing 동작이 나머지 뼈(척추·왼팔·손가락)를 어떻게 두는지
# 그대로 깔고 오른팔만 바꾼다.
#
# **이게 없으면 검사와 어긋난다.** 바탕 자세로만 풀었더니 0mm 가
# 나왔는데 검사는 8.6mm 라고 했다. 척추를 3도 기울인 채로 재는지
# 아닌지가 그만큼 갈랐다.
_SING = next((m for m in AVATAR.motions if m.key == "sing"), None)
_OTHERS = dict(_SING.keys[0]["bones"]) if _SING else {}


def pose_of(v):
    p = {k: list(x) for k, x in BASE.items()}

    for n, r in _OTHERS.items():
        p[n] = list(r)

    p["rightShoulder"] = [0, 0, v["sh"]]
    p["rightUpperArm"] = [v["ux"], v["uy"], v["uz"]]
    p["rightLowerArm"] = [0, v["ly"], v["lz"]]
    p["rightHand"] = [v["hx"], 0, 0]
    return p


def arm_points(pose, side="right"):
    sh = rig.pos(f"{side}UpperArm", pose)
    el = rig.pos(f"{side}LowerArm", pose)
    wr = rig.pos(f"{side}Hand", pose)
    tip = rig.pos(f"{side}MiddleProximal", pose)

    pts = [sh + (el - sh) * t for t in np.linspace(0.45, 1.0, 5)]
    pts += [el + (wr - el) * t for t in np.linspace(0.15, 1.0, 6)]
    pts += [wr, tip]
    return np.array(pts)


def target_point():
    """마이크를 쥔 주먹이 있어야 할 자리.

    입은 머리뼈에서 아래 6cm · 앞 7cm 쯤이다. 마이크가 10cm 짜리라
    주먹은 거기서 한 뼘 더 아래·앞이어야 머리가 입에 온다.
    주먹을 입에 붙이면 얼굴을 가린다.
    """
    # 입 자리는 **눈에서 잰다.** 머리뼈(head)는 두개골 밑동이라
    # 거기서 '아래로 얼마' 로 어림하면 입이 목에 붙는다. 실제로
    # 그렇게 잡았다가 마이크가 리본 높이까지 내려왔다.
    #
    #   눈   y 1.449   (leftEye · rightEye)
    #   머리 y 1.386
    #
    # 입은 눈보다 6cm 아래, 얼굴 앞쪽이다.
    eye = (rig.pos("leftEye", BASE) + rig.pos("rightEye", BASE)) / 2
    mouth = np.array([0.0, eye[1] - 0.06, eye[2] - 0.072])

    # **이 좌표계는 브라우저와 다르다.** 재서 확인한 것:
    #
    #   오른손이 +x   (rightHand 0.23, leftHand -0.23)
    #   앞이 -z       (발가락 -0.078, 발목 +0.032)
    #
    # 화면 쪽 값을 그대로 옮겨 적었다가 주먹이 등 뒤로 갔다.
    #
    # 주먹은 **턱 밑**이다.
    #
    # 처음엔 입에서 13cm 아래를 잡았는데, 마이크 머리가 주먹에서
    # 4.5cm 위라 입보다 9cm 낮은 자리에서 노래하게 됐다. 사람은
    # 마이크를 턱에 붙여 잡는다.
    return np.array([mouth[0] + 0.055, mouth[1] - 0.065, mouth[2] - 0.045])


TARGET = target_point()


def score(v):
    p = pose_of(v)

    wr = rig.pos("rightHand", p)
    el = rig.pos("rightLowerArm", p)

    s = float(np.linalg.norm(wr - TARGET))

    # 몸을 뚫으면 크게 벌준다. 검사가 5mm 를 넘기면 실패로 치니
    # 아예 0 이 되게 민다.
    d = caps.depths(arm_points(p), head_world=rig.world("head", p))
    deep = float(d.max())
    s += max(0.0, deep) * 30

    # 팔꿈치는 어깨보다 아래여야 자연스럽다
    sh = rig.pos("rightUpperArm", p)
    s += max(0.0, el[1] - (sh[1] - 0.12)) * 1.5

    return s, deep, wr


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

    s, deep, wr = score(best)

    print("찾은 값")
    for k in ("sh", "ux", "uy", "uz", "ly", "lz", "hx"):
        print(f"  {k:3} {best[k]:8.2f}")

    print(f"\n주먹이 목표에서 {np.linalg.norm(wr - TARGET) * 100:.1f}cm")
    print(f"몸에 박힌 깊이 {deep * 1000:.1f}mm  (5mm 넘으면 검사 실패)")
    print(f"주먹 자리 {wr.round(3).tolist()}  목표 {TARGET.round(3).tolist()}")


if __name__ == "__main__":
    main()
