'use strict';
// ===== Світ: рельєф, об'єкти, локації =====
const GS = 16;          // крок карти висот
const BASE_G = 640;     // базовий рівень землі
const CEIL = 24;        // стеля для дронів
const FLOOR_H = 110;    // висота поверху

const MAP_LENGTHS = [
  { id: 'normal', name: 'Звичайна', width: 14000 },
  { id: 'long', name: 'Довга', width: 20000 },
  { id: 'huge', name: 'Дуже довга', width: 28000 },
];
const HIDE_HP = { bunker: 3, burrow: 2 };            // скільки вибухів витримує схованка
const SOLID_HP = { hay: 2, log: 2, block: 3, sandbag: 2 }; // наземні укриття, що руйнуються

const LOCATIONS = [
  { id: 'fields', name: 'Поля' },
  { id: 'forest', name: 'Лісосмуги' },
  { id: 'city', name: 'Зруйноване місто' },
  { id: 'mixed', name: 'Змішана (поля → ліс → місто)' },
];

const FEATURES = {
  fields: { tree: 2.2, trench: 1.4, burrow: 1.6, tunnel: 1.1, hay: 1.6, bush: 2, vehicle: 1.1, wreck: 0.6, house: 0.6, cache: 0.9, open: 1.2 },
  forest: { tree: 4.5, trench: 1.8, burrow: 1.4, log: 2, bush: 2.5, vehicle: 0.8, tunnel: 0.8, cache: 1, open: 0.5 },
  city: { building: 4.5, rubble: 2.2, wreck: 1.8, sewer: 1.4, block: 1.4, vehicle: 1.0, cache: 1, bush: 0.6, tree: 0.4 },
};

function gAt(W, x) {
  const f = clamp(x, 0, W.width) / GS;
  const i = Math.floor(f), t = f - i, g = W.ground;
  return g[i] * (1 - t) + g[Math.min(i + 1, g.length - 1)] * t;
}
function avgGround(W, x0, x1) {
  let s = 0, n = 0;
  for (let x = x0; x <= x1; x += GS) { s += gAt(W, x); n++; }
  return s / Math.max(1, n);
}
function minGround(W, x0, x1) { let m = 1e9; for (let x = x0; x <= x1; x += GS) m = Math.min(m, gAt(W, x)); return m; }
function maxGround(W, x0, x1) { let m = -1e9; for (let x = x0; x <= x1; x += GS) m = Math.max(m, gAt(W, x)); return m; }

function flatten(W, x0, x1, y) {
  if (y == null) y = avgGround(W, x0, x1);
  const ramp = 90;
  for (let i = Math.max(0, Math.floor((x0 - ramp) / GS)); i <= Math.min(W.ground.length - 1, Math.ceil((x1 + ramp) / GS)); i++) {
    const x = i * GS;
    let t = x < x0 ? (x - (x0 - ramp)) / ramp : x > x1 ? (x1 + ramp - x) / ramp : 1;
    t = clamp(t, 0, 1); t = t * t * (3 - 2 * t);
    W.ground[i] = lerp(W.ground[i], y, t);
  }
  return y;
}
function dig(W, x0, x1, depth, edge) {
  edge = edge || 22;
  for (let i = Math.max(0, Math.floor(x0 / GS)); i <= Math.min(W.ground.length - 1, Math.ceil(x1 / GS)); i++) {
    const x = i * GS;
    const e = Math.min(x - x0, x1 - x);
    W.ground[i] += depth * clamp(e / edge, 0, 1);
  }
}

// ---- Окремі елементи ----
function addSolid(W, s) { W.solids.push(s); return s; }

