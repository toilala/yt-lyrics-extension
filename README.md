# YouTube Lyrics — Gemini (Browser Extension)

A Manifest V3 browser extension that fetches song lyrics for YouTube videos using the Gemini API.

## Features

- Detects current YouTube video title
- Fetches lyrics via Gemini API
- Caches lyrics in extension storage for faster repeat loads
- Popup UI for:
  - Saving API key
  - Fetching lyrics
  - Clearing cache
- On-page panel support via content script on YouTube pages

## Project structure

- `manifest.json` — MV3 manifest and permissions
- `background.js` — service worker, API calls, cache logic
- `content.js` — YouTube page integration / panel logic
- `popup.html` / `popup.js` / `popup.css` — popup UI
- icons — extension icon assets

## Setup (local)

1. Clone repo
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select this project folder

## Configure Gemini API key

1. Click the extension icon
2. Paste your Gemini API key in the API key field
3. Click **Save API Key**

The key is stored in `chrome.storage.sync` for your browser profile.

## Use

1. Open a YouTube video page
2. Open extension popup
3. Confirm/pre-fill title (or edit title manually)
4. Click **Get Lyrics**

## Permissions used

- `storage` — save API key and cache lyrics
- `activeTab` + `scripting` — detect title from active YouTube tab
- `host_permissions`:
  - `https://www.youtube.com/*`
  - `https://generativelanguage.googleapis.com/*`

## Security notes

- Do **not** hardcode API keys in source code.
- If a key was ever committed, revoke/rotate it immediately.
- Keep permissions minimal and justify them in store listing.

## Known limitations

- Lyrics quality depends on LLM output and song availability.
- Some songs may return incomplete or incorrect text.
- YouTube page structure changes can affect title detection logic.




## Gemini API Key Setup (User Guide)

1. Open Google AI Studio: https://aistudio.google.com/
2. Sign in with your Google account.
3. Create an API key.
4. Open the extension popup.
5. Paste your API key.
6. Choose a model (start with `gemini-1.5-flash`).
7. Click **Save Settings**.
8. Click **Test API**.

### Free-tier notes

- Free model availability can vary by account, region, and current Google policy.
- If one model fails, try another Flash model in the popup model field.
- Errors like 401/403 usually mean invalid key, disabled API, or project/billing restrictions.


