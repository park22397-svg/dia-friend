// system/chat.js — 대화 — 기억 삭제·메시지 보내기
// (시스템. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 기억 삭제
        // ============================================================

        async function handleMemoryDeleteCommand(text) {

            if (
                text !== '/기억삭제' &&
                text !== '/기억 초기화'
            ) {

                return false;
            }


            /*
             * 현재 Flask에 /api/memory/clear가 없다면
             * 서버에서 404가 발생한다.
             *
             * 따라서 이 명령어는 Flask API를 추가한 후
             * 실제 기억 삭제가 실행된다.
             */

            try {

                const res =
                    await fetch(
                        '/api/memory/clear',
                        {
                            method: 'POST'
                        }
                    );


                const data =
                    await res.json();


                if (res.ok) {

                    appendMessage(
                        'ai',
                        data.message ||
                        '기억을 초기화했어!'
                    );

                } else {

                    appendMessage(
                        'ai',
                        data.error ||
                        '기억 삭제에 실패했어.'
                    );
                }

            } catch (error) {

                console.error(
                    '기억 삭제 오류:',
                    error
                );


                appendMessage(
                    'ai',
                    '기억 삭제 서버와 연결할 수 없어.'
                );
            }


            return true;
        }


        // ============================================================
        // 메시지 전송
        // ============================================================

                async function sendMessage() {

            if (isWaitingForAI) {

                return;
            }


            let text =
                chatInput.value.trim();


            if (!text) {

                return;
            }


            chatInput.value = '';


            // 말을 걸었다. 돌아다니던 중이면 멈추고 이쪽을 본다.
            faceUser();


            // --------------------------------------------------------
            // 명령어 처리
            // --------------------------------------------------------

            if (
                handleExpressionCommand(text)
            ) {

                return;
            }


            if (
                handleHelpCommand(text)
            ) {

                return;
            }


            if (
                handleBackgroundCommand(text)
            ) {

                return;
            }


            if (
                handleClothCommand(text)
            ) {

                return;
            }


            if (
                handleAffinityCommand(text)
            ) {

                return;
            }


            if (
                handleVoiceCommand(text)
            ) {

                return;
            }




            // 아이 — 시험용
            if (
                handleChildCommand(text)
            ) {

                return;
            }


            // 기억을 치워 두거나 되찾는다
            if (
                handleMemoryCommand(text)
            ) {

                return;
            }


            // 판이 끝나고 다이아가 "한 판 더 할래?" 라고 물은 뒤라면
            // 이 말을 그 답으로 먼저 읽는다. 그래 → 새 판, 그만 → 닫기.
            // 딴 이야기면 아래로 흘려보낸다.
            if (
                await handleAgainAnswer(text)
            ) {

                return;
            }


            // 체스하자고 하면 판을 연다.
            //
            // 예전에는 단추를 가리키기만 했다. 놀자고 말했는데 단추를
            // 찾으라고 하면 한 박자 끊긴다. 열자마자 선공을
            // 가위바위보로 정한다.
            if (
                handleChessCommand(text)
            ) {

                return;
            }


            // 오목·할리갈리·장기도 같은 길로 연다.
            //
            // 이 길이 없어서 하자고 말해도 판이 안 열리고 모델이 말로만
            // 받았다. "다시 하자" 처럼 이름을 안 대도 방금 둔 판을 연다.
            if (
                handleGameCommand(text)
            ) {

                return;
            }


            // 가위바위보는 모델에게 묻지 않고 바로 단추를 가리킨다
            if (
                handleRpsCommand(text)
            ) {

                return;
            }


            // /쑥스러움 처럼 동작 이름을 바로 부르는 것
            if (
                handleMotionCommand(text)
            ) {

                return;
            }


            if (
                await handleMemoryDeleteCommand(text)
            ) {

                return;
            }


            // --------------------------------------------------------
            // 일반 대화
            // --------------------------------------------------------

            const wasSleeping =
                isSleeping;


            wakeUp();

            appendMessage(
                'user',
                text
            );

            resetTimers();


            if (wasSleeping) {

                // 얼굴은 여기서 정하지 않는다.
                //
                // 예전에는 여기서 곧바로 놀라게 했는데, 모델이 답을
                // 내놓기까지 8초가 걸리는 동안 그 얼굴로 굳어 있었다.
                // **깨울 때 놀라는 것은 이제 아예 없앴다** — 자기를
                // 부르는 사람에게 놀랄 이유가 없다.
                // 지금은 눈만 뜨고(wakeUp) 기다린다.

                // 대신 눈을 감은 얼굴로 기다린다.
                //
                // 답이 오기까지 얼굴이 비어 있으면, 깨웠는데 아무 일도
                // 안 일어난 것처럼 보인다. (잠결 얼굴은 옛 아바타 수치라
                // 지웠다 — 배합기에서 다시 만들면 여기로 돌려놓을 것)
                applyExpression('eyes_closed');

                // 이모지도 지정하지 않는다.
                // 😲 를 쓰라고 시키면 그것이 답변에 실려 오고, 서버가
                // 놀람 신호로 걷어낸 뒤 화면이 기지개·손인사 도중에
                // 되살린다. 웃으며 기지개를 켜다 놀란 얼굴이 됐다.
                // 어떤 얼굴로 깰지는 사이가 정할 일이다.

                text = text + " (상황 참고: 다이아는 자고 있다가 방금 상대가 깨워서 막 눈을 떴어. 과한 비명이나 호들갑은 절대 금지하고, 막 잠에서 깬 사람답게 차분하게 이야기를 이어가줘.)";
            }


            // AI 응답 중복 요청 방지
            isWaitingForAI = true;

            sendButton.disabled = true;


            try {

                const res =
                    await fetch(
                        '/api/chat',
                        {
                            method: 'POST',

                            headers: {
                                'Content-Type':
                                    'application/json'
                            },

                            body: JSON.stringify({
                                message: text,

                                // 카메라가 켜져 있으면 지금 보이는 것도
                                // 같이 보낸다. 그래야 평범한 대화가
                                // '나를 보면서 하는 말' 이 된다.
                                seeing: seeingNow(),

                                // 방금 말하던 것을 끊고 들어왔는가.
                                // 아무 일 없었던 것처럼 이어 말하면
                                // 끊긴 티가 안 난다.
                                cut_off: (function () {
                                    const c = wasCutOff;
                                    wasCutOff = false;
                                    return c;
                                })(),

                                // 자고 있다가 이 말에 깨어났는가.
                                //
                                // 서버는 다이아가 자는지 몰랐다. 그래서
                                // 깨우면 시간만 보고 **자기가 상대를 깨운
                                // 줄 알고 사과했다.** 누가 깨웠는지는
                                // 화면만 아는 것이므로 같이 보낸다.
                                woke: wasSleeping
                            })
                        }
                    );


                if (!res.ok) {

                    throw new Error(
                        `HTTP ${res.status}`
                    );
                }


                const data =
                    await res.json();


                if (
                    !data ||
                    typeof data.reply !== 'string'
                ) {

                    throw new Error(
                        '잘못된 API 응답'
                    );
                }


                // 끝말잇기가 켜져 있는지. 끝말잇기를 하자는 말을
                // 선공 가위바위보로 받을지 이것으로 정한다.
                if (typeof data.word_chain_on === 'boolean') {
                    wcOn = data.word_chain_on;
                }

                // 끝말잇기가 이 말로 끝나 한 판 더 할지 물었다
                if (data.again) setAgain(data.again);


                if (data.silent) {

                    // 입을 닫았다. 말풍선도 립싱크도 없다.
                    // 다만 아무 일도 안 일어나면 고장 난 것처럼 보이므로
                    // 표정과 짧은 표시만 남긴다.
                    showSilence(data.expression || 'angry');

                } else {

                    // 자다 깼을 때. 사이가 얼마나 깊은지로 갈린다.
                    //
                    //   낮으면  그냥 눈을 뜨고 대화한다.
                    //   보통    기쁨 + 기지개로 잠을 털고 이야기를 시작한다.
                    //   깊으면  기지개를 켠 뒤 손을 흔들며 반긴다.
                    //
                    // **깨울 때 놀라는 것은 없앴다.** 매번 깨울 때마다
                    // 놀란 얼굴이 스치는 것이 어색했다. 자기를 부르는
                    // 사람에게 놀랄 이유가 없다. 놀람은 부끄러울 때와
                    // 진짜로 놀랐을 때만 남는다.
                    const wake = wasSleeping;

                    const wk = (ENTITY && ENTITY.behavior
                        && ENTITY.behavior.wake) || {};

                    // 호감은 이번 답변에 실려 온 값을 쓴다.
                    //
                    // 화면이 들고 있던 값(myAffinity)은 이 창을 띄운 뒤로
                    // 갱신이 안 됐을 수 있다. 창을 여러 개 열어 두고 다른
                    // 창에서 사이가 달라지면, 이 창은 옛 숫자로 판단한다.
                    // 실제로 호감 0 인데 기지개를 켜는 일이 있었다.
                    const aff = (data.relationship
                        && typeof data.relationship.affinity === 'number')
                        ? data.relationship.affinity
                        : ((typeof myAffinity === 'number') ? myAffinity : 0);

                    // 기지개는 친구부터. 잠을 털며 일어난다.
                    const stretches = aff >= (typeof wk.stretch_from === 'number'
                        ? wk.stretch_from : 40);

                    const warm = aff >= (typeof wk.warm_from === 'number'
                        ? wk.warm_from : 160);

                    const finalFace = wake
                        ? (stretches ? 'joy' : 'neutral')
                        : (data.expression || 'neutral');

                    // 다이아의 마음. 말을 마친 뒤 얼굴이 이것을 따라간다.
                    takeHeart(data.feel);

                    if (typeof data.mood === 'number') {
                        myMood.level = data.mood;
                    }
                    if (typeof data.lover === 'boolean') {
                        myLover.yes = data.lover;
                    }

                    // 말하면서 자리를 옮겼으면 배경도 따라간다.
                    // 말보다 먼저 갈아 낀다 — "공원 좋다" 를 카페에서
                    // 말하고 나서 배경이 바뀌면 한 박자 어긋난다.
                    if (data.place) goPlace(data.place);

                    // 다이아가 스스로 갈아입었다.
                    // 서버가 이미 적어 두었으므로 화면만 따라가면 된다.
                    if (data.wear) applyWear(data.wear);

                    // 같이 걷자고 했으면 발이 풀린다. 그만하자면 멈춘다.
                    if (data.walk === 'start') {
                        setWalking(true);
                    } else if (data.walk === 'stop') {
                        setWalking(false);
                    }

                    // 가까이 오라고 했으면 손이 닿는 데까지 온다
                    if (data.approach) setApproach(data.approach);

                    // 노래를 부르기로 했다.
                    //
                    // 말을 먼저 마치고 부른다. 말하면서 부르면 둘 다
                    // 안 들린다 — 소리가 하나뿐이기 때문이다.
                    // 악보는 서버가 짜서 보냈다. 여기서는 그대로 부른다.
                    if (data.song) {
                        const said = spokenPart(data.reply || '');
                        const after = said ? guessSpeakMs(said) + 260 : 140;
                        setTimeout(() => singSong(data.song), after);
                    }

                    // 사진을 찍기로 했다. 말을 마치고 카메라 앞으로 간다.
                    if (data.shoot) {
                        const said = spokenPart(data.reply || '');
                        const after = said ? guessSpeakMs(said) + 320 : 180;
                        setTimeout(() => photoShoot(data.shoot), after);
                    }

                    if (wake) {

                        // 자다 깼을 때는 몸이 먼저고 말이 나중이다.
                        //
                        //   사이가 얕으면  그냥 말하기
                        //   친구 이상      기지개 -> 말하기
                        //   사랑 이상      기지개 -> 손인사하면서 말하기
                        //
                        // 잠은 털고 나서 말한다. 말부터 해 놓고 기지개를 켜면
                        // 말해 놓고 딴짓하는 꼴이 된다.
                        // 다만 인사는 말과 함께 간다 — 사람은 손을 흔들면서 말한다.
                        const talk = (face) => {
                            showReply(data.reply, face || finalFace, data.cues);
                        };

                        const wave = () => {
                            if (!warm) { talk('joy'); return; }

                            // 손을 흔들면서 말을 시작한다.
                            //
                            // 흔들기를 다 마치고 입을 여는 것보다,
                            // 손이 올라가는 동안 말이 나오는 쪽이 자연스럽다.
                            // 사람은 인사하면서 말한다.
                            roam.state = 'gesture';
                            playMotion('wave');
                            talk('fun');
                        };

                        if (!stretches) {
                            // 기지개도 인사도 없는 사이. 눈만 뜨고 답한다.
                            applyExpression(finalFace);
                            talk();

                        } else {
                            // 기지개를 켤 때는 기쁨으로 못박는다.
                            applyExpression('joy');
                            roam.state = 'gesture';
                            playMotion('stretch');

                            const st = motionByKey('stretch');
                            setTimeout(wave, (st ? st.duration : 2.8) * 1000);
                        }

                    } else {
                        showReply(data.reply, finalFace, data.cues);
                    }

                    // 괄호로 만졌다면 몸도 그에 맞게 움직인다
                    if (data.motion) {
                        roam.state = 'gesture';
                        playMotion(data.motion);
                    }
                }


                // 말 한마디에도 사이는 움직인다. 눈금에 반영한다.
                if (data.relationship &&
                    typeof data.relationship.affinity === 'number') {

                    myAffinity = data.relationship.affinity;
                    myStageKey = data.relationship.stage || myStageKey;

                    setAffinity(
                        data.relationship.affinity,
                        data.relationship.label
                    );

                    buildToolMenu();
                }


            } catch (err) {

                console.error(
                    "채팅 API 호출 오류:",
                    err
                );


                appendMessage(
                    'ai',
                    '앗, AI 서버와 연결이 안 됐어. 잠시 후 다시 말해줘!'
                );


            } finally {

                isWaitingForAI = false;

                sendButton.disabled = false;

            }
        }


