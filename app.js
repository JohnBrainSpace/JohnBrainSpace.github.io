'use strict';
/* ===================== Dane ===================== */
const KEY = 'moj-dzien-v1';
const CATS = { 'Biznes': '#f59e0b', 'Marka osobista': '#8b5cf6', 'Forma': '#ef4444', 'Zdrowie': '#10b981', 'Mindset': '#3b82f6', 'Rodzina': '#ec4899', 'Inne': '#64748b' };
const IDEA_CATS = ['Marka osobista', 'Content', 'Projekt', 'Inne'];
const SPEND_CATS = ['Inwestycje', 'Kurs / szkolenie', 'Przyjemność', 'Inne'];
const DEFAULT = {
  tasks: [],      // {id,title,date,time,dur,cat,goal,deadline,remind,repeat,done:{d:1},resist:{d:1},skipped:{d:1}}
  thoughts: {},
  quotes: [
    { id: 'q1', text: 'Nie to, co nam się przytrafia, ale jak na to reagujemy – to nas określa.', author: 'Epiktet', fav: false },
    { id: 'q2', text: 'Mała rzecz robiona codziennie znaczy więcej niż wielka zrobiona raz.', author: '', fav: false },
    { id: 'q3', text: 'Zacznij tam, gdzie jesteś. Użyj tego, co masz. Zrób, co możesz.', author: 'Arthur Ashe', fav: false }
  ],
  ideas: [],
  goals: [],      // {id,title,cat,deadline,steps:[{t,done}],done:false}
  inbox: [],      // {id,title}
  spends: [],     // {id,date,amount,what,cat}
  settings: { ppl: 100, xpMul: 1 },   // punkty za poziom, mnożnik EXP
  maxLevel: 1,
  notified: {}
};
let S = load();
let undoSnap = null;
const st = { view: 'plan', range: 'today', sel: '', month: '', wk: '', zap: 'ideas', cat: 'Wszystkie', q: '', open: null };

function load() {
  let d = {};
  try { d = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { }
  const s = Object.assign(JSON.parse(JSON.stringify(DEFAULT)), d);
  s.settings = Object.assign({}, DEFAULT.settings, d.settings || {});
  return s;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Nie udało się zapisać danych!'); } }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ===================== Daty ===================== */
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
function diffDays(a, b) { return Math.round((parse(a) - parse(b)) / 864e5); }
function mondayOf(s) { return addDays(s, -((parse(s).getDay() + 6) % 7)); }
const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const DAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const DOW = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
const today = () => ymd(new Date());
function nice(s) { const d = parse(s); return DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()].toLowerCase(); }
st.sel = today(); st.month = today().slice(0, 7); st.wk = mondayOf(today());

/* ===================== Logika zadań ===================== */
function occursOn(t, d) {
  if (t.repeat === 'daily') return d >= t.date;
  if (t.repeat === 'weekdays') { const w = parse(d).getDay(); return d >= t.date && w > 0 && w < 6; }
  return t.date === d;
}
const tasksOn = d => S.tasks.filter(t => occursOn(t, d)).sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
const isDone = (t, d) => !!(t.done && t.done[d]);
const isSkipped = (t, d) => !!(t.skipped && t.skipped[d]);
const isResist = (t, d) => !!(t.resist && t.resist[d]);
function overdue() {
  const td = today();
  return S.tasks.filter(t => (!t.repeat || t.repeat === 'none') && t.date < td && !isDone(t, t.date) && !isSkipped(t, t.date));
}
function progress(d) { // odpuszczone ("nie zrobię") nie liczą się do postępu
  const l = tasksOn(d).filter(t => !isSkipped(t, d)); const n = l.filter(t => isDone(t, d)).length;
  return { done: n, total: l.length, pct: l.length ? Math.round(n / l.length * 100) : 0 };
}

/* ===================== Seria (łagodna: 1 dzień ochronny na tydzień) ===================== */
const weekKey = d => mondayOf(d);
function streakInfo() {
  const td = today();
  let start = td;
  for (const t of S.tasks) if (t.date < start) start = t.date;
  let cur = 0, best = 0, comeback = 0, prevMiss = false; const used = {};
  const span = Math.min(diffDays(td, start), 3650);
  for (let i = span; i >= 0; i--) {
    const d = addDays(td, -i), p = progress(d);
    if (!p.total) continue;
    if (p.done === p.total) { cur++; if (cur > best) best = cur; if (prevMiss) comeback++; prevMiss = false; }
    else if (d === td) { /* dziś jeszcze trwa */ }
    else { prevMiss = true; const wk = weekKey(d); if (!used[wk]) used[wk] = 1; else cur = 0; }
  }
  return { cur, best, comeback, shield: !used[weekKey(td)] };
}
const streak = () => streakInfo().cur;

/* ===================== EXP, poziomy, portfel ===================== */
const needFor = L => 100 + 25 * L;            // EXP potrzebny na przejście z poziomu L na L+1
function taskExp(t, d) {
  let x = 10;
  if (isResist(t, d)) x += 5;                                   // pokonany opór
  if (t.deadline && d <= t.deadline) x += 5;                    // zrobione w terminie
  return x;
}
function expTotal() {
  let e = 0; const dates = {};
  for (const t of S.tasks) for (const d in (t.done || {})) if (t.done[d]) { e += taskExp(t, d); dates[d] = 1; }
  for (const d in dates) { const p = progress(d); if (p.total >= 2 && p.done === p.total) e += 20; }   // bonus za cały dzień
  for (const g of S.goals) { e += g.steps.filter(s => s.done).length * 10; if (g.done) e += 200; }
  return Math.round(e * (S.settings.xpMul || 1));
}
function levelInfo(exp) {
  let level = 1, rem = exp;
  while (level < 500 && rem >= needFor(level)) { rem -= needFor(level); level++; }
  return { level, cur: rem, need: needFor(level), pct: Math.round(rem / needFor(level) * 100) };
}
const earned = () => (levelInfo(expTotal()).level - 1) * (S.settings.ppl || 100);
const spent = () => S.spends.reduce((a, s) => a + s.amount, 0);
const balance = () => earned() - spent();

/* ===================== Statystyki i odznaki ===================== */
function stats() {
  let doneCount = 0, resistDone = 0;
  for (const t of S.tasks) for (const d in (t.done || {})) if (t.done[d]) { doneCount++; if (isResist(t, d)) resistDone++; }
  const si = streakInfo(), L = levelInfo(expTotal()).level;
  return { doneCount, resistDone, best: si.best, comeback: si.comeback, level: L, goalsDone: S.goals.filter(g => g.done).length, spends: S.spends.length };
}
function badges() {
  const s = stats();
  return [
    { e: '👣', n: 'Pierwszy krok', c: s.doneCount, t: 1 },
    { e: '🔟', n: '10 zadań', c: s.doneCount, t: 10 },
    { e: '5️⃣', n: 'Pięćdziesiątka', c: s.doneCount, t: 50 },
    { e: '💯', n: 'Setka', c: s.doneCount, t: 100 },
    { e: '🔥', n: 'Tydzień w rytmie', c: s.best, t: 7 },
    { e: '🌙', n: 'Miesiąc w rytmie', c: s.best, t: 30 },
    { e: '💪', n: 'Pogromca oporu', c: s.resistDone, t: 10 },
    { e: '↩️', n: 'Powrót', c: s.comeback, t: 1 },
    { e: '⭐', n: 'Poziom 5', c: s.level, t: 5 },
    { e: '👑', n: 'Poziom 10', c: s.level, t: 10 },
    { e: '🎯', n: 'Cel osiągnięty', c: s.goalsDone, t: 1 },
    { e: '💼', n: 'Inwestor', c: s.spends, t: 1 }
  ];
}
function weekReview() {
  const td = today(), days = [], cats = {}; let ok = 0, tot = 0, overcame = 0, resistOpen = 0, skipped = 0;
  for (let i = 6; i >= 0; i--) {
    const d = addDays(td, -i), p = progress(d); days.push({ d, p });
    ok += p.done; tot += p.total;
    for (const t of tasksOn(d)) {
      if (isDone(t, d)) cats[t.cat || 'Inne'] = (cats[t.cat || 'Inne'] || 0) + 1;
      if (isSkipped(t, d)) skipped++;
      if (isResist(t, d)) { if (isDone(t, d)) overcame++; else resistOpen++; }
    }
  }
  let best = null; for (const x of days) if (x.p.total && (!best || x.p.pct >= best.p.pct)) best = x;
  const rc = {}; // najczęstszy opór (30 dni)
  for (const t of S.tasks) for (const d in (t.resist || {})) if (d >= addDays(td, -30)) rc[t.title] = (rc[t.title] || 0) + 1;
  const topResist = Object.entries(rc).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { days, cats, ok, tot, overcame, resistOpen, skipped, best, topResist };
}

/* ===================== Powiadomienia ===================== */
const canNotify = () => typeof Notification !== 'undefined' && Notification.permission === 'granted';
async function notify(title, body, tag) {
  if (!canNotify()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) reg.showNotification(title, { body, tag, icon: 'icons/pwa-192.png', badge: 'icons/pwa-192.png', vibrate: [120, 60, 120] });
    else new Notification(title, { body, tag });
  } catch (e) { }
}
function fmtMin(m) { return m >= 1440 ? Math.round(m / 1440) + ' d' : m >= 60 ? Math.round(m / 60) + ' godz.' : m + ' min'; }
function checkReminders() {
  const now = new Date(), td = ymd(now), nowM = now.getHours() * 60 + now.getMinutes(); let changed = false;
  for (const t of tasksOn(td)) {
    if (isDone(t, td) || isSkipped(t, td)) continue;
    if (t.time && t.remind !== '' && t.remind != null) {
      const [h, m] = t.time.split(':').map(Number), fire = h * 60 + m - Number(t.remind), k = 'r|' + t.id + '|' + td;
      if (nowM >= fire && nowM <= h * 60 + m + 120 && !S.notified[k]) {
        S.notified[k] = 1; changed = true;
        notify('⏰ ' + t.title, Number(t.remind) ? 'Za ' + fmtMin(Number(t.remind)) + ' (' + t.time + ')' : 'Teraz (' + t.time + ')', k);
      }
    }
  }
  for (const t of S.tasks) {
    if (!t.deadline || isDone(t, t.date)) continue;
    const left = diffDays(t.deadline, td);
    if ((left === 0 || left === 1) && nowM >= 480) {
      const k = 'd|' + t.id + '|' + td;
      if (!S.notified[k]) { S.notified[k] = 1; changed = true; notify('🚩 Deadline ' + (left ? 'jutro' : 'dziś'), t.title, k); }
    }
  }
  if (changed) { for (const k of Object.keys(S.notified)) if (k.split('|')[2] < addDays(td, -7)) delete S.notified[k]; save(); }
}