// ---- Тунелі ----
const TUN_DEPTH = 52;   // підлога галереї під поверхнею
const TUN_H = 40;       // висота галереї (людина йде зігнувшись)
const TUN_H_TALL = 64;  // високий хід — на повний зріст
const TUN_DEPTH_TALL = 78;
function tunH(sp) { return sp.tall ? TUN_H_TALL : TUN_H; }
const TUN_K = 1.2;      // нахил спуску (вертикаль на одиницю горизонталі): крутий — вузький отвір, легко перестрибнути
const SHAFT_W = 24;     // ширина лазу з драбиною
const BREAK_HITS = 3;   // скільки вибухів в одному місці обвалюють перекриття тунелю
function tunFloor(W, sp, x) { return gAt(W, x) + sp.depth; }

// ---- Підземні порожнини: тунелі — справжній порожній простір у землі ----
// Для стовпчика x — список вільних проміжків [top, bot] (згори вниз); перший — повітря над землею.
// human: лази для людини прикриті зверху (по них ходять), а кулі, гранати й скиди туди падають.
function pipeSpans(W, sp, x, out, human) {
  const H = tunH(sp), g = gAt(W, x);
  // галерея; крайній спуск сам веде вниз — під ним галерея не тягнеться (інакше «кишеня» внизу)
  if (x >= sp.a && x <= sp.b && !sp.exits.some((e) => e.kind === 'ramp' && (e.dir > 0 ? x > e.bx + 1 && e.bx > sp.b - 14 : x < e.bx - 1 && e.bx < sp.a + 14))) {
    const f = g + sp.depth;
    const br = sp.breaks && sp.breaks.find((q) => x >= q.a && x <= q.b);
    if (br) out.push([-1e9, f - br.fill * H]); // перекриття обвалилося: яма, засипана на fill
    else out.push([f - H, f]);
  }
  for (const e of sp.exits) {
    if (e.kind === 'shaft') { if (Math.abs(x - e.tx) <= SHAFT_W / 2) out.push([human ? g + 3 : -1e9, e.by]); }
    else {
      // спуск — відкрита траншея; унизу рівний майданчик углиб галереї, щоб зійти на її підлогу
      const fx = e.bx - e.dir * 16;
      if (x >= Math.min(fx, e.tx) - 1 && x <= Math.max(fx, e.tx) + 1) out.push([-1e9, lerp(e.by, e.ty, rampU(e, x))]);
    }
  }
  if (sp.links) for (const l of sp.links) if (x >= l.x1 && x <= l.x2) { const f = lerp(l.y1, l.y2, (x - l.x1) / ((l.x2 - l.x1) || 1)); out.push([f - l.h, f]); }
}
function pipeBounds(sp) {
  let x0 = sp.a, x1 = sp.b;
  for (const e of sp.exits) { x0 = Math.min(x0, e.tx, e.bx); x1 = Math.max(x1, e.tx, e.bx); }
  if (sp.links) for (const l of sp.links) { x0 = Math.min(x0, l.x1); x1 = Math.max(x1, l.x2); }
  sp.x0 = x0 - SHAFT_W; sp.x1 = x1 + SHAFT_W;
}
// геометрія тунелів змінилася — скинути кеш, оновити драбини в лазах
function cavDirty(W) {
  W.cavMap = new Map();
  W.pipes = W.hides.filter((h) => h.type === 'pipe');
  W.pipes.forEach(pipeBounds);
  W.ladders = W.ladders.filter((l) => !l.shaft);
  for (const sp of W.pipes) for (const e of sp.exits) if (e.kind === 'shaft') W.ladders.push({ x: e.tx, top: e.ty, bottom: e.by, shaft: true, sewer: sp.style === 'sewer' });
}
function cavSpans(W, x, human) {
  x = Math.round(x);
  const k = x * 2 + (human ? 1 : 0);
  let S = W.cavMap.get(k);
  if (S) return S;
  const g = gAt(W, x), iv = [];
  for (const sp of W.pipes) if (x >= sp.x0 && x <= sp.x1) pipeSpans(W, sp, x, iv, human);
  S = [{ top: -1e9, bot: g, surf: true }];
  iv.sort((p, q) => p[0] - q[0]);
  for (const [t, b] of iv) {
    const L = S[S.length - 1];
    if (t <= L.bot + 0.5) { if (b > L.bot) { L.bot = b; L.surf = false; } }
    else S.push({ top: t, bot: b });
  }
  W.cavMap.set(k, S);
  return S;
}
// точка в суцільній землі (не в повітрі й не в тунелі)
function dirtAt(W, x, y) {
  if (y <= gAt(W, x) + 1) return false;
  if (!W.pipes || !W.pipes.length) return true;
  for (const s of cavSpans(W, x)) if (y >= s.top - 0.5 && y <= s.bot + 1) return false;
  return true;
}
// тунель, у порожнині якого точка (ноги людини) — або null
function pipeAt(W, x, y) {
  if (!W.pipes || y < gAt(W, x) + 4) return null;
  for (const sp of W.pipes) {
    if (x < sp.x0 || x > sp.x1) continue;
    const iv = [];
    pipeSpans(W, sp, x, iv, false);
    if (iv.some(([t, b]) => y >= t - 2 && y <= b + 3)) return sp;
  }
  return null;
}
// геометрія виходу: основа на підлозі галереї, верх на поверхні
function tunExitGeo(W, sp, e) {
  e.bx = e.x; e.by = tunFloor(W, sp, e.x);
  if (e.kind === 'shaft') { e.tx = e.x; e.ty = gAt(W, e.x); }
  else {
    let dx = 0;
    while (dx < 300 && e.by - TUN_K * dx > gAt(W, e.bx + e.dir * dx)) dx += 1;
    e.tx = e.bx + e.dir * dx; e.ty = gAt(W, e.tx);
  }
  e.len = Math.max(10, Math.hypot(e.tx - e.bx, e.ty - e.by));
  return e;
}
// відкрита частина пологого спуску: проміжок над похилою підлогою (туди можна забігти, а можна перестрибнути)
function rampOpen(e, x) {
  if (e.kind !== 'ramp') return false;
  const lo = Math.min(e.bx, e.tx), hi = Math.max(e.bx, e.tx);
  return x > lo && x < hi && Math.abs(x - e.tx) > 5;
}
function rampU(e, x) { return clamp((x - e.bx) / ((e.tx - e.bx) || 1), 0, 1); }
// каміння під землею: лопатою не прокопати (кілька на мапу)
function rockIn(x0, x1) {
  const W = G.W;
  if (!W || !W.rocks) return null;
  for (const r of W.rocks) if (x1 > r.a && x0 < r.b) return r;
  return null;
}
function placeRocks(W, width) {
  W.rocks = [];
  const n = Math.max(2, Math.round(width / 5500));
  for (let k = 0, tries = 0; k < n && tries < 80; tries++) {
    const w = rand(55, 110), a = rand(500, width - 500 - w), b = a + w;
    if (W.hides.some((h) => (h.type === 'pipe' ? b > h.a - 200 && a < h.b + 200 : Math.abs(h.x - (a + b) / 2) < 120))) continue;
    if (W.rocks.some((r) => b > r.a - 400 && a < r.b + 400)) continue;
    W.rocks.push({ a, b, top: rand(6, 16), h: rand(70, 110), seed: RND() }); k++;
  }
}
function tunExitPos(e, u) { return { x: lerp(e.bx, e.tx, u), y: lerp(e.by, e.ty, u) }; }
// входи в схованку (для тунелю — верх кожного виходу)
function hideEnds(sp) { return sp.type === 'pipe' ? sp.exits.map((e) => ({ x: e.tx, y: e.ty, e })) : [{ x: sp.x, y: sp.y }]; }

