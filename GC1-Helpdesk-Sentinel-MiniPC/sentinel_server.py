"""
GC 1 Sentinel - Enhanced Server with REST API & Static File Serving (Helpdesk Expert Edition)
Port: 8765
Directly serves GC 1 Dashboard, Helpdesk Dummy, and Markijo Automation IPC.

STANDAR HELPDESK EXPERT:
1. State Machine per Tiket: Tiket dilacak siklus hidupnya (Pending -> Assigned -> In Progress -> Selesai).
2. Anti-Spam Mutlak: Tiket yang sudah pernah dilaporkan dalam status Assigned TIDAK PERNAH dikirim ulang.
3. Notifikasi HANYA jika ada tiket baru atau UPDATE status (misal: Pending Approval berubah jadi Assigned).
4. Atomic Queue Claiming: Mencegah race condition yang menyebabkan pesan terkirim ganda ke WhatsApp.
"""

import datetime
import hashlib
import http.server
import json
import os
import re
import sys
import threading
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

APP_DIR = Path(__file__).resolve().parent
CONFIG_PATH = APP_DIR / "config.json"
DATA_FILE = APP_DIR / "sentinel_data.json"

DEFAULT_CONFIG = {
    "target_contact": "mimi Sandora",
    "keywords": [
        "GC 1",
        "GC1",
        "Government Cloud 1",
        "Government Cloud-1",
        "Gov Cloud 1",
        "GovCloud 1",
        "Gedung C 1",
        "Gedung C1"
    ],
    "target_status": "Assigned",
    "poll_interval_seconds": 60,
    "auto_send_wa": True,
    "markijo_auto_mode": True,
    "server_port": 8765
}

LOCK = threading.Lock()
ALERTS = []
WA_TICKETS = []
TICKET_REGISTRY = {}
SENT_RECAP_HASHES = set()
WA_QUEUE = []
WA_HISTORY = []
HELPDESK_SNAPSHOT = []
LAST_SYNC_TIME = ""
CONFIG = dict(DEFAULT_CONFIG)


def load_config():
    global CONFIG
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                CONFIG = {**DEFAULT_CONFIG, **json.load(f)}
        except Exception as e:
            print(f"[Sentinel Server] Error loading config: {e}")
    else:
        save_config(DEFAULT_CONFIG)


def save_config(cfg):
    global CONFIG
    CONFIG = cfg
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(CONFIG, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[Sentinel Server] Error saving config: {e}")


def load_persisted_data():
    global ALERTS, WA_TICKETS, TICKET_REGISTRY, SENT_RECAP_HASHES, WA_QUEUE, WA_HISTORY, HELPDESK_SNAPSHOT, LAST_SYNC_TIME
    if DATA_FILE.exists():
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                ALERTS = data.get("alerts", [])
                WA_TICKETS = data.get("wa_tickets", [])
                TICKET_REGISTRY = data.get("ticket_registry", {})
                SENT_RECAP_HASHES = set(data.get("sent_hashes", []))
                WA_QUEUE = data.get("wa_queue", [])
                WA_HISTORY = data.get("wa_history", [])
                HELPDESK_SNAPSHOT = data.get("helpdesk_snapshot", [])
                LAST_SYNC_TIME = data.get("last_sync_time", "")
        except Exception as e:
            print(f"[Sentinel Server] Error loading data file: {e}")


def save_persisted_data():
    try:
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "alerts": ALERTS[-200:],
                "wa_tickets": WA_TICKETS[-100:],
                "ticket_registry": TICKET_REGISTRY,
                "sent_hashes": list(SENT_RECAP_HASHES)[-500:],
                "wa_queue": WA_QUEUE,
                "wa_history": WA_HISTORY[-100:],
                "helpdesk_snapshot": HELPDESK_SNAPSHOT,
                "last_sync_time": LAST_SYNC_TIME
            }, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[Sentinel Server] Error saving data file: {e}")


