/**
 * «Перекур» — чистая логика расписания.
 * Никакого DOM: модуль можно подключить и в браузере, и в Node (для тестов).
 *
 * Дни недели: 0 = воскресенье … 6 = суббота (как Date.getDay() в JS и DayOfWeek в .NET).
 * Сигналы в режиме интервала привязаны к началу диапазона: rangeStart + k * interval.
 */

export const DAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const WORKDAYS = [1, 2, 3, 4, 5];

export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'interval',           // 'interval' | 'daily'
  intervalMinutes: 60,
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
export function parseTimeToMinutes(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return fallback;
  return hours * 60 + minutes;
}

/** Минуты от полуночи -> "HH:mm". */
export function minutesToTimeString(totalMinutes) {
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

export function isActiveDay(activeDays, date) {
  return Array.isArray(activeDays) && activeDays.length > 0 && activeDays.includes(date.getDay());
}

/** Диапазон валиден, если «до» позже «с». */
export function isRangeValid(settings) {
  const start = parseTimeToMinutes(settings?.rangeStart, 9 * 60);
  const end = parseTimeToMinutes(settings?.rangeEnd, 18 * 60);
  return end > start;
}

/** Ближайшее время сигнала строго после `from` (Date) или null. */
export function computeNext(settings, from) {
  if (!settings || settings.enabled === false) return null;
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return settings.mode === 'daily'
    ? computeNextDaily(settings, day, from)
    : computeNextInterval(settings, day, from);
}

function computeNextInterval(settings, fromDateOnly, from) {
  const rangeStart = parseTimeToMinutes(settings.rangeStart, 9 * 60);
  const rangeEnd = parseTimeToMinutes(settings.rangeEnd, 18 * 60);
  if (rangeEnd <= rangeStart) return null;

  const rawInterval = Number(settings.intervalMinutes);
  const interval = Number.isFinite(rawInterval) ? Math.max(1, Math.min(480, Math.round(rawInterval))) : 60;

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

const RU_WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

/** «сегодня в 15:00 · через 42 мин» / «понедельник, 9 ноября в 09:00 · через 2 дн 3 ч». */
export function formatNextRun(next, now = new Date()) {
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

export { RU_WEEKDAYS };
