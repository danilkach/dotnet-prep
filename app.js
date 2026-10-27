'use strict';

const SECTIONS = (window.PREP || []).filter(s => s && Array.isArray(s.chapters));
// Private sections arrive encrypted and join SECTIONS once their passphrase has been entered on this device
const LOCKED = (window.PREP_LOCKED || []).filter(s => s && s.data);
const KEYS = 'prep.keys';
const KEY = 'prep.v1';
const DAY = 24 * 60 * 60 * 1000;
// Days until a card is due again, by box: box 0 comes back within the hour
const INTERVALS = [0, 1, 3, 7, 16, 35];
const SESSION_SIZE = 15;
const MASTERED_BOX = 3;
// A page longer than this is split again at its subheadings, so one page stays one idea
const PAGE_TEXT_LIMIT = 2600;

const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('back');

let state = load();
let session = null;
let updateReady = false;

function fresh() { return { read: {}, seen: {}, at: {}, cards: {}, size: 17, wrap: true }; }

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? Object.assign(fresh(), JSON.parse(raw)) : fresh();
  } catch {
    return fresh();
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked: progress just isn't kept */ }
}

function applySettings() {
  document.documentElement.style.setProperty('--size', state.size + 'px');
  document.body.classList.toggle('wrap-code', state.wrap !== false);
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const textLength = html => html.replace(/<[^>]+>/g, '').length;

function section(id) { return SECTIONS.find(s => s.id === id); }

function questionsOf(sectionId, chapterId) {
  return SECTIONS
    .filter(s => !sectionId || s.id === sectionId)
    .flatMap(s => s.questions.map(q => Object.assign({ section: s.id }, q)))
    .filter(q => !chapterId || q.chapter === chapterId);
}

// ---------- pages ----------

const pageCache = new Map();

// A chapter read one sub-topic at a time: each <h3> starts a page, and a page still too long to take in at
// once is split again at its <h4>s, carrying its title along so the page says what it continues
function pagesOf(chapter) {
  if (pageCache.has(chapter)) return pageCache.get(chapter);
  const parts = chapter.html.split(/(?=<h3[\s>])/).filter(part => part.trim());
  if (parts.length > 1 && !/^\s*<h3/.test(parts[0])) parts.splice(0, 2, parts[0] + parts[1]);

  const pages = [];
  for (const part of parts) {
    const title = (part.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || chapter.title;
    if (textLength(part) <= PAGE_TEXT_LIMIT || !/<h4[\s>]/.test(part)) {
      pages.push({ title, html: part });
      continue;
    }
    const pieces = part.split(/(?=<h4[\s>])/);
    let current = pieces.shift();
    for (const piece of pieces) {
      if (textLength(current) + textLength(piece) > PAGE_TEXT_LIMIT && textLength(current) > 600) {
        pages.push({ title, html: current });
        current = `<p class="cont">${title} — продолжение</p>` + piece;
      } else current += piece;
    }
    pages.push({ title, html: current });
  }
  pageCache.set(chapter, pages);
  return pages;
}

function seenOf(sectionId, chapterId) {
  const key = `${sectionId}/${chapterId}`;
  return (state.seen[key] = state.seen[key] || []);
}

function chapterRead(sectionId, chapter) {
  return !!(state.read[sectionId] || {})[chapter.id];
}

function readCount(s) { return s.chapters.filter(c => chapterRead(s.id, c)).length; }

// ---------- cards ----------

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
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const find = new URLSearchParams(query || '').get('find');
  backBtn.hidden = parts.length === 0;
  backBtn.onclick = () => find || parts[0] === 'one' ? history.back() : go(parent(parts));
  window.scrollTo(0, 0);
  swipe = null;

  if (parts[0] === 's' && parts[2] === 'c') {
    pageView(parts[1], parts[3], parts[4]);
    if (find) markFound(find);
    return;
  }
  if (parts[0] === 'one') return oneQuestionView(parts[1]);
  if (parts[0] === 'unlock') return unlockView(parts[1]);
  if (parts[0] === 's') return sectionView(parts[1]);
  if (parts[0] === 'q') return quizStart(parts[1], parts[2]);
  if (parts[0] === 'settings') return settingsView();
  return homeView();
}

function setTitle(text) {
  titleEl.textContent = text;
  document.title = text;
}

function render(html) {
  view.innerHTML = html;
  window.highlightCode?.(view);
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
  html += `<input type="search" id="search" class="search" placeholder="Поиск по теории и вопросам" autocomplete="off" value="${esc(lastQuery)}">
    <div id="results"></div><div id="home-rest">`;
  html += `<a class="btn wide" href="#/q/all">${all.due ? `Повторить то, что пора (${all.due})` : 'Квиз по всем разделам'}</a>`;
  html += `<p class="muted">Выучено ${all.mastered} из ${all.total} вопросов</p><ul class="list">`;
  for (const s of SECTIONS) {
    const c = counts(questionsOf(s.id));
    html += `<li><a class="card" href="#/s/${s.id}">
      <div><strong>${esc(s.title)}</strong></div>
      <div class="sub">Прочитано глав: ${readCount(s)} из ${s.chapters.length} · вопросы: ${c.mastered}/${c.total}${c.due ? ` · пора повторить ${c.due}` : ''}</div>
      <div class="meter"><i style="width:${c.total ? Math.round(100 * c.mastered / c.total) : 0}%"></i></div>
    </a></li>`;
  }
  for (const locked of LOCKED.filter(l => !section(l.id)))
    html += `<li><a class="card" href="#/unlock/${locked.id}">
      <div><strong>🔒 ${esc(locked.title)}</strong></div>
      <div class="sub">Закрыто паролем — нажмите, чтобы открыть</div>
    </a></li>`;
  render(html + '</ul></div>');

  const input = document.getElementById('search');
  let timer = null;
  input.oninput = () => { clearTimeout(timer); timer = setTimeout(() => showResults(input.value), 200); };
  if (lastQuery) showResults(lastQuery);
}

// ---------- search ----------

let lastQuery = '';
let searchIndex = null;

const normalize = s => s.toLowerCase().replace(/ё/g, 'е');

function plainText(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent.replace(/\s+/g, ' ').trim();
}

// Built once, the first time somebody searches: every page of every chapter, and every quiz question with
// its answer, as plain text
function buildIndex() {
  const entries = [];
  for (const s of SECTIONS) {
    s.chapters.forEach((ch, ci) => pagesOf(ch).forEach((page, pi) => {
      const text = plainText(page.html);
      entries.push({ kind: 'page', href: `#/s/${s.id}/c/${ch.id}/${pi}`, where: `${s.title} · ${ci + 1}. ${ch.title}`, title: plainText(page.title), text, norm: normalize(text) });
    }));
    for (const q of s.questions) {
      const text = plainText([q.q, ...(q.options || []), q.explain || '', q.type === 'open' ? q.answer : ''].join(' '));
      const chapter = s.chapters.find(c => c.id === q.chapter);
      entries.push({ kind: 'question', href: `#/one/${q.id}`, where: `${s.title} · вопрос${chapter ? ' · ' + chapter.title : ''}`, title: plainText(q.q).slice(0, 140), text, norm: normalize(text) });
    }
  }
  return entries;
}

function snippet(entry, words) {
  const at = Math.max(0, entry.norm.indexOf(words[0]));
  const start = Math.max(0, at - 60);
  let text = (start > 0 ? '…' : '') + entry.text.slice(start, at + 140) + (at + 140 < entry.text.length ? '…' : '');
  let html = esc(text);
  for (const word of words) {
    const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/е/g, '[её]'), 'gi');
    html = html.replace(re, m => `<mark>${m}</mark>`);
  }
  return html;
}

