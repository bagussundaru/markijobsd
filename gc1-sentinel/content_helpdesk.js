/**
 * GC 1 Sentinel - Helpdesk Passive Scanner (100% READ-ONLY, ZERO ERROR GUARANTEE)
 * 
 * ATURAN KETAT:
 * - Tidak mengubah tampilan / DOM apa pun di halaman Helpdesk.
 * - Tindakan terhadap tiket dilakukan 100% oleh manusia (operator).
 * - Skrip ini HANYA bertindak sebagai pembaca pasif (silent observer).
 * - Membaca tiket terbaru setiap reload 5 menit, dan meneruskan informasi tiket GC 1 (Assigned)
 *   ke Layar Monitor terpisah di Mini PC & membunyikan alarm.
 */

(function () {
  "use strict";

  // Hanya berjalan pada protokol HTTP/HTTPS dan abaikan WhatsApp / dashboard monitor / internal extension
  if (!location.href.startsWith("http")) return;
  if (
    location.hostname.includes("web.whatsapp.com") ||
    location.protocol === "chrome-extension:" ||
    location.pathname.includes("dashboard") ||
    location.href.includes("dashboard") ||
    document.title.includes("GC 1 Sentinel") ||
    document.querySelector(".sentinel-table") ||
    document.querySelector(".dashboard-main")
  ) {
    return;
  }

  let settings = {
    keywords: [
      "GC 1",
      "GC1",
      "Government Cloud 1",
      "Government Cloud-1",
      "Gov Cloud 1",
      "GovCloud 1",
      "Gedung C 1",
      "Gedung C1"
    ],
    helpdeskUrlPatterns: [
      "helpdesk",
      "ticket",
      "tiket",
      "request",
      "servicedesk",
      "kominfo",
      "pdn",
      "dummy_helpdesk",
      "localhost",
      "127.0.0.1",
      "192.168",
      "10."
    ],
    onlyAssignedState: true,
    requireGcKeyword: true
  };

  // Helper pengiriman pesan yang aman dari error 'Could not establish connection'
  function safeSendMessage(payload) {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) {
      try {
        chrome.runtime.sendMessage(payload, () => {
          // Membaca chrome.runtime.lastError adalah syarat mutlak di Chrome MV3
          // agar tidak memunculkan error 'Could not establish connection' di chrome://extensions
          void chrome.runtime.lastError;
        });
      } catch (_) {}
    }

    try {
      const bus = new BroadcastChannel("gc1_sentinel_bus");
      bus.postMessage(payload);
    } catch (_) {}

    try {
      fetch("http://localhost:8765/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(() => {});
    } catch (_) {}
  }

  async function loadSettings() {
    try {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        const data = await chrome.storage.local.get("settings");
        if (data && data.settings) {
          settings = { ...settings, ...data.settings };
        }
      }
    } catch (_) {}
    checkIfTargetPage();
  }

  function checkIfTargetPage() {
    try {
      const currentUrl = (location.href || "").toLowerCase();
      const currentTitle = (document.title || "").toLowerCase();
      if (
        currentUrl.includes("dashboard") ||
        currentTitle.includes("sentinel") ||
        document.querySelector("#sentinelTable") ||
        document.querySelector(".sentinel-table")
      ) {
        return;
      }
      const bodySnippet = document.body ? document.body.innerText.substring(0, 3000).toLowerCase() : "";

      const matchesUrl = settings.helpdeskUrlPatterns.some((pat) => {
        const p = pat.trim().toLowerCase();
        return p && (currentUrl.includes(p) || currentTitle.includes(p));
      });

      const hasHelpdeskIndicators =
        bodySnippet.includes("short description") ||
        bodySnippet.includes("request state") ||
        bodySnippet.includes("show all request") ||
        bodySnippet.includes("assignment group");

      if (matchesUrl || hasHelpdeskIndicators) {
        runPassiveScan();
        setupPassiveObserver();
      }
    } catch (_) {}
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function checkKeywordMatch(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    for (const kw of settings.keywords) {
      const kwLower = kw.toLowerCase().trim();
      if (!kwLower) continue;
      const regex = new RegExp(`\\b${escapeRegExp(kwLower)}\\b`, "i");
      if (regex.test(text) || lower.includes(kwLower)) {
        return kw;
      }
    }
    return null;
  }

  function getKnownTicketRegistry() {
    try {
      const raw = localStorage.getItem("gc1_helpdesk_known_states");
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }

  function saveKnownTicketRegistry(reg) {
    try {
      localStorage.setItem("gc1_helpdesk_known_states", JSON.stringify(reg));
    } catch (_) {}
  }

  function getColumnIndexes(tableEl) {
    try {
      const headerRow = tableEl.querySelector("thead tr") || tableEl.querySelector("tr");
      if (!headerRow) return null;

      const headers = Array.from(headerRow.querySelectorAll("th, td")).map((th) => (th.textContent || "").trim().toLowerCase());

      return {
        numberIdx: headers.findIndex((h) => h.includes("number") || h.includes("nomor") || h.includes("ticket")),
        descIdx: headers.findIndex((h) => h.includes("short description") || h.includes("description") || h.includes("deskripsi")),
        requestedForIdx: headers.findIndex((h) => h.includes("requested for") || h.includes("pemohon")),
        stateIdx: headers.findIndex((h) => h.includes("request state") || h.includes("state") || h.includes("status")),
        dateIdx: headers.findIndex((h) => h.includes("date") || h.includes("tanggal")),
        locationIdx: headers.findIndex((h) => h.includes("location") || h.includes("lokasi")),
        groupIdx: headers.findIndex((h) => h.includes("assignment group") || h.includes("group") || h.includes("grup"))
      };
    } catch (_) {
      return null;
    }
  }

  async function runPassiveScan() {
    try {
      const knownRegistry = getKnownTicketRegistry();
      let registryModified = false;
      const tables = document.querySelectorAll("table");
      if (!tables || tables.length === 0) return;

      const scannedTickets = [];
      const seenTicketIds = new Set();

      tables.forEach((table) => {
        if (table.id === "sentinelTable" || table.classList.contains("sentinel-table") || table.closest(".dashboard-main")) {
          return;
        }
        const colIdx = getColumnIndexes(table);
        if (!colIdx || colIdx.numberIdx === -1 || colIdx.descIdx === -1) return;

        const rows = table.querySelectorAll("tbody tr, tr");
        rows.forEach((row) => {
          if (row.querySelector("th")) return;

          const cells = Array.from(row.querySelectorAll("td"));
          if (!cells || cells.length === 0) return;

          const anchorEl = (colIdx.numberIdx !== -1 && cells[colIdx.numberIdx])
            ? cells[colIdx.numberIdx].querySelector("a")
            : row.querySelector("a");
          let ticketNumber = anchorEl
            ? anchorEl.textContent.trim()
            : (colIdx.numberIdx !== -1 && cells[colIdx.numberIdx] ? cells[colIdx.numberIdx].textContent.trim() : "");
          ticketNumber = ticketNumber.replace(/[📋\r\n\t]/g, "").trim();

          if (!ticketNumber || seenTicketIds.has(ticketNumber)) return;
          seenTicketIds.add(ticketNumber);

          let shortDesc = colIdx.descIdx !== -1 && cells[colIdx.descIdx]
            ? cells[colIdx.descIdx].textContent.trim()
            : (cells[2]?.textContent.trim() || "");
          shortDesc = shortDesc.replace(/\s+/g, " ").trim();

          let requestedFor = colIdx.requestedForIdx !== -1 && cells[colIdx.requestedForIdx]
            ? cells[colIdx.requestedForIdx].textContent.trim()
            : (cells[3]?.textContent.trim() || "");
          requestedFor = requestedFor.split("\n")[0].replace(/[📍📲📋]/g, "").replace(/\s+/g, " ").trim();

          let requestState = colIdx.stateIdx !== -1 && cells[colIdx.stateIdx]
            ? cells[colIdx.stateIdx].textContent.trim()
            : (cells[4]?.textContent.trim() || "");
          requestState = requestState.replace(/[●•\r\n\t]/g, "").replace(/\s+/g, " ").trim();

          let createdDate = colIdx.dateIdx !== -1 && cells[colIdx.dateIdx]
            ? cells[colIdx.dateIdx].textContent.trim()
            : (cells[5]?.textContent.trim() || "");
          createdDate = createdDate.replace(/\s+/g, " ").trim();

          let locationName = colIdx.locationIdx !== -1 && cells[colIdx.locationIdx]
            ? cells[colIdx.locationIdx].textContent.trim()
            : (cells[6]?.textContent.trim() || "");
          locationName = locationName.split("\n")[0].replace(/[📍📲📋]/g, "").replace(/\s+/g, " ").trim();

          let assignmentGroup = colIdx.groupIdx !== -1 && cells[colIdx.groupIdx]
            ? cells[colIdx.groupIdx].textContent.trim()
            : (cells[7]?.textContent.trim() || "");
          assignmentGroup = assignmentGroup.split("\n")[0].replace(/[📍📲📋]/g, "").replace(/\s+/g, " ").trim();

          const fullRowText = `${ticketNumber} ${shortDesc} ${requestedFor} ${requestState} ${createdDate} ${locationName} ${assignmentGroup}`;
          const matchedKw = checkKeywordMatch(fullRowText);
          const isGc1 = Boolean(matchedKw);

          // 1. EVALUASI ATURAN OPERASIONAL SOP GC 1 & CLOUD PDN:
          // Tiket yang memiliki label TELKOM diabaikan sepenuhnya karena di luar ruang lingkup!
          const isTelkom = assignmentGroup.toLowerCase().includes("telkom") || fullRowText.toLowerCase().includes("telkom");
          if (isTelkom) {
            return; // Telkom di luar ruang lingkup GC 1 Sentinel
          }

          const isAssigned = requestState.toLowerCase() === "assigned" || requestState.toLowerCase().includes("assign");
          const isPending = requestState.toLowerCase().includes("pending");
          const isInProgress = requestState.toLowerCase().includes("progress");

          let category = "team_assigned";
          if (isAssigned) {
            category = "team_assigned";
          } else if (isPending) {
            category = "team_pending";
          } else if (isInProgress) {
            category = "team_progress";
          } else {
            category = "team_assigned";
          }

          let resolverLayer = "Helpdesk (L0)";
          if (isTelkom) resolverLayer = "Telkom (Eksternal)";
          else if (assignmentGroup.toLowerCase().includes("eos l1")) resolverLayer = "EOS L1";
          else if (assignmentGroup.toLowerCase().includes("eos l2")) resolverLayer = "EOS L2 (Engineer)";
          else if (assignmentGroup.toLowerCase().includes("eos l3")) resolverLayer = "EOS L3 (Expert)";
          else if (assignmentGroup.toLowerCase().includes("noc")) resolverLayer = "NOC";
          else if (assignmentGroup.toLowerCase().includes("soc")) resolverLayer = "SOC";

          // Catat SEMUA tiket untuk disinkronkan ke GC 1 Sentinel (100% Selaras)
          scannedTickets.push({
            ticketId: ticketNumber,
            shortDesc: shortDesc,
            requestedFor: requestedFor,
            requestState: requestState,
            createdDate: createdDate,
            location: locationName,
            assignmentGroup: assignmentGroup,
            isGc1: isGc1,
            isTelkom: isTelkom,
            resolverLayer: resolverLayer,
            category: category,
            matchedKeyword: matchedKw || (isTelkom ? "TELKOM" : "Tim Internal")
          });

          // 2. LOGIKA STATE MACHINE & ANTI-SPAM NOTIFIKASI
          // Tiket Telkom hanya diteruskan sesuai SOP Bab 1.2 & 5.3 (jangan kirim rekapan WA)
          if (isTelkom) return;

          if (!isAssigned) {
            // Tiket tim kita tetapi statusnya masih Pending / In Progress
            if (!knownRegistry[ticketNumber] || knownRegistry[ticketNumber].state !== requestState) {
              knownRegistry[ticketNumber] = {
                state: requestState,
                reportedState: knownRegistry[ticketNumber]?.reportedState || null,
                lastSeen: Date.now()
              };
              registryModified = true;
            }
            return;
          }

          // 3. STANDAR HELPDESK EXPERT: DEDUPLIKASI & DETEKSI UPDATE KE ASSIGNED
          const prevEntry = knownRegistry[ticketNumber];
          if (prevEntry && prevEntry.reportedState === "Assigned") {
            // Tiket sudah pernah dilaporkan saat status Assigned, jangan spam lagi
            return;
          }

          // Tiket ini adalah TIKET BARU ASSIGNED atau UPDATE dari Pending ke Assigned!
          const updateType = prevEntry ? "UPDATE_STATUS_TO_ASSIGNED" : "NEW_TICKET_ASSIGNED";
          knownRegistry[ticketNumber] = {
            state: "Assigned",
            reportedState: "Assigned",
            lastSeen: Date.now(),
            reportedAt: Date.now()
          };
          registryModified = true;

          console.log(`[GC 1 Sentinel Expert] 🚨 ${updateType}: ${ticketNumber} - ${shortDesc}`);

          safeSendMessage({
            type: "NEW_ALERT",
            data: {
              source: "helpdesk",
              ticketId: ticketNumber,
              sender: requestedFor ? `${requestedFor} (${locationName || "Kominfo"})` : "Helpdesk User",
              text: `[${requestState.toUpperCase()}] ${shortDesc} | Lokasi: ${locationName || "-"} | Group: ${assignmentGroup || "-"}`,
              matchedKeyword: matchedKw || "GC 1",
              requestState: requestState,
              createdDate: createdDate,
              sourceUrl: location.href,
              updateType: updateType
            }
          });
        });
      });

      // SINKRONKAN SELURUH DATA TIKET KE GC 1 SENTINEL DASHBOARD
      if (scannedTickets.length > 0) {
        try {
          const bus = new BroadcastChannel("gc1_sentinel_bus");
          bus.postMessage({
            type: "SYNC_HELPDESK_TICKETS",
            tickets: scannedTickets,
            count: scannedTickets.length,
            timestamp: Date.now()
          });
        } catch (_) {}

        try {
          fetch("http://localhost:8765/api/sync_helpdesk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tickets: scannedTickets, list: { title: document.title, path: location.pathname } })
          }).catch(() => {});
        } catch (_) {}

        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          try {
            chrome.runtime.sendMessage({
              type: "SYNC_HELPDESK_TICKETS",
              tickets: scannedTickets
            }, () => { void chrome.runtime.lastError; });
          } catch (_) {}
        }
      }

      if (registryModified) {
        saveKnownTicketRegistry(knownRegistry);
      }
    } catch (_) {}
  }

  function setupPassiveObserver() {
    try {
      if (!document.body) return;
      let scanTimeout = null;
      const observer = new MutationObserver(() => {
        if (scanTimeout) clearTimeout(scanTimeout);
        scanTimeout = setTimeout(() => {
          runPassiveScan();
        }, 1200);
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Pindai berkala setiap 15 detik untuk mengantisipasi perubahan data tabel tanpa reload penuh
      setInterval(runPassiveScan, 15000);
    } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadSettings);
  } else {
    loadSettings();
  }
})();
