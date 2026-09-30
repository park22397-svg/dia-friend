"""놀이 경로 — 가위바위보·체스·오목·할리갈리·장기·끝말잇기, 선공 정하기, 한 판 더.

시스템 쪽이다. 원래 main.py 에 있던 것을 그대로 옮겼다(2026-09-30).
판 규칙은 엔진(system/games/*.py)이, 설정·대사는 GAMES(book.py)가 쥔다.
다이아에게서 빌리는 것은 '지금 어떤 사이인가'(dia.relation) 뿐이다.
"""

from flask import Blueprint, jsonify, request

import memory_manager
import who
from avatar import AVATAR
from dia.relation import stage_label as _stage_label
from dia.relation import stage_now as _stage_now
from system.games import GAMES

bp = Blueprint("games", __name__)


@bp.route(
    "/api/rps",
    methods=["POST"]
)
def rps_api():
    """가위바위보 한 판.

    화면은 사람이 낸 것만 보낸다.
    다이아가 무엇을 낼지, 뭐라고 할지, 친밀도가 얼마나 움직일지는
    전부 아바타 개체가 정한다.
    """

    try:

        from memory_manager import (
            append_message,
            load_relationship,
            save_relationship,
        )

        data = request.get_json(silent=True) or {}

        saved = load_relationship() or {}

        affinity = saved.get(
            "affinity",
            AVATAR.relationship.get("start_affinity", 0)
        )

        stage = _stage_now(
            affinity,
            saved.get("stage")
        )

        result = GAMES.rps_play(
            data.get("hand"),
            stage=stage,
            affinity=affinity,
        )

        if result is None:
            return jsonify(
                {
                    "ok": False,
                    "error": "가위바위보에 없는 손입니다."
                }
            ), 400

        before = stage.key

        affinity = AVATAR.apply_delta(
            affinity,
            result["affinity_delta"],
            stage,
        )

        stage = _stage_now(affinity, before)

        try:
            save_relationship(affinity, stage.key)
        except Exception as e:
            print(f"[가위바위보 관계 저장 오류]: {e}")

        _rps_tally(result.get("result"))

        # 놀았다는 사실이 대화에도 남아야 다음 말이 이어진다
        if result["reply"]:
            try:
                append_message(
                    "user",
                    f"(가위바위보 — 나는 {result['you_label']}, "
                    f"다이아는 {result['mine_label']})"
                )
                append_message("assistant", result["reply"])
            except Exception as e:
                print(f"[가위바위보 기록 오류]: {e}")

        result.update(
            {
                "ok": True,
                "affinity": affinity,
                "stage": stage.key,
                "stage_label": _stage_label(stage),
            }
        )

        return jsonify(result)

    except Exception as e:

        print(
            f"[가위바위보 오류]: {e}"
        )

        return jsonify(
            {
                "ok": False,
                "error": "판을 벌이지 못했습니다."
            }
        ), 500


# ============================================================
# 장기
#
# 규칙과 둘 수는 janggi.py, 무슨 말을 할지는 개체(AVATAR).
# 여기는 그 둘을 잇고 판을 기억해 둔다.
# ============================================================

def _jg_load():
    g = memory_manager.load_memory_data().get("janggi")

    if not isinstance(g, dict) or not g.get("board"):
        return None

    return g


def _jg_save(board, level=None):
    data = memory_manager.load_memory_data()
    before = data.get("janggi") or {}

    data["janggi"] = {
        "board": board,
        "level": level or before.get("level")
                 or GAMES.jg_level().get("key", "normal"),
    }

    memory_manager.save_memory_data(data)


def _jg_clear():
    data = memory_manager.load_memory_data()
    data["janggi"] = {}
    memory_manager.save_memory_data(data)


def _jg_out(board, say=None, extra=None):
    from system.games import janggi as JG

    out = JG.view(board, GAMES.jg_side()) if board else {"open": False}
    out["ok"] = True
    out["levels"] = GAMES.jg_levels()
    out["level"] = (_jg_load() or {}).get(
        "level", GAMES.jg_level().get("key", "normal"))

    if say:
        out["reply"] = say.get("line")
        out["expression"] = say.get("expression")
        out["motion"] = say.get("motion")

    if extra:
        out.update(extra)

    return out


def _jg_end(board, say, extra):
    """끝난 판의 답. 한 판 더 할지 같이 묻는다."""
    out = _jg_out(board, say, extra)
    _again(out, "janggi")

    return out


@bp.route("/api/janggi/state")
def janggi_state_api():
    g = _jg_load()

    if not g:
        return jsonify({"ok": True, "open": False,
                        "levels": GAMES.jg_levels()})

    out = _jg_out(g["board"])
    out["open"] = True

    return jsonify(out)


@bp.route("/api/janggi/new", methods=["POST"])
def janggi_new_api():
    from system.games import janggi as JG

    try:
        data = request.get_json(silent=True) or {}
        board = JG.new_board()
        _jg_save(board, data.get("level"))

        print("[장기]: 판을 펼쳤습니다.")

        # 가위바위보로 다이아가 먼저가 되면 다이아가 첫 수를 둔다.
        # 편(한·초)은 그대로다 — 먼저 두는 쪽만 바뀐다.
        if data.get("first") == "dia":
            mine = GAMES.jg_side()
            g = _jg_load() or {}
            rel = memory_manager.load_relationship() or {}
            pick = JG.choose(board, mine,
                             g.get("level") or GAMES.jg_level().get("key", "normal"),
                             mercy=GAMES.jg_mercy(rel.get("affinity", 0)))

            if pick is not None:
                board = JG.move(board, *pick)
                _jg_save(board, g.get("level"))

                say = GAMES.jg_say("move", _go_stage(), spot=JG.name(pick[1]))

                return jsonify(_jg_out(board, say, {"open": True,
                                                    "spot": pick[1],
                                                    "from": pick[0]}))

        say = GAMES.jg_say("open", _go_stage())
        out = _jg_out(board, say)
        out["open"] = True

        return jsonify(out)

    except Exception as e:
        print(f"[장기 새 판 오류]: {e}")
        return jsonify({"ok": False, "error": str(e)[:120]}), 500


@bp.route("/api/janggi/moves")
def janggi_moves_api():
    """이 말이 갈 수 있는 곳. 화면이 짚어 준다."""
    from system.games import janggi as JG

    try:
        g = _jg_load()

        if not g:
            return jsonify({"ok": False, "error": "판이 없습니다."}), 400

        i = request.args.get("from", type=int)
        board = g["board"]

        if i is None or not (0 <= i < len(board)) or board[i] == JG.EMPTY:
            return jsonify({"ok": True, "moves": []})

        you = JG.other(GAMES.jg_side())

        if JG.side_of(board[i]) != you:
            return jsonify({"ok": True, "moves": []})

        # 두고 나서 내 궁이 잡히는 수는 빼고 준다
        legal = [t for f, t in JG.legal_moves(board, you) if f == i]

        return jsonify({"ok": True, "moves": legal})

    except Exception as e:
        print(f"[장기 갈 곳 오류]: {e}")
        return jsonify({"ok": False, "error": str(e)[:120]}), 500