/* ===================== UI: pomocnicze ===================== */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(m, undo, ms) {
  const t = $('#toast'); t.innerHTML = esc(m) + (undo ? ' <button data-act="undo">Cofnij</button>' : '');
  t.classList.remove('hidden'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), ms || (undo ? 5000 : 2400));
}
function modal(html) { const m = $('#modal'); m.innerHTML = '<div class="sheet">' + html + '</div>'; m.classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; }
function quoteOfDay() {
  if (!S.quotes.length) return null;
  const favs = S.quotes.filter(q => q.fav), pool = favs.length ? favs : S.quotes;
  return pool[(parse(today()).getTime() / 864e5 | 0) % pool.length];
}
/* zmiana danych z możliwością cofnięcia + wykrywanie awansu */
function mutate(fn, msg, quiet) {
  const snap = JSON.stringify(S), before = expTotal();
  fn(); const after = expTotal(); undoSnap = snap;
  const lv = levelInfo(after).level; let m = typeof msg === 'function' ? msg(after - before) : msg;
  if (lv > S.maxLevel) { S.maxLevel = lv; m = '🎉 Poziom ' + lv + '! +' + S.settings.ppl + ' pkt do wydania'; }
  save(); rerender(); if (!quiet && m) toast(m, true, lv > 0 && m.startsWith('🎉') ? 6000 : 0);
}

/* ===================== Render ===================== */
const VIEWS = {};
function render() {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === st.view));
  $('#app').innerHTML = VIEWS[st.view]();
  window.scrollTo(0, 0);
}
function rerender() { const y = window.scrollY; $('#app').innerHTML = VIEWS[st.view](); document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === st.view)); window.scrollTo(0, y); }

