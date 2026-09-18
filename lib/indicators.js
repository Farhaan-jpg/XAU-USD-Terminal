export const last = (a) => a[a.length - 1];
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round = (v, dp = 2) => {
  if (!Number.isFinite(v)) return null;
  const m = Math.pow(10, dp);
  return Math.round(v * m) / m;
};

export function smaSeries(vals, p) {
  const out = new Array(vals.length).fill(null);
  let s = 0;
  for (let i = 0; i < vals.length; i++) {
    s += vals[i];
    if (i >= p) s -= vals[i - p];
    if (i >= p - 1) out[i] = s / p;
  }
  return out;
}

export function emaSeries(vals, p) {
  const k = 2 / (p + 1);
  const out = new Array(vals.length);
  out[0] = vals[0];
  for (let i = 1; i < vals.length; i++) out[i] = vals[i] * k + out[i - 1] * (1 - k);
  return out;
}

export function rsiSeries(closes, p = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= p) return { values: out, last: null };
  let gain = 0, loss = 0;
  for (let i = 1; i <= p; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / p;
  let avgL = loss / p;
  out[p] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = p + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (p - 1) + Math.max(d, 0)) / p;
    avgL = (avgL * (p - 1) + Math.max(-d, 0)) / p;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return { values: out, last: last(out) };
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const ef = emaSeries(closes, fast);
  const es = emaSeries(closes, slow);
  const line = closes.map((_, i) => ef[i] - es[i]);
  const sig = emaSeries(line, signal);
  const macdV = last(line);
  const signalV = last(sig);
  return { line, signalSeries: sig, macd: macdV, signal: signalV, hist: macdV - signalV };
}

export function atr(candles, p = 14) {
  if (candles.length < p + 1) return null;
  let trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], pv = candles[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - pv.c), Math.abs(c.l - pv.c)));
  }
  let a = trs[0];
  for (let i = 1; i < trs.length; i++) a = (a * (p - 1) + trs[i]) / p;
  return a;
}

export function vwap(candles) {
  let pv = 0, v = 0;
  for (const c of candles) {
    if (c.v == null || c.v <= 0) continue;
    const tp = (c.h + c.l + c.c) / 3;
    pv += tp * c.v;
    v += c.v;
  }
  return v ? pv / v : null;
}

export function stochastic(closes, highs, lows, k = 14, d = 3) {
  const ks = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < k - 1) { ks.push(null); continue; }
    let hh = -Infinity, ll = Infinity;
    for (let j = i - k + 1; j <= i; j++) {
      if (highs[j] > hh) hh = highs[j];
      if (lows[j] < ll) ll = lows[j];
    }
    ks.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100);
  }
  const ds = [];
  for (let i = 0; i < ks.length; i++) {
    if (i < k + d - 2) { ds.push(null); continue; }
    let s = 0;
    for (let j = i - d + 1; j <= i; j++) s += ks[j];
    ds.push(s / d);
  }
  return { k: last(ks), d: last(ds) };
}

export function pivotLevels(prevH, prevL, prevC) {
  if ([prevH, prevL, prevC].some((v) => v == null)) return null;
  const P = (prevH + prevL + prevC) / 3;
  return {
    pivot: P,
    r1: 2 * P - prevL,
    s1: 2 * P - prevH,
    r2: P + (prevH - prevL),
    s2: P - (prevH - prevL),
    r3: prevH + 2 * (P - prevL),
    s3: prevL - 2 * (prevH - P),
  };
}

export function swingLevels(candles, lookback, price) {
  const highs = [], lows = [];
  const start = Math.max(0, candles.length - lookback);
  for (let i = start; i < candles.length; i++) {
    highs.push(candles[i].h);
    lows.push(candles[i].l);
  }
  const below = lows.filter((l) => l < price).sort((a, b) => b - a);
  const above = highs.filter((h) => h > price).sort((a, b) => a - b);
  return {
    support: below[0] ?? null,
    resistance: above[0] ?? null,
  };
}

export function normalizeSeries(raw) {
  const vals = raw.map(Number).filter(Number.isFinite);
  if (!vals.length) return raw;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const r = max - min || 1;
  return vals.map((v) => ((v - min) / r) * 100);
}