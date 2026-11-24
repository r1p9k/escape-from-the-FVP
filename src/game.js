'use strict';
// ===== Ігрова логіка =====
const GRAV = 1500;
const RUN = 165, SPRINT = 295, CROUCH_SPD = 95, CRAWL = 55, JUMP = 520;
const DRONE_R = 9, DRONE_BATTERY = 75, DRONE_RESPAWN = 2, LAUNCH_DELAY = 6;
const ALIOSHA_NEED = 6, ALIOSHA_TIME = 10;
const REB_CD = 120, HEAL_TIME = 5, MEDKIT_MAX = 2; // РЕБ — не частіше разу на 2 хв; аптечка — 5 с
const MINE_TRIGGER = 30, MINE_R = 60;               // міна спрацьовує ближче 30 px (і низько в стрибку), уражає до 60 px
const AIR_BONUS = {                                 // бонуси для дронів, що висять у повітрі
  armor: { name: 'Броня дрона', short: 'БРОНЯ', color: '#9fb4d0' },
  speed: { name: 'Подвійна швидкість', short: '×2', color: '#f2c94c' },
  battery: { name: 'Запасний АКБ', short: 'АКБ', color: '#6fcf97' },
  ammo: { name: 'Поповнення скидів', short: '+СКИД', color: '#d79a5a' },
};
const HUMAN_LIVES = 3, RESPAWN_TIME = 3, NETS = 3; // 3 життя; відновлення через 3 с; 3 маскувальні сітки // «Альоша»: після 5+ збитих/пережитих дронів, триває 10 с
const DROP_TYPES = ['frag', 'smoke', 'mine', 'fire'];
const DROP_NAMES = { frag: 'Граната', smoke: 'Дим', mine: 'Міна', fire: 'Запальний' };
const DEFAULT_LOADOUT = ['frag', 'frag', 'smoke', 'mine'];
const BOT_LOADOUTS = [['frag', 'frag', 'smoke', 'mine'], ['frag', 'frag', 'frag', 'mine'], ['frag', 'mine', 'mine', 'smoke'], ['frag', 'frag', 'smoke', 'smoke'], ['frag', 'fire', 'fire', 'mine'], ['frag', 'frag', 'fire', 'smoke']];
const OPEN_TIME = 3;          // секунд на відкритій місцевості до появи стрілки
const HUMAN_DIM = { stand: { w: 18, h: 56 }, crouch: { w: 20, h: 38 }, prone: { w: 46, h: 16 } };
const STANCE_DMG = { stand: 1, crouch: 0.75, prone: 0.5 };
const WEAPONS = {
  rifle: { name: 'Автомат', ammo: 18, mag: 9, reload: 2.2, rate: 0.11, speed: 1500, range: 420, spread: 0.022, pellets: 1, dmg: 55 },
  shotgun: { name: 'Дробовик', ammo: 5, mag: 2, reload: 1.8, rate: 0.75, speed: 1200, range: 240, spread: 0.11, pellets: 7, dmg: 30 },
  mg: { name: 'Кулемет', ammo: 50, mag: 25, reload: 3.5, rate: 0.085, speed: 1600, range: 520, spread: 0.03, pellets: 1, dmg: 45 },
  smg: { name: 'Пістолет-кулемет', ammo: 40, mag: 20, reload: 1.6, rate: 0.07, speed: 1300, range: 300, spread: 0.04, pellets: 1, dmg: 32 },
  sniper: { name: 'Снайперська гвинтівка', ammo: 10, mag: 5, reload: 2.6, rate: 1.1, speed: 2600, range: 900, spread: 0.004, pellets: 1, dmg: 150 },
};
// розкид куль залежно від положення: стоячи — великий, сидячи — менший, лежачи — найточніше
const STANCE_SPREAD = { stand: 2.6, crouch: 1.4, prone: 0.75, mount: 1.3, burrow: 1.0, bunker: 0.8 };
const STANCE_ACC = { stand: 'стоячи — розкид', crouch: 'сидячи — точніше', prone: 'лежачи — точно', burrow: 'з нори — точно', bunker: 'з бійниці — точно' };
// сектори вогню (кут відносно погляду, від'ємний — угору)
const AIM_SECTOR = { burrow: [-0.75, 0.12], bunker: [-0.6, 0.05], trench: [-1.45, -0.12] };
const PACK_CAP = 4;      // місць у рюкзаку: аптечки, заряди РЕБ, детектор
const DETECT_R = 650;    // радіус детектора дронів
const PICKUP_NAMES = { molotov: 'Коктейлі Молотова', rifle: 'Автомат', shotgun: 'Дробовик', smg: 'Пістолет-кулемет', sniper: 'Снайперська гвинтівка', mg: 'Кулемет', reb: 'Заряд РЕБ', medkit: 'Аптечка', fuel: 'Каністра з пальним', armor: 'Бронежилет', detector: 'Детектор дронів', pack: 'Рюкзак загиблого', shovel: 'Лопата', grenade: 'Гранати', ammo: 'Набої', gasmask: 'Протигаз' };
const DIG_PX_M = 30;     // одиниць світу в метрі копання (людина ≈ 1,8 м)
const DIG_SPD = 13;      // швидкість копання, одиниць/с (повільно)
const TUN_SPD = 72;      // хода зігнувшись у тунелі
// зброя: ammo — усього набоїв, mag — скільки зараз у магазині
function makeWeapon(type, ammo) { ammo = ammo == null ? WEAPONS[type].ammo : ammo; return { type, ammo, mag: Math.min(WEAPONS[type].mag, ammo) }; }
const PLAYER_COLORS = ['#f2c94c', '#56ccf2', '#eb5757', '#6fcf97', '#bb86fc', '#f2994a', '#2dd4bf', '#e879f9'];

let G = null;

function newGame(slots, loc, opts) {
  opts = opts || {};
  const mode = opts.mode === 'dm' || opts.mode === 'team' ? opts.mode : 'escape';
  const W = makeWorld(loc, (Math.random() * 1e9) | 0, opts.len, mode === 'team');
  G = { W, opts, mode, timeLeft: (opts.dmMin || 10) * 60, players: [], humans: [], dps: [], drones: [], bullets: [], bombs: [], throws: [], mines: [], smokes: [], fires: [], parts: [], rebs: [], feed: [], time: 0, over: null, overReason: '', overT: 0, stats: { dronesUsed: 0, shotDown: 0, deaths: 0 } };
  if (mode === 'team') slots = fillTeams(slots); // мало учасників — решту заповнюють боти
  const nHum = slots.filter((s) => s.role === 'human').length;
  const nDr = slots.filter((s) => s.role === 'drone').length;
  let hi = 0;
  const tc = [0, 0], th = [0, 0];
  if (mode === 'team') { initTeam(); initSupply(); baseOnlyPickups(); }
  slots.forEach((s, i) => {
    const p = { name: s.name, color: s.color, role: s.role, bot: !!s.bot, remote: !!s.remote, cid: s.cid || 0, cam: { x: 0, y: 0, wide: false }, idx: i, score: 0, team: -1 };
    if (mode === 'team') { p.team = s.team === 1 ? 1 : s.team === 0 ? 0 : i % 2; p.color = TEAMS[p.team].cols[tc[p.team]++ % 2]; }
    p.ctrl = s.bot ? new BotController(p, s.level) : s.remote ? netCtrl(s) : CONTROLLERS[s.scheme];
    if (s.role === 'human') {
      const h = makeHuman(p, W.start.x + hi * 40); hi++;
      if (mode === 'dm') { h.x = randomSpawnX(); h.y = gAt(W, h.x); }
      if (mode === 'team') { const k = th[p.team]++; h.x = p.team ? W.start2.x - k * 40 : W.start.x + k * 40; h.y = gAt(W, h.x); h.facing = fwdDir(p); }
      G.humans.push(h); p.ent = h;
      p.cam.x = h.x; p.cam.y = h.y - 100;
    } else {
      // дронів безліміт: рахуємо лише, скільки витрачено
      const dp = { player: p, left: Infinity, total: Infinity, used: 0, drone: null, timer: LAUNCH_DELAY, pad: 0, sel: 0,
        loadout: (s.bot ? pick(BOT_LOADOUTS) : s.loadout || DEFAULT_LOADOUT).slice() };
      G.dps.push(dp); p.ent = dp;
      const p0 = curPad(dp); p.cam.x = p0.x + 120 * fwdDir(p); p.cam.y = p0.y - 150;
    }
    G.players.push(p);
  });
  G.airBonuses = [];
  for (let i = 0; i < Math.floor(W.width / 1800); i++) G.airBonuses.push(spawnAirBonus({}));
}

function makeHuman(p, x) {
  return {
    player: p, x, y: gAt(G.W, x), vx: 0, vy: 0, stance: 'stand', facing: 1, onGround: true, onThin: false, wasGround: true,
    hp: 100, stamina: 1, staminaDelay: 0, exhausted: false, climb: null, onLadder: false, dropT: 0,
    vehicle: null, seat: null, hidden: null, tun: null, digging: null, shovel: Infinity, weapon: null, reb: 1, fireCd: 0,
    carry: null, mount: null, working: null, grenades: G.mode === 'team' ? 3 : GRENADES_START, molotovs: 1, throwSel: null, grenadeCd: 0, piloting: false,
    openTime: 0, reveal: 0, hurtT: 0, dead: false, saved: false, anim: 0,
    aimA: -0.5, aiming: false, diving: false, diveCd: 0, canister: false, smokeT: 0, gasT: 0, gasWarned: false,
    armor: 0, beaten: 0, alCharges: 0, alT: 0, alGranted: false, hideAnim: null,
    rebCd: 0, medkits: 0, healT: 0, reloadT: 0, bloom: 0, detector: false,
    lives: G.mode === 'escape' ? HUMAN_LIVES : Infinity, nets: NETS, respawnT: 0, spawn: null, deaths: 0,
  };
}
function feed(text, color) { G.feed.push({ text, color: color || '#fff', t: 4 }); if (G.feed.length > 5) G.feed.shift(); }

// повністю під землею (у тунелі): згори не видно, доки нема прямої видимості
function buried(h) {
  if (h.hidden || h.vehicle || h.dead || h.saved) return false;
  const g = gAt(G.W, h.x);
  return h.y > g + 6 && h.y - HUMAN_DIM[h.stance].h > g - 2;
}
function seenUnder(h, x, y) { return !buried(h) || lineOfSight(G.W, x, y, h.x, h.y - HUMAN_DIM[h.stance].h * 0.6); }
// у схованці (нора, бліндаж) — не видно й не влучити
function covered(h) { return !!h.hidden; }
// чи влазить тіло між земляними стінами тунелю: у кожному стовпчику — проміжок, де є підлога (сходинка ≤ 15) і місце для голови
function earthFits(x, y, dim) {
  const W = G.W;
  if (!W.pipes.length) return true;
  const hw = dim.w / 2 - 2;
  for (const cx of [x - hw, x, x + hw]) {
    let ok = false;
    for (const s of cavSpans(W, cx, true)) {
      if (s.bot < y - 26 || s.top > y - 2) continue; // уступ до 26 px (низ спуску й підлога галереї можуть не збігатися) — переступає
      if (s.top <= Math.min(y, s.bot) - dim.h + 4) { ok = true; break; }
    }
    if (!ok) return false;
  }
  return true;
}
// проміжок (підлога й стеля) у стовпчику x біля ніг y
function humanSpan(x, y) {
  const S = cavSpans(G.W, x, true);
  for (const s of S) if (y >= s.top - 2 && y <= s.bot + 14) return s;
  let best = S[0];
  for (const s of S) if (s.bot <= y + 14) best = s;
  return best;
}
function humanRect(h) {
  if (h.vehicle) { const T = VEH[h.vehicle.type]; return { x: h.vehicle.x - T.len / 2, y: h.vehicle.y - T.h - 20, w: T.len, h: T.h + 20 }; }
  if (h.rollT > 0) return { x: h.x - 12, y: h.y - 22, w: 24, h: 22 }; // у кувирку — клубком біля землі
  const d = HUMAN_DIM[h.stance];
  return { x: h.x - d.w / 2, y: h.y - d.h, w: d.w, h: d.h };
}
function vehRect(v) { const T = VEH[v.type]; return { x: v.x - T.len / 2, y: v.y - T.h, w: T.len, h: T.h }; }