const F = {
  open() { return rand(150, 350); },

  tree(W, x) {
    const w = rand(240, 540);
    const gmin = minGround(W, x, x + w), gmax = maxGround(W, x, x + w);
    for (let tx = x + 15; tx < x + w - 10; tx += rand(28, 52)) {
      W.trees.push({ x: tx, h: rand(150, 220), r: rand(30, 48), kind: RND() < 0.3 ? 'poplar' : 'oak', seed: RND() });
    }
    for (let bx = x; bx < x + w; bx += rand(40, 70)) W.bushes.push({ x: bx, w: rand(50, 90), h: rand(55, 75), seed: RND() });
    W.covers.push({ type: 'trees', x, w, y: gmin - 240, h: gmax - gmin + 250 });
    return w;
  },

  bush(W, x) {
    const w = rand(60, 120);
    const g = gAt(W, x + w / 2);
    const cover = { type: 'bush', x, w, y: g - 44, h: 56 };
    W.bushes.push({ x, w, h: 46, seed: RND(), cover });
    W.covers.push(cover);
    return w;
  },

  trench(W, x) {
    const w = rand(280, 480), depth = rand(42, 50);
    const rim = flatten(W, x, x + w);
    dig(W, x, x + w, depth);
    W.covers.push({ type: 'trench', x: x + 16, w: w - 32, y: rim - 2, h: depth + 12 });
    const bx = x + (RND() < 0.5 ? w * 0.25 : w * 0.75);
    // під окопом — підземний хід: пологі спуски на кінцях, посередині — лаз із драбиною просто з окопу
    const ta = x + 50, tb = x + w - 50;
    W.hides.push({ type: 'pipe', style: 'dug', a: ta, b: tb, depth: TUN_DEPTH, exits: [{ x: ta + 8, dir: -1, kind: 'ramp' }, { x: tb - 8, dir: 1, kind: 'ramp' }, { x: (ta + tb) / 2, dir: 1, kind: 'shaft' }] });
    W.decor.push({ type: 'sandbags', x: x - 30, w: 40 }, { type: 'sandbags', x: x + w - 10, w: 40 });
    if (RND() < 0.3) W.pickups.push({ type: pickupType(), x: bx + 40 });
    return w;
  },

  burrow(W, x) {
    W.hides.push({ type: 'burrow', x });
    return 70;
  },

  // виритий тунель: галерея під землею, виходи — похилі спуски або вертикальні лази
  tunnel(W, x) {
    // частина ходів — високі, на повний зріст (глибші); на кінцях — пологі спуски, посередині — лази з драбинами
    const tall = RND() < 0.4, m = (tall ? TUN_DEPTH_TALL : TUN_DEPTH) / TUN_K + 30;
    const len = rand(220, 400), a = x + m, b = a + len;
    flatten(W, x, b + m);
    const exits = [{ x: a + 6, dir: -1, kind: 'ramp' }, { x: b - 6, dir: 1, kind: 'ramp' }];
    if (len > 250 && RND() < 0.7) exits.push({ x: lerp(a, b, rand(0.4, 0.6)), dir: RND() < 0.5 ? -1 : 1, kind: 'shaft' });
    W.hides.push({ type: 'pipe', style: 'dug', a, b, depth: tall ? TUN_DEPTH_TALL : TUN_DEPTH, tall, exits });
    return len + m * 2;
  },

  // каналізація: бетонний колектор глибше, вниз — лазами з люками
  sewer(W, x) {
    const len = rand(360, 660);
    W.hides.push({ type: 'pipe', style: 'sewer', a: x, b: x + len, depth: 92, tall: true, exits: [{ x: x + 12, dir: -1, kind: 'shaft' }, { x: x + len - 12, dir: 1, kind: 'shaft' }] });
    return 60;
  },

  hay(W, x) {
    const g = gAt(W, x + 35);
    addSolid(W, { type: 'hay', x, y: g - 46, w: 72, h: 52 });
    if (RND() < 0.4) addSolid(W, { type: 'hay', x: x + 82, y: g - 46, w: 72, h: 52 });
    if (RND() < 0.3) addSolid(W, { type: 'hay', x: x + 20, y: g - 92, w: 72, h: 46 });
    return 170;
  },

  log(W, x) {
    const w = rand(80, 140);
    addSolid(W, { type: 'log', x, y: gAt(W, x + w / 2) - 20, w, h: 26 });
    return w;
  },

  wreck(W, x) {
    addSolid(W, { type: 'wreck', x, y: gAt(W, x + 45) - 34, w: 92, h: 40 });
    return 100;
  },

  block(W, x) {
    const n = randi(1, 3), g = gAt(W, x + 20);
    for (let i = 0; i < n; i++) addSolid(W, { type: 'block', x: x + i * 44, y: g - 42, w: 42, h: 46 });
    if (n > 1 && RND() < 0.5) addSolid(W, { type: 'block', x: x + 20, y: g - 84, w: 42, h: 42 });
    return n * 44;
  },

  rubble(W, x) {
    const w = rand(100, 170), g = gAt(W, x + w / 2);
    const h1 = rand(22, 34);
    addSolid(W, { type: 'rubble', x, y: g - h1, w, h: h1 + 6 });
    const w2 = w * rand(0.4, 0.65), h2 = rand(22, 34);
    addSolid(W, { type: 'rubble', x: x + rand(10, w - w2 - 10), y: g - h1 - h2, w: w2, h: h2 + 2 });
    return w;
  },

  house(W, x) { return building(W, x, randi(1, 2), rand(200, 280)); },
  building(W, x) { return building(W, x, randi(2, 4), rand(220, 360)); },

  vehicle(W, x, th) {
    const type = pick(th === 'city' ? ['car', 'car', 'moto', 'buggy'] : th === 'forest' ? ['quad', 'moto', 'buggy'] : ['moto', 'quad', 'buggy', 'car']);
    W.vehicles.push(makeVehicle(type, x + 60, (type === 'car' && RND() < 0.75) || (type === 'buggy' && RND() < 0.4)));    return 130;
  },

  cache(W, x) {
    W.pickups.push({ type: pickupType(), x: x + 20 });
    W.decor.push({ type: 'crate', x: x });
    return 60;
  },
};