function catChip(c) { return '<span class="b" style="background:' + (CATS[c] || '#64748b') + '22;color:' + (CATS[c] || '#64748b') + '">' + esc(c) + '</span>'; }
function taskHTML(t, d) {
  const done = isDone(t, d), skip = isSkipped(t, d), meta = [], open = st.open === t.id + '|' + d;
  if (t.time) meta.push('<span class="b">🕐 ' + t.time + (t.dur ? ' · ' + t.dur + ' min' : '') + '</span>');
  if (t.cat && t.cat !== 'Inne') meta.push(catChip(t.cat));
  if (t.repeat === 'daily') meta.push('<span class="b">🔁 codziennie</span>');
  if (t.repeat === 'weekdays') meta.push('<span class="b">🔁 pn–pt</span>');
  if (t.remind !== '' && t.remind != null && t.time) meta.push('<span class="b">🔔 ' + (Number(t.remind) ? fmtMin(Number(t.remind)) + ' wcześniej' : 'o czasie') + '</span>');
  if (t.goal) { const g = S.goals.find(x => x.id === t.goal); if (g) meta.push('<span class="b">🎯 ' + esc(g.title.slice(0, 22)) + '</span>'); }
  if (t.deadline) {
    const left = diffDays(t.deadline, today());
    meta.push('<span class="b ' + (left < 0 ? 'bad' : left <= 1 ? 'warn' : '') + '">🚩 ' + (left < 0 ? 'po terminie' : left === 0 ? 'deadline dziś' : left === 1 ? 'deadline jutro' : 'deadline za ' + left + ' dni') + '</span>');
  }
  if (isResist(t, d)) meta.push('<span class="b warn">💪 opór</span>');
  if (skip) meta.push('<span class="b">odpuszczone</span>');
  if (d < today() && !t.repeat && !done && !skip) meta.push('<span class="b bad">zaległe</span>');
  const acts = open ? '<div class="tacts"><button class="btn sm" data-act="toggle" data-id="' + t.id + '" data-d="' + d + '">' + (done ? '↺ Cofnij zrobione' : '✓ Zrobione') + '</button>' +
    (done ? '' : '<button class="btn sm sec" data-act="resist" data-id="' + t.id + '" data-d="' + d + '">💪 Czuję opór</button>') +
    '<button class="btn sm sec" data-act="skip" data-id="' + t.id + '" data-d="' + d + '">' + (skip ? 'Przywróć' : 'Nie zrobię') + '</button></div>' : '';
  return '<div class="card task ' + (done ? 'done' : '') + (skip ? ' skip' : '') + '"><button class="chk" data-act="toggle" data-id="' + t.id + '" data-d="' + d + '">' + (done ? '✓' : '') + '</button>' +
    '<div class="body" data-act="open" data-id="' + t.id + '" data-d="' + d + '"><div class="t">' + esc(t.title) + '</div>' + (meta.length ? '<div class="meta">' + meta.join('') + '</div>' : '') + acts + '</div>' +
    '<button class="edit" data-act="edit" data-id="' + t.id + '">✎</button></div>';
}
function thoughtHTML(d) {
  const t = S.thoughts[d];
  return '<div class="card pin" data-act="thought" data-d="' + d + '"><div class="lbl">📌 Myśl na ' + (d === today() ? 'dziś' : d) + '</div><div class="txt ' + (t ? '' : 'empty') + '">' + (t ? esc(t) : 'Dotknij, aby przypiąć myśl na ten dzień…') + '</div></div>';
}
function listHTML(d) {
  const l = tasksOn(d);
  return l.length ? l.map(t => taskHTML(t, d)).join('') : '<div class="card empty-s">Brak zadań na ten dzień.<br>Dodaj pierwsze przyciskiem ＋</div>';
}
function levelCard() {
  const L = levelInfo(expTotal());
  return '<div class="card lvl" data-act="goto" data-v="prog"><div class="orb sm">' + L.level + '</div><div class="sp"><div class="row"><b>Poziom ' + L.level + '</b><span class="sp"></span><span class="mono">' + L.cur + ' / ' + L.need + ' EXP</span></div><div class="bar gold"><i style="width:' + L.pct + '%"></i></div></div><div class="coin">💰 ' + balance() + '</div></div>';
}
function pillsHTML() {
  const tm = addDays(today(), 1), r = st.range;
  const p = [['today', 'Dziś', r === 'today'], ['tomorrow', 'Jutro', r === 'day' && st.sel === tm], ['week', 'Tydzień', r === 'week'], ['month', 'Miesiąc', r === 'month']];
  return '<div class="pills">' + p.map(x => '<button class="pill ' + (x[2] ? 'on' : '') + '" data-act="range" data-r="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>';
}
const fab = d => '<button class="fab" data-act="add" data-d="' + d + '">＋</button>';

VIEWS.plan = function () {
  const r = st.range, td = today();
  let body = '';
  if (r === 'today') {
    const p = progress(td), si = streakInfo(), q = quoteOfDay(), od = overdue().filter(t => t.date !== td);
    const hr = new Date().getHours(), hi = hr < 5 ? 'Dobranoc' : hr < 12 ? 'Dzień dobry' : hr < 18 ? 'Cześć' : 'Dobry wieczór';
    body = '<div class="head"><div><h1>' + hi + ' 👋</h1><p class="sub">' + nice(td) + '</p></div><div class="streak" title="' + (si.shield ? 'Dzień ochronny dostępny w tym tygodniu' : 'Dzień ochronny już wykorzystany') + '">🔥 ' + si.cur + (si.shield ? ' 🛡' : '') + '</div></div>' +
      levelCard() +
      '<div class="card"><div class="row"><b>Postęp dnia</b><span class="sp"></span><b>' + p.done + '/' + p.total + '</b></div><div class="bar ' + (p.total && p.done === p.total ? 'full' : '') + '"><i style="width:' + p.pct + '%"></i></div>' +
      '<div class="sub" style="margin:0">' + (p.total === 0 ? 'Dodaj zadania, aby zacząć serię' : p.done === p.total ? '🎉 Wszystko zrobione!' : 'Zostało ' + (p.total - p.done) + ' do zrobienia') + '</div></div>' +
      thoughtHTML(td) +
      (q ? '<div class="card quote"><div class="lbl">❝ Cytat dnia</div><div class="q">' + esc(q.text) + '</div>' + (q.author ? '<div class="a">— ' + esc(q.author) + '</div>' : '') + '</div>' : '') +
      (od.length ? '<h2>Zaległe</h2>' + od.map(t => taskHTML(t, t.date)).join('') : '') + '<h2>Dzisiaj</h2>' + listHTML(td) + fab(td);
  } else if (r === 'day') {
    body = '<div class="cal-h"><button data-act="dayprev">‹</button><h1 style="font-size:18px;text-align:center">' + nice(st.sel) + '</h1><button data-act="daynext">›</button></div>' +
      '<div class="card"><div class="row"><b>Postęp</b><span class="sp"></span><b>' + progress(st.sel).done + '/' + progress(st.sel).total + '</b></div><div class="bar"><i style="width:' + progress(st.sel).pct + '%"></i></div></div>' +
      thoughtHTML(st.sel) + listHTML(st.sel) + fab(st.sel);
  } else if (r === 'week') body = weekHTML();
  else body = monthHTML();
  return pillsHTML() + body;
};

function weekHTML() {
  const H0 = 6, H1 = 23, RH = 30, td = today(), now = new Date(), nowM = now.getHours() * 60 + now.getMinutes();
  const days = Array.from({ length: 7 }, (_, i) => addDays(st.wk, i));
  const a = parse(days[0]), b = parse(days[6]);
  let head = '<div class="wk-h"><i></i>' + days.map((d, i) => '<button class="' + (d === td ? 'tod' : '') + '" data-act="gotoday" data-d="' + d + '">' + DOW[i] + '<b>' + parse(d).getDate() + '</b></button>').join('') + '</div>';
  let un = '<div class="wk-h un"><i>bez godz.</i>' + days.map(d => { const n = tasksOn(d).filter(t => !t.time && !isSkipped(t, d)).length; return '<button data-act="gotoday" data-d="' + d + '">' + (n ? '+' + n : '') + '</button>'; }).join('') + '</div>';
  let hours = ''; for (let h = H0; h < H1; h++) hours += '<div style="height:' + RH + 'px">' + String(h).padStart(2, '0') + '</div>';
  const cols = days.map(d => {
    const ev = tasksOn(d).filter(t => t.time && !isSkipped(t, d)).map(t => { const [h, m] = t.time.split(':').map(Number); const s0 = h * 60 + m; return { t, s: s0, e: s0 + (Number(t.dur) || 30), lane: 0 }; }).sort((x, y) => x.s - y.s);
    const lanes = []; for (const x of ev) { let i = lanes.findIndex(e => e <= x.s); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = x.e; x.lane = i; }
    const n = Math.max(1, lanes.length);
    const blocks = ev.map(x => {
      const top = (Math.max(x.s, H0 * 60) - H0 * 60) / 60 * RH, hh = Math.max((x.e - x.s) / 60 * RH - 2, 16);
      return '<button class="blk ' + (isDone(x.t, d) ? 'd' : '') + '" style="top:' + top + 'px;height:' + hh + 'px;left:' + (x.lane * 100 / n) + '%;width:' + (100 / n) + '%;--c:' + (CATS[x.t.cat] || '#64748b') + '" data-act="edit" data-id="' + x.t.id + '">' + esc(x.t.title) + '</button>';
    }).join('');
    const line = d === td && nowM >= H0 * 60 && nowM < H1 * 60 ? '<div class="nowl" style="top:' + ((nowM - H0 * 60) / 60 * RH) + 'px"></div>' : '';
    return '<div class="wk-col" style="height:' + (H1 - H0) * RH + 'px">' + blocks + line + '</div>';
  }).join('');
  return '<div class="cal-h"><button data-act="pw">‹</button><h1 style="font-size:16px">' + a.getDate() + ' ' + MONTHS[a.getMonth()].slice(0, 3).toLowerCase() + ' – ' + b.getDate() + ' ' + MONTHS[b.getMonth()].slice(0, 3).toLowerCase() + '</h1><button data-act="nw">›</button></div>' +
    head + un + '<div class="wk-b"><div class="wk-hours">' + hours + '</div>' + cols + '</div><p class="sub" style="margin-top:8px">Dotknij bloku, aby edytować. Dotknij dnia, aby zobaczyć jego listę.</p>' + fab(today());
}
function monthHTML() {
  const [y, m] = st.month.split('-').map(Number), first = new Date(y, m - 1, 1), lead = (first.getDay() + 6) % 7, start = addDays(ymd(first), -lead), td = today();
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i), p = progress(d), inM = d.slice(0, 7) === st.month, hasDl = S.tasks.some(t => t.deadline === d);
    const dots = (p.total ? '<i class="dot ' + (p.done === p.total ? 'ok' : '') + '"></i>' : '') + (hasDl ? '<i class="dot dl"></i>' : '');
    cells += '<button class="day ' + (inM ? '' : 'out') + (d === td ? ' today' : '') + (d === st.sel ? ' sel' : '') + '" data-act="pick" data-d="' + d + '">' + parse(d).getDate() + '<div class="dots">' + dots + '</div></button>';
  }
  return '<div class="cal-h"><button data-act="pm">‹</button><h1 style="font-size:20px">' + MONTHS[m - 1] + ' ' + y + '</h1><button data-act="nm">›</button></div>' +
    '<div class="grid">' + DOW.map(x => '<div class="dow">' + x + '</div>').join('') + cells + '</div>' +
    '<p class="sub" style="margin-top:8px">🟣 zadania · 🟢 wszystko zrobione · 🔴 deadline</p><h2>' + nice(st.sel) + '</h2>' + thoughtHTML(st.sel) + listHTML(st.sel) + fab(st.sel);
}

