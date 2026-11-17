'use strict';
// ===== Заставка меню: захід сонця, боєць біжить у сповільненні, довкола рвуться дрони =====
// Три плани: далекий (за руїнами), середній (земля бійця) і ближній. Вибух — короткий спалах і стовп землі вгору.
const MENU = {
  t: 0, scroll: 0, drones: [], booms: [], parts: [], smoke: [], craters: [], tracers: [],
  nextD: 1.2, shake: 0, flash: 0, flashX: 0, flashY: 0, hc: null, rnd: mulberry32(7),
  aim: null, aimCd: 3, flinch: 0, pace: 1, muzzle: 0, corpses: {}, troops: [], nextT: 2.5, raid: 0, raidCd: 9,
};
const MENU_SLOW = 0.3; // сповільнення часу
const MENU_Z = { far: 0.45, mid: 1, near: 1.7 };
const MENU_HUMAN = {
  player: { color: '#f2c94c', name: '' }, x: 0, y: 0, stance: 'stand', facing: 1, onGround: true, onLadder: false, climb: null,
  vx: 175, anim: 0, hp: 100, weapon: { type: 'rifle', mag: 9, ammo: 27 }, aiming: false, aimA: -0.3, hurtT: 0, dead: false, hidden: null,
  canister: false, carry: null, healT: 0, alT: 0, protT: 0, digT: 0, digging: null, piloting: false, fireCd: 0, bloom: 0, cine: true, // cine — кіношний біг із фазою польоту
};
function mr(a, b) { return a + (b - a) * MENU.rnd(); }
// Аркуші кадрів від Gemini: чорні силуети на білому тлі в один ряд. Кадри знаходяться автоматично
// (стовпці без темних пікселів — проміжки), біле тло прибирається, сіре стає напівпрозорим.
const MENU_SHEETS = { boom: { src: 'art/menu/boom.jpg', col: [34, 22, 18], grid: [10, 8], n: 80, pow: 1 / 1.3, vid: 135 / 230 } };
function menuSheetPrep(sh, img) {
  if (sh.grid) return menuGridPrep(sh, img);
  const N = 8, W = img.width, H = img.height, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, W, H).data, lum = (i) => Math.min(d[i], d[i + 1], d[i + 2]);
  const col = new Float32Array(W);
  for (let px = 0; px < W; px++) for (let py = 0; py < H; py += 2) { const l = lum((py * W + px) * 4); if (l < 200) col[px] += (200 - l) / 200; }
  // межі між кадрами: найсвітліший стовпець поблизу кожної рівної поділки
  const cuts = [0];
  for (let k = 1; k < N; k++) {
    const c0 = Math.round(W * k / N), r = Math.round(W / N * 0.35);
    let best = c0, bv = Infinity;
    for (let px = c0 - r; px <= c0 + r; px++) { let v = 0; for (let q = -3; q <= 3; q++) v += col[px + q] || 0; if (v < bv) { bv = v; best = px; } }
    cuts.push(best);
  }
  cuts.push(W);
  let top = H, bot = 0;
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px += 3) if (lum((py * W + px) * 4) < 200) { if (py < top) top = py; if (py > bot) bot = py; }
  const fh = bot - top + 1;
  sh.frames = [];
  for (let k = 0; k < N; k++) {
    // одна фігура в кадрі: ширша ділянка, лишаємо лише пляму, зв'язану з тілом (без шматків сусідів)
    const M = sh.solo ? Math.round(W / N * 0.3) : 0, a0 = Math.max(0, cuts[k] - M), a1 = Math.min(W, cuts[k + 1] + M), fw = a1 - a0, f = document.createElement('canvas'); f.width = fw; f.height = fh;
    let keep = null;
    if (sh.solo) {
      const dark = (px, py) => lum(((top + py) * W + a0 + px) * 4) < 200;
      keep = new Uint8Array(fw * fh);
      // зерно: найтемніша точка посередині ділянки
      let sx = Math.round((cuts[k] + cuts[k + 1]) / 2) - a0, sy = -1;
      for (let py = Math.round(fh * 0.3); py < fh * 0.7 && sy < 0; py++) for (let dx = 0; dx < fw / 2 && sy < 0; dx++) for (const xx of [sx + dx, sx - dx]) if (xx >= 0 && xx < fw && dark(xx, py)) { sx = xx; sy = py; break; }
      const st = [sx + sy * fw]; keep[st[0]] = 1;
      while (st.length) { const p = st.pop(), px = p % fw, py = (p / fw) | 0;
        for (let qy = -1; qy <= 1; qy++) for (let qx = -1; qx <= 1; qx++) { const nx = px + qx, ny = py + qy; if (nx < 0 || ny < 0 || nx >= fw || ny >= fh) continue; const q = nx + ny * fw; if (!keep[q] && dark(nx, ny)) { keep[q] = 1; st.push(q); } } }
      // розширити на 2 px, щоб зберегти згладжений край
      const k2 = keep.slice(); for (let py = 0; py < fh; py++) for (let px = 0; px < fw; px++) if (k2[px + py * fw]) for (let qy = -2; qy <= 2; qy++) for (let qx = -2; qx <= 2; qx++) { const nx = px + qx, ny = py + qy; if (nx >= 0 && ny >= 0 && nx < fw && ny < fh) keep[nx + ny * fw] = 1; }
    }
    const fx = f.getContext('2d'), id = fx.createImageData(fw, fh), o = id.data;
    let mx = 0, mw = 0;
    const rowX = new Float32Array(fh), rowW = new Float32Array(fh);
    for (let py = 0; py < fh; py++) for (let px = 0; px < fw; px++) {
      const l = lum(((top + py) * W + a0 + px) * 4), al = keep && !keep[px + py * fw] ? 0 : Math.max(0, Math.min(1, (235 - l) / 175)), j = (py * fw + px) * 4;
      o[j] = sh.col[0]; o[j + 1] = sh.col[1]; o[j + 2] = sh.col[2]; o[j + 3] = Math.round(al * 255);
      if (al > 0.5) { mx += px * al; mw += al; rowX[py] += px; rowW[py]++; }
    }
    fx.putImageData(id, 0, 0);
    f.ax = mw ? mx / mw : fw / 2; // якір по горизонталі — центр мас силуету
    if (sh.head) {
      // для бігу якір — голова: вона рухається рівно, а ноги й руки гойдають центр мас
      let t0 = 0; while (t0 < fh && !rowW[t0]) t0++;
      let hx = 0, hw = 0; for (let py = t0; py < Math.min(fh, t0 + fh * 0.12); py++) { hx += rowX[py]; hw += rowW[py]; }
      if (hw) f.ax = hx / hw;
    }
    if (!(sh.skip && sh.skip.includes(k))) sh.frames.push(f); // кадри-«присідання» з аркуша не беремо
  }
  sh.fh = fh;
}
// Аркуш-сітка з кадрами відео вибуху (білий фон, краї відео продовжені назовні).
// Кадри взято з нерівним кроком у часі: частіше на початку, де все рухається швидко (t ∝ i^(1/pow)).
function menuGridPrep(sh, img) {
  const [C, R] = sh.grid, fw = Math.floor(img.width / C), fh = Math.floor(img.height / R);
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
  sh.frames = [];
  for (let i = 0; i < sh.n; i++) {
    const d = x.getImageData((i % C) * fw, Math.floor(i / C) * fh, fw, fh), o = d.data;
    for (let p = 0; p < o.length; p += 4) {
      // низ кадру (там у відео була земля) плавно згасає — без рівної смуги на техніці й ґрунті
      const row = (p / 4 / fw) | 0, fade = row > fh * 0.86 ? Math.max(0, (fh - row) / (fh * 0.14)) ** 1.5 : 1;
      const l = Math.min(o[p], o[p + 1], o[p + 2]), al = Math.max(0, Math.min(1, (250 - l) / 230)) * fade;
      o[p] = sh.col[0]; o[p + 1] = sh.col[1]; o[p + 2] = sh.col[2]; o[p + 3] = Math.round(al * 255);
    }
    const f = document.createElement('canvas'); f.width = fw; f.height = fh; f.getContext('2d').putImageData(d, 0, 0);
    f.ax = fw / 2; sh.frames.push(f);
  }
  sh.fh = fh;
}
(function menuSheetsLoad() {
  for (const k in MENU_SHEETS) { const sh = MENU_SHEETS[k], img = new Image(); img.onload = () => { try { menuSheetPrep(sh, img); } catch (e) { console.warn('аркуш кадрів', k, e); } }; img.src = sh.src; }
})();
// силуети вдалині: детерміновані за номером клітинки
function menuHash(i, k) { const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return s - Math.floor(s); }

// полотно заставки живе у верхній частині меню (переставляється після кожного оновлення лобі)
function menuCanvas() {
  if (!MENU.cv) { MENU.cv = document.createElement('canvas'); MENU.cv.className = 'scene'; }
  return MENU.cv;
}
function menuFrame(rdt) {
  const cv = MENU.cv;
  if (!cv || !cv.isConnected) return;
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawMenuScene(c, w, h, rdt);
}
// геометрія кадру (залежить від розміру полотна)
function menuGeo(w, h) {
  const S = h / 260;
  const gy = h * 0.84, hy = h * 0.66;
  return { S, w, h, gy, hy, hx: w * 0.4, ground: { far: hy + h * 0.105, mid: gy, near: h * 0.985 } };
}
function menuGroundY(L, z, X) { return z === MENU_Z.mid ? L.gy + Math.sin((X + MENU.scroll) * 0.011) * 3 * L.S : z === MENU_Z.far ? L.ground.far : L.ground.near; }

