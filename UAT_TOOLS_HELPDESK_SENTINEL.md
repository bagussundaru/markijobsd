# DOKUMEN SPESIFIKASI SISTEM & PANDUAN PENGUJIAN UAT: GC 1 HELPDESK SENTINEL

**Dokumen Versi**: 3.2.0  
**Target Sistem**: GC 1 Helpdesk Sentinel Cockpit & Chrome Telemetry Extension  
**Tujuan Dokumen**: Panduan teknis komprehensif untuk pengujian penerimaan pengguna (*User Acceptance Testing* / UAT) dan validasi otomatis oleh Agen AI Penguji.  
**Lingkungan Operasional**:  
- **Dashboard Cockpit**: `http://localhost:8765/dashboard.html` (Local Mini PC / Server)  
- **Sentinel Backend API**: `http://127.0.0.1:8765/`  
- **Database Engine**: SQLite 3 (`sentinel.db`) + Flat JSON Cache (`sentinel_data.json`)  
- **Ekstensi Browser**: Google Chrome Unpacked Extension (Manifest V3, `content_helpdesk.js`)  
- **Portal Sumber Data**: `https://pdn.layanan.go.id/` (ESTIM ITSM Komdigi)  
- **Paket Distribusi Produksi**: `https://markijo.my.id/download` (`gc1-sentinel-minipc.zip`)  

---

## 1. IKHTISAR & ARSITEKTUR SISTEM

### 1.1. Latar Belakang & Tujuan
GC 1 Helpdesk Sentinel dirancang khusus untuk tim operasional **Government Cloud 1 (GC 1) Pusat Data Nasional (PDN) Kementerian Komunikasi dan Digital**. Sistem ini memantau tiket insiden dan permohonan layanan (*service request*) secara *real-time*, mengukur kepatuhan batas baku resmi **KAK Pasal 18.c**, menghitung siklus waktu tindak lanjut (*cadence follow-up*), mendeteksi aduan di grup WhatsApp teknis, dan mengisolasi tiket pihak lain (*Telkom / GC 2*) agar tidak mencemari beban kerja tim GC 1.