/* ---- Cele ---- */
VIEWS.goals = function () {
  const td = today(), act = S.goals.filter(g => !g.done), dn = S.goals.filter(g => g.done);
  const card = g => {
    const tot = g.steps.length, ok = g.steps.filter(s => s.done).length, pct = tot ? Math.round(ok / tot * 100) : (g.done ? 100 : 0);
    let linked = 0; for (const t of S.tasks) if (t.goal === g.id) linked += Object.keys(t.done || {}).filter(k => t.done[k]).length;
    const left = g.deadline ? diffDays(g.deadline, td) : null;
    return '<div class="card goal ' + (g.done ? 'gdone' : '') + '"><div class="row"><div class="sp"><div class="gt">' + esc(g.title) + '</div><div class="meta">' + catChip(g.cat || 'Inne') +
      (g.deadline ? '<span class="b ' + (left < 0 ? 'bad' : left < 14 ? 'warn' : '') + '">🚩 do ' + g.deadline + (g.done ? '' : left < 0 ? ' (po terminie)' : ' · ' + left + ' dni') + '</span>' : '') + (linked ? '<span class="b">✓ ' + linked + ' zadań powiązanych</span>' : '') + '</div></div><button class="edit" data-act="editgoal" data-id="' + g.id + '">✎</button></div>' +
      (tot ? '<div class="bar"><i style="width:' + pct + '%"></i></div><div class="steps">' + g.steps.map((s, i) => '<label class="step ' + (s.done ? 'sd' : '') + '"><input type="checkbox" data-act="gstep" data-id="' + g.id + '" data-i="' + i + '" ' + (s.done ? 'checked' : '') + '>' + esc(s.t) + '</label>').join('') + '</div>' : '') +
      (g.done ? '<div class="sub" style="margin:6px 0 0">🏆 Osiągnięty</div>' : '<button class="btn sm sec" style="margin-top:8px" data-act="gdone" data-id="' + g.id + '">Osiągnąłem ten cel (+200 EXP)</button>') + '</div>';
  };
  return '<h1>Cele 🎯</h1><p class="sub">Duże rzeczy rozbite na kroki. Kroki dają +10 EXP, cel +200</p>' +
    (act.length ? act.map(card).join('') : '<div class="card empty-s">Brak aktywnych celów. Dodaj pierwszy ＋</div>') +
    (dn.length ? '<h2>Osiągnięte</h2>' + dn.map(card).join('') : '') + '<button class="fab" data-act="addgoal">＋</button>';
};