function freeAt(x, y, dim) {
  if (!earthFits(x, y, dim)) return false;
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
function ladderAt(h, dir) {
  let any = null;
  for (const l of G.W.ladders) {
    if (Math.abs(h.x - l.x) >= 16 || h.y < l.top - 3 || h.y > l.bottom + 3) continue;
    if (!dir || (dir < 0 && h.y > l.top + 4) || (dir > 0 && h.y < l.bottom - 4)) return l; // на стику поверхів — та, якою можна лізти в потрібний бік
    any = any || l;
  }
  return any;
}
// стоїть нагорі драбини: чи є опора під ногами (інакше зійти вбік)
function ladderTopOff(h, l) {
  const W = G.W;
  const supported = (x) => {
    // опора для людини: земля (над лазом — кришка) або перекриття, що на рівні верху драбини
    const sp = humanSpan(x, l.top - 2);
    let fy = sp.surf ? gAt(W, x) : sp.bot;
    for (const so of solidsNear(W, x, x)) if (x >= so.x && x <= so.x + so.w && so.y >= l.top - 4 && so.y < fy) fy = so.y;
    return Math.abs(fy - l.top) < 6 && freeAt(x, l.top, HUMAN_DIM.stand);
  };
  if (supported(h.x)) return;
  for (const d of [h.facing || 1, -(h.facing || 1)]) for (const dx of [14, 22, 30]) {
    const x = l.x + d * dx;
    if (supported(x)) { h.x = x; h.y = l.top; return; }
  }
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
  if (drone && ally(h, drone)) return !h.saved; // своїх дрон бачить завжди
  if (h.saved) return false;
  // з нори визирає — дрон помітить після пострілу або впритул
  if (covered(h)) return !!(h.peek && drone && (h.reveal > 0 || dist(drone.x, drone.y, h.hidden.x, h.hidden.y - 8) < 160));
  // у тунелі: дрон бачить, лише зазирнувши в отвір (пряма видимість)
  if (buried(h)) return !!drone && dist(drone.x, drone.y, h.x, h.y) < 520 && seenUnder(h, drone.x, drone.y);
  const by = concealedBy(h);
  if (!by) return true;
  if (!drone) return false;
  const dd = dist(drone.x, drone.y, h.x, h.y - 20);
  if (dd < 90) return true;
  // у руїнах: дрон бачить людину, якщо зазирнув у вікно, двері чи пролом (пряма видимість)
  if (by === 'ruin') { const b = buildingAt(h.x, h.y); if (b && b.net && !droneHovering(drone, h.x, h.y - 20)) return false; }
  if (by === 'ruin' && dd < 280 && lineOfSight(G.W, drone.x, drone.y, h.x, h.y - HUMAN_DIM[h.stance].h * 0.6)) return true;
  return false;
}
function droneVisibleToHuman(d, h) {
  if (!droneConcealed(d)) return true;
  return h && dist(d.x, d.y, h.x, h.y - 20) < 120;
}
// «ждун» сидить у кущах
function droneInBush(d) {
  if (!d.landed) return false;
  for (const b of G.W.bushes) if (d.x > b.x + 4 && d.x < b.x + b.w - 4 && Math.abs(d.y + DRONE_R - b.y) < 30) return true;
  return false;
}
function humanEye(h) {
  if (h.vehicle) return { x: h.vehicle.x, y: h.vehicle.y - 34 };
  if (h.hidden && h.hidden.type === 'burrow') return { x: h.hidden.x, y: h.hidden.y - 8 };
  if (h.hidden && h.hidden.type === 'bunker') return { x: h.hidden.x, y: h.hidden.y - 16 };
  return { x: h.x, y: h.y - HUMAN_DIM[h.stance].h * 0.85 };
}
// чи бачить людина дрон: не крізь стіни, не в диму/кронах, не «ждуна» в кущах; детектор бачить усе поруч
function droneSeenBy(d, h, noDetector) {
  if (!h || h.dead || h.saved) return true;
  const e = humanEye(h), dd = dist(d.x, d.y, e.x, e.y);
  if (!noDetector && h.detector && dd < DETECT_R) return true;
  if (dd < 45) return true;
  if (d.inBush) return false;
  if (!droneVisibleToHuman(d, h)) return false;
  return lineOfSight(G.W, e.x, e.y, d.x, d.y);
}

// ---------- Людина ----------
function updateHuman(h, dt) {
  const c = h.player.ctrl, W = G.W;
  h.fireCd -= dt; h.reveal -= dt; h.hurtT -= dt;
  if (h.digT > 0) h.digT -= dt;
  if (h.digAngT > 0) h.digAngT -= dt;
  if (h.rollCd > 0) h.rollCd -= dt;
  if (h.flipT > 0) { h.flipT -= dt; if (h.onGround && h.flipT < FLIP_T - 0.1) h.flipT = 0; }
  h.bloom = Math.max(0, h.bloom - dt * 1.6);
  if (h.reloadT > 0 && !h.dead && (h.reloadT -= dt) <= 0) finishReload(h);
  if (h.hipT > 0) h.hipT -= dt;
  h.idleFire = (h.idleFire || 0) + dt;
  if (h.idleFire > 1.2 && h.weapon && !h.dead && h.reloadT <= 0 && !h.hidden && h.weapon.mag < Math.min(WEAPONS[h.weapon.type].mag, h.weapon.ammo)) startReload(h);
  if (h.hideAnim && (h.hideAnim.t += dt) >= h.hideAnim.dur) h.hideAnim = null;
  if (h.alT > 0 && (h.alT -= dt) <= 0) { h.alT = 0; feed(h.player.name + ': «Альоша» закінчився', '#f2c94c'); }
  if (h.dead && h.respawnT > 0 && (h.respawnT -= dt) <= 0) respawnHuman(h);
  if (h.protT > 0) h.protT -= dt;
  if (h.rebCd > 0) h.rebCd -= dt;
  if (h.grenadeCd > 0) h.grenadeCd -= dt;
  if (h.meleeCd > 0) h.meleeCd -= dt;
  if (h.meleeT > 0) { h.meleeT -= dt; if (h.meleePend && h.meleeT < MELEE_T * 0.42) meleeHit(h); }
  if (h.dead || h.saved) return;
  passCheckpoint(h);
  // гравець керує дроном — тіло лишається на місці
  if (h.piloting) { if (!h.hidden) { h.vx = 0; moveHuman(h, dt); } return; }
  if (h.mount) { humanOnMount(h, c, dt); return; }
  if (h.vehicle) { humanInVehicle(h, c, dt); return; }
  if (h.hidden) { humanHidden(h, c, dt); return; }
  if (h.climb) {
    const k = clamp((h.climb.t += dt) / h.climb.dur, 0, 1);
    h.y = lerp(h.climb.sy, h.climb.ty, Math.min(1, k * 1.6));
    h.x = lerp(h.climb.sx, h.climb.tx, Math.max(0, (k - 0.4) / 0.6));
    if (k >= 1) { h.climb = null; h.onGround = true; h.vy = 0; if (!tryStance(h, 'stand')) h.stance = 'crouch'; }
    return;
  }
  if (h.digging) { tickDig(h, c, dt); moveHuman(h, dt); checkShelter(h); return; }
  if (h.working) { tickWork(h, c, dt); h.vx = 0; moveHuman(h, dt); checkShelter(h); return; }
  if (h.digMode) { digModeTick(h, c, dt); if (!h.onLadder) moveHuman(h, dt); else { h.vx = 0; h.vy = 0; } checkShelter(h); return; }
  // кувирок: дуже швидкий ривок низько над землею — ухилитися від дрона
  if (h.rollT > 0) {
    h.rollT -= dt; h.vx = h.rollDir * 580 * (0.5 + 0.5 * Math.max(0, h.rollT) / ROLL_T);
    moveHuman(h, dt);
    if (h.rollT <= 0) { h.rollT = 0; if (h.rollPrev === 'stand' && !tryStance(h, 'stand')) h.autoCrouch = true; } // випростатися, щойно буде місце
    checkShelter(h); return;
  }
  if (c.pressed('roll') && !(h.rollCd > 0) && !h.onLadder && !h.carry && !h.mount) {
    if (h.onGround) { h.rollDir = c.axisX || h.facing; h.facing = h.rollDir; h.rollPrev = h.stance; h.stance = 'crouch'; h.rollT = ROLL_T; h.rollCd = 0.7; h.aiming = false; h.stamina = Math.max(0, (h.stamina || 0) - 0.1); }
    else if (!(h.flipT > 0)) { h.flipT = FLIP_T; h.flipDir = h.facing; h.vy = Math.min(h.vy, h.vy - 140); h.rollCd = 0.7; } // у стрибку — сальто
  }
  const ax = c.axisX;
  // сам пригнувся в низькому ході — вийшов на простір і випростався
  if (h.autoCrouch) { if (h.stance !== 'crouch') h.autoCrouch = false; else if (h.onGround && tryStance(h, 'stand')) h.autoCrouch = false; }
  if (h.wallT > 0) h.wallT -= dt;
  const lad = ladderAt(h, h.onLadder ? (c.held('down') ? 1 : -1) : c.pressed('down') ? 1 : -1);
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
  if (c.pressed('slot3')) cycleThrow(h);
  if (h.throwSel && !throwCount(h, h.throwSel)) h.throwSel = nextThrow(h, h.throwSel, true);
  h.grenAim = !!h.throwSel && canGrenAim(h) && h.onGround && !h.onLadder;
  h.aiming = (c.held('aim') || h.grenAim) && h.onGround && !h.onLadder;
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
      if (lad && h.y > lad.top + 4) { h.onLadder = true; h.stance = 'stand'; h.x = lad.x; }
      else if (h.stance === 'prone') tryStance(h, 'crouch');
      else if (h.stance === 'crouch') tryStance(h, 'stand');
      else if (h.onGround && !tryMantle(h)) { h.vy = -JUMP; h.onGround = false; }
    }
    if (c.pressed('down') && !h.onLadder) {
      if (lad && h.onGround && Math.abs(h.y - lad.top) < 5 && ladderAt(h, 1)) { h.onLadder = true; h.stance = 'stand'; h.x = lad.x; h.y += 6; } // з будь-якої пози
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
      if (h.y <= lad.top) {
        const up = G.W.ladders.find((l) => l !== lad && Math.abs(l.x - lad.x) < 16 && Math.abs(l.bottom - lad.top) < 6);
        if (up && v < 0) { h.x = up.x; } // далі — наступна драбина вгору
        else { h.y = lad.top; h.onLadder = false; h.vy = 0; h.onGround = true; ladderTopOff(h, lad); }
      }
      else if (h.y >= lad.bottom && v > 0) { h.y = lad.bottom; h.onLadder = false; }
      if (ax !== 0 && v === 0) { h.onLadder = false; h.facing = ax; h.vx = ax * 80; }
    } else {
      let speed = h.stance === 'stand' ? RUN : h.stance === 'crouch' ? CROUCH_SPD : CRAWL;
      const wantSprint = c.held('sprint') && h.stance === 'stand' && ax !== 0;
      h.adren = G.drones.some((d) => !d.dead && !ally(d, h) && !d.onPad && dist(d.x, d.y, h.x, h.y - 25) < ADREN_R);
      if (wantSprint && h.adren) { speed = SPRINT; h.exhausted = false; h.stamina = Math.min(1, h.stamina + dt / 8); } // страх: дрон поруч — біг без утоми
      else if (wantSprint && h.stamina > 0 && !h.exhausted) {
        speed = SPRINT; h.stamina -= dt / 6; h.staminaDelay = 0.9; // запасу витривалості — на 6 с бігу
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

  if (ax && !h.aiming && !h.onLadder && h.onGround && h.wallT > 0) { const rb = rubbleAt(h, ax); if (rb) digRubble(h, rb.br, dt); } // уперся в завал — розкопує
  backpackInput(h, c);
  tickHeal(h, c, dt, ax !== 0 || h.aiming || !h.onGround);
  // є місце — предмети підбираються самі (крім щойно викладених цією ж людиною)
  for (const pk of G.W.pickups) if (!pk.taken && Math.abs(pk.x - h.x) < 30 && Math.abs(pk.y - h.y) < 40 && autoTake(h, pk)) { takePickup(h, pk); break; }
  if (c.pressed('drop')) dropItem(h);
  if (c.pressed('build') && !h.working) { const ft = fortTarget(h); if (tunnelDoorSpot(h)) startTunnelDoor(h); else if (ft) startPly(h, ft); else tipOnce(h, 'Двері з фанери ставлять у тунелі або в отворі будинку'); }
  // «Позиція» + «Дія»: сітка; у будівлі з сіткою біля вікна — вогнева позиція
  if (c.pressed('interact') && c.held('aim')) { const mt = mountTarget(h); if (mt) startMount(h, mt); else placeNet(h); }
  else if (c.pressed('interact')) {
    const m = nearMount(h), v = nearVehicle(h), kv = kitVehicle(h), shop = nearShop(h);
    if (kv) { h.working = { kind: 'kit', t: 0, dur: 3, v: kv, kit: h.kit }; h.vx = 0; } // встановити обладнання на техніку
    else if (shop) takeKit(h);
    else if (m) useMount(h, m);
    else if (v) enterVehicle(h, v);
    else {
      const pk = nearPickup(h);
      if (pk) takeOrSwap(h, pk);
      else {
        const sp = nearHide(h), pr = !h.carry && !h.canister ? nearProp(h) : null, ft = fortTarget(h);
        if (sp) enterHide(h, sp);
        else if (pr) takeProp(h, pr);
        else if (ft) startPly(h, ft);
        else if (tunnelDoorSpot(h)) startTunnelDoor(h);
        else if (h.carry) dropCarry(h);
        else if (digAction(h, false, true)) tipOnce(h, 'Копати — [' + c.label('dig') + ']' + (pipeAt(G.W, h.x, h.y) ? '; углиб — [' + c.label('down') + '] + [' + c.label('dig') + ']' : ''));
      }
    }
  }
  // «Копати» — лопата: завали, перекриття, виходи, спуски, окопчик; із «Бігом» — протитанковий рів
  if (c.pressed('dig') && !h.working && !h.carry && !digAction(h, c.held('sprint'), false)) startDigMode(h); // інакше — лопата: стрілка напрямку й копання
  // «Альоша»: автонаведення на дрони, стріляти можна й на бігу
  const mt = !h.aiming && c.pressed('fire') && !(h.meleeCd > 0) ? meleeTarget(h) : null;
  if (mt) melee(h, mt); // впритул — рукопашна
  else if (h.carry) { if (c.pressed('fire') && h.fireCd <= 0) throwCarry(h); } // предмет у руках — кинути
  else if (h.grenAim) { if (c.pressed('fire')) throwSelected(h); } // граната чи коктейль у руці — кидок лише кнопкою пострілу
  else if (h.alT > 0) { if (c.held('fire') && h.fireCd <= 0 && !h.canister) alioshaShot(h); }
  else if (c.held('fire') && h.weapon && h.canister && c.pressed('fire')) feed(h.player.name + ': руки зайняті каністрою — [' + c.label('slot1') + '] викинути', '#ccc');
  else if (h.aiming && !h.grenAim && c.held('fire') && h.weapon && !h.canister && h.fireCd <= 0 && h.reloadT <= 0 && h.weapon.mag > 0) {
    humanShoot(h, muzzle(h), h.stance);
  }
  // без позиції — з руки, одразу: приціл сам іде на найближчу ціль (або за мишею); на бігу розкид шалений
  else if (!h.aiming && c.held('fire') && h.weapon && !h.canister && !h.onLadder && h.fireCd <= 0 && h.reloadT <= 0 && h.weapon.mag > 0) {
    const run = Math.abs(h.vx) > 40 || !h.onGround;
    setAimWorld(h, c.cur.aimAngle !== undefined ? c.cur.aimAngle : hipAim(h));
    h.hipMul = run ? HIP_RUN : HIP_STILL; h.hipT = 0.5;
    humanShoot(h, muzzle(h), h.stance);
    h.hipMul = 0;
  }
  if (c.held('fire')) h.idleFire = 0;
  if (c.pressed('special')) {
    if (c.held('aim') && h.alCharges > 0 && h.alT <= 0) activateAliosha(h);
    else activateReb(h);
  }
  checkShelter(h);
}

// розкид стрільби з руки: стоячи на місці — ×2.5, на бігу чи в стрибку — ×10
const HIP_STILL = 2.5, HIP_RUN = 10;
// куди сам наводиться ствол без позиції: найближчий видимий ворожий дрон (у командах — і людина) у межах дальності
const ADREN_R = 340; // дрон ближче — адреналін
function hipAim(h) {
  const Wp = WEAPONS[h.weapon.type], ox = h.x, oy = h.y - HUMAN_DIM[h.stance].h * 0.68;
  let best = null, bd = Wp.range * 0.95;
  for (const d of G.drones) {
    if (ally(d, h) || d.dead) continue;
    const dd = dist(ox, oy, d.x, d.y) + ((d.x - h.x) * h.facing < 0 ? 140 : 0); // попереду — охочіше
    if (dd < bd && droneSeenBy(d, h, true) && lineOfSight(G.W, ox, oy, d.x, d.y)) { bd = dd; best = { x: d.x, y: d.y }; }
  }
  if (isTeam()) for (const o of G.humans) {
    if (o === h || o.dead || o.saved || o.hidden || o.vehicle || allyP(o.player, h.player)) continue;
    const ty = o.y - HUMAN_DIM[o.stance].h * 0.55, dd = dist(ox, oy, o.x, ty) + ((o.x - h.x) * h.facing < 0 ? 140 : 0);
    if (dd < bd && lineOfSight(G.W, ox, oy, o.x, ty)) { bd = dd; best = { x: o.x, y: ty }; }
  }
  if (best) return Math.atan2(best.y - oy, best.x - ox);
  return h.facing > 0 ? -0.12 : Math.PI + 0.12; // цілі нема — прямо перед собою
}
function humanShoot(h, m, stance) {
  fireWeapon(h, m.x, m.y, h.weapon.type, aimWorld(h), false, stance);
  h.fireCd = WEAPONS[h.weapon.type].rate;
  h.weapon.mag--;
  if (--h.weapon.ammo <= 0) {
    G.parts.push({ type: 'gun', x: m.x, y: m.y, vx: -h.facing * 120, vy: -260, life: 1.2, max: 1.2, rot: 0 });
    feed(h.player.name + ': ' + WEAPONS[h.weapon.type].name + ' — набої скінчилися', '#ccc');
    h.weapon = null;
  } else if (h.weapon.mag <= 0) startReload(h);
}
// звідки стріляє людина, що визирає з нори чи з бійниці бліндажа
function burrowMuzzle(h) {
  const sp = h.hidden, a = aimWorld(h);
  if (sp.type === 'burrow') return { x: sp.x - burrowDir(sp) * 6 + Math.cos(a) * 16, y: sp.y - 4 + Math.sin(a) * 16 }; // дуло — біля отвору, лежачи
  return { x: sp.x + Math.cos(a) * 14, y: sp.y - (sp.type === 'bunker' ? 16 : 7) + Math.sin(a) * 14 };
}
// з якої схованки можна стріляти
function canPeek(sp) { return sp.type === 'burrow' || (sp.type === 'bunker' && !sp.basement && !sp.ruined); }
// людина на дні окопу (нижче бруствера)
// у окопі, цілячись, людина стає на вогневу сходинку: дуло й рука — над бруствером
function trenchLift(h) {
  if (!h.aiming || h.vehicle || h.hidden || h.onLadder || h.dead || !G || h === MENU_HUMAN) return 0;
  const c = G.W.covers.find((c) => c.type === 'trench' && h.x > c.x && h.x < c.x + c.w && h.y > c.y + 14 && h.y < c.y + c.h + 6);
  if (!c) return 0;
  const top = h.y - HUMAN_DIM[h.stance].h * (h.grenAim ? 0.82 : 0.68);
  return Math.max(0, top - (c.y - 8));
}
function inTrench(h) {
  if (h.vehicle || h.hidden || h.onLadder) return false;
  return G.W.covers.some((c) => c.type === 'trench' && h.x > c.x && h.x < c.x + c.w && h.y > c.y + 14 && h.y < c.y + c.h + 6);
}
// кут у світі → кут відносно погляду
function aimRel(a) { return Math.atan2(Math.sin(a), Math.abs(Math.cos(a))); }

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

// ---------- Перезарядка ----------
function startReload(h) {
  if (!h.weapon || h.reloadT > 0) return;
  h.reloadT = WEAPONS[h.weapon.type].reload;
  Sfx.click();
}
function finishReload(h) {
  h.reloadT = 0;
  if (!h.weapon) return;
  h.weapon.mag = Math.min(WEAPONS[h.weapon.type].mag, h.weapon.ammo);
  Sfx.tone(520, 0.05, 0.1); Sfx.click();
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
  const y = (h.stance === 'prone' ? h.y - 8 : h.y - d.h * 0.68) - trenchLift(h);
  const a = aimWorld(h);
  return { x: h.x + Math.cos(a) * 16, y: y + Math.sin(a) * 16 };
}

function moveHuman(h, dt) {
  const W = G.W;
  let d = HUMAN_DIM[h.stance], hw = d.w / 2;
  const ox = h.x;
  // двері з фанери: людина проходить, але сповільнюється
  const inDoor = solidsNear(W, h.x - 20, h.x + 20).some((s) => s.door && h.x + hw > s.x - 2 && h.x - hw < s.x + s.w + 2 && h.y > s.y && h.y - d.h < s.y + s.h);
  h.x = clamp(h.x + h.vx * dt * (inDoor ? 0.3 : 1), 10, W.width - 10);
  // земляні стіни й стеля тунелю: у низький хід — пригнутися самому
  if (h.x !== ox && !earthFits(h.x, h.y, d)) {
    if (h.stance === 'stand' && earthFits(h.x, h.y, HUMAN_DIM.crouch)) { h.stance = 'crouch'; h.autoCrouch = true; d = HUMAN_DIM.crouch; hw = d.w / 2; }
    else { h.x = ox; h.wallT = 0.1; h.vx = 0; }
  }
  for (const s of solidsNear(W, h.x - 60, h.x + 60)) {
    if (s.thin || s.door) continue; // крізь двері — можна, повільно (нижче)
    if (h.y > s.y + 0.5 && h.y - d.h < s.y + s.h && h.x + hw > s.x && h.x - hw < s.x + s.w) {
      if (h.onGround && h.y - s.y <= 15 && freeAt(h.x, s.y, d)) { h.y = s.y; continue; }
      if (h.x < s.x + s.w / 2) h.x = s.x - hw; else h.x = s.x + s.w + hw;
      h.vx = 0;
    }
  }
  if (h.onGround && W.ditches.length) for (const d of W.ditches) {
    if (bridgeOk(d) || Math.abs(h.y - d.g) > 10) continue;
    if (ox <= d.a - 8 && h.x > d.a - 8) { h.x = d.a - 8; h.vx = 0; h.wallT = 0.1; }
    else if (ox >= d.b + 8 && h.x < d.b + 8) { h.x = d.b + 8; h.vx = 0; h.wallT = 0.1; }
  }
  const prevY = h.y;
  h.wasGround = h.onGround;
  h.vy = Math.min(1400, h.vy + GRAV * dt);
  h.y += h.vy * dt;
  h.onGround = false; h.onThin = false;
  const sp = humanSpan(h.x, prevY), gy = sp.surf ? gAt(W, h.x) : sp.bot;
  if (h.y >= gy || (h.wasGround && h.vy >= 0 && gy - h.y < 12 && prevY >= gy - 12)) {
    if (h.vy > 950) hurt(h, (h.vy - 950) * 0.08, 'fall');
    h.y = gy; h.vy = 0; h.onGround = true;
  }
  if (sp.top > -1e8 && h.vy < 0 && h.y - d.h < sp.top) { h.y = sp.top + d.h; h.vy = 0; } // стеля тунелю
  for (const s of solidsNear(W, h.x - 30, h.x + 30)) {
    if (h.x + hw <= s.x || h.x - hw >= s.x + s.w || s.door) continue;
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
    if (sp.type !== 'pipe' && Math.abs(h.x - sp.x) < 28 && Math.abs(h.y - sp.y) < 40) return sp;
  }
  return null;
}
// ---------- Рюкзак: 4 місця (аптечки, заряди РЕБ, детектор) ----------
function packUsed(h) { return h.medkits + h.reb + (h.detector ? 1 : 0) + (h.cans || 0); }
function canTake(h, p) {
  if (p.type === 'gasmask') return !h.gasmask;
  if (p.type === 'grenade') return h.grenades < GRENADES_MAX;
  if (p.type === 'molotov') return (h.molotovs || 0) < MOLOTOV_MAX;
  if (p.type === 'ammo') return !!h.weapon && h.weapon.ammo < WEAPONS[h.weapon.type].ammo * 2;
  if (p.type === 'medkit') return h.medkits < MEDKIT_MAX && packUsed(h) < PACK_CAP;
  if (p.type === 'reb') return packUsed(h) < PACK_CAP;
  if (p.type === 'detector') return !h.detector && packUsed(h) < PACK_CAP;
  if (p.type === 'fuel') return packUsed(h) < PACK_CAP;
  if (p.type === 'pack') return packGain(h, p.pack);
  return true;
}
// чи є в рюкзаку загиблого щось, що можна забрати
function packGain(h, k) {
  const room = packUsed(h) < PACK_CAP;
  return !!((k.weapon && !h.weapon) || (room && k.detector && !h.detector) || (room && k.medkits > 0 && h.medkits < MEDKIT_MAX) || (room && k.reb > 0));
}
function takePickup(h, p) {
  if (!canTake(h, p)) {
    if (G.time - (h.packMsgT || -9) > 2) { h.packMsgT = G.time; feed(h.player.name + ': не влізе в рюкзак (' + packUsed(h) + '/' + PACK_CAP + ')', '#ccc'); }
    return;
  }
  if (p.type === 'pack') { takePack(h, p); return; }
  p.taken = true;
  if (p.type === 'reb') h.reb++;
  else if (p.type === 'medkit') h.medkits++;
  else if (p.type === 'detector') { h.detector = true; feed(h.player.name + ' знайшов детектор дронів — видно дрони крізь стіни й у кущах', '#5ad1c4'); }
  else if (p.type === 'fuel') { h.cans = (h.cans || 0) + 1; feed(h.player.name + ': каністра в рюкзаку — заправить техніку, коли скінчиться пальне', '#f2c94c'); }
  else if (p.type === 'ammo') { h.weapon.ammo += WEAPONS[h.weapon.type].ammo; feed(h.player.name + ': поповнив набої', '#ddd'); }
  else if (p.type === 'grenade') { h.grenades = Math.min(GRENADES_MAX, h.grenades + 2); feed(h.player.name + ': гранат ' + h.grenades, '#c9a227'); }
  else if (p.type === 'molotov') { h.molotovs = Math.min(MOLOTOV_MAX, (h.molotovs || 0) + 2); feed(h.player.name + ': коктейлів Молотова ' + h.molotovs, '#ff8a3a'); }
  else if (p.type === 'gasmask') { h.gasmask = true; feed(h.player.name + ' вдягнув протигаз — дим більше не шкодить', '#9fd3c7'); }
  else if (p.type === 'armor') h.armor = 100;
  else { h.weapon = makeWeapon(p.type); if (p.ammo != null) { h.weapon.ammo = p.ammo; h.weapon.mag = Math.min(p.mag, p.ammo); } h.reloadT = 0; }
  Sfx.click();
}
// підібрати само, якщо є місце
function autoTake(h, p) {
  if (p.byName === h.player.name && G.time - (p.byT || 0) < 4) return false; // щойно виклав — не підбирати назад
  if (WEAPONS[p.type]) return !h.weapon && !h.mount && !h.vehicle;
  if (p.type === 'armor') return (h.armor || 0) < 100;
  if (p.type === 'pack') return packGain(h, p.pack);
  return canTake(h, p);
}
// «Дія» біля предмета: місця немає — старе викладається, нове береться
function takeOrSwap(h, p) {
  if (WEAPONS[p.type] && h.weapon) dropOne(h, 'weapon');
  else if (['medkit', 'reb', 'detector', 'fuel'].includes(p.type) && !canTake(h, p)) {
    const other = ['cans', 'reb', 'medkits', 'detector'].find((k) => k !== { medkit: 'medkits', reb: 'reb', detector: 'detector', fuel: 'cans' }[p.type] && (k === 'detector' ? h.detector : h[k] > 0));
    if (other) dropOne(h, other);
  }
  takePickup(h, p);
}
// викласти одну річ на землю (поруч, у бік погляду)
const DROP_TYPE = { medkits: 'medkit', reb: 'reb', detector: 'detector', cans: 'fuel' };
function dropOne(h, what) {
  const W = G.W, x = clamp(h.x + h.facing * 16, 20, W.width - 20);
  const p = { x, y: h.y, byName: h.player.name, byT: G.time };
  if (what === 'weapon') { if (!h.weapon) return false; p.type = h.weapon.type; p.ammo = h.weapon.ammo; p.mag = h.weapon.mag; h.weapon = null; h.reloadT = 0; h.aiming = false; }
  else if (what === 'detector') { if (!h.detector) return false; h.detector = false; p.type = 'detector'; }
  else { if (!(h[what] > 0)) return false; h[what]--; p.type = DROP_TYPE[what]; }
  W.pickups.push(p);
  feed(h.player.name + ' виклав: ' + (PICKUP_NAMES[p.type] || p.type).toLowerCase(), '#ccc');
  Sfx.click();
  return true;
}
// «Викласти»: спершу те, що в руках, далі — з рюкзака
function dropItem(h) {
  if (h.vehicle || h.hidden || h.dead) return;
  if (h.carry) { dropCarry(h); return; }
  if (h.canister) { dropCanister(h); return; }
  for (const w of ['weapon', 'cans', 'detector', 'reb', 'medkits']) if (dropOne(h, w)) return;
  tipOnce(h, 'Нічого викласти');
}
// двері з фанери в тунелі — будь-де в галереї
function tunnelDoorSpot(h) {
  const W = G.W, sp = pipeHere(W, h.x, h.y);
  if (!sp || Math.abs(h.y - tunFloor(W, sp, h.x)) > 6 || h.carry) return null;
  const x = h.x + h.facing * 14;
  if (x < sp.a + 4 || x > sp.b - 4) return null;
  if (solidsNear(W, x - 30, x + 30).some((s) => s.door && Math.abs(s.x + s.w / 2 - x) < 30)) return null;
  return { sp, x };
}
function startTunnelDoor(h) {
  const t = tunnelDoorSpot(h);
  if (!t) return;
  h.working = { kind: 'tdoor', t: 0, dur: PLY_TIME, sp: t.sp, x: t.x };
  h.vx = 0;
}
function buildTunnelDoor(h, D) {
  const W = G.W, f = tunFloor(W, D.sp, D.x), H = tunH(D.sp);
  addSolid(W, { type: 'plywood', door: true, x: D.x - 3, y: f - H, w: 6, h: H, hp: 2 });
  buildBuckets(W);
  feed(h.player.name + ' поставив двері з фанери — людина пройде, дрон ні', '#c9a36a');
}
function takePack(h, p) {
  const k = p.pack, got = [];
  if (k.weapon && !h.weapon) { h.weapon = k.weapon; k.weapon = null; h.reloadT = 0; got.push(WEAPONS[h.weapon.type].name.toLowerCase()); }
  if (k.detector && !h.detector && packUsed(h) < PACK_CAP) { h.detector = true; k.detector = false; got.push('детектор'); }
  while (k.medkits > 0 && h.medkits < MEDKIT_MAX && packUsed(h) < PACK_CAP) { k.medkits--; h.medkits++; got.push('аптечка'); }
  while (k.reb > 0 && packUsed(h) < PACK_CAP) { k.reb--; h.reb++; got.push('РЕБ'); }
  if (!k.weapon && !k.detector && !k.medkits && !k.reb) p.taken = true;
  feed(h.player.name + ' забрав із рюкзака: ' + got.join(', '), '#9c9');
  Sfx.click();
}
// загиблий втрачає рюкзак (і зброю) — їх може підібрати інший
function dropPack(h) {
  const W = G.W, x = clamp(h.x, 20, W.width - 20);
  if (h.carry) dropCarry(h);
  if (h.mount) leaveMount(h);
  h.working = null; h.grenades = 0;
  if (h.canister) { h.canister = false; W.pickups.push({ type: 'fuel', x, y: surfaceY(W, x) }); }
  for (; h.cans > 0; h.cans--) W.pickups.push({ type: 'fuel', x: clamp(x + rand(-20, 20), 20, W.width - 20), y: h.y });
  const k = { weapon: h.weapon, medkits: h.medkits, reb: h.reb, detector: h.detector };
  h.weapon = null; h.medkits = 0; h.reb = 0; h.detector = false; h.digging = null; h.reloadT = 0; h.healT = 0;
  if (!k.weapon && !k.medkits && !k.reb && !k.detector) return;
  W.pickups.push({ type: 'pack', x, y: surfaceY(W, x), pack: k, life: 150, max: 150 });
  feed(h.player.name + ' втратив рюкзак — його можна підібрати', '#ccc');
}
function enterHide(h, sp) {
  if (h.carry) dropCarry(h);
  h.hidden = sp; h.vx = 0; h.vy = 0; h.onLadder = false; h.aiming = false; h.peek = false;
  h.hideAnim = { dir: 'in', t: 0, dur: 0.5, sp, fx: h.x, facing: h.facing };
  h.smokeT = 0;
  if (sp.bonus === 'aliosha') {
    sp.bonus = null; h.alCharges++;
    feed(h.player.name + ' знайшов захований бонус «Альоша»!', '#f2c94c');
  }
  Sfx.click();
}
function hideEntrance(h) {
  const sp = h.hidden;
  if (sp.type !== 'pipe') return { x: sp.x, y: sp.y };
  let best = null, bd = 1e9;
  for (const e of sp.exits) { const dd = Math.abs(e.tx - h.x); if (dd < bd) { bd = dd; best = { x: e.tx, y: e.ty }; } }
  return best;
}
function humanHidden(h, c, dt) {
  const sp = h.hidden;
  if (c.held('aim') && c.pressed('interact')) { placeNet(h); return; }
  backpackInput(h, c);
  tickHeal(h, c, dt, false);
  h.x = sp.x; h.y = sp.y;
  // з нори можна визирнути й стріляти: тримати «Позицію»
  h.peek = canPeek(sp) && !h.hideAnim && c.held('aim') && !c.pressed('interact');
  h.aiming = h.peek && !!h.weapon;
  if (h.peek) {
    if (c.cur.aimAngle !== undefined) setAimWorld(h, c.cur.aimAngle);
    else {
      if (c.pressed('left')) h.facing = -1;
      if (c.pressed('right')) h.facing = 1;
      const v = (c.held('down') ? 1 : 0) - (c.held('up') ? 1 : 0);
      h.aimA += v * 1.5 * dt;
    }
    if (sp.type === 'burrow') h.facing = -burrowDir(sp); // з лежачого ходу — лише назовні, не за спину
    const S = AIM_SECTOR[sp.type];
    h.aimA = clamp(h.aimA, S[0], S[1]); // з ями вниз не постріляєш, з бійниці — вузький сектор
    if (c.held('fire') && h.weapon && h.fireCd <= 0 && h.reloadT <= 0 && h.weapon.mag > 0) humanShoot(h, burrowMuzzle(h), sp.type);
  } else if (c.pressed('fire') && h.weapon && h.reloadT <= 0 && h.weapon.mag < Math.min(WEAPONS[h.weapon.type].mag, h.weapon.ammo)) startReload(h);
  if (c.pressed('interact') || (c.pressed('up') && !h.peek)) {
    h.hideAnim = { dir: 'out', t: 0, dur: 0.35, sp, facing: h.facing };
    h.hidden = null; h.peek = false; h.aiming = false; h.stance = 'crouch'; h.vy = 0; h.vx = 0;
    Sfx.click();
  }
  if (c.pressed('special')) activateReb(h);
}

// ---------- Тунелі й лопата (у кожного своя, безлімітна) ----------
function tipOnce(h, text) {
  if (h.player.bot) return; // ботам підказки не потрібні
  if (G.time - (h.tipT || -9) > 2.5) { h.tipT = G.time; feed(h.player.name + ': ' + text, '#ccc'); }
}
function digDirt(x, y) {
  if (RND() < 0.5) G.parts.push({ type: 'dust', x: x + rand(-6, 6), y: y - rand(4, 14), vx: rand(-60, 60), vy: rand(-90, -30), life: 0.5, max: 0.5, size: 5, dirt: true });
}
// завал (обвалене перекриття) біля людини: у тунелі — збоку, нагорі — під ногами в ямі
function rubbleAt(h, dir) {
  for (const sp of G.W.pipes) for (const br of sp.breaks || []) {
    if (br.fill <= 0.02) continue;
    const f = tunFloor(G.W, sp, h.x), top = f - br.fill * tunH(sp);
    if (h.x >= br.a - 2 && h.x <= br.b + 2 && Math.abs(h.y - top) < 6) return { sp, br };
    const side = dir ? [dir] : [-1, 1];
    for (const s of side) if (Math.abs(h.x + s * 12 - (s > 0 ? br.a : br.b)) < 8 && h.y > top + 4 && Math.abs(h.y - f) < 6) return { sp, br };
  }
  return null;
}
// розкопаний пролом без перекриття — залатати
function patchAt(h) {
  for (const sp of G.W.pipes) for (const br of sp.breaks || []) {
    if (br.fill > 0.4 || h.x < br.a - 26 || h.x > br.b + 26) continue;
    const g = gAt(G.W, h.x), f = tunFloor(G.W, sp, h.x);
    if (Math.abs(h.y - g) < 6 || Math.abs(h.y - f) < 6) return { sp, br };
  }
  return null;
}
function startRubble(h, r) { h.digging = { kind: 'rubble', sp: r.sp, br: r.br, t: 0 }; h.vx = 0; }
function startPatch(h, r) { h.digging = { kind: 'patch', sp: r.sp, br: r.br, t: 0, dur: 3 }; h.vx = 0; }
// уперся в кінець галереї або в завал — копати далі (лопата не зношується)
function tunnelDig(h, dir, dt) {
  const W = G.W;
  if (!h.onGround || !(h.wallT > 0)) return;
  const rb = rubbleAt(h, dir);
  if (rb) { digRubble(h, rb.br, dt); return; }
  const sp = pipeHere(W, h.x, h.y);
  if (!sp || Math.abs(h.y - tunFloor(W, sp, h.x)) > 5) return;
  const hw = HUMAN_DIM[h.stance].w / 2;
  if (dir > 0 ? h.x + hw < sp.b - 6 : h.x - hw > sp.a + 6) return; // ще не в кінці
  if (!sp.path) toPath(W, sp); // далі тунель — ламана: риється під кутом, незалежно від рельєфу
  if (dir > 0 && sp.b < h.x) { sp.path.push([h.x, h.y]); sp.b = h.x; } else if (dir < 0 && sp.a > h.x) { sp.path.unshift([h.x, h.y]); sp.a = h.x; } // стоїть на майданчику під спуском
  const end = dir > 0 ? sp.b : sp.a;
  const lim = dir < 0 ? 20 : W.width - 20;
  const d = Math.min(DIG_SPD * dt, Math.abs(lim - end));
  if (d <= 0) return;
  const nx = end + dir * (d + 4);
  if (rockIn(nx - 2, nx + 2)) { tipOnce(h, 'Камінь — лопатою не прокопати. [' + h.player.ctrl.label('dig') + '] — вихід тут'); return; }
  // новий кінець: униз чи вгору під кутом h.digAng (додатний — униз)
  const P = sp.path, k = Math.tan(clamp(h.digAng || 0, -DIG_MAX, DIG_MAX)), last = dir > 0 ? P[P.length - 1] : P[0], prev = dir > 0 ? P[P.length - 2] : P[1];
  const ny = last[1] + k * d, nxe = last[0] + dir * d, ks = dir > 0 ? k : -k;
  if (prev && Math.abs((last[1] - prev[1]) / ((last[0] - prev[0]) || 1) - ks) < 0.02 && Math.abs(last[0] - prev[0]) < 64) { last[0] = nxe; last[1] = ny; } // той самий нахил — подовжити відрізок
  else if (dir > 0) P.push([nxe, ny]); else P.unshift([nxe, ny]);
  if (dir < 0) sp.a = nxe; else sp.b = nxe;
  h.digT = 0.2; h.anim += dt * 6;
  digDirt(end + dir * 6, tunFloor(W, sp, end));
  cavDirty(W);
  // над стелею лишилось надто мало ґрунту — стеля провалюється
  if (ny - tunH(sp) - gAt(W, nxe) < MIN_COVER) caveIn(sp, nxe, h);
  // людина йде за вибоєм рівно, без смикання (і по схилу — за підлогою галереї)
  const fx = (dir > 0 ? sp.b : sp.a) - dir * (hw + 0.5);
  if ((fx - h.x) * dir > 0) { h.x = fx; h.y = tunFloor(W, sp, h.x); }
  h.vx = 0;
  joinCavities(sp, dir);
}
// тунель переходить у ламану (з того, як підлога йшла під рельєфом)
function toPath(W, sp) {
  const pts = [];
  if (sp.b - sp.a < 2) { const f = tunFloor(W, sp, sp.a); pts.push([sp.a, f], [sp.a + 2, f]); sp.b = sp.a + 2; }
  else { for (let x = sp.a; x < sp.b; x += 24) pts.push([x, tunFloor(W, sp, x)]); pts.push([sp.b, tunFloor(W, sp, sp.b)]); }
  sp.path = pts;
  cavDirty(W);
}
// обвал стелі біля поверхні: відкрита яма, засипана наполовину
function caveIn(sp, x, h) {
  const W = G.W;
  if ((sp.breaks || []).some((q) => x > q.a - 30 && x < q.b + 30)) return;
  const br = { a: x - 24, b: x + 24, fill: 0.45 };
  (sp.breaks || (sp.breaks = [])).push(br);
  (sp.caved || (sp.caved = [])).push({ a: br.a, b: br.b });
  cavDirty(W);
  const f = tunFloor(W, sp, x);
  for (let i = 0; i < 16; i++) G.parts.push({ type: 'debris', x: rand(br.a, br.b), y: f - tunH(sp) + rand(0, 10), vx: rand(-90, 90), vy: rand(-200, -20), life: rand(0.6, 1.1), max: 1.1, col: '#5a4630' });
  for (let i = 0; i < 5; i++) G.parts.push({ type: 'dust', x: rand(br.a, br.b), y: f - 20, vx: rand(-20, 20), vy: rand(-40, -10), life: rand(1, 1.8), max: 1.8, size: rand(10, 16) });
  if (h && !h.dead) hurt(h, 10, 'blast');
  feed('Стеля обвалилася — надто близько до поверхні', '#f2994a');
}
function digRubble(h, br, dt) {
  br.fill = Math.max(0, br.fill - dt * 0.28);
  h.digT = 0.2; h.anim += dt * 6;
  digDirt(h.x + h.facing * 10, h.y);
  cavDirty(G.W);
  if (br.fill <= 0.02) { br.fill = 0; tipOnce(h, 'Завал розкопано — тепер залатати перекриття [' + h.player.ctrl.label('dig') + ']'); }
}
// прокопав до іншої порожнини (тунель, колектор, спуск) — з'єднати
function joinCavities(sp, dir) {
  const W = G.W, end = dir > 0 ? sp.b : sp.a, f = tunFloor(W, sp, end), H = tunH(sp);
  if (sp.links && sp.links.some((l) => end >= l.x1 - 2 && end <= l.x2 + 2)) return true; // перехід уже є
  for (const o of W.pipes) {
    if (o === sp) continue;
    const iv = [];
    pipeSpans(W, o, end + dir * 3, iv, false);
    const hit = iv.find(([t, b]) => t < f && b > f - H); // їхня порожнина перетинається з нашою галереєю
    if (!hit) continue;
    // та сама глибина (у тому числі вліз у їхній спуск) — один тунель
    const ins = end + dir * 3;
    if (!sp.path && !o.path && o.depth === sp.depth && ins >= o.a - 60 && ins <= o.b + 60) { if (dir > 0) sp.b = Math.max(sp.b, o.a); else sp.a = Math.min(sp.a, o.b); mergeTunnels(sp, o); return true; }
    // інша глибина — похилий перехід від нашої підлоги до їхньої
    const fo = Math.min(hit[1], f + 200), dx = Math.max(12, Math.abs(fo - f) / 0.8);
    const l = dir > 0 ? { x1: end - 4, x2: end + dx, y1: f, y2: fo } : { x1: end - dx, x2: end + 4, y1: fo, y2: f };
    l.h = Math.max(H, tunH(o)) + 16; // на схилі потрібен запас над головою
    (sp.links || (sp.links = [])).push(l);
    if (dir > 0) sp.b = Math.max(sp.b, end); else sp.a = Math.min(sp.a, end);
    cavDirty(W);
    feed('Прокопано до сусіднього ходу', '#c8a26a');
    return true;
  }
  return false;
}
function mergeTunnels(sp, o) {
  sp.a = Math.min(sp.a, o.a); sp.b = Math.max(sp.b, o.b);
  sp.exits.push(...o.exits);
  if (o.links) (sp.links || (sp.links = [])).push(...o.links);
  if (o.caved) (sp.caved || (sp.caved = [])).push(...o.caved);
  if (o.known) sp.known = Object.assign(sp.known || {}, o.known);
  sp.wood = sp.wood || o.wood;
  if (o.breaks) (sp.breaks || (sp.breaks = [])).push(...o.breaks);
  G.W.hides = G.W.hides.filter((x) => x !== o);
  // командний режим: об'єкт-тунель, що злився, тепер — частина іншого
  if (G.objs) {
    const oo = G.objs.find((x) => x.ref === o);
    if (oo) { if (G.objs.some((x) => x.ref === sp)) G.objs = G.objs.filter((x) => x !== oo); else Object.assign(oo, { ref: sp, x: (sp.a + sp.b) / 2, pad: null }); }
  }
  cavDirty(G.W);
  feed('Тунелі з\'єднано', '#c8a26a');
}
// над виходом щось стоїть (стіна, будівля, техніка) — там не вилізти
function exitBlocked(W, e) {
  const list = solidsNear(W, e.tx - 20, e.tx + 20);
  for (const s of list) if (!s.thin && s.x < e.tx + 14 && s.x + s.w > e.tx - 14 && s.y < e.ty + 2 && s.y + s.h > e.ty - 50) return true;
  return W.vehicles.some((v) => !v.dead && Math.abs(v.x - e.tx) < VEH[v.type].len / 2 + 10);
}
// новий вихід нагору з галереї: на краю, лицем назовні — пологий спуск, інакше — лаз із драбиною
// недокопаний вихід поруч — копати далі
function resumeDig(h) {
  for (const sp of G.W.pipes) for (const e of sp.exits) {
    if (exitDone(e)) continue;
    const fx = e.up === 'above' ? lerp(e.tx, e.bx, e.prog) : e.kind === 'shaft' ? e.tx : lerp(e.bx, e.tx, e.prog);
    if (Math.abs(fx - h.x) > 40 || Math.abs(h.y - lerp(e.by, e.ty, e.up === 'above' ? 1 - e.prog : e.prog)) > 70) continue;
    const dur = e.len / DIG_SPD;
    h.digging = { kind: e.up === 'above' ? 'entry' : 'exit', sp, e, t: e.prog * dur, dur, resumed: true };
    h.vx = 0;
    return true;
  }
  return false;
}
function startDigExit(h, sp) {
  const W = G.W;
  if (resumeDig(h)) return;
  if (Math.abs(h.y - tunFloor(W, sp, h.x)) > 6) { tipOnce(h, 'Копати вихід — стоячи в галереї'); return; }
  const edge = (h.facing < 0 && h.x <= sp.a + 14) || (h.facing > 0 && h.x >= sp.b - 14);
  let kind = edge ? 'ramp' : 'shaft';
  let e = tunExitGeo(W, sp, { x: edge ? (h.facing > 0 ? sp.b : sp.a) : h.x, dir: h.facing, kind });
  if (kind === 'ramp' && rockIn(Math.min(e.bx, e.tx) - 6, Math.max(e.bx, e.tx) + 6)) { kind = 'shaft'; e = tunExitGeo(W, sp, { x: h.x, dir: h.facing, kind }); } // на пологий спуск не вистачає місця — лаз
  if (sp.exits.some((o) => Math.abs(o.tx - e.tx) < 34)) { tipOnce(h, 'Поруч уже є вихід'); return; }
  if (rockIn(e.tx - 14, e.tx + 14)) { tipOnce(h, 'Там камінь — не прокопати'); return; }
  if (exitBlocked(W, e)) { tipOnce(h, 'Нагорі щось заважає копати'); return; }
  e.prog = 0; e.up = 'below'; sp.exits.push(e); cavDirty(W);
  h.digging = { kind: 'exit', sp, e, t: 0, dur: e.len / DIG_SPD };
  h.vx = 0;
}
// ---------- Лопата: стрілка напрямку, рівномірне копання смуги будь-де ----------
// Пологий напрямок (до DIG_MAX) — прохід, яким ходять; крутіший — вертикальний лаз одразу з драбиною (угору чи вниз).
const DIG_TOOL_SPD = 22, MAX_DIG_DEPTH = TUN_DEPTH + 72 * 3 + 40;
function startDigMode(h) {
  if (h.vehicle || h.hidden || h.mount || h.onLadder || !h.onGround || h.carry || h.player.bot) return; // боти лопатою не копають
  h.digMode = true; h.digA = h.digA || 0; h.vx = 0; h.aiming = false; h.digHost = null; h.digHeld = 0;
  tipOnce(h, 'Лопата: поки тримаєш ' + h.player.ctrl.label('dig') + ' — копає; ' + h.player.ctrl.label('up') + h.player.ctrl.label('down') + ' — напрямок, ' + h.player.ctrl.label('left') + h.player.ctrl.label('right') + ' — бік; відпусти — сховати');
}
function digModeTick(h, c, dt) {
  if (!c.held('dig') || c.pressed('interact') || c.pressed('aim') || h.dead || h.vehicle || h.hidden) { h.digMode = false; h.digHost = null; return; }
  h.digHeld = (h.digHeld || 0) + dt;
  h.vx = 0;
  if (c.pressed('left')) { h.facing = -1; h.digHost = null; }
  if (c.pressed('right')) { h.facing = 1; h.digHost = null; }
  const v = (c.held('down') ? 1 : 0) - (c.held('up') ? 1 : 0);
  if (v) { const was = Math.abs(h.digA || 0) > DIG_MAX + 0.01; h.digA = clamp((h.digA || 0) + v * 1.3 * dt, -Math.PI / 2, Math.PI / 2); if (was !== Math.abs(h.digA) > DIG_MAX + 0.01) h.digHost = null; }
  if (h.digHeld < 0.25 && !c.held('fire') || !h.onGround && !h.onLadder) return; // мить — щоб навести стрілку, далі копає сама
  const d = DIG_TOOL_SPD * dt, a = h.digA || 0;
  h.digT = 0.2; h.anim += dt * 6;
  if (Math.abs(a) <= DIG_MAX + 0.01) digCorridor(h, h.facing, Math.tan(a), d);
  else digShaft(h, a > 0, d);
}
// пологий прохід: подовжити свій (чи той, у кінці якого стоїш) або почати новий просто з-під ніг
function digCorridor(h, dir, k, d) {
  const W = G.W, hw = HUMAN_DIM[h.stance].w / 2;
  let sp = h.digHost && h.digHost.path && W.hides.includes(h.digHost) && h.digHost.kind !== 'shaft' ? h.digHost : null;
  if (sp && (dir > 0 ? h.x < sp.b - 40 : h.x > sp.a + 40)) sp = null;
  if (!sp) { const f = atDigFace(h); if (f && (f.path || true)) sp = f; }
  if (!sp) {
    // нова смуга — від ніг людини в бік погляду
    const x0 = h.x + dir * hw, y0 = h.y;
    if (rockIn(x0 - 4, x0 + 4)) { tipOnce(h, 'Камінь — лопатою не прокопати'); return; }
    const P = dir > 0 ? [[x0, y0], [x0 + 1, y0 + k]] : [[x0 - 1, y0 + k], [x0, y0]];
    sp = { type: 'pipe', style: 'dug', dug: true, a: P[0][0], b: P[1][0], depth: Math.max(0, y0 - gAt(W, x0)), exits: [], path: P };
    W.hides.push(sp); cavDirty(W);
    if (isTeam()) addTunnelObj(sp);
  }
  h.digHost = sp;
  if (!sp.path) toPath(W, sp);
  const P = sp.path, last = dir > 0 ? P[P.length - 1] : P[0], prev = dir > 0 ? P[P.length - 2] : P[1];
  const nxe = clamp(last[0] + dir * d, 20, W.width - 20), ny = last[1] + k * Math.abs(nxe - last[0]);
  if (Math.abs(nxe - last[0]) < 0.01) return;
  if (rockIn(nxe - 2, nxe + 2)) { tipOnce(h, 'Камінь — лопатою не прокопати'); return; }
  if (ny - gAt(W, nxe) > MAX_DIG_DEPTH) { tipOnce(h, 'Глибше не прокопати — ґрунтові води'); return; }
  if (k < 0 && ny < gAt(W, nxe) + 2) { tipOnce(h, 'Вийшли на поверхню'); h.digMode = false; return; }
  const ks = dir > 0 ? k : -k;
  if (prev && Math.abs((last[1] - prev[1]) / ((last[0] - prev[0]) || 1) - ks) < 0.02 && Math.abs(last[0] - prev[0]) < 64) { last[0] = nxe; last[1] = ny; }
  else if (dir > 0) P.push([nxe, ny]); else P.unshift([nxe, ny]);
  if (dir > 0) sp.b = nxe; else sp.a = nxe;
  digDirt(nxe, ny - 8);
  cavDirty(W);
  const cover = ny - tunH(sp) - gAt(W, nxe);
  if (k < 0 && cover >= 0 && cover < MIN_COVER) {
    if (-k >= DIG_EXIT * 0.98) { // круто вгору — пробився нагору: відкритий вихід, без обвалу
      if (!(sp.breaks || []).some((q) => nxe > q.a - 20 && nxe < q.b + 20)) {
        // схил виходу доводимо до самої поверхні — нагору виходять пішки
        let ex = nxe, ey = ny;
        while (ey > gAt(W, ex) && ex > 22 && ex < W.width - 22) { ex += dir * 2; ey += k * 2; }
        if (dir > 0) { P.push([ex, gAt(W, ex)]); sp.b = ex; } else { P.unshift([ex, gAt(W, ex)]); sp.a = ex; }
        (sp.breaks || (sp.breaks = [])).push({ a: Math.min(nxe, ex) - 16, b: Math.max(nxe, ex) + 4, fill: 0 });
        cavDirty(W); feed(h.player.name + ' прокопав вихід нагору', '#c8a26a');
      }
      h.digMode = false; h.digHost = null;
    } else caveIn(sp, nxe, h); // полого під саму поверхню — стеля провалюється
  }
  // людина йде за вибоєм
  const fx = (dir > 0 ? sp.b : sp.a) - dir * (hw + 0.5);
  if ((fx - h.x) * dir > 0) { h.x = fx; h.y = tunFloor(W, sp, h.x); h.onGround = true; h.vy = 0; }
  joinCavities(sp, dir);
}
// вертикальний лаз одразу з драбиною: униз — людина лишається нагорі (над лазом кришка), угору — внизу
function digShaft(h, down, d) {
  const W = G.W;
  let J = h.digHost && h.digHost.kind === 'shaft' && h.digHost.down === down && W.hides.includes(h.digHost.sp) ? h.digHost : null;
  if (J && Math.abs(J.e.tx - h.x) > 20) J = null;
  if (!J) { // стоїть у лазі, що вже є, — копати його далі
    for (const p of W.pipes) for (const e of p.exits) if (e.kind === 'shaft' && Math.abs(e.tx - h.x) < 14 && h.y > e.ty - 8 && h.y < e.by + 8 && (down ? Math.abs(h.y - e.by) < 10 : true) && !J) J = h.digHost = { kind: 'shaft', down, sp: p, e, top0: e.ty };
  }
  if (!J) {
    const x = clamp(h.x, 20, W.width - 20), g = gAt(W, x), surf = h.y <= g + 4;
    if (rockIn(x - 14, x + 14)) { tipOnce(h, 'Камінь — лопатою не прокопати'); return; }
    if (!down && surf) { tipOnce(h, 'Угору з поверхні не копають'); return; }
    if (W.ladders.some((l) => Math.abs(l.x - x) < 26 && h.y > l.top - 6 && h.y < l.bottom + 6)) { tipOnce(h, 'Тут уже є лаз'); return; }
    const e = down ? { kind: 'shaft', inner: !surf, x, tx: x, ty: surf ? g : h.y, bx: x, by: h.y + 6, dir: 1, len: 6 }
      : { kind: 'shaft', inner: true, x, tx: x, ty: h.y - 6, bx: x, by: h.y, dir: 1, len: 6 };
    if (!down) { const cs = cavSpans(W, x).find((q) => h.y - 2 >= q.top && h.y - 2 <= q.bot + 1); if (cs && cs.top > -1e8) e.ty = Math.min(e.ty, cs.top + 2); } // угору — від стелі свого ходу
    const sp = { type: 'pipe', style: 'dug', dug: true, a: x, b: x, depth: 0, exits: [e], path: [[x, e.by], [x, e.by]] };
    W.hides.push(sp); cavDirty(W);
    J = h.digHost = { kind: 'shaft', down, sp, e, top0: e.ty };
  }
  const e = J.e, x = e.tx;
  if (down) {
    const nb = e.by + d;
    if (nb - gAt(W, x) > MAX_DIG_DEPTH) { tipOnce(h, 'Глибше не прокопати — ґрунтові води'); return; }
    if (!dirtAt(W, x, nb + 9) && nb - e.ty > 30) { tipOnce(h, 'Лаз дійшов до порожнини'); return; }
    e.by = nb; e.len = e.by - e.ty; if (J.sp.b - J.sp.a < 1) J.sp.path = [[x, e.by], [x, e.by]];
    digDirt(x, e.by - 4);
    h.x = x; h.y = e.by; h.onLadder = false; h.onGround = true; h.vy = 0; h.stance = 'crouch'; // на дні лазу
  } else {
    const nt = e.ty - d, g = gAt(W, x);
    if (nt - 12 <= g) { e.ty = g; e.inner = false; e.len = e.by - e.ty; cavDirty(W); feed(h.player.name + ' прокопав лаз нагору', '#c8a26a'); h.digHost = null; h.digMode = false; return; }
    if (nt < (J.top0 || e.by) - 6 && !dirtAt(W, x, nt - 9)) { e.ty = nt; cavDirty(W); tipOnce(h, 'Лаз дійшов до порожнини'); h.digHost = null; return; }
    e.ty = nt; e.len = e.by - e.ty;
    digDirt(x, e.ty + 6);
    cavDirty(W); h.x = x; h.onLadder = true; h.y = Math.min(e.by, e.ty + 58); h.vy = 0; h.stance = 'stand'; // на драбині під самим верхом
  }
  cavDirty(W);
}
// ---------- Копання вглиб: із галереї — похилий спуск на поверх нижче (кілька поверхів) ----------
const LEVEL_D = 72, LEVEL_SLOPE = 0.8, MAX_LEVELS = 4;
const ROLL_T = 0.3, FLIP_T = 0.5; // кувирок по землі й сальто в стрибку
const DIG_MAX = Math.PI / 4, MIN_COVER = 7, DIG_EXIT = Math.tan(Math.PI / 6); // до 45° — прохід (сходинками); понад 30° угору — вихід без обвалу // найкрутіше риття, яким ще ходять; менше ґрунту над стелею — обвал
// тунель, на підлозі якого стоїть людина (на спуску між поверхами — той, до чиєї підлоги ближче)
function pipeHere(W, x, y) {
  let best = null, bd = 7;
  for (const sp of W.pipes) {
    if (x < sp.a - 6 || x > sp.b + 6) continue;
    const d = Math.abs(tunFloor(W, sp, x) - y);
    if (d < bd) { bd = d; best = sp; }
  }
  return best || pipeAt(W, x, y);
}
// людина біля кінця галереї лицем до ґрунту (там риють далі) — тунель або null
function atDigFace(h) {
  if (!h.onGround || h.vehicle || h.hidden) return null;
  const W = G.W, sp = pipeHere(W, h.x, h.y);
  if (!sp || Math.abs(h.y - tunFloor(W, sp, h.x)) > 6) return null;
  const hw = HUMAN_DIM[h.stance].w / 2;
  return (h.facing > 0 ? h.x + hw >= sp.b - 8 : h.x - hw <= sp.a + 8) ? sp : null;
}
function startDigDown(h, sp) {
  const W = G.W;
  if (Math.abs(h.y - tunFloor(W, sp, h.x)) > 6) { tipOnce(h, 'Копати вглиб — стоячи в галереї'); return; }
  const f = tunFloor(W, sp, h.x);
  if (f + LEVEL_D - gAt(W, h.x) > TUN_DEPTH + LEVEL_D * (MAX_LEVELS - 1) + 40) { tipOnce(h, 'Глибше не прокопати — ґрунтові води'); return; }
  if (rockIn(h.x - 16, h.x + 16)) { tipOnce(h, 'Там камінь — не прокопати'); return; }
  if (W.ladders.some((l) => Math.abs(l.x - h.x) < 40 && l.top < f + 6 && l.bottom > f + 10)) { tipOnce(h, 'Поруч уже є лаз униз'); return; }
  h.working = { kind: 'down', t: 0, dur: (LEVEL_D / DIG_SPD) * 1.4, sp, x0: h.x, f, dir: h.facing };
  h.vx = 0;
}
function buildDigDown(h, D) {
  const W = G.W, sp = D.sp;
  if (!W.hides.includes(sp)) return;
  const x = D.x0, fLow = D.f + LEVEL_D;
  // нижче вже є хід на цій глибині — лаз до нього, інакше — нова камера (далі її риють у боки під кутом)
  let o = W.pipes.find((p) => p !== sp && x >= p.a - 20 && x <= p.b + 20 && Math.abs(tunFloor(W, p, clamp(x, p.a, p.b)) - fLow) < 16);
  if (!o) { o = { type: 'pipe', style: 'dug', a: x - 26, b: x + 26, depth: fLow - gAt(W, x), exits: [], dug: true, path: [[x - 26, fLow], [x + 26, fLow]] }; W.hides.push(o); }
  else if (x < o.a || x > o.b) { if (!o.path) toPath(W, o); if (x < o.a) { o.path.unshift([x - 10, tunFloor(W, o, o.a)]); o.a = x - 10; } else { o.path.push([x + 10, tunFloor(W, o, o.b)]); o.b = x + 10; } }
  const fl = tunFloor(W, o, x);
  o.exits.push({ kind: 'shaft', inner: true, x, tx: x, ty: D.f, bx: x, by: fl, dir: 1, len: fl - D.f });
  cavDirty(W);
  feed(h.player.name + ' прокопав лаз із драбиною на поверх нижче', '#c8a26a');
}
// що зробить лопата тут (dry — лише перевірити)
function digAction(h, ditch, dry) {
  const W = G.W, pa = pipeHere(W, h.x, h.y);
  if (h.vehicle || h.hidden || h.mount || h.onLadder) return false;
  const ed = ditchEdge(h);
  if (ed) {
    if (!dry) {
      if (ditch || bridgeOk(ed)) { h.working = { kind: 'fill', t: 0, dur: FILL_TIME, d: ed }; h.vx = 0; }
      else { h.working = { kind: 'bridge', t: 0, dur: BRIDGE_TIME, d: ed }; h.vx = 0; }
    }
    return true;
  }
  if (ditch) {
    if (!canDitchHere(h)) { if (!dry) tipOnce(h, 'Рову тут не викопати: потрібне рівне вільне місце'); return false; }
    if (!dry) { const [a, b] = ditchSpan(h); h.working = { kind: 'ditch', t: 0, dur: DITCH_TIME, a, b }; h.vx = 0; }
    return true;
  }
  if (rubbleAt(h)) { if (!dry) startRubble(h, rubbleAt(h)); return true; }
  if (patchAt(h)) { if (!dry) startPatch(h, patchAt(h)); return true; }

  if (h.stance !== 'stand' && canFortHere(h)) { if (!dry) startFort(h); return true; }
  return false;
}
// новий спуск із поверхні в бік погляду: якщо внизу вже є тунель чи колектор — до нього
function startDigEntry(h) {
  const W = G.W, dx = TUN_DEPTH / TUN_K;
  let bx = clamp(h.x + h.facing * dx, 30, W.width - 30);
  let sp = W.pipes.find((o) => bx >= o.a - 40 && bx <= o.b + 40 && !(o.breaks || []).some((q) => bx > q.a - 10 && bx < q.b + 10));
  if (sp) bx = clamp(bx, sp.a, sp.b);
  const fresh = !sp;
  if (fresh) sp = { type: 'pipe', style: 'dug', a: bx, b: bx, depth: TUN_DEPTH, exits: [], dug: true };
  const e = tunExitGeo(W, sp, { x: bx, dir: -h.facing, kind: 'ramp' });
  if (!fresh && sp.exits.some((o) => Math.abs(o.tx - e.tx) < 34)) { tipOnce(h, 'Поруч уже є вхід у тунель'); return; }
  if (rockIn(Math.min(e.bx, e.tx, bx) - 6, Math.max(e.bx, e.tx, bx) + 6)) { tipOnce(h, 'Тут камінь — не прокопати'); return; }
  if (fresh) W.hides.push(sp);
  sp.a = Math.min(sp.a, bx); sp.b = Math.max(sp.b, bx);
  e.prog = 0; e.up = 'above'; sp.exits.push(e); cavDirty(W);
  h.digging = { kind: 'entry', sp, e, fresh, bx, t: 0, dur: e.len / DIG_SPD };
  h.vx = 0; h.stance = 'crouch';
}
// можна копати тут із поверхні?
function canDigHere(h) {
  const W = G.W;
  if (h.vehicle || h.hidden || !h.onGround || h.canister) return false;
  if (Math.abs(h.y - gAt(W, h.x)) > 3) return false; // на перекритті чи на даху — ні
  if (W.pipes.some((sp) => sp.exits.some((e) => Math.abs(e.tx - h.x) < 34))) return false;
  if (W.hides.some((sp) => sp.type !== 'pipe' && Math.abs(sp.x - h.x) < 50)) return false;
  return !solidsNear(W, h.x - 40, h.x + 40).some((s) => !s.thin && s.x < h.x + 30 && s.x + s.w > h.x - 30 && s.y < h.y + 2 && s.y + s.h > h.y - 30);
}
function tickDig(h, c, dt) {
  const D = h.digging, W = G.W;
  // відійти — перервати копання
  if (c.pressed('left') || c.pressed('right') || c.pressed('up')) { h.digging = null; tipOnce(h, D.kind === 'patch' ? 'Латання перервано' : 'Копання перервано'); return; }
  h.digT = 0.2; h.anim += dt * 6;
  if (D.kind === 'rubble') { digRubble(h, D.br, dt); if (D.br.fill <= 0) h.digging = null; return; }
  D.t = Math.min(D.dur, D.t + dt);
  if (D.e && !exitDone(D.e)) {
    // вибій посувається поступово; людина йде слідом (спуском — униз, виходом — угору)
    D.e.prog = D.t / D.dur; cavDirty(W);
    const e = D.e, hw = HUMAN_DIM[h.stance].w / 2;
    if (e.kind === 'ramp') {
      const face = e.up === 'above' ? lerp(e.tx, e.bx, e.prog) : lerp(e.bx, e.tx, e.prog), d = e.up === 'above' ? -e.dir : e.dir;
      const fx = face - d * (hw + 3);
      if ((fx - h.x) * d > 0 && Math.abs(fx - h.x) < 30) { h.x = fx; h.facing = d; }
    }
  }
  if (D.kind === 'patch') {
    if (RND() < dt * 6) G.parts.push({ type: 'debris', x: rand(D.br.a, D.br.b), y: gAt(W, h.x) + 4, vx: rand(-40, 40), vy: rand(-80, -20), life: 0.5, max: 0.5, col: '#6b4a2b' });
  } else digDirt(D.kind === 'entry' ? h.x + h.facing * 12 : h.x + D.e.dir * 10, D.kind === 'entry' ? h.y : h.y - 10);
  if (D.t < D.dur) return;
  h.digging = null;
  const sp = D.sp, e = D.e;
  if (D.kind === 'patch') {
    sp.breaks = sp.breaks.filter((q) => q !== D.br);
    cavDirty(W);
    // хто стояв у пролом — у перекриття не вмурувати
    for (const o of G.humans) if (!o.dead && pipeAt(W, o.x, o.y) === sp && !earthFits(o.x, o.y, HUMAN_DIM[o.stance])) o.stance = 'crouch';
    feed(h.player.name + ' залатав перекриття тунелю', '#c8a26a');
  } else if (D.kind === 'exit') {
    delete e.prog; cavDirty(W);
    feed(h.player.name + ' прокопав ' + (e.kind === 'ramp' ? 'пологий вихід' : 'лаз із драбиною'), '#c8a26a');
  } else {
    delete e.prog; cavDirty(W);
    feed(h.player.name + (D.fresh ? ' викопав спуск — далі можна копати галерею' : ' прокопав вхід у тунель'), '#c8a26a');
    if (D.fresh && isTeam()) addTunnelObj(sp);
  }
}
// ---------- Обвали: багато вибухів в одному місці руйнують перекриття ----------
function damageTunnels(x, y, power) {
  const W = G.W;
  for (const sp of W.pipes.slice()) {
    if (x < sp.a - 10 || x > sp.b + 10) continue;
    const g = gAt(W, x), f = tunFloor(W, sp, x), ceil = f - tunH(sp);
    const dy = y < g ? g - y : y > f ? y - f : 0; // над тунелем — відстань до поверхні; у тунелі — 0
    if (dy > 45) continue;
    if (y < f - tunH(sp) && ceil - g > (power >= 70 ? 48 : 28)) continue; // глибоко під землею — вибух на поверхні не дістає
    if (sp.breaks && sp.breaks.some((q) => x > q.a - 24 && x < q.b + 24)) continue; // тут уже відкрито
    if (!sp.wood && sp.caved && sp.caved.some((q) => x > q.a - 24 && x < q.b + 24)) continue; // уже обвалювалося — ґрунт осів, удруге не завалює
    const k = Math.round(x / 40), dmg = sp.dmg || (sp.dmg = {});
    dmg[k] = (dmg[k] || 0) + (power >= 70 ? 1 : 0.6);
    if (dmg[k] >= BREAK_HITS) { dmg[k] = 0; if (sp.wood) holeTunnel(sp, clamp(k * 40, sp.a, sp.b), ceil); else collapseTunnel(sp, clamp(k * 40, sp.a, sp.b), ceil); }
  }
}
// дерев'яне перекриття (захоплений хід): вибухи пробивають дошки — пробоїну латають, як будівлю
function holeTunnel(sp, cx, ceil) {
  const W = G.W, br = { a: Math.max(sp.a, cx - 24), b: Math.min(sp.b, cx + 24), fill: 0, hole: true };
  (sp.breaks || (sp.breaks = [])).push(br);
  cavDirty(W);
  for (const h of G.humans) if (!h.dead && !h.saved && !h.vehicle && h.x > br.a - 8 && h.x < br.b + 8 && h.y > ceil - 4) hurt(h, 25, 'blast');
  for (let i = 0; i < 14; i++) G.parts.push({ type: 'debris', x: rand(br.a, br.b), y: ceil, vx: rand(-150, 150), vy: rand(-280, -60), life: rand(0.6, 1.1), max: 1.1, col: i % 2 ? '#7a5532' : '#5a4630' });
  feed('Перекриття ходу пробито — можна залатати', '#f2994a');
}
function collapseTunnel(sp, cx, ceil) {
  const W = G.W;
  let a = Math.max(sp.a, cx - 30), b = Math.min(sp.b, cx + 30);
  const br = { a, b, fill: 1 };
  sp.breaks = (sp.breaks || []).filter((q) => {
    if (q.b < a - 4 || q.a > b + 4) return true;
    br.a = Math.min(br.a, q.a); br.b = Math.max(br.b, q.b); return false;
  });
  sp.breaks.push(br);
  (sp.caved || (sp.caved = [])).push({ a: br.a, b: br.b });
  cavDirty(W);
  for (const h of G.humans) {
    if (h.dead || h.saved || h.vehicle || h.x < br.a - 8 || h.x > br.b + 8 || h.y < ceil - 4) continue;
    hurt(h, 70, 'blast'); // засипало
  }
  for (let i = 0; i < 18; i++) G.parts.push({ type: 'debris', x: rand(br.a, br.b), y: ceil + rand(0, 20), vx: rand(-120, 120), vy: rand(-260, -40), life: rand(0.6, 1.2), max: 1.2, col: '#5a4630' });
  for (let i = 0; i < 6; i++) G.parts.push({ type: 'smoke', x: rand(br.a, br.b), y: ceil, vx: rand(-20, 20), vy: rand(-50, -10), life: rand(1.5, 2.5), max: 2.5, size: rand(14, 24) });
  feed('Перекриття тунелю обвалилося — треба розкопати й залатати', '#f2994a');
}

function enterVehicle(h, v) {
  if (h.carry) dropCarry(h);
  if (v.hasMG && !v.gunner && (v.driver || wantsGun(h, v))) { v.gunner = h; h.seat = 'gunner'; }
  else { v.driver = h; h.seat = 'driver'; }
  h.vehicle = v; h.stance = 'stand'; h.onLadder = false; h.aiming = false;
  // сів за кермо порожньої техніки — заправити з рюкзака
  if (h.seat === 'driver' && v.fuel <= 0.5) useCan(h, v);
  Sfx.click();
}
// каністра з рюкзака — у бак
function useCan(h, v) {
  if (!h || !(h.cans > 0)) return false;
  const tank = VEH[v.type].tank;
  v.fuel = Math.min(tank, v.fuel + tank * 0.6); h.cans--;
  feed(h.player.name + ' заправив ' + VEH[v.type].name + ' з каністри', '#f2c94c');
  return true;
}
// підійшов ззаду до техніки з кулеметом — стати за кулемет (а не за кермо)
function wantsGun(h, v) { return v.hasMG && (h.x - v.x) * v.dir < -4; }
// точка кріплення кулемета у світі
function vehGunPos(v) {
  const T = VEH[v.type], g = T.gun || [-T.len * 0.15, -T.h - 15], c = Math.cos(v.ang || 0), s = Math.sin(v.ang || 0);
  const lx = g[0] * v.dir, ly = g[1];
  return { x: v.x + lx * c - ly * s, y: v.y + lx * s + ly * c };
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
  // [1] — пересісти: за кермом → до кулемета (або [Вогонь]), біля кулемета → за кермо
  if (h.seat === 'driver' && v.hasMG && !v.gunner && (c.pressed('slot1') || c.pressed('fire'))) {
    v.driver = null; v.gunner = h; h.seat = 'gunner'; v.input = 0; v.brake = false; h.aimA = -0.35; h.facing = v.dir; h.fireCd = 0.25; Sfx.click(); return;
  }
  if (h.seat === 'gunner' && !v.driver && c.pressed('slot1')) { v.gunner = null; v.driver = h; h.seat = 'driver'; h.aiming = false; Sfx.click(); return; }
  const T = VEH[v.type];
  if (h.seat === 'driver') {
    v.input = c.axisX; h.facing = v.dir;
    v.brake = c.held('aim'); // пробіл — гальмо
    v.lean = v.type === 'moto' ? (c.held('up') ? -1 : c.held('down') ? 1 : 0) : 0; // ↑ — на заднє колесо / у повітрі носом угору
  }
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
    if (v.mgMag == null) v.mgMag = Math.min(WEAPONS.mg.mag, v.mgAmmo);
    if (v.mgReload > 0 && (v.mgReload -= dt) <= 0) { v.mgReload = 0; v.mgMag = Math.min(WEAPONS.mg.mag, v.mgAmmo); Sfx.click(); }
    if (c.held('fire') && v.mgMag > 0 && !(v.mgReload > 0) && h.fireCd <= 0) {
      const gp = vehGunPos(v), aw = aimWorld(h), mx = gp.x + Math.cos(aw) * 30, my = gp.y + Math.sin(aw) * 30;
      fireWeapon(h, mx, my, 'mg', aw, Math.abs(v.vx) > 30, 'mount');
      h.fireCd = WEAPONS.mg.rate;
      v.mgMag--;
      if (--v.mgAmmo <= 0) feed('Кулемет: набої скінчилися', '#ccc');
      else if (v.mgMag <= 0) { v.mgReload = WEAPONS.mg.reload; Sfx.click(); }
    }
  }
  h.x = v.x; h.y = v.y;
  if (c.pressed('special')) activateReb(h);
  checkShelter(h);
}

function checkShelter(h) {
  if (G.mode === 'team') return; // у командному режимі укриття немає — є бази
  const S = G.W.shelter;
  if (h.x > S.x - 8 && h.x < S.x + 40 && h.y > S.y - 30) {
    if (G.mode === 'dm') {
      // дезматч: +3 очки за укриття, далі знову зі старту
      const who = h.vehicle ? [h.vehicle.driver, h.vehicle.gunner].filter(Boolean) : [h];
      if (h.vehicle) { const v = h.vehicle; for (const o of who) exitVehicle(o); v.vx = 0; }
      for (const o of who) { o.player.score += 3; feed(o.player.name + ' дістався укриття: +3', '#6fcf97'); o.x = randomSpawnX(); o.y = gAt(G.W, o.x); o.vx = 0; o.vy = 0; }
      Sfx.win();
      return;
    }
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
  if (h.protT > 0) return; // захист одразу після відновлення
  if (h.alT > 0 && (src === 'blast' || src === 'mine' || src === 'head')) return; // «Альоша» не боїться вибухів
  // бронежилет: уламки й вибухова хвиля шкодять набагато менше (крім влучання в голову)
  if (h.armor > 0 && src === 'blast') {
    const ab = dmg * 0.65;
    dmg -= ab; h.armor -= ab * 0.6;
    if (h.armor <= 0) { h.armor = 0; feed(h.player.name + ': бронежилет зруйновано', '#ccc'); }
  }
  h.hp -= dmg; h.hurtT = 0.4;
  if (h.hp <= 0) {
    h.hp = 0; h.dead = true; h.alT = 0;
    if (src === 'blast' || src === 'mine' || src === 'head') gibHuman(h, src); // в епіцентрі — на шматки, трохи далі — відриває частину
    if (h.piloting) { const dp = G.dps.find((x) => x.temp && x.human === h); if (dp) endPilot(dp); }
    if (h.vehicle) exitVehicle(h, true);
    h.hidden = null; h.hideAnim = null; h.stance = 'prone';
    dropPack(h);
    h.deaths++; G.stats.deaths++;
    // очко дронщику, чий вибух убив
    if (G.blastBy && (src === 'blast' || src === 'mine' || src === 'head') && !allyP(G.blastBy, h.player)) G.blastBy.score += 3;
    if ((src === 'melee' || src === 'bullet') && h.lastHitBy && !allyP(h.lastHitBy, h.player)) { h.lastHitBy.score += 3; feed(h.lastHitBy.name + (src === 'melee' ? ' переміг ' + h.player.name + ' у рукопашній' : ' застрелив ' + h.player.name), '#eb5757'); }
    h.lives--;
    if (h.lives > 0) {
      h.respawnT = RESPAWN_TIME;
      feed(h.player.name + ' загинув' + (h.lives < 99 ? ' — залишилось життів: ' + h.lives : ''), '#eb5757');
    } else feed(h.player.name + ' загинув остаточно', '#eb5757');
  }
}
// відновлення: з останньої схованки чи будівлі з маскувальною сіткою, інакше зі старту
const RESPAWN_ZONE = 3000; // перші 300 м від старту
// випадкове вільне місце на поверхні в перших 300 м (від старту — у бік укриття)
function startZoneX() {
  const W = G.W, dir = W.shelter ? Math.sign(W.shelter.x - W.start.x) || 1 : 1;
  for (let t = 0; t < 40; t++) {
    const x = clamp(W.start.x + dir * rand(0, RESPAWN_ZONE), 60, W.width - 60), g = gAt(W, x);
    if (W.ditches.some((d) => x > d.a - 30 && x < d.b + 30) || rockIn(x - 12, x + 12)) continue;
    if (solidsNear(W, x - 30, x + 30).some((s) => !s.thin && s.x < x + 14 && s.x + s.w > x - 14 && s.y < g && s.y + s.h > g - 60)) continue;
    if (G.fires && G.fires.some((f) => Math.abs(f.x - x) < f.w / 2 + 40)) continue;
    return x;
  }
  return W.start.x;
}
function respawnHuman(h) {
  const W = G.W, sp = h.spawn;
  Object.assign(h, { kit: null, gasmask: false, lost: null, gibbed: false, dead: false, hp: 100, stance: 'stand', vx: 0, vy: 0, armor: 0, weapon: null, hidden: null, vehicle: null, seat: null,
    gasT: 0, smokeT: 0, reveal: 0, openTime: 0, diving: false, climb: null, onLadder: false, aiming: false, hideAnim: null, hurtT: 0, stamina: 1, exhausted: false, protT: 3, tun: null, digging: null, carry: null, mount: null, working: null, grenades: Math.max(1, h.grenades) });
  if (G.mode === 'team') { h.hidden = null; teamRespawn(h); }
  else if (sp && sp.hide && !sp.hide.ruined) { h.x = sp.hide.x; h.y = sp.hide.y; h.hidden = sp.hide; }
  else if (sp && sp.bld) { h.x = sp.x; h.y = sp.y; }
  else if (sp && sp.pos) { h.x = sp.x; h.y = gAt(W, sp.x); }
  else { h.x = G.mode === 'dm' ? randomSpawnX() : startZoneX(); h.y = gAt(W, h.x); }
  h.onGround = true; h.healT = 0; h.canister = false;
  for (const d of G.drones) if (d.lockOn === h) d.lockOn = null;
  feed(h.player.name + ' повернувся в гру', '#6fcf97');
}

// розліт тіла на шматки від вибуху: голова в шоломі, тулуб, руки, ноги + бризки
const GIB_FULL_R = 28, GIB_PART_R = 85; // епіцентр — тіло на шматки; ближче за GIB_PART_R — відриває одну частину
function gibHuman(h, src) {
  const b = G.lastBlast || { x: h.x, y: h.y + 20, power: 100 };
  const H = HUMAN_DIM[h.stance].h, cy = h.y - H * 0.5;
  const d = dist(b.x, b.y, h.x, cy);
  const full = src === 'head' || (src === 'blast' && d < GIB_FULL_R);
  if (!full && src === 'blast' && d > GIB_PART_R) return; // далеко — тіло ціле
  const HY = { head: -0.85, torso: -0.45, arm: -0.6, leg: -0.15 };
  const k = clamp(b.power / 110, 0.7, 1.2);
  const fly = (kind, sp) => {
    const px = h.x + rand(-5, 5), py = h.y + H * HY[kind];
    let dx = px - b.x, dy = py - b.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    G.parts.push({ type: 'gib', kind, x: px, y: py, vx: dx * sp + rand(-35, 35), vy: Math.min(dy * sp, 0) - rand(110, 200), rot: rand(0, 6.28), spin: rand(-10, 10),
      life: 9, max: 9, col: h.player.color, facing: h.facing, blood: 0.5 });
  };
  if (!full) {
    // відірвало одну кінцівку чи голову; тіло лишається
    const kind = src === 'mine' ? 'leg' : pick(['head', 'arm', 'arm', 'leg', 'leg']);
    h.lost = kind; fly(kind, rand(90, 170) * k);
    for (let i = 0; i < 10; i++) G.parts.push({ type: 'debris', x: h.x + rand(-6, 6), y: h.y + H * HY[kind], vx: rand(-140, 140), vy: rand(-200, -30), life: rand(0.4, 0.9), max: 0.9, col: '#8a1c1c' });
    return;
  }
  h.gibbed = true;
  for (const kind of ['head', 'torso', 'arm', 'arm', 'leg', 'leg']) fly(kind, rand(140, 260) * k * (kind === 'torso' ? 0.6 : 1));
  for (let i = 0; i < 18; i++) G.parts.push({ type: 'debris', x: h.x + rand(-8, 8), y: cy + rand(-12, 12), vx: rand(-260, 260), vy: rand(-340, -40), life: rand(0.5, 1.1), max: 1.1, col: RND() < 0.7 ? '#8a1c1c' : '#5d6c3b' });
}

// ---------- Маскувальна сітка ----------
function buildingAt(x, y) {
  for (const b of G.W.backs) if (!b.ruined && x > b.x + 10 && x < b.x + b.w - 10 && y > b.y && y <= b.y + b.h + 4) return b;
  return null;
}
// пройшов бліндаж, нору чи окоп — звідти й відродишся (сітка не потрібна; далі вперед — нова точка)
function cpProgress(x) { const W = G.W; return W.shelter ? -Math.abs(W.shelter.x - x) : 0; }
function spawnX(sp) { return sp.hide ? sp.hide.x : sp.x; }
function passCheckpoint(h) {
  if (G.mode === 'team' || h.vehicle || h.hidden && h.hidden.type === 'pipe') return;
  const W = G.W, cur = h.spawn && !(h.spawn.hide && h.spawn.hide.ruined) ? h.spawn : null;
  let found = null;
  if (h.hidden && h.hidden.type !== 'pipe') found = { hide: h.hidden };
  else {
    for (const sp of W.hides) if (sp.type !== 'pipe' && !sp.ruined && Math.abs(h.x - sp.x) < 40 && Math.abs(h.y - sp.y) < 40) { found = { hide: sp }; break; }
    if (!found && h.onGround) for (const c of W.covers) if (c.type === 'trench' && h.x > c.x && h.x < c.x + c.w && h.y > c.y) { found = { pos: true, x: clamp(h.x, c.x + 10, c.x + c.w - 10), y: h.y, cv: c }; break; }
  }
  if (!found) return;
  const same = cur && (found.hide ? cur.hide === found.hide : cur.cv === found.cv);
  if (same) return;
  if (cur && W.shelter && cpProgress(spawnX(found)) < cpProgress(spawnX(cur))) return; // позаду — точку не переносимо
  h.spawn = found;
  feed(h.player.name + ': точка відродження — ' + (found.hide ? (found.hide.type === 'bunker' ? 'бліндаж' : 'нора') : 'окоп'), '#9c9');
}
// натягнути сітку на вхід у бліндаж/нору або в будівлі; там же — точка відновлення
function placeNet(h) {
  if (h.nets <= 0) { feed(h.player.name + ': маскувальні сітки скінчилися', '#ccc'); return; }
  const sp = h.hidden && h.hidden.type !== 'pipe' ? h.hidden : null;
  let target = sp;
  if (!target) for (const x of G.W.hides) if (x.type !== 'pipe' && !x.ruined && Math.abs(h.x - x.x) < 34 && Math.abs(h.y - x.y) < 40) { target = x; break; }
  if (target && isTeam() && target.type === 'bunker' && !hideOwnedBy(target, h.player.team)) { feed('Спершу захопіть цей бліндаж', '#ccc'); return; }
  if (target) {
    if (target.net) { h.spawn = { hide: target }; feed('Тут уже є сітка — точку відновлення збережено', '#9c9'); return; }
    target.net = true; h.nets--; h.spawn = { hide: target };
    feed(h.player.name + ' натягнув маскувальну сітку на ' + (target.type === 'bunker' ? 'бліндаж' : 'нору'), '#9c9');
    Sfx.click(); return;
  }
  const b = buildingAt(h.x, h.y);
  if (b && isTeam() && !hideOwnedBy(b, h.player.team)) { feed('Спершу захопіть цю будівлю (15 с усередині)', '#ccc'); return; }
  if (b) {
    if (!b.net) { b.net = true; b.ply = PLY_PER_NET; h.nets--; feed(h.player.name + ' натягнув сітку в будівлі — можна укріплювати: фанера на вікна, вогневі позиції', '#9c9'); Sfx.click(); }
    h.spawn = { bld: b, x: h.x, y: h.y };
    return;
  }
  feed('Сітку можна натягнути на вхід у бліндаж, нору або в будівлі', '#ccc');
}
// дрон «завис» поруч — лише так видно сітку
function droneHovering(d, x, y) {
  return !!d && dist(d.x, d.y, x, y) < 150 && Math.hypot(d.vx, d.vy) < 140;
}

// ---------- Стрільба ----------
// постріл уздовж кута прицілу (без автоприцілу — влучати треба самому)
function fireWeapon(h, ox, oy, type, base, moving, stance) {
  const Wp = WEAPONS[type];
  // розкид: положення тіла × рух × «віддача» від частої стрільби
  const spread = Wp.spread * (STANCE_SPREAD[stance] || 1) * (moving ? 1.8 : 1) * (1 + (h.bloom || 0)) * (h.hipMul || 1);
  h.bloom = Math.min(1.5, (h.bloom || 0) + (Wp.pellets > 1 ? 0.5 : 0.22));
  for (let i = 0; i < Wp.pellets; i++) {
    const a = base + (RND() * 2 - 1) * spread;
    G.bullets.push({ x: ox, y: oy, vx: Math.cos(a) * Wp.speed, vy: Math.sin(a) * Wp.speed, life: (Wp.range / Wp.speed) * rand(0.9, 1.1), owner: h, dmg: Wp.dmg || 50 });
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
        if (dist(b.x, b.y, d.x, d.y) >= DRONE_R + 3 || ally(b.owner, d)) continue;
        hit = true;
        if (!d.inverted) {
          d.inverted = true; d.lix = -(d.lix || 0); d.liy = -(d.liy || 0);
          for (let k = 0; k < 6; k++) G.parts.push({ type: 'spark', x: b.x, y: b.y, vx: rand(-120, 120), vy: rand(-140, 20), life: 0.35, max: 0.35 });
          Sfx.tone(1400, 0.03, 0.05);
          if (b.owner && b.owner.player) feed(b.owner.player.name + ' влучив у дрон — керування збилося (інверсія)', '#56ccf2');
        }
        else shootDownDrone(d, b.owner);
        break;
      }
      // командний режим: кулі влучають у ворожих людей (кілька влучань — смерть)
      if (!hit && isTeam() && b.owner) for (const o of G.humans) {
        if (o.dead || o.saved || covered(o) || o.vehicle || o.protT > 0 || allyP(o.player, b.owner.player)) continue;
        if (rectDist(b.x, b.y, humanRect(o)) > 1) continue;
        hit = true; o.lastHitBy = b.owner.player;
        hurt(o, b.dmg * (o.armor > 0 ? 0.6 : 1), 'bullet');
        for (let k = 0; k < 4; k++) G.parts.push({ type: 'debris', x: b.x, y: b.y, vx: rand(-80, 80) + b.vx * 0.05, vy: rand(-120, 20), life: 0.4, max: 0.4, col: '#a1202a' });
        break;
      }
      if (!hit && G.ugvs) for (const u of G.ugvs) {
        if (u.dead || rectDist(b.x, b.y, ugvRect(u)) > 1) continue;
        if (b.owner && b.owner.player.team === u.team) continue; // свої кулі НРК не зачіпають
        hit = true; hurtUgv(u, 5, b.owner && b.owner.player);
        G.parts.push({ type: 'spark', x: b.x, y: b.y, vx: rand(-90, 90), vy: rand(-120, 0), life: 0.25, max: 0.25 });
        break;
      }
      if (!hit) for (let mi = G.mines.length - 1; mi >= 0; mi--) {
        const m = G.mines[mi];
        if (dist(b.x, b.y, m.x, m.y - 3) < 9) { hit = true; G.mines.splice(mi, 1); G.blastBy = null; mineExplode(m.x, m.y); feed('Міну підірвано пострілом', '#f2994a'); break; }
      }
    }
    if (hit) G.bullets.splice(i, 1);
  }
}