@bp.route("/api/janggi/move", methods=["POST"])
def janggi_move_api():
    from system.games import janggi as JG

    try:
        g = _jg_load()

        if not g:
            return jsonify({"ok": False, "error": "판이 없습니다."}), 400

        board = g["board"]
        data = request.get_json(silent=True) or {}
        frm = data.get("from")
        to = data.get("to")

        you = JG.other(GAMES.jg_side())
        mine = GAMES.jg_side()

        if (frm, to) not in JG.legal_moves(board, you):
            return jsonify({"ok": False, "error": "그렇게는 못 둡니다."}), 400

        board = JG.move(board, frm, to)

        # 사람이 이겼는가
        end = JG.outcome(board, mine)

        if end == "mate":
            _jg_clear()
            say = GAMES.jg_say("lost", _go_stage())
            _go_bump(say.get("affinity", 0))
            print("[장기]: 사람이 이겼습니다.")

            return jsonify(_jg_end(board, say, {"open": False, "winner": "you"}))

        if end == "stalemate":
            _jg_clear()
            say = GAMES.jg_say("draw", _go_stage())

            return jsonify(_jg_end(board, say, {"open": False}))

        # 다이아가 받는다
        rel = memory_manager.load_relationship() or {}
        level = g.get("level") or GAMES.jg_level().get("key", "normal")

        checked = JG.in_check(board, mine)

        pick = JG.choose(board, mine, level,
                         mercy=GAMES.jg_mercy(rel.get("affinity", 0)))

        if pick is None:
            _jg_clear()
            say = GAMES.jg_say("draw", _go_stage())

            return jsonify(_jg_end(board, say, {"open": False}))

        took = board[pick[1]]
        board = JG.move(board, *pick)
        spot = JG.name(pick[1])

        end = JG.outcome(board, you)

        if end == "mate":
            _jg_clear()
            say = GAMES.jg_say("won", _go_stage(), spot=spot)
            _go_bump(say.get("affinity", 0))
            print(f"[장기]: 다이아가 이겼습니다 ({spot}).")

            return jsonify(_jg_end(board, say, {"open": False, "winner": "dia"}))

        _jg_save(board, g.get("level"))

        # 무슨 말을 할지 — 장군 > 잡음 > 장군 맞고 피함 > 그냥 한 수
        if JG.in_check(board, you):
            kind, fmt = "check", {}
        elif took != JG.EMPTY:
            kind, fmt = "take", {"piece": JG.KO.get(took.upper(), "말")}
        elif checked:
            kind, fmt = "checked", {}
        else:
            kind, fmt = "move", {}

        say = GAMES.jg_say(kind, _go_stage(), spot=spot, **fmt)

        out = _jg_out(board, say, {"open": True, "spot": pick[1],
                                   "from": pick[0]})

        return jsonify(out)

    except Exception as e:
        print(f"[장기 두기 오류]: {e}")
        return jsonify({"ok": False, "error": str(e)[:120]}), 500


@bp.route("/api/janggi/level", methods=["POST"])
def janggi_level_api():
    try:
        data = request.get_json(silent=True) or {}
        want = str(data.get("level") or "").strip()

        if want not in [l.get("key") for l in GAMES.jg_levels()]:
            return jsonify({"ok": False, "error": "그런 세기가 없습니다."}), 400

        g = _jg_load()

        if g:
            _jg_save(g["board"], want)

        return jsonify({"ok": True, "level": want})

    except Exception as e:
        print(f"[장기 세기 오류]: {e}")
        return jsonify({"ok": False, "error": str(e)[:120]}), 500


@bp.route("/api/janggi/resign", methods=["POST"])
def janggi_resign_api():
    try:
        _jg_clear()
        say = GAMES.jg_say("resign", _go_stage())
        _go_bump(say.get("affinity", 0))

        return jsonify(_jg_out(None, say, {"open": False}))

    except Exception as e:
        print(f"[장기 그만 오류]: {e}")
        return jsonify({"ok": False, "error": str(e)[:120]}), 500


# ============================================================
# 할리갈리
#
# 규칙과 반응 속도는 halli.py, 무슨 말을 할지는 개체(AVATAR).
#
# 이 놀이는 **누가 먼저 손을 대는가** 가 전부다. 그래서 뒤집을 때마다
# 다이아가 종을 치기까지 걸릴 시간을 굴려서 화면에 같이 보낸다.
# 화면이 그 시간만큼 기다렸다가, 사람이 먼저 안 눌렀으면 다이아가
# 친 것으로 알린다.
#
# 시간을 화면에 알려 주는 것이 꺼림칙할 수 있지만, 혼자 하는 놀이라
# 속일 사람이 없다. 서버에서 재려면 타이머를 돌려야 하는데 그건
# 훨씬 무겁다.
# ============================================================

def _hg_load():
    g = memory_manager.load_memory_data().get("halli")

    if not isinstance(g, dict) or not g.get("on"):
        return None

    return g


def _hg_save(game):
    data = memory_manager.load_memory_data()
    data["halli"] = game or {}
    memory_manager.save_memory_data(data)


def _hg_clear():
    _hg_save({})


def _hg_say(kind, **fmt):
    """할 말 한 벌. 호감도 같이 옮긴다."""
    say = GAMES.hg_say(kind, _go_stage(), **fmt)

    if say.get("affinity"):
        _go_bump(say["affinity"])

    return say


def _hg_out(game, say=None, extra=None):
    from system.games import halli as HG

    out = HG.view(game) if game else {"on": False}
    out["ok"] = True
    out["levels"] = GAMES.hg_levels()

    if say:
        out["reply"] = say.get("line")
        out["expression"] = say.get("expression")
        out["motion"] = say.get("motion")

    if extra:
        out.update(extra)

    return out


@bp.route("/api/halli/state")
def halli_state_api():
    g = _hg_load()

    if not g:
        return jsonify({"ok": True, "on": False,
                        "levels": GAMES.hg_levels()})

    return jsonify(_hg_out(g))


