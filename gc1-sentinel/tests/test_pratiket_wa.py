import sys
sys.dont_write_bytecode = True
import json, subprocess, sys, time, os, shutil, urllib.request, tempfile

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = tempfile.mkdtemp(prefix='st_pre_')
for f in os.listdir(SRC):
    if f.endswith(('.py', '.html', '.js', '.css')):
        shutil.copy(os.path.join(SRC, f), T)
PORT = 8799
json.dump({"server_port": PORT}, open(os.path.join(T, 'config.json'), 'w'))
proc = subprocess.Popen([sys.executable, 'sentinel_server.py'], cwd=T, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2)
B = f'http://127.0.0.1:{PORT}'


def call(path, body=None):
    req = urllib.request.Request(B + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Content-Type': 'application/json'}, method='POST' if body is not None else 'GET')
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode() or '{}')


fails = []


def check(name, cond, extra=''):
    print(('OK   ' if cond else 'GAGAL'), name, '' if cond else extra)
    if not cond:
        fails.append(name)


now = int(time.time())


def wa(mins_ago, text, mid):
    return call('/api/add_wa_ticket', {"sender": f"Pelapor {mid}", "group": "Grup GC 1", "text": text, "msgId": mid, "manual": True,
                                        "enteredBy": "Siti Rahma", "waTs": now - mins_ago * 60})['ticket']['ticketId']


def snap():
    return {t['ticketId']: t for t in call('/api/helpdesk_snapshot')['all_tickets']}


try:
    a = wa(2, 'VM kami tidak bisa diakses', 'a')
    b = wa(6, 'Mohon bantuan website down', 'b')
    c = wa(11, 'Server kami error 500', 'c')
    d = wa(16, 'Aplikasi down mohon bantuan', 'd')
    e = wa(3, 'VM down, tiket kami REQ-KMF-092026-0099999', 'e')
    s = snap()
    check('pra-tiket: mode & teks SLA', all(s[x]['slaMode'] == 'pra-tiket' for x in (a, b, c, d)) and s[a]['slaStatusText'] == 'Menunggu tiket ITSM', s[a]['slaStatusText'])
    check('pra-tiket: tidak ada penanda SLA penyelesaian', not any('SLA' in f and 'ITSM' not in f for f in s[a]['escalationFlags'] if 'Balasan' not in f and 'tiket' not in f.lower()), s[a]['escalationFlags'])
    check('2 menit: balas dalam ... (due), tanpa penanda balasan', s[a]['responseStatus'] == 'due' and not any('Balasan' in f for f in s[a]['escalationFlags']), (s[a]['responseStatus'], s[a]['escalationFlags']))
    check('6 menit: warn + penanda', s[b]['responseStatus'] == 'warn' and any('Balasan WA belum dikirim' in f for f in s[b]['escalationFlags']), (s[b]['responseStatus'], s[b]['escalationFlags']))
    check('11 menit: late + penanda terlambat', s[c]['responseStatus'] == 'late' and any('terlambat' in f for f in s[c]['escalationFlags']), (s[c]['responseStatus'], s[c]['escalationFlags']))
    check('16 menit tanpa tiket ITSM: penanda minta buka tiket', any('Belum ada tiket di ITSM' in f for f in s[d]['escalationFlags']), s[d]['escalationFlags'])
    check('menyebut nomor tiket: tidak diminta buka tiket lagi', s[e]['slaStatusText'].startswith('Tiket ITSM REQ-') and not any('Belum ada tiket di ITSM' in f for f in s[e]['escalationFlags']), s[e]['slaStatusText'])
    snp = call('/api/helpdesk_snapshot')
    check('SLA health 100% walau pra-tiket lama (tidak dihitung)', snp['sla_health_percent'] == 100 and snp['sla_breached_count'] == 0, (snp['sla_health_percent'], snp['sla_breached_count']))
    check('pra-tiket tetap muncul di eskalasi (balasan)', snp['escalation_count'] >= 3, snp['escalation_count'])

    # ack -> balasan tercatat
    call('/api/ticket_action', {"ticketId": b, "action": "ack", "by": "Siti Rahma", "note": "Balasan WA terkirim"})
    call('/api/ticket_action', {"ticketId": c, "action": "ack", "by": "Siti Rahma", "note": "Balasan WA terkirim"})
    s = snap()
    check('dibalas di 6 menit: ok', s[b]['responseStatus'] == 'ok' and 'Dibalas 6 menit' in s[b]['responseText'], s[b]['responseText'])
    check('dibalas di 11 menit: lewat target', s[c]['responseStatus'] == 'late' and 'lewat target' in s[c]['responseText'], s[c]['responseText'])

    # tiket ITSM: SLA resmi tetap jalan seperti biasa
    call('/api/sync_helpdesk', {"tickets": [
        {"ticketId": "REQ-OLD", "shortDesc": "Website tenan down", "requestedFor": "x", "requestState": "Assigned", "createdDate": time.strftime("%d %b %Y %H:%M:%S WIB", time.localtime(now - 9*3600)), "location": "BPS", "assignmentGroup": "EOS L1"},
        {"ticketId": "REQ-OK", "shortDesc": "Permohonan reset password", "requestedFor": "y", "requestState": "Closed", "createdDate": "01 Okt 2026 08:00:00 WIB", "location": "BPS", "assignmentGroup": "EOS L1"}]})
    s = snap(); snp = call('/api/helpdesk_snapshot')
    check('ITSM lama (Major >8 jam) tetap melewati SLA resmi', s['REQ-OLD']['slaBreached'] is True and not s['REQ-OLD']['slaMode'], s['REQ-OLD']['slaStatusText'])
    check('SLA health turun karena tiket ITSM, bukan pra-tiket', snp['sla_breached_count'] == 1 and snp['sla_health_percent'] == 0, (snp['sla_breached_count'], snp['sla_health_percent']))

    rep = call('/api/report?kind=weekly&date=' + time.strftime('%Y-%m-%d'))
    check('laporan: total hanya tiket ITSM', rep['total'] == 2, rep['total'])
    check('laporan: SLA hanya tiket ITSM (1 tepat waktu, 1 lewat)', rep['sla_outcomes']['Tepat waktu'] == 1 and rep['sla_outcomes']['Lewat SLA (masih terbuka)'] == 1 and rep['sla_compliance_pct'] == 50.0, (rep['sla_outcomes'], rep['sla_compliance_pct']))
    check('laporan: pra-tiket dihitung terpisah', rep['wa_total'] == 5 and rep['by_source'].get('Pra-tiket WA') == 5 and rep['by_source'].get('Portal ITSM') == 2, (rep['wa_total'], rep['by_source']))
    check('laporan: balasan WA dalam target', rep['wa_reply_known'] == 2 and rep['wa_reply_within_target_pct'] == 50.0 and rep['wa_reply_unknown'] == 3, (rep['wa_reply_known'], rep['wa_reply_within_target_pct']))
    csvtxt = urllib.request.urlopen(B + '/api/export.csv', timeout=10).read().decode('utf-8-sig')
    check('CSV: pra-tiket tidak dinilai SLA', 'Pra-tiket (SLA resmi dari tiket ITSM)' in csvtxt)
finally:
    proc.terminate(); time.sleep(0.5); shutil.rmtree(T, ignore_errors=True)

print('\nGAGAL:' if fails else '\nSEMUA LULUS', fails or '')
