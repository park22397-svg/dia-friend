# config.py - Ollama 모델명 업데이트

import os

# 모델 서버가 어디 있는가.
#
# 내 컴퓨터에서는 그 주소로 바로 닿는다(40ms). 그런데 **올린 데서는
# 못 닿는다** — Vercel 미국도 서울도 연결 자체가 안 됐다. 바깥으로
# 나가는 것은 되므로(목소리는 1.3초로 온다) 그 서버·그 포트만 막힌
# 것이다.
#
# 그래서 올린 데서는 터널 주소를 넣는다. 내 컴퓨터에서 cloudflared 가
# 그 서버로 이어 주고, 터널은 https(443)로 나가므로 막히지 않는다.
#
#   _tools/cloudflared.exe tunnel --url http://cju.nezip.co.kr:11434
#
# 터널 주소는 띄울 때마다 바뀐다. 바뀌면 Vercel 의 OLLAMA_URL 도
# 같이 바꿔야 한다.
OLLAMA_URL = os.environ.get("OLLAMA_URL", "").strip()     or "http://cju.nezip.co.kr:11434/api/chat"


# 터널 주소는 띄울 때마다 바뀐다.
#
# 환경변수에만 두면 바뀔 때마다 값을 고치고 **다시 배포해야** 한다.
# 그러면 못 쓴다 — 컴퓨터를 켤 때마다 배포할 수는 없다.
#
# 그래서 저장소에 적어 두고 부를 때마다 읽는다. 터널을 새로 띄우면
# _tunnel.py 가 이 값만 바꾸고, 올린 데는 다음 대화부터 그리로 간다.
#
# 매번 읽으면 대화마다 한 번씩 더 오가므로 잠깐 담아 둔다.
RUNTIME_KEY = "runtime.json"
RUNTIME_CACHE_SEC = 45

_runtime = {"at": 0.0, "url": None}


def ollama_url():
    """지금 모델 서버가 어디인가.

    저장소에 적힌 것이 있으면 그것, 없으면 환경변수나 정해 둔 값.
    """
    import time

    now = time.time()

    if now - _runtime["at"] < RUNTIME_CACHE_SEC:
        return _runtime["url"] or OLLAMA_URL

    _runtime["at"] = now

    try:
        import store
        got = (store.read_json(RUNTIME_KEY) or {}).get("ollama_url")
        _runtime["url"] = str(got).strip() if got else None
    except Exception as e:
        print("[모델 주소 읽기 실패]", e)
        _runtime["url"] = None

    return _dns_safe(_runtime["url"] or OLLAMA_URL)


# ============================================================
# 이름이 안 풀릴 때
#
# cju.nezip.co.kr 이 안 풀려서 대화가 통째로 막힌 적이 있다.
# 서버는 멀쩡했다 — IP 로는 0.03초에 닿았다. 이름을 알려 주는 쪽이
# 죽어 있었던 것이다.
#
# 이름을 먼저 써 보고, 안 풀리면 적어 둔 IP 로 바꿔 부른다.
# 이름을 버리지 않는 이유: IP 는 바뀔 수 있고, 그때 이름이 다시
# 살아 있으면 저절로 그쪽으로 돌아간다.
# ============================================================

# 이름이 안 풀릴 때 대신 쓸 자리
KNOWN_IP = {
    "cju.nezip.co.kr": "203.252.241.34",
}

_dns = {}


def _dns_safe(url):
    """이름이 안 풀리면 IP 로 바꾼 주소를 돌려준다."""
    import socket
    import time
    from urllib.parse import urlsplit, urlunsplit

    try:
        parts = urlsplit(url)
        host = parts.hostname
    except Exception:
        return url

    if not host or host not in KNOWN_IP:
        return url

    now = time.time()
    seen = _dns.get(host)

    # 한 번 본 것은 2분 담아 둔다. 대화마다 이름을 물으면
    # 안 풀릴 때 그만큼씩 기다린다.
    if seen and now - seen[0] < 120:
        ok = seen[1]
    else:
        try:
            socket.setdefaulttimeout(2)
            socket.getaddrinfo(host, None)
            ok = True
        except Exception:
            ok = False
        finally:
            socket.setdefaulttimeout(None)

        _dns[host] = (now, ok)

        if not ok:
            print(f"[모델 주소] '{host}' 이름이 안 풀려 "
                  f"{KNOWN_IP[host]} 로 부릅니다.")

    if ok:
        return url

    netloc = parts.netloc.replace(host, KNOWN_IP[host])

    return urlunsplit((parts.scheme, netloc, parts.path,
                       parts.query, parts.fragment))