function drawMenuScene(ctx, w, h, rdt) {
  const dt = Math.min(rdt, 0.05) * MENU_SLOW;
  MENU.t += dt;
  const L = menuGeo(w, h), S = L.S, gy = L.gy, hy = L.hy, hx = L.hx;
  // боєць: темп бігу (повільніше, коли стріляє чи пригнувся)
  const wantPace = MENU.aim ? 0.28 : 1;
  MENU.pace += (wantPace - MENU.pace) * Math.min(1, dt * 4);
  MENU_HUMAN.vx = 175 * MENU.pace;
  MENU.scroll += MENU_HUMAN.vx * S * dt;
  const sc = MENU.scroll;
  // тряска від вибухів
  MENU.shake = Math.max(0, MENU.shake - rdt * 1.6);
  MENU.rt = (MENU.rt || 0) + rdt;
  const sk = MENU.shake * MENU.shake, rt = MENU.rt;
  const shx = sk * 15 * (Math.sin(rt * 51) * 0.55 + Math.sin(rt * 33 + 1.7) * 0.45), shy = sk * 12 * (Math.sin(rt * 46 + 0.6) * 0.55 + Math.sin(rt * 29 + 2.9) * 0.45);
  ctx.save();
  ctx.translate(shx, shy);

  // небо: захід сонця
  const sky = ctx.createLinearGradient(0, 0, 0, gy);
  sky.addColorStop(0, '#1d1636'); sky.addColorStop(0.35, '#4a2350'); sky.addColorStop(0.62, '#a8424a'); sky.addColorStop(0.82, '#e8763a'); sky.addColorStop(1, '#f7b45c');
  ctx.fillStyle = sky; ctx.fillRect(-20, -20, w + 40, h + 40);
  const sx = w * 0.72, sy = hy - h * 0.02, sr = h * 0.1;
  let g = ctx.createRadialGradient(sx, sy, sr * 0.5, sx, sy, h * 0.75);
  g.addColorStop(0, 'rgba(255,200,120,0.5)'); g.addColorStop(0.3, 'rgba(255,140,80,0.16)'); g.addColorStop(1, 'rgba(255,120,80,0)');
  ctx.fillStyle = g; ctx.fillRect(-20, -20, w + 40, h + 40);
  g = ctx.createRadialGradient(sx, sy - sr * 0.2, 0, sx, sy, sr);
  g.addColorStop(0, '#fff2c4'); g.addColorStop(0.6, '#ffc76a'); g.addColorStop(1, '#ff8f45');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, 7); ctx.fill();
  for (let i = 0; i < 6; i++) {
    const cy = h * (0.12 + i * 0.07), cw = w * (0.35 + menuHash(i, 1) * 0.4), cx = ((menuHash(i, 2) * w * 1.6 - MENU.t * (6 + i * 3) * S) % (w * 1.6) + w * 1.6) % (w * 1.6) - w * 0.3;
    ctx.fillStyle = 'rgba(' + (i < 3 ? '120,60,110' : '255,150,110') + ',' + (0.18 + 0.08 * (i % 3)) + ')';
    ctx.beginPath(); ctx.ellipse(cx, cy, cw / 2, h * 0.012 + menuHash(i, 3) * h * 0.012, 0, 0, 7); ctx.fill();
  }
  menuRidge(ctx, w, hy + h * 0.02, h * 0.07, sc * 0.05, 0.004, '#7a3a4e', 0.75);
  menuRidge(ctx, w, hy + h * 0.06, h * 0.06, sc * 0.12, 0.007, '#55263f', 0.9);
  // далекий дим пожеж
  for (let i = 0; i < 3; i++) {
    const fx = ((menuHash(i, 9) * w * 2 - sc * 0.12) % (w * 2) + w * 2) % (w * 2) - w * 0.3;
    for (let k = 0; k < 7; k++) {
      const u = ((MENU.t * 0.35 + k / 7) % 1), px = fx + Math.sin(u * 3 + i) * 10 * S + u * 40 * S, py = hy + h * 0.05 - u * h * 0.35;
      smokePuff(ctx, px, py, (8 + u * 34) * S, 0.5 * Math.sin(Math.PI * Math.min(1, u * 1.3)), false, u * 2 + i + k, (i + k) % 5);
    }
  }

  // ---- оновлення ----
  MENU.nextD -= rdt;
  // не більше кількох дронів і вибухів одночасно, інакше сцена перевантажена й гальмує
  // інколи — наліт: кілька дронів поспіль (з окремою, трохи вищою стелею)
  if ((MENU.raidCd -= rdt) <= 0 && !MENU.raid) { MENU.raid = 4 + ((MENU.rnd() * 4) | 0); MENU.raidCd = mr(14, 24); }
  if (MENU.nextD <= 0) {
    const raid = MENU.raid > 0;
    MENU.nextD = raid ? mr(0.3, 0.6) : mr(0.8, 1.7);
    const fresh = MENU.booms.filter((b) => b.t < 0.8).length; // стара хмара, що згасає, не рахується
    if (MENU.drones.length < (raid ? 6 : 3) && fresh < (raid ? 4 : 2)) { menuSpawnDrone(L); if (raid) MENU.raid--; }
  }
  menuUpdateDrones(L, dt);
  menuUpdateFx(L, dt);
  menuUpdateHuman(L, dt);
  menuUpdateTroops(L, dt, rdt);

  // ---- далекий план: за руїнами, у серпанку ----
  ctx.save(); ctx.globalAlpha = 0.55;
  menuDrawLayer(ctx, L, MENU_Z.far);
  ctx.restore();
  menuSkyline(ctx, w, h, hy + h * 0.1, sc * 0.3, S);
  // бійці вдалині — перед руїнами, на лінії горизонту; вибухи, що їх накривають, теж тут
  ctx.save(); ctx.globalAlpha = 0.85;
  for (const b of MENU.booms) if (b.front) menuDrawBoom(ctx, b, b.wx - sc * b.z, S * b.z);
  ctx.restore();
  menuDrawTroops(ctx, L); // поверх пилу: видно, як тіло відкидає вибухом
  // земля середнього плану
  ctx.fillStyle = '#1b0f18';
  ctx.beginPath(); ctx.moveTo(-20, h + 20);
  for (let x = -20; x <= w + 40; x += 16) ctx.lineTo(x, gy + Math.sin((x + sc) * 0.011) * 3 * S + Math.sin((x + sc) * 0.037) * 1.5 * S);
  ctx.lineTo(w + 40, h + 20); ctx.closePath(); ctx.fill();
  // вирви
  for (const c of MENU.craters) {
    const X = c.wx - sc * c.z; if (X < -100 || X > w + 100) continue;
    ctx.fillStyle = 'rgba(8,3,8,0.75)'; ctx.beginPath(); ctx.ellipse(X, menuGroundY(L, c.z, X) + 1, c.r, c.r * 0.22, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#24131e'; ctx.beginPath(); ctx.ellipse(X - c.r * 0.9, menuGroundY(L, c.z, X) - 1, c.r * 0.35, c.r * 0.12, 0, Math.PI, 0); ctx.ellipse(X + c.r * 0.9, menuGroundY(L, c.z, X) - 1, c.r * 0.35, c.r * 0.12, 0, Math.PI, 0); ctx.fill();
  }
  // трупи й спалена техніка
  menuDrawDebrisField(ctx, L);
  // трава
  ctx.strokeStyle = '#1b0f18'; ctx.lineWidth = Math.max(1, 1.2 * S);
  for (let i = Math.floor(sc / (7 * S)) - 1, n = i + Math.ceil(w / (7 * S)) + 3; i < n; i++) {
    const x = i * 7 * S - sc, hh = (3 + menuHash(i, 5) * 7) * S, y = gy + Math.sin((x + sc) * 0.011) * 3 * S;
    ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.quadraticCurveTo(x + 1.5 * S, y - hh * 0.6, x + (menuHash(i, 6) - 0.3) * 4 * S, y - hh); ctx.stroke();
  }
  // ---- середній план ----
  menuDrawLayer(ctx, L, MENU_Z.mid, true);
  // ---- ближній план ----
  menuDrawLayer(ctx, L, MENU_Z.near);
  // трасери й спалах пострілу
  for (const tr of MENU.tracers) {
    const k = tr.t / tr.max;
    ctx.strokeStyle = 'rgba(255,230,150,' + (1 - k) * (tr.a || 1) + ')'; ctx.lineWidth = (tr.lw || 1.4) * S;
    const ax = lerp(tr.x1, tr.x2, Math.max(0, k * 1.6 - 0.6)), ay = lerp(tr.y1, tr.y2, Math.max(0, k * 1.6 - 0.6));
    const bx = lerp(tr.x1, tr.x2, Math.min(1, k * 1.6)), by = lerp(tr.y1, tr.y2, Math.min(1, k * 1.6));
    ctx.beginPath(); ctx.moveTo(ax - sc + tr.sc0, ay); ctx.lineTo(bx - sc + tr.sc0, by); ctx.stroke();
  }
  // спалах вибуху освітлює сцену (стримано)
  MENU.flash = Math.max(0, MENU.flash - rdt * 2.2);
  if (MENU.flash > 0) {
    g = ctx.createRadialGradient(MENU.flashX, MENU.flashY, 0, MENU.flashX, MENU.flashY, h * 0.8);
    g.addColorStop(0, 'rgba(255,170,90,' + 0.28 * MENU.flash + ')'); g.addColorStop(1, 'rgba(255,120,60,0)');
    ctx.fillStyle = g; ctx.fillRect(-20, -20, w + 40, h + 40);
  }
  ctx.restore();
  // кольорокорекція й віньєтка
  g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(40,10,50,0.18)'); g.addColorStop(0.6, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(10,0,10,0.35)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  g = ctx.createRadialGradient(w / 2, h * 0.55, h * 0.3, w / 2, h * 0.55, Math.max(w, h) * 0.85);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(8,4,12,0.75)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
function menuRidge(ctx, w, base, amp, off, f, col, a) {
  ctx.fillStyle = col; ctx.globalAlpha = a;
  ctx.beginPath(); ctx.moveTo(-20, base + amp * 3);
  for (let x = -20; x <= w + 40; x += 12) { const u = x + off; ctx.lineTo(x, base - amp * (0.5 + 0.35 * Math.sin(u * f) + 0.15 * Math.sin(u * f * 2.7 + 1.3))); }
  ctx.lineTo(w + 40, base + amp * 3); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
}
// горизонт: руїни, багатоповерхівки, церква, вежа, дерева різних порід, цвинтар, стовпи (детерміновано за клітинкою)
function menuSkyline(ctx, w, h, base, off, S) {
  const cell = 46 * S, COL = '#2c1626', WIN = 'rgba(240,120,70,0.25)';
  ctx.fillStyle = COL;
  ctx.fillRect(-20, base - 2, w + 40, h);
  const win = (x, y, ww, hh) => { ctx.fillStyle = WIN; ctx.fillRect(x, y, ww, hh); ctx.fillStyle = COL; };
  // православний хрест: три поперечки, нижня скісна
  const cross = (x, y, hh, tilt) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(tilt);
    const t = Math.max(1, hh * 0.09);
    ctx.fillRect(-t / 2, -hh, t, hh); ctx.fillRect(-hh * 0.28, -hh * 0.72, hh * 0.56, t); ctx.fillRect(-hh * 0.16, -hh * 0.9, hh * 0.32, t * 0.8);
    ctx.save(); ctx.translate(0, -hh * 0.38); ctx.rotate(-0.35); ctx.fillRect(-hh * 0.2, -t * 0.4, hh * 0.4, t * 0.8); ctx.restore();
    ctx.restore();
  };
  for (let i = Math.floor(off / cell) - 3, n = i + Math.ceil(w / cell) + 6; i < n; i++) {
    const x = i * cell - off, q = (k) => menuHash(i, k);
    let r = menuHash(i, 11);
    const isChurch = (j) => { const v = menuHash(j, 11); return v >= 0.2 && v < 0.225; };
    if (isChurch(i) && (isChurch(i - 1) || isChurch(i - 2) || isChurch(i - 3))) r = 0.6; // дві церкви поруч — ні, там цвинтар
    else if (r >= 0.225 && r < 0.25) r = 0.6; // ще цвинтарі
    ctx.fillStyle = COL;
    if (r < 0.12) { // зруйнований будинок із вікнами
      const bw = cell * (1.2 + q(12)), bh = (40 + q(13) * 60) * S;
      ctx.beginPath(); ctx.moveTo(x, base);
      ctx.lineTo(x, base - bh); ctx.lineTo(x + bw * 0.3, base - bh * (0.75 + q(14) * 0.25)); ctx.lineTo(x + bw * 0.45, base - bh * 0.55);
      ctx.lineTo(x + bw * 0.7, base - bh * (0.8 + q(15) * 0.2)); ctx.lineTo(x + bw, base - bh * 0.4); ctx.lineTo(x + bw, base); ctx.fill();
      for (let fy = 1; fy < 4; fy++) for (let fx = 0; fx < 3; fx++) if (menuHash(i * 7 + fx, fy) > 0.45 && base - fy * 16 * S > base - bh * 0.55) win(x + bw * (0.15 + fx * 0.27), base - fy * 16 * S, 5 * S, 7 * S);
    } else if (r < 0.2) { // багатоповерхівка з вибитими поверхами
      const bw = cell * (0.9 + q(12) * 0.5), bh = (70 + q(13) * 50) * S, cut = q(14);
      ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, base - bh); ctx.lineTo(x + bw * (0.3 + cut * 0.3), base - bh);
      ctx.lineTo(x + bw * (0.45 + cut * 0.3), base - bh * (0.7 + q(15) * 0.15)); ctx.lineTo(x + bw, base - bh * (0.55 + q(16) * 0.2)); ctx.lineTo(x + bw, base); ctx.fill();
      // пробоїна від влучання, крізь неї видно небо
      ctx.fillStyle = 'rgba(232,118,58,0.35)'; ctx.beginPath(); ctx.ellipse(x + bw * (0.3 + q(17) * 0.4), base - bh * (0.35 + q(18) * 0.2), 6 * S, 4.5 * S, q(19), 0, 7); ctx.fill(); ctx.fillStyle = COL;
      for (let fy = 1; fy < 7; fy++) for (let fx = 0; fx < 4; fx++) if (menuHash(i * 13 + fx, fy + 3) > 0.7 && fy * 12 * S < bh * 0.55) win(x + bw * (0.1 + fx * 0.22), base - fy * 12 * S, 3.5 * S, 5 * S);
    } else if (r < 0.225) { // церква з банею й хрестом (баня буває пробита)
      const bw = cell * 1.1, bh = (34 + q(13) * 14) * S, tx = x + bw * 0.5, th = bh + 26 * S, dr = 9 * S;
      ctx.fillRect(x, base - bh, bw, bh);
      ctx.beginPath(); ctx.moveTo(x - 3 * S, base - bh); ctx.lineTo(tx, base - bh - 12 * S); ctx.lineTo(x + bw + 3 * S, base - bh); ctx.fill();
      ctx.fillRect(tx - 6 * S, base - th, 12 * S, th - bh);
      ctx.beginPath(); ctx.moveTo(tx - dr, base - th); ctx.quadraticCurveTo(tx - dr * 1.25, base - th - dr * 1.1, tx, base - th - dr * 1.9); ctx.quadraticCurveTo(tx + dr * 1.25, base - th - dr * 1.1, tx + dr, base - th); ctx.fill();
      if (q(14) < 0.5) { ctx.fillStyle = 'rgba(232,118,58,0.3)'; ctx.beginPath(); ctx.arc(tx + dr * 0.35, base - th - dr * 0.7, dr * 0.35, 0, 7); ctx.fill(); ctx.fillStyle = COL; }
      cross(tx, base - th - dr * 1.85, 12 * S, (q(15) - 0.5) * 0.5);
      win(tx - 1.5 * S, base - th + 6 * S, 3 * S, 7 * S);
    } else if (r < 0.29) { // водонапірна вежа або заводський комин
      if (q(12) < 0.5) {
        const th = (55 + q(13) * 20) * S;
        ctx.beginPath(); ctx.moveTo(x - 6 * S, base); ctx.lineTo(x - 3 * S, base - th); ctx.lineTo(x + 3 * S, base - th); ctx.lineTo(x + 6 * S, base); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x - 9 * S, base - th); ctx.lineTo(x - 7 * S, base - th - 13 * S); ctx.lineTo(x + 7 * S, base - th - 13 * S); ctx.lineTo(x + 9 * S, base - th); ctx.fill();
      } else {
        const th = (70 + q(13) * 30) * S;
        ctx.beginPath(); ctx.moveTo(x - 5 * S, base); ctx.lineTo(x - 3 * S, base - th); ctx.lineTo(x + 2 * S, base - th * (0.94 + q(14) * 0.06)); ctx.lineTo(x + 5 * S, base); ctx.fill();
        ctx.fillRect(x - 14 * S, base - 22 * S, 28 * S, 22 * S);
      }
    } else if (r < 0.37) { // кругле листяне дерево
      const th = (18 + q(16) * 26) * S, cr = (9 + q(17) * 9) * S;
      ctx.fillRect(x - 1.5 * S, base - th, 3 * S, th);
      ctx.beginPath(); ctx.arc(x, base - th, cr, 0, 7); ctx.arc(x - cr * 0.6, base - th + cr * 0.4, cr * 0.7, 0, 7); ctx.arc(x + cr * 0.6, base - th + cr * 0.3, cr * 0.75, 0, 7); ctx.fill();
    } else if (r < 0.44) { // тополі рядком
      const k = 1 + ((q(16) * 3) | 0);
      for (let j = 0; j < k; j++) { const px = x + j * 9 * S, th = (40 + menuHash(i * 3 + j, 20) * 22) * S; ctx.fillRect(px - 1 * S, base - th * 0.3, 2 * S, th * 0.3); ctx.beginPath(); ctx.ellipse(px, base - th * 0.6, 4.5 * S, th * 0.42, 0, 0, 7); ctx.fill(); }
    } else if (r < 0.5) { // ялини
      const k = 1 + ((q(16) * 2) | 0);
      for (let j = 0; j < k; j++) { const px = x + j * 11 * S, th = (30 + menuHash(i * 5 + j, 21) * 20) * S; ctx.fillRect(px - 1 * S, base - 5 * S, 2 * S, 5 * S); for (let t = 0; t < 3; t++) { const yy = base - 4 * S - t * th * 0.27, ww = (11 - t * 3) * S; ctx.beginPath(); ctx.moveTo(px - ww, yy); ctx.lineTo(px, yy - th * 0.42); ctx.lineTo(px + ww, yy); ctx.fill(); } }
    } else if (r < 0.56) { // обгоріле дерево без листя
      const th = (26 + q(16) * 22) * S;
      ctx.strokeStyle = COL; ctx.lineCap = 'round';
      ctx.lineWidth = 3 * S; ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x + 2 * S, base - th); ctx.stroke();
      ctx.lineWidth = 1.6 * S;
      for (let j = 0; j < 4; j++) { const yy = base - th * (0.45 + j * 0.15), sd = j % 2 ? 1 : -1, l = (7 + menuHash(i, 22 + j) * 8) * S; ctx.beginPath(); ctx.moveTo(x + 1.2 * S, yy); ctx.lineTo(x + sd * l, yy - l * 0.7); ctx.stroke(); }
    } else if (r < 0.64) { // цвинтар: хрести різної висоти, дехто похилений, низька огорожа
      const k = 3 + ((q(16) * 4) | 0);
      for (let j = 0; j < k; j++) { const px = x + j * 7 * S + menuHash(i * 11 + j, 23) * 3 * S, hh = (8 + menuHash(i * 11 + j, 24) * 6) * S; ctx.beginPath(); ctx.ellipse(px + 2 * S, base, 3.6 * S, 1.8 * S, 0, Math.PI, 0); ctx.fill(); cross(px, base - 1 * S, hh, (menuHash(i * 11 + j, 25) - 0.5) * 0.35); }
      ctx.fillRect(x - 4 * S, base - 3 * S, k * 7 * S + 6 * S, 1.2 * S);
    } else if (r < 0.7) { // стовп із дротами
      ctx.save(); ctx.translate(x, base); ctx.rotate((q(18) - 0.5) * 0.4);
      ctx.fillRect(-1.5 * S, -55 * S, 3 * S, 55 * S); ctx.fillRect(-9 * S, -50 * S, 18 * S, 2 * S); ctx.restore();
    }
  }
}
// ---- дрони ----
function menuSpawnDrone(L) {
  const S = L.S, sc = MENU.scroll, r = MENU.rnd();
  const z = r < 0.38 ? MENU_Z.far : r < 0.8 ? MENU_Z.mid : MENU_Z.near;
  let X;
  if (z === MENU_Z.mid) {
    // поруч із бійцем, але ніколи на ньому: з упередженням на його біг
    // відносно бійця: позаду — обабіч, попереду — далеко (боєць добігає туди, коли лишився лише пил)
    var rel = MENU.rnd() < 0.6 ? -mr(90, 230) * S : mr(300, 440) * S;
    X = L.hx + rel;
  } else if (z === MENU_Z.near) {
    X = MENU.rnd() < 0.5 ? mr(0.02, 0.24) * L.w : mr(0.58, 0.98) * L.w; // ближній план — обабіч, щоб не затуляв бійця
  } else { X = mr(0.05, 0.95) * L.w; if (Math.abs(X - L.hx) < 0.09 * L.w) X += (X < L.hx ? -1 : 1) * 0.12 * L.w; } // далекий план — теж не за спиною бійця
  const ty = menuGroundY(L, z, X) - (z === MENU_Z.mid ? mr(-3, 12) : mr(0, 8)) * S * z;
  const from = MENU.rnd() < 0.5 ? -1 : 1;
  // політ — в екранних координатах свого плану (ціль не тікає разом зі сценою)
  MENU.drones.push({ z, rel: z === MENU_Z.mid ? rel : null, sx: z === MENU_Z.mid ? null : X, x: X + from * mr(0.2, 0.45) * L.w, y: -40 * S * z - mr(0, 60) * S, ty, v: 330 * S * z, ang: 0, hits: 0, need: 2 + ((MENU.rnd() * 4) | 0) });
}
function menuUpdateDrones(L, dt) {
  const S = L.S;
  for (const d of MENU.drones) {
    // ціль прив'язана до екрана: на середньому плані — обабіч бійця, на ближньому — обабіч кадру
    const tx = d.troop ? d.troop.wx - MENU.scroll * d.z + (d.off || 0) : d.rel != null ? L.hx + d.rel : d.sx;
    const dx = tx - d.x, dy = d.ty - d.y, dist = Math.hypot(dx, dy), sp = d.v * dt;
    if (dist <= sp) { d.dead = true; menuBoom(L, tx + MENU.scroll * d.z, d.ty, d.z, false); if (d.troop) MENU.booms[MENU.booms.length - 1].front = true; continue; }
    d.x += (dx / dist) * sp; d.y += (dy / dist) * sp;
    d.ang = Math.atan2(dy, dx); d.v += 240 * S * d.z * dt;
  }
  MENU.drones = MENU.drones.filter((d) => !d.dead);
}
// ---- бійці на задньому плані: стріляють по дронах, але дрони їх убивають ----
function menuTroopY(L) { return L.hy + L.h * 0.1 + 1; } // лінія, де стоять руїни
function menuSpawnTroops(L) {
  const S = L.S, z = MENU_Z.far, n = 1 + ((MENU.rnd() * 3) | 0), X0 = L.w * mr(1.02, 1.15);
  for (let i = 0; i < n; i++) {
    const X = X0 + i * mr(7, 14) * S;
    MENU.troops.push({ z, wx: X + MENU.scroll * z, facing: MENU.rnd() < 0.75 ? 1 : -1, stance: MENU.rnd() < 0.35 ? 'crouch' : 'stand',
      aimA: -mr(0.5, 1.1), shotCd: mr(0.1, 0.6), burst: 0, fireCd: 0, flash: 0, onT: 0, huntAt: mr(1.4, 3.6) + i * mr(0.3, 0.9), hunted: false, dead: false, deadT: 0 });
  }
}
function menuUpdateTroops(L, dt, rdt) {
  const S = L.S, sc = MENU.scroll;
  if ((MENU.nextT -= rdt) <= 0) { MENU.nextT = mr(7, 13); if (!MENU.troops.some((T) => !T.dead)) menuSpawnTroops(L); }
  for (const T of MENU.troops) {
    const X = T.wx - sc * T.z, gy = menuTroopY(L), Sz = S * 0.3;
    T.flash = Math.max(0, T.flash - dt); T.fireCd = Math.max(0, T.fireCd - dt);
    if (T.dead) { T.deadT += dt; continue; }
    if (X > L.w * 0.95) continue; // ще за кадром
    T.onT += dt;
    // за ними полює дрон, якого вони не можуть збити
    if (!T.hunted && T.onT > T.huntAt && X > L.w * 0.08) {
      T.hunted = true;
      const from = T.facing > 0 ? 1 : -1;
      MENU.drones.push({ z: T.z, troop: T, rel: null, sx: null, x: X + from * mr(0.18, 0.32) * L.w, y: -30 * S - mr(0, 40) * S, ty: gy - 2 * S, v: 300 * S * T.z, ang: 0, hits: 0, need: 1e9, off: (MENU.rnd() < 0.5 ? -1 : 1) * mr(2, 9) * S * T.z });
    }
    // ціль: свій мисливець, інакше будь-який дрон далекого плану, інакше — небо
    const tgt = MENU.drones.find((d) => d.troop === T) || MENU.drones.find((d) => d.z === T.z && d.y < gy - 20 * Sz);
    const sy = gy + (T.stance === 'crouch' ? -28 : -40) * Sz;
    if (tgt) { const dx = tgt.x - X; T.facing = dx >= 0 ? 1 : -1; T.aimA = clamp(Math.atan2(tgt.y - sy, Math.max(8, Math.abs(dx))), -1.35, -0.15); }
    if ((T.shotCd -= dt) <= 0) {
      if (T.burst <= 0) { T.burst = 3 + ((MENU.rnd() * 5) | 0); }
      T.burst--; T.shotCd = T.burst > 0 ? mr(0.06, 0.1) : mr(0.35, 1.1);
      const a = T.aimA + mr(-0.08, 0.08), mx = X + T.facing * Math.cos(T.aimA) * 34 * 1.0 * Sz, my = sy + Math.sin(T.aimA) * 34 * Sz, len = mr(50, 120) * S;
      MENU.tracers.push({ x1: mx + sc, y1: my, x2: mx + sc + T.facing * Math.cos(a) * len, y2: my + Math.sin(a) * len, t: 0, max: 0.08, sc0: 0, lw: 0.5, a: 0.7 });
      T.flash = 0.03; T.fireCd = WEAPONS.rifle.rate;
      if (menuMusic.on && MENU.rnd() < 0.6) menuSfxShot(0.22);
    }
  }
  MENU.troops = MENU.troops.filter((T) => T.wx - sc * T.z > -60 * S);
}
function menuDrawTroops(ctx, L) {
  const S = L.S, Sz = S * 0.3, sc = MENU.scroll;
  const W = Math.ceil(90 * Sz), Hh = Math.ceil(70 * Sz);
  if (!MENU.tc || MENU.tc.width !== W || MENU.tc.height !== Hh) { MENU.tc = document.createElement('canvas'); MENU.tc.width = W; MENU.tc.height = Hh; }
  const c = MENU.tc, cx = c.getContext('2d');
  for (const T of MENU.troops) {
    const X = T.wx - sc * T.z; if (X < -W || X > L.w + W) continue;
    const y = menuTroopY(L);
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalCompositeOperation = 'source-over'; cx.clearRect(0, 0, W, Hh);
    cx.setTransform(Sz, 0, 0, Sz, W / 2, Hh * 0.9);
    // смерть: спершу політ (тіло відкидає від вибуху, воно обертається), потім — лежить
    const FLY = T.fly || 0.6, aw = T.away || 1, tt = T.dead ? Math.max(0, T.deadT - (T.del || 0)) : 0;
    const flying = T.dead && tt < FLY, ft = Math.min(tt, FLY), k = ft / FLY, crumple = T.dk === 'crumple';
    const hd = crumple ? T.cd : aw; // куди падає тіло
    let offX = 0, offY = 0, rot = 0, st = T.dead ? 'stand' : T.stance;
    if (T.dead && crumple) { // осідає на коліна й падає без польоту
      st = 'crouch';
      rot = hd * (Math.PI / 2) * Math.max(0, Math.min(1, (k - 0.3) / 0.7)) ** 1.6; offX = hd * 10 * Sz * k;
    } else if (T.dead) { // відкидає дугою, тіло обертається (при «flip» — через голову)
      offX = aw * 140 * Sz * ft * T.flyV; offY = flying ? -4 * 34 * T.flyV * k * (1 - k) * Sz : 0;
      rot = T.dk === 'flip' ? aw * (Math.PI * 1.5) * Math.pow(k, 0.8) : aw * (Math.PI / 2) * Math.pow(k, 0.5 + 0.6 * T.spin); // закінчує рівно лежачи — без стрибка
    }
    // «ганчір'яна лялька»: у польоті руки й ноги бовтаються; після падіння тіло лишається в тій позі,
    // у якій упало (горілиць, долілиць, із розкинутими руками чи підібганими ногами) — поза завмирає
    const rag = T.dead ? (crumple ? (k > 0.3 ? { w: ft * 9 + (T.seed || 0), f: 0.5 * Math.min(1, (k - 0.3) / 0.3), arch: 0.2, low: true } : null)
      : { w: ft * 13 + (T.seed || 0), f: Math.min(1, k * 4) * (1 - 0.4 * k), arch: Math.min(1, k * 3) }) : null;
    const h = Object.assign({}, MENU_HUMAN, { rag, cine: false, vx: 0, anim: 0, facing: T.dead ? (crumple ? T.cd : -aw) : T.facing, stance: rag ? 'stand' : st, aiming: !T.dead, aimA: T.aimA, fireCd: T.fireCd, dead: false, weapon: T.dead && (!crumple || k > 0.3) ? null : MENU_HUMAN.weapon });
    if (T.dead && rot) { // обертання навколо стегон; лягаючи, стегна опускаються до землі
      const pv = rag && rag.low ? 15 : 24;
      cx.translate(0, -pv + (pv - 5) * Math.abs(Math.sin(rot))); cx.rotate(rot); cx.translate(0, pv);
    }
    drawHuman(cx, h, MENU.t, 1);
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.globalCompositeOperation = 'source-atop'; cx.fillStyle = '#140810'; cx.fillRect(0, 0, W, Hh);
    if (T.flash > 0) { // спалах із дула
      const mx = W / 2 + T.facing * Math.cos(T.aimA) * 34 * Sz, my = Hh * 0.9 + ((T.stance === 'crouch' ? -28 : -40) + Math.sin(T.aimA) * 34) * Sz;
      cx.globalCompositeOperation = 'source-over';
      const g = cx.createRadialGradient(mx, my, 0, mx, my, 5 * Sz * 1.6); g.addColorStop(0, 'rgba(255,235,170,1)'); g.addColorStop(1, 'rgba(255,170,60,0)');
      cx.fillStyle = g; cx.beginPath(); cx.arc(mx, my, 5 * Sz * 1.6, 0, 7); cx.fill();
    }
    ctx.save(); ctx.globalAlpha = 1; ctx.filter = 'blur(0.6px)'; // непрозорі, лише трохи розмиті (далеко)
    ctx.drawImage(c, X - W / 2 + offX, y - Hh * 0.9 + offY);
    ctx.restore();
  }
}
// ---- вибух: спалах, стовп землі вгору, бурий пил, темний дим, вирва ----
function menuBoom(L, wx, y, z, air) {
  const S = L.S * (z === MENU_Z.near ? 1.15 : z === MENU_Z.far ? 0.62 : z), sc = MENU.scroll, X = wx - sc * z;
  if (!air) for (const T of MENU.troops) if (!T.dead && T.z === z && Math.abs(T.wx - wx) < 16 * S) {
    // кожна смерть своя: що ближче до вибуху — то далі відкидає; відкидає на спину, перекидає або людина осідає
    const d = Math.abs(T.wx - wx) / (16 * S), r = MENU.rnd();
    T.dead = true; T.deadT = 0; T.away = Math.abs(T.wx - wx) < 1.5 * S ? (MENU.rnd() < 0.5 ? -1 : 1) : T.wx > wx ? 1 : -1; // майже точне влучання — у випадковий бік
    T.dk = d < 0.35 && r < 0.4 ? 'flip' : d > 0.6 && r < 0.6 ? 'crumple' : r < 0.25 ? 'crumple' : 'throw';
    T.flyV = (1.35 - d * 0.75) * mr(0.8, 1.15); T.spin = T.dk === 'flip' ? mr(1.6, 2.1) : mr(0.7, 1.3);
    T.fly = T.dk === 'crumple' ? mr(0.6, 0.9) : mr(0.45, 0.8); T.del = mr(0, 0.035); // відлітає майже одразу з вибухом
    T.cd = MENU.rnd() < 0.5 ? 1 : -1; T.seed = mr(0, 6.28); // куди осідає; власна фаза бовтання
  }
  MENU.booms.push({ wx, y, z, t: 0, max: MENU_SHEETS.boom.frames && !air ? 2.9 : 0.45, air, flip: MENU.rnd() < 0.5 });
  const near = z === MENU_Z.near, far = z === MENU_Z.far;
  // наскільки вибух близько до глядача: ближній план — впритул, середній — залежно від відстані до бійця
  const close = near ? 1 : far ? 0 : Math.max(0, Math.min(1, 1 - Math.abs(X - L.hx) / (280 * L.S)));
  MENU.shake = Math.min(1.6, MENU.shake + (far ? 0.3 : near ? 1.4 : 0.6 + 0.7 * close));
  MENU.flash = Math.max(MENU.flash, far ? 0.06 : near ? 0.7 : 0.4); // далекі вибухи майже не підсвічують сцену (інакше під час нальоту — блимання) MENU.flashX = X; MENU.flashY = y;
  const P = MENU.parts;
  if (!air) {
    // земля — вгору конусом: багато грудок і пилу
    for (let i = 0, nn = MENU_SHEETS.boom.frames ? 45 : 90; i < nn; i++) {
      const a = -Math.PI / 2 + mr(-0.55, 0.55), v = mr(140, 470) * S;
      P.push({ k: 'dirt', z, wx: wx + mr(-6, 6) * S, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: mr(1.2, 2.4), max: 2.4, r: mr(0.5, 1.6) * S, rot: mr(0, 6), spin: mr(-9, 9), col: MENU.rnd() < 0.5 ? '#2c1a12' : '#41281a' });
    }
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + mr(-0.8, 0.8), v = mr(120, 330) * S;
      P.push({ k: 'clod', z, wx, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 2.6, max: 2.6, r: mr(1.8, 3) * S, rot: mr(0, 6), spin: mr(-5, 5), col: '#1c100b' });
    }
    // пиловий стовп: бурі клуби піднімаються й розповзаються
    for (let i = 0, nd = MENU_SHEETS.boom.frames ? 5 : 14; i < nd; i++) MENU.smoke.push({ k: 'dust', z, wx: wx + mr(-14, 14) * S, y: y - mr(0, 70) * S * (i / 14), vx: mr(-18, 18) * S, vy: -mr(60, 200) * S * (1 - i / 20), r: mr(10, 20) * S, life: mr(2.2, 3.6), max: 3.6, rot: mr(0, 6), spin: mr(-0.5, 0.5) });
    MENU.craters.push({ wx, z, r: mr(16, 24) * S, life: 40 });
    if (MENU.craters.length > 14) MENU.craters.shift();
  } else {
    for (let i = 0; i < 10; i++) { const a = mr(0, 6.28), v = mr(50, 200) * S; P.push({ k: 'frag', z, wx, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60 * S, life: mr(1.2, 2.2), max: 2.2, r: mr(0.5, 1.3) * S, rot: mr(0, 6), spin: mr(-14, 14), col: '#161016' }); }
  }
  for (let i = 0; i < (air ? 22 : 0); i++) { const a = (i / 22) * Math.PI * 2 + mr(-0.15, 0.15), v = mr(90, 300) * S; P.push({ k: 'ember', z, wx, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: mr(0.25, 0.6), max: 0.6, sz: mr(0.6, 1.2) }); }
  // темний дим після вогню
  for (let i = 0; i < (air ? 3 : 6); i++) MENU.smoke.push({ k: 'smoke', z, wx: wx + mr(-12, 12) * S, y: y - mr(10, 40) * S, vx: mr(-10, 10) * S, vy: -mr(15, 45) * S, r: mr(14, 24) * S, life: mr(3.5, 6), max: 6, rot: mr(0, 6), spin: mr(-0.6, 0.6), v: (MENU.rnd() * 5) | 0 });
  // боєць пригинається від близького вибуху
  if (menuMusic.on && !far) menuSfxBoom(near ? 1 : 0.7, close);
  else if (menuMusic.on) menuSfxBoom(0.35);
}
function menuUpdateFx(L, dt) {
  const S = L.S, sc = MENU.scroll;
  for (const b of MENU.booms) b.t += dt;
  MENU.booms = MENU.booms.filter((b) => b.t < b.max);
  // забагато хмар одночасно — найстаріші швидко дотлівають (без різкого зникнення)
  for (let i = 0; i < MENU.booms.length - 6; i++) MENU.booms[i].t += dt * 2.5;
  for (const p of MENU.parts) {
    p.life -= dt; p.wx += p.vx * dt; p.y += p.vy * dt;
    const gyp = menuGroundY(L, p.z, p.wx - sc * p.z);
    if (p.k === 'ember') { p.vy += 300 * S * p.z * dt; p.vx *= 0.985; }
    else { p.vy += 1100 * S * p.z * dt; p.rot += p.spin * dt; if (p.y > gyp && p.vy > 0) { p.y = gyp; p.vy *= -0.18; p.vx *= 0.4; p.spin *= 0.4; } }
  }
  MENU.parts = MENU.parts.filter((p) => p.life > 0 && p.wx - sc * p.z > -300);
  for (let i = 0; i < MENU.parts.length - 260; i++) MENU.parts[i].life -= dt * 4;
  for (const p of MENU.smoke) { p.life -= dt; p.wx += p.vx * dt; p.y += p.vy * dt; p.vy *= p.k === 'dust' ? 0.97 : 0.995; p.vx *= 0.99; }
  MENU.smoke = MENU.smoke.filter((p) => p.life > 0);
  for (let i = 0; i < MENU.smoke.length - 50; i++) MENU.smoke[i].life -= dt * 3;
  for (const c of MENU.craters) c.life -= dt;
  MENU.craters = MENU.craters.filter((c) => c.life > 0);
  for (const t of MENU.tracers) t.t += dt;
  MENU.tracers = MENU.tracers.filter((t) => t.t < t.max);
}
// усе, що належить одному плану: дим, вибухи, частинки, дрони (і боєць — на середньому)
function menuDrawLayer(ctx, L, z, withHuman) {
  const sc = MENU.scroll, S = L.S * z;
  for (const p of MENU.smoke) {
    if (p.z !== z) continue;
    const k = p.life / p.max, X = p.wx - sc * z;
    if (p.k === 'dust') {
      const r = p.r * (1 + (1 - k) * 2.6), a = (z === MENU_Z.near ? 0.3 : z === MENU_Z.far ? 0.8 : 0.5) * Math.pow(k, 0.9);
      const g = ctx.createRadialGradient(X, p.y, 0, X, p.y, r);
      g.addColorStop(0, 'rgba(92,62,44,' + a + ')'); g.addColorStop(0.6, 'rgba(70,46,36,' + a * 0.6 + ')'); g.addColorStop(1, 'rgba(60,40,34,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, p.y, r, 0, 7); ctx.fill();
    } else smokePuff(ctx, X, p.y, p.r * (1 + (1 - k) * 2), 0.5 * Math.pow(k, 0.8), false, p.rot + (1 - k) * p.spin, p.v);
  }
  for (const b of MENU.booms) if (b.z === z && !b.front) menuDrawBoom(ctx, b, b.wx - sc * z, z === MENU_Z.near ? L.S * 1.15 : S);
  if (withHuman) menuDrawHuman(ctx, L);
  for (const p of MENU.parts) {
    if (p.z !== z) continue;
    const X = p.wx - sc * z, k = p.life / p.max;
    if (p.k === 'ember') { const e = (p.sz || 1) * S; ctx.fillStyle = 'rgba(255,' + (170 + 70 * k | 0) + ',' + (90 + 80 * k | 0) + ',' + k + ')'; ctx.fillRect(X - e, p.y - e, 2 * e, 2 * e); }
    else {
      ctx.save(); ctx.globalAlpha *= Math.min(1, k * 3);
      if (p.k !== 'frag') { // слід руху (для грудок землі; уламки дрона — без сліду)
        const sp = Math.hypot(p.vx, p.vy), tl = Math.min(6, sp * 0.012) * p.r;
        ctx.strokeStyle = p.col; ctx.lineCap = 'round'; ctx.lineWidth = p.r * 1.4;
        ctx.beginPath(); ctx.moveTo(X, p.y); ctx.lineTo(X - (p.vx / (sp || 1)) * tl, p.y - (p.vy / (sp || 1)) * tl); ctx.stroke();
      }
      if (p.k === 'frag') { ctx.translate(X, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.col; ctx.beginPath(); ctx.moveTo(-p.r, 0); ctx.lineTo(p.r * 0.6, -p.r * 0.7); ctx.lineTo(p.r * 1.2, p.r * 0.3); ctx.closePath(); ctx.fill(); }
      else if (p.k === 'clod') { ctx.translate(X, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.col; ctx.beginPath(); ctx.moveTo(-p.r, -p.r * 0.3); ctx.lineTo(p.r * 0.2, -p.r * 0.8); ctx.lineTo(p.r, p.r * 0.1); ctx.lineTo(-p.r * 0.3, p.r * 0.7); ctx.closePath(); ctx.fill(); }
      ctx.restore();
    }
  }
  for (const d of MENU.drones) if (d.z === z) menuDrawDrone(ctx, d.x, d.y, d.ang, S);
}
function menuDrawBoom(ctx, b, X, S) {
  const BS = MENU_SHEETS.boom;
  if (BS.frames && !b.air) {
    const n = BS.frames.length, u = b.t / b.max, ph = Math.min(n - 1.001, Math.pow(u, BS.pow || 0.75) * (n - 1)), i0 = Math.floor(ph), q = ph - i0;
    const hh = 125 * S / (BS.vid || 1), k2 = hh / BS.fh, a0 = ctx.globalAlpha * (() => { const v = Math.min(1, (1 - u) / 0.4); return v * v * (3 - 2 * v); })(); // висота відео ≈ 125 px, продовжені краї — понад це
    ctx.save();
    ctx.translate(X, b.y + 14 * S); if (b.flip) ctx.scale(-1, 1); // трохи нижче лінії ґрунту
    // справжнє змішування двох кадрів (сума (1-q)·A + q·B у допоміжному полотні) з якісним зменшенням —
    // без мерехтіння грудок при зміні кадрів, особливо на далекому плані
    const f0 = BS.frames[i0], f1 = BS.frames[i0 + 1] || f0, dw = Math.max(1, Math.ceil(f0.width * k2)), dh = Math.max(1, Math.ceil(hh));
    if (!MENU.boc) MENU.boc = document.createElement('canvas');
    const oc = MENU.boc; if (oc.width < dw || oc.height < dh) { oc.width = Math.max(oc.width, dw); oc.height = Math.max(oc.height, dh); }
    const ox = oc.getContext('2d'); ox.setTransform(1, 0, 0, 1, 0, 0); ox.globalCompositeOperation = 'source-over'; ox.globalAlpha = 1; ox.clearRect(0, 0, dw + 2, dh + 2);
    ox.imageSmoothingEnabled = true; ox.imageSmoothingQuality = 'high'; ox.globalCompositeOperation = 'lighter';
    ox.globalAlpha = 1 - q; ox.drawImage(f0, 0, 0, dw, dh);
    if (q > 0.002) { ox.globalAlpha = q; ox.drawImage(f1, 0, 0, dw, dh); }
    ctx.globalAlpha = a0; ctx.drawImage(oc, 0, 0, dw, dh, -f0.ax * k2, -hh, dw, dh);
    ctx.restore();
  }
  const k = Math.min(1, b.t / 0.45), y = b.y;
  // короткий спалах (на землі — ледь помітний)
  const fk = b.air ? 0.22 : 0.1;
  if (k < fk) {
    // у повітрі — рівний круглий спалах, що швидко розширюється й гасне
    const a = b.air ? Math.pow(1 - k / fk, 1.6) : (1 - k / fk) * 0.4, r = (b.air ? 6 + k * 120 : 7 + k * 60) * S, cy = b.air ? y : y - r * 0.2;
    const g = ctx.createRadialGradient(X, cy, 0, X, cy, r);
    g.addColorStop(0, 'rgba(255,245,210,' + a + ')'); g.addColorStop(0.5, 'rgba(255,170,70,' + a * 0.7 + ')'); g.addColorStop(1, 'rgba(255,110,40,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, cy, r, 0, 7); ctx.fill();
  }
  const fa = 0; // язики вогню прибрано
  if (fa > 0) {
    ctx.fillStyle = 'rgba(255,' + (120 + 60 * fa | 0) + ',40,' + fa * 0.85 + ')';
    for (let i = 0; i < 5; i++) {
      const ang = -Math.PI / 2 + (i - 2) * 0.35, len = (12 + 22 * Math.sin(Math.PI * Math.min(1, k * 2.2))) * S * (1 - Math.abs(i - 2) * 0.18);
      ctx.beginPath(); ctx.ellipse(X + Math.cos(ang) * len * 0.5, y + Math.sin(ang) * len * 0.5, 3.2 * S, len * 0.55, ang + Math.PI / 2, 0, 7); ctx.fill();
    }
  }
  if (!b.air && k < 0.5) { // ударна хвиля по землі — слабка й коротка
    ctx.strokeStyle = 'rgba(255,220,170,' + (0.12 * (1 - k * 2)) + ')'; ctx.lineWidth = 1.5 * S;
    ctx.beginPath(); ctx.ellipse(X, y + 3 * S, (16 + k * 90) * S, (3 + k * 8) * S, 0, 0, 7); ctx.stroke();
  }
}
// ---- трупи й спалена техніка (поле бою, детерміновано вздовж шляху) ----
function menuCorpse(facing, v) {
  const key = facing + ':' + v;
  if (MENU.corpses[key]) return MENU.corpses[key];
  const c = document.createElement('canvas'); c.width = 96; c.height = 40;
  const x = c.getContext('2d');
  x.setTransform(1.3, 0, 0, 1.3, 48, 34);
  drawHuman(x, Object.assign({}, MENU_HUMAN, { dead: true, facing, lost: v === 1 ? 'arm' : null, player: { color: '#555', name: '' } }), 0, 1);
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-atop'; x.fillStyle = 'rgba(16,7,14,0.9)'; x.fillRect(0, 0, 96, 40);
  return (MENU.corpses[key] = c);
}
function menuDrawDebrisField(ctx, L) {
  const S = L.S, sc = MENU.scroll, cell = 230 * S;
  for (let i = Math.floor(sc / cell) - 1, n = i + Math.ceil(L.w / cell) + 2; i < n; i++) {
    const r = menuHash(i, 31); if (r > 0.55) continue;
    const X = i * cell + menuHash(i, 32) * cell * 0.8 - sc, y = menuGroundY(L, MENU_Z.mid, X);
    if (r < 0.36) { // загиблий
      const c = menuCorpse(menuHash(i, 33) < 0.5 ? -1 : 1, menuHash(i, 34) < 0.3 ? 1 : 0), cw = 96 * S * 0.62, ch = 40 * S * 0.62;
      ctx.drawImage(c, X - cw / 2, y - ch * 0.85 + 1, cw, ch);
    } else { // спалена техніка
      const nm = ['vd_car', 'vd_buggy', 'vd_quad', 'wreck'][(menuHash(i, 35) * 4) | 0];
      if (ISP.parts[nm]) {
        ctx.save(); ctx.filter = 'brightness(0.18) sepia(0.5)';
        ispRect(ctx, nm, X - 45 * S, y - 40 * S + 2 * S, 90 * S, 40 * S, false, menuHash(i, 36) < 0.5 ? -1 : 1);
        ctx.restore();
        // ледь живий дим над технікою
        if (menuHash(i, 37) < 0.6) for (let k = 0; k < 4; k++) { const u = (MENU.t * 0.25 + k / 4 + menuHash(i, 38)) % 1; smokePuff(ctx, X + u * 20 * S, y - 20 * S - u * 70 * S, (6 + u * 18) * S, 0.35 * (1 - u), false, u * 3 + k, k); }
      }
    }
  }
}
// ---- боєць: біг, пригинання, стрільба по дронах ----
// Рівномірність руху: у деяких фазах кроку поза майже не змінюється (тіло в нижній чи верхній точці,
// п'ята вгорі) — і біг ніби застигає. Один раз міряємо, наскільки змінюється силует між сусідніми фазами,
// і далі в повільних фазах проходимо цикл швидше, у швидких — повільніше (середній темп той самий).
function menuGaitWarp() {
  if (MENU.gait) return MENU.gait;
  const N = 96, c = document.createElement('canvas'); c.width = 100; c.height = 100;
  const x = c.getContext('2d', { willReadFrequently: true }), fr = [];
  for (let i = 0; i <= N; i++) {
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, 100, 100); x.setTransform(1.2, 0, 0, 1.2, 50, 90);
    drawHuman(x, Object.assign({}, MENU_HUMAN, { anim: i / N * Math.PI * 2, vx: 175, aiming: false }), 0, 1);
    const d = x.getImageData(0, 0, 100, 100).data, a = new Uint8Array(10000);
    for (let p = 0; p < 10000; p++) a[p] = d[p * 4 + 3] > 128 ? 1 : 0;
    fr.push(a);
  }
  let m = []; for (let i = 0; i < N; i++) { let k = 0; for (let p = 0; p < 10000; p++) if (fr[i][p] !== fr[i + 1][p]) k++; m.push(k + 1); }
  for (let pass = 0; pass < 3; pass++) m = m.map((v, i) => (m[(i + N - 1) % N] + 2 * v + m[(i + 1) % N]) / 4); // згладити
  const avg = m.reduce((a, b) => a + b, 0) / N;
  return (MENU.gait = m.map((v) => clamp(avg / v, 0.55, 1.8)));
}
function menuUpdateHuman(L, dt) {
  const H = MENU_HUMAN, S = L.S;
  const G = menuGaitWarp(), gi = ((H.anim / (Math.PI * 2)) % 1 + 1) % 1 * G.length, g0 = G[Math.floor(gi) % G.length], g1 = G[(Math.floor(gi) + 1) % G.length];
  const warp = H.aiming ? 1 : 1 + (g0 + (g1 - g0) * (gi % 1) - 1) * MENU.pace;
  H.anim += dt * 10 * (0.35 + 0.65 * MENU.pace) * warp;
  H.stance = 'stand';
  MENU.muzzle = Math.max(0, MENU.muzzle - dt);
  H.fireCd = Math.max(0, H.fireCd - dt); // віддача
  // вибрати ціль: дрон середнього плану попереду-вгорі
  MENU.aimCd -= dt;
  if (!MENU.aim && MENU.aimCd <= 0) {
    const foot = L.gy, mx = L.hx;
    const sy0 = L.gy - 50 * S;
    const d = MENU.drones.find((q) => q.z === MENU_Z.mid && q.x - mx > 70 * S && q.y < foot - 50 * S && q.y > 10 * S && sy0 - q.y < (q.x - mx) * 2); // попереду й не надто круто
    if (d) { MENU.aim = { d, t: 0, shot: 0 }; MENU.aimCd = mr(1.2, 3); }
  }
  if (MENU.aim) {
    const A = MENU.aim, d = A.d;
    A.t += dt;
    const mxs = L.hx, sy = L.gy - 40 * 1.25 * S, dx = d.x - mxs, dy = d.y - sy;
    // дрон зник, довго не вдається або вже заходить над голову — не стріляти вгору йому в слід
    if (!MENU.drones.includes(d) || A.t > 1.6 || dx < 30 * S || -dy > dx * 2.6) { MENU.aim = null; H.aiming = false; return; }
    H.aiming = true; H.facing = 1; H.aimA = clamp(Math.atan2(dy, Math.max(10, dx)), -1.35, 0.15);
    if (A.t > 0.18 && (A.shot -= dt) <= 0) {
      A.shot = 0.07;
      const mzx = mxs + (2 + Math.cos(H.aimA) * 34) * 1.25 * S, mzy = sy + Math.sin(H.aimA) * 34 * 1.25 * S;
      const spread = mr(-0.05, 0.05), len = Math.hypot(dx, dy) * 1.4;
      MENU.tracers.push({ x1: mzx + MENU.scroll, y1: mzy, x2: mzx + MENU.scroll + Math.cos(H.aimA + spread) * len, y2: mzy + Math.sin(H.aimA + spread) * len, t: 0, max: 0.09, sc0: 0 });
      MENU.muzzle = 0.03; H.fireCd = WEAPONS.rifle.rate;
      if (menuMusic.on) menuSfxShot();
      if (++d.hits >= Math.min(d.need, 3)) { d.dead = true; MENU.drones = MENU.drones.filter((q) => q !== d); menuBoom(L, d.x + MENU.scroll * d.z, d.y, d.z, true); MENU.aim = null; H.aiming = false; }
    }
  }
}
// людина: малюється на окремому полотні, затемнюється в силует, контурне світло від сонця
function menuDrawHuman(ctx, L) {
  const S = L.S, H = MENU_HUMAN, x = L.hx, y = menuGroundY(L, MENU_Z.mid, x);
  const W = Math.ceil(120 * S), Hh = Math.ceil(110 * S);
  if (!MENU.hc || MENU.hc.width !== W) { MENU.hc = document.createElement('canvas'); MENU.hc.width = W; MENU.hc.height = Hh; }
  const c = MENU.hc, cx = c.getContext('2d');
  cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalCompositeOperation = 'source-over'; cx.clearRect(0, 0, W, Hh);
  // нахил уперед на бігу, легке погойдування
  const lean = H.aiming ? 0 : 0.07 * MENU.pace + (H.stance === 'crouch' ? 0.1 : 0);
  cx.setTransform(S * 1.25, 0, 0, S * 1.25, W / 2, Hh * 0.92);
  cx.rotate(lean);
  drawHuman(cx, H, MENU.t, 1);
  if (MENU.muzzle > 0) { // спалах із дула
    const mx = 2 + Math.cos(H.aimA) * 34, my = -40 + Math.sin(H.aimA) * 34;
    const g = cx.createRadialGradient(mx, my, 0, mx, my, 9); g.addColorStop(0, 'rgba(255,240,180,1)'); g.addColorStop(1, 'rgba(255,170,60,0)');
    cx.fillStyle = g; cx.beginPath(); cx.arc(mx, my, 9, 0, 7); cx.fill();
  }
  cx.setTransform(1, 0, 0, 1, 0, 0);
  // силует проти сонця: темний, а світиться лише край з боку сонця (праворуч)
  if (!MENU.hc2 || MENU.hc2.width !== W) { MENU.hc2 = document.createElement('canvas'); MENU.hc2.width = W; MENU.hc2.height = Hh; }
  const m2 = MENU.hc2.getContext('2d');
  m2.globalCompositeOperation = 'source-over'; m2.clearRect(0, 0, W, Hh); m2.drawImage(c, 0, 0);
  m2.globalCompositeOperation = 'source-in'; m2.fillStyle = '#140912'; m2.fillRect(0, 0, W, Hh);
  cx.globalCompositeOperation = 'source-atop';
  cx.fillStyle = 'rgba(255,160,80,' + Math.min(1, 0.8 + MENU.flash * 0.2) + ')'; cx.fillRect(0, 0, W, Hh);
  cx.drawImage(MENU.hc2, -Math.max(1.5, 1.6 * S), Math.max(0.5, 0.4 * S)); // зсунута тінь накриває все, крім світлого краю
  if (MENU.muzzle > 0) { cx.fillStyle = 'rgba(255,200,120,0.35)'; cx.fillRect(0, 0, W, Hh); }
  cx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x - 4 * S, y + 1, 22 * S, 3 * S, 0, 0, 7); ctx.fill();
  ctx.drawImage(c, x - W / 2, y - Hh * 0.92);
}
function menuDrawDrone(ctx, x, y, ang, S) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang * 0.35);
  if (ISP.parts.fly) {
    ctx.filter = 'brightness(0.25) sepia(0.4)';
    ispCenter(ctx, 'fly', 34 * S, Math.cos(ang) < 0 ? -1 : 1);
    ctx.filter = 'none';
  } else {
    ctx.fillStyle = '#140a10'; ctx.fillRect(-12 * S, -2 * S, 24 * S, 4 * S); ctx.fillRect(-15 * S, -4 * S, 6 * S, 2 * S); ctx.fillRect(9 * S, -4 * S, 6 * S, 2 * S);
  }
  ctx.fillStyle = 'rgba(255,60,60,' + (0.6 + 0.4 * Math.sin(MENU.t * 30)) + ')'; ctx.beginPath(); ctx.arc(0, 0, 1.5 * S, 0, 7); ctx.fill();
  ctx.restore();
}
// ===== Звуки заставки: глухі, ніби теж сповільнені (лише низькі частоти) =====
// Лише шум без генераторів тону: удар — це короткий сплеск відфільтрованого шуму, а не нота.
// Фільтри з Q < 0.7, щоб не було резонансу (інакше теж чути «ноту»). Хвіст — згортковий ревербератор.
const MENU_SFX = { ctx: null };
function menuSfxBus() {
  const ctx = Sfx.ctx; if (!ctx || !Sfx.master) return null;
  if (MENU_SFX.ctx === ctx) return MENU_SFX;
  const sr = ctx.sampleRate;
  // довгий шум (4 с), щоб повтор буфера не давав періодичності
  const nz = ctx.createBuffer(1, sr * 4, sr), nd = nz.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  // імпульсна характеристика: стерео-шум, що згасає ~3 с і темнішає з часом (повітря гасить верхи)
  const len = Math.floor(sr * 3.2), ir = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch); let lp = 0;
    for (let i = 0; i < len; i++) {
      const tt = i / sr, k = 0.35 - 0.3 * Math.min(1, tt / 2.5); // коефіцієнт згладжування: менше — темніше
      lp += (Math.random() * 2 - 1 - lp) * k;
      d[i] = lp * Math.exp(-tt * 2.1) * (tt < 0.012 ? tt / 0.012 : 1);
    }
  }
  const conv = ctx.createConvolver(); conv.buffer = ir;
  const wet = ctx.createGain(); wet.gain.value = 0.9;
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 45; hp.Q.value = 0.5; // без гулу в хвості
  conv.connect(hp); hp.connect(wet); wet.connect(Sfx.master);
  Object.assign(MENU_SFX, { ctx, nz, rev: conv });
  return MENU_SFX;
}
// один шумовий шар: фільтр (від f0 до f1 за fT с), атака at, згасання до dec с; send — частка в ревербератор
function menuNoiseHit(B, t, { f0, f1, fT, at, dec, vol, rate = 1, send = 0.4, order = 2 }) {
  const ctx = B.ctx, src = ctx.createBufferSource(); src.buffer = B.nz; src.loop = true; src.playbackRate.value = rate;
  let node = src;
  for (let i = 0; i < order; i++) {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.5;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + fT);
    node.connect(f); node = f;
  }
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + at); g.gain.exponentialRampToValueAtTime(0.0005, t + dec);
  node.connect(g); g.connect(Sfx.master);
  if (send > 0) { const sg = ctx.createGain(); sg.gain.value = send; g.connect(sg); sg.connect(B.rev); }
  src.start(t, Math.random() * 3); src.stop(t + dec + 0.05);
}
function menuSfxBoom(vol, close = 0) {
  const B = menuSfxBus(); if (!B) return;
  const t = B.ctx.currentTime;
  // удар: короткий глухий сплеск
  menuNoiseHit(B, t, { f0: 700, f1: 160, fT: 0.12, at: 0.006, dec: 0.35, vol: 0.9 * vol, send: 0.6 });
  // суб: тиск у грудях, шум нижче 90 Гц (без висоти тону)
  menuNoiseHit(B, t, { f0: 110, f1: 55, fT: 0.5, at: 0.015, dec: 0.9, vol: 1.3 * vol * (1 + 0.5 * close), send: 0.15, order: 3 });
  // близько — глибокий тиск нижче 60 Гц, довший (відчувається тілом)
  if (close > 0.05) menuNoiseHit(B, t, { f0: 75, f1: 30, fT: 1.1, at: 0.02, dec: 1.8, vol: 2.4 * vol * close, send: 0.08, order: 4 });
  // гуркіт ґрунту, що осідає
  menuNoiseHit(B, t + 0.03, { f0: 300, f1: 80, fT: 2.4, at: 0.12, dec: 3, vol: 0.45 * vol, rate: 0.6, send: 0.5 });
}
function menuSfxShot(v = 1) {
  const B = menuSfxBus(); if (!B) return;
  const t = B.ctx.currentTime;
  menuNoiseHit(B, t, { f0: 900 * (v < 1 ? 0.6 : 1), f1: 180, fT: 0.08, at: 0.003, dec: 0.22, vol: 0.32 * v, send: v < 1 ? 1 : 0.8 });
  if (v >= 1) menuNoiseHit(B, t, { f0: 140, f1: 70, fT: 0.15, at: 0.006, dec: 0.3, vol: 0.35, send: 0.2, order: 3 });
}
// ===== Музика меню =====
const menuMusic = {
  on: loadMenuPref(), el: null, unlocked: false,
  src: 'https://upload.wikimedia.org/wikipedia/commons/0/04/W._A._Mozart_-_Requiem_-_8._Lacrimosa_%28Herbert_von_Karajan%2C_Wiener_Philharmoniker%2C_Wiener_Singverein%2C_1960%29.ogg',
  credit: 'В. А. Моцарт — Реквієм, Lacrimosa · Г. фон Караян, Віденська філармонія, 1960 · Wikimedia Commons, суспільне надбання',
};
function loadMenuPref() { try { return localStorage.getItem('fpv.music') !== '0'; } catch (e) { return true; } }
// У записі спершу секунда стороннього звуку й 2 с тиші — перші ноти вступають на 3,23 с;
// фінальне «Amen» відзвучує до ~209 с. Граємо й зациклюємо лише саму музику.
const MUSIC_START = 3.2, MUSIC_END = 209;
function menuMusicEl() {
  if (!menuMusic.el) {
    const el = menuMusic.el = new Audio(menuMusic.src);
    el.loop = false; el.volume = 0; el.preload = 'auto';
    const back = () => { el.currentTime = MUSIC_START; };
    el.addEventListener('loadedmetadata', () => { if (el.currentTime < MUSIC_START) back(); });
    el.addEventListener('timeupdate', () => { if (el.currentTime >= MUSIC_END) back(); });
    el.addEventListener('ended', () => { back(); el.play().catch(() => {}); });
  }
  return menuMusic.el;
}
function menuMusicPlay() {
  const el = menuMusicEl();
  if (el.readyState >= 1 && el.currentTime < MUSIC_START) el.currentTime = MUSIC_START;
  const p = el.play(); if (p && p.catch) p.catch(() => { /* браузер чекає на клік */ });
}
// щокадру: у меню грає (плавно наростає), у грі — плавно затихає й ставиться на паузу
function menuMusicTick(dt) {
  const want = menuMusic.on && menuMusic.unlocked && state === 'lobby';
  const el = menuMusic.el;
  if (want && (!el || el.paused)) menuMusicPlay();
  if (!el) return;
  el.volume = clamp(el.volume + (want ? dt * 0.35 : -dt * 1.2), 0, 0.6);
  if (!want && el.volume <= 0 && !el.paused) el.pause();
}
// браузер дозволяє звук лише після першої дії користувача
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => { menuMusic.unlocked = true; }, { once: false, passive: true });
function menuMusicToggle() {
  menuMusic.on = !menuMusic.on; menuMusic.unlocked = true;
  try { localStorage.setItem('fpv.music', menuMusic.on ? '1' : '0'); } catch (e) { /* без збереження */ }
}
// вступ: браузер дозволяє звук лише після дії користувача, тож спершу чорний екран;
// після кліку чи клавіші вмикається музика, і щойно вона справді заграла — меню й заставка проступають разом із нею
const menuIntro = { active: false };
function menuIntroStart() {
  if (!menuMusic.on || state !== 'lobby') return; // музику вимкнено — меню одразу
  const intro = document.getElementById('intro');
  if (!intro) return;
  menuIntro.active = true;
  menuMusicEl(); // трек вантажиться, поки людина дивиться на чорний екран
  lobbyEl.classList.add('pre');
  intro.classList.add('on');
  const go = () => {
    if (menuIntro.started) return;
    menuIntro.started = true;
    intro.querySelector('.intro-hint').textContent = '';
    menuMusic.unlocked = true;
    const el = menuMusicEl();
    el.volume = 0.6; // без наростання: Lacrimosa починається тихо, і перші ноти мають бути чутні
    menuMusicPlay();
    let done = false;
    const reveal = () => {
      if (done) return; done = true;
      MENU.t = 0; MENU.scroll = 0; MENU.drones = []; MENU.booms = []; MENU.parts = []; MENU.smoke = []; MENU.troops = []; MENU.nextT = 2.5; MENU.raid = 0; MENU.raidCd = 9; MENU.nextD = 2.2; // сцена починається з початку
      lobbyEl.classList.add('reveal'); lobbyEl.classList.remove('pre');
      intro.classList.add('out');
      setTimeout(() => { intro.classList.remove('on', 'out'); lobbyEl.classList.remove('reveal'); menuIntro.active = false; }, 3300);
    };
    if (el) { if (!el.paused && el.currentTime > 0) reveal(); else el.addEventListener('playing', reveal, { once: true }); }
    setTimeout(reveal, 4000); // музика не завантажилась (немає інтернету) — однаково показати меню
    window.removeEventListener('keydown', go, true); intro.removeEventListener('pointerdown', go);
  };
  intro.addEventListener('pointerdown', go);
  window.addEventListener('keydown', go, true);
}
function menuMusicBtn() { return '<button class="music" data-act="music" title="' + menuMusic.credit + '">' + (menuMusic.on ? '🔊' : '🔇') + ' Lacrimosa</button>'; }
