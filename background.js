const SETTINGS_KEY = "settings_v4";
const CACHE_PREFIX = "lyrics_v5_";

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

// ---------- utils ----------
function normalize(str) {
  return (str || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim();
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function cleanTitle(raw) {
  return (raw || "")
    .replace(/\s*-\s*YouTube\s*$/i, "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\((official|video|lyrics?|audio|hd|4k|live|mv|visualizer|performance|reaction)[^)]*\)/gi, " ")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
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
  return /here (are|is)|lyrics for|i can('|’)t|sorry|note:|explanation|analysis|translation|markdown|as an ai/i.test(text || "");
}
function isValidLyricsExtraction(extracted, sourceText, looseMode = false) {
  if (!extracted) return { ok: false, reason: "empty" };
  const out = extracted.trim();
  if (!out || out === "NOT_FOUND") return { ok: false, reason: "not_found" };
  if (looksLikeMetaOutput(out)) return { ok: false, reason: "meta_output" };

  const lines = out.split("\n").map((x) => x.trim()).filter(Boolean);
  if (lines.length < 3) return { ok: false, reason: "too_few_lines" };

  const score = overlapScore(out, sourceText);
  const threshold = looseMode ? 0.45 : 0.55;
  if (score < threshold) return { ok: false, reason: `low_overlap:${score.toFixed(2)}` };

  return { ok: true, score };
}

// ---------- settings ----------
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

// ---------- Gemini ----------
function orderedModels(primary) {
  return [...new Set([primary, ...MODEL_FALLBACKS].filter(Boolean))];
}
function extractionPrompt(songTitle, sourceName, sourceText) {
  return `
You are a strict text extractor.
Task: extract only song lyrics for "${songTitle}" from SOURCE_TEXT.

Rules:
1) Use ONLY words present in SOURCE_TEXT.
2) Do NOT infer or generate missing lines.
3) If lyrics are not clearly present, return exactly: NOT_FOUND
4) Plain text only, preserve line breaks.
5) No commentary.

SOURCE_NAME: ${sourceName}
SOURCE_TEXT:
${sourceText}
`.trim();
}
async function callGemini({ apiKey, model, songTitle, sourceName, sourceText }) {
  const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [{ parts: [{ text: extractionPrompt(songTitle, sourceName, sourceText) }] }],
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
async function callGeminiWithFallback(args) {
  const models = orderedModels(args.model);
  let lastError = "Unknown Gemini error";

  for (const m of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await callGemini({ ...args, model: m });
      if (r.ok) return { ok: true, text: r.text, modelUsed: m };

      lastError = r.error || lastError;
      if (r.status === 401 || r.status === 403) return { ok: false, error: lastError };
      if (r.status === 404) break; // next model
      if (r.status === 429 || r.status === 503) {
        await sleep([1200, 2500, 5000][attempt] || 5000);
        continue;
      }
      break;
    }
  }
  return { ok: false, error: lastError };
}

// ---------- Source strategy (CORS-safe) ----------

// 1) Try to extract useful text directly from active YouTube tab
async function getYouTubePageTextFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab?.url?.includes("youtube.com/watch")) return null;

  const injected = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const chunks = [];

      // title and meta
      const title = document.title || "";
      chunks.push(title);

      // description area text
      const desc = document.querySelector("#description, #description-inline-expander, ytd-text-inline-expander");
      if (desc?.innerText) chunks.push(desc.innerText);

      // transcript panel text (if open/available)
      const transcriptNodes = document.querySelectorAll("ytd-transcript-segment-renderer, .segment-text, #segments-container *");
      if (transcriptNodes.length) {
        const t = Array.from(transcriptNodes).map(n => n.innerText || "").join("\n");
        if (t.trim()) chunks.push(t);
      }

      // generic fallback text sample from page
      const bodyText = (document.body?.innerText || "").slice(0, 12000);
      if (bodyText.trim()) chunks.push(bodyText);

      return chunks.join("\n\n").trim();
    }
  });

  return injected?.[0]?.result || null;
}

