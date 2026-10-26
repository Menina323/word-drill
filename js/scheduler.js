/**
 * scheduler.js — pure scheduling rules for Word Drill.
 *
 * Nothing in this module touches the DOM, IndexedDB, speech or notifications,
 * so every rule below is directly unit-testable in Node.
 */

export const MINUTE = 60_000;
export const ACTIVE_GROUPS = ['A', 'B', 'C', 'D', 'E'];
export const GROUP_DESC = ['E', 'D', 'C', 'B', 'A'];

export const REVEAL_SPEEDS = {
  fast: { label: '快', ms: 500 },
  normal: { label: '标准', ms: 2000 },
  slow: { label: '慢', ms: 3200 },
};

export const GROUP_INFO = {
  A: {
    name: '初遇',
    condition: '答错 1 次',
    sequence: [10, 1440],
    sequenceLabel: '10 分钟 → 1 天',
  },
  B: {
    name: '反复',
    condition: '答错 2 次',
    sequence: [1440, 4320],
    sequenceLabel: '1 天 → 3 天',
  },
  C: {
    name: '顽固',
    condition: '答错 3 次',
    sequence: [4320, 10080],
    sequenceLabel: '3 天 → 7 天',
  },
  D: {
    name: '高危',
    condition: '答错 4 次',
    sequence: [10080, 21600],
    sequenceLabel: '7 天 → 15 天',
  },
  E: {
    name: '冰封',
    condition: '答错 ≥ 5 次',
    sequence: [21600, 43200],
    sequenceLabel: '15 天 → 30 天',
  },
};

export const DEFAULT_SETTINGS = {
  reviewEnabled: { A: true, B: true, C: true, D: true, E: true },
  notificationEnabled: true,
  notificationTimes: ['10:00', '20:00'],
  soundEnabled: true,
  eGroupDailyLimit: 10,
  theme: 'auto',
  revealSpeed: 'normal',
};

export const GROUP_RANK = { E: 5, D: 4, C: 3, B: 2, A: 1 };
export const TOO_EASY_STREAK = 5;
export const WINDOW_SIZE = 3;

