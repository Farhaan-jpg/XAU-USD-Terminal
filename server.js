import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import config from "./lib/config.js";
import { spot } from "./lib/gold.js";
import { quotes, quote, chart, candlesList } from "./lib/yahoo.js";
import { news } from "./lib/news.js";
import { calendar } from "./lib/calendar.js";
import { cot } from "./lib/cot.js";
import { bias } from "./lib/bias.js";
import { runAlertChecks } from "./lib/alerts.js";
import { testTelegramConnection } from "./lib/telegram.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || config.port || 3800);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.disable("x-powered-by");

/* ---------------- helpers ---------------- */

function ok(res, data) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.json(data);
}

function fail(res, e, tag) {
  res.status(502).json({ error: tag + ": " + e.message, at: Date.now() });
}

const memo = new Map();
const lastLog = new Map();
async function guarded(key, fn, res) {
  try {
    const v = await fn();
    memo.set(key, v);
    ok(res, v);
  } catch (e) {
    const now = Date.now();
    if (now - (lastLog.get(key) || 0) > 300000) {
      console.error(`[${new Date(now).toISOString()}] guarded ${key} ->`, e && e.message ? e.message : e);
      lastLog.set(key, now);
    }
    const prev = memo.get(key);
    if (prev) {
      ok(res, { ...prev, stale: true, staleError: e.message });
    } else {
      fail(res, e, key);
    }
  }
}

/* ---------------- routes ---------------- */

app.get("/api/health", (req, res) => {
  ok(res, {
    up: true,
    uptimeSec: Math.round(process.uptime()),
    now: Date.now(),
    pid: process.pid,
    cache: { size: null },
  });
});

app.get("/api/config", (req, res) => {
  ok(res, { poll: config.poll });
});

app.get("/api/quotes", (req, res) => {
  guarded(
    "quotes",
    async () => {
      const [spotLeg, futLeg, corrLeg, etfLeg] = await Promise.allSettled([
        spot(),
        quote(config.baseSymbol, config.baseName, 10000),
        quotes(config.correlations, 10000),
        quotes(config.etfs, 10000),
      ]);
      const now = new Date();
      const utcH = now.getUTCHours();
      const spotR = spotLeg.status === "fulfilled" ? spotLeg.value : null;
      const futuresQ = futLeg.status === "fulfilled" ? futLeg.value : null;
      const corrQ = corrLeg.status === "fulfilled" ? corrLeg.value : [];
      const etfQ = etfLeg.status === "fulfilled" ? etfLeg.value : [];
      return {
        asof: Date.now(),
        spot: spotR,
        futures: futuresQ,
        correlated: corrQ,
        etfs: etfQ,
        sourceFreshness: {
          "gold-api spot": spotLeg.status === "fulfilled",
          "yahoo futures": futLeg.status === "fulfilled",
          "yahoo correlated": corrLeg.status === "fulfilled",
          "yahoo etf": etfLeg.status === "fulfilled",
        },
        sessions: {
          asia: utcH >= 0 && utcH < 8,
          london: utcH >= 8 && utcH < 13,
          newYork: utcH >= 13 && utcH < 21,
          goldMarket: true,
          weekend: [0, 6].includes(now.getUTCDay()),
        },
      };
    },
    res
  );
});

app.get("/api/bias", (req, res) => {
  guarded("bias", () => bias(Boolean(req.query.refresh)), res);
});

app.get("/api/news", (req, res) => {
  guarded("news", async () => ({
    asof: Date.now(),
    items: await news(Boolean(req.query.refresh)),
  }), res);
});

app.get("/api/calendar", (req, res) => {
  guarded(
    "calendar",
    async () => {
      const events = await calendar(Boolean(req.query.refresh));
      return { asof: Date.now(), events };
    },
    res
  );
});

app.get("/api/cot", (req, res) => {
  guarded("cot", async () => cot(Boolean(req.query.refresh)), res);
});

app.get("/api/candles", async (req, res) => {
  const sym = req.query.sym || "GC=F";
  const interval = req.query.interval || "5m";
  const range = req.query.range || "1d";
  const limit = Math.min(Number(req.query.limit) || 400, 900);
  try {
    const candles = await candlesList(sym, interval, range, 60000);
    ok(res, {
      symbol: sym,
      interval,
      range,
      asof: Date.now(),
      candles: candles.slice(-limit),
    });
  } catch (e) {
    fail(res, e, "candles");
  }
});

