/* ============================================================
 * 다이아의 목소리로 노래하기
 *
 * 말하는 목소리(TTS)는 음정을 얹을 수 없다. 노래는 말이 아니라
 * **소리를 처음부터 만드는 일**이라서 따로 짓는다.
 *
 * 만드는 법은 사람의 목과 같다.
 *
 *   성대  — 일정한 높이로 떨리는 파형 (음정이 여기서 나온다)
 *   입안  — 그 떨림 중 몇몇 높이만 남기는 울림통 (모음이 여기서 나온다)
 *   혀·입술 — 소리를 끊고 터뜨리는 곳 (자음이 여기서 나온다)
 *
 * 울림통의 봉우리를 포르만트라 한다. 'ㅏ' 와 'ㅣ' 는 성대가 똑같이
 * 떨려도 봉우리 자리가 달라서 다르게 들린다. 그 자리만 정확하면
 * 사람은 글자를 알아듣는다 — 목소리를 녹음해 두지 않아도 된다.
 *
 * 보컬로이드가 맑고 기계처럼 들리는 이유도 여기 있다. 사람 목은
 * 봉우리가 늘 흔들리는데 계산으로 만든 것은 안 흔들린다. 그래서
 * 일부러 조금 흔들어 둔다(비브라토).
 *
 * 음원 파일도, 바깥 서비스도 쓰지 않는다. 전부 브라우저가 만든다.
 * ============================================================ */

