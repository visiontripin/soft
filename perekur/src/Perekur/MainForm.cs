using System.Globalization;
using System.Text;

namespace Perekur;

/// <summary>
/// Главное (и единственное) окно «Перекур»: настройки расписания, выбор звука,
/// шаблоны, поведение, иконка в трее и уведомления в панели уведомлений.
/// </summary>
public sealed class MainForm : Form
{
    private static readonly CultureInfo RuCulture = new("ru-RU");

    private readonly AppSettings _settings;
    private readonly ReminderEngine _engine;
    private readonly NotifyIcon _notifyIcon;
    private readonly Icon _appIcon;
    private readonly System.Windows.Forms.Timer _uiTimer;

    private bool _realExit;
    private bool _suppressEvents;
    private bool _trayHintShown;
    private DateTime? _lastTriggered;

    // --- Элементы управления ---
    private ComboBox _cmbTemplate = null!;
    private Label _lblTemplateDesc = null!;
    private ComboBox _cmbSound = null!;
    private RadioButton _rdoInterval = null!;
    private NumericUpDown _nudInterval = null!;
    private RadioButton _rdoDaily = null!;
    private DateTimePicker _dtpDaily = null!;
    private readonly Dictionary<int, CheckBox> _dayChecks = new(); // DayOfWeek (int) -> checkbox
    private DateTimePicker _dtpFrom = null!;
    private DateTimePicker _dtpTo = null!;
    private Label _lblRangeWarning = null!;
    private TextBox _txtNotification = null!;
    private CheckBox _chkEnabled = null!;
    private CheckBox _chkBalloon = null!;
    private CheckBox _chkStartWithWindows = null!;
    private CheckBox _chkStartMinimized = null!;
    private CheckBox _chkMinimizeToTray = null!;
    private Label _lblNext = null!;

    // --- Элементы меню трея ---
    private ToolStripMenuItem _miToggle = null!;

    public MainForm(string[]? args = null)
    {
        _settings = SettingsStore.Load();

        // Иконка приложения (встроенный .ico)
        using (var stream = typeof(MainForm).Assembly.GetManifestResourceStream("Perekur.Assets.perekur.ico")
                             ?? throw new InvalidOperationException("Не найден встроенный ресурс Perekur.Assets.perekur.ico"))
        {
            _appIcon = new Icon(stream);
        }

        Text = "Перекур — напоминание о перерывах";
        ClientSize = new Size(660, 630);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        Icon = _appIcon;
        Font = new Font("Segoe UI", 9F);

        BuildUi();
        LoadSettingsIntoUi();

        _notifyIcon = CreateTrayIcon();

        _engine = new ReminderEngine(_settings);
        _engine.Triggered += OnEngineTriggered;
        _engine.NextRunChanged += (_, _) => UpdateStatusLabel();

        _uiTimer = new System.Windows.Forms.Timer { Interval = 1000 };
        _uiTimer.Tick += (_, _) => UpdateStatusLabel();
        _uiTimer.Start();

        var startHidden = _settings.StartMinimized
                          || (args is not null && args.Any(a => string.Equals(a, "--tray", StringComparison.OrdinalIgnoreCase)));
        if (startHidden)
        {
            Shown += (_, _) => Hide();
        }

        UpdateModeUi();
        UpdateStatusLabel();
        _engine.Start();
    }

    // =====================================================================
    // Построение интерфейса
    // =====================================================================

    private GroupBox MakeGroup(string title, int x, int y, int w, int h)
    {
        var group = new GroupBox { Text = title, Left = x, Top = y, Width = w, Height = h };
        Controls.Add(group);
        return group;
    }