function showResults(query) {
  lastQuery = query;
  const results = document.getElementById('results');
  const rest = document.getElementById('home-rest');
  const words = normalize(query).split(/\s+/).filter(w => w.length > 1);
  if (!words.length) { results.innerHTML = ''; rest.hidden = false; return; }
  searchIndex = searchIndex || buildIndex();
  const found = searchIndex.filter(e => words.every(w => e.norm.includes(w)));
  // Pages whose title matches come first, then pages, then questions
  found.sort((a, b) => score(b, words) - score(a, words));
  rest.hidden = true;
  const find = encodeURIComponent(query.trim());
  results.innerHTML = found.length
    ? `<p class="muted">Найдено: ${found.length}${found.length > 60 ? ', показаны первые 60' : ''}</p><ul class="list">` +
      found.slice(0, 60).map(e => `<li><a class="card" href="${e.href}${e.kind === 'page' ? `?find=${find}` : ''}">
        <div class="sub">${esc(e.where)}</div>
        <div><strong>${esc(e.title)}</strong></div>
        <div class="sub">${snippet(e, words)}</div></a></li>`).join('') + '</ul>'
    : `<p class="muted">Ничего не найдено</p>`;
}

function score(entry, words) {
  const title = normalize(entry.title);
  return (words.every(w => title.includes(w)) ? 10 : 0) + (entry.kind === 'page' ? 2 : 0);
}

