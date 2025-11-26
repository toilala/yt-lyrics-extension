# YouTube Lyrics Helper (AI) — Project Report & Setup

## Project summary
YouTube Lyrics Helper is a browser extension (proof-of-concept) that:
- Detects the currently viewed YouTube video title (and normalizes it).
- Lets the user approve a URL as the authoritative lyrics source for that song.
- Fetches the approved URL's HTML via the extension's background script (avoiding CORS).
- Uses a **local LLM (Ollama)** to extract only the song lyrics from the HTML.
- Displays the cleaned lyrics in the YouTube sidebar.
- Falls back to a heuristic extractor if the local AI is unavailable.

This design keeps all user data local (the pages and extraction run on the user's machine). No paid cloud API is required if you run Ollama locally.

## Files in repo
- `manifest.json` - Extension manifest (MV2, Firefox-friendly)
- `content.js` - Content script injected into YouTube pages
- `background.js` - Background script: fetch & call local Ollama
- `styles.css` - Styling for sidebar box
- `README.md` - This file

## How the AI integration works
- The extension sends the full page HTML to the background script.
- Background makes a `POST http://localhost:11434/api/generate` call to your local Ollama server with a concise prompt to "Extract ONLY the song lyrics".
- Ollama returns generated text; the extension displays it.
- If Ollama is not running, the extension falls back to a heuristic HTML-based extractor.

> Ollama exposes a local API at `http://localhost:11434` with endpoints such as `/api/generate`. See Ollama API docs. :contentReference[oaicite:2]{index=2}

## How to install and run (step-by-step)

### 1) Install Ollama (local LLM)
- Follow the official Ollama instructions for your OS and install the tool. (Ollama runs locally and exposes a REST API on port `11434` by default.) :contentReference[oaicite:3]{index=3}
- Pull/install a model that you can run locally (small models are recommended for local machines).
  - Example: `ollama pull llama3.2` or any model you prefer and have the hardware for.
- Start the Ollama server (if required): `ollama serve` (or follow the guide in their docs). Ensure it's running and reachable at `http://localhost:11434`.

### 2) Test Ollama locally (optional quick check)
From a terminal:
```bash
curl http://localhost:11434/api/generate -d '{ "model": "your-model-name", "prompt": "Hello", "stream": false }'
