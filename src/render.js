'use strict';
// ===== Рендеринг =====
const THEME = {
  fields: { sky: ['#8fb8dc', '#e9e1c4'], far: '#97a982', far2: '#b5bf9c', grass: '#6c8d3a', dirt: '#5d4a30', deep: '#3a2d1c' },
  forest: { sky: ['#7f9db2', '#d3d9cb'], far: '#56704f', far2: '#7c9172', grass: '#4d6e33', dirt: '#4a3b28', deep: '#2c2418' },
  city: { sky: ['#8f9296', '#d8ccb9'], far: '#73767c', far2: '#9a9a9a', grass: '#6b6a5b', dirt: '#55504a', deep: '#33302d' },
};
// ===== Графіка з файлів (фони, ґрунт). Поки картинка не завантажилась — малюємо як раніше =====
const ART = {};
function loadArt(name, src) { const im = new Image(); im.onload = () => { ART[name] = im; }; im.src = src; }
loadArt('sky', 'art/sky.jpg');       // небо з хмарами
loadArt('far', 'art/far.png');       // дальній план: пагорби, ліс, промзона (прозоре небо)
loadArt('near', 'art/near.png');     // ближній фон: руїни, стовпи, дерева (прозорий серпанок)
loadArt('ground', 'art/ground.png'); // ґрунт у розрізі з травою (прозорий верх)
const ART_FAR = { h: 300, base: 410, cut: 413, par: 0.15, vpar: 0.6 }; // нижче cut у far.png — туман, його не малюємо  // висота шару в одиницях світу, рядок горизонту, паралакс
const ART_NEAR = { h: 250, base: 440, par: 0.4, vpar: 0.85 };
const ART_GROUND = { k: 0.15, surf: 175, step: 6 }; // одиниць світу на піксель, рядок поверхні в ground.png, ширина смуги

// картинка, що повторюється по горизонталі з дзеркальним відбиттям (щоб не було шва)
// sh — скільки рядків картинки брати (зверху)
function drawMirrorTiles(ctx, img, vp, offset, y, w, h, sh) {
  sh = sh || img.height;
  const dh = h * sh / img.height, period = w * 2;
  let start = -(((offset % period) + period) % period);
  for (let x = start, k = 0; x < vp.w; x += w, k++) {
    if (k % 2 === 0) ctx.drawImage(img, 0, 0, img.width, sh, vp.x + x, y, w + 1, dh);
    else { ctx.save(); ctx.translate(vp.x + x + w, y); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, img.width, sh, 0, 0, w + 1, dh); ctx.restore(); }
  }
}
function drawArtBackground(ctx, vp, cx, cy, s) {
  const sky = ART.sky;
  const ks = Math.max(vp.w / sky.width, vp.h / sky.height) * 1.05;
  drawMirrorTiles(ctx, sky, vp, cx * s * 0.02, vp.y + vp.h - sky.height * ks, sky.width * ks, sky.height * ks);
  const groundY = vp.y + (BASE_G - cy) * s, mid = vp.y + vp.h * 0.5;
  // земля, якою її бачить людина (камера на рівні землі); коли камера (дрон) піднімається,
  // далекі шари опускаються стільки ж разів повільніше, скільки повільніше рухаються вбік
  const refG = vp.y + vp.h - 140 * s, dG = groundY - refG;
  // дальній план
  const kf = (ART_FAR.h / ART.far.height) * s, fy = mid + (refG - mid) * ART_FAR.vpar - 24 * s + dG * ART_FAR.par;
  const ftop = fy - ART_FAR.base * kf;
  drawMirrorTiles(ctx, ART.far, vp, cx * s * ART_FAR.par, ftop, ART.far.width * kf, ART.far.height * kf, ART_FAR.cut);
  // рівнина, що тягнеться від дальнього плану до ближнього: біля обрію світла в серпанку, ближче — темніша
  const fb = ftop + ART_FAR.cut * kf - 1;
  if (fb < vp.y + vp.h) {
    const span = Math.max(40 * s, groundY - fb);
    const gr = ctx.createLinearGradient(0, fb, 0, fb + span);
    gr.addColorStop(0, '#b6b4a3'); gr.addColorStop(0.08, '#a3a28a'); gr.addColorStop(0.35, '#87876a'); gr.addColorStop(1, '#5c5a43');
    ctx.fillStyle = gr; ctx.fillRect(vp.x, fb, vp.w, vp.y + vp.h - fb);
  }
  // ближній фон
  const kn = (ART_NEAR.h / ART.near.height) * s, ny = mid + (refG - mid) * ART_NEAR.vpar - 4 * s + dG * ART_NEAR.par;
  const ntop = ny - ART_NEAR.base * kn;
  drawMirrorTiles(ctx, ART.near, vp, cx * s * ART_NEAR.par, ntop, ART.near.width * kn, ART.near.height * kn);
  // поле між ближнім фоном і землею (видно, коли дрон високо)
  const nb = ntop + ART.near.height * kn - 1;
  if (nb < vp.y + vp.h) {
    const gr = ctx.createLinearGradient(0, nb, 0, Math.max(nb + 1, groundY));
    gr.addColorStop(0, '#3a3526'); gr.addColorStop(0.5, '#4a4630'); gr.addColorStop(1, '#3d3a27');
    ctx.fillStyle = gr; ctx.fillRect(vp.x, nb, vp.w, vp.y + vp.h - nb);
  }
}
// ґрунт: текстура смугами, що йдуть за рельєфом (трава завжди на поверхні)
function drawArtGround(ctx, W, x0, x1, bottom, theme) {
  const img = ART.ground, G0 = ART_GROUND, k = G0.k, step = G0.step;
  const tw = img.width * k, sw = step / k;
  x0 = Math.max(0, Math.floor(x0 / step) * step); x1 = Math.min(W.width, x1);
  // глибше за текстуру — темний ґрунт
  ctx.beginPath(); ctx.moveTo(x0, bottom);
  for (let x = x0; x <= x1 + GS; x += GS) ctx.lineTo(x, gAt(W, x) + 60);
  ctx.lineTo(x1 + GS, bottom); ctx.closePath();
  ctx.fillStyle = '#2e2a21'; ctx.fill();
  const top = G0.surf * k, hgt = img.height * k;
  // кожна смуга нахилена під схил — край землі суцільний навіть в окопах
  const m = ctx.getTransform(), S = m.a;
  for (let x = x0; x <= x1; x += step) {
    const ya = gAt(W, x), yb = gAt(W, x + step), slope = (yb - ya) / step;
    const u = (((x % tw) + tw) % tw) / k;
    ctx.setTransform(S, S * slope, 0, S, m.e + S * x, m.f + S * ya);
    ctx.drawImage(img, u, 0, Math.min(sw, img.width - u), img.height, 0, -top, step + 0.6, hgt);
  }
  ctx.setTransform(m);
  if (W.themeAt(x0) === 'city') {
    // місто: сіріший, витоптаний ґрунт
    ctx.beginPath(); ctx.moveTo(x0, bottom);
    for (let x = x0; x <= x1 + GS; x += GS) ctx.lineTo(x, gAt(W, x) - 26);
    ctx.lineTo(x1 + GS, bottom); ctx.closePath();
    ctx.fillStyle = 'rgba(95,92,86,0.38)'; ctx.fill();
  }
}

const hash = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const FONT = (sz, w) => (w || 'bold') + ' ' + sz + 'px "Segoe UI", system-ui, sans-serif';

function layoutViews(n, w, h) {
  if (n <= 3) return Array.from({ length: n }, (_, i) => ({ x: 0, y: Math.round((i * h) / n), w, h: Math.round(h / n) }));
  const hw = Math.round(w / 2), hh = Math.round(h / 2);
  return [{ x: 0, y: 0, w: hw, h: hh }, { x: hw, y: 0, w: w - hw, h: hh }, { x: 0, y: hh, w: hw, h: h - hh }, { x: hw, y: hh, w: w - hw, h: h - hh }];
}

function renderGame(ctx, w, h, t) {
  // екран ділиться лише між живими гравцями; боти власного вікна не мають
  const real = G.players.filter((p) => !p.bot);
  const views = layoutViews(real.length, w, h);
  real.forEach((p, i) => renderView(ctx, views[i], p, t));
  ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
  for (const v of views) ctx.strokeRect(v.x, v.y, v.w, v.h);
  // стрічка подій
  ctx.textAlign = 'center'; ctx.font = FONT(15);
  G.feed.forEach((f, i) => {
    ctx.globalAlpha = Math.min(1, f.t);
    const y = (G.opts && G.opts.controls !== false ? 84 : 22) + (G.mode === 'dm' ? 38 : 0) + i * 22;
    const tw = ctx.measureText(f.text).width + 20;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(w / 2 - tw / 2, y - 15, tw, 21);
    ctx.fillStyle = f.color; ctx.fillText(f.text, w / 2, y);
  });
  ctx.globalAlpha = 1;
  if (G.mode === 'dm') drawDmBoard(ctx, w);
  if (G.over && G.overT > 0.8) renderResults(ctx, w, h);
}

