function normalize(str) {
  return (str || "").toLowerCase().replace(/[^\w]+/g, "").trim();
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.action === "ping") {
    respond({ pong: true });
    return true;
  }

  if (msg.action === "getLyricsForTitle") {
    handleLyricsRequest(msg.title).then(respond);
    return true;
  }

  if (msg.action === "clearCache") {
    chrome.storage.local.clear(() => respond({ success: true }));
    return true;
  }

  if (msg.action === "setApiKey") {
    chrome.storage.sync.set({ geminiApiKey: msg.apiKey || "" }, () => {
      respond({ success: true });
    });
    return true;
  }

  if (msg.action === "getApiKeyStatus") {
    chrome.storage.sync.get("geminiApiKey").then((res) => {
      respond({ hasKey: !!res.geminiApiKey });
    });
    return true;
  }
});

async function getApiKey() {
  const data = await chrome.storage.sync.get("geminiApiKey");
  return (data.geminiApiKey || "").trim();
}

async function handleLyricsRequest(title) {
  const key = "lyrics_" + normalize(title);
  const cache = await chrome.storage.local.get(key);

  if (cache[key]) return { success: true, lyrics: cache[key], source: "cache" };

  const apiKey = await getApiKey();
  if (!apiKey) {
    return {
      success: false,
      error: "Missing Gemini API key. Open extension popup and save your API key first."
    };
  }

  const result = await fetchLyricsFromGemini(title, apiKey);
  if (!result || result.error) {
    return { success: false, error: result.error || "Unknown error" };
  }

  await chrome.storage.local.set({ [key]: result.text });
  return { success: true, lyrics: result.text, source: "gemini" };
}

async function fetchLyricsFromGemini(title, apiKey) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Return ONLY the exact song lyrics for "${title}" as plain text.
No explanations, no markdown, no notes.`
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) return { error: data?.error?.message || `HTTP ${response.status}` };
    if (data.error) return { error: data.error.message };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "No lyrics found.";
    return { text };
  } catch (e) {
    return { error: e.message };
  }
}
