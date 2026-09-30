// system/look.js — 꾸미기 메뉴
// (시스템. 원래 templates/index.html 안의 스크립트 한 덩어리였다 — 2026-09-30 나눔)
//
// 이 파일들은 <script> 로 차례대로 불러오며 전역을 함께 쓴다. 불러오는 순서는
// index.html 에 적힌 대로이고, 바꾸면 안 된다 — 앞 파일이 불러오는 도중에
// 뒤 파일의 함수를 부르면 멈춘다(_verify_screen.py 가 파일마다 따로 돌려 잡는다).

        // ============================================================
        // 꾸미기 — 눈 색과 화장
        //
        // 옷은 메시를 갈아 끼우지만 눈·화장은 **텍스처를 다시 칠한다.**
        // 색깔마다 텍스처를 구워 두면 눈 한 색이 1MB 다. 원판을
        // 캔버스로 옮겨 그 자리만 고쳐 칠하고 다시 끼운다.
        //
        // **자리는 메시에서 잰다.** 볼이 텍스처의 어디냐는 아바타마다
        // 다르다. 정점마다 3차원 자리와 UV 가 같이 들어 있으므로,
        // 눈과 입의 자리에서 볼을 찾아낼 수 있다. 좌표를 적어 두면
        // 바탕 아바타를 바꾸는 순간 어긋난다.
        // ============================================================

        const lookOpen = document.getElementById('look-open');
        const lookMenu = document.getElementById('look-menu');

        const deco = {
            conf: null,          // 고를 수 있는 것 (서버가 준다)
            now: {},             // 지금 고른 것
            face: null,          // {mat, mesh, tex}  얼굴 살
            iris: null,          // {mat, mesh, tex}  눈동자
            spots: null,         // 얼굴 위의 자리들 (한 번만 잰다)
            boxes: null,         // 눈동자 섬 둘
            busy: false,
        };

        // ------------------------------------------------------------
        // 메시에서 자리 재기
        // ------------------------------------------------------------

        // **프리미티브들이 정점 버퍼를 같이 쓴다.** position 을 통째로
        // 읽으면 얼굴살·눈동자·입이 전부 같은 값을 내놓는다. 그 메시가
        // 실제로 쓰는 정점만 index 로 추려야 한다.
        function usedVerts(geo) {
            if (!geo || !geo.attributes) return null;

            const pos = geo.attributes.position;
            const uv = geo.attributes.uv;
            const nrm = geo.attributes.normal;

            if (!pos || !uv) return null;

            let ids;

            if (geo.index) {
                const seen = new Set();
                const a = geo.index.array;
                for (let i = 0; i < a.length; i++) seen.add(a[i]);
                ids = Array.from(seen);
            } else {
                ids = [];
                for (let i = 0; i < pos.count; i++) ids.push(i);
            }

            const n = ids.length;
            const out = {
                n: n,
                x: new Float32Array(n), y: new Float32Array(n),
                z: new Float32Array(n),
                u: new Float32Array(n), v: new Float32Array(n),
                nz: new Float32Array(n),
            };

            for (let k = 0; k < n; k++) {
                const i = ids[k];
                out.x[k] = pos.getX(i);
                out.y[k] = pos.getY(i);
                out.z[k] = pos.getZ(i);
                out.u[k] = uv.getX(i);
                out.v[k] = uv.getY(i);
                out.nz[k] = nrm ? nrm.getZ(i) : 0;
            }

            return out;
        }

        function lookMeshes() {
            const found = { face: null, iris: null, mouth: null };

            if (!currentVRM) return found;

            currentVRM.scene.traverse(o => {
                if (!o.isMesh && !o.isSkinnedMesh) return;
                if (o.userData && o.userData.bone) return;

                const mats = Array.isArray(o.material) ? o.material : [o.material];

                mats.forEach(mt => {
                    const n = (mt && mt.name) || '';

                    // Body_00_SKIN 도 SKIN 이라 'Face_' 까지 봐야 한다
                    if (/Face_\d+_SKIN/i.test(n) && !found.face) {
                        found.face = { mat: mt, mesh: o };
                    } else if (/EyeIris/i.test(n) && !found.iris) {
                        found.iris = { mat: mt, mesh: o };
                    } else if (/FaceMouth/i.test(n) && !found.mouth) {
                        found.mouth = { mat: mt, mesh: o };
                    }
                });
            });

            return found;
        }

        // 3차원 목표점 둘레의 **앞면** 정점들의 UV 를 거리로 가중 평균
        function uvSpot(V, front, tx, ty, tz, radius) {
            let wu = 0, wv = 0, wsum = 0, hit = 0;

            for (let pass = 0; pass < 2 && hit < 4; pass++) {
                const r = radius * (pass ? 2.0 : 1.0);
                wu = 0; wv = 0; wsum = 0; hit = 0;

                for (let i = 0; i < V.n; i++) {
                    if (!front[i]) continue;

                    const dx = V.x[i] - tx, dy = V.y[i] - ty, dz = V.z[i] - tz;
                    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);

                    if (d >= r) continue;

                    const w = Math.max(1e-3, 1.0 - d / (radius * 2.0));
                    wu += V.u[i] * w;
                    wv += V.v[i] * w;
                    wsum += w;
                    hit++;
                }
            }

            if (hit < 4 || wsum <= 0) return null;

            return { u: wu / wsum, v: wv / wsum, n: hit };
        }

        function measureFace() {
            if (deco.spots) return deco.spots;

            const m = lookMeshes();
            if (!m.face || !m.iris) return null;

            const F = usedVerts(m.face.mesh.geometry);
            const I = usedVerts(m.iris.mesh.geometry);
            if (!F || !I) return null;

            // 눈과 입의 자리
            let ex = 0, exn = 0, ey = 0, ez = 0;

            for (let i = 0; i < I.n; i++) {
                ey += I.y[i];
                ez += I.z[i];
                if (I.x[i] > 0) { ex += I.x[i]; exn++; }
            }

            ey /= I.n;
            ez /= I.n;
            ex = exn ? ex / exn : 0.04;

            let hz = 0, ylo = Infinity, yhi = -Infinity;

            for (let i = 0; i < F.n; i++) {
                hz += F.z[i];
                if (F.y[i] < ylo) ylo = F.y[i];
                if (F.y[i] > yhi) yhi = F.y[i];
            }

            hz /= F.n;

            // 이 모델은 어느 쪽을 보는가 — 눈이 있는 쪽이 앞이다
            const frontSign = (ez < hz) ? -1 : 1;

            const front = new Uint8Array(F.n);
            let frontN = 0;

            for (let i = 0; i < F.n; i++) {
                const ok = (F.nz[i] * frontSign) > 0.15;
                front[i] = ok ? 1 : 0;
                if (ok) frontN++;
            }

            if (frontN < 32) {
                for (let i = 0; i < F.n; i++) front[i] = 1;
            }

            // 입 높이 — 입 메시가 있으면 그것, 없으면 얼굴 상자로 어림
            let my = null;

            if (m.mouth) {
                const M = usedVerts(m.mouth.mesh.geometry);
                if (M) {
                    let s = 0;
                    for (let i = 0; i < M.n; i++) s += M.y[i];
                    my = s / M.n;
                }
            }

            if (my === null || my >= ey) my = ey - (yhi - ylo) * 0.21;

            let zf = frontSign < 0 ? Infinity : -Infinity;

            for (let i = 0; i < F.n; i++) {
                if (frontSign < 0) { if (F.z[i] < zf) zf = F.z[i]; }
                else { if (F.z[i] > zf) zf = F.z[i]; }
            }

            const zFace = zf * 0.62 + hz * 0.38;     // 얼굴 겉면 언저리
            const gap = ey - my;                      // 눈~입 = 얼굴 축척
            const radius = Math.max(gap * 0.62, 0.012);

            const want = {
                cheek_r: [+ex * 1.42, ey - gap * 0.55, zFace],
                cheek_l: [-ex * 1.42, ey - gap * 0.55, zFace],
                eyelid_r: [+ex, ey + gap * 0.24, zFace],
                eyelid_l: [-ex, ey + gap * 0.24, zFace],
                lip: [0, my, zf],
                chin: [0, my - gap * 0.35, zFace],
            };

            const spots = {};

            Object.keys(want).forEach(k => {
                const t = want[k];
                const got = uvSpot(F, front, t[0], t[1], t[2], radius);
                if (got) spots[k] = got;
            });

            if (!spots.cheek_r || !spots.eyelid_r) return null;

            // 얼굴 한 칸 — 눈~입이 텍스처에서 차지하는 세로 길이
            const unit = (spots.chin)
                ? Math.max(0.02, Math.abs(spots.chin.v - spots.eyelid_r.v) / 1.6)
                : 0.10;

            deco.spots = { spots: spots, unit: unit };

            console.log('[diamondAI] 얼굴 자리 잼 — 볼 ('
                + spots.cheek_r.u.toFixed(3) + ', ' + spots.cheek_r.v.toFixed(3)
                + ') · 한 칸 ' + unit.toFixed(4));

            return deco.spots;
        }

        // 눈동자가 텍스처의 어디에 앉아 있는가. 좌우는 정점 x 부호로 가른다.
        function decoIrisBoxes() {
            if (deco.boxes) return deco.boxes;

            const m = lookMeshes();
            if (!m.iris) return null;

            const I = usedVerts(m.iris.mesh.geometry);
            if (!I) return null;

            const out = [];

            [1, -1].forEach(sign => {
                let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, n = 0;

                for (let i = 0; i < I.n; i++) {
                    if (sign > 0 ? !(I.x[i] >= 0) : !(I.x[i] < 0)) continue;
                    n++;
                    if (I.u[i] < u0) u0 = I.u[i];
                    if (I.u[i] > u1) u1 = I.u[i];
                    if (I.v[i] < v0) v0 = I.v[i];
                    if (I.v[i] > v1) v1 = I.v[i];
                }

                if (n >= 8) out.push([u0, v0, u1, v1]);
            });

            if (!out.length) return null;

            deco.boxes = out;
            return out;
        }

        // ------------------------------------------------------------
        // 칠하기
        // ------------------------------------------------------------

        // 원판을 캔버스에 옮긴다. 원래 텍스처는 건드리지 않는다.
        function texCanvas(tex) {
            const img = tex && tex.image;
            if (!img || !img.width) return null;

            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;

            const g = c.getContext('2d', { willReadFrequently: true });
            g.drawImage(img, 0, 0);

            return c;
        }

        // UV 의 v 가 픽셀의 몇 번째 줄인가.
        // glTF 텍스처는 flipY 가 꺼져 있어 v=0 이 맨 윗줄이다.
        function rowOf(v, H, flipY) {
            return (flipY ? (1 - v) : v) * H;
        }

        // 눈동자에 색을 입힌다.
        //
        // 그냥 곱하면 원래 있던 갈색이 안 지워진다. **채도를 죽여
        // 밝기만 남기고** 고른 색을 입힌다. 밝기를 그 눈의 평균으로
        // 나눠 맞추므로 어느 색을 골라도 눈동자 평균이 고른 색이 된다.
        // 림버스 링과 동공은 어두운 채로 남고 반짝이는 흰 쪽으로 간다.
        //
        // **알파는 건드리지 않는다. 알파가 눈동자의 모양이다.**
        function tintIris(canvas, boxes, rgb, alphaMin, flipY) {
            const g = canvas.getContext('2d', { willReadFrequently: true });
            const W = canvas.width, H = canvas.height;

            boxes.forEach(b => {
                const x0 = Math.max(0, Math.floor(b[0] * W));
                const x1 = Math.min(W, Math.ceil(b[2] * W));

                const ra = rowOf(b[1], H, flipY);
                const rb = rowOf(b[3], H, flipY);

                const y0 = Math.max(0, Math.floor(Math.min(ra, rb)));
                const y1 = Math.min(H, Math.ceil(Math.max(ra, rb)));

                if (x1 <= x0 || y1 <= y0) return;

                const im = g.getImageData(x0, y0, x1 - x0, y1 - y0);
                const d = im.data;

                let sum = 0, cnt = 0;

                for (let i = 0; i < d.length; i += 4) {
                    if (d[i + 3] <= alphaMin) continue;
                    sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    cnt++;
                }

                if (!cnt) return;

                const mean = Math.max(8, sum / cnt);

                for (let i = 0; i < d.length; i += 4) {
                    if (d[i + 3] <= alphaMin) continue;

                    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                    const k = lum / mean;

                    for (let c = 0; c < 3; c++) {
                        let out;

                        if (k <= 1) {
                            out = rgb[c] * k;
                        } else {
                            // 밝은 데는 색을 더 진하게 하는 대신 흰 쪽으로.
                            // 안 그러면 반짝이가 원색 덩어리로 뭉친다.
                            const t = 1 - 1 / k;
                            out = rgb[c] + (255 - rgb[c]) * t;
                        }

                        d[i + c] = out < 0 ? 0 : (out > 255 ? 255 : out);
                    }
                }

                g.putImageData(im, x0, y0);
            });
        }

        // 에어브러시 한 겹.
        //
        // 덮어 칠하지 않고 **곱한다.** 살색을 덮으면 뺨의 음영이
        // 사라져 종이처럼 보인다. 곱하면 원래 그늘이 살아 있는 채
        // 붉은 기만 올라온다.
        //
        // 곱할 색은 **흰 쪽으로 당긴다.** 고른 분홍을 그대로 곱하면
        // 초록·파랑이 절반으로 떨어져 광대처럼 시뻘게진다.
        function airbrush(canvas, spot, L, unit, soft, flipY) {
            const g = canvas.getContext('2d', { willReadFrequently: true });
            const W = canvas.width, H = canvas.height;

            const amount = L.amount || 0;
            if (amount <= 0.002) return;

            const rx = Math.max((L.rx || 0.4) * unit, 1 / W);
            const ry = Math.max((L.ry || 0.3) * unit, 1 / H);

            // 잰 자리에서 조금 옮겨 찍고 싶을 때(du·dv, 얼굴 한 칸 기준).
            // 입술이 그렇다 — 입 메시의 한가운데는 입술선보다 위다.
            //
            // **+v 는 아래다.** 위로 올리려면 음수를 준다.
            //
            // du 는 **바깥쪽(귀 쪽)이 +** 다. 왼뺨과 오른뺨은 텍스처에서
            // 서로 반대쪽에 있어서, 같은 부호를 주면 한쪽은 코 쪽으로
            // 간다. 그 자리의 u 가 한가운데(0.5)보다 왼쪽인지 보고 정한다.
            const outward = (spot.u < 0.5) ? -1 : 1;

            const cx = (spot.u + (L.du || 0) * unit * outward) * W;
            const cy = rowOf(spot.v + (L.dv || 0) * unit, H, flipY);

            const px = rx * W, py = ry * H;
            const pad = 1.35;

            const x0 = Math.max(0, Math.floor(cx - px * pad));
            const x1 = Math.min(W, Math.ceil(cx + px * pad));
            const y0 = Math.max(0, Math.floor(cy - py * pad));
            const y1 = Math.min(H, Math.ceil(cy + py * pad));

            if (x1 <= x0 || y1 <= y0) return;

            const pull = (L.pull === undefined) ? 0.6 : L.pull;
            const col = (L.rgb || [246, 132, 140]).map(
                c => 255 + (c - 255) * pull);

            const core = Math.min(0.95, Math.max(0, 1 - soft));

            const im = g.getImageData(x0, y0, x1 - x0, y1 - y0);
            const d = im.data;
            const w = x1 - x0;

            for (let yy = y0; yy < y1; yy++) {
                const dy = (yy + 0.5 - cy) / py;

                for (let xx = x0; xx < x1; xx++) {
                    const dx = (xx + 0.5 - cx) / px;
                    const r = Math.sqrt(dx * dx + dy * dy);

                    if (r >= 1) continue;

                    // 가장자리를 딱 자르면 스티커처럼 보인다.
                    // 코사인 창으로 부드럽게 0 이 되게 한다.
                    const t = Math.min(1, Math.max(0,
                        (r - core) / Math.max(1e-3, 1 - core)));
                    const m = (0.5 + 0.5 * Math.cos(Math.PI * t)) * amount;

                    if (m <= 0.002) continue;

                    const i = ((yy - y0) * w + (xx - x0)) * 4;

                    // 투명한 자리는 얼굴이 아니다
                    if (d[i + 3] < 8) continue;

                    for (let c = 0; c < 3; c++) {
                        const mixed = d[i + c] * (col[c] / 255);
                        d[i + c] = d[i + c] * (1 - m) + mixed * m;
                    }
                }
            }

            g.putImageData(im, x0, y0);
        }

        // 새 텍스처를 그 재질에 끼운다.
        //
        // **MToon 은 map 과 shadeTexture 를 같이 봐야 한다.** map 만
        // 갈면 빛 받는 쪽만 바뀌고 그늘은 옛 색으로 남는다.
        function swapTexture(mat, orig, tex) {
            ['map', 'shadeTexture', 'emissiveMap', 'rimTexture'].forEach(k => {
                if (mat[k] === orig) mat[k] = tex;
            });

            if (mat.uniforms) {
                Object.keys(mat.uniforms).forEach(k => {
                    const u = mat.uniforms[k];
                    if (u && u.value === orig) u.value = tex;
                });
            }

            mat.shouldApplyUniforms = true;
            mat.needsUpdate = true;
        }

        function makeTexture(canvas, orig) {
            const t = new THREE.CanvasTexture(canvas);

            // 원판에서 베껴야 위아래·색이 안 뒤집힌다
            t.flipY = orig.flipY;
            t.encoding = orig.encoding;
            t.wrapS = orig.wrapS;
            t.wrapT = orig.wrapT;
            t.minFilter = orig.minFilter;
            t.magFilter = orig.magFilter;
            t.needsUpdate = true;

            return t;
        }

        // ------------------------------------------------------------
        // 골라서 바르기
        // ------------------------------------------------------------

        function applyDeco() {
            if (!currentVRM || !deco.conf) return;

            const m = lookMeshes();

            // 원판을 한 번만 기억해 둔다. 다시 칠할 때마다 이것에서 시작한다.
            if (m.iris && !deco.iris) {
                deco.iris = { mat: m.iris.mat, mesh: m.iris.mesh,
                              tex: m.iris.mat.map };
            }

            if (m.face && !deco.face) {
                deco.face = { mat: m.face.mat, mesh: m.face.mesh,
                              tex: m.face.mat.map };
            }

            // ---- 눈 ----
            const eyeConf = deco.conf.eye || {};
            const eyeKey = deco.now.eye || eyeConf.default || 'origin';
            const color = (eyeConf.colors || []).find(c => c.key === eyeKey);

            if (deco.iris && deco.iris.tex) {
                if (!color || !color.rgb) {
                    swapTexture(deco.iris.mat, deco.iris.mat.map, deco.iris.tex);
                } else {
                    const boxes = decoIrisBoxes();
                    const c = texCanvas(deco.iris.tex);

                    if (boxes && c) {
                        tintIris(c, boxes, color.rgb,
                                 eyeConf.alpha_min === undefined
                                     ? 24 : eyeConf.alpha_min,
                                 deco.iris.tex.flipY);

                        swapTexture(deco.iris.mat, deco.iris.mat.map,
                                    makeTexture(c, deco.iris.tex));
                    }
                }
            }

            // ---- 화장 ----
            const mkConf = deco.conf.makeup || {};
            const mkKey = deco.now.makeup || mkConf.default || 'none';
            const item = (mkConf.items || []).find(i => i.key === mkKey);
            const layers = (item && item.layers) || [];

            if (deco.face && deco.face.tex) {
                if (!layers.length) {
                    swapTexture(deco.face.mat, deco.face.mat.map, deco.face.tex);
                } else {
                    const got = measureFace();
                    const c = texCanvas(deco.face.tex);

                    if (got && c) {
                        const soft = (mkConf.soft === undefined) ? 0.78 : mkConf.soft;
                        const flipY = deco.face.tex.flipY;

                        layers.forEach(L => {
                            // 'cheek' 은 좌우 둘, 'lip' 은 하나다
                            const names = (L.spot === 'cheek')
                                ? ['cheek_r', 'cheek_l']
                                : (L.spot === 'eyelid')
                                    ? ['eyelid_r', 'eyelid_l']
                                    : [L.spot];

                            names.forEach(nm => {
                                const sp = got.spots[nm];
                                if (sp) airbrush(c, sp, L, got.unit, soft, flipY);
                            });
                        });

                        swapTexture(deco.face.mat, deco.face.mat.map,
                                    makeTexture(c, deco.face.tex));
                    }
                }
            }

            console.log('[diamondAI] 꾸밈새 — 눈 ' + eyeKey + ' · 화장 ' + mkKey);
        }

        async function loadDeco() {
            // 아바타를 새로 불러왔으면 잰 것도 잡아 둔 재질도 옛것이다.
            // 붙들고 있으면 사라진 재질에 칠하게 된다.
            deco.face = null;
            deco.iris = null;
            deco.spots = null;
            deco.boxes = null;

            try {
                const d = await fetch('/api/look').then(r => r.json());

                if (!d.ok || d.enabled === false) {
                    lookOpen.style.display = 'none';
                    return;
                }

                deco.conf = { eye: d.eye || {}, makeup: d.makeup || {} };
                deco.now = d.now || {};

                applyDeco();

            } catch (e) {
                console.warn('[diamondAI] 꾸밈새를 못 불러왔다', e);
                lookOpen.style.display = 'none';
            }
        }

        async function setDeco(part, key) {
            if (deco.busy) return;
            deco.busy = true;

            const before = deco.now[part];
            deco.now[part] = key;

            try {
                applyDeco();
                buildDecoMenu();

                const d = await fetch('/api/look', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ part: part, key: key }),
                }).then(r => r.json());

                if (!d.ok) throw new Error(d.error || '');

                deco.now = d.now || deco.now;

            } catch (e) {
                // 서버가 안 받으면 되돌린다 — 화면만 바뀌어 있으면
                // 창을 닫았다 열 때 도로 옛 얼굴이라 헷갈린다.
                console.warn('[diamondAI] 꾸밈새를 못 적었다', e);
                deco.now[part] = before;
                applyDeco();
                buildDecoMenu();
            }

            deco.busy = false;
        }

        function buildDecoMenu() {
            lookMenu.innerHTML = '';

            if (!deco.conf) return;

            const cap = (text) => {
                const d = document.createElement('div');
                d.className = 'cap';
                d.textContent = text;
                lookMenu.appendChild(d);
            };

            const row = (label, on, fn) => {
                const b = document.createElement('button');
                b.textContent = label;
                b.className = on ? 'on' : '';
                b.onclick = () => { fn(); closeDecoMenu(); };
                lookMenu.appendChild(b);
            };

            const eye = deco.conf.eye || {};
            const nowEye = deco.now.eye || eye.default;

            if ((eye.colors || []).length) {
                cap('눈 색');
                eye.colors.forEach(c => row(
                    c.label || c.key, c.key === nowEye,
                    () => setDeco('eye', c.key)));
            }

            const mk = deco.conf.makeup || {};
            const nowMk = deco.now.makeup || mk.default;

            if ((mk.items || []).length) {
                cap('화장');
                mk.items.forEach(i => row(
                    i.label || i.key, i.key === nowMk,
                    () => setDeco('makeup', i.key)));
            }
        }

        function closeDecoMenu() {
            lookMenu.classList.remove('on');
        }

        lookOpen.addEventListener('click', (e) => {
            e.stopPropagation();
            closeWearMenu();
            buildDecoMenu();
            lookMenu.classList.toggle('on');
        });

        document.addEventListener('click', (e) => {
            if (!lookMenu.classList.contains('on')) return;
            if (lookMenu.contains(e.target) || e.target === lookOpen) return;
            closeDecoMenu();
        });

        function setRpsEnabled(on) {
            rpsHands.querySelectorAll('button')
                .forEach(b => b.disabled = !on);
        }

        async function playRps(key) {
            if (rpsBusy) return;
            rpsBusy = true;
            setRpsEnabled(false);

            if (isSleeping) wakeUp();

            // 판을 벌이는 동안에는 돌아다니지 않는다
            roam.state = 'gesture';
            faceUser();

            try {
                const res = await fetch('/api/rps', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hand: key })
                });

                const data = await res.json();
                if (!data.ok) throw new Error(data.error || '실패');

                // 먼저 손을 낸다
                if (data.motion) playMotion(data.motion);

                // 낸 뒤에 말한다
                setTimeout(() => {
                    showReply(data.reply, data.expression || 'neutral', null);

                    if (typeof data.affinity === 'number') {
                        myAffinity = data.affinity;
                        setAffinity(data.affinity, data.stage_label);
                        buildToolMenu();
                    }

                    rpsBusy = false;
                    setRpsEnabled(true);

                }, RPS_REVEAL_MS);

            } catch (e) {
                console.warn('[diamondAI] 가위바위보 실패:', e);
                rpsBusy = false;
                setRpsEnabled(true);
            }
        }

        rpsOpen.onclick = () => {
            const on = !rpsHands.classList.contains('open');
            rpsHands.classList.toggle('open', on);
            rpsOpen.classList.toggle('on', on);
        };


        // ------------------------------------------------------------
        // "가위바위보 하자" 는 모델에게 묻지 않는다
        //
        // 모델을 거치면 답이 길어지는데 립싱크가 한 글자에 0.2초라,
        // 정작 손은 한참 뒤에야 낸다. 놀이의 박자가 깨진다.
        // 그래서 이 말은 화면이 알아채고 바로 단추를 가리킨다.
        // ------------------------------------------------------------

        function rpsCfg() {
            return (ENTITY && ENTITY.game && ENTITY.game.rps) || {};
        }

        function isPolite() {
            const stages = stageList();
            const s = stages.find(x => x.key === myStageKey);
            // 아직 모르면 정중한 쪽으로 둔다. 함부로 반말하는 것보다 낫다.
            return !s || String(s.speech || '').startsWith('존댓말');
        }

        function handleRpsCommand(text) {
            const list = rpsCfg().triggers || [];
            if (!list.length) return false;

            const flat = text.replace(/\s+/g, '').toLowerCase();
            const hit = list.some(w =>
                flat.includes(String(w).replace(/\s+/g, '').toLowerCase()));

            if (!hit) return false;

            appendMessage('user', text);

            if (isSleeping) wakeUp();
            faceUser();

            // 단추를 펼치고 잠깐 눈에 띄게 한다
            rpsHands.classList.add('open');
            rpsOpen.classList.add('on', 'call');
            setTimeout(() => rpsOpen.classList.remove('call'), 3400);

            const pool = (rpsCfg().guide || {})[isPolite() ? 'polite' : 'casual']
                || [];

            if (pool.length) {
                showReply(pool[Math.floor(Math.random() * pool.length)],
                          'fun', null);
            }

            return true;
        }


