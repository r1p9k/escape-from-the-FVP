'use strict';
// ===== Точка входу: лобі (HTML, мишка), цикл, пауза =====
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const lobbyEl = document.getElementById('lobby');
let VW = 0, VH = 0;
function resize() {
  const dpr = window.devicePixelRatio || 1;
  VW = window.innerWidth; VH = window.innerHeight;
  canvas.width = Math.round(VW * dpr); canvas.height = Math.round(VH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

let state = 'lobby';
let paused = false;

const LOC_INFO = {
  fields: 'Відкриті поля, лісосмуги, окопи, тюки сіна',
  forest: 'Багато дерев і кущів, бліндажі, колоди',
  city: 'Руїни з поверхами, завали, каналізація',
  mixed: 'Поля → ліс → місто на одній мапі',
};
const ACTION_NAMES = [
  ['left', 'right', 'up', 'down', 'Рух'], ['sprint', 'Прискорення'], ['interact', 'Дія'],
  ['fire', 'Вогонь'], ['special', 'Спец'], ['aim', 'Позиція / огляд'],
];

// налаштування, що запам'ятовуються між запусками (якщо браузер дозволяє)
function loadPref(k, def) { try { const v = localStorage.getItem('fpv.' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
function savePref(k, v) { try { localStorage.setItem('fpv.' + k, JSON.stringify(v)); } catch (e) { /* без збереження */ } }

const Lobby = {
  slots: [],
  loc: 0,
  len: loadPref('len', 0),           // довжина мапи (індекс у MAP_LENGTHS)
  controls: loadPref('controls', true), // рядок керування згори під час гри
  mode: loadPref('mode', 'escape'),     // 'escape' — втеча до укриття, 'dm' — дезматч на рахунок
  dmMin: loadPref('dmMin', 10),         // тривалість дезматчу, хв
  menuFor: -1, // індекс картки з відкритим меню вибору керування
  status() {
    const n = this.slots.length;
    const hu = this.slots.filter((s) => s.role === 'human').length;
    if (!this.slots.some((s) => !s.bot)) return { ok: false, text: 'Додайте хоча б одного живого гравця' };
    if (n < 2) return { ok: false, text: 'Потрібно щонайменше 2 учасники — додайте гравця або бота' };
    if (hu < 1) return { ok: false, text: 'Потрібна хоча б одна людина' };
    if (hu === n) return { ok: false, text: 'Потрібен хоча б один дрон' };
    return { ok: true, text: 'Усе готово — можна починати!' };
  },
  renumber() {
    let pn = 0, bn = 0;
    this.slots.forEach((s, i) => { s.name = s.bot ? 'Бот ' + ++bn : 'Гравець ' + ++pn; s.color = PLAYER_COLORS[i]; });
  },
  autoRole() {
    const hu = this.slots.filter((s) => s.role === 'human').length;
    return this.slots.length === 0 ? 'human' : hu > this.slots.length - hu ? 'drone' : 'human';
  },
  add(scheme) {
    if (this.slots.length >= 4) return;
    const bot = scheme === 'bot';
    this.slots.push({ scheme: bot ? 'bot' + Math.random() : scheme, bot, role: this.autoRole(), level: 1 });
    this.renumber(); this.menuFor = -1; Sfx.click();
  },
};

function keyHtml(c) {
  return ACTION_NAMES.map((a) => {
    const name = a[a.length - 1];
    const keys = a.slice(0, -1).map((k) => '<kbd>' + c.label(k) + '</kbd>').join('');
    return name + ' ' + keys;
  }).join(' · ');
}

function renderLobbyDOM() {
  const L = Lobby, st = L.status();
  const used = new Set(L.slots.map((s) => s.scheme));
  let cards = '';
  for (let i = 0; i < 4; i++) {
    const s = L.slots[i];
    if (!s) {
      if (L.menuFor === i || (L.menuFor === -1 && false)) {
        const opts = Object.keys(CONTROLLERS).map((id) => {
          const c = CONTROLLERS[id];
          const extra = c.isPad && !c.connected() ? ' <small>(не підключено)</small>' : '';
          return '<button data-act="add" data-scheme="' + id + '"' + (used.has(id) ? ' disabled' : '') + '>' + c.name + extra + '</button>';
        }).join('');
        cards += '<div class="card"><div class="menu"><div class="title">Чим керуватиме гравець?</div>' + opts +
          '<button class="bot" data-act="add" data-scheme="bot">🤖 Бот (комп\'ютер)</button>' +
          '<button data-act="cancel">Скасувати</button></div></div>';
      } else if (i === L.slots.length) {
        cards += '<div class="card"><button class="add" data-act="menu" data-i="' + i + '"><b>+</b>Додати гравця або бота</button></div>';
      } else cards += '<div class="card" style="opacity:.35"></div>';
      continue;
    }
    const c = s.bot ? null : CONTROLLERS[s.scheme];
    const role = '<div class="seg">' +
      '<button data-act="role" data-i="' + i + '" data-v="human" class="' + (s.role === 'human' ? 'on' : '') + '">🏃 Людина</button>' +
      '<button data-act="role" data-i="' + i + '" data-v="drone" class="' + (s.role === 'drone' ? 'on' : '') + '">🛸 FPV-дрон</button></div>';
    const extra = s.bot
      ? '<div class="seg small">' + BOT_LEVELS.map((lv, k) => '<button data-act="level" data-i="' + i + '" data-v="' + k + '" class="' + (s.level === k ? 'on' : '') + '">' + lv.name + '</button>').join('') + '</div>'
      : '<div class="keys">' + keyHtml(c) + '</div>';
    cards += '<div class="card filled" style="--pc:' + s.color + '">' +
      '<button class="x" title="Прибрати" data-act="remove" data-i="' + i + '">✕</button>' +
      '<div class="name">' + s.name + '</div><div class="sub">' + (s.bot ? 'Комп\'ютер' : c.name) + '</div>' +
      role + extra + '</div>';
  }
  const locs = LOCATIONS.map((l, k) => '<button class="loc ' + (L.loc === k ? 'on' : '') + '" data-act="loc" data-v="' + k + '"><b>' + l.name.replace(/ \(.*\)/, '') + '</b><span>' + LOC_INFO[l.id] + '</span></button>').join('');
  const keyRows = [
    ['Рух', '<kbd>A</kbd><kbd>D</kbd> або <kbd>←</kbd><kbd>→</kbd>', 'стік / хрестовина'],
    ['Вгору: стрибок, драбина, підвестися', '<kbd>W</kbd> або <kbd>↑</kbd>', '<kbd>A</kbd>'],
    ['Вниз: присісти, лягти; на бігу — кидок', '<kbd>S</kbd> або <kbd>↓</kbd>', '<kbd>B</kbd>'],
    ['Прискорення / форсаж', '<kbd>Shift</kbd>', '<kbd>LB</kbd>'],
    ['Позиція для стрільби (тримати) / огляд дрона', '<kbd>Пробіл</kbd>', '<kbd>LT</kbd>'],
    ['Вогонь / підрив дрона', '<kbd>F</kbd> або <kbd>J</kbd>', '<kbd>RB</kbd>'],
    ['Дія: сісти, підібрати, сховатися / тип скиду', '<kbd>E</kbd>', '<kbd>X</kbd>'],
    ['Спец: РЕБ / скид з дрона', '<kbd>Q</kbd>', '<kbd>Y</kbd>'],
    ['1 — викинути каністру / покласти предмет, 2 — аптечка (5 с), 3 — граната', '<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>', '<kbd>Back</kbd><kbd>L3</kbd><kbd>R3</kbd>'],
  ].map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>').join('');

  lobbyEl.innerHTML = '<div class="wrap">' +
    '<header><h1>ВТЕЧА ВІД FPV</h1><p>Людина біжить до укриття, дрон не дає їй утекти. 2–4 учасники на одному екрані, можна з ботами.</p></header>' +
    '<h2>Учасники</h2><div class="slots">' + cards + '</div>' +
    '<h2>Локація</h2><div class="locs">' + locs + '</div>' +
    '<h2>Режим гри</h2><div class="opts">' +
    '<div class="opt"><span>Режим</span><div class="seg">' +
    '<button data-act="mode" data-v="escape" class="' + (L.mode === 'escape' ? 'on' : '') + '">🏃 Втеча</button>' +
    '<button data-act="mode" data-v="dm" class="' + (L.mode === 'dm' ? 'on' : '') + '">⚔️ Дезматч</button></div>' +
    '<small>' + (L.mode === 'dm'
      ? 'Безліміт дронів і життів, гра на рахунок: збитий дрон +1, укриття +3 (і знову зі старту), дронщику +3 за вбивство'
      : 'Добігти до укриття. У людини 3 життя, відновлення там, де натягнула маскувальну сітку. Дронів безліміт') + '</small></div>' +
    (L.mode === 'dm' ? '<div class="opt"><span>Тривалість дезматчу</span><div class="seg">' + [5, 10, 15, 20, 30].map((m) => '<button data-act="dmMin" data-v="' + m + '" class="' + (L.dmMin === m ? 'on' : '') + '">' + m + ' хв</button>').join('') + '</div></div>' : '') +
    '</div>' +
    '<h2>Налаштування</h2><div class="opts">' +
    '<div class="opt"><span>Довжина мапи</span><div class="seg">' + MAP_LENGTHS.map((m, k) => '<button data-act="len" data-v="' + k + '" class="' + (L.len === k ? 'on' : '') + '">' + m.name + ' · ' + (m.width / 10 / 1000).toFixed(1) + ' км</button>').join('') + '</div>' +
    '<small>На дуже довгій мапі в одній зі схованок захований бонус «Альоша»</small></div>' +
    '<div class="opt"><span>Підказки керування згори під час гри</span><div class="seg">' +
    '<button data-act="controls" data-v="1" class="' + (L.controls ? 'on' : '') + '">Показувати</button>' +
    '<button data-act="controls" data-v="0" class="' + (!L.controls ? 'on' : '') + '">Сховати</button></div></div></div>' +
    '<div class="start-row"><button class="start" data-act="start"' + (st.ok ? '' : ' disabled') + '>ПОЧАТИ ГРУ</button>' +
    '<span class="status ' + (st.ok ? 'ok' : '') + '">' + st.text + '</span></div>' +
    '<h2>Як грати</h2><div class="help">' +
    '<section><h3>🏃 Людина — добігти до укриття праворуч</h3><ul>' +
    '<li><b>Рух</b>: біг; <b>↑</b> — стрибок, залізти на уступ чи драбину; <b>↓</b> — присісти, ще раз — лягти й повзти</li>' +
    '<li><b>↓ на бігу</b> — різкий кидок на землю, щоб ухилитися від дрона</li>' +
    '<li><b>Прискорення</b> — кілька секунд швидкого бігу</li>' +
    '<li><b>Дія</b> — сісти в техніку (потрібне пальне), підібрати, сховатися в бліндаж / нору / тунель</li>' +
    '<li><b>Тунелі</b> — вириті ходи під землею: йдеш зігнувшись, виходи — похилі спуски або лази з драбиною. <b>Вгору</b> біля виходу — підніматися, нагорі <b>Дія</b> — вилізти</li>' +
    '<li><b>Лопата</b> («ЛОП») — 5 м копання: <b>Дія</b> на вільній землі — викопати спуск; у тунелі на краю <b>Вниз + вбік</b> — копати далі, <b>Вгору</b> — новий вихід. Скінчилася лопата в кінці галереї — вихід докопується сам (якщо нагорі стіна чи будівля — тунель іде далі, поки не мине її)</li>' +
    '<li>Вибухи дронів <b>пробивають стіни й перекриття</b></li>' +
    '<li><b>З нори й бліндажа можна стріляти</b>: тримай <b>Позицію</b> — визирнеш з отвору чи бійниці. Сектор обмежений: з нори вниз не стріляєш, з бійниці — лише вузький сектор майже горизонтально. З окопу — тільки вгору через бруствер. Після пострілу дрон тебе бачить, а вибух біля отвору б\'є сильніше</li>' +
    '<li><b>Позиція</b> (тримати) — зупинитися й цілитися: ↑↓ кут, ←→ бік, <b>Вогонь</b> — стріляти</li>' +
    '<li><b>Гранати</b> (2 на старті, знахідка «ГРН» — ще 2, до 4): клавіша <b>3</b> — кинути вперед-угору, з <b>Позицією</b> — під обраним кутом. Вибух через 2,2 с; дрон ближче 7 м — збитий. Свої теж страждають</li>' +
    '<li><b>Речі побуту</b> в будівлях — банки з огірками, стільці, табурети, каструлі, цегла, праски, телевізори. <b>Дія</b> — взяти в руки, <b>Вогонь</b> — кинути (з <b>Позицією</b> — під кутом), <b>1</b> — покласти. Влучання збиває дрон. Кидок — до ~30 м, угору ~10–15 м: найкраще з вікон і з даху</li>' +
    '<li><b>Укріплення</b> будівлі після маскувальної сітки: біля вікна чи пролому <b>Дія</b> — забити фанерою (8 листів на будівлю; вибух її вибиває), <b>Позиція + Дія</b> біля вікна — вогнева позиція зі станковою гвинтівкою (до 2 на будівлю, 80 набоїв, дуже точна). <b>Дія</b> біля гвинтівки — стати за неї, ↑↓ — кут, <b>Вогонь</b> — стріляти, <b>Дія</b> — відійти</li>' +
    '<li><b>Спец</b> — РЕБ, глушить дрони поруч на 5 с. Не частіше разу на 2 хв, заряди трапляються рідко</li>' +
    '<li><b>Зброя</b> трапляється рідко й з невеликим запасом набоїв. З порожніми руками її підбирають автоматично</li>' +
    '<li><b>Магазин і перезарядка</b>: автомат — 9 набоїв у магазині (2,2 с), дробовик — 2 (1,8 с), кулемет — 25 (3,5 с). Порожній магазин перезаряджається сам; <b>Вогонь</b> без позиції — перезарядити раніше</li>' +
    '<li><b>Розкид куль</b>: стоячи влучити важко, сидячи — точніше, лежачи — найточніше. Часта стрільба збільшує розкид</li>' +
    '<li><b>Дрон за стінами не видно</b> — лише дуги з того боку, звідки чути дзижчання (приблизно). «Ждуна» в кущах не видно зовсім</li>' +
    '<li><b>Рюкзак</b> — 4 місця: аптечки, заряди РЕБ, детектор. Загиблий втрачає рюкзак і зброю — їх може підібрати інший («РЮК»)</li>' +
    '<li><b>Детектор дронів</b> («ДЕТ», рідкісний): показує дрони ближче 65 м крізь стіни й «ждунів» у кущах, з відстанню й напрямком</li>' +
    '<li><b>Знахідки</b> час від часу з\'являються попереду й зникають за 45 с (блимають перед зникненням)</li>' +
    '<li><b>Каністра</b> займає руки — стріляти не можна, поки не викинеш її клавішею <b>1</b>. <b>2</b> — аптечка: 5 с не рухатися, +45 здоров\'я (до 2 шт.)</li>' +
    '<li>З верхнього поверху будинків можна вилізти драбиною <b>на дах</b></li>' +
    '<li><b>Міна</b> спрацьовує ближче 3 м навіть під тим, хто стрибає низько, і ранить до 6 м. Її можна підірвати пострілом</li>' +
    '<li><b>Бронежилет</b> (знахідка «БР»): вибухи шкодять утричі менше, рятує від прямого влучання дрона — крім влучання в голову. Від міни — лише 15 HP замість 50</li>' +
    '<li><b>«Альоша»</b>: збий або переживи 6 дронів — <b>Позиція + Спец</b> вмикає режим на 10 с: вибухи не шкодять, зброя сама наводиться на дрони, кожен постріл — збитий дрон</li>' +
    '<li>Укриття руйнуються від вибухів: бліндажі, нори, тюки сіна, колоди, блоки, кущі</li>' +
    '<li><b>Маскувальна сітка</b> (3 шт.): <b>Позиція + Дія</b> біля входу в бліндаж чи нору або в будівлі. Дрон бачить такий вхід, лише коли зависає поруч. Там же — точка відновлення</li>' +
    '<li><b>3 життя</b>: після смерті через 3 с людина повертається туди, де востаннє натягнула сітку (або на старт)</li>' +
    '<li>Дерева, кущі, окопи, руїни й дим ховають від дрона. 3 с на відкритому — дрон бачить стрілку</li></ul></section>' +
    '<section><h3>🛸 FPV-дрон — не дати людині втекти</h3><ul>' +
    '<li><b>Рух</b> — політ у будь-який бік, <b>Прискорення</b> — форсаж (швидше сідає АКБ)</li>' +
    '<li><b>Вогонь</b> — підрив (камікадзе). Удар об людину чи техніку — теж вибух</li>' +
    '<li><b>4 місця для скидів</b>: граната, дим або міна — будь-що в будь-якому місці. Обирайте, поки дрон чекає на старт: ←→ місце, ↓ тип</li>' +
    '<li><b>Спец</b> — скинути, <b>Дія</b> — змінити тип. Граната вибухає при падінні. Міна лежить на землі: зупиняє техніку, людині без броні — мінус половина здоров\'я</li>' +
    '<li>Дим у схованці: якщо людина не вилізе за 3 с, швидко втрачає здоров\'я. На відкритому — отруєння після 20 с</li>' +
    '<li><b>Точки старту</b>: 2, 3 або 4 залежно від довжини мапи. Після вибуху (і поки дрон стоїть на старті) видно <b>схему місцевості</b> — <b>Дія</b> / <b>Позиція</b> обирають точку злету. Точки ближче 50 м до людей недоступні. Новий дрон — через 2 с</li>' +
    '<li><b>Позиція</b> біля землі — посадка («ждун»: АКБ не сідає), ще раз або ↑ — зліт. Високо в повітрі — ширший огляд</li>' +
    '<li><b>Ждун у кущах</b> невидимий для людей і ботів (крім детектора). Людина не бачить дрон крізь стіни, лише чує, звідки він летить</li>' +
    '<li>Можна залітати в будівлі через вікна, двері й проломи — так видно людей усередині</li>' +
    '<li><b>Бонуси в повітрі</b> (кружечки): ЦІЛЬ — автозахоплення людини поруч, дрон летить сам навіть під РЕБом; БРОНЯ — 10 влучань, щоб збити; ×2 — подвійна швидкість на 25 с; АКБ — запасна батарея; +СКИД — поповнити скиди гранатами. Бонуси з\'являються в різних місцях і за 25–45 с зникають</li></ul></section>' +
    '<section class="wide"><h3>⌨️ Клавіші</h3><table><tr><th>Дія</th><th>Клавіатура</th><th>Геймпад</th></tr>' + keyRows + '</table>' +
    '<p class="keys">Одна клавіатура — один гравець, решта грає на геймпадах або це боти. Цілитися: тримайте Пробіл, кут — W/S, бік — A/D, стріляти — F. Esc — пауза, Enter у лобі — почати.</p></section>' +
    '</div></div>';
}

lobbyEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  Sfx.unlock();
  const L = Lobby, i = +b.dataset.i, act = b.dataset.act;
  if (act === 'menu') L.menuFor = i;
  else if (act === 'cancel') L.menuFor = -1;
  else if (act === 'add') L.add(b.dataset.scheme);
  else if (act === 'remove') { L.slots.splice(i, 1); L.renumber(); }
  else if (act === 'role') L.slots[i].role = b.dataset.v;
  else if (act === 'level') L.slots[i].level = +b.dataset.v;
  else if (act === 'loc') L.loc = +b.dataset.v;
  else if (act === 'len') { L.len = +b.dataset.v; savePref('len', L.len); }
  else if (act === 'mode') { L.mode = b.dataset.v; savePref('mode', L.mode); }
  else if (act === 'dmMin') { L.dmMin = +b.dataset.v; savePref('dmMin', L.dmMin); }
  else if (act === 'controls') { L.controls = b.dataset.v === '1'; savePref('controls', L.controls); }
  else if (act === 'start') { startGame(); return; }
  Sfx.click();
  renderLobbyDOM();
});
// оновлювати статус геймпадів
window.addEventListener('gamepadconnected', () => { if (state === 'lobby') renderLobbyDOM(); });
window.addEventListener('gamepaddisconnected', () => { if (state === 'lobby') renderLobbyDOM(); });

function startGame() {
  if (!Lobby.status().ok) return;
  newGame(Lobby.slots, LOCATIONS[Lobby.loc].id, { len: (MAP_LENGTHS[Lobby.len] || MAP_LENGTHS[0]).id, controls: Lobby.controls, mode: Lobby.mode, dmMin: Lobby.dmMin });
  state = 'game'; paused = false;
  lobbyEl.classList.add('hidden');
}
function toLobby() {
  state = 'lobby'; paused = false;
  Sfx.setBuzz(0, 150);
  lobbyEl.classList.remove('hidden');
  renderLobbyDOM();
}
canvas.addEventListener('click', () => {
  if (state === 'game' && G.over && G.overT > 1.5) toLobby();
});

// Демо-режими для швидкої перевірки: index.html?demo, index.html?bots
if (/[?&]demo/.test(location.search)) {
  Lobby.slots = [{ scheme: 'kb', role: 'human' }, { scheme: 'bot1', bot: true, role: 'drone', level: 1 }];
  Lobby.renumber(); startGame();
} else if (/[?&]bots/.test(location.search)) {
  Lobby.slots = [{ scheme: 'kb', role: 'drone' }, { scheme: 'bot1', bot: true, role: 'human', level: 1 }, { scheme: 'bot2', bot: true, role: 'drone', level: 1 }];
  Lobby.renumber(); startGame();
} else renderLobbyDOM();

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  for (const id in CONTROLLERS) CONTROLLERS[id].poll();
  GlobalKeys.poll();
  if (state === 'lobby') {
    if (GlobalKeys.pressed('Enter')) startGame();
  } else {
    if (GlobalKeys.pressed('Escape') && !G.over) { paused = !paused; Sfx.setBuzz(0, 150); }
    if (!paused) {
      for (const p of G.players) if (p.bot) p.ctrl.poll(dt);
      updateGame(dt);
    }
    renderGame(ctx, VW, VH, t);
    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, VW, VH);
      centerText(ctx, 'ПАУЗА', VW / 2, VH / 2 - 20, 44, '#fff');
      centerText(ctx, 'Esc — продовжити   ·   Enter — вийти в лобі', VW / 2, VH / 2 + 24, 18, '#ddd');
      if (GlobalKeys.pressed('Enter')) toLobby();
    } else if (G.over && G.overT > 1.5 && GlobalKeys.pressed('Enter')) toLobby();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