// 2) DuckDuckGo snippets only (no external page fetch)
async function searchDuckDuckGoSnippets(query) {
  const q = encodeURIComponent(query);
  const url = `https://duckduckgo.com/html/?q=${q}`;
  const res = await fetch(url, { method: "GET", headers: { Accept: "text/html,*/*" } });
  if (!res.ok) return [];

  const html = await res.text();

  // extract snippet texts
  const snippets = [];
  const snippetRegexes = [
    /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
    /<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
  ];

  for (const re of snippetRegexes) {
    let m;
    while ((m = re.exec(html))) {
      const text = m[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length > 60) snippets.push(text);
      if (snippets.length >= 20) break;
    }
    if (snippets.length >= 20) break;
  }

  return [...new Set(snippets)];
}

function buildQueries(title, manualQuery) {
  const t = cleanTitle(manualQuery || title || "");
  const parts = t.split(" ").filter(Boolean);
  const p4 = parts.slice(0, 4).join(" ");
  const p6 = parts.slice(0, 6).join(" ");

  return [...new Set([
    `"${t}" lyrics`,
    `${t} lyrics`,
    `${p6} lyrics`,
    `${p4} lyrics`,
    `${t} nepali lyrics`,
    `${p6} nepali song lyrics`
  ].filter((x) => x.trim().length > 0))];
}

async function collectSources({ title, manualQuery, maxSourceChars }) {
  const sources = [];

  // youtube source
  const ytText = await getYouTubePageTextFromActiveTab();
  if (ytText && ytText.length > 500) {
    sources.push({
      sourceName: "youtube_page_text",
      sourceText: ytText.slice(0, maxSourceChars)
    });
  }

  // ddg snippets source(s)
  const queries = buildQueries(title, manualQuery);
  for (const q of queries.slice(0, 4)) {
    const snippets = await searchDuckDuckGoSnippets(q);
    if (snippets.length) {
      const joined = snippets.join("\n");
      if (joined.length > 300) {
        sources.push({
          sourceName: `duckduckgo_snippets:${q}`,
          sourceText: joined.slice(0, maxSourceChars)
        });
      }
    }
    await sleep(100);
  }

  return sources;
}

// ---------- main ----------
async function handleLyricsRequest({ title, manualQuery = "", looseMode = false }) {
  const queryTitle = cleanTitle(manualQuery || title || "");
  if (!queryTitle) return { success: false, error: "Missing song title." };

  const settings = await getSettings();
  if (!settings.apiKey) return { success: false, error: "Missing Gemini API key. Save it in Settings." };

  const cacheKey = `${CACHE_PREFIX}${normalize(queryTitle)}:${looseMode ? "loose" : "strict"}`;
  const c = await chrome.storage.local.get(cacheKey);
  if (c[cacheKey]) {
    return { success: true, source: "cache", lyrics: c[cacheKey].lyrics, meta: c[cacheKey].meta };
  }

  const sources = await collectSources({
    title: queryTitle,
    manualQuery,
    maxSourceChars: settings.maxSourceChars
  });

  if (!sources.length) {
    return {
      success: false,
      error: "No usable source text found. Try manual search title with artist name."
    };
  }

  for (const src of sources) {
    const ext = await callGeminiWithFallback({
      apiKey: settings.apiKey,
      model: settings.model,
      songTitle: queryTitle,
      sourceName: src.sourceName,
      sourceText: src.sourceText
    });

    if (!ext.ok) continue;

    const valid = isValidLyricsExtraction(ext.text, src.sourceText, looseMode);
    if (!valid.ok) continue;

    const payload = {
      lyrics: ext.text,
      meta: {
        sourceName: src.sourceName,
        modelUsed: ext.modelUsed,
        validation: valid,
        looseMode
      }
    };

    await chrome.storage.local.set({ [cacheKey]: payload });
    return { success: true, source: "verified_extraction", lyrics: payload.lyrics, meta: payload.meta };
  }

  return {
    success: false,
    error: "Could not verify lyrics from available source text. Try manual title: '<song> <artist> lyrics'."
  };
}

async function testApi({ apiKey, model }) {
  if (!apiKey) return { success: false, error: "API key missing." };
  const r = await callGeminiWithFallback({
    apiKey,
    model,
    songTitle: "test",
    sourceName: "probe",
    sourceText: "line one\nline two\nline three"
  });
  if (!r.ok) return { success: false, error: r.error };
  return { success: true, modelUsed: r.modelUsed };
}

// ---------- router ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.action) {
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
