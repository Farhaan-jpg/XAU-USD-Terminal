/* XAUUSD Analysis Terminal — frontend logic */
"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const POLL = { quotes: 10000, bias: 25000, news: 90000, calendar: 600000, candles: 25000 };

const state = {
  quotes: null,
  bias: null,
  news: [],
  calendar: [],
  candles: [],
  loaded: { quotes: false, bias: false, news: false, calendar: false },
  failCount: { quotes: 0, bias: 0, news: 0, calendar: 0, candles: 0 },
  prevSpot: null,
  filters: { news: "all", calendar: "all", calHideOld: true },
  chartTf: "5",
  chartNa: false,
};

/* ---------------- helpers ---------------- */

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const pad = (n, w = 2) => String(n).padStart(w, "0");

function fmtPrice(v, dp) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function dpFor(sym) {
  if (!sym) return 2;
  const s = sym.toUpperCase();
  if (s.startsWith("GC") || s === "XAU") return 2;
  if (s.includes("=X") && !s.startsWith("USD")) return 4;
  if (s === "DX-Y.NYB" || s === "^TNX" || s === "^IRX" || s === "^TYX") return 3;
  if (s === "^VIX") return 2;
  if (s.startsWith("SI")) return 2;
  if (s === "BTC-USD") return 0;
  return 2;
}

const chgCls = (v) => (v == null ? "flat" : v > 0.0001 ? "up" : v < -0.0001 ? "down" : "flat");
const signStr = (v) => (v == null ? "" : (v > 0 ? "+" : "") + v);

function fmtAgo(ts) {
  if (!ts) return "—";
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return Math.max(0, Math.round(d)) + "s";
  if (d < 3600) return Math.round(d / 60) + "m";
  if (d < 86400) return Math.round(d / 3600) + "h";
  return Math.round(d / 86400) + "d";
}

