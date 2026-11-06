/** Юнит-тесты чистой логики планировщика. Запуск: node --test test/scheduler.test.mjs */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import scheduler from '../scheduler.js';

const {
  ALL_DAYS,
  WORKDAYS,
  computeNext,
  isRangeValid,
  minutesToTimeString,
  parseTimeToMinutes,
} = scheduler;

const at = (iso) => new Date(iso);

/** Пятница 2026-11-06 10:00 локального времени. */
const FRI_1000 = at('2026-11-06T10:00:00');
const base = {
  mode: 'interval',
  intervalMinutes: 60,
  hourlyMinute: 55,
  dailyTime: '13:00',
  rangeStart: '09:00',
  rangeEnd: '18:00',
  activeDays: [...WORKDAYS],
  enabled: true,
};
const hourly = { ...base, mode: 'hourly', rangeStart: '08:00', rangeEnd: '17:00' };

test('parseTimeToMinutes: корректный разбор', () => {
  assert.equal(parseTimeToMinutes('00:00', -1), 0);
  assert.equal(parseTimeToMinutes('09:30', -1), 570);
  assert.equal(parseTimeToMinutes('23:59', -1), 1439);
});

test('parseTimeToMinutes: мусор -> fallback', () => {
  assert.equal(parseTimeToMinutes('25:00', 111), 111);
  assert.equal(parseTimeToMinutes('9:70', 111), 111);
  assert.equal(parseTimeToMinutes('abc', 111), 111);
  assert.equal(parseTimeToMinutes(null, 111), 111);
  assert.equal(parseTimeToMinutes(42, 111), 111);
});

test('minutesToTimeString: обратное преобразование', () => {
  assert.equal(minutesToTimeString(0), '00:00');
  assert.equal(minutesToTimeString(570), '09:30');
  assert.equal(minutesToTimeString(1439), '23:59');
});

test('interval: до начала диапазона -> первый сигнал сегодня в rangeStart', () => {
  const next = computeNext(base, at('2026-11-06T08:30:00'));
  assert.equal(next?.getHours(), 9);
  assert.equal(next?.getMinutes(), 0);
  assert.equal(next?.getDate(), 6);
});

test('interval: ровно на сигнале -> следующий в сетке', () => {
  const next = computeNext(base, FRI_1000);
  assert.equal(next?.getHours(), 11);
  assert.equal(next?.getMinutes(), 0);
});

test('interval: между сигналами -> следующий по сетке', () => {
  const next = computeNext(base, at('2026-11-06T10:15:00'));
  assert.equal(next?.getHours(), 11);
});

test('interval: после последнего слота -> понедельник 09:00', () => {
  const next = computeNext(base, at('2026-11-06T17:30:00'));
  assert.equal(next?.getDay(), 1);
  assert.equal(next?.getDate(), 9);
  assert.equal(next?.getHours(), 9);
});

test('interval: суббота -> понедельник 09:00', () => {
  const next = computeNext(base, at('2026-11-07T10:00:00'));
  assert.equal(next?.getDay(), 1);
  assert.equal(next?.getDate(), 9);
  assert.equal(next?.getHours(), 9);
});

test('interval: невалидный диапазон -> null', () => {
  assert.equal(computeNext({ ...base, rangeStart: '18:00', rangeEnd: '09:00' }, FRI_1000), null);
});

test('interval: пустой список дней -> null', () => {
  assert.equal(computeNext({ ...base, activeDays: [] }, FRI_1000), null);
});

test('interval: сетка 20-20-20', () => {
  const next = computeNext({ ...base, intervalMinutes: 20 }, at('2026-11-06T09:07:00'));
  assert.equal(next?.getHours(), 9);
  assert.equal(next?.getMinutes(), 20);
});

test('interval: минуту до последнего слота -> последний слот сегодня', () => {
  const next = computeNext(base, at('2026-11-06T16:59:30'));
  assert.equal(next?.getHours(), 17);
  assert.equal(next?.getDate(), 6);
});

