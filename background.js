const SETTINGS_KEY = "settings_client_v2";
const CACHE_PREFIX = "lyrics_client_cache_v2_";

const DEFAULT_SETTINGS = {
  backendUrl: "https://yt-lyrics-extension.onrender.com"
};

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

function normalize(s) {
  return (s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "").trim();
}

function cleanTitle(raw = "") {
  return raw
    .replace(/\s*-\s*YouTube\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(id);
  }
}

async function callBackendLyrics({ backendUrl, title, artist = "" }) {
  const base = backendUrl.replace(/\/+$/, "");
  const r = await fetchJsonWithTimeout(
    `${base}/lyrics`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, artist })
    },
    30000
  );

  if (!r.ok) throw new Error(r.data?.error || `Backend ${r.status}`);
  return r.data;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.action) {
        case "getSettings": {
          const s = await getSettings();
          sendResponse({ success: true, settings: s });
          return;
        }

        case "saveSettings": {
          const next = await saveSettings({
            backendUrl: (msg.backendUrl || "").trim()
          });
          sendResponse({ success: true, settings: next });
          return;
        }

        case "testBackend": {
          const s = await getSettings();
          if (!s.backendUrl) return sendResponse({ success: false, error: "Missing backend URL" });

          const base = s.backendUrl.replace(/\/+$/, "");
          const h = await fetchJsonWithTimeout(`${base}/health`, {}, 20000);

          if (!h.ok) return sendResponse({ success: false, error: h.data?.error || `Health ${h.status}` });
          return sendResponse({ success: true, data: h.data });
        }

        case "getLyricsForTitle": {
          const s = await getSettings();
          if (!s.backendUrl) {
            sendResponse({ success: false, error: "Set backend URL in settings." });
            return;
          }

          const title = cleanTitle(msg.title || "");
          if (!title) {
            sendResponse({ success: false, error: "Missing title." });
            return;
          }

          const artist = (msg.artist || "").trim();
          const cacheKey = `${CACHE_PREFIX}${normalize(title)}:${normalize(artist)}`;

          const c = await chrome.storage.local.get(cacheKey);
          if (c[cacheKey]) {
            sendResponse({ success: true, source: "cache", ...c[cacheKey] });
            return;
          }

          const data = await callBackendLyrics({
            backendUrl: s.backendUrl,
            title,
            artist
          });

          if (!data?.success) {
            sendResponse(data);
            return;
          }

          const payload = {
            status: data.status,
            lyrics: data.lyrics,
            meta: data.meta
          };

          await chrome.storage.local.set({ [cacheKey]: payload });
          sendResponse({ success: true, source: data.source || "live", ...payload });
          return;
        }

        case "clearCache":
          await chrome.storage.local.clear();
          sendResponse({ success: true });
          return;

        default:
          sendResponse({ success: false, error: "Unknown action" });
      }
    } catch (e) {
      sendResponse({ success: false, error: e.message || String(e) });
    }
  })();

  return true;
});