function pickupType() { return weighted({ rifle: 0.9, shotgun: 0.6, reb: 0.25, medkit: 0.9, fuel: 2.4, armor: 0.5, detector: 0.25, grenade: 0.6, gasmask: 0.4 }); }
// предмети побуту в будівлях (їх можна кидати)
const PROP_KINDS = { jar: 3, chair: 2, stool: 1.5, pot: 1.5, brick: 1.2, tv: 0.8, iron: 1 };

function building(W, x, floors, w) {
  const T = 14;
  const g = flatten(W, x - 20, x + w + 20);
  const roofY = g - floors * FLOOR_H;
  const bref = { x, y: roofY, w, h: g - roofY, seed: RND(), floors };
  W.backs.push(bref);
  const s0 = W.solids.length;
  for (const wx of [x, x + w - T]) {
    for (let k = 0; k < floors; k++) {
      const yb = g - k * FLOOR_H, top = yb - FLOOR_H;
      if (k === 0) {
        addSolid(W, { type: 'wall', x: wx, y: top, w: T, h: FLOOR_H - 68 });
      } else {
        if (RND() < 0.85) addSolid(W, { type: 'wall', x: wx, y: top, w: T, h: FLOOR_H - 80 });
        if (RND() < 0.85) addSolid(W, { type: 'wall', x: wx, y: yb - 30, w: T, h: 30 });
      }
    }
  }
  // перекриття (прохідні знизу) з дірками
  const holes = [];
  for (let k = 1; k < floors; k++) {
    const y = g - k * FLOOR_H;
    if (RND() < 0.5) {
      const hx = x + rand(60, w - 120);
      holes[k] = [hx, hx + 64];
      addSolid(W, { type: 'floor', thin: true, x: x + T, y, w: hx - x - T, h: 10 });
      addSolid(W, { type: 'floor', thin: true, x: hx + 64, y, w: x + w - T - hx - 64, h: 10 });
    } else addSolid(W, { type: 'floor', thin: true, x: x + T, y, w: w - 2 * T, h: 10 });
  }
  // дах із проломом
  if (RND() < 0.6) {
    const gx = x + rand(40, w - 130);
    addSolid(W, { type: 'roof', x, y: roofY - 14, w: gx - x, h: 14 });
    addSolid(W, { type: 'roof', x: gx + 90, y: roofY - 14, w: x + w - gx - 90, h: 14 });
  } else addSolid(W, { type: 'roof', x, y: roofY - 14, w, h: 14 });
  // драбини між поверхами: верх і низ — на суцільному перекритті (не в проломі)
  const solidAt = (k, px) => !holes[k] || px < holes[k][0] - 24 || px > holes[k][1] + 24;
  for (let k = 0; k < floors - 1; k++) {
    let lx = x + rand(40, w - 40);
    for (let i = 0; i < 40 && !(solidAt(k + 1, lx) && solidAt(k, lx)); i++) lx = x + rand(40, w - 40);
    if (!(solidAt(k + 1, lx) && solidAt(k, lx))) lx = x + 40;
    W.ladders.push({ x: lx, top: g - (k + 1) * FLOOR_H, bottom: g - k * FLOOR_H });
  }
  // драбина з верхнього поверху на дах (біля стіни, де даху завжди є перекриття)
  W.ladders.push({ x: x + 26, top: roofY - 14, bottom: g - (floors - 1) * FLOOR_H, roof: true });
  W.covers.push({ type: 'ruin', x: x + T, w: w - 2 * T, y: roofY, h: g - roofY + 6 });
  // знахідки на поверхах
  if (RND() < 0.65) {
    const k = randi(0, floors - 1);
    W.pickups.push({ type: pickupType(), x: x + rand(40, w - 40), y: g - k * FLOOR_H });
  }
  // побут: на кожному поверсі 1–3 речі, на даху інколи цегла
  for (let k = 0; k < floors; k++) {
    for (let i = randi(1, 3); i > 0; i--) {
      let px = x + rand(30, w - 30);
      for (let t = 0; t < 10 && !solidAt(k, px); t++) px = x + rand(30, w - 30);
      if (solidAt(k, px)) W.props.push({ type: weighted(PROP_KINDS), x: px, y: g - k * FLOOR_H });
    }
  }
  if (RND() < 0.4) W.props.push({ type: 'brick', x: x + 26 + rand(20, 60), y: roofY - 14 });
  // частини будівлі знають, чия вони (для обвалу), і початкова площа конструкції
  for (let i = s0; i < W.solids.length; i++) W.solids[i].bld = bref;
  bref.area0 = W.solids.slice(s0).reduce((a, s) => a + s.w * s.h, 0);
  return w + 40;
}