(function (global) {
    'use strict';

    // --------------------------------------------------------
    // 한글 쪼개기
    //
    // 가 = ㄱ + ㅏ,  강 = ㄱ + ㅏ + ㅇ
    // 유니코드가 이 순서로 줄지어 있어서 나눗셈으로 갈린다.
    // --------------------------------------------------------

    const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
                 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

    const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ',
                  'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ',
                  'ㅣ'];

    const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ',
                  'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ',
                  'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

    function splitHangul(ch) {
        const code = ch.charCodeAt(0) - 0xAC00;

        if (code < 0 || code > 11171) return null;

        return {
            cho: CHO[Math.floor(code / 588)],
            jung: JUNG[Math.floor((code % 588) / 28)],
            jong: JONG[code % 28],
        };
    }

    // --------------------------------------------------------
    // 모음의 봉우리 자리 (Hz)
    //
    // [F1, F2, F3] — 한국어 여성 화자의 실측 범위를 바탕으로 잡았다.
    // F1 은 입을 벌린 정도, F2 는 혀의 앞뒤다.
    //
    //   ㅏ 입을 크게  -> F1 높다
    //   ㅣ 혀가 앞    -> F2 높다
    //   ㅜ 혀가 뒤    -> F2 낮다
    // --------------------------------------------------------

    const VOWEL = {
        'ㅏ': [ 900, 1500, 2900 ],
        'ㅓ': [ 650, 1250, 2700 ],
        'ㅗ': [ 500,  900, 2700 ],
        'ㅜ': [ 380,  850, 2600 ],
        'ㅡ': [ 400, 1600, 2600 ],
        'ㅣ': [ 320, 2600, 3300 ],
        'ㅐ': [ 700, 2000, 2900 ],
        'ㅔ': [ 550, 2200, 2950 ],
    };

    // 겹모음은 앞에 짧은 반모음이 붙는 것뿐이다.
    //   ㅑ = ㅣ(짧게) + ㅏ,   ㅘ = ㅜ(짧게) + ㅏ
    // 그래서 표를 스물한 줄 적지 않고 앞소리만 따로 적는다.
    const GLIDE = {
        'ㅑ': ['ㅣ', 'ㅏ'], 'ㅕ': ['ㅣ', 'ㅓ'], 'ㅛ': ['ㅣ', 'ㅗ'],
        'ㅠ': ['ㅣ', 'ㅜ'], 'ㅒ': ['ㅣ', 'ㅐ'], 'ㅖ': ['ㅣ', 'ㅔ'],
        'ㅘ': ['ㅜ', 'ㅏ'], 'ㅝ': ['ㅜ', 'ㅓ'], 'ㅙ': ['ㅜ', 'ㅐ'],
        'ㅞ': ['ㅜ', 'ㅔ'], 'ㅚ': ['ㅜ', 'ㅔ'], 'ㅟ': ['ㅜ', 'ㅣ'],
        'ㅢ': ['ㅡ', 'ㅣ'],
    };

    function vowelOf(jung) {
        if (VOWEL[jung]) return [null, jung];
        return GLIDE[jung] || [null, 'ㅏ'];
    }

    // --------------------------------------------------------
    // 자음
    //
    // 소리를 내는 방식으로 나눈다. 글자 하나하나를 흉내 내지 않는다 —
    // 노래에서는 자음이 20~40ms 스쳐 갈 뿐이라 방식만 맞으면 들린다.
    //
    //   stop  터짐  ㄱㄷㅂㅋㅌㅍ    앞을 막았다 터뜨린다
    //   affr  붙갈이 ㅈㅊ            막았다 갈아 낸다
    //   fric  갈이  ㅅㅆㅎ          바람이 새어 나간다
    //   nasal 콧소리 ㄴㅁ            코로 울린다
    //   lat   흐름  ㄹ              혀가 스친다
    //   none  없음  ㅇ              초성 ㅇ 은 소리가 아니다
    // --------------------------------------------------------

    const CONS = {
        'ㄱ': { type: 'stop',  dur: 0.030, cut: 0.020, hz: 1800, gain: 0.25 },
        'ㄲ': { type: 'stop',  dur: 0.035, cut: 0.035, hz: 1900, gain: 0.35 },
        'ㅋ': { type: 'stop',  dur: 0.055, cut: 0.030, hz: 2000, gain: 0.40 },
        'ㄷ': { type: 'stop',  dur: 0.028, cut: 0.018, hz: 2800, gain: 0.25 },
        'ㄸ': { type: 'stop',  dur: 0.032, cut: 0.032, hz: 3000, gain: 0.35 },
        'ㅌ': { type: 'stop',  dur: 0.050, cut: 0.028, hz: 3100, gain: 0.40 },
        'ㅂ': { type: 'stop',  dur: 0.026, cut: 0.018, hz:  900, gain: 0.22 },
        'ㅃ': { type: 'stop',  dur: 0.030, cut: 0.030, hz:  950, gain: 0.32 },
        'ㅍ': { type: 'stop',  dur: 0.048, cut: 0.026, hz: 1000, gain: 0.38 },

        'ㅈ': { type: 'affr',  dur: 0.045, cut: 0.016, hz: 2600, gain: 0.28 },
        'ㅉ': { type: 'affr',  dur: 0.050, cut: 0.030, hz: 2700, gain: 0.36 },
        'ㅊ': { type: 'affr',  dur: 0.065, cut: 0.026, hz: 2800, gain: 0.40 },

        'ㅅ': { type: 'fric',  dur: 0.070, cut: 0.000, hz: 5200, gain: 0.30 },
        'ㅆ': { type: 'fric',  dur: 0.085, cut: 0.000, hz: 5400, gain: 0.40 },
        'ㅎ': { type: 'fric',  dur: 0.045, cut: 0.000, hz: 1600, gain: 0.16 },

        'ㄴ': { type: 'nasal', dur: 0.045, cut: 0.000, hz:  300, gain: 0.55 },
        'ㅁ': { type: 'nasal', dur: 0.050, cut: 0.000, hz:  260, gain: 0.55 },

        'ㄹ': { type: 'lat',   dur: 0.035, cut: 0.000, hz:  480, gain: 0.60 },

        'ㅇ': { type: 'none',  dur: 0.000, cut: 0.000, hz:    0, gain: 0.00 },
    };

    // 받침. 음표 끝에 붙어 소리를 닫는다.
    //
    // 겹받침은 앞것만 낸다 — 노래에서는 그게 들리는 소리다.
    const JONG_SOUND = {
        'ㄴ': 'nasal_n', 'ㅁ': 'nasal_m', 'ㅇ': 'nasal_ng',
        'ㄹ': 'lat',
        'ㄱ': 'stop', 'ㄲ': 'stop', 'ㅋ': 'stop',
        'ㄷ': 'stop', 'ㅅ': 'stop', 'ㅆ': 'stop', 'ㅈ': 'stop',
        'ㅊ': 'stop', 'ㅌ': 'stop', 'ㅎ': 'stop',
        'ㅂ': 'stop', 'ㅍ': 'stop',
        'ㄳ': 'stop', 'ㄵ': 'nasal_n', 'ㄶ': 'nasal_n', 'ㄺ': 'lat',
        'ㄻ': 'lat', 'ㄼ': 'lat', 'ㄽ': 'lat', 'ㄾ': 'lat', 'ㄿ': 'lat',
        'ㅀ': 'lat', 'ㅄ': 'stop',
    };

    const NASAL_F = {
        nasal_n:  [ 300, 1700, 2600 ],
        nasal_m:  [ 260, 1100, 2400 ],
        nasal_ng: [ 280, 2200, 2700 ],
        lat:      [ 400, 1100, 2800 ],
    };

    // --------------------------------------------------------
    // 음 높이
    //
    // 미디 번호로 적는다. 60 이 가운데 도다.
    // --------------------------------------------------------

    function midiToHz(m) {
        return 440 * Math.pow(2, (m - 69) / 12);
    }

    // --------------------------------------------------------
    // 가사 -> 부를 낱소리
    //
    // 한글이 아닌 글자(쉼표·물음표·영문)는 버린다. 띄어쓰기는
    // 숨자리로 쓴다 — 말 그대로 숨을 쉬는 것이 아니라, 그 앞
    // 음절을 조금 길게 끌어 마디가 지게 한다.
    // --------------------------------------------------------

    function parseLyric(text) {
        const out = [];
        const s = String(text || '');

        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            const p = splitHangul(ch);

            if (!p) {
                // 띄어쓰기는 앞 음절에 '마디 끝' 표를 단다
                if (/\s/.test(ch) && out.length) out[out.length - 1].breath = true;
                continue;
            }

            const [glide, vowel] = vowelOf(p.jung);

            out.push({
                ch: ch,
                cons: p.cho,
                glide: glide,
                vowel: vowel,
                jong: p.jong ? (JONG_SOUND[p.jong] || null) : null,
                breath: false,
            });
        }

        return out;
    }


    // ========================================================
    // 합성기
    // ========================================================

    class Singer {

        constructor(ctx, opts) {
            const o = opts || {};

            this.ctx = ctx;

            // 목소리의 바탕 음색
            this.tone = {
                // 성대 파형. 'saw' 가 사람 목에 가깝고 'square' 가
                // 더 기계처럼 맑다. 보컬로이드 쪽은 square 가 가깝다.
                wave: o.wave || 'sawtooth',
                // 봉우리 셋의 날카로움. 높을수록 글자가 또렷하고
                // 낮을수록 부드럽다.
                q: [o.q1 || 9, o.q2 || 11, o.q3 || 13],
                // 봉우리마다의 크기
                amp: [1.0, 0.55, 0.22],
                // 숨소리 섞기
                breath: (o.breath == null) ? 0.05 : o.breath,
                // 떨림
                vibHz: o.vibHz || 5.5,
                vibCent: (o.vibCent == null) ? 28 : o.vibCent,
                vibDelay: (o.vibDelay == null) ? 0.22 : o.vibDelay,
                // 온몸의 크기
                gain: (o.gain == null) ? 0.5 : o.gain,
            };

            this.out = ctx.createGain();
            this.out.gain.value = this.tone.gain;

            // 노래는 방 안에서 부른다. 마른 소리는 기계 소리로만
            // 들린다 — 짧은 울림을 더하면 그 자리에 있는 것이 된다.
            this.wet = ctx.createGain();
            this.wet.gain.value = (o.reverb == null) ? 0.22 : o.reverb;

            const conv = ctx.createConvolver();
            conv.buffer = makeRoom(ctx, o.roomSec || 1.1, o.roomDecay || 2.6);

            this.out.connect(conv);
            conv.connect(this.wet);

            this.nodes = [];       // 지금 울리고 있는 것들
            this.playing = false;
        }

        connect(dest) {
            this.out.connect(dest);
            this.wet.connect(dest);
            return this;
        }

        stop() {
            this.playing = false;

            for (const n of this.nodes) {
                try { n.stop(); } catch (e) { /* 이미 멈춘 것 */ }
            }

            this.nodes = [];
        }

        // ----------------------------------------------------
        // 한 음절
        //
        // t0   : 시작 시각
        // dur  : 길이(초)
        // midi : 음 높이
        // ----------------------------------------------------

        _syllable(syl, t0, dur, midi, nextMidi) {
            const ctx = this.ctx;
            const T = this.tone;

            const c = CONS[syl.cons] || CONS['ㅇ'];

            // 자음이 앞을 먹는다. 모음은 그만큼 늦게 시작한다.
            const consDur = c.type === 'none' ? 0 : c.dur;
            const vStart = t0 + consDur;
            const vDur = Math.max(0.06, dur - consDur);

            // ---- 성대 ----
            const osc = ctx.createOscillator();
            osc.type = T.wave;

            const hz = midiToHz(midi);
            osc.frequency.setValueAtTime(hz, vStart);

            // 떨림. 음을 낸 직후에는 없다가 서서히 커진다 —
            // 처음부터 떨면 취한 것처럼 들린다.
            if (T.vibCent > 0 && vDur > T.vibDelay + 0.1) {
                const lfo = ctx.createOscillator();
                const lg = ctx.createGain();

                lfo.frequency.value = T.vibHz;
                // 센트를 Hz 로: 1센트는 비율 2^(1/1200)
                const depth = hz * (Math.pow(2, T.vibCent / 1200) - 1);

                lg.gain.setValueAtTime(0, vStart);
                lg.gain.setValueAtTime(0, vStart + T.vibDelay);
                lg.gain.linearRampToValueAtTime(depth, vStart + T.vibDelay + 0.18);

                lfo.connect(lg);
                lg.connect(osc.frequency);
                lfo.start(vStart);
                lfo.stop(t0 + dur + 0.05);
                this.nodes.push(lfo);
            }

            // 다음 음으로 미끄러진다. 사람은 음을 뚝 끊어 바꾸지 않는다.
            if (nextMidi != null && nextMidi !== midi) {
                const slide = Math.min(0.055, vDur * 0.3);
                osc.frequency.setValueAtTime(hz, t0 + dur - slide);
                osc.frequency.linearRampToValueAtTime(
                    midiToHz(nextMidi), t0 + dur);
            }

            // ---- 소리의 크기 ----
            const env = ctx.createGain();
            const atk = Math.min(0.035, vDur * 0.25);
            const rel = Math.min(0.09, vDur * 0.35);

            env.gain.setValueAtTime(0, vStart);
            env.gain.linearRampToValueAtTime(1.0, vStart + atk);
            env.gain.setValueAtTime(1.0, vStart + vDur - rel);
            env.gain.linearRampToValueAtTime(0.0001, vStart + vDur);

            osc.connect(env);

            // ---- 울림통(모음) ----
            //
            // 봉우리 셋을 나란히 두고 합친다. 겹모음이면 앞
            // 반모음에서 제 모음으로 봉우리를 옮긴다 — 그 미끄러짐이
            // 'ㅑ' 를 'ㅣㅏ' 로 들리게 한다.
            const want = VOWEL[syl.vowel] || VOWEL['ㅏ'];
            const from = syl.glide ? (VOWEL[syl.glide] || want) : want;

            const mix = ctx.createGain();
            mix.gain.value = 1;

            for (let k = 0; k < 3; k++) {
                const bp = ctx.createBiquadFilter();
                bp.type = 'bandpass';
                bp.Q.value = T.q[k];

                const glideEnd = vStart + Math.min(0.09, vDur * 0.35);

                bp.frequency.setValueAtTime(from[k], vStart);

                if (syl.glide) {
                    bp.frequency.linearRampToValueAtTime(want[k], glideEnd);
                }

                // 받침이 있으면 끝에서 코·혀 쪽으로 옮겨 간다.
                if (syl.jong && NASAL_F[syl.jong]) {
                    const nf = NASAL_F[syl.jong];
                    const jStart = vStart + vDur * 0.7;
                    bp.frequency.setValueAtTime(want[k], jStart);
                    bp.frequency.linearRampToValueAtTime(nf[k], vStart + vDur);
                }

                const g = ctx.createGain();
                g.gain.value = T.amp[k];

                env.connect(bp);
                bp.connect(g);
                g.connect(mix);
            }

            // 낮은 쪽이 비면 소리가 얇다. 원래 파형을 조금 섞어 채운다.
            const body = ctx.createGain();
            body.gain.value = 0.12;
            const lp = ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 700;
            env.connect(lp);
            lp.connect(body);
            body.connect(mix);

            mix.connect(this.out);

            osc.start(vStart);
            osc.stop(vStart + vDur + 0.02);
            this.nodes.push(osc);

            // ---- 숨소리 ----
            if (T.breath > 0) {
                const nz = this._noise(vStart, vDur, 'bandpass', want[1], 1.2,
                                       T.breath);
                if (nz) this.nodes.push(nz);
            }

            // ---- 자음 ----
            if (c.type !== 'none') this._consonant(c, t0, consDur);

            // ---- 받침의 닫는 소리 ----
            //
            // 봉우리는 이미 옮겨 놨다. 여기서는 터지는 받침만
            // 짧게 끊어 준다.
            if (syl.jong === 'stop') {
                // 소리를 살짝 먼저 끊는다. 'ㄱ' 받침은 닫히는 소리다.
                env.gain.cancelScheduledValues(vStart + vDur - rel);
                env.gain.setValueAtTime(1.0, vStart + vDur - rel);
                env.gain.linearRampToValueAtTime(0.0001,
                    vStart + vDur - rel * 0.4);
            }
        }

        // 바람 소리 한 조각
        _noise(t0, dur, filt, hz, q, gain) {
            const ctx = this.ctx;
            const len = Math.max(1, Math.ceil(ctx.sampleRate * (dur + 0.02)));
            const buf = ctx.createBuffer(1, len, ctx.sampleRate);
            const d = buf.getChannelData(0);

            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

            const src = ctx.createBufferSource();
            src.buffer = buf;

            const f = ctx.createBiquadFilter();
            f.type = filt;
            f.frequency.value = hz;
            f.Q.value = q;

            const g = ctx.createGain();
            g.gain.setValueAtTime(0, t0);
            g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.01, dur * 0.3));
            g.gain.setValueAtTime(gain, t0 + dur * 0.7);
            g.gain.linearRampToValueAtTime(0.0001, t0 + dur);

            src.connect(f);
            f.connect(g);
            g.connect(this.out);

            src.start(t0);
            src.stop(t0 + dur + 0.02);

            return src;
        }

        _consonant(c, t0, dur) {
            if (c.type === 'nasal' || c.type === 'lat') {
                // 울리는 자음은 바람이 아니라 낮은 떨림이다.
                // 모음이 곧 이어지므로 아주 짧게만 낸다.
                return;
            }

            // 터짐·갈이는 바람이다. 터짐은 앞에 빈틈(cut)이 있다.
            const start = t0 + (c.cut || 0);
            const d = Math.max(0.012, dur - (c.cut || 0));

            const n = this._noise(start, d,
                c.type === 'fric' ? 'highpass' : 'bandpass',
                c.hz, c.type === 'fric' ? 0.7 : 1.4, c.gain);

            if (n) this.nodes.push(n);
        }

        // ----------------------------------------------------
        // 한 줄을 부른다
        //
        //   lyric : 가사 한 줄
        //   notes : [{midi, beats}] — 서버가 준다
        //   bpm   : 빠르기
        //
        // 음표가 음절보다 적으면 앞에서부터 다시 쓴다. 많으면 남는
        // 것은 버린다. 가사 길이를 미리 맞추라고 시키지 않기 위해서다 —
        // 다이아는 노래를 지어 부르지 악보를 채우는 것이 아니다.
        // ----------------------------------------------------

        sing(lyric, notes, opts) {
            const o = opts || {};
            const ctx = this.ctx;
            const bpm = o.bpm || 92;
            const beat = 60 / bpm;

            const syls = parseLyric(lyric);

            if (!syls.length) return { duration: 0, marks: [] };

            const t0 = (o.at != null) ? o.at : ctx.currentTime + 0.06;

            let t = t0;
            const marks = [];

            this.playing = true;

            for (let i = 0; i < syls.length; i++) {
                const nt = notes[i % notes.length];
                const nxt = (i + 1 < syls.length)
                    ? notes[(i + 1) % notes.length] : null;

                let dur = (nt.beats || 1) * beat;

                // 마디 끝은 조금 끈다
                if (syls[i].breath) dur *= 1.35;

                this._syllable(syls[i], t, dur, nt.midi,
                               nxt ? nxt.midi : null);

                marks.push({ at: t - t0, ch: syls[i].ch, dur: dur });

                t += dur;
            }

            return { duration: t - t0, marks: marks, startedAt: t0 };
        }
    }

    // --------------------------------------------------------
    // 방의 울림
    //
    // 잡음이 사그라드는 꼴을 그대로 쓴다. 짧은 방이면 이것으로 충분하다.
    // --------------------------------------------------------

    function makeRoom(ctx, sec, decay) {
        const len = Math.max(1, Math.floor(ctx.sampleRate * sec));
        const buf = ctx.createBuffer(2, len, ctx.sampleRate);

        for (let c = 0; c < 2; c++) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < len; i++) {
                d[i] = (Math.random() * 2 - 1) *
                       Math.pow(1 - i / len, decay);
            }
        }

        return buf;
    }

    global.DiaSinger = {
        Singer: Singer,
        splitHangul: splitHangul,
        parseLyric: parseLyric,
        midiToHz: midiToHz,
        VOWEL: VOWEL,
    };

})(typeof window !== 'undefined' ? window : globalThis);
