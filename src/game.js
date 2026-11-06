'use strict';
// ===== Ігрова логіка =====
const GRAV = 1500;
const RUN = 165, SPRINT = 295, CROUCH_SPD = 95, CRAWL = 55, JUMP = 520;
const DRONE_R = 9, DRONE_BATTERY = 75, DRONE_RESPAWN = 2, LAUNCH_DELAY = 6;
const ALIOSHA_NEED = 6, ALIOSHA_TIME = 10; // «Альоша»: після 5+ збитих/пережитих дронів, триває 10 с
const DROP_TYPES = ['frag', 'smoke', 'mine'];
const DROP_NAMES = { frag: 'Граната', smoke: 'Дим', mine: 'Міна' };
const DEFAULT_LOADOUT = ['frag', 'frag', 'smoke', 'mine'];
const BOT_LOADOUTS = [['frag', 'frag', 'smoke', 'mine'], ['frag', 'frag', 'frag', 'mine'], ['frag', 'mine', 'mine', 'smoke'], ['frag', 'frag', 'smoke', 'smoke']];
const OPEN_TIME = 3;          // секунд на відкритій місцевості до появи стрілки
const HUMAN_DIM = { stand: { w: 18, h: 56 }, crouch: { w: 20, h: 38 }, prone: { w: 46, h: 16 } };
const STANCE_DMG = { stand: 1, crouch: 0.75, prone: 0.5 };
const WEAPONS = {
  rifle: { name: 'Автомат', ammo: 30, rate: 0.11, speed: 1500, range: 650, spread: 0.022, pellets: 1 },
  shotgun: { name: 'Дробовик', ammo: 8, rate: 0.75, speed: 1200, range: 380, spread: 0.11, pellets: 7 },
  mg: { name: 'Кулемет', ammo: 80, rate: 0.085, speed: 1600, range: 800, spread: 0.03, pellets: 1 },
};
const PICKUP_NAMES = { rifle: 'Автомат', shotgun: 'Дробовик', reb: 'РЕБ (одноразовий)', medkit: 'Аптечка', fuel: 'Каністра з пальним', armor: 'Бронежилет' };
const PLAYER_COLORS = ['#f2c94c', '#56ccf2', '#eb5757', '#6fcf97'];

let G = null;

function newGame(slots, loc, opts) {
  opts = opts || {};
  const W = makeWorld(loc, (Math.random() * 1e9) | 0, opts.len);
  G = { W, opts, players: [], humans: [], dps: [], drones: [], bullets: [], bombs: [], mines: [], smokes: [], parts: [], rebs: [], feed: [], time: 0, over: null, overReason: '', overT: 0, stats: { dronesUsed: 0, shotDown: 0 } };
  const nHum = slots.filter((s) => s.role === 'human').length;
  const nDr = slots.filter((s) => s.role === 'drone').length;
  const perDrone = Math.ceil((4 + 3 * nHum) / nDr);
  let hi = 0;
  slots.forEach((s, i) => {
    const p = { name: s.name, color: s.color, role: s.role, bot: !!s.bot, cam: { x: 0, y: 0, wide: false }, idx: i };
    p.ctrl = s.bot ? new BotController(p, s.level) : CONTROLLERS[s.scheme];
    if (s.role === 'human') {
      const h = makeHuman(p, W.start.x + hi * 40); hi++;
      G.humans.push(h); p.ent = h;
      p.cam.x = h.x; p.cam.y = h.y - 100;
    } else {
      const dp = { player: p, left: perDrone, total: perDrone, drone: null, timer: LAUNCH_DELAY, pad: 0, sel: 0,
        loadout: (s.bot ? pick(BOT_LOADOUTS) : s.loadout || DEFAULT_LOADOUT).slice() };
      G.dps.push(dp); p.ent = dp;
      p.cam.x = W.pads[0].x + 120; p.cam.y = W.pads[0].y - 150;
    }
    G.players.push(p);
  });
}

function makeHuman(p, x) {
  return {
    player: p, x, y: gAt(G.W, x), vx: 0, vy: 0, stance: 'stand', facing: 1, onGround: true, onThin: false, wasGround: true,
    hp: 100, stamina: 1, staminaDelay: 0, exhausted: false, climb: null, onLadder: false, dropT: 0,
    vehicle: null, seat: null, hidden: null, pipeT: 0, weapon: null, reb: 1, fireCd: 0,
    openTime: 0, reveal: 0, hurtT: 0, dead: false, saved: false, anim: 0,
    aimA: -0.5, aiming: false, diving: false, diveCd: 0, canister: false, smokeT: 0, gasT: 0, gasWarned: false,
    armor: 0, beaten: 0, alCharges: 0, alT: 0, alGranted: false, hideAnim: null,
  };
}
function feed(text, color) { G.feed.push({ text, color: color || '#fff', t: 4 }); if (G.feed.length > 5) G.feed.shift(); }

function humanRect(h) {
  if (h.vehicle) { const T = VEH[h.vehicle.type]; return { x: h.vehicle.x - T.len / 2, y: h.vehicle.y - T.h - 20, w: T.len, h: T.h + 20 }; }
  const d = HUMAN_DIM[h.stance];
  return { x: h.x - d.w / 2, y: h.y - d.h, w: d.w, h: d.h };
}
function vehRect(v) { const T = VEH[v.type]; return { x: v.x - T.len / 2, y: v.y - T.h, w: T.len, h: T.h }; }

function freeAt(x, y, dim) {
  const r = { x: x - dim.w / 2 + 1, y: y - dim.h + 1, w: dim.w - 2, h: dim.h - 2 };
  for (const s of solidsNear(G.W, r.x, r.x + r.w)) {
    if (s.thin) continue;
    if (r.x < s.x + s.w && r.x + r.w > s.x && r.y < s.y + s.h && r.y + r.h > s.y) return false;
  }
  return true;
}
function tryStance(h, st) {
  if (freeAt(h.x, h.y, HUMAN_DIM[st])) { h.stance = st; return true; }
  return false;
}
function ladderAt(h) {
  for (const l of G.W.ladders) if (Math.abs(h.x - l.x) < 16 && h.y >= l.top - 3 && h.y <= l.bottom + 3) return l;
  return null;
}
function tryMantle(h) {
  const f = h.facing, d = HUMAN_DIM[h.stance];
  const front = h.x + f * (d.w / 2);
  for (const s of solidsNear(G.W, h.x - 60, h.x + 60)) {
    if (s.thin) continue;
    const edge = f > 0 ? s.x : s.x + s.w;
    if (Math.abs(edge - front) > 14) continue;
    if (s.y >= h.y - 8 || s.y < h.y - 125) continue;
    if (h.y - d.h > s.y + s.h) continue; // перешкода не перед тілом
    const tx = f > 0 ? s.x + 12 : s.x + s.w - 12;
    if (!freeAt(tx, s.y, HUMAN_DIM.crouch)) continue;
    h.climb = { t: 0, dur: 0.25 + (h.y - s.y) / 380, sx: h.x, sy: h.y, tx, ty: s.y };
    h.vx = 0; h.vy = 0;
    return true;
  }
  return false;
}

