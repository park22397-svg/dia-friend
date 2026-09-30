// system/who.js — 누구로 들어와 있는가
// (시스템. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 누구로 들어와 있는가
        //
        // 기억은 계정마다 따로다. 그래서 화면 어딘가에 지금 누구인지가
        // 보여야 한다 — 남의 계정으로 들어와 있는 줄 모르고 이야기하면
        // 그 기억이 남의 자리에 쌓인다.
        // ============================================================

        const whoName = document.getElementById('who-name');
        const whoOut = document.getElementById('who-out');

        async function refreshWho() {
            try {
                const r = await fetch('/api/whoami').then(r => r.json());

                if (!r.user) {
                    location.href = '/login';
                    return;
                }

                whoName.textContent = r.user;

            } catch (e) {
                console.warn('[diamondAI] 누구인지 못 물어봄', e);
            }
        }

        whoOut.addEventListener('click', async () => {
            whoOut.disabled = true;

            try {
                await fetch('/api/logout', { method: 'POST' });
            } catch (e) {
                // 못 나가도 화면은 로그인으로 보낸다. 쿠키는 서버가 지운다.
            }

            location.href = '/login';
        });

        refreshWho();