### 1.2. Arsitektur 3-Tier Hybrid
```
┌─────────────────────────────────────────────────────────────┐
│ 1. TELEMETRY SCRAPER LAYER (Passive Chrome Extension MV3)   │
│ - URL Match: https://pdn.layanan.go.id/*                    │
│ - Membaca tabel DOM secara pasif (All Request, Incident)    │
│ - AUTO-SKIP: Menu 'My Approval History' & status 'Approval' │
│ - POST JSON dump -> http://127.0.0.1:8765/api/sync_helpdesk │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP Push (Dedupe Signature / Heartbeat 60s)
┌──────────────────────────────▼──────────────────────────────┐
│ 2. SENTINEL INTELLIGENCE & PERSISTENCE LAYER (Python 3)     │
│ - sentinel_server.py (Daemon HTTP Server Port 8765)         │
│ - SQLite engine: sentinel.db (Tabel: itsm_tickets,          │
│   itsm_history, sync_logs) + Cache sentinel_data.json       │
│ - Enrichment Engine: Klasifikasi SOP, Resolver L0-L3, SLA   │
│ - SLA Jeda: Tiket On-Hold dijeda (slaPaused, keluar penyebut)│
│ - Cadence Tracker: Hitung mundur follow-up (60m / 240m)     │
│ - Follow-up Logger: POST /api/log_followup & tombol di UI   │
│ - Telkom Isolator: Blacklist keyword 'Telkom' (grup/DB)     │
│ - Alarm Controller: Bunyi HANYA saat tiket 'Assigned' > 0   │
└──────────────────────────────┬──────────────────────────────┘
                               │ WebSocket / Polling Snapshot
┌──────────────────────────────▼──────────────────────────────┐
│ 3. ENTERPRISE COCKPIT UI LAYER (Aivora Glassmorphism UI)    │
│ - dashboard.html + dashboard-v3.js + dashboard-v3.css       │
│ - Model Operasional: OPSI A (Fokus Beban Kerja Aktif)       │
│ - 6 Symmetrical KPI Cards + 2 Actionable Follow-Up Panes    │
│ - Realtime audio alert, interactive filters, export CSV/JSON │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. ATURAN BISNIS UTAMA (*CORE BUSINESS RULES*)

Agen penguji wajib memvalidasi setiap aturan berikut:

1. **Model Operasional "Opsi A" (Fokus Tiket Aktif Berjalan)**:
   - Kartu 1 di seluruh menu menampilkan **Tiket Aktif Berjalan** (`In Progress` + `On-Hold` + `Assigned`).
   - Tiket yang telah selesai (`Closed`, `Resolved`) dipisahkan ke tab tersendiri (**Riwayat Selesai**) dan dicatat dalam footer informasi.
   - Sidebar pill menampilkan jumlah tiket **aktif** (bukan total riwayat ratusan tiket) agar operator langsung mengetahui beban kerja saat ini.

2. **Isolasi Total Tiket Telkom (GC 2)**:
   - Setiap tiket yang *assignment group*-nya mengandung kata `Telkom` (misal: *Telkom L1, Telkom L2, Cloud Telkom*) **wajib diabaikan 100%** dari seluruh metrik internal tim GC 1.

3. **Pengecualian Halaman Approval (*My Approval History*)**:
   - Menu *My Approval History* di portal ITSM dikelola oleh aplikasi persetujuan tenan eksternal.
   - Ekstensi Chrome langsung melakukan *early return* (skip) jika URL/judul halaman memuat `approval`.
   - Tiket dengan status `Pending Approval` / `Menunggu Persetujuan` otomatis disaring keluar dari kolam kerja teknis helpdesk GC 1.

4. **Pemisahan Status On-Hold vs Pending Approval**:
   - Tiket `On-Hold` murni merupakan tiket tertunda karena faktor eksternal (menunggu konfirmasi tenan, nota dinas, atau dependensi vendor).
   - Tiket On-Hold diklasifikasikan sebagai `team_on_hold` (berdiri mandiri pada Kartu 4 dan Tab `⏸️ On-Hold`).

5. **Batasan Periode Operasional (Agustus 2026+)**:
   - Hanya tiket yang dibuat mulai tanggal **1 Agustus 2026 ke atas** (Agustus, September, Oktober 2026) yang diakui dalam data operasional GC 1 aktif.

6. **Logika Hening Alarm Audio (*Strict Zero False Alarm*)**:
   - Alarm suara (`tiketmasuk.mp3` / `alert.wav`) **HANYA BOLEH BERBUNYI** jika terdapat tiket berstatus `Assigned` murni (`team_assigned_count > 0`).
   - Tiket berstatus `In Progress`, `On-Hold`, atau `Closed` **TIDAK BOLEH** memicu bunyi alarm.
   - Jika `Assigned == 0`, sistem audio wajib berada dalam kondisi **hening total** (*silent*).

7. **Kadensi Tindak Lanjut (*Follow-up Cadence KAK 18.c*)**:
   - Tiket `Critical` & `Major`: Wajib di-update/follow-up setiap **60 menit**.
   - Tiket `Minor` & `Service Request`: Wajib di-update/follow-up setiap **240 menit**.
   - Kartu 5 (**Tiket Perlu di-Follow Up**) mendeteksi tiket In Progress yang waktu kadensinya telah jatuh tempo atau terlewati (*overdue*).

---

## 3. SPESIFIKASI 6 KARTU KPI UTAMA

Pada seluruh tampilan (`Ringkasan`, `ITSM • Semua`, `Tiket Request`, `Tiket Insiden`), jajaran kartu KPI memiliki struktur seragam:

| Posisi | Label Kartu | Kategori | Kode Warna / Kelas | Deskripsi Logika |
| :---: | :--- | :--- | :--- | :--- |
| **Card 1** | **Tiket Aktif Berjalan** | `OPERASIONAL GC 1` | `val-total` | Total tiket aktif tim (`In Progress` + `On-Hold`). Footer memuat jumlah tuntas. |
| **Card 2** | **Assigned (Siap Ditangani)** | `TIM GC 1` | `val-assigned` (Hijau/Tenang) atau `val-assigned-active` (Merah Berkedip) | Antrean tiket baru yang siap diambil alih teknisi GC 1. Memicu alarm audio jika `> 0`. |
| **Card 3** | **Sedang Dikerjakan** | `PENGERJAAN TEKNIS` | `val-progress` (Ungu) | Tiket yang sedang dalam penanganan teknis aktif resolver L1/L2/L3. |
| **Card 4** | **On Hold (Tertunda)** | `DEPENDENSI` | `val-onhold` (Kuning / Oranye) | Tiket yang tertunda karena menunggu tenan, vendor, atau pihak eksternal. |
| **Card 5** | **Tiket Perlu di-Follow Up** | `KADENSI KAK 18.c` | `val-danger` (Merah/Waspada) | Tiket In Progress yang melewati jadwal update berkala sesuai KAK (60m/240m). |
| **Card 6** | **Kepatuhan SLA (KAK 18.c)** | `STANDAR KAK 18.c` | `val-ok` (Hijau ≥95%) / `val-danger` (<95%) | Persentase kepatuhan resolusi terhadap batas baku resmi KAK Pasal 18.c. |

---

## 4. DAFTAR ENDPOINT API SENTINEL

### 4.1. `GET /api/helpdesk_snapshot`
- **Kegunaan**: Mengambil data snapshot operasional lengkap hasil parsing & pengayaan database SQLite.
- **Contoh Request**:
  ```bash
  curl -s http://127.0.0.1:8765/api/helpdesk_snapshot
  ```
- **Struktur Kunci JSON Response**:
  ```json
  {
    "total_helpdesk": 499,
    "team_assigned_count": 0,
    "team_progress_count": 9,
    "team_on_hold_count": 61,
    "team_pending_count": 0,
    "team_closed_count": 429,
    "sla_health_percent": 18,
    "team_assigned": [],
    "team_progress": [ ... ],
    "team_on_hold": [ ... ],
    "team_closed": [ ... ],
    "all_tickets": [ ... ]
  }
  ```

### 4.2. `GET /api/stats?range={day|week|month}&list={request|incident}`
- **Kegunaan**: Menyediakan data metrik analitik, tren volume, distribusi prioritas, dan kepatuhan SLA.
- **Contoh Request**:
  ```bash
  curl -s "http://127.0.0.1:8765/api/stats?range=month"
  ```
- **Kunci Output `kpi`**:
  ```json
  {
    "kpi": {
      "itsm_total": 499,
      "itsm_open": 70,
      "itsm_assigned": 0,
      "itsm_progress": 9,
      "itsm_on_hold": 61,
      "itsm_pending": 0
    }
  }
  ```

### 4.3. `GET /api/status`
- **Kegunaan**: Health check koneksi server dan metadata sinkronisasi ekstensi.

### 4.4. `POST /api/sync_helpdesk`
- **Kegunaan**: Endpoint penerima data dump dari ekstensi Chrome `background.js` / `content_helpdesk.js`.
- **Payload**: `{ "tickets": [ ... ], "menu": "request|incident", "scanned_at": 1728740000 }`.

### 4.5. `POST /api/log_followup`
- **Kegunaan**: Endpoint pencatatan tindakan tindak lanjut (*follow-up*) tiket aktif oleh operator.
- **Payload**: `{ "ticketId": "REQ-KMF-...", "by": "Nama Petugas", "note": "Catatan opsional" }`.
- **Efek**: Menambahkan riwayat "Follow-up dicatat", memajukan batas kadensi KAK berikutnya, dan menyimpan data secara permanen.

---

## 5. SKENARIO UAT & VALIDASI OTOMATIS (AGENT TEST RUNBOOK)

Agen penguji dapat menjalankan skenario di bawah ini menggunakan perintah shell, script Python, atau Playwright:

### Skenario UAT-HD-01: Verifikasi Nilai Metrik Opsi A
- **Langkah**: Lakukan HTTP GET ke `/api/helpdesk_snapshot`.
- **Kriteria Lulus**:
  1. `team_assigned_count == 0` (Wajib nol, alarm hening).
  2. `team_pending_count == 0` (Wajib nol, disaring di server & ekstensi).
  3. `team_progress_count + team_on_hold_count` merefleksikan seluruh tiket aktif berjalan (sekitar 68–70 tiket).
  4. `team_closed_count` merefleksikan riwayat selesai (sekitar 429–431 tiket).
  5. Konsistensi total: `total_helpdesk == team_closed_count + team_progress_count + team_on_hold_count + team_assigned_count`.

### Skenario UAT-HD-02: Validasi Keheningan Alarm Audio
- **Langkah**: Periksa elemen audio pada DOM dashboard `http://localhost:8765/dashboard.html` saat `team_assigned_count == 0`.
- **Kriteria Lulus**:
  1. Card 2 pada jajaran KPI menampilkan status aman / terkendali.
  2. Indikator beacon animasi berkedip (`.beacon-pulse-indicator`) tidak aktif.
  3. Elemen audio `tiketmasuk.mp3` berstatus *paused* (tidak bersuara palsu).