// що маскує людину: 'smoke', тип укриття (trees/bush/trench/ruin) або null
function concealedBy(h) {
  if (h.reveal > 0) return null;
  const W = G.W;
  if (inSmoke(h.x, h.y - 20)) return 'smoke';
  if (h.vehicle) {
    const r = vehRect(h.vehicle);
    return W.covers.some((c) => c.type === 'trees' && r.x + r.w / 2 > c.x && r.x + r.w / 2 < c.x + c.w) ? 'trees' : null;
  }
  const r = humanRect(h), cx = h.x;
  for (const c of W.covers) {
    if (cx < c.x || cx > c.x + c.w) continue;
    if (r.y >= c.y && r.y + r.h <= c.y + c.h + 8) return c.type;
  }
  return null;
}
function humanConcealed(h) { return !!concealedBy(h); }
function droneConcealed(d) {
  if (inSmoke(d.x, d.y)) return true;
  for (const c of G.W.covers) {
    if ((c.type === 'trees' || c.type === 'ruin') && d.x > c.x && d.x < c.x + c.w && d.y > c.y && d.y < c.y + c.h) return true;
  }
  return false;
}
// чи бачить гравець-дрон цю людину
function humanVisibleToDrone(h, drone) {
  if (h.dead) return true;
  if (h.saved || h.hidden) return false;
  const by = concealedBy(h);
  if (!by) return true;
  if (!drone) return false;
  const dd = dist(drone.x, drone.y, h.x, h.y - 20);
  if (dd < 90) return true;
  // у руїнах: дрон бачить людину, якщо зазирнув у вікно, двері чи пролом (пряма видимість)
  if (by === 'ruin' && dd < 280 && lineOfSight(G.W, drone.x, drone.y, h.x, h.y - HUMAN_DIM[h.stance].h * 0.6)) return true;
  return false;
}
function droneVisibleToHuman(d, h) {
  if (!droneConcealed(d)) return true;
  return h && dist(d.x, d.y, h.x, h.y - 20) < 120;
}

// ---------- Людина ----------
function updateHuman(h, dt) {
  const c = h.player.ctrl, W = G.W;
  h.fireCd -= dt; h.reveal -= dt; h.hurtT -= dt;
  if (h.hideAnim && (h.hideAnim.t += dt) >= h.hideAnim.dur) h.hideAnim = null;
  if (h.alT > 0 && (h.alT -= dt) <= 0) { h.alT = 0; feed(h.player.name + ': «Альоша» закінчився', '#f2c94c'); }
  if (h.dead || h.saved) return;
  if (h.vehicle) { humanInVehicle(h, c, dt); return; }
  if (h.hidden) { humanHidden(h, c, dt); return; }
  if (h.climb) {
    const k = clamp((h.climb.t += dt) / h.climb.dur, 0, 1);
    h.y = lerp(h.climb.sy, h.climb.ty, Math.min(1, k * 1.6));
    h.x = lerp(h.climb.sx, h.climb.tx, Math.max(0, (k - 0.4) / 0.6));
    if (k >= 1) { h.climb = null; h.onGround = true; h.vy = 0; if (!tryStance(h, 'stand')) h.stance = 'crouch'; }
    return;
  }
  const ax = c.axisX;
  const lad = ladderAt(h);
  if (h.onLadder && !lad) h.onLadder = false;
  h.diveCd -= dt;

  // кидок на землю — триває до приземлення
  if (h.diving) {
    moveHuman(h, dt);
    if (h.onGround) { h.diving = false; h.vx *= 0.35; }
    checkShelter(h);
    return;
  }

  // режим прицілювання: людина стоїть, стрілки змінюють кут
  h.aiming = c.held('aim') && h.onGround && !h.onLadder;
  if (h.aiming) {
    if (c.cur.aimAngle !== undefined) setAimWorld(h, c.cur.aimAngle);
    else {
      if (c.pressed('left')) h.facing = -1;
      if (c.pressed('right')) h.facing = 1;
      const v = (c.held('down') ? 1 : 0) - (c.held('up') ? 1 : 0);
      h.aimA = clamp(h.aimA + v * 1.5 * dt, -1.45, 0.5);
    }
    h.vx = approach(h.vx, 0, 2200 * dt);
    moveHuman(h, dt);
  } else {
    if (c.pressed('up') && !h.onLadder) {
      if (lad && h.stance !== 'prone' && h.y > lad.top + 4) { h.onLadder = true; h.stance = 'stand'; h.x = lad.x; }
      else if (h.stance === 'prone') tryStance(h, 'crouch');
      else if (h.stance === 'crouch') tryStance(h, 'stand');
      else if (h.onGround && !tryMantle(h)) { h.vy = -JUMP; h.onGround = false; }
    }
    if (c.pressed('down') && !h.onLadder) {
      if (lad && h.onGround && h.stance === 'stand' && Math.abs(h.y - lad.top) < 5) { h.onLadder = true; h.x = lad.x; h.y += 6; }
      else if (h.stance === 'stand' && h.onGround && Math.abs(h.vx) > 140 && h.diveCd <= 0 && freeAt(h.x + h.facing * 20, h.y, HUMAN_DIM.prone)) {
        // різкий кидок на землю вперед
        h.stance = 'prone'; h.diving = true; h.diveCd = 1.2;
        h.vx = h.facing * 430; h.vy = -170; h.onGround = false;
        h.stamina = Math.max(0, h.stamina - 0.15);
        G.parts.push({ type: 'dust', x: h.x, y: h.y - 4, vx: -h.facing * 30, vy: -20, life: 0.6, max: 0.6, size: 8 });
      }
      else if (h.stance === 'stand') tryStance(h, 'crouch');
      else if (h.stance === 'crouch') tryStance(h, 'prone');
      else if (h.onThin) h.dropT = 0.25;
    }

    if (h.onLadder) {
      const v = (c.held('down') ? 1 : 0) - (c.held('up') ? 1 : 0);
      h.vx = 0; h.vy = v * 150; h.y += h.vy * dt; h.x = lad.x; h.anim += Math.abs(v) * dt * 8;
      if (h.y <= lad.top) { h.y = lad.top; h.onLadder = false; h.vy = 0; h.onGround = true; }
      else if (h.y >= lad.bottom && v > 0) { h.y = lad.bottom; h.onLadder = false; }
      if (ax !== 0 && v === 0) { h.onLadder = false; h.facing = ax; h.vx = ax * 80; }
    } else {
      let speed = h.stance === 'stand' ? RUN : h.stance === 'crouch' ? CROUCH_SPD : CRAWL;
      const wantSprint = c.held('sprint') && h.stance === 'stand' && ax !== 0;
      if (wantSprint && h.stamina > 0 && !h.exhausted) {
        speed = SPRINT; h.stamina -= dt / 3; h.staminaDelay = 0.9;
        if (h.stamina <= 0) { h.stamina = 0; h.exhausted = true; }
      } else {
        h.staminaDelay -= dt;
        if (h.staminaDelay <= 0) h.stamina = Math.min(1, h.stamina + dt / 5);
        if (h.stamina > 0.35) h.exhausted = false;
      }
      if (h.hp < 35) speed *= 0.8;
      h.vx = approach(h.vx, ax * speed, (h.onGround ? 2200 : 900) * dt);
      if (ax) h.facing = ax;
      h.anim += Math.abs(h.vx) * dt * 0.06;
      moveHuman(h, dt);
    }
  }

  if (c.pressed('interact')) {
    const v = nearVehicle(h);
    if (v) enterVehicle(h, v);
    else {
      const pk = nearPickup(h);
      if (pk) takePickup(h, pk);
      else { const sp = nearHide(h); if (sp) enterHide(h, sp); }
    }
  }
  // «Альоша»: автонаведення на дрони, стріляти можна й на бігу
  if (h.alT > 0) { if (c.held('fire') && h.fireCd <= 0) alioshaShot(h); }
  // стріляти можна лише з позиції (режим прицілювання)
  else if (h.aiming && c.held('fire') && h.weapon && h.fireCd <= 0) {
    const m = muzzle(h);
    fireWeapon(h, m.x, m.y, h.weapon.type, aimWorld(h), false, h.stance);
    h.fireCd = WEAPONS[h.weapon.type].rate;
    if (--h.weapon.ammo <= 0) {
      G.parts.push({ type: 'gun', x: h.x, y: h.y - 30, vx: -h.facing * 120, vy: -260, life: 1.2, max: 1.2, rot: 0 });
      feed(h.player.name + ': ' + WEAPONS[h.weapon.type].name + ' — набої скінчилися', '#ccc');
      h.weapon = null;
    }
  }
  if (c.pressed('special')) {
    if (c.held('aim') && h.alCharges > 0 && h.alT <= 0) activateAliosha(h);
    else activateReb(h);
  }
  checkShelter(h);
}

