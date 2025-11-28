// popup.js (Chrome MV3, using chrome.*)
const els = {
  title: document.getElementById("title"),
  btnGet: document.getElementById("btnGet"),
  btnClear: document.getElementById("btnClear"),
  status: document.getElementById("status"),
  lyrics: document.getElementById("lyrics")
};

function setStatus(s) { els.status.textContent = s; }
function setLyrics(t) { els.lyrics.textContent = t || "No lyrics."; }

// Prefill title from active YouTube tab (best-effort)
async function prefillFromYouTube() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || !tabs[0]) return;
    const tab = tabs[0];
    if (!tab.url || !tab.url.includes("youtube.com/watch")) return;

    // Inject a small function into the page to read the title
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const el = document.querySelector("h1.title yt-formatted-string") ||
                   document.querySelector("h1.title") ||
                   document.querySelector('meta[name="title"]');
        return el ? (el.innerText || el.textContent || document.title) : document.title;
      }
    });

    if (results && results[0] && results[0].result) {
      els.title.value = results[0].result;
      setStatus("Prefilled title from YouTube (editable).");
    }
  } catch (e) {
    console.debug("prefill error:", e);
  }
}

// Request lyrics from background
async function requestLyrics() {
  const title = els.title.value.trim();
  if (!title) { setStatus("Enter a title."); return; }
  setStatus("Fetching lyrics (checking cache)...");
  setLyrics("");
  try {
    const res = await chrome.runtime.sendMessage({ action: "getLyricsForTitle", title });
    if (!res) { setStatus("No response."); return; }
    if (res.success) {
      setStatus(res.source === "cache" ? "Loaded from cache" : "Fetched from Gemini");
      setLyrics(res.lyrics || "No lyrics returned.");
    } else {
      setStatus("Error: " + (res.error || "unknown"));
      setLyrics(res.error || "No lyrics.");
    }
  } catch (err) {
    setStatus("Error sending message: " + err.message);
  }
}

async function clearCache() {
  setStatus("Clearing cache...");
  try {
    await chrome.runtime.sendMessage({ action: "clearCache" });
    setStatus("Cache cleared.");
    setLyrics("");
  } catch (e) {
    setStatus("Error clearing cache: " + e.message);
  }
}

// Init
prefillFromYouTube();
els.btnGet.addEventListener("click", requestLyrics);
els.btnClear.addEventListener("click", clearCache);
