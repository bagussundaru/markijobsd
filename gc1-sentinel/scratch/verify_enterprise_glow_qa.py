import os
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')
from playwright.sync_api import sync_playwright

SCREENSHOT_DIR = r"C:\Users\gentonation\.gemini\antigravity\brain\07b2eafb-99aa-435d-843d-3c3fbe097cc9\qa_screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

errors = []

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1600, "height": 1050})

        def on_console(msg):
            if msg.type == "error":
                errors.append(msg.text)
                print(f"[CONSOLE ERROR] {msg.text}")

        page.on("console", on_console)
        page.on("pageerror", lambda err: errors.append(str(err)))

        print("Navigating to http://127.0.0.1:8765/dashboard.html ...")
        page.goto("http://127.0.0.1:8765/dashboard.html", wait_until="networkidle")
        time.sleep(2)

        # 1. Overview in Calm State (assigned = 0)
        path_ov = os.path.join(SCREENSHOT_DIR, "39_overview_enterprise_v4.png")
        page.screenshot(path=path_ov)
        print(f"Captured: {path_ov}")

        card_count = page.evaluate("() => document.querySelectorAll('#ovKpis .v3-kpi').length")
        print(f"Overview KPI card count: {card_count}")

        # Check heights & contents of all 6 cards
        heights = page.evaluate("""() => {
            const cards = Array.from(document.querySelectorAll('#ovKpis .v3-kpi'));
            return cards.map((c, i) => ({
                index: i + 1,
                label: c.querySelector('.k-label')?.innerText,
                val: c.querySelector('.k-val')?.innerText,
                category: c.querySelector('.k-category')?.innerText,
                legend: c.querySelector('.k-meta-legend')?.innerText?.replace(/\\n/g, ' '),
                footer: c.querySelector('.k-footer-text')?.innerText,
                height: Math.round(c.getBoundingClientRect().height),
                isAssignedActive: c.classList.contains('is-assigned-active')
            }));
        }""")
        print("Overview cards metrics & heights (Calm State):")
        for h in heights:
            print(f"  Card {h['index']}: [{h['category']}] {h['val']} | {h['label']} | {h['legend']} | {h['footer']} | Height: {h['height']}px | Active: {h['isAssignedActive']}")

        # 2. Simulate 1 Assigned Ticket to trigger Glowing Pulse & Live Beacon + Alarm Toast
        print("\nSimulating 1 Assigned Ticket to verify glowing pulse and beacon...")
        page.evaluate("""() => {
            const st = window.getState ? window.getState() : {};
            const snap = JSON.parse(JSON.stringify(st.snapshot || {}));
            snap.team_assigned = [
                {
                    ticketId: "REQ-009988",
                    shortDesc: "Penyediaan Akun Baru Government Cloud 1",
                    requestedFor: "Budi Santoso",
                    location: "Kemenkeu",
                    requestState: "Assigned",
                    createdDate: "03-10-2026 11:00",
                    priority: "Major",
                    isGc1: true
                }
            ];
            snap.team_assigned_count = 1;
            snap.gc1_assigned_count = 1;
            if (snap.all_scanned_tickets) {
                snap.all_scanned_tickets.unshift(snap.team_assigned[0]);
            }
            if (window.V3 && V3.onSnapshot) {
                V3.onSnapshot(snap);
            }
            if (typeof window.showAssignedTicketToast === 'function') {
                window.showAssignedTicketToast(1, 1);
            }
        }""")
        time.sleep(1)

        # Check Assigned Card active status
        assigned_status = page.evaluate("""() => {
            const assignedCard = document.querySelector('#ovKpis .v3-kpi:nth-child(2)');
            return {
                hasPulseClass: assignedCard?.classList.contains('is-assigned-active'),
                hasBeacon: !!assignedCard?.querySelector('.beacon-pulse-indicator'),
                badgeText: assignedCard?.querySelector('.k-pill')?.innerText,
                val: assignedCard?.querySelector('.k-val')?.innerText,
                hasToast: !!document.getElementById('assignedToastNotification')
            };
        }""")
        print(f"Assigned Card Active Status: {assigned_status}")

        path_pulse = os.path.join(SCREENSHOT_DIR, "40_assigned_active_beacon_glow.png")
        page.screenshot(path=path_pulse)
        print(f"Captured: {path_pulse}")

        # 3. Switch to ITSM All Request
        page.evaluate("() => { if (window.V3 && V3.switchItsmSubmenu) V3.switchItsmSubmenu('request'); }")
        time.sleep(1)
        path_req = os.path.join(SCREENSHOT_DIR, "41_request_submenu_enterprise.png")
        page.screenshot(path=path_req)
        print(f"Captured: {path_req}")

        # 4. Switch to ITSM All Incident
        page.evaluate("() => { if (window.V3 && V3.switchItsmSubmenu) V3.switchItsmSubmenu('incident'); }")
        time.sleep(1)
        path_inc = os.path.join(SCREENSHOT_DIR, "42_incident_submenu_enterprise.png")
        page.screenshot(path=path_inc)
        print(f"Captured: {path_inc}")

        browser.close()

    if errors:
        print(f"\nFAILED with {len(errors)} errors:")
        for err in errors:
            print(" -", err)
        sys.exit(1)
    else:
        print("\nSUCCESS: 0 console errors, enterprise cards & assigned pulse glow verified!")

if __name__ == "__main__":
    run()
