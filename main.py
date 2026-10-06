
# main.py
# diamondAI - Flask 서버 메인 실행 파일

import json
import os
import secrets
import threading
import time
from datetime import timedelta

from flask import (
    Flask,
    jsonify,
    redirect,
    render_template,
    request,
    session
)

import accounts
import config
import memory_manager
import store
import who
from ai_brain import extract_expression, process_chat
from dia.mind import VOICE_HEAD
from avatar import AVATAR
from memory_manager import (
    load_memory,
    clear_memory
)


# 사이(관계 단계)는 다이아가 정한다.
from dia.relation import stage_label as _stage_label  # noqa: E402
from dia.relation import stage_now as _stage_now  # noqa: E402

# 놀이는 시스템 쪽이다.
from system.games import GAMES  # noqa: E402
from system.world import WORLD  # noqa: E402
from system.world_state import (  # noqa: E402
    SLOT_LABEL,
    SLOT_ORDER,
    _places_now,
    _place_here,
    _scene_now,
    _scene_set,
    _scene_update,
    _wardrobe_items,
    _slot_of,
    _wardrobe_now,
    _worn_map,
    _worn_now,
)

app = Flask(__name__)





# ============================================================
# 누구인가
#
# 계정을 나누기 전에는 기억 파일이 하나뿐이라 누가 들어오든
# 같은 기억을 이어 썼다. 내가 쌓은 친밀도를 남이 물려받고
# 내가 나눈 이야기를 남이 읽었다.
#
# 여기서 하는 일은 두 가지뿐이다.
#   1. 쿠키에 적힌 아이디를 읽어 who 에 적는다
#   2. 로그인하지 않았으면 들여보내지 않는다
#
# 기억을 실제로 가르는 것은 memory_manager 쪽이다. 이 파일은
# '누구인지' 만 알려 준다.
# ============================================================

# 쿠키에 서명할 열쇠.
#
# 매번 새로 만들면 서버를 다시 켤 때마다 모두 로그아웃된다.
# 그래서 한 번 만들어 파일에 두고 다음부터는 그것을 읽는다.
# 이 파일이 새면 남의 쿠키를 지어낼 수 있으므로 저장소에 올리지 않는다.
def _secret_key():
    # 올린 데서는 파일이 안 남는다. 기계가 바뀔 때마다 열쇠가 새로 생기면
    # 그때마다 모두 로그아웃된다. 그래서 환경변수를 먼저 본다.
    env = os.environ.get("SECRET_KEY", "").strip()

    if len(env) >= 32:
        return env

    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".secret_key")

    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                key = f.read().strip()
            if len(key) >= 32:
                return key
        except OSError:
            pass

    key = secrets.token_hex(32)

    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(key)
    except OSError as e:
        # 읽기 전용인 데서는 못 쓴다. 그래도 이번 판은 돌아간다 —
        # 다만 기계가 바뀌면 로그인이 풀리므로 SECRET_KEY 를 넣어야 한다.
        print("[열쇠 저장 실패]:", e)
        print("[알림] SECRET_KEY 환경변수를 넣으면 로그인이 유지됩니다.")

    return key


app.secret_key = _secret_key()

# 로그인한 채로 두는 기간. 창을 닫아도 유지된다.
app.permanent_session_lifetime = timedelta(days=30)


# 로그인 없이 지나갈 수 있는 자리.
#
# 로그인 화면 자체와, 로그인하려고 부르는 것들.
# 여기 빠진 것은 전부 막힌다 — 새 API 를 만들 때 따로 챙길 일이 없다.
OPEN_PATHS = {
    "/api/health",
    "/login",
    "/api/login",
    "/api/signup",
    "/api/whoami",

    # 홈 화면에 얹을 때 쓰는 것 셋.
    #
    # **로그인 전에 읽힌다** — 로그인 화면에서 '홈 화면에 추가' 를
    # 누르는 자리라서다. 막아 두면 302 가 돌아와 앱처럼 열리지 않고
    # 아이콘도 안 붙는다.
    #
    # 여는 것은 이 셋뿐이다. 아바타(static/*.vrm)는 그대로 막힌다 —
    # 파일 안에 Redistribution_Prohibited 가 박혀 있는 물건이다.
    "/static/app/manifest.webmanifest",
    "/static/app/icon-192.png",
    "/static/app/icon-512.png",
}


def current_user():
    """지금 들어와 있는 사람의 아이디. 없으면 None."""

    return session.get("user")


@app.before_request
def _bind_user():
    """요청마다 '지금 누구인가' 를 정한다.

    **반드시 요청마다** — 스레드는 다시 쓰이므로, 안 정하면
    앞사람의 자리가 그대로 남아 남의 기억을 쓰게 된다.
    """

    path = request.path or "/"

    user = session.get("user")
    slot = session.get("slot")

    # 쿠키는 남았는데 계정이 사라진 경우(파일을 지웠다든지).
    # 없는 사람의 기억을 열지 않도록 여기서 끊는다.
    if user and accounts.slot_of(user) != slot:
        session.clear()
        user = None
        slot = None

    who.set_current(slot)

    # 이번 요청 동안 읽은 것을 담아 둘 자리를 연다.
    #
    # **반드시 요청마다** — 안 열고 지나가면 앞 요청의 값이 남아
    # 남의 기억을 읽는다. who.set_current 와 같은 자리에 둔 이유다.
    store.begin_request()

    if user:
        return None

    # /static/ 도 막는다.
    #
    # 거기 있는 것은 아바타 파일과 배경뿐이다. 로그인 화면은 제 안에
    # 글씨와 색을 다 갖고 있어서 static 이 필요 없다.
    #
    # 열어 두면 주소만 알면 누구나 아바타를 통째로 내려받는다.
    # 파일 안에 Redistribution_Prohibited 가 박혀 있는 물건이다.
    # 막아 두면 계정이 있는 사람만 받을 수 있고, 계정은 가입 암호를
    # 아는 사람만 만든다.
    if path in OPEN_PATHS:
        return None

    # API 는 화면을 돌려줄 데가 없으므로 숫자로 답한다.
    if path.startswith("/api/"):
        return jsonify({"ok": False, "error": "로그인이 필요합니다."}), 401

    return redirect("/login")


# ============================================================
# 로그인 화면
# ============================================================

# ============================================================
# 놀이 — system/games/routes.py
#
# 판 규칙·선공 가위바위보·한 판 더는 시스템이 쥔다. 여기서는 붙이기만 한다.
# 로그인 검사(before_request)는 청사진에도 그대로 걸린다.
# ============================================================

from system.games.routes import bp as _games_bp  # noqa: E402
from system.games.routes import _again, _log_line  # noqa: E402

app.register_blueprint(_games_bp)

@app.route("/login")
def login_page():
    if current_user():
        return redirect("/")

    return render_template(
        "login.html",
        first=(accounts.count() == 0),
        legacy=memory_manager.legacy_summary(),
        need_code=bool(os.environ.get("SIGNUP_CODE", "").strip()),
    )


@app.after_request
def _save_changes(response):
    """이번 요청에서 바뀐 것을 실제로 적는다.

    teardown 이 아니라 여기서 한다 — teardown 은 답을 이미 보낸 뒤에
    돌 수 있어서, 올린 데에서는 그때 기계가 멈춰 있을 수 있다.
    """

    try:
        store.flush()
    except Exception as e:
        print("[저장 실패]", e)

    return response


@app.teardown_request
def _unbind_user(exc=None):
    """요청이 끝나면 담아 둔 것을 버린다.

    스레드는 다시 쓰이므로 두고 가면 다음 사람이 그것을 읽는다.
    """

    store.end_request()


@app.route("/api/health")
def health_api():
    """올린 것이 제대로 실렸는지.

    아바타 파일이 짐에서 조용히 빠지는 일이 있었다. 빌드 캐시를 쓰는
    배포에서 static/ 이 통째로 안 실렸는데, 화면은 멀쩡히 뜨고
    **다이아만 없었다.** 눈으로는 로그인해서 들어가 봐야 알 수 있다.
    그래서 파일이 있는지만 알려 주는 자리를 둔다.

    파일 내용은 안 준다. 있는지 없는지만 말한다.
    """

    here = os.path.dirname(os.path.abspath(__file__))

    def has(rel):
        return os.path.exists(os.path.join(here, rel))

    # 어느 판이 올라와 있는가.
    #
    # 종료 코드만 믿으면 안 된다. 올라갔는데 실패라고 하기도 하고,
    # 빌드 캐시 때문에 아바타가 빠졌는데 성공이라고 하기도 한다.
    # 올리기 전에 적어 둔 표를 그대로 돌려주면, 올린 쪽이 방금 그것이
    # 맞는지 눈으로 확인할 수 있다.
    build = None

    try:
        with open(os.path.join(here, "build.json"), encoding="utf-8") as f:
            build = json.load(f).get("stamp")
    except Exception:
        pass

    return jsonify({
        "ok": True,
        "build": build,
        "avatar": has("static/avatar.vrm"),
        "body": has("static/body.vrm"),
        # 짐에 실제로 실린 옷 벌 수. 한글 이름 옷이 빠져 0 이었던 적이 있다.
        "wardrobe": len(_wardrobe_items()),
        "store": store.backend(),
        "model_set": bool((store.read_json(config.RUNTIME_KEY) or {})
                          .get("ollama_url")),
    })


@app.route("/api/whoami")
def whoami_api():
    """지금 누구로 들어와 있는가. 화면이 물어본다."""

    user = current_user()

    if not user:
        return jsonify({"ok": True, "user": None})

    return jsonify({
        "ok": True,
        "user": accounts.display_name(user),
        "slot": session.get("slot"),
    })


@app.route("/api/signup", methods=["POST"])
def signup_api():
    """계정을 만든다.

    새 계정은 **빈 기억**으로 시작한다. 앞사람이 무엇을 했든
    모르는 상태에서 만난다 — 이것이 계정을 나눈 이유다.
    다만 맨 처음 만드는 계정 하나는 계정을 나누기 전에 쌓인
    기억을 물려받는다. 그러지 않으면 그동안의 관계가 손 닿지
    않는 데로 밀려난다.
    """

    data = request.get_json(silent=True) or {}

    user_id = str(data.get("id") or "").strip()
    password = str(data.get("password") or "")
    again = str(data.get("again") or "")

    if again and again != password:
        return jsonify({"ok": False, "error": "비밀번호가 서로 다릅니다."})

    # 아무나 들어오지 못하게.
    #
    # 내 컴퓨터에서만 돌 때는 필요 없었다. 밖에 올리면 주소를 아는
    # 사람은 누구나 계정을 만들 수 있으므로, SIGNUP_CODE 를 넣어 두면
    # 그것을 아는 사람만 만들 수 있다. 안 넣으면 지금까지와 같다.
    need = os.environ.get("SIGNUP_CODE", "").strip()

    if need and str(data.get("code") or "").strip() != need:
        return jsonify({"ok": False, "error": "가입 암호가 맞지 않습니다."})

    first = accounts.count() == 0

    ok, msg, slot = accounts.create(user_id, password)

    if not ok:
        return jsonify({"ok": False, "error": msg})

    inherited = False

    if first:
        inherited = memory_manager.inherit_legacy(slot)

    if not inherited:
        memory_manager.start_fresh(slot)

    session.permanent = True
    session["user"] = user_id
    session["slot"] = slot
    who.set_current(slot)

    accounts.touch_login(user_id)

    return jsonify({
        "ok": True,
        "user": accounts.display_name(user_id),
        "inherited": inherited,
    })