function renderView(ctx, vp, p, t) {
  const W = G.W;
  const isDrone = p.role === 'drone';
  const drone = isDrone ? p.ent.drone : null;
  const human = isDrone ? null : p.ent;
  const visH = isDrone ? (p.cam.wide ? 900 : 600) : 480;
  const s = Math.min(vp.h / visH, vp.w / 700);
  const viewW = vp.w / s, viewH = vp.h / s;
  const cx = clamp(p.cam.x - viewW / 2, 0, Math.max(0, W.width - viewW));
  const cy = clamp(p.cam.y - viewH / 2, -80, BASE_G + 140 - viewH);
  const theme = THEME[W.themeAt(cx + viewW / 2)];
  const viewer = { isDrone, drone, human };

  ctx.save();
  ctx.beginPath(); ctx.rect(vp.x, vp.y, vp.w, vp.h); ctx.clip();
  // небо
  if (ART.sky && ART.far && ART.near) drawArtBackground(ctx, vp, cx, cy, s);
  else {
    const sky = ctx.createLinearGradient(0, vp.y, 0, vp.y + vp.h);
    sky.addColorStop(0, theme.sky[0]); sky.addColorStop(1, theme.sky[1]);
    ctx.fillStyle = sky; ctx.fillRect(vp.x, vp.y, vp.w, vp.h);
    drawFar(ctx, vp, cx, cy, s, theme, W);
  }

  ctx.save();
  ctx.translate(vp.x - cx * s, vp.y - cy * s);
  ctx.scale(s, s);
  const x0 = cx - 120, x1 = cx + viewW + 120;
  const inX = (a, b) => b >= x0 && a <= x1;

  for (const b of W.backs) if (inX(b.x, b.x + b.w)) { drawBack(ctx, b); if (b.net) drawNet(ctx, b.x + 8, b.y + 6, b.w - 16, Math.min(b.h - 12, 2 * FLOOR_H), b.x, true); }
  for (const tr of W.trees) if (inX(tr.x - 60, tr.x + 60)) drawTrunk(ctx, tr);
  for (const d of W.decor) if (d.type === 'road' && inX(d.x, d.x + d.w)) drawDecor(ctx, d, W);
  const netHidden = (sp) => sp.net && isDrone && !droneHovering(drone, sp.x, sp.y - 10);
  for (const sp of W.hides) if (sp.type !== 'pipe' && inX(sp.x - 40, sp.x + 40) && !netHidden(sp)) drawHideBack(ctx, sp);
  drawGround(ctx, W, x0, x1, cy + viewH + 20, theme);
  for (const sp of W.hides) if (sp.type === 'pipe' && inX(sp.a - 330, sp.b + 330)) drawTunnel(ctx, sp, W);
  for (const sp of W.hides) if (sp.type !== 'pipe' && inX(sp.x - 40, sp.x + 40) && !netHidden(sp)) { drawHideFront(ctx, sp); if (sp.net) drawNet(ctx, sp.x - 30, sp.y - (sp.type === 'bunker' ? 36 : 16), 60, sp.type === 'bunker' ? 36 : 16, sp.x); }
  for (const d of W.decor) if (d.type !== 'road' && inX(d.x - 20, d.x + 80)) drawDecor(ctx, d, W);
  for (const pd of W.pads) if (inX(pd.x - 60, pd.x + 60)) drawPad(ctx, pd, t);
  for (const sd of solidsNear(W, x0, x1)) drawSolid(ctx, sd, t);
  for (const l of W.ladders) if (inX(l.x - 15, l.x + 15)) drawLadder(ctx, l);
  for (const pk of W.pickups) if (!pk.taken && inX(pk.x - 20, pk.x + 20)) drawPickup(ctx, pk, t, human);
  const npr = human && !human.dead && !human.carry ? nearProp(human) : null;
  for (const pr of W.props) if (inX(pr.x - 20, pr.x + 20)) drawProp(ctx, pr.type, pr.x, pr.y, 0, pr === npr);
  for (const v of W.vehicles) if (inX(v.x - 60, v.x + 60)) drawVehicle(ctx, v, t);
  for (const mi of G.mines) if (inX(mi.x - 10, mi.x + 10)) drawMine(ctx, mi, t);

  // люди
  for (const h of G.humans) {
    if (!inX(h.x - 40, h.x + 40) || h.saved) continue;
    if (h.hidden) {
      if (h.hideAnim) drawHideAnim(ctx, h, t);          // заповзає в нору / заходить у бліндаж
      else if (h.peek && (!isDrone || humanVisibleToDrone(h, drone))) drawPeek(ctx, h, !isDrone);
      else if (!isDrone) drawHiddenMark(ctx, h, t);      // свої бачать, де він сидить
      continue;
    }
    if (isDrone && !humanVisibleToDrone(h, drone)) continue;
    if (h.vehicle) continue; // малюється разом із технікою нижче
    if (h.hideAnim && !h.dead) drawHideAnim(ctx, h, t); else drawHuman(ctx, h, t, 1);
    if (h.digging && !h.dead) drawShovel(ctx, h, t);
  }
  for (const m of W.mounts) if (inX(m.x - 40, m.x + 40)) drawMount(ctx, m);
  for (const th of G.throws) if (inX(th.x - 20, th.x + 20)) drawThrow(ctx, th, t);
  for (const v of W.vehicles) {
    if (v.dead || !inX(v.x - 60, v.x + 60)) continue;
    for (const o of [v.driver, v.gunner]) if (o && (!isDrone || humanVisibleToDrone(o, drone))) drawRider(ctx, v, o);
  }
  for (const ab of G.airBonuses || []) if (ab.active && inX(ab.x - 30, ab.x + 30)) drawAirBonus(ctx, ab, t);
  // дрони
  for (const d of G.drones) {
    if (!inX(d.x - 30, d.x + 30)) continue;
    if (!isDrone && !droneSeenBy(d, human, true)) {
      if (droneSeenBy(d, human)) drawDetected(ctx, d, t); // видно лише на детекторі
      continue;
    }
    drawDrone(ctx, d, t);
  }
  if (!isDrone && human && !human.dead && !human.saved) drawSoundDirs(ctx, human, t);
  // кулі
  ctx.strokeStyle = '#ffe9a0'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (const b of G.bullets) { ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.012, b.y - b.vy * 0.012); }
  ctx.stroke();
  for (const bm of G.bombs) {
    ctx.fillStyle = bm.type === 'frag' ? '#3b3b2a' : bm.type === 'mine' ? '#4d5a2a' : '#9a9a9a';
    ctx.beginPath(); ctx.ellipse(bm.x, bm.y, 3.5, 5, Math.atan2(bm.vy, bm.vx) - Math.PI / 2, 0, 7); ctx.fill();
  }
  if (!isDrone) for (const h of G.humans) {
    if (!h.aiming || h.dead || h.saved || (h.hidden && !h.peek)) continue;
    if (h.vehicle && h.seat !== 'gunner') continue;
    let mx, my;
    if (h.peek) { const m = burrowMuzzle(h); mx = m.x; my = m.y; }
    else if (h.mount) { const m = mountMuzzle(h); mx = m.x; my = m.y; }
    else if (h.carry || !h.weapon) { const m = handPos(h); mx = m.x; my = m.y; }
    else if (h.vehicle) { const T = VEH[h.vehicle.type]; mx = h.vehicle.x - h.vehicle.dir * T.len * 0.15; my = h.vehicle.y - T.h - 14; }
    else { const m = muzzle(h); mx = m.x; my = m.y; }
    const a = aimWorld(h), L = h.vehicle ? WEAPONS.mg.range : h.mount ? WEAPONS.mrifle.range : h.carry || !h.weapon ? 120 : WEAPONS[h.weapon.type].range;
    ctx.strokeStyle = h.player.color; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + Math.cos(a) * L, my + Math.sin(a) * L); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  drawParticles(ctx, x0, x1);
  // передній план — крони, кущі
  for (const tr of W.trees) if (inX(tr.x - 60, tr.x + 60)) drawCanopy(ctx, tr, isDrone ? 0.95 : 0.8);
  for (const b of W.bushes) if (inX(b.x - 10, b.x + b.w + 10)) drawBush(ctx, b, isDrone ? 0.97 : 0.78);
  // димові завіси — поверх усього
  for (const sm of G.smokes) {
    if (!inX(sm.x - sm.r, sm.x + sm.r)) continue;
    const k = Math.min(1, sm.t / 2, (sm.max - sm.t) * 2 + 0.3);
    for (let i = 0; i < 9; i++) {
      const a = sm.seed + i * 1.7, wob = Math.sin(t * 0.7 + i) * 8;
      const px = sm.x + Math.cos(a) * sm.r * 0.55 + wob, py = sm.y + Math.sin(a * 1.3) * 28 - i * 2;
      ctx.fillStyle = 'rgba(214,214,208,' + 0.55 * k + ')';
      ctx.beginPath(); ctx.arc(px, py, sm.r * (0.38 + 0.12 * Math.sin(a * 3)), 0, 7); ctx.fill();
    }
  }
  // РЕБ
  for (const r of G.rebs) {
    if (!inX(r.x - r.r, r.x + r.r)) continue;
    ctx.strokeStyle = 'rgba(187,134,252,' + (0.25 + 0.2 * Math.sin(t * 10)) + ')';
    ctx.lineWidth = 3; ctx.setLineDash([12, 10]);
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r * (1 - 0.04 * Math.sin(t * 4)), 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(187,134,252,0.06)'; ctx.fill();
  }
  ctx.restore();

  const toScreen = (x, y) => ({ x: vp.x + (x - cx) * s, y: vp.y + (y - cy) * s });
  if (isDrone) drawDroneHud(ctx, vp, p, toScreen, t, s);
  else drawHumanHud(ctx, vp, p, t);
  ctx.restore();
}

// ---------- Фон ----------
function drawFar(ctx, vp, cx, cy, s, theme, W) {
  const th = W.themeAt(cx);
  const par = 0.3;
  const baseY = vp.y + (BASE_G - 60 - cy) * s * 0.75 + vp.h * 0.08;
  ctx.fillStyle = theme.far2;
  ctx.beginPath(); ctx.moveTo(vp.x, vp.y + vp.h);
  for (let sx = 0; sx <= vp.w + 10; sx += 10) {
    const wx = cx * par * 0.6 + sx / s;
    ctx.lineTo(vp.x + sx, baseY - 50 * s - (Math.sin(wx * 0.004) * 30 + Math.sin(wx * 0.011) * 12) * s);
  }
  ctx.lineTo(vp.x + vp.w, vp.y + vp.h); ctx.fill();
  ctx.fillStyle = theme.far;
  ctx.beginPath(); ctx.moveTo(vp.x, vp.y + vp.h);
  for (let sx = 0; sx <= vp.w + 8; sx += 8) {
    const wx = cx * par + sx / s;
    let hh;
    if (th === 'city') { const b = Math.floor(wx / 70); hh = 30 + hash(b) * 110 * (hash(b * 3.1) < 0.2 ? 0.3 : 1); }
    else if (th === 'forest') hh = 50 + Math.abs(Math.sin(wx * 0.05)) * 18 + hash(Math.floor(wx / 23)) * 14;
    else hh = 20 + Math.sin(wx * 0.006) * 14 + (hash(Math.floor(wx / 180)) < 0.25 ? 26 + Math.abs(Math.sin(wx * 0.06)) * 10 : 0);
    ctx.lineTo(vp.x + sx, baseY - hh * s);
  }
  ctx.lineTo(vp.x + vp.w, vp.y + vp.h); ctx.fill();
}

function drawGround(ctx, W, x0, x1, bottom, theme) {
  if (ART.ground) { drawArtGround(ctx, W, x0, x1, bottom, theme); return; }
  x0 = Math.max(0, Math.floor(x0 / GS) * GS); x1 = Math.min(W.width, x1);
  ctx.beginPath(); ctx.moveTo(x0, bottom);
  for (let x = x0; x <= x1 + GS; x += GS) ctx.lineTo(x, gAt(W, x));
  ctx.lineTo(x1 + GS, bottom); ctx.closePath();
  const gr = ctx.createLinearGradient(0, BASE_G - 60, 0, BASE_G + 200);
  gr.addColorStop(0, theme.dirt); gr.addColorStop(1, theme.deep);
  ctx.fillStyle = gr; ctx.fill();
  ctx.beginPath();
  for (let x = x0; x <= x1 + GS; x += GS) ctx.lineTo(x, gAt(W, x) + 2);
  ctx.strokeStyle = theme.grass; ctx.lineWidth = 7; ctx.stroke();
  // травинки
  ctx.strokeStyle = theme.grass; ctx.lineWidth = 1.5; ctx.beginPath();
  for (let x = x0; x <= x1; x += 9) {
    const hh = 3 + hash(x) * 7, y = gAt(W, x);
    ctx.moveTo(x, y); ctx.lineTo(x + hash(x + 1) * 4 - 2, y - hh);
  }
  ctx.stroke();
}