// ---------- Бонус «Альоша» ----------
function beat(h) {
  if (!h || h.dead || h.saved) return;
  h.beaten++;
  if (h.beaten >= ALIOSHA_NEED && !h.alGranted) {
    h.alGranted = true; h.alCharges++;
    feed(h.player.name + ': бонус «Альоша» готовий! (позиція + спец)', '#f2c94c');
  }
}
function activateAliosha(h) {
  h.alCharges--; h.alT = ALIOSHA_TIME;
  if (!h.weapon) h.weapon = { type: 'rifle', ammo: WEAPONS.rifle.ammo };
  feed(h.player.name + ' — «АЛЬОША»!', '#f2c94c');
  [392, 523, 659].forEach((f, i) => setTimeout(() => Sfx.tone(f, 0.18, 0.2, 'sawtooth'), i * 90));
}
// постріл з автонаведенням: найближчий дрон у прямій видимості гарантовано збито
function alioshaShot(h) {
  const ox = h.x, oy = h.y - HUMAN_DIM[h.stance].h * 0.68;
  let tgt = null, bd = 950;
  for (const d of G.drones) {
    const dd = dist(ox, oy, d.x, d.y);
    if (dd < bd && lineOfSight(G.W, ox, oy, d.x, d.y)) { bd = dd; tgt = d; }
  }
  h.fireCd = 0.15;
  if (!tgt) return;
  setAimWorld(h, Math.atan2(tgt.y - oy, tgt.x - ox));
  G.parts.push({ type: 'tracer', x: ox, y: oy, x2: tgt.x, y2: tgt.y, life: 0.12, max: 0.12 });
  G.parts.push({ type: 'flash', x: ox + Math.cos(aimWorld(h)) * 16, y: oy + Math.sin(aimWorld(h)) * 16, life: 0.05, max: 0.05, size: 10 });
  Sfx.shot(); h.reveal = 1.5;
  shootDownDrone(tgt, h);
}

// кут прицілу: h.aimA відносно напрямку погляду (від'ємний — угору)
function aimWorld(h) { return h.facing > 0 ? h.aimA : Math.PI - h.aimA; }
function setAimWorld(h, a) {
  const cx = Math.cos(a), sy = Math.sin(a);
  h.facing = cx >= 0 ? 1 : -1;
  h.aimA = clamp(Math.atan2(sy, Math.abs(cx)), -1.45, 0.5);
}
function muzzle(h) {
  const d = HUMAN_DIM[h.stance];
  const y = h.stance === 'prone' ? h.y - 8 : h.y - d.h * 0.68;
  const a = aimWorld(h);
  return { x: h.x + Math.cos(a) * 16, y: y + Math.sin(a) * 16 };
}

function moveHuman(h, dt) {
  const W = G.W, d = HUMAN_DIM[h.stance], hw = d.w / 2;
  h.x = clamp(h.x + h.vx * dt, 10, W.width - 10);
  for (const s of solidsNear(W, h.x - 60, h.x + 60)) {
    if (s.thin) continue;
    if (h.y > s.y + 0.5 && h.y - d.h < s.y + s.h && h.x + hw > s.x && h.x - hw < s.x + s.w) {
      if (h.onGround && h.y - s.y <= 15 && freeAt(h.x, s.y, d)) { h.y = s.y; continue; }
      if (h.x < s.x + s.w / 2) h.x = s.x - hw; else h.x = s.x + s.w + hw;
      h.vx = 0;
    }
  }
  const prevY = h.y;
  h.wasGround = h.onGround;
  h.vy = Math.min(1400, h.vy + GRAV * dt);
  h.y += h.vy * dt;
  h.onGround = false; h.onThin = false;
  const gy = gAt(W, h.x);
  if (h.y >= gy || (h.wasGround && h.vy >= 0 && gy - h.y < 12 && prevY >= gy - 12)) {
    if (h.vy > 950) hurt(h, (h.vy - 950) * 0.08, 'fall');
    h.y = gy; h.vy = 0; h.onGround = true;
  }
  for (const s of solidsNear(W, h.x - 30, h.x + 30)) {
    if (h.x + hw <= s.x || h.x - hw >= s.x + s.w) continue;
    if (h.vy >= 0 && prevY <= s.y + 1 && h.y >= s.y) {
      if (s.thin && h.dropT > 0) continue;
      if (h.vy > 950) hurt(h, (h.vy - 950) * 0.08, 'fall');
      h.y = s.y; h.vy = 0; h.onGround = true; h.onThin = !!s.thin;
    } else if (!s.thin && h.vy < 0 && h.y - d.h < s.y + s.h && prevY - d.h >= s.y + s.h - 2) {
      h.y = s.y + s.h + d.h; h.vy = 0;
    }
  }
  h.dropT -= dt;
}

