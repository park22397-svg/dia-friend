// dia/face.js — 얼굴 — 눈·표정 적용·립싱크 입 모양
// (다이아의 몸. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 눈 상태
        // ============================================================

        // 눈을 끝까지 감는 값.
        //
        // 1.0 으로 감으면 이 아바타는 윗눈꺼풀과 아랫눈꺼풀이 겹쳐
        // 찌그러진다. 그래서 배합기에서 '눈 감기' 를 맞춰 둔 값을
        // 깜빡임·잠들기·처음 뜰 때가 다 같이 쓴다.
        // 배합기에서 눈 감기를 고치면 여기도 따라간다.
        function eyeCloseMax() {
            const s = entityShapesFor('eyes_closed');
            const v = s && s.blink;
            return (typeof v === 'number' && v > 0) ? v : 1.0;
        }

        function setEyeState(close) {

            if (
                !currentVRM ||
                !currentVRM.blendShapeProxy
            ) {
                return;
            }

            try {

                const presetName =
                    (
                        THREE.VRMBlendShapePresetName &&
                        THREE.VRMBlendShapePresetName.Blink
                    )
                        ? THREE.VRMBlendShapePresetName.Blink
                        : 'blink';

                currentVRM.blendShapeProxy.setValue(
                    presetName,
                    close ? eyeCloseMax() : 0.0
                );

                currentVRM.blendShapeProxy.update();

            } catch (e) {

                console.warn(
                    "눈 상태 변경 실패:",
                    e
                );

            }
        }


        // ============================================================
        // 표정 적용
        // ============================================================

        // ============================================================
        // 새 아바타의 커스텀 놀람 표정 자동 탐색
        // ============================================================

        let surprisedBlendShapeName = null;

        function detectSurprisedBlendShape(gltf) {
            surprisedBlendShapeName = null;

            try {
                // 최상위 확장은 gltf.userData 에 들어가지 않는다.
                // GLTFLoader 는 그걸 parser.json 에만 남긴다.
                // 여기를 userData 로만 보고 있어서 목록이 늘 비었고,
                // 그래서 놀람 표정이 한 번도 걸리지 않았다.
                const ext = (gltf && gltf.parser && gltf.parser.json
                             && gltf.parser.json.extensions
                             && gltf.parser.json.extensions.VRM)
                    || (gltf && gltf.userData
                        && gltf.userData.gltfExtensions
                        && gltf.userData.gltfExtensions.VRM);

                const groups = ext && ext.blendShapeMaster
                    && ext.blendShapeMaster.blendShapeGroups;
                const names = Array.isArray(groups)
                    ? groups.map(g => g?.name).filter(Boolean)
                    : [];

                console.log('[diamondAI] VRM 표정 목록:', names);

                const normalize = value => String(value)
                    .trim().toLowerCase().replace(/[ _-]/g, '');

                const exactCandidates = [
                    'surprised', 'surprise', 'shocked', 'shock',
                    '놀람', '놀람표정', '驚き'
                ];

                for (const candidate of exactCandidates) {
                    const found = names.find(name =>
                        normalize(name) === normalize(candidate)
                    );
                    if (found) {
                        surprisedBlendShapeName = found;
                        break;
                    }
                }

                if (!surprisedBlendShapeName) {
                    const found = names.find(name => {
                        const n = normalize(name);
                        return n.includes('surpris') ||
                               n.includes('shock') ||
                               n.includes('놀람') ||
                               n.includes('驚');
                    });
                    if (found) surprisedBlendShapeName = found;
                }

                if (surprisedBlendShapeName) {
                    console.log(
                        '[diamondAI] 놀람 표정 발견:',
                        surprisedBlendShapeName
                    );
                } else {
                    console.warn(
                        '[diamondAI] 커스텀 놀람 표정을 찾지 못했어. VRM 표정 목록을 확인해줘.'
                    );
                }
            } catch (error) {
                console.warn('[diamondAI] 놀람 표정 탐색 실패:', error);
            }
        }


        // ============================================================
        // 표정 적용
        // ============================================================

        // 말하는 동안 입 대신 얹어 둔 조각들.
        //
        // 표정 그룹(ALL_*)은 눈·눈썹·입이 한 덩어리라 입만 뺄 수 없다.
        // 그래서 말할 때는 그룹을 끄고 눈·눈썹 조각을 직접 얹는다.
        // 여기 적어 두었다가 다음 번에 지운다.
        const speakMorphs = new Set();

        function isSpeaking() {
            return !!lipSyncTimer;
        }

        // amount 는 얼마나 짓는가(0~1). 보통은 다 짓는다.
        // 쉬는 얼굴(dia/heart.js)만 옅게 짓는다 — 그때는 표정 중으로 치지 않아
        // 깜빡임이 이어진다.
        function applyExpression(expression, amount) {
            if (!currentVRM || !currentVRM.blendShapeProxy) return;

            const k = (typeof amount === 'number') ? Math.max(0, Math.min(1, amount)) : 1;
            const resting = k < 1;
            faceResting = false;

            // 부정적인 표현이 사라지는 단계면 여기서 갈아 끼운다.
            expression = swapNegative('expressions', expression);

            try {
                // 절정 표정은 표현용 얼굴에서 짓는다. 그때 얼굴을 바꿔 낀다.
                const spec = ENTITY && ENTITY.expressions
                    && ENTITY.expressions.find(x => x.key === expression);
                const special = !!(spec && spec.source === 'special')
                    && !!bodyVRM;

                useSpecialFace(special);

                const proxy = (special && bodyVRM)
                    ? bodyVRM.blendShapeProxy
                    : currentVRM.blendShapeProxy;

                if (!proxy) return;
                currentExpression = expression;
                currentExpressionAmount = k;
                isExpressing = expression !== 'neutral' && !resting;

                // 지울 이름은 개체가 알려준 목록을 쓴다.
                const clearNames = ENTITY_SHAPES.length
                    ? ENTITY_SHAPES
                    : ['joy', 'angry', 'sorrow', 'fun',
                       'surprised', 'blink', 'blink_l', 'blink_r'];

                clearNames.forEach(name => {
                    try { proxy.setValue(name, 0.0); } catch (e) {}
                });

                if (surprisedBlendShapeName) {
                    try { proxy.setValue(surprisedBlendShapeName, 0.0); } catch (e) {}
                }

                // 말하는 동안에는 입을 립싱크에 넘긴다.
                //
                // 웃는 입이 벌어져 있는데 그 위에 '아' 가 얹히면 입이
                // 두 겹으로 일그러진다. 평온할 때 말하는 입이 가장
                // 자연스러운 것도 그래서다 — 겹칠 입이 없기 때문이다.
                //
                // 그래서 말할 때는 표정 그룹을 끄고 눈·눈썹 조각만 얹는다.
                const talking = isSpeaking();
                const SP = (ENTITY && ENTITY.behavior
                    && ENTITY.behavior.speaking) || {};
                const toParts = SP.group_to_parts || {};
                const mouthPre = SP.mouth_prefixes || ['Fcl_MTH_', 'Fcl_HA_'];

                // 지난번에 얹어 둔 조각을 먼저 걷는다
                speakMorphs.forEach(n => setMorph(n, 0));
                speakMorphs.clear();

                // 부위별 모프도 여기서 먼저 걷는다.
                //
                // 아래에서 그룹을 눈·눈썹 조각으로 바꿔 얹은 뒤에 걷으면,
                // 배합기가 같은 조각(Fcl_EYE_Fun)을 쓴 표정에서 방금 얹은
                // 눈까지 0 이 된다. 그러면 말할 때만 눈이 덜 웃어 커 보인다.
                clearMorphs();

                // 표정 수치는 이 파일이 정하지 않는다. 개체가 정한다.
                const shapes = entityShapesFor(expression) || {};
                Object.keys(shapes).forEach(name => {
                    const parts = talking ? toParts[name] : null;

                    if (parts) {
                        // 입을 뺀 채로 눈과 눈썹만
                        parts.forEach(n => {
                            setMorph(n, shapes[name] * k);
                            speakMorphs.add(n);
                        });
                        return;
                    }

                    try { proxy.setValue(name, shapes[name] * k); } catch (e) {}
                });

                // 부위별 모프도 개체가 정한 대로 얹는다
                const morphs = entityMorphsFor(expression) || {};
                Object.keys(morphs).forEach(n => {
                    // 말하는 중이면 입을 건드리는 조각은 빼둔다
                    if (talking && mouthPre.some(p => n.indexOf(p) === 0)) return;

                    // 그룹을 바꿔 얹은 조각과 같으면 덮지 않고 더한다.
                    // 평소에는 그룹(ALL_Fun)의 눈 몫 위에 이 조각이 더해져
                    // 보이므로, 말할 때도 같은 합이어야 얼굴이 안 바뀐다.
                    const base = speakMorphs.has(n)
                        ? (shapeOfPart(n, shapes, toParts) || 0) * k : 0;
                    setMorph(n, base + morphs[n] * k);
                });

                // 단계에 붙어 있는 얼굴은 표정과 상관없이 늘 걸린다.
                // 얀데레의 빈 눈이 그것이다 — 웃어도 눈에 빛이 없다.
                const sm = stageMorphs();
                Object.keys(sm).forEach(n => setMorph(n, sm[n]));

                if (!Object.keys(shapes).length
                    && !Object.keys(morphs).length) {
                    isExpressing = false;
                }

                // 표정이 눈 자체를 쓰는 것이면 눈을 뜨게 하면 안 된다.
                // 눈 감기·윙크가 blink 값을 쓰는데 여기서 0으로 되돌리면
                // 감으라고 해 놓고 곧바로 뜨는 꼴이 된다.
                const usesEyes = Object.keys(shapes)
                    .some(n => String(n).indexOf('blink') === 0);

                if (expression !== 'neutral' && !usesEyes && !resting) {
                    isBlinking = false;
                    blinkProgress = 0;
                    blinkTimer = 0;
                    setEyeState(false);
                }

                if (usesEyes) {
                    // 감고 있는 동안 저절로 깜빡이면 값이 흔들린다
                    isBlinking = false;
                    blinkProgress = 0;
                    blinkTimer = 0;
                }

                // 자는 중이면 눈은 감은 채로 둔다.
                // 위에서 지우는 목록에 blink 가 들어 있어서,
                // 그냥 두면 표정을 건드릴 때마다 눈이 떠진다.
                if (isSleeping) {
                    isBlinking = false;
                    blinkProgress = 0;
                    setEyeState(true);
                }

                proxy.update();

                // 지금 기분을 화면 오른쪽 위에도 알린다
                if (typeof setMood === 'function') setMood(expression);

            } catch (e) {
                console.log('표정 적용 실패:', e);
            }
        }



        // ============================================================
        // 한국어 텍스트 → 립싱크 모음
        // ============================================================

        function textToVisemes(text) {

            const visemes = [];

            for (
                let i = 0;
                i < text.length;
                i++
            ) {

                const char = text[i];

                const code =
                    char.charCodeAt(0);


                // 한글
                if (
                    code >= 0xAC00 &&
                    code <= 0xD7A3
                ) {

                    const vowelIndex =
                        Math.floor(
                            ((code - 0xAC00) % 588) / 28
                        );


                    if (
                        [0, 1, 2, 3, 9]
                            .includes(vowelIndex)
                    ) {

                        visemes.push('a');

                    } else if (
                        [4, 5, 6, 7, 14, 15]
                            .includes(vowelIndex)
                    ) {

                        visemes.push('e');

                    } else if (
                        [8, 12, 13]
                            .includes(vowelIndex)
                    ) {

                        visemes.push('o');

                    } else if (
                        [11, 16, 17, 18, 19]
                            .includes(vowelIndex)
                    ) {

                        visemes.push('u');

                    } else {

                        visemes.push('i');

                    }

                }

                // 영어
                else if (/[aA]/.test(char)) {

                    visemes.push('a');

                } else if (/[iI]/.test(char)) {

                    visemes.push('i');

                } else if (/[uU]/.test(char)) {

                    visemes.push('u');

                } else if (/[eE]/.test(char)) {

                    visemes.push('e');

                } else if (/[oO]/.test(char)) {

                    visemes.push('o');

                }

                // 공백 / 문장부호
                else if (
                    char === ' ' ||
                    char === '.' ||
                    char === ',' ||
                    char === '!' ||
                    char === '?' ||
                    char === '。' ||
                    char === '！' ||
                    char === '？'
                ) {

                    visemes.push(null);
                }
            }

            return visemes;
        }


        // ============================================================
        // 목표 입 모양 초기화
        // ============================================================

        function resetTargetVowels() {

            Object.keys(
                targetVowelValues
            ).forEach(v => {

                targetVowelValues[v] = 0;

            });
        }


        // ============================================================
        // 립싱크
        // ============================================================

                        // ------------------------------------------------------------
        // 말하는 도중 얼굴이 바뀌는 자리
        //
        // 예전에는 이모지 목록을 이 파일에 손으로 적어 두고 글자 하나와
        // 맞춰 봤다. 그래서 '좋아' 'ㅋㅋ' '슬퍼' 처럼 두 글자 이상인 신호는
        // 한 번도 걸린 적이 없었다 — 글자 하나와 같을 수가 없기 때문이다.
        // 목록도 개체와 따로 놀아서 한쪽만 고치면 어긋났다.
        //
        // 이제 지나온 글자를 조금 쥐고 있다가, 개체가 들고 있는
        // live_triggers 로 끝나는지 본다. 여러 글자짜리도 걸린다.
        // ------------------------------------------------------------

        let spokenTail = '';

        function liveTrigger(ch) {
            spokenTail = (spokenTail + ch).slice(-10);

            const list = (ENTITY && ENTITY.expressions) || [];

            for (const e of list) {
                if (e.key === 'neutral' || !e.live_triggers) continue;

                const hit = e.live_triggers.some(t => t && spokenTail.endsWith(t));
                if (!hit) continue;

                if (window.expressionChangeTimer) {
                    clearTimeout(window.expressionChangeTimer);
                }

                applyExpression(e.key);
                spokenTail = '';        // 같은 신호가 두 번 걸리지 않게

                const ms = e.hold_ms || 3000;
                window.expressionChangeTimer = setTimeout(() => {
                    settleFace();
                }, ms);

                return e.key;
            }

            return null;
        }