test('hourly: каждый час в :55 с 08:00 до 17:00', () => {
  // утро — первый сигнал 08:55
  assert.equal(computeNext(hourly, at('2026-11-06T08:00:00'))?.getHours(), 8);
  assert.equal(computeNext(hourly, at('2026-11-06T08:00:00'))?.getMinutes(), 55);
  // 10:20 -> 10:55
  const next = computeNext(hourly, at('2026-11-06T10:20:00'));
  assert.equal(next?.getHours(), 10);
  assert.equal(next?.getMinutes(), 55);
  // ровно в 10:55 (строго после now) -> 11:55
  const after = computeNext(hourly, at('2026-11-06T10:55:00'));
  assert.equal(after?.getHours(), 11);
  assert.equal(after?.getMinutes(), 55);
});

test('hourly: последний сигнал дня — 16:55', () => {
  const next = computeNext(hourly, at('2026-11-06T16:00:00'));
  assert.equal(next?.getHours(), 16);
  assert.equal(next?.getMinutes(), 55);
});

test('hourly: после 16:55 -> понедельник 08:55 (выходные выключены)', () => {
  const next = computeNext(hourly, at('2026-11-06T16:55:00'));
  assert.equal(next?.getDay(), 1);
  assert.equal(next?.getDate(), 9);
  assert.equal(next?.getHours(), 8);
  assert.equal(next?.getMinutes(), 55);
});

test('hourly: суббота -> понедельник 08:55', () => {
  const next = computeNext(hourly, at('2026-11-07T10:00:00'));
  assert.equal(next?.getDay(), 1);
  assert.equal(next?.getDate(), 9);
  assert.equal(next?.getHours(), 8);
});

test('hourly: невалидный диапазон -> null', () => {
  assert.equal(computeNext({ ...hourly, rangeStart: '17:00', rangeEnd: '08:00' }, FRI_1000), null);
});

test('hourly: минута вне диапазона начала не срабатывает (:55 раньше старта)', () => {
  // Диапазон с 09:10 — сигнал в 08:55/09:55: 9:55 попадёт, 8:55 нет.
  const next = computeNext({ ...hourly, rangeStart: '09:10' }, at('2026-11-06T09:00:00'));
  assert.equal(next?.getHours(), 9);
  assert.equal(next?.getMinutes(), 55);
});

test('hourly: все дни включены, включая выходные', () => {
  const next = computeNext({ ...hourly, activeDays: [...ALL_DAYS] }, at('2026-11-07T10:00:00')); // суббота
  assert.equal(next?.getDay(), 6);
  assert.equal(next?.getHours(), 10);
  assert.equal(next?.getMinutes(), 55);
});

test('daily: сегодня ещё не было -> сегодня', () => {
  const next = computeNext({ ...base, mode: 'daily', dailyTime: '13:00', activeDays: [...ALL_DAYS] }, at('2026-11-06T10:00:00'));
  assert.equal(next?.getDate(), 6);
  assert.equal(next?.getHours(), 13);
});

test('daily: сегодня прошло -> Пн (выходные выключены)', () => {
  const next = computeNext({ ...base, mode: 'daily', dailyTime: '13:00' }, at('2026-11-06T14:00:00'));
  assert.equal(next?.getDay(), 1);
  assert.equal(next?.getDate(), 9);
});

test('daily: в выходной с рабочими днями -> пропускает сб/вс', () => {
  const next = computeNext({ ...base, mode: 'daily', dailyTime: '10:00' }, at('2026-11-07T08:00:00'));
  assert.equal(next?.getDay(), 1);
  assert.equal(next?.getDate(), 9);
});

test('enabled = false -> null', () => {
  assert.equal(computeNext({ ...base, enabled: false }, FRI_1000), null);
});

test('isRangeValid', () => {
  assert.equal(isRangeValid({ rangeStart: '09:00', rangeEnd: '18:00' }), true);
  assert.equal(isRangeValid({ rangeStart: '18:00', rangeEnd: '18:00' }), false);
  assert.equal(isRangeValid({ rangeStart: '18:00', rangeEnd: '09:00' }), false);
});
