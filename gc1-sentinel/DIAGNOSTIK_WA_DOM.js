/*
 * Diagnostik struktur WhatsApp Web (tanpa isi pesan).
 * Cara pakai: buka web.whatsapp.com, buka satu grup, tekan F12 > Console, tempel seluruh isi file ini, Enter.
 * Hasilnya (JSON) disalin ke clipboard. Kirim hasilnya ke Claude untuk menyesuaikan selektor ekstensi.
 * Isi pesan, nama orang, dan nama grup TIDAK ikut: teks diganti panjang karakternya saja.
 */
(() => {
  const attrs = (el) => {
    const o = {};
    for (const a of el.attributes) {
      if (/^(class|role|data-id|data-testid|data-pre-plain-text|aria-label|dir|tabindex)$/.test(a.name)) {
        o[a.name] = a.name === "data-pre-plain-text" ? a.value.replace(/[A-Za-z]{2,}/g, "x") : a.name === "data-id" ? a.value.replace(/[0-9A-Fa-f@.]{8,}/g, "ID") : a.value.slice(0, 120);
      }
    }
    return o;
  };
  const walk = (el, depth) => {
    const node = { tag: el.tagName.toLowerCase(), ...attrs(el) };
    if (!el.children.length) node.textLen = (el.textContent || "").length;
    if (depth > 0 && el.children.length) node.children = [...el.children].slice(0, 8).map((c) => walk(c, depth - 1));
    return node;
  };
  const msgs = [...document.querySelectorAll("#main [data-id]")].slice(-4);
  const rows = [...document.querySelectorAll("#pane-side [role='listitem'], #pane-side [role='row']")].slice(0, 3);
  const out = {
    ua: navigator.userAgent.slice(0, 80),
    hasMain: !!document.querySelector("#main"),
    headerTitle: walk(document.querySelector("#main header") || document.body, 3),
    messages: msgs.map((m) => walk(m, 6)),
    chatListRows: rows.map((r) => walk(r, 5)),
  };
  const json = JSON.stringify(out, null, 1);
  copy(json);
  console.log("Disalin ke clipboard (" + json.length + " karakter).");
})();
