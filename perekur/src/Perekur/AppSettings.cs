namespace Perekur;

/// <summary>Режим расписания напоминаний.</summary>
public enum ScheduleMode
{
    /// <summary>Каждые N минут внутри заданного диапазона времени.</summary>
    Interval = 0,

    /// <summary>Один раз в день в выбранное время.</summary>
    DailyTime = 1,

    /// <summary>Каждый час в заданную минуту (HourlyMinute) внутри диапазона RangeStart–RangeEnd.</summary>
    Hourly = 2,
}

/// <summary>
/// Настройки приложения «Перекур».
/// Сериализуются в JSON (%APPDATA%\Perekur\settings.json).
/// Времена хранятся строками "HH:mm", дни недели — как значения System.DayOfWeek (0 = воскресенье).
/// </summary>
public sealed class AppSettings
{
    public ScheduleMode Mode { get; set; } = ScheduleMode.Interval;

    /// <summary>Интервал повтора сигнала в минутах (режим Interval).</summary>
    public int IntervalMinutes { get; set; } = 60;

    /// <summary>Минута каждого часа для режима Hourly (0–59). По умолчанию 55 — сигнал в :55.</summary>
    public int HourlyMinute { get; set; } = 55;

    /// <summary>Время ежедневного сигнала "HH:mm" (режим DailyTime).</summary>
    public string DailyTime { get; set; } = "13:00";

    /// <summary>Начало активного диапазона "HH:mm" (режимы Interval и Hourly).</summary>
    public string RangeStart { get; set; } = "09:00";

    /// <summary>Конец активного диапазона "HH:mm", не включая (режимы Interval и Hourly).</summary>
    public string RangeEnd { get; set; } = "18:00";

    /// <summary>Дни недели, когда действует расписание. Значения (int)DayOfWeek.</summary>
    public List<int> ActiveDays { get; set; } = new() { 1, 2, 3, 4, 5 }; // Пн–Пт

    /// <summary>Идентификатор звука: "system:Asterisk" или "wav:C:\path\file.wav".</summary>
    public string SoundId { get; set; } = SoundCatalog.DefaultSoundId;

    /// <summary>Текст уведомления в панели уведомлений.</summary>
    public string NotificationText { get; set; } = "Пора сделать перекур! Оторвитесь от экрана на пару минут.";

    /// <summary>Включены ли напоминания.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>Показывать ли уведомление (в дополнение к звуку).</summary>
    public bool ShowBalloon { get; set; } = true;

    /// <summary>Сворачивать ли окно в трей при нажатии на «крестик».</summary>
    public bool MinimizeToTrayOnClose { get; set; } = true;

    /// <summary>Запускать ли приложение сразу свёрнутым в трей.</summary>
    public bool StartMinimized { get; set; } = false;

    /// <summary>Добавлять ли приложение в автозагрузку Windows (HKCU\...\Run).</summary>
    public bool StartWithWindows { get; set; } = false;

    /// <summary>Имя последнего применённого шаблона (для отображения в UI).</summary>
    public string? LastTemplate { get; set; }
}