app.post("/api/telegram/test", async (req, res) => {
  try {
    const { botToken, chatId } = req.body || {};
    const t = botToken || process.env.TELEGRAM_BOT_TOKEN || config.telegram?.botToken;
    const c = chatId || process.env.TELEGRAM_CHAT_ID || config.telegram?.chatId;
    const result = await testTelegramConnection(t, c);
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    fail(res, e, "telegram-test");
  }
});

app.get("/api/telegram/config", (req, res) => {
  const hasToken = Boolean(process.env.TELEGRAM_BOT_TOKEN || config.telegram?.botToken);
  const hasChatId = Boolean(process.env.TELEGRAM_CHAT_ID || config.telegram?.chatId);
  ok(res, {
    configured: hasToken && hasChatId,
    enabled: config.telegram?.enabled ?? true,
    alertOnNews: config.telegram?.alertOnNews ?? true,
    alertOnCalendar: config.telegram?.alertOnCalendar ?? true,
    alertOnBiasShift: config.telegram?.alertOnBiasShift ?? true,
  });
});

app.post("/api/telegram/config", (req, res) => {
  try {
    const body = req.body || {};
    if (body.botToken != null) config.telegram.botToken = body.botToken;
    if (body.chatId != null) config.telegram.chatId = body.chatId;
    if (body.enabled != null) config.telegram.enabled = Boolean(body.enabled);
    if (body.alertOnNews != null) config.telegram.alertOnNews = Boolean(body.alertOnNews);
    if (body.alertOnCalendar != null) config.telegram.alertOnCalendar = Boolean(body.alertOnCalendar);
    if (body.alertOnBiasShift != null) config.telegram.alertOnBiasShift = Boolean(body.alertOnBiasShift);
    ok(res, { ok: true, config: { ...config.telegram, botToken: config.telegram.botToken ? "******" : "" } });
  } catch (e) {
    fail(res, e, "telegram-config-set");
  }
});

app.get("/api/diag", async (req, res) => {
  try {
    const [spotR, yahooR, candlesR, calR, cotR] = await Promise.all([
      spot().then(() => "ok").catch((e) => "fail: " + e.message),
      quote("GC=F", "GC=F", 9000).then(() => "ok").catch((e) => "fail: " + e.message),
      candlesList("GC=F", "5m", "1d", 12000).then((c) => c.length + " candles").catch((e) => "fail: " + e.message),
      calendar(true).then((e) => e.length + " events").catch((e) => "fail: " + e.message),
      cot(true).then((d) => (d && d.cot ? "ok" : "no data")).catch((e) => "fail: " + e.message),
    ]);
    ok(res, { asof: Date.now(), checks: { spot: spotR, yahoo: yahooR, candles: candlesR, calendar: calR, cot: cotR } });
  } catch (e) {
    fail(res, e, "diag");
  }
});

// Run background alert checks every 60 seconds 24/7
setInterval(() => {
  runAlertChecks().catch((e) => console.error("[server] alert loop error:", e.message));
}, 60000);

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ---------------- boot ---------------- */

function listen(port, attempt) {
  const server = app.listen(port, () => {
    console.log("====================================================");
    console.log("  XAU/USD ANALYSIS TERMINAL");
    console.log("  Local URL  : http://localhost:" + port);
    console.log("  Data feed  : gold-api.com (spot) + Yahoo Finance (futures/correlated)");
    console.log("               TradingView (calendar) + CFTC (COT/positioning)");
    console.log("====================================================");

    if (process.env.OPEN !== "0") {
      try {
        const url = "http://localhost:" + port;
        const cmd = process.platform === "win32" ? "cmd" : "xdg-open";
        const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
        const child = spawn(cmd, args, { detached: true, stdio: "ignore", shell: true });
        child.on("error", () => {
          /* no browser available (e.g. headless host) — safe to ignore */
        });
        child.unref();
      } catch {
        /* ignore */
      }
    }
  });
  server.on("error", (e) => {
    if (e.code === "EADDRINUSE" && attempt < 20) {
      console.log("port " + port + " busy, trying " + (port + 1) + "…");
      listen(port + 1, attempt + 1);
    } else {
      console.error("failed to start server:", e.message);
      process.exit(1);
    }
  });
}

listen(PORT, 0);

async function warmAll() {
  const quiet = (p) => p.catch(() => null);
  const t0 = Date.now();
  console.log("warming upstream caches…");
  await Promise.all([
    quiet(news(true)),
    quiet(Promise.all([spot(), quote(config.baseSymbol, config.baseName, 10000), quotes(config.correlations, 10000), quotes(config.etfs, 10000)])),
    quiet(bias(true)),
    quiet(calendar(true)),
    quiet(cot(true)),
  ]);
  console.log("warm-up complete in " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
}
warmAll();