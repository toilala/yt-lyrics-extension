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

function setStatus(t) { el.status.textContent = t || ""; }
function setLyrics(t) { el.lyrics.textContent = t || ""; }
async function send(msg) { return chrome.runtime.sendMessage(msg); }

async function init() {
  const s = await send({ action: "getSettings" });
  if (s?.success) el.backendUrl.value = s.settings.backendUrl || "";

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
  const r = await send({ action: "saveSettings", backendUrl: el.backendUrl.value.trim() });
  setStatus(r?.success ? "Settings saved." : `Save failed: ${r?.error || "Unknown"}`);
});

el.testBackend.addEventListener("click", async () => {
  const r = await send({ action: "testBackend" });
  setStatus(r?.success ? "Backend OK" : `Backend failed: ${r?.error || "Unknown"}`);
});

el.getLyrics.addEventListener("click", async () => {
  setStatus("Fetching lyrics...");
  setLyrics("");
  const r = await send({ action: "getLyricsForTitle", title: el.title.value.trim() });
  if (!r?.success) return setStatus(`Error: ${r?.error || "Unknown"}`);
  setLyrics(r.lyrics || "");
  setStatus(`Done: ${r.status || "ok"} (${r.source || "live"})`);
});

el.clearCache.addEventListener("click", async () => {
  const r = await send({ action: "clearCache" });
  setStatus(r?.success ? "Cache cleared." : "Failed to clear cache.");
  if (r?.success) setLyrics("");
});

init();