const SETTINGS_KEY = "settings_v3";
const CACHE_PREFIX = "lyrics_v4_";
const FAIL_PREFIX = "fail_v3_";

const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "gemini-3.1-flash-lite",
  maxSourceChars: 24000
};

const MODEL_FALLBACKS = [
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash"
];

const LYRICS_HINTS = [
  "genius.com",
  "azlyrics.com",
  "lyrics.com",
  "musixmatch.com",
  "lyricstranslate.com",
  "jiosaavn.com",
  "nepali",
  "sajha",
  "sansar",
  "kosh"
];

// -------------------- utils --------------------
function normalize(str) {
  return (str || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim();
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function stripHtmlToText(html) {
  return (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function normalizeForTokens(t) {
  return (t || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'\n-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function tokenSet(t) {
  return new Set(normalizeForTokens(t).split(" ").filter(Boolean));
}
function overlapScore(extracted, source) {
  const a = tokenSet(extracted);
  const b = tokenSet(source);
  if (!a.size) return 0;
  let hit = 0;
  for (const tok of a) if (b.has(tok)) hit++;
  return hit / a.size;
}
function looksLikeMetaOutput(text) {
  return /here (are|is)|lyrics for|i can('|’)t|sorry|note:|explanation|analysis|translation|markdown|as an ai/i.test(
    text || ""
  );
}
function isValidLyricsExtraction(extracted, sourceText, looseMode = false) {
  if (!extracted) return { ok: false, reason: "empty" };
  const out = extracted.trim();
  if (!out || out === "NOT_FOUND") return { ok: false, reason: "not_found" };
  if (looksLikeMetaOutput(out)) return { ok: false, reason: "meta_output" };

  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4) return { ok: false, reason: "too_few_lines" };

  const score = overlapScore(out, sourceText);
  const threshold = looseMode ? 0.50 : 0.58;
  if (score < threshold) return { ok: false, reason: `low_overlap:${score.toFixed(2)}` };

  return { ok: true, score };
}
function cleanupTitle(raw) {
  let t = (raw || "").replace(/\s*-\s*YouTube\s*$/i, "").trim();
  t = t
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\((official|video|lyrics?|audio|hd|4k|live|mv|visualizer|performance|reaction)[^)]*\)/gi, " ")
    .replace(/\b(official|video|lyrics?|audio|hd|4k|live|mv|visualizer)\b/gi, " ")
    .replace(/\|/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}
function buildQueryVariants(rawTitle, manualQuery = "") {
  if (manualQuery && manualQuery.trim()) {
    const q = manualQuery.trim();
    return [...new Set([`"${q}" lyrics`, `${q} lyrics`, `${q} nepali lyrics`])];
  }

  const clean = cleanupTitle(rawTitle);
  const parts = clean.split(" ").filter(Boolean);

  const first4 = parts.slice(0, 4).join(" ");
  const first6 = parts.slice(0, 6).join(" ");

  return [...new Set([
    `"${clean}" lyrics`,
    `${clean} lyrics`,
    `${first6} lyrics`,
    `${first4} lyrics`,
    `${clean} nepali lyrics`,
    `${first6} nepali lyrics`,
    `${first4} nepali song lyrics`
  ].filter(Boolean))];
}
function orderedModels(primary) {
  return [...new Set([primary, ...MODEL_FALLBACKS].filter(Boolean))];
}
function hostHasLyricsHint(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return LYRICS_HINTS.some((x) => h.includes(x));
  } catch {
    return false;
  }
}

// -------------------- settings --------------------
async function getSettings() {
  const data = await chrome.storage.sync.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
}
async function saveSettings(partial) {
  const cur = await getSettings();
  const next = { ...cur, ...partial };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

// -------------------- retrieval --------------------
async function searchDuckDuckGo(query) {
  const q = encodeURIComponent(query);
  const url = `https://duckduckgo.com/html/?q=${q}`;
  const res = await fetch(url, { method: "GET", headers: { Accept: "text/html,*/*" } });
  if (!res.ok) throw new Error(`Search failed ${res.status}`);
  const html = await res.text();

  const links = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) {
    let href = m[1];
    try {
      const u = new URL(href, "https://duckduckgo.com");
      const uddg = u.searchParams.get("uddg");
      if (uddg) href = decodeURIComponent(uddg);
      if (/^https?:\/\//i.test(href)) links.push(href);
    } catch {}
    if (links.length >= 12) break;
  }

  if (!links.length) {
    const fallback = html.match(/https?:\/\/[^\s"'<>]+/g) || [];
    for (const x of fallback) {
      if (/duckduckgo\.com/.test(x)) continue;
      links.push(x);
      if (links.length >= 12) break;
    }
  }

  return [...new Set(links)];
}

async function fetchPageText(url) {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8"
      }
    });

    if (!res.ok) return { ok: false, reason: `http_${res.status}` };

    const html = await res.text();
    const text = stripHtmlToText(html);

    if (!text || text.length < 500) return { ok: false, reason: "too_short" };

    return { ok: true, text };
  } catch (e) {
    // CORS/network/etc
    return { ok: false, reason: `fetch_error:${String(e.message || e)}` };
  }
}

async function collectSourceTexts(rawTitle, manualQuery, maxSourceChars) {
  const queries = buildQueryVariants(rawTitle, manualQuery);
  const discovered = [];

  for (const q of queries.slice(0, 5)) {
    try {
      const links = await searchDuckDuckGo(q);
      discovered.push(...links);
    } catch {}
    await sleep(100);
  }

  const unique = [...new Set(discovered)];
  unique.sort((a, b) => {
    const da = hostHasLyricsHint(a) ? 1 : 0;
    const db = hostHasLyricsHint(b) ? 1 : 0;
    if (db !== da) return db - da;
    return a.length - b.length;
  });

  const candidates = unique.slice(0, 12);
  const out = [];

  for (const url of candidates) {
    const r = await fetchPageText(url);
    if (r.ok) {
      out.push({
        sourceUrl: url,
        sourceDomain: new URL(url).hostname,
        sourceText: r.text.slice(0, maxSourceChars)
      });
    }
    await sleep(120);
  }

  return out;
}

// -------------------- Gemini --------------------
function extractionPrompt(songTitle, sourceDomain, sourceText) {
  return `
You are a strict text extractor.
Task: extract only song lyrics for "${songTitle}" from SOURCE_TEXT.

Rules:
1) Use ONLY words already present in SOURCE_TEXT.
2) Do NOT paraphrase, complete, infer, or generate missing lines.
3) If clear lyrics are not present, return exactly: NOT_FOUND
4) Return plain text only, preserving lyric line breaks.
5) No commentary, no markdown, no explanation.

SOURCE_DOMAIN: ${sourceDomain}
SOURCE_TEXT:
${sourceText}
`.trim();
}

async function callGemini({ apiKey, model, songTitle, sourceDomain, sourceText }) {
  const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [{ parts: [{ text: extractionPrompt(songTitle, sourceDomain, sourceText) }] }],
    generationConfig: { temperature: 0, topP: 0.1, maxOutputTokens: 1400 }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, error: data?.error?.message || `Gemini HTTP ${res.status}` };
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  return { ok: true, text };
}

