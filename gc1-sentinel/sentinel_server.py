"""
GC 1 Sentinel - Enhanced Server with REST API & Static File Serving (Helpdesk Expert Edition)
Port: 8765
Directly serves GC 1 Dashboard, Helpdesk Dummy, and Markijo Automation IPC.

VERSI 2 (SOP v0.2):
- Pengiriman rekap ke WhatsApp DIMATIKAN (wa_outbound_enabled=false). WhatsApp hanya dibaca
  (grup -> pra-tiket di dashboard); SOP 5.7 melarang meneruskan data tenan ke WA di luar sistem resmi.
- Prioritas/SLA mengikuti SOP 3.2 (Critical 4j, Major 8j, Minor 24j, respons <15 menit).
- SLA dihitung hidup dari waktu aduan/tiket sebenarnya, riwayat tiap tiket dilacak.
- Server hanya mendengarkan 127.0.0.1 dan menolak Origin/Host asing.

STANDAR HELPDESK EXPERT:
1. State Machine per Tiket: Tiket dilacak siklus hidupnya (Pending -> Assigned -> In Progress -> Selesai).
2. Anti-Spam Mutlak: Tiket yang sudah pernah dilaporkan dalam status Assigned TIDAK PERNAH dikirim ulang.
3. Notifikasi HANYA jika ada tiket baru atau UPDATE status (misal: Pending Approval berubah jadi Assigned).
4. Atomic Queue Claiming: Mencegah race condition yang menyebabkan pesan terkirim ganda ke WhatsApp.
"""

import datetime
import hashlib
import hmac
import html as htmllib
import http.server
import json
import os
import re
import secrets
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

sys.dont_write_bytecode = True
APP_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(APP_DIR))
try:
    import hermes_agent as _HA
except Exception:
    _HA = None
import sentinel_db
def is_valid_ticket_id(tid):
    if not tid or not isinstance(tid, str): return False
    s = tid.strip()
    if len(s) < 2 or len(s) > 50: return False
    if " " in s or "\t" in s or "\n" in s: return False
    lower = s.lower()
    if lower in ("request", "incident", "requesttask", "task", "ticket", "permohonan", "gangguan", "require", "required", "requirement", "requirements", "including", "included", "includes", "increase", "incoming"): return False
    bad = ("homepage", "management", "reporting", "enablement", "assessment", "platform", "setting", "knowledge", "delete", "filter", "search", "logout", "login")
    if any(b in lower for b in bad): return False
    return True
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
    "wa_outbound_enabled": False,
    "markijo_auto_mode": True,
    "server_port": 8765,
    "bind_host": "127.0.0.1",
    "allowed_origins": [],
    "wa_monitored_groups": [],
    "wa_priority_groups": [],
    "wa_ignored_groups": [],
    "wa_team_senders": [],
    "wa_verified_senders": [],
    "wa_max_age_hours": 24,
    "pic_roster": {},
    "ai_provider": "off",
    "ai_model": "deepseek-chat",
    "ai_base_url": "https://api.deepseek.com",
    "ai_external_approved": False,
    "ai_hermes_exe": "",
    "ai_hermes_home": "",
    "itsm_lists": [
        {"key": "request", "label": "Tiket Request", "match": ["request", "permohonan", "sc_req_item", "sc_task", "all request"]},
        {"key": "incident", "label": "Tiket Insiden", "match": ["incident", "insiden", "gangguan", "all incident"]}
    ],
    "wa_reply_warn_minutes": 5,
    "wa_reply_breach_minutes": 10,
    "wa_ticket_open_target_minutes": 15,
    "doc_rules": [
        {"name": "Pembuatan akun",
         "keywords": ["pembuatan akun", "buat akun", "akun baru", "dibuatkan akun", "pendaftaran akun", "pembuatan user", "buat user", "pembuatan username"],
         "docs": ["approval", "nota_dinas"]}
    ],
    "team_view_enabled": False,
    "team_view_token": "",
    "live_helpdesk_url": "https://pdn.layanan.go.id"
}

# Kunci config yang boleh diubah lewat API (kunci keamanan hanya lewat config.json)
CONFIG_API_KEYS = {
    "keywords", "target_contact", "poll_interval_seconds", "markijo_auto_mode",
    "wa_monitored_groups", "wa_priority_groups", "wa_ignored_groups", "wa_team_senders", "wa_verified_senders",
    "wa_max_age_hours", "pic_roster",
}
LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]", "::1"}

LOCK = threading.Lock()
ALERTS = []
WA_TICKETS = []
TICKET_REGISTRY = {}
SENT_RECAP_HASHES = set()
WA_QUEUE = []
WA_HISTORY = []
HELPDESK_SNAPSHOT = []
LAST_SYNC_TIME = ""
TELKOM_SKIPPED = 0
TICKET_ARCHIVE = {}
HELPDESK_LISTS = {}   # satu entri per halaman/menu ITSM yang dibaca: {key: {label, tickets, synced_at, title, path}}
PIC_REGISTRY = {}      # nomor HP TERVERIFIKASI -> data PIC (hanya yang sudah lolos verifikasi Komdigi)
IDENTITY_CASES = {}    # nomor HP belum terverifikasi -> kasus verifikasi (belum disimpan sebagai PIC)
SYNC_HOURS = set()
MONITOR_START = 0
CONFIG = dict(DEFAULT_CONFIG)


def outbound_enabled():
    return bool(CONFIG.get("wa_outbound_enabled", False))


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
    global ALERTS, WA_TICKETS, TICKET_REGISTRY, SENT_RECAP_HASHES, WA_QUEUE, WA_HISTORY, HELPDESK_SNAPSHOT, LAST_SYNC_TIME, TICKET_ARCHIVE, SYNC_HOURS, MONITOR_START, PIC_REGISTRY, IDENTITY_CASES, HELPDESK_LISTS
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
                HELPDESK_LISTS = data.get("helpdesk_lists", {})
                if not HELPDESK_LISTS and HELPDESK_SNAPSHOT:   # data lama (satu daftar)
                    HELPDESK_LISTS = {"itsm": {"label": "ITSM", "tickets": HELPDESK_SNAPSHOT, "synced_at": time.time(), "title": "", "path": ""}}
                LAST_SYNC_TIME = data.get("last_sync_time", "")
                TICKET_ARCHIVE = data.get("ticket_archive", {})
                PIC_REGISTRY = data.get("pic_registry", {})
                IDENTITY_CASES = data.get("identity_cases", {})
                SYNC_HOURS = set(data.get("sync_hours", []))
                MONITOR_START = data.get("monitor_start", 0)
        except Exception as e:
            print(f"[Sentinel Server] Error loading data file: {e}")

    # Fallback dari database SQLite jika snapshot memori masih kosong
    if not HELPDESK_SNAPSHOT and 'sentinel_db' in globals():
        try:
            db_tickets = sentinel_db.get_all_tickets_from_db()
            if db_tickets:
                HELPDESK_SNAPSHOT = db_tickets
                req_t = [t for t in db_tickets if (t.get("serviceType") or "").lower() == "request"]
                inc_t = [t for t in db_tickets if (t.get("serviceType") or "").lower() == "insiden"]
                if req_t and "request" not in HELPDESK_LISTS:
                    HELPDESK_LISTS["request"] = {"label": "Tiket Request", "tickets": req_t, "synced_at": time.time(), "title": "Tiket Request", "path": "/itsm/request"}
                if inc_t and "incident" not in HELPDESK_LISTS:
                    HELPDESK_LISTS["incident"] = {"label": "Tiket Insiden", "tickets": inc_t, "synced_at": time.time(), "title": "Tiket Insiden", "path": "/itsm/incident"}
        except Exception as e:
            print(f"[Sentinel Server] Error loading from SQLite: {e}")


def save_persisted_data():
    try:
        tmp = DATA_FILE.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({
                "alerts": ALERTS[:500],
                "wa_tickets": WA_TICKETS[:5000],
                "ticket_registry": TICKET_REGISTRY,
                "sent_hashes": list(SENT_RECAP_HASHES)[-500:],
                "wa_queue": WA_QUEUE,
                "wa_history": WA_HISTORY[:100],
                "helpdesk_snapshot": HELPDESK_SNAPSHOT,
                "helpdesk_lists": HELPDESK_LISTS,
                "last_sync_time": LAST_SYNC_TIME,
                "ticket_archive": TICKET_ARCHIVE,
                "sync_hours": sorted(SYNC_HOURS)[-24 * 70:],
                "monitor_start": MONITOR_START,
                "pic_registry": PIC_REGISTRY,
                "identity_cases": IDENTITY_CASES
            }, f, indent=2, ensure_ascii=False)
        os.replace(tmp, DATA_FILE)
    except Exception as e:
        print(f"[Sentinel Server] Error saving data file: {e}")


# ---------------------------------------------------------------------------
# SOP v0.2 - klasifikasi, prioritas, SLA, pelacakan
# ---------------------------------------------------------------------------
PRIORITY_CHOICES = ("Critical", "Major", "Minor", "Service Request")
# SOP 3.2: Critical 4 jam, Major 8 jam, Minor 24 jam. Service request: baku 24 jam
# (katalog KAK 18.c belum dikonfirmasi BPO Komdigi, lihat SOP 3.4).
SLA_HOURS = {"Critical": 4, "Major": 8, "Minor": 24, "Service Request": 24}
RESPONSE_SLA_SECONDS = 15 * 60  # SOP 3.2: respons < 15 menit untuk semua aduan/tiket
UPDATE_INTERVAL_MIN = {"Critical": 30, "Major": 60, "Minor": 240, "Service Request": 240}
ESCALATE_L2_MINUTES = {"Critical": 15, "Major": 60, "Minor": 240}  # SOP 6.6
CLOSED_STATES = ("resolved", "closed", "complete", "selesai", "cancel", "reject", "tolak")

# KAK poin 18.c: SLA permintaan layanan menurut Katalog Layanan (hari, jam). Format "4 Hari, 4 Jam" belum disepakati
# artinya dengan Tim GC1 (SOP 3.4); di sini dibaca sebagai DURASI TOTAL (hari x 24 + jam) dan ditandai di tiket.
SLA_CATALOG = {
    "IaaS": (4, 4), "BaaS": (9, 6), "SecaS": (1, 24), "SaaS": (16, 0), "Layanan Pendukung": (3, 0), "PaaS": (3, 0),
    "Baremetal as a Service": (5, 0), "DC Colocation": (4, 8), "Layanan Jaringan": (4, 2), "Layanan Cloud Terpadu": (3, 0),
    "Layanan Sandi Data": (0, 9), "Pendaftaran": (1, 0),
}
SERVICE_CATEGORIES = list(SLA_CATALOG)
KAK_INCIDENT_BAKU_HOURS = 24.25   # KAK 18.c: "SLA Insiden: 24 Jam, 15 menit"
CATEGORY_KW = [  # urutan: yang spesifik dulu, IaaS (luas) terakhir
    ("Pendaftaran", ["pendaftaran akun", "pembuatan akun", "buat akun", "akun baru", "dibuatkan akun", "registrasi akun", "pembuatan user", "buat user"]),
    ("Baremetal as a Service", ["baremetal", "bare metal"]),
    ("DC Colocation", ["colocation", "kolokasi", "rak server", "rak colo"]),
    ("BaaS", ["backup", "restore"]),
    ("SecaS", ["waf", "web application firewall", "firewall", "edr", "ddos", "vulnerability", "siem", "ndr", "dns filtering", "email security", "traffic filter", "attack surface"]),
    ("PaaS", ["cpanel", "whm", "hosting"]),
    ("SaaS", ["cloud storage", "cdn", "project management", "replikasi", "replication"]),
    ("Layanan Jaringan", ["ip public", "ip publik", "dns", "vlan", "bandwidth", "routing", "nat ", "port akses", "vpn"]),
    ("Layanan Pendukung", ["video conference", "zoom", "diskusi teknis", "pendampingan", "workshop", "webinar", "pelatihan"]),
    ("IaaS", ["vm", "virtual machine", "vcpu", "cpu", "ram", "disk", "storage", "vdc", "resource", "jump host", "snapshot", "console", "server"]),
]


def classify_category(text):
    t = f" {str(text or '').lower()} "
    for cat, kws in CATEGORY_KW:
        if any(k in t for k in kws):
            return cat
    return ""


def catalog_hours(cat):
    d, h = SLA_CATALOG[cat]
    return d * 24 + h


CRITICAL_KW = [
    "ransomware", "kebocoran data", "data bocor", "akses tidak sah", "diretas", "hacked",
    "semua tenan", "seluruh tenan", "banyak tenan", "cluster down", "storage utama",
    "core network", "link internet utama", "mati total", "down total", "kehilangan data",
]
MAJOR_KW = [
    "down", "mati", "tidak bisa diakses", "tidak dapat diakses", "tidak bisa akses",
    "error 500", "unreachable", "sangat lambat", "lambat parah", "ddos", "putus",
    "rusak", "cpu 100", "ram penuh", "disk penuh",
]
SERVICE_REQUEST_KW = [
    "permohonan", "penambahan", "pembuatan", "buat akun", "reset password", "unlock",
    "aktivasi", "restore", "ip public", "ip publik", "pendaftaran", "perpanjangan",
    "mohon dibuatkan", "request", "pertanyaan", "konfigurasi", "pengajuan",
]
INFO_KW = ["status tiket", "cara ", "bagaimana", "persyaratan", "informasi"]

_ID_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "mei": 5, "may": 5, "jun": 6, "jul": 7,
    "agu": 8, "agt": 8, "aug": 8, "sep": 9, "okt": 10, "oct": 10, "nov": 11, "des": 12, "dec": 12,
}


def classify_ticket(text):
    """
    Usulan klasifikasi otomatis memakai kamus SOP 3.3. Hanya usulan: prioritas final
    ditetapkan Helpdesk berdasarkan dampak terverifikasi (bisa diubah lewat ticket_action).
    Return (priority, ticket_type, reason).
    """
    t = (text or "").lower()

    def first(words):
        return next((w for w in words if w in t), None)

    hit = first(CRITICAL_KW)
    if hit:
        return "Critical", "Insiden", f"Kata kunci kritis '{hit.strip()}' (SOP 3.3)"
    hit = first(MAJOR_KW)
    if hit:
        return "Major", "Insiden", f"Kata kunci gangguan '{hit.strip()}' (SOP 3.3)"
    hit = first(SERVICE_REQUEST_KW)
    if hit:
        return "Service Request", "Service request", f"Permintaan layanan '{hit.strip()}' (SOP 3.1/3.4)"
    hit = first(INFO_KW)
    if hit:
        return "Minor", "Informasi", f"Pertanyaan informasi '{hit.strip()}'"
    return "Minor", "Insiden", "Default Minor, dampak belum terverifikasi oleh Helpdesk"


def parse_itsm_date(s):
    """'29 Sep 2026 14:52:06 WIB' -> epoch (zona waktu lokal Mini PC = WIB). None jika gagal."""
    m = re.search(r"(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?", s or "")
    if not m:
        return None
    mon = _ID_MONTHS.get(m.group(2)[:3].lower())
    if not mon:
        return None
    try:
        return time.mktime((int(m.group(3)), mon, int(m.group(1)),
                            int(m.group(4) or 0), int(m.group(5) or 0), int(m.group(6) or 0), 0, 0, -1))
    except (ValueError, OverflowError):
        return None


def fmt_wib(ts):
    return time.strftime("%d %b %Y %H:%M:%S WIB", time.localtime(ts))


def fmt_hm(seconds):
    seconds = max(0, int(seconds))
    return f"{seconds // 3600}j {(seconds % 3600) // 60}m"


def add_history(entry, event, detail="", actor="Sentinel"):
    hist = entry.setdefault("history", [])
    hist.append({
        "ts": time.time(),
        "time": time.strftime("%d %b %Y %H:%M:%S"),
        "event": event,
        "detail": detail,
        "actor": actor,
    })
    if len(hist) > 100:
        del hist[:-100]


def track_ticket(tid, state, group=""):
    """Catat siklus hidup tiket: pertama terdeteksi, perubahan status, perpindahan group, respons pertama."""
    now = time.time()
    state = state or ""
    e = TICKET_REGISTRY.get(tid)
    if e is None:
        e = {
            "ticket_id": tid, "current_state": state, "reported_state": None,
            "first_seen": now, "last_seen": now, "group": group, "history": [],
            "seen_other_state": state.lower() != "assigned",
        }
        TICKET_REGISTRY[tid] = e
        add_history(e, "Terdeteksi Sentinel", f"Status {state or '-'} | Group {group or '-'}")
        return e

    e["last_seen"] = now
    e.setdefault("history", [])
    prev = e.get("current_state") or ""
    if state and prev.lower() != state.lower():
        add_history(e, "Status berubah", f"{prev or '-'} -> {state}")
        e["current_state"] = state
        if prev.lower() != "assigned":
            e["seen_other_state"] = True
        if "pending" in prev.lower() and "pending" not in state.lower() and not any(k in state.lower() for k in ("closed", "reject", "tolak", "cancel")):
            e.setdefault("docs", {}).setdefault("approval", {"ref": f"Status ITSM berubah dari {prev} ke {state}", "by": "Sentinel", "at": time.strftime("%d %b %Y %H:%M"), "auto": True})
        if not e.get("responded_ts") and any(k in state.lower() for k in ("progress", "pending", "resolved", "closed", "complete")):
            e["responded_ts"] = now
            add_history(e, "Respons pertama terdeteksi", f"Status beralih dari {prev or 'Assigned'}")
    if group and e.get("group") != group:
        if e.get("group"):
            add_history(e, "Assignment group berubah", f"{e['group']} -> {group}")
        e["group"] = group
    return e


