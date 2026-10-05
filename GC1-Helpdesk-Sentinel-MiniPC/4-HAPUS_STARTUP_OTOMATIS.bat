@echo off
chcp 65001 >nul
title GC 1 Sentinel - Hapus Auto-Start Windows 11
color 0C

echo =======================================================================
echo          🗑️ MENGHAPUS AUTO-STARTUP DARI WINDOWS 11
echo =======================================================================
echo.

powershell -NoProfile -Command "$startup = [System.Environment]::GetFolderPath('Startup'); $path = Join-Path $startup 'GC1_Sentinel_Monitor.lnk'; if (Test-Path $path) { Remove-Item $path -Force; Write-Host '  -> Shortcut di folder Startup berhasil dihapus.' } else { Write-Host '  -> Shortcut tidak ditemukan di folder Startup.' }"

echo.
echo =======================================================================
echo  GC 1 Sentinel tidak akan lagi berjalan otomatis saat Mini PC menyala.
echo =======================================================================
echo.
pause