function drawBack(ctx, b) {
  ctx.fillStyle = '#5a5550'; ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = b.y + 12; y < b.y + b.h; y += 12) { ctx.moveTo(b.x, y); ctx.lineTo(b.x + b.w, y); }
  ctx.stroke();
  // пробоїни
  for (let i = 0; i < 4; i++) {
    const hx = b.x + 20 + hash(b.seed * 100 + i) * (b.w - 60), hy = b.y + 15 + hash(b.seed * 50 + i) * (b.h - 60);
    ctx.fillStyle = 'rgba(160,170,180,0.55)';
    ctx.beginPath(); ctx.ellipse(hx, hy, 14 + hash(i + b.seed) * 14, 10 + hash(i * 7 + b.seed) * 10, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(b.x, b.y, b.w, b.h);
}

function drawTrunk(ctx, tr) {
  ctx.fillStyle = '#4b4134';
  const tw = tr.kind === 'poplar' ? 6 : 9;
  ctx.fillRect(tr.x - tw / 2, tr.y - tr.h * 0.75, tw, tr.h * 0.75);
}
function drawCanopy(ctx, tr, a) {
  ctx.globalAlpha = a;
  const y = tr.y - tr.h;
  if (tr.kind === 'poplar') {
    ctx.fillStyle = '#5a6143';
    ctx.beginPath(); ctx.ellipse(tr.x, y + tr.h * 0.35, tr.r * 0.55, tr.h * 0.42, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    // одна форма з кількох кіл — без темних накладань при прозорості
    ctx.fillStyle = '#61684a';
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const ox = (hash(tr.seed * 10 + i) - 0.5) * tr.r * 1.6, oy = (hash(tr.seed * 20 + i) - 0.5) * tr.r * 0.9, rr = tr.r * (0.7 + hash(i + tr.seed) * 0.4);
      ctx.moveTo(tr.x + ox + rr, y + tr.r + oy); ctx.arc(tr.x + ox, y + tr.r + oy, rr, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.fillStyle = 'rgba(160,160,118,0.3)';
    ctx.beginPath(); ctx.arc(tr.x - tr.r * 0.3, y + tr.r * 0.7, tr.r * 0.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function drawBush(ctx, b, a) {
  ctx.globalAlpha = a;
  ctx.fillStyle = '#676c4b';
  const n = Math.max(2, Math.round(b.w / 28));
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const bx = b.x + (i + 0.5) * (b.w / n), r = b.h * (0.45 + hash(b.seed * 9 + i) * 0.25);
    ctx.moveTo(bx + r, b.y - r * 0.8); ctx.arc(bx, b.y - r * 0.8, r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawHideBack(ctx, sp) {
  if (sp.ruined) {
    ctx.fillStyle = sp.type === 'bunker' ? '#4a3c29' : '#5e4b31';
    ctx.beginPath(); ctx.moveTo(sp.x - 40, sp.y + 2);
    for (let i = 0; i <= 8; i++) ctx.lineTo(sp.x - 40 + i * 10, sp.y - (sp.type === 'bunker' ? 14 : 8) * Math.sin((i / 8) * Math.PI) - hash(sp.x + i) * 6);
    ctx.closePath(); ctx.fill();
    return;
  }
  if (sp.type === 'bunker') {
    ctx.fillStyle = '#5b4a32';
    ctx.beginPath(); ctx.ellipse(sp.x, sp.y, 46, 26, 0, Math.PI, 0); ctx.fill();
  } else if (sp.type === 'burrow') {
    ctx.fillStyle = '#6b5638';
    ctx.beginPath(); ctx.ellipse(sp.x + 22, sp.y, 20, 9, 0, Math.PI, 0); ctx.fill();
  }
}
function drawHideFront(ctx, sp) {
  if (sp.ruined) {
    ctx.strokeStyle = '#3a2c1c'; ctx.lineWidth = 4;
    if (sp.type === 'bunker') for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(sp.x - 26 + i * 18, sp.y - 4 - hash(sp.x + i * 3) * 10); ctx.lineTo(sp.x - 8 + i * 18, sp.y - 12 + hash(sp.x + i) * 8); ctx.stroke();
    }
    return;
  }
  if (sp.type === 'bunker') {
    ctx.fillStyle = '#1b1510'; ctx.fillRect(sp.x - 15, sp.y - 26, 30, 26);
    ctx.fillStyle = '#6e5233';
    ctx.fillRect(sp.x - 20, sp.y - 30, 40, 6);
    ctx.fillRect(sp.x - 20, sp.y - 26, 5, 26); ctx.fillRect(sp.x + 15, sp.y - 26, 5, 26);
  } else if (sp.type === 'burrow') {
    ctx.fillStyle = '#140f0a';
    ctx.beginPath(); ctx.ellipse(sp.x, sp.y - 2, 16, 8, 0, 0, Math.PI * 2); ctx.fill();
  }
}
// тунель у розрізі: виритий окоп під землею з кріпленням або бетонний колектор
function drawTunnel(ctx, sp, W) {
  const sewer = sp.style === 'sewer', H = TUN_H;
  const fl = (x) => tunFloor(W, sp, x);
  const jag = (x, k) => (sewer ? 0 : (hash(Math.round(x / 7) * 7 + k) - 0.5) * 5);
  const cave = sewer ? '#1c1e20' : '#1d1610', wall = sewer ? '#6d6f70' : '#3b2c1c';
  // галерея
  ctx.fillStyle = cave;
  ctx.beginPath();
  ctx.moveTo(sp.a - (sewer ? 0 : 6), fl(sp.a) - H / 2);
  for (let x = sp.a; x <= sp.b; x += 7) ctx.lineTo(x, fl(x) - H + jag(x, 1));
  ctx.lineTo(sp.b, fl(sp.b) - H); ctx.lineTo(sp.b + (sewer ? 0 : 6), fl(sp.b) - H / 2); ctx.lineTo(sp.b, fl(sp.b) + 3);
  for (let x = sp.b; x >= sp.a; x -= 7) ctx.lineTo(x, fl(x) + 3 + jag(x, 2) * 0.5);
  ctx.lineTo(sp.a, fl(sp.a) + 3); ctx.closePath(); ctx.fill();
  // стеля й підлога
  ctx.strokeStyle = sewer ? '#7a7c7d' : '#120d08'; ctx.lineWidth = sewer ? 5 : 3;
  ctx.beginPath(); for (let x = sp.a; x <= sp.b; x += 7) ctx.lineTo(x, fl(x) - H + jag(x, 1)); ctx.stroke();
  ctx.strokeStyle = sewer ? '#3d4a46' : '#4a3825'; ctx.lineWidth = sewer ? 6 : 4;
  ctx.beginPath(); for (let x = sp.a; x <= sp.b; x += 7) ctx.lineTo(x, fl(x) + 1); ctx.stroke();
  if (sewer) {
    ctx.strokeStyle = '#7a7c7d'; ctx.lineWidth = 4;
    ctx.beginPath(); for (let x = sp.a; x <= sp.b; x += 7) ctx.lineTo(x, fl(x) + 5); ctx.stroke();
  } else {
    // дерев'яне кріплення: стояк і балка під стелею
    for (let x = Math.ceil((sp.a + 18) / 58) * 58; x < sp.b - 10; x += 58) {
      const f = fl(x);
      ctx.fillStyle = '#5e4227'; ctx.fillRect(x - 2, f - H + 2, 4, H - 1);
      ctx.fillStyle = '#6b4a2b'; ctx.fillRect(x - 12, f - H + 1, 24, 4);
    }
  }

  // спуски й лази — поверх галереї, щоб прорізати її стелю
  for (const e of sp.exits) {
    ctx.fillStyle = cave;
    if (e.kind === 'shaft') {
      const w = sewer ? 26 : 30;
      ctx.fillRect(e.bx - w / 2, e.ty, w, e.by - e.ty - 2);
      ctx.fillStyle = wall;
      ctx.fillRect(e.bx - w / 2 - 4, e.ty, 4, e.by - e.ty - H + 4); ctx.fillRect(e.bx + w / 2, e.ty, 4, e.by - e.ty - H + 4);
      // драбина
      ctx.strokeStyle = sewer ? '#8d8f90' : '#8a6a42'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(e.bx - 7, e.ty + 2); ctx.lineTo(e.bx - 7, e.by); ctx.moveTo(e.bx + 7, e.ty + 2); ctx.lineTo(e.bx + 7, e.by);
      for (let y = e.ty + 8; y < e.by - 2; y += 9) { ctx.moveTo(e.bx - 7, y); ctx.lineTo(e.bx + 7, y); }
      ctx.stroke();
      if (sewer) { ctx.fillStyle = '#5c5e60'; ctx.fillRect(e.bx - 19, e.ty - 3, 38, 5); ctx.fillStyle = '#2e3032'; ctx.fillRect(e.bx - 13, e.ty - 2, 26, 2); }
      else { ctx.fillStyle = '#6b4a2b'; ctx.fillRect(e.bx - 21, e.ty - 3, 42, 5); }
      continue;
    }
    // похилий спуск: підлога B→T, стеля паралельно до перетину з поверхнею
    let cx = 0;
    while (cx < 300 && e.by - H - TUN_K * cx > gAt(W, e.bx + e.dir * cx)) cx += 1;
    const C = { x: e.bx + e.dir * cx, y: gAt(W, e.bx + e.dir * cx) };
    ctx.beginPath(); ctx.moveTo(e.bx - e.dir * 8, e.by + 3); ctx.lineTo(e.tx + e.dir * 3, e.ty + 1);
    ctx.lineTo(C.x, C.y); ctx.lineTo(e.bx - e.dir * 8, e.by - H); ctx.closePath(); ctx.fill();
    // сходинки, вирізані в ґрунті
    ctx.fillStyle = '#4a3825';
    const n = Math.floor(e.len / 10);
    for (let i = 1; i < n; i++) { const p = tunExitPos(e, i / n); ctx.fillRect(Math.min(p.x, p.x - e.dir * 8), p.y - 1, 8, 3); }
    // край стелі й балка над входом
    ctx.strokeStyle = '#120d08'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(e.bx, e.by - H); ctx.lineTo(C.x, C.y); ctx.stroke();
    ctx.fillStyle = '#6b4a2b'; ctx.save(); ctx.translate(C.x, C.y + 2); ctx.rotate(Math.atan2(-TUN_K, e.dir)); ctx.fillRect(-4, -3, 22, 6); ctx.restore();
    // відвал викопаного ґрунту біля входу
    ctx.fillStyle = '#5a4630';
    ctx.beginPath(); ctx.ellipse(e.tx + e.dir * 22, e.ty, 18, 6, 0, Math.PI, 0); ctx.fill();
  }
}
function drawDecor(ctx, d, W) {
  const y = gAt(W, d.x + (d.w || 30) / 2);
  if (d.type === 'road') {
    ctx.fillStyle = '#3f3d3a';
    ctx.beginPath();
    for (let x = d.x; x <= d.x + d.w; x += GS) ctx.lineTo(x, gAt(W, x) - 1);
    for (let x = d.x + d.w; x >= d.x; x -= GS) ctx.lineTo(x, gAt(W, x) + 7);
    ctx.fill();
  } else if (d.type === 'sandbags') {
    ctx.fillStyle = '#9c8a62';
    for (let r = 0; r < 2; r++) for (let i = 0; i < 3 - r; i++) {
      ctx.beginPath(); ctx.ellipse(d.x + 8 + i * 15 + r * 7, y - 6 - r * 10, 9, 6, 0, 0, Math.PI * 2); ctx.fill();
    }
  } else if (d.type === 'crate') {
    ctx.fillStyle = '#6e5a3a'; ctx.fillRect(d.x, y - 16, 22, 16);
    ctx.strokeStyle = '#4a3b24'; ctx.lineWidth = 2; ctx.strokeRect(d.x, y - 16, 22, 16);
  }
}
function drawPad(ctx, pad, t) {
  ctx.fillStyle = '#444'; ctx.fillRect(pad.x - 40, pad.y - 6, 80, 8);
  ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pad.x, pad.y - 2, 9, Math.PI, 0); ctx.stroke();
  ctx.fillStyle = '#ddd'; ctx.font = FONT(11); ctx.textAlign = 'center';
  ctx.fillText('СТАРТ ДРОНІВ №' + pad.n, pad.x, pad.y - 16);
  ctx.fillStyle = Math.sin(t * 6) > 0 ? '#f33' : '#600';
  ctx.fillRect(pad.x - 40, pad.y - 10, 5, 5); ctx.fillRect(pad.x + 35, pad.y - 10, 5, 5);
}

// контур шматка з рваними краями там, де його вибило вибухом
function brokenPath(ctx, s) {
  const D = 6, st = 5;
  const tooth = (i, k) => hash(s.x * 0.37 + s.y * 0.71 + i * 1.3 + k) * D;
  ctx.beginPath(); ctx.moveTo(s.x, s.y);
  if (s.bt) for (let x = s.x, i = 0; x < s.x + s.w; x += st, i++) ctx.lineTo(x, s.y + tooth(i, 1));
  ctx.lineTo(s.x + s.w, s.y);
  if (s.br) for (let y = s.y, i = 0; y < s.y + s.h; y += st, i++) ctx.lineTo(s.x + s.w - tooth(i, 2), y);
  ctx.lineTo(s.x + s.w, s.y + s.h);
  if (s.bb) for (let x = s.x + s.w, i = 0; x > s.x; x -= st, i++) ctx.lineTo(x, s.y + s.h - tooth(i, 3));
  ctx.lineTo(s.x, s.y + s.h);
  if (s.bl) for (let y = s.y + s.h, i = 0; y > s.y; y -= st, i++) ctx.lineTo(s.x + tooth(i, 4), y);
  ctx.closePath();
}
function drawSolid(ctx, s, t) {
  if (!(s.bt || s.bb || s.bl || s.br)) { drawSolidBody(ctx, s, t); return; }
  ctx.save(); brokenPath(ctx, s); ctx.clip();
  drawSolidBody(ctx, s, t);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; brokenPath(ctx, s); ctx.stroke();
  ctx.restore();
}
function drawSolidBody(ctx, s, t) {
  switch (s.type) {
    case 'hay':
      ctx.fillStyle = '#c9a74b';
      roundRect(ctx, s.x, s.y, s.w, s.h, 14); ctx.fill();
      ctx.strokeStyle = '#a58637'; ctx.lineWidth = 2;
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(s.x + 4, s.y + i * s.h / 4); ctx.lineTo(s.x + s.w - 4, s.y + i * s.h / 4); ctx.stroke(); }
      break;
    case 'log':
      ctx.fillStyle = '#6b4e2e'; roundRect(ctx, s.x, s.y, s.w, s.h, 10); ctx.fill();
      ctx.fillStyle = '#a07a4a'; ctx.beginPath(); ctx.ellipse(s.x + s.w - 5, s.y + s.h / 2, 5, s.h / 2 - 1, 0, 0, Math.PI * 2); ctx.fill();
      break;
    case 'wreck':
      ctx.fillStyle = '#4b3b30'; roundRect(ctx, s.x, s.y + 12, s.w, s.h - 12, 4); ctx.fill();
      ctx.fillStyle = '#3d302a'; roundRect(ctx, s.x + 16, s.y, s.w - 36, 16, 4); ctx.fill();
      ctx.fillStyle = '#1d1d1d'; ctx.beginPath(); ctx.arc(s.x + 18, s.y + s.h - 4, 9, 0, 7); ctx.arc(s.x + s.w - 18, s.y + s.h - 4, 9, 0, 7); ctx.fill();
      ctx.fillStyle = '#7a4a22'; ctx.fillRect(s.x + 30, s.y + 18, 20, 6);
      break;
    case 'block':
      ctx.fillStyle = '#9a9890'; ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.strokeStyle = '#6d6b65'; ctx.lineWidth = 2; ctx.strokeRect(s.x + 1, s.y + 1, s.w - 2, s.h - 2);
      break;
    case 'rubble':
      ctx.fillStyle = '#7b736a';
      ctx.beginPath(); ctx.moveTo(s.x, s.y + s.h);
      ctx.lineTo(s.x + 4, s.y + 6); ctx.lineTo(s.x + s.w * 0.3, s.y); ctx.lineTo(s.x + s.w * 0.7, s.y + 3); ctx.lineTo(s.x + s.w - 3, s.y + 5); ctx.lineTo(s.x + s.w, s.y + s.h);
      ctx.fill();
      ctx.fillStyle = '#5f5850';
      for (let i = 0; i < 4; i++) ctx.fillRect(s.x + hash(s.x + i) * (s.w - 14), s.y + 6 + hash(s.y + i) * (s.h - 10), 12, 6);
      break;
    case 'wall':
      ctx.fillStyle = '#8a6b56'; ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      for (let y = s.y; y < s.y + s.h; y += 8) ctx.fillRect(s.x, y, s.w, 1);
      break;
    case 'floor':
      ctx.fillStyle = '#8e8a83'; ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = '#6a665f'; ctx.fillRect(s.x, s.y + s.h - 3, s.w, 3);
      break;
    case 'roof':
      ctx.fillStyle = '#6e6a63'; ctx.fillRect(s.x, s.y, s.w, s.h);
      break;
    case 'shelter': {
      ctx.fillStyle = '#9d9d96'; ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = '#85857e';
      for (let x = s.x; x < s.x + s.w; x += 40) ctx.fillRect(x, s.y, 2, s.h);
      ctx.fillStyle = '#6d6d66'; ctx.fillRect(s.x - 10, s.y - 12, s.w + 20, 14);
      // двері
      const dx = s.x - 36;
      ctx.fillStyle = '#2f4a2f'; ctx.fillRect(dx, s.y + s.h - 76, 36, 76);
      ctx.fillStyle = '#5c7f5c'; ctx.fillRect(dx + 4, s.y + s.h - 72, 28, 68);
      ctx.fillStyle = '#6d6d66'; ctx.fillRect(dx - 4, s.y + s.h - 84, 44, 10);
      ctx.fillStyle = Math.sin(t * 4) > 0 ? '#7f7' : '#3a3';
      ctx.beginPath(); ctx.arc(dx + 18, s.y + s.h - 92, 5, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = FONT(20); ctx.textAlign = 'center';
      ctx.fillText('УКРИТТЯ', s.x + s.w / 2, s.y + 40);
      ctx.font = FONT(13); ctx.fillText('вхід ←', s.x + s.w / 2, s.y + 62);
      break;
    }
    case 'plywood': {
      ctx.fillStyle = '#c9a36a'; ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = 'rgba(120,80,30,0.35)';
      if (s.w >= s.h) for (let y = s.y + 3; y < s.y + s.h - 1; y += 4) ctx.fillRect(s.x, y, s.w, 1);
      else for (let x = s.x + 3; x < s.x + s.w - 1; x += 4) ctx.fillRect(x, s.y, 1, s.h);
      ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 1.5; ctx.strokeRect(s.x + 0.75, s.y + 0.75, s.w - 1.5, s.h - 1.5);
      ctx.fillStyle = '#4a4a4a';
      for (const [nx, ny] of [[s.x + 2, s.y + 2], [s.x + s.w - 4, s.y + 2], [s.x + 2, s.y + s.h - 4], [s.x + s.w - 4, s.y + s.h - 4]]) ctx.fillRect(nx, ny, 2, 2);
      break;
    }
    default:
      ctx.fillStyle = '#777'; ctx.fillRect(s.x, s.y, s.w, s.h);
  }
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function drawLadder(ctx, l) {
  ctx.strokeStyle = '#b08850'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(l.x - 9, l.top - 6); ctx.lineTo(l.x - 9, l.bottom); ctx.moveTo(l.x + 9, l.top - 6); ctx.lineTo(l.x + 9, l.bottom);
  for (let y = l.bottom - 10; y > l.top - 4; y -= 14) { ctx.moveTo(l.x - 9, y); ctx.lineTo(l.x + 9, y); }
  ctx.stroke();
}
const PICKUP_STYLE = { rifle: ['#3b4a2f', 'АК'], shotgun: ['#5a3d24', 'ДР'], reb: ['#5b3b8a', 'РЕБ'], medkit: ['#e8e8e8', '+'], fuel: ['#a8322d', 'ПАЛ'], armor: ['#4a5568', 'БР'], detector: ['#22625c', 'ДЕТ'], pack: ['#6b5a3a', 'РЮК'], shovel: ['#7a5a32', 'ЛОП'], grenade: ['#4d5a2a', 'ГРН'] };
// маскувальна сітка: зелено-коричнева сітка з «листям»
function drawNet(ctx, x, y, w, h, seed, light) {
  ctx.save();
  ctx.globalAlpha = light ? 0.55 : 0.9;
  ctx.strokeStyle = '#4b5a2c'; ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i <= w; i += 7) { ctx.moveTo(x + i, y); ctx.lineTo(x + i - 6, y + h); }
  for (let i = 0; i <= w; i += 7) { ctx.moveTo(x + i, y); ctx.lineTo(x + i + 6, y + h); }
  ctx.stroke();
  const n = Math.max(6, (w * h) / 90);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 3 === 0 ? '#6b5a35' : i % 3 === 1 ? '#3f5225' : '#58693a';
    ctx.fillRect(x + hash(seed + i * 1.3) * w - 3, y + hash(seed + i * 2.7) * h - 2, 6, 4);
  }
  ctx.restore();
}
// дрон, якого видно лише детектором
function drawDetected(ctx, d, t) {
  ctx.save(); ctx.globalAlpha = 0.45; drawDrone(ctx, d, t); ctx.restore();
  const r = 15 + (t * 30) % 12;
  ctx.strokeStyle = '#5ad1c4'; ctx.lineWidth = 2; ctx.globalAlpha = 1 - ((t * 30) % 12) / 14;
  ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
}
// звідки чути дрон, якого не видно (приблизно)
function drawSoundDirs(ctx, h, t) {
  const e = humanEye(h);
  for (const d of G.drones) {
    if (d.landed || droneSeenBy(d, h)) continue;
    const dd = dist(d.x, d.y, e.x, e.y);
    if (dd > 900) continue;
    if (d.sndSeed == null) d.sndSeed = Math.random() * 10;
    const a = Math.atan2(d.y - e.y, d.x - e.x) + Math.sin(t * 0.8 + d.sndSeed) * 0.3; // неточно
    const k = 1 - dd / 900, r = 58;
    ctx.strokeStyle = 'rgba(255,110,110,' + (0.25 + 0.65 * k) + ')';
    for (let i = 0; i < 3; i++) {
      ctx.lineWidth = 3 - i * 0.6;
      ctx.beginPath(); ctx.arc(e.x, e.y, r + i * 9, a - 0.3 + i * 0.05, a + 0.3 - i * 0.05); ctx.stroke();
    }
  }
}
function drawAirBonus(ctx, b, t) {
  if (b.life < 5 && (t * 6 | 0) % 2) return; // скоро зникне — блимає
  const A = AIR_BONUS[b.type], y = b.y + Math.sin(t * 2 + b.seed) * 5, r = 11 + Math.sin(t * 5 + b.seed) * 1.5;
  ctx.fillStyle = A.color; ctx.globalAlpha = 0.25;
  ctx.beginPath(); ctx.arc(b.x, y, r + 7, 0, 7); ctx.fill();
  ctx.globalAlpha = 1; ctx.strokeStyle = A.color; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(b.x, y, r, 0, 7); ctx.stroke();
  ctx.fillStyle = A.color; ctx.font = FONT(9); ctx.textAlign = 'center';
  ctx.fillText(A.short, b.x, y + 3);
}
function drawMine(ctx, m, t) {
  ctx.fillStyle = '#3f4a25';
  ctx.beginPath(); ctx.ellipse(m.x, m.y - 2, 7, 3.2, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#2b3318'; ctx.fillRect(m.x - 2, m.y - 6, 4, 3);
  if (m.arm <= 0 && Math.sin(t * 5 + m.seed) > 0.85) { ctx.fillStyle = '#ff3b3b'; ctx.fillRect(m.x - 1, m.y - 7, 2, 2); }
}
// людина заповзає в нору / заходить у бліндаж (або вилазить назад)
function drawHideAnim(ctx, h, t) {
  const a = h.hideAnim, sp = a.sp;
  const k = clamp(a.t / a.dur, 0, 1), p = a.dir === 'in' ? k : 1 - k; // p: 0 — назовні, 1 — всередині
  const fake = Object.assign({}, h, { hidden: { type: 'pipe' }, dead: false, aiming: false, alT: 0 });
  if (sp.type === 'burrow') {
    const f = a.dir === 'in' ? (Math.sign(sp.x - a.fx) || a.facing || 1) : -(a.facing || 1);
    ctx.save();
    ctx.beginPath(); ctx.rect(sp.x - 140, sp.y - 300, 280, 299); ctx.clip(); // нижче землі не видно
    ctx.translate(sp.x, sp.y - 1); ctx.scale(f, 1); ctx.rotate(p * 1.05);
    fake.x = -26 + p * 42; fake.y = 2; fake.facing = 1; fake.stance = 'prone'; fake.anim = t * 6;
    drawHuman(ctx, fake, t, 1);
    ctx.restore();
  } else {
    const from = a.dir === 'in' ? a.fx : sp.x + (a.facing || 1) * 26;
    fake.hidden = null; fake.stance = 'crouch'; fake.vx = 90; fake.anim = t * 9;
    fake.x = lerp(from, sp.x, Math.min(1, p * 1.5)); fake.y = sp.y;
    fake.facing = (Math.sign(sp.x - from) || 1) * (a.dir === 'in' ? 1 : -1);
    drawHuman(ctx, fake, t, 1 - Math.max(0, (p - 0.45) / 0.55));
  }
}
// де сидить схована людина — бачать лише люди (не дрон)
function drawHiddenMark(ctx, h, t) {
  const sp = h.hidden;
  if (sp.type === 'pipe') { drawHuman(ctx, h, t, 0.9); if (h.digT > 0) drawShovel(ctx, h, t); return; }
  const y = sp.type === 'burrow' ? sp.y - 5 : sp.y - 16;
  ctx.fillStyle = h.player.color; ctx.globalAlpha = 0.9;
  ctx.beginPath(); ctx.arc(sp.x, y, 7, Math.PI, 0); ctx.fill();
  const blink = Math.sin(t * 1.7 + sp.x) > 0.96;
  if (!blink) { ctx.fillStyle = '#fff'; ctx.fillRect(sp.x - 4, y + 1, 2.5, 2.5); ctx.fillRect(sp.x + 1.5, y + 1, 2.5, 2.5); }
  ctx.globalAlpha = 1;
  ctx.fillStyle = h.player.color; ctx.font = FONT(10); ctx.textAlign = 'center';
  ctx.fillText(h.player.name, sp.x, y - 12);
}
// визирає з нори: голова й ствол над отвором
function drawPeek(ctx, h, label) {
  const sp = h.hidden, bunker = sp.type === 'bunker', x = sp.x, y = sp.y - (bunker ? 16 : 7);
  if (h.weapon) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(aimWorld(h));
    ctx.fillStyle = '#222'; ctx.fillRect(2, -1.5, h.weapon.type === 'shotgun' ? 20 : 24, 3.5);
    ctx.restore();
  }
  ctx.fillStyle = '#d9b48f'; ctx.beginPath(); ctx.arc(x - h.facing * 2, y - 3, 5.5, 0, 7); ctx.fill();
  ctx.fillStyle = '#4a5a32'; ctx.beginPath(); ctx.arc(x - h.facing * 2, y - 4, 7, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
  if (bunker) { ctx.fillStyle = '#6e5233'; ctx.fillRect(sp.x - 20, sp.y - 30, 40, 6); } // перекриття над бійницею
  else { ctx.fillStyle = '#140f0a'; ctx.beginPath(); ctx.ellipse(x, sp.y - 1, 16, 5, 0, 0, Math.PI); ctx.fill(); }
  if (label) { ctx.fillStyle = h.player.color; ctx.font = FONT(10); ctx.textAlign = 'center'; ctx.fillText(h.player.name, x, y - 16); }
}
// предмет побуту; (x, y) — середина низу
function drawProp(ctx, type, x, y, rot, label) {
  ctx.save(); ctx.translate(x, y); if (rot) { ctx.translate(0, -6); ctx.rotate(rot); ctx.translate(0, 6); }
  switch (type) {
    case 'jar':
      ctx.fillStyle = 'rgba(190,220,190,0.75)'; roundRect(ctx, -4.5, -12, 9, 12, 2); ctx.fill();
      ctx.fillStyle = '#4e7d2c'; ctx.fillRect(-3, -9, 2, 7); ctx.fillRect(0, -10, 2.5, 8); ctx.fillStyle = '#6a9a3a'; ctx.fillRect(-1, -6, 2, 5);
      ctx.fillStyle = '#c9a227'; ctx.fillRect(-4.5, -14, 9, 2.5);
      break;
    case 'chair':
      ctx.strokeStyle = '#7a4f2a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-7, -11); ctx.lineTo(7, -11); ctx.lineTo(7, 0); ctx.moveTo(7, -11); ctx.lineTo(7, -24); ctx.stroke();
      ctx.fillStyle = '#93623a'; ctx.fillRect(-8, -13, 16, 3); ctx.fillRect(5, -24, 4, 9);
      break;
    case 'stool':
      ctx.strokeStyle = '#7a4f2a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-5, 0); ctx.lineTo(-3, -12); ctx.moveTo(5, 0); ctx.lineTo(3, -12); ctx.stroke();
      ctx.fillStyle = '#a06c40'; ctx.fillRect(-7, -14, 14, 3);
      break;
    case 'pot':
      ctx.fillStyle = '#8f969c'; roundRect(ctx, -7, -10, 14, 10, 2); ctx.fill();
      ctx.fillStyle = '#6c7378'; ctx.fillRect(-9, -9, 3, 2); ctx.fillRect(6, -9, 3, 2); ctx.fillRect(-7.5, -11, 15, 2);
      break;
    case 'brick':
      ctx.fillStyle = '#a24f34'; ctx.fillRect(-6, -6, 12, 6);
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(-6, -1.5, 12, 1.5);
      break;
    case 'tv':
      ctx.fillStyle = '#3b3530'; roundRect(ctx, -9, -15, 18, 14, 2); ctx.fill();
      ctx.fillStyle = '#6f8a8c'; roundRect(ctx, -7, -13, 11, 10, 2); ctx.fill();
      ctx.fillStyle = '#222'; ctx.fillRect(-6, -1, 3, 1); ctx.fillRect(3, -1, 3, 1); ctx.fillStyle = '#b9a07a'; ctx.fillRect(5, -12, 2, 2);
      break;
    case 'iron':
      ctx.fillStyle = '#5a6f8a'; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.lineTo(3, -6); ctx.lineTo(-4, -6); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-3, -6); ctx.lineTo(-2, -9); ctx.lineTo(3, -9); ctx.lineTo(3, -6); ctx.stroke();
      break;
  }
  ctx.restore();
  if (label) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = FONT(9); ctx.textAlign = 'center'; ctx.fillText(PROP_TYPES[type].name, x, y - 28); }
}
function drawThrow(ctx, th, t) {
  if (th.kind === 'prop') { ctx.save(); ctx.translate(th.x, th.y); ctx.rotate(th.rot); drawProp(ctx, th.type, 0, 6, 0); ctx.restore(); return; }
  ctx.save(); ctx.translate(th.x, th.y); ctx.rotate(th.rot);
  ctx.fillStyle = '#3d4a22'; ctx.beginPath(); ctx.ellipse(0, 0, 3.5, 4.5, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#999'; ctx.fillRect(-1, -6.5, 2, 2.5);
  ctx.restore();
  if (th.fuse < 0.8 && (t * 12 | 0) % 2) { ctx.fillStyle = '#ff5a5a'; ctx.beginPath(); ctx.arc(th.x, th.y - 9, 2, 0, 7); ctx.fill(); }
}
// станкова гвинтівка на тринозі біля вікна
function drawMount(ctx, m) {
  const px = m.x, py = m.y - 38, a = m.user ? aimWorld(m.user) : m.dir > 0 ? 0.05 : Math.PI - 0.05;
  ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(px, py + 4); ctx.lineTo(px - 9, m.y); ctx.moveTo(px, py + 4); ctx.lineTo(px + 9, m.y); ctx.moveTo(px, py + 4); ctx.lineTo(px + m.dir * 3, m.y); ctx.stroke();
  ctx.save(); ctx.translate(px, py); ctx.rotate(a);
  ctx.fillStyle = '#5a3d24'; ctx.fillRect(-14, -2, 12, 5);
  ctx.fillStyle = '#1e1e1e'; ctx.fillRect(-3, -2, 30, 3.5); ctx.fillRect(4, -6, 9, 3);
  ctx.restore();
  ctx.fillStyle = '#3a3a3a'; ctx.beginPath(); ctx.arc(px, py + 2, 2.5, 0, 7); ctx.fill();
}
// схема місцевості для вибору точки злету
function drawLaunchMap(ctx, vw, vh, dp, c, t) {
  const W = G.W, mx = 24, mw = vw - 48, mh = 70, my = vh - mh - 22;
  panel(ctx, mx - 10, my - 22, mw + 20, mh + 30);
  ctx.textAlign = 'left'; ctx.font = FONT(12, '600'); ctx.fillStyle = '#f2c94c';
  ctx.fillText('СХЕМА МІСЦЕВОСТІ — точка злету', mx, my - 7);
  ctx.textAlign = 'right'; ctx.fillStyle = '#ccc'; ctx.font = FONT(11);
  ctx.fillText('[' + c.label('interact') + '] наступна  [' + c.label('aim') + '] попередня', mx + mw, my - 7);
  const sx = (x) => mx + (x / W.width) * mw, base = my + mh - 16, sy = (y) => base - (BASE_G - y) * 0.11;
  // рельєф
  ctx.fillStyle = '#5b5a40'; ctx.beginPath(); ctx.moveTo(mx, my + mh);
  for (let i = 0; i <= 160; i++) { const x = (W.width * i) / 160; ctx.lineTo(sx(x), sy(gAt(W, x))); }
  ctx.lineTo(mx + mw, my + mh); ctx.closePath(); ctx.fill();
  for (const cv of W.covers) {
    if (cv.type === 'trees') { ctx.fillStyle = '#3f6a32'; ctx.fillRect(sx(cv.x), sy(gAt(W, cv.x)) - 7, Math.max(2, sx(cv.x + cv.w) - sx(cv.x)), 6); }
    else if (cv.type === 'trench') { ctx.fillStyle = '#2a2418'; ctx.fillRect(sx(cv.x), sy(cv.y) + 1, Math.max(2, sx(cv.x + cv.w) - sx(cv.x)), 3); }
  }
  for (const b of W.backs) { ctx.fillStyle = '#8c7d6c'; ctx.fillRect(sx(b.x), sy(b.y), Math.max(2, sx(b.x + b.w) - sx(b.x)), sy(b.y + b.h) - sy(b.y)); }
  ctx.fillStyle = '#9d9d96'; const shx = sx(W.shelter.x + 36);
  ctx.fillRect(shx, sy(W.shelter.y) - 12, Math.max(4, sx(W.shelter.x + 356) - shx), 12);
  ctx.textAlign = 'center'; ctx.font = FONT(9); ctx.fillStyle = '#9f9'; ctx.fillText('УКРИТТЯ', shx + 8, sy(W.shelter.y) - 16);
  ctx.fillStyle = '#ddd'; ctx.fillText('СТАРТ ЛЮДЕЙ', sx(W.start.x) + 34, sy(gAt(W, W.start.x)) + 13);
  // точки злету
  W.pads.forEach((p, i) => {
    const x = sx(p.x), y = sy(p.y) - 10, ok = padOk(i), sel = i === dp.pad;
    if (sel) { ctx.strokeStyle = '#f2c94c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 10 + Math.sin(t * 5) * 1.5, 0, 7); ctx.stroke(); }
    ctx.fillStyle = !ok ? '#555' : sel ? '#f2c94c' : '#56ccf2';
    ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.fill();
    ctx.fillStyle = '#111'; ctx.font = FONT(10); ctx.fillText(String(p.n), x, y + 3.5);
    if (!ok) { ctx.fillStyle = '#ff7a7a'; ctx.font = FONT(9); ctx.fillText('люди поруч', Math.max(x, mx + 22), y - 13); }
    else if (sel) { ctx.fillStyle = '#f2c94c'; ctx.font = FONT(9); ctx.fillText('злет тут', Math.max(x, mx + 18), y - 13); }
  });
  ctx.textAlign = 'left';
}
// лопата в руках, коли людина копає
function drawShovel(ctx, h, t) {
  const a = 0.9 + Math.sin(t * 12) * 0.45;
  ctx.save(); ctx.translate(h.x + h.facing * 6, h.y - 22); ctx.scale(h.facing, 1); ctx.rotate(a);
  ctx.strokeStyle = '#8a6a42'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(18, 0); ctx.stroke();
  ctx.fillStyle = '#9aa0a6'; ctx.beginPath(); ctx.moveTo(18, -5); ctx.lineTo(28, -3); ctx.lineTo(28, 3); ctx.lineTo(18, 5); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawPickup(ctx, pk, t, human) {
  if (pk.life != null && pk.life < 8 && (t * 5 | 0) % 2) return; // скоро зникне — блимає
  const [col, txt] = PICKUP_STYLE[pk.type];
  const y = pk.y - 14 + Math.sin(t * 3 + pk.x) * 2;
  ctx.fillStyle = 'rgba(255,240,150,0.25)'; ctx.beginPath(); ctx.arc(pk.x, y, 18, 0, 7); ctx.fill();
  ctx.fillStyle = col; roundRect(ctx, pk.x - 14, y - 9, 28, 18, 4); ctx.fill();
  ctx.fillStyle = pk.type === 'medkit' ? '#d22' : '#fff'; ctx.font = FONT(pk.type === 'medkit' ? 16 : 10); ctx.textAlign = 'center';
  ctx.fillText(txt, pk.x, y + (pk.type === 'medkit' ? 6 : 4));
  if (human && Math.abs(human.x - pk.x) < 80) {
    ctx.fillStyle = '#fff'; ctx.font = FONT(11, '600');
    ctx.fillText(PICKUP_NAMES[pk.type], pk.x, y - 14);
  }
}

// ---------- Техніка ----------
function drawVehicle(ctx, v, t) {
  const T = VEH[v.type];
  ctx.save();
  ctx.translate(v.x, v.y); ctx.rotate(v.ang); ctx.scale(v.dir, 1);
  const L = T.len, H = T.h;
  const body = v.dead ? '#2b2522' : { moto: '#8a2a2a', quad: '#3d6b3a', buggy: '#b07a2a', car: '#55606b' }[v.type];
  const wheel = (x, r) => { ctx.fillStyle = '#151515'; ctx.beginPath(); ctx.arc(x, -r, r, 0, 7); ctx.fill(); ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(x, -r, r * 0.4, 0, 7); ctx.fill(); };
  ctx.fillStyle = body;
  if (v.type === 'moto') {
    wheel(-L / 2 + 11, 11); wheel(L / 2 - 11, 11);
    ctx.fillRect(-L / 2 + 10, -24, L - 22, 9);
    ctx.fillRect(L / 2 - 16, -32, 4, 14);
    ctx.fillStyle = '#222'; ctx.fillRect(-12, -28, 20, 5);
  } else if (v.type === 'quad') {
    ctx.fillRect(-L / 2 + 4, -26, L - 8, 12);
    ctx.fillStyle = '#222'; ctx.fillRect(-10, -31, 20, 6);
    wheel(-L / 2 + 13, 12); wheel(L / 2 - 13, 12);
  } else if (v.type === 'buggy') {
    ctx.fillRect(-L / 2, -22, L, 10);
    ctx.strokeStyle = v.dead ? '#222' : '#333'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-L / 2 + 10, -20); ctx.lineTo(-10, -H); ctx.lineTo(18, -H); ctx.lineTo(L / 2 - 6, -20); ctx.stroke();
    wheel(-L / 2 + 14, 13); wheel(L / 2 - 14, 13);
  } else {
    roundRect(ctx, -L / 2, -H + 16, L, H - 26, 5); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-L / 2 + 14, -H + 17); ctx.lineTo(-L / 2 + 26, -H); ctx.lineTo(L / 2 - 30, -H); ctx.lineTo(L / 2 - 14, -H + 17); ctx.fill();
    if (!v.dead) { ctx.fillStyle = '#9fc3d6'; ctx.fillRect(L / 2 - 36, -H + 3, 16, 12); ctx.fillRect(-L / 2 + 28, -H + 3, 26, 12); }
    wheel(-L / 2 + 18, 12); wheel(L / 2 - 18, 12);
  }
  if (v.hasMG && !v.dead) {
    ctx.fillStyle = '#222';
    ctx.fillRect(-L * 0.15 - 3, -H - 14, 6, 14);
    ctx.fillRect(-L * 0.15, -H - 16, 30, 4);
  }
  ctx.restore();
  if (v.dead && v.burn > 0 && Math.random() < 0.6) {
    ctx.fillStyle = 'rgba(255,' + (100 + Math.random() * 100 | 0) + ',30,0.8)';
    ctx.beginPath(); ctx.arc(v.x + rand(-15, 15), v.y - T.h + rand(-6, 6), rand(4, 9), 0, 7); ctx.fill();
  }
}
function drawRider(ctx, v, h) {
  const T = VEH[v.type];
  const off = h.seat === 'gunner' ? -T.len * 0.15 : T.len * 0.05;
  const x = v.x + off * v.dir, y = v.y - (v.type === 'car' ? T.h - 6 : T.h - 4);
  ctx.save(); ctx.translate(x, y); ctx.scale(v.dir, 1);
  ctx.fillStyle = h.hurtT > 0 ? '#c33' : '#556b2f';
  ctx.fillRect(-6, -22, 12, 22);
  ctx.fillStyle = '#d9b48f'; ctx.beginPath(); ctx.arc(0, -28, 6, 0, 7); ctx.fill();
  ctx.fillStyle = h.player.color; ctx.beginPath(); ctx.arc(0, -30, 7, Math.PI, 0); ctx.fill();
  ctx.restore();
}

// ---------- Людина ----------
function drawHuman(ctx, h, t, alpha) {
  ctx.save();
  ctx.globalAlpha = h.protT > 0 ? alpha * (0.45 + 0.35 * Math.sin(t * 20)) : alpha; // мерехтить, поки діє захист після відновлення
  ctx.translate(h.x, h.y);
  ctx.scale(h.facing, 1);
  const uni = h.dead ? '#4a4a40' : h.hurtT > 0 ? '#c33' : '#556b2f';
  const skin = '#d9b48f', helm = h.dead ? '#555' : h.player.color;
  ctx.lineCap = 'round';
  if (h.dead || h.stance === 'prone') {
    const crawl = Math.sin(h.anim * 2) * 3;
    ctx.strokeStyle = '#3d4a24'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(-14, -5); ctx.lineTo(-24, -3 + crawl); ctx.moveTo(-14, -5); ctx.lineTo(-24, -6 - crawl); ctx.stroke();
    ctx.fillStyle = uni; roundRect(ctx, -16, -12, 28, 10, 4); ctx.fill();
    if (h.armor > 0) { ctx.fillStyle = '#3b4250'; roundRect(ctx, -10, -13, 18, 9, 3); ctx.fill(); }
    ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(17, -8, 5.5, 0, 7); ctx.fill();
    ctx.fillStyle = helm; ctx.beginPath(); ctx.arc(17, -9, 6.5, Math.PI * 0.9, Math.PI * 2.1); ctx.fill();
    if (h.weapon && !h.dead) { ctx.fillStyle = '#222'; ctx.fillRect(12, -4, 18, 3); }
  } else {
    const crouch = h.stance === 'crouch' || (h.hidden && h.hidden.type !== 'pipe');
    const legH = crouch ? 12 : 22, torso = crouch ? 18 : 22;
    const sw = h.onLadder ? Math.sin(h.anim) * 5 : Math.sin(h.anim) * (crouch ? 5 : 9) * Math.min(1, Math.abs(h.vx) / 80);
    ctx.strokeStyle = '#3d4a24'; ctx.lineWidth = 5;
    ctx.beginPath();
    if (crouch) { ctx.moveTo(0, -legH); ctx.lineTo(8 + sw, -5); ctx.lineTo(4 + sw, 0); ctx.moveTo(0, -legH); ctx.lineTo(-6 - sw, -2); ctx.lineTo(-9 - sw, 0); }
    else { ctx.moveTo(0, -legH); ctx.lineTo(sw, 0); ctx.moveTo(0, -legH); ctx.lineTo(-sw, 0); }
    ctx.stroke();
    const tilt = crouch ? 0.25 : Math.min(0.2, Math.abs(h.vx) / 1500);
    ctx.translate(0, -legH); ctx.rotate(tilt);
    ctx.fillStyle = uni; roundRect(ctx, -6, -torso, 12, torso, 3); ctx.fill();
    ctx.fillStyle = '#3f4f2a'; ctx.fillRect(-8, -torso + 3, 4, 12); // рюкзак
    if (h.armor > 0) { ctx.fillStyle = '#3b4250'; roundRect(ctx, -7, -torso + 2, 14, torso - 6, 3); ctx.fill(); ctx.fillStyle = '#2a2f3a'; ctx.fillRect(-7, -torso + 8, 14, 2); }
    ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(1, -torso - 7, 6, 0, 7); ctx.fill();
    ctx.fillStyle = helm; ctx.beginPath(); ctx.arc(1, -torso - 8, 7.5, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
    ctx.strokeStyle = uni; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, -torso + 4);
    if (h.mount) { ctx.lineTo(11, -torso + 7); ctx.stroke(); }
    else if (h.carry) {
      // предмет над головою — замах для кидка
      ctx.lineTo(4, -torso - 4); ctx.stroke();
      drawProp(ctx, h.carry, 5, -torso - 6, h.aiming ? h.aimA : 0);
    } else if (h.weapon && h.aiming) {
      // зброя дивиться вздовж прицілу
      ctx.stroke();
      ctx.save(); ctx.translate(0, -torso + 6); ctx.rotate(h.aimA - tilt);
      ctx.strokeStyle = uni; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(9, 1); ctx.stroke();
      ctx.fillStyle = '#222'; ctx.fillRect(2, -1, 24, 3.5);
      ctx.restore();
    } else if (h.canister) {
      ctx.lineTo(9, -torso + 12); ctx.stroke();
      if (h.weapon) { ctx.fillStyle = '#222'; ctx.save(); ctx.rotate(-1.1); ctx.fillRect(-4, -torso + 4, 20, 3); ctx.restore(); } // зброя за спиною
      ctx.fillStyle = '#a8322d'; roundRect(ctx, 5, -torso + 9, 10, 13, 2); ctx.fill();
      ctx.fillStyle = '#6e1f1b'; ctx.fillRect(7, -torso + 7, 4, 3);
    } else if (h.weapon) { ctx.lineTo(10, -torso + 10); ctx.stroke(); ctx.fillStyle = '#222'; ctx.fillRect(2, -torso + 8, h.weapon.type === 'shotgun' ? 20 : 22, 3.5); }
    else { ctx.lineTo(-sw * 0.8, -torso + 16); ctx.stroke(); }
  }
  ctx.restore();
  if (h.alT > 0 && !h.dead) {
    const r = HUMAN_DIM[h.stance];
    ctx.strokeStyle = 'rgba(255,215,90,' + (0.45 + 0.3 * Math.sin(t * 12)) + ')'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(h.x, h.y - r.h / 2, r.w / 2 + 12, r.h / 2 + 12, 0, 0, 7); ctx.stroke();
    ctx.fillStyle = '#ffd75a'; ctx.font = FONT(11); ctx.textAlign = 'center';
    ctx.fillText('АЛЬОША', h.x, h.y - r.h - 30);
  }
  if (!h.dead && !h.hidden) {
    ctx.fillStyle = h.player.color; ctx.font = FONT(10); ctx.textAlign = 'center';
    ctx.globalAlpha = 0.85 * alpha;
    ctx.fillText(h.player.name, h.x, h.y - HUMAN_DIM[h.stance].h - 18);
    ctx.globalAlpha = 1;
  }
}

// ---------- Дрон ----------
function drawDrone(ctx, d, t) {
  if (d.speedT > 0 && !d.landed) { ctx.strokeStyle = 'rgba(242,201,76,0.5)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.vx * 0.06, d.y - d.vy * 0.06); ctx.stroke(); }
  ctx.save();
  ctx.translate(d.x, d.y); ctx.rotate(d.tilt);
  if (d.hp > 1) { ctx.strokeStyle = '#9fb4d0'; ctx.lineWidth = 2; roundRect(ctx, -9, -7, 18, 14, 3); ctx.stroke(); }
  if (d.lockOn) { ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, 15, 0, 7); ctx.stroke(); }
  ctx.fillStyle = '#222';
  ctx.fillRect(-14, -2, 28, 4);
  ctx.fillStyle = '#333'; roundRect(ctx, -6, -5, 12, 9, 2); ctx.fill();
  ctx.fillStyle = d.player.color; ctx.fillRect(-6, -5, 12, 3);
  ctx.fillStyle = '#6a5a3a'; ctx.fillRect(-4, 4, 8, 6); // заряд
  if (d.landed) {
    ctx.fillStyle = '#555';
    for (const px of [-13, 13]) ctx.fillRect(px - 8, -5, 16, 1.6);
  } else {
    const blur = 0.35 + 0.25 * Math.sin(d.spin);
    ctx.fillStyle = 'rgba(200,200,200,' + blur + ')';
    for (const px of [-13, 13]) { ctx.beginPath(); ctx.ellipse(px, -4, 9, 2.2, 0, 0, 7); ctx.fill(); }
  }
  ctx.fillStyle = Math.sin(t * 14) > 0 ? '#f22' : '#400';
  ctx.beginPath(); ctx.arc(5, 0, 1.6, 0, 7); ctx.fill();
  ctx.restore();
}

function drawParticles(ctx, x0, x1) {
  for (const p of G.parts) {
    if (p.x < x0 || p.x > x1) continue;
    const k = p.life / p.max;
    switch (p.type) {
      case 'fire': ctx.fillStyle = 'rgba(255,' + (120 + 120 * k | 0) + ',40,' + k + ')'; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + k), 0, 7); ctx.fill(); break;
      case 'smoke': ctx.fillStyle = p.light ? 'rgba(205,205,200,' + 0.6 * k + ')' : 'rgba(70,70,70,' + 0.45 * k + ')'; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (2 - k), 0, 7); ctx.fill(); break;
      case 'dust': ctx.fillStyle = 'rgba(160,140,100,' + 0.4 * k + ')'; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (2 - k), 0, 7); ctx.fill(); break;
      case 'debris': ctx.fillStyle = p.col || '#3a3026'; ctx.fillRect(p.x - 2, p.y - 2, 4, 4); break;
      case 'spark': ctx.fillStyle = '#ffd25a'; ctx.fillRect(p.x - 1, p.y - 1, 2, 2); break;
      case 'flash': ctx.fillStyle = 'rgba(255,230,120,0.9)'; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill(); break;
      case 'ring': ctx.strokeStyle = 'rgba(255,220,150,' + k + ')'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - k * 0.7), 0, 7); ctx.stroke(); break;
      case 'tracer': ctx.strokeStyle = 'rgba(255,225,120,' + k + ')'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x2, p.y2); ctx.stroke(); break;
      case 'leaf': ctx.fillStyle = 'rgba(70,100,40,' + Math.min(1, k * 2) + ')'; ctx.fillRect(p.x - 2, p.y - 1.5, 4, 3); break;
      case 'gun': ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = '#222'; ctx.fillRect(-10, -2, 20, 4); ctx.restore(); break;
    }
  }
}

