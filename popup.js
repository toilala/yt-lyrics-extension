const els = {
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model"),
  btnSaveSettings: document.getElementById("btnSaveSettings"),
  btnTestApi: document.getElementById("btnTestApi"),
  title: document.getElementById("title"),
  btnGet: document.getElementById("btnGet"),
  btnClear: document.getElementById("btnClear"),
  status: document.getElementById("status"),
  lyrics: document.getElementById("lyrics")
};

function setStatus(text) {
  els.status.textContent = text || "";
}

function setLyrics(text) {
  els.lyrics.textContent = text || "";
}

async function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

async function loadSettings() {
  const res = await send({ action: "getSettings" });
  if (!res?.success) return;

  // apiKey intentionally masked by background
  els.apiKey.value = "";
  els.model.value = res.settings?.model || "gemini-1.5-flash";
  setStatus(res.settings?.apiKey ? "API key configured." : "Set your Gemini API key.");
}

async function saveSettings() {
  const apiKey = (els.apiKey.value || "").trim();
  const model = (els.model.value || "").trim() || "gemini-1.5-flash";

  const res = await send({ action: "saveSettings", apiKey, model });
  if (res?.success) {
    els.apiKey.value = "";
    setStatus("Settings saved.");
  } else {
    setStatus("Failed to save settings.");
  }
}

async function testApi() {
  const apiKey = (els.apiKey.value || "").trim();
  const model = (els.model.value || "").trim();
  setStatus("Testing API...");
  const res = await send({ action: "testApi", apiKey, model });

  if (res?.success) setStatus("API test successful.");
  else setStatus(`API test failed: ${res?.error || "Unknown error"}`);
}

async function prefillFromYouTube() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab?.url?.includes("youtube.com/watch")) return;

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (document.title || "").replace(/\s*-\s*YouTube\s*$/i, "").trim()
    });

    if (result) {
      els.title.value = result;
      setStatus("Detected title from YouTube.");
    }
  } catch {
    // ignore
  }
}

async function requestLyrics() {
  const title = (els.title.value || "").trim();
  if (!title) {
    setStatus("Enter a song title.");
    return;
  }

  setStatus("Fetching + verifying lyrics...");
  setLyrics("");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const pageUrl = tab?.url || "";

    const res = await send({
      action: "getLyricsForTitle",
      title,
      pageUrl
    });

    if (!res) {
      setStatus("No response from background.");
      return;
    }

    if (res.success) {
      setLyrics(res.lyrics || "");
      const source = res.meta?.sourceDomain ? ` (${res.meta.sourceDomain})` : "";
      setStatus(`Success: ${res.source}${source}`);
    } else {
      setStatus(`Error: ${res.error || "Unknown error"}`);
    }
  } catch (e) {
    setStatus(`Error: ${e.message || String(e)}`);
  }
}

async function clearCache() {
  const res = await send({ action: "clearCache" });
  if (res?.success) {
    setStatus("Cache cleared.");
    setLyrics("");
  } else {
    setStatus("Failed to clear cache.");
  }
}

els.btnSaveSettings.addEventListener("click", saveSettings);
els.btnTestApi.addEventListener("click", testApi);
els.btnGet.addEventListener("click", requestLyrics);
els.btnClear.addEventListener("click", clearCache);

loadSettings();
prefillFromYouTube();