function nearVehicle(h) {
  if (h.stance === 'prone') return null;
  for (const v of G.W.vehicles) {
    if (v.dead) continue;
    const T = VEH[v.type];
    if (Math.abs(h.x - v.x) < T.len / 2 + 12 && Math.abs(h.y - v.y) < 40) {
      if (!v.driver || (v.hasMG && !v.gunner && T.seats > 1)) return v;
    }
  }
  return null;
}
function nearPickup(h) {
  for (const p of G.W.pickups) if (!p.taken && Math.abs(p.x - h.x) < 30 && Math.abs(p.y - h.y) < 40) return p;
  return null;
}
function nearHide(h) {
  for (const sp of G.W.hides) {
    if (sp.ruined) continue;
    if (sp.type === 'pipe') {
      if (Math.abs(h.x - sp.x1) < 28 && Math.abs(h.y - sp.y1) < 40) return sp;
      if (Math.abs(h.x - sp.x2) < 28 && Math.abs(h.y - sp.y2) < 40) return sp;
    } else if (Math.abs(h.x - sp.x) < 28 && Math.abs(h.y - sp.y) < 40) return sp;
  }
  return null;
}
function takePickup(h, p) {
  p.taken = true;
  if (p.type === 'reb') h.reb++;
  else if (p.type === 'medkit') h.hp = Math.min(100, h.hp + 45);
  else if (p.type === 'fuel') h.canister = true;
  else if (p.type === 'armor') h.armor = 100;
  else h.weapon = { type: p.type, ammo: WEAPONS[p.type].ammo };
  Sfx.click();
}
function enterHide(h, sp) {
  h.hidden = sp; h.vx = 0; h.vy = 0; h.onLadder = false;
  if (sp.type === 'pipe') h.pipeT = Math.abs(h.x - sp.x1) < Math.abs(h.x - sp.x2) ? 0 : 1;
  else h.hideAnim = { dir: 'in', t: 0, dur: 0.5, sp, fx: h.x, facing: h.facing };
  h.smokeT = 0;
  if (sp.bonus === 'aliosha') {
    sp.bonus = null; h.alCharges++;
    feed(h.player.name + ' знайшов захований бонус «Альоша»!', '#f2c94c');
  }
  Sfx.click();
}
function pipeY(sp, t) { return lerp(sp.y1, sp.y2, t) + sp.depthOff + 14; }
function hideEntrance(h) {
  const sp = h.hidden;
  if (sp.type !== 'pipe') return { x: sp.x, y: sp.y };
  return h.pipeT < 0.5 ? { x: sp.x1, y: sp.y1 } : { x: sp.x2, y: sp.y2 };
}
function humanHidden(h, c, dt) {
  const sp = h.hidden;
  if (sp.type === 'pipe') {
    const ax = c.axisX;
    h.pipeT = clamp(h.pipeT + (ax * 75 * dt) / sp.len, 0, 1);
    h.x = lerp(sp.x1, sp.x2, h.pipeT); h.y = pipeY(sp, h.pipeT);
    if (ax) h.facing = ax;
    h.anim += Math.abs(ax) * dt * 5;
  } else { h.x = sp.x; h.y = sp.y; }
  if (c.pressed('interact') || (sp.type !== 'pipe' && c.pressed('up'))) {
    if (sp.type === 'pipe') {
      if (h.pipeT < 0.12) { h.x = sp.x1; h.y = sp.y1; }
      else if (h.pipeT > 0.88) { h.x = sp.x2; h.y = sp.y2; }
      else return;
    }
    if (sp.type !== 'pipe') h.hideAnim = { dir: 'out', t: 0, dur: 0.35, sp, facing: h.facing };
    h.hidden = null; h.stance = 'crouch'; h.vy = 0; h.vx = 0;
    Sfx.click();
  }
  if (c.pressed('special')) activateReb(h);
}

function enterVehicle(h, v) {
  if (!v.driver) { v.driver = h; h.seat = 'driver'; }
  else { v.gunner = h; h.seat = 'gunner'; }
  h.vehicle = v; h.stance = 'stand'; h.onLadder = false; h.aiming = false;
  // каністра — заправити техніку
  const tank = VEH[v.type].tank;
  if (h.canister && v.fuel < tank * 0.95) {
    v.fuel = Math.min(tank, v.fuel + tank * 0.6); h.canister = false;
    feed(h.player.name + ' заправив ' + VEH[v.type].name, '#f2c94c');
  }
  Sfx.click();
}
function exitVehicle(h, fling) {
  const v = h.vehicle;
  if (!v) return;
  if (v.driver === h) v.driver = null;
  if (v.gunner === h) v.gunner = null;
  h.vehicle = null; h.seat = null; h.aiming = false; h.aimA = -0.5;
  h.x = clamp(v.x + (h === v.gunner ? -20 : 0) - v.dir * (VEH[v.type].len / 2 + 14), 10, G.W.width - 10);
  if (!freeAt(h.x, v.y, HUMAN_DIM.stand)) h.x = v.x;
  h.y = v.y - 2; h.vx = fling ? rand(-150, 150) : 0; h.vy = fling ? -320 : 0; h.stance = 'stand';
}
function humanInVehicle(h, c, dt) {
  const v = h.vehicle;
  if (c.pressed('interact')) { exitVehicle(h); return; }
  const T = VEH[v.type];
  if (h.seat === 'driver') { v.input = c.axisX; h.facing = v.dir; }
  else {
    // кулеметник: ←/→ — бік, ↑/↓ — кут
    if (c.cur.aimAngle !== undefined) setAimWorld(h, c.cur.aimAngle);
    else {
      if (c.pressed('left')) h.facing = -1;
      if (c.pressed('right')) h.facing = 1;
      const a = (c.held('down') ? 1 : 0) - (c.held('up') ? 1 : 0);
      h.aimA = clamp(h.aimA + a * 1.5 * dt, -1.45, 0.3);
    }
    h.aiming = true;
    if (c.held('fire') && v.mgAmmo > 0 && h.fireCd <= 0) {
      const mx = v.x - v.dir * T.len * 0.15, my = v.y - T.h - 14;
      fireWeapon(h, mx, my, 'mg', aimWorld(h), Math.abs(v.vx) > 30, 'stand');
      h.fireCd = WEAPONS.mg.rate;
      if (--v.mgAmmo <= 0) feed('Кулемет: набої скінчилися', '#ccc');
    }
  }
  h.x = v.x; h.y = v.y;
  if (c.pressed('special')) activateReb(h);
  checkShelter(h);
}

function checkShelter(h) {
  const S = G.W.shelter;
  if (h.x > S.x - 8 && h.x < S.x + 40 && h.y > S.y - 30) {
    if (h.vehicle) {
      const v = h.vehicle;
      for (const o of [v.driver, v.gunner]) if (o) { o.saved = true; o.vehicle = null; feed(o.player.name + ' в укритті!', '#6fcf97'); }
      v.driver = v.gunner = null; v.vx = 0;
    } else { h.saved = true; feed(h.player.name + ' в укритті!', '#6fcf97'); }
    Sfx.win();
  }
}

function hurt(h, dmg, src) {
  if (h.dead || h.saved || dmg <= 0) return;
  if (h.alT > 0 && (src === 'blast' || src === 'mine' || src === 'head')) return; // «Альоша» не боїться вибухів
  // бронежилет: уламки й вибухова хвиля шкодять набагато менше (крім влучання в голову)
  if (h.armor > 0 && src === 'blast') {
    const ab = dmg * 0.65;
    dmg -= ab; h.armor -= ab * 0.6;
    if (h.armor <= 0) { h.armor = 0; feed(h.player.name + ': бронежилет зруйновано', '#ccc'); }
  }
  h.hp -= dmg; h.hurtT = 0.4;
  if (h.hp <= 0) {
    h.hp = 0; h.dead = true;
    if (h.vehicle) exitVehicle(h, true);
    h.hidden = null; h.stance = 'prone';
    feed(h.player.name + ' загинув', '#eb5757');
  }
}

// ---------- Стрільба ----------
// постріл уздовж кута прицілу (без автоприцілу — влучати треба самому)
function fireWeapon(h, ox, oy, type, base, moving, stance) {
  const Wp = WEAPONS[type];
  const spread = Wp.spread * (moving ? 1.8 : 1) * (stance === 'prone' ? 0.7 : 1);
  for (let i = 0; i < Wp.pellets; i++) {
    const a = base + (RND() * 2 - 1) * spread;
    G.bullets.push({ x: ox, y: oy, vx: Math.cos(a) * Wp.speed, vy: Math.sin(a) * Wp.speed, life: (Wp.range / Wp.speed) * rand(0.9, 1.1), owner: h });
  }
  G.parts.push({ type: 'flash', x: ox, y: oy, life: 0.05, max: 0.05, size: 10 });
  h.reveal = 1.5;
  Sfx.shot();
}