const VEH = {
  moto: { name: 'Мотоцикл', len: 58, h: 32, max: 430, acc: 520, hp: 1, seats: 1, tank: 9 },
  quad: { name: 'Квадроцикл', len: 62, h: 34, max: 360, acc: 480, hp: 1, seats: 1, tank: 11 },
  buggy: { name: 'Багі', len: 80, h: 40, max: 390, acc: 450, hp: 1, seats: 2, tank: 12 },
  car: { name: 'Автомобіль', len: 100, h: 46, max: 320, acc: 330, hp: 2, seats: 2, tank: 15 },
};
function makeVehicle(type, x, mg) {
  const T = VEH[type];
  return { type, x, y: 0, vx: 0, dir: 1, ang: 0, hp: T.hp, driver: null, gunner: null, hasMG: !!mg, mgAmmo: mg ? WEAPONS.mg.ammo : 0, input: 0, dead: false, burn: 0, fuel: T.tank * rand(0.3, 1) };
}

function makeWorld(loc, seed, lenId, team) {
  RND = mulberry32(seed);
  const ML = MAP_LENGTHS.find((m) => m.id === lenId) || MAP_LENGTHS[0];
  const width = ML.width;
  const W = {
    loc, width, seed, lenId: ML.id, team: !!team,
    ground: new Float32Array(Math.ceil(width / GS) + 4),
    solids: [], covers: [], hides: [], ladders: [], pickups: [], vehicles: [], trees: [], bushes: [], backs: [], decor: [], props: [], mounts: [],
  };
  const themeAt = (x) => (loc !== 'mixed' ? loc : x < width * 0.36 ? 'fields' : x < width * 0.66 ? 'forest' : 'city');
  W.themeAt = themeAt;
  const p1 = rand(0, 6.28), p2 = rand(0, 6.28);
  for (let i = 0; i < W.ground.length; i++) {
    const x = i * GS;
    const amp = { fields: 34, forest: 22, city: 6 }[themeAt(x)];
    W.ground[i] = BASE_G + Math.sin(x * 0.0009 + p1) * amp + Math.sin(x * 0.0029 + p2) * amp * 0.35;
  }
  // старт
  flatten(W, 60, 280);
  W.start = { x: 640 };
  W.start2 = { x: width - 640 }; // база правої команди (командний режим)
  let x = 1000;
  F.vehicle(W, x + 100, themeAt(x)); x += 300;
  if (team) F.vehicle(W, width - 1500, themeAt(width - 1500));
  while (x < width - 1100) {
    const th = themeAt(x);
    const f = weighted(FEATURES[th]);
    x += F[f](W, x, th) + rand(140, 360);
  }
  // укриття в кінці мапи
  const sx = width - 560;
  const sg = flatten(W, sx - 160, width - 10);
  W.shelter = { x: sx, y: sg };
  if (!team) {
    addSolid(W, { type: 'shelter', x: sx + 36, y: sg - 124, w: 320, h: 130 });
    W.decor.push({ type: 'sandbags', x: sx - 120, w: 50 });
  } else {
    // командний режим: бази — великі триповерхові будівлі на обох кінцях мапи
    W.baseB = [];
    for (const bx of [W.start.x - 210, W.start2.x - 210]) {
      building(W, bx, 3, 420);
      const b = W.backs[W.backs.length - 1];
      b.base = true; W.baseB.push(b);
    }
  }

  // гарантований мінімум знахідок і техніки
  const cnt = (t) => W.pickups.filter((p) => p.type === t).length;
  const kw = width / 14000;
  const need = { rifle: 1, shotgun: 1, medkit: 2, fuel: 4, armor: 1, detector: 1, grenade: 2 };
  for (const t in need) while (cnt(t) < Math.round(need[t] * kw)) W.pickups.push({ type: t, x: rand(1400, width - 1400) });
  while (W.vehicles.length < 6) {
    const vx = rand(1600, width - 1600);
    W.vehicles.push(makeVehicle(pick(['moto', 'quad', 'buggy', 'car']), vx, RND() < 0.5));
  }

  buildBuckets(W);
  placeRocks(W, width);
  // фінальні висоти (рельєф міг змінитися після розміщення)
  for (const p of W.pickups) if (p.y == null) p.y = surfaceY(W, p.x);
  for (const v of W.vehicles) {
    // не ставимо техніку всередину твердих об'єктів
    for (let tries = 0; tries < 20 && vehicleBlocked(W, v); tries++) v.x += 60;
    v.y = gAt(W, v.x);
  }
  for (const h of W.hides) {
    if (h.type === 'pipe') h.exits.forEach((e) => tunExitGeo(W, h, e));
    else { h.y = gAt(W, h.x); h.hp = HIDE_HP[h.type]; }
  }
  cavDirty(W);
  for (const so of W.solids) if (SOLID_HP[so.type]) so.hp = SOLID_HP[so.type];
  // на дуже довгій мапі в одній зі схованок посередині захований бонус «Альоша»
  if (ML.id === 'huge') {
    const mid = W.hides.filter((h) => h.type !== 'pipe' && !h.basement && h.x > width * 0.3 && h.x < width * 0.75);
    if (mid.length) pick(mid).bonus = 'aliosha';
  }
  for (const t of W.trees) t.y = gAt(W, t.x);
  for (const b of W.bushes) b.y = gAt(W, b.x + b.w / 2);
  // злітні майданчики дронів: 2, 3 або 4 залежно від довжини мапи
  W.pads = [];
  const nPads = { normal: 2, long: 3, huge: 4 }[ML.id] || 2;
  const placePad = (x, t, n) => {
    const dir = t === 1 ? -1 : 1;
    for (let tries = 0; tries < 30 && solidsNear(W, x - 50, x + 50).some((so) => so.x < x + 50 && so.x + so.w > x - 50); tries++) x += 70 * dir;
    if (W.hides.some((h) => h.type !== 'pipe' && Math.abs(h.x - x) < 60)) x += 90 * dir;
    W.pads.push({ x, y: gAt(W, x), n, team: t });
  };
  if (team) {
    // у кожної команди свої точки на своїй половині (дзеркально)
    const span = width * 0.4 - 160;
    for (const t of [0, 1]) for (let i = 0; i < nPads; i++) {
      const x = 160 + (span * i) / (nPads - 1) + (i ? rand(-150, 150) : 0);
      placePad(t ? width - x : x, t, i + 1);
    }
  } else {
    const span = width * 0.72 - 160;
    for (let i = 0; i < nPads; i++) placePad(i === 0 ? 160 : 160 + (span * i) / (nPads - 1) + rand(-200, 200), -1, i + 1);
  }
  W.pad = W.pads[0];
  return W;
}

