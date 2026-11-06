/**
 * «Перекур» — веб-версия. Точка входа: состояние, DOM, таймер, уведомления.
 */

import {
  DEFAULT_SETTINGS,
  WORKDAYS,
  computeNext,
  formatNextRun,
  isRangeValid,
  minutesToTimeString,
  parseTimeToMinutes,
} from './scheduler.js';
import {
  CUSTOM_SOUND_ID,
  SOUND_DEFS,
  loadCustomSound,
  playSound,
  primeAudio,
  removeCustomSound,
  saveCustomSound,
} from './sounds.js';
import { TEMPLATES } from './templates.js';

const LS_SETTINGS = 'perekur.web.settings.v1';
const BASE_TITLE = 'Перекур — напоминание о перерывах';
const MAX_CUSTOM_SOUND_BYTES = 1_500_000;

const $ = (id) => document.getElementById(id);

/** @returns {typeof DEFAULT_SETTINGS} */
function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return { ...structuredClone(DEFAULT_SETTINGS), activeDays: [...WORKDAYS] };
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_SETTINGS),
      ...parsed,
      activeDays: Array.isArray(parsed?.activeDays) ? parsed.activeDays.filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : [...WORKDAYS],
    };
  } catch {
    return { ...structuredClone(DEFAULT_SETTINGS), activeDays: [...WORKDAYS] };
  }
}

const settings = loadSettings();
let nextRun = null;
let lastTriggered = null;
let flashTimer = null;
let overlayVisible = false;
let installPrompt = null;
/** Оригинальный href favicon, пока он не подменён красной точкой. */
let originalFaviconHref = null;

// =====================================================================
// Сохранение и пересчёт
// =====================================================================

function persist() {
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
  } catch {
    // localStorage недоступен/переполнен — приложение продолжает работать.
  }
}

function recompute() {
  nextRun = settings.enabled ? computeNext(settings, new Date()) : null;
  updateStatus();
}

function updateStatus() {
  const label = $('lblNext');
  const dot = $('statusDot');
  if (!label || !dot) return;

  const set = (text, tone) => {
    label.textContent = text;
    dot.dataset.tone = tone;
  };

  if (settings.mode === 'interval' && !isRangeValid(settings)) {
    set('⚠ Некорректный диапазон: «до» должно быть позже «с»', 'error');
    return;
  }
  if (!settings.activeDays.length) {
    set('⚠ Выберите хотя бы один день недели', 'error');
    return;
  }
  if (!settings.enabled) {
    set('⏸ Напоминания приостановлены', 'paused');
    return;
  }
  const nextText = nextRun ? `Следующий сигнал: ${formatNextRun(nextRun, new Date())}` : 'Следующий сигнал: —';
  const lastText = lastTriggered ? `  ·  Последний: ${minutesToTimeString(lastTriggered.getHours() * 60 + lastTriggered.getMinutes())}` : '';
  set(nextText + lastText, 'active');
}

/** Применить изменения UI к настройкам: сохранить и пересчитать. */
function applySettings() {
  persist();
  recompute();
  syncHeaderSwitch();
}

// =====================================================================
// Звуки
// =====================================================================

function populateSoundSelect() {
  const cmb = $('cmbSound');
  cmb.innerHTML = '';
  for (const def of SOUND_DEFS) {
    cmb.add(new Option(def.name, def.id));
  }
  const custom = loadCustomSound();
  if (custom) {
    cmb.add(new Option(`Свой: ${custom.name}`, CUSTOM_SOUND_ID));
  }

  const exists = [...cmb.options].some(o => o.value === settings.soundId);
  cmb.value = exists ? settings.soundId : SOUND_DEFS[0].id;
  if (!exists) settings.soundId = SOUND_DEFS[0].id;

  $('btnRemoveCustom').hidden = !custom;
}

