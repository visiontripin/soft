namespace Perekur;

/// <summary>
/// Планировщик сигналов «Перекур». Проверяет раз в секунду, не наступило ли время
/// следующего сигнала. Сигналы привязаны к началу диапазона (RangeStart + k * Interval),
/// поэтому расписание предсказуемо: 09:00, 10:00, 11:00…
/// </summary>
public sealed class ReminderEngine : IDisposable
{
    private readonly System.Windows.Forms.Timer _timer;
    private AppSettings _settings;
    private DateTime? _nextRun;

    /// <summary>Срабатывает в момент подачи сигнала.</summary>
    public event EventHandler<DateTime>? Triggered;

    /// <summary>Срабатывает при пересчёте следующего сигнала (или его отсутствии).</summary>
    public event EventHandler? NextRunChanged;

    public ReminderEngine(AppSettings settings)
    {
        _settings = settings;
        _timer = new System.Windows.Forms.Timer { Interval = 1000 };
        _timer.Tick += OnTick;
    }

    /// <summary>Момент следующего сигнала или null, если расписание невалидно/выключено.</summary>
    public DateTime? NextRun => _nextRun;

    public void Start()
    {
        _timer.Start();
        Reschedule();
    }

    public void UpdateSettings(AppSettings settings)
    {
        _settings = settings;
        Reschedule();
    }

    /// <summary>Откладывает следующий сигнал на указанное количество минут.</summary>
    public void Snooze(int minutes)
    {
        if (!_settings.Enabled)
        {
            return; // напоминания приостановлены — откладывать нечего
        }

        _nextRun = DateTime.Now.AddMinutes(minutes);
        NextRunChanged?.Invoke(this, EventArgs.Empty);
    }

    public void Reschedule()
    {
        _nextRun = _settings.Enabled ? ComputeNext(_settings, DateTime.Now) : null;
        NextRunChanged?.Invoke(this, EventArgs.Empty);
    }

    public void Dispose()
    {
        _timer.Stop();
        _timer.Dispose();
    }

    private void OnTick(object? sender, EventArgs e)
    {
        if (_nextRun is not { } due || DateTime.Now < due)
        {
            return;
        }

        var firedAt = DateTime.Now;
        Triggered?.Invoke(this, firedAt);

        // Следующий строго после now, чтобы не было двойного срабатывания.
        _nextRun = _settings.Enabled ? ComputeNext(_settings, firedAt.AddSeconds(1)) : null;
        NextRunChanged?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Ближайшее время сигнала строго после <paramref name="from"/> или null.</summary>
    public static DateTime? ComputeNext(AppSettings settings, DateTime from)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return settings.Mode == ScheduleMode.Interval
            ? ComputeNextInterval(settings, from)
            : ComputeNextDaily(settings, from);
    }

    public static TimeSpan ParseTime(string? value, TimeSpan fallback) =>
        TimeSpan.TryParse(value, out var ts) && ts >= TimeSpan.Zero && ts < TimeSpan.FromDays(1)
            ? ts
            : fallback;

    public static bool IsRangeValid(AppSettings settings)
    {
        var start = ParseTime(settings.RangeStart, new TimeSpan(9, 0, 0));
        var end = ParseTime(settings.RangeEnd, new TimeSpan(18, 0, 0));
        return end > start;
    }

    private static bool IsActiveDay(AppSettings settings, DateTime day) =>
        settings.ActiveDays is { Count: > 0 } days && days.Contains((int)day.DayOfWeek);

    private static DateTime? ComputeNextInterval(AppSettings settings, DateTime from)
    {
        var rangeStart = ParseTime(settings.RangeStart, new TimeSpan(9, 0, 0));
        var rangeEnd = ParseTime(settings.RangeEnd, new TimeSpan(18, 0, 0));
        if (rangeEnd <= rangeStart)
        {
            return null; // некорректный диапазон — сигналов нет
        }

        var interval = TimeSpan.FromMinutes(Math.Clamp(settings.IntervalMinutes, 1, 24 * 60));

        // Ищем ближайший сигнал на ближайшие 14 дней (вдруг все дни выключены).
        for (var dayOffset = 0; dayOffset < 14; dayOffset++)
        {
            var day = from.Date.AddDays(dayOffset);
            if (!IsActiveDay(settings, day))
            {
                continue;
            }

            var startOfDay = day + rangeStart;
            var endOfDay = day + rangeEnd;
            var candidate = startOfDay;

            if (candidate <= from)
            {
                // Первый сигнал строго после now: RangeStart + k * Interval.
                var elapsed = from - startOfDay;
                var k = (long)Math.Floor(elapsed.TotalMinutes / interval.TotalMinutes) + 1;
                candidate = startOfDay + TimeSpan.FromMinutes(k * interval.TotalMinutes);
            }

            if (candidate < endOfDay)
            {
                return candidate;
            }
        }

        return null;
    }

    private static DateTime? ComputeNextDaily(AppSettings settings, DateTime from)
    {
        var time = ParseTime(settings.DailyTime, new TimeSpan(13, 0, 0));

        for (var dayOffset = 0; dayOffset < 14; dayOffset++)
        {
            var day = from.Date.AddDays(dayOffset);
            if (!IsActiveDay(settings, day))
            {
                continue;
            }

            var candidate = day + time;
            if (candidate > from)
            {
                return candidate;
            }
        }

        return null;
    }
}
