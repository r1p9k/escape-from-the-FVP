'use strict';
// ===== Спрайти предметів: зброя, боєприпаси, FPV-дрон — з аркушів Gemini (art/items/*.jpg) =====
// Білий фон прибирається за яскравістю (у клітці дрона й скобах зброї є замкнені білі ділянки);
// для дронів — м'яко, щоб «розмиті» лопаті були напівпрозорими. Поки аркуш не готовий — малюється векторно.
// Частина: r — прямокутник [x0, y0, x1, y1]; a, b — приклад і дуло на осі ствола (частина натягується на відрізок у грі);
// для решти — c (центр, за замовчуванням середина r) і w (ширина в одиницях гри); flip — намальовано дзеркально.
const ISP = { parts: {} };
const ISP_SHEETS = {
  weapons: {
    src: 'art/items/weapons.jpg', key: 40,
    parts: {
      rifle: { r: [86, 150, 1338, 526], a: [92, 230], b: [1332, 230] },
      shotgun: { r: [1418, 178, 2666, 430], a: [1424, 205], b: [2660, 205] },
      pkm: { r: [86, 582, 1414, 970], a: [92, 701], b: [1408, 701] },
      sniper: { r: [1378, 638, 2666, 1042], a: [2660, 779], b: [1384, 779], flip: true },
      bomb: { r: [854, 958, 1042, 1466], w: 6.5 },
      grenade: { r: [270, 1082, 470, 1390], w: 7.5 },
      mine: { r: [1470, 1138, 2006, 1434], w: 16, c: [1738, 1428] },
      smoke: { r: [2214, 1198, 2610, 1382], w: 11 },
    },
  },
  drones: {
    src: 'art/items/drones.jpg', key: 70,
    parts: {
      fly: { r: [110, 118, 1334, 534], w: 40, c: [770, 318] },
      land: { r: [1490, 226, 2666, 606], w: 40, c: [2119, 400] },
      cage: { r: [106, 874, 1318, 1386], w: 40, c: [770, 1156] },
      bare: { r: [1454, 950, 2666, 1366], w: 40, c: [2129, 1160] },
    },
  },
  bonuses: {
    src: 'art/items/bonuses.jpg', key: 40,
    parts: {
      medkit: {r: [146,82,522,502], w: 14},
      reb: {r: [690,66,1406,470], w: 14},
      fuel: {r: [1566,62,1930,558], w: 14},
      armor: {r: [2154,54,2598,578], w: 14},
      detector: {r: [230,542,450,1082], w: 14},
      pack: {r: [798,538,1294,1102], w: 14},
      gasmask: {r: [1538,614,1978,1054], w: 14},
      ammo: {r: [2122,642,2638,1054], w: 14},
      shovelS: {r: [86,1182,898,1422], a: [92,1302], b: [892,1302]},
      battery: {r: [1002,1158,1434,1450], w: 14},
      lockcam: {r: [1606,1134,1906,1450], w: 14},
      crate: {r: [2082,1098,2666,1490], w: 14},
    },
  },
  vehicles: {
    src: 'art/items/vehicles.jpg', key: 40,
    parts: {
      v_moto: {r: [92,280,648,616], w: 100},
      v_quad: {r: [704,296,1228,616], w: 100},
      v_buggy: {r: [1264,248,1876,616], w: 100},
      v_car: {r: [1892,224,2712,568], w: 100},
      vd_moto: {r: [88,1088,668,1428], w: 100},
      vd_quad: {r: [728,1108,1288,1428], w: 100},
      vd_buggy: {r: [1332,1088,1904,1428], w: 100},
      vd_car: {r: [1924,1104,2712,1424], w: 100},
    },
  },
  obstacles: {
    src: 'art/items/obstacles.jpg', key: 40,
    parts: {
      hay: {r: [96,80,664,524], w: 90},
      logs: {r: [804,84,1572,524], w: 90},
      jersey: {r: [1772,92,2652,520], w: 90},
      wreck: {r: [104,616,1276,984], w: 90},
      rubble: {r: [1472,580,2644,972], w: 90},
      sandbags: {r: [80,1148,992,1428], w: 90},
      plywood: {r: [1100,1060,1584,1448], w: 90},
      bunker: {r: [1656,1032,2704,1464], w: 90},
    },
  },
  textures: {
    src: 'art/items/textures.jpg', key: 0,
    parts: {
      t_brick: {r: [116,68,888,716], w: 64, tile: 64},
      t_plaster: {r: [1004,68,1748,716], w: 80, tile: 80},
      t_concrete: {r: [1864,68,2636,716], w: 64, tile: 64},
      t_interior: {r: [132,820,888,1468], w: 96, tile: 96},
      t_planks: {r: [1004,820,1748,1468], w: 48, tile: 48},
      t_slab: {r: [1864,820,2628,1456], w: 48, tile: 48},
    },
  },
};
function ispPrep(sheet, img) {
  const full = document.createElement('canvas'); full.width = img.width; full.height = img.height;
  const fx = full.getContext('2d', { willReadFrequently: true });
  fx.drawImage(img, 0, 0);
  for (const name in sheet.parts) {
    const d = sheet.parts[name], [x0, y0, x1, y1] = d.r, w = x1 - x0, h = y1 - y0;
    const id = fx.getImageData(x0, y0, w, h), px = id.data;
    if (sheet.key) for (let i = 0; i < w * h; i++) {
      const l = Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      px[i * 4 + 3] = Math.round(255 * clamp((250 - l) / sheet.key, 0, 1));
    }
    const raw = document.createElement('canvas'); raw.width = w; raw.height = h; raw.getContext('2d').putImageData(id, 0, 0);
    // зменшити до ~5 пікселів на одиницю гри (із запасом на приближення камери)
    const units = d.a ? 31 : d.w, srcLen = d.a ? Math.abs(d.b[0] - d.a[0]) : w;
    const k = Math.min(1, (units * 5) / srcLen);
    d.k = k;
    ISP.parts[name] = { d, img: k < 1 ? hspShrink(raw, w * k, h * k) : raw };
  }
}
(function ispLoad() {
  for (const key in ISP_SHEETS) {
    const sheet = ISP_SHEETS[key], img = new Image();
    img.onload = () => { try { ispPrep(sheet, img); } catch (e) { console.warn('спрайти предметів не підготовлено', e); } };
    img.src = sheet.src;
  }
})();
// зброя вздовж осі: приклад у (0,0), дуло в (len, 0); система вже повернута за прицілом
function ispAlong(ctx, name, len) {
  const P = ISP.parts[name];
  if (!P) return false;
  const d = P.d, ls = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]), as = Math.atan2(d.b[1] - d.a[1], d.b[0] - d.a[0]), s = len / ls;
  ctx.save();
  ctx.scale(s, d.flip ? -s : s); ctx.rotate(-as); ctx.translate(-d.a[0], -d.a[1]);
  ctx.drawImage(P.img, d.r[0], d.r[1], d.r[2] - d.r[0], d.r[3] - d.r[1]);
  ctx.restore();
  return true;
}
// предмет із центром c у (0,0) і шириною w одиниць гри (dir < 0 — дзеркально)
function ispCenter(ctx, name, w, dir) {
  const P = ISP.parts[name];
  if (!P) return false;
  const d = P.d, s = (w || d.w) / (d.r[2] - d.r[0]), c = d.c || [(d.r[0] + d.r[2]) / 2, (d.r[1] + d.r[3]) / 2];
  ctx.save();
  ctx.scale(dir < 0 ? -s : s, s); ctx.translate(-c[0], -c[1]);
  ctx.drawImage(P.img, d.r[0], d.r[1], d.r[2] - d.r[0], d.r[3] - d.r[1]);
  ctx.restore();
  return true;
}
// предмет, вписаний у прямокутник (перешкоди, техніка): знизу по центру, з власними пропорціями або розтягнутий (fit)
function ispRect(ctx, name, x, y, w, h, fit, dir) {
  const P = ISP.parts[name];
  if (!P) return false;
  const d = P.d, sw = d.r[2] - d.r[0], sh = d.r[3] - d.r[1];
  ctx.save();
  if (fit) { ctx.translate(dir < 0 ? x + w : x, y); ctx.scale((dir < 0 ? -w : w) / sw, h / sh); }
  else { const s = w / sw; ctx.translate(x + w / 2, y + h); ctx.scale(dir < 0 ? -s : s, s); ctx.translate(-sw / 2, -sh); }
  ctx.drawImage(P.img, 0, 0, sw, sh);
  ctx.restore();
  return true;
}
// текстура-візерунок (стіни, перекриття): плитка tile одиниць гри, прив'язана до світу
const ISP_PAT = {};
function ispPattern(ctx, name) {
  if (ISP_PAT[name]) return ISP_PAT[name];
  const P = ISP.parts[name];
  if (!P) return null;
  const pat = ctx.createPattern(P.img, 'repeat'), d = P.d, k = d.tile / P.img.width;
  if (pat.setTransform) pat.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
  return (ISP_PAT[name] = pat);
}
