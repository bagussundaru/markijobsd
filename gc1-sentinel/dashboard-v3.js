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

  // ---- submenu ITSM: menu tetap profesional (Semua, Request, Insiden)
  function renderItsmMenu() {
    const box = $("sbItsmItems");
    if (!box) return;
    const items = [
      { key: "", label: "ITSM · Semua", icon: "🗂️", title: "Semua Tiket ITSM" },
      { key: "request", label: "Tiket Request", icon: "📋", title: "Daftar Tiket Request (Permohonan)" },
      { key: "incident", label: "Tiket Insiden", icon: "⚡", title: "Daftar Tiket Insiden (Gangguan)" }
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

  // ------------------------------------------------------------------ KPI (Aivora Modern Layout)
  function kpi(cls, label, val, unit, sub, go, icon, badgeText, badgeCls) {
    return `<div class="v3-kpi ${cls}${go ? " link" : ""}" ${go ? `data-go="${esc(go)}"` : ""}>
      <div class="k-top">
        <div class="k-icon-box ${badgeCls || ""}">${icon || "📊"}</div>
        ${badgeText ? `<span class="k-pill ${badgeCls || ""}">${esc(badgeText)}</span>` : ""}
      </div>
      <div class="k-val">${esc(val)}${unit ? `<small>${esc(unit)}</small>` : ""}</div>
      <div class="k-label">${esc(label)}</div>
      <div class="k-sub">${esc(sub || "")}</div>
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

  function snapKpis(s) {
    const all = s.all_tickets || [];
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
    return { itsm, wa, itsmOpen, waOpen, waiting, late, st,
      assigned: itsm.filter((t) => st(t).includes("assign")).length,
      pending: itsm.filter((t) => st(t).includes("pending")).length,
      progress: itsm.filter((t) => st(t).includes("progress")).length,
      on_hold: itsm.filter((t) => st(t).includes("hold")).length };
  }

  function renderItsmKpis(s) {
    const k = snapKpis(s);
    const h = s.sla_health_percent ?? 100;
    $("itsmKpis").innerHTML =
      kpi("itsm link", "Assigned (Siap Ditangani)", k.assigned, "tiket", "Siap dieksekusi teknis tim GC 1", "tab:team_assigned", "📋", "🚨 Prioritas Tim", "badge-assigned") +
      kpi("warn link", "Pending Approval", k.pending, "tiket", "Menunggu persetujuan tenan/K/L", "tab:team_pending", "⏳", "⏳ Verifikasi", "badge-pending") +
      kpi("violet link", "Sedang Dikerjakan (In Progress)", k.progress, "tiket", "Pengerjaan teknis L1/L2/L3", "tab:team_progress", "⚙️", "⚡ Proses Aktif", "badge-progress") +
      kpi("hold link", "On Hold (Tertunda)", k.on_hold, "tiket", "Menunggu tenan / pihak luar", "list:on_hold", "⏸️", "⏸️ On-Hold", "badge-onhold") +
      kpi(h >= 95 ? "ok" : h >= 80 ? "warn" : "danger", "Kepatuhan SLA (KAK 18.c)", h, "%", `Target resmi KAK: > 95%`, "list:sla", "🛡️", h >= 95 ? "✓ Target > 95%" : "⚠ Waspada", h >= 95 ? "badge-ok" : "badge-danger");
  }

  function renderWaKpis(s) {
    const k = snapKpis(s);
    const unver = k.waOpen.filter((t) => (t.identity || {}).status !== "verified").length;
    const unlinked = k.waOpen.filter((t) => !t.linkedPortalId).length;
    const avg = V3.stats ? V3.stats.wa_reply_avg_min : null;
    $("waKpis").innerHTML =
      kpi("wa link", "Pra-tiket WhatsApp Aktif", k.waOpen.length, "aduan", "Belum selesai / ditolak", "tab:all_tickets", "💬", "Aduan Baru", "badge-wa") +
      kpi(k.late.length ? "danger" : k.waiting.length ? "warn" : "ok", "Menunggu Balasan", k.waiting.length, "aduan", k.late.length ? `${k.late.length} lewat target` : "Semua dalam target", "tab:all_tickets", "⏳", k.late.length ? "Lewat Target" : "Tepat Waktu", k.late.length ? "badge-danger" : "badge-ok") +
      kpi("itsm", "Rata-rata Waktu Respon", num(avg), avg === null || avg === undefined ? "" : "menit", "Target internal 5-10 menit", null, "⚡", "Kecepatan", "badge-assigned") +
      kpi("warn", "Belum Ada Tiket ITSM", unlinked, "aduan", "Perlu dibuatkan tiket resmi", "list:unlinked", "⚠️", "Menunggu Tiket", "badge-pending");
  }

  function renderOverviewKpis(s) {
    const st = V3.stats;
    const kk = st ? st.kpi : null;
    if (!kk) { $("ovKpis").innerHTML = ""; return; }
    const h = st.sla.health_pct;
    const k = snapKpis(s);
    const assignedCount = k.assigned || kk.itsm_assigned || 0;
    const pendingCount = k.pending || kk.itsm_pending || 0;
    const onHoldCount = k.on_hold || kk.itsm_on_hold || 0;
    const progressCount = k.progress || Math.max(0, (kk.itsm_open || 0) - assignedCount - pendingCount - onHoldCount);

    $("ovKpis").innerHTML =
      kpi("itsm link", "Assigned (Siap Ditangani)", assignedCount, "tiket", "Siap dieksekusi teknis tim GC 1", "tab:team_assigned", "📋", "🚨 Prioritas Tim", "badge-assigned") +
      kpi("warn link", "Pending Approval", pendingCount, "tiket", "Menunggu persetujuan tenan/K/L", "tab:team_pending", "⏳", "⏳ Verifikasi", "badge-pending") +
      kpi("violet link", "Sedang Dikerjakan (In Progress)", progressCount, "tiket", "Pengerjaan teknis L1/L2/L3", "tab:team_progress", "⚙️", "⚡ Proses Aktif", "badge-progress") +
      kpi("hold link", "On Hold (Tertunda)", onHoldCount, "tiket", "Menunggu tenan / vendor / pihak luar", "list:on_hold", "⏸️", "⏸️ On-Hold", "badge-onhold") +
      kpi(h >= 95 ? "ok" : h >= 80 ? "warn" : "danger", "Kepatuhan SLA (KAK 18.c)", h, "%", `${st.sla.breached || 0} tiket lewat SLA · target > 95%`, "view:itsm", "🛡️", h >= 95 ? "✓ Target > 95%" : "⚠ Waspada", h >= 95 ? "badge-ok" : "badge-danger");

    // Update 4 Metric Strip in Left Card (Aivora Style)
    const stSnap = getState().snapshot;
    const allTickets = (stSnap && stSnap.all_tickets) || (s.all_tickets) || [];
    const totalCount = allTickets.length || (kk.itsm_open || 40);
    const activeCount = kk.itsm_open || (assignedCount + pendingCount + progressCount + onHoldCount);
    const resolvedCount = Math.max(0, totalCount - activeCount);
    if ($("stripTotal")) $("stripTotal").textContent = `${totalCount} Tiket`;
    if ($("stripActive")) $("stripActive").textContent = `${activeCount} Tiket`;
    if ($("stripResolved")) $("stripResolved").textContent = `${resolvedCount} Tiket`;
    if ($("stripWa")) $("stripWa").textContent = `${kk.wa_active || 0} Pra-Tiket`;
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
