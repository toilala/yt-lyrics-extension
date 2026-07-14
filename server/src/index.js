import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";
import NodeCache from "node-cache";
import pLimit from "p-limit";

dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 8080);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12000);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim());

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error("Not allowed by CORS"));
    }
  })
);

const cache = new NodeCache({ stdTTL: 60 * 60 * 24, checkperiod: 120 }); // 24h
const searchLimit = pLimit(5);

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36";

function normalize(s = "") {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function cleanTitle(raw = "") {
  return raw
    .replace(/\s*-\s*YouTube\s*$/i, "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\((official|video|lyrics?|audio|hd|4k|live|mv|visualizer|performance|reaction|unplugged)[^)]*\)/gi, " ")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeQueries(title, artist = "") {
  const t = cleanTitle(title);
  const base = artist ? `${t} ${artist}` : t;
  const parts = base.split(" ").filter(Boolean);
  const p4 = parts.slice(0, 4).join(" ");
  const p6 = parts.slice(0, 6).join(" ");

  return [...new Set([
    `"${base}" lyrics`,
    `${base} lyrics`,
    `${p6} lyrics`,
    `${p4} lyrics`,
    `${base} nepali lyrics`,
    `${base} song lyrics`
  ])];
}

async function fetchHtml(url) {
  const res = await axios.get(url, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "text/html,application/xhtml+xml"
    },
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400
  });
  return String(res.data || "");
}

function absoluteUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

async function searchDuckDuckGo(query) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const links = new Set();

  $("a.result__a").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const u = new URL(href, "https://duckduckgo.com");
      const uddg = u.searchParams.get("uddg");
      const real = uddg ? decodeURIComponent(uddg) : href;
      if (/^https?:\/\//i.test(real)) links.add(real);
    } catch {}
  });

  // fallback
  if (!links.size) {
    const regex = /https?:\/\/[^\s"'<>]+/g;
    const hits = html.match(regex) || [];
    for (const h of hits) {
      if (!h.includes("duckduckgo.com")) links.add(h);
      if (links.size >= 15) break;
    }
  }

  return Array.from(links).slice(0, 15);
}

function textFromHtml(html) {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,header,footer,nav").remove();
  const txt = $("body").text();
  return txt.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractLikelyLyricsBlocks(html) {
  const $ = cheerio.load(html);
  const blocks = [];

  const selectors = [
    '[class*="lyric"]',
    '[id*="lyric"]',
    'div[class*="Lyrics"]',
    "article",
    "main",
    "pre"
  ];

  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const t = $(el).text().replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if (t.length > 200) blocks.push(t);
    });
  }

  // generic large paragraph grouping fallback
  const bodyText = $("body").text().replace(/\r/g, "");
  if (bodyText.length > 500) blocks.push(bodyText);

  return [...new Set(blocks)].slice(0, 8);
}

function tokenSet(text) {
  return new Set(normalize(text).split(" ").filter(Boolean));
}

function overlapScore(a, b) {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (!ta.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / ta.size;
}

function cleanModelOutput(text = "") {
  return text
    .replace(/^```[\s\S]*?\n/, "")
    .replace(/```$/, "")
    .trim();
}

function lineCount(text = "") {
  return text.split("\n").map((x) => x.trim()).filter(Boolean).length;
}

function dedupeLines(text = "") {
  const seen = new Set();
  const out = [];
  for (const l of text.split("\n")) {
    const t = l.trim();
    if (!t) continue;
    const k = normalize(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.join("\n");
}

async function callGemini(prompt, model = GEMINI_MODEL) {
  if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY on server");

  const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0,
      topP: 0.1,
      maxOutputTokens: 1400
    }
  };

  const res = await axios.post(url, body, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: { "Content-Type": "application/json" },
    validateStatus: () => true
  });

  if (res.status < 200 || res.status >= 300) {
    throw new Error(res.data?.error?.message || `Gemini ${res.status}`);
  }

  return cleanModelOutput(res.data?.candidates?.[0]?.content?.parts?.[0]?.text || "");
}

function extractionPrompt(songTitle, block, sourceUrl) {
  return `
You are a strict lyrics extractor.

Task:
Extract lyrics for "${songTitle}" ONLY from SOURCE_TEXT.

Rules:
1) Use only words from SOURCE_TEXT.
2) Do not infer or generate missing lines.
3) If no clear lyrics are present, return exactly: NOT_FOUND
4) Plain text only. No explanation.

SOURCE_URL: ${sourceUrl}
SOURCE_TEXT:
${block}
`.trim();
}

