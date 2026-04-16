'use strict';

/**
 * public/js/assetsVideo.js
 * Frontend logic for the Video Curation Theater/Studio.
 */
(function() {
  const state = {
    videos: [],
    currentIndex: -1,
    selectedTags: new Set(),
    tagsPopupOpen: false
  };

  const UI = {
    playerContainer: () => document.getElementById('videoCurationPlayerContainer'),
    title: () => document.getElementById('videoCurationTitle'),
    channel: () => document.getElementById('videoCurationChannel'),
    thumbnails: () => document.getElementById('videoCurationThumbnails'),
    
    // Filters
    search: () => document.getElementById('videoCurationSearch'),
    topic: () => document.getElementById('videoCurationTopic'),
    tagsBtn: () => document.getElementById('videoCurationTagsBtn'),
    tagsPopup: () => document.getElementById('videoCurationTagsPopup'),
    
    // Feedback Form
    score: () => document.getElementById('videoFeedbackScore'),
    visuals: () => document.getElementById('videoFeedbackVisuals'),
    clips: () => document.getElementById('videoFeedbackClips'),
    assignTopic: () => document.getElementById('videoFeedbackTopic')
  };

  function openCreateVideoTool() {
    App.setActivePage('assetsCreateVideoToolPage');
    loadTopicDropdowns();
    loadTagsGrid();
  }

  function closeCreateVideoTool() {
    const container = UI.playerContainer();
    if (container) {
      container.innerHTML = '<div class="viewer-placeholder"><p>Session closed</p></div>';
    }
    state.tagsPopupOpen = false;
    UI.tagsPopup()?.classList.add('hidden');
    App.setActivePage('assetsPage');
  }

  async function loadTopicDropdowns() {
    try {
      const res = await App.core.apiGet('/messaging/topics');
      const topics = Array.isArray(res?.topics) ? res.topics : Array.isArray(res?.data) ? res.data : [];
      const topicSelect = UI.topic();
      const assignSelect = UI.assignTopic();
      
      const optionsHtml = '<option value="">Any</option>' + topics.map(t => {
        const val = t.topic || t.category;
        return `<option value="${val}">${val}</option>`;
      }).join('');

      if (topicSelect) topicSelect.innerHTML = optionsHtml;
      if (assignSelect) assignSelect.innerHTML = '<option value="">None</option>' + topics.map(t => {
        const val = t.topic || t.category;
        return `<option value="${val}">${val}</option>`;
      }).join('');
    } catch (err) {
      console.error('Failed to load topics:', err);
    }
  }

  async function loadTagsGrid() {
    try {
      const res = await App.core.apiGet('/messaging/tags');
      const tags = Array.isArray(res?.tags) ? res.tags : Array.isArray(res?.data) ? res.data : [];
      
      const popup = UI.tagsPopup();
      if (!popup) return;
      
      popup.innerHTML = '';
      tags.forEach(t => {
        const val = typeof t === 'string' ? t : t.tag || t.name;
        if (!val) return;
        
        const label = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = val;
        cb.checked = state.selectedTags.has(val);
        cb.onchange = (e) => {
          if (e.target.checked) state.selectedTags.add(val);
          else state.selectedTags.delete(val);
          
          const btn = UI.tagsBtn();
          if (btn) btn.innerText = `${state.selectedTags.size} Selected`;
        };
        
        label.appendChild(cb);
        label.appendChild(document.createTextNode(val));
        popup.appendChild(label);
      });
    } catch (err) {
      console.error('Failed to load tags:', err);
    }
  }

  function toggleTagsPopup() {
    const popup = UI.tagsPopup();
    if (!popup) return;
    
    state.tagsPopupOpen = !state.tagsPopupOpen;
    popup.classList.toggle('hidden', !state.tagsPopupOpen);
  }

  // Close tags popup if clicking outside
  document.addEventListener('click', (e) => {
    const popup = UI.tagsPopup();
    const btn = UI.tagsBtn();
    if (!popup || !btn) return;
    
    if (state.tagsPopupOpen && !popup.contains(e.target) && !btn.contains(e.target)) {
      state.tagsPopupOpen = false;
      popup.classList.add('hidden');
    }
  });

  async function applyFilters() {
    state.tagsPopupOpen = false;
    UI.tagsPopup()?.classList.add('hidden');

    const query = UI.search()?.value.trim() || '';
    const topic = UI.topic()?.value || '';
    const tags = Array.from(state.selectedTags).join(',');
    
    UI.playerContainer().innerHTML = '<div class="viewer-placeholder"><p>Curating results...</p></div>';
    
    try {
      const qs = new URLSearchParams({
        q: query,
        topic: topic,
        tags: tags
      });
      const res = await App.core.apiGet(`/assets/video/search?${qs.toString()}`);
      
      if (!res.success) {
        throw new Error(res.error || 'Failed to fetch curated videos');
      }
      
      state.videos = res.data || [];
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
      App.core.showError('No active video to review.');
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
      const res = await App.core.apiPost('/assets/video/feedback', payload);
      if (!res.success) throw new Error(res.error || 'Failed to save feedback');
      
      App.core.showSuccess('Feedback saved! Advancing to next video.');
      nextVideo();
    } catch (err) {
      console.error(err);
      App.core.showError(err.message);
    }
  }

  window.App = window.App || {};
  window.App.assetsVideo = {
    openCreateVideoTool,
    closeCreateVideoTool,
    applyFilters,
    prevVideo,
    nextVideo,
    saveFeedback,
    toggleTagsPopup
  };

})();