function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function dayLabel(ts) {
  const d = new Date(ts);
  const today = dayKey(Date.now());
  const diff = Math.round((new Date(today + "T00:00:00Z") - new Date(dayKey(d) + "T00:00:00Z")) / 86400000);
  const wd = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getUTCDay()];
  if (diff === 0) return wd + " · TODAY";
  if (diff === 1) return wd + " · TOMORROW";
  return `${wd} ${pad(d.getUTCDate())} ${["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/* ---------------- fetch wrappers ---------------- */

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

/* ---------------- header / quotes ---------------- */

function renderQuotes(d) {
  state.quotes = d;
  const spot = d.spot;
  const fut = d.futures || {};
  const spotP = spot && spot.price;
  const futP = fut.price;

  const el = $("#spotPrice");
  if (spotP != null) {
    const old = state.prevSpot;
    el.textContent = fmtPrice(spotP, 2);
    if (old != null && spotP !== old) {
      el.classList.remove("flash-up", "flash-down");
      void el.offsetWidth;
      el.classList.add(spotP > old ? "flash-up" : "flash-down");
    }
    state.prevSpot = spotP;
  }
  $("#spotProvider").textContent = spot ? (":" + (spot.provider || "gold-api")) : "";
  $("#spotChg").textContent = fut.chgPct != null ? signStr(fut.chgPct.toFixed(2)) + "%" : "";
  $("#spotChg").className = "q-chg num " + chgCls(fut.chgPct);
  $("#spotRange").textContent =
    fut.dayHigh != null && fut.dayLow != null
      ? `Day  ${fmtPrice(fut.dayLow, 2)} – ${fmtPrice(fut.dayHigh, 2)} · Prev ${fmtPrice(fut.prevClose, 2)}`
      : "…";

  $("#futPrice").textContent = futP != null ? fmtPrice(futP, 2) : "—";
  $("#futChg").textContent = fut.chg != null ? signStr(fut.chg.toFixed(2)) : "";
  $("#futChg").className = "q-chg q-chg-sm num " + chgCls(fut.chg);

  if (spotP != null && futP != null) {
    const spr = futP - spotP;
    $("#spreadVal").textContent = fmtPrice(spr, 2);
    $("#spreadVal").className = "q-price q-sm num " + (spr > 0 ? "up" : spr < 0 ? "down" : "flat");
  }

  d.sessions && Object.entries({ sesAsia: d.sessions.asia, sesLondon: d.sessions.london, sesNy: d.sessions.newYork, sesWknd: d.sessions.weekend }).forEach(([id, on]) => {
    const el2 = $("#" + id);
    if (el2) {
      el2.classList.toggle("open", !!on);
      if (id === "sesWknd") el2.textContent = on ? "CLSD" : "Open";
    }
  });

  $("#corrSub").textContent = "Spot " + (spotP != null ? fmtPrice(spotP, 2) : "—") + " · " + (fut.chgPct != null ? signStr(fut.chgPct.toFixed(2)) : "") + "%";

  renderTicker(d);
  renderCorrelations(d);
  renderEtf(d);

  if (spotP != null) document.title = `XAU ${fmtPrice(spotP, 2)} · ${chgCls(fut.chgPct).toUpperCase()} · Terminal`;
}

function buildTickerHtml(d) {
  const items = [];
  if (d.spot && d.spot.price != null) items.push(["XAUUSD", d.spot.price, d.futures ? d.futures.chgPct : null, 2]);
  if (d.futures && d.futures.price != null) items.push(["GC=F", d.futures.price, d.futures.chgPct, 2]);
  if (d.etfs) d.etfs.forEach((e) => { if (e.price != null) items.push([e.symbol, e.price, e.chgPct, 2]); });
  for (const c of d.correlated || []) {
    if (c.price != null) items.push([c.symbol, c.price, c.chgPct, dpFor(c.symbol)]);
  }
  return items
    .map(
      ([s, p, ch, dp]) =>
        `<span class="tk-item"><span class="tk-sym">${esc(s)}</span><span class="tk-price num">${fmtPrice(p, dp)}</span><span class="tk-chg num ${chgCls(ch)}">${ch != null ? signStr(ch.toFixed(2)) + "%" : "—"}</span></span>`
    )
    .join("");
}

function renderTicker(d) {
  const html = buildTickerHtml(d);
  const track = $("#tickerTrack");
  if (!state.tickerInit) {
    track.innerHTML = `<div class="tk-grp">${html}</div><div class="tk-grp" aria-hidden="true">${html}</div>`;
    state.tickerInit = true;
  } else {
    const grps = track.children;
    for (let i = 0; i < grps.length && i < 2; i++) grps[i].innerHTML = html;
  }
}

function renderCorrelations(d) {
  const b = $("#corrBody");
  if (!b) return;
  b.innerHTML = (d.correlated || [])
    .map(
      (c, i) => `<div class="corr-row">
        <div class="corr-name"><b>${esc(c.name || c.symbol)}</b><span class="corr-sym">${esc(c.symbol)}</span></div>
        <div class="corr-price num">${fmtPrice(c.price, dpFor(c.symbol))}</div>
        <div class="corr-chg num ${chgCls(c.chgPct)}">${c.chgPct != null ? signStr(c.chgPct.toFixed(2)) + "%" : "—"}</div>
        <div style="text-align:right;color:var(--muted2);font-size:10px">${c.stale ? "stale" : ""}</div>
      </div>`
    )
    .join("");
  if (!d.correlated || !d.correlated.length) b.innerHTML = '<div class="empty">loading correlated markets…</div>';
  const note = $(".corr-note");
  if (!note) {
    const nm = document.createElement("div");
    nm.className = "corr-note";
    nm.innerHTML = "Dollar <b>up</b> ⇒ gold under pressure · Yields up ⇒ drags on gold. Correlations are real-time price relationships.";
    b.appendChild(nm);
  }
}

function renderEtf(d) {
  const b = $("#instEtf");
  if (!b || !d.etfs) return;
  b.innerHTML = d.etfs
    .map((e) => `<div class="etf-row"><div class="etf-name"><b>${esc(e.name || e.symbol)}</b>${e.symbol}</div>
      <div class="etf-price num">${fmtPrice(e.price, 2)}</div>
      <div class="etf-chg num ${chgCls(e.chgPct)}">${e.chgPct != null ? signStr(e.chgPct.toFixed(2)) + "%" : "—"}</div></div>`)
    .join("");
}

/* ---------------- bias ---------------- */

const BADGE_CLS = {
  "Strong Bullish": "sb",
  "Bullish": "b",
  "Neutral / Mixed": "n",
  "Bearish": "be",
  "Strong Bearish": "sbe",
};

function gauge(container, scorePct) {
  let svg = container.querySelector("svg");
  if (!svg) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    container.appendChild(svg);
  }
  svg.setAttribute("viewBox", "0 0 300 168");
  svg.setAttribute("role", "img");
  const cx = 150, cy = 148, r = 122;
  const a = (p) => Math.PI - (p / 100) * Math.PI;
  const pt = (p, rad) => {
    const ang = a(p);
    return [cx + Math.cos(ang) * rad, cy - Math.sin(ang) * rad];
  };
  const arc = (p1, p2, rad, col, op) => {
    const [x1, y1] = pt(p1, rad);
    const [x2, y2] = pt(p2, rad);
    const large = Math.abs(p1 - p2) > 50 ? 1 : 0;
    return `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rad} ${rad} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}" stroke="${col}" stroke-opacity="${op}" stroke-width="16" fill="none" stroke-linecap="round"/>`;
  };
  const zones = arc(0, 100, r, "#1c2836", 0.9) +
    arc(0, 33, r, "#ff5f6e", 0.25) +
    arc(33, 67, r, "#7c6a1f", 0.18) +
    arc(67, 100, r, "#2dd08b", 0.28);
  const ticks = [0, 25, 50, 75, 100]
    .map((p) => {
      const [x1, y1] = pt(p, r - 10);
      const [x2, y2] = pt(p, r - 20);
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#4c5c70" stroke-width="1.4"/>`;
    })
    .join("");
  const [nx, ny] = pt(scorePct, r - 30);
  const needle = `<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#f0b90b" stroke-width="3" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="5" fill="#f0b90b"/>`;
  const labels =
    `<text x="10" y="${cy - 12}" font-size="10" fill="#71839a" font-family="Consolas,monospace" font-weight="700">BEAR</text>` +
    `<text x="270" y="${cy - 12}" font-size="10" fill="#71839a" font-family="Consolas,monospace" text-anchor="end" font-weight="700">BULL</text>` +
    `<text x="150" y="${cy - 14}" font-size="9" fill="#4c5c70" font-family="Consolas,monospace" text-anchor="middle">NEU</text>`;
  svg.setAttribute("aria-label", "Market bias gauge " + Math.round(scorePct));
  svg.innerHTML = `${zones}${ticks}${needle}${labels}`;
}