@app.route("/api/login", methods=["POST"])
def login_api():
    """들어온다. 그 사람이 쌓아 둔 기억이 그대로 열린다."""

    data = request.get_json(silent=True) or {}

    user_id = str(data.get("id") or "").strip()
    password = str(data.get("password") or "")

    slot = accounts.verify(user_id, password)

    # 아이디가 틀렸는지 비밀번호가 틀렸는지 알려 주지 않는다.
    # 알려 주면 어느 아이디가 있는지를 하나씩 확인할 수 있다.
    if slot is None:
        return jsonify({"ok": False, "error": "아이디나 비밀번호가 맞지 않습니다."})

    session.permanent = True
    session["user"] = user_id
    session["slot"] = slot
    who.set_current(slot)

    accounts.touch_login(user_id)

    return jsonify({"ok": True, "user": accounts.display_name(user_id)})


@app.route("/api/logout", methods=["POST"])
def logout_api():
    """나간다. 기억은 그대로 남는다 — 다음에 들어오면 이어진다."""

    session.clear()
    who.clear()

    return jsonify({"ok": True})


# ============================================================
# 메인 페이지
# ============================================================

def _js_ver():
    """화면 스크립트(static/js)의 지문. 파일을 고치면 바뀐다.

    스크립트를 파일로 나눈 뒤로는 브라우저가 옛 파일을 붙들고 있을 수
    있어서, 주소 끝에 ?v= 로 붙여 고친 것이 바로 가게 한다.
    """
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "static", "js")
    newest = 0

    for dirpath, _dirs, names in os.walk(root):
        for n in names:
            if n.endswith(".js"):
                newest = max(newest, os.path.getmtime(os.path.join(dirpath, n)))

    return str(int(newest))


@app.route("/")
def index():
    return render_template(
        "index.html",
        js_ver=_js_ver(),
    )


# ============================================================
# AI 채팅 API
# ============================================================

@app.route(
    "/api/chat",
    methods=["POST"]
)
def chat_api():

    try:

        data = request.get_json(
            silent=True
        )

        if not isinstance(
            data,
            dict
        ):
            return jsonify(
                {
                    "error":
                    "잘못된 요청입니다."
                }
            ), 400

        user_text = data.get(
            "message",
            ""
        )

        if user_text is None:
            user_text = ""

        user_text = str(
            user_text
        ).strip()

        if not user_text:

            return jsonify(
                {
                    "error":
                    "메시지가 비어있습니다."
                }
            ), 400

        # 끝말잇기가 이 말로 끝났는지 보려고 앞뒤를 잰다
        try:
            from ai_brain import _wc_load
            wc_was = bool(_wc_load().get("on"))
        except Exception:
            wc_was = False

        # 첫 문장의 목소리를 답과 나란히 만든다(dia.mind.VOICE_HEAD).
        # 모델이 첫 문장을 끝내는 순간 소리 만들기를 시작해서, 답이 다
        # 오는 것과 거의 같이 끝난다. 화면은 받자마자 튼다.
        head = _VoiceHead.open(data.get("voice_id"))
        token = VOICE_HEAD.set(head.start)

        # 카메라가 켜져 있으면 화면이 '지금 보이는 것' 을 같이 보낸다.
        # 그러면 말을 걸 때마다 다이아가 상대를 보면서 답한다.
        try:
            result = process_chat(
                user_text,
                seeing=(data.get("seeing") or None),
                cut_off=bool(data.get("cut_off")),
                woke=bool(data.get("woke")),
            )
        finally:
            VOICE_HEAD.reset(token)
            head.finish()

        got = head.result()
        if got:
            result["voice_head"] = got

        # 답에 (배경: 공원) · (옷: 교복) 이 섞여 있으면 실제로 옮기고 갈아입는다
        result = _apply_shoot(_apply_song(_apply_wear(_apply_place(result))))

        # 끝말잇기 판이 켜져 있는지 화면에 알린다. 화면은 이것을 보고
        # "끝말잇기 하자" 를 선공 가위바위보로 받을지 정한다.
        #
        # 이 말로 판이 끝났으면(그만하자고 한 것이 아니라 승부가 났으면)
        # 한 판 더 할지 묻는다.
        try:
            wc_now = bool(_wc_load().get("on"))
            result["word_chain_on"] = wc_now

            if (wc_was and not wc_now
                    and not GAMES.wc_stop(user_text)
                    and isinstance(result.get("reply"), str)):
                _log_line("assistant", _again(result, "word_chain"))
        except Exception as e:
            print(f"[끝말잇기 한 판 더 오류]: {e}")

        return jsonify(
            result
        )

    except Exception as e:

        print(
            f"[채팅 API 오류]: {e}"
        )

        return jsonify(
            {
                "expression":
                "neutral",

                "reply":
                "앗, 잠깐 문제가 생겼어. 다시 말해줄래?"
            }
        ), 500


# ============================================================
# 대화 기록 조회 API
# ============================================================

# ============================================================
# 다이아의 반응 — 판에서 일어난 일에
#
# 놀이 경로가 답에 "event" 를 실어 보내면 화면이 그것을 이리로 돌려준다.
# 판은 기다리지 않고 먼저 움직이고, 다이아의 말은 조금 뒤에 온다.
# 화면이 준 사건은 믿지 않는다 — 놀이 이름과 일의 종류만 받아 서버 표로
# 다시 짓는다(events.rebuild).
# ============================================================

@app.route("/api/dia/heart", methods=["GET"])
def dia_heart_api():
    """다이아의 지금 마음 — 몸(얼굴)이 쉬는 동안 지을 표정을 정하는 데 쓴다."""
    from dia import mind as MIND
    try:
        return jsonify({"ok": True, "feel": MIND.heart_view()})
    except Exception as e:
        print(f"[마음 읽기 오류]: {e}")
        return jsonify({"ok": False, "feel": None})


@app.route("/api/dia/react", methods=["POST"])
def dia_react_api():
    from dia import mind as MIND
    from system.games import events as EV

    data = request.get_json(silent=True) or {}
    ev = EV.rebuild(data.get("event"))

    if ev is None:
        return jsonify({"ok": False, "error": "그런 일은 없습니다."}), 400

    got = MIND.react(ev)

    if not got.get("ok"):
        return jsonify({"ok": False, "why": got.get("why")})

    return jsonify({
        "ok": True,
        "reply": got["reply"],
        "expression": got["expression"],
        "cues": got["cues"],
        "feel": got.get("feel"),
        "event": {"game": ev["game"], "kind": ev["kind"]},
    })


@app.route(
    "/api/history",
    methods=["GET"]
)
def history_api():

    try:

        history = load_memory()

        return jsonify(
            history
        )

    except Exception as e:

        print(
            f"[기억 조회 오류]: {e}"
        )

        return jsonify(
            {
                "error":
                "기억을 불러올 수 없습니다."
            }
        ), 500


# ============================================================
# 기억 삭제 API
# ============================================================

@app.route(
    "/api/memory/clear",
    methods=["POST"]
)
def clear_memory_api():

    try:

        clear_memory()

        print(
            "[diamondAI] 대화 기억이 초기화되었습니다."
        )

        return jsonify(
            {
                "success": True,
                "message":
                "이전 대화 기억을 모두 지웠어. 이제 새로 시작하자!"
            }
        )

    except Exception as e:

        print(
            f"[기억 삭제 오류]: {e}"
        )

        return jsonify(
            {
                "success": False,
                "error":
                "기억 삭제 중 오류가 발생했어."
            }
        ), 500


# ============================================================
# 아바타 개체 API
#
# 페르소나와 아바타가 하나의 개체가 되면서,
# 서버와 화면이 같은 정의를 공유할 수 있게 되었다.
# 화면은 더 이상 표정 수치를 스스로 들고 있을 필요가 없다.
# ============================================================

@app.route(
    "/api/avatar",
    methods=["GET"]
)
def avatar_api():

    try:

        # 다이아(마음과 몸)에 놀이 설정(시스템)을 붙여 준다.
        # 화면은 예전처럼 ENTITY.game 으로 읽는다.
        d = AVATAR.to_dict()
        d["game"] = GAMES.to_dict()
        # 장소·옷장·꾸미기·장면 설정(시스템)도 예전 자리(model)에 붙인다
        d["model"] = {**(d.get("model") or {}), **WORLD.model}

        return jsonify(d)

    except Exception as e:

        print(
            f"[아바타 조회 오류]: {e}"
        )

        return jsonify(
            {
                "error":
                "아바타 정보를 불러올 수 없습니다."
            }
        ), 500


@app.route(
    "/api/avatar/prompt",
    methods=["GET"]
)
def avatar_prompt_api():
    """아바타가 자기 페르소나로 만들어내는 시스템 프롬프트."""

    try:

        want_guide = request.args.get(
            "guide",
            ""
        ).lower() in ("1", "true", "yes")

        return jsonify(
            {
                "with_expression_guide": want_guide,

                "prompt":
                AVATAR.system_prompt(
                    include_expression_guide=want_guide
                ),
            }
        )

    except Exception as e:

        print(
            f"[프롬프트 조회 오류]: {e}"
        )

        return jsonify(
            {
                "error":
                "프롬프트를 만들 수 없습니다."
            }
        ), 500


@app.route(
    "/api/expression/detect",
    methods=["POST"]
)
def detect_expression_api():
    """문장을 넣으면 아바타가 어떤 표정을 짓게 되는지 알려준다.

    Ollama를 거치지 않으므로 감정 판단만 따로 시험해볼 수 있다.
    """

    try:

        data = request.get_json(
            silent=True
        )

        if not isinstance(
            data,
            dict
        ):
            return jsonify(
                {
                    "error":
                    "잘못된 요청입니다."
                }
            ), 400

        text = str(
            data.get("text", "")
        )

        expression, clean_text = extract_expression(
            text
        )

        return jsonify(
            {
                "expression": expression,
                "clean_text": clean_text,
            }
        )

    except Exception as e:

        print(
            f"[표정 판단 오류]: {e}"
        )

        return jsonify(
            {
                "error":
                "표정을 판단할 수 없습니다."
            }
        ), 500