async function callGeminiWithRetryAndFallback(args) {
  const models = orderedModels(args.model);
  let lastError = "Unknown Gemini error";

  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await callGemini({ ...args, model });

      if (result.ok) return { ok: true, text: result.text, modelUsed: model };

      lastError = result.error || lastError;
      const s = result.status || 0;

      if (s === 401 || s === 403) return { ok: false, error: lastError };
      if (s === 404) break;
      if (s === 429 || s === 503) {
        await sleep([1200, 2500, 5000][attempt] || 5000);
        continue;
      }
      break;
    }
  }

  return { ok: false, error: lastError };
}

// -------------------- cache/failure --------------------
async function recentlyFailed(key) {
  const failKey = `${FAIL_PREFIX}${key}`;
  const got = await chrome.storage.local.get(failKey);
  const ts = got[failKey];
  if (!ts) return false;
  return Date.now() - ts < 8 * 60 * 1000;
}
async function markFail(key) {
  const failKey = `${FAIL_PREFIX}${key}`;
  await chrome.storage.local.set({ [failKey]: Date.now() });
}

// -------------------- main flow --------------------
async function handleLyricsRequest({ title, manualQuery = "", looseMode = false }) {
  const cleanedTitle = cleanupTitle(title || manualQuery || "");
  if (!cleanedTitle) return { success: false, error: "Missing song title." };

  const settings = await getSettings();
  if (!settings.apiKey) return { success: false, error: "Missing Gemini API key. Save it in Settings first." };

  const keyBase = manualQuery?.trim() ? manualQuery.trim() : cleanedTitle;
  const norm = normalize(keyBase);
  const cacheKey = `${CACHE_PREFIX}${norm}:${looseMode ? "loose" : "strict"}`;

  const cache = await chrome.storage.local.get(cacheKey);
  if (cache[cacheKey]) {
    return { success: true, source: "cache", lyrics: cache[cacheKey].lyrics, meta: cache[cacheKey].meta };
  }

  if (!manualQuery && (await recentlyFailed(norm))) {
    return { success: false, error: "Recent verification failed. Try manual query or Retry (looser match)." };
  }

  const sources = await collectSourceTexts(cleanedTitle, manualQuery, settings.maxSourceChars);
  if (!sources.length) {
    if (!manualQuery) await markFail(norm);
    return { success: false, error: "No source pages found for lyrics extraction." };
  }

  for (const src of sources) {
    const extracted = await callGeminiWithRetryAndFallback({
      apiKey: settings.apiKey,
      model: settings.model,
      songTitle: cleanedTitle,
      sourceDomain: src.sourceDomain,
      sourceText: src.sourceText
    });

    if (!extracted.ok) continue;

    const validation = isValidLyricsExtraction(extracted.text, src.sourceText, looseMode);
    if (!validation.ok) continue;

    const payload = {
      lyrics: extracted.text,
      meta: {
        songTitle: cleanedTitle,
        sourceDomain: src.sourceDomain,
        sourceUrl: src.sourceUrl,
        modelUsed: extracted.modelUsed,
        validation,
        looseMode
      }
    };

    await chrome.storage.local.set({ [cacheKey]: payload });

    return {
      success: true,
      source: "verified_extraction",
      lyrics: payload.lyrics,
      meta: payload.meta
    };
  }

  if (!manualQuery) await markFail(norm);
  return { success: false, error: "Unable to verify lyrics from fetched sources." };
}

