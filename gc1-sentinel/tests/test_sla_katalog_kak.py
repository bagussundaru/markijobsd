import sys
sys.dont_write_bytecode = True
import json, subprocess, sys, time, os, shutil, urllib.request, tempfile

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = tempfile.mkdtemp(prefix='st_kak_')
for f in os.listdir(SRC):
    if f.endswith(('.py', '.html', '.js', '.css')):
        shutil.copy(os.path.join(SRC, f), T)
PORT = 8800
json.dump({"server_port": PORT}, open(os.path.join(T, 'config.json'), 'w'))
proc = subprocess.Popen([sys.executable, 'sentinel_server.py'], cwd=T, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2)
B = f'http://127.0.0.1:{PORT}'


def call(path, body=None):
    req = urllib.request.Request(B + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json'}, method='POST' if body is not None else 'GET')
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
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


def itsm(tid, desc, state='Assigned', hours_ago=1):
    return {"ticketId": tid, "shortDesc": desc, "requestedFor": "x", "requestState": state, "createdDate": fmt(now - hours_ago * 3600), "location": "BPS", "assignmentGroup": "Helpdesk"}


try:
    tickets = [
        itsm('K-IAAS', 'Permohonan Penambahan Core CPU dan RAM Server'),
        itsm('K-SEC', 'Permohonan Pemasangan Web Application Firewall (WAF)'),
        itsm('K-BAAS', 'Permohonan restore backup VM database'),
        itsm('K-REG', 'Permohonan pembuatan akun baru portal'),
        itsm('K-NET', 'Permohonan IP publik tambahan'),
        itsm('K-PEND', 'Permohonan diskusi teknis lokal akses aplikasi'),
        itsm('K-OTHER', 'Permohonan penggantian kabel LAN lantai 3'),
        itsm('K-INC', 'Website tenan down error 500', hours_ago=10),
        itsm('K-CAN', 'Permohonan penambahan disk VM', state='Canceled Request'),
        itsm('K-REJ', 'Permohonan penambahan RAM VM', state='Rejected Request'),
        itsm('K-COMP', 'Permohonan penambahan disk VM', state='Completed Request', hours_ago=3),
    ]
    call('/api/sync_helpdesk', {"tickets": tickets})
    s = {t['ticketId']: t for t in call('/api/helpdesk_snapshot')[1]['all_tickets']}
    expect = {'K-IAAS': ('IaaS', 100), 'K-SEC': ('SecaS', 48), 'K-BAAS': ('BaaS', 222), 'K-REG': ('Pendaftaran', 24), 'K-NET': ('Layanan Jaringan', 98), 'K-PEND': ('Layanan Pendukung', 72)}
    for tid, (cat, hrs) in expect.items():
        check(f'{tid}: kategori {cat} dan SLA {hrs} jam (katalog KAK 18.c)', s[tid]['serviceCategory'] == cat and s[tid]['slaLimitHours'] == hrs, (s[tid]['serviceCategory'], s[tid]['slaLimitHours']))
    check('request tanpa kategori: baku 24 jam + keterangan', s['K-OTHER']['serviceCategory'] == '' and s['K-OTHER']['slaLimitHours'] == 24 and 'tanpa kategori' in s['K-OTHER']['slaBasis'], s['K-OTHER']['slaBasis'])
    check('insiden tetap memakai matriks prioritas (Major 8 jam)', s['K-INC']['priority'] == 'Major' and s['K-INC']['slaLimitHours'] == 8 and 'Matriks' in s['K-INC']['slaBasis'], s['K-INC']['slaBasis'])
    check('dasar SLA katalog menyebut tafsiran belum dikonfirmasi', 'tafsiran belum dikonfirmasi' in s['K-IAAS']['slaBasis'], s['K-IAAS']['slaBasis'])
    check('Canceled/Rejected/Completed dianggap selesai', all(s[x]['slaClosed'] for x in ('K-CAN', 'K-REJ', 'K-COMP')), [s[x]['slaClosed'] for x in ('K-CAN', 'K-REJ', 'K-COMP')])

    # override kategori
    st, r = call('/api/ticket_action', {"ticketId": "K-OTHER", "action": "set_category", "value": "Layanan Jaringan", "by": "Siti Rahma"})
    check('ubah kategori tanpa alasan ditolak', st == 400)
    st, r = call('/api/ticket_action', {"ticketId": "K-OTHER", "action": "set_category", "value": "Ngawur", "note": "x", "by": "Siti Rahma"})
    check('kategori di luar katalog ditolak', st == 400)
    st, r = call('/api/ticket_action', {"ticketId": "K-OTHER", "action": "set_category", "value": "Layanan Jaringan", "note": "kabel LAN = jaringan", "by": "Siti Rahma"})
    s = {t['ticketId']: t for t in call('/api/helpdesk_snapshot')[1]['all_tickets']}
    check('override kategori berlaku ke SLA', st == 200 and s['K-OTHER']['serviceCategory'] == 'Layanan Jaringan' and s['K-OTHER']['slaLimitHours'] == 98, s['K-OTHER']['slaLimitHours'])

    # laporan per kategori + batas baku KAK
    rep = call('/api/report?kind=weekly&date=' + time.strftime('%Y-%m-%d'))[1]
    cats = {c['kategori']: c for c in rep['by_category']}
    check('laporan per kategori memuat request dan insiden', cats['IaaS']['request'] >= 2 and cats['Belum terklasifikasi']['insiden'] == 1, rep['by_category'])
    check('laporan memuat kepatuhan menurut batas baku KAK', 'sla_kak_compliance_pct' in rep and rep['sla_kak_compliance_pct'] is not None, rep.get('sla_kak_compliance_pct'))
    html = urllib.request.urlopen(B + '/api/report.html?kind=weekly', timeout=10).read().decode()
    check('HTML laporan memuat tabel kategori & baris batas baku KAK', 'Per kategori layanan (KAK 8.5.h)' in html and 'batas baku KAK 18.c' in html)
finally:
    proc.terminate(); time.sleep(0.5); shutil.rmtree(T, ignore_errors=True)

print('\nGAGAL:' if fails else '\nSEMUA LULUS', fails or '')
