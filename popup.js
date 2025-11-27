// Popup script - manages the extension popup interface

document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  
  document.getElementById('view-saved').addEventListener('click', viewSavedSongs);
  document.getElementById('clear-data').addEventListener('click', clearAllData);
  document.getElementById('clear-cache').addEventListener('click', clearCache);
});

// Load and display statistics
function loadStats() {
  chrome.storage.local.get(null, (items) => {
    // Count items that start with 'lyrics_'
    const lyricsKeys = Object.keys(items).filter(key => key.startsWith('lyrics_'));
    const cacheKeys = Object.keys(items).filter(key => key.startsWith('cache_'));
    
    document.getElementById('song-count').textContent = lyricsKeys.length;
    
    // Calculate approximate storage size
    let totalSize = 0;
    for (const key in items) {
      totalSize += JSON.stringify(items[key]).length;
    }
    const sizeKB = (totalSize / 1024).toFixed(1);
    
    // Update display
    const statsDiv = document.querySelector('.stats');
    const existingSizeItem = document.getElementById('size-item');
    if (existingSizeItem) existingSizeItem.remove();
    
    const sizeItem = document.createElement('div');
    sizeItem.id = 'size-item';
    sizeItem.className = 'stat-item';
    sizeItem.innerHTML = `
      <span class="stat-label">Storage Used:</span>
      <span class="stat-value">${sizeKB} KB</span>
    `;
    statsDiv.appendChild(sizeItem);
    
    const cacheItem = document.createElement('div');
    cacheItem.className = 'stat-item';
    cacheItem.innerHTML = `
      <span class="stat-label">Cached Songs:</span>
      <span class="stat-value">${cacheKeys.length}</span>
    `;
    statsDiv.appendChild(cacheItem);
  });
}

// View all saved songs
function viewSavedSongs() {
  chrome.storage.local.get(null, (items) => {
    const lyricsKeys = Object.keys(items).filter(key => key.startsWith('lyrics_'));
    
    if (lyricsKeys.length === 0) {
      alert('No saved songs yet! Visit YouTube and approve some lyrics URLs.');
      return;
    }
    
    let songList = 'Saved Songs:\n\n';
    lyricsKeys.forEach((key, index) => {
      const songName = key.replace('lyrics_', '').replace(/_/g, ' ');
      const url = items[key];
      songList += `${index + 1}. ${songName}\n   ${url}\n\n`;
    });
    
    // Create a modal-like display
    const existingModal = document.getElementById('song-modal');
    if (existingModal) {
      existingModal.remove();
    }
    
    const modal = document.createElement('div');
    modal.id = 'song-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: white;
      z-index: 1000;
      overflow-y: auto;
      padding: 16px;
    `;
    
    modal.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="margin: 0;">Saved Songs (${lyricsKeys.length})</h3>
        <button id="close-modal" style="width: auto; padding: 4px 12px;">Close</button>
      </div>
      <div id="songs-list"></div>
    `;
    
    document.body.appendChild(modal);
    
    const songsList = modal.querySelector('#songs-list');
    lyricsKeys.forEach((key, index) => {
      const songName = key.replace('lyrics_', '').replace(/_/g, ' ');
      const url = items[key];
      
      const songItem = document.createElement('div');
      songItem.style.cssText = `
        padding: 12px;
        margin: 8px 0;
        background: #f9f9f9;
        border-radius: 6px;
        font-size: 12px;
      `;
      
      songItem.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 4px;">${index + 1}. ${songName}</div>
        <div style="color: #606060; word-break: break-all; margin-bottom: 8px;">${url}</div>
        <button class="delete-song" data-key="${key}" style="width: auto; padding: 4px 12px; background: #dc3545; font-size: 11px;">Delete</button>
      `;
      
      songsList.appendChild(songItem);
    });
    
    // Close modal handler
    modal.querySelector('#close-modal').addEventListener('click', () => {
      modal.remove();
    });
    
    // Delete song handlers
    modal.querySelectorAll('.delete-song').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const key = e.target.dataset.key;
        const songName = key.replace('lyrics_', '').replace(/_/g, ' ');
        
        if (confirm(`Delete saved lyrics for "${songName}"?`)) {
          chrome.storage.local.remove(key, () => {
            e.target.closest('div[style*="padding: 12px"]').remove();
            loadStats();
            alert('Deleted successfully!');
          });
        }
      });
    });
  });
}

// Clear all saved data
function clearAllData() {
  if (confirm('Are you sure you want to delete ALL saved lyrics URLs? This cannot be undone.')) {
    chrome.storage.local.get(null, (items) => {
      const lyricsKeys = Object.keys(items).filter(key => key.startsWith('lyrics_'));
      
      chrome.storage.local.remove(lyricsKeys, () => {
        alert(`Deleted ${lyricsKeys.length} saved songs.`);
        loadStats();
      });
    });
  }
}

// Clear only cached lyrics (keep approved URLs)
function clearCache() {
  chrome.storage.local.get(null, (items) => {
    const cacheKeys = Object.keys(items).filter(key => key.startsWith('cache_'));
    
    if (cacheKeys.length === 0) {
      alert('No cached lyrics to clear.');
      return;
    }
    
    if (confirm(`Clear ${cacheKeys.length} cached lyrics? Your approved URLs will be kept.`)) {
      chrome.storage.local.remove(cacheKeys, () => {
        alert('Cache cleared! Lyrics will be fetched fresh next time.');
        loadStats();
      });
    }
  });
}