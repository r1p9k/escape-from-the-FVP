'use strict';
// ===== Заставка меню: захід сонця, боєць біжить у сповільненні, довкола рвуться дрони, ледь не влучивши =====
const MENU = { t: 0, scroll: 0, drones: [], booms: [], parts: [], smoke: [], nextD: 1.4, shake: 0, flash: 0, flashX: 0, hc: null, rnd: mulberry32(7) };
const MENU_SLOW = 0.3; // сповільнення часу
const MENU_HUMAN = {
  player: { color: '#f2c94c', name: '' }, x: 0, y: 0, stance: 'stand', facing: 1, onGround: true, onLadder: false, climb: null,
  vx: 175, anim: 0, hp: 100, weapon: { type: 'rifle', mag: 9, ammo: 27 }, aiming: false, aimA: -0.3, hurtT: 0, dead: false, hidden: null,
  canister: false, carry: null, healT: 0, alT: 0, protT: 0, digT: 0, digging: null, piloting: false,
};
function mr(a, b) { return a + (b - a) * MENU.rnd(); }
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
function drawMenuScene(ctx, w, h, rdt) {
  const dt = Math.min(rdt, 0.05) * MENU_SLOW;
  MENU.t += dt;
  const S = h / 260;                        // масштаб: людина ≈ 22% висоти заставки
  const gy = h * 0.84, hy = h * 0.66, hx = w * 0.4;
  MENU.scroll += MENU_HUMAN.vx * S * dt;
  const sc = MENU.scroll;
  // тряска від вибухів
  MENU.shake = Math.max(0, MENU.shake - rdt * 2.2);
  const shx = (Math.random() - 0.5) * MENU.shake * 10, shy = (Math.random() - 0.5) * MENU.shake * 8;
  ctx.save();
  ctx.translate(shx, shy);

  // небо: захід сонця
  const sky = ctx.createLinearGradient(0, 0, 0, gy);
  sky.addColorStop(0, '#1d1636'); sky.addColorStop(0.35, '#4a2350'); sky.addColorStop(0.62, '#a8424a'); sky.addColorStop(0.82, '#e8763a'); sky.addColorStop(1, '#f7b45c');
  ctx.fillStyle = sky; ctx.fillRect(-20, -20, w + 40, h + 40);
  // сонце й сяйво
  const sx = w * 0.72, sy = hy - h * 0.02, sr = h * 0.1;
  let g = ctx.createRadialGradient(sx, sy, sr * 0.5, sx, sy, h * 0.75);
  g.addColorStop(0, 'rgba(255,200,120,0.55)'); g.addColorStop(0.3, 'rgba(255,140,80,0.18)'); g.addColorStop(1, 'rgba(255,120,80,0)');
  ctx.fillStyle = g; ctx.fillRect(-20, -20, w + 40, h + 40);
  g = ctx.createRadialGradient(sx, sy - sr * 0.2, 0, sx, sy, sr);
  g.addColorStop(0, '#fff2c4'); g.addColorStop(0.6, '#ffc76a'); g.addColorStop(1, '#ff8f45');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, sr, 0, 7); ctx.fill();
  // хмари-смуги
  for (let i = 0; i < 6; i++) {
    const cy = h * (0.12 + i * 0.07), cw = w * (0.35 + menuHash(i, 1) * 0.4), cx = ((menuHash(i, 2) * w * 1.6 - MENU.t * (6 + i * 3) * S) % (w * 1.6) + w * 1.6) % (w * 1.6) - w * 0.3;
    ctx.fillStyle = 'rgba(' + (i < 3 ? '120,60,110' : '255,150,110') + ',' + (0.18 + 0.08 * (i % 3)) + ')';
    ctx.beginPath(); ctx.ellipse(cx, cy, cw / 2, h * 0.012 + menuHash(i, 3) * h * 0.012, 0, 0, 7); ctx.fill();
  }
  // далекі пагорби
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
  // руїни, дерева, стовпи — силуети середнього плану
  menuSkyline(ctx, w, h, hy + h * 0.1, sc * 0.3, S);
  // земля
  ctx.fillStyle = '#1b0f18';
  ctx.beginPath(); ctx.moveTo(-20, h + 20);
  for (let x = -20; x <= w + 40; x += 16) ctx.lineTo(x, gy + Math.sin((x + sc) * 0.011) * 3 * S + Math.sin((x + sc) * 0.037) * 1.5 * S);
  ctx.lineTo(w + 40, h + 20); ctx.closePath(); ctx.fill();
  // трава на краю землі
  ctx.strokeStyle = '#1b0f18'; ctx.lineWidth = Math.max(1, 1.2 * S);
  for (let i = Math.floor(sc / (7 * S)) - 1, n = i + Math.ceil(w / (7 * S)) + 3; i < n; i++) {
    const x = i * 7 * S - sc, hh = (3 + menuHash(i, 5) * 7) * S, y = gy + Math.sin((x + sc) * 0.011) * 3 * S;
    ctx.beginPath(); ctx.moveTo(x, y + 2); ctx.quadraticCurveTo(x + 1.5 * S, y - hh * 0.6, x + (menuHash(i, 6) - 0.3) * 4 * S, y - hh); ctx.stroke();
  }

  // дрони: летять згори й пікірують поруч із бійцем
  MENU.nextD -= rdt;
  if (MENU.nextD <= 0) { MENU.nextD = mr(1.6, 3); menuSpawnDrone(w, h, hx, gy, S); }
  for (const d of MENU.drones) {
    const dx = d.tx - d.x, dy = d.ty - d.y, dist = Math.hypot(dx, dy);
    const sp = d.v * dt;
    if (dist <= sp) { d.dead = true; menuBoom(d.tx, d.ty, S); continue; }
    d.x += (dx / dist) * sp; d.y += (dy / dist) * sp;
    d.ang = Math.atan2(dy, dx);
    d.v += 260 * S * dt; // розганяється в піке
  }
  MENU.drones = MENU.drones.filter((d) => !d.dead);
  // вибухи, частинки, дим
  menuUpdateFx(dt, S, gy, sc);
  for (const p of MENU.smoke) {
    const k = p.life / p.max, x = p.x - sc, r = p.r * (1 + (1 - k) * 2.2);
    smokePuff(ctx, x, p.y, r, 0.55 * Math.pow(k, 0.8), false, p.rot + (1 - k) * p.spin, p.v);
  }
  for (const b of MENU.booms) menuDrawBoom(ctx, b, sc, S);

  // боєць — силует, підсвічений сонцем і спалахами
  MENU_HUMAN.anim += dt * 10;
  menuDrawHuman(ctx, hx, gy + Math.sin((hx + sc) * 0.011) * 3 * S, S);
  // пил з-під ніг
  if (Math.random() < rdt * 8) MENU.parts.push({ k: 'dust', x: hx + sc - 6 * S, y: gy, vx: mr(-40, -10) * S, vy: mr(-30, -10) * S, life: 1.4, max: 1.4, r: mr(2, 4) * S });
  for (const d of MENU.drones) menuDrawDrone(ctx, d.x - sc, d.y, d.ang, S);
  for (const p of MENU.parts) {
    const x = p.x - sc, k = p.life / p.max;
    if (p.k === 'ember') { ctx.fillStyle = 'rgba(255,' + (150 + 80 * k | 0) + ',80,' + k + ')'; ctx.fillRect(x - 1.2 * S, p.y - 1.2 * S, 2.4 * S, 2.4 * S); }
    else if (p.k === 'chunk') { ctx.save(); ctx.translate(x, p.y); ctx.rotate(p.rot); ctx.fillStyle = '#140a10'; ctx.fillRect(-p.r, -p.r * 0.6, p.r * 2, p.r * 1.2); ctx.restore(); }
    else { ctx.fillStyle = 'rgba(60,35,45,' + (0.4 * k) + ')'; ctx.beginPath(); ctx.arc(x, p.y, p.r * (2 - k), 0, 7); ctx.fill(); }
  }
  // спалах освітлює все
  MENU.flash = Math.max(0, MENU.flash - rdt * 1.6);
  if (MENU.flash > 0) {
    g = ctx.createRadialGradient(MENU.flashX - sc, gy - 20 * S, 0, MENU.flashX - sc, gy - 20 * S, h * 0.9);
    g.addColorStop(0, 'rgba(255,190,110,' + 0.45 * MENU.flash + ')'); g.addColorStop(1, 'rgba(255,120,60,0)');
    ctx.fillStyle = g; ctx.fillRect(-20, -20, w + 40, h + 40);
  }
  ctx.restore();
  // віньєтка
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
    if (r < 0.28) { // зруйнований будинок
      const bw = cell * (1.2 + menuHash(i, 12)), bh = (40 + menuHash(i, 13) * 60) * S;
      ctx.beginPath(); ctx.moveTo(x, base);
      ctx.lineTo(x, base - bh); ctx.lineTo(x + bw * 0.3, base - bh * (0.75 + menuHash(i, 14) * 0.25)); ctx.lineTo(x + bw * 0.45, base - bh * 0.55);
      ctx.lineTo(x + bw * 0.7, base - bh * (0.8 + menuHash(i, 15) * 0.2)); ctx.lineTo(x + bw, base - bh * 0.4); ctx.lineTo(x + bw, base); ctx.fill();
      // порожні вікна
      ctx.fillStyle = 'rgba(240,120,70,0.25)';
      for (let fy = 1; fy < 4; fy++) for (let fx = 0; fx < 3; fx++) if (menuHash(i * 7 + fx, fy) > 0.45 && base - fy * 16 * S > base - bh * 0.55) ctx.fillRect(x + bw * (0.15 + fx * 0.27), base - fy * 16 * S, 5 * S, 7 * S);
      ctx.fillStyle = '#2c1626';
    } else if (r < 0.62) { // дерево
      const th = (18 + menuHash(i, 16) * 26) * S, cr = (9 + menuHash(i, 17) * 9) * S;
      ctx.fillRect(x - 1.5 * S, base - th, 3 * S, th);
      ctx.beginPath(); ctx.arc(x, base - th, cr, 0, 7); ctx.arc(x - cr * 0.6, base - th + cr * 0.4, cr * 0.7, 0, 7); ctx.arc(x + cr * 0.6, base - th + cr * 0.3, cr * 0.75, 0, 7); ctx.fill();
    } else if (r < 0.72) { // покосений стовп
      ctx.save(); ctx.translate(x, base); ctx.rotate((menuHash(i, 18) - 0.5) * 0.4);
      ctx.fillRect(-1.5 * S, -55 * S, 3 * S, 55 * S); ctx.fillRect(-9 * S, -50 * S, 18 * S, 2 * S); ctx.restore();
    }
  }
}
function menuSpawnDrone(w, h, hx, gy, S) {
  const side = MENU.rnd() < 0.5 ? -1 : 1, sc = MENU.scroll;
  const tx = hx + sc + side * mr(45, 120) * S + MENU_HUMAN.vx * S * 0.5; // з упередженням — поки дрон летить, боєць пробігає трохи вперед
  const ty = gy - mr(-4, 30) * S;
  MENU.drones.push({ x: tx - side * mr(0.3, 0.7) * w, y: -40 * S, tx, ty, v: 380 * S, ang: 0 });
}
function menuBoom(x, y, S) {
  MENU.booms.push({ x, y, t: 0, max: 1.1 });
  MENU.shake = Math.min(1, MENU.shake + 0.7); MENU.flash = 1; MENU.flashX = x;
  for (let i = 0; i < 26; i++) { const a = mr(Math.PI * 1.05, Math.PI * 1.95), v = mr(120, 520) * S; MENU.parts.push({ k: 'chunk', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: mr(1.2, 2.4), max: 2.4, r: mr(1.5, 4.5) * S, rot: mr(0, 6), spin: mr(-8, 8) }); }
  for (let i = 0; i < 40; i++) { const a = mr(Math.PI, Math.PI * 2), v = mr(80, 420) * S; MENU.parts.push({ k: 'ember', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: mr(0.6, 1.8), max: 1.8 }); }
  for (let i = 0; i < 9; i++) MENU.smoke.push({ x: x + mr(-25, 25) * S, y: y - mr(0, 30) * S, vx: mr(-12, 12) * S, vy: mr(-40, -15) * S, r: mr(16, 30) * S, life: mr(3, 5), max: 5, rot: mr(0, 6), spin: mr(-0.6, 0.6), v: (MENU.rnd() * 5) | 0 });
  if (typeof Sfx !== 'undefined' && Sfx.ctx && menuMusic.on) Sfx.boom(true);
}
function menuUpdateFx(dt, S, gy, sc) {
  for (const b of MENU.booms) b.t += dt;
  MENU.booms = MENU.booms.filter((b) => b.t < b.max);
  for (const p of MENU.parts) {
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.k === 'chunk') { p.vy += 900 * S * dt; p.rot += p.spin * dt; if (p.y > gy) { p.y = gy; p.vy *= -0.25; p.vx *= 0.5; } }
    else if (p.k === 'ember') { p.vy += 260 * S * dt; p.vx *= 0.99; }
    else { p.vy *= 0.98; }
  }
  MENU.parts = MENU.parts.filter((p) => p.life > 0 && p.x - sc > -200);
  for (const p of MENU.smoke) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy *= 0.995; }
  MENU.smoke = MENU.smoke.filter((p) => p.life > 0);
}
function menuDrawBoom(ctx, b, sc, S) {
  const k = b.t / b.max, x = b.x - sc, y = b.y;
  // ударна хвиля по землі
  ctx.strokeStyle = 'rgba(255,220,170,' + (0.5 * (1 - k)) + ')'; ctx.lineWidth = 2 * S;
  ctx.beginPath(); ctx.ellipse(x, y + 4 * S, (20 + k * 160) * S, (4 + k * 18) * S, 0, 0, 7); ctx.stroke();
  // вогняна куля
  const r = (14 + Math.pow(k, 0.5) * 46) * S, a = Math.max(0, 1 - k * 1.4);
  const g = ctx.createRadialGradient(x, y - r * 0.3, 0, x, y - r * 0.3, r);
  g.addColorStop(0, 'rgba(255,250,220,' + a + ')'); g.addColorStop(0.35, 'rgba(255,190,90,' + a + ')'); g.addColorStop(0.75, 'rgba(230,90,40,' + (a * 0.7) + ')'); g.addColorStop(1, 'rgba(120,30,20,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - r * 0.3, r, 0, 7); ctx.fill();
}
// людина: малюється на окремому полотні, затемнюється в силует, контурне світло від сонця
function menuDrawHuman(ctx, x, y, S) {
  const W = Math.ceil(110 * S), H = Math.ceil(110 * S);
  if (!MENU.hc || MENU.hc.width !== W) { MENU.hc = document.createElement('canvas'); MENU.hc.width = W; MENU.hc.height = H; }
  const c = MENU.hc, cx = c.getContext('2d');
  cx.setTransform(1, 0, 0, 1, 0, 0); cx.globalCompositeOperation = 'source-over'; cx.clearRect(0, 0, W, H);
  cx.setTransform(S * 1.25, 0, 0, S * 1.25, W / 2, H * 0.92);
  drawHuman(cx, MENU_HUMAN, MENU.t, 1);
  cx.setTransform(1, 0, 0, 1, 0, 0);
  cx.globalCompositeOperation = 'source-atop';
  cx.fillStyle = 'rgba(20,9,18,0.88)'; cx.fillRect(0, 0, W, H);
  const rim = cx.createLinearGradient(W * 0.66, 0, W * 0.5, 0);
  rim.addColorStop(0, 'rgba(255,165,85,' + (0.55 + MENU.flash * 0.35) + ')'); rim.addColorStop(1, 'rgba(255,160,80,0)');
  cx.fillStyle = rim; cx.fillRect(0, 0, W, H);
  cx.globalCompositeOperation = 'source-over';
  // тінь на землі
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x - 4 * S, y + 1, 22 * S, 3 * S, 0, 0, 7); ctx.fill();
  ctx.drawImage(c, x - W / 2, y - H * 0.92);
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
  // вогник камери
  ctx.fillStyle = 'rgba(255,60,60,' + (0.6 + 0.4 * Math.sin(MENU.t * 30)) + ')'; ctx.beginPath(); ctx.arc(0, 0, 1.5 * S, 0, 7); ctx.fill();
  ctx.restore();
}
// ===== Музика меню =====
const menuMusic = {
  on: loadMenuPref(), el: null, unlocked: false,
  src: 'https://upload.wikimedia.org/wikipedia/commons/0/04/W._A._Mozart_-_Requiem_-_8._Lacrimosa_%28Herbert_von_Karajan%2C_Wiener_Philharmoniker%2C_Wiener_Singverein%2C_1960%29.ogg',
  credit: 'В. А. Моцарт — Реквієм, Lacrimosa · Г. фон Караян, Віденська філармонія, 1960 · Wikimedia Commons, суспільне надбання',
};
function loadMenuPref() { try { return localStorage.getItem('fpv.music') !== '0'; } catch (e) { return true; } }
function menuMusicPlay() {
  if (!menuMusic.el) { menuMusic.el = new Audio(menuMusic.src); menuMusic.el.loop = true; menuMusic.el.volume = 0; menuMusic.el.preload = 'auto'; }
  const p = menuMusic.el.play(); if (p && p.catch) p.catch(() => { /* браузер чекає на клік */ });
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
function menuMusicBtn() { return '<button class="music" data-act="music" title="' + menuMusic.credit + '">' + (menuMusic.on ? '🔊' : '🔇') + ' Lacrimosa</button>'; }
