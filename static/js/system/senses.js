// system/senses.js — 입력 장치 — 사진·카메라(눈)·마이크(귀)
// (시스템. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 눈
        //
        // 카메라가 켜져 있으면 그것이 다이아의 눈이다.
        //
        // 보는 것과 말하는 것을 나눴다. 20초마다 한 번씩 보되(speak=false)
        // 볼 때마다 말하지는 않는다 — 그러면 혼자 떠드는 사람이 된다.
        // 본 것은 들고 있다가 말을 걸 때 같이 보낸다. 그래서 평범한
        // 대화가 '나를 보면서 하는 말' 이 된다.
        //
        // 말을 먼저 거는 것은 두 조건이 다 맞을 때만이다 —
        // 지난번 말한 지 충분히 지났고, 보이는 것이 실제로 달라졌을 때.
        // ============================================================

        function visionCfg(key, fallback) {
            const v = (ENTITY && ENTITY.vision) ? ENTITY.vision[key] : undefined;
            return (v === undefined || v === null) ? fallback : v;
        }

        // 지금 보이는 것. 대화를 보낼 때 같이 실어 보낸다.
        function seeingNow() {
            return eye.on ? eye.seen : null;
        }

        // 그림을 긴 변 기준으로 줄여 base64 로 만든다.
        // 원본을 그대로 보내면 몇 MB 가 되고, 그만큼 보는 것도 느려진다.
        function shrink(source, w, h) {
            const max = visionCfg('send_size', 768);
            const k = Math.min(1, max / Math.max(w, h));

            const c = document.createElement('canvas');
            c.width = Math.round(w * k);
            c.height = Math.round(h * k);
            c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);

            return c.toDataURL('image/jpeg', 0.82).split(',')[1];
        }

        // 얼마나 달라졌는가. 0 이면 똑같고 1 이면 완전히 다르다.
        // 글자를 두 글자씩 잘라 겹치는 비율을 본다 — 문장이 조금 달리
        // 적혔을 뿐인데 새삼 말을 거는 일을 막으려는 것이다.
        function howDifferent(a, b) {
            if (!a || !b) return 1;

            const bag = (s) => {
                const t = new Set();
                for (let i = 0; i < s.length - 1; i++) t.add(s.slice(i, i + 2));
                return t;
            };

            const A = bag(a), B = bag(b);
            if (!A.size || !B.size) return 1;

            let same = 0;
            A.forEach(x => { if (B.has(x)) same++; });

            return 1 - (same / Math.max(A.size, B.size));
        }

        async function sendImage(b64, message, speak) {
            if (eye.busy) return null;
            eye.busy = true;

            try {
                const res = await fetch('/api/see', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        image: b64,
                        message: message || '',
                        speak: !!speak,
                    }),
                });

                const d = await res.json();
                if (!d.ok) {
                    console.warn('[diamondAI] 못 봄:', d.error);
                    return null;
                }

                eye.seen = d.seen;
                eye.seenAt = Date.now();

                return d;

            } catch (e) {
                console.warn('[diamondAI] 보기 실패:', e);
                return null;
            } finally {
                eye.busy = false;
            }
        }


        // ------------------------------------------------------------
        // 사진 보여 주기
        // ------------------------------------------------------------

        eyePhotoBtn.addEventListener('click', () => eyeFile.click());

        eyeFile.addEventListener('change', () => {
            const f = eyeFile.files && eyeFile.files[0];
            eyeFile.value = '';
            if (!f) return;

            const img = new Image();
            img.onload = async () => {
                URL.revokeObjectURL(img.src);

                // 채팅창에 무엇을 보여 줬는지 남긴다
                const said = (chatInput.value || '').trim();
                chatInput.value = '';
                appendMessage('user', said ? said + ' 🖼' : '🖼 (사진을 보여준다)');

                faceUser();
                if (isSleeping) wakeUp();

                isWaitingForAI = true;
                const d = await sendImage(
                    shrink(img, img.naturalWidth, img.naturalHeight),
                    said, true);
                isWaitingForAI = false;

                if (!d) {
                    appendMessage('ai', '(잘 안 보여…)');
                    return;
                }
                showReply(d.reply, d.expression || 'neutral', d.cues);
            };
            img.src = URL.createObjectURL(f);
        });


        // ------------------------------------------------------------
        // 카메라
        // ------------------------------------------------------------

        async function toggleCamera() {
            if (eye.on) { stopCamera(); return; }

            try {
                eye.stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: 640, height: 480 }, audio: false,
                });
            } catch (e) {
                appendMessage('ai', '카메라를 못 열었습니다. (' + e.name + ')');
                return;
            }

            eyeVideo.srcObject = eye.stream;
            eyeVideo.classList.add('on');
            eyeCamBtn.classList.add('on');
            eye.on = true;
            eye.spokeAt = Date.now();

            eye.timer = setInterval(lookOnce,
                visionCfg('look_every_ms', 20000));

            showHint('카메라가 다이아의 눈이 됐습니다', 4000);

            // 켜자마자 한 번 본다. 20초를 기다리게 하지 않는다.
            setTimeout(lookOnce, 800);
        }

        function stopCamera() {
            if (eye.timer) { clearInterval(eye.timer); eye.timer = null; }
            if (eye.stream) {
                eye.stream.getTracks().forEach(t => t.stop());
                eye.stream = null;
            }
            eyeVideo.srcObject = null;
            eyeVideo.classList.remove('on');
            eyeCamBtn.classList.remove('on');
            eye.on = false;
            eye.seen = null;

            showHint('카메라를 껐습니다', 2600);
        }

        async function lookOnce() {
            if (!eye.on || eye.busy) return;
            if (!eyeVideo.videoWidth) return;

            // 말하는 중에는 보지 않는다. 서버가 한 번에 하나만 하게 둔다.
            if (isWaitingForAI || isSpeaking()) return;

            const before = eye.seen;
            const now = Date.now();

            const gap = visionCfg('comment_every_ms', 150000);
            const need = visionCfg('comment_change', 0.45);

            // 먼저 말을 걸 때인가 — 지난번 말한 지 오래됐어야 한다.
            // 얼마나 달라졌는지는 본 뒤에야 아니까 여기서는 시간만 본다.
            const maySpeak = !isSleeping && (now - eye.spokeAt > gap);

            const b64 = shrink(eyeVideo,
                eyeVideo.videoWidth, eyeVideo.videoHeight);

            // 일단 보기만 한다
            const d = await sendImage(b64, '', false);
            if (!d) return;

            if (!maySpeak) return;

            // 보이는 것이 달라졌을 때만 말을 건다.
            // 같은 자리에 같은 자세로 있으면 새삼 말할 것이 없다.
            if (howDifferent(before, d.seen) < need) return;

            eye.spokeAt = Date.now();

            const said = await sendImage(b64, '(말없이 너를 보고 있다)', true);
            if (said && said.reply) {
                faceUser();
                showReply(said.reply, said.expression || 'neutral', said.cues);
            }
        }

        eyeCamBtn.addEventListener('click', toggleCamera);

        // 창을 닫을 때 카메라 불이 켜진 채로 남지 않게
        window.addEventListener('beforeunload', () => {
            if (eye.stream) eye.stream.getTracks().forEach(t => t.stop());
        });


        // ============================================================
        // 귀 — 말을 알아듣는다
        //
        // 브라우저가 가진 음성 인식을 쓴다. 서버에 따로 모델을 두지
        // 않아도 되고 한국어도 된다. 다만 크롬 계열에서만 되고,
        // 127.0.0.1 이 아니면 https 라야 마이크가 열린다.
        //
        // 다 알아들을 때까지 기다리지 않고 **말이 시작된 순간**에도
        // 쓰임이 있다 — 다이아가 말하는 중이면 거기서 멈춘다.
        // ============================================================

        const micBtn = document.getElementById('eye-mic');

        const ear = {
            on: false,
            rec: null,
            draft: null,        // 알아듣는 중인 말
            stopping: false,    // 사람이 끈 것인가 (저절로 끊긴 것과 가른다)

            // 알아들은 조각을 모아 두는 자리.
            //
            // **한 마디가 한 번에 오지 않는다.** 크롬은 말하는 도중에도
            // 끊어 가며 '다 됐다(isFinal)' 를 준다. 그것을 그대로
            // 보내면 말하는 도중에 앞부분만 날아가고, 다이아가 거기에
            // 답하는 사이 나머지가 또 날아가 두 번 답한다.
            // (목소리가 둘로 들리던 것이 이것이다)
            //
            // 그래서 조각을 모아 두고, **조용해지면** 한 마디로 보낸다.
            buf: '',
            timer: null,
        };

        // 이만큼 아무 말이 없으면 한 마디가 끝난 것으로 본다.
        // 너무 짧으면 말 도중에 끊기고, 너무 길면 답이 굼뜨다.
        const EAR_GAP_MS = 1200;

        function earFlush() {
            if (ear.timer) {
                clearTimeout(ear.timer);
                ear.timer = null;
            }

            const said = (ear.buf || '').trim();
            ear.buf = '';

            if (!said) return;

            showDraft('');
            chatInput.value = said;
            sendMessage();
        }

        function earSoon() {
            if (ear.timer) clearTimeout(ear.timer);
            ear.timer = setTimeout(earFlush, EAR_GAP_MS);
        }

        function micDraftEl() {
            if (!ear.draft) {
                ear.draft = document.createElement('div');
                ear.draft.id = 'mic-draft';
                document.body.appendChild(ear.draft);
            }
            return ear.draft;
        }

        function showDraft(text) {
            const el = micDraftEl();
            if (!text) { el.style.display = 'none'; return; }
            el.textContent = text;
            el.style.display = 'block';
        }

        function makeRecognizer() {
            const R = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!R) return null;

            const rec = new R();
            rec.lang = 'ko-KR';
            rec.continuous = true;
            rec.interimResults = true;   // 말이 시작된 순간을 알아야 한다

            rec.onresult = (e) => {
                let interim = '', done = '';

                for (let i = e.resultIndex; i < e.results.length; i++) {
                    const r = e.results[i];
                    if (r.isFinal) done += r[0].transcript;
                    else interim += r[0].transcript;
                }

                // 말이 들리기 시작하면 다이아는 말을 멈춘다.
                // 사람은 상대가 입을 열면 하던 말을 그만둔다.
                if (interim || done) interrupt('말');

                // 다 된 조각은 쌓고, 아직 알아듣는 중인 것은 보여만 준다.
                if (done) ear.buf += done;

                showDraft((ear.buf + ' ' + interim).trim());

                // 뭐라도 들렸으면 '조용해지면 보낸다' 를 다시 잰다.
                // 말하는 동안에는 이 시계가 계속 뒤로 밀린다.
                if (interim || done) earSoon();
            };

            rec.onerror = (e) => {
                if (e.error === 'no-speech' || e.error === 'aborted') return;
                console.warn('[diamondAI] 듣기 오류:', e.error);
                if (e.error === 'not-allowed') {
                    appendMessage('ai', '마이크를 못 열었습니다. 권한을 확인해 주세요.');
                    stopEar();
                }
            };

            // 조용하면 저절로 끊긴다. 사람이 끈 게 아니면 다시 켠다.
            rec.onend = () => {
                if (ear.on && !ear.stopping) {
                    try { rec.start(); } catch (e) {}
                }
            };

            return rec;
        }

        function startEar() {
            if (ear.on) return;

            ear.rec = ear.rec || makeRecognizer();
            if (!ear.rec) {
                appendMessage('ai',
                    '이 브라우저는 음성 인식을 지원하지 않습니다. '
                    + '크롬이나 엣지에서 열어 주세요.');
                return;
            }

            ear.on = true;
            ear.stopping = false;
            micBtn.classList.add('on');

            try { ear.rec.start(); } catch (e) {}
            showHint('듣고 있습니다 — 말하면 그대로 보냅니다', 3600);
        }

        function stopEar() {
            if (!ear.on) return;
            ear.on = false;
            ear.stopping = true;
            micBtn.classList.remove('on');

            // 모아 둔 말이 있으면 버리지 않고 보낸다.
            // 말하고 나서 바로 끄는 사람이 많다.
            earFlush();

            showDraft('');
            try { ear.rec.stop(); } catch (e) {}
        }

        micBtn.addEventListener('click', () => ear.on ? stopEar() : startEar());