    private void BuildUi()
    {
        // ---------- Шаблоны ----------
        var grpTemplate = MakeGroup("Готовые шаблоны", 8, 8, 644, 88);

        _cmbTemplate = new ComboBox
        {
            Left = 10, Top = 22, Width = 452,
            DropDownStyle = ComboBoxStyle.DropDownList,
        };
        foreach (var template in BreakTemplates.All)
        {
            _cmbTemplate.Items.Add(template);
        }

        _cmbTemplate.DisplayMember = nameof(BreakTemplate.Name);
        if (_cmbTemplate.Items.Count > 0)
        {
            var saved = _settings.LastTemplate is null
                ? -1
                : BreakTemplates.All.ToList().FindIndex(t => t.Name == _settings.LastTemplate);
            _cmbTemplate.SelectedIndex = saved >= 0 ? saved : 0;
        }

        _cmbTemplate.SelectedIndexChanged += (_, _) => UpdateTemplateDescription();

        var btnApplyTemplate = new Button
        {
            Left = 470, Top = 21, Width = 164, Height = 28,
            Text = "Применить",
        };
        btnApplyTemplate.Click += (_, _) => ApplySelectedTemplate();

        _lblTemplateDesc = new Label
        {
            Left = 10, Top = 56, Width = 624, Height = 20,
            ForeColor = SystemColors.GrayText,
            Font = new Font(Font, FontStyle.Italic),
            AutoEllipsis = true,
        };

        grpTemplate.Controls.AddRange(new Control[] { _cmbTemplate, btnApplyTemplate, _lblTemplateDesc });

        // ---------- Звук из системы ----------
        var grpSound = MakeGroup("Сигнал (звуки системы Windows и C:\\Windows\\Media)", 8, 104, 644, 78);

        _cmbSound = new ComboBox
        {
            Left = 10, Top = 28, Width = 436,
            DropDownStyle = ComboBoxStyle.DropDownList,
        };
        foreach (var item in SoundCatalog.Enumerate())
        {
            _cmbSound.Items.Add(item);
        }

        // Если сохранённый звук не найден (файл удалён и т. п.) — добавляем его или откатываемся на умолчание
        var hasSavedSound = _cmbSound.Items.Cast<SoundItem>().Any(i => i.Id == _settings.SoundId);
        if (!hasSavedSound)
        {
            if (_settings.SoundId.StartsWith("wav:", StringComparison.OrdinalIgnoreCase)
                && File.Exists(_settings.SoundId["wav:".Length..]))
            {
                _cmbSound.Items.Add(new SoundItem
                {
                    Id = _settings.SoundId,
                    Name = Path.GetFileNameWithoutExtension(_settings.SoundId["wav:".Length..]),
                });
            }
            else
            {
                _settings.SoundId = SoundCatalog.DefaultSoundId;
            }
        }

        _cmbSound.SelectedIndexChanged += (_, _) =>
        {
            if (_suppressEvents) return;
            ApplySettings();
        };

        var btnBrowse = new Button
        {
            Left = 454, Top = 27, Width = 40, Height = 28,
            Text = "…",
        };
        btnBrowse.Click += (_, _) => BrowseSoundFile();

        var btnTestSound = new Button
        {
            Left = 502, Top = 27, Width = 132, Height = 28,
            Text = "▶ Прослушать",
        };
        btnTestSound.Click += (_, _) =>
        {
            if (_cmbSound.SelectedItem is SoundItem item)
            {
                SoundCatalog.Play(item.Id);
            }
        };

        grpSound.Controls.AddRange(new Control[] { _cmbSound, btnBrowse, btnTestSound });

        // ---------- Расписание ----------
        var grpSchedule = MakeGroup("Расписание", 8, 190, 644, 214);

        _rdoInterval = new RadioButton
        {
            Left = 10, Top = 24, Width = 70, Height = 24,
            Text = "Каждые",
        };

        _nudInterval = new NumericUpDown
        {
            Left = 82, Top = 21, Width = 74, Height = 26,
            Minimum = 1, Maximum = 480, Increment = 5, Value = 60,
            TextAlign = HorizontalAlignment.Right,
        };

        var lblMinutes = new Label
        {
            Left = 164, Top = 25, Width = 42, Height = 22,
            Text = "мин",
            TextAlign = ContentAlignment.MiddleLeft,
        };

        _rdoDaily = new RadioButton
        {
            Left = 236, Top = 24, Width = 150, Height = 24,
            Text = "Каждый день в",
        };

        _dtpDaily = new DateTimePicker
        {
            Left = 384, Top = 21, Width = 116, Height = 26,
            Format = DateTimePickerFormat.Custom,
            CustomFormat = "HH:mm",
            ShowUpDown = true,
        };

        _rdoInterval.CheckedChanged += (_, _) =>
        {
            if (_suppressEvents) return;
            UpdateModeUi();
            ApplySettings();
        };
        _rdoDaily.CheckedChanged += (_, _) =>
        {
            if (_suppressEvents) return;
            UpdateModeUi();
            ApplySettings();
        };
        _nudInterval.ValueChanged += (_, _) => { if (!_suppressEvents) ApplySettings(); };
        _dtpDaily.ValueChanged += (_, _) => { if (!_suppressEvents) ApplySettings(); };

        var lblDays = new Label
        {
            Left = 10, Top = 66, Width = 116, Height = 22,
            Text = "Активные дни:",
            TextAlign = ContentAlignment.MiddleLeft,
        };

        var dayNames = new (int Day, string Short)[]
        {
            ((int)DayOfWeek.Monday, "Пн"),
            ((int)DayOfWeek.Tuesday, "Вт"),
            ((int)DayOfWeek.Wednesday, "Ср"),
            ((int)DayOfWeek.Thursday, "Чт"),
            ((int)DayOfWeek.Friday, "Пт"),
            ((int)DayOfWeek.Saturday, "Сб"),
            ((int)DayOfWeek.Sunday, "Вс"),
        };

        var dayX = 130;
        foreach (var (day, shortName) in dayNames)
        {
            var chk = new CheckBox
            {
                Left = dayX, Top = 62, Width = 40, Height = 24,
                Text = shortName,
                Tag = day,
            };
            chk.CheckedChanged += (_, _) => { if (!_suppressEvents) ApplySettings(); };
            _dayChecks[day] = chk;
            grpSchedule.Controls.Add(chk);
            dayX += 44;
        }

        var lblRange = new Label
        {
            Left = 10, Top = 100, Width = 300, Height = 22,
            Text = "Диапазон времени (для интервала):",
            TextAlign = ContentAlignment.MiddleLeft,
        };

        _dtpFrom = new DateTimePicker
        {
            Left = 10, Top = 126, Width = 96, Height = 26,
            Format = DateTimePickerFormat.Custom,
            CustomFormat = "HH:mm",
            ShowUpDown = true,
        };
        _dtpFrom.ValueChanged += (_, _) => { if (!_suppressEvents) ApplySettings(); };

        var lblDash = new Label
        {
            Left = 110, Top = 129, Width = 22, Height = 22,
            Text = "—",
            TextAlign = ContentAlignment.MiddleCenter,
        };

        _dtpTo = new DateTimePicker
        {
            Left = 134, Top = 126, Width = 96, Height = 26,
            Format = DateTimePickerFormat.Custom,
            CustomFormat = "HH:mm",
            ShowUpDown = true,
        };
        _dtpTo.ValueChanged += (_, _) => { if (!_suppressEvents) ApplySettings(); };

        _lblRangeWarning = new Label
        {
            Left = 240, Top = 129, Width = 384, Height = 22,
            Text = "вне этого диапазона сигнал не звучит",
            ForeColor = SystemColors.GrayText,
            Font = new Font(Font, FontStyle.Italic),
            TextAlign = ContentAlignment.MiddleLeft,
        };

        var lblNotif = new Label
        {
            Left = 10, Top = 160, Width = 200, Height = 20,
            Text = "Текст уведомления:",
            TextAlign = ContentAlignment.MiddleLeft,
        };

        _txtNotification = new TextBox
        {
            Left = 10, Top = 180, Width = 624, Height = 24,
            MaxLength = 200,
        };
        _txtNotification.TextChanged += (_, _) => { if (!_suppressEvents) ApplySettings(); };

        grpSchedule.Controls.AddRange(new Control[]
        {
            _rdoInterval, _nudInterval, lblMinutes, _rdoDaily, _dtpDaily,
            lblDays, lblRange, _dtpFrom, lblDash, _dtpTo, _lblRangeWarning,
            lblNotif, _txtNotification,
        });

        // ---------- Поведение ----------
        var grpBehavior = MakeGroup("Поведение", 8, 412, 644, 138);

        _chkEnabled = new CheckBox
        {
            Left = 10, Top = 20, Width = 620, Height = 22,
            Text = "Напоминания включены",
        };
        _chkEnabled.CheckedChanged += (_, _) =>
        {
            if (_suppressEvents) return;
            ApplySettings();
        };

        _chkBalloon = new CheckBox
        {
            Left = 10, Top = 46, Width = 620, Height = 22,
            Text = "Показывать уведомление в панели уведомлений (Action Center)",
        };
        _chkBalloon.CheckedChanged += (_, _) => { if (!_suppressEvents) ApplySettings(); };

        _chkStartWithWindows = new CheckBox
        {
            Left = 10, Top = 72, Width = 300, Height = 22,
            Text = "Запускать вместе с Windows",
        };
        _chkStartWithWindows.CheckedChanged += OnStartWithWindowsChanged;

        _chkStartMinimized = new CheckBox
        {
            Left = 330, Top = 72, Width = 300, Height = 22,
            Text = "Запускать свёрнутым в трей",
        };
        _chkStartMinimized.CheckedChanged += (_, _) => { if (!_suppressEvents) ApplySettings(); };

        _chkMinimizeToTray = new CheckBox
        {
            Left = 10, Top = 98, Width = 620, Height = 22,
            Text = "Сворачивать в трей при закрытии окна (выход — через меню в трее)",
        };
        _chkMinimizeToTray.CheckedChanged += (_, _) => { if (!_suppressEvents) ApplySettings(); };

        grpBehavior.Controls.AddRange(new Control[]
        {
            _chkEnabled, _chkBalloon, _chkStartWithWindows, _chkStartMinimized, _chkMinimizeToTray,
        });

        // ---------- Статус и нижние кнопки ----------
        _lblNext = new Label
        {
            Left = 12, Top = 556, Width = 636, Height = 22,
            Font = new Font(Font, FontStyle.Bold),
            ForeColor = Color.FromArgb(180, 83, 9),
            TextAlign = ContentAlignment.MiddleLeft,
            AutoEllipsis = true,
            Text = "…",
        };
        Controls.Add(_lblNext);

        var btnNow = new Button
        {
            Left = 8, Top = 582, Width = 190, Height = 38,
            Text = "🔔 Перекур сейчас",
        };
        btnNow.Click += (_, _) => FireNow();

        var btnHide = new Button
        {
            Left = 206, Top = 582, Width = 150, Height = 38,
            Text = "Скрыть в трей",
        };
        btnHide.Click += (_, _) => Hide();

        var lblAutosave = new Label
        {
            Left = 364, Top = 592, Width = 288, Height = 20,
            Text = "Настройки сохраняются автоматически",
            ForeColor = SystemColors.GrayText,
            Font = new Font(Font, FontStyle.Italic),
            TextAlign = ContentAlignment.MiddleRight,
        };

        Controls.AddRange(new Control[] { btnNow, btnHide, lblAutosave });

        UpdateTemplateDescription();
    }

