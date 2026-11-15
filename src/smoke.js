'use strict';
// ===== Реалістичний дим: м'які клуби з багатьох розмитих плям (заздалегідь намальовані текстури) =====
// Світлий — димові шашки й завіси, темний — від вибухів і пожеж. Клуби повільно обертаються, ростуть і тануть.
const SMK = { light: [], dark: [] };
(function smokePrep() {
  const S = 128;
  for (const light of [true, false]) for (let v = 0; v < 5; v++) {
    const c = document.createElement('canvas'); c.width = S; c.height = S;
    const x = c.getContext('2d'), rnd = mulberry32(v * 977 + (light ? 13 : 71));
    const base = light ? [226, 226, 220] : [62, 60, 58];
    for (let i = 0; i < 34; i++) {
      const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.7) * S * 0.24;
      const px = S / 2 + Math.cos(a) * d, py = S / 2 + Math.sin(a) * d * 0.85, r = S * (0.1 + rnd() * 0.2);
      const sh = (rnd() - 0.5) * (light ? 34 : 24), col = base.map((q) => Math.round(clamp(q + sh, 0, 255))).join(',');
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(' + col + ',0.42)'); g.addColorStop(0.55, 'rgba(' + col + ',0.2)'); g.addColorStop(1, 'rgba(' + col + ',0)');
      x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
    }
    // об'єм: світло згори, тінь знизу
    x.globalCompositeOperation = 'source-atop';
    const lg = x.createLinearGradient(0, S * 0.15, 0, S * 0.9);
    lg.addColorStop(0, light ? 'rgba(255,255,255,0.22)' : 'rgba(150,140,130,0.18)'); lg.addColorStop(1, 'rgba(0,0,0,' + (light ? 0.16 : 0.22) + ')');
    x.fillStyle = lg; x.fillRect(0, 0, S, S);
    (light ? SMK.light : SMK.dark).push(c);
  }
})();
// один клуб: центр (x, y), радіус r
function smokePuff(ctx, x, y, r, alpha, light, rot, v) {
  const L = light ? SMK.light : SMK.dark, img = L[(v | 0) % L.length];
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.translate(x, y); ctx.rotate(rot || 0);
  ctx.drawImage(img, -r, -r, r * 2, r * 2);
  ctx.restore();
}
// частинка диму (вибухи, димок від сховищ, дим пожеж)
function drawSmokeParticle(ctx, p, k) {
  if (p.rot == null) { p.rot = Math.random() * 6.28; p.spin = (Math.random() - 0.5) * 0.8; p.v = (Math.random() * 5) | 0; }
  const r = p.size * (1.3 + (1 - k) * 1.6);
  smokePuff(ctx, p.x, p.y, r, (p.light ? 0.75 : 0.62) * Math.pow(k, 0.7), !!p.light, p.rot + p.spin * (1 - k) * 3, p.v);
}
// димова завіса: густа хмара, що розповзається від шашки, нижні клуби щільніші, по краях — тане
function drawSmokeScreen(ctx, sm, t) {
  const age = sm.max - sm.t, fade = Math.min(1, sm.t / 3), grow = Math.min(1, 0.35 + age / 3.5);
  const R = sm.r * grow, N = 18;
  for (let i = 0; i < N; i++) {
    const a = sm.seed * 3 + i * 2.399, u = Math.sqrt((i + 0.5) / N); // рівномірно по диску
    const drift = Math.sin(t * 0.23 + i * 1.7) * 10 + Math.sin(t * 0.11 + sm.seed) * 6;
    const px = sm.x + Math.cos(a) * R * 0.78 * u + drift;
    const py = sm.y + 22 + Math.sin(a) * R * 0.42 * u - (1 - u) * 18 - Math.sin(t * 0.3 + i) * 4;
    const r = R * (0.42 + 0.22 * hash(sm.seed * 31 + i)) * (1.15 - 0.35 * u);
    const edge = 1 - 0.45 * u; // по краю прозоріше
    smokePuff(ctx, px, py, r, 0.82 * fade * edge, true, a + t * 0.04 * (i % 2 ? 1 : -1), i);
  }
}
