# ai_brain.py
# 예전 자리. 2026-10-01 에 둘로 나뉘었다 —
#   system/chat.py  대화 진행 (놀이 가로채기·만지기·고백·상황 모으기)
#   dia/mind.py     다이아의 생각 (모델에게 묻기·답 읽기·속마음·혼자 말 잇기)
#   dia/relation.py 사이 (말 한마디로 호감이 어떻게 움직이는가)
# 옛 이름으로 부르는 곳(main.py·검사)이 있어서 이름만 이어 준다.

from dia.mind import (  # noqa: F401
    SYSTEM_PROMPT,
    VALID_EXPRESSIONS,
    _fallback,
    _nudge_note,
    _polite,
    _unanswered_count,
    clean_reply,
    extract_cues,
    extract_expression,
    keep_talking,
    log_cues,
)
from dia.relation import update_relationship  # noqa: F401
from system.chat import detect_user_name, process_chat  # noqa: F401
from system.games.word_turn import (  # noqa: F401
    _wc_bump,
    _wc_load,
    _wc_save,
    _word_chain_turn,
)
