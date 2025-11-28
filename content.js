// content.js - runs on youtube pages
(function () {
  // Utility: find video title reliably
  function getYouTubeTitle() {
    const el = document.querySelector("h1.title yt-formatted-string") ||
               document.querySelector("h1.title") ||
               document.querySelector('meta[name="title"]');
    return el ? (el.innerText || el.textContent || el.content || document.title) : document.title;
  }

  // Create floating panel
  function createPanel() {
    if (document.getElementById("gemini-lyrics-panel")) return document.getElementById("gemini-lyrics-panel");

    const panel = document.createElement("div");
    panel.id = "gemini-lyrics-panel";
    panel.style.position = "fixed";
    panel.style.right = "16px";
    panel.style.top = "80px";
    panel.style.width = "360px";
    panel.style.maxHeight = "60vh";
    panel.style.overflow = "auto";
    panel.style.zIndex = 999999;
    panel.style.background = "rgba(0,0,0,0.92)";
    panel.style.color = "#fff";
    panel.style.borderRadius = "8px";
    panel.style.boxShadow = "0 8px 30px rgba(0,0,0,0.6)";
    panel.style.fontFamily = "sans-serif";
    panel.style.fontSize = "13px";
    panel.style.padding = "10px";
    panel.style.display = "none";
    panel.style.whiteSpace = "pre-wrap";
    panel.style.lineHeight = "1.4";

    // header
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.marginBottom = "8px";

    const title = document.createElement("div");
    title.id = "gemini-lyrics-panel-title";
    title.textContent = "Lyrics";
    title.style.fontWeight = "700";
    title.style.fontSize = "14px";

    const controls = document.createElement("div");

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.title = "Close";
    closeBtn.style.marginLeft = "6px";
    closeBtn.style.cursor = "pointer";
    closeBtn.onclick = () => (panel.style.display = "none");

    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "⟳";
    refreshBtn.title = "Refresh lyrics";
    refreshBtn.style.cursor = "pointer";
    refreshBtn.onclick = () => fetchAndShowLyrics(currentTitle);

    [refreshBtn, closeBtn].forEach(btn => {
      btn.style.background = "transparent";
      btn.style.border = "none";
      btn.style.color = "#fff";
      btn.style.fontSize = "14px";
      btn.style.padding = "4px";
    });

    controls.appendChild(refreshBtn);
    controls.appendChild(closeBtn);

    header.appendChild(title);
    header.appendChild(controls);
    panel.appendChild(header);

    // status and content
    const status = document.createElement("div");
    status.id = "gemini-lyrics-status";
    status.textContent = "Idle";
    status.style.color = "#ddd";
    status.style.fontSize = "12px";
    status.style.marginBottom = "8px";
    panel.appendChild(status);

    const content = document.createElement("pre");
    content.id = "gemini-lyrics-content";
    content.textContent = "";
    content.style.whiteSpace = "pre-wrap";
    content.style.margin = "0";
    panel.appendChild(content);

    // append to body
    document.body.appendChild(panel);
    return panel;
  }

  // Update panel UI
  function showPanel() {
    const panel = createPanel();
    panel.style.display = "block";
  }
  function setStatus(text) {
    const s = document.getElementById("gemini-lyrics-status");
    if (s) s.textContent = text;
  }
  function setContent(text) {
    const c = document.getElementById("gemini-lyrics-content");
    if (c) c.textContent = text;
  }
  function setTitle(text) {
    const t = document.getElementById("gemini-lyrics-panel-title");
    if (t) t.textContent = `Lyrics — ${text}`;
  }

  // messaging to background to fetch lyrics
  async function fetchLyricsFromBackground(title) {
    setStatus("Checking cache / fetching...");
    try {
      const response = await chrome.runtime.sendMessage({ action: "getLyricsForTitle", title });
      return response;
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  }

  // fetch and display
  async function fetchAndShowLyrics(title) {
    if (!title) return;
    currentTitle = title;
    setTitle(title);
    showPanel();
    setStatus("Loading...");
    setContent("");
    const res = await fetchLyricsFromBackground(title);
    if (!res) {
      setStatus("No response from background.");
      return;
    }
    if (res.success) {
      setStatus(res.source === "cache" ? "Loaded from cache" : "Fetched from Gemini");
      setContent(res.lyrics || "No lyrics returned.");
    } else {
      setStatus("Error: " + (res.error || "unknown"));
      setContent(res.error || "No lyrics available.");
    }
  }

  // Observe YouTube SPA navigation for video changes
  let currentVideoId = null;
  let observerTimer = null;
  let currentTitle = "";

  function getVideoIdFromUrl() {
    try {
      const url = new URL(location.href);
      return url.searchParams.get("v");
    } catch {
      return null;
    }
  }

  // On video change, auto-fetch lyrics (you can disable auto if you prefer)
  async function onVideoChanged() {
    const vid = getVideoIdFromUrl();
    if (!vid || vid === currentVideoId) return;
    currentVideoId = vid;
    // small delay to let title update
    setTimeout(async () => {
      const title = getYouTubeTitle();
      currentTitle = title;
      // auto attempt to fetch; if you want manual only, comment this out
      await fetchAndShowLyrics(title);
    }, 900);
  }

  // Start observing
  const bodyObserver = new MutationObserver(() => {
    // debounce checks
    if (observerTimer) clearTimeout(observerTimer);
    observerTimer = setTimeout(onVideoChanged, 400);
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });

  // initial attempt if on a video
  if (location.href.includes("youtube.com/watch")) {
    setTimeout(() => {
      const t = getYouTubeTitle();
      if (t) fetchAndShowLyrics(t);
    }, 1200);
  }

  // expose a small function for popup to request forced fetch if needed
  window.__YT_GEMINI_LYRICS = {
    fetchForCurrentTitle: () => fetchAndShowLyrics(getYouTubeTitle())
  };
})();
