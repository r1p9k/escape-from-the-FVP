'use strict';
// ===== Гра по мережі =====
// Хост рахує всю гру, як завжди. Гравці на інших ПК надсилають хосту стан своїх клавіш,
// а хост ~30 разів на секунду розсилає зміни стану гри (лише ті об'єкти, що змінилися).
// Гравець лише малює свою частину екрана; частинки (пил, дим, уламки) дораховує сам.
const NET = {
  ws: null, role: null, code: null, cid: 0, addrs: [], err: '', peers: new Map(),
  rc: new Map(),            // хост: cid → RemoteController
  sendT: 0, rate: 1 / 30,   // хост: як часто розсилати стан
  rec: false, depth: 0, sfx: [], buzz: [0, 150], // звуки, що прозвучали за кадр
  // гравець
  lobby: null, started: false, pz: false, snapT: 0, snapDt: 1 / 30, ip: new Map(), lastIn: '', inT: 0, userZ: 1, ctrl: null,
};
function netUrl() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'; }
function netOpen(first, onmsg) {
  try { NET.ws = new WebSocket(netUrl()); } catch (e) { NET.err = 'Немає з\'єднання з сервером гри'; return; }
  NET.ws.onopen = () => NET.ws.send(JSON.stringify(first));
  NET.ws.onmessage = (e) => onmsg(e.data);
  NET.ws.onclose = () => {
    const was = NET.role;
    NET.ws = null; NET.role = null; NET.code = null; NET.started = false;
    if (was === 'client') { NET.err = NET.err || 'З\'єднання з хостом утрачено'; state = 'lobby'; lobbyEl.classList.remove('hidden'); }
    if (was === 'host') { Lobby.slots = Lobby.slots.filter((s) => !s.remote); Lobby.renumber(); NET.err = 'Кімнату закрито'; }
    if (state === 'lobby') renderLobbyDOM();
  };
}
function netClose() { NET.err = ''; if (NET.ws) NET.ws.close(); }

