"""
Markijo Agent - GC 1 Sentinel (v2, SOP v0.2)

Pengawas konsol lokal. Tidak mengirim apa pun ke WhatsApp.
Setiap siklus, Markijo membaca /api/helpdesk_snapshot dari Sentinel Server dan mencetak:
  - tiket/pra-tiket baru yang muncul sejak siklus sebelumnya,
  - tiket yang perlu eskalasi: respons >15 menit, lewat 50% SLA tanpa aktivitas, batas eskalasi L2, SLA lewat.
Riwayat kejadian ditulis ke markijo_events.log agar bisa dijadikan bukti untuk laporan.

Prinsip: 100% read-only di Helpdesk/ITSM; tindakan teknis oleh operator manusia.
"""

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

APP_DIR = Path(__file__).resolve().parent
CONFIG_PATH = APP_DIR / "config.json"
EVENT_LOG = APP_DIR / "markijo_events.log"


def load_config():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"poll_interval_seconds": 30, "server_port": 8765}


def http_get(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Markijo-Agent/2.0"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None
    return None


class MarkijoGCSentinel:
    def __init__(self, config=None):
        self.config = config or load_config()
        self.port = self.config.get("server_port", 8765)
        self.base_url = f"http://127.0.0.1:{self.port}"
        self.known_ids = None  # None = siklus pertama (jangan banjiri log dengan tiket lama)
        self.flagged = set()   # (ticketId, flag) yang sudah dicetak, agar tidak berulang

    def log_event(self, text):
        line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {text}"
        print("   " + line)
        try:
            with open(EVENT_LOG, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        except Exception:
            pass

    def scan_once(self):
        snap = http_get(f"{self.base_url}/api/helpdesk_snapshot")
        if not snap:
            return {"status": "no_connection", "message": "Server Sentinel belum aktif atau tidak merespons"}

        tickets = snap.get("all_tickets", [])
        ids = {t.get("ticketId") for t in tickets}
        new_items = []
        if self.known_ids is not None:
            new_items = [t for t in tickets if t.get("ticketId") not in self.known_ids]
        self.known_ids = ids

        for t in new_items:
            kind = "Pra-tiket WA" if t.get("isFromWa") else "Tiket portal"
            self.log_event(f"BARU {kind} {t.get('ticketId')} [{t.get('priority')}] {t.get('location', '')}: {t.get('shortDesc', '')[:80]}")

        flagged_now = 0
        for t in snap.get("escalations", []):
            for flag in t.get("escalationFlags", []):
                key = (t.get("ticketId"), flag)
                if key in self.flagged:
                    continue
                self.flagged.add(key)
                flagged_now += 1
                self.log_event(f"ESKALASI {t.get('ticketId')} [{t.get('priority')}] {flag}")

        return {"status": "ok", "total": len(tickets), "new": len(new_items), "escalations": flagged_now}

    def run_loop(self):
        interval = self.config.get("poll_interval_seconds", 30)
        print("=" * 70)
        print("   MARKIJO AGENT v2 - GC 1 SENTINEL (hanya membaca, tanpa kirim WA)")
        print("=" * 70)
        print(f"   Server   : {self.base_url}")
        print(f"   Siklus   : setiap {interval} detik")
        print(f"   Log      : {EVENT_LOG}")
        print("=" * 70)
        print("\n[Markijo] Memulai pemantauan... Tekan Ctrl+C untuk berhenti.\n")

        cycle = 0
        while True:
            cycle += 1
            try:
                res = self.scan_once()
                if res["status"] == "ok":
                    print(f"[{time.strftime('%H:%M:%S')}] #{cycle} tiket={res['total']} baru={res['new']} eskalasi baru={res['escalations']}")
                else:
                    print(f"[{time.strftime('%H:%M:%S')}] #{cycle} {res['message']}")
            except Exception as e:
                print(f"[{time.strftime('%H:%M:%S')}] #{cycle} Error: {e}")
            time.sleep(interval)


def main():
    parser = argparse.ArgumentParser(description="Markijo GC 1 Sentinel Agent (read-only)")
    parser.add_argument("--once", action="store_true", help="Jalankan satu kali pemindaian lalu keluar")
    parser.add_argument("--interval", type=int, default=0, help="Interval pemindaian dalam detik")
    args = parser.parse_args()

    cfg = load_config()
    if args.interval:
        cfg["poll_interval_seconds"] = args.interval
    agent = MarkijoGCSentinel(cfg)

    if args.once:
        print("Hasil:", agent.scan_once())
    else:
        try:
            agent.run_loop()
        except KeyboardInterrupt:
            print("\n[Markijo] Pemantauan dihentikan.")


if __name__ == "__main__":
    main()