function describeSound(soundId) {
  if (soundId === CUSTOM_SOUND_ID) {
    const custom = loadCustomSound();
    return custom ? `Свой файл: ${custom.name}` : 'Свой файл';
  }
  return SOUND_DEFS.find(s => s.id === soundId)?.name ?? soundId;
}

function onBrowseSound(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > MAX_CUSTOM_SOUND_BYTES) {
    alert(`Файл «${file.name}» слишком большой (${(file.size / 1024 / 1024).toFixed(1)} МБ).\nЛимит — 1,5 МБ: выберите короткий сигнал.`);
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      saveCustomSound({ name: file.name, data: String(reader.result) });
    } catch {
      alert('Не удалось сохранить файл (возможно, не хватает места в localStorage). Звук будет воспроизведён только в этой вкладке.');
    }
    settings.soundId = CUSTOM_SOUND_ID;
    populateSoundSelect();
    applySettings();
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

// =====================================================================
// Уведомления
// =====================================================================

function notificationSupport() {
  return 'Notification' in window;
}

function updateNotificationUi() {
  const state = $('lblNotificationState');
  const btn = $('btnAskNotificationPermission');
  const checkbox = $('chkNotifications');
  if (!notificationSupport()) {
    state.textContent = 'Браузер не поддерживает уведомления';
    btn.hidden = true;
    checkbox.disabled = true;
    return;
  }
  const permission = Notification.permission;
  checkbox.disabled = false;
  if (permission === 'granted') {
    state.textContent = 'Уведомления разрешены ✓';
    btn.hidden = true;
  } else if (permission === 'denied') {
    state.textContent = 'Заблокировано — включите в настройках сайта браузера';
    btn.hidden = false;
    btn.textContent = 'Как включить…';
  } else {
    state.textContent = 'Разрешение не запрошено';
    btn.hidden = false;
    btn.textContent = 'Включить уведомления';
  }
}

function askNotificationPermission() {
  if (!notificationSupport()) return;
  if (Notification.permission === 'denied') {
    alert('Уведомления заблокированы в настройках сайта.\n\nОткройте меню браузера → «Настройки сайта» → «Уведомления» и разрешите их для этой страницы, затем перезагрузите её.');
    return;
  }
  Notification.requestPermission()
    .then(() => updateNotificationUi())
    .catch(() => updateNotificationUi());
}

function showSystemNotification() {
  if (!settings.notifications || !notificationSupport() || Notification.permission !== 'granted') {
    return;
  }
  const body = settings.notificationText || 'Пора сделать перекур!';
  const options = {
    body,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: 'perekur',
    renotify: true,
  };
  // Предпочитаем показ через Service Worker — это единственный способ,
  // который работает из фоновой вкладки в Chrome/Edge.
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.ready
      .then(registration => registration.showNotification('Перекур', options))
      .catch(() => {
        try { new Notification('Перекур', options); } catch { /* ignore */ }
      });
  } else {
    try { new Notification('Перекур', options); } catch { /* ignore */ }
  }
}

// =====================================================================
// Мигание вкладкой и бейдж на favicon
// =====================================================================

function setFaviconBadge(badged) {
  const link = document.querySelector('link[rel="icon"]');
  if (!(link instanceof HTMLLinkElement)) return;
  if (badged) {
    if (!originalFaviconHref) originalFaviconHref = link.href;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const g = canvas.getContext('2d');
      if (!g) return;
      g.drawImage(img, 0, 0, 64, 64);
      g.fillStyle = '#e11d48';
      g.beginPath();
      g.arc(50, 14, 13, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 3;
      g.stroke();
      link.href = canvas.toDataURL('image/png');
    };
    img.src = originalFaviconHref;
  } else if (originalFaviconHref) {
    link.href = originalFaviconHref;
  }
}

function startFlash() {
  if (flashTimer) return;
  let toggle = false;
  setFaviconBadge(true);
  flashTimer = setInterval(() => {
    toggle = !toggle;
    document.title = toggle ? '🔔 Перекур!' : BASE_TITLE;
  }, 900);
}

