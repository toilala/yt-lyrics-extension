const SETTINGS_KEY = "settings_v6";
const CACHE_PREFIX = "lyrics_v7_";

const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "gemini-3.1-flash-lite",
  maxSourceChars: 26000
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

function sleep(ms) { 
  return new Promise((r) => setTimeout(r, ms)); 
}

function cleanTitle(raw) {
  return (raw || "")
    .replace(/\s*-\s*YouTube\s*$/i, "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\((official|video|lyrics?|audio|hd|4k|live|mv|visualizer|performance|reaction|unplugged)[^)]*\)/gi, " ")
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

function lineCount(text) {
  return (text || "").split("\n").map(s => s.trim()).filter(Boolean).length;
}

function uniqueLines(text) {
  const out = [];
  let lastK = "";
  for (const l of (text || "").split("\n")) {
    const t = l.trim();
    if (!t) continue;
    const k = normalizeForTokens(t);
    // Only skip if the exact same line is repeated back-to-back (AI stutter)
    if (k && k === lastK) continue; 
    lastK = k;
    out.push(t);
  }
  return out.join("\n");
}

function isValidLyricsExtraction(extracted, sourceText, looseMode = false) {
  if (!extracted) return { ok: false, reason: "empty" };
  const out = extracted.trim();
  if (!out || out === "NOT_FOUND") return { ok: false, reason: "not_found" };
  if (looksLikeMetaOutput(out)) return { ok: false, reason: "meta_output" };

  const lines = lineCount(out);
  if (lines < 3) return { ok: false, reason: "too_few_lines" };

  const score = overlapScore(out, sourceText);
  const threshold = looseMode ? 0.42 : 0.52;
  if (score < threshold) return { ok: false, reason: `low_overlap:${score.toFixed(2)}` };

  return { ok: true, score, lines };
}

function orderedModels(primary) {
  return [...new Set([primary, ...MODEL_FALLBACKS].filter(Boolean))];
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

// ---------- Gemini core ----------
async function callGeminiRaw({ apiKey, model, body }) {
  const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, error: data?.error?.message || `HTTP ${res.status}` };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  return { ok: true, text, data };
}

async function callWithFallback({ apiKey, preferredModel, body }) {
  const models = orderedModels(preferredModel);
  let lastError = "Unknown Gemini error";

  for (const m of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await callGeminiRaw({ apiKey, model: m, body });
      if (r.ok) return { ok: true, text: r.text, modelUsed: m, data: r.data };

      lastError = r.error || lastError;
      if (r.status === 401 || r.status === 403) return { ok: false, error: lastError };
      if (r.status === 404) break;
      if (r.status === 429 || r.status === 503) {
        await sleep([1200, 2500, 5000][attempt] || 5000);
        continue;
      }
      break;
    }
  }
  return { ok: false, error: lastError };
}

// ---------- prompts ----------
function extractionPrompt(songTitle, sourceName, sourceText) {
  return `
You are a strict text extractor.
Extract only lyrics for "${songTitle}" from SOURCE_TEXT.

Rules:
1) Use ONLY words present in SOURCE_TEXT.
2) Do NOT infer or generate missing lines.
3) If unclear, return exactly: NOT_FOUND
4) Plain text only, preserve line breaks.
5) No commentary.

SOURCE_NAME: ${sourceName}
SOURCE_TEXT:
${sourceText}
`.trim();
}

function continuationPrompt(songTitle, sourceName, sourceText, lastExtractedLines) {
  return `
You are a strict text extractor.
Extract the NEXT lyric lines for "${songTitle}" from SOURCE_TEXT.

Here are the LAST FEW LINES we already extracted:
${lastExtractedLines}

Rules:
1) Find where those last few lines appear in SOURCE_TEXT, and extract ONLY the lines that come AFTER them.
2) Use ONLY words present in SOURCE_TEXT.
3) Do NOT repeat the lines shown above.
4) If there are no more lyrics after that point, return exactly: NOT_FOUND
5) Plain text only.

SOURCE_NAME: ${sourceName}
SOURCE_TEXT:
${sourceText}
`.trim();
}

function groundedPrompt(songTitle) {
  return `
Find lyrics text for "${songTitle}" from web-grounded sources.
Return only plain lyric lines.
No explanation, no markdown.
If not found, return NOT_FOUND.
`.trim();
}

// ---------- CORS-safe local sources ----------
async function getYouTubePageTextFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab?.url?.includes("youtube.com/watch")) return "";

  const r = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const chunks = [];
      chunks.push(document.title || "");
      const desc = document.querySelector("#description, #description-inline-expander, ytd-text-inline-expander");
      if (desc?.innerText) chunks.push(desc.innerText);

      const tr = document.querySelectorAll("ytd-transcript-segment-renderer, .segment-text, #segments-container *");
      if (tr.length) {
        const t = Array.from(tr).map(n => n.innerText || "").join("\n");
        if (t.trim()) chunks.push(t);
      }

      const bodySample = (document.body?.innerText || "").slice(0, 14000);
      if (bodySample.trim()) chunks.push(bodySample);

      return chunks.join("\n\n").trim();
    }
  });

  return r?.[0]?.result || "";
}

