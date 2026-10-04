// dia/state.js — 다이아 몸의 상태 — 눈 깜빡임·표정·립싱크 상태, VRM 불러오기, 기본 자세
// (다이아의 몸. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 상태 변수
        // ============================================================

        let currentVRM = null;

        let isSleeping = true;

        let talkTimer = null;
        let sleepTimer = null;
        let bubbleHideTimer = null;

        let isWaitingForAI = false;

        const clock = new THREE.Clock();


        // ============================================================
        // 눈 깜빡임
        // ============================================================

        let blinkTimer = 0;

        let blinkInterval =
            3 + Math.random() * 4;

        let isBlinking = false;

        let blinkProgress = 0;


        // ============================================================
        // 표정 상태
        // ============================================================

        let currentExpression = 'neutral';

        let isExpressing = false;
        // 지금 얼굴이 마음이 남긴 쉬는 얼굴인가(dia/heart.js)
        let faceResting = false;


        // ============================================================
        // 립싱크 상태
        // ============================================================

        let lipSyncQueue = [];

        let lipSyncTimer = null;

        const currentVowelValues = {
            a: 0,
            i: 0,
            u: 0,
            e: 0,
            o: 0
        };

        const targetVowelValues = {
            a: 0,
            i: 0,
            u: 0,
            e: 0,
            o: 0
        };


        // ============================================================
        // VRM 로딩
        // ============================================================

        function loadAvatar(url) {
    const loader = new THREE.GLTFLoader();
    loader.crossOrigin = 'anonymous';

    loader.load(
        url,
        (gltf) => {
            if (THREE.VRMUtils) {
                THREE.VRMUtils.removeUnnecessaryJoints(gltf.scene);
            }

            THREE.VRM.from(gltf).then((vrm) => {
                scene.add(vrm.scene);
                currentVRM = vrm;

                detectSurprisedBlendShape(gltf);

                vrm.scene.rotation.y = Math.PI;
                vrm.scene.position.y = -0.2;

                resetToAttentionPose();
                setEyeState(true);

                // 배경은 모델과 상관없이 깔린다. 기다릴 것 없이 따로 부른다.
                loadBackground();

                // 목소리 설정도 미리 받아 둔다
                loadVoice();

                // 개체를 받아 표정·동작 정의를 넘겨받는다
                loadEntity().then(() => {
                    // 처음 감긴 눈은 개체가 오기 전이라 1.0 이다(끝까지 감아
                    // 눈꺼풀이 겹친다). 개체의 '눈 감기' 값으로 다시 감긴다.
                    // 안 그러면 처음 자는 눈만 깨울 때까지 찌그러져 있다.
                    if (isSleeping) setEyeState(true);

                    // 몸은 표현용에서 가져와 겹친다.
                    // 옷 입은 모델은 옷 아래 몸이 지워져 있어 옷을 당기면 비친다.
                    // 테스트 페이지에서 확인한 뒤 개체의 layered 를 켜면 쓰인다
                    const bodyUrl = ENTITY && ENTITY.model
                        && ENTITY.model.layered
                        && ENTITY.model.vrm_body;

                    return (bodyUrl ? loadBody(bodyUrl) : Promise.resolve())
                        .then(() => {
                            alignBody();
                            hideDressedBody();
                        });

                }).then(() => {
                    cacheBones();
                    splitParts();

                    // 배를 밀 정점 배열을 찾아 둔다.
                    // splitParts() 뒤라야 머리카락을 가려낼 수 있고,
                    // 표현용 몸(bodyVRM)까지 다 온 뒤라야 둘 다 잡는다.
                    collectBelly(currentVRM && currentVRM.scene);
                    collectBelly(bodyVRM && bodyVRM.scene);

                    // 골을 먼저 판다. 이게 새 원본이 되고 배가 그 위에 얹힌다.
                    digCleavage();

                    // 판 모양대로 빛이 맞아야 보인다
                    faceBellyNormals();

                    // 굴곡이 보이게 명암을 손본다
                    tuneShading(currentVRM && currentVRM.scene);
                    tuneShading(bodyVRM && bodyVRM.scene);

                    buildMorphs();
                    buildHitboxes();
                    setTool(null);
                    playMotion('idle');

                    // 사이와 기분을 그린다.
                    // 잠긴 도구를 표시하는 데도 지금 친밀도가 필요하다.
                    buildAffinityMarks();
                    buildMoodBars();
                    buildRps();
                    loadWardrobe();
                    loadDeco();
                    applyUiConf();
                    setMood(currentExpression);
                    refreshRelationship();
                    loadHeart();
                });

                // 아바타를 다 불러왔으니 잠 표시(💤)도 같이 켠다.
                document.getElementById('zzz-indicator').style.display = 'block';

                console.log("VRM 모델 로드 성공!");
            }).catch((error) => {
                console.error("VRM 변환 오류:", error);
            });
        },
        undefined,
        (error) => {
            console.error("VRM 로드 에러:", error);
        }
    );
}


        // ============================================================
        // 기본 자세
        // ============================================================

        function resetToAttentionPose() {

            if (
                !currentVRM ||
                !currentVRM.humanoid
            ) {
                return;
            }

            const humanoid =
                currentVRM.humanoid;

            try {

                const leftArm =
                    humanoid.getBoneNode(
                        'leftUpperArm'
                    );

                const rightArm =
                    humanoid.getBoneNode(
                        'rightUpperArm'
                    );

                if (leftArm) {
                    leftArm.rotation.z = 1.2;
                }

                if (rightArm) {
                    rightArm.rotation.z = -1.2;
                }

            } catch (e) {

                console.warn(
                    "자세 설정 실패:",
                    e
                );

            }
        }