// ---------- HUD ----------
function bar(ctx, x, y, w, h, k, col, bg) {
  ctx.fillStyle = bg || 'rgba(0,0,0,0.55)'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = col; ctx.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * clamp(k, 0, 1)), h - 2);
}
function panel(ctx, x, y, w, h) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(ctx, x, y, w, h, 6); ctx.fill(); }
function centerText(ctx, txt, x, y, sz, col) {
  ctx.font = FONT(sz); ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(txt, x + 2, y + 2);
  ctx.fillStyle = col || '#fff'; ctx.fillText(txt, x, y);
}

function drawHumanHud(ctx, vp, p, t) {
  const h = p.ent, c = p.ctrl;
  const sc = clamp(vp.h / 320, 0.75, 1.2);
  ctx.save(); ctx.translate(vp.x, vp.y); ctx.scale(sc, sc);
  const vw = vp.w / sc, vh = vp.h / sc;
  panel(ctx, 8, 8, 230, 182);
  ctx.textAlign = 'left'; ctx.font = FONT(14); ctx.fillStyle = p.color;
  ctx.fillText(p.name + ' · людина', 16, 26);
  ctx.font = FONT(12, '600');
  if (h.armor > 0) { ctx.fillStyle = '#c9d1e0'; ctx.fillText('Броня', 16, 127); bar(ctx, 66, 118, 150, 9, h.armor / 100, '#8aa4c8'); }
  else { ctx.fillStyle = '#777'; ctx.fillText('Без бронежилета', 16, 127); }
  if (h.alT > 0) { ctx.fillStyle = '#ffd75a'; ctx.fillText('АЛЬОША: ' + Math.ceil(h.alT) + ' с — автонаведення', 16, 145); }
  else if (h.alCharges > 0) { ctx.fillStyle = (t * 3 | 0) % 2 ? '#ffd75a' : '#fff'; ctx.fillText('«Альоша» готовий: [' + c.label('aim') + '+' + c.label('special') + ']', 16, 145); }
  else { ctx.fillStyle = '#aaa'; ctx.fillText('Дрони збито/пережито: ' + Math.min(h.beaten, ALIOSHA_NEED) + ' / ' + ALIOSHA_NEED, 16, 145); }
  ctx.fillStyle = '#fff';
  ctx.fillStyle = packUsed(h) >= PACK_CAP ? '#f2994a' : '#ccc';
  ctx.fillText('Рюкзак: ' + packUsed(h) + '/' + PACK_CAP, 16, 181);
  if (h.detector) { ctx.fillStyle = '#5ad1c4'; ctx.fillText('ДЕТЕКТОР', 110, 181); }
  if (h.shovel > 0) { ctx.fillStyle = '#c8a26a'; ctx.fillText('Лопата ' + h.shovel.toFixed(1) + ' м', h.detector ? 186 : 110, 181); }
  ctx.fillStyle = '#fff';
  ctx.fillText((G.mode === 'dm' ? 'Рахунок: ' + p.score : 'Життя: ' + '♥'.repeat(Math.max(0, h.lives)) + '♡'.repeat(Math.max(0, HUMAN_LIVES - h.lives))) + '  Сітки: ' + h.nets + '  Гранати: ' + h.grenades + ' [' + c.label('slot3') + ']', 16, 163);
  bar(ctx, 16, 34, 194, 11, h.hp / 100, h.hp > 35 ? '#6fcf97' : '#eb5757');
  bar(ctx, 16, 49, 194, 6, h.stamina, h.exhausted ? '#a66' : '#f2c94c');
  ctx.font = FONT(12, '600'); ctx.fillStyle = '#fff';
  let wtxt = 'Без зброї';
  if (h.vehicle && h.seat === 'gunner') {
    const v = h.vehicle, mg = v.mgMag == null ? Math.min(WEAPONS.mg.mag, v.mgAmmo) : v.mgMag;
    wtxt = v.mgReload > 0 ? 'Кулемет: перезарядка ' + v.mgReload.toFixed(1) + ' с' : 'Кулемет: ' + mg + ' / ' + (v.mgAmmo - mg);
  } else if (h.weapon) {
    const wp = h.weapon;
    if (h.reloadT > 0) { ctx.fillStyle = '#f2c94c'; wtxt = WEAPONS[wp.type].name + ': перезарядка ' + h.reloadT.toFixed(1) + ' с'; }
    else wtxt = WEAPONS[wp.type].name + ': ' + wp.mag + ' / ' + (wp.ammo - wp.mag) + (wp.mag === 0 ? ' — [' + c.label('fire') + '] перезарядити' : '');
  }
  if (h.canister) { ctx.fillStyle = '#f2994a'; wtxt = 'У руках каністра — [' + c.label('slot1') + '] викинути'; }
  if (h.carry) { ctx.fillStyle = '#c9a36a'; wtxt = 'У руках: ' + PROP_TYPES[h.carry].name.toLowerCase() + ' — [' + c.label('fire') + '] кинути'; }
  if (h.mount) { ctx.fillStyle = '#fff'; wtxt = 'Станкова гвинтівка: ' + h.mount.ammo; }
  ctx.fillText(wtxt, 16, 72);
  ctx.fillStyle = h.reb > 0 && h.rebCd <= 0 ? '#bb86fc' : '#777';
  ctx.fillText('РЕБ: ' + h.reb + (h.rebCd > 0 ? ' (' + Math.ceil(h.rebCd) + ' с)' : '') + ' [' + c.label('special') + ']', 16, 90);
  ctx.fillStyle = h.medkits > 0 ? '#e8e8e8' : '#777';
  ctx.fillText('Аптечки: ' + h.medkits + ' [' + c.label('slot2') + ']', 130, 90);
  if (h.vehicle && h.seat === 'driver') {
    const v = h.vehicle, tank = VEH[v.type].tank;
    ctx.fillStyle = '#fff'; ctx.fillText('Пальне', 16, 108);
    bar(ctx, 70, 99, 150, 10, v.fuel / tank, v.fuel / tank > 0.25 ? '#f2c94c' : '#eb5757');
  } else if (h.weapon && !h.vehicle) {
    ctx.fillStyle = h.aiming ? '#6fcf97' : '#ccc';
    ctx.fillText(h.aiming ? 'ПОЗИЦІЯ ' + Math.round(-h.aimA * 57) + '° · ' + STANCE_ACC[h.peek ? h.hidden.type : h.stance] + (inTrench(h) ? ' · з окопу — лише вгору' : '') : 'Тримай [' + c.label('aim') + '] — позиція', 16, 108);
  }
  // дим: відлік до отруєння
  if (h.hidden && h.smokeT > 0 && !h.dead) {
    const left = SMOKE_HIDE_GRACE - h.smokeT;
    if (left > 0) centerText(ctx, 'Дим у схованці: ' + Math.ceil(left) + ' с — вилазь!', vw / 2, 175, 20, '#f2994a');
    else centerText(ctx, 'ДИМ ДУШИТЬ — вилазь зі схованки!', vw / 2, 175, 20, (t * 4 | 0) % 2 ? '#eb5757' : '#fff');
  } else if (h.gasT > 0.5 && !h.dead) {
    const left = SMOKE_SAFE - h.gasT;
    if (left > 0) centerText(ctx, 'У диму: ' + Math.ceil(left) + ' с — вибирайся!', vw / 2, 175, 18, left < 6 ? '#f2994a' : '#ddd');
    else centerText(ctx, 'ОТРУЄННЯ ДИМОМ — вийди з хмари!', vw / 2, 175, 20, (t * 4 | 0) % 2 ? '#eb5757' : '#fff');
  }
  if (!h.dead && !h.saved) drawControlsBar(ctx, vw, humanControls(h, c), 246, vw - 186);
  // дистанція до укриття
  const dleft = Math.max(0, (G.W.shelter.x - h.x) / 10) | 0;
  panel(ctx, vw - 178, 8, 170, 30);
  ctx.textAlign = 'right'; ctx.font = FONT(13); ctx.fillStyle = '#9f9';
  ctx.fillText('До укриття: ' + dleft + ' м', vw - 16, 28);
  // відкрита місцевість
  if (!h.dead && !h.saved) {
    if (h.hidden || humanConcealed(h)) {
      ctx.textAlign = 'right'; ctx.fillStyle = '#8fd'; ctx.font = FONT(12);
      ctx.fillText(h.hidden ? 'СХОВАНИЙ' : 'МАСКУВАННЯ', vw - 16, 56);
    } else {
      const k = h.openTime / OPEN_TIME;
      bar(ctx, vw - 178, 46, 170, 8, k, k >= 1 ? '#eb5757' : '#f2994a');
      ctx.textAlign = 'right'; ctx.font = FONT(12); ctx.fillStyle = k >= 1 ? '#ff6b6b' : '#fff';
      ctx.fillText(k >= 1 ? 'ТЕБЕ ВИДНО!' : 'На відкритому', vw - 16, 70);
    }
    // дзижчання
    let md = 1e9;
    for (const d of G.drones) if (!d.landed) md = Math.min(md, dist(d.x, d.y, h.x, h.y)); // «ждун» мовчить
    if (md < 800) {
      const k = 1 - md / 800;
      ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,120,120,' + (0.5 + 0.5 * Math.sin(t * 20 * k + 1)) + ')';
      ctx.font = FONT(13); ctx.fillText('Чути дрон ' + '▮'.repeat(1 + Math.round(k * 4)), vw - 16, 90);
    }
    // детектор: відстань і напрямок до найближчого дрона
    if (h.detector) {
      const e = humanEye(h);
      let nd = null, bd = DETECT_R;
      for (const d of G.drones) { const dd = dist(d.x, d.y, e.x, e.y); if (dd < bd) { bd = dd; nd = d; } }
      ctx.textAlign = 'right'; ctx.font = FONT(13, '600'); ctx.fillStyle = '#5ad1c4';
      if (nd) {
        const ar = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'][((Math.round(Math.atan2(nd.y - e.y, nd.x - e.x) / (Math.PI / 4)) % 8) + 8) % 8];
        ctx.fillText('ДЕТЕКТОР: ' + Math.round(bd / 10) + ' м ' + ar + (nd.landed ? ' (ждун)' : ''), vw - 16, 110);
      } else ctx.fillText('Детектор: чисто', vw - 16, 110);
    }
  }
  // підказки
  let tip = '';
  if (h.vehicle) tip = h.seat === 'driver' ? '[' + c.label('left') + c.label('right') + '] їхати   [' + c.label('interact') + '] вийти' : '[' + c.label('up') + c.label('down') + '] кут  [' + c.label('left') + c.label('right') + '] бік  [' + c.label('fire') + '] кулемет  [' + c.label('interact') + '] вийти';
  else if (h.mount) tip = '[' + c.label('up') + c.label('down') + '] кут  [' + c.label('fire') + '] вогонь (' + h.mount.ammo + ')  [' + c.label('interact') + '] відійти';
  else if (h.working) tip = (h.working.kind === 'ply' ? 'Забиваєш фанерою… ' : 'Ставиш станкову гвинтівку… ') + Math.round(h.working.t / h.working.dur * 100) + '%   [' + c.label('left') + c.label('right') + '] перервати';
  else if (h.carry && !h.aiming) tip = '[' + c.label('fire') + '] кинути: ' + PROP_TYPES[h.carry].name.toLowerCase() + '  (тримай [' + c.label('aim') + '] — під кутом)   [' + c.label('slot1') + '] покласти';
  else if (h.peek) tip = '[' + c.label('up') + c.label('down') + '] кут  [' + c.label('left') + c.label('right') + '] бік  [' + c.label('fire') + '] вогонь ' + (h.hidden.type === 'bunker' ? 'з бійниці' : 'з нори');
  else if (h.digging && h.digging.kind === 'auto') tip = h.digging.e ? 'Докопуєш вихід… ' + Math.round(h.digging.t / h.digging.dur * 100) + '%' : 'Нагорі перешкода — копаєш далі…';
  else if (h.digging) tip = 'Копаєш… ' + Math.round(h.digging.t / h.digging.dur * 100) + '%   [' + c.label('left') + c.label('right') + '] перервати';
  else if (h.hidden && h.hidden.type === 'pipe') tip = tunnelTip(h, c);
  else if (h.hidden) tip = '[' + c.label('interact') + '] вийти з укриття';
  else if (h.aiming) tip = '[' + c.label('up') + c.label('down') + '] кут  [' + c.label('left') + c.label('right') + '] бік  [' + c.label('fire') + '] ' + (h.carry ? 'кинути' : 'вогонь') + (h.grenades > 0 ? '  [' + c.label('slot3') + '] граната' : '');
  else if (!h.dead && !h.saved) {
    const v = nearVehicle(h), pk = nearPickup(h), sp = nearHide(h), mo = nearMount(h);
    const pr = !h.carry && !h.canister ? nearProp(h) : null, ft = fortTarget(h), mt = mountTarget(h);
    const L = (a) => '[' + c.label(a) + ']';
    if (mo) tip = L('interact') + ' стати за станкову гвинтівку (' + mo.ammo + ' набоїв)';
    else if (v) tip = '[' + c.label('interact') + '] ' + (v.driver ? 'стати за кулемет' : 'сісти: ' + VEH[v.type].name + ' (пальне ' + Math.round(v.fuel / VEH[v.type].tank * 100) + '%' + (h.canister ? ', заправити' : '') + ')');
    else if (pk && !canTake(h, pk)) tip = pk.type === 'pack' ? 'Рюкзак загиблого: нічого не влізе' : PICKUP_NAMES[pk.type] + ': не влізе в рюкзак (' + packUsed(h) + '/' + PACK_CAP + ')';
    else if (pk) tip = '[' + c.label('interact') + '] підібрати: ' + PICKUP_NAMES[pk.type] + (pk.type === 'fuel' && h.weapon ? ' (зброю не можна буде використати)' : '');
    else if (sp) tip = '[' + c.label('interact') + '] сховатися: ' + { bunker: 'бліндаж', burrow: 'нора', pipe: sp.style === 'sewer' ? 'каналізація' : 'тунель' }[sp.type];
    else if (pr) tip = L('interact') + ' взяти: ' + PROP_TYPES[pr.type].name.toLowerCase() + ' — можна кинути в дрон';
    else if (ft) tip = L('interact') + ' забити фанерою (' + (ft.b.ply || 0) + ' лист.)' + (mt && !mt.bad ? '   ' + L('aim') + '+' + L('interact') + ' вогнева позиція' : '');
    else if (mt && !mt.bad) tip = L('aim') + '+' + L('interact') + ' облаштувати вогневу позицію (станкова гвинтівка)';
    else if (ladderAt(h) && !h.onLadder) tip = '[' + c.label('up') + '] лізти драбиною';
    else if (canDigHere(h)) tip = '[' + c.label('interact') + '] копати тунель (лопата ' + h.shovel.toFixed(1) + ' м)';
  }
  if (tip) {
    ctx.font = FONT(14); ctx.textAlign = 'center';
    const tw = ctx.measureText(tip).width + 24;
    panel(ctx, vw / 2 - tw / 2, vh - 40, tw, 28);
    ctx.fillStyle = '#fff'; ctx.fillText(tip, vw / 2, vh - 21);
  }
  if (h.dead && h.respawnT > 0) {
    centerText(ctx, 'ЗАГИНУВ', vw / 2, vh / 2 - 16, 34, '#eb5757');
    centerText(ctx, 'Відновлення через ' + Math.ceil(h.respawnT) + ' с — ' + (h.spawn ? 'там, де натягнув сітку' : 'зі старту'), vw / 2, vh / 2 + 20, 16, '#fff');
  } else if (h.dead) centerText(ctx, 'ЗАГИНУВ', vw / 2, vh / 2, 34, '#eb5757');
  else if (h.saved) centerText(ctx, 'У БЕЗПЕЦІ', vw / 2, vh / 2, 34, '#6fcf97');
  else if (G.time < LAUNCH_DELAY) centerText(ctx, 'Біжи до укриття →  дрони злітають через ' + Math.ceil(LAUNCH_DELAY - G.time), vw / 2, vh * 0.3, 18, '#fff');
  if (h.healT > 0) {
    centerText(ctx, 'Перев\'язка — не рухайся: ' + (HEAL_TIME - h.healT).toFixed(1) + ' с', vw / 2, vh * 0.32, 18, '#9c9');
    bar(ctx, vw / 2 - 100, vh * 0.32 + 12, 200, 8, h.healT / HEAL_TIME, '#6fcf97');
  }
  if (h.hurtT > 0) { ctx.fillStyle = 'rgba(200,0,0,' + h.hurtT * 0.6 + ')'; ctx.fillRect(0, 0, vw, vh); }
  ctx.restore();
}