// ---------- РЕБ ----------
function activateReb(h) {
  if (h.reb <= 0) return;
  if (h.rebCd > 0) { if (G.time - (h.rebMsgT || -9) > 1.5) { h.rebMsgT = G.time; feed(h.player.name + ': РЕБ перезаряджається — ще ' + Math.ceil(h.rebCd) + ' с', '#bb86fc'); } return; }
  h.reb--; h.rebCd = REB_CD;
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
    const inp = v.driver && v.fuel > 0 && !v.immob && !v.brake ? v.input : 0;
    if (!v.driver) { v.brake = false; v.lean = 0; }
    if (v.type === 'moto') motoTilt(v, T, inp, dt);
    if (v.immob && RND() < dt * 4) G.parts.push({ type: 'smoke', x: v.x + rand(-20, 20), y: v.y - 10, vx: rand(-10, 10), vy: -30, life: 1.4, max: 1.4, size: 8 });
    if (v.air) { /* у повітрі газ і гальмо не діють */ }
    else if (inp) {
      v.vx = approach(v.vx, inp * T.max, T.acc * dt); v.dir = inp;
      v.fuel -= dt;
      if (v.fuel <= 0) { v.fuel = 0; if (!useCan(v.driver, v) && !useCan(v.gunner, v)) feed(T.name + ': пальне скінчилося', '#f2994a'); }
    } else v.vx = approach(v.vx, 0, (v.brake ? 950 : v.driver ? 300 : 260) * dt);
    if (v.type === 'moto' && !v.air) v.vx += GRAV * Math.sin(v.ang || 0) * 0.55 * dt; // схил: униз розганяє, угору гальмує
    if (v.brake && Math.abs(v.vx) > 120 && RND() < dt * 30) G.parts.push({ type: 'dust', x: v.x - v.dir * T.len * 0.35, y: v.y - 3, vx: v.dir * 30, vy: -15, life: 0.6, max: 0.6, size: 7 });
    const nx = clamp(v.x + v.vx * dt, 30, W.width - 30);
    let ny = gAt(W, nx), blocked = false;
    // на дибках мотоцикл заїжджає на невисокі перешкоди; із перешкоди — з'їжджає
    const climb = v.type === 'moto' ? (Math.abs(v.vx) > 40 ? ((v.tilt || 0) < -0.3 ? 66 : 46) : 16) : v.type === 'quad' && Math.abs(v.vx) > 60 ? 24 : 10;
    if (v.type === 'moto' && !v.air && Math.abs(v.vx) > 60) {
      const fx = nx + Math.sign(v.vx) * (T.len / 2 + 18);
      if (solidsNear(W, fx - 12, fx + 12).some((s) => !s.thin && !s.dead && s.x < fx + 12 && s.x + s.w > fx - 12 && s.y < ny - 10 && s.y > ny - 66) || gAt(W, fx) < ny - 14) v.tilt = Math.min(v.tilt || 0, -0.32);
    }
    const rammed = [];
    for (const s of solidsNear(W, nx - T.len / 2, nx + T.len / 2)) {
      if (s.thin || s.dead || s.x >= nx + T.len / 2 || s.x + s.w <= nx - T.len / 2) continue;
      if (s.y >= v.y - 3 && s.y < ny) { ny = s.y; continue; } // опора під колесами (переправа, верх перешкоди)
      if (!(s.y < ny - 12 && s.y + s.h > ny - T.h)) continue; // не на рівні корпусу
      if (ny - s.y <= climb || (v.y <= s.y + 3 && s.y < ny)) { ny = Math.min(ny, s.y); continue; } // заїхати зверху
      if (RAMMABLE[s.type] && Math.abs(v.vx) > 150) { rammed.push(s); continue; } // на швидкості — проламати
      blocked = true; break;
    }
    if (rammed.length && !blocked) ramObstacles(v, rammed);
    if (v.dead) continue;
    if (blocked) {
      if (Math.abs(v.vx) > 250) { for (const o of [v.driver, v.gunner]) if (o) hurt(o, 8); }
      v.vx = 0;
    } else {
      v.x = nx;
      if (v.type === 'moto') motoVertical(v, T, ny, dt);
      else if (ny > v.y + 2) { v.vy = (v.vy || 0) + GRAV * dt; v.y = Math.min(ny, v.y + v.vy * dt); } // з'їхав з перешкоди — падає
      else { v.y = ny; v.vy = 0; }
    }
    if (v.dead) continue;
    if (!v.air) v.ang = v.y < gAt(W, v.x) - 3 && v.type !== 'moto' ? 0 : motoGroundAng(v, T);
    if (v.susp) v.susp = Math.max(0, v.susp - dt * 30);
    if ((v.hp < T.hp || v.rams) && RND() < dt * 8) G.parts.push({ type: 'smoke', x: v.x, y: v.y - T.h, vx: rand(-10, 10), vy: -40, life: 1.6, max: 1.6, size: 10 });
    if (v.driver && Math.abs(v.vx) > 100 && RND() < dt * 20) G.parts.push({ type: 'dust', x: v.x - v.dir * T.len / 2, y: v.y - 4, vx: -v.dir * 40, vy: -20, life: 0.8, max: 0.8, size: 8 });
  }
}
// кут опори під колесами (земля, переправа, верх перешкоди)
function vehSupportY(W, x, y) {
  let g = gAt(W, x);
  for (const s of solidsNear(W, x - 2, x + 2)) if (!s.thin && !s.dead && s.x <= x && s.x + s.w >= x && s.y >= y - 14 && s.y < g) g = s.y;
  return g;
}
function motoGroundAng(v, T) {
  const W = G.W, a = vehSupportY(W, v.x - T.len / 2, v.y), b = vehSupportY(W, v.x + T.len / 2, v.y);
  return Math.atan2(b - a, T.len);
}
// мотоцикл: нахил — пружина з інерцією. Газ із місця підкидає перед, гальмо на швидкості — на переднє колесо;
// ↑/↓ — переносити вагу. У повітрі ↑/↓ обертають мотоцикл, без керування він сам вирівнюється до горизонту
function motoTilt(v, T, inp, dt) {
  const lean = v.driver ? v.lean || 0 : 0;
  let tq;
  if (v.air) {
    // ↑/↓ крутять мотоцикл (можна й на 360°); без керування він сам вирівнюється до найближчого «на колеса»
    const world = v.ang + v.dir * (v.tilt || 0), wn = Math.atan2(Math.sin(world), Math.cos(world));
    tq = lean * 11 + (lean ? 0 : -wn * v.dir * 5);
    v.tiltV = ((v.tiltV || 0) + tq * dt) * Math.pow(lean ? 0.6 : 0.35, dt);
    v.tiltV = clamp(v.tiltV, -9, 9);
    v.tilt = (v.tilt || 0) + v.tiltV * dt;
    v.spinAcc = (v.spinAcc || 0) + v.tiltV * dt;
    return;
  }
  const spd = Math.abs(v.vx);
  tq = -(v.tilt || 0) * 26 - (v.tiltV || 0) * 7;                              // гравітація повертає на обидва колеса
  if (lean < 0 && (spd > 25 || inp)) tq += -9 * Math.min(1, (spd + 60) / 160);  // дибки
  if (lean > 0 && spd > 40) tq += 6;                                         // на переднє колесо
  if (inp && Math.sign(inp) === Math.sign(v.vx || inp) && spd < T.max * 0.3) tq -= 2.5; // різкий газ — передок трохи вгору
  if (v.brake && spd > 120) tq += 5;                                         // різке гальмо — клює носом
  v.tiltV = (v.tiltV || 0) + tq * dt;
  v.tilt = (v.tilt || 0) + v.tiltV * dt;
  if (v.tilt < -0.8) { v.tilt = -0.8; v.tiltV = Math.max(0, v.tiltV); }
  if (v.tilt > 0.42) { v.tilt = 0.42; v.tiltV = Math.min(0, v.tiltV); }
}
// мотоцикл по вертикалі: справжня інерція — з горба на швидкості злітає, падає за параболою
function motoVertical(v, T, ny, dt) {
  const vy0 = v.vy || 0;
  if (!v.air) {
    // на землі: вертикальна швидкість — та, з якою колеса йдуть рельєфом (угору — обмежено, щоб сходинка не катапультувала)
    if (ny <= v.y + vy0 * dt + GRAV * dt * dt + 0.5) { v.vy = Math.max((ny - v.y) / dt, -Math.abs(v.vx) * 0.75, -520); v.y = ny; return; }
    v.air = v.y < ny - 4 || vy0 < -60; // рельєф іде вниз швидше, ніж падає мотоцикл — відрив
    if (!v.air) { v.vy = (ny - v.y) / dt; v.y = ny; return; }
    v.tiltV = 0;
    v.ang = clamp(Math.atan2(vy0 * v.dir, Math.abs(v.vx) + 1), -0.7, 0.7); // у повітря — під кутом траєкторії
  }
  v.vy = vy0 + GRAV * dt;
  v.y += v.vy * dt;
  if (v.y < ny) return;
  // приземлення: наскільки кут мотоцикла не збігся з рельєфом і наскільки сильно вдарився
  v.y = ny; v.air = false;
  const ga = motoGroundAng(v, T), world = v.ang + v.dir * (v.tilt || 0), d0 = world - ga, diff = Math.atan2(Math.sin(d0), Math.cos(d0)), hit = v.vy, spun = Math.abs(v.spinAcc || 0);
  v.ang = ga; v.tilt = clamp(diff * v.dir, -0.8, 0.42); v.tiltV = 0; v.vy = 0; v.spinAcc = 0;
  if (Math.abs(diff) > 2.1 && v.driver) { // упав на спину — вершник летить, втрачає 30% життя
    const rider = v.driver; v.vx *= 0.2; v.tilt = 0;
    exitVehicle(rider, true); hurt(rider, 30, 'fall'); feed(rider.player.name + ' упав на спину з мотоцикла', '#f2994a');
    v.rams = Math.max(v.rams || 0, 1); Sfx.boom(false); return;
  }
  if (spun > 5.6 && Math.abs(diff) < 1.35 && v.driver) feed(v.driver.player.name + ': сальто на мотоциклі' + (spun > 11.5 ? ' ×' + Math.floor(spun / 6.28) : '') + '!', '#f2c94c');
  v.susp = Math.min(9, hit / 90);
  if (hit > 300) for (let i = 0; i < 6; i++) G.parts.push({ type: 'dust', x: v.x + rand(-T.len / 2, T.len / 2), y: v.y - 3, vx: rand(-90, 90), vy: rand(-60, -20), life: 0.7, max: 0.7, size: 8 });
  const rider = v.driver;
  if (Math.abs(diff) > 1.35 || hit > 1400) {
    // упав: вершник летить, мотоцикл пошкоджено
    v.vx *= 0.25; v.tilt = 0;
    if (rider) { exitVehicle(rider, true); hurt(rider, 22 + Math.max(0, hit - 900) / 25, 'fall'); feed(rider.player.name + ' не втримався на мотоциклі', '#f2994a'); }
    if (hit > 1250 || Math.abs(diff) > 1.5) { v.crashSmoke = true; v.rams = Math.max(v.rams || 0, 1); }
    Sfx.boom(false);
  } else {
    if (Math.abs(diff) > 0.8) v.vx *= 0.75;            // криво приземлився — загубив швидкість
    if (rider && hit > 850) hurt(rider, (hit - 850) / 30, 'fall');
  }
}
// таран: перешкода руйнується; техніка без тарана — пошкоджена, після другої перешкоди — розбита
const RAMMABLE = { hay: 1, log: 1, block: 1, sandbag: 1, wreck: 1, rubble: 1, bridge: 0 };
function ramObstacles(v, list) {
  const W = G.W, T = VEH[v.type];
  for (const s of list) {
    s.dead = true;
    for (let i = 0; i < 14; i++) G.parts.push({ type: 'debris', x: s.x + rand(0, s.w), y: s.y + rand(0, s.h), vx: v.dir * rand(60, 320), vy: rand(-320, -60), life: rand(0.6, 1.2), max: 1.2, col: s.type === 'hay' ? '#c9a74b' : s.type === 'log' ? '#6b4e2e' : '#7b736a' });
  }
  W.solids = W.solids.filter((s) => !s.dead); buildBuckets(W);
  Sfx.boom(false);
  v.vx *= 0.55;
  const occ = [v.driver, v.gunner].filter(Boolean);
  if (v.ram) { feed(T.name + ' проламав перешкоду тараном', '#c9a36a'); return; }
  v.rams = (v.rams || 0) + 1;
  if (v.rams >= 2) { destroyVehicle(v); occ.forEach((o) => hurt(o, 45, 'blast')); feed(T.name + ' розбито об перешкоду', '#f2994a'); }
  else { v.hp = Math.min(v.hp, Math.max(1, T.hp - 1)); v.crashSmoke = true; occ.forEach((o) => hurt(o, 10, 'fall')); feed(T.name + ' пошкоджено: ще одна перешкода — і кінець', '#f2994a'); }
}
// ---------- Протитанковий рів і переправа ----------
const DITCH_W = 270, DITCH_D = 130, DITCH_TIME = 8, BRIDGE_TIME = 5, FILL_TIME = 10;
function ditchAt(x) { return G.W.ditches.find((d) => x > d.a && x < d.b) || null; }
function bridgeOk(d) { return d.bridge && !d.bridge.dead && G.W.solids.includes(d.bridge); }
function ditchSpan(h) { const a = h.facing > 0 ? h.x + 18 : h.x - 18 - DITCH_W; return [a, a + DITCH_W]; }
function canDitchHere(h) {
  const W = G.W;
  if (h.vehicle || h.hidden || !h.onGround || Math.abs(h.y - gAt(W, h.x)) > 3) return false;
  const [a, b] = ditchSpan(h);
  if (a < 150 || b > W.width - 150) return false;
  if (maxGround(W, a, b) - minGround(W, a, b) > 24) return false;
  if (W.pipes.some((sp) => b > sp.x0 - 30 && a < sp.x1 + 30) || rockIn(a - 10, b + 10)) return false;
  if (W.ditches.some((d) => b > d.a - 60 && a < d.b + 60)) return false;
  if (W.hides.some((sp) => sp.type !== 'pipe' && sp.x > a - 40 && sp.x < b + 40)) return false;
  if (W.covers.some((c) => c.type === 'trench' && c.x < b + 30 && c.x + c.w > a - 30)) return false;
  if (W.vehicles.some((v) => v.x > a - 60 && v.x < b + 60) || W.pads.some((p) => p.x > a - 80 && p.x < b + 80) || (W.shelter && W.shelter.x > a - 200 && W.shelter.x < b + 100)) return false;
  return !solidsNear(W, a - 20, b + 20).some((s) => s.x < b + 20 && s.x + s.w > a - 20 && s.y < gAt(W, s.x + s.w / 2) + 2);
}
function buildDitch(h, D) {
  const W = G.W, a = D.a, b = D.b, g = minGround(W, a, b), i0 = Math.max(0, Math.floor(a / GS)), orig = W.ground.slice(i0, Math.ceil(b / GS) + 1);
  for (let i = Math.max(0, Math.floor(a / GS)); i <= Math.min(W.ground.length - 1, Math.ceil(b / GS)); i++) {
    const e = Math.min(i * GS - a, b - i * GS);
    W.ground[i] = Math.max(W.ground[i], g + DITCH_D * clamp(e / 10, 0, 1)); // майже прямовисні стінки
  }
  W.ditches.push({ a, b, g, bridge: null, i0, orig });
  cavDirty(W);
  for (const pk of W.pickups) if (pk.x > a && pk.x < b) pk.y = surfaceY(W, pk.x);
  for (const pr of W.props) if (pr.x > a && pr.x < b) pr.y = surfaceY(W, pr.x);
  for (const mi of G.mines) if (mi.x > a && mi.x < b) mi.y = gAt(W, mi.x);
  feed(h.player.name + ' викопав протитанковий рів', '#c8a26a');
}
// на краю рову: лопата — переправа, біг+лопата (чи вже з переправою) — засипати
function ditchEdge(h) {
  if (h.vehicle || h.hidden || !h.onGround || h.stance === 'prone' || h.onLadder) return null;
  for (const d of G.W.ditches) if (((h.x > d.a - 40 && h.x < d.a + 4) || (h.x < d.b + 40 && h.x > d.b - 4)) && Math.abs(h.y - d.g) < 10) return d;
  return null;
}
function bridgeSpot(h) { const d = ditchEdge(h); return d && !bridgeOk(d) ? d : null; }
// засипати рів: ґрунт повертається, переправа вже не потрібна
function fillDitch(h, d) {
  const W = G.W;
  if (!W.ditches.includes(d)) return;
  for (let i = Math.max(0, Math.floor(d.a / GS) - 1); i <= Math.min(W.ground.length - 1, Math.ceil(d.b / GS) + 1); i++) {
    const o = d.orig && d.orig[i - d.i0];
    W.ground[i] = o != null ? o : Math.min(W.ground[i], d.g);
  }
  if (d.bridge) { W.solids = W.solids.filter((s) => s !== d.bridge); buildBuckets(W); }
  W.ditches = W.ditches.filter((q) => q !== d);
  cavDirty(W);
  for (const pk of W.pickups) if (pk.x > d.a && pk.x < d.b) pk.y = surfaceY(W, pk.x);
  for (const pr of W.props) if (pr.x > d.a && pr.x < d.b) pr.y = surfaceY(W, pr.x);
  for (const mi of G.mines) if (mi.x > d.a && mi.x < d.b) mi.y = gAt(W, mi.x);
  for (const o of G.humans) if (!o.dead && !o.vehicle && o.x > d.a && o.x < d.b && o.y > gAt(W, o.x)) { o.y = gAt(W, o.x); o.vy = 0; }
  feed((h ? h.player.name : 'Хтось') + ' засипав протитанковий рів', '#c8a26a');
}
function buildBridge(h, d) {
  const W = G.W, s = { type: 'bridge', x: d.a - 14, y: d.g - 3, w: d.b - d.a + 28, h: 9, hp: 3 };
  W.solids.push(s); buildBuckets(W);
  d.bridge = s;
  feed(h.player.name + ' збудував переправу через рів', '#c9a36a');
}
// у рів — не вибратися: люди гинуть, техніка розбивається
function updateDitches() {
  const W = G.W;
  if (!W.ditches.length) return;
  for (const h of G.humans) {
    if (h.dead || h.saved || h.vehicle || h.hidden) continue;
    const d = ditchAt(h.x);
    if (d && h.x > d.a + 4 && h.x < d.b - 4 && h.y > d.g + 45) { hurt(h, 999, 'fall'); feed(h.player.name + ' загинув у рову', '#f2994a'); }
  }
  for (const v of W.vehicles) {
    if (v.dead) continue;
    const d = ditchAt(v.x);
    if (d && v.y > d.g + 25) {
      const occ = [v.driver, v.gunner].filter(Boolean);
      destroyVehicle(v); occ.forEach((o) => hurt(o, 999, 'fall'));
      feed(VEH[v.type].name + ' впав у рів', '#f2994a');
    }
  }
}
// ---------- Майстерня: мангал (захист від скидів) або таран (проламувати перешкоди) ----------
const KIT_NAMES = { cage: 'мангал (захист від скидів)', ram: 'передній ковш (проламувати перешкоди)' };
// бокс — перший поверх будинку з майстернею; обладнання ставлять лише на техніку, що заїхала в бокс
function garageOf(v) { return G.W.shops.find((s) => !s.b.ruined && v.x > s.b.x + 16 && v.x < s.b.x + s.b.w - 16 && Math.abs(v.y - (s.b.y + s.b.h)) < 10) || null; }
function nearShop(h) {
  return G.W.shops.find((s) => !s.b.ruined && Math.abs(s.x - h.x) < 30 && Math.abs(s.y - h.y) < 12) || null;
}
function kitVehicle(h) {
  return h.kit ? G.W.vehicles.find((v) => !v.dead && garageOf(v) && Math.abs(v.x - h.x) < VEH[v.type].len / 2 + 18 && Math.abs(v.y - h.y) < 40) || null : null;
}
function takeKit(h) {
  h.kit = h.kit === 'cage' ? 'ram' : 'cage';
  feed(h.player.name + ' взяв ' + KIT_NAMES[h.kit] + ' — встановити на техніку', '#c9a36a');
  Sfx.click();
}
function destroyVehicle(v) {
  v.dead = true; v.burn = 14; v.vx = 0;
  for (const o of [v.driver, v.gunner]) if (o) exitVehicle(o, true);
  feed(VEH[v.type].name + ' знищено', '#f2994a');
}

