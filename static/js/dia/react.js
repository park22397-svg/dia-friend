// dia/react.js — 판에서 일어난 일에 다이아가 반응한다
// (다이아의 몸. 2026-10-01, 나누기 2단계)
//
// 시스템이 "무슨 일이 있었다" 만 건네면(system/events.js), 몸은 바로
// 반응하고 말은 다이아가 그때 마음으로 지어 조금 뒤에 온다
// (/api/dia/react — 서버의 dia/mind.react).
//
// 판이 끝난 일(big)은 늘 말한다. 판이 출렁인 일(medium)은 방금 말했거나
// 말하는 중이면 건너뛴다 — 수마다 떠들면 시끄럽고, 사람도 그러지 않는다.

        const diaReactState = {
            busy: false,
            lastAt: 0,
        };

        // 판이 출렁인 일에 다시 말하기까지 쉬는 시간(ms)
        const DIA_REACT_REST_MS = 15000;

        function diaBodyReact(expression, motion) {
            try {
                if (expression && expression !== 'neutral') applyExpression(expression);
                if (motion) playMotion(motion);
            } catch (e) {
                console.warn('[diamondAI] 몸 반응 실패', e);
            }
        }

        async function diaReact(ev) {
            if (!ev || !ev.game || !ev.kind) return;

            const big = ev.weight === 'big';
            const now = performance.now();

            if (!big) {
                if (diaReactState.busy) return;
                if (now - diaReactState.lastAt < DIA_REACT_REST_MS) return;
                if (typeof isSpeaking === 'function' && isSpeaking()) return;
            }

            diaReactState.busy = true;
            diaReactState.lastAt = now;

            try {
                const d = await fetch('/api/dia/react', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ event: ev }),
                }).then(r => r.json());

                if (d && d.ok && d.reply) {
                    faceUser();
                    showReply(d.reply, d.expression || 'neutral', d.cues || []);
                }
            } catch (e) {
                console.warn('[diamondAI] 다이아 반응 실패', e);
            } finally {
                diaReactState.busy = false;
                diaReactState.lastAt = performance.now();
            }
        }
