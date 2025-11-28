// BACKGROUND SCRIPT - Handles Genius API and fetching
console.log('🎵 Background script loaded');

const GENIUS_API_KEY = 'Ba4mF1mcqZoVkukyAGaYxNmOGpfp2GZ3gJa4EiFL4oq2iOoh5YOzeRPtyciA3p9_QdJN2EXaXWEKmjm-EWgb2w';

// Listen for messages from content script
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📨 Background received message:', request.action);
  
  if (request.action === 'searchGenius') {
    searchGeniusAPI(request.query)
      .then(result => sendResponse(result))
      .catch(error => {
        console.error('❌ Genius search error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Async response
  }
  
  if (request.action === 'fetchLyrics') {
    fetchLyricsFromURL(request.url)
      .then(html => sendResponse({ success: true, html: html }))
      .catch(error => {
        console.error('❌ Fetch error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Async response
  }
});

// Search Genius API for a song
async function searchGeniusAPI(query) {
  console.log('🔍 Searching Genius for:', query);
  
  const searchUrl = `https://api.genius.com/search?q=${encodeURIComponent(query)}`;
  
  try {
    const response = await fetch(searchUrl, {
      headers: {
        'Authorization': `Bearer ${GENIUS_API_KEY}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Genius API error: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('📥 Genius response:', data);
    
    if (data.response && data.response.hits && data.response.hits.length > 0) {
      const hits = data.response.hits;
      console.log(`✅ Found ${hits.length} results on Genius`);
      
      // Return top results
      const results = hits.slice(0, 5).map(hit => ({
        title: hit.result.title,
        artist: hit.result.primary_artist.name,
        url: hit.result.url,
        thumbnail: hit.result.song_art_image_thumbnail_url
      }));
      
      return { success: true, results: results };
    } else {
      console.log('❌ No results found on Genius');
      return { success: false, message: 'No results found' };
    }
  } catch (error) {
    console.error('❌ Genius API error:', error);
    return { success: false, error: error.message };
  }
}

// Fetch lyrics from a URL
async function fetchLyricsFromURL(url) {
  console.log('🌐 Fetching URL:', url);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  
  const html = await response.text();
  console.log('✅ Fetched HTML, length:', html.length);
  
  return html;
}

console.log('🎵 Background script ready with Genius API');