chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'fetchLyrics') {
    fetch(msg.url)
      .then(response => response.text())
      .then(htmlText => {
        let parser = new DOMParser();
        let doc = parser.parseFromString(htmlText, 'text/html');
        let lyrics = extractLyrics(doc, msg.url);
        sendResponse(lyrics);
      })
      .catch(err => sendResponse('Failed to fetch lyrics.'));
    return true; // keep the channel open for async
  }
});

// Site-specific scraping rules
function extractLyrics(doc, url) {
  if (url.includes('genius.com')) {
    let lyricsDiv = doc.querySelector('.lyrics, [data-lyrics-container]');
    return lyricsDiv ? lyricsDiv.innerText : 'Lyrics not found.';
  } else if (url.includes('nepalilyrics.com')) {
    let lyricsDiv = doc.querySelector('.lyrics-text');
    return lyricsDiv ? lyricsDiv.innerText : 'Lyrics not found.';
  } else if (url.includes('nepalisongs.com')) {
    let lyricsDiv = doc.querySelector('#song-content');
    return lyricsDiv ? lyricsDiv.innerText : 'Lyrics not found.';
  } else {
    return 'Site not supported yet.';
  }
}