function stopFlash() {
  if (flashTimer) {
    clearInterval(flashTimer);
    flashTimer = null;
  }
  document.title = BASE_TITLE;
  setFaviconBadge(false);
}

// =====================================================================
// Срабатывание
// =====================================================================

function fire() {
  lastTriggered = new Date();
  playSound(settings.soundId);
  showSystemNotification();
  $('overlayText').textContent = settings.notificationText || 'Пора сделать перекур!';
  $('overlay').hidden = false;
  overlayVisible = true;
  startFlash();
  updateStatus();
}

function dismissOverlay(snooze) {
  $('overlay').hidden = true;
  overlayVisible = false;
  stopFlash();
  if (snooze) {
    nextRun = new Date(Date.now() + 5 * 60 * 1000);
  }
  updateStatus();
}

// =====================================================================
// Сборка/разбор UI
// =====================================================================

function populateTemplateSelect() {
  const cmb = $('cmbTemplate');
  cmb.innerHTML = '';
  for (const template of TEMPLATES) {
    cmb.add(new Option(template.name, template.name));
  }
  const savedIndex = settings.lastTemplate ? TEMPLATES.findIndex(t => t.name === settings.lastTemplate) : 0;
  cmb.selectedIndex = savedIndex >= 0 ? savedIndex : 0;
  updateTemplateDesc();
}

function updateTemplateDesc() {
  const cmb = $('cmbTemplate');
  const template = TEMPLATES.find(t => t.name === cmb.value);
  $('lblTemplateDesc').textContent = template ? template.description : '';
}

function applySelectedTemplate() {
  const template = TEMPLATES.find(t => t.name === $('cmbTemplate').value);
  if (!template) return;
  template.apply(settings);
  settings.lastTemplate = template.name;
  loadSettingsIntoInputs();
  applySettings();
}

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Пн..Вс

function renderDayToggles() {
  const row = $('daysRow');
  row.innerHTML = '';
  const labels = { 0: 'Вс', 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт', 6: 'Сб' };
  for (const day of DAY_ORDER) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day-toggle';
    btn.dataset.day = String(day);
    btn.textContent = labels[day];
    btn.setAttribute('aria-pressed', String(settings.activeDays.includes(day)));
    btn.classList.toggle('active', settings.activeDays.includes(day));
    btn.addEventListener('click', () => {
      const active = new Set(settings.activeDays);
      if (active.has(day)) active.delete(day); else active.add(day);
      settings.activeDays = [...active];
      btn.classList.toggle('active', active.has(day));
      btn.setAttribute('aria-pressed', String(active.has(day)));
      applySettings();
    });
    row.appendChild(btn);
  }
}

function syncHeaderSwitch() {
  const toggle = $('chkEnabled');
  toggle.checked = settings.enabled;
  $('enabledLabel').textContent = settings.enabled ? 'Напоминания включены' : 'Напоминания приостановлены';
}

function updateModeUi() {
  const intervalMode = $('rdoInterval').checked;
  $('numInterval').disabled = !intervalMode;
  $('timeFrom').disabled = !intervalMode;
  $('timeTo').disabled = !intervalMode;
  $('timeDaily').disabled = intervalMode;
  $('lblRangeHint').classList.toggle('invalid', intervalMode && !isRangeValid(settings));
}

function loadSettingsIntoInputs() {
  $('rdoInterval').checked = settings.mode !== 'daily';
  $('rdoDaily').checked = settings.mode === 'daily';
  $('numInterval').value = String(settings.intervalMinutes);
  $('timeDaily').value = settings.dailyTime;
  $('timeFrom').value = settings.rangeStart;
  $('timeTo').value = settings.rangeEnd;
  $('txtNotification').value = settings.notificationText;
  $('chkNotifications').checked = settings.notifications;
  renderDayToggles();
  populateSoundSelect();
  syncHeaderSwitch();
  updateModeUi();
}