@bp.route("/api/halli/new", methods=["POST"])
def halli_new_api():
    from system.games import halli as HG

    try:
        data = request.get_json(silent=True) or {}
        level = data.get("level") or GAMES.hg_level().get("key", "normal")

        g = HG.new_game(level=level)

        # 가위바위보로 다이아가 먼저가 되면 다이아가 먼저 뒤집는다.
        # 화면은 다이아 차례를 보면 알아서 뒤집기를 부른다.
        if data.get("first") == "dia":
            g["turn"] = "dia"

        _hg_save(g)

        print(f"[할리갈리]: 판을 열었습니다 ({g.get('turn')} 먼저).")

        # '먼저 뒤집으세요' 는 사람이 먼저일 때만 맞는 말이다
        say = None if g.get("turn") == "dia" else _hg_say("open")

        return jsonify(_hg_out(g, say))

    except Exception as e:
        print(f"[할리갈리 새 판 오류]: {e}")
        return jsonify({"ok": False, "error": str(e)[:120]}), 500


@bp.route("/api/halli/flip", methods=["POST"])
def halli_flip_api():
    """한 장 뒤집는다. 차례인 쪽이 뒤집는다."""
    from system.games import halli as HG
    import random as _rnd

    try:
        g = _hg_load()

        if not g:
            return jsonify({"ok": False, "error": "판이 없습니다."}), 400

        who = g.get("turn") or "you"

        if not HG.flip(g, who):
            # 뒤집을 것이 없다. 진 것이다.
            _hg_clear()
            lost = (who == "dia")
            say = _hg_say("lost" if lost else "won")

            out = _hg_out(None, say, {"winner": "you" if lost else "dia"})
            _again(out, "halli")

            return jsonify(out)

        # 종 칠 때인가. 다이아가 얼마나 빨리 칠지 굴린다.
        fruit = HG.should_ring(g)
        rel = memory_manager.load_relationship() or {}
        mercy = GAMES.hg_mercy(rel.get("affinity", 0))
        level = g.get("level") or "normal"

        g["ring"] = bool(fruit)
        g["dia_ms"] = None
        g["dia_wrong"] = False

        if fruit:
            ms, wrong = HG.roll_reaction(level, mercy)
            g["dia_ms"] = ms
            g["dia_wrong"] = False          # 맞는 자리라 잘못이 아니다
        else:
            # 아닌데 치는 것도 있다. 한 번도 안 틀리는 상대는
            # 사람 같지 않고, 사람에게 카드를 줄 기회도 안 생긴다.
            conf = HG.LEVELS.get(level) or HG.LEVELS["normal"]

            if _rnd.random() < conf["wrong"]:
                g["dia_ms"] = HG.wrong_ring_delay(level)
                g["dia_wrong"] = True

        _hg_save(g)

        return jsonify(_hg_out(g, None, {
            "flipped": who,
            "dia_ms": g["dia_ms"],
        }))

    except Exception as e:
        print(f"[할리갈리 뒤집기 오류]: {e}")
        return jsonify({"ok": False, "error": str(e)[:120]}), 500


@bp.route("/api/halli/bell", methods=["POST"])
def halli_bell_api():
    """종을 쳤다. who 는 'you' 또는 'dia'."""
    from system.games import halli as HG

    try:
        g = _hg_load()

        if not g:
            return jsonify({"ok": False, "error": "판이 없습니다."}), 400

        data = request.get_json(silent=True) or {}
        who = "dia" if data.get("who") == "dia" else "you"
        ms = data.get("ms")

        fruit = HG.should_ring(g)

        # 사람이 쳤는데 다이아가 더 빨랐는가.
        #
        # 화면이 시간을 재서 보낸다. 다이아 쪽이 빠르면 다이아가
        # 친 것으로 넘긴다 — 화면 타이머와 사람 손이 거의 같이
        # 도착하는 자리라 여기서 한 번 더 가른다.
        if (who == "you" and isinstance(ms, (int, float))
                and g.get("dia_ms") and ms > g["dia_ms"]):
            who = "dia"

        if who == "dia":
            right = bool(fruit) and not g.get("dia_wrong")
        else:
            right = bool(fruit)

        if right:
            n = HG.take_pile(g, who)
            say = _hg_say("dia_ring" if who == "dia" else "you_ring",
                          fruit=HG.FRUIT_KO.get(fruit, ""), n=n)
        else:
            HG.penalty(g, who)
            say = _hg_say("dia_wrong" if who == "dia" else "you_wrong")

        g["ring"] = False
        g["dia_ms"] = None
        g["dia_wrong"] = False

        # 종을 친 쪽이 다음에 뒤집는다
        g["turn"] = who

        won = HG.winner(g)

        if won:
            _hg_clear()
            end = _hg_say("won" if won == "dia" else "lost")

            out = _hg_out(None, end, {"winner": won})
            _again(out, "halli")

            return jsonify(out)

        _hg_save(g)

        return jsonify(_hg_out(g, say, {"right": right, "rang": who}))

    except Exception as e:
        print(f"[할리갈리 종 오류]: {e}")
        return jsonify({"ok": False, "error": str(e)[:120]}), 500


@bp.route("/api/halli/level", methods=["POST"])
def halli_level_api():
    try:
        data = request.get_json(silent=True) or {}
        want = str(data.get("level") or "").strip()

        if want not in [l.get("key") for l in GAMES.hg_levels()]:
            return jsonify({"ok": False, "error": "그런 세기가 없습니다."}), 400

        g = _hg_load()

        if g:
            g["level"] = want
            _hg_save(g)

        return jsonify({"ok": True, "level": want})

    except Exception as e:
        print(f"[할리갈리 세기 오류]: {e}")
        return jsonify({"ok": False, "error": str(e)[:120]}), 500


@bp.route("/api/halli/quit", methods=["POST"])
def halli_quit_api():
    try:
        _hg_clear()

        return jsonify(_hg_out(None, _hg_say("quit")))

    except Exception as e:
        print(f"[할리갈리 그만 오류]: {e}")
        return jsonify({"ok": False, "error": str(e)[:120]}), 500


# ============================================================
# 오목
#
# 규칙과 둘 자리는 gomoku.py, 무슨 말을 할지는 개체(AVATAR).
# 여기는 그 둘을 잇고 판을 기억해 둔다.
#
# 판은 사람마다 따로다. 체스와 같은 자리에 넣는다.
# ============================================================

def _go_load():
    """이 사람의 오목판. 없으면 None."""
    g = memory_manager.load_memory_data().get("gomoku")

    if not isinstance(g, dict) or not g.get("board"):
        return None

    return g


def _go_save(board, level=None, dia=None):
    data = memory_manager.load_memory_data()
    before = data.get("gomoku") or {}

    data["gomoku"] = {
        "board": board,
        "level": level or before.get("level")
                 or GAMES.go_level().get("key", "normal"),
        # 다이아가 잡은 돌. 판마다 다르다 — 가위바위보로 먼저 두게
        # 되면 다이아가 검은 돌(선공)을 잡는다.
        "dia": dia or before.get("dia") or GAMES.go_stone(),
    }

    memory_manager.save_memory_data(data)