function updateBullets(dt) {
  const W = G.W;
  for (let i = G.bullets.length - 1; i >= 0; i--) {
    const b = G.bullets[i];
    b.life -= dt;
    let hit = b.life <= 0;
    const steps = Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 10);
    const list = solidsNear(W, b.x - 40, b.x + 40);
    for (let s = 0; s < steps && !hit; s++) {
      b.x += (b.vx * dt) / steps; b.y += (b.vy * dt) / steps;
      if (b.x < 0 || b.x > W.width || b.y < -100) { hit = true; break; }
      if (pointSolid(W, b.x, b.y, list)) { hit = true; G.parts.push({ type: 'spark', x: b.x, y: b.y, vx: rand(-60, 60), vy: rand(-120, 0), life: 0.25, max: 0.25 }); break; }
      for (const d of G.drones) {
        if (dist(b.x, b.y, d.x, d.y) < DRONE_R + 3) { hit = true; shootDownDrone(d, b.owner); break; }
      }
    }
    if (hit) G.bullets.splice(i, 1);
  }
}

// ---------- РЕБ ----------
function activateReb(h) {
  if (h.reb <= 0) return;
  h.reb--;
  const x = h.vehicle ? h.vehicle.x : h.x, y = (h.vehicle ? h.vehicle.y : h.y) - 30;
  G.rebs.push({ x, y, r: 380, t: 5, max: 5 });
  feed(h.player.name + ' увімкнув РЕБ', '#bb86fc');
  Sfx.reb();
}
function inReb(x, y) { return G.rebs.some((r) => r.t > 0 && dist(x, y, r.x, r.y) < r.r); }

// ---------- Техніка ----------
function updateVehicles(dt) {
  const W = G.W;
  for (const v of W.vehicles) {
    if (v.dead) {
      v.burn -= dt;
      if (v.burn > 0 && RND() < dt * 12) G.parts.push({ type: 'smoke', x: v.x + rand(-20, 20), y: v.y - 30, vx: rand(-10, 10), vy: rand(-50, -25), life: 2.5, max: 2.5, size: rand(10, 18) });
      continue;
    }
    const T = VEH[v.type];
    const inp = v.driver && v.fuel > 0 && !v.immob ? v.input : 0;
    if (v.immob && RND() < dt * 4) G.parts.push({ type: 'smoke', x: v.x + rand(-20, 20), y: v.y - 10, vx: rand(-10, 10), vy: -30, life: 1.4, max: 1.4, size: 8 });
    if (inp) {
      v.vx = approach(v.vx, inp * T.max, T.acc * dt); v.dir = inp;
      v.fuel -= dt;
      if (v.fuel <= 0) { v.fuel = 0; feed(T.name + ': пальне скінчилося', '#f2994a'); }
    } else v.vx = approach(v.vx, 0, (v.driver ? 300 : 260) * dt);
    const nx = clamp(v.x + v.vx * dt, 30, W.width - 30);
    const ny = gAt(W, nx);
    const r = { x: nx - T.len / 2, y: ny - T.h, w: T.len, h: T.h - 12 };
    let blocked = false;
    for (const s of solidsNear(W, r.x, r.x + r.w)) {
      if (s.thin) continue;
      if (r.x < s.x + s.w && r.x + r.w > s.x && r.y < s.y + s.h && r.y + r.h > s.y) { blocked = true; break; }
    }
    if (blocked) {
      if (Math.abs(v.vx) > 250) { for (const o of [v.driver, v.gunner]) if (o) hurt(o, 8); }
      v.vx = 0;
    } else { v.x = nx; v.y = ny; }
    v.ang = Math.atan2(gAt(W, v.x + T.len / 2) - gAt(W, v.x - T.len / 2), T.len);
    if (v.hp < T.hp && RND() < dt * 8) G.parts.push({ type: 'smoke', x: v.x, y: v.y - T.h, vx: rand(-10, 10), vy: -40, life: 1.6, max: 1.6, size: 10 });
    if (v.driver && Math.abs(v.vx) > 100 && RND() < dt * 20) G.parts.push({ type: 'dust', x: v.x - v.dir * T.len / 2, y: v.y - 4, vx: -v.dir * 40, vy: -20, life: 0.8, max: 0.8, size: 8 });
  }
}
function destroyVehicle(v) {
  v.dead = true; v.burn = 14; v.vx = 0;
  for (const o of [v.driver, v.gunner]) if (o) exitVehicle(o, true);
  feed(VEH[v.type].name + ' знищено', '#f2994a');
}

// ---------- Дрони ----------
// майданчик старту: не ближче 500 px до живих людей (окрім базового №1)
function padOk(i) {
  const p = G.W.pads[i];
  return i === 0 || !G.humans.some((h) => !h.dead && !h.saved && Math.abs(h.x - p.x) < 500);
}
// автовибір: найближчий майданчик позаду найдальшої людини
function autoPad() {
  let front = 0;
  for (const h of G.humans) if (!h.dead && !h.saved) front = Math.max(front, h.x);
  let best = 0;
  G.W.pads.forEach((p, i) => { if (p.x < front - 600 && padOk(i)) best = i; });
  return best;
}
function nextPad(dp) {
  const n = G.W.pads.length;
  for (let k = 1; k <= n; k++) { const i = (dp.pad + k) % n; if (padOk(i)) { dp.pad = i; return; } }
}
function firstDrop(slots) { return slots.find(Boolean) || null; }
function dropCount(d, t) { return d.slots.filter((x) => x === t).length; }
// підготовка до старту: вибір скидів (4 місця) і майданчика
function loadoutInput(dp, c) {
  if (c.isBot) return;
  const d = dp.drone;
  if (c.pressed('left')) dp.sel = (dp.sel + 3) % 4;
  if (c.pressed('right')) dp.sel = (dp.sel + 1) % 4;
  if (c.pressed('down')) {
    const cur = dp.loadout[dp.sel];
    dp.loadout[dp.sel] = DROP_TYPES[(DROP_TYPES.indexOf(cur) + 1) % DROP_TYPES.length];
    Sfx.click();
  }
  if (c.pressed('interact')) {
    nextPad(dp); Sfx.click();
    if (d) { const p = G.W.pads[dp.pad]; d.x = p.x; d.y = p.y - DRONE_R - 2; }
  }
  if (d) { d.slots = dp.loadout.slice(); d.payload = firstDrop(d.slots); }
}
function updateDronePlayer(dp, dt) {
  if (G.over) return;
  const d = dp.drone;
  if ((!d && dp.left > 0) || (d && d.onPad)) loadoutInput(dp, dp.player.ctrl);
  if (d || dp.left <= 0) return;
  dp.timer -= dt;
  if (dp.timer <= 0) {
    if (!padOk(dp.pad)) dp.pad = autoPad();
    const pad = G.W.pads[dp.pad];
    const slots = dp.loadout.slice();
    // новий дрон стоїть на майданчику, АКБ не сідає, поки не злетить
    const nd = { player: dp.player, dp, x: pad.x, y: pad.y - DRONE_R - 2, vx: 0, vy: 0, battery: DRONE_BATTERY, jammed: false, tilt: 0, spin: 0,
      slots, payload: firstDrop(slots), landed: true, onPad: true, landing: false };
    dp.left--; dp.drone = nd; G.drones.push(nd); G.stats.dronesUsed++;
    Sfx.tone(880, 0.1, 0.1);
  }
}
function takeOff(d) {
  d.landed = false; d.onPad = false; d.landing = false; d.vy = -240; d.vx = 0;
  Sfx.tone(520, 0.12, 0.08);
}
// найближча поверхня під точкою (земля, верх об'єкта чи перекриття)
function landSurface(x, y) {
  let sy = gAt(G.W, x);
  for (const s of solidsNear(G.W, x, x)) if (x >= s.x && x <= s.x + s.w && s.y >= y && s.y < sy) sy = s.y;
  return sy;
}

