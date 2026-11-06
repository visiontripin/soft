/**
 * «Перекур» — готовые шаблоны расписания (те же, что в десктоп-версии).
 * Работает и как классический <script> (window.PerekurTemplates), и как модуль Node.
 */
(function (root, factory) {
  const api = factory();
  root.PerekurTemplates = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TEMPLATES = [
    {
      name: 'Каждый час (рабочая классика)',
      description: 'Сигнал каждый час с 09:00 до 18:00, понедельник–пятница.',
      apply: s => {
        s.mode = 'interval';
        s.intervalMinutes = 60;
        s.rangeStart = '09:00';
        s.rangeEnd = '18:00';
        s.activeDays = [1, 2, 3, 4, 5];
        s.notificationText = 'Пора сделать перекур! Оторвитесь от экрана на пару минут.';
      },
    },
    {
      name: 'Каждый час в :55, 08:00–17:00',
      description: 'Ровно в пятьдесят пятую минуту каждого часа с 08:00 до 17:00 (08:55, 09:55 … 16:55), Пн–Пт.',
      apply: s => {
        s.mode = 'hourly';
        s.hourlyMinute = 55;
        s.rangeStart = '08:00';
        s.rangeEnd = '17:00';
        s.activeDays = [1, 2, 3, 4, 5];
        s.notificationText = 'Пора сделать перекур! Оторвитесь от экрана на пару минут.';
      },
    },
    {
      name: 'Помодоро 25/5',
      description: '25 минут фокуса — 5 минут перерыва, весь рабочий день, Пн–Пт.',
      apply: s => {
        s.mode = 'interval';
        s.intervalMinutes = 25;
        s.rangeStart = '09:00';
        s.rangeEnd = '18:00';
        s.activeDays = [1, 2, 3, 4, 5];
        s.notificationText = 'Помодоро завершён — 5 минут отдыха: встаньте, размянитесь.';
      },
    },
    {
      name: 'Глаза 20-20-20',
      description: 'Каждые 20 минут: 20 секунд смотреть на ~6 метров вперёд.',
      apply: s => {
        s.mode = 'interval';
        s.intervalMinutes = 20;
        s.rangeStart = '09:00';
        s.rangeEnd = '19:00';
        s.activeDays = [1, 2, 3, 4, 5];
        s.notificationText = 'Правило 20-20-20: посмотрите на ~6 метров вперёд на 20 секунд.';
      },
    },
    {
      name: 'Разминка каждые полтора часа',
      description: 'Напоминание пройтись и потянуться, 10:00–17:00, Пн–Пт.',
      apply: s => {
        s.mode = 'interval';
        s.intervalMinutes = 90;
        s.rangeStart = '10:00';
        s.rangeEnd = '17:00';
        s.activeDays = [1, 2, 3, 4, 5];
        s.notificationText = 'Встаньте, потянитесь, пройдитесь 2–3 минуты.';
      },
    },
    {
      name: 'Обед в 13:00 (каждый день)',
      description: 'Один сигнал в 13:00 каждый день — пора на обед.',
      apply: s => {
        s.mode = 'daily';
        s.dailyTime = '13:00';
        s.activeDays = [0, 1, 2, 3, 4, 5, 6];
        s.notificationText = 'Пора на обед! Отвлекитесь от работы.';
      },
    },
    {
      name: 'Вечернее чай/кофе в 16:00',
      description: 'Один сигнал в 16:00 каждый рабочий день — время на чай или кофе.',
      apply: s => {
        s.mode = 'daily';
        s.dailyTime = '16:00';
        s.activeDays = [1, 2, 3, 4, 5];
        s.notificationText = 'Чай или кофе в 16:00? Пять минут отдыха зарядят оставшийся день.';
      },
    },
    {
      name: 'Отбой от экрана в 23:00',
      description: 'Один сигнал в 23:00 каждый день — закройте ноутбук и отдохните.',
      apply: s => {
        s.mode = 'daily';
        s.dailyTime = '23:00';
        s.activeDays = [0, 1, 2, 3, 4, 5, 6];
        s.notificationText = '23:00 — пора заканчивать. Закройте ноутбук и отдохните.';
      },
    },
  ];

  return { TEMPLATES };
});
