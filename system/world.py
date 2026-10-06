"""세상 — 다이아가 있는 곳과 할 수 있는 것.

장소(배경)·옷장·장면(노래방·인생네컷)·미디어. 시스템 쪽이다.
원래 avatar.py 의 VirtualAvatar 에 섞여 있던 메서드를 그대로 옮겼다(2026-09-30).

다이아에게는 두 가지 모양으로만 건넨다:
  *_note()   지금 어떤 상황인지 한 줄 (프롬프트의 상황 칸)
  *_block()  할 수 있는 것 목록 (system_prompt 의 world_blocks)
"""

from system.world_conf import WORLD_MODEL


class World:

    def __init__(self, model):
        # 이름을 model 로 둔 것은 옮겨 온 메서드가 self.model 을 읽기 때문이다.
        self.model = model

    # --------------------------------------------------------
    # 장소
    #
    # 목록은 개체가 들고 있지 않는다. static/background/ 를 훑어
    # 그때그때 만든다 — 파일을 넣으면 갈 수 있는 곳이 늘어야 한다.
    # 그래서 여기 있는 것은 '이름을 어떻게 읽는가' 뿐이다.
    # --------------------------------------------------------

    def places_conf(self):
        return (self.model or {}).get("background", {}).get("places", {})

    def place_of_file(self, name):
        """파일 이름에서 장소 이름을 뽑는다.

          공원.jpg      -> 공원
          공원_밤.jpg   -> 공원      (밑줄 앞이 이름)
          공원 (2).jpg  -> 공원      (윈도우가 붙이는 겹침 번호)

        **겹침 번호를 떼는 이유.** 사진 두 장을 같은 폴더에 넣으면
        윈도우가 뒤엣것에 ' (2)' 를 저절로 붙인다. 그걸 그대로 두면
        '공원' 과 '공원 (2)' 라는 딴 곳 둘이 생긴다. 사람은 같은 곳에
        두 장을 넣은 것인데 화면은 다른 데로 안다.
        """
        import os as _os
        import re as _re

        stem = _os.path.splitext(str(name))[0]

        # 윈도우가 붙이는 ' (2)' · ' (3)' … 을 뗀다
        stem = _re.sub(r"\s*\(\d+\)\s*$", "", stem)

        split = self.places_conf().get("split", "_")

        return (stem.split(split)[0] if split else stem).strip()

    def place_marker(self, text):
        """(배경: 공원) 에서 '공원' 을 꺼낸다. 표시가 아니면 None.

        괄호는 이미 떼고 안쪽만 받는다.
        """
        low = str(text or "").strip()

        for head in self.places_conf().get("markers", []):
            if low.startswith(head):
                return low[len(head):].strip() or None

        return None

    def place_note(self, place, places=None):
        """지금 어디에 있는지 한 줄로. 적을 것이 없으면 None.

        무슨 말을 하라고는 적지 않는다. 시간·기분과 같은 방식으로
        상황만 준다.
        """
        if not place:
            return None

        return f"지금 둘이 있는 곳은 '{place}' 다."

    def places_block(self, places, here=None):
        """갈 수 있는 곳을 프롬프트에 적는다. 없으면 None."""
        if not places or not self.places_conf().get("enabled", True):
            return None

        lines = [
            "",
            "--------------------------------------------------",
            "[있을 수 있는 곳]",
            "--------------------------------------------------",
            "",
            "둘이 있는 자리를 옮길 수 있다. 갈 수 있는 곳은 이것뿐이다.",
            "",
        ]

        for p in places:
            lines.append(f"- {p}" + ("   (지금 여기)" if p == here else ""))

        # 여기 적는 것은 짧을수록 좋다.
        #
        # 없는 곳을 적어도 _apply_place() 가 버리고, 지나가는 말에
        # 옮기지 않는 것은 '정말로 갈 때만' 한 줄이면 통한다.
        # 처음에는 스물다섯 줄이었는데 그만큼이 다이아가 쓸 여지를
        # 줄이고 있었다.
        lines += [
            "",
            "정말로 그리로 갈 때만 (배경: 공원) 처럼 적는다.",
            "글로만 쓰면 화면은 안 바뀐다 — 지난 이야기에는 안 적는다.",
        ]

        return lines

    # --------------------------------------------------------
    # 옷 — 장소와 같은 얼개다
    #
    # 다이아가 스스로 갈아입을 줄 알아야 한다. 사람이 단추를 눌러야만
    # 옷이 바뀌면 옷장은 설정 창이지 사이가 아니다. [[dia-autonomy]]
    # --------------------------------------------------------

    def wear_conf(self):
        return (self.model or {}).get("wear", {})

    def wear_marker(self, text):
        """(옷: 교복) 에서 '교복' 을 꺼낸다. 표시가 아니면 None.

        괄호는 이미 떼고 안쪽만 받는다. 장소와 똑같다.
        """
        low = str(text or "").strip()

        for head in self.wear_conf().get("markers", []):
            if low.startswith(head):
                return low[len(head):].strip() or None

        return None

    def wear_is_off(self, key):
        """'벗기' 처럼 벗으라는 말인가."""
        low = str(key or "").strip().lower()
        return any(w == low or w in low
                   for w in self.wear_conf().get("off_words", []))

    def wear_note(self, worn):
        """지금 무엇을 걸치고 있는지 한 줄로. 없으면 None.

        여럿일 수 있다 — 교복을 입고 안경을 썼을 수 있다.
        """
        if not worn:
            return None

        if isinstance(worn, str):
            worn = [worn]

        names = [w for w in worn if w]

        if not names:
            return None

        return "지금 걸치고 있는 것은 " + ", ".join(
            f"'{n}'" for n in names) + " 이다."

    def wardrobe_block(self, items, worn=None):
        """입을 수 있는 것을 프롬프트에 적는다. 없으면 None.

        **칸을 나눠 적는다.** 옷·안경·머리는 칸이 달라 같이 걸칠 수 있다.
        한 줄로 늘어놓으면 다이아가 안경을 쓰려고 옷을 벗는다.
        """
        if not items or not self.wear_conf().get("enabled", True):
            return None

        now = set(worn or [])

        lines = [
            "",
            "--------------------------------------------------",
            "[네 옷장]",
            "--------------------------------------------------",
            "",
            "칸이 다르면 같이 걸친다. 같은 칸이면 갈아입는 것이다.",
            "",
        ]

        by_slot = {}

        for it in items:
            if isinstance(it, str):
                by_slot.setdefault("옷", []).append(it)
                continue
            label = it.get("slot_label") or "옷"
            by_slot.setdefault(label, []).append(
                it.get("label") or it.get("key"))

        for label, names in by_slot.items():
            lines.append(f"{label}:")
            for n in names:
                lines.append(f"  - {n}" + ("   (지금)" if n in now else ""))

        lines += [
            "",
            "정말로 갈아입을 때만 (옷: 교복) 처럼 적는다.",
            "벗을 때는 (옷: 벗기), 안경만 벗을 때는 (옷: 안경 벗기).",
            "글로만 쓰면 화면은 안 바뀐다 — 지난 이야기에는 안 적는다.",
            "옷 이야기를 매번 꺼내지는 마라. 갈아입자고 하거나,",
            "네가 정말 갈아입고 싶을 때만이다.",
        ]

        return lines

    # --------------------------------------------------------
    # 장면 — 지금이 어떤 자리인가
    #
    # 장소·옷과 같은 얼개다. 다른 것은 하나뿐이다:
    # **열려 있을 때만 프롬프트에 적힌다.**
    #
    # 옷장은 늘 적힌다 — 언제든 갈아입을 수 있으니까. 노래는
    # 아니다. 밥 먹다가 갑자기 노래를 부르지는 않는다. 그래서
    # 그 자리에 갔을 때만 할 수 있는 것이 는다.
    # --------------------------------------------------------

    def scenes_conf(self):
        return (self.model or {}).get("scenes", {})

    def scenes(self):
        if not self.scenes_conf().get("enabled", True):
            return []
        return self.scenes_conf().get("list", []) or []

    def scene(self, key):
        """열쇠로 장면 하나를 꺼낸다. 없으면 None."""
        for s in self.scenes():
            if s.get("key") == key:
                return s
        return None

    def scene_of_place(self, place):
        """그 곳이 곧 어떤 장면인가. 아니면 None.

        노래방 배경으로 옮기면 노래방이 열린다. 표시를 두 번
        적게 하지 않는다 — (배경: 노래방) 하나면 된다.
        """
        if not place:
            return None

        want = str(place).replace(" ", "")

        for s in self.scenes():
            for p in s.get("places", []):
                if str(p).replace(" ", "") == want:
                    return s
        return None

    def scene_of_words(self, text):
        """상대의 말에서 장면을 알아챈다. 아니면 None.

        **이것이 '상황 인지' 의 알맹이다.** "노래방 왔어" 라는 말
        한마디에 다이아가 할 수 있는 일이 달라져야 한다.

        낱말로 찾는 것은 서버가 한다. 모델에게 "이런 말이 나오면
        노래방인 줄 알아라" 라고 적으면 그게 규칙 한 줄이고,
        그만큼 다이아가 쓸 자리가 줄어든다. [[dia-autonomy]]
        """
        if not text:
            return None

        low = str(text).lower().replace(" ", "")

        # 그 자리에서 나온다는 말이면 이름이 나와도 열지 않는다
        if self._has(low, self.scenes_conf().get("exit_words", [])):
            return None

        for s in self.scenes():
            for w in s.get("enter_words", []):
                if str(w).replace(" ", "") in low:
                    return s
        return None

    def scene_leaves(self, text):
        """장면을 닫는 말인가."""
        if not text:
            return False

        low = str(text).lower().replace(" ", "")
        conf = self.scenes_conf()

        return (self._has(low, conf.get("leave_words", []))
                or self._has(low, conf.get("exit_words", [])))

    @staticmethod
    def _has(low, words):
        return any(str(w).replace(" ", "") in low for w in words)

    def scene_moved_away(self, text, scene):
        """상대가 다른 곳으로 옮겨 갔다고 말했는가 (그 장면의 곳이 아닌 데로)."""
        if not text or not scene:
            return False

        low = str(text).lower().replace(" ", "")
        conf = self.scenes_conf()

        if not self._has(low, conf.get("move_words", [])):
            return False

        mine = list(scene.get("places", [])) + list(scene.get("enter_words", []))
        if self._has(low, mine):
            return False

        return self._has(low, conf.get("elsewhere_words", []))

    def scene_note(self, scene):
        """지금 어떤 자리인지 한 줄로. 없으면 None.

        시간·기분·장소와 같은 자리다. 상황만 준다.
        """
        if not scene:
            return None
        return scene.get("note") or None

    def media_conf(self):
        return (self.model or {}).get("media", {})

    def media_note(self, media):
        """지금 폰에서 무엇이 나오는지 한 줄로. 없으면 None.

        장소·장면과 같은 자리다 — **상황만 준다.** 무슨 말을 하라고는
        안 적는다. 제목과 가수만 알려 주고 나머지는 다이아가 정한다.

        가사는 여기에도, 어디에도 없다. 제 말로 이야기하라는 뜻이다.
        """
        import time as _time

        conf = self.media_conf()

        if not conf.get("enabled", True) or not media:
            return None

        if not media.get("playing") or not media.get("title"):
            return None

        # 알려 온 지 한참 됐으면 그 노래는 이미 끝났다
        fresh = float(conf.get("fresh_sec", 420))
        at = float(media.get("at") or 0)

        if at and (_time.time() - at) > fresh:
            return None

        title = str(media.get("title") or "").strip()
        artist = str(media.get("artist") or "").strip()

        who = " - " + artist if artist else ""

        # 조사는 받침이 정한다. '어떤 곡 가 나온다' 로는 적을 수 없다.
        tail = (title + who).strip()
        last = tail[-1] if tail else ""

        if "가" <= last <= "힣":
            batchim = (ord(last) - 0xAC00) % 28 != 0
        elif last.isalpha():
            # 영어 제목은 끝소리로 가른다. 모음으로 끝나면 받침이 없다.
            # (Nova -> '노바가', Sunset -> '선셋을')
            batchim = last.lower() not in "aeiouy"
        else:
            batchim = False

        where = (conf.get("apps") or {}).get(media.get("app") or "")

        if where:
            josa = "을" if batchim else "를"
            return f"지금 이 사람이 {where}에서 '{tail}'{josa} 듣고 있다."

        josa = "이" if batchim else "가"

        return f"지금 이 사람 폰에서 '{tail}'{josa} 나오고 있다."

    def scene_block(self, scene):
        """이 자리에서만 할 수 있는 것. 없으면 None.

        짧을수록 좋다. 두 줄이면 두 줄만 적는다.
        """
        if not scene:
            return None

        can = scene.get("can") or []

        if not can:
            return None

        return "[여기서 할 수 있는 것]\n" + "\n".join(can)

    def shot_conf(self):
        """네컷 찍는 규칙. 없으면 빈 것."""
        for s in self.scenes():
            if s.get("shot"):
                return s["shot"]
        return {}

    def is_shoot(self, text):
        """(찍자) 인가. 괄호 안쪽만 받는다.

        찍는 순서·컷 수·카운트는 프롬프트에 안 적는다. 서버가 쥔다 —
        놀이 규칙과 같은 자리다. 다이아는 '찍자' 고 말할 뿐이다.
        """
        low = str(text or "").strip().lower().replace(" ", "")

        if not low:
            return False

        return any(str(w).replace(" ", "") == low
                   for w in self.shot_conf().get("words", []))


WORLD = World(WORLD_MODEL)
