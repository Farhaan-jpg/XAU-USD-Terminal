import config from "../lib/config.js";
import { spot } from "../lib/gold.js";
import { quote, quotes, candlesList } from "../lib/yahoo.js";
import { news } from "../lib/news.js";
import { calendar } from "../lib/calendar.js";
import { cot } from "../lib/cot.js";
import { bias } from "../lib/bias.js";

const startedAt = Date.now();
const pid = Math.floor(Math.random() * 1e6);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

function fail(e, tag) {
  return json({ error: tag + ": " + (e && e.message ? e.message : e), at: Date.now() }, 502);
}

async function handleApi(request, url) {
  if (url.pathname === "/api/health") {
    return json({
      up: true,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      now: Date.now(),
      pid,
      cache: { size: null },
    });
  }

  if (url.pathname === "/api/config") {
    return json({ poll: config.poll });
  }

  if (url.pathname === "/api/quotes") {
    try {
      const [spotR, futuresQ, corrQ, etfQ] = await Promise.all([
        spot(),
        quote(config.baseSymbol, config.baseName, 10000),
        quotes(config.correlations, 10000),
        quotes(config.etfs, 10000),
      ]);
      const now = new Date();
      const utcH = now.getUTCHours();
      return json({
        asof: Date.now(),
        spot: spotR,
        futures: futuresQ,
        correlated: corrQ,
        etfs: etfQ,
        sessions: {
          asia: utcH >= 0 && utcH < 8,
          london: utcH >= 8 && utcH < 13,
          newYork: utcH >= 13 && utcH < 21,
          goldMarket: true,
          weekend: [0, 6].includes(now.getUTCDay()),
        },
      });
    } catch (e) {
      return fail(e, "quotes");
    }
  }

  if (url.pathname === "/api/bias") {
    try {
      return json(await bias(Boolean(url.searchParams.get("refresh"))));
    } catch (e) {
      return fail(e, "bias");
    }
  }

  if (url.pathname === "/api/news") {
    try {
      return json({ asof: Date.now(), items: await news(Boolean(url.searchParams.get("refresh"))) });
    } catch (e) {
      return fail(e, "news");
    }
  }

  if (url.pathname === "/api/calendar") {
    try {
      return json({ asof: Date.now(), events: await calendar(Boolean(url.searchParams.get("refresh"))) });
    } catch (e) {
      return fail(e, "calendar");
    }
  }

  if (url.pathname === "/api/cot") {
    try {
      return json(await cot(Boolean(url.searchParams.get("refresh"))));
    } catch (e) {
      return fail(e, "cot");
    }
  }

  if (url.pathname === "/api/candles") {
    try {
      const sym = url.searchParams.get("sym") || "GC=F";
      const interval = url.searchParams.get("interval") || "5m";
      const range = url.searchParams.get("range") || "1d";
      const limit = Math.min(Number(url.searchParams.get("limit")) || 400, 900);
      const candles = await candlesList(sym, interval, range, 60000);
      return json({
        symbol: sym,
        interval,
        range,
        asof: Date.now(),
        candles: candles.slice(-limit),
      });
    } catch (e) {
      return fail(e, "candles");
    }
  }

  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(request, url);
    }
    return env.ASSETS.fetch(request);
  },
};