@app.route(
    "/api/relationship",
    methods=["GET"]
)
def relationship_api():
    """지금 유저와 어떤 사이인지."""

    try:

        from memory_manager import load_relationship

        saved = load_relationship() or {}

        affinity = saved.get(
            "affinity",
            AVATAR.relationship.get("start_affinity", 0)
        )

        stage = _stage_now(
            affinity,
            saved.get("stage")
        )

        import time as _t
        from memory_manager import load_mood

        _m = load_mood()
        mood = AVATAR.mood_now(_m.get("raw", 0), _m.get("since"), _t.time())
        mood_tier = AVATAR.mood_tier(mood)

        return jsonify(
            {
                "affinity": affinity,
                "stage": stage.key,
                "label": _stage_label(stage),
                "speech": stage.speech,
                "attitude": stage.attitude,
                # 사귀는 사이인가
                "lover": bool(saved.get("lover", False)),
                # 같은 친구라도 오늘은 어떤 온도인가
                "warmth": AVATAR.warmth_label(affinity),
                "ceiling": AVATAR.confess_ceiling(),
                # 지금 상해 있는가
                "mood": mood,
                "mood_label": mood_tier.get("label") if mood_tier else None,
                "mood_expression": (mood_tier.get("expression")
                                    if mood_tier else None),
            }
        )

    except Exception as e:

        print(
            f"[관계 조회 오류]: {e}"
        )

        return jsonify(
            {
                "error":
                "관계 정보를 불러올 수 없습니다."
            }
        ), 500


@app.route(
    "/api/touch",
    methods=["POST"]
)
def touch_api():
    """마우스로 아바타를 만졌을 때의 반응.

    화면은 '어느 본에 가장 가까운 곳을 눌렀는가' 만 보낸다.
    그 자리가 어디인지, 만져도 되는 사이인지, 무슨 말을 할지는
    전부 아바타 개체가 정한다.

    받는 값:
      bone   : 닿은 지점에서 가장 가까운 본 이름
      local  : 그 본의 좌표계에서의 닿은 위치 [x, y, z] (머리 나누기에 쓴다)
      kind   : "tap" 한 번 누름 / "pet" 쓰다듬기 / "kiss" 입맞춤
      count  : 쓰다듬은 횟수
    """

    try:

        import time

        from memory_manager import (
            append_message,
            load_relationship,
            save_relationship,
            load_mood,
            save_mood,
        )

        data = request.get_json(silent=True) or {}

        bone = data.get("bone")
        local = data.get("local")
        kind = "pet" if data.get("kind") == "pet" else "tap"

        # 화면은 '눈을 감고 기다리는 중이었다' 만 알려준다(kiss_ready).
        # 그것이 정말 입맞춤인지는 아래에서 자리와 도구를 안 뒤에 정한다 —
        # 어느 자리를 만졌는지 아는 쪽은 화면이 아니라 여기다.
        kiss_ready = bool(data.get("kiss_ready"))
        count = int(data.get("count") or 1)

        saved = load_relationship() or {}

        affinity = saved.get(
            "affinity",
            AVATAR.relationship.get("start_affinity", 0)
        )

        stage = _stage_now(
            affinity,
            saved.get("stage")
        )

        tool = AVATAR.touch_tool(data.get("tool"))

        # 옷 판정구는 자기가 어느 자리인지 직접 들고 온다.
        # 다만 잡는 도구가 아니면 무시하고 안쪽 몸으로 넘어간다.
        #
        # 벗겨 둔 옷이면 그 자리는 없는 것으로 친다. 없는 옷을
        # 잡을 수는 없으므로 안쪽 몸으로 넘긴다.
        _zone_key = data.get("zone")

        _undressed = data.get("undressed")
        if isinstance(_undressed, list) and _zone_key in _undressed:
            _zone_key = None

        zone = AVATAR.zone_for(
            bone,
            local,
            zone_key=_zone_key,
            tool=tool,
        )

        if zone is None:
            return jsonify(
                {
                    "hit": False,
                    "bone": bone,
                }
            )

        # 기다리고 있었고, 그 도구로 그 자리를 만졌다면 입맞춤이다.
        # 셋 중 하나라도 어긋나면 평소대로 누른 것이 된다.
        if kiss_ready and kind == "tap":
            kc = AVATAR.touch.get("kiss", {})
            if (kc.get("enabled")
                    and tool is not None
                    and tool.key == kc.get("tool")
                    and zone.key == kc.get("zone")):
                kind = "kiss"

        # 만진 자리와 사이로 반응을 정한다.
        #
        # 이 줄이 2026-09-16(307253a)에 벗기기 쪽과 같이 지워져서, 그 뒤로
        # 만질 때마다 아래에서 'result' 가 없다고 500 이 났다. 화면은 경고만
        # 찍고 아무 반응도 안 해서 터치가 사라진 것처럼 보였다(2026-09-28).
        # 입맞춤 판정 뒤라야 kind 가 "kiss" 로 바뀐 것이 반영된다.
        result = AVATAR.touch_reaction(
            zone,
            kind,
            stage,
            affinity,
            count=count,
            tool=tool,
        )

        if result is None:
            return jsonify({"hit": False, "bone": bone})

        # 기분을 풀거나 상하게 한다.
        #
        # 쓰다듬으면 풀리고, 아직 허락 안 된 곳을 만지면 더 상한다.
        # 다정한 자리(머리·얼굴·손)일수록 많이 풀린다.
        now = time.time()
        saved_mood = load_mood()
        mood_before = AVATAR.mood_now(
            saved_mood.get("raw", 0), saved_mood.get("since"), now)

        mood_after = mood_before
        if mood_before > 0 or not result["allowed"]:
            delta = AVATAR.mood_soothe(zone.key, result["allowed"])
            mood_after = AVATAR.mood_clamp(mood_before - delta)

            if mood_after != mood_before:
                save_mood(mood_after, now)
                print(f"[기분]: {mood_before} -> {mood_after} "
                      f"({zone.label or zone.key}, {delta:+d})")

        # 기분이 풀렸으면 그 말을 앞세운다.
        # 자리마다 정해 둔 대사보다 이쪽이 지금 상황에 맞는 말이다.
        eased = AVATAR.mood_reply(mood_after, mood_before, stage)
        if eased:
            result["reply"] = eased["reply"]
            if eased.get("expression"):
                result["expression"] = eased["expression"]
            if eased.get("motion"):
                result["motion"] = eased["motion"]
            result["mood_eased"] = True

        result["mood"] = mood_after
        tier = AVATAR.mood_tier(mood_after)
        result["mood_label"] = tier.get("label") if tier else None

        # 친밀도를 옮기고 단계를 다시 본다
        before = stage.key

        # 몇 점 깎는 것으로 끝나지 않는 자리가 있다.
        # 그때는 개체가 '어느 값까지 떨어질지'를 직접 알려준다.
        # 얀데레처럼 더는 식지 않는 단계라면 그것도 깎이지 않는다.
        drop_to = result.get("affinity_to")

        if drop_to is not None and not getattr(stage, "never_falls", False):
            affinity = AVATAR.clamp_affinity(drop_to)
            print(f"[만지기]: 허락되지 않은 자리 — 친밀도를 {affinity} 로 떨어뜨립니다.")
        else:
            lover = bool(saved.get("lover", False))

            affinity = AVATAR.apply_delta(
                affinity,
                result["affinity_delta"],
                stage,
                lover=lover,
            )

        stage = _stage_now(affinity, before)

        try:
            save_relationship(affinity, stage.key, 0,
                              bool(saved.get("lover", False)))
        except Exception as e:
            print(f"[만지기 관계 저장 오류]: {e}")

        # 기록에 남길 만한 것만 남긴다.
        # 쓰다듬는 동안 매 순간을 다 적으면 대화 기록이 이것만으로 찬다.
        remember = (kind == "tap") or (count <= 1) or (not result["allowed"])

        # 이름을 내지 않는 자리는 기록에도 남기지 않는다.
        # 이름이 없으니 "(를 만졌다)" 같은 빈 줄이 남게 된다.
        if zone.hidden:
            remember = False

        if remember and result["reply"]:
            try:
                # 자리마다 도구 이름이 달라진다.
                # 손가락은 입과 보지에서 다른 것이 된다 — 기록에도
                # 그렇게 적어야 한다. 모델이 읽는 것은 기록이라,
                # 여기에 '손가락' 이라 적으면 나중에 물었을 때
                # 손가락이었다고 답한다.
                name = tool.label_for(zone.key) if tool else ""
                how = f"{tool.with_ro(name)} " if tool and tool.key != "hand" else ""
                append_message(
                    "user", f"({how}{tool.with_eul(zone.label)} 만졌다)")
                append_message("assistant", result["reply"])
            except Exception as e:
                print(f"[만지기 기록 오류]: {e}")

        result.update(
            {
                "hit": True,
                "bone": bone,
                "affinity": affinity,
                "stage": stage.key,
                "stage_label": _stage_label(stage),
                "changed_from": before if before != stage.key else None,
            }
        )

        return jsonify(result)

    except Exception as e:

        print(
            f"[만지기 오류]: {e}"
        )

        return jsonify(
            {
                "hit": False,
                "error": "반응을 만들지 못했습니다."
            }
        ), 500


@app.route(
    "/api/memory/archive",
    methods=["POST"]
)
def memory_archive_api():
    """지금까지의 기억을 옆에 치워 두고 빈 상태에서 새로 시작한다.

    지우는 것이 아니라 옮기는 것이다. /api/memory/restore 로 다시 꺼낸다.
    """

    try:

        from memory_manager import archive_memory

        name, count = archive_memory()

        stage = _stage_now(
            AVATAR.relationship.get("start_affinity", 0)
        )

        print(f"[기억 보관]: {name} ({count}개)")

        return jsonify(
            {
                "ok": True,
                "name": name,
                "messages": count,
                "affinity": AVATAR.relationship.get("start_affinity", 0),
                "stage": stage.key,
                "stage_label": _stage_label(stage),
            }
        )

    except Exception as e:

        print(f"[기억 보관 오류]: {e}")

        return jsonify(
            {"ok": False, "error": "기억을 보관하지 못했습니다."}
        ), 500


@app.route(
    "/api/memory/restore",
    methods=["POST"]
)
def memory_restore_api():
    """치워 뒀던 기억을 다시 꺼내 온다."""

    try:

        from memory_manager import (
            list_archives,
            load_relationship,
            restore_memory,
        )

        data = request.get_json(silent=True) or {}
        got = restore_memory(data.get("name"))

        if got is None:
            return jsonify(
                {
                    "ok": False,
                    "error": "보관해 둔 기억이 없습니다.",
                    "archives": list_archives(),
                }
            ), 404

        name, count = got

        saved = load_relationship() or {}
        affinity = saved.get(
            "affinity",
            AVATAR.relationship.get("start_affinity", 0)
        )
        stage = _stage_now(affinity, saved.get("stage"))

        print(f"[기억 꺼냄]: {name} ({count}개)")

        return jsonify(
            {
                "ok": True,
                "name": name,
                "messages": count,
                "affinity": affinity,
                "stage": stage.key,
                "stage_label": _stage_label(stage),
            }
        )

    except Exception as e:

        print(f"[기억 꺼내기 오류]: {e}")

        return jsonify(
            {"ok": False, "error": "기억을 꺼내지 못했습니다."}
        ), 500


