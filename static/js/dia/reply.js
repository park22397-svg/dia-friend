// dia/reply.js — 깨우기·답을 몸으로 보이기
// (다이아의 몸. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 깨우기
        // ============================================================

        function wakeUp() {

            isSleeping = false;

            zzzIndicator.style.display =
                'none';

            setEyeState(false);

            resetToAttentionPose();
        }


        // ============================================================
        // AI 응답 표시
        // ============================================================

                                function showReply(
            reply,
            expression,
            cues
        ) {

            // 말을 하면 깨어 있는 것이다.
            //
            // 놀이 창에서 부를 때 이것이 없어서, 자는 채로 말하고
            // 눈은 감긴 채 눈꺼풀만 움직였다. 놀이마다 한 줄씩 넣는
            // 대신 여기 한 곳에 둔다 — 다음에 뭘 더 붙여도 따라온다.
            if (isSleeping) wakeUp();

            appendMessage(
                'ai',
                reply
            );


            // 상황(괄호)은 옅게, 말은 그대로.
            renderSaid(speechBubble, reply);

            speechBubble.style.display =
                'block';


            // 소리 내어 읽을 부분.
            //
            // 상황까지 읽으면 다이아가 자기 행동을 중계하는 꼴이 된다.
            // 상황만 있는 답이면 이 값이 빈 글자이고, 그때는 소리가 없다.
            const spoken = spokenPart(reply);


            // 표정을 얼마나 붙들지 정하는 데만 쓴다.
            // 말풍선 시각은 armBubbleHide 가 소리 길이로 따로 정한다.
            const totalSeconds = Math.max(reply.length, 30);


            applyExpression(
                expression
            );


            // 말풍선을 우선 어림값으로 걸어 둔다.
            // speak() 가 답을 못 주고 끝나도 말풍선이 영영 남지는 않는다.
            //
            // 상황만 있는 답은 소리가 없어 잴 길이도 없다.
            // 그래도 읽을 시간은 줘야 하므로 글자 수로 어림한다.
            armBubbleHide(spoken ? guessSpeakMs(spoken) : readMs(reply));

            if (!spoken) {
                // 말 없이 몸만 움직인 답. 입은 다문 채로 둔다.
                stopVoice();
            } else {

            // 소리를 내고, 그 길이에 입과 말풍선을 맞춘다.
            //
            // 브라우저 목소리는 미리 길이를 알 수 없어 0 이 온다.
            // 그때는 어림값 그대로 둔다 — 대신 첫 문장을 말해 보고
            // 잰 속도(voice.msPerChar)가 다음 문장부터 반영된다.
            speak(spoken).then(ms => {
                playLipSync(spoken, ms);
                if (ms > 0) armBubbleHide(ms);
            });

            }


            // 서버가 걷어낸 이모지·괄호를 그 자리에서 표정과 몸짓으로 되살린다.
            //
            // 되돌아갈 얼굴은 평온이 아니라 '이 답변의 얼굴'이다.
            // 문장 중간에 째려봤다고 해서 그 뒤가 무표정일 이유는 없다.
            // 말하는 길이도 넘겨준다 — 말이 끝나기도 전에 얼굴이 꺼지면
            // 문장 뒤쪽이 무표정으로 흘러간다.
            playCues(cues, expression, reply.length);


            if (window.expressionChangeTimer) {
                clearTimeout(window.expressionChangeTimer);
            }


            // 🚀 [유저님의 최종 공식] 놀람은 딱 0.5초(0.5000ms), 그 외 감정들은 2초(2000ms) 유지 후 무표정 전환!
            if (totalSeconds > 3 && expression !== 'neutral') {
                const duration = (expression === 'surprised') ? 1000 : 3000;
                
                window.expressionChangeTimer = setTimeout(() => {
                    applyExpression('neutral');
                }, duration);
            }


            startInactivityTimers();

            // 답을 마쳤으니 다음 상황 보기를 뒤에서 짓는다.
            // 사람이 이 말을 읽는 동안 준비된다.
            setTimeout(makeSituations, 400);
        }




