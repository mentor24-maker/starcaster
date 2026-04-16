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
    scoreContainer: () => document.getElementById('videoFeedbackStarsContainer'),
    positive: () => document.getElementById('videoFeedbackPositive'),
    negative: () => document.getElementById('videoFeedbackNegative'),
    topicModal: () => document.getElementById('videoCurationTopicModal'),
    topicCheckboxes: () => document.getElementById('videoCurationTopicCheckboxes'),
    topicSummary: () => document.getElementById('videoFeedbackTopicSummary')
  };

  function openCreateVideoTool() {
    App.setActivePage('assetsCreateVideoToolPage');
    loadTopicDropdowns();
    initStars();
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
      if (!App.ui || !App.ui.populateTopicsDropdown) return;
      await App.ui.populateTopicsDropdown(UI.topic(), 'Any', '');
      if (App.ui.ensureMessagingTopicsLoaded) {
        await App.ui.ensureMessagingTopicsLoaded();
      }
    } catch (err) {
      console.error('Failed to load topics:', err);
    }
  }

  async function openTopicModal() {
    const modal = UI.topicModal();
    const container = UI.topicCheckboxes();
    if (!modal || !container) return;
    
    await loadTopicDropdowns();
    const topics = App.state?.cachedTopics || [];
    
    const selectedText = UI.topicSummary()?.textContent || '';
    const selected = new Set(selectedText === 'No Topics Selected' ? [] : selectedText.split(', '));
    
    container.innerHTML = '';
    topics.forEach(topic => {
      const lbl = document.createElement('label');
      lbl.style.display = 'flex';
      lbl.style.gap = '0.5rem';
      lbl.style.alignItems = 'center';
      
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = topic;
      cb.className = 'video-curation-topic-cb';
      if (selected.has(topic)) cb.checked = true;
      
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(topic));
      container.appendChild(lbl);
    });
    
    modal.classList.remove('hidden');
  }

  function closeTopicModal() {
    const modal = UI.topicModal();
    const container = UI.topicCheckboxes();
    if (!modal || !container) return;
    
    const checkboxes = container.querySelectorAll('.video-curation-topic-cb:checked');
    const selected = Array.from(checkboxes).map(cb => cb.value);
    
    const summary = UI.topicSummary();
    if (summary) {
      if (selected.length === 0) {
        summary.textContent = 'No Topics Selected';
        summary.style.color = 'var(--subtext)';
      } else {
        summary.textContent = selected.join(', ');
        summary.style.color = 'inherit';
      }
    }
    
    modal.classList.add('hidden');
  }

  function initStars() {
    const container = UI.scoreContainer();
    if (!container) return;
    
    const stars = container.querySelectorAll('.star-btn');
    stars.forEach(star => {
      star.onclick = () => {
        const val = parseInt(star.getAttribute('data-val'), 10);
        container.setAttribute('data-score', val);
        updateStarsUI(val);
      };
    });
  }

  function updateStarsUI(val) {
    const container = UI.scoreContainer();
    if (!container) return;
    const stars = container.querySelectorAll('.star-btn');
    stars.forEach(star => {
      if (parseInt(star.getAttribute('data-val'), 10) <= val) {
        star.classList.add('active');
      } else {
        star.classList.remove('active');
      }
    });
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
      const res = await App.api(`/api/assets/video/search?${qs.toString()}`);
      
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
      const thumbUrl = vid.thumbnail_url || (vid.video_id ? `https://img.youtube.com/vi/${vid.video_id}/hqdefault.jpg` : '');
      el.style.backgroundImage = thumbUrl ? `url(${thumbUrl})` : '';
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
    const vidUrl = activeVideo.video_url || `https://www.youtube.com/watch?v=${activeVideo.video_id}`;
    UI.title().innerHTML = `<a href="${vidUrl}" target="_blank" style="color: inherit;">${activeVideo.title || 'Untitled'}</a>`;
    UI.channel().innerText = activeVideo.channel_name || 'Unknown Channel';
    
    const container = UI.playerContainer();
    if (activeVideo.video_id) {
      container.innerHTML = `<iframe 
        src="https://www.youtube.com/embed/${activeVideo.video_id}?autoplay=1&enablejsapi=1" 
        allow="autoplay; encrypted-media" 
        allowfullscreen>
      </iframe>`;
    } else {
      container.innerHTML = `<div class="viewer-placeholder"><p>Video Cannot be Embedded. Click Title above to view externally.</p></div>`;
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
    const sContainer = UI.scoreContainer();
    if (sContainer) {
      sContainer.setAttribute('data-score', '0');
      updateStarsUI(0);
    }
    if (UI.positive()) UI.positive().value = '';
    if (UI.negative()) UI.negative().value = '';
    
    const summary = UI.topicSummary();
    if (summary) {
      summary.textContent = 'No Topics Selected';
      summary.style.color = 'var(--subtext)';
    }
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
    
    const scoreVal = parseInt(UI.scoreContainer()?.getAttribute('data-score') || '0', 10);
    const posText = UI.positive()?.value.trim() || '';
    const negText = UI.negative()?.value.trim() || '';
    
    const selectedText = UI.topicSummary()?.textContent || '';
    const assignedTopic = (selectedText === 'No Topics Selected') ? '' : selectedText;
    
    const payload = {
      video_id: activeVideo.video_id,
      video_url: activeVideo.video_url,
      title: activeVideo.title,
      thumbnail_url: activeVideo.thumbnail_url,
      score: scoreVal,
      topic: assignedTopic, // We map the comma separated string to topic for now as it's a string column.
      visuals_liked: JSON.stringify([{ note: posText }]),
      specific_clips: JSON.stringify([{ timestamps: negText }])
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
    saveFeedback,
    openTopicModal,
    closeTopicModal
  };

})();