@app.route(
    "/api/memory/archives",
    methods=["GET"]
)
def memory_archives_api():
    """보관해 둔 기억 목록."""

    try:
        from memory_manager import list_archives
        return jsonify({"ok": True, "archives": list_archives()})
    except Exception as e:
        print(f"[기억 목록 오류]: {e}")
        return jsonify({"ok": False, "archives": []}), 500




@app.route(
    "/api/first-talk",
    methods=["POST", "GET"]
)
def first_talk_api():
    """상대가 한동안 조용할 때 다이아가 먼저 건네는 말.

    사이가 깊어질수록 먼저 거는 말의 온도가 달라진다.
    원수 단계에서는 먼저 말을 걸지 않는다.
    """

    try:

        import random

        from ai_brain import extract_cues
        from memory_manager import (
            append_message,
            load_relationship,
        )

        saved = load_relationship() or {}

        affinity = saved.get(
            "affinity",
            AVATAR.relationship.get("start_affinity", 0)
        )

        stage = _stage_now(
            affinity,
            saved.get("stage")
        )

        # 사귀자고 먼저 꺼낸다.
        #
        # 호감이 충분히 쌓였는데 상대가 아무 말이 없으면, 마냥 기다리지
        # 않는다. 한 번 말해 본다 — 기다리기만 하는 것은 자율사고가
        # 아니다. 받아들이는 것은 상대 몫이라 여기서 연인이 되지는 않는다.
        #
        # 한 번만 묻는다(asked_lover). 물을 때마다 조르면 사람이 아니라
        # 알림이 된다.
        if (not saved.get("lover")
                and AVATAR.confess_asks(affinity, AVATAR.gate_grants(saved))
                and not saved.get("asked_lover")):

            ask = AVATAR.confess_ask()

            if ask.get("line"):
                d = memory_manager.load_memory_data()
                d["relationship"] = dict(d.get("relationship") or {},
                                         asked_lover=True)
                memory_manager.save_memory_data(d)

                try:
                    append_message("assistant", ask["line"])
                except Exception as e:
                    print(f"[고백 묻기 저장 오류]: {e}")

                print("[고백]: 먼저 말했습니다.")

                return jsonify({
                    "speak": True,
                    "reply": ask["line"],
                    "expression": ask.get("expression") or "surprised",
                    "motion": ask.get("motion"),
                    "cues": [],
                    "stage": stage.key,
                    "label": _stage_label(stage),
                })

        # 대답이 없어도 말을 멈추지 않는 단계에서는 정해둔 문장을 쓰지 않는다.
        # 그때그때 생각해서 말한다. 그래야 "안녕" 에 답이 없을 때
        # "안녕이라고 했는데 왜 대답 안 해?" 가 나온다.
        if getattr(stage, "keeps_talking", False):

            from ai_brain import keep_talking

            live = keep_talking()

            if live:
                return jsonify(
                    {
                        "speak": True,
                        "reply": live["reply"],
                        "cues": live["cues"],
                        "expression": live["expression"],
                        "unanswered": live["unanswered"],
                        "keeps_talking": True,
                        "stage": stage.key,
                        "label": _stage_label(stage),
                        "affinity": affinity,
                    }
                )

            # 모델을 못 불렀으면 아래로 내려가 정해둔 문장을 쓴다.
            print("[먼저 말걸기]: 스스로 만들지 못해 정해둔 문장으로 넘어갑니다.")

        lines = stage.first_talk or []

        if not lines:
            return jsonify(
                {
                    "speak": False,
                    "stage": stage.key,
                    "label": _stage_label(stage),
                }
            )

        # 지금까지 한 이야기에서 이어지는 말로 먼저 건다(dia.mind.talk_first).
        # 정해 둔 문장은 이을 이야기가 없거나 모델을 못 부를 때만 쓴다.
        from dia.mind import talk_first

        live = talk_first()

        if live:
            _moved = _apply_wear(_apply_place({"cues": live["cues"]}))
            return jsonify(
                {
                    "speak": True,
                    "reply": live["reply"],
                    "cues": _moved.get("cues", live["cues"]),
                    "place": _moved.get("place"),
                    "wear": _moved.get("wear"),
                    "expression": live["expression"],
                    "feel": live.get("feel"),
                    "stage": stage.key,
                    "label": _stage_label(stage),
                    "affinity": affinity,
                }
            )

        raw = random.choice(lines)

        # 먼저 거는 말도 대화 흐름에 남아야 다음 답이 이어진다
        reply, cues = extract_cues(raw)

        try:
            append_message("assistant", reply)
        except Exception as e:
            print(f"[먼저 말걸기 저장 오류]: {e}")

        _moved = _apply_wear(_apply_place({"cues": cues}))

        return jsonify(
            {
                "speak": True,
                "reply": reply,
                "cues": _moved.get("cues", cues),
                "place": _moved.get("place"),
                "wear": _moved.get("wear"),
                "expression": AVATAR.detect_expression(reply),
                "stage": stage.key,
                "label": _stage_label(stage),
                "affinity": affinity,
            }
        )

    except Exception as e:

        print(
            f"[먼저 말걸기 오류]: {e}"
        )

        return jsonify(
            {
                "speak": False,
                "error":
                "먼저 건넬 말을 만들지 못했습니다."
            }
        ), 500


# ============================================================
# 호감도 되돌리기
#
# 시험하다 보면 사이가 한쪽으로 치우친 채 굳는다. 기억은 그대로 두고
# 사이만 처음으로 돌리고 싶을 때가 있어서 따로 뒀다.
# ('/새 기억'은 기억까지 통째로 치운다. 이건 사이만 건드린다.)
# ============================================================

# ==================================================================
# 눈
#
# 카메라나 사진을 그림 보는 모델에게 보내 '무엇이 보이는지' 를 받고,
# 그것을 읽고 무슨 말을 할지는 다이아가 정한다.
#
# 둘을 나눈 이유: 그림 보는 모델은 다이아가 아니다. 그 모델이 직접
# 답하면 말투도, 사이도, 기억도 모르는 다른 사람이 답하게 된다.
# ==================================================================

def _describe(image_b64, prompt=None):
    """그림에 무엇이 보이는지 받아 온다. 못 보면 None.

    prompt 를 주면 그것으로 묻는다. 방을 읽을 때는 색과 밝기를
    숫자로 달라고 따로 물어야 해서 이 자리가 필요하다.
    """

    import requests
    from config import OLLAMA_URL, VISION_ENABLED, VISION_MODEL

    if not VISION_ENABLED:
        return None

    conf = AVATAR.vision or {}
    if not conf.get("enabled", True):
        return None

    prompt = prompt or conf.get("look_prompt")         or "이 사진에 무엇이 보이는지 한국어로 적어라."

    r = requests.post(OLLAMA_URL, json={
        "model": VISION_MODEL,
        "messages": [{
            "role": "user",
            "content": prompt,
            "images": [image_b64],
        }],
        "stream": False,
        # 눈은 생각하지 않는다. 보이는 것만 적으면 된다.
        "think": False,
    }, timeout=180)

    if r.status_code != 200:
        print(f"[눈]: HTTP {r.status_code}")
        return None

    seen = ((r.json().get("message") or {}).get("content") or "").strip()
    return seen or None


@app.route(
    "/api/see",
    methods=["POST"]
)
def see_api():
    """사진 한 장을 보여 준다.

    받는 값:
      image   : base64 (앞의 data:...;base64, 는 떼고 보낸다)
      message : 같이 적어 보낸 말. 없으면 그냥 보여 준 것이다
      speak   : 말을 시킬 것인가. 카메라가 혼자 볼 때는 False 로 보낸다

    speak 가 False 면 본 것만 돌려주고 모델을 부르지 않는다.
    20초마다 한 번씩 말을 걸면 혼자 떠드는 사람이 된다.
    """

    try:
        from ai_brain import process_chat

        data = request.get_json(silent=True) or {}
        image = data.get("image")

        if not image or not isinstance(image, str):
            return jsonify({"ok": False, "error": "그림이 없습니다"}), 400

        # 앞머리가 붙어 와도 받아 준다
        if "," in image[:64] and image[:5] == "data:":
            image = image.split(",", 1)[1]

        seen = _describe(image)

        if not seen:
            return jsonify({"ok": False, "error": "보지 못했습니다"}), 502

        print(f"[눈]: {seen}")

        if not data.get("speak", True):
            # 보기만 한다. 무슨 말을 할지는 다음에 말을 걸 때 정한다.
            return jsonify({"ok": True, "seen": seen, "spoke": False})

        said = (data.get("message") or "").strip()
        if not said:
            # 말 없이 보여 주기만 했다. 그것도 하나의 말이다.
            said = "(사진을 보여 준다)"

        out = process_chat(said, seeing=seen)
        out["ok"] = True
        out["seen"] = seen
        out["spoke"] = True
        return jsonify(out)

    except Exception as e:
        print(f"[눈 오류]: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route(
    "/api/relationship/reset",
    methods=["POST"]
)
def relationship_reset_api():

    try:

        from memory_manager import load_relationship, save_relationship

        data = request.get_json(silent=True) or {}

        start = AVATAR.relationship.get("start_affinity", 0)

        # 숫자를 적어 보내면 그 값으로 맞춘다. 안 적으면 시작 지점이다.
        want = data.get("affinity")
        target = start if want is None else int(want)
        target = AVATAR.clamp_affinity(target)

        before = load_relationship() or {}
        stage = _stage_now(target, None)

        # 사이를 처음으로 돌리면 연인이었던 것도 없던 일이 된다
        save_relationship(target, stage.key, 0, False)

        print(f"[호감도 되돌리기]: {before.get('affinity')} -> {target} "
              f"({stage.label})")

        return jsonify(
            {
                "ok": True,
                "affinity": target,
                "stage": stage.key,
                "stage_label": _stage_label(stage),
                "before": before.get("affinity"),
                "before_stage": before.get("stage"),
                "start": start,
            }
        )

    except Exception as e:

        print(f"[호감도 되돌리기 오류]: {e}")

        return jsonify(
            {
                "ok": False,
                "error": "호감도를 되돌리지 못했습니다."
            }
        ), 500


