// background.js (MV3 service worker)
// Retrieval-first + extraction-only architecture for safer lyrics behavior.

const SETTINGS_KEY = "settings_v1";
const CACHE_PREFIX = "lyrics_v2_";

const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "gemini-1.5-flash", // user can change
  maxSourceChars: 18000
};

// ---------- Utilities ----------
function normalize(str) {
  return (str || "").toLowerCase().replace(/[^\w]+/g, "").trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isYouTubeWatchUrl(url) {
  return /^https:\/\/(www\.)?youtube\.com\/watch\?/.test(url || "");
}

function extractSongQueryFromTitle(rawTitle) {
  // Remove common YouTube suffix
  let title = (rawTitle || "").replace(/\s*-\s*YouTube\s*$/i, "").trim();

  // Remove bracketed noise [Official Video], (Lyrics), etc.
  title = title
    .replace(/\[(.*?)\]/g, " ")
    .replace(/\((official|video|lyrics?|audio|hd|4k|live|mv|visualizer).*?\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return title;
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
  return /here (are|is)|lyrics for|i can('|’)t|sorry|note:|explanation|analysis|translation|markdown/i.test(
    text || ""
  );
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

function firstNChars(text, n) {
  return (text || "").slice(0, n);
}

// ---------- Settings ----------
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

// ---------- Candidate sources ----------
function buildCandidateUrls(songQuery) {
  const q = encodeURIComponent(`${songQuery} lyrics`);
  // You can tune this list later
  return [
    `https://www.azlyrics.com/`,
    `https://genius.com/`,
    `https://www.lyrics.com/`,
    // fallback via search result pages (harder to parse reliably, but still source text)
    `https://duckduckgo.com/html/?q=${q}`
  ];
}

async function fetchText(url) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8"
    }
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  const html = await res.text();

  // Coarse HTML->text cleanup (service worker has no DOMParser for robust rendering in all cases)
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
      if (text && text.length > 200) {
        out.push({
          sourceUrl: url,
          sourceDomain: new URL(url).hostname,
          sourceText: firstNChars(text, maxSourceChars)
        });
      }
    } catch (e) {
      // skip failed source
    }
    await sleep(120);
  }

  return out;
}

// ---------- Gemini ----------
function extractionPrompt(songTitle, sourceDomain, sourceText) {
  return `
You are a strict text extractor.

Task:
Extract only song lyrics for "${songTitle}" from SOURCE_TEXT.

Hard Rules:
1) Use ONLY words that already appear in SOURCE_TEXT.
2) Do NOT paraphrase, complete, infer, or generate missing lines.
3) If clear full lyrics are not present, return exactly: NOT_FOUND
4) Return plain text lyrics only, preserving line breaks.
5) No markdown, no explanations, no extra text.

SOURCE_DOMAIN: ${sourceDomain}

SOURCE_TEXT:
${sourceText}
`.trim();
}

async function callGeminiExtract({ apiKey, model, songTitle, sourceDomain, sourceText }) {
  const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        parts: [{ text: extractionPrompt(songTitle, sourceDomain, sourceText) }]
      }
    ],
    generationConfig: {
      temperature: 0,
      topP: 0.1,
      maxOutputTokens: 1200
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: data?.error?.message || `Gemini HTTP ${res.status}`,
      status: res.status
    };
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  return { ok: true, text };
}

function modelFallbacks(primary) {
  const common = [
    primary,
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
    "gemini-2.0-flash-exp"
  ];
  // unique preserve order
  return [...new Set(common.filter(Boolean))];
}

async function extractWithModelFallback({ apiKey, model, songTitle, sourceDomain, sourceText }) {
  const models = modelFallbacks(model);
  let lastErr = "Unknown model error";

  for (const m of models) {
    const r = await callGeminiExtract({
      apiKey,
      model: m,
      songTitle,
      sourceDomain,
      sourceText
    });

    if (r.ok) return { ok: true, text: r.text, modelUsed: m };
    lastErr = r.error || lastErr;

    // if forbidden/invalid key, no point trying more models
    if (r.status === 401 || r.status === 403) break;
  }

  return { ok: false, error: lastErr };
}

// ---------- Main lyrics flow ----------
async function handleLyricsRequest({ title, pageUrl }) {
  const cleanTitle = extractSongQueryFromTitle(title || "");
  if (!cleanTitle) {
    return { success: false, error: "Missing song title." };
  }

  const settings = await getSettings();
  if (!settings.apiKey) {
    return {
      success: false,
      error: "Missing Gemini API key. Open extension popup and save your key."
    };
  }

  const cacheKey = `${CACHE_PREFIX}${normalize(cleanTitle)}`;
  const cache = await chrome.storage.local.get(cacheKey);
  if (cache[cacheKey]) {
    return { success: true, source: "cache", lyrics: cache[cacheKey].lyrics, meta: cache[cacheKey].meta };
  }

  // Collect source text first
  const sources = await collectSourceTexts(cleanTitle, settings.maxSourceChars);
  if (!sources.length) {
    return { success: false, error: "No source pages could be fetched for lyrics extraction." };
  }

  // Try each source until validated lyrics found
  for (const src of sources) {
    const ext = await extractWithModelFallback({
      apiKey: settings.apiKey,
      model: settings.model,
      songTitle: cleanTitle,
      sourceDomain: src.sourceDomain,
      sourceText: src.sourceText
    });

    if (!ext.ok) {
      continue;
    }

    const valid = isValidLyricsExtraction(ext.text, src.sourceText);
    if (!valid.ok) {
      continue;
    }

    const payload = {
      lyrics: ext.text,
      meta: {
        songTitle: cleanTitle,
        sourceDomain: src.sourceDomain,
        sourceUrl: src.sourceUrl,
        modelUsed: ext.modelUsed,
        validation: valid
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

  return {
    success: false,
    error:
      "Unable to verify lyrics from fetched sources. Try another video/title."
  };
}

// ---------- API key test ----------
async function testApi({ apiKey, model }) {
  if (!apiKey) return { success: false, error: "API key missing." };

  const probe = await callGeminiExtract({
    apiKey,
    model: model || DEFAULT_SETTINGS.model,
    songTitle: "Test Song",
    sourceDomain: "example.com",
    sourceText: "hello world NOT_FOUND"
  });

  if (!probe.ok) return { success: false, error: probe.error };
  return { success: true };
}

// ---------- Message router ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.action) {
        case "ping":
          sendResponse({ pong: true });
          return;

        case "getSettings": {
          const s = await getSettings();
          sendResponse({
            success: true,
            settings: { ...s, apiKey: s.apiKey ? "********" : "" } // mask in UI response
          });
          return;
        }

        case "saveSettings": {
          const next = await saveSettings({
            apiKey: (msg.apiKey || "").trim(),
            model: (msg.model || DEFAULT_SETTINGS.model).trim()
          });
          sendResponse({
            success: true,
            settings: { ...next, apiKey: next.apiKey ? "********" : "" }
          });
          return;
        }

        case "testApi": {
          const settings = await getSettings();
          const res = await testApi({
            apiKey: (msg.apiKey || settings.apiKey || "").trim(),
            model: (msg.model || settings.model || DEFAULT_SETTINGS.model).trim()
          });
          sendResponse(res);
          return;
        }

        case "getLyricsForTitle": {
          const res = await handleLyricsRequest({
            title: msg.title,
            pageUrl: msg.pageUrl
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

  return true; // async
});