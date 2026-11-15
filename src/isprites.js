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
};
function ispPrep(sheet, img) {
  const full = document.createElement('canvas'); full.width = img.width; full.height = img.height;
  const fx = full.getContext('2d', { willReadFrequently: true });
  fx.drawImage(img, 0, 0);
  for (const name in sheet.parts) {
    const d = sheet.parts[name], [x0, y0, x1, y1] = d.r, w = x1 - x0, h = y1 - y0;
    const id = fx.getImageData(x0, y0, w, h), px = id.data;
    for (let i = 0; i < w * h; i++) {
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