### Skenario UAT-HD-03: Validasi Isolasi Telkom
- **Langkah**: Query database SQLite `sentinel.db` untuk tiket yang lolos ke `our_team_tickets`:
  ```bash
  python -c "import sqlite3; conn = sqlite3.connect('sentinel.db'); c = conn.cursor(); c.execute('SELECT COUNT(*) FROM itsm_tickets WHERE LOWER(assignment_group) LIKE \"%telkom%\"'); print('Telkom in DB:', c.fetchone()[0])"
  ```
- **Kriteria Lulus**:
  1. Tiket Telkom pada snapshot API disaring keluar (tidak masuk hitungan beban kerja tim internal GC 1).
  2. Tidak ada tiket ber-assignment group Telkom yang membebani antrean teknis GC 1.

### Skenario UAT-HD-04: Validasi Pengecualian Approval
- **Langkah**: Verifikasi logika pada `content_helpdesk.js` dan endpoint `/api/sync_helpdesk`.
- **Kriteria Lulus**:
  1. `content_helpdesk.js` memuat deteksi `if (window.location.href.toLowerCase().includes("approval")) return;`.
  2. Handler `/api/sync_helpdesk` membuang tiket berstatus `Pending Approval` / `Menunggu Persetujuan` sebelum normalisasi status.
  3. Status `team_pending_count` pada API bernilai 0.

