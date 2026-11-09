'use strict';
// ===== Предмети побуту, кидки, гранати, укріплення будівель =====
// Предмети лежать на поверхах і дахах будівель. Їх беруть у руки («Дія») і кидають («Вогонь»),
// зокрема з вікон і з даху по дронах. Гранати — окремо (клавіша 3).
// Після маскувальної сітки в будівлі можна забивати фанерою вікна й діри та ставити станкові гвинтівки.

const PROP_TYPES = {
  jar: { name: 'Банка з огірками', spd: 600, breaks: true },
  chair: { name: 'Стілець', spd: 470, breaks: false },
  stool: { name: 'Табурет', spd: 520, breaks: false },
  pot: { name: 'Каструля', spd: 560, breaks: false },
  brick: { name: 'Цегла', spd: 580, breaks: false },
  tv: { name: 'Старий телевізор', spd: 420, breaks: true },
  iron: { name: 'Праска', spd: 580, breaks: false },
};
const THROW_G = 1100;        // кинуті речі падають трохи м'якше, ніж люди стрибають (кидок ~30 м, угору ~15 м)
const GRENADE_SPD = 600, GRENADE_FUSE = 2.2, GRENADES_START = 2, GRENADES_MAX = 4;
const GRENADE_POWER = 70, GRENADE_R = 85, GRENADE_DRONE_R = 70; // дрон ближче 7 м від вибуху гранати — збито
const PLY_PER_NET = 8;       // листів фанери на будівлю після сітки
const PLY_TIME = 1.2, MOUNT_TIME = 2.5, MOUNTS_PER_BLD = 2, MOUNT_AMMO = 80;
const BT = 14;               // товщина стін будівлі (як у world.js)
WEAPONS.mrifle = { name: 'Станкова гвинтівка', ammo: MOUNT_AMMO, mag: MOUNT_AMMO, reload: 0, rate: 0.16, speed: 1900, range: 600, spread: 0.007, pellets: 1, dmg: 70 };
AIM_SECTOR.mount = [-0.7, 0.4];
STANCE_ACC.mount = 'станкова — дуже точно';

