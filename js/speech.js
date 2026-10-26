/**
 * speech.js — Browser Web Speech API (no network).
 *
 * One utterance per call, en-US, local voice preferred. The service cancels
 * any previous utterance so a rapid "不认识" tap never queues a second read.
 */

const PREFERRED_VOICE_HINTS = [
  'samantha',
  'ava',
  'allison',
  'aria',
  'jenny',
  'guy',
  'zira',
  'google us english',
  'microsoft',
  'natural',
];

class SpeechService {
  constructor() {
    this.supported =
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      'SpeechSynthesisUtterance' in window;
    this.voice = null;
    this.voices = [];
    this.lastSpoken = '';
    if (this.supported) {
      this.refreshVoices();
      window.speechSynthesis.addEventListener?.('voiceschanged', () => this.refreshVoices());
    }
  }

  refreshVoices() {
    if (!this.supported) return;
    const voices = window.speechSynthesis.getVoices?.() ?? [];
    this.voices = voices;
    this.voice = this.pickVoice(voices);
  }

  pickVoice(voices) {
    const english = voices.filter((voice) => /^en(-|_)/i.test(voice.lang ?? ''));
    const us = english.filter((voice) => /^en[-_]US$/i.test(voice.lang ?? ''));
    const pool = us.length ? us : english;
    if (!pool.length) return null;

    const score = (voice) => {
      const name = String(voice.name ?? '').toLowerCase();
      let value = 0;
      if (voice.localService) value += 100;
      if (voice.default) value += 10;
      PREFERRED_VOICE_HINTS.forEach((hint, index) => {
        if (name.includes(hint)) value += 60 - index * 3;
      });
      if (name.includes('compact') || name.includes('eloquence')) value -= 30;
      return value;
    };

    return pool.slice().sort((a, b) => score(b) - score(a))[0] ?? null;
  }

  speak(text) {
    if (!this.supported) return false;
    const clean = String(text ?? '').trim();
    if (!clean) return false;

    if (!this.voice) this.refreshVoices();
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = 'en-US';
    utterance.rate = 0.86;
    utterance.pitch = 1;
    utterance.volume = 1;
    if (this.voice) utterance.voice = this.voice;

    this.lastSpoken = clean;
    window.speechSynthesis.speak(utterance);
    return true;
  }

  stop() {
    if (!this.supported) return;
    window.speechSynthesis.cancel();
  }

  describe() {
    if (!this.supported) return { supported: false, voice: null, count: 0 };
    return {
      supported: true,
      voice: this.voice?.name ?? null,
      lang: this.voice?.lang ?? 'en-US',
      count: this.voices.length,
    };
  }
}

export const speech = new SpeechService();
