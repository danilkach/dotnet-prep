'use strict';

const SECTIONS = (window.PREP || []).filter(s => s && Array.isArray(s.chapters));
const KEY = 'prep.v1';
const DAY = 24 * 60 * 60 * 1000;
// Days until a card is due again, by box: box 0 comes back within the hour
const INTERVALS = [0, 1, 3, 7, 16, 35];
const SESSION_SIZE = 15;
const MASTERED_BOX = 3;

const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('back');

let state = load();
let session = null;
let updateReady = false;

function load() {
  const empty = { read: {}, cards: {}, pos: {}, size: 17 };
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? Object.assign(empty, JSON.parse(raw)) : empty;
  } catch {
    return empty;
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked: progress just isn't kept */ }
}

function applySize() {
  document.documentElement.style.setProperty('--size', state.size + 'px');
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function section(id) { return SECTIONS.find(s => s.id === id); }

function questionsOf(sectionId, chapterId) {
  return SECTIONS
    .filter(s => !sectionId || s.id === sectionId)
    .flatMap(s => s.questions.map(q => Object.assign({ section: s.id }, q)))
    .filter(q => !chapterId || q.chapter === chapterId);
}

function isDue(q, now) {
  const card = state.cards[q.id];
  return card && card.due <= now;
}

function counts(questions) {
  const now = Date.now();
  let due = 0, fresh = 0, mastered = 0;
  for (const q of questions) {
    const card = state.cards[q.id];
    if (!card) fresh++;
    else {
      if (card.due <= now) due++;
      if (card.box >= MASTERED_BOX) mastered++;
    }
  }
  return { due, fresh, mastered, total: questions.length };
}

function readCount(s) {
  const read = state.read[s.id] || {};
  return s.chapters.filter(c => read[c.id]).length;
}

function shuffle(items) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function grade(q, box, correct) {
  const card = state.cards[q.id] || { box: 0, right: 0, wrong: 0 };
  const now = Date.now();
  card.box = Math.max(0, Math.min(INTERVALS.length - 1, box));
  card.due = card.box === 0 ? now + 10 * 60 * 1000 : now + INTERVALS[card.box] * DAY;
  if (correct) card.right++; else card.wrong++;
  card.seen = now;
  state.cards[q.id] = card;
  save();
}

function boxOf(q) { return state.cards[q.id]?.box ?? 0; }

// ---------- routing ----------

function go(hash) { location.hash = hash; }

function parent(parts) {
  if (parts[0] === 's' && parts[2] === 'c') return '#/s/' + parts[1];
  if (parts[0] === 'q' && parts[1] && parts[1] !== 'all') return '#/s/' + parts[1];
  return '#/';
}

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  backBtn.hidden = parts.length === 0;
  backBtn.onclick = () => go(parent(parts));
  window.scrollTo(0, 0);

  if (parts[0] === 's' && parts[2] === 'c') return chapterView(parts[1], parts[3]);
  if (parts[0] === 's') return sectionView(parts[1]);
  if (parts[0] === 'q') return quizStart(parts[1], parts[2]);
  if (parts[0] === 'settings') return settingsView();
  return homeView();
}

function setTitle(text) {
  titleEl.textContent = text;
  document.title = text;
}

// ---------- views ----------

function homeView() {
  setTitle('Подготовка');
  const all = counts(questionsOf());
  let html = '';
  if (updateReady)
    html += `<button class="btn wide ghost" onclick="location.reload()">Доступно обновление — нажмите, чтобы загрузить</button>`;
  if (!SECTIONS.length)
    html += `<p class="muted">Разделы не загрузились.</p>`;
  html += `<a class="btn wide" href="#/q/all">${all.due ? `Повторить то, что пора (${all.due})` : 'Квиз по всем разделам'}</a>`;
  html += `<p class="muted">Выучено ${all.mastered} из ${all.total} вопросов</p><ul class="list">`;
  for (const s of SECTIONS) {
    const c = counts(questionsOf(s.id));
    const read = readCount(s);
    html += `<li><a class="card" href="#/s/${s.id}">
      <div><strong>${esc(s.title)}</strong></div>
      <div class="sub">Прочитано глав: ${read} из ${s.chapters.length} · вопросы: ${c.mastered}/${c.total}${c.due ? ` · пора повторить ${c.due}` : ''}</div>
      <div class="meter"><i style="width:${c.total ? Math.round(100 * c.mastered / c.total) : 0}%"></i></div>
    </a></li>`;
  }
  view.innerHTML = html + '</ul>';
}