export function createWord({ text, phonetic = '', definition = '' }, now = Date.now()) {
  const cleanText = String(text ?? '').trim();
  if (!cleanText) throw new Error('Word text is empty');
  return {
    id: newId(),
    text: cleanText,
    phonetic: String(phonetic ?? '').trim(),
    definition: String(definition ?? '').trim(),
    unknownCount: 0,
    group: 'new',
    intervalIndex: 0,
    nextReviewAt: null,
    streakCorrect: 0,
    recentResults: [],
    createdAt: now,
    lastReviewedAt: null,
  };
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function groupForUnknownCount(n) {
  if (n <= 0) return null;
  if (n >= 5) return 'E';
  return ['A', 'B', 'C', 'D'][n - 1] ?? 'E';
}

export function isNewWord(word) {
  return (
    word.group === 'new' &&
    (word.unknownCount ?? 0) === 0 &&
    (word.lastReviewedAt === null || word.lastReviewedAt === undefined)
  );
}

export function isActiveGroup(group) {
  return ACTIVE_GROUPS.includes(group);
}

export function isDue(word, now = Date.now()) {
  return isActiveGroup(word.group) && Number.isFinite(word.nextReviewAt) && word.nextReviewAt <= now;
}

export function downGroup(group) {
  const index = ACTIVE_GROUPS.indexOf(group);
  if (index <= 0) return group;
  return ACTIVE_GROUPS[index - 1];
}

function pushRecent(recentResults, result) {
  const next = Array.isArray(recentResults) ? recentResults.slice(-(WINDOW_SIZE - 1)) : [];
  next.push(Boolean(result));
  return next;
}

export function answerUnknown(word, now = Date.now()) {
  const unknownCount = (word.unknownCount ?? 0) + 1;
  const group = groupForUnknownCount(unknownCount);
  return {
    ...word,
    unknownCount,
    group,
    intervalIndex: 0,
    nextReviewAt: now + GROUP_INFO[group].sequence[0] * MINUTE,
    streakCorrect: 0,
    recentResults: pushRecent(word.recentResults, false),
    lastReviewedAt: now,
  };
}

/**
 * Handle one "认识" tap.
 *
 * New words graduate immediately (they are known on first sight and have no
 * Leitner sequence yet). Review words advance the interval, except that:
 *  - 5 consecutive review-correct answers turn the word into `tooEasy`;
 *  - a C/D/E word whose last 3 answers are all correct slides one group down
 *    toward A. This window does not touch unknownCount or streakCorrect.
 *
 * The last interval is repeated while the streak climbs toward 5, so the
 * "5 in a row" rule is reachable for every group (the shortest sequence has
 * only two steps). The result is still deterministic and never silently
 * loses a review word before its streak is decided.
 */
export function answerKnown(word, { fromReview = false, now = Date.now() } = {}) {
  const recentResults = pushRecent(word.recentResults, true);
  const streakCorrect =
    (word.streakCorrect ?? 0) + (fromReview && word.group !== 'new' ? 1 : 0);
  const base = {
    ...word,
    recentResults,
    streakCorrect,
    lastReviewedAt: now,
  };

  if (word.group === 'new') {
    return {
      ...base,
      group: 'mastered',
      intervalIndex: 0,
      nextReviewAt: null,
    };
  }

  if (!isActiveGroup(word.group)) return base;

  if (streakCorrect >= TOO_EASY_STREAK) {
    return {
      ...base,
      group: 'tooEasy',
      intervalIndex: 0,
      nextReviewAt: null,
    };
  }

  const allThreeCorrect =
    recentResults.length === WINDOW_SIZE && recentResults.every(Boolean);
  if (['C', 'D', 'E'].includes(word.group) && allThreeCorrect) {
    const group = downGroup(word.group);
    return {
      ...base,
      group,
      intervalIndex: 0,
      nextReviewAt: now + GROUP_INFO[group].sequence[0] * MINUTE,
    };
  }

  const sequence = GROUP_INFO[word.group].sequence;
  const nextIndex = Math.min((word.intervalIndex ?? 0) + 1, sequence.length - 1);
  return {
    ...base,
    group: word.group,
    intervalIndex: nextIndex,
    nextReviewAt: now + sequence[nextIndex] * MINUTE,
  };
}

export function answerTooEasy(word, now = Date.now()) {
  return {
    ...word,
    group: 'tooEasy',
    intervalIndex: 0,
    nextReviewAt: null,
    streakCorrect: 0,
    lastReviewedAt: now,
  };
}

export function compareReviewWords(a, b, now = Date.now()) {
  const aDue = isDue(a, now) ? 0 : 1;
  const bDue = isDue(b, now) ? 0 : 1;
  if (aDue !== bDue) return aDue - bDue;

  const aRank = GROUP_RANK[a.group] ?? 0;
  const bRank = GROUP_RANK[b.group] ?? 0;
  if (aRank !== bRank) return bRank - aRank;

  const aUnknown = a.unknownCount ?? 0;
  const bUnknown = b.unknownCount ?? 0;
  if (aUnknown !== bUnknown) return bUnknown - aUnknown;

  const aNext = a.nextReviewAt ?? Number.MAX_SAFE_INTEGER;
  const bNext = b.nextReviewAt ?? Number.MAX_SAFE_INTEGER;
  if (aNext !== bNext) return aNext - bNext;

  return a.text.localeCompare(b.text, 'en');
}

export function buildNewQueue(words) {
  return words.filter(isNewWord).sort((a, b) => {
    const created = (a.createdAt ?? 0) - (b.createdAt ?? 0);
    if (created !== 0) return created;
    return a.text.localeCompare(b.text, 'en');
  });
}

export function compareEGateWords(a, b, now = Date.now()) {
  const aDue = isDue(a, now) ? 0 : 1;
  const bDue = isDue(b, now) ? 0 : 1;
  if (aDue !== bDue) return aDue - bDue;
  const aUnknown = a.unknownCount ?? 0;
  const bUnknown = b.unknownCount ?? 0;
  if (aUnknown !== bUnknown) return bUnknown - aUnknown;
  return (a.nextReviewAt ?? 0) - (b.nextReviewAt ?? 0);
}

/**
 * Pick the E-group words that are allowed into review queues today.
 * Previously admitted words stay admitted for the local day; free slots are
 * filled from the most overdue / most-missed E words first.
 */
export function selectEGate(words, settings, previousGate, now = Date.now()) {
  const limit = Math.max(0, Math.min(100, Number(settings.eGroupDailyLimit) || 0));
  if (!settings.reviewEnabled?.E || limit === 0) return [];

  const eWords = words.filter((word) => word.group === 'E');
  const byId = new Map(eWords.map((word) => [word.id, word]));
  const selected = [];
  const seen = new Set();

  const previousIds = Array.isArray(previousGate?.ids) ? previousGate.ids : [];
  for (const id of previousIds) {
    if (selected.length >= limit) break;
    if (byId.has(id) && !seen.has(id)) {
      selected.push(id);
      seen.add(id);
    }
  }

  const candidates = eWords.slice().sort((a, b) => compareEGateWords(a, b, now));
  for (const word of candidates) {
    if (selected.length >= limit) break;
    if (!seen.has(word.id)) {
      selected.push(word.id);
      seen.add(word.id);
    }
  }
  return selected;
}

export function buildReviewQueue(words, settings, eGateIds, now = Date.now()) {
  const eAllowed = new Set(Array.isArray(eGateIds) ? eGateIds : []);
  return words
    .filter((word) => {
      if (!isActiveGroup(word.group)) return false;
      if (!settings.reviewEnabled?.[word.group]) return false;
      if (word.group === 'E' && !eAllowed.has(word.id)) return false;
      return true;
    })
    .sort((a, b) => compareReviewWords(a, b, now));
}

export function getDueWords(reviewQueue, now = Date.now()) {
  return reviewQueue.filter((word) => isDue(word, now));
}

export function getStats(words, settings, eGateIds, now = Date.now()) {
  const newCount = words.filter(isNewWord).length;
  const reviewQueue = buildReviewQueue(words, settings, eGateIds, now);
  const dueCount = getDueWords(reviewQueue, now).length;
  const missingPhonetic = words.filter((word) => !String(word.phonetic ?? '').trim()).length;
  return {
    total: words.length,
    newCount,
    reviewCount: reviewQueue.length,
    dueCount,
    missingPhonetic,
  };
}

export function groupBreakdown(words, settings, eGateIds, now = Date.now()) {
  const queue = buildReviewQueue(words, settings, eGateIds, now);
  const due = getDueWords(queue, now);
  return GROUP_DESC.map((group) => ({
    group,
    active: queue.filter((word) => word.group === group).length,
    due: due.filter((word) => word.group === group).length,
  }));
}

export function formatMinutes(minutes) {
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} 小时`;
  const days = minutes / 1440;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} 天`;
}

export function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDueLabel(nextReviewAt, now = Date.now()) {
  if (!Number.isFinite(nextReviewAt)) return '未安排';
  const diff = nextReviewAt - now;
  if (diff <= 0) {
    const overdue = Math.abs(diff);
    if (overdue < MINUTE) return '刚刚到期';
    if (overdue < 60 * MINUTE) return `已过期 ${Math.round(overdue / MINUTE)} 分钟`;
    if (overdue < 1440 * MINUTE) return `已过期 ${Math.round(overdue / (60 * MINUTE))} 小时`;
    return `已过期 ${Math.round(overdue / (1440 * MINUTE))} 天`;
  }
  if (diff < 60 * MINUTE) return `${Math.max(1, Math.round(diff / MINUTE))} 分钟后`;
  if (diff < 1440 * MINUTE) return `${Math.round(diff / (60 * MINUTE))} 小时后`;
  return `${Math.round(diff / (1440 * MINUTE))} 天后`;
}
