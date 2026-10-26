/**
 * notify.js — local review reminders through the Notification API and the
 * service worker. There is no push service and no network call.
 */

import { localDateKey } from './scheduler.js';
import { wordStore } from './store.js';

const MAX_SENT_HISTORY = 20;

function minutesOfDay(hhmm) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(hhmm ?? ''));
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

function slotDate(date, hhmm) {
  const minutes = minutesOfDay(hhmm);
  if (minutes === null) return null;
  const result = new Date(date);
  result.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return result;
}

export function latestElapsedSlot(times, now = new Date()) {
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

export function nextSlotDate(times, now = new Date()) {
  const valid = (Array.isArray(times) ? times : [])
    .map((time) => ({ time, minutes: minutesOfDay(time) }))
    .filter((item) => item.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes);
  if (!valid.length) return null;

  for (const item of valid) {
    const candidate = slotDate(now, item.time);
    if (candidate && candidate.getTime() > now.getTime() + 500) return candidate;
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return slotDate(tomorrow, valid[0].time);
}

class Notifier {
  constructor() {
    this.registration = null;
    this.getDueCount = async () => 0;
    this.onOpenReview = () => {};
    this.settings = null;
    this.timer = null;
    this.interval = null;
    this.checking = false;
    this.visibilityBound = false;
    this.initialized = false;
  }

  get supported() {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  permission() {
    if (!this.supported) return 'unsupported';
    return Notification.permission;
  }

  async init({ getDueCount, onOpenReview, settings } = {}) {
    this.getDueCount = getDueCount ?? this.getDueCount;
    this.onOpenReview = onOpenReview ?? this.onOpenReview;
    this.settings = settings ?? this.settings;

    if (this.initialized) {
      this.refresh(settings);
      return;
    }
    this.initialized = true;

    if ('serviceWorker' in navigator) {
      try {
        this.registration = await navigator.serviceWorker.register('./sw.js');
        await navigator.serviceWorker.ready;
        this.registration = (await navigator.serviceWorker.getRegistration()) ?? this.registration;
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data?.type === 'word-drill:open-review') {
            this.onOpenReview();
          }
        });
      } catch (error) {
        console.warn('word-drill: service worker registration failed', error);
      }
    }

    if (!this.visibilityBound) {
      this.visibilityBound = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.safeCheck({ reason: 'visible' });
      });
      window.addEventListener('pageshow', () => this.safeCheck({ reason: 'pageshow' }));
    }

    await this.registerPeriodicSync();
    this.refresh(settings);
    // A gentle catch-up on launch: only the latest elapsed slot is eligible,
    // and only when due words exist and that slot was not already sent.
    setTimeout(() => this.safeCheck({ reason: 'launch' }), 1200);
  }

  safeCheck(options = {}) {
    this.check(options).catch((error) => {
      console.warn('word-drill: notification check failed', error);
    });
  }

  async registerPeriodicSync() {
    if (!this.registration || !('periodicSync' in this.registration)) return;
    try {
      const status = await navigator.permissions?.query?.({ name: 'periodic-background-sync' });
      if (status && status.state !== 'granted') return;
    } catch {
      // Permissions API support varies; registration itself is harmless.
    }
    try {
      await this.registration.periodicSync.register('word-drill-due-check', {
        minInterval: 30 * 60 * 1000,
      });
    } catch {
      // Chrome-only enhancement; page timers remain the baseline.
    }
  }

  async requestPermission() {
    if (!this.supported) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    try {
      return await Notification.requestPermission();
    } catch {
      return 'denied';
    }
  }

  refresh(settings) {
    if (settings) this.settings = settings;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (!this.settings?.notificationEnabled) return;
    if (this.permission() !== 'granted') return;

    const now = new Date();
    const next = nextSlotDate(this.settings.notificationTimes, now);
    if (next) {
      const delay = Math.max(1000, Math.min(next.getTime() - now.getTime(), 2_147_000_000));
      this.timer = setTimeout(() => {
        this.check({ reason: 'scheduled' })
          .catch((error) => console.warn('word-drill: scheduled notification failed', error))
          .finally(() => this.refresh(this.settings));
      }, delay);
    }

    this.interval = setInterval(() => {
      this.safeCheck({ reason: 'interval' });
    }, 15 * 60 * 1000);
  }

  async check({ manual = false, allowZero = false, reason = 'manual' } = {}) {
    if (this.checking) return { shown: false, reason: 'busy' };
    this.checking = true;
    try {
      const settings = this.settings;
      if (!manual && !settings?.notificationEnabled) return { shown: false, reason: 'disabled' };
      if (manual && !this.supported) throw new Error('当前浏览器不支持通知');
      if (manual && this.permission() !== 'granted') {
        throw new Error('请先允许通知权限');
      }
      if (!manual && this.permission() !== 'granted') return { shown: false, reason: 'permission' };

      const now = new Date();
      const slot = manual ? 'manual' : latestElapsedSlot(settings?.notificationTimes ?? [], now);
      if (!manual && !slot) return { shown: false, reason: 'no-slot' };

      const dueCount = await this.getDueCount();
      if (!dueCount && !(manual && allowZero)) {
        return { shown: false, reason: 'no-due', dueCount };
      }

      const dateKey = localDateKey(now);
      const sent = (await wordStore.getMeta('notifySent', {})) || {};
      const sentKey = `${dateKey}|${slot}`;
      if (!manual && sent[sentKey]) return { shown: false, reason: 'already-sent', dueCount };

      const title = dueCount
        ? `有 ${dueCount} 个词到复习时间了`
        : '通知已就绪';
      const body = dueCount
        ? '点开继续「看看不认识」· 词潮'
        : '目前没有到期词。提醒会在这台设备上本地触发。';
      const options = {
        body,
        tag: 'word-drill-due',
        renotify: false,
        icon: new URL('./icons/icon-192.png', document.baseURI).href,
        badge: new URL('./icons/badge-96.png', document.baseURI).href,
        data: {
          url: new URL('./?review=1', document.baseURI).href,
        },
      };

      let shownBy = 'service-worker';
      if (this.registration?.showNotification) {
        await this.registration.showNotification(title, options);
      } else if (this.supported) {
        const fallback = new Notification(title, options);
        fallback.onclick = () => {
          window.focus();
          this.onOpenReview();
          fallback.close();
        };
        shownBy = 'window';
      } else {
        throw new Error('通知通道不可用');
      }

      if (!manual) {
        sent[sentKey] = Date.now();
        const keys = Object.keys(sent).sort();
        while (keys.length > MAX_SENT_HISTORY) {
          const old = keys.shift();
          delete sent[old];
        }
        await wordStore.setMeta('notifySent', sent);
      }

      return { shown: true, dueCount, slot, shownBy, reason };
    } finally {
      this.checking = false;
    }
  }
}

export const notifier = new Notifier();
export { minutesOfDay };
