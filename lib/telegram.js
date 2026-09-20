import config from "./config.js";

/**
 * Telegram Bot API integration for real-time gold market alerts.
 */

function getCredentials(env = {}) {
  const token = env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || config.telegram?.botToken || "";
  const chatId = env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID || config.telegram?.chatId || "";
  const enabled = env.TELEGRAM_ENABLED !== "0" && (
    env.TELEGRAM_ENABLED === "1" ||
    process.env.TELEGRAM_ENABLED === "true" ||
    config.telegram?.enabled !== false
  );
  return { token: token.trim(), chatId: chatId.trim(), enabled: Boolean(token && chatId && enabled) };
}

export async function sendTelegramMessage(htmlText, customCreds = null, env = {}) {
  const creds = customCreds || getCredentials(env);
  if (!creds.token || !creds.chatId) {
    return { ok: false, error: "Telegram Bot Token or Chat ID not configured" };
  }

  const url = `https://api.telegram.org/bot${creds.token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: creds.chatId,
        text: htmlText,
        parse_mode: "HTML",
        disable_web_page_preview: false,
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      throw new Error(json.description || "Telegram API HTTP " + res.status);
    }
    return { ok: true, result: json.result };
  } catch (e) {
    console.error("[telegram] send failed:", e.message);
    return { ok: false, error: e.message };
  }
}

export async function testTelegramConnection(botToken, chatId) {
  if (!botToken || !chatId) {
    return { ok: false, error: "Both Bot Token and Chat ID are required" };
  }
  const testMsg =
    `✨ <b>XAU/USD Terminal — Alert Test</b>\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `✅ <b>Connected successfully!</b>\n\n` +
    `You will now receive:\n` +
    `• 🚨 Breaking Gold & Geopolitical News\n` +
    `• ⏰ High-Impact Economic Calendar alerts (CPI, NFP, FOMC)\n` +
    `• ⚡ Instant Actual vs Forecast data releases\n` +
    `• 🎯 Real-time Market Bias shifts\n\n` +
    `<i>Terminal Cloud Monitor is running 24/7.</i>`;

  return await sendTelegramMessage(testMsg, { token: botToken.trim(), chatId: chatId.trim() });
}

/* ---------------- Formatting Helpers ---------------- */

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatNewsAlert(item) {
  const sent = item.sentiment;
  const sentBadge =
    sent > 0.15 ? "🟢 <b>BULLISH</b> (+" + (sent * 100).toFixed(0) + "%)" :
    sent < -0.15 ? "🔴 <b>BEARISH</b> (" + (sent * 100).toFixed(0) + "%)" :
    "⚪ <b>NEUTRAL</b>";

  const tags = [];
  if (item.relevance) tags.push("#Gold");
  if (item.geo) tags.push("#Geopolitics");
  const tagsStr = tags.length ? tags.join(" ") : "#Markets";

  return (
    `🚨 <b>XAU/USD BREAKING NEWS</b>\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `<b>${escHtml(item.title)}</b>\n\n` +
    (item.content ? `<i>${escHtml(item.content.slice(0, 240))}…</i>\n\n` : "") +
    `📊 Sentiment: ${sentBadge}\n` +
    `🏷 Tags: ${tagsStr}\n` +
    `📰 Source: <b>${escHtml(item.source || "News Feed")}</b>\n` +
    (item.link ? `🔗 <a href="${escHtml(item.link)}">Read Full Story</a>` : "")
  );
}

export function formatCalendarAlert(ev, type = "upcoming") {
  const flag = ev.country ? `[${escHtml(ev.country.toUpperCase())}]` : "";
  const impactEmoji = ev.impact === "High" ? "🔴" : "🟡";

  if (type === "upcoming") {
    return (
      `⏰ <b>ECONOMIC EVENT IN 15 MIN</b>\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `${impactEmoji} <b>${escHtml(ev.title)}</b> ${flag}\n` +
      `💥 Impact: <b>${escHtml(ev.impact)}</b> | Currency: <b>${escHtml(ev.currency || "USD")}</b>\n` +
      (ev.forecastRaw != null ? `🎯 Forecast: <code>${escHtml(ev.forecastRaw)}${escHtml(ev.unit || "")}</code>\n` : "") +
      (ev.previousRaw != null ? `📊 Previous: <code>${escHtml(ev.previousRaw)}${escHtml(ev.unit || "")}</code>\n` : "") +
      `\n⚠️ <i>High volatility expected on Gold & USD!</i>`
    );
  }

  // Released actual data
  return (
    `⚡ <b>ECONOMIC DATA RELEASED</b>\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `${impactEmoji} <b>${escHtml(ev.title)}</b> ${flag}\n` +
    `🎯 <b>Actual:</b> <code>${escHtml(ev.actualRaw || "—")}${escHtml(ev.unit || "")}</code>\n` +
    (ev.forecastRaw != null ? `📊 <b>Forecast:</b> <code>${escHtml(ev.forecastRaw)}${escHtml(ev.unit || "")}</code>\n` : "") +
    (ev.previousRaw != null ? `📉 <b>Previous:</b> <code>${escHtml(ev.previousRaw)}${escHtml(ev.unit || "")}</code>\n` : "") +
    `\n<i>Check Terminal for immediate Gold price reaction.</i>`
  );
}

export function formatBiasShiftAlert(oldLabel, newLabel, scorePct, spotPrice, drivers = []) {
  const emoji =
    newLabel.includes("Bullish") ? "🟢" :
    newLabel.includes("Bearish") ? "🔴" : "🟡";

  const driversList = drivers.slice(0, 3).map((d) => `• ${escHtml(d)}`).join("\n");

  return (
    `🎯 <b>MARKET BIAS SHIFT</b>\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `Shift: <b>${escHtml(oldLabel || "—")}</b> ➔ ${emoji} <b>${escHtml(newLabel.toUpperCase())}</b>\n` +
    `📊 Bias Score: <b>${Math.round(scorePct)}/100</b>\n` +
    (spotPrice != null ? `💰 Spot Gold: <b>$${Number(spotPrice).toFixed(2)}</b>\n` : "") +
    `\n<b>Key Market Drivers:</b>\n` +
    `${driversList || "• Price momentum & session flow"}\n`
  );
}