/* ---- Zapiski: pomysły / cytaty / skrzynka ---- */
VIEWS.notes = function () {
  const z = st.zap, tabs = [['ideas', '💡 Pomysły'], ['quotes', '❝ Cytaty'], ['inbox', '📥 Skrzynka' + (S.inbox.length ? ' (' + S.inbox.length + ')' : '')]];
  const pills = '<div class="pills">' + tabs.map(x => '<button class="pill ' + (z === x[0] ? 'on' : '') + '" data-act="zap" data-z="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>';
  if (z === 'quotes') {
    const l = S.quotes.slice().sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0));
    return pills + '<p class="sub">Gwiazdką oznaczone cytaty są losowane jako cytat dnia</p>' + l.map(q => '<div class="card quote"><div class="q">' + esc(q.text) + '</div>' + (q.author ? '<div class="a">— ' + esc(q.author) + '</div>' : '') +
      '<div class="row" style="margin-top:8px"><button class="edit" data-act="favq" data-id="' + q.id + '">' + (q.fav ? '⭐' : '☆') + '</button><span class="sp"></span><button class="edit" data-act="editq" data-id="' + q.id + '">✎</button></div></div>').join('') + '<button class="fab" data-act="addq">＋</button>';
  }
  if (z === 'inbox') {
    return pills + '<p class="sub">Wrzuć tu wszystko, o czym nie chcesz pamiętać. Zaplanujesz to później.</p>' +
      '<div class="row"><input id="inb" placeholder="Nowa sprawa…" style="margin:0"><button class="btn" data-act="inboxadd">Dodaj</button></div><div style="height:10px"></div>' +
      (S.inbox.length ? S.inbox.map(i => '<div class="card row"><div class="sp">' + esc(i.title) + '</div><button class="btn sm sec" data-act="inboxplan" data-id="' + i.id + '">Zaplanuj</button><button class="edit" data-act="inboxdel" data-id="' + i.id + '">✕</button></div>').join('') : '<div class="card empty-s">Skrzynka pusta 🎉</div>');
  }
  const cats = ['Wszystkie'].concat(IDEA_CATS), q = st.q.toLowerCase();
  const list = S.ideas.filter(i => (st.cat === 'Wszystkie' || i.cat === st.cat) && (!q || (i.title + ' ' + i.text).toLowerCase().includes(q))).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.created - a.created);
  return pills + '<input id="search" placeholder="Szukaj pomysłów…" value="' + esc(st.q) + '"><div class="chips">' + cats.map(c => '<button class="chip ' + (c === st.cat ? 'on' : '') + '" data-act="cat" data-c="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>' +
    (list.length ? list.map(i => '<div class="card idea ' + (i.pinned ? 'pinned' : '') + '" data-act="editidea" data-id="' + i.id + '"><div class="row"><h4 class="sp">' + (i.pinned ? '📌 ' : '') + esc(i.title) + '</h4><span class="b">' + esc(i.cat) + '</span></div>' + (i.text ? '<p>' + esc(i.text) + '</p>' : '') + '</div>').join('') : '<div class="card empty-s">Brak pomysłów. Zapisz pierwszy 💡</div>') +
    '<button class="fab" data-act="addidea">＋</button>';
};

/* ---- Postęp: poziom, portfel, przegląd, odznaki ---- */
VIEWS.prog = function () {
  const L = levelInfo(expTotal()), si = streakInfo(), w = weekReview(), bal = balance(), bd = badges();
  const maxCat = Math.max(1, ...Object.values(w.cats));
  const spendByCat = {}; S.spends.forEach(s => spendByCat[s.cat] = (spendByCat[s.cat] || 0) + s.amount);
  return '<h1>Postęp 🏆</h1>' +
    '<div class="card hero"><div class="orb">' + L.level + '</div><div style="text-align:center"><b style="font-size:18px">Poziom ' + L.level + '</b><div class="mono">' + expTotal() + ' EXP · do następnego: ' + (L.need - L.cur) + '</div></div><div class="bar gold" style="width:100%"><i style="width:' + L.pct + '%"></i></div>' +
    '<div class="row" style="width:100%;justify-content:space-around"><div class="kpi"><b>🔥 ' + si.cur + '</b><span>seria</span></div><div class="kpi"><b>🏅 ' + si.best + '</b><span>rekord</span></div><div class="kpi"><b>' + (si.shield ? '🛡 tak' : '🛡 nie') + '</b><span>dzień ochronny</span></div></div></div>' +
    '<h2>Portfel punktów</h2><div class="card"><div class="row"><div class="sp"><div class="mono">DO WYDANIA</div><div style="font-size:30px;font-weight:800">💰 ' + bal + ' pkt</div></div><button class="btn" data-act="spend">Wydaj</button></div>' +
    '<div class="sub" style="margin:8px 0 0">Każdy poziom daje ' + S.settings.ppl + ' pkt. Zdobyto łącznie ' + earned() + ', wydano ' + spent() + '.</div>' +
    (Object.keys(spendByCat).length ? '<div class="meta" style="margin-top:8px">' + Object.entries(spendByCat).map(([c, v]) => '<span class="b">' + esc(c) + ': ' + v + '</span>').join('') + '</div>' : '') + '</div>' +
    (S.spends.length ? '<div class="card"><b>Historia wydanych punktów</b>' + S.spends.slice().reverse().slice(0, 15).map(s => '<div class="srow"><div class="sp"><div>' + esc(s.what) + '</div><div class="sub" style="margin:0">' + s.date + ' · ' + esc(s.cat) + '</div></div><b>−' + s.amount + '</b><button class="edit" data-act="delspend" data-id="' + s.id + '">✕</button></div>').join('') + '</div>' : '') +
    '<h2>Przegląd 7 dni</h2><div class="card"><div class="chart">' + w.days.map(x => '<div class="cbar"><div class="cb"><i style="height:' + x.p.pct + '%"></i></div><span>' + DOW[(parse(x.d).getDay() + 6) % 7] + '</span><em>' + (x.p.total ? x.p.done + '/' + x.p.total : '–') + '</em></div>').join('') + '</div>' +
    '<div class="sub" style="margin:8px 0 0">Zrobione: <b>' + w.ok + '/' + w.tot + '</b>' + (w.best ? ' · najlepszy dzień: <b>' + nice(w.best.d) + '</b>' : '') + '</div>' +
    '<div class="sub" style="margin:4px 0 0">💪 Opór pokonany: <b>' + w.overcame + '</b> · bez zrobienia: <b>' + w.resistOpen + '</b> · odpuszczone: <b>' + w.skipped + '</b></div>' +
    (w.topResist.length ? '<div class="sub" style="margin:4px 0 0">Najczęstszy opór (30 dni): ' + w.topResist.map(x => esc(x[0]) + ' (' + x[1] + '×)').join(', ') + '</div>' : '') + '</div>' +
    '<div class="card"><b>Na co poszedł tydzień</b>' + (Object.keys(w.cats).length ? Object.entries(w.cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => '<div class="crow"><span>' + esc(c) + '</span><div class="bar" style="margin:0"><i style="width:' + v / maxCat * 100 + '%;background:' + (CATS[c] || '#64748b') + '"></i></div><b>' + v + '</b></div>').join('') : '<div class="sub">Brak zrobionych zadań w tym tygodniu.</div>') + '</div>' +
    '<h2>Odznaki · ' + bd.filter(b => b.c >= b.t).length + ' z ' + bd.length + '</h2><div class="badges">' + bd.map(b => { const on = b.c >= b.t; return '<div class="bd ' + (on ? 'on' : '') + '"><div class="ring" style="--p:' + Math.min(100, Math.round(b.c / b.t * 100)) + '"><div class="bi">' + b.e + '</div></div><div class="bn">' + esc(b.n) + '</div><div class="bs">' + (on ? 'zdobyta' : b.c + ' / ' + b.t) + '</div></div>'; }).join('') + '</div>';
};