async function searchDuckDuckGoSnippets(query) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { method: "GET", headers: { Accept: "text/html,*/*" } });
  if (!res.ok) return [];
  const html = await res.text();

  const snippets = [];
  const regexes = [
    /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
    /<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/gi
  ];

  for (const re of regexes) {
    let m;
    while ((m = re.exec(html))) {
      const txt = m[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
      if (txt.length > 50) snippets.push(txt);
      if (snippets.length >= 30) break;
    }
    if (snippets.length >= 30) break;
  }
  return [...new Set(snippets)];
}

function buildQueries(title, manualQuery) {
  const t = cleanTitle(manualQuery || title || "");
  const p = t.split(" ").filter(Boolean);
  const p4 = p.slice(0, 4).join(" ");
  const p6 = p.slice(0, 6).join(" ");

  return [...new Set([
    `"${t}" lyrics`,
    `${t} lyrics`,
    `${p6} lyrics`,
    `${p4} lyrics`,
    `${t} nepali lyrics`,
    `${p6} nepali song lyrics`
  ].filter(Boolean))];
}

async function collectLocalSources({ title, manualQuery, maxSourceChars }) {
  const out = [];
  const yt = await getYouTubePageTextFromActiveTab();
  if (yt && yt.length > 500) out.push({ sourceName: "youtube_page_text", sourceText: yt.slice(0, maxSourceChars) });

  const queries = buildQueries(title, manualQuery);
  for (const q of queries.slice(0, 4)) {
    const snips = await searchDuckDuckGoSnippets(q);
    if (snips.length) {
      const joined = snips.join("\n");
      if (joined.length > 300) out.push({ sourceName: `duckduckgo_snippets:${q}`, sourceText: joined.slice(0, maxSourceChars) });
    }
    await sleep(80);
  }

  return out;
}

// ---------- extraction passes ----------
async function extractFromSource({ apiKey, model, songTitle, sourceName, sourceText, looseMode }) {
  const first = await callWithFallback({
    apiKey,
    preferredModel: model,
    body: {
      contents: [{ parts: [{ text: extractionPrompt(songTitle, sourceName, sourceText) }] }],
      generationConfig: { temperature: 0, topP: 0.1, maxOutputTokens: 2048 }
    }
  });
  
  if (!first.ok || !first.text) return { ok: false };
  
  let firstText = first.text.trim();
  if (firstText === "NOT_FOUND" || firstText.includes("NOT_FOUND")) {
    return { ok: false };
  }

  let merged = firstText;
  let currentModel = first.modelUsed || model;

  for (let i = 0; i < 3; i++) {
    const linesArr = merged.split("\n").map(x => x.trim()).filter(Boolean);
    if (linesArr.length === 0) break;
    const lastFewLines = linesArr.slice(-3).join("\n");

    const next = await callWithFallback({
      apiKey,
      preferredModel: currentModel,
      body: {
        contents: [{ parts: [{ text: continuationPrompt(songTitle, sourceName, sourceText, lastFewLines) }] }],
        generationConfig: { temperature: 0, topP: 0.1, maxOutputTokens: 2048 }
      }
    });

    if (!next.ok || !next.text) break;
    
    let nextText = next.text.trim();
    if (nextText === "NOT_FOUND" || nextText.includes("NOT_FOUND")) {
      break; 
    }
    
    merged += `\n${nextText}`;
  }

  merged = uniqueLines(merged).trim();
  const valid = isValidLyricsExtraction(merged, sourceText, looseMode);
  if (!valid.ok) return { ok: false };

  return {
    ok: true,
    lyrics: merged,
    modelUsed: currentModel,
    score: valid.score,
    lines: valid.lines,
    sourceName
  };
}

