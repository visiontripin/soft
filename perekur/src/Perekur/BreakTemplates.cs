namespace Perekur;

/// <summary>Готовый сценарий напоминаний: заполняет режим, интервал/время, дни, диапазон и текст.</summary>
public sealed class BreakTemplate
{
    public required string Name { get; init; }
    public required string Description { get; init; }
    public required Action<AppSettings> ApplyTo { get; init; }
}

/// <summary>Встроенные шаблоны приложения «Перекур».</summary>
public static class BreakTemplates
{
    private static readonly int[] MondayToFriday = { 1, 2, 3, 4, 5 };
    private static readonly int[] EveryDay = { 0, 1, 2, 3, 4, 5, 6 };

    public static IReadOnlyList<BreakTemplate> All { get; } = new List<BreakTemplate>
    {
        new()
        {
            Name = "Каждый час (рабочая классика)",
            Description = "Сигнал каждый час с 09:00 до 18:00, понедельник–пятница.",
            ApplyTo = s =>
            {
                s.Mode = ScheduleMode.Interval;
                s.IntervalMinutes = 60;
                s.RangeStart = "09:00";
                s.RangeEnd = "18:00";
                s.ActiveDays = new List<int>(MondayToFriday);
                s.NotificationText = "Пора сделать перекур! Оторвитесь от экрана на пару минут.";
            },
        },
        new()
        {
            Name = "Помодоро 25/5",
            Description = "25 минут фокуса — 5 минут перерыва, весь рабочий день, Пн–Пт.",
            ApplyTo = s =>
            {
                s.Mode = ScheduleMode.Interval;
                s.IntervalMinutes = 25;
                s.RangeStart = "09:00";
                s.RangeEnd = "18:00";
                s.ActiveDays = new List<int>(MondayToFriday);
                s.NotificationText = "Помодоро завершён — 5 минут отдыха: встаньте, размянитесь.";
            },
        },
        new()
        {
            Name = "Глаза 20-20-20",
            Description = "Каждые 20 минут: 20 секунд смотреть на 20 футов (~6 м) вперёд.",
            ApplyTo = s =>
            {
                s.Mode = ScheduleMode.Interval;
                s.IntervalMinutes = 20;
                s.RangeStart = "09:00";
                s.RangeEnd = "19:00";
                s.ActiveDays = new List<int>(MondayToFriday);
                s.NotificationText = "Правило 20-20-20: посмотрите на ~6 метров вперёд на 20 секунд.";
            },
        },
        new()
        {
            Name = "Разминка каждые полтора часа",
            Description = "Напоминание пройтись и потянуться, 10:00–17:00, Пн–Пт.",
            ApplyTo = s =>
            {
                s.Mode = ScheduleMode.Interval;
                s.IntervalMinutes = 90;
                s.RangeStart = "10:00";
                s.RangeEnd = "17:00";
                s.ActiveDays = new List<int>(MondayToFriday);
                s.NotificationText = "Встаньте, потянитесь, пройдитесь 2–3 минуты.";
            },
        },
        new()
        {
            Name = "Обед в 13:00 (каждый день)",
            Description = "Один сигнал в 13:00 каждый день — пора на обед.",
            ApplyTo = s =>
            {
                s.Mode = ScheduleMode.DailyTime;
                s.DailyTime = "13:00";
                s.ActiveDays = new List<int>(EveryDay);
                s.NotificationText = "Пора на обед! Отвлекитесь от работы.";
            },
        },
        new()
        {
            Name = "Вечернее чай/кофе в 16:00",
            Description = "Один сигнал в 16:00 каждый день — время на чай или кофе.",
            ApplyTo = s =>
            {
                s.Mode = ScheduleMode.DailyTime;
                s.DailyTime = "16:00";
                s.ActiveDays = new List<int>(MondayToFriday);
                s.NotificationText = "Чай или кофе в 16:00? Пять минут отдыха зарядят оставшийся день.";
            },
        },
        new()
        {
            Name = "Отбой от экрана в 23:00",
            Description = "Один сигнал в 23:00 каждый день — закройте ноутбук и отдохните.",
            ApplyTo = s =>
            {
                s.Mode = ScheduleMode.DailyTime;
                s.DailyTime = "23:00";
                s.ActiveDays = new List<int>(EveryDay);
                s.NotificationText = "23:00 — пора заканчивать. Закройте ноутбук и отдохните.";
            },
        },
    };
}
