# markijobsd — GC 1 Sentinel Helpdesk Monitor

Paket resmi tools pendamping Helpdesk Managed Service Government Cloud 1 (GC-1) dengan branding **Markijo AI · Modern Neural Solutions**.
Sistem ini bersifat **read-only pasif** terhadap ITSM dan WhatsApp, menyajikan dashboard pemantau lokal, alarm suara, dan rekap aduan.

## Struktur Repositori & Pilihan Paket

1. **`GC1-Helpdesk-Sentinel-MiniPC/`** — **Paket Rekomendasi untuk Mini PC Kantor (Kiosk 24/7)**
   - Zero-dependency (hanya butuh Python bawaan + Google Chrome).
   - Dilengkapi peluncur otomatis: `1-JALANKAN_SEMUA.bat`, `2-HENTIKAN_SEMUA.bat`, dan `3-PASANG_STARTUP_OTOMATIS.bat`.
   - Panduan lengkap Word: `TUTORIAL_SETUP_MINIPC_WINDOWS11.docx` & `BACA_SAYA_PANDUAN_MINIPC.txt`.

2. **`gc1-sentinel/`** — **Paket Lanjutan (Sentinel v2/v3 & SQLite Database)**
   - Backend Python dengan SQLite (`sentinel.db`) dan dukungan liaison agent.
   - Ekstensi Chrome + Dashboard Monitor (`http://localhost:8765/dashboard.html`).
   - Panduan Antigravity & automated tests: `DEPLOY_ANTIGRAVITY.md` & `INSTALL_MINI_PC.bat`.

## Cara Cepat Pasang di Mini PC
1. Buka folder `GC1-Helpdesk-Sentinel-MiniPC` (atau `gc1-sentinel`).
2. Buka Google Chrome: `chrome://extensions` -> Aktifkan Developer mode -> Klik **Load unpacked** -> Pilih folder aplikasi.
3. Klik ganda **`1-JALANKAN_SEMUA.bat`**.
4. Login WhatsApp Web (scan QR) dan buka portal ITSM (`https://pdn.layanan.go.id`) di Chrome.
5. Untuk auto-boot 24/7 saat Mini PC menyala/restart, klik ganda **`3-PASANG_STARTUP_OTOMATIS.bat`**.

