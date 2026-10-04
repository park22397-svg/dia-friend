// dia/motion.js — 몸짓 — 동작 재생기·돌아다니기
// (다이아의 몸. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 동작 재생기
        //
        // 클립은 절대 자세로 적혀 있고,
        // 클립이 언급하지 않은 본은 base_pose 를 쓴다.
        // ============================================================

        const MOTION_BONES = [
            'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
            'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
            'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
            'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
            'rightUpperLeg', 'rightLowerLeg', 'rightFoot'
        ];

        // 손가락도 자세를 받아야 한다.
        // 여기 없으면 개체가 정한 손 모양이 화면에 닿지 못해,
        // 손이 T포즈 그대로 판자처럼 쫙 펴진 채로 남는다.
        ['left', 'right'].forEach(side => {
            ['Thumb', 'Index', 'Middle', 'Ring', 'Little'].forEach(finger => {
                ['Proximal', 'Intermediate', 'Distal'].forEach(joint => {
                    MOTION_BONES.push(side + finger + joint);
                });
            });
        });

        let boneNodes = {};
        let boneNodesBody = {};   // 겹쳐 놓은 몸(표현용)의 같은 뼈
        const DEG = Math.PI / 180;

        const EASE = {
            linear: u => u,
            easeIn: u => u * u,
            easeOut: u => 1 - (1 - u) * (1 - u),
            easeInOut: u => u * u * (3 - 2 * u)
        };

        const player = {
            motion: null, time: 0, done: true,
            from: null, blend: 1, blendDur: 0.22
        };

        // 동작이 정한 머리 각도. 숨쉬기 흔들림은 이 값 '위에' 얹는다.
        // 덮어쓰면 끄덕임 같은 머리 동작이 화면에서 지워진다.
        let poseHeadX = 0;

        function cacheBones() {
            boneNodes = {};
            boneNodesBody = {};
            if (!currentVRM || !currentVRM.humanoid) return;
            MOTION_BONES.forEach(n => {
                let node = null;
                try { node = currentVRM.humanoid.getBoneNode(n); } catch (e) {}
                if (node) boneNodes[n] = node;

                // 겹쳐 놓은 몸에도 같은 자세를 준다. 뼈대가 같아서 그대로 먹는다.
                if (bodyVRM && bodyVRM.humanoid) {
                    let b = null;
                    try { b = bodyVRM.humanoid.getBoneNode(n); } catch (e) {}
                    if (b) boneNodesBody[n] = b;
                }
            });
        }

        function expressionByKey(key) {
            return ((ENTITY && ENTITY.expressions) || [])
                .find(e => e.key === key) || null;
        }

        function motionByKey(k) {
            if (!ENTITY) return null;
            return ENTITY.motions.find(m => m.key === k) || null;
        }

        function basePose() {
            return (ENTITY && ENTITY.base_pose) ? ENTITY.base_pose : {};
        }

        function samplePose(m, t) {
            const base = basePose();
            const pose = {};
            Object.keys(base).forEach(n => pose[n] = base[n].slice());

            const keys = m.keys;
            let a = keys[0], b = keys[0], u = 0;

            if (t <= keys[0].t) { a = b = keys[0]; }
            else if (t >= keys[keys.length - 1].t) { a = b = keys[keys.length - 1]; }
            else {
                for (let i = 0; i < keys.length - 1; i++) {
                    if (t >= keys[i].t && t < keys[i + 1].t) {
                        a = keys[i]; b = keys[i + 1];
                        u = (t - a.t) / (b.t - a.t);
                        break;
                    }
                }
            }

            const e = (EASE[m.ease] || EASE.easeInOut)(u);

            m.channels.forEach(n => {
                const bs = base[n] || [0, 0, 0];
                const ra = (a.bones && a.bones[n]) || bs;
                const rb = (b.bones && b.bones[n]) || bs;
                pose[n] = [
                    ra[0] + (rb[0] - ra[0]) * e,
                    ra[1] + (rb[1] - ra[1]) * e,
                    ra[2] + (rb[2] - ra[2]) * e
                ];
            });
            return pose;
        }

        function currentPose() {
            if (!player.motion) {
                const base = basePose(), p = {};
                Object.keys(base).forEach(n => p[n] = base[n].slice());
                return p;
            }
            return samplePose(player.motion, player.time);
        }

        let motionFaceTimer = null;

        function playMotion(key, opts) {
            // 등을 돌리거나 팔짱을 끼는 일이 없어지는 단계가 있다.
            key = swapNegative('motions', key);

            const m = motionByKey(key);
            if (!m) return;

            // 배경화면 쪽 다이아에게도 알린다.
            //
            // 단추 창과 배경화면은 서로 다른 그림이라, 알려 주지 않으면
            // 이야기 창에서는 손을 흔드는데 배경화면의 다이아는 가만히
            // 있다. 앱이 아니면(브라우저) 이 다리가 없으니 그냥 지나간다.
            try {
                if (window.DiaWall && DiaWall.motion) DiaWall.motion(key);
            } catch (e) {}
            player.from = currentPose();
            player.blend = 0;
            player.motion = m;
            player.time = 0;
            player.done = false;

            // 그 자세로 얼마나 서 있을지. 부르는 쪽이 정할 수 있고,
            // 없으면 동작이 스스로 들고 있는 값을 쓴다.
            player.lingerLeft = (opts && typeof opts.linger_ms === 'number')
                ? opts.linger_ms
                : (m.linger_ms || 0);

            // 동작이 함께 지을 표정을 정해 뒀다면 그것도 같이 짓는다.
            // 쑥스러워하기에 놀란 표정이 늘 따라붙는 것이 이 자리다.
            // (idle·walk 처럼 표정을 정하지 않은 동작은 얼굴을 건드리지 않는다)
            //
            // 다만 이미 어울리는 얼굴이면 덮어쓰지 않는다.
            // 팔짱과 등 돌리기는 삐죽만의 몸짓이 아니다 — 화나서 팔짱을
            // 끼기도 하고 서운해서 등을 돌리기도 한다. 그때까지 삐죽으로
            // 바꿔 버리면 화난 말끝에 삐친 얼굴이 나온다.
            if (motionFaceTimer) {
                clearTimeout(motionFaceTimer);
                motionFaceTimer = null;
            }

            // 말끝에 딸려 나온 몸짓은 얼굴을 건드리지 않는다.
            //
            // "조금 쑥스럽네요" 하면서 몸을 움츠릴 수는 있어도, 그때 얼굴까지
            // 놀란 얼굴로 바뀌지는 않는다. 사람은 쑥스럽다고 말하면서 웃는다.
            // 얼굴은 그 문장의 감정이 정하고, 몸짓만 얹는 것이 맞다.
            //
            // 만져서 놀란 것은 다르다. 그건 정말로 놀란 것이라 얼굴이 같이 간다.
            const spoken = !!(opts && opts.spoken);

            if (m.expression && !spoken) {

                // 이미 지어진 얼굴이 있으면 동작은 얼굴을 건드리지 않는다.
                //
                // 팔짱과 등 돌리기는 삐죽만의 몸짓이 아니다 — 화나서 팔짱을
                // 끼기도 하고 서운해서 등을 돌리기도 한다. 반대로 삐죽은
                // 이 두 몸짓과만 같이 나온다. 규칙 하나로 둘 다 된다.
                // 만졌을 때도 자리가 정한 얼굴이 늘 이긴다.
                //
                // 다만 얼굴이 곧 그 동작인 몸짓은 예외다. 쑥스러워하기와
                // 얼굴 가리기는 놀란 얼굴과 한 몸이라, 웃으면서 하면
                // 무엇을 하는 건지 알 수 없게 된다.
                // 마음이 남긴 쉬는 얼굴도 빈 얼굴로 친다 — 옅게 지은 것이라 덮어도 된다.
                const bare = !currentExpression || currentExpression === 'neutral'
                    || faceResting;

                if (bare || m.expression_force) {

                    // 데려온 얼굴은 데려간 쪽이 치운다.
                    //
                    // 예전에는 치우는 데가 없어서, 손을 내린 뒤에도 놀란
                    // 얼굴이 다음 무언가가 덮을 때까지 그대로 남아 있었다.
                    // 되돌릴 곳은 평온이 아니라 '동작 전에 짓고 있던 얼굴'
                    // 이다 — 말하는 중이면 그 말의 얼굴로 돌아가야 한다.
                    const before = currentExpression || 'neutral';
                    const beforeRest = faceResting;

                    applyExpression(m.expression);

                    const ms = (typeof m.expression_ms === 'number')
                        ? m.expression_ms
                        : (m.duration || 0) * 1000;

                    if (ms > 0) {
                        motionFaceTimer = setTimeout(() => {
                            motionFaceTimer = null;
                            // 그 사이 다른 얼굴로 바뀌었으면 건드리지 않는다
                            if (currentExpression === m.expression) {
                                if (beforeRest) settleFace(); else applyExpression(before);
                            }
                        }, ms);
                    }
                }
            }
        }

        function updateMotion(dt) {
            if (!currentVRM) return;

            if (!player.motion) {
                const b = basePose()['head'];
                poseHeadX = b ? b[0] * DEG : 0;
                return;
            }

            // 마음이 큰 만큼 그 자세로 더 서 있는다.
            //
            // 등을 돌린 채 얼마나 있을지는 서운함의 크기가 정한다.
            // 마음마다 키프레임을 새로 만들 수는 없으니, 가장 오래
            // 머무는 지점(hold_t)에서 재생을 그만큼 세워 둔다.
            const holdT = player.motion.hold_t;
            const linger = player.lingerLeft || 0;

            if (typeof holdT === 'number' && linger > 0
                && player.time >= holdT) {

                player.lingerLeft = linger - dt * 1000;
                player.time = holdT;

            } else {
                player.time += dt;
            }

            if (player.time >= player.motion.duration) {
                if (player.motion.loop) {
                    player.time = player.time % player.motion.duration;
                } else {
                    player.time = player.motion.duration;
                    player.done = true;
                }
            }
            if (player.blend < 1) {
                player.blend = Math.min(1, player.blend + dt / player.blendDur);
            }

            let pose = samplePose(player.motion, player.time);

            if (player.from && player.blend < 1) {
                const w = EASE.easeInOut(player.blend);
                const base = basePose();
                const names = {};
                Object.keys(pose).forEach(n => names[n] = 1);
                Object.keys(player.from).forEach(n => names[n] = 1);
                const out = {};
                Object.keys(names).forEach(n => {
                    const bs = base[n] || [0, 0, 0];
                    const f = player.from[n] || bs, tg = pose[n] || bs;
                    out[n] = [
                        f[0] + (tg[0] - f[0]) * w,
                        f[1] + (tg[1] - f[1]) * w,
                        f[2] + (tg[2] - f[2]) * w
                    ];
                });
                pose = out;
            }

            const base = basePose();
            Object.keys(base).forEach(n => { if (!(n in pose)) pose[n] = base[n]; });

            Object.keys(pose).forEach(n => {
                const r = pose[n];
                const node = boneNodes[n];
                if (node) node.rotation.set(r[0] * DEG, r[1] * DEG, r[2] * DEG);

                // 겹쳐 놓은 몸도 같이 움직여야 한다.
                // 한쪽만 주면 옷과 몸이 따로 논다.
                const b = boneNodesBody[n];
                if (b) b.rotation.set(r[0] * DEG, r[1] * DEG, r[2] * DEG);
            });

            poseHeadX = pose['head'] ? pose['head'][0] * DEG : 0;

            // 몸 전체가 도는 동작(등 돌리기)은 뼈로 못 만든다.
            // 척추를 150도 비트는 사람은 없다. 그래서 여기서 통째로 돌린다.
            // 돌았다가 제자리로 돌아오도록 종 모양으로 오르내린다.
            if (player.motion.turn_yaw) {
                const u = player.time / player.motion.duration;
                const bell = Math.sin(Math.min(1, Math.max(0, u)) * Math.PI);
                roam.yaw = player.motion.turn_yaw * DEG
                    * EASE.easeInOut(bell);
            }
        }


        // ============================================================
        // 돌아다니기
        // ============================================================

        const roam = {
            on: false, state: 'idle',
            x: 0, z: 0, yaw: 0, targetX: 0, targetZ: 0,
            wait: 0, phase: 0,
            following: false        // 상대를 따라가는 중인가
        };

        function loco() {
            return (ENTITY && ENTITY.locomotion) ? ENTITY.locomotion : null;
        }

        // 0보다 크면 그 시간 동안 이쪽으로 빠르게 돌아선다
        let faceUrgency = 0;

        // 0보다 크면 그 시간 동안 고개를 돌린 채로 둔다.
        // 입을 닫았을 때 쓴다 — 안 그러면 돌아서자마자 다시 이쪽을 봐서
        // 외면한 티가 나지 않는다.
        let sulkTimer = 0;

        // 돌아다녀도 되는가.
        //
        // 대화 중에 혼자 걸어 다니면 이야기하다 말고 떠나는 꼴이 된다.
        // 그래서 기본은 제자리다. 한동안 조용해서 다이아가 먼저 말을 건
        // 뒤부터 돌아다니고, 상대가 다시 말을 걸면 멈춘다.
        let mayRoam = false;

        function faceUser() {
            // 말을 걸었으면 걷던 것을 멈춘다. 등을 돌린 채 대답하면 어색하다.
            if (roam.state === 'move') {
                roam.state = 'idle';
                roam.wait = 2.5;
                playMotion('idle');
            }
            faceUrgency = 1.4;

            // 이야기가 시작됐으니 다시 조용해질 때까지는 제자리에 있는다.
            // 다만 같이 걷는 중이라면 발을 묶지 않는다 —
            // 산책하면서 말도 하는 것이 자연스럽다.
            if (!walking) mayRoam = false;
        }


        // 같이 걷는 중인가.
        //
        // 평소에는 제자리에 서 있다가, "산책하자" 같은 말이 나오면
        // 발이 풀린다. "그만 걷자" 하면 멈추고 이쪽을 본다.
        let walking = false;

        function setWalking(on) {
            if (walking === on) return;
            walking = on;
            mayRoam = on;

            if (on) {
                // 곧바로 걷기 시작한다. 기다릴 이유가 없다.
                roam.wait = 0;
                console.log('[diamondAI] 같이 걷기 시작');
            } else {
                if (roam.state === 'move') {
                    roam.state = 'idle';
                    roam.wait = 2.0;
                    playMotion('idle');
                }
                faceUrgency = 1.4;
                console.log('[diamondAI] 걷기 멈춤');
            }
        }

        function angleDiff(a, b) {
            let d = (b - a) % (Math.PI * 2);
            if (d > Math.PI) d -= Math.PI * 2;
            if (d < -Math.PI) d += Math.PI * 2;
            return d;
        }

        function pickRoamTarget() {
            const L = loco();
            // 대화 화면은 카메라가 가까우므로 좁게 움직인다
            const radius = Math.min(L.roam_radius, 0.75);
            for (let i = 0; i < 12; i++) {
                const ang = Math.random() * Math.PI * 2;
                const r = radius * (0.4 + Math.random() * 0.6);
                const tx = Math.cos(ang) * r, tz = Math.sin(ang) * r * 0.5;
                if (Math.hypot(tx - roam.x, tz - roam.z) > 0.25) {
                    roam.targetX = tx; roam.targetZ = tz; return;
                }
            }
            roam.targetX = 0; roam.targetZ = 0;
        }

        function updateRoam(dt) {
            const L = loco();
            if (!currentVRM || !L) return;

            // 사진을 찍는 중에는 사진 쪽이 발을 쥔다.
            //
            // 여기서 같이 정하면 서로 밀친다 — 몸을 돌리는 동작이
            // 재생 중일 때 돌아서기를 멈추는 것과 같은 얼개다.
            if (photo.on) {
                photoWalk(dt);
            } else if (isSleeping || lipSyncTimer || isWaitingForAI) {
                if (roam.state === 'move') {
                    roam.state = 'idle';
                    roam.wait = 3;
                    playMotion('idle');
                }
            } else if (roam.state === 'gesture') {
                if (player.done) {
                    roam.state = 'idle';
                    roam.wait = 2 + Math.random() * 4;
                    playMotion('idle');
                }
            } else if (roam.state === 'idle') {
                roam.wait -= dt;

                // 상대가 멀어졌으면 그것부터다.
                //
                // 따라가기는 혼자 돌아다니기와 다르다. mayRoam 도
                // roam_enabled 도 안 본다 — 두고 가면 따라나서는 것은
                // 심심해서 걷는 것과 다른 일이기 때문이다.
                // 다만 자거나 말하는 중이면 위쪽 갈래가 먼저 잡아
                // 여기까지 오지 않는다. 말을 마친 뒤에 따라나선다.
                if (!startFollow()) {

                    // 아직 돌아다닐 때가 아니면 제자리에 둔다.
                    // 개체가 아예 꺼 뒀거나(roam_enabled), 대화 중이면 안 움직인다.
                    if (!mayRoam || !L.roam_enabled) roam.wait = 1.0;

                    if (roam.wait <= 0) {
                        pickRoamTarget();
                        roam.state = 'move';
                        playMotion('walk');
                    }
                }
            } else if (roam.state === 'move') {
                // 따라가는 중이면 목적지가 상대를 좇아 움직인다
                if (roam.following) trackUser();

                const dx = roam.targetX - roam.x, dz = roam.targetZ - roam.z;
                const dist = Math.hypot(dx, dz);
                if (dist <= L.arrive_dist) {
                    roam.state = 'idle';
                    roam.following = false;
                    roam.wait = 4 + Math.random() * 6;
                    playMotion('idle');
                } else {
                    const want = Math.atan2(dx, dz);
                    const diff = angleDiff(roam.yaw, want);
                    roam.yaw += Math.max(-L.turn_speed * dt,
                        Math.min(L.turn_speed * dt, diff));
                    const align = Math.max(0, Math.cos(angleDiff(roam.yaw, want)));

                    // 따라갈 때는 걸음이 빨라진다. 평소 속도(0.42m/s)로는
                    // 걸어가는 사람을 영영 못 따라잡는다.
                    // 걸음 주기도 같은 배수로 빨라져야 발이 더 미끄러지지 않는다.
                    const mul = roam.following
                        ? followCfg('follow_speed_mul', 1.6) : 1;

                    const step = Math.min(L.walk_speed * mul * dt * align, dist);
                    roam.x += Math.sin(roam.yaw) * step;
                    roam.z += Math.cos(roam.yaw) * step;
                    roam.phase += dt * mul /
                        (player.motion ? player.motion.duration : 1);
                }
            }

            // 걷는 중이 아니면 늘 이쪽을 향해 돌아선다.
            // 말을 걸었을 때는 한동안 훨씬 빠르게 돈다. 하던 걸 멈추고
            // 바로 이쪽을 보는 것이 자연스럽다.
            // 몸을 돌리는 동작이 재생 중이면 그 동작이 방향을 쥔다.
            // 여기서 같이 돌리면 서로 밀친다.
            const turning = player.motion && player.motion.turn_yaw;

            if (roam.state !== 'move' && !turning) {
                if (sulkTimer > 0) {
                    // 외면하는 중이다. 이쪽으로 돌리지 않는다.
                    sulkTimer -= dt;
                } else {
                    const sp = L.turn_speed * (faceUrgency > 0 ? 5.0 : 1);
                    // 예전에는 늘 정면(0)을 봤다. 이제는 상대가 서 있는
                    // 자리를 본다 — 옆으로 돌아가면 고개도 따라온다.
                    roam.yaw += Math.max(-sp * dt,
                        Math.min(sp * dt, angleDiff(roam.yaw, yawToUser())));
                }
            }

            if (faceUrgency > 0) faceUrgency -= dt;

            const bob = (roam.state === 'move')
                ? Math.abs(Math.sin(roam.phase * Math.PI * 2)) * L.bob_height : 0;

            currentVRM.scene.position.set(roam.x, L.ground_y + bob, roam.z);
            currentVRM.scene.rotation.y = Math.PI + roam.yaw;

            if (bodyVRM) {
                bodyVRM.scene.position.copy(currentVRM.scene.position);
                bodyVRM.scene.rotation.y = currentVRM.scene.rotation.y;
            }

            if (floorGrid) floorGrid.position.y = L.ground_y;

            if (footShadow) {
                footShadow.position.set(roam.x, L.ground_y + 0.004, roam.z);
                // 걸을 때 살짝 뜨면 그림자도 옅어진다
                footShadow.material.opacity = 1 - Math.min(0.35, bob * 12);
            }

            // 1인칭에서는 카메라가 상대의 눈이다. 여기서 건드리면 안 된다.
            if (user.on) return;

            // 사람이 시점을 잡았으면 카메라는 건드리지 않는다.
            // 돌려 놓은 것을 자동으로 되돌리면 서로 싸운다.
            if (camFree) {
                controls.target.lerp(
                    new THREE.Vector3(roam.x * 0.8, LOOK_Y, roam.z * 0.5),
                    Math.min(1, dt * 1.2)
                );
                return;
            }

            // 아직 아무도 안 잡았으면 살짝 따라가 화면 밖으로 나가지 않게 한다
            camera.position.x += (roam.x * 0.55 - camera.position.x) * Math.min(1, dt * 2.5);

            // 걸을 때 카메라가 한 발 물러서는 것은 화면 밖으로 나가지
            // 않게 하려는 것이다. 사진을 찍을 때는 물러서면 안 된다 —
            // 다가온 만큼 그대로 따라 물러나면 다가온 것이 아니다.
            const back = (!photo.on && roam.state === 'move') ? 0.45 : 0;
            const wantZ = 1.65 + back;
            camera.position.z += (wantZ - camera.position.z) * Math.min(1, dt * 1.6);
            camera.lookAt(roam.x * 0.8, LOOK_Y, roam.z * 0.5);
            controls.target.set(roam.x * 0.8, LOOK_Y, roam.z * 0.5);
        }


