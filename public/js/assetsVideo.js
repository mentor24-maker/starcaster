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
          await App.ui.populateTopicsDropdown('creationRefAssetTopic', 'All Topics', '');
        }
      } catch (err) {
        console.error('Failed to load curation topics:', err);
      }
    }, 150);
  }

  async function loadCreationAssetCategories() {
    const select = document.getElementById('creationRefAssetCategory');
    const typeSelect = document.getElementById('creationRefAssetType');
    if (!select) return;
    try {
      const res = await App.api('/api/asset-categories');
      const categories = res.categories || [];
      const filterType = typeSelect ? String(typeSelect.value || '').trim() : '';

      const filtered = filterType ? categories.filter(c => String(c.assetType || '') === filterType) : categories;
      const names = Array.from(new Set(filtered.map(c => c.category).filter(Boolean)));
      names.sort();
      
      const currentVal = select.value;
      select.innerHTML = '<option value="">All Categories</option>';
      
      names.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
      });
      select.value = currentVal;
    } catch (err) {
      console.error('Failed to load asset categories:', err);
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

  let creationReferences = [];

  async function searchCreationReferences() {
    const type = String(document.getElementById('creationRefAssetType')?.value || '');
    const category = String(document.getElementById('creationRefAssetCategory')?.value || '');
    const topic = String(document.getElementById('creationRefAssetTopic')?.value || '');
    const query = String(document.getElementById('creationRefSearchInput')?.value || '').toLowerCase();
    const resultsContainer = document.getElementById('creationRefSearchResults');
    if (!resultsContainer) return;

    try {
      const res = await App.api('/api/assets');
      const allAssets = Array.isArray(res.assets) ? res.assets : [];
      const matches = allAssets.filter(a => {
        if (type && String(a.assetType || '') !== type) return false;
        if (category && String(a.category || '') !== category) return false;
        if (topic && String(a.topic || '') !== topic) return false;
        if (query) {
           const matchString = `${a.assetName} ${Array.isArray(a.tags) ? a.tags.join(' ') : ''}`.toLowerCase();
           if (!matchString.includes(query)) return false;
        }
        return true;
      });

      resultsContainer.innerHTML = '';
      if (matches.length === 0) {
        resultsContainer.innerHTML = '<div class="muted">No matching assets found.</div>';
      } else {
        matches.forEach(a => {
          const row = document.createElement('div');
          row.style.display = 'grid';
          row.style.gridTemplateColumns = '50% 50%';
          row.style.alignItems = 'center';
          row.style.padding = '0.5rem';
          row.style.borderBottom = '1px solid var(--border)';
          
          const label = document.createElement('span');
          label.style.whiteSpace = 'nowrap';
          label.style.overflow = 'hidden';
          label.style.textOverflow = 'ellipsis';
          label.style.paddingRight = '1rem';
          label.textContent = `[${a.assetType || 'Asset'}] ${a.assetName || a.id}`;
          
          const btnWrap = document.createElement('div');
          const attachBtn = document.createElement('button');
          attachBtn.type = 'button';
          attachBtn.textContent = 'Attach';
          attachBtn.style.width = '70px';
          attachBtn.style.padding = '4px';
          attachBtn.style.fontSize = '0.75rem';
          attachBtn.onclick = () => App.assetsVideo.attachCreationReference(a);
          
          btnWrap.appendChild(attachBtn);
          row.appendChild(label);
          row.appendChild(btnWrap);
          resultsContainer.appendChild(row);
        });
      }
      resultsContainer.classList.remove('hidden');
    } catch(err) {
      console.error(err);
      App.notify('Failed to search assets.', true);
    }
  }

  function attachCreationReference(asset) {
    if (creationReferences.find(r => r.id === asset.id)) {
      return App.notify('Asset is already attached as a reference.', true);
    }
    creationReferences.push({
      id: asset.id,
      assetName: asset.assetName,
      assetType: asset.assetType,
      instructions: ''
    });
    renderCreationReferences();
    document.getElementById('creationRefSearchResults')?.classList.add('hidden');
  }

  function removeCreationReference(id) {
    creationReferences = creationReferences.filter(r => r.id !== id);
    renderCreationReferences();
  }

  function updateCreationReferenceInstruction(id, value) {
    const ref = creationReferences.find(r => r.id === id);
    if (ref) ref.instructions = value;
  }

  function renderCreationReferences() {
    const container = document.getElementById('videoCreationAttachedAssets');
    if (!container) return;
    container.innerHTML = '';
    
    if (creationReferences.length === 0) {
      container.innerHTML = '<li class="muted" style="padding-left: 0.5rem;">No referential assets explicitly attached.</li>';
      return;
    }

    creationReferences.forEach(ref => {
      const li = document.createElement('li');
      li.style.border = '1px solid var(--border)';
      li.style.padding = '0.75rem';
      li.style.borderRadius = 'var(--radius-md)';
      li.style.background = 'var(--bg-body)';

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.marginBottom = '0.5rem';
      
      const title = document.createElement('strong');
      title.textContent = `Attached ${ref.assetType}: ${ref.assetName}`;

      const remBtn = document.createElement('button');
      remBtn.type = 'button';
      remBtn.textContent = 'Remove';
      remBtn.style.fontSize = '0.8rem';
      remBtn.onclick = () => App.assetsVideo.removeCreationReference(ref.id);
      
      header.appendChild(title);
      header.appendChild(remBtn);

      const ta = document.createElement('textarea');
      ta.rows = 2;
      ta.className = 'full-width';
      ta.placeholder = `Specific instructions for utilizing this reference...`;
      ta.value = ref.instructions || '';
      ta.oninput = (e) => updateCreationReferenceInstruction(ref.id, e.target.value);

      li.appendChild(header);
      li.appendChild(ta);
      container.appendChild(li);
    });
  }

  function toggleStudioPanel(panelId) {
    const wrap = document.getElementById(panelId);
    if (!wrap) return;
    const header = wrap.querySelector('.studio-collapsible-header');
    const body = wrap.querySelector('.studio-collapsible-body');
    if (!header || !body) return;
    
    if (body.classList.contains('hidden')) {
      body.classList.remove('hidden');
      header.classList.remove('collapsed');
    } else {
      body.classList.add('hidden');
      header.classList.add('collapsed');
    }
  }

  async function submitCreationPrompt() {
    const promptInput = document.getElementById('videoCreationPrompt');
    if (!promptInput) return;
    const promptText = String(promptInput.value || '').trim();
    if (!promptText) return App.notify('Please provide a directive prompt before initializing generation.', true);

    try {
      const payload = { prompt: promptText, references: creationReferences };
      const data = await App.api('/api/assets/generate', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      App.notify(data.message || 'Video generation pipeline locked. Rendering asynchronously.', false);
      promptInput.value = '';
      creationReferences = [];
      renderCreationReferences();

      // Force History Tracker open natively on successful job start
      const historyHeader = document.getElementById('generationHistoryHeader');
      if (historyHeader && historyHeader.classList.contains('collapsed')) {
         toggleStudioPanel('generationHistoryWrap');
      }
      renderGenerationHistory();
    } catch (err) {
      console.error(err);
      App.notify(err.message || 'Failed to route context to generation engine.', true);
    }
  }

  window.App = window.App || {};
  const galleryPollers = {};

  async function renderGenerationHistory() {
    const tbody = document.getElementById('generationHistoryTableBody');
    if (!tbody) return;

    try {
      const res = await App.api('/api/assets');
      const allAssets = Array.isArray(res.assets) ? res.assets : [];
      const generated = allAssets.filter(a => a.category === 'Generated');

      if (generated.length === 0) {
         tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 1rem;" class="muted">No generation history tracked natively.</td></tr>';
         return;
      }
      
      tbody.innerHTML = '';
      generated.reverse().forEach(asset => {
         const row = document.createElement('tr');
         row.id = `gen-row-${asset.id}`;
         
         const statusColor = asset.generationStatus === 'completed' ? 'limegreen' : (asset.generationStatus === 'processing' ? 'var(--primary-color)' : 'tomato');
         
         let actionHTML = '';
         if (asset.generationStatus === 'completed' && asset.location) {
             actionHTML = `<button type="button" class="white-btn tiny-btn" onclick="window.open('${asset.location}', '_blank')" style="margin-right: 8px;">View Resource</button>`;
             actionHTML += `<button type="button" class="tiny-btn icon-btn icon-btn-danger" title="Delete" onclick="App.assetsVideo.cancelGeneration('${asset.id}')"><span class="icon-btn-glyph"><svg viewBox="0 0 24 24" aria-hidden="true">${App.ACTION_ICONS.trash}</svg></span></button>`;
         } else if (asset.generationStatus === 'processing') {
             actionHTML = `
               <span class="muted" style="font-size:0.8rem; display:inline-flex; align-items:center; gap:0.5rem; vertical-align:middle; margin-right: 8px;">
                 <span class="loader-spinner" style="border: 2px solid var(--border); border-top: 2px solid var(--primary-color); border-radius: 50%; width: 12px; height: 12px; animation: spin 1s linear infinite;"></span>
                 <span>Rendering...</span>
               </span>
               <button type="button" class="tiny-btn icon-btn icon-btn-danger" title="Cancel/Delete" onclick="App.assetsVideo.cancelGeneration('${asset.id}')"><span class="icon-btn-glyph"><svg viewBox="0 0 24 24" aria-hidden="true">${App.ACTION_ICONS.trash}</svg></span></button>
             `;
             
             // CRITICAL: Restart tracker organically out of schema caching loop!
             if (!galleryPollers[asset.id]) {
                const startTime = new Date(asset.createdAt || asset.created_at || Date.now()).getTime();
                
                galleryPollers[asset.id] = setInterval(async () => {
                   const elapsedTd = document.getElementById(`elapsed-time-${asset.id}`);
                   if (elapsedTd) {
                      const now = Date.now();
                      const seconds = Math.floor((now - startTime) / 1000);
                      elapsedTd.textContent = `${seconds}s`;
                   }
                   
                   if (Math.floor(Date.now() / 1000) % 8 === 0) {
                       try {
                          const statusRes = await App.api(`/api/assets/generate/status?id=${asset.id}`);
                          if (statusRes.asset && statusRes.asset.generationStatus !== 'processing') {
                             clearInterval(galleryPollers[asset.id]);
                             delete galleryPollers[asset.id];
                             renderGenerationHistory(); 
                          }
                       } catch (e) {}
                   }
                }, 1000);
             }
         } else {
             actionHTML = `<span class="muted" style="color:tomato; margin-right: 8px;">Failed Link</span>`;
             actionHTML += `<button type="button" class="tiny-btn icon-btn icon-btn-danger" title="Delete" onclick="App.assetsVideo.cancelGeneration('${asset.id}')"><span class="icon-btn-glyph"><svg viewBox="0 0 24 24" aria-hidden="true">${App.ACTION_ICONS.trash}</svg></span></button>`;
         }
         
         actionHTML += ` <button type="button" class="tiny-btn icon-btn" title="Clone" onclick="App.assetsVideo.cloneGeneration('${asset.id}')" style="margin-left:4px;"><span class="icon-btn-glyph"><svg viewBox="0 0 24 24" aria-hidden="true">${App.ACTION_ICONS.clone}</svg></span></button>`;

         window.__genCache = window.__genCache || {};
         window.__genCache[asset.id] = asset;
         
         const rawDate = asset.createdAt || asset.created_at || (new Date()).toISOString();
         const dateString = new Date(rawDate).toLocaleTimeString(); // Only showing Time natively usually cleaner
         
         let initialElapsed = '-';
         if (asset.generationStatus === 'processing') {
             const startTime = new Date(rawDate).getTime();
             const seconds = Math.floor((Date.now() - startTime) / 1000);
             initialElapsed = `<span id="elapsed-time-${asset.id}">${seconds}s</span>`;
         } else if (asset.generationStatus === 'completed') {
             initialElapsed = 'Done';
         }

         row.innerHTML = `
           <td style="text-align: center;"><input type="checkbox" name="genItem" value="${asset.id}" onchange="App.assetsVideo.updateBulkActionsGenerations()" /></td>
           <td><strong>${asset.assetName || 'Untitled LRO'}</strong></td>
           <td><strong style="color:${statusColor}; text-transform:uppercase; font-size:0.85rem;">${asset.generationStatus || 'unknown'}</strong></td>
           <td style="font-size:0.85rem;">${dateString}</td>
           <td style="font-size:0.85rem;" class="muted">${initialElapsed}</td>
           <td>${actionHTML}</td>
         `;
         tbody.appendChild(row);
      });
      
      // Inject spinner keyframes if missing
      if (!document.getElementById('galleryPollStyles')) {
         const style = document.createElement('style');
         style.id = 'galleryPollStyles';
         style.textContent = `@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`;
         document.head.appendChild(style);
      }
      
      
      if (App.ui && App.ui.populateTopicsDropdown) {
          App.ui.populateTopicsDropdown('generationHistoryAssignTopicSelect', '-- Topic --');
      }
      
      const topicSel = document.getElementById('generationHistoryAssignTopicSelect');
      if (topicSel && !topicSel.dataset.boundBulkGen) {
         topicSel.dataset.boundBulkGen = "true";
         topicSel.addEventListener('change', async (e) => {
            const val = e.target.value;
            if (!val) return;
            await App.assetsVideo.assignTopicToSelectedGenerations(val);
            e.target.value = ''; // Reset visibly out functionally
         });
      }

    } catch (err) {
      console.error('Failed fetching Generation History natively:', err);
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 1rem;" class="muted">Server API routing error.</td></tr>';
    }
  }

  async function cancelGeneration(assetId) {
    if (!confirm('Are you sure you want to cancel this rendering job?')) return;
    try {
      if (galleryPollers[assetId]) {
        clearInterval(galleryPollers[assetId]);
        delete galleryPollers[assetId];
      }
      const res = await App.api('/api/assets/generate/cancel', { 
        method: 'POST', 
        body: JSON.stringify({ id: assetId }) 
      });
      App.notify(res.message || 'Generation gracefully cancelled.');
      renderGenerationHistory();
    } catch (err) {
      App.notify(err.message, true);
    }
  }

  async function cloneGeneration(assetId) {
     const cache = window.__genCache && window.__genCache[assetId];
     if (!cache) return;
     
     let prompt = cache.comments || '';
     prompt = prompt.replace('Generative Prompt Instructions: \n', '');
     
     const promptBox = document.getElementById('videoCreationPrompt');
     if (promptBox) promptBox.value = prompt;
     
     const rawTags = Array.isArray(cache.tags) ? cache.tags : [];
     const refIds = rawTags
       .filter(t => t && String(t).startsWith('ref:'))
       .map(t => Number(String(t).replace('ref:', '')));
     
     if (refIds.length > 0) {
        try {
           const res = await App.api('/api/assets');
           const allAssets = Array.isArray(res.assets) ? res.assets : [];
           const matches = allAssets.filter(a => refIds.includes(a.id));
           
           creationReferences = []; 
           const ctr = document.getElementById('creationReferenceList');
           if (ctr) ctr.innerHTML = '';
           
           matches.forEach(asset => {
              attachCreationReference(asset.id, asset.assetName, asset.assetType);
           });
        } catch (e) {
           console.error("Failed cloning reference context constraints.", e);
        }
     }
     
     App.notify('Job loaded completely into Assemble Assets Form.');
     window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function toggleAllGenerations(source) {
     const checkboxes = document.querySelectorAll('input[name="genItem"]');
     checkboxes.forEach(cb => cb.checked = source.checked);
     updateBulkActionsGenerations();
  }

  function updateBulkActionsGenerations() {
     const checked = document.querySelectorAll('input[name="genItem"]:checked');
     const delBtn = document.getElementById('generationHistoryDeleteBtn');
     if (delBtn) delBtn.disabled = checked.length === 0;
  }

  async function deleteSelectedGenerations() {
     const checked = Array.from(document.querySelectorAll('input[name="genItem"]:checked'));
     if (checked.length === 0) return;
     if (!confirm(`Are you sure you want to rigorously delete ${checked.length} generation task(s)?`)) return;

     App.notify('Deleting bulk generations...', true);
     for (const cb of checked) {
         try {
             if (galleryPollers[cb.value]) {
                 clearInterval(galleryPollers[cb.value]);
                 delete galleryPollers[cb.value];
             }
             await App.api('/api/assets/generate/cancel', { method: 'POST', body: JSON.stringify({ id: cb.value }) });
         } catch (e) {
             console.warn('Physical block error on deletion:', e);
         }
     }
     
     document.getElementById('generationHistorySelectAll').checked = false;
     renderGenerationHistory();
     App.notify('Selected generations completely removed from physical storage layout.');
  }

  async function assignTopicToSelectedGenerations(topic) {
     const checked = Array.from(document.querySelectorAll('input[name="genItem"]:checked'));
     if (checked.length === 0) return;

     App.notify(`Assigning topic "${topic}" explicitly to ${checked.length} selected row(s)...`);
     
     for (const cb of checked) {
         try {
             await App.api(`/api/assets/${cb.value}`, { 
                 method: 'PATCH', 
                 body: JSON.stringify({ topic: topic }) 
             });
         } catch (e) {
             console.warn('Physical assignment collision natively on PATCH.', e);
         }
     }
     
     renderGenerationHistory();
     App.notify('Bulk topic physically locked onto generation matrix successfully.');
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
    saveVirtualClip,
    toggleStudioPanel,
    submitCreationPrompt,
    searchCreationReferences,
    attachCreationReference,
    removeCreationReference,
    renderGenerationHistory,
    cancelGeneration,
    cloneGeneration,
    toggleAllGenerations,
    updateBulkActionsGenerations,
    deleteSelectedGenerations,
    assignTopicToSelectedGenerations
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
    loadCreationAssetCategories();
    renderGenerationHistory();
    
    const creationTypeFilter = document.getElementById('creationRefAssetType');
    if (creationTypeFilter) {
       creationTypeFilter.addEventListener('change', loadCreationAssetCategories);
    }
  });

})();