/* ---- Więcej ---- */
VIEWS.more = function () {
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
  return '<h1>Więcej ⚙</h1><p class="sub">Ustawienia i kopia zapasowa</p>' +
    '<div class="card"><b>Gamifikacja</b><div class="g2" style="margin-top:8px"><div><label>Punkty do wydania za poziom</label><input id="s-ppl" type="number" min="1" value="' + S.settings.ppl + '"></div><div><label>Mnożnik EXP</label><input id="s-xp" type="number" min="0.1" step="0.1" value="' + S.settings.xpMul + '"></div></div>' +
    '<p class="sub">Zadanie = 10 EXP, opór pokonany +5, w terminie +5, cały dzień (min. 2 zadania) +20. Poziom 1→2 wymaga 125 EXP i rośnie z każdym poziomem.</p><button class="btn sec" data-act="savesettings">Zapisz</button></div>' +
    '<div class="card"><b>Powiadomienia</b><p class="sub">Status: ' + ({ granted: '✅ włączone', denied: '⛔ zablokowane w przeglądarce', default: 'nie włączone', unsupported: 'brak wsparcia' }[perm]) + '</p>' +
    '<p class="sub">Przypomnienia działają, gdy aplikacja jest otwarta lub działa w tle. Telefon może ją uśpić, więc nie traktuj ich jak budzika.</p>' +
    '<div class="acts"><button class="btn" data-act="perm">Włącz powiadomienia</button><button class="btn sec" data-act="testn">Testuj</button></div></div>' +
    '<div class="card"><b>Kopia zapasowa</b><p class="sub">Dane są tylko w tym telefonie. Rób od czasu do czasu eksport.</p><div class="acts"><button class="btn" data-act="export">Eksportuj</button><button class="btn sec" data-act="import">Importuj</button></div><input type="file" id="file" accept="application/json" style="display:none"></div>';
};

/* ===================== Formularze ===================== */
const sel = (v, cur) => (String(cur) === String(v) ? ' selected' : '');
function taskForm(id, date, title, inboxId) {
  const t = id ? S.tasks.find(x => x.id === id) : { title: title || '', date, time: '', dur: '', cat: 'Inne', goal: '', deadline: '', remind: '', repeat: 'none' };
  st.fromInbox = inboxId || null;
  modal('<h3>' + (id ? 'Edytuj zadanie' : 'Nowe zadanie') + '</h3><label>Co masz zrobić?</label><input id="f-title" value="' + esc(t.title) + '" placeholder="np. Trening, napisać post…">' +
    '<div class="g2"><div><label>Data</label><input id="f-date" type="date" value="' + t.date + '"></div><div><label>Godzina</label><input id="f-time" type="time" value="' + (t.time || '') + '"></div></div>' +
    '<div class="g2"><div><label>Czas trwania</label><select id="f-dur"><option value="">domyślnie 30 min</option>' + [15, 30, 45, 60, 90, 120, 180].map(m => '<option value="' + m + '"' + sel(m, t.dur) + '>' + m + ' min</option>').join('') + '</select></div>' +
    '<div><label>Kategoria</label><select id="f-cat">' + Object.keys(CATS).map(c => '<option' + sel(c, t.cat || 'Inne') + '>' + c + '</option>').join('') + '</select></div></div>' +
    '<div class="g2"><div><label>Powtarzaj</label><select id="f-rep"><option value="none"' + sel('none', t.repeat) + '>Nie</option><option value="daily"' + sel('daily', t.repeat) + '>Codziennie</option><option value="weekdays"' + sel('weekdays', t.repeat) + '>Pn–Pt</option></select></div><div><label>Deadline</label><input id="f-dl" type="date" value="' + (t.deadline || '') + '"></div></div>' +
    (S.goals.filter(g => !g.done).length ? '<label>Powiąż z celem</label><select id="f-goal"><option value="">—</option>' + S.goals.filter(g => !g.done || g.id === t.goal).map(g => '<option value="' + g.id + '"' + sel(g.id, t.goal) + '>' + esc(g.title) + '</option>').join('') + '</select>' : '') +
    '<label>Przypomnienie (wymaga godziny)</label><select id="f-rem"><option value=""' + sel('', t.remind) + '>Brak</option><option value="0"' + sel(0, t.remind) + '>O czasie</option><option value="5"' + sel(5, t.remind) + '>5 min wcześniej</option><option value="15"' + sel(15, t.remind) + '>15 min wcześniej</option><option value="30"' + sel(30, t.remind) + '>30 min wcześniej</option><option value="60"' + sel(60, t.remind) + '>1 godz. wcześniej</option><option value="1440"' + sel(1440, t.remind) + '>1 dzień wcześniej</option></select>' +
    '<div class="acts">' + (id ? '<button class="btn del" data-act="deltask" data-id="' + id + '">Usuń</button>' : '') + '<button class="btn sec" data-act="close">Anuluj</button><button class="btn" data-act="savetask" data-id="' + (id || '') + '">Zapisz</button></div>');
  setTimeout(() => !id && $('#f-title') && $('#f-title').focus(), 50);
}
function saveTask(id) {
  const title = $('#f-title').value.trim();
  if (!title) return toast('Wpisz nazwę zadania');
  const g = $('#f-goal');
  const data = { title, date: $('#f-date').value || today(), time: $('#f-time').value, dur: $('#f-dur').value, cat: $('#f-cat').value, repeat: $('#f-rep').value, deadline: $('#f-dl').value, remind: $('#f-rem').value, goal: g ? g.value : '' };
  if (data.remind !== '' && !data.time) return toast('Przypomnienie wymaga godziny');
  if (id) Object.assign(S.tasks.find(x => x.id === id), data); else S.tasks.push(Object.assign({ id: uid(), done: {}, resist: {}, skipped: {} }, data));
  if (st.fromInbox) { S.inbox = S.inbox.filter(i => i.id !== st.fromInbox); st.fromInbox = null; }
  save(); closeModal(); rerender(); checkReminders();
}
function thoughtForm(d) {
  modal('<h3>📌 Myśl na ' + (d === today() ? 'dziś' : d) + '</h3><textarea id="f-th" placeholder="Intencja, mantra, jedno ważne zdanie…">' + esc(S.thoughts[d] || '') + '</textarea><div class="acts"><button class="btn sec" data-act="close">Anuluj</button><button class="btn" data-act="savethought" data-d="' + d + '">Zapisz</button></div>');
}
function ideaForm(id) {
  const i = id ? S.ideas.find(x => x.id === id) : { title: '', text: '', cat: IDEA_CATS[0], pinned: false };
  modal('<h3>' + (id ? 'Edytuj pomysł' : 'Nowy pomysł') + '</h3><label>Tytuł</label><input id="f-it" value="' + esc(i.title) + '"><label>Kategoria</label><select id="f-ic">' + IDEA_CATS.map(c => '<option' + (c === i.cat ? ' selected' : '') + '>' + c + '</option>').join('') + '</select><label>Opis</label><textarea id="f-ix">' + esc(i.text) + '</textarea>' +
    '<div class="acts">' + (id ? '<button class="btn del" data-act="delidea" data-id="' + id + '">Usuń</button><button class="btn sec" data-act="pinidea" data-id="' + id + '">' + (i.pinned ? 'Odepnij' : 'Przypnij') + '</button>' : '') + '<button class="btn" data-act="saveidea" data-id="' + (id || '') + '">Zapisz</button></div>');
}
function quoteForm(id) {
  const q = id ? S.quotes.find(x => x.id === id) : { text: '', author: '' };
  modal('<h3>' + (id ? 'Edytuj cytat' : 'Nowy cytat') + '</h3><label>Cytat</label><textarea id="f-qt">' + esc(q.text) + '</textarea><label>Autor</label><input id="f-qa" value="' + esc(q.author) + '"><div class="acts">' + (id ? '<button class="btn del" data-act="delq" data-id="' + id + '">Usuń</button>' : '') + '<button class="btn sec" data-act="close">Anuluj</button><button class="btn" data-act="saveq" data-id="' + (id || '') + '">Zapisz</button></div>');
}
function goalForm(id) {
  const g = id ? S.goals.find(x => x.id === id) : { title: '', cat: 'Biznes', deadline: '', steps: [] };
  modal('<h3>' + (id ? 'Edytuj cel' : 'Nowy cel') + '</h3><label>Cel</label><input id="f-gt" value="' + esc(g.title) + '" placeholder="np. 10 000 obserwujących do czerwca">' +
    '<div class="g2"><div><label>Kategoria</label><select id="f-gc">' + Object.keys(CATS).map(c => '<option' + sel(c, g.cat) + '>' + c + '</option>').join('') + '</select></div><div><label>Termin</label><input id="f-gd" type="date" value="' + (g.deadline || '') + '"></div></div>' +
    '<label>Kroki (każdy w nowej linii)</label><textarea id="f-gs">' + esc(g.steps.map(s => s.t).join('\n')) + '</textarea>' +
    '<div class="acts">' + (id ? '<button class="btn del" data-act="delgoal" data-id="' + id + '">Usuń</button>' : '') + '<button class="btn sec" data-act="close">Anuluj</button><button class="btn" data-act="savegoal" data-id="' + (id || '') + '">Zapisz</button></div>');
}
function spendForm() {
  modal('<h3>💰 Wydaj punkty</h3><p class="sub">Dostępne: <b>' + balance() + ' pkt</b>. Wydane punkty znikają z portfela i trafiają do historii. To Twoja zgoda na realny wydatek.</p>' +
    '<label>Ile punktów?</label><input id="f-sa" type="number" min="1" inputmode="numeric" placeholder="np. 2500"><label>Na co? (twoja zgoda)</label><input id="f-sw" placeholder="np. Inwestycja 500 zł w ETF, kurs copywritingu">' +
    '<label>Kategoria</label><select id="f-sc">' + SPEND_CATS.map(c => '<option>' + c + '</option>').join('') + '</select><div class="acts"><button class="btn sec" data-act="close">Anuluj</button><button class="btn" data-act="savespend">Zatwierdzam zgodę</button></div>');
}

