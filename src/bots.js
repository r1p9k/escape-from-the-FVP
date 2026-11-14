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

// у кого стріляти: видимий дрон у межах дальності, інакше (у командах) ворожа людина в прямій видимості
function botShootTarget(h, drone, td, L) {
  const range = WEAPONS[h.weapon.type].range;
  if (drone && td < range * (0.6 + 0.3 * L.aim)) return drone;
  if (!isTeam()) return null;
  let best = null, bd = range * 0.75;
  for (const o of G.humans) {
    if (o.dead || o.saved || covered(o) || o.vehicle || allyP(o.player, h.player)) continue;
    const dd = dist(h.x, h.y - 30, o.x, o.y - 25);
    if (dd < bd && Math.abs(o.x - h.x) > 30 && lineOfSight(G.W, h.x, h.y - 34, o.x, o.y - 25)) { bd = dd; best = o; }
  }
  return best ? { x: best.x, y: best.y - HUMAN_DIM[best.stance].h * 0.55, vx: best.vx, vy: best.vy } : null;
}
function thinkHuman(b, s, dt) {
  const h = b.p.ent, m = b.m, L = b.L, W = G.W;
  let shootT = null;
  if (h.dead || h.saved) return;
  // загрози: видимі дрони + ті, що чути зовсім поруч
  let threat = null, td = 1e9, hear = 1e9;
  for (const d of G.drones) {
    if (ally(d, h)) continue; // свої дрони — не загроза
    const dd = dist(d.x, d.y, h.x, h.y - 25);
    if (!d.landed) hear = Math.min(hear, dd); // «ждуна» на землі не чути
    // бачить (не крізь стіни) або чує зовсім поруч
    if (dd < td && (droneSeenBy(d, h) || (!d.landed && dd < 260))) { td = dd; threat = d; }
  }
  // реакція з затримкою (залежить від складності)
  if (threat && td < 450) m.reactT += dt; else m.reactT = 0;
  const danger = threat && td < 420 && m.reactT > 0.6 - L.react * 0.5;
  const visibleThreat = threat && droneSeenBy(threat, h, true);

  if (h.vehicle) {
    const v = h.vehicle;
    if (h.seat === 'driver') {
      if (fwdDir(b.p) > 0) s.right = true; else s.left = true;
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

  if (h.working && h.working.kind === 'fort') return; // облаштовує позицію — не смикати
  if (h.hidden) {
    const sp = h.hidden;
    // натягнути маскувальну сітку на свою схованку (і зберегти точку відновлення)
    if (sp.type !== 'pipe' && !sp.net && h.nets > 0 && !h.hideAnim) { s.aim = true; b.tap(s, 'interact'); return; }
    m.safeT = hear < 600 ? 0 : m.safeT + dt;
    m.hideT = (m.hideT || 0) + dt;
    // з нори — відстрілюватися, визираючи з отвору
    const pa = canPeek(sp) && !h.hideAnim && h.weapon && visibleThreat ? botAim(b, sp.x, sp.y - (sp.type === 'bunker' ? 16 : 7), threat, WEAPONS[h.weapon.type].speed) : null;
    const inSector = pa != null && aimRel(pa) >= AIM_SECTOR[sp.type][0] && aimRel(pa) <= AIM_SECTOR[sp.type][1];
    if (inSector && td < WEAPONS[h.weapon.type].range * (0.55 + 0.3 * L.aim)) {
      s.aim = true;
      s.aimAngle = pa;
      m.aimT += dt;
      if (m.aimT > 0.35 - 0.15 * L.react) s.fire = true;
      m.hideT = 0;
      return;
    }
    m.aimT = 0;
    if (false) {    } else if (isTeam() && h.smokeT <= 0 && (objAt(h) || {}).owner !== h.player.team && objAt(h)) { /* тримаємо бліндаж, поки не захопимо */ }
    else if (m.safeT > 2.5 || h.smokeT > 0.4 || m.hideT > 25) { b.tap(s, 'interact'); m.hideCd = 4; m.hideT = 0; }
    return;
  }

  m.hideCd -= dt; m.noVehT -= dt; m.hideT = 0;
  if (Math.abs(h.vx) > 20) m.goDir = Math.sign(h.vx);
  const fwd = fwdDir(b.p);
  let dir = fwd;    // куди бігти
  let stop = false; // зупинитися й причаїтися
  let hold = false; // командний режим: стояти на об'єкті, поки не захопимо
  if (isTeam() && !h.guard) {
    const at = objAt(h);
    if (at && (at.owner !== h.player.team || at === baseAlert())) hold = true;
    else {
      const goal = teamGoal(h);
      if (goal) {
        let gx = goal.kind === 'bld' || (goal.kind === 'base' && goal.ref) ? goal.ref.x + goal.ref.w / 2 : goal.x;
        // до тунелю — через найближчий вихід
        if (goal.kind === 'tunnel' && goal.ref.exits.length && pipeAt(W, h.x, h.y) !== goal.ref) {
          const e = goal.ref.exits.reduce((a, q) => (Math.abs(q.tx - h.x) < Math.abs(a.tx - h.x) ? q : a));
          gx = e.tx;
          // лаз — униз драбиною; спуск — просто забігти (далі — до середини галереї)
          if (Math.abs(e.tx - h.x) < 10 && h.onGround && Math.abs(e.ty - h.y) < 6) { if (e.kind === 'shaft') { if (h.stance !== 'stand') b.tap(s, 'up'); else b.tap(s, 'down'); return; } gx = e.bx; }
        }
        dir = Math.sign(gx - h.x) || fwd;
        if (goal.kind === 'bunker' && Math.abs(goal.ref.x - h.x) < 24 && m.hideCd <= 0 && !goal.ref.ruined) { b.tap(s, 'interact'); return; }
      }
    }
  }

  if (danger) {
    if (h.reb > 0 && td < 300 && Math.random() < L.react * 0.5) b.tap(s, 'special');
    // схованка поруч?
    if (m.hideCd <= 0) {
      if (nearHide(h) && !nearPickup(h) && !nearVehicle(h)) { b.tap(s, 'interact'); return; }
      let best = null, bd = 220;
      for (const sp of W.hides) {
        if (sp.ruined) continue;
        for (const en of hideEnds(sp)) {
          const dd = Math.abs(en.x - h.x);
          if (dd < bd && (en.x - h.x) * fwd > -120 && Math.abs(en.y - h.y) < 60) { bd = dd; best = en.x; }
        }
      }
      if (best != null) dir = Math.sign(best - h.x) || 1;
    }
    // маскування: якщо в укритті (кущі, окоп, дерева) — лягти й перечекати
    if (!h.weapon && dir === fwd) {
      if (coverFor(h, HUMAN_DIM.stand.h)) stop = true;
      else if (coverFor(h, HUMAN_DIM.prone.h)) { stop = true; if (h.stance !== 'prone') b.tap(s, 'down'); }
    }
  }
  // каністра заважає стріляти — викинути, якщо є зброя й загроза
  if (h.canister && h.weapon && visibleThreat) b.tap(s, 'slot1');
  // перев'язка, коли спокійно
  if (h.hp < 55 && h.medkits > 0 && !danger && h.onGround && h.healT <= 0) b.tap(s, 'slot2');
  if (h.healT > 0 && !danger) stop = true;

  // бонус «Альоша»: увімкнути, коли дрон близько; далі автонаведення — просто стріляти
  if (h.alCharges > 0 && h.alT <= 0 && threat && td < 450 && h.onGround) { s.aim = true; b.tap(s, 'special'); }
  if (h.alT > 0) { s.fire = G.drones.some((d) => dist(d.x, d.y, h.x, h.y - 30) < 900); stop = false; }
  // стрільба: по дрону, а в командах — і по ворожій людині
  else if (h.weapon && h.onGround && (shootT = botShootTarget(h, visibleThreat ? threat : null, td, L))) {
    stop = true;
    // для точності — присісти перед стрільбою (досвідчені боти)
    if (h.stance === 'stand' && L.aim >= 0.8 && td > 200) { if (Math.abs(h.vx) < 140) b.tap(s, 'down'); }
    else s.aim = true;
    const mz = muzzle(h);
    s.aimAngle = botAim(b, mz.x, mz.y, shootT, WEAPONS[h.weapon.type].speed);
    m.aimT += dt;
    if (m.aimT > 0.35 - 0.15 * L.react) s.fire = true;
  } else m.aimT = 0;
  // ---- оборона: ворожа піхота в полі зору — укриття, вогонь з-за нього; поранений відходить. Кожен хоче вижити ----
  const foe = isTeam() ? visibleFoe(h, 560) : null;
  if (foe) { m.foe = foe; m.engT = 6; } else if ((m.engT = (m.engT || 0) - dt) <= 0 || (m.foe && (m.foe.dead || m.foe.saved))) m.foe = null;
  m.atCover = false;
  if (m.foe) {
    const f = m.foe, fdir = Math.sign(f.x - h.x) || 1, fd = Math.abs(f.x - h.x);
    hold = false;
    m.cyc = (m.cyc || 0) + dt;
    const duck = m.cyc % 3.6 > 2.3; // з-за укриття: постріляв — пригнувся
    const coverFight = () => {
      stop = true; m.atCover = true;
      if (duck) { s.aim = false; s.fire = false; if (h.stance === 'stand') b.tap(s, 'down'); }
      else if (!shootT && h.stance !== 'stand') b.tap(s, 'up'); // визирнути
    };
    if ((h.hp < 40 && !(h.healT > 0)) || !h.weapon) {
      // поранений чи без зброї — назад, подалі від ворога, там перев'язатися
      if (!h.guard) { dir = -fdir; stop = false; s.aim = false; s.fire = false; }
      else coverFight();
    } else if (h.guard) coverFight();
    else {
      const cv = coverSpot(h, f, m);
      if (cv != null && Math.abs(cv - h.x) > 7) { dir = Math.sign(cv - h.x); stop = false; s.aim = false; s.fire = false; } // перебіжка до укриття
      else if (cv != null) coverFight();
      else if (fd > 230 && h.onGround && !(m.fortCd > 0) && canFortHere(h)) {
        // укриття нема — окопатися обличчям до ворога
        stop = true; s.aim = false; s.fire = false; h.facing = fdir;
        if (h.stance === 'stand') b.tap(s, 'down'); else { b.tap(s, 'interact'); m.fortCd = 15; }
      } else { stop = true; if (h.stance === 'stand' && !s.aim) b.tap(s, 'down'); }
    }
  }
  m.fortCd = (m.fortCd || 0) - dt;
  // командний режим: граната по ворожій людині на відстані кидка
  m.grenT = (m.grenT || 0) - dt;
  if (isTeam() && h.grenades > 0 && m.grenT <= 0 && h.onGround && !h.carry && !h.canister && !s.fire) {
    let foe = null, fd = 380;
    for (const o of G.humans) {
      if (o.dead || o.saved || o.vehicle || allyP(o.player, h.player)) continue;
      const tx = covered(o) ? null : o.x;
      if (tx == null) continue;
      const dd = Math.abs(tx - h.x);
      if (dd > 110 && dd < fd && Math.abs(o.y - h.y) < 120 && lineOfSight(W, h.x, h.y - 40, o.x, o.y - 20)) { fd = dd; foe = o; }
    }
    if (foe) {
      const a = grenadeAngle(handPos(h), foe.x, foe.y - 10);
      if (a != null) { s.aim = true; s.aimAngle = a; b.tap(s, 'slot3'); m.grenT = 5 + Math.random() * 3; }
    }
  }
  // рукопашна: ворог чи «ждун» впритул — бити; у командах ворога поруч — наздогнати
  const mtg = meleeTarget(h);
  if (mtg && !s.aim && !(h.meleeCd > 0) && (mtg.kind === 'h' || mtg.o.landed || droneSeenBy(mtg.o, h, true))) { s.fire = false; b.tap(s, 'fire'); stop = true; }
  else if (isTeam() && !danger && !h.guard) {
    let foe = null, fd = 160;
    for (const o of G.humans) {
      if (o.dead || o.saved || o.hidden || o.vehicle || allyP(o.player, h.player)) continue;
      const dd = Math.abs(o.x - h.x);
      if (dd < fd && Math.abs(o.y - h.y) < 30) { fd = dd; foe = o; }
    }
    if (foe && (h.grenades <= 0 || fd < 110)) { dir = Math.sign(foe.x - h.x) || dir; hold = false; stop = false; }
  }
  // кидок на землю, коли дрон пікірує впритул
  if (threat && td < 170 && !s.aim && h.stance === 'stand' && Math.abs(h.vx) > 140 && Math.random() < L.react * 0.5) {
    const closing = (threat.vx * (h.x - threat.x) + threat.vy * (h.y - 25 - threat.y)) / Math.max(1, td);
    if (closing > 200) b.tap(s, 'down');
  }

  if (!stop && h.stance !== 'stand') b.tap(s, 'up');
  // перезарядитися, поки спокійно
  if (h.weapon && !s.aim && !danger && h.reloadT <= 0 && h.weapon.mag < Math.min(WEAPONS[h.weapon.type].mag, h.weapon.ammo)) b.tap(s, 'fire');

  // підбір і техніка
  const pk = nearPickup(h);
  if (pk && botWants(h, pk)) b.tap(s, 'interact');
  else if (!isTeam() && m.noVehT <= 0 && nearVehicle(h)) {
    const v = nearVehicle(h);
    if (v.driver || v.fuel > 1.5 || h.canister) b.tap(s, 'interact');
  }

  // довго в диму — вибиратися, не зупинятися
  if (h.gasT > 10) { stop = false; s.aim = false; s.fire = false; }
  // охорона ходить лише всередині свого об'єкта
  if (h.guard) {
    const g = guardBounds(h.guard);
    if (g) {
      if (h.x < g.x0) m.gdir = 1; else if (h.x > g.x1) m.gdir = -1;
      if (!m.gdir || Math.random() < dt * 0.15) m.gdir = m.gdir || (Math.random() < 0.5 ? -1 : 1);
      dir = m.gdir; hold = false;
      if (Math.random() < dt * 0.4) stop = true; // інколи постояти
    } else stop = true;
  }
  if (hold && !danger) stop = true;
  // під землею: тримати тунель — у галереї; інакше — до виходу в потрібний бік (лазом — драбиною нагору)
  if (h.onLadder) { s.up = true; return; }
  const tp = pipeAt(W, h.x, h.y);
  if (tp) {
    if (hold && objAt(h) && objAt(h).ref === tp) {
      const mx = clamp(h.x, tp.a + 20, tp.b - 20);
      if (Math.abs(mx - h.x) > 4) { stop = false; dir = Math.sign(mx - h.x); }
    } else if (!stop) {
      let best = null, bd = 1e9;
      const exs = tp.exits.filter(exitDone);
      for (const e of exs) { const dx = (e.tx - h.x) * dir; if (dx > -6 && dx < bd) { bd = dx; best = e; } }
      if (!best) for (const e of exs) { const dd = Math.abs(e.tx - h.x); if (dd < bd) { bd = dd; best = e; } }
      if (best) {
        if (best.kind === 'shaft' && Math.abs(best.tx - h.x) < 7 && ladderAt(h)) { b.tap(s, 'up'); return; }
        dir = Math.sign(best.tx - h.x) || dir;
      }
      if (danger && !h.weapon && !h.gasT) stop = true; // перечекати під землею
    }
  }
  // розосередження: свої не ходять купою — щоб один скид не накрив двох
  if (G.mode !== 'dm' && !h.guard && !m.atCover) {
    let mate = null, md = BOT_SPREAD;
    for (const o of G.humans) {
      if (o === h || o.dead || o.saved || o.vehicle || o.hidden || (G.mode !== 'escape' && !allyP(o.player, h.player))) continue;
      const dd = Math.abs(o.x - h.x);
      if (dd < md && Math.abs(o.y - h.y) < 90) { md = dd; mate = o; }
    }
    if (!mate) m.spreadT = 0;
    else {
      const ahead = (mate.x - h.x) * dir > 0;
      if (stop) { if (md < BOT_SPREAD * 0.6) { stop = false; dir = Math.sign(h.x - mate.x) || -dir; s.sprint = false; } } // стоїмо — розійтися
      else if (ahead && !danger) {
        // той, хто попереду, — дати йому відійти; якщо він стоїть довго — обійти
        m.spreadT = (m.spreadT || 0) + dt;
        if (m.spreadT < 2.5 || Math.abs(mate.vx) > 30) stop = true;
      } else if (!ahead && h.stamina > 0.3) s.sprint = true; // позаду хтось — відірватися
    }
  }
  if (!stop) {
    if (dir > 0) s.right = true; else s.left = true;
    s.sprint = (danger || h.openTime > 1.5) && h.stamina > 0.05;
    // застряг — стрибок / залізти на уступ
    if (h.onGround && Math.abs(h.vx) < 15) m.stuck += dt; else m.stuck = 0;
    if (m.stuck > 0.2 && h.stance === 'stand') { b.tap(s, 'up'); }
    // міну на шляху перестрибнути
    if (h.onGround && G.mines.some((mi) => mi.arm <= 0 && (mi.x - h.x) * dir > 38 && (mi.x - h.x) * dir < 70 && Math.abs(mi.y - h.y) < 14)) {
      s.sprint = h.stamina > 0.1;
      b.tap(s, 'up');
    }
    if (m.stuck > 3) { s.right = !s.right; s.left = !s.left; if (m.stuck > 3.6) m.stuck = 0; }
  }
}

// найближчий ворог-піхотинець, якого бот бачить
function visibleFoe(h, range) {
  let best = null, bd = range;
  const ey = h.y - HUMAN_DIM[h.stance].h * 0.85;
  for (const o of G.humans) {
    if (o === h || o.dead || o.saved || o.vehicle || covered(o) || allyP(o.player, h.player)) continue;
    const oy = o.y - HUMAN_DIM[o.stance].h * 0.6, dd = dist(h.x, ey, o.x, oy);
    if (dd < bd && lineOfSight(G.W, h.x, ey, o.x, oy)) { bd = dd; best = o; }
  }
  return best;
}
// найближче укриття з нашого боку від ворога: окоп чи вогнева позиція, низька тверда перешкода (за нею)
const COVER_SOLID = { hay: 1, log: 1, block: 1, sandbag: 1, wreck: 1, rubble: 1 };
function coverSpot(h, f, m) {
  const W = G.W, side = Math.sign(h.x - f.x) || 1;
  let best = null, bd = 170;
  const ok = (x) => (x - f.x) * side > 70 && Math.abs(x - h.x) < bd;
  if (m.coverX != null && ok(m.coverX) && Math.abs(m.coverX - h.x) < 40) return m.coverX; // своє укриття не міняти
  for (const c of W.covers) if (c.type === 'trench') {
    const x = clamp(h.x, c.x + 10, c.x + c.w - 10);
    if (ok(x)) { bd = Math.abs(x - h.x); best = x; }
  }
  for (const s of solidsNear(W, h.x - 170, h.x + 170)) {
    if (s.thin || s.dead || !COVER_SOLID[s.type]) continue;
    const g = gAt(W, s.x + s.w / 2);
    if (s.h < 16 || s.y < g - 80 || s.y + s.h < g - 4) continue; // низька перешкода на землі
    const x = side > 0 ? s.x + s.w + 12 : s.x - 12;
    if (ok(x)) { bd = Math.abs(x - h.x); best = x; }
  }
  m.coverX = best;
  return best;
}
const BOT_SPREAD = 125; // скид рве на ~90 — тримаємося далі
function botWants(h, pk) {
  if (pk.type === 'shovel') return false; // боти не копають
  if (pk.type === 'armor') return h.armor <= 0;
  if (pk.type === 'fuel') return !h.canister && !h.weapon;
  if (WEAPONS[pk.type]) return !h.weapon;
  return canTake(h, pk);
}
// кут кидка гранати (низька траєкторія) з точки p у (tx, ty)
function grenadeAngle(p, tx, ty) {
  const dx = tx - p.x, X = Math.abs(dx), Y = p.y - ty, v = GRENADE_SPD, g = THROW_G;
  const disc = v ** 4 - g * (g * X * X + 2 * Y * v * v);
  if (disc < 0 || X < 1) return null;
  const up = Math.atan((v * v - Math.sqrt(disc)) / (g * X)); // кут над горизонтом
  return dx >= 0 ? -up : Math.PI + up;
}
// кущ поблизу точки — сховати «ждуна»
function bushNear(x, r) {
  let best = null, bd = r;
  for (const bu of G.W.bushes) { const dd = Math.abs(bu.x + bu.w / 2 - x); if (dd < bd && bu.w > 40) { bd = dd; best = bu; } }
  return best;
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
    for (const { x: ex, y: ey } of hideEnds(sp)) { const dd = dist(x, y, ex, ey); if (dd < bd) { bd = dd; best = { x: ex, y: ey }; } }
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
    if (h.dead || h.saved || ally(h, d)) continue;
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
  // командний режим: без людей у полі зору — полювати на ворожі НРК з підвозом
  // тривога на базі: дрони летять туди й б'ють ворогів біля неї
  const alB = isTeam() ? baseAlert() : null;
  if (alB) {
    let ab = null, abd = 1e9;
    for (const h of G.humans) {
      if (h.dead || h.saved || covered(h) || ally(h, d) || Math.abs(h.x - alB.x) > 450) continue;
      const dd = dist(d.x, d.y, h.x, h.y);
      if (dd < abd) { abd = dd; ab = h; }
    }
    if (ab) { tgt = ab; m.last = { x: ab.x, y: ab.y, vx: ab.vx }; m.lostT = 0; }
    else if (!tgt) { m.last = { x: alB.x, y: gAt(W, alB.x) - 40, vx: 0 }; m.lostT = 2; }
  }
  const ugvT = !tgt && isTeam() ? nearestEnemyUgv(d, 900 * L.sense) : null;
  const droneT = !tgt && !ugvT && isTeam() ? nearestEnemyDrone(d, 600 * L.sense) : null;

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
  } else if (droneT) {
    // таран ворожого дрона
    const dd = dist(d.x, d.y, droneT.x, droneT.y);
    gx = droneT.x + droneT.vx * 0.25 * L.lead * 2; gy = droneT.y + droneT.vy * 0.25 * L.lead * 2;
    attack = dd < 260; boost = true;
    if (dd < 40) b.tap(s, 'fire');
  } else if (ugvT) {
    const dd = dist(d.x, d.y, ugvT.x, ugvT.y - 10);
    gx = ugvT.x + ugvT.dir * UGV_SPD * 0.3; gy = ugvT.y - 12;
    if (dd < 300) { attack = true; boost = true; } else { gy = ugvT.y - 160; boost = true; }
    if (dd < 30) b.tap(s, 'fire');
  } else if (m.last && m.lostT > 1.2 && m.lostT < 16 && dropCount(d, 'smoke') > 0 && (m.smokeAt = m.smokeAt || nearestHideTo(m.last.x, m.last.y, d))) {
    // людина зникла біля схованки — викурити димом
    const e = m.smokeAt, tf = Math.sqrt((2 * 160) / 900);
    gx = e.x - d.vx * 0.8 * tf; gy = e.y - 160;
    if (Math.abs(d.x + d.vx * 0.8 * tf - e.x) < 22 && Math.abs(d.y - gy) < 60) wantDrop(b, s, d, 'smoke');
  } else if (m.last && m.lostT > 3 && m.lostT < 30 && d.battery < DRONE_BATTERY * 0.55 && m.noAmbush <= 0) {
    // АКБ сідає — сісти «ждуном» попереду, куди бігла людина
    if (m.ambX == null || m.ambX < m.last.x) {
      m.ambX = m.last.x + 450;
      const bu = bushNear(m.ambX, 280); // краще — у кущах, щоб не було видно
      if (bu) m.ambX = bu.x + bu.w / 2;
    }
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
  // без цілі — підібрати бонус у повітрі поруч
  if (!tgt && !descend && G.airBonuses) {
    let bb = null, bd = 650;
    for (const ab of G.airBonuses) if (ab.active) { const dd = dist(ab.x, ab.y, d.x, d.y); if (dd < bd) { bd = dd; bb = ab; } }
    if (bb) { gx = bb.x; gy = bb.y; boost = bd > 250; }
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
