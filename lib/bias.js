import { spot } from "./gold.js";
import { quote } from "./yahoo.js";
import { chart } from "./yahoo.js";
import { newsSentiment } from "./news.js";
import { cot } from "./cot.js";
import config from "./config.js";
import {
  last, clamp, round, emaSeries, rsiSeries, macd, atr, vwap, stochastic,
  pivotLevels, swingLevels,
} from "./indicators.js";
import cache from "./cache.js";

const labels = [
  { min: 0.42, label: "Strong Bullish" },
  { min: 0.18, label: "Bullish" },
  { min: -0.18, label: "Neutral / Mixed" },
  { min: -0.42, label: "Bearish" },
  { min: -1.01, label: "Strong Bearish" },
];

function labelFor(score) {
  for (const l of labels) if (score >= l.min) return l.label;
  return "Strong Bearish";
}

function emaVal(candles, p) {
  const closes = candles.map((c) => c.c);
  return last(emaSeries(closes, p));
}

function trendValue(price, refs) {
  const above = refs.filter((r) => r != null && price > r).length;
  return (above - refs.length / 2) / (refs.length / 2); // -1..1
}

function normPct(value) {
  // percentage-based [-1..1] normalization: ±1% => full signal
  return clamp(value / 1.0, -1, 1);
}

function signal(key, label, value, weight, display, group, arrow) {
  return { key, label, value: clamp(value, -1, 1), weight, display, group, arrow };
}