// ---------- Дрони ----------
// майданчик старту: не ближче 500 px до живих людей (окрім базового №1)
// точки злету, доступні цьому дронщику (у командному режимі — своєї команди й захоплені об'єкти)
function padsOf(dp) { return dp.fixedPad ? [dp.fixedPad] : G.mode === 'team' ? teamPads(dp.player.team) : G.W.pads; }
function curPad(dp) { const L = padsOf(dp); return L[dp.pad] || L[0]; }
// майданчик не ближче 500 px до живих людей (ворожих); перший — завжди
function padOk(dp, i) {
  const p = padsOf(dp)[i];
  if (!p) return false;
  if (i === 0) return true;
  return !G.humans.some((h) => !h.dead && !h.saved && !allyP(h.player, dp.player) && Math.abs(h.x - p.x) < 500);
}
// автовибір: найближчий до цілей майданчик, але не впритул до них
function autoPad(dp) {
  const L = padsOf(dp);
  if (G.mode === 'team') {
    let best = 0, bd = 1e9;
    L.forEach((p, i) => {
      if (!padOk(dp, i)) return;
      for (const h of G.humans) if (!h.dead && !allyP(h.player, dp.player)) { const d = Math.abs(h.x - p.x); if (d < bd) { bd = d; best = i; } }
    });
    return best;
  }
  let front = 0;
  for (const h of G.humans) if (!h.dead && !h.saved) front = Math.max(front, h.x);
  let best = 0;
  L.forEach((p, i) => { if (p.x < front - 600 && padOk(dp, i)) best = i; });
  return best;
}
function nextPad(dp, dir) {
  const n = padsOf(dp).length;
  for (let k = 1; k <= n; k++) { const i = (((dp.pad + k * (dir || 1)) % n) + n) % n; if (padOk(dp, i)) { dp.pad = i; return; } }
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
  if (c.pressed('interact') || c.pressed('aim')) {
    nextPad(dp, c.pressed('aim') ? -1 : 1); Sfx.click();
    if (d) { const p = curPad(dp); d.x = p.x; d.y = p.y - DRONE_R - 2; }
  }
  if (d) { d.slots = dp.loadout.slice(); d.payload = firstDrop(d.slots); }
}
function updateDronePlayer(dp, dt) {
  if (G.over) return;
  // людина, що взяла дрон: 1 — повернутися (дрон без вибуху вимикається)
  if (dp.temp && G.time > dp.t0 + 0.2 && dp.player.ctrl.pressed('slot1')) { endPilot(dp); return; }
  const d = dp.drone;
  if ((!d && dp.left > 0) || (d && d.onPad)) loadoutInput(dp, dp.player.ctrl);
  if (d || dp.left <= 0) return;
  dp.timer -= dt;
  if (dp.timer <= 0) {
    // командний режим: дрони беруться із запасу команди, який поповнюють НРК
    if (G.mode === 'team') {
      if (G.stock[dp.player.team] <= 0) { dp.timer = 0; dp.noStock = true; return; }
      G.stock[dp.player.team]--; dp.noStock = false;
    }
    if (!padOk(dp, dp.pad)) dp.pad = autoPad(dp);
    const pad = curPad(dp);
    const slots = dp.loadout.slice();
    // новий дрон стоїть на майданчику, АКБ не сідає, поки не злетить
    const nd = { player: dp.player, dp, x: pad.x, y: pad.y - DRONE_R - 2, vx: 0, vy: 0, battery: DRONE_BATTERY, jammed: false, tilt: 0, spin: 0,
      slots, payload: firstDrop(slots), landed: true, onPad: true, landing: false };
    dp.left--; dp.used++; dp.drone = nd; G.drones.push(nd); G.stats.dronesUsed++;
    Sfx.tone(880, 0.1, 0.1);
  }
}
function takeOff(d) {
  d.landed = false; d.onPad = false; d.landing = false; d.vy = -240; d.vx = 0;
  Sfx.tone(520, 0.12, 0.08);
}
// найближча поверхня під точкою (земля, верх об'єкта чи перекриття)
// нормаль від землі для кола (x, y, r) або null, якщо коло вільне
const DN_DIRS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)]);
function dirtNormal(W, x, y, r) {
  let sx = 0, sy = 0, n = 0;
  for (const [cx, cy] of DN_DIRS) if (dirtAt(W, x + cx * r, y + cy * r)) { sx += cx; sy += cy; n++; }
  if (!n) return null;
  const l = Math.hypot(sx, sy);
  return l < 1e-6 ? { x: 0, y: -1 } : { x: -sx / l, y: -sy / l };
}
function landSurface(x, y) {
  let sy = gAt(G.W, x);
  if (G.W.pipes.length) for (const s of cavSpans(G.W, x)) if (y <= s.bot + 1) { sy = s.surf ? sy : s.bot; break; }
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
        if (h.dead || h.saved || covered(h) || allyP(h.player, b.player)) continue;
        if (rectDist(b.x, b.y, humanRect(h)) < 3) { hit = true; hitH = h; break; }
      }
      for (const v of W.vehicles) if (!v.dead && rectDist(b.x, b.y, vehRect(v)) < 2) { hit = true; hitV = v; break; }
      if (G.ugvs) for (const u of G.ugvs) if (!u.dead && u.team !== (b.player && b.player.team) && rectDist(b.x, b.y, ugvRect(u)) < 2) { hit = true; break; }
    }
    if (b.x < 0 || b.x > W.width) { G.bombs.splice(i, 1); continue; }
    if (!hit) continue;
    G.bombs.splice(i, 1);
    G.blastBy = b.player;
    const into = (b.type === 'frag' || b.type === 'fire') && !hitH && !hitV ? hideAtPoint(b.x, b.y) : null;
    if (into && into.e && b.type === 'frag') { feed('Скид залетів у ' + into.name + '!', '#ff8a5a'); grenadeInside({ inside: into, owner: { player: b.player } }); }
    else if (b.type === 'frag') explosion(b.x, b.y, 80, 90);
    else if (b.type === 'fire') { startFire(b.x, b.y, 120, FIRE_T + 2, b.player); if (hitH) hurt(hitH, 25, 'fire'); if (into) for (const o of G.humans) if (!o.dead && o.hidden === into.sp) hurt(o, 45, 'fire'); }
    else if (b.type === 'mine') {
      if (hitH || hitV) mineExplode(b.x, b.y);
      else { G.mines.push({ x: b.x, y: b.y + 3, arm: 0.8, seed: Math.random() * 10, player: b.player }); Sfx.tone(180, 0.06, 0.1); }
    } else {
      G.blastBy = null;
      makeSmoke(b.x, b.y);
      Sfx.noise_(0.6, 0.25, 1200, 'bandpass');
    }
    G.blastBy = null;
  }
  for (const sm of G.smokes) {
    sm.t -= dt;
    const gk = clamp((sm.max - sm.t) / sm.grow, 0, 1);
    sm.r = sm.r0 + (sm.rMax - sm.r0) * (1 - (1 - gk) * (1 - gk)); // повільно розходиться до меж приміщення
    if (sm.env === 'open') sm.x += SMOKE_WIND * dt;
    if (RND() < dt * 14) G.parts.push({ type: 'smoke', x: sm.x + rand(-sm.r, sm.r) * 0.7, y: sm.y + rand(-30, 25), vx: rand(-15, 15), vy: rand(-25, -5), life: 3, max: 3, size: rand(16, 28), light: true });
  }
  G.smokes = G.smokes.filter((s) => s.t > 0);
  // дим у схованці: не виганяє, а швидко забирає здоров'я, якщо не вибратися за кілька секунд
  for (const h of G.humans) {
    if (h.dead || h.saved) continue;
    if (h.hidden) {
      const e = hideEntrance(h);
      const smoked = !h.gasmask && G.smokes.some((s) => dist(s.x, s.y + 30, e.x, e.y) < s.r || dist(s.x, s.y + 30, h.x, h.y) < s.r);
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
    const inside = !h.gasmask && inSmoke(h.x, h.y - 20); // у протигазі дим не шкодить
    if (inside) h.gasT += dt; else { h.gasT = Math.max(0, h.gasT - dt * 2); if (h.gasT < SMOKE_SAFE) h.gasWarned = false; }
    if (h.gasT > SMOKE_SAFE) {
      if (!h.gasWarned) { h.gasWarned = true; feed(h.player.name + ' задихається в диму', '#bbb'); }
      hurt(h, SMOKE_DMG * dt, 'smoke');
      if (RND() < dt * 3) G.parts.push({ type: 'smoke', x: h.x, y: h.y - 34, vx: rand(-10, 10), vy: -20, life: 0.8, max: 0.8, size: 6, light: true });
    }
  }
}
// дим: де впав — там і поводиться (відкрите місце, будівля, схованка, тунель)
const SMOKE_WIND = 14;
function makeSmoke(x, y) {
  const W = G.W, b = buildingAt(x, y - 4), sp = hideAtPoint(x, y) || W.hides.find((q) => q.type !== 'pipe' && !q.ruined && dist(x, y, q.x, q.y) < 50), tp = pipeAt(W, x, y + 2);
  let s;
  if (b) s = { env: 'bld', x: clamp(x, b.x + 30, b.x + b.w - 30), y: y - 30, t: 45, r0: 40, rMax: Math.min(b.w / 2 + 10, 170), grow: 12 };
  else if (sp && sp.sp) s = { env: 'hide', x: sp.x, y: sp.y - 30, t: 40, r0: 26, rMax: 75, grow: 8 };
  else if (sp) s = { env: 'hide', x: sp.x, y: sp.y - 30, t: 40, r0: 26, rMax: 75, grow: 8 };
  else if (tp) s = { env: 'tun', x, y: y - 20, t: 40, r0: 30, rMax: 150, grow: 15 };
  else s = { env: 'open', x, y: y - 30, t: 16, r0: 60, rMax: SMOKE_R * 1.1, grow: 3 };
  s.max = s.t; s.r = s.r0; s.seed = Math.random() * 100;
  G.smokes.push(s);
  return s;
}
function inSmoke(x, y) { return G.smokes.some((s) => dist(x, y, s.x, s.y) < s.r * 0.85); }

