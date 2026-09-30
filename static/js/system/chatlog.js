// system/chatlog.js — 대화 창에 말 붙이기
// (시스템. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 채팅 메시지 추가 (유저님의 소중한 원본 로직을 100% 보존합니다)
        // ============================================================

        function appendMessage(
            role,
            text
        ) {

            const chatMessages =
                document.getElementById(
                    'chat-messages'
                );


            const msgDiv =
                document.createElement(
                    'div'
                );


            msgDiv.className =
                `msg ${
                    role === 'user'
                        ? 'user-msg'
                        : 'ai-msg'
                }`;


            // 괄호 안(상황)은 옅게. 다이아도 상대도 같은 규칙이다.
            renderSaid(msgDiv, text);


            chatMessages.appendChild(
                msgDiv
            );


            chatMessages.scrollTop =
                chatMessages.scrollHeight;
        }


