@echo off
rem Сборка единого Perekur.exe (self-contained, .NET 8 не требуется на целевой машине)
cd /d "%~dp0"
dotnet publish src\Perekur -c Release -r win-x64 --self-contained true ^
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
if errorlevel 1 (
  echo.
  echo ОШИБКА СБОРКИ. Установите .NET 8 SDK: winget install Microsoft.DotNet.SDK.8
  exit /b 1
)
echo.
echo Готово: src\Perekur\bin\Release\net8.0-windows\win-x64\publish\Perekur.exe