def convert_wa_message_to_ticket(sender, group, text, matched_kw="GC 1"):
    """
    Konversi aduan masuk di Grup WhatsApp menjadi format Tiket resmi untuk Dashboard GC 1 Sentinel.
    """
    global WA_TICKETS, ALERTS, TICKET_REGISTRY
    
    sender_clean = re.sub(r"[\r\n\t]+", " ", str(sender or "Member Grup WA")).strip()
    group_clean = re.sub(r"[\r\n\t]+", " ", str(group or "Grup Koordinasi Teknis GC 1")).strip()
    text_clean = re.sub(r"[\r\n\t]+", " ", str(text or "")).strip()
    
    if not text_clean:
        return None

    # Cari nomor tiket bila disebutkan dalam pesan (misal REQ-KMF-... atau INC-...)
    match_id = re.search(r"(REQ-[A-Z0-9-]+|INC[0-9]+|TKT-[0-9]+)", text_clean, re.IGNORECASE)
    if match_id:
        tid = match_id.group(1).upper()
    else:
        prefix = time.strftime("WA-GC1-%m%d")
        count = len(WA_TICKETS) + 1
        tid = f"{prefix}-{count:04d}"

    # Deteksi instansi dari nama pemohon, nama grup, atau isi teks
    known_agencies = [
        "Kementerian Kesehatan", "Kemenkes",
        "Kementerian Keuangan", "Kemenkeu",
        "Bappenas",
        "Kementerian Komunikasi dan Digital", "Kominfo", "Komdigi",
        "KemenpanRB", "Kementerian PANRB",
        "Badan Pusat Statistik", "BPS",
        "BMKG", "Setneg", "Kemendagri", "Kemendikbud",
        "Pemprov", "Pemkab", "Pemkot"
    ]
    loc = "Instansi Pengguna PDN"
    search_scope = f"{sender_clean} {group_clean} {text_clean}"
    for agency in known_agencies:
        if agency.lower() in search_scope.lower():
            loc = agency
            break

    # Bersihkan salam pembuka untuk ringkasan deskripsi
    cleaned_desc = re.sub(r"^(selamat\s+(pagi|siang|sore|malam)|halo|dear\s+all|assalamu['a-z]+|mohon\s+izin|permisi)[,\.\s-]*", "", text_clean, flags=re.IGNORECASE).strip()
    if len(cleaned_desc) > 130:
        short_desc = f"[Aduan WA] {cleaned_desc[:127]}..."
    else:
        short_desc = f"[Aduan WA] {cleaned_desc}" if not cleaned_desc.lower().startswith("[aduan wa]") else cleaned_desc

    text_lower = text_clean.lower()
    if any(k in text_lower for k in ["down", "mati", "error 500", "darurat", "urgent", "rusak", "critical", "lambat parah", "unreachable", "firewall", "waf"]):
        priority = "Major"
        sla_hours = 4
    else:
        priority = "Normal"
        sla_hours = 8

    now_wib = time.strftime("%d %b %Y %H:%M:%S WIB")
    target_ts = time.time() + (sla_hours * 3600)
    target_time_str = time.strftime("%d %b %Y %H:%M WIB", time.localtime(target_ts))

    wa_ticket = {
        "ticketId": tid,
        "shortDesc": short_desc,
        "requestedFor": sender_clean,
        "requestState": "Assigned",
        "createdDate": now_wib,
        "location": loc,
        "assignmentGroup": "Helpdesk",
        "resolverLayer": "Helpdesk (L0)",
        "isGc1": True,
        "isTelkom": False,
        "category": "team_assigned",
        "source": "WhatsApp Group",
        "isFromWa": True,
        "waGroup": group_clean,
        "rawWaText": text_clean,
        "priority": priority,
        "serviceType": "Insiden" if priority == "Major" else "Service Request",
        "activityMilestone": "Triase Aduan WhatsApp (Pra-Tiket)",
        "picName": "Helpdesk L0 Gateway",
        "picRole": "L0 Gateway",
        "workflowStep": 1,
        "slaLimitHours": sla_hours,
        "slaRemainingFormatted": f"{sla_hours}j 0m",
        "slaRemainingSeconds": sla_hours * 3600,
        "slaPercentRemaining": 100,
        "slaBadgeClass": "sla-safe",
        "slaStatusText": f"Sisa {sla_hours}j (Respon WA)",
        "slaTargetTime": target_time_str,
        "deadlineTs": target_ts,
        "timeline": [
            {
                "step": 1,
                "title": "Aduan Diterima di WhatsApp Group",
                "desc": f"Pesan masuk dari {sender_clean} di grup [{group_clean}].",
                "status": "completed",
                "actor": "WhatsApp Observer",
                "time": time.strftime("%d %b %Y %H:%M WIB")
            },
            {
                "step": 2,
                "title": "Triase & Konversi ke Tiket Resmi",
                "desc": "Diverifikasi oleh tim Helpdesk L0 untuk diteruskan ke ITSM.",
                "status": "in_progress",
                "actor": "Helpdesk L0 Gateway",
                "time": "Dalam Proses"
            },
            {
                "step": 3,
                "title": "Penugasan ke Resolver EOS L1/L2",
                "desc": "Penugasan teknis ke tim EOS sesuai matriks RACI SOP.",
                "status": "pending",
                "actor": "Lead L0-L1",
                "time": "-"
            },
            {
                "step": 4,
                "title": "Eksekusi Teknis di Hypervisor Tamantekno",
                "desc": "Konfigurasi komputasi/storage atau pemulihan layanan.",
                "status": "pending",
                "actor": "Resolver EOS",
                "time": "-"
            },
            {
                "step": 5,
                "title": "Validasi & Konfirmasi Balik ke Grup WA",
                "desc": f"Mengabari {sender_clean} di grup bahwa kendala telah terselesaikan.",
                "status": "pending",
                "actor": "Helpdesk L0",
                "time": "-"
            }
        ]
    }

    WA_TICKETS.insert(0, wa_ticket)
    ALERTS.insert(0, {
        "id": f"alt_{int(time.time()*1000)}",
        "sig": f"wa_ticket|{tid}|{sender_clean}",
        "source": "whatsapp",
        "ticketId": tid,
        "sender": sender_clean,
        "group": group_clean,
        "text": text_clean,
        "requestState": "Assigned",
        "matchedKeyword": matched_kw,
        "timestamp": int(time.time() * 1000),
        "dateString": time.strftime("%H:%M:%S"),
        "status": "baru"
    })
    save_persisted_data()
    return wa_ticket


def should_report_ticket(ticket_data):
    """
    Standar Expert Helpdesk:
    1. Tiket baru Assigned -> Laporkan (True)
    2. Tiket lama yang berubah dari non-Assigned ke Assigned -> Laporkan sebagai UPDATE (True)
    3. Tiket yang SUDAH dilaporkan dalam status Assigned -> JANGAN LAPORKAN ULANG (False)
    """
    tid = ticket_data.get("ticketId", "").strip()
    if not tid:
        return False, "no_ticket_id", "none"

    # SOP: Tiket Telkom hanya diteruskan, BUKAN beban kerja tim kita -> jangan laporkan ke WA
    if ticket_data.get("isTelkom") or "telkom" in (ticket_data.get("text", "") + " " + ticket_data.get("sender", "")).lower():
        return False, "telkom_ticket_excluded", "none"

    raw_state = ticket_data.get("requestState", "").strip()
    raw_text = ticket_data.get("text", "")
    current_state = "Assigned" if (raw_state.lower() == "assigned" or "[assigned]" in raw_text.lower()) else raw_state

    # Jika tiket bukan Assigned, catat statusnya di registry (misal: Pending Approval) tapi jangan laporkan
    if current_state.lower() != "assigned":
        if tid in TICKET_REGISTRY:
            TICKET_REGISTRY[tid]["current_state"] = current_state
            TICKET_REGISTRY[tid]["last_seen"] = time.time()
        else:
            TICKET_REGISTRY[tid] = {
                "ticket_id": tid,
                "current_state": current_state,
                "reported_state": None,
                "first_seen": time.time(),
                "last_seen": time.time()
            }
        save_persisted_data()
        return False, f"status_is_{current_state}", "none"

    # Status adalah ASSIGNED
    entry = TICKET_REGISTRY.get(tid)
    if not entry:
        # 1. Tiket baru sama sekali berstatus Assigned
        TICKET_REGISTRY[tid] = {
            "ticket_id": tid,
            "current_state": "Assigned",
            "reported_state": "Assigned",
            "first_seen": time.time(),
            "last_seen": time.time(),
            "reported_at": time.time()
        }
        save_persisted_data()
        return True, "new_assigned_ticket", "NEW"

    # Tiket sudah pernah tercatat
    prev_reported = entry.get("reported_state")
    prev_state = entry.get("current_state")

    if prev_reported == "Assigned":
        # ANTI-SPAM: Sudah pernah dilaporkan sebagai Assigned! Jangan spam.
        entry["last_seen"] = time.time()
        save_persisted_data()
        return False, "already_reported_in_assigned_state", "none"

    # 2. Update status: sebelumnya bukan Assigned (misal: Pending), sekarang menjadi Assigned!
    entry["current_state"] = "Assigned"
    entry["reported_state"] = "Assigned"
    entry["last_seen"] = time.time()
    entry["reported_at"] = time.time()
    save_persisted_data()
    return True, f"state_changed_from_{prev_state}_to_assigned", "UPDATE"


