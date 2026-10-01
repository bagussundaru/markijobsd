/**
 * GC 1 Sentinel - pustaka grafik SVG ringan (tanpa dependensi, tanpa CDN: jalan offline di Mini PC).
 * Semua teks yang dirender di-escape. Grafik responsif lewat viewBox.
 */
(function (root) {
  "use strict";

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const COLORS = {
    itsm: "#2563EB", wa: "#10B981", total: "#0F172A",
    Critical: "#DC2626", Major: "#F59E0B", Minor: "#0EA5E9", "Service Request": "#8B5CF6",
    Assigned: "#2563EB", "Pending Approval": "#F59E0B", "In Progress": "#8B5CF6", Selesai: "#10B981", "On-Hold": "#64748B",
    "Menunggu balasan": "#F59E0B", "Sudah dibalas": "#10B981", "Tertaut ke tiket ITSM": "#2563EB", "Ditolak (bukan tenan)": "#DC2626",
    "≤ 5 menit": "#10B981", "5-10 menit": "#F59E0B", "> 10 menit": "#DC2626", "Belum dibalas": "#94A3B8",
  };
  const FALLBACK = ["#2563EB", "#10B981", "#F59E0B", "#8B5CF6", "#0EA5E9", "#DC2626", "#64748B", "#14B8A6"];
  const colorFor = (k, i) => COLORS[k] || FALLBACK[i % FALLBACK.length];

  function empty(el, msg) {
    el.innerHTML = `<div class="ch-empty">${esc(msg || "Belum ada data pada periode ini")}</div>`;
  }

  function niceMax(v) {
    if (v <= 4) return 4;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  /** Kolom bertumpuk: {labels, series:[{name,color,values}], height} */
  function stackedBars(el, cfg) {
    const labels = cfg.labels || [];
    const series = cfg.series || [];
    const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
    const max = Math.max(...totals, 0);
    if (!labels.length || max === 0) return empty(el);
    const W = 640, H = cfg.height || 250, L = 34, R = 8, T = 10, B = 28;
    const pw = W - L - R, ph = H - T - B;
    const yMax = niceMax(max);
    const bw = pw / labels.length;
    const barW = Math.max(4, bw * 0.62);
    const every = Math.ceil(labels.length / 12);
    let g = "";
    for (let i = 0; i <= 4; i++) {
      const y = T + ph - (ph * i) / 4;
      g += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="ch-grid"/><text x="${L - 6}" y="${y + 3.5}" class="ch-axis" text-anchor="end">${Math.round((yMax * i) / 4)}</text>`;
    }
    let bars = "";
    labels.forEach((lb, i) => {
      const x = L + bw * i + (bw - barW) / 2;
      let acc = 0;
      series.forEach((s) => {
        const v = s.values[i] || 0;
        if (!v) return;
        const h = (v / yMax) * ph;
        const y = T + ph - ((acc + v) / yMax) * ph;
        bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${s.color}" class="ch-bar"><title>${esc(lb)}: ${esc(s.name)} ${v}</title></rect>`;
        acc += v;
      });
      if (i % every === 0) bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 9}" class="ch-axis" text-anchor="middle">${esc(lb)}</text>`;
    });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="ch-svg" role="img" aria-label="${esc(cfg.aria || "Grafik batang")}">${g}${bars}</svg>`;
  }

  /** Donat: {items:[{label,value,color?}], centerValue, centerLabel} + legenda HTML */
  function donut(el, cfg) {
    const items = (cfg.items || []).filter((x) => x.value > 0);
    const total = items.reduce((a, x) => a + x.value, 0);
    if (!total) return empty(el);
    const r = 54, C = 2 * Math.PI * r;
    let off = 0, arcs = "";
    items.forEach((x, i) => {
      const len = (x.value / total) * C;
      arcs += `<circle cx="80" cy="80" r="${r}" fill="none" stroke="${x.color || colorFor(x.label, i)}" stroke-width="22" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 80 80)" class="ch-arc"><title>${esc(x.label)}: ${x.value}</title></circle>`;
      off += len;
    });
    const legend = items.map((x, i) => `<li><span class="ch-dot" style="background:${x.color || colorFor(x.label, i)}"></span><span class="ch-lg-l">${esc(x.label)}</span><b>${x.value}</b></li>`).join("");
    el.innerHTML = `<div class="ch-donut"><svg viewBox="0 0 160 160" class="ch-svg ch-donut-svg" role="img" aria-label="${esc(cfg.aria || "Grafik donat")}">
      <circle cx="80" cy="80" r="${r}" fill="none" stroke="#EEF2F7" stroke-width="22"/>${arcs}
      <text x="80" y="82" text-anchor="middle" class="ch-center-v">${esc(cfg.centerValue ?? total)}</text>
      <text x="80" y="99" text-anchor="middle" class="ch-center-l">${esc(cfg.centerLabel || "total")}</text></svg><ul class="ch-legend">${legend}</ul></div>`;
  }

  /** Batang horizontal: {items:[{label,value,color?}], suffix} */
  function hbars(el, cfg) {
    const items = (cfg.items || []).filter((x) => x.value !== null && x.value !== undefined);
    if (!items.length || items.every((x) => !x.value)) return empty(el);
    const max = cfg.max || Math.max(...items.map((x) => x.value), 1);
    el.innerHTML = `<div class="ch-hbars">${items.map((x, i) => `
      <div class="ch-hrow" title="${esc(x.label)}: ${x.value}${esc(cfg.suffix || "")}">
        <span class="ch-hl">${esc(x.label)}</span>
        <span class="ch-htrack"><span class="ch-hfill" style="width:${Math.max(2, (x.value / max) * 100).toFixed(1)}%;background:${x.color || colorFor(x.label, i)}"></span></span>
        <b class="ch-hv">${x.value}${esc(cfg.suffix || "")}</b></div>`).join("")}</div>`;
  }

  /** Setengah lingkaran: {value (0..100|null), target, label, sub} */
  function gauge(el, cfg) {
    const v = cfg.value;
    if (v === null || v === undefined) return empty(el, cfg.emptyText || "Belum cukup data");
    const clamp = Math.max(0, Math.min(100, v));
    const R = 62, cx = 80, cy = 78;
    const pt = (pct) => { const a = Math.PI * (1 - pct / 100); return [cx + R * Math.cos(a), cy - R * Math.sin(a)]; };
    const [sx, sy] = pt(0), [ex, ey] = pt(100), [vx, vy] = pt(clamp);
    const ok = cfg.target === undefined || clamp >= cfg.target;
    const col = ok ? "#10B981" : clamp >= (cfg.target || 0) - 10 ? "#F59E0B" : "#DC2626";
    let tick = "";
    if (cfg.target !== undefined) {
      const [tx, ty] = pt(cfg.target), [tx2, ty2] = [cx + (R + 9) * Math.cos(Math.PI * (1 - cfg.target / 100)), cy - (R + 9) * Math.sin(Math.PI * (1 - cfg.target / 100))];
      tick = `<line x1="${tx.toFixed(1)}" y1="${ty.toFixed(1)}" x2="${tx2.toFixed(1)}" y2="${ty2.toFixed(1)}" stroke="#334155" stroke-width="2"><title>Target ${cfg.target}%</title></line>`;
    }
    el.innerHTML = `<div class="ch-gauge"><svg viewBox="0 0 160 100" class="ch-svg" role="img" aria-label="${esc(cfg.label)}">
      <path d="M ${sx} ${sy} A ${R} ${R} 0 0 1 ${ex} ${ey}" fill="none" stroke="#EEF2F7" stroke-width="14" stroke-linecap="round"/>
      <path d="M ${sx} ${sy} A ${R} ${R} 0 0 1 ${vx.toFixed(1)} ${vy.toFixed(1)}" fill="none" stroke="${col}" stroke-width="14" stroke-linecap="round"/>${tick}
      <text x="80" y="76" text-anchor="middle" class="ch-gauge-v" fill="${col}">${clamp}%</text></svg>
      <div class="ch-gauge-l"><b>${esc(cfg.label)}</b><span>${esc(cfg.sub || "")}</span></div></div>`;
  }

  root.GC1Charts = { stackedBars, donut, hbars, gauge, empty, colors: COLORS, colorFor, esc };
})(typeof self !== "undefined" ? self : this);