// ---------- Скиди з дрона ----------
const SMOKE_R = 110, SMOKE_TIME = 40;
const SMOKE_SAFE = 20, SMOKE_DMG = 7;            // відкритий дим: через 20 с — отруєння, HP/с
const SMOKE_HIDE_GRACE = 3, SMOKE_HIDE_DMG = 15; // дим у схованці: 3 с, щоб вибратися, далі швидко шкодить
function dropPayload(d) {
  if (!d.slots.includes(d.payload)) d.payload = firstDrop(d.slots);
  if (!d.payload) return;
  const type = d.payload;
  d.slots[d.slots.indexOf(type)] = null;
  G.bombs.push({ type, x: d.x, y: d.y + DRONE_R + 2, vx: d.vx * 0.8, vy: Math.max(0, d.vy * 0.5) + 30, player: d.player });
  Sfx.tone(320, 0.08, 0.1);
  if (!d.slots.includes(type)) d.payload = firstDrop(d.slots);
}
function cyclePayload(d) {
  const i0 = DROP_TYPES.indexOf(d.payload);
  for (let k = 1; k <= DROP_TYPES.length; k++) {
    const t = DROP_TYPES[(i0 + k) % DROP_TYPES.length];
    if (d.slots.includes(t)) { d.payload = t; return; }
  }
}
function updateBombs(dt) {
  const W = G.W;
  for (let i = G.bombs.length - 1; i >= 0; i--) {
    const b = G.bombs[i];
    b.vy += 900 * dt; b.vx *= Math.exp(-0.4 * dt);
    const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 6));
    let hit = false, hitH = null, hitV = null;
    for (let s = 0; s < steps && !hit; s++) {
      b.x += (b.vx * dt) / steps; b.y += (b.vy * dt) / steps;
      if (pointSolid(W, b.x, b.y, solidsNear(W, b.x - 4, b.x + 4))) { hit = true; b.y -= 3; break; }
      for (const h of G.humans) {
        if (h.dead || h.saved || h.hidden) continue;
        if (rectDist(b.x, b.y, humanRect(h)) < 3) { hit = true; hitH = h; break; }
      }
      for (const v of W.vehicles) if (!v.dead && rectDist(b.x, b.y, vehRect(v)) < 2) { hit = true; hitV = v; break; }
    }
    if (b.x < 0 || b.x > W.width) { G.bombs.splice(i, 1); continue; }
    if (!hit) continue;
    G.bombs.splice(i, 1);
    if (b.type === 'frag') explosion(b.x, b.y, 80, 90);
    else if (b.type === 'mine') {
      if (hitH || hitV) mineBlast(b.x, b.y, hitH, hitV);
      else { G.mines.push({ x: b.x, y: b.y + 3, arm: 0.8, seed: Math.random() * 10 }); Sfx.tone(180, 0.06, 0.1); }
    } else {
      G.smokes.push({ x: b.x, y: b.y - 30, t: SMOKE_TIME, max: SMOKE_TIME, r: SMOKE_R, seed: Math.random() * 100 });
      Sfx.noise_(0.6, 0.25, 1200, 'bandpass');
    }
  }
  for (const sm of G.smokes) {
    sm.t -= dt;
    if (RND() < dt * 14) G.parts.push({ type: 'smoke', x: sm.x + rand(-sm.r, sm.r) * 0.7, y: sm.y + rand(-30, 25), vx: rand(-15, 15), vy: rand(-25, -5), life: 3, max: 3, size: rand(16, 28), light: true });
  }
  G.smokes = G.smokes.filter((s) => s.t > 0);
  // дим у схованці: не виганяє, а швидко забирає здоров'я, якщо не вибратися за кілька секунд
  for (const h of G.humans) {
    if (h.dead || h.saved) continue;
    if (h.hidden) {
      const e = hideEntrance(h);
      const smoked = G.smokes.some((s) => dist(s.x, s.y + 30, e.x, e.y) < s.r || dist(s.x, s.y + 30, h.x, h.y) < s.r);
      if (smoked) {
        if (h.smokeT === 0) feed(h.player.name + ': дим у схованці — вилазь!', '#bbb');
        h.smokeT += dt;
        if (h.smokeT > SMOKE_HIDE_GRACE) {
          hurt(h, SMOKE_HIDE_DMG * dt, 'smoke');
          if (RND() < dt * 4) G.parts.push({ type: 'smoke', x: e.x, y: e.y - 10, vx: rand(-10, 10), vy: -25, life: 0.9, max: 0.9, size: 7, light: true });
        }
      } else h.smokeT = Math.max(0, h.smokeT - dt);
      h.gasT = Math.max(0, h.gasT - dt * 2);
      continue;
    }
    h.smokeT = 0;
    // відкритий дим: хто не вибрався за SMOKE_SAFE секунд, втрачає здоров'я
    const inside = inSmoke(h.x, h.y - 20);
    if (inside) h.gasT += dt; else { h.gasT = Math.max(0, h.gasT - dt * 2); if (h.gasT < SMOKE_SAFE) h.gasWarned = false; }
    if (h.gasT > SMOKE_SAFE) {
      if (!h.gasWarned) { h.gasWarned = true; feed(h.player.name + ' задихається в диму', '#bbb'); }
      hurt(h, SMOKE_DMG * dt, 'smoke');
      if (RND() < dt * 3) G.parts.push({ type: 'smoke', x: h.x, y: h.y - 34, vx: rand(-10, 10), vy: -20, life: 0.8, max: 0.8, size: 6, light: true });
    }
  }
}
function inSmoke(x, y) { return G.smokes.some((s) => dist(x, y, s.x, s.y) < s.r * 0.85); }

// ---------- Міни ----------
function updateMines(dt) {
  const W = G.W;
  for (let i = G.mines.length - 1; i >= 0; i--) {
    const m = G.mines[i];
    if (m.arm > 0) { m.arm -= dt; continue; }
    let hh = null, vv = null;
    for (const h of G.humans) {
      if (h.dead || h.saved || h.hidden || h.vehicle || !h.onGround) continue;
      if (Math.abs(h.x - m.x) < HUMAN_DIM[h.stance].w / 2 + 6 && Math.abs(h.y - m.y) < 12) { hh = h; break; }
    }
    if (!hh) for (const v of W.vehicles) {
      if (v.dead) continue;
      if (Math.abs(v.x - m.x) < VEH[v.type].len / 2 && Math.abs(v.y - m.y) < 18) { vv = v; break; }
    }
    if (hh || vv) { G.mines.splice(i, 1); mineBlast(m.x, m.y, hh, vv); }
  }
}
// міна: людині без броні — мінус 50% здоров'я, техніці — знищена ходова
function mineBlast(x, y, h, v) {
  explosionFx(x, y - 4, 45, 40);
  Sfx.boom(false);
  if (h && h.alT <= 0) {
    const armored = h.armor > 0;
    if (armored) h.armor = Math.max(0, h.armor - 40);
    hurt(h, armored ? 15 : 50, 'mine');
    h.vy = -220; h.onGround = false;
    feed(h.player.name + ' підірвався на міні' + (armored ? ' (броня врятувала)' : ''), '#f2994a');
  }
  if (v) {
    v.immob = true; v.vx = 0;
    for (const o of [v.driver, v.gunner]) if (o) hurt(o, 6, 'mine');
    feed(VEH[v.type].name + ' підірвався на міні — ходова знищена', '#f2994a');
  }
}

