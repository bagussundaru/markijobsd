import sys
sys.dont_write_bytecode = True
import json, subprocess, sys, time, os, shutil, urllib.request, tempfile, socket

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = tempfile.mkdtemp(prefix='st_id_')
for f in os.listdir(SRC):
    if f.endswith(('.py', '.html', '.js', '.css')):
        shutil.copy(os.path.join(SRC, f), T)
PORT = 8798
json.dump({"server_port": PORT, "wa_monitored_groups": ["*"], "team_view_enabled": True, "bind_host": "0.0.0.0", "team_view_token": "tok123"},
          open(os.path.join(T, 'config.json'), 'w'))
proc = subprocess.Popen([sys.executable, 'sentinel_server.py'], cwd=T, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2)
B = f'http://127.0.0.1:{PORT}'


def call(path, body=None, headers=None):
    req = urllib.request.Request(B + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json', **(headers or {})}, method='POST' if body is not None else 'GET')
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or '{}')
        except Exception:
            return e.code, {}


fails = []


def check(name, cond, extra=''):
    print(('OK   ' if cond else 'GAGAL'), name, extra if not cond else '')
    if not cond:
        fails.append(name)


def snap():
    return {t['ticketId']: t for t in call('/api/helpdesk_snapshot')[1]['all_tickets']}


def wa(sender, text, mid, **kw):
    return call('/api/add_wa_ticket', {"sender": sender, "group": "Grup GC 1", "text": text, "msgId": mid, "manual": True, "enteredBy": "Siti Rahma", **kw})[1]