function renderBias(d) {
  state.bias = d;
  $("#biasAsoOf").textContent = "updated " + fmtAgo(d.asof) + " ago";
  const pct = d.scorePct;
  $("#biasScore").textContent = Number.isFinite(pct) ? pct.toFixed(0) : "–";
  const badge = $("#biasLabel");
  badge.textContent = d.label;
  badge.className = "g-badge " + (BADGE_CLS[d.label] || "n");
  $("#biasConf").textContent = d.confidence != null ? Math.round(d.confidence * 100) + "%" : "–";
  gauge($("#biasGauge"), pct);
  $("#biasDrivers").innerHTML = (d.drivers || []).map((x) => `<li><b>${esc(x)}</b></li>`).join("") || "<li>computing…</li>";

  const mx = $("#signalMatrix");
  mx.innerHTML = (d.signals || [])
    .map((s) => {
      const dir = s.arrow === "up" ? "▲" : s.arrow === "down" ? "▼" : "▬";
      const dCls = s.arrow === "up" ? "up" : s.arrow === "down" ? "down" : "flat";
      return `<div class="matrix-row">
        <span>${esc(s.label)}</span>
        <span class="m-val ${dCls}">${esc(s.display)}</span>
        <span class="m-w">${s.weight}</span>
        <span class="m-dir ${dCls}">${dir}</span>
      </div>`;
    })
    .join("");

  const sw = d.sourceFreshness || {};
  const dots = Object.keys(sw)
    .map((k) => `<span title="${k}: ${sw[k] ? "fresh" : "stale"}" style="color:${sw[k] ? "var(--up)" : "var(--down)"}">◆</span>`)
    .join("");
  const fs = $("#footSources");
  fs.innerHTML = `<span>spot ${esc(d.spotBasis)}</span> · <span>technicals ${esc(d.basis.technicals)}</span> ` + dots;
}

function drawSpark(data, vw) {
  const svg = $("#biasSpark");
  if (!svg) return;
  if (!data || data.length < 2) {
    svg.innerHTML = "";
    return;
  }
  const W = 300, H = 56, padY = 4;
  const closes = data.map((c) => c.c);
  let lo = Math.min(...closes);
  let hi = Math.max(...closes);
  if (vw != null) { lo = Math.min(lo, vw); hi = Math.max(hi, vw); }
  const span = hi - lo || 1;
  const X = (i) => (i / (data.length - 1)) * W;
  const Y = (v) => H - padY - ((v - lo) / span) * (H - padY * 2);
  const pts = data.map((c, i) => `${X(i).toFixed(1)},${Y(c.c).toFixed(1)}`).join(" ");
  const area = `${X(0)},${H} ${pts} ${X(data.length - 1)},${H}`;
  let vwLine = "";
  if (vw != null && vw >= lo && vw <= hi) vwLine = `<line class="sp-vwap" x1="0" y1="${Y(vw).toFixed(1)}" x2="${W}" y2="${Y(vw).toFixed(1)}"/>`;
  svg.innerHTML = `<polygon class="sp-area" points="${area}"/><polyline class="sp-line" points="${pts}"/>${vwLine}`;
}

