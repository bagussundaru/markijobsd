@echo off
chcp 65001 >nul
title GC 1 Sentinel - Pasang Auto-Start Windows 11
color 0A

echo =======================================================================
echo          ⚙️ KONFIGURASI AUTO-STARTUP MINI PC (WINDOWS 11)
echo =======================================================================
echo.
echo Skrip ini akan mendaftarkan GC 1 Sentinel ke folder Startup Windows.
echo Setiap kali Mini PC dinyalakan atau reboot, monitor akan langsung aktif!
echo.

set "TARGET_BAT=%~dp01-JALANKAN_SEMUA.bat"

powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $startup = [System.Environment]::GetFolderPath('Startup'); $s = $ws.CreateShortcut((Join-Path $startup 'GC1_Sentinel_Monitor.lnk')); $s.TargetPath = '%TARGET_BAT%'; $s.WorkingDirectory = '%~dp0'; $s.Description = 'GC 1 Sentinel Helpdesk Monitor Launcher'; $s.Save(); Write-Host '  -> Shortcut berhasil dipasang di:' $startup"

echo.
echo =======================================================================
echo  ✅ Sukses! GC 1 Sentinel kini otomatis berjalan saat Mini PC menyala.
echo  Jika ingin membatalkan, jalankan "4-HAPUS_STARTUP_OTOMATIS.bat".
echo =======================================================================
echo.
pause
