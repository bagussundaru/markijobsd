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
  };
  const V3 = { view: "overview", range: "day", stats: null, lastStats: 0, itsmList: null, lists: [{ key: "request", label: "Request" }, { key: "assign", label: "Assign" }] };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  };
  const num = (v) => (v === null || v === undefined ? "-" : v);

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

  // ---- submenu ITSM: satu item per menu/daftar ITSM (Request, Assign, ...), sesuai config itsm_lists
  function renderItsmMenu() {
    const box = $("sbItsmItems");
    if (!box) return;
    const items = [{ key: "", label: "Semua" }].concat(V3.lists);
    box.innerHTML = items.map((l) => `<button class="sb-item" data-view="itsm" data-list="${esc(l.key)}" title="Tiket ITSM: ${esc(l.label)}"><span class="ic">${l.key ? "🏛️" : "🗂️"}</span><span class="tx">ITSM · ${esc(l.label)}</span><span class="sb-pill" data-pill-list="${esc(l.key)}">0</span></button>`).join("");
    markActive();
  }
  function markActive() {
    document.querySelectorAll(".sb-item[data-view]").forEach((b) => {
      const on = b.dataset.view === V3.view && (b.dataset.view !== "itsm" || (b.dataset.list || "") === (V3.itsmList || ""));
      b.classList.toggle("active", on);
    });
  }
  function listLabel(key) { const l = V3.lists.find((x) => x.key === key); return l ? l.label : key; }
  function setLists(arr) {
    if (!Array.isArray(arr) || !arr.length) return;
    const next = arr.filter((l) => !l.legacy).map((l) => ({ key: l.key, label: l.label }));   // daftar format lama bukan menu
    if (JSON.stringify(next) !== JSON.stringify(V3.lists)) { V3.lists = next; renderItsmMenu(); }
  }

  // ------------------------------------------------------------------ tampilan
  function showView(v, list) {
    if (!VIEWS[v]) v = "overview";
    if (v === "itsm") V3.itsmList = list || null;
    if (v === "quick" && state.role === "team") v = "overview";
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
    if (v === "itsm" || v === "wa") {
      $(v === "itsm" ? "slotItsm" : "slotWa").appendChild(tb);
      tb.hidden = false;
      tb.dataset.view = v;
      const valid = v === "itsm" ? ["team_assigned", "team_pending", "team_progress", "all_tickets"] : ["all_tickets", "wa_alerts"];
      const allLabel = $("tabBtnAll") && $("tabBtnAll").querySelector(".tab-text");
      if (allLabel) allLabel.textContent = v === "itsm" ? "Semua Tiket ITSM" : "Semua Pra-tiket WhatsApp";
      const waLabel = $("tabBtnWa") && $("tabBtnWa").querySelector(".tab-text");
      if (waLabel) waLabel.textContent = "Feed Pesan WhatsApp";
      if (!valid.includes(state.activeTab)) switchTab(v === "itsm" ? "team_assigned" : "all_tickets");
      else switchTab(state.activeTab);
      if (v === "wa" && state.activeTab === "all_tickets") {
        if ($("currentCategoryTitle")) $("currentCategoryTitle").innerHTML = "<span>💬</span> Pra-tiket WhatsApp";
        if ($("currentCategoryDesc")) $("currentCategoryDesc").textContent = "Aduan dari grup WhatsApp. SLA resmi baru berjalan setelah tiket dibuat di ITSM.";
      }
    } else {
      tb.hidden = true;
    }
    store.set("gc1_view", v);
    store.set("gc1_list", V3.itsmList || "");
    if (state.snapshot) onSnapshot(state.snapshot, true);
    loadStats(true);
    if (v === "quick") setTimeout(() => $("mwText") && $("mwText").focus(), 50);
    window.scrollTo({ top: 0 });
  }
  V3.showView = showView;

  V3.filterBySource = function (list) {
    if (V3.view === "itsm") return list.filter((t) => !t.isFromWa && (!V3.itsmList || (t.itsmLists || []).includes(V3.itsmList)));
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

  // ------------------------------------------------------------------ KPI
  function kpi(cls, label, val, unit, sub, go) {
    return `<div class="v3-kpi ${cls}${go ? " link" : ""}" ${go ? `data-go="${esc(go)}"` : ""}>
      <div class="k-label">${esc(label)}</div><div class="k-val">${esc(val)}${unit ? `<small>${esc(unit)}</small>` : ""}</div><div class="k-sub">${esc(sub || "")}</div></div>`;
  }
  document.addEventListener("click", (e) => {
    const k = e.target.closest(".v3-kpi[data-go]");
    if (!k) return;
    const [kind, arg] = k.dataset.go.split(":");
    if (kind === "view") showView(arg);
    else if (kind === "tab") switchTab(arg);
    else if (kind === "pic") { const b = $("btnPic"); if (b) b.click(); }
  });

  function snapKpis(s) {
    const all = s.all_tickets || [];
    const st = (t) => (t.requestState || "").toLowerCase();
    const itsm = all.filter((t) => !t.isFromWa && (V3.view !== "itsm" || !V3.itsmList || (t.itsmLists || []).includes(V3.itsmList)));
    const wa = all.filter((t) => t.isFromWa);
    const open = (l) => l.filter((t) => !t.slaClosed);
    const itsmOpen = open(itsm), waOpen = open(wa);
    const waiting = waOpen.filter((t) => t.responseStatus !== "ok");
    const late = waiting.filter((t) => t.responseStatus === "late");
    return { itsm, wa, itsmOpen, waOpen, waiting, late, st,
      assigned: itsm.filter((t) => st(t).includes("assign")).length,
      pending: itsm.filter((t) => st(t).includes("pending")).length,
      progress: itsm.filter((t) => st(t).includes("progress")).length };
  }

  function renderItsmKpis(s) {
    const k = snapKpis(s);
    const h = s.sla_health_percent ?? 100;
    $("itsmKpis").innerHTML =
      kpi("itsm link", "Assigned", k.assigned, "tiket", "siap ditangani tim", "tab:team_assigned") +
      kpi("warn link", "Pending Approval", k.pending, "tiket", "menunggu persetujuan tenan/K/L", "tab:team_pending") +
      kpi("violet link", "In Progress", k.progress, "tiket", "sedang dikerjakan L1/L2/L3", "tab:team_progress") +
      kpi(h >= 95 ? "ok" : h >= 80 ? "warn" : "danger", "Kepatuhan SLA", h, "%", `tiket aktif dalam SLA · target > 95%`) +
      kpi("itsm link", "Total ITSM", k.itsm.length, "tiket", `${k.itsmOpen.length} masih aktif`, "tab:all_tickets");
  }

  function renderWaKpis(s) {
    const k = snapKpis(s);
    const unver = k.waOpen.filter((t) => (t.identity || {}).status !== "verified").length;
    const unlinked = k.waOpen.filter((t) => !t.linkedPortalId).length;
    const avg = V3.stats ? V3.stats.wa_reply_avg_min : null;
    $("waKpis").innerHTML =
      kpi("wa link", "Pra-tiket aktif", k.waOpen.length, "aduan", "belum selesai / ditolak", "tab:all_tickets") +
      kpi(k.late.length ? "danger" : k.waiting.length ? "warn" : "ok", "Menunggu balasan", k.waiting.length, "aduan", k.late.length ? `${k.late.length} lewat target balasan` : "dalam target", "tab:all_tickets") +
      kpi("wa", "Rata-rata balasan", num(avg), avg === null || avg === undefined ? "" : "menit", "pada periode terpilih") +
      kpi("warn", "Belum ber-tiket ITSM", unlinked, "aduan", "minta pelapor membuka tiket di ITSM") +
      kpi("violet link", "Pelapor belum terverifikasi", unver, "aduan", "nomor baru atau belum dicatat", "pic:open");
  }

  function renderOverviewKpis(s) {
    const st = V3.stats;
    const kk = st ? st.kpi : null;
    if (!kk) { $("ovKpis").innerHTML = ""; return; }
    const h = st.sla.health_pct;
    const tgt = st.sla.wa_reply_target_min || 10;
    $("ovKpis").innerHTML =
      kpi("itsm link", "Tiket ITSM aktif", kk.itsm_open, "tiket", Object.entries(kk.itsm_by_list || {}).filter(([k, n]) => n > 0 && V3.lists.some((l) => l.key === k)).map(([k, n]) => `${n} ${listLabel(k)}`).join(" · ") || `${kk.itsm_assigned} Assigned · ${kk.itsm_pending} Pending`, "view:itsm") +
      kpi("wa link", "Aduan WhatsApp aktif", kk.wa_active, "aduan", `${kk.wa_unlinked} belum ber-tiket ITSM`, "view:wa") +
      kpi(kk.wa_late ? "danger" : kk.wa_waiting ? "warn" : "ok", "Menunggu balasan WA", kk.wa_waiting, "aduan", kk.wa_late ? `${kk.wa_late} lewat ${tgt} menit` : `semua dalam ${tgt} menit`, "view:wa") +
      kpi(h >= 95 ? "ok" : h >= 80 ? "warn" : "danger", "Kepatuhan SLA ITSM", h, "%", `${st.sla.breached} tiket lewat SLA · target > 95%`, "view:itsm") +
      kpi(kk.attention ? "danger" : "ok", "Perlu perhatian", kk.attention, "tiket", "memiliki penanda eskalasi") +
      kpi("violet link", "Pelapor belum terverifikasi", kk.wa_unverified, "aduan", "nomor baru atau belum dicatat", "pic:open");
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
      renderOverviewKpis(state.snapshot || {});
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
      renderWaKpis(state.snapshot || {});
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

  function renderSyncInfo(lists) {
    const box = $("itsmSyncInfo");
    if (!box || !Array.isArray(lists)) return;
    box.innerHTML = lists.map((l) => {
      if (l.legacy) return l.count ? `<span class="chip off" title="Dibaca ekstensi versi lama tanpa nama halaman">Ekstensi versi lama masih membaca ${l.count} tiket tanpa nama menu: muat ulang ekstensi di Chrome</span>` : "";
      if (l.synced_at === null || l.synced_at === undefined) return `<span class="chip off" title="Halaman ini belum pernah dibaca ekstensi">${esc(l.label)}: belum dibaca. Buka menu ${esc(l.label)} di ITSM</span>`;
      const mins = Math.round((l.age_sec || 0) / 60);
      const stale = (l.age_sec || 0) > 900;
      return `<span class="chip ${stale ? "stale" : ""}" title="${esc(l.title || "")}">${esc(l.label)}: ${l.count} tiket · sinkron ${mins < 1 ? "baru saja" : mins + " menit lalu"}</span>`;
    }).join("");
  }

  V3.onSnapshot = onSnapshot;
  function onSnapshot(data, immediate) {
    const k = snapKpis(data);
    setLists(data.itsm_lists);
    const pillW = $("sbPillWa");
    const itsmAll = (data.all_tickets || []).filter((t) => !t.isFromWa && !t.slaClosed);
    document.querySelectorAll("[data-pill-list]").forEach((p) => {
      const key = p.dataset.pillList;
      p.textContent = key ? itsmAll.filter((t) => (t.itsmLists || []).includes(key)).length : itsmAll.length;
    });
    if (pillW) { pillW.textContent = k.waOpen.length; pillW.classList.toggle("hot", k.late.length > 0); }
    renderSyncInfo(data.itsm_lists);
    if (V3.view === "itsm") renderItsmKpis(data);
    if (V3.view === "wa") renderWaKpis(data);
    const role = $("sbRole");
    if (role) role.innerHTML = `<b>Peran:</b> ${state.role === "team" ? "tampilan tim (hanya-baca)" : "operator"}`;
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
