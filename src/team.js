'use strict';
// ===== Режим «Команда проти команди» =====
// Сині стартують зліва, жовті справа; в обох командах можуть бути і люди, і дрони.
// Будівлі, бліндажі й бази захоплюються: 15 с усередині без живих ворогів (двоє — удвічі швидше).
// Захоплений об'єкт: прапор команди, точка відновлення людей, точка злету дронів, очки щодесять секунд.
// Захоплення ворожої бази — дострокова перемога.

const TEAMS = [
  { name: 'Сині', gen: 'синіх', short: 'С', col: '#4f9bff', cols: ['#56ccf2', '#2f80ed'] },
  { name: 'Жовті', gen: 'жовтих', short: 'Ж', col: '#f2c94c', cols: ['#f2c94c', '#f2994a'] },
];
const CAP_TIME = 15, CAP_DECAY = 0.5, HOLD_EVERY = 10, CAP_BONUS = 2;

function isTeam() { return !!G && G.mode === 'team'; }
// однакова команда (для гравців); поза командним режимом — ніхто не союзник
function allyP(a, b) { return isTeam() && !!a && !!b && a.team === b.team; }
function ally(a, b) { return allyP(a && a.player, b && b.player); }
function fwdDir(p) { return isTeam() && p.team === 1 ? -1 : 1; }

function initTeam() {
  const W = G.W;
  G.teamPts = [0, 0]; G.holdT = HOLD_EVERY;
  G.objs = [
    { kind: 'base', x: W.start.x, owner: 0, team: 0, capT: 0, capTeam: -1, n: [0, 0], name: 'база синіх', acc: 'базу синіх' },
    { kind: 'base', x: W.start2.x, owner: 1, team: 1, capT: 0, capTeam: -1, n: [0, 0], name: 'база жовтих', acc: 'базу жовтих' },
  ];
  for (const b of W.backs) G.objs.push({ kind: 'bld', ref: b, x: b.x + b.w / 2, owner: -1, capT: 0, capTeam: -1, n: [0, 0], name: 'будівля', acc: 'будівлю' });
  for (const sp of W.hides) if (sp.type === 'bunker' && !sp.basement) G.objs.push({ kind: 'bunker', ref: sp, x: sp.x, owner: -1, capT: 0, capTeam: -1, n: [0, 0], name: 'бліндаж', acc: 'бліндаж' });
  G.objs.sort((a, b) => a.x - b.x);
}
// чи людина «тримає» об'єкт
function objHas(o, h) {
  if (o.kind === 'bld') return bldUnder(h) === o.ref;
  if (o.kind === 'bunker') return h.hidden === o.ref || (!h.hidden && Math.abs(h.x - o.ref.x) < 40 && Math.abs(h.y - o.ref.y) < 30);
  return !h.hidden && Math.abs(h.x - o.x) < 80 && Math.abs(h.y - gAt(G.W, o.x)) < 50;
}
// об'єкт (будівля чи бліндаж) належить команді
function hideOwnedBy(ref, t) { const o = G.objs.find((x) => x.ref === ref); return !!o && o.owner === t; }
function objAt(h) { return G.objs ? G.objs.find((o) => objHas(o, h)) : null; }
function teamScore(t) {
  let s = G.teamPts[t];
  for (const p of G.players) if (p.team === t) s += p.score;
  return s;
}
function ownedCount(t) { return G.objs.filter((o) => o.kind !== 'base' && o.owner === t).length; }

function updateTeam(dt) {
  for (const o of G.objs) {
    const n = [0, 0];
    for (const h of G.humans) if (!h.dead && !h.saved && !h.vehicle && objHas(o, h)) n[h.player.team]++;
    o.n = n;
    const tm = n[0] && !n[1] ? 0 : n[1] && !n[0] ? 1 : -1;
    if (tm >= 0 && tm !== o.owner) {
      if (o.capTeam !== tm) { o.capTeam = tm; o.capT = 0; }
      o.capT += dt * n[tm];
      if (o.capT >= CAP_TIME) captureObj(o, tm);
    } else if (!(n[0] && n[1])) {
      o.capT = Math.max(0, o.capT - dt * CAP_DECAY);
      if (o.capT <= 0) o.capTeam = -1;
    }
  }
  // утримання: +1 команді щодесять секунд за кожен об'єкт
  if ((G.holdT -= dt) <= 0) {
    G.holdT = HOLD_EVERY;
    for (const t of [0, 1]) G.teamPts[t] += ownedCount(t);
  }
}
function captureObj(o, tm) {
  const prev = o.owner;
  o.owner = tm; o.capT = 0; o.capTeam = -1;
  G.teamPts[tm] += CAP_BONUS;
  feed(TEAMS[tm].name + ' захопили ' + o.acc + (prev >= 0 && o.kind !== 'base' ? ' у ' + TEAMS[prev].gen : ''), TEAMS[tm].col);
  Sfx.tone(tm ? 740 : 620, 0.2, 0.12);
  if (o.kind === 'base' && !G.over) {
    G.over = 'team' + tm;
    G.overReason = TEAMS[tm].name + ' захопили ворожу базу';
    Sfx.win();
  }
}
function teamTick(dt) {
  G.timeLeft -= dt;
  if (G.timeLeft > 0) return;
  G.timeLeft = 0;
  const a = teamScore(0), b = teamScore(1);
  G.over = a > b ? 'team0' : b > a ? 'team1' : 'draw';
  G.overReason = 'Час вийшов — рахунок ' + a + ' : ' + b;
}