function continuationPrompt(songTitle, block, sourceUrl, current) {
  return `
You are a strict lyrics extractor.

Task:
Extract ADDITIONAL lyric lines for "${songTitle}" from SOURCE_TEXT that are not already in CURRENT.

Rules:
1) Use only words from SOURCE_TEXT.
2) Return only new lyric lines.
3) If nothing new, return exactly: NOT_FOUND
4) Plain text only.

SOURCE_URL: ${sourceUrl}
CURRENT:
${current}

SOURCE_TEXT:
${block}
`.trim();
}

async function extractFromBlock(songTitle, block, sourceUrl) {
  let first = await callGemini(extractionPrompt(songTitle, block, sourceUrl));
  if (!first || first === "NOT_FOUND") return null;

  let merged = first;
  let second = await callGemini(continuationPrompt(songTitle, block, sourceUrl, merged));
  if (second && second !== "NOT_FOUND") merged += `\n${second}`;

  merged = dedupeLines(merged);

  const lines = lineCount(merged);
  const overlap = overlapScore(merged, block);
  if (lines < 4 || overlap < 0.5) return null;

  return { lyrics: merged, lines, overlap, sourceUrl };
}

async function retrieveLyrics({ title, artist = "" }) {
  const songTitle = cleanTitle(title);
  const queries = makeQueries(songTitle, artist);

  const urls = new Set();
  for (const q of queries.slice(0, 5)) {
    const links = await searchDuckDuckGo(q).catch(() => []);
    for (const l of links) urls.add(l);
  }

  const candidateUrls = Array.from(urls).slice(0, 20);

  const blocks = [];
  await Promise.all(
    candidateUrls.map((u) =>
      searchLimit(async () => {
        try {
          const html = await fetchHtml(u);
          const b = extractLikelyLyricsBlocks(html);
          for (const x of b) {
            blocks.push({
              sourceUrl: u,
              block: x.slice(0, 28000)
            });
          }
        } catch {}
      })
    )
  );

  if (!blocks.length) return { status: "not_found", reason: "no_blocks" };

  // rank candidate blocks quickly by keyword presence
  const titleTokens = songTitle.toLowerCase().split(" ").filter(Boolean);
  blocks.sort((a, b) => {
    const sa = titleTokens.reduce((n, t) => n + (a.block.toLowerCase().includes(t) ? 1 : 0), 0);
    const sb = titleTokens.reduce((n, t) => n + (b.block.toLowerCase().includes(t) ? 1 : 0), 0);
    return sb - sa;
  });

  let best = null;
  for (const cand of blocks.slice(0, 12)) {
    const got = await extractFromBlock(songTitle, cand.block, cand.sourceUrl).catch(() => null);
    if (!got) continue;
    if (!best || got.lines > best.lines || got.overlap > best.overlap) best = got;
    if (best && best.lines >= 28) break;
  }

  if (!best) return { status: "not_found", reason: "validation_failed" };

  return {
    status: best.lines >= 20 ? "full" : "partial",
    lyrics: best.lyrics,
    meta: {
      lines: best.lines,
      overlap: Number(best.overlap.toFixed(3)),
      sourceUrl: best.sourceUrl
    }
  };
}

// ---------- API ----------
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "yt-lyrics-backend" });
});

app.post("/lyrics", async (req, res) => {
  try {
    const title = String(req.body?.title || "").trim();
    const artist = String(req.body?.artist || "").trim();

    if (!title) return res.status(400).json({ success: false, error: "title is required" });

    const key = `lyrics:${normalize(title)}:${normalize(artist)}`;
    const cached = cache.get(key);
    if (cached) return res.json({ success: true, source: "cache", ...cached });

    const result = await retrieveLyrics({ title, artist });
    if (result.status === "not_found") {
      return res.json({ success: false, error: "Lyrics not found with sufficient confidence", reason: result.reason });
    }

    cache.set(key, result);
    return res.json({ success: true, source: "live", ...result });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message || "internal_error" });
  }
});

app.listen(PORT, () => {
  console.log(`yt-lyrics-backend running on :${PORT}`);
});