function drawDroneHud(ctx, vp, p, toScreen, t, s) {
  const dp = p.ent, d = dp.drone, c = p.ctrl;
  const sc = clamp(vp.h / 320, 0.75, 1.2);
  // віньєтка FPV
  const g = ctx.createRadialGradient(vp.x + vp.w / 2, vp.y + vp.h / 2, Math.min(vp.w, vp.h) * 0.35, vp.x + vp.w / 2, vp.y + vp.h / 2, Math.max(vp.w, vp.h) * 0.65);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g; ctx.fillRect(vp.x, vp.y, vp.w, vp.h);
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let y = vp.y; y < vp.y + vp.h; y += 3) ctx.fillRect(vp.x, y, vp.w, 1);

  if (d) {
    const ds = toScreen(d.x, d.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ds.x - 26, ds.y); ctx.lineTo(ds.x - 14, ds.y); ctx.moveTo(ds.x + 14, ds.y); ctx.lineTo(ds.x + 26, ds.y);
    ctx.moveTo(ds.x, ds.y - 26); ctx.lineTo(ds.x, ds.y - 14); ctx.moveTo(ds.x, ds.y + 14); ctx.lineTo(ds.x, ds.y + 26);
    ctx.stroke();
    // стрілки на людей, що довго на відкритому
    for (const h of G.humans) {
      if (h.dead || h.saved || h.hidden || h.openTime < OPEN_TIME) continue;
      const hs = toScreen(h.x, h.y - 25);
      const m = 34;
      const onScreen = hs.x > vp.x + m && hs.x < vp.x + vp.w - m && hs.y > vp.y + m && hs.y < vp.y + vp.h - m;
      const meters = (dist(d.x, d.y, h.x, h.y) / 10) | 0;
      ctx.strokeStyle = '#ff4040'; ctx.fillStyle = '#ff4040'; ctx.lineWidth = 2;
      if (onScreen) {
        const r = 22;
        ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          ctx.moveTo(hs.x + sx * r, hs.y + sy * r - sy * 8); ctx.lineTo(hs.x + sx * r, hs.y + sy * r); ctx.lineTo(hs.x + sx * r - sx * 8, hs.y + sy * r);
        }
        ctx.stroke();
        ctx.font = FONT(11); ctx.textAlign = 'center'; ctx.fillText(meters + ' м', hs.x, hs.y - 28);
      } else {
        const cxs = vp.x + vp.w / 2, cys = vp.y + vp.h / 2;
        const a = Math.atan2(hs.y - cys, hs.x - cxs);
        const kx = (vp.w / 2 - m) / Math.abs(Math.cos(a) || 1e-6), ky = (vp.h / 2 - m) / Math.abs(Math.sin(a) || 1e-6);
        const k = Math.min(kx, ky);
        const ax = cxs + Math.cos(a) * k, ay = cys + Math.sin(a) * k;
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-8, -11); ctx.lineTo(-3, 0); ctx.lineTo(-8, 11); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.font = FONT(12); ctx.textAlign = 'center';
        ctx.fillText(meters + ' м', ax - Math.cos(a) * 30, ay - Math.sin(a) * 22 + 4);
      }
    }
  }

  ctx.save(); ctx.translate(vp.x, vp.y); ctx.scale(sc, sc);
  const vw = vp.w / sc, vh = vp.h / sc;
  const prep = !d || d.onPad;
  if (!d) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, vw, vh); }
  panel(ctx, 8, 8, 290, d && (d.lock || d.hp > 1 || d.speedT > 0) ? 126 : 108);
  ctx.textAlign = 'left'; ctx.font = FONT(14); ctx.fillStyle = p.color;
  ctx.fillText(p.name + ' · FPV-дрон', 16, 26);
  ctx.font = FONT(12, '600'); ctx.fillStyle = '#fff';
  ctx.fillText('Дронів витрачено: ' + dp.used + (G.mode === 'dm' ? '   Рахунок: ' + p.score : '') + '    Старт №' + G.W.pads[dp.pad].n + '/' + G.W.pads.length, 16, 44);
  if (d) {
    ctx.fillText('АКБ', 16, 62); bar(ctx, 46, 53, 120, 10, d.battery / DRONE_BATTERY, d.battery > 20 ? '#6fcf97' : '#eb5757');
    ctx.fillStyle = d.landed ? '#8fd' : '#fff';
    ctx.fillText(d.landed ? (d.onPad ? 'на старті' : 'ЖДУН (АКБ не сідає)') : d.landing ? 'посадка…' : (Math.hypot(d.vx, d.vy) / 10 * 3.6 | 0) + ' км/г', 172, 62);
  }
  drawSlots(ctx, 16, 72, prep ? dp.loadout : d.slots, prep ? null : d.payload, prep ? dp.sel : -1);
  if (d && (d.lock || d.hp > 1 || d.speedT > 0)) {
    const bs = [];
    if (d.lock) bs.push(d.lockOn ? 'ЗАХОПЛЕНО' : 'автозахоплення');
    if (d.hp > 1) bs.push('броня ' + d.hp);
    if (d.speedT > 0) bs.push('×2 ' + Math.ceil(d.speedT) + ' с');
    ctx.font = FONT(12, '600'); ctx.fillStyle = '#f2c94c'; ctx.textAlign = 'left';
    ctx.fillText('Бонуси: ' + bs.join(' · '), 16, 116);
  }
  if (d && d.lockOn) centerText(ctx, 'ЗАХОПЛЕННЯ ЦІЛІ — дрон летить сам', vw / 2, vh * 0.22, 20, '#ff5a5a');
  if (d && d.landed) centerText(ctx, d.inBush ? 'ЖДУН У КУЩАХ — тебе не видно' : 'Ждун на відкритому — сядь у кущі, щоб сховатися', vw / 2, vh * 0.22 + 26, 16, d.inBush ? '#6fcf97' : '#ddd');
  if (!d) {
    if (dp.left > 0) {
      centerText(ctx, 'НОВИЙ ДРОН ЧЕРЕЗ ' + Math.max(0, dp.timer).toFixed(1) + ' с', vw / 2, Math.max(150, vh * 0.3), 22, '#fff');
      drawPrepHelp(ctx, vw, Math.max(150, vh * 0.3) + 32, dp, c);
      drawLaunchMap(ctx, vw, vh, dp, c, t);
    } else centerText(ctx, 'ДРОНИ ЗАКІНЧИЛИСЯ', vw / 2, vh / 2, 26, '#eb5757');
  } else if (d.onPad) {
    centerText(ctx, 'НА СТАРТІ — [' + c.label('up') + '] злетіти', vw / 2, Math.max(150, vh * 0.3), 20, '#fff');
    drawPrepHelp(ctx, vw, Math.max(150, vh * 0.3) + 32, dp, c);
    drawLaunchMap(ctx, vw, vh, dp, c, t);
  } else if (d.jammed) {
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.6)';
      ctx.fillRect(Math.random() * vw, Math.random() * vh, rand(2, 30), rand(1, 4));
    }
    centerText(ctx, d.battery <= 0 ? 'АКБ РОЗРЯДЖЕНО' : 'НЕМАЄ СИГНАЛУ — РЕБ', vw / 2, vh / 2, 26, '#ff6b6b');
  } else if (d.battery < 15 && Math.sin(t * 8) > 0) centerText(ctx, 'НИЗЬКИЙ ЗАРЯД', vw / 2, 40, 16, '#ff6b6b');
  if (dp.left + (d ? 1 : 0) > 0) drawControlsBar(ctx, vw, droneControls(d, c), 306, vw - 8);
  ctx.restore();
}

