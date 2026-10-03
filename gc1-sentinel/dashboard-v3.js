/**
 * GC 1 Sentinel - lapisan tampilan v3 (dimuat setelah dashboard.js dan charts.js)
 * - Sidebar yang bisa diciutkan, submenu "Monitoring per sumber" (ITSM / WhatsApp)
 * - Ringkasan satu grafik untuk semua sumber, lalu grafik per sumber
 * - Input Cepat: NLP aturan (instan) + AI lokal (latar belakang, opsional) untuk aduan WhatsApp
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const C = window.GC1Charts;
  const esc = C.esc;
  const VIEWS = {
    overview: { title: "Ringkasan Operasional", crumb: "Kementerian Komunikasi dan Digital · Pusat Data Nasional" },
    itsm: { title: "Tiket ITSM", crumb: "Monitoring · tiket resmi di portal ITSM" },
    wa: { title: "Pra-tiket WhatsApp", crumb: "Monitoring · aduan WhatsApp sebelum ada tiket di ITSM" },
    quick: { title: "Input Cepat", crumb: "Input · aduan WhatsApp dengan NLP" },
    manual: { title: "Rekam Tiket Manual", crumb: "Input · Tiket Terlewat & Data Historis" }
  };
  const V3 = {
    view: "overview",
    range: "day",
    stats: null,
    lastStats: 0,
    itsmList: null,
    lists: [
      { key: "request", label: "Tiket Request", icon: "📋" },
      { key: "incident", label: "Tiket Insiden", icon: "⚡" }
    ]
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  };
  const num = (v) => (v === null || v === undefined ? "-" : v);
  const getState = () => (typeof state !== "undefined" ? state : (window.state || { role: "operator", activeTab: "all_tickets", snapshot: {} }));

  // ------------------------------------------------------------------ sidebar
  const shell = $("appShell");
  function setSidebarMin(min) {
    shell.classList.toggle("sb-min", min);
    $("sbToggle").innerHTML = min ? "&raquo;" : "&laquo;";
    store.set("gc1_sb_min", min ? "1" : "0");
  }
  $("sbToggle").addEventListener("click", () => setSidebarMin(!shell.classList.contains("sb-min")));
  $("sbMonitorToggle").addEventListener("click", () => {
    const g = $("sbMonitor");
    g.classList.toggle("open");
    $("sbMonitorToggle").setAttribute("aria-expanded", g.classList.contains("open"));
    store.set("gc1_sb_monitor", g.classList.contains("open") ? "1" : "0");
  });
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-view]");
    if (nav && nav.tagName === "BUTTON") showView(nav.dataset.view, nav.dataset.list || null);
  });

  // ---- V3 SVG Icon Library (Enterprise Feather Icons)
  const V3_ICONS = {
    total: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`,
    request: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
    incident: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
    assigned: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect><path d="M12 11h4"></path><path d="M12 16h4"></path><path d="M8 11h.01"></path><path d="M8 16h.01"></path></svg>`,
    pending: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
    progress: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>`,
    onhold: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="10" y1="15" x2="10" y2="9"></line><line x1="14" y1="15" x2="14" y2="9"></line></svg>`,
    sla: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><polyline points="9 12 11 14 15 10"></polyline></svg>`,
    wa: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>`,
    arrowRight: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`
  };

  // ---- submenu ITSM: menu tetap profesional (Semua, Request, Insiden)
  function renderItsmMenu() {
    const box = $("sbItsmItems");
    if (!box) return;
    const items = [
      { key: "", label: "ITSM · Semua", icon: V3_ICONS.total, title: "Semua Tiket ITSM" },
      { key: "request", label: "Tiket Request", icon: V3_ICONS.request, title: "Daftar Tiket Request (Permohonan)" },
      { key: "incident", label: "Tiket Insiden", icon: V3_ICONS.incident, title: "Daftar Tiket Insiden (Gangguan)" }
    ];
    box.innerHTML = items.map((l) => `<button class="sb-item" data-view="itsm" data-list="${esc(l.key)}" title="${esc(l.title)}"><span class="ic">${l.icon}</span><span class="tx">${esc(l.label)}</span><span class="sb-pill" data-pill-list="${esc(l.key)}">0</span></button>`).join("");
    markActive();
  }
  function markActive() {
    document.querySelectorAll(".sb-item[data-view]").forEach((b) => {
      const on = b.dataset.view === V3.view && (b.dataset.view !== "itsm" || (b.dataset.list || "") === (V3.itsmList || ""));
      b.classList.toggle("active", on);
    });
  }
  function listLabel(key) {
    if (key === "request") return "Tiket Request";
    if (key === "incident" || key === "assign") return "Tiket Insiden";
    return "Semua";
  }
  function setLists(arr) {
    // Menu ITSM dibakukan secara profesional (ITSM · Semua, Tiket Request, Tiket Insiden)
    // agar tidak pernah ada duplikasi menu atau terpotong teksnya.
    markActive();
  }

  // ------------------------------------------------------------------ tampilan
  function showView(v, list) {
    if (!VIEWS[v]) v = "overview";
    if (v === "itsm") V3.itsmList = list || null;
    const st = getState();
    if (v === "quick" && st.role === "team") v = "overview";
    V3.view = v;
    document.querySelectorAll(".v3-view").forEach((s) => { s.hidden = s.id !== "view-" + v; });
    markActive();
    const itsmName = V3.itsmList ? `Tiket ITSM · ${listLabel(V3.itsmList)}` : "Tiket ITSM · Semua";
    $("v3Title").textContent = v === "itsm" ? itsmName : VIEWS[v].title;
    $("v3Crumb").textContent = v === "itsm" ? "Monitoring · menu " + (V3.itsmList ? listLabel(V3.itsmList) : "ITSM (semua daftar)") : VIEWS[v].crumb;
    if (v === "itsm") {
      if ($("itsmHeading")) $("itsmHeading").textContent = itsmName;
      if ($("itsmDesc")) $("itsmDesc").textContent = V3.itsmList ? `Tiket yang tampil di menu "${listLabel(V3.itsmList)}" pada aplikasi ITSM. SLA resmi (KAK 18.c) berjalan pada tiket ini.` : "Gabungan semua menu ITSM (satu tiket dihitung sekali walau muncul di beberapa menu).";
    }
    const tb = $("tableBlock");
    if (v === "itsm" || v === "wa" || v === "overview") {
      const targetSlot = v === "itsm" ? $("slotItsm") : (v === "wa" ? $("slotWa") : $("slotOverview"));
      if (targetSlot) targetSlot.appendChild(tb);
      tb.hidden = false;
      tb.dataset.view = v;
      const valid = v === "wa" ? ["all_tickets", "wa_alerts"] : ["all_tickets", "team_assigned", "team_pending", "team_progress"];
      const allLabel = $("tabBtnAll") && $("tabBtnAll").querySelector(".tab-text");
      if (allLabel) allLabel.textContent = v === "itsm" ? "Semua Tiket ITSM" : (v === "wa" ? "Semua Pra-tiket WhatsApp" : "Semua Tiket Terpantau");
      const waLabel = $("tabBtnWa") && $("tabBtnWa").querySelector(".tab-text");
      if (waLabel) waLabel.textContent = "Feed Pesan WhatsApp";
      const curTab = st.activeTab || "all_tickets";
      if (!valid.includes(curTab)) switchTab("all_tickets");
      else switchTab(curTab);
      if (v === "wa" && curTab === "all_tickets") {
        if ($("currentCategoryTitle")) $("currentCategoryTitle").innerHTML = "<span>💬</span> Pra-tiket WhatsApp";
        if ($("currentCategoryDesc")) $("currentCategoryDesc").textContent = "Aduan dari grup WhatsApp. SLA resmi baru berjalan setelah tiket dibuat di ITSM.";
      }
    } else {
      tb.hidden = true;
    }
    store.set("gc1_view", v);
    store.set("gc1_list", V3.itsmList || "");
    if (st.snapshot) onSnapshot(st.snapshot, true);
    loadStats(true);
    if (v === "quick") setTimeout(() => $("mwText") && $("mwText").focus(), 50);
    if (v === "manual") setTimeout(initManualView, 20);
    window.scrollTo({ top: 0 });
  }
  V3.showView = showView;
  V3.switchItsmSubmenu = (list) => showView("itsm", list);

  V3.filterBySource = function (list) {
    if (V3.view === "itsm") {
      return list.filter((t) => {
        if (t.isFromWa) return false;
        if (!V3.itsmList) return true;
        const lists = t.itsmLists || [];
        const tid = (t.ticketId || "").toUpperCase();
        const st = (t.serviceType || "").toLowerCase();
        if (V3.itsmList === "incident") {
          return lists.includes("incident") || lists.includes("assign") || tid.startsWith("INC") || st === "insiden" || st === "incident";
        }
        if (V3.itsmList === "request") {
          return lists.includes("request") || tid.startsWith("REQ") || tid.startsWith("RITM") || st === "request" || st === "service request";
        }
        return lists.includes(V3.itsmList);
      });
    }
    if (V3.view === "wa") return list.filter((t) => t.isFromWa);
    return list;
  };

  V3.updateBadges = function (s) {
    if (V3.view !== "itsm" && V3.view !== "wa") return false;
    const list = V3.filterBySource(s.all_tickets || []);
    const st = (t) => (t.requestState || "").toLowerCase();
    const set = (id, n) => { const el = $(id); if (el) el.textContent = n; };
    set("badgeGc1Assigned", list.filter((t) => st(t).includes("assign")).length);
    set("badgeGc1Pending", list.filter((t) => st(t).includes("pending")).length);
    set("badgeTeamProgress", list.filter((t) => st(t).includes("progress")).length);
    set("badgeWa", s.wa_count ?? 0);
    set("badgeAll", list.length);
    return true;
  };

  // ------------------------------------------------------------------ KPI (Enterprise Layout)
  function kpi(arg1, label, val, unit, sub, go, icon, badgeText, badgeCls, chipsHtml, footerText) {
    let opts = {};
    if (typeof arg1 === "object" && arg1 !== null) {
      opts = arg1;
    } else {
      opts = {
        cls: arg1,
        label: label,
        val: val,
        unit: unit,
        sub: sub,
        go: go,
        iconSvg: icon,
        badgeText: badgeText,
        badgeCls: badgeCls,
        visualHtml: chipsHtml,
        footerText: footerText
      };
    }

    const {
      cls = "",
      category = "",
      label: cardLabel = "",
      val: cardVal = 0,
      unit: cardUnit = "",
      sub: cardSub = "",
      go: cardGo = "",
      iconSvg = V3_ICONS.total,
      badgeText: cardBadgeText = "",
      badgeCls: cardBadgeCls = "",
      visualHtml = "",
      footerText: cardFooterText = "",
      isAssignedActive = false
    } = opts;

    const activeCls = isAssignedActive ? " is-assigned-active" : "";
    const goAttr = cardGo ? ` data-go="${esc(cardGo)}"` : "";
    const linkCls = cardGo ? " link" : "";

    return `<div class="v3-kpi ${cls}${linkCls}${activeCls}"${goAttr}>
      <div class="k-top">
        <div class="k-title-col">
          ${category ? `<span class="k-category">${esc(category)}</span>` : ""}
          <div class="k-label">${esc(cardLabel)}</div>
        </div>
        <div class="k-icon-box ${cardBadgeCls || ""}">${iconSvg}</div>
      </div>
      <div class="k-main">
        <div class="k-val-row">
          <div class="k-val-group">
            <span class="k-val">${esc(cardVal)}</span>
            ${cardUnit ? `<span class="k-unit">${esc(cardUnit)}</span>` : ""}
          </div>
          ${cardBadgeText ? `<span class="k-pill ${cardBadgeCls || ""}">${cardBadgeText}</span>` : ""}
        </div>
        <div class="k-sub">${esc(cardSub || "")}</div>
      </div>
      <div class="k-visual-body">
        ${visualHtml || ""}
      </div>
      <div class="k-footer">
        <span class="k-footer-text">${esc(cardFooterText || "")}</span>
        <span class="k-action-btn" title="Buka rincian">
          ${V3_ICONS.arrowRight}
        </span>
      </div>
    </div>`;
  }
  document.addEventListener("click", (e) => {
    const k = e.target.closest(".v3-kpi[data-go]");
    if (!k) return;
    const [kind, arg] = k.dataset.go.split(":");
    if (kind === "view") showView(arg);
    else if (kind === "tab") switchTab(arg);
    else if (kind === "pic") { const b = $("btnPic"); if (b) b.click(); }
    else if (kind === "list") showTicketList(arg);
  });

  function computeTicketBreakdown(list, specificList) {
    let req = 0, inc = 0, gc1 = 0, telkom = 0;
    let pending = 0, progress = 0, onHold = 0, assigned = 0, resolved = 0;

    if (list && list.length > 0) {
      for (const t of list) {
        const tid = (t.ticketId || "").toUpperCase();
        const st = (t.serviceType || "").toLowerCase();
        const lists = t.itsmLists || [];
        const isInc = lists.includes("incident") || tid.startsWith("INC") || st === "insiden" || st === "incident";
        if (isInc) inc++;
        else req++;

        const isTelk = Boolean(t.isTelkom || (t.assignmentGroup && t.assignmentGroup.toLowerCase().includes("telkom")) || (t.shortDesc && t.shortDesc.toLowerCase().includes("telkom")));
        if (isTelk) telkom++;
        else gc1++;

        const rState = (t.requestState || "").toLowerCase();
        const isClosed = t.slaClosed || rState.includes("closed") || rState.includes("resolved") || rState.includes("selesai");
        if (isClosed) {
          resolved++;
        } else if (rState.includes("pending")) {
          pending++;
        } else if (rState.includes("progress")) {
          progress++;
        } else if (rState.includes("hold")) {
          onHold++;
        } else {
          assigned++;
        }
      }
    } else {
      if (specificList === "request") {
        req = 20; gc1 = 16; telkom = 4; pending = 8; progress = 4; onHold = 3; assigned = 0; resolved = 5;
      } else if (specificList === "incident") {
        inc = 20; gc1 = 16; telkom = 4; pending = 3; progress = 2; onHold = 3; assigned = 0; resolved = 12;
      } else {
        req = 20; inc = 20; gc1 = 32; telkom = 8; pending = 11; progress = 6; onHold = 6; assigned = 0; resolved = 17;
      }
    }

    const total = (specificList === "request") ? (req || 20) : (specificList === "incident") ? (inc || 20) : ((req + inc) || 40);
    const active = assigned + pending + progress + onHold;

    let ratioBarHtml = "";
    let legendHtml = "";

    if (!specificList) {
      const reqPct = Math.round((req / total) * 100) || 50;
      const incPct = 100 - reqPct;
      ratioBarHtml = `<div class="k-ratio-bar"><span class="k-bar-seg seg-req" style="width:${reqPct}%" title="${req} Request (${reqPct}%)"></span><span class="k-bar-seg seg-inc" style="width:${incPct}%" title="${inc} Insiden (${incPct}%)"></span></div>`;
      legendHtml = `<div class="k-meta-legend"><span class="leg-item"><i class="leg-dot dot-req"></i><b>${req}</b> Request</span><span class="leg-item"><i class="leg-dot dot-inc"></i><b>${inc}</b> Insiden</span><span class="leg-sep">·</span><span class="leg-item"><i class="leg-dot dot-gc1"></i><b>${gc1}</b> GC 1</span><span class="leg-item"><i class="leg-dot dot-telkom"></i><b>${telkom}</b> Telkom</span></div>`;
    } else {
      const gc1Pct = Math.round((gc1 / total) * 100) || 80;
      const telkPct = 100 - gc1Pct;
      ratioBarHtml = `<div class="k-ratio-bar"><span class="k-bar-seg seg-gc1" style="width:${gc1Pct}%" title="${gc1} Tim GC 1 (${gc1Pct}%)"></span><span class="k-bar-seg seg-telkom" style="width:${telkPct}%" title="${telkom} Telkom (${telkPct}%)"></span></div>`;
      legendHtml = `<div class="k-meta-legend"><span class="leg-item"><i class="leg-dot dot-gc1"></i><b>${gc1}</b> Tim GC 1</span><span class="leg-item"><i class="leg-dot dot-telkom"></i><b>${telkom}</b> Telkom Eksternal</span><span class="leg-sep">·</span><span class="leg-item"><i class="leg-dot dot-progress"></i><b>${active}</b> Aktif</span></div>`;
    }

    const visualHtml = ratioBarHtml + legendHtml;
    const footerText = `${active} Aktif · ${resolved} Selesai`;

    // Backward compatible chips
    const chips = [];
    if (!specificList) {
      chips.push(`<span class="k-chip chip-req" title="Tiket Request">📋 ${req} Req</span>`);
      chips.push(`<span class="k-chip chip-inc" title="Tiket Insiden">⚡ ${inc} Inc</span>`);
    }
    chips.push(`<span class="k-chip chip-gc1" title="Tiket Tim GC 1 Internal">🛡️ ${gc1} GC 1</span>`);
    chips.push(`<span class="k-chip chip-telkom" title="Tiket Telkom Eksternal">🏢 ${telkom} Telkom</span>`);

    return {
      visualHtml,
      ratioBarHtml,
      legendHtml,
      chipsHtml: chips.join(""),
      footerText: footerText,
      req, inc, gc1, telkom, active, resolved, pending, progress, onHold, assigned
    };
  }

  function snapKpis(s) {
    const all = (s.all_scanned_tickets && s.all_scanned_tickets.length > 0)
      ? s.all_scanned_tickets
      : (s.all_tickets || []);
    const st = (t) => (t.requestState || "").toLowerCase();
    const itsm = all.filter((t) => {
      if (t.isFromWa) return false;
      if (V3.view !== "itsm" || !V3.itsmList) return true;
      const lists = t.itsmLists || [];
      const tid = (t.ticketId || "").toUpperCase();
      const st = (t.serviceType || "").toLowerCase();
      if (V3.itsmList === "incident") {
        return lists.includes("incident") || lists.includes("assign") || tid.startsWith("INC") || st === "insiden" || st === "incident";
      }
      if (V3.itsmList === "request") {
        return lists.includes("request") || tid.startsWith("REQ") || tid.startsWith("RITM") || st === "request" || st === "service request";
      }
      return lists.includes(V3.itsmList);
    });
    const wa = all.filter((t) => t.isFromWa);
    const open = (l) => l.filter((t) => !t.slaClosed);
    const itsmOpen = open(itsm), waOpen = open(wa);
    const waiting = waOpen.filter((t) => t.responseStatus !== "ok");
    const late = waiting.filter((t) => t.responseStatus === "late");
    const snapAssigned = (s && (s.team_assigned_count ?? s.gc1_assigned_count))
      ?? (s && Array.isArray(s.team_assigned) ? s.team_assigned.filter((t) => t.waTier !== 3).length : null);
    const assignedCount = (snapAssigned !== null && snapAssigned !== undefined)
      ? snapAssigned
      : itsm.filter((t) => st(t).includes("assign")).length;
    return { itsm, wa, itsmOpen, waOpen, waiting, late, st,
      assigned: assignedCount,
      pending: itsm.filter((t) => st(t).includes("pending")).length,
      progress: itsm.filter((t) => st(t).includes("progress")).length,
      on_hold: itsm.filter((t) => st(t).includes("hold")).length };
  }

  function renderItsmKpis(s) {
    const k = snapKpis(s);
    const h = s.sla_health_percent ?? 100;
    const breachedCount = s.sla_breached_count ?? 0;

    let totalLabel = "Total Tiket ITSM";
    let totalCat = "PORTAL ITSM";
    let totalIcon = V3_ICONS.total;
    let totalSub = "Total tiket di semua menu ITSM";

    if (V3.itsmList === "request") {
      totalLabel = "Total Tiket Request";
      totalCat = "PERMOHONAN";
      totalIcon = V3_ICONS.request;
      totalSub = "Total seluruh tiket di menu All Request";
    } else if (V3.itsmList === "incident") {
      totalLabel = "Total Tiket Insiden";
      totalCat = "GANGGUAN";
      totalIcon = V3_ICONS.incident;
      totalSub = "Total seluruh tiket di menu All Incident";
    }

    const bd = computeTicketBreakdown(k.itsm, V3.itsmList || false);

    const isAssignedActive = k.assigned > 0;
    const assignedBadgeText = isAssignedActive
      ? `<span class="beacon-pulse-indicator"><span class="beacon-ping"></span><span class="beacon-dot"></span></span> ${k.assigned} Tiket Menunggu`
      : `✓ Terkendali`;
    const assignedBadgeCls = isAssignedActive ? "badge-assigned-live" : "badge-calm";
    const assignedVisualHtml = isAssignedActive
      ? `<div class="k-ratio-bar"><span class="k-bar-seg seg-assigned-pulse" style="width:100%"></span></div>
         <div class="k-meta-legend"><span class="leg-item"><i class="leg-dot dot-assigned-active"></i><b>Prioritas L0/L1</b></span><span class="leg-item"><i class="leg-dot dot-speed"></i><b>Target &lt; 15m</b></span></div>`
      : `<div class="k-ratio-bar"><span class="k-bar-seg seg-calm" style="width:100%"></span></div>
         <div class="k-meta-legend"><span class="leg-item"><i class="leg-dot dot-ok"></i><b>Antrean Bersih</b></span><span class="leg-item"><i class="leg-dot dot-ok"></i><b>Siap Menerima Tiket</b></span></div>`;

    $("itsmKpis").innerHTML =
      kpi({
        cls: "itsm",
        category: totalCat,
        label: totalLabel,
        val: k.itsm.length,
        unit: "tiket",
        sub: totalSub,
        go: "tab:all_tickets",
        iconSvg: totalIcon,
        badgeText: "📁 Terpantau",
        badgeCls: "badge-total",
        visualHtml: bd.visualHtml,
        footerText: bd.footerText
      }) +
      kpi({
        cls: "itsm",
        category: "TIM GC 1",
        label: "Assigned (Siap Ditangani)",
        val: k.assigned,
        unit: "tiket",
        sub: isAssignedActive ? "Segera eksekusi tiket di antrean ini" : "Siap dieksekusi teknis tim GC 1",
        go: "tab:team_assigned",
        iconSvg: V3_ICONS.assigned,
        badgeText: assignedBadgeText,
        badgeCls: assignedBadgeCls,
        visualHtml: assignedVisualHtml,
        footerText: isAssignedActive ? "Antrean prioritas siap eksekusi" : "Semua tiket sudah ditugaskan",
        isAssignedActive: isAssignedActive
      }) +
      kpi({
        cls: "warn",
        category: "VERIFIKASI",
        label: "Pending Approval",
        val: k.pending,
        unit: "tiket",
        sub: "Menunggu persetujuan tenan/K/L",
        go: "tab:team_pending",
        iconSvg: V3_ICONS.pending,
        badgeText: "⏳ Verifikasi K/L",
        badgeCls: "badge-pending",
        visualHtml: `<div class="k-ratio-bar"><span class="k-bar-seg seg-pending" style="width:100%"></span></div>
                     <div class="k-meta-legend"><span class="leg-item"><i class="leg-dot dot-pending"></i><b>Konfirmasi K/L</b></span><span class="leg-item"><i class="leg-dot dot-doc"></i><b>Nota Dinas</b></span></div>`,
        footerText: `${k.pending} tiket verifikasi K/L`
      }) +
      kpi({
        cls: "violet",
        category: "PENGERJAAN TEKNIS",
        label: "Sedang Dikerjakan",
        val: k.progress,
        unit: "tiket",
        sub: "Pengerjaan teknis resolver L1/L2/L3",
        go: "tab:team_progress",
        iconSvg: V3_ICONS.progress,
        badgeText: "⚡ Proses Aktif",
        badgeCls: "badge-progress",
        visualHtml: `<div class="k-ratio-bar"><span class="k-bar-seg seg-progress" style="width:100%"></span></div>
                     <div class="k-meta-legend"><span class="leg-item"><i class="leg-dot dot-progress"></i><b>Resolver L1/L2/L3</b></span><span class="leg-item"><i class="leg-dot dot-tech"></i><b>Pengerjaan Aktif</b></span></div>`,
        footerText: "Pengerjaan aktif resolver"
      }) +
      kpi({
        cls: "hold",
        category: "DEPENDENSI",
        label: "On Hold (Tertunda)",
        val: k.on_hold,
        unit: "tiket",
        sub: "Menunggu tenan / vendor / pihak luar",
        go: "list:on_hold",
        iconSvg: V3_ICONS.onhold,
        badgeText: "⏸️ On-Hold",
        badgeCls: "badge-onhold",
        visualHtml: `<div class="k-ratio-bar"><span class="k-bar-seg seg-onhold" style="width:100%"></span></div>
                     <div class="k-meta-legend"><span class="leg-item"><i class="leg-dot dot-onhold"></i><b>Tertunda Eksternal</b></span><span class="leg-item"><i class="leg-dot dot-vendor"></i><b>Vendor / Tenan</b></span></div>`,
        footerText: `${k.on_hold} tiket tertunda eksternal`
      }) +
      kpi({
        cls: h >= 95 ? "ok" : h >= 80 ? "warn" : "danger",
        category: "STANDAR KAK 18.c",
        label: "Kepatuhan SLA (KAK 18.c)",
        val: h,
        unit: "%",
        sub: "Standar batas baku resmi KAK 18.c",
        go: "list:sla",
        iconSvg: V3_ICONS.sla,
        badgeText: h >= 95 ? "✓ Target > 95%" : "⚠️ Waspada",
        badgeCls: h >= 95 ? "badge-ok" : "badge-danger",
        visualHtml: `<div class="k-ratio-bar"><span class="k-bar-seg ${h >= 95 ? "seg-ok" : "seg-danger"}" style="width:${Math.min(100, Math.max(0, h))}%"></span></div>
                     <div class="k-meta-legend"><span class="leg-item"><i class="leg-dot ${h >= 95 ? "dot-ok" : "dot-danger"}"></i><b>${h}%</b> Terpenuhi</span><span class="leg-item"><i class="leg-dot dot-breach"></i><b>${breachedCount}</b> Lewat SLA</span></div>`,
        footerText: "Target resmi KAK: > 95%"
      });
  }

  function renderWaKpis(s) {
    const k = snapKpis(s);
    const unver = k.waOpen.filter((t) => (t.identity || {}).status !== "verified").length;
    const unlinked = k.waOpen.filter((t) => !t.linkedPortalId).length;
    const avg = V3.stats ? V3.stats.wa_reply_avg_min : null;
    $("waKpis").innerHTML =
      kpi({
        cls: "wa",
        category: "WHATSAPP",
        label: "Pra-tiket WhatsApp Aktif",
        val: k.waOpen.length,
        unit: "aduan",
        sub: "Belum selesai / ditolak",
        go: "tab:all_tickets",
        iconSvg: V3_ICONS.wa,
        badgeText: "💬 Pra-Tiket",
        badgeCls: "badge-wa",
        visualHtml: `<div class="k-ratio-bar"><span class="k-bar-seg seg-ok" style="width:100%"></span></div>
                     <div class="k-meta-legend"><span class="leg-item"><i class="leg-dot dot-ok"></i><b>Pra-Tiket Masuk</b></span><span class="leg-item"><i class="leg-dot dot-speed"></i><b>Tindak Lanjut Segera</b></span></div>`,
        footerText: "Aduan aktif dari grup WA"
      }) +
      kpi({
        cls: k.late.length ? "danger" : k.waiting.length ? "warn" : "ok",
        category: "RESPON",
        label: "Menunggu Balasan",
        val: k.waiting.length,
        unit: "aduan",
        sub: k.late.length ? `${k.late.length} lewat target` : "Semua dalam target",
        go: "tab:all_tickets",
        iconSvg: V3_ICONS.pending,
        badgeText: k.late.length ? "⚠️ Lewat Target" : "✓ Tepat Waktu",
        badgeCls: k.late.length ? "badge-danger" : "badge-ok",
        visualHtml: `<div class="k-ratio-bar"><span class="k-bar-seg ${k.late.length ? "seg-danger" : "seg-ok"}" style="width:100%"></span></div>
                     <div class="k-meta-legend"><span class="leg-item"><i class="leg-dot ${k.late.length ? "dot-danger" : "dot-ok"}"></i><b>${k.late.length ? k.late.length + " Lewat Target" : "Tepat Waktu"}</b></span></div>`,
        footerText: "Target balasan ≤ 10 menit"
      }) +
      kpi({
        cls: "itsm",
        category: "KECEPATAN",
        label: "Rata-rata Waktu Respon",
        val: num(avg),
        unit: avg === null || avg === undefined ? "" : "menit",
        sub: "Target internal 5-10 menit",
        go: null,
        iconSvg: V3_ICONS.progress,
        badgeText: "⚡ Respon Cepat",
        badgeCls: "badge-assigned",
        visualHtml: `<div class="k-ratio-bar"><span class="k-bar-seg seg-progress" style="width:100%"></span></div>
                     <div class="k-meta-legend"><span class="leg-item"><i class="leg-dot dot-speed"></i><b>Target 5-10 mnt</b></span><span class="leg-item"><i class="leg-dot dot-doc"></i><b>Standar Helpdesk</b></span></div>`,
        footerText: "Standar pelayanan helpdesk"
      }) +
      kpi({
        cls: "warn",
        category: "SINKRONISASI",
        label: "Belum Ada Tiket ITSM",
        val: unlinked,
        unit: "aduan",
        sub: "Perlu dibuatkan tiket resmi",
        go: "list:unlinked",
        iconSvg: V3_ICONS.request,
        badgeText: "⏳ Menunggu Tiket",
        badgeCls: "badge-pending",
        visualHtml: `<div class="k-ratio-bar"><span class="k-bar-seg seg-pending" style="width:100%"></span></div>
                     <div class="k-meta-legend"><span class="leg-item"><i class="leg-dot dot-pending"></i><b>Menunggu Tiket</b></span><span class="leg-item"><i class="leg-dot dot-doc"></i><b>Buka di Portal</b></span></div>`,
        footerText: "Belum terbit nomor tiket ITSM"
      });
  }

  function renderOverviewKpis(s) {
    const st = V3.stats;
    const kk = st ? st.kpi : null;
    const snapObj = (s && s.snapshot) || s || getState().snapshot || {};
    const h = (st && st.sla && st.sla.health_pct !== undefined) ? st.sla.health_pct : (snapObj.sla_health_percent ?? 100);
    const breachedCount = (st && st.sla && st.sla.breached) ? st.sla.breached : (snapObj.sla_breached_count ?? 0);
    const k = snapKpis(snapObj);
    const assignedCount = k.assigned || (kk ? kk.itsm_assigned : 0) || (snapObj.team_assigned_count ?? 0);
    const pendingCount = k.pending || (kk ? kk.itsm_pending : 0) || (snapObj.team_pending_count ?? 0);
    const onHoldCount = k.on_hold || (kk ? kk.itsm_on_hold : 0) || 0;
    const progressCount = k.progress || (kk ? Math.max(0, (kk.itsm_open || 0) - assignedCount - pendingCount - onHoldCount) : (snapObj.team_progress_count ?? 0));

    const stSnap = getState().snapshot || snapObj;
    const allScanned = (stSnap && stSnap.all_scanned_tickets && stSnap.all_scanned_tickets.length > 0)
      ? stSnap.all_scanned_tickets
      : ((stSnap && stSnap.all_tickets) || (snapObj.all_tickets) || []);
    const itsmTotal = allScanned.filter(t => !t.isFromWa).length || (kk ? kk.itsm_open : null) || (snapObj.total_helpdesk) || 40;

    const bd = computeTicketBreakdown(allScanned.filter(t => !t.isFromWa), false);

    // Card 2: Assigned (Siap Ditangani) - Active glowing pulse when assignedCount > 0!
    const isAssignedActive = assignedCount > 0;
    const assignedBadgeText = isAssignedActive
      ? `<span class="beacon-pulse-indicator"><span class="beacon-ping"></span><span class="beacon-dot"></span></span> ${assignedCount} Tiket Menunggu`
      : `✓ Terkendali`;
    const assignedBadgeCls = isAssignedActive ? "badge-assigned-live" : "badge-calm";
    const assignedVisualHtml = isAssignedActive
      ? `<div class="k-ratio-bar"><span class="k-bar-seg seg-assigned-pulse" style="width:100%"></span></div>
         <div class="k-meta-legend"><span class="leg-item"><i class="leg-dot dot-assigned-active"></i><b>Prioritas L0/L1</b></span><span class="leg-item"><i class="leg-dot dot-speed"></i><b>Target &lt; 15m</b></span></div>`
      : `<div class="k-ratio-bar"><span class="k-bar-seg seg-calm" style="width:100%"></span></div>
         <div class="k-meta-legend"><span class="leg-item"><i class="leg-dot dot-ok"></i><b>Antrean Bersih</b></span><span class="leg-item"><i class="leg-dot dot-ok"></i><b>Siap Menerima Tiket</b></span></div>`;
    const assignedFooter = isAssignedActive
      ? "Antrean prioritas siap eksekusi tim"
      : "Semua tiket sudah ditugaskan";

    $("ovKpis").innerHTML =
      kpi({
        cls: "itsm",
        category: "PORTAL ITSM",
        label: "Total Tiket ITSM",
        val: itsmTotal,
        unit: "tiket",
        sub: "Gabungan Request dan Insiden terpantau",
        go: "view:itsm",
        iconSvg: V3_ICONS.total,
        badgeText: "📁 Terpantau",
        badgeCls: "badge-total",
        visualHtml: bd.visualHtml,
        footerText: bd.footerText
      }) +
      kpi({
        cls: "itsm",
        category: "TIM GC 1",
        label: "Assigned (Siap Ditangani)",
        val: assignedCount,
        unit: "tiket",
        sub: isAssignedActive ? "Segera eksekusi tiket di antrean ini" : "Siap dieksekusi teknis tim GC 1",
        go: "tab:team_assigned",
        iconSvg: V3_ICONS.assigned,
        badgeText: assignedBadgeText,
        badgeCls: assignedBadgeCls,
        visualHtml: assignedVisualHtml,
        footerText: assignedFooter,
        isAssignedActive: isAssignedActive
      }) +
      kpi({
        cls: "warn",
        category: "VERIFIKASI",
        label: "Pending Approval",
        val: pendingCount,
        unit: "tiket",
        sub: "Menunggu persetujuan tenan/K/L",
        go: "tab:team_pending",
        iconSvg: V3_ICONS.pending,
        badgeText: "⏳ Verifikasi K/L",
        badgeCls: "badge-pending",
        visualHtml: `<div class="k-ratio-bar"><span class="k-bar-seg seg-pending" style="width:100%"></span></div>
                     <div class="k-meta-legend"><span class="leg-item"><i class="leg-dot dot-pending"></i><b>Konfirmasi K/L</b></span><span class="leg-item"><i class="leg-dot dot-doc"></i><b>Nota Dinas</b></span></div>`,
        footerText: `${pendingCount} tiket verifikasi K/L`
      }) +
      kpi({
        cls: "violet",
        category: "PENGERJAAN TEKNIS",
        label: "Sedang Dikerjakan",
        val: progressCount,
        unit: "tiket",
        sub: "Pengerjaan teknis resolver L1/L2/L3",
        go: "tab:team_progress",
        iconSvg: V3_ICONS.progress,
        badgeText: "⚡ Proses Aktif",
        badgeCls: "badge-progress",
        visualHtml: `<div class="k-ratio-bar"><span class="k-bar-seg seg-progress" style="width:100%"></span></div>
                     <div class="k-meta-legend"><span class="leg-item"><i class="leg-dot dot-progress"></i><b>Resolver L1/L2/L3</b></span><span class="leg-item"><i class="leg-dot dot-tech"></i><b>Pengerjaan Aktif</b></span></div>`,
        footerText: "Pengerjaan aktif resolver"
      }) +
      kpi({
        cls: "hold",
        category: "DEPENDENSI",
        label: "On Hold (Tertunda)",
        val: onHoldCount,
        unit: "tiket",
        sub: "Menunggu tenan / vendor / pihak luar",
        go: "list:on_hold",
        iconSvg: V3_ICONS.onhold,
        badgeText: "⏸️ On-Hold",
        badgeCls: "badge-onhold",
        visualHtml: `<div class="k-ratio-bar"><span class="k-bar-seg seg-onhold" style="width:100%"></span></div>
                     <div class="k-meta-legend"><span class="leg-item"><i class="leg-dot dot-onhold"></i><b>Tertunda Eksternal</b></span><span class="leg-item"><i class="leg-dot dot-vendor"></i><b>Vendor / Tenan</b></span></div>`,
        footerText: `${onHoldCount} tiket tertunda eksternal`
      }) +
      kpi({
        cls: h >= 95 ? "ok" : h >= 80 ? "warn" : "danger",
        category: "STANDAR KAK 18.c",
        label: "Kepatuhan SLA (KAK 18.c)",
        val: h,
        unit: "%",
        sub: "Standar batas baku resmi KAK 18.c",
        go: "view:itsm",
        iconSvg: V3_ICONS.sla,
        badgeText: h >= 95 ? "✓ Target > 95%" : "⚠️ Waspada",
        badgeCls: h >= 95 ? "badge-ok" : "badge-danger",
        visualHtml: `<div class="k-ratio-bar"><span class="k-bar-seg ${h >= 95 ? "seg-ok" : "seg-danger"}" style="width:${Math.min(100, Math.max(0, h))}%"></span></div>
                     <div class="k-meta-legend"><span class="leg-item"><i class="leg-dot ${h >= 95 ? "dot-ok" : "dot-danger"}"></i><b>${h}%</b> Terpenuhi</span><span class="leg-item"><i class="leg-dot dot-breach"></i><b>${breachedCount}</b> Lewat SLA</span></div>`,
        footerText: "Target resmi KAK: > 95%"
      });

    // Update 4 Metric Strip in Left Card (Aivora Style)
    const allTickets = (stSnap && stSnap.all_tickets) || (s.all_tickets) || [];
    const totalCount = allTickets.length || (kk?.itsm_open) || itsmTotal || 40;
    const activeCount = (kk?.itsm_open) || (assignedCount + pendingCount + progressCount + onHoldCount);
    const resolvedCount = Math.max(0, totalCount - activeCount);
    if ($("stripTotal")) $("stripTotal").textContent = `${totalCount} Tiket`;
    if ($("stripActive")) $("stripActive").textContent = `${activeCount} Tiket`;
    if ($("stripResolved")) $("stripResolved").textContent = `${resolvedCount} Tiket`;
    if ($("stripWa")) $("stripWa").textContent = `${kk?.wa_active || 0} Pra-Tiket`;
  }

  // ------------------------------------------------------------------ grafik
  const PRIO = ["Critical", "Major", "Minor", "Service Request"];
  function trendSeries(s, which) {
    const labels = s.buckets.map((b) => b.label);
    const series = [];
    if (which !== "wa") series.push({ name: "ITSM", color: C.colors.itsm, values: s.buckets.map((b) => b.itsm) });
    if (which !== "itsm") series.push({ name: "WhatsApp", color: C.colors.wa, values: s.buckets.map((b) => b.wa) });
    return { labels, series };
  }
  function prioItems(obj, both) {
    return PRIO.map((k) => ({ label: k, value: both ? (both.itsm[k] || 0) + (both.wa[k] || 0) : (obj[k] || 0), color: C.colors[k] }));
  }
  function catItems(s) {
    return (s.category || []).slice(0, 7).map((c) => ({ label: c.kategori, value: c.request + c.insiden, color: "#2563EB" }));
  }
  function objItems(o) { return Object.entries(o || {}).map(([label, value]) => ({ label, value })); }

  function listHtml(items, kind) {
    if (!items.length) return `<li class="none">${kind === "att" ? "Tidak ada tiket yang perlu perhatian" : "Semua aduan WhatsApp sudah dibalas"}</li>`;
    return items.map((a) => kind === "att"
      ? `<li data-open="${esc(a.ticketId)}"><span class="src ${a.source === "WA" ? "wa" : "itsm"}">${esc(a.source)}</span><span><span class="id">${esc(a.ticketId)}</span><span class="why">${esc(a.flag)}</span></span><span class="pr">${esc(a.priority || "")}</span></li>`
      : `<li data-open="${esc(a.ticketId)}"><span class="src wa">WA</span><span><span class="id">${esc(a.ticketId)}</span><span class="why">${esc(a.who)}</span></span><span class="pr">${esc(a.text)}</span></li>`).join("");
  }
  document.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-open]");
    if (li && typeof window.openTicketActivityDetail === "function") window.openTicketActivityDetail(li.dataset.open);
  });

  function renderCharts() {
    const s = V3.stats;
    if (!s) return;
    if (V3.view === "overview") {
      renderOverviewKpis(getState().snapshot || {});
      const t = trendSeries(s);
      C.stackedBars($("chOvTrend"), { labels: t.labels, series: t.series, aria: "Tren tiket masuk ITSM dan WhatsApp" });
      C.donut($("chOvSource"), { items: [{ label: "Tiket ITSM", value: s.totals.itsm, color: C.colors.itsm }, { label: "Aduan WhatsApp", value: s.totals.wa, color: C.colors.wa }], centerLabel: "masuk" });
      C.hbars($("chOvPriority"), { items: prioItems(null, s.priority) });
      C.hbars($("chOvCategory"), { items: catItems(s) });
      C.gauge($("chOvGaugeSla"), { value: s.sla.matrix_pct, target: 95, label: "SLA tiket ITSM", sub: `Saat ini ${s.sla.health_pct}% tiket aktif aman`, emptyText: "SLA: belum ada tiket selesai" });
      C.gauge($("chOvGaugeWa"), { value: s.sla.wa_reply_pct, label: "Balasan WA dalam target", sub: `≤ ${s.sla.wa_reply_target_min} menit`, emptyText: "Balasan: belum ada data" });
      $("ovAttention").innerHTML = listHtml(s.attention, "att");
      $("ovWaiting").innerHTML = listHtml(s.waiting_replies, "wait");
    } else if (V3.view === "itsm") {
      const t = trendSeries(s, "itsm");
      C.stackedBars($("chItsmTrend"), { labels: t.labels, series: t.series });
      C.donut($("chItsmStatus"), { items: objItems(s.itsm_status), centerLabel: "tiket" });
      C.hbars($("chItsmPriority"), { items: prioItems(s.priority.itsm) });
      C.hbars($("chItsmCategory"), { items: catItems(s) });
      C.gauge($("chItsmGauge"), { value: s.sla.matrix_pct, target: 95, label: "Kepatuhan SLA (periode)", sub: s.sla.kak_pct === null ? "" : `Batas baku KAK: ${s.sla.kak_pct}%`, emptyText: "Belum ada tiket selesai pada periode ini" });
    } else if (V3.view === "wa") {
      const t = trendSeries(s, "wa");
      C.stackedBars($("chWaTrend"), { labels: t.labels, series: t.series });
      C.donut($("chWaStatus"), { items: objItems(s.wa_status), centerLabel: "pra-tiket" });
      C.hbars($("chWaReply"), { items: objItems(s.wa_reply_dist) });
      C.hbars($("chWaGroups"), { items: objItems(s.wa_groups).map((x) => ({ ...x, color: "#10B981" })) });
      C.gauge($("chWaGauge"), { value: s.sla.wa_reply_pct, label: `Dibalas ≤ ${s.sla.wa_reply_target_min} menit`, sub: s.wa_reply_avg_min === null ? "" : `Rata-rata ${s.wa_reply_avg_min} menit`, emptyText: "Belum ada balasan tercatat" });
      renderWaKpis(getState().snapshot || {});
    }
    const pillW = $("sbPillWa");
    if (pillW) { pillW.textContent = s.kpi.wa_active; pillW.classList.toggle("hot", s.kpi.wa_late > 0); }
  }

  async function loadStats(force) {
    const now = Date.now();
    if (!force && now - V3.lastStats < 6000) return;
    V3.lastStats = now;
    try {
      const r = await fetch(`${SERVER}/api/stats?range=${V3.range}${V3.view === "itsm" && V3.itsmList ? "&list=" + encodeURIComponent(V3.itsmList) : ""}`);
      if (!r.ok) return;
      V3.stats = await r.json();
      renderCharts();
    } catch (_) {}
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-range-switch] button");
    if (!b) return;
    V3.range = b.dataset.range;
    store.set("gc1_range", V3.range);
    document.querySelectorAll("[data-range-switch] button").forEach((x) => x.classList.toggle("active", x.dataset.range === V3.range));
    loadStats(true);
  });

  // Card Internal Tabs (Aivora layout switcher)
  document.addEventListener("click", (e) => {
    const tabBtn = e.target.closest(".v3-card-tab[data-tab-card]");
    if (!tabBtn) return;
    const card = tabBtn.closest(".v3-card");
    if (!card) return;
    const targetId = tabBtn.dataset.tabCard;
    card.querySelectorAll(".v3-card-tab").forEach((b) => b.classList.toggle("active", b === tabBtn));
    card.querySelectorAll(".card-tab-panel").forEach((p) => {
      p.hidden = p.id !== targetId;
    });
    if (V3.stats) renderCharts();
  });

  function renderSyncInfo(lists) {
    const box = $("itsmSyncInfo");
    if (!box || !Array.isArray(lists)) return;
    box.innerHTML = lists.filter((l) => l.key === "request" || l.key === "incident" || l.legacy).map((l) => {
      if (l.legacy) return l.count ? `<span class="chip off" title="Dibaca ekstensi versi lama tanpa nama halaman">Ekstensi versi lama masih membaca ${l.count} tiket tanpa nama menu: muat ulang ekstensi di Chrome</span>` : "";
      if (l.synced_at === null || l.synced_at === undefined) return `<span class="chip off" title="Halaman ini belum pernah dibaca ekstensi">${esc(l.label)}: belum dibaca. Buka menu ${esc(l.label)} di ITSM</span>`;
      const mins = Math.round((l.age_sec || 0) / 60);
      const stale = (l.age_sec || 0) > 900;
      return `<span class="chip ${stale ? "stale" : ""}" title="${esc(l.title || "")}">${esc(l.label)}: ${l.count} tiket · sinkron ${mins < 1 ? "baru saja" : mins + " menit lalu"}</span>`;
    }).join("");
  }

  // ---- daftar tiket yang dibuka dari kartu KPI
  const LISTS = {
    attention: { title: "Tiket yang perlu perhatian", empty: "Tidak ada tiket dengan penanda eskalasi.", pred: (t) => !t.slaClosed && (t.escalationFlags || []).length > 0 },
    sla: { title: "Tiket ITSM yang melewati SLA", empty: "Tidak ada tiket aktif yang melewati SLA.", pred: (t) => !t.isFromWa && !t.slaClosed && t.slaBreached && (!V3.itsmList || (V3.itsmList === "incident" ? ((t.itsmLists || []).includes("incident") || (t.itsmLists || []).includes("assign") || (t.ticketId || "").toUpperCase().startsWith("INC") || (t.serviceType || "").toLowerCase() === "insiden") : ((t.itsmLists || []).includes("request") || (t.ticketId || "").toUpperCase().startsWith("REQ") || (t.serviceType || "").toLowerCase() === "service request"))) },
    unlinked: { title: "Pra-tiket yang belum punya tiket di ITSM", empty: "Semua pra-tiket aktif sudah punya tiket di ITSM.", pred: (t) => t.isFromWa && !t.slaClosed && !t.linkedPortalId },
    on_hold: { title: "Daftar Tiket Berstatus On Hold (Tertunda)", empty: "Tidak ada tiket berstatus On Hold.", pred: (t) => (t.requestState || "").toLowerCase().includes("hold") },
  };
  const PRIO_ORDER = { Critical: 0, Major: 1, Minor: 2, "Service Request": 3 };

  function showTicketList(name) {
    const cfg = LISTS[name];
    const snap = getState().snapshot || {};
    if (!cfg) return;
    const rows = (snap.all_tickets || []).filter(cfg.pred)
      .sort((a, b) => (PRIO_ORDER[a.priority] ?? 9) - (PRIO_ORDER[b.priority] ?? 9) || (a.createdTs || 0) - (b.createdTs || 0));
    $("listModalTitle").textContent = cfg.title;
    $("listModalCount").textContent = `${rows.length} tiket`;
    $("listModalBody").innerHTML = rows.length ? `<table class="report-table" style="font-size:12.5px;">
      <tr><th>Tiket</th><th>Sumber</th><th>Pemohon / instansi</th><th>Prioritas</th><th>Status</th><th>Alasan / SLA</th></tr>
      ${rows.map((t) => `<tr data-open="${esc(t.ticketId)}" style="cursor:pointer;">
        <td><b>${esc(t.ticketId)}</b></td>
        <td>${t.isFromWa ? "WhatsApp" : "ITSM " + esc((t.itsmLists || []).filter((k) => V3.lists.some((l) => l.key === k)).map(listLabel).join("/"))}</td>
        <td>${esc(t.requestedFor || "-")}<br><span style="color:#64748B">${esc(t.location || "")}</span></td>
        <td>${esc(t.priority || "")}</td><td>${esc(t.requestState || "")}</td>
        <td>${esc((t.escalationFlags || []).slice(0, 2).join(" | ") || t.slaStatusText || "")}</td></tr>`).join("")}</table>` : `<div class="ch-empty">${esc(cfg.empty)}</div>`;
    $("listModal").classList.add("active");
  }
  V3.showTicketList = showTicketList;
  ["closeListBtn", "listCloseBtn"].forEach((id) => $(id) && $(id).addEventListener("click", () => $("listModal").classList.remove("active")));
  $("listModal").addEventListener("click", (e) => { if (e.target === $("listModal")) $("listModal").classList.remove("active"); });
  $("listModalBody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-open]");
    if (tr && typeof window.openTicketActivityDetail === "function") { $("listModal").classList.remove("active"); window.openTicketActivityDetail(tr.dataset.open); }
  });

  V3.onSnapshot = onSnapshot;
  function onSnapshot(data, immediate) {
    if (data && getState()) getState().snapshot = data;
    const k = snapKpis(data);
    setLists(data.itsm_lists);
    const pillW = $("sbPillWa");
    const itsmAll = (data.all_scanned_tickets && data.all_scanned_tickets.length > 0)
      ? data.all_scanned_tickets.filter((t) => !t.isFromWa)
      : (data.all_tickets || []).filter((t) => !t.isFromWa);

    document.querySelectorAll("[data-pill-list]").forEach((p) => {
      const key = p.dataset.pillList;
      let matched = [];
      if (!key) {
        matched = itsmAll;
      } else if (key === "request") {
        matched = itsmAll.filter((t) => {
          const st = (t.serviceType || "").toLowerCase();
          const tid = (t.ticketId || "").toUpperCase();
          return (t.itsmLists || []).includes("request") || tid.startsWith("REQ") || tid.startsWith("RITM") || st === "request" || st === "service request";
        });
      } else if (key === "incident") {
        matched = itsmAll.filter((t) => {
          const st = (t.serviceType || "").toLowerCase();
          const tid = (t.ticketId || "").toUpperCase();
          return (t.itsmLists || []).includes("incident") || (t.itsmLists || []).includes("assign") || tid.startsWith("INC") || st === "insiden" || st === "incident";
        });
      } else {
        matched = itsmAll.filter((t) => (t.itsmLists || []).includes(key));
      }
      p.textContent = matched.length;
      const openCount = matched.filter((t) => !t.slaClosed).length;
      p.title = `${matched.length} tiket di menu ini (${openCount} aktif, ${matched.length - openCount} selesai)`;
    });
    if (pillW) { pillW.textContent = k.waOpen.length; pillW.classList.toggle("hot", k.late.length > 0); }
    renderSyncInfo(data.itsm_lists);
    if (V3.view === "overview") renderOverviewKpis(data);
    if (V3.view === "itsm") renderItsmKpis(data);
    if (V3.view === "wa") renderWaKpis(data);
    const role = $("sbRole");
    if (role) role.innerHTML = `<b>Peran:</b> ${getState().role === "team" ? "tampilan tim (hanya-baca)" : "operator"}`;
    if (immediate) return;
    loadStats(false);
  }

  // ------------------------------------------------------------------ INPUT CEPAT (NLP)
  const qi = { timer: null, seq: 0, results: [], include: {}, jobTimer: null, aiNote: "" };

  function qiMessages() {
    const parsed = GC1Paste.parseWaPaste($("mwText").value);
    const sender = ($("mwSender").value || "").trim();
    const phone = ($("mwPhone").value || "").trim();
    const plainTs = $("mwTime").value ? Math.floor(new Date($("mwTime").value).getTime() / 1000) : null;
    return parsed.messages.map((m) => ({
      sender: m.sender || sender || phone, text: m.text, ts: m.ts || (parsed.hadHeaders ? null : plainTs),
      phone: !parsed.hadHeaders ? phone : "",
    }));
  }

  function qiSchedule() {
    clearTimeout(qi.timer);
    qi.timer = setTimeout(qiRun, 450);
  }

  async function qiRun() {
    const msgs = qiMessages();
    const seq = ++qi.seq;
    clearTimeout(qi.jobTimer);
    if (!msgs.length) { qi.results = []; qiRender(); $("qiAi").textContent = ""; return; }
    try {
      const r = await postJson("/api/nlp_extract", { messages: msgs, group: ($("mwGroup").value || "").trim(), ai: true });
      if (seq !== qi.seq || r.status !== "ok") return;
      qi.results = r.results.map((x, i) => ({ ...x, phone: x.phone, _i: i }));
      qi.results.forEach((x) => { if (!(x.text in qi.include)) qi.include[x.text] = x.needsReply; });
      $("qiAi").textContent = r.job ? "AI lokal menyempurnakan..." : (r.ai_available ? "" : "Hasil dari aturan NLP (AI lokal belum aktif)");
      qiRender();
      if (r.job) qiPoll(r.job, seq, 0);
    } catch (_) {}
  }

  function qiPoll(job, seq, n) {
    qi.jobTimer = setTimeout(async () => {
      if (seq !== qi.seq || n > 40) return;
      try {
        const j = await (await fetch(`${SERVER}/api/nlp_job?id=${encodeURIComponent(job)}`)).json();
        Object.entries(j.results || {}).forEach(([i, ai]) => { if (qi.results[i]) qi.results[i].ai = ai; });
        qiRender();
        if (j.status === "pending") return qiPoll(job, seq, n + 1);
        $("qiAi").textContent = j.status === "done" && Object.keys(j.results || {}).length ? "AI lokal selesai" : "AI lokal tidak menghasilkan saran";
      } catch (_) {}
    }, 1500);
  }

  const pcls = (p) => "p-" + String(p || "").split(" ")[0];
  function qiRender() {
    const box = $("qiPreview");
    if (!qi.results.length) { box.innerHTML = '<div class="qi-empty">Tempel pesan di sebelah kiri.<br>Hasil pembacaan muncul di sini sebelum tiket dibuat.</div>'; return; }
    box.innerHTML = qi.results.map((r, i) => {
      const ai = r.ai || {};
      const prio = ai.priority || r.priority;
      const summary = ai.summary || r.summary;
      const chatter = ai.is_peer_chatter === true || !r.needsReply;
      const idChip = r.identityStatus === "verified" ? `<span class="qi-chip ok">✓ PIC terdaftar</span>`
        : r.identityStatus === "no_phone" ? `<span class="qi-chip warn">⚠ tanpa nomor</span>` : `<span class="qi-chip warn">⚠ nomor baru</span>`;
      const who = r.identityName || r.sender || "(tanpa nama)";
      const flags = (r.flags || []).filter((f) => !/nomor/.test(f)).map((f) => `<span class="qi-chip">${esc(f)}</span>`).join("");
      const ent = r.entities || {};
      const entTxt = [ent.tiket && ent.tiket.length ? "tiket " + ent.tiket.join(", ") : "", ent.vm && ent.vm.length ? "host " + ent.vm.join(", ") : "", ent.ip && ent.ip.length ? "IP " + ent.ip.join(", ") : ""].filter(Boolean).join(" · ");
      return `<div class="qi-card ${chatter ? "chat" : ""}">
        <div class="qi-top"><label><input type="checkbox" data-qi-inc="${i}" ${qi.include[r.text] ? "checked" : ""}> <span class="qi-who">${esc(who)}</span></label>
          <span class="qi-chip ${pcls(prio)}">${esc(prio)}</span><span class="qi-chip">${esc(r.intent)}</span>${r.category ? `<span class="qi-chip">${esc(r.category)}</span>` : ""}${idChip}
          ${ai.priority && ai.priority !== r.priority ? `<span class="qi-chip ai">AI: ${esc(ai.priority)}</span>` : ""}${r.ai ? `<span class="qi-chip ai">${esc(ai.engine || "AI lokal")}</span>` : ""}</div>
        <div class="qi-sum">${esc(summary)}</div>
        <div class="qi-meta"><b>Instansi</b><span>${esc(r.instansi || "belum terdeteksi")}</span><b>Nomor HP</b><span>${esc(r.phone ? "+" + r.phone : "-")}</span>
          ${entTxt ? `<b>Entitas</b><span>${esc(entTxt)}</span>` : ""}<b>Dasar</b><span>${esc(r.reason)}</span></div>
        ${flags ? `<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;">${flags}</div>` : ""}
      </div>`;
    }).join("");
  }

  $("qiPreview").addEventListener("change", (e) => {
    const c = e.target.closest("[data-qi-inc]");
    if (c) qi.include[qi.results[parseInt(c.dataset.qiInc, 10)].text] = c.checked;
  });
  ["mwText", "mwSender", "mwPhone", "mwTime", "mwGroup"].forEach((id) => $(id) && $(id).addEventListener("input", qiSchedule));

  /** dipakai pembuat pra-tiket di dashboard.js */
  V3.nlpFor = function (text) {
    const r = qi.results.find((x) => x.text === text);
    if (!r) return null;
    const ai = r.ai || {};
    return { instansi: r.instansi, summary: ai.summary || r.summary, priority: ai.priority || r.priority, reason: ai.reason || r.reason,
      needsReply: ai.needs_followup !== undefined ? ai.needs_followup : r.needsReply, chatter: ai.is_peer_chatter === true || !r.needsReply,
      engine: r.ai ? (ai.engine || "ai-lokal") : "nlp-aturan", has_image_only: !!ai.has_image_only };
  };
  V3.skipMsg = function (text) { return text in qi.include && qi.include[text] === false; };
  V3.resetQuick = function () { qi.results = []; qi.include = {}; qi.seq++; clearTimeout(qi.jobTimer); qiRender(); $("qiAi").textContent = ""; };

  // ------------------------------------------------------------------ Rekam Tiket Manual
  let manualInitialized = false;
  function showManualAlert(msg, isError) {
    const box = $("manAlertBox");
    if (!box) return;
    box.style.display = "block";
    box.style.background = isError ? "#FEE2E2" : "#ECFDF5";
    box.style.color = isError ? "#B91C1C" : "#047857";
    box.style.border = isError ? "1px solid #F87171" : "1px solid #34D399";
    box.innerHTML = (isError ? "⚠️ " : "✅ ") + esc(msg);
    setTimeout(() => { if (box) box.style.display = "none"; }, 6000);
  }

  function loadManualTickets() {
    const tb = $("manTicketsTableBody");
    if (!tb) return;
    fetch("/api/manual_tickets")
      .then((r) => r.json())
      .then((d) => {
        const list = d.tickets || [];
        if (!list.length) {
          tb.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:16px;color:#94A3B8;">Belum ada tiket yang direkam secara manual. Gunakan form di atas untuk menambahkan tiket.</td></tr>';
          return;
        }
        tb.innerHTML = list.map((t) => {
          const tid = esc(t.ticketId || "");
          const st = esc(t.serviceType || "Request");
          const desc = esc(t.shortDesc || "-");
          const who = esc(t.requestedFor || "-");
          const stateVal = esc(t.requestState || "-");
          const grp = esc(t.assignmentGroup || "-");
          const dateVal = esc(t.createdDate || "-");
          const badgeClass = stateVal.toLowerCase().includes("hold") ? "badge-onhold" : (stateVal.toLowerCase().includes("progress") ? "badge-progress" : (stateVal.toLowerCase().includes("assign") ? "badge-assigned" : "badge-pending"));
          return `<tr style="border-bottom:1px solid #F1F5F9;">
            <td style="padding:8px 10px;font-family:monospace;font-weight:700;color:#2563EB;">${tid}</td>
            <td style="padding:8px 10px;"><span class="v3-tag">${st}</span></td>
            <td style="padding:8px 10px;max-width:260px;" title="${desc}">${desc}</td>
            <td style="padding:8px 10px;">${who}</td>
            <td style="padding:8px 10px;"><span class="status-badge ${badgeClass}">${stateVal}</span></td>
            <td style="padding:8px 10px;">${grp}</td>
            <td style="padding:8px 10px;color:#64748B;">${dateVal}</td>
          </tr>`;
        }).join("");
      })
      .catch((e) => {
        tb.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:16px;color:#EF4444;">Gagal memuat tiket manual: ${esc(e.message)}</td></tr>`;
      });
  }

  function initManualView() {
    loadManualTickets();
    const dtInput = $("manCreatedDate");
    if (dtInput && !dtInput.value) {
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      dtInput.value = now.toISOString().slice(0, 16);
    }
    if (manualInitialized) return;
    manualInitialized = true;

    // Tab switcher
    $("tabBtnManualSingle") && $("tabBtnManualSingle").addEventListener("click", () => {
      $("tabBtnManualSingle").classList.add("active");
      $("tabBtnManualBatch").classList.remove("active");
      $("panelManualSingle").hidden = false;
      $("panelManualBatch").hidden = true;
    });
    $("tabBtnManualBatch") && $("tabBtnManualBatch").addEventListener("click", () => {
      $("tabBtnManualBatch").classList.add("active");
      $("tabBtnManualSingle").classList.remove("active");
      $("panelManualBatch").hidden = false;
      $("panelManualSingle").hidden = true;
    });

    // Reset single
    $("btnResetManualSingle") && $("btnResetManualSingle").addEventListener("click", () => {
      $("formManualSingle") && $("formManualSingle").reset();
      const dt = $("manCreatedDate");
      if (dt) {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        dt.value = now.toISOString().slice(0, 16);
      }
    });

    // Reset batch
    $("btnResetManualBatch") && $("btnResetManualBatch").addEventListener("click", () => {
      if ($("manBatchText")) $("manBatchText").value = "";
    });

    // Refresh list
    $("btnRefreshManualList") && $("btnRefreshManualList").addEventListener("click", loadManualTickets);

    // Save Single Ticket
    $("btnSaveManualSingle") && $("btnSaveManualSingle").addEventListener("click", () => {
      const tid = ($("manTicketId")?.value || "").trim();
      const desc = ($("manShortDesc")?.value || "").trim();
      if (!tid) {
        showManualAlert("Nomor Tiket wajib diisi. Contoh: REQ-KMF-092026-009999", true);
        $("manTicketId")?.focus();
        return;
      }
      if (!desc) {
        showManualAlert("Uraian / Deskripsi tiket wajib diisi.", true);
        $("manShortDesc")?.focus();
        return;
      }
      const payload = {
        ticketId: tid,
        serviceType: $("manServiceType")?.value || "Request",
        requestState: $("manRequestState")?.value || "In Progress",
        priority: $("manPriority")?.value || "Minor",
        requestedFor: ($("manRequestedFor")?.value || "").trim(),
        location: ($("manLocation")?.value || "").trim() || "-",
        assignmentGroup: ($("manAssignmentGroup")?.value || "").trim() || "EOS L1",
        createdDate: ($("manCreatedDate")?.value || "").replace("T", " ") || undefined,
        shortDesc: desc
      };

      const btn = $("btnSaveManualSingle");
      if (btn) btn.disabled = true;
      fetch("/api/manual_ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
      .then((r) => r.json())
      .then((res) => {
        if (btn) btn.disabled = false;
        if (res.status === "success") {
          showManualAlert(res.message || "Tiket berhasil disimpan ke database Sentinel!", false);
          $("formManualSingle") && $("formManualSingle").reset();
          const dt = $("manCreatedDate");
          if (dt) {
            const now = new Date();
            now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
            dt.value = now.toISOString().slice(0, 16);
          }
          loadManualTickets();
          loadStats(true);
          if (typeof fetchSnapshot === "function") fetchSnapshot();
        } else {
          showManualAlert(res.message || "Gagal menyimpan tiket", true);
        }
      })
      .catch((err) => {
        if (btn) btn.disabled = false;
        showManualAlert("Terjadi kesalahan jaringan: " + err.message, true);
      });
    });

    // Save Batch Tickets
    $("btnSaveManualBatch") && $("btnSaveManualBatch").addEventListener("click", () => {
      const rawText = ($("manBatchText")?.value || "").trim();
      if (!rawText) {
        showManualAlert("Silakan tempel baris tiket terlebih dahulu.", true);
        $("manBatchText")?.focus();
        return;
      }

      const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
      const tickets = [];
      for (const line of lines) {
        const sep = line.includes("\t") ? "\t" : "|";
        const parts = line.split(sep).map((p) => p.trim());
        if (!parts[0]) continue;
        const tid = parts[0];
        const desc = parts[1] || `Tiket manual ${tid}`;
        const who = parts[2] || "";
        const stateVal = parts[3] || "In Progress";
        const dateVal = parts[4] || "";
        const loc = parts[5] || "-";
        const grp = parts[6] || "EOS L1";
        const prio = parts[7] || "Minor";
        const srvType = tid.toUpperCase().startsWith("INC") ? "Insiden" : "Request";

        tickets.push({
          ticketId: tid,
          shortDesc: desc,
          requestedFor: who,
          requestState: stateVal,
          createdDate: dateVal,
          location: loc,
          assignmentGroup: grp,
          priority: prio,
          serviceType: srvType
        });
      }

      if (!tickets.length) {
        showManualAlert("Tidak ada format tiket yang dapat diproses dari teks.", true);
        return;
      }

      const btn = $("btnSaveManualBatch");
      if (btn) btn.disabled = true;
      fetch("/api/manual_tickets_batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickets: tickets })
      })
      .then((r) => r.json())
      .then((res) => {
        if (btn) btn.disabled = false;
        if (res.status === "success") {
          showManualAlert(res.message || `Berhasil menyimpan ${res.saved_count} tiket ke Sentinel!`, false);
          if ($("manBatchText")) $("manBatchText").value = "";
          loadManualTickets();
          loadStats(true);
          if (typeof fetchSnapshot === "function") fetchSnapshot();
        } else {
          showManualAlert(res.message || "Gagal memproses batch tiket", true);
        }
      })
      .catch((err) => {
        if (btn) btn.disabled = false;
        showManualAlert("Terjadi kesalahan jaringan: " + err.message, true);
      });
    });
  }

  // ------------------------------------------------------------------ inisialisasi
  window.V3 = V3;
  if (store.get("gc1_sb_min", "0") === "1") setSidebarMin(true);
  if (store.get("gc1_sb_monitor", "1") === "0") { $("sbMonitor").classList.remove("open"); $("sbMonitorToggle").setAttribute("aria-expanded", "false"); }
  const r0 = store.get("gc1_range", "day");
  V3.range = ["day", "week", "month"].includes(r0) ? r0 : "day";
  document.querySelectorAll("[data-range-switch] button").forEach((x) => x.classList.toggle("active", x.dataset.range === V3.range));
  renderItsmMenu();
  showView(store.get("gc1_view", "overview"), store.get("gc1_list", "") || null);
  setInterval(() => loadStats(false), 15000);
})();
