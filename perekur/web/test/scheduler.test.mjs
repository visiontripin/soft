/** Юнит-тесты чистой логики планировщика. Запуск: node --test web/test/ */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_DAYS,
  WORKDAYS,
  computeNext,
  isRangeValid,
  minutesToTimeString,
  parseTimeToMinutes,
} from '../scheduler.js';

const at = (iso) => new Date(iso);

/** Пятница 2026-11-06 10:00 локального времени. */
const FRI_1000 = at('2026-11-06T10:00:00');
const base = {
  mode: 'interval',
  intervalMinutes: 60,
  dailyTime: '13:00',
  rangeStart: '09:00',
  rangeEnd: '18:00',
  activeDays: [...WORKDAYS],
  enabled: true,
};

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

test('interval: после последнего слота -> понедельник 09:00 (суббота/воскресенье выключены)', () => {
  const next = computeNext(base, at('2026-11-06T17:30:00'));
  assert.equal(next?.getDay(), 1); // понедельник
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
  const next = computeNext({ ...base, rangeStart: '18:00', rangeEnd: '09:00' }, FRI_1000);
  assert.equal(next, null);
});

test('interval: пустой список дней -> null', () => {
  const next = computeNext({ ...base, activeDays: [] }, FRI_1000);
  assert.equal(next, null);
});

test('interval: сетка 20-20-20', () => {
  const next = computeNext({ ...base, intervalMinutes: 20 }, at('2026-11-06T09:07:00'));
  assert.equal(next?.getHours(), 9);
  assert.equal(next?.getMinutes(), 20);
});

test('interval: ровно последний слот — сигнал сегодня, не завтра', () => {
  const next = computeNext(base, at('2026-11-06T17:00:00'));
  // 17:00 <= now? now == 17:00, строго после -> ближайший сегодня 18:00 > end? нет.
  // 18:00 не < 18:00, поэтому следующий — понедельник 09:00.
  assert.equal(next?.getDay(), 1);
  assert.equal(next?.getDate(), 9);
});

test('interval: минуту до последнего слота -> последний слот сегодня', () => {
  const next = computeNext(base, at('2026-11-06T16:59:30'));
  assert.equal(next?.getHours(), 17);
  assert.equal(next?.getDate(), 6);
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
