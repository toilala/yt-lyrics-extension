// Main content script that runs on YouTube pages

let lyricsContainer = null;
let currentSongTitle = null;

// Initialize the extension when page loads
function init() {
  console.log('Nepali Lyrics Helper: Initializing...');
  
  // Wait for YouTube page to fully load
  setTimeout(() => {
    const songTitle = extractSongTitle();
    if (songTitle) {
      currentSongTitle = songTitle;
      createLyricsPanel();
      checkForApprovedURL(songTitle);
    }
  }, 2000);
  
  // Watch for video changes on YouTube (for playlist/autoplay)
  observeVideoChanges();
}

// Extract song title from YouTube page
function extractSongTitle() {
  // Try multiple selectors as YouTube's DOM can vary
  const titleSelectors = [
    'h1.ytd-watch-metadata yt-formatted-string',
    'h1.title.ytd-video-primary-info-renderer',
    'h1 yt-formatted-string.ytd-watch-metadata'
  ];
  
  for (const selector of titleSelectors) {
    const titleElement = document.querySelector(selector);
    if (titleElement && titleElement.textContent) {
      let title = titleElement.textContent.trim();
      // Clean up common YouTube title additions
      title = title.replace(/\s*\(Official.*?\)/gi, '');
      title = title.replace(/\s*\[Official.*?\]/gi, '');
      title = title.replace(/\s*-\s*Official.*/gi, '');
      console.log('Extracted song title:', title);
      return title;
    }
  }
  
  console.log('Could not extract song title');
  return null;
}

// Create the lyrics display panel
function createLyricsPanel() {
  if (lyricsContainer) return; // Already created
  
  lyricsContainer = document.createElement('div');
  lyricsContainer.id = 'nepali-lyrics-panel';
  lyricsContainer.innerHTML = `
    <div class="lyrics-header">
      <h3>🎵 Lyrics</h3>
      <button id="close-lyrics">×</button>
    </div>
    <div class="lyrics-content">
      <p class="lyrics-loading">Loading lyrics...</p>
    </div>
  `;
  
  // Insert panel next to video
  const secondary = document.querySelector('#secondary');
  if (secondary) {
    secondary.insertBefore(lyricsContainer, secondary.firstChild);
  } else {
    document.body.appendChild(lyricsContainer);
  }
  
  // Add close button handler
  document.getElementById('close-lyrics').addEventListener('click', () => {
    lyricsContainer.style.display = 'none';
  });
}

// Check if we have an approved URL for this song
function checkForApprovedURL(songTitle) {
  const storageKey = `lyrics_${songTitle.toLowerCase().replace(/\s+/g, '_')}`;
  const cacheKey = `cache_${storageKey}`;
  
  chrome.storage.local.get([storageKey, cacheKey], (result) => {
    if (!result[storageKey]) {
      console.log('No approved URL found, showing search option');
      showSearchOption(songTitle);
      return;
    }
    
    const approvedUrl = result[storageKey];
    const cachedData = result[cacheKey];
    
    // Check if we have valid cached lyrics (within 7 days)
    if (cachedData && cachedData.lyrics && cachedData.timestamp) {
      const daysSinceCache = (Date.now() - cachedData.timestamp) / (1000 * 60 * 60 * 24);
      
      if (daysSinceCache < 7) {
        console.log('Using cached lyrics (age: ' + daysSinceCache.toFixed(1) + ' days)');
        displayLyrics(cachedData.lyrics, approvedUrl, true);
        return;
      } else {
        console.log('Cache expired, fetching fresh lyrics');
      }
    }
    
    // No cache or expired - fetch fresh
    console.log('Fetching fresh lyrics from:', approvedUrl);
    fetchAndDisplayLyrics(approvedUrl);
  });
}

// Show option to search for lyrics
function showSearchOption(songTitle) {
  const content = lyricsContainer.querySelector('.lyrics-content');
  content.innerHTML = `
    <div class="lyrics-search">
      <p>No lyrics saved for this song yet.</p>
      <p class="song-title"><strong>${songTitle}</strong></p>
      <button id="search-lyrics" class="btn-primary">Search & Approve Lyrics</button>
      <div id="manual-input" style="margin-top: 15px;">
        <p style="font-size: 12px; color: #666;">Or paste lyrics URL directly:</p>
        <input type="text" id="manual-url" placeholder="https://example.com/lyrics" style="width: 100%; padding: 8px; margin: 5px 0;">
        <button id="approve-manual" class="btn-secondary">Approve This URL</button>
      </div>
    </div>
  `;
  
  // Search button handler
  document.getElementById('search-lyrics').addEventListener('click', () => {
    searchForLyrics(songTitle);
  });
  
  // Manual approval handler
  document.getElementById('approve-manual').addEventListener('click', () => {
    const url = document.getElementById('manual-url').value.trim();
    if (url && url.startsWith('http')) {
      approveURL(songTitle, url);
    } else {
      alert('Please enter a valid URL starting with http:// or https://');
    }
  });
}

