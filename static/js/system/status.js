// system/status.js — 사이·기분 이름표
// (시스템. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 지금 어떤 사이이고 어떤 기분인지 보여주기
        //
        // 단계 경계와 표정 이름은 개체가 가지고 있다.
        // 여기서는 받아서 그리기만 한다.
        // ============================================================

        const stageLabelEl = document.getElementById('stage-label');
        const affinityNumEl = document.getElementById('affinity-num');
        const affinityFill = document.getElementById('affinity-fill');
        const affinityKnob = document.getElementById('affinity-knob');
        const affinityMarks = document.getElementById('affinity-marks');
        const affinityPop = document.getElementById('affinity-pop');
        const moodDot = document.getElementById('mood-dot');
        const moodLabel = document.getElementById('mood-label');
        const moodBars = document.getElementById('mood-bars');

        // 표정마다 색을 준다. 이름만으로는 한눈에 안 들어온다.
        const MOOD_COLOR = {
            neutral: '#8f93b8',
            joy: '#f0c86a',
            fun: '#86e08a',
            sorrow: '#6fa8dc',
            angry: '#ff7b7b',
            surprised: '#c58ae0'
        };

        let affinityShown = null;

        // 상한(330)을 넘어 쌓인 마음. 100점이 모여야 1이 된다.
        let myWarmth = null;        // '살가움' 처럼 오늘의 온도

        // 지금 얼마나 상해 있는가.
        //
        // 사이(단계)와는 다르다. 사이가 좋아도 방금 심한 말을 들었으면
        // 상해 있다. 쓰다듬으면 풀리고, 시간이 지나도 저절로 풀린다.
        const myMood = { level: 0, label: null, expression: null };

        // 연인인가.
        //
        // 사이(단계)와 다르다. 사이는 마음이 얼마나 깊은지고,
        // 이건 그 마음을 서로 말로 확인했는지다.
        // 연인이 되기 전에는 호감이 광기 앞에서 멈춘다.
        const myLover = { yes: false, ceiling: null };

        // 지금 단계에 늘 걸려 있는 얼굴
        function stageMorphs() {
            const s = stageList().find(x => x.key === myStageKey);
            return (s && s.morphs) || {};
        }

        function stageList() {
            return (ENTITY && ENTITY.relationship && ENTITY.relationship.stages)
                || [];
        }

        function curStage() {
            return stageList().find(x => x.key === myStageKey) || null;
        }

        // 부정적인 표현이 사라지는 단계에서 무엇으로 바꿔 낼지.
        //
        // 얀데레가 그렇다. 화를 참는 게 아니라 화가 날 일이 없어진 것이라
        // 화난 얼굴을 지우는 대신 웃는 얼굴로 갈아 끼운다.
        // 눈에는 이미 빛이 없으니(stageMorphs) 웃는 얼굴이 더 서늘하다.
        function swapNegative(kind, key) {
            if (!key) return key;
            const s = curStage();
            if (!s || !s.no_negative) return key;

            const tbl = (ENTITY.relationship.no_negative || {})[kind] || {};
            const to = tbl[key];
            if (!to || to === key) return key;

            console.log('[diamondAI] ' + s.label + ' — ' + kind + ' '
                + key + ' -> ' + to);
            return to;
        }

        function affinityRange() {
            const st = stageList();
            if (!st.length) return [-100, 120];

            const lo = st[0].min_affinity;
            const last = st[st.length - 1].min_affinity;

            // 마지막 단계도 눈금 안에서 자리를 갖도록 여유를 준다.
            // 친밀도 상한이 열려 있어 지금 값이 더 클 수도 있으므로 그것도 본다.
            let hi = last + Math.max(20, Math.round((last - lo) * 0.15));
            if (typeof myAffinity === 'number') {
                hi = Math.max(hi, myAffinity + 10);
            }
            return [lo, hi];
        }

        function buildAffinityMarks() {
            const [lo, hi] = affinityRange();
            affinityMarks.innerHTML = '';

            stageList().forEach(s => {
                if (s.min_affinity <= lo) return;
                const i = document.createElement('i');
                i.style.left = ((s.min_affinity - lo) / (hi - lo) * 100) + '%';
                i.title = s.label + ' ' + s.min_affinity;
                affinityMarks.appendChild(i);
            });
        }

        function setAffinity(value, label) {
            if (typeof value !== 'number') return;

            const [lo, hi] = affinityRange();
            const pct = Math.max(0, Math.min(100, (value - lo) / (hi - lo) * 100));

            affinityFill.style.width = pct + '%';
            affinityKnob.style.left = pct + '%';
            affinityNumEl.textContent = value;

            // 눈금이 꽉 찬 뒤로도 쌓이는 마음이 있다.
            // 눈금은 그대로 두고 이름표 옆에 조용히 적는다.
            if (label) {
                let t = myWarmth
                    ? label + ' · ' + myWarmth
                    : label;

                // 연인이면 그렇게 적는다
                if (myLover.yes) t += ' · 연인';

                // 연인이 아닌데 천장에 닿았으면 왜 안 오르는지 알려준다
                else if (myLover.ceiling !== null
                         && value >= myLover.ceiling) {
                    t += ' · 여기서 멈춤 (고백이 필요하다)';
                }

                // 상해 있으면 그것도 적는다. 사이와 기분은 다른 것이다.
                if (myMood.level > 0 && myMood.label) {
                    t += ' · 기분 ' + myMood.label;
                }

                stageLabelEl.textContent = t;
            }

            if (affinityShown !== null && value !== affinityShown) {
                showAffinityPop(value - affinityShown);
            }
            affinityShown = value;

            updateTouchZones();
        }

        function showAffinityPop(delta) {
            if (!delta) return;
            affinityPop.textContent = (delta > 0 ? '+' : '') + delta;
            affinityPop.className = delta > 0 ? 'up' : 'down';
            // 애니메이션을 다시 태우려면 한 번 지웠다 붙여야 한다
            void affinityPop.offsetWidth;
            affinityPop.classList.add('show');
            setTimeout(() => affinityPop.classList.remove('show'), 1400);
        }

        function buildMoodBars() {
            moodBars.innerHTML = '';
            const list = (ENTITY && ENTITY.expressions) || [];
            // 윙크나 눈 감기는 기분이 아니라 눈 상태다. 여기 섞으면 헷갈린다.
            list.filter(e => e.key !== 'neutral' && e.is_reply_emotion !== false)
                .forEach(e => {
                const m = document.createElement('div');
                m.className = 'm';
                m.dataset.key = e.key;
                m.title = e.label;
                moodBars.appendChild(m);
            });
        }

        function setMood(key) {
            const list = (ENTITY && ENTITY.expressions) || [];
            const found = list.find(e => e.key === key);
            const color = MOOD_COLOR[key] || '#8f93b8';

            moodDot.style.background = color;
            moodLabel.textContent = found ? found.label : (key || '평온');

            moodBars.querySelectorAll('.m').forEach(m => {
                const on = m.dataset.key === key;
                m.style.background = on ? (MOOD_COLOR[m.dataset.key] || '#8f93b8')
                                        : '#262a4a';
                m.style.opacity = on ? '1' : '0.5';
            });
        }

        // ------------------------------------------------------------
        // 대답하지 않을 때
        //
        // 사이가 바닥까지 떨어지면 다이아는 입을 닫는다.
        // 서버가 모델을 아예 부르지 않으므로 할 말 자체가 없다.
        // 화면은 그걸 '고장'이 아니라 '침묵'으로 보여줘야 한다.
        // ------------------------------------------------------------

        function silenceCfg() {
            return (ENTITY && ENTITY.relationship
                && ENTITY.relationship.silence) || {};
        }

        function showSilence(expression) {
            const conf = silenceCfg();

            // 대화창에는 아무것도 남기지 않는다.
            // 말풍선의 점과 돌아선 몸이면 충분하다 —
            // '(대답이 없다)'라고 굳이 적으면 설명하는 꼴이 된다.
            applyExpression(expression || 'angry');

            // 말풍선에는 점만 잠깐 띄운다. 립싱크는 하지 않는다.
            speechBubble.innerText = conf.note || '…';
            speechBubble.style.display = 'block';

            if (bubbleHideTimer) clearTimeout(bubbleHideTimer);
            bubbleHideTimer = setTimeout(() => {
                speechBubble.style.display = 'none';
            }, 1800);

            // 고개를 돌려 버린다. 잠시 그대로 둔다.
            roam.state = 'idle';
            roam.wait = 5;
            faceUrgency = 0;
            sulkTimer = 5;
            roam.yaw = 0.55;
            playMotion('idle');

            startInactivityTimers();
        }


        // 지금 호감도로 어디를 만질 수 있는지.
        // 사이가 깊어질수록 열리는 곳이 늘어난다.
        function updateTouchZones() {
            const box = document.getElementById('touch-zones');
            if (!box || !ENTITY || !ENTITY.touch) return;

            const zones = ENTITY.touch.zones || [];
            const aff = (typeof myAffinity === 'number') ? myAffinity : 0;

            // 이름을 내지 않기로 한 자리는 목록에서 뺀다
            box.innerHTML = zones.filter(z => !z.hidden && z.label).map(z => {
                const open = (z.allow_from === null || z.allow_from === undefined)
                    ? true : aff >= z.allow_from;
                return open
                    ? '<b>' + z.label + '</b>'
                    : '<i>' + z.label + '</i>';
            }).join(' · ');
        }

        function refreshRelationship() {
            fetch('/api/relationship')
                .then(r => r.json())
                .then(d => {
                    if (typeof d.affinity !== 'number') return;
                    myAffinity = d.affinity;
                    myStageKey = d.stage || null;

                    myLover.yes = !!d.lover;
                    if (typeof d.ceiling === 'number') {
                        myLover.ceiling = d.ceiling;
                    }

                    if (typeof d.mood === 'number') {
                        myMood.level = d.mood;
                        myMood.label = d.mood_label || null;
                        myMood.expression = d.mood_expression || null;
                    }

                    // 같은 친구라도 오늘은 어떤 온도인가
                    myWarmth = d.warmth || null;

                    buildAffinityMarks();
                    setAffinity(d.affinity, d.label);
                    buildToolMenu();
                    updateTouchZones();
                })
                .catch(() => {});
        }