def _go_dia(g=None):
    """이 판에서 다이아가 잡은 돌."""
    g = g if g is not None else (_go_load() or {})
    return g.get("dia") or GAMES.go_stone()


def _go_clear():
    data = memory_manager.load_memory_data()
    data["gomoku"] = {}
    memory_manager.save_memory_data(data)


def _go_stage():
    """지금 어떤 사이인지. 말투를 가르는 데 쓴다."""
    rel = memory_manager.load_relationship() or {}
    grants = AVATAR.gate_grants(rel)

    return AVATAR.stage_for_affinity(rel.get("affinity", 0), grants)


def _go_bump(delta):
    """놀이로 얻는 것은 작게. 체스·가위바위보와 같은 자리."""
    if not delta:
        return

    rel = memory_manager.load_relationship() or {}
    grants = AVATAR.gate_grants(rel)

    aff = AVATAR.clamp_affinity(
        int(rel.get("affinity", 0)) + int(delta), grants=grants)

    st = AVATAR.stage_for_affinity(aff, grants)

    memory_manager.save_relationship(
        aff, st.key if st else rel.get("stage", "distant"))


def _go_view(board, event=None, spot=None):
    """화면에 돌려줄 것 한 벌."""
    from system.games import gomoku as GO

    out = GO.view(board, _go_dia())
    out["ok"] = True
    out["level"] = (_go_load() or {}).get(
        "level", GAMES.go_level().get("key", "normal"))
    out["levels"] = GAMES.go_levels()

    if event:
        say = GAMES.go_say(event, _go_stage(), spot=spot or "")
        out["reply"] = say.get("line")
        out["expression"] = say.get("expression")
        out["motion"] = say.get("motion")

    return out


@bp.route("/api/gomoku/state")
def gomoku_state_api():
    from system.games import gomoku as GO

    g = _go_load()

    if not g:
        return jsonify({"ok": True, "open": False})

    out = _go_view(g["board"])
    out["open"] = True
    out["winner"] = GO.winner(g["board"])

    return jsonify(out)


@bp.route("/api/gomoku/new", methods=["POST"])
def gomoku_new_api():
    from system.games import gomoku as GO

    try:
        data = request.get_json(silent=True) or {}
        level = data.get("level")
        first = data.get("first")

        # 검은 돌이 먼저 둔다. 가위바위보로 다이아가 먼저가 되면
        # 다이아가 검은 돌을 잡고 첫 수를 둔다.
        if first == "dia":
            dia = GO.BLACK
        elif first == "you":
            dia = GO.WHITE
        else:
            dia = GAMES.go_stone()

        board = GO.new_board()
        _go_save(board, level, dia)

        print(f"[오목]: 판을 열었습니다 (다이아 {dia}).")

        if dia == GO.BLACK:
            g = _go_load() or {}
            rel = memory_manager.load_relationship() or {}
            pick = GO.choose(board, dia,
                             g.get("level") or GAMES.go_level().get("key", "normal"),
                             mercy=GAMES.go_mercy(rel.get("affinity", 0)))

            if pick is not None:
                rr, cc = divmod(pick, GO.SIZE)
                board = GO.put(board, rr, cc, dia)
                _go_save(board)

                out = _go_view(board, "move", GO.name(pick))
                out["open"] = True
                out["spot"] = pick

                return jsonify(out)

        # 사람이 먼저 두는 판. '먼저 두세요' 하고 연다.
        out = _go_view(board, "open")
        out["open"] = True

        return jsonify(out)

    except Exception as e:
        print(f"[오목 새 판 오류]: {e}")
        return jsonify({"ok": False, "error": str(e)[:120]}), 500


@bp.route("/api/gomoku/move", methods=["POST"])
def gomoku_move_api():
    """사람이 한 수 두고, 다이아가 받는다."""
    from system.games import gomoku as GO

    try:
        g = _go_load()

        if not g:
            return jsonify({"ok": False, "error": "판이 없습니다."}), 400

        board = g["board"]
        data = request.get_json(silent=True) or {}
        spot = data.get("spot")

        if not isinstance(spot, int) or not (0 <= spot < GO.SIZE * GO.SIZE):
            return jsonify({"ok": False, "error": "그런 자리가 없습니다."}), 400

        if board[spot] != GO.EMPTY:
            return jsonify({"ok": False, "error": "이미 돌이 있습니다."}), 400

        mine = _go_dia(g)
        yours = GO.other(mine)

        r, c = divmod(spot, GO.SIZE)
        board = GO.put(board, r, c, yours)

        # 사람이 이겼는가
        if GO.winner_at(board, r, c) == yours:
            _go_clear()
            say = GAMES.go_say("lost", _go_stage())
            _go_bump(say.get("affinity", 0))

            out = GO.view(board, mine)
            out.update({"ok": True, "open": False, "winner": yours,
                        "reply": say.get("line"),
                        "expression": say.get("expression"),
                        "motion": say.get("motion")})
            _again(out, "gomoku")
            print("[오목]: 사람이 이겼습니다.")

            return jsonify(out)

        if GO.is_full(board):
            _go_clear()
            say = GAMES.go_say("draw", _go_stage())
            out = GO.view(board, mine)
            out.update({"ok": True, "open": False, "winner": None,
                        "reply": say.get("line"),
                        "expression": say.get("expression")})
            _again(out, "gomoku")

            return jsonify(out)

        # 다이아가 받는다
        rel = memory_manager.load_relationship() or {}
        level = g.get("level") or GAMES.go_level().get("key", "normal")

        # 사람이 셋을 만들어 놓았는가 — 알아채면 그렇게 말한다
        before = GO.evaluate(board, mine)

        pick = GO.choose(board, mine, level,
                         mercy=GAMES.go_mercy(rel.get("affinity", 0)))

        if pick is None:
            _go_clear()
            say = GAMES.go_say("draw", _go_stage())
            out = GO.view(board, mine)
            out.update({"ok": True, "open": False, "reply": say.get("line")})
            _again(out, "gomoku")

            return jsonify(out)

        rr, cc = divmod(pick, GO.SIZE)
        board = GO.put(board, rr, cc, mine)
        name = GO.name(pick)

        if GO.winner_at(board, rr, cc) == mine:
            _go_clear()
            say = GAMES.go_say("won", _go_stage(), spot=name)
            _go_bump(say.get("affinity", 0))

            out = GO.view(board, mine)
            out.update({"ok": True, "open": False, "winner": mine,
                        "reply": say.get("line"),
                        "expression": say.get("expression"),
                        "motion": say.get("motion")})
            _again(out, "gomoku")
            print(f"[오목]: 다이아가 이겼습니다 ({name}).")

            return jsonify(out)

        _go_save(board, g.get("level"))

        # 막느라 둔 수였으면 그렇게 말한다. 알아채는 것이 사람 같다.
        after = GO.evaluate(board, mine)
        kind = "threat" if (after - before) > 1500 else "move"

        out = _go_view(board, kind, name)
        out["open"] = True
        out["spot"] = pick

        return jsonify(out)

    except Exception as e:
        print(f"[오목 두기 오류]: {e}")
        return jsonify({"ok": False, "error": str(e)[:120]}), 500


