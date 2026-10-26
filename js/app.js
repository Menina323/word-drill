/**
 * app.js — UI shell for Word Drill.
 *
 * Vanilla ES modules, no build step, no external requests. All persistent state
 * is in IndexedDB through store.js.
 */

import {
  ACTIVE_GROUPS,
  DEFAULT_SETTINGS,
  GROUP_DESC,
  GROUP_INFO,
  REVEAL_SPEEDS,
  buildNewQueue,
  buildReviewQueue,
  answerKnown,
  answerTooEasy,
  answerUnknown,
  formatDueLabel,
  getDueWords,
  getStats,
  groupBreakdown,
  isDue,
  localDateKey,
  selectEGate,
} from './scheduler.js';
import { sanitizeSettings, wordStore } from './store.js';
import { parseCsvText, parseJsonText, parseVocabularyText, guessImportKind } from './seed.js';
import { speech } from './speech.js';
import { notifier } from './notify.js';

/* ------------------------------------------------------------------ icons */

const ICON_PATHS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  settings:
    '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  import:
    '<path d="M12 16V4m0 0 5 5m-5-5L7 9"/><path d="M5 20h14"/>',
  download:
    '<path d="M12 4v12m0 0 5-5m-5 5-5-5"/><path d="M5 20h14"/>',
  speaker:
    '<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/>',
  bell:
    '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  check: '<path d="M5 12l4 4L19 6"/>',
  spark:
    '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z"/>',
  calendar:
    '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  lock:
    '<rect x="5" y="10" width="14" height="10" rx="3"/><path d="M8 10V8a4 4 0 0 1 8 0v2"/>',
  trash:
    '<path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/><path d="M10 11v5M14 11v5"/>',
  refresh:
    '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  book:
    '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/>',
  wave: '<path d="M3 15c3-6 6-6 9 0s6 6 9 0"/><path d="M3 9c3-6 6-6 9 0s6 6 9 0" opacity=".45"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  layers:
    '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5M3 16l9 5 9-5"/>',
  shield:
    '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/>',
};

function icon(name, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
    ICON_PATHS[name] ?? ''
  }</svg>`;
}

function brandMark() {
  return `<svg class="brand-mark" viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <circle cx="20" cy="20" r="18.4" stroke="currentColor" stroke-opacity=".35"/>
    <path d="M8.5 22c3.6-7.4 7.2-7.4 10.8 0s7.2 7.4 10.8 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M11.5 15.2c3-5.6 5.9-5.6 8.9 0s5.9 5.6 8.9 0" stroke="currentColor" stroke-opacity=".45" stroke-width="1.4" stroke-linecap="round"/>
  </svg>`;
}

/* ------------------------------------------------------------------ utils */

const root = document.getElementById('root');
const toastEl = document.getElementById('toast');

const state = {
  ready: false,
  fatal: null,
  words: [],
  wordMap: new Map(),
  settings: { ...DEFAULT_SETTINGS },
  eGate: { date: localDateKey(), ids: [] },
  stats: { total: 0, newCount: 0, reviewCount: 0, dueCount: 0, missingPhonetic: 0 },
  route: 'home',
  session: null,
  busy: false,
  busyLabel: '',
  importTab: 'cet6',
  importText: '',
  importFileName: '',
  importError: '',
  importResult: null,
  backfillText: '',
  backfillFileName: '',
  backfillOverwrite: false,
  backfillResult: null,
  scrollTarget: '',
  persisted: false,
  reveal: null,
  revealTimer: null,
};

let toastTimer = null;
let pendingReview = false;
const darkQuery =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

function resolvedTheme(theme = state.settings.theme) {
  if (theme === 'dark' || theme === 'light') return theme;
  return darkQuery?.matches ? 'dark' : 'light';
}

function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  let meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = theme === 'dark' ? '#071114' : '#f4f0e6';
}

darkQuery?.addEventListener?.('change', () => {
  if (state.settings.theme === 'auto') applyTheme();
});

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    if (char === '&') return '&amp;';
    if (char === '<') return '&lt;';
    if (char === '>') return '&gt;';
    if (char === '"') return '&quot;';
    return '&#39;';
  });
}

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
}

function formatPhonetic(value) {
  const clean = String(value ?? '').trim();
  if (!clean) return '';
  if (/^[/[].*[/\]]$/.test(clean)) return clean;
  return `/${clean}/`;
}

function todayLabel() {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(new Date());
  } catch {
    return localDateKey();
  }
}

function showToast(message, tone = 'neutral') {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.dataset.tone = tone;
  toastEl.classList.add('is-visible');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('is-visible');
  }, 2800);
}

function topbar({ title = '', right = '', back = true, action = 'back' } = {}) {
  return `<header class="topbar">
    ${
      back
        ? `<button class="icon-button glass" data-action="${action}" aria-label="返回">${icon('back')}</button>`
        : '<span class="topbar-spacer"></span>'
    }
    <div class="topbar-title">${esc(title)}</div>
    <div class="topbar-right">${right}</div>
  </header>`;
}

function iconButton(name, action, label, extra = '', route = '') {
  return `<button class="icon-button glass ${extra}" data-action="${action}"${
    route ? ` data-route="${route}"` : ''
  } aria-label="${esc(label)}" title="${esc(label)}">${icon(name)}</button>`;
}

function groupBadge(group, withName = false) {
  if (!GROUP_INFO[group]) return '';
  return `<span class="group-badge" data-group="${group}"><b>${group}</b>${
    withName ? `<i>${GROUP_INFO[group].name}</i>` : ''
  }</span>`;
}

/* ------------------------------------------------------------------ data */

function rebuildWordIndex() {
  state.wordMap = new Map(state.words.map((word) => [word.id, word]));
}

function replaceWord(word) {
  const index = state.words.findIndex((item) => item.id === word.id);
  if (index >= 0) state.words[index] = word;
  else state.words.push(word);
  state.wordMap.set(word.id, word);
}

async function ensureEGate({ persist = true, now = Date.now() } = {}) {
  const date = localDateKey(new Date(now));
  const stored = await wordStore.getMeta('eGate', null);
  const previous = stored?.date === date ? stored : { date, ids: [] };
  const ids = selectEGate(state.words, state.settings, previous, now);
  const next = { date, ids };
  const changed =
    !stored || stored.date !== date || JSON.stringify(stored.ids ?? []) !== JSON.stringify(ids);
  state.eGate = next;
  if (persist && changed) await wordStore.setMeta('eGate', next);
  return next;
}

function recomputeStats(now = Date.now()) {
  state.stats = getStats(state.words, state.settings, state.eGate.ids, now);
  return state.stats;
}

async function refreshDerived({ persistGate = true } = {}) {
  await ensureEGate({ persist: persistGate });
  recomputeStats();
}

async function currentDueCount() {
  await ensureEGate({ persist: true });
  const queue = buildReviewQueue(state.words, state.settings, state.eGate.ids, Date.now());
  return getDueWords(queue).length;
}

async function reloadWords() {
  state.words = await wordStore.getAllWords();
  rebuildWordIndex();
  await refreshDerived();
}

/* ------------------------------------------------------------------ boot */

async function boot() {
  try {
    state.settings = await wordStore.getSettings();
    state.words = await wordStore.getAllWords();
    rebuildWordIndex();
    await refreshDerived({ persistGate: true });
    applyTheme();

    if (navigator.storage?.persisted) {
      state.persisted = await navigator.storage.persisted().catch(() => false);
    }

    state.ready = true;
    const hash = location.hash.replace(/^#\/?/, '');
    if (['today', 'import', 'settings'].includes(hash)) state.route = hash;

    // Render immediately. Service-worker registration must never hold the app
    // hostage while a cache install or an unreachable CDN is pending.
    render();
    notifier
      .init({
        settings: state.settings,
        getDueCount: currentDueCount,
        onOpenReview: () => {
          if (!state.ready) {
            pendingReview = true;
            return;
          }
          startSession('review').catch((error) => showToast(error.message, 'error'));
        },
      })
      .catch((error) => console.warn('word-drill: notifier init failed', error));

    const params = new URLSearchParams(location.search);
    if (params.get('review') === '1') {
      params.delete('review');
      const query = params.toString();
      history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`);
      pendingReview = true;
    }
    if (pendingReview) {
      pendingReview = false;
      if (state.words.length) {
        await startSession('review');
      } else {
        showToast('先导入词库，才能开始复习');
      }
    }
  } catch (error) {
    console.error(error);
    state.fatal = error?.message ?? String(error);
    state.ready = true;
    render();
  }
}

