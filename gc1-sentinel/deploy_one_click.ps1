# GC 1 Sentinel - 1-Click Automated Mini PC Deployer
# Dapat dijalankan langsung di PowerShell untuk memasang dan menjalankan sistem secara instan.

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "   [GC 1 SENTINEL - ONE-CLICK DEPLOYER FOR MINI PC]" -ForegroundColor Cyan
Write-Host "        Pusat Monitoring Government Cloud 1 (PDN)" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

$CurrentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $CurrentDir) { $CurrentDir = Get-Location }

# 1. Verifikasi Python
Write-Host "`n[*] Memeriksa lingkungan Python..." -ForegroundColor Yellow
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command py -ErrorAction SilentlyContinue }
if (-not $py) {
    Write-Host "[ERROR] Python belum terpasang di Mini PC ini!" -ForegroundColor Red
    Write-Host "Silakan pasang Python 3.12 dari Microsoft Store terlebih dahulu." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Python terdeteksi: $($py.Source)" -ForegroundColor Green

# 2. Inisialisasi Database SQLite
Write-Host "`n[*] Menyiapkan database SQLite permanen..." -ForegroundColor Yellow
Set-Location $CurrentDir
python -B -c "import sentinel_db; sentinel_db.init_db(); print('    -> Database SQLite siap & audit trail aktif.')"

# 3. Buat Desktop Shortcut & Windows Startup
Write-Host "`n[*] Memasang Desktop Shortcut & Windows Startup (Auto-Boot)..." -ForegroundColor Yellow
$ws = New-Object -ComObject WScript.Shell
$desktopPath = [Environment]::GetFolderPath('Desktop')
$startupPath = [Environment]::GetFolderPath('Startup')
$launcherBat = Join-Path $CurrentDir "1-JALANKAN_SEMUA.bat"

$scDesktop = $ws.CreateShortcut("$desktopPath\GC 1 Sentinel Monitor.lnk")
$scDesktop.TargetPath = $launcherBat
$scDesktop.WorkingDirectory = $CurrentDir
$scDesktop.Description = "Pusat Monitoring Government Cloud 1"
$iconPath = Join-Path $CurrentDir "icons\icon128.png"
if (Test-Path $iconPath) { $scDesktop.IconLocation = $iconPath }
$scDesktop.Save()
Write-Host "    -> Shortcut Desktop berhasil dibuat: 'GC 1 Sentinel Monitor'" -ForegroundColor Green

$scStartup = $ws.CreateShortcut("$startupPath\GC 1 Sentinel AutoStart.lnk")
$scStartup.TargetPath = $launcherBat
$scStartup.WorkingDirectory = $CurrentDir
$scStartup.Description = "Auto-start GC 1 Sentinel saat Mini PC booting"
$scStartup.Save()
Write-Host "    -> Windows Startup berhasil dipasang: Auto-Boot saat Mini PC menyala" -ForegroundColor Green

# 4. Meluncurkan Aplikasi
Write-Host "`n==================================================================" -ForegroundColor Cyan
Write-Host "    SELESAI! Meluncurkan GC 1 Sentinel di Mini PC..." -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Start-Process $launcherBat
