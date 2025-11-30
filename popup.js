const els = {
  title: document.getElementById("title"),
  btnGet: document.getElementById("btnGet"),
  btnClear: document.getElementById("btnClear"),
  status: document.getElementById("status"),
  lyrics: document.getElementById("lyrics")
};

function setStatus(t) {
  els.status.textContent = t;
}
function setLyrics(t) {
  els.lyrics.textContent = t || "No lyrics.";
}

// Auto-fill title from YouTube tab
async function prefillFromYouTube() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab || !tab.url.includes("youtube.com/watch")) return;

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.title.replace("- YouTube", "").trim()
    });

    if (result) {
      els.title.value = result;
      setStatus("Title detected from YouTube.");
    }
  } catch (e) {
    setStatus("Couldn't prefill title.");
  }
}

// Request lyrics
async function requestLyrics() {
  const title = els.title.value.trim();
  if (!title) return setStatus("Enter a title.");

  setStatus("Fetching...");
  setLyrics("");

  try {
    const res = await chrome.runtime.sendMessage({
      action: "getLyricsForTitle",
      title
    });

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

// Clear cache
async function clearCache() {
  await chrome.runtime.sendMessage({ action: "clearCache" });
  setStatus("Cache cleared.");
  setLyrics("");
}

// Init
prefillFromYouTube();
els.btnGet.addEventListener("click", requestLyrics);
els.btnClear.addEventListener("click", clearCache);
