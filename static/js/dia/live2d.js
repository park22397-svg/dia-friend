// dia/live2d.js — Live2D 몸 (2026-10-05, 실험)
//
// 다이아의 몸을 Live2D 모델로 그린다. 켜는 법은 둘이다.
//   · 서버: 환경변수 DIA_LIVE2D 에 .model3.json 주소 (config.LIVE2D_MODEL → <meta id=dia-live2d>)
//   · 화면: 주소 끝에 ?live2d=/static/live2d/.../x.model3.json  (?live2d=off 면 끈다)
// 아무것도 없으면 이 파일은 아무 일도 안 하고, 늘 쓰던 3D 다이아가 보인다.
//
// ── 어떻게 붙는가 ──────────────────────────────────────────────
// 3D 몸(VRM)은 버리지 않는다. 불러서 **보이지 않게** 돌린다.
// 표정(face.js)·몸짓(motion.js)·마음의 자세(heart.js)·립싱크(voice.js)는
// 지금처럼 그 보이지 않는 몸을 움직이고, Live2D 모델은 매 프레임 그 몸을
// 읽어 따라 그린다 — 거울처럼. 그래서 기존 파일은 한 줄도 안 고친다.
//
//   보이지 않는 몸에서 읽는 것        Live2D 에 적는 것
//   머리 뼈 회전(x 끄덕·y 돌림·z 갸웃)  ParamAngleY / ParamAngleX / ParamAngleZ
//   blink · blink_l · blink_r         ParamEyeLOpen / ParamEyeROpen
//   currentExpression × 세기          입꼬리·눈웃음·눈썹·볼 (아래 FACE 표)
//   립싱크 모음 a i u e o             ParamMouthOpenY / ParamMouthForm
//   시선(gaze)                        ParamEyeBallX / ParamEyeBallY
//
// Live2D 는 매 프레임 '모션 → 시선(updateFocus) → 숨 → 물리' 순으로 값을
// 고친다. 시선 자리(updateFocus)를 이 거울로 바꿔 끼우므로, 고개를 돌리면
// 머리카락 물리도 그 고개를 따라온다.
//
// ── 몸짓 ───────────────────────────────────────────────────────
// 팔짱·손인사 같은 몸짓은 Live2D 에서 '모션' 이다. 모델의 모션 그룹 이름이
// 다이아의 동작 이름(cross, wave, nod, shy, rps_rock ...)과 같으면 그것을
// 튼다. 없으면 고개·얼굴만 따라가고 몸짓은 빠진다. 망내 모델을 Cubism 에서
// 만들 때 모션 그룹 이름을 이 이름들로 지으면 그대로 붙는다.
//
// ── 아직 안 되는 것 ────────────────────────────────────────────
// 만지기는 보이지 않는 3D 몸의 자리로 판정한다 — Live2D 그림과 자리가
// 다를 수 있다. 옷장·걷기도 3D 몸에서만 일어난다.

        const LIVE2D_LIBS = [
            // Cubism Core 는 Live2D 사 것이라 저장소에 싣지 않고 공식 주소에서 받는다
            'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js',
            'https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js',
            'https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js',
        ];

        // 표정마다 Live2D 얼굴. 값은 '그 표정을 다 지었을 때' 이고 세기만큼 곱한다.
        // 모델에 없는 파라미터는 건너뛴다. (몸의 말이라 다이아에게 시키는 규칙이 아니다)
        const LIVE2D_FACE = {
            joy:       { ParamMouthForm: 1.0,  ParamEyeLSmile: 0.9, ParamEyeRSmile: 0.9, ParamCheek: 0.6, ParamBrowLY: 0.3, ParamBrowRY: 0.3 },
            fun:       { ParamMouthForm: 0.7,  ParamEyeLSmile: 0.5, ParamEyeRSmile: 0.5, ParamCheek: 0.4 },
            sorrow:    { ParamMouthForm: -0.7, ParamBrowLY: -0.3, ParamBrowRY: -0.3, ParamBrowLAngle: 0.8, ParamBrowRAngle: 0.8, ParamBrowLForm: -0.6, ParamBrowRForm: -0.6, eyeOpen: 0.75 },
            angry:     { ParamMouthForm: -0.9, ParamBrowLY: -0.5, ParamBrowRY: -0.5, ParamBrowLAngle: -0.9, ParamBrowRAngle: -0.9, ParamBrowLForm: -1.0, ParamBrowRForm: -1.0, eyeOpen: 0.8 },
            surprised: { ParamBrowLY: 1.0, ParamBrowRY: 1.0, ParamMouthOpenY: 0.5, eyeOpen: 1.25 },
            eyes_closed: { eyeOpen: 0 },
        };

        const live2d = {
            on: false,
            app: null,
            model: null,
            core: null,
            ids: new Set(),     // 모델에 있는 파라미터 이름
            groups: new Set(),  // 모델에 있는 모션 그룹 이름
            face: null,         // 지금 얹고 있는 표정 값(부드럽게 따라간다). 시작할 때 채운다
            lastT: 0,
        };

        function live2dWanted() {
            let want = '';
            try {
                const m = document.getElementById('dia-live2d');
                want = (m && m.getAttribute('content')) || '';
            } catch (e) {}
            try {
                const hit = /[?&]live2d=([^&]*)/.exec(location.search || '');
                const q = hit ? decodeURIComponent(hit[1]) : '';
                if (q === 'off') return '';
                // 화면에서 바꾸는 것은 이 서버의 static/live2d 아래만 받는다
                if (q && q.indexOf('/static/live2d/') === 0) want = q;
            } catch (e) {}
            return want;
        }

        function live2dLoadScript(src) {
            return new Promise((ok, fail) => {
                const s = document.createElement('script');
                s.src = src;
                s.onload = ok;
                s.onerror = () => fail(new Error('못 불러옴: ' + src));
                document.head.appendChild(s);
            });
        }

        function live2dSet(id, v) {
            if (live2d.ids.has(id)) live2d.core.setParameterValueById(id, v);
        }

        // 보이지 않는 몸에서 읽어 Live2D 에 적는다. 매 프레임, 물리 계산 전에.
        function live2dMirror() {
            if (!live2d.core || !live2d.face) return;

            const now = performance.now();
            const dt = Math.min(0.1, (now - (live2d.lastT || now)) / 1000);
            live2d.lastT = now;
            const DEG = 180 / Math.PI;

            // 고개 — 3D 머리 뼈 각도가 곧 마음의 자세·끄덕임·시선을 다 담고 있다
            let hx = 0, hy = 0, hz = 0;
            try {
                const head = currentVRM && currentVRM.humanoid.getBoneNode('head');
                if (head) { hx = head.rotation.x * DEG; hy = head.rotation.y * DEG; hz = head.rotation.z * DEG; }
            } catch (e) {}
            // Live2D 는 ±30 범위. 3D 고개 각도는 작아서 조금 키워 보인다.
            // 좌우·상하는 그림 한 장을 휘는 것이라 끝까지 돌리면 얼굴이 깨진다 → 절반(±15)만 쓴다.
            // 갸웃(Z)은 통째로 돌리는 것이라 깨지지 않아 그대로 둔다.
            const TURN = 15;
            live2dSet('ParamAngleX', Math.max(-TURN, Math.min(TURN, hy * 0.75)));
            live2dSet('ParamAngleY', Math.max(-TURN, Math.min(TURN, hx * 0.75)));
            live2dSet('ParamAngleZ', Math.max(-30, Math.min(30, -hz * 1.5)));
            live2dSet('ParamBodyAngleX', Math.max(-10, Math.min(10, hy * 0.4)));

            // 눈동자 — 사람 얼굴을 찾았으면 그쪽
            try {
                if (gaze && gaze.has) {
                    live2dSet('ParamEyeBallX', Math.max(-1, Math.min(1, gaze.x)));
                    live2dSet('ParamEyeBallY', Math.max(-1, Math.min(1, -gaze.y)));
                }
            } catch (e) {}

            // 표정 — 지금 얼굴과 세기를 목표로 부드럽게 따라간다
            const want = {};
            const spec = LIVE2D_FACE[currentExpression] || {};
            const amt = (typeof currentExpressionAmount === 'number') ? currentExpressionAmount : 1;
            Object.keys(spec).forEach(k => {
                want[k] = (k === 'eyeOpen') ? 1 + (spec[k] - 1) * amt : spec[k] * amt;
            });
            const keys = new Set([...Object.keys(want), ...Object.keys(live2d.face)]);
            const kf = Math.min(1, dt * 8);
            keys.forEach(k => {
                const target = (k in want) ? want[k] : (k === 'eyeOpen' ? 1 : 0);
                const cur = (k in live2d.face) ? live2d.face[k] : (k === 'eyeOpen' ? 1 : 0);
                live2d.face[k] = cur + (target - cur) * kf;
            });

            // 눈 — 3D 몸의 깜빡임(blink)을 그대로. 윙크는 한쪽씩.
            let bl = 0, bL = 0, bR = 0;
            try {
                const p = currentVRM.blendShapeProxy;
                bl = p.getValue('blink') || 0;
                bL = p.getValue('blink_l') || 0;
                bR = p.getValue('blink_r') || 0;
            } catch (e) {}
            const closeMax = (typeof eyeCloseMax === 'function') ? (eyeCloseMax() || 1) : 1;
            const open = (live2d.face.eyeOpen === undefined) ? 1 : live2d.face.eyeOpen;
            live2dSet('ParamEyeLOpen', Math.max(0, open * (1 - Math.min(1, (bl + bL) / closeMax))));
            live2dSet('ParamEyeROpen', Math.max(0, open * (1 - Math.min(1, (bl + bR) / closeMax))));

            // 입 — 립싱크 모음. 벌림은 큰 모음일수록, 'ㅣ·ㅔ' 는 옆으로, 'ㅜ·ㅗ' 는 오므린다.
            let mOpen = 0, mForm = 0;
            try {
                const v = currentVowelValues;
                mOpen = Math.max(v.a, v.o * 0.8, v.e * 0.6, v.u * 0.5, v.i * 0.4);
                mForm = (v.i + v.e * 0.5) - (v.u + v.o * 0.5);
            } catch (e) {}

            Object.keys(live2d.face).forEach(k => {
                if (k === 'eyeOpen') return;
                let v = live2d.face[k];
                if (k === 'ParamMouthOpenY') v = Math.max(v, mOpen);
                if (k === 'ParamMouthForm') v = Math.max(-1, Math.min(1, v + mForm * 0.5));
                live2dSet(k, v);
            });
            if (!('ParamMouthOpenY' in live2d.face)) live2dSet('ParamMouthOpenY', mOpen);
        }

        // 다이아의 몸짓을 Live2D 모션으로. 같은 이름의 그룹이 있을 때만.
        function live2dMotion(key) {
            if (!live2d.model || !key || key === 'idle' || key === 'walk') return;
            if (!live2d.groups.has(key)) return;
            try { live2d.model.motion(key, undefined, 3 /* FORCE */); } catch (e) {}
        }

        function live2dFit() {
            const m = live2d.model, app = live2d.app;
            if (!m || !app) return;
            const w = app.renderer.width / app.renderer.resolution;
            const h = app.renderer.height / app.renderer.resolution;
            // 전신이 다 보이게: 화면 높이의 94%(가로가 좁으면 가로에 맞춤), 위에 3% 여백
            const s = Math.min((h * 0.94) / live2d.baseH, (w * 0.94) / live2d.baseW);
            m.scale.set(s);
            m.x = w / 2;
            m.y = h * 0.03;
        }

        async function live2dStart() {
            const url = live2dWanted();
            if (!url) return;

            try {
                for (const src of LIVE2D_LIBS) await live2dLoadScript(src);
            } catch (e) {
                console.warn('[diamondAI] Live2D 라이브러리를 못 받아 3D 로 갑니다', e);
                return;
            }

            const box = document.getElementById('avatar-container');
            const cv = document.createElement('canvas');
            cv.id = 'canvas-live2d';
            // 3D 화면 바로 위에 겹친다. 누르는 것은 아래(3D·단추)로 지나가게.
            cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
            const c3 = document.getElementById('canvas3d');
            c3.parentNode.insertBefore(cv, c3.nextSibling);

            const app = new PIXI.Application({
                view: cv,
                backgroundAlpha: 0,
                resizeTo: box,
                antialias: true,
                resolution: Math.min(window.devicePixelRatio || 1, 2),
                autoDensity: true,
            });

            let model;
            try {
                model = await PIXI.live2d.Live2DModel.from(url, { autoInteract: false });
            } catch (e) {
                console.warn('[diamondAI] Live2D 모델을 못 읽어 3D 로 갑니다', url, e);
                app.destroy(true);
                return;
            }

            // 표정 값은 처음부터 다 쥔다. 안 그러면 표정을 짓기 전에는 모델의
            // 기본 모션이 입꼬리·눈웃음을 정하고, 한 번 지었다 풀면 0 이 되어
            // 같은 '평온' 인데 얼굴이 둘이 된다.
            live2d.face = { eyeOpen: 1 };
            Object.values(LIVE2D_FACE).forEach(f => Object.keys(f).forEach(k => {
                if (k !== 'eyeOpen') live2d.face[k] = 0;
            }));

            live2d.app = app;
            live2d.model = model;
            live2d.baseH = model.height;
            live2d.baseW = model.width;
            model.anchor.set(0.5, 0);
            app.stage.addChild(model);

            const im = model.internalModel;
            live2d.core = im.coreModel;

            // 모델이 가진 파라미터·모션 그룹
            try {
                const ids = live2d.core._model.parameters.ids;
                for (let i = 0; i < ids.length; i++) live2d.ids.add(ids[i]);
            } catch (e) {}
            try {
                Object.keys(im.motionManager.definitions || {}).forEach(g => live2d.groups.add(g));
            } catch (e) {}

            // 눈 깜빡임은 3D 몸이 정한다. Live2D 가 따로 깜빡이면 두 번 감는다.
            im.eyeBlink = undefined;
            // 시선 자리를 거울로 — 물리 계산 바로 앞이다
            im.updateFocus = live2dMirror;

            live2dFit();
            window.addEventListener('resize', () => setTimeout(live2dFit, 50));

            live2d.on = true;
            document.body.classList.add('live2d');
            console.log('[diamondAI] Live2D 몸:', url,
                '파라미터', live2d.ids.size, '모션 그룹', [...live2d.groups].join(','));
        }

        // 3D 몸과 입은 옷은 보이지 않게만. 갈아입으면 새로 실리므로 매번 본다.
        function live2dHideVRM() {
            if (!live2d.on) return;
            try { if (currentVRM && currentVRM.scene.visible) currentVRM.scene.visible = false; } catch (e) {}
            try { if (bodyVRM && bodyVRM.scene.visible) bodyVRM.scene.visible = false; } catch (e) {}
            // 입은 옷은 몸과 따로 장면에 실린다(wear.js). 몸만 숨기면 옷이 떠 보인다.
            try {
                Object.keys(WEAR).forEach(k => {
                    const v = WEAR[k] && WEAR[k].vrm;
                    if (v && v.scene.visible) v.scene.visible = false;
                });
            } catch (e) {}
        }

        if (live2dWanted()) {
            // 몸짓을 Live2D 모션으로도 보낸다. 원래 일은 그대로 한다.
            const _playMotion3d = playMotion;
            playMotion = function (key, opts) {
                const r = _playMotion3d(key, opts);
                if (live2d.on) live2dMotion(key);
                return r;
            };

            setInterval(live2dHideVRM, 200);
            live2dStart();
        }