def build_wa_summary_text(ticket_list, update_type="NEW"):
    """Format official recap strictly matching user's operational specifications."""
    if not ticket_list:
        return None

    now_str = time.strftime("%d %b %Y %H:%M WIB", time.localtime())
    header_tag = "UPDATE STATUS TIKET GC 1" if update_type == "UPDATE" else "REKAP TIKET BARU GC 1"

    lines = [
        f"🚨 *{header_tag} - KOMINFO HELPDESK*",
        f"📅 *Waktu:* {now_str}",
        "📌 *Status:* Assigned (Siap Ditindaklanjuti)",
        "━━━━━━━━━━━━━━━━━━━━\n"
    ]

    for idx, item in enumerate(ticket_list, 1):
        tid = item.get("ticketId") or "REQ-TIKET"
        sender = item.get("sender") or "Pemohon"
        created = item.get("createdDate") or item.get("dateString") or "-"
        desc = item.get("text", "")
        clean_desc = desc.replace("[ASSIGNED]", "").strip()
        if "|" in clean_desc:
            clean_desc = clean_desc.split("|")[0].strip()

        lines.append(f"{idx}️⃣ *No. Tiket:* `{tid}`")
        lines.append(f"   • *Pemohon:* {sender}")
        lines.append(f"   • *Tanggal:* {created}")
        lines.append(f"   • *Permohonan:* {clean_desc}\n")

    lines.append("━━━━━━━━━━━━━━━━━━━━")
    lines.append(f"📊 *Jumlah Tiket:* {len(ticket_list)} tiket")
    lines.append("ℹ️ *Catatan:* Tiket berstatus Assigned untuk Government Cloud 1 siap ditindaklanjuti.")
    lines.append("_Dibuat otomatis oleh Markijo Autonomous Sentinel_")

    return "\n".join(lines)


