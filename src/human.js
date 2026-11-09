'use strict';
// ===== Людина: мальований скелет («шарнірна лялька») =====
// Кінцівки з двох сегментів (стегно+гомілка, плече+передпліччя), руки тягнуться до цілей (інверсна кінематика),
// тулуб нахиляється, голова з шоломом. Пози: стійка, біг, присід, повзання, драбина, приціл, кидок, удар, копання,
// каністра, пілотування дрона, станкова гвинтівка, сидіння в техніці, загибель. Механіка й зони влучання не змінюються.

const RIG = { thigh: 13, shin: 13, torso: 20, upper: 10, fore: 10.5 };
const HCOL = {
  uni: '#5d6c3b', uniD: '#48552d', pants: '#56613a', pantsD: '#414a2b', boot: '#2b2621', glove: '#34352b',
  skin: '#d6ad86', helm: '#4e5934', helmD: '#3b4428', rig: '#6b6245', rigD: '#544c35', plate: '#7a6a4a', plateD: '#5d5138',
  pack: '#4b5631', packD: '#3a4326', line: '#1a1c12', gun: '#232323', gunL: '#3b3b3b', wood: '#5d3f25',
};

// ---- допоміжне ----
function hexMix(a, b, k) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}
// точка, від якої відкладено відрізок L під кутом a (0 — вниз, + — вперед)
function seg(p, a, L) { return { x: p.x + Math.sin(a) * L, y: p.y + Math.cos(a) * L }; }
// поворот локальної точки (lx, ly) навколо o на кут r (за годинниковою — нахил уперед)
function rot(o, r, lx, ly) { const c = Math.cos(r), s = Math.sin(r); return { x: o.x + lx * c - ly * s, y: o.y + lx * s + ly * c }; }
// два сегменти від s до цілі t; bend: +1 — суглоб «уперед/вгору» від лінії, -1 — у протилежний бік
function ik2(s, t, L1, L2, bend) {
  let dx = t.x - s.x, dy = t.y - s.y, d = Math.hypot(dx, dy) || 0.001;
  const max = L1 + L2 - 0.05;
  if (d > max) { dx *= max / d; dy *= max / d; d = max; }
  const a = Math.atan2(dy, dx), c = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1), b = Math.acos(c) * bend;
  return { j: { x: s.x + Math.cos(a - b) * L1, y: s.y + Math.sin(a - b) * L1 }, e: { x: s.x + dx, y: s.y + dy } };
}
// кінцівка: ламана з темним контуром
function limb(ctx, pts, w, col) {
  for (const [lw, c] of [[w + 2.4, HCOL.line], [w, col]]) {
    ctx.strokeStyle = c; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
}
function dot(ctx, p, r, col) {
  ctx.fillStyle = HCOL.line; ctx.beginPath(); ctx.arc(p.x, p.y, r + 1.1, 0, 7); ctx.fill();
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
}
function boot(ctx, ankle, ang, col) {
  ctx.save(); ctx.translate(ankle.x, ankle.y); ctx.rotate(ang);
  ctx.fillStyle = HCOL.line; roundRect(ctx, -3.2, -2.6, 9.6, 5.6, 2); ctx.fill();
  ctx.fillStyle = col; roundRect(ctx, -2.2, -1.7, 7.6, 3.8, 1.5); ctx.fill();
  ctx.restore();
}
// кольори людини: поранення — червоніє, загибель — блякне
function humanCols(h) {
  const k = h.dead ? 0 : clamp((h.hurtT || 0) / 0.4, 0, 1) * 0.55, dk = h.dead ? 0.45 : 0;
  const f = (c) => (dk ? hexMix(c, '#4a4a44', dk) : k ? hexMix(c, '#b83a2e', k) : c);
  return { uni: f(HCOL.uni), uniD: f(HCOL.uniD), pants: f(HCOL.pants), pantsD: f(HCOL.pantsD), team: h.dead ? '#666' : h.player.color };
}

// ---- зброя: початок — приклад, уздовж +x ----
const GUN_GRIP = 9, GUN_FORE = 19;
function drawGunShape(ctx, type) {
  ctx.fillStyle = HCOL.line;
  if (type === 'shotgun') {
    ctx.fillRect(-0.8, -2.8, 31, 6.6);
    ctx.fillStyle = HCOL.wood; ctx.beginPath(); ctx.moveTo(0, -1.6); ctx.lineTo(8, -1.8); ctx.lineTo(8, 2); ctx.lineTo(0, 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = HCOL.gun; ctx.fillRect(8, -2, 8, 4); ctx.fillRect(16, -1.6, 14, 1.8);
    ctx.fillStyle = HCOL.wood; ctx.fillRect(17, 0.4, 7, 2.6);
  } else {
    ctx.fillRect(-0.8, -3.2, 31, 8.4);
    ctx.fillStyle = HCOL.gunL; ctx.beginPath(); ctx.moveTo(0, -1.6); ctx.lineTo(7.5, -2); ctx.lineTo(7.5, 2.2); ctx.lineTo(0, 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = HCOL.gun; ctx.fillRect(7.5, -2.2, 10, 4.4); ctx.fillRect(9, -3.6, 4, 1.6);
    ctx.beginPath(); ctx.moveTo(11, 2); ctx.lineTo(12.5, 7.2); ctx.lineTo(15.4, 6.6); ctx.lineTo(14.4, 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = HCOL.gunL; ctx.fillRect(17.5, -1.8, 6.5, 3.6);
    ctx.fillStyle = HCOL.gun; ctx.fillRect(24, -0.9, 6, 1.8);
  }
}
function drawGunAt(ctx, type, B, ang) {
  ctx.save(); ctx.translate(B.x, B.y); ctx.rotate(ang); drawGunShape(ctx, type); ctx.restore();
}
function gunPoint(B, ang, u, v) { return { x: B.x + Math.cos(ang) * u - Math.sin(ang) * v, y: B.y + Math.sin(ang) * u + Math.cos(ang) * v }; }

// ---- голова з шоломом (центр голови, нахил) ----
function drawHead(ctx, c, tilt, team, opts) {
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(tilt);
  dot(ctx, { x: 0, y: 0 }, 5.2, HCOL.skin);
  ctx.fillStyle = HCOL.skin; ctx.beginPath(); ctx.arc(5.2, 1.2, 1.5, 0, 7); ctx.fill(); // ніс
  ctx.fillStyle = HCOL.line; ctx.fillRect(2.4, -0.4, 1.6, 1.6);                       // око
  if (opts.goggles) { ctx.fillStyle = '#111'; roundRect(ctx, 0.5, -1.6, 5.6, 3.2, 1.2); ctx.fill(); ctx.fillStyle = '#5ad1c4'; ctx.fillRect(3.6, -0.8, 1.6, 1.4); }
  // шолом із чохлом і смугою кольору гравця
  ctx.fillStyle = HCOL.line; ctx.beginPath(); ctx.arc(-0.4, -0.6, 7.6, Math.PI * 0.93, Math.PI * 2.07); ctx.closePath(); ctx.fill();
  ctx.fillStyle = opts.dead ? '#555' : HCOL.helm; ctx.beginPath(); ctx.arc(-0.4, -0.6, 6.6, Math.PI * 0.95, Math.PI * 2.05); ctx.closePath(); ctx.fill();
  ctx.fillStyle = HCOL.helmD; ctx.beginPath(); ctx.arc(-0.4, -0.6, 6.6, Math.PI * 1.55, Math.PI * 2.05); ctx.lineTo(-0.4, -0.6); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = team; ctx.lineWidth = 1.7; ctx.beginPath(); ctx.arc(-0.4, -0.6, 5.4, Math.PI * 1.2, Math.PI * 1.82); ctx.stroke();
  ctx.strokeStyle = HCOL.line; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(-1.5, 0.5); ctx.lineTo(1.6, 4.6); ctx.stroke(); // ремінець
  ctx.restore();
}

// ---- тулуб у локальних координатах (стегна — 0,0; вгору — -y) ----
function drawTorso(ctx, h, C, len) {
  // рюкзак ззаду
  ctx.fillStyle = HCOL.line; roundRect(ctx, -12.6, -len + 1.4, 8.2, 14.6, 3); ctx.fill();
  ctx.fillStyle = HCOL.pack; roundRect(ctx, -11.6, -len + 2.4, 6.2, 12.6, 2.4); ctx.fill();
  ctx.fillStyle = HCOL.packD; ctx.fillRect(-11.6, -len + 8, 6.2, 2);
  // корпус
  ctx.fillStyle = HCOL.line; roundRect(ctx, -7.2, -len - 1.2, 14.4, len + 3.2, 4.5); ctx.fill();
  ctx.fillStyle = C.uni; roundRect(ctx, -6, -len, 12, len + 1, 3.8); ctx.fill();
  ctx.fillStyle = C.uniD; roundRect(ctx, -6, -len, 4.2, len + 1, 2.5); ctx.fill(); // тінь зі спини
  // бронежилет або розвантажка з підсумками
  if (h.armor > 0) {
    ctx.fillStyle = HCOL.line; roundRect(ctx, -6.8, -len + 1.2, 14.2, len - 4.4, 3); ctx.fill();
    ctx.fillStyle = HCOL.plate; roundRect(ctx, -5.8, -len + 2.2, 12.2, len - 6.4, 2.4); ctx.fill();
    ctx.fillStyle = HCOL.plateD; for (let i = 0; i < 3; i++) ctx.fillRect(1.6, -len + 6 + i * 4, 4.6, 2.8);
  } else {
    ctx.fillStyle = HCOL.rig; roundRect(ctx, 0.4, -len + 5, 5.8, len - 9, 1.6); ctx.fill();
    ctx.fillStyle = HCOL.rigD; ctx.fillRect(1, -len + 9, 5, 1.2); ctx.fillRect(1, -len + 13, 5, 1.2);
  }
  ctx.fillStyle = HCOL.line; ctx.fillRect(-6.4, -2.4, 12.8, 3); // пасок
}

// ---- руки: дальня (за тілом) і ближня ----
function armTo(ctx, sh, target, col, gloveCol) {
  const r = ik2(sh, target, RIG.upper, RIG.fore, -1);
  limb(ctx, [sh, r.j, r.e], 4.6, col);
  dot(ctx, r.e, 2.3, gloveCol || HCOL.glove);
  return r;
}
function armAngles(ctx, sh, a1, a2, col) {
  const el = seg(sh, a1, RIG.upper), hd = seg(el, a2, RIG.fore);
  limb(ctx, [sh, el, hd], 4.6, col); dot(ctx, hd, 2.3, HCOL.glove);
}

// =============== головне малювання ===============
function drawHuman(ctx, h, t, alpha) {
  ctx.save();
  ctx.globalAlpha = h.protT > 0 ? alpha * (0.45 + 0.35 * Math.sin(t * 20)) : alpha; // мерехтить, поки діє захист після відновлення
  ctx.translate(h.x, h.y);
  ctx.scale(h.facing, 1);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const C = humanCols(h);
  if (h.dead) drawBodyDead(ctx, h, C);
  else if (h.stance === 'prone') drawBodyProne(ctx, h, t, C);
  else drawBodyUpright(ctx, h, t, C);
  ctx.restore();
  if (h.alT > 0 && !h.dead) {
    const r = HUMAN_DIM[h.stance];
    ctx.strokeStyle = 'rgba(255,215,90,' + (0.45 + 0.3 * Math.sin(t * 12)) + ')'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(h.x, h.y - r.h / 2, r.w / 2 + 12, r.h / 2 + 12, 0, 0, 7); ctx.stroke();
    ctx.fillStyle = '#ffd75a'; ctx.font = FONT(11); ctx.textAlign = 'center';
    ctx.fillText('АЛЬОША', h.x, h.y - r.h - 30);
  }
  if (!h.dead && !h.hidden) {
    ctx.fillStyle = h.player.color; ctx.font = FONT(10); ctx.textAlign = 'center';
    ctx.globalAlpha = 0.85 * alpha;
    ctx.fillText(h.player.name, h.x, h.y - HUMAN_DIM[h.stance].h - 18);
    ctx.globalAlpha = 1;
  }
}

// ---- стоячи / присівши / драбина / у повітрі ----
function drawBodyUpright(ctx, h, t, C) {
  const crouch = h.stance === 'crouch' || (h.hidden && h.hidden.type !== 'pipe') || h.piloting;
  const sp = h.onLadder ? 0 : clamp(Math.abs(h.vx) / (crouch ? 90 : 170), 0, 1);
  const ph = h.anim || 0, air = !h.onGround && !h.onLadder && !h.climb;
  const busyDig = h.digT > 0 || h.digging;
  // ноги: кути стегна й гомілки (абсолютні; 0 — вниз)
  let legs;
  if (h.onLadder) {
    const q = Math.sin(ph);
    legs = [{ t: 0.6 + 0.45 * q, s: -0.35 + 0.25 * q }, { t: 0.6 - 0.45 * q, s: -0.35 - 0.25 * q }];
  } else if (air) legs = [{ t: -0.25, s: -0.95 }, { t: 0.65, s: -0.25 }];
  else if (crouch) {
    if (sp > 0.08) legs = [0, Math.PI].map((o) => { const q = ph + o, th = 0.95 + 0.38 * sp * Math.sin(q); return { t: th, s: th - 1.5 - 0.3 * sp * Math.max(0, Math.cos(q)) }; });
    else legs = [{ t: 0.35, s: -1.3 }, { t: 1.3, s: -0.15 }];
  } else if (sp > 0.08) {
    const A = 0.22 + 0.42 * sp, K = 0.45 + 1.0 * sp;
    // перенос ноги вперед (cos q > 0) — коліно зігнуте, опора (стегно йде назад) — нога майже пряма
    legs = [0, Math.PI].map((o) => { const q = ph + o, th = A * Math.sin(q); return { t: th, s: th - (0.08 + K * Math.max(0, Math.cos(q - 0.35))) }; });
  } else legs = [{ t: -0.09, s: -0.13 }, { t: 0.11, s: 0.03 }];
  // висота стегон — нижня ступня торкається землі
  let drop = 0;
  for (const l of legs) drop = Math.max(drop, Math.cos(l.t) * RIG.thigh + Math.cos(l.s) * RIG.shin);
  if (h.onLadder || air) drop = 24;
  const H = { x: crouch ? -1.5 : 0, y: -drop - (sp > 0.5 && !crouch ? Math.abs(Math.cos(ph)) * 1.2 : 0) };
  // нахил тулуба
  let lean = crouch ? 0.55 : 0.04 + 0.17 * sp;
  if (h.aiming) lean = crouch ? 0.32 : 0.05;
  if (h.onLadder) lean = -0.05;
  if (busyDig) lean = 0.5;
  if (h.meleeT > 0) lean += 0.18 * Math.sin((1 - h.meleeT / MELEE_T) * Math.PI);
  if (h.hurtT > 0) lean -= 0.2 * clamp(h.hurtT / 0.4, 0, 1);
  lean += Math.sin(t * 2.3 + h.x * 0.01) * 0.012 * (1 - sp); // дихання
  const TL = RIG.torso;
  const Sh = rot(H, lean, 1, -TL + 3); // плечовий суглоб
  // ---- що в руках: цілі для кистей ----
  let back = null, front = null, gun = null, gunBack = !!h.weapon, prop = null, extra = null;
  const rec = h.weapon ? clamp(h.fireCd / WEAPONS[h.weapon.type].rate, 0, 1) : 0;
  if (h.meleeT > 0) {
    const k = Math.sin((1 - h.meleeT / MELEE_T) * Math.PI), reach = 6 + k * 13;
    if (h.weapon && !h.carry) {
      // удар прикладом: зброя горизонтально, прикладом уперед
      const B = { x: Sh.x + reach + 6, y: Sh.y + 6 };
      gun = { B, ang: Math.PI }; gunBack = false;
      front = gunPoint(B, Math.PI, GUN_GRIP, 2); back = gunPoint(B, Math.PI, GUN_FORE, 1);
    } else if (h.carry) { prop = { x: Sh.x + reach + 3, y: Sh.y + 2 }; front = { x: prop.x - 3, y: prop.y + 1 }; back = { x: prop.x - 6, y: prop.y + 3 }; }
    else { front = { x: Sh.x + reach + 4, y: Sh.y + 2 }; back = { x: Sh.x + 7, y: Sh.y + 4 }; }
  } else if (h.mount) {
    const a = h.aimA, P0 = { x: 0, y: -38 };
    front = { x: P0.x + Math.cos(a) * 2, y: P0.y + Math.sin(a) * 2 + 1 }; back = { x: P0.x + Math.cos(a) * 12, y: P0.y + Math.sin(a) * 12 };
  } else if (h.piloting) {
    // пульт керування дроном у руках, окуляри на очах
    extra = { kind: 'remote', p: { x: Sh.x + 9, y: Sh.y + 9 } };
    front = { x: extra.p.x + 3, y: extra.p.y }; back = { x: extra.p.x - 2, y: extra.p.y + 1 };
  } else if (busyDig) {
    // руки на держаку лопати (лопату малює drawShovel)
    const a = 0.9 + Math.sin(t * 12) * 0.45, pv = { x: 6, y: -22 };
    front = { x: pv.x + Math.cos(a) * 9, y: pv.y + Math.sin(a) * 9 }; back = { x: pv.x + Math.cos(a) * 1, y: pv.y + Math.sin(a) * 1 };
  } else if (h.carry) {
    // річ над головою — замах для кидка
    prop = h.aiming ? { x: Sh.x + 2 + Math.cos(h.aimA - 1.2) * 6, y: Sh.y - 14 + Math.sin(h.aimA) * 4 } : { x: Sh.x + 3, y: Sh.y - 15 };
    front = { x: prop.x + 3, y: prop.y + 4 }; back = { x: prop.x - 3, y: prop.y + 4 };
  } else if (h.canister) {
    extra = { kind: 'can', p: { x: Sh.x + 6, y: H.y + 3 } };
    front = { x: extra.p.x, y: extra.p.y - 6 };
  } else if (h.onLadder) {
    const q = Math.sin(ph);
    front = { x: Sh.x + 5, y: Sh.y - 7 - 5 * q }; back = { x: Sh.x + 5, y: Sh.y - 7 + 5 * q };
  } else if (h.weapon && h.healT <= 0) {
    gunBack = false;
    if (h.aiming) {
      const a = h.aimA, B = { x: Sh.x + 1 - Math.cos(a) * rec * 2.5, y: Sh.y + 1 - Math.sin(a) * rec * 2.5 };
      gun = { B, ang: a };
    } else {
      const a = 0.55 + 0.2 * sp + Math.sin(ph) * 0.05 * sp, B = { x: Sh.x + 2, y: Sh.y + 7 };
      gun = { B, ang: a };
    }
    front = gunPoint(gun.B, gun.ang, GUN_GRIP, 2.2); back = gunPoint(gun.B, gun.ang, GUN_FORE, 1.2);
  } else if (h.healT > 0) {
    // перев'язка: руки до стегна
    front = { x: H.x + 5, y: H.y + 2 }; back = { x: H.x + 2, y: H.y + 4 };
    extra = { kind: 'bandage', p: { x: H.x + 4, y: H.y + 3 } };
  }
  // ---- малюємо: дальня рука, дальня нога, тулуб, ближня нога, голова, зброя, ближня рука ----
  const swing = (o) => -0.55 * Math.sin(ph + o) * sp;
  const ShB = { x: Sh.x - 1, y: Sh.y + 0.5 };
  if (back) armTo(ctx, ShB, back, C.uniD);
  else if (!front || h.canister) armAngles(ctx, ShB, swing(Math.PI) - (crouch ? 0.2 : 0), swing(Math.PI) + 0.35 + 0.3 * sp, C.uniD);
  const legPts = (l) => { const k = seg(H, l.t, RIG.thigh); return [H, k, seg(k, l.s, RIG.shin)]; };
  const L0 = legPts(legs[0]), L1 = legPts(legs[1]);
  limb(ctx, L0, 5.6, C.pantsD); boot(ctx, L0[2], h.onLadder ? 0 : Math.min(0.5, Math.max(-0.4, legs[0].s * 0.4)), HCOL.boot);
  ctx.save(); ctx.translate(H.x, H.y); ctx.rotate(lean);
  if (gunBack && h.weapon) { ctx.save(); ctx.translate(-9, -TL + 2); ctx.rotate(1.15); drawGunShape(ctx, h.weapon.type); ctx.restore(); } // зброя за спиною
  drawTorso(ctx, h, C, TL);
  ctx.restore();
  limb(ctx, L1, 5.6, C.pants); boot(ctx, L1[2], h.onLadder ? 0 : Math.min(0.5, Math.max(-0.4, legs[1].s * 0.4)), HCOL.boot);
  // наколінник
  ctx.fillStyle = HCOL.rigD; ctx.beginPath(); ctx.arc(L1[1].x + 1, L1[1].y, 2.2, 0, 7); ctx.fill();
  let tilt = lean * 0.6;
  if (h.aiming && (gun || prop)) tilt = clamp(h.aimA * 0.45, -0.5, 0.3);
  if (h.onLadder) tilt = -0.25;
  drawHead(ctx, rot(H, lean, 1.6, -TL - 6.6), tilt, C.team, { goggles: h.piloting });
  if (gun) drawGunAt(ctx, h.weapon.type, gun.B, gun.ang);
  if (prop) drawProp(ctx, h.carry, prop.x, prop.y + 6, h.aiming ? h.aimA : 0);
  if (extra) {
    if (extra.kind === 'can') { ctx.fillStyle = HCOL.line; roundRect(ctx, extra.p.x - 5.6, extra.p.y - 7.6, 11.2, 14.2, 2.4); ctx.fill(); ctx.fillStyle = '#a8322d'; roundRect(ctx, extra.p.x - 4.6, extra.p.y - 6.6, 9.2, 12.2, 2); ctx.fill(); ctx.fillStyle = '#6e1f1b'; ctx.fillRect(extra.p.x - 2, extra.p.y - 9.6, 4, 3); }
    else if (extra.kind === 'remote') { ctx.fillStyle = HCOL.line; roundRect(ctx, extra.p.x - 4.4, extra.p.y - 2.6, 8.8, 5.4, 1.4); ctx.fill(); ctx.fillStyle = '#4a4a4a'; ctx.fillRect(extra.p.x - 3.4, extra.p.y - 1.6, 6.8, 3.2); ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(extra.p.x + 3, extra.p.y - 2.6); ctx.lineTo(extra.p.x + 4.5, extra.p.y - 8); ctx.stroke(); }
    else if (extra.kind === 'bandage') { ctx.fillStyle = '#eee'; ctx.fillRect(extra.p.x - 3, extra.p.y - 2, 6, 3); }
  }
  // ближня рука з пов'язкою кольору гравця
  let fr;
  if (front) fr = armTo(ctx, Sh, front, C.uni);
  else { const a1 = swing(0) - (crouch ? 0.2 : 0), el = seg(Sh, a1, RIG.upper); fr = { j: el }; armAngles(ctx, Sh, a1, a1 + 0.35 + 0.3 * sp, C.uni); }
  const bandP = { x: Sh.x + (fr.j.x - Sh.x) * 0.45, y: Sh.y + (fr.j.y - Sh.y) * 0.45 };
  ctx.fillStyle = C.team; ctx.beginPath(); ctx.arc(bandP.x, bandP.y, 2.1, 0, 7); ctx.fill();
}

// ---- лежачи / повзком ----
function drawBodyProne(ctx, h, t, C) {
  const sp = clamp(Math.abs(h.vx) / 55, 0, 1), ph = h.anim * 2 || 0;
  const H = { x: -7, y: -6 }, lean = 1.45;
  const TL = RIG.torso;
  const Sh = rot(H, lean, 1, -TL + 3);
  // ноги назад, у повзанні по черзі згинаються
  const legs = [0, Math.PI].map((o) => { const q = ph + o, th = -Math.PI / 2 + 0.12 + 0.22 * sp * Math.sin(q); return { t: th, s: th - 0.08 - 0.75 * sp * Math.max(0, Math.sin(q)) }; });
  const legPts = (l) => { const k = seg(H, l.t, RIG.thigh); return [H, k, seg(k, l.s, RIG.shin)]; };
  let gun = null, front, back;
  if (h.weapon) {
    const a = h.aiming ? clamp(h.aimA, -0.6, 0.2) : 0.06, B = { x: Sh.x + 3, y: Sh.y + 2.5 };
    gun = { B, ang: a }; front = gunPoint(B, a, GUN_GRIP, 2.2); back = gunPoint(B, a, GUN_FORE, 1.2);
  } else {
    const q = Math.sin(ph) * sp;
    front = { x: Sh.x + 8 + 5 * q, y: -1.5 }; back = { x: Sh.x + 12 - 5 * q, y: -1.5 };
  }
  // дальня рука збоку не видна (лише без зброї — спирається на землю)
  if (!gun) armTo(ctx, { x: Sh.x - 0.5, y: Sh.y + 0.5 }, back, C.uniD);
  const L0 = legPts(legs[0]), L1 = legPts(legs[1]);
  limb(ctx, L0, 5, C.pantsD); boot(ctx, L0[2], Math.PI / 2 + 0.3, HCOL.boot);
  ctx.save(); ctx.translate(H.x, H.y); ctx.rotate(lean); drawTorso(ctx, h, C, TL); ctx.restore();
  limb(ctx, L1, 5, C.pants); boot(ctx, L1[2], Math.PI / 2 + 0.3, HCOL.boot);
  drawHead(ctx, rot(H, lean, 1.6, -TL - 6.4), h.aiming ? clamp(h.aimA * 0.5, -0.4, 0.1) - 0.15 : -0.2, C.team, {});
  armTo(ctx, Sh, front, C.uni);
  if (gun) drawGunAt(ctx, h.weapon.type, gun.B, gun.ang); // приклад біля щоки
}

// ---- загиблий: лежить на спині ----
function drawBodyDead(ctx, h, C) {
  const H = { x: 3, y: -5 }, lean = -1.5, TL = RIG.torso;
  const Sh = rot(H, lean, 1, -TL + 3);
  armAngles(ctx, Sh, -1.75, -1.45, C.uniD);
  const legPts = (a1, a2) => { const k = seg(H, a1, RIG.thigh); return [H, k, seg(k, a2, RIG.shin)]; };
  const L0 = legPts(Math.PI / 2 - 0.35, Math.PI / 2 + 0.2), L1 = legPts(Math.PI / 2 - 0.12, Math.PI / 2 + 0.05);
  limb(ctx, L0, 5.4, C.pantsD); boot(ctx, L0[2], -1.2, '#2a2a2a');
  ctx.save(); ctx.translate(H.x, H.y); ctx.rotate(lean); drawTorso(ctx, h, C, TL); ctx.restore();
  limb(ctx, L1, 5.4, C.pants); boot(ctx, L1[2], -1.3, '#2a2a2a');
  drawHead(ctx, rot(H, lean, 1.6, -TL - 6.4), lean + 0.25, C.team, { dead: true });
  armAngles(ctx, Sh, -1.4, -1.9, C.uni);
}

// ---- людина в техніці: сидить ----
function drawRider(ctx, v, h) {
  const T = VEH[v.type];
  const off = h.seat === 'gunner' ? -T.len * 0.15 : T.len * 0.05;
  const x = v.x + off * v.dir, y = v.y - (v.type === 'car' ? T.h - 6 : T.h - 4);
  const C = humanCols(h);
  ctx.save(); ctx.translate(x, y); ctx.scale(v.dir, 1); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const H = { x: 0, y: 0 }, lean = h.seat === 'gunner' ? 0.05 : 0.18, TL = RIG.torso;
  const Sh = rot(H, lean, 1, -TL + 3);
  const tgt = h.seat === 'gunner' ? { x: -T.len * 0.15 * 0 + 9, y: -T.h * 0 - 16 } : { x: 13, y: -8 };
  armTo(ctx, { x: Sh.x - 1, y: Sh.y + 0.5 }, { x: tgt.x - 3, y: tgt.y + 1 }, C.uniD);
  const k = seg(H, Math.PI / 2 - 0.15, RIG.thigh), a = seg(k, 0.15, RIG.shin * 0.8);
  limb(ctx, [H, k, a], 5.6, C.pants); boot(ctx, a, 0, HCOL.boot);
  ctx.save(); ctx.translate(H.x, H.y); ctx.rotate(lean); drawTorso(ctx, h, C, TL); ctx.restore();
  drawHead(ctx, rot(H, lean, 1.6, -TL - 6.6), lean * 0.5, C.team, {});
  armTo(ctx, Sh, tgt, C.uni);
  ctx.restore();
}