/* ===================== Akcje ===================== */
const A = {
  close: closeModal,
  undo: () => { if (undoSnap) { S = Object.assign(JSON.parse(JSON.stringify(DEFAULT)), JSON.parse(undoSnap)); undoSnap = null; save(); rerender(); toast('Cofnięto'); } },
  goto: (_, el) => { st.view = el.dataset.v; render(); },
  range: (_, el) => {
    const r = el.dataset.r, td = today();
    if (r === 'today') { st.range = 'today'; st.sel = td; }
    else if (r === 'tomorrow') { st.range = 'day'; st.sel = addDays(td, 1); }
    else if (r === 'week') { st.range = 'week'; st.wk = mondayOf(td); }
    else { st.range = 'month'; st.month = st.sel.slice(0, 7); }
    st.open = null; render();
  },
  gotoday: d => { st.range = 'day'; st.sel = d; rerender(); },
  dayprev: () => { st.sel = addDays(st.sel, -1); rerender(); },
  daynext: () => { st.sel = addDays(st.sel, 1); rerender(); },
  pw: () => { st.wk = addDays(st.wk, -7); rerender(); },
  nw: () => { st.wk = addDays(st.wk, 7); rerender(); },
  pm: () => { st.month = addDays(st.month + '-01', -1).slice(0, 7); rerender(); },
  nm: () => { st.month = addDays(st.month + '-28', 5).slice(0, 7); rerender(); },
  pick: d => { st.sel = d; st.month = d.slice(0, 7); rerender(); },
  open: (_, el) => { const k = el.dataset.id + '|' + el.dataset.d; st.open = st.open === k ? null : k; rerender(); },
  add: d => taskForm(null, d),
  edit: (_, el) => taskForm(el.dataset.id),
  savetask: (_, el) => saveTask(el.dataset.id),
  deltask: (_, el) => { if (confirm('Usunąć to zadanie?')) { closeModal(); mutate(() => { S.tasks = S.tasks.filter(x => x.id !== el.dataset.id); }, 'Zadanie usunięte'); } },
  toggle: (_, el) => {
    const t = S.tasks.find(x => x.id === el.dataset.id), d = el.dataset.d, was = isDone(t, d);
    mutate(() => { t.done = t.done || {}; if (was) delete t.done[d]; else { t.done[d] = true; if (t.skipped) delete t.skipped[d]; } },
      diff => was ? 'Cofnięto zadanie (' + diff + ' EXP)' : (d === today() && progress(d).total >= 2 && progress(d).done === progress(d).total ? '🎉 Dzień zaliczony! +' + diff + ' EXP' : '✓ +' + diff + ' EXP'));
  },
  resist: (_, el) => { const t = S.tasks.find(x => x.id === el.dataset.id), d = el.dataset.d; mutate(() => { t.resist = t.resist || {}; t.resist[d] = true; }, '💪 Zrób choć 5 minut. Pokonany opór daje +5 EXP', false); },
  skip: (_, el) => { const t = S.tasks.find(x => x.id === el.dataset.id), d = el.dataset.d; mutate(() => { t.skipped = t.skipped || {}; if (t.skipped[d]) delete t.skipped[d]; else { t.skipped[d] = true; if (t.done) delete t.done[d]; } }, 'Zapisane. Zobaczysz to w przeglądzie tygodnia'); },
  thought: d => thoughtForm(d),
  savethought: d => { const v = $('#f-th').value.trim(); if (v) S.thoughts[d] = v; else delete S.thoughts[d]; save(); closeModal(); rerender(); },
  zap: (_, el) => { st.zap = el.dataset.z; rerender(); },
  cat: (_, el) => { st.cat = el.dataset.c; rerender(); },
  addidea: () => ideaForm(),
  editidea: (_, el) => ideaForm(el.dataset.id),
  saveidea: (_, el) => {
    const title = $('#f-it').value.trim(); if (!title) return toast('Wpisz tytuł');
    const data = { title, cat: $('#f-ic').value, text: $('#f-ix').value.trim() };
    if (el.dataset.id) Object.assign(S.ideas.find(x => x.id === el.dataset.id), data); else S.ideas.push(Object.assign({ id: uid(), pinned: false, created: Date.now() }, data));
    save(); closeModal(); rerender();
  },
  delidea: (_, el) => { if (confirm('Usunąć pomysł?')) { closeModal(); mutate(() => { S.ideas = S.ideas.filter(x => x.id !== el.dataset.id); }, 'Pomysł usunięty'); } },
  pinidea: (_, el) => { const i = S.ideas.find(x => x.id === el.dataset.id); i.pinned = !i.pinned; save(); closeModal(); rerender(); },
  addq: () => quoteForm(),
  editq: (_, el) => quoteForm(el.dataset.id),
  favq: (_, el) => { const q = S.quotes.find(x => x.id === el.dataset.id); q.fav = !q.fav; save(); rerender(); },
  saveq: (_, el) => {
    const text = $('#f-qt').value.trim(); if (!text) return toast('Wpisz cytat');
    const data = { text, author: $('#f-qa').value.trim() };
    if (el.dataset.id) Object.assign(S.quotes.find(x => x.id === el.dataset.id), data); else S.quotes.push(Object.assign({ id: uid(), fav: false }, data));
    save(); closeModal(); rerender();
  },
  delq: (_, el) => { if (confirm('Usunąć cytat?')) { closeModal(); mutate(() => { S.quotes = S.quotes.filter(x => x.id !== el.dataset.id); }, 'Cytat usunięty'); } },
  inboxadd: () => { const i = $('#inb'), v = i.value.trim(); if (!v) return; S.inbox.push({ id: uid(), title: v }); save(); rerender(); const n = $('#inb'); n && n.focus(); },
  inboxdel: (_, el) => mutate(() => { S.inbox = S.inbox.filter(x => x.id !== el.dataset.id); }, 'Usunięto ze skrzynki'),
  inboxplan: (_, el) => { const i = S.inbox.find(x => x.id === el.dataset.id); taskForm(null, today(), i.title, i.id); },
  addgoal: () => goalForm(),
  editgoal: (_, el) => goalForm(el.dataset.id),
  savegoal: (_, el) => {
    const title = $('#f-gt').value.trim(); if (!title) return toast('Wpisz cel');
    const id = el.dataset.id, old = id ? S.goals.find(x => x.id === id) : null;
    const steps = $('#f-gs').value.split('\n').map(s => s.trim()).filter(Boolean).map(t => ({ t, done: !!(old && old.steps.find(o => o.t === t && o.done)) }));
    const data = { title, cat: $('#f-gc').value, deadline: $('#f-gd').value, steps };
    mutate(() => { if (old) Object.assign(old, data); else S.goals.push(Object.assign({ id: uid(), done: false }, data)); }, null, true); closeModal();
  },
  delgoal: (_, el) => { if (confirm('Usunąć cel?')) { closeModal(); mutate(() => { S.goals = S.goals.filter(x => x.id !== el.dataset.id); S.tasks.forEach(t => { if (t.goal === el.dataset.id) t.goal = ''; }); }, 'Cel usunięty'); } },
  gstep: (_, el) => { const g = S.goals.find(x => x.id === el.dataset.id), s = g.steps[+el.dataset.i]; mutate(() => { s.done = !s.done; }, diff => s.done ? '✓ Krok wykonany +' + diff + ' EXP' : 'Cofnięto krok'); },
  gdone: (_, el) => { const g = S.goals.find(x => x.id === el.dataset.id); if (confirm('Oznaczyć cel jako osiągnięty?')) mutate(() => { g.done = true; }, diff => '🏆 Cel osiągnięty! +' + diff + ' EXP'); },
  spend: () => spendForm(),
  savespend: () => {
    const amount = Math.floor(Number($('#f-sa').value)), what = $('#f-sw').value.trim();
    if (!amount || amount < 1) return toast('Wpisz liczbę punktów');
    if (amount > balance()) return toast('Masz tylko ' + balance() + ' pkt');
    if (!what) return toast('Napisz, na co przeznaczasz punkty');
    closeModal(); mutate(() => { S.spends.push({ id: uid(), date: today(), amount, what, cat: $('#f-sc') ? $('#f-sc').value : 'Inne' }); }, '✅ Zgoda zapisana: −' + amount + ' pkt');
  },
  delspend: (_, el) => { if (confirm('Usunąć wpis? Punkty wrócą do portfela.')) mutate(() => { S.spends = S.spends.filter(x => x.id !== el.dataset.id); }, 'Punkty zwrócone do portfela'); },
  savesettings: () => {
    const p = Math.max(1, Math.floor(Number($('#s-ppl').value)) || 100), x = Math.max(0.1, Number($('#s-xp').value) || 1);
    S.settings.ppl = p; S.settings.xpMul = x; save(); rerender(); toast('Zapisano ustawienia');
  },
  perm: async () => {
    if (typeof Notification === 'undefined') return toast('Ta przeglądarka nie obsługuje powiadomień');
    const r = await Notification.requestPermission(); toast(r === 'granted' ? 'Powiadomienia włączone ✅' : 'Brak zgody'); rerender();
  },
  testn: () => canNotify() ? notify('BrainSpace', 'Powiadomienia działają 🎉', 'test') : toast('Najpierw włącz powiadomienia'),
  export: () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' })); a.download = 'brainspace-backup-' + today() + '.json'; a.click(); },
  import: () => $('#file').click()
};

