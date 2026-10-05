/**
 * GC 1 Sentinel - WhatsApp Web Content Script (Helpdesk Expert Anti-Spam Edition)
 * 
 * ATURAN EXPERT HELPDESK:
 * - Anti-Spam Mutlak: Pesan yang sama TIDAK PERNAH diketik atau dikirim dua kali.
 * - Atomic Lock: Hanya satu proses pengiriman yang berjalan pada satu waktu.
 * - Pemilihan Chat Cerdas: Memastikan chat "mimi Sandora" aktif sebelum mengetik pesan.
 * - Konfirmasi Pengiriman: Melaporkan status pengiriman kembali ke Sentinel Server.
 */

(function () {
  "use strict";

  console.log("[GC 1 Sentinel] WhatsApp Agent (Helpdesk Expert Anti-Spam) aktif.");

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
    whatsappGroupFilter: "",
    targetContact: "mimi Sandora"
  };

  const processedMsgIds = new Set();
  let isSending = false;

  // Cache anti-spam lokal di browser
  function getSentSignatures() {
    try {
      const raw = localStorage.getItem("gc1_sent_wa_sigs");
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (_) {
      return new Set();
    }
  }

  function recordSentSignature(sig) {
    try {
      const sigs = getSentSignatures();
      sigs.add(sig);
      const list = Array.from(sigs).slice(-200); // Simpan 200 riwayat terakhir
      localStorage.setItem("gc1_sent_wa_sigs", JSON.stringify(list));
    } catch (_) {}
  }

  function hashText(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return String(hash);
  }

  function safeSendMessage(payload) {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) {
      try {
        chrome.runtime.sendMessage(payload, () => {
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
  }

  function matchesKeywords(text) {
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

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function getActiveChatName() {
    try {
      const mainHeader = document.querySelector("#main header");
      if (!mainHeader) return "";

      const titleEl = mainHeader.querySelector('[data-testid="conversation-info-header-chat-title"]') ||
                      mainHeader.querySelector("span[title]") ||
                      mainHeader.querySelector(".x1iyjqo2 span") ||
                      mainHeader.querySelector("div[role='button'] span");
      return titleEl ? titleEl.textContent.trim() : "";
    } catch (_) {
      return "";
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
        const match = prePlain.match(/\[(.*?)\].*?([^:]+):/);
        if (match) {
          timeInfo = match[1];
          sender = match[2].trim();
        }
      }

      if (!sender) {
        const authorEl = el.querySelector('[data-testid="author"]') ||
                         el.querySelector("span._amk6") ||
                         el.querySelector(".x1rg5ohu");
        if (authorEl) {
          sender = authorEl.textContent.trim();
        }
      }

      const textEl = el.querySelector(".selectable-text") || el.querySelector("span._ao3e") || copyable;
      if (textEl) {
        rawText = textEl.textContent.trim();
      } else {
        rawText = el.textContent ? el.textContent.trim() : "";
      }

      const msgId = el.getAttribute("data-id") ||
                    el.closest("[data-id]")?.getAttribute("data-id") ||
                    `${sender}_${rawText.slice(0, 30)}_${rawText.length}`;

      return { sender, rawText, msgId, timeInfo };
    } catch (_) {
      return { sender: "", rawText: "", msgId: String(Date.now()), timeInfo: "" };
    }
  }

  function inspectMessage(el) {
    if (!el || !(el instanceof HTMLElement)) return;

    try {
      const { sender, rawText, msgId } = parseMessageElement(el);
      if (!rawText || processedMsgIds.has(msgId)) return;

      processedMsgIds.add(msgId);

      const activeGroup = getActiveChatName();

      if (settings.whatsappGroupFilter && settings.whatsappGroupFilter.trim()) {
        const filter = settings.whatsappGroupFilter.trim().toLowerCase();
        if (!activeGroup.toLowerCase().includes(filter)) {
          return;
        }
      }

      const matchedKw = matchesKeywords(rawText);
      const isGroupMessage = activeGroup && !activeGroup.toLowerCase().includes("mimi sandora");
      const hasHelpIntent = /\b(kendala|permohonan|mohon|bantuan|tolong|vm|server|cloud|ram|cpu|disk|down|rusak|error|ip|akses|backup|restore|waf)\b/i.test(rawText);

      if (matchedKw || (isGroupMessage && hasHelpIntent && rawText.length > 15)) {
        const effectiveKw = matchedKw || "Aduan Grup WA";
        console.log(`[GC 1 Sentinel] 💬 Aduan WA Dideteksi: [${sender || "Member"}] di grup [${activeGroup}]: ${rawText}`);

        // 1. Kirim alert ke internal extension / monitor bus
        safeSendMessage({
          type: "NEW_ALERT",
          data: {
            source: "whatsapp",
            sender: sender || "Member Grup",
            group: activeGroup || "Grup WhatsApp",
            text: rawText,
            matchedKeyword: effectiveKw,
            ticketId: ""
          }
        });

        // 2. OTOMATIS KONVERSI PESAN ADUAN WA MENJADI TIKET DI DASHBOARD
        try {
          fetch("http://localhost:8765/api/add_wa_ticket", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sender: sender || "Member Grup WA",
              group: activeGroup || "Grup WhatsApp",
              text: rawText,
              matchedKeyword: effectiveKw
            })
          }).then(res => res.json()).then(data => {
            if (data && data.status === "success") {
              console.log(`[GC 1 Sentinel] ✅ Tiket Baru Berhasil Masuk ke Dashboard: ${data.ticket?.ticketId}`);
            }
          }).catch(() => {});
        } catch (_) {}
      }
    } catch (_) {}
  }

  function scanVisibleMessages() {
    try {
      const messages = document.querySelectorAll(
        '#main div[data-testid="msg-container"], #main div.message-in, #main div[role="row"], #main .copyable-text'
      );
      if (messages) {
        messages.forEach((msg) => inspectMessage(msg));
      }
    } catch (_) {}
  }

  function setupObserver() {
    try {
      const targetNode = document.querySelector("#app") || document.body;
      if (!targetNode) return;

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.addedNodes.length) {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.matches?.('[data-testid="msg-container"], .message-in, .copyable-text, [role="row"]')) {
                  inspectMessage(node);
                } else {
                  const subMsgs = node.querySelectorAll?.('[data-testid="msg-container"], .message-in, .copyable-text');
                  if (subMsgs && subMsgs.length > 0) {
                    subMsgs.forEach((sm) => inspectMessage(sm));
                  }
                }
              }
            });
          }
        }
      });

      observer.observe(targetNode, {
        childList: true,
        subtree: true
      });
    } catch (_) {}
  }

  /**
   * Navigasi ke kontak target (misal: "mimi Sandora") jika belum aktif
   */
  async function ensureTargetChat(targetName) {
    if (!targetName) return true;

    const currentChat = getActiveChatName().toLowerCase();
    const targetLower = targetName.toLowerCase();

    // Jika chat yang aktif sudah cocok (mengandung "mimi" atau "sandora")
    if (currentChat.includes(targetLower) || (targetLower.includes("mimi") && currentChat.includes("mimi"))) {
      console.log(`[GC 1 Sentinel] Chat '${targetName}' sudah aktif di layar.`);
      return true;
    }

    console.log(`[GC 1 Sentinel] Mencari kontak '${targetName}' di WhatsApp Web...`);

    const searchInput = document.querySelector('div[contenteditable="true"][data-tab="3"]') ||
                        document.querySelector('div[data-testid="chat-list-search"]') ||
                        document.querySelector('#side div[role="textbox"]');

    if (searchInput) {
      searchInput.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, targetName);
      searchInput.dispatchEvent(new InputEvent('input', { bubbles: true }));

      await new Promise((r) => setTimeout(r, 1000));

      const chatCells = document.querySelectorAll('#side div[role="listitem"], #side [data-testid="cell-frame-container"]');
      for (const cell of chatCells) {
        const text = cell.innerText.toLowerCase();
        if (text.includes(targetLower) || (targetLower.includes("mimi") && text.includes("mimi"))) {
          cell.click();
          console.log(`[GC 1 Sentinel] Berhasil membuka chat '${targetName}'.`);
          await new Promise((r) => setTimeout(r, 800));
          return true;
        }
      }
    }

    console.warn(`[GC 1 Sentinel] Kontak '${targetName}' tidak ditemukan via pencarian, mengetik di chat yang sedang aktif.`);
    return true;
  }

  /**
   * Mengetikkan teks ke input WhatsApp dan mengirimkannya (Anti-Spam Protected)
   */
  async function insertTextIntoWA(text, autoSend, targetName, messageId) {
    if (isSending) {
      console.warn("[GC 1 Sentinel Anti-Spam] Proses pengiriman lain sedang berjalan. Diabaikan.");
      return false;
    }

    const textSignature = hashText(text.trim());
    const sentSigs = getSentSignatures();

    // ANTI-SPAM GUARD: Cek apakah teks pesan ini persis sama dengan yang pernah dikirim
    if (sentSigs.has(textSignature) || (messageId && sentSigs.has(messageId))) {
      console.log("[GC 1 Sentinel Anti-Spam] Pesan ini sudah pernah dikirim sebelumnya. Mencegah spam.");
      return true;
    }

    isSending = true;

    try {
      if (targetName) {
        await ensureTargetChat(targetName);
      }

      const inputEl = document.querySelector('footer div[contenteditable="true"]') ||
                      document.querySelector('div[data-testid="conversation-compose-box-input"]') ||
                      document.querySelector('div[aria-placeholder="Type a message"]');

      if (!inputEl) {
        console.warn("[GC 1 Sentinel] Kolom input chat WhatsApp tidak ditemukan.");
        isSending = false;
        return false;
      }

      inputEl.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      inputEl.dispatchEvent(new InputEvent('input', { bubbles: true }));

      console.log("[GC 1 Sentinel] Teks rekap berhasil dimasukkan ke chat.");

      if (autoSend) {
        await new Promise((r) => setTimeout(r, 600));
        const sendBtn = document.querySelector('footer button span[data-icon="send"]')?.closest('button') ||
                        document.querySelector('footer button[aria-label="Send"]') ||
                        document.querySelector('footer button span[data-testid="send"]')?.closest('button');

        if (sendBtn) {
          sendBtn.click();
          console.log("[GC 1 Sentinel] ✅ Tombol Kirim diklik otomatis! Rekap terkirim ke mimi Sandora.");
        } else {
          const enterEvent = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            keyCode: 13,
            which: 13,
            key: 'Enter'
          });
          inputEl.dispatchEvent(enterEvent);
          console.log("[GC 1 Sentinel] ✅ Enter event dispatched. Rekap terkirim ke mimi Sandora.");
        }
      }

      // Catat ke riwayat anti-spam lokal agar pesan tidak pernah dikirim ulang
      recordSentSignature(textSignature);
      if (messageId) {
        recordSentSignature(messageId);
      }

      isSending = false;
      return true;
    } catch (e) {
      console.warn("[GC 1 Sentinel] Gagal memproses pengiriman WA:", e);
      isSending = false;
      return false;
    }
  }

  /**
   * Polling antrean WhatsApp dari Sentinel Server (Atomic Lock Protected)
   */
  async function pollWaQueue() {
    if (isSending) {
      // Jika sedang dalam proses mengetik/mengirim, tunda polling berikutnya
      setTimeout(pollWaQueue, 4000);
      return;
    }

    try {
      const resp = await fetch("http://localhost:8765/api/wa_queue");
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.has_message && data.message) {
          const msg = data.message;
          const textSig = hashText(msg.text.trim());
          const sentSigs = getSentSignatures();

          // Cek anti-spam sebelum melakukan apa pun
          if (sentSigs.has(textSig) || sentSigs.has(msg.id)) {
            console.log(`[GC 1 Sentinel Anti-Spam] Pesan ${msg.id} sudah pernah dikirim. Melewati pengiriman.`);
            fetch(`http://localhost:8765/api/wa_done?id=${encodeURIComponent(msg.id)}&status=skipped_duplicate`).catch(() => {});
          } else {
            console.log(`[GC 1 Sentinel] Memproses pesan antrean baru untuk '${msg.target}'...`);
            const success = await insertTextIntoWA(msg.text, msg.auto_send !== false, msg.target, msg.id);

            // Laporkan status via GET (tanpa CORS preflight) dan POST
            const statusStr = success ? "sent" : "error";
            fetch(`http://localhost:8765/api/wa_done?id=${encodeURIComponent(msg.id)}&status=${statusStr}`).catch(() => {});
            fetch("http://localhost:8765/api/wa_status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: msg.id,
                target: msg.target,
                status: statusStr
              })
            }).catch(() => {});
          }
        }
      }
    } catch (_) {}

    setTimeout(pollWaQueue, 4000);
  }

  // Listener untuk perintah manual via BroadcastChannel
  try {
    const bus = new BroadcastChannel("gc1_sentinel_bus");
    bus.onmessage = async (event) => {
      if (event.data?.type === "PASTE_AND_SEND_WA" && event.data?.text) {
        await insertTextIntoWA(event.data.text, event.data.autoSend !== false, event.data.target || "mimi Sandora", event.data.id);
      }
    };
  } catch (_) {}

  // Listener untuk perintah manual via Chrome Extension messaging
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResp) => {
      if (msg.type === "PASTE_AND_SEND_WA" && msg.text) {
        insertTextIntoWA(msg.text, msg.autoSend !== false, msg.target || "mimi Sandora", msg.id).then((ok) => {
          sendResp({ status: ok ? "ok" : "error" });
        });
        return true;
      }
    });
  }

  async function init() {
    await loadSettings();
    setTimeout(() => {
      scanVisibleMessages();
      setupObserver();
      pollWaQueue();
    }, 2500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