# ============================================================
# 옷 벗기기
#
# 옷을 두 번 누르면 벗는다. 두 번 더 누르면 다시 입는다.
# 그 옷을 만져도 되는 사이여야 한다 — 옷 자리의 allow_from 을 쓴다.
# ============================================================

@app.route("/api/undress", methods=["POST"])
def undress_api():

    try:
        from memory_manager import load_relationship

        conf = AVATAR.touch.get("undress", {})

        if not conf.get("enabled"):
            return jsonify({"ok": False, "error": "꺼져 있습니다."}), 200

        data = request.get_json(silent=True) or {}
        zone_key = str(data.get("zone") or "")
        wearing = bool(data.get("wearing", True))

        if zone_key not in (conf.get("zones") or []):
            return jsonify({"ok": False, "error": "벗길 수 없는 자리입니다."}), 200

        saved = load_relationship() or {}
        affinity = saved.get(
            "affinity", AVATAR.relationship.get("start_affinity", 0))
        stage = _stage_now(affinity, saved.get("stage"))

        zone = AVATAR.touch_zone(zone_key)
        need = (zone.allow_from if zone and zone.allow_from is not None else 0)

        if affinity < need:
            return jsonify(
                {
                    "ok": False,
                    "allowed": False,
                    "reply": "그건… 아직 안 돼요." if
                             str(stage.speech).startswith("존댓말")
                             else "그건… 아직 안 돼.",
                    "expression": "angry",
                    "need": need,
                }
            )

        import random as _r

        polite = str(stage.speech).startswith("존댓말")
        tone = "polite" if polite else "casual"
        which = "off" if wearing else "on"

        pool = (conf.get("lines", {}).get(which, {}) or {}).get(tone) or []

        return jsonify(
            {
                "ok": True,
                "allowed": True,
                "zone": zone_key,
                # 벗겼는가 입혔는가
                "off": wearing,
                "reply": _r.choice(pool) if pool else "",
                "expression": conf.get("off_expression" if wearing
                                       else "on_expression", "surprised"),
            }
        )

    except Exception as e:
        print(f"[옷 벗기기 오류]: {e}")
        return jsonify({"ok": False, "error": "하지 못했습니다."}), 500


# ============================================================
# 목소리
#
# config 의 TTS_PROVIDER 하나만 쓴다 — edge(선희) 또는 gemini(레다).
# 서버가 소리를 만들어 내려보내고, 화면은 /api/tts 로 문장을 보내
# 소리를 받아 간다. /api/tts/config 는 켜져 있는지와 목소리 이름만 알려 준다.
# ============================================================

@app.route("/api/tts/config")
def tts_config_api():

    from config import (TTS_ENABLED, TTS_PROVIDER, TTS_VOICE,
                        TTS_EDGE_VOICE, TTS_API_KEY)

    edge = TTS_PROVIDER == "edge"

    return jsonify(
        {
            "enabled": bool(TTS_ENABLED),
            "provider": TTS_PROVIDER,
            "voice": TTS_EDGE_VOICE if edge else TTS_VOICE,
            # 만들 수 없으면 말은 조용히 넘어간다. 화면이 알 수 있게.
            "ready": True if edge else bool(TTS_API_KEY),
        }
    )


# ------------------------------------------------------------
# 만든 소리를 떠 둔다
#
# 같은 말을 또 만들 이유가 없다. 그리고 gemini 는 **분당 몇 번**밖에
# 못 부른다 — 연달아 부르면 429 로 막힌다. 먼저 말 걸기처럼 정해진
# 문장 풀에서 나오는 말은 떠 두면 두 번째부터는 아예 부르지 않는다.
#
# 올린 데서는 파일을 쓸 수 없다. 그때는 조용히 지나간다 —
# 못 떠 두는 것뿐이지 소리가 안 나는 것은 아니다.
# ------------------------------------------------------------

_VOICE_CACHE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "_voice_cache")


def _voice_cache_path(*bits):
    """무엇으로 만든 소리인지까지 열쇠에 넣는다.

    목소리나 말투를 바꾸면 떠 둔 것이 안 맞으므로, 그 값들도 같이
    섞어야 한다. 안 그러면 바꾼 뒤에도 옛 소리가 나온다.
    """
    import hashlib

    key = hashlib.sha1("\u0000".join(str(b) for b in bits)
                       .encode("utf-8")).hexdigest()

    return os.path.join(_VOICE_CACHE, key + ".json")


def _voice_cache_get(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _voice_cache_put(path, payload):
    try:
        os.makedirs(_VOICE_CACHE, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f)
    except OSError:
        # 올린 데서는 못 쓴다. 그래도 소리는 이미 만들어졌다.
        pass


def _tts_edge(text):
    """Edge 의 읽어주기 목소리(선희). mp3 로 바로 온다. 실패하면 None.

    키도 횟수 제한도 없다. 다만 공식 API 가 아니라 커뮤니티가 Edge 의
    통신을 뜯어 만든 것이라 약관상 회색지대다(개인용 전제).
    """
    try:
        import asyncio
        import base64

        import edge_tts

        from config import TTS_EDGE_VOICE, TTS_EDGE_RATE, TTS_EDGE_PITCH

        async def make():
            c = edge_tts.Communicate(
                text,
                TTS_EDGE_VOICE,
                rate=TTS_EDGE_RATE,
                pitch=TTS_EDGE_PITCH,
            )
            buf = b""
            async for chunk in c.stream():
                if chunk["type"] == "audio":
                    buf += chunk["data"]
            return buf

        audio = asyncio.run(make())

        if not audio:
            raise RuntimeError("소리가 비었다")

        return {
            "ok": True,
            "provider": "edge",
            "voice": TTS_EDGE_VOICE,
            "mime": "audio/mpeg",
            "audio": base64.b64encode(audio).decode("ascii"),
        }

    except Exception as e:
        print(f"[목소리 오류 - edge]: {e}")
        return None


def _tts_gemini(text):
    """Gemini 목소리(레다). 막히거나 실패하면 None."""
    from config import TTS_API_KEY, TTS_MODEL, TTS_STYLE, TTS_VOICE

    try:
        import requests as _rq

        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{TTS_MODEL}:generateContent"
        )

        body = {
            "contents": [{
                "parts": [{"text": f"{TTS_STYLE}: {text}"}]
            }],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": {"voiceName": TTS_VOICE}
                    }
                },
            },
        }

        res = _rq.post(
            url,
            json=body,
            headers={"x-goog-api-key": TTS_API_KEY},
            timeout=30,
        )

        if res.status_code != 200:
            # 429 는 할당량이다. 잘못된 것이 아니라 너무 자주 부른 것이다.
            how = ("할당량을 넘었습니다"
                   if res.status_code == 429 else res.text[:120])
            print(f"[목소리]: gemini HTTP {res.status_code} — {how}")
            return None

        part = res.json()["candidates"][0]["content"]["parts"][0]

        return {
            "ok": True,
            "provider": "gemini",
            "voice": TTS_VOICE,
            "mime": part["inlineData"].get("mimeType", "audio/L16;rate=24000"),
            "audio": part["inlineData"]["data"],
        }

    except Exception as e:
        print(f"[목소리 오류 - gemini]: {e}")
        return None


def _voice_for(text):
    """이 글의 소리. 떠 둔 것이 있으면 그것. 반환: (소리, 못 만든 까닭)."""
    from config import (TTS_PROVIDER, TTS_VOICE, TTS_API_KEY, TTS_STYLE,
                        TTS_EDGE_VOICE, TTS_EDGE_RATE, TTS_EDGE_PITCH)

    if TTS_PROVIDER == "edge":
        path = _voice_cache_path("edge", TTS_EDGE_VOICE, TTS_EDGE_RATE,
                                 TTS_EDGE_PITCH, text)
    else:
        path = _voice_cache_path("gemini", TTS_VOICE, TTS_STYLE, text)

    got = _voice_cache_get(path)
    if got:
        got["cached"] = True
        return got, None

    # 정해진 목소리 하나만 쓴다. 못 만들면 다른 목소리로 내려가지
    # 않는다 — 조용하고, 왜 그런지 적힌다.
    if TTS_PROVIDER == "edge":
        out = _tts_edge(text)
        why = "edge 가 소리를 못 만들었습니다"
    elif not TTS_API_KEY:
        why = "Gemini 열쇠가 없습니다 (.gemini_key 또는 GEMINI_API_KEY)"
        out = None
    else:
        out = _tts_gemini(text)
        why = "gemini 가 소리를 못 만들었습니다 (할당량이거나 오류)"

    if out is None:
        return None, why

    _voice_cache_put(path, out)
    return out, None


class _VoiceHead:
    """첫 문장의 소리를 뒤에서 만든다. 대화 창구 하나에 하나.

    화면은 말을 보내면서 voice_id 를 붙이고, 같은 번호로
    /api/voice/head 를 함께 부른다. 그 창구는 첫 문장 소리가 되는
    순간 돌려주므로 **답이 다 쓰이기 전에** 입을 연다. 긴 답일수록
    차이가 크다(답 2.7초 → 소리 1.4초쯤).

    번호가 없거나(옛 화면) 서버가 여럿이라 못 만나면(올린 데) 답과
    함께 voice_head 로 가는 것만 남는다 — 그래도 소리는 난다.
    """

    WAIT_SEC = 1.5      # 답이 다 온 뒤 소리를 더 기다리는 최대 시간
    KEEP_SEC = 30       # 번호를 들고 있는 시간

    _open = {}
    _lock = threading.Lock()

    def __init__(self):
        self.text = None
        self.out = None
        self.thread = None
        self.ready = threading.Event()
        self.born = time.time()

    @classmethod
    def open(cls, voice_id):
        head = cls()
        key = str(voice_id or "")[:64]
        if key:
            with cls._lock:
                now = time.time()
                for k in [k for k, v in cls._open.items()
                          if now - v.born > cls.KEEP_SEC]:
                    cls._open.pop(k, None)
                cls._open[key] = head
        return head

    @classmethod
    def find(cls, voice_id, wait):
        """번호의 것을 찾는다. 아직 안 열렸으면 wait 초까지 기다린다."""
        key = str(voice_id or "")[:64]
        end = time.time() + wait
        while True:
            with cls._lock:
                head = cls._open.get(key)
            if head or time.time() >= end:
                return head
            time.sleep(0.03)

    def start(self, text):
        from config import TTS_ENABLED
        if self.thread is not None or not TTS_ENABLED:
            return
        self.text = text

        def run():
            try:
                self.out, _ = _voice_for(text)
            finally:
                self.ready.set()

        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()

    def finish(self):
        """답이 끝났다. 첫 문장이 끝내 없었으면 기다리는 쪽을 놓아 준다."""
        if self.thread is None:
            self.ready.set()

    def result(self, wait=None):
        self.ready.wait(self.WAIT_SEC if wait is None else wait)
        out = self.out
        if not out or not out.get("ok"):
            return None
        return {"text": self.text, "audio": out["audio"],
                "mime": out.get("mime", "")}


