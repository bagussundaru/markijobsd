# Deploy GC 1 Sentinel di Mini PC dengan Antigravity

Buka folder ini (`gc1-sentinel`) sebagai workspace di Antigravity, lalu tempel prompt di bawah. Antigravity menyiapkan dan
memverifikasi; langkah yang butuh manusia ditandai **[MANUSIA]**.

## Prompt untuk agen Antigravity

```
Deploy dan verifikasi aplikasi GC 1 Sentinel dari folder ini di Windows 11. Kerjakan berurutan, laporkan hasil tiap langkah
(lulus/gagal + bukti singkat). Jika ada yang gagal, laporkan apa adanya dan berhenti di langkah itu; jangan mengakali.

ATURAN KERAS
- Sentinel hanya MEMBACA ITSM dan tidak pernah mengirim apa pun ke WhatsApp. Jangan menambah kode yang mengirim pesan WhatsApp,
  mengklik/mengisi/menyubmit apa pun di ITSM atau WhatsApp, atau membuka WhatsApp Web.
- Data tenan tidak boleh keluar dari Mini PC (KAK 15-16). Jangan memakai layanan AI eksternal (DeepSeek, OpenAI, AgentRouter,
  dst.) dan jangan mengubah ai_external_approved. AI hanya boleh lokal (Ollama).
- Jangan menulis kunci API, kata sandi, token, atau nomor HP ke file mana pun, dan jangan mencetaknya di laporan.
- Jangan mengubah bind_host dari 127.0.0.1 (kecuali saya minta tampilan tim) dan jangan mengubah wa_outbound_enabled.
- Jangan membuat folder/berkas berawalan garis bawah (_) di dalam folder ini (Chrome menolak memuat ekstensi). Pastikan tidak ada
  folder __pycache__ (gunakan python -B atau set PYTHONDONTWRITEBYTECODE=1).

LANGKAH
1. Prasyarat: laporkan versi Python (butuh 3.9+) dan Google Chrome. Ollama opsional (hanya untuk AI lokal).
2. Jalankan uji otomatis: python -B tests/run_all.py
   Harapan: baris akhir "TOTAL: <jumlah> lulus, 0 gagal" (nol gagal). Tiap uji memakai salinan sementara dan port sendiri; data asli tidak tersentuh.
3. Pastikan folder bersih untuk Chrome: find/Get-ChildItem nama berawalan "_" dan folder __pycache__ harus kosong.
4. Jalankan server di jendela terpisah: python -B sentinel_server.py   (port 8765, 127.0.0.1)
5. Verifikasi server:
   a. GET http://127.0.0.1:8765/api/status -> "wa_outbound_enabled": false
   b. GET /api/stats?range=day -> JSON berisi "buckets" (24 elemen) dan "kpi"
   c. POST /api/clear_data dengan header "Origin: http://evil.example" -> harus 403
   d. GET /config.json dan GET /sentinel_data.json -> harus 404
   e. GET /dashboard.html -> 200
6. Verifikasi tampilan (browser): buka http://localhost:8765/dashboard.html. Pastikan 4 tampilan terbuka tanpa galat konsol:
   Ringkasan, Tiket ITSM, Aduan WhatsApp (submenu "Monitoring per sumber"), dan Input Cepat. Pastikan sidebar bisa diciutkan
   (tombol « di kiri atas) dan grafik tampil.
7. Uji alur dengan dummy (tanpa data nyata): buka http://localhost:8765/dummy_helpdesk.html, klik "Mulai Auto-Simulasi", tunggu
   sekitar 2 menit, lalu pastikan tiket muncul di tampilan Tiket ITSM. Jeda simulasi setelah itu.
8. Bersihkan data uji: di dashboard tekan "Clear Data" (tab ITSM atau WhatsApp). Hapus entri PIC uji di Daftar PIC bila ada.
9. (Opsional, hanya bila Ollama terpasang) AI lokal untuk Input Cepat: di config.json set "ai_provider": "ollama" dan
   "ai_model": "<nama model lokal>", lalu restart server. Uji: tempel satu pesan di Input Cepat dan pastikan muncul
   "AI lokal selesai" atau laporkan pesan galatnya. Jika Ollama belum ada, lewati langkah ini (aturan NLP tetap jalan).
10. Auto-start saat boot: jalankan 3-PASANG_STARTUP_OTOMATIS.bat, lalu laporkan hasilnya.
11. Laporkan ringkasan: versi, hasil uji (TOTAL), hasil langkah 5-8, dan hal yang perlu tindakan manusia.
```

## Langkah manual (manusia)
1. **[MANUSIA]** Chrome > `chrome://extensions` > aktifkan Developer mode > **Load unpacked** > pilih folder `gc1-sentinel`.
   Setelah `manifest.json` berubah, tekan ikon muat-ulang pada kartu ekstensi.
2. **[MANUSIA]** Login ke portal ITSM (`https://pdn.layanan.go.id`) di Chrome yang sama dan biarkan tab terbuka.
   Bila domain ITSM berbeda, ubah `live_helpdesk_url` di `config.json` dan `manifest.json` (lihat README).
3. Edit `config.json`: `wa_priority_groups`, `wa_team_senders`, `wa_verified_senders`, `pic_roster` (lihat README).
4. Impor daftar PIC resmi lewat menu **Daftar PIC > Tambah / Impor** (CSV `nama;instansi;nomor`).
5. Tampilan tim hanya-baca (opsional): lihat bagian "Tampilan tim" di README.
6. Peringatan: persetujuan Komdigi/pimpinan tetap diperlukan untuk membaca layar ITSM. Sentinel tidak mengakses WhatsApp sama sekali.