// ---------- Точки злету ----------
function objPad(o) {
  if (!o.pad) {
    if (o.kind === 'bld') { const x = o.ref.x + o.ref.w / 2; o.pad = { x, y: o.ref.y - 14, obj: o, label: 'дах будівлі' }; }
    else if (o.kind === 'bunker') { const x = o.ref.x + 60; o.pad = { x, y: gAt(G.W, x), obj: o, label: 'біля бліндажа' }; }
  }
  return o.pad;
}
function teamPads(t) {
  const list = G.W.pads.filter((p) => p.team === t);
  for (const o of G.objs) if (o.owner === t && o.kind !== 'base' && o.n[1 - t] === 0) list.push(objPad(o));
  // від своєї бази до фронту (перша — біля бази)
  return list.sort((p, q) => (t ? q.x - p.x : p.x - q.x));
}

// ---------- Відновлення людини ----------
// найближча до фронту своя точка, де немає ворогів
function teamRespawn(h) {
  const t = h.player.team, f = fwdDir(h.player);
  let best = null;
  for (const o of G.objs) {
    if (o.owner !== t || o.n[1 - t] > 0) continue;
    if (!best || (o.x - best.x) * f > 0) best = o;
  }
  if (!best) best = G.objs.find((o) => o.kind === 'base' && o.team === t);
  if (best.kind === 'bunker' && !best.ref.ruined) { h.x = best.ref.x; h.y = best.ref.y; h.hidden = best.ref; return; }
  if (best.kind === 'bld') { const b = best.ref; h.x = b.x + b.w / 2; h.y = b.y + b.h; return; }
  h.x = best.x; h.y = gAt(G.W, best.x);
}
// мета для бота-людини: найближчий не свій об'єкт (з перевагою вперед)
function teamGoal(h) {
  const t = h.player.team, f = fwdDir(h.player);
  let best = null, bs = 1e9;
  for (const o of G.objs) {
    if (o.owner === t) continue;
    const dx = (o.x - h.x) * f;
    const score = Math.abs(o.x - h.x) + (dx < 0 ? 900 : 0) + (o.kind === 'base' ? 600 : 0);
    if (score < bs) { bs = score; best = o; }
  }
  return best;
}

// ---------- Людина бере керування дроном ----------
// Тільки у своїй будівлі, бліндажі чи на базі (там є точка злету). Після вибуху дрона — назад до людини.
function pilotSpot(h) {
  if (!isTeam() || h.dead || h.vehicle) return null;
  const o = objAt(h), t = h.player.team;
  if (!o || o.owner !== t || o.n[1 - t] > 0) return null;
  return o;
}
function tryPilot(h) {
  const o = pilotSpot(h);
  if (!o) { tipOnce(h, 'Дрон можна взяти лише у своїй будівлі, бліндажі чи на базі'); return; }
  const t = h.player.team;
  if (G.stock[t] <= 0) { tipOnce(h, 'Запас дронів скінчився — чекайте НРК'); return; }
  const p = h.player;
  const pad = o.kind === 'base' ? G.W.pads.filter((q) => q.team === t)[0] : objPad(o);
  const dp = { player: p, left: Infinity, total: Infinity, used: 0, drone: null, timer: 0, pad: 0, sel: 0,
    loadout: (p.loadout || DEFAULT_LOADOUT).slice(), temp: true, human: h, fixedPad: pad, t0: G.time };
  G.dps.push(dp);
  p.role = 'drone'; p.ent = dp;
  h.piloting = true; h.aiming = false; h.vx = 0; h.healT = 0;
  if (h.carry) dropCarry(h);
  if (!h.hidden && h.onGround) h.stance = 'crouch';
  feed(p.name + ' керує дроном (' + (pad.label || 'база') + ')', p.color);
  Sfx.click();
}
// повернути керування людині (дрон уже прибрано або прибирається)
function endPilot(dp) {
  const p = dp.player, h = dp.human;
  G.dps = G.dps.filter((x) => x !== dp);
  if (dp.drone) { G.drones = G.drones.filter((x) => x !== dp.drone); dp.drone = null; }
  p.role = 'human'; p.ent = h; h.piloting = false;
  p.loadout = dp.loadout.slice();
  p.cam.x = h.x; p.cam.y = h.y - 100;
}