/* ------------------------------------------------------------------ render */

function render() {
  if (!state.ready) {
    root.innerHTML = renderSplash();
    return;
  }
  if (state.fatal) {
    root.innerHTML = renderFatal();
    return;
  }

  let body = '';
  switch (state.route) {
    case 'study':
      body = state.session ? renderStudy() : renderHome();
      break;
    case 'summary':
      body = state.session ? renderSummary() : renderHome();
      break;
    case 'today':
      body = renderToday();
      break;
    case 'import':
      body = renderImport();
      break;
    case 'settings':
      body = renderSettings();
      break;
    case 'home':
    default:
      body = renderHome();
      break;
  }

  root.innerHTML = `${body}${
    state.busy && state.busyLabel
      ? `<div class="busy-veil" role="status"><span class="spinner"></span><span>${esc(
          state.busyLabel,
        )}</span></div>`
      : ''
  }`;

  document.body.dataset.route = state.route;
  document.title =
    state.route === 'study'
      ? '刷词 · 词潮'
      : state.route === 'import'
        ? '导入词库 · 词潮'
        : state.route === 'settings'
          ? '设置 · 词潮'
          : state.route === 'today'
            ? '今日复习 · 词潮'
            : '词潮 · 英语刷词器';

  if (state.scrollTarget) {
    const target = state.scrollTarget;
    state.scrollTarget = '';
    requestAnimationFrame(() => {
      document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

function renderSplash() {
  return `<div class="screen screen--center splash">
    <div class="splash-mark">${brandMark()}</div>
    <p class="splash-title">词潮</p>
    <span class="spinner spinner--ink"></span>
  </div>`;
}

function renderFatal() {
  return `<div class="screen screen--center">
    <div class="fatal-mark">${icon('shield')}</div>
    <h1 class="center-title">存储没有打开</h1>
    <p class="center-copy">${esc(state.fatal)}</p>
    <p class="center-note">请关闭无痕模式，或换一个支持 IndexedDB 的浏览器再打开。</p>
  </div>`;
}

function renderHome() {
  if (!state.words.length) return renderOnboarding();
  const newQueue = buildNewQueue(state.words);
  const reviewQueue = buildReviewQueue(state.words, state.settings, state.eGate.ids);
  const newCount = newQueue.length;
  const reviewCount = reviewQueue.length;
  const dueCount = getDueWords(reviewQueue).length;

  return `<div class="screen screen--home">
    <div class="home-shell">
      <header class="home-head">
        <div class="brand">
          ${brandMark()}
          <div class="brand-copy">
            <span class="brand-cn">词潮</span>
            <span class="brand-en">WORD TIDE</span>
          </div>
        </div>
        <div class="head-actions">
          ${iconButton('import', 'nav', '导入词库', '', 'import')}
          ${iconButton('settings', 'nav', '设置', '', 'settings')}
        </div>
      </header>

      <main class="home-main">
        <div class="home-intro">
          <p class="eyebrow"><span class="eyebrow-line"></span>离线英语刷词器</p>
          <h1>先看一眼，<br><em>再决定要不要记住。</em></h1>
          <p class="lede">不预设词库，不联网，不打扰。你的每一次作答，只留在这台设备。</p>
        </div>

        <div class="entry-stack">
          <button class="entry glass entry--new" data-action="start" data-mode="new">
            <span class="entry-orb">${icon('spark')}</span>
            <span class="entry-copy">
              <strong>看看新词</strong>
              <small>初次见面，凭直觉就好</small>
            </span>
            <span class="entry-count">${formatNumber(newCount)}<i>词</i></span>
            <span class="entry-arrow">${icon('arrow')}</span>
          </button>

          <button class="entry glass entry--review" data-action="start" data-mode="review">
            <span class="entry-orb">${icon('wave')}</span>
            <span class="entry-copy">
              <strong>看看不认识</strong>
              <small>到期的先来，顽固的靠后</small>
            </span>
            <span class="entry-count">${formatNumber(reviewCount)}<i>词</i></span>
            <span class="entry-arrow">${icon('arrow')}</span>
          </button>
        </div>

        <button class="stats-line" data-action="nav" data-route="today">
          <span>新词 <b>${formatNumber(newCount)}</b></span>
          <span class="stats-dot">·</span>
          <span>生词 <b>${formatNumber(reviewCount)}</b></span>
          <span class="stats-dot">·</span>
          <span class="${dueCount ? 'is-hot' : ''}">今日待复习 <b>${formatNumber(dueCount)}</b></span>
          <span class="stats-more">${icon('chevron')}</span>
        </button>

        <p class="privacy-note">${icon('lock')} 数据仅存本机 IndexedDB · 可完全离线</p>
      </main>
    </div>
  </div>`;
}

function renderOnboarding() {
  return `<div class="screen screen--home">
    <div class="home-shell">
      <header class="home-head">
        <div class="brand">
          ${brandMark()}
          <div class="brand-copy">
            <span class="brand-cn">词潮</span>
            <span class="brand-en">WORD TIDE</span>
          </div>
        </div>
        <div class="head-actions">
          ${iconButton('settings', 'nav', '设置', '', 'settings')}
        </div>
      </header>

      <main class="onboarding">
        <div class="onboarding-art" aria-hidden="true">
          <span class="orbit orbit--one"></span>
          <span class="orbit orbit--two"></span>
          <span class="onboarding-aa">Aa</span>
          <span class="onboarding-chip">CET6</span>
        </div>

        <p class="eyebrow"><span class="eyebrow-line"></span>第一步</p>
        <h1>先装一本<br><em>属于你的词库。</em></h1>
        <p class="lede">CET6 · 5,651 个词，来自 KyleBing/english-vocabulary。导入后完全离线，不预置任何词。</p>

        <div class="onboarding-actions">
          <button class="button button--primary glass" data-action="import-cet6">
            ${icon('download')} 导入 CET6 词库
          </button>
          <button class="text-button" data-action="nav" data-route="import">
            粘贴 JSON / 上传 CSV ${icon('arrow')}
          </button>
        </div>

        <div class="onboarding-meta">
          <span>${icon('shield')} 无账号</span>
          <span>${icon('lock')} 无云端</span>
          <span>${icon('wave')} 无广告</span>
        </div>
      </main>
    </div>
  </div>`;
}

function renderStudy() {
  const session = state.session;
  if (!session) return renderHome();

  let word = state.wordMap.get(session.ids[session.index]);
  let cursor = session.index;
  while (!word && cursor < session.ids.length) {
    cursor += 1;
    word = state.wordMap.get(session.ids[cursor]);
  }
  if (!word) {
    requestAnimationFrame(() => {
      if (state.session) {
        state.session.index = cursor;
        state.route = 'summary';
        history.replaceState(history.state, '', '#/summary');
        render();
      }
    });
    return renderSplash();
  }

  const total = session.ids.length;
  const position = clamp(cursor + 1, 1, total);
  const progress = Math.max(0, Math.min(100, (position / total) * 100));
  const modeLabel = session.mode === 'new' ? '新词' : '生词复习';
  const wordClass =
    word.text.length > 16 ? 'word word--xlong' : word.text.length > 11 ? 'word word--long' : 'word';
  const revealed = Boolean(state.reveal && state.reveal.wordId === word.id);
  const meaning = revealed ? state.reveal.definition : '';
  const speed = state.settings.revealSpeed in REVEAL_SPEEDS ? state.settings.revealSpeed : 'normal';
  const speedButtons = Object.entries(REVEAL_SPEEDS)
    .map(
      ([key, info]) =>
        `<button type="button" data-action="set-reveal-speed" data-speed="${key}" aria-pressed="${
          speed === key
        }" title="汉译停留 ${(info.ms / 1000).toFixed(1)} 秒">${info.label}</button>`,
    )
    .join('');

  return `<div class="screen screen--study${revealed ? ' is-revealing' : ''}">
    <header class="study-head">
      <button class="icon-button glass" data-action="exit-study" aria-label="结束本轮">${icon('close')}</button>
      <div class="study-meta">
        <span>${modeLabel}</span>
        <b>${formatNumber(position)}<i> / ${formatNumber(total)}</i></b>
      </div>
      <button class="icon-button glass" data-action="speak-current" aria-label="朗读单词">${icon('speaker')}</button>
    </header>

    <div class="progress-rail" aria-hidden="true"><span style="width:${progress}%"></span></div>

    <div class="study-utility">
      <span class="study-utility-label">作答后汉译</span>
      <div class="speed-switch" role="group" aria-label="汉译停留时长">${speedButtons}</div>
    </div>

    <main class="word-stage">
      <div class="word-halo" aria-hidden="true"></div>
      <div class="word-block${revealed ? ' is-static' : ''}" key="${esc(word.id)}-${cursor}">
        <h1 class="${wordClass}" aria-live="polite">${esc(word.text)}</h1>
        ${
          word.phonetic
            ? `<p class="phonetic">${esc(formatPhonetic(word.phonetic))}</p>`
            : '<p class="phonetic phonetic--empty" aria-hidden="true">&nbsp;</p>'
        }
      </div>
      <div class="word-meaning${revealed ? ' is-visible' : ''}" aria-live="polite" aria-hidden="${
        revealed ? 'false' : 'true'
      }">
        <span class="meaning-label">汉译</span>
        <p>${esc(meaning)}</p>
      </div>
      <p class="study-hint">${
        revealed
          ? '汉译已显示 · 即将下一词'
          : session.mode === 'review'
            ? '凭第一反应作答'
            : '不认识也没关系'
      }</p>
    </main>

    <div class="answer-bar" role="group" aria-label="作答">
      <button class="answer glass answer--know" data-action="answer" data-value="known" ${
        state.busy ? 'disabled' : ''
      } aria-keyshortcuts="1">
        <span>认识</span><kbd>1</kbd>
      </button>
      <button class="answer glass answer--unknown" data-action="answer" data-value="unknown" ${
        state.busy ? 'disabled' : ''
      } aria-keyshortcuts="2">
        <span>不认识</span><kbd>2</kbd>
      </button>
      <button class="answer glass answer--easy" data-action="answer" data-value="easy" ${
        state.busy ? 'disabled' : ''
      } aria-keyshortcuts="3">
        <span>太简单</span><kbd>3</kbd>
      </button>
    </div>
  </div>`;
}

function renderSummary() {
  const session = state.session;
  const { known = 0, unknown = 0, easy = 0 } = session?.results ?? {};
  const total = known + unknown + easy;
  return `<div class="screen screen--summary">
    <div class="page-shell page-shell--narrow">
      <header class="summary-head">
        <button class="icon-button glass" data-action="home" aria-label="回到首页">${icon('close')}</button>
        <span class="summary-mode">${session?.mode === 'new' ? '新词一轮' : '复习一轮'}</span>
        <span class="topbar-spacer"></span>
      </header>

      <main class="summary-main">
        <p class="eyebrow"><span class="eyebrow-line"></span>本轮 ${formatNumber(total)} 词</p>
        <h1>这一轮，<br><em>结束了。</em></h1>
        <p class="summary-lede">${
          known === total && total > 0
            ? '全都认识。让它们先离开一会儿。'
            : unknown > 0
              ? '不认识的词已经回到生词本，会在合适的时候再出现。'
              : '慢慢来。词会记住你，比你想的更早。'
        }</p>

        <div class="summary-metrics">
          <div class="summary-metric summary-metric--known"><b>${formatNumber(known)}</b><span>认识</span></div>
          <div class="summary-metric summary-metric--unknown"><b>${formatNumber(unknown)}</b><span>不认识</span></div>
          <div class="summary-metric summary-metric--easy"><b>${formatNumber(easy)}</b><span>太简单</span></div>
        </div>

        <div class="summary-actions">
          <button class="button button--primary glass" data-action="restart">${icon('refresh')} 再来一轮</button>
          <button class="text-button" data-action="home">回到首页 ${icon('arrow')}</button>
        </div>
      </main>
    </div>
  </div>`;
}

function renderToday() {
  const now = Date.now();
  const queue = buildReviewQueue(state.words, state.settings, state.eGate.ids, now);
  const due = getDueWords(queue, now);
  const breakdown = groupBreakdown(state.words, state.settings, state.eGate.ids, now);

  return `<div class="screen screen--page">
    <div class="page-shell">
      ${topbar({
        title: '今日复习',
        right: `<span class="topbar-date">${esc(todayLabel())}</span>`,
      })}

      <main class="page-main">
        <section class="today-hero">
          <p class="eyebrow"><span class="eyebrow-line"></span>到期队列</p>
          <h1><span class="today-number">${formatNumber(due.length)}</span> 个词<br><em>在等你。</em></h1>
          <p class="lede">${
            due.length
              ? '到期词排在前面；还没到期的生词，也可以随时翻一翻。'
              : '今天没有到期的词。可以去生词本里随便看看。'
          }</p>
        </section>

        <div class="group-strip">
          ${breakdown
            .map(
              (item) => `<span class="group-chip" data-group="${item.group}" title="${
                GROUP_INFO[item.group].name
              }">
                <b>${item.group}</b><i>${item.due}/${item.active}</i>
              </span>`,
            )
            .join('')}
        </div>

        ${
          due.length
            ? `<section class="due-list" aria-label="今日到期词">
                <div class="section-head">
                  <h2>到期的词</h2>
                  <span>${formatNumber(due.length)} 个</span>
                </div>
                ${due
                  .slice(0, 200)
                  .map((word) => dueRow(word, now))
                  .join('')}
                ${
                  due.length > 200
                    ? `<p class="list-more">还有 ${formatNumber(due.length - 200)} 个词，进入复习队列会依次出现。</p>`
                    : ''
                }
              </section>`
            : `<section class="empty-state">
                ${icon('check')}
                <h2>今天很干净</h2>
                <p>下一个到期点会在合适的时候出现。</p>
              </section>`
        }

        <div class="page-actions">
          ${
            due.length
              ? `<button class="button button--primary glass" data-action="start-due">${icon('wave')} 开始今日复习</button>`
              : queue.length
                ? `<button class="button button--primary glass" data-action="start" data-mode="review">${icon('wave')} 看看全部生词</button>`
                : `<button class="button button--primary glass" data-action="start" data-mode="new">${icon('spark')} 看看新词</button>`
          }
        </div>
      </main>
    </div>
  </div>`;
}

function dueRow(word, now) {
  return `<button class="due-row" data-action="speak-word" data-id="${esc(word.id)}">
    <span class="due-main">
      <span class="due-word">${esc(word.text)}</span>
      ${word.phonetic ? `<span class="due-phonetic">${esc(formatPhonetic(word.phonetic))}</span>` : ''}
      ${word.definition ? `<span class="due-definition">${esc(word.definition)}</span>` : ''}
    </span>
    <span class="due-side">
      ${groupBadge(word.group)}
      <span class="due-time">${esc(formatDueLabel(word.nextReviewAt, now))}</span>
      ${icon('speaker', 'due-speaker')}
    </span>
  </button>`;
}

function renderImport() {
  const tabs = [
    ['cet6', 'CET6'],
    ['json', 'JSON'],
    ['csv', 'CSV'],
  ];
  const result = state.importResult;

  return `<div class="screen screen--page">
    <div class="page-shell">
      ${topbar({ title: '导入词库' })}

      <main class="page-main">
        <section class="page-hero">
          <p class="eyebrow"><span class="eyebrow-line"></span>只写入本机</p>
          <h1>把词库<br><em>放进口袋。</em></h1>
          <p class="lede">支持 KyleBing CET6 JSON、通用 JSON，以及 <code>word,phonetic,definition</code> CSV。重复词会保留原有学习进度。</p>
        </section>

        <div class="segmented glass" role="tablist" aria-label="导入方式">
          ${tabs
            .map(
              ([id, label]) => `<button role="tab" aria-selected="${state.importTab === id}" data-action="import-tab" data-tab="${id}">${label}</button>`,
            )
            .join('')}
        </div>

        ${state.importTab === 'cet6' ? renderCet6Panel() : renderTextImportPanel(state.importTab)}

        ${
          state.importError
            ? `<p class="inline-error" role="alert">${icon('close')} ${esc(state.importError)}</p>`
            : ''
        }

        ${result ? renderImportResult(result) : ''}

        ${renderBackfillPanel()}

        <p class="fine-print">
          词库来源：<a href="https://github.com/KyleBing/english-vocabulary" target="_blank" rel="noreferrer">KyleBing/english-vocabulary</a>
          · BSD-3-Clause · 内置快照不联网更新。
        </p>
      </main>
    </div>
  </div>`;
}

function renderCet6Panel() {
  return `<section class="panel import-card">
    <div class="import-source">
      <span class="source-mark">${icon('book')}</span>
      <div>
        <h2>CET6 · 顺序词库</h2>
        <p>5,651 词 · 内置离线快照</p>
      </div>
      <span class="pill">BSD-3</span>
    </div>
    <p class="panel-copy">直接导入 KyleBing 仓库的 CET6 JSON。该文件不含音标，导入不会被阻断；之后可用下方“音标回填”补全。</p>
    <button class="button button--primary glass" data-action="import-cet6" ${
      state.busy ? 'disabled' : ''
    }>${icon('download')} 导入 CET6 词库</button>
    <p class="panel-note">${icon('shield')} 只从本应用缓存读取，不请求外部 API。</p>
  </section>`;
}

function renderTextImportPanel(tab) {
  const isJson = tab === 'json';
  return `<section class="panel import-card">
    <div class="section-head">
      <h2>${isJson ? '粘贴 / 上传 JSON' : '粘贴 / 上传 CSV'}</h2>
      <span>${isJson ? '数组或对象' : '逗号分隔'}</span>
    </div>

    <label class="dropzone" data-drop="${tab}">
      <input type="file" accept="${isJson ? '.json,application/json' : '.csv,text/csv'}" data-file="${tab}" />
      ${icon('import')}
      <span>${state.importFileName ? esc(state.importFileName) : `选择 .${tab} 文件`}</span>
      <small>或拖入这里</small>
    </label>

    <label class="field-label" for="import-text">${isJson ? 'JSON 内容' : 'CSV 内容'}</label>
    <textarea id="import-text" class="text-area" spellcheck="false" placeholder="${esc(
      isJson
        ? '[{"word":"ability","translations":[{"translation":"能力","type":"n"}]}]'
        : 'word,phonetic,definition\nability,əˈbɪləti,n. 能力；才能',
    )}">${esc(state.importText)}</textarea>

    <button class="button button--primary glass" data-action="import-text" data-kind="${tab}" ${
      state.busy ? 'disabled' : ''
    }>${icon('upload')} 解析并导入</button>
  </section>`;
}

function renderImportResult(result) {
  return `<section class="result-block" aria-label="导入统计">
    <div class="section-head">
      <h2>导入完成</h2>
      <span>${esc(result.source ?? '')}</span>
    </div>
    <div class="metric-grid">
      <div><b>${formatNumber(result.total)}</b><span>总词数</span></div>
      <div><b>${formatNumber(result.added)}</b><span>成功导入</span></div>
      <div><b>${formatNumber(result.skipped)}</b><span>跳过重复</span></div>
      <div><b>${formatNumber(result.missingPhonetic)}</b><span>缺音标</span></div>
    </div>
    <p class="result-note">
      当前词库共 ${formatNumber(result.libraryTotal)} 词${
        result.supplemented ? ` · 为 ${formatNumber(result.supplemented)} 个旧词补充了缺失字段` : ''
      }${result.duplicatesInInput ? ` · 已按 text 去重 ${formatNumber(result.duplicatesInInput)} 条` : ''}。
    </p>
  </section>`;
}

function renderBackfillPanel() {
  return `<section class="panel backfill-panel" id="backfill">
    <div class="section-head">
      <h2>音标回填</h2>
      <span>word,phonetic</span>
    </div>
    <p class="panel-copy">用一份 CSV 按 <code>word</code> 精确匹配，补全词库里为空的音标。缺失音标不会阻断任何学习流程。</p>

    <label class="dropzone dropzone--compact" data-drop="backfill">
      <input type="file" accept=".csv,text/csv" data-file="backfill" />
      ${icon('import')}
      <span>${state.backfillFileName ? esc(state.backfillFileName) : '选择音标 CSV'}</span>
      <small>word,phonetic</small>
    </label>

    <textarea id="backfill-text" class="text-area text-area--small" spellcheck="false" placeholder="word,phonetic&#10;ability,əˈbɪləti">${esc(
      state.backfillText,
    )}</textarea>

    <label class="check-row">
      <input type="checkbox" id="backfill-overwrite" ${state.backfillOverwrite ? 'checked' : ''} />
      <span>覆盖已有音标</span>
    </label>

    <button class="button button--secondary glass" data-action="run-backfill" ${
      state.busy ? 'disabled' : ''
    }>${icon('check')} 开始回填</button>

    ${
      state.backfillResult
        ? `<p class="result-note">匹配 ${formatNumber(state.backfillResult.matched)} / 更新 ${formatNumber(
            state.backfillResult.updated,
          )} / 未匹配 ${formatNumber(state.backfillResult.missing.length)}${
            state.backfillResult.libraryMissing !== undefined
              ? ` · 词库仍缺 ${formatNumber(state.backfillResult.libraryMissing)}`
              : ''
          }</p>`
        : ''
    }
  </section>`;
}

function renderSettings() {
  const permission = notifier.permission();
  const permissionText = {
    granted: '已允许',
    denied: '已拒绝',
    default: '未授权',
    unsupported: '浏览器不支持',
  }[permission] ?? permission;

  return `<div class="screen screen--page">
    <div class="page-shell">
      ${topbar({ title: '设置' })}

      <main class="page-main settings-main">
        <section class="settings-intro">
          <p class="eyebrow"><span class="eyebrow-line"></span>保持简单</p>
          <h1>只留下<br><em>有用的东西。</em></h1>
        </section>

        <section class="panel settings-panel">
          <div class="section-head">
            <h2>复习分组</h2>
            <span>五级生词本</span>
          </div>
          <p class="panel-copy">关闭的组不会进入“看看不认识”、今日复习或通知计数。学习进度仍会保留。</p>
          <div class="setting-list">
            ${ACTIVE_GROUPS.slice()
              .reverse()
              .map((group) => {
                const info = GROUP_INFO[group];
                return `<div class="setting-row">
                  ${groupBadge(group, true)}
                  <div class="setting-copy">
                    <strong>${info.sequenceLabel}</strong>
                    <small>${info.condition}</small>
                  </div>
                  <button class="switch" role="switch" aria-checked="${
                    state.settings.reviewEnabled[group]
                  }" data-action="toggle-group" data-group="${group}" aria-label="${group} 组参与复习">
                    <span></span>
                  </button>
                </div>`;
              })
              .join('')}
          </div>

          <div class="setting-row setting-row--limit">
            <div class="setting-copy">
              <strong>E 组每日上限</strong>
              <small>冰封词每天最多进入复习队列的数量</small>
            </div>
            <div class="stepper">
              <button class="stepper-button" data-action="limit-down" aria-label="减少">${icon('minus')}</button>
              <input id="e-limit" type="number" min="0" max="100" inputmode="numeric" value="${state.settings.eGroupDailyLimit}" />
              <button class="stepper-button" data-action="limit-up" aria-label="增加">${icon('plus')}</button>
            </div>
          </div>
        </section>

        <section class="panel settings-panel">
          <div class="section-head">
            <h2>提醒</h2>
            <span class="permission-pill" data-permission="${permission}">${permissionText}</span>
          </div>
          <div class="setting-row">
            <div class="setting-copy">
              <strong>到期通知</strong>
              <small>有到期词时，在设定时间提醒</small>
            </div>
            <button class="switch" role="switch" aria-checked="${state.settings.notificationEnabled}" data-action="toggle-notifications" aria-label="开启到期通知">
              <span></span>
            </button>
          </div>
          <div class="time-grid">
            <label><span>第一次</span><input type="time" value="${esc(
              state.settings.notificationTimes[0] ?? '',
            )}" data-time-index="0" /></label>
            <label><span>第二次</span><input type="time" value="${esc(
              state.settings.notificationTimes[1] ?? '',
            )}" data-time-index="1" /></label>
          </div>
          <div class="button-row">
            <button class="button button--secondary glass" data-action="request-notifications">${icon('bell')} 允许通知</button>
            <button class="button button--secondary glass" data-action="test-notifications">${icon('spark')} 立即检查并通知</button>
          </div>
          <p class="panel-note">iPhone 需先“添加到主屏幕”，再从主屏幕打开授权；本地提醒依赖页面或 Service Worker 被唤醒，关闭应用后不保证准点。</p>
        </section>

        <section class="panel settings-panel">
          <div class="section-head">
            <h2>声音</h2>
            <span>Web Speech</span>
          </div>
          <div class="setting-row">
            <div class="setting-copy">
              <strong>“不认识”时朗读</strong>
              <small>${speech.supported ? `首选本地 en-US 语音${speech.describe().voice ? ` · ${esc(speech.describe().voice)}` : ''}` : '当前浏览器不支持语音合成'}</small>
            </div>
            <button class="switch" role="switch" aria-checked="${state.settings.soundEnabled}" data-action="toggle-sound" aria-label="开启朗读" ${
              speech.supported ? '' : 'disabled'
            }>
              <span></span>
            </button>
          </div>
          <button class="text-button text-button--inline" data-action="test-speech" ${
            speech.supported ? '' : 'disabled'
          }>${icon('speaker')} 试听 “vocabulary”</button>
        </section>

        <section class="panel settings-panel">
          <div class="section-head">
            <h2>学习反馈</h2>
            <span>作答后</span>
          </div>
          <p class="panel-copy">点「认识」或「不认识」后，短暂显示该词汉译，再自动进入下一词。</p>
          <div class="segmented segmented--theme" role="tablist" aria-label="汉译停留时长">
            ${Object.entries(REVEAL_SPEEDS)
              .map(
                ([value, info]) =>
                  `<button role="tab" aria-selected="${state.settings.revealSpeed === value}" data-action="set-reveal-speed" data-speed="${value}">${info.label} · ${(
                    info.ms / 1000
                  ).toFixed(1)}s</button>`,
              )
              .join('')}
          </div>
          <p class="panel-note">刷词页顶部也有一排「快 / 标准 / 慢」，不用回设置页。</p>
        </section>

        <section class="panel settings-panel">
          <div class="section-head">
            <h2>外观</h2>
            <span>默认跟随系统</span>
          </div>
          <div class="segmented segmented--theme" role="tablist" aria-label="外观主题">
            ${[
              ['auto', '跟随系统'],
              ['light', '浅色'],
              ['dark', '深色'],
            ]
              .map(
                ([value, label]) =>
                  `<button role="tab" aria-selected="${state.settings.theme === value}" data-action="theme" data-theme-choice="${value}">${label}</button>`,
              )
              .join('')}
          </div>
        </section>

        <section class="panel settings-panel">
          <div class="section-head">
            <h2>数据</h2>
            <span>${formatNumber(state.stats.total)} 词</span>
          </div>
          <div class="data-rows">
            <button class="data-row" data-action="nav" data-route="import">
              <span>${icon('import')} 导入 / 音标回填</span><i>${icon('chevron')}</i>
            </button>
            <button class="data-row" data-action="export">
              <span>${icon('download')} 导出学习备份</span><i>${icon('chevron')}</i>
            </button>
            <label class="data-row data-row--file">
              <span>${icon('upload')} 恢复学习备份</span><i>选择 JSON</i>
              <input type="file" accept=".json,application/json" data-file="restore" />
            </label>
            <button class="data-row" data-action="persist">
              <span>${icon('shield')} 锁定本机存储</span><i>${state.persisted ? '已持久化' : '申请'}</i>
            </button>
          </div>
          <p class="panel-note">缺音标 ${formatNumber(state.stats.missingPhonetic)} 个。刷新、关闭、重开都不会丢失词库或进度。</p>
          <button class="danger-button" data-action="clear-all">${icon('trash')} 清空词库与全部进度</button>
        </section>

        <footer class="settings-footer">
          <span>词潮 · v1.0</span>
          <span>IndexedDB · 无外部请求</span>
        </footer>
      </main>
    </div>
  </div>`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/* ------------------------------------------------------------------ actions */

async function navigate(route, { replace = false } = {}) {
  const valid = ['home', 'study', 'summary', 'today', 'import', 'settings'];
  if (!valid.includes(route)) route = 'home';
  if ((route === 'study' || route === 'summary') && !state.session) route = 'home';
  state.route = route;
  const hash = `#/${route}`;
  if (replace) history.replaceState({ route }, '', hash);
  else if (location.hash !== hash) history.pushState({ route }, '', hash);
  render();
  window.scrollTo(0, 0);
}

function goBack() {
  if (state.route === 'study') {
    exitSession();
    return;
  }
  if (state.route === 'summary') {
    state.session = null;
    navigate('home', { replace: true });
    return;
  }
  if (state.route === 'home') return;
  navigate('home', { replace: true });
}

async function startSession(mode, { dueOnly = false } = {}) {
  if (!state.words.length) {
    navigate('import');
    showToast('先导入词库，再开始刷词', 'error');
    return;
  }
  await ensureEGate({ persist: true });
  let queue =
    mode === 'new'
      ? buildNewQueue(state.words)
      : buildReviewQueue(state.words, state.settings, state.eGate.ids, Date.now());
  if (dueOnly) queue = getDueWords(queue, Date.now());

  if (!queue.length) {
    showToast(
      mode === 'new' ? '新词已经看完了' : dueOnly ? '现在没有到期的词' : '没有需要复习的生词',
      'neutral',
    );
    return;
  }

  state.session = {
    mode,
    scope: dueOnly ? 'due' : 'all',
    ids: queue.map((word) => word.id),
    index: 0,
    results: { known: 0, unknown: 0, easy: 0 },
    startedAt: Date.now(),
  };
  navigate('study');
}

function exitSession() {
  clearReveal();
  speech.stop();
  state.session = null;
  state.busy = false;
  state.busyLabel = '';
  navigate('home', { replace: true });
}

async function restartSession() {
  if (!state.session) return;
  clearReveal();
  const { mode, scope } = state.session;
  state.session = null;
  await startSession(mode, { dueOnly: scope === 'due' });
}

function clearReveal({ unlock = true } = {}) {
  if (state.revealTimer) {
    clearTimeout(state.revealTimer);
    state.revealTimer = null;
  }
  state.reveal = null;
  if (unlock) state.busy = false;
}

function advanceAfterReveal() {
  const session = state.session;
  const reveal = state.reveal;
  if (!session || !reveal) return;
  state.revealTimer = null;
  state.reveal = null;
  state.busy = false;
  session.index = reveal.nextIndex;
  if (session.index >= session.ids.length) {
    finishSession().catch((error) => {
      console.error(error);
      showToast(`结束本轮失败：${error.message}`, 'error');
    });
    return;
  }
  render();
}

async function handleAnswer(value) {
  if (state.busy || state.reveal || !state.session) return;
  const session = state.session;
  const word = state.wordMap.get(session.ids[session.index]);
  if (!word) {
    session.index += 1;
    if (session.index >= session.ids.length) await finishSession();
    else render();
    return;
  }

  state.busy = true;
  if (value === 'unknown') {
    if (state.settings.soundEnabled) speech.speak(word.text);
    if (navigator.vibrate) navigator.vibrate(18);
  } else {
    speech.stop();
    if (navigator.vibrate) navigator.vibrate(8);
  }

  let updated;
  try {
    if (value === 'known') {
      updated = answerKnown(word, { fromReview: session.mode === 'review' });
    } else if (value === 'unknown') {
      updated = answerUnknown(word);
    } else {
      updated = answerTooEasy(word);
    }

    await wordStore.putWord(updated);
    replaceWord(updated);
    session.results[value] += 1;

    await ensureEGate({ persist: true });
    recomputeStats();

    if (value === 'easy') {
      session.index += 1;
      if (session.index >= session.ids.length) await finishSession();
      else {
        state.busy = false;
        render();
      }
      return;
    }

    const nextIndex = session.index + 1;
    const speed = REVEAL_SPEEDS[state.settings.revealSpeed]
      ? state.settings.revealSpeed
      : 'normal';
    state.reveal = {
      wordId: word.id,
      definition: (updated.definition || word.definition || '暂无汉译').trim(),
      nextIndex,
    };
    state.busy = true;
    render();
    state.revealTimer = setTimeout(advanceAfterReveal, REVEAL_SPEEDS[speed].ms);
  } catch (error) {
    console.error(error);
    clearReveal();
    showToast(`保存失败：${error.message}`, 'error');
    render();
  }
}

async function finishSession() {
  clearReveal({ unlock: false });
  state.busy = false;
  state.route = 'summary';
  history.replaceState({ route: 'summary' }, '', '#/summary');
  render();
  window.scrollTo(0, 0);
}

async function updateSettings(patch, { rerender = false } = {}) {
  state.settings = sanitizeSettings({ ...state.settings, ...patch });
  applyTheme();
  await wordStore.saveSettings(state.settings);
  await ensureEGate({ persist: true });
  recomputeStats();
  notifier.refresh(state.settings);
  if (rerender) render();
}

async function setRevealSpeed(speed) {
  if (!(speed in REVEAL_SPEEDS)) return;
  state.settings = sanitizeSettings({ ...state.settings, revealSpeed: speed });
  render();
  try {
    await wordStore.saveSettings(state.settings);
  } catch (error) {
    showToast(`保存失败：${error.message}`, 'error');
  }
}

async function importEntries(entries, source, meta = {}) {
  if (!entries.length) throw new Error('没有可导入的词');
  state.busy = true;
  state.busyLabel = '正在写入本机…';
  render();
  try {
    const result = await wordStore.importEntries(entries, {
      sourceTotal: meta.total,
      duplicatesInInput: meta.duplicatesInFile ?? 0,
    });
    state.words = await wordStore.getAllWords();
    rebuildWordIndex();
    await ensureEGate({ persist: true });
    recomputeStats();
    state.importResult = { ...result, source };
    state.importError = '';
    if (state.route !== 'import') {
      state.route = 'import';
      history.replaceState({ route: 'import' }, '', '#/import');
    }
    showToast(`新增 ${formatNumber(result.added)} 个词，词库共 ${formatNumber(result.libraryTotal)} 个`, 'good');
  } finally {
    state.busy = false;
    state.busyLabel = '';
    render();
  }
}

async function importCet6() {
  if (state.busy) return;
  state.busy = true;
  state.busyLabel = '正在读取内置 CET6…';
  state.importError = '';
  render();
  try {
    const response = await fetch('./data/cet6.json', { cache: 'force-cache' });
    if (!response.ok) throw new Error(`读取内置词库失败（${response.status}）`);
    const text = await response.text();
    const parsed = parseJsonText(text);
    state.busy = false;
    state.busyLabel = '';
    await importEntries(parsed.entries, 'CET6 · 内置快照', parsed);
  } catch (error) {
    state.busy = false;
    state.busyLabel = '';
    state.importError = error.message;
    if (state.route !== 'import') navigate('import');
    else render();
    showToast(error.message, 'error');
  }
}

async function runTextImport(kind) {
  if (state.busy) return;
  const text = state.importText || document.getElementById('import-text')?.value || '';
  if (!text.trim()) {
    showToast('先粘贴内容，或选择一个文件', 'error');
    return;
  }
  state.importError = '';
  try {
    const parsed = kind === 'json' ? parseJsonText(text) : parseCsvText(text);
    await importEntries(parsed.entries, kind === 'json' ? 'JSON 粘贴' : 'CSV 粘贴', parsed);
  } catch (error) {
    state.importError = error.message;
    render();
    showToast(error.message, 'error');
  }
}

async function runBackfill() {
  if (state.busy) return;
  const text = state.backfillText || document.getElementById('backfill-text')?.value || '';
  if (!text.trim()) {
    showToast('先粘贴或选择音标 CSV', 'error');
    return;
  }
  state.busy = true;
  state.busyLabel = '正在补全音标…';
  render();
  try {
    const parsed = parseCsvText(text, { mode: 'phonetic' });
    const result = await wordStore.backfillPhonetics(parsed.entries, {
      overwrite: state.backfillOverwrite,
    });
    state.words = await wordStore.getAllWords();
    rebuildWordIndex();
    recomputeStats();
    state.backfillResult = result;
    if (state.importResult) {
      state.importResult = { ...state.importResult, missingPhonetic: result.libraryMissing };
    }
    showToast(`更新 ${formatNumber(result.updated)} 个音标`, 'good');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    state.busy = false;
    state.busyLabel = '';
    render();
  }
}

async function handleFile(file, kind) {
  if (!file) return;
  try {
    const text = await file.text();
    if (kind === 'backfill') {
      state.backfillText = text;
      state.backfillFileName = file.name;
    } else {
      state.importText = text;
      state.importFileName = file.name;
      state.importTab = guessImportKind(text, file.name);
      state.importError = '';
    }
    render();
  } catch (error) {
    showToast(`读取文件失败：${error.message}`, 'error');
  }
}

async function exportBackup() {
  try {
    const data = await wordStore.exportData(state.settings);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `word-drill-backup-${localDateKey()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast('备份已导出', 'good');
  } catch (error) {
    showToast(`导出失败：${error.message}`, 'error');
  }
}

async function restoreBackupFile(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || data.app !== 'word-drill' || !Array.isArray(data.words)) {
      throw new Error('这不是词潮的学习备份文件');
    }
    const confirmed = window.confirm(
      `用备份恢复 ${formatNumber(data.words.length)} 个词？当前词库和进度会被替换。`,
    );
    if (!confirmed) return;

    clearReveal();
    state.busy = true;
    state.busyLabel = '正在恢复备份…';
    render();
    try {
      const result = await wordStore.restoreBackup(data);
      state.settings = await wordStore.getSettings();
      state.words = await wordStore.getAllWords();
      rebuildWordIndex();
      await ensureEGate({ persist: true });
      recomputeStats();
      state.session = null;
      state.importResult = null;
      applyTheme();
      notifier.refresh(state.settings);
      showToast(`已恢复 ${formatNumber(result.restored)} 个词`, 'good');
    } finally {
      state.busy = false;
      state.busyLabel = '';
      render();
    }
  } catch (error) {
    state.busy = false;
    state.busyLabel = '';
    showToast(error.message, 'error');
    render();
  }
}

async function clearAllData() {
  const confirmed = window.confirm(
    '清空全部词库、学习进度和设置？这个操作不可撤销。建议先导出备份。',
  );
  if (!confirmed) return;
  clearReveal();
  await wordStore.clearAll();
  state.words = [];
  state.wordMap = new Map();
  state.settings = sanitizeSettings(DEFAULT_SETTINGS);
  state.eGate = { date: localDateKey(), ids: [] };
  state.stats = { total: 0, newCount: 0, reviewCount: 0, dueCount: 0, missingPhonetic: 0 };
  state.session = null;
  state.importResult = null;
  state.importText = '';
  state.backfillText = '';
  state.importFileName = '';
  state.backfillFileName = '';
  applyTheme();
  speech.stop();
  navigate('home', { replace: true });
  showToast('已清空。重新导入词库即可开始。', 'good');
}

async function requestNotifications() {
  if (!notifier.supported) {
    showToast('这个浏览器不支持通知', 'error');
    return;
  }
  const permission = await notifier.requestPermission();
  notifier.refresh(state.settings);
  render();
  if (permission === 'granted') showToast('通知已允许', 'good');
  else if (permission === 'denied') showToast('通知被拒绝，可在浏览器设置中重新开启', 'error');
  else showToast('还没有授权通知', 'neutral');
}

async function testNotifications() {
  if (!notifier.supported) {
    showToast('这个浏览器不支持通知', 'error');
    return;
  }
  if (notifier.permission() !== 'granted') {
    const permission = await notifier.requestPermission();
    if (permission !== 'granted') {
      render();
      showToast('通知未授权', 'error');
      return;
    }
  }
  try {
    await ensureEGate({ persist: true });
    recomputeStats();
    const result = await notifier.check({ manual: true, allowZero: true });
    if (result.shown) {
      showToast(
        result.dueCount ? `已发送提醒：${result.dueCount} 个词到期` : '测试通知已发送',
        'good',
      );
    } else {
      showToast('没有发送通知：没有到期词', 'neutral');
    }
  } catch (error) {
    showToast(error.message, 'error');
  }
}

/* ------------------------------------------------------------------ events */

async function onClick(event) {
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  if (!action) return;

  try {
    switch (action) {
      case 'nav':
        navigate(actionEl.dataset.route || 'home');
        break;
      case 'back':
        goBack();
        break;
      case 'home':
        exitSession();
        break;
      case 'start':
        await startSession(actionEl.dataset.mode || 'new');
        break;
      case 'start-due':
        await startSession('review', { dueOnly: true });
        break;
      case 'answer':
        await handleAnswer(actionEl.dataset.value);
        break;
      case 'exit-study':
        exitSession();
        break;
      case 'restart':
        await restartSession();
        break;
      case 'speak-current': {
        const session = state.session;
        const word = session ? state.wordMap.get(session.ids[session.index]) : null;
        if (word) speech.speak(word.text);
        break;
      }
      case 'speak-word': {
        const word = state.wordMap.get(actionEl.dataset.id);
        if (word) speech.speak(word.text);
        break;
      }
      case 'import-tab':
        state.importTab = actionEl.dataset.tab;
        state.importError = '';
        render();
        break;
      case 'import-cet6':
        await importCet6();
        break;
      case 'import-text':
        await runTextImport(actionEl.dataset.kind || state.importTab);
        break;
      case 'run-backfill':
        await runBackfill();
        break;
      case 'toggle-group': {
        const group = actionEl.dataset.group;
        const reviewEnabled = { ...state.settings.reviewEnabled, [group]: !state.settings.reviewEnabled[group] };
        await updateSettings({ reviewEnabled }, { rerender: true });
        break;
      }
      case 'toggle-notifications': {
        const enabled = !state.settings.notificationEnabled;
        if (enabled && notifier.permission() === 'default') {
          await notifier.requestPermission();
        }
        await updateSettings({ notificationEnabled: enabled }, { rerender: true });
        break;
      }
      case 'toggle-sound':
        await updateSettings({ soundEnabled: !state.settings.soundEnabled }, { rerender: true });
        break;
      case 'set-reveal-speed':
        await setRevealSpeed(actionEl.dataset.speed);
        break;
      case 'theme':
        state.settings = sanitizeSettings({ ...state.settings, theme: actionEl.dataset.themeChoice });
        applyTheme();
        await updateSettings({ theme: actionEl.dataset.themeChoice }, { rerender: true });
        break;
      case 'limit-down':
      case 'limit-up': {
        const delta = action === 'limit-up' ? 1 : -1;
        const value = clamp(state.settings.eGroupDailyLimit + delta, 0, 100);
        await updateSettings({ eGroupDailyLimit: value }, { rerender: true });
        break;
      }
      case 'request-notifications':
        await requestNotifications();
        break;
      case 'test-notifications':
        await testNotifications();
        break;
      case 'test-speech':
        speech.speak('vocabulary');
        break;
      case 'export':
        await exportBackup();
        break;
      case 'persist': {
        const result = await wordStore.requestPersistence();
        state.persisted = result.persisted;
        render();
        showToast(
          result.persisted ? '已锁定本机存储，浏览器不会轻易清理' : '浏览器暂未授予持久化存储',
          result.persisted ? 'good' : 'neutral',
        );
        break;
      }
      case 'clear-all':
        await clearAllData();
        break;
      default:
        break;
    }
  } catch (error) {
    console.error(error);
    state.busy = false;
    state.busyLabel = '';
    showToast(error.message ?? String(error), 'error');
    render();
  }
}

function onInput(event) {
  if (event.target.id === 'import-text') state.importText = event.target.value;
  if (event.target.id === 'backfill-text') state.backfillText = event.target.value;
}

async function onChange(event) {
  const target = event.target;

  if (target.matches('[data-file]')) {
    const kind = target.dataset.file;
    const file = target.files?.[0];
    target.value = '';
    if (!file) return;
    if (kind === 'restore') await restoreBackupFile(file);
    else await handleFile(file, kind);
    return;
  }

  if (target.id === 'backfill-overwrite') {
    state.backfillOverwrite = target.checked;
    return;
  }

  if (target.id === 'e-limit') {
    const value = clamp(Number(target.value) || 0, 0, 100);
    await updateSettings({ eGroupDailyLimit: value }, { rerender: true });
    return;
  }

  if (target.matches('[data-time-index]')) {
    const index = Number(target.dataset.timeIndex);
    const times = [...state.settings.notificationTimes];
    times[index] = target.value;
    const clean = times.filter(Boolean);
    await updateSettings({ notificationTimes: clean }, { rerender: false });
    return;
  }
}

function onKeyDown(event) {
  if (event.target.matches('input, textarea, select')) return;
  if (state.route === 'study' && state.session) {
    if (event.key === '1') {
      event.preventDefault();
      handleAnswer('known');
    } else if (event.key === '2') {
      event.preventDefault();
      handleAnswer('unknown');
    } else if (event.key === '3') {
      event.preventDefault();
      handleAnswer('easy');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      exitSession();
    }
  }
  if (state.route === 'summary' && event.key === 'Enter') {
    restartSession();
  }
}

function setupDragAndDrop() {
  root.addEventListener('dragover', (event) => {
    const zone = event.target.closest('[data-drop]');
    if (!zone) return;
    event.preventDefault();
    zone.classList.add('is-dragging');
  });
  root.addEventListener('dragleave', (event) => {
    const zone = event.target.closest('[data-drop]');
    if (!zone) return;
    zone.classList.remove('is-dragging');
  });
  root.addEventListener('drop', async (event) => {
    const zone = event.target.closest('[data-drop]');
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove('is-dragging');
    const file = event.dataTransfer?.files?.[0];
    if (file) await handleFile(file, zone.dataset.drop);
  });
}

/* ------------------------------------------------------------------ wiring */

root.addEventListener('click', onClick);
root.addEventListener('input', onInput);
root.addEventListener('change', onChange);
window.addEventListener('keydown', onKeyDown);
setupDragAndDrop();

window.addEventListener('popstate', () => {
  const route = location.hash.replace(/^#\/?/, '') || 'home';
  if (!['home', 'study', 'summary', 'today', 'import', 'settings'].includes(route)) {
    state.route = 'home';
  } else if ((route === 'study' || route === 'summary') && !state.session) {
    state.route = 'home';
  } else {
    state.route = route;
  }
  if (!['study', 'summary'].includes(state.route)) {
    clearReveal();
    state.session = null;
    state.busy = false;
    state.busyLabel = '';
  }
  render();
});

window.addEventListener('offline', () => showToast('已离线，学习记录仍会保存在本机', 'neutral'));
window.addEventListener('online', () => showToast('网络恢复。刷词本身不需要网络。', 'neutral'));

window.__wordDrill = {
  state,
  store: wordStore,
  notifier,
  speech,
  refresh: async () => {
    await reloadWords();
    render();
  },
  setDue: async (id, when = Date.now() - 60_000) => {
    const word = await wordStore.getWord(id);
    if (!word) throw new Error('word not found');
    word.nextReviewAt = when;
    if (!['A', 'B', 'C', 'D', 'E'].includes(word.group)) word.group = 'A';
    await wordStore.putWord(word);
    await reloadWords();
    render();
    return word;
  },
};

boot();
