// CONTENT SCRIPT - Fixed with detailed logging
console.log('🎵 [CS] Nepali Lyrics Helper loaded!');

let lyricsPanel = null;
let currentSongTitle = '';

// Wait for page load
function init() {
  console.log('🎵 [CS] Initializing...');
  
  // Wait for YouTube to stabilize
  setTimeout(() => {
    const title = getSongTitle();
    if (title) {
      console.log('✅ [CS] Got title:', title);
      currentSongTitle = title;
      createPanel();
      checkStorage(title);
    } else {
      console.error('❌ [CS] Could not find title element');
      console.log('🔍 [CS] Trying selectors...');
      document.querySelectorAll('h1').forEach((h1, i) => {
        console.log(`  h1[${i}]:`, h1.textContent.substring(0, 50));
      });
    }
  }, 3000);
}

// Extract song title
function getSongTitle() {
  console.log('🔍 [CS] Looking for song title...');
  
  const selectors = [
    'h1.ytd-watch-metadata yt-formatted-string',
    'h1.ytd-video-primary-info-renderer',
    'h1 yt-formatted-string',
    '#title h1',
    'h1.title'
  ];
  
  for (let selector of selectors) {
    console.log('🔍 [CS] Trying selector:', selector);
    const el = document.querySelector(selector);
    if (el && el.textContent) {
      let title = el.textContent.trim();
      console.log('✅ [CS] Found with selector:', selector);
      console.log('✅ [CS] Raw title:', title);
      
      // Clean title
      title = cleanTitle(title);
      console.log('✅ [CS] Cleaned title:', title);
      return title;
    }
  }
  
  console.error('❌ [CS] No title found with any selector');
  return null;
}