def pic_for(layer, state):
    """PIC berdasarkan peran. Nama orang diambil dari config.pic_roster, bukan dikarang."""
    roster = CONFIG.get("pic_roster", {}) or {}
    sl = (state or "").lower()
    ll = (layer or "").lower()
    if "pending" in sl:
        role = "Tenan Approver"
        milestone = "Menunggu persetujuan/jawaban tenan (status Pending)"
        step = 2
    elif "l3" in ll:
        role = "EOS L3 (Expert)"
        milestone = "Analisis dan penanganan Expert L3"
        step = 4
    elif "l2" in ll:
        role = "EOS L2 (Engineer)"
        milestone = "Analisis dan perubahan oleh L2 Engineer"
        step = 4 if "progress" in sl else 3
    elif "eos" in ll:
        role = "EOS L1"
        milestone = "Penanganan teknis oleh EOS L1" if "progress" in sl else "Diterima EOS L1, menunggu diambil petugas"
        step = 4 if "progress" in sl else 3
    elif "noc" in ll:
        role = "NOC"
        milestone = "Penanganan jaringan oleh NOC" if "progress" in sl else "Diterima NOC, menunggu diambil petugas"
        step = 4 if "progress" in sl else 3
    elif "soc" in ll:
        role = "SOC"
        milestone = "Triase keamanan oleh SOC" if "progress" in sl else "Diterima SOC, menunggu diambil petugas"
        step = 4 if "progress" in sl else 3
    else:
        role = "Helpdesk L0"
        milestone = "Verifikasi tiket, klasifikasi, dan penugasan resolver"
        step = 3
    return roster.get(role) or role, role, milestone, step


def apply_sla(t, now=None):
    """Hitung SLA hidup (selalu dari waktu nyata, tidak dari angka yang dibekukan saat tiket dibuat)."""
    now = now or time.time()
    tid = t.get("ticketId", "")
    e = TICKET_REGISTRY.get(tid, {})

    prio = e.get("priority_override") or t.get("autoPriority") or "Minor"
    if prio not in SLA_HOURS:
        prio = "Minor"
    hours = SLA_HOURS[prio]
    sla_basis = f"Matriks prioritas {prio} ({hours} jam)"
    if prio == "Service Request":
        cat = t.get("serviceCategory") or ""
        if cat in SLA_CATALOG:
            d_, h_ = SLA_CATALOG[cat]
            hours = catalog_hours(cat)
            sla_basis = f"KAK 18.c {cat}: {d_} Hari {h_} Jam, dihitung {hours} jam total (tafsiran belum dikonfirmasi Tim GC1)"
        else:
            sla_basis = "Service request tanpa kategori layanan terdeteksi: baku 24 jam (pilih kategori agar SLA katalog berlaku)"
    created_ts = t.get("createdTs") or e.get("first_seen") or now
    state = (t.get("requestState") or "").lower()
    closed = any(k in state for k in CLOSED_STATES)

    deadline = created_ts + hours * 3600
    remaining = int(deadline - now)
    total = hours * 3600
    elapsed_pct = max(0, int((now - created_ts) / total * 100))
    pct_left = max(0, min(100, 100 - elapsed_pct))

    if closed:
        badge, text = "sla-safe", "Selesai"
    elif remaining <= 0:
        badge, text = "sla-breached", f"SLA lewat {fmt_hm(-remaining)}"
    elif pct_left < 25:
        badge, text = "sla-danger", f"Sisa {fmt_hm(remaining)}"
    elif pct_left < 50:
        badge, text = "sla-warning", f"Sisa {fmt_hm(remaining)}"
    else:
        badge, text = "sla-safe", f"Sisa {fmt_hm(remaining)}"

    # Respons pertama (SOP 3.2: < 15 menit)
    responded_ts = e.get("responded_ts")
    resp_deadline = created_ts + RESPONSE_SLA_SECONDS
    if responded_ts:
        late = responded_ts > resp_deadline
        resp_status = "late" if late else "ok"
        resp_text = f"Direspons {int((responded_ts - created_ts) // 60)} menit" + (" (terlambat)" if late else "")
    elif closed or "progress" in state or "pending" in state:
        resp_status, resp_text = "unknown", "Respons tidak teramati (tiket sudah berjalan saat terdeteksi)"
    elif now > resp_deadline:
        resp_status = "late"
        resp_text = f"Belum direspons ({int((now - created_ts) // 60)} menit)"
    else:
        resp_status = "due"
        resp_text = f"Respons dalam {int((resp_deadline - now) // 60) + 1} menit"

    flags = []
    if not closed:
        if resp_status == "late" and not responded_ts:
            flags.append("Respons >15 menit")
        if elapsed_pct >= 50 and "progress" not in state and "pending" not in state:
            flags.append("Lewat 50% SLA tanpa aktivitas resolver: laporkan ke Lead L0-L1 (SOP 5.6)")
        layer = (t.get("resolverLayer") or "").lower()
        if "eos l1" in layer or layer.startswith("helpdesk"):
            minutes_limit = ESCALATE_L2_MINUTES.get(prio, int(hours * 60 * 0.25))
            if (now - created_ts) / 60 >= minutes_limit and "l2" not in layer:
                flags.append(f"Batas eskalasi ke L2 ({minutes_limit} menit) terlewati (SOP 6.6)")
        if remaining <= 0:
            flags.append("SLA penyelesaian terlewati")

    is_pre = bool(t.get("isPreTicket"))
    if is_pre:
        # Pra-tiket WA: SLA resmi (KAK) hanya berjalan pada tiket di ITSM. Di sini yang dipantau: balasan 5-10 menit
        # dan pembukaan tiket di ITSM oleh tenan.
        warn_s = int(CONFIG.get("wa_reply_warn_minutes", 5)) * 60
        brk_s = int(CONFIG.get("wa_reply_breach_minutes", 10)) * 60
        open_s = int(CONFIG.get("wa_ticket_open_target_minutes", 15)) * 60
        elapsed = now - created_ts
        flags = []
        if responded_ts:
            late = responded_ts - created_ts > brk_s
            resp_status = "late" if late else "ok"
            resp_text = f"Dibalas {int((responded_ts - created_ts) // 60)} menit" + (" (lewat target)" if late else "")
        elif closed:
            resp_status, resp_text = "ok", "-"
        elif elapsed >= brk_s:
            resp_status = "late"
            resp_text = f"Belum dibalas ({int(elapsed // 60)} menit), target {brk_s // 60} menit"
            flags.append(f"Balasan WA terlambat ({int(elapsed // 60)} menit, target {warn_s // 60}-{brk_s // 60} menit)")
        elif elapsed >= warn_s:
            resp_status = "warn"
            resp_text = f"Segera balas ({int((brk_s - elapsed) // 60) + 1} menit lagi)"
            flags.append(f"Balasan WA belum dikirim ({int(elapsed // 60)} menit)")
        else:
            resp_status = "due"
            resp_text = f"Balas dalam {int((warn_s - elapsed) // 60) + 1} menit"
        linked = e.get("linked_portal") or t.get("linkedPortalId")
        if not closed:
            badge = "sla-warning"
            text = f"Tiket ITSM {linked}" if linked else "Menunggu tiket ITSM"
            if elapsed >= open_s and not linked:
                flags.append(f"Belum ada tiket di ITSM ({int(elapsed // 60)} menit): minta pelapor membuka tiket dulu")

    t.update({
        "priority": prio,
        "priorityOverridden": bool(e.get("priority_override")),
        "slaLimitHours": hours,
        "slaBasis": sla_basis,
        "createdTs": created_ts,
        "deadlineTs": deadline,
        "slaTargetTime": time.strftime("%d %b %Y %H:%M WIB", time.localtime(deadline)),
        "slaRemainingSeconds": max(0, remaining),
        "slaRemainingFormatted": fmt_hm(max(0, remaining)),
        "slaPercentRemaining": pct_left,
        "slaBadgeClass": badge,
        "slaStatusText": text,
        "slaClosed": closed,
        "slaBreached": (not closed) and remaining <= 0 and not is_pre,
        "slaMode": "pra-tiket" if is_pre else "",
        "responseStatus": resp_status,
        "responseText": resp_text,
        "updateEveryMin": UPDATE_INTERVAL_MIN.get(prio, 240),
        "escalationFlags": flags,
        "ai": e.get("ai"),
        "aiDecision": e.get("ai_decision"),
        "linkedPortalId": e.get("linked_portal") or t.get("linkedPortalId") or "",
        "history": e.get("history", []),
    })
    return t


def wa_tier_for(group):
    """Tingkat perhatian grup (1=P1 alarm, 2=P2 biasa, 3=P3 pasif) dari config.wa_priority_groups."""
    g = str(group or "").lower()
    for p in CONFIG.get("wa_priority_groups") or []:
        needle = str((p or {}).get("match", "")).strip().lower()
        if needle and needle in g:
            return p.get("tier") if p.get("tier") in (1, 2, 3) else 2
    return 2


def convert_wa_message_to_ticket(sender, group, text, matched_kw="GC 1", msg_id="", wa_ts=None, verified=None, instansi_hint="", summary_hint=""):
    """
    Konversi aduan grup WhatsApp menjadi pra-tiket di Dashboard GC 1 (SOP bab 4).
    Waktu aduan pertama (wa_ts) dipakai sebagai dasar SLA agar laporan sesuai fakta (SOP 4.4).
    """
    sender_clean = re.sub(r"[\r\n\t]+", " ", str(sender or "Member Grup WA")).strip()
    group_clean = re.sub(r"[\r\n\t]+", " ", str(group or "Grup Koordinasi Teknis GC 1")).strip()
    text_clean = re.sub(r"[\r\n\t]+", " ", str(text or "")).strip()
    if not text_clean:
        return None

    now = time.time()
    created_ts = float(wa_ts) if wa_ts else now
    created_ts = min(created_ts, now)

    # Nomor pra-tiket: counter harian berdasarkan nomor tertinggi yang ada (aman setelah data dipangkas)
    prefix = time.strftime("WA-GC1-%m%d", time.localtime(now))
    used = [int(m.group(1)) for w in WA_TICKETS
            for m in [re.match(re.escape(prefix) + r"-(\d+)$", w.get("ticketId", ""))] if m]
    tid = f"{prefix}-{(max(used) + 1 if used else 1):04d}"

    # Nomor tiket portal yang disebut tenan: ditautkan, bukan menggantikan nomor pra-tiket (SOP 4.2 Kondisi A)
    m_portal = re.search(r"(REQ-[A-Z0-9-]+|INC[0-9]+|TKT-[0-9]+)", text_clean, re.IGNORECASE)
    linked_portal = m_portal.group(1).upper() if m_portal else ""

    known_agencies = [
        "Kementerian Kesehatan", "Kemenkes", "Kementerian Keuangan", "Kemenkeu", "Bappenas",
        "Kementerian Komunikasi dan Digital", "Kominfo", "Komdigi", "KemenpanRB", "Kementerian PANRB",
        "Badan Pusat Statistik", "BPS", "BMKG", "Setneg", "Kemendagri", "Kemendikbud",
        "Pemprov", "Pemkab", "Pemkot",
    ]
    loc = "Instansi Pengguna PDN"
    search_scope = f"{sender_clean} {group_clean} {text_clean}".lower()
    for agency in known_agencies:
        if agency.lower() in search_scope:
            loc = agency
            break

    if instansi_hint:   # hasil NLP yang sudah dilihat/diubah operator menang atas deteksi generik
        loc = instansi_hint

    cleaned_desc = re.sub(
        r"^(selamat\s+(pagi|siang|sore|malam)|halo|dear\s+all|assalamu['a-z]+|mohon\s+izin|permisi)[,\.\s-]*",
        "", text_clean, flags=re.IGNORECASE).strip()
    short_desc = f"[Aduan WA] {cleaned_desc[:127]}..." if len(cleaned_desc) > 130 else f"[Aduan WA] {cleaned_desc}"
    if summary_hint:
        short_desc = f"[Aduan WA] {summary_hint[:127]}"

    prio, ttype, reason = classify_ticket(text_clean)
    hours = SLA_HOURS[prio]

    wa_ticket = {
        "ticketId": tid,
        "shortDesc": short_desc,
        "requestedFor": sender_clean,
        "requestState": "Assigned",
        "createdDate": fmt_wib(created_ts),
        "createdTs": created_ts,
        "detectedTs": now,
        "location": loc,
        "assignmentGroup": "Helpdesk",
        "resolverLayer": "Helpdesk (L0)",
        "isGc1": True,
        "isTelkom": False,
        "category": "team_assigned",
        "source": "WhatsApp Group",
        "isFromWa": True,
        "isPreTicket": True,
        "waGroup": group_clean,
        "waMsgId": str(msg_id or ""),
        "rawWaText": text_clean,
        "senderVerified": verified,
        "autoPriority": prio,
        "ticketType": ttype,
        "priorityReason": reason,
        "linkedPortalId": linked_portal,
        "activityMilestone": "Pra-tiket WA: verifikasi pelapor, cek tiket di portal, klasifikasi",
        "picName": (CONFIG.get("pic_roster", {}) or {}).get("Helpdesk L0") or "Helpdesk L0",
        "picRole": "Helpdesk L0",
        "workflowStep": 1,
        "slaLimitHours": hours,
        "timeline": [
            {"step": 1, "title": "Aduan diterima di grup WhatsApp",
             "desc": f"Pesan dari {sender_clean} di grup [{group_clean}].",
             "status": "completed", "actor": "WhatsApp Observer", "time": fmt_wib(created_ts)},
            {"step": 2, "title": "Verifikasi pelapor dan cek tiket di portal",
             "desc": "SOP 4.1-4.2: cocokkan pelapor dengan PIC instansi, cari tiket di pdn.layanan.go.id.",
             "status": "in_progress", "actor": "Helpdesk L0", "time": "Dalam proses"},
            {"step": 3, "title": "Tiket portal terbit / penanganan awal paralel",
             "desc": "Arahkan tenan membuat tiket resmi; Critical/Major langsung hubungi resolver (SOP 4.3).",
             "status": "pending", "actor": "Helpdesk L0", "time": "-"},
            {"step": 4, "title": "Penanganan oleh resolver L1/L2",
             "desc": "Mengikuti matriks RACI SOP.", "status": "pending", "actor": "Lead L0-L1", "time": "-"},
            {"step": 5, "title": "Konfirmasi balik ke tenan di grup WA",
             "desc": f"Helpdesk mengabari {sender_clean} dan meminta konfirmasi (SOP 5.6).",
             "status": "pending", "actor": "Helpdesk L0", "time": "-"},
        ],
    }

    WA_TICKETS.insert(0, wa_ticket)
    e = track_ticket(tid, "Assigned", "Helpdesk")
    e["first_seen"] = created_ts
    add_history(e, "Aduan pertama di WhatsApp", f"{sender_clean} @ {group_clean}", actor="WhatsApp Observer")
    if linked_portal:
        e["linked_portal"] = linked_portal
        add_history(e, "Nomor tiket portal disebut tenan", linked_portal, actor="WhatsApp Observer")
    ALERTS.insert(0, {
        "id": f"alt_{int(now * 1000)}",
        "sig": f"wa_ticket|{tid}|{sender_clean}",
        "source": "whatsapp",
        "ticketId": tid,
        "sender": sender_clean,
        "group": group_clean,
        "text": text_clean,
        "requestState": "Assigned",
        "matchedKeyword": matched_kw,
        "timestamp": int(created_ts * 1000),
        "dateString": time.strftime("%H:%M:%S", time.localtime(created_ts)),
        "status": "baru",
    })
    apply_sla(wa_ticket)
    archive_ticket(wa_ticket)
    save_persisted_data()
    return wa_ticket


