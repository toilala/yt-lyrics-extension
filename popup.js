const els = {
  apiKey: document.getElementById("apiKey"),
  btnSaveKey: document.getElementById("btnSaveKey"),
  title: document.getElementById("title"),
  btnGet: document.getElementById("btnGet"),
  btnClear: document.getElementById("btnClear"),
  status: document.getElementById("status"),
  lyrics: document.getElementById("lyrics")
};

function setStatus(t) { els.status.textContent = t; }
function setLyrics(t) { els.lyrics.textContent = t || "No lyrics."; }

async function initKeyStatus() {
  const res = await chrome.runtime.sendMessage({ action: "getApiKeyStatus" });
  if (res?.hasKey) setStatus("API key configured.");
}

async function saveApiKey() {
  const apiKey = (els.apiKey.value || "").trim();
  if (!apiKey) return setStatus("Enter API key.");
  await chrome.runtime.sendMessage({ action: "setApiKey", apiKey });
  els.apiKey.value = "";
  setStatus("API key saved.");
}

async function prefillFromYouTube() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url?.includes("youtube.com/watch")) return;
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.title.replace("- YouTube", "").trim()
    });
    if (result) {
      els.title.value = result;
      setStatus("Title detected from YouTube.");
    }
  } catch {
    setStatus("Couldn't prefill title.");
  }
}

async function requestLyrics() {
  const title = els.title.value.trim();
  if (!title) return setStatus("Enter a title.");
  setStatus("Fetching...");
  setLyrics("");

  try {
    const res = await chrome.runtime.sendMessage({ action: "getLyricsForTitle", title });
    if (!res) return setStatus("No response.");
    if (res.success) {
      setStatus(`Loaded from ${res.source}`);
      setLyrics(res.lyrics);
    } else {
      setStatus("Error: " + res.error);
    }
  } catch (e) {
    setStatus("Error: " + e.message);
  }
}

async function clearCache() {
  await chrome.runtime.sendMessage({ action: "clearCache" });
  setStatus("Cache cleared.");
  setLyrics("");
}

initKeyStatus();
prefillFromYouTube();
els.btnSaveKey.addEventListener("click", saveApiKey);
els.btnGet.addEventListener("click", requestLyrics);
els.btnClear.addEventListener("click", clearCache);
