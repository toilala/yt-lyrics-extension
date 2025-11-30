const GEMINI_API_KEY = "AIzaSyByN-JzYipHu_XpNV4jXUeqTgv3CcKMuKE";


// Normalize title for cache keys
function normalize(str) {
  return str.toLowerCase().replace(/[^\w]+/g, "").trim();
}

// ----------------------------
// 🔌 MESSAGE ROUTER
// ----------------------------
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.action === "ping") {
    respond({ pong: true });
    return true;
  }

  if (msg.action === "getLyricsForTitle") {
    handleLyricsRequest(msg.title).then(respond);
    return true; // important for async response
  }

  if (msg.action === "clearCache") {
    chrome.storage.local.clear(() => respond({ success: true }));
    return true;
  }
});

// ----------------------------
// 🎵 MAIN LYRICS LOGIC
// ----------------------------
async function handleLyricsRequest(title) {
  const key = "lyrics_" + normalize(title);

  // 1) Check cache
  const cache = await chrome.storage.local.get(key);
  if (cache[key]) {
    return { success: true, lyrics: cache[key], source: "cache" };
  }

  // 2) Fetch from Gemini
  const result = await fetchLyricsFromGemini(title);

  if (!result || result.error) {
    return { success: false, error: result.error || "Unknown error" };
  }

  // 3) Save to cache
  await chrome.storage.local.set({ [key]: result.text });

  return { success: true, lyrics: result.text, source: "gemini" };
}

// ----------------------------
// 🤖 GEMINI API CALL
// ----------------------------
async function fetchLyricsFromGemini(title) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Return ONLY the lyrics for the song titled "${title}".
Do NOT include explanations, analysis, translation, or any notes.
Return lyrics ONLY as plain text.`
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();

    if (data.error) return { error: data.error.message };

    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "No lyrics found.";

    return { text };
  } catch (e) {
    return { error: e.message };
  }
}
