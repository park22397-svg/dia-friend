// system/scenes.js — 장면 — 노래방·인생네컷
// (시스템. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 자리가 열리면 할 수 있는 것
        //
        // 노래방에 있다는 것은 배경이 노래방이라는 뜻이 아니라
        // **노래를 부를 수 있다**는 뜻이다. 서버가 그 자리를 알아채
        // 악보(song)나 찍을 차례(shoot)를 실어 보내면 여기서 몸이 움직인다.
        //
        // 규칙은 서버가 쥔다. 여기는 받은 대로 하는 자리다.
        // ============================================================

        // ------------------------------------------------------------
        // 마이크
        //
        // 노래는 맨손으로 부르지 않는다. 파일을 불러오지 않고
        // 원통과 공으로 짓는다 — 손에 쥐면 그것이 마이크로 보인다.
        // ------------------------------------------------------------

        let micMesh = null;

        function buildMic() {
            if (micMesh) return micMesh;

            const g = new THREE.Group();

            // 자루는 +y 로 서 있고 머리가 위에 붙는다.
            // 손에 쥘 때 눕히는 것은 아래에서 한 번만 돌린다.
            //
            // **금속으로 칠하면 새까맣게 나온다.** metalness 가 높은
            // 재질은 비출 환경맵이 있어야 색이 산다. 이 장면에는
            // 없어서 거울처럼 검게 찍혔다 — 거의 안 쓰고 밝은 색으로.
            const body = new THREE.Mesh(
                new THREE.CylinderGeometry(0.0095, 0.0112, 0.062, 14),
                new THREE.MeshStandardMaterial({
                    color: 0x3a3a44, roughness: 0.6, metalness: 0.05 })
            );
            body.position.y = -0.012;

            const head = new THREE.Mesh(
                new THREE.SphereGeometry(0.0165, 16, 12),
                new THREE.MeshStandardMaterial({
                    color: 0xc6cad2, roughness: 0.45, metalness: 0.08,
                    emissive: 0x2a2d33 })
            );
            head.position.y = 0.028;

            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(0.0108, 0.0020, 8, 18),
                new THREE.MeshStandardMaterial({
                    color: 0xe4e6ea, roughness: 0.4, metalness: 0.05 })
            );
            ring.rotation.x = Math.PI / 2;
            ring.position.y = 0.017;

            g.add(body); g.add(head); g.add(ring);

            // 손 안에 쥐는 자리.
            //
            // **손뼈의 축은 재서 알아낸 것이다.** 눈대중으로 놓았더니
            // 손목 뒤에 작은 점으로 박혔다. 손뼈 기준으로
            //
            //   +x  손가락이 뻗는 쪽 (주먹 한가운데가 3.3cm)
            //    y  손바닥 법선 (마디들이 모두 y=0.007)
            //   ±z  검지(-) ↔ 새끼(+), 손바닥을 가로지르는 축
            //
            // 마이크는 주먹을 가로질러 쥐므로 자루가 z 를 따라 눕고,
            // 머리는 검지 쪽(-z)으로 나온다.
            //
            // 머리가 나오는 쪽은 **찍어 보고 정했다.** +90도로 눕혔더니
            // 머리가 아래를 보는 거꾸로 마이크가 됐다.
            g.position.set(0.030, 0.006, 0.004);
            g.rotation.set(-Math.PI / 2, 0, Math.PI * 0.06);

            micMesh = g;
            return g;
        }

        function showMic(on) {
            if (!currentVRM || !currentVRM.humanoid) return;

            let hand = null;
            try { hand = currentVRM.humanoid.getBoneNode('rightHand'); }
            catch (e) { hand = null; }

            if (!hand) return;

            const m = buildMic();

            if (on) {
                if (m.parent !== hand) hand.add(m);
                m.visible = true;
            } else if (m.parent) {
                m.visible = false;
            }
        }


        // ------------------------------------------------------------
        // 노래
        //
        // 말하는 목소리(TTS)는 음정을 얹을 수 없다. 그래서 노래만은
        // 소리를 처음부터 만든다(static/singer.js). 음정·길이는 서버가
        // 준 악보 그대로다 — 화면이 음을 고르면 부를 때마다 달라진다.
        // ------------------------------------------------------------

        let songCtx = null;        // 노래용 AudioContext
        let songNow = null;        // 부르는 중인 노래
        let songBox = null;        // 가사가 뜨는 자리

        function songScreen() {
            if (songBox) return songBox;

            const box = document.createElement('div');
            box.id = 'song-line';
            box.style.cssText = [
                'position:absolute', 'left:0', 'right:0', 'bottom:12%',
                'text-align:center', 'pointer-events:none', 'z-index:30',
                'font-size:clamp(18px,4.2vw,34px)', 'font-weight:700',
                'letter-spacing:0.02em', 'padding:0 16px',
                'color:#fff',
                'text-shadow:0 2px 10px rgba(0,0,0,.75),0 0 26px rgba(120,190,255,.55)',
                'opacity:0', 'transition:opacity .25s',
            ].join(';');

            (avatarContainer || document.body).appendChild(box);

            songBox = box;
            return box;
        }

        function showLyric(text) {
            const box = songScreen();

            if (!text) {
                box.style.opacity = '0';
                return;
            }

            box.textContent = '♪ ' + text;
            box.style.opacity = '1';
        }

        // 노래하는 입.
        //
        // 말할 때의 립싱크는 글자 수로 일정하게 넘어가지만, 노래는
        // 음표마다 길이가 달라서 그 방식으로는 입이 소리보다 먼저
        // 끝난다. 부를 때 받은 마디 시각표(marks)에 맞춰 연다.
        function singMouth(marks, t0) {
            const timers = [];

            for (const m of marks) {
                timers.push(setTimeout(() => {
                    const v = textToVisemes(m.ch)[0];
                    resetTargetVowels();
                    if (v) targetVowelValues[v] = 0.85;
                }, Math.max(0, (t0 + m.at) * 1000)));
            }

            return timers;
        }

        function stopSong() {
            if (!songNow) return;

            (songNow.timers || []).forEach(clearTimeout);

            try { songNow.singer.stop(); } catch (e) {}

            resetTargetVowels();
            showLyric(null);
            showMic(false);

            songNow = null;
        }

        async function singSong(score) {
            if (!score || !score.lines || !score.lines.length) return;
            if (!window.DiaSinger) {
                console.warn('[diamondAI] 노래 합성기를 못 불러왔다');
                return;
            }

            // 말과 노래가 겹치면 둘 다 안 들린다.
            stopVoice();
            stopSong();

            if (!songCtx) {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return;
                songCtx = new AC();
            }

            // 소리를 깨운다. **기다리지 않는다** —
            // 소리를 내도 되는지가 아직 안 정해진 창에서는 이 약속이
            // 영영 안 끝난다. 실제로 그 줄에서 노래가 멈춰 있었다.
            // 깨어나면 그때부터 예약해 둔 음이 울린다.
            if (songCtx.state === 'suspended') {
                try { songCtx.resume(); } catch (e) {}
            }

            const singer = new DiaSinger.Singer(songCtx, score.voice || {});
            singer.connect(songCtx.destination);

            const timers = [];
            songNow = { singer: singer, timers: timers };

            showMic(true);
            playMotion(score.motion || 'sing');

            // 부르는 동안에는 몸짓이 노래를 쥔다.
            roam.state = 'gesture';

            let at = songCtx.currentTime + 0.12;
            let total = 0;

            for (const line of score.lines) {
                const r = singer.sing(line.text, line.notes,
                                      { bpm: score.bpm || 92, at: at });

                // 가사는 그 줄을 부르기 시작할 때 뜬다
                timers.push(setTimeout(
                    () => showLyric(line.text),
                    Math.max(0, (at - songCtx.currentTime) * 1000)));

                timers.push(...singMouth(r.marks, at - songCtx.currentTime));

                at += r.duration + 0.32;
                total = at;
            }

            const ms = Math.max(0, (total - songCtx.currentTime) * 1000);

            timers.push(setTimeout(() => {
                stopSong();
                playMotion('idle');
                roam.state = 'idle';
                roam.wait = 1.5;
            }, ms + 250));
        }


        // ------------------------------------------------------------
        // 인생네컷
        //
        // 찍는 규칙(몇 컷·몇 초·어떤 포즈)은 서버가 쥔다. 여기는
        // 카메라 앞으로 데려오고, 포즈에서 멈춘 순간을 떠서 붙이는 일만 한다.
        //
        // **다가오고 멀어지는 것이 곧 사진이다.** 네 컷이 다 같은
        // 크기면 그건 같은 사진 네 장이지 네컷이 아니다.
        // ------------------------------------------------------------

        const photo = {
            on: false,          // 찍는 중인가 — 이 동안은 발을 여기서 쥔다
            targetZ: 0,         // 서 있어야 할 자리
            homeZ: 0,           // 찍기 전에 있던 자리
            homeX: 0,
            grab: null,         // 이번 프레임에 한 장 떠 달라는 부탁
            shots: [],
        };

        // 사진 찍는 동안의 걸음.
        //
        // 평소의 돌아다니기와 섞으면 서로 밀친다. 몸 돌리는 동작이
        // 방향을 쥘 때 돌아서기를 멈추는 것과 같은 얼개다.
        function photoWalk(dt) {
            const L = loco();
            if (!L) return;

            const dz = photo.targetZ - roam.z;
            const dx = photo.homeX - roam.x;
            const dist = Math.hypot(dx, dz);

            if (dist > 0.02) {
                const step = Math.min(L.walk_speed * 1.2 * dt, dist);
                roam.x += (dx / dist) * step;
                roam.z += (dz / dist) * step;
                roam.state = 'move';
                roam.phase += dt / (player.motion ? player.motion.duration : 1);
            } else {
                roam.state = 'gesture';
            }

            // 카메라를 똑바로 본다. 사진은 눈을 맞춰야 사진이다.
            const want = user.on ? yawToUser() : 0;
            roam.yaw += Math.max(-L.turn_speed * 2 * dt,
                Math.min(L.turn_speed * 2 * dt, angleDiff(roam.yaw, want)));
        }

        // 한 장 뜬다.
        //
        // WebGL 캔버스는 그린 **바로 그 프레임 안에서** 떠야 한다.
        // 한 박자라도 늦으면 화면이 비워져 빈 그림이 나온다.
        // 그래서 그리는 자리에 부탁을 걸어 두고 기다린다.
        function grabShot() {
            return new Promise(res => { photo.grab = res; });
        }

        // 뜬 그림에 배경을 깔아 한 장으로 만든다.
        //
        // 배경은 three.js 안이 아니라 창의 CSS 에 있다(그래서 캔버스만
        // 뜨면 뒤가 비친다). 같은 그림을 같은 방식(cover)으로 깔아 준다.
        function withBackground(shot, w, h) {
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const g = c.getContext('2d');

            const url = (backgrounds.list && backgrounds.list[backgrounds.at])
                ? backgrounds.list[backgrounds.at].url : null;

            const paint = (img) => {
                if (img) {
                    // cover — 넘치는 쪽을 자른다
                    const s = Math.max(w / img.width, h / img.height);
                    const iw = img.width * s, ih = img.height * s;
                    g.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
                    g.fillStyle = 'rgba(0,0,0,0.18)';
                    g.fillRect(0, 0, w, h);
                } else {
                    const grad = g.createLinearGradient(0, 0, 0, h);
                    grad.addColorStop(0, '#2a2f45');
                    grad.addColorStop(1, '#151824');
                    g.fillStyle = grad;
                    g.fillRect(0, 0, w, h);
                }
                g.drawImage(shot, 0, 0, w, h);
                return c;
            };

            if (!url) return Promise.resolve(paint(null));

            return new Promise(res => {
                const img = new Image();
                img.onload = () => res(paint(img));
                img.onerror = () => res(paint(null));
                img.src = url;
            });
        }

        // 넉 장을 한 줄로 붙인다. 인생네컷의 그 틀이다.
        function makeStrip(cuts) {
            const pad = 26, gap = 14;
            const cw = 420, ch = 300;
            const w = cw + pad * 2;
            const h = pad + (ch + gap) * cuts.length + 86;

            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const g = c.getContext('2d');

            g.fillStyle = '#12131a';
            g.fillRect(0, 0, w, h);

            cuts.forEach((cut, i) => {
                const y = pad + (ch + gap) * i;
                g.drawImage(cut, pad, y, cw, ch);
                g.strokeStyle = 'rgba(255,255,255,0.10)';
                g.lineWidth = 1;
                g.strokeRect(pad + 0.5, y + 0.5, cw - 1, ch - 1);
            });

            const d = new Date();
            const two = (n) => String(n).padStart(2, '0');

            g.fillStyle = 'rgba(255,255,255,0.92)';
            g.font = '600 26px system-ui, sans-serif';
            g.textAlign = 'center';
            g.fillText('다이아 ♥ 우리',
                w / 2, h - 52);

            g.fillStyle = 'rgba(255,255,255,0.45)';
            g.font = '400 19px system-ui, sans-serif';
            g.fillText(d.getFullYear() + '.' + two(d.getMonth() + 1) + '.'
                + two(d.getDate()), w / 2, h - 24);

            return c;
        }

        function showStrip(canvasEl) {
            const back = document.createElement('div');
            back.style.cssText = [
                'position:fixed', 'inset:0', 'z-index:9999',
                'background:rgba(6,7,12,.82)', 'display:flex',
                'flex-direction:column', 'align-items:center',
                'justify-content:center', 'gap:14px', 'padding:18px',
                'backdrop-filter:blur(3px)',
            ].join(';');

            canvasEl.style.cssText =
                'max-height:72vh;max-width:86vw;border-radius:10px;'
                + 'box-shadow:0 18px 50px rgba(0,0,0,.6)';

            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:10px';

            const mk = (label, fn) => {
                const b = document.createElement('button');
                b.textContent = label;
                b.style.cssText = [
                    'padding:11px 22px', 'border-radius:999px', 'border:0',
                    'font-size:15px', 'font-weight:600', 'cursor:pointer',
                    'background:rgba(255,255,255,.14)', 'color:#fff',
                ].join(';');
                b.onclick = fn;
                return b;
            };

            row.appendChild(mk('저장', () => {
                const a = document.createElement('a');
                a.download = '다이아_네컷.png';
                a.href = canvasEl.toDataURL('image/png');
                a.click();
            }));

            row.appendChild(mk('닫기', () => back.remove()));

            back.appendChild(canvasEl);
            back.appendChild(row);
            back.onclick = (e) => { if (e.target === back) back.remove(); };

            document.body.appendChild(back);
        }

        // 셋 · 둘 · 하나
        function countIn(n, ms) {
            return new Promise(res => {
                const box = songScreen();
                let left = n;

                const tick = () => {
                    if (left <= 0) {
                        box.style.opacity = '0';
                        res();
                        return;
                    }
                    box.textContent = String(left);
                    box.style.opacity = '1';
                    left--;
                    setTimeout(tick, ms);
                };

                tick();
            });
        }

        function flash(ms) {
            const f = document.createElement('div');
            f.style.cssText = [
                'position:absolute', 'inset:0', 'z-index:40',
                'background:#fff', 'pointer-events:none',
                'opacity:1', 'transition:opacity ' + ms + 'ms',
            ].join(';');

            (avatarContainer || document.body).appendChild(f);

            requestAnimationFrame(() => { f.style.opacity = '0'; });
            setTimeout(() => f.remove(), ms + 60);
        }

        const wait = (ms) => new Promise(r => setTimeout(r, ms));

        async function photoShoot(conf) {
            if (photo.on || !conf || !currentVRM) return;

            const poses = conf.poses || [];
            if (!poses.length) return;

            stopVoice();
            stopSong();

            // 자는 채로 찍으면 눈 감은 사진 넉 장이 나온다.
            if (isSleeping) wakeUp();

            photo.on = true;
            photo.shots = [];
            photo.homeX = roam.x;
            photo.homeZ = roam.z;

            // 사진은 더 넓게 담는다.
            //
            // 평소 화각(30도)으로 코앞까지 다가오면 얼굴만 가득 찬다.
            // 처음 찍어 보니 넉 장이 전부 얼굴이라 포즈가 하나도
            // 안 보였다. 찍는 동안만 렌즈를 넓힌다 —
            // 다가오는 것이 오히려 더 잘 보인다.
            const fov0 = camera.fov;
            camera.fov = conf.fov || 42;
            camera.updateProjectionMatrix();

            const cuts = Math.min(conf.cuts || 4, poses.length);
            const zoom = conf.zoom || [];
            const stepIn = (conf.step_in == null) ? 0.4 : conf.step_in;

            try {
                // 카메라 앞으로 온다
                photo.targetZ = photo.homeZ + stepIn;
                playMotion('walk');
                await wait(900);

                for (let i = 0; i < cuts; i++) {
                    // 컷마다 조금씩 다가오고 멀어진다
                    photo.targetZ = photo.homeZ + stepIn + (zoom[i] || 0);

                    if (i > 0) {
                        playMotion('walk');
                        await wait(520);
                    }

                    const p = poses[i];

                    // **그 자세로 서 있어야 찍힌다.**
                    //
                    // 처음에는 그냥 재생했더니, 셋을 세는 2.1초 동안
                    // 동작(1.6초)이 이미 끝나 팔을 내린 사진이 넉 장
                    // 나왔다. 카운트가 끝나고 찍을 때까지 붙들어 둔다.
                    const hold = (conf.count_from || 3) * (conf.count_ms || 700)
                        + (conf.flash_ms || 260) + (conf.hold_ms || 900) + 600;

                    playMotion(p.motion, { linger_ms: hold });
                    if (p.face) applyExpression(p.face);

                    await countIn(conf.count_from || 3, conf.count_ms || 700);

                    // 포즈에서 멈춘 순간을 뜬다
                    await wait(160);

                    flash(conf.flash_ms || 260);

                    const raw = await grabShot();
                    const one = await withBackground(raw, 840, 600);
                    photo.shots.push(one);

                    await wait(conf.hold_ms || 900);
                }

                // 제자리로
                photo.targetZ = photo.homeZ;
                playMotion('walk');
                await wait(900);

                playMotion('idle');
                applyExpression('fun');

                showStrip(makeStrip(photo.shots));

            } catch (e) {
                console.warn('[diamondAI] 네컷 오류', e);
            } finally {
                camera.fov = fov0;
                camera.updateProjectionMatrix();

                photo.on = false;
                photo.grab = null;
                roam.state = 'idle';
                roam.wait = 2.0;
            }
        }


        function animate() {

            requestAnimationFrame(
                animate
            );

            const deltaTime =
                clock.getDelta();

            // 상대가 먼저 움직이고, 다이아는 그 자리를 보고 정한다.
            // 순서가 뒤집히면 한 프레임 늦은 자리를 보게 된다.
            updateUser(deltaTime);

            findFace();

            updateNotice();
            updateKissWait();
            updateGaze(deltaTime);


            if (currentVRM) {

                // 개체가 내려준 동작을 재생하고 위치를 갱신한다
                updateMotion(deltaTime);
                updateRoam(deltaTime);
                updateBubblePos(deltaTime);
                updateZzzPos();



                // ----------------------------------------------------
                // 입 모양 부드러운 전환
                // ----------------------------------------------------

                if (
                    currentVRM.blendShapeProxy
                ) {

                    const lerpSpeed =
                        10.0 * deltaTime;


                    [
                        'a',
                        'i',
                        'u',
                        'e',
                        'o'
                    ].forEach(v => {

                        currentVowelValues[v] +=
                            (
                                targetVowelValues[v] -
                                currentVowelValues[v]
                            ) *
                            Math.min(
                                lerpSpeed,
                                1.0
                            );


                        try {

                            const presetName =
                                (
                                    THREE.VRMBlendShapePresetName &&
                                    THREE.VRMBlendShapePresetName[
                                        v.toUpperCase()
                                    ]
                                )
                                    ? THREE.VRMBlendShapePresetName[
                                        v.toUpperCase()
                                    ]
                                    : v;


                            currentVRM
                                .blendShapeProxy
                                .setValue(
                                    presetName,
                                    currentVowelValues[v]
                                );

                        } catch (e) {}

                    });


                    currentVRM
                        .blendShapeProxy
                        .update();
                }


                if (!isSleeping) {


                    // ------------------------------------------------
                    // 머리 움직임
                    // ------------------------------------------------

                    try {

                        const head =
                            currentVRM.humanoid
                                .getBoneNode(
                                    'head'
                                );


                        if (head) {

                            // 숨 흔들림과 마음이 지운 자세(dia/heart.js).
                            // 서운하면 숙이고 눈을 피하고, 설레면 빨리 들썩인다.
                            const hp = updateHeartPose(deltaTime);

                            head.rotation.x =
                                poseHeadX + hp.x
                                // 카메라에 보이는 얼굴 쪽으로 고개를 든다
                                + gaze.pitch;

                            // 좌우는 여기서만 건드린다.
                            // 몸이 도는 것(roam.yaw)과 별개로 고개만 돌린다.
                            head.rotation.y = gaze.yaw + hp.y;
                            head.rotation.z = poseHeadZ + hp.z;
                        }

                    } catch (e) {}


                    // ------------------------------------------------
                    // 자동 눈 깜빡임
                    // 표정 중에는 완전히 정지
                    // ------------------------------------------------

                    if (!isExpressing) {

                        blinkTimer +=
                            deltaTime;


                        if (
                            !isBlinking &&
                            blinkTimer >=
                            blinkInterval
                        ) {

                            isBlinking = true;

                            blinkTimer = 0;

                            blinkProgress = 0;
                        }


                        if (isBlinking) {

                            blinkProgress +=
                                deltaTime * 4;


                            let blinkValue = 0;


                            if (
                                blinkProgress < 1.0
                            ) {

                                blinkValue =
                                    blinkProgress;

                            } else if (
                                blinkProgress < 2.0
                            ) {

                                blinkValue =
                                    2.0 -
                                    blinkProgress;

                            } else {

                                blinkValue = 0;

                                isBlinking = false;

                                blinkInterval =
                                    3 +
                                    Math.random() * 4;
                            }


                            try {

                                const blinkPreset =
                                    (
                                        THREE.VRMBlendShapePresetName &&
                                        THREE.VRMBlendShapePresetName.Blink
                                    )
                                        ? THREE.VRMBlendShapePresetName.Blink
                                        : 'blink';


                                currentVRM
                                    .blendShapeProxy
                                    .setValue(
                                        blinkPreset,
                                        // 끝까지 감으면 눈꺼풀이 겹친다
                                        blinkValue * eyeCloseMax()
                                    );


                                currentVRM
                                    .blendShapeProxy
                                    .update();

                            } catch (e) {}
                        }
                    }
                }


                currentVRM.update(
                    deltaTime
                );
            }


            // 옷이 걸어간 만큼 몸도 따라간다
            followBody();

            // 옷장에서 입은 옷을 몸에 맞물린다.
            //
            // 자세가 다 정해진 뒤라야 한다. 앞에 두면 한 프레임 늦은 자리를
            // 베껴서 빠르게 움직일 때 옷만 뒤에 끌린다.
            syncWear();
            updateWear(deltaTime);          // 치마 흔들림 본


            renderer.render(
                scene,
                camera
            );

            // 사진 한 장을 떠 달라는 부탁이 걸려 있으면 지금 뜬다.
            //
            // **그린 바로 그 프레임 안에서** 떠야 한다. 이 캔버스는
            // preserveDrawingBuffer 를 안 켰기 때문에, 한 박자만 늦어도
            // 화면이 비워져 빈 그림이 나온다.
            if (photo.grab) {
                const done = photo.grab;
                photo.grab = null;

                const im = new Image();
                im.onload = () => done(im);
                im.onerror = () => done(null);
                im.src = renderer.domElement.toDataURL('image/png');
            }
        }