const DROP_STYLE = { frag: ['#c9a227', 'ГРАН'], smoke: ['#bdbdbd', 'ДИМ'], mine: ['#7a9a3a', 'МІНА'] };
// 4 місця для скидів: у польоті підсвічено обраний тип, на старті — місце, яке редагується
function drawSlots(ctx, x, y, slots, payload, sel) {
  let marked = false;
  for (let i = 0; i < 4; i++) {
    const t = slots[i], bx = x + i * 66;
    ctx.fillStyle = t ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)';
    roundRect(ctx, bx, y, 60, 26, 5); ctx.fill();
    const on = sel === i || (!marked && payload && t === payload);
    if (on) { marked = sel < 0; ctx.strokeStyle = '#f2c94c'; ctx.lineWidth = 2; roundRect(ctx, bx, y, 60, 26, 5); ctx.stroke(); }
    ctx.textAlign = 'center'; ctx.font = FONT(11);
    ctx.fillStyle = t ? DROP_STYLE[t][0] : '#666';
    ctx.fillText(t ? DROP_STYLE[t][1] : '—', bx + 30, y + 17);
  }
  ctx.textAlign = 'left';
}
function drawPrepHelp(ctx, vw, y, dp, c) {
  const pad = G.W.pads[dp.pad];
  let near = 1e9;
  for (const h of G.humans) if (!h.dead && !h.saved) near = Math.min(near, Math.abs(h.x - pad.x));
  centerText(ctx, 'Скиди: [' + c.label('left') + c.label('right') + '] місце   [' + c.label('down') + '] змінити тип', vw / 2, y, 16, '#f2c94c');
  centerText(ctx, 'Точка старту №' + pad.n + '/' + G.W.pads.length + '   [' + c.label('interact') + '] / [' + c.label('aim') + '] інша', vw / 2, y + 26, 16, '#ddd');
}
// рядок керування згори (вимикається в лобі)
function drawControlsBar(ctx, vw, items, left, right) {
  if (!G.opts || G.opts.controls === false || !items.length) return;
  ctx.font = FONT(12, '600');
  let x0 = left, w = right - left, y = 8;
  if (w < 320) { x0 = 8; w = vw - 16; y = 160; }
  const rows = [[]]; let rw = 0;
  for (const it of items) {
    const iw = ctx.measureText(it).width + 18;
    if (rw + iw > w - 12 && rows[rows.length - 1].length) { rows.push([]); rw = 0; }
    rows[rows.length - 1].push(it); rw += iw;
  }
  panel(ctx, x0, y, w, rows.length * 18 + 8);
  ctx.textAlign = 'center'; ctx.fillStyle = '#e8e8e8';
  rows.forEach((r, i) => ctx.fillText(r.join('  ·  '), x0 + w / 2, y + 17 + i * 18));
  ctx.textAlign = 'left';
}
function tunnelTip(h, c) {
  const L = (a) => '[' + c.label(a) + ']', sp = h.hidden, T = h.tun;
  if (T.ex >= 0) return L('up') + L('down') + ' по виходу   ' + (T.u > 0.75 ? L('interact') + ' вилізти' : '');
  const atExit = sp.exits.some((e) => Math.abs(e.bx - h.x) < 14);
  let s = L('left') + L('right') + ' іти тунелем' + (atExit ? '   ' + L('up') + ' до виходу' : '');
  if (h.shovel > 0) s += (atExit ? '' : '   ' + L('up') + ' прокопати вихід') + '   на краю ' + L('down') + '+' + L('left') + L('right') + ' копати далі';
  return s;
}
function humanControls(h, c) {
  const L = (a) => c.label(a);
  if (h.vehicle) return h.seat === 'driver'
    ? [L('left') + L('right') + ' їхати', L('interact') + ' вийти', L('special') + ' РЕБ']
    : [L('up') + L('down') + ' кут', L('left') + L('right') + ' бік', L('fire') + ' кулемет', L('interact') + ' вийти'];
  if (h.hidden) return h.hidden.type === 'pipe' ? [L('left') + L('right') + ' іти', L('up') + L('down') + ' вихід', L('interact') + ' вилізти нагорі'].concat(h.shovel > 0 ? [L('up') + ' новий вихід', L('down') + '+' + L('left') + L('right') + ' копати далі'] : []) : [L('interact') + '/' + L('up') + ' вилізти', L('special') + ' РЕБ'].concat(canPeek(h.hidden) && h.weapon ? [L('aim') + '+' + L('fire') + (h.hidden.type === 'bunker' ? ' стріляти з бійниці' : ' стріляти з нори')] : []).concat(h.nets > 0 && !h.hidden.net ? [L('aim') + '+' + L('interact') + ' натягнути сітку'] : []);
  const it = [L('left') + L('right') + ' рух', L('up') + ' стрибок', L('down') + ' присісти / лягти (на бігу — кидок)', L('sprint') + ' біг',
    L('aim') + ' позиція', L('fire') + ' вогонь', L('interact') + ' дія', L('special') + ' РЕБ'];
  if (h.alCharges > 0 && h.alT <= 0) it.push(L('aim') + '+' + L('special') + ' Альоша');
  if (h.nets > 0) it.push(L('aim') + '+' + L('interact') + ' сітка');
  if (h.canister) it.push(L('slot1') + ' викинути каністру');
  if (h.carry) it.push(L('fire') + ' кинути', L('slot1') + ' покласти');
  if (h.grenades > 0) it.push(L('slot3') + ' граната');
  if (h.medkits > 0) it.push(L('slot2') + ' аптечка (5 с)');
  if (h.weapon) it.push(L('fire') + ' без позиції — перезарядити');
  return it;
}
function droneControls(d, c) {
  const L = (a) => c.label(a);
  if (!d || d.onPad) return [L('left') + L('right') + ' місце скиду', L('down') + ' тип скиду', L('interact') + '/' + L('aim') + ' точка старту'].concat(d ? [L('up') + ' злетіти'] : []);
  if (d.landed) return [L('aim') + '/' + L('up') + ' злетіти', L('fire') + ' підрив'];
  return [L('left') + L('right') + L('up') + L('down') + ' політ', L('sprint') + ' форсаж', L('fire') + ' підрив', L('special') + ' скид', L('interact') + ' тип скиду', L('aim') + ' посадка (біля землі) / огляд'];
}

