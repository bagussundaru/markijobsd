@echo off
title GC 1 Sentinel Monitor - Mini PC Launcher
color 0B

echo =======================================================================
echo          [GC 1 SENTINEL MONITOR - KEMASAN DEPLOY MINI PC]
echo                 Pemerintah Cloud 1 (Komdigi / PDN)
echo =======================================================================
echo.

set "CURRENT_DIR=%~dp0"
cd /d "%CURRENT_DIR%"

REM 1. Verifikasi instalasi Python di Windows 11
set "PYTHON_CMD="

REM Cek python di PATH
where python >nul 2>nul
if %errorlevel% equ 0 set "PYTHON_CMD=python"

REM Cek Python Launcher (py)
if not defined PYTHON_CMD (
    where py >nul 2>nul
    if not errorlevel 1 set "PYTHON_CMD=py"
)

REM Cek lokasi standar instalasi User
if not defined PYTHON_CMD if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set "PYTHON_CMD=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
if not defined PYTHON_CMD if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" set "PYTHON_CMD=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
if not defined PYTHON_CMD if exist "%LOCALAPPDATA%\Programs\Python\Python313\python.exe" set "PYTHON_CMD=%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
if not defined PYTHON_CMD if exist "%LOCALAPPDATA%\Programs\Python\Python314\python.exe" set "PYTHON_CMD=%LOCALAPPDATA%\Programs\Python\Python314\python.exe"
if not defined PYTHON_CMD if exist "%LOCALAPPDATA%\Programs\Python\Python310\python.exe" set "PYTHON_CMD=%LOCALAPPDATA%\Programs\Python\Python310\python.exe"

REM Cek lokasi standar Program Files
if not defined PYTHON_CMD if exist "%ProgramFiles%\Python312\python.exe" set "PYTHON_CMD=%ProgramFiles%\Python312\python.exe"
if not defined PYTHON_CMD if exist "%ProgramFiles%\Python311\python.exe" set "PYTHON_CMD=%ProgramFiles%\Python311\python.exe"
if not defined PYTHON_CMD if exist "%ProgramFiles%\Python313\python.exe" set "PYTHON_CMD=%ProgramFiles%\Python313\python.exe"
if not defined PYTHON_CMD if exist "%ProgramFiles%\Python314\python.exe" set "PYTHON_CMD=%ProgramFiles%\Python314\python.exe"
if not defined PYTHON_CMD if exist "%ProgramFiles%\Python310\python.exe" set "PYTHON_CMD=%ProgramFiles%\Python310\python.exe"

REM Cek Microsoft Store Python
if not defined PYTHON_CMD if exist "%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe" set "PYTHON_CMD=%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe"

REM Jika Python tidak ditemukan, lompat ke petunjuk instalasi
if not defined PYTHON_CMD goto :no_python

echo [OK] Python terdeteksi: %PYTHON_CMD%
echo.
goto :start_services

:no_python
color 0C
echo [ERROR] Python belum terpasang atau belum dikenali di Windows 11 ini.
echo.
echo =======================================================================
echo SOLUSI MUDAH MEMASANG PYTHON - PILIH SALAH SATU:
echo =======================================================================
echo Cara 1 - Paling Mudah dan Bebas Blokir:
echo   1. Buka Microsoft Store di menu Start Windows 11.
echo   2. Cari Python 3.12.
echo   3. Klik tombol Get atau Pasang.
echo.
echo Cara 2 - Jika Menggunakan File Installer .exe:
echo   1. Buka folder Downloads tempat file installer python-3.12.x berada.
echo   2. Klik kanan file installer, pilih Properties.
echo   3. Di bagian bawah tab General, centang: Unblock, lalu klik OK.
echo   4. Buka installer dan PASTIKAN CENTANG: Add python.exe to PATH.
echo =======================================================================
echo Setelah selesai, buka kembali file 1-JALANKAN_SEMUA.bat ini.
echo =======================================================================
echo.
pause
exit /b 1

:start_services
REM 2. Jalankan GC 1 Sentinel Backend Server (Port 8765)
echo [1/3] Menyiapkan GC 1 Sentinel Server (Port 8765)...
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel% neq 0 (
    start "GC1 Sentinel Server [Port 8765]" /min "%PYTHON_CMD%" "%CURRENT_DIR%sentinel_server.py"
    timeout /t 2 /nobreak >nul
    echo       -^> Sentinel Server BERHASIL dijalankan.
) else (
    echo       -^> Sentinel Server sudah aktif di port 8765.
)

REM 3. Jalankan Markijo Autonomous Agent
echo [2/3] Menyiapkan Markijo Autonomous Agent (Auto-Rekap ke mimi Sandora)...
powershell -NoProfile -Command "$p = Get-Process -Name 'python*' -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*markijo_agent.py*' }; if ($p) { exit 0 } else { exit 1 }" 2>nul
if %errorlevel% neq 0 (
    start "Markijo GC 1 Agent" /min "%PYTHON_CMD%" "%CURRENT_DIR%markijo_agent.py" --interval 30
    timeout /t 1 /nobreak >nul
    echo       -^> Markijo Agent BERHASIL dijalankan.
) else (
    echo       -^> Markijo Agent sudah aktif berjalan.
)

REM 4. Deteksi lokasi Google Chrome di Windows 11
echo [3/3] Menyiapkan Google Chrome dengan Ekstensi GC 1 Sentinel...
set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

set "EXT_DIR=%CURRENT_DIR:~0,-1%"

if "%HELPDESK_URL%"=="" set "HELPDESK_URL=https://pdn.layanan.go.id"

if exist "%CHROME_EXE%" (
    echo       -^> Chrome ditemukan: %CHROME_EXE%
    echo       -^> Membuka WhatsApp Web, Monitor GC 1, dan Portal Helpdesk (%HELPDESK_URL%)...
    start "" "%CHROME_EXE%" --load-extension="%EXT_DIR%" "https://web.whatsapp.com" "http://localhost:8765/dashboard.html" "%HELPDESK_URL%"
) else (
    echo       [PERINGATAN] Google Chrome tidak ditemukan di direktori standar.
    echo       Membuka Dashboard melalui browser default...
    start http://localhost:8765/dashboard.html
)

echo.
echo =======================================================================
echo          [BERHASIL] GC 1 SENTINEL MONITOR AKTIF DI MINI PC!
echo =======================================================================
echo  - Port Server      : http://localhost:8765
echo  - Layar Monitor    : http://localhost:8765/dashboard.html
echo  - Target Rekap WA  : Kontak mimi Sandora di WhatsApp Web
echo  - Lingkup Tiket    : HANYA Government Cloud 1 (Status: Assigned)
echo  - Unit Telkom      : 100%% Diabaikan / Dikecualikan
echo =======================================================================
echo  Catatan:
echo  1. Pastikan Anda telah Login ke WhatsApp Web pada tab Chrome.
echo  2. Buka tab Helpdesk ITSM (misal: pdn.layanan.go.id) di Chrome.
echo  3. Ekstensi Sentinel akan pasif membaca tiket dan membunyikan alarm.
echo =======================================================================
echo.
echo Tekan tombol apa saja untuk meminimalkan jendela ini...
pause >nul