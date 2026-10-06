// dia/wear.js — 몸과 옷 — 겹쳐 쓰기·옷장·옷 나누기·자르기
// (다이아의 몸. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 두 벌을 겹쳐 쓴다
        //
        // 옷 입은 모델(avatar.vrm)은 옷 아래 몸이 지워져 있다.
        // 몸이 7949 삼각형인데 벗은 모델(표현용.vrm)은 10022 다.
        // 그래서 옷을 당기면 그 아래가 비어 구멍이 보인다.
        //
        // 몸은 표현용에서, 옷·머리카락·기본 얼굴은 avatar 에서 가져와 겹친다.
        // 뼈대가 같으므로(휴머노이드 54개) 같은 자세를 둘 다에 그대로 준다.
        //
        // 얼굴은 두 벌 다 있다. 평소에는 기본 얼굴을 보여주고,
        // 절정 표정을 지을 때만 표현용 얼굴로 바꿔 낀다 —
        // 같은 이름의 모프인데 표현용 쪽이 더 과장돼 있기 때문이다.
        // ============================================================

        let bodyVRM = null;             // 표현용
        let baseFaces = [];             // avatar 의 얼굴 메시들
        let specialFaces = [];          // 표현용의 얼굴 메시들
        let showingSpecial = false;

        function isFaceMesh(o) {
            let p = o;
            while (p) {
                if (p.name === 'Face') return true;
                p = p.parent;
            }
            return false;
        }


        // 두 모델의 키를 맞춘다.
        //
        // 표현용은 신발을 지우면서 골격이 통째로 2.27cm 내려갔다. 비율은
        // 같은데 전체가 낮다. 그대로 겹치면 옷과 머리카락은 제자리인데
        // 몸만 가라앉아, 얼굴이 목 위로 떠 보인다.
        //
        // 숫자를 적어 두지 않는다. 파일을 다시 내보내면 또 달라지므로,
        // 두 모델의 엉덩이 본이 실제로 어디 있는지 재서 그 차이만큼 옮긴다.
        //
        // 걸어 다니면 옷 쪽이 움직이므로, 그 차이를 기억해 두고
        // 매 프레임 몸을 그만큼 떨어뜨려 따라붙인다.
        const bodyLift = new THREE.Vector3();

        function alignBody() {
            if (!currentVRM || !bodyVRM) return;

            const a = currentVRM.humanoid && currentVRM.humanoid.getBoneNode('hips');
            const b = bodyVRM.humanoid && bodyVRM.humanoid.getBoneNode('hips');
            if (!a || !b) return;

            currentVRM.scene.updateWorldMatrix(true, true);
            bodyVRM.scene.updateWorldMatrix(true, true);

            const pa = new THREE.Vector3().setFromMatrixPosition(a.matrixWorld);
            const pb = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);

            // 지금 몸이 어디 있는지에서 출발해 차이를 더한다
            bodyLift.copy(bodyVRM.scene.position).add(pa.sub(pb))
                .sub(currentVRM.scene.position);

            followBody();

            console.log('[diamondAI] 몸 높이 보정 '
                + (bodyLift.y * 100).toFixed(2) + 'cm');
        }

        // 옷이 걸어가면 몸도 같이 간다
        function followBody() {
            if (!currentVRM || !bodyVRM) return;
            bodyVRM.scene.position.copy(currentVRM.scene.position).add(bodyLift);
        }


        // ============================================================
        // 옷장
        //
        // 옷은 통짜 아바타가 아니라 **옷만 든 작은 VRM** 이다.
        // (_extract_garment.py 가 VRoid 에서 내보낸 VRM 에서 떼어 굽는다.
        //  교복 한 벌이 1.4MB — 통짜로 두면 16MB 다)
        //
        // 입히는 법은 세 가지가 맞물린다.
        //   1. 뼈를 이름으로 맞물린다. 옷 VRM 은 제 뼈대를 통째로 갖고 있고,
        //      매 프레임 몸의 뼈에서 자리를 베껴 온다. 그래서 어떤 동작을
        //      하든 옷이 따라온다.
        //   2. 옷이 데려온 흔들림 본(치마 40개)은 옷 VRM 이 스스로 돌린다.
        //   3. 옷에 가린 몸 삼각형을 감춘다. VRoid 가 하는 일을 흉내 내는
        //      것으로, 안 하면 옷 속으로 살이 비친다.
        // ============================================================

        // 칸마다 하나씩 걸친다 — 옷 · 안경 · 머리.
        // 칸이 다르면 같이 걸치므로 하나짜리 변수로는 안 된다.
        const WEAR = {};            // 칸 -> {vrm, pairs, key, item}
        let wardrobe = [];          // 옷장 목록
        let bodyFullIndex = null;   // 감추기 전의 몸 삼각형 (벗을 때 되돌린다)
        let bodyMaskMesh = null;

        function wornKeyOf(slot) {
            return (WEAR[slot] && WEAR[slot].key) || null;
        }

        function anyWorn() {
            return Object.keys(WEAR).filter(k => WEAR[k]);
        }

        async function loadWardrobe() {
            let want = null;

            try {
                const res = await fetch('/api/wardrobe');
                const d = await res.json();
                wardrobe = d.items || [];
                want = d.worn || {};
                window.__slotOrder = d.slots || null;
                console.log('[diamondAI] 옷장 ' + wardrobe.length + '벌 · 걸친 것 '
                    + (JSON.stringify(want) || '없음'));
            } catch (e) {
                wardrobe = [];
                console.warn('[diamondAI] 옷장을 못 불러왔다:', e);
            }

            buildWearMenu();

            // 걸치고 있던 것들을 도로 입는다.
            //
            // 서버가 '처음 온 사람' 에게는 기본 옷 이름을 준다.
            // 창을 열었는데 벗고 있으면 안 된다.
            for (const slot of Object.keys(want || {})) {
                if (want[slot]) await wearOutfit(want[slot], true);
            }
        }

        function wearItem(key) {
            return wardrobe.find(x => x.key === key) || null;
        }

        function rememberWearing(slot, key) {
            // 무엇을 걸쳤는지 적어 둔다. 실패해도 화면은 그대로 간다.
            fetch('/api/wardrobe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slot: slot, key: key || '' }),
            }).catch(() => {});
        }

        function slotOf(item) {
            return (item && item.slot) || 'outfit';
        }

        function wearOutfit(key, restoring) {
            const item = wearItem(key);
            if (!item) return Promise.resolve(null);

            const slot = slotOf(item);
            if (wornKeyOf(slot) === key) return Promise.resolve(WEAR[slot].vrm);

            // 같은 칸의 것만 벗는다. 안경을 쓰려고 옷을 벗지 않는다.
            takeOffSlot(slot, true);

            return new Promise(resolve => {
                new THREE.GLTFLoader().load(
                    (ENTITY.model.wardrobe || '/static/wardrobe/') + item.file,
                    (gltf) => {
                        THREE.VRM.from(gltf).then(vrm => {
                            WEAR[slot] = { vrm: vrm, pairs: [], key: key, item: item };
                            vrm.scene.rotation.y = Math.PI;
                            scene.add(vrm.scene);

                            bindWearBones(slot);
                            applyBodyMask();

                            // 굴곡이 보이게 명암을 맞춘다(몸과 같은 손질)
                            tuneShading(vrm.scene);

                            // 걸친 것이 늘었으니 다시 나눈다.
                            // 이래야 벗기기가 이것에도 걸린다.
                            splitParts();

                            syncWear();
                            buildWearMenu();

                            // 창을 열며 도로 입는 것은 적지 않는다.
                            // 방금 읽어 온 값을 그대로 되쓰는 꼴이다.
                            if (!restoring) rememberWearing(slot, key);

                            console.log('[diamondAI] ' + slot + ' 칸에 ' + key);
                            resolve(vrm);
                        });
                    },
                    undefined,
                    (e) => {
                        console.warn('[diamondAI] 못 불러왔다:', key, e);
                        resolve(null);
                    }
                );
            });
        }

        function applyWear(w) {
            // 서버가 '무엇을 걸쳤다' 고 알려 온 것을 화면에 옮긴다.
            //
            // 이미 저장까지 끝난 뒤라 여기서 다시 적지 않는다
            // (restoring=true). 적으면 방금 받은 값을 되쓰는 꼴이다.
            if (!w) return;

            const changed = w.changed || {};

            Object.keys(changed).forEach(slot => {
                const key = changed[slot];
                if (key) wearOutfit(key, true);
                else takeOffSlot(slot, false, true);
            });
        }

        function takeOffSlot(slot, swapping, restoring) {
            const cur = WEAR[slot];
            if (!cur) {
                if (!swapping && !restoring) rememberWearing(slot, '');
                return;
            }

            scene.remove(cur.vrm.scene);
            cur.vrm.scene.traverse(o => {
                if (o.isMesh || o.isSkinnedMesh) {
                    if (o.geometry) o.geometry.dispose();
                    const ms = Array.isArray(o.material) ? o.material : [o.material];
                    ms.forEach(m => m && m.dispose && m.dispose());
                }
            });

            delete WEAR[slot];

            applyBodyMask();
            splitParts();
            buildWearMenu();

            // 갈아입는 중이면 적지 않는다. 곧 새 이름이 적힌다.
            if (!swapping && !restoring) rememberWearing(slot, '');
        }

        function takeOffAll() {
            Object.keys(WEAR).forEach(slot => takeOffSlot(slot));
        }

        function bindWearBones(slot) {
            const cur = WEAR[slot];
            if (!cur || !currentVRM) return;

            cur.pairs = [];

            const src = new Map();
            currentVRM.scene.traverse(o => {
                if (o.isBone || o.type === 'Bone') src.set(o.name, o);
            });

            let extra = 0;
            cur.vrm.scene.traverse(o => {
                if (!(o.isBone || o.type === 'Bone')) return;
                const a = src.get(o.name);
                if (a) cur.pairs.push([a, o]);
                else extra++;
            });

            console.log('[diamondAI] ' + slot + ' 본 맞물림 ' + cur.pairs.length
                + '개 · 제 본 ' + extra + '개');
        }

        function syncWear() {
            if (!currentVRM) return;

            Object.keys(WEAR).forEach(slot => {
                const cur = WEAR[slot];
                if (!cur) return;

                // 걸친 것이 몸을 따라 걸어간다
                cur.vrm.scene.position.copy(currentVRM.scene.position);
                cur.vrm.scene.quaternion.copy(currentVRM.scene.quaternion);

                // 자리를 통째로 베낀다.
                //
                // 회전만 베끼면 안 된다. 동작 중에는 뼈의 위치도 움직이고
                // (걷기·점프), 그때 옷만 제자리에 남는다.
                const pairs = cur.pairs;
                for (let i = 0; i < pairs.length; i++) {
                    const a = pairs[i][0], b = pairs[i][1];
                    b.position.copy(a.position);
                    b.quaternion.copy(a.quaternion);
                    b.scale.copy(a.scale);
                }
            });
        }

        function updateWear(dt) {
            Object.keys(WEAR).forEach(slot => {
                const cur = WEAR[slot];
                if (cur) cur.vrm.update(dt);   // 치마 흔들림 본
            });
        }

        function applyBodyMask() {
            // 걸친 것들이 가리는 몸 삼각형을 **합쳐서** 감춘다.
            //
            // 한 벌씩 따로 감추면 두 번째 것을 벗을 때 첫 번째가 감춘
            // 것까지 되살아난다. 늘 원본에서 다시 계산한다.
            if (!currentVRM) return;

            // 지금 벗겨 둔 자리. 그 자리의 가리개는 걷는다 —
            // 안 걷으면 옷만 사라지고 그 밑 살은 숨은 채로 남아
            // **몸에 구멍이 난 것처럼 보인다**(2026-09-22 에 겪음).
            let off = [];

            try {
                off = undressedZones();
            } catch (e) {
                off = [];      // 아직 벗기기 표가 없을 때(처음 불릴 때)
            }

            const masks = [];

            Object.keys(WEAR).forEach(slot => {
                const it = WEAR[slot] && WEAR[slot].item;
                const h = it && it.hide;

                if (!h) return;

                // 부위별 가리개가 있으면 **입고 있는 자리만** 가린다.
                // 윗옷을 벗겨도 치마 밑 살은 그대로 숨어 있어야 한다.
                if (h.zones) {
                    Object.keys(h.zones).forEach(z => {
                        if (off.indexOf(z) >= 0) return;

                        const zm = h.zones[z];

                        if (zm && zm.mask) {
                            masks.push({ mask: zm.mask, triangles: h.triangles });
                        }
                    });

                    return;
                }

                // 옛 판(통짜 가리개). 한 군데라도 벗겼으면 통째로 걷는다 —
                // 부위별로 걷을 방법이 없다. 살짝 비치는 것이 구멍보다 낫다.
                if (h.mask && !off.length) masks.push(h);
            });

            // 가릴 몸 메시를 찾는다.
            //
            // ★ 재질 이름으로 찾으면 안 된다. three-vrm 이 MToon 으로 바꿔
            //   끼우면서 material.name 이 빈 문자열이 된다(파일 안에는
            //   멀쩡히 들어 있어서 더 헷갈린다). 삼각형 수로 찾는다.
            const want = masks.length ? masks[0].triangles : null;

            if (!bodyMaskMesh) {
                currentVRM.scene.traverse(o => {
                    if (!(o.isMesh || o.isSkinnedMesh) || !o.geometry.index) return;
                    if (o.userData && o.userData.bone) return;
                    const tri = o.geometry.index.count / 3;
                    if (want !== null && tri === want) bodyMaskMesh = o;
                });
            }

            if (!bodyMaskMesh) {
                if (masks.length) {
                    console.warn('[diamondAI] 가릴 몸 메시를 못 찾았다 (삼각형 '
                        + want + '개짜리)');
                }
                return;
            }

            if (!bodyFullIndex) {
                bodyFullIndex = bodyMaskMesh.geometry.index.array;
            }

            const idx = bodyFullIndex;
            const tris = idx.length / 3;

            if (!masks.length) {
                bodyMaskMesh.geometry.setIndex(
                    new THREE.BufferAttribute(idx, 1));
                return;
            }

            // 비트를 합친다
            const bits = masks.map(h => {
                const bin = atob(h.mask);
                const by = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) by[i] = bin.charCodeAt(i);
                return by;
            });

            const keep = [];
            let hid = 0;

            for (let t = 0; t < tris; t++) {
                let off = false;
                for (let m = 0; m < bits.length; m++) {
                    if ((bits[m][t >> 3] >> (7 - (t & 7))) & 1) { off = true; break; }
                }
                if (off) { hid++; continue; }
                keep.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
            }

            bodyMaskMesh.geometry.setIndex(
                new THREE.BufferAttribute(new idx.constructor(keep), 1));

            console.log('[diamondAI] 옷에 가린 몸 삼각형 ' + hid + '개를 감췄다');
        }

        function loadBody(url) {
            return new Promise(resolve => {
                new THREE.GLTFLoader().load(url, (gltf) => {
                    if (THREE.VRMUtils) {
                        THREE.VRMUtils.removeUnnecessaryJoints(gltf.scene);
                    }
                    THREE.VRM.from(gltf).then(vrm => {
                        bodyVRM = vrm;
                        vrm.scene.rotation.y = Math.PI;
                        scene.add(vrm.scene);

                        // 표현용에서 쓰는 것은 몸뿐이다.
                        // 얼굴은 절정 표정을 지을 때만 꺼내 쓰고,
                        // 신발·머리카락은 avatar 쪽 것을 쓰므로 여기서는 감춘다.
                        // (새 캐릭터.vrm 은 맨몸인데도 머리카락이 들어 있다.
                        //  같은 머리가 두 겹이면 서로 비쳐 깜빡인다.)
                        specialFaces = [];
                        vrm.scene.traverse(o => {
                            if (!o.isMesh && !o.isSkinnedMesh) return;
                            const part = partByTriangles(o);
                            if (isFaceMesh(o)) {
                                o.visible = false;
                                specialFaces.push(o);
                            } else if (part === 'shoes' || part === 'hair') {
                                o.visible = false;
                            }
                        });

                        console.log('[diamondAI] 표현용 불러옴 · 얼굴 메시 '
                            + specialFaces.length + '개');
                        resolve(vrm);
                    });
                }, undefined, (e) => {
                    console.warn('[diamondAI] 표현용을 못 불러왔다:', e);
                    resolve(null);
                });
            });
        }

        function hideDressedBody() {
            // 몸은 표현용 것을 쓴다. 옷 입은 모델의 몸은 감춘다.
            if (!currentVRM) return;

            // 다만 대신 깔 몸이 있을 때만이다.
            // 표현용을 안 불러온 채로 감추면 옷만 떠 있게 된다.
            const swap = !!bodyVRM;

            baseFaces = [];
            currentVRM.scene.traverse(o => {
                if (!o.isMesh && !o.isSkinnedMesh) return;
                if (o.userData && o.userData.bone) return;
                if (isFaceMesh(o)) { baseFaces.push(o); return; }
                if (swap && partByTriangles(o) === 'body') o.visible = false;
            });
            console.log('[diamondAI] 기본 얼굴 메시 ' + baseFaces.length + '개');
        }

        function useSpecialFace(on) {
            if (!specialFaces.length) return;
            if (showingSpecial === on) return;
            showingSpecial = on;
            baseFaces.forEach(m => m.visible = !on);
            specialFaces.forEach(m => m.visible = on);
        }


        // ============================================================
        // 몸과 옷 나누기
        //
        // VRM 안에서 옷은 이미 따로 그려진다. Body 메시가 프리미티브
        // 6개(몸·윗옷·신발·뒷머리·원피스)로 나뉘어 있고,
        // three.js 는 프리미티브 하나를 Mesh 하나로 만들기 때문이다.
        //
        // 그러니 새로 자를 것은 없고, 어느 것이 무엇인지 이름표만 붙이면 된다.
        // 재질 이름이 그 표식이다.
        // ============================================================

        const PARTS = { body: [], top: [], skirt: [], shoes: [], socks: [],
                        hair: [], glasses: [], accessory: [] };

        function meshTriangles(mesh) {
            if (!mesh.geometry) return -1;
            const idx = mesh.geometry.index;
            return idx ? idx.count / 3
                       : mesh.geometry.attributes.position.count / 3;
        }

        function meshLabel(mesh) {
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            return (mats[0] && mats[0].name) || mesh.name || '';
        }

        // 재질 이름을 먼저 본다.
        //
        // 예전에는 삼각형 수만 봤다. 그러다 표현용.vrm 을 다시 내보내면서
        // 몸이 10022 에서 10934 삼각형이 되자 표에서 사라졌고, 화면에서
        // 몸이 통째로 없어졌다. 재질 이름은 다시 내보내도 그대로다.
        // 삼각형 수는 이름을 잃었을 때의 대비로만 남긴다.
        function partByTriangles(mesh) {
            const table = (ENTITY && ENTITY.model_parts) || [];
            if (!table.length) return null;

            const label = meshLabel(mesh).toLowerCase();
            for (const r of table) {
                if (r.match && label.includes(r.match)) return r.zone;
            }

            const tris = meshTriangles(mesh);
            const hit = table.find(p => p.triangles === tris);
            return hit ? hit.zone : null;
        }

        // 이름으로도 한 번 더 본다. 표에 없는 메시를 위한 대비다.
        function partOf(materialName) {
            const n = String(materialName || '').toUpperCase();
            if (n.includes('HAIR')) return 'hair';
            if (n.includes('ONEPIECE')) return 'skirt';
            if (n.includes('TOPS')) return 'top';
            if (n.includes('SHOES')) return 'shoes';
            return 'body';          // SKIN, FACE, EYE ...
        }


        // ============================================================
        // 한 덩어리인 옷 자르기
        //
        // 신발과 양말은 한 벌로 붙어 있다. 다리 하나가 삼각형 409개짜리
        // 조각 하나로 발바닥에서 정강이까지 이어져 있어, 조각을 세어
        // 나눌 수 없다. 그래서 개체가 정해 준 높이에서 삼각형을 갈라
        // 위쪽만 새 메시로 떼어낸다.
        //
        // 정점은 그대로 두고 색인만 나눈다. 같은 뼈대에 다시 묶으므로
        // 움직임도 그대로다.
        // ============================================================

        function cutAbove(mesh, cutY) {
            const geo = mesh.geometry;
            if (!geo || !geo.index) return null;

            const pos = geo.attributes.position;
            const idx = geo.index.array;
            const low = [], high = [];

            for (let i = 0; i < idx.length; i += 3) {
                const y = (pos.getY(idx[i]) + pos.getY(idx[i + 1])
                         + pos.getY(idx[i + 2])) / 3;
                const bin = (y >= cutY) ? high : low;
                bin.push(idx[i], idx[i + 1], idx[i + 2]);
            }

            if (!high.length || !low.length) return null;

            const upGeo = geo.clone();
            upGeo.setIndex(high);
            upGeo.computeBoundingSphere();
            upGeo.computeBoundingBox();

            const up = new THREE.SkinnedMesh(upGeo, mesh.material);
            up.name = mesh.name + '_잘린위';
            if (mesh.skeleton) up.bind(mesh.skeleton, mesh.bindMatrix);
            up.bindMode = mesh.bindMode;
            up.frustumCulled = mesh.frustumCulled;
            mesh.parent.add(up);

            geo.setIndex(low);
            geo.computeBoundingSphere();
            geo.computeBoundingBox();

            return up;
        }

        function applySplits(parts) {
            const rules = (ENTITY && ENTITY.model_splits) || [];

            rules.forEach(r => {
                const src = parts[r.from];
                if (!src || !src.length) return;

                parts[r.zone] = parts[r.zone] || [];

                src.slice().forEach(m => {
                    const up = cutAbove(m, r.above);
                    if (!up) return;
                    up.userData.part = r.zone;
                    parts[r.zone].push(up);
                });

                console.log('[diamondAI] ' + r.from + ' 에서 ' + r.label
                    + ' ' + parts[r.zone].length + '개를 갈라냈다 ('
                    + (r.above * 100).toFixed(0) + 'cm 위)');
            });
        }

        // ------------------------------------------------------------
        // 명암
        //
        // MToon 은 빛을 몇 칸으로 뭉쳐서 칠한다(toon). 그래서 배나
        // 가슴골처럼 완만한 굴곡은 한 칸 안에 들어가 아예 안 보인다.
        //
        // 칸 사이를 부드럽게 풀고(shadeToony), 그늘이 시작되는 자리를
        // 조금 올리고(shadeShift), 윤곽을 따라 도는 빛을 살짝 준다
        // (rim). 셋 다 얼굴 인상을 바꾸므로 조금씩만 건드린다.
        //
        // 숫자는 개체가 갖는다 — 눈으로 보고 맞추는 값이라서.
        // ------------------------------------------------------------

        function tuneShading(root) {
            const s = (ENTITY && ENTITY.model && ENTITY.model.shading) || null;
            if (!s || !root) return;

            let count = 0;

            root.traverse(o => {
                if (!o.isMesh && !o.isSkinnedMesh) return;
                if (o.userData && o.userData.bone) return;

                const mats = Array.isArray(o.material) ? o.material : [o.material];

                mats.forEach(mt => {
                    if (!mt || mt.shadeToony === undefined) return;   // MToon 만

                    if (s.shade_toony !== undefined) mt.shadeToony = s.shade_toony;
                    if (s.shade_shift !== undefined) mt.shadeShift = s.shade_shift;
                    if (s.rim_mix !== undefined) mt.rimLightingMix = s.rim_mix;
                    if (s.rim_power !== undefined) mt.rimFresnelPower = s.rim_power;
                    if (s.rim_lift !== undefined) mt.rimLift = s.rim_lift;

                    mt.needsUpdate = true;
                    count++;
                });
            });

            console.log('[diamondAI] 명암을 손본 재질 ' + count + '개');
        }


        // ------------------------------------------------------------
        // 바탕 신발과 옷의 신발이 겹치던 것 (2026-10-06)
        //
        // 바탕 아바타(avatar.vrm)는 낮은 검은 운동화(N00_004 Shoes)를 신고
        // 있고, 교복(w_16512ae814.vrm)은 제 하이탑(N00_006 Shoes)을 들고
        // 온다. 둘 다 보이게 두었더니 같은 자리에서 두 신발이 서로 뚫고
        // 나와, 하이탑 앞코에 운동화의 흰 줄이 깨진 조각처럼 박혔다
        // ("다이아 신발이 이상해").
        //
        // 옷이 그 자리(신발)를 들고 왔으면 바탕 것은 감춘다. 옷을 벗으면
        // 다시 보인다. 감춘 동안은 PARTS 에도 안 넣는다 — 두 번 눌러
        // 벗기기가 감춘 신발을 도로 켜면 안 된다.
        //
        // 머리·안경은 넣지 않는다. 바탕 머리 위에 얹는 것일 수 있다.
        // ------------------------------------------------------------
        const WEAR_REPLACES = ['shoes'];

        function wornReplaceZones() {
            const zones = {};
            Object.keys(WEAR).forEach(k => {
                const it = WEAR[k] && WEAR[k].item;
                ((it && it.parts) || []).forEach(p => {
                    if (p && WEAR_REPLACES.indexOf(p.zone) >= 0) zones[p.zone] = true;
                });
            });
            return zones;
        }

        // 감췄으면 true. 덮던 옷을 벗었으면 도로 보이게 한다.
        function hideUnderWear(o, part, covered) {
            if (covered[part]) {
                o.visible = false;
                o.userData.underWear = true;
                return true;
            }
            if (o.userData.underWear) {
                o.visible = true;
                o.userData.underWear = false;
            }
            return false;
        }

        function splitParts() {
            Object.keys(PARTS).forEach(k => PARTS[k] = []);

            if (!currentVRM) return;

            // 옷장에서 입은 옷도 같이 센다.
            // 안 그러면 갈아입은 옷은 벗기지도 잡아당기지도 못한다.
            const roots = [currentVRM.scene];
            Object.keys(WEAR).forEach(k => {
                if (WEAR[k]) roots.push(WEAR[k].vrm.scene);
            });

            const covered = wornReplaceZones();

            roots.forEach(root => root.traverse(o => {
                if (!o.isMesh && !o.isSkinnedMesh) return;
                if (o.userData && o.userData.bone) return;   // 판정구는 뺀다

                const mats = Array.isArray(o.material) ? o.material : [o.material];
                const label = (mats[0] && mats[0].name) || o.name || '';

                // 삼각형 수가 먼저다. 이름은 표에 없을 때만 쓴다.
                const part = partByTriangles(o) || partOf(label);

                const idx = o.geometry && o.geometry.index;
                console.log('[diamondAI] 메시 "' + label + '" 삼각형 '
                    + (idx ? idx.count / 3 : '?') + ' -> ' + part);

                o.userData.part = part;

                // 걸친 옷이 같은 자리를 새로 들고 왔으면 바탕 것은 감춘다.
                if (root === currentVRM.scene && hideUnderWear(o, part, covered)) return;

                PARTS[part].push(o);
            }));

            // 신발에서 양말을 갈라낸다. 따로 벗을 수 있어야 한다.
            applySplits(PARTS);

            const summary = Object.keys(PARTS)
                .map(k => k + ' ' + PARTS[k].length).join(', ');

            console.log('[diamondAI] 몸/옷 나눔: ' + summary);

            // 옷을 안 입고 있으면 옷 메시가 없는 것이 맞다.
            //
            // 바탕 아바타가 맨몸이 된 뒤로는(2026-09-16) 벗은 상태가
            // 정상이다. 그때도 경고를 띄우면 진짜 고장과 구별이 안 된다.
            if (!PARTS.skirt.length && !PARTS.top.length
                    && (wornKeyOf('outfit') || !wardrobe.length)) {
                console.warn('[diamondAI] 옷 메시를 못 찾았다. 재질 이름을 확인하라:');
                currentVRM.scene.traverse(o => {
                    if (!o.isMesh && !o.isSkinnedMesh) return;
                    if (o.userData && o.userData.bone) return;
                    const m = Array.isArray(o.material) ? o.material[0] : o.material;
                    console.warn('   물체 "' + o.name + '"  재질 "'
                        + (m && m.name) + '"');
                });
            }
        }


