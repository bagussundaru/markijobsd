# GC 1 Sentinel v2 - Pendamping Helpdesk Managed Service GC1

Aplikasi pendamping untuk Helpdesk GC1 di Mini PC. ITSM Komdigi tetap menjadi sumber tiket resmi dan **tidak diubah**. Sentinel hanya membaca, lalu menambahkan notifikasi, pelacakan, SLA, dan rekap.

Mengikuti **SOP-GC1-OPS-001 v0.2** (prioritas, SLA, kanal WhatsApp, eskalasi).

## Perubahan v2

| Topik | Sebelumnya | Sekarang |
|---|---|---|
| WhatsApp | Mengirim rekap ke kontak "mimi Sandora" | **Tidak mengirim apa pun.** Hanya membaca grup yang didaftarkan, lalu membuat pra-tiket di dashboard |
| Prioritas dan SLA | Major 4j / Normal 8j (WA), Major 8j / Normal 24j (ITSM) | Critical 4j, Major 8j, Minor 24j, Service Request 24j (SOP 3.2), respons <15 menit |
| Waktu SLA | Dibekukan saat tiket dibuat, tanggal portal "disesuaikan ke hari ini" | Dihitung hidup dari waktu aduan/tiket yang sebenarnya |
| Tracking | Tidak ada | Riwayat per tiket: terdeteksi, status berubah, pindah group, respons pertama, catatan |
| Eskalasi | Tidak ada | Penanda: respons >15 menit, lewat 50% SLA tanpa aktivitas, batas eskalasi L2, SLA lewat |
| WA vs portal | Tersaring ganda | Pra-tiket WA ditautkan ke tiket portal; ada rekap harian selisihnya (SOP 4.4) |
| Keamanan | Server terbuka ke seluruh jaringan, CORS `*`, teks WA bisa menjalankan kode di dashboard | Hanya 127.0.0.1, Origin/Host asing ditolak, teks WA tidak pernah dieksekusi |
| Privasi | Membaca semua chat WhatsApp | Hanya grup di `wa_monitored_groups` |

## Jaminan read-only

- Ekstensi tidak mengklik, mengetik, atau mengubah halaman ITSM maupun WhatsApp (diaudit: tidak ada `click()`, `dispatchEvent`, `execCommand`, atau penulisan DOM).
- Tidak ada kode yang mengirim pesan WhatsApp. Satu-satunya yang ditulis adalah dashboard GC 1 lokal (`127.0.0.1:8765`).
- Membaca chat yang dibuka operator tidak mengubah tanda baca. Agen **tidak membuka chat sendiri**: aduan di grup yang tidak sedang terbuka baru terbaca bila operator membukanya.

## Cara kerja

```
Portal ITSM (pdn.layanan.go.id) --(ekstensi, baca saja)--+
                                                         +--> Sentinel Server (127.0.0.1:8765) --> Dashboard
Grup WhatsApp terdaftar --(ekstensi, baca saja)----------+       - SLA hidup, riwayat, eskalasi
                                                                 - rekap harian, ekspor CSV
Markijo Agent (konsol) --> markijo_events.log (kejadian baru dan eskalasi)
```

## Pengaturan awal (wajib)

Edit `config.json`:

```json
{
  "wa_monitored_groups": ["nama grup WA koordinasi GC 1"],
  "wa_verified_senders": ["Kemenkes", "Bappenas"],
  "pic_roster": {"Helpdesk L0": "nama petugas shift", "EOS L1": "..."},
  "live_helpdesk_url": "https://pdn.layanan.go.id"
}
```

- `wa_monitored_groups`: `["*"]` (default) = **semua grup** yang tampak seperti grup (daftar anggota di header), **bukan chat pribadi**. Deteksi grup ini heuristik dan belum diverifikasi di WhatsApp Web-mu. Bisa juga diisi sebagian nama grup. **Kosong = tidak ada pesan WA yang dibaca.**
- `wa_ignored_groups`: grup yang selalu diabaikan, mis. `["PD2"]` (menang atas `wa_monitored_groups`).
- `wa_team_senders`: nama pengirim dari tim sendiri, mis. `["Icon Plus","Helpdesk"]`. Pesan mereka tidak menjadi tiket; balasan mereka pada utas dihitung sebagai **respons pertama**.
- `wa_verified_senders`: potongan nama PIC tenan yang dikenal. Pengirim lain diberi tanda "belum terverifikasi" (SOP 4.1).
- `pic_roster`: nama petugas per peran. Kosong, dashboard hanya menampilkan peran, bukan nama karangan.
- Domain ITSM lain dari `pdn.layanan.go.id`: ubah `live_helpdesk_url`, tambahkan domain itu ke `manifest.json` (`host_permissions` dan `content_scripts[1].matches`), lalu muat ulang ekstensi.
- Kunci keamanan (`bind_host`, `allowed_origins`, `wa_outbound_enabled`) hanya bisa diubah lewat file, tidak lewat dashboard.

