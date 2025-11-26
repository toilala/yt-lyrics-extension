// background.js
console.log("Background script running.");

// Basic message handler for content script requests
// Actions:
//  - {action: "fetch", url: "..."}  -> fetches HTML and returns text
//  - {action: "search", query: "..."} -> placeholder for Google CSE (to implement later)

self.addEventListener && console.log("Service worker event listener check (MV2 background)");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message);

  if (message.action === "fetch" && message.url) {
    fetch(message.url)
      .then(resp => resp.text())
      .then(text => sendResponse({ success: true, html: text }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // indicate async response
  }

  if (message.action === "search" && message.query) {
    // Placeholder: we will add Google Custom Search later.
    // For now return an empty list or sample data.
    const sample = [
      { title: "Sample Lyrics Site 1", link: "https://example.com/lyrics1" },
      { title: "Sample Lyrics Site 2", link: "https://example.com/lyrics2" },
      { title: "Sample Lyrics Site 3", link: "https://example.com/lyrics3" }
    ];
    sendResponse({ success: true, items: sample });
    return false;
  }

  sendResponse({ success: false, error: "Unknown action" });
});