/* ---------------- levels / indicators ---------------- */

function renderLevels(d) {
  const lv = d.levels || {};
  const rows = (items) => items.map((it) => {
    const cls = it.t === "s" ? "lv-s" : it.t === "r" ? "lv-r" : it.t === "g" ? "lv-gold" : "lv-n";
    return `<div class="lv-row"><span class="lv-name">${esc(it.name)}</span><span class="lv-price ${cls} num">${it.price != null ? fmtPrice(it.price, 2) : "—"}</span><span class="lv-note">${esc(it.note || "")}</span></div>`;
  }).join("");

  const pivots = lv.pivots || {};
  let pitems = [];
  if (pivots.pivot != null) {
    pitems = [
      { name: "R3", price: pivots.r3, t: "r", note: "resistance 3" },
      { name: "R2", price: pivots.r2, t: "r", note: "resistance 2" },
      { name: "R1", price: pivots.r1, t: "r", note: "resistance 1" },
      { name: "PIVOT", price: pivots.pivot, t: "g", note: "PP (prev day)" },
      { name: "S1", price: pivots.s1, t: "s", note: "support 1" },
      { name: "S2", price: pivots.s2, t: "s", note: "support 2" },
      { name: "S3", price: pivots.s3, t: "s", note: "support 3" },
    ];
  }
  const spot = lv.spotPrice != null ? fmtPrice(lv.spotPrice, 2) : "—";
  $("#levelsSub").textContent = "spot " + spot;

  let session = [];
  if (lv.dayHigh != null || lv.dayLow != null) {
    session = [
      { name: "SESSION HIGH", price: lv.dayHigh, t: "n", note: lv.vwap != null ? `VWAP ${fmtPrice(lv.vwap, 2)}` : "" },
      { name: "SESSION LOW", price: lv.dayLow, t: "n", note: "" },
      { name: "SWING RESIST", price: lv.swingR, t: "r", note: "30d swing" },
      { name: "SWING SUPPORT", price: lv.swingS, t: "s", note: "30d swing" },
    ];
  }
  const wkly = [
    { name: "WEEK HIGH", price: lv.weekHigh, t: "n", note: "5d" },
    { name: "WEEK LOW", price: lv.weekLow, t: "n", note: "5d" },
    { name: "MONTH HIGH", price: lv.monthHigh, t: "n", note: "22d" },
    { name: "MONTH LOW", price: lv.monthLow, t: "n", note: "22d" },
    { name: "ATR(14D)", price: lv.atrD, t: "g", note: "avg true range" },
  ];
  const html =
    (session.length ? `<div class="lv-blk"><div class="lv-head">Session</div>${rows(session)}</div>` : "") +
    (pitems.length ? `<div class="lv-blk"><div class="lv-head">Classic Pivots</div>${rows(pitems)}</div>` : "") +
    `<div class="lv-blk"><div class="lv-head">Ranges</div>${rows(wkly)}</div>`;
  $("#levelsBody").innerHTML = html;
}

function indTrendRows(title, base, refs) {
  const r = refs
    .map((x) => {
      const above = base != null && x.val != null && base > x.val;
      return `<div class="ind-vs">${esc(x.label)} <b class="${above ? "up" : "down"}">${fmtPrice(x.val, 2)}</b> ${above ? "▲" : "▼"}</div>`;
    })
    .join("");
  const dir = (refs.filter((x) => base != null && x.val != null && base > x.val).length / refs.length) >= 0.5 ? "up" : "down";
  const bar = (refs.filter((x) => base != null && x.val != null && base > x.val).length / refs.length) * 100;
  return `<div class="ind-card"><div class="ind-name"><b>${title}</b></div><div class="ind-bar"><div class="fill ${dir === "up" ? "bar-green" : "bar-red"}" style="width:${(bar * 100).toFixed(0)}%"></div></div>${r}</div>`;
}

