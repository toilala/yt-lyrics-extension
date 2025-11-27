// NEPALI LYRICS HELPER - Simplified Version
console.log('🎵 Nepali Lyrics Helper: Script loaded!');

let lyricsPanel = null;
let currentSongTitle = '';

// Wait for YouTube to load, then initialize
function init() {
  console.log('🎵 Initializing extension...');
  
  // Wait a bit for YouTube's dynamic content
  setTimeout(() => {
    const title = getSongTitle();
    if (title) {
      console.log('✅ Found song title:', title);
      currentSongTitle = title;
      createLyricsPanel();
      checkForLyrics(title);
    } else {
      console.log('❌ Could not find song title');
    }
  }, 3000);
}

// Get song title from YouTube
function getSongTitle() {
  // Try multiple selectors
  const selectors = [
    'h1.ytd-watch-metadata yt-formatted-string',
    'h1 yt-formatted-string',
    'h1.title'
  ];
  
  for (let selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent) {
      let title = el.textContent.trim();
      // Remove common suffixes
      title = title.replace(/\(Official.*?\)/gi, '');
      title = title.replace(/\[Official.*?\]/gi, '');
      title = title.replace(/Official Video/gi, '');
      title = title.replace(/Official Audio/gi, '');
      return title.trim();
    }
  }
  return null;
}

// Create the lyrics panel UI
function createLyricsPanel() {
  console.log('🎵 Creating lyrics panel...');
  
  // Remove old panel if exists
  if (lyricsPanel) {
    lyricsPanel.remove();
  }
  
  // Create panel
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
  
  // Insert into page
  const secondary = document.querySelector('#secondary');
  if (secondary) {
    secondary.insertBefore(lyricsPanel, secondary.firstChild);
    console.log('✅ Panel inserted into page');
  } else {
    console.log('❌ Could not find #secondary element');
    document.body.appendChild(lyricsPanel);
  }
  
  // Close button
  document.getElementById('close-lyrics').onclick = () => {
    lyricsPanel.style.display = 'none';
  };
}

// Check if we have lyrics for this song
function checkForLyrics(title) {
  const key = 'lyrics_' + title.toLowerCase().replace(/\s+/g, '_');
  console.log('🔍 Checking storage for key:', key);
  
  browser.storage.local.get(key).then(result => {
    if (result[key]) {
      console.log('✅ Found saved URL:', result[key]);
      fetchLyrics(result[key]);
    } else {
      console.log('❌ No saved URL, showing input');
      showUrlInput(title);
    }
  }).catch(err => {
    console.error('❌ Storage error:', err);
    showUrlInput(title);
  });
}

// Show input for user to paste lyrics URL
function showUrlInput(title) {
  const content = document.getElementById('lyrics-content');
  content.innerHTML = `
    <div style="padding: 10px;">
      <p style="font-size: 13px; margin: 10px 0;">No lyrics saved for:</p>
      <p style="font-weight: bold; background: #f5f5f5; padding: 8px; border-radius: 4px; font-size: 13px;">${title}</p>
      
      <p style="font-size: 12px; margin: 15px 0 5px 0; color: #666;">Search Google for lyrics, then paste the URL here:</p>
      <input type="text" id="lyrics-url-input" placeholder="https://example.com/lyrics" 
        style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; font-size: 13px;">
      
      <button id="save-url-btn" style="width: 100%; margin-top: 10px; padding: 10px; background: #065fd4; color: white; border: none; border-radius: 18px; cursor: pointer; font-size: 13px; font-weight: 500;">
        Save & Fetch Lyrics
      </button>
      
      <div style="background: #f9f9f9; padding: 10px; border-radius: 4px; margin-top: 10px;">
        <p style="font-size: 11px; margin: 5px 0; color: #666;">✅ Recommended sites:</p>
        <ul style="font-size: 11px; margin: 5px 0; padding-left: 20px; color: #666;">
          <li>paleti.com.np</li>
          <li>genius.com</li>
          <li>smule.com</li>
        </ul>
      </div>
    </div>
  `;
  
  // Save button handler
  document.getElementById('save-url-btn').onclick = () => {
    const url = document.getElementById('lyrics-url-input').value.trim();
    if (url && url.startsWith('http')) {
      saveUrl(title, url);
    } else {
      alert('Please enter a valid URL starting with http:// or https://');
    }
  };
}

// Save URL to storage
function saveUrl(title, url) {
  const key = 'lyrics_' + title.toLowerCase().replace(/\s+/g, '_');
  console.log('💾 Saving URL:', url, 'for key:', key);
  
  browser.storage.local.set({ [key]: url }).then(() => {
    console.log('✅ URL saved!');
    fetchLyrics(url);
  }).catch(err => {
    console.error('❌ Error saving:', err);
    alert('Error saving URL: ' + err.message);
  });
}

