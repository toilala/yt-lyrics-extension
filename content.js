// content.js
console.log("YouTube Lyrics Helper (content) loaded.");

/* --- Utility: robust selector for YouTube title --- */
function findYouTubeTitleElement() {
  // common selectors that YouTube uses
  const selectors = [
    'h1.title yt-formatted-string',
    'h1.title > yt-formatted-string',
    'h1.ytd-watch-metadata',
    '#container h1 yt-formatted-string',
    'h1.ytd-video-primary-info-renderer'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  // fallback: first h1 on page
  return document.querySelector('h1');
}

function normalizeTitle(raw) {
  if (!raw) return null;
  // crude cleanup: remove things inside parentheses/brackets and common suffixes
  let t = raw.replace(/\[[^\]]*\]|\([^\)]*\)|\{[^\}]*\}/g, "");
  t = t.replace(/official\s*video/ig, "")
       .replace(/lyrics?/ig, "")
       .replace(/\b\d{4}\b/g, "")
       .replace(/\s+/g, " ")
       .trim();
  return t;
}

/* --- UI: create/update lyrics box in sidebar --- */
function createOrUpdateBox(htmlOrText) {
  let box = document.getElementById("yt-lyrics-helper-box");
  if (!box) {
    box = document.createElement("div");
    box.id = "yt-lyrics-helper-box";
    box.className = "yt-lyrics-helper-box";
    const sidebar = document.querySelector("#secondary") || document.body;
    // prepend so it's visible near the top of sidebar
    if (sidebar && sidebar.prepend) sidebar.prepend(box);
    else document.body.insertBefore(box, document.body.firstChild);
  }
  box.innerHTML = htmlOrText;
}

/* --- Build the initial UI for a video --- */
function renderInitialUI(title) {
  const clean = normalizeTitle(title);
  const html = `
    <div class="header">YouTube Lyrics Helper</div>
    <div class="meta"><strong>Detected:</strong> ${escapeHtml(title)}</div>
    <div class="meta"><strong>Normalized:</strong> ${escapeHtml(clean || "—")}</div>
    <div id="store-status"></div>
    <div id="actions"></div>
    <div id="lyrics-content" style="margin-top:10px;white-space:pre-wrap;"></div>
  `;
  createOrUpdateBox(html);

  if (!clean) return;

  // Check storage for an approved URL
  const key = "approved::" + clean.toLowerCase();
  chrome.storage && chrome.storage.local.get([key], (res) => {
    const found = res && res[key];
    const storeStatus = document.getElementById("store-status");
    const actions = document.getElementById("actions");
    if (found) {
      storeStatus.innerHTML = `<div class="ok">Approved source found: <a href="${found}" target="_blank">${shorten(found)}</a></div>`;
      actions.innerHTML = `<button id="fetch-approved">Fetch lyrics from approved source</button>
                           <button id="clear-approved">Clear approved source</button>`;
      document.getElementById("fetch-approved").addEventListener("click", () => fetchRemoteHtml(found));
      document.getElementById("clear-approved").addEventListener("click", () => {
        chrome.storage.local.remove([key], () => {
          renderInitialUI(title); // refresh UI
        });
      });
    } else {
      storeStatus.innerHTML = `<div class="warn">No approved source for this song yet.</div>`;
      actions.innerHTML = `<button id="do-search">Search top results</button>`;
      document.getElementById("do-search").addEventListener("click", () => {
        doSearchAndShow(title, clean, key);
      });
    }
  });
}

/* --- Helper: shorten url display --- */
function shorten(url) {
  return url.length > 40 ? url.slice(0, 37) + "..." : url;
}

/* --- Escape HTML to avoid injection --- */
function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m]));
}

/* --- Perform a search using background (placeholder) --- */
function doSearchAndShow(rawTitle, normalized, storageKey) {
  createOrUpdateBox(`<div class="header">Searching for top results...</div>`);
  chrome.runtime.sendMessage({ action: "search", query: `${normalized} lyrics` }, (resp) => {
    if (!resp || !resp.success) {
      createOrUpdateBox("<div class='error'>Search failed (no background response).</div>");
      return;
    }
    const items = resp.items || [];
    let html = `<div class="header">Choose a source to approve</div>`;
    if (items.length === 0) {
      html += `<div class="meta">No results found (placeholder). Try later when Google CSE is configured.</div>`;
    } else {
      html += `<ul class="results">`;
      items.forEach((it, idx) => {
        html += `<li class="result-item">
                   <div class="r-title">${escapeHtml(it.title)}</div>
                   <div class="r-link"><a href="${it.link}" target="_blank">${shorten(it.link)}</a></div>
                   <button data-link="${it.link}" class="approve-btn">Approve this source</button>
                 </li>`;
      });
      html += `</ul>`;
    }
    createOrUpdateBox(html);

    // attach approve handlers
    document.querySelectorAll(".approve-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const url = e.currentTarget.getAttribute("data-link");
        // save to storage
        const toSave = {};
        toSave[storageKey] = url;
        chrome.storage.local.set(toSave, () => {
          renderInitialUI(rawTitle);
        });
      });
    });
  });
}

/* --- Fetch remote HTML via background then parse --- */
function fetchRemoteHtml(url) {
  createOrUpdateBox(`<div class="header">Fetching ${escapeHtml(url)} ...</div>`);
  chrome.runtime.sendMessage({ action: "fetch", url }, (resp) => {
    const contentDiv = document.getElementById("lyrics-content");
    if (!resp || !resp.success) {
      createOrUpdateBox(`<div class="error">Failed to fetch URL: ${resp && resp.error}</div>`);
      return;
    }
    // parse HTML and attempt to extract text (basic generic approach)
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(resp.html, "text/html");
      // Try some common containers
      const candidates = [
        doc.querySelector('.lyrics'),
        doc.querySelector('.lyrics-content'),
        doc.querySelector('#lyrics'),
        doc.querySelector('.song-lyrics'),
        doc.querySelector('#content'),
        doc.querySelector('article'),
        doc.body
      ];
      let extracted = "";
      for (const c of candidates) {
        if (c && c.innerText && c.innerText.trim().length > 120) { // heuristic length
          extracted = c.innerText.trim();
          break;
        }
      }
      if (!extracted) {
        // fallback to body text (may be noisy)
        extracted = doc.body ? doc.body.innerText.trim().slice(0, 4000) : "No extractable lyrics found.";
      }
      createOrUpdateBox(`<div class="header">Lyrics (extracted)</div><div id="lyrics-content">${escapeHtml(extracted)}</div>`);
    } catch (err) {
      createOrUpdateBox(`<div class="error">Parsing error: ${escapeHtml(err.message)}</div>`);
    }
  });
}

/* --- Main loop: wait for YouTube dynamic content to settle --- */
let tries = 0;
const maxTries = 40;
const poll = setInterval(() => {
  const el = findYouTubeTitleElement();
  if (el && el.innerText && el.innerText.trim().length > 0) {
    const rawTitle = el.innerText.trim();
    renderInitialUI(rawTitle);
    clearInterval(poll);
    return;
  }
  tries++;
  if (tries > maxTries) {
    clearInterval(poll);
    createOrUpdateBox("<div class='error'>Could not find video title — page layout may have changed.</div>");
  }
}, 400);