// ---------- Предмети в руках ----------
function nearProp(h) {
  let best = null, bd = 28;
  for (const p of G.W.props) {
    if (Math.abs(p.y - h.y) > 12) continue;
    const d = Math.abs(p.x - h.x);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
function takeProp(h, p) {
  G.W.props = G.W.props.filter((x) => x !== p);
  h.carry = p.type; h.aiming = false;
  feed(h.player.name + ' взяв: ' + PROP_TYPES[p.type].name.toLowerCase(), '#ddd');
  Sfx.click();
}
function dropCarry(h) {
  if (!h.carry) return;
  const x = clamp(h.x + h.facing * 14, 20, G.W.width - 20);
  G.W.props.push({ type: h.carry, x, y: landSurface(x, h.y - 30) });
  h.carry = null;
}
function throwAngle(h) { return h.aiming ? aimWorld(h) : h.facing > 0 ? -0.55 : Math.PI + 0.55; }
function handPos(h) { return { x: h.x + h.facing * 8, y: h.y - HUMAN_DIM[h.stance].h * 0.82 - trenchLift(h) }; }
// чи можна зараз цілитися гранатою (затиснута кнопка гранати)
function canGrenAim(h) { return h.grenades > 0 && !h.carry && !h.canister && !h.mount && !h.vehicle && h.grenadeCd <= 0; }
// куди полетить граната: точки дуги (та сама фізика, що й у кидка)
function grenadePath(h) {
  const a = aimWorld(h), p = handPos(h), W = G.W, pts = [{ x: p.x, y: p.y }];
  let x = p.x, y = p.y, vx = Math.cos(a) * GRENADE_SPD + h.vx * 0.3, vy = Math.sin(a) * GRENADE_SPD;
  const dt = 1 / 60;
  for (let i = 0; i < 150; i++) {
    vy += THROW_G * dt; vx *= Math.exp(-0.15 * dt);
    const nx = x + vx * dt, ny = y + vy * dt;
    if (nx < 5 || nx > W.width - 5 || pointSolid(W, nx, ny, solidsNear(W, nx - 4, nx + 4))) { pts.push({ x, y, end: true }); return pts; }
    x = nx; y = ny; if (i % 2) pts.push({ x, y });
  }
  pts.push({ x, y }); return pts;
}
function throwCarry(h) {
  const T = PROP_TYPES[h.carry], a = throwAngle(h), p = handPos(h);
  G.throws.push({ kind: 'prop', type: h.carry, x: p.x, y: p.y, vx: Math.cos(a) * T.spd + h.vx * 0.3, vy: Math.sin(a) * T.spd, rot: 0, spin: rand(-12, 12), owner: h });
  h.carry = null; h.fireCd = 0.35;
  Sfx.noise_(0.12, 0.08, 900, 'bandpass');
}
function throwGrenade(h, ang) {
  if (h.grenades <= 0) { tipOnce(h, 'Гранат немає'); return; }
  if (h.canister || h.carry) { tipOnce(h, 'Руки зайняті'); return; }
  if (h.grenadeCd > 0) return;
  const a = ang != null ? ang : throwAngle(h), p = handPos(h);
  h.grenades--; h.grenadeCd = 0.8;
  G.throws.push({ kind: 'grenade', x: p.x, y: p.y, vx: Math.cos(a) * GRENADE_SPD + h.vx * 0.3, vy: Math.sin(a) * GRENADE_SPD, rot: 0, spin: rand(-10, 10), fuse: GRENADE_FUSE, owner: h });
  feed(h.player.name + ': граната!', '#c9a227');
  Sfx.click();
}
// вхід у схованку біля точки (бліндаж, нора, вихід тунелю)
function hideAtPoint(x, y) {
  for (const sp of G.W.hides) {
    if (sp.ruined) continue;
    if (sp.type === 'pipe') {
      for (const e of sp.exits) {
        const nm = sp.style === 'sewer' ? 'каналізацію' : 'тунель';
        if (rampOpen(e, x) && Math.abs(y - gAt(G.W, x)) < 16) { const p = tunExitPos(e, rampU(e, x)); return { sp, e, x: p.x, y: p.y, name: nm }; }
        if (dist(x, y, e.tx, e.ty - 4) < 20) return { sp, e, x: e.tx, y: e.ty, name: nm };
      }
    } else if (dist(x, y, sp.x, sp.y - 5) < 24) return { sp, x: sp.x, y: sp.y, name: sp.type === 'bunker' ? 'бліндаж' : 'нору' };
  }
  return null;
}
// вибух гранати всередині схованки: тим, хто там, — дуже погано; схованка пошкоджена
function grenadeInside(th) {
  const it = th.inside, sp = it.sp;
  explosionFx(it.x, it.y - 6, 45, 45);
  Sfx.boom(false);
  G.blastBy = th.owner ? th.owner.player : null;
  for (const h of G.humans) {
    if (h.dead || h.hidden !== sp) continue;
    if (sp.type === 'pipe' && dist(h.x, h.y, it.e.bx, it.e.by) > 170 && dist(h.x, h.y, it.x, it.y) > 120) continue;
    hurt(h, 120, 'blast');
  }
  G.blastBy = null;
  if (sp.hp) { sp.hp--; if (sp.hp <= 0) ruinHide(sp); }
}
function grenadeBlast(th) {
  if (th.inside) { grenadeInside(th); return; }
  const x = th.x, y = th.y;
  G.blastBy = th.owner ? th.owner.player : null;
  explosion(x, y, GRENADE_POWER, GRENADE_R);
  G.blastBy = null;
  for (const d of G.drones.slice()) {
    if (dist(x, y, d.x, d.y) > GRENADE_DRONE_R || ally(th.owner, d)) continue;
    if (d.hp > 3) d.hp -= 3; else shootDownDrone(d, th.owner);
  }
}
// влучання предметом у дрон: збиває (броньований — втрачає 2 «життя»)
function propHitsDrone(th, d) {
  if (d.hp > 2) { d.hp -= 2; Sfx.tone(900, 0.05, 0.08); }
  else { feed(th.owner.player.name + ' збив дрон: ' + PROP_TYPES[th.type].name.toLowerCase() + '!', '#56ccf2'); shootDownDrone(d, th.owner); }
}
function breakProp(th) {
  const col = th.type === 'jar' ? ['#9fc98a', '#5f8f3a', '#d8e6c8'] : ['#333', '#6a6a6a', '#9ad'];
  for (let i = 0; i < 10; i++) G.parts.push({ type: 'debris', x: th.x, y: th.y - 3, vx: rand(-160, 160), vy: rand(-220, -40), life: rand(0.5, 0.9), max: 0.9, col: pick(col) });
  Sfx.noise_(0.15, 0.12, 3000, 'highpass');
}
function updateThrows(dt) {
  const W = G.W;
  for (let i = G.throws.length - 1; i >= 0; i--) {
    const th = G.throws[i];
    if (th.kind === 'grenade' && (th.fuse -= dt) <= 0) { G.throws.splice(i, 1); grenadeBlast(th); continue; }
    // граната, що котиться чи падає біля входу в схованку, залітає всередину
    th.age = (th.age || 0) + dt;
    if (th.kind === 'grenade' && !th.inside && Math.hypot(th.vx, th.vy) < 380 && th.age > 0.35) {
      const into = hideAtPoint(th.x, th.y);
      if (into) {
        th.inside = into; th.rest = true; th.x = into.x; th.y = into.y;
        feed('Граната залетіла в ' + into.name + '!', '#c9a227');
      }
    }
    if (th.rest) continue;
    th.vy += THROW_G * dt; th.vx *= Math.exp(-0.15 * dt); th.rot += th.spin * dt;
    const steps = Math.max(1, Math.ceil((Math.hypot(th.vx, th.vy) * dt) / 5));
    let gone = false;
    for (let s = 0; s < steps && !gone; s++) {
      const px = th.x, py = th.y;
      th.x += (th.vx * dt) / steps; th.y += (th.vy * dt) / steps;
      if (th.x < 5 || th.x > W.width - 5) { gone = true; break; }
      if (!th.hitDrone) for (const d of G.drones) {
        if (dist(th.x, th.y, d.x, d.y) > DRONE_R + 6 || ally(th.owner, d)) continue;
        th.hitDrone = true;
        if (th.kind === 'grenade') { th.vx *= 0.3; th.vy = Math.abs(th.vy) * 0.2; }
        else { propHitsDrone(th, d); th.vx *= -0.3; th.vy = 60; }
        break;
      }
      const list = solidsNear(W, th.x - 4, th.x + 4);
      if (!pointSolid(W, th.x, th.y, list)) continue;
      // удар об поверхню
      const hitX = pointSolid(W, th.x, py, list), hitY = pointSolid(W, px, th.y, list);
      th.x = px; th.y = py;
      if (th.kind === 'prop') {
        if (PROP_TYPES[th.type].breaks) breakProp(th);
        else { W.props.push({ type: th.type, x: th.x, y: landSurface(th.x, th.y - 4) }); Sfx.tone(160, 0.05, 0.08); }
        gone = true; break;
      }
      // граната відскакує й котиться
      if (hitY || !hitX) { th.vy = -th.vy * 0.3; th.vx *= 0.6; } else th.vx = -th.vx * 0.4;
      if (Math.hypot(th.vx, th.vy) < 50) { th.rest = true; th.y = landSurface(th.x, th.y - 4) - 3; }
      break;
    }
    if (gone) G.throws.splice(i, 1);
  }
}

// ---------- Укріплення будівлі ----------
function bldUnder(h) {
  const b = buildingAt(h.x, h.y);
  if (b) return b;
  // на даху — і в стрибку над ним (до ~1,5 висоти стрибка)
  for (const x of G.W.backs) if (!x.ruined && h.x > x.x && h.x < x.x + x.w && h.y < x.y - 14 + 5 && h.y > x.y - 14 - 140) return x;
  return null;
}
function uncovered(lo, hi, segs, min) {
  segs.sort((a, b) => a[0] - b[0]);
  const out = [];
  let cur = lo;
  for (const [a, b] of segs) {
    if (b <= cur) continue;
    if (a > cur) out.push([cur, Math.min(a, hi)]);
    cur = Math.max(cur, b);
    if (cur >= hi) break;
  }
  if (cur < hi) out.push([cur, hi]);
  return out.filter(([a, b]) => b - a >= min);
}
// отвори будівлі: вікна й діри в бічних стінах, проломи в даху й перекриттях
function bldGaps(b) {
  const W = G.W, g = b.y + b.h, list = solidsNear(W, b.x - 2, b.x + b.w + 2), gaps = [];
  for (const side of [-1, 1]) {
    const wx = side < 0 ? b.x : b.x + b.w - BT, cx = wx + BT / 2;
    for (let k = 0; k < b.floors; k++) {
      const yb = g - k * FLOOR_H, top = yb - FLOOR_H;
      const segs = list.filter((s) => !s.thin && s.x <= cx && s.x + s.w >= cx && s.y < yb && s.y + s.h > top).map((s) => [s.y, s.y + s.h]);
      for (const [y0, y1] of uncovered(top, yb, segs, 12)) gaps.push({ kind: 'side', side, x: wx, y: y0, w: BT, h: y1 - y0, k, door: k === 0 && y1 >= yb - 1 });
    }
  }
  const ry = b.y - 7;
  const rsegs = list.filter((s) => !s.thin && s.y <= ry && s.y + s.h >= ry).map((s) => [s.x, s.x + s.w]);
  for (const [x0, x1] of uncovered(b.x, b.x + b.w, rsegs, 12)) gaps.push({ kind: 'roof', x: x0, y: b.y - 14, w: x1 - x0, h: 14 });
  for (let k = 1; k < b.floors; k++) {
    const y = g - k * FLOOR_H;
    const fsegs = list.filter((s) => s.y <= y + 5 && s.y + s.h >= y + 5).map((s) => [s.x, s.x + s.w]);
    for (const [x0, x1] of uncovered(b.x + BT, b.x + b.w - BT, fsegs, 12)) gaps.push({ kind: 'floor', x: x0, y, w: x1 - x0, h: 10, k });
  }
  return gaps;
}
// отвір, до якого людина дотягується (для фанери — без дверей першого поверху)
function nearGap(h, b, mount) {
  let best = null, bd = 1e9;
  for (const gp of bldGaps(b)) {
    let d = 1e9;
    if (gp.kind === 'side') {
      if (gp.door && !mount) continue;
      // вікно з вогневою позицією не забиваємо — гвинтівка стріляє крізь нього
      if (!mount && G.W.mounts.some((m) => Math.abs(m.x - (gp.x + BT / 2)) < 30 && m.y > gp.y && m.y - 40 < gp.y + gp.h)) continue;
      const dx = Math.abs(h.x - (gp.x + BT / 2));
      if (dx < 40 && gp.y < h.y + 2 && gp.y + gp.h > h.y - 60) d = dx;
    } else if (mount) continue;
    else {
      const inX = (m) => h.x > gp.x - m && h.x < gp.x + gp.w + m;
      const dx = Math.max(0, gp.x - h.x, h.x - gp.x - gp.w);
      if (gp.kind === 'roof') {
        if ((Math.abs(h.y - gp.y) < 6 && inX(30)) || (Math.abs(h.y - (b.y + FLOOR_H)) < 6 && inX(10))) d = dx + 5;
      } else if ((Math.abs(h.y - gp.y) < 6 && inX(30)) || (Math.abs(h.y - (gp.y + FLOOR_H)) < 6 && inX(10))) d = dx + 5;
    }
    if (d < bd) { bd = d; best = gp; }
  }
  return best;
}
function fortTarget(h) {
  const b = bldUnder(h);
  if (!b) return null;
  // командний режим: латає власник (без сітки), інакше — після сітки
  if (isTeam() ? !hideOwnedBy(b, h.player.team) : !b.net) return null;
  const gp = nearGap(h, b, false);
  return gp ? { b, gp } : null;
}
function mountTarget(h) {
  const b = buildingAt(h.x, h.y);
  if (!b || !h.onGround) return null;
  if (isTeam() ? !hideOwnedBy(b, h.player.team) : !b.net) return null;
  const gp = nearGap(h, b, true);
  if (!gp) return null;
  const my = h.y - 38;
  if (gp.y > my - 4 || gp.y + gp.h < my + 4) return { b, gp, bad: 'Отвір не на рівні гвинтівки' };
  if ((b.mounts || 0) >= MOUNTS_PER_BLD) return { b, gp, bad: 'У будівлі вже ' + MOUNTS_PER_BLD + ' вогневі позиції' };
  const x = gp.side < 0 ? gp.x + BT + 12 : gp.x - 12;
  if (G.W.mounts.some((m) => Math.abs(m.x - x) < 30 && Math.abs(m.y - h.y) < 20)) return { b, gp, bad: 'Тут уже є вогнева позиція' };
  return { b, gp, x };
}
// латати можна скільки завгодно; великий пролом — частинами по 120 px біля людини
function startPly(h, t) {
  const gp = t.gp;
  let seg = { x: gp.x, y: gp.y, w: gp.w, h: gp.h };
  if (gp.kind !== 'side' && gp.w > 120) seg = { x: clamp(h.x - 60, gp.x, gp.x + gp.w - 120), y: gp.y, w: 120, h: gp.h };
  h.working = { kind: 'ply', t: 0, dur: PLY_TIME, b: t.b, gp, seg };
  h.vx = 0;
}
function startMount(h, t) {
  if (t.bad) { tipOnce(h, t.bad); return; }
  h.working = { kind: 'mount', t: 0, dur: MOUNT_TIME, b: t.b, gp: t.gp, x: t.x, y: h.y };
  h.vx = 0;
}
function tickWork(h, c, dt) {
  const D = h.working, W = G.W;
  if (c.axisX || c.pressed('up') || c.pressed('down') || c.pressed('fire')) { h.working = null; tipOnce(h, 'Роботу перервано'); return; }
  D.t += dt; h.anim += dt * 6;
  if (RND() < dt * 6) Sfx.tone(D.kind === 'ply' ? 520 : 300, 0.03, 0.06);
  if (D.t < D.dur) return;
  h.working = null;
  const gp = D.gp;
  if (D.kind === 'ply') {
    // отвір міг змінитися (вибух) — перевіряємо, що він ще є
    if (!bldGaps(D.b).some((x) => x.kind === gp.kind && Math.abs(x.x - gp.x) < 3 && Math.abs(x.y - gp.y) < 3)) return;
    const sg = D.seg || gp;
    addSolid(W, { type: 'plywood', x: sg.x, y: sg.y, w: sg.w, h: sg.h, hp: 1, thin: gp.kind === 'floor', bld: D.b });
    buildBuckets(W);
    feed(h.player.name + ' залатав ' + (gp.kind === 'side' ? 'вікно' : 'пролом') + ' фанерою', '#c9a36a');
  } else {
    W.mounts.push({ x: D.x, y: D.y, dir: gp.side, ammo: MOUNT_AMMO, b: D.b, user: null });
    D.b.mounts = (D.b.mounts || 0) + 1;
    feed(h.player.name + ' облаштував вогневу позицію зі станковою гвинтівкою', '#c9a36a');
  }
  Sfx.click();
}
function nearMount(h) {
  for (const m of G.W.mounts) if (!m.user && Math.abs(m.x - h.x) < 24 && Math.abs(m.y - h.y) < 12) return m;
  return null;
}
function useMount(h, m) {
  m.user = h; h.mount = m; h.x = m.x; h.y = m.y; h.facing = m.dir; h.aimA = -0.1; h.stance = 'stand';
  if (h.carry) dropCarry(h);
  Sfx.click();
}
function leaveMount(h) {
  if (h.mount) h.mount.user = null;
  h.mount = null; h.aiming = false;
}
function mountMuzzle(h) {
  const m = h.mount, a = aimWorld(h);
  return { x: m.x + Math.cos(a) * 22, y: m.y - 38 + Math.sin(a) * 22 };
}
function humanOnMount(h, c, dt) {
  const m = h.mount;
  h.x = m.x; h.y = m.y; h.vx = 0; h.vy = 0; h.stance = 'stand'; h.onGround = true; h.aiming = true;
  if (c.cur.aimAngle !== undefined) setAimWorld(h, c.cur.aimAngle);
  else h.aimA += ((c.held('down') ? 1 : 0) - (c.held('up') ? 1 : 0)) * 1.2 * dt;
  h.facing = m.dir;
  h.aimA = clamp(h.aimA, AIM_SECTOR.mount[0], AIM_SECTOR.mount[1]);
  backpackInput(h, c);
  if (c.pressed('special')) activateReb(h);
  if (c.held('fire') && h.fireCd <= 0) {
    if (m.ammo > 0) { const mz = mountMuzzle(h); fireWeapon(h, mz.x, mz.y, 'mrifle', aimWorld(h), false, 'mount'); h.fireCd = WEAPONS.mrifle.rate; m.ammo--; }
    else if (c.pressed('fire')) tipOnce(h, 'Набої станкової гвинтівки скінчилися');
  }
  if (c.pressed('interact') || c.axisX === -m.dir) leaveMount(h);
  checkShelter(h);
}
// вибух ламає станкові гвинтівки поруч (фанеру ламає damageCovers через hp)
function damageFort(x, y, power) {
  const W = G.W, r = power >= 100 ? 50 : 36;
  W.mounts = W.mounts.filter((m) => {
    if (dist(x, y, m.x, m.y - 30) > r) return true;
    if (m.user) leaveMount(m.user);
    if (m.b) m.b.mounts = Math.max(0, (m.b.mounts || 1) - 1);
    for (let i = 0; i < 8; i++) G.parts.push({ type: 'debris', x: m.x, y: m.y - 30, vx: rand(-200, 200), vy: rand(-300, -50), life: rand(0.6, 1.1), max: 1.1, col: '#333' });
    feed('Станкову гвинтівку знищено', '#f2994a');
    return false;
  });
}

// ---------- Рукопашний бій ----------
// «Вогонь» без позиції впритул до ворожої людини чи дрона — удар (кулак, приклад або річ у руках)
const MELEE_REACH = 36, MELEE_CD = 0.55, MELEE_T = 0.22;
const MELEE_DMG = { fist: 20, butt: 35, prop: 30 };
function meleeTarget(h) {
  if (h.dead || h.hidden || h.vehicle || h.mount || h.canister) return null;
  let best = null, bd = MELEE_REACH;
  for (const o of G.humans) {
    if (o === h || o.dead || o.saved || covered(o) || o.vehicle || !isTeam() || allyP(o.player, h.player)) continue;
    const dx = Math.abs(o.x - h.x);
    if (dx < bd && Math.abs(o.y - h.y) < 30) { bd = dx; best = { kind: 'h', o }; }
  }
  if (best) return best;
  const hy = h.y - HUMAN_DIM[h.stance].h * 0.6;
  for (const d of G.drones) {
    if (ally(d, h)) continue;
    const dd = Math.min(dist(h.x + h.facing * 12, hy, d.x, d.y), dist(h.x + h.facing * 14, h.y - 8, d.x, d.y));
    if (dd < 30 + DRONE_R && dd < bd + DRONE_R) { bd = dd - DRONE_R; best = { kind: 'd', o: d }; }
  }
  return best;
}
function melee(h, t) {
  const o = t.o;
  h.meleeCd = MELEE_CD; h.meleeT = MELEE_T; h.healT = 0;
  h.facing = Math.sign(o.x - h.x) || h.facing;
  const how = h.carry ? 'prop' : h.weapon ? 'butt' : 'fist';
  if (t.kind === 'd') {
    if (o.hp > 2) { o.hp -= 2; Sfx.tone(900, 0.05, 0.08); }
    else { feed(h.player.name + ' збив дрон ударом!', '#56ccf2'); shootDownDrone(o, h); }
  } else {
    o.lastHitBy = h.player;
    hurt(o, MELEE_DMG[how], 'melee');
    // відкидає й перериває те, що ворог робив
    o.vx = h.facing * 260; if (o.onGround) { o.vy = -140; o.onGround = false; }
    o.healT = 0; o.working = null; o.digging = null; o.aiming = false; o.climb = null; o.onLadder = false;
    if (o.mount) leaveMount(o);
    if (o.carry && Math.random() < 0.5) dropCarry(o);
  }
  for (let i = 0; i < 6; i++) G.parts.push({ type: 'spark', x: o.x - h.facing * 6, y: (t.kind === 'd' ? o.y : o.y - 30), vx: h.facing * rand(40, 160), vy: rand(-140, 20), life: 0.25, max: 0.25 });
  Sfx.noise_(0.09, 0.2, 500, 'lowpass');
  // крихка річ розбивається об ворога
  if (how === 'prop' && PROP_TYPES[h.carry].breaks) { breakProp({ type: h.carry, x: h.x + h.facing * 14, y: h.y - 40 }); h.carry = null; }
}
