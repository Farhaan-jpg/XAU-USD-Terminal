import cache from "./cache.js";
import { gate } from "./gate.js";

const API = "https://economic-calendar.tradingview.com/events";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const GOLD_RELEVANT = [
  "interest rate", "fed", "fomc", "cpi", "inflation", "producer price", "nonfarm",
  "employment", "unemployment", "payrolls", "gdp", "retail sales", "durable",
  "ism", "pmi", "consumer confidence", "philly fed", "empire", "housing", "home sales",
  "treasury", "auction", "initial jobless", "jobless",
];

function iso(v) {
  return new Date(v).toISOString();
}

function importanceLabel(n) {
  if (n >= 1) return "High";
  if (n >= 0) return "Medium";
  return "Low";
}

function relevance(ev) {
  const txt = ((ev.title || "") + " " + (ev.indicator || "") + " " + (ev.source || "")).toLowerCase();
  const hits = GOLD_RELEVANT.filter((k) => txt.includes(k));
  return { relevant: hits.length > 0, keys: hits.slice(0, 5) };
}

/**
 * Pull upcoming economic events that move USD / gold from TradingView's
 * public economic calendar endpoint (blocking USD events first by default).
 */
export async function calendar(refresh = false) {
  const cacheKey = "calendar:events";
  const hit = cache.get(cacheKey);
  if (hit && !refresh) return hit;

  const from = iso(Date.now() - 8 * 3600 * 1000);
  const to = iso(Date.now() + 4 * 24 * 3600 * 1000);
  const url = `${API}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  const ctrl = new AbortController();
  const to2 = setTimeout(() => ctrl.abort(), 25000);
  let result = [];
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await gate(async () => {
        return await fetch(url, {
          headers: { "User-Agent": UA, Accept: "application/json", Origin: "https://www.tradingview.com", Referer: "https://www.tradingview.com/" },
          signal: ctrl.signal,
        });
      });
      clearTimeout(to2);
      if (!res.ok) throw new Error("calendar http " + res.status);
      const j = await res.json();
      if (j?.result) {
        result = j.result.map((e) => {
          const rel = relevance(e);
          return {
            id: e.id,
            title: e.title,
            indicator: e.indicator,
            country: e.country,
            currency: e.currency,
            unit: e.unit,
            date: e.date ? new Date(e.date).getTime() : null,
            impact: importanceLabel(e.importance),
            importance: e.importance,
            actual: e.actual,
            forecast: e.forecast,
            previous: e.previous,
            actualRaw: e.actualRaw,
            forecastRaw: e.forecastRaw,
            previousRaw: e.previousRaw,
            period: e.period,
            source: e.source,
            comment: e.comment,
            relevance: rel.relevant,
            relKeys: rel.keys,
          };
        });
      }
      break;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
  }
  if (!result.length && lastErr) {
    const stale = cache.get(cacheKey);
    if (stale) return stale;
    throw new Error("calendar unavailable: " + lastErr.message);
  }

  result.sort((a, b) => (a.date || 0) - (b.date || 0));
  cache.set(cacheKey, result, 8 * 60 * 1000);
  return result;
}