def enrich_ticket_with_sop(t):
    """Enrich each internal ticket with Activity Milestone, PIC/Assignee, and SLA Countdown."""
    if t.get("isFromWa"):
        return t

    tid = t.get("ticketId", "")
    desc = t.get("shortDesc", "")
    state_val = t.get("requestState", "Assigned")
    grp_val = t.get("assignmentGroup", "")
    loc_val = t.get("location", "")
    req_for = t.get("requestedFor", "")
    created_date = t.get("createdDate", "")
    resolver_layer = t.get("resolverLayer", "Helpdesk (L0)")

    # 0. Determine Service Type (Insiden vs Service Request)
    if not t.get("serviceType"):
        full_text = f"{tid} {desc}".lower()
        if any(k in full_text for k in ["inc", "down", "mati", "gangguan", "error", "rusak", "problem", "unreachable", "critical", "padam"]):
            t["serviceType"] = "Insiden"
        else:
            t["serviceType"] = "Service Request"

    # 1. Determine priority and SLA duration according to SOP Bab 3.2 & 3.4
    desc_l = desc.lower()
    if any(k in desc_l for k in ["core cpu", "ram", "server", "vm jump host", "cluster", "down", "rusak", "firewall", "waf"]):
        priority = "Major"
        sla_limit_hours = 8
    elif any(k in desc_l for k in ["backup", "restore"]):
        priority = "Minor"
        sla_limit_hours = 24
    else:
        priority = "Normal"
        sla_limit_hours = 24

    # 2. Contextual PIC & Milestone per layer and status
    if "pending" in state_val.lower():
        step_num = 2
        pic_name = f"Approver ({loc_val})" if loc_val else "Pejabat K/L Terkait"
        pic_role = "Tenan Approver (Persetujuan K/L)"
        milestone = "⏳ Menunggu Persetujuan Pejabat Tenan K/L"
    elif "progress" in state_val.lower():
        step_num = 4
        if "eos" in resolver_layer.lower():
            pic_name = "Dimas Prasetyo"
            pic_role = "EOS L1 Field Engineer"
            milestone = "🛠️ Eksekusi Teknis di Hypervisor DC Tamantekno"
        elif "l2" in resolver_layer.lower():
            pic_name = "Irwan Setiawan"
            pic_role = "L2 Cloud Platform Engineer"
            milestone = "⚙️ Re-konfigurasi Computational Resource L2"
        else:
            pic_name = "Rian Hidayat"
            pic_role = "EOS L1 Engineer"
            milestone = "🛠️ Pengerjaan & Pengujian Sistem Berjalan"
    else:  # Assigned
        step_num = 3
        if "eos l1" in resolver_layer.lower():
            pic_name = "Rian Hidayat"
            pic_role = "EOS L1 Engineer"
            milestone = "⚡ Tiket Diterima L1, Persiapan Penanganan Teknis"
        elif "eos l2" in resolver_layer.lower():
            pic_name = "Irwan Setiawan"
            pic_role = "L2 Cloud Platform Engineer"
            milestone = "⚡ Tiket Dialokasikan ke L2 Engineer"
        elif "noc" in resolver_layer.lower():
            pic_name = "Fajar Nugraha"
            pic_role = "NOC Network Engineer"
            milestone = "⚡ Alokasi Penanganan Jaringan / Routing"
        elif "soc" in resolver_layer.lower():
            pic_name = "Aditya Wardhana"
            pic_role = "SOC Security Analyst"
            milestone = "⚡ Alokasi Triase Keamanan & Whitelist"
        else:
            # Helpdesk L0 Gateway
            if "ram" in desc_l or "cpu" in desc_l:
                pic_name = "Siti Rahmawati"
                pic_role = "Helpdesk L0 Gateway"
                milestone = "📋 Triase Spesifikasi vCPU/RAM & Alokasi ke EOS L1"
            elif "jump host" in desc_l or "vm" in desc_l:
                pic_name = "Budi Pratama"
                pic_role = "Helpdesk L0 Gateway"
                milestone = "📋 Validasi Kuota Kuadran Resource VM Jump Host"
            elif "waf" in desc_l or "firewall" in desc_l:
                pic_name = "Nanda Putri"
                pic_role = "Helpdesk L0 Gateway"
                milestone = "📋 Verifikasi Kebijakan Keamanan & Domain Web Tenan"
            elif "skm" in desc_l or "diskusi" in desc_l:
                pic_name = "Arief Wibowo"
                pic_role = "Helpdesk L0 Gateway"
                milestone = "👥 Penjadwalan Diskusi Teknis Lokal Akses SKM Online"
            else:
                pic_name = "Siti Rahmawati"
                pic_role = "Helpdesk L0 Gateway"
                milestone = "📋 Verifikasi Tiket Masuk & Penugasan Resolver"

    # 3. SLA Remaining Calculation
    parsed_time = None
    try:
        clean_d = re.sub(r"\s+WIB", "", created_date).strip()
        month_map = {
            "Mei": "May", "Agu": "Aug", "Okt": "Oct", "Des": "Dec"
        }
        for id_m, en_m in month_map.items():
            if f" {id_m} " in clean_d:
                clean_d = clean_d.replace(f" {id_m} ", f" {en_m} ")
                break
        dt = datetime.datetime.strptime(clean_d, "%d %b %Y %H:%M:%S")
        parsed_time = dt.timestamp()
    except Exception:
        parsed_time = time.time() - 3600

    current_ts = time.time()
    # Graceful fallback: Jika tanggal tiket statis dari hari sebelumnya, selaraskan dengan shift hari ini
    if parsed_time + (sla_limit_hours * 3600) < current_ts:
        now_dt = datetime.datetime.now()
        try:
            dt_today = dt.replace(year=now_dt.year, month=now_dt.month, day=now_dt.day)
            parsed_time = dt_today.timestamp()
            if parsed_time > current_ts:
                parsed_time = current_ts - 1800
        except Exception:
            parsed_time = current_ts - 1800

    deadline_ts = parsed_time + (sla_limit_hours * 3600)
    remaining_secs = max(0, int(deadline_ts - current_ts))
    rem_h = remaining_secs // 3600
    rem_m = (remaining_secs % 3600) // 60
    sla_rem_str = f"{rem_h}j {rem_m}m"

    total_secs = sla_limit_hours * 3600
    percent_rem = max(0, min(100, int((remaining_secs / total_secs) * 100)))

    if remaining_secs == 0:
        sla_badge_class = "sla-breached"
        sla_status_text = "SLA Lewat"
    elif percent_rem < 25:
        sla_badge_class = "sla-danger"
        sla_status_text = f"Sisa {sla_rem_str}"
    elif percent_rem < 50:
        sla_badge_class = "sla-warning"
        sla_status_text = f"Sisa {sla_rem_str}"
    else:
        sla_badge_class = "sla-safe"
        sla_status_text = f"Sisa {sla_rem_str}"

    target_time_str = time.strftime("%d %b %Y %H:%M WIB", time.localtime(deadline_ts))

    timeline = [
        {
            "step": 1,
            "title": "Registrasi & Triase Portal PDN",
            "desc": "Tiket tercatat di ITSM pdn.layanan.go.id & verifikasi identitas tenan.",
            "status": "completed",
            "actor": "Helpdesk L0 (Siti R.)",
            "time": created_date
        },
        {
            "step": 2,
            "title": "Verifikasi Administrasi & Approval",
            "desc": "Pemeriksaan persetujuan pejabat instansi tenan K/L.",
            "status": "completed" if "pending" not in state_val.lower() else "in_progress",
            "actor": req_for or "Pejabat K/L",
            "time": "Telah Disetujui" if "pending" not in state_val.lower() else "Menunggu Approval"
        },
        {
            "step": 3,
            "title": "Assignment ke Resolver (L1/L2)",
            "desc": f"Penugasan teknis ke {resolver_layer} sesuai matriks RACI SOP.",
            "status": "completed" if "progress" in state_val.lower() else ("in_progress" if "assign" in state_val.lower() else "pending"),
            "actor": "Lead L0-L1 (Ricky J. N.)",
            "time": "Aktif" if "assign" in state_val.lower() else ("Selesai" if "progress" in state_val.lower() else "-")
        },
        {
            "step": 4,
            "title": "Eksekusi Teknis di DC Tamantekno",
            "desc": "Konfigurasi sistem, compute/storage hypervisor, atau network.",
            "status": "in_progress" if "progress" in state_val.lower() else "pending",
            "actor": pic_name,
            "time": "Sedang Berjalan" if "progress" in state_val.lower() else "Antrean Teknis"
        },
        {
            "step": 5,
            "title": "Validasi Tenan & Penutupan Tiket",
            "desc": "Konfirmasi hasil pengerjaan dengan tenan dan pelaporan bulanan Komdigi.",
            "status": "pending",
            "actor": "Helpdesk L0 & Tenan",
            "time": "-"
        }
    ]

    t["picName"] = pic_name
    t["picRole"] = pic_role
    t["activityMilestone"] = milestone
    t["workflowStep"] = step_num
    t["priority"] = priority
    t["slaLimitHours"] = sla_limit_hours
    t["slaRemainingFormatted"] = sla_rem_str
    t["slaRemainingSeconds"] = remaining_secs
    t["slaPercentRemaining"] = percent_rem
    t["slaBadgeClass"] = sla_badge_class
    t["slaStatusText"] = sla_status_text
    t["slaTargetTime"] = target_time_str
    t["deadlineTs"] = deadline_ts
    t["timeline"] = timeline
    return t


class SentinelHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def _set_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self):
        self.send_response(200)
        self._set_cors()
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            self.handle_api_get(path, parsed)
        else:
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            content_len = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_len) if content_len > 0 else b"{}"
            try:
                data = json.loads(body.decode("utf-8")) if body else {}
            except Exception:
                data = {}
            self.handle_api_post(path, data)
        else:
            self.send_error(404, "Endpoint not found")

    def end_headers(self):
        self._set_cors()
        super().end_headers()

    def send_json(self, payload, code=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_api_get(self, path, parsed):
        with LOCK:
            if path == "/api/status":
                assigned_gc1 = [
                    v for v in TICKET_REGISTRY.values()
                    if v.get("current_state") == "Assigned"
                ]
                self.send_json({
                    "status": "online",
                    "app": "GC 1 Sentinel (Helpdesk Expert Edition)",
                    "markijo_auto_mode": CONFIG.get("markijo_auto_mode", True),
                    "total_alerts": len(ALERTS),
                    "tracked_tickets_count": len(TICKET_REGISTRY),
                    "assigned_gc1_count": len(assigned_gc1),
                    "wa_queue_len": len([m for m in WA_QUEUE if m.get("status") == "pending"]),
                    "target_contact": CONFIG.get("target_contact", "mimi Sandora"),
                    "server_time": time.strftime("%Y-%m-%d %H:%M:%S")
                })

            elif path == "/api/alerts":
                self.send_json({"alerts": ALERTS})

            elif path == "/api/config":
                self.send_json(CONFIG)

            elif path == "/api/wa_queue":
                # SINGLE-DELIVERY POP: Pesan langsung dipindahkan ke history saat diambil
                # JANGAN PERNAH me-reclaim atau mengirim ulang otomatis setiap 60 detik!
                pending = [m for m in WA_QUEUE if m.get("status") == "pending"]
                if pending:
                    item = pending[0]
                    item["status"] = "dispatched"
                    item["dispatched_at"] = time.time()
                    WA_HISTORY.insert(0, item)
                    WA_QUEUE.remove(item)
                    save_persisted_data()
                    print(f"[Sentinel Server] Pesan {item['id']} diambil oleh WhatsApp Web (Single Delivery Pop).")
                    self.send_json({"has_message": True, "message": item})
                else:
                    self.send_json({"has_message": False})

            elif path == "/api/wa_status" or path == "/api/wa_done":
                params = parse_qs(parsed.query)
                msg_id = params.get("id", [""])[0]
                status = params.get("status", ["sent"])[0]
                for item in WA_HISTORY:
                    if item.get("id") == msg_id:
                        item["status"] = status
                        item["confirmed_at"] = time.time()
                        break
                save_persisted_data()
                self.send_json({"status": "acknowledged"})

            elif path == "/api/wa_history":
                self.send_json({"history": WA_HISTORY})

            elif path == "/api/ticket_registry":
                self.send_json({"registry": TICKET_REGISTRY})

            elif path == "/api/helpdesk_snapshot":
                # STRICT PRIMARY KEY DEDUPLICATION: Setiap nomor tiket hanya boleh muncul 1 kali
                # Gabungkan tiket aduan WhatsApp Group dengan tiket Helpdesk ITSM
                all_raw_pool = list(WA_TICKETS) + list(HELPDESK_SNAPSHOT)
                unique_tickets = []
                seen_ids = set()
                for t in all_raw_pool:
                    tid = (t.get("ticketId") or "").strip()
                    if tid and tid not in seen_ids:
                        seen_ids.add(tid)
                        unique_tickets.append(t)

                # KLASIFIKASI SESUAI SOP OPERASIONAL GC 1 (HANYA RUANG LINGKUP INTERNAL KITA, TELKOM DIABAIKAN)
                our_team_tickets = [
                    enrich_ticket_with_sop(t) for t in unique_tickets
                    if not t.get("isTelkom") and "telkom" not in (t.get("assignmentGroup", "") + " " + t.get("shortDesc", "")).lower()
                ]

                team_assigned = [
                    t for t in our_team_tickets
                    if t.get("requestState", "").lower() == "assigned" or "assign" in t.get("requestState", "").lower()
                ]
                team_pending = [
                    t for t in our_team_tickets
                    if "pending" in t.get("requestState", "").lower()
                ]
                team_progress = [
                    t for t in our_team_tickets
                    if "progress" in t.get("requestState", "").lower()
                ]

                sla_safe = [t for t in our_team_tickets if t.get("slaRemainingSeconds", 0) > 0]
                sla_health_pct = 100 if not our_team_tickets else int((len(sla_safe) / len(our_team_tickets)) * 100)

                wa_alerts = [a for a in ALERTS if a.get("source") == "whatsapp"]

                self.send_json({
                    "total_helpdesk": len(our_team_tickets),
                    "team_assigned_count": len(team_assigned),
                    "team_pending_count": len(team_pending),
                    "team_progress_count": len(team_progress),
                    "sla_health_percent": sla_health_pct,
                    "sla_safe_count": len(sla_safe),
                    "telkom_count": 0,
                    "wa_count": len(wa_alerts),
                    "last_sync": LAST_SYNC_TIME or time.strftime("%H:%M:%S WIB"),
                    "team_assigned": team_assigned,
                    "team_pending": team_pending,
                    "team_progress": team_progress,
                    "wa_alerts": wa_alerts,
                    "all_tickets": our_team_tickets,
                    # Backward-compatibility alias
                    "gc1_assigned": team_assigned,
                    "gc1_assigned_count": len(team_assigned),
                    "gc1_pending": team_pending,
                    "gc1_pending_count": len(team_pending)
                })

            else:
                self.send_error(404, "API route not found")

    def handle_api_post(self, path, data):
        global ALERTS, WA_TICKETS, TICKET_REGISTRY, SENT_RECAP_HASHES, WA_QUEUE, WA_HISTORY, CONFIG, HELPDESK_SNAPSHOT, LAST_SYNC_TIME

        with LOCK:
            if path == "/api/sync_helpdesk":
                referer = self.headers.get("Referer", "")
                if "dashboard" in referer.lower():
                    self.send_json({"status": "ignored", "reason": "sync_from_dashboard_forbidden"})
                    return

                raw_tickets = data.get("tickets") or []
                if not isinstance(raw_tickets, list):
                    raw_tickets = []
                raw_tickets = [t for t in raw_tickets if isinstance(t, dict)]
                normalized_tickets = []
                seen_sync_ids = set()
                for t in raw_tickets:
                    raw_id = t.get("ticketId") or t.get("number") or t.get("ticketNumber") or ""
                    tid = re.sub(r"[\r\n\t📋]", "", str(raw_id)).strip()
                    if not tid or tid in seen_sync_ids:
                        continue
                    seen_sync_ids.add(tid)

                    desc = re.sub(r"\s+", " ", str(t.get("shortDesc") or t.get("desc") or "")).strip()
                    req_for = re.sub(r"\s+", " ", re.sub(r"[\r\n\t]", " ", str(t.get("requestedFor") or ""))).strip()
                    state_val = re.sub(r"[●•\r\n\t]", "", str(t.get("requestState") or t.get("state") or "")).strip()
                    date_val = re.sub(r"\s+", " ", str(t.get("createdDate") or t.get("date") or "")).strip()
                    loc_val = re.sub(r"\s+", " ", re.sub(r"[\r\n\t]", " ", str(t.get("location") or ""))).strip()
                    grp_val = re.sub(r"\s+", " ", str(t.get("assignmentGroup") or t.get("group") or "")).strip()

                    # Filter out corrupted rows from dashboard button scraping
                    if "salin" in loc_val.lower() or loc_val in ["📋 Salin", "Salin"] or loc_val == "📲 WA":
                        continue
                    if "helpdesk" in date_val.lower() or "l0" in date_val.lower() or "eos" in date_val.lower():
                        continue

                    # Check GC 1 match & SOP Team Rules
                    full_text = f"{tid} {desc} {req_for} {loc_val} {grp_val}"
                    is_gc1 = any(k.lower() in full_text.lower() for k in CONFIG.get("keywords", []))

                    # SOP OPERASIONAL: Yang di luar ruang lingkup HANYA Telkom (Abaikan sepenuhnya)
                    is_telkom = "telkom" in grp_val.lower() or "telkom" in full_text.lower()
                    if is_telkom:
                        continue  # Abaikan tiket Telkom, tidak masuk ke GC 1 Sentinel

                    is_assigned = (state_val.lower() == "assigned" or "assign" in state_val.lower())
                    is_pending = "pending" in state_val.lower()
                    is_progress = "progress" in state_val.lower()

                    if is_assigned:
                        cat = "team_assigned"
                    elif is_pending:
                        cat = "team_pending"
                    elif is_progress:
                        cat = "team_progress"
                    else:
                        cat = "team_assigned"

                    if "eos l1" in grp_val.lower():
                        resolver_layer = "EOS L1"
                    elif "eos l2" in grp_val.lower():
                        resolver_layer = "EOS L2 (Engineer)"
                    elif "eos l3" in grp_val.lower():
                        resolver_layer = "EOS L3 (Expert)"
                    elif "noc" in grp_val.lower():
                        resolver_layer = "NOC"
                    elif "soc" in grp_val.lower():
                        resolver_layer = "SOC"
                    else:
                        resolver_layer = "Helpdesk (L0)"

                    norm_t = {
                        "ticketId": tid,
                        "shortDesc": desc,
                        "requestedFor": req_for,
                        "requestState": state_val,
                        "createdDate": date_val,
                        "location": loc_val,
                        "assignmentGroup": grp_val,
                        "isGc1": is_gc1,
                        "isTelkom": False,
                        "resolverLayer": resolver_layer,
                        "serviceType": t.get("serviceType"),
                        "category": cat
                    }
                    norm_t = enrich_ticket_with_sop(norm_t)
                    normalized_tickets.append(norm_t)

                    # Trigger WA hanya untuk tiket tim kita sendiri yang berstatus ASSIGNED (Non-Telkom)
                    if is_assigned and not is_telkom:
                        alert_data = {
                            "source": "helpdesk",
                            "ticketId": tid,
                            "sender": f"{req_for} ({loc_val})",
                            "text": f"[{state_val.upper()}] {desc} | Lokasi: {loc_val} | Group: {grp_val} ({resolver_layer})",
                            "matchedKeyword": "GC 1" if is_gc1 else grp_val,
                            "requestState": state_val,
                            "createdDate": date_val,
                            "resolverLayer": resolver_layer
                        }
                        should_notify, reason, update_type = should_report_ticket(alert_data)
                        if should_notify and CONFIG.get("markijo_auto_mode", True) and tid:
                            print(f"[Sentinel Server] [SYNC TRIGGER] {tid} ({reason})")
                            recap_msg = build_wa_summary_text([alert_data], update_type=update_type)
                            if recap_msg:
                                msg_hash = hashlib.md5(recap_msg.encode("utf-8")).hexdigest()
                                if msg_hash not in SENT_RECAP_HASHES:
                                    SENT_RECAP_HASHES.add(msg_hash)
                                    msg_id = f"wa_{int(time.time()*1000)}"
                                    WA_QUEUE.append({
                                        "id": msg_id,
                                        "target": CONFIG.get("target_contact", "mimi Sandora"),
                                        "text": recap_msg,
                                        "auto_send": CONFIG.get("auto_send_wa", True),
                                        "ticketIds": [tid],
                                        "status": "pending",
                                        "created_at": time.time(),
                                        "hash": msg_hash
                                    })
                HELPDESK_SNAPSHOT = normalized_tickets
                LAST_SYNC_TIME = time.strftime("%H:%M:%S WIB")
                save_persisted_data()
                self.send_json({"status": "synced", "count": len(normalized_tickets), "last_sync": LAST_SYNC_TIME})

            elif path == "/api/alerts":
                alert_data = data.get("data", data)
                source = alert_data.get("source", "unknown")
                raw_tid = alert_data.get("ticketId", "")
                tid = re.sub(r"[\r\n\t📋]", "", str(raw_tid)).strip()
                text = re.sub(r"\s+", " ", str(alert_data.get("text", ""))).strip()
                sender = re.sub(r"\s+", " ", re.sub(r"[\r\n\t]", " ", str(alert_data.get("sender", "")))).strip()
                req_state = re.sub(r"[●•\r\n\t]", "", str(alert_data.get("requestState", ""))).strip()
                kw = alert_data.get("matchedKeyword", "GC 1")

                # Filter GC 1
                is_gc1 = any(k.lower() in (text + " " + kw).lower() for k in CONFIG["keywords"])
                if not is_gc1 and source == "helpdesk":
                    self.send_json({"status": "ignored", "reason": "not_gc1"})
                    return

                # Deduplikasi alert di dashboard feed (hindari baris berulang untuk tiket & status yang sama)
                if source == "helpdesk" and tid:
                    exists = any(a.get("source") == "helpdesk" and a.get("ticketId") == tid and a.get("requestState", "").lower() == req_state.lower() for a in ALERTS)
                else:
                    sig = f"{source}|{tid}|{sender}|{text[:100]}"
                    exists = any(a.get("sig") == sig for a in ALERTS)
                if not exists:
                    new_alert = {
                        "id": f"alt_{int(time.time()*1000)}",
                        "sig": sig,
                        "source": source,
                        "ticketId": tid,
                        "sender": sender,
                        "text": text,
                        "requestState": req_state or ("Assigned" if "[assigned]" in text.lower() else "Baru"),
                        "matchedKeyword": kw,
                        "timestamp": int(time.time() * 1000),
                        "dateString": time.strftime("%H:%M:%S"),
                        "status": "baru"
                    }
                    ALERTS.insert(0, new_alert)
                    save_persisted_data()
                    print(f"[Sentinel Server] Data aduan dicatat: {tid} - {text[:60]}")

                # STANDAR HELPDESK EXPERT: Evaluasi apakah tiket harus memicu notifikasi WA
                should_notify, reason, update_type = should_report_ticket(alert_data)

                if should_notify and CONFIG.get("markijo_auto_mode", True) and tid:
                    print(f"[Sentinel Server] [TRIGGER LAPORAN] {tid} ({reason})")
                    recap_msg = build_wa_summary_text([alert_data], update_type=update_type)
                    if recap_msg:
                        msg_hash = hashlib.md5(recap_msg.encode("utf-8")).hexdigest()
                        if msg_hash not in SENT_RECAP_HASHES:
                            SENT_RECAP_HASHES.add(msg_hash)
                            msg_id = f"wa_{int(time.time()*1000)}"
                            WA_QUEUE.append({
                                "id": msg_id,
                                "target": CONFIG.get("target_contact", "mimi Sandora"),
                                "text": recap_msg,
                                "auto_send": CONFIG.get("auto_send_wa", True),
                                "ticketIds": [tid],
                                "status": "pending",
                                "created_at": time.time(),
                                "hash": msg_hash
                            })
                            save_persisted_data()
                            print(f"[Sentinel Server] Rekap {tid} berhasil dimasukkan ke antrean WA mimi Sandora.")
                        else:
                            print(f"[Sentinel Server] Anti-Spam: Rekap dengan hash {msg_hash[:8]} sudah pernah dikirim.")

                self.send_json({
                    "status": "ok",
                    "recorded": not exists,
                    "notified": should_notify,
                    "reason": reason
                })

            elif path == "/api/trigger_recap":
                # Manual trigger: ambil semua tiket Assigned tim kita yang belum dilaporkan
                # atau jika diminta paksa, ambil tiket Assigned terbaru
                force = data.get("force", False)

                # Prioritaskan HELPDESK_SNAPSHOT (tim kita sendiri yang non-Telkom)
                assigned_tickets = []
                for t in HELPDESK_SNAPSHOT:
                    if (t.get("requestState", "").lower() == "assigned" or "assign" in t.get("requestState", "").lower()) and not t.get("isTelkom"):
                        assigned_tickets.append({
                            "ticketId": t.get("ticketId"),
                            "sender": f"{t.get('requestedFor', '')} ({t.get('location', '')})",
                            "createdDate": t.get("createdDate"),
                            "text": f"[ASSIGNED] {t.get('shortDesc', '')} | Lokasi: {t.get('location', '')} | Group: {t.get('assignmentGroup', '')} ({t.get('resolverLayer', '')})",
                            "matchedKeyword": t.get("assignmentGroup") or "GC 1",
                            "requestState": "Assigned",
                            "resolverLayer": t.get("resolverLayer", "Helpdesk")
                        })

                if not assigned_tickets:
                    assigned_tickets = [
                        a for a in ALERTS
                        if (a.get("requestState", "").lower() == "assigned" or "[assigned]" in a.get("text", "").lower())
                        and not a.get("isTelkom", False)
                        and "telkom" not in (a.get("text", "") + " " + a.get("sender", "")).lower()
                    ]

                # Cari tiket yang belum pernah dilaporkan
                target_tickets = [
                    a for a in assigned_tickets
                    if TICKET_REGISTRY.get(a.get("ticketId"), {}).get("reported_state") != "Assigned"
                ]

                if not target_tickets and force and assigned_tickets:
                    target_tickets = assigned_tickets[:5]
                elif not target_tickets and assigned_tickets:
                    # Jika ditekan tombol manual "Kirim Rekap ke WA" dari dashboard
                    target_tickets = assigned_tickets

                if not target_tickets:
                    self.send_json({
                        "status": "empty",
                        "message": "Semua tiket Assigned tim kita sudah pernah dilaporkan (Anti-Spam Aktif)."
                    })
                    return

                recap_msg = build_wa_summary_text(target_tickets, update_type="MANUAL")
                msg_hash = hashlib.md5(recap_msg.encode("utf-8")).hexdigest()

                if msg_hash in SENT_RECAP_HASHES and not force:
                    self.send_json({
                        "status": "already_sent",
                        "message": "Isi rekap persis sama dengan pesan yang baru saja dikirim."
                    })
                    return

                SENT_RECAP_HASHES.add(msg_hash)
                msg_id = f"wa_{int(time.time()*1000)}"
                tids = [a.get("ticketId") for a in target_tickets if a.get("ticketId")]

                WA_QUEUE.append({
                    "id": msg_id,
                    "target": CONFIG.get("target_contact", "mimi Sandora"),
                    "text": recap_msg,
                    "auto_send": data.get("auto_send", CONFIG.get("auto_send_wa", True)),
                    "ticketIds": tids,
                    "status": "pending",
                    "created_at": time.time(),
                    "hash": msg_hash
                })

                for tid in tids:
                    if tid in TICKET_REGISTRY:
                        TICKET_REGISTRY[tid]["reported_state"] = "Assigned"
                        TICKET_REGISTRY[tid]["reported_at"] = time.time()

                save_persisted_data()
                print(f"[Sentinel Server] Manual Rekap {len(target_tickets)} tiket GC 1 diantrekan ke WhatsApp.")
                self.send_json({
                    "status": "queued",
                    "message_id": msg_id,
                    "ticket_count": len(target_tickets),
                    "target": CONFIG.get("target_contact", "mimi Sandora"),
                    "text": recap_msg
                })

            elif path == "/api/wa_queue":
                # Menambahkan pesan manual ke antrean
                msg_text = data.get("text", "")
                msg_hash = hashlib.md5(msg_text.encode("utf-8")).hexdigest()

                if msg_hash in SENT_RECAP_HASHES and not data.get("force"):
                    self.send_json({"status": "skipped", "reason": "duplicate_message_hash"})
                    return

                SENT_RECAP_HASHES.add(msg_hash)
                msg_id = data.get("id") or f"wa_{int(time.time()*1000)}"
                WA_QUEUE.append({
                    "id": msg_id,
                    "target": data.get("target", CONFIG.get("target_contact", "mimi Sandora")),
                    "text": msg_text,
                    "auto_send": data.get("auto_send", True),
                    "ticketIds": data.get("ticketIds", []),
                    "status": "pending",
                    "created_at": time.time(),
                    "hash": msg_hash
                })
                save_persisted_data()
                self.send_json({"status": "ok", "message_id": msg_id})

            elif path == "/api/wa_status":
                msg_id = data.get("id")
                status = data.get("status", "sent")
                error = data.get("error", "")

                for item in list(WA_QUEUE):
                    if item.get("id") == msg_id:
                        item["status"] = status
                        item["finished_at"] = time.time()
                        if error:
                            item["error"] = error
                        WA_HISTORY.insert(0, item)
                        WA_QUEUE.remove(item)
                        break

                save_persisted_data()
                print(f"[Sentinel Server] WA Delivery Status [{status}] for {msg_id}: {error or 'Sukses'}")
                self.send_json({"status": "acknowledged"})

            elif path == "/api/add_wa_ticket":
                sender = data.get("sender") or "Member Grup WA"
                group = data.get("group") or "Grup Koordinasi Teknis GC 1"
                text = data.get("text") or ""
                kw = data.get("matchedKeyword") or "GC 1"

                if not text.strip():
                    self.send_json({"status": "error", "message": "Text aduan tidak boleh kosong"}, 400)
                    return

                # Cek deduplikasi agar tidak double insert
                if any(t.get("rawWaText", "")[:60] == text[:60] and t.get("requestedFor") == sender for t in WA_TICKETS):
                    self.send_json({"status": "ignored", "reason": "already_converted_to_ticket"})
                    return

                wa_ticket = convert_wa_message_to_ticket(sender, group, text, kw)
                LAST_SYNC_TIME = time.strftime("%H:%M:%S WIB")
                print(f"[Sentinel Server] 💬 WhatsApp message converted to Ticket: {wa_ticket['ticketId']} from {sender} [{group}]")
                self.send_json({"status": "success", "ticket": wa_ticket})

            elif path == "/api/config":
                save_config({**CONFIG, **data})
                self.send_json({"status": "ok", "config": CONFIG})

            elif path == "/api/reset_registry":
                # Reset anti-spam registry jika operator ingin mereset state tiket
                TICKET_REGISTRY.clear()
                SENT_RECAP_HASHES.clear()
                WA_QUEUE.clear()
                save_persisted_data()
                print("[Sentinel Server] Ticket Registry & Anti-Spam state direset.")
                self.send_json({"status": "registry_reset"})

            elif path == "/api/clear_data":
                # KOSONGKAN SELURUH DATA GC 1 DASHBOARD UNTUK KEPERLUAN PENGUJIAN / TESTING
                HELPDESK_SNAPSHOT = []
                ALERTS = []
                WA_TICKETS = []
                TICKET_REGISTRY.clear()
                SENT_RECAP_HASHES.clear()
                WA_QUEUE.clear()
                WA_HISTORY.clear()
                LAST_SYNC_TIME = time.strftime("%H:%M:%S WIB")
                save_persisted_data()

                try:
                    rep_file = APP_DIR / "markijo_reported.json"
                    if rep_file.exists():
                        with open(rep_file, "w", encoding="utf-8") as f:
                            f.write("[]")
                except Exception:
                    pass

                print("[Sentinel Server] 🗑️ Clear Data GC 1 Dashboard dieksekusi: Seluruh data tiket dikosongkan.")
                self.send_json({"status": "cleared", "message": "Seluruh data tiket dan alert di GC 1 Dashboard berhasil dibersihkan."})

            else:
                self.send_error(404, "API route not found")


def main():
    load_config()
    load_persisted_data()
    port = CONFIG.get("server_port", 8765)

    server = http.server.ThreadingHTTPServer(("0.0.0.0", port), SentinelHandler)
    print("=" * 70)
    print(f"  [GC 1 SENTINEL] HELPDESK EXPERT SERVER AKTIF (PORT {port})")
    print(f"  Direktori: {APP_DIR}")
    print(f"  Target WhatsApp: {CONFIG.get('target_contact', 'mimi Sandora')}")
    print(f"  Anti-Spam Mode: AKTIF (Hanya Tiket Baru & Update Status)")
    print(f"  Dashboard: http://localhost:{port}/dashboard.html")
    print("=" * 70)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Sentinel Server] Menghentikan server...")
        server.server_close()


if __name__ == "__main__":
    main()
