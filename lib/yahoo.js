import cache from "./cache.js";
import { gate } from "./gate.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
const lastGood = new Map();

async function fetchJson(url, timeoutMs = 20000) {
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

/**
 * Fetch normalized OHLCV candles from Yahoo Finance chart API.
 * Cached for `ttl` ms. On refresh failure, returns last-good cached shape.
 */
export async function chart(symbol, interval, range, ttl = 30000) {
  const key = `chart:${symbol}:${interval}:${range}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let lastErr;
  for (const host of HOSTS) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
      const data = await fetchJson(url);
      const r = data?.chart?.result?.[0];
      if (!r) throw new Error("no result for " + symbol);
      const q = r.indicators?.quote?.[0] || {};
      const candles = (r.timestamp || [])
        .map((t, i) => ({
          t: t * 1000,
          o: q.open?.[i] ?? null,
          h: q.high?.[i] ?? null,
          l: q.low?.[i] ?? null,
          c: q.close?.[i] ?? null,
          v: q.volume?.[i] ?? 0,
        }))
        .filter((c) => c.h != null && c.l != null && c.c != null);
      if (!candles.length) throw new Error("empty candles " + symbol);
      const out = { meta: r.meta, symbol, interval, range, candles };
      cache.set(key, out, ttl);
      return out;
    } catch (e) {
      lastErr = e;
    }
  }
  const stale = lastGood.get(key);
  if (stale) return stale;
  throw lastErr || new Error("yahoo unavailable " + symbol);
}

export function rememberLatest(key, value) {
  lastGood.set(key, value);
}

/* Raw quote shape extracted from chart meta (no auth needed). */
function quoteFromMeta(symbol, name, meta) {
  const prev = meta.chartPreviousClose ?? meta.previousClose ?? null;
  const price = meta.regularMarketPrice ?? null;
  const dayHigh = meta.regularMarketDayHigh ?? null;
  const dayLow = meta.regularMarketDayLow ?? null;
  const asof = meta.regularMarketTime ? meta.regularMarketTime * 1000 : null;
  let chg = null;
  let chgPct = null;
  if (price != null && prev != null) {
    chg = price - prev;
    chgPct = (chg / prev) * 100;
  }
  return {
    symbol,
    name,
    price,
    prevClose: prev,
    chg,
    chgPct,
    dayHigh,
    dayLow,
    asof,
    source: "Yahoo Finance",
  };
}

/**
 * Fetch one quote snapshot for a symbol (1m/1d chart meta).
 */
export async function quote(symbol, name, ttl = 10000) {
  const c = await chart(symbol, "1m", "1d", ttl);
  const out = quoteFromMeta(symbol, name || symbol, c.meta);
  rememberLatest(`quote:${symbol}`, out);
  return out;
}

/**
 * Fetch several quotes sequentially with a small delay between calls
 * to avoid Yahoo rate limits. Fallbacks to any previously-good values.
 */
export async function quotes(symbols, ttl = 10000) {
  const out = [];
  for (const s of symbols) {
    try {
      out.push(await quote(s.symbol, s.name, ttl));
    } catch (e) {
      const prev = lastGood.get(`quote:${s.symbol}`);
      if (prev) out.push({ ...prev, stale: true });
      else out.push({ symbol: s.symbol, name: s.name, stale: true, price: null, error: e.message });
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  return out;
}

export async function candlesList(symbol, interval, range, ttl = 30000) {
  const key = `list:${symbol}:${interval}:${range}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = await chart(symbol, interval, range, ttl);
  const out = c.candles;
  cache.set(key, out, ttl);
  return out;
}