@echo off
chcp 65001 >nul
title GC 1 Sentinel - Hentikan Layanan
color 0E

echo =======================================================================
echo          🛑 MENGHENTIKAN LAYANAN GC 1 SENTINEL DI MINI PC
echo =======================================================================
echo.

echo Menghentikan Sentinel Server dan Markijo Agent...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'python.exe' -and ($_.CommandLine -like '*sentinel_server.py*' -or $_.CommandLine -like '*markijo_agent.py*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('  -> Menghentikan PID ' + $_.ProcessId + ': ' + $_.CommandLine) }"

echo.
echo =======================================================================
echo  Semua layanan latar belakang GC 1 Sentinel telah dihentikan.
echo =======================================================================
timeout /t 3 >nul