// ---------- grounded expansion ----------
async function groundedExpand({ apiKey, model, songTitle, existingLyrics }) {
  const body = {
    contents: [{ parts: [{ text: groundedPrompt(songTitle) }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0, topP: 0.1, maxOutputTokens: 2048 }
  };

  const r = await callWithFallback({ apiKey, preferredModel: model, body });
  if (!r.ok || !r.text || r.text.trim() === "NOT_FOUND") return { ok: false };

  // keep only new lines
  const existing = new Set((existingLyrics || "").split("\n").map(x => normalizeForTokens(x)).filter(Boolean));
  const candidateLines = (r.text || "").split("\n").map(x => x.trim()).filter(Boolean);

  const additions = [];
  for (const ln of candidateLines) {
    const k = normalizeForTokens(ln);
    if (!k || existing.has(k)) continue;
    additions.push(ln);
  }

  if (!additions.length) return { ok: false };
  return { ok: true, added: additions.join("\n"), modelUsed: r.modelUsed };
}

// ---------- main ----------
async function handleLyricsRequest({ title, manualQuery = "", looseMode = false }) {
  const songTitle = cleanTitle(manualQuery || title || "");
  if (!songTitle) return { success: false, error: "Missing song title." };

  const settings = await getSettings();
  if (!settings.apiKey) return { success: false, error: "Missing Gemini API key." };

  const cacheKey = `${CACHE_PREFIX}${normalize(songTitle)}:${looseMode ? "loose" : "strict"}`;
  const c = await chrome.storage.local.get(cacheKey);
  if (c[cacheKey]) return { success: true, source: "cache", lyrics: c[cacheKey].lyrics, meta: c[cacheKey].meta };

  const sources = await collectLocalSources({
    title: songTitle,
    manualQuery,
    maxSourceChars: settings.maxSourceChars
  });

  if (!sources.length) {
    return { success: false, error: "No usable local source text found. Try manual title with artist." };
  }

  let best = null;
  for (const src of sources) {
    const r = await extractFromSource({
      apiKey: settings.apiKey,
      model: settings.model,
      songTitle,
      sourceName: src.sourceName,
      sourceText: src.sourceText,
      looseMode
    });
    if (!r.ok) continue;
    if (!best || r.lines > best.lines) best = r;
    if (r.lines >= 45) break; 
  }

  if (!best) return { success: false, error: "Could not verify lyrics from local sources." };

  let finalLyrics = best.lyrics;
  let groundedUsed = false;

  if (best.lines < 45) {
    const gx = await groundedExpand({
      apiKey: settings.apiKey,
      model: settings.model,
      songTitle,
      existingLyrics: finalLyrics
    });

    if (gx.ok) {
      finalLyrics = uniqueLines(`${finalLyrics}\n${gx.added}`);
      groundedUsed = true;
    }
  }

  const payload = {
    lyrics: finalLyrics,
    meta: {
      modelUsed: best.modelUsed,
      sourceName: best.sourceName,
      lines: lineCount(finalLyrics),
      groundedUsed,
      looseMode
    }
  };

  await chrome.storage.local.set({ [cacheKey]: payload });
  return { success: true, source: "verified_extraction", lyrics: payload.lyrics, meta: payload.meta };
}

async function testApi({ apiKey, model }) {
  if (!apiKey) return { success: false, error: "API key missing." };
  const body = {
    contents: [{ parts: [{ text: "Return exactly OK" }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 20 }
  };
  const r = await callWithFallback({ apiKey, preferredModel: model || DEFAULT_SETTINGS.model, body });
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
