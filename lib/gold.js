import config from "./config.js";
import { gate } from "./gate.js";

const last = { price: null, updatedAt: null, fetchedAt: null };

/**
 * Real-time XAU spot in USD from gold-api.com (free, no key, updates every
 * few seconds). Falls back to the last-good value if a refresh fails.
 */
export async function spot() {
  const url = config.goldApiUrl;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await gate(async () => {
      return await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
        signal: ctrl.signal,
      });
    });
    clearTimeout(to);
    if (!res.ok) throw new Error("gold-api HTTP " + res.status);
    const j = await res.json();
    const price = Number(j.price);
    if (Number.isFinite(price) && price > 0) {
      last.price = price;
      last.updatedAt = j.updatedAt || null;
      last.fetchedAt = Date.now();
    }
    return {
      symbol: "XAU",
      name: "Gold Spot (USD)",
      price: last.price,
      updatedAt: last.updatedAt,
      fetchedAt: last.fetchedAt,
      ageMs: Date.now() - last.fetchedAt,
      provider: "gold-api.com",
      fresh: true,
    };
  } catch (e) {
    clearTimeout(to);
    if (last.price != null) {
      return {
        symbol: "XAU",
        name: "Gold Spot (USD)",
        price: last.price,
        updatedAt: last.updatedAt,
        fetchedAt: last.fetchedAt,
        ageMs: Date.now() - last.fetchedAt,
        provider: "gold-api.com",
        fresh: false,
        error: e.message,
      };
    }
    throw new Error("gold spot unavailable: " + e.message);
  }
}

export async function spotAgoSec() {
  const s = await spot();
  return s.fetchedAt ? Math.round((Date.now() - s.fetchedAt) / 1000) : null;
}