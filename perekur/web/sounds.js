/**
 * «Перекур» — звуки через Web Audio API.
 * Системные звуки Windows веб-странице недоступны, поэтому в комплекте — синтезированные
 * сигналы. Свой файл можно загрузить и хранить локально (localStorage, data URL).
 * Работает и как классический <script> (window.PerekurSounds), и как модуль Node (для тестов).
 */
(function (root, factory) {
  const api = factory();
  root.PerekurSounds = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CUSTOM_SOUND_KEY = 'perekur.web.customSound';
  const CUSTOM_SOUND_ID = 'custom';

  let ctx = null;
  /** Загруженный звук хранится минимум в памяти вкладки, даже если localStorage недоступен. */
  let sessionCustomSound = null;

  /** Создать/возобновить AudioContext. Вызывать по жесту пользователя. */
  function primeAudio() {
    try {
      const AudioCtor = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (!AudioCtor) return null;
      if (!ctx) {
        ctx = new AudioCtor();
      }
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      return ctx;
    } catch {
      return null;
    }
  }

  /** Поддерживает ли браузер Web Audio. */
  function isAudioSupported() {
    return typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
  }

  function note({ freq, type = 'sine', start = 0, duration = 0.6, peak = 0.22, attack = 0.012 }) {
    const audio = primeAudio();
    if (!audio) return;
    const t0 = audio.currentTime + start;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0008, t0 + duration);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  const E5 = 659.25, B5 = 987.77, A5 = 880, C6 = 1046.5, D5 = 587.33, G5 = 783.99, F5 = 698.46, C5 = 523.25, A4 = 440, E4 = 329.63;

  const SOUND_DEFS = [
    { id: 'chimes', name: 'Колокольчик (chimes)', play: () => { note({ freq: E5, duration: 0.9 }); note({ freq: B5, start: 0.35, duration: 1.3 }); } },
    { id: 'bell', name: 'Колокол', play: () => { note({ freq: E5, type: 'triangle', duration: 1.8, peak: 0.3 }); note({ freq: E5 * 2, type: 'sine', duration: 1.2, peak: 0.08 }); } },
    { id: 'notify', name: 'Уведомление (тритон)', play: () => { [C5, E5, G5].forEach((freq, i) => note({ freq, start: i * 0.14, duration: 0.5 })); } },
    { id: 'marimba', name: 'Маримба, три ноты', play: () => { [G5, E5, C5].forEach((freq, i) => note({ freq, type: 'triangle', start: i * 0.19, duration: 0.55, peak: 0.28 })); } },
    { id: 'radar', name: 'Радар (пин)', play: () => { [0, 0.35].forEach(start => note({ freq: A5, type: 'sine', start, duration: 0.28, peak: 0.3 })); } },
    { id: 'alarm', name: 'Будильник', play: () => { [0, 0.28, 0.56].forEach(start => note({ freq: F5, type: 'square', start, duration: 0.16, peak: 0.12 })); } },
    { id: 'digital', name: 'Цифровой сигнал', play: () => { [A5, A5, C6].forEach((freq, i) => note({ freq, type: 'square', start: i * 0.12, duration: 0.1, peak: 0.1 })); } },
    { id: 'soft', name: 'Мягкий тон', play: () => { note({ freq: C5, duration: 2.2, peak: 0.16, attack: 0.35 }); note({ freq: E5, start: 0.5, duration: 1.8, peak: 0.1, attack: 0.35 }); } },
    { id: 'beacon', name: 'Маяк (длинный звонок)', play: () => { note({ freq: D5, duration: 1.1, peak: 0.25 }); note({ freq: D5, start: 1.25, duration: 1.6, peak: 0.25 }); } },
    { id: 'rising', name: 'Восходящая гамма', play: () => { [E4, A4, E5, A5].forEach((freq, i) => note({ freq, start: i * 0.16, duration: 0.5, peak: 0.2 })); } },
  ];

  /** Пользовательский звук: сначала localStorage, затем память вкладки. */
  function loadCustomSound() {
    if (sessionCustomSound) return sessionCustomSound;
    try {
      const raw = localStorage.getItem(CUSTOM_SOUND_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed.data === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * Сохранить пользовательский звук. Всегда держит копию в памяти вкладки,
   * поэтому звук добавится в список даже при заполненном localStorage.
   * Возвращает true, если звук сохранён и на диске (между перезапусками).
   */
  function saveCustomSound(custom) {
    if (custom === null) {
      sessionCustomSound = null;
      try { removeCustomSound(); } catch { /* ignore */ }
      return true;
    }
    sessionCustomSound = custom;
    try {
      localStorage.setItem(CUSTOM_SOUND_KEY, JSON.stringify(custom));
      return true;
    } catch {
      return false; // квота/приватный режим — звук живёт в памяти вкладки
    }
  }

  function removeCustomSound() {
    sessionCustomSound = null;
    try { localStorage.removeItem(CUSTOM_SOUND_KEY); } catch { /* ignore */ }
  }

  function beepFallback() {
    note({ freq: A5, duration: 0.4, peak: 0.25 });
  }

  /** Воспроизвести звук по идентификатору (встроенный синтез или пользовательский файл). */
  function playSound(soundId) {
    try {
      if (soundId === CUSTOM_SOUND_ID) {
        const custom = loadCustomSound();
        if (custom) {
          const audio = new Audio(custom.data);
          audio.volume = 0.9;
          audio.play().catch(() => beepFallback());
          return;
        }
        beepFallback();
        return;
      }
      const def = SOUND_DEFS.find(s => s.id === soundId) ?? SOUND_DEFS[0];
      def.play();
    } catch {
      beepFallback();
    }
  }

  return {
    CUSTOM_SOUND_ID,
    SOUND_DEFS,
    isAudioSupported,
    primeAudio,
    loadCustomSound,
    saveCustomSound,
    removeCustomSound,
    playSound,
  };
});
