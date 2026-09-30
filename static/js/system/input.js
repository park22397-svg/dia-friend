// system/input.js — 입력 — Enter·전송 단추·창 크기
// (시스템. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // Enter 키
        // ============================================================

        chatInput.addEventListener(
            'keydown',
            (event) => {

                if (
                    event.key === 'Enter'
                ) {

                    event.preventDefault();

                    // 상황칸에 써 둔 것이 있으면 함께 나간다
                    sendBoth();
                }
            }
        );


        // ============================================================
        // 전송 버튼
        // ============================================================

        sendButton.addEventListener(
            'click',
            sendMessage
        );


        // ============================================================
        // 화면 크기 변경
        // ============================================================

        window.addEventListener(
            'resize',
            () => {

                camera.aspect =
                    canvas.clientWidth /
                    canvas.clientHeight;

                // 옮긴 양이 화면 높이의 비율이라 크기가 바뀌면 다시 잡는다.
                // updateProjectionMatrix 보다 먼저 부른다.
                applyFrameLift();

                camera.updateProjectionMatrix();


                renderer.setSize(
                    canvas.clientWidth,
                    canvas.clientHeight
                );
            }
        );


