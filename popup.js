const els = {
  // settings
  btnToggleSettings: document.getElementById("btnToggleSettings"),
  settingsPanel: document.getElementById("settingsPanel"),
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model"),
  btnSaveSettings: document.getElementById("btnSaveSettings"),
  btnTestApi: document.getElementById("btnTestApi"),

  // main
  title: document.getElementById("title"),
  manualQuery: document.getElementById("manualQuery"),
  btnGet: document.getElementById("btnGet"),
  btnClear: document.getElementById("btnClear"),
  btnCopyLyrics: document.getElementById("btnCopyLyrics"),
  btnRetryLoose: document.getElementById("btnRetryLoose"),
  status: document.getElementById("status"),
  lyrics: document.getElementById("lyrics")
};

const UI_KEY = "popup_ui_v1";

function setStatus(text, type = "info") {
  els.status.textContent = text || "";
  els.status.className = `status-${type}`;
}
function setLyrics(text) {
  els.lyrics.textContent = text || "";
}
async function send(msg) {
  return chrome.runtime.sendMessage(msg);
}

function toggleSettings(forceOpen) {
  const isHidden = els.settingsPanel.classList.contains("hidden");
  const nextOpen = typeof forceOpen === "boolean" ? forceOpen : isHidden;
  els.settingsPanel.classList.toggle("hidden", !nextOpen);
  localStorage.setItem(UI_KEY, JSON.stringify({ settingsOpen: nextOpen }));
}
function restoreUiState() {
  try {
    const v = JSON.parse(localStorage.getItem(UI_KEY) || "{}");
    toggleSettings(!!v.settingsOpen);
  } catch {
    toggleSettings(false);
  }
}

async function loadSettings() {
  const res = await send({ action: "getSettings" });
  if (!res?.success) return;
  els.model.value = res.settings?.model || "gemini-3.1-flash-lite";

  if (res.settings?.apiKey) {
    setStatus("API key configured.", "ok");
    // keep settings collapsed by default when key already exists
    if (els.settingsPanel.classList.contains("hidden")) return;
  } else {
    setStatus("Please configure API key in Settings.", "warn");
    toggleSettings(true);
  }
}

async function saveSettings() {
  const apiKey = (els.apiKey.value || "").trim();
  const model = (els.model.value || "").trim() || "gemini-3.1-flash-lite";

  const res = await send({ action: "saveSettings", apiKey, model });
  if (res?.success) {
    els.apiKey.value = "";
    setStatus("Settings saved.", "ok");
    toggleSettings(false);
  } else {
    setStatus("Failed to save settings.", "err");
  }
}

async function testApi() {
  setStatus("Testing API...", "info");

  const apiKey = (els.apiKey.value || "").trim();
  const model = (els.model.value || "").trim();

  const res = await send({ action: "testApi", apiKey, model });
  if (res?.success) {
    if (res.modelUsed && res.modelUsed !== model) {
      els.model.value = res.modelUsed;
    }
    setStatus(`API OK (${res.modelUsed || model})`, "ok");
  } else {
    setStatus(`API test failed: ${res?.error || "Unknown error"}`, "err");
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

    if (result && !els.title.value.trim()) {
      els.title.value = result;
      setStatus("Detected title from YouTube.", "info");
    }
  } catch {}
}

function getEffectiveQuery() {
  const manual = (els.manualQuery.value || "").trim();
  if (manual) return manual;
  return (els.title.value || "").trim();
}

async function requestLyrics(loose = false) {
  const title = (els.title.value || "").trim();
  const manualQuery = (els.manualQuery.value || "").trim();
  const effective = getEffectiveQuery();

  if (!effective) {
    setStatus("Enter title or manual search query.", "warn");
    return;
  }

  setStatus("Fetching + verifying lyrics...", "info");
  setLyrics("");

  try {
    const res = await send({
      action: "getLyricsForTitle",
      title: title || effective,
      manualQuery: manualQuery || undefined,
      looseMode: loose
    });

    if (!res) {
      setStatus("No response from extension.", "err");
      return;
    }

    if (res.success) {
      setLyrics(res.lyrics || "");
      const domain = res.meta?.sourceDomain ? ` • ${res.meta.sourceDomain}` : "";
      const model = res.meta?.modelUsed ? ` • ${res.meta.modelUsed}` : "";
      setStatus(`Verified (${res.source}${domain}${model})`, "ok");
    } else {
      setStatus(`Error: ${res.error || "Unknown error"}`, "err");
    }
  } catch (e) {
    setStatus(`Error: ${e.message || String(e)}`, "err");
  }
}

async function clearCache() {
  const res = await send({ action: "clearCache" });
  if (res?.success) {
    setLyrics("");
    setStatus("Cache cleared.", "ok");
  } else {
    setStatus("Failed to clear cache.", "err");
  }
}

async function copyLyrics() {
  const txt = (els.lyrics.textContent || "").trim();
  if (!txt) return setStatus("No lyrics to copy.", "warn");
  await navigator.clipboard.writeText(txt);
  setStatus("Lyrics copied.", "ok");
}

// events
els.btnToggleSettings.addEventListener("click", () => toggleSettings());
els.btnSaveSettings.addEventListener("click", saveSettings);
els.btnTestApi.addEventListener("click", testApi);
els.btnGet.addEventListener("click", () => requestLyrics(false));
els.btnRetryLoose.addEventListener("click", () => requestLyrics(true));
els.btnClear.addEventListener("click", clearCache);
els.btnCopyLyrics.addEventListener("click", copyLyrics);

// init
restoreUiState();
loadSettings();
prefillFromYouTube();
