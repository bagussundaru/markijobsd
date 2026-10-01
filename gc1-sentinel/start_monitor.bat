@echo off
title GC 1 Sentinel Launcher - Mini PC
color 0A

echo ========================================================
echo        GC 1 SENTINEL - HELPDESK ^& WHATSAPP MONITOR
echo                    Deployment Mini PC
echo ========================================================
echo.

set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist %CHROME_PATH% (
    set CHROME_PATH="C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)
if not exist %CHROME_PATH% (
    set CHROME_PATH="C:\Users\%USERNAME%\AppData\Local\Google\Chrome\Application\chrome.exe"
)

echo [1/3] Menyiapkan Chrome Browser...
echo Lokasi Chrome: %CHROME_PATH%
echo.

set CURRENT_DIR=%~dp0
set EXTENSION_PATH=%CURRENT_DIR:~0,-1%

echo [2/3] Memuat ekstensi dari: %EXTENSION_PATH%
echo.

echo [3/3] Membuka Tab Pantauan:
echo   - WhatsApp Web
echo   - Layar Monitor GC 1
echo.

start "" %CHROME_PATH% --load-extension="%EXTENSION_PATH%" "https://web.whatsapp.com" "%EXTENSION_PATH%\dashboard.html"

echo ========================================================
echo GC 1 Sentinel aktif! 
echo Pastikan Anda login WhatsApp Web dan membuka tab Helpdesk.
echo ========================================================
pause
