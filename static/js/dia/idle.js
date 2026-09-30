// dia/idle.js — 혼자 있을 때 — 먼저 말 걸기·잠들기
// (다이아의 몸. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 비활동 타이머
        // ============================================================

        // 기다리는 시간도 개체가 정한다. 이 파일이 숫자를 들고 있지 않는다.
        function behaviorSec(key, fallback) {
            const b = (ENTITY && ENTITY.behavior) || {};
            const v = b[key];
            return (typeof v === 'number' && v > 0) ? v : fallback;
        }


        function startInactivityTimers() {

            resetTimers();

            // 조용해지면 다이아가 먼저 말을 건다.
            talkTimer = setTimeout(() => {

                if (isSleeping || isWaitingForAI) return;

                // 잠들기 타이머는 firstTalk 이 말을 마친 뒤에 건다.
                // showReply 가 끝에서 startInactivityTimers 를 다시 부르므로,
                // 여기서 미리 걸어두면 그때 지워진다.
                firstTalk();

            }, behaviorSec('first_talk_timeout_sec', 120) * 1000);
        }


        // ============================================================
        // 먼저 말 걸기
        //
        // 무슨 말을 거는지는 사이가 얼마나 깊은지에 달렸다.
        // 그 문장은 서버가 단계별로 들고 있으므로 여기서 정하지 않는다.
        // 화면이 문장을 쥐고 있으면 단계가 바뀌어도 같은 말만 하게 된다.
        // ============================================================

        async function firstTalk() {

            try {

                const res = await fetch('/api/first-talk');

                if (!res.ok) throw new Error('HTTP ' + res.status);

                const data = await res.json();

                if (data.place) goPlace(data.place);
                if (data.wear) applyWear(data.wear);

                // 먼저 걸 말이 없으면 조용히 넘어간다 조용히 넘어간다
                if (data.speak && data.reply) {

                    showReply(
                        data.reply,
                        data.expression || 'neutral',
                        data.cues
                    );
                }

                // 한동안 조용했다는 뜻이다. 이제 돌아다녀도 된다.
                mayRoam = true;

            } catch (e) {

                // 못 불러왔다고 아무 문장이나 대신 내보내면
                // 지금 사이와 어긋난 말이 나온다. 차라리 가만히 있는다.
                console.warn(
                    '[diamondAI] 먼저 말 걸기 실패, 이번엔 건너뜁니다.',
                    e
                );

            } finally {

                // 기다리는 사이에 상대가 말을 걸었다면 그쪽이 우선이다.
                // 그때는 답변이 오면서 타이머가 다시 걸린다.
                if (!isSleeping && !isWaitingForAI) {
                    armSleepTimer();
                }
            }
        }


        // ============================================================
        // 잠들기 타이머
        //
        // 먼저 말을 걸었는데도 대답이 없으면 잠든다.
        // 한 번 걸었으면 또 걸지 않으므로 말 걸기 타이머는 여기서 끈다.
        // ============================================================

        function armSleepTimer() {

            if (talkTimer) {
                clearTimeout(talkTimer);
                talkTimer = null;
            }

            if (sleepTimer) {
                clearTimeout(sleepTimer);
                sleepTimer = null;
            }

            // 잠들지 않는 단계가 있다. 상대가 조용해도 눈을 감지 않는다.
            //
            // 대신 다시 말을 건다. firstTalk 이 끝나면 이 함수를 또 부르니
            // 대답이 올 때까지 혼자 말이 이어진다.
            const s = curStage();

            if (s && s.never_sleeps) {

                sleepTimer = setTimeout(() => {

                    if (isSleeping || isWaitingForAI) return;

                    firstTalk();

                }, behaviorSec('nudge_timeout_sec', 45) * 1000);

                return;
            }

            sleepTimer = setTimeout(() => {

                if (isSleeping || isWaitingForAI) return;

                goToSleep();

            }, behaviorSec('sleep_timeout_sec', 120) * 1000);
        }


        // ============================================================
        // 타이머 초기화
        // ============================================================

        function resetTimers() {

            if (talkTimer) {

                clearTimeout(
                    talkTimer
                );

                talkTimer = null;
            }


            if (sleepTimer) {

                clearTimeout(
                    sleepTimer
                );

                sleepTimer = null;
            }
        }


        // ============================================================
        // 잠들기
        // ============================================================

        function goToSleep() {

            isSleeping = true;

            zzzIndicator.style.display =
                'block';

            speechBubble.style.display =
                'none';


            stopLipSync();

            // 표정을 먼저 지우고 눈을 감긴다.
            // 순서가 반대면 applyExpression 이 감긴 눈을 도로 지운다.
            applyExpression(
                'neutral'
            );

            setEyeState(true);
        }


