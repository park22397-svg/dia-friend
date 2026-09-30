// system/situation.js — 상황 칸
// (시스템. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 상황
        //
        // 괄호로 상황을 쓸 수 있는데 매번 생각해 내야 하는 것이 일이다.
        // 그래서 지금 흐름에 맞는 것을 몇 개 지어 준다.
        //
        // 짓는 것은 모델이지만 **고르는 것은 사람이다.** 클릭하지 않으면
        // 아무 일도 안 일어나고, 직접 쓰는 칸이 따로 있다.
        // 다이아가 제 이야기를 스스로 진행시키면 그건 대화가 아니다.
        //
        // 보기를 짓는 것도 모델을 부르는 일이라, 답을 마친 뒤에
        // 뒤에서 조용히 짓는다. 사람이 읽는 동안 준비된다.
        // ============================================================

        const sitChips = document.getElementById('situation-chips');
        const sitInput = document.getElementById('situation-input');
        const sitSend = document.getElementById('situation-send');
        const sitNew = document.getElementById('situation-new');

        let sitBusy = false;

        function showSituations(items) {
            sitChips.innerHTML = '';

            if (!items || !items.length) {
                const d = document.createElement('div');
                d.className = 'waiting';
                d.textContent = '(상황 보기가 아직 없다 — ↻ 로 지어 본다)';
                sitChips.appendChild(d);
                return;
            }

            items.forEach(t => {
                const b = document.createElement('button');
                b.textContent = '(' + t + ')';

                // 누르면 상황 칸에 담고 말 칸으로 넘어간다.
                //
                // 바로 보내지 않는 것은 두 칸을 하나로 합쳤기 때문이다.
                // 담아 두면 거기에 말을 얹어 함께 보낼 수 있다 —
                //   (다이아를 지긋이 바라본다) 다이아 사랑해
                // 얹을 말이 없으면 그대로 엔터를 누르면 된다.
                //
                // 예전에는 여기서 sendSituation(t) 를 불렀는데,
                // 두 칸을 합치면서 그 함수가 사라져 누르면 아무 일도
                // 일어나지 않았다.
                b.addEventListener('click', () => {
                    sitInput.value = t;
                    chatInput.focus();
                });

                sitChips.appendChild(b);
            });
        }

        async function makeSituations() {
            if (sitBusy) return;
            sitBusy = true;
            sitNew.disabled = true;

            sitChips.innerHTML =
                '<div class="waiting">상황을 짓는 중…</div>';

            try {
                const d = await fetch('/api/suggest', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}',
                }).then(r => r.json());

                showSituations(d.ok ? d.items : null);

            } catch (e) {
                console.warn('[diamondAI] 상황 짓기 실패:', e);
                showSituations(null);
            } finally {
                sitBusy = false;
                sitNew.disabled = false;
            }
        }

        // 상황 하나를 보낸다.
        //
        // 괄호로 감싸서 보내면 지금까지 쓰던 '글로 만지기' 가 그대로
        // 받는다. 아는 행동이면 표를 태우고, 모르는 행동이면 모델이
        // 상황으로 읽는다. 새로 만든 길이 아니라 있던 길이다.
        // 두 칸을 하나로 보낸다.
        //
        // 상황만 썼으면 상황만, 말만 썼으면 말만, 둘 다 썼으면 함께 나간다.
        //   (다이아를 지긋이 바라본다) 다이아 사랑해
        //
        // 따로 보내면 두 줄이 되어 다이아가 두 번 답한다. 사람은 그렇게
        // 말하지 않는다 — 바라보면서 말하는 것은 한 번의 일이다.
        //
        // 어느 칸에서 엔터를 누르든 여기로 온다.
        function sendBoth() {
            const sit = String(sitInput.value || '')
                .trim().replace(/^\(|\)$/g, '').trim();
            const msg = String(chatInput.value || '').trim();

            if (!sit && !msg) return;

            chatInput.value = sit
                ? ('(' + sit + ')' + (msg ? ' ' + msg : ''))
                : msg;

            sitInput.value = '';
            sendMessage();
        }

        sitSend.addEventListener('click', sendBoth);

        sitInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendBoth();
            }
        });

        sitNew.addEventListener('click', makeSituations);


        // 목소리를 켜고 끈다.
        function handleVoiceCommand(text) {

            const t = text.replace(/\s+/g, '');
            if (t !== '/목소리' && t !== '/음성') return false;

            appendMessage('user', text);

            voice.on = !voice.on;
            if (!voice.on) stopVoice();

            appendMessage('ai',
                voice.on
                    ? '목소리 켬 — ' + voice.provider
                      + (voice.pick ? ' (' + voice.pick.name + ')' : '')
                    : '목소리 끔');

            return true;
        }


        function handleHelpCommand(text) {

            if (
                text !== '/도움말' &&
                text !== '/help'
            ) {

                return false;
            }


            appendMessage(
                'ai',
                `사용 가능한 명령어:

`
                // 표정 목록은 개체에서 가져온다.
                // 적어 두면 개체가 이름을 바꿔도 여기만 옛 이름으로 남는다.
                + expressionWords().map(w => '/표정 ' + w).join('\n')
                + `

`
                + motionLabels().map(w => '/' + w).join('\n')
                + `

/새 기억   지금 기억을 보관해 두고 처음부터 다시
/리셋      보관해 둔 기억을 되찾기

/배경      배경 이미지 넘기기 (static/background/ 에 넣는다)
/목소리    소리 켜고 끄기

/호감 초기화   사이를 처음으로 (기억은 그대로 둔다)
/호감 <숫자>   그 값으로 맞추기 (예: /호감 300)

/옷장      지금 옷장에 무엇이 걸려 있는지

/기억삭제  (되돌릴 수 없음)

/도움말`
            );


            return true;
        }


