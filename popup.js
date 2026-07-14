const el = {
  backendUrl: document.getElementById("backendUrl"),
  saveSettings: document.getElementById("saveSettings"),
  testBackend: document.getElementById("testBackend"),
  title: document.getElementById("title"),
  getLyrics: document.getElementById("getLyrics"),
  clearCache: document.getElementById("clearCache"),
  status: document.getElementById("status"),
  lyrics: document.getElementById("lyrics")
};

function setStatus(t) {
  el.status.textContent = t || "";
}
function setLyrics(t) {
  el.lyrics.textContent = t || "";
}
async function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

async function init() {
  const s = await send({ action: "getSettings" });
  if (s?.success) el.backendUrl.value = s.settings.backendUrl || "https://yt-lyrics-extension.onrender.com";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && tab?.url?.includes("youtube.com/watch")) {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => (document.title || "").replace(/\s*-\s*YouTube\s*$/i, "").trim()
      });
      if (result) el.title.value = result;
    }
  } catch {}
}

el.saveSettings.addEventListener("click", async () => {
  const url = el.backendUrl.value.trim();
  if (!/^https?:\/\//i.test(url)) return setStatus("Backend URL must start with http:// or https://");

  const r = await send({ action: "saveSettings", backendUrl: url });
  setStatus(r?.success ? "Settings saved." : `Save failed: ${r?.error || "Unknown"}`);
});

el.testBackend.addEventListener("click", async () => {
  setStatus("Testing backend...");
  const r = await send({ action: "testBackend" });
  setStatus(r?.success ? "Backend OK" : `Backend failed: ${r?.error || "Unknown"}`);
});

el.getLyrics.addEventListener("click", async () => {
  setStatus("Fetching lyrics...");
  setLyrics("");

  const title = el.title.value.trim();
  if (!title) return setStatus("Please enter a song title.");

  const r = await send({ action: "getLyricsForTitle", title });
  if (!r?.success) return setStatus(`Error: ${r?.error || "Unknown"}`);

  setLyrics(r.lyrics || "");
  const status = r.status || "ok";
  const src = r.source || "live";
  const lines = r.meta?.lines ? `, ${r.meta.lines} lines` : "";
  setStatus(`Done: ${status} (${src}${lines})`);
});

el.clearCache.addEventListener("click", async () => {
  const r = await send({ action: "clearCache" });
  setStatus(r?.success ? "Cache cleared." : "Failed to clear cache.");
  if (r?.success) setLyrics("");
});

init();
