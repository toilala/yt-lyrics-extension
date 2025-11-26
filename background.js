// background.js
// Handles cross-origin fetches and optional local AI (Ollama) requests.
//
// Behavior:
// - Receives messages from content script:
//    { action: "fetch", url: "..." }  -> fetch HTML and return text
//    { action: "extract_with_ai", html: "..." } -> send HTML to local Ollama and return extracted lyrics
// - If Ollama is unreachable, returns { success: false, error: "ollama_unreachable" } for AI requests.

console.log("Background script (AI-enabled) running.");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background got:", message && message.action);

  if (!message || !message.action) {
    sendResponse({ success: false, error: "no_action" });
    return false;
  }

  if (message.action === "fetch" && message.url) {
    // fetch page HTML (background context bypasses CORS for extensions)
    fetch(message.url, { method: "GET", credentials: "omit" })
      .then(resp => resp.text())
      .then(text => sendResponse({ success: true, html: text }))
      .catch(err => {
        console.error("Fetch error:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // async
  }

  if (message.action === "extract_with_ai" && message.html) {
    // Call local Ollama generate endpoint at http://localhost:11434/api/generate
    // Build a concise prompt instructing the model to extract only the song lyrics
    const prompt = [
      { role: "system", content: "You are a precise extractor. Extract ONLY the song lyrics from the given HTML page. Remove menus, ads, comments, credits, timestamps, links, and other unrelated text. Return plain text only with line breaks where appropriate." },
      { role: "user", content: `HTML_PAGE_START\n${message.html}\nHTML_PAGE_END\n\nNow extract the lyrics.` }
    ];

    // Ollama's /api/generate accepts { model: "modelname", prompt: "..." } style body.
    // We send a compact prompt as a single concatenated string.
    const joinedPrompt = prompt.map(p => p.content).join("\n\n");

    const payload = {
      model: message.model || "gpt-oss:1.0", // default placeholder; user can change to installed model
      prompt: joinedPrompt,
      stream: false,
      // use format to try to get JSON output? We'll parse plain text from response.
      // options can be added if needed
    };

    // Ollama default host: http://localhost:11434
    fetch("http://localhost:11434/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(async resp => {
        if (!resp.ok) {
          const txt = await resp.text().catch(() => "");
          throw new Error(`Ollama returned ${resp.status}: ${txt}`);
        }
        return resp.json();
      })
      .then(json => {
        // Ollama returns objects. We will attempt to extract the generated text.
        // Different versions may present text at different keys; common key: "response" or "result" or "choices"
        let extracted = null;
        if (typeof json.response === "string") extracted = json.response;
        else if (json.result && typeof json.result === "string") extracted = json.result;
        else if (json.choices && Array.isArray(json.choices) && json.choices[0] && json.choices[0].text) {
          extracted = json.choices.map(c => c.text).join("\n");
        } else if (json.output && Array.isArray(json.output)) {
          // some Ollama versions include output array
          extracted = json.output.map(o => (o.content || "")).join("\n");
        } else {
          // Fallback: stringify
          extracted = JSON.stringify(json);
        }

        sendResponse({ success: true, lyrics: extracted });
      })
      .catch(err => {
        console.error("Ollama error:", err);
        sendResponse({ success: false, error: "ollama_error", detail: err.message });
      });

    return true; // async
  }

  sendResponse({ success: false, error: "unknown_action" });
  return false;
});
