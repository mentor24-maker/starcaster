'use strict';

/**
 * public/js/assetsVideo.js
 * Frontend logic for the Video Curation Theater/Studio.
 */
(function() {
  const state = {
    videos: [],
    currentIndex: -1
  };

  const UI = {
    playerContainer: () => document.getElementById('videoCurationPlayerContainer'),
    title: () => document.getElementById('videoCurationTitle'),
    channel: () => document.getElementById('videoCurationChannel'),
    thumbnails: () => document.getElementById('videoCurationThumbnails'),
    
    // Filters
    search: () => document.getElementById('videoCurationSearch'),
    topic: () => document.getElementById('videoCurationTopic'),
    
    // Feedback Form
    score: () => document.getElementById('videoFeedbackScore'),
    visuals: () => document.getElementById('videoFeedbackVisuals'),
    clips: () => document.getElementById('videoFeedbackClips'),
    assignTopic: () => document.getElementById('videoFeedbackTopic')
  };

  function openCreateVideoTool() {
    App.setActivePage('assetsCreateVideoToolPage');
    loadTopicDropdowns();
  }

  function closeCreateVideoTool() {
    const container = UI.playerContainer();
    if (container) {
      container.innerHTML = '<div class="viewer-placeholder"><p>Session closed</p></div>';
    }
    App.setActivePage('assetsPage');
  }

  async function loadTopicDropdowns() {
    try {
      console.log('Fetching topics for dropdowns...');
      const res = await App.api('/api/messaging/topics');
      console.log('Topics fetch response:', res);
      
      const topics = Array.isArray(res?.topics) ? res.topics : Array.isArray(res?.data) ? res.data : [];
      console.log('Parsed topics array:', topics);
      
      const topicSelect = UI.topic();
      const assignSelect = UI.assignTopic();
      
      const optionsHtml = '<option value="">Any</option>' + topics.map(t => {
        const val = typeof t === 'string' ? t : (t.topic || t.category || t.name || t.id);
        return `<option value="${val}">${val}</option>`;
      }).join('');

      console.log('Generated options HTML:', optionsHtml);

      if (topicSelect) topicSelect.innerHTML = optionsHtml;
      
      const assignHtml = '<option value="">None</option>' + topics.map(t => {
        const val = typeof t === 'string' ? t : (t.topic || t.category || t.name || t.id);
        return `<option value="${val}">${val}</option>`;
      }).join('');
      if (assignSelect) assignSelect.innerHTML = assignHtml;
    } catch (err) {
      console.error('Failed to load topics:', err);
      App.notify('Error fetching topics for dropdowns', true);
    }
  }

  async function applyFilters() {
    const query = UI.search()?.value.trim() || '';
    const topic = UI.topic()?.value || '';
    
    UI.playerContainer().innerHTML = '<div class="viewer-placeholder"><p>Curating results...</p></div>';
    
    try {
      const qs = new URLSearchParams({
        q: query,
        topic: topic
      });
      // Use the standard App.api handler
      const res = await App.api(`/api/assets/video/search?${qs.toString()}`);
      
      // Handle the payload shape correctly (App.api unwraps JSON automatically, but may not have "success" flag if it just returns the object directly).
      const rows = res.data || res.videos || res || [];
      state.videos = Array.isArray(rows) ? rows : [];
      state.currentIndex = state.videos.length > 0 ? 0 : -1;
      
      renderThumbnails();
      renderVideo();
      
    } catch (err) {
      console.error(err);
      UI.playerContainer().innerHTML = `<div class="viewer-placeholder"><p style="color:var(--danger)">Error: ${err.message}</p></div>`;
    }
  }

  function renderThumbnails() {
    const container = UI.thumbnails();
    if (!container) return;
    
    container.innerHTML = '';
    state.videos.forEach((vid, index) => {
      const el = document.createElement('div');
      el.className = `curation-thumb ${index === state.currentIndex ? 'active' : ''}`;
      el.style.backgroundImage = `url(${vid.thumbnail_url || ''})`;
      el.title = vid.title || 'Unknown Video';
      el.onclick = () => {
        state.currentIndex = index;
        renderVideo();
      };
      container.appendChild(el);
    });
  }

  function renderVideo() {
    updateThumbnailHighlights();
    
    if (state.currentIndex < 0 || state.currentIndex >= state.videos.length) {
      UI.playerContainer().innerHTML = '<div class="viewer-placeholder"><p>No videos found</p></div>';
      UI.title().innerText = 'No Video Selected';
      UI.channel().innerText = '';
      resetFeedbackForm();
      return;
    }
    
    const activeVideo = state.videos[state.currentIndex];
    UI.title().innerText = activeVideo.title || 'Untitled';
    UI.channel().innerText = activeVideo.channel_name || 'Unknown Channel';
    
    const container = UI.playerContainer();
    if (activeVideo.video_id) {
      container.innerHTML = `<iframe 
        src="https://www.youtube.com/embed/${activeVideo.video_id}?autoplay=1&enablejsapi=1" 
        allow="autoplay; encrypted-media" 
        allowfullscreen>
      </iframe>`;
    } else {
      container.innerHTML = `<div class="viewer-placeholder"><p>Missing Video ID</p></div>`;
    }

    resetFeedbackForm();
  }

  function updateThumbnailHighlights() {
    const container = UI.thumbnails();
    if (!container) return;
    const thumbs = container.querySelectorAll('.curation-thumb');
    thumbs.forEach((t, i) => {
      if (i === state.currentIndex) {
        t.classList.add('active');
        t.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      } else {
        t.classList.remove('active');
      }
    });
  }

  function resetFeedbackForm() {
    if (UI.score()) UI.score().value = '0';
    if (UI.visuals()) UI.visuals().value = '';
    if (UI.clips()) UI.clips().value = '';
    if (UI.assignTopic()) UI.assignTopic().value = '';
  }

  function prevVideo() {
    if (state.videos.length === 0) return;
    state.currentIndex = (state.currentIndex - 1 + state.videos.length) % state.videos.length;
    renderVideo();
  }

  function nextVideo() {
    if (state.videos.length === 0) return;
    state.currentIndex = (state.currentIndex + 1) % state.videos.length;
    renderVideo();
  }

  async function saveFeedback() {
    if (state.currentIndex < 0 || !state.videos[state.currentIndex]) {
      App.notify('No active video to review.', true);
      return;
    }

    const activeVideo = state.videos[state.currentIndex];
    
    const payload = {
      video_id: activeVideo.video_id,
      video_url: activeVideo.video_url,
      title: activeVideo.title,
      thumbnail_url: activeVideo.thumbnail_url,
      score: parseInt(UI.score().value, 10) || 0,
      topic: UI.assignTopic().value,
      visuals_liked: JSON.stringify([{ note: UI.visuals().value }]),
      specific_clips: JSON.stringify([{ timestamps: UI.clips().value }])
    };

    try {
      await App.api('/api/assets/video/feedback', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      
      App.notify('Feedback saved! Advancing to next video.');
      nextVideo();
    } catch (err) {
      console.error(err);
      App.notify(err.message, true);
    }
  }

  window.App = window.App || {};
  window.App.assetsVideo = {
    openCreateVideoTool,
    closeCreateVideoTool,
    applyFilters,
    prevVideo,
    nextVideo,
    saveFeedback
  };

})();