function sectionView(id) {
  const s = section(id);
  if (!s) return go('#/');
  setTitle(s.title);
  const read = state.read[s.id] || {};
  const c = counts(questionsOf(s.id));
  let html = `<a class="btn wide" href="#/q/${s.id}">Квиз по разделу${c.due ? ` · пора повторить ${c.due}` : ''}</a>`;
  html += `<p class="muted">Вопросов: ${c.total}, выучено ${c.mastered}, новых ${c.fresh}</p><ul class="list">`;
  s.chapters.forEach((ch, i) => {
    const qc = counts(questionsOf(s.id, ch.id));
    html += `<li><a class="card${read[ch.id] ? ' done' : ''}" href="#/s/${s.id}/c/${ch.id}">
      <div>${i + 1}. ${esc(ch.title)}${read[ch.id] ? ' ✓' : ''}</div>
      <div class="sub">${qc.total ? `вопросов ${qc.total}, выучено ${qc.mastered}` : 'без вопросов'}</div>
    </a></li>`;
  });
  view.innerHTML = html + '</ul>';
}

let scrollTimer = null;

function chapterView(sectionId, chapterId) {
  const s = section(sectionId);
  const index = s ? s.chapters.findIndex(c => c.id === chapterId) : -1;
  if (index < 0) return go('#/');
  const ch = s.chapters[index];
  const key = `${s.id}/${ch.id}`;
  setTitle(ch.title);
  const read = (state.read[s.id] || {})[ch.id];
  const prev = s.chapters[index - 1];
  const next = s.chapters[index + 1];
  const qc = questionsOf(s.id, ch.id).length;

  view.innerHTML = `
    <h2>${index + 1}. ${esc(ch.title)}</h2>
    <article class="theory">${ch.html}</article>
    <button class="btn wide ${read ? 'ghost' : ''}" id="mark">${read ? 'Прочитано ✓' : 'Отметить прочитанной'}</button>
    ${qc ? `<a class="btn wide ghost" href="#/q/${s.id}/${ch.id}">Квиз по главе (${qc})</a>` : ''}
    <div class="pager">
      ${prev ? `<a class="btn ghost" href="#/s/${s.id}/c/${prev.id}">‹ Назад</a>` : '<span></span>'}
      ${next ? `<a class="btn ghost" href="#/s/${s.id}/c/${next.id}">Дальше ›</a>` : '<span></span>'}
    </div>`;

  document.getElementById('mark').onclick = () => {
    state.read[s.id] = state.read[s.id] || {};
    state.read[s.id][ch.id] = !state.read[s.id][ch.id];
    save();
    chapterView(sectionId, chapterId);
  };

  const saved = state.pos[key];
  if (saved) requestAnimationFrame(() => window.scrollTo(0, saved));
  window.onscroll = () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      if (!location.hash.endsWith('/c/' + ch.id)) return;
      state.pos[key] = Math.round(window.scrollY);
      save();
    }, 400);
  };
}

// ---------- quiz ----------