    // =====================================================================
    // Трей
    // =====================================================================

    private NotifyIcon CreateTrayIcon()
    {
        var menu = new ContextMenuStrip();

        var miOpen = new ToolStripMenuItem("Открыть настройки");
        miOpen.Click += (_, _) => ShowFromTray();

        _miToggle = new ToolStripMenuItem("Напоминания включены")
        {
            CheckOnClick = true,
            Checked = _settings.Enabled,
        };
        _miToggle.Click += (_, _) =>
        {
            _suppressEvents = true;
            _chkEnabled.Checked = _miToggle.Checked;
            _suppressEvents = false;
            ApplySettings();
        };

        var miNow = new ToolStripMenuItem("Перекур сейчас");
        miNow.Click += (_, _) => FireNow();

        var miSnooze = new ToolStripMenuItem("Отложить на 5 минут");
        miSnooze.Click += (_, _) =>
        {
            _engine.Snooze(5);
        };

        var miExit = new ToolStripMenuItem("Выход");
        miExit.Click += (_, _) => ExitApplication();

        menu.Items.AddRange(new ToolStripItem[]
        {
            miOpen,
            _miToggle,
            new ToolStripSeparator(),
            miNow,
            miSnooze,
            new ToolStripSeparator(),
            miExit,
        });

        var icon = new NotifyIcon
        {
            Icon = _appIcon,
            Text = "Перекур — напоминание о перерывах",
            Visible = true,
            ContextMenuStrip = menu,
        };
        icon.DoubleClick += (_, _) => ShowFromTray();
        icon.BalloonTipClicked += (_, _) => ShowFromTray();
        return icon;
    }

