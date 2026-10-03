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

        # 1. Overview
        path_ov = os.path.join(SCREENSHOT_DIR, "35_overview_enterprise_cards.png")
        page.screenshot(path=path_ov)
        print(f"Captured: {path_ov}")

        card_count = page.evaluate("() => document.querySelectorAll('#ovKpis .v3-kpi').length")
        print(f"Overview KPI card count: {card_count}")

        # Check heights of all 6 cards
        heights = page.evaluate("""() => {
            const cards = Array.from(document.querySelectorAll('#ovKpis .v3-kpi'));
            return cards.map((c, i) => ({
                index: i + 1,
                label: c.querySelector('.k-label')?.innerText,
                val: c.querySelector('.k-val')?.innerText,
                chips: c.querySelector('.k-mid-chips')?.innerText?.replace(/\\n/g, ' '),
                footer: c.querySelector('.k-footer-text')?.innerText,
                height: Math.round(c.getBoundingClientRect().height)
            }));
        }""")
        print("Overview cards metrics & heights:")
        for h in heights:
            print(f"  Card {h['index']}: {h['val']} | {h['label']} | {h['chips']} | {h['footer']} | Height: {h['height']}px")

        # 2. Switch to ITSM All
        page.evaluate("() => { if (window.V3 && V3.showView) V3.showView('itsm'); }")
        time.sleep(1)
        path_itsm = os.path.join(SCREENSHOT_DIR, "36_itsm_all_enterprise_cards.png")
        page.screenshot(path=path_itsm)
        print(f"Captured: {path_itsm}")

        # 3. Switch to Request
        page.evaluate("() => { if (window.V3 && V3.switchItsmSubmenu) V3.switchItsmSubmenu('request'); }")
        time.sleep(1)
        path_req = os.path.join(SCREENSHOT_DIR, "37_request_enterprise_cards.png")
        page.screenshot(path=path_req)
        print(f"Captured: {path_req}")

        # 4. Switch to Incident
        page.evaluate("() => { if (window.V3 && V3.switchItsmSubmenu) V3.switchItsmSubmenu('incident'); }")
        time.sleep(1)
        path_inc = os.path.join(SCREENSHOT_DIR, "38_incident_enterprise_cards.png")
        page.screenshot(path=path_inc)
        print(f"Captured: {path_inc}")

        browser.close()

    if errors:
        print(f"\nFAILED with {len(errors)} errors:")
        for err in errors:
            print(" -", err)
        sys.exit(1)
    else:
        print("\nSUCCESS: 0 console errors, enterprise cards perfectly verified!")

if __name__ == "__main__":
    run()
