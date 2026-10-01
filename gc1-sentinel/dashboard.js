/**
 * GC 1 Sentinel - Unified Incident Monitoring Dashboard
 * 100% Selaras dengan SOP Penanganan Tiket GC 1 v0.2 & Portal Helpdesk PDN
 * Telkom sepenuhnya dikecualikan dari ruang lingkup GC 1 Sentinel
 */

let state = {
  activeTab: "team_assigned", // "team_assigned", "team_pending", "team_progress", "wa_alerts", "all_tickets"
  snapshot: {
    total_helpdesk: 0,
    team_assigned_count: 0,
    team_pending_count: 0,
    team_progress_count: 0,
    sla_health_percent: 100,
    sla_safe_count: 0,
    telkom_count: 0,
    wa_count: 0,
    last_sync: "--:--:-- WIB",
    team_assigned: [],
    team_pending: [],
    team_progress: [],
    wa_alerts: [],
    all_tickets: []
  },
  alerts: [],
  searchQuery: "",
  filterStatus: "all",
  settings: {
    targetContact: "mimi Sandora",
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
    soundEnabled: true,
    soundVolume: 0.8,
    markijoAuto: true,
    serverPort: 8765
  }
};

// ----------------------------------------------------
// DOM REFERENCES
// ----------------------------------------------------
const clockDisplay = document.getElementById("clockDisplay");
const dateDisplay = document.getElementById("dateDisplay");
const liveStatusText = document.getElementById("liveStatusText");
const lastSyncTimeText = document.getElementById("lastSyncTimeText");
const toggleSoundBtn = document.getElementById("toggleSoundBtn");
const soundIcon = document.getElementById("soundIcon");
const soundStatusText = document.getElementById("soundStatusText");
const testSoundBtn = document.getElementById("testSoundBtn");
const btnForceSync = document.getElementById("btnForceSync");
const alertAudio = document.getElementById("alertAudio");

// 5 KPI Elements (SOP GC 1 v0.2)
const kpiGc1Assigned = document.getElementById("kpiGc1Assigned");
const kpiGc1Pending = document.getElementById("kpiGc1Pending");
const kpiTeamProgress = document.getElementById("kpiTeamProgress");
const kpiSlaHealth = document.getElementById("kpiSlaHealth");
const kpiTotalHelpdesk = document.getElementById("kpiTotalHelpdesk");

// 5 Tab Badges
const badgeGc1Assigned = document.getElementById("badgeGc1Assigned");
const badgeGc1Pending = document.getElementById("badgeGc1Pending");
const badgeTeamProgress = document.getElementById("badgeTeamProgress");
const badgeWa = document.getElementById("badgeWa");
const badgeAll = document.getElementById("badgeAll");

// 5 Tab Buttons
const tabBtnGc1Assigned = document.getElementById("tabBtnGc1Assigned");
const tabBtnGc1Pending = document.getElementById("tabBtnGc1Pending");
const tabBtnTeamProgress = document.getElementById("tabBtnTeamProgress");
const tabBtnWa = document.getElementById("tabBtnWa");
const tabBtnAll = document.getElementById("tabBtnAll");
const allTabBtns = [tabBtnGc1Assigned, tabBtnGc1Pending, tabBtnTeamProgress, tabBtnWa, tabBtnAll];

// Section Banner
const currentCategoryTitle = document.getElementById("currentCategoryTitle");
const currentCategoryDesc = document.getElementById("currentCategoryDesc");
const feedCountBadge = document.getElementById("feedCountBadge");
const btnQuickWaRecap = document.getElementById("btnQuickWaRecap");

// Table & Feed Views
const sentinelTable = document.getElementById("sentinelTable");
const sentinelTableBody = document.getElementById("sentinelTableBody");
const waFeedContainer = document.getElementById("waFeedContainer");
const emptyState = document.getElementById("emptyState");
const emptyTitle = document.getElementById("emptyTitle");
const emptyDesc = document.getElementById("emptyDesc");

// Controls
const searchInput = document.getElementById("searchInput");
const filterStateSelect = document.getElementById("filterStateSelect");
const toggleMarkijoBtn = document.getElementById("toggleMarkijoBtn");
const sendWaSummaryBtn = document.getElementById("sendWaSummaryBtn");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const btnClearData = document.getElementById("btnClearData");

// Settings Modal
const settingsModal = document.getElementById("settingsModal");
const openSettingsBtn = document.getElementById("openSettingsBtn");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const cancelSettingsBtn = document.getElementById("cancelSettingsBtn");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const settingWaGroups = document.getElementById("settingWaGroups");
const settingVerifiedSenders = document.getElementById("settingVerifiedSenders");
const settingKeywords = document.getElementById("settingKeywords");
const settingServerPort = document.getElementById("settingServerPort");
const settingMarkijoAuto = document.getElementById("settingMarkijoAuto");
const settingSound = document.getElementById("settingSound");

// WA Summary Modal
const waSummaryModal = document.getElementById("waSummaryModal");
const closeWaSummaryBtn = document.getElementById("closeWaSummaryBtn");
const doneWaSummaryBtn = document.getElementById("doneWaSummaryBtn");
const copyAgainBtn = document.getElementById("copyAgainBtn");
const goToWaBtn = document.getElementById("goToWaBtn");
const waSummaryPreview = document.getElementById("waSummaryPreview");

// Detail Aktivitas & Pelacakan SLA Tiket Modal (SOP GC 1 v0.2)
const ticketActivityModal = document.getElementById("ticketActivityModal");
const closeTicketActivityBtn = document.getElementById("closeTicketActivityBtn");
const modalTicketTitle = document.getElementById("modalTicketTitle");
const modalTicketSubtitle = document.getElementById("modalTicketSubtitle");
const modalStateBadge = document.getElementById("modalStateBadge");
const modalPicName = document.getElementById("modalPicName");
const modalPicRole = document.getElementById("modalPicRole");
const modalPriorityText = document.getElementById("modalPriorityText");
const modalTargetTime = document.getElementById("modalTargetTime");
const modalSlaRemaining = document.getElementById("modalSlaRemaining");
const modalSlaBar = document.getElementById("modalSlaBar");
const modalStepperContainer = document.getElementById("modalStepperContainer");
const modalDescText = document.getElementById("modalDescText");
const modalReqText = document.getElementById("modalReqText");
const modalLocText = document.getElementById("modalLocText");
const modalDateText = document.getElementById("modalDateText");
const modalMilestoneText = document.getElementById("modalMilestoneText");
const modalBtnCopyDetail = document.getElementById("modalBtnCopyDetail");
const modalBtnQuickWa = document.getElementById("modalBtnQuickWa");
const modalBtnClose = document.getElementById("modalBtnClose");

// ----------------------------------------------------
// CATEGORY METADATA (SESUAI SOP GC 1 v0.2 - BEBAS TELKOM)
// ----------------------------------------------------
const CATEGORY_META = {
  team_assigned: {
    title: "<span>🚨</span> Assigned Tim Kita (Helpdesk & EOS L1) - Siap Ditangani",
    desc: "Tiket internal tim kita yang berstatus Assigned. Helpdesk sebagai gerbang utama menugaskan ke EOS L1/L2/L3/NOC/SOC sesuai SOP Bab 5.",
    emptyTitle: "Tidak ada tiket Assigned tim kita saat ini",
    emptyDesc: "Bagus! Semua tiket Assigned tim kita telah ditangani atau belum ada permohonan baru."
  },
  team_pending: {
    title: "<span>⏳</span> Pending Approval Tenan / K/L (Pipeline Persetujuan)",
    desc: "Tiket yang masih dalam tahap persetujuan tenan K/L atau kelengkapan administrasi sebelum dialihkan ke tahap eksekusi teknis.",
    emptyTitle: "Tidak ada antrean pending untuk tim kita",
    emptyDesc: "Tidak ada tiket yang sedang menunggu persetujuan tenan saat ini."
  },
  team_progress: {
    title: "<span>⚙️</span> Sedang Dikerjakan (In Progress - Tim L1/L2/L3/NOC/SOC)",
    desc: "Tiket yang sedang dalam penanganan teknis aktif oleh teknisi tim kita sesuai Service Level Agreement (SLA).",
    emptyTitle: "Tidak ada tiket In Progress saat ini",
    emptyDesc: "Tidak ada tiket yang sedang dalam proses pengerjaan teknisi tim kita."
  },
  wa_alerts: {
    title: "<span>💬</span> Aduan WhatsApp Ops Masuk (Pra-Tiket / Koordinasi)",
    desc: "Pesan koordinasi operasional dari WhatsApp Web yang berkaitan dengan GC 1 atau koordinasi penanganan helpdesk.",
    emptyTitle: "Belum ada pesan aduan WhatsApp",
    emptyDesc: "Pesan WhatsApp yang menyebutkan GC 1 akan otomatis tercatat di sini saat WhatsApp Web terbuka."
  },
  all_tickets: {
    title: "<span>🌐</span> Semua Tiket Lingkup GC 1 (Helpdesk & EOS)",
    desc: "Tampilan lengkap seluruh tiket internal Government Cloud 1 secara 100% selaras dengan SOP Komdigi (Telkom di luar ruang lingkup).",
    emptyTitle: "Belum ada tiket internal GC 1",
    emptyDesc: "Data tiket internal akan disinkronkan secara otomatis dari portal Helpdesk."
  },
  // Backward compatibility alias
  gc1_assigned: {
    title: "<span>🚨</span> Assigned Tim Kita (Helpdesk & EOS L1)",
    desc: "Tiket internal tim kita yang berstatus Assigned.",
    emptyTitle: "Tidak ada tiket Assigned tim kita saat ini",
    emptyDesc: "Bagus! Semua tiket Assigned tim kita telah ditangani."
  },
  gc1_pending: {
    title: "<span>⏳</span> Pending Approval Tenan / K/L",
    desc: "Tiket yang masih dalam tahap persetujuan tenan K/L.",
    emptyTitle: "Tidak ada tiket Pending Approval",
    emptyDesc: "Tidak ada antrean pending approval saat ini."
  }
};