## Menjalankan

Klik `1-JALANKAN_SEMUA.bat`. Berhenti: `2-HENTIKAN_SEMUA.bat`. Auto-start saat booting: `3-PASANG_STARTUP_OTOMATIS.bat`.

Dashboard: http://localhost:8765/dashboard.html

## Fitur dashboard

- Tab: Assigned, Pending, In Progress, Aduan WA, Semua. Alarm suara untuk tiket Assigned baru dan eskalasi baru.
- Badge: Pra-tiket, prioritas (usulan otomatis, bisa ditetapkan ulang), tautan tiket portal, jam aduan pertama WA, pelapor belum terverifikasi.
- **Detail tiket**: klasifikasi dan alasannya, status respons, riwayat, serta tindakan (catat respons pertama, tetapkan prioritas dengan alasan, tautkan tiket portal, catatan).
- **Rekap Harian**: aduan WA vs tiket portal, daftar aduan WA yang belum punya tiket.
- **Ekspor CSV**: kolom siap dipakai untuk Excel Output Helpdesk, termasuk waktu aduan pertama WA dan waktu respons.

## Utas WhatsApp

Balasan yang mengutip pesan awal digabung ke pra-tiket yang sama (riwayat "Pesan lanjutan di utas WA"), bukan tiket baru.

## Agen AI (Hermes) - opsional, default MATI

`hermes_agent.py` memberi **usulan** untuk pra-tiket WA: prioritas SOP 3.3, ringkasan, obrolan antar-tenan atau bukan, perlu tindak lanjut. Usulan tampil di detail tiket sebagai "Saran AI" dan baru berlaku bila Helpdesk menekan **Terima**.

- Agen tidak punya akses ke WhatsApp/ITSM. Satu-satunya tulisan: `/api/ai_suggestion`. Keluaran model divalidasi, tidak dieksekusi.
- Penyedia: `ai_provider` = `off` (default) | `deepseek` | `openai` | `hermes_cli` (Hermes CLI yang sudah terpasang) | `ollama` (model lokal, data tidak keluar Mini PC).
- DeepSeek (server di luar negeri) hanya jalan bila `ai_external_approved: true`. **Isi itu hanya setelah ada persetujuan tertulis Komdigi/pimpinan** (KAK poin 16).
- Kunci API lewat variabel lingkungan `DEEPSEEK_API_KEY`, tidak ditulis di file mana pun. `ai_model` diisi sesuai nama model di akunmu.
- Sebelum dikirim, teks disamarkan (telepon, email, IP, URL, NIK, kata sandi). Nama pengirim tidak dikirim. Nama instansi dan isi keluhan tetap ikut terkirim.
- Semua yang keluar tercatat di `ai_audit.log`.

Jalankan: `python hermes_agent.py` (uji penyamaran tanpa model: `python hermes_agent.py --redact-test "teks"`).

**AgentRouter**: akun yang diuji menolak teks bahasa Indonesia (`content-blocked`), jadi pesan WA tidak bisa diproses lewat jalur ini. Agen berhenti sendiri saat ditolak dan klasifikasi aturan SOP tetap berjalan. Untuk bahasa Indonesia gunakan `ollama` atau penyedia lain.

## Laporan periodik (data terpantau)

Tombol **Laporan** di dashboard: harian, mingguan (Senin-Minggu), bulanan. Isi: tiket masuk dan perbandingan periode sebelumnya, terbuka/selesai, kepatuhan SLA, respons pertama <15 menit, eskalasi, aduan WA vs tiket portal, tren, instansi terbanyak, insiden Critical/Major. Ada cetak/PDF dan CSV.

