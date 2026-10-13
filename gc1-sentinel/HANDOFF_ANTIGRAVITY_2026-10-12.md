# HANDOFF: Validasi & Perbaikan GC 1 Helpdesk Sentinel (12 Okt 2026)

**Untuk**: Agen/engineer yang melanjutkan di Antigravity
**Sistem**: GC 1 Helpdesk Sentinel (`D:\markijos-workspace\gc1-sentinel`), server Python port 8765, SQLite, ekstensi Chrome MV3, dashboard v3
**Acuan spesifikasi**: `D:\markijos-workspace\UAT_TOOLS_HELPDESK_SENTINEL.md` (v3.2.0)
**Status akhir sesi**: suite tes **162 lulus, 0 gagal**. Server lokal sudah di-restart dengan kode final. Zip lokal sudah dibangun ulang. **Zip di web belum diganti** (lihat bagian 7).

---

## 1. Ringkasan satu paragraf

Fokus sesi: memvalidasi alur data tool (ekstensi scrape → `/api/sync_helpdesk` → SQLite → pengolahan → dashboard) terhadap dokumen UAT. Ditemukan beberapa penyimpangan logika (SLA, follow-up, registry, grup tiket berkedip, kesegaran data) dan semuanya diperbaiki dengan tes otomatis. Cakupan data operasional hanya tiket **mulai 1 Agustus 2026** (kontrak pengguna mulai Agustus; sesuai aturan bisnis #5).

---

## 2. Cara kerja alur data (hasil pembacaan kode)

| Tahap | Lokasi | Catatan |
|---|---|---|
| Scrape | `content_helpdesk.js` `runPassiveScan()` | Membaca tabel DOM portal; skip halaman/judul berisi `approval` (baris ~571) dan status Pending Approval (~683). Portal punya **19.274 Request + 4.769 Insiden**, 20 baris/halaman |
| Kirim | `background.js` `forwardTicketsToServer` | POST ke `/api/sync_helpdesk` |
| Terima | `sentinel_server.py` `handle_api_post` → `/api/sync_helpdesk` | Normalisasi status, filter Agustus+, hitung `isGc1` (pencocokan kata kunci `config.json`), `isTelkom` (dari nama grup) |
| Simpan | `sentinel_db.py` `save_tickets_to_db` | Tabel **`itsm_tickets`** (upsert), `itsm_history`, `sync_logs`. Juga `sentinel_data.json` (registry, arsip, daftar) |
| Olah | `build_team_tickets()`, `enrich_ticket_with_sop()`, `apply_sla()` | Gabung DB + memori, buang Telkom/Pending Approval/pra-Agustus, hitung SLA & follow-up |
| Sajikan | `GET /api/helpdesk_snapshot`, `GET /api/stats` | Dashboard (`dashboard.js`, `dashboard-v3.js`) polling tiap ~15 dtk |

**Koreksi terhadap dokumen UAT**: endpoint push sebenarnya `/api/sync_helpdesk` (bukan `/api/helpdesk_push`); tabel DB sebenarnya `itsm_tickets` (bukan `tickets`).

---

## 3. Perubahan kode (semua sudah dites)

### 3.1 SLA On-Hold dijeda (keputusan pengguna)
- `sentinel_server.py` `apply_sla()`: tiket On-Hold tidak ditandai lewat SLA; badge "SLA dijeda (On-Hold)"; tidak memicu flag eskalasi; field baru `slaPaused`.
- Snapshot: `sla_pool` dan penyebut `sla_health_percent` mengecualikan tiket `slaPaused`; field baru `sla_paused_count`; `sla_safe_count` dihitung dari pool.
- `compute_stats()`: `sla_pool` juga mengecualikan `slaPaused`.
- **Dampak**: Kartu 6 turun dari 21% menjadi 37% (3 dari 8 tiket In Progress dalam SLA).
- **Keterbatasan**: hanya tiket yang *sedang* On-Hold dijeda. Lama hold di masa lalu belum dikurangkan karena Sentinel tidak mencatat kapan hold dimulai.

### 3.2 Jam follow-up memakai aktivitas nyata + pencatatan follow-up
- `FOLLOWUP_EVENTS = ("Follow-up dicatat", "Status berubah", "Assignment group berubah")`. Hanya ini yang menggeser jam; "Terdeteksi Sentinel" tidak lagi me-reset (sebelumnya membuat tiket tampak aman).
- `_is_noise_change()`: riwayat lama `"- -> X"` dan `"On Hold -> On-Hold"` diabaikan.
- `track_ticket()`: status awal kosong tidak dicatat sebagai perubahan; perbandingan status mengabaikan huruf besar/kecil, tanda hubung, spasi.
- **Endpoint baru** `POST /api/log_followup` `{ticketId, by, note?}`: hanya dari lokal (`_is_local`), nama petugas ≥2 karakter, 404 jika tiket tak dikenal. Menulis riwayat "Follow-up dicatat" dan memanggil `save_persisted_data()`.
- **UI**: tombol **"✓ Sudah Di-follow Up"** di kartu In Progress (`dashboard-v3.js` `renderInProgressFollowupCard`, handler global `window.logFollowup`) dan di tabel tiket utama (`dashboard.js`, di bawah timer). Nama petugas ditanya sekali lalu disimpan di `localStorage` (`sentinel_operator_name`); Batal pada catatan = tidak dicatat. Kartu menampilkan "✓ Follow-up terakhir: HH:MM oleh <nama>".

### 3.3 Sinkron registry dengan DB
- `build_team_tickets()`: tiket di DB yang belum ada di `TICKET_REGISTRY` dibuatkan entri (`track_ticket`), `first_seen` diambil dari `firstSeenTs` DB. `sentinel_db.get_all_tickets_from_db()` kini menambahkan `firstSeenTs` dan `lastSeenTs`.
- Keanggotaan multi-daftar (`itsmLists`): tiket dari DB digabung dengan keanggotaan di `HELPDESK_SNAPSHOT` (sebelumnya hilang karena `raw_json` hanya memuat satu daftar).

### 3.4 Kesegaran data
- Snapshot menambah `last_scan_age_sec` dan `data_stale` (`STALE_SCAN_SEC = 900`, true jika >15 menit atau belum pernah ada pembacaan).
- Bug diperbaiki: `last_sync` tidak lagi jatuh ke jam server saat belum ada sinkron (sebelumnya menyesatkan setelah restart).
- `dashboard.js`: header "Sinkron" menampilkan jam + umur ("baru saja" / "N mnt lalu"), merah + tooltip jika basi.
- **Tiket aktif tidak terpantau**: `stale_ticket_hours` (default 24, ada di `DEFAULT_CONFIG`). Tiket aktif yang `lastSeenTs`-nya lebih tua ditandai `statusStale` + flag "verifikasi di ITSM apakah masih aktif"; field `stale_ticket_count`. **Status TIDAK diubah/ditutup otomatis** (disengaja, lihat 6.3).

### 3.5 Penyaringan Pending Approval di server
- Handler `/api/sync_helpdesk` melewati tiket Pending Approval / Menunggu Persetujuan **sebelum** normalisasi (normalisasi memetakan "pending" → On-Hold, jadi harus dicek lebih dulu). Sebelumnya hanya ekstensi yang menyaring.

### 3.6 Grup tiket berkedip & celah Telkom
- Bukti: pantauan langsung menunjukkan `assignmentGroup` tiket insiden berganti antara kosong dan "Helpdesk"/"EOS L1" tiap beberapa detik (dua sumber halaman portal saling menimpa).
- `sentinel_db.save_tickets_to_db()`: bacaan tanpa grup tidak menimpa grup/lapisan resolver/`is_telkom` yang sudah ada (termasuk di `raw_json`).
- `sentinel_db.get_telkom_ticket_ids()` baru; `build_team_tickets()` tidak memasukkan tiket memori yang ID-nya pernah ditandai Telkom di DB. Celah ini ditemukan oleh tes (tiket Telkom lolos lewat `HELPDESK_SNAPSHOT` saat grup terbaca kosong).

### 3.7 Ekstensi: kurangi banjir kirim
- `content_helpdesk.js`: scan tetap tiap 5 dtk, tapi kirim hanya jika signature (ID|status|grup|tanggal + info paginasi) berubah, atau sebagai detak `SYNC_HEARTBEAT_MS = 60000`. Jalur utama `chrome.runtime.sendMessage`; fetch langsung hanya cadangan; BroadcastChannel hanya saat berubah.
- Sebelum: 3 jalur sekaligus tiap 5 dtk + tiap perubahan DOM (≈948 sinkron/jam; `sync_logs` ≥10.283 baris dalam 5 jam). **Harus reload ekstensi di `chrome://extensions` + refresh tab portal agar berlaku.** Belum diuji di Chrome sungguhan (hanya `node --check`).

---

## 4. Tes

Jalankan: `cd D:\markijos-workspace\gc1-sentinel; python tests\run_all.py` (tiap file memakai server sementara di port berbeda, 8795–8798 dst.).

| File | Hasil | Catatan |
|---|---|---|
| `test_daftar_itsm.py` | 15/15 | **Diubah** (lihat 4.1) |
| `test_followup_sla_jeda.py` | 17/17 | **Baru**: jeda SLA, log_followup (400/404/200), reset jam, grup kosong, Telkom, noise, kesegaran |
| `test_identitas_pic.py` | 32/32 | **Diubah** (lihat 4.1) |
| `test_pratiket_wa.py`, `test_sla_accuracy.py`, `test_sla_katalog_kak.py`, `test_sqlite_submenu.py`, `test_statistik_nlp.py` | lulus | tidak diubah |
| `test_tiket_basi.py` | 6/6 | **Baru**: penanda tiket basi |
| **Total** | **162 lulus, 0 gagal** | |

### 4.1 Sembilan tes yang sebelumnya gagal (sudah ada sebelum sesi ini)
Dibuktikan gagal juga pada salinan tanpa perubahan saya.
- **Regresi nyata (diperbaiki di kode)**: keanggotaan multi-daftar hilang → lihat 3.3.
- **Tes usang terhadap desain terbaru (tes yang diubah, bukan kode)**:
  - `test_daftar_itsm.py`: ekspektasi "tiket hilang dari daftar saat sinkron ulang" tidak berlaku lagi karena data diakumulasi antar halaman/paginasi (`sentinel_server.py` ~baris 2289) dan SQLite permanen. Ekspektasi diubah (4 tiket tetap ada, Request=3, Assign=2, total=4) dengan komentar alasan.
  - `test_identitas_pic.py`: transisi Pending→Assigned tidak lagi mencatat approval otomatis karena Pending Approval kini disaring di server. Tes diubah: Pending disaring; setelah Assigned, approval & nota dinas tetap harus dicatat manual (`doc_set`).

### 4.2 Validasi terhadap skenario UAT (data live saat sesi)
| Skenario | Hasil | Catatan |
|---|---|---|
| HD-01 Metrik Opsi A | Lulus dgn catatan | Data live bergeser dari dokumen: On-Hold 60 (dok 61), Closed 430–431 (dok 429), aktif 68–69 (dok 70). Assigned=0, Pending=0 sesuai |
| HD-02 Alarm hening | Lulus | `#cardGc1Assigned` tidak ada pada DOM; verifikasi lewat 6 kartu `.v3-kpi`: Card 2 "✓ Terkendali", beacon `animationName: none`, audio `tiketmasuk.mp3` paused |
| HD-03 Isolasi Telkom | Lulus | `INC-KMF-102026-03473` ("EOS L1 TELKOM") ada di DB tapi tidak masuk snapshot; flag `is_gc1=1` di DB salah (belum dibersihkan) |
| HD-04 Approval | Lulus | `content_helpdesk.js` ~571/683; server kini juga menyaring (3.5) |
| HD-05 Kartu Follow Up | Berbeda dari dokumen | Dokumen: 6 tiket. Live: bervariasi (lihat 6.1). Klik kartu → scroll ke tabel **belum diuji** |
| HD-06 Pill sidebar | Berbeda dari dokumen | Dokumen 70/55/15, live 68/54/14 (bergeser sesuai data) |
| `scratch/verify_option_a_qa.py` | exit 0 | **Tidak memiliki assertion** (hanya mencetak nilai) |

---

## 5. File yang diubah / dibuat

Diubah: `sentinel_server.py`, `sentinel_db.py`, `content_helpdesk.js`, `dashboard.js`, `dashboard-v3.js`, `tests/test_daftar_itsm.py`, `tests/test_identitas_pic.py`, `scratch/build_minipc_zip.py` (kini mengecualikan `sentinel.db`, `sentinel_data.json`, log, `.env`, dll).
Dibuat: `tests/test_followup_sla_jeda.py`, `tests/test_tiket_basi.py`, dokumen ini.
Config baru (opsional): `stale_ticket_hours` (default 24).

**Cara menjalankan ulang server lokal**: hentikan proses `python.exe ... sentinel_server.py`, lalu `Start-Process <python> -ArgumentList "-B","sentinel_server.py" -WorkingDirectory D:\markijos-workspace\gc1-sentinel -WindowStyle Hidden` (atau `2-HENTIKAN_SEMUA.bat` lalu `1-JALANKAN_SEMUA.bat`). File statis dashboard tidak perlu restart server, cukup refresh browser.

---

## 6. Temuan & perilaku yang perlu diketahui

### 6.1 Kenapa angka Kartu 5 (Perlu di-Follow Up) berubah-ubah
1. **Waktu berjalan (by design)**: tiket melewati batas 60/240 menit → hitungan naik sendiri. Contoh: 4 → 7 tanpa tiket baru.
2. Bug "perubahan status palsu" me-reset jam (diperbaiki 3.2).
3. Bug grup berkedip (diperbaiki 3.6).
Setelah perbaikan: pembacaan stabil (In Progress 9, On-Hold 60, perlu follow-up 7). Nilai 7 dari 9 itu nyata; turun hanya jika petugas menekan "Sudah Di-follow Up" atau status berubah.

### 6.2 Masalah yang BELUM diperbaiki
- **Kartu 6 "Kepatuhan SLA" bukan kepatuhan resolusi KAK 18.c**: masih persentase tiket *aktif* yang belum lewat batas (pool kini tanpa On-Hold, jadi hanya ~8 tiket; 1 tiket menggeser ±12 poin). Rumus kepatuhan tiket *selesai* sudah ada di `compute_report()` (`sla_compliance_pct`, `sla_outcome()`, memakai `closedSeenTs` yang hanya perkiraan) tetapi tidak dipakai kartu.
- **`isGc1` tidak menyaring**: hanya pencocokan substring kata kunci (mis. "VM", "Cloud", "Database", "PDN"). Tiket non-GC1 (14 tiket: 4 In Progress + 10 On-Hold saat diukur) tetap masuk KPI tim. Perlu keputusan bisnis.
- **Filter Telkom juga mencocokkan deskripsi** (`is_telkom_ticket`, baris ~99) — tiket GC1 yang deskripsinya menyebut "Telkom" terbuang. DB menandai Telkom hanya dari nama grup.
- **`is_gc1=1` salah** pada `INC-KMF-102026-03473` di DB.
- **11 tiket aktif tanpa `created_date`** → `createdTsEstimated` (waktu masuk = pertama dilihat), SLA/follow-up perkiraan. Dan sejumlah tiket aktif (≈6 saat terakhir diukur) belum pernah terbaca dengan grup.
- **`/api/extension/status` 404 berulang**: tidak ada kode di folder ini yang memanggilnya; pemanggil kemungkinan ekstensi/agen lain di mesin yang sama (belum diidentifikasi).
- **Registry mencatat "tiket" sampah** `ingress-proxy-01 10.40.40.50` dkk (halaman monitoring ter-scrape 16:48–16:55); tersaring dari snapshot oleh filter Agustus, tapi mengotori `ticket_registry`.
- **`sync_logs` tumbuh tanpa batas**; tidak ada retensi.
- **Nama field menyesatkan**: `gc1_pending_count` = jumlah On-Hold.
- 3 tiket REQ muncul di API tetapi belum di DB saat diukur (selisih DB 497 vs API 499) — tidak ditelusuri.
- **Dokumen UAT belum diperbarui** (endpoint, nama tabel, angka 70/55/15, "6 tiket follow-up", flow Pending→Assigned).

### 6.3 Kenapa tiket hilang dari portal TIDAK ditutup otomatis
Portal berisi puluhan ribu tiket dengan 20 baris/halaman; tidak muncul di satu pembacaan ≠ tutup. Menutup otomatis akan salah menutup tiket aktif. Dipilih penanda "perlu diverifikasi" (3.4). Saat diukur, semua 69 tiket aktif terakhir terlihat <2 jam lalu → `stale_ticket_count = 0`.

### 6.4 Catatan teknis
- `config.json` ditulis ulang oleh `ConvertTo-Json` + `Set-Content -Encoding utf8` di PowerShell 5.1 menghasilkan **BOM** yang membuat server gagal memuat config (port default 8765 bentrok). Gunakan `[IO.File]::WriteAllText(..., UTF8Encoding($false))`.
- `normalize_ticket_state_and_desc()` memetakan "pending" → "On-Hold" (aturan #4). Konsekuensi: Pending Approval yang lolos sebelum penyaringan 3.5 akan terhitung On-Hold.
- Manajemen proses: saat sesi, server asli dijalankan `d:\Hermes\.hermes\hermes-agent\venv\Scripts\python.exe -B sentinel_server.py` (tersembunyi). Jika dijalankan lagi lewat `1-JALANKAN_SEMUA.bat`, hentikan dulu proses tersembunyi itu.

---

## 7. Distribusi (zip)

- **Zip resmi dibangun ulang**: `D:\markijos-workspace\gc1-sentinel-minipc.zip` (1.193.955 byte, 46 berkas) via `scratch\build_minipc_zip.py`; salinan identik di `gc1-sentinel\gc1-sentinel-minipc.zip`. Terverifikasi: kode sama dengan sumber (hash), `py_compile`/`node --check` lolos, boot bersih tanpa DB (dashboard HTTP 200), **tidak ada** `sentinel.db`/`sentinel_data.json`/log/`.env`/`*.key`. Folder `tests` sengaja tidak ikut (sesuai skrip).
- **PRIVASI**: zip lama memuat data tiket nyata (`sentinel.db`, `sentinel_data.json`). Cadangannya masih ada: `gc1-sentinel-minipc.sebelum-update.zip` di root workspace dan di `gc1-sentinel\`. Hapus bila tidak diperlukan.
- **Zip di web BELUM diganti.** `https://markijo.my.id/download` menyajikan zip lewat nginx (HTTP 200, `application/zip`, 1.447.923 byte = zip lama yang berisi data). Lokasi file di server belum diketahui; dugaan server `43.157.197.253` (entri `ubuntu@` ada di `~/.ssh/config` pengguna) **belum diverifikasi** — akses SSH dari agen diblokir pengaman ("Production Reads"). Langkah manual oleh pengguna:
  1. `ssh ubuntu@43.157.197.253 "sudo find / -name 'gc1-sentinel-minipc*.zip' -not -path '/proc/*' 2>/dev/null | xargs -r ls -la"`
  2. `scp D:/markijos-workspace/gc1-sentinel-minipc.zip ubuntu@43.157.197.253:<PATH_HASIL_LANGKAH_1>`
  3. Verifikasi ukuran unduhan di `markijo.my.id/download` = **1.193.955 byte**.
  Jika zip lama sempat tersedia publik, pertimbangkan bahwa data tiket di dalamnya mungkin sudah terunduh pihak lain.
- Folder `D:\markijos-workspace\_push_markijobsd` (remote GitHub `bagussundaru/markijobsd`) berisi paket lama `GC1-Helpdesk-Sentinel-MiniPC/` yang masih memuat `sentinel.db`/`sentinel_data.json` di working tree (di-ignore oleh `.gitignore`-nya). Tidak disentuh dan belum diperiksa apakah pernah ter-commit.

---

## 8. Saran pekerjaan berikutnya (urut dampak)

1. Putuskan & perbaiki definisi **Kartu 6** (kepatuhan resolusi KAK 18.c dari tiket selesai, atau ganti label agar jujur sebagai "% tiket aktif dalam SLA").
2. Putuskan perilaku **tiket non-GC1** (`isGc1=false`) di KPI tim, dan ganti pencocokan kata kunci yang terlalu longgar.
3. Perbarui **`UAT_TOOLS_HELPDESK_SENTINEL.md`** agar sesuai kondisi sekarang, dan tambahkan **assertion** pada `scratch/verify_option_a_qa.py` (saat ini selalu exit 0).
4. Uji ekstensi hasil dedupe kirim di **Chrome sungguhan** (reload ekstensi, amati laju `sync_logs`).
5. Klik-uji tombol **"Sudah Di-follow Up"** di dashboard dengan satu tiket nyata (belum pernah diklik di data asli; fungsi sudah lolos tes API).
6. Retensi `sync_logs`; bersihkan entri registry sampah; perbaiki `is_gc1` pada tiket Telkom di DB.
7. Selesaikan **penggantian zip di web** (bagian 7) dan putuskan nasib berkas cadangan yang memuat data.
8. Identifikasi pemanggil `/api/extension/status`.
