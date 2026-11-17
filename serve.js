// Сервер гри: node serve.js → http://localhost:8123
// Роздає файли гри й пересилає повідомлення між хостом і гравцями (WebSocket, /ws) — гра по мережі.
// Порт можна змінити: PORT=9000 node serve.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
const root = __dirname;
const PORT = +process.env.PORT || 8123;

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

// ===== Мінімальний WebSocket (RFC 6455): текстові повідомлення, ping/pong, закриття =====
function wsAccept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  socket.setNoDelay(true);
  const ws = { socket, buf: Buffer.alloc(0), frags: [], open: true, onmsg: null, onclose: null };
  ws.send = (text) => {
    if (!ws.open) return;
    const data = Buffer.from(text, 'utf8'), n = data.length;
    let head;
    if (n < 126) head = Buffer.from([0x81, n]);
    else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(n, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
    socket.write(Buffer.concat([head, data]));
  };
  const close = () => { if (!ws.open) return; ws.open = false; try { socket.end(); } catch (e) { /* уже закрито */ } if (ws.onclose) ws.onclose(); };
  socket.on('data', (chunk) => {
    ws.buf = Buffer.concat([ws.buf, chunk]);
    for (;;) {
      const b = ws.buf;
      if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      const mOff = off; if (masked) off += 4;
      if (b.length < off + len) return;
      const payload = Buffer.from(b.subarray(off, off + len));
      if (masked) for (let i = 0; i < len; i++) payload[i] ^= b[mOff + (i & 3)];
      ws.buf = b.subarray(off + len);
      if (op === 8) { close(); return; }
      if (op === 9) { const h = Buffer.from([0x8a, payload.length]); socket.write(Buffer.concat([h, payload])); continue; }
      if (op === 10) continue;
      ws.frags.push(payload);
      if (fin) { const msg = Buffer.concat(ws.frags).toString('utf8'); ws.frags = []; if (ws.onmsg) ws.onmsg(msg); }
    }
  });
  socket.on('close', close);
  socket.on('error', close);
  return ws;
}

// ===== Кімнати: хост рахує гру, гравці надсилають натискання й отримують стан =====
// Від хоста: "<cid>|текст" — одному гравцю, "*|текст" — усім. Від гравця до хоста: "<cid>|текст".
const rooms = new Map();
let nextCid = 1;
function newCode() { let c; do c = String(1000 + Math.floor(Math.random() * 9000)); while (rooms.has(c)); return c; }
server.on('upgrade', (req, socket) => {
  if (!req.url.startsWith('/ws')) { socket.destroy(); return; }
  const ws = wsAccept(req, socket);
  if (!ws) return;
  let room = null, cid = 0, isHost = false;
  ws.onmsg = (msg) => {
    if (!room) {
      let m; try { m = JSON.parse(msg); } catch (e) { return; }
      if (m.t === 'host') {
        isHost = true; room = { code: newCode(), host: ws, clients: new Map() }; rooms.set(room.code, room);
        ws.send(JSON.stringify({ t: 'room', code: room.code, addrs: lanAddrs() }));
        console.log('кімната ' + room.code + ' створена');
      } else if (m.t === 'join') {
        const r = rooms.get(String(m.code || '').trim());
        if (!r) { ws.send(JSON.stringify({ t: 'err', text: 'Кімнату ' + m.code + ' не знайдено' })); return; }
        room = r; cid = nextCid++; r.clients.set(cid, ws);
        ws.send(JSON.stringify({ t: 'welcome', cid, code: r.code }));
        r.host.send(cid + '|' + JSON.stringify({ t: 'joined', name: String(m.name || '').slice(0, 20) }));
        console.log('кімната ' + r.code + ': гравець ' + cid + ' підключився');
      }
      return;
    }
    if (isHost) {
      const k = msg.indexOf('|'); if (k < 0) return;
      const to = msg.slice(0, k), body = msg.slice(k + 1);
      if (to === '*') for (const c of room.clients.values()) c.send(body);
      else { const c = room.clients.get(+to); if (c) c.send(body); }
    } else room.host.send(cid + '|' + msg);
  };
  ws.onclose = () => {
    if (!room) return;
    if (isHost) {
      for (const c of room.clients.values()) c.send(JSON.stringify({ t: 'closed' }));
      rooms.delete(room.code);
      console.log('кімната ' + room.code + ' закрита');
    } else { room.clients.delete(cid); if (room.host.open) room.host.send(cid + '|' + JSON.stringify({ t: 'left' })); }
  };
});

function lanAddrs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}
server.listen(PORT, () => {
  console.log('Гра: http://localhost:' + PORT);
  for (const a of lanAddrs()) console.log('У локальній мережі: http://' + a + ':' + PORT);
});
