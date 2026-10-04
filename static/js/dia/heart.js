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
            diaHeart.at = Date.now();
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