function rsiCard(title, rsi) {
  if (rsi == null) return "";
  const z = clamp(rsi, 0, 100);
  const col = rsi >= 70 ? "bar-red" : rsi <= 30 ? "bar-green" : rsi >= 50 ? "bar-gold" : "bar-blue";
  const st = rsi >= 70 ? "overbought" : rsi <= 30 ? "oversold" : rsi > 50 ? "bullish zone" : "bearish zone";
  const numCls = rsi >= 70 ? "down" : rsi <= 30 ? "up" : rsi > 50 ? "up" : "down";
  return `<div class="ind-col"><div class="ind-name"><b>RSI(14) ${title}</b></div><div class="ind-val num ${numCls}">${rsi.toFixed(1)}</div><div class="ind-bar"><div class="fill ${col}" style="width:${z.toFixed(0)}%"></div></div><div class="ind-vs">${st}</div></div>`;
}

function macdCard(title, m) {
  if (!m) return "";
  const dir = m.hist > 0 ? "up" : "down";
  const arrow = m.hist > 0 ? "▲" : "▼";
  const barw = clamp(Math.abs(m.hist) * 6, 8, 100);
  return `<div class="ind-card"><div class="ind-name"><b>MACD ${title}</b></div>
    <div class="ind-val num ${chgCls(m.hist)}">${arrow} ${m.hist.toFixed(2)}</div>
    <div class="ind-vs">fast ${m.macd.toFixed(2)} · sig ${m.signal.toFixed(2)}</div>
    <div class="ind-bar"><div class="fill ${dir === "up" ? "bar-green" : "bar-red"}" style="width:${barw.toFixed(0)}%"></div></div></div>`;
}

function renderIndicators(d) {
  const ind = d.indicators || {};
  const lv = d.levels || {};
  const base = d.spotPrice != null ? d.spotPrice : ind.futuresPrice;
  if (base == null) return;
  const h = [];

  const emaRefsD = [
    { label: "EMA50 D", val: ind.ema50D },
    { label: "EMA100 D", val: ind.ema100D },
    { label: "EMA200 D", val: ind.ema200D },
  ].filter((x) => x.val != null);
  const emaRefsH = [
    { label: "EMA20 1H", val: ind.ema20H },
    { label: "EMA50 1H", val: ind.ema50H },
  ].filter((x) => x.val != null);
  if (emaRefsD.length) h.push(indTrendRows("DAILY TREND vs EMAs", base, emaRefsD));
  if (emaRefsH.length) h.push(indTrendRows("1H TREND vs EMAs", base, emaRefsH));

  h.push(`<div class="ind-cols" style="grid-column:1/-1;display:grid">${rsiCard("1H", ind.rsiH) + rsiCard("DAILY", ind.rsiD)}</div>`);

  h.push(macdCard("1H", ind.macdH));
  h.push(macdCard("DAILY", ind.macdD));

  if (lv.vwap != null) {
    const dev = base != null ? ((base - lv.vwap) / lv.vwap) * 100 : null;
    h.push(`<div class="ind-card"><div class="ind-name"><b>VWAP (today)</b></div>
      <div class="ind-val num" style="color:var(--blue)">${fmtPrice(lv.vwap, 2)}</div>
      <div class="ind-vs ${chgCls(dev)}">${dev != null ? signStr(dev.toFixed(2)) + "% vs spot" : "—"}</div></div>`);
  }
  if (ind.sma20D != null) {
    const ab = base > ind.sma20D;
    h.push(`<div class="ind-card"><div class="ind-name"><b>SMA20 DAILY</b></div>
      <div class="ind-val num ${ab ? "up" : "down"}">${fmtPrice(ind.sma20D, 2)}</div>
      <div class="ind-vs ${ab ? "up" : "down"}">price ${ab ? "above" : "below"}</div></div>`);
  }
  if (ind.stochH) {
    const k = ind.stochH.k != null ? ind.stochH.k.toFixed(0) : "—";
    h.push(`<div class="ind-card"><div class="ind-name"><b>STOCH(14,3) 1H</b></div>
      <div class="ind-val num">${k}</div><div class="ind-vs">%K ${k} · %D ${ind.stochH.d != null ? ind.stochH.d.toFixed(0) : "—"}</div></div>`);
  }
  if (ind.atrD != null) {
    const atrPct = base != null ? (ind.atrD / base) * 100 : null;
    const vol = atrPct != null ? (atrPct > 1.5 ? "high vol" : atrPct > 0.8 ? "normal" : "low vol") : "";
    h.push(`<div class="ind-card"><div class="ind-name"><b>ATR(14) DAILY</b></div>
      <div class="ind-val num">${fmtPrice(ind.atrD, 2)}</div>
      <div class="ind-vs">${atrPct != null ? signStr(atrPct.toFixed(2)) + "% · " : ""}${vol}</div></div>`);
  }
  $("#indBody").innerHTML = h.join("");
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/* ---------------- institutional / COT ---------------- */

function fmtContracts(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1000000) return (v / 1000000).toFixed(2) + "M";
  if (abs >= 1000) return (v / 1000).toFixed(0) + "K";
  return v.toFixed(0);
}

