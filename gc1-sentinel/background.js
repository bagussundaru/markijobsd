/**
 * GC 1 Sentinel - Background Service Worker (Manifest V3)
 * Handles storage, notification dispatch, state management, and tab communication.
 */

const DEFAULT_SETTINGS = {
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
  helpdeskUrlPatterns: ["helpdesk", "ticket", "tiket", "request", "dashboard", "servicedesk", "kominfo", "pdn", "192.168", "10."],
  helpdeskSelector: "table tbody tr, tr, [role='row']",
  whatsappGroupFilter: "", // Kosongkan untuk memantau grup apa saja yang sedang dibuka
  onlyAssignedState: true, // Filter khusus status Assigned
  requireGcKeyword: true,  // Filter khusus kata kunci GC 1 / Government Cloud 1
  soundEnabled: true,
  soundVolume: 0.8,
  desktopNotifications: true,
  autoRefreshHelpdeskSeconds: 0 // 0 = nonaktif
};

// Initialize settings and storage on installation
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(["settings", "alerts", "unreadCount"]);
  if (!data.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
  if (!data.alerts) {
    await chrome.storage.local.set({ alerts: [] });
  }
  if (data.unreadCount === undefined) {
    await chrome.storage.local.set({ unreadCount: 0 });
  }
  updateBadge(data.unreadCount || 0);
  console.log("[GC 1 Sentinel] Installed and initialized successfully.");
});

function updateBadge(count) {
  if (count > 0) {
    chrome.action.setBadgeText({ text: count > 99 ? "99+" : String(count) });
    chrome.action.setBadgeBackgroundColor({ color: "#EF4444" }); // Red
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

// Generate unique hash for deduplication
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

// Handle messages from content scripts and dashboard
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case "NEW_ALERT": {
          await handleNewAlert(message.data, sender);
          sendResponse({ status: "ok" });
          break;
        }

        case "OPEN_DASHBOARD": {
          const dashboardUrl = chrome.runtime.getURL("dashboard.html");
          const tabs = await chrome.tabs.query({ url: dashboardUrl });
          if (tabs.length > 0) {
            await chrome.tabs.update(tabs[0].id, { active: true });
          } else {
            await chrome.tabs.create({ url: dashboardUrl });
          }
          sendResponse({ status: "ok" });
          break;
        }

        case "FOCUS_TAB": {
          if (message.tabId) {
            try {
              await chrome.tabs.update(message.tabId, { active: true });
              const tab = await chrome.tabs.get(message.tabId);
              if (tab.windowId) {
                await chrome.windows.update(tab.windowId, { focused: true });
              }
            } catch (err) {
              console.warn("Could not focus tab:", err);
            }
          }
          sendResponse({ status: "ok" });
          break;
        }

        case "RESET_UNREAD": {
          await chrome.storage.local.set({ unreadCount: 0 });
          updateBadge(0);
          sendResponse({ status: "ok" });
          break;
        }

        default:
          sendResponse({ status: "ignored" });
      }
    } catch (err) {
      console.error("[GC 1 Sentinel] Error in message listener:", err);
      sendResponse({ status: "error", error: err.message });
    }
  })();
  return true; // Keep message channel open for async response
});

async function handleNewAlert(alertData, sender) {
  const store = await chrome.storage.local.get(["alerts", "unreadCount", "settings"]);
  const alerts = store.alerts || [];
  let unreadCount = store.unreadCount || 0;
  const settings = store.settings || DEFAULT_SETTINGS;

  // Formulate unique signature to prevent duplicates
  const signatureRaw = `${alertData.source}|${alertData.ticketId || ""}|${alertData.sender || ""}|${alertData.rawText || alertData.text}`;
  const id = alertData.id || "alert_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
  const hash = hashString(signatureRaw);

  // Check if identical item already recorded within the last 24 hours
  const isDuplicate = alerts.some((a) => a.hash === hash);
  if (isDuplicate) {
    return;
  }

  const newAlert = {
    id: id,
    hash: hash,
    source: alertData.source, // 'whatsapp' | 'helpdesk'
    title: alertData.title || (alertData.source === "whatsapp" ? `Chat WA: ${alertData.group || "Grup"}` : `Tiket Helpdesk`),
    sender: alertData.sender || "Tidak Diketahui",
    group: alertData.group || "",
    ticketId: alertData.ticketId || "",
    text: alertData.text,
    matchedKeyword: alertData.matchedKeyword || "GC 1",
    timestamp: Date.now(),
    dateString: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    sourceUrl: sender?.tab?.url || alertData.sourceUrl || "",
    tabId: sender?.tab?.id || null,
    status: "baru", // 'baru' | 'diproses' | 'selesai'
    read: false
  };

  alerts.unshift(newAlert);
  // Keep max 500 alerts in history
  if (alerts.length > 500) {
    alerts.length = 500;
  }

  unreadCount += 1;
  await chrome.storage.local.set({ alerts, unreadCount });
  updateBadge(unreadCount);

  // Trigger Windows Desktop notification
  if (settings.desktopNotifications) {
    const notifTitle = alertData.source === "whatsapp"
      ? `🚨 Aduan GC 1 di WhatsApp [${alertData.group || "Grup"}]`
      : `🚨 Tiket Masuk GC 1: ${alertData.ticketId || "Helpdesk"}`;
    
    const notifBody = `${alertData.sender ? alertData.sender + ": " : ""}${alertData.text.substring(0, 120)}...`;

    chrome.notifications.create(newAlert.id, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: notifTitle,
      message: notifBody,
      priority: 2,
      requireInteraction: true
    });
  }

  // Broadcast to any open dashboard or popup safely without throwing errors
  try {
    chrome.runtime.sendMessage({
      type: "ALERT_RECEIVED",
      alert: newAlert,
      unreadCount: unreadCount
    }, (response) => {
      // Reading lastError prevents 'Could not establish connection' error in chrome://extensions
      if (chrome.runtime.lastError) {
        // Intentionally suppressed: dashboard/popup is not open right now
      }
    });
  } catch (_) {}
}

// When notification is clicked, open dashboard or focus source tab
chrome.notifications.onClicked.addListener(async (notificationId) => {
  const store = await chrome.storage.local.get(["alerts"]);
  const alert = (store.alerts || []).find((a) => a.id === notificationId);
  if (alert && alert.tabId) {
    try {
      await chrome.tabs.update(alert.tabId, { active: true });
      return;
    } catch (_) {}
  }
  // Otherwise open dashboard
  const dashboardUrl = chrome.runtime.getURL("dashboard.html");
  chrome.tabs.create({ url: dashboardUrl });
});
