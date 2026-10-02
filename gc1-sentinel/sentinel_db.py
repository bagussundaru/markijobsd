"""
GC 1 Sentinel - SQLite Database Module (100% Lokal di Mini PC)
Menyimpan dan mengelola seluruh tiket hasil pemantauan ITSM (Request & Insiden).
Tanpa data keluar dari Mini PC, aman dan terstruktur.
"""

import json
import os
import sqlite3
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True

APP_DIR = Path(__file__).resolve().parent
DB_PATH = APP_DIR / "sentinel.db"


def get_connection(db_path=None):
    path = db_path or DB_PATH
    conn = sqlite3.connect(str(path), timeout=15)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(db_path=None):
    """Inisialisasi tabel dan indeks SQLite."""
    conn = get_connection(db_path)
    try:
        with conn:
            conn.execute("""
            CREATE TABLE IF NOT EXISTS itsm_tickets (
                ticket_id TEXT PRIMARY KEY,
                service_type TEXT NOT NULL,       -- 'Request' atau 'Insiden'
                itsm_list TEXT NOT NULL,          -- 'request' atau 'incident'
                short_desc TEXT,
                requested_for TEXT,
                request_state TEXT,
                created_date TEXT,
                created_ts REAL,
                location TEXT,
                assignment_group TEXT,
                resolver_layer TEXT,
                priority TEXT,
                sla_limit_hours REAL,
                sla_remaining_seconds REAL,
                sla_status_text TEXT,
                deadline_ts REAL,
                closed_ts REAL,
                is_gc1 INTEGER DEFAULT 1,
                is_telkom INTEGER DEFAULT 0,
                is_manual INTEGER DEFAULT 0,
                raw_json TEXT,
                first_seen_ts REAL,
                last_seen_ts REAL
            );
            """)

            try:
                conn.execute("ALTER TABLE itsm_tickets ADD COLUMN is_manual INTEGER DEFAULT 0;")
            except sqlite3.OperationalError:
                pass

            conn.execute("""
            CREATE TABLE IF NOT EXISTS itsm_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id TEXT NOT NULL,
                timestamp REAL NOT NULL,
                event_type TEXT NOT NULL,
                detail TEXT,
                FOREIGN KEY (ticket_id) REFERENCES itsm_tickets (ticket_id)
            );
            """)

            conn.execute("""
            CREATE TABLE IF NOT EXISTS sync_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sync_time REAL NOT NULL,
                list_key TEXT,
                ticket_count INTEGER,
                source_url TEXT
            );
            """)

            # Indeks untuk query performa tinggi
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tickets_type ON itsm_tickets(service_type);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tickets_list ON itsm_tickets(itsm_list);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tickets_state ON itsm_tickets(request_state);")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_history_ticket ON itsm_history(ticket_id);")
    finally:
        conn.close()


def normalize_service_type(ticket_id, short_desc="", list_key=""):
    """
    Normalisasi jenis tiket secara ketat:
    - 'Insiden' (tiket gangguan/incident)
    - 'Request' (tiket permohonan/service request)
    """
    tid = str(ticket_id or "").upper().strip()
    lk = str(list_key or "").lower().strip()
    desc = str(short_desc or "").lower()

    if tid.startswith("INC") or lk == "incident" or "insiden" in lk or "gangguan" in lk or "assign" in lk:
        return "Insiden"
    if tid.startswith("REQ") or tid.startswith("RITM") or lk == "request" or "permohonan" in lk:
        return "Request"

    incident_keywords = [
        "down", "mati", "error", "gangguan", "rusak", "unreachable", "crash",
        "putus", "darurat", "critical", "masalah", "kendala", "latensi", "lambat",
        "gagal", "incident", "insiden", "skm", "problem", "waf block", "terblokir", "padam"
    ]
    if any(k in desc for k in incident_keywords):
        return "Insiden"

    return "Request"


