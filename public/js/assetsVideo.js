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
          await App.ui.populateTopicsDropdown('videoCreationTopic', '-- No Topic --', '');
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
          
          const typeText = document.createTextNode(`[${a.assetType || 'Asset'}] `);
          label.appendChild(typeText);
          
          if (a.location) {
             window.__genCache = window.__genCache || {};
             window.__genCache[a.id] = a;
             
             const lnk = document.createElement('a');
             if (a.location.startsWith('{')) {
                 lnk.href = '#';
                 lnk.onclick = (e) => {
                     e.preventDefault();
                     App.assetsVideo.openGenerationBlob(a.id);
                 };
             } else {
                 lnk.href = a.location;
                 lnk.target = '_blank';
             }
             lnk.style.color = 'var(--primary-color)';
             lnk.textContent = a.assetName || a.id;
             label.appendChild(lnk);
          } else {
             const nameText = document.createTextNode(a.assetName || a.id);
             label.appendChild(nameText);
          }
          
          const btnWrap = document.createElement('div');
          const attachBtn = document.createElement('button');
          attachBtn.type = 'button';
          attachBtn.className = 'btn btn-primary';
          attachBtn.textContent = 'Attach';
          attachBtn.style.padding = '4px 8px';
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
      category: asset.category,
      topic: asset.topic,
      location: asset.location,
      instructions: ''
    });
    renderCreationReferences();
  }

  function removeCreationReference(id) {
    creationReferences = creationReferences.filter(r => r.id !== id);
    renderCreationReferences();
  }

  function updateCreationReferenceInstruction(id, value) {
    const ref = creationReferences.find(r => r.id === id);
    if (ref) ref.instructions = value;
  }

  function openGenerationBlob(assetId) {
      const cache = window.__genCache && window.__genCache[assetId];
      if (!cache || !cache.location) return;
      try {
          const obj = JSON.parse(cache.location);
          let b64 = '';
          if (obj.videos && obj.videos[0]) {
             b64 = obj.videos[0].bytesBase64Encoded || '';
          }
          if (!b64) throw new Error('No bytes found in Veo response payload.');
          
          const byteCharacters = atob(b64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], {type: 'video/mp4'});
          const blobUrl = URL.createObjectURL(blob);
          window.open(blobUrl, '_blank');
      } catch (err) {
          console.error(err);
          App.notify('Failed to decode native Fal MP4 stream.', true);
      }
  }

  function renderCreationReferences() {
    const container = document.getElementById('videoCreationAttachedAssets');
    const searchForm = document.getElementById('creationAssetSearchForm');
    if (!container || !searchForm) return;
    
    container.innerHTML = '';
    
    if (creationReferences.length === 0) {
      container.classList.add('hidden');
      searchForm.classList.remove('hidden');
      return;
    }

    searchForm.classList.remove('hidden');
    container.classList.remove('hidden');

    creationReferences.forEach(ref => {
      const block = document.createElement('div');
      block.style.display = 'flex';
      block.style.flexDirection = 'column';
      block.style.gap = '0.75rem';
      block.style.border = '1px solid var(--border)';
      block.style.padding = '0.75rem';
      block.style.borderRadius = 'var(--radius-md)';
      block.style.background = 'var(--bg-body)';
      
      let imgHtml = '';
      if (ref.location && (ref.location.includes('http') || ref.location.startsWith('data:image'))) {
          imgHtml = `<img src="${ref.location}" style="width: 60px; height: 60px; min-width: 60px; object-fit: cover; border-radius: var(--radius); border: 1px solid var(--border);" />`;
      } else {
          imgHtml = `<div style="width: 60px; height: 60px; min-width: 60px; display:flex; align-items:center; justify-content:center; background: var(--bg-alt); border: 1px dashed var(--border); border-radius: var(--radius); font-size: 0.70rem; color: var(--subtext); text-align: center;">No Preview</div>`;
      }

      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'flex-start';
      
      const leftHeaderHtml = `
         <div style="display: flex; gap: 1rem; align-items: center;">
            ${imgHtml}
            <div>
               <strong style="display: block; font-size: 1rem;">
                  ${(() => {
                     if (!ref.location) return `<span style="color: var(--primary-color);">${ref.assetName || 'Untitled Asset'}</span>`;
                     window.__genCache = window.__genCache || {};
                     window.__genCache[ref.id] = ref;
                     if (ref.location.startsWith('{')) {
                         return `<a href="#" onclick="App.assetsVideo.openGenerationBlob('${ref.id}'); return false;" style="color: var(--primary-color); text-decoration: none;">${ref.assetName || 'Untitled Asset'}</a>`;
                     } else {
                         return `<a href="${ref.location}" target="_blank" style="color: var(--primary-color); text-decoration: none;">${ref.assetName || 'Untitled Asset'}</a>`;
                     }
                  })()}
               </strong>
               <span class="muted" style="font-size: 0.85rem; display: block; margin-top: 2px;">Format: ${ref.assetType || '-'} | Category: ${ref.category || '-'} | Topic: ${ref.topic || '-'}</span>
            </div>
         </div>
      `;
      const leftHeaderWrap = document.createElement('div');
      leftHeaderWrap.innerHTML = leftHeaderHtml;

      const remBtn = document.createElement('button');
      remBtn.type = 'button';
      remBtn.className = 'tiny-btn icon-btn icon-btn-danger';
      remBtn.title = 'Detach Asset';
      remBtn.innerHTML = `<span class="icon-btn-glyph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12h.01M16 12h2M6 12h2M15 7h2a5 5 0 0 1 0 10h-2M9 7H7a5 5 0 0 0 0 10h2"/></svg></span>`;
      remBtn.onclick = () => App.assetsVideo.removeCreationReference(ref.id);
      
      header.appendChild(leftHeaderWrap);
      header.appendChild(remBtn);

      const ta = document.createElement('textarea');
      ta.rows = 4;
      ta.style.width = '100%';
      ta.style.boxSizing = 'border-box';
      ta.style.padding = '0.5rem';
      ta.style.border = '1px solid var(--border)';
      ta.style.borderRadius = 'var(--radius)';
      ta.style.background = 'var(--bg-alt)';
      ta.placeholder = `Specific layout instructions for utilizing this visual reference within the prompt pipeline...`;
      ta.value = ref.instructions || '';
      ta.oninput = (e) => updateCreationReferenceInstruction(ref.id, e.target.value);

      block.appendChild(header);
      block.appendChild(ta);
      container.appendChild(block);
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
    const titleInput = document.getElementById('videoCreationAssetName');
    const topicInput = document.getElementById('videoCreationTopic');
    const durationInput = document.getElementById('videoCreationDuration');
    if (!promptInput) return;
    const promptText = String(promptInput.value || '').trim();
    if (!promptText) return App.notify('Please provide a directive prompt before initializing generation.', true);

    const assetName = titleInput ? String(titleInput.value || '').trim() : '';
    const topic = topicInput ? String(topicInput.value || '').trim() : '';
    const duration = durationInput ? parseInt(durationInput.value, 10) || 4 : 4;

    try {
      const payload = { assetName, topic, prompt: promptText, references: creationReferences, duration };
      const data = await App.api('/api/assets/generate', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      App.notify('Video generation successfully started! Your request is now rendering in the cloud.', false);
      promptInput.value = '';
      if (titleInput) titleInput.value = '';
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
             let viewAction = `window.open('${asset.location}', '_blank')`;
             if (asset.location.startsWith('{')) {
                 viewAction = `App.assetsVideo.openGenerationBlob('${asset.id}')`;
             }
             actionHTML = `<button type="button" class="white-btn tiny-btn" onclick="${viewAction}" style="margin-right: 8px;">View Resource</button>`;
             actionHTML += `<button type="button" class="tiny-btn icon-btn icon-btn-danger" title="Delete" onclick="App.assetsVideo.deleteGeneration('${asset.id}')"><span class="icon-btn-glyph"><svg viewBox="0 0 24 24" aria-hidden="true">${App.ACTION_ICONS.trash}</svg></span></button>`;
         } else if (asset.generationStatus === 'processing') {
             let isExtending = false;
             if (Array.isArray(asset.tags)) {
                 const curDurTag = asset.tags.find(t => String(t).startsWith('currentDuration:'));
                 if (curDurTag && parseInt(curDurTag.split(':')[1], 10) > 0) isExtending = true;
             }
             const renderingLabel = isExtending ? 'Rendering (Extending)...' : 'Rendering...';

             actionHTML = `
               <span class="muted" style="font-size:0.8rem; display:inline-flex; align-items:center; gap:0.5rem; vertical-align:middle; margin-right: 8px;">
                 <span class="loader-spinner" style="border: 2px solid var(--border); border-top: 2px solid var(--primary-color); border-radius: 50%; width: 12px; height: 12px; animation: spin 1s linear infinite;"></span>
                 <span>${renderingLabel}</span>
               </span>
               <button type="button" class="tiny-btn icon-btn" title="Cancel Job" onclick="App.assetsVideo.cancelGeneration('${asset.id}')"><span class="icon-btn-glyph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg></span></button>
               <button type="button" class="tiny-btn icon-btn icon-btn-danger" title="Delete" onclick="App.assetsVideo.deleteGeneration('${asset.id}')" style="margin-left: 4px;"><span class="icon-btn-glyph"><svg viewBox="0 0 24 24" aria-hidden="true">${App.ACTION_ICONS.trash}</svg></span></button>
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
                          // Prevent ghost polling if User structurally logged out
                          if (!App.auth || !App.auth.user) {
                            clearInterval(galleryPollers[asset.id]);
                            delete galleryPollers[asset.id];
                            return;
                          }

                          const statusRes = await App.api(`/api/assets/generate/status?id=${asset.id}`);
                          
                          if (statusRes.asset && statusRes.asset._vertexDiagnostic) {
                             const vDiag = statusRes.asset._vertexDiagnostic;
                             console.log(`[Veo Diagnostic] Asset ${asset.id}:`, vDiag);
                             
                             // Attempt to map progress out of the raw Vertex JSON dynamically
                             const progNode = document.getElementById(`elapsed-time-${asset.id}`);
                             if (progNode && vDiag.metadata) {
                                const progCount = vDiag.metadata.progressPercent || vDiag.metadata.progressPercentage || '';
                                if (progCount) {
                                   progNode.title = `Fal Engine: ${progCount}% Complete`;
                                }
                             }
                          }
                          
                          if (statusRes.asset && statusRes.asset.generationStatus !== 'processing') {
                             clearInterval(galleryPollers[asset.id]);
                             delete galleryPollers[asset.id];
                             renderGenerationHistory(); 
                          }
                       } catch (e) {
                          console.error(`[Veo Tracker Crash] Status check for Asset ${asset.id} structurally failed:`, e.message || e);
                          // Emergency Kill Switch: Protect Vercel Compute Credits!
                          // If the backend is hard-crashing on 500, stop endlessly hammering the proxy.
                          if (!asset._failCount) asset._failCount = 0;
                          asset._failCount++;
                          
                          if (asset._failCount > 3) {
                             console.warn(`[Veo Fallback] Structurally closing ghosted API poll for Asset ${asset.id} terminating Vercel abuse.`);
                             clearInterval(galleryPollers[asset.id]);
                             delete galleryPollers[asset.id];
                             
                             // Gracefully visually fail it on screen
                             asset.generationStatus = 'failed';
                             asset.comments = 'API Node Tracker Hard Crashed (Vercel Output 500)';
                             renderGenerationHistory();
                          }
                       }
                   }
                }, 1000);
             }
         } else if (asset.generationStatus === 'failed') {
             const errorReason = asset.comments || 'Unknown error occurred.';
             actionHTML = `<div class="muted" style="color:tomato; font-size: 0.8rem; margin-right: 8px; max-width: 200px; white-space: normal;">${errorReason}</div>`;
             actionHTML += `<button type="button" class="tiny-btn icon-btn icon-btn-danger" title="Delete" onclick="App.assetsVideo.deleteGeneration('${asset.id}')"><span class="icon-btn-glyph"><svg viewBox="0 0 24 24" aria-hidden="true">${App.ACTION_ICONS.trash}</svg></span></button>`;
         } else {
             actionHTML = `<span class="muted" style="color:tomato; margin-right: 8px;">Unknown Status</span>`;
             actionHTML += `<button type="button" class="tiny-btn icon-btn icon-btn-danger" title="Delete" onclick="App.assetsVideo.deleteGeneration('${asset.id}')"><span class="icon-btn-glyph"><svg viewBox="0 0 24 24" aria-hidden="true">${App.ACTION_ICONS.trash}</svg></span></button>`;
         }
         
         actionHTML += ` <button type="button" class="tiny-btn icon-btn" title="Clone" onclick="App.assetsVideo.cloneGeneration('${asset.id}')" style="margin-left:4px;"><span class="icon-btn-glyph"><svg viewBox="0 0 24 24" aria-hidden="true">${App.ACTION_ICONS.clone}</svg></span></button>`;

         window.__genCache = window.__genCache || {};
         window.__genCache[asset.id] = asset;

         let rawDate = Date.now();
         let endTime = null;
         if (Array.isArray(asset.tags)) {
             const startTag = asset.tags.find(t => String(t).startsWith('startTime:'));
             if (startTag) rawDate = parseInt(startTag.replace('startTime:', ''), 10);
             
             const endTag = asset.tags.find(t => String(t).startsWith('endTime:'));
             if (endTag) endTime = parseInt(endTag.replace('endTime:', ''), 10);
         }
         
         const dateString = new Date(rawDate).toLocaleTimeString(); // Only showing Time natively usually cleaner
         
         let initialElapsed = '-';
         if (asset.generationStatus === 'processing') {
             const seconds = Math.floor((Date.now() - rawDate) / 1000);
             initialElapsed = `<span id="elapsed-time-${asset.id}">${seconds}s</span>`;
         } else if (asset.generationStatus === 'completed') {
             if (endTime && rawDate) {
                 const diff = Math.floor((endTime - rawDate) / 1000);
                 const mins = Math.floor(diff / 60);
                 const secs = diff % 60;
                 initialElapsed = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
             } else {
                 initialElapsed = 'Done';
             }
         }

         let titleHTML = `<span style="font-weight: 600;">${asset.assetName || 'Untitled LRO'}</span>`;
         if (asset.location) {
             if (asset.location.startsWith('{')) {
                 titleHTML = `<a href="#" onclick="App.assetsVideo.openGenerationBlob('${asset.id}'); return false;" style="font-weight: 600; color: inherit;">${asset.assetName || 'Untitled LRO'}</a>`;
             } else {
                 titleHTML = `<a href="${asset.location}" target="_blank" style="font-weight: 600; color: inherit;">${asset.assetName || 'Untitled LRO'}</a>`;
             }
         }

         const safeName = (asset.assetName || 'Untitled LRO').replace(/'/g, "\\'").replace(/"/g, '&quot;');
         row.innerHTML = `
           <td style="text-align: center;"><input type="checkbox" name="genItem" value="${asset.id}" onchange="App.assetsVideo.updateBulkActionsGenerations()" /></td>
           <td>
              ${titleHTML}
              <button type="button" class="tiny-btn icon-btn" title="Edit Name" onclick="App.assetsVideo.editGenerationName('${asset.id}', '${safeName}')" style="margin-left:8px; border:none; background:transparent;"><span class="icon-btn-glyph" style="opacity: 0.6;"><svg viewBox="0 0 24 24" aria-hidden="true">${App.ACTION_ICONS.edit}</svg></span></button>
           </td>
           <td style="font-size:0.85rem;" class="muted">${asset.topic || '-'}</td>
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

    } catch (err) {
      console.error('Failed fetching Generation History natively:', err);
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 1rem;" class="muted">Server API routing error.</td></tr>';
    }
  }

  async function editGenerationName(assetId, currentName) {
     const newName = prompt('Enter a new name for this video job:', currentName);
     if (newName === null || newName === currentName) return;
     if (!newName.trim()) return App.notify('Name cannot be completely empty.', true);
     
     try {
       await App.api(`/api/assets/${assetId}`, {
         method: 'PATCH',
         body: JSON.stringify({ assetName: newName.trim() })
       });
       App.notify('Job successfully renamed.');
       renderGenerationHistory();
     } catch (err) {
       console.error(err);
       App.notify(err.message || 'Failed to rename job natively.', true);
     }
   }

  async function cancelGeneration(assetId) {
    if (!confirm('Are you sure you want to send a cancellation signal to the Fal AI cloud engine?')) return;
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

  async function deleteGeneration(assetId) {
    if (!confirm('Are you sure you want to permanently delete this video generation record from the database?')) return;
    try {
      if (galleryPollers[assetId]) {
        clearInterval(galleryPollers[assetId]);
        delete galleryPollers[assetId];
      }
      await App.api(`/api/assets/${assetId}`, { method: 'DELETE' });
      App.notify('Generation record completely deleted.');
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
     
     const titleBox = document.getElementById('videoCreationAssetName');
     if (titleBox && cache.assetName) {
        let n = cache.assetName;
        if (n.startsWith('Generated Video: ')) n = n.replace('Generated Video: ', '');
        titleBox.value = n;
     }

     const topicBox = document.getElementById('videoCreationTopic');
     if (topicBox && cache.topic) {
        topicBox.value = cache.topic;
     }

     const rawTags = Array.isArray(cache.tags) ? cache.tags : [];
     const refIds = rawTags
       .filter(t => t && String(t).startsWith('ref:'))
       .map(t => Number(String(t).replace('ref:', '')));
     
     console.log('--- Cloning Job ID:', assetId, '---');
     console.log('Raw tags:', rawTags);
     console.log('Parsed ref IDs to extract:', refIds);
     
     if (refIds.length > 0) {
        try {
           const res = await App.api('/api/assets');
           const allAssets = Array.isArray(res.assets) ? res.assets : (Array.isArray(res.data) ? res.data : []);
           console.log('Fetched API Assets Count:', allAssets.length);
           
           const matches = allAssets.filter(a => refIds.includes(Number(a.id)));
           console.log('Matches Found natively:', matches);
           
           creationReferences = []; 
           const ctr = document.getElementById('videoCreationAttachedAssets');
           if (ctr) ctr.innerHTML = '';
           
           matches.forEach(asset => {
              console.log('Attaching matched asset:', asset.id, asset.assetName);
              attachCreationReference(asset);
           });
        } catch (e) {
           console.error("Failed cloning reference context constraints.", e);
        }
     }
     
     App.notify('Job loaded completely into Assemble Assets Form.');
     
     const wrap = document.getElementById('creationStudioWrap');
     if (wrap) {
        const header = wrap.querySelector('.studio-collapsible-header');
        const body = wrap.querySelector('.studio-collapsible-body');
        if (body && body.classList.contains('hidden')) {
           body.classList.remove('hidden');
           if (header) header.classList.remove('collapsed');
        }
        wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
     } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
     }
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

  async function triggerAssignTopicBtn() {
     const val = document.getElementById('generationHistoryAssignTopicSelect')?.value;
     if (!val) return App.notify('Please choose a topic first prior to binding explicitly.', true);
     
     await assignTopicToSelectedGenerations(val);
     const topicSel = document.getElementById('generationHistoryAssignTopicSelect');
     if (topicSel) topicSel.value = '';
     
     const checkAll = document.getElementById('generationHistorySelectAll');
     if (checkAll) checkAll.checked = false;
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
    deleteGeneration,
    cloneGeneration,
    toggleAllGenerations,
    updateBulkActionsGenerations,
    deleteSelectedGenerations,
    assignTopicToSelectedGenerations,
    triggerAssignTopicBtn,
    openGenerationBlob,
    editGenerationName
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
    const boot = () => {
      injectYoutubeScript();
      initStars();
      loadTopicDropdowns();
      loadCreationAssetCategories();
      renderGenerationHistory();

      const creationTypeFilter = document.getElementById('creationRefAssetType');
      if (creationTypeFilter) {
        creationTypeFilter.addEventListener('change', loadCreationAssetCategories);
      }
    };
    if (typeof App.whenAuthenticated === 'function') {
      App.whenAuthenticated(boot);
    } else {
      boot();
    }
  });

})();
