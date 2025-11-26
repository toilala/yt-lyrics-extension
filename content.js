// content.js (AI-enabled)
// Full copy/paste - will:
// 1) detect title
// 2) allow approving a source
// 3) fetch approved page HTML via background
// 4) send HTML to background to call Ollama and extract lyrics
// 5) show the lyrics (or fallback extractor)

console.log("YouTube Lyrics Helper (AI) loaded");

function waitForTitle() {
  return new Promise(resolve => {
    const check = setInterval(() => {
      const possible = [
        document.querySelector("h1.title yt-formatted-string"),
        document.querySelector("h1.title"),
        document.querySelector("h1.ytd-video-primary-info-renderer"),
        document.querySelector("h1")
      ];
      const el = possible.find(x => x && x.innerText && x.innerText.trim().length > 0);
      if (el) {
        clearInterval(check);
        resolve(el.innerText.trim());
      }
    }, 400);
  });
}

function normalizeTitle(raw) {
  if (!raw) return "";
  return raw
    .replace(/\[[^\]]*\]|\([^\)]*\]|\{[^\}]*\}/g, "")
    .replace(/official\s*video/ig, "")
    .replace(/lyrics?/ig, "")
    .replace(/\|.*/g, "")
    .replace(/\bft\.?\b/ig, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function createBox() {
  const existing = document.getElementById("yt-lyrics-helper-box");
  if (existing) existing.remove();
  const box = document.createElement("div");
  box.id = "yt-lyrics-helper-box";
  box.className = "yt-lyrics-helper-box";
  const sidebar = document.querySelector("#secondary");
  if (sidebar && sidebar.prepend) sidebar.prepend(box);
  else document.body.prepend(box);
  return box;
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function shortUrl(u) {
  if (!u) return "";
  return u.length > 60 ? u.slice(0, 57) + "..." : u;
}

async function renderMain(rawTitle) {
  const normalized = normalizeTitle(rawTitle);
  const box = createBox();
  box.innerHTML = `<div class="header">YouTube Lyrics Helper (AI)</div>
    <div class="meta"><strong>Detected:</strong> ${escapeHtml(rawTitle)}</div>
    <div class="meta"><strong>Normalized:</strong> ${escapeHtml(normalized || "—")}</div>
    <div id="store-area"></div>
    <div id="lyrics-area" style="margin-top:10px"></div>`;

  if (!normalized) {
    document.getElementById("store-area").innerHTML = "<div class='error'>Could not normalize title.</div>";
    return;
  }

  // Look up approved source for this normalized title
  chrome.storage.local.get([normalized], async res => {
    const approved = res && res[normalized];
    const storeArea = document.getElementById("store-area");

    if (approved) {
      storeArea.innerHTML = `<div class="ok">Approved source: <a href="${approved}" target="_blank">${shortUrl(approved)}</a></div>
        <button id="fetchFromApproved" class="primary">Fetch & Extract Lyrics</button>
        <button id="clearApproved" class="secondary">Clear approved</button>`;

      document.getElementById("clearApproved").onclick = () => {
        chrome.storage.local.remove([normalized], () => { renderMain(rawTitle); });
      };

      document.getElementById("fetchFromApproved").onclick = async () => {
        await fetchAndExtract(approved, normalized);
      };

    } else {
      // no approved source -> show search button and placeholder results
      storeArea.innerHTML = `
        <div class="warn">No approved source for this song yet.</div>
        <button id="searchBtn" class="primary">Search top results</button>
        <div id="searchResults"></div>
      `;
      document.getElementById("searchBtn").onclick = () => {
        showPlaceholderResults(normalized, rawTitle);
      };
    }
  });
}

function showPlaceholderResults(normalizedTitle, rawTitle) {
  const sr = document.getElementById("searchResults");
  sr.innerHTML = `
    <div style="margin-top:8px; background:#111; padding:8px; border-radius:8px;">
      <div><strong>Top results (placeholder)</strong></div>
      <ul>
        <li><button class="approveBtn secondary" data-url="https://example.com/lyrics1">Approve Site 1</button> — example.com</li>
        <li><button class="approveBtn secondary" data-url="https://example.com/lyrics2">Approve Site 2</button> — example.com</li>
        <li><button class="approveBtn secondary" data-url="https://example.com/lyrics3">Approve Site 3</button> — example.com</li>
      </ul>
    </div>
  `;

  sr.querySelectorAll(".approveBtn").forEach(b => {
    b.addEventListener("click", () => {
      const url = b.dataset.url;
      chrome.storage.local.set({ [normalizedTitle]: url }, () => {
        renderMain(rawTitle);
      });
    });
  });
}

async function fetchAndExtract(url, normalizedKey) {
  const lyricsArea = document.getElementById("lyrics-area");
  lyricsArea.innerHTML = `<div class="meta">Fetching ${escapeHtml(shortUrl(url))} ...</div>`;

  // 1) fetch page HTML (background)
  const fetchResp = await new Promise(resolve => {
    chrome.runtime.sendMessage({ action: "fetch", url }, resp => resolve(resp));
  });

  if (!fetchResp || !fetchResp.success) {
    lyricsArea.innerHTML = `<div class="error">Failed to fetch: ${escapeHtml(fetchResp && fetchResp.error)}</div>`;
    return;
  }

  const html = fetchResp.html || "";
  lyricsArea.innerHTML = `<div class="meta">Fetched page. Sending to local AI for extraction (if available)...</div>`;

  // 2) Ask background to call Ollama
  const aiResp = await new Promise(resolve => {
    chrome.runtime.sendMessage({ action: "extract_with_ai", html, model: "gpt-oss:1.0" }, resp => resolve(resp));
  });

  if (aiResp && aiResp.success && aiResp.lyrics) {
    const cleaned = aiResp.lyrics.trim();
    lyricsArea.innerHTML = `<div class="header">Lyrics (AI-extracted)</div><pre id="lyricsText">${escapeHtml(cleaned)}</pre>`;
    return;
  }

  // If AI not available or failed -> show fallback generic extraction
  lyricsArea.innerHTML = `<div class="warn">AI unavailable or failed (${escapeHtml(aiResp && aiResp.error || "unknown")}). Falling back to heuristic extraction.</div>`;
  const fallback = genericExtractFromHtml(html);
  lyricsArea.innerHTML += `<div class="header">Lyrics (fallback extraction)</div><pre id="lyricsText">${escapeHtml(fallback)}</pre>`;
}

function genericExtractFromHtml(html) {
  // quick DOM parse and heuristics: pick the largest text node / container
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const candidates = [
      ...Array.from(doc.querySelectorAll("article, main, section, div")),
      doc.body
    ];

    let best = {node: null, score: 0, text: ""};
    candidates.forEach(c => {
      const txt = (c && c.innerText) ? c.innerText.trim() : "";
      // heuristic: lines containing short lines and many newlines indicate lyrics
      const newlineCount = (txt.match(/\n/g) || []).length;
      const words = txt.split(/\s+/).length;
      const score = newlineCount * 2 + Math.min(words, 200);
      if (score > best.score) {
        best = { node: c, score, text: txt };
      }
    });

    // Trim to a reasonable size
    let out = best.text || "";
    if (out.length > 20000) out = out.slice(0, 20000) + "\n\n...[truncated]";
    return out || "No good extracted text found.";
  } catch (err) {
    console.error("fallback extract error:", err);
    return "Fallback extractor failed: " + (err && err.message);
  }
}

/* Entry point */
(async function() {
  const raw = await waitForTitle();
  renderMain(raw);
})();
