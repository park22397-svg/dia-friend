// dia/cues.js — 말 속 표시(몸짓·표정) 되살리기
// (다이아의 몸. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 서버가 걷어낸 표시를 그 자리에서 되살린다
        // ============================================================

        let cueTimers = [];

        function playCues(cues, baseFace, replyLen) {
            cueTimers.forEach(clearTimeout);
            cueTimers = [];
            if (!cues || !cues.length || !ENTITY) return;

            const tick = ENTITY.behavior.lipsync_tick_ms || 100;
            const home = baseFace || 'neutral';
            const total = (replyLen || 0) * tick;

            // 몸짓이 앞뒤로 붙으면 뭉개진다. 앞 몸짓이 끝날 즈음으로 민다.
            let freeAt = 0;

            cues.forEach((c, idx) => {

                const at = (c.at || 0) * tick;

                if (c.type === 'expression') {

                    // 이 얼굴을 언제까지 지을지.
                    //
                    // 다음 표시가 있으면 거기까지, 없으면 말이 끝날 때까지다.
                    // 정해 둔 유지 시간보다 짧아지지는 않게 한다.
                    let until = total - at;
                    for (let k = idx + 1; k < cues.length; k++) {
                        if (cues[k].type !== 'expression') continue;
                        until = (cues[k].at || 0) * tick - at;
                        break;
                    }

                    const ms = Math.max(c.hold_ms || 3000, Math.min(until, 8000));

                    cueTimers.push(setTimeout(() => {
                        applyExpression(c.key);

                        if (window.expressionChangeTimer) {
                            clearTimeout(window.expressionChangeTimer);
                        }
                        window.expressionChangeTimer = setTimeout(() => {
                            // 평온이 아니라 이 답변의 얼굴로 돌아간다
                            applyExpression(home);
                        }, ms);
                    }, at));

                    return;
                }

                if (c.type === 'motion' && roam.state !== 'move') {

                    const m = motionByKey(c.key);
                    const span = ((m ? m.duration : 2.2) * 1000)
                        + (c.linger_ms || 0);

                    // 앞 몸짓이 아직 도는 중이면 그 뒤로 민다
                    const when = Math.max(at, freeAt);
                    freeAt = when + span;

                    cueTimers.push(setTimeout(() => {
                        roam.state = 'gesture';
                        playMotion(c.key, {
                            spoken: true,
                            linger_ms: c.linger_ms,
                        });

                        // 세기가 실려 온 몸짓은 얼굴도 같이 짓는다.
                        // 몸짓과 얼굴이 같이 시작해 같이 끝나야 한다.
                        if (c.face) {
                            applyExpression(c.face);

                            if (window.expressionChangeTimer) {
                                clearTimeout(window.expressionChangeTimer);
                            }
                            window.expressionChangeTimer = setTimeout(() => {
                                applyExpression(home);
                            }, span);
                        }
                    }, when));
                }
            });
        }