function renderCot(d) {
  const c = d.cot;
  const b = $("#cotBlock");
  if (!b) return;
  if (!c) {
    b.innerHTML = '<div class="err">COT report unavailable right now.</div>';
    return;
  }
  const mm = c.moneyManager;
  const netCls = mm.net >= 0 ? "long" : "short";
  const chgCls2 = mm.netChange == null ? "flat" : mm.netChange >= 0 ? "up" : "down";
  const chgArrow = mm.netChange == null ? "" : mm.netChange >= 0 ? "▲" : "▼";
  b.innerHTML = `
    <div class="cot-net">
      <div class="cnt-label">MONEY-MANAGER NET POSITION</div>
      <div class="cnt-val ${netCls} num">${fmtContracts(mm.net)}</div>
      <div class="cnt-chg ${chgCls2} num">${chgArrow} ${mm.netChange == null ? "—" : fmtContracts(mm.netChange)} this week</div>
    </div>
    <div class="cot-badge ${netCls}" id="cotBadge">${esc(c.classification.label)}</div>
    <div class="cot-grid">
      <div class="cot-cell"><div class="cc-label">MM Long</div><div class="cc-val num" style="color:var(--up)">${fmtContracts(mm.long)}</div></div>
      <div class="cot-cell"><div class="cc-label">MM Short</div><div class="cc-val num" style="color:var(--down)">${fmtContracts(mm.short)}</div></div>
      <div class="cot-cell"><div class="cc-label">Open Interest</div><div class="cc-val num">${fmtContracts(c.openInterest)}</div></div>
      <div class="cot-cell"><div class="cc-label">MM Net % of OI</div><div class="cc-val num">${mm.netPctOfOi != null ? mm.netPctOfOi.toFixed(1) + "%" : "—"}</div></div>
    </div>
    <div class="cot-meta">Report date ${esc(c.reportDate.split("T")[0])} (prev ${esc((c.previousDate || "").split("T")[0])}) · CFTC disaggregated COMEX GOLD · weekly, updated Fridays</div>`;
}

/* ---------------- news ---------------- */

function sentPill(s) {
  if (s == null) return '<span class="sent-pill flat">NEUTRAL</span>';
  if (s > 0.15) return '<span class="sent-pill bull">▲ BULLISH</span>';
  if (s < -0.15) return '<span class="sent-pill bear">▼ BEARISH</span>';
  return '<span class="sent-pill flat">NEUTRAL</span>';
}

function renderNews() {
  const f = state.filters.news;
  let items = state.news;
  if (f === "geo") items = items.filter((it) => it.geo);
  if (f === "gold") items = items.filter((it) => it.relevance);
  if (f === "bull") items = items.filter((it) => it.sentiment > 0.15);
  if (f === "bear") items = items.filter((it) => it.sentiment < -0.15);
  const b = $("#newsList");
  if (!items.length) {
    b.innerHTML = '<div class="empty">' + (state.loaded.news ? "No matching headlines." : "Loading news…") + "</div>";
    return;
  }
  const html = items
    .slice(0, 40)
    .map(
      (it) => `<div class="news-item">
        <div class="news-time">${fmtTime(it.published)}<br/>${fmtAgo(it.published)}</div>
        <div class="news-main">
          <a class="news-title" href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a>
          ${it.content ? `<div class="news-snip">${esc(it.content.slice(0, 220))}…</div>` : ""}
          <div class="news-meta">
            <span class="src-badge">${esc(it.source)}</span>
            ${it.geo ? '<span class="geo-chip">GEO</span>' : ""}
            ${sentPill(it.sentiment)}
            ${it.relevance ? '<span class="gold-chip">★ XAU</span>' : ""}
          </div>
        </div>
      </div>`
    )
    .join("");
  b.innerHTML = html;
}

/* ---------------- calendar ---------------- */