@app.route("/api/voice/head")
def voice_head_api():
    """첫 문장 소리 — 대화 답보다 먼저. 없으면 ok: false."""
    head = _VoiceHead.find(request.args.get("id"), wait=3)
    got = head.result(wait=8) if head else None
    if not got:
        return jsonify({"ok": False})
    return jsonify(dict(got, ok=True))


@app.route("/api/tts", methods=["POST"])
def tts_api():

    from config import TTS_ENABLED

    if not TTS_ENABLED:
        return jsonify({"ok": False, "error": "목소리가 꺼져 있습니다."}), 400

    data = request.get_json(silent=True) or {}
    text = str(data.get("text") or "").strip()

    if not text:
        return jsonify({"ok": False, "error": "읽을 말이 없습니다."}), 400

    # 떠 둔 것이 있으면 그것을 쓴다. 부르지도 않고 기다리지도 않는다.
    out, why = _voice_for(text)

    if out is None:
        print(f"[목소리]: {why} — 이번 말은 조용히 넘어갑니다.")
        return jsonify({"ok": False, "error": why}), 200

    return jsonify(out)


# ============================================================
# 배경 이미지
#
# static/background/ 를 훑어 쓸 수 있는 이미지를 알려준다.
# 파일을 넣고 화면만 새로 고치면 바뀌도록, 목록을 코드에 적지 않는다.
# ============================================================

@app.route("/api/wardrobe")
def wardrobe_api():
    """옷장에 무엇이 걸려 있는가.

    목록을 코드에 적지 않는다. 배경과 같은 이치다 —
    `_extract_garment.py` 로 옷을 구우면 wardrobe.json 에 한 줄이 늘고,
    화면을 새로 고치면 그 옷이 옷장에 걸린다. 서버를 껐다 켤 필요 없다.

    옷 하나는 '옷만 든 작은 VRM' 이다(교복 한 벌 1.4MB). 통짜 아바타를
    옷 수만큼 두면 한 벌에 16MB 다.
    """

    conf = (WORLD.model or {}).get("wardrobe_dir", "static/wardrobe")
    base = os.path.join(os.path.dirname(os.path.abspath(__file__)), conf)
    book = os.path.join(base, "wardrobe.json")

    items = []

    try:
        with open(book, encoding="utf-8") as f:
            items = json.load(f).get("items", [])
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f"[옷장 읽기 오류]: {e}")

    # 파일이 실제로 있는 것만 준다.
    # json 에는 남았는데 파일을 지운 경우, 화면에서 눌러도 404 만 난다.
    live = []

    for it in items:
        name = it.get("file") or ""
        if name and os.path.exists(os.path.join(base, name)):
            live.append(it)
        else:
            print(f"[옷장] 파일이 없어 건너뜀: {name}")

    # 지금 무엇을 입고 있는가. 칸마다 따로다.
    worn = _worn_map(live)

    return jsonify({"ok": True, "items": live, "worn": worn,
                    "slots": SLOT_ORDER})


@app.route("/api/wardrobe", methods=["POST"])
def wardrobe_wear_api():
    """무엇을 입었는지 적어 둔다. 창을 닫았다 열어도 그대로여야 한다.

    벗었으면 빈 문자열을 보낸다 — '벗고 있음' 과 '아직 안 정함' 은
    다르다. 뒤엣것은 처음 온 사람이라 기본 옷을 입힌다.
    """

    data = request.get_json(silent=True) or {}
    key = str(data.get("key") or "")
    slot = str(data.get("slot") or "")

    # 이름만 보내면 그 물건이 걸리는 칸을 찾아 준다.
    if key and not slot:
        slot = _slot_of_key(key) or "outfit"

    if not slot:
        slot = "outfit"

    memory_manager.save_wearing(slot, key)

    print("[옷장] %s 칸: %s" % (slot, key or "벗음"))

    return jsonify({"ok": True, "slot": slot, "worn": key,
                    "all": memory_manager.load_wearing()})


# ============================================================
# 꾸밈새 — 눈 색과 화장
#
# 옷장과 같은 얼개다. 무엇을 고를 수 있는지는 개체(avatar.py)가 쥐고,
# 무엇을 골랐는지는 기억에 적는다. **칠하는 일은 화면이 한다** —
# 텍스처를 캔버스로 옮겨 그 자리만 고쳐 칠한다. 색깔마다 텍스처를
# 구워 두면 눈 한 색이 1MB 다.
# ============================================================

def _look_conf():
    return ((WORLD.model or {}).get("look") or {})


def _look_keys(part):
    """그 칸에 있는 이름들. 없는 것을 고르면 안 받는다."""
    conf = _look_conf().get(part) or {}

    if part == "eye":
        return [c.get("key") for c in conf.get("colors", []) if c.get("key")]

    return [i.get("key") for i in conf.get("items", []) if i.get("key")]


def _look_now():
    """지금 무엇을 하고 있는가. 안 고른 칸은 개체가 정한 기본값."""
    conf = _look_conf()
    saved = memory_manager.load_look()

    out = {}

    for part in ("eye", "makeup"):
        want = saved.get(part)

        if want and want in _look_keys(part):
            out[part] = want
        else:
            out[part] = (conf.get(part) or {}).get("default") or ""

    return out


@app.route("/api/look")
def look_api():
    """고를 수 있는 것과 지금 고른 것."""

    conf = _look_conf()

    return jsonify({
        "ok": True,
        "enabled": bool(conf.get("enabled", True)),
        "eye": conf.get("eye") or {},
        "makeup": conf.get("makeup") or {},
        "now": _look_now(),
    })


@app.route("/api/look", methods=["POST"])
def look_set_api():
    """눈 색이나 화장을 골랐다. 창을 닫았다 열어도 그대로여야 한다."""

    data = request.get_json(silent=True) or {}

    part = str(data.get("part") or "").strip()
    key = str(data.get("key") or "").strip()

    if part not in ("eye", "makeup"):
        return jsonify({"ok": False, "error": "그런 칸은 없습니다."}), 400

    # 없는 이름은 안 받는다. 받으면 화면은 못 그리고 기억에만 남는다.
    if key and key not in _look_keys(part):
        return jsonify({"ok": False, "error": "그런 것은 없습니다."}), 400

    memory_manager.save_look(part, key)

    print("[꾸밈새] %s: %s" % (part, key or "기본"))

    return jsonify({"ok": True, "now": _look_now()})


@app.route("/api/background")
def background_api():

    import os

    conf = (WORLD.model or {}).get("background", {}) or {}

    folder = conf.get("dir", "static/background")
    prefix = conf.get("url_prefix", "/static/background/")
    types = tuple(
        t.lower() for t in conf.get(
            "types", [".png", ".jpg", ".jpeg", ".webp", ".gif"]
        )
    )

    base = os.path.join(os.path.dirname(os.path.abspath(__file__)), folder)

    try:
        names = sorted(
            f for f in os.listdir(base)
            if f.lower().endswith(types)
        )
    except FileNotFoundError:
        names = []
    except Exception as e:
        print(f"[배경 훑기 오류]: {e}")
        names = []

    from urllib.parse import quote

    images = [
        {"name": n, "url": prefix + quote(n)}
        for n in names
    ]

    # ------------------------------------------------------------
    # 장소별로 묶는다
    #
    # 파일 이름이 곧 장소 이름이다. 공원_낮.jpg 와 공원_밤.jpg 는
    # 둘 다 '공원' 이고, 그 곳으로 갈 때 그중 하나가 뽑힌다.
    #
    # 목록을 코드에 적지 않는 이유는 배경과 같다 — 파일을 넣고
    # 새로 고치면 갈 수 있는 곳이 늘어야 한다.
    # ------------------------------------------------------------
    places = {}

    for img in images:
        places.setdefault(WORLD.place_of_file(img["name"]), []).append(img)

    # 어디서 시작하는가.
    #
    # 1. 지난번에 있던 곳이 있으면 거기다. 창을 닫았다 열었다고
    #    카페에서 갑자기 공원으로 옮겨지면 안 된다.
    # 2. 없으면 places.start 에 적힌 곳.
    # 3. 그것도 없으면 **아무 데도 아니다 — 배경을 안 깐다.**
    #
    # 예전에는 이름순 첫 번째를 깔았다. 그러면 창을 열자마자 어딘가에
    # 가 있는 셈이라, 이야기하다가 "공원 가자" 하는 것이 어색해진다.
    # 아무 데도 아닌 자리에서 시작해 둘이 정한 곳으로 가는 편이 맞다.
    here = None

    try:
        here = (memory_manager.load_memory_data().get("place") or {}).get("name")
    except Exception:
        here = None

    current = None

    if here and here in places:
        current = places[here][0]
    else:
        here = None

        start = WORLD.places_conf().get("start")

        if start and start in places:
            current = places[start][0]
            here = start

    # 꼭 집어 쓰라고 적어 둔 파일이 있으면 그것이 이긴다.
    # 장소와 상관없이 늘 그 그림으로 시작하고 싶을 때만 쓴다.
    want = conf.get("prefer")

    if want:
        hit = next((i for i in images if i["name"] == want), None)
        if hit:
            current = hit
            here = WORLD.place_of_file(hit["name"])
        else:
            print(f"[배경] prefer 로 적은 '{want}' 을(를) 못 찾았습니다.")

    return jsonify(
        {
            "images": images,
            "current": current,
            # {"공원": [...], "카페": [...]}
            "places": {k: v for k, v in sorted(places.items())},
            "place": here,
            # 폴더가 빈 것과 일부러 배경 없이 시작하는 것은 다르다.
            "empty": not images,
            "fit": conf.get("fit", "cover"),
            "dim": conf.get("dim", 0.0),
            "folder": folder,
        }
    )






def _place_go(name):
    """그 곳으로 옮긴다. 갈 수 없는 곳이면 False.

    기억에 적어 두는 이유: 창을 닫았다 열어도 있던 자리가 남아야
    한다. 기분·체스판과 같은 자리다.
    """
    if not name or name not in _places_now():
        return False

    data = memory_manager.load_memory_data()
    data["place"] = {"name": name}
    memory_manager.save_memory_data(data)

    return True


def _place_image(name):
    """그 곳의 그림 하나. 여러 장이면 그때그때 하나 뽑는다."""
    import random as _rnd
    from urllib.parse import quote

    conf = (WORLD.model or {}).get("background", {}) or {}
    prefix = conf.get("url_prefix", "/static/background/")
    folder = conf.get("dir", "static/background")
    types = tuple(t.lower() for t in conf.get(
        "types", [".png", ".jpg", ".jpeg", ".webp", ".gif"]))

    base = os.path.join(os.path.dirname(os.path.abspath(__file__)), folder)

    try:
        hits = [f for f in sorted(os.listdir(base))
                if f.lower().endswith(types)
                and WORLD.place_of_file(f) == name]
    except OSError:
        hits = []

    if not hits:
        return None

    pick = _rnd.choice(hits)

    return {"name": pick, "url": prefix + quote(pick)}


