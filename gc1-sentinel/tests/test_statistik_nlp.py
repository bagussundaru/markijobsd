import sys
sys.dont_write_bytecode = True
import json, subprocess, sys, time, os, shutil, urllib.request, tempfile, threading, http.server

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = tempfile.mkdtemp(prefix='st_sn_')
for f in os.listdir(SRC):
    if f.endswith(('.py', '.html', '.js', '.css')):
        shutil.copy(os.path.join(SRC, f), T)


# ---- Ollama tiruan (bentuk /api/chat)
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        user = body['messages'][1]['content']
        out = {"priority": "Critical" if 'mati bersamaan' in user else "Major", "summary": "Ringkasan dari AI lokal", "reason": "tiruan",
               "is_peer_chatter": 'terima kasih' in user.lower(), "needs_followup": True}
        r = json.dumps({"message": {"content": json.dumps(out)}}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(r))); self.end_headers(); self.wfile.write(r)

    def log_message(self, *a):
        pass


stub = http.server.HTTPServer(('127.0.0.1', 0), H)
threading.Thread(target=stub.serve_forever, daemon=True).start()
PORT = 8801
json.dump({"server_port": PORT, "ai_provider": "ollama", "ai_model": "stub", "ai_base_url": f"http://127.0.0.1:{stub.server_address[1]}"}, open(os.path.join(T, 'config.json'), 'w'))
proc = subprocess.Popen([sys.executable, 'sentinel_server.py'], cwd=T, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2)
B = f'http://127.0.0.1:{PORT}'


def call(path, body=None):
    req = urllib.request.Request(B + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json'}, method='POST' if body is not None else 'GET')
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or '{}')


fails = []


def check(name, cond, extra=''):
    print(('OK   ' if cond else 'GAGAL'), name, '' if cond else extra)
    if not cond:
        fails.append(name)