function quizStart(sectionId, chapterId) {
  window.onscroll = null;
  const all = sectionId === 'all' || !sectionId;
  const pool = questionsOf(all ? null : sectionId, chapterId);
  const s = all ? null : section(sectionId);
  const label = all ? 'Все разделы' : chapterId ? s?.chapters.find(c => c.id === chapterId)?.title : s?.title;
  setTitle('Квиз · ' + (label || ''));

  if (!pool.length) {
    view.innerHTML = `<p class="muted">Здесь пока нет вопросов.</p>`;
    return;
  }

  const now = Date.now();
  const due = shuffle(pool.filter(q => isDue(q, now)));
  const fresh = shuffle(pool.filter(q => !state.cards[q.id]));
  let picked = due.concat(fresh).slice(0, SESSION_SIZE);

  if (!picked.length) {
    view.innerHTML = `
      <p>Всё, что здесь есть, уже повторено — следующее подойдёт позже.</p>
      <button class="btn wide" id="anyway">Пройти всё равно (${Math.min(SESSION_SIZE, pool.length)})</button>`;
    document.getElementById('anyway').onclick = () => {
      const items = shuffle(pool).slice(0, SESSION_SIZE);
      session = { items, i: 0, right: 0, retry: [], firstPass: items.length };
      showQuestion();
    };
    return;
  }

  session = { items: picked, i: 0, right: 0, retry: [], firstPass: picked.length };
  showQuestion();
}

function showQuestion() {
  window.scrollTo(0, 0);
  if (session.i >= session.items.length) {
    if (session.retry.length) {
      // What was missed comes round once more before the session ends
      session.items = session.items.concat(session.retry);
      session.retry = [];
      session.repeating = true;
    } else return finish();
  }
  const q = session.items[session.i];
  const s = section(q.section);
  const chapter = s?.chapters.find(c => c.id === q.chapter);
  const progress = `<div class="progress">${session.i + 1} из ${session.items.length}${session.repeating && session.i >= session.firstPass ? ' · повтор' : ''} · ${esc(s?.title || '')}${chapter ? ' · ' + esc(chapter.title) : ''}</div>`;

  if (q.type === 'choice') {
    const order = shuffle(q.options.map((text, index) => ({ text, index })));
    view.innerHTML = `${progress}<div class="q">
      <div class="kind">Выберите ответ</div>
      <div class="theory">${q.q}</div>
      <div id="opts">${order.map(o => `<button class="opt" data-i="${o.index}">${o.text}</button>`).join('')}</div>
      <div id="after"></div></div>`;
    view.querySelectorAll('.opt').forEach(btn => btn.onclick = () => {
      const chosen = Number(btn.dataset.i);
      const right = chosen === q.answer;
      view.querySelectorAll('.opt').forEach(b => {
        b.disabled = true;
        if (Number(b.dataset.i) === q.answer) b.classList.add('right');
        else if (b === btn) b.classList.add('wrong');
      });
      if (!session.graded?.[q.id]) {
        grade(q, right ? boxOf(q) + 1 : 0, right);
        session.graded = Object.assign(session.graded || {}, { [q.id]: true });
        if (right) session.right++; else session.retry.push(q);
      }
      document.getElementById('after').innerHTML = `
        <div class="verdict ${right ? 'right' : 'wrong'}">${right ? 'Верно' : 'Неверно'}</div>
        ${q.explain ? `<div class="answer theory">${q.explain}</div>` : ''}
        <button class="btn wide" id="next">Дальше</button>`;
      document.getElementById('next').onclick = nextQuestion;
    });
  } else {
    view.innerHTML = `${progress}<div class="q">
      <div class="kind">Ответьте вслух, затем сверьтесь</div>
      <div class="theory">${q.q}</div>
      <div id="after"><button class="btn wide" id="reveal">Показать ответ</button></div></div>`;
    document.getElementById('reveal').onclick = () => {
      document.getElementById('after').innerHTML = `
        <div class="answer theory">${q.answer}</div>
        <p class="muted">Как получилось?</p>
        <div class="row">
          <button class="btn ghost" data-g="0">Не вспомнил</button>
          <button class="btn ghost" data-g="1">Частично</button>
          <button class="btn" data-g="2">Знал</button>
        </div>`;
      view.querySelectorAll('[data-g]').forEach(btn => btn.onclick = () => {
        const g = Number(btn.dataset.g);
        if (!session.graded?.[q.id]) {
          const box = boxOf(q);
          grade(q, g === 0 ? 0 : g === 1 ? Math.max(1, box) : box + 1, g === 2);
          session.graded = Object.assign(session.graded || {}, { [q.id]: true });
          if (g === 2) session.right++;
          if (g === 0) session.retry.push(q);
        }
        nextQuestion();
      });
    };
  }
}