// ---------- Міни ----------
function updateMines(dt) {
  const W = G.W;
  for (let i = G.mines.length - 1; i >= 0; i--) {
    const m = G.mines[i];
    if (m.arm > 0) { m.arm -= dt; continue; }
    let trig = false;
    for (const h of G.humans) {
      if (h.dead || h.saved || h.hidden || h.vehicle) continue;
      // спрацьовує й тоді, коли людина пролітає низько над нею — перестрибнути важко
      if (Math.abs(h.x - m.x) < MINE_TRIGGER && h.y > m.y - 34 && h.y < m.y + 14) { trig = true; break; }
    }
    if (!trig) for (const v of W.vehicles) {
      if (v.dead) continue;
      if (Math.abs(v.x - m.x) < VEH[v.type].len / 2 + 8 && Math.abs(v.y - m.y) < 20) { trig = true; break; }
    }
    if (!trig && G.ugvs) for (const u of G.ugvs) {
      if (u.dead || (m.player && m.player.team === u.team)) continue;
      if (Math.abs(u.x - m.x) < 30 && Math.abs(u.y - m.y) < 20) { trig = true; hurtUgv(u, UGV_HP * 2, m.player); break; }
    }
    if (trig) { G.mines.splice(i, 1); G.blastBy = m.player; mineExplode(m.x, m.y); G.blastBy = null; }
  }
}
// вибух міни: поруч — мінус 50% здоров'я без броні (15 у броні), далі до MINE_R — менше; техніка — знищена ходова
function mineExplode(x, y) {
  G.lastBlast = { x, y, power: 90 };
  explosionFx(x, y - 4, 45, 50);
  Sfx.boom(false);
  for (const h of G.humans) {
    if (h.dead || h.saved || covered(h) || h.vehicle || h.alT > 0) continue;
    const dd = dist(h.x, h.y - 8, x, y);
    if (dd > MINE_R) continue;
    const near = dd < MINE_TRIGGER + 8, armored = h.armor > 0;
    if (armored) h.armor = Math.max(0, h.armor - (near ? 40 : 15));
    hurt(h, near ? (armored ? 15 : 50) : (armored ? 7 : 22), 'mine');
    if (near) { h.vy = -220; h.onGround = false; }
    feed(h.player.name + (near ? ' підірвався на міні' : ' поранений міною') + (armored ? ' (броня врятувала)' : ''), '#f2994a');
  }
  for (const v of G.W.vehicles) {
    if (v.dead || Math.abs(v.x - x) > VEH[v.type].len / 2 + 40 || Math.abs(v.y - y) > 40) continue;
    v.immob = true; v.vx = 0;
    for (const o of [v.driver, v.gunner]) if (o) hurt(o, 6, 'mine');
    feed(VEH[v.type].name + ' підірвався на міні — ходова знищена', '#f2994a');
  }
  damageCovers(x, y, 30);
}
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
  d.dp.drone = null; d.dp.timer = DRONE_RESPAWN; d.dp.pad = autoPad(d.dp);
  if (d.dp.temp) endPilot(d.dp); // дрон людини вибухнув — керування назад до людини
}
// direct — людина, в яку дрон врізався; head — влучання в голову
function explodeDrone(d, direct, head) {
  removeDrone(d);
  G.blastBy = d.player;
  explosion(d.x, d.y, 130, 120, direct ? { h: direct, head } : null);
  G.blastBy = null;
  // командний режим: вибух дрона збиває ворожі дрони поруч
  if (isTeam()) for (const e of G.drones.slice()) if (!allyP(e.player, d.player) && dist(e.x, e.y, d.x, d.y) < 70) droneDowned(e, d.player);
  // хто пережив вибух поруч — зараховується для «Альоші»
  for (const h of G.humans) if (!h.dead && !h.saved && dist(h.x, h.y - 25, d.x, d.y) < 220) beat(h);
}
function shootDownDrone(d, by) {
  removeDrone(d);
  G.stats.shotDown++;
  feed('Дрон збито! (' + d.player.name + ')', '#56ccf2');
  explosion(d.x, d.y, 30, 55);
  if (by) { beat(by); by.player.score++; }
}
// якість зв'язку з дроном: 1 — у небі; що глибше він залітає під землю (у бліндаж, тунель), то гірше
function droneSignal(d) {
  const W = G.W, under = d.y - gAt(W, d.x);
  if (under <= 4) return 1;
  // до найближчого виходу на поверхню (пройдена в ґрунті відстань)
  let open = 1e9;
  for (let dx = 0; dx <= 260; dx += 10) for (const s of [-1, 1]) { const x = d.x + s * dx; if (d.y <= gAt(W, x) + 6) open = Math.min(open, dx); }
  const depth = Math.max(under, Math.min(open, 260) * 0.6);
  return 0.3 + 0.7 * clamp(1 - depth / 170, 0, 1); // глибоко — лише перешкоди, керування лишається
}
function acquireLock(d) {
  const h = d.lockOn;
  if (h && !h.dead && !h.saved && !covered(h) && dist(h.x, h.y - 25, d.x, d.y) < 520 && seenUnder(h, d.x, d.y)) return true;
  d.lockOn = null;
  let best = null, bd = 230;
  for (const x of G.humans) {
    if (x.dead || x.saved || covered(x) || ally(x, d)) continue;
    const dd = dist(x.x, x.y - 25, d.x, d.y);
    if (dd < bd && humanVisibleToDrone(x, d) && lineOfSight(G.W, d.x, d.y, x.x, x.y - 25)) { bd = dd; best = x; }
  }
  if (best) { d.lockOn = best; feed(d.player.name + ': автозахоплення цілі!', '#ff5a5a'); Sfx.tone(1200, 0.15, 0.1, 'sawtooth'); }
  return !!best;
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
  if (d.speedT > 0) d.speedT -= dt;
  const fast = d.speedT > 0 ? 2 : 1;
  // автозахоплення: людина поруч — дрон летить у неї сам, навіть під РЕБом
  d.sig = droneSignal(d); // під землею зв'язок слабшає
  if (false) {
    const h = d.lockOn, r = humanRect(h), tx = h.x, ty = r.y + r.h * 0.5;
    const dx = tx - d.x, dy = ty - d.y, l = Math.hypot(dx, dy) || 1, v = 560 * fast;
    const a = Math.min(1, dt * 7);
    d.vx += (dx / l * v - d.vx) * a; d.vy += (dy / l * v - d.vy) * a;
    d.jammed = false; d.landing = false;
    if (c.pressed('fire')) { explodeDrone(d); return; }
  } else if (!d.jammed) {
    let ix = c.cur.ax || 0, iy = c.cur.ay || 0;
    const l = Math.hypot(ix, iy);
    if (l > 1) { ix /= l; iy /= l; }
    if (d.inverted) { ix = -ix; iy = -iy; } // після влучання кулі керування навпаки
    if (c.pressed('aim')) {
      // біля землі — посадка, високо — ширший огляд
      if (landSurface(d.x, d.y) - d.y < 90) d.landing = !d.landing;
      else d.player.cam.wide = !d.player.cam.wide;
    }
    if (d.landing && (c.held('up') || boost)) d.landing = false;
    const bad = d.sig != null ? 1 - d.sig : 0; // 0 — чистий зв'язок, 0.7 — найгірший
    if (bad > 0.02) {
      if (d.dropT > 0) d.dropT -= dt;
      else if (RND() < dt * bad * 5) d.dropT = rand(0.1, 0.45) * bad * 1.6; // команда загубилася — дрон летить, як летів
      const a = Math.min(1, dt * (1.2 + 12 * (1 - bad))); // запізнення реакції
      if (!(d.dropT > 0)) { d.lix = lerp(d.lix || 0, ix, a); d.liy = lerp(d.liy || 0, iy, a); }
      ix = d.lix || 0; iy = d.liy || 0;
      d.vx += rand(-1, 1) * bad * 1100 * dt; d.vy += rand(-1, 1) * bad * 1100 * dt; // смикає
    } else { d.lix = ix; d.liy = iy; }
    const acc = (boost ? 2100 : 1500) * fast * (1 - bad * 0.5), max = (boost ? 720 : 460) * fast * (1 - bad * 0.45);
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
  // земля й стіни тунелів (порожнини вільні — дрон може залетіти в тунель)
  const nn = dirtNormal(W, d.x, d.y, DRONE_R);
  if (nn) {
    const impact = -(d.vx * nn.x + d.vy * nn.y);
    if (impact > CRASH || d.jammed) { explodeDrone(d); return; }
    for (let k = 0; k < 14 && dirtNormal(W, d.x, d.y, DRONE_R); k++) { d.x += nn.x; d.y += nn.y; }
    if (impact > 0) { d.vx += nn.x * impact * 1.2; d.vy += nn.y * impact * 1.2; }
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
  // цілі (свої люди — не ціль)
  for (const h of G.humans) {
    if (h.dead || h.saved || covered(h) || h.vehicle || ally(h, d)) continue;
    if (rectDist(d.x, d.y, humanRect(h)) < DRONE_R) { explodeDrone(d, h, isHeadHit(d, h)); return; }
  }
  for (const v of W.vehicles) {
    if (v.dead) continue;
    if (rectDist(d.x, d.y, vehRect(v)) < DRONE_R + 2) { explodeDrone(d); return; }
  }
  if (G.ugvs) for (const u of G.ugvs) if (!u.dead && u.team !== d.player.team && rectDist(d.x, d.y, ugvRect(u)) < DRONE_R + 2) { explodeDrone(d); return; }
  // таран ворожого дрона
  if (isTeam()) for (const e of G.drones) if (e !== d && !allyP(e.player, d.player) && dist(e.x, e.y, d.x, d.y) < DRONE_R * 2 + 3) { explodeDrone(d); return; }
}

function explosionFx(x, y, power, radius) {
  const W = G.W, g = gAt(W, x), big = power > 60;
  const ground = y > g - 40 && y < g + 24 && !pipeAt(W, x, y + 2);
  // трясіння камери: невидима частинка, рендер кожного вікна рахує його за відстанню (працює й у гравців по мережі)
  G.parts.push({ type: 'shake', x, y, life: 3, max: 3, amp: big ? 1.25 : 0.55 });
  if (ground) {
    G.parts.push({ type: 'boom', x, y: g, life: big ? 3.2 : 2.2, max: big ? 3.2 : 2.2, size: big ? 1 : 0.55, flip: RND() < 0.5 ? 1 : 0 });
    G.parts.push({ type: 'gflash', x, y: g - 6, life: 0.14, max: 0.14, size: big ? 46 : 26 });
    for (let i = 0; i < (big ? 26 : 10); i++) {
      const a = rand(-Math.PI * 0.92, -Math.PI * 0.08), s = rand(120, big ? 520 : 300);
      G.parts.push({ type: 'debris', x: x + rand(-6, 6), y: g - 2, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.8, 1.6), max: 1.6, col: RND() < 0.5 ? '#3a2618' : '#4e3422' });
    }
    for (let i = 0; i < (big ? 4 : 2); i++) G.parts.push({ type: 'smoke', x: x + rand(-14, 14), y: g - rand(10, 40), vx: rand(-20, 20), vy: rand(-40, -10), life: rand(2.5, 4), max: 4, size: rand(14, 22) });
  } else {
    G.parts.push({ type: 'aflash', x, y, life: 0.16, max: 0.16, size: big ? 60 : 36 });
    const n = big ? 22 : 14;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + rand(-0.15, 0.15), s = rand(90, 320); G.parts.push({ type: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.6), max: 0.6 }); }
    for (let i = 0; i < 6; i++) G.parts.push({ type: 'debris', x, y, vx: rand(-160, 160), vy: rand(-200, 40), life: rand(0.6, 1.1), max: 1.1, col: '#1c1418' });
    for (let i = 0; i < (big ? 4 : 2); i++) G.parts.push({ type: 'smoke', x: x + rand(-10, 10), y: y + rand(-10, 10), vx: rand(-20, 20), vy: rand(-30, -5), life: rand(1.5, 3), max: 3, size: rand(10, 18) });
  }
}
function explosion(x, y, power, radius, direct) {
  const W = G.W;
  G.lastBlast = { x, y, power };
  Sfx.boom(power > 60);
  explosionFx(x, y, power, radius);
  douseFires(x, y, radius);
  // техніка: броня приймає удар, люди всередині лише поранені
  const shielded = new Set();
  for (const h of G.humans) if (h.vehicle) shielded.add(h);
  for (const v of W.vehicles) {
    if (v.dead) continue;
    if (rectDist(x, y, vehRect(v)) < radius * 0.6 && v.cageHp > 0) {
      // мангал (сітка над технікою) приймає вибух на себе
      v.cageHp--;
      for (let i = 0; i < 10; i++) G.parts.push({ type: 'spark', x: v.x + rand(-30, 30), y: v.y - VEH[v.type].h - 6, vx: rand(-160, 160), vy: rand(-220, -40), life: 0.4, max: 0.4 });
      feed(v.cageHp > 0 ? 'Мангал прийняв удар' : 'Мангал зруйновано', '#c9a36a');
      continue;
    }
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
    if (covered(h)) {
      const e = hideEntrance(h);
      if (h.peek) { if (dist(x, y, e.x, e.y) < 65) hurt(h, power * 0.7, 'blast'); } // визирнув — вразливіший
      else if (dist(x, y, e.x, e.y) < 45) hurt(h, power * 0.35, 'blast');
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
  blastUgvs(x, y, power, radius);
  if (power >= 25) { damageCovers(x, y, power); damageFort(x, y, power); damageTunnels(x, y, power); }
  if (power >= 60) breachSolids(x, y, radius);
  if (power >= 25) craterAt(x, y, power, radius);
}
// ---------- Вирви: вибух біля поверхні вириває ґрунт; повторні вибухи поглиблюють її без меж ----------
// Чим глибша яма, тим ширша (як справжня воронка) — схили лишаються прохідними, людина вибирається.
function craterAt(x, y, power, radius) {
  const W = G.W, g = gAt(W, x), big = power > 60;
  if (y < g - radius * 0.45 || y > g + 24) return; // високо в повітрі або під землею (тунель)
  let r = big ? 46 : 26;
  if (x < r * 2 + 20 || x > W.width - r * 2 - 20) return;
  const ceilAt = (xx) => { let c = 1e9; for (const sp of W.pipes) if (xx > sp.a - 16 && xx < sp.b + 16) c = Math.min(c, tunFloor(W, sp, clamp(xx, sp.a, sp.b)) - tunH(sp)); return c; };
  if (ceilAt(x) - g < (big ? 60 : 40)) return; // мілкий тунель — його перекриття обвалюється окремо
  if (W.hides.some((o) => o.type !== 'pipe' && Math.abs(o.x - x) < r + 40)) return; // бліндажі, нори
  if (W.ditches.some((d) => x + r > d.a - 10 && x - r < d.b + 10)) return;
  if ((W.forts || []).some((f) => Math.abs(f.x - x) < r + 40)) return;
  // будівлі, стіни, укриття, що стоять на землі, — не підкопувати
  if (solidsNear(W, x - r - 8, x + r + 8).some((s) => !s.dead && s.x < x + r + 8 && s.x + s.w > x - r - 8 && s.y + s.h > gAt(W, clamp(x, s.x, s.x + s.w)) - 30)) return;
  const k = clamp(1 - Math.max(0, g - y) / (radius * 0.45), 0.35, 1), depth = (big ? 14 : 6) * k;
  const pit = Math.max(0, g - (gAt(W, x - 140) + gAt(W, x + 140)) / 2); // уже наявна глибина ями
  r = Math.max(r, (pit + depth) * 1.7);
  for (let i = Math.max(0, Math.floor((x - r * 1.4) / GS)); i <= Math.min(W.ground.length - 1, Math.ceil((x + r * 1.4) / GS)); i++) {
    const t = (i * GS - x) / r, a = Math.abs(t);
    let d = 0;
    // вирвано, а не прогнуто: плаский низ, круті стінки, нерівний край
    const jag = 0.85 + 0.3 * hash01(i * 7.13 + x);
    if (a < 1) d = depth * Math.pow(1 - Math.pow(a, 3.2), 0.7) * jag;
    else if (a < 1.25) d = -depth * 0.18 * Math.sin(((a - 1) / 0.25) * Math.PI) * jag; // викинутий ґрунт — вузький вал
    W.ground[i] = Math.min(BASE_G + 900, W.ground[i] + d, Math.max(W.ground[i], ceilAt(i * GS) - 18)); // до тунелю внизу не прокопує
  }
  for (const t of W.trees) if (Math.abs(t.x - x) < r * 1.5) t.y = gAt(W, t.x);
  // мішки, тюки, колоди поруч осідають на новий ґрунт (а не висять над вирвою)
  let moved = false;
  for (const s of solidsNear(W, x - r * 1.5, x + r * 1.5)) {
    if (!RAMMABLE[s.type] || s.dead || s.type === 'bridge') continue;
    const gb = Math.max(gAt(W, s.x + 2), gAt(W, s.x + s.w / 2), gAt(W, s.x + s.w - 2));
    if (s.y + s.h < gb - 1) { s.y = gb - s.h; moved = true; }
  }
  if (moved) buildBuckets(W);
  // зона голого ґрунту (трава зірвана) — для малювання; сусідні зони зливаються
  const z = { a: x - r * 1.1, b: x + r * 1.1 };
  W.craters = (W.craters || []).filter((q) => { if (q.b < z.a || q.a > z.b) return true; z.a = Math.min(z.a, q.a); z.b = Math.max(z.b, q.b); return false; });
  W.craters.push(z);
  cavDirty(W);
}
function hash01(n) { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); }
// пролом у стінах, перекриттях і даху: вибиває шматок, трохи менший за радіус вибуху
const BREACHABLE = { wall: 1, floor: 1, roof: 1 };
function breachSolids(x, y, radius) {
  const W = G.W, r = radius * 0.4;
  const bx0 = x - r * rand(0.85, 1.1), bx1 = x + r * rand(0.85, 1.1), by0 = y - r * rand(0.85, 1.1), by1 = y + r * rand(0.85, 1.1);
  const add = [], hitB = new Set();
  let changed = false;
  for (const so of solidsNear(W, bx0 - 2, bx1 + 2)) {
    if (!BREACHABLE[so.type] || so.dead) continue;
    if (so.x >= bx1 || so.x + so.w <= bx0 || so.y >= by1 || so.y + so.h <= by0) continue;
    so.dead = true; changed = true;
    if (so.bld) hitB.add(so.bld);
    const x0 = Math.max(so.x, bx0), x1 = Math.min(so.x + so.w, bx1), y0 = Math.max(so.y, by0), y1 = Math.min(so.y + so.h, by1);
    const base = { bt: so.bt, bb: so.bb, bl: so.bl, br: so.br };
    const pieces = [
      { x: so.x, y: so.y, w: so.w, h: y0 - so.y, ...base, bb: 1 },
      { x: so.x, y: y1, w: so.w, h: so.y + so.h - y1, ...base, bt: 1 },
      { x: so.x, y: y0, w: x0 - so.x, h: y1 - y0, bl: so.bl, br: 1 },
      { x: x1, y: y0, w: so.x + so.w - x1, h: y1 - y0, bl: 1, br: so.br },
    ];
    for (const p of pieces) if (p.w >= 4 && p.h >= 4) add.push(Object.assign({}, so, p, { dead: false, _q: 0 }));
    const n = Math.min(14, 3 + ((x1 - x0) * (y1 - y0)) / 80);
    for (let i = 0; i < n; i++) G.parts.push({ type: 'debris', x: rand(x0, x1), y: rand(y0, y1), vx: rand(-220, 220), vy: rand(-300, -40), life: rand(0.7, 1.3), max: 1.3, col: so.type === 'wall' ? '#7a5c48' : '#77736c' });
  }
  if (!changed) return;
  W.solids = W.solids.filter((so) => !so.dead).concat(add);
  buildBuckets(W);
  for (const b of hitB) checkCollapse(b); // від будівлі майже нічого не лишилось — обвал
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
  sp.ruined = true; sp.bonus = null; sp.net = false;
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
      else { const pd = curPad(p.ent); tx = pd.x + 120 * fwdDir(p); ty = pd.y - 150; }
    }
    let az = 1;
    if (p.role === 'human') {
      // прицілювання з далекобійної зброї — камера відходить і зсувається в бік прицілу
      const h = p.ent, wt = h.mount ? 'mrifle' : h.vehicle && h.seat === 'gunner' ? 'mg' : h.aiming && !h.grenAim && h.weapon ? h.weapon.type : null;
      if (wt && !h.dead) { const rg = WEAPONS[wt].range; az = clamp(rg / 400, 1, 2.3); const a = aimWorld(h); tx += Math.cos(a) * rg * 0.3; ty += Math.sin(a) * rg * 0.15; }
    } else {
      // дрон: що вище над землею, то далі видно; під землею — тісно
      const d = p.ent.drone, alt = d ? gAt(G.W, d.x) - d.y : 150;
      const tz = alt < -4 ? 430 : clamp(470 + alt * 0.85, 480, 1150);
      p.cam.dz = (p.cam.dz || tz) + (tz - (p.cam.dz || tz)) * Math.min(1, dt * 2);
    }
    const k = Math.min(1, dt * 5);
    p.cam.x += (tx - p.cam.x) * k; p.cam.y += (ty - p.cam.y) * k;
    if (p.role === 'human') {
      const h = p.ent, still = !h.dead && Math.abs(h.vehicle ? h.vehicle.vx : h.vx) < 20;
      const tz = Math.max(still ? p.cam.userZ || 1 : 1, az);
      p.cam.z = (p.cam.z || 1) + (tz - (p.cam.z || 1)) * Math.min(1, dt * (tz > (p.cam.z || 1) ? 2.5 : 4));
    }
  }
}