// On a page opened from a search, the words are marked, a collapsed answer containing them is opened, and
// the first of them is scrolled to
function markFound(query) {
  const words = normalize(query).split(/\s+/).filter(w => w.length > 1);
  const article = view.querySelector('.theory.page');
  if (!article || !words.length) return;
  article.querySelectorAll('details').forEach(d => {
    if (words.some(w => normalize(d.textContent).includes(w))) d.open = true;
  });
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const re = new RegExp('(' + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/е/g, '[её]')).join('|') + ')', 'gi');
  for (const node of nodes) {
    if (!re.test(node.nodeValue)) continue;
    re.lastIndex = 0;
    const span = document.createElement('span');
    span.innerHTML = esc(node.nodeValue).replace(re, '<mark>$1</mark>');
    node.replaceWith(span);
  }
  article.querySelector('mark')?.scrollIntoView({ block: 'center' });
}

function oneQuestionView(id) {
  const q = questionsOf().find(x => x.id === id);
  if (!q) return go('#/');
  const s = section(q.section);
  setTitle('Вопрос');
  render(`<div class="progress">${esc(s?.title || '')}</div><div class="q">
    <div class="theory">${q.q}</div>
    ${q.type === 'choice'
      ? q.options.map((o, i) => `<div class="opt ${i === q.answer ? 'right' : ''}">${o}</div>`).join('') +
        (q.explain ? `<div class="answer theory">${q.explain}</div>` : '')
      : `<div class="answer theory">${q.answer}</div>`}
  </div>`);
}

function sectionView(id) {
  const s = section(id);
  if (!s) return go('#/');
  setTitle(s.title);
  const c = counts(questionsOf(s.id));
  let html = `<a class="btn wide" href="#/q/${s.id}">Квиз по разделу${c.due ? ` · пора повторить ${c.due}` : ''}</a>`;
  html += `<p class="muted">Вопросов: ${c.total}, выучено ${c.mastered}, новых ${c.fresh}</p><ul class="list">`;
  s.chapters.forEach((ch, i) => {
    const pages = pagesOf(ch).length;
    const seen = seenOf(s.id, ch.id).filter(Boolean).length;
    const read = chapterRead(s.id, ch);
    const qc = counts(questionsOf(s.id, ch.id));
    const at = state.at[`${s.id}/${ch.id}`] || 0;
    html += `<li><a class="card${read ? ' done' : ''}" href="#/s/${s.id}/c/${ch.id}/${read ? 0 : at}">
      <div>${i + 1}. ${esc(ch.title)}${read ? ' ✓' : ''}</div>
      <div class="sub">страниц ${pages}${seen && !read ? `, прочитано ${seen}` : ''} · ${qc.total ? `вопросов ${qc.total}, выучено ${qc.mastered}` : 'без вопросов'}</div>
    </a></li>`;
  });
  html += `</ul><button class="btn wide ghost" id="reset">Сбросить прогресс раздела</button>`;
  render(html);

  document.getElementById('reset').onclick = () => {
    if (!confirm(`Сбросить прочитанное и ответы в разделе «${s.title}»?`)) return;
    resetSection(s);
    sectionView(id);
  };
}

function resetSection(s) {
  delete state.read[s.id];
  for (const ch of s.chapters) {
    delete state.seen[`${s.id}/${ch.id}`];
    delete state.at[`${s.id}/${ch.id}`];
  }
  for (const q of s.questions) delete state.cards[q.id];
  save();
}

let swipe = null;