function vehicleBlocked(W, v) {
  const T = VEH[v.type], g = gAt(W, v.x);
  const r = { x: v.x - T.len / 2, y: g - T.h, w: T.len, h: T.h - 4 };
  return solidsNear(W, r.x, r.x + r.w).some((s) => !s.thin && s.x < r.x + r.w && s.x + s.w > r.x && s.y < r.y + r.h && s.y + s.h > r.y);
}

// ---- Просторовий індекс ----
const BUCKET = 256;
let qStamp = 0;
function buildBuckets(W) {
  W.buckets = [];
  for (let i = 0; i <= Math.ceil(W.width / BUCKET) + 1; i++) W.buckets.push([]);
  for (const s of W.solids) {
    s._q = 0;
    for (let i = Math.max(0, Math.floor(s.x / BUCKET)); i <= Math.min(W.buckets.length - 1, Math.floor((s.x + s.w) / BUCKET)); i++) W.buckets[i].push(s);
  }
}
function solidsNear(W, x0, x1) {
  const out = [];
  qStamp++;
  const a = Math.max(0, Math.floor(x0 / BUCKET)), b = Math.min(W.buckets.length - 1, Math.floor(x1 / BUCKET));
  for (let i = a; i <= b; i++) for (const s of W.buckets[i]) if (s._q !== qStamp) { s._q = qStamp; out.push(s); }
  return out;
}
// верхня поверхня (земля або верх об'єкта, що на ній стоїть)
function surfaceY(W, x) {
  let y = gAt(W, x);
  for (const s of solidsNear(W, x, x)) {
    if (s.thin || x < s.x || x > s.x + s.w) continue;
    if (s.y < y && s.y + s.h >= y - 4) y = s.y;
  }
  return y;
}
function pointSolid(W, x, y, list) {
  if (dirtAt(W, x, y)) return true;
  for (const s of list) if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return true;
  return false;
}
// пряма видимість (кулі та вибухи блокуються стінами й землею)
function lineOfSight(W, x0, y0, x1, y1) {
  const list = solidsNear(W, Math.min(x0, x1) - 1, Math.max(x0, x1) + 1);
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(len / 10);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (pointSolid(W, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, list)) return false;
  }
  return true;
}