- Ini **data terpantau, bukan angka resmi.** Angka laporan KAK/SOP 11.4 tetap dari portal ITSM. Setiap laporan memuat **cakupan pemantauan** (jam Sentinel aktif dari total jam periode) dan definisi hitungnya.
- Bagian yang tidak bisa dihitung Sentinel (kapasitas, IP, keamanan, kondisi perangkat untuk laporan bulanan 14 item KAK 8.5.f) tidak ada di sini.
- Sebelum dipakai sebagai bahan laporan, bandingkan satu minggu dengan ekspor portal.

## Nama petugas pada setiap tindakan

Tindakan (catat respons, tetapkan prioritas, tautkan tiket, catatan, terima/tolak saran AI) wajib atas nama petugas (SOP bab 12: satu akun satu orang). Nama diminta sekali per browser dan dicatat di riwayat tiket. Ini **pencatatan nama, bukan autentikasi**: untuk akuntabilitas penuh perlu login per orang.

## Tampilan tim (hanya-baca)

Agar rekan satu tim bisa memantau dashboard dari komputer lain:

1. `config.json`: `"team_view_enabled": true` dan `"bind_host": "0.0.0.0"` (atau IP LAN Mini PC). Token dibuat otomatis saat server mulai dan dicetak di konsol.
2. Buka firewall Windows untuk port 8765 hanya dari jaringan kantor.
3. Rekan membuka `http://<alamat-minipc>:8765/team?token=<token>` sekali (token disimpan sebagai cookie).

Tampilan tim hanya bisa membaca dashboard, laporan, dan CSV. Semua tindakan, pengaturan, dan data mentah ditolak (403); tombol operator disembunyikan. Catatan: lewat HTTP biasa, pakai hanya di jaringan internal yang dipercaya, dan siapa pun yang memegang token dapat melihat data tiket.

## Tampilan dashboard

- **Sidebar** yang bisa diciutkan (tombol « di kiri atas; pilihan diingat). Grup **Monitoring per sumber** juga bisa dilipat.
- **Ringkasan**: tiket ITSM dan aduan WhatsApp dalam **satu grafik** (tren tiket masuk, bertumpuk per sumber), komposisi sumber, prioritas, kategori layanan (KAK 18.c), kepatuhan SLA, daftar "perlu perhatian" dan "menunggu balasan WA". Rentang 24 jam / 7 hari / 30 hari.
- **Tiket ITSM** dan **Aduan WhatsApp**: masing-masing punya KPI, grafik, dan tabelnya sendiri (status, prioritas, kategori; kecepatan balasan, grup teratas, status pra-tiket).
- Grafik digambar dengan SVG buatan sendiri: **tanpa CDN dan tanpa panggilan keluar**, jadi jalan offline di Mini PC. Font memakai font sistem.
- Angka pada grafik adalah **data terpantau Sentinel**, bukan angka resmi laporan KAK.

## Input Cepat (NLP)

Menu **Input Cepat** (atau Ctrl+V di mana saja di dashboard, lalu Ctrl+Enter):

1. Tempel satu atau banyak pesan WhatsApp. NLP aturan langsung membaca **pengirim, nomor HP, instansi, intent, prioritas (SOP 3.3), kategori layanan (KAK 18.c), ringkasan satu kalimat, dan entitas** (nomor tiket, IP yang disamarkan, nama host), serta menandai pesan yang tampak **obrolan antar-tenan** (tidak dicentang otomatis).
2. Bila `ai_provider` = `ollama`, **AI lokal menyempurnakan di latar belakang** (prioritas dan ringkasan); hasil aturan tetap tampil lebih dulu sehingga operator tidak menunggu model. Teks disamarkan (telepon, email, IP, URL, kata sandi) sebelum diberikan ke model, dan model tidak pernah memegang akses ke apa pun.
3. Pesan yang dipilih menjadi pra-tiket dengan instansi dan ringkasan dari NLP, dan hasil NLP menempel di tiket sebagai **saran** (Helpdesk menerima atau menolak).

## Pengujian

```
python -B tests/run_all.py     # 92 uji otomatis; memakai salinan sementara, data asli tidak tersentuh
```

## Dasar angka (apa yang resmi, apa yang internal)

Bersumber dari **teks KAK** (poin 18.c, 8.5, 14), SOP v0.2, dan MoM 29 Sep 2026.

