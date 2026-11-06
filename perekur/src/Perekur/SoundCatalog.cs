using System.Media;

namespace Perekur;

/// <summary>Элемент списка выбора звука.</summary>
public sealed class SoundItem
{
    public required string Id { get; init; }
    public required string Name { get; init; }

    public override string ToString() => Name;
}

/// <summary>
/// Каталог звуков: встроенные системные звуки Windows и .wav-файлы из %WINDIR%\Media.
/// Идентификатор звука: "system:Asterisk" для системных звуков, "wav:<полный путь>" для файлов.
/// </summary>
public static class SoundCatalog
{
    public const string DefaultSoundId = "system:Asterisk";

    /// <summary>Встроенные системные звуки (System.Media.SystemSounds).</summary>
    private static readonly SoundItem[] BuiltIn =
    {
        new() { Id = "system:Asterisk",    Name = "Системный: Asterisk (уведомление)" },
        new() { Id = "system:Beep",        Name = "Системный: Beep (классический сигнал)" },
        new() { Id = "system:Exclamation", Name = "Системный: Exclamation (восклицание)" },
        new() { Id = "system:Hand",        Name = "Системный: Hand (критическая ошибка)" },
        new() { Id = "system:Question",    Name = "Системный: Question (вопрос)" },
    };

    public static string MediaFolder =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Media");

    /// <summary>Полный список звуков: встроенные системные + .wav из папки Windows\Media (по алфавиту).</summary>
    public static List<SoundItem> Enumerate()
    {
        var items = new List<SoundItem>(BuiltIn);

        try
        {
            if (Directory.Exists(MediaFolder))
            {
                var media = new DirectoryInfo(MediaFolder)
                    .EnumerateFiles("*.wav", SearchOption.TopDirectoryOnly)
                    .OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase)
                    .Select(f => new SoundItem
                    {
                        Id = "wav:" + f.FullName,
                        Name = Path.GetFileNameWithoutExtension(f.Name),
                    });
                items.AddRange(media);
            }
        }
        catch
        {
            // Папка недоступна — остаёмся с встроенными системными звуками.
        }

        return items;
    }

    /// <summary>Воспроизводит звук по идентификатору. При любой ошибке — системный Asterisk.</summary>
    public static void Play(string? soundId)
    {
        try
        {
            if (soundId is not null && soundId.StartsWith("wav:", StringComparison.OrdinalIgnoreCase))
            {
                var path = soundId["wav:".Length..];
                if (File.Exists(path))
                {
                    // Файл НЕ освобождаем сразу: воспроизведение асинхронное,
                    // поток воспроизведения удерживает объект самостоятельно.
                    var player = new SoundPlayer(path);
                    player.Play(); // асинхронно, не блокирует UI
                    return;
                }

                SystemSounds.Asterisk.Play();
                return;
            }

            switch (soundId)
            {
                case "system:Beep":        SystemSounds.Beep.Play(); break;
                case "system:Exclamation": SystemSounds.Exclamation.Play(); break;
                case "system:Hand":        SystemSounds.Hand.Play(); break;
                case "system:Question":    SystemSounds.Question.Play(); break;
                default:                   SystemSounds.Asterisk.Play(); break;
            }
        }
        catch
        {
            try { SystemSounds.Asterisk.Play(); } catch { /* звук недоступен */ }
        }
    }
}