function pageView(sectionId, chapterId, pageArg) {
  const s = section(sectionId);
  const index = s ? s.chapters.findIndex(c => c.id === chapterId) : -1;
  if (index < 0) return go('#/');
  const ch = s.chapters[index];
  const pages = pagesOf(ch);
  const page = Math.max(0, Math.min(pages.length - 1, Number(pageArg) || 0));
  const key = `${s.id}/${ch.id}`;

  const seen = seenOf(s.id, ch.id);
  seen[page] = true;
  state.at[key] = page;
  if (pages.every((_, i) => seen[i])) {
    state.read[s.id] = state.read[s.id] || {};
    state.read[s.id][ch.id] = true;
  }
  save();

  setTitle(ch.title);
  const nextChapter = s.chapters[index + 1];
  // A chapter's first page has nothing before it: the previous chapter is chosen from the list, not swiped into
  const prevHref = page > 0 ? `#/s/${s.id}/c/${ch.id}/${page - 1}` : null;
  const nextHref = page < pages.length - 1 ? `#/s/${s.id}/c/${ch.id}/${page + 1}`
    : nextChapter ? `#/s/${s.id}/c/${nextChapter.id}/0` : null;
  const last = page === pages.length - 1;
  const qc = questionsOf(s.id, ch.id).length;

  const chain = pages.map((_, i) =>
    `<a class="${i === page ? 'now' : seen[i] ? 'seen' : ''}" href="#/s/${s.id}/c/${ch.id}/${i}" aria-label="Страница ${i + 1}"></a>`).join('');

  render(`
    <div class="chain">${chain}</div>
    <div class="where">Глава ${index + 1} из ${s.chapters.length} · страница ${page + 1} из ${pages.length}</div>
    <article class="theory page">${pages[page].html}</article>
    ${last && qc ? `<a class="btn wide" href="#/q/${s.id}/${ch.id}">Квиз по главе (${qc})</a>` : ''}
    <div class="pager">
      ${prevHref ? `<a class="btn ghost" href="${prevHref}">‹ Назад</a>` : `<a class="btn ghost" href="#/s/${s.id}">‹ К главам</a>`}
      ${nextHref ? `<a class="btn ${last ? 'ghost' : ''}" href="${nextHref}">${last ? 'Следующая глава ›' : 'Дальше ›'}</a>` : `<a class="btn ghost" href="#/s/${s.id}">К разделу</a>`}
    </div>`);

  swipe = { prev: prevHref, next: nextHref };
}