// ----------------------------------------------------
// AUDIO ALERT (Web Audio API Synthesizer + Fallback)
// ----------------------------------------------------
let audioCtx = null;
function playSynthesizedChime() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    const now = audioCtx.currentTime;

    // Tone 1: 880 Hz
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(880, now);
    gain1.gain.setValueAtTime(0.4, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(audioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Tone 2: 1320 Hz
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(1320, now + 0.12);
    gain2.gain.setValueAtTime(0.45, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    osc2.connect(gain2);
    gain2.connect(audioCtx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.55);
  } catch (_) {}
}

function playAlertSound() {
  if (!state.settings.soundEnabled) return;
  try {
    if (alertAudio) {
      alertAudio.currentTime = 0;
      alertAudio.volume = state.settings.soundVolume || 0.8;
      const playPromise = alertAudio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => playSynthesizedChime());
      }
    } else {
      playSynthesizedChime();
    }
  } catch (_) {
    playSynthesizedChime();
  }
}

// ----------------------------------------------------
// DIGITAL CLOCK & CALENDAR (ENTERPRISE)
// ----------------------------------------------------
function updateClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  if (clockDisplay) {
    clockDisplay.textContent = `${timeStr} WIB`;
  }
  if (dateDisplay) {
    const options = { weekday: "long", day: "numeric", month: "long", year: "numeric" };
    dateDisplay.textContent = now.toLocaleDateString("id-ID", options);
  }
}
setInterval(updateClock, 1000);
updateClock();

// ----------------------------------------------------
// SERVER & DELEGATED ACTIONS (tanpa inline onclick: teks dari WhatsApp tidak pernah menjadi kode)
// ----------------------------------------------------
const SERVER = "http://localhost:8765";

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-detail],[data-copy],[data-copytext],[data-recap]");
  if (!el) return;
  if (el.dataset.detail !== undefined) window.openTicketActivityDetail(el.dataset.detail);
  else if (el.dataset.recap !== undefined) window.quickSendTicketWa(el.dataset.recap);
  else if (el.dataset.copytext !== undefined) window.copyText(el.dataset.copytext, el);
  else if (el.dataset.copy !== undefined) window.copyText(el.dataset.copy, el);
});