### Skenario UAT-HD-05: Validasi Kartu "Tiket Perlu di-Follow Up"
- **Langkah**: Buka dashboard dan periksa Card 5 (`.v3-kpi` urutan ke-5).
- **Kriteria Lulus**:
  1. Label kartu bertuliskan **Tiket Perlu di-Follow Up**.
  2. Nilai kartu menghitung secara dinamis tiket In Progress yang waktu kadensinya jatuh tempo (berkisar antara 5–8 tiket seiring waktu berjalan).
  3. Mengklik kartu mengarahkan pengguna ke tab *In Progress* dan menggulir ke tabel penghitung waktu mundur.

### Skenario UAT-HD-06: Validasi Sidebar Pill
- **Langkah**: Buka `http://localhost:8765/dashboard.html` dan periksa elemen pill sidebar:
  - `[data-pill-list='']` (Semua ITSM, sekitar 68–70)
  - `[data-pill-list='request']` (Tiket Request, sekitar 54–55)
  - `[data-pill-list='incident']` (Tiket Insiden, sekitar 14–15)
- **Kriteria Lulus**:
  1. Angka pill merefleksikan tiket **aktif berjalan**, bukan angka ratusan tiket historis yang telah tuntas.

### Skenario UAT-HD-07: Validasi Jeda SLA Tiket On-Hold
- **Langkah**: Lakukan HTTP GET ke `/api/helpdesk_snapshot` dan periksa tiket On-Hold.
- **Kriteria Lulus**:
  1. Tiket On-Hold memiliki atribut `slaPaused: true` dan badge `SLA dijeda (On-Hold)`.
  2. Tiket On-Hold tidak ditandai sebagai `slaBreached: true` dan dikeluarkan dari penyebut persentase kesehatan SLA aktif.

### Skenario UAT-HD-08: Validasi Pencatatan Tindak Lanjut (Follow-Up)
- **Langkah**: Kirim request ke `POST /api/log_followup` dengan nama petugas valid (minimal 2 karakter):
  ```bash
  curl -s -X POST http://127.0.0.1:8765/api/log_followup -H "Content-Type: application/json" -d "{\"ticketId\": \"REQ-KMF-102026-0094154\", \"by\": \"Operator UAT\", \"note\": \"Verifikasi KAK\"}"
  ```
- **Kriteria Lulus**:
  1. Response mengembalikan status `{ "status": "ok", "message": "Follow-up berhasil dicatat", ... }`.
  2. Riwayat tiket mencatat entri `"Follow-up dicatat"`.
  3. Batas waktu kadensi tiket diperbarui secara otomatis.

---

## 6. CARA REPRODUKSI & VERIFIKASI CEPAT

Script pengujian Playwright terotomatisasi tersedia di berkas:
`d:\markijos-workspace\gc1-sentinel\scratch\verify_option_a_qa.py`

Jalankan perintah berikut:
```powershell
cd d:\markijos-workspace\gc1-sentinel
python scratch\verify_option_a_qa.py
```
Output yang diharapkan adalah kode keluar `0` (*exit code 0*) dengan seluruh 6 kartu terdeteksi valid di 4 menu utama (`Ringkasan`, `ITSM Semua`, `Request`, `Insiden`).
