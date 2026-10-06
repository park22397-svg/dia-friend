// dia/touch.js — 만지기 — 판정구·도구·반응
// (다이아의 몸. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 만지기
        //
        // 메시를 직접 레이캐스트하지 않는다. 15MB 짜리라 비싸고,
        // 스키닝을 라이브러리가 반영해 주는지에 따라 결과가 달라진다.
        // 대신 개체가 내려준 '판정구'를 본에 붙여 그것만 맞힌다.
        // 본에 붙어 있으니 자세가 바뀌어도 그대로 따라가고,
        // 맞은 공이 곧 어느 본인지 알려준다.
        // ============================================================

        const raycaster = new THREE.Raycaster();
        const pointerNDC = new THREE.Vector2();

        let hitboxes = [];
        let showHitboxes = false;

        const HITBOX_HIDDEN = new THREE.MeshBasicMaterial({
            colorWrite: false, depthWrite: false, transparent: true, opacity: 0
        });

        const HITBOX_SHOWN = new THREE.MeshBasicMaterial({
            color: 0x7a68b0, wireframe: true, transparent: true, opacity: 0.55
        });

        function buildHitboxes() {
            hitboxes.forEach(h => h.parent && h.parent.remove(h));
            hitboxes = [];

            if (!currentVRM || !ENTITY || !ENTITY.touch) return;

            const geo = new THREE.SphereGeometry(1, 10, 8);

            (ENTITY.touch.hitboxes || []).forEach(h => {
                let node = null;
                try {
                    node = currentVRM.humanoid.getBoneNode(h.bone);
                } catch (e) {}
                if (!node) return;

                const m = new THREE.Mesh(geo, HITBOX_HIDDEN);
                m.position.set(h.offset[0], h.offset[1], h.offset[2]);
                m.scale.setScalar(h.radius);
                m.userData.bone = h.bone;
                // 옷 판정구는 자기가 어느 자리인지 직접 들고 있다
                m.userData.zone = h.zone || null;
                m.raycast = THREE.Mesh.prototype.raycast;
                node.add(m);
                hitboxes.push(m);
            });

            console.log('[diamondAI] 판정구 ' + hitboxes.length + '개');
        }

        function toggleHitboxes() {
            showHitboxes = !showHitboxes;
            hitboxes.forEach(h => h.material =
                showHitboxes ? HITBOX_SHOWN : HITBOX_HIDDEN);

            // 상대의 몸도 같이 드러낸다. 평소에는 투명이라
            // 어디에 서 있는지 눈으로 볼 방법이 이것뿐이다.
            userBody.material = showHitboxes ? USER_SHOWN : USER_HIDDEN;
        }

        function pickBone(event) {
            if (!hitboxes.length) return null;

            const rect = canvas.getBoundingClientRect();
            pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            raycaster.setFromCamera(pointerNDC, camera);

            const hits = raycaster.intersectObjects(hitboxes, false);
            if (!hits.length) return null;

            // 벗긴 옷은 지나친다.
            //
            // 판정구는 옷 메시가 아니라 본에 붙어 있어서, 옷을 감춰도
            // 그 자리는 그대로 남는다. 그래서 옷을 벗기고 잡아도
            // '옷 잡지 마' 가 나왔다. 없는 옷을 잡을 수는 없다.
            //
            // 판정구를 지우지는 않는다 — 다시 입으면 도로 필요하다.
            // 맞은 것들 중에서 지나쳐 안쪽 몸으로 간다.
            let hit = null;
            for (let i = 0; i < hits.length; i++) {
                const z = hits[i].object.userData.zone;
                if (z && wearing[z] === false) continue;
                hit = hits[i];
                break;
            }

            if (!hit) return null;

            // 손이 닿는 거리 밖이면 못 만진다.
            // 방 건너편에서 쓰다듬을 수는 없다 — 만지려면 다가가야 한다.
            //
            // 화면을 누르는 것은 touch_reach 로 잰다(avatar.py). reach(1.55)
            // 로 재면 서 있는 자리에서 머리 위쪽만 눌리고 나머지는 죽어
            // 있었다 — 조이스틱을 감춘 뒤로는 폰에서 다가갈 길도 없다.
            if (user.on
                && userEye().distanceTo(hit.point)
                   > followCfg('touch_reach', followCfg('reach', 0.95))) return null;

            const node = hit.object.parent;
            const local = node.worldToLocal(hit.point.clone());

            return {
                bone: hit.object.userData.bone,
                zone: hit.object.userData.zone,
                local: [local.x, local.y, local.z]
            };
        }


        // ------------------------------------------------------------
        // 누르기와 쓰다듬기
        //
        // 누르고 조금이라도 끌면 쓰다듬기로 본다.
        // 끈 거리가 쌓일 때마다 한 번씩 반응하되, 너무 자주 말하지 않도록
        // 개체가 정한 간격을 지킨다.
        // ------------------------------------------------------------

        // ------------------------------------------------------------
        // 무엇으로 만질지 고르기
        //
        // 같은 자리를 만져도 손으로 만지는 것과 입을 맞추는 것은 다르다.
        // 도구 목록과 그 반응은 개체가 가지고 있고, 여기서는 고르기만 한다.
        // ------------------------------------------------------------

        const toolBadge = document.getElementById('tool-badge');
        const toolMenu = document.getElementById('tool-menu');

        let currentTool = null;
        let myAffinity = null;      // 잠긴 도구를 표시하는 데만 쓴다
        let myStageKey = null;      // 존댓말인지 반말인지 고르는 데 쓴다

        function tools() {
            return (ENTITY && ENTITY.touch && ENTITY.touch.tools) || [];
        }

        function toolLocked(t) {
            if (!t.allow_bonus) return false;
            if (myAffinity === null) return false;
            // 어느 자리든 이 도구로 만질 수 있는 곳이 하나라도 있는지
            const zones = (ENTITY.touch.zones || []);
            return !zones.some(z =>
                myAffinity >= ((z.allow_from || 0) + t.allow_bonus));
        }

        function setTool(key) {
            const list = tools();
            currentTool = list.find(t => t.key === key) || list[0] || null;
            if (currentTool) {
                toolBadge.textContent = currentTool.icon + ' ' + currentTool.label;
            }
            buildToolMenu();
        }

        function buildToolMenu() {
            const list = tools();
            if (!list.length) return;

            toolMenu.innerHTML = '';

            const head = document.createElement('div');
            head.className = 'head';
            head.textContent = '무엇으로 만질까';
            toolMenu.appendChild(head);

            list.forEach(t => {
                const locked = toolLocked(t);

                const row = document.createElement('div');
                row.className = 'item'
                    + (currentTool && t.key === currentTool.key ? ' on' : '')
                    + (locked ? ' locked' : '');

                const icon = document.createElement('span');
                icon.className = 'icon';
                icon.textContent = t.icon;
                row.appendChild(icon);

                const text = document.createElement('span');
                text.innerHTML = t.label +
                    (t.description ? '<span class="desc">' + t.description + '</span>' : '');
                row.appendChild(text);

                if (locked) {
                    const lock = document.createElement('span');
                    lock.className = 'lock';
                    lock.textContent = '아직';
                    row.appendChild(lock);
                }

                // 잠겨 있어도 고를 수는 있다. 만지면 거절당할 뿐이다.
                row.onclick = () => {
                    setTool(t.key);
                    hideToolMenu();
                };

                toolMenu.appendChild(row);
            });
        }

        function showToolMenu(x, y) {
            buildToolMenu();
            toolMenu.style.display = 'block';

            const box = toolMenu.getBoundingClientRect();
            const area = document.getElementById('avatar-container')
                .getBoundingClientRect();

            let left = x - area.left;
            let top = y - area.top;

            if (left + box.width > area.width) left = area.width - box.width - 8;
            if (top + box.height > area.height) top = area.height - box.height - 8;

            toolMenu.style.left = Math.max(6, left) + 'px';
            toolMenu.style.top = Math.max(6, top) + 'px';
        }

        function hideToolMenu() {
            toolMenu.style.display = 'none';
        }


        // ------------------------------------------------------------
        // 옷 벗기기
        //
        // 옷을 두 번 누르면 벗는다. 두 번 더 누르면 다시 입는다.
        // 그 옷을 만져도 되는 사이여야 한다 — 서버가 판단한다.
        //
        // 벗기면 그 자리에 몸이 드러난다. 표현용 몸을 깔아 두었기에
        // 가능한 일이다(model.layered). 안 깔았으면 구멍이 보인다.
        // ------------------------------------------------------------

        const wearing = {};      // 자리 -> 입고 있는가

        // 지금 벗겨 둔 자리들. 서버가 판정에 쓴다.
        function undressedZones() {
            return Object.keys(wearing).filter(k => wearing[k] === false);
        }

        async function undress(zoneKey) {
            const meshes = PARTS[zoneKey];
            if (!meshes || !meshes.length) return;

            const on = wearing[zoneKey] !== false;   // 기본은 입고 있음

            try {
                const d = await fetch('/api/undress', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ zone: zoneKey, wearing: on }),
                }).then(r => r.json());

                if (!d.ok) {
                    if (d.reply) showReply(d.reply, d.expression || 'angry', null);
                    return;
                }

                // 벗기거나 입힌다
                meshes.forEach(m => m.visible = !on);
                wearing[zoneKey] = !on;

                // 몸 가리개를 다시 셈한다.
                //
                // 이게 없으면 옷만 사라지고 그 밑에서 지워 둔 살은
                // 계속 숨어 있어, 몸에 구멍이 난 것처럼 보인다.
                applyBodyMask();

                if (d.reply) showReply(d.reply, d.expression || 'surprised', null);

                console.log('[diamondAI] ' + zoneKey
                    + (on ? ' 벗음' : ' 입음'));

            } catch (e) {
                console.warn('[diamondAI] 옷 벗기기 실패', e);
            }
        }

        canvas.addEventListener('dblclick', (e) => {
            const conf = (ENTITY && ENTITY.touch && ENTITY.touch.undress) || {};

            // 개체가 껐으면 안 벗긴다.
            //
            // 두 번 눌러 벗겨지는 것은 누르려다 잘못 눌리기 쉬워서
            // 껐다(2026-09-22). 되살리려면 avatar.py 쪽만 True 로 둔다.
            if (conf.enabled === false) return;

            const hit = pickBone(e);
            if (!hit || !hit.zone) return;

            const list = conf.zones || ['top', 'skirt', 'shoes'];

            if (list.indexOf(hit.zone) < 0) return;

            // 쥐고 있던 '한 번 누름' 을 없던 일로 한다.
            // 이게 없으면 벗기면서 만진 대답까지 같이 나온다.
            cancelHeldTap();

            e.preventDefault();
            undress(hit.zone);
        });

        canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showToolMenu(e.clientX, e.clientY);
        });

        toolBadge.addEventListener('click', (e) => {
            e.preventDefault();
            showToolMenu(e.clientX, e.clientY);
        });

        toolBadge.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showToolMenu(e.clientX, e.clientY);
        });

        document.addEventListener('pointerdown', (e) => {
            if (!toolMenu.contains(e.target) && e.target !== toolBadge) {
                hideToolMenu();
            }
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hideToolMenu();
        });


        const touchState = {
            down: false,
            petting: false,
            dragged: 0,
            sinceStroke: 0,
            strokes: 0,
            lastX: 0,
            lastY: 0,
            hit: null,
            lastFire: 0,
            busy: false
        };

        function touchCfg(key, fallback) {
            const t = (ENTITY && ENTITY.touch) || {};
            const v = t[key];
            return (typeof v === 'number') ? v : fallback;
        }

        // 입맞춤인지 아닌지는 서버가 정한다.
        // 여기서는 '눈을 감고 기다리는 중이었다' 만 알려준다 —
        // 어느 자리를 만졌는지 아는 쪽은 화면이 아니라 서버다.
        async function sendTouch(kind, hit, count) {
            const now = Date.now();
            if (touchState.busy) return;
            if (now - touchState.lastFire < touchCfg('cooldown_ms', 700)) return;

            touchState.lastFire = now;
            touchState.busy = true;

            try {
                const res = await fetch('/api/touch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        bone: hit.bone,
                        zone: hit.zone,
                        local: hit.local,
                        kind: kind,
                        count: count,
                        tool: currentTool ? currentTool.key : null,

                        // 눈을 감고 기다리는 중이었는가.
                        // 서버가 자리와 도구를 보고 입맞춤인지 마무리한다.
                        kiss_ready: kissWaiting,

                        // 무엇을 벗겨 두었는가. 옷을 입은 채로는
                        // 닿지 않는 자리가 있다.
                        undressed: undressedZones()
                    })
                });

                if (!res.ok) throw new Error('HTTP ' + res.status);

                const data = await res.json();
                if (data.hit) playTouchReaction(data);

            } catch (e) {
                console.warn('[diamondAI] 만지기 반응 실패:', e);
            } finally {
                touchState.busy = false;
            }
        }

        function playTouchReaction(data) {
            if (isSleeping) wakeUp();

            // 입을 맞췄으면 기다리기는 여기서 끝난다.
            // 그대로 두면 이 반응의 얼굴을 눈감기가 도로 덮는다.
            if (data.kind === 'kiss') kissWaiting = false;

            // 만졌으면 그쪽을 본다
            faceUser();

            // 기분이 움직였으면 눈금 이름표에 반영한다
            if (typeof data.mood === 'number') {
                myMood.level = data.mood;
                myMood.label = data.mood_label || null;
            }

            // 사이가 달라지면 눈금도 잠긴 도구도 달라진다
            if (typeof data.affinity === 'number') {
                myAffinity = data.affinity;
                myStageKey = data.stage || myStageKey;
                setAffinity(data.affinity, data.stage_label);
                buildToolMenu();
            }

            if (data.silent) {
                // 입을 닫았다. 만져도 말하지 않는다.
                showSilence(data.expression || 'angry');
                return;
            }

            if (data.reply) {
                showReply(data.reply, data.expression || 'neutral', null);
            } else {
                applyExpression(data.expression || 'neutral');
            }

            // 표정이 둘 이어지는 자리가 있다.
            //
            // 손을 잡히면 먼저 놀라고, 곧 좋아하는 얼굴이 된다.
            // 한 얼굴로는 그 흐름이 안 나온다. 놀람은 스치듯 짧게.
            if (data.expression_then) {
                const first = expressionByKey(data.expression || '');
                const ms = (first && first.hold_ms) ? first.hold_ms : 900;

                setTimeout(() => {
                    applyExpression(data.expression_then);
                }, Math.min(ms, 1000));
            }

            // 몸짓은 돌아다니기보다 우선한다
            if (data.motion) {
                roam.state = 'gesture';
                playMotion(data.motion);
            }
        }

        // 빈 곳을 끄는 중인가. 1인칭에서는 이게 고개 돌리기다.
        const look = { on: false, x: 0, y: 0 };

        canvas.addEventListener('pointerdown', (e) => {
            const hit = pickBone(e);

            // 아바타를 눌렀으면 만지는 것이고, 빈 곳이면 시점을 돌리는 것이다.
            // 둘 다 왼쪽 끌기라 여기서 갈라 줘야 서로 방해하지 않는다.
            // 궤도 시점은 안 쓴다 — 대신 고개를 돌린다.
            controls.enabled = false;

            if (!hit) {
                look.on = true;
                look.x = e.clientX;
                look.y = e.clientY;
                canvas.setPointerCapture(e.pointerId);
                return;
            }

            e.preventDefault();
            canvas.setPointerCapture(e.pointerId);

            touchState.down = true;
            touchState.petting = false;
            touchState.dragged = 0;
            touchState.sinceStroke = 0;
            touchState.strokes = 0;
            touchState.lastX = e.clientX;
            touchState.lastY = e.clientY;
            // 옷이 끌려갈 방향을 알려면 어디서 시작했는지가 있어야 한다
            touchState.fromX = e.clientX;
            touchState.fromY = e.clientY;
            touchState.pullX = 0;
            touchState.pullY = 0;
            touchState.hit = hit;
        });

        canvas.addEventListener('pointermove', (e) => {

            // 빈 곳을 끌면 고개가 돈다. 마우스를 오른쪽으로 밀면
            // 시선도 오른쪽으로 가야 하므로 yaw 는 빼는 쪽이다.
            if (look.on) {
                user.yaw -= (e.clientX - look.x) * LOOK_SENS;
                user.pitch = Math.max(-1.05, Math.min(1.05,
                    user.pitch - (e.clientY - look.y) * LOOK_SENS));
                look.x = e.clientX;
                look.y = e.clientY;
                return;
            }

            if (!touchState.down) {
                // 누르지 않았을 때는 만질 수 있는 곳인지 알려만 준다
                canvas.style.cursor = pickBone(e) ? 'grab' : 'default';
                return;
            }

            const dx = e.clientX - touchState.lastX;
            const dy = e.clientY - touchState.lastY;
            const step = Math.hypot(dx, dy);

            touchState.lastX = e.clientX;
            touchState.lastY = e.clientY;
            touchState.dragged += step;
            touchState.sinceStroke += step;

            // 잡은 자리에서 지금까지 끌어온 방향. 옷은 이쪽으로 끌린다.
            touchState.pullX = e.clientX - touchState.fromX;
            touchState.pullY = e.clientY - touchState.fromY;

            // 끄는 동안 다른 자리로 넘어가면 그 자리로 바꾼다
            const here = pickBone(e);
            if (here) touchState.hit = here;

            if (touchState.dragged >= touchCfg('pet_drag_px', 26)) {
                touchState.petting = true;
                canvas.style.cursor = 'grabbing';
            }

            if (touchState.petting &&
                touchState.sinceStroke >= touchCfg('pet_stroke_px', 90)) {

                touchState.sinceStroke = 0;
                touchState.strokes += 1;

                if (touchState.hit) {
                    sendTouch('pet', touchState.hit, touchState.strokes);
                }
            }
        });

        // 옷은 두 번 눌러야 벗는다. 그런데 한 번 누른 것도 만진 것이라
        // 대답이 나가서, 벗기려다 두 번 다 대답을 듣게 된다.
        //
        // 그래서 옷자리를 한 번 누른 것은 곧바로 보내지 않고 잠깐 쥐고
        // 있는다. 그 사이에 두 번째 누름(dblclick)이 오면 없던 일이 된다.
        // 창이 두 번 누름으로 치는 간격보다 넉넉해야 한다.
        const UNDRESS_HOLD_MS = 400;

        let tapHoldTimer = null;

        function isUndressZone(zoneKey) {
            if (!zoneKey) return false;
            const u = (ENTITY && ENTITY.touch && ENTITY.touch.undress) || {};
            if (u.enabled === false) return false;
            return (u.zones || ['top', 'skirt', 'shoes']).indexOf(zoneKey) >= 0;
        }

        function cancelHeldTap() {
            if (tapHoldTimer) {
                clearTimeout(tapHoldTimer);
                tapHoldTimer = null;
            }
        }

        function endTouch(e) {
            look.on = false;

            // 궤도 시점은 계속 꺼 둔다.
            controls.enabled = false;

            if (!touchState.down) return;

            touchState.down = false;
            canvas.style.cursor = pickBone(e) ? 'grab' : 'default';

            // 끌지 않았으면 그냥 한 번 누른 것이다
            if (!touchState.petting && touchState.hit) {
                const hit = touchState.hit;

                // 옷이면 두 번째 누름이 오는지 잠깐 기다렸다 보낸다
                cancelHeldTap();

                if (isUndressZone(hit.zone)) {
                    tapHoldTimer = setTimeout(() => {
                        tapHoldTimer = null;
                        sendTouch('tap', hit, 1);
                    }, UNDRESS_HOLD_MS);
                } else {
                    sendTouch('tap', hit, 1);
                }
            }

            // 쓰다듬다 말았는데 아직 한 번도 반응하지 않았다면 한 번은 해준다
            if (touchState.petting && touchState.strokes === 0 && touchState.hit) {
                sendTouch('pet', touchState.hit, 1);
            }

            touchState.petting = false;
        }

        canvas.addEventListener('pointerup', endTouch);
        canvas.addEventListener('pointercancel', endTouch);
        canvas.addEventListener('pointerleave', (e) => {
            if (!touchState.down) canvas.style.cursor = 'default';
        });

        // ------------------------------------------------------------
        // 상대를 움직이는 키
        //
        // keydown 은 누른 순간 한 번이지만 걷기는 누르고 있는 내내여야
        // 한다. 그래서 눌린 키를 `held` 에 적어 두고 그리기 고리가 읽는다.
        // ------------------------------------------------------------

        // 글을 쓰고 있는 중인가.
        //
        // 대화칸만 빼고 있었더니 상황칸에 글을 쓸 때 스페이스바로 뛰고
        // Shift 로 앉았다. 칸이 늘어날 때마다 여기에 하나씩 적는 대신,
        // 지금 초점이 어디에 있는지로 판단한다.
        function isTyping() {
            const el = document.activeElement;
            if (!el) return false;
            const tag = (el.tagName || '').toLowerCase();
            return tag === 'input' || tag === 'textarea' || el.isContentEditable;
        }


        window.addEventListener('keydown', (e) => {
            if (isTyping()) return;
            if (!e.key) return;

            if (e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
                e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                held[e.key] = true;
                e.preventDefault();      // 창이 같이 스크롤되면 안 된다
                return;
            }

            if (e.key === 'Shift') {
                held.Shift = true;       // 누르는 동안 앉는다
                return;
            }

            if (e.key === ' ') {
                e.preventDefault();
                // 발이 땅에 닿아 있을 때만 뛴다. 공중에서 또 누르면 안 된다.
                if (user.on && user.lift === 0 && user.vy === 0) {
                    user.vy = USER_JUMP;
                }
                return;
            }
        });

        window.addEventListener('keyup', (e) => {
            if (!e.key) return;
            // 뗀 것은 글을 쓰는 중이라도 풀어 준다.
            // 누르고 있다가 칸을 눌러 초점을 옮기면 키가 눌린 채로 남는다.
            if (e.key === 'Shift') { held.Shift = false; return; }
            if (e.key.indexOf('Arrow') === 0) held[e.key] = false;
        });

        // 창에서 눈을 떼면 누르고 있던 키가 눌린 채로 남아 혼자 걸어간다
        window.addEventListener('blur', () => {
            for (const k in held) held[k] = false;
        });


        // 판정구를 눈으로 확인하고 싶을 때
        window.addEventListener('keydown', (e) => {
            if (isTyping()) return;

            if (e.key === 'h' || e.key === 'H') {
                toggleHitboxes();
            }

            // 시점을 원래대로
            if (e.key === 'r' || e.key === 'R') {
                resetCamera();
            }

        });