async function postJson(path, body) {
  const res = await fetch(`${SERVER}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json().catch(() => ({}));
}

// ----------------------------------------------------
// CLIPBOARD COPY HELPER
// ----------------------------------------------------
window.copyText = function (text, btnEl) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text);
    } else {
      fallbackCopy(text);
    }
  } catch (_) {
    fallbackCopy(text);
  }

  if (btnEl && btnEl.textContent) {
    const orig = btnEl.textContent;
    btnEl.textContent = "✅";
    setTimeout(() => {
      btnEl.textContent = orig;
    }, 1500);
  }
};

function fallbackCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch (_) {}
}

window.copyTicketFull = function (ticketId) {
  const cleanId = (ticketId || "").split("\n")[0].replace(/📋/g, "").trim();
  const ticket = (state.snapshot.all_tickets || []).find((t) => {
    const tid = (t.ticketId || "").split("\n")[0].replace(/📋/g, "").trim();
    return tid === cleanId;
  });
  if (!ticket) return;

  const info = `🎫 *TIKET GC 1:* ${cleanId}\n` +
    `• *Uraian:* ${ticket.shortDesc}\n` +
    `• *Pemohon:* ${ticket.requestedFor} (${ticket.location || "-"})\n` +
    `• *Status:* ${ticket.requestState}\n` +
    `• *PIC Pelaksana:* ${ticket.picName || "Helpdesk"} (${ticket.picRole || "L0"})\n` +
    `• *Aktivitas Terkini:* ${ticket.activityMilestone || "-"}\n` +
    `• *Sisa SLA:* ${ticket.slaStatusText || "-"} (Target: ${ticket.slaTargetTime || "-"})\n` +
    `• *Waktu Pengajuan:* ${ticket.createdDate || "-"}`;

  window.copyText(info);
  alert(`Rincian tiket ${cleanId} berhasil disalin ke clipboard!`);
};

window.quickSendTicketWa = function (ticketId) {
  const cleanId = (ticketId || "").split("\n")[0].replace(/📋/g, "").trim();
  const ticket = (state.snapshot.all_tickets || []).find((t) => {
    const tid = (t.ticketId || "").split("\n")[0].replace(/📋/g, "").trim();
    return tid === cleanId;
  });
  if (!ticket) return;

  const text = `🚨 *TIKET PRIORITAS GC 1 ASSIGNED*\n\n` +
    `*Nomor Tiket:* \`${cleanId}\`\n` +
    `*Pemohon:* ${ticket.requestedFor} (${ticket.location || "-"})\n` +
    `*Uraian Permohonan:* ${ticket.shortDesc}\n` +
    `*Status:* Assigned (Siap Ditangani)\n` +
    `*PIC Pelaksana:* ${ticket.picName || "Helpdesk"} (${ticket.picRole || "L0 Gateway"})\n` +
    `*Aktivitas Terkini:* ${ticket.activityMilestone || "-"}\n` +
    `*Sisa SLA:* ${ticket.slaStatusText || "-"} (Target: ${ticket.slaTargetTime || "-"})\n` +
    `*Waktu Masuk:* ${ticket.createdDate || "-"}\n\n` +
    `_Ringkasan dari GC 1 Sentinel Monitor (salinan manual)._`;

  if (waSummaryPreview) {
    waSummaryPreview.value = text;
  }
  window.copyText(text);
  if (waSummaryModal) {
    waSummaryModal.classList.add("active");
  }
};

// ----------------------------------------------------
// DETAIL AKTIVITAS & PELACAKAN SLA TIKET MODAL
// ----------------------------------------------------
window.openTicketActivityDetail = function (ticketId) {
  const cleanId = (ticketId || "").split("\n")[0].replace(/📋/g, "").trim();
  const ticket = (state.snapshot.all_tickets || []).find((t) => {
    const tid = (t.ticketId || "").split("\n")[0].replace(/📋/g, "").trim();
    return tid === cleanId;
  });

  if (!ticket) {
    alert(`Tiket ${cleanId} tidak ditemukan.`);
    return;
  }

  const cleanState = (ticket.requestState || "Assigned").replace(/^●\s*/, "").trim();
  const isAssigned = cleanState.toLowerCase().includes("assign");
  const isPending = cleanState.toLowerCase().includes("pending");
  const isInProgress = cleanState.toLowerCase().includes("progress");

  let statusBadgeClass = "status-badge-pending";
  if (isAssigned) statusBadgeClass = "status-badge-assigned";
  else if (isInProgress) statusBadgeClass = "status-badge-progress";

  if (modalTicketTitle) modalTicketTitle.textContent = `Pelacakan Aktivitas Tiket: ${cleanId}`;
  if (modalTicketSubtitle) modalTicketSubtitle.textContent = `${ticket.shortDesc || "-"} • Lokasi: ${ticket.location || "Kominfo"}`;
  if (modalStateBadge) modalStateBadge.innerHTML = `<span class="${statusBadgeClass}">● ${escapeHtml(cleanState)}</span>`;
  if (modalPicName) modalPicName.textContent = `👤 ${ticket.picName || "Tim Helpdesk"}`;
  if (modalPicRole) modalPicRole.textContent = ticket.picRole || "L0 Gateway";
  if (modalPriorityText) modalPriorityText.textContent = `${ticket.priority || "Normal"} (Target SLA: ${ticket.slaLimitHours || 24} Jam)`;
  if (modalTargetTime) modalTargetTime.textContent = `Batas SLA: ${ticket.slaTargetTime || "-"}`;

  const slaBadgeClass = ticket.slaBadgeClass || "sla-safe";
  const slaText = ticket.slaStatusText || "Sisa 24j";
  if (modalSlaRemaining) {
    modalSlaRemaining.innerHTML = `<span class="sla-pill ${slaBadgeClass}" style="min-width:110px; font-size:12px;">⏱️ ${escapeHtml(slaText)}</span>`;
  }
  if (modalSlaBar) {
    modalSlaBar.style.width = `${ticket.slaPercentRemaining ?? 100}%`;
    modalSlaBar.style.background = slaBadgeClass === "sla-danger" ? "#EF4444" : (slaBadgeClass === "sla-warning" ? "#F59E0B" : "#10B981");
  }

  // 5-Stage Stepper
  if (modalStepperContainer) {
    const timeline = ticket.timeline || [];
    modalStepperContainer.innerHTML = timeline
      .map((st) => {
        const isCompleted = st.status === "completed";
        const isActive = st.status === "in_progress";
        let cardClass = "";
        let icon = st.step;
        if (isCompleted) {
          cardClass = "completed-step";
          icon = "✓";
        } else if (isActive) {
          cardClass = "active-step";
          icon = "▶";
        }
        return `
        <div class="step-card ${cardClass}">
          <div class="step-circle">${icon}</div>
          <div class="step-info">
            <div class="step-head">
              <span class="step-title">${st.step}. ${escapeHtml(st.title)}</span>
              <span class="step-actor">${escapeHtml(st.actor)}</span>
            </div>
            <div class="step-desc">${escapeHtml(st.desc)}</div>
            <div style="font-size:11px; color:#64748B; margin-top:3px;">⏱️ ${escapeHtml(st.time)}</div>
          </div>
        </div>
      `;
      })
      .join("");
  }

  renderTicketExtra(ticket);

  // Tenant Request Details
  if (modalDescText) modalDescText.textContent = ticket.shortDesc || "-";
  if (modalReqText) modalReqText.textContent = ticket.requestedFor || "-";
  if (modalLocText) modalLocText.textContent = ticket.location || "-";
  if (modalDateText) modalDateText.textContent = ticket.createdDate || "-";
  if (modalMilestoneText) modalMilestoneText.textContent = ticket.activityMilestone || "-";

  // Modal Actions
  if (modalBtnCopyDetail) {
    modalBtnCopyDetail.onclick = () => {
      const info = `🎫 *RINCIAN TIKET GC 1:* ${cleanId}\n` +
        `• *Uraian:* ${ticket.shortDesc}\n` +
        `• *Pemohon:* ${ticket.requestedFor} (${ticket.location || "-"})\n` +
        `• *Status:* ${cleanState}\n` +
        `• *PIC Pelaksana:* ${ticket.picName || "Helpdesk"} (${ticket.picRole || "L0"})\n` +
        `• *Aktivitas Terkini:* ${ticket.activityMilestone || "-"}\n` +
        `• *Sisa SLA:* ${ticket.slaStatusText || "-"} (Target: ${ticket.slaTargetTime || "-"})\n` +
        `• *Waktu Pengajuan:* ${ticket.createdDate || "-"}`;
      window.copyText(info);
      alert(`Rincian aktivitas tiket ${cleanId} berhasil disalin!`);
    };
  }

  if (modalBtnQuickWa) {
    if (isAssigned) {
      modalBtnQuickWa.style.display = "inline-flex";
      modalBtnQuickWa.onclick = () => {
        ticketActivityModal?.classList.remove("active");
        quickSendTicketWa(cleanId);
      };
    } else {
      modalBtnQuickWa.style.display = "none";
    }
  }

  ticketActivityModal?.classList.add("active");
};

// Modal Close Listeners
closeTicketActivityBtn?.addEventListener("click", () => {
  ticketActivityModal?.classList.remove("active");
});
modalBtnClose?.addEventListener("click", () => {
  ticketActivityModal?.classList.remove("active");
});
ticketActivityModal?.addEventListener("click", (e) => {
  if (e.target === ticketActivityModal) {
    ticketActivityModal.classList.remove("active");
  }
});

// ----------------------------------------------------
// DATA FETCHING & SYNCHRONIZATION
// ----------------------------------------------------
let lastKnownAssignedCount = -1;
let lastKnownEscalationCount = -1;

async function fetchHelpdeskSnapshot() {
  try {
    const res = await fetch(`http://localhost:8765/api/helpdesk_snapshot?t=${Date.now()}`);
    if (!res.ok) return;

    const data = await res.json();
    state.snapshot = data;

    const currentAssigned = data.team_assigned_count ?? data.gc1_assigned_count ?? 0;
    // Check if new Assigned ticket arrived -> chime alarm!
    if (lastKnownAssignedCount !== -1 && currentAssigned > lastKnownAssignedCount) {
      playAlertSound();
    }
    lastKnownAssignedCount = currentAssigned;

    const escCount = data.escalation_count ?? 0;
    if (lastKnownEscalationCount !== -1 && escCount > lastKnownEscalationCount) {
      playAlertSound();
    }
    lastKnownEscalationCount = escCount;
    state.settings.waGroups = data.wa_monitored_groups || [];

    updateKpiCards();
    updateTabBadges();
    renderActiveTab();
    renderBanners(data);

    if (liveStatusText) {
      liveStatusText.textContent = "100% SELARAS HELPDESK";
    }
    if (lastSyncTimeText) {
      lastSyncTimeText.textContent = data.last_sync || new Date().toLocaleTimeString("id-ID") + " WIB";
    }
  } catch (e) {
    if (liveStatusText) {
      liveStatusText.textContent = "OFFLINE (CEK SERVER)";
    }
  }
}

function updateKpiCards() {
  const s = state.snapshot;
  if (kpiGc1Assigned) kpiGc1Assigned.textContent = s.team_assigned_count ?? s.gc1_assigned_count ?? 0;
  if (kpiGc1Pending) kpiGc1Pending.textContent = s.team_pending_count ?? s.gc1_pending_count ?? 0;
  if (kpiTeamProgress) kpiTeamProgress.textContent = s.team_progress_count ?? 0;
  if (kpiSlaHealth) kpiSlaHealth.textContent = `${s.sla_health_percent ?? 100}%`;
  if (kpiTotalHelpdesk) kpiTotalHelpdesk.textContent = s.total_helpdesk ?? 0;
}

function updateTabBadges() {
  const s = state.snapshot;
  if (badgeGc1Assigned) badgeGc1Assigned.textContent = s.team_assigned_count ?? s.gc1_assigned_count ?? 0;
  if (badgeGc1Pending) badgeGc1Pending.textContent = s.team_pending_count ?? s.gc1_pending_count ?? 0;
  if (badgeTeamProgress) badgeTeamProgress.textContent = s.team_progress_count ?? 0;
  if (badgeWa) badgeWa.textContent = s.wa_count ?? 0;
  if (badgeAll) badgeAll.textContent = s.total_helpdesk ?? 0;
}

// ----------------------------------------------------
// TAB SWITCHING LOGIC
// ----------------------------------------------------
function switchTab(targetCategory) {
  state.activeTab = targetCategory;

  allTabBtns.forEach((btn) => {
    if (btn && btn.getAttribute("data-target") === targetCategory) {
      btn.classList.add("active");
    } else if (btn) {
      btn.classList.remove("active");
    }
  });

  const meta = CATEGORY_META[targetCategory] || CATEGORY_META.team_assigned || CATEGORY_META.gc1_assigned;
  if (currentCategoryTitle) currentCategoryTitle.innerHTML = meta.title;
  if (currentCategoryDesc) currentCategoryDesc.textContent = meta.desc;

  if (btnQuickWaRecap) {
    const isAssigned = (targetCategory === "team_assigned" || targetCategory === "gc1_assigned");
    const count = (state.snapshot.team_assigned_count ?? state.snapshot.gc1_assigned_count ?? 0);
    if (isAssigned && count > 0) {
      btnQuickWaRecap.style.display = "inline-flex";
    } else {
      btnQuickWaRecap.style.display = "none";
    }
  }

  renderActiveTab();
}

allTabBtns.forEach((btn) => {
  btn?.addEventListener("click", () => {
    const target = btn.getAttribute("data-target");
    if (target) switchTab(target);
  });
});

// KPI Cards also trigger tab switch on click
document.getElementById("cardGc1Assigned")?.addEventListener("click", () => switchTab("team_assigned"));
document.getElementById("cardGc1Pending")?.addEventListener("click", () => switchTab("team_pending"));
document.getElementById("cardTeamProgress")?.addEventListener("click", () => switchTab("team_progress"));
document.getElementById("cardSlaHealth")?.addEventListener("click", () => switchTab("all_tickets"));
document.getElementById("cardTotalHelpdesk")?.addEventListener("click", () => switchTab("all_tickets"));

// Helper: Resolver Layer Styling
function getResolverClass(layer) {
  const l = (layer || "").toLowerCase();
  if (l.includes("eos l1")) return "resolver-eos-l1";
  if (l.includes("eos l2")) return "resolver-eos-l2";
  if (l.includes("eos l3")) return "resolver-eos-l3";
  if (l.includes("noc")) return "resolver-noc";
  if (l.includes("soc")) return "resolver-soc";
  return "resolver-helpdesk";
}

// ----------------------------------------------------
// RENDER CONTENT: TABLE & FEEDS
// ----------------------------------------------------
function renderActiveTab() {
  const query = state.searchQuery.toLowerCase().trim();
  const filterState = state.filterStatus;

  if (state.activeTab === "wa_alerts") {
    // Render WhatsApp Feed
    if (sentinelTable) sentinelTable.style.display = "none";
    if (waFeedContainer) waFeedContainer.style.display = "flex";

    let waList = state.snapshot.wa_alerts || [];
    if (query) {
      waList = waList.filter(
        (a) =>
          (a.sender || "").toLowerCase().includes(query) ||
          (a.text || "").toLowerCase().includes(query) ||
          (a.group || "").toLowerCase().includes(query)
      );
    }

    if (feedCountBadge) {
      feedCountBadge.textContent = `Menampilkan ${waList.length} chat WhatsApp`;
    }

    if (waList.length === 0) {
      if (emptyState) emptyState.style.display = "block";
      if (emptyTitle) emptyTitle.textContent = CATEGORY_META.wa_alerts.emptyTitle;
      if (emptyDesc) emptyDesc.textContent = CATEGORY_META.wa_alerts.emptyDesc;
      if (waFeedContainer) waFeedContainer.innerHTML = "";
      return;
    }

    if (emptyState) emptyState.style.display = "none";
    renderWhatsAppFeed(waList);
    return;
  }

  // Render Table View (Helpdesk Categories)
  if (waFeedContainer) waFeedContainer.style.display = "none";
  if (sentinelTable) sentinelTable.style.display = "table";

  let list = [];
  if (state.activeTab === "team_assigned" || state.activeTab === "gc1_assigned") {
    list = state.snapshot.team_assigned || state.snapshot.gc1_assigned || [];
  } else if (state.activeTab === "team_pending" || state.activeTab === "gc1_pending") {
    list = state.snapshot.team_pending || state.snapshot.gc1_pending || [];
  } else if (state.activeTab === "team_progress") {
    list = state.snapshot.team_progress || [];
  } else if (state.activeTab === "all_tickets") {
    list = state.snapshot.all_tickets || [];
  }

  // Exclude Telkom completely from list
  list = list.filter((t) => !t.isTelkom && !((t.assignmentGroup || "") + " " + (t.shortDesc || "")).toLowerCase().includes("telkom"));

  // Apply Search
  if (query) {
    list = list.filter((t) => {
      const full = `${t.ticketId} ${t.shortDesc} ${t.requestedFor} ${t.location} ${t.assignmentGroup} ${t.resolverLayer || ""} ${t.picName || ""}`.toLowerCase();
      return full.includes(query);
    });
  }

  // Apply State Filter
  if (filterState !== "all") {
    list = list.filter((t) => (t.requestState || "").toLowerCase() === filterState.toLowerCase());
  }

  // Strict Primary Key Deduplication
  const uniqueTicketsMap = new Map();
  for (const t of list) {
    const rawId = (t.ticketId || "").split("\n")[0].replace(/📋/g, "").trim();
    if (rawId && !uniqueTicketsMap.has(rawId)) {
      uniqueTicketsMap.set(rawId, t);
    }
  }
  list = Array.from(uniqueTicketsMap.values());

  if (feedCountBadge) {
    feedCountBadge.textContent = `Menampilkan ${list.length} tiket`;
  }

  if (list.length === 0) {
    if (sentinelTableBody) sentinelTableBody.innerHTML = "";
    if (emptyState) emptyState.style.display = "block";
    const meta = CATEGORY_META[state.activeTab] || CATEGORY_META.team_assigned || CATEGORY_META.gc1_assigned;
    if (emptyTitle) emptyTitle.textContent = meta.emptyTitle;
    if (emptyDesc) emptyDesc.textContent = meta.emptyDesc;
    return;
  }

  if (emptyState) emptyState.style.display = "none";
  renderHelpdeskTable(list);
}

function renderHelpdeskTable(tickets) {
  if (!sentinelTableBody) return;

  const rowsHtml = tickets
    .map((t) => {
      const cleanId = (t.ticketId || "").split("\n")[0].replace(/📋/g, "").trim();
      let rawDesc = (t.shortDesc || "").trim();
      rawDesc = rawDesc.replace(/^\[(GC\s*1|Government\s*Cloud\s*1)\]\s*/i, "").trim();
      const cleanReq = (t.requestedFor || "-").split("\n")[0].trim();
      const cleanLoc = (t.location || "Kominfo").replace(/📍/g, "").replace(/\(📲\s*WA\)/gi, "").trim();
      const cleanGroup = (t.assignmentGroup || "Helpdesk").trim();
      const resolverLayer = t.resolverLayer || cleanGroup;
      const resolverClass = getResolverClass(resolverLayer);
      const cleanState = (t.requestState || "Assigned").replace(/^●\s*/, "").trim();

      const isAssigned = cleanState.toLowerCase().includes("assign");
      const isPending = cleanState.toLowerCase().includes("pending");
      const isInProgress = cleanState.toLowerCase().includes("progress");

      let rowClass = "";
      if (isAssigned) rowClass = "urgent-row";
      else if (isPending) rowClass = "pending-row";

      let statusBadgeClass = "status-badge-pending";
      if (isAssigned) statusBadgeClass = "status-badge-assigned";
      else if (isInProgress) statusBadgeClass = "status-badge-progress";

      const gc1Badge = `<span class="gc1-tag">GC 1</span>`;
      const priorityClass = { Critical: "priority-critical", Major: "priority-major", Minor: "priority-minor", "Service Request": "priority-sr" }[t.priority] || "priority-normal";
      const priorityBadge = `<span class="priority-pill ${priorityClass}" title="${escapeHtml(t.priorityReason || "")}${t.priorityOverridden ? " (ditetapkan Helpdesk)" : " (usulan otomatis)"}">${escapeHtml(t.priority || "Minor")}</span>`;
      const preTicketBadge = t.isPreTicket ? `<span class="pretiket-pill">Pra-tiket</span>` : "";
      const linkedBadge = t.linkedPortalId && t.isFromWa ? `<span class="link-pill">🔗 ${escapeHtml(t.linkedPortalId)}</span>` : "";
      const waFirstBadge = !t.isFromWa && t.waFirstReportAt ? `<span class="link-pill" title="Aduan pertama di WhatsApp: ${escapeHtml(t.waFirstReportAt)}">💬 WA ${escapeHtml(t.waFirstReportAt.slice(12, 17))}</span>` : "";
      const unverifiedBadge = t.isFromWa && t.senderVerified === false ? `<span class="unverified-pill" title="Pengirim tidak ada di daftar PIC tenan. Verifikasi dulu (SOP 4.1).">⚠ belum terverifikasi</span>` : "";
      const mentionBadge = t.isFromWa && t.helpdeskMentioned ? `<span class="link-pill" title="Pesan menyebut Helpdesk">@Helpdesk</span>` : "";
      const flagBadge = (t.escalationFlags || []).length ? `<span class="flag-pill" title="${escapeHtml(t.escalationFlags.join(" | "))}">⚠ ${t.escalationFlags.length} eskalasi</span>` : "";

      // Clean PIC Name & Short Role Tag
      let rawPic = t.picName || "Tim Helpdesk";
      let cleanPicName = rawPic;
      if (rawPic.toLowerCase().startsWith("approver")) {
        cleanPicName = cleanLoc ? `Pejabat ${cleanLoc}` : "Pejabat Tenan";
        if (cleanPicName.length > 22) cleanPicName = "Pejabat Tenan";
      }
      let rawRole = t.picRole || "L0 Gateway";
      let cleanPicRole = "L0 Gateway";
      if (rawRole.toLowerCase().includes("l1")) cleanPicRole = "EOS L1";
      else if (rawRole.toLowerCase().includes("l2")) cleanPicRole = "EOS L2";
      else if (rawRole.toLowerCase().includes("l3")) cleanPicRole = "EOS L3";
      else if (rawRole.toLowerCase().includes("noc")) cleanPicRole = "NOC";
      else if (rawRole.toLowerCase().includes("soc")) cleanPicRole = "SOC";
      else if (rawRole.toLowerCase().includes("approver") || rawRole.toLowerCase().includes("persetujuan")) cleanPicRole = "K/L Approver";
      else cleanPicRole = "L0 Gateway";

      // Milestone
      let milestoneBadgeClass = "milestone-assigned";
      if (isPending) milestoneBadgeClass = "milestone-pending";
      else if (isInProgress) milestoneBadgeClass = "milestone-progress";
      const milestoneText = escapeHtml(t.activityMilestone || "Verifikasi Tiket");

      // SLA
      const slaBadgeClass = t.slaBadgeClass || "sla-safe";
      const slaStatusText = escapeHtml(t.slaStatusText || "Sisa 24j");
      const slaPercent = t.slaPercentRemaining ?? 100;

      // Action buttons: 🔍 Detail + 📲 WA (if Assigned) - 100% Symmetric & Horizontal
      const actionHtml = `
        <div class="table-actions-cell">
          <button class="action-btn-detail" data-detail="${escapeHtml(cleanId)}" title="Lihat detail, riwayat, dan tindakan">
            <span class="btn-icon">🔍</span><span>Detail</span>
          </button>
          ${isAssigned ? `<button class="action-btn-wa" data-recap="${escapeHtml(cleanId)}" title="Salin ringkasan tiket ini (tidak dikirim otomatis)"><span class="btn-icon">📋</span><span>Salin</span></button>` : ""}
        </div>
      `;

      const isFromWa = Boolean(t.isFromWa || (t.source && t.source.toLowerCase().includes("whatsapp")) || cleanId.startsWith("WA-"));
      const waGroupTag = isFromWa ? `<span class="source-wa-pill">💬 ${escapeHtml(t.waGroup || "Grup WA")}</span>` : "";
      const ticketNumClass = isFromWa ? "ticket-num-badge badge-wa-ticket" : "ticket-num-badge";

      return `
      <tr class="${rowClass}">
        <td>
          <div class="${ticketNumClass}">
            <span>${escapeHtml(cleanId)}</span>
            <button class="copy-icon-btn" data-copy="${escapeHtml(cleanId)}" title="Salin Nomor Tiket">📋</button>
          </div>
        </td>
        <td>
          <div style="line-height:1.45;">
            ${gc1Badge}${preTicketBadge}${waGroupTag}${priorityBadge}${linkedBadge}${waFirstBadge}${unverifiedBadge}${mentionBadge}${flagBadge}<strong>${escapeHtml(rawDesc)}</strong>
          </div>
        </td>
        <td>
          <div style="font-weight:700; color:var(--text-main); font-size:13px;">${escapeHtml(cleanReq)}</div>
          <span class="location-pill">📍 ${escapeHtml(cleanLoc)}</span>
        </td>
        <td>
          <div class="status-pic-group">
            <span class="${statusBadgeClass}">
              ● ${escapeHtml(cleanState)}
            </span>
            <div class="pic-pill" title="PIC: ${escapeHtml(t.picName || 'Helpdesk')} (${escapeHtml(t.picRole || 'L0')})">
              <span class="pic-name">👤 ${escapeHtml(cleanPicName)}</span>
              <span class="pic-tag">${escapeHtml(cleanPicRole)}</span>
            </div>
          </div>
        </td>
        <td>
          <div class="milestone-cell">
            <div class="milestone-badge ${milestoneBadgeClass}">
              ${milestoneText}
            </div>
            <div style="margin-top:3px;">
              <span class="resolver-pill ${resolverClass}">${escapeHtml(resolverLayer)}</span>
            </div>
          </div>
        </td>
        <td style="text-align:center;">
          <div class="sla-cell">
            <span class="sla-pill ${slaBadgeClass}">
              ⏱️ ${slaStatusText}
            </span>
            <div class="sla-mini-bar">
              <div class="sla-mini-fill" style="width:${slaPercent}%;"></div>
            </div>
          </div>
        </td>
        <td style="text-align:center;">
          ${actionHtml}
        </td>
      </tr>
    `;
    })
    .join("");

  sentinelTableBody.innerHTML = rowsHtml;
}

function renderWhatsAppFeed(alerts) {
  if (!waFeedContainer) return;

  const cardsHtml = alerts
    .map((a) => {
      const cleanText = escapeHtml(a.text || "");
      const timeStr = a.dateString || new Date(a.timestamp).toLocaleTimeString("id-ID");

      return `
      <div class="alert-card status-baru">
        <div class="alert-card-top">
          <div class="alert-badges">
            <span class="badge badge-source-wa">💬 WhatsApp</span>
            <span class="badge badge-kw">${escapeHtml(a.matchedKeyword || "GC 1")}</span>
            <span class="badge badge-status-baru">Baru</span>
          </div>
          <span class="alert-meta">⏱️ ${timeStr} WIB</span>
        </div>
        <div class="alert-main">
          <div class="alert-title-row">
            <span class="alert-sender">${escapeHtml(a.sender || "WhatsApp User")}</span>
            ${a.group ? `<span class="alert-group-tag">👥 ${escapeHtml(a.group)}</span>` : ""}
          </div>
          <div class="alert-text-body">
            "${cleanText}"
          </div>
        </div>
        <div class="alert-actions">
          <button class="btn btn-secondary btn-sm" data-copytext="${escapeHtml(a.text)}">
            📋 Salin Chat
          </button>
        </div>
      </div>
    `;
    })
    .join("");

  waFeedContainer.innerHTML = cardsHtml;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ----------------------------------------------------
// WHATSAPP RECAP GENERATOR & DISPATCHER
// ----------------------------------------------------
function buildWaSummaryText() {
  const assignedList = state.snapshot.team_assigned || state.snapshot.gc1_assigned || [];
  const waList = state.snapshot.wa_alerts || [];

  if (assignedList.length === 0 && waList.length === 0) {
    return null;
  }

  const nowTime = new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

  let text = `🚨 *REKAP TIKET & ADUAN GC 1 (GOVERNMENT CLOUD 1)*\n`;
  text += `📅 *Update Terverifikasi:* ${nowTime} WIB\n`;
  text += `🎯 *Status Target:* Assigned Tim Kita (Prioritas Eksekusi)\n`;
  text += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (assignedList.length > 0) {
    text += `📋 *DAFTAR TIKET ASSIGNED TIM KITA (SIAP DITANGANI):*\n`;
    assignedList.forEach((item, idx) => {
      const resolver = item.resolverLayer || item.assignmentGroup || "Helpdesk";
      const pic = item.picName ? `${item.picName} (${item.picRole || "L0"})` : "Helpdesk Gateway";
      const milestone = item.activityMilestone || "Persiapan Penanganan Teknis";
      const sla = item.slaStatusText || "-";

      text += `${idx + 1}️⃣ *No. Tiket:* \`${item.ticketId}\`\n`;
      text += `   • *Pemohon:* ${item.requestedFor} (${item.location || "Kominfo"})\n`;
      text += `   • *PIC Pelaksana:* ${pic}\n`;
      text += `   • *Aktivitas:* ${milestone}\n`;
      text += `   • *Sisa SLA:* ${sla}\n`;
      text += `   • *Uraian:* ${item.shortDesc}\n\n`;
    });
  }

  if (waList.length > 0) {
    text += `💬 *ADUAN WHATSAPP GC 1 TERKINI:*\n`;
    waList.slice(0, 3).forEach((item) => {
      text += `• *Dari:* ${item.sender} ${item.group ? `[${item.group}]` : ""}\n`;
      text += `  _"${item.text}"_\n`;
    });
    text += `\n`;
  }

  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `📊 *Total Antrean Assigned:* ${assignedList.length} tiket\n`;
  text += `🌐 *Total Seluruh Tiket GC 1:* ${state.snapshot.total_helpdesk} tiket (100% Selaras)\n`;
  text += `_Laporan otomatis oleh GC 1 Sentinel Monitor_`;

  return text;
}

sendWaSummaryBtn?.addEventListener("click", () => {
  const summary = buildWaSummaryText();
  if (!summary) {
    alert("Tidak ada tiket GC 1 Assigned atau aduan aktif untuk direkap.");
    return;
  }

  if (waSummaryPreview) {
    waSummaryPreview.value = summary;
  }
  window.copyText(summary);

  if (waSummaryModal) {
    waSummaryModal.classList.add("active");
  }
});

btnQuickWaRecap?.addEventListener("click", () => {
  sendWaSummaryBtn.click();
});

// ----------------------------------------------------
// CONTROLS & EVENT LISTENERS
// ----------------------------------------------------
btnForceSync?.addEventListener("click", () => {
  fetchHelpdeskSnapshot();
  btnForceSync.textContent = "⏳ Memperbarui...";
  setTimeout(() => {
    btnForceSync.textContent = "🔄 Sync Sekarang";
  }, 1000);
});

searchInput?.addEventListener("input", (e) => {
  state.searchQuery = e.target.value;
  renderActiveTab();
});

filterStateSelect?.addEventListener("change", (e) => {
  state.filterStatus = e.target.value;
  renderActiveTab();
});

clearAllBtn?.addEventListener("click", () => {
  if (searchInput) searchInput.value = "";
  if (filterStateSelect) filterStateSelect.value = "all";
  state.searchQuery = "";
  state.filterStatus = "all";
  renderActiveTab();
});

// Clear Data GC 1 Dashboard (Test / Reset State)
btnClearData?.addEventListener("click", async () => {
  if (!confirm("⚠️ Apakah Anda yakin ingin mengosongkan seluruh data tiket di GC 1 Dashboard untuk keperluan pengujian?")) {
    return;
  }
  try {
    const res = await fetch("http://localhost:8765/api/clear_data", { method: "POST" });
    if (res.ok) {
      state.snapshot = {
        total_helpdesk: 0,
        team_assigned_count: 0,
        team_pending_count: 0,
        team_progress_count: 0,
        sla_health_percent: 100,
        sla_safe_count: 0,
        telkom_count: 0,
        wa_count: 0,
        last_sync: new Date().toLocaleTimeString("id-ID") + " WIB",
        team_assigned: [],
        team_pending: [],
        team_progress: [],
        wa_alerts: [],
        all_tickets: []
      };
      state.alerts = [];
      updateKpiCards();
      updateTabBadges();
      renderActiveTab();
      if (lastSyncTimeText) lastSyncTimeText.textContent = "Data Dibersihkan";
      alert("✅ Seluruh data tiket di GC 1 Dashboard berhasil dibersihkan!");
    } else {
      alert("Gagal mengosongkan data di server.");
    }
  } catch (err) {
    alert("Koneksi gagal: " + err.message);
  }
});

// CSV Export
exportCsvBtn?.addEventListener("click", () => {
  window.open(`${SERVER}/api/export.csv`, "_blank");
});

// Markijo Toggle
let markijoActive = true;
toggleMarkijoBtn?.addEventListener("click", async () => {
  markijoActive = !markijoActive;
  if (markijoActive) {
    toggleMarkijoBtn.textContent = "🤖 Markijo: AKTIF";
    toggleMarkijoBtn.style.background = "#2563eb";
    toggleMarkijoBtn.title = "Otomasi Markijo aktif memantau GC 1 dan mengirim rekap ke mimi Sandora";
  } else {
    toggleMarkijoBtn.textContent = "🤖 Markijo: JEDA";
    toggleMarkijoBtn.style.background = "#6b7280";
    toggleMarkijoBtn.title = "Otomasi Markijo sedang dijeda sementara";
  }

  try {
    await fetch("http://localhost:8765/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markijo_auto_mode: markijoActive })
    });
  } catch (_) {}
});

// Audio controls
function updateSoundUI() {
  if (state.settings.soundEnabled) {
    toggleSoundBtn?.classList.remove("muted");
    if (soundIcon) soundIcon.textContent = "🔔";
    if (soundStatusText) soundStatusText.textContent = "Suara: ON";
  } else {
    toggleSoundBtn?.classList.add("muted");
    if (soundIcon) soundIcon.textContent = "🔕";
    if (soundStatusText) soundStatusText.textContent = "Suara: MUTE";
  }
}

toggleSoundBtn?.addEventListener("click", () => {
  state.settings.soundEnabled = !state.settings.soundEnabled;
  updateSoundUI();
});

testSoundBtn?.addEventListener("click", () => {
  playAlertSound();
});

// Settings Modal
openSettingsBtn?.addEventListener("click", () => {
  if (settingWaGroups) settingWaGroups.value = (state.settings.waGroups || []).join(", ");
  if (settingVerifiedSenders) settingVerifiedSenders.value = (state.settings.verifiedSenders || []).join(", ");
  if (settingKeywords) settingKeywords.value = state.settings.keywords.join(", ");
  if (settingServerPort) settingServerPort.value = state.settings.serverPort;
  if (settingMarkijoAuto) settingMarkijoAuto.checked = markijoActive;
  if (settingSound) settingSound.checked = state.settings.soundEnabled;
  settingsModal?.classList.add("active");
});

function closeSettings() {
  settingsModal?.classList.remove("active");
}

closeSettingsBtn?.addEventListener("click", closeSettings);
cancelSettingsBtn?.addEventListener("click", closeSettings);

saveSettingsBtn?.addEventListener("click", async () => {
  const newKeywords = settingKeywords.value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const splitList = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);
  state.settings.waGroups = splitList(settingWaGroups.value);
  state.settings.verifiedSenders = splitList(settingVerifiedSenders.value);
  state.settings.keywords = newKeywords.length > 0 ? newKeywords : ["GC 1"];
  state.settings.serverPort = parseInt(settingServerPort.value, 10) || 8765;
  state.settings.soundEnabled = settingSound.checked;
  markijoActive = settingMarkijoAuto.checked;

  try {
    await fetch("http://localhost:8765/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wa_monitored_groups: state.settings.waGroups,
        wa_verified_senders: state.settings.verifiedSenders,
        keywords: state.settings.keywords,
        markijo_auto_mode: markijoActive
      })
    });
  } catch (_) {}

  updateSoundUI();
  closeSettings();
  alert("Pengaturan berhasil disimpan.");
});