@bp.route("/api/gomoku/level", methods=["POST"])
def gomoku_level_api():
    try:
        data = request.get_json(silent=True) or {}
        want = str(data.get("level") or "").strip()

        keys = [l.get("key") for l in GAMES.go_levels()]

        if want not in keys:
            return jsonify({"ok": False, "error": "그런 세기가 없습니다."}), 400

        g = _go_load()

        if g:
            _go_save(g["board"], want)

        return jsonify({"ok": True, "level": want})

    except Exception as e:
        print(f"[오목 세기 오류]: {e}")
        return jsonify({"ok": False, "error": str(e)[:120]}), 500


@bp.route("/api/gomoku/resign", methods=["POST"])
def gomoku_resign_api():
    try:
        _go_clear()
        say = GAMES.go_say("resign", _go_stage())
        _go_bump(say.get("affinity", 0))

        print("[오목]: 그만뒀습니다.")

        return jsonify({"ok": True, "open": False,
                        "reply": say.get("line"),
                        "expression": say.get("expression")})

    except Exception as e:
        print(f"[오목 그만 오류]: {e}")
        return jsonify({"ok": False, "error": str(e)[:120]}), 500




# ============================================================
# 체스
#
# 규칙은 python-chess, 무엇을 둘지는 chess_play, 무슨 말을 할지는
# 개체(AVATAR)가 정한다. 여기는 그 셋을 잇고 판을 기억해 둔다.
#
# 판은 사람마다 따로다. 기억과 같은 자리에 넣는다 — 그래야 계정이
# 갈리면 판도 같이 갈리고, 창을 닫았다 열어도 두던 판이 남는다.
# ============================================================

def _chess_load():
    """이 사람의 체스 상태. 아무것도 없으면 None.

    **판(fen)이 있어야만 돌려주면 안 된다.** 선공을 가위바위보로
    정하는 동안은 아직 판이 없고 `deciding` 만 있는데, 그때
    None 을 돌려주면 자기 상태를 못 읽어 "정하는 중이 아니다" 라고
    한다. 실제로 그랬다.

    판이 필요한 쪽은 _chess_board() 가 따로 본다.
    """

    g = memory_manager.load_memory_data().get("chess")

    if not isinstance(g, dict) or not g:
        return None

    return g


def _chess_save(board, dia_color, level=None):
    data = memory_manager.load_memory_data()

    before = data.get("chess") or {}

    data["chess"] = {
        "fen": board.fen(),
        "dia": "white" if dia_color else "black",
        "moves": [m.uci() for m in board.move_stack],
        # 난이도는 판과 함께 남는다. 안 적으면 창을 닫았다 열 때마다
        # 기본으로 돌아가 버린다.
        "level": level or before.get("level")
                 or GAMES.chess().get("level", "normal"),
    }

    memory_manager.save_memory_data(data)


def _chess_level_key():
    """이 사람이 고른 난이도."""

    g = _chess_load() or {}

    return g.get("level") or GAMES.chess().get("level", "normal")


def _chess_pick(board):
    """지금 난이도로 다이아가 둘 수를 고른다."""

    from system.games import chess_play

    lv = GAMES.chess_level(_chess_level_key())

    return chess_play.choose(
        board,
        depth=int(lv.get("depth", 3)),
        blunder=float(lv.get("blunder", 0.0)),
        mercy=GAMES.chess_mercy(
            memory_manager.load_relationship().get("affinity", 0)),
    )


def _chess_clear():
    data = memory_manager.load_memory_data()
    data["chess"] = {}
    memory_manager.save_memory_data(data)


def _chess_board():
    """저장해 둔 판을 되살린다. 반환: (board, dia_color) 또는 (None, None)."""

    import chess

    g = _chess_load()

    # 판이 있어야 되살린다. 선공을 정하는 중이면 아직 없다.
    if not g or not g.get("fen"):
        return None, None

    try:
        board = chess.Board(g["fen"])
    except ValueError as e:
        print("[체스판 되살리기 실패]:", e)
        return None, None

    return board, (chess.WHITE if g.get("dia") == "white" else chess.BLACK)


def _chess_reply(event, extra=None):
    """그 일에 대한 다이아의 말과 얼굴. 친밀도도 움직인다."""

    stage = _chess_stage()

    said = GAMES.chess_say(event, stage) or {}

    if said.get("affinity"):
        _chess_bump(said["affinity"])

    # 한 말은 대화 기록에도 남긴다.
    #
    # 화면에만 띄우고 말면 판이 끝난 뒤 "아까 체스 재밌었어" 라고 해도
    # 무슨 말인지 모른다. 다이아가 한 말이 기록에 없으니 안 한 것이나
    # 같다. 놀이도 같이 보낸 시간이다.
    if said.get("line"):
        try:
            memory_manager.append_message("assistant", said["line"])
        except Exception as e:
            print("[체스 말 기록 실패]:", e)

    out = {
        "line": said.get("line"),
        "expression": said.get("expression"),
    }

    # 판이 끝났으면 한 판 더 할지 묻는다
    if event in ("win", "lose") or str(event).startswith("draw"):
        _log_line("assistant", _again(out, "chess", key="line"))

    if extra:
        out.update(extra)

    return out


def _chess_stage():
    """지금 어떤 사이인지. 말투를 가르는 데 쓴다."""

    rel = memory_manager.load_relationship() or {}

    grants = AVATAR.gate_grants(rel)

    return AVATAR.stage_for_affinity(rel.get("affinity", 0), grants)


def _chess_bump(delta):
    """친밀도를 움직인다. 놀이로 얻는 것은 작게."""

    if not delta:
        return

    rel = memory_manager.load_relationship()

    aff = AVATAR.clamp_affinity(
        int(rel.get("affinity", 0)) + int(delta),
        lover=bool(rel.get("lover", False)),
        friends=bool(rel.get("friends", False)),
    )

    stage = AVATAR.stage_for_affinity(aff, AVATAR.gate_grants(rel))

    memory_manager.save_relationship(
        aff, stage.key if stage else rel.get("stage", "distant"))