// ---------- Головний цикл гри ----------
function sideKey(p) { return isTeam() ? 't' + p.team : 'h'; }
function updateTunnelIntel() {
  const W = G.W;
  if (!W.pipes.length) return;
  for (const h of G.humans) {
    if (h.dead || h.saved || h.vehicle) continue;
    const sp = pipeAt(W, h.x, h.y);
    if (sp) (sp.known || (sp.known = {}))[sideKey(h.player)] = true;
  }
  for (const d of G.drones) {
    const sp = pipeAt(W, d.x, d.y + DRONE_R - 2);
    if (sp) (d.player.knownPipes || (d.player.knownPipes = new Set())).add(sp);
  }
}
function updateGame(dt) {
  G.time += dt;
  for (const h of G.humans) updateHuman(h, dt);
  updateVehicles(dt);
  updateDitches();
  updateFires(dt);
  for (const dp of G.dps) updateDronePlayer(dp, dt);
  for (const d of G.drones.slice()) updateDrone(d, dt);
  for (const d of G.drones) d.inBush = droneInBush(d);
  updateBullets(dt);
  updateBombs(dt);
  updateThrows(dt);
  updateMines(dt);
  updateAirBonuses(dt);
  updatePickups(dt);
  if (G.mode === 'team' && !G.over) { updateTeam(dt); updateSupply(dt); }
  for (const r of G.rebs) r.t -= dt;
  G.rebs = G.rebs.filter((r) => r.t > 0);
  for (const f of G.feed) f.t -= dt;
  G.feed = G.feed.filter((f) => f.t > 0);
  updateParts(dt);
  updateTunnelIntel();
  updateGameTail(dt);
}
// частинки (пил, дим, уламки, кров) — у гравця по мережі рахуються на його ПК
function updateParts(dt) {
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const p = G.parts[i];
    p.life -= dt;
    if (p.life <= 0) { G.parts.splice(i, 1); continue; }
    if (p.vx !== undefined) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.type === 'debris' || p.type === 'spark' || p.type === 'gun' || p.type === 'leaf') p.vy += (p.type === 'leaf' ? 400 : 900) * dt;
      if (p.type === 'gib') {
        p.vy += 1100 * dt; p.rot += p.spin * dt;
        if (p.vy > 0) {
          const sy = landSurface(p.x, p.y - p.vy * dt - 2);
          if (p.y >= sy - 2) { p.y = sy - 2; p.vy = -p.vy * 0.28; p.vx *= 0.55; p.spin *= 0.5; if (Math.abs(p.vy) < 40) { p.vy = 0; p.vx *= 0.8; } }
        }
        if (p.blood > 0 && RND() < dt * 20) { p.blood -= dt; G.parts.push({ type: 'debris', x: p.x, y: p.y, vx: rand(-30, 30), vy: rand(-40, 10), life: 0.5, max: 0.5, col: '#7a1a1a' }); }
      }
      if (p.type === 'fire') { p.vx *= 0.92; p.vy *= 0.92; }
      if (p.type === 'gun') p.rot += dt * 10;
    }
  }
}
function updateGameTail(dt) {
  // відкритість людей (для стрілки дрона)
  for (const h of G.humans) {
    if (h.dead || h.saved || covered(h) || buried(h) || humanConcealed(h)) h.openTime = 0;
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
    if (G.mode === 'team') teamTick(dt);
    else if (G.mode === 'dm') {
      G.timeLeft -= dt;
      if (G.timeLeft <= 0) {
        G.timeLeft = 0;
        const sc = teamScores();
        G.over = sc.humans > sc.drones ? 'humans' : sc.drones > sc.humans ? 'drones' : 'draw';
        G.overReason = 'Час вийшов — рахунок ' + sc.humans + ' : ' + sc.drones;
      }
    } else {
      // людина вибула, якщо врятувалася або втратила всі життя
      const out = G.humans.filter((h) => !h.saved && !(h.dead && h.lives <= 0));
      if (out.length === 0) {
        G.over = G.humans.some((h) => h.saved) ? 'humans' : 'drones';
        G.overReason = G.over === 'humans' ? 'Дісталися укриття' : 'Усі люди втратили всі життя';
      }
    }
  } else G.overT += dt;
}