// Search for lyrics (this would use Google Custom Search API in production)
function searchForLyrics(songTitle) {
  const content = lyricsContainer.querySelector('.lyrics-content');
  content.innerHTML = `
    <div class="lyrics-search">
      <p>🔍 Searching for: <strong>${songTitle}</strong></p>
      <p style="font-size: 13px; color: #666; margin: 15px 0;">
        For now, please manually search for the lyrics and paste the best URL below:
      </p>
      <div style="background: #f5f5f5; padding: 12px; border-radius: 5px; margin: 10px 0;">
        <p style="font-size: 12px; margin: 5px 0;">Suggested search: <strong>"${songTitle} lyrics"</strong></p>
        <p style="font-size: 11px; color: #888; margin: 8px 0;">✅ Recommended sites (tested):</p>
        <ul style="font-size: 11px; color: #555; margin: 5px 0; padding-left: 20px;">
          <li>paleti.com.np</li>
          <li>genius.com</li>
          <li>smule.com</li>
        </ul>
      </div>
      <input type="text" id="manual-url" placeholder="Paste lyrics URL here" style="width: 100%; padding: 10px; margin: 10px 0; font-size: 14px;">
      <button id="approve-manual" class="btn-primary">✓ Approve & Save This URL</button>
      <button id="cancel-search" class="btn-secondary" style="margin-left: 10px;">Cancel</button>
    </div>
  `;
  
  document.getElementById('approve-manual').addEventListener('click', () => {
    const url = document.getElementById('manual-url').value.trim();
    if (url && url.startsWith('http')) {
      approveURL(songTitle, url);
    } else {
      alert('Please enter a valid URL');
    }
  });
  
  document.getElementById('cancel-search').addEventListener('click', () => {
    showSearchOption(songTitle);
  });
}

// Approve and save a URL for this song
function approveURL(songTitle, url) {
  const storageKey = `lyrics_${songTitle.toLowerCase().replace(/\s+/g, '_')}`;
  
  chrome.storage.local.set({ [storageKey]: url }, () => {
    console.log('Approved URL saved:', url);
    fetchAndDisplayLyrics(url);
  });
}

// Fetch lyrics from the approved URL
function fetchAndDisplayLyrics(url) {
  const content = lyricsContainer.querySelector('.lyrics-content');
  content.innerHTML = '<p class="lyrics-loading">Fetching lyrics...</p>';
  
  // Send message to background script to fetch the URL
  chrome.runtime.sendMessage(
    { action: 'fetchLyrics', url: url },
    (response) => {
      if (response && response.html) {
        displayLyrics(response.html, url, false);
        
        // Cache the lyrics for future use
        cacheLyrics(currentSongTitle, response.html);
      } else {
        content.innerHTML = `
          <div class="lyrics-error">
            <p>❌ Could not fetch lyrics from this URL</p>
            <p style="font-size: 12px;">${url}</p>
            <button id="try-different-url" class="btn-secondary">Try Different URL</button>
          </div>
        `;
        
        document.getElementById('try-different-url').addEventListener('click', () => {
          showSearchOption(currentSongTitle);
        });
      }
    }
  );
}

// Cache lyrics for faster future access
function cacheLyrics(songTitle, lyricsHtml) {
  const storageKey = `lyrics_${songTitle.toLowerCase().replace(/\s+/g, '_')}`;
  const cacheKey = `cache_${storageKey}`;
  
  const cacheData = {
    lyrics: lyricsHtml,
    timestamp: Date.now()
  };
  
  chrome.storage.local.set({ [cacheKey]: cacheData }, () => {
    console.log('Lyrics cached for:', songTitle);
  });
}