// Clean title
function cleanTitle(title) {
  return title
    .replace(/\(Official\s*(Video|Audio|Music\s*Video)?\)/gi, '')
    .replace(/\[Official\s*(Video|Audio|Music\s*Video)?\]/gi, '')
    .replace(/Official\s*(Video|Audio|Music\s*Video)?/gi, '')
    .replace(/\(Lyrics?\)/gi, '')
    .replace(/\[Lyrics?\]/gi, '')
    .replace(/Lyrics?/gi, '')
    .replace(/\bHD\b/gi, '')
    .replace(/\b4K\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Create panel
function createPanel() {
  console.log('🎨 [CS] Creating panel...');
  
  if (lyricsPanel) {
    console.log('⚠️ [CS] Panel already exists, removing old one');
    lyricsPanel.remove();
  }
  
  lyricsPanel = document.createElement('div');
  lyricsPanel.id = 'nepali-lyrics-panel';
  lyricsPanel.style.cssText = `
    background: white;
    border: 1px solid #ccc;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  `;
  
  lyricsPanel.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; border-bottom: 2px solid #f0f0f0; padding-bottom: 8px;">
      <h3 style="margin: 0; font-size: 16px;">🎵 Lyrics</h3>
      <button id="close-lyrics" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #606060;">×</button>
    </div>
    <div id="lyrics-content">
      <p style="text-align: center; color: #888;">Loading...</p>
    </div>
  `;
  
  const secondary = document.querySelector('#secondary');
  if (secondary) {
    console.log('✅ [CS] Found #secondary, inserting panel');
    secondary.insertBefore(lyricsPanel, secondary.firstChild);
  } else {
    console.warn('⚠️ [CS] No #secondary found, appending to body');
    document.body.appendChild(lyricsPanel);
  }
  
  document.getElementById('close-lyrics').onclick = () => {
    lyricsPanel.style.display = 'none';
  };
  
  console.log('✅ [CS] Panel created');
}

// Check if we have this song saved
function checkStorage(title) {
  const key = 'lyrics_' + title.toLowerCase().replace(/\s+/g, '_');
  console.log('💾 [CS] Checking storage, key:', key);
  
  browser.storage.local.get(key)
    .then(result => {
      if (result[key]) {
        console.log('✅ [CS] Found saved URL:', result[key]);
        fetchAndDisplay(result[key]);
      } else {
        console.log('❌ [CS] No saved URL, searching Genius');
        searchGenius(title);
      }
    })
    .catch(err => {
      console.error('❌ [CS] Storage error:', err);
      searchGenius(title);
    });
}

// Search Genius
function searchGenius(title) {
  console.log('🔍 [CS] Starting Genius search for:', title);
  
  const content = document.getElementById('lyrics-content');
  content.innerHTML = '<p style="text-align: center; color: #888;">🔍 Searching Genius API...</p>';
  
  browser.runtime.sendMessage({
    action: 'searchGenius',
    query: title
  })
  .then(response => {
    console.log('📨 [CS] Got response from background:', response);
    
    if (response.success && response.results && response.results.length > 0) {
      console.log('✅ [CS] Genius found', response.results.length, 'results');
      showResults(title, response.results);
    } else {
      console.log('❌ [CS] No Genius results:', response.message || response.error);
      showManualInput(title, response.error || 'No results found');
    }
  })
  .catch(err => {
    console.error('❌ [CS] Message error:', err);
    showManualInput(title, err.message);
  });
}

// Show Genius results
function showResults(title, results) {
  console.log('🎨 [CS] Showing', results.length, 'results');
  
  const content = document.getElementById('lyrics-content');
  
  let html = '<div style="padding: 10px;">';
  html += '<p style="font-size: 13px; margin: 10px 0; font-weight: 600;">Found on Genius:</p>';
  
  results.forEach((result, i) => {
    console.log(`  Result ${i}:`, result.title, 'by', result.artist);
    html += `
      <div class="genius-result" data-url="${result.url}" style="display: flex; align-items: center; padding: 10px; margin: 8px 0; background: #f9f9f9; border-radius: 6px; cursor: pointer; border: 2px solid transparent;">
        <img src="${result.thumbnail}" style="width: 50px; height: 50px; border-radius: 4px; margin-right: 12px; object-fit: cover;" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2250%22 height=%2250%22%3E%3Crect fill=%22%23ddd%22 width=%2250%22 height=%2250%22/%3E%3C/svg%3E'">
        <div style="flex: 1;">
          <div style="font-size: 13px; font-weight: 600;">${result.title}</div>
          <div style="font-size: 11px; color: #666;">${result.artist}</div>
        </div>
        <button class="select-btn" style="padding: 6px 12px; background: #065fd4; color: white; border: none; border-radius: 12px; font-size: 11px; cursor: pointer;">Select</button>
      </div>
    `;
  });
  
  html += `
    <p style="font-size: 12px; margin: 15px 0 5px 0; color: #666;">Or paste different URL:</p>
    <input type="text" id="manual-url" placeholder="https://..." style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; font-size: 12px; margin-bottom: 8px;">
    <button id="manual-btn" style="width: 100%; padding: 8px; background: #28a745; color: white; border: none; border-radius: 18px; cursor: pointer; font-size: 12px;">Use This URL</button>
  </div>`;
  
  content.innerHTML = html;
  
  // Add handlers
  document.querySelectorAll('.genius-result').forEach(el => {
    const btn = el.querySelector('.select-btn');
    btn.onclick = (e) => {
      e.stopPropagation();
      const url = el.getAttribute('data-url');
      console.log('👆 [CS] User selected:', url);
      saveAndFetch(title, url);
    };
  });
  
  document.getElementById('manual-btn').onclick = () => {
    const url = document.getElementById('manual-url').value.trim();
    if (url && url.startsWith('http')) {
      console.log('👆 [CS] User entered manual URL:', url);
      saveAndFetch(title, url);
    } else {
      alert('Please enter a valid URL starting with http:// or https://');
    }
  };
  
  console.log('✅ [CS] Results displayed');
}

// Show manual input
function showManualInput(title, reason) {
  console.log('🎨 [CS] Showing manual input, reason:', reason);
  
  const content = document.getElementById('lyrics-content');
  content.innerHTML = `
    <div style="padding: 10px;">
      <p style="font-size: 13px; margin: 10px 0;">Not found on Genius</p>
      <p style="font-size: 12px; background: #fff3cd; padding: 8px; border-radius: 4px; color: #856404;">${reason}</p>
      <p style="font-weight: bold; background: #f5f5f5; padding: 8px; border-radius: 4px; font-size: 13px; margin: 10px 0;">${title}</p>
      
      <p style="font-size: 12px; margin: 15px 0 5px 0; color: #666;">Paste lyrics URL:</p>
      <input type="text" id="manual-url" placeholder="https://paleti.com.np/..." style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; font-size: 13px; margin-bottom: 8px;">
      <button id="manual-btn" style="width: 100%; padding: 10px; background: #065fd4; color: white; border: none; border-radius: 18px; cursor: pointer; font-size: 13px;">Save & Fetch</button>
      
      <div style="background: #f9f9f9; padding: 10px; border-radius: 4px; margin-top: 10px;">
        <p style="font-size: 11px; margin: 5px 0; color: #666;">Try:</p>
        <ul style="font-size: 11px; margin: 5px 0; padding-left: 20px; color: #666;">
          <li>paleti.com.np</li>
          <li>genius.com</li>
          <li>smule.com</li>
        </ul>
      </div>
    </div>
  `;
  
  document.getElementById('manual-btn').onclick = () => {
    const url = document.getElementById('manual-url').value.trim();
    if (url && url.startsWith('http')) {
      saveAndFetch(title, url);
    } else {
      alert('Please enter a valid URL');
    }
  };
}

// Save URL and fetch lyrics
function saveAndFetch(title, url) {
  const key = 'lyrics_' + title.toLowerCase().replace(/\s+/g, '_');
  console.log('💾 [CS] Saving:', key, '→', url);
  
  browser.storage.local.set({ [key]: url })
    .then(() => {
      console.log('✅ [CS] Saved successfully');
      fetchAndDisplay(url);
    })
    .catch(err => {
      console.error('❌ [CS] Save failed:', err);
      alert('Failed to save: ' + err.message);
    });
}

// Fetch and display lyrics
function fetchAndDisplay(url) {
  console.log('🌐 [CS] Fetching lyrics from:', url);
  
  const content = document.getElementById('lyrics-content');
  content.innerHTML = '<p style="text-align: center; color: #888;">Fetching lyrics...</p>';
  
  browser.runtime.sendMessage({
    action: 'fetchLyrics',
    url: url
  })
  .then(response => {
    console.log('📨 [CS] Fetch response:', response.success ? 'success' : 'failed');
    
    if (response.success && response.html) {
      displayLyrics(response.html, url);
    } else {
      showError(url, response.error || 'Unknown error');
    }
  })
  .catch(err => {
    console.error('❌ [CS] Fetch error:', err);
    showError(url, err.message);
  });
}

// Display lyrics
function displayLyrics(html, url) {
  console.log('🎨 [CS] Displaying lyrics from:', url);
  
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  let lyrics = extractLyrics(doc, url);
  
  if (lyrics) {
    console.log('✅ [CS] Lyrics extracted, length:', lyrics.length);
    
    const content = document.getElementById('lyrics-content');
    content.innerHTML = `
      <div style="padding: 10px; background: #fafafa; border-radius: 6px; max-height: 400px; overflow-y: auto; line-height: 1.8; font-size: 14px;">
        ${lyrics}
      </div>
      <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #e0e0e0; font-size: 11px; color: #666; display: flex; justify-content: space-between;">
        <span>Source: <a href="${url}" target="_blank" style="color: #065fd4;">${new URL(url).hostname}</a></span>
        <button id="change-btn" style="background: none; border: none; color: #065fd4; cursor: pointer; text-decoration: underline; font-size: 11px;">Change</button>
      </div>
    `;
    
    document.getElementById('change-btn').onclick = () => {
      if (confirm('Pick a different source?')) {
        searchGenius(currentSongTitle);
      }
    };
  } else {
    console.warn('⚠️ [CS] Could not extract lyrics');
    showError(url, 'Lyrics format not recognized');
  }
}

// Extract lyrics
function extractLyrics(doc, url) {
  console.log('🔍 [CS] Extracting lyrics...');
  
  let lyrics = null;
  
  // GENIUS
  if (url.includes('genius.com')) {
    console.log('📍 [CS] Using Genius extractor');
    const containers = doc.querySelectorAll('div[data-lyrics-container="true"]');
    console.log('📍 [CS] Found', containers.length, 'containers');
    if (containers.length > 0) {
      lyrics = Array.from(containers)
        .filter(c => !c.hasAttribute('data-exclude-from-selection'))
        .map(c => c.innerHTML)
        .join('<br><br>');
    }
  }
  
  // PALETI
  else if (url.includes('paleti.com')) {
    console.log('📍 [CS] Using Paleti extractor');
    const div = doc.querySelector('div.lyrics-div');
    if (div) {
      lyrics = div.innerHTML;
    }
  }
  
  // SMULE
  else if (url.includes('smule.com')) {
    console.log('📍 [CS] Using Smule extractor');
    const spans = doc.querySelectorAll('span.sc-gsnTZi');
    console.log('📍 [CS] Found', spans.length, 'spans');
    if (spans.length > 0) {
      lyrics = Array.from(spans).map(s => s.textContent.trim()).filter(t => t).join('<br>');
    }
  }
  
  // GENERIC
  else {
    console.log('📍 [CS] Using generic extractor');
    const selectors = ['.lyrics', '#lyrics', '.song-lyrics'];
    for (let sel of selectors) {
      const el = doc.querySelector(sel);
      if (el && el.textContent.length > 100) {
        lyrics = el.innerHTML;
        break;
      }
    }
  }
  
  if (lyrics) {
    console.log('✅ [CS] Extracted successfully');
  } else {
    console.error('❌ [CS] Extraction failed');
  }
  
  return lyrics;
}

// Show error
function showError(url, message) {
  console.error('❌ [CS] Showing error:', message);
  
  const content = document.getElementById('lyrics-content');
  content.innerHTML = `
    <div style="padding: 15px; background: #ffebee; border: 1px solid #f44336; border-radius: 6px;">
      <p style="margin: 5px 0; font-size: 13px;">❌ Error</p>
      <p style="margin: 5px 0; font-size: 12px; color: #666;">${message}</p>
      <p style="margin: 5px 0; font-size: 11px; word-break: break-all; color: #999;">${url}</p>
      <button id="retry-btn" style="margin-top: 10px; padding: 8px 16px; background: #f44336; color: white; border: none; border-radius: 18px; cursor: pointer; font-size: 12px;">
        Try Different URL
      </button>
    </div>
  `;
  
  document.getElementById('retry-btn').onclick = () => {
    searchGenius(currentSongTitle);
  };
}

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

console.log('✅ [CS] Content script ready');