function nextQuestion() {
  session.i++;
  showQuestion();
}

function finish() {
  const total = Object.keys(session.graded || {}).length;
  view.innerHTML = `
    <h2>Готово</h2>
    <p>Без ошибок: ${session.right} из ${total}.</p>
    <p class="muted">Ошибки вернутся раньше остальных: через несколько минут, затем через день, три, неделю и дальше по мере того, как вы их запоминаете.</p>
    <button class="btn wide" onclick="history.back()">Вернуться</button>`;
  session = null;
}

// ---------- settings ----------

function settingsView() {
  window.onscroll = null;
  setTitle('Настройки');
  const all = counts(questionsOf());
  const readTotal = SECTIONS.reduce((n, s) => n + readCount(s), 0);
  const chapterTotal = SECTIONS.reduce((n, s) => n + s.chapters.length, 0);
  view.innerHTML = `
    <h2>Размер текста</h2>
    <div class="row">
      <button class="btn ghost" id="smaller">A−</button>
      <button class="btn ghost" id="bigger">A+</button>
    </div>
    <h2>Прогресс</h2>
    <div class="stat"><span>Прочитано глав</span><span>${readTotal} из ${chapterTotal}</span></div>
    <div class="stat"><span>Вопросов выучено</span><span>${all.mastered} из ${all.total}</span></div>
    <div class="stat"><span>Пора повторить</span><span>${all.due}</span></div>
    <h2>Сохранить прогресс</h2>
    <p class="muted">Прогресс хранится только на этом телефоне. Скопируйте его и сохраните в Заметках — если iOS когда-нибудь очистит данные, его можно будет вставить обратно.</p>
    <button class="btn wide ghost" id="export">Скопировать прогресс</button>
    <textarea id="data" placeholder="Вставьте сюда сохранённый прогресс"></textarea>
    <button class="btn wide ghost" id="import">Восстановить из вставленного</button>
    <h2>Сброс</h2>
    <button class="btn wide ghost" id="reset">Сбросить весь прогресс</button>`;

  document.getElementById('smaller').onclick = () => { state.size = Math.max(14, state.size - 1); applySize(); save(); };
  document.getElementById('bigger').onclick = () => { state.size = Math.min(24, state.size + 1); applySize(); save(); };
  document.getElementById('export').onclick = async () => {
    const json = JSON.stringify(state);
    document.getElementById('data').value = json;
    try { await navigator.clipboard.writeText(json); alert('Скопировано'); } catch { alert('Выделите текст в поле ниже и скопируйте'); }
  };
  document.getElementById('import').onclick = () => {
    try {
      const parsed = JSON.parse(document.getElementById('data').value);
      if (!parsed || typeof parsed.cards !== 'object') throw new Error();
      state = Object.assign({ read: {}, cards: {}, pos: {}, size: 17 }, parsed);
      save(); applySize(); alert('Прогресс восстановлен'); go('#/');
    } catch { alert('Это не похоже на сохранённый прогресс'); }
  };
  document.getElementById('reset').onclick = () => {
    if (!confirm('Сбросить прочитанные главы и все ответы?')) return;
    state = { read: {}, cards: {}, pos: {}, size: state.size };
    save(); go('#/');
  };
}

// ---------- start ----------

document.getElementById('settings').onclick = () => go('#/settings');
window.addEventListener('hashchange', route);
applySize();
route();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    updateReady = true;
    if (!location.hash || location.hash === '#/') homeView();
  });
}