// ---------- Підвіз: НРК везуть дрони й зброю на базу ----------
const STOCK_START = 8, STOCK_MAX = 14, UGV_EVERY = 30, UGV_SPD = 110, UGV_HP = 100, UGV_DRONES = 4;
function initSupply() {
  G.stock = [STOCK_START, STOCK_START];
  G.ugvs = [];
  G.ugvT = [UGV_EVERY, UGV_EVERY];
  // на старті кілька НРК уже в дорозі — підвіз іде регулярно з перших хвилин
  for (const t of [0, 1]) for (const k of [0.35, 0.6, 0.85]) { spawnUgv(t, true); const u = G.ugvs[G.ugvs.length - 1]; const far = t ? 30 : G.W.width - 30; u.x = far + (baseX(t) - far) * k; u.y = gAt(G.W, u.x); }
}
function baseX(t) { return t ? G.W.start2.x : G.W.start.x; }
// НРК виїжджає з протилежного краю мапи й їде через усю мапу до своєї бази
function spawnUgv(t, quiet) {
  const W = G.W, x = t ? 30 : W.width - 30;
  G.ugvs.push({ team: t, player: { team: t }, x, y: gAt(W, x), dir: t ? 1 : -1, hp: UGV_HP, ang: 0, wheel: 0 });
  if (!quiet) feed('НРК ' + TEAMS[t].gen + ' виїхав із підвозом', TEAMS[t].col);
}
function ugvRect(u) { return { x: u.x - 24, y: u.y - 20, w: 48, h: 20 }; }
function updateSupply(dt) {
  const W = G.W;
  for (const t of [0, 1]) if ((G.ugvT[t] -= dt) <= 0) { G.ugvT[t] = UGV_EVERY; spawnUgv(t, true); }
  for (const u of G.ugvs) {
    if (u.dead) continue;
    u.x += u.dir * UGV_SPD * dt; u.wheel += dt * 10;
    u.y = gAt(W, u.x);
    u.ang = Math.atan2(gAt(W, u.x + 14) - gAt(W, u.x - 14), 28);
    if ((baseX(u.team) - u.x) * u.dir <= 0) deliverUgv(u);
  }
  G.ugvs = G.ugvs.filter((u) => !u.dead);
}
function deliverUgv(u) {
  const t = u.team, W = G.W, bx = baseX(t);
  u.dead = true;
  const got = Math.min(UGV_DRONES, STOCK_MAX - G.stock[t]);
  G.stock[t] += got;
  // зброя й припаси біля бази (не більше 4 штук, щоб не завалити)
  const near = W.pickups.filter((p) => !p.taken && Math.abs(p.x - bx) < 140).length;
  for (let i = 0; i < 2 && near + i < 4; i++) {
    const x = bx + rand(-90, 90);
    W.pickups.push({ type: weighted({ rifle: 1, shotgun: 0.6, grenade: 1.2, medkit: 0.8 }), x, y: gAt(W, x) });
  }
  feed('НРК ' + TEAMS[t].gen + ' доставив ' + got + ' дрони й зброю на базу', TEAMS[t].col);
  Sfx.tone(520, 0.12, 0.08);
}
function hurtUgv(u, dmg, by) {
  if (u.dead || dmg <= 0) return;
  u.hp -= dmg;
  if (u.hp > 0) return;
  u.dead = true;
  explosionFx(u.x, u.y - 10, 50, 60);
  for (let i = 0; i < 10; i++) G.parts.push({ type: 'debris', x: u.x, y: u.y - 10, vx: rand(-200, 200), vy: rand(-300, -60), life: rand(0.6, 1.2), max: 1.2, col: '#3a3f33' });
  feed('НРК ' + TEAMS[u.team].gen + ' знищено — підвіз не доїхав', '#f2994a');
  if (by && by.team !== u.team) G.teamPts[by.team] += 2;
}
// вибух поруч із НРК
function blastUgvs(x, y, power, radius) {
  if (!G.ugvs) return;
  for (const u of G.ugvs) {
    const d = rectDist(x, y, ugvRect(u));
    if (d < radius * 0.7) hurtUgv(u, power * 1.4 * (1 - d / radius), G.blastBy);
  }
}
function nearestEnemyUgv(d, r) {
  let best = null, bd = r;
  for (const u of G.ugvs || []) {
    if (u.dead || u.team === d.player.team) continue;
    const dd = dist(d.x, d.y, u.x, u.y - 10);
    if (dd < bd) { bd = dd; best = u; }
  }
  return best;
}