    private void ShowFromTray()
    {
        Show();
        WindowState = FormWindowState.Normal;
        Activate();
    }

    private void ExitApplication()
    {
        _realExit = true;
        Close();
    }

    // =====================================================================
    // Логика настроек
    // =====================================================================

    private void UpdateTemplateDescription()
    {
        _lblTemplateDesc.Text = _cmbTemplate.SelectedItem is BreakTemplate template
            ? template.Description
            : string.Empty;
    }

    private void ApplySelectedTemplate()
    {
        if (_cmbTemplate.SelectedItem is not BreakTemplate template)
        {
            return;
        }

        template.ApplyTo(_settings);
        _settings.LastTemplate = template.Name;
        LoadSettingsIntoUi();   // с подавлением событий
        ApplySettings();        // сохранить и пересчитать расписание
    }

    private void BrowseSoundFile()
    {
        using var dialog = new OpenFileDialog
        {
            Title = "Выберите звуковой файл",
            Filter = "Звуковые файлы WAV (*.wav)|*.wav",
            CheckFileExists = true,
            Multiselect = false,
        };

        if (dialog.ShowDialog(this) != DialogResult.OK)
        {
            return;
        }

        var id = "wav:" + dialog.FileName;
        var exists = _cmbSound.Items.Cast<SoundItem>().FirstOrDefault(i => i.Id == id);
        if (exists is null)
        {
            var item = new SoundItem
            {
                Id = id,
                Name = Path.GetFileNameWithoutExtension(dialog.FileName) + " (свой файл)",
            };
            // Вставляем в начало списка медиа-файлов (после 5 встроенных системных звуков)
            _cmbSound.Items.Insert(Math.Min(5, _cmbSound.Items.Count), item);
            exists = item;
        }

        _suppressEvents = true;
        _cmbSound.SelectedItem = exists;
        _suppressEvents = false;
        ApplySettings();
    }

