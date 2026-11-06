'use strict';
// ===== Боти: керують людиною або дроном через той самий інтерфейс, що й гравці =====
const BOT_LEVELS = [
  { name: 'легкі', react: 0.55, sense: 0.7, speed: 0.75, lead: 0.1, aim: 0.5 },
  { name: 'звичайні', react: 0.8, sense: 0.9, speed: 0.9, lead: 0.3, aim: 0.8 },
  { name: 'складні', react: 1, sense: 1.1, speed: 1, lead: 0.45, aim: 1 },
];

class BotController {
  constructor(p, level) {
    this.p = p; this.isPad = false; this.isBot = true;
    this.L = BOT_LEVELS[level] || BOT_LEVELS[1];
    this.cur = { ax: 0, ay: 0 }; this.prev = {};
    this.name = 'Бот';
    this.m = { aimT: 0, stuck: 0, safeT: 0, hideCd: 0, noVehT: 0, last: null, lostT: 99, zig: Math.random() * 6, patrol: 1, reactT: 0, seenT: 0 };
  }
  held(a) { return !!this.cur[a]; }
  pressed(a) { return !!this.cur[a] && !this.prev[a]; }
  get axisX() { return (this.cur.right ? 1 : 0) - (this.cur.left ? 1 : 0); }
  label() { return ''; }
  connected() { return true; }
  poll(dt) {
    this.prev = this.cur;
    const s = { ax: 0, ay: 0 };
    if (G && !G.over) {
      if (this.p.role === 'human') thinkHuman(this, s, dt);
      else thinkDrone(this, s, dt);
    }
    this.cur = s;
  }
  // натискання (тільки якщо в попередньому кадрі кнопку не тримали — щоб спрацював «фронт»)
  tap(s, a) { if (!this.prev[a]) s[a] = true; }
}

// кут прицілу на дрон з упередженням і похибкою (залежить від складності)
function botAim(b, ox, oy, d, bulletSpeed) {
  const L = b.L;
  const t = dist(ox, oy, d.x, d.y) / bulletSpeed;
  const lx = d.x + d.vx * t * L.lead * 2, ly = d.y + d.vy * t * L.lead * 2;
  return Math.atan2(ly - oy, lx - ox) + (Math.random() * 2 - 1) * (1 - L.aim) * 0.12;
}

function coverFor(h, stanceH) {
  for (const c of G.W.covers) {
    if (h.x < c.x || h.x > c.x + c.w) continue;
    if (h.y - stanceH >= c.y && h.y <= c.y + c.h + 8) return true;
  }
  return false;
}