# 모델 비교 결과 gemma4:31b 로 교체 (2026-08-13)
#
# 같은 조건에서 3턴씩 재본 결과:
#   gemma3:4b        지시한 말투를 아예 못 지킴 (기록의 말투를 그대로 흉내)
#   gemma3:12b       한 답변 안에서 존대/반말 혼용
#   exaone3.5:32b    혼용
#   qwen3.6:27b      정확하지만 평균 35초
#   gemma4:12b       정확, 평균 10.0초
#   gemma4:31b       정확, 평균 8.0초  <- 가장 빠르고 가장 정확
#
# 크기가 크지만 서버에서 오히려 더 빨랐다.
OLLAMA_MODEL = "gemma4:12b"

# ------------------------------------------------------------------
# 눈
#
# 말하는 모델(gemma4:12b)은 그림을 못 본다. 그래서 보는 일만 하는
# 모델을 따로 둔다. 이 모델은 다이아가 아니다 — 무엇이 보이는지만
# 한국어로 적어 주고, 그것을 보고 무슨 말을 할지는 다이아가 정한다.
#
# 눈에 성격을 주면 안 된다. 그림을 보는 모델이 대신 말하기 시작하면
# 다이아의 말투도, 사이도, 기억도 모르는 다른 사람이 답하는 꼴이 된다.
#
# 서버에 있는 것: qwen3-vl:8b (6.1G) · qwen2.5vl:latest (6.0G)
# 실측 — qwen3-vl 230토큰/초, qwen2.5vl 260토큰/초. 둘 다 잘 본다.
# ------------------------------------------------------------------

VISION_ENABLED = True
VISION_MODEL = "qwen3-vl:8b"

# 2026-08-19 에 31b 에서 12b 로 내렸다.
#
# 31b 가 느려진 것은 모델 탓이 아니라 그 서버에 큰 모델이 셋 동시에
# 올라가(31b 18.6GB + qwen3.8:27b 18.5GB + 12b 9.8GB) VRAM 을 넘겨서다.
# 넘친 만큼 CPU 로 내려가 5.5토큰/초까지 떨어졌다.
#
# 같은 조건에서 잰 값 (_bench_warm.py, 친구 단계·기록은 존댓말로 어긋냄)
#     gemma4:12b   평균 15.5초   말투 6/6   호칭오류 0
#     gemma4:31b   평균 68.5초   말투 6/6   호칭오류 0
# 얀데레 단계에서는 12b 131토큰/초 · 31b 5.5토큰/초 로 더 벌어졌다.
#
# 말투 정확도가 같아서 내렸다. 서버가 정리되면 31b 로 되돌려도 된다 —
# 그때는 다시 재 보고 정할 것.


# ============================================================
# 속생각 끄기
#
# gemma4 는 답을 내기 전에 속생각을 길게 쓴다.
# 그 글은 message.thinking 으로 따로 오고 화면에는 쓰이지 않는데,
# 생성 시간은 고스란히 든다.
#
# 실측 (2026-08-14, 같은 질문·같은 기록):
#   친구 단계   생각 켬  13.9초 (802토큰, 속생각 2316자, 답변 188자)
#   친구 단계   생각 끔   4.2초 (120토큰, 속생각    0자, 답변 215자)
#   광기 단계   생각 켬  12.0초 (663토큰, 속생각 1338자, 답변 510자)
#   광기 단계   생각 끔   6.0초 (230토큰, 속생각    0자, 답변 461자)
#
# 답변은 짧아지지 않았고 말투도 그대로였다. 켤 이유가 없다.
# 서버가 이 항목을 모르면 ai_brain 이 알아서 빼고 다시 보낸다.
# ============================================================

OLLAMA_THINK = False

