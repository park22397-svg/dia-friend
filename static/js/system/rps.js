// system/rps.js — 가위바위보 단추
// (시스템. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 가위바위보
        //
        // 무엇을 낼지와 뭐라고 할지는 개체가 정한다.
        // 여기서는 사람이 낸 것을 보내고, 돌아온 대로 보여준다.
        //
        // 동작은 1.35초에 자기 것을 낸다. 결과를 그보다 먼저 말해 버리면
        // 손을 내기도 전에 답이 나와 김이 샌다. 그래서 기다렸다 말한다.
        // ============================================================

        const RPS_REVEAL_MS = 1450;

        const rpsOpen = document.getElementById('rps-open');
        const rpsHands = document.getElementById('rps-hands');

        let rpsBusy = false;

        function buildRps() {
            const hands = (ENTITY && ENTITY.game && ENTITY.game.rps
                && ENTITY.game.rps.hands) || [];

            rpsHands.innerHTML = '';

            hands.forEach(h => {
                const b = document.createElement('button');
                b.innerHTML = h.icon + '<b>' + h.label + '</b>';
                b.title = h.label;
                b.onclick = () => playRps(h.key);
                rpsHands.appendChild(b);
            });
        }

        // ------------------------------------------------------------
        // 옷장 단추
        // ------------------------------------------------------------

        const wearOpen = document.getElementById('wear-open');
        const wearMenu = document.getElementById('wear-menu');

        function buildWearMenu() {
            wearMenu.innerHTML = '';

            if (!wardrobe.length) {
                const cap = document.createElement('div');
                cap.className = 'cap';
                cap.textContent = '옷장이 비어 있다';
                wearMenu.appendChild(cap);
                wearOpen.style.display = 'none';
                return;
            }

            wearOpen.style.display = '';

            // 칸마다 묶어 적는다. 칸이 다르면 같이 걸친다.
            const bySlot = {};
            wardrobe.forEach(it => {
                const k = slotOf(it);
                (bySlot[k] = bySlot[k] || []).push(it);
            });

            (window.__slotOrder || ['outfit', 'glasses', 'hair'])
                .concat(Object.keys(bySlot))
                .filter((v, i, a) => a.indexOf(v) === i)
                .forEach(slot => {
                    const list = bySlot[slot];
                    if (!list || !list.length) return;

                    const cap = document.createElement('div');
                    cap.className = 'cap';
                    cap.textContent = list[0].slot_label || slot;
                    wearMenu.appendChild(cap);

                    const off = document.createElement('button');
                    off.textContent = '벗기';
                    off.className = wornKeyOf(slot) ? '' : 'on';
                    off.onclick = () => { takeOffSlot(slot); closeWearMenu(); };
                    wearMenu.appendChild(off);

                    list.forEach(it => {
                        const b = document.createElement('button');
                        b.textContent = it.label || it.key;
                        b.className = (wornKeyOf(slot) === it.key) ? 'on' : '';
                        b.onclick = () => { wearOutfit(it.key); closeWearMenu(); };
                        wearMenu.appendChild(b);
                    });
                });
        }

        function closeWearMenu() {
            wearMenu.classList.remove('on');
        }

        wearOpen.addEventListener('click', (e) => {
            e.stopPropagation();
            buildWearMenu();
            wearMenu.classList.toggle('on');
        });

        document.addEventListener('click', (e) => {
            if (!wearMenu.classList.contains('on')) return;
            if (wearMenu.contains(e.target) || e.target === wearOpen) return;
            closeWearMenu();
        });

