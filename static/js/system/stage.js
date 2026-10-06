// system/stage.js — 무대 — 렌더러·장면·빛·카메라·바닥·시점
// (시스템. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).


        // ============================================================
        // THREE.JS 기본 설정
        // ============================================================

        const canvas = document.getElementById('canvas3d');
        const avatarContainer = document.getElementById('avatar-container');

        // 비치는 모드.
        //
        // 폰 앱이 `?clear=1` 로 연다. 창 자체가 투명해서 **뒤에 있는
        // 것이 그대로 비친다** — 유튜브를 보면서 다이아를 옆에 두는 자리다.
        //
        // 칠하는 것을 다 걷어야 한다. 바탕색 한 겹만 남아도 뒤가 안 보인다.
        // 바닥 원판과 장소 그림은 아래에서 끈다.
        // URLSearchParams 를 안 쓴다 — 검사기(_verify_screen)의 가짜
        // 환경에는 없어서 거기서 스크립트가 멈춘다.
        // 괄호를 안 쓴다 — `clear(` 라고 적으면 _verify_calls 가 함수
        // 부름으로 읽어 '없는 것을 부른다' 고 잡는다.
        const CLEAR = /[?&]clear\b/.test(String(location.search || ''));

        if (CLEAR) document.body.classList.add('clear');

        // 왼쪽 도구 막대를 보일 것인가.
        //
        // 개체(avatar.py)의 model.ui.eye_bar 가 정한다. 껐다고 해서
        // 기능이 사라지는 것은 아니다 — 단추만 안 보인다.
        // 개체는 아직 안 왔을 수 있으므로, 온 뒤에 다시 한 번 본다.
        function applyUiConf() {
            const ui = (ENTITY && ENTITY.model && ENTITY.model.ui) || {};
            const bar = document.getElementById('eye-bar');

            if (bar) bar.style.display = (ui.eye_bar === false) ? 'none' : '';

            // 막대 안에서 안 보일 단추만 고른 경우
            (ui.hide_buttons || []).forEach(id => {
                const b = document.getElementById(id);
                if (b) b.style.display = 'none';
            });
        }

        // 단추 창 모드. 배경화면이 된 다이아를 눌렀을 때 뜨는 창이다.
        // 다이아는 배경화면 쪽에 이미 서 있으니 여기서는 안 그린다.
        const PANEL = /[?&]panel\b/.test(String(location.search || ''));

        if (PANEL) {
            document.body.classList.add('panel');

            // 볼 아바타가 없으니 지난 이야기가 본문이다
            document.body.classList.add('showlog');
        }

        const scene = new THREE.Scene();

        // 화각(세로, 도).
        //
        // 30 이었을 때는 1인칭 눈높이에서 다이아가 가슴께에서 잘렸다.
        // 머리부터 발끝까지 담으려고 넓혔다(2026-10-06 사용자 지시
        // "전신이 다 보이게"). 카메라를 뒤로 물리는 것(user.js 의
        // VIEW_BACK)과 짝이다 — 화각만 넓히면 원근이 일그러진다.
        const VIEW_FOV = 40;

        const camera = new THREE.PerspectiveCamera(
            VIEW_FOV,
            canvas.clientWidth / canvas.clientHeight,
            0.1,
            20.0
        );

        // 화면에서 아바타가 앉는 높이.
        //
        // 눈이 화면 위쪽에 걸려 있어서, 눈이 지금 목이 있던 자리로
        // 내려오도록 시점을 통째로 7.3cm 올렸다.
        // (머리 본 1.264 - 목 본 1.191 = 0.073)
        // 카메라와 바라보는 곳을 같은 만큼 올리므로 각도는 그대로다.
        const VIEW_LIFT = 0.073;

        // 바라보는 곳 — 아바타가 화면에 앉는 자리. 여기는 그대로 둔다.
        const LOOK_Y = 1.05 + VIEW_LIFT;

        // 보는 사람의 눈높이. 원래는 LOOK_Y 보다 10cm 위(1.223)라
        // 다이아를 살짝 내려다보고 있었다. 올려다보는 구도로 내렸다.
        // 이 값만 바꾸면 각도가 통째로 달라진다 — LOOK_Y 보다 낮으면
        // 올려다보고, 높으면 내려다본다.
        const CAM_Y = 0.49;

        // ------------------------------------------------------------
        // 다이아를 화면에서 위아래로 옮기는 손잡이 (화면 높이의 비율)
        //
        //   0.10  다이아가 화면 높이의 10% 만큼 위로 (아래가 더 보인다)
        //   0     그대로
        //  -0.10  아래로
        //
        // **LOOK_Y 와 CAM_Y 를 같이 내리는 것으로는 안 된다.**
        // OrbitControls 는 target 을 옮기면 카메라를 같은 만큼 따라
        // 옮겨서 상대 위치를 지킨다. 그래서 구도가 그대로다 —
        // 0.35 까지 내려 찍어 봤는데 픽셀 하나도 안 움직였다.
        //
        // 그래서 렌즈를 옮긴다(setViewOffset). 그리는 창을 아래로
        // 밀면 담기는 것이 위로 올라온다. 각도도 원근도 안 바뀐다.
        // 사진기의 시프트 렌즈와 같은 것이다.
        const FRAME_LIFT = 0.10;

        // 지금 쓰는 값. 1인칭에서는 다이아와의 거리에 따라 user.js 가
        // 바꾼다 — 떨어져 있으면 발끝까지 담도록 많이 올린다.
        let frameLift = FRAME_LIFT;

        function applyFrameLift(v) {
            if (typeof v === 'number') {
                // 같은 값이면 행렬을 다시 만들 일이 없다
                if (Math.abs(v - frameLift) < 1e-4 && camera.view) return;
                frameLift = v;
            }

            const w = canvas.clientWidth || 1;
            const h = canvas.clientHeight || 1;

            if (!frameLift) {
                camera.clearViewOffset();
                return;
            }

            camera.setViewOffset(w, h, 0, Math.round(h * frameLift), w, h);
        }

        camera.position.set(0.0, CAM_Y, 1.65);

        const renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            antialias: true,
            alpha: true
        });

        renderer.setSize(
            canvas.clientWidth,
            canvas.clientHeight
        );

        renderer.setPixelRatio(
            Math.min(window.devicePixelRatio, 2)
        );

        // 렌즈를 옮겨 둔다. 카메라를 세운 뒤라야 한다.
        applyFrameLift();

        // 조명 — 한 방향에서만 고르게 비추면 쇄골이나 목선 같은 굴곡이 죽는다.
        // 주광을 비스듬히 세우고 반대편에서 약한 빛을 하나 더 넣어
        // 그늘이 생기게 한다. 전체 밝기는 낮춰서 대비를 살린다.
        const light = new THREE.DirectionalLight(0xfff4e8, 1.25);
        light.position.set(0.8, 1.35, 0.9).normalize();
        scene.add(light);

        // 뒤에서 윤곽을 살려 주는 빛
        const rimLight = new THREE.DirectionalLight(0xa8b6ff, 0.55);
        rimLight.position.set(-0.9, 0.5, -1.0).normalize();
        scene.add(rimLight);

        // 옆에서 비스듬히 — 굴곡을 드러내는 빛.
        //
        // 정면에서만 비추면 배나 가슴골처럼 완만한 곡면은 빛을
        // 고르게 받아 평평해 보인다. 옆에서 얕게 넣으면 나온 데와
        // 들어간 데의 밝기가 갈린다.
        const shapeLight = new THREE.DirectionalLight(0xffe9d6, 0.45);
        shapeLight.position.set(-1.0, 0.15, 0.55).normalize();
        scene.add(shapeLight);

        // 아래에서 아주 약하게 받쳐 얼굴이 새까매지지 않게
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.18);
        fillLight.position.set(0, -1, 0.4).normalize();
        scene.add(fillLight);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.28);
        scene.add(ambientLight);


        // ------------------------------------------------------------
        // 바닥
        //
        // 격자만 있으면 허공에 떠 있는 것처럼 보인다.
        // 가장자리로 갈수록 옅어지는 원판을 깔고 발밑에 그림자를 둔다.
        // 그림 파일 없이 캔버스로 만들어 쓴다.
        // ------------------------------------------------------------

        function makeFadeTexture(inner, outer, stops) {
            const c = document.createElement('canvas');
            c.width = c.height = 256;
            const g = c.getContext('2d');
            const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
            stops.forEach(s => grad.addColorStop(s[0], s[1]));
            g.fillStyle = grad;
            g.fillRect(0, 0, 256, 256);
            return new THREE.CanvasTexture(c);
        }

        function buildFloor(groundY) {
            const floor = new THREE.Mesh(
                // 상대가 걸어 다닐 수 있는 만큼(locomotion.room_radius=6)
                // 보다 조금 넓게. 발밑에서 바닥이 끝나면 허공에 선 꼴이다.
                new THREE.CircleGeometry(6.6, 64),
                new THREE.MeshBasicMaterial({
                    map: makeFadeTexture(0, 0, [
                        [0.0, 'rgba(70,74,112,0.85)'],
                        [0.55, 'rgba(52,56,88,0.55)'],
                        [1.0, 'rgba(30,32,54,0)']
                    ]),
                    transparent: true,
                    depthWrite: false
                })
            );
            floor.rotation.x = -Math.PI / 2;
            floor.position.y = groundY + 0.001;
            floor.renderOrder = -2;
            scene.add(floor);

            // 발밑 그림자. 이게 있어야 바닥에 닿아 있는 것처럼 보인다.
            const shadow = new THREE.Mesh(
                new THREE.CircleGeometry(0.34, 32),
                new THREE.MeshBasicMaterial({
                    map: makeFadeTexture(0, 0, [
                        [0.0, 'rgba(0,0,0,0.5)'],
                        [0.6, 'rgba(0,0,0,0.22)'],
                        [1.0, 'rgba(0,0,0,0)']
                    ]),
                    transparent: true,
                    depthWrite: false
                })
            );
            shadow.rotation.x = -Math.PI / 2;
            shadow.position.y = groundY + 0.004;
            shadow.renderOrder = -1;
            scene.add(shadow);

            return { shadow: shadow, floor: floor };
        }

        // 바닥 — 이게 없으면 걸어도 제자리처럼 보인다.
        // 칸은 0.5m. 넓힌 만큼 칸 수도 늘려야 칸 크기가 그대로다.
        const floorGrid = new THREE.GridHelper(
            14, 28, 0x3a3d5c, 0x2a2d44
        );
        floorGrid.material.transparent = true;
        floorGrid.material.opacity = 0.45;
        floorGrid.position.y = -0.2;
        scene.add(floorGrid);

        const floorParts = buildFloor(-0.2);
        const footShadow = floorParts.shadow;

        // 비치는 모드에서는 **만들 때부터 끈다.**
        //
        // setFloorVisible() 에만 막아 뒀더니, 그 함수를 부르기 전까지는
        // 바닥이 그려져 있었다. 폰에서 열면 한참 동안 격자 바닥이
        // 보이다가 나중에야 사라졌다(2026-09-22 에 사진으로 확인).
        //
        // 발밑 그림자도 끈다. 배경화면 위에 검은 얼룩처럼 보인다.
        if (CLEAR) {
            floorGrid.visible = false;
            floorParts.floor.visible = false;

            if (footShadow) footShadow.visible = false;
        }

        // 방을 겹칠 때는 우리가 그린 바닥을 걷는다.
        // 카메라에 이미 진짜 바닥이 있는데 그 위에 원판을 얹으면
        // 바닥이 두 겹으로 보인다. 발밑 그림자만 남긴다 —
        // 그건 다이아가 그 바닥에 닿아 있다는 표시라서 오히려 있어야 한다.
        function setFloorVisible(on) {
            // 비치는 모드에서는 바닥도 깔지 않는다. 뒤가 보여야 한다.
            if (CLEAR) on = false;

            floorParts.floor.visible = on;
            floorGrid.visible = on;
        }


        // ============================================================
        // 시점
        //
        // 카메라는 원래 다이아를 따라다니기만 했다. 보고 싶은 각도로
        // 돌려 볼 수가 없었다.
        //
        // 아바타 위에서 끌면 만지는 것이고, 빈 곳에서 끌면 시점을 돌린다.
        // 한 번이라도 사람이 시점을 잡으면 자동 따라가기는 물러난다.
        // 마음대로 돌려 놓은 것을 카메라가 계속 되돌리면 싸우는 꼴이 된다.
        // ============================================================

        const controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.target.set(0, LOOK_Y, 0);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = 0.5;
        controls.maxDistance = 6;
        controls.enablePan = false;
        controls.update();

        // 사람이 시점을 잡았는가
        let camFree = false;

        controls.addEventListener('start', () => camFree = true);


