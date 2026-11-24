'use strict';
// ===== Гра по мережі =====
// Хост рахує всю гру, як завжди. Гравці на інших ПК надсилають хосту стан своїх клавіш,
// а хост до 60 разів на секунду розсилає зміни стану гри (лише ті об'єкти, що змінилися, стиснено).
// Гравець лише малює свою частину екрана; частинки (пил, дим, уламки) дораховує сам.
// Зв'язок: WebRTC напряму між браузерами (PeerJS — лише щоб знайти одне одного, TURN — якщо напряму не вийшло).
// Якщо гра відкрита з node serve.js — запасний шлях через його WebSocket.
const NET = {
  role: null, code: null, cid: 0, addrs: [], err: '', status: '',
  peer: null, ws: null,
  links: new Map(),          // хост: cid → з'єднання з гравцем
  peers: new Map(),          // хост: cid → { name }
  rc: new Map(),             // хост: cid → RemoteController
  sendT: 0, rate: 1 / 60, pingT: 0, nextCid: 1000,
  rec: false, depth: 0, sfx: [], buzz: [0, 150], // звуки, що прозвучали за кадр
  // гравець
  link: null, lobby: null, started: false, pz: false, snapT: 0, snapDt: 1 / 60, ip: new Map(), lastIn: '', inT: 0, userZ: 1, ctrl: null,
  rtt: 0, via: '', chunks: null,
};
const NET_PREFIX = 'vtecha-vid-fpv-v1-';
const NET_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// STUN — дізнатися свою зовнішню адресу; TURN — ретранслятор, коли пряме з'єднання неможливе
const NET_ICE = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: ['turn:free.expressturn.com:3478', 'turn:free.expressturn.com:3478?transport=tcp'], username: '000000002109359899', credential: '0+3ta8H72FlMQ4EjVCilU2qX/Sg=' },
  ],
};
const NET_PEER_OPTS = { debug: 0, config: NET_ICE };
const NET_CHUNK = 60000; // більші повідомлення WebRTC ріже на шматки
function netCode() { const a = new Uint32Array(5); crypto.getRandomValues(a); let s = ''; for (const x of a) s += NET_ABC[x % NET_ABC.length]; return s; }
function netNormCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); }
function netHasPeer() { return typeof Peer !== 'undefined' && typeof RTCPeerConnection !== 'undefined'; }
function netWsUrl() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'; }
function netPeerErr(type) {
  return {
    'peer-unavailable': 'Кімнату не знайдено. Перевірте код і що хост не закрив гру. Якщо в когось увімкнений VPN — вимкніть його.',
    network: 'Немає з\'єднання із сервером зв\'язку. Перевірте інтернет.',
    'server-error': 'Сервер зв\'язку недоступний. Спробуйте за хвилину.',
    'browser-incompatible': 'Цей браузер не підтримує WebRTC.',
    timeout: 'Не вдалося з\'єднатися. Можливо, мережа блокує пряме з\'єднання — спробуйте іншу мережу.',
  }[type] || 'Помилка з\'єднання (' + type + ')';
}
// який шлях обрав WebRTC: напряму в локальній мережі, напряму через інтернет чи через ретранслятор
async function netPathOf(conn) {
  try {
    const st = await conn.peerConnection.getStats();
    let pair = null;
    st.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = st.get(r.selectedCandidatePairId); });
    if (!pair) st.forEach((r) => { if (r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected)) pair = pair || r; });
    const lc = pair && st.get(pair.localCandidateId), rc = pair && st.get(pair.remoteCandidateId);
    if (!lc) return 'напряму';
    if (lc.candidateType === 'relay' || (rc && rc.candidateType === 'relay')) return 'через ретранслятор';
    return lc.candidateType === 'host' && (!rc || rc.candidateType === 'host') ? 'напряму (локальна мережа)' : 'напряму';
  } catch (e) { return 'напряму'; }
}
// реєстрація на сервері PeerJS із повторними спробами
function netWatchPeer(peer) {
  peer.on('disconnected', () => setTimeout(() => { if (NET.peer === peer && !peer.destroyed && peer.disconnected) try { peer.reconnect(); } catch (e) { /* наступного разу */ } }, 1000));
}
function netClose() {
  const was = NET.role;
  NET.role = null; NET.code = null; NET.started = false; NET.status = '';
  for (const l of NET.links.values()) l.close();
  NET.links.clear(); NET.peers.clear();
  if (NET.link) { NET.link.close(); NET.link = null; }
  if (NET.peer) { const p = NET.peer; NET.peer = null; setTimeout(() => p.destroy(), 200); }
  if (NET.ws) { const w = NET.ws; NET.ws = null; w.onclose = null; w.close(); }
  if (was === 'host') { Lobby.slots = Lobby.slots.filter((s) => !s.remote); Lobby.renumber(); }
}
// з'єднання WebRTC → однаковий інтерфейс для хоста й гравця
function netWrapConn(conn, onmsg, onclose) {
  let closed = false;
  const L = {
    kind: 'p', conn, rtt: 0, via: '', stale: false,
    buffered: () => (conn.dataChannel ? conn.dataChannel.bufferedAmount : 0),
    send(d) {
      if (closed || !conn.open) return;
      try {
        if (typeof d !== 'string' && d.byteLength > NET_CHUNK) {
          const n = Math.ceil(d.byteLength / NET_CHUNK);
          conn.send('{"t":"chunks","n":' + n + '}');
          for (let i = 0; i < n; i++) conn.send(d.slice(i * NET_CHUNK, (i + 1) * NET_CHUNK));
        } else conn.send(d);
      } catch (e) { /* канал закривається */ }
    },
    close() { if (closed) return; closed = true; try { conn.close(); } catch (e) { /* уже */ } },
  };
  let parts = null, need = 0;
  conn.on('data', (d) => {
    if (typeof d === 'string') {
      if (d.startsWith('{"t":"chunks"')) { need = JSON.parse(d).n; parts = []; return; }
      onmsg(d);
    } else {
      const u8 = d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer || d, d.byteOffset || 0, d.byteLength);
      if (parts) {
        parts.push(u8);
        if (parts.length < need) return;
        const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0;
        for (const p of parts) { all.set(p, o); o += p.length; }
        parts = null; onmsg(all);
      } else onmsg(u8);
    }
  });
  const lost = () => { if (closed) return; closed = true; onclose(); };
  conn.on('close', lost); conn.on('error', lost);
  if (conn.peerConnection) conn.peerConnection.addEventListener('iceconnectionstatechange', () => { const s = conn.peerConnection.iceConnectionState; if (s === 'failed' || s === 'closed') lost(); });
  setTimeout(async () => { L.via = await netPathOf(conn); }, 1500);
  return L;
}