function removeDrone(d) {
  const i = G.drones.indexOf(d);
  if (i >= 0) G.drones.splice(i, 1);
  d.dp.drone = null; d.dp.timer = DRONE_RESPAWN; d.dp.pad = autoPad();
}
// direct — людина, в яку дрон врізався; head — влучання в голову
function explodeDrone(d, direct, head) {
  removeDrone(d);
  explosion(d.x, d.y, 130, 120, direct ? { h: direct, head } : null);
  // хто пережив вибух поруч — зараховується для «Альоші»
  for (const h of G.humans) if (!h.dead && !h.saved && dist(h.x, h.y - 25, d.x, d.y) < 220) beat(h);
}
function shootDownDrone(d, by) {
  removeDrone(d);
  G.stats.shotDown++;
  feed('Дрон збито! (' + d.player.name + ')', '#56ccf2');
  explosion(d.x, d.y, 30, 55);
  if (by) beat(by);
}
function isHeadHit(d, h) {
  const r = humanRect(h);
  const px = clamp(d.x, r.x, r.x + r.w), py = clamp(d.y, r.y, r.y + r.h);
  if (h.stance === 'prone') return Math.abs(px - (h.facing > 0 ? r.x + r.w : r.x)) < 13;
  return py < r.y + 15;
}
function updateDrone(d, dt) {
  const W = G.W, c = d.player.ctrl;
  // на землі («ждун»): АКБ не сідає, гвинти стоять
  if (d.landed) {
    d.tilt = lerp(d.tilt, 0, Math.min(1, dt * 8));
    if (d.onPad) { if (c.pressed('up')) takeOff(d); return; }
    if (c.pressed('fire')) { explodeDrone(d); return; }
    if (c.pressed('aim') || c.pressed('up')) { takeOff(d); return; }
    if (landSurface(d.x, d.y) > d.y + DRONE_R + 3) d.landed = false; // опора зникла
    else return;
  }
  const boost = c.held('sprint');
  d.battery -= dt * (boost ? 1.8 : 1);
  d.jammed = inReb(d.x, d.y) || d.battery <= 0;
  if (!d.jammed) {
    let ix = c.cur.ax, iy = c.cur.ay;
    const l = Math.hypot(ix, iy);
    if (l > 1) { ix /= l; iy /= l; }
    if (c.pressed('aim')) {
      // біля землі — посадка, високо — ширший огляд
      if (landSurface(d.x, d.y) - d.y < 90) d.landing = !d.landing;
      else d.player.cam.wide = !d.player.cam.wide;
    }
    if (d.landing && (c.held('up') || boost)) d.landing = false;
    const acc = boost ? 2100 : 1500, max = boost ? 720 : 460;
    if (d.landing) {
      d.vx *= Math.exp(-5 * dt); d.vy = approach(d.vy, 90, 700 * dt);
    } else {
      d.vx += ix * acc * dt; d.vy += iy * acc * dt;
      const drag = Math.exp(-2.3 * dt);
      d.vx *= drag; d.vy *= drag;
    }
    const sp = Math.hypot(d.vx, d.vy);
    if (sp > max) { d.vx *= max / sp; d.vy *= max / sp; }
    if (c.pressed('fire')) { explodeDrone(d); return; }
    if (c.pressed('interact')) cyclePayload(d);
    if (c.pressed('special')) dropPayload(d);
  } else {
    d.landing = false;
    d.vy += 260 * dt; d.vx *= Math.exp(-0.8 * dt);
    d.vx += rand(-200, 200) * dt;
  }
  d.tilt = lerp(d.tilt, clamp(d.vx / 900, -0.5, 0.5), dt * 8);
  d.spin += dt * 60;
  d.x += d.vx * dt; d.y += d.vy * dt;
  if (d.x < 10) { d.x = 10; d.vx = 0; }
  if (d.x > W.width - 10) { d.x = W.width - 10; d.vx = 0; }
  if (d.y < CEIL) { d.y = CEIL; d.vy = 0; }
  // посадка: торкнулися поверхні
  if (d.landing) {
    const sy = landSurface(d.x, d.y - DRONE_R);
    if (d.y + DRONE_R >= sy - 1) { d.y = sy - DRONE_R; d.vx = 0; d.vy = 0; d.landed = true; d.landing = false; return; }
  }
  const CRASH = 300; // швидкість удару (по нормалі), після якої дрон розбивається
  // земля
  const gy = gAt(W, d.x);
  if (d.y + DRONE_R > gy) {
    const sl = (gAt(W, d.x + 8) - gAt(W, d.x - 8)) / 16, nl = Math.hypot(sl, 1);
    const nx = sl / nl, ny = -1 / nl; // нормаль поверхні (вгору)
    const impact = -(d.vx * nx + d.vy * ny);
    if (impact > CRASH || d.jammed) { explodeDrone(d); return; }
    d.y = gy - DRONE_R;
    if (impact > 0) { d.vx += nx * impact * 1.2; d.vy += ny * impact * 1.2; }
    d.vx *= 0.97;
  }
  // об'єкти
  for (const s of solidsNear(W, d.x - 20, d.x + 20)) {
    const nx = clamp(d.x, s.x, s.x + s.w), ny = clamp(d.y, s.y, s.y + s.h);
    const dx = d.x - nx, dy = d.y - ny, dd = dx * dx + dy * dy;
    if (dd >= DRONE_R * DRONE_R) continue;
    if (dd === 0) { if (d.jammed || Math.hypot(d.vx, d.vy) > CRASH) { explodeDrone(d); return; } d.y = s.y - DRONE_R; d.vy = 0; continue; }
    const l = Math.sqrt(dd);
    const dot = (d.vx * dx + d.vy * dy) / l;
    if (-dot > CRASH || d.jammed) { explodeDrone(d); return; }
    d.x = nx + (dx / l) * DRONE_R; d.y = ny + (dy / l) * DRONE_R;
    if (dot < 0) { d.vx -= (dx / l) * dot * 1.3; d.vy -= (dy / l) * dot * 1.3; }
  }
  // цілі
  for (const h of G.humans) {
    if (h.dead || h.saved || h.hidden || h.vehicle) continue;
    if (rectDist(d.x, d.y, humanRect(h)) < DRONE_R) { explodeDrone(d, h, isHeadHit(d, h)); return; }
  }
  for (const v of W.vehicles) {
    if (v.dead) continue;
    if (rectDist(d.x, d.y, vehRect(v)) < DRONE_R + 2) { explodeDrone(d); return; }
  }
}

