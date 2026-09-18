import cache from "./cache.js";
import { gate } from "./gate.js";

const API = "https://publicreporting.cftc.gov/resource/72hh-3qpy.json";
const MARKET = "GOLD - COMMODITY EXCHANGE INC.";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

async function fetchJson(url, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await gate(async () => {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    });
  } finally {
    clearTimeout(to);
  }
}

async function fetchJsonRetry(url, timeoutMs = 30000) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchJson(url, timeoutMs);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function classify(mmNet, mmNetChg) {
  const dir = mmNet >= 0 ? "long" : "short";
  const trend = "trend";
  let label;
  if (dir === "long") {
    label = mmNetChg >= 0 ? "Institutional NET LONG (expanding)" : "Institutional NET LONG (trimming)";
  } else {
    label = mmNetChg >= 0 ? "Institutional NET SHORT (covering)" : "Institutional NET SHORT (expanding)";
  }
  return { bias: dir, trend, label };
}

/**
 * Latest two weekly COT reports for COMEX Gold (disaggregated).
 * Money-manager (speculative) net positioning is the institutional bias proxy.
 */
export async function cot(report = false) {
  const cacheKey = "cot:comingX";
  const hit = cache.get(cacheKey);
  if (hit && !report) return hit;

  const url =
    `${API}?commodity_name=GOLD` +
    "&$order=report_date_as_yyyy_mm_dd%20desc" +
    "&$limit=24";

  let rows = [];
  try {
    rows = await fetchJsonRetry(url);
  } catch (e) {
    const stale = cache.get(cacheKey);
    if (stale) return stale;
    throw new Error("COT unavailable: " + e.message);
  }

  if (!Array.isArray(rows) || !rows.length) throw new Error("no COT rows");

  // keep only the main COMEX contract and the two most recent report dates
  const comex = rows.filter((r) => (r.market_and_exchange_names || "").trim() === MARKET);
  if (!comex.length) throw new Error("no COMEX GOLD rows");
  const seenDates = new Set();
  const j = [];
  for (const r of comex) {
    const d = r.report_date_as_yyyy_mm_dd;
    if (seenDates.has(d)) continue;
    seenDates.add(d);
    j.push(r);
    if (j.length === 2) break;
  }
  if (j.length < 2) throw new Error("need 2 COT rows (got " + j.length + ")");

  const pick = (row) => ({
    reportDate: row.report_date_as_yyyy_mm_dd,
    openInterest: num(row.open_interest_all),
    mmLong: num(row.m_money_positions_long_all),
    mmShort: num(row.m_money_positions_short_all),
    mmSpread: num(row.m_money_positions_spread),
    prodLong: num(row.prod_merc_positions_long),
    prodShort: num(row.prod_merc_positions_short),
    swapLong: num(row.swap_positions_long_all),
    swapShort: num(row.swap__positions_short_all),
    otherLong: num(row.other_rept_positions_long),
    otherShort: num(row.other_rept_positions_short),
    totalLong: num(row.tot_rept_positions_long_all),
    totalShort: num(row.tot_rept_positions_short_all),
    nonrepLong: num(row.nonrept_positions_long_all),
    nonrepShort: num(row.nonrept_positions_short_all),
  });

  const latest = pick(j[0]);
  const prev = j[1] ? pick(j[1]) : null;

  latest.mmNet = latest.mmLong - latest.mmShort;
  latest.mmNetChg = prev ? (latest.mmLong - latest.mmShort) - (prev.mmLong - prev.mmShort) : null;
  latest.oichg = prev ? latest.openInterest - prev.openInterest : null;
  latest.cls = classify(latest.mmNet, latest.mmNetChg ?? 0);

  const out = {
    provider: "CFTC (Socrata)",
    contract: MARKET,
    reportDate: latest.reportDate,
    previousDate: prev ? prev.reportDate : null,
    openInterest: latest.openInterest,
    openInterestChg: latest.oichg,
    moneyManager: {
      long: latest.mmLong,
      short: latest.mmShort,
      net: latest.mmNet,
      netChange: latest.mmNetChg,
      spread: latest.mmSpread,
      netPctOfOi: latest.openInterest ? (latest.mmNet / latest.openInterest) * 100 : null,
    },
    producers: { long: latest.prodLong, short: latest.prodShort, net: latest.prodLong - latest.prodShort },
    swap: { long: latest.swapLong, short: latest.swapShort, net: latest.swapLong - latest.swapShort },
    other: { long: latest.otherLong, short: latest.otherShort },
    nonreportable: { long: latest.nonrepLong, short: latest.nonrepShort },
    totalReportable: { long: latest.totalLong, short: latest.totalShort },
    classification: latest.cls,
    asof: Date.now(),
  };

  cache.set(cacheKey, out, 45 * 60 * 1000);
  return out;
}