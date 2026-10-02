import datetime
import os
import sys
import time

sys.dont_write_bytecode = True

# Impor langsung dari modul sentinel_server
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sentinel_server as ss

passed = 0
failed = 0


def check_sla(test_name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"OK   [SLA] {test_name}: {detail}")
    else:
        failed += 1
        print(f"GAGAL [SLA] {test_name}: {detail}")


now = time.time()
fmt_iso = lambda ts: datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")

# 1. Critical (4 jam)
c_ts = now
c_t = {"ticketId": "T-CRIT", "shortDesc": "Down critical", "autoPriority": "Critical", "createdTs": c_ts}
ss.apply_sla(c_t, now)
check_sla("Critical (4h)", c_t["slaLimitHours"] == 4, f"deadline {fmt_iso(c_t['deadlineTs'])}")

# 2. Major (8 jam)
m_ts = now
m_t = {"ticketId": "T-MAJ", "shortDesc": "Server down", "autoPriority": "Major", "createdTs": m_ts}
ss.apply_sla(m_t, now)
check_sla("Major (8h)", m_t["slaLimitHours"] == 8, f"deadline {fmt_iso(m_t['deadlineTs'])}")

# 3. Normal / Minor (24 jam)
n_ts = now
n_t = {"ticketId": "T-NORM", "shortDesc": "Permohonan akun", "autoPriority": "Normal", "createdTs": n_ts}
ss.apply_sla(n_t, now)
check_sla("Normal (24h)", n_t["slaLimitHours"] == 24, f"deadline {fmt_iso(n_t['deadlineTs'])}")

# 4. Response SLA target 15 menit
r_t = {"ticketId": "T-RESP", "shortDesc": "Pertanyaan", "createdTs": now - 10 * 60, "requestState": "Assigned"}
ss.apply_sla(r_t, now)
check_sla("Response <15m", r_t["responseStatus"] == "due" and "Respons dalam" in r_t["responseText"], "target 15m terjaga")

# 5. Response terlambat (>15 menit)
rl_t = {"ticketId": "T-RESPLATE", "shortDesc": "Pertanyaan", "createdTs": now - 20 * 60, "requestState": "Assigned"}
ss.apply_sla(rl_t, now)
check_sla("Response >15m (Breached)", rl_t["responseStatus"] == "late" and any("Respons >15 menit" in f for f in rl_t["escalationFlags"]), "status late terdeteksi")

# 6. SLA Breach (waktu habis)
b_t = {"ticketId": "T-BREACH", "shortDesc": "Down", "autoPriority": "Critical", "createdTs": now - 5 * 3600, "requestState": "Assigned"}
ss.apply_sla(b_t, now)
check_sla("SLA Breach detection", b_t["slaBreached"] is True and b_t["slaBadgeClass"] == "sla-breached", f"lewat {b_t['slaStatusText']}")

# 7. SLA Safe (>50% tersisa)
s_t = {"ticketId": "T-SAFE", "shortDesc": "Normal", "autoPriority": "Normal", "createdTs": now - 2 * 3600, "requestState": "Assigned"}
ss.apply_sla(s_t, now)
check_sla("SLA Safe Tier", s_t["slaBadgeClass"] == "sla-safe" and s_t["slaPercentRemaining"] > 50, f"{s_t['slaPercentRemaining']}% tersisa")

# 8. SLA Warning (25% - 50% tersisa)
w_t = {"ticketId": "T-WARN", "shortDesc": "Normal", "autoPriority": "Normal", "createdTs": now - 14 * 3600, "requestState": "Assigned"}
ss.apply_sla(w_t, now)
check_sla("SLA Warning Tier", w_t["slaBadgeClass"] == "sla-warning" and 25 <= w_t["slaPercentRemaining"] < 50, f"{w_t['slaPercentRemaining']}% tersisa")

# 9. SLA Danger (<25% tersisa)
d_t = {"ticketId": "T-DANGER", "shortDesc": "Normal", "autoPriority": "Normal", "createdTs": now - 20 * 3600, "requestState": "Assigned"}
ss.apply_sla(d_t, now)
check_sla("SLA Danger Tier", d_t["slaBadgeClass"] == "sla-danger" and d_t["slaPercentRemaining"] < 25, f"{d_t['slaPercentRemaining']}% tersisa")

# 10. Status Closed (SLA berhenti)
cl_t = {"ticketId": "T-CLOSED", "shortDesc": "Selesai", "requestState": "Closed", "createdTs": now - 2 * 3600}
ss.apply_sla(cl_t, now)
check_sla("Closed Ticket SLA", cl_t["slaClosed"] is True and cl_t["slaStatusText"] == "Selesai", "SLA ditandai selesai")

# 11. KAK 18.c: IaaS (4 hari 4 jam = 100 jam)
iaas_t = {"ticketId": "T-IAAS", "shortDesc": "Penambahan Core CPU", "autoPriority": "Service Request", "serviceCategory": "IaaS", "createdTs": now}
ss.apply_sla(iaas_t, now)
check_sla("KAK 18.c IaaS (100h)", iaas_t["slaLimitHours"] == 100, f"basis {iaas_t['slaBasis']}")

# 12. KAK 18.c: SecaS (2 hari 0 jam = 48 jam)
sec_t = {"ticketId": "T-SEC", "shortDesc": "Pasang WAF", "autoPriority": "Service Request", "serviceCategory": "SecaS", "createdTs": now}
ss.apply_sla(sec_t, now)
check_sla("KAK 18.c SecaS (48h)", sec_t["slaLimitHours"] == 48, f"basis {sec_t['slaBasis']}")

# 13. KAK 18.c: BaaS (9 hari 6 jam = 222 jam)
baas_t = {"ticketId": "T-BAAS", "shortDesc": "Restore backup", "autoPriority": "Service Request", "serviceCategory": "BaaS", "createdTs": now}
ss.apply_sla(baas_t, now)
check_sla("KAK 18.c BaaS (222h)", baas_t["slaLimitHours"] == 222, f"basis {baas_t['slaBasis']}")

# 14. KAK 18.c: Jaringan (4 hari 2 jam = 98 jam)
net_t = {"ticketId": "T-NET", "shortDesc": "IP Publik", "autoPriority": "Service Request", "serviceCategory": "Layanan Jaringan", "createdTs": now}
ss.apply_sla(net_t, now)
check_sla("KAK 18.c Jaringan (98h)", net_t["slaLimitHours"] == 98, f"basis {net_t['slaBasis']}")

# 15. Pra-tiket WA SLA Mode (Menunggu tiket ITSM)
wa_t = {"ticketId": "WA-001", "shortDesc": "Aduan WA", "isPreTicket": True, "createdTs": now - 300}
ss.apply_sla(wa_t, now)
check_sla("Pra-tiket WA SLA Mode", wa_t["slaMode"] == "pra-tiket" and wa_t["slaStatusText"] == "Menunggu tiket ITSM", "tidak membebani SLA KAK")

print(f"\nTOTAL: {passed} tests PASS, {failed} FAIL")
sys.exit(1 if failed else 0)