// ---------- Обвал будівлі: під руїнами — бліндаж із тунелем ----------
const COLLAPSE_AT = 0.25; // будівля падає, коли від конструкції лишилось менше 25%
function bldArea(b) {
  let a = 0;
  for (const s of G.W.solids) if (s.bld === b && s.type !== 'plywood') a += s.w * s.h;
  return a;
}
function checkCollapse(b) {
  if (!b || b.ruined || !b.area0) return;
  if (bldArea(b) < b.area0 * COLLAPSE_AT) collapseBuilding(b);
}
function collapseBuilding(b) {
  const W = G.W, x0 = b.x, x1 = b.x + b.w, g = b.y + b.h, cx = b.x + b.w / 2;
  b.ruined = true; b.net = false;
  const inside = (s) => s.x >= x0 - 2 && s.x + s.w <= x1 + 2 && s.y >= b.y - 20 && s.y < g;
  for (const s of W.solids) if (s.bld === b || (s.type === 'plywood' && inside(s))) {
    for (let i = 0; i < Math.min(6, 1 + (s.w * s.h) / 300); i++) G.parts.push({ type: 'debris', x: s.x + rand(0, s.w), y: s.y + rand(0, s.h), vx: rand(-160, 160), vy: rand(-200, 0), life: rand(0.8, 1.6), max: 1.6, col: '#7a5c48' });
  }
  W.solids = W.solids.filter((s) => !(s.bld === b || (s.type === 'plywood' && inside(s))));
  W.covers = W.covers.filter((c) => !(c.type === 'ruin' && c.x > x0 - 2 && c.x < x0 + 20));
  W.ladders = W.ladders.filter((l) => !(l.x > x0 && l.x < x1 && l.bottom <= g + 1));
  W.props = W.props.filter((p) => !(p.x > x0 && p.x < x1 && p.y < g - 4));
  for (const pk of W.pickups) if (pk.x > x0 && pk.x < x1 && pk.y < g - 4) pk.y = gAt(W, pk.x); // знахідки падають на землю
  for (const m of W.mounts.filter((m) => m.b === b)) if (m.user) leaveMount(m.user);
  W.mounts = W.mounts.filter((m) => m.b !== b);
  for (let i = 0; i < 24; i++) G.parts.push({ type: 'smoke', x: rand(x0, x1), y: g - rand(0, b.h * 0.6), vx: rand(-30, 30), vy: rand(-40, -5), life: rand(2, 4), max: 4, size: rand(18, 34) });
  Sfx.boom(true);
  // бліндаж: підвальний стає звичайним, інакше — новий посередині
  let bunker = W.hides.find((sp) => sp.type === 'bunker' && sp.basement && sp.x > x0 && sp.x < x1);
  if (bunker) { bunker.basement = false; bunker.ruined = false; bunker.hp = HIDE_HP.bunker; }
  else { bunker = { type: 'bunker', x: cx, y: gAt(W, cx), hp: HIDE_HP.bunker }; W.hides.push(bunker); }
  bunker.fromRuin = true;
  // тунель під руїнами з виходами в обидва боки
  const a = bunker.x - 130, bb = bunker.x + 130;
  const tun = { type: 'pipe', style: 'dug', a, b: bb, depth: TUN_DEPTH, exits: [{ x: a, dir: -1, kind: 'ramp' }, { x: bb, dir: 1, kind: 'ramp' }], dug: true };
  tun.exits.forEach((e) => tunExitGeo(W, tun, e));
  W.hides.push(tun);
  buildBuckets(W);
  feed('Будівлю зруйновано — під руїнами бліндаж із тунелем', '#f2994a');
  // командний режим: прапор зникає, об'єкт стає бліндажем (звідти теж можна запускати дрони)
  if (isTeam()) {
    const o = G.objs.find((x) => x.ref === b);
    if (o) Object.assign(o, { kind: 'bunker', ref: bunker, x: bunker.x, owner: -1, capT: 0, capTeam: -1, pad: null, name: 'бліндаж у руїнах', acc: 'бліндаж у руїнах' });
  }
}