def save_tickets_to_db(tickets, list_key=None, source_url="", db_path=None):
    """
    Menyimpan atau memperbarui sekumpulan tiket hasil pembacaan ITSM ke SQLite.
    Mencatat histori status dan log sinkronisasi secara otomatis.
    """
    if not tickets:
        return 0

    conn = get_connection(db_path)
    now = time.time()
    saved_count = 0

    try:
        with conn:
            for t in tickets:
                raw_id = t.get("ticketId") or t.get("number") or t.get("ticketNumber") or ""
                tid = str(raw_id).replace("📋", "").strip()
                if not tid:
                    continue

                desc = str(t.get("shortDesc") or t.get("desc") or "").strip()
                req_for = str(t.get("requestedFor") or "").strip()
                state = str(t.get("requestState") or t.get("state") or "Assigned").replace("●", "").strip()
                date_val = str(t.get("createdDate") or t.get("date") or "").strip()
                loc_val = str(t.get("location") or "").strip()
                grp_val = str(t.get("assignmentGroup") or t.get("group") or "").strip()
                layer = str(t.get("resolverLayer") or "Helpdesk (L0)").strip()
                prio = str(t.get("priority") or "Minor").strip()

                # Tentukan service_type dan itsm_list
                st = t.get("serviceType") or normalize_service_type(tid, desc, list_key)
                if "insiden" in st.lower() or "incident" in st.lower():
                    clean_service_type = "Insiden"
                    clean_itsm_list = "incident"
                else:
                    clean_service_type = "Request"
                    clean_itsm_list = "request"

                if list_key in ("incident", "request"):
                    clean_itsm_list = list_key

                created_ts = float(t.get("createdTs") or now)
                deadline_ts = float(t.get("deadlineTs") or (created_ts + 24 * 3600))
                closed_ts = float(t["closedSeenTs"]) if t.get("closedSeenTs") else None
                sla_hours = float(t.get("slaLimitHours") or 24.0)
                sla_rem_sec = float(t.get("slaRemainingSeconds") or (deadline_ts - now))
                sla_status_text = str(t.get("slaStatusText") or "Aktif")
                is_gc1 = 1 if t.get("isGc1", True) else 0
                is_telkom = 1 if t.get("isTelkom", False) else 0
                is_manual = 1 if (t.get("isManual") or t.get("is_manual") or "manual" in str(source_url).lower()) else 0

                # Periksa apakah tiket sudah ada untuk mendeteksi perubahan status
                cur = conn.execute("SELECT request_state, first_seen_ts, is_manual FROM itsm_tickets WHERE ticket_id = ?", (tid,))
                existing = cur.fetchone()

                if existing:
                    first_seen = existing["first_seen_ts"]
                    old_state = existing["request_state"]
                    if old_state.lower() != state.lower():
                        conn.execute(
                            "INSERT INTO itsm_history (ticket_id, timestamp, event_type, detail) VALUES (?, ?, ?, ?)",
                            (tid, now, "STATUS_CHANGE", f"Status berubah dari '{old_state}' menjadi '{state}'")
                        )
                else:
                    first_seen = now
                    evt = "MANUAL_ENTRY" if is_manual else "TICKET_CAPTURED"
                    det = f"Tiket manual ditambahkan ke sistem ({clean_service_type})" if is_manual else f"Tiket baru terdeteksi di submenu '{clean_itsm_list}' ({clean_service_type})"
                    conn.execute(
                        "INSERT INTO itsm_history (ticket_id, timestamp, event_type, detail) VALUES (?, ?, ?, ?)",
                        (tid, now, evt, det)
                    )

                raw_json = json.dumps(t, ensure_ascii=False)

                conn.execute("""
                INSERT INTO itsm_tickets (
                    ticket_id, service_type, itsm_list, short_desc, requested_for,
                    request_state, created_date, created_ts, location, assignment_group,
                    resolver_layer, priority, sla_limit_hours, sla_remaining_seconds,
                    sla_status_text, deadline_ts, closed_ts, is_gc1, is_telkom, is_manual,
                    raw_json, first_seen_ts, last_seen_ts
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                )
                ON CONFLICT(ticket_id) DO UPDATE SET
                    service_type = excluded.service_type,
                    itsm_list = excluded.itsm_list,
                    short_desc = excluded.short_desc,
                    requested_for = excluded.requested_for,
                    request_state = excluded.request_state,
                    created_date = excluded.created_date,
                    created_ts = excluded.created_ts,
                    location = excluded.location,
                    assignment_group = excluded.assignment_group,
                    resolver_layer = excluded.resolver_layer,
                    priority = excluded.priority,
                    sla_limit_hours = excluded.sla_limit_hours,
                    sla_remaining_seconds = excluded.sla_remaining_seconds,
                    sla_status_text = excluded.sla_status_text,
                    deadline_ts = excluded.deadline_ts,
                    closed_ts = excluded.closed_ts,
                    is_gc1 = excluded.is_gc1,
                    is_telkom = excluded.is_telkom,
                    is_manual = CASE WHEN excluded.is_manual = 1 THEN 1 ELSE itsm_tickets.is_manual END,
                    raw_json = excluded.raw_json,
                    last_seen_ts = excluded.last_seen_ts
                """, (
                    tid, clean_service_type, clean_itsm_list, desc, req_for,
                    state, date_val, created_ts, loc_val, grp_val,
                    layer, prio, sla_hours, sla_rem_sec,
                    sla_status_text, deadline_ts, closed_ts, is_gc1, is_telkom, is_manual,
                    raw_json, first_seen, now
                ))
                saved_count += 1

            conn.execute(
                "INSERT INTO sync_logs (sync_time, list_key, ticket_count, source_url) VALUES (?, ?, ?, ?)",
                (now, list_key or "unknown", saved_count, source_url or "")
            )
    finally:
        conn.close()

    return saved_count


