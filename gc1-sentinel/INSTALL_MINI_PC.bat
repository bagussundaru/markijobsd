@echo off
setlocal enabledelayedexpansion
title GC 1 Sentinel - Installer & Deployer Mini PC
color 0B

echo =======================================================================
echo          [GC 1 SENTINEL - ONE-CLICK INSTALLER & DEPLOYER]
echo              Pusat Monitoring Government Cloud 1 (PDN)
echo =======================================================================
echo.

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

REM -------------------------------------------------------------------------
REM 1. Deteksi Python di Windows 11 / Windows 10
REM -------------------------------------------------------------------------
echo [*] Memeriksa lingkungan Python...
set "PYTHON_EXE="

where python >nul 2>&1
if %errorlevel% equ 0 set "PYTHON_EXE=python"

if not defined PYTHON_EXE (
    where py >nul 2>&1
    if not errorlevel 1 set "PYTHON_EXE=py"
)

if not defined PYTHON_EXE if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PYTHON_EXE if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
if not defined PYTHON_EXE if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" set "PYTHON_EXE=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
if not defined PYTHON_EXE if exist "%ProgramFiles%\Python312\python.exe" set "PYTHON_EXE=%ProgramFiles%\Python312\python.exe"
if not defined PYTHON_EXE if exist "%ProgramFiles%\Python311\python.exe" set "PYTHON_EXE=%ProgramFiles%\Python311\python.exe"
if not defined PYTHON_EXE if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe" set "PYTHON_EXE=%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe"

if not defined PYTHON_EXE (
    color 0C
    echo [ERROR] Python belum terpasang di Mini PC ini!
    echo.
    echo Cara Mudah Memasang Python:
    echo 1. Buka Microsoft Store di Windows.
    echo 2. Cari 'Python 3.12' lalu klik Pasang / Get.
    echo 3. Setelah selesai, jalankan kembali INSTALL_MINI_PC.bat ini.
    echo.
    pause
    exit /b 1
)

echo [OK] Python ditemukan: %PYTHON_EXE%
echo.

REM -------------------------------------------------------------------------
REM 2. Inisialisasi Database SQLite & Self-Test
REM -------------------------------------------------------------------------
echo [*] Menyiapkan database lokal SQLite (sentinel.db)...
"%PYTHON_EXE%" -c "import sentinel_db; sentinel_db.init_db(); print('    -> Database SQLite siap (Bebas Mockup).')"

REM -------------------------------------------------------------------------
REM 3. Deteksi Lokasi Google Chrome
REM -------------------------------------------------------------------------
echo [*] Memeriksa Google Chrome...
set "CHROME_BIN="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME_BIN=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not defined CHROME_BIN if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME_BIN=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not defined CHROME_BIN if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME_BIN=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if defined CHROME_BIN (
    echo [OK] Google Chrome ditemukan: %CHROME_BIN%
) else (
    echo [WARN] Google Chrome tidak ditemukan di path default.
)
echo.

REM -------------------------------------------------------------------------
REM 4. Pasang Desktop Shortcut & Startup Otomatis Windows (Auto-Boot)
REM -------------------------------------------------------------------------
echo [*] Memasang Shortcut Desktop dan Startup Otomatis Windows...

set "DESKTOP_DIR=%USERPROFILE%\Desktop"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LAUNCHER_BAT=%SCRIPT_DIR%1-JALANKAN_SEMUA.bat"

powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$scDesk = $ws.CreateShortcut('%DESKTOP_DIR%\GC 1 Sentinel Monitor.lnk'); " ^
  "$scDesk.TargetPath = '%LAUNCHER_BAT%'; " ^
  "$scDesk.WorkingDirectory = '%SCRIPT_DIR%'; " ^
  "$scDesk.Description = 'Pusat Monitoring Government Cloud 1'; " ^
  "if (Test-Path '%SCRIPT_DIR%icons\icon128.png') { $scDesk.IconLocation = '%SCRIPT_DIR%icons\icon128.png'; }; " ^
  "$scDesk.Save(); " ^
  "$scStart = $ws.CreateShortcut('%STARTUP_DIR%\GC 1 Sentinel AutoStart.lnk'); " ^
  "$scStart.TargetPath = '%LAUNCHER_BAT%'; " ^
  "$scStart.WorkingDirectory = '%SCRIPT_DIR%'; " ^
  "$scStart.Description = 'Auto-start GC 1 Sentinel saat Mini PC menyala'; " ^
  "$scStart.Save(); " ^
  "Write-Host '    -> Desktop Shortcut: BERHASIL dibuat di Desktop.'" ; ^
  "Write-Host '    -> Windows Startup : BERHASIL dipasang (Auto-Boot aktif).'"

echo.
echo =======================================================================
echo          [SUKSES] INSTALASI & KONFIGURASI MINI PC SELESAI!
echo =======================================================================
echo  1. Desktop Shortcut  : 'GC 1 Sentinel Monitor' sudah muncul di Desktop
echo  2. Auto-Start Boot   : Aktif (Otomatis hidup jika Mini PC restart/mati lampu)
echo  3. Database SQLite   : sentinel.db (Permanen & Audit Trail Aktif)
echo  4. Ekstensi Chrome   : Dilengkapi Smart Auto-Reload (Refresh per 60s)
echo  5. Hermes Liaison    : Siap melayani tanya-jawab Manager/VP via WA
echo =======================================================================
echo.

set /p RUN_NOW="Apakah ingin langsung menjalankan aplikasi sekarang? (Y/T) [Y]: "
if /i "%RUN_NOW%"=="" set "RUN_NOW=Y"
if /i "%RUN_NOW%"=="Y" (
    echo.
    echo [*] Meluncurkan GC 1 Sentinel...
    start "" "%LAUNCHER_BAT%"
)

echo.
echo Terima kasih! Anda dapat menutup jendela installer ini.
timeout /t 5