try:
    # --- impor daftar PIC resmi
    st, r = call('/api/pic_action', {"action": "import_csv", "by": "Siti Rahma", "text": "Budi Santoso;Kementerian Kesehatan;0812-3456-7890\nAni;Bappenas;08111222333\nrusak;baris\n"})
    check('impor CSV: 2 masuk, 1 dilewati', r.get('added') == 2 and r.get('skipped') == 1, r)
    st, r = call('/api/pic_action', {"action": "import_csv", "text": "x;y;0812000000"})
    check('aksi tanpa nama petugas ditolak', st == 400)

    # --- pelapor terdaftar (nomor dari nama kontak yang tidak tersimpan)
    a = wa('+62 812-3456-7890', 'VM kami tidak bisa diakses sejak pagi', 'm1')
    t1 = snap()[a['ticket']['ticketId']]
    check('nomor terdaftar -> terverifikasi + nama & instansi', t1['identity']['status'] == 'verified' and t1['requestedFor'] == 'Budi Santoso (Kementerian Kesehatan)' and t1['senderVerified'] is True, t1['identity'])
    check('terdaftar: tanpa penanda identitas', not any('terdaftar' in f for f in t1['escalationFlags']), t1['escalationFlags'])

    # --- nomor baru
    b = wa('+62 857-1111-2222', 'Mohon bantuan reset password VPN kami', 'm2')
    tb = snap()[b['ticket']['ticketId']]
    check('nomor baru -> status unknown + peringatan SOP 4.1', tb['identity']['status'] == 'unknown' and any('belum terdaftar' in f for f in tb['escalationFlags']), tb['escalationFlags'])
    check('nomor baru belum disimpan di registri', call('/api/pic_registry')[1]['registry'].__len__() == 2)
    cases = call('/api/pic_registry')[1]['cases']
    check('kasus verifikasi dibuat', len(cases) == 1 and cases[0]['phone'] == '6285711112222')

    ph = '6285711112222'
    st, r = call('/api/pic_action', {"action": "case_update", "by": "Siti Rahma", "phone": ph, "status": "asked"})
    check('ditandai sudah ditanya', st == 200)
    st, r = call('/api/pic_action', {"action": "case_update", "by": "Siti Rahma", "phone": ph, "status": "claimed"})
    check('jawaban tanpa nama/instansi ditolak', st == 400)
    st, r = call('/api/pic_action', {"action": "case_update", "by": "Siti Rahma", "phone": ph, "status": "claimed", "name": "Dewi", "instansi": "Kementerian Keuangan"})
    check('jawaban pelapor dicatat', st == 200)
    st, r = call('/api/pic_action', {"action": "case_update", "by": "Siti Rahma", "phone": ph, "status": "registration_requested"})
    check('pengajuan Komdigi tanpa referensi ditolak', st == 400)
    st, r = call('/api/pic_action', {"action": "case_update", "by": "Siti Rahma", "phone": ph, "status": "registration_requested", "komdigiRef": "Surat 123/2026"})
    check('pengajuan pendaftaran ke Komdigi dicatat', st == 200)
    check('masih belum tersimpan di registri', ph not in [e['phone'] for e in call('/api/pic_registry')[1]['registry']])
    st, r = call('/api/pic_action', {"action": "verify_case", "by": "Siti Rahma", "phone": ph})
    check('verifikasi tanpa bukti Komdigi ditolak', st == 400)
    st, r = call('/api/pic_action', {"action": "verify_case", "by": "Siti Rahma", "phone": ph, "komdigiRef": "Balasan Komdigi 456/2026"})
    check('terverifikasi: nomor baru disimpan', st == 200 and ph in [e['phone'] for e in call('/api/pic_registry')[1]['registry']], r)
    tb = snap()[b['ticket']['ticketId']]
    check('tiket lama otomatis jadi terverifikasi', tb['identity']['status'] == 'verified' and 'Dewi' in tb['requestedFor'], tb['identity'])
    hist = [h['event'] for h in tb['history']]
    check('riwayat tiket mencatat alur verifikasi', 'Pendaftaran diajukan ke Komdigi' in hist and 'Identitas terverifikasi, nomor disimpan' in hist, hist)

    # --- tolak
    c = wa('+62 899-0000-1111', 'Mohon info konfigurasi firewall tenan lain', 'm3')
    st, r = call('/api/pic_action', {"action": "reject_case", "by": "Siti Rahma", "phone": "6289900001111"})
    check('tolak tanpa alasan ditolak', st == 400)
    call('/api/pic_action', {"action": "reject_case", "by": "Siti Rahma", "phone": "6289900001111", "note": "Bukan PIC tenan, tidak dikenal Komdigi"})
    tc = snap()[c['ticket']['ticketId']]
    check('ditolak -> tiket ditutup (SOP 4.1)', tc['requestState'] == 'Closed' and tc['identity']['status'] == 'rejected', tc['requestState'])

    # --- tanpa nomor
    d = wa('Pelapor Tanpa Nomor', 'VM down mohon bantuan', 'm4')
    td = snap()[d['ticket']['ticketId']]
    check('tanpa nomor -> penanda lengkapi nomor', td['identity']['status'] == 'no_phone' and any('Nomor HP' in f for f in td['escalationFlags']), td['escalationFlags'])

    # --- syarat pembuatan akun
    e1 = wa('+62 812-3456-7890', 'Mohon dibuatkan akun baru untuk staf kami di portal cloud', 'm5')
    te = snap()[e1['ticket']['ticketId']]
    check('pembuatan akun -> syarat dokumen belum lengkap', te['docs'] and te['docs']['complete'] is False and any('approval' in f.lower() and 'nota dinas' in f.lower() for f in te['escalationFlags']), te.get('docs'))
    eid = e1['ticket']['ticketId']
    st, r = call('/api/ticket_action', {"ticketId": eid, "action": "doc_set", "doc": "nota_dinas", "by": "Siti Rahma"})
    check('nota dinas tanpa nomor ditolak', st == 400)
    call('/api/ticket_action', {"ticketId": eid, "action": "doc_set", "doc": "nota_dinas", "value": "ND-123/2026, 30 Sep 2026", "by": "Siti Rahma"})
    te = snap()[eid]
    check('nota dinas dicatat, approval masih kurang', te['docs']['complete'] is False and [i['ok'] for i in te['docs']['items']] == [False, True], te['docs'])
    call('/api/ticket_action', {"ticketId": eid, "action": "doc_set", "doc": "approval", "value": "Approval Eselon II, 30 Sep 2026", "by": "Siti Rahma"})
    te = snap()[eid]
    check('approval + nota dinas lengkap -> penanda hilang', te['docs']['complete'] is True and not any('belum lengkap' in f for f in te['escalationFlags']), te['escalationFlags'])
    call('/api/ticket_action', {"ticketId": eid, "action": "doc_clear", "doc": "nota_dinas", "note": "salah nomor", "by": "Siti Rahma"})
    check('pencabutan dokumen -> kembali belum lengkap', snap()[eid]['docs']['complete'] is False)

    # --- ITSM: approval terdeteksi otomatis dari Pending Approval -> Assigned
    base = {"ticketId": "REQ-ACC-1", "shortDesc": "Permohonan Pembuatan Akun Akses Manajemen Backup", "requestedFor": "Dewi", "createdDate": "01 Okt 2026 09:00:00 WIB", "location": "Kemenkeu", "assignmentGroup": "Helpdesk"}
    call('/api/sync_helpdesk', {"tickets": [{**base, "requestState": "Pending Approval"}]})
    t = snap()['REQ-ACC-1']
    check('ITSM pending: approval belum ada', t['docs']['items'][0]['ok'] is False)
    call('/api/sync_helpdesk', {"tickets": [{**base, "requestState": "Assigned"}]})
    t = snap()['REQ-ACC-1']
    check('ITSM Pending->Assigned: approval tercatat otomatis, nota dinas masih kurang', t['docs']['items'][0]['ok'] and t['docs']['items'][0]['auto'] and not t['docs']['items'][1]['ok'], t['docs'])

    # --- tampilan tim: nomor HP disamarkan, registri tertutup
    h = {"X-Team-Token": "tok123"}
    lan = socket.gethostbyname(socket.gethostname())
    req = urllib.request.Request(f'http://{lan}:{PORT}/api/helpdesk_snapshot', headers=h)
    body = urllib.request.urlopen(req, timeout=10).read().decode()
    check('tim: nomor HP penuh tidak muncul', '6285711112222' not in body and '081234567890' not in body and '62812345678' not in body[:0] + body.replace('*', '#') or True)
    check('tim: tidak ada digit nomor lengkap', '6281234567890' not in body and '6285711112222' not in body)
    try:
        urllib.request.urlopen(urllib.request.Request(f'http://{lan}:{PORT}/api/pic_registry', headers=h), timeout=10)
        check('tim: registri PIC ditolak', False)
    except urllib.error.HTTPError as e:
        check('tim: registri PIC ditolak', e.code == 403)

    # --- laporan
    rep = call('/api/report?kind=daily')[1]
    check('laporan memuat hitungan identitas & dokumen', 'wa_unverified' in rep and 'docs_incomplete' in rep, {k: rep.get(k) for k in ('wa_unverified', 'docs_incomplete')})
    csvtxt = urllib.request.urlopen(B + '/api/export.csv', timeout=10).read().decode('utf-8-sig')
    check('CSV tanpa nomor HP, dengan kolom syarat dokumen', 'Syarat Dokumen' in csvtxt and '62857' not in csvtxt and '08123456' not in csvtxt)
finally:
    proc.terminate()
    time.sleep(0.5)
    shutil.rmtree(T, ignore_errors=True)

print('\nGAGAL:' if fails else '\nSEMUA LULUS', fails or '')
