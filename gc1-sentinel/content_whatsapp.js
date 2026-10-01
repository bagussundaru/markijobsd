/**
 * GC 1 Sentinel - WhatsApp Web Content Script (v2, hanya membaca)
 *
 * - HANYA membaca pesan masuk dari grup yang terdaftar di config.json (wa_monitored_groups).
 *   Chat pribadi dan grup lain tidak diproses.
 * - Pesan aduan diteruskan ke Sentinel Server lokal (/api/add_wa_ticket) menjadi pra-tiket di dashboard,
 *   lengkap dengan waktu pesan asli (dasar SLA, SOP 4.4) dan id pesan (anti-duplikat).
 * - TIDAK mengetik atau mengirim apa pun ke WhatsApp.
 */

(function () {
  "use strict";

  const SERVER = "http://localhost:8765";

  let settings = {
    keywords: ["GC 1", "GC1", "Government Cloud 1", "Government Cloud-1", "Gov Cloud 1", "GovCloud 1", "Gedung C 1", "Gedung C1"],
    groups: [],
    ignored: [],
    maxAgeHours: 24
  };

  const processedMsgIds = new Set();
  let warnedNoGroups = false;

  function safeSendMessage(payload) {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) {
      try {
        chrome.runtime.sendMessage(payload, () => {
          void chrome.runtime.lastError;
        });
      } catch (_) {}
    }
  }

  async function loadSettings() {
    try {
      const res = await fetch(`${SERVER}/api/config`);
      if (!res.ok) return;
      const cfg = await res.json();
      if (Array.isArray(cfg.keywords) && cfg.keywords.length) settings.keywords = cfg.keywords;
      settings.groups = Array.isArray(cfg.wa_monitored_groups) ? cfg.wa_monitored_groups.filter((g) => String(g).trim()) : [];
      settings.ignored = Array.isArray(cfg.wa_ignored_groups) ? cfg.wa_ignored_groups.filter((g) => String(g).trim()) : [];
      settings.maxAgeHours = Number(cfg.wa_max_age_hours) || 24;
    } catch (_) {}
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function matchesKeywords(text) {
    if (!text) return null;
    for (const kw of settings.keywords) {
      const k = String(kw).toLowerCase().trim();
      if (!k) continue;
      if (new RegExp(`(^|[^a-z0-9])${escapeRegExp(k)}([^a-z0-9]|$)`, "i").test(text)) return kw;
    }
    return null;
  }

  function getActiveChatName() {
    try {
      const mainHeader = document.querySelector("#main header");
      if (!mainHeader) return "";
      const titleEl = mainHeader.querySelector('[data-testid="conversation-info-header-chat-title"]') ||
                      mainHeader.querySelector("span[title]") ||
                      mainHeader.querySelector("div[role='button'] span");
      return titleEl ? titleEl.textContent.trim() : "";
    } catch (_) {
      return "";
    }
  }

  /**
   * Heuristik "ini grup, bukan chat pribadi": subjudul header grup berisi daftar anggota
   * ("Aldi, Alika, Andri, ..."), sedangkan chat pribadi berisi "online" / "terakhir dilihat".
   * BELUM diverifikasi pada WhatsApp Web-mu: jalankan DIAGNOSTIK_WA_DOM.js bila ada grup yang terlewat/salah.
   */
  function looksLikeGroupChat() {
    try {
      const lines = (document.querySelector("#main header")?.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean);
      const sub = lines[1] || "";
      if (!sub || /online|terakhir dilihat|last seen|mengetik|typing|sedang merekam/i.test(sub)) return false;
      return sub.includes(",");
    } catch (_) {
      return false;
    }
  }

  function isMonitoredGroup(name) {
    if (!name) return false;
    const lower = name.toLowerCase();
    if (settings.ignored.some((g) => lower.includes(String(g).trim().toLowerCase()))) return false;
    if (settings.groups.some((g) => String(g).trim() === "*")) return looksLikeGroupChat();
    return settings.groups.some((g) => lower.includes(String(g).trim().toLowerCase()));
  }

  /**
   * "[16:22, 9/30/2026]" atau "[16.22, 30/09/2026]" -> epoch detik.
   * Format tanggal bergantung locale browser; bila ambigu (d/m vs m/d) pilih yang paling masuk akal
   * (tidak di masa depan, paling dekat dengan sekarang).
   */
  function parseWaTime(timeInfo) {
    try {
      const t = /(\d{1,2})[:.](\d{2})(?:\s*([AaPp][Mm]))?/.exec(timeInfo || "");
      const d = /(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})/.exec(timeInfo || "");
      if (!t || !d) return null;
      let hh = parseInt(t[1], 10);
      const mm = parseInt(t[2], 10);
      if (t[3]) {
        const pm = t[3].toLowerCase() === "pm";
        if (pm && hh < 12) hh += 12;
        if (!pm && hh === 12) hh = 0;
      }
      const a = parseInt(d[1], 10), b = parseInt(d[2], 10), c = parseInt(d[3], 10);
      const candidates = [];
      if (a > 31) candidates.push([a, b, c]);            // yyyy/mm/dd
      else {
        const year = c < 100 ? 2000 + c : c;
        candidates.push([year, a, b]);                    // m/d/yyyy
        candidates.push([year, b, a]);                    // d/m/yyyy
      }
      const now = Date.now();
      let best = null;
      for (const [y, mo, da] of candidates) {
        if (mo < 1 || mo > 12 || da < 1 || da > 31) continue;
        const ts = new Date(y, mo - 1, da, hh, mm, 0).getTime();
        if (ts > now + 5 * 60 * 1000) continue;
        if (best === null || Math.abs(now - ts) < Math.abs(now - best)) best = ts;
      }
      return best === null ? null : Math.floor(best / 1000);
    } catch (_) {
      return null;
    }
  }

  function parseMessageElement(el) {
    try {
      const copyable = el.classList?.contains("copyable-text") ? el : el.querySelector(".copyable-text");
      let sender = "";
      let timeInfo = "";
      let rawText = "";

      if (copyable) {
        const prePlain = copyable.getAttribute("data-pre-plain-text") || "";
        const match = prePlain.match(/\[(.*?)\]\s*(.*?):\s*$/);
        if (match) {
          timeInfo = match[1];
          sender = match[2].trim();
        }
      }

      if (!sender) {
        const authorEl = el.querySelector('[data-testid="author"]') || el.querySelector("span._amk6");
        if (authorEl) sender = authorEl.textContent.trim();
      }

      const textEl = el.querySelector(".selectable-text") || el.querySelector("span._ao3e") || copyable;
      rawText = textEl ? textEl.textContent.trim() : "";

      const dataId = el.getAttribute("data-id") || el.closest("[data-id]")?.getAttribute("data-id") || "";
      return { sender, rawText, dataId, timeInfo };
    } catch (_) {
      return { sender: "", rawText: "", dataId: "", timeInfo: "" };
    }
  }

  function inspectMessage(el) {
    if (!el || !(el instanceof HTMLElement)) return;

    try {
      const activeGroup = getActiveChatName();
      if (!settings.groups.length) {
        if (!warnedNoGroups) {
          warnedNoGroups = true;
          console.warn("[GC 1 Sentinel] wa_monitored_groups di config.json masih kosong. Tidak ada pesan WhatsApp yang dibaca.");
        }
        return;
      }
      if (!isMonitoredGroup(activeGroup)) return;

      const { sender, rawText, dataId, timeInfo } = parseMessageElement(el);
      if (!rawText || rawText.length < 8) return;
      // Pesan keluar (dikirim operator sendiri) tidak dijadikan aduan
      if (dataId.startsWith("true_")) return;

      const msgId = dataId || `${activeGroup}|${timeInfo}|${sender}|${rawText.slice(0, 60)}`;
      if (processedMsgIds.has(msgId)) return;
      processedMsgIds.add(msgId);

      const waTs = parseWaTime(timeInfo);
      if (waTs && Date.now() / 1000 - waTs > settings.maxAgeHours * 3600) return;

      const matchedKw = matchesKeywords(rawText);
      const hasHelpIntent = /\b(kendala|permohonan|mohon|bantuan|tolong|vm|server|cloud|ram|cpu|disk|down|rusak|error|ip|akses|backup|restore|waf)\b/i.test(rawText);
      if (!(matchedKw || (hasHelpIntent && rawText.length > 15))) return;

      const effectiveKw = matchedKw || "Aduan Grup WA";
      safeSendMessage({
        type: "NEW_ALERT",
        data: { source: "whatsapp", sender: sender || "Member Grup", group: activeGroup, text: rawText, matchedKeyword: effectiveKw, ticketId: "" }
      });

      fetch(`${SERVER}/api/add_wa_ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: sender || "Member Grup WA",
          group: activeGroup,
          text: rawText,
          matchedKeyword: effectiveKw,
          msgId,
          waTs
        })
      }).then((res) => res.json()).then((data) => {
        if (data && data.status === "success") {
          console.log(`[GC 1 Sentinel] Pra-tiket masuk dashboard: ${data.ticket?.ticketId}`);
        }
      }).catch(() => {
        // Server belum aktif: lepaskan agar pesan dicoba lagi pada pemindaian berikutnya
        processedMsgIds.delete(msgId);
      });
    } catch (_) {}
  }

  function scanVisibleMessages() {
    try {
      document.querySelectorAll('#main div[data-testid="msg-container"], #main div.message-in, #main div[role="row"]')
        .forEach((msg) => inspectMessage(msg));
    } catch (_) {}
  }

  function setupObserver() {
    try {
      const targetNode = document.querySelector("#app") || document.body;
      if (!targetNode) return;
      const sel = '[data-testid="msg-container"], .message-in, [role="row"]';
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            if (node.matches?.(sel)) inspectMessage(node);
            else node.querySelectorAll?.(sel).forEach((sm) => inspectMessage(sm));
          });
        }
      });
      observer.observe(targetNode, { childList: true, subtree: true });
    } catch (_) {}
  }

  async function init() {
    await loadSettings();
    console.log(`[GC 1 Sentinel] WhatsApp reader (hanya membaca) aktif. Grup dipantau: ${settings.groups.join(", ") || "BELUM DIATUR"}`);
    setTimeout(() => {
      scanVisibleMessages();
      setupObserver();
    }, 2500);
    // Muat ulang pengaturan dan pindai ulang berkala (mis. setelah config.json diubah)
    setInterval(async () => {
      await loadSettings();
      scanVisibleMessages();
    }, 60000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
