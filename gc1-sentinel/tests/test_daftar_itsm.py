"""Uji: menu ITSM yang terpisah (Request dan Assign) dibaca sebagai daftar sendiri-sendiri dan tidak saling menimpa."""
import sys
sys.dont_write_bytecode = True
import json, subprocess, time, os, shutil, urllib.request, tempfile

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = tempfile.mkdtemp(prefix='st_lst_')
for f in os.listdir(SRC):
    if f.endswith(('.py', '.html', '.js', '.css')):
        shutil.copy(os.path.join(SRC, f), T)
PORT = 8802
json.dump({"server_port": PORT}, open(os.path.join(T, 'config.json'), 'w'))
proc = subprocess.Popen([sys.executable, '-B', 'sentinel_server.py'], cwd=T, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2)
B = f'http://127.0.0.1:{PORT}'


def call(path, body=None):
    req = urllib.request.Request(B + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json'}, method='POST' if body is not None else 'GET')
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode() or '{}')


fails = []


def check(name, cond, extra=''):
    print(('OK   ' if cond else 'GAGAL'), name, '' if cond else extra)
    if not cond:
        fails.append(name)


now = time.time()
fmt = lambda ts: time.strftime("%d %b %Y %H:%M:%S WIB", time.localtime(ts))


def tk(tid, desc, state='Assigned', mins=30, group='Helpdesk'):
    return {"ticketId": tid, "shortDesc": desc, "requestedFor": "x", "requestState": state, "createdDate": fmt(now - mins * 60), "location": "BPS", "assignmentGroup": group}


REQ = {"title": "Show All Request - Portal Helpdesk", "path": "/itsm/request/list"}
ASG = {"title": "Show All Assign - Portal Helpdesk", "path": "/itsm/assign/list"}


def snap():
    return {t['ticketId']: t for t in call('/api/helpdesk_snapshot')['all_tickets']}


try:
    call('/api/sync_helpdesk', {"list": REQ, "tickets": [tk('REQ-1', 'Permohonan penambahan RAM VM'), tk('REQ-2', 'Permohonan reset password'), tk('REQ-3', 'Permohonan IP publik')]})
    call('/api/sync_helpdesk', {"list": ASG, "tickets": [tk('REQ-2', 'Permohonan reset password', 'In Progress'), tk('INC-9', 'Website tenan down', 'Assigned', 20, 'EOS L1')]})
    s = snap()
    check('dua halaman ITSM tidak saling menimpa (gabungan 4 tiket)', set(s) == {'REQ-1', 'REQ-2', 'REQ-3', 'INC-9'}, sorted(s))
    check('keanggotaan daftar per tiket', s['REQ-1']['itsmLists'] == ['request'] and s['INC-9']['itsmLists'] == ['assign'] and s['REQ-2']['itsmLists'] == ['assign', 'request'], {k: v['itsmLists'] for k, v in s.items()})
    check('tiket di dua daftar memakai data dari sinkronisasi terbaru (In Progress)', s['REQ-2']['requestState'] == 'In Progress', s['REQ-2']['requestState'])
    info = {i['key']: i for i in call('/api/helpdesk_snapshot')['itsm_lists']}
    check('info daftar: jumlah dan waktu sinkron per halaman', info['request']['count'] == 3 and info['assign']['count'] == 2 and info['request']['synced_at'] and info['assign']['age_sec'] is not None, info)

    # sinkron ulang Request hanya berisi REQ-1: REQ-3 hilang dari Request, REQ-2 tetap lewat Assign, daftar Assign utuh
    call('/api/sync_helpdesk', {"list": REQ, "tickets": [tk('REQ-1', 'Permohonan penambahan RAM VM')]})
    s = snap()
    check('sinkron ulang Request tidak menghapus tiket daftar Assign', set(s) == {'REQ-1', 'REQ-2', 'INC-9'}, sorted(s))
    check('REQ-2 tidak lagi anggota Request, tetap anggota Assign', s['REQ-2']['itsmLists'] == ['assign'], s['REQ-2']['itsmLists'])

    # statistik per daftar
    sr = call('/api/stats?range=day&list=request'); sa = call('/api/stats?range=day&list=assign'); sall = call('/api/stats?range=day')
    check('stats per daftar: Request 1, Assign 2, semua 3 tiket ITSM', sr['kpi']['itsm_total'] == 1 and sa['kpi']['itsm_total'] == 2 and sall['kpi']['itsm_total'] == 3, (sr['kpi']['itsm_total'], sa['kpi']['itsm_total'], sall['kpi']['itsm_total']))
    check('stats memuat hitungan per daftar', sall['kpi']['itsm_by_list'] == {'request': 1, 'assign': 2}, sall['kpi']['itsm_by_list'])
    check('stats list tidak dikenal diabaikan (jadi semua)', call('/api/stats?range=day&list=ngawur')['kpi']['itsm_total'] == 3)
    check('tren per daftar = tiket yang pernah muncul di daftar itu (riwayat akumulatif)', sum(b['itsm'] for b in sr['buckets']) == 3 and sum(b['itsm'] for b in sa['buckets']) == 2, (sum(b['itsm'] for b in sr['buckets']), sum(b['itsm'] for b in sa['buckets'])))

    # halaman lain dan format lama
    call('/api/sync_helpdesk', {"list": {"title": "Daftar Lain", "path": "/x"}, "tickets": [tk('REQ-7', 'Permohonan baru')]})
    check('halaman tak dikenal masuk daftar "lainnya"', snap()['REQ-7']['itsmLists'] == ['lainnya'])
    call('/api/sync_helpdesk', {"tickets": [tk('REQ-8', 'Permohonan lama tanpa info halaman')]})
    s = snap()
    check('format lama (tanpa info halaman) tetap diterima dan tidak menghapus daftar lain', 'REQ-8' in s and s['REQ-8']['itsmLists'] == ['itsm'] and 'INC-9' in s, s.get('REQ-8', {}).get('itsmLists'))
    # daftar format lama dibuang begitu ada pembacaan halaman bernama (ekstensi sudah diperbarui)
    call('/api/sync_helpdesk', {"list": REQ, "tickets": [tk('REQ-1', 'Permohonan penambahan RAM VM')]})
    check('daftar format lama digantikan saat halaman bernama dibaca', 'itsm' not in {i['key'] for i in call('/api/helpdesk_snapshot')['itsm_lists']} and 'REQ-8' not in snap())
    rep = call('/api/report?kind=daily')
    check('laporan tetap berfungsi dengan banyak daftar', rep['total'] >= 3, rep['total'])
finally:
    proc.terminate(); time.sleep(0.5); shutil.rmtree(T, ignore_errors=True)

print('\nGAGAL:' if fails else '\nSEMUA LULUS', fails or '')