def _chess_view(board, dia_color, event=None, extra=None):
    """화면에 돌려줄 것 한 벌."""

    from system.games import chess_play

    out = {"ok": True}
    out.update(chess_play.board_view(board, dia_color))

    out["level"] = _chess_level_key()
    out["levels"] = [
        {"key": lv.get("key"), "label": lv.get("label")}
        for lv in GAMES.chess_levels()
    ]

    if event:
        out.update(_chess_reply(event, extra))
    elif extra:
        out.update(extra)

    return out


@bp.route("/api/chess/state")
def chess_state_api():
    """두던 판이 있으면 그것을. 없으면 없다고."""

    board, dia_color = _chess_board()

    if board is None:
        return jsonify({"ok": True, "playing": False})

    view = _chess_view(board, dia_color)
    view["playing"] = True

    return jsonify(view)


@bp.route("/api/chess/new", methods=["POST"])
def chess_new_api():
    """새 판을 연다."""

    import chess
    from system.games import chess_play

    data = request.get_json(silent=True) or {}

    # 사람이 어느 쪽을 잡는가.
    #
    # 예전에는 다이아 기준으로 받았다(color). 화면에서 "나는 검은 말"
    # 이라고 고르면 그 반대를 보내야 해서 헷갈린다. **사람 기준**으로
    # 받는다 — 고르는 사람이 곧 그 사람이니까.
    #
    # 안 적어 보내면 두던 것을 그대로. 그것도 없으면 개체가 정한 값.
    you = str(data.get("you") or "").lower()

    if you not in ("white", "black"):
        g = _chess_load() or {}
        was = g.get("dia")

        if was in ("white", "black"):
            you = "black" if was == "white" else "white"
        else:
            you = "black" if GAMES.chess().get(
                "dia_color", "black") == "white" else "white"

    dia_color = chess.BLACK if you == "white" else chess.WHITE

    board = chess.Board()

    # 난이도. 안 적어 보내면 두던 것을 그대로 쓴다.
    level = str(data.get("level") or _chess_level_key())

    _chess_save(board, dia_color, level)

    view_extra = {}

    # 다이아가 흰 쪽이면 먼저 한 수 둔다
    if board.turn == dia_color:
        move, _ = _chess_pick(board)

        if move:
            board.push(move)
            view_extra["dia_move"] = move.uci()

    _chess_save(board, dia_color, level)

    view = _chess_view(board, dia_color, "start", view_extra)
    view["playing"] = True

    return jsonify(view)


@bp.route("/api/chess/move", methods=["POST"])
def chess_move_api():
    """사람이 한 수 두면, 받아서 두고 다이아도 둔다."""

    import chess
    from system.games import chess_play

    data = request.get_json(silent=True) or {}
    uci = str(data.get("move") or "").strip()

    board, dia_color = _chess_board()

    if board is None:
        return jsonify({"ok": False, "error": "두던 판이 없습니다."})

    if board.turn == dia_color:
        return jsonify({"ok": False, "error": "지금은 다이아 차례입니다."})

    # 승격을 안 적었으면 퀸으로 친다.
    #
    # 화면에서 폰을 8행에 놓으면 e7e8 만 온다. 그대로는 못 두는 수다.
    try:
        move = chess.Move.from_uci(uci)
    except ValueError:
        return jsonify({"ok": False, "error": "그렇게는 못 둡니다."})

    if move not in board.legal_moves:
        promoted = chess.Move(move.from_square, move.to_square,
                              promotion=chess.QUEEN)
        if promoted in board.legal_moves:
            move = promoted
        else:
            return jsonify({"ok": False, "error": "그렇게는 못 둡니다."})

    # 사람이 다이아 말을 잡았나. **두기 전에** 물어야 한다 —
    # 두고 나면 그 자리에 이미 사람 말이 서 있다.
    dia_lost = board.is_capture(move)

    board.push(move)

    events = []

    if board.is_game_over():
        _chess_save(board, dia_color)
        return jsonify(_chess_view(board, dia_color,
                                   _chess_over_event(board, dia_color)))

    if board.is_check():
        events.append("check_taken")

    # 다이아가 둔다
    move2, _ = _chess_pick(board)

    took = False
    extra = {"you_move": move.uci()}

    if move2 is not None:
        took = board.is_capture(move2)
        board.push(move2)
        extra["dia_move"] = move2.uci()

    _chess_save(board, dia_color)

    # 무슨 일이 가장 할 말이 많은가. 판이 끝난 것 > 장군 > 잡기.
    if board.is_game_over():
        event = _chess_over_event(board, dia_color)
    elif board.is_check():
        event = "check_given"
    elif took:
        event = "took"
    elif dia_lost:
        event = "lost"
    elif events:
        event = events[0]
    else:
        event = None

    return jsonify(_chess_view(board, dia_color, event, extra))


def _chess_over_event(board, dia_color):
    """판이 끝났다면 어떤 끝인가.

    무승부를 한 덩어리로 두면 안 된다. **이기고 있던 쪽이 가장
    억울해하는 끝이 스테일메이트**인데, 그냥 "비겼어요" 라고만 하면
    놀이가 고장 난 줄 안다 — 실제로 그런 말을 들었다.
    왜 비겼는지가 말에 드러나야 한다.
    """

    if board.is_checkmate():
        # 둘 차례인 쪽이 졌다
        return "lose" if board.turn == dia_color else "win"

    if board.is_stalemate():
        return "draw_stalemate"

    if board.is_insufficient_material():
        return "draw_material"

    if board.is_seventyfive_moves() or board.is_fivefold_repetition():
        return "draw_long"

    return "draw"


def _rps_tally(result):
    """가위바위보 한 판을 전적에 더한다.

    놀아 놓고 다음 대화에서 모르면 같이 논 것이 아니다.
    result 는 다이아 기준이다(win = 다이아가 이겼다).
    """

    if result not in ("win", "lose", "draw"):
        return

    d = memory_manager.load_memory_data()

    t = dict(d.get("rps") or {})
    t[result] = int(t.get(result, 0)) + 1
    t["last"] = result

    d["rps"] = t
    memory_manager.save_memory_data(d)


def _log_line(role, line):
    """놀이에서 오간 말을 대화 기록에 남긴다. 체스와 같은 까닭."""
    if not line:
        return

    try:
        memory_manager.append_message(role, line)
    except Exception as e:
        print("[놀이 말 기록 실패]:", e)


# ============================================================
# 한 판 더
#
# 판이 끝나면(이기든 지든 비기든) 다이아가 한 판 더 할지 묻는다.
# 화면은 again 을 보고 사람의 다음 말을 그 물음의 답으로 읽는다
# (/api/again/answer). 기권·그만으로 끝낸 판에는 묻지 않는다.
# ============================================================