function thinkHuman(b, s, dt) {
  const h = b.p.ent, m = b.m, L = b.L, W = G.W;
  if (h.dead || h.saved) return;
  // загрози: видимі дрони + ті, що чути зовсім поруч
  let threat = null, td = 1e9, hear = 1e9;
  for (const d of G.drones) {
    const dd = dist(d.x, d.y, h.x, h.y - 25);
    if (!d.landed) hear = Math.min(hear, dd); // «ждуна» на землі не чути
    if (dd < td && (droneVisibleToHuman(d, h) || dd < 260)) { td = dd; threat = d; }
  }
  // реакція з затримкою (залежить від складності)
  if (threat && td < 450) m.reactT += dt; else m.reactT = 0;
  const danger = threat && td < 420 && m.reactT > 0.6 - L.react * 0.5;
  const visibleThreat = threat && droneVisibleToHuman(threat, h) && lineOfSight(W, h.x, h.y - 30, threat.x, threat.y);

  if (h.vehicle) {
    const v = h.vehicle;
    if (h.seat === 'driver') {
      s.right = true;
      // міна попереду або ходову вже знищено — виходимо
      if (v.immob || G.mines.some((mi) => mi.arm <= 0 && mi.x > v.x && mi.x - v.x < 160 && Math.abs(mi.y - v.y) < 30)) { b.tap(s, 'interact'); m.noVehT = 6; return; }
      // застрягла техніка: мало проїхали за останні 2 с — виходимо
      if (m.progX == null || Math.abs(v.x - m.progX) > 40) { m.progX = v.x; m.stuck = 0; } else m.stuck += dt;
      if (m.stuck > 2) { b.tap(s, 'interact'); m.stuck = 0; m.progX = null; m.noVehT = 8; }
      if (danger && td < 280 && h.reb > 0 && Math.random() < L.react) b.tap(s, 'special');
    } else {
      if (visibleThreat && td < WEAPONS.mg.range && v.mgAmmo > 0) {
        const T = VEH[v.type];
        s.aimAngle = botAim(b, v.x - v.dir * T.len * 0.15, v.y - T.h - 14, threat, WEAPONS.mg.speed);
        if (m.aimT > 0.25) s.fire = true;
        m.aimT += dt;
      } else m.aimT = 0;
      if (!v.driver || v.mgAmmo <= 0) b.tap(s, 'interact');
    }
    return;
  }

  if (h.hidden) {
    const sp = h.hidden;
    // натягнути маскувальну сітку на свою схованку (і зберегти точку відновлення)
    if (sp.type !== 'pipe' && !sp.net && h.nets > 0 && !h.hideAnim) { s.aim = true; b.tap(s, 'interact'); return; }
    m.safeT = hear < 600 ? 0 : m.safeT + dt;
    m.hideT = (m.hideT || 0) + dt;
    if (sp.type === 'pipe') {
      const toRight = sp.x2 > sp.x1;
      if (toRight) s.right = true; else s.left = true;
      if (h.pipeT > 0.9 && m.safeT > 1.2) { b.tap(s, 'interact'); m.hideCd = 4; }
    } else if (m.safeT > 2.5 || h.smokeT > 0.4 || m.hideT > 25) { b.tap(s, 'interact'); m.hideCd = 4; m.hideT = 0; }
    return;
  }

  m.hideCd -= dt; m.noVehT -= dt; m.hideT = 0;
  let dir = 1;      // куди бігти
  let stop = false; // зупинитися й причаїтися

  if (danger) {
    if (h.reb > 0 && td < 300 && Math.random() < L.react * 0.5) b.tap(s, 'special');
    // схованка поруч?
    if (m.hideCd <= 0) {
      if (nearHide(h) && !nearPickup(h) && !nearVehicle(h)) { b.tap(s, 'interact'); return; }
      let best = null, bd = 220;
      for (const sp of W.hides) {
        if (sp.ruined) continue;
        const ex = sp.type === 'pipe' ? (sp.x2 > sp.x1 ? sp.x1 : sp.x2) : sp.x;
        const ey = sp.type === 'pipe' ? (sp.x2 > sp.x1 ? sp.y1 : sp.y2) : sp.y;
        const dd = Math.abs(ex - h.x);
        if (dd < bd && ex > h.x - 120 && Math.abs(ey - h.y) < 60) { bd = dd; best = ex; }
      }
      if (best != null) dir = Math.sign(best - h.x) || 1;
    }
    // маскування: якщо в укритті (кущі, окоп, дерева) — лягти й перечекати
    if (!h.weapon && dir === 1) {
      if (coverFor(h, HUMAN_DIM.stand.h)) stop = true;
      else if (coverFor(h, HUMAN_DIM.prone.h)) { stop = true; if (h.stance !== 'prone') b.tap(s, 'down'); }
    }
  }
  if (!stop && h.stance !== 'stand') b.tap(s, 'up');

  // бонус «Альоша»: увімкнути, коли дрон близько; далі автонаведення — просто стріляти
  if (h.alCharges > 0 && h.alT <= 0 && threat && td < 450 && h.onGround) { s.aim = true; b.tap(s, 'special'); }
  if (h.alT > 0) { s.fire = G.drones.some((d) => dist(d.x, d.y, h.x, h.y - 30) < 900); stop = false; }
  // стрільба
  else if (h.weapon && visibleThreat && h.onGround && td < WEAPONS[h.weapon.type].range * (0.6 + 0.3 * L.aim)) {
    s.aim = true; stop = true;
    const mz = muzzle(h);
    s.aimAngle = botAim(b, mz.x, mz.y, threat, WEAPONS[h.weapon.type].speed);
    m.aimT += dt;
    if (m.aimT > 0.35 - 0.15 * L.react) s.fire = true;
  } else m.aimT = 0;
  // кидок на землю, коли дрон пікірує впритул
  if (threat && td < 170 && !s.aim && h.stance === 'stand' && Math.abs(h.vx) > 140 && Math.random() < L.react * 0.5) {
    const closing = (threat.vx * (h.x - threat.x) + threat.vy * (h.y - 25 - threat.y)) / Math.max(1, td);
    if (closing > 200) b.tap(s, 'down');
  }

  // підбір і техніка
  const pk = nearPickup(h);
  if (pk && ((pk.type === 'armor' && h.armor <= 0) || pk.type === 'reb' || (pk.type === 'medkit' && h.hp < 80) || (pk.type === 'fuel' && !h.canister) || ((pk.type === 'rifle' || pk.type === 'shotgun') && !h.weapon))) b.tap(s, 'interact');
  else if (m.noVehT <= 0 && nearVehicle(h)) {
    const v = nearVehicle(h);
    if (v.driver || v.fuel > 1.5 || h.canister) b.tap(s, 'interact');
  }

  // довго в диму — вибиратися, не зупинятися
  if (h.gasT > 10) { stop = false; s.aim = false; s.fire = false; }
  if (!stop) {
    if (dir > 0) s.right = true; else s.left = true;
    s.sprint = (danger || h.openTime > 1.5) && h.stamina > 0.05;
    // застряг — стрибок / залізти на уступ
    if (h.onGround && Math.abs(h.vx) < 15) m.stuck += dt; else m.stuck = 0;
    if (m.stuck > 0.2 && h.stance === 'stand') { b.tap(s, 'up'); }
    // міну на шляху перестрибнути
    if (h.onGround && G.mines.some((mi) => mi.arm <= 0 && (mi.x - h.x) * dir > 10 && (mi.x - h.x) * dir < 45 && Math.abs(mi.y - h.y) < 14)) {
      b.tap(s, 'up');
    }
    if (m.stuck > 3) { s.right = !s.right; s.left = !s.left; if (m.stuck > 3.6) m.stuck = 0; }
  }
}

