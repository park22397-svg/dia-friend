// dia/bubble.js — 말풍선 — 머리를 따라다닌다
// (다이아의 몸. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 말풍선을 머리 옆에 붙여 두기
        //
        // 말풍선은 화면 한 자리에 고정돼 있었다. 다이아가 걸어가거나
        // 시점을 돌리면 엉뚱한 데서 말이 나온다.
        // 머리의 3차원 위치를 화면 좌표로 옮겨 매 프레임 따라가게 한다.
        // ============================================================

        const _bubbleAt = new THREE.Vector3();

        // 화면에 실제로 그린 자리. 목표를 향해 천천히 따라간다.
        //
        // 머리를 1:1 로 따라가면 숨쉬기와 끄덕임의 잔떨림까지 그대로 옮겨
        // 글자가 계속 흔들린다. 읽기 힘들다.
        // 그래서 작은 흔들림은 무시하고, 큰 움직임만 부드럽게 좇는다.
        let _bubbleX = null;
        let _bubbleY = null;

        const BUBBLE_DEADZONE = 6;      // 이보다 적게 움직이면 가만히 둔다(px)
        const BUBBLE_FOLLOW = 6;        // 클수록 빨리 따라간다

        // 좁은 화면에서는 얼굴 옆에 안 붙인다 — 얼굴을 가린다.
        // 아래에 자막처럼 깔아 두므로 자리를 계산할 일도 없다.
        const BUBBLE_FOLLOW_MIN_W = 820;

        function updateBubblePos(dt) {
            if (!currentVRM) return;
            if (window.innerWidth <= BUBBLE_FOLLOW_MIN_W) return;

            // 말풍선 변수는 이 파일 뒤쪽에서 만들어진다.
            // 여기서 직접 찾아 쓰면 선언 순서에 기대지 않아도 된다.
            const speechBubble = document.getElementById('speech-bubble');
            if (!speechBubble || speechBubble.style.display === 'none') return;

            let head = null;
            try {
                head = currentVRM.humanoid.getBoneNode('head');
            } catch (e) {}
            if (!head) return;

            head.getWorldPosition(_bubbleAt);
            _bubbleAt.y += 0.06;                 // 눈높이보다 살짝 위

            _bubbleAt.project(camera);

            // 카메라 뒤로 돌아가면 화면에 그리지 않는다
            if (_bubbleAt.z > 1) {
                speechBubble.style.opacity = '0';
                return;
            }
            speechBubble.style.opacity = '1';

            const w = canvas.clientWidth;
            const h = canvas.clientHeight;

            let x = (_bubbleAt.x * 0.5 + 0.5) * w;
            let y = (-_bubbleAt.y * 0.5 + 0.5) * h;

            // 다이아 기준 왼쪽 = 화면에서는 오른쪽이다. 이쪽을 보고 서 있어서다.
            // 말풍선의 왼쪽 끝이 얼굴 옆에 오도록 CSS 에서
            // translate(0, -50%) 를 걸어 뒀고, 여기서는 사이를 조금 띄운다.
            const gap = 170;
            x += gap;

            // 화면 밖으로 나가지 않게 잡아 둔다
            const bw = speechBubble.offsetWidth || 200;
            const bh = speechBubble.offsetHeight || 60;
            const pad = 10;

            x = Math.max(pad, Math.min(w - bw - pad, x));
            y = Math.max(bh / 2 + pad, Math.min(h - bh / 2 - pad, y));

            // 처음이면 그 자리에 바로 놓는다
            if (_bubbleX === null) {
                _bubbleX = x;
                _bubbleY = y;
            } else {
                const dx = x - _bubbleX;
                const dy = y - _bubbleY;

                // 잔떨림은 무시한다. 이만큼 넘게 움직였을 때만 따라간다.
                if (Math.hypot(dx, dy) > BUBBLE_DEADZONE) {
                    const k = Math.min(1, (dt || 0.016) * BUBBLE_FOLLOW);
                    _bubbleX += dx * k;
                    _bubbleY += dy * k;
                }
            }

            speechBubble.style.left = Math.round(_bubbleX) + 'px';
            speechBubble.style.top = Math.round(_bubbleY) + 'px';
        }


        // ------------------------------------------------------------
        // 💤 는 다이아 귀 옆에 뜬다
        //
        // 화면 좌표로 밀어 두면 카메라가 움직이는 순간 얼굴에서
        // 떨어진다. 그래서 머리 자리에 세계 좌표로 옆·위 자리를 잡고,
        // 그 점을 화면에 투영한다.
        //
        // 옆으로 미는 방향은 다이아 기준이 아니라 **카메라 기준**이다.
        // 그래야 어느 각도에서 봐도 얼굴을 안 가리고 옆에 붙는다.
        // ------------------------------------------------------------

        const _zzzAt = new THREE.Vector3();
        const _zzzRight = new THREE.Vector3();
        const _zzzUp = new THREE.Vector3();
        const _zzzBack = new THREE.Vector3();

        const ZZZ_SIDE = 0.15;      // 귀 옆으로(m)
        const ZZZ_LIFT = 0.09;      // 귀 높이로(m)

        // 거리 1.65m 에서 3.2rem 이던 크기를 기준으로 삼는다.
        // 원근 카메라에서 보이는 크기는 거리에 반비례한다.
        const ZZZ_BASE_PX = 51.2;
        const ZZZ_BASE_DIST = 1.65;

        function updateZzzPos() {
            const el = document.getElementById('zzz-indicator');

            // 켜는 자리가 모두 'block' 을 넣는다. 아직 아무도 안 건드려
            // 빈 문자열이면 CSS 의 display:none 이라 재 봐야 0 이 나온다.
            if (!el || el.style.display !== 'block' || !currentVRM) return;

            let head = null;
            try {
                head = currentVRM.humanoid.getBoneNode('head');
            } catch (e) {}
            if (!head) return;

            head.getWorldPosition(_zzzAt);

            camera.matrixWorld.extractBasis(_zzzRight, _zzzUp, _zzzBack);
            _zzzAt.addScaledVector(_zzzRight, ZZZ_SIDE);
            _zzzAt.y += ZZZ_LIFT;

            // 크기는 얼마나 떨어져 있는지로 정한다
            const dist = camera.position.distanceTo(_zzzAt);

            _zzzAt.project(camera);

            // 카메라 뒤로 돌아가면 그리지 않는다
            if (_zzzAt.z > 1) { el.style.opacity = '0'; return; }
            el.style.opacity = '';

            const w = canvas.clientWidth;
            const h = canvas.clientHeight;

            const x = (_zzzAt.x * 0.5 + 0.5) * w;
            const y = (-_zzzAt.y * 0.5 + 0.5) * h;

            el.style.fontSize = Math.max(14, Math.min(72,
                ZZZ_BASE_PX * ZZZ_BASE_DIST / Math.max(0.3, dist))) + 'px';

            // 글자 한가운데가 그 점에 오게 한다.
            // transform 은 건드리지 않는다 — 떠오르는 시늉(sleepFloat)이
            // 그 자리를 쓰고 있어서 여기서 겹쳐 쓰면 애니메이션이 죽는다.
            el.style.left = Math.round(x - el.offsetWidth / 2) + 'px';
            el.style.top = Math.round(y - el.offsetHeight / 2) + 'px';
        }