def _again(out, game, key="reply"):
    """끝난 판의 말 끝에 '한 판 더 할래?' 를 붙인다. 붙인 말을 돌려준다.

    이긴 말에 이미 '한 판 더' 가 들어 있으면 또 묻지 않는다.
    """
    ask = GAMES.again_say("ask", _go_stage()).get("line") or ""
    line = out.get(key) or ""

    out["again"] = game

    if not ask or "한 판 더" in line.replace("한판", "한 판"):
        return None

    out[key] = f"{line} {ask}".strip()

    return ask


@bp.route("/api/again/answer", methods=["POST"])
def again_answer_api():
    """'한 판 더 할래?' 에 대한 답인가. 답이면 기록하고 받는 말을 준다.

    answer: yes(다시) / no(그만) / None(딴 이야기 — 화면이 평소처럼 보낸다)
    """
    data = request.get_json(silent=True) or {}
    text = str(data.get("text") or "").strip()[:200]
    game = str(data.get("game") or "")

    answer = GAMES.again_answer(text)

    if answer is None:
        return jsonify({"ok": True, "answer": None})

    _log_line("user", text)

    out = {"ok": True, "answer": answer, "game": game}

    if answer == "no":
        said = GAMES.again_say("no", _go_stage())
        out.update(line=said.get("line"), expression=said.get("expression"))
        _log_line("assistant", said.get("line"))

        print(f"[한 판 더]: 그만 — {game}")
    else:
        print(f"[한 판 더]: 다시 — {game}")

    return jsonify(out)


# ============================================================
# 선공 정하기 — 오목·장기·할리갈리·끝말잇기
#
# 어느 놀이든 시작하기 전에 가위바위보로 먼저 할 사람을 정한다.
# 체스(/api/chess/start)와 같은 규칙이다 — 비기면 다시, 다이아가
# 이기면 다이아가 먼저, 사람이 이기면 먼저/나중을 고른다.
#
# 정해지면 화면이 그 놀이의 /new 에 first(you|dia)를 실어 판을 연다.
# ============================================================

FIRST_GAMES = ("gomoku", "janggi", "halli", "word_chain")


def _first_load():
    f = memory_manager.load_memory_data().get("first")
    return f if isinstance(f, dict) else {}


def _first_save(f):
    d = memory_manager.load_memory_data()
    d["first"] = f or {}
    memory_manager.save_memory_data(d)


@bp.route("/api/first/start", methods=["POST"])
def first_start_api():
    data = request.get_json(silent=True) or {}
    game = str(data.get("game") or "")

    if game not in FIRST_GAMES:
        return jsonify({"ok": False, "error": "그런 놀이가 없습니다."}), 400

    _first_save({"game": game, "deciding": True})

    stage = _go_stage()
    said = GAMES.first_say("ask", stage)
    line = said.get("line")

    # '한 판 더' 에 그러자고 해서 온 것이면 반기는 말을 앞에 붙인다
    if data.get("again"):
        yes = GAMES.again_say("yes", stage).get("line")
        if yes:
            line = f"{yes} {line}" if line else yes

    _log_line("assistant", line)

    return jsonify({
        "ok": True,
        "game": game,
        "deciding": True,
        "hands": GAMES.rps_hands(),
        "line": line,
        "expression": said.get("expression"),
    })


@bp.route("/api/first/rps", methods=["POST"])
def first_rps_api():
    data = request.get_json(silent=True) or {}
    f = _first_load()

    if not f.get("deciding") or f.get("choose"):
        return jsonify({"ok": False, "error": "가위바위보를 낼 때가 아닙니다."})

    saved = memory_manager.load_relationship() or {}
    affinity = saved.get("affinity",
                         AVATAR.relationship.get("start_affinity", 0))
    stage = _stage_now(affinity, saved.get("stage"))

    result = GAMES.rps_play(data.get("hand"), stage=stage, affinity=affinity)

    if result is None:
        return jsonify({"ok": False, "error": "가위바위보에 없는 손입니다."})

    _rps_tally(result.get("result"))

    _log_line("user",
              f"(선공 가위바위보 - 나는 {result['you_label']}, "
              f"다이아는 {result['mine_label']})")

    out = {
        "ok": True,
        "game": f.get("game"),
        "deciding": True,
        "hands": GAMES.rps_hands(),
        "motion": result.get("motion"),      # 다이아가 낸 손
        "you_hand": result.get("you"),
        "dia_hand": result.get("mine"),
        "you_label": result.get("you_label"),
        "dia_label": result.get("mine_label"),
        # result 는 다이아 기준이다. win 이면 다이아가 이겼다.
        "result": result.get("result"),
    }

    # 선공을 정하는 것이지 놀이로 사이가 오가는 자리가 아니다 —
    # 친밀도는 안 건드린다(체스와 같다).
    if result.get("result") == "draw":
        said = GAMES.first_say("tie", stage)

    elif result.get("result") == "win":
        said = GAMES.first_say("dia_won", stage)
        _first_save({})
        out.update(deciding=False, first="dia")

    else:
        said = GAMES.first_say("you_won", stage)
        _first_save(dict(f, choose=True))
        out["choose"] = True

    out.update(line=said.get("line"), expression=said.get("expression"))
    _log_line("assistant", said.get("line"))

    return jsonify(out)


@bp.route("/api/first/choose", methods=["POST"])
def first_choose_api():
    """가위바위보에 이긴 사람이 먼저/나중을 고른다."""
    data = request.get_json(silent=True) or {}
    f = _first_load()

    if not f.get("choose"):
        return jsonify({"ok": False, "error": "고를 때가 아닙니다."})

    first = "dia" if data.get("first") == "dia" else "you"
    _first_save({})

    return jsonify({"ok": True, "game": f.get("game"),
                    "deciding": False, "first": first})


# ============================================================
# 끝말잇기 — 선공을 정한 뒤 여는 길
#
# 끝말잇기는 대화 안에서 돈다(ai_brain._word_chain_turn). 원래는
# "끝말잇기 하자" 하면 다이아가 곧바로 첫 낱말을 냈다. 이제 화면이
# 가위바위보로 선공을 정한 뒤 여기서 판을 연다. 사람이 먼저면 첫
# 낱말을 기다린다 — 앞 낱말이 비어 있으면 아무 글자로나 시작한다.
# ============================================================

@bp.route("/api/wordchain/state")
def wordchain_state_api():
    from ai_brain import _wc_load

    return jsonify({"ok": True, "on": bool(_wc_load().get("on"))})