// Fetch lyrics from URL
function fetchLyrics(url) {
  console.log('🌐 Fetching lyrics from:', url);
  
  const content = document.getElementById('lyrics-content');
  content.innerHTML = '<p style="text-align: center; color: #888;">Fetching lyrics...</p>';
  
  // Send message to background script
  browser.runtime.sendMessage({
    action: 'fetchLyrics',
    url: url
  }).then(response => {
    console.log('📨 Got response from background');
    if (response && response.success && response.html) {
      console.log('✅ Got HTML, length:', response.html.length);
      displayLyrics(response.html, url);
    } else {
      console.log('❌ Failed to fetch');
      showError(url);
    }
  }).catch(err => {
    console.error('❌ Error:', err);
    showError(url);
  });
}

// Display lyrics
function displayLyrics(html, url) {
  console.log('🎨 Displaying lyrics...');
  
  const content = document.getElementById('lyrics-content');
  
  // Parse HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  // Extract lyrics based on site
  let lyrics = extractLyrics(doc, url);
  
  if (lyrics) {
    content.innerHTML = `
      <div style="padding: 10px; background: #fafafa; border-radius: 6px; max-height: 400px; overflow-y: auto; line-height: 1.6;">
        ${lyrics}
      </div>
      <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #e0e0e0; font-size: 11px; color: #666; display: flex; justify-content: space-between;">
        <span>Source: ${new URL(url).hostname}</span>
        <button id="change-url-btn" style="background: none; border: none; color: #065fd4; cursor: pointer; text-decoration: underline; font-size: 11px;">Change URL</button>
      </div>
    `;
    
    document.getElementById('change-url-btn').onclick = () => {
      if (confirm('Select a different lyrics source?')) {
        showUrlInput(currentSongTitle);
      }
    };
    
    console.log('✅ Lyrics displayed!');
  } else {
    console.log('⚠️ Could not extract lyrics');
    content.innerHTML = `
      <div style="padding: 15px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px;">
        <p style="margin: 5px 0; font-size: 13px;">⚠️ Could not extract lyrics from this page.</p>
        <p style="margin: 5px 0; font-size: 12px; color: #666;">The page loaded but the lyrics format wasn't recognized.</p>
        <button id="try-different-btn" style="margin-top: 10px; padding: 8px 16px; background: white; border: 1px solid #065fd4; color: #065fd4; border-radius: 18px; cursor: pointer; font-size: 12px;">
          Try Different URL
        </button>
      </div>
    `;
    
    document.getElementById('try-different-btn').onclick = () => {
      showUrlInput(currentSongTitle);
    };
  }
}

// Extract lyrics from HTML based on site
function extractLyrics(doc, url) {
  console.log('🔍 Extracting lyrics from:', url);
  
  let lyrics = null;
  
  // SMULE
  if (url.includes('smule.com')) {
    console.log('📍 Detected: Smule');
    const spans = doc.querySelectorAll('span.sc-gsnTZi');
    if (spans.length > 0) {
      lyrics = Array.from(spans).map(s => s.textContent.trim()).filter(t => t).join('<br>');
    }
  }
  
  // PALETI
  else if (url.includes('paleti.com')) {
    console.log('📍 Detected: Paleti');
    const div = doc.querySelector('div.lyrics-div');
    if (div) {
      lyrics = div.innerHTML;
    }
  }
  
  // GENIUS
  else if (url.includes('genius.com')) {
    console.log('📍 Detected: Genius');
    const containers = doc.querySelectorAll('div[data-lyrics-container="true"]');
    if (containers.length > 0) {
      lyrics = Array.from(containers).map(c => c.innerHTML).join('<br><br>');
    }
  }
  
  // GENERIC
  else {
    console.log('📍 Using generic selectors');
    const selectors = ['.lyrics', '#lyrics', '.song-lyrics', '.entry-content', 'article'];
    for (let sel of selectors) {
      const el = doc.querySelector(sel);
      if (el && el.textContent.length > 100) {
        lyrics = el.innerHTML;
        break;
      }
    }
  }
  
  if (lyrics) {
    console.log('✅ Extracted lyrics, length:', lyrics.length);
  } else {
    console.log('❌ No lyrics found');
  }
  
  return lyrics;
}

// Show error message
function showError(url) {
  const content = document.getElementById('lyrics-content');
  content.innerHTML = `
    <div style="padding: 15px; background: #ffebee; border: 1px solid #f44336; border-radius: 6px;">
      <p style="margin: 5px 0; font-size: 13px;">❌ Failed to fetch lyrics</p>
      <p style="margin: 5px 0; font-size: 11px; color: #666; word-break: break-all;">${url}</p>
      <button id="retry-btn" style="margin-top: 10px; padding: 8px 16px; background: #f44336; color: white; border: none; border-radius: 18px; cursor: pointer; font-size: 12px;">
        Try Different URL
      </button>
    </div>
  `;
  
  document.getElementById('retry-btn').onclick = () => {
    showUrlInput(currentSongTitle);
  };
}

// Initialize
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

console.log('🎵 Nepali Lyrics Helper: Script setup complete');