    private void OnStartWithWindowsChanged(object? sender, EventArgs e)
    {
        if (_suppressEvents)
        {
            return;
        }

        try
        {
            Autostart.SetEnabled(_chkStartWithWindows.Checked);
        }
        catch (Exception ex)
        {
            _suppressEvents = true;
            _chkStartWithWindows.Checked = !_chkStartWithWindows.Checked;
            _suppressEvents = false;
            MessageBox.Show(this,
                "Не удалось изменить автозагрузку Windows:\n" + ex.Message,
                "Перекур", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        ApplySettings();
    }

    private void LoadSettingsIntoUi()
    {
        _suppressEvents = true;
        try
        {
            _rdoInterval.Checked = _settings.Mode == ScheduleMode.Interval;
            _rdoDaily.Checked = _settings.Mode == ScheduleMode.DailyTime;
            _nudInterval.Value = Math.Clamp(_settings.IntervalMinutes, (int)_nudInterval.Minimum, (int)_nudInterval.Maximum);
            _dtpDaily.Value = DateTime.Today + ReminderEngine.ParseTime(_settings.DailyTime, new TimeSpan(13, 0, 0));
            _dtpFrom.Value = DateTime.Today + ReminderEngine.ParseTime(_settings.RangeStart, new TimeSpan(9, 0, 0));
            _dtpTo.Value = DateTime.Today + ReminderEngine.ParseTime(_settings.RangeEnd, new TimeSpan(18, 0, 0));

            foreach (var (day, chk) in _dayChecks)
            {
                chk.Checked = _settings.ActiveDays?.Contains(day) == true;
            }

            var sound = _cmbSound.Items.Cast<SoundItem>().FirstOrDefault(i => i.Id == _settings.SoundId)
                        ?? _cmbSound.Items.Cast<SoundItem>().First(i => i.Id == SoundCatalog.DefaultSoundId);
            _cmbSound.SelectedItem = sound;

            _txtNotification.Text = _settings.NotificationText;
            _chkEnabled.Checked = _settings.Enabled;
            _chkBalloon.Checked = _settings.ShowBalloon;
            _chkStartWithWindows.Checked = Autostart.IsEnabled();
            _chkStartMinimized.Checked = _settings.StartMinimized;
            _chkMinimizeToTray.Checked = _settings.MinimizeToTrayOnClose;
        }
        finally
        {
            _suppressEvents = false;
        }
    }

    private void ReadUiIntoSettings()
    {
        _settings.Mode = _rdoDaily.Checked ? ScheduleMode.DailyTime : ScheduleMode.Interval;
        _settings.IntervalMinutes = (int)_nudInterval.Value;
        _settings.DailyTime = _dtpDaily.Value.ToString("HH:mm", CultureInfo.InvariantCulture);
        _settings.RangeStart = _dtpFrom.Value.ToString("HH:mm", CultureInfo.InvariantCulture);
        _settings.RangeEnd = _dtpTo.Value.ToString("HH:mm", CultureInfo.InvariantCulture);
        _settings.ActiveDays = _dayChecks.Where(pair => pair.Value.Checked).Select(pair => pair.Key).ToList();
        _settings.SoundId = _cmbSound.SelectedItem is SoundItem item ? item.Id : SoundCatalog.DefaultSoundId;
        _settings.NotificationText = string.IsNullOrWhiteSpace(_txtNotification.Text)
            ? "Пора сделать перекур!"
            : _txtNotification.Text.Trim();
        _settings.Enabled = _chkEnabled.Checked;
        _settings.ShowBalloon = _chkBalloon.Checked;
        _settings.StartWithWindows = _chkStartWithWindows.Checked;
        _settings.StartMinimized = _chkStartMinimized.Checked;
        _settings.MinimizeToTrayOnClose = _chkMinimizeToTray.Checked;
    }

    private void ApplySettings()
    {
        ReadUiIntoSettings();
        try
        {
            SettingsStore.Save(_settings);
        }
        catch
        {
            // Нет доступа к %APPDATA% — не роняем приложение, просто не сохраняем.
        }

        _engine.UpdateSettings(_settings);
        if (_miToggle is not null)
        {
            _miToggle.Checked = _settings.Enabled;
        }

        UpdateModeUi();
        UpdateStatusLabel();
    }

    private void UpdateModeUi()
    {
        var interval = _rdoInterval.Checked;
        _nudInterval.Enabled = interval;
        _dtpFrom.Enabled = interval;
        _dtpTo.Enabled = interval;
        _dtpDaily.Enabled = !interval;
    }

    // =====================================================================
    // Статус и срабатывание
    // =====================================================================

    private void OnEngineTriggered(object? sender, DateTime when)
    {
        FireNow();
    }

    private void FireNow()
    {
        _lastTriggered = DateTime.Now;
        SoundCatalog.Play(_settings.SoundId);

        if (_settings.ShowBalloon)
        {
            _notifyIcon.ShowBalloonTip(
                6000,
                "Перекур",
                string.IsNullOrWhiteSpace(_settings.NotificationText)
                    ? "Пора сделать перекур!"
                    : _settings.NotificationText,
                ToolTipIcon.Info);
        }

        UpdateStatusLabel();
    }

    private void UpdateStatusLabel()
    {
        if (_settings.Mode == ScheduleMode.Interval && !ReminderEngine.IsRangeValid(_settings))
        {
            _lblNext.Text = "⚠ Некорректный диапазон: «до» должно быть позже «с»";
            _lblNext.ForeColor = Color.FromArgb(185, 28, 28);
            return;
        }

        if (_settings.ActiveDays is not { Count: > 0 })
        {
            _lblNext.Text = "⚠ Выберите хотя бы один день недели";
            _lblNext.ForeColor = Color.FromArgb(185, 28, 28);
            return;
        }

        if (!_settings.Enabled)
        {
            _lblNext.Text = "⏸ Напоминания приостановлены";
            _lblNext.ForeColor = SystemColors.GrayText;
            return;
        }

        var builder = new StringBuilder();
        if (_engine?.NextRun is DateTime next)
        {
            builder.Append("Следующий сигнал: ").Append(FormatNextRun(next));
        }
        else
        {
            builder.Append("Следующий сигнал: —");
        }

        if (_lastTriggered is DateTime last)
        {
            builder.Append("  ·  Последний: ").Append(last.ToString("HH:mm"));
        }

        _lblNext.Text = builder.ToString();
        _lblNext.ForeColor = Color.FromArgb(180, 83, 9);
    }

    private static string FormatNextRun(DateTime next)
    {
        var now = DateTime.Now;
        var diff = next - now;

        string day =
            next.Date == now.Date ? "сегодня" :
            next.Date == now.Date.AddDays(1) ? "завтра" :
            next.ToString("dddd, d MMMM", RuCulture);

        string countdown;
        if (diff.TotalMinutes < 1)
        {
            countdown = "меньше минуты";
        }
        else if (diff.TotalHours < 1)
        {
            countdown = $"{(int)diff.TotalMinutes} мин";
        }
        else if (diff.TotalDays < 1)
        {
            countdown = $"{(int)diff.TotalHours} ч {diff.Minutes} мин";
        }
        else
        {
            countdown = $"{(int)diff.TotalDays} дн {diff.Hours} ч";
        }

        return $"{day} в {next:HH:mm} (через {countdown})";
    }

    // =====================================================================
    // Закрытие
    // =====================================================================

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!_realExit
            && _settings.MinimizeToTrayOnClose
            && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide(); // крестиком окно прячется в трей, приложение продолжает работать

            if (!_trayHintShown)
            {
                _trayHintShown = true;
                _notifyIcon?.ShowBalloonTip(
                    4000,
                    "Перекур",
                    "Окно скрыто в трей — напоминания продолжают работать. Двойной клик по значку открывает окно.",
                    ToolTipIcon.Info);
            }

            return;
        }

        base.OnFormClosing(e);
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _uiTimer?.Stop();
        _uiTimer?.Dispose();
        _engine?.Dispose();

        if (_notifyIcon is not null)
        {
            _notifyIcon.Visible = false;
            _notifyIcon.Dispose();
        }

        _appIcon?.Dispose();
        base.OnFormClosed(e);
    }
}
