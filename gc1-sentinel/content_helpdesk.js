/**
 * GC 1 Sentinel - Helpdesk Passive Scanner (100% READ-ONLY, ZERO ERROR GUARANTEE)
 * 
 * ATURAN KETAT:
 * - Tidak mengubah tampilan / DOM apa pun di halaman Helpdesk.
 * - Tindakan terhadap tiket dilakukan 100% oleh manusia (operator).
 * - Skrip ini HANYA bertindak sebagai pembaca pasif (silent observer).
 * - Membaca tiket terbaru dan meneruskan informasi tiket GC 1 ke Layar Monitor di Mini PC.
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
      "incident",
      "layanan.go.id",
      "pdn.layanan.go.id",
      "kominfo.go.id",
      "komdigi.go.id",
      "service-now"
    ],
    onlyAssignedState: true,
    requireGcKeyword: true,
    autoRefreshHelpdeskSeconds: 60
  };

  let lastUserActivity = Date.now();
  if (typeof window !== "undefined") {
    ["mousedown", "keydown", "scroll", "touchstart"].forEach((evt) => {
      window.addEventListener(evt, () => { lastUserActivity = Date.now(); }, { passive: true });
    });
  }

  function showReloadToast(msg) {
    try {
      let toast = document.getElementById("gc1-sentinel-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "gc1-sentinel-toast";
        toast.style.position = "fixed";
        toast.style.bottom = "16px";
        toast.style.right = "16px";
        toast.style.backgroundColor = "rgba(15, 23, 42, 0.92)";
        toast.style.color = "#38BDF8";
        toast.style.padding = "8px 14px";
        toast.style.borderRadius = "8px";
        toast.style.fontSize = "12px";
        toast.style.fontFamily = "system-ui, -apple-system, sans-serif";
        toast.style.fontWeight = "600";
        toast.style.zIndex = "999999";
        toast.style.boxShadow = "0 4px 12px rgba(0,0,0,0.25)";
        toast.style.transition = "opacity 0.3s ease";
        toast.style.pointerEvents = "none";
        document.body.appendChild(toast);
      }
      toast.textContent = `⚡ GC 1 Sentinel: ${msg}`;
      toast.style.opacity = "1";
      setTimeout(() => {
        if (toast) toast.style.opacity = "0";
      }, 2500);
    } catch (_) {}
  }

  function playTicketIncomingAudio() {
    // Audio alert dialihkan sepenuhnya ke GC 1 Sentinel Dashboard agar terpusat dan tidak berulang
    return;
  }

  function getAccessibleDocs() {
    const docs = [];
    function collect(w) {
      if (!w) return;
      try {
        if (w.document && !docs.includes(w.document)) {
          docs.push(w.document);
        }
      } catch (_) {}
      try {
        if (w.frames && w.frames.length > 0) {
          for (let i = 0; i < w.frames.length; i++) {
            try { collect(w.frames[i]); } catch (_) {}
          }
        }
      } catch (_) {}
    }
    try {
      const topWin = window.top || window;
      collect(topWin);
    } catch (_) {
      collect(window);
    }
    if (!docs.includes(document)) docs.push(document);
    return docs;
  }

  function dispatchClick(el) {
    if (!el) return;
    try { el.focus(); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window })); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window })); } catch (_) {}
    try { el.click(); } catch (_) {}
  }

  // REFRESH 100% SESUAI ALUR SERVICENOW:
  // - All Request: Klik menu "Request Management" di bar samping, lalu klik "All Request" di bawahnya.
  // - All Incident: Klik menu "Incident Management" di bar samping, lalu klik "All Incident" di bawahnya.
  // - DILARANG KERAS menggunakan location.reload() agar tab tidak kembali ke default!
  function clickServiceNowSubmenu(targetType) {
    const isIncident = (targetType === "incident");
    const parentKeywords = isIncident
      ? ["incident management", "manajemen insiden", "incident mgmt", "incident", "insiden", "gangguan"]
      : ["request management", "manajemen request", "manajemen permohonan", "request mgmt", "service catalog", "katalog layanan", "permohonan", "request"];
    const subKeywords = isIncident
      ? ["all incident", "all incidents", "semua insiden", "daftar insiden", "incidents", "all"]
      : ["all request", "all requests", "semua permohonan", "semua request", "daftar permohonan", "requests", "all"];
    const hrefKeywords = isIncident
      ? ["incident_list.do", "incident.do", "table=incident"]
      : ["sc_req_item_list.do", "sc_request_list.do", "sc_task_list.do", "table=sc_req_item"];

    const labelParent = isIncident ? "Incident Management" : "Request Management";
    const labelSub = isIncident ? "All Incident" : "All Request";

    console.log(`[GC 1 Sentinel] Memulai alur refresh tanpa reload: ${labelParent} -> ${labelSub}...`);
    showReloadToast(`Menyegarkan: ${labelParent} → ${labelSub}...`);

    const docs = getAccessibleDocs();

    for (const doc of docs) {
      try {
        const allElements = Array.from(doc.querySelectorAll("a, button, li, div, span, [role='treeitem'], [role='menuitem'], .nav-item, .module-link, .sn-widget-list-item, .navpage-nav-app, .app-node"));

        // 1. Cari elemen menu utama di bar samping (Request Management / Incident Management)
        let parentEl = null;
        for (const el of allElements) {
          const txt = (el.textContent || "").trim().toLowerCase();
          const title = (el.getAttribute("title") || "").toLowerCase();
          const aria = (el.getAttribute("aria-label") || "").toLowerCase();
          if (parentKeywords.some((kw) => txt === kw || txt.startsWith(kw) || title === kw || aria === kw || (txt.includes(kw) && txt.length < kw.length + 25))) {
            parentEl = el;
            break;
          }
        }

        // 2. Cari elemen submenu di bar samping (All Request / All Incident)
        let subEl = null;
        for (const el of allElements) {
          const txt = (el.textContent || "").trim().toLowerCase();
          const title = (el.getAttribute("title") || "").toLowerCase();
          const aria = (el.getAttribute("aria-label") || "").toLowerCase();
          const href = (el.getAttribute("href") || "").toLowerCase();
          const dataUrl = (el.getAttribute("data-url") || "").toLowerCase();

          const textMatch = subKeywords.some((kw) => txt === kw || (txt.startsWith(kw) && txt.length < kw.length + 20) || title === kw || aria === kw);
          const hrefMatch = hrefKeywords.some((kw) => href.includes(kw) || dataUrl.includes(kw));

          if (hrefMatch || textMatch) {
            subEl = el;
            if (parentEl && (parentEl.contains(el) || (el.compareDocumentPosition(parentEl) & Node.DOCUMENT_POSITION_PRECEDING))) {
              break;
            }
          }
        }

        // Langkah 1: Klik Menu Utama di bar samping
        if (parentEl) {
          console.log(`[GC 1 Sentinel] [Langkah 1/2] Klik menu samping: "${labelParent}"`);
          dispatchClick(parentEl);

          // Langkah 2: Klik Submenu di bawahnya setelah jeda singkat (agar accordion membuka)
          setTimeout(() => {
            if (subEl) {
              console.log(`[GC 1 Sentinel] [Langkah 2/2] Klik submenu di bawahnya: "${labelSub}"`);
              dispatchClick(subEl);
            } else {
              // Cari ulang submenu yang baru muncul setelah menu utama dibuka
              const freshSub = Array.from(doc.querySelectorAll("a, button, li, div, [role='treeitem'], [role='menuitem']")).find((el) => {
                const txt = (el.textContent || "").trim().toLowerCase();
                const href = (el.getAttribute("href") || "").toLowerCase();
                const dataUrl = (el.getAttribute("data-url") || "").toLowerCase();
                return hrefKeywords.some((kw) => href.includes(kw) || dataUrl.includes(kw)) ||
                       subKeywords.some((kw) => txt === kw || txt.startsWith(kw));
              });
              if (freshSub) {
                console.log(`[GC 1 Sentinel] [Langkah 2/2] Klik submenu setelah dropdown terbuka: "${labelSub}"`);
                dispatchClick(freshSub);
              }
            }
          }, 250);
          return true;
        } else if (subEl) {
          // Jika menu utama sudah terbuka sebelumnya atau link modul langsung tersedia
          console.log(`[GC 1 Sentinel] Klik submenu langsung: "${labelSub}"`);
          dispatchClick(subEl);
          return true;
        }
      } catch (err) {
        console.warn("[GC 1 Sentinel] Error saat navigasi menu bar samping:", err);
      }
    }

    // Fallback 1: Cari frame utama gsft_main dan panggil g_list.refresh(1)
    for (const doc of docs) {
      try {
        const win = doc.defaultView;
        if (win && typeof win.g_list !== "undefined" && typeof win.g_list.refresh === "function") {
          console.log("[GC 1 Sentinel] Menggunakan ServiceNow in-frame g_list.refresh(1) (tanpa reload browser)");
          win.g_list.refresh(1);
          return true;
        }
      } catch (_) {}
    }

    // Fallback 2: Tombol refresh di header daftar tabel ServiceNow
    for (const doc of docs) {
      try {
        const snRefreshBtn = doc.querySelector("button[name='refresh'], button[title*='Refresh'], button[aria-label*='Refresh'], .list_nav_refresh, .table-refresh-btn, button#sn_header_refresh");
        if (snRefreshBtn) {
          console.log("[GC 1 Sentinel] Mengklik tombol refresh tabel ServiceNow...");
          snRefreshBtn.click();
          return true;
        }
      } catch (_) {}
    }

    // CATATAN KETAT: JANGAN PERNAH gunakan location.reload()!
    console.log("[GC 1 Sentinel] Selesai alur refresh tanpa reload (tidak mereload halaman browser).");
    return false;
  }

  function deduplicateRepeatedText(str) {
    if (!str) return "";
    const s = String(str).replace(/\s+/g, " ").trim();
    const words = s.split(" ");
    const nw = words.length;
    if (nw >= 2 && nw % 2 === 0) {
      const half = nw / 2;
      const firstHalf = words.slice(0, half).join(" ").toLowerCase();
      const secondHalf = words.slice(half).join(" ").toLowerCase();
      if (firstHalf === secondHalf) {
        return words.slice(0, half).join(" ");
      }
    }
    const n = s.length;
    if (n >= 4 && n % 2 === 1) {
      const half = Math.floor(n / 2);
      if (s[half] === " " && s.slice(0, half).trim().toLowerCase() === s.slice(half + 1).trim().toLowerCase()) {
        return s.slice(0, half).trim();
      }
    }
    return s;
  }

  function triggerSubmenuReload(forcedType) {
    const subInfo = detectSubmenuInfo();
    let targetType = subInfo.key;

    // Jika forcedType spesifik ('request' atau 'incident') diberikan:
    // Pastikan tab ini tidak dialihkan secara keliru jika tab ini adalah jenis yang berlawanan!
    if (forcedType && forcedType !== "active" && forcedType !== "all") {
      const cleanForced = (forcedType === "incident" || forcedType.includes("inc")) ? "incident" : "request";
      if (subInfo.key && subInfo.key !== cleanForced) {
        console.log(`[GC 1 Sentinel] Permintaan reload '${forcedType}' dilewati pada tab '${subInfo.key}' agar peran tab tidak tertukar.`);
        return false;
      }
      targetType = cleanForced;
    }

    return clickServiceNowSubmenu(targetType);
  }

  function setupAutoReload() {
    const intervalSec = parseInt(settings.autoRefreshHelpdeskSeconds || 60, 10);
    if (!intervalSec || intervalSec <= 0) return;

    setInterval(() => {
      try {
        const url = (location.href || "").toLowerCase();
        const isHelpdeskUrl = settings.helpdeskUrlPatterns.some((p) => url.includes(p.toLowerCase()));
        if (!isHelpdeskUrl) return;

        // Jangan refresh jika operator sedang aktif berinteraksi dalam 20 detik terakhir
        if (Date.now() - lastUserActivity < 20000) return;

        // Jangan refresh jika operator sedang fokus pada kolom input teks atau textarea
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) return;

        triggerSubmenuReload();
      } catch (_) {}
    }, intervalSec * 1000);
  }

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

    // Fallback: Kirim langsung via HTTP POST ke Server Sentinel lokal
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

      runPassiveScan();
      setupPassiveObserver();
      setupAutoReload();
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

  function detectSubmenuInfo(tickets) {
    // 0. Cek session storage tab ini jika sebelumnya sudah tersimpan perannya
    let savedRole = "";
    try {
      savedRole = sessionStorage.getItem("gc1_itsm_tab_role") || "";
    } catch (_) {}

    const url = (location.href || "").toLowerCase();
    const title = (document.title || "").toLowerCase();
    const pageHeading = (document.querySelector("h1, h2, .navbar-title, .title, .breadcrumb, [class*='title']")?.textContent || "").toLowerCase();
    const fullHeader = `${title} ${pageHeading}`;

    // Periksa juga URL iframe gsft_main jika berada di frame induk
    let frameUrl = "";
    try {
      const mainFrame = document.querySelector("iframe#gsft_main, iframe[name='gsft_main'], iframe");
      if (mainFrame && mainFrame.contentWindow) {
        frameUrl = (mainFrame.contentWindow.location.href || "").toLowerCase();
      }
    } catch (_) {}

    const combinedUrl = `${url} ${frameUrl}`;

    // 1. Deteksi dari Judul Halaman / Banner ("Show All Incident" vs "Show All Request") & URL
    if (fullHeader.includes("incident") || combinedUrl.includes("incident") || fullHeader.includes("insiden") || combinedUrl.includes("insiden") || fullHeader.includes("gangguan") || combinedUrl.includes("gangguan")) {
      try { sessionStorage.setItem("gc1_itsm_tab_role", "incident"); } catch (_) {}
      return { key: "incident", label: "Tiket Insiden", type: "Insiden" };
    }
    if (fullHeader.includes("request") || combinedUrl.includes("request") || fullHeader.includes("permohonan") || combinedUrl.includes("permohonan") || combinedUrl.includes("sc_req_item") || combinedUrl.includes("sc_task") || combinedUrl.includes("sc_request")) {
      try { sessionStorage.setItem("gc1_itsm_tab_role", "request"); } catch (_) {}
      return { key: "request", label: "Tiket Request", type: "Request" };
    }

    // 2. Deteksi dari dominasi prefix nomor tiket hasil scan
    let incCount = 0;
    let reqCount = 0;
    for (const t of (tickets || [])) {
      const tid = String(t.ticketId || "").toUpperCase();
      if (tid.startsWith("INC")) incCount++;
      else if (tid.startsWith("REQ") || tid.startsWith("RITM")) reqCount++;
    }
    if (incCount > reqCount && incCount > 0) {
      try { sessionStorage.setItem("gc1_itsm_tab_role", "incident"); } catch (_) {}
      return { key: "incident", label: "Tiket Insiden", type: "Insiden" };
    }
    if (reqCount >= incCount && reqCount > 0) {
      try { sessionStorage.setItem("gc1_itsm_tab_role", "request"); } catch (_) {}
      return { key: "request", label: "Tiket Request", type: "Request" };
    }

    // 3. Fallback ke savedRole di session storage tab ini
    if (savedRole === "incident") {
      return { key: "incident", label: "Tiket Insiden", type: "Insiden" };
    }
    if (savedRole === "request") {
      return { key: "request", label: "Tiket Request", type: "Request" };
    }

    return { key: "request", label: "Tiket Request", type: "Request" };
  }

  function detectTicketServiceType(ticketId, shortDesc, defaultType) {
    const tid = String(ticketId || "").toUpperCase().trim();
    if (tid.startsWith("INC")) return "Insiden";
    if (tid.startsWith("REQ") || tid.startsWith("RITM")) return "Request";
    const desc = String(shortDesc || "").toLowerCase();
    const incWords = ["down", "mati", "error", "gangguan", "rusak", "unreachable", "crash", "putus", "darurat", "critical", "masalah", "kendala", "latensi", "lambat", "gagal", "skm", "problem", "waf block", "terblokir", "padam"];
    if (incWords.some((w) => desc.includes(w))) return "Insiden";
    return defaultType || "Request";
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
      let candidateRows = Array.from(tableEl.querySelectorAll("thead tr, tr"));
      // Jika header tidak ada di dalam table ini (seperti pada ZK Listbox/Grid), cari container header di atasnya
      if (!candidateRows.some(r => r.querySelector("th, .z-listheader, .z-column"))) {
        const zkBox = tableEl.closest ? tableEl.closest(".z-listbox, .z-grid, .z-div") : null;
        if (zkBox) {
          const headerContainer = zkBox.querySelector(".z-listbox-header, .z-grid-header, thead");
          if (headerContainer) {
            candidateRows = Array.from(headerContainer.querySelectorAll("tr, .z-listhead, .z-columns"));
          }
        } else if (tableEl.previousElementSibling) {
          candidateRows = Array.from(tableEl.previousElementSibling.querySelectorAll("tr, thead tr"));
        }
      }

      for (const row of candidateRows) {
        const headers = Array.from(row.querySelectorAll("th, td, .z-listheader, .z-column, .z-listheader-content, .z-column-content")).map((th) => (th.textContent || "").trim().toLowerCase());
        const numIdx = headers.findIndex((h) => h.includes("number") || h.includes("nomor") || h.includes("ticket") || h.includes("tiket") || h.includes("no.") || h.includes("id tiket") || h.includes("no tiket"));
        if (numIdx !== -1) {
          return {
            headerRow: row,
            numberIdx: numIdx,
            descIdx: headers.findIndex((h) => h.includes("short description") || h.includes("description") || h.includes("deskripsi") || h.includes("uraian") || h.includes("judul") || h.includes("subject") || h.includes("perihal") || h.includes("keluhan")),
            requestedForIdx: headers.findIndex((h) => h.includes("requested for") || h.includes("pemohon") || h.includes("caller") || h.includes("pelapor") || h.includes("nama") || h.includes("user")),
            stateIdx: headers.findIndex((h) => h.includes("request state") || h.includes("incident state") || h.includes("state") || h.includes("status") || h.includes("kondisi") || h.includes("tahap")),
            dateIdx: headers.findIndex((h) => h.includes("created date") || h.includes("created") || h.includes("date") || h.includes("tanggal") || h.includes("waktu") || h.includes("tgl")),
            locationIdx: headers.findIndex((h) => h.includes("location") || h.includes("lokasi") || h.includes("instansi") || h.includes("kementerian") || h.includes("lembaga")),
            groupIdx: headers.findIndex((h) => h.includes("assignment group") || h.includes("assigment group") || h.includes("group") || h.includes("grup") || h.includes("unit") || h.includes("tim"))
          };
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  // Format nomor tiket resmi ServiceNow / Helpdesk Komdigi / ESTIM
  function isLikelyTicketId(id) {
    if (!id) return false;
    const s = String(id).trim();
    if (s.length < 3 || s.length > 50) return false;
    if (/\s/.test(s)) return false;
    // Wajib memiliki minimal satu digit angka (menghindari kata bahasa Inggris seperti 'require', 'including', dll)
    if (!/\d/.test(s)) return false;
    const lower = s.toLowerCase();
    if (["request", "incident", "requesttask", "task", "ticket", "permohonan", "gangguan", "require", "including", "requested", "incoming", "income"].includes(lower)) return false;
    const bad = ["homepage", "management", "reporting", "enablement", "assessment", "platform", "setting", "knowledge", "delete", "filter", "search", "logout", "login"];
    if (bad.some((b) => lower.includes(b))) return false;
    return true;
  }

  function collectTablesFromDoc(d) {
    const list = [];
    try {
      if (!d) return list;
      d.querySelectorAll("table, .z-listbox, .z-grid, .z-listbox-body, .z-grid-body").forEach((t) => list.push(t));
      d.querySelectorAll("iframe, frame").forEach((f) => {
        try {
          const cd = f.contentDocument || f.contentWindow?.document;
          if (cd) list.push(...collectTablesFromDoc(cd));
        } catch (_) {}
      });
    } catch (_) {}
    return list;
  }

  function extractPaginationInfo(d) {
    try {
      if (!d) return null;
      const candidates = d.querySelectorAll(".list_nav_total_records, .list_row_number_input, span[id*='total_rows'], td.list_nav_bottom, .vcr_counter, .list_nav_records, .list_nav_text, .z-paging-info");
      for (const el of candidates) {
        const txt = (el.textContent || "").trim();
        const m = txt.match(/(\d+)\s*(?:to|-)\s*(\d+)\s*(?:of|dari|\/)\s*(\d+)/i);
        if (m) {
          return {
            first: parseInt(m[1], 10),
            last: parseInt(m[2], 10),
            total: parseInt(m[3], 10),
            text: txt
          };
        }
      }
    } catch (_) {}
    return null;
  }

  async function runPassiveScan() {
    try {
      const knownRegistry = getKnownTicketRegistry();
      let registryModified = false;
      // Lewati (skip) jika berada di menu My Approval History / My Approvals
      const curUrl = (location.href || "").toLowerCase();
      const curTitle = (document.title || "").toLowerCase();
      const curHeading = (document.querySelector("h1, h2, .navbar-title, .title, .breadcrumb, [class*='title']")?.textContent || "").toLowerCase();
      if (curUrl.includes("approval") || curTitle.includes("approval") || curHeading.includes("approval")) {
        return;
      }

      const tables = collectTablesFromDoc(document);
      if (!tables || tables.length === 0) return;

      const scannedTickets = [];
      const seenTicketIds = new Set();
      // Format tiket ServiceNow + ESTIM Kominfo / PDN
      const ticketRegex = /\b(REQ|INC|RITM|TASK|TKT|CHG|PRB|SCTASK|PDN|KMF|KOM|SR|WO|ESTIM|SD|TIK|IN|TK)[-_/]?[A-Za-z0-9-_./]*\d+[A-Za-z0-9-_./]*/i;

      tables.forEach((table) => {
        if (table.id === "sentinelTable" || table.classList.contains("sentinel-table") || table.closest(".dashboard-main")) {
          return;
        }
        const colIdx = getColumnIndexes(table);

        const rows = table.querySelectorAll("tbody tr, tr.z-listitem, tr.z-row, .z-listitem, .z-row, tr, [role='row']");
        rows.forEach((row) => {
          if (row.querySelector("th, .z-listheader, .z-column") && !colIdx) return;

          let cells = Array.from(row.querySelectorAll("td, .z-listcell, .z-row-inner, .z-cell, [role='gridcell']"));
          if (!cells || cells.length === 0) {
            cells = Array.from(row.children).filter(c => !c.classList?.contains("z-listheader") && !c.tagName?.toLowerCase().includes("th"));
          }
          if (!cells || cells.length === 0) return;

          let ticketNumber = "";
          let foundCellIdx = -1;

          // 1. Ekstraksi via indeks kolom Number jika berhasil dideteksi
          if (colIdx && colIdx.numberIdx !== -1 && cells[colIdx.numberIdx]) {
            const rawCell = cells[colIdx.numberIdx].textContent.trim();
            const m = rawCell.match(ticketRegex);
            if (m) {
              ticketNumber = m[0].trim();
              foundCellIdx = colIdx.numberIdx;
            } else if (isLikelyTicketId(rawCell)) {
              ticketNumber = rawCell;
              foundCellIdx = colIdx.numberIdx;
            }
          }

          // 2. Fallback: pindai seluruh sel di baris untuk mencari format nomor tiket sah
          if (!ticketNumber) {
            for (let ci = 0; ci < cells.length; ci++) {
              const m = cells[ci].textContent.match(ticketRegex);
              if (m) {
                ticketNumber = m[0].trim();
                foundCellIdx = ci;
                break;
              }
            }
          }

          // Validasi tiket
          if (!ticketNumber || !isLikelyTicketId(ticketNumber) || seenTicketIds.has(ticketNumber)) {
            return;
          }
          seenTicketIds.add(ticketNumber);

          let shortDesc = "";
          let requestedFor = "";
          let requestState = "";
          let createdDate = "";
          let locationName = "";
          let assignmentGroup = "";

          if (colIdx && colIdx.descIdx !== -1 && cells[colIdx.descIdx]) {
            shortDesc = cells[colIdx.descIdx].textContent.trim();
            requestedFor = (colIdx.requestedForIdx !== -1 && cells[colIdx.requestedForIdx]) ? cells[colIdx.requestedForIdx].textContent.trim() : "";
            requestState = (colIdx.stateIdx !== -1 && cells[colIdx.stateIdx]) ? cells[colIdx.stateIdx].textContent.trim() : "";
            createdDate = (colIdx.dateIdx !== -1 && cells[colIdx.dateIdx]) ? cells[colIdx.dateIdx].textContent.trim() : "";
            locationName = (colIdx.locationIdx !== -1 && cells[colIdx.locationIdx]) ? cells[colIdx.locationIdx].textContent.trim() : "";
            assignmentGroup = (colIdx.groupIdx !== -1 && cells[colIdx.groupIdx]) ? cells[colIdx.groupIdx].textContent.trim() : "";
          } else {
            // Relative offset berdasarkan urutan kolom standar
            shortDesc = cells[foundCellIdx + 1]?.textContent.trim() || "";
            requestedFor = cells[foundCellIdx + 2]?.textContent.trim() || "";
            requestState = cells[foundCellIdx + 3]?.textContent.trim() || "";
            createdDate = cells[foundCellIdx + 4]?.textContent.trim() || "";
            locationName = cells[foundCellIdx + 5]?.textContent.trim() || "";
            assignmentGroup = cells[foundCellIdx + 6]?.textContent.trim() || "";
          }

          const KNOWN_STATES_RE = /^(closed|resolved|in progress|on hold|completed|assigned|canceled|cancelled|open|pending|baru|rejected|ditugaskan|diproses|menunggu|selesai)$/i;
          if (KNOWN_STATES_RE.test(shortDesc.trim()) && !KNOWN_STATES_RE.test(requestState.trim())) {
            requestState = shortDesc.trim();
            shortDesc = requestedFor || "";
          }

          shortDesc = shortDesc.replace(/\s+/g, " ").trim();
          requestedFor = deduplicateRepeatedText(requestedFor.split("\n")[0].replace(/[📍📲📋]/g, "").replace(/\s+/g, " ").trim());
          requestState = requestState.replace(/[●•\r\n\t]/g, "").replace(/\s+/g, " ").trim();
          createdDate = createdDate.replace(/\s+/g, " ").trim();
          locationName = deduplicateRepeatedText(locationName.split("\n")[0].replace(/[📍📲📋]/g, "").replace(/\s+/g, " ").trim());
          assignmentGroup = assignmentGroup.split("\n")[0].replace(/[📍📲📋]/g, "").replace(/\s+/g, " ").trim();

          const fullRowText = `${ticketNumber} ${shortDesc} ${requestedFor} ${requestState} ${createdDate} ${locationName} ${assignmentGroup}`;
          const matchedKw = checkKeywordMatch(fullRowText);
          // Portal pdn.layanan.go.id secara inheren adalah ruang lingkup PDN / Government Cloud
          const isPdnsPortal = location.hostname.includes("layanan.go.id") || location.hostname.includes("kominfo.go.id") || location.hostname.includes("komdigi.go.id");
          const isGc1 = Boolean(matchedKw) || isPdnsPortal;

          const isTelkom = assignmentGroup.toLowerCase().includes("telkom");

          // Lewati tiket Pending Approval karena sudah diurusi oleh aplikasi approval lain
          if (/pending[\s-]*approval|menunggu[\s-]*approval|menunggu[\s-]*persetujuan/i.test(requestState)) {
            return;
          }

          // Universal state matching (Bahasa Indonesia & English)
          const isOnHold = /on[\s-]*hold|hold|tertunda|tunda/i.test(requestState);
          const isInProgress = /progress|diproses|sedang diproses|penanganan|analisis|berjalan/i.test(requestState);
          const isAssigned = !isOnHold && !isInProgress && /^\s*(assigned|ditugaskan)\s*$/i.test(requestState.trim());

          let category = "all_tickets";
          if (isAssigned) category = "team_assigned";
          else if (isOnHold) category = "team_on_hold";
          else if (isInProgress) category = "team_progress";
          else category = "all_tickets";

          let resolverLayer = "Helpdesk (L0)";
          if (isTelkom) resolverLayer = "Telkom (Eksternal)";
          else if (assignmentGroup.toLowerCase().includes("eos l1")) resolverLayer = "EOS L1";
          else if (assignmentGroup.toLowerCase().includes("eos l2")) resolverLayer = "EOS L2 (Engineer)";
          else if (assignmentGroup.toLowerCase().includes("eos l3")) resolverLayer = "EOS L3 (Expert)";
          else if (assignmentGroup.toLowerCase().includes("noc")) resolverLayer = "NOC";
          else if (assignmentGroup.toLowerCase().includes("soc")) resolverLayer = "SOC";

          const serviceType = detectTicketServiceType(ticketNumber, shortDesc, ticketNumber.toUpperCase().startsWith("INC") ? "Insiden" : "Request");

          // SEMUA tiket dicatat dan disinkronkan ke GC 1 Sentinel
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
            serviceType: serviceType,
            matchedKeyword: matchedKw || (isTelkom ? "TELKOM" : "Tim Internal")
          });

          // Notifikasi alert instan hanya untuk tiket baru yang berstatus Assigned / Baru / Open
          if (isTelkom || !isAssigned) return;

          const prevEntry = knownRegistry[ticketNumber];
          if (prevEntry && prevEntry.reportedState === "Assigned") {
            return;
          }

          const updateType = prevEntry ? "UPDATE_STATUS_TO_ASSIGNED" : "NEW_TICKET_ASSIGNED";
          knownRegistry[ticketNumber] = {
            state: "Assigned",
            reportedState: "Assigned",
            lastSeen: Date.now(),
            reportedAt: Date.now()
          };
          registryModified = true;

          console.log(`[GC 1 Sentinel Expert] 🚨 ${updateType}: ${ticketNumber} - ${shortDesc}`);
          playTicketIncomingAudio();

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
        const subInfo = detectSubmenuInfo(scannedTickets);
        scannedTickets.forEach((t) => {
          if (!t.serviceType) {
            t.serviceType = detectTicketServiceType(t.ticketId, t.shortDesc, subInfo.type);
          }
        });

        const paginationInfo = extractPaginationInfo(document);
        const syncPayload = {
          tickets: scannedTickets,
          list: {
            key: subInfo.key,
            label: subInfo.label,
            title: document.title,
            path: location.pathname,
            pagination: paginationInfo
          }
        };

        // 1. Kirim via background script (Bebas dari batasan CORS / HTTPS mixed-content)
        if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
          try {
            chrome.runtime.sendMessage({
              type: "SYNC_HELPDESK_TICKETS",
              tickets: scannedTickets,
              list: syncPayload.list
            }, () => {
              void chrome.runtime.lastError;
            });
          } catch (_) {}
        }

        // 2. Kirim via BroadcastChannel
        try {
          const bus = new BroadcastChannel("gc1_sentinel_bus");
          bus.postMessage({
            type: "SYNC_HELPDESK_TICKETS",
            tickets: scannedTickets,
            count: scannedTickets.length,
            pagination: paginationInfo,
            timestamp: Date.now()
          });
        } catch (_) {}

        // 3. Fallback direct HTTP fetch
        try {
          fetch("http://127.0.0.1:8765/api/sync_helpdesk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(syncPayload)
          }).catch(() => {});
        } catch (_) {}
      }

      if (registryModified) {
        saveKnownTicketRegistry(knownRegistry);
      }
    } catch (_) {}
  }

  function setupPassiveObserver() {
    try {
      const target = document.documentElement || document.body;
      if (!target) return;
      let scanTimeout = null;
      const observer = new MutationObserver(() => {
        if (scanTimeout) clearTimeout(scanTimeout);
        scanTimeout = setTimeout(() => {
          runPassiveScan();
        }, 800);
      });

      observer.observe(target, {
        childList: true,
        subtree: true
      });

      // Pindai ketika operator menggulir halaman (scroll ke bawah)
      window.addEventListener("scroll", () => {
        if (scanTimeout) clearTimeout(scanTimeout);
        scanTimeout = setTimeout(() => {
          runPassiveScan();
        }, 500);
      }, { passive: true });

      // Pindai berkala setiap 5 detik agar data selalu terkini
      setInterval(runPassiveScan, 5000);
    } catch (_) {}
  }

  // Dengarkan sinyal reload dari Dashboard atau background worker
  try {
    const bus = new BroadcastChannel("gc1_sentinel_bus");
    bus.addEventListener("message", (evt) => {
      if (evt.data && (evt.data.type === "RELOAD_ITSM_SUBMENU" || evt.data.type === "RELOAD_ITSM")) {
        triggerSubmenuReload(evt.data.menu);
      }
    });
  } catch (_) {}

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    try {
      chrome.runtime.onMessage.addListener((msg, sender, sendResp) => {
        if (msg && (msg.type === "RELOAD_ITSM_SUBMENU" || msg.type === "RELOAD_ITSM")) {
          triggerSubmenuReload(msg.menu);
          if (sendResp) sendResp({ status: "triggered" });
        }
      });
    } catch (_) {}
  }

  // Mencegah F5 / Ctrl+R mereload halaman browser secara tidak sengaja
  // Alihkan F5 menjadi klik native submenu ServiceNow sesuai peran tab
  window.addEventListener("keydown", (e) => {
    if (e.key === "F5" || (e.ctrlKey && (e.key === "r" || e.key === "R"))) {
      const subInfo = detectSubmenuInfo();
      if (subInfo.key === "request" || subInfo.key === "incident") {
        e.preventDefault();
        e.stopPropagation();
        console.log(`[GC 1 Sentinel] F5/Ctrl+R dicegah. Mengalihkan ke refresh native ServiceNow submenu: ${subInfo.label}...`);
        showReloadToast(`Mencegah reload browser! Menyegarkan via menu ${subInfo.label}...`);
        triggerSubmenuReload(subInfo.key);
        return false;
      }
    }
  }, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadSettings);
  } else {
    loadSettings();
  }
})();
