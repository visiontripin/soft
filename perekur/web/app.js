/**
 * «Перекур» — веб-версия. Точка входа: состояние, DOM, таймер, уведомления.
 * Классический скрипт (не модуль): работает и с file://, и по HTTP.
 */
(function () {
  'use strict';

  const {
    DEFAULT_SETTINGS,
    WORKDAYS,
    computeNext,
    formatNextRun,
    isRangeValid,
    minutesToTimeString,
  } = globalThis.PerekurScheduler;

  const {
    CUSTOM_SOUND_ID,
    SOUND_DEFS,
    isAudioSupported,
    loadCustomSound,
    playSound,
    primeAudio,
    removeCustomSound,
    saveCustomSound,
  } = globalThis.PerekurSounds;

  const { TEMPLATES } = globalThis.PerekurTemplates;

  const LS_SETTINGS = 'perekur.web.settings.v1';
  const BASE_TITLE = 'Перекур — напоминание о перерывах';
  const MAX_CUSTOM_SOUND_BYTES = 1_500_000;

  const $ = (id) => document.getElementById(id);

  const freshDefaults = () => ({
    ...DEFAULT_SETTINGS,
    activeDays: [...WORKDAYS],
  });

  // =====================================================================
  // Отображение ошибок (вместо тихого падения)
  // =====================================================================

  function showError(message) {
    const banner = document.getElementById('errorBanner');
    if (!banner) return;
    banner.hidden = false;
    banner.textContent = `Ошибка: ${message}`;
  }

  window.addEventListener('error', (event) => {
    showError(event.message || 'неизвестная ошибка');
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    showError((reason && (reason.message || String(reason))) || 'ошибка асинхронной операции');
  });

  // =====================================================================
  // Настройки
  // =====================================================================

  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      if (!raw) return freshDefaults();
      const parsed = JSON.parse(raw) ?? {};
      const defaults = freshDefaults();
      const hourlyMinute = Number(parsed.hourlyMinute);
      return {
        ...defaults,
        ...parsed,
        intervalMinutes: Number.isFinite(Number(parsed.intervalMinutes)) ? Math.max(1, Math.min(480, Math.round(Number(parsed.intervalMinutes)))) : defaults.intervalMinutes,
        hourlyMinute: Number.isFinite(hourlyMinute) ? Math.max(0, Math.min(59, Math.round(hourlyMinute))) : defaults.hourlyMinute,
        activeDays: Array.isArray(parsed.activeDays)
          ? parsed.activeDays.filter(d => Number.isInteger(d) && d >= 0 && d <= 6)
          : [...WORKDAYS],
      };
    } catch {
      return freshDefaults();
    }
  }

  const settings = loadSettings();
  let nextRun = null;
  let lastTriggered = null;
  let flashTimer = null;
  let overlayVisible = false;
  let installPrompt = null;
  let originalFaviconHref = null;

  function persist() {
    try {
      localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
    } catch {
      // localStorage недоступен/переполнен — приложение продолжает работать в памяти.
    }
  }

  function recompute() {
    nextRun = settings.enabled ? computeNext(settings, new Date()) : null;
    updateStatus();
  }

  const isRangeRelevant = () => settings.mode !== 'daily';

  function updateStatus() {
    const label = $('lblNext');
    const dot = $('statusDot');
    if (!label || !dot) return;

    const set = (text, tone) => {
      label.textContent = text;
      dot.dataset.tone = tone;
    };

    if (isRangeRelevant() && !isRangeValid(settings)) {
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
    const lastText = lastTriggered
      ? `  ·  Последний: ${minutesToTimeString(lastTriggered.getHours() * 60 + lastTriggered.getMinutes())}`
      : '';
    set(nextText + lastText, 'active');
  }

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
      const persisted = saveCustomSound({ name: file.name, data: String(reader.result) });
      settings.soundId = CUSTOM_SOUND_ID;
      populateSoundSelect();
      applySettings();
      if (!persisted) {
        alert('Не удалось записать файл в localStorage (возможно, браузер в приватном режиме или не хватает места).\nЗвук будет работать до закрытия вкладки и попробовать добавится в список ниже.');
      }
    };
    reader.onerror = () => alert('Не удалось прочитать файл.');
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
  // UI: шаблоны, дни, режимы
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
    const hourlyMode = $('rdoHourly').checked;
    const dailyMode = $('rdoDaily').checked;
    $('numInterval').disabled = !intervalMode;
    $('numHourlyMinute').disabled = !hourlyMode;
    $('timeFrom').disabled = dailyMode;   // диапазон действует в interval и hourly
    $('timeTo').disabled = dailyMode;
    $('timeDaily').disabled = !dailyMode;
    $('rowRange').classList.toggle('range-disabled', dailyMode);
    $('rowRange').classList.toggle('invalid', !dailyMode && !isRangeValid(settings));
  }

  function loadSettingsIntoInputs() {
    $('rdoInterval').checked = settings.mode !== 'daily' && settings.mode !== 'hourly';
    $('rdoHourly').checked = settings.mode === 'hourly';
    $('rdoDaily').checked = settings.mode === 'daily';
    $('numInterval').value = String(settings.intervalMinutes);
    $('numHourlyMinute').value = String(settings.hourlyMinute);
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
    settings.mode = $('rdoDaily').checked ? 'daily' : ($('rdoHourly').checked ? 'hourly' : 'interval');
    settings.intervalMinutes = Math.max(1, Math.min(480, Number($('numInterval').value) || 60));
    settings.hourlyMinute = Math.max(0, Math.min(59, Number($('numHourlyMinute').value) || 0));
    settings.dailyTime = $('timeDaily').value || '13:00';
    settings.rangeStart = $('timeFrom').value || '09:00';
    settings.rangeEnd = $('timeTo').value || '18:00';
    settings.notificationText = $('txtNotification').value.trim() || 'Пора сделать перекур!';
    settings.notifications = $('chkNotifications').checked;
    settings.enabled = $('chkEnabled').checked;
  }

  // =====================================================================
  // События
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
    const modeChanged = () => {
      readInputsIntoSettings();
      updateModeUi();
      applySettings();
    };
    $('rdoInterval').addEventListener('change', modeChanged);
    $('rdoHourly').addEventListener('change', modeChanged);
    $('rdoDaily').addEventListener('change', modeChanged);
    $('numInterval').addEventListener('input', () => { readInputsIntoSettings(); applySettings(); });
    $('numHourlyMinute').addEventListener('input', () => { readInputsIntoSettings(); applySettings(); });
    $('timeDaily').addEventListener('input', () => { readInputsIntoSettings(); applySettings(); });
    $('timeFrom').addEventListener('input', () => { readInputsIntoSettings(); updateModeUi(); applySettings(); });
    $('timeTo').addEventListener('input', () => { readInputsIntoSettings(); updateModeUi(); applySettings(); });
    $('txtNotification').addEventListener('input', () => { readInputsIntoSettings(); persist(); });

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
    if (!isAudioSupported()) {
      $('btnTestSound').disabled = true;
      $('btnTestSound').title = 'Web Audio API не поддерживается этим браузером';
    }
    recompute();
    setInterval(tick, 1000);

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* PWA-офлайн не критичен */ });
    }
  }

  try {
    init();
  } catch (error) {
    showError(error && error.message ? error.message : String(error));
    throw error;
  }
})();
