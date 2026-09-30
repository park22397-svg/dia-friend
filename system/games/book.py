"""놀이 책 — 판마다 설정을 읽고, 대사를 고르고, 가위바위보를 낸다.

시스템 쪽이다. 원래 avatar.py 의 VirtualAvatar 에 섞여 있던 놀이 메서드를
그대로 옮겼다(2026-09-30). 다이아에게 기대는 것은 둘뿐이다 —
  body.motion(key)  가위바위보 손 모양을 동작 키프레임에서 꺼낼 때
  stage.speech      존댓말로 말할 사이인가
"""

import random

from avatar import _ida_tail, _ro_tail
from system.games.conf import GAME


class GameBook:

    def __init__(self, game, body=None):
        self.game = game or {}
        # 다이아의 몸. 손 모양을 꺼낼 때만 쓴다.
        self.body = body

    def motion(self, key):
        return self.body.motion(key) if self.body is not None else None

    # --------------------------------------------------------
    # 가위바위보
    #
    # 무엇을 낼지, 이겼을 때 뭐라고 할지, 친밀도가 얼마나 움직일지를
    # 전부 여기서 정한다. 화면은 사람이 낸 것만 보낸다.
    # --------------------------------------------------------

    def rps(self):
        return self.game.get("rps", {})

    def rps_hands(self):
        return self.rps().get("hands", [])

    def rps_hand(self, key):
        for h in self.rps_hands():
            if h["key"] == key:
                return h
        return None

    def rps_hand_pose(self, key):
        """그 손 모양의 손가락 값만 꺼낸다.

        손 모양은 동작 키프레임 안에 들어 있다. 따로 적어 두면 둘이
        어긋나므로, 실제로 재생되는 그 키에서 꺼내 쓴다.
        리깅 확인대(/rig)가 이 값을 불러 손 모양을 고치는 데 쓴다.
        """
        h = self.rps_hand(key)
        if h is None:
            return {}

        m = self.motion(h.get("motion"))
        if m is None:
            return {}

        want = self.rps().get("reveal_t", 1.35)
        chosen = None
        for k in m.keys:
            if abs(k.get("t", -1) - want) < 1e-6:
                chosen = k
                break
        if chosen is None:
            return {}

        parts = ("Thumb", "Index", "Middle", "Ring", "Little")
        return {
            b: list(v) for b, v in chosen.get("bones", {}).items()
            if any(p in b for p in parts)
        }

    # --------------------------------------------------------
    # 체스
    #
    # 규칙은 python-chess 가, 무엇을 둘지는 chess_play 가 정한다.
    # 여기는 다이아가 무슨 얼굴로 무슨 말을 하는지만 정한다.
    # --------------------------------------------------------

    def chess(self):
        return self.game.get("chess", {})

    # --------------------------------------------------------
    # 끝말잇기
    #
    # 낱말을 고르는 것은 word_chain.py 다. 여기는 무슨 말을 할지만.
    # --------------------------------------------------------

    def wc_conf(self):
        return self.game.get("word_chain", {})

    def wc_levels(self):
        return self.wc_conf().get("levels", [])

    def wc_level(self, key=None):
        want = key or self.wc_conf().get("level", "normal")

        for lv in self.wc_levels():
            if lv.get("key") == want:
                return lv

        return {"key": "normal", "label": "보통"}

    def wc_mercy(self, affinity=0):
        """사이가 깊으면 가끔 봐준다. 한방을 쥐고도 안 쓴다."""
        conf = self.wc_conf()

        if affinity < conf.get("mercy_from", 80):
            return 0.0

        return float(conf.get("mercy_chance", 0.0))

    def is_word_chain(self, text):
        """끝말잇기 하자는 말인가."""
        low = str(text or "").lower()

        return any(w in low for w in self.wc_conf().get("triggers", []))

    def wc_stop(self, text):
        """그만하자는 말인가."""
        low = str(text or "").strip()

        return any(w in low for w in self.wc_conf().get("stop_words", []))

    def wc_say(self, kind, stage=None, rng=None, why=None, **fmt):
        """끝말잇기에서 할 말.

        반환: {"line", "expression", "motion", "affinity"}
        """
        import random as _random

        rng = rng or _random

        spec = self.wc_conf().get(kind, {})
        lines = spec.get("lines", {})

        # 잘못 냈을 때는 까닭마다 다른 말을 한다.
        # 뭐가 틀렸는지 모르면 같은 실수를 또 한다.
        if why:
            lines = lines.get(why) or lines.get("없는말") or {}

        tone = "polite" if self._polite(stage) else "casual"
        pool = lines.get(tone) or lines.get("polite") or []

        line = rng.choice(list(pool)) if pool else None

        # 받침 따라 조사를 붙인 꼴을 같이 넘긴다.
        # '과' 으로 / '과일' 다 처럼 나오면 모델이 그 어색함을 따라 쓴다.
        for key in ("head", "word"):
            v = fmt.get(key)
            if v:
                fmt[key + "_ro"] = "'%s'%s" % (v, _ro_tail(v))
                fmt[key + "_ida"] = "'%s'%s" % (v, _ida_tail(v))

        if line:
            try:
                line = line.format(**fmt)
            except (KeyError, IndexError):
                pass

        return {
            "line": line,
            "expression": spec.get("expression"),
            "motion": spec.get("motion"),
            "affinity": int(spec.get("affinity", 0)),
        }

    def wc_note(self, game):
        """끝말잇기 상황을 프롬프트에 한 줄로. 없으면 None.

        체스판과 같은 방식이다 — 무슨 말을 하라고는 안 적고 상황만 준다.
        안 주면 놀아 놓고 다음 대화에서 모른다.
        """
        if not isinstance(game, dict) or not game.get("on"):
            return None

        used = game.get("used") or []
        last = game.get("last") or ""

        return (f"둘이 끝말잇기를 하는 중이다. {len(used)}번 주고받았고 "
                f"지금 낱말은 '{last}'{_ida_tail(last)}.")

    # --------------------------------------------------------
    # 오목
    #
    # 둘 자리는 gomoku.py 가 정한다. 여기는 무슨 말을 할지만.
    # --------------------------------------------------------

    # --------------------------------------------------------
    # 할리갈리
    #
    # 반응 속도는 halli.py 가 굴린다. 여기는 무슨 말을 할지만.
    # --------------------------------------------------------

    # --------------------------------------------------------
    # 장기
    # --------------------------------------------------------

    def jg_conf(self):
        return self.game.get("janggi", {})

    def jg_levels(self):
        return self.jg_conf().get("levels", [])

    def jg_level(self, key=None):
        want = key or self.jg_conf().get("level", "normal")

        for lv in self.jg_levels():
            if lv.get("key") == want:
                return lv

        return {"key": "normal", "label": "보통"}

    def jg_side(self):
        return self.jg_conf().get("dia_side", "cho")

    def jg_mercy(self, affinity=0):
        conf = self.jg_conf()

        if affinity < conf.get("mercy_from", 80):
            return 0.0

        return float(conf.get("mercy_chance", 0.0))

    def is_janggi(self, text):
        low = str(text or "").lower()

        return any(w in low for w in self.jg_conf().get("triggers", []))

    def jg_say(self, kind, stage=None, rng=None, **fmt):
        import random as _random

        rng = rng or _random

        spec = self.jg_conf().get(kind, {})
        lines = spec.get("lines", {})

        tone = "polite" if self._polite(stage) else "casual"
        pool = lines.get(tone) or lines.get("polite") or []

        line = rng.choice(list(pool)) if pool else None

        if line:
            try:
                line = line.format(**fmt)
            except (KeyError, IndexError):
                pass

        return {
            "line": line,
            "expression": spec.get("expression"),
            "motion": spec.get("motion"),
            "affinity": int(spec.get("affinity", 0)),
        }

    def jg_note(self, game):
        """장기 상황을 프롬프트에 한 줄로. 체스판과 같은 방식이다."""
        if not isinstance(game, dict) or not game.get("board"):
            return None

        n = sum(1 for ch in game["board"] if ch != ".")

        return f"둘이 장기를 두는 중이다. 말이 {n}개 남았다."

    def hg_conf(self):
        return self.game.get("halli", {})

    def hg_levels(self):
        return self.hg_conf().get("levels", [])

    def hg_level(self, key=None):
        want = key or self.hg_conf().get("level", "normal")

        for lv in self.hg_levels():
            if lv.get("key") == want:
                return lv

        return {"key": "normal", "label": "보통"}

    def hg_mercy(self, affinity=0):
        conf = self.hg_conf()

        if affinity < conf.get("mercy_from", 80):
            return 0.0

        return float(conf.get("mercy_chance", 0.0))

    def is_halli(self, text):
        low = str(text or "").lower()

        return any(w in low for w in self.hg_conf().get("triggers", []))

    def hg_say(self, kind, stage=None, rng=None, **fmt):
        import random as _random

        rng = rng or _random

        spec = self.hg_conf().get(kind, {})
        lines = spec.get("lines", {})

        tone = "polite" if self._polite(stage) else "casual"
        pool = lines.get(tone) or lines.get("polite") or []

        line = rng.choice(list(pool)) if pool else None

        if line:
            try:
                line = line.format(**fmt)
            except (KeyError, IndexError):
                pass

        return {
            "line": line,
            "expression": spec.get("expression"),
            "motion": spec.get("motion"),
            "affinity": int(spec.get("affinity", 0)),
        }

    def hg_note(self, game):
        """할리갈리 상황을 프롬프트에 한 줄로."""
        if not isinstance(game, dict) or not game.get("on"):
            return None

        hand = game.get("hand") or {}
        you = len(hand.get("you") or [])
        dia = len(hand.get("dia") or [])

        return (f"둘이 할리갈리를 하는 중이다. 상대 패가 {you}장, "
                f"네 패가 {dia}장이다.")

    def go_conf(self):
        return self.game.get("gomoku", {})

    def go_levels(self):
        return self.go_conf().get("levels", [])

    def go_level(self, key=None):
        want = key or self.go_conf().get("level", "normal")

        for lv in self.go_levels():
            if lv.get("key") == want:
                return lv

        return {"key": "normal", "label": "보통"}

    def go_stone(self):
        """다이아가 잡는 돌."""
        return self.go_conf().get("dia_stone", "w")

    def go_mercy(self, affinity=0):
        conf = self.go_conf()

        if affinity < conf.get("mercy_from", 80):
            return 0.0

        return float(conf.get("mercy_chance", 0.0))

    def is_gomoku(self, text):
        """오목 두자는 말인가."""
        low = str(text or "").lower()

        return any(w in low for w in self.go_conf().get("triggers", []))

    def go_say(self, kind, stage=None, rng=None, **fmt):
        """오목에서 할 말."""
        import random as _random

        rng = rng or _random

        spec = self.go_conf().get(kind, {})
        lines = spec.get("lines", {})

        tone = "polite" if self._polite(stage) else "casual"
        pool = lines.get(tone) or lines.get("polite") or []

        line = rng.choice(list(pool)) if pool else None

        if line:
            try:
                line = line.format(**fmt)
            except (KeyError, IndexError):
                pass

        return {
            "line": line,
            "expression": spec.get("expression"),
            "motion": spec.get("motion"),
            "affinity": int(spec.get("affinity", 0)),
        }

    def go_note(self, game):
        """오목 상황을 프롬프트에 한 줄로. 체스판과 같은 방식이다."""
        if not isinstance(game, dict) or not game.get("board"):
            return None

        n = sum(1 for ch in game["board"] if ch != ".")

        if not n:
            return "둘이 오목판을 펴 놓았다. 아직 아무도 안 뒀다."

        return f"둘이 오목을 두는 중이다. 돌이 {n}개 놓였다."

    def chess_depth(self):
        return int(self.chess().get("depth", 3))

    def chess_levels(self):
        return self.chess().get("levels", [])

    def chess_level(self, key=None):
        """그 난이도의 값. 모르는 이름이면 기본 난이도를 준다."""

        want = str(key or self.chess().get("level", "normal"))

        levels = self.chess_levels()

        for lv in levels:
            if lv.get("key") == want:
                return dict(lv)

        # 모르는 이름이 오면 정해 둔 기본으로. 그것도 없으면 첫 번째.
        base = str(self.chess().get("level", "normal"))

        for lv in levels:
            if lv.get("key") == base:
                return dict(lv)

        return dict(levels[0]) if levels else {
            "key": "normal", "label": "보통",
            "depth": self.chess_depth(), "blunder": 0.0,
        }

    def chess_mercy(self, affinity=0):
        """사이가 깊으면 가끔 봐준다. 가위바위보와 같은 결이다."""

        c = self.chess()

        if affinity < c.get("mercy_from", 80):
            return 0.0

        return float(c.get("mercy_chance", 0.0))


    def rps_note(self, tally):
        """가위바위보를 얼마나 했고 어땠는지 한 줄로. 없으면 None.

        판 상태(chess_note)와 같은 결이다. 무슨 말을 하라고는 적지
        않고 상황만 준다.

        놀아 놓고 다음 대화에서 모르면 같이 논 것이 아니다.
        """

        if not isinstance(tally, dict):
            return None

        win = int(tally.get("win", 0))     # 다이아가 이긴 수
        lose = int(tally.get("lose", 0))   # 다이아가 진 수
        draw = int(tally.get("draw", 0))

        total = win + lose + draw

        if total <= 0:
            return None

        bits = ["상대와 가위바위보를 %d판 했다." % total]
        bits.append("네가 %d번 이기고 %d번 졌다." % (win, lose))

        if draw:
            bits.append("%d번은 비겼다." % draw)

        if win > lose + 2:
            bits.append("네가 많이 이겼다.")
        elif lose > win + 2:
            bits.append("네가 많이 졌다.")

        last = tally.get("last")

        if last in ("win", "lose", "draw"):
            bits.append({"win": "방금 판은 네가 이겼다.",
                         "lose": "방금 판은 네가 졌다.",
                         "draw": "방금 판은 비겼다."}[last])

        return " ".join(bits)

    def chess_note(self, game, board=None):
        """지금 체스판이 어떤지를 한 줄로. 둘 판이 없으면 None.

        무슨 말을 하라고는 적지 않는다. 상황만 준다 — 시간을 알려 주는
        것(time_note)과 같은 결이다. 사이에 맞는 말은 단계가 정한다.

        game  : 저장해 둔 판 (fen, dia, level)
        board : 이미 되살린 판이 있으면 그것. 없으면 fen 으로 만든다.
        """

        if not game or not game.get("fen"):
            return None

        try:
            import chess
        except ImportError:
            return None

        if board is None:
            try:
                board = chess.Board(game["fen"])
            except ValueError:
                return None

        dia_white = game.get("dia") == "white"
        dia_color = chess.WHITE if dia_white else chess.BLACK

        bits = ["상대와 체스를 두는 중이다."]

        bits.append("너는 %s 쪽이다." % ("흰" if dia_white else "검은"))

        lv = self.chess_level(game.get("level"))
        if lv:
            bits.append("난이도는 '%s'." % lv.get("label"))

        # 말이 얼마나 남았는가로 누가 앞서는지 어림한다.
        #
        # 점수를 그대로 주면 "제가 3.5점 앞서고 있어요" 같은 말이 나온다.
        # 사람은 그렇게 말하지 않는다. 앞서는지 밀리는지만 알려 준다.
        mine = self._chess_material(board, dia_color)
        yours = self._chess_material(board, not dia_color)

        gap = mine - yours

        if gap >= 3:
            bits.append("말은 네가 앞선다.")
        elif gap <= -3:
            bits.append("말은 상대가 앞선다.")
        else:
            bits.append("말은 엇비슷하다.")

        if board.is_checkmate():
            lost = board.turn == dia_color
            bits.append("방금 " + ("네가 졌다." if lost else "네가 이겼다."))
        elif board.is_game_over():
            bits.append("비긴 채로 끝났다.")
        elif board.is_check():
            mine_turn = board.turn == dia_color
            bits.append("지금 " + ("네가 장군을 맞았다." if mine_turn
                                  else "상대가 장군을 맞았다."))
        else:
            bits.append(("네 차례다." if board.turn == dia_color
                         else "상대 차례다."))

        bits.append("%d수째." % board.fullmove_number)

        return " ".join(bits)

    def _chess_material(self, board, color):
        """그쪽 말을 다 합친 값. 누가 앞서는지 어림하는 데만 쓴다."""

        import chess

        worth = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
                 chess.ROOK: 5, chess.QUEEN: 9}

        return sum(len(board.pieces(k, color)) * v for k, v in worth.items())


    def chess_first_say(self, key, stage=None, rng=None):
        """선공 정하기에서 하는 말.

        key: ask / tie / dia_won / you_won
        """

        import random as _random

        rng = rng or _random

        conf = self.chess().get("first_move", {}).get(key, {})
        lines = conf.get("lines", {})

        tone = "polite" if self._polite(stage) else "casual"
        pool = lines.get(tone) or lines.get("polite") or []

        return {
            "line": rng.choice(list(pool)) if pool else None,
            "expression": conf.get("expression"),
        }

    def _game_line(self, conf, stage=None, rng=None):
        """{expression, lines{polite,casual}} 한 벌에서 말 하나."""
        import random as _random

        rng = rng or _random

        lines = (conf or {}).get("lines", {})
        tone = "polite" if self._polite(stage) else "casual"
        pool = lines.get(tone) or lines.get("polite") or []

        return {
            "line": rng.choice(list(pool)) if pool else None,
            "expression": (conf or {}).get("expression"),
        }

    def first_say(self, key, stage=None, rng=None):
        """오목·장기·할리갈리·끝말잇기의 선공 정하기에서 하는 말.

        key: ask / tie / dia_won / you_won
        """
        conf = self.game.get("first_move", {}).get(key)

        if conf is None:
            return self.chess_first_say(key, stage, rng)

        return self._game_line(conf, stage, rng)

    def again_conf(self):
        return self.game.get("again", {})

    def again_say(self, kind, stage=None, rng=None):
        """한 판 더. kind: ask / yes / no"""
        return self._game_line(self.again_conf().get(kind), stage, rng)

    def again_answer(self, text):
        """한 판 더 하자는 물음에 대한 답을 가른다.

        반환: "yes" / "no" / None(딴 이야기)
        순서가 있다 — 다시 하자는 말 > 그만하자는 말 > 짧은 대답.
        """
        conf = self.again_conf()
        flat = "".join(str(text or "").split()).lower()
        flat = flat.strip("!?.…~,·'\"")

        if not flat:
            return None

        if any(w in flat for w in conf.get("again_words", [])):
            return "yes"

        if any(w in flat for w in conf.get("stop_words", [])):
            return "no"

        if len(flat) <= int(conf.get("short_len", 10)) and any(
                flat.startswith(w) for w in conf.get("yes_words", [])):
            return "yes"

        return None

    def chess_say(self, event, stage=None, rng=None):
        """그 일이 났을 때 무슨 얼굴로 뭐라고 하는가.

        매번 말하지는 않는다. 한 수 둘 때마다 떠들면 시끄럽다.
        말하지 않기로 하면 line 이 None 이다.

        반환: {"line", "expression", "affinity"} / 모르는 일이면 None
        """

        import random as _random

        rng = rng or _random

        ev = self.chess().get("events", {}).get(event)

        if not ev:
            return None

        out = {
            "expression": ev.get("expression"),
            "affinity": int(ev.get("affinity", 0)),
            "line": None,
        }

        if rng.random() > float(ev.get("say", 1.0)):
            return out

        lines = ev.get("lines", {})
        tone = "polite" if self._polite(stage) else "casual"
        pool = lines.get(tone) or lines.get("polite") or []

        if pool:
            out["line"] = rng.choice(list(pool))

        return out

    def _polite(self, stage):
        """존대로 말할 사이인가.

        가위바위보와 **똑같은 방식**으로 가른다(avatar.py 의 다른 자리들과
        같은 줄). 여기서만 다르게 재면 두 놀이의 말투가 어긋난다.
        """

        return stage is None or str(stage.speech).startswith("존댓말")

    def rps_play(self, user_key, stage=None, affinity=0):
        """사람이 낸 것을 받아 다이아가 낼 것을 정하고 결과를 돌려준다."""

        hands = self.rps_hands()
        mine = self.rps_hand(user_key)
        if not hands or mine is None:
            return None

        cfg = self.rps()

        # 사이가 깊으면 가끔 일부러 져 준다. 티는 내지 않는다.
        mercy_from = cfg.get("mercy_from")
        mercy = cfg.get("mercy_chance", 0.0)

        pick = None
        if mercy_from is not None and affinity >= mercy_from \
                and random.random() < mercy:
            # 사람이 이기는 손 = 사람이 낸 것에게 지는 손
            pick = next(
                (h for h in hands if mine["beats"] == h["key"]),
                None
            )

        if pick is None:
            pick = random.choice(hands)

        if pick["key"] == mine["key"]:
            result = "draw"
        elif mine["beats"] == pick["key"]:
            result = "lose"          # 다이아가 졌다
        else:
            result = "win"           # 다이아가 이겼다

        polite = stage is None or str(stage.speech).startswith("존댓말")
        spec = cfg.get("outcomes", {}).get(result, {})
        pool = (spec.get("lines", {}) or {}).get(
            "polite" if polite else "casual") or []

        return {
            "you": mine["key"],
            "you_label": mine["label"],
            "mine": pick["key"],
            "mine_label": pick["label"],
            "motion": pick.get("motion"),
            "result": result,
            "reply": random.choice(pool) if pool else "",
            "expression": spec.get("expression", "neutral"),
            "affinity_delta": spec.get("affinity", 0),
        }

    def to_dict(self):
        """화면에 줄 놀이 설정. 원래 AVATAR.to_dict() 의 "game" 조각."""
        return {            "rps": {
                "hands": self.rps_hands(),
                "triggers": self.rps().get("triggers", []),
                "guide": self.rps().get("guide", {}),
                # 리깅 확인대가 손 모양을 불러 고치는 데 쓴다
                "hand_poses": {
                    h["key"]: self.rps_hand_pose(h["key"])
                    for h in self.rps_hands()
                },
                "reveal_t": self.rps().get("reveal_t", 1.35),
            },

            # 말로 놀이를 부르는 낱말. 화면이 이것으로 "오목 하자" ·
            # "끝말잇기 하자" 를 알아듣고 판(과 선공 가위바위보)을 연다.
            #
            # 예전에는 rps 만 넘겨서 화면의 트리거 목록이 전부 비어 있었다.
            # 그래서 말로 부른 놀이는 판이 안 열리고 모델에게 갔다 —
            # 끝말잇기는 서버가 가위바위보 없이 다이아부터 시작했다.
            **{k: {"triggers": (self.game.get(k) or {}).get("triggers", [])}
               for k in ("chess", "gomoku", "halli", "janggi", "word_chain")},

            # 한 판 더 — 물은 뒤 얼마 동안 답을 기다리는가
            "again": {"ttl_sec": self.again_conf().get("ttl_sec", 600)},
        }


# 다이아의 몸은 불러들일 때 한 번 물려 둔다.
from avatar import AVATAR as _DIA  # noqa: E402

GAMES = GameBook(GAME, body=_DIA)
