// dia/entity.js — 다이아 개체 받아 오기(/api/avatar)
// (다이아의 몸. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 아바타 개체
        //
        // 표정 수치와 동작을 이 파일이 들고 있지 않는다.
        // 서버의 /api/avatar 가 내려준 정의를 그대로 쓴다.
        // (테스트 화면 /test 와 완전히 같은 정의를 공유한다)
        // ============================================================

        let ENTITY = null;
        let ENTITY_SHAPES = [];

        const FALLBACK_SHAPES = {
            joy: { joy: 1.0 },
            fun: { fun: 1.0 },
            angry: { angry: 1.0 },
            sorrow: { sorrow: 1.0 },
            neutral: {}
        };

        async function loadEntity() {
            try {
                const res = await fetch('/api/avatar');
                if (!res.ok) throw new Error('HTTP ' + res.status);
                ENTITY = await res.json();

                const set = {};
                ENTITY.expressions.forEach(e => {
                    Object.keys(e.blendshapes || {}).forEach(n => set[n] = 1);
                    Object.keys(e.fallback_blendshapes || {}).forEach(n => set[n] = 1);
                });
                ENTITY_SHAPES = Object.keys(set);

                cacheBones();
                console.log('[diamondAI] 개체 로드: 표정 '
                    + ENTITY.expressions.length + '종, 동작 '
                    + ENTITY.motions.length + '종');
            } catch (e) {
                console.warn('[diamondAI] 개체를 불러오지 못해 기본값으로 동작합니다.', e);
            }
        }


        // ------------------------------------------------------------
        // 배경
        //
        // static/background/ 에 이미지를 넣어 두면 아바타 뒤에 깔린다.
        // 파일 이름을 이 파일에 적지 않는다 — 서버가 폴더를 훑어 알려주므로,
        // 이미지를 바꿔 넣고 새로 고치기만 하면 된다.
        //
        // 3D 는 캔버스에 그리고 배경은 CSS 로 깐다. scene.background 로 넣으면
        // 창 비율에 따라 그림이 늘어나는데, CSS 는 잘라 넣어 주기 때문이다.
        // ------------------------------------------------------------

        const backgrounds = { list: [], at: 0 };

        function paintBackground(img, fit, dim) {
            const box = document.getElementById('avatar-container');
            if (!box) return;

            // 비치는 모드에서는 장소 그림을 안 깐다.
            // 그림을 깔면 폰 화면이 그 뒤로 숨는다 — 비치라고 켠 모드다.
            if (CLEAR) {
                box.style.backgroundImage = '';
                return;
            }

            if (!img) {
                box.style.backgroundImage = '';
                return;
            }

            const veil = Math.max(0, Math.min(1, dim || 0));
            const shade = 'linear-gradient(rgba(0,0,0,' + veil + '), '
                + 'rgba(0,0,0,' + veil + '))';

            box.style.backgroundImage = shade + ', url("' + img.url + '")';
            box.style.backgroundSize = 'auto, ' + (fit || 'cover');
            box.style.backgroundPosition = 'center, center';
            box.style.backgroundRepeat = 'no-repeat, no-repeat';
        }

        async function loadBackground() {
            try {
                const res = await fetch('/api/background');
                if (!res.ok) throw new Error('HTTP ' + res.status);

                const d = await res.json();
                backgrounds.list = d.images || [];
                backgrounds.fit = d.fit;
                backgrounds.dim = d.dim;
                // 지난번에 있던 곳. 창을 닫았다 열어도 그 자리다.
                backgrounds.place = d.place || null;
                backgrounds.places = d.places || {};

                if (!d.current) {
                    // 폴더가 빈 것과 아무 데도 아닌 자리에서 시작하는
                    // 것은 다르다. 뒤엣것은 고장이 아니다.
                    paintBackground(null);

                    console.log(d.empty
                        ? '[diamondAI] ' + d.folder
                          + ' 에 배경 이미지가 없습니다. 넣으면 바로 깔립니다.'
                        : '[diamondAI] 아직 아무 데도 아닌 자리에서 시작합니다. '
                          + '갈 수 있는 곳 '
                          + Object.keys(d.places || {}).length + '군데');
                    return;
                }

                backgrounds.at = backgrounds.list
                    .findIndex(i => i.url === d.current.url);
                if (backgrounds.at < 0) backgrounds.at = 0;

                paintBackground(d.current, d.fit, d.dim);
                console.log('[diamondAI] 배경: ' + d.current.name
                    + ' (총 ' + backgrounds.list.length + '장)');

            } catch (e) {
                console.warn('[diamondAI] 배경을 불러오지 못했습니다.', e);
            }
        }

        // 여러 장 넣었을 때 다음 장으로 넘긴다.
        // 자리를 옮긴다.
        //
        // 서버가 place 를 줄 때만 부른다. 화면이 낱말을 보고 스스로
        // 옮기지 않는다 — 지나가는 말마다 배경이 바뀌면 어지럽다.
        // 갈 수 있는 곳인지도 서버가 이미 가렸다.
        function goPlace(place) {
            if (!place || !place.image || !place.image.url) return;

            backgrounds.place = place.name || null;

            // 목록에서 그 그림의 자리를 찾아 둔다.
            // 안 그러면 /배경 으로 넘길 때 엉뚱한 데서 이어진다.
            const at = backgrounds.list
                .findIndex(i => i.url === place.image.url);

            if (at >= 0) backgrounds.at = at;

            paintBackground(place.image, backgrounds.fit, backgrounds.dim);

            console.log('[diamondAI] 자리를 옮겼다: ' + place.name);

            if (typeof showHint === 'function') {
                showHint(place.name, 2200);
            }
        }

        function nextBackground() {
            if (backgrounds.list.length < 2) return null;
            backgrounds.at = (backgrounds.at + 1) % backgrounds.list.length;
            const img = backgrounds.list[backgrounds.at];
            paintBackground(img, backgrounds.fit, backgrounds.dim);
            return img;
        }

        // ------------------------------------------------------------
        // 모프 타깃을 직접 건드리기
        //
        // VRM 이 내주는 표정 그룹은 14개뿐인데 얼굴 메시에는 57개가 있다.
        // 남은 것들은 눈썹·눈·입을 따로 움직이는 조각이라, 직접 쓰면
        // 그룹만으로는 못 만드는 얼굴을 만들 수 있다.
        // (눈 하이라이트를 지우는 것 같은)
        // ------------------------------------------------------------

        const morphSlots = {};      // 이름 -> [{mesh, index}, ...]

        function buildMorphs() {
            Object.keys(morphSlots).forEach(k => delete morphSlots[k]);
            if (!currentVRM) return;

            currentVRM.scene.traverse(o => {
                if (!o.morphTargetDictionary || !o.morphTargetInfluences) return;
                Object.keys(o.morphTargetDictionary).forEach(name => {
                    (morphSlots[name] = morphSlots[name] || []).push({
                        mesh: o,
                        index: o.morphTargetDictionary[name]
                    });
                });
            });

            console.log('[diamondAI] 모프 타깃 '
                + Object.keys(morphSlots).length + '개');
        }

        // 말하는 동안 그룹 대신 얹은 조각(part)이 받은 값.
        // 같은 조각을 배합기도 쓰면 둘을 더해야 해서 필요하다.
        function shapeOfPart(part, shapes, toParts) {
            for (const g of Object.keys(shapes)) {
                if ((toParts[g] || []).indexOf(part) >= 0) return shapes[g];
            }
            return null;
        }

        function setMorph(name, value) {
            const slots = morphSlots[name];
            if (!slots) return false;
            slots.forEach(s => s.mesh.morphTargetInfluences[s.index] = value);
            return true;
        }

        function clearMorphs() {
            // 표정이 쓰는 것만 되돌린다. 입모양(립싱크)까지 지우면 안 된다.
            ((ENTITY && ENTITY.expressions) || []).forEach(e => {
                Object.keys(e.morphs || {}).forEach(n => setMorph(n, 0));
            });
        }

        function entityMorphsFor(key) {
            if (!ENTITY) return null;
            const e = ENTITY.expressions.find(x => x.key === key);
            return (e && e.morphs) || null;
        }


        function entityShapesFor(key) {
            if (!ENTITY) return FALLBACK_SHAPES[key] || null;
            const e = ENTITY.expressions.find(x => x.key === key);
            if (!e) return FALLBACK_SHAPES[key] || null;
            if (e.auto_detect) {
                if (surprisedBlendShapeName) {
                    const o = {};
                    o[surprisedBlendShapeName] = e.auto_weight;
                    return o;
                }
                return e.fallback_blendshapes || {};
            }
            return e.blendshapes || {};
        }