| Ketentuan | Nilai | Dasar | Status |
|---|---|---|---|
| SLA Insiden | **24 Jam, 15 menit** | KAK 18.c (kata per kata) | Resmi |
| Matriks prioritas insiden | Critical 4 jam, Major 8 jam, Minor 24 jam | SOP Komdigi No. 75 (via SOP v0.2 dan MoM) | Dipakai Sentinel; dokumen aslinya belum diterima tim |
| SLA permintaan layanan | Per Katalog Layanan: IaaS 4 Hari 4 Jam, BaaS 9 Hari 6 Jam, SecaS 1 Hari 24 Jam, SaaS 16 Hari, Layanan Pendukung 3 Hari, PaaS 3 Hari, Baremetal 5 Hari, DC Colocation 4 Hari 8 Jam, Jaringan 4 Hari 2 Jam, Cloud Terpadu 3 Hari, Sandi Data 9 Jam, Pendaftaran 1 Hari | KAK 18.c | Resmi; **arti "N Hari, M Jam" belum disepakati**, Sentinel membacanya sebagai durasi total (hari x 24 + jam) dan menandainya di tiket |
| "Respons < 15 menit" | 15 menit | **Tafsiran** SOP/MoM atas "24 Jam, 15 menit"; KAK tidak menyebut respons terpisah | Tafsiran, bukan kutipan KAK |
| Capaian SLA bulanan | > 95% | MoM 29 Sep 2026 (pagi) | Resmi (MoM) |
| Yang dihitung | Hanya tiket GC1 di portal; Telkom (GC2) terpisah | Dokumen ruang lingkup KAK GC1 | Resmi |
| Status tiket pada laporan | Request: Open/On-Hold/In Progress/Completed/Pending Approval/Closed/Canceled/Rejected. Insiden: On-Hold/In Progress/Resolved/Canceled/Closed | KAK 8.5.h | Resmi; Completed/Canceled/Rejected dianggap selesai |
| Laporan per kategori layanan | Request dan insiden per kategori, SLA per kategori | KAK 8.5.h.iv-viii | Resmi |
| Balasan WA 5-10 menit | 5 dan 10 menit | Target internal tim | **Tidak ada di KAK** |
| Tenan membuka tiket ITSM | 15 menit | Pengaman internal | **Tidak ada di KAK** |
| Jam SLA saat Pending; arti "Pending Approval" | - | Belum disepakati dengan Tim GC1 | Belum ditentukan; jam tidak berhenti saat Pending |
| Data di Indonesia, tidak ke pihak asing | - | KAK 15-16 | Resmi: AI eksternal tidak boleh memproses data tenan |

**Kategori layanan** pada tiket ditentukan dari kata kunci dan bisa diubah petugas (tombol "Ubah kategori layanan", alasan wajib). SLA request mengikuti kategorinya; request tanpa kategori terdeteksi memakai baku 24 jam sampai kategorinya dipilih. Laporan memuat dua ukuran: SLA menurut matriks prioritas SOP dan SLA menurut **batas baku KAK** (insiden 24 jam 15 menit; request sesuai katalog).

MoM 29 Sep menyebut Komdigi/GC2 menangani komplain di WhatsApp lebih dulu agar SLA tiket portal tidak breach. Karena itu Sentinel selalu mencatat **waktu aduan pertama di WA** (SOP 4.4) dan memisahkan metrik pra-tiket dari SLA portal.

## Alur pra-tiket WhatsApp

1. Aduan masuk di WhatsApp: **tempel** ke dashboard (Ctrl+V di mana saja, lalu **Ctrl+Enter**). Terbentuk **pra-tiket**.
2. **Balas dalam 5-10 menit** (`wa_reply_warn_minutes` 5, `wa_reply_breach_minutes` 10). Tombol **💬 Balasan** menyalin balasan siap kirim; **✓ Dibalas** menghentikan hitung mundur. Pil di baris tiket berubah hijau, kuning (>5 menit), merah (>10 menit).
3. **Tenan terdaftar**: balasan meminta pelapor **membuka tiket di ITSM dulu** (teks SOP lampiran 14.1, nama dan instansi terisi otomatis). **Nomor baru**: balasan berupa pertanyaan identitas, lalu alur verifikasi Komdigi.
4. Bila 15 menit (`wa_ticket_open_target_minutes`) belum ada tiket di ITSM, muncul penanda "Belum ada tiket di ITSM".
5. Setelah tiket ITSM terbit, **SLA resmi (KAK) berjalan pada tiket ITSM itu** (waktu tiket di portal). Pra-tiket **tidak dihitung SLA penyelesaian** dan tidak masuk persentase kepatuhan SLA. Waktu aduan pertama di WA tetap dicatat dan ditampilkan di tiket ITSM (SOP 4.4).
6. WhatsApp berfungsi sebagai pra-tiket dan komunikasi; laporan memisahkan metrik pra-tiket (balasan WA, pembukaan tiket) dari SLA tiket ITSM.

