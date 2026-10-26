/**
 * store.js — IndexedDB persistence.
 *
 * The database lives entirely in the browser (origin-scoped IndexedDB). No
 * host storage, network, localStorage or cookies are used for vocabulary or
 * review state.
 */

import { createWord, DEFAULT_SETTINGS, newId } from './scheduler.js';

export const DB_NAME = 'word-drill';
export const DB_VERSION = 1;
export const WORDS = 'words';
export const META = 'meta';

function assertIndexedDb() {
  if (!globalThis.indexedDB) {
    throw new Error('当前浏览器不支持 IndexedDB，无法保存学习进度');
  }
}

function requestDone(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')), {
      once: true,
    });
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.addEventListener('complete', () => resolve(), { once: true });
    tx.addEventListener('abort', () => reject(tx.error ?? new Error('IndexedDB transaction aborted')), {
      once: true,
    });
    tx.addEventListener('error', () => reject(tx.error ?? new Error('IndexedDB transaction failed')), {
      once: true,
    });
  });
}

function sanitizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const reviewEnabled = { ...DEFAULT_SETTINGS.reviewEnabled };
  for (const group of ['A', 'B', 'C', 'D', 'E']) {
    if (typeof source.reviewEnabled?.[group] === 'boolean') {
      reviewEnabled[group] = source.reviewEnabled[group];
    }
  }

  let times = Array.isArray(source.notificationTimes)
    ? source.notificationTimes.filter((time) => /^\d{2}:\d{2}$/.test(String(time)))
    : DEFAULT_SETTINGS.notificationTimes.slice();
  times = [...new Set(times)].slice(0, 2);

  return {
    reviewEnabled,
    notificationEnabled:
      typeof source.notificationEnabled === 'boolean'
        ? source.notificationEnabled
        : DEFAULT_SETTINGS.notificationEnabled,
    notificationTimes: times,
    soundEnabled:
      typeof source.soundEnabled === 'boolean' ? source.soundEnabled : DEFAULT_SETTINGS.soundEnabled,
    eGroupDailyLimit: Number.isFinite(Number(source.eGroupDailyLimit))
      ? Math.max(0, Math.min(100, Math.round(Number(source.eGroupDailyLimit))))
      : DEFAULT_SETTINGS.eGroupDailyLimit,
    theme: ['auto', 'light', 'dark'].includes(source.theme) ? source.theme : DEFAULT_SETTINGS.theme,
    revealSpeed: ['fast', 'normal', 'slow'].includes(source.revealSpeed)
      ? source.revealSpeed
      : DEFAULT_SETTINGS.revealSpeed,
  };
}

export class WordStore {
  constructor() {
    this.dbPromise = null;
  }