function renderCalendar() {
  const f = state.filters.calendar;
  const hideOld = state.filters.calHideOld;
  let evs = state.calendar;
  if (f === "High") evs = evs.filter((e) => e.impact === "High");
  if (f === "Medium") evs = evs.filter((e) => e.impact === "Medium" || e.impact === "High");
  if (f === "gold") evs = evs.filter((e) => e.relevance);
  if (hideOld) evs = evs.filter((e) => (e.date || 0) > Date.now() - 2 * 3600 * 1000);

  const b = $("#calList");
  if (!evs.length) {
    b.innerHTML = '<div class="empty">No events in this filter.</div>';
    return;
  }
  const byDay = new Map();
  for (const e of evs) {
    if (!e.date) continue;
    const k = dayKey(e.date);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }
  const rows = [];
  for (const [k, list] of byDay) {
    rows.push(`<div class="cal-day">${esc(dayLabel(k))}</div>`);
    for (const e of list) {
      const passed = e.date < Date.now() - 2 * 3600 * 1000;
      const actual = e.actualRaw != null ? e.actualRaw : "";
      const fcast = e.forecastRaw != null ? e.forecastRaw : "";
      const prev = e.previousRaw != null ? e.previousRaw : "";
      const unit = e.unit || "";
      rows.push(`<div class="cal-row ${e.relevance ? "gold-rel" : ""} ${passed ? "passed" : ""}">
        <div class="cal-time">${fmtTime(e.date)}</div>
        <div class="cal-impact ${e.impact}">${e.impact.toUpperCase()}</div>
        <div class="cal-body">
          <div class="cal-title"><span class="cal-flag">${esc((e.country || "—").slice(0, 2).toUpperCase())}</span>${esc(e.title)}</div>
          <div class="cal-nums">
            ${e.actualRaw != null ? `<span class="a">A ${actual}${unit}</span>` : ""}
            ${e.forecastRaw != null ? `<span>F ${fcast}${unit}</span>` : ""}
            ${e.actualRaw == null && e.previousRaw != null ? `<span>P ${prev}${unit}</span>` : ""}
          </div>
        </div>
        <div class="cal-star">${e.relevance ? "★" : ""}</div>
      </div>`);
    }
  }
  b.innerHTML = rows.join("");
}

/* ---------------- TradingView chart ---------------- */

function initChart(tf) {
  const container = $("#tvchart");
  if (!container) return;
  if (typeof TradingView === "undefined") {
    $("#chartStatus").textContent = "waiting for chart lib…";
    setTimeout(() => initChart(tf), 600);
    return;
  }
  state.chartNa = true;
  $("#chartStatus").textContent = "OANDA feed";
  container.innerHTML = "";
  new TradingView.widget({
    symbol: "OANDA:XAUUSD",
    interval: tf,
    autosize: true,
    timezone: "Etc/UTC",
    theme: "dark",
    style: "1",
    locale: "en",
    toolbar_bg: "#101722",
    backgroundColor: "rgba(13,20,32,0)",
    gridColor: "rgba(28,40,54,0.35)",
    enable_publishing: false,
    hide_side_toolbar: false,
    allow_symbol_change: false,
    hidetop_toolbar: false,
    studies: ["RSI@tv-basicstudies", "MACD@tv-basicstudies", "MASimple@tv-basicstudies"],
    studies_overrides: {
      "moving average.ma.style": "1",
      "moving average.displacements": "0",
      "macd.histogram.color": "#f0b90b",
      "rsi.plot.color": "#4da3ff",
    },
    container_id: "tvchart",
    withdateranges: true,
    save_image: false,
  });
}

/* ---------------- data loaders ---------------- */

async function loadQuotes() {
  try {
    const d = await getJSON("/api/quotes");
    state.failCount.quotes = 0;
    state.loaded.quotes = true;
    renderQuotes(d);
  } catch (e) {
    state.failCount.quotes++;
    console.warn("quotes", e);
    $("#connTxt").textContent = "quotes delayed";
  }
}

async function loadBias() {
  try {
    const d = await getJSON("/api/bias");
    state.failCount.bias = 0;
    state.loaded.bias = true;
    renderBias(d);
    renderLevels(d);
    renderIndicators(d);
    renderCot(d);
    const cd = await getJSON("/api/candles?sym=GC%3DF&interval=5m&range=1d&limit=288");
    state.candles = cd.candles || [];
    drawSpark(state.candles, d.levels ? d.levels.vwap : null);
  } catch (e) {
    state.failCount.bias++;
    console.warn("bias", e);
    $("#biasAsoOf").textContent = state.loaded.bias ? "stale — retrying" : "loading…";
  }
}

async function loadNews() {
  try {
    const d = await getJSON("/api/news?refresh=1");
    state.failCount.news = 0;
    state.loaded.news = true;
    state.news = d.items || [];
    $("#newsAsoOf").textContent = state.news.length + " headlines";
    renderNews();
  } catch (e) {
    state.failCount.news++;
    console.warn("news", e);
  }
}