async function settle(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function bias(refresh = false) {
  const cacheKey = "bias:computed";
  if (!refresh) {
    const hit = cache.get(cacheKey);
    if (hit) return hit;
  }

  const t0 = Date.now();
  const [spotR, dailyR, hourlyR, intraR, dxyR, sentR, cotR] = await Promise.all([
    settle(spot),
    settle(() => chart(config.baseSymbol, "1d", "2y", 90000)),
    settle(() => chart(config.baseSymbol, "60m", "3mo", 90000)),
    settle(() => chart(config.baseSymbol, "5m", "1d", 25000)),
    settle(() => quote("DX-Y.NYB", "Dollar Index (DXY)", 20000)),
    settle(newsSentiment),
    settle(cot),
  ]);

  const daily = dailyR.ok ? dailyR.value : null;
  const hourly = hourlyR.ok ? hourlyR.value : null;
  const intra = intraR.ok ? intraR.value : null;
  const dxyQ = dxyR.ok ? dxyR.value : null;
  const sent = sentR.ok ? sentR.value : { avg: 0, n: 0 };
  const cotV = cotR.ok ? cotR.value : null;

  const spotPrice = spotR.ok && spotR.value.price != null ? spotR.value.price : null;
  const dailyCloses = daily ? daily.candles.map((c) => c.c) : [];
  const basePrice = spotPrice ?? last(dailyCloses) ?? null;

  // ---- daily timeframe ----
  let rsiD = null, macdD = null, atrD = null, ema50D = null, ema100D = null, ema200D = null, sma20D = null;
  if (dailyCloses.length >= 30) {
    ema50D = emaVal(daily.candles, 50);
    if (dailyCloses.length >= 100) ema100D = emaVal(daily.candles, 100);
    if (dailyCloses.length >= 200) ema200D = emaVal(daily.candles, 200);
    rsiD = rsiSeries(dailyCloses, 14).last;
    macdD = macd(dailyCloses);
    atrD = atr(daily.candles, 14);
    sma20D = last(daily.candles.map((_, i) => {
      if (i < 19) return null;
      let s = 0;
      for (let j = i - 19; j <= i; j++) s += dailyCloses[j];
      return s / 20;
    }).filter((v) => v != null));
  }

  // ---- 1H timeframe ----
  let rsiH = null, macdH = null, ema20H = null, ema50H = null, stochH = null;
  const hourlyCloses = hourly ? hourly.candles.map((c) => c.c) : [];
  if (hourlyCloses.length >= 30) {
    rsiH = rsiSeries(hourlyCloses, 14).last;
    macdH = macd(hourlyCloses);
    ema20H = emaVal(hourly.candles, 20);
    ema50H = emaVal(hourly.candles, 50);
    const hs = hourly.candles.map((c) => c.h), ls = hourly.candles.map((c) => c.l);
    stochH = stochastic(hourlyCloses, hs, ls, 14, 3);
  }

  // ---- intraday ----
  let vw = null, sessHigh = null, sessLow = null, sessFirst = null;
  if (intra) {
    vw = vwap(intra.candles);
    sessHigh = Math.max(...intra.candles.map((c) => c.h));
    sessLow = Math.min(...intra.candles.map((c) => c.l));
    sessFirst = intra.candles[0]?.c ?? null;
  }

  // ---- levels / pivots (on daily candles) ----
  let pivots = null, weekHigh = null, weekLow = null, monthHigh = null, monthLow = null;
  let swingS = null, swingR = null, prevDay = null;
  if (daily) {
    const ds = daily.candles;
    if (ds.length >= 2) {
      const prev = ds[ds.length - 2];
      prevDay = { high: prev.h, low: prev.l, close: prev.c, t: prev.t };
      pivots = pivotLevels(prev.h, prev.l, prev.c);
    }
    const wk = ds.slice(-5), mo = ds.slice(-22);
    weekHigh = Math.max(...wk.map((c) => c.h));
    weekLow = Math.min(...wk.map((c) => c.l));
    monthHigh = Math.max(...mo.map((c) => c.h));
    monthLow = Math.min(...mo.map((c) => c.l));
    if (basePrice != null) {
      const sw = swingLevels(daily.candles, 30, basePrice);
      swingS = sw.support;
      swingR = sw.resistance;
    }
  }

  // ---- correlated / sentiment / positioning ----
  const dxyChg = dxyQ?.chgPct ?? null;
  const cotNet = cotV ? cotV.moneyManager.net : null;
  const cotChg = cotV ? cotV.moneyManager.netChange : null;
  const oi = cotV ? cotV.openInterest : null;
  const cotVal = cotV && oi ? clamp((cotNet / (oi / 100)) / 2.5, -1, 1) : 0;
  const cotDeltaVal = cotChg != null ? clamp((cotChg / (oi / 100)) / 2.5, -1, 1) : 0;
  const cotScore = cotVal * 0.7 + cotDeltaVal * 0.6;

  // ---- momentum ----
  let chg24 = null;
  if (dailyCloses.length >= 2) chg24 = (dailyCloses[dailyCloses.length - 1] / dailyCloses[dailyCloses.length - 2] - 1) * 100;
  let sessDev = null;
  if (basePrice != null && sessFirst) sessDev = (basePrice / sessFirst - 1) * 100;

  const signals = [];
  const add = (s) => { if (s) signals.push(s); };

  if (basePrice != null) {
    const refsD = [ema50D, ema100D, ema200D].filter((v) => v != null);
    if (refsD.length) {
      const v = trendValue(basePrice, refsD);
      add(signal("trend_d", "Daily Trend (EMA 50/100/200)", v, 18,
        v > 0 ? "Price above key EMAs" : v < 0 ? "Price below key EMAs" : "Mixed vs EMAs",
        "Trend", v > 0 ? "up" : v < 0 ? "down" : "flat"));
    }
    const refsH = [ema20H, ema50H].filter((v) => v != null);
    if (refsH.length) {
      const v = trendValue(basePrice, refsH);
      add(signal("trend_h", "H1 Trend (EMA 20/50)", v, 14,
        v > 0 ? "Short-term uptrend" : v < 0 ? "Short-term downtrend" : "Mixed",
        "Trend", v > 0 ? "up" : v < 0 ? "down" : "flat"));
    }
  }

  if (rsiH != null) {
    const v = clamp((rsiH - 50) / 30, -1, 1);
    add(signal("rsi_h", "RSI(14) — 1H", v, 9, `RSI ${round(rsiH, 1)}`,
      "Momentum", v > 0.1 ? "up" : v < -0.1 ? "down" : "flat"));
  }
  if (rsiD != null) {
    const v = clamp((rsiD - 50) / 30, -1, 1);
    add(signal("rsi_d", "RSI(14) — Daily", v, 7, `RSI ${round(rsiD, 1)}`,
      "Momentum", v > 0.1 ? "up" : v < -0.1 ? "down" : "flat"));
  }

  if (macdH && basePrice != null) {
    const histPct = (macdH.hist / basePrice) * 100;
    const v = clamp(histPct / 0.35, -1, 1);
    add(signal("macd_h", "MACD — 1H", v, 11,
      `hist ${round(macdH.hist, 2)}`,
      "Momentum", v > 0.05 ? "up" : v < -0.05 ? "down" : "flat"));
  }
  if (macdD && basePrice != null) {
    const histPct = (macdD.hist / basePrice) * 100;
    const v = clamp(histPct / 0.35, -1, 1);
    add(signal("macd_d", "MACD — Daily", v, 12,
      `hist ${round(macdD.hist, 2)}`,
      "Momentum", v > 0.05 ? "up" : v < -0.05 ? "down" : "flat"));
  }

  if (basePrice != null && vw != null) {
    const devPct = ((basePrice - vw) / vw) * 100;
    const v = clamp(devPct / 0.5, -1, 1);
    add(signal("vwap", "VWAP Position (Today)", v, 6,
      `${devPct >= 0 ? "+" : ""}${round(devPct, 2)}% vs VWAP`,
      "Session", v > 0 ? "up" : v < 0 ? "down" : "flat"));
  }

  if (chg24 != null) {
    const v = clamp(chg24 / 1.2, -1, 1);
    add(signal("mom24", "Momentum (24H)", v, 7,
      `${chg24 >= 0 ? "+" : ""}${round(chg24, 2)}%`,
      "Trend", v > 0 ? "up" : v < 0 ? "down" : "flat"));
  }

  if (dxyChg != null) {
    const v = clamp(-dxyChg / 0.5, -1, 1);
    add(signal("dxy", "Dollar Index (inverse)", v, 13,
      `DXY ${dxyChg >= 0 ? "+" : ""}${round(dxyChg, 2)}%`,
      "Macro", v > 0 ? "up" : v < 0 ? "down" : "flat"));
  }

  if (sessDev != null) {
    const v = clamp(sessDev / 0.8, -1, 1);
    add(signal("session", "Session Performance (vs open)", v, 5,
      `${sessDev >= 0 ? "+" : ""}${round(sessDev, 2)}%`,
      "Session", v > 0 ? "up" : v < 0 ? "down" : "flat"));
  }

  add(signal("news", "News Sentiment (24H)", clamp(sent.avg * 1.6, -1, 1), 6,
    `${sent.n} headlines analyzed`,
    "Sentiment", sent.avg > 0.1 ? "up" : sent.avg < -0.1 ? "down" : "flat"));

  add(signal("cot", "COT Positioning (MM)", cotScore, 9,
    cotV ? `MM net ${(cotNet / 1000).toFixed(0)}K contracts` : "unavailable",
    "Positioning", cotScore > 0.1 ? "up" : cotScore < -0.1 ? "down" : "flat"));

  const totalW = signals.reduce((a, s) => a + s.weight, 0) || 1;
  let score = 0;
  for (const s of signals) score += s.value * s.weight;
  score = score / totalW;

  const label = labelFor(score);
  const sorted = [...signals].sort((a, b) => Math.abs(b.value * b.weight) - Math.abs(a.value * a.weight));
  const top3 = sorted.slice(0, 3).map((s) => s.label);

  const ageMs = Date.now() - t0;
  const sourceFreshness = {
    spot: spotR.ok,
    futures: dailyR.ok && hourlyR.ok,
    dxy: dxyR.ok,
    news: sentR.ok,
    cot: cotR.ok,
  };

  const result = {
    asof: Date.now(),
    computeMs: ageMs,
    spotPrice: basePrice,
    spotBasis: spotR.ok && spotPrice != null ? "XAU spot (gold-api)" : "GC=F futures (Yahoo)",
    score: round(score, 4),
    scorePct: round((score + 1) * 50, 2),
    label,
    confidence: round(clamp(0.96 - ageMs / 5000, 0.55, 0.99), 2),
    drivers: top3,
    signals,
    sourceFreshness,
    indicators: {
      futuresPrice: dailyCloses.length ? last(dailyCloses) : null,
      ema20H, ema50H, ema50D, ema100D, ema200D, sma20D,
      rsiH, rsiD,
      macdH: macdH ? { macd: round(macdH.macd, 3), signal: round(macdH.signal, 3), hist: round(macdH.hist, 3) } : null,
      macdD: macdD ? { macd: round(macdD.macd, 3), signal: round(macdD.signal, 3), hist: round(macdD.hist, 3) } : null,
      vwap: vw != null ? round(vw, 2) : null,
      atrD: atrD != null ? round(atrD, 2) : null,
      stochH: stochH ? { k: round(stochH.k, 1), d: round(stochH.d, 1) } : null,
      dayHigh: sessHigh, dayLow: sessLow,
    },
    levels: {
      spotPrice,
      vwap,
      pivots,
      prevDay,
      dayHigh: sessHigh, dayLow: sessLow,
      weekHigh, weekLow, monthHigh, monthLow,
      swingS, swingR,
      atrD: atrD != null ? round(atrD, 2) : null,
    },
    macro: { dxyChg, chg24, newsAvg: sent.avg },
    cot: cotV,
    basis: {
      technicals: "COMEX Gold continuous futures (GC=F) via Yahoo Finance",
      spot: "XAU/USD spot via gold-api.com",
    },
  };

  cache.set(cacheKey, result, 18000);
  return result;
}