"""놀이 사건 — 판에서 무슨 일이 있었는가.

시스템 쪽이다(2026-10-01, 나누기 2단계).

예전에는 판마다 정해 둔 대사를 골라 말했다. 같은 말이 되풀이되고,
다이아의 기분도 사이도 모르는 말이었다. 이제 시스템은 **무슨 일이
있었는지만** 알리고, 뭐라고 할지는 다이아가 그때 마음으로 정한다.

무게가 셋이다.
  big     판이 끝났다(이김·짐·비김·그만둠). 다이아가 말한다.
  medium  판이 출렁였다(장군·체크·잘못 친 종·결정적인 수). 말할 수도 있다 —
          너무 잦으면 화면이 건너뛴다.
  body    한 수 뒀다·판을 열었다. 말 없이 얼굴과 몸으로만.

outcome 은 다이아 쪽에서 본 결과다(다이아가 어떻게 느낄지는 dia/mind.py 가 정한다).
note 는 다이아에게 건넬 한 줄. **누가 이겼는지를 칸으로 못 박는다**(이긴 쪽: 너(다이아)) —
"네가 이겼다" 도 "너(다이아)가 이겼다" 도 모델이 7번 중 2번 거꾸로 읽었다(2026-10-01).
'무슨 일이 있었다' 뿐, 어떻게 말하라는 말은 없다.
"""

# game -> kind -> (무게, outcome, note)
EVENTS = {
    "chess": {
        "win":            ("big", "dia_won",  "체스 판이 끝났다. 이긴 쪽: 너(다이아). 진 쪽: 상대. (체크메이트)"),
        "lose":           ("big", "dia_lost", "체스 판이 끝났다. 이긴 쪽: 상대. 진 쪽: 너(다이아). (체크메이트를 당했다)"),
        "draw":           ("big", "draw",     "체스가 비겼다."),
        "draw_stalemate": ("big", "draw",     "체스가 스테일메이트로 비겼다 — 이기고 있던 쪽이 가장 억울한 끝이다."),
        "draw_material":  ("big", "draw",     "체스가 비겼다 — 둘 다 체크메이트를 할 말이 남지 않았다."),
        "draw_long":      ("big", "draw",     "체스가 비겼다 — 같은 수가 너무 오래 되풀이됐다."),
        "resign":         ("big", "you_quit", "상대가 체스를 그만뒀다(기권)."),
        "check_given":    ("medium", "dia_pressed", "체스에서 너(다이아)가 상대에게 체크를 걸었다."),
        "check_taken":    ("medium", "dia_pressed_on", "체스에서 상대가 너(다이아)에게 체크를 걸었다."),
        "took":           ("body", "dia_took", ""),
        "lost":           ("body", "dia_lost_piece", ""),
        "start":          ("body", "open", ""),
    },
    "gomoku": {
        "won":    ("big", "dia_won",  "오목 판이 끝났다. 이긴 쪽: 너(다이아). 진 쪽: 상대. (너(다이아)가 {spot} 에 놓아 다섯을 이었다)"),
        "lost":   ("big", "dia_lost", "오목 판이 끝났다. 이긴 쪽: 상대. 진 쪽: 너(다이아). (상대가 다섯을 이었다)"),
        "draw":   ("big", "draw",     "오목이 비겼다 — 판이 다 찼다."),
        "resign": ("big", "you_quit", "상대가 오목을 그만뒀다."),
        "threat": ("medium", "dia_pressed", "오목에서 너(다이아)가 방금 {spot} 에 놓아 판을 크게 흔들었다."),
        "move":   ("body", "move", ""),
        "open":   ("body", "open", ""),
    },
    "halli": {
        "won":       ("big", "dia_won",  "할리갈리 판이 끝났다. 이긴 쪽: 너(다이아). 진 쪽: 상대. (상대 카드가 다 떨어졌다)"),
        "lost":      ("big", "dia_lost", "할리갈리 판이 끝났다. 이긴 쪽: 상대. 진 쪽: 너(다이아). (너(다이아)의 카드가 다 떨어졌다)"),
        "quit":      ("big", "you_quit", "상대가 할리갈리를 그만뒀다."),
        "dia_wrong": ("medium", "dia_slip", "할리갈리에서 너(다이아)가 종을 잘못 쳤다. 벌칙으로 카드를 한 장씩 줬다."),
        "you_wrong": ("medium", "you_slip", "할리갈리에서 상대가 종을 잘못 쳤다."),
        "dia_ring":  ("body", "dia_took", ""),
        "you_ring":  ("body", "you_took", ""),
        "open":      ("body", "open", ""),
    },
    "janggi": {
        "won":     ("big", "dia_won",  "장기 판이 끝났다. 이긴 쪽: 너(다이아). 진 쪽: 상대. (너(다이아)가 {spot} 에서 외통을 냈다)"),
        "lost":    ("big", "dia_lost", "장기 판이 끝났다. 이긴 쪽: 상대. 진 쪽: 너(다이아). (너(다이아)가 외통을 당했다)"),
        "draw":    ("big", "draw",     "장기가 비겼다 — 더 둘 수가 없다."),
        "resign":  ("big", "you_quit", "상대가 장기를 그만뒀다."),
        "check":   ("medium", "dia_pressed", "장기에서 너(다이아)가 {spot} 에서 장군을 불렀다."),
        "checked": ("medium", "dia_pressed_on", "장기에서 상대가 장군을 불렀고, 너는 겨우 피했다."),
        "take":    ("body", "dia_took", ""),
        "move":    ("body", "move", ""),
        "open":    ("body", "open", ""),
    },
    "rps": {
        "win":  ("big", "dia_won",  "가위바위보 — 너(다이아): {mine}, 상대: {you}. 이긴 쪽: 너(다이아). 진 쪽: 상대."),
        "lose": ("big", "dia_lost", "가위바위보 — 너(다이아): {mine}, 상대: {you}. 이긴 쪽: 상대. 진 쪽: 너(다이아)."),
        "draw": ("big", "draw",     "가위바위보 — 너(다이아)와 상대 둘 다 {mine}. 비겼다."),
    },
}


