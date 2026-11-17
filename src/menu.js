'use strict';
// ===== Заставка меню: захід сонця, боєць біжить у сповільненні, довкола рвуться дрони =====
// Три плани: далекий (за руїнами), середній (земля бійця) і ближній. Вибух — короткий спалах і стовп землі вгору.
const MENU = {
  t: 0, scroll: 0, drones: [], booms: [], parts: [], smoke: [], craters: [], tracers: [],
  nextD: 1.2, shake: 0, flash: 0, flashX: 0, flashY: 0, hc: null, rnd: mulberry32(7),
  aim: null, aimCd: 3, flinch: 0, pace: 1, muzzle: 0, corpses: {},
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
const MENU_SHEETS = { boom: { src: 'art/menu/boom.jpg', col: [34, 22, 18], grid: [6, 4], n: 24, pow: 0.625, vid: 180 / 306 } };
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
      const l = Math.min(o[p], o[p + 1], o[p + 2]), al = Math.max(0, Math.min(1, (250 - l) / 230));
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
  MENU.shake = Math.max(0, MENU.shake - rdt * 2.4);
  const shx = (Math.random() - 0.5) * MENU.shake * 9, shy = (Math.random() - 0.5) * MENU.shake * 7;
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
  if (MENU.nextD <= 0) { MENU.nextD = mr(0.9, 2); menuSpawnDrone(L); }
  menuUpdateDrones(L, dt);
  menuUpdateFx(L, dt);
  menuUpdateHuman(L, dt);

  // ---- далекий план: за руїнами, у серпанку ----
  ctx.save(); ctx.globalAlpha = 0.55;
  menuDrawLayer(ctx, L, MENU_Z.far);
  ctx.restore();
  menuSkyline(ctx, w, h, hy + h * 0.1, sc * 0.3, S);
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
    ctx.strokeStyle = 'rgba(255,230,150,' + (1 - k) + ')'; ctx.lineWidth = 1.4 * S;
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
function menuSkyline(ctx, w, h, base, off, S) {
  const cell = 46 * S;
  ctx.fillStyle = '#2c1626';
  ctx.fillRect(-20, base - 2, w + 40, h);
  for (let i = Math.floor(off / cell) - 2, n = i + Math.ceil(w / cell) + 4; i < n; i++) {
    const x = i * cell - off, r = menuHash(i, 11);
    if (r < 0.28) {
      const bw = cell * (1.2 + menuHash(i, 12)), bh = (40 + menuHash(i, 13) * 60) * S;
      ctx.beginPath(); ctx.moveTo(x, base);
      ctx.lineTo(x, base - bh); ctx.lineTo(x + bw * 0.3, base - bh * (0.75 + menuHash(i, 14) * 0.25)); ctx.lineTo(x + bw * 0.45, base - bh * 0.55);
      ctx.lineTo(x + bw * 0.7, base - bh * (0.8 + menuHash(i, 15) * 0.2)); ctx.lineTo(x + bw, base - bh * 0.4); ctx.lineTo(x + bw, base); ctx.fill();
      ctx.fillStyle = 'rgba(240,120,70,0.25)';
      for (let fy = 1; fy < 4; fy++) for (let fx = 0; fx < 3; fx++) if (menuHash(i * 7 + fx, fy) > 0.45 && base - fy * 16 * S > base - bh * 0.55) ctx.fillRect(x + bw * (0.15 + fx * 0.27), base - fy * 16 * S, 5 * S, 7 * S);
      ctx.fillStyle = '#2c1626';
    } else if (r < 0.62) {
      const th = (18 + menuHash(i, 16) * 26) * S, cr = (9 + menuHash(i, 17) * 9) * S;
      ctx.fillRect(x - 1.5 * S, base - th, 3 * S, th);
      ctx.beginPath(); ctx.arc(x, base - th, cr, 0, 7); ctx.arc(x - cr * 0.6, base - th + cr * 0.4, cr * 0.7, 0, 7); ctx.arc(x + cr * 0.6, base - th + cr * 0.3, cr * 0.75, 0, 7); ctx.fill();
    } else if (r < 0.72) {
      ctx.save(); ctx.translate(x, base); ctx.rotate((menuHash(i, 18) - 0.5) * 0.4);
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
    const tx = d.rel != null ? L.hx + d.rel : d.sx;
    const dx = tx - d.x, dy = d.ty - d.y, dist = Math.hypot(dx, dy), sp = d.v * dt;
    if (dist <= sp) { d.dead = true; menuBoom(L, tx + MENU.scroll * d.z, d.ty, d.z, false); continue; }
    d.x += (dx / dist) * sp; d.y += (dy / dist) * sp;
    d.ang = Math.atan2(dy, dx); d.v += 240 * S * d.z * dt;
  }
  MENU.drones = MENU.drones.filter((d) => !d.dead);
}
// ---- вибух: спалах, стовп землі вгору, бурий пил, темний дим, вирва ----
function menuBoom(L, wx, y, z, air) {
  const S = L.S * (z === MENU_Z.near ? 1.15 : z === MENU_Z.far ? 0.62 : z), sc = MENU.scroll, X = wx - sc * z;
  MENU.booms.push({ wx, y, z, t: 0, max: MENU_SHEETS.boom.frames && !air ? 2.9 : 0.45, air, flip: MENU.rnd() < 0.5 });
  const near = z === MENU_Z.near, far = z === MENU_Z.far;
  MENU.shake = Math.min(1, MENU.shake + (far ? 0.15 : near ? 0.9 : 0.55));
  MENU.flash = Math.max(MENU.flash, far ? 0.3 : near ? 0.9 : 0.7); MENU.flashX = X; MENU.flashY = y;
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
    for (let i = 0; i < 18; i++) { const a = mr(0, 6.28), v = mr(60, 260) * S; P.push({ k: 'clod', z, wx, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80 * S, life: mr(1.5, 2.5), max: 2.5, r: mr(1, 2.8) * S, rot: mr(0, 6), spin: mr(-10, 10), col: '#151015' }); }
  }
  for (let i = 0; i < (air ? 10 : 0); i++) { const a = mr(Math.PI * 1.1, Math.PI * 1.9), v = mr(120, 460) * S; P.push({ k: 'ember', z, wx, y: y - 4 * S, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: mr(0.4, 1.2), max: 1.2 }); }
  // темний дим після вогню
  for (let i = 0; i < (air ? 3 : 6); i++) MENU.smoke.push({ k: 'smoke', z, wx: wx + mr(-12, 12) * S, y: y - mr(10, 40) * S, vx: mr(-10, 10) * S, vy: -mr(15, 45) * S, r: mr(14, 24) * S, life: mr(3.5, 6), max: 6, rot: mr(0, 6), spin: mr(-0.6, 0.6), v: (MENU.rnd() * 5) | 0 });
  // боєць пригинається від близького вибуху
  if (menuMusic.on && !far) menuSfxBoom(near ? 1 : 0.7);
  else if (menuMusic.on) menuSfxBoom(0.35);
}
function menuUpdateFx(L, dt) {
  const S = L.S, sc = MENU.scroll;
  for (const b of MENU.booms) b.t += dt;
  MENU.booms = MENU.booms.filter((b) => b.t < b.max);
  for (const p of MENU.parts) {
    p.life -= dt; p.wx += p.vx * dt; p.y += p.vy * dt;
    const gyp = menuGroundY(L, p.z, p.wx - sc * p.z);
    if (p.k === 'ember') { p.vy += 300 * S * p.z * dt; p.vx *= 0.985; }
    else { p.vy += 1100 * S * p.z * dt; p.rot += p.spin * dt; if (p.y > gyp && p.vy > 0) { p.y = gyp; p.vy *= -0.18; p.vx *= 0.4; p.spin *= 0.4; } }
  }
  MENU.parts = MENU.parts.filter((p) => p.life > 0 && p.wx - sc * p.z > -300);
  for (const p of MENU.smoke) { p.life -= dt; p.wx += p.vx * dt; p.y += p.vy * dt; p.vy *= p.k === 'dust' ? 0.97 : 0.995; p.vx *= 0.99; }
  MENU.smoke = MENU.smoke.filter((p) => p.life > 0);
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
  for (const b of MENU.booms) if (b.z === z) menuDrawBoom(ctx, b, b.wx - sc * z, z === MENU_Z.near ? L.S * 1.15 : S);
  if (withHuman) menuDrawHuman(ctx, L);
  for (const p of MENU.parts) {
    if (p.z !== z) continue;
    const X = p.wx - sc * z, k = p.life / p.max;
    if (p.k === 'ember') { ctx.fillStyle = 'rgba(255,' + (150 + 80 * k | 0) + ',80,' + k + ')'; ctx.fillRect(X - 1 * S, p.y - 1 * S, 2 * S, 2 * S); }
    else {
      ctx.save(); ctx.globalAlpha *= Math.min(1, k * 3);
      const sp = Math.hypot(p.vx, p.vy), tl = Math.min(6, sp * 0.012) * p.r; // слід руху
      ctx.strokeStyle = p.col; ctx.lineCap = 'round'; ctx.lineWidth = p.r * 1.4;
      ctx.beginPath(); ctx.moveTo(X, p.y); ctx.lineTo(X - (p.vx / (sp || 1)) * tl, p.y - (p.vy / (sp || 1)) * tl); ctx.stroke();
      if (p.k === 'clod') { ctx.translate(X, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.col; ctx.beginPath(); ctx.moveTo(-p.r, -p.r * 0.3); ctx.lineTo(p.r * 0.2, -p.r * 0.8); ctx.lineTo(p.r, p.r * 0.1); ctx.lineTo(-p.r * 0.3, p.r * 0.7); ctx.closePath(); ctx.fill(); }
      ctx.restore();
    }
  }
  for (const d of MENU.drones) if (d.z === z) menuDrawDrone(ctx, d.x, d.y, d.ang, S);
}
function menuDrawBoom(ctx, b, X, S) {
  const BS = MENU_SHEETS.boom;
  if (BS.frames && !b.air) {
    const n = BS.frames.length, u = b.t / b.max, ph = Math.min(n - 1.001, Math.pow(u, BS.pow || 0.75) * (n - 1)), i0 = Math.floor(ph), q = ph - i0;
    const hh = 125 * S / (BS.vid || 1), k2 = hh / BS.fh, a0 = ctx.globalAlpha * Math.min(1, (1 - u) * 6); // висота відео ≈ 125 px, продовжені краї — понад це
    ctx.save();
    ctx.translate(X, b.y + 4 * S); if (b.flip) ctx.scale(-1, 1);
    for (const [fr, al] of [[BS.frames[i0], 1], [BS.frames[i0 + 1], q]]) {
      if (!fr || al <= 0.01) continue;
      ctx.globalAlpha = a0 * al; ctx.drawImage(fr, -fr.ax * k2, -hh, fr.width * k2, hh);
    }
    ctx.restore();
  }
  const k = Math.min(1, b.t / 0.45), y = b.y;
  // короткий спалах (на землі — ледь помітний)
  const fk = b.air ? 0.3 : 0.1;
  if (k < fk) {
    const a = (1 - k / fk) * (b.air ? 1 : 0.4), r = (b.air ? 10 + k * 40 : 7 + k * 60) * S;
    const g = ctx.createRadialGradient(X, y - r * 0.2, 0, X, y - r * 0.2, r);
    g.addColorStop(0, 'rgba(255,245,210,' + a + ')'); g.addColorStop(0.5, 'rgba(255,170,70,' + a * 0.7 + ')'); g.addColorStop(1, 'rgba(255,110,40,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, y - r * 0.2, r, 0, 7); ctx.fill();
  }
  // язики вогню, що швидко гаснуть у димі
  const fa = b.air ? Math.max(0, 1 - k * 1.3) : 0;
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
function menuUpdateHuman(L, dt) {
  const H = MENU_HUMAN, S = L.S;
  H.anim += dt * 10 * (0.35 + 0.65 * MENU.pace);
  H.stance = 'stand';
  MENU.muzzle = Math.max(0, MENU.muzzle - dt);
  H.fireCd = Math.max(0, H.fireCd - dt); // віддача
  // вибрати ціль: дрон середнього плану попереду-вгорі
  MENU.aimCd -= dt;
  if (!MENU.aim && MENU.aimCd <= 0) {
    const foot = L.gy, mx = L.hx;
    const d = MENU.drones.find((q) => q.z === MENU_Z.mid && q.x - mx > 30 * S && q.y < foot - 60 * S && q.y > 20 * S);
    if (d) { MENU.aim = { d, t: 0, shot: 0 }; MENU.aimCd = mr(2.5, 5); }
  }
  if (MENU.aim) {
    const A = MENU.aim, d = A.d;
    A.t += dt;
    if (!MENU.drones.includes(d) || A.t > 1.6) { MENU.aim = null; H.aiming = false; return; }
    const mxs = L.hx, sy = L.gy - 40 * 1.25 * S, dx = d.x - mxs, dy = d.y - sy;
    H.aiming = true; H.facing = 1; H.aimA = clamp(Math.atan2(dy, Math.max(10, dx)), -1.35, 0.15);
    if (A.t > 0.18 && (A.shot -= dt) <= 0) {
      A.shot = 0.07;
      const mzx = mxs + (2 + Math.cos(H.aimA) * 34) * 1.25 * S, mzy = sy + Math.sin(H.aimA) * 34 * 1.25 * S;
      const spread = mr(-0.05, 0.05), len = Math.hypot(dx, dy) * 1.4;
      MENU.tracers.push({ x1: mzx + MENU.scroll, y1: mzy, x2: mzx + MENU.scroll + Math.cos(H.aimA + spread) * len, y2: mzy + Math.sin(H.aimA + spread) * len, t: 0, max: 0.09, sc0: 0 });
      MENU.muzzle = 0.03; H.fireCd = WEAPONS.rifle.rate;
      if (menuMusic.on) menuSfxShot();
      if (++d.hits >= d.need) { d.dead = true; MENU.drones = MENU.drones.filter((q) => q !== d); menuBoom(L, d.x + MENU.scroll * d.z, d.y, d.z, true); MENU.aim = null; H.aiming = false; }
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
function menuSfxBoom(vol) {
  const B = menuSfxBus(); if (!B) return;
  const t = B.ctx.currentTime;
  // удар: короткий глухий сплеск
  menuNoiseHit(B, t, { f0: 700, f1: 160, fT: 0.12, at: 0.006, dec: 0.35, vol: 0.9 * vol, send: 0.6 });
  // суб: тиск у грудях, шум нижче 90 Гц (без висоти тону)
  menuNoiseHit(B, t, { f0: 110, f1: 55, fT: 0.5, at: 0.015, dec: 0.9, vol: 1.3 * vol, send: 0.15, order: 3 });
  // гуркіт ґрунту, що осідає
  menuNoiseHit(B, t + 0.03, { f0: 300, f1: 80, fT: 2.4, at: 0.12, dec: 3, vol: 0.45 * vol, rate: 0.6, send: 0.5 });
}
function menuSfxShot() {
  const B = menuSfxBus(); if (!B) return;
  const t = B.ctx.currentTime;
  menuNoiseHit(B, t, { f0: 900, f1: 180, fT: 0.08, at: 0.003, dec: 0.22, vol: 0.32, send: 0.8 });
  menuNoiseHit(B, t, { f0: 140, f1: 70, fT: 0.15, at: 0.006, dec: 0.3, vol: 0.35, send: 0.2, order: 3 });
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
      MENU.t = 0; MENU.scroll = 0; MENU.drones = []; MENU.booms = []; MENU.parts = []; MENU.smoke = []; MENU.nextD = 2.2; // сцена починається з початку
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
