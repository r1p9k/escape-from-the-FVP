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
