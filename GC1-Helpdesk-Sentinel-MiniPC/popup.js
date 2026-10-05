/**
 * GC 1 Sentinel - Extension Popup Controller
 */

document.addEventListener("DOMContentLoaded", async () => {
  const openDashboardBtn = document.getElementById("openDashboardBtn");
  const forceTabHelpdeskBtn = document.getElementById("forceTabHelpdeskBtn");
  const toggleSoundBtn = document.getElementById("toggleSoundBtn");
  const soundText = document.getElementById("soundText");
  const unreadBadge = document.getElementById("unreadBadge");
  const recentList = document.getElementById("recentList");

  // Load state from chrome storage
  const data = await chrome.storage.local.get(["alerts", "settings", "unreadCount"]);
  const settings = data.settings || { soundEnabled: true };
  const alerts = data.alerts || [];
  const unreadCount = data.unreadCount || 0;

  // Sound text
  soundText.textContent = settings.soundEnabled ? "ON" : "MUTE";

  // Unread badge
  if (unreadCount > 0) {
    unreadBadge.style.display = "inline-block";
    unreadBadge.textContent = `${unreadCount} Baru`;
  } else {
    unreadBadge.style.display = "none";
  }

  // Open Dashboard
  openDashboardBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
    window.close();
  });

  // Force Tab Helpdesk
  forceTabHelpdeskBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: "FORCE_ACTIVATE_HELPDESK" }, (resp) => {
        if (chrome.runtime.lastError) {
          alert("Gagal mengaktifkan di tab ini. Pastikan halaman sudah selesai dimuat.");
        } else {
          alert("Tab ini sekarang dipantau sebagai Helpdesk untuk kata kunci GC 1!");
          window.close();
        }
      });
    }
  });

  // Toggle Sound
  toggleSoundBtn.addEventListener("click", async () => {
    settings.soundEnabled = !settings.soundEnabled;
    soundText.textContent = settings.soundEnabled ? "ON" : "MUTE";
    await chrome.storage.local.set({ settings });
  });

  // Render recent 3 alerts
  if (alerts.length > 0) {
    recentList.innerHTML = "";
    alerts.slice(0, 3).forEach((a) => {
      const item = document.createElement("div");
      item.className = `recent-item ${a.source === "helpdesk" ? "hd" : "wa"}`;
      item.innerHTML = `
        <div class="recent-top">
          <strong>${a.source === "helpdesk" ? "🎫 Helpdesk" : "💬 WhatsApp"}</strong>
          <span>${a.dateString || ""}</span>
        </div>
        <div class="recent-text">${escapeHtml(a.text || "")}</div>
      `;
      item.style.cursor = "pointer";
      item.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
        window.close();
      });
      recentList.appendChild(item);
    });
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
});
