'use strict';

/**
 * public/js/assetsVideo.js
 * Frontend logic for the Video Curation Theater/Studio.
 */
(function() {
  const state = {
    videos: [],
    currentIndex: -1,
    ytPlayer: null,
    sessionClips: {}
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
    visuals: () => document.getElementById('videoFeedbackVisuals'),
    clips: () => document.getElementById('videoFeedbackClips'),
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
    setTimeout(async () => {
      try {
        if (App.ui && App.ui.populateTopicsDropdown) {
          await App.ui.populateTopicsDropdown('videoCurationTopic', 'Any', '');
        }
      } catch (err) {
        console.error('Failed to load curation topics:', err);
      }
    }, 150);
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
      lbl.style.alignItems = 'flex-start';
      lbl.style.justifyContent = 'flex-start';
      lbl.style.textAlign = 'left';
      lbl.style.wordBreak = 'break-word';
      
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
        star.classList.add('yt-star-golden');
      } else {
        star.classList.remove('yt-star-golden');
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
        id="videoCurationNativePlayer"
        width="100%"
        height="100%"
        style="width: 100%; height: 100%; border: none;"
        src="https://www.youtube-nocookie.com/embed/${activeVideo.video_id}?enablejsapi=1&origin=${window.location.origin}&rel=0" 
        allow="encrypted-media" 
        allowfullscreen>
      </iframe>`;

      // Mount global player abstraction
      setTimeout(() => {
        if (window.YT && window.YT.Player) {
          state.ytPlayer = new window.YT.Player('videoCurationNativePlayer');
        }
      }, 500);
    } else {
      container.innerHTML = `<div class="viewer-placeholder"><p>Video Cannot be Embedded. Click Title above to view externally.</p></div>`;
    }

    hydrateFeedbackForm(activeVideo);
    fetchActiveVideoStats(activeVideo);
    renderVirtualClipsList(activeVideo);
  }

  function renderVirtualClipsList(video) {
    const list = document.getElementById('videoVirtualClipsList');
    if (!list) return;
    
    if (!video || !video.video_id || !state.sessionClips[video.video_id] || state.sessionClips[video.video_id].length === 0) {
      list.innerHTML = '<li class="muted">No clips created yet</li>';
      return;
    }
    
    list.innerHTML = '';
    state.sessionClips[video.video_id].forEach((c, idx) => {
      const li = document.createElement('li');
      li.style.display = 'flex';
      li.style.justifyContent = 'space-between';
      li.style.padding = '4px 0';
      li.style.borderBottom = '1px solid var(--border)';
      
      const span = document.createElement('span');
      span.textContent = `Clip ${idx + 1}: ${c.start}s - ${c.end}s`;
      
      const testLnk = document.createElement('a');
      testLnk.href = `https://www.youtube.com/watch?v=${video.video_id}&start=${c.start}&end=${c.end}`;
      testLnk.target = '_blank';
      testLnk.textContent = 'Test';
      testLnk.style.color = 'var(--primary-color)';
      
      li.appendChild(span);
      li.appendChild(testLnk);
      list.appendChild(li);
    });
  }

  async function fetchActiveVideoStats(video) {
    document.getElementById('videoMetaTitle').textContent = video.title || '-';
    document.getElementById('videoMetaChannel').textContent = video.channel_name || '-';
    document.getElementById('videoMetaSubs').textContent = '-';
    document.getElementById('videoMetaViews').textContent = '-';
    document.getElementById('videoMetaComments').textContent = '-';
    
    if (!video.video_id) return;
    
    try {
      const q = new URLSearchParams();
      q.set('videoId', video.video_id);
      if (video.channel_id) q.set('channelId', video.channel_id);
      
      const res = await App.api(`/api/assets/video/stats?${q.toString()}`);
      if (res && res.data && res.data.views) {
        document.getElementById('videoMetaSubs').textContent = res.data.subscribers || '-';
        document.getElementById('videoMetaViews').textContent = res.data.views || '-';
        document.getElementById('videoMetaComments').textContent = res.data.comments || '-';
      }
    } catch (err) {
      console.warn('Failed to dynamically map video stats:', err);
    }
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
    if (UI.visuals()) UI.visuals().value = '';
    if (UI.clips()) UI.clips().value = '';
    
    const summary = UI.topicSummary();
    if (summary) {
      summary.textContent = 'No Topics Selected';
      summary.style.color = 'var(--subtext)';
    }
  }

  function hydrateFeedbackForm(activeVideo) {
    if (!activeVideo) {
      resetFeedbackForm();
      return;
    }
    
    const sContainer = UI.scoreContainer();
    const scoreVal = parseInt(activeVideo.score, 10) || 0;
    if (sContainer) {
      sContainer.setAttribute('data-score', scoreVal.toString());
      updateStarsUI(scoreVal);
    }
    
    if (UI.positive()) UI.positive().value = activeVideo.positive_feedback || '';
    if (UI.negative()) UI.negative().value = activeVideo.negative_feedback || '';
    
    const parseNote = (val, key) => {
      try {
        if (!val) return '';
        const arr = typeof val === 'string' ? JSON.parse(val) : val;
        if (Array.isArray(arr) && arr.length > 0) return arr[0][key] || arr[0].note || arr[0].timestamps || '';
        return '';
      } catch (e) {
        return '';
      }
    };
    
    if (UI.visuals()) UI.visuals().value = parseNote(activeVideo.visuals_liked, 'note');
    if (UI.clips()) UI.clips().value = parseNote(activeVideo.specific_clips, 'timestamps');
    
    const summary = UI.topicSummary();
    if (summary) {
      const topicStr = String(activeVideo.topic || '').trim();
      if (topicStr === '') {
        summary.textContent = 'No Topics Selected';
        summary.style.color = 'var(--subtext)';
      } else {
        summary.textContent = topicStr;
        summary.style.color = 'inherit';
      }
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
    const visText = UI.visuals()?.value.trim() || '';
    const clipsText = UI.clips()?.value.trim() || '';
    
    const selectedText = UI.topicSummary()?.textContent || '';
    const assignedTopic = (selectedText === 'No Topics Selected') ? '' : selectedText;
    
    const payload = {
      video_id: activeVideo.video_id,
      video_url: activeVideo.video_url,
      title: activeVideo.title,
      thumbnail_url: activeVideo.thumbnail_url,
      score: scoreVal,
      topic: assignedTopic,
      positive_feedback: posText,
      negative_feedback: negText,
      visuals_liked: JSON.stringify([{ note: visText }]),
      specific_clips: JSON.stringify([{ timestamps: clipsText }])
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

  async function addToAssets() {
    if (state.currentIndex < 0 || state.currentIndex >= state.videos.length) return;
    const activeVideo = state.videos[state.currentIndex];
    
    if (!activeVideo.video_id) {
      App.notify('Cannot add non-video asset here.', true);
      return;
    }
    
    try {
      const payload = {
        assetName: String(activeVideo.title || 'Untitled Youtube Video').trim(),
        assetType: 'Video',
        category: 'URL',
        location: activeVideo.video_url || `https://www.youtube.com/watch?v=${activeVideo.video_id}`,
        tags: [activeVideo.topic || 'Uncategorized']
      };
      
      await App.api('/api/assets', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      
      App.notify('Successfully pushed video to Primary Assets library!', false);
    } catch (err) {
      console.error(err);
      App.notify(err.message, true);
    }
  }

  function markClipStart() {
    if (state.ytPlayer && typeof state.ytPlayer.getCurrentTime === 'function') {
      document.getElementById('vClipStart').value = Math.floor(state.ytPlayer.getCurrentTime());
    } else {
      App.notify('Player API not ready or disconnected.', true);
    }
  }

  function markClipEnd() {
    if (state.ytPlayer && typeof state.ytPlayer.getCurrentTime === 'function') {
      document.getElementById('vClipEnd').value = Math.floor(state.ytPlayer.getCurrentTime());
    } else {
      App.notify('Player API not ready or disconnected.', true);
    }
  }

  async function saveVirtualClip() {
    if (state.currentIndex < 0 || state.currentIndex >= state.videos.length) return;
    const activeVideo = state.videos[state.currentIndex];
    if (!activeVideo.video_id) return App.notify('Cannot export clip from non-video asset.', true);

    const sVal = parseInt(document.getElementById('vClipStart').value, 10);
    const eVal = parseInt(document.getElementById('vClipEnd').value, 10);
    
    if (isNaN(sVal) || isNaN(eVal) || eVal <= sVal) {
      return App.notify('Invalid boundaries tracking. Please ensure Start and End times are correct.', true);
    }

    try {
      const payload = {
        assetName: `${activeVideo.title || 'Untitled'} [Clip: ${sVal}s - ${eVal}s]`,
        assetType: 'Video',
        category: 'URL',
        location: `https://www.youtube.com/watch?v=${activeVideo.video_id}&start=${sVal}&end=${eVal}`,
        tags: [activeVideo.topic || 'Uncategorized', 'Virtual Clip']
      };
      
      await App.api('/api/assets', { method: 'POST', body: JSON.stringify(payload) });
      App.notify(`Virtual Clip saved directly to Assets Framework!`, false);
      
      if (!state.sessionClips[activeVideo.video_id]) state.sessionClips[activeVideo.video_id] = [];
      state.sessionClips[activeVideo.video_id].push({ start: sVal, end: eVal });
      renderVirtualClipsList(activeVideo);
      
      document.getElementById('vClipStart').value = '';
      document.getElementById('vClipEnd').value = '';
    } catch (err) {
      console.error(err);
      App.notify('Failed exporting clip boundaries.', true);
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
    closeTopicModal,
    addToAssets,
    markClipStart,
    markClipEnd,
    saveVirtualClip
  };

  function injectYoutubeScript() {
    if (!document.getElementById('youtubeIframeApiScript')) {
      const tag = document.createElement('script');
      tag.id = 'youtubeIframeApiScript';
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName('script')[0];
      if (firstScriptTag) {
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      } else {
        document.body.appendChild(tag);
      }
    }
  }

  // Run initialization routines globally on script hook rather than sequestering them behind openCreateVideoTool routing
  // This guarantees that Star Rating Event Listeners and Topics Taxonomy properly hydrate regardless of how the User accessed the view.
  document.addEventListener('DOMContentLoaded', () => {
    injectYoutubeScript();
    initStars();
    loadTopicDropdowns();
  });

})();