function explosionFx(x, y, power, radius) {
  for (let i = 0; i < (power > 60 ? 26 : 10); i++) {
    const a = rand(0, Math.PI * 2), s = rand(40, power > 60 ? 360 : 160);
    G.parts.push({ type: 'fire', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.6), max: 0.6, size: rand(6, 14) });
  }
  for (let i = 0; i < (power > 60 ? 14 : 5); i++) G.parts.push({ type: 'smoke', x: x + rand(-15, 15), y: y + rand(-15, 15), vx: rand(-30, 30), vy: rand(-60, -10), life: rand(1.5, 3), max: 3, size: rand(12, 24) });
  for (let i = 0; i < (power > 60 ? 14 : 4); i++) G.parts.push({ type: 'debris', x, y, vx: rand(-260, 260), vy: rand(-380, -60), life: rand(0.6, 1.2), max: 1.2 });
  G.parts.push({ type: 'ring', x, y, life: 0.3, max: 0.3, size: radius });
}
function explosion(x, y, power, radius, direct) {
  const W = G.W;
  Sfx.boom(power > 60);
  explosionFx(x, y, power, radius);
  // техніка: броня приймає удар, люди всередині лише поранені
  const shielded = new Set();
  for (const h of G.humans) if (h.vehicle) shielded.add(h);
  for (const v of W.vehicles) {
    if (v.dead) continue;
    if (rectDist(x, y, vehRect(v)) < radius * 0.45) {
      v.hp--;
      const occ = [v.driver, v.gunner].filter(Boolean);
      if (v.hp <= 0) { destroyVehicle(v); occ.forEach((o) => hurt(o, power > 60 ? 40 : 15, 'blast')); }
      else { occ.forEach((o) => hurt(o, power > 60 ? 18 : 6, 'blast')); feed(VEH[v.type].name + ' пошкоджено', '#f2994a'); }
    }
  }
  // люди
  for (const h of G.humans) {
    if (h.dead || h.saved || h.vehicle || shielded.has(h)) continue;
    if (h.hidden) {
      const e = hideEntrance(h);
      if (dist(x, y, e.x, e.y) < 45) hurt(h, power * 0.35, 'blast');
      continue;
    }
    // пряме влучання дрона в голову — броня не рятує
    if (direct && direct.h === h && direct.head) { hurt(h, 999, 'head'); continue; }
    const r = humanRect(h);
    const dd = rectDist(x, y, r);
    if (dd >= radius) continue;
    let dmg = power * Math.pow(1 - dd / radius, 0.8) * STANCE_DMG[h.stance];
    if (!lineOfSight(W, x, y, h.x, r.y + r.h / 2)) dmg *= 0.25;
    hurt(h, dmg, 'blast');
  }
  if (power >= 25) damageCovers(x, y, power);
}
// наземні укриття руйнуються: бліндажі, нори, тюки, колоди, блоки, кущі
function damageCovers(x, y, power) {
  const W = G.W, big = power >= 100, hits = big ? 2 : 1;
  for (const sp of W.hides) {
    if (sp.type === 'pipe' || sp.ruined || !sp.hp) continue;
    if (dist(x, y, sp.x, sp.y - 10) < (big ? 75 : 55)) { sp.hp -= hits; if (sp.hp <= 0) ruinHide(sp); }
  }
  let changed = false;
  for (const so of solidsNear(W, x - 80, x + 80)) {
    if (!so.hp || so.dead) continue;
    if (rectDist(x, y, so) < (big ? 40 : 26)) {
      so.hp -= hits;
      if (so.hp <= 0) {
        so.dead = true; changed = true;
        for (let i = 0; i < 12; i++) G.parts.push({ type: 'debris', x: so.x + rand(0, so.w), y: so.y + rand(0, so.h), vx: rand(-200, 200), vy: rand(-320, -60), life: rand(0.6, 1.2), max: 1.2 });
      }
    }
  }
  if (changed) { W.solids = W.solids.filter((so) => !so.dead); buildBuckets(W); }
  const before = W.bushes.length;
  W.bushes = W.bushes.filter((b) => {
    if (dist(x, y, b.x + b.w / 2, b.y - 20) > (big ? 85 : 60)) return true;
    if (b.cover) W.covers = W.covers.filter((c) => c !== b.cover);
    for (let i = 0; i < 8; i++) G.parts.push({ type: 'leaf', x: b.x + rand(0, b.w), y: b.y - rand(5, 40), vx: rand(-120, 120), vy: rand(-200, -40), life: rand(0.8, 1.4), max: 1.4 });
    return false;
  });
  if (W.bushes.length !== before) Sfx.noise_(0.3, 0.15, 2500, 'highpass');
}
function ruinHide(sp) {
  sp.ruined = true; sp.bonus = null;
  for (const h of G.humans) {
    if (h.hidden !== sp) continue;
    h.hidden = null; h.hideAnim = null; h.stance = 'prone'; h.vy = -150;
    hurt(h, 20, 'blast');
  }
  feed({ bunker: 'Бліндаж', burrow: 'Нору' }[sp.type] + ' зруйновано', '#f2994a');
}

// ---------- Камери ----------
function updateCameras(dt) {
  for (const p of G.players) {
    let tx, ty;
    if (p.role === 'human') {
      const h = p.ent;
      tx = h.x + (h.vehicle ? h.vehicle.vx * 0.5 : h.vx * 0.4); ty = h.y - 90;
    } else {
      const d = p.ent.drone;
      if (d) { tx = d.x + d.vx * 0.35; ty = d.y + d.vy * 0.2; }
      else { const pd = G.W.pads[p.ent.pad]; tx = pd.x + 120; ty = pd.y - 150; }
    }
    const k = Math.min(1, dt * 5);
    p.cam.x += (tx - p.cam.x) * k; p.cam.y += (ty - p.cam.y) * k;
  }
}

// ---------- Головний цикл гри ----------
function updateGame(dt) {
  G.time += dt;
  for (const h of G.humans) updateHuman(h, dt);
  updateVehicles(dt);
  for (const dp of G.dps) updateDronePlayer(dp, dt);
  for (const d of G.drones.slice()) updateDrone(d, dt);
  updateBullets(dt);
  updateBombs(dt);
  updateMines(dt);
  for (const r of G.rebs) r.t -= dt;
  G.rebs = G.rebs.filter((r) => r.t > 0);
  for (const f of G.feed) f.t -= dt;
  G.feed = G.feed.filter((f) => f.t > 0);
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const p = G.parts[i];
    p.life -= dt;
    if (p.life <= 0) { G.parts.splice(i, 1); continue; }
    if (p.vx !== undefined) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.type === 'debris' || p.type === 'spark' || p.type === 'gun' || p.type === 'leaf') p.vy += (p.type === 'leaf' ? 400 : 900) * dt;
      if (p.type === 'fire') { p.vx *= 0.92; p.vy *= 0.92; }
      if (p.type === 'gun') p.rot += dt * 10;
    }
  }
  // відкритість людей (для стрілки дрона)
  for (const h of G.humans) {
    if (h.dead || h.saved || h.hidden || humanConcealed(h)) h.openTime = 0;
    else h.openTime += dt;
  }
  updateCameras(dt);
  // звук дронів: гучність залежить від відстані до найближчої живої людини
  let lvl = 0, pitch = 160;
  for (const d of G.drones) {
    if (d.landed) continue;
    let md = 1e9;
    for (const h of G.humans) if (!h.dead && !h.saved) md = Math.min(md, dist(d.x, d.y, h.x, h.y));
    const l = clamp(1 - md / 900, 0, 1);
    if (l > lvl) { lvl = l; pitch = 150 + Math.hypot(d.vx, d.vy) * 0.25; }
  }
  Sfx.setBuzz(G.over ? 0 : lvl, pitch);
  // кінець гри
  if (!G.over) {
    const out = G.humans.filter((h) => !h.dead && !h.saved);
    if (out.length === 0) {
      G.over = G.humans.some((h) => h.saved) ? 'humans' : 'drones';
      G.overReason = G.over === 'humans' ? 'Дісталися укриття' : 'Усі люди загинули';
    } else if (G.dps.every((dp) => dp.left <= 0 && !dp.drone)) {
      G.over = 'humans'; G.overReason = 'У дронщиків закінчилися дрони';
    }
  } else G.overT += dt;
}
