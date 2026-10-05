/**
 * GC 1 Sentinel - pengurai teks WhatsApp yang ditempel operator (fungsi murni, dapat diuji di Node).
 *
 * Format yang dikenali (salinan dari WhatsApp Web/ponsel atau ekspor chat):
 *   [16:22, 30/09/2026] Nama: pesan          (Web/iOS)
 *   [30/09/2026 16.22.10] Nama: pesan        (iOS)
 *   30/09/2026 16.22 - Nama: pesan           (ekspor Android)
 *   9/30/26, 4:22 PM - Nama: pesan           (ekspor Android, locale AS)
 * Baris tanpa awalan dianggap lanjutan pesan sebelumnya. Teks tanpa awalan sama sekali dianggap SATU pesan,
 * dengan pengirim dan waktu dari isian formulir.
 */
(function (root) {
  "use strict";

  const D = "(\\d{1,4}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{1,4})";
  const T = "(\\d{1,2}[:.]\\d{2}(?:[:.]\\d{2})?\\s*(?:[AaPp]\\.?[Mm]\\.?)?)";
  const S = "([^:\\[\\]]{1,80}?)";
  const HEADERS = [
    { re: new RegExp("^\\[" + D + ",?\\s+" + T + "\\]\\s*" + S + ":\\s?(.*)$"), order: "dt" },
    { re: new RegExp("^\\[" + T + ",?\\s+" + D + "\\]\\s*" + S + ":\\s?(.*)$"), order: "td" },
    { re: new RegExp("^" + D + ",?\\s+" + T + "\\s+-\\s+" + S + ":\\s?(.*)$"), order: "dt" },
  ];

  /** Tanggal + jam -> epoch detik. d/m vs m/d yang ambigu diselesaikan: bukan masa depan, paling dekat dengan sekarang. */
  function toEpoch(dateStr, timeStr, nowMs) {
    const d = /(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})/.exec(dateStr);
    const t = /(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([AaPp])?/.exec(timeStr);
    if (!d || !t) return null;
    let hh = parseInt(t[1], 10);
    const mm = parseInt(t[2], 10);
    const ss = t[3] ? parseInt(t[3], 10) : 0;
    if (t[4]) {
      const pm = t[4].toLowerCase() === "p";
      if (pm && hh < 12) hh += 12;
      if (!pm && hh === 12) hh = 0;
    }
    const a = parseInt(d[1], 10), b = parseInt(d[2], 10), c = parseInt(d[3], 10);
    const cands = [];
    if (a > 31) cands.push([a, b, c]);                      // yyyy/mm/dd
    else {
      const y = c < 100 ? 2000 + c : c;
      cands.push([y, b, a]);                                // d/m/yyyy
      cands.push([y, a, b]);                                // m/d/yyyy
    }
    const now = nowMs || Date.now();
    let best = null;
    for (const [y, mo, da] of cands) {
      if (mo < 1 || mo > 12 || da < 1 || da > 31) continue;
      const ts = new Date(y, mo - 1, da, hh, mm, ss).getTime();
      if (ts > now + 5 * 60 * 1000) continue;
      if (best === null || Math.abs(now - ts) < Math.abs(now - best)) best = ts;
    }
    return best === null ? null : Math.floor(best / 1000);
  }

  function parseWaPaste(raw, nowMs) {
    const lines = String(raw || "").replace(/\r/g, "").split("\n");
    const messages = [];
    let cur = null;
    let hadHeaders = false;
    for (const line of lines) {
      let hit = null;
      for (const h of HEADERS) {
        const m = h.re.exec(line.trim());
        if (m) {
          hit = h.order === "dt" ? { date: m[1], time: m[2], sender: m[3], text: m[4] } : { time: m[1], date: m[2], sender: m[3], text: m[4] };
          break;
        }
      }
      if (hit) {
        hadHeaders = true;
        cur = { sender: hit.sender.trim(), text: hit.text, ts: toEpoch(hit.date, hit.time, nowMs) };
        messages.push(cur);
      } else if (cur && line.trim()) {
        cur.text += "\n" + line;
      }
    }
    if (!hadHeaders) {
      const text = String(raw || "").trim();
      return { hadHeaders: false, messages: text ? [{ sender: "", text, ts: null }] : [] };
    }
    for (const m of messages) m.text = m.text.trim();
    return { hadHeaders: true, messages: messages.filter((m) => m.text) };
  }

  /** Hash ringan untuk id pesan manual (tempel ulang teks yang sama tidak membuat tiket ganda). */
  function hashKey(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  const api = { parseWaPaste, toEpoch, hashKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.GC1Paste = api;
})(typeof self !== "undefined" ? self : this);