function teamScores() {
  let humans = 0, drones = 0;
  for (const p of G.players) if (p.role === 'human') humans += p.score; else drones += p.score;
  return { humans, drones };
}

// ---------- Рюкзак людини ----------
// 1 — зброя (якщо в руках каністра — викинути її), 2 — аптечка (5 с), 3 — РЕБ
function backpackInput(h, c) {
  if (c.pressed('slot1') && h.throwSel) { h.throwSel = null; h.grenAim = false; } // назад до зброї
  else if (c.pressed('slot1') && h.canister) dropCanister(h);
  else if (c.pressed('slot1') && h.carry) dropCarry(h);
  else if (c.pressed('slot1') && isTeam()) tryPilot(h);
  if (c.pressed('slot2')) {
    if (h.healT > 0) return;
    if (h.medkits <= 0) feed(h.player.name + ': аптечок немає', '#ccc');
    else if (h.hp >= 100) feed(h.player.name + ': здоров\'я повне', '#ccc');
    else { h.healT = 0.001; feed(h.player.name + ' перев\'язується…', '#9c9'); }
  }
}
function dropCanister(h) {
  h.canister = false;
  const x = clamp(h.x + h.facing * 18, 20, G.W.width - 20);
  G.W.pickups.push({ type: 'fuel', x, y: surfaceY(G.W, x) });
  feed(h.player.name + ' викинув каністру', '#ccc');
}
// лікування: треба 5 с не рухатися
function tickHeal(h, c, dt, moving) {
  if (h.healT <= 0) return;
  if (moving) { h.healT = 0; feed(h.player.name + ': перев\'язку перервано', '#ccc'); return; }
  h.healT += dt;
  if (h.healT >= HEAL_TIME) { h.healT = 0; h.medkits--; h.hp = Math.min(100, h.hp + 45); feed(h.player.name + ': +45 здоров\'я', '#6fcf97'); Sfx.tone(660, 0.15, 0.12); }
}
// дезматч: випадкове місце появи — не в об'єктах і не біля дронів
function randomSpawnX() {
  const W = G.W;
  let x = W.start.x;
  for (let t = 0; t < 40; t++) {
    x = rand(900, W.width - 1500);
    const busy = solidsNear(W, x - 30, x + 30).some((s) => !s.thin && s.x < x + 20 && s.x + s.w > x - 20 && s.y < gAt(W, x) && s.y + s.h > gAt(W, x) - 60);
    const drone = G.drones.some((d) => Math.abs(d.x - x) < 600);
    if (!busy && !drone) break;
  }
  return x;
}