// -------------------- test api --------------------
async function testApi({ apiKey, model }) {
  if (!apiKey) return { success: false, error: "API key missing." };

  const probe = await callGeminiWithRetryAndFallback({
    apiKey,
    model: model || DEFAULT_SETTINGS.model,
    songTitle: "Test Song",
    sourceDomain: "example.com",
    sourceText: "hello world NOT_FOUND"
  });

  if (!probe.ok) return { success: false, error: probe.error };
  return { success: true, modelUsed: probe.modelUsed };
}

// -------------------- message router --------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.action) {
        case "ping":
          sendResponse({ pong: true });
          return;

        case "getSettings": {
          const s = await getSettings();
          sendResponse({ success: true, settings: { ...s, apiKey: s.apiKey ? "********" : "" } });
          return;
        }

        case "saveSettings": {
          const next = await saveSettings({
            apiKey: (msg.apiKey || "").trim(),
            model: (msg.model || DEFAULT_SETTINGS.model).trim()
          });
          sendResponse({ success: true, settings: { ...next, apiKey: next.apiKey ? "********" : "" } });
          return;
        }

        case "testApi": {
          const cur = await getSettings();
          const res = await testApi({
            apiKey: (msg.apiKey || cur.apiKey || "").trim(),
            model: (msg.model || cur.model || DEFAULT_SETTINGS.model).trim()
          });

          if (res.success && res.modelUsed) await saveSettings({ model: res.modelUsed });
          sendResponse(res);
          return;
        }

        case "getLyricsForTitle": {
          const res = await handleLyricsRequest({
            title: msg.title || "",
            manualQuery: msg.manualQuery || "",
            looseMode: !!msg.looseMode
          });
          sendResponse(res);
          return;
        }

        case "clearCache":
          await chrome.storage.local.clear();
          sendResponse({ success: true });
          return;

        default:
          sendResponse({ success: false, error: "Unknown action." });
      }
    } catch (e) {
      sendResponse({ success: false, error: e.message || String(e) });
    }
  })();

  return true;
});
