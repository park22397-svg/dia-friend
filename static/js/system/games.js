// system/games.js — 놀이 판 — 장기·할리갈리·오목·체스·말로 부르기·선공·한 판 더
// (시스템. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 체스
        //
        // 규칙과 다이아의 수는 서버가 정한다. 여기는 판을 그리고
        // 누른 자리를 수로 바꿔 보내는 일만 한다.
        //
        // 둘 수 있는 수 목록(moves)을 서버가 같이 주므로 화면은 규칙을
        // 몰라도 된다. 규칙을 여기에도 적으면 서버와 어긋나고,
        // 어긋나면 **화면에서는 되는데 서버가 거부하는** 수가 생긴다.
        // ============================================================

        const chessPanel = document.getElementById('chess-panel');
        // ============================================================
        // 장기
        //
        // 규칙과 다이아의 수는 서버가 정한다. 화면은 판을 그리고,
        // 말을 고르면 **갈 수 있는 곳을 서버에 물어** 짚어 준다.
        // 규칙을 화면에도 적으면 서버와 어긋난다 — 포·마상 막힘은
        // 특히 손으로 짜면 틀리기 쉽다.
        // ============================================================

        const jgPanel = document.getElementById('jg-panel');
        const jgBoard = document.getElementById('jg-board');
        const jgTurn = document.getElementById('jg-turn');
        const jgMsg = document.getElementById('jg-msg');
        const jgLevels = document.getElementById('jg-levels');

        const jg = {
            rows: [], open: false, busy: false,
            level: 'normal', levels: [],
            pick: null,       // 고른 말
            can: [],          // 그 말이 갈 수 있는 곳
            last: null,       // 다이아가 마지막에 둔 자리
            names: {},
        };

        function jgPalace(r, c) {
            return (c >= 3 && c <= 5) && ((r >= 0 && r <= 2) || (r >= 7 && r <= 9));
        }

        function drawJg() {
            jgBoard.innerHTML = '';

            jg.rows.forEach((row, r) => {
                for (let c = 0; c < row.length; c++) {
                    const ch = row[c];
                    const i = r * row.length + c;

                    const sq = document.createElement('div');
                    sq.className = 'jsq'
                        + (jgPalace(r, c) ? ' palace' : '')
                        + (jg.pick === i ? ' pick' : '')
                        + (jg.can.indexOf(i) >= 0 ? ' can' : '')
                        + (jg.last === i ? ' last' : '');
                    sq.dataset.at = i;

                    if (ch !== '.') {
                        const p = document.createElement('div');
                        // 대문자가 한(아래·사람), 소문자가 초(위·다이아)
                        p.className = 'jp ' + (ch === ch.toUpperCase() ? 'han' : 'cho');
                        p.textContent = jg.names[ch.toUpperCase()] || ch;
                        sq.appendChild(p);
                    }

                    jgBoard.appendChild(sq);
                }
            });
        }

        function drawJgLevels() {
            jgLevels.innerHTML = '';
            (jg.levels || []).forEach(lv => {
                const b = document.createElement('button');
                b.textContent = lv.label;
                b.className = (lv.key === jg.level) ? 'on' : '';
                b.onclick = async () => {
                    jg.level = lv.key;
                    drawJgLevels();
                    try {
                        await fetch('/api/janggi/level', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ level: lv.key }),
                        });
                    } catch (e) {}
                };
                jgLevels.appendChild(b);
            });
        }

        function applyJg(d) {
            if (!d || d.ok === false) {
                jgMsg.textContent = (d && d.error) || '뭔가 잘못됐다';
                return;
            }

            // 판이 움직였으면 마주 앉은 것이다 — 자고 있으면 깨운다.
            // 열기·새 판·한 수·기권이 전부 여기를 지난다(체스는 openChess).
            if (isSleeping) wakeUp();

            if (d.rows) jg.rows = d.rows;
            if (d.names) jg.names = d.names;
            if (d.levels) jg.levels = d.levels;
            if (d.level) jg.level = d.level;
            if (typeof d.spot === 'number') jg.last = d.spot;

            jg.open = !!d.open;
            jg.pick = null;
            jg.can = [];

            drawJg();
            drawJgLevels();

            jgTurn.textContent = jg.open
                ? '장기 — 당신은 한(붉은 쪽)'
                : (d.winner ? (d.winner === 'you' ? '이겼다' : '다이아가 이겼다')
                            : '판이 닫혔다');

            const reply = takeLead(d.reply);

            jgMsg.textContent = reply || '';

            if (reply) showReply(reply, d.expression || 'neutral', []);

            // 판이 끝나 한 판 더 할지 물었다 — 다음 말을 답으로 읽는다
            if (d.again) setAgain(d.again);
        }

        async function jgCall(path, body) {
            if (jg.busy) return;
            jg.busy = true;

            try {
                const r = await fetch(path, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body || {}),
                });
                applyJg(await r.json());
            } catch (e) {
                jgMsg.textContent = '서버와 연결이 안 된다';
            } finally {
                jg.busy = false;
            }
        }

        jgBoard.addEventListener('click', async ev => {
            const sq = ev.target.closest('.jsq');
            if (!sq || !jg.open || jg.busy) return;

            const at = parseInt(sq.dataset.at, 10);

            // 이미 고른 말이 있고 갈 수 있는 곳을 눌렀으면 둔다
            if (jg.pick !== null && jg.can.indexOf(at) >= 0) {
                jgCall('/api/janggi/move', { from: jg.pick, to: at });
                return;
            }

            // 아니면 그 자리의 말을 고른다. 갈 곳은 서버에 묻는다.
            jg.pick = at;
            jg.can = [];
            drawJg();

            try {
                const d = await fetch('/api/janggi/moves?from=' + at)
                    .then(r => r.json());
                jg.can = d.moves || [];

                if (!jg.can.length) jg.pick = null;

                drawJg();
            } catch (e) {
                jg.pick = null;
                drawJg();
            }
        });

        document.getElementById('jg-open').addEventListener('click', async () => {
            const on = jgPanel.classList.toggle('on');
            document.getElementById('jg-open').classList.toggle('on', on);

            if (!on) { stopGame('janggi'); return; }

            try {
                const d = await fetch('/api/janggi/state').then(r => r.json());
                if (d.open) applyJg(d);
                else startJg();       // 새 판은 선공 가위바위보부터
            } catch (e) {
                jgMsg.textContent = '판을 못 불러왔다';
            }
        });

        document.getElementById('jg-close').addEventListener('click', () => {
            stopGame('janggi');
            if (againAsk && againAsk.game === 'janggi') againAsk = null;
        });

        document.getElementById('jg-new').addEventListener('click', () => startJg());

        document.getElementById('jg-giveup').addEventListener('click', () => {
            jgCall('/api/janggi/resign');
        });


        // ============================================================
        // 할리갈리
        //
        // 반사신경 놀이라 다른 놀이와 얼개가 다르다. 뒤집을 때마다
        // 서버가 '다이아가 몇 ms 뒤에 종을 칠지' 를 같이 준다.
        // 화면이 그만큼 기다렸다가, 사람이 먼저 안 눌렀으면 다이아가
        // 친 것으로 알린다.
        // ============================================================

        const hgPanel = document.getElementById('hg-panel');
        const hgMsg = document.getElementById('hg-msg');
        const hgTurn = document.getElementById('hg-turn');
        const hgBell = document.getElementById('hg-bell');
        const hgFlip = document.getElementById('hg-flip');
        const hgLevels = document.getElementById('hg-levels');

        const hg = {
            on: false,
            // 오목과 같은 까닭으로 비워 둔다 — 서버가 정한 세기를 쓴다
            level: null,
            levels: [],
            busy: false,
            timer: null,      // 다이아가 칠 때를 기다리는 타이머
            shownAt: 0,       // 카드가 보인 시각 — 사람의 반응 시간을 잰다
            autoFlip: null,
        };

        const HG_ICON = {
            banana: '🍌', lime: '🍏', berry: '🍓', plum: '🍇',
        };

        function hgClearTimers() {
            if (hg.timer) { clearTimeout(hg.timer); hg.timer = null; }
            if (hg.autoFlip) { clearTimeout(hg.autoFlip); hg.autoFlip = null; }
        }

        function hgCard(el, card) {
            if (!card) {
                el.textContent = '·';
                el.classList.add('empty');
                return;
            }
            el.classList.remove('empty');
            el.textContent = (HG_ICON[card.fruit] || '?').repeat(card.n);
        }

        function drawHgLevels() {
            hgLevels.innerHTML = '';
            (hg.levels || []).forEach(lv => {
                const b = document.createElement('button');
                b.textContent = lv.label;
                b.className = (lv.key === hg.level) ? 'on' : '';
                b.onclick = async () => {
                    hg.level = lv.key;
                    drawHgLevels();
                    try {
                        await fetch('/api/halli/level', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ level: lv.key }),
                        });
                    } catch (e) {}
                };
                hgLevels.appendChild(b);
            });
        }

        function applyHg(d) {
            if (!d || d.ok === false) {
                hgMsg.textContent = (d && d.error) || '뭔가 잘못됐다';
                return;
            }

            // 판이 움직였으면 마주 앉은 것이다 — 자고 있으면 깨운다.
            // 열기·새 판·한 수·기권이 전부 여기를 지난다(체스는 openChess).
            if (isSleeping) wakeUp();

            hgClearTimers();

            if (d.levels) hg.levels = d.levels;
            if (d.level) hg.level = d.level;
            hg.on = !!d.on;

            drawHgLevels();

            const open = d.open || {};
            hgCard(document.getElementById('hg-card-dia'), open.dia);
            hgCard(document.getElementById('hg-card-you'), open.you);

            const hand = d.hand || {};
            document.getElementById('hg-hand-dia').textContent = hand.dia || 0;
            document.getElementById('hg-hand-you').textContent = hand.you || 0;

            hgBell.classList.toggle('hot', !!d.ring);
            hgFlip.disabled = !hg.on;

            hgTurn.textContent = hg.on
                ? (d.turn === 'you' ? '내 차례' : '다이아 차례')
                : (d.winner ? (d.winner === 'you' ? '내가 이겼다' : '다이아가 이겼다')
                            : '판이 닫혔다');

            const reply = takeLead(d.reply);

            hgMsg.textContent = reply || '';

            if (reply) showReply(reply, d.expression || 'neutral', []);

            // 판이 끝나 한 판 더 할지 물었다 — 다음 말을 답으로 읽는다
            if (d.again) setAgain(d.again);

            if (!hg.on) return;

            hg.shownAt = performance.now();

            // 다이아가 칠 때를 기다린다.
            //
            // 사람이 먼저 누르면 이 타이머는 취소된다.
            if (typeof d.dia_ms === 'number' && d.dia_ms > 0) {
                hg.timer = setTimeout(() => {
                    hg.timer = null;
                    hgCall('/api/halli/bell', { who: 'dia' });
                }, d.dia_ms);
            }

            // 다이아 차례면 알아서 뒤집는다. 사람이 눌러 줄 일이 아니다.
            if (d.turn === 'dia') {
                hg.autoFlip = setTimeout(() => {
                    hg.autoFlip = null;
                    hgCall('/api/halli/flip');
                }, 700);
            }
        }

        async function hgCall(path, body) {
            if (hg.busy) return;
            hg.busy = true;

            try {
                const r = await fetch(path, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body || {}),
                });
                applyHg(await r.json());
            } catch (e) {
                hgMsg.textContent = '서버와 연결이 안 된다';
            } finally {
                hg.busy = false;
            }
        }

        hgBell.addEventListener('click', () => {
            if (!hg.on) return;

            // 카드가 보인 뒤 얼마나 걸렸는지 재서 보낸다.
            // 서버가 다이아 쪽과 견줘서 누가 먼저인지 가른다.
            const ms = Math.max(0, Math.round(performance.now() - hg.shownAt));

            hgClearTimers();
            hgCall('/api/halli/bell', { who: 'you', ms: ms });
        });

        hgFlip.addEventListener('click', () => hgCall('/api/halli/flip'));

        document.getElementById('hg-open').addEventListener('click', async () => {
            const on = hgPanel.classList.toggle('on');
            document.getElementById('hg-open').classList.toggle('on', on);

            if (!on) { stopGame('halli'); return; }

            try {
                const d = await fetch('/api/halli/state').then(r => r.json());
                if (d.on) applyHg(d);
                else startHg();       // 새 판은 선공 가위바위보부터
            } catch (e) {
                hgMsg.textContent = '판을 못 불러왔다';
            }
        });

        document.getElementById('hg-close').addEventListener('click', () => {
            stopGame('halli');
            if (againAsk && againAsk.game === 'halli') againAsk = null;
        });

        document.getElementById('hg-new').addEventListener('click', () => startHg());

        document.getElementById('hg-quit').addEventListener('click',
            () => hgCall('/api/halli/quit'));


        // ============================================================
        // 오목
        //
        // 규칙과 다이아의 수는 서버가 정한다. 여기는 판을 그리고
        // 누른 자리를 보내는 일만 한다 — 체스와 같은 얼개다.
        // 규칙을 화면에도 적으면 서버와 어긋난다.
        // ============================================================

        const goPanel = document.getElementById('go-panel');
        const goBoard = document.getElementById('go-board');
        const goTurn = document.getElementById('go-turn');
        const goMsg = document.getElementById('go-msg');
        const goLevels = document.getElementById('go-levels');

        const go = {
            rows: [],
            open: false,
            last: null,      // 마지막에 놓인 자리
            busy: false,
            // 세기는 **서버가 정한다.** 여기에 'normal' 을 적어 두면
            // 새 판을 열 때 그 값이 같이 가서, 개체(avatar.py)에서 기본을
            // 올려도 화면이 덮어썼다. 비워 두면 서버 것이 온다.
            level: null,
            levels: [],
        };

        function drawGo() {
            goBoard.innerHTML = '';

            if (!go.rows.length) return;

            go.rows.forEach((row, r) => {
                for (let c = 0; c < row.length; c++) {
                    const ch = row[c];
                    const i = r * row.length + c;

                    const sq = document.createElement('div');

                    // 화점. 15줄 판에서는 천원(7,7)과 네 귀다.
                    const star = (r === 7 && c === 7)
                        || ((r === 3 || r === 11) && (c === 3 || c === 11));

                    sq.className = 'gsq'
                        + (ch === '.' ? '' : ' has')
                        + (star ? ' star' : '');
                    sq.dataset.spot = i;

                    if (ch !== '.') {
                        const st = document.createElement('div');
                        st.className = 'gstone ' + ch
                            + (go.last === i ? ' last' : '');
                        sq.appendChild(st);
                    }

                    goBoard.appendChild(sq);
                }
            });
        }

        function drawGoLevels() {
            goLevels.innerHTML = '';

            (go.levels || []).forEach(lv => {
                const b = document.createElement('button');
                b.textContent = lv.label;
                b.className = (lv.key === go.level) ? 'on' : '';
                b.onclick = async () => {
                    go.level = lv.key;
                    drawGoLevels();
                    try {
                        await fetch('/api/gomoku/level', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ level: lv.key }),
                        });
                    } catch (e) {}
                };
                goLevels.appendChild(b);
            });
        }

        function applyGo(d) {
            if (!d || d.ok === false) {
                goMsg.textContent = (d && d.error) || '뭔가 잘못됐다';
                return;
            }

            // 판이 움직였으면 마주 앉은 것이다 — 자고 있으면 깨운다.
            // 열기·새 판·한 수·기권이 전부 여기를 지난다(체스는 openChess).
            if (isSleeping) wakeUp();

            if (d.rows) go.rows = d.rows;
            if (typeof d.spot === 'number') go.last = d.spot;
            if (d.level) go.level = d.level;
            if (d.levels) go.levels = d.levels;

            go.open = !!d.open;

            drawGo();
            drawGoLevels();

            // 가위바위보로 다이아가 먼저 두면 다이아가 검은 돌이다
            goTurn.textContent = go.open
                ? '오목 — 당신은 ' + (d.you === 'w' ? '흰 돌' : '검은 돌')
                : (d.winner ? (d.winner === d.you ? '이겼다' : '다이아가 이겼다')
                            : '판이 닫혔다');

            const reply = takeLead(d.reply);

            goMsg.textContent = reply || '';

            // 다이아가 한 말은 대화에도 남는다. 놀아 놓고 기록에
            // 없으면 다음 대화에서 그 이야기를 못 한다.
            if (reply) {
                showReply(reply, d.expression || 'neutral', []);
            }

            // 판이 끝나 한 판 더 할지 물었다 — 다음 말을 답으로 읽는다
            if (d.again) setAgain(d.again);
        }

        async function goCall(path, body) {
            if (go.busy) return;
            go.busy = true;

            try {
                const r = await fetch(path, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body || {}),
                });
                applyGo(await r.json());
            } catch (e) {
                goMsg.textContent = '서버와 연결이 안 된다';
            } finally {
                go.busy = false;
            }
        }

        goBoard.addEventListener('click', ev => {
            const sq = ev.target.closest('.gsq');
            if (!sq || !go.open) return;

            goCall('/api/gomoku/move', { spot: parseInt(sq.dataset.spot, 10) });
        });

        document.getElementById('go-open').addEventListener('click', async () => {
            const on = goPanel.classList.toggle('on');
            document.getElementById('go-open').classList.toggle('on', on);

            if (!on) { stopGame('gomoku'); return; }

            try {
                const d = await fetch('/api/gomoku/state').then(r => r.json());
                if (d.open) applyGo(d);
                else startGo();       // 새 판은 선공 가위바위보부터
            } catch (e) {
                goMsg.textContent = '판을 못 불러왔다';
            }
        });

        document.getElementById('go-close').addEventListener('click', () => {
            stopGame('gomoku');
            if (againAsk && againAsk.game === 'gomoku') againAsk = null;
        });

        document.getElementById('go-new').addEventListener('click', () => startGo());

        document.getElementById('go-giveup').addEventListener('click', () => {
            goCall('/api/gomoku/resign');
        });

        const chessBoard = document.getElementById('chess-board');
        const chessTurn = document.getElementById('chess-turn');
        const chessTaken = document.getElementById('chess-taken');
        const chessMsg = document.getElementById('chess-msg');
        const chessLevels = document.getElementById('chess-levels');
        const chessSides = document.getElementById('chess-sides');
        const chessDecide = document.getElementById('chess-decide');
        const chessOpen = document.getElementById('chess-open');
        const chessNew = document.getElementById('chess-new');
        const chessGiveUp = document.getElementById('chess-giveup');
        const chessClose = document.getElementById('chess-close');

        // 말 글자. 대문자가 흰 쪽이다(서버가 그렇게 준다).
        const CHESS_GLYPH = {
            k: '♚', q: '♛', r: '♜',
            b: '♝', n: '♞', p: '♟',
        };

        const chessGame = {
            on: false,        // 판이 열려 있는가
            rows: null,       // 여덟 줄
            moves: [],        // 둘 수 있는 수 (uci)
            turn: null,
            you: 'white',
            last: null,
            over: false,
            pick: null,       // 지금 고른 칸 (예: 'e2')
            busy: false,
            levels: null,     // 고를 수 있는 난이도 (서버가 준다)
            level: null,      // 지금 고른 것
            deciding: false,  // 선공을 가위바위보로 정하는 중인가
            choose: false,    // 이겨서 내가 고를 차례인가
            hands: null,      // 가위바위보 손 (서버가 준다)
        };

        // 칸 이름 <-> 줄/칸 번호.
        // 서버가 준 rows[0] 이 8행이다(위에서부터).
        function sqName(r, f) {
            return 'abcdefgh'[f] + (8 - r);
        }

        // 내 말이 아래에 오게 판을 돌린다.
        //
        // 서버는 늘 8행부터(흰 쪽이 아래) 준다. 검은 말을 잡았으면
        // 그대로 그리면 **내 말이 저쪽 끝에 있다.** 판을 마주 앉아
        // 보는 것이므로 돌려서 그린다.
        function flipped() {
            return chessGame.you === 'black';
        }

        // 화면의 (줄, 칸) 을 서버가 준 (줄, 칸) 으로.
        function realAt(r, f) {
            return flipped() ? [7 - r, 7 - f] : [r, f];
        }

        // ------------------------------------------------------------
        // 체스하자고 말하면 판이 열린다
        //
        // 예전에는 단추를 가리키기만 했다("왼쪽 위 단추로 내주세요").
        // 놀자고 말했는데 단추를 찾으라고 하면 한 박자 끊긴다.
        // 말했으면 열어 주는 편이 낫다.
        //
        // 열자마자 선공을 가위바위보로 정한다. 체스는 흰 쪽이 먼저
        // 두므로 그것을 누가 가져갈지 가려야 한다.
        // ------------------------------------------------------------

        function chessCfg() {
            return (ENTITY && ENTITY.game && ENTITY.game.chess) || {};
        }

        // ------------------------------------------------------------
        // 말로 놀이 부르기
        //
        // 체스만 이 길이 나 있었다. 오목·할리갈리·장기는 하자고 말해도
        // 아무 데도 안 걸려서 모델이 말로만 받았다 — 사람은 판을 기다리는데
        // 다이아는 글로 오목을 두려 했다(2026-09-22 에 겪음).
        //
        // **이름을 안 대도 받는다.** 지고 나서 "다시 하자" 라고 하는 것이
        // 사람 말이다. 방금 둔 판을 기억해 두었다가 그것을 연다.
        // ------------------------------------------------------------

        let lastGame = null;      // 방금 벌인 판

        const GAMES = [
            { key: 'gomoku', open: 'go-open', panel: 'go-panel', fresh: 'go-new',
              conf: () => (ENTITY && ENTITY.game || {}).gomoku },
            { key: 'halli', open: 'hg-open', panel: 'hg-panel', fresh: 'hg-new',
              conf: () => (ENTITY && ENTITY.game || {}).halli },
            { key: 'janggi', open: 'jg-open', panel: 'jg-panel', fresh: 'jg-new',
              conf: () => (ENTITY && ENTITY.game || {}).janggi },
        ];

        // 이름 없이 다시 하자는 말
        const AGAIN = ['다시', '또하', '또해', '한판더', '한번더',
                       '재대결', '리벤지', '한판만더'];

        function gameByName(flat) {
            for (const g of GAMES) {
                const list = (g.conf() || {}).triggers || [];

                const hit = list.some(w =>
                    flat.includes(String(w).replace(/\s+/g, '').toLowerCase()));

                if (hit) return g;
            }

            return null;
        }

        function isWordChainCall(flat) {
            const list = (((ENTITY && ENTITY.game) || {}).word_chain || {}).triggers || [];
            return list.some(w =>
                flat.includes(String(w).replace(/\s+/g, '').toLowerCase()));
        }

        function handleGameCommand(text) {
            const flat = text.replace(/\s+/g, '').toLowerCase();

            let g = gameByName(flat);
            const again = AGAIN.some(w => flat.includes(w));

            // 끝말잇기는 판이 없다. 하는 중이 아니면 선공부터 정하고 연다.
            // 하는 중이면 서버가 받는다(낱말·그만하자는 말).
            const wc = !g && !wcOn && (isWordChainCall(flat)
                || (again && lastGame === 'word_chain'));

            if (wc) {
                appendMessage('user', text);
                if (isSleeping) wakeUp();
                faceUser();
                startGame('word_chain');
                return true;
            }

            // 이름을 안 댔으면 방금 둔 판으로 본다
            if (!g && again && lastGame) {
                if (lastGame === 'chess') {
                    appendMessage('user', text);
                    if (isSleeping) wakeUp();
                    faceUser();
                    openChess(true);
                    return true;
                }

                g = GAMES.find(x => x.key === lastGame) || null;
            }

            if (!g) return false;

            appendMessage('user', text);

            if (isSleeping) wakeUp();
            faceUser();

            lastGame = g.key;

            const panel = document.getElementById(g.panel);
            const on = panel && panel.classList.contains('on');

            if (!on) {
                // 단추를 누른 것과 같게 연다. 판 불러오기까지 그 길에 다 있다.
                document.getElementById(g.open).click();

            } else if (again) {
                // 이미 열려 있는데 다시 하자고 하면 새 판을 깐다
                document.getElementById(g.fresh).click();
            }

            return true;
        }


        // ------------------------------------------------------------
        // 선공 정하기 — 오목·장기·할리갈리·끝말잇기
        //
        // 어느 놀이든 시작하기 전에 가위바위보로 먼저 할 사람을 정한다
        // (사용자가 정한 규칙). 체스는 판 안에 따로 있다(drawDecide).
        //
        // 단추로 열든, 말로 부르든, 새 판이든, 한 판 더든 전부 여기를
        // 지난다 — 한 곳이라도 빠지면 그 길로는 가위바위보 없이 열린다.
        //
        // 다이아가 이기면 그 말("내가 먼저 할게")을 따로 하지 않고 판을
        // 여는 말 앞에 붙인다. 따로 하면 뒤의 말이 앞의 목소리를 끊는다.
        // ------------------------------------------------------------

        const firstBox = document.getElementById('first-box');
        const firstTitle = document.getElementById('first-title');
        const firstBtns = document.getElementById('first-btns');

        const FIRST_NAME = {
            gomoku: '오목', janggi: '장기', halli: '할리갈리', word_chain: '끝말잇기',
        };

        const first = { game: null, busy: false, hands: [], then: null };

        // 판을 여는 말 앞에 붙일 말. 판이 열릴 때 한 번 쓰고 비운다.
        let firstLead = null;

        function takeLead(reply) {
            const lead = firstLead;
            firstLead = null;
            if (!lead) return reply;
            return reply ? (lead + ' ' + reply) : lead;
        }

        function closeFirst() {
            first.game = null;
            first.then = null;
            firstBox.classList.remove('on');
            firstBtns.innerHTML = '';
        }

        async function firstCall(path, body) {
            if (first.busy) return null;
            first.busy = true;

            try {
                return await fetch(path, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body || {}),
                }).then(r => r.json());
            } catch (e) {
                firstTitle.textContent = '서버와 연결이 안 된다';
                return null;
            } finally {
                first.busy = false;
            }
        }

        function firstDecided(who, lead) {
            const then = first.then;
            closeFirst();
            firstLead = lead || null;
            if (then) then(who);
        }

        function drawFirst(choose) {
            firstBtns.innerHTML = '';

            if (choose) {
                // 이겼으니 내가 고른다
                [{ key: 'you', label: '내가 먼저' },
                 { key: 'dia', label: '다이아 먼저' }].forEach(o => {
                    const b = document.createElement('button');
                    b.textContent = o.label;
                    b.addEventListener('click', async () => {
                        const r = await firstCall('/api/first/choose', { first: o.key });
                        if (r && r.ok) firstDecided(r.first, null);
                    });
                    firstBtns.appendChild(b);
                });
                return;
            }

            (first.hands || []).forEach(h => {
                const b = document.createElement('button');
                b.textContent = h.icon + ' ' + h.label;
                b.addEventListener('click', async () => {
                    if (first.busy) return;
                    firstBtns.querySelectorAll('button')
                        .forEach(x => x.disabled = true);

                    roam.state = 'gesture';
                    faceUser();

                    const r = await firstCall('/api/first/rps', { hand: h.key });
                    if (!r || !r.ok) { drawFirst(false); return; }

                    // 다이아가 실제로 낸 손을 보여 주고, 낸 뒤에 말한다.
                    // 예전에는 사람이 고른 손(h.motion)을 다이아가 흉내 냈다.
                    if (r.motion) playMotion(r.motion);
                    await new Promise(ok => setTimeout(ok, RPS_REVEAL_MS));

                    firstTitle.textContent =
                        '나 ' + r.you_label + ' · 다이아 ' + r.dia_label;

                    if (r.first) {
                        // 다이아가 이겼다. 이 말은 판을 여는 말과 같이 한다.
                        firstDecided(r.first, r.line);
                        return;
                    }

                    if (r.line) showReply(r.line, r.expression || 'neutral', []);
                    drawFirst(!!r.choose);
                });
                firstBtns.appendChild(b);
            });
        }

        // 선공을 정한 뒤 then(first) 를 부른다. first 는 'you' | 'dia'.
        async function askFirst(game, then, opts) {
            lastGame = game;
            againAsk = null;

            first.game = game;
            first.then = then;
            firstLead = null;

            firstTitle.textContent = (FIRST_NAME[game] || '놀이') + ' — 누가 먼저 할까';
            firstBtns.innerHTML = '';
            firstBox.classList.add('on');

            if (isSleeping) wakeUp();

            const r = await firstCall('/api/first/start',
                { game: game, again: !!(opts && opts.again) });

            if (!r || !r.ok) {
                closeFirst();
                return;
            }

            first.hands = r.hands || [];

            if (r.line) showReply(r.line, r.expression || 'neutral', []);

            drawFirst(false);
        }

        // 판마다 여는 길. 판을 비워 두고 선공부터 정한다.
        function startGo(opts) {
            goPanel.classList.add('on');
            document.getElementById('go-open').classList.add('on');
            go.rows = []; go.open = false; go.last = null;
            drawGo();
            goTurn.textContent = '선공 정하는 중…';
            goMsg.textContent = '';
            askFirst('gomoku', who =>
                goCall('/api/gomoku/new', { level: go.level, first: who }), opts);
        }

        function startJg(opts) {
            jgPanel.classList.add('on');
            document.getElementById('jg-open').classList.add('on');
            jg.rows = []; jg.open = false; jg.last = null;
            drawJg();
            jgTurn.textContent = '선공 정하는 중…';
            jgMsg.textContent = '';
            askFirst('janggi', who =>
                jgCall('/api/janggi/new', { level: jg.level, first: who }), opts);
        }

        function startHg(opts) {
            hgClearTimers();
            hgPanel.classList.add('on');
            document.getElementById('hg-open').classList.add('on');
            hg.on = false;
            hgFlip.disabled = true;
            hgTurn.textContent = '선공 정하는 중…';
            hgMsg.textContent = '';
            askFirst('halli', who =>
                hgCall('/api/halli/new', { level: hg.level, first: who }), opts);
        }

        // 끝말잇기가 켜져 있는가. 채팅 답마다 서버가 알려 준다.
        let wcOn = false;

        fetch('/api/wordchain/state').then(r => r.json())
            .then(d => { wcOn = !!(d && d.on); })
            .catch(() => {});

        function startWc(opts) {
            askFirst('word_chain', async who => {
                try {
                    const d = await fetch('/api/wordchain/new', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ first: who }),
                    }).then(r => r.json());

                    if (!d || !d.ok) {
                        firstLead = null;
                        return;
                    }

                    wcOn = !!d.on;
                    showReply(takeLead(d.reply), d.expression || 'fun', []);

                } catch (e) {
                    firstLead = null;
                }
            }, opts);
        }

        function startGame(key, opts) {
            if (key === 'gomoku') return startGo(opts);
            if (key === 'janggi') return startJg(opts);
            if (key === 'halli') return startHg(opts);
            if (key === 'word_chain') return startWc(opts);
            if (key === 'chess') return openChess(true);
        }

        function stopGame(key) {
            if (first.game === key) closeFirst();

            if (key === 'gomoku') {
                goPanel.classList.remove('on');
                document.getElementById('go-open').classList.remove('on');
            } else if (key === 'janggi') {
                jgPanel.classList.remove('on');
                document.getElementById('jg-open').classList.remove('on');
            } else if (key === 'halli') {
                hgClearTimers();
                hgPanel.classList.remove('on');
                document.getElementById('hg-open').classList.remove('on');
            } else if (key === 'chess') {
                closeChess();
            }
        }


        // ------------------------------------------------------------
        // 한 판 더
        //
        // 판이 끝나면 서버가 '한 판 더 할래?' 를 붙이고 again 을 준다.
        // 그다음 사람이 채팅으로 하는 말을 그 물음의 답으로 읽는다 —
        //   그래 / 한 판 더 하자 / 응  → 새 판 (선공 가위바위보부터)
        //   그만할래 / 됐어 / 나중에   → 그 놀이를 닫는다
        //   딴 이야기                  → 평소처럼 모델에게 간다
        // 어느 쪽인지는 서버가 가른다(avatar.again_answer).
        // ------------------------------------------------------------

        let againAsk = null;      // { game, at }

        function setAgain(game) {
            if (!game) return;
            againAsk = { game: game, at: Date.now() };
            lastGame = game;
        }

        async function handleAgainAnswer(text) {
            if (!againAsk) return false;

            const conf = ((ENTITY && ENTITY.game) || {}).again || {};
            const ttl = (conf.ttl_sec || 600) * 1000;

            // 물음은 한 번만 받는다. 딴 이야기를 하면 잊는다.
            const ask = againAsk;
            againAsk = null;

            if (Date.now() - ask.at > ttl) return false;

            let r = null;

            try {
                r = await fetch('/api/again/answer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ game: ask.game, text: text }),
                }).then(res => res.json());
            } catch (e) {
                return false;
            }

            if (!r || !r.answer) return false;

            appendMessage('user', text);
            if (isSleeping) wakeUp();
            faceUser();
            resetTimers();

            if (r.answer === 'no') {
                stopGame(ask.game);
                if (r.line) showReply(r.line, r.expression || 'neutral', []);
                return true;
            }

            startGame(ask.game, { again: true });
            return true;
        }

        function handleChessCommand(text) {
            const list = chessCfg().triggers || [];
            if (!list.length) return false;

            const flat = text.replace(/\s+/g, '').toLowerCase();
            const hit = list.some(w =>
                flat.includes(String(w).replace(/\s+/g, '').toLowerCase()));

            if (!hit) return false;

            appendMessage('user', text);

            if (isSleeping) wakeUp();
            faceUser();

            // 방금 둔 판으로 적어 둔다 — 나중에 "다시 하자" 만 해도 알아듣게
            lastGame = 'chess';

            openChess(true);

            return true;
        }


        // 선공을 가리는 가위바위보.
        //
        // 판 위에 손 세 개를 띄운다. 체스판 안에 두는 이유는, 왼쪽 위
        // 가위바위보 단추는 그냥 노는 것이고 이건 판을 시작하는
        // 절차라서다. 둘이 섞이면 무엇을 누르는지 헷갈린다.
        function drawDecide() {
            const g = chessGame;

            chessDecide.innerHTML = '';

            if (!g.deciding) {
                chessDecide.classList.remove('on');
                return;
            }

            chessDecide.classList.add('on');

            if (g.choose) {
                // 이겼으니 내가 고른다
                CHESS_SIDES.forEach(sd => {
                    const b = document.createElement('button');
                    b.textContent = sd.label;
                    b.addEventListener('click', () => {
                        if (g.busy) return;
                        g.deciding = false;
                        g.choose = false;
                        chessCall('/api/chess/new', { you: sd.key });
                    });
                    chessDecide.appendChild(b);
                });
                return;
            }

            (g.hands || []).forEach(h => {
                const b = document.createElement('button');
                b.textContent = h.icon + ' ' + h.label;
                b.addEventListener('click', async () => {
                    if (g.busy) return;
                    g.busy = true;
                    chessDecide.querySelectorAll('button')
                        .forEach(x => x.disabled = true);

                    roam.state = 'gesture';
                    faceUser();

                    try {
                        const d = await fetch('/api/chess/rps', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ hand: h.key }),
                        }).then(r => r.json());

                        // 다이아가 낸 손을 보여 준다. 예전에는 사람이 고른
                        // 손(h.motion)을 다이아가 흉내 냈다.
                        if (d && d.motion) playMotion(d.motion);

                        setTimeout(() => {
                            applyChess(d);
                            g.busy = false;
                        }, RPS_REVEAL_MS);

                    } catch (e) {
                        console.warn('[diamondAI] 선공 가위바위보 실패', e);
                        chessMsg.textContent = '서버에 닿지 못했습니다.';
                        g.busy = false;
                        drawDecide();
                    }
                });
                chessDecide.appendChild(b);
            });
        }


        // 어느 말을 잡을 것인가.
        //
        // 고르면 판을 새로 연다. 두던 판의 색만 바꿀 수는 없다 —
        // 이미 놓인 말들이 반대편 것이 되어 버린다.
        const CHESS_SIDES = [
            { key: 'white', label: '⚪ 흰 말 (먼저)' },
            { key: 'black', label: '⚫ 검은 말 (나중)' },
        ];

        function drawSides() {
            const g = chessGame;

            chessSides.innerHTML = '';

            // 무슨 색인지 보여 주기만 한다. 눌러서 바꾸면 선공 가위바위보를
            // 건너뛰게 된다 — 색은 가위바위보로 정한다(새 판 단추).
            CHESS_SIDES.forEach(sd => {
                const b = document.createElement('button');
                b.textContent = sd.label;
                b.disabled = true;
                if (sd.key === g.you) b.classList.add('on');

                chessSides.appendChild(b);
            });
        }


        // 난이도 단추.
        //
        // 무엇이 있는지는 서버가 준다. 여기에 이름을 적어 두면 개체와
        // 어긋나고, 어긋나면 화면에는 있는데 서버가 모르는 난이도가 생긴다.
        function drawLevels() {
            const g = chessGame;

            if (!g.levels || !g.levels.length) return;

            chessLevels.innerHTML = '';

            g.levels.forEach(lv => {
                const b = document.createElement('button');
                b.textContent = lv.label;
                if (lv.key === g.level) b.classList.add('on');

                b.addEventListener('click', () => {
                    if (g.busy || lv.key === g.level) return;
                    g.level = lv.key;
                    drawLevels();
                    chessCall('/api/chess/level', { level: lv.key });
                });

                chessLevels.appendChild(b);
            });
        }


        function drawChess() {
            chessBoard.innerHTML = '';

            const g = chessGame;

            if (!g.rows) return;

            // 지금 고른 말이 갈 수 있는 자리
            const targets = {};

            if (g.pick) {
                g.moves.forEach(m => {
                    if (m.slice(0, 2) === g.pick) targets[m.slice(2, 4)] = true;
                });
            }

            for (let r = 0; r < 8; r++) {
                for (let f = 0; f < 8; f++) {
                    // 화면 자리와 판 자리를 가른다.
                    // 검은 말을 잡았으면 둘이 뒤집혀 있다.
                    const [rr, ff] = realAt(r, f);

                    const name = sqName(rr, ff);
                    const ch = g.rows[rr][ff];

                    const el = document.createElement('div');
                    el.className = 'sq '
                        + ((rr + ff) % 2 === 0 ? 'light' : 'dark');

                    if (ch !== '.') {
                        const span = document.createElement('span');
                        // 대문자면 흰 쪽
                        const white = ch === ch.toUpperCase();
                        span.className = white ? 'w' : 'b';
                        span.textContent = CHESS_GLYPH[ch.toLowerCase()] || '';
                        el.appendChild(span);
                    }

                    if (g.pick === name) el.classList.add('pick');

                    if (targets[name]) {
                        el.classList.add('can');
                        if (ch !== '.') el.classList.add('take');
                    }

                    if (g.last &&
                        (g.last.slice(0, 2) === name || g.last.slice(2, 4) === name)) {
                        el.classList.add('last');
                    }

                    if (g.check && ch.toLowerCase() === 'k') {
                        const white = ch === ch.toUpperCase();
                        const turnWhite = g.turn === 'white';
                        if (white === turnWhite) el.classList.add('check');
                    }

                    el.addEventListener('click', () => clickSquare(name, ch));

                    chessBoard.appendChild(el);
                }
            }
        }

        function clickSquare(name, ch) {
            const g = chessGame;

            if (g.busy || g.over || !g.on) return;
            if (g.turn !== g.you) return;

            // 이미 고른 말이 있고, 여기로 갈 수 있으면 둔다
            if (g.pick) {
                const want = g.pick + name;
                const found = g.moves.find(m => m.slice(0, 4) === want);

                if (found) {
                    g.pick = null;
                    sendChessMove(found);
                    return;
                }
            }

            // 내 말을 고른다. 빈 칸이나 남의 말이면 고르기를 푼다.
            const mine = ch !== '.' &&
                ((ch === ch.toUpperCase()) === (g.you === 'white'));

            g.pick = mine ? name : null;
            drawChess();
        }

        function applyChess(d) {
            const g = chessGame;

            if (!d || d.ok === false) {
                chessMsg.textContent = (d && d.error) || '안 되네요.';
                return;
            }

            g.on = !!d.playing || !!d.rows;
            g.rows = d.rows || g.rows;
            g.moves = d.moves || [];
            g.turn = d.turn;
            g.you = d.you || g.you;
            g.last = d.last || null;
            g.check = !!d.check;
            g.over = !!d.over;

            if (d.levels) g.levels = d.levels;
            if (d.level) g.level = d.level;
            if (d.hands) g.hands = d.hands;

            g.deciding = !!d.deciding;
            g.choose = !!d.choose;

            chessPanel.classList.toggle('deciding', g.deciding);

            drawDecide();
            drawSides();
            drawLevels();
            drawChess();

            chessTurn.textContent = g.over
                ? '판이 끝났습니다'
                : (g.turn === g.you ? '당신 차례' : '다이아가 두는 중…');

            // 다이아가 한 말은 말풍선으로 보낸다.
            // 채팅 칸에도 남겨야 나중에 무슨 이야기를 했는지 이어진다.
            if (d.line) {
                showReply(d.line, d.expression || 'neutral', []);
                chessMsg.textContent = '';
            }

            // 판이 끝나 한 판 더 할지 물었다 — 다음 말을 답으로 읽는다
            if (d.again) setAgain(d.again);

            if (d.error) chessMsg.textContent = d.error;
        }

        async function chessCall(path, body) {
            chessGame.busy = true;

            try {
                const r = await fetch(path, {
                    method: body ? 'POST' : 'GET',
                    headers: body ? { 'Content-Type': 'application/json' } : undefined,
                    body: body ? JSON.stringify(body) : undefined,
                }).then(r => r.json());

                applyChess(r);
                return r;

            } catch (e) {
                console.warn('[diamondAI] 체스 실패', e);
                chessMsg.textContent = '서버에 닿지 못했습니다.';
                return null;

            } finally {
                chessGame.busy = false;
            }
        }

        function sendChessMove(uci) {
            chessTurn.textContent = '다이아가 두는 중…';
            return chessCall('/api/chess/move', { move: uci });
        }

        function openChess(fresh) {
            // 방금 벌인 판 — "다시 하자" 만 해도 이것으로 알아듣게
            lastGame = 'chess';

            chessPanel.classList.add('on');
            chessOpen.classList.add('on');
            avatarContainer.classList.add('chess');

            loadChessPos();

            // 자고 있으면 바로 깨운다.
            //
            // 말을 걸어 깨울 때는 기지개를 켜고 손을 흔들지만, 놀이는
            // 그 사이에 못 기다린다. 판을 열었으면 이미 마주 앉은 것이다.
            // wakeUp() 은 눈만 뜨고 자세를 되돌린다 — 기지개도 인사도 없다.
            if (isSleeping) wakeUp();

            // 말로 불러서 연 것이면(fresh) 선공부터 가위바위보로 정한다.
            // 두던 판이 있어도 새로 시작하는 것이 맞다 - 놀자고 했으니까.
            if (fresh) {
                chessGame.pick = null;
                chessCall('/api/chess/start', {});
                return;
            }

            // 두던 판이 있으면 그것을, 없으면 선공부터 정한다.
            chessCall('/api/chess/state').then(r => {
                if (r && !r.playing && !r.deciding) {
                    chessCall('/api/chess/start', {});
                }
            });
        }

        function closeChess() {
            chessPanel.classList.remove('on');
            chessOpen.classList.remove('on');
            avatarContainer.classList.remove('chess');
        }

        // ------------------------------------------------------------
        // 판 옮기기
        //
        // 판이 커져서 어디에 두든 무언가는 가린다. 자리를 정해 주는
        // 대신 옮길 수 있게 한다. 머리를 잡아 끌면 따라온다.
        //
        // 옮긴 자리는 이 브라우저에 적어 둔다. 다음에 열 때 거기 그대로
        // 있어야 매번 옮기지 않는다.
        // ------------------------------------------------------------

        const CHESS_POS_KEY = 'dia.chess.pos';

        const chessDrag = { on: false, dx: 0, dy: 0 };

        function placeChess(x, y) {
            const box = avatarContainer.getBoundingClientRect();
            const me = chessPanel.getBoundingClientRect();

            // 창 밖으로 나가지 않게 가둔다. 나가면 머리를 못 잡아
            // 되돌릴 수가 없다.
            const maxX = Math.max(0, box.width - me.width);
            const maxY = Math.max(0, box.height - me.height);

            chessPanel.style.left = Math.max(0, Math.min(maxX, x)) + 'px';
            chessPanel.style.top = Math.max(0, Math.min(maxY, y)) + 'px';
        }

        function saveChessPos() {
            try {
                localStorage.setItem(CHESS_POS_KEY, JSON.stringify({
                    x: parseFloat(chessPanel.style.left) || 0,
                    y: parseFloat(chessPanel.style.top) || 0,
                }));
            } catch (e) { /* 저장 못 해도 판은 돈다 */ }
        }

        function loadChessPos() {
            try {
                const p = JSON.parse(localStorage.getItem(CHESS_POS_KEY));
                if (p && typeof p.x === 'number') placeChess(p.x, p.y);
            } catch (e) { /* 없으면 정해 둔 자리 */ }
        }

        document.getElementById('chess-head').addEventListener('mousedown', e => {
            // 단추를 누른 것이면 끌기가 아니다
            if (e.target.tagName === 'BUTTON') return;

            const box = avatarContainer.getBoundingClientRect();
            const me = chessPanel.getBoundingClientRect();

            chessDrag.on = true;
            chessDrag.dx = e.clientX - me.left;
            chessDrag.dy = e.clientY - me.top;

            chessPanel.classList.add('dragging');
            e.preventDefault();
        });

        window.addEventListener('mousemove', e => {
            if (!chessDrag.on) return;

            const box = avatarContainer.getBoundingClientRect();

            placeChess(e.clientX - box.left - chessDrag.dx,
                       e.clientY - box.top - chessDrag.dy);
        });

        window.addEventListener('mouseup', () => {
            if (!chessDrag.on) return;

            chessDrag.on = false;
            chessPanel.classList.remove('dragging');
            saveChessPos();
        });


        chessOpen.addEventListener('click', () => {
            if (chessPanel.classList.contains('on')) closeChess();
            else openChess();
        });

        chessClose.addEventListener('click', () => {
            closeChess();
            if (againAsk && againAsk.game === 'chess') againAsk = null;
        });

        // 새 판도 선공 가위바위보부터 — 어느 놀이든 시작 전에 정한다
        chessNew.addEventListener('click', () => {
            chessGame.pick = null;
            lastGame = 'chess';
            chessCall('/api/chess/start', {});
        });

        chessGiveUp.addEventListener('click', () => {
            chessGame.pick = null;
            chessGame.on = false;
            chessCall('/api/chess/resign', {}).then(() => {
                chessBoard.innerHTML = '';
                chessTurn.textContent = '판을 접었습니다';
            });
        });

