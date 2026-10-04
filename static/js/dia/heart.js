// dia/heart.js — 마음이 얼굴에 남는다
// (다이아의 몸. 2026-10-04, 나누기 3단계)
//
// 예전에는 답을 마치면 얼굴이 늘 무표정으로 돌아갔다. 방금 져서 서운하다고
// 속으로 적어 놓고(마음: 서운함 7) 3초 뒤엔 아무 일 없던 얼굴이었다.
//
// 이제 쉴 때의 얼굴은 다이아의 마음이 정한다. 서버(dia/heart.py)가 답마다
// 가장 센 감정과 그 반감기를 실어 보내고(feel.face), 몸은 그 얼굴을
// 옅게 짓다가 시간이 지나면 저절로 가라앉힌다. 규칙을 더하지 않는다 —
// 다이아가 스스로 적은 마음을 몸이 따라갈 뿐이다.
//
// 쉬는 얼굴은 '표정을 짓는 중' 으로 치지 않는다. 깜빡임은 계속되고,
// 몸짓이 데려오는 얼굴도 그 위를 덮을 수 있다(faceResting).

        const diaHeart = {
            face: null,     // {emotion, level, expression, half_min}
            body: null,     // {head_x, head_z, away, bob, pace, jitter, half_min}
            at: 0,          // 받은 시각(ms)
        };

        // 이보다 옅으면 쉬는 얼굴에 안 드러난다
        const REST_FACE_FROM = 0.3;
        // 쉬는 얼굴은 아무리 세도 이만큼만. 쉬면서 활짝 웃거나 우는 사람은 없다.
        const REST_FACE_MAX = 0.55;

        // faceResting 은 state.js 에 있다(얼굴을 짓는 face.js 가 먼저 쓴다)
        let restFaceTimer = null;

        function takeHeart(feel) {
            if (!feel || typeof feel !== 'object') return;
            diaHeart.face = feel.face || null;
            diaHeart.body = feel.body || null;
            diaHeart.at = Date.now();
        }


        // ============================================================
        // 마음이 몸에 지우는 자세 (3단계 둘째 조각, 2026-10-04)
        //
        // 서운하면 고개가 내려가고 눈을 피한다. 설레면 숨이 빨라지고 몸이
        // 들썩인다. 어떤 자세인지는 서버(dia/heart.py 의 POSE)가 마음을 섞어
        // 보내고, 여기서는 그것을 천천히 따라가며 고개에 얹는다.
        // 마음이 가라앉으면 자세도 같이 풀린다.
        // ============================================================

        const heartPose = {
            headX: 0, headZ: 0, away: 0,    // 라디안, 지금 지은 값
            bob: 1, pace: 1, jitter: 0,
            phase: 0,                       // 숨 흔들림 위상
        };

        // 자세가 바뀌는 빠르기. 얼굴보다 느리게 — 몸은 천천히 기운다.
        const HEART_POSE_FOLLOW = 1.2;

        function heartPoseWant() {
            const b = diaHeart.body;
            if (!b) return null;
            const mins = (Date.now() - diaHeart.at) / 60000;
            const k = Math.pow(0.5, mins / (b.half_min || 60));
            if (k < 0.05) return null;
            const D = Math.PI / 180;
            // 말하는 동안은 상대를 본다 — 피하던 눈을 반쯤 돌려 준다
            const awayK = isSpeaking() ? 0.5 : 1;
            return {
                headX: (b.head_x || 0) * D * k,
                headZ: (b.head_z || 0) * D * k,
                away: (b.away || 0) * D * k * awayK,
                bob: 1 + ((b.bob || 1) - 1) * k,
                pace: 1 + ((b.pace || 1) - 1) * k,
                jitter: (b.jitter || 0) * k,
            };
        }

        // 매 프레임. 고개에 더할 값을 돌려준다.
        function updateHeartPose(dt) {
            const w = heartPoseWant() || { headX: 0, headZ: 0, away: 0, bob: 1, pace: 1, jitter: 0 };
            const k = Math.min(1, dt * HEART_POSE_FOLLOW);
            ['headX', 'headZ', 'away', 'bob', 'pace', 'jitter'].forEach(n => {
                heartPose[n] += (w[n] - heartPose[n]) * k;
            });

            // 빠르기가 바뀌어도 흔들림이 튀지 않게 위상을 쌓는다
            heartPose.phase += dt * 2.0 * heartPose.pace;

            const t = heartPose.phase;
            const jit = heartPose.jitter
                ? (Math.sin(t * 7.3) + Math.sin(t * 11.9)) * 0.006 * heartPose.jitter : 0;

            return {
                x: heartPose.headX + Math.sin(t) * 0.02 * heartPose.bob + jit,
                y: heartPose.away + jit * 0.5,
                z: heartPose.headZ,
            };
        }

        // 지금 마음이 정하는 말 빠르기(1 = 평소)
        function heartVoiceRate() {
            const b = diaHeart.body;
            if (!b || !b.voice) return 1;
            const mins = (Date.now() - diaHeart.at) / 60000;
            const k = Math.pow(0.5, mins / (b.half_min || 60));
            const r = 1 + (b.voice - 1) * k;
            // 너무 조금 다르면 그냥 둔다(높낮이가 미세하게 어긋나기만 한다)
            if (Math.abs(r - 1) < 0.01) return 1;
            return Math.max(0.88, Math.min(1.12, r));
        }


        // ============================================================
        // 마음이 셀 때 혼자 하는 몸짓 (3단계 셋째 조각, 2026-10-05)
        //
        // 화가 나 있으면 가만히 서 있다가 팔짱을 낀다. 부끄러우면 혼자
        // 쑥스러워한다. 무엇을 할지는 서버(POSE 의 gesture)가 가장 센 마음이
        // 또렷할 때만 보내고, 여기서는 '언제' 만 정한다 — 드물게, 틈을 두고,
        // 말하거나 자거나 걷는 중에는 안 한다. 같은 몸짓을 되풀이하면 기계가
        // 되므로 한 번 하고 나면 한참 쉰다.
        // ============================================================

        const heartGesture = {
            next: 30 + Math.random() * 30,   // 다음에 해 볼 때까지(초)
        };

        function updateHeartGesture(dt) {
            heartGesture.next -= dt;
            if (heartGesture.next > 0) return;

            // 다음 기회는 아무 일이 없어도 다시 잡는다
            heartGesture.next = 25 + Math.random() * 35;

            const b = diaHeart.body;
            const g = b && b.gesture;
            if (!g) return;

            // 받은 지 오래면 그 마음은 이미 가라앉았다
            const mins = (Date.now() - diaHeart.at) / 60000;
            if (mins > (b.half_min || 60) * 0.5) return;

            if (isSleeping || isSpeaking() || isWaitingForAI) return;
            if (typeof roam === 'undefined' || roam.state !== 'idle') return;
            if (Math.random() < 0.4) return;     // 늘 하지는 않는다

            roam.state = 'gesture';
            playMotion(g);

            // 한 번 했으면 한참 쉰다
            heartGesture.next = 60 + Math.random() * 60;
        }

        // 지금 쉬는 얼굴. 없으면 null.
        function restingFace() {
            const f = diaHeart.face;
            if (!f || !f.expression) return null;

            const mins = (Date.now() - diaHeart.at) / 60000;
            const half = f.half_min || 60;
            const level = (f.level || 0) * Math.pow(0.5, mins / half);
            if (level < REST_FACE_FROM) return null;

            const scale = Math.min(REST_FACE_MAX, (level - 0.2) * 0.8);
            return { key: f.expression, scale, level };
        }

        // 표정을 마칠 때 무표정 대신 이것을 부른다.
        function settleFace() {
            if (restFaceTimer) {
                clearTimeout(restFaceTimer);
                restFaceTimer = null;
            }

            const r = restingFace();
            if (!r) {
                applyExpression('neutral');
                faceResting = false;
                return;
            }

            applyExpression(r.key, r.scale);
            faceResting = true;

            // 마음은 가라앉는다. 얼굴도 따라 옅어지게 가끔 다시 짓는다.
            restFaceTimer = setTimeout(() => {
                restFaceTimer = null;
                if (faceResting && !isSpeaking()) settleFace();
            }, 60000);
        }

        // 처음 띄울 때 지금 마음을 물어 둔다. 오래 못 봐서 외로운 채로
        // 시작할 수도 있다.
        function loadHeart() {
            fetch('/api/dia/heart')
                .then(r => r.json())
                .then(d => {
                    if (!d || !d.ok) return;
                    takeHeart(d.feel);
                    if (!isSpeaking() && !isSleeping
                        && (!currentExpression || currentExpression === 'neutral')) {
                        settleFace();
                    }
                })
                .catch(() => {});
        }