def lookup(game, kind):
    return EVENTS.get(game, {}).get(kind)


def record(game, kind, **fmt):
    """이번 요청에서 일어난 일을 적어 둔다. 없는 일이면 None.

    경로(routes.py)의 after_request 가 이것을 답에 "event" 로 실어 보낸다.
    요청 밖(검사 등)에서는 적지 않고 사건만 돌려준다.
    """
    spec = lookup(game, kind)
    if not spec:
        return None

    weight, outcome, note = spec
    try:
        note = note.format(**fmt)
    except (KeyError, IndexError):
        pass

    ev = {"game": game, "kind": kind, "weight": weight,
          "outcome": outcome, "note": note,
          # 화면이 되돌려 보낼 때 note 를 믿지 않고 여기서 다시 짓는다
          "fmt": {k: str(v)[:12] for k, v in fmt.items()
                  if isinstance(v, (str, int, float))}}

    try:
        from flask import g, has_request_context
        if has_request_context() and weight in ("big", "medium"):
            # 한 요청에 여럿이면 무거운 것을 남긴다(끝난 판 > 출렁임)
            old = getattr(g, "game_event", None)
            if old is None or (old["weight"] != "big" or weight == "big"):
                g.game_event = ev
    except Exception:
        pass

    return ev


def rebuild(sent):
    """화면이 되돌려 보낸 사건을 서버 표로 다시 짓는다. 없는 일이면 None.

    화면이 준 note 는 쓰지 않는다 — 거기 무엇을 적어 보내든 다이아에게
    그대로 들어가면 안 된다. 놀이 이름·일의 종류·짧은 칸 값만 받는다.
    """
    if not isinstance(sent, dict):
        return None
    game, kind = str(sent.get("game") or ""), str(sent.get("kind") or "")
    spec = lookup(game, kind)
    if not spec:
        return None
    weight, outcome, note = spec
    fmt = {k: str(v)[:12] for k, v in (sent.get("fmt") or {}).items()
           if isinstance(k, str) and isinstance(v, (str, int, float))}
    try:
        note = note.format(**fmt)
    except (KeyError, IndexError):
        note = note.split(" — ")[0]
    return {"game": game, "kind": kind, "weight": weight, "outcome": outcome,
            "note": note, "again": bool(sent.get("again"))}


def pending():
    """이번 요청에서 적어 둔 일. 없으면 None."""
    try:
        from flask import g, has_request_context
        if has_request_context():
            return getattr(g, "game_event", None)
    except Exception:
        pass
    return None