def get_manual_tickets(db_path=None):
    """Mengambil daftar tiket yang dimasukkan secara manual dari SQLite."""
    conn = get_connection(db_path)
    try:
        cur = conn.execute("""
            SELECT ticket_id, service_type, itsm_list, short_desc, requested_for,
                   request_state, created_date, location, assignment_group, priority,
                   first_seen_ts, last_seen_ts, raw_json
            FROM itsm_tickets
            WHERE is_manual = 1
            ORDER BY first_seen_ts DESC
        """)
        rows = cur.fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if d.get("raw_json"):
                try:
                    loaded = json.loads(d["raw_json"])
                    loaded["isManual"] = True
                    result.append(loaded)
                    continue
                except Exception:
                    pass
            d["isManual"] = True
            result.append(d)
        return result
    finally:
        conn.close()


def get_all_tickets_from_db(service_type=None, itsm_list=None, db_path=None):
    """Mengambil seluruh tiket dari database SQLite, dengan opsi filter service_type / itsm_list."""
    conn = get_connection(db_path)
    tickets = []
    try:
        query = "SELECT * FROM itsm_tickets WHERE is_telkom = 0"
        params = []
        if service_type:
            query += " AND LOWER(service_type) = LOWER(?)"
            params.append(service_type)
        if itsm_list:
            query += " AND LOWER(itsm_list) = LOWER(?)"
            params.append(itsm_list)
        query += " ORDER BY last_seen_ts DESC"

        cur = conn.execute(query, params)
        for row in cur.fetchall():
            d = dict(row)
            if d.get("raw_json"):
                try:
                    loaded = json.loads(d["raw_json"])
                    loaded["serviceType"] = d["service_type"]
                    loaded["itsmList"] = d["itsm_list"]
                    tickets.append(loaded)
                    continue
                except Exception:
                    pass
            tickets.append({
                "ticketId": d["ticket_id"],
                "serviceType": d["service_type"],
                "itsmList": d["itsm_list"],
                "shortDesc": d["short_desc"],
                "requestedFor": d["requested_for"],
                "requestState": d["request_state"],
                "createdDate": d["created_date"],
                "createdTs": d["created_ts"],
                "location": d["location"],
                "assignmentGroup": d["assignment_group"],
                "resolverLayer": d["resolver_layer"],
                "priority": d["priority"],
                "slaLimitHours": d["sla_limit_hours"],
                "slaRemainingSeconds": d["sla_remaining_seconds"],
                "slaStatusText": d["sla_status_text"],
                "deadlineTs": d["deadline_ts"],
                "isGc1": bool(d["is_gc1"]),
                "isTelkom": bool(d["is_telkom"])
            })
    finally:
        conn.close()
    return tickets


def get_db_stats(db_path=None):
    """Statistik cepat isi database SQLite."""
    conn = get_connection(db_path)
    try:
        cur = conn.execute("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN LOWER(service_type) = 'insiden' THEN 1 ELSE 0 END) as incident_count,
            SUM(CASE WHEN LOWER(service_type) = 'request' THEN 1 ELSE 0 END) as request_count,
            SUM(CASE WHEN LOWER(request_state) LIKE '%assign%' THEN 1 ELSE 0 END) as assigned_count,
            SUM(CASE WHEN LOWER(request_state) LIKE '%pending%' THEN 1 ELSE 0 END) as pending_count,
            SUM(CASE WHEN LOWER(request_state) LIKE '%progress%' THEN 1 ELSE 0 END) as progress_count,
            SUM(CASE WHEN LOWER(request_state) LIKE '%hold%' THEN 1 ELSE 0 END) as on_hold_count
        FROM itsm_tickets WHERE is_telkom = 0
        """)
        row = cur.fetchone()
        return {
            "total": row["total"] or 0,
            "incident_count": row["incident_count"] or 0,
            "request_count": row["request_count"] or 0,
            "assigned_count": row["assigned_count"] or 0,
            "pending_count": row["pending_count"] or 0,
            "progress_count": row["progress_count"] or 0,
            "on_hold_count": row["on_hold_count"] or 0,
            "db_path": str(db_path or DB_PATH)
        }
    finally:
        conn.close()


def clear_db(db_path=None):
    """Mengosongkan seluruh isi data tiket di SQLite."""
    init_db(db_path)
    conn = get_connection(db_path)
    try:
        with conn:
            conn.execute("DELETE FROM itsm_history;")
            conn.execute("DELETE FROM itsm_tickets;")
            conn.execute("DELETE FROM sync_logs;")
        conn.isolation_level = None
        conn.execute("VACUUM;")
        return True
    finally:
        conn.close()


# Inisialisasi database saat modul diimpor
init_db()