MEMORY_FILE_PATH = "memory_store.json"
FIRST_TALK_TIMEOUT = 120
SLEEP_TIMEOUT = 120


# ============================================================
# 생성 옵션
#
# 기본값(temperature 0.8)은 문장이 매번 크게 달라진다.
# 말투와 문법을 일정하게 유지하려면 낮춰야 한다.
# ============================================================

OLLAMA_OPTIONS = {
    "temperature": 0.6,
    "top_p": 0.9,
    "repeat_penalty": 1.12,
    "num_ctx": 8192,
}


# ============================================================
# 모델에게 함께 보낼 지난 대화의 개수
#
# 전부 보내면 오래전 다른 말투로 한 답변까지 예시가 되어
# 모델이 지시문 대신 그것을 따라간다.
# ============================================================

MAX_HISTORY_MESSAGES = 12

# ============================================================
# 목소리 (TTS)
#
# **지금은 Edge 선희(edge-tts) — 키도 횟수 제한도 없다.** (2026-10-06)
#
# 사용자가 Downloads/free_tts_normal.mp3 를 골랐다. 그 파일은 edge-tts
# 형식(24kHz·48kbps 모노 mp3)이고, 목소리 후보의 "00b SunHi 보통 속도"와
# 같은 문장·같은 결인데 음만 낮다(중앙값 210Hz, 00b 는 225Hz).
# 처음에는 보통 속도(+0%)·음 -12Hz 로 맞췄는데 "너무 낮고 느리다" 해서
# +20%·+0Hz 로 올렸다(2026-10-06).
#
# 다른 하나는 Gemini 레다(2026-10-02~06). 목소리는 좋지만 무료 키가
# 분당 3번(GenerateRequestsPerMinutePerProjectPerModel-FreeTier)이라
# 대화 중에 자주 끊겼다. TTS_PROVIDER 를 "gemini" 로 두면 돌아간다.
#
# 어느 쪽이든 못 만들면 다른 목소리로 내려가지 않는다 — 그 말은
# 조용히 넘어가고 콘솔에 왜 그런지 남는다.
# 같은 말은 _voice_cache 에 떠 두어 두 번째부터는 다시 안 만든다.
# ============================================================

TTS_ENABLED = True

# "edge" 또는 "gemini"
TTS_PROVIDER = os.environ.get("TTS_PROVIDER", "").strip() or "edge"

# edge 를 쓸 때. rate·pitch 는 문자열이다("+10%", "-5Hz" 처럼).
TTS_EDGE_VOICE = "ko-KR-SunHiNeural"
TTS_EDGE_RATE = "+20%"
TTS_EDGE_PITCH = "+0Hz"

# gemini 를 쓸 때의 목소리
TTS_VOICE = "Leda"


def _gemini_key():
    """목소리 열쇠를 찾아 온다. 없으면 빈 문자열.

    **이 파일에 직접 적지 않는다.** config.py 는 저장소에 올라간다.
    `.secret_key` 와 같은 방식으로 옆에 파일로 두고 읽는다 —
    `.gemini_key` 는 .gitignore 와 .vercelignore 양쪽에서 뺐다.

    올린 데서는 그 파일이 짐에 안 실리므로 환경변수로 준다.
    """
    got = os.environ.get("GEMINI_API_KEY", "").strip()

    if got:
        return got

    here = os.path.dirname(os.path.abspath(__file__))

    try:
        with open(os.path.join(here, ".gemini_key"), encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""


TTS_API_KEY = _gemini_key()

TTS_MODEL = "gemini-2.5-flash-preview-tts"

# 말투 지시. gemini 는 이 문장대로 읽어 준다.
#
# 사용자가 고른 견본 tts_leda_soft.mp3 (레다, 부드럽게)에 맞췄다.
# 견본은 음 높이 중앙값 189Hz 로 기본(217Hz)보다 낮고 차분하다.
# 이 문장이 191Hz 로 가장 가까웠다(2026-10-02).
#
# "softly"·"속삭이듯" 을 쓰면 **속삭임**(성대가 안 울림)이 나온다.
# 그래서 "not whispering" 을 꼭 붙인다.
TTS_STYLE = ("In a soft, warm, calm speaking voice (not whispering), "
             "slightly low pitch")