function wantDrop(b, s, d, type) {
  if (d.payload !== type) b.tap(s, 'interact');
  else b.tap(s, 'special');
}
function nearestHideTo(x, y, d) {
  let best = null, bd = 110;
  for (const sp of G.W.hides) {
    if (sp.ruined) continue;
    if (sp.net && !droneHovering(d, sp.x, sp.y - 10)) continue; // під сіткою вхід не видно
    const ends = sp.type === 'pipe' ? [[sp.x1, sp.y1], [sp.x2, sp.y2]] : [[sp.x, sp.y]];
    for (const [ex, ey] of ends) { const dd = dist(x, y, ex, ey); if (dd < bd) { bd = dd; best = { x: ex, y: ey }; } }
  }
  return best;
}

function thinkDrone(b, s, dt) {
  const dp = b.p.ent, d = dp.drone, m = b.m, L = b.L, W = G.W;
  if (!d) { m.last = m.last && m.lostT < 20 ? m.last : null; m.ambT = 0; return; }
  if (d.onPad) { b.tap(s, 'up'); return; }
  // що бачить камера дрона (без підглядання)
  let tgt = null, best = 1e9;
  for (const h of G.humans) {
    if (h.dead || h.saved) continue;
    const inCam = Math.abs(h.x - d.x) < 700 * L.sense && Math.abs(h.y - d.y) < 450 * L.sense && humanVisibleToDrone(h, d);
    const arrow = !h.hidden && h.openTime >= OPEN_TIME;
    if (!inCam && !arrow) continue;
    const dd = dist(d.x, d.y, h.x, h.y);
    if (dd < best) { best = dd; tgt = h; }
  }
  // «ждун»: сидимо на землі, поки людина не підійде
  if (d.landed) {
    m.ambT = (m.ambT || 0) + dt;
    if ((tgt && dist(d.x, d.y, tgt.x, tgt.y) < 380) || m.ambT > 45) { b.tap(s, 'aim'); m.ambT = 0; m.noAmbush = 8; }
    if (tgt) { const vx = tgt.vehicle ? tgt.vehicle.vx : tgt.vx; m.last = { x: tgt.x, y: tgt.y, vx }; m.lostT = 0; }
    return;
  }
  m.noAmbush = (m.noAmbush || 0) - dt;
  if (tgt) {
    m.smokeAt = null;
    const vx = tgt.vehicle ? tgt.vehicle.vx : tgt.vx;
    m.last = { x: tgt.x, y: tgt.y, vx }; m.lostT = 0;
  } else m.lostT += dt;

  let descend = false, gx, gy, attack = false, boost = false, weave = 0, aim = null;
  if (tgt) {
    const r = humanRect(tgt);
    const tx = tgt.x + m.last.vx * L.lead, ty = r.y + r.h * 0.5;
    aim = { x: tx, y: ty };
    const dd = dist(d.x, d.y, tx, ty);
    const armed = !!tgt.weapon || (tgt.vehicle && tgt.vehicle.hasMG && tgt.vehicle.gunner && tgt.vehicle.mgAmmo > 0);
    const H = 170, tf = Math.sqrt((2 * H) / 900);
    const dirT = Math.sign(m.last.vx) || 1;
    if (tgt.vehicle && !tgt.vehicle.immob && dropCount(d, 'mine') > 0 && dd > 90 && Math.abs(tgt.vehicle.vx) > 60) {
      // техніка в русі — міна на шляху
      const px = tgt.x + m.last.vx * (tf + 0.25) + dirT * 60;
      gx = px - d.vx * 0.8 * tf; gy = ty - H;
      if (Math.abs(d.x + d.vx * 0.8 * tf - px) < 30 && d.y < ty - 90 && lineOfSight(W, d.x, d.y, px, ty)) wantDrop(b, s, d, 'mine');
    } else if ((dropCount(d, 'frag') > 0 || dropCount(d, 'mine') > 0) && !(tgt.vehicle && VEH[tgt.vehicle.type].hp > 1) && dd > 90) {
      const type = dropCount(d, 'frag') > 0 ? 'frag' : 'mine';
      // бомбометання: зависнути над ціллю з упередженням і скинути гранату
      const px = tgt.x + m.last.vx * tf + (type === 'mine' ? dirT * 50 : 0);
      gx = px - d.vx * 0.8 * tf; gy = ty - H;
      const land = d.x + d.vx * 0.8 * tf;
      if (Math.abs(land - px) < 24 && d.y < ty - 90 && lineOfSight(W, d.x, d.y, px, ty)) wantDrop(b, s, d, type);
      if (armed && dd < 750) weave = L.react * 0.6;
    } else if (dd < (armed ? 170 : 260)) {
      // фінальне пікірування
      attack = true; gx = tx + m.last.vx * L.lead * 0.4; gy = ty; boost = true;
    } else {
      const side = Math.sign(d.x - tx) || -1; // заходимо з того боку, де вже є
      gx = tx + side * 110;
      gy = Math.min(gAt(W, tx), ty) - 200;
      boost = dd > 300;
      if (armed && dd < 750) weave = L.react; // ухиляння впоперек лінії вогню
    }
    // підрив поруч, якщо ціль лежить або ховається за бруствером
    if (dd < 26 || (attack && dd < 46 && lineOfSight(W, d.x, d.y, tx, ty))) b.tap(s, 'fire');
  } else if (m.last && m.lostT > 1.2 && m.lostT < 16 && dropCount(d, 'smoke') > 0 && (m.smokeAt = m.smokeAt || nearestHideTo(m.last.x, m.last.y, d))) {
    // людина зникла біля схованки — викурити димом
    const e = m.smokeAt, tf = Math.sqrt((2 * 160) / 900);
    gx = e.x - d.vx * 0.8 * tf; gy = e.y - 160;
    if (Math.abs(d.x + d.vx * 0.8 * tf - e.x) < 22 && Math.abs(d.y - gy) < 60) wantDrop(b, s, d, 'smoke');
  } else if (m.last && m.lostT > 3 && m.lostT < 30 && d.battery < DRONE_BATTERY * 0.55 && m.noAmbush <= 0) {
    // АКБ сідає — сісти «ждуном» попереду, куди бігла людина
    if (m.ambX == null || m.ambX < m.last.x) m.ambX = m.last.x + 450;
    gx = m.ambX; gy = gAt(W, gx) - 30; descend = Math.abs(d.x - gx) < 120;
    if (Math.abs(d.x - gx) < 70 && !d.landing && landSurface(d.x, d.y) - d.y < 85) b.tap(s, 'aim');
    if (d.landing) return;
  } else if (m.last && m.lostT < 14) {
    // шукати там, куди людина рухалась, а згодом — кружляти довкола
    const ahead = clamp(m.last.vx, -60, 320) * Math.min(m.lostT, 4) * 0.6;
    gx = m.last.x + ahead + (m.lostT > 4 ? Math.sin(G.time * 0.7 + m.zig) * 220 : 0);
    gy = gAt(W, gx) - 220;
    boost = Math.abs(gx - d.x) > 350;
  } else {
    // патрулювання: люди біжать праворуч, тож прочісуємо мапу
    if (d.x > W.width - 700) m.patrol = -1;
    if (d.x < 500) m.patrol = 1;
    gx = d.x + m.patrol * 500; gy = gAt(W, d.x) - 260;
    boost = d.battery > 30;
  }
  if (!attack && !descend) {
    // летіти вище за рельєф і всі будівлі на шляху
    const dir = Math.sign(gx - d.x) || 1;
    const ax0 = Math.min(d.x, d.x + dir * 320) - 30, ax1 = Math.max(d.x, d.x + dir * 320) + 30;
    let top = 1e9;
    for (let x = ax0; x <= ax1; x += 32) top = Math.min(top, gAt(W, x));
    for (const so of solidsNear(W, ax0, ax1)) if (so.x < ax1 && so.x + so.w > ax0) top = Math.min(top, so.y);
    const minY = top - 90;
    if (gy > minY) gy = minY;
    // якщо попереду стіна — спершу набрати висоту, потім летіти вбік
    if (d.y > minY + 20 && !lineOfSight(W, d.x, d.y, d.x + dir * 120, d.y)) gx = d.x;
  } else if (!lineOfSight(W, d.x, d.y, gx, gy) && dist(d.x, d.y, gx, gy) > 60) {
    // ціль за перешкодою (наприклад, у будинку) — заходимо згори
    gy = Math.min(gy, d.y) - 60;
  }
  gy = Math.max(CEIL + 20, gy);
  const max = (boost ? 720 : 460) * L.speed;
  let vx = (gx - d.x) * 2.4, vy = (gy - d.y) * 2.4;
  const l = Math.hypot(vx, vy);
  // в атаці — пікірування на повній швидкості, інакше плавне наближення
  if (l > max || (attack && l > 0)) { vx *= max / l; vy *= max / l; }
  if (weave && aim) {
    const lx = aim.x - d.x, ly = aim.y - d.y, ll = Math.hypot(lx, ly) || 1;
    const w = Math.sign(Math.sin(G.time * 4.5 + m.zig)) * 420 * weave;
    vx += (-ly / ll) * w; vy += (lx / ll) * w;
  }
  if (!attack) {
    // запобіжник: якщо за 0.3 с врізаємось у землю чи стіну — різко вгору
    const px = d.x + vx * 0.3, py = d.y + vy * 0.3;
    if (pointSolid(W, px, py + DRONE_R, solidsNear(W, px - 12, px + 12)) || !lineOfSight(W, d.x, d.y, px, py + DRONE_R)) {
      vx = d.vx * 0.3; vy = -max;
    }
  }
  let ax = (vx - d.vx) / 260, ay = (vy - d.vy) / 260;
  const al = Math.hypot(ax, ay);
  if (al > 1) { ax /= al; ay /= al; }
  s.ax = ax; s.ay = ay; s.sprint = boost;
  m.attack = attack;
}