// ---------- Результати ----------
function renderResults(ctx, w, h) {
  ctx.fillStyle = 'rgba(10,12,14,0.88)'; ctx.fillRect(0, 0, w, h);
  const win = G.over === 'humans', draw = G.over === 'draw';
  centerText(ctx, draw ? 'НІЧИЯ' : win ? 'ЛЮДИ ПЕРЕМОГЛИ' : 'ДРОНИ ПЕРЕМОГЛИ', w / 2, h / 2 - 90, 46, draw ? '#f2c94c' : win ? '#6fcf97' : '#eb5757');
  centerText(ctx, G.overReason, w / 2, h / 2 - 50, 20, '#fff');
  const nh = Math.max(1, G.humans.length), deaths = G.stats.deaths;
  centerText(ctx, 'Дронів витрачено: ' + G.stats.dronesUsed + '   на одну людину: ' + (G.stats.dronesUsed / nh).toFixed(1) +
    '   на одне вбивство: ' + (deaths ? (G.stats.dronesUsed / deaths).toFixed(1) : '—'), w / 2, h / 2 - 16, 16, '#ddd');
  centerText(ctx, 'Збито дронів: ' + G.stats.shotDown + '   Смертей людей: ' + deaths + '   Час: ' + fmtTime(G.time), w / 2, h / 2 + 8, 16, '#ddd');
  // рахунок гравців
  const rows = G.players.slice().sort((x, y) => y.score - x.score);
  rows.forEach((p, i) => {
    const extra = p.role === 'human' ? '  (смертей: ' + p.ent.deaths + (p.ent.saved ? ', в укритті' : '') + ')' : '  (дронів: ' + p.ent.used + ')';
    centerText(ctx, p.name + ' · ' + (p.role === 'human' ? 'людина' : 'дрон') + ' — ' + p.score + ' оч.' + extra, w / 2, h / 2 + 40 + i * 22, 15, p.color);
  });
  if (G.overT > 2) centerText(ctx, 'Клацніть або натисніть Enter — до лобі', w / 2, h / 2 + 50 + rows.length * 22 + 16, 18, '#f2c94c');
}
function fmtTime(sec) { sec = Math.max(0, Math.ceil(sec)); return ((sec / 60) | 0) + ':' + String(sec % 60).padStart(2, '0'); }
// табло дезматчу: час і рахунок команд
function drawDmBoard(ctx, w) {
  const sc = teamScores();
  const txt = 'ДЕЗМАТЧ  ' + fmtTime(G.timeLeft) + '     Люди ' + sc.humans + ' : ' + sc.drones + ' Дрони';
  ctx.font = FONT(16); ctx.textAlign = 'center';
  const y = G.opts && G.opts.controls !== false ? 84 : 22;
  const tw = ctx.measureText(txt).width + 28;
  ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(w / 2 - tw / 2, y - 18, tw, 28);
  ctx.fillStyle = G.timeLeft < 30 && (G.time * 2 | 0) % 2 ? '#eb5757' : '#f2c94c';
  ctx.fillText(txt, w / 2, y + 2);
}

