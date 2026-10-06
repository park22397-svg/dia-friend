"""세상의 지금 — 어디에 있는가, 무엇을 입었는가, 어떤 자리인가.

시스템 쪽이다. 원래 main.py 에 있던 도우미를 옮겼다(2026-10-01).
대화(system/chat.py)와 경로(main.py)가 함께 쓴다. 예전에는 대화가
`import main` 으로 이것을 꺼내 갔는데, python main.py 로 띄우면
main 이 한 번 더 실렸다.
"""

import json
import os
import time

import memory_manager
from system.world import WORLD

# 옷장이 있는 폴더를 찾을 때 main.py 와 같은 자리를 기준으로 삼는다.
# (main.py 의 os.path.dirname(__file__) 을 쓰던 자리가 있어서다)
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 칸 차례. 화면과 프롬프트에 이 순서로 적는다.
SLOT_ORDER = ("outfit", "glasses", "hair")

SLOT_LABEL = {"outfit": "옷", "glasses": "안경", "hair": "머리"}


def _places_now():
    """지금 갈 수 있는 곳 이름들. 배경 폴더를 그대로 훑는다."""
    conf = (WORLD.model or {}).get("background", {}) or {}

    if not WORLD.places_conf().get("enabled", True):
        return []

    folder = conf.get("dir", "static/background")
    types = tuple(t.lower() for t in conf.get(
        "types", [".png", ".jpg", ".jpeg", ".webp", ".gif"]))

    base = os.path.join(_ROOT, folder)

    try:
        names = [f for f in os.listdir(base) if f.lower().endswith(types)]
    except OSError:
        return []

    out = []

    for n in names:
        p = WORLD.place_of_file(n)
        if p and p not in out:
            out.append(p)

    return sorted(out)


def _place_here():
    """지금 있는 곳. 없으면 None."""
    try:
        return (memory_manager.load_memory_data().get("place") or {}).get("name")
    except Exception:
        return None


def _scene_now():
    """지금 열려 있는 장면. 없으면 None."""
    try:
        key = (memory_manager.load_memory_data().get("scene") or {}).get("key")
    except Exception:
        return None

    return WORLD.scene(key) if key else None


def _scene_set(key):
    data = memory_manager.load_memory_data()

    if key:
        data["scene"] = {"key": key, "since": time.time()}
    else:
        data.pop("scene", None)

    memory_manager.save_memory_data(data)


def _scene_update(user_text, here=None):
    """이번 말과 있는 곳을 보고 장면을 열거나 닫는다. 지금 장면을 돌려준다.

    **여는 길이 셋인 이유.** 사람은 한 가지 방식으로만 자리를
    옮기지 않는다.

      "노래방 왔어"        — 말로 알린다
      (배경: 노래방)       — 정말로 그리로 갔다
      노래방에 있는 채로    — 이미 와 있다

    셋 다 '알아챘다' 로 쳐야 알아챈 것이다. 하나만 받으면
    나머지 두 길에서는 못 알아듣는 바보가 된다.

    닫는 것은 말로만 한다. 시간이 지나면 저절로 닫히게 하면,
    노래를 부르다 말고 한참 이야기한 뒤 다시 부를 때 못 부른다.
    """
    now = _scene_now()

    # 그만하자고 했다
    if WORLD.scene_leaves(user_text):
        if now:
            print(f"[장면]: {now.get('label')} 끝")
            _scene_set(None)
        return None

    # 말로 알렸다
    want = WORLD.scene_of_words(user_text)

    # 그 자리에 있다
    if not want:
        want = WORLD.scene_of_place(here if here is not None else _place_here())

    # 말로 다른 곳에 옮겨 갔다 — 그림이 없는 곳이라도
    if not want and now and WORLD.scene_moved_away(user_text, now):
        print(f"[장면]: {now.get('label')} 끝 (다른 곳으로 감)")
        _scene_set(None)
        return None

    if want:
        if not now or now.get("key") != want.get("key"):
            print(f"[장면]: {(now or {}).get('label') or '없음'}"
                  f" -> {want.get('label')}")
            _scene_set(want.get("key"))
        return want

    # 다른 곳으로 옮겨 갔으면 그 자리의 일은 끝난 것이다.
    #
    # 노래방에서 공원으로 갔는데 마이크를 들고 있으면 안 된다.
    if now and now.get("places"):
        h = here if here is not None else _place_here()

        if h and not WORLD.scene_of_place(h):
            print(f"[장면]: {now.get('label')} 끝 (자리를 옮김)")
            _scene_set(None)
            return None

    return now


def _wardrobe_items():
    """옷장에 실제로 걸려 있는 옷들. [{key,label,file,...}]"""
    conf = (WORLD.model or {}).get("wardrobe_dir", "static/wardrobe")
    base = os.path.join(_ROOT, conf)

    try:
        with open(os.path.join(base, "wardrobe.json"), encoding="utf-8") as f:
            items = json.load(f).get("items", [])
    except FileNotFoundError:
        return []
    except Exception as e:
        print(f"[옷장 읽기 오류]: {e}")
        return []

    return [it for it in items
            if it.get("file")
            and os.path.exists(os.path.join(base, it["file"]))]


def _slot_of(item):
    """그 물건이 걸리는 칸. 옛 wardrobe.json 에는 없을 수 있다."""
    return item.get("slot") or "outfit"


def _wardrobe_now():
    """프롬프트에 적을 목록. 칸 이름을 같이 준다."""
    out = []

    for it in _wardrobe_items():
        slot = _slot_of(it)
        out.append({
            "key": it.get("key"),
            "label": it.get("label") or it.get("key"),
            "slot": slot,
            "slot_label": it.get("slot_label") or SLOT_LABEL.get(slot, slot),
        })

    return out


def _worn_map(items=None):
    """칸마다 무엇을 입고 있는가. {칸: 이름}

    처음 온 사람(적힌 것이 없음)에게는 **옷 칸만** 기본을 입힌다.
    안경과 머리는 안 씌운다 — 처음부터 안경을 씌우면 그건 기본 얼굴이
    아니라 설정이다.

    옷장에서 사라진 것을 입고 있었으면 벗긴다.
    """
    items = _wardrobe_items() if items is None else items
    saved = memory_manager.load_wearing()

    by_slot = {}
    for it in items:
        by_slot.setdefault(_slot_of(it), []).append(it.get("key"))

    out = {}

    for slot in SLOT_ORDER:
        keys = by_slot.get(slot) or []
        got = saved.get(slot)

        if got is None:
            # 아직 아무것도 안 정했다
            out[slot] = keys[0] if (slot == "outfit" and keys) else ""
        elif got and got not in keys:
            print(f"[옷장] {slot} 칸의 '{got}' 이(가) 없어졌다")
            out[slot] = keys[0] if (slot == "outfit" and keys) else ""
        else:
            out[slot] = got

    return out


def _worn_now():
    """프롬프트에 적을 '지금 입은 것' 목록. 아무것도 없으면 None."""
    worn = [v for k, v in _worn_map().items() if v]
    return worn or None