// WA Summary Modal Handlers
function closeWaModal() {
  waSummaryModal?.classList.remove("active");
}
closeWaSummaryBtn?.addEventListener("click", closeWaModal);
doneWaSummaryBtn?.addEventListener("click", closeWaModal);

copyAgainBtn?.addEventListener("click", () => {
  if (waSummaryPreview) {
    window.copyText(waSummaryPreview.value);
    copyAgainBtn.textContent = "✅ Berhasil Disalin!";
    setTimeout(() => {
      copyAgainBtn.textContent = "📋 Salin Ulang Teks";
    }, 2000);
  }
});

goToWaBtn?.addEventListener("click", () => {
  window.open("https://web.whatsapp.com", "_blank");
});

// ----------------------------------------------------
// INTER-TAB BROADCAST CHANNEL LISTENER
// ----------------------------------------------------
try {
  const bus = new BroadcastChannel("gc1_sentinel_bus");
  bus.onmessage = (e) => {
    if (e.data && e.data.type === "SYNC_HELPDESK_TICKETS") {
      fetchHelpdeskSnapshot();
    } else if (e.data && (e.data.type === "NEW_ALERT" || e.data.type === "ALERT_RECEIVED")) {
      playAlertSound();
      fetchHelpdeskSnapshot();
    }
  };
} catch (_) {}