# ============================================================
# 장면 — 지금이 어떤 자리인가
#
# 장소와 나란히 둔다. 다른 것은 두 가지다.
#
#   1. 배경 그림이 없어도 열린다. 노래방 사진이 없다고 노래를
#      못 부를 이유는 없다.
#   2. 열려 있는 동안에만 프롬프트가 몇 줄 는다.
#
# 기억에 적는 이유도 장소와 같다 — 창을 닫았다 열어도 부르던
# 노래가 이어져야 한다.
# ============================================================







def _apply_song(result):
    """답에 섞인 노래 표시를 악보로 바꾼다.

    가사만 받아서 음은 서버가 붙인다. 모델에게 음을 적게 하면
    음치가 되고, 적으라는 말 자체가 규칙 한 줄이다.

    **가사는 본문에 안 남긴다.** 부를 것을 글로도 적으면 같은
    말을 두 번 하는 꼴이다.
    """
    if not isinstance(result, dict):
        return result

    cues = result.get("cues")

    if not isinstance(cues, list) or not cues:
        return result

    lines, keep = [], []

    for c in cues:
        if isinstance(c, dict) and c.get("type") == "song":
            line = (c.get("line") or "").strip()
            if line:
                lines.append(line)
            continue
        keep.append(c)

    if not lines:
        return result

    result["cues"] = keep

    cap = AVATAR.song_conf().get("max_lines", 6)

    if len(lines) > cap:
        print(f"[노래]: {len(lines)}줄 중 {cap}줄만 부릅니다")
        lines = lines[:cap]

    score = AVATAR.score(lines)

    if not score:
        return result

    result["song"] = score

    print(f"[노래]: {score['melody']} · {len(lines)}줄 · "
          + " / ".join(lines))

    return result


def _apply_shoot(result):
    """찍자는 표시를 실제 촬영으로 바꾼다.

    컷 수·카운트·포즈는 서버가 쥔다. 놀이 규칙과 같은 자리다 —
    프롬프트에 안 적어야 모델의 여지를 안 뺏는다.
    """
    if not isinstance(result, dict):
        return result

    cues = result.get("cues")

    if not isinstance(cues, list) or not cues:
        return result

    want = False
    keep = []

    for c in cues:
        if isinstance(c, dict) and c.get("type") == "shoot":
            want = True
            continue
        keep.append(c)

    if not want:
        return result

    result["cues"] = keep

    shot = WORLD.shot_conf()

    if not shot:
        return result

    # 말만 보내지 않는다. 찍는 동안 쓸 것을 다 실어 보낸다.
    result["shoot"] = {k: v for k, v in shot.items() if k != "words"}

    print(f"[네컷]: {result['shoot'].get('cuts')}컷 찍습니다")

    return result




# 옷 칸 차례와 이름표는 system/world_state.py 에 있다(SLOT_ORDER·SLOT_LABEL).




def _slot_of_key(key):
    for it in _wardrobe_items():
        if it.get("key") == key:
            return _slot_of(it)
    return None








def _apply_wear(result):
    """답에 (옷: 교복) 이 있으면 갈아입힌다.

    장소(_apply_place)와 같은 얼개다. 표시는 큐에서 걷어내고,
    화면이 받아 쓸 수 있게 result["wear"] 에 담아 준다.

    **칸은 물건이 정한다.** '안경' 이라 적으면 안경 칸에 걸리므로
    입고 있던 옷은 그대로다. 같은 칸의 것을 적으면 갈아입는다.
    """
    cues = result.get("cues")

    if not isinstance(cues, list) or not cues:
        return result

    wants = []
    keep = []

    for c in cues:
        if isinstance(c, dict) and c.get("type") == "wear":
            wants.append(c.get("key"))
            continue
        keep.append(c)

    if not wants:
        return result

    result["cues"] = keep

    items = _wardrobe_items()
    keys = [it.get("key") for it in items]
    worn = _worn_map(items)
    changed = {}

    for want in wants:
        want = str(want or "").strip()

        # "안경 벗기" 처럼 무엇을 벗을지 적었을 수 있다.
        #
        # ★ 무엇을 벗는지부터 본다. '벗기' 가 들어 있다는 것만 보고
        #   옷 칸으로 정하면 **"안경 벗기" 가 옷을 벗긴다.** 실제로 그랬다.
        off_slot = None

        for k in keys:
            if k and want.startswith(k) and WORLD.wear_is_off(want[len(k):]):
                off_slot = _slot_of_key(k)
                break

        if off_slot is None:
            for slot, label in SLOT_LABEL.items():
                if want.startswith(label) and WORLD.wear_is_off(want[len(label):]):
                    off_slot = slot
                    break

        # 그냥 '벗기' 면 옷을 벗는 것이다
        if off_slot is None and WORLD.wear_is_off(want):
            off_slot = "outfit"

        if off_slot:
            if not worn.get(off_slot):
                continue
            memory_manager.save_wearing(off_slot, "")
            print(f"[옷]: {off_slot} 칸 — {worn[off_slot]} 벗음")
            worn[off_slot] = ""
            changed[off_slot] = ""
            continue

        if want not in keys:
            print(f"[옷]: '{want}' 은(는) 옷장에 없습니다 — 그냥 둡니다.")
            continue

        slot = _slot_of_key(want) or "outfit"

        if worn.get(slot) == want:
            continue

        memory_manager.save_wearing(slot, want)
        print(f"[옷]: {slot} 칸 — {worn.get(slot) or '없음'} -> {want}")
        worn[slot] = want
        changed[slot] = want

    if changed:
        result["wear"] = {"worn": worn, "changed": changed}

    return result

    want = None
    keep = []

    for c in cues:
        if isinstance(c, dict) and c.get("type") == "wear":
            want = c.get("key")          # 마지막 것이 이긴다
            continue
        keep.append(c)

    if want is None:
        return result

    result["cues"] = keep

    here = _worn_now()
    keys = [it.get("key") for it in _wardrobe_items()]

    # 벗으라는 말
    if WORLD.wear_is_off(want):
        if here is None:
            return result
        memory_manager.save_wearing("")
        result["wear"] = {"key": ""}
        print(f"[옷]: {here} -> 벗음")
        return result

    if want not in keys:
        print(f"[옷]: '{want}' 은(는) 옷장에 없습니다 — 그냥 둡니다.")
        return result

    if want == here:
        return result

    memory_manager.save_wearing(want)
    result["wear"] = {"key": want}
    print(f"[옷]: {here or '벗은 채'} -> {want}")

    return result


def _apply_place(result):
    """답에 섞인 장소 표시를 실제로 옮긴다.

    모델이 낸 것을 그대로 믿지 않는다. **갈 수 있는 곳인지 본다** —
    없는 곳을 적었으면 표시를 버린다. 그래야 말과 화면이 안 어긋난다.

    옮겼으면 result 에 place 를 붙인다. 화면은 그것만 보고 갈아 낀다.
    """
    if not isinstance(result, dict):
        return result

    cues = result.get("cues")

    if not isinstance(cues, list) or not cues:
        return result

    want = None
    keep = []

    for c in cues:
        if isinstance(c, dict) and c.get("type") == "place":
            want = c.get("key")          # 마지막 것이 이긴다
            continue
        keep.append(c)

    if want is None:
        return result

    result["cues"] = keep

    here = _place_here()

    if want == here:
        # 이미 그 곳이다. 옮길 것이 없다.
        return result

    if not _place_go(want):
        print(f"[장소]: '{want}' 은(는) 갈 수 없는 곳입니다 — 그냥 둡니다.")
        return result

    img = _place_image(want)
    result["place"] = {"name": want, "image": img}

    print(f"[장소]: {here or '처음'} -> {want}")

    return result


# ============================================================
# 테스트 전용 페이지
#
# 운영 화면(/)은 건드리지 않는다.
# 통합된 개체를 시험하는 자리는 여기로 분리한다.
# ============================================================



@app.route("/test")
def test_page():
    return render_template(
        "test.html"
    )


# ============================================================
# 리깅 확인대
#
# 본 회전은 사양서만 보고 추측하면 틀린다.
# 같은 VRM · 같은 라이브러리로 띄워 놓고 축을 눈으로 보고 정하는 자리.
# ============================================================

@app.route("/model-test")
def model_test_page():
    """모델 시험대.

    아직 확인하지 않은 것만 모아 둔 자리다.
    두 벌 겹치기·절정 표정·새 동작·옷 끌기·모프 타깃.
    여기서 확인이 끝나면 운영 화면(model.layered)을 켠다.
    """
    return render_template(
        "model_test.html"
    )


# ============================================================
# 픽셀창
#
# 칸 하나가 픽셀 하나다. 누르면 검게, 오른쪽 단추로 누르면 희게.
# 아바타와는 상관없는 별개의 화면이다.
# ============================================================

@app.route("/pixel")
def pixel_page():
    return render_template("pixel.html")


@app.route("/rig")
def rig_page():
    return render_template(
        "rig.html"
    )


@app.route("/api/nowplaying", methods=["POST"])
def nowplaying_api():
    """폰이 '지금 이게 나온다' 고 알려 온다.

    받는 것은 **제목·가수·어느 앱·재생 중인지** 넷뿐이다. 가사는 받지
    않는다 — 다이아는 제 말로 이야기한다.

    알림 내용도 받지 않는다. 폰 앱이 미디어 세션(재생기가 내놓는
    '지금 재생 중' 딱지)에서 그 넷만 꺼내 보낸다.
    """

    data = request.get_json(silent=True) or {}

    saved = memory_manager.save_media(
        data.get("title"),
        data.get("artist"),
        data.get("app"),
        bool(data.get("playing")),
    )

    if saved.get("playing") and saved.get("title"):
        print("[지금 나오는 것] %s - %s (%s)"
              % (saved.get("title"), saved.get("artist") or "?",
                 saved.get("app") or "?"))
    else:
        print("[지금 나오는 것] 멈춤")

    return jsonify({"ok": True, "now": saved})


@app.route("/api/nowplaying")
def nowplaying_get_api():
    """지금 무엇이 나오는 것으로 알고 있는가(확인용)."""

    media = memory_manager.load_media()

    return jsonify({
        "ok": True,
        "now": media,
        "note": WORLD.media_note(media),
    })


