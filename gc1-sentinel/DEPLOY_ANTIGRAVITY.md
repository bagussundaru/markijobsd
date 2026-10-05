# Panduan Deploy GC 1 Sentinel di Mini PC Menggunakan Antigravity

Jika Anda membuka folder ini di aplikasi **Antigravity** pada Mini PC kantor, cukup salin prompt di bawah ini ke dalam chat Antigravity.
Antigravity akan secara otomatis memeriksa dependensi, menyiapkan server lokal, membuat shortcut Desktop, menyetel auto-boot Windows 11, dan mematikan sleep monitor.

---

## 📋 PROMPT UNTUK AGENT ANTIGRAVITY DI MINI PC

```markdown
Tolong deploy dan siapkan aplikasi Tools Helpdesk GC 1 Sentinel (Markijo AI) di Mini PC Windows ini secara otomatis. Kerjakan seluruh langkah berikut secara berurutan dan laporkan hasil verifikasinya:

ATURAN KEAMANAN & INTEGRITAS KAK:
- Sentinel hanya bersifat READ-ONLY pasif terhadap portal ITSM dan WhatsApp. Jangan menambahkan kode untuk mengirim pesan keluar, mengklik tombol submit tiket, atau mengubah data ITSM.
- Jangan mengaktifkan AI cloud eksternal; biarkan ai_provider="off" dan bind_host="127.0.0.1".
- Jangan menuliskan password, API key, atau token ke file mana pun.

LANGKAH KERJA OTOMATIS:
1. PERIKSA LINGKUNGAN SISTEM:
   - Periksa ketersediaan Python (minimal Python 3.9+, rekomendasi 3.10-3.12). Jika belum ada, beritahu pengguna atau pasang via winget install Python.Python.3.12.
   - Periksa lokasi Google Chrome (C:\Program Files\Google\Chrome\Application\chrome.exe atau AppData).
   - Pastikan folder bersih dari folder __pycache__ atau file berawalan "_" agar ekstensi Chrome dapat dimuat tanpa error.

2. UJI COBA SERVER LOKAL PORT 8765:
   - Jalankan sentinel_server.py di port 8765 secara background/daemon.
   - Uji respon HTTP GET http://127.0.0.1:8765/api/status (pastikan wa_outbound_enabled bernilai false).
   - Uji akses dashboard http://127.0.0.1:8765/dashboard.html (pastikan HTTP 200 dan aset logo Markijo AI dapat diakses).

3. PASANG AUTO-STARTUP 24/7 & SHORTCUT DESKTOP:
   - Jalankan skrip 3-PASANG_STARTUP_OTOMATIS.bat atau buat shortcut Windows untuk 1-JALANKAN_SEMUA.bat di folder Startup Windows ($env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\GC 1 Sentinel AutoStart.lnk).
   - Buat shortcut resmi di Desktop pengguna ($env:USERPROFILE\Desktop\GC 1 Sentinel Monitor.lnk) dengan ikon icons/icon128.png atau icons/logo.png.

4. OPTIMASI DAYA KIOSK WINDOWS (ANTI-SLEEP):
   - Jalankan perintah powercfg untuk memastikan monitor TV Helpdesk tidak mati otomatis:
     powercfg /change monitor-timeout-ac 0
     powercfg /change standby-timeout-ac 0

5. LUNCURKAN APLIKASI:
   - Jalankan 1-JALANKAN_SEMUA.bat untuk meluncurkan server lokal, agen Markijo, dan membuka Google Chrome.

6. LAPORAN & PANDUAN LANGKAH MANUSIA:
   - Tampilkan ringkasan status instalasi (Python, Chrome, Server Port 8765, Shortcut, Auto-Startup).
   - Berikan panduan 2 langkah manual yang perlu dilakukan oleh petugas:
     a. [MANUSIA] Buka tab chrome://extensions di Chrome -> Aktifkan Developer mode -> Klik 'Load unpacked' -> Pilih folder workspace ini.
     b. [MANUSIA] Buka tab WhatsApp Web (scan QR) dan tab Portal Helpdesk ITSM (login petugas); biarkan tab tetap terbuka.
```

---

## 👤 2 LANGKAH MANUAL PETUGAS (SETELAH PROMPT SELESAI)

Setelah Antigravity selesai menjalankan semua langkah di atas:
1. **Pasang Ekstensi Chrome**:
   - Di Google Chrome, buka: `chrome://extensions`
   - Aktifkan toggle **Developer mode** di kanan atas.
   - Klik **Load unpacked** di kiri atas, lalu arahkan ke folder ini.
2. **Login Tab Kerja**:
   - Tab WhatsApp Web: Scan QR code satu kali (pastikan kontak penerima rekap bernama `mimi Sandora`).
   - Tab Helpdesk ITSM: Login dengan akun helpdesk resmi (`https://pdn.layanan.go.id`).