// Swiping a page sideways turns it, but only a clearly horizontal gesture that started outside a code block,
// since code scrolls sideways itself
let touch = null;
document.addEventListener('touchstart', e => {
  if (!swipe || e.touches.length !== 1 || e.target.closest('pre, table')) { touch = null; return; }
  touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
}, { passive: true });
document.addEventListener('touchend', e => {
  if (!touch || !swipe) return;
  const dx = e.changedTouches[0].clientX - touch.x;
  const dy = e.changedTouches[0].clientY - touch.y;
  const quick = Date.now() - touch.t < 700;
  touch = null;
  if (!quick || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
  const target = dx < 0 ? swipe.next : swipe.prev;
  if (target) go(target);
}, { passive: true });

// ---------- quiz ----------

function quizStart(sectionId, chapterId) {
  const all = sectionId === 'all' || !sectionId;
  const pool = questionsOf(all ? null : sectionId, chapterId);
  const s = all ? null : section(sectionId);
  const label = all ? 'Все разделы' : chapterId ? s?.chapters.find(c => c.id === chapterId)?.title : s?.title;
  setTitle('Квиз · ' + (label || ''));

  if (!pool.length) {
    render(`<p class="muted">Здесь пока нет вопросов.</p>`);
    return;
  }

  const now = Date.now();
  const due = shuffle(pool.filter(q => isDue(q, now)));
  const unseen = shuffle(pool.filter(q => !state.cards[q.id]));
  const picked = due.concat(unseen).slice(0, SESSION_SIZE);

  if (!picked.length) {
    render(`
      <p>Всё, что здесь есть, уже повторено — следующее подойдёт позже.</p>
      <button class="btn wide" id="anyway">Пройти всё равно (${Math.min(SESSION_SIZE, pool.length)})</button>`);
    document.getElementById('anyway').onclick = () => startSession(shuffle(pool).slice(0, SESSION_SIZE));
    return;
  }

  startSession(picked);
}

function startSession(items) {
  session = { items, i: 0, right: 0, retry: [], firstPass: items.length, graded: {} };
  showQuestion();
}

function showQuestion() {
  window.scrollTo(0, 0);
  if (session.i >= session.items.length) {
    if (!session.retry.length) return finish();
    // What was missed comes round once more before the session ends
    session.items = session.items.concat(shuffle(session.retry));
    session.retry = [];
  }
  const q = session.items[session.i];
  const s = section(q.section);
  const chapter = s?.chapters.find(c => c.id === q.chapter);
  const progress = `<div class="progress">${session.i + 1} из ${session.items.length}${session.i >= session.firstPass ? ' · повтор' : ''} · ${esc(s?.title || '')}${chapter ? ' · ' + esc(chapter.title) : ''}</div>`;

  if (q.type === 'choice') {
    // Options are shuffled every time a question is shown, so the right one is never remembered by its place
    const order = shuffle(q.options.map((text, index) => ({ text, index })));
    render(`${progress}<div class="q">
      <div class="kind">Выберите ответ</div>
      <div class="theory">${q.q}</div>
      <div id="opts">${order.map(o => `<button class="opt" data-i="${o.index}">${o.text}</button>`).join('')}</div>
      <div id="after"></div></div>`);
    view.querySelectorAll('.opt').forEach(btn => btn.onclick = () => {
      const right = Number(btn.dataset.i) === q.answer;
      view.querySelectorAll('.opt').forEach(b => {
        b.disabled = true;
        if (Number(b.dataset.i) === q.answer) b.classList.add('right');
        else if (b === btn) b.classList.add('wrong');
      });
      if (!session.graded[q.id]) {
        grade(q, right ? boxOf(q) + 1 : 0, right);
        session.graded[q.id] = true;
        if (right) session.right++; else session.retry.push(q);
      }
      const after = document.getElementById('after');
      after.innerHTML = `
        <div class="verdict ${right ? 'right' : 'wrong'}">${right ? 'Верно' : 'Неверно'}</div>
        ${q.explain ? `<div class="answer theory">${q.explain}</div>` : ''}
        <button class="btn wide" id="next">Дальше</button>`;
      window.highlightCode?.(after);
      document.getElementById('next').onclick = nextQuestion;
    });
  } else {
    render(`${progress}<div class="q">
      <div class="kind">Ответьте вслух, затем сверьтесь</div>
      <div class="theory">${q.q}</div>
      <div id="after"><button class="btn wide" id="reveal">Показать ответ</button></div></div>`);
    document.getElementById('reveal').onclick = () => {
      const after = document.getElementById('after');
      after.innerHTML = `
        <div class="answer theory">${q.answer}</div>
        <p class="muted">Как получилось?</p>
        <div class="row">
          <button class="btn ghost" data-g="0">Не вспомнил</button>
          <button class="btn ghost" data-g="1">Частично</button>
          <button class="btn" data-g="2">Знал</button>
        </div>`;
      window.highlightCode?.(after);
      view.querySelectorAll('[data-g]').forEach(btn => btn.onclick = () => {
        const g = Number(btn.dataset.g);
        if (!session.graded[q.id]) {
          const box = boxOf(q);
          grade(q, g === 0 ? 0 : g === 1 ? Math.max(1, box) : box + 1, g === 2);
          session.graded[q.id] = true;
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
  const total = Object.keys(session.graded).length;
  render(`
    <h2>Готово</h2>
    <p>Без ошибок: ${session.right} из ${total}.</p>
    <p class="muted">Ошибки вернутся раньше остальных: через несколько минут, затем через день, три, неделю и дальше по мере того, как вы их запоминаете.</p>
    <button class="btn wide" onclick="history.back()">Вернуться</button>`);
  session = null;
}

// ---------- private sections ----------

const fromBase64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const toBase64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));

function savedKeys() {
  try { return JSON.parse(localStorage.getItem(KEYS)) || {}; } catch { return {}; }
}

async function deriveKey(locked, passphrase) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromBase64(locked.salt), iterations: locked.iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
}

// A wrong key fails the AES-GCM tag check and throws, so success means the passphrase was right
async function open(locked, key) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(locked.iv) }, key, fromBase64(locked.data));
  const opened = JSON.parse(new TextDecoder().decode(plain));
  if (!section(opened.id)) SECTIONS.push(opened);
  searchIndex = null;
}