// ---------- Бонуси для дронів у повітрі ----------
// кожен бонус висить обмежений час, потім зникає й з'являється в іншому місці
function spawnAirBonus(b) {
  const W = G.W, x = rand(1200, W.width - 900);
  const life = rand(25, 45);
  return Object.assign(b, { x, y: gAt(W, x) - rand(150, 320), type: pick(Object.keys(AIR_BONUS)), active: true, t: 0, life, max: life, seed: Math.random() * 10 });
}
function updateAirBonuses(dt) {
  for (const b of G.airBonuses) {
    if (!b.active) { if ((b.t -= dt) <= 0) spawnAirBonus(b); continue; }
    if ((b.life -= dt) <= 0) { b.active = false; b.t = rand(6, 15); continue; }
    for (const d of G.drones) {
      if (d.landed || dist(d.x, d.y, b.x, b.y) > 24) continue;
      applyAirBonus(d, b.type);
      b.active = false; b.t = rand(15, 30);
      break;
    }
  }
}
// ---------- Знахідки для людей: час від часу з'являються поруч і зникають ----------
const HUMAN_BONUS = { rifle: 1, shotgun: 0.7, medkit: 1.2, armor: 0.6, reb: 0.4, detector: 0.7, grenade: 0.7, molotov: 0.5 };
function groundFree(x) {
  const W = G.W, g = gAt(W, x);
  return !solidsNear(W, x - 30, x + 30).some((s) => !s.thin && s.x < x + 20 && s.x + s.w > x - 20 && s.y < g && s.y + s.h > g - 60);
}
function updatePickups(dt) {
  const W = G.W;
  for (const p of W.pickups) if (p.life != null && !p.taken && (p.life -= dt) <= 0) p.taken = true;
  if (W.pickups.length > 300) W.pickups = W.pickups.filter((p) => !p.taken);
  // на позиціях (окопи, вогневі позиції, бліндажі) час від часу лишається зброя
  if (G.posT == null) G.posT = rand(12, 25);
  if ((G.posT -= dt) <= 0) { G.posT = rand(22, 40); spawnPositionWeapon(); }
  if (G.bonusT == null) G.bonusT = rand(25, 40);
  if ((G.bonusT -= dt) > 0) return;
  G.bonusT = rand(35, 55);
  const live = G.humans.filter((h) => !h.dead && !h.saved);
  if (!live.length || W.pickups.filter((p) => p.timed && !p.taken).length >= 2) return;
  const h = pick(live), dir = G.mode === 'escape' ? 1 : G.mode === 'team' ? fwdDir(h.player) : pick([-1, 1]);
  let x = 0;
  for (let t = 0; t < 12; t++) { x = clamp(h.x + dir * rand(450, 1300), 300, W.width - 400); if (groundFree(x)) break; }
  const type = weighted(G.mode === 'team' ? TEAM_BONUS : HUMAN_BONUS); // у командах зброя й аптечки — лише на базах
  W.pickups.push({ type, x, y: gAt(W, x), timed: true, life: 45, max: 45 });
}
const POS_LOOT = { rifle: 1, shotgun: 0.7, smg: 0.8, sniper: 0.35, mg: 0.35, grenade: 0.45, molotov: 0.35 };
function spawnPositionWeapon() {
  const W = G.W, live = G.humans.filter((h) => !h.dead && !h.saved);
  if (!live.length || W.pickups.filter((p) => p.pos && !p.taken).length >= 5) return;
  const spots = [];
  for (const c of W.covers) if (c.type === 'trench') spots.push(c.x + rand(0.25, 0.75) * c.w);
  for (const sp of W.hides) if (sp.type === 'bunker' && !sp.ruined && !sp.basement) spots.push(sp.x + pick([-1, 1]) * 34);
  for (const b of W.backs) if (!b.ruined) spots.push({ x: b.x + b.w * rand(0.2, 0.8), y: b.y + b.h - randi(0, b.floors - 1) * FLOOR_H });
  for (const sp of W.pipes) if (sp.b - sp.a > 60) { const px = rand(sp.a + 20, sp.b - 20); spots.push({ x: px, y: tunFloor(W, sp, px) }); }
  // ближчі до людей позиції — частіше (але не просто під ногами)
  const ok = spots.map((s) => (typeof s === 'number' ? { x: s, y: surfaceY(W, s) } : s)).filter((s) => s.x > 60 && s.x < W.width - 60 && live.some((h) => Math.abs(h.x - s.x) > 100 && Math.abs(h.x - s.x) < 2400) &&
    !W.pickups.some((p) => !p.taken && Math.abs(p.x - s.x) < 90 && Math.abs(p.y - s.y) < 60));
  if (!ok.length) return;
  const s = pick(ok);
  W.pickups.push({ type: weighted(POS_LOOT), x: s.x, y: s.y, timed: true, pos: true, life: 75, max: 75 });
}
function applyAirBonus(d, type) {
  if (type === 'lock') d.lock = true;
  else if (type === 'armor') d.hp = 10;
  else if (type === 'speed') d.speedT = 25;
  else if (type === 'battery') d.battery = DRONE_BATTERY * 1.5;
  else if (type === 'ammo') d.slots = d.slots.map((s) => s || 'frag');
  if (!d.payload) d.payload = firstDrop(d.slots);
  feed(d.player.name + ': бонус «' + AIR_BONUS[type].name + '»', AIR_BONUS[type].color);
  Sfx.tone(980, 0.12, 0.12); Sfx.tone(1320, 0.1, 0.08);
}