async function loadCalendar() {
  try {
    const d = await getJSON("/api/calendar");
    state.failCount.calendar = 0;
    state.loaded.calendar = true;
    state.calendar = d.events || [];
    $("#calAsoOf").textContent = state.calendar.length + " events";
    renderCalendar();
  } catch (e) {
    state.failCount.calendar++;
    console.warn("calendar", e);
  }
}

function refreshAll(manual) {
  loadQuotes();
  setTimeout(loadBias, 1200);
  setTimeout(loadNews, 3600);
  setTimeout(loadCalendar, 5000);
  if (manual) {
    const btn = $("#btnRefresh");
    btn.classList.remove("spin");
    void btn.offsetWidth;
    btn.classList.add("spin");
  }
}

/* ---------------- status led ---------------- */

function updateStatus() {
  const fresh = state.loaded.quotes && state.loaded.bias && state.loaded.news && state.loaded.calendar;
  const fails = state.failCount.quotes + state.failCount.bias + state.failCount.news + state.failCount.calendar;
  const led = $("#connLed");
  const txt = $("#connTxt");
  const anyOk = state.loaded.quotes || state.loaded.bias || state.loaded.news || state.loaded.calendar;
  if (fresh && fails === 0) {
    led.className = "led ok";
    txt.textContent = "LIVE DATA";
  } else if (!fresh && anyOk) {
    led.className = "led warn";
    txt.textContent = "PARTIAL / STALE";
  } else if (fails === 0 && anyOk) {
    led.className = "led ok";
    txt.textContent = "LIVE (warn)";
  } else {
    led.className = "led bad";
    txt.textContent = "DISCONNECTED";
  }
}

/* ---------------- clock ---------------- */

function tickClock() {
  const n = new Date();
  $("#clockUTC").textContent = pad(n.getUTCHours()) + ":" + pad(n.getUTCMinutes()) + ":" + pad(n.getUTCSeconds()) + " UTC";
  $("#clockLocal").textContent =
    pad(n.getHours()) + ":" + pad(n.getMinutes()) + ":" + pad(n.getSeconds()) + " local · " + n.toDateString().slice(0, 3);
}

/* ---------------- events ---------------- */

function bindEvents() {
  $("#intvGroup").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tf]");
    if (!btn) return;
    $$("#intvGroup button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.chartTf = btn.dataset.tf;
    if (state.chartNa) initChart(state.chartTf);
  });

  $("#newsFilter").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-f]");
    if (!btn) return;
    $$("#newsFilter button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.filters.news = btn.dataset.f;
    renderNews();
  });

  $("#calFilter").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-imp]");
    if (!btn) return;
    $$("#calFilter button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.filters.calendar = btn.dataset.imp;
    renderCalendar();
  });

  $("#calHideOld").addEventListener("change", (e) => {
    state.filters.calHideOld = e.target.checked;
    renderCalendar();
  });

  $("#btnRefresh").addEventListener("click", () => refreshAll(true));
}

/* ---------------- boot ---------------- */

(function boot() {
  tickClock();
  setInterval(tickClock, 1000);
  setInterval(updateStatus, 1500);
  renderNews();
  renderCalendar();
  renderBias({ scorePct: 50, label: "computing…", confidence: null, drivers: [], signals: [], asof: null, spotBasis: "", basis: { technicals: "" }, sourceFreshness: {} });
  renderQuotes({
    spot: { price: null },
    futures: {},
    correlated: [],
    etfs: [],
    sessions: { asia: false, london: false, newYork: false },
  });
  bindEvents();
  initChart(state.chartTf);

  getJSON("/api/config")
    .then((cfg) => {
      if (cfg && cfg.poll) {
        if (cfg.poll.quotesSec) POLL.quotes = cfg.poll.quotesSec * 1000;
        if (cfg.poll.biasSec) POLL.bias = cfg.poll.biasSec * 1000;
        if (cfg.poll.newsSec) POLL.news = cfg.poll.newsSec * 1000;
        if (cfg.poll.calendarMin) POLL.calendar = cfg.poll.calendarMin * 60000;
      }
    })
    .catch(() => {});

  refreshAll(false);

  setInterval(() => loadQuotes(), POLL.quotes);
  setInterval(() => loadBias(), POLL.bias);
  setInterval(() => loadNews(), POLL.news);
  setInterval(() => loadCalendar(), POLL.calendar);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshAll(false);
  });
})();