// ---------- Хост ----------
class RemoteController {
  constructor(cid) { this.cid = cid; this.remote = true; this.isPad = false; this.cur = { ax: 0, ay: 0 }; this.prev = {}; this.latest = { ax: 0, ay: 0 }; this.acc = {}; this.name = 'По мережі'; }
  feed(s) { this.latest = s; for (const a in s) if (s[a] === true) this.acc[a] = true; } // коротке натискання між кадрами не загубиться
  poll() { this.prev = this.cur; this.cur = Object.assign({ ax: 0, ay: 0 }, this.latest, this.acc); this.acc = {}; }
  held(a) { return !!this.cur[a]; }
  pressed(a) { return !!this.cur[a] && !this.prev[a]; }
  get axisX() { return (this.cur.right ? 1 : 0) - (this.cur.left ? 1 : 0); }
  label(a) { return codeLabel(KB_SCHEMES.kb.keys[a][0]); }
}
function netCtrl(s) { let c = NET.rc.get(s.cid); if (!c) NET.rc.set(s.cid, (c = new RemoteController(s.cid))); return c; }
function netHost() {
  NET.err = ''; NET.role = 'host';
  netOpen({ t: 'host' }, (raw) => {
    if (raw[0] === '{') {
      const m = JSON.parse(raw);
      if (m.t === 'room') { NET.code = m.code; NET.addrs = m.addrs || []; renderLobbyDOM(); }
      return;
    }
    const k = raw.indexOf('|'), cid = +raw.slice(0, k), m = JSON.parse(raw.slice(k + 1));
    if (m.t === 'in') {
      netCtrl({ cid }).feed(m.s);
      if (state === 'game' && m.z) { const p = G.players.find((q) => q.cid === cid); if (p) p.cam.userZ = clamp(m.z, 1, 2.4); }
    } else if (m.t === 'joined') {
      NET.peers.set(cid, { name: m.name || 'Гравець' });
      if (state === 'lobby' && Lobby.slots.length < 8) {
        Lobby.slots.push({ scheme: 'net' + cid, remote: true, cid, pname: m.name || '', role: Lobby.autoRole(), level: 1, team: Lobby.slots.length % 2 });
        Lobby.renumber(); renderLobbyDOM();
      }
      netLobbyChanged();
    } else if (m.t === 'left') {
      NET.peers.delete(cid);
      if (state === 'lobby') { Lobby.slots = Lobby.slots.filter((s) => s.cid !== cid); Lobby.renumber(); renderLobbyDOM(); netLobbyChanged(); }
      else if (G) feed('Гравець по мережі відключився', '#ccc');
    }
  });
}
// стиснення знімків (у ~5 разів менше трафіку): deflate → base64, порядок повідомлень зберігається
function b64enc(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function b64dec(s) { const b = atob(s), u8 = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i); return u8; }
const NET_Z = typeof CompressionStream !== 'undefined';
async function zPack(text) { return b64enc(new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())); }
async function zUnpack(b64) { return new Response(new Blob([b64dec(b64)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text(); }
NET.zq = Promise.resolve();
function netSendZ(to, text) {
  if (!NET_Z) { netSend(to, text); return; }
  NET.zq = NET.zq.then(() => zPack(text)).then((z) => netSend(to, 'z' + z)).catch((e) => console.warn('мережа: стиснення', e));
}
function netSend(to, obj) { if (NET.ws && NET.ws.readyState === 1) NET.ws.send(to + '|' + (typeof obj === 'string' ? obj : JSON.stringify(obj))); }
// гравцям — хто в лобі
function netLobbyChanged() {
  if (NET.role !== 'host') return;
  netSend('*', { t: 'lobby', mode: Lobby.mode, loc: LOCATIONS[Lobby.loc].name, slots: Lobby.slots.map((s) => ({ name: s.name, role: s.role, bot: !!s.bot, cid: s.cid || 0, team: s.team || 0, color: s.color })) });
}
function netToLobby() { if (NET.role === 'host') { netSend('*', { t: 'tolobby' }); netLobbyChanged(); } }

// кодування стану: кожен об'єкт гри — вузол з номером, посилання — {"#": номер}
const ENC = { ids: new WeakMap(), next: 1, last: new Map(), parts: new WeakSet() };
const NET_SKIP = new Set(['ctrl', 'cavMap']);
const NET_U = { '#u': 1 };
function encReset() { ENC.ids = new WeakMap(); ENC.next = 1; ENC.last = new Map(); ENC.parts = new WeakSet(); }
function plainKind(v) {
  if (Array.isArray(v) || ArrayBuffer.isView(v)) return 'a';
  if (v instanceof Set) return 's';
  const pr = Object.getPrototypeOf(v);
  return pr === Object.prototype || pr === null ? 'o' : null;
}
function encState(full) {
  const out = [], seen = new Set([G]), stack = [G], SKIPV = encState;
  const idOf = (v) => { let id = ENC.ids.get(v); if (!id) { id = ENC.next++; ENC.ids.set(v, id); } return id; };
  const val = (v) => {
    if (v === undefined) return NET_U;
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : v !== v ? 0 : { '#i': v > 0 ? 1 : -1 };
    if (typeof v === 'function') return SKIPV;
    if (v === null || typeof v !== 'object') return v;
    if (!plainKind(v)) return SKIPV;
    if (!seen.has(v)) { seen.add(v); stack.push(v); }
    return { '#': idOf(v) };
  };
  const root = idOf(G), vis = new Set();
  while (stack.length) {
    const o = stack.pop(), id = idOf(o), k = plainKind(o);
    vis.add(id);
    let d;
    if (k === 'a') { d = new Array(o.length); for (let i = 0; i < o.length; i++) { const x = val(o[i]); d[i] = x === SKIPV ? null : x; } }
    else if (k === 's') { d = { '#s': [] }; for (const x of o) { const y = val(x); if (y !== SKIPV) d['#s'].push(y); } }
    else {
      d = {};
      for (const key in o) {
        if (NET_SKIP.has(key) || key[0] === '_' || (o === G && key === 'parts')) continue;
        const x = val(o[key]);
        if (x !== SKIPV) d[key] = x;
      }
    }
    const s = JSON.stringify(d);
    if (full || ENC.last.get(id) !== s) { ENC.last.set(id, s); out.push('"' + id + '":' + s); }
  }
  // об'єкти, яких уже немає в грі, забути: якщо повернуться — надіслати заново
  for (const id of ENC.last.keys()) if (!vis.has(id)) ENC.last.delete(id);
  // нові частинки — гравці рахують їх самі
  const np = [];
  for (const p of G.parts) {
    if (ENC.parts.has(p)) continue;
    ENC.parts.add(p);
    const c = {};
    for (const key in p) { const v = p[key]; if (v == null || typeof v !== 'object' || (Array.isArray(v) && v.every((x) => typeof x !== 'object'))) c[key] = v; }
    np.push(c);
  }
  return '"r":' + root + ',"n":{' + out.join(',') + '},"p":' + JSON.stringify(np);
}
function netStartHost() {
  if (NET.role !== 'host') return;
  encReset();
  for (const p of G.parts) ENC.parts.add(p);
  netSendZ('*', '{"t":"start","loc":' + JSON.stringify(G.W.loc) + ',"width":' + G.W.width + ',' + encState(true) + '}');
  NET.sendT = 0; NET.sfx = [];
}
function netHostTick(dt) {
  if (NET.role !== 'host' || !NET.peers.size || state !== 'game') { NET.sfx = []; return; }
  NET.sendT += dt;
  if (NET.sendT < NET.rate) return;
  NET.sendT = 0;
  const msg = '{"t":"s",' + encState(false) + ',"f":' + JSON.stringify(NET.sfx) + ',"b":' + JSON.stringify(NET.buzz) + ',"pz":' + (paused ? 1 : 0) + '}';
  NET.sfx = [];
  netSendZ('*', msg);
}
// звуки хоста повторюються в гравців
(function netWrapSfx() {
  for (const name of ['shot', 'boom', 'click', 'reb', 'win', 'tone', 'noise_']) {
    const orig = Sfx[name];
    Sfx[name] = function (...a) {
      if (NET.rec && NET.depth === 0 && NET.sfx.length < 40) NET.sfx.push([name, a]);
      NET.depth++;
      try { return orig.apply(this, a); } finally { NET.depth--; }
    };
  }
  const sb = Sfx.setBuzz;
  Sfx.setBuzz = function (l, p) { if (NET.rec) NET.buzz = [Math.round(l * 100) / 100, Math.round(p)]; return sb.call(this, l, p); };
})();

// ---------- Гравець ----------
const DEC = { objs: new Map() };
function netJoin(code, name) {
  NET.err = ''; NET.role = 'client'; NET.lobby = null; NET.started = false;
  savePref('netName', name || '');
  NET.dq = Promise.resolve();
  netOpen({ t: 'join', code, name }, (raw) => {
    if (raw[0] === 'z') { NET.dq = NET.dq.then(() => zUnpack(raw.slice(1))).then(netClientMsg).catch((e) => console.warn('мережа: знімок', e)); return; }
    NET.dq = NET.dq.then(() => netClientMsg(raw));
  });
}
function netClientMsg(raw) {
  {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') { NET.cid = m.cid; NET.code = m.code; renderLobbyDOM(); }
    else if (m.t === 'err') { NET.err = m.text; NET.role = null; if (NET.ws) { const w = NET.ws; NET.ws = null; w.onclose = null; w.close(); } renderLobbyDOM(); }
    else if (m.t === 'lobby') { NET.lobby = m; if (state === 'lobby') renderLobbyDOM(); }
    else if (m.t === 'closed') { NET.err = 'Хост закрив кімнату'; if (NET.ws) NET.ws.close(); }
    else if (m.t === 'tolobby') { state = 'lobby'; NET.started = false; Sfx.setBuzz(0, 150); lobbyEl.classList.remove('hidden'); renderLobbyDOM(); }
    else if (m.t === 'start') {
      DEC.objs = new Map(); NET.ip = new Map();
      decApply(m.n, false);
      G = DEC.objs.get(m.r);
      G.W.themeAt = makeThemeAt(m.loc, m.width);
      G.W.cavMap = new Map();
      G.parts = m.p || [];
      netLocalCtrl();
      NET.started = true; NET.pz = false; NET.snapT = performance.now();
      state = 'net'; lobbyEl.classList.add('hidden');
    } else if (m.t === 's' && NET.started) {
      const now = performance.now();
      NET.snapDt = clamp(lerp(NET.snapDt, (now - NET.snapT) / 1000, 0.2), 0.016, 0.12); NET.snapT = now;
      decApply(m.n, true);
      G.W.cavMap = new Map();
      for (const p of m.p) G.parts.push(p);
      for (const [n, a] of m.f) if (Sfx[n]) Sfx[n](...a);
      Sfx.setBuzz(m.b[0], m.b[1]);
      NET.pz = !!m.pz;
      netLocalCtrl();
      if (now - (NET.pruneT || 0) > 3000) { NET.pruneT = now; decPrune(); }
    }
  }
}
// гравець: прибрати об'єкти, недосяжні зі стану гри (кулі, вибухи, що минули)
function decPrune() {
  const reach = new Set(), st = [G];
  while (st.length) {
    const o = st.pop();
    if (!o || typeof o !== 'object' || reach.has(o)) continue;
    reach.add(o);
    if (o === G.parts || o === G.W.cavMap) continue;
    if (o instanceof Set || Array.isArray(o)) { for (const x of o) if (x && typeof x === 'object') st.push(x); }
    else if (plainKind(o) === 'o') for (const k in o) { const x = o[k]; if (x && typeof x === 'object' && k !== 'ctrl') st.push(x); }
  }
  for (const [id, o] of DEC.objs) if (!reach.has(o)) DEC.objs.delete(id);
}
function decApply(n, smooth) {
  const O = DEC.objs;
  // плавність: попередні цілі — досягнуто
  for (const [o, q] of NET.ip) { o.x = q.tx; o.y = q.ty; }
  NET.ip.clear();
  for (const id in n) if (!O.has(+id)) { const d = n[id]; O.set(+id, Array.isArray(d) ? [] : d && d['#s'] ? new Set() : {}); }
  const rv = (x) => {
    if (x && typeof x === 'object' && !Array.isArray(x)) {
      if ('#' in x) return O.get(x['#']);
      if ('#u' in x) return undefined;
      if ('#i' in x) return x['#i'] * Infinity;
    }
    return x;
  };
  for (const id in n) {
    const o = O.get(+id), d = n[id];
    if (Array.isArray(o)) { o.length = d.length; for (let i = 0; i < d.length; i++) o[i] = rv(d[i]); }
    else if (o instanceof Set) { o.clear(); for (const x of d['#s']) o.add(rv(x)); }
    else {
      const ox = o.x, oy = o.y;
      for (const key in d) o[key] = rv(d[key]);
      // рухомі об'єкти — плавно між знімками (стрибок далі 150 — одразу)
      if (smooth && typeof ox === 'number' && typeof o.x === 'number' && typeof o.y === 'number' && (ox !== o.x || oy !== o.y) && Math.abs(ox - o.x) + Math.abs(oy - o.y) < 150) {
        NET.ip.set(o, { fx: ox, fy: oy, tx: o.x, ty: o.y });
        o.x = ox; o.y = oy;
      }
    }
  }
}
// керування цього ПК: клавіатура або геймпад
function netLocalCtrl() {
  if (!NET.ctrl) {
    NET.ctrl = { isPad: false, cur: { ax: 0, ay: 0 }, prev: {}, name: 'Клавіатура',
      held(a) { return !!this.cur[a]; }, pressed(a) { return !!this.cur[a] && !this.prev[a]; },
      get axisX() { return (this.cur.right ? 1 : 0) - (this.cur.left ? 1 : 0); }, label: (a) => codeLabel(KB_SCHEMES.kb.keys[a][0]), poll() {} };
  }
  if (G) for (const p of G.players) if (!p.ctrl) p.ctrl = NET.ctrl;
}
function netClientFrame(dt, t) {
  // зібрати клавіші: клавіатура + перший геймпад
  const kb = CONTROLLERS.kb.cur, gp = CONTROLLERS.gp0.cur, s = { ax: 0, ay: 0 };
  for (const a of ACTIONS) s[a] = !!(kb[a] || gp[a]);
  s.ax = gp.ax || kb.ax || 0; s.ay = gp.ay || kb.ay || 0;
  NET.ctrl.prev = NET.ctrl.cur; NET.ctrl.cur = s;
  const js = JSON.stringify(s);
  NET.inT += dt;
  if ((js !== NET.lastIn || NET.inT > 0.25) && NET.ws && NET.ws.readyState === 1) {
    NET.lastIn = js; NET.inT = 0;
    NET.ws.send('{"t":"in","s":' + js + ',"z":' + NET.userZ + '}');
  }
  // плавний рух між знімками
  const k = clamp((performance.now() - NET.snapT) / 1000 / NET.snapDt, 0, 1);
  for (const [o, q] of NET.ip) { o.x = q.fx + (q.tx - q.fx) * k; o.y = q.fy + (q.ty - q.fy) * k; }
  updateParts(dt);
  renderGame(ctx, VW, VH, t);
  if (NET.pz) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, VW, VH);
    centerText(ctx, 'ПАУЗА', VW / 2, VH / 2 - 20, 44, '#fff');
    centerText(ctx, 'Хост поставив гру на паузу', VW / 2, VH / 2 + 24, 18, '#ddd');
  }
}

// ---------- Лобі ----------
function netLobbyHtml() {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const err = NET.err ? '<div class="net-err">' + esc(NET.err) + '</div>' : '';
  if (NET.role === 'host') {
    const port = location.port ? ':' + location.port : '';
    const links = (NET.addrs.length ? NET.addrs : [location.hostname]).map((a) => '<code>' + location.protocol + '//' + a + port + '/?join=' + NET.code + '</code>').join(' або ');
    return '<div class="net">' + (NET.code
      ? '<div>Кімната <b class="code">' + NET.code + '</b> · підключено гравців: ' + NET.peers.size + '</div>' +
        '<small>На інших ПК відкрийте ' + links + ' (або введіть код кімнати в цьому розділі). Підключені гравці з\'являються в учасниках — оберіть їм роль і почніть гру.</small>'
      : '<div>Створюю кімнату…</div>') +
      '<button data-act="netclose">Закрити кімнату</button></div>' + err;
  }
  return '<div class="net"><button data-act="nethost">🌐 Створити кімнату</button>' +
    '<span class="net-join"><input id="netName" placeholder="Ваше ім\'я" maxlength="20" value="' + esc(loadPref('netName', '')) + '">' +
    '<input id="netCode" placeholder="Код кімнати" maxlength="4" inputmode="numeric"><button data-act="netjoin">Приєднатися</button></span>' +
    '<small>Один ПК — хост: на ньому йде гра, решта підключаються за кодом і грають на своїх клавіатурах чи геймпадах. Усі мають відкривати гру з одного сервера (node serve.js).</small></div>' + err;
}
// екран гравця, що чекає на старт
function netWaitHtml() {
  const L = NET.lobby;
  const rows = L ? L.slots.map((s) => '<li style="--pc:' + s.color + '"' + (s.cid === NET.cid ? ' class="me"' : '') + '>' + s.name + (s.cid === NET.cid ? ' (це ви)' : s.bot ? ' 🤖' : s.cid ? ' 🌐' : '') +
    ' — ' + (s.role === 'human' ? '🏃 людина' : '🛸 FPV-дрон') + (L.mode === 'team' ? ' · ' + TEAMS[s.team].name : '') + '</li>').join('') : '';
  return '<div class="wrap"><header><h1>ВТЕЧА ВІД FPV</h1><p>Гра по мережі</p></header>' +
    '<div class="net wait">' + (NET.code ? '<div>Ви в кімнаті <b class="code">' + NET.code + '</b>. Хост налаштовує гру й почне її, коли всі будуть готові.</div>' : '<div>Підключаюся…</div>') +
    (L ? '<div>Режим: ' + ({ escape: 'Втеча', dm: 'Дезматч', team: 'Команди' }[L.mode] || L.mode) + ' · Локація: ' + L.loc + '</div><ul class="net-list">' + rows + '</ul>' : '') +
    '<small>Ваше керування: клавіатура (WASD, Пробіл, F, E, R, Q, Shift, 1–3) або геймпад. Колесо миші — віддалити камеру.</small>' +
    '<button data-act="netclose">Вийти з кімнати</button></div>' + (NET.err ? '<div class="net-err">' + NET.err + '</div>' : '') + '</div>';
}
function netLobbyClick(act) {
  if (act === 'nethost') { netHost(); return true; }
  if (act === 'netclose') { netClose(); NET.role = null; renderLobbyDOM(); return true; }
  if (act === 'netjoin') {
    const code = (document.getElementById('netCode') || {}).value || '', name = (document.getElementById('netName') || {}).value || '';
    if (!/^\d{4}$/.test(code.trim())) { NET.err = 'Введіть 4 цифри коду кімнати'; renderLobbyDOM(); return true; }
    netJoin(code.trim(), name.trim()); renderLobbyDOM(); return true;
  }
  return false;
}
