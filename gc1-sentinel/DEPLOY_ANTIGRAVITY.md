# Deploy GC 1 Sentinel di Mini PC dengan Antigravity

Salin prompt di bawah ke Antigravity (workspace = folder repo ini). Antigravity hanya menyiapkan dan memverifikasi;
dua langkah manusia ditandai **[MANUSIA]**.

## Prompt untuk agen Antigravity

```
Deploy aplikasi GC 1 Sentinel dari folder ini di Windows 11. Aturan keras:
- JANGAN mengubah kode untuk mengirim pesan WhatsApp, mengklik/mengisi/menyubmit apa pun di ITSM atau WhatsApp.
- JANGAN mengaktifkan AI eksternal: biarkan ai_provider="off" dan ai_external_approved=false di config.json.
- JANGAN menulis kunci API/kata sandi ke file mana pun. JANGAN mengubah bind_host dari 127.0.0.1.
- JANGAN membuka chat WhatsApp atau login ke akun apa pun.

Langkah:
1. Pastikan Python 3.9+ dan Google Chrome terpasang. Laporkan versinya.
2. Jalankan: python sentinel_server.py (jendela terpisah). Verifikasi: GET http://127.0.0.1:8765/api/status
   harus mengembalikan "wa_outbound_enabled": false.
3. Verifikasi keamanan: POST ke /api/clear_data dengan header "Origin: http://evil.example" harus ditolak 403.
4. Buka http://localhost:8765/dashboard.html dan pastikan tampil tanpa error konsol.
5. Jalankan: python markijo_agent.py --once  (harus "status: ok").
6. Laporkan hasil tiap langkah. Jika ada yang gagal, laporkan, jangan mengakali.
```

## Langkah manual
1. **[MANUSIA]** Chrome > `chrome://extensions` > Developer mode > Load unpacked > pilih folder ini.
2. **[MANUSIA]** Login WhatsApp Web (scan QR) dan portal helpdesk di Chrome yang sama; biarkan tab terbuka.
3. Edit `config.json`: `wa_ignored_groups`, `wa_team_senders`, `wa_verified_senders`, `pic_roster` (lihat README).
4. Auto-start: `3-PASANG_STARTUP_OTOMATIS.bat`.

Persetujuan Komdigi/pimpinan tetap diperlukan untuk membaca grup WhatsApp tenan dan portal ITSM.
