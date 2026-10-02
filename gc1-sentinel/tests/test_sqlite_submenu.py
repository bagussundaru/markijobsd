"""
Uji Otomatis: SQLite Database Module & Pemisahan Submenu (Tiket Request vs Tiket Insiden).
100% Lokal di Mini PC, memverifikasi penyimpanan SQLite, histori perubahan status, dan segregasi submenu.
"""

import json
import os
import shutil
import sys
import tempfile
import time

sys.dont_write_bytecode = True

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

import sentinel_db

fails = []


def check(name, cond, extra=""):
    print(("OK   " if cond else "GAGAL"), name, "" if cond else str(extra))
    if not cond:
        fails.append(name)


test_dir = tempfile.mkdtemp(prefix="sentinel_sqlite_test_")
db_path = os.path.join(test_dir, "test_sentinel.db")

try:
    sentinel_db.init_db(db_path)
    check("Inisialisasi tabel dan indeks SQLite", os.path.exists(db_path))

    # 1. Normalisasi service_type
    check("Normalisasi INC -> Insiden", sentinel_db.normalize_service_type("INC0012345") == "Insiden")
    check("Normalisasi REQ -> Request", sentinel_db.normalize_service_type("REQ0098765") == "Request")
    check("Normalisasi RITM -> Request", sentinel_db.normalize_service_type("RITM0054321") == "Request")
    check("Normalisasi list_key incident -> Insiden", sentinel_db.normalize_service_type("T-01", "", "incident") == "Insiden")
    check("Normalisasi list_key request -> Request", sentinel_db.normalize_service_type("T-02", "", "request") == "Request")
    check("Normalisasi list_key permohonan -> Request", sentinel_db.normalize_service_type("T-03", "", "permohonan") == "Request")
    check("Normalisasi list_key gangguan -> Insiden", sentinel_db.normalize_service_type("T-04", "", "gangguan") == "Insiden")
    check("Normalisasi keyword down -> Insiden", sentinel_db.normalize_service_type("GEN-01", "Server hypervisor padam dan VM down") == "Insiden")
    check("Normalisasi keyword akun -> Request", sentinel_db.normalize_service_type("GEN-02", "Permohonan akun akses backup") == "Request")

    # 2. Penyimpanan dan pengambilan tiket SQLite
    now = time.time()
    sample_tickets = [
        {
            "ticketId": "REQ-KMF-001",
            "shortDesc": "Permohonan vCPU dan RAM VM di GC 1",
            "requestedFor": "Budi Santoso",
            "requestState": "Assigned",
            "createdDate": "02 Okt 2026 09:00:00 WIB",
            "createdTs": now - 3600,
            "location": "Kemenkes",
            "assignmentGroup": "Helpdesk",
            "serviceType": "Request"
        },
        {
            "ticketId": "INC-KMF-002",
            "shortDesc": "Kendala jaringan latensi tinggi portal layanan",
            "requestedFor": "Siti Rahma",
            "requestState": "Assigned",
            "createdDate": "02 Okt 2026 09:15:00 WIB",
            "createdTs": now - 1800,
            "location": "BPS",
            "assignmentGroup": "EOS L1",
            "serviceType": "Insiden"
        },
        {
            "ticketId": "REQ-TEL-999",
            "shortDesc": "Tiket alokasi Telkom eksternal",
            "requestedFor": "Operator",
            "requestState": "Assigned",
            "assignmentGroup": "Telkom L2",
            "isTelkom": True,
            "serviceType": "Request"
        }
    ]

    saved = sentinel_db.save_tickets_to_db(sample_tickets, list_key="incident", db_path=db_path)
    check("Penyimpanan batch tiket ke SQLite", saved == 3, saved)

    all_t = sentinel_db.get_all_tickets_from_db(db_path=db_path)
    check("Telkom diabaikan dari tiket aktif tim kita", len(all_t) == 2 and "REQ-TEL-999" not in [t["ticketId"] for t in all_t], len(all_t))

    reqs = sentinel_db.get_all_tickets_from_db(service_type="Request", db_path=db_path)
    check("Filter SQLite berdasarkan service_type='Request'", len(reqs) == 1 and reqs[0]["ticketId"] == "REQ-KMF-001", len(reqs))

    incs = sentinel_db.get_all_tickets_from_db(service_type="Insiden", db_path=db_path)
    check("Filter SQLite berdasarkan service_type='Insiden'", len(incs) == 1 and incs[0]["ticketId"] == "INC-KMF-002", len(incs))

    # 3. Histori perubahan status di itsm_history
    t_hist_update = [{
        "ticketId": "INC-KMF-002",
        "shortDesc": "Kendala jaringan latensi tinggi",
        "requestState": "In Progress",
        "createdTs": now - 1800
    }]
    sentinel_db.save_tickets_to_db(t_hist_update, list_key="incident", db_path=db_path)

    conn = sentinel_db.get_connection(db_path)
    try:
        cur = conn.execute("SELECT * FROM itsm_history WHERE ticket_id = 'INC-KMF-002' ORDER BY id ASC")
        rows = cur.fetchall()
        check("Pencatatan histori status tiket di itsm_history", len(rows) == 2 and rows[1]["event_type"] == "STATUS_CHANGE", len(rows))
    finally:
        conn.close()

    # 4. Statistik database SQLite
    stats = sentinel_db.get_db_stats(db_path)
    check("Statistik cepat get_db_stats SQLite", stats["total"] == 2 and stats["incident_count"] == 1 and stats["request_count"] == 1, stats)

    # 5. Pembersihan data clear_db
    sentinel_db.clear_db(db_path)
    all_after_clear = sentinel_db.get_all_tickets_from_db(db_path=db_path)
    stats_after_clear = sentinel_db.get_db_stats(db_path)
    check("Pembersihan database SQLite (clear_db)", len(all_after_clear) == 0 and stats_after_clear["total"] == 0, stats_after_clear)

finally:
    shutil.rmtree(test_dir, ignore_errors=True)

print("\nGAGAL:" if fails else "\nSEMUA LULUS", fails or "")
sys.exit(1 if fails else 0)