  open() {
    assertIndexedDb();
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.addEventListener('upgradeneeded', () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(WORDS)) {
          const words = db.createObjectStore(WORDS, { keyPath: 'id' });
          words.createIndex('text', 'text', { unique: true });
          words.createIndex('group', 'group', { unique: false });
          words.createIndex('nextReviewAt', 'nextReviewAt', { unique: false });
          words.createIndex('lastReviewedAt', 'lastReviewedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META, { keyPath: 'key' });
        }
      });
      request.addEventListener('success', () => {
        const db = request.result;
        db.addEventListener('versionchange', () => {
          db.close();
          this.dbPromise = null;
        });
        resolve(db);
      });
      request.addEventListener('error', () => {
        this.dbPromise = null;
        reject(request.error ?? new Error('IndexedDB open failed'));
      });
      request.addEventListener('blocked', () => {
        // Another tab keeps an old version open. The request may still succeed
        // after that tab closes; surface the wait in the console for debugging.
        console.warn('word-drill: IndexedDB upgrade is blocked by another tab');
      });
    });

    return this.dbPromise;
  }

  async transaction(storeName, mode, work) {
    const db = await this.open();
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = work(store, tx);
      await transactionDone(tx);
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // already settled
      }
      throw error;
    }
  }

  async getAllWords() {
    const db = await this.open();
    const tx = db.transaction(WORDS, 'readonly');
    const request = tx.objectStore(WORDS).getAll();
    const words = await requestDone(request);
    return words;
  }

  async getWord(id) {
    const db = await this.open();
    const tx = db.transaction(WORDS, 'readonly');
    return requestDone(tx.objectStore(WORDS).get(id));
  }

  async getWordByText(text) {
    const db = await this.open();
    const tx = db.transaction(WORDS, 'readonly');
    return requestDone(tx.objectStore(WORDS).index('text').get(text));
  }

  async putWord(word) {
    const db = await this.open();
    const tx = db.transaction(WORDS, 'readwrite');
    tx.objectStore(WORDS).put(word);
    await transactionDone(tx);
    return word;
  }

  async addWord({ text, phonetic = '', definition = '' }, now = Date.now()) {
    const word = createWord({ text, phonetic, definition }, now);
    await this.putWord(word);
    return word;
  }

  async deleteWord(id) {
    const db = await this.open();
    const tx = db.transaction(WORDS, 'readwrite');
    tx.objectStore(WORDS).delete(id);
    await transactionDone(tx);
  }

  async getMeta(key, fallback = null) {
    const db = await this.open();
    const tx = db.transaction(META, 'readonly');
    const row = await requestDone(tx.objectStore(META).get(key));
    return row ? row.value : fallback;
  }

  async setMeta(key, value) {
    const db = await this.open();
    const tx = db.transaction(META, 'readwrite');
    tx.objectStore(META).put({ key, value });
    await transactionDone(tx);
    return value;
  }

  async deleteMeta(key) {
    const db = await this.open();
    const tx = db.transaction(META, 'readwrite');
    tx.objectStore(META).delete(key);
    await transactionDone(tx);
  }

  async getSettings() {
    return sanitizeSettings(await this.getMeta('settings', null));
  }

  async saveSettings(settings) {
    const clean = sanitizeSettings(settings);
    await this.setMeta('settings', clean);
    return clean;
  }

  /**
   * Merge imported entries into the library.
   * Existing words keep every progress field; only blank phonetic/definition
   * fields are filled. Text is the unique key.
   */
  async importEntries(entries, { now = Date.now(), sourceTotal = null, duplicatesInInput = 0 } = {}) {
    const cleanEntries = [];
    const seen = new Set();
    let computedDuplicates = 0;
    for (const entry of entries ?? []) {
      const text = String(entry?.text ?? '').trim();
      if (!text) continue;
      if (seen.has(text)) {
        computedDuplicates += 1;
        continue;
      }
      seen.add(text);
      cleanEntries.push({
        text,
        phonetic: String(entry?.phonetic ?? '').trim(),
        definition: String(entry?.definition ?? '').trim(),
      });
    }
    const duplicates = Math.max(Number(duplicatesInInput) || 0, computedDuplicates);
    const total = Number.isFinite(Number(sourceTotal))
      ? Math.max(Number(sourceTotal), cleanEntries.length + duplicates)
      : cleanEntries.length + duplicates;

    const db = await this.open();
    const tx = db.transaction(WORDS, 'readwrite');
    const store = tx.objectStore(WORDS);
    const all = await requestDone(store.getAll());
    const byText = new Map(all.map((word) => [word.text, word]));
    const finalWords = all.slice();
    let added = 0;
    let skipped = 0;
    let supplemented = 0;

    cleanEntries.forEach((entry, index) => {
      const existing = byText.get(entry.text);
      if (existing) {
        skipped += 1;
        let changed = false;
        if (!String(existing.phonetic ?? '').trim() && entry.phonetic) {
          existing.phonetic = entry.phonetic;
          changed = true;
        }
        if (!String(existing.definition ?? '').trim() && entry.definition) {
          existing.definition = entry.definition;
          changed = true;
        }
        if (changed) {
          supplemented += 1;
          store.put(existing);
        }
        return;
      }

      const word = createWord(entry, now + index);
      finalWords.push(word);
      byText.set(word.text, word);
      store.put(word);
      added += 1;
    });

    await transactionDone(tx);
    const missingPhonetic = finalWords.filter((word) => !String(word.phonetic ?? '').trim()).length;

    return {
      total,
      added,
      skipped: skipped + duplicates,
      supplemented,
      duplicatesInInput: duplicates,
      libraryTotal: finalWords.length,
      missingPhonetic,
    };
  }

  /**
   * Fill phonetic fields from a word,phonetic CSV. Matching is exact on text.
   */
  async backfillPhonetics(rows, { overwrite = false } = {}) {
    const pairs = [];
    const seen = new Set();
    for (const row of rows ?? []) {
      const text = String(row?.text ?? '').trim();
      const phonetic = String(row?.phonetic ?? '').trim();
      if (!text || !phonetic || seen.has(text)) continue;
      seen.add(text);
      pairs.push({ text, phonetic });
    }

    const db = await this.open();
    const tx = db.transaction(WORDS, 'readwrite');
    const store = tx.objectStore(WORDS);
    const all = await requestDone(store.getAll());
    const byText = new Map(all.map((word) => [word.text, word]));
    let matched = 0;
    let updated = 0;
    let unchanged = 0;
    const missing = [];

    for (const pair of pairs) {
      const word = byText.get(pair.text);
      if (!word) {
        missing.push(pair.text);
        continue;
      }
      matched += 1;
      if (overwrite || !String(word.phonetic ?? '').trim()) {
        if (word.phonetic === pair.phonetic) {
          unchanged += 1;
          continue;
        }
        word.phonetic = pair.phonetic;
        store.put(word);
        updated += 1;
      } else {
        unchanged += 1;
      }
    }

    await transactionDone(tx);
    const libraryMissing = all.filter((word) => !String(word.phonetic ?? '').trim()).length;
    return {
      total: pairs.length,
      matched,
      updated,
      unchanged,
      missing,
      libraryMissing,
    };
  }

  async exportData(settings) {
    const [words, storedSettings, eGate] = await Promise.all([
      this.getAllWords(),
      this.getSettings(),
      this.getMeta('eGate', null),
    ]);
    return {
      app: 'word-drill',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: settings ?? storedSettings,
      eGate,
      words,
    };
  }

  /**
   * Restore a backup produced by exportData. This replaces the word library and
   * settings on this origin, preserving full review progress fields.
   */
  async restoreBackup(data) {
    if (!data || data.app !== 'word-drill' || !Array.isArray(data.words)) {
      throw new Error('这不是词潮的学习备份文件');
    }

    const groups = new Set(['new', 'A', 'B', 'C', 'D', 'E', 'mastered', 'tooEasy']);
    const byText = new Map();
    for (const raw of data.words) {
      const text = String(raw?.text ?? '').trim();
      if (!text) continue;
      byText.set(text, {
        id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
        text,
        phonetic: String(raw.phonetic ?? '').trim(),
        definition: String(raw.definition ?? '').trim(),
        unknownCount: Math.max(0, Math.round(Number(raw.unknownCount) || 0)),
        group: groups.has(raw.group) ? raw.group : 'new',
        intervalIndex: Math.max(0, Math.round(Number(raw.intervalIndex) || 0)),
        nextReviewAt:
          raw.nextReviewAt === null || raw.nextReviewAt === undefined || raw.nextReviewAt === ''
            ? null
            : Number.isFinite(Number(raw.nextReviewAt))
              ? Number(raw.nextReviewAt)
              : null,
        streakCorrect: Math.max(0, Math.round(Number(raw.streakCorrect) || 0)),
        recentResults: Array.isArray(raw.recentResults)
          ? raw.recentResults.slice(-3).map(Boolean)
          : [],
        createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : Date.now(),
        lastReviewedAt:
          raw.lastReviewedAt === null || raw.lastReviewedAt === undefined || raw.lastReviewedAt === ''
            ? null
            : Number.isFinite(Number(raw.lastReviewedAt))
              ? Number(raw.lastReviewedAt)
              : null,
      });
    }
    if (!byText.size) throw new Error('备份里没有有效单词');

    const currentSettings = await this.getSettings();
    const settings = sanitizeSettings(data.settings ?? currentSettings);
    const db = await this.open();
    const tx = db.transaction([WORDS, META], 'readwrite');
    const wordStore = tx.objectStore(WORDS);
    const metaStore = tx.objectStore(META);
    wordStore.clear();
    for (const word of byText.values()) wordStore.put(word);
    metaStore.put({ key: 'settings', value: settings });
    if (data.eGate?.date && Array.isArray(data.eGate.ids)) {
      metaStore.put({ key: 'eGate', value: { date: data.eGate.date, ids: data.eGate.ids } });
    } else {
      metaStore.delete('eGate');
    }
    await transactionDone(tx);
    return { restored: byText.size, settings };
  }

  async clearAll() {
    const db = await this.open();
    const tx = db.transaction([WORDS, META], 'readwrite');
    tx.objectStore(WORDS).clear();
    tx.objectStore(META).clear();
    await transactionDone(tx);
  }

  async requestPersistence() {
    if (!navigator.storage?.persist) return { supported: false, persisted: false };
    const persisted = await navigator.storage.persist();
    return { supported: true, persisted };
  }

  async estimateStorage() {
    if (!navigator.storage?.estimate) return null;
    try {
      return await navigator.storage.estimate();
    } catch {
      return null;
    }
  }
}

export const wordStore = new WordStore();
export { sanitizeSettings };
