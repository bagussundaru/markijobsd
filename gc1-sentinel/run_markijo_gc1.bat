@echo off
chcp 65001 >nul
title Markijo GC 1 Sentinel - Autonomous Helpdesk & WA Monitor
color 0B

echo =======================================================================
echo          🤖 MARKIJO AUTONOMOUS AGENT - GC 1 SENTINEL MONITOR
echo                   Kemasan Proyek Mandiri GC 1
echo =======================================================================
echo  Target Instansi  : Government Cloud 1 (GC 1)
echo  Target Status    : HANYA Status "Assigned"
echo  Prinsip Helpdesk : 100%% Read-Only (Tindakan Fisik oleh Operator)
echo  WhatsApp          : hanya membaca grup (tanpa kirim)
echo =======================================================================
echo.

set CURRENT_DIR=%~dp0
set EXTENSION_PATH=%CURRENT_DIR:~0,-1%
cd /d "%CURRENT_DIR%"

:: 1. Cek port 8765 dan jalankan Sentinel Server jika belum aktif
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if %errorlevel% neq 0 (
    echo [1/3] Memulai Sentinel Server di port 8765...
    start "GC 1 Sentinel Server" /min python "%CURRENT_DIR%sentinel_server.py"
    timeout /t 2 /nobreak >nul
) else (
    echo [1/3] Sentinel Server sudah aktif di port 8765.
)

:: 2. Cari executable Google Chrome
set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME_EXE%" set "CHROME_EXE=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

echo [2/3] Membuka Chrome Browser dengan Ekstensi Sentinel GC 1...
if exist "%CHROME_EXE%" (
    start "" "%CHROME_EXE%" --load-extension="%EXTENSION_PATH%" "https://web.whatsapp.com" "http://localhost:8765/dashboard.html" "http://localhost:8765/dummy_helpdesk.html"
) else (
    start http://localhost:8765/dashboard.html
)

echo [3/3] Menjalankan Markijo Autonomous Loop...
echo.
echo =======================================================================
echo  Markijo Agent sedang aktif memantau...
echo  - Setiap tiket GC 1 Assigned baru akan otomatis direkap.
echo  - Tidak ada pesan yang dikirim ke WhatsApp (hanya membaca).
echo  - Tekan Ctrl+C untuk menghentikan agent.
echo =======================================================================
echo.

python "%CURRENT_DIR%markijo_agent.py"

pause