function readInputsIntoSettings() {
  settings.mode = $('rdoDaily').checked ? 'daily' : 'interval';
  settings.intervalMinutes = Math.max(1, Math.min(480, Number($('numInterval').value) || 60));
  settings.dailyTime = $('timeDaily').value || '13:00';
  settings.rangeStart = $('timeFrom').value || '09:00';
  settings.rangeEnd = $('timeTo').value || '18:00';
  settings.notificationText = $('txtNotification').value.trim() || 'Пора сделать перекур!';
  settings.notifications = $('chkNotifications').checked;
  settings.enabled = $('chkEnabled').checked;
}

// =====================================================================
// Инициализация
// =====================================================================

function bindEvents() {
  // Шаблоны
  $('cmbTemplate').addEventListener('change', updateTemplateDesc);
  $('btnApplyTemplate').addEventListener('click', applySelectedTemplate);

  // Звуки
  $('cmbSound').addEventListener('change', () => {
    settings.soundId = $('cmbSound').value;
    applySettings();
  });
  $('btnTestSound').addEventListener('click', () => { primeAudio(); playSound(settings.soundId); });
  $('btnBrowseSound').addEventListener('click', () => $('fileCustomSound').click());
  $('fileCustomSound').addEventListener('change', onBrowseSound);
  $('btnRemoveCustom').addEventListener('click', () => {
    if (!confirm('Убрать загруженный звук?')) return;
    removeCustomSound();
    if (settings.soundId === CUSTOM_SOUND_ID) settings.soundId = SOUND_DEFS[0].id;
    populateSoundSelect();
    applySettings();
  });

  // Режим и время
  $('rdoInterval').addEventListener('change', () => { readInputsIntoSettings(); updateModeUi(); applySettings(); });
  $('rdoDaily').addEventListener('change', () => { readInputsIntoSettings(); updateModeUi(); applySettings(); });
  $('numInterval').addEventListener('input', () => { readInputsIntoSettings(); applySettings(); });
  $('timeDaily').addEventListener('input', () => { readInputsIntoSettings(); applySettings(); });
  $('timeFrom').addEventListener('input', () => { readInputsIntoSettings(); updateModeUi(); applySettings(); });
  $('timeTo').addEventListener('input', () => { readInputsIntoSettings(); updateModeUi(); applySettings(); });
  $('txtNotification').addEventListener('input', () => { readInputsIntoSettings(); persist(); }); // пересчёт не нужен

  // Поведение
  $('chkNotifications').addEventListener('change', () => {
    readInputsIntoSettings();
    if (settings.notifications) askNotificationPermission();
    applySettings();
  });
  $('btnAskNotificationPermission').addEventListener('click', askNotificationPermission);
  $('chkEnabled').addEventListener('change', () => { readInputsIntoSettings(); applySettings(); });

  // Нижняя панель и оверлей
  $('btnNow').addEventListener('click', () => { primeAudio(); fire(); });
  $('btnOverlayOk').addEventListener('click', () => dismissOverlay(false));
  $('btnOverlaySnooze').addEventListener('click', () => dismissOverlay(true));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlayVisible) dismissOverlay(false);
  });

  // Возврат на вкладку — сразу проверяем, не просрочен ли сигнал
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      recompute();
      tick();
    }
  });

  // Разблокировка аудио по первому жесту (политика автовоспроизведения)
  const unlock = () => {
    primeAudio();
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
  };
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);

  // PWA: кнопка установки
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    $('btnInstall').hidden = false;
  });
  $('btnInstall').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch { /* ignore */ }
    installPrompt = null;
    $('btnInstall').hidden = true;
  });
}

function tick() {
  const now = Date.now();
  if (settings.enabled && nextRun && now >= nextRun.getTime()) {
    fire();
    recompute();
    return;
  }
  updateStatus();
}

function init() {
  populateTemplateSelect();
  loadSettingsIntoInputs();
  bindEvents();
  updateNotificationUi();
  recompute();
  setInterval(tick, 1000);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* PWA-офлайн не критичен */ });
  }
}

init();
