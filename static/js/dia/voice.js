// dia/voice.js — 목소리 — 말하기·말풍선 내리기·괄호 상황·립싱크 정지
// (다이아의 몸. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 목소리
        //
        // 서버가 만든 소리(Edge 선희 mp3 또는 Gemini 레다 PCM)를 받아 튼다. 다른 목소리
        // (브라우저 기계음)로 내려가지 않는다 — 못 받으면 그 말은 조용하다.
        //
        // 입 모양은 '실제로 소리가 나는 길이'에 맞춘다.
        // 예전에는 글자당 0.1초로 고정이라, 소리가 끝났는데 입만 계속
        // 움직이거나 그 반대가 되는 일이 있었다.
        // ============================================================

        const voice = {
            on: true,
            // 아직 서버에 안 물어봤다는 뜻이다.
            //
            // 예전에는 여기가 'browser' 였다. 그래서 설정을 한 번
            // 못 불러오면 **그 세션 내내 브라우저 기계음으로 굳었다** —
            // 서버를 아예 안 부르니 좋은 목소리가 있어도 소용이 없었다.
            // 서버가 꺼졌다 켜지는 사이에 새로고침하면 그렇게 됐다.
            provider: null,
            name: '',            // 목소리 이름 (레다)
            // 서버가 실제로 답을 준 적이 있는가
            asked: false,
            audio: null,         // 지금 나고 있는 소리
            // 한 글자를 읽는 데 실제로 걸리는 시간(ms).
            // 첫 문장을 말해 보고 재서 채운다. 그전에는 0 이다.
            msPerChar: 0,
        };

        // 서버에 어떤 목소리를 쓰는지 물어본다.
        //
        // 한 번 실패했다고 포기하지 않는다. 실패하면 provider 를
        // null 로 두어 다음에 말할 때 다시 묻는다.
        async function loadVoice() {
            try {
                const d = await fetch('/api/tts/config').then(r => r.json());

                voice.on = d.enabled !== false;
                voice.provider = d.provider || 'gemini';
                voice.name = d.voice || '';
                voice.asked = true;

                console.log('[diamondAI] 목소리: ' + voice.provider
                    + ' ' + voice.name);

                return true;

            } catch (e) {
                // provider 는 null 로 남는다. 다음에 말할 때 다시 묻는다.
                console.warn('[diamondAI] 목소리 설정을 못 불러왔다 — '
                    + '말할 때 다시 물어본다', e);
                return false;
            }
        }

        function stopVoice() {
            if (voice.audio) {
                try { voice.audio.pause(); } catch (e) {}
                voice.audio = null;
            }
        }

        // 소리를 내고, 그 길이를 알려준다.
        //
        // 길이를 알면 입 모양을 거기에 맞출 수 있다. 못 알아내면
        // 0 을 돌려주고, 그때는 글자 수로 어림잡은 값을 그대로 쓴다.
        // 몇 번째 말인가.
        //
        // **소리를 만들어 오는 데 시간이 걸린다.** 그 사이에 다음 말이
        // 시작되면, 먼저 것이 뒤늦게 돌아와 나중 것과 같이 울린다 —
        // 목소리가 둘로 들리던 까닭이다. stopVoice() 는 이미 나고 있는
        // 소리만 멈추지, 아직 오는 중인 것은 못 멈춘다.
        //
        // 그래서 번호를 매겨 두고, 돌아왔을 때 번호가 바뀌었으면 버린다.
        let voiceTurn = 0;

        // ------------------------------------------------------------
        // 답보다 먼저 여는 입
        //
        // 말을 보내자마자 같은 번호로 첫 문장 소리를 기다린다. 서버는
        // 모델이 첫 문장을 끝내고 소리를 만든 순간 돌려준다 — 답이 다
        // 쓰이기 전이다. 받으면 바로 튼다. 답이 오면 speak() 가 이 소리를
        // 끊지 않고 나머지만 잇는다.
        // ------------------------------------------------------------
        async function voiceEarly(id) {
            if (!voice.on) return;
            const mine = voiceTurn;
            let d = null;
            try {
                d = await fetch('/api/voice/head?id=' + encodeURIComponent(id))
                    .then(r => r.json());
            } catch (e) { return; }

            // 그새 다른 말이 시작됐거나 답이 먼저 와서 말하기 시작했으면 쓰지 않는다.
            if (!d || !d.ok || !d.audio || mine !== voiceTurn) return;

            const A = await loadVoiceAudio(d);
            if (!A || mine !== voiceTurn) return;

            stopVoice();
            const early = { text: d.text, turn: ++voiceTurn, a: A.a, ms: A.ms,
                            at: Date.now(), ended: false };
            A.a.addEventListener('ended', () => { early.ended = true; });
            voice.early = early;
            voice.audio = A.a;
            playVoiceAudio(A.a);
        }

        async function speak(text) {
            if (!voice.on || !text) return 0;

            // 첫 문장이 이미 나고 있으면(voiceEarly) 끊지 않고 나머지만 잇는다.
            const early = voice.early;
            voice.early = null;
            if (early && early.turn === voiceTurn) {
                const rest = cutSpokenPrefix(text, early.text);
                if (rest !== null) {
                    voice.head = null;
                    return continueAfter(early, rest);
                }
            }

            const mine = ++voiceTurn;

            stopVoice();

            // 아직 서버에 못 물어봤으면 지금 물어본다.
            //
            // 이걸 안 하면 처음 한 번 실패한 것이 끝까지 간다.
            // 먼저 말 걸기처럼 한참 뒤에 나오는 말이 특히 그랬다 —
            // 그때쯤이면 서버는 이미 멀쩡히 돌아와 있는데도
            // 화면만 옛 판단을 붙들고 기계음을 냈다.
            if (!voice.asked) {
                await loadVoice();
            }

            // 서버가 만든 소리를 받아서 튼다.
            // edge 는 mp3 라 바로 틀고, gemini 는 헤더 없는 PCM 이라 wav 로 싼다.
            //
            // **첫 문장부터 튼다.** 답 전체의 소리를 기다리면 길수록 늦게
            // 입을 연다. 첫 문장만 먼저 틀고, 그동안 나머지를 받아 이어 튼다.
            // 대화 창구는 첫 문장 소리를 답과 함께 보내 준다(voice.head) —
            // 그러면 받자마자 소리가 난다.
            try {
                let first = null, rest = '', firstData = null;

                const head = voice.head;
                voice.head = null;
                if (head && head.audio && head.text) {
                    const r = cutSpokenPrefix(text, head.text);
                    if (r !== null) {
                        first = head.text;
                        rest = r;
                        firstData = { ok: true, audio: head.audio, mime: head.mime };
                    }
                }
                if (first === null) {
                    [first, rest] = splitFirstSentence(text);
                }

                // 나머지는 지금 바로 부탁해 둔다 — 첫 문장이 나는 동안 온다.
                const restP = rest ? fetchVoice(rest) : null;

                if (!firstData) firstData = await fetchVoice(first);

                // 기다리는 사이에 다음 말이 시작됐으면 이것은 버린다.
                if (mine !== voiceTurn) return 0;

                if (!firstData || !firstData.ok || !firstData.audio) {
                    // 여기까지 왔으면 서버가 소리를 못 준 것이다.
                    console.warn('[diamondAI] 목소리 없음 — ' + why(firstData), first);
                    voice.lastFail = { text: text, at: Date.now() };
                    return 0;
                }

                const A = await loadVoiceAudio(firstData);

                // 길이를 재는 동안에도 다음 말이 시작될 수 있다.
                // 여기서 한 번 더 본다 — 틀기 직전이 마지막 자리다.
                if (!A || mine !== voiceTurn) return 0;

                voice.audio = A.a;

                // 첫 문장이 끝나면 나머지를 잇는다.
                if (restP) {
                    A.a.onended = async () => {
                        const d2 = await restP;
                        if (mine !== voiceTurn || !d2 || !d2.ok || !d2.audio) return;
                        const B = await loadVoiceAudio(d2);
                        if (!B || mine !== voiceTurn) return;
                        voice.audio = B.a;
                        playVoiceAudio(B.a);
                    };
                }

                playVoiceAudio(A.a);

                // 입과 말풍선이 쓸 길이. 나머지는 첫 문장의 빠르기로 어림한다.
                const n1 = Math.max(1, nonSpace(first));
                return A.ms + (rest ? A.ms * nonSpace(rest) / n1 : 0);

            } catch (e) {
                console.warn('[diamondAI] 목소리 창구를 못 불렀다', e);
            }

            // 다른 목소리로 내려가지 않는다. 예비가 있으면 실패가
            // 가려진다 — 안 되면 조용하고, 콘솔에 왜 그런지 남는다.
            voice.lastFail = { text: text, at: Date.now() };

            return 0;
        }

        // 먼저 튼 첫 문장 뒤에 나머지를 잇는다. 반환: 남은 말의 길이(ms).
        async function continueAfter(early, rest) {
            const mine = early.turn;
            const left = Math.max(0, early.ms - (Date.now() - early.at));
            if (!rest) return left;

            const restP = fetchVoice(rest);
            const go = async () => {
                const d2 = await restP;
                if (mine !== voiceTurn || !d2 || !d2.ok || !d2.audio) return;
                const B = await loadVoiceAudio(d2);
                if (!B || mine !== voiceTurn) return;
                voice.audio = B.a;
                playVoiceAudio(B.a);
            };
            if (early.ended) go();
            else early.a.addEventListener('ended', go);

            const n1 = Math.max(1, nonSpace(early.text));
            return left + early.ms * nonSpace(rest) / n1;
        }

        // 소리 하나를 부탁한다. 실패하면 null.
        function fetchVoice(t) {
            return fetch('/api/tts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: t }),
            }).then(r => r.json()).catch(() => null);
        }

        // 받은 소리를 틀 준비를 하고 길이를 잰다. 반환: { a, ms } 또는 null.
        async function loadVoiceAudio(d) {
            const mime = d.mime || '';
            const src = mime.indexOf('L16') >= 0
                ? pcmToWav(d.audio, mime)
                : 'data:' + (mime || 'audio/mpeg') + ';base64,' + d.audio;

            const a = new Audio(src);

            // 마음이 목소리에도 묻는다(dia/heart.js). 서운하면 조금
            // 느리고 낮게, 설레면 조금 빠르고 높게. 소리를 다시
            // 만들지 않고 재생 속도로만 바꾼다 — 떠 둔 소리를 그대로 쓴다.
            const tempo = heartVoiceRate();
            if (tempo !== 1) {
                a.preservesPitch = false;
                a.webkitPreservesPitch = false;
                a.playbackRate = tempo;
            }

            // 소리 길이를 알아야 입을 맞출 수 있다.
            const ms = await new Promise(res => {
                a.onloadedmetadata = () => {
                    // 빨리 틀면 그만큼 짧게 끝난다. 입도 그 길이에 맞춘다.
                    res(isFinite(a.duration) ? a.duration * 1000 / tempo : 0);
                };
                a.onerror = () => res(-1);
                setTimeout(() => res(0), 1500);
            });

            return ms < 0 ? null : { a, ms };
        }

        // 창을 한 번도 안 누른 채로 소리를 내려 하면 브라우저가 막는다
        // (자동재생 정책). 조용히 넘어가지 말고 남긴다.
        function playVoiceAudio(a) {
            a.play().catch(err => {
                console.warn('[diamondAI] 소리를 못 틀었다 — '
                    + '화면을 한 번 눌러 주세요', err);
            });
        }

        function nonSpace(t) {
            return String(t || '').replace(/\s+/g, '').length;
        }

        // 첫 문장과 나머지. 나눌 데가 없으면 [전체, ''].
        function splitFirstSentence(text) {
            const m = /^(.{4,}?[.!?…~])\s+/s.exec(text);
            if (!m || text.length - m[0].length < 4) return [text, ''];
            return [m[1], text.slice(m[0].length)];
        }

        // text 가 head 로 시작하면(띄어쓰기는 안 본다) 그 뒤를, 아니면 null.
        function cutSpokenPrefix(text, head) {
            const h = String(head).replace(/\s+/g, '');
            let j = 0, i = 0;
            for (; i < text.length && j < h.length; i++) {
                const ch = text[i];
                if (/\s/.test(ch)) continue;
                if (ch !== h[j]) return null;
                j++;
            }
            return j === h.length ? text.slice(i).trim() : null;
        }

        // 왜 소리가 없는지 한 줄로.
        function why(d) {
            if (!d) return '창구가 답을 안 줬다';
            if (d.error) return d.error;
            if (d.fallback) return '서버가 만들 목소리가 없다';
            return '알 수 없음';
        }

        // Gemini 는 헤더 없는 PCM 을 준다. 그대로는 못 트니 wav 로 싼다.
        function pcmToWav(b64, mime) {
            const rateHit = /rate=(\d+)/.exec(mime || '');
            const rate = rateHit ? parseInt(rateHit[1], 10) : 24000;

            const raw = atob(b64);
            const pcm = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) pcm[i] = raw.charCodeAt(i);

            const buf = new ArrayBuffer(44 + pcm.length);
            const view = new DataView(buf);
            const put = (o, str) => {
                for (let i = 0; i < str.length; i++) view.setUint8(o + i, str.charCodeAt(i));
            };

            put(0, 'RIFF');
            view.setUint32(4, 36 + pcm.length, true);
            put(8, 'WAVE');
            put(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);        // PCM
            view.setUint16(22, 1, true);        // 모노
            view.setUint32(24, rate, true);
            view.setUint32(28, rate * 2, true);
            view.setUint16(32, 2, true);
            view.setUint16(34, 16, true);
            put(36, 'data');
            view.setUint32(40, pcm.length, true);
            new Uint8Array(buf, 44).set(pcm);

            const blob = new Blob([buf], { type: 'audio/wav' });
            return URL.createObjectURL(blob);
        }


        function playLipSync(text, voiceMs) {
            voiceMs = voiceMs || 0;

            lipSyncQueue =
                textToVisemes(text);


            if (lipSyncTimer) {

                clearInterval(
                    lipSyncTimer
                );

                lipSyncTimer = null;
            }


            if (
                lipSyncQueue.length === 0
            ) {

                resetTargetVowels();

                return;
            }


            // 🚀 실시간으로 문장을 읽으며 표정을 동적으로 바꾸기 위해 원본 대사의 글자 배열을 만듭니다.
            const textChars = Array.from(text);


            /*
             * 표정이 입을 살짝 벌리고 있는 경우에도
             * 립싱크가 그 위에 추가되면서 입이 과하게
             * 벌어지는 문제를 줄이기 위해 강도를 낮춘다.
             */

            // 입이 움직이는 속도.
            //
            // 기본은 글자당 0.1초다. 다만 실제로 나는 소리의 길이를
            // 알아냈다면 그쪽에 맞춘다 — 소리는 끝났는데 입만 움직이거나
            // 그 반대가 되지 않도록.
            let tick = (ENTITY && ENTITY.behavior
                && ENTITY.behavior.lipsync_tick_ms) || 100;

            if (voiceMs > 0 && lipSyncQueue.length > 0) {
                tick = Math.max(40, Math.min(260, voiceMs / lipSyncQueue.length));
            }

            // 말이 시작됐으니 입을 립싱크에 넘긴다.
            // 표정을 다시 걸면 눈·눈썹만 남고 입이 비워진다.
            const wasFace = currentExpression;
            const wasRest = faceResting;
            setTimeout(() => {
                if (!wasFace || !isSpeaking()) return;
                if (wasRest) settleFace(); else applyExpression(wasFace);
            }, 0);

            lipSyncTimer = setInterval(() => {

                if (
                    lipSyncQueue.length === 0 ||
                    isSleeping
                ) {

                    clearInterval(
                        lipSyncTimer
                    );

                    lipSyncTimer = null;

                    resetTargetVowels();

                    return;
                }


                // 다이아가 입을 뻐끔거리며 지나가는 찰나의 '현재 글자'를 하나 가로챕니다.
                const currentChar = textChars.shift();


                if (currentChar) {
                    liveTrigger(currentChar);
                }


                const viseme =
                    lipSyncQueue.shift();


                resetTargetVowels();


                if (
                    viseme &&
                    Object.prototype.hasOwnProperty.call(
                        targetVowelValues,
                        viseme
                    )
                ) {

                    /*
                     * 표정이 웃는 상태일 때
                     * 입이 이미 어느 정도 열려 있을 수 있으므로
                     * 일반적인 립싱크보다 조금 약하게 한다.
                     */

                    // 입이 얼마나 벌어질지. 개체가 정한다.
                    //
                    // 예전에는 0.16~0.24 로 박아 두었는데, 그 정도면 입꼬리가
                    // 0.4mm 움직여서 말하는지 아닌지 티가 안 났다.
                    const L = (ENTITY && ENTITY.behavior
                        && ENTITY.behavior.lipsync) || {};

                    let baseAmount = (currentExpression === 'neutral' || faceResting)
                        ? (L.amount || 0.9)
                        : (L.amount_expressing || 0.6);

                    // 말하느라 벌어지는 폭은 즐거움 표정의 입 폭을 넘지 않는다.
                    //
                    // 재는 것은 '말 때문에 벌어진 몫' 이다. 표정이 이미
                    // 벌려 놓은 것까지 합치면 웃으며 말할 때 남는 몫이 0 이
                    // 되어 입이 아예 안 움직인다.
                    const per = (L.width_per_unit || {})[viseme] || 0;
                    const cap = (L.width_expression || {})[L.cap_expression] || 0;

                    if (per > 0 && cap > 0) {
                        baseAmount = Math.min(baseAmount, cap / per);
                    }

                    targetVowelValues[viseme] =
                        baseAmount +
                        Math.random() * 0.025;
                }

            }, tick);
        }




        // ============================================================
        // 말풍선을 언제 내릴 것인가
        //
        // 내리는 순간 stopLipSync() 가 소리까지 끊는다. 그래서 이 시각은
        // 곧 '말이 끝나는 시각'이고, 소리보다 이르면 문장이 잘린다.
        //
        // 예전에는 글자 수 x 0.1초로 박혀 있었다. 실제 말은 글자당
        // 0.15~0.2초라, 긴 문장은 절반쯤 읽다 소리가 통째로 끊겼다.
        // 서버가 소리를 통째로 주므로 틀기 전에 길이를 안다.
        // 그 길이가 오면 그것으로 다시 걸고, 못 오면 어림값으로 버틴다.
        // ============================================================

        // ============================================================
        // 괄호는 말이 아니라 상황이다
        //
        // 다이아도 상대와 똑같이 괄호로 상황을 적는다.
        //   (머리카락을 귀 뒤로 넘긴다) 왜 그렇게 봐?
        //   (창밖을 오래 본다)                <- 말 없이 상황만
        //
        // 몸짓 이름((팔짱) 같은 것)은 서버가 이미 걷어내 몸으로 보냈다.
        // 여기 남은 괄호는 전부 '보여 줄 글' 이다.
        //
        // 두 가지를 갈라 써야 한다.
        //   보여 줄 때  — 괄호째 보이되 옅고 기울인 글씨로
        //   말할 때     — 괄호를 빼고 읽는다. 지문까지 소리 내어 읽으면
        //                 다이아가 자기 행동을 중계하는 꼴이 된다.
        // ============================================================

        const ACT_RE = /[（(][^()（）]*[)）]/g;

        // 소리 내어 읽을 부분만. 상황을 빼고 남는 말.
        function spokenPart(text) {
            return String(text || '')
                .replace(ACT_RE, ' ')
                .replace(/\s{2,}/g, ' ')
                .trim();
        }

        // 괄호 안이 있는가 (상황만 있는 답인지 가릴 때 쓴다)
        function hasAct(text) {
            ACT_RE.lastIndex = 0;
            return ACT_RE.test(String(text || ''));
        }

        // 상황은 옅게, 말은 그대로.
        //
        // innerText 로 통째로 넣으면 갈라 칠할 수가 없어서 조각으로 넣는다.
        // 조각을 만들 때도 textContent 를 쓴다 — 상대가 적은 글이 그대로
        // 화면 요소가 되면 안 된다.
        function renderSaid(el, text) {
            el.textContent = '';

            const src = String(text || '');
            let last = 0;
            let m;

            ACT_RE.lastIndex = 0;

            while ((m = ACT_RE.exec(src)) !== null) {
                if (m.index > last) {
                    el.appendChild(
                        document.createTextNode(src.slice(last, m.index)));
                }

                const span = document.createElement('span');
                span.className = 'act';
                span.textContent = m[0];
                el.appendChild(span);

                last = m.index + m[0].length;
            }

            if (last < src.length) {
                el.appendChild(document.createTextNode(src.slice(last)));
            }
        }

        // 소리 길이를 모를 때 한 글자에 잡아 두는 시간(ms).
        const SPEAK_MS_PER_CHAR = 170;

        // 소리가 끝나고도 잠깐 더 띄워 둔다. 마지막 소리와 동시에
        // 말풍선이 사라지면 말을 삼킨 것처럼 보인다.
        const BUBBLE_TAIL_MS = 700;

        // 짧은 답이라도 이만큼은 띄워 둔다
        const BUBBLE_MIN_MS = 2200;

        // 소리 없이 눈으로만 읽을 때. 말하는 속도보다 빠르다.
        const READ_MS_PER_CHAR = 90;

        function readMs(text) {
            const chars = Math.max(Array.from(text || '').length, 8);
            return chars * READ_MS_PER_CHAR;
        }

        function guessSpeakMs(text) {
            const chars = Math.max(Array.from(text || '').length, 8);
            return chars * (voice.msPerChar || SPEAK_MS_PER_CHAR);
        }

        function armBubbleHide(speakMs) {
            if (bubbleHideTimer) clearTimeout(bubbleHideTimer);

            const hold = Math.max(BUBBLE_MIN_MS, speakMs + BUBBLE_TAIL_MS);

            bubbleHideTimer = setTimeout(() => {
                speechBubble.style.display = 'none';
                stopLipSync();
                settleFace();
            }, hold);
        }


        // ============================================================
        // 립싱크 즉시 정지
        // ============================================================

        function stopLipSync() {

            // 입을 멈추면 소리도 멈춘다. 안 그러면 다문 입에서 말이 난다.
            stopVoice();

            // 말이 끝났으니 입을 표정에 돌려준다
            const face = currentExpression;


            if (lipSyncTimer) {

                clearInterval(
                    lipSyncTimer
                );

                lipSyncTimer = null;
            }

            lipSyncQueue = [];
            spokenTail = '';

            resetTargetVowels();

            // 입을 표정에 돌려준다. 말하는 동안 비워 뒀던 자리다.
            if (face) applyExpression(face);
        }