@app.route("/api/sprites")
def sprites_api():
    """구워 둔 그림이 무엇이 있는가.

    폰 앱이 화면 위에 다이아를 띄울 때 이것을 먼저 받아 간다.
    그림 자체는 `/static/sprites/...` 로 받는데, /static 이 로그인
    뒤에 있으므로 **앱도 로그인한 채로 받아야 한다.**

    아직 안 구웠으면 빈 목록을 준다 — 앱이 알아서 안 띄운다.
    """

    path = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "static", "sprites", "sprites.json")

    try:
        with open(path, encoding="utf-8") as f:
            book = json.load(f)
    except FileNotFoundError:
        return jsonify({"ok": True, "baked": False, "motions": {}})
    except Exception as e:
        print(f"[스프라이트 읽기 오류]: {e}")
        return jsonify({"ok": False, "error": str(e)[:120]}), 500

    book["ok"] = True
    book["baked"] = bool(book.get("motions"))

    return jsonify(book)


@app.route("/bake")
def bake_page():
    """스프라이트 굽는 자리.

    사람이 열어 볼 화면이 아니다. `_bake_sprites.py` 가 헤드리스
    크롬으로 열어 한 칸씩 찍어 간다. 눈으로 확인하고 싶을 때만
    직접 열어 본다.
    """
    return render_template(
        "bake.html"
    )


# ============================================================
# 표정 배합기
#
# 표정 그룹과 모프 조각을 슬라이더로 섞어 보고 이름을 붙여 둔다.
# 적는 곳은 expressions_custom.json — avatar.py 의 기본값은 안 건드린다.
# 표정은 모두의 다이아에게 걸리므로 이 컴퓨터에서만 고칠 수 있다.
# ============================================================

def _from_this_pc():
    if (request.headers.get("X-Forwarded-For")
            or request.headers.get("CF-Connecting-IP")):
        return False
    return request.remote_addr in ("127.0.0.1", "::1")


@app.route("/face")
def face_page():
    return render_template("face.html", editable=_from_this_pc())


@app.route("/api/expressions/custom")
def custom_expression_list_api():
    from avatar import _EXPR_ORIGINAL
    return jsonify({"ok": True, "editable": _from_this_pc(),
                    "items": {k: ("new" if o is None else "override")
                              for k, o in _EXPR_ORIGINAL.items()}})


@app.route("/api/expressions/custom", methods=["POST"])
def custom_expression_save_api():
    import re
    from avatar import save_custom_expression

    if not _from_this_pc():
        return jsonify({"ok": False, "error": "이 컴퓨터에서만 고칠 수 있다."}), 403

    data = request.get_json(silent=True) or {}
    label = str(data.get("label") or "").strip()[:20]
    key = str(data.get("key") or "").strip()

    if not label:
        return jsonify({"ok": False, "error": "이름을 적어야 한다."}), 400

    # 괄호로 부르는 이름이라 괄호·콜론이 들어가면 표시가 깨진다
    if re.search(r"[()（）:：]", label):
        return jsonify({"ok": False, "error": "이름에 괄호나 콜론은 못 쓴다."}), 400

    clash = next((e for e in AVATAR.expressions
                  if e.label == label and e.key != key), None)
    if clash:
        return jsonify({"ok": False,
                        "error": f"'{label}' 은 이미 있는 이름이다."}), 400

    if not re.fullmatch(r"[a-z0-9_]{1,40}", key):
        n = 1
        while AVATAR.expression(f"custom_{n}"):
            n += 1
        key = f"custom_{n}"

    def nums(d):
        out = {}
        for k, v in (d or {}).items():
            try:
                v = round(float(v), 3)
            except (TypeError, ValueError):
                continue
            if v > 0:
                out[str(k)] = min(v, 1.0)
        return out

    e = save_custom_expression(AVATAR, key, {
        "label": label,
        "when": str(data.get("when") or "").strip()[:300],
        "blendshapes": nums(data.get("blendshapes")),
        "morphs": nums(data.get("morphs")),
        "hold_ms": max(500, min(int(data.get("hold_ms") or 3000), 20000)),
    })

    print(f"[배합기] {e.label} ({e.key}) 적음")
    return jsonify({"ok": True, "expression": e.to_dict()})


@app.route("/api/expressions/custom/<key>", methods=["DELETE"])
def custom_expression_remove_api(key):
    from avatar import remove_custom_expression

    if not _from_this_pc():
        return jsonify({"ok": False, "error": "이 컴퓨터에서만 고칠 수 있다."}), 403

    if not remove_custom_expression(AVATAR, key):
        return jsonify({"ok": False, "error": "배합기에서 만든 표정이 아니다."}), 404

    print(f"[배합기] {key} 지움/되돌림")
    return jsonify({"ok": True})


# ============================================================
# 제스처 조정대
#
# 동작을 옷 입힌 채로 재생·멈춤·되감으며 보고, 키프레임의 뼈 각도를
# 슬라이더로 고친다. 적는 곳은 motions_custom.json — 코드는 안 건드린다.
# ============================================================

@app.route("/gesture")
def gesture_page():
    return render_template("gesture.html", editable=_from_this_pc())


@app.route("/api/motions/custom")
def custom_motion_list_api():
    from avatar import _MOTION_ORIGINAL
    return jsonify({"ok": True, "editable": _from_this_pc(),
                    "items": sorted(_MOTION_ORIGINAL)})


@app.route("/api/motions/custom", methods=["POST"])
def custom_motion_save_api():
    import re
    from avatar import save_custom_motion

    if not _from_this_pc():
        return jsonify({"ok": False, "error": "이 컴퓨터에서만 고칠 수 있다."}), 403

    data = request.get_json(silent=True) or {}
    key = str(data.get("key") or "")
    m = next((x for x in AVATAR.motions if x.key == key), None)
    if not m:
        return jsonify({"ok": False, "error": "없는 동작이다."}), 404

    try:
        duration = round(float(data.get("duration") or m.duration), 3)
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "길이가 숫자가 아니다."}), 400
    if not 0.1 <= duration <= 30:
        return jsonify({"ok": False, "error": "길이는 0.1~30초."}), 400

    bone_re = re.compile(r"^(hips|spine|chest|upperChest|neck|head|"
                         r"(left|right)(Shoulder|UpperArm|LowerArm|Hand|"
                         r"UpperLeg|LowerLeg|Foot|"
                         r"(Thumb|Index|Middle|Ring|Little)"
                         r"(Proximal|Intermediate|Distal)))$")
    keys = []
    for k in data.get("keys") or []:
        try:
            t = round(float(k.get("t")), 3)
        except (TypeError, ValueError, AttributeError):
            return jsonify({"ok": False, "error": "키 시간이 숫자가 아니다."}), 400
        if not 0 <= t <= duration:
            return jsonify({"ok": False,
                            "error": f"키 {t}s 가 길이({duration}s) 밖이다."}), 400
        bones = {}
        for n, v in (k.get("bones") or {}).items():
            if not bone_re.match(str(n)):
                return jsonify({"ok": False, "error": f"모르는 뼈: {n}"}), 400
            try:
                bones[n] = [round(max(-360.0, min(360.0, float(x))), 2)
                            for x in list(v)[:3]]
            except (TypeError, ValueError):
                return jsonify({"ok": False, "error": f"{n} 값이 숫자가 아니다."}), 400
            if len(bones[n]) != 3:
                return jsonify({"ok": False, "error": f"{n} 값은 셋이다."}), 400
        keys.append({"t": t, "bones": bones})

    if len(keys) < 2:
        return jsonify({"ok": False, "error": "키는 둘 이상이어야 한다."}), 400
    keys.sort(key=lambda k: k["t"])
    if len({k["t"] for k in keys}) != len(keys):
        return jsonify({"ok": False, "error": "같은 시간에 키가 둘이다."}), 400

    m = save_custom_motion(AVATAR, key, {"keys": keys, "duration": duration})
    print(f"[제스처] {m.label} ({key}) 적음 — 키 {len(keys)}개, {duration}s")
    return jsonify({"ok": True, "motion": m.to_dict()})


@app.route("/api/motions/custom/<key>", methods=["DELETE"])
def custom_motion_remove_api(key):
    from avatar import remove_custom_motion

    if not _from_this_pc():
        return jsonify({"ok": False, "error": "이 컴퓨터에서만 고칠 수 있다."}), 403
    if not remove_custom_motion(AVATAR, key):
        return jsonify({"ok": False, "error": "고친 적 없는 동작이다."}), 404
    m = next((x for x in AVATAR.motions if x.key == key), None)
    print(f"[제스처] {key} 원래대로")
    return jsonify({"ok": True, "motion": m.to_dict() if m else None})


@app.route("/api/motions/check", methods=["POST"])
def custom_motion_check_api():
    """저장된 값으로 몸 뚫림·팔꿈치 꺾임을 잰다(_verify_collision.py)."""
    import re
    import subprocess
    import sys

    if not _from_this_pc():
        return jsonify({"ok": False, "error": "이 컴퓨터에서만 검사할 수 있다."}), 403

    key = str((request.get_json(silent=True) or {}).get("key") or "")
    here = os.path.dirname(os.path.abspath(__file__))
    try:
        r = subprocess.run(
            [sys.executable, "_verify_collision.py"], cwd=here,
            capture_output=True, timeout=240,
            env=dict(os.environ, PYTHONIOENCODING="utf-8"))
    except subprocess.TimeoutExpired:
        return jsonify({"ok": False, "error": "검사가 4분을 넘겼다."}), 504

    out = r.stdout.decode("utf-8", "replace")
    line = next((ln.strip() for ln in out.splitlines()
                 if re.match(r"\s*(PASS|FAIL)\s+" + re.escape(key) + r"\s", ln)),
                None)
    if not line:
        return jsonify({"ok": False, "error": "검사 결과에서 이 동작을 못 찾았다.",
                        "raw": out[-800:]}), 500
    return jsonify({"ok": True, "pass": line.startswith("PASS"), "line": line})


# ============================================================
# 서버 실행
# ============================================================

if __name__ == "__main__":

    print(
        "========================================"
    )

    print(
        "    diamondAI 시스템을 시작합니다.      "
    )

    print(
        "========================================"
    )

    # 고칠 때마다 저절로 다시 읽는 것(debug)은 **만드는 동안만** 켠다.
    #
    # 켠 채로 밖에 열어 두면 안 된다. 오류가 나면 브라우저에
    # 코드가 그대로 펼쳐지고, 거기서 이 컴퓨터의 파이썬을 실행할 수
    # 있는 창구(Werkzeug 디버거)가 같이 열린다.
    #
    # 그래서 기본은 꺼 둔다. 만들 때는 시작.ps1 이 DIA_DEBUG=1 을
    # 넣어 주므로 예전과 똑같이 돈다.
    debug = os.environ.get("DIA_DEBUG", "").strip() in ("1", "true", "True")

    port = int(os.environ.get("PORT", "5000") or 5000)

    print("    " + ("만드는 중(고치면 다시 읽음)" if debug else "그냥 돌림")
          + " · 포트 " + str(port))

    app.run(
        host="0.0.0.0",
        port=port,
        debug=debug
    )