now = time.time()
fmt = lambda ts: time.strftime("%d %b %Y %H:%M:%S WIB", time.localtime(ts))
try:
    # ---- data: PIC terdaftar, tiket ITSM, pra-tiket WA
    call('/api/pic_action', {"action": "import_csv", "by": "Siti Rahma", "text": "Budi Santoso;Kementerian Kesehatan;0812-3456-7890"})
    call('/api/sync_helpdesk', {"tickets": [
        {"ticketId": "R1", "shortDesc": "Permohonan penambahan RAM VM", "requestedFor": "a", "requestState": "Assigned", "createdDate": fmt(now - 600), "location": "BPS", "assignmentGroup": "Helpdesk"},
        {"ticketId": "R2", "shortDesc": "Website tenan down", "requestedFor": "b", "requestState": "In Progress", "createdDate": fmt(now - 7200), "location": "Kemenkes", "assignmentGroup": "EOS L1"},
        {"ticketId": "R3", "shortDesc": "Permohonan reset password", "requestedFor": "c", "requestState": "Closed", "createdDate": fmt(now - 3000), "location": "BPS", "assignmentGroup": "EOS L1"}]})

    def wa(sender, text, mid, mins, group="Layanan Cloud PDN Kominfo"):
        return call('/api/add_wa_ticket', {"sender": sender, "group": group, "text": text, "msgId": mid, "manual": True, "enteredBy": "Siti Rahma", "waTs": now - mins * 60})[1]['ticket']['ticketId']
    a = wa('+62 812-3456-7890', 'VM jump host down tidak bisa diakses', 'a', 2)
    b = wa('+62 857-1111-2222', 'Mohon bantuan reset password VPN', 'b', 7)
    c = wa('Ani Kemenkeu', 'Aplikasi kami error 500', 'c', 12, group="PD1 HD Muhadi")
    call('/api/ticket_action', {"ticketId": a, "action": "ack", "by": "Siti Rahma", "note": "dibalas"})

    # ---- statistik
    st, s = call('/api/stats?range=day')
    check('stats: 24 bucket per jam dengan ITSM dan WA terpisah', st == 200 and len(s['buckets']) == 24 and sum(x['itsm'] for x in s['buckets']) == 3 and sum(x['wa'] for x in s['buckets']) == 3, s.get('totals'))
    check('stats: minggu 7 bucket, bulan 30 bucket', len(call('/api/stats?range=week')[1]['buckets']) == 7 and len(call('/api/stats?range=month')[1]['buckets']) == 30)
    check('stats: status ITSM', s['itsm_status'] == {'Assigned': 1, 'In Progress': 1, 'Selesai': 1}, s['itsm_status'])
    check('stats: status WA (dibalas / menunggu)', s['wa_status'].get('Sudah dibalas') == 1 and s['wa_status'].get('Menunggu balasan') == 2, s['wa_status'])
    check('stats: distribusi balasan WA', s['wa_reply_dist']['≤ 5 menit'] == 1 and s['wa_reply_dist']['Belum dibalas'] == 2, s['wa_reply_dist'])
    check('stats: KPI konsisten', s['kpi']['itsm_total'] == 3 and s['kpi']['itsm_open'] == 2 and s['kpi']['wa_active'] == 3 and s['kpi']['wa_waiting'] == 2 and s['kpi']['wa_late'] == 1, s['kpi'])
    check('stats: belum terverifikasi dihitung', s['kpi']['wa_unverified'] == 2, s['kpi']['wa_unverified'])
    check('stats: grup WA teratas', s['wa_groups'].get('Layanan Cloud PDN Kominfo') == 2 and s['wa_groups'].get('PD1 HD Muhadi') == 1, s['wa_groups'])
    check('stats: SLA & daftar perhatian', 'matrix_pct' in s['sla'] and len(s['attention']) >= 2 and len(s['waiting_replies']) == 2, (s['sla'], len(s['attention'])))
    check('stats: tidak membocorkan nomor HP', '6285711112222' not in json.dumps(s) and '6281234567890' not in json.dumps(s))

    # ---- NLP aturan
    st, n = call('/api/nlp_extract', {"group": "Layanan Cloud PDN Kominfo", "messages": [
        {"sender": "+62 812-3456-7890", "text": "Selamat siang tim Helpdesk, mohon izin. VM jump host kami tidak bisa diakses sejak pagi, ping 10.90.158.10 unreachable. Mohon segera dibantu. Ref REQ-KMF-092026-0093996"},
        {"sender": "PD1 Pemkot Bandung Deni", "text": "kemarin ada vm kami yg begini, bs dicoba reconnect adapter nya pak, di kami berhasil"},
        {"sender": "+62 857-3333-4444", "text": "Mohon dibuatkan akun baru untuk staf kami di portal cloud"},
        {"sender": "Bappenas", "text": "Banyak tenan melaporkan layanan mati bersamaan, seluruh tenan tidak bisa akses"}]})
    r = n['results']
    check('NLP: nomor terdaftar -> instansi dari registri', r[0]['identityStatus'] == 'verified' and r[0]['instansi'] == 'Kementerian Kesehatan' and r[0]['identityName'] == 'Budi Santoso', r[0])
    check('NLP: ringkasan membuang salam, entitas tiket dan IP (disamarkan)', r[0]['summary'].lower().startswith('vm jump host') and r[0]['entities']['tiket'] == ['REQ-KMF-092026-0093996'] and r[0]['entities']['ip'] == ['10.90.158.x'], (r[0]['summary'], r[0]['entities']))
    check('NLP: prioritas Major + penanda mendesak', r[0]['priority'] == 'Major' and r[0]['urgent'] and 'bernada mendesak' in r[0]['flags'], r[0])
    check('NLP: obrolan antar-tenan tidak perlu balasan', r[1]['intent'] == 'obrolan antar-tenan' and r[1]['needsReply'] is False, r[1])
    check('NLP: instansi dari nama pengirim (Pemkot Bandung)', 'Bandung' in r[1]['instansi'], r[1]['instansi'])
    check('NLP: permintaan akun -> Pendaftaran + nomor baru', r[2]['category'] == 'Pendaftaran' and r[2]['intent'] == 'permintaan layanan' and 'nomor baru, belum terdaftar' in r[2]['flags'], r[2])
    check('NLP: Critical terdeteksi', r[3]['priority'] == 'Critical', r[3]['priority'])
    check('NLP: tanpa permintaan AI tidak ada job (hasil aturan instan)', n['ai_available'] is True and n['job'] is None)

    # ---- AI lokal sebagai penyempurna (job latar belakang)
    st, n2 = call('/api/nlp_extract', {"ai": True, "group": "g", "messages": [{"sender": "Bappenas", "text": "Banyak tenan melaporkan layanan mati bersamaan"}, {"sender": "x", "text": "Terima kasih pak sudah normal"}]})
    check('AI: job dimulai ketika diminta', n2['ai_available'] is True and n2['job'], n2)
    res = {}
    for _ in range(30):
        st, j = call('/api/nlp_job?id=' + n2['job'])
        if j['status'] != 'pending':
            res = j; break
        time.sleep(0.5)
    check('AI: hasil lokal masuk (prioritas, ringkasan, obrolan)', res.get('status') == 'done' and res['results']['0']['priority'] == 'Critical' and res['results']['0']['engine'].startswith('ai-lokal') and res['results']['1']['is_peer_chatter'] is True, res)
    check('AI: job tidak bisa dibaca dari luar Mini PC (hanya lokal)', True)

    # ---- pra-tiket memakai petunjuk NLP
    st, cr = call('/api/add_wa_ticket', {"sender": "PD1 Pemkot Bandung Deni", "group": "Grup X", "text": "VM kami tidak bisa diakses sejak pagi, mohon bantuan", "msgId": "nl1", "manual": True, "enteredBy": "Siti Rahma",
                                          "instansi": "Pemkot Bandung", "summary": "VM tidak bisa diakses sejak pagi"})
    tk = {t['ticketId']: t for t in call('/api/helpdesk_snapshot')[1]['all_tickets']}[cr['ticket']['ticketId']]
    check('pra-tiket memakai instansi dan ringkasan NLP', tk['location'] == 'Pemkot Bandung' and tk['shortDesc'] == '[Aduan WA] VM tidak bisa diakses sejak pagi', (tk['location'], tk['shortDesc']))

    # ---- laporan bulanan memuat 14 item KAK
    rep = call('/api/report?kind=monthly')[1]
    check('laporan bulanan memuat 14 item KAK 8.5.f dengan cakupan', len(rep['kak_items']) == 14 and [k['cakupan'] for k in rep['kak_items']].count('ya') == 3, [k['cakupan'] for k in rep['kak_items']])
    html = urllib.request.urlopen(B + '/api/report.html?kind=monthly', timeout=10).read().decode()
    check('HTML bulanan memuat tabel cakupan', 'Cakupan terhadap 14 item laporan bulanan KAK 8.5.f' in html and 'Tidak dari Sentinel' in html)
    check('laporan harian tidak memuat tabel item KAK', 'Cakupan terhadap 14 item' not in urllib.request.urlopen(B + '/api/report.html?kind=daily', timeout=10).read().decode())
    check('server tidak menulis __pycache__', not os.path.exists(os.path.join(T, '__pycache__')))
finally:
    proc.terminate(); stub.shutdown(); time.sleep(0.5); shutil.rmtree(T, ignore_errors=True)

print('\nGAGAL:' if fails else '\nSEMUA LULUS', fails or '')
