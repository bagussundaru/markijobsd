@echo off
chcp 65001 >nul
title GC 1 Sentinel - Reset Data Testing
color 0D

echo =======================================================================
echo          🔄 RESET DATA TIKET & CACHE PENGUJIAN GC 1 SENTINEL
echo =======================================================================
echo.
echo Apakah Anda yakin ingin mereset cache tiket dan riwayat deduplikasi?
echo (Tekan Ctrl+C untuk membatalkan, atau tekan sembarang tombol untuk lanjut)
pause >nul

set "CURRENT_DIR=%~dp0"

echo Menghapus cache markijo_reported.json...
if exist "%CURRENT_DIR%markijo_reported.json" del /f /q "%CURRENT_DIR%markijo_reported.json"
echo [] > "%CURRENT_DIR%markijo_reported.json"

echo Mengosongkan data melalui Sentinel Server...
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://localhost:8765/api/clear_data' -Method Post -TimeoutSec 3 | Out-Null; Write-Host '  -> Server berhasil di-reset.' } catch { Write-Host '  -> Server tidak merespon (kemungkinan belum menyala).' }"

echo.
echo =======================================================================
echo  ✅ Data pengujian dan riwayat deduplikasi berhasil dibersihkan!
echo =======================================================================
echo.
pause
