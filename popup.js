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

  els.model.value = res.settings?.model || "gemini-3.1-flash-lite";
  setStatus(res.settings?.apiKey ? "API key configured." : "Set your Gemini API key.");
}

async function saveSettings() {
  const apiKey = (els.apiKey.value || "").trim();
  const model = (els.model.value || "").trim() || "gemini-3.1-flash-lite";

  const res = await send({ action: "saveSettings", apiKey, model });
  if (res?.success) {
    els.apiKey.value = "";
    setStatus("Settings saved.");
  } else {
    setStatus("Failed to save settings.");
  }
}

async function testApi() {
  setStatus("Testing API...");
  const apiKey = (els.apiKey.value || "").trim();
  const model = (els.model.value || "").trim();

  const res = await send({ action: "testApi", apiKey, model });
  if (res?.success) {
    if (res.modelUsed && res.modelUsed !== model) {
      els.model.value = res.modelUsed;
    }
    setStatus(`API test successful. Model: ${res.modelUsed || model}`);
  } else {
    setStatus(`API test failed: ${res?.error || "Unknown error"}`);
  }
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
  } catch {}
}

async function requestLyrics() {
  const title = (els.title.value || "").trim();
  if (!title) {
    setStatus("Enter a song title.");
    return;
  }

  setStatus("Fetching + verifying...");
  setLyrics("");

  try {
    const res = await send({ action: "getLyricsForTitle", title });

    if (!res) {
      setStatus("No response from extension.");
      return;
    }

    if (res.success) {
      setLyrics(res.lyrics || "");
      const domain = res.meta?.sourceDomain ? ` (${res.meta.sourceDomain})` : "";
      setStatus(`Success: ${res.source}${domain}`);
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
