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
const CAP_TIME = 15, HOLD_EVERY = 10, CAP_BONUS = 2;
const TEAM_HUMANS = 4, TEAM_DRONES = 3;      // мінімум у кожній команді (решту доповнюють боти)
const BASE_ONLY = { rifle: 1, shotgun: 1, medkit: 1, grenade: 1, ammo: 1 }; // це лежить лише на базах
const TEAM_BONUS = { armor: 0.6, reb: 0.4, detector: 0.7, shovel: 0.6 };

function isTeam() { return !!G && G.mode === 'team'; }
// однакова команда (для гравців); поза командним режимом — ніхто не союзник
function allyP(a, b) { return isTeam() && !!a && !!b && a.team === b.team; }
function ally(a, b) { return allyP(a && a.player, b && b.player); }
function fwdDir(p) { return isTeam() && p.team === 1 ? -1 : 1; }

function initTeam() {
  const W = G.W;
  G.teamPts = [0, 0]; G.holdT = HOLD_EVERY;
  const B = W.baseB || [];
  G.objs = [
    { kind: 'base', ref: B[0], x: B[0] ? B[0].x + B[0].w / 2 : W.start.x, owner: 0, team: 0, capT: 0, capTeam: -1, n: [0, 0], name: 'база синіх', acc: 'базу синіх' },
    { kind: 'base', ref: B[1], x: B[1] ? B[1].x + B[1].w / 2 : W.start2.x, owner: 1, team: 1, capT: 0, capTeam: -1, n: [0, 0], name: 'база жовтих', acc: 'базу жовтих' },
  ];
  for (const b of W.backs) if (!b.base) G.objs.push({ kind: 'bld', ref: b, x: b.x + b.w / 2, owner: -1, capT: 0, capTeam: -1, n: [0, 0], name: 'будівля', acc: 'будівлю' });
  // підземні ходи (тунелі й колектори) — теж об'єкти з прапором
  for (const sp of W.hides) if (sp.type === 'pipe') { const nm = sp.style === 'sewer' ? 'колектор' : 'тунель'; G.objs.push({ kind: 'tunnel', ref: sp, x: (sp.a + sp.b) / 2, owner: -1, capT: 0, capTeam: -1, n: [0, 0], name: nm, acc: nm }); }
  G.objs.sort((a, b) => a.x - b.x);
}
// чи людина «тримає» об'єкт
function objHas(o, h) {
  if (o.kind === 'bld' || (o.kind === 'base' && o.ref)) return bldUnder(h) === o.ref;
  if (o.kind === 'tunnel') return h.hidden === o.ref;
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
      o.absT = 0;
      o.capT += dt * n[tm];
      if (o.capT >= CAP_TIME) captureObj(o, tm);
    } else if (!(n[0] && n[1])) {
      // усі вийшли — прогрес захоплення втрачено (після 0,5 с, щоб мить поза об'єктом не скидала його)
      o.absT = (o.absT || 0) + dt;
      if (o.absT > 0.5) { o.capT = 0; o.capTeam = -1; }
    }
  }
  // тривога: ворог захоплює головну базу
  const al = baseAlert();
  for (const o of G.objs) if (o.kind === 'base' && o !== al) o.alarmed = false;
  if (al) {
    if (!al.alarmed) { al.alarmed = true; feed('⚠ ТРИВОГА! ' + TEAMS[al.capTeam].name + ' захоплюють ' + al.acc + '!', '#ff4040'); G.alarmT = 0; }
    if ((G.alarmT = (G.alarmT || 0) - dt) <= 0) { G.alarmT = 0.7; Sfx.tone(980, 0.18, 0.12, 'square'); }
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
  if (o.kind !== 'base') spawnGuards(o, tm);
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
    else if (o.kind === 'tunnel') { const e = o.ref.exits[0], x = clamp(e ? e.tx + 50 : o.x, 30, G.W.width - 30); o.pad = { x, y: gAt(G.W, x), obj: o, label: 'біля тунелю' }; }
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
  if (best.kind === 'tunnel' && best.ref.exits.length) { const e = best.ref.exits[0]; h.x = e.tx; h.y = e.ty; enterHide(h, best.ref); return; }
  if (best.kind === 'bld') { const b = best.ref; h.x = b.x + b.w / 2; h.y = b.y + b.h; return; }
  h.x = best.x; h.y = gAt(G.W, best.x);
}
// мета для бота-людини: найближчий не свій об'єкт (з перевагою вперед)
function teamGoal(h) {
  const al = baseAlert();
  if (al && !h.guard) return al; // базу захоплюють — усі туди
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

// головна база, яку зараз захоплює ворог
function baseAlert() {
  if (!G.objs) return null;
  return G.objs.find((o) => o.kind === 'base' && o.capT > 0 && o.capTeam >= 0 && o.capTeam !== o.owner) || null;
}
// ---------- Охорона: 2 боти в щойно захопленому об'єкті (не відроджуються) ----------
const GUARDS_PER_CAP = 2, GUARDS_MAX = 10;
function spawnGuards(o, t) {
  const alive = G.humans.filter((h) => h.guard && !h.dead && h.player.team === t).length;
  for (let k = 0; k < GUARDS_PER_CAP && alive + k < GUARDS_MAX; k++) {
    G.guardN = (G.guardN || 0) + 1;
    const p = { name: 'Охоронець ' + TEAMS[t].short + G.guardN, color: TEAMS[t].cols[k % 2], role: 'human', bot: true, guard: true, cam: { x: 0, y: 0, wide: false }, idx: G.players.length, score: 0, team: t };
    p.ctrl = new BotController(p, 1);
    const h = makeHuman(p, o.x);
    h.lives = 1; h.guard = o; h.weapon = makeWeapon('rifle'); h.grenades = 1; h.protT = 1;
    if (o.kind === 'bld') { const b = o.ref; h.x = b.x + b.w * (0.3 + 0.4 * k); h.y = b.y + b.h; h.facing = k ? -1 : 1; }
    else if (o.kind === 'tunnel' && o.ref.exits.length) { const e = o.ref.exits[k % o.ref.exits.length]; h.x = e.tx; h.y = e.ty; enterHide(h, o.ref); }
    else { h.x = o.x + (k ? 20 : -20); h.y = gAt(G.W, h.x); }
    G.humans.push(h); G.players.push(p); p.ent = h;
  }
  feed('У ' + o.acc + ' заступила охорона (' + TEAMS[t].name.toLowerCase() + ')', TEAMS[t].col);
}
// межі, в яких ходить охорона будівлі
function guardBounds(o) {
  if (!o || o.kind !== 'bld' || o.ref.ruined) return null;
  return { x0: o.ref.x + 26, x1: o.ref.x + o.ref.w - 26 };
}
// ---------- Учасники ----------
// у кожній команді щонайменше TEAM_HUMANS людей і TEAM_DRONES дронів — бракує, доповнюємо ботами
function fillTeams(slots) {
  const out = slots.map((s, i) => Object.assign({}, s, { team: s.team === 1 ? 1 : s.team === 0 ? 0 : i % 2 }));
  let k = 0;
  for (const t of [0, 1]) for (const role of ['human', 'drone']) {
    const need = (role === 'human' ? TEAM_HUMANS : TEAM_DRONES) - out.filter((s) => s.team === t && s.role === role).length;
    for (let i = 0; i < need; i++) { k++; out.push({ bot: true, role, team: t, level: 1, scheme: 'fill' + k, name: 'Бот ' + TEAMS[t].short + k, color: TEAMS[t].col }); }
  }
  return out;
}
// зброя, набої, аптечки й гранати — лише на базах (стартовий запас; далі довозять НРК)
function baseOnlyPickups() {
  const W = G.W;
  W.pickups = W.pickups.filter((p) => !BASE_ONLY[p.type]);
  for (const t of [0, 1]) {
    const bx = baseX(t);
    for (const type of ['rifle', 'rifle', 'shotgun', 'ammo', 'medkit', 'grenade']) { const x = basePickupX(t); W.pickups.push({ type, x, y: gAt(W, x) }); }
  }
}
// вільне місце для знахідки на першому поверсі бази (не впритул до інших)
function basePickupX(t) {
  const bx = baseX(t);
  let x = bx;
  for (let k = 0; k < 14; k++) {
    x = bx + rand(-160, 160);
    if (!G.W.pickups.some((p) => !p.taken && Math.abs(p.x - x) < 38)) break;
  }
  return x;
}
// ворожий дрон збито дроном (вибухом чи тараном)
function droneDowned(e, by) {
  if (!G.drones.includes(e)) return;
  if (e.hp > 3) { e.hp -= 3; return; }
  removeDrone(e);
  G.stats.shotDown++;
  feed(by.name + ' збив ворожий дрон (' + e.player.name + ')', TEAMS[by.team].col);
  explosion(e.x, e.y, 30, 55);
  by.score++;
}
function nearestEnemyDrone(d, r) {
  let best = null, bd = r;
  for (const e of G.drones) {
    if (e === d || allyP(e.player, d.player) || e.onPad) continue;
    const dd = dist(d.x, d.y, e.x, e.y);
    if (dd < bd) { bd = dd; best = e; }
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
const STOCK_START = 12, STOCK_MAX = 20, UGV_EVERY = 30, UGV_SPD = 110, UGV_HP = 100, UGV_DRONES = 6;
function initSupply() {
  G.stock = [STOCK_START, STOCK_START];
  G.ugvs = [];
  G.ugvT = [3, 3]; // перший НРК — щойно з'явиться захоплений об'єкт
}
function baseX(t) { return t ? G.W.start2.x : G.W.start.x; }
// НРК виїжджає із захопленого об'єкта й їде до своєї бази
function spawnUgv(t, quiet, x) {
  const W = G.W;
  G.ugvs.push({ team: t, player: { team: t }, x, y: gAt(W, x), dir: Math.sign(baseX(t) - x) || (t ? 1 : -1), hp: UGV_HP, ang: 0, wheel: 0 });
  if (!quiet) feed('НРК ' + TEAMS[t].gen + ' виїхав із підвозом', TEAMS[t].col);
}
function ugvRect(u) { return { x: u.x - 24, y: u.y - 20, w: 48, h: 20 }; }
function updateSupply(dt) {
  const W = G.W;
  for (const t of [0, 1]) if ((G.ugvT[t] -= dt) <= 0) {
    // їздять лише від захоплених об'єктів (не від бази й не впритул до неї)
    const src = G.objs.filter((o) => o.owner === t && o.kind !== 'base' && Math.abs(o.x - baseX(t)) > 300);
    if (!src.length) { G.ugvT[t] = 3; continue; }
    G.ugvT[t] = UGV_EVERY; spawnUgv(t, true, pick(src).x);
  }
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
  const near = W.pickups.filter((p) => !p.taken && Math.abs(p.x - bx) < 180).length;
  for (let i = 0; i < 3 && near + i < 7; i++) {
    const x = basePickupX(t);
    W.pickups.push({ type: weighted({ rifle: 0.7, shotgun: 0.5, ammo: 1.5, grenade: 1, medkit: 1 }), x, y: gAt(W, x) });
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
  if (!b || b.ruined || !b.area0 || b.base) return; // база не падає
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
  // тунель під руїнами з виходами в обидва боки
  const a = cx - 130, bb = cx + 130;
  const tun = { type: 'pipe', style: 'dug', a, b: bb, depth: TUN_DEPTH_TALL, tall: true, exits: [{ x: a, dir: -1, kind: 'ramp' }, { x: bb, dir: 1, kind: 'ramp' }], dug: true };
  tun.exits.forEach((e) => tunExitGeo(W, tun, e));
  W.hides.push(tun);
  buildBuckets(W);
  feed('Будівлю зруйновано — під руїнами підземний хід', '#f2994a');
  // командний режим: прапор зникає, об'єкт стає бліндажем (звідти теж можна запускати дрони)
  if (isTeam()) {
    const o = G.objs.find((x) => x.ref === b);
    if (o) Object.assign(o, { kind: 'tunnel', ref: tun, x: cx, owner: -1, capT: 0, capTeam: -1, pad: null, name: 'хід під руїнами', acc: 'хід під руїнами' });
  }
}
