/**
 * «Перекур» — звуки через Web Audio API.
 * Системные звуки Windows браузеру недоступны, поэтому в комплекте — синтезированные
 * сигналы. Кроме того, можно загрузить свой файл (он хранится в localStorage в data URL
 * под ключом CUSTOM_SOUND_KEY — отдельно от настроек).
 */

export const CUSTOM_SOUND_KEY = 'perekur.web.customSound';
export const CUSTOM_SOUND_ID = 'custom';

let ctx = null;

/** Создать/возобновить AudioContext. Вызывать по жесту пользователя. */
export function primeAudio() {
  try {
    if (!ctx) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
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

export const SOUND_DEFS = [
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

/** Сохранённый пользователем звук {name, data(dataURL)} или null. */
export function loadCustomSound() {
  try {
    const raw = localStorage.getItem(CUSTOM_SOUND_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.data === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCustomSound(custom) {
  if (custom === null) { localStorage.removeItem(CUSTOM_SOUND_KEY); return; }
  localStorage.setItem(CUSTOM_SOUND_KEY, JSON.stringify(custom));
}

export function removeCustomSound() {
  localStorage.removeItem(CUSTOM_SOUND_KEY);
}

function beepFallback() {
  note({ freq: A5, duration: 0.4, peak: 0.25 });
}

/** Воспроизвести звук по идентификатору (встроенный синтез или пользовательский файл). */
export function playSound(soundId) {
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
