// background.js (Manifest V3 service worker)
// >>> REPLACE this with your Gemini API key before loading the extension <<<
const GEMINI_API_KEY = "AIzaSyDNIYQz9vKRU8lOzPZFkD1NT_tLc2EMrEQ";

// background.js — Chrome MV3 service worker
// >>> Replace with your actual Gemini API key <<<


const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ------- Helpers -------
function normalizeKey(title) {
  if (!title) return "";
  let s = title.replace(/\(.*?\)|\[.*?\]/g, "");
  if (s.includes("-")) s = s.split("-").slice(1).join("-");
  s = s.replace(/\b(official|music video|lyrics|lyric video|hd|4k|audio)\b/gi, "");
  s = s.replace(/[^\w\s\u0900-\u097F]/g, " ");
  s = s.replace(/\s{2,}/g, " ").trim().toLowerCase();
  s = s.replace(/\s+/g, "_");
  return `lyrics_${s || "unknown"}`;
}

async function cacheLyrics(key, lyrics) {
  await chrome.storage.local.set({ [key]: { lyrics, ts: Date.now() } });
}

async function loadCachedLyrics(key) {
  const r = await chrome.storage.local.get(key);
  if (!r[key]) return null;
  if (Date.now() - r[key].ts > CACHE_TTL_MS) {
    await chrome.storage.local.remove(key);
    return null;
  }
  return r[key].lyrics;
}

function buildPrompt(title) {
  return `Return only the full lyrics of the Nepali song "${title}". 
NO commentary. NO metadata. ONLY the lyrics with proper line breaks.`;
}

// ------- MAIN GEMINI CALL (MATCHES YOUR CURL) -------
async function fetchFromGemini(title) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents: [
      {
        parts: [{ text: buildPrompt(title) }]
      }
    ]
  };

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await resp.json();

  if (!resp.ok) {
    throw new Error(
      `Gemini API error ${resp.status}: ${JSON.stringify(data)}`
    );
  }

  // -------- response parsing --------
  let text = null;

  // format: data.candidates[0].content.parts[x].text
  try {
    const parts = data.candidates?.[0]?.content?.parts;
    if (parts) text = parts.map(p => p.text).join("\n");
  } catch {}

  // fallback
  if (!text) text = JSON.stringify(data, null, 2);

  return text;
}

// ------- MESSAGE HANDLER -------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.action === "getLyricsForTitle") {
        const title = msg.title || "";
        const key = normalizeKey(title);

        const cached = await loadCachedLyrics(key);
        if (cached) {
          sendResponse({ success: true, source: "cache", lyrics: cached });
          return;
        }

        try {
          const lyrics = await fetchFromGemini(title);
          await cacheLyrics(key, lyrics);
          sendResponse({ success: true, source: "gemini", lyrics });
          return;
        } catch (e) {
          sendResponse({ success: false, error: e.message });
          return;
        }
      }

      if (msg.action === "clearCache") {
        await chrome.storage.local.clear();
        sendResponse({ success: true });
        return;
      }

      sendResponse({ success: false, error: "unknown action" });
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  })();

  return true;
});
