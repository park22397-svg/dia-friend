// system/user.js — 상대(사람) — 1인칭 몸·걷기·조이스틱
// (시스템. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 상대 — 화면 안에 실제로 서 있는 사람
        //
        // 카메라가 곧 이 사람의 눈이다. 몸은 투명해서 본인 눈에는
        // 안 보이지만 월드에는 실제로 있다. 그래서 다이아가 그 자리를
        // 보고, 멀어지면 따라오고, 파고들면 밀려난다.
        // 손이 닿는 거리도 이 몸이 정한다 — 만지려면 다가가야 한다.
        //
        // 거리 숫자는 여기 안 적는다. locomotion 에 있다.
        // ============================================================

        const FLOOR_Y = -0.2;          // 바닥. locomotion.ground_y 와 같다

        // 서 있을 때 눈높이(월드).
        //
        // 처음에는 CAM_Y(0.49)를 그대로 물려받게 했는데, 그건 바닥에서
        // 0.69m 라 다이아의 무릎이 눈앞에 왔다. 카메라가 정물일 때
        // 낮춘 값과 사람이 서 있는 키는 같은 값일 수가 없다.
        //
        // VRM 에서 잰 다이아 (바닥 기준):
        //     눈 1.525 · 머리 1.464 · 가슴 1.352 · 엉덩이 1.195 · 발 0.309
        //
        // 눈을 맞추는 높이로 둔다 — 바닥에서 1.53m, 월드로 1.33.
        const USER_EYE = 1.33;

        // 앉았을 때. 바닥까지의 높이를 절반쯤으로 줄인다.
        // 바닥에서 0.69m 라 이때 다이아의 다리와 발에 손이 닿는다.
        const USER_SIT = FLOOR_Y + (USER_EYE - FLOOR_Y) * 0.45;

        const USER_SPEED = 1.05;       // 걷는 속도 m/s
        const USER_TURN = 2.2;         // 방향키로 도는 속도 rad/s
        const USER_JUMP = 2.3;         // 뛰어오르는 처음 속도 m/s
        const USER_GRAV = 7.0;         // 중력 m/s^2
        const LOOK_SENS = 0.0042;      // 마우스로 둘러보는 감도

        // 전신이 보이게 — 카메라를 눈 뒤로 물리는 거리와 렌즈 올림.
        // 다이아와 VIEW_OPEN 이상 떨어져 있으면 다 물리고,
        // VIEW_CLOSE 안으로 들어오면 눈 자리로 돌아온다(사이는 부드럽게).
        // 화각(VIEW_FOV)은 stage.js 에 있다. 셋을 같이 맞춘 값이다 —
        // 1280x800 과 390x844 에서 머리끝·발끝이 다 들어온다.
        //
        // 2026-10-06 "아바타 한 개만큼 앞으로 더 오게" — 물러나는 거리를
        // 1.35 -> 0.9 로 당기고, 처음 서는 자리를 1.65 -> 1.35(다이아가
        // 따라와 서는 거리 follow_near)로 맞췄다. 그래서 처음 화면과
        // 따라와 선 화면이 같다 — 카메라~다이아 3.0m -> 2.25m.
        const VIEW_BACK = 0.9;         // 물러나는 거리(m)
        const VIEW_SHIFT = 0.37;       // 렌즈 올림(화면 높이의 비율)
        const VIEW_OPEN = 1.25;
        const VIEW_CLOSE = 0.6;

        // 처음 서는 자리(다이아에게서 m). locomotion.follow_near 와 같게 —
        // 다르면 다이아가 처음 따라올 때 화면이 한 번 커지거나 작아진다.
        const USER_START_Z = 1.35;

        const user = {
            on: true,            // 상대가 화면 안에 서 있다 (카메라가 곧 눈)
            x: 0, z: USER_START_Z, // 발이 딛고 선 자리
            yaw: Math.PI,        // 보는 방향. PI 면 -z(다이아) 쪽
            pitch: 0,            // 위아래로 든 고개
            lift: 0, vy: 0,      // 뛰어오른 높이와 속도
            sit: 0,              // 0=선다 1=앉는다. 사이를 부드럽게 오간다
            eye: 1.33            // 지금 눈높이. USER_EYE 로 시작한다
        };

        // 눌려 있는 키. keydown 은 한 번이지만 걷기는 누르는 내내여야 한다.
        const held = Object.create(null);

        // 투명한 몸. 보이지는 않아도 자리는 차지한다.
        // H 를 누르면 판정구와 함께 모습이 드러난다.
        const USER_HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
        const USER_SHOWN = new THREE.MeshBasicMaterial({
            color: 0x6cf0d0, wireframe: true,
            transparent: true, opacity: 0.5
        });

        const userBody = new THREE.Mesh(
            new THREE.CylinderGeometry(0.17, 0.17, 1.0, 10, 1),
            USER_HIDDEN
        );
        scene.add(userBody);

        // 1인칭에서는 궤도 시점이 카메라를 쥐면 안 된다. 서로 밀친다.
        controls.enabled = !user.on;
        camera.rotation.order = 'YXZ';

        function userForwardX() { return Math.sin(user.yaw); }
        function userForwardZ() { return Math.cos(user.yaw); }

        // 상대의 눈이 있는 자리. 닿는 거리도 입맞춤도 이쪽으로 잰다.
        const _eyeAt = new THREE.Vector3();

        function userEye() {
            return _eyeAt.set(user.x, user.eye + user.lift, user.z);
        }

        // 상대가 보고 있는 방향. 이것도 몸이 기준이다.
        const _eyeFwd = new THREE.Vector3();

        function userLook() {
            return _eyeFwd.set(
                Math.sin(user.yaw) * Math.cos(user.pitch),
                Math.sin(user.pitch),
                Math.cos(user.yaw) * Math.cos(user.pitch),
            );
        }

        // locomotion 에 적힌 거리를 꺼내 온다. 아직 개체를 못 받았으면
        // 화면이 들고 있는 값으로 버틴다.
        function followCfg(key, fallback) {
            const L = (ENTITY && ENTITY.locomotion) ? ENTITY.locomotion : null;
            const v = L ? L[key] : undefined;
            return (v === undefined || v === null) ? fallback : v;
        }

        function updateUser(dt) {
            if (!user.on) return;

            // ---- 좌우는 돌아서고, 위아래는 보는 쪽으로 걷는다 ----
            //
            // 방향키와 조이스틱이 같은 축을 민다. 둘을 더한 뒤
            // -1~1 로 자르므로 같이 눌러도 두 배로 빨라지지 않는다.
            let turn = 0, walk = 0;

            if (held.ArrowLeft) turn += 1;
            if (held.ArrowRight) turn -= 1;
            if (held.ArrowUp) walk += 1;
            if (held.ArrowDown) walk -= 1;

            // 조이스틱은 세기가 있다. 손 떨림으로 슬금슬금 가지 않도록
            // 가운데 언저리는 0으로 죽인다.
            if (stick.on) {
                if (Math.abs(stick.x) > STICK_DEAD) turn -= stick.x;
                if (Math.abs(stick.y) > STICK_DEAD) walk += stick.y;
            }

            turn = Math.max(-1, Math.min(1, turn));
            walk = Math.max(-1, Math.min(1, walk));

            user.yaw += turn * USER_TURN * dt;

            if (walk) {
                // 앉은 채로는 느리다
                const sp = USER_SPEED * (1 - user.sit * 0.55) * walk * dt;
                user.x += userForwardX() * sp;
                user.z += userForwardZ() * sp;
            }

            // 방 밖으로는 못 나간다
            const R = followCfg('room_radius', 6.0);
            const out = Math.hypot(user.x, user.z);
            if (out > R) { user.x *= R / out; user.z *= R / out; }

            // 다이아와 겹치지 않는다. 밀고 들어가면 밀려난다.
            const gap = followCfg('personal_space', 0.5);
            const dx = user.x - roam.x, dz = user.z - roam.z;
            const near = Math.hypot(dx, dz);
            if (near > 1e-4 && near < gap) {
                user.x = roam.x + dx / near * gap;
                user.z = roam.z + dz / near * gap;
            }

            // ---- 앉기: Shift 를 누르고 있거나, 단추를 켜 뒀거나 ----
            // 마우스로는 계속 누르고 있을 수가 없어서 단추는 껐다 켠다.
            const wantSit = (held.Shift || sitLatched) ? 1 : 0;
            user.sit += (wantSit - user.sit) * Math.min(1, dt * 9);

            // ---- 스페이스: 점프 ----
            if (user.lift > 0 || user.vy !== 0) {
                user.vy -= USER_GRAV * dt;
                user.lift += user.vy * dt;
                if (user.lift <= 0) { user.lift = 0; user.vy = 0; }
            }

            user.eye = USER_SIT + (USER_EYE - USER_SIT) * (1 - user.sit);

            // ---- 카메라는 눈에서 조금 물러나 있다 ----
            //
            // 눈 자리에 그대로 두면 서 있는 거리(1.35~1.65)에서 다이아가
            // 가슴께에서 잘렸다. 머리부터 발끝까지 보이도록 카메라만
            // 등 뒤로 물리고 렌즈를 올린다. **눈(userEye)은 그대로다** —
            // 손이 닿는 거리·따라오기·입맞춤은 여전히 눈에서 잰다.
            //
            // 바짝 다가가면 물러남을 거둔다. 얼굴을 맞대려고 다가갔는데
            // 카메라가 멀리 남아 있으면 다가간 것이 안 보인다.
            const toDia = Math.hypot(user.x - roam.x, user.z - roam.z);
            const fit = Math.max(0, Math.min(1,
                (toDia - VIEW_CLOSE) / (VIEW_OPEN - VIEW_CLOSE)));
            const back = VIEW_BACK * fit;

            camera.position.set(
                user.x - userForwardX() * back,
                user.eye + user.lift,
                user.z - userForwardZ() * back
            );
            camera.rotation.set(user.pitch, user.yaw + Math.PI, 0);
            applyFrameLift(FRAME_LIFT + (VIEW_SHIFT - FRAME_LIFT) * fit);

            // 투명한 몸도 같이 간다. 앉으면 낮아지고 뛰면 뜬다.
            const h = 1 - user.sit * 0.4;
            userBody.scale.y = h;
            userBody.position.set(
                user.x, FLOOR_Y + h * 0.5 + user.lift, user.z
            );
            userBody.rotation.y = user.yaw;
        }


        // 다이아가 상대를 보려면 어느 쪽으로 돌아야 하는가.
        // 1인칭이 아니면 예전처럼 늘 정면(0)이다.
        function yawToUser() {
            if (!user.on) return 0;
            const dx = user.x - roam.x, dz = user.z - roam.z;
            if (Math.hypot(dx, dz) < 1e-3) return roam.yaw;
            return Math.atan2(dx, dz);
        }


        // 불렀는가. 부르면 손이 닿는 데까지 온다.
        //
        // 평소 서는 거리(1.35)는 이야기하기 좋지만 손이 안 닿는다.
        // 그렇다고 늘 붙어 있으면 답답하다. 그래서 부를 때만 온다.
        let comeClose = false;

        function nearNow() {
            return comeClose
                ? followCfg('come_near', 0.72)
                : followCfg('follow_near', 1.35);
        }

        function farNow() {
            // 가까이 있는 동안에는 조금만 멀어져도 다시 붙는다.
            // 평소 거리(1.80)를 그대로 쓰면 불러 놓고 한 발 물러서면
            // 그대로 서 있게 된다.
            return comeClose
                ? nearNow() + 0.45
                : followCfg('follow_far', 1.80);
        }

        function setApproach(how) {
            const want = (how === 'near');
            if (comeClose === want) return;

            comeClose = want;

            // 곧바로 발을 뗀다. 다음에 멀어질 때까지 기다리지 않는다.
            if (!isSleeping) {
                roam.following = true;
                roam.state = 'move';
                trackUser();
                playMotion('walk');
            }

            console.log('[diamondAI] ' + (want ? '가까이 온다' : '물러난다')
                + ' -> ' + nearNow().toFixed(2) + 'm');
        }


        // 멀어졌으면 따라간다.
        function startFollow() {
            if (!user.on || isSleeping || kissWaiting) return false;
            if (!followCfg('follow_enabled', true)) return false;

            const aff = (typeof myAffinity === 'number') ? myAffinity : 0;
            if (aff < followCfg('follow_min_affinity', -40)) return false;

            const dx = user.x - roam.x, dz = user.z - roam.z;
            const dist = Math.hypot(dx, dz);
            if (dist <= farNow()) return false;

            const keep = nearNow();
            roam.targetX = user.x - dx / dist * keep;
            roam.targetZ = user.z - dz / dist * keep;
            roam.following = true;
            roam.state = 'move';
            playMotion('walk');
            return true;
        }

        // 따라가는 동안 목적지는 상대가 걷는 대로 같이 옮긴다.
        // 이미 충분히 가까우면 제자리를 목적지로 두어 스스로 멈추게 한다.
        function trackUser() {
            const dx = user.x - roam.x, dz = user.z - roam.z;
            const dist = Math.hypot(dx, dz);
            const keep = nearNow();

            if (dist <= keep) {
                roam.following = false;
                roam.targetX = roam.x;
                roam.targetZ = roam.z;
                return;
            }
            roam.targetX = user.x - dx / dist * keep;
            roam.targetZ = user.z - dz / dist * keep;
        }


        // 가까이 다가오면 알아챈다. 한 번 알아채면 다시 멀어졌다
        // 와야 또 놀란다 — 문턱에 걸쳐 서 있을 때 계속 반응하면 우습다.
        let userNoticed = false;

        function updateNotice() {
            if (!user.on || !currentVRM || isSleeping) return;

            const dist = Math.hypot(user.x - roam.x, user.z - roam.z);
            const near = followCfg('notice_dist', 0.62);

            if (!userNoticed && dist < near) {
                userNoticed = true;
                faceUrgency = 1.4;

                // 하던 걸 멈추고 돌아본다. 따라가던 중이면 그냥 둔다.
                if (roam.state === 'move' && !roam.following) {
                    roam.state = 'idle';
                    roam.wait = 2.0;
                    playMotion('idle');
                }

                // 얼굴을 건드려도 되는 때인가.
                //   말하는 중  — 입 모양과 싸운다
                //   답을 기다림 — 곧 그 답의 얼굴이 온다
                //   몸짓 중    — 기지개·손인사는 그 얼굴이 곧 그 동작이다
                if (!isSpeaking() && !isWaitingForAI
                    && !kissWaiting
                    && roam.state !== 'gesture') {
                    const aff = (typeof myAffinity === 'number') ? myAffinity : 0;
                    applyExpression(aff >= 40 ? 'fun' : 'surprised');
                }
            } else if (userNoticed && dist > near + 0.25) {
                userNoticed = false;
            }
        }


        // ------------------------------------------------------------
        // 입맞춤을 기다리기
        //
        // 얼굴을 바짝 들이대면 눈을 감고 기다린다. 그 상태에서 입술로
        // 입을 만져야 입맞춤이 된다 — 다가가는 것만으로는 아무 일도
        // 일어나지 않는다. 눈을 감는 것은 허락이고, 닿는 것은 상대가
        // 하는 일이라서 둘을 나눠 뒀다.
        //
        // 거리·사이·얼굴은 전부 avatar.py 의 touch.kiss 가 갖는다.
        // ------------------------------------------------------------

        const _kissAt = new THREE.Vector3();
        const _kissDir = new THREE.Vector3();
        const _kissFwd = new THREE.Vector3();

        let kissWaiting = false;

        function kissCfg() {
            return (ENTITY && ENTITY.touch && ENTITY.touch.kiss) || null;
        }

        function updateKissWait() {
            const k = kissCfg();

            const off = !k || !k.enabled || !user.on || !currentVRM
                || isSleeping;

            if (off) {
                if (kissWaiting) endKissWait();
                return;
            }

            let head = null;
            try {
                head = currentVRM.humanoid.getBoneNode('head');
            } catch (e) {}
            if (!head) return;

            head.getWorldPosition(_kissAt);

            const eye = userEye();
            const dist = eye.distanceTo(_kissAt);

            // 얼굴을 보고 있는가. 뒷걸음질로 부딪힌 것은 아니어야 한다.
            _kissDir.copy(_kissAt).sub(eye).normalize();
            const facing = _kissDir.dot(userLook());

            const aff = (typeof myAffinity === 'number') ? myAffinity : 0;
            const may = aff >= (k.wait_from || 0)
                && facing >= (typeof k.wait_facing === 'number'
                    ? k.wait_facing : 0.5);

            if (!kissWaiting) {
                // 말하는 중에는 눈을 안 감는다. 입 모양과 싸운다.
                if (may && dist < (k.wait_dist || 0.34)
                        && !isSpeaking() && !isWaitingForAI) {
                    kissWaiting = true;
                    faceUrgency = 1.4;

                    // 기다리는 사람은 걸어가지 않는다
                    if (roam.state === 'move') {
                        roam.state = 'idle';
                        roam.wait = 3.0;
                        playMotion('idle');
                    }

                    applyExpression(k.wait_expression || 'eyes_closed');
                }
                return;
            }

            // 나가는 거리를 들어오는 거리보다 넓게 잡는다.
            // 같으면 문턱에 걸쳐 눈을 감았다 떴다 한다.
            if (!may || dist > (k.leave_dist || 0.46)) endKissWait();
        }

        function endKissWait() {
            if (!kissWaiting) return;
            kissWaiting = false;

            // 말하는 중이면 그 얼굴이 이긴다. 여기서 지우면 안 된다.
            if (!isSpeaking() && !isWaitingForAI) settleFace();
        }


        // ------------------------------------------------------------
        // 배
        //
        // 몸에 그런 모프가 없어서 뼈로 만든다. spine 을 가로·앞뒤로
        // 부풀리고 그 자식인 chest 를 같은 만큼 되돌린다 —
        // 안 되돌리면 가슴과 어깨까지 같이 불어난다.
        // 사이에 낀 배만 남는다.
        //
        // 두 벌을 겹쳐 쓰므로(layered) 몸 쪽에도 같이 걸어야 한다.
        // 옷만 부르고 몸이 그대로면 배가 옷을 뚫는다.
        // ------------------------------------------------------------

        // ------------------------------------------------------------
        // 배
        //
        // 뼈로는 안 된다. 배 높이의 살은 hips 51% · chest 19% · spine 19%
        // 로 나뉘는데, spine 을 부풀리고 chest 를 역수로 되돌리면
        // 서로 지워진다(처음에 그렇게 했다가 아무것도 안 나왔다).
        //
        // 그래서 정점을 직접 민다. Body 메시의 프리미티브 여섯이
        // **정점 배열 하나를 함께 쓰므로** 한 번 밀면 몸과 옷이 같이
        // 나온다. 스키닝은 그 위에 얹히니 걷거나 숙여도 배는 따라간다.
        //
        // 자각(프롬프트의 [아이])은 이것과 별개로 그대로 있다.
        // ------------------------------------------------------------

        // 손댄 정점 배열들. 원본을 떠 두고 그 위에 얹는다.
        const bellyMeshes = [];      // {attr, base, sphere}

        function collectBelly(root) {
            if (!root) return;

            root.traverse(o => {
                if (!o.isMesh && !o.isSkinnedMesh) return;
                if (o.userData && o.userData.bone) return;      // 판정구
                if (o.userData && o.userData.part === 'hair') return;

                const g = o.geometry;
                const a = g && g.attributes && g.attributes.position;
                if (!a) return;

                if (bellyMeshes.some(m => m.attr === a)) return;

                // 몸통 높이에 정점이 있는 것만. 얼굴이나 머리카락은 뺀다.
                //
                // 예전에는 임신 설정에서 이 범위를 가져왔다. 임신을
                // 없애면서(2026-09-16) 여기 숫자로 박았다. 지금 이
                // 정점들을 쓰는 것은 가슴골 하나뿐이다.
                const cy = 1.10;
                const ry = 0.35;

                let has = false;
                for (let i = 1; i < a.array.length; i += 3) {
                    if (Math.abs(a.array[i] - cy) < ry) { has = true; break; }
                }
                if (!has) return;

                bellyMeshes.push({
                    attr: a,
                    base: Float32Array.from(a.array),
                    geo: g,
                    // 이 정점 배열을 함께 쓰는 것들. 법선을 한 번에
                    // 계산해야 해서 모아 둔다.
                    geos: [g],
                    normal: g.attributes.normal || null,
                    normalBase: g.attributes.normal
                        ? Float32Array.from(g.attributes.normal.array) : null,
                });
            });

            // 같은 정점 배열을 쓰는 다른 조각들을 찾아 붙인다
            root.traverse(o => {
                if (!o.isMesh && !o.isSkinnedMesh) return;
                const g = o.geometry;
                const a = g && g.attributes && g.attributes.position;
                if (!a) return;

                const m = bellyMeshes.find(v => v.attr === a);
                if (m && m.geos.indexOf(g) < 0) m.geos.push(g);
            });

            console.log('[diamondAI] 배를 밀 정점 배열 '
                + bellyMeshes.length + '개');
        }

        // 가슴골을 판다.
        //
        // 골은 이미 있다. 다만 얕다 — 실측하니 가운데가 옆보다 겨우
        // 1.7cm 안쪽이고, 그 정도는 MToon 의 명암 한 칸 안에 통째로
        // 묻혀서 앞에서 보면 없는 것과 같다.
        //
        // 임신과 달리 이건 늘 그대로다. 그래서 원본(base) 자체를 고쳐
        // 새 기준으로 삼는다 — 그 위에 배가 얹히고, 배를 되돌려도
        // 골은 남는다.
        //
        // 옷도 같은 정점 배열을 쓰므로 같이 파인다. 그래야 옷 위로도
        // 골이 비친다.
        function digCleavage() {
            const c = (ENTITY && ENTITY.cleavage) || null;
            if (!c || !c.enabled || !bellyMeshes.length) return;

            const cy = c.center_y || 1.27;
            const ry = c.radius_y || 0.075;
            const rx = c.radius_x || 0.034;
            const dp = c.depth || 0.016;

            let moved = 0;

            for (let m = 0; m < bellyMeshes.length; m++) {
                const rec = bellyMeshes[m];
                const base = rec.base;
                const arr = rec.attr.array;

                for (let i = 0; i < base.length; i += 3) {
                    const x = base[i], y = base[i + 1], z = base[i + 2];

                    // 앞면만. 등은 팔 이유가 없다.
                    if (z >= 0) continue;

                    const dy = Math.abs(y - cy);
                    const dx = Math.abs(x);
                    if (dy >= ry || dx >= rx) continue;

                    const fy = Math.cos((dy / ry) * Math.PI * 0.5);
                    const fx = Math.cos((dx / rx) * Math.PI * 0.5);

                    // 몸 안쪽으로 판다 (+z 가 안쪽이다)
                    base[i + 2] = z + dp * fy * fy * fx * fx;
                    arr[i + 2] = base[i + 2];
                    moved++;
                }

                rec.attr.needsUpdate = true;
            }

            console.log('[diamondAI] 가슴골 — 정점 ' + moved + '개를 팠다');
        }


        function faceBellyNormals() {
            for (let m = 0; m < bellyMeshes.length; m++) {
                const rec = bellyMeshes[m];
                if (!rec.normal) continue;

                const pos = rec.attr.array;
                const nrm = rec.normal.array;

                nrm.fill(0);

                for (let gi = 0; gi < rec.geos.length; gi++) {
                    const idx = rec.geos[gi].index;
                    if (!idx) continue;
                    const ix = idx.array;

                    for (let t = 0; t < ix.length; t += 3) {
                        const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;

                        const ax = pos[b] - pos[a];
                        const ay = pos[b + 1] - pos[a + 1];
                        const az = pos[b + 2] - pos[a + 2];
                        const bx = pos[c] - pos[a];
                        const by = pos[c + 1] - pos[a + 1];
                        const bz = pos[c + 2] - pos[a + 2];

                        const nx = ay * bz - az * by;
                        const ny = az * bx - ax * bz;
                        const nz = ax * by - ay * bx;

                        nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz;
                        nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz;
                        nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
                    }
                }

                for (let i = 0; i < nrm.length; i += 3) {
                    const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]);
                    if (l > 1e-9) {
                        nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
                    } else if (rec.normalBase) {
                        // 삼각형이 하나도 안 닿은 정점은 원래 것을 둔다
                        nrm[i] = rec.normalBase[i];
                        nrm[i + 1] = rec.normalBase[i + 1];
                        nrm[i + 2] = rec.normalBase[i + 2];
                    }
                }

                rec.normal.needsUpdate = true;
            }
        }

        function resetCamera() {
            camFree = false;

            if (user.on) {
                user.x = 0; user.z = USER_START_Z;
                user.yaw = Math.PI; user.pitch = 0;
                user.lift = 0; user.vy = 0;
                userNoticed = false;
                return;
            }

            controls.target.set(0, LOOK_Y, 0);
            camera.position.set(0, CAM_Y, 1.65);
            controls.update();
        }


        // ============================================================
        // 조이스틱
        //
        // 손잡이를 끌면 -1~1 두 축이 나온다. 이 축은 방향키와 같은
        // 자리로 들어가므로, 걷는 규칙은 한 군데에만 적혀 있다.
        // ============================================================

        const stickPad = document.getElementById('stick-pad');
        const stickKnob = document.getElementById('stick-knob');
        const stickKeys = document.getElementById('stick-keys');

        const STICK_R = 34;        // 손잡이가 벗어날 수 있는 거리(px)
        const STICK_DEAD = 0.14;   // 이 안쪽은 안 민 것으로 친다

        const stick = { on: false, x: 0, y: 0 };

        // 앉기 단추는 켜고 끄는 것이다(Shift 처럼 누르고 있을 수 없다)
        let sitLatched = false;

        function moveStick(e) {
            const r = stickPad.getBoundingClientRect();
            let dx = e.clientX - (r.left + r.width / 2);
            let dy = e.clientY - (r.top + r.height / 2);

            const d = Math.hypot(dx, dy);
            if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }

            stickKnob.style.transform =
                'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';

            // 화면은 아래로 갈수록 y 가 크다. 앞은 위쪽이므로 뒤집는다.
            stick.x = dx / STICK_R;
            stick.y = -dy / STICK_R;
        }

        function releaseStick() {
            stick.on = false;
            stick.x = 0;
            stick.y = 0;
            stickKnob.style.transform = '';
            stickPad.classList.remove('grabbed');
        }

        stickPad.addEventListener('pointerdown', (e) => {
            stick.on = true;
            stickPad.classList.add('grabbed');
            stickPad.setPointerCapture(e.pointerId);
            moveStick(e);
            e.preventDefault();
        });

        stickPad.addEventListener('pointermove', (e) => {
            if (stick.on) moveStick(e);
        });

        stickPad.addEventListener('pointerup', releaseStick);
        stickPad.addEventListener('pointercancel', releaseStick);

        // 창에서 눈을 떼면 손잡이가 밀린 채로 남아 혼자 걸어간다
        window.addEventListener('blur', releaseStick);

        document.getElementById('stick-sit').addEventListener('click', (e) => {
            sitLatched = !sitLatched;
            e.currentTarget.classList.toggle('on', sitLatched);
        });

        document.getElementById('stick-jump').addEventListener('click', () => {
            if (user.on && user.lift === 0 && user.vy === 0) {
                user.vy = USER_JUMP;
            }
        });


        // 잠깐 떴다 사라지는 안내. 화면 아래 가운데.
        let hintEl = null, hintTimer = null;

        function showHint(text, ms) {
            if (!hintEl) {
                hintEl = document.createElement('div');
                hintEl.style.cssText =
                    'position:fixed;left:50%;bottom:150px;transform:translateX(-50%);' +
                    'padding:7px 14px;border-radius:14px;z-index:40;' +
                    'background:rgba(18,20,34,0.78);color:#cfd4ee;' +
                    'font-size:12.5px;letter-spacing:0.2px;pointer-events:none;' +
                    'transition:opacity .35s;opacity:0';
                document.body.appendChild(hintEl);
            }
            hintEl.textContent = text;
            hintEl.style.opacity = '1';
            clearTimeout(hintTimer);
            hintTimer = setTimeout(() => {
                hintEl.style.opacity = '0';
            }, ms || 3200);
        }