// Sections unlocked before are opened with the key this device kept, without asking again
async function openSaved() {
  const keys = savedKeys();
  for (const locked of LOCKED) {
    if (!keys[locked.id] || section(locked.id)) continue;
    try {
      const key = await crypto.subtle.importKey('raw', fromBase64(keys[locked.id]), 'AES-GCM', false, ['decrypt']);
      await open(locked, key);
    } catch {
      delete keys[locked.id];
      localStorage.setItem(KEYS, JSON.stringify(keys));
    }
  }
}

function unlockView(id) {
  const locked = LOCKED.find(l => l.id === id);
  if (!locked) return go('#/');
  if (section(id)) return go('#/s/' + id);
  setTitle(locked.title);
  render(`
    <p>Этот раздел зашифрован. Введите пароль — на этом устройстве он запомнится.</p>
    <input type="password" id="pass" class="search" autocomplete="current-password" autocapitalize="off" autocorrect="off">
    <button class="btn wide" id="unlock">Открыть</button>
    <p class="muted" id="status"></p>`);
  const input = document.getElementById('pass');
  const status = document.getElementById('status');
  const submit = async () => {
    if (!input.value) { status.textContent = 'Введите пароль'; return; }
    status.textContent = 'Проверяю…';
    try {
      const key = await deriveKey(locked, input.value.trim());
      await open(locked, key);
      const keys = savedKeys();
      keys[id] = toBase64(await crypto.subtle.exportKey('raw', key));
      try { localStorage.setItem(KEYS, JSON.stringify(keys)); } catch { /* opens this time, asks again next time */ }
      go('#/s/' + id);
    } catch {
      status.textContent = 'Пароль не подошёл';
    }
  };
  document.getElementById('unlock').onclick = submit;
  input.onkeydown = e => { if (e.key === 'Enter') submit(); };
  input.focus();
}

// ---------- settings ----------

function settingsView() {
  setTitle('Настройки');
  const all = counts(questionsOf());
  const readTotal = SECTIONS.reduce((n, s) => n + readCount(s), 0);
  const chapterTotal = SECTIONS.reduce((n, s) => n + s.chapters.length, 0);
  render(`
    <h2>Текст</h2>
    <div class="row">
      <button class="btn ghost" id="smaller">A−</button>
      <button class="btn ghost" id="bigger">A+</button>
    </div>
    <button class="btn wide ghost" id="wrap">${state.wrap !== false ? 'Код: переносить длинные строки ✓' : 'Код: прокручивать вбок'}</button>
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
    <p class="muted">Прогресс одного раздела сбрасывается на странице этого раздела.</p>
    <button class="btn wide ghost" id="reset">Сбросить весь прогресс</button>`);

  document.getElementById('smaller').onclick = () => { state.size = Math.max(14, state.size - 1); applySettings(); save(); };
  document.getElementById('bigger').onclick = () => { state.size = Math.min(24, state.size + 1); applySettings(); save(); };
  document.getElementById('wrap').onclick = () => { state.wrap = state.wrap === false; applySettings(); save(); settingsView(); };
  document.getElementById('export').onclick = async () => {
    const json = JSON.stringify(state);
    document.getElementById('data').value = json;
    try { await navigator.clipboard.writeText(json); alert('Скопировано'); } catch { alert('Выделите текст в поле ниже и скопируйте'); }
  };
  document.getElementById('import').onclick = () => {
    try {
      const parsed = JSON.parse(document.getElementById('data').value);
      if (!parsed || typeof parsed.cards !== 'object') throw new Error();
      state = Object.assign(fresh(), parsed);
      save(); applySettings(); alert('Прогресс восстановлен'); go('#/');
    } catch { alert('Это не похоже на сохранённый прогресс'); }
  };
  document.getElementById('reset').onclick = () => {
    if (!confirm('Сбросить прочитанные главы и все ответы во всех разделах?')) return;
    state = Object.assign(fresh(), { size: state.size, wrap: state.wrap });
    save(); go('#/');
  };
}

// ---------- start ----------

document.getElementById('settings').onclick = () => go('#/settings');
window.addEventListener('hashchange', route);
applySettings();
openSaved().finally(route);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    updateReady = true;
    if (!location.hash || location.hash === '#/') homeView();
  });
}
