'use strict';
// ===== Утиліти =====
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let RND = Math.random;
const rand = (a, b) => a + (b - a) * RND();
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(RND() * arr.length)];
function weighted(table) {
  let sum = 0;
  for (const k in table) sum += table[k];
  let r = RND() * sum;
  for (const k in table) { r -= table[k]; if (r <= 0) return k; }
  return Object.keys(table)[0];
}
// відстань від точки до прямокутника
function rectDist(px, py, r) {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}

// ===== Керування =====
const Keys = {};
const ACTIONS = ['left', 'right', 'up', 'down', 'sprint', 'interact', 'fire', 'special', 'aim'];
// Одна клавіатура = один гравець. Ліва рука на WASD, великий палець на пробілі.
// Стрілки дублюють WASD (рух і кут прицілу).
const KB_SCHEMES = {
  kb: { name: 'Клавіатура', short: 'WASD', keys: {
    left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
    sprint: ['ShiftLeft', 'ShiftRight'], interact: ['KeyE'], fire: ['KeyF', 'KeyJ'], special: ['KeyQ'], aim: ['Space'],
  } },
};
const GP_LABELS = { left: '←', right: '→', up: '↑/A', down: '↓/B', sprint: 'LB', interact: 'X', fire: 'RB', special: 'Y', aim: 'LT' };
const LOBBY_CODES = ['Escape', 'Enter'];
const USED_CODES = new Set(LOBBY_CODES);
for (const s of Object.values(KB_SCHEMES)) for (const cs of Object.values(s.keys)) for (const c of cs) USED_CODES.add(c);

function codeLabel(c) {
  if (c.startsWith('Key')) return c.slice(3);
  if (c.startsWith('Numpad')) return 'Num' + c.slice(6).replace('Add', '+');
  return { Space: 'Пробіл', ShiftLeft: 'Shift', ShiftRight: 'Shift', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'" }[c] || c;
}

window.addEventListener('keydown', (e) => {
  Keys[e.code] = true;
  // у лобі клавіші працюють як на звичайній сторінці (прокрутка), у грі — не прокручують
  if (USED_CODES.has(e.code) && !(typeof state !== 'undefined' && state === 'lobby' && e.code.startsWith('Arrow'))) e.preventDefault();
  Sfx.unlock();
});
window.addEventListener('keyup', (e) => { Keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in Keys) Keys[k] = false; });
window.addEventListener('mousedown', () => Sfx.unlock());

class Controller {
  constructor(id) {
    this.id = id;
    this.isPad = id.startsWith('gp');
    this.cur = {}; this.prev = {};
    this.name = this.isPad ? 'Геймпад ' + (+id.slice(2) + 1) : KB_SCHEMES[id].name;
  }
  connected() {
    if (!this.isPad) return true;
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    return !!gps[+this.id.slice(2)];
  }
  poll() {
    this.prev = this.cur;
    const s = { ax: 0, ay: 0 };
    if (!this.isPad) {
      const m = KB_SCHEMES[this.id].keys;
      for (const a of ACTIONS) s[a] = m[a].some((c) => !!Keys[c]);
    } else {
      const gps = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = gps[+this.id.slice(2)];
      if (gp) {
        const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
        const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
        s.left = ax < -0.45 || b(14); s.right = ax > 0.45 || b(15);
        s.up = ay < -0.6 || b(12) || b(0); s.down = ay > 0.6 || b(13) || b(1);
        s.sprint = b(4); s.aim = b(6); s.fire = b(5) || b(7); s.interact = b(2) || b(9); s.special = b(3);
        if (Math.hypot(ax, ay) > 0.2) { s.ax = ax; s.ay = ay; }
      }
    }
    if (!s.ax && !s.ay) {
      s.ax = (s.right ? 1 : 0) - (s.left ? 1 : 0);
      s.ay = (s.down ? 1 : 0) - (s.up ? 1 : 0);
    }
    this.cur = s;
  }
  held(a) { return !!this.cur[a]; }
  pressed(a) { return !!this.cur[a] && !this.prev[a]; }
  get axisX() { return (this.cur.right ? 1 : 0) - (this.cur.left ? 1 : 0); }
  label(a) { return this.isPad ? GP_LABELS[a] : codeLabel(KB_SCHEMES[this.id].keys[a][0]); }
}
const CONTROLLERS = {};
for (const id of ['kb', 'gp0', 'gp1', 'gp2', 'gp3']) CONTROLLERS[id] = new Controller(id);

// Глобальні клавіші (Enter, Esc)
const GlobalKeys = {
  prev: {},
  cur: {},
  poll() { this.prev = this.cur; this.cur = {}; for (const k of LOBBY_CODES) this.cur[k] = !!Keys[k]; },
  pressed(k) { return this.cur[k] && !this.prev[k]; },
};

// ===== Звук (синтез через WebAudio) =====
const Sfx = {
  ctx: null,
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      const ctx = (this.ctx = new C());
      this.master = ctx.createGain(); this.master.gain.value = 0.45; this.master.connect(ctx.destination);
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 170;
      const osc2 = ctx.createOscillator(); osc2.type = 'sawtooth'; osc2.frequency.value = 173;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 1.4;
      const g = ctx.createGain(); g.gain.value = 0;
      osc.connect(f); osc2.connect(f); f.connect(g); g.connect(this.master);
      osc.start(); osc2.start();
      this.buzz = { osc, osc2, g };
    } catch (e) { this.ctx = null; }
  },
  setBuzz(level, pitch) {
    if (!this.buzz) return;
    const t = this.ctx.currentTime;
    this.buzz.g.gain.setTargetAtTime(level * 0.16, t, 0.06);
    this.buzz.osc.frequency.setTargetAtTime(pitch, t, 0.06);
    this.buzz.osc2.frequency.setTargetAtTime(pitch * 1.02, t, 0.06);
  },
  noise_(dur, vol, freq, type) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  },
  tone(freq, dur, vol, type) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type || 'square'; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  },
  shot() { this.noise_(0.09, 0.3, 2200, 'highpass'); },
  boom(big) { this.noise_(big ? 1.3 : 0.5, big ? 0.9 : 0.45, big ? 380 : 900); },
  click() { this.tone(660, 0.06, 0.15); },
  reb() { this.tone(110, 0.8, 0.25, 'sawtooth'); this.noise_(0.8, 0.25, 4000, 'highpass'); },
  win() { [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, 0.2), i * 140)); },
};
