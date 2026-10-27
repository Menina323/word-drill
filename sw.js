/* Word Drill service worker — offline shell + local reminder checks. */

const CACHE_NAME = 'word-drill-v1.1.3';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './favicon.ico',
  './js/app.js',
  './js/scheduler.js',
  './js/store.js',
  './js/seed.js',
  './js/speech.js',
  './js/notify.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/badge-96.png',
  './icons/favicon.svg',
  './data/cet6.json',
  './data/phonetics.json',
  './data/LICENSE-KyleBing.txt',
  './data/LICENSE-IPA-Dict.txt',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // One large/optional asset must not make the whole offline shell
      // un-installable (e.g. a CDN hiccup on data/cet6.json). Cache what we
      // can, then let cache-first runtime caching fill the rest.
      await Promise.allSettled(APP_SHELL.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'word-drill:check-now') {
    event.waitUntil(checkAndNotify({ reason: 'message' }));
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
      if (request.url.endsWith('/') || request.url.includes('index.html')) {
        cache.put('./index.html', response.clone());
      }
    }
    return response;
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match('./index.html')) ||
      (await cache.match('./')) ||
      new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || './?review=1', self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          await client.focus();
          client.postMessage({ type: 'word-drill:open-review' });
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
    })(),
  );
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'word-drill-due-check') {
    event.waitUntil(checkAndNotify({ reason: 'periodic-sync' }));
  }
});

/* ---------- local reminder check (best effort; no push server) ---------- */

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('word-drill', 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('words')) {
        const words = db.createObjectStore('words', { keyPath: 'id' });
        words.createIndex('text', 'text', { unique: true });
        words.createIndex('group', 'group', { unique: false });
        words.createIndex('nextReviewAt', 'nextReviewAt', { unique: false });
        words.createIndex('lastReviewedAt', 'lastReviewedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('books')) {
        const books = db.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readState() {
  const db = await openDb();
  const tx = db.transaction(['words', 'meta'], 'readonly');
  const words = await idbRequest(tx.objectStore('words').getAll());
  const settingsRow = await idbRequest(tx.objectStore('meta').get('settings'));
  const gateRow = await idbRequest(tx.objectStore('meta').get('eGate'));
  const sentRow = await idbRequest(tx.objectStore('meta').get('notifySent'));
  db.close();

  const settings = settingsRow?.value ?? {};
  return {
    words,
    settings: {
      reviewEnabled: { A: true, B: true, C: true, D: true, E: true, ...(settings.reviewEnabled || {}) },
      notificationEnabled: settings.notificationEnabled !== false,
      notificationTimes: Array.isArray(settings.notificationTimes)
        ? settings.notificationTimes
        : ['10:00', '20:00'],
      eGroupDailyLimit: Number.isFinite(Number(settings.eGroupDailyLimit))
        ? Number(settings.eGroupDailyLimit)
        : 10,
    },
    gate: gateRow?.value ?? null,
    sent: sentRow?.value ?? {},
  };
}

function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function minutesOfDay(hhmm) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(hhmm ?? ''));
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

function latestSlot(times, now = new Date()) {
  const nowMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const valid = (Array.isArray(times) ? times : [])
    .map((time) => ({ time, minutes: minutesOfDay(time) }))
    .filter((item) => item.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes);
  for (let i = valid.length - 1; i >= 0; i -= 1) {
    if (valid[i].minutes <= nowMinutes) return valid[i].time;
  }
  return null;
}

function countDue(state, now = Date.now()) {
  const { words, settings, gate } = state;
  const today = dateKey(new Date(now));
  const gateIds = new Set(gate?.date === today && Array.isArray(gate.ids) ? gate.ids : []);
  let count = 0;

  for (const word of words) {
    if (!['A', 'B', 'C', 'D', 'E'].includes(word.group)) continue;
    if (!settings.reviewEnabled[word.group]) continue;
    if (!Number.isFinite(word.nextReviewAt) || word.nextReviewAt > now) continue;
    if (word.group === 'E') {
      if (gate?.date === today) {
        if (!gateIds.has(word.id)) continue;
      } else {
        // No gate yet for today: count the capped E set below instead.
        continue;
      }
    }
    count += 1;
  }

  if (!gate || gate.date !== today) {
    const eDue = words.filter(
      (word) =>
        word.group === 'E' &&
        settings.reviewEnabled.E &&
        Number.isFinite(word.nextReviewAt) &&
        word.nextReviewAt <= now,
    );
    const limit = Math.max(0, Math.min(100, Number(settings.eGroupDailyLimit) || 0));
    count += Math.min(eDue.length, limit);
  }
  return count;
}

async function checkAndNotify({ reason } = {}) {
  try {
    if (!self.registration?.showNotification) return;
    const state = await readState();
    if (!state.settings.notificationEnabled) return;

    const now = new Date();
    const slot = latestSlot(state.settings.notificationTimes, now);
    if (!slot) return;
    const key = `${dateKey(now)}|${slot}`;
    if (state.sent[key]) return;

    const dueCount = countDue(state, now.getTime());
    if (dueCount <= 0) return;

    await self.registration.showNotification(`有 ${dueCount} 个词到复习时间了`, {
      body: '点开继续「看看不认识」· 词潮',
      tag: 'word-drill-due',
      renotify: false,
      icon: new URL('./icons/icon-192.png', self.registration.scope).href,
      badge: new URL('./icons/badge-96.png', self.registration.scope).href,
      data: { url: new URL('./?review=1', self.registration.scope).href },
    });

    state.sent[key] = Date.now();
    const keys = Object.keys(state.sent).sort();
    while (keys.length > 20) delete state.sent[keys.shift()];

    const db = await openDb();
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key: 'notifySent', value: state.sent });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (error) {
    // Notifications are a best-effort enhancement; never crash the SW.
    console.warn('word-drill: periodic notification check failed', reason, error);
  }
}
