/**
 * «Перекур» — чистая логика расписания.
 * Работает и как классический <script> (window.PerekurScheduler), и как модуль Node (для тестов).
 *
 * Дни недели: 0 = воскресенье … 6 = суббота (как Date.getDay() в JS и DayOfWeek в .NET).
 * В режимах интервала и «каждый час» сигналы ограничены диапазоном [rangeStart, rangeEnd).
 * В режиме интервала сетка привязана к началу диапазона: rangeStart + k * interval.
 */
(function (root, factory) {
  const api = factory();
  root.PerekurScheduler = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const WORKDAYS = [1, 2, 3, 4, 5];
  const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

  const DEFAULT_SETTINGS = Object.freeze({
    mode: 'interval',           // 'interval' | 'hourly' | 'daily'
    intervalMinutes: 60,
    hourlyMinute: 55,           // режим 'hourly': в какую минуту каждого часа звонить
    dailyTime: '13:00',
    rangeStart: '09:00',
    rangeEnd: '18:00',
    activeDays: [...WORKDAYS],
    soundId: 'chimes',
    notificationText: 'Пора сделать перекур! Оторвитесь от экрана на пару минут.',
    enabled: true,
    notifications: true,
    lastTemplate: null,
  });

  /** "HH:mm" -> минуты от полуночи; fallback при ошибке. */
  function parseTimeToMinutes(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return fallback;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return fallback;
    return hours * 60 + minutes;
  }

  /** Минуты от полуночи -> "HH:mm". */
  function minutesToTimeString(totalMinutes) {
    const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(totalMinutes)));
    const hours = Math.floor(clamped / 60);
    const minutes = clamped % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  /** Минуты от полуночи -> Date на том же календарном дне, что и `day` (локальное время). */
  function atMinutes(day, totalMinutes) {
    const date = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    date.setHours(0, totalMinutes, 0, 0);
    return date;
  }

  function clampInt(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.round(number)));
  }

  function isActiveDay(activeDays, date) {
    return Array.isArray(activeDays) && activeDays.length > 0 && activeDays.includes(date.getDay());
  }

  /** Диапазон валиден, если «до» позже «с». */
  function isRangeValid(settings) {
    const start = parseTimeToMinutes(settings?.rangeStart, 9 * 60);
    const end = parseTimeToMinutes(settings?.rangeEnd, 18 * 60);
    return end > start;
  }

  /** Ближайшее время сигнала строго после `from` (Date) или null. */
  function computeNext(settings, from) {
    if (!settings || settings.enabled === false) return null;
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    switch (settings.mode) {
      case 'daily': return computeNextDaily(settings, day, from);
      case 'hourly': return computeNextHourly(settings, day, from);
      default: return computeNextInterval(settings, day, from);
    }
  }

  function computeNextInterval(settings, fromDateOnly, from) {
    const rangeStart = parseTimeToMinutes(settings.rangeStart, 9 * 60);
    const rangeEnd = parseTimeToMinutes(settings.rangeEnd, 18 * 60);
    if (rangeEnd <= rangeStart) return null;

    const interval = clampInt(settings.intervalMinutes, 1, 480, 60);

    for (let offset = 0; offset < 14; offset++) {
      const day = new Date(fromDateOnly.getFullYear(), fromDateOnly.getMonth(), fromDateOnly.getDate() + offset);
      if (!isActiveDay(settings.activeDays, day)) continue;

      const start = atMinutes(day, rangeStart);
      const end = atMinutes(day, rangeEnd);
      let candidate = start;

      if (candidate.getTime() <= from.getTime()) {
        // Первый сигнал в сетке rangeStart + k * interval строго после now.
        const elapsedMinutes = (from.getTime() - start.getTime()) / 60000;
        const k = Math.floor(elapsedMinutes / interval) + 1;
        candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, rangeStart + k * interval, 0, 0);
      }

      if (candidate.getTime() < end.getTime()) {
        return candidate;
      }
    }
    return null;
  }

  /** Каждый час в заданную минуту (hourlyMinute) внутри [rangeStart, rangeEnd). */
  function computeNextHourly(settings, fromDateOnly, from) {
    const rangeStart = parseTimeToMinutes(settings.rangeStart, 8 * 60);
    const rangeEnd = parseTimeToMinutes(settings.rangeEnd, 17 * 60);
    if (rangeEnd <= rangeStart) return null;

    const minute = clampInt(settings.hourlyMinute, 0, 59, 55);

    for (let offset = 0; offset < 14; offset++) {
      const day = new Date(fromDateOnly.getFullYear(), fromDateOnly.getMonth(), fromDateOnly.getDate() + offset);
      if (!isActiveDay(settings.activeDays, day)) continue;

      for (let hour = 0; hour < 24; hour++) {
        const candidateMinute = hour * 60 + minute;
        if (candidateMinute < rangeStart) continue;
        if (candidateMinute >= rangeEnd) break;
        const candidate = atMinutes(day, candidateMinute);
        if (candidate.getTime() > from.getTime()) {
          return candidate;
        }
      }
    }
    return null;
  }

  function computeNextDaily(settings, fromDateOnly, from) {
    const timeMinutes = parseTimeToMinutes(settings.dailyTime, 13 * 60);

    for (let offset = 0; offset < 14; offset++) {
      const day = new Date(fromDateOnly.getFullYear(), fromDateOnly.getMonth(), fromDateOnly.getDate() + offset);
      if (!isActiveDay(settings.activeDays, day)) continue;
      const candidate = atMinutes(day, timeMinutes);
      if (candidate.getTime() > from.getTime()) {
        return candidate;
      }
    }
    return null;
  }

  /** «сегодня в 15:00 (через 42 мин)» / «понедельник, 9 ноября в 09:00 (через 2 дн 3 ч)». */
  function formatNextRun(next, now = new Date()) {
    if (!(next instanceof Date) || Number.isNaN(next.getTime())) return '—';

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thatDay = new Date(next.getFullYear(), next.getMonth(), next.getDate());
    const dayDiff = Math.round((thatDay - today) / 86400000);

    let dayLabel;
    if (dayDiff === 0) dayLabel = 'сегодня';
    else if (dayDiff === 1) dayLabel = 'завтра';
    else dayLabel = next.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

    const time = minutesToTimeString(next.getHours() * 60 + next.getMinutes());
    const diffMs = Math.max(0, next.getTime() - now.getTime());
    const totalMinutes = Math.floor(diffMs / 60000);

    let countdown;
    if (totalMinutes < 1) {
      countdown = 'меньше минуты';
    } else if (totalMinutes < 60) {
      countdown = `${totalMinutes} мин`;
    } else if (totalMinutes < 60 * 24) {
      countdown = `${Math.floor(totalMinutes / 60)} ч ${totalMinutes % 60} мин`;
    } else {
      countdown = `${Math.floor(totalMinutes / (60 * 24))} дн ${Math.floor((totalMinutes % (60 * 24)) / 60)} ч`;
    }

    return `${dayLabel} в ${time} (через ${countdown})`;
  }

  return {
    WORKDAYS,
    ALL_DAYS,
    DEFAULT_SETTINGS,
    parseTimeToMinutes,
    minutesToTimeString,
    isActiveDay,
    isRangeValid,
    computeNext,
    formatNextRun,
  };
});
