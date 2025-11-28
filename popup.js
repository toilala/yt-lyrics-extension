// Popup script
document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  
  document.getElementById('view-saved').addEventListener('click', viewSavedSongs);
  document.getElementById('clear-data').addEventListener('click', clearAllData);
});

// Load statistics
function loadStats() {
  browser.storage.local.get(null).then(items => {
    const lyricsKeys = Object.keys(items).filter(key => key.startsWith('lyrics_'));
    document.getElementById('song-count').textContent = lyricsKeys.length;
    
    // Calculate storage size
    let totalSize = 0;
    for (const key in items) {
      totalSize += JSON.stringify(items[key]).length;
    }
    const sizeKB = (totalSize / 1024).toFixed(1);
    document.getElementById('storage-size').textContent = sizeKB + ' KB';
  });
}

// View saved songs
function viewSavedSongs() {
  browser.storage.local.get(null).then(items => {
    const lyricsKeys = Object.keys(items).filter(key => key.startsWith('lyrics_'));
    
    if (lyricsKeys.length === 0) {
      alert('No saved songs yet! Visit YouTube and the extension will auto-search Genius.');
      return;
    }
    
    let message = `Saved Songs (${lyricsKeys.length}):\n\n`;
    lyricsKeys.forEach((key, index) => {
      const songName = key.replace('lyrics_', '').replace(/_/g, ' ');
      const url = items[key];
      const domain = new URL(url).hostname;
      message += `${index + 1}. ${songName}\n   (${domain})\n\n`;
    });
    
    alert(message);
  });
}

// Clear all data
function clearAllData() {
  if (confirm('Delete ALL saved lyrics URLs?\n\nThis cannot be undone!')) {
    browser.storage.local.get(null).then(items => {
      const lyricsKeys = Object.keys(items).filter(key => key.startsWith('lyrics_'));
      
      browser.storage.local.remove(lyricsKeys).then(() => {
        alert(`Deleted ${lyricsKeys.length} saved songs.`);
        loadStats();
      });
    });
  }
}