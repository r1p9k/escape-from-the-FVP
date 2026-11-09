'use strict';
// ===== Спрайти людини: частини з аркуша art/human/sheet.jpg натягуються на кістки скелета =====
// Аркуш вантажиться при старті; білий фон прибирається заливкою від країв кожної частини.
// Поки аркуш не готовий (або не завантажився) — людина малюється векторно, як раніше.

const HSP_K = 26 / 600;  // одиниць гри на піксель аркуша (нога від стегна до кісточки ≈ 600 px)
const HSP_RES = 3;       // частини зберігаються втричі детальніше, ніж у грі (для приближення)
const HSP = { ready: false, parts: {}, v: 'n', far: null };
// прямокутник на аркуші [x0, y0, x1, y1] і опорні точки: a — верхній суглоб, b — нижній; p — точка кріплення
const HSP_DEF = {
  head:   { r: [180, 92, 448, 420], p: [318, 262], helm: [312, 190] },
  torso:  { r: [608, 220, 1004, 668], hip: [840, 648], top: [835, 232] },
  armN_u: { r: [1224, 140, 1380, 396], a: [1302, 168], b: [1292, 382] },
  armN_l: { r: [1244, 412, 1412, 804], a: [1290, 424], b: [1345, 708] },
  armF_u: { r: [1664, 140, 1844, 432], a: [1738, 168], b: [1730, 412] },
  armF_l: { r: [1664, 392, 1844, 772], a: [1730, 412], b: [1772, 690] },
  legN_u: { r: [192, 788, 368, 1132], a: [278, 808], b: [287, 1122] },
  legN_l: { r: [192, 1052, 368, 1420], a: [287, 1122], b: [282, 1405] },
  legF_u: { r: [1048, 812, 1220, 1132], a: [1125, 830], b: [1140, 1122] },
  legF_l: { r: [1048, 1052, 1220, 1416], a: [1140, 1122], b: [1122, 1400] },
  bootN:  { r: [1380, 1200, 1604, 1416], p: [1436, 1262] },
  bootF:  { r: [1664, 1200, 1884, 1416], p: [1718, 1262] },
};

function hspCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
// зменшення сходинками вдвічі — без «драбинок» на контурах
function hspShrink(src, tw, th) {
  let s = src, w = src.width, h = src.height;
  while (w / 2 > tw && h / 2 > th) {
    const n = hspCanvas(w / 2, h / 2), x = n.getContext('2d');
    x.imageSmoothingQuality = 'high'; x.drawImage(s, 0, 0, n.width, n.height);
    s = n; w = n.width; h = n.height;
  }
  const out = hspCanvas(tw, th), x = out.getContext('2d');
  x.imageSmoothingQuality = 'high'; x.drawImage(s, 0, 0, out.width, out.height);
  return out;
}
function hspPrep(img) {
  const full = hspCanvas(img.width, img.height), fx = full.getContext('2d', { willReadFrequently: true });
  fx.drawImage(img, 0, 0);
  for (const name in HSP_DEF) {
    const d = HSP_DEF[name], [x0, y0, x1, y1] = d.r, w = x1 - x0, h = y1 - y0;
    const id = fx.getImageData(x0, y0, w, h), px = id.data, n = w * h;
    const lum = (i) => Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    // фон — світлі пікселі, з'єднані з краєм
    const bg = new Uint8Array(n), st = [];
    for (let x = 0; x < w; x++) st.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) st.push(y * w, y * w + w - 1);
    while (st.length) {
      const i = st.pop();
      if (bg[i] || lum(i) <= 200) continue;
      bg[i] = 1;
      const x = i % w;
      if (x > 0) st.push(i - 1);
      if (x < w - 1) st.push(i + 1);
      if (i >= w) st.push(i - w);
      if (i < n - w) st.push(i + w);
    }
    for (let i = 0; i < n; i++) {
      if (bg[i]) { px[i * 4 + 3] = 0; continue; }
      const x = i % w;
      const edge = (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (i >= w && bg[i - w]) || (i < n - w && bg[i + w]);
      if (edge) px[i * 4 + 3] = Math.round(255 * clamp((255 - lum(i)) / 120, 0, 1)); // м'який край замість світлої облямівки
    }
    const raw = hspCanvas(w, h); raw.getContext('2d').putImageData(id, 0, 0);
    const base = hspShrink(raw, w * HSP_K * HSP_RES * (name === 'head' ? 1.2 : 1), h * HSP_K * HSP_RES * (name === 'head' ? 1.2 : 1));
    // варіанти: поранений (червоніє), загиблий (сірий і тьмяний)
    const hurt = hspCanvas(base.width, base.height), hx = hurt.getContext('2d');
    hx.drawImage(base, 0, 0); hx.globalCompositeOperation = 'source-atop'; hx.fillStyle = 'rgba(184,58,46,0.5)'; hx.fillRect(0, 0, base.width, base.height);
    const dead = hspCanvas(base.width, base.height), dx = dead.getContext('2d');
    dx.filter = 'grayscale(0.75) brightness(0.72)'; dx.drawImage(base, 0, 0);
    HSP.parts[name] = { d, n: base, hurt, dead };
  }
  HSP.ready = true;
}
(function hspLoad() {
  const img = new Image();
  img.onload = () => { try { hspPrep(img); } catch (e) { console.warn('спрайти людини не підготовлено', e); } };
  img.src = 'art/human/sheet.jpg';
})();