// стиснення: deflate; WebRTC отримує байти, WebSocket — base64 з префіксом «z»
const NET_Z = typeof CompressionStream !== 'undefined';
function b64enc(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function b64dec(s) { const b = atob(s), u8 = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i); return u8; }
async function zPack(text) { return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); }
async function zUnpack(u8) { return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text(); }

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
function netHost(tries) {
  netClose();
  NET.err = ''; NET.role = 'host'; NET.code = netCode(); NET.status = 'Створюю кімнату…';
  const code = NET.code;
  if (netHasPeer()) {
    const peer = new Peer(NET_PREFIX + code, NET_PEER_OPTS);
    NET.peer = peer; netWatchPeer(peer);
    peer.on('open', () => { if (NET.peer === peer) { NET.status = ''; renderLobbyIfIdle(); } });
    peer.on('error', (e) => {
      if (NET.peer !== peer) return;
      if (e.type === 'unavailable-id' && (tries || 0) < 3) { netHost((tries || 0) + 1); return; }
      if (e.type === 'peer-unavailable') return;
      NET.status = ''; NET.err = netPeerErr(e.type) + (NET.ws ? ' Працює лише локальна мережа.' : ''); renderLobbyIfIdle();
    });
    peer.on('connection', (conn) => {
      const t = setTimeout(() => { if (!conn.open) conn.close(); }, 25000);
      conn.on('open', () => {
        clearTimeout(t);
        if (NET.peer !== peer) { conn.close(); return; }
        const cid = NET.nextCid++;
        const L = netWrapConn(conn, (d) => netHostRecv(cid, d), () => netHostLeft(cid));
        NET.links.set(cid, L);
        netHostJoined(cid, (conn.metadata && conn.metadata.name) || '');
      });
    });
  }
  // запасний шлях — WebSocket сервера гри (якщо гра відкрита з node serve.js)
  try {
    const ws = new WebSocket(netWsUrl());
    NET.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'host', code }));
    ws.onerror = () => { if (NET.ws === ws) NET.ws = null; if (!netHasPeer()) { NET.err = 'Гра по мережі недоступна: немає ні WebRTC, ні сервера гри'; renderLobbyIfIdle(); } };
    ws.onclose = () => { if (NET.ws === ws) NET.ws = null; };
    ws.onmessage = (e) => {
      const raw = e.data;
      if (raw[0] === '{') { const m = JSON.parse(raw); if (m.t === 'room') { NET.addrs = m.addrs || []; if (!netHasPeer()) NET.status = ''; renderLobbyIfIdle(); } return; }
      const k = raw.indexOf('|'), cid = +raw.slice(0, k), body = raw.slice(k + 1), m = JSON.parse(body);
      if (m.t === 'joined') {
        NET.links.set(cid, { kind: 'w', rtt: 0, via: 'через сервер гри', stale: false, buffered: () => ws.bufferedAmount, send(d) { if (ws.readyState === 1) ws.send(cid + '|' + (typeof d === 'string' ? d : 'z' + b64enc(d))); }, close() {} });
        netHostJoined(cid, m.name);
      } else if (m.t === 'left') netHostLeft(cid);
      else netHostRecv(cid, body);
    };
  } catch (e) { NET.ws = null; }
  renderLobbyIfIdle();
}
function renderLobbyIfIdle() { if (state === 'lobby' && !(document.activeElement && document.activeElement.tagName === 'INPUT')) renderLobbyDOM(); }
function netHostJoined(cid, name) {
  NET.peers.set(cid, { name: name || 'Гравець' });
  const L = NET.links.get(cid);
  if (L) L.send(JSON.stringify({ t: 'welcome', cid, code: NET.code }));
  if (state === 'lobby' && Lobby.slots.length < 8) {
    Lobby.slots.push({ scheme: 'net' + cid, remote: true, cid, pname: name || '', role: Lobby.autoRole(), level: 1, team: Lobby.slots.length % 2 });
    Lobby.renumber(); renderLobbyIfIdle();
  } else if (state === 'game') { if (L) L.send(JSON.stringify({ t: 'busy' })); }
  netLobbyChanged();
}
function netHostLeft(cid) {
  if (!NET.peers.has(cid)) return;
  const name = NET.peers.get(cid).name;
  NET.peers.delete(cid); NET.links.delete(cid);
  if (state === 'lobby') { Lobby.slots = Lobby.slots.filter((s) => s.cid !== cid); Lobby.renumber(); renderLobbyIfIdle(); netLobbyChanged(); }
  else if (G) feed(name + ' (по мережі) відключився', '#ccc');
}
function netHostRecv(cid, d) {
  if (typeof d !== 'string') return;
  const m = JSON.parse(d), L = NET.links.get(cid);
  if (m.t === 'in') {
    netCtrl({ cid }).feed(m.s);
    if (state === 'game' && m.z) { const p = G.players.find((q) => q.cid === cid); if (p) p.cam.userZ = clamp(m.z, 1, 2.4); }
  } else if (m.t === 'pong' && L) L.rtt = Math.round(lerp(L.rtt || (performance.now() - m.h), performance.now() - m.h, 0.3));
}
function netSendAll(d) { for (const L of NET.links.values()) L.send(d); }
// гравцям — хто в лобі
function netLobbyChanged() {
  if (NET.role !== 'host') return;
  netSendAll(JSON.stringify({ t: 'lobby', mode: Lobby.mode, loc: LOCATIONS[Lobby.loc].name, slots: Lobby.slots.map((s) => ({ name: s.name, role: s.role, bot: !!s.bot, cid: s.cid || 0, team: s.team || 0, color: s.color })) }));
}
function netToLobby() { if (NET.role === 'host') { netSendAll('{"t":"tolobby"}'); netLobbyChanged(); } }

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
// full — усі вузли; keep — повний знімок для одного гравця, не чіпаючи спільного стану розсилки
function encState(full, keep) {
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
    if (keep) out.push('"' + id + '":' + (ENC.last.get(id) || s));
    else if (full || ENC.last.get(id) !== s) { ENC.last.set(id, s); out.push('"' + id + '":' + s); }
  }
  if (keep) return '"r":' + root + ',"n":{' + out.join(',') + '},"p":[]';
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
// розсилка зі стисненням; порядок повідомлень зберігається
NET.zq = Promise.resolve();
function netSendZ(links, text) {
  if (!NET_Z) { for (const L of links) L.send(text); return; }
  NET.zq = NET.zq.then(() => zPack(text)).then((z) => { for (const L of links) L.send(z); }).catch((e) => console.warn('мережа: стиснення', e));
}
function netStartMsg(st) { return '{"t":"start","loc":' + JSON.stringify(G.W.loc) + ',"width":' + G.W.width + ',' + st + '}'; }
function netStartHost() {
  if (NET.role !== 'host') return;
  encReset();
  for (const p of G.parts) ENC.parts.add(p);
  for (const L of NET.links.values()) L.stale = false;
  netSendZ([...NET.links.values()], netStartMsg(encState(true)));
  NET.sendT = 0; NET.sfx = [];
}
function netHostTick(dt) {
  if (NET.role !== 'host') return;
  // пінг кожну секунду (і в лобі)
  NET.pingT += dt;
  if (NET.pingT > 1) {
    NET.pingT = 0;
    for (const L of NET.links.values()) L.send('{"t":"ping","h":' + performance.now().toFixed(1) + ',"rtt":' + (L.rtt || 0) + ',"via":' + JSON.stringify(L.via || '') + '}');
    if (state === 'lobby') { const el = document.getElementById('netPeers'); if (el) el.innerHTML = netPeersHtml(); }
  }
  if (!NET.links.size || state !== 'game') { NET.sfx = []; return; }
  // частота: 60 знімків/с, якщо гравців небагато й канали встигають, інакше 30
  const links = [...NET.links.values()];
  const busy = links.some((L) => L.buffered() > 64e3);
  NET.rate = links.length <= 3 && !busy ? 1 / 60 : 1 / 30;
  NET.sendT += dt;
  if (NET.sendT < NET.rate - 0.002) return;
  NET.sendT = 0;
  // канал гравця переповнений (повільний інтернет) — пропустити, потім надіслати повний знімок
  const ok = [];
  for (const L of links) {
    if (L.stale) { if (L.buffered() < 32e3) { L.stale = false; netSendZ([L], netStartMsg(encState(true, true))); } continue; }
    if (L.buffered() > 512e3) { L.stale = true; continue; }
    ok.push(L);
  }
  const msg = '{"t":"s",' + encState(false) + ',"f":' + JSON.stringify(NET.sfx) + ',"b":' + JSON.stringify(NET.buzz) + ',"pz":' + (paused ? 1 : 0) + '}';
  NET.sfx = [];
  if (ok.length) netSendZ(ok, msg);
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
  netClose();
  code = netNormCode(code);
  NET.err = ''; NET.role = 'client'; NET.lobby = null; NET.started = false; NET.code = code; NET.status = 'Підключаюся…';
  savePref('netName', name || '');
  NET.dq = Promise.resolve();
  const recv = (d) => {
    if (typeof d === 'string' && d[0] === 'z') d = b64dec(d.slice(1));
    if (typeof d === 'string') NET.dq = NET.dq.then(() => netClientMsg(d));
    else NET.dq = NET.dq.then(() => zUnpack(d)).then(netClientMsg).catch((e) => console.warn('мережа: знімок', e));
  };
  const lost = () => {
    if (NET.role !== 'client') return;
    netClose();
    NET.err = NET.err || 'З\'єднання з хостом утрачено';
    state = 'lobby'; lobbyEl.classList.remove('hidden'); renderLobbyDOM();
  };
  // запасний шлях — WebSocket сервера гри
  const viaWs = (why) => {
    if (NET.role !== 'client') return;
    let ws;
    try { ws = new WebSocket(netWsUrl()); } catch (e) { NET.err = why; lost(); return; }
    NET.ws = ws;
    let opened = false;
    ws.onopen = () => { opened = true; ws.send(JSON.stringify({ t: 'join', code, name })); };
    ws.onmessage = (e) => {
      if (e.data[0] === '{' && e.data.startsWith('{"t":"err"')) { NET.err = why; ws.onclose = null; lost(); return; }
      if (!NET.link) NET.link = { kind: 'w', send: (s) => { if (ws.readyState === 1) ws.send(s); }, close() {}, buffered: () => ws.bufferedAmount };
      recv(e.data);
    };
    ws.onclose = () => { if (NET.ws === ws) { NET.ws = null; if (!opened) NET.err = why; lost(); } };
  };
  if (!netHasPeer()) { viaWs('WebRTC недоступний, а сервера гри немає'); return; }
  const peer = new Peer(NET_PEER_OPTS);
  NET.peer = peer; netWatchPeer(peer);
  let done = false;
  const fail = (type) => { if (done) return; done = true; if (NET.peer === peer) { NET.peer = null; setTimeout(() => peer.destroy(), 200); } viaWs(netPeerErr(type)); };
  const to = setTimeout(() => fail('timeout'), 20000);
  peer.on('error', (e) => { if (!done) fail(e.type); });
  peer.on('open', () => {
    const conn = peer.connect(NET_PREFIX + code, { reliable: true, serialization: 'raw', metadata: { name } });
    conn.on('open', () => {
      if (done) { conn.close(); return; }
      done = true; clearTimeout(to);
      NET.link = netWrapConn(conn, recv, lost);
      NET.status = '';
    });
  });
}
function netClientMsg(raw) {
  const m = JSON.parse(raw);
  if (m.t === 'welcome') { NET.cid = m.cid; NET.code = m.code; NET.status = ''; renderLobbyIfIdle(); }
  else if (m.t === 'busy') { NET.err = 'Гра в цій кімнаті вже йде — зачекайте, поки хост повернеться в лобі'; }
  else if (m.t === 'ping') { if (NET.link) NET.link.send('{"t":"pong","h":' + m.h + '}'); NET.rtt = m.rtt; NET.via = m.via; const el = document.getElementById('netPing'); if (el) el.innerHTML = netPingHtml(); }
  else if (m.t === 'closed') { netClose(); NET.err = 'Хост закрив кімнату'; state = 'lobby'; lobbyEl.classList.remove('hidden'); renderLobbyDOM(); }
  else if (m.t === 'lobby') { NET.lobby = m; NET.err = ''; if (state === 'lobby') renderLobbyIfIdle(); }
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
    NET.snapDt = clamp(lerp(NET.snapDt, (now - NET.snapT) / 1000, 0.2), 0.012, 0.12); NET.snapT = now;
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
  // клавіші цього ПК
  const kb = CONTROLLERS.kb.cur, s = { ax: kb.ax || 0, ay: kb.ay || 0 };
  for (const a of ACTIONS) s[a] = !!kb[a];
  if (kb.aimAngle !== undefined) s.aimAngle = +kb.aimAngle.toFixed(3);
  NET.ctrl.prev = NET.ctrl.cur; NET.ctrl.cur = s;
  const js = JSON.stringify(s);
  NET.inT += dt;
  if ((js !== NET.lastIn || NET.inT > 0.25) && NET.link) {
    NET.lastIn = js; NET.inT = 0;
    NET.link.send('{"t":"in","s":' + js + ',"z":' + NET.userZ + '}');
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
// пінг у куті екрана: у гравця — до хоста, у хоста — до кожного гравця
function netPingColor(ms) { return ms < 60 ? '#6fcf97' : ms < 120 ? '#f2c94c' : '#eb5757'; }
function drawNetInfo(ctx, w, h) {
  let rows = [];
  if (NET.role === 'client' && NET.started) rows = [['Пінг ' + (NET.rtt || '…') + ' мс · ' + (NET.via || (NET.link && NET.link.kind === 'w' ? 'через сервер гри' : '')), NET.rtt]];
  else if (NET.role === 'host' && NET.links.size) for (const [cid, L] of NET.links) rows.push([(NET.peers.get(cid) || {}).name + ': ' + (L.rtt || '…') + ' мс' + (L.via ? ' · ' + L.via : '') + (L.stale ? ' · наздоганяє' : ''), L.rtt]);
  if (!rows.length) return;
  ctx.font = FONT(12); ctx.textAlign = 'right';
  rows.forEach(([text, ms], i) => {
    const y = h - 10 - (rows.length - 1 - i) * 16, tw = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(w - tw - 6, y - 12, tw, 16);
    ctx.fillStyle = ms ? netPingColor(ms) : '#ccc'; ctx.fillText(text, w - 12, y);
  });
  ctx.textAlign = 'left';
}

// ---------- Лобі ----------
function netEsc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function netLobbyHtml() {
  const err = NET.err ? '<div class="net-err">' + netEsc(NET.err) + '</div>' : '';
  if (NET.role === 'host') {
    const link = location.origin + location.pathname + '?join=' + NET.code;
    const port = location.port ? ':' + location.port : '';
    const lan = NET.ws && NET.addrs.length && /^(localhost|127\.)/.test(location.hostname) ? ' У локальній мережі: ' + NET.addrs.map((a) => '<code>' + location.protocol + '//' + a + port + location.pathname + '?join=' + NET.code + '</code>').join(' ') : '';
    return '<div class="net">' + (NET.status ? '<div>' + NET.status + '</div>' :
      '<div>Кімната <b class="code">' + NET.code + '</b> · підключено гравців: ' + NET.peers.size + '</div>' +
      '<small>Друзі відкривають <code>' + netEsc(link) + '</code> або вводять код у цьому розділі.' + lan + ' Підключені гравці з\'являються в учасниках — оберіть їм роль і почніть гру.</small>' +
      '<ul class="net-list" id="netPeers">' + netPeersHtml() + '</ul>') +
      '<button data-act="netclose">Закрити кімнату</button></div>' + err;
  }
  return '<div class="net"><button data-act="nethost">🌐 Створити кімнату</button>' +
    '<span class="net-join"><input id="netName" placeholder="Ваше ім\'я" maxlength="20" value="' + netEsc(loadPref('netName', '')) + '">' +
    '<input id="netCode" placeholder="Код кімнати" maxlength="5" autocapitalize="characters"><button data-act="netjoin">Приєднатися</button></span>' +
    '<small>Один ПК — хост: на ньому йде гра, друзі підключаються за кодом з будь-якого місця й грають на своїх клавіатурах. Зв\'язок напряму між браузерами (WebRTC).</small></div>' + err;
}
function netPeersHtml() {
  return [...NET.peers].map(([cid, p]) => { const L = NET.links.get(cid) || {}; return '<li>' + netEsc(p.name) + (L.rtt ? ' · <span style="color:' + netPingColor(L.rtt) + '">' + L.rtt + ' мс</span>' : '') + (L.via ? ' · ' + L.via : '') + '</li>'; }).join('');
}
function netPingHtml() { return NET.rtt ? 'пінг <span style="color:' + netPingColor(NET.rtt) + '">' + NET.rtt + ' мс</span>' + (NET.via ? ', ' + NET.via : '') : ''; }
// екран гравця, що чекає на старт
function netWaitHtml() {
  const L = NET.lobby;
  const rows = L ? L.slots.map((s) => '<li style="--pc:' + s.color + '"' + (s.cid === NET.cid ? ' class="me"' : '') + '>' + netEsc(s.name) + (s.cid === NET.cid ? ' (це ви)' : s.bot ? ' 🤖' : s.cid ? ' 🌐' : '') +
    ' — ' + (s.role === 'human' ? '🏃 людина' : '🛸 FPV-дрон') + (L.mode === 'team' ? ' · ' + TEAMS[s.team].name : '') + '</li>').join('') : '';
  return menuMusicBtn() + '<div class="wrap"><header><div class="scene-slot"></div><h1>ВТЕЧА ВІД FPV</h1><p>Гра по мережі</p></header>' +
    '<div class="net wait">' + (NET.cid ? '<div>Ви в кімнаті <b class="code">' + NET.code + '</b> · <span id="netPing">' + netPingHtml() + '</span>. Хост налаштовує гру й почне її, коли всі будуть готові.</div>' : '<div>' + (NET.status || 'Підключаюся…') + ' Кімната ' + netEsc(NET.code || '') + '</div>') +
    (L ? '<div>Режим: ' + ({ escape: 'Втеча', dm: 'Дезматч', team: 'Команди' }[L.mode] || L.mode) + ' · Локація: ' + netEsc(L.loc) + '</div><ul class="net-list">' + rows + '</ul>' : '') +
    '<small>Ваше керування: клавіатура (WASD, Пробіл, F, E, R, Q, Shift, 1–3). Колесо миші — віддалити камеру.</small>' +
    '<button data-act="netclose">Вийти з кімнати</button></div>' + (NET.err ? '<div class="net-err">' + netEsc(NET.err) + '</div>' : '') + '</div>';
}
function netLobbyClick(act) {
  if (act === 'nethost') { netHost(); return true; }
  if (act === 'netclose') { netClose(); NET.err = ''; renderLobbyDOM(); return true; }
  if (act === 'netjoin') {
    const code = netNormCode((document.getElementById('netCode') || {}).value), name = ((document.getElementById('netName') || {}).value || '').trim();
    if (code.length < 4) { NET.err = 'Введіть код кімнати'; renderLobbyDOM(); return true; }
    netJoin(code, name); renderLobbyDOM(); return true;
  }
  return false;
}
