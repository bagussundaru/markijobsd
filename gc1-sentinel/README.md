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

## Batasan yang perlu diketahui

- Prioritas otomatis hanyalah **usulan** dari kata kunci SOP 3.3. Helpdesk menetapkan prioritas final berdasarkan dampak terverifikasi.
- SLA service request memakai nilai baku 24 jam. Katalog KAK 18.c ("4 hari, 4 jam" dan sejenisnya) belum dikonfirmasi BPO Komdigi (SOP 3.4).
- SLA tidak berhenti saat status Pending, karena aturannya belum disepakati (SOP bagian pertanyaan terbuka).
- Selektor WhatsApp Web (`content_whatsapp.js`) bergantung pada struktur halaman WhatsApp yang bisa berubah. Uji dengan pesan sungguhan di grup uji sebelum dipakai.
- Waktu pesan WA dibaca dari format tanggal browser. Bila ambigu (d/m vs m/d), dipilih yang masuk akal (tidak di masa depan).
- Dummy helpdesk (`dummy_helpdesk.html`) memuat satu tiket bertanggal 29 Sep 2026, jadi akan tampil "SLA lewat". Itu perilaku yang benar.
- `TUTORIAL_SETUP_MINIPC_WINDOWS11.docx` adalah dokumen v1 dan masih menyebut pengiriman ke WhatsApp.