if (typeof document !== 'undefined') {
  document.addEventListener('click', e => {
    if (e.target.id === 'modal') return closeModal();
    const nav = e.target.closest('nav button');
    if (nav) { st.view = nav.dataset.v; if (st.view === 'plan') { st.range = 'today'; st.sel = today(); } return render(); }
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT') return;
    const f = A[el.dataset.act]; if (f) f(el.dataset.d, el);
  });
  document.addEventListener('change', e => {
    if (e.target.dataset && e.target.dataset.act === 'gstep') return A.gstep(null, e.target);
    if (e.target.id !== 'file' || !e.target.files[0]) return;
    const r = new FileReader();
    r.onload = () => {
      try { const d = JSON.parse(r.result); if (!Array.isArray(d.tasks)) throw 0; S = Object.assign(JSON.parse(JSON.stringify(DEFAULT)), d); S.settings = Object.assign({}, DEFAULT.settings, d.settings || {}); save(); toast('Zaimportowano ✅'); render(); }
      catch (_) { toast('Nieprawidłowy plik'); }
    };
    r.readAsText(e.target.files[0]);
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'search') { st.q = e.target.value; const pos = e.target.selectionStart; rerender(); const s = $('#search'); s.focus(); s.setSelectionRange(pos, pos); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'inb') A.inboxadd(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkReminders(); if (st.view === 'plan' && st.range === 'today') st.sel = today(); rerender(); } });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
  S.maxLevel = Math.max(S.maxLevel || 1, levelInfo(expTotal()).level); save();
  render(); checkReminders(); setInterval(checkReminders, 20000);
}
if (typeof module !== 'undefined') module.exports = { S: () => S, setS: v => { S = v; }, streakInfo, progress, expTotal, levelInfo, balance, earned, weekReview, badges, tasksOn, addDays, today, mondayOf };
