using System.Text.Json;
using System.Text.Json.Serialization;

namespace Perekur;

/// <summary>Загрузка и сохранение настроек в %APPDATA%\Perekur\settings.json.</summary>
public static class SettingsStore
{
    public static string SettingsDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Perekur");

    public static string SettingsFile => Path.Combine(SettingsDirectory, "settings.json");

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };

    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(SettingsFile))
            {
                var json = File.ReadAllText(SettingsFile);
                var loaded = JsonSerializer.Deserialize<AppSettings>(json, JsonOptions);
                if (loaded is not null)
                {
                    loaded.ActiveDays ??= new List<int> { 1, 2, 3, 4, 5 };
                    loaded.SoundId ??= SoundCatalog.DefaultSoundId;
                    loaded.NotificationText ??= "Пора сделать перекур!";
                    loaded.RangeStart ??= "09:00";
                    loaded.RangeEnd ??= "18:00";
                    loaded.DailyTime ??= "13:00";
                    return loaded;
                }
            }
        }
        catch
        {
            // Повреждённый файл не должен ронять приложение: сохраняем копию и возвращаем умолчания.
            try
            {
                if (File.Exists(SettingsFile))
                {
                    File.Copy(SettingsFile, SettingsFile + ".bak", overwrite: true);
                }
            }
            catch
            {
                // Игнорируем ошибки резервного копирования.
            }
        }

        var defaults = new AppSettings();
        defaults.StartWithWindows = Autostart.IsEnabled();
        return defaults;
    }

    public static void Save(AppSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        Directory.CreateDirectory(SettingsDirectory);
        File.WriteAllText(SettingsFile, JsonSerializer.Serialize(settings, JsonOptions));
    }
}