// Display the fetched lyrics
function displayLyrics(html, sourceUrl, fromCache = false) {
  const content = lyricsContainer.querySelector('.lyrics-content');
  
  // Parse the HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  // Try to extract lyrics (you'll need to customize these selectors for your specific sites)
  let lyricsText = extractLyricsFromHTML(doc);
  
  if (lyricsText) {
    const cacheIndicator = fromCache 
      ? '<span style="font-size: 10px; color: #888;">⚡ Cached</span>' 
      : '<span style="font-size: 10px; color: #28a745;">🌐 Fresh</span>';
    
    content.innerHTML = `
      <div class="lyrics-display">
        <div class="lyrics-text">${lyricsText}</div>
        <div class="lyrics-footer">
          <small>Source: <a href="${sourceUrl}" target="_blank">${new URL(sourceUrl).hostname}</a> ${cacheIndicator}</small>
          <button id="change-url" class="btn-link">Change URL</button>
        </div>
      </div>
    `;
    
    document.getElementById('change-url').addEventListener('click', () => {
      if (confirm('Do you want to select a different lyrics source for this song?')) {
        showSearchOption(currentSongTitle);
      }
    });
  } else {
    content.innerHTML = `
      <div class="lyrics-error">
        <p>⚠️ Lyrics found but format not recognized</p>
        <p style="font-size: 12px;">The page was fetched but lyrics couldn't be extracted.</p>
        <button id="try-different-url" class="btn-secondary">Try Different URL</button>
        <details style="margin-top: 10px;">
          <summary style="cursor: pointer; font-size: 12px;">Show raw content</summary>
          <div style="max-height: 300px; overflow: auto; font-size: 11px; margin-top: 5px;">
            ${doc.body.textContent.substring(0, 1000)}...
          </div>
        </details>
      </div>
    `;
    
    document.getElementById('try-different-url').addEventListener('click', () => {
      showSearchOption(currentSongTitle);
    });
  }
}

// Extract lyrics from HTML using site-specific selectors
function extractLyricsFromHTML(doc) {
  const url = doc.location?.href || '';
  
  // 1. SMULE - span.sc-gsnTZi.gsCpaT inside div.sc-cUEIKg.fsBOFX
  if (url.includes('smule.com')) {
    const spans = doc.querySelectorAll('span.sc-gsnTZi.gsCpaT');
    if (spans.length > 0) {
      const lines = Array.from(spans).map(span => span.textContent.trim());
      return lines.filter(line => line).join('<br>');
    }
  }
  
  // 2. PALETI - div.lyrics-div with paragraphs
  if (url.includes('paleti.com')) {
    const lyricsDiv = doc.querySelector('div.lyrics-div');
    if (lyricsDiv) {
      // Get all paragraphs, skip transliterated/translated if needed
      const paragraphs = lyricsDiv.querySelectorAll('p');
      if (paragraphs.length > 0) {
        return Array.from(paragraphs).map(p => p.innerHTML).join('<br><br>');
      }
    }
  }
  
  // 3. GENIUS - div[data-lyrics-container="true"]
  if (url.includes('genius.com')) {
    const containers = doc.querySelectorAll('div[data-lyrics-container="true"]');
    if (containers.length > 0) {
      let lyrics = '';
      containers.forEach(container => {
        // Skip excluded sections
        if (!container.hasAttribute('data-exclude-from-selection')) {
          lyrics += container.innerHTML + '<br><br>';
        }
      });
      if (lyrics.length > 100) {
        return lyrics;
      }
    }
  }
  
  // Generic fallback selectors for other Nepali lyrics sites
  const genericSelectors = [
    '.lyrics',
    '#lyrics',
    '.song-lyrics',
    '.lyrics-div',
    '.entry-content',
    '.post-content',
    'article'
  ];
  
  for (const selector of genericSelectors) {
    const element = doc.querySelector(selector);
    if (element) {
      let lyrics = element.innerHTML;
      // Clean up scripts and styles
      lyrics = lyrics.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      lyrics = lyrics.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
      
      if (lyrics.length > 100) {
        return lyrics;
      }
    }
  }
  
  return null;
}

// Observe video changes on YouTube
function observeVideoChanges() {
  let lastUrl = location.href;
  
  new MutationObserver(() => {
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      console.log('Video changed, reloading lyrics...');
      
      // Remove old panel
      if (lyricsContainer) {
        lyricsContainer.remove();
        lyricsContainer = null;
      }
      
      // Reinitialize
      setTimeout(init, 1000);
    }
  }).observe(document.body, { childList: true, subtree: true });
}

// Clean up cache entries older than 7 days (runs once per session)
function cleanupOldCache() {
  chrome.storage.local.get(null, (items) => {
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const keysToRemove = [];
    
    for (const key in items) {
      if (key.startsWith('cache_')) {
        const cacheData = items[key];
        if (cacheData && cacheData.timestamp) {
          if (now - cacheData.timestamp > sevenDays) {
            keysToRemove.push(key);
          }
        }
      }
    }
    
    if (keysToRemove.length > 0) {
      chrome.storage.local.remove(keysToRemove, () => {
        console.log('Cleaned up', keysToRemove.length, 'old cache entries');
      });
    }
  });
}

// Start the extension
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Clean up old cache entries periodically (runs once per session)
cleanupOldCache();