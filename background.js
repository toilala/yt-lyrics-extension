// BACKGROUND SCRIPT - Handles fetching lyrics URLs
console.log('🎵 Background script loaded');

// Listen for messages from content script
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📨 Background received message:', request.action);
  
  if (request.action === 'fetchLyrics') {
    console.log('🌐 Fetching URL:', request.url);
    
    fetch(request.url)
      .then(response => {
        console.log('📥 Response status:', response.status);
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        return response.text();
      })
      .then(html => {
        console.log('✅ Got HTML, length:', html.length);
        sendResponse({ success: true, html: html });
      })
      .catch(error => {
        console.error('❌ Fetch error:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    // Return true to indicate async response
    return true;
  }
});

console.log('🎵 Background script ready');