// ----------------------------------------------------
// LIVE SLA COUNTDOWN TICKER (DYNAMIC 1-SECOND TIMER)
// ----------------------------------------------------
setInterval(() => {
  const allTickets = state.snapshot.all_tickets || [];
  if (allTickets.length === 0) return;

  const nowSecs = Date.now() / 1000;
  allTickets.forEach((t) => {
    if (t.deadlineTs && !t.slaClosed) {
      const remainingSecs = Math.max(0, Math.floor(t.deadlineTs - nowSecs));
      const remH = Math.floor(remainingSecs / 3600);
      const remM = Math.floor((remainingSecs % 3600) / 60);
      t.slaRemainingSeconds = remainingSecs;
      t.slaRemainingFormatted = `${remH}j ${remM}m`;

      const totalSecs = (t.slaLimitHours || 24) * 3600;
      t.slaPercentRemaining = Math.max(0, Math.min(100, Math.floor((remainingSecs / totalSecs) * 100)));

      if (remainingSecs === 0) {
        t.slaBadgeClass = "sla-breached";
        t.slaStatusText = "SLA Lewat";
      } else if (t.slaPercentRemaining < 25) {
        t.slaBadgeClass = "sla-danger";
        t.slaStatusText = `Sisa ${t.slaRemainingFormatted}`;
      } else if (t.slaPercentRemaining < 50) {
        t.slaBadgeClass = "sla-warning";
        t.slaStatusText = `Sisa ${t.slaRemainingFormatted}`;
      } else {
        t.slaBadgeClass = "sla-safe";
        t.slaStatusText = `Sisa ${t.slaRemainingFormatted}`;
      }
    }
  });

  // If table is visible and not on WA tab, re-render visible table view periodically
}, 1000);