## Identitas pelapor dan daftar PIC (SOP 4.1)

Setiap aduan WhatsApp mencatat **nomor HP**, **nama PIC**, dan **instansi**. Nomor yang tampil sebagai nama kontak (nomor belum tersimpan di ponsel) dikenali otomatis; untuk teks polos isi kolom "Nomor HP pengirim".

- **Nomor terdaftar** (ada di Daftar PIC): tiket otomatis memakai nama dan instansi PIC.
- **Nomor baru**: tiket diberi penanda "nomor baru" dan peringatan *jangan beri informasi layanan*. Alurnya di tombol **📇 Daftar PIC** (atau "Kelola verifikasi" di detail tiket):
  1. salin pertanyaan identitas dan kirim manual (asal dan instansi),
  2. catat jawaban pelapor,
  3. bila belum terdaftar, minta pelapor mendaftar ke Komdigi dan catat nomor/tanggal pengajuan,
  4. setelah Komdigi memverifikasi, catat bukti verifikasinya. **Baru saat itu nomor disimpan sebagai PIC** dan semua tiket dari nomor itu ikut terverifikasi,
  5. bukan tenan: tolak, tiket ditutup dan aduan dihentikan.
- Nomor yang belum terverifikasi **tidak pernah masuk Daftar PIC**; ia hanya berupa "kasus verifikasi".
- **Impor daftar PIC resmi** (CSV `nama;instansi;nomor`) di tab Tambah / Impor.
- Semua langkah atas nama petugas dan tercatat di riwayat tiket. Tampilan tim menyamarkan nomor HP (hanya 4 digit terakhir), dan CSV laporan tidak memuat nomor.
- Data PIC tersimpan di `sentinel_data.json` (tidak masuk repo). **Tombol Clear Data tidak menghapus Daftar PIC**, supaya tidak terhapus tak sengaja; hapus entri uji lewat tombol Hapus.

## Syarat dokumen per jenis permintaan

Aturan di `config.json` (`doc_rules`). Bawaan: **pembuatan akun** wajib punya **approval** dan **nota dinas**.

- Tiket yang cocok diberi penanda "dokumen belum lengkap, jangan diproses" sampai keduanya tercatat (nomor dan tanggal, atas nama petugas).
- Approval dicatat otomatis bila status ITSM terlihat berubah dari *Pending Approval* ke status lain; nota dinas selalu dicatat petugas.
- Sentinel hanya mencatat dan memperingatkan; ia tidak memblokir sistem lain.
- Aturan ini **belum ada di SOP v0.2**; sebaiknya dimasukkan ke SOP versi berikutnya (SOP 4.4 saat ini membolehkan aktivasi akun sederhana diselesaikan di WhatsApp tanpa tiket).

## Batasan yang perlu diketahui

- Prioritas otomatis hanyalah **usulan** dari kata kunci SOP 3.3. Helpdesk menetapkan prioritas final berdasarkan dampak terverifikasi.
- SLA service request memakai nilai baku 24 jam. Katalog KAK 18.c ("4 hari, 4 jam" dan sejenisnya) belum dikonfirmasi BPO Komdigi (SOP 3.4).
- SLA tidak berhenti saat status Pending, karena aturannya belum disepakati (SOP bagian pertanyaan terbuka).
- Selektor WhatsApp Web (`content_whatsapp.js`) bergantung pada struktur halaman WhatsApp yang bisa berubah. Uji dengan pesan sungguhan di grup uji sebelum dipakai.
- Waktu pesan WA dibaca dari format tanggal browser. Bila ambigu (d/m vs m/d), dipilih yang masuk akal (tidak di masa depan).
- Dummy helpdesk (`dummy_helpdesk.html`) memuat satu tiket bertanggal 29 Sep 2026, jadi akan tampil "SLA lewat". Itu perilaku yang benar.
- `TUTORIAL_SETUP_MINIPC_WINDOWS11.docx` adalah dokumen v1 dan masih menyebut pengiriman ke WhatsApp.
