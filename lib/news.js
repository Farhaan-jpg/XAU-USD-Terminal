import { XMLParser } from "fast-xml-parser";
import he from "he";
import config from "./config.js";
import { gate } from "./gate.js";

const rssParser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  processEntities: false,
  cdataPropName: "cdata",
});
const rssParserHtml = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  processEntities: false,
});

const BULLISH = [
  "surge", "soar", "rally", "record high", "jump", "gain", "bullish", "strong", "support",
  "safe haven", "haven", "bid", "higher", "rise", "rises", "rising", "boost", "boosted",
  "lift", "optimism", "demand", "inflow", "inflows", "outperform", "breakout", "break out",
  "top", "best", "beat", "upside", "recovery", "rebound", "climb", "advance", "saw gains",
  "buoyant", "firm", "steady", "positive", "hopes", "cut", "cuts", "rate cut",
];
const BEARISH = [
  "plunge", "fall", "falling", "drop", "slump", "slide", "weak", "retreat", "sell", "selling",
  "bearish", "pressure", "lower", "outflow", "outflows", "downside", "decline", "declines",
  "record low", "wipeout", "hit", "loss", "losses", "warn", "warning", "fear", "fears",
  "risk-off", "uncertainty", "selloff", "sell-off", "dump", "dump", "patience", "stocks fall",
  "greenback", "dollar strengthens", "hike", "rate hike", "hawkish", "taper", "overbought",
];
const GOLD_KEYS = [
  "gold", "xau", "bullion", "spot gold", "gold price", "ounce", "troy", "precious metal",
  "gold futures", "gld", "i\u2019", "kitco", "comex", "usd/oz",
];
const GEO_KEYS = [
  "war", "conflict", "ceasefire", "attack", "missile", "strike", "strikes", "sanction",
  "sanctions", "embargo", "invasion", "tension", "tensions", "clash", "military", "nuclear",
  "coup", "election", "elections", "talks", "diplomacy", "diplomatic", "crisis", "refugee",
  "assassination", "drone", "border", "gaza", "iran", "israel", "russia", "ukraine", "china",
  "taiwan", "tariff", "tariffs", "opec", "trade war", "oil", "energy", "kremlin", "putin",
  "maersk", "red sea", "houthi", "suez", "hezbollah", "hamas", "nato", "us-china", "federal reserve",
  "fed", "interest rate", "rate decision", "war cabinet", "martial law", "naval", "air strike",
  "ground offensive", "defense", "defence",
];

function slug(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ");
}

function scoreText(text) {
  const s = slug(text);
  let bull = 0, bear = 0;
  for (const w of BULLISH) {
    if (s.includes(w)) bull++;
  }
  for (const w of BEARISH) {
    if (s.includes(w)) bear++;
  }
  const total = bull + bear;
  if (!total) return { score: 0, bull, bear };
  return { score: Math.max(-1, Math.min(1, (bull - bear) / total)), bull, bear };
}

function goldRelevance(text) {
  const s = slug(text);
  const hits = GOLD_KEYS.filter((k) => s.includes(k));
  return {
    relevant: hits.length > 0,
    keys: hits.slice(0, 6),
  };
}

function geoDetect(text) {
  const s = slug(text);
  const hits = GEO_KEYS.filter((k) => s.includes(k));
  return {
    geo: hits.length > 0,
    keys: hits.slice(0, 6),
  };
}

const SOURCE_LABELS = {
  "feeds.finance.yahoo.com": "Yahoo Finance",
  "feeds.bbci.co.uk": "BBC",
  "aljazeera.com": "Al Jazeera",
  "theguardian.com": "The Guardian",
  "france24.com": "France 24",
  "feeds.skynews.com": "Sky News",
  "feeds.npr.org": "NPR",
  "timesofisrael.com": "Times of Israel",
};

function sourceLabel(url) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return SOURCE_LABELS[host] || host.replace("feeds.", "").split(".")[0] || host;
}

const seen = new Set();
const lastItems = [];
const feedCache = new Map();

async function fetchFeed(url) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const items = await gate(async () => {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 18000);
        try {
          const res = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
            },
            signal: ctrl.signal,
          });
          if (!res.ok) throw new Error("HTTP " + res.status);
          const xml = await res.text();
          return parseRss(xml);
        } finally {
          clearTimeout(to);
        }
      });
      if (!items || !items.length) throw new Error("empty feed");
      feedCache.set(url, items);
      return items;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
  }
  // upstream throttled/failed: fall back to the last good copy of this feed
  return feedCache.get(url) || [];
}

function stripTags(s) {
  return (s || "")
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function parseRss(xml) {
  let doc;
  try {
    doc = rssParser.parse(xml);
  } catch {
    return [];
  }
  if (!doc) return [];
  const ch = doc.rss && doc.rss.channel;
  let items = ch && ch.item;
  if (!items) return [];
  if (!Array.isArray(items)) items = items ? [items] : [];
  return items.map((it) => {
    let content = "";
    const enc = it.encoded || it.content || "";
    if (typeof enc === "string") content = enc;
    else if (enc && enc.cdata) content = String(enc.cdata);
    const title = stripTags(it.title);
    const link = typeof it.link === "string" ? it.link : (it.link && it.link.href) || "";
    const pubDate = it.isoDate || it.pubDate || it.date || it.updated || "";
    return { title, link, pubDate, content, snippet: stripTags(content || it.description).slice(0, 400) };
  });
}

export async function news(refresh = false) {
  if (lastItems.length && !refresh) return lastItems;
  const all = [];
  for (const url of config.goldFeeds) {
    const items = await fetchFeed(url);
    for (const it of items) {
      const headline = he.decode(it.title);
      const body = he.decode(it.snippet || it.content || "");
      const text = (headline + " " + body).slice(0, 600);
      const sent = scoreText(text);
      const rel = goldRelevance(text);
      const geo = geoDetect(text);
      const pub = it.pubDate ? new Date(it.pubDate).getTime() : Date.now();
      const dedupeKey = slug(headline).slice(0, 60);
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      all.push({
        id: dedupeKey,
        title: headline,
        link: it.link,
        published: pub,
        content: body,
        sentiment: sent.score,
        bullTags: sent.bull,
        bearTags: sent.bear,
        relevance: rel.relevant,
        relKeys: rel.keys,
        geo: geo.geo,
        geoKeys: geo.keys,
        source: sourceLabel(url),
      });
    }
  }
  // keep previously-seen items so a partially-failed refresh never empties the feed
  const freshIds = new Set(all.map((a) => a.id));
  for (const prev of lastItems) {
    if (!freshIds.has(prev.id)) all.push(prev);
  }
  all.sort((a, b) => b.published - a.published);
  lastItems.length = 0;
  lastItems.push(...all.slice(0, 60));
  return lastItems;
}

export async function newsSentiment() {
  const items = await news();
  const recent = items.filter((it) => Date.now() - it.published < 36 * 3600 * 1000).slice(0, 20);
  if (!recent.length) return { avg: 0, n: 0 };
  const now = Date.now();
  let sum = 0, w = 0;
  for (const it of recent) {
    const h = (now - it.published) / 3600e3;
    const wgt = 1 / (1 + h * 0.15);
    sum += it.sentiment * wgt;
    w += wgt;
  }
  return { avg: sum / w, n: recent.length };
}