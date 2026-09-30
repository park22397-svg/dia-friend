// system/loop.js — 그리기 고리(animate)
// (시스템. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 메인 애니메이션
        // ============================================================

        // ------------------------------------------------------------
        // 눈과 시선이 쓰는 상태
        //
        // 아래쪽 '눈·귀' 자리에 두면 늦다. animate() 가 여기서 한 번
        // 불리는데 그 안에서 findFace()·updateGaze() 가 이걸 쓴다.
        // const 는 끌어올려지지 않아서, 늦게 선언하면 첫 프레임에
        // ReferenceError 가 나고 스크립트가 통째로 멈춘다.
        // 그러면 파일 끝의 loadAvatar() 까지 못 가서 아바타가 안 나온다.
        // ------------------------------------------------------------

        // 눈이 쓰는 화면 조각들. 여기 두는 이유는 위와 같다 —
        // findFace() 가 그리기 고리에서 불린다.
        const eyeVideo = document.getElementById('eye-video');
        const eyeCamBtn = document.getElementById('eye-cam');
        const eyePhotoBtn = document.getElementById('eye-photo');
        const eyeFile = document.getElementById('eye-file');

        const eye = {
            on: false,
            stream: null,
            timer: null,
            busy: false,
            seen: null,          // 지금 보이는 것
            seenAt: 0,
            spokeAt: 0,
        };

        const gaze = {
            x: 0, y: 0,        // 화면 안 얼굴 자리 -1~1
            fill: 0,           // 얼굴이 화면을 채우는 정도 0~1
            has: false,
            yaw: 0, pitch: 0,  // 지금 머리가 돌아간 정도(rad)
            canvas: null,
        };

        const GAZE_MAX_YAW = 0.42;    // 고개를 좌우로 돌리는 한계(rad)
        const GAZE_MAX_PITCH = 0.22;  // 위아래
        const GAZE_FOLLOW = 2.6;      // 따라가는 속도


