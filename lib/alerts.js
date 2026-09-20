import { news } from "./news.js";
import { calendar } from "./calendar.js";
import { bias } from "./bias.js";
import {
  sendTelegramMessage,
  formatNewsAlert,
  formatCalendarAlert,
  formatBiasShiftAlert,
} from "./telegram.js";
import config from "./config.js";

// In-memory sets to prevent duplicate alerts
const alertedNewsIds = new Set();
const alertedCalUpcoming = new Set();
const alertedCalReleased = new Set();
let lastBiasLabel = null;
let lastCheckTime = 0;

export async function runAlertChecks(env = {}) {
  const now = Date.now();
  // throttle checks to at least 20s apart
  if (now - lastCheckTime < 20000) {
    return { ok: true, skipped: true };
  }
  lastCheckTime = now;

  const results = {
    newsAlertsSent: 0,
    calAlertsSent: 0,
    biasAlertsSent: 0,
    errors: [],
  };

  // 1. Check Breaking News
  try {
    const items = await news(true);
    for (const item of items) {
      if (alertedNewsIds.has(item.id)) continue;

      // Filter: only alert on news published in the last 35 minutes
      const ageMs = now - (item.published || 0);
      if (ageMs > 35 * 60 * 1000) {
        alertedNewsIds.add(item.id);
        continue;
      }

      // Check if gold-relevant or high-impact geopolitical news
      const isHighImpact =
        item.relevance ||
        (item.geo && Math.abs(item.sentiment) >= 0.15) ||
        Math.abs(item.sentiment) >= 0.3;

      if (isHighImpact) {
        const msg = formatNewsAlert(item);
        const res = await sendTelegramMessage(msg, null, env);
        if (res.ok) {
          results.newsAlertsSent++;
        }
      }
      alertedNewsIds.add(item.id);
    }
    // keep set bounded to 500 items
    if (alertedNewsIds.size > 500) {
      const arr = Array.from(alertedNewsIds);
      arr.slice(0, arr.length - 300).forEach((id) => alertedNewsIds.delete(id));
    }
  } catch (e) {
    results.errors.push("news check: " + e.message);
  }

  // 2. Check Economic Calendar
  try {
    const events = await calendar(true);
    for (const ev of events) {
      if (!ev.date) continue;
      const diffMs = ev.date - now;
      const isUsdOrGold = (ev.currency === "USD" || ev.relevance) && (ev.impact === "High" || ev.impact === "Medium");

      if (!isUsdOrGold) continue;

      // Advance warning: 0 to 16 minutes before event
      if (diffMs > 0 && diffMs <= 16 * 60 * 1000 && !alertedCalUpcoming.has(ev.id)) {
        const msg = formatCalendarAlert(ev, "upcoming");
        const res = await sendTelegramMessage(msg, null, env);
        if (res.ok) {
          results.calAlertsSent++;
        }
        alertedCalUpcoming.add(ev.id);
      }

      // Data release: event passed within last 20 minutes and actual is now present
      if (diffMs <= 0 && diffMs >= -20 * 60 * 1000 && ev.actualRaw != null && !alertedCalReleased.has(ev.id)) {
        const msg = formatCalendarAlert(ev, "released");
        const res = await sendTelegramMessage(msg, null, env);
        if (res.ok) {
          results.calAlertsSent++;
        }
        alertedCalReleased.add(ev.id);
      }
    }
  } catch (e) {
    results.errors.push("calendar check: " + e.message);
  }

  // 3. Check Bias Shift
  try {
    const b = await bias(false);
    if (b && b.label) {
      if (lastBiasLabel != null && lastBiasLabel !== b.label) {
        const msg = formatBiasShiftAlert(lastBiasLabel, b.label, b.scorePct, b.spotPrice, b.drivers);
        const res = await sendTelegramMessage(msg, null, env);
        if (res.ok) {
          results.biasAlertsSent++;
        }
      }
      lastBiasLabel = b.label;
    }
  } catch (e) {
    results.errors.push("bias check: " + e.message);
  }

  return results;
}
