REM Nama file: 3-PASANG_STARTUP_OTOMATIS.bat

@echo off
setlocal enabledelayedexpansion

set PYTHONDONTWRITEBYTECODE=1
set PATH=%PATH%;C:\Program Files\Python311\Scripts

title GC 1 Sentinel - Mini PC

echo.
echo ======================================================================
echo  GC 1 SENTINEL STARTUP OTOMATIS
echo ======================================================================

cd /d "%~dp0"

REM Cek Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python tidak ditemukan
    pause
    exit /b 1
)

REM Cek port 8765
netstat -ano | find ":8765" >nul
if not errorlevel 1 (
    echo [WARN] Port 8765 sudah dipakai, skip sentinel
) else (
    echo [INFO] Starting Sentinel Server...
    start "Sentinel Server" python -B sentinel_server.py
    timeout /t 3
)

REM Cek Ollama (optional)
tasklist | find "ollama" >nul
if errorlevel 1 (
    echo [INFO] Ollama tidak berjalan (optional)
) else (
    echo [INFO] Ollama already running
)

echo [OK] Startup complete. Buka browser: http://localhost:8765/dashboard.html

pause