// перед малюванням людини: варіант кольору й колір дальньої руки (щоб відрізнити її в armTo)
function hspBegin(h, C) {
  const k = h.dead ? 0 : clamp((h.hurtT || 0) / 0.4, 0, 1);
  HSP.v = h.dead ? 'dead' : k > 0.25 ? 'hurt' : 'n';
  HSP.far = C.uniD;
}
// сегмент-спрайт від суглоба A до суглоба B
function hspSeg(ctx, name, A, B) {
  const P = HSP.parts[name], d = P.d;
  const ls = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]), lt = Math.hypot(B.x - A.x, B.y - A.y);
  const as = Math.atan2(d.b[0] - d.a[0], d.b[1] - d.a[1]), at = Math.atan2(B.x - A.x, B.y - A.y);
  ctx.save();
  ctx.translate(A.x, A.y); ctx.rotate(-at); ctx.scale(HSP_K, lt / ls); ctx.rotate(as); ctx.translate(-d.a[0], -d.a[1]);
  ctx.drawImage(P[HSP.v], d.r[0], d.r[1], d.r[2] - d.r[0], d.r[3] - d.r[1]);
  ctx.restore();
}
// кінцівка з двох сегментів: kind — armN/armF/legN/legF (N — ближня, F — дальня)
function hspLimb(ctx, pts, kind) {
  if (!HSP.ready) return false;
  hspSeg(ctx, kind + '_u', pts[0], pts[1]);
  hspSeg(ctx, kind + '_l', pts[1], pts[2]);
  return true;
}
function hspPin(ctx, name, p, ang, s) {
  const P = HSP.parts[name], d = P.d;
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang || 0); ctx.scale(s, s); ctx.translate(-d.p[0], -d.p[1]);
  ctx.drawImage(P[HSP.v], d.r[0], d.r[1], d.r[2] - d.r[0], d.r[3] - d.r[1]);
  ctx.restore();
}
function hspBoot(ctx, ankle, ang, far) {
  if (!HSP.ready) return false;
  hspPin(ctx, far ? 'bootF' : 'bootN', ankle, ang, HSP_K);
  return true;
}
// тулуб у локальних координатах: стегна — (0,0), вгору — -y
function hspTorso(ctx, len) {
  if (!HSP.ready) return false;
  const P = HSP.parts.torso, d = P.d, ky = (len + 1.5) / (d.hip[1] - d.top[1]);
  ctx.save(); ctx.scale(HSP_K * 1.05, ky); ctx.translate(-d.hip[0], -d.hip[1]);
  ctx.drawImage(P[HSP.v], d.r[0], d.r[1], d.r[2] - d.r[0], d.r[3] - d.r[1]);
  ctx.restore();
  return true;
}
// голова в шоломі (уже в системі голови: центр — 0,0) і смуга кольору гравця на шоломі
function hspHead(ctx, team) {
  if (!HSP.ready) return false;
  const s = HSP_K * 1.2, d = HSP.parts.head.d;
  hspPin(ctx, 'head', { x: 0, y: 0 }, 0, s);
  const hx = (d.helm[0] - d.p[0]) * s, hy = (d.helm[1] - d.p[1]) * s;
  ctx.strokeStyle = team; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.arc(hx, hy + 1.2, 4.4, Math.PI * 1.25, Math.PI * 1.62); ctx.stroke();
  return true;
}