// ----------------------------------------------------
// POLLING INITIALIZATION
// ----------------------------------------------------
fetchHelpdeskSnapshot();
setInterval(fetchHelpdeskSnapshot, 4000);
updateSoundUI();

// ----------------------------------------------------
// SIMULASI / INPUT ADUAN WHATSAPP GROUP MODAL
// ----------------------------------------------------
const btnSimulateWaMsg = document.getElementById("btnSimulateWaMsg");
const waSimulateModal = document.getElementById("waSimulateModal");
const closeWaSimulateBtn = document.getElementById("closeWaSimulateBtn");
const cancelWaSimulateBtn = document.getElementById("cancelWaSimulateBtn");
const submitWaSimulateBtn = document.getElementById("submitWaSimulateBtn");

const waInputSender = document.getElementById("waInputSender");
const waInputGroup = document.getElementById("waInputGroup");
const waInputText = document.getElementById("waInputText");

window.setWaPreset = function (num) {
  if (num === 1) {
    if (waInputSender) waInputSender.value = "Dr. Irwan Setiawan (Kemenkes)";
    if (waInputGroup) waInputGroup.value = "Grup Koordinasi Teknis GC 1 Komdigi";
    if (waInputText) waInputText.value = "Selamat siang tim Helpdesk GC 1, mohon bantuan penambahan kapasitas disk VM Database SatuData di GC 1 karena sudah mencapai 92%. Terima kasih.";
  } else if (num === 2) {
    if (waInputSender) waInputSender.value = "Dimas Prasetyo (Bappenas)";
    if (waInputGroup) waInputGroup.value = "Ops Tenant Government Cloud 1";
    if (waInputText) waInputText.value = "Mohon izin rekan-rekan Helpdesk & EOS, aplikasi SIM-Perencanaan Bappenas di GC 1 mengalami error 500 dan WAF blocking. Mohon segera dicek dan ditindaklanjuti. Terima kasih.";
  } else if (num === 3) {
    if (waInputSender) waInputSender.value = "Dewi Anggraini (Kemenkeu)";
    if (waInputGroup) waInputGroup.value = "Helpdesk Komdigi - Layanan Cloud";
    if (waInputText) waInputText.value = "Permohonan verifikasi dan pembuatan ulang akun akses manajemen backup snapshot VM di Government Cloud 1 untuk instansi Kementerian Keuangan. Mohon bantuannya min.";
  }
};

