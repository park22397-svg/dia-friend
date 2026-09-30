// system/commands.js — 채팅 칸 요소·표정 이름·명령어·도움말
// (시스템. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // DOM
        // ============================================================

        const speechBubble =
            document.getElementById(
                'speech-bubble'
            );

        const zzzIndicator =
            document.getElementById(
                'zzz-indicator'
            );

        const chatInput =
            document.getElementById(
                'chat-input'
            );

        const sendButton =
            document.getElementById(
                'send-btn'
            );

        // 지난 이야기 펼치기/접기.
        //
        // 좁은 화면에서는 이야기 칸을 감춰 두고 다이아에게 자리를 준다.
        // 말은 말풍선으로 보고, 지난 것을 훑고 싶을 때만 펼친다.
        (function () {
            const b = document.getElementById('log-toggle');

            if (!b) return;

            b.addEventListener('click', () => {
                document.body.classList.toggle('showlog');

                // 펼쳤으면 맨 아래(가장 최근)를 보여 준다
                if (document.body.classList.contains('showlog')) {
                    const box = document.getElementById('chat-messages');
                    if (box) box.scrollTop = box.scrollHeight;
                }
            });
        })();

       // ============================================================
        // 표정 이름
        // ============================================================

        const expressionNames = {

            neutral: '무표정',

            happy: '기쁨',

            sad: '슬픔',

            angry: '화남',

            surprised: '놀람',

            fun: '즐거움'
        };


        // ============================================================
        // 표정 명령어
        // ============================================================

               // ============================================================
        // 🎭 [유저님 전용] 다이아 고유 표정 100% 검증 테스트 명령어 엔진
        // ============================================================

        // 개체의 이름 말고 사람들이 흔히 쓰는 말들.
        // 개체가 그 표정을 갖고 있을 때만 쓰인다.
        const EXPRESSION_ALIASES = {
            '무표정': 'neutral',
            '슬퍼': 'sorrow',
            '기뻐': 'joy',
            '웃음': 'joy',
            '미소': 'fun',
            '재밌': 'joy',
        };


        function expressionList() {
            // 명령으로 지을 수 있는 표정만. 윙크나 눈 감기는 눈 상태다.
            return ((ENTITY && ENTITY.expressions) || [])
                .filter(e => e.is_reply_emotion !== false);
        }


        function expressionWords() {
            return expressionList().map(e => e.label);
        }


              function handleExpressionCommand(text) {

            if (
                !text.startsWith('/표정')
            ) {

                return false;
            }


            const command =
                text
                    .replace('/표정', '')
                    .trim()
                    .toLowerCase();


            // 표정 이름은 개체가 가지고 있다(기쁨·즐거움·슬픔·화남·놀람·평온).
            // 여기서 따로 이름을 들고 있으면 개체가 이름을 바꿔도 모르고,
            // 실제로 '미소'·'웃음'처럼 어긋난 이름이 남아 있었다.
            const expressionMap = {};
            const expressionNames = {};

            expressionList().forEach(e => {
                expressionMap[e.key] = e.key;
                expressionMap[String(e.label).toLowerCase()] = e.key;
                expressionNames[e.key] = e.label;
            });

            // 개체의 이름 말고도 흔히 쓰는 말 몇 개를 더 받는다
            Object.keys(EXPRESSION_ALIASES).forEach(word => {
                const key = EXPRESSION_ALIASES[word];
                if (expressionNames[key]) expressionMap[word] = key;
            });

            const expression =
                expressionMap[command];


            if (!expression) {

                appendMessage(
                    'ai',
                    '지을 수 있는 표정은 ' + expressionWords().join(', ') + ' 이야.'
                );

                return true;
            }


            wakeUp();

            resetTimers();

            stopLipSync();


            // 해당 고유 표정을 얼굴에 즉시 장착합니다.
            applyExpression(
                expression
            );


            // 화면에 깔끔하게 테스트 피드백 로그를 찍어줍니다.
            appendMessage(
                'ai',
                `표정 테스트: ${expressionNames[expression]}`
            );


            speechBubble.innerText =
                `표정 테스트: ${expressionNames[expression]}`;

            speechBubble.style.display =
                'block';


            if (bubbleHideTimer) {

                clearTimeout(
                    bubbleHideTimer
                );
            }

            if (window.expressionChangeTimer) {

                clearTimeout(
                    window.expressionChangeTimer
                );
            }


            // 🚀 [유저님의 최종 공식] 놀람은 딱 1초(1000ms), 그 외 모든 감정은 3초(3000ms) 유지 후 무표정 복귀!
            const duration =
                (expression === 'surprised')
                    ? 500
                    : 3000;


            window.expressionChangeTimer =
                setTimeout(() => {

                    applyExpression(
                        'neutral'
                    );

                }, duration);


            // 말풍선도 3초 뒤에 깔끔하게 닫히도록 맞춰줍니다.
            bubbleHideTimer =
                setTimeout(() => {

                    speechBubble.style.display =
                        'none';

                }, 3000);


            return true;
        }




        // ============================================================
        // 도움말
        // ============================================================

        // ------------------------------------------------------------
        // 기억 보관과 되찾기
        //
        //   /새 기억  지금까지의 기억을 옆에 치워 두고 빈 상태로 시작한다.
        //             지우는 것이 아니라 옮기는 것이라 언제든 되찾을 수 있다.
        //   /리셋     치워 뒀던 기억을 다시 꺼내 온다.
        //
        // 대화만이 아니라 관계와 호칭까지 함께 옮긴다. 대화만 지우고
        // 친밀도가 남으면 처음 만난 사이인데 말투는 그대로인 꼴이 된다.
        // ------------------------------------------------------------

        function clearChatLog() {
            const box = document.getElementById('chat-messages');
            if (box) box.innerHTML = '';
        }

        function reloadChatLog() {
            clearChatLog();
            return fetch('/api/history')
                .then(r => r.json())
                .then(list => {
                    if (!Array.isArray(list)) return;
                    // 너무 많으면 화면이 무거워진다. 최근 것만 보인다.
                    list.slice(-60).forEach(m => {
                        if (!m || !m.content) return;
                        appendMessage(m.role === 'user' ? 'user' : 'ai',
                                      m.content);
                    });
                })
                .catch(() => {});
        }

        function handleMemoryCommand(text) {
            const t = text.replace(/\s+/g, '');

            if (t !== '/새기억' && t !== '/리셋') return false;

            appendMessage('user', text);
            runMemoryCommand(t === '/새기억');
            return true;
        }

        async function runMemoryCommand(archive) {
            const url = archive
                ? '/api/memory/archive'
                : '/api/memory/restore';

            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: '{}'
                });

                const d = await res.json();

                if (!d.ok) {
                    appendMessage('ai', d.error || '하지 못했습니다.');
                    return;
                }

                if (archive) {
                    clearChatLog();
                    appendMessage('ai',
                        `지금까지의 기억 ${d.messages}개를 보관했습니다. `
                        + `(${d.name})\n처음부터 다시 시작합니다. `
                        + `/리셋 으로 되찾을 수 있습니다.`);
                } else {
                    await reloadChatLog();
                    appendMessage('ai',
                        `보관해 둔 기억 ${d.messages}개를 되찾았습니다. `
                        + `(${d.name})`);
                }

                // 사이가 통째로 바뀌었다. 눈금과 잠긴 도구를 다시 맞춘다.
                myAffinity = d.affinity;
                myStageKey = d.stage;
                affinityShown = null;      // 변화량 표시가 튀지 않게

                // 사이만 바꾸고 나머지를 그대로 두면 이름표가 거짓말을 한다.
                // 서버는 이미 비웠는데 화면만 옛 값을 들고 있는 일이 생긴다.
                myWarmth = null;
                myMood.level = 0;
                myMood.label = null;
                myLover.yes = false;
                buildAffinityMarks();
                setAffinity(d.affinity, d.stage_label);
                buildToolMenu();

                applyExpression('neutral');

                // 서버가 준 값으로 다시 맞춘다.
                // 어떤 경로로 바뀌었든 화면이 따라가게 하는 마지막 그물이다.
                refreshRelationship();

                resetTimers();
                startInactivityTimers();

            } catch (e) {
                console.warn('[diamondAI] 기억 명령 실패:', e);
                appendMessage('ai', '기억을 다루지 못했습니다.');
            }
        }


        // ------------------------------------------------------------
        // 동작 명령
        //
        //   /동작 쑥스러움   또는 그냥  /쑥스러움
        //
        // 어떤 말이 어떤 동작인지는 개체가 안다(motion_words).
        // 화면이 목록을 들고 있으면 동작을 늘릴 때마다 두 곳을 고쳐야 한다.
        // ------------------------------------------------------------

        function motionWords() {
            return (ENTITY && ENTITY.relationship
                && ENTITY.relationship.motion_words) || {};
        }

        function motionLabels() {
            // 사람이 읽을 이름만 추린다. 영어 키는 안내에 넣지 않는다.
            const keys = new Set((ENTITY.motions || []).map(m => m.key));
            return Object.keys(motionWords()).filter(w => !keys.has(w));
        }

        function handleMotionCommand(text) {
            const raw = text.trim();
            if (raw[0] !== '/') return false;

            let word = raw.slice(1).trim();
            if (word.startsWith('동작')) word = word.slice(2).trim();
            if (!word) return false;

            const key = motionWords()[word] || motionWords()[word.toLowerCase()];
            if (!key) return false;

            appendMessage('user', text);

            if (isSleeping) wakeUp();
            faceUser();

            roam.state = 'gesture';
            playMotion(key);

            const m = (ENTITY.motions || []).find(x => x.key === key);
            appendMessage('ai', '(' + (m ? m.label : key) + ')');

            return true;
        }


        // 배경이 여러 장일 때 다음 장으로 넘긴다.
        function handleBackgroundCommand(text) {

            if (text !== '/배경') return false;

            if (!backgrounds.list.length) {
                appendMessage('ai',
                    'static/background/ 에 이미지를 넣으면 배경으로 깔려. '
                    + '넣고 화면만 새로 고치면 돼.');
                return true;
            }

            const img = nextBackground();

            appendMessage('ai', img
                ? '배경: ' + img.name
                  + ' (' + (backgrounds.at + 1) + '/'
                  + backgrounds.list.length + ')'
                : '배경이 한 장뿐이야. 더 넣으면 넘길 수 있어.');

            return true;
        }


        // 옷 끌기가 왜 안 되는지 눈으로 보는 명령.
        // 어디서 끊기는지 알려면 화면 안의 상태를 봐야 한다.
        function handleClothCommand(text) {

            if (text !== '/옷' && text !== '/옷장') return false;

            const counts = Object.keys(PARTS)
                .map(k => k + ' ' + PARTS[k].length).join(', ');

            appendMessage('ai',
                '옷장 ' + wardrobe.length + '벌'
                + (wardrobe.length ? ' (' + wardrobe.map(w => w.key).join(', ') + ')' : '')
                + ' | 걸친 것: ' + (anyWorn().map(k => k + '=' + wornKeyOf(k)).join(', ') || '없음')
                + ' | 메시: ' + counts);

            return true;
        }


        // ------------------------------------------------------------
        // 호감도 되돌리기
        //
        // 기억은 그대로 두고 사이만 처음으로 돌린다.
        // ('/새 기억'은 기억까지 치운다. 이건 사이만 건드린다.)
        //
        // 숫자를 붙이면 그 값으로 맞춘다 — 단계별 말투를 시험할 때 쓴다.
        // ------------------------------------------------------------

        function handleAffinityCommand(text) {

            const t = text.replace(/\s+/g, '');

            if (t !== '/호감초기화' && t !== '/호감리셋'
                && !/^\/호감-?\d+$/.test(t)) {
                return false;
            }

            const num = t.match(/-?\d+$/);

            appendMessage('user', text);
            runAffinityReset(num ? parseInt(num[0], 10) : null);
            return true;
        }


        async function runAffinityReset(value) {

            try {
                const res = await fetch('/api/relationship/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(
                        value === null ? {} : { affinity: value })
                });

                const d = await res.json();

                if (!d.ok) {
                    appendMessage('ai', d.error || '되돌리지 못했습니다.');
                    return;
                }

                appendMessage('ai',
                    '호감도 ' + d.before + ' → ' + d.affinity
                    + ' (' + d.stage_label + ')');

                // 사이가 통째로 바뀌었다. 눈금과 잠긴 도구를 다시 맞춘다.
                myAffinity = d.affinity;
                myStageKey = d.stage;
                myWarmth = null;
                affinityShown = null;      // 변화량 표시가 튀지 않게

                buildAffinityMarks();
                setAffinity(d.affinity, d.stage_label);
                buildToolMenu();
                updateTouchZones();

                applyExpression('neutral');

            } catch (e) {
                console.warn('[diamondAI] 호감도 되돌리기 실패:', e);
                appendMessage('ai', '호감도를 되돌리지 못했습니다.');
            }
        }


        // ------------------------------------------------------------
        // 아이 — 시험용 명령어
        //
        // 절정 다섯 번을 손으로 채우지 않고도 배가 부른 모습을 봐야
        // 배 모양을 눈으로 맞출 수 있다.
        // ------------------------------------------------------------

        function handleChildCommand(text) {
            const t = text.replace(/\s+/g, '');

            return false;
        }