def enrich_ticket_with_sop(t):
    """Lengkapi tiket dengan klasifikasi, PIC per peran, timeline, dan SLA hidup (SOP v0.2)."""
    if t.get("isFromWa"):
        t["serviceCategory"] = TICKET_REGISTRY.get(t.get("ticketId", ""), {}).get("category_override") or classify_category(t.get("rawWaText", ""))
        apply_sla(t)
        apply_identity(t)
        return apply_docs(t)

    tid = t.get("ticketId", "")
    desc = t.get("shortDesc", "")
    state_val = t.get("requestState", "Assigned")
    resolver_layer = t.get("resolverLayer", "Helpdesk (L0)")
    req_for = t.get("requestedFor", "")
    created_date = t.get("createdDate", "")

    # Waktu masuk: dari portal; jika tidak terbaca, waktu pertama kali Sentinel melihat tiket (tidak dikarang)
    e = TICKET_REGISTRY.get(tid, {})
    parsed = parse_itsm_date(created_date)
    t["createdTs"] = parsed or e.get("first_seen") or time.time()
    t["createdTsEstimated"] = parsed is None

    t["serviceCategory"] = e.get("category_override") or classify_category(desc)
    prio, ttype, reason = classify_ticket(desc)
    t["autoPriority"] = prio
    t["ticketType"] = ttype
    t["priorityReason"] = reason
    if "serviceType" not in t:
        lk = (t.get("itsmLists") or [""])[0] if isinstance(t.get("itsmLists"), list) else ""
        t["serviceType"] = sentinel_db.normalize_service_type(tid, desc, lk)

    pic_name, pic_role, milestone, step_num = pic_for(resolver_layer, state_val)
    t["picName"] = pic_name
    t["picRole"] = pic_role
    t["activityMilestone"] = milestone
    t["workflowStep"] = step_num

    sl = state_val.lower()
    done = any(k in sl for k in CLOSED_STATES)
    pending = "pending" in sl
    progress = "progress" in sl
    t["timeline"] = [
        {"step": 1, "title": "Registrasi dan triase portal PDN",
         "desc": "Tiket tercatat di ITSM pdn.layanan.go.id dan identitas tenan diverifikasi.",
         "status": "completed", "actor": "Helpdesk L0", "time": created_date or "-"},
        {"step": 2, "title": "Verifikasi administrasi dan approval",
         "desc": "Pemeriksaan persetujuan pejabat instansi tenan K/L.",
         "status": "in_progress" if pending else "completed",
         "actor": req_for or "Pejabat K/L", "time": "Menunggu approval" if pending else "Telah disetujui"},
        {"step": 3, "title": "Assignment ke resolver (L1/L2)",
         "desc": f"Penugasan teknis ke {resolver_layer} sesuai matriks RACI SOP.",
         "status": "completed" if (progress or done) else ("in_progress" if not pending else "pending"),
         "actor": "Lead L0-L1", "time": "Aktif" if not (progress or done or pending) else ("Selesai" if (progress or done) else "-")},
        {"step": 4, "title": "Eksekusi teknis",
         "desc": "Konfigurasi sistem, compute/storage hypervisor, atau jaringan.",
         "status": "completed" if done else ("in_progress" if progress else "pending"),
         "actor": pic_name, "time": "Sedang berjalan" if progress else ("Selesai" if done else "Antrean teknis")},
        {"step": 5, "title": "Validasi tenan dan penutupan tiket",
         "desc": "Konfirmasi hasil pengerjaan dengan tenan (SOP 5.6).",
         "status": "completed" if done else "pending", "actor": "Helpdesk L0 dan tenan", "time": "Selesai" if done else "-"},
    ]
    apply_sla(t)
    return apply_docs(t)


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
    if not entry or (entry.get("reported_state") is None and not entry.get("seen_other_state")):
        entry = entry or {}
        # 1. Tiket baru sama sekali berstatus Assigned
        TICKET_REGISTRY[tid] = {
            **entry,
            "ticket_id": tid,
            "current_state": "Assigned",
            "reported_state": "Assigned",
            "first_seen": entry.get("first_seen", time.time()),
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


def _day_bounds(day):
    try:
        start = time.mktime(time.strptime(day, "%Y-%m-%d"))
    except ValueError:
        start = time.mktime(time.strptime(time.strftime("%Y-%m-%d"), "%Y-%m-%d"))
    return start, start + 86400


def build_daily_recap(day):
    """Rekap harian aduan WA vs tiket portal (SOP 4.4) untuk ditindaklanjuti Lead L0-L1."""
    start, end = _day_bounds(day)
    wa_today = [w for w in WA_TICKETS if start <= (w.get("createdTs") or 0) < end]
    itsm_ids = {(t.get("ticketId") or "").strip() for t in HELPDESK_SNAPSHOT}
    itsm_today = [t for t in HELPDESK_SNAPSHOT
                  if start <= (parse_itsm_date(t.get("createdDate", "")) or 0) < end]

    def linked(w):
        lid = TICKET_REGISTRY.get(w["ticketId"], {}).get("linked_portal") or w.get("linkedPortalId") or ""
        return lid

    wa_linked = [w for w in wa_today if linked(w)]
    wa_unlinked = [w for w in wa_today if not linked(w)]
    return {
        "date": day,
        "wa_total": len(wa_today),
        "wa_linked": len(wa_linked),
        "wa_unlinked": len(wa_unlinked),
        "wa_linked_found_in_portal": len([w for w in wa_linked if linked(w) in itsm_ids]),
        "portal_total": len(itsm_today),
        "gap": len(wa_unlinked),
        "unlinked_items": [
            {"ticketId": w["ticketId"], "sender": w.get("requestedFor"), "group": w.get("waGroup"),
             "text": (w.get("rawWaText") or "")[:140], "time": w.get("createdDate")}
            for w in wa_unlinked
        ],
        "telkom_skipped_last_sync": TELKOM_SKIPPED,
        "note": "Aduan WA tanpa tiket portal wajib dimintakan tiketnya ke tenan (SOP 4.4).",
    }


CASE_STATUSES = ("unknown", "asked", "claimed", "registration_requested", "rejected")
_PHONE_RE = re.compile(r"(?<!\d)(?:\+?62|0)8\d[\d\s-]{6,12}\d")


def normalize_phone(raw):
    """Nomor HP -> 62xxxxxxxxxx (hanya digit). String kosong bila tidak tampak sebagai nomor."""
    digits = re.sub(r"\D", "", str(raw or ""))
    if digits.startswith("0"):
        digits = "62" + digits[1:]
    elif digits.startswith("8") and 9 <= len(digits) <= 12:
        digits = "62" + digits
    return digits if 10 <= len(digits) <= 15 else ""


def looks_like_phone(text):
    t = str(text or "").strip()
    return bool(re.fullmatch(r"\+?[\d\s\-()]{8,24}", t)) and bool(normalize_phone(t))


def mask_phones(text):
    """Samarkan nomor HP kecuali 4 digit terakhir (dipakai untuk tampilan tim)."""
    return _PHONE_RE.sub(lambda m: re.sub(r"\d(?=(?:\D*\d){4})", "*", m.group(0)), text)


def identity_for(phone):
    if phone and phone in PIC_REGISTRY:
        e = PIC_REGISTRY[phone]
        return {"status": "verified", "phone": phone, "name": e.get("name", ""), "instansi": e.get("instansi", "")}
    if phone and phone in IDENTITY_CASES:
        c = IDENTITY_CASES[phone]
        return {"status": c.get("status", "unknown"), "phone": phone, "claimedName": c.get("claimedName", ""),
                "claimedInstansi": c.get("claimedInstansi", ""), "komdigiRef": c.get("komdigiRef", "")}
    return {"status": "unknown" if phone else "no_phone", "phone": phone or ""}


def ensure_case(phone, tid):
    c = IDENTITY_CASES.setdefault(phone, {"phone": phone, "status": "unknown", "claimedName": "", "claimedInstansi": "",
                                          "komdigiRef": "", "firstSeen": time.time(), "ticketIds": [], "history": []})
    if tid and tid not in c["ticketIds"]:
        c["ticketIds"].append(tid)
    return c


def case_event(case, text, by="Sentinel", detail=""):
    """Catat di kasus dan di riwayat setiap tiket dari nomor itu."""
    case.setdefault("history", []).append({"ts": time.time(), "time": time.strftime("%d %b %Y %H:%M:%S"), "event": text, "detail": detail, "actor": by})
    for tid in case.get("ticketIds", []):
        e = TICKET_REGISTRY.get(tid)
        if e is not None:
            add_history(e, text, detail, actor=by)


def apply_identity(t):
    """Status identitas pelapor (SOP 4.1) dihitung hidup dari registri, jadi verifikasi langsung berlaku ke semua tiketnya."""
    phone = t.get("senderPhone", "") or ""
    ident = identity_for(phone)
    t["identity"] = ident
    flags = list(t.get("escalationFlags") or [])
    closed = t.get("slaClosed")
    st = ident["status"]
    if st == "verified":
        t["requestedFor"] = f"{ident['name']} ({ident['instansi']})"
        t["location"] = ident["instansi"] or t.get("location", "")
        t["senderVerified"] = True
    elif st == "rejected":
        t["senderVerified"] = False
        t["requestState"] = "Closed"
        t["slaClosed"] = True
        t["slaStatusText"] = "Ditolak: bukan tenan"
        t["slaBadgeClass"] = "sla-safe"
        t["slaBreached"] = False
        flags = ["Pelapor ditolak (bukan tenan terdaftar), aduan dihentikan (SOP 4.1)"]
    elif st == "no_phone":
        if t.get("senderVerified") is not True:
            t["senderVerified"] = False if t.get("senderVerified") is False else None
            if not closed:
                flags.append("Nomor HP pelapor belum dicatat: lengkapi untuk verifikasi identitas (SOP 4.1)")
    else:
        t["senderVerified"] = False
        if not closed:
            flags.append("Nomor belum terdaftar: tanyakan asal dan instansi, jangan beri informasi layanan (SOP 4.1)")
    t["escalationFlags"] = flags
    return t


DOC_LABELS = {"approval": "Approval pejabat/atasan pemohon", "nota_dinas": "Nota dinas"}


def apply_docs(t):
    """Syarat dokumen per jenis permintaan (mis. pembuatan akun: approval + nota dinas). Hanya pencatatan, tidak memblokir sistem lain."""
    text = f"{t.get('shortDesc', '')} {t.get('rawWaText', '')}".lower()
    rule = next((r for r in (CONFIG.get("doc_rules") or []) if any(k in text for k in r.get("keywords", []))), None)
    if not rule:
        t["docs"] = None
        return t
    e = TICKET_REGISTRY.get(t.get("ticketId", ""), {})
    have = e.get("docs", {})
    items, complete = [], True
    for key in rule.get("docs", []):
        d = have.get(key)
        items.append({"key": key, "label": DOC_LABELS.get(key, key), "ok": bool(d), "ref": (d or {}).get("ref", ""),
                      "by": (d or {}).get("by", ""), "at": (d or {}).get("at", ""), "auto": bool((d or {}).get("auto"))})
        complete = complete and bool(d)
    t["docs"] = {"rule": rule.get("name", ""), "items": items, "complete": complete}
    if not complete and not t.get("slaClosed"):
        missing = ", ".join(i["label"].lower() for i in items if not i["ok"])
        t["escalationFlags"] = list(t.get("escalationFlags") or []) + [f"Syarat {rule.get('name', '').lower()} belum lengkap ({missing}): jangan diproses dulu"]
    return t


def resolve_itsm_list(info):
    """Tentukan daftar ITSM (Request/Insiden/...) dari judul, path, atau explicit key dari ekstensi."""
    info = info if isinstance(info, dict) else {}
    explicit_key = str(info.get("key") or "").strip().lower()
    if explicit_key:
        label = str(info.get("label") or ("Tiket Insiden" if ("inc" in explicit_key or "assign" in explicit_key) else "Tiket Request"))
        return explicit_key, label, str(info.get("title") or "")[:160], str(info.get("path") or "")[:200]
    title = str(info.get("title") or "")[:160]
    path = str(info.get("path") or "")[:200]
    text = f"{title} {path}".lower()
    if not text.strip():
        return "itsm", "ITSM", title, path
    for e in CONFIG.get("itsm_lists") or []:
        if any(str(m).lower() in text for m in e.get("match", [])):
            return e["key"], e.get("label", e["key"]), title, path
    if "assign" in text or "penugasan" in text:
        return "assign", "Assign", title, path
    return "lainnya", "ITSM (halaman lain)", title, path


def merge_itsm_lists():
    """Gabung semua daftar ITSM jadi satu kolam tiket. Tiket yang muncul di beberapa daftar memuat semua keanggotaannya."""
    merged = {}
    for key, lst in sorted(HELPDESK_LISTS.items(), key=lambda kv: kv[1].get("synced_at", 0)):
        for t in lst.get("tickets", []):
            tid = t.get("ticketId")
            if not tid:
                continue
            members = sorted(set((merged.get(tid) or {}).get("itsmLists", [])) | {key})
            nt = dict(t)
            nt["itsmLists"] = members
            merged[tid] = nt
    return list(merged.values())


def itsm_lists_info():
    now = time.time()
    entries = [dict(e) for e in (CONFIG.get("itsm_lists") or [])]
    known = {e["key"] for e in entries}
    entries += [{"key": k, "label": v.get("label", k)} for k, v in HELPDESK_LISTS.items() if k not in known]
    out = []
    for e in entries:
        lst = HELPDESK_LISTS.get(e["key"])
        tickets = lst.get("tickets", []) if lst else []
        telkom_in_list = len([t for t in tickets if t.get("isTelkom") or "telkom" in (t.get("assignmentGroup", "") + " " + t.get("shortDesc", "")).lower()])
        open_in_list = len([t for t in tickets if not t.get("slaClosed")])
        out.append({
            "key": e["key"],
            "label": e.get("label", e["key"]),
            "legacy": e["key"] == "itsm",
            "count": len(tickets),
            "open_count": open_in_list,
            "team_count": len(tickets) - telkom_in_list,
            "telkom_count": telkom_in_list,
            "pagination": (lst or {}).get("pagination"),
            "synced_at": lst.get("synced_at") if lst else None,
            "age_sec": int(now - lst["synced_at"]) if lst else None,
            "title": (lst or {}).get("title", "")
        })
    return out


def archive_ticket(t):
    """Simpan ringkasan tiap tiket yang pernah terpantau, agar laporan periode tidak bergantung pada daftar layar saat ini."""
    tid = t.get("ticketId")
    if not tid:
        return
    e = TICKET_REGISTRY.get(tid, {})
    rec = TICKET_ARCHIVE.get(tid) or {"ticketId": tid, "firstSeenTs": e.get("first_seen") or time.time()}
    state = t.get("requestState", "") or ""
    closed = any(k in state.lower() for k in CLOSED_STATES)
    rec.update({
        "source": "Pra-tiket WA" if t.get("isFromWa") else "Portal ITSM",
        "linkedPortalId": t.get("linkedPortalId", "") or "",
        "location": t.get("location", "") or "",
        "requestedFor": t.get("requestedFor", "") or "",
        "shortDesc": (t.get("shortDesc", "") or "")[:200],
        "ticketType": t.get("ticketType", "") or "",
        "priority": t.get("priority") or t.get("autoPriority") or "Minor",
        "priorityOverridden": bool(t.get("priorityOverridden")),
        "state": state,
        "layer": t.get("resolverLayer", "") or "",
        "createdTs": t.get("createdTs") or rec["firstSeenTs"],
        "respondedTs": e.get("responded_ts"),
        "waFirstReportAt": t.get("waFirstReportAt", "") or "",
        "waGroup": t.get("waGroup", "") or "",
        "itsmLists": sorted(set(rec.get("itsmLists") or []) | set(t.get("itsmLists") or [])),   # akumulatif: riwayat daftar tempat tiket pernah muncul
        "serviceCategory": t.get("serviceCategory", "") or "",
        "slaHours": t.get("slaLimitHours"),
        "docsRule": (t.get("docs") or {}).get("rule", ""),
        "docsComplete": (t.get("docs") or {}).get("complete", True),
    })
    if closed:
        rec.setdefault("closedSeenTs", time.time())
    else:
        rec.pop("closedSeenTs", None)  # dibuka kembali
    rec["maxEscalations"] = max(rec.get("maxEscalations", 0), len(t.get("escalationFlags") or []))
    TICKET_ARCHIVE[tid] = rec


def period_bounds(kind, day):
    """(awal, akhir, label) untuk laporan harian / mingguan (Senin-Minggu) / bulanan."""
    try:
        d = datetime.datetime.strptime(day, "%Y-%m-%d")
    except (TypeError, ValueError):
        d = datetime.datetime.now()
    if kind == "weekly":
        s = (d - datetime.timedelta(days=d.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        e = s + datetime.timedelta(days=7)
        label = f"Minggu {s.strftime('%d %b %Y')} - {(e - datetime.timedelta(days=1)).strftime('%d %b %Y')}"
    elif kind == "monthly":
        s = d.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        e = (s.replace(year=s.year + 1, month=1) if s.month == 12 else s.replace(month=s.month + 1))
        label = s.strftime("Bulan %B %Y")
    else:
        s = d.replace(hour=0, minute=0, second=0, microsecond=0)
        e = s + datetime.timedelta(days=1)
        label = s.strftime("Hari %d %b %Y")
    return s.timestamp(), e.timestamp(), label


def sla_outcome(rec, now):
    if rec.get("source") == "Pra-tiket WA":
        return "Pra-tiket (SLA resmi dari tiket ITSM)", rec["createdTs"]
    hours = rec.get("slaHours") or SLA_HOURS.get(rec.get("priority"), 24)
    deadline = rec["createdTs"] + hours * 3600
    closed = rec.get("closedSeenTs")
    if closed:
        return ("Tepat waktu" if closed <= deadline else "Terlambat"), deadline
    return ("Lewat SLA (masih terbuka)" if now > deadline else "Dalam SLA (terbuka)"), deadline


def compute_report(kind, day, itsm_list=None):
    now = time.time()
    start, end, label = period_bounds(kind, day)
    all_rows = [r for r in TICKET_ARCHIVE.values() if start <= r.get("createdTs", 0) < end]
    rows = [r for r in all_rows if r.get("source") != "Pra-tiket WA"]   # SLA KAK: hanya tiket ITSM
    if itsm_list:
        rows = [r for r in rows if itsm_list in (r.get("itsmLists") or [])]
    pre_rows = [r for r in all_rows if r.get("source") == "Pra-tiket WA"]
    n = len(rows)

    def count_by(key):
        out = {}
        for r in rows:
            out[r.get(key) or "-"] = out.get(r.get(key) or "-", 0) + 1
        return dict(sorted(out.items(), key=lambda kv: -kv[1]))

    outcomes = {"Tepat waktu": 0, "Terlambat": 0, "Lewat SLA (masih terbuka)": 0, "Dalam SLA (terbuka)": 0}
    for r in rows:
        outcomes[sla_outcome(r, now)[0]] += 1
    judged = outcomes["Tepat waktu"] + outcomes["Terlambat"] + outcomes["Lewat SLA (masih terbuka)"]
    sla_pct = round(outcomes["Tepat waktu"] / judged * 100, 1) if judged else None

    def kak_outcome(r):
        hrs = KAK_INCIDENT_BAKU_HOURS if r.get("ticketType") == "Insiden" else (r.get("slaHours") or 24)
        deadline = r["createdTs"] + hrs * 3600
        c = r.get("closedSeenTs")
        return ("ok" if c <= deadline else "late") if c else ("late" if now > deadline else "open")
    kak = [kak_outcome(r) for r in rows]
    kak_judged = kak.count("ok") + kak.count("late")
    sla_kak_pct = round(kak.count("ok") / kak_judged * 100, 1) if kak_judged else None
    cats = {}
    for r, k in zip(rows, kak):
        c = cats.setdefault(r.get("serviceCategory") or "Belum terklasifikasi", {"kategori": r.get("serviceCategory") or "Belum terklasifikasi", "request": 0, "insiden": 0, "ok": 0, "late": 0})
        c["insiden" if r.get("ticketType") == "Insiden" else "request"] += 1
        if k in ("ok", "late"):
            c[k] += 1
    by_category = []
    for c in sorted(cats.values(), key=lambda x: -(x["request"] + x["insiden"])):
        j = c["ok"] + c["late"]
        by_category.append({"kategori": c["kategori"], "request": c["request"], "insiden": c["insiden"], "sla_pct": round(c["ok"] / j * 100, 1) if j else None})
    resp_known = [r for r in rows if r.get("respondedTs")]
    resp_ok = [r for r in resp_known if r["respondedTs"] - r["createdTs"] <= RESPONSE_SLA_SECONDS]
    resp_pct = round(len(resp_ok) / len(resp_known) * 100, 1) if resp_known else None

    # tren: per jam (harian) atau per hari (mingguan/bulanan)
    trend = {}
    for r in rows:
        dt = datetime.datetime.fromtimestamp(r["createdTs"])
        key = dt.strftime("%H:00") if kind == "daily" else dt.strftime("%Y-%m-%d")
        trend[key] = trend.get(key, 0) + 1

    prev_s = start - (end - start) if kind != "monthly" else period_bounds("monthly", datetime.datetime.fromtimestamp(start - 86400).strftime("%Y-%m-%d"))[0]
    prev_n = len([r for r in TICKET_ARCHIVE.values() if prev_s <= r.get("createdTs", 0) < start and r.get("source") != "Pra-tiket WA"])
    brk_s = int(CONFIG.get("wa_reply_breach_minutes", 10)) * 60
    wa_replied = [r for r in pre_rows if r.get("respondedTs")]
    wa_reply_ok = [r for r in wa_replied if r["respondedTs"] - r["createdTs"] <= brk_s]

    wa = [w for w in WA_TICKETS if start <= (w.get("createdTs") or 0) < end]
    wa_linked = [w for w in wa if TICKET_REGISTRY.get(w["ticketId"], {}).get("linked_portal") or w.get("linkedPortalId")]

    hours_total = max(1, int((min(end, now) - start) // 3600) + (1 if min(end, now) > start else 0))
    hours_cov = 0
    t = start
    while t < min(end, now):
        if time.strftime("%Y-%m-%d %H", time.localtime(t)) in SYNC_HOURS:
            hours_cov += 1
        t += 3600
    hours_total = max(1, int(-(-(min(end, now) - start) // 3600)))

    top_agencies = sorted(count_by("location").items(), key=lambda kv: -kv[1])[:5]
    cm = [
        {"ticketId": r["ticketId"], "location": r["location"], "priority": r["priority"], "state": r["state"],
         "desc": r["shortDesc"], "sla": sla_outcome(r, now)[0]}
        for r in all_rows if r.get("priority") in ("Critical", "Major")
    ]

    return {
        "kind": kind, "label": label, "start": start, "end": end,
        "generated": time.strftime("%d %b %Y %H:%M:%S WIB"),
        "total": n, "previous_total": prev_n,
        "by_source": {k: len([r for r in all_rows if r.get("source") == k]) for k in sorted({r.get("source") for r in all_rows})}, "by_type": count_by("ticketType"), "by_priority": count_by("priority"),
        "open": len([r for r in rows if not r.get("closedSeenTs")]),
        "closed": len([r for r in rows if r.get("closedSeenTs")]),
        "sla_outcomes": outcomes, "sla_compliance_pct": sla_pct,
        "response_within_15m_pct": resp_pct, "response_known": len(resp_known),
        "response_unknown": n - len(resp_known),
        "escalated_tickets": len([r for r in rows if r.get("maxEscalations")]),
        "trend": dict(sorted(trend.items())),
        "top_agencies": top_agencies,
        "critical_major": cm,
        "wa_total": len(wa), "wa_linked": len(wa_linked), "wa_unlinked": len(wa) - len(wa_linked),
        "docs_incomplete": len([r for r in rows if r.get("docsRule") and not r.get("docsComplete") and not r.get("closedSeenTs")]),
        "kak_items": [{"no": n_, "item": i_, "cakupan": c_, "sumber": s_} for n_, i_, c_, s_ in KAK_MONTHLY_ITEMS] if kind == "monthly" else [],
        "sla_kak_compliance_pct": sla_kak_pct,
        "by_category": by_category,
        "wa_reply_target_minutes": brk_s // 60,
        "wa_reply_within_target_pct": round(len(wa_reply_ok) / len(wa_replied) * 100, 1) if wa_replied else None,
        "wa_reply_known": len(wa_replied), "wa_reply_unknown": len(pre_rows) - len(wa_replied),
        "wa_unverified": len([w for w in wa if identity_for(w.get("senderPhone", ""))["status"] != "verified"]),
        "coverage_pct": round(hours_cov / hours_total * 100, 1),
        "coverage_hours": f"{hours_cov} dari {hours_total} jam",
        "monitor_start": time.strftime("%d %b %Y %H:%M", time.localtime(MONITOR_START)) if MONITOR_START else "-",
        "telkom_skipped_last_sync": TELKOM_SKIPPED,
        "notes": [
            "SLA resmi (KAK) hanya dihitung untuk tiket di ITSM. Pra-tiket WA dipantau terpisah: balasan dalam 5-10 menit dan pembukaan tiket di ITSM.",
            "DATA TERPANTAU Sentinel untuk pantauan bersama. BUKAN angka resmi: angka laporan KAK diambil dari portal ITSM (SOP 11.4).",
            "Sentinel hanya melihat baris yang tampil di layar ITSM saat aplikasi aktif; lihat 'Cakupan pemantauan' untuk celahnya.",
            "Waktu selesai = saat Sentinel pertama kali melihat status Resolved/Closed, bukan waktu resmi di portal.",
            "SLA: Critical 4 jam, Major 8 jam, Minor 24 jam, Service Request 24 jam baku (katalog KAK 18.c belum dikonfirmasi BPO). Jam SLA tidak berhenti saat Pending.",
            "Prioritas berasal dari usulan otomatis kecuali ditandai ditetapkan Helpdesk.",
            "SLA request memakai Katalog Layanan KAK 18.c per kategori; 'N Hari, M Jam' dibaca sebagai durasi total (belum dikonfirmasi Tim GC1). Kategori ditentukan dari kata kunci dan bisa diubah petugas.",
            "Baris 'batas baku KAK' menilai insiden terhadap 24 jam 15 menit (KAK 18.c); baris SLA lain memakai matriks prioritas SOP (Critical 4, Major 8, Minor 24 jam).",
            "Respons pertama hanya dihitung bila terobservasi; yang tidak teramati dilaporkan terpisah.",
        ],
    }


def build_report_html(rep):
    e = htmllib.escape

    def table(title, data):
        rows = "".join(f"<tr><td>{e(str(k))}</td><td style='text-align:right'>{e(str(v))}</td></tr>" for k, v in data.items())
        return f"<h3>{e(title)}</h3><table>{rows or '<tr><td colspan=2><em>Tidak ada data</em></td></tr>'}</table>"

    cm = "".join(
        f"<tr><td>{e(c['ticketId'])}</td><td>{e(c['location'])}</td><td>{e(c['priority'])}</td><td>{e(c['state'])}</td><td>{e(c['sla'])}</td><td>{e(c['desc'])}</td></tr>"
        for c in rep["critical_major"])
    pct = lambda v: "-" if v is None else f"{v}%"
    cat_rows = "".join(f"<tr><td>{e(c['kategori'])}</td><td style='text-align:right'>{c['request']}</td><td style='text-align:right'>{c['insiden']}</td><td style='text-align:right'>{pct(c['sla_pct'])}</td></tr>" for c in rep["by_category"])
    cat_table = f"<h3>Per kategori layanan (KAK 8.5.h)</h3><table><tr><th>Kategori</th><th>Request</th><th>Insiden</th><th>SLA</th></tr>{cat_rows or '<tr><td colspan=4><em>Tidak ada data</em></td></tr>'}</table>"
    _lbl = {"ya": "Tercakup", "sebagian": "Sebagian", "tidak": "Tidak dari Sentinel"}
    kak_rows = "".join(f"<tr><td>{k['no']}</td><td>{e(k['item'])}</td><td>{_lbl[k['cakupan']]}</td><td>{e(k['sumber'])}</td></tr>" for k in rep.get("kak_items", []))
    kak_table = f"<h3>Cakupan terhadap 14 item laporan bulanan KAK 8.5.f</h3><table><tr><th>No</th><th>Item</th><th>Cakupan</th><th>Sumber data</th></tr>{kak_rows}</table>" if kak_rows else ""
    kind_name = {"daily": "Harian", "weekly": "Mingguan", "monthly": "Bulanan"}[rep["kind"]]
    return f"""<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Laporan {kind_name} GC 1 (data terpantau)</title>
<style>body{{font:13px/1.45 Segoe UI,Arial,sans-serif;margin:24px;color:#0f172a}}h1{{font-size:20px;margin:0}}h3{{margin:18px 0 6px;font-size:14px}}
table{{border-collapse:collapse;min-width:360px}}td,th{{border:1px solid #cbd5e1;padding:4px 10px;text-align:left}}th{{background:#f1f5f9}}
.warn{{background:#fffbeb;border:1px solid #fde68a;padding:10px 14px;border-radius:6px;margin:12px 0}}@media print{{.noprint{{display:none}}}}</style></head><body>
<h1>Laporan {kind_name} GC 1: {e(rep['label'])}</h1><div>Dibuat {e(rep['generated'])} oleh GC 1 Sentinel &middot; <strong>DATA TERPANTAU, bukan angka resmi</strong></div>
<div class="warn"><strong>Cakupan pemantauan:</strong> {e(rep['coverage_hours'])} ({rep['coverage_pct']}%). Sentinel aktif sejak {e(rep['monitor_start'])}.<br>{'<br>'.join(e(n) for n in rep['notes'])}</div>
<h3>Ringkasan</h3><table>
<tr><td>Total tiket masuk (periode ini)</td><td>{rep['total']}</td></tr><tr><td>Periode sebelumnya</td><td>{rep['previous_total']}</td></tr>
<tr><td>Terbuka / selesai (terpantau)</td><td>{rep['open']} / {rep['closed']}</td></tr>
<tr><td>Kepatuhan SLA penyelesaian (target &gt; 95%)</td><td>{pct(rep['sla_compliance_pct'])}</td></tr>
<tr><td>Kepatuhan SLA menurut batas baku KAK 18.c (insiden 24 jam 15 menit; request sesuai katalog)</td><td>{pct(rep['sla_kak_compliance_pct'])}</td></tr>
<tr><td>Respons pertama &lt; 15 menit</td><td>{pct(rep['response_within_15m_pct'])} (teramati {rep['response_known']}, tidak teramati {rep['response_unknown']})</td></tr>
<tr><td>Tiket dengan penanda eskalasi</td><td>{rep['escalated_tickets']}</td></tr>
<tr><td>Aduan WA / sudah bertiket / belum bertiket</td><td>{rep['wa_total']} / {rep['wa_linked']} / {rep['wa_unlinked']}</td></tr>
<tr><td>Balasan WA dalam target {rep['wa_reply_target_minutes']} menit</td><td>{'-' if rep['wa_reply_within_target_pct'] is None else str(rep['wa_reply_within_target_pct']) + '%'} (teramati {rep['wa_reply_known']}, tidak teramati {rep['wa_reply_unknown']})</td></tr>
<tr><td>Aduan WA dari pelapor belum terverifikasi</td><td>{rep['wa_unverified']}</td></tr>
<tr><td>Tiket dengan syarat dokumen belum lengkap (mis. approval/nota dinas)</td><td>{rep['docs_incomplete']}</td></tr></table>
{cat_table}{kak_table}{table('Hasil SLA', rep['sla_outcomes'])}{table('Per sumber', rep['by_source'])}{table('Per tipe', rep['by_type'])}{table('Per prioritas', rep['by_priority'])}
{table('Tren', rep['trend'])}{table('Instansi terbanyak', dict(rep['top_agencies']))}
<h3>Insiden Critical / Major</h3><table><tr><th>Tiket</th><th>Instansi</th><th>Prioritas</th><th>Status</th><th>SLA</th><th>Uraian</th></tr>{cm or '<tr><td colspan=6><em>Tidak ada</em></td></tr>'}</table>
<p class="noprint"><button onclick="window.print()">Cetak / Simpan PDF</button></p></body></html>"""


def build_export_csv(kind="daily", day=""):
    """Ekspor baris tiket terarsip untuk periode (atau semua bila day kosong) ke CSV untuk Excel Output Helpdesk."""
    import csv
    import io
    now = time.time()
    start, end = (0, float("inf")) if not day else period_bounds(kind, day)[:2]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Sumber", "No Tiket", "Tiket Portal Tertaut", "Instansi", "Pemohon", "Uraian", "Tipe", "Prioritas",
                "Prioritas Ditetapkan Helpdesk", "Status Terakhir Terpantau", "Resolver", "Waktu Masuk",
                "Waktu Aduan Pertama WA", "Waktu Respons Pertama", "Respons (menit)", "Batas SLA", "Hasil SLA",
                "Waktu Selesai Terpantau", "Syarat Dokumen"])
    for r in sorted(TICKET_ARCHIVE.values(), key=lambda x: x.get("createdTs", 0)):
        if not (start <= r.get("createdTs", 0) < end):
            continue
        outcome, deadline = sla_outcome(r, now)
        resp = r.get("respondedTs")
        w.writerow([
            r.get("source"), r["ticketId"], r.get("linkedPortalId"), r.get("location"), r.get("requestedFor"),
            r.get("shortDesc"), r.get("ticketType"), r.get("priority"), "Ya" if r.get("priorityOverridden") else "Usulan otomatis",
            r.get("state"), r.get("layer"), fmt_wib(r["createdTs"]), r.get("waFirstReportAt"),
            fmt_wib(resp) if resp else "", int((resp - r["createdTs"]) // 60) if resp else "",
            fmt_wib(deadline), outcome, fmt_wib(r["closedSeenTs"]) if r.get("closedSeenTs") else "",
            "-" if not r.get("docsRule") else ("Lengkap" if r.get("docsComplete") else "Belum lengkap"),
        ])
    return buf.getvalue()


def build_team_tickets():
    """Kolam tiket lingkup GC 1: tiket ITSM + pra-tiket WA (yang sudah tertaut tidak ditampilkan dua kali), sudah diperkaya."""
    # ITSM adalah sumber resmi. Pra-tiket WA yang sudah tertaut ke tiket portal
    # tidak ditampilkan dua kali: tiket portal diberi anotasi waktu aduan pertama WA.
    itsm_ids = {(t.get("ticketId") or "").strip() for t in HELPDESK_SNAPSHOT}
    wa_by_portal = {}
    for w in WA_TICKETS:
        lid = TICKET_REGISTRY.get(w.get("ticketId"), {}).get("linked_portal") or w.get("linkedPortalId") or ""
        if lid:
            wa_by_portal.setdefault(lid, w)

    pool, seen_ids = [], set()
    for t in HELPDESK_SNAPSHOT:
        tid = (t.get("ticketId") or "").strip()
        if not tid or tid in seen_ids:
            continue
        seen_ids.add(tid)
        w = wa_by_portal.get(tid)
        if w:
            t["waTicketId"] = w.get("ticketId")
            t["waFirstReportAt"] = w.get("createdDate")
            t["waFirstTs"] = w.get("createdTs")
            t["waGroup"] = w.get("waGroup")
        pool.append(t)
    for w in WA_TICKETS:
        tid = (w.get("ticketId") or "").strip()
        lid = TICKET_REGISTRY.get(tid, {}).get("linked_portal") or w.get("linkedPortalId") or ""
        if not tid or tid in seen_ids or (lid and lid in itsm_ids):
            continue
        seen_ids.add(tid)
        pool.append(w)

    # Ruang lingkup: hanya GC 1. Tiket/aduan Telkom (GC 2) diabaikan.
    our_team_tickets = [
        enrich_ticket_with_sop(t) for t in pool
        if not t.get("isTelkom") and "telkom" not in (t.get("assignmentGroup", "") + " " + t.get("shortDesc", "")).lower()
    ]

    for t in our_team_tickets:
        archive_ticket(t)
    return our_team_tickets



KAK_MONTHLY_ITEMS = [
    (1, "Total Kapasitas Government Cloud 1", "tidak", "Sistem hypervisor/cloud management"),
    (2, "Sisa Kapasitas Government Cloud 1", "tidak", "Sistem hypervisor/cloud management"),
    (3, "Proyeksi kebutuhan kapasitas sampai akhir tahun", "tidak", "Analisis kapasitas (L3 Cloud Expert)"),
    (4, "Hasil rekonsiliasi pembayaran", "tidak", "Administrasi bersama PPK"),
    (5, "Daftar rasionalisasi", "tidak", "Administrasi bersama PPK"),
    (6, "Daftar laporan penyelesaian tiket permintaan", "ya", "Ekspor CSV/Laporan Sentinel (data terpantau; angka resmi dari portal)"),
    (7, "Daftar laporan penyelesaian tiket insiden", "ya", "Ekspor CSV/Laporan Sentinel (data terpantau; angka resmi dari portal)"),
    (8, "Data layanan IP Government Cloud 1", "tidak", "IPAM / sistem jaringan"),
    (9, "Data tenan baru dan total (K/L/D)", "sebagian", "Instansi pelapor yang terpantau; data resmi dari portal pendaftaran tenan"),
    (10, "Data tenan berikut kapasitas dan perubahannya", "tidak", "Cloud management / portal"),
    (11, "Laporan pengelolaan cyber security", "tidak", "SIEM / NDR / EDR"),
    (12, "Daftar VDC berikut kapasitas dan perubahannya", "tidak", "Cloud management"),
    (13, "Laporan detail tiket permintaan dan insiden SLA", "ya", "Laporan dan CSV Sentinel (data terpantau; angka resmi dari portal)"),
    (14, "Laporan kondisi perangkat yang digunakan", "tidak", "Monitoring perangkat (CI Expert)"),
]


def _bucket_defs(rng, now):
    mid = time.mktime(time.strptime(time.strftime("%Y-%m-%d", time.localtime(now)), "%Y-%m-%d"))
    if rng == "week":
        return mid - 6 * 86400, 86400, 7, lambda ts: time.strftime("%d %b", time.localtime(ts))
    if rng == "month":
        return mid - 29 * 86400, 86400, 30, lambda ts: time.strftime("%d", time.localtime(ts))
    start = (now // 3600) * 3600 - 23 * 3600
    return start, 3600, 24, lambda ts: time.strftime("%H:00", time.localtime(ts))


def compute_stats(rng, itsm_list=None):
    """Agregat untuk grafik dashboard: tren ITSM vs WA, distribusi status/prioritas/kategori, SLA, balasan WA."""
    now = time.time()
    tickets = build_team_tickets()
    start, step, n, label = _bucket_defs(rng, now)
    buckets = [{"label": label(start + i * step), "itsm": 0, "wa": 0} for i in range(n)]
    wa_groups, reply_buckets, reply_minutes = {}, {"≤ 5 menit": 0, "5-10 menit": 0, "> 10 menit": 0, "Belum dibalas": 0}, []
    brk_s = int(CONFIG.get("wa_reply_breach_minutes", 10)) * 60
    warn_s = int(CONFIG.get("wa_reply_warn_minutes", 5)) * 60
    for r in TICKET_ARCHIVE.values():
        ts = r.get("createdTs", 0)
        if not (start <= ts < start + n * step):
            continue
        is_wa = r.get("source") == "Pra-tiket WA"
        if itsm_list and not is_wa and itsm_list not in (r.get("itsmLists") or []):
            continue
        buckets[int((ts - start) // step)]["wa" if is_wa else "itsm"] += 1
        if is_wa:
            g = r.get("waGroup") or "(tanpa nama grup)"
            wa_groups[g] = wa_groups.get(g, 0) + 1
            if r.get("respondedTs"):
                m = (r["respondedTs"] - ts) / 60
                reply_minutes.append(m)
                reply_buckets["≤ 5 menit" if m * 60 <= warn_s else "5-10 menit" if m * 60 <= brk_s else "> 10 menit"] += 1
            elif not r.get("closedSeenTs"):
                reply_buckets["Belum dibalas"] += 1

    itsm_all = [t for t in tickets if not t.get("isFromWa")]
    itsm = [t for t in itsm_all if itsm_list in (t.get("itsmLists") or [])] if itsm_list else itsm_all
    wa = [t for t in tickets if t.get("isFromWa")]
    scope = itsm if itsm_list else tickets

    def group_state(t):
        sl = (t.get("requestState") or "").lower()
        if any(k in sl for k in CLOSED_STATES):
            return "Selesai"
        if "pending" in sl:
            return "Pending Approval"
        if "progress" in sl:
            return "In Progress"
        if "hold" in sl:
            return "On-Hold"
        return "Assigned"

    def cnt(items, fn):
        out = {}
        for t in items:
            k = fn(t)
            out[k] = out.get(k, 0) + 1
        return out

    def wa_state(t):
        idn = (t.get("identity") or {}).get("status")
        if idn == "rejected":
            return "Ditolak (bukan tenan)"
        if t.get("linkedPortalId"):
            return "Tertaut ke tiket ITSM"
        if t.get("responseStatus") == "ok" or TICKET_REGISTRY.get(t.get("ticketId", ""), {}).get("responded_ts"):
            return "Sudah dibalas"
        return "Menunggu balasan"

    itsm_open = [t for t in itsm if not t.get("slaClosed")]
    wa_open = [t for t in wa if not t.get("slaClosed")]
    open_all = [t for t in scope if not t.get("slaClosed")]
    sla_pool = [t for t in itsm_open]
    breached = [t for t in sla_pool if t.get("slaBreached")]
    kind = {"day": "daily", "week": "weekly", "month": "monthly"}.get(rng, "daily")
    rep = compute_report(kind, time.strftime("%Y-%m-%d"), itsm_list)
    waiting = [t for t in wa_open if wa_state(t) == "Menunggu balasan"]
    return {
        "range": rng,
        "generated": time.strftime("%H:%M:%S"),
        "buckets": buckets,
        "totals": {"itsm": sum(b["itsm"] for b in buckets), "wa": sum(b["wa"] for b in buckets)},
        "itsm_status": cnt(itsm, group_state),
        "wa_status": cnt(wa, wa_state),
        "priority": {"itsm": cnt(itsm_open, lambda t: t.get("priority") or "Minor"), "wa": cnt(wa_open, lambda t: t.get("priority") or "Minor")},
        "category": rep["by_category"],
        "wa_groups": dict(sorted(wa_groups.items(), key=lambda kv: -kv[1])[:6]),
        "wa_reply_dist": reply_buckets,
        "wa_reply_avg_min": round(sum(reply_minutes) / len(reply_minutes), 1) if reply_minutes else None,
        "sla": {"matrix_pct": rep["sla_compliance_pct"], "kak_pct": rep["sla_kak_compliance_pct"], "target_pct": 95,
                "health_pct": 100 if not sla_pool else int((len(sla_pool) - len(breached)) / len(sla_pool) * 100),
                "breached": len(breached), "open": len(sla_pool),
                "wa_reply_pct": rep["wa_reply_within_target_pct"], "wa_reply_target_min": rep["wa_reply_target_minutes"]},
        "itsm_list": itsm_list,
        "itsm_lists": itsm_lists_info(),
        "kpi": {
            "itsm_by_list": {i["key"]: len([t for t in itsm_all if i["key"] in (t.get("itsmLists") or []) and not t.get("slaClosed")]) for i in itsm_lists_info() if i["key"] in HELPDESK_LISTS or any(i["key"] in (t.get("itsmLists") or []) for t in itsm_all)},
            "itsm_total": len(itsm), "itsm_open": len(itsm_open),
            "itsm_assigned": len([t for t in itsm if group_state(t) == "Assigned"]),
            "itsm_pending": len([t for t in itsm if group_state(t) == "Pending Approval"]),
            "itsm_progress": len([t for t in itsm if group_state(t) == "In Progress"]),
            "itsm_on_hold": len([t for t in itsm if group_state(t) == "On-Hold"]),
            "wa_total": len(wa), "wa_active": len(wa_open), "wa_waiting": len(waiting),
            "wa_late": len([t for t in waiting if t.get("responseStatus") == "late"]),
            "wa_unlinked": len([t for t in wa_open if not t.get("linkedPortalId")]),
            "wa_unverified": len([t for t in wa_open if (t.get("identity") or {}).get("status") != "verified"]),
            "attention": len([t for t in open_all if t.get("escalationFlags")]),
        },
        "attention": [{"ticketId": t["ticketId"], "source": "WA" if t.get("isFromWa") else "ITSM", "priority": t.get("priority"),
                       "who": t.get("requestedFor", ""), "flag": (t.get("escalationFlags") or [""])[0]}
                      for t in open_all if t.get("escalationFlags")][:8],
        "waiting_replies": [{"ticketId": t["ticketId"], "who": t.get("requestedFor", ""), "text": t.get("responseText", ""), "status": t.get("responseStatus")}
                            for t in waiting][:8],
    }


# ---------------------------------------------------------------------------
# NLP aduan WhatsApp: ekstraksi instan (aturan) + penyempurnaan AI lokal (opsional, di latar belakang)
# ---------------------------------------------------------------------------
_AGENCY_RE = re.compile(r"\b(?:(?:Pemkab|Pemkot)[\s-]+[A-Z][\w]*|(?:Pemprov|Kabupaten|Kota|Provinsi|Dinas|Badan|Kementerian|Biro|Sekretariat)[\s-]+[A-Z][\w]*(?:\s+[A-Z][\w]*){0,2})")
_AGENCY_ALIAS = {
    "kemenkes": "Kementerian Kesehatan", "kemenkeu": "Kementerian Keuangan", "kemendagri": "Kementerian Dalam Negeri",
    "kemendikbud": "Kemendikbudristek", "kemendikbudristek": "Kemendikbudristek", "kemenpanrb": "Kementerian PANRB",
    "bappenas": "Bappenas", "bps": "Badan Pusat Statistik", "bmkg": "BMKG", "setneg": "Sekretariat Negara", "pupr": "Kementerian PUPR",
    "kemenlu": "Kementerian Luar Negeri", "kemensos": "Kementerian Sosial", "kemenag": "Kementerian Agama", "kominfo": "Komdigi", "komdigi": "Komdigi",
}
_GREET_RE = re.compile(r"^\s*(?:selamat\s+(?:pagi|siang|sore|malam)|halo|hai|dear\s+all|assalamu\S*|permisi|mohon\s+izin|izin|ijin|maaf\s+(?:mengganggu|izin))[,.!\s]*(?:(?:pak|bu|bapak|ibu|tim|helpdesk|min|admin|mas|mbak|rekan\S*)[,.!\s]*)*", re.I)
_CHATTER = ["terima kasih", "makasih", "thanks", "siap pak", "siap bu", "oke pak", "noted", "bs dicoba", "bisa dicoba", "di kami berhasil", "di kami normal", "sudah normal", "izin pamit"]
_URGENT = ["segera", "mendesak", "urgent", "darurat", "secepatnya", "asap", "kritis", "sangat penting"]


def guess_agency(sender, group, text):
    # Nama grup TIDAK dipakai: ia nama forum (mis. "Layanan Cloud PDN Kominfo"), bukan instansi pelapor.
    hay = f"{sender} {text}"
    low = hay.lower()
    for k, v in _AGENCY_ALIAS.items():
        if re.search(r"\b" + re.escape(k) + r"\b", low):
            return v
    m = _AGENCY_RE.search(re.sub(r"\bPD[12]\b\s*", "", hay))
    return re.sub(r"[-]+", " ", m.group(0)).strip() if m else ""


def summarize(text):
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    for _ in range(3):
        t2 = _GREET_RE.sub("", t, count=1).strip()
        if t2 == t:
            break
        t = t2
    parts = [x.strip() for x in re.split(r"(?<=[.!?])\s+", t) if x.strip()]
    out = parts[0] if parts else t
    if len(out) < 25 and len(parts) > 1:
        out = f"{out} {parts[1]}"
    out = out[:140].rstrip()
    return (out[:1].upper() + out[1:]) if out else ""


def nlp_analyze(sender, text, group="", ts=None, phone_hint=""):
    t = re.sub(r"[ \t]+", " ", str(text or "")).strip()
    low = t.lower()
    phone = normalize_phone(phone_hint) or (normalize_phone(sender) if looks_like_phone(sender) else "")
    if not phone:
        m = _PHONE_RE.search(t)
        phone = normalize_phone(m.group(0)) if m else ""
    prio, ttype, reason = classify_ticket(t)
    cat = classify_category(t)
    ident = identity_for(phone)
    verified = ident["status"] == "verified"
    instansi = ident.get("instansi", "") if verified else guess_agency(sender, group, t)
    refs = sorted({x.upper() for x in re.findall(r"(REQ-[A-Z0-9-]+|INC[0-9]+|TKT-[0-9]+)", t, re.I)})
    ips = sorted({mask_phones(i) if False else re.sub(r"\d+$", "x", i) for i in re.findall(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", t)})
    stop = {"yang", "kami", "kita", "ini", "itu", "dan", "tidak", "bisa", "mati", "down", "error", "lambat", "nya", "di", "ke", "dari", "pak", "bu", "tolong", "mohon"}
    # nama host biasanya memuat angka atau tanda hubung/garis bawah/titik (mis. web-01, db01); kata biasa diabaikan
    vms = sorted({m.group(1) for m in re.finditer(r"\b(?:vm|server|host)\s+([A-Za-z0-9_.-]{3,30})", t, re.I)
                  if m.group(1).lower() not in stop and re.search(r"[0-9_.-]", m.group(1)) and not m.group(1).endswith(".") and not re.fullmatch(r"[\d.]+", m.group(1))})[:5]
    mention = bool(re.search(r"@\s*helpdesk|tim\s+helpdesk|\bhelpdesk\b", low))
    critical = prio == "Critical"
    chatter = (any(k in low for k in _CHATTER)) and not critical and not mention and prio == "Minor" and ttype != "Service request"
    urgent = any(k in low for k in _URGENT) or critical
    question = "?" in t or bool(re.search(r"\b(bagaimana|apakah|kenapa|mengapa|bisakah|bisa kah)\b", low))
    intent = "obrolan antar-tenan" if chatter else {"Insiden": "insiden", "Service request": "permintaan layanan", "Informasi": "pertanyaan informasi"}[ttype]
    flags = []
    if not phone:
        flags.append("nomor HP belum ada")
    elif not verified:
        flags.append("nomor baru, belum terdaftar")
    if mention:
        flags.append("menyebut Helpdesk")
    if refs:
        flags.append("menyebut nomor tiket")
    if urgent:
        flags.append("bernada mendesak")
    if chatter:
        flags.append("kemungkinan obrolan antar-tenan")
    return {
        "sender": sender, "phone": phone, "text": t, "ts": ts,
        "instansi": instansi, "identityStatus": ident["status"], "identityName": ident.get("name", ""),
        "intent": intent, "priority": prio, "ticketType": ttype, "category": cat, "reason": reason,
        "summary": summarize(t), "needsReply": not chatter, "urgent": urgent, "isQuestion": question,
        "entities": {"tiket": refs, "ip": ips, "vm": vms},
        "flags": flags, "engine": "rules",
    }


NLP_JOBS = {}
NLP_LOCK = threading.Lock()


def _nlp_ai_worker(job_id, items):
    """Penyempurnaan oleh model LOKAL (Ollama) di latar belakang; hasil aturan tetap tampil lebih dulu."""
    try:
        h = _HA.Hermes(dict(CONFIG))
        for idx, text in items:
            try:
                clean = _HA.redact(text)
                r = h.ask(clean)
                if r:
                    with NLP_LOCK:
                        NLP_JOBS[job_id]["results"][str(idx)] = {
                            "priority": r.get("priority"), "summary": r.get("summary"), "reason": r.get("reason"),
                            "is_peer_chatter": r.get("is_peer_chatter"), "needs_followup": r.get("needs_followup"),
                            "has_image_only": r.get("has_image_only"), "engine": f"ai-lokal:{h.model}",
                        }
            except Exception as e:  # satu pesan gagal tidak menghentikan yang lain
                with NLP_LOCK:
                    NLP_JOBS[job_id]["errors"].append(f"#{idx}: {str(e)[:100]}")
        with NLP_LOCK:
            NLP_JOBS[job_id]["status"] = "done"
    except Exception as e:
        with NLP_LOCK:
            NLP_JOBS[job_id].update(status="error", errors=[str(e)[:150]])


def nlp_ai_available():
    return bool(_HA) and CONFIG.get("ai_provider") == "ollama" and bool(CONFIG.get("ai_model"))


def start_nlp_job(items):
    job_id = f"nlp_{int(time.time() * 1000)}"
    with NLP_LOCK:
        for k in [k for k, v in NLP_JOBS.items() if time.time() - v["created"] > 600]:
            NLP_JOBS.pop(k, None)
        NLP_JOBS[job_id] = {"status": "pending", "results": {}, "errors": [], "created": time.time()}
    threading.Thread(target=_nlp_ai_worker, args=(job_id, items), daemon=True).start()
    return job_id


class SentinelHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def _allowed_origins(self):
        port = CONFIG.get("server_port", 8765)
        allowed = {
            f"http://localhost:{port}", f"http://127.0.0.1:{port}",
            "https://web.whatsapp.com",
        }
        live = urlparse(CONFIG.get("live_helpdesk_url", "") or "")
        if live.scheme and live.netloc:
            allowed.add(f"{live.scheme}://{live.netloc}")
        allowed.update(CONFIG.get("allowed_origins", []) or [])
        return allowed

    def _origin_ok(self, origin):
        if not origin or origin == "null":
            return True
        if origin.startswith("chrome-extension://"):
            return True
        if any(dom in origin.lower() for dom in ("layanan.go.id", "kominfo.go.id", "komdigi.go.id", "localhost", "127.0.0.1")):
            return True
        return origin in self._allowed_origins()

    def _host_ok(self):
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip().lower()
        if host in LOCAL_HOSTS:
            return True
        return host in [h.lower() for h in (CONFIG.get("allowed_hosts", []) or [])]

    def _is_local(self):
        return self.client_address[0] in ("127.0.0.1", "::1", "::ffff:127.0.0.1")

    def _team_token_ok(self):
        tok = CONFIG.get("team_view_token") or ""
        if not tok:
            return False
        given = self.headers.get("X-Team-Token", "")
        for part in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == "gc1_team":
                given = given or v
        return bool(given) and hmac.compare_digest(given.encode(), tok.encode())

    def _team_guard(self):
        """Klien non-lokal: hanya tampilan tim hanya-baca, dengan token. Tidak ada tulis sama sekali."""
        parsed = urlparse(self.path)
        path = parsed.path
        if not CONFIG.get("team_view_enabled"):
            self.send_error(403, "Team view disabled")
            return False
        if self.command != "GET":
            self.send_error(403, "Team view is read-only")
            return False
        if path == "/team":
            token = (parse_qs(parsed.query).get("token") or [""])[0]
            tok = CONFIG.get("team_view_token") or ""
            if tok and hmac.compare_digest(token.encode(), tok.encode()):
                self.send_response(302)
                self.send_header("Set-Cookie", f"gc1_team={tok}; Path=/; HttpOnly; SameSite=Strict")
                self.send_header("Location", "/dashboard.html")
                self.send_header("Content-Length", "0")
                self.end_headers()
            else:
                self.send_error(403, "Invalid token")
            return False
        if not self._team_token_ok():
            self.send_error(403, "Token required (buka /team?token=...)")
            return False
        api_ok = {"/api/helpdesk_snapshot", "/api/daily_recap", "/api/report", "/api/report.html", "/api/export.csv", "/api/whoami"}
        static_ok = path in ("/dashboard.html", "/dashboard.js", "/dashboard.css") or path.startswith(("/sounds/", "/icons/"))
        if path in api_ok or static_ok:
            return True
        self.send_error(403, "Not available in team view")
        return False

    def _guard(self):
        """Tolak Host asing (DNS rebinding) dan Origin asing (situs lain yang memanggil API lokal)."""
        if not self._is_local():
            return self._team_guard()
        if not self._host_ok():
            self.send_error(403, "Host not allowed")
            return False
        origin = self.headers.get("Origin")
        if origin and not self._origin_ok(origin):
            print(f"[Sentinel Server] Ditolak: Origin asing {origin}. Tambahkan ke allowed_origins di config.json bila sah.")
            self.send_error(403, "Origin not allowed")
            return False
        return True

    def _set_cors(self):
        origin = self.headers.get("Origin")
        if origin and self._origin_ok(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def do_OPTIONS(self):
        if not self._guard():
            return
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def send_bytes(self, body, content_type, filename=None):
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self._guard():
            return
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            self.handle_api_get(path, parsed)
        elif Path(path).name in {"sentinel_data.json", "config.json", "markijo_reported.json"} or path.endswith(".py"):
            self.send_error(404, "Not found")
        else:
            super().do_GET()

    def do_POST(self):
        if not self._guard():
            return
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/"):
            content_len = min(int(self.headers.get("Content-Length", 0) or 0), 2_000_000)
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
        text = json.dumps(payload, ensure_ascii=False)
        if not self._is_local():
            text = mask_phones(text)  # tampilan tim: nomor HP disamarkan
        body = text.encode("utf-8")
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
                    "wa_outbound_enabled": outbound_enabled(),
                    "wa_monitored_groups": CONFIG.get("wa_monitored_groups", []),
                    "wa_queue_len": len([m for m in WA_QUEUE if m.get("status") == "pending"]),
                    "target_contact": CONFIG.get("target_contact", "mimi Sandora"),
                    "sqlite": sentinel_db.get_db_stats() if 'sentinel_db' in globals() else {},
                    "server_time": time.strftime("%Y-%m-%d %H:%M:%S")
                })

            elif path == "/api/db_stats":
                try:
                    self.send_json(sentinel_db.get_db_stats())
                except Exception as e:
                    self.send_json({"error": str(e), "total": 0})

            elif path == "/api/manual_tickets":
                try:
                    manuals = sentinel_db.get_manual_tickets()
                    self.send_json({"status": "ok", "tickets": manuals, "count": len(manuals)})
                except Exception as e:
                    self.send_json({"status": "error", "message": str(e), "tickets": []}, 500)

            elif path == "/api/alerts":
                self.send_json({"alerts": ALERTS})

            elif path == "/api/config":
                self.send_json(CONFIG)

            elif path == "/api/wa_queue":
                # SINGLE-DELIVERY POP: Pesan langsung dipindahkan ke history saat diambil
                # JANGAN PERNAH me-reclaim atau mengirim ulang otomatis setiap 60 detik!
                pending = [m for m in WA_QUEUE if m.get("status") == "pending"] if outbound_enabled() else []
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
                    self.send_json({"has_message": False, "outbound_enabled": outbound_enabled()})

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
                our_team_tickets = build_team_tickets()
                # Kumpulkan seluruh tiket yang terpindai dari ITSM (termasuk Telkom jika tampil di layar)
                all_scanned_pool = []
                seen_all_ids = set()
                for lst_obj in HELPDESK_LISTS.values():
                    for t in lst_obj.get("tickets", []):
                        tid = (t.get("ticketId") or "").strip()
                        if tid and tid not in seen_all_ids:
                            seen_all_ids.add(tid)
                            all_scanned_pool.append(enrich_ticket_with_sop(dict(t)))

                telkom_tickets = [t for t in all_scanned_pool if t.get("isTelkom") or "telkom" in (t.get("assignmentGroup", "") + " " + t.get("shortDesc", "")).lower()]

                def st(t):
                    return (t.get("requestState") or "").lower()

                team_assigned = [t for t in our_team_tickets if any(k in st(t) for k in ("assign", "ditugaskan", "disposisi", "open", "baru", "new", "terbuka", "antrean")) or not any(k in st(t) for k in ("pending", "menunggu", "hold", "progress", "diproses", "selesai", "closed", "resolved"))]
                team_pending = [t for t in our_team_tickets if any(k in st(t) for k in ("pending", "menunggu", "hold", "tertunda"))]
                team_progress = [t for t in our_team_tickets if any(k in st(t) for k in ("progress", "diproses", "penanganan", "analisis"))]

                open_tickets = [t for t in our_team_tickets if not t.get("slaClosed")]
                sla_pool = [t for t in open_tickets if not t.get("slaMode")]
                breached = [t for t in sla_pool if t.get("slaBreached")]
                sla_health_pct = 100 if not sla_pool else int(((len(sla_pool) - len(breached)) / len(sla_pool)) * 100)
                escalations = [t for t in open_tickets if t.get("escalationFlags")]

                wa_alerts = [a for a in ALERTS if a.get("source") == "whatsapp"]

                self.send_json({
                    "total_helpdesk": len(our_team_tickets),
                    "total_itsm_scanned": len(all_scanned_pool),
                    "team_assigned_count": len(team_assigned),
                    "team_pending_count": len(team_pending),
                    "team_progress_count": len(team_progress),
                    "sla_health_percent": sla_health_pct,
                    "sla_safe_count": len(open_tickets) - len(breached),
                    "sla_breached_count": len(breached),
                    "escalation_count": len(escalations),
                    "telkom_count": len(telkom_tickets) or TELKOM_SKIPPED,
                    "telkom_tickets": telkom_tickets,
                    "wa_count": len(wa_alerts),
                    "itsm_lists": itsm_lists_info(),
                    "wa_outbound_enabled": outbound_enabled(),
                    "wa_monitored_groups": CONFIG.get("wa_monitored_groups", []),
                    "last_sync": LAST_SYNC_TIME or time.strftime("%H:%M:%S WIB"),
                    "team_assigned": team_assigned,
                    "team_pending": team_pending,
                    "team_progress": team_progress,
                    "escalations": escalations,
                    "wa_alerts": wa_alerts,
                    "all_tickets": our_team_tickets,
                    "all_scanned_tickets": all_scanned_pool,
                    # Backward-compatibility alias
                    "gc1_assigned": team_assigned,
                    "gc1_assigned_count": len(team_assigned),
                    "gc1_pending": team_pending,
                    "gc1_pending_count": len(team_pending)
                })

            elif path == "/api/daily_recap":
                # SOP 4.4: Lead L0-L1 merekap harian aduan WA vs tiket portal yang terbit
                params = parse_qs(parsed.query)
                day = params.get("date", [time.strftime("%Y-%m-%d")])[0]
                self.send_json(build_daily_recap(day))

            elif path == "/api/export.csv":
                params = parse_qs(parsed.query)
                day = params.get("date", [""])[0]
                kind = params.get("kind", ["daily"])[0]
                kind = kind if kind in ("daily", "weekly", "monthly") else "daily"
                self.send_bytes(build_export_csv(kind, day).encode("utf-8-sig"), "text/csv; charset=utf-8",
                                f"gc1_{kind}_{day or 'semua'}.csv")

            elif path in ("/api/report", "/api/report.html"):
                params = parse_qs(parsed.query)
                kind = params.get("kind", ["daily"])[0]
                kind = kind if kind in ("daily", "weekly", "monthly") else "daily"
                rep_data = compute_report(kind, params.get("date", [time.strftime("%Y-%m-%d")])[0])
                if path == "/api/report":
                    self.send_json(rep_data)
                else:
                    self.send_bytes(build_report_html(rep_data).encode("utf-8"), "text/html; charset=utf-8")

            elif path == "/api/pic_registry":
                if not self._is_local():
                    self.send_error(403, "Hanya dari Mini PC operator")
                    return
                reg = sorted(PIC_REGISTRY.values(), key=lambda e: (e.get("instansi", ""), e.get("name", "")))
                cases = [dict(c, ticketCount=len(c.get("ticketIds", []))) for c in IDENTITY_CASES.values()]
                self.send_json({"registry": reg, "cases": sorted(cases, key=lambda c: -c.get("firstSeen", 0))})

            elif path == "/api/pic_lookup":
                if not self._is_local():
                    self.send_error(403, "Hanya dari Mini PC operator")
                    return
                q = parse_qs(parsed.query)
                self.send_json(identity_for(normalize_phone((q.get("phone") or [""])[0])))

            elif path == "/api/stats":
                q = parse_qs(parsed.query)
                rng = (q.get("range") or ["day"])[0]
                lst = (q.get("list") or [""])[0]
                lst = lst if lst in {i["key"] for i in itsm_lists_info()} else None
                self.send_json(compute_stats(rng if rng in ("day", "week", "month") else "day", lst))

            elif path == "/api/nlp_job":
                if not self._is_local():
                    self.send_error(403, "Hanya dari Mini PC operator")
                    return
                jid = (parse_qs(parsed.query).get("id") or [""])[0]
                with NLP_LOCK:
                    j = NLP_JOBS.get(jid)
                    self.send_json({"status": j["status"], "results": j["results"], "errors": j["errors"]} if j else {"status": "unknown", "results": {}, "errors": []})

            elif path == "/api/whoami":
                self.send_json({"role": "operator" if self._is_local() else "team"})

            else:
                self.send_error(404, "API route not found")

    def handle_api_post(self, path, data):
        global ALERTS, WA_TICKETS, TICKET_REGISTRY, SENT_RECAP_HASHES, WA_QUEUE, WA_HISTORY, CONFIG, HELPDESK_SNAPSHOT, LAST_SYNC_TIME, TELKOM_SKIPPED, MONITOR_START

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
                telkom_skipped = 0
                list_key, list_label, list_title, list_path = resolve_itsm_list(data.get("list"))
                for t in raw_tickets:
                    raw_id = t.get("ticketId") or t.get("number") or t.get("ticketNumber") or ""
                    tid = re.sub(r"[\r\n\t📋]", "", str(raw_id)).strip()
                    if not tid or not is_valid_ticket_id(tid) or tid in seen_sync_ids:
                        continue
                    seen_sync_ids.add(tid)

                    desc = re.sub(r"\s+", " ", str(t.get("shortDesc") or t.get("desc") or "")).strip()
                    req_for = sentinel_db.deduplicate_name(re.sub(r"\s+", " ", re.sub(r"[\r\n\t]", " ", str(t.get("requestedFor") or ""))).strip())
                    state_val = re.sub(r"[●•\r\n\t]", "", str(t.get("requestState") or t.get("state") or "")).strip()
                    date_val = re.sub(r"\s+", " ", str(t.get("createdDate") or t.get("date") or "")).strip()
                    loc_val = sentinel_db.deduplicate_name(re.sub(r"\s+", " ", re.sub(r"[\r\n\t]", " ", str(t.get("location") or ""))).strip())
                    grp_val = re.sub(r"\s+", " ", str(t.get("assignmentGroup") or t.get("group") or "")).strip()

                    # Filter out corrupted rows from dashboard button scraping
                    if "salin" in loc_val.lower() or loc_val in ["📋 Salin", "Salin"] or loc_val == "📲 WA":
                        continue
                    if "helpdesk" in date_val.lower() or "l0" in date_val.lower() or "eos" in date_val.lower():
                        continue

                    # Check GC 1 match & SOP Team Rules
                    full_text = f"{tid} {desc} {req_for} {loc_val} {grp_val}"
                    is_gc1 = any(k.lower() in full_text.lower() for k in CONFIG.get("keywords", []))

                    # SOP OPERASIONAL: Klasifikasi tim Telkom vs Tim Internal
                    is_telkom = "telkom" in grp_val.lower()
                    if is_telkom and CONFIG.get("filter_telkom_out", False):
                        telkom_skipped += 1
                        continue

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

                    if is_telkom:
                        resolver_layer = "Telkom (Eksternal)"
                    elif "eos l1" in grp_val.lower():
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
                        "isTelkom": is_telkom,
                        "resolverLayer": resolver_layer,
                        "category": cat,
                        "itsmLists": [list_key],
                        "serviceType": t.get("serviceType") or sentinel_db.normalize_service_type(tid, desc, list_key)
                    }
                    track_ticket(tid, state_val, grp_val)
                    norm_t = enrich_ticket_with_sop(norm_t)
                    archive_ticket(norm_t)
                    normalized_tickets.append(norm_t)

                    # Rekap WA hanya bila pengiriman keluar diaktifkan di config.json (default: mati)
                    if is_assigned and not is_telkom and outbound_enabled():
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
                # Akumulasikan tiket antar halaman/pagination (tidak menimpa tiket dari halaman lain)
                pagination_data = (data.get("list") or {}).get("pagination")
                existing_tickets = (HELPDESK_LISTS.get(list_key) or {}).get("tickets", [])
                new_ids = {t.get("ticketId") for t in normalized_tickets if t.get("ticketId")}
                merged_tickets = normalized_tickets + [t for t in existing_tickets if t.get("ticketId") not in new_ids]
                HELPDESK_LISTS[list_key] = {"label": list_label, "tickets": merged_tickets, "synced_at": time.time(), "title": list_title, "path": list_path, "pagination": pagination_data}
                if list_key != "itsm":
                    HELPDESK_LISTS.pop("itsm", None)   # daftar format lama (tanpa nama halaman) digantikan begitu ekstensi baru membaca halaman bernama
                HELPDESK_SNAPSHOT = merge_itsm_lists()
                TELKOM_SKIPPED = telkom_skipped
                SYNC_HOURS.add(time.strftime("%Y-%m-%d %H"))
                if not MONITOR_START:
                    MONITOR_START = time.time()
                LAST_SYNC_TIME = time.strftime("%H:%M:%S WIB")
                try:
                    sentinel_db.save_tickets_to_db(normalized_tickets, list_key=list_key, source_url=list_path)
                except Exception as db_err:
                    print(f"[Sentinel Server] SQLite save error: {db_err}")
                save_persisted_data()
                self.send_json({"status": "synced", "count": len(normalized_tickets), "list": list_key, "total": len(HELPDESK_SNAPSHOT), "last_sync": LAST_SYNC_TIME, "pagination": pagination_data})

            elif path == "/api/reload_itsm":
                target_menu = data.get("menu", "active")
                print(f"[Sentinel Server] Permintaan reload submenu ITSM: {target_menu}")
                self.send_json({"status": "ok", "message": f"Reload triggered for menu {target_menu}", "menu": target_menu})

            elif path == "/api/alerts":
                alert_data = data.get("data", data)
                source = alert_data.get("source", "unknown")
                raw_tid = alert_data.get("ticketId", "")
                tid = re.sub(r"[\r\n\t📋]", "", str(raw_tid)).strip()
                text = re.sub(r"\s+", " ", str(alert_data.get("text", ""))).strip()
                sender = re.sub(r"\s+", " ", re.sub(r"[\r\n\t]", " ", str(alert_data.get("sender", "")))).strip()
                req_state = re.sub(r"[●•\r\n\t]", "", str(alert_data.get("requestState", ""))).strip()
                kw = alert_data.get("matchedKeyword", "GC 1")

                # Aduan WhatsApp dicatat lewat /api/add_wa_ticket (menghindari entri ganda di feed)
                if source == "whatsapp":
                    self.send_json({"status": "ignored", "reason": "use_add_wa_ticket"})
                    return

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
                if outbound_enabled():
                    should_notify, reason, update_type = should_report_ticket(alert_data)
                else:
                    should_notify, reason, update_type = False, "outbound_disabled", "none"

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
                if not outbound_enabled():
                    self.send_json({"status": "disabled", "message": "Pengiriman ke WhatsApp dinonaktifkan (wa_outbound_enabled=false)."})
                    return
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
                if not outbound_enabled():
                    self.send_json({"status": "disabled", "message": "Pengiriman ke WhatsApp dinonaktifkan."})
                    return
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
                text = str(data.get("text") or "")[:4000]
                kw = data.get("matchedKeyword") or "GC 1"
                msg_id = str(data.get("msgId") or "")[:200]
                manual = bool(data.get("manual"))
                entered_by = re.sub(r"\s+", " ", str(data.get("enteredBy") or "")).strip()[:60]
                if manual and (len(entered_by) < 2 or entered_by.lower() in ("operator", "operator helpdesk")):
                    self.send_json({"status": "error", "message": "Nama petugas yang mencatat wajib diisi (SOP bab 12)"}, 400)
                    return
                if manual and not self._is_local():
                    self.send_json({"status": "error", "message": "Hanya dari Mini PC operator"}, 403)
                    return
                try:
                    tier = int(data.get("tier") or 0)
                except (TypeError, ValueError):
                    tier = 0
                if tier not in (1, 2, 3):
                    tier = wa_tier_for(group)
                wa_ts = data.get("waTs")
                try:
                    wa_ts = float(wa_ts) if wa_ts else None
                except (TypeError, ValueError):
                    wa_ts = None

                if not text.strip():
                    self.send_json({"status": "error", "message": "Text aduan tidak boleh kosong"}, 400)
                    return

                # Hanya grup yang didaftarkan (privasi: chat pribadi tidak diproses). Input manual dashboard dikecualikan.
                groups = [g.strip().lower() for g in (CONFIG.get("wa_monitored_groups") or []) if g.strip()]
                ignored = [g.strip().lower() for g in (CONFIG.get("wa_ignored_groups") or []) if g.strip()]
                if not manual and any(g in str(group).lower() for g in ignored):
                    self.send_json({"status": "ignored", "reason": "group_ignored"})
                    return
                if not manual and groups and "*" not in groups and not any(g in str(group).lower() for g in groups):
                    self.send_json({"status": "ignored", "reason": "group_not_monitored"})
                    return

                # Aduan GC 2 (Telkom) di luar ruang lingkup
                if "telkom" in f"{text} {group}".lower():
                    self.send_json({"status": "ignored", "reason": "out_of_scope_gc2"})
                    return

                # Pesan lama (mis. riwayat chat yang tampil saat WhatsApp Web dibuka) tidak dijadikan tiket baru
                max_age = float(CONFIG.get("wa_max_age_hours", 24) or 24) * 3600
                if not manual and wa_ts and time.time() - wa_ts > max_age:
                    self.send_json({"status": "ignored", "reason": "message_too_old"})
                    return

                # Deduplikasi: id pesan WhatsApp, atau pengirim + teks lengkap pada hari yang sama
                if msg_id and any(t.get("waMsgId") == msg_id for t in WA_TICKETS):
                    self.send_json({"status": "ignored", "reason": "already_converted_to_ticket"})
                    return
                if not msg_id and any(t.get("rawWaText") == re.sub(r"[\r\n\t]+", " ", text).strip()
                                      and t.get("requestedFor") == sender
                                      and time.time() - (t.get("detectedTs") or 0) < 86400 for t in WA_TICKETS):
                    self.send_json({"status": "ignored", "reason": "already_converted_to_ticket"})
                    return

                # Satu utas = satu tiket. Balasan yang mengutip pesan awal (atau pesan awal yang dikutip balasan)
                # digabung ke pra-tiket yang sudah ada, bukan dibuat tiket baru. Balasan dari tim sendiri
                # dihitung sebagai respons pertama (SOP 3.2).
                norm_new = re.sub(r"\s+", " ", text).strip().lower()
                team = [x.strip().lower() for x in (CONFIG.get("wa_team_senders") or []) if x.strip()]
                is_team = any(x in str(sender).lower() for x in team)
                now_ts = time.time()
                for w in WA_TICKETS:
                    if w.get("waGroup") != str(group).strip() or now_ts - (w.get("detectedTs") or 0) > 86400:
                        continue
                    norm_old = re.sub(r"\s+", " ", w.get("rawWaText", "")).strip().lower()
                    if len(norm_old) >= 25 and (norm_old in norm_new or (len(norm_new) >= 25 and norm_new in norm_old)):
                        e = TICKET_REGISTRY.get(w["ticketId"])
                        if e is not None:
                            add_history(e, "Pesan lanjutan di utas WA", f"{sender}: {text[:200]}", actor="WhatsApp Observer")
                            if is_team and not e.get("responded_ts"):
                                e["responded_ts"] = wa_ts or now_ts
                                add_history(e, "Respons pertama (balasan tim di grup WA)", str(sender), actor="WhatsApp Observer")
                            save_persisted_data()
                        self.send_json({"status": "ignored", "reason": "merged_into_thread", "ticketId": w["ticketId"]})
                        return
                if is_team:
                    self.send_json({"status": "ignored", "reason": "team_sender"})
                    return

                # SOP 4.1: verifikasi pelapor terhadap daftar PIC tenan (None = daftar belum dikonfigurasi)
                roster = [v.strip().lower() for v in (CONFIG.get("wa_verified_senders") or []) if v.strip()]
                verified = None if not roster else any(v in str(sender).lower() for v in roster)

                wa_ticket = convert_wa_message_to_ticket(sender, group, text, kw, msg_id=msg_id, wa_ts=wa_ts, verified=verified,
                                                         instansi_hint=re.sub(r"\s+", " ", str(data.get("instansi") or "")).strip()[:120],
                                                         summary_hint=re.sub(r"\s+", " ", str(data.get("summary") or "")).strip()[:140])
                if wa_ticket:
                    phone = normalize_phone(data.get("phone") or (sender if looks_like_phone(sender) else ""))
                    wa_ticket["senderPhone"] = phone
                    ident = identity_for(phone)
                    if phone:
                        e_t = TICKET_REGISTRY[wa_ticket["ticketId"]]
                        if ident["status"] == "verified":
                            add_history(e_t, "Nomor pelapor terdaftar", f"{ident['name']} ({ident['instansi']})", actor="Sentinel")
                        else:
                            case = ensure_case(phone, wa_ticket["ticketId"])
                            if len(case["ticketIds"]) == 1 and not case["history"]:
                                case_event(case, "Nomor baru belum terdaftar", "Tanyakan asal dan instansi (SOP 4.1)")
                            else:
                                add_history(e_t, "Nomor pelapor belum terverifikasi", f"status: {ident['status']}", actor="Sentinel")
                    wa_ticket["waTier"] = tier
                    wa_ticket["enteredBy"] = entered_by if manual else ""
                    if manual:
                        add_history(TICKET_REGISTRY[wa_ticket["ticketId"]], "Dicatat manual", f"oleh {entered_by}", actor=entered_by)
                    wa_ticket["helpdeskMentioned"] = bool(re.search(r"@\s*helpdesk|tim\s+helpdesk|\bhelpdesk\b", text, re.IGNORECASE))
                if not wa_ticket:
                    self.send_json({"status": "error", "message": "Text aduan tidak valid"}, 400)
                    return
                LAST_SYNC_TIME = time.strftime("%H:%M:%S WIB")
                print(f"[Sentinel Server] WhatsApp -> pra-tiket {wa_ticket['ticketId']} dari {sender} [{group}] ({wa_ticket['autoPriority']})")
                self.send_json({"status": "success", "ticket": wa_ticket, "identity": identity_for(wa_ticket.get("senderPhone", ""))})

            elif path == "/api/manual_ticket":
                def parse_single_manual(t):
                    raw_id = t.get("ticketId") or t.get("number") or t.get("ticketNumber") or ""
                    tid = re.sub(r"[\r\n\t📋]", "", str(raw_id)).strip()
                    if not tid or not is_valid_ticket_id(tid):
                        return None, "Nomor tiket tidak valid. Contoh: REQ-KMF-092026-001234 atau INC-KMF-092026-005678"
                    desc = re.sub(r"\s+", " ", str(t.get("shortDesc") or t.get("desc") or "")).strip()
                    if not desc:
                        return None, "Uraian / Deskripsi singkat tiket wajib diisi"
                    req_for = sentinel_db.deduplicate_name(re.sub(r"\s+", " ", re.sub(r"[\r\n\t]", " ", str(t.get("requestedFor") or ""))).strip())
                    state_val = re.sub(r"[●•\r\n\t]", "", str(t.get("requestState") or t.get("state") or "In Progress")).strip()
                    date_val = re.sub(r"\s+", " ", str(t.get("createdDate") or t.get("date") or time.strftime("%Y-%m-%d %H:%M"))).strip()
                    loc_val = sentinel_db.deduplicate_name(re.sub(r"\s+", " ", re.sub(r"[\r\n\t]", " ", str(t.get("location") or "-"))).strip())
                    grp_val = re.sub(r"\s+", " ", str(t.get("assignmentGroup") or t.get("group") or "EOS L1")).strip()
                    prio_val = str(t.get("priority") or "Minor").strip()
                    srv_type = str(t.get("serviceType") or "").strip()
                    if not srv_type:
                        srv_type = sentinel_db.normalize_service_type(tid, desc)
                    list_key = "incident" if srv_type.lower() == "insiden" else "request"
                    is_telkom = "telkom" in grp_val.lower()

                    created_ts = None
                    try:
                        if t.get("createdTs"):
                            created_ts = float(t.get("createdTs"))
                    except Exception:
                        pass
                    if not created_ts:
                        created_ts = time.time()

                    is_assigned = (state_val.lower() == "assigned" or "assign" in state_val.lower())
                    is_pending = ("pending" in state_val.lower() or "hold" in state_val.lower())
                    cat = "team_assigned" if is_assigned else ("team_pending" if is_pending else "team_progress")

                    if is_telkom:
                        layer = "Telkom (Eksternal)"
                    elif "eos l1" in grp_val.lower() or "l1" in grp_val.lower():
                        layer = "EOS L1"
                    elif "eos l2" in grp_val.lower() or "l2" in grp_val.lower():
                        layer = "EOS L2 (Engineer)"
                    elif "eos l3" in grp_val.lower() or "l3" in grp_val.lower():
                        layer = "EOS L3 (Expert)"
                    elif "noc" in grp_val.lower():
                        layer = "NOC"
                    elif "soc" in grp_val.lower():
                        layer = "SOC"
                    else:
                        layer = "Helpdesk (L0)"

                    norm_t = {
                        "ticketId": tid,
                        "shortDesc": desc,
                        "requestedFor": req_for,
                        "requestState": state_val,
                        "createdDate": date_val,
                        "createdTs": created_ts,
                        "location": loc_val,
                        "assignmentGroup": grp_val,
                        "isGc1": True,
                        "isTelkom": is_telkom,
                        "resolverLayer": layer,
                        "category": cat,
                        "itsmLists": [list_key],
                        "serviceType": srv_type,
                        "priority": prio_val,
                        "isManual": True
                    }
                    track_ticket(tid, state_val, grp_val)
                    norm_t = enrich_ticket_with_sop(norm_t)
                    archive_ticket(norm_t)
                    return norm_t, None

                norm_t, err = parse_single_manual(data)
                if err:
                    self.send_json({"status": "error", "message": err}, 400)
                    return

                list_key = norm_t["itsmLists"][0]
                try:
                    sentinel_db.save_tickets_to_db([norm_t], list_key=list_key, source_url="manual_entry")
                except Exception as db_err:
                    print(f"[Sentinel Server] SQLite save error on manual ticket: {db_err}")

                if list_key not in HELPDESK_LISTS:
                    HELPDESK_LISTS[list_key] = {"label": "Tiket " + norm_t["serviceType"], "tickets": [], "synced_at": time.time(), "title": "Tiket " + norm_t["serviceType"], "path": f"/itsm/{list_key}"}
                existing_list = [t for t in HELPDESK_LISTS[list_key]["tickets"] if t.get("ticketId") != norm_t["ticketId"]]
                existing_list.insert(0, norm_t)
                HELPDESK_LISTS[list_key]["tickets"] = existing_list
                HELPDESK_LISTS[list_key]["synced_at"] = time.time()
                HELPDESK_SNAPSHOT = merge_itsm_lists()
                LAST_SYNC_TIME = time.strftime("%H:%M:%S WIB")
                save_persisted_data()
                print(f"[Sentinel Server] 📝 Tiket manual dicatat: {norm_t['ticketId']} - {norm_t['shortDesc'][:60]}")
                self.send_json({"status": "success", "message": f"Tiket {norm_t['ticketId']} berhasil disimpan ke database Sentinel", "ticket": norm_t})

            elif path == "/api/manual_tickets_batch":
                tickets_input = data.get("tickets") or []
                if not isinstance(tickets_input, list) or len(tickets_input) == 0:
                    self.send_json({"status": "error", "message": "Daftar tiket kosong"}, 400)
                    return

                saved_tickets = []
                errors = []
                by_list = {}
                for idx, item in enumerate(tickets_input, 1):
                    raw_id = item.get("ticketId") or item.get("number") or item.get("ticketNumber") or ""
                    tid = re.sub(r"[\r\n\t📋]", "", str(raw_id)).strip()
                    if not tid or not is_valid_ticket_id(tid):
                        errors.append(f"Baris {idx}: nomor tiket '{tid}' tidak valid")
                        continue
                    desc = re.sub(r"\s+", " ", str(item.get("shortDesc") or item.get("desc") or "")).strip()
                    if not desc:
                        errors.append(f"Baris {idx} ({tid}): deskripsi kosong")
                        continue

                    req_for = sentinel_db.deduplicate_name(re.sub(r"\s+", " ", re.sub(r"[\r\n\t]", " ", str(item.get("requestedFor") or ""))).strip())
                    state_val = re.sub(r"[●•\r\n\t]", "", str(item.get("requestState") or item.get("state") or "In Progress")).strip()
                    date_val = re.sub(r"\s+", " ", str(item.get("createdDate") or item.get("date") or time.strftime("%Y-%m-%d %H:%M"))).strip()
                    loc_val = sentinel_db.deduplicate_name(re.sub(r"\s+", " ", re.sub(r"[\r\n\t]", " ", str(item.get("location") or "-"))).strip())
                    grp_val = re.sub(r"\s+", " ", str(item.get("assignmentGroup") or item.get("group") or "EOS L1")).strip()
                    prio_val = str(item.get("priority") or "Minor").strip()
                    srv_type = str(item.get("serviceType") or "").strip()
                    if not srv_type:
                        srv_type = sentinel_db.normalize_service_type(tid, desc)
                    list_key = "incident" if srv_type.lower() == "insiden" else "request"
                    is_telkom = "telkom" in grp_val.lower()

                    created_ts = None
                    try:
                        if item.get("createdTs"):
                            created_ts = float(item.get("createdTs"))
                    except Exception:
                        pass
                    if not created_ts:
                        created_ts = time.time()

                    is_assigned = (state_val.lower() == "assigned" or "assign" in state_val.lower())
                    is_pending = ("pending" in state_val.lower() or "hold" in state_val.lower())
                    cat = "team_assigned" if is_assigned else ("team_pending" if is_pending else "team_progress")

                    layer = "Telkom (Eksternal)" if is_telkom else ("EOS L1" if "l1" in grp_val.lower() else ("EOS L2 (Engineer)" if "l2" in grp_val.lower() else ("EOS L3 (Expert)" if "l3" in grp_val.lower() else "Helpdesk (L0)")))

                    norm_t = {
                        "ticketId": tid,
                        "shortDesc": desc,
                        "requestedFor": req_for,
                        "requestState": state_val,
                        "createdDate": date_val,
                        "createdTs": created_ts,
                        "location": loc_val,
                        "assignmentGroup": grp_val,
                        "isGc1": True,
                        "isTelkom": is_telkom,
                        "resolverLayer": layer,
                        "category": cat,
                        "itsmLists": [list_key],
                        "serviceType": srv_type,
                        "priority": prio_val,
                        "isManual": True
                    }
                    track_ticket(tid, state_val, grp_val)
                    norm_t = enrich_ticket_with_sop(norm_t)
                    archive_ticket(norm_t)
                    saved_tickets.append(norm_t)
                    if list_key not in by_list:
                        by_list[list_key] = []
                    by_list[list_key].append(norm_t)

                if saved_tickets:
                    for lk, t_list in by_list.items():
                        try:
                            sentinel_db.save_tickets_to_db(t_list, list_key=lk, source_url="manual_batch")
                        except Exception as db_err:
                            print(f"[Sentinel Server] SQLite batch save error: {db_err}")
                        if lk not in HELPDESK_LISTS:
                            HELPDESK_LISTS[lk] = {"label": "Tiket " + t_list[0]["serviceType"], "tickets": [], "synced_at": time.time(), "title": "Tiket " + t_list[0]["serviceType"], "path": f"/itsm/{lk}"}
                        new_ids = {t["ticketId"] for t in t_list}
                        existing = [t for t in HELPDESK_LISTS[lk]["tickets"] if t.get("ticketId") not in new_ids]
                        HELPDESK_LISTS[lk]["tickets"] = t_list + existing
                        HELPDESK_LISTS[lk]["synced_at"] = time.time()

                    HELPDESK_SNAPSHOT = merge_itsm_lists()
                    LAST_SYNC_TIME = time.strftime("%H:%M:%S WIB")
                    save_persisted_data()

                self.send_json({
                    "status": "success",
                    "saved_count": len(saved_tickets),
                    "error_count": len(errors),
                    "errors": errors[:10],
                    "message": f"Berhasil menyimpan {len(saved_tickets)} tiket manual ke database Sentinel."
                })

            elif path == "/api/ai_suggestion":
                # Saran dari agen AI: hanya disimpan sebagai usulan, tidak mengubah prioritas/SLA sampai Helpdesk menerima
                tid = str(data.get("ticketId") or "").strip()
                sug = data.get("suggestion") or {}
                known = {t.get("ticketId") for t in HELPDESK_SNAPSHOT} | {t.get("ticketId") for t in WA_TICKETS}
                if tid not in known or not isinstance(sug, dict):
                    self.send_json({"status": "error", "message": "Tiket tidak ditemukan atau format salah"}, 400)
                    return
                prio = sug.get("priority")
                clean = {
                    "priority": prio if prio in PRIORITY_CHOICES else None,
                    "summary": str(sug.get("summary") or "")[:300],
                    "reason": str(sug.get("reason") or "")[:300],
                    "is_peer_chatter": bool(sug.get("is_peer_chatter")),
                    "needs_followup": bool(sug.get("needs_followup", True)),
                    "has_image_only": bool(sug.get("has_image_only")),
                    "model": str(data.get("model") or "")[:60],
                    "ts": time.time(),
                }
                e = TICKET_REGISTRY.get(tid) or track_ticket(tid, "")
                e["ai"] = clean
                e.pop("ai_decision", None)
                add_history(e, "Saran AI diterima server", f"{clean['priority'] or '-'} | {clean['summary'][:80]}", actor="Agen AI")
                save_persisted_data()
                self.send_json({"status": "ok"})

            elif path == "/api/nlp_extract":
                if not self._is_local():
                    self.send_json({"status": "error", "message": "Hanya dari Mini PC operator"}, 403)
                    return
                msgs = data.get("messages") or []
                grp = str(data.get("group") or "")[:120]
                if not isinstance(msgs, list) or not msgs:
                    self.send_json({"status": "error", "message": "Tidak ada pesan"}, 400)
                    return
                results = [nlp_analyze(str(m.get("sender") or ""), str(m.get("text") or "")[:4000], grp, m.get("ts"), str(m.get("phone") or "")) for m in msgs[:40] if isinstance(m, dict)]
                job = None
                if data.get("ai") and nlp_ai_available():
                    job = start_nlp_job([(i, r["text"]) for i, r in enumerate(results)])
                self.send_json({"status": "ok", "results": results, "job": job, "ai_available": nlp_ai_available()})

            elif path == "/api/pic_action":
                by = re.sub(r"\s+", " ", str(data.get("by") or "")).strip()[:60]
                if len(by) < 2 or by.lower() in ("operator", "operator helpdesk"):
                    self.send_json({"status": "error", "message": "Nama petugas wajib diisi (SOP bab 12)"}, 400)
                    return
                if not self._is_local():
                    self.send_json({"status": "error", "message": "Hanya dari Mini PC operator"}, 403)
                    return
                act = str(data.get("action") or "")
                clip = lambda k, n=120: re.sub(r"\s+", " ", str(data.get(k) or "")).strip()[:n]
                phone = normalize_phone(data.get("phone"))
                name, instansi, ref, note, basis = clip("name"), clip("instansi"), clip("komdigiRef"), clip("note", 300), clip("basis", 200)

                def err(msg, code=400):
                    self.send_json({"status": "error", "message": msg}, code)

                if act == "add_verified":
                    if not (phone and name and instansi and basis):
                        return err("Nomor HP, nama, instansi, dan dasar verifikasi wajib diisi")
                    PIC_REGISTRY[phone] = {"phone": phone, "name": name, "instansi": instansi, "basis": basis, "verifiedBy": by, "verifiedAt": time.strftime("%d %b %Y %H:%M"), "source": "manual"}
                    c = IDENTITY_CASES.pop(phone, None)
                    if c:
                        case_event(c, "Identitas terverifikasi", f"{name} ({instansi}). Dasar: {basis}", by)
                elif act == "import_csv":
                    added = skipped = 0
                    for line in str(data.get("text") or "").splitlines():
                        parts = [x.strip() for x in re.split(r"[;\t,]", line)]
                        if len(parts) < 3:
                            skipped += bool(line.strip())
                            continue
                        ph = normalize_phone(parts[2])
                        if not (ph and parts[0] and parts[1]):
                            skipped += 1
                            continue
                        PIC_REGISTRY[ph] = {"phone": ph, "name": parts[0][:120], "instansi": parts[1][:120], "basis": basis or "Impor daftar PIC resmi", "verifiedBy": by, "verifiedAt": time.strftime("%d %b %Y %H:%M"), "source": "import"}
                        c = IDENTITY_CASES.pop(ph, None)
                        if c:
                            case_event(c, "Identitas terverifikasi (impor daftar PIC)", f"{parts[0]} ({parts[1]})", by)
                        added += 1
                    save_persisted_data()
                    self.send_json({"status": "ok", "added": added, "skipped": skipped})
                    return
                elif act in ("case_update", "verify_case", "reject_case"):
                    c = IDENTITY_CASES.get(phone)
                    if not c:
                        return err("Kasus verifikasi untuk nomor ini tidak ditemukan", 404)
                    if act == "case_update":
                        status = str(data.get("status") or "")
                        if status not in ("asked", "claimed", "registration_requested"):
                            return err("Status tidak valid")
                        if status == "claimed" and not (name and instansi):
                            return err("Nama dan instansi yang disebut pelapor wajib diisi")
                        if status == "registration_requested" and not ref:
                            return err("Isi nomor/tanggal pengajuan pendaftaran ke Komdigi")
                        if name:
                            c["claimedName"] = name
                        if instansi:
                            c["claimedInstansi"] = instansi
                        if ref:
                            c["komdigiRef"] = ref
                        c["status"] = status
                        label = {"asked": "Pelapor sudah ditanya asal dan instansi", "claimed": "Pelapor menyebut identitas",
                                 "registration_requested": "Pendaftaran diajukan ke Komdigi"}[status]
                        case_event(c, label, (f"{name} ({instansi}) " if name else "") + (f"Ref: {ref}. " if ref else "") + note, by)
                    elif act == "verify_case":
                        vn, vi = name or c.get("claimedName", ""), instansi or c.get("claimedInstansi", "")
                        if not (vn and vi and ref):
                            return err("Nama, instansi, dan nomor/bukti verifikasi dari Komdigi wajib diisi sebelum nomor disimpan")
                        PIC_REGISTRY[phone] = {"phone": phone, "name": vn, "instansi": vi, "basis": f"Terverifikasi Komdigi: {ref}", "verifiedBy": by, "verifiedAt": time.strftime("%d %b %Y %H:%M"), "source": "verifikasi"}
                        case_event(c, "Identitas terverifikasi, nomor disimpan", f"{vn} ({vi}). Bukti: {ref}", by)
                        IDENTITY_CASES.pop(phone, None)
                    else:
                        if not note:
                            return err("Alasan penolakan wajib diisi")
                        c["status"] = "rejected"
                        case_event(c, "Pelapor ditolak: bukan tenan terdaftar", note, by)
                elif act == "remove":
                    if phone not in PIC_REGISTRY or not note:
                        return err("Nomor tidak ada di daftar, atau alasan penghapusan kosong")
                    PIC_REGISTRY.pop(phone)
                else:
                    return err("Aksi tidak dikenal")
                save_persisted_data()
                self.send_json({"status": "ok"})

            elif path == "/api/ticket_action":
                # Tindakan operator pada tiket: ack | set_priority | link_portal | note (semua tercatat di riwayat)
                tid = str(data.get("ticketId") or "").strip()
                action = str(data.get("action") or "")
                value = str(data.get("value") or "").strip()[:300]
                note = str(data.get("note") or "").strip()[:500]
                by = re.sub(r"\s+", " ", str(data.get("by") or "")).strip()[:60]
                if len(by) < 2 or by.lower() in ("operator helpdesk", "operator"):
                    self.send_json({"status": "error", "message": "Nama petugas wajib diisi (satu akun satu orang, SOP bab 12)"}, 400)
                    return
                if not self._is_local():
                    self.send_json({"status": "error", "message": "Hanya dari Mini PC operator"}, 403)
                    return
                known = {t.get("ticketId") for t in HELPDESK_SNAPSHOT} | {t.get("ticketId") for t in WA_TICKETS}
                if tid not in known:
                    self.send_json({"status": "error", "message": "Tiket tidak ditemukan"}, 404)
                    return
                e = TICKET_REGISTRY.get(tid) or track_ticket(tid, "")
                if action == "ack":
                    if not e.get("responded_ts"):
                        e["responded_ts"] = time.time()
                        add_history(e, "Respons pertama dicatat operator", note, actor=by)
                elif action == "set_priority":
                    if value not in PRIORITY_CHOICES or not note:
                        self.send_json({"status": "error", "message": "Prioritas harus Critical/Major/Minor/Service Request dan alasan wajib diisi (SOP 3.3)"}, 400)
                        return
                    e["priority_override"] = value
                    add_history(e, "Prioritas ditetapkan Helpdesk", f"{value}. Alasan: {note}", actor=by)
                elif action == "link_portal":
                    if not re.fullmatch(r"(REQ-[A-Z0-9-]+|INC[0-9]+|TKT-[0-9]+)", value.upper()):
                        self.send_json({"status": "error", "message": "Format nomor tiket portal tidak dikenali"}, 400)
                        return
                    e["linked_portal"] = value.upper()
                    add_history(e, "Ditautkan ke tiket portal", value.upper(), actor=by)
                elif action == "set_category":
                    if value not in SERVICE_CATEGORIES or not note:
                        self.send_json({"status": "error", "message": "Kategori harus salah satu katalog KAK 18.c dan alasan wajib diisi"}, 400)
                        return
                    e["category_override"] = value
                    add_history(e, "Kategori layanan ditetapkan Helpdesk", f"{value}. Alasan: {note}", actor=by)
                    rec = TICKET_ARCHIVE.get(tid)
                    if rec:
                        rec["serviceCategory"] = value
                elif action == "set_phone":
                    w = next((x for x in WA_TICKETS if x.get("ticketId") == tid), None)
                    ph = normalize_phone(value)
                    if not w or not ph:
                        self.send_json({"status": "error", "message": "Hanya untuk pra-tiket WA, dan nomor HP harus valid"}, 400)
                        return
                    w["senderPhone"] = ph
                    add_history(e, "Nomor HP pelapor dicatat", "nomor tersimpan di tiket", actor=by)
                    if identity_for(ph)["status"] != "verified":
                        case = ensure_case(ph, tid)
                        if not case["history"]:
                            case_event(case, "Nomor baru belum terdaftar", "Tanyakan asal dan instansi (SOP 4.1)", by)
                elif action in ("doc_set", "doc_clear"):
                    key = str(data.get("doc") or "")
                    if key not in DOC_LABELS:
                        self.send_json({"status": "error", "message": "Dokumen tidak dikenal"}, 400)
                        return
                    docs = e.setdefault("docs", {})
                    if action == "doc_set":
                        if not value:
                            self.send_json({"status": "error", "message": "Isi nomor dan tanggal dokumen (mis. ND-123/2026, 30 Sep 2026)"}, 400)
                            return
                        docs[key] = {"ref": value, "by": by, "at": time.strftime("%d %b %Y %H:%M"), "auto": False}
                        add_history(e, f"{DOC_LABELS[key]} dicatat", f"{value}. {note}".strip(), actor=by)
                    else:
                        if not note:
                            self.send_json({"status": "error", "message": "Alasan pencabutan wajib diisi"}, 400)
                            return
                        docs.pop(key, None)
                        add_history(e, f"{DOC_LABELS[key]} dicabut", note, actor=by)
                elif action == "ai_accept":
                    ai = e.get("ai")
                    if not ai:
                        self.send_json({"status": "error", "message": "Belum ada saran AI"}, 400)
                        return
                    e["ai_decision"] = "accepted"
                    if ai.get("priority") in PRIORITY_CHOICES:
                        e["priority_override"] = ai["priority"]
                    add_history(e, "Saran AI diterima Helpdesk", f"Prioritas {ai.get('priority')}. {note}", actor=by)
                elif action == "ai_reject":
                    e["ai_decision"] = "rejected"
                    add_history(e, "Saran AI ditolak Helpdesk", note, actor=by)
                elif action == "note":
                    if not note:
                        self.send_json({"status": "error", "message": "Catatan kosong"}, 400)
                        return
                    add_history(e, "Catatan", note, actor=by)
                else:
                    self.send_json({"status": "error", "message": "Aksi tidak dikenal"}, 400)
                    return
                rec = TICKET_ARCHIVE.get(tid)
                if rec:
                    rec["respondedTs"] = e.get("responded_ts")
                    if e.get("priority_override"):
                        rec["priority"] = e["priority_override"]
                        rec["priorityOverridden"] = True
                save_persisted_data()
                self.send_json({"status": "ok"})

            elif path == "/api/config":
                allowed = {k: v for k, v in data.items() if k in CONFIG_API_KEYS}
                save_config({**CONFIG, **allowed})
                self.send_json({"status": "ok", "config": CONFIG, "ignored_keys": sorted(set(data) - set(allowed))})

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
                HELPDESK_LISTS.clear()
                TELKOM_SKIPPED = 0
                ALERTS = []
                WA_TICKETS = []
                TICKET_REGISTRY.clear()
                SENT_RECAP_HASHES.clear()
                WA_QUEUE.clear()
                WA_HISTORY.clear()
                TICKET_ARCHIVE.clear()
                LAST_SYNC_TIME = time.strftime("%H:%M:%S WIB")
                try:
                    sentinel_db.clear_db()
                except Exception as db_err:
                    print(f"[Sentinel Server] SQLite clear error: {db_err}")
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

    if CONFIG.get("team_view_enabled") and not CONFIG.get("team_view_token"):
        save_config({**CONFIG, "team_view_token": secrets.token_urlsafe(18)})
    host = CONFIG.get("bind_host", "127.0.0.1")
    server = http.server.ThreadingHTTPServer((host, port), SentinelHandler)
    print("=" * 70)
    print(f"  [GC 1 SENTINEL] HELPDESK EXPERT SERVER AKTIF (PORT {port})")
    print(f"  Direktori: {APP_DIR}")
    print(f"  Alamat: {host}:{port} (hanya lokal bila 127.0.0.1)")
    if CONFIG.get("team_view_enabled"):
        if host == "127.0.0.1":
            print("  PERINGATAN: team_view_enabled=true tetapi bind_host=127.0.0.1, tim tidak bisa mengakses. Set bind_host ke 0.0.0.0 atau IP LAN.")
        print(f"  Tampilan tim (hanya-baca): http://<alamat-minipc>:{port}/team?token={CONFIG.get('team_view_token')}")
    print(f"  Kirim ke WhatsApp: {'AKTIF' if outbound_enabled() else 'NONAKTIF (hanya membaca grup WA)'}")
    groups = CONFIG.get("wa_monitored_groups") or []
    print(f"  Grup WA dipantau: {', '.join(groups) if groups else 'BELUM DIATUR (isi wa_monitored_groups di config.json)'}")
    print(f"  Dashboard: http://localhost:{port}/dashboard.html")
    print("=" * 70)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Sentinel Server] Menghentikan server...")
        server.server_close()


if __name__ == "__main__":
    main()
