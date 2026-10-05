# Live2D 몸 붙이기

다이아의 몸을 Live2D 모델로 그린다. 3D(VRM) 몸은 보이지 않게 돌고,
Live2D 모델이 매 프레임 그 몸의 표정·입·눈·고개·시선을 따라 그린다.
코드는 `static/js/dia/live2d.js` 하나다.

## 켜고 끄기

| 방법 | 어떻게 |
|---|---|
| 잠깐 보기 | 화면 주소 끝에 `?live2d=/static/live2d/mangnae/mangnae.model3.json` |
| 늘 쓰기 | 서버 띄우기 전에 `$env:DIA_LIVE2D = "/static/live2d/mangnae/mangnae.model3.json"` |
| 끄기 | 주소에 `?live2d=off`, 또는 환경변수를 비운다 → 늘 쓰던 3D 다이아 |

모델 폴더(`.model3.json`·`.moc3`·텍스처·물리·모션)는 `static/live2d/<이름>/` 아래에 통째로 넣는다.
주소는 `/static/live2d/` 로 시작하는 것만 받는다.

## Cubism 에서 망내를 만들 때 맞출 것

### 파라미터 (표준 이름 — 이 이름이면 저절로 붙는다)

| 파라미터 | 무엇이 움직이나 | 다이아 쪽 출처 |
|---|---|---|
| `ParamAngleX` `ParamAngleY` `ParamAngleZ` | 고개 돌림·끄덕임·갸웃 (±30) | 머리 뼈 — 마음의 자세·끄덕임 포함 |
| `ParamBodyAngleX` | 몸 살짝 돌림 | 고개 돌림의 40% |
| `ParamEyeLOpen` `ParamEyeROpen` | 눈 뜨기 (0 감음 ~ 1 뜸) | 깜빡임·윙크·표정 |
| `ParamEyeLSmile` `ParamEyeRSmile` | 눈웃음 | 기쁨·즐거움 |
| `ParamEyeBallX` `ParamEyeBallY` | 눈동자 | 카메라로 찾은 얼굴 쪽 |
| `ParamBrowLY` `ParamBrowRY` | 눈썹 높이 | 기쁨↑ 놀람↑ 슬픔·화남↓ |
| `ParamBrowLAngle` `ParamBrowRAngle` | 눈썹 기울기 | 슬픔(+) 화남(−) |
| `ParamBrowLForm` `ParamBrowRForm` | 눈썹 모양 | 슬픔·화남 |
| `ParamMouthForm` | 입꼬리 (−1 처짐 ~ 1 웃음) | 표정 + 모음(ㅣ·ㅔ 옆으로, ㅜ·ㅗ 오므림) |
| `ParamMouthOpenY` | 입 벌림 | 립싱크 |
| `ParamCheek` | 볼 홍조 | 기쁨·즐거움 |
| `ParamFaceJoy` `ParamFaceFun` `ParamFaceSurprised` `ParamFaceAngry` `ParamFaceSad` | 표정 그림 통째로 얹기 (0~1) | 기쁨·즐거움·놀람·화남·슬픔 |

없는 파라미터는 건너뛴다. 숨(`ParamBreath`)과 머리카락·옷 물리는 모델 쪽 설정이 그대로 돈다.
표정마다 값을 얼마나 줄지는 `live2d.js` 의 `LIVE2D_FACE` 표에 있다.

### 모션 그룹 (몸짓)

다이아가 몸짓을 하면 **같은 이름의 모션 그룹**을 튼다. 없으면 고개·얼굴만 따라간다.

| 그룹 이름 | 몸짓 |
|---|---|
| `Idle` | 가만히 있을 때 (모델이 알아서 돌린다) |
| `wave` | 손인사 |
| `nod` · `shake` | 끄덕임 · 고개 젓기 |
| `cross` | 팔짱 (짜증) |
| `shy` · `cover` | 쑥스러워하기 · 얼굴 가리기 |
| `stretch` | 기지개 |
| `turn_back` | 등 돌리기 |
| `pose_v` · `pose_vv` · `pose_cheek` · `pose_wink` | 브이 · 더블 브이 · 볼에 손 · 윙크 |
| `rps_rock` · `rps_scissors` · `rps_paper` | 가위바위보 손 |
| `sing` | 노래 |

## 아직 안 되는 것

- **만지기**는 보이지 않는 3D 몸의 자리로 판정한다. Live2D 그림과 자리가 어긋날 수 있다.
- **옷장·걷기**는 3D 몸에서만 일어난다 (Live2D 에서는 안 보인다).
- 공식 샘플(Hiyori)로만 검증했다. `static/live2d/sample/` 은 Live2D 무료 소재 라이선스라 저장소에 안 올린다.
- Cubism Core 는 Live2D 사의 것이라 공식 주소에서 불러온다(저장소에 안 싣는다). 인터넷이 없으면 3D 로 돌아간다.
