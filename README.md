# yt-lyrics-extension

Proof-of-concept browser extension that detects YouTube video titles, stores an approved lyrics source per song in `storage.local`, fetches external pages via background script, and extracts lyrics using DOM parsing.

Currently targeted for Firefox (Manifest V2). Chrome support may require Manifest V3 changes.

## How to load (Firefox)
1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select the `manifest.json` file from this folder
4. Open a YouTube video page and see the "YouTube Lyrics Helper" box in the sidebar.

## Development
- `content.js` runs on YouTube video pages
- `background.js` performs cross-origin fetches and will later handle Google Custom Search calls
- `chrome.storage.local` is used to save approved source URLs per song
