// system/events.js — 놀이 사건 나르기
// (시스템. 2026-10-01, 나누기 2단계)
//
// 놀이 경로는 판에서 일어난 일을 답에 "event" 로 실어 보낸다(서버의
// system/games/events.py). 판마다 답을 받는 함수가 따로라서 한 곳에서
// 받으려고 fetch 를 감싼다 — 놀이 경로의 답만 들여다보고, 답 자체는
// 그대로 넘긴다(판 그리기는 예전과 똑같이 돈다).
//
// 받은 일을 어떻게 느끼고 뭐라고 할지는 다이아 쪽(dia/react.js)이 정한다.

        (function () {
            const GAME_API = /^\/api\/(rps|chess|gomoku|halli|janggi|first)(\/|$)/;
            const plain = window.fetch.bind(window);

            window.fetch = function (input, init) {
                const url = typeof input === 'string' ? input : (input && input.url) || '';
                const p = plain(input, init);

                let path = url;
                try { path = new URL(url, location.href).pathname; } catch (e) {}

                if (!GAME_API.test(path)) return p;

                return p.then(res => {
                    try {
                        res.clone().json().then(d => {
                            if (!d || typeof d !== 'object') return;

                            // 말이 없는 답이면 몸만 바로 반응한다
                            const said = d.reply || d.line;
                            if (!said && (d.expression || d.motion)) {
                                diaBodyReact(d.expression, d.motion);
                            }

                            if (d.event) diaReact(d.event);
                        }).catch(() => {});
                    } catch (e) {}
                    return res;
                });
            };
        })();