function openWaSimulateModal() {
  if (waSimulateModal) waSimulateModal.classList.add("active");
}

function closeWaSimulateModal() {
  if (waSimulateModal) waSimulateModal.classList.remove("active");
}

btnSimulateWaMsg?.addEventListener("click", openWaSimulateModal);
closeWaSimulateBtn?.addEventListener("click", closeWaSimulateModal);
cancelWaSimulateBtn?.addEventListener("click", closeWaSimulateModal);

submitWaSimulateBtn?.addEventListener("click", async () => {
  const sender = waInputSender?.value.trim() || "Member Grup WA";
  const group = waInputGroup?.value.trim() || "Grup Koordinasi Teknis GC 1";
  const text = waInputText?.value.trim() || "";

  if (!text) {
    alert("Isi pesan aduan tidak boleh kosong.");
    return;
  }

  submitWaSimulateBtn.disabled = true;
  submitWaSimulateBtn.innerHTML = "<span>⏳ Mengonversi...</span>";

  try {
    const res = await fetch("http://localhost:8765/api/add_wa_ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: sender,
        group: group,
        text: text,
        matchedKeyword: "GC 1",
        manual: true
      })
    });
    const result = await res.json();
    if (result && result.status === "success") {
      playAlertSound();
      closeWaSimulateModal();
      await fetchHelpdeskSnapshot();
      alert(`✅ Aduan WhatsApp dari ${sender} berhasil dikonversi menjadi tiket:\n\n• Nomor Tiket: ${result.ticket?.ticketId}\n• Status: Assigned (Masuk ke Dashboard Monitor)\n• Prioritas (usulan): ${result.ticket?.priority}\n• Batas SLA: ${result.ticket?.slaTargetTime}`);
    } else if (result && result.reason === "already_converted_to_ticket") {
      alert("Pesan aduan ini sudah pernah dikonversi menjadi tiket.");
      closeWaSimulateModal();
    } else {
      alert("Gagal menambahkan tiket aduan: " + (result?.message || "Terjadi kesalahan"));
    }
  } catch (err) {
    alert("Koneksi ke Sentinel Server gagal. Pastikan server port 8765 aktif.");
  } finally {
    if (submitWaSimulateBtn) {
      submitWaSimulateBtn.disabled = false;
      submitWaSimulateBtn.innerHTML = "<span>🚀</span><span>Konversi Menjadi Tiket</span>";
    }
  }
});


// ----------------------------------------------------
// BANNER STATUS (grup WA belum diatur, eskalasi)
// ----------------------------------------------------
function renderBanners(data) {
  const box = document.getElementById("statusBanners");
  if (!box) return;
  const parts = [];
  if (!(data.wa_monitored_groups || []).length) {
    parts.push(`<div class="banner banner-warn">Belum ada grup WhatsApp yang dipantau, jadi pesan WA belum dibaca. Isi lewat Pengaturan atau wa_monitored_groups di config.json.</div>`);
  } else {
    parts.push(`<div class="banner banner-info">Membaca grup WA: ${escapeHtml(data.wa_monitored_groups.join(", "))}. Sentinel hanya membaca, tidak mengirim pesan ke WhatsApp.</div>`);
  }
  const esc = data.escalations || [];
  if (esc.length) {
    const first = esc.slice(0, 3).map((t) => `${escapeHtml(t.ticketId)}: ${escapeHtml(t.escalationFlags[0])}`).join(" &nbsp;|&nbsp; ");
    parts.push(`<div class="banner banner-danger" data-detail="${escapeHtml(esc[0].ticketId)}">⚠ ${esc.length} tiket perlu perhatian. ${first}</div>`);
  }
  box.innerHTML = parts.join("");
}

// ----------------------------------------------------
// REKAP HARIAN WA vs PORTAL (SOP 4.4)
// ----------------------------------------------------
const dailyRecapModal = document.getElementById("dailyRecapModal");
const dailyRecapDate = document.getElementById("dailyRecapDate");
const dailyRecapBody = document.getElementById("dailyRecapBody");

