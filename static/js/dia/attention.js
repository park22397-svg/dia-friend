// dia/attention.js — 주의 — 말이 끊기면 멈추기·얼굴 쪽 보기
// (다이아의 몸. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 말을 끊고 들어오기
        //
        // 지금까지는 다이아가 한 번 말하기 시작하면 끝까지 말했다.
        // 사람은 상대가 입을 열면 하던 말을 그만둔다.
        //
        // 끊긴 것을 기억해 두었다가 다음 답에 알려준다 — 아무 일도
        // 없었던 것처럼 이어 말하면 끊긴 티가 안 난다.
        // ============================================================

        let wasCutOff = false;

        function interrupt(how) {
            if (!isSpeaking()) return false;

            stopLipSync();
            speechBubble.style.display = 'none';
            if (bubbleHideTimer) clearTimeout(bubbleHideTimer);

            wasCutOff = true;
            faceUser();

            // 얼굴은 사이가 정한다. 가까울수록 덜 놀란다.
            const aff = (typeof myAffinity === 'number') ? myAffinity : 0;
            applyExpression(aff >= 160 ? 'fun' : 'surprised');

            console.log('[diamondAI] 말이 끊겼다 (' + how + ')');
            return true;
        }

        // 글로 끊는 것도 같다. 다이아가 말하는 중에 글자를 치기 시작하면
        // 그것도 끼어드는 것이다.
        function watchTyping() {
            if (!chatInput) return;
            chatInput.addEventListener('input', () => {
                if (chatInput.value.length === 1) interrupt('글');
            });
        }


        watchTyping();


        // ============================================================
        // 시선 — 얼굴이 있는 쪽을 본다
        //
        // 카메라가 눈이 됐는데 늘 정면만 보면 눈이 아니다.
        //
        // 얼굴을 찾는 데 라이브러리를 쓰지 않는다. 화면을 아주 작게
        // 줄여 살색에 가까운 점들의 무게중심을 잡는다. 정확하지는
        // 않지만 '사람이 왼쪽에 있다' 정도는 충분히 알고, 무엇보다
        // 20초에 한 번이 아니라 매 순간 따라올 수 있다.
        // ============================================================

        function findFace() {
            if (!eye.on || !eyeVideo.videoWidth) { gaze.has = false; return; }

            if (!gaze.canvas) {
                gaze.canvas = document.createElement('canvas');
                gaze.canvas.width = 48;
                gaze.canvas.height = 36;
            }

            const c = gaze.canvas;
            const g = c.getContext('2d', { willReadFrequently: true });
            g.drawImage(eyeVideo, 0, 0, c.width, c.height);

            let px = 0, py = 0, hits = 0;

            const d = g.getImageData(0, 0, c.width, c.height).data;

            for (let i = 0, p = 0; i < d.length; i += 4, p++) {
                const r = d[i], gg = d[i + 1], b = d[i + 2];

                // 살색에 가까운가. 빨강이 가장 세고, 파랑이 가장 약하다.
                const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
                const ok = r > 70 && gg > 35 && b > 20
                    && r > gg && gg > b
                    && (mx - mn) > 14
                    && Math.abs(r - gg) > 12;

                if (!ok) continue;

                const y = (p / c.width) | 0;

                // 아래쪽 절반은 대개 목과 몸이다. 얼굴 쪽에 힘을 준다.
                const w = y < c.height * 0.6 ? 2 : 1;

                px += (p % c.width) * w;
                py += y * w;
                hits += w;
            }

            // 너무 적으면 사람이 없는 것으로 본다
            if (hits < 30) { gaze.has = false; return; }

            gaze.has = true;

            // 얼굴이 화면을 채우는 정도. 거리를 어림하는 데 쓴다.
            // 무게는 최대 2 이므로 칸 수의 두 배로 나눈다.
            gaze.fill = hits / (c.width * c.height * 2);

            // 화면은 거울로 보여 주지만 좌표는 안 뒤집혀 있다.
            // 화면에서 오른쪽에 있으면 실제로는 내 왼쪽이므로 뒤집는다.
            gaze.x = -(((px / hits) / c.width) * 2 - 1);
            gaze.y = ((py / hits) / c.height) * 2 - 1;
        }

        function updateGaze(dt) {
            const wantYaw = (gaze.has && eye.on) ? gaze.x * GAZE_MAX_YAW : 0;
            const wantPitch = (gaze.has && eye.on) ? gaze.y * GAZE_MAX_PITCH : 0;

            const k = Math.min(1, dt * GAZE_FOLLOW);
            gaze.yaw += (wantYaw - gaze.yaw) * k;
            gaze.pitch += (wantPitch - gaze.pitch) * k;
        }