@bp.route("/api/wordchain/new", methods=["POST"])
def wordchain_new_api():
    from system.games import word_chain as WC
    from ai_brain import _wc_save

    try:
        data = request.get_json(silent=True) or {}
        stage = _go_stage()
        level = GAMES.wc_level().get("key", "normal")

        if data.get("first") == "you":
            _wc_save({"on": True, "last": "", "used": [], "level": level})
            say = GAMES.wc_say("open_you", stage)
            print("[끝말잇기]: 시작 — 사람이 먼저")
        else:
            word = WC.pick(None, set(), level)

            if not word:
                return jsonify({"ok": False, "error": "낼 낱말이 없습니다."}), 500

            _wc_save({"on": True, "last": word, "used": [word],
                      "level": level})
            say = GAMES.wc_say("open", stage, word=word)
            print(f"[끝말잇기]: 시작 — {word}")

        _log_line("assistant", say.get("line"))

        return jsonify({"ok": True, "on": True,
                        "reply": say.get("line"),
                        "expression": say.get("expression"),
                        "motion": say.get("motion")})

    except Exception as e:
        print(f"[끝말잇기 새 판 오류]: {e}")
        return jsonify({"ok": False, "error": str(e)[:120]}), 500



@bp.route("/api/chess/start", methods=["POST"])
def chess_start_api():
    """판을 열기 전에 선공부터 가위바위보로 정한다.

    바로 판을 열지 않는다. 여기서는 '가위바위보로 정하자' 고 말만 하고,
    실제 판은 손을 낸 뒤(/api/chess/rps)에 열린다.
    """

    _chess_clear()

    stage = _chess_stage()

    d = memory_manager.load_memory_data()
    d["chess"] = {
        "deciding": True,
        "level": (d.get("chess") or {}).get("level")
                 or GAMES.chess().get("level", "normal"),
    }
    memory_manager.save_memory_data(d)

    said = GAMES.chess_first_say("ask", stage)

    if said.get("line"):
        try:
            memory_manager.append_message("assistant", said["line"])
        except Exception as e:
            print("[선공 정하기 기록 실패]:", e)

    return jsonify({
        "ok": True,
        "playing": False,
        "deciding": True,
        "hands": GAMES.rps_hands(),
        "line": said.get("line"),
        "expression": said.get("expression"),
    })


@bp.route("/api/chess/rps", methods=["POST"])
def chess_rps_api():
    """선공을 가리는 가위바위보 한 판.

    이긴 사람이 고른다.
      다이아가 이기면  자기가 선공(흰 말)을 가져가고 판이 바로 열린다.
      사람이 이기면    고르라고 하고 기다린다.
      비기면           다시 낸다.
    """

    data = request.get_json(silent=True) or {}

    g = _chess_load() or {}

    if not g.get("deciding"):
        return jsonify({"ok": False, "error": "선공을 정하는 중이 아닙니다."})

    saved = memory_manager.load_relationship() or {}
    affinity = saved.get("affinity",
                         AVATAR.relationship.get("start_affinity", 0))
    stage = _stage_now(affinity, saved.get("stage"))

    result = GAMES.rps_play(data.get("hand"), stage=stage, affinity=affinity)

    if result is None:
        return jsonify({"ok": False, "error": "가위바위보에 없는 손입니다."})

    _rps_tally(result.get("result"))

    # 놀았다는 사실은 남긴다. 선공을 가리는 판도 같이 논 것이다.
    try:
        memory_manager.append_message(
            "user",
            f"(선공 가위바위보 - 나는 {result['you_label']}, "
            f"다이아는 {result['mine_label']})")
    except Exception as e:
        print("[선공 가위바위보 기록 실패]:", e)

    out = {
        "ok": True,
        "deciding": True,
        "playing": False,
        "hands": GAMES.rps_hands(),
        "motion": result.get("motion"),      # 다이아가 낸 손
        "you_hand": result.get("you"),
        "dia_hand": result.get("mine"),
        "you_label": result.get("you_label"),
        "dia_label": result.get("mine_label"),
        # result 는 다이아 기준이다. win 이면 다이아가 이겼다.
        "result": result.get("result"),
    }

    # 이 판의 승패로만 가른다. 친밀도는 안 건드린다 -
    # 선공을 정하는 것이지 놀이로 사이가 오가는 자리가 아니다.
    if result.get("result") == "draw":
        said = GAMES.chess_first_say("tie", stage)
        out.update(line=said.get("line"), expression=said.get("expression"))

    elif result.get("result") == "win":
        # 다이아가 이겼다. 선공을 가져간다 = 다이아가 흰 쪽.
        said = GAMES.chess_first_say("dia_won", stage)
        out.update(line=said.get("line"), expression=said.get("expression"))

        view = _chess_open("black", g.get("level"))
        view["line"] = said.get("line")
        view["expression"] = said.get("expression")
        view["deciding"] = False
        view["motion"] = result.get("motion")
        out = view

    else:
        # 사람이 이겼다. 고르라고 하고 기다린다.
        said = GAMES.chess_first_say("you_won", stage)
        out.update(line=said.get("line"), expression=said.get("expression"),
                   choose=True)

        d = memory_manager.load_memory_data()
        d["chess"] = dict(g, deciding=True, choose=True)
        memory_manager.save_memory_data(d)

    if out.get("line"):
        try:
            memory_manager.append_message("assistant", out["line"])
        except Exception as e:
            print("[선공 가위바위보 기록 실패]:", e)

    return jsonify(out)


def _chess_open(you, level=None):
    """실제로 판을 연다. 사람이 잡는 쪽을 받는다."""

    import chess

    dia_color = chess.BLACK if you == "white" else chess.WHITE

    board = chess.Board()

    level = level or _chess_level_key()

    _chess_save(board, dia_color, level)

    extra = {}

    if board.turn == dia_color:
        move, _ = _chess_pick(board)

        if move:
            board.push(move)
            extra["dia_move"] = move.uci()

    _chess_save(board, dia_color, level)

    view = _chess_view(board, dia_color, None, extra)
    view["playing"] = True
    view["deciding"] = False

    return view


@bp.route("/api/chess/level", methods=["POST"])
def chess_level_api():
    """난이도를 바꾼다. 두던 판은 그대로 두고 다음 수부터 달라진다."""

    data = request.get_json(silent=True) or {}

    want = str(data.get("level") or "").strip()

    lv = GAMES.chess_level(want)

    board, dia_color = _chess_board()

    if board is None:
        # 판이 없으면 다음에 열 때 쓰도록 적어만 둔다
        d = memory_manager.load_memory_data()
        d["chess"] = dict(d.get("chess") or {}, level=lv["key"])
        memory_manager.save_memory_data(d)

        return jsonify({"ok": True, "playing": False, "level": lv["key"]})

    _chess_save(board, dia_color, lv["key"])

    return jsonify(_chess_view(board, dia_color))


@bp.route("/api/chess/resign", methods=["POST"])
def chess_resign_api():
    """그만둔다."""

    _chess_clear()

    return jsonify({
        "ok": True,
        "playing": False,
        **_chess_reply("resign"),
    })