async function loadDailyRecap() {
  const day = dailyRecapDate.value || new Date().toISOString().slice(0, 10);
  try {
    const res = await fetch(`${SERVER}/api/daily_recap?date=${encodeURIComponent(day)}`);
    const d = await res.json();
    const rows = (d.unlinked_items || []).map((u) => `
      <div class="extra-box" style="margin-bottom:6px;">
        <strong>${escapeHtml(u.ticketId)}</strong> &middot; ${escapeHtml(u.sender || "-")} &middot; ${escapeHtml(u.time || "")}<br>
        <span style="color:#475569;">${escapeHtml(u.text || "")}</span>
      </div>`).join("");
    dailyRecapBody.innerHTML = `
      <div class="extra-box"><div class="extra-grid">
        <div>Aduan WA (pra-tiket)</div><div><strong>${d.wa_total}</strong></div>
        <div>Sudah ada tiket portal</div><div><strong>${d.wa_linked}</strong> (${d.wa_linked_found_in_portal} terlihat di portal)</div>
        <div>Belum ada tiket portal</div><div><strong style="color:#B91C1C;">${d.wa_unlinked}</strong></div>
        <div>Tiket portal hari ini</div><div><strong>${d.portal_total}</strong></div>
        <div>Aduan Telkom/GC 2 diabaikan</div><div>${d.telkom_skipped_last_sync} (sinkron terakhir)</div>
      </div></div>
      <p style="font-size:12px; color:#475569; margin:8px 0;">${escapeHtml(d.note)}</p>
      ${rows || '<p style="font-size:12.5px;">Semua aduan WA hari ini sudah tertaut ke tiket portal.</p>'}`;
  } catch (_) {
    dailyRecapBody.innerHTML = "<p>Gagal memuat rekap. Cek server Sentinel.</p>";
  }
}

document.getElementById("btnDailyRecap")?.addEventListener("click", () => {
  const now = new Date();
  dailyRecapDate.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  dailyRecapModal?.classList.add("active");
  loadDailyRecap();
});
dailyRecapDate?.addEventListener("change", loadDailyRecap);
["closeDailyRecapBtn", "dailyRecapCloseBtn"].forEach((id) =>
  document.getElementById(id)?.addEventListener("click", () => dailyRecapModal?.classList.remove("active")));
document.getElementById("dailyRecapExportBtn")?.addEventListener("click", () => {
  window.open(`${SERVER}/api/export.csv?date=${encodeURIComponent(dailyRecapDate.value || "")}`, "_blank");
});

// ----------------------------------------------------
// DETAIL TIKET: klasifikasi, respons, riwayat, tindakan operator
// ----------------------------------------------------
function renderTicketExtra(ticket) {
  const box = document.getElementById("modalExtraContainer");
  if (!box) return;
  const id = ticket.ticketId;
  const hist = (ticket.history || []).slice().reverse().map((h) => `
    <div class="hist-item"><time>${escapeHtml(h.time)} &middot; ${escapeHtml(h.actor)}</time><br>
      <strong>${escapeHtml(h.event)}</strong>${h.detail ? `: ${escapeHtml(h.detail)}` : ""}</div>`).join("");
  const flags = (ticket.escalationFlags || []).map((f) => `<li>${escapeHtml(f)}</li>`).join("");
  const waInfo = ticket.isFromWa
    ? `<div>Aduan WA</div><div>${escapeHtml(ticket.waGroup || "-")} &middot; ${escapeHtml(ticket.requestedFor || "")}${ticket.senderVerified === false ? ' <span class="unverified-pill">belum terverifikasi</span>' : ""}</div>`
    : (ticket.waFirstReportAt ? `<div>Aduan pertama di WA</div><div>${escapeHtml(ticket.waFirstReportAt)} (${escapeHtml(ticket.waGroup || "")})</div>` : "");
  const ai = ticket.ai;
  const aiBox = ai ? `
    <div class="extra-box" style="border-color:#C4B5FD;"><h4>Saran AI (usulan, bukan keputusan) &middot; ${escapeHtml(ai.model || "")}</h4>
      <div class="extra-grid">
        <div>Ringkasan</div><div>${escapeHtml(ai.summary || "-")}</div>
        <div>Prioritas disarankan</div><div>${escapeHtml(ai.priority || "-")}</div>
        <div>Alasan</div><div>${escapeHtml(ai.reason || "-")}</div>
        <div>Catatan</div><div>${ai.is_peer_chatter ? "Kemungkinan obrolan antar-tenan, bukan permintaan ke Helpdesk. " : ""}${ai.has_image_only ? "Isi utama ada di gambar, buka manual. " : ""}${ai.needs_followup ? "Perlu tindak lanjut." : "Tidak perlu tindak lanjut."}</div>
        <div>Keputusan</div><div>${ticket.aiDecision === "accepted" ? "Diterima" : ticket.aiDecision === "rejected" ? "Ditolak" : "Belum diputuskan"}</div>
      </div>
      ${ticket.aiDecision ? "" : `<div class="action-row"><button class="btn btn-secondary btn-sm" id="actAiAccept">Terima saran</button><button class="btn btn-secondary btn-sm" id="actAiReject">Tolak saran</button></div>`}
    </div>` : "";
  box.innerHTML = aiBox + `
    <div class="extra-box"><h4>Klasifikasi dan SLA (SOP 3.2-3.3)</h4>
      <div class="extra-grid">
        <div>Tipe</div><div>${escapeHtml(ticket.ticketType || "-")}</div>
        <div>Prioritas</div><div>${escapeHtml(ticket.priority || "-")} ${ticket.priorityOverridden ? "(ditetapkan Helpdesk)" : "(usulan otomatis)"}</div>
        <div>Dasar prioritas</div><div>${escapeHtml(ticket.priorityReason || "-")}</div>
        <div>Respons pertama</div><div>${escapeHtml(ticket.responseText || "-")}</div>
        <div>Update ke tenan</div><div>setiap ${ticket.updateEveryMin || "-"} menit</div>
        ${ticket.linkedPortalId ? `<div>Tiket portal tertaut</div><div>${escapeHtml(ticket.linkedPortalId)}</div>` : ""}
        ${waInfo}
        ${ticket.createdTsEstimated ? "<div>Catatan</div><div>Waktu portal tidak terbaca, memakai waktu Sentinel pertama kali melihat tiket.</div>" : ""}
      </div>
      ${flags ? `<ul style="margin:8px 0 0 18px; color:#92400E;">${flags}</ul>` : ""}
      <div class="action-row">
        <button class="btn btn-secondary btn-sm" id="actAck">Catat respons pertama</button>
        <button class="btn btn-secondary btn-sm" id="actPrio">Tetapkan prioritas</button>
        ${ticket.isFromWa ? '<button class="btn btn-secondary btn-sm" id="actLink">Tautkan tiket portal</button>' : ""}
        <button class="btn btn-secondary btn-sm" id="actNote">Tambah catatan</button>
      </div>
    </div>
    <div class="extra-box"><h4>Riwayat tiket</h4>${hist || "<em>Belum ada riwayat.</em>"}</div>`;

  const reopen = async () => {
    await fetchHelpdeskSnapshot();
    window.openTicketActivityDetail(id);
  };
  const act = async (body) => {
    const r = await postJson("/api/ticket_action", { ticketId: id, ...body });
    if (r.status !== "ok") alert(r.message || "Gagal menyimpan tindakan.");
    else await reopen();
  };
  document.getElementById("actAck")?.addEventListener("click", () => act({ action: "ack" }));
  document.getElementById("actAiAccept")?.addEventListener("click", () => act({ action: "ai_accept" }));
  document.getElementById("actAiReject")?.addEventListener("click", () => {
    const note = prompt("Alasan menolak saran AI (opsional):") || "";
    act({ action: "ai_reject", note });
  });
  document.getElementById("actPrio")?.addEventListener("click", () => {
    const value = prompt("Prioritas (Critical / Major / Minor / Service Request):", ticket.priority || "Minor");
    if (!value) return;
    const note = prompt("Alasan penetapan prioritas (wajib, SOP 3.3):");
    if (!note) return;
    act({ action: "set_priority", value: value.trim(), note });
  });
  document.getElementById("actLink")?.addEventListener("click", () => {
    const value = prompt("Nomor tiket portal (contoh REQ-KMF-092026-0093996):");
    if (value) act({ action: "link_portal", value });
  });
  document.getElementById("actNote")?.addEventListener("click", () => {
    const note = prompt("Catatan:");
    if (note) act({ action: "note", note });
  });
}
