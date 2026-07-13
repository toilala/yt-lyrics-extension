const SETTINGS_KEY = "settings_v1";
const CACHE_PREFIX = "lyrics_v2_";
const FAIL_PREFIX = "fail_v1_";

const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "gemini-3.1-flash-lite",
  maxSourceChars: 18000
};

const MODEL_FALLBACKS = [
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash"
];

function normalize(str) {
  return (str || "").toLowerCase().replace(/[^\w]+/g, "").trim();
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function sanitizeText(text) {
  return (text || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function normalizeForTokens(t) {
  return (t || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'\n]/g, " ")
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
  return /here (are|is)|lyrics for|i can('|’)t|sorry|note:|explanation|analysis|translation|markdown/i.test(text || "");
}
function isValidLyricsExtraction(extracted, sourceText) {
  if (!extracted) return { ok: false, reason: "empty" };
  const out = extracted.trim();
  if (!out || out === "NOT_FOUND") return { ok: false, reason: "not_found" };
  if (looksLikeMetaOutput(out)) return { ok: false, reason: "meta_output" };
  const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 4) return { ok: false, reason: "too_few_lines" };
  const score = overlapScore(out, sourceText);
  if (score < 0.72) return { ok: false, reason: `low_overlap:${score.toFixed(2)}` };
  return { ok: true, score };
}
function extractSongQueryFromTitle(rawTitle) {
  let title = (rawTitle || "").replace(/\s*-\s*YouTube\s*$/i, "").trim();
  title = title
    .replace(/\[(.*?)\]/g, " ")
    .replace(/\((official|video|lyrics?|audio|hd|4k|live|mv|visualizer).*?\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title;
}
function firstNChars(text, n) {
  return (text || "").slice(0, n);
}

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
function orderedModels(primary) {
  return [...new Set([primary, ...MODEL_FALLBACKS].filter(Boolean))];
}
function extractionPrompt(songTitle, sourceDomain, sourceText) {
  return `
You are a strict text extractor.
Task: extract only song lyrics for "${songTitle}" from SOURCE_TEXT.

Rules:
1) Use ONLY words that appear in SOURCE_TEXT.
2) Do NOT paraphrase, complete, infer, or generate missing lines.
3) If clear lyrics are not present, return exactly: NOT_FOUND
4) Plain text only, preserve line breaks, no commentary/markdown.

SOURCE_DOMAIN: ${sourceDomain}
SOURCE_TEXT:
${sourceText}
`.trim();
}

async function callGemini({ apiKey, model, songTitle, sourceDomain, sourceText }) {
  const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ parts: [{ text: extractionPrompt(songTitle, sourceDomain, sourceText) }] }],
    generationConfig: { temperature: 0, topP: 0.1, maxOutputTokens: 1200 }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: data?.error?.message || `HTTP ${res.status}` };

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
      const status = result.status || 0;

      if (status === 401 || status === 403) {
        return { ok: false, error: lastError };
      }
      if (status === 404) {
        break;
      }
      if (status === 429 || status === 503) {
        const backoff = [1200, 2500, 5000][attempt] || 5000;
        await sleep(backoff);
        continue;
      }
      break;
    }
  }

  return { ok: false, error: lastError };
}

function buildCandidateUrls(songQuery) {
  const q = encodeURIComponent(`${songQuery} lyrics`);
  return [
    `https://duckduckgo.com/html/?q=${q}`,
    `https://www.azlyrics.com/`,
    `https://genius.com/`,
    `https://www.lyrics.com/`
  ];
}
async function fetchText(url) {
  const res = await fetch(url, { method: "GET", headers: { Accept: "text/html,text/plain,*/*" } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return sanitizeText(text);
}
async function collectSourceTexts(songQuery, maxSourceChars) {
  const urls = buildCandidateUrls(songQuery);
  const out = [];
  for (const url of urls) {
    try {
      const text = await fetchText(url);
      if (text.length > 200) {
        out.push({
          sourceUrl: url,
          sourceDomain: new URL(url).hostname,
          sourceText: firstNChars(text, maxSourceChars)
        });
      }
    } catch {}
    await sleep(120);
  }
  return out;
}

async function recentlyFailed(key) {
  const failKey = `${FAIL_PREFIX}${key}`;
  const got = await chrome.storage.local.get(failKey);
  const ts = got[failKey];
  if (!ts) return false;
  return Date.now() - ts < 10 * 60 * 1000;
}
async function markFail(key) {
  const failKey = `${FAIL_PREFIX}${key}`;
  await chrome.storage.local.set({ [failKey]: Date.now() });
}

async function handleLyricsRequest({ title }) {
  const cleanTitle = extractSongQueryFromTitle(title || "");
  if (!cleanTitle) return { success: false, error: "Missing song title." };

  const settings = await getSettings();
  if (!settings.apiKey) return { success: false, error: "Missing Gemini API key. Save it in popup settings first." };

  const normalized = normalize(cleanTitle);
  const cacheKey = `${CACHE_PREFIX}${normalized}`;

  const cache = await chrome.storage.local.get(cacheKey);
  if (cache[cacheKey]) return { success: true, source: "cache", lyrics: cache[cacheKey].lyrics, meta: cache[cacheKey].meta };

  if (await recentlyFailed(normalized)) {
    return { success: false, error: "Recent verification failed for this title. Try again in a few minutes." };
  }

  const sources = await collectSourceTexts(cleanTitle, settings.maxSourceChars);
  if (!sources.length) return { success: false, error: "No source pages fetched for extraction." };

  for (const src of sources) {
    const extracted = await callGeminiWithRetryAndFallback({
      apiKey: settings.apiKey,
      model: settings.model,
      songTitle: cleanTitle,
      sourceDomain: src.sourceDomain,
      sourceText: src.sourceText
    });

    if (!extracted.ok) continue;

    const valid = isValidLyricsExtraction(extracted.text, src.sourceText);
    if (!valid.ok) continue;

    const payload = {
      lyrics: extracted.text,
      meta: {
        songTitle: cleanTitle,
        sourceDomain: src.sourceDomain,
        sourceUrl: src.sourceUrl,
        modelUsed: extracted.modelUsed,
        validation: valid
      }
    };

    await chrome.storage.local.set({ [cacheKey]: payload });
    return { success: true, source: "verified_extraction", lyrics: payload.lyrics, meta: payload.meta };
  }

  await markFail(normalized);
  return { success: false, error: "Unable to verify lyrics from fetched sources." };
}

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
          if (res.success && res.modelUsed) {
            await saveSettings({ model: res.modelUsed });
          }
          sendResponse(res);
          return;
        }
        case "getLyricsForTitle": {
          const res = await handleLyricsRequest({ title: msg.title || "" });
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
