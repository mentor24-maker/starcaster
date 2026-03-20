/**
 * public/js/youtubeComments.js
 * Dedicated Comments page — displays individual comments from a
 * acquire_youtube_comments run. Navigated to from the YouTube page.
 */

window.App = window.App || {};
App.youtubeComments = (function () {
  const { state, els, api, notify, setPreview } = App;

  let currentRunId = null;
  let allComments  = [];
  let currentRun   = null;  // Store run info (title, video_url) for table display
  let sourcePageId = 'acquireYoutubePage';
  let currentAgent = null;
  let allAgents = [];
  let queueRefreshTimer = null;

  const filters = {
    from:    '',
    to:      '',
    search:  '',
    type:    'all',   // 'all' | 'top' | 'reply'
    minLikes: '',
  };

  const cadenceSecondsByTimeframe = {
    minute: 60,
    hour: 3600,
    day: 86400,
    week: 604800,
    month: 2592000,
    year: 31536000,
  };
  
  function normalizeFilterDate(v) {
    const s = String(v || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }
  
  function toLocalDateKey(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function getSourcePageLabel(pageId) {
    return pageId === 'engageSocialPage' ? 'Promote: Social' : 'Acquire: YouTube';
  }

  function updateBackButton() {
    const backBtn = document.getElementById('commentsPageBackBtn');
    if (!backBtn) return;
    backBtn.textContent = `Back to ${getSourcePageLabel(sourcePageId)}`;
  }

  function getRepositoryVideos() {
    return Array.isArray(state.acquireYoutubeVideos) ? state.acquireYoutubeVideos.slice(0, 50) : [];
  }

  async function refreshRepositoryVideos() {
    try {
      const res = await api('/api/acquire/youtube-videos?limit=50');
      state.acquireYoutubeVideos = Array.isArray(res.videos)
        ? res.videos
        : (Array.isArray(res.data) ? res.data : []);
    } catch (_) {
      state.acquireYoutubeVideos = Array.isArray(state.acquireYoutubeVideos) ? state.acquireYoutubeVideos : [];
    }
    renderVideoUrlOptions(currentRun && currentRun.video_url);
  }

  async function refreshAgents() {
    try {
      const res = await api('/api/engage/youtube-comment-agents');
      allAgents = Array.isArray(res.agents) ? res.agents : (Array.isArray(res.data) ? res.data : []);
    } catch (_) {
      allAgents = [];
    }
    renderAgentQueue();
  }

  function matchingAgent(videoUrl) {
    const target = String(videoUrl || '').trim();
    if (!target) return null;
    return allAgents.find((agent) => String(agent && agent.videoUrl || '').trim() === target) || null;
  }

  function formatDateTime(value) {
    const text = String(value || '').trim();
    if (!text) return '-';
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? text : parsed.toLocaleString();
  }

  function summarizeCadence(agent) {
    return formatCadenceSummary(agent && agent.frequency, agent && agent.timeframe);
  }

  function agentProgressText(agent) {
    const sent = Number(agent && agent.totalPostsCount || 0) || 0;
    const max = Number(agent && agent.maxPosts || 0) || 0;
    return max ? `${sent}/${max} sent` : `${sent} sent`;
  }

  function queueStatusClass(status) {
    const key = String(status || '').trim().toLowerCase();
    if (!key) return '';
    return `is-${key}`;
  }

  function renderAgentQueue() {
    const listEl = document.getElementById('commentsAgentQueueList');
    const summaryEl = document.getElementById('commentsAgentQueueSummary');
    if (!listEl || !summaryEl) return;

    const selectedVideoUrl = String(document.getElementById('commentsVideoUrlSelect')?.value || currentRun?.video_url || '').trim();
    const sorted = Array.isArray(allAgents) ? allAgents.slice().sort((a, b) => {
      const aNext = String(a && a.nextRunAt || '').trim();
      const bNext = String(b && b.nextRunAt || '').trim();
      if (aNext && bNext) return aNext.localeCompare(bNext);
      if (aNext) return -1;
      if (bNext) return 1;
      return String(b && b.updatedAt || '').localeCompare(String(a && a.updatedAt || ''));
    }) : [];

    const scheduledCount = sorted.filter((agent) => String(agent && agent.scheduleStatus || '').trim().toLowerCase() === 'scheduled').length;
    const dueCount = sorted.filter((agent) => String(agent && agent.scheduleStatus || '').trim().toLowerCase() === 'due').length;
    const completedCount = sorted.filter((agent) => String(agent && agent.scheduleStatus || '').trim().toLowerCase() === 'completed').length;
    summaryEl.textContent = sorted.length
      ? `${sorted.length} saved agent${sorted.length === 1 ? '' : 's'} | ${scheduledCount} scheduled | ${dueCount} due | ${completedCount} completed`
      : 'No scheduled YouTube comment agents yet.';

    listEl.innerHTML = '';
    if (!sorted.length) {
      const empty = document.createElement('div');
      empty.className = 'youtube-comments-agent-queue-empty';
      empty.textContent = 'Save a schedule to see queued YouTube comment agents here.';
      listEl.appendChild(empty);
      return;
    }

    sorted.forEach((agent) => {
      const card = document.createElement('div');
      const status = String(agent && agent.scheduleStatus || '').trim().toLowerCase();
      const isCurrent = selectedVideoUrl && String(agent && agent.videoUrl || '').trim() === selectedVideoUrl;
      card.className = `youtube-comments-agent-card ${queueStatusClass(status)}${isCurrent ? ' is-current' : ''}`.trim();

      const head = document.createElement('div');
      head.className = 'youtube-comments-agent-card-head';

      const title = document.createElement('div');
      title.className = 'youtube-comments-agent-card-title';
      title.textContent = String(agent && agent.videoUrl || '').trim() || 'Untitled agent';

      const badge = document.createElement('span');
      badge.className = `youtube-comments-agent-badge ${queueStatusClass(status)}`.trim();
      badge.textContent = status || 'saved';

      head.appendChild(title);
      head.appendChild(badge);

      const meta = document.createElement('div');
      meta.className = 'youtube-comments-agent-card-meta';
      meta.innerHTML = [
        `<div><strong>Cadence:</strong> ${summarizeCadence(agent)}</div>`,
        `<div><strong>Window:</strong> ${String(agent && agent.fromDate || '').trim() || '-'} to ${String(agent && agent.toDate || '').trim() || '-'}</div>`,
        `<div><strong>Next Run:</strong> ${formatDateTime(agent && agent.nextRunAt)}</div>`,
        `<div><strong>Progress:</strong> ${agentProgressText(agent)}</div>`,
      ].join('');

      const note = document.createElement('div');
      note.className = `youtube-comments-agent-card-note${status === 'error' ? ' is-error' : ''}`;
      note.textContent = String(agent && (agent.lastError || agent.scheduleNote) || '').trim() || 'No additional notes.';

      card.appendChild(head);
      card.appendChild(meta);
      card.appendChild(note);
      listEl.appendChild(card);
    });
  }

  function renderVideoUrlOptions(selectedUrl) {
    const selectEl = document.getElementById('commentsVideoUrlSelect');
    if (!selectEl) return;
    const chosen = String(selectedUrl || '').trim();
    const videos = getRepositoryVideos();
    selectEl.innerHTML = '<option value="">Select Repository Video</option>';
    videos.forEach((video) => {
      const videoUrl = String(video && video.video_url || '').trim();
      if (!videoUrl) return;
      const option = document.createElement('option');
      option.value = videoUrl;
      const bits = [
        String(video && video.title || '').trim() || videoUrl,
        String(video && video.channel_name || '').trim()
      ].filter(Boolean);
      option.textContent = bits.join(' | ');
      if (videoUrl === chosen) option.selected = true;
      selectEl.appendChild(option);
    });
    if (chosen && !videos.some((video) => String(video && video.video_url || '').trim() === chosen)) {
      const option = document.createElement('option');
      option.value = chosen;
      option.textContent = chosen;
      option.selected = true;
      selectEl.appendChild(option);
    }
  }

  function formatCadenceSummary(frequency, timeframe) {
    const safeFrequency = Math.max(1, Math.min(Number(frequency) || 1, 60));
    const safeTimeframe = String(timeframe || 'month').trim().toLowerCase();
    const singular = safeTimeframe.replace(/s$/, '');
    const plural = safeFrequency === 1 ? singular : `${singular}s`;
    return `Scheduled ${safeFrequency} time${safeFrequency === 1 ? '' : 's'} per ${plural}.`;
  }

  function updateScheduleUi() {
    const freqInput = document.getElementById('commentsFrequencyInput');
    const timeframeEl = document.getElementById('commentsTimeframeSelect');
    const summaryEl = document.getElementById('commentsScheduleSummary');
    const warningEl = document.getElementById('commentsScheduleWarning');
    const frequency = Math.max(1, Math.min(Number(freqInput && freqInput.value || 1) || 1, 60));
    const timeframe = String(timeframeEl && timeframeEl.value || 'month').trim().toLowerCase();
    if (freqInput) freqInput.value = String(frequency);
    if (summaryEl) summaryEl.textContent = formatCadenceSummary(frequency, timeframe);

    const intervalSeconds = (cadenceSecondsByTimeframe[timeframe] || cadenceSecondsByTimeframe.month) / frequency;
    if (warningEl) {
      warningEl.classList.toggle('hidden', intervalSeconds >= 3600);
      warningEl.textContent = intervalSeconds < 3600
        ? 'Warning: this cadence is faster than once per hour.'
        : '';
    }
  }

  function collectSchedulerPayload() {
    const videoUrl = String(document.getElementById('commentsVideoUrlSelect')?.value || '').trim();
    const fromDate = String(document.getElementById('commentsFromDate')?.value || '').trim();
    const toDate = String(document.getElementById('commentsToDate')?.value || '').trim();
    const frequency = Math.max(1, Math.min(Number(document.getElementById('commentsFrequencyInput')?.value || 1) || 1, 60));
    const timeframe = String(document.getElementById('commentsTimeframeSelect')?.value || 'month').trim().toLowerCase();
    const maxPosts = Math.max(1, Math.min(Number(document.getElementById('commentsMaxPostsSelect')?.value || 1) || 1, 20));
    const videoCommentRatio = String(document.getElementById('commentsVideoCommentRatioSelect')?.value || '100/0').trim();
    return {
      agentId: currentAgent && currentAgent.id ? currentAgent.id : '',
      videoUrl,
      fromDate,
      toDate,
      frequency,
      timeframe,
      maxPosts,
      videoCommentRatio,
    };
  }

  function setPostingStatus(message, isError) {
    const el = document.getElementById('commentsPostingStatus');
    if (!el) return;
    el.textContent = String(message || '').trim() || 'Posting setup has not been checked yet.';
    el.style.color = isError ? '#b42318' : '';
    el.style.fontWeight = isError ? '700' : '';
  }

  function updateScheduleStatusFromAgent() {
    if (!currentAgent || !currentAgent.id) return;
    const note = String(currentAgent.scheduleNote || '').trim();
    const nextRunAt = String(currentAgent.nextRunAt || '').trim();
    const totalPosts = Number(currentAgent.totalPostsCount || 0) || 0;
    const maxPosts = Number(currentAgent.maxPosts || 0) || 0;
    if (note) {
      const extra = nextRunAt ? ` Next run: ${new Date(nextRunAt).toLocaleString()}.` : '';
      setPostingStatus(`${note}${extra}${maxPosts ? ` Posts sent: ${totalPosts}/${maxPosts}.` : ''}`, false);
    }
  }

  function describePreflight(preflight) {
    const checks = preflight && preflight.checks || {};
    if (!preflight || typeof preflight !== 'object') {
      return { message: 'Posting setup has not been checked yet.', isError: false };
    }
    if (preflight.ready) {
      const provider = String(checks.commentGeneration && checks.commentGeneration.provider || 'llm').trim() || 'llm';
      const channelTitle = String(checks.youtubePosting && checks.youtubePosting.channelTitle || '').trim();
      return {
        message: `Ready to post. Comment generation is working via ${provider}, and YouTube posting is authorized${channelTitle ? ` for ${channelTitle}` : ''}.`,
        isError: false,
      };
    }
    const issues = Array.isArray(preflight.issues) ? preflight.issues.filter(Boolean) : [];
    return {
      message: issues[0] || 'Posting setup is not ready yet.',
      isError: true,
    };
  }

  function syncHeaderFromCurrentRun() {
    const titleEl = document.getElementById('commentsPageVideoTitle');
    const channelEl = document.getElementById('commentsPageChannel');
    const countEl = document.getElementById('commentsPageCount');
    if (titleEl) titleEl.textContent = currentRun?.title || currentRun?.video_url || '-';
    if (channelEl) channelEl.textContent = currentRun?.channel_name || '-';
    if (countEl) countEl.textContent = Number(currentRun?.comment_count || 0).toLocaleString() + ' comments';
  }

  async function savePromotionAgent() {
    const payload = collectSchedulerPayload();
    if (!payload.videoUrl) return notify('Select a repository video first', true);
    if (!payload.fromDate || !payload.toDate) return notify('Choose From and To dates first', true);
    const res = await api('/api/engage/youtube-comment-agents', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    currentAgent = res.agent || null;
    await refreshAgents();
    currentAgent = matchingAgent(payload.videoUrl) || currentAgent;
    setPreview(document.getElementById('commentsActionPreview'), res);
    updateScheduleStatusFromAgent();
    notify('YouTube promotion agent saved and scheduling enabled');
  }

  async function checkPostingSetup() {
    const payload = collectSchedulerPayload();
    if (!payload.videoUrl) return notify('Select a repository video first', true);
    const res = await api('/api/engage/youtube-comment-agents/preflight', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setPreview(document.getElementById('commentsActionPreview'), res);
    const summary = describePreflight(res);
    setPostingStatus(summary.message, summary.isError);
    notify(summary.message, summary.isError);
    return res;
  }

  async function postOnDemand() {
    const payload = collectSchedulerPayload();
    if (!payload.videoUrl) return notify('Select a repository video first', true);
    const preflight = await checkPostingSetup();
    if (!preflight || preflight.ready !== true) return;
    const res = await api('/api/engage/youtube-comment-agents/test-post', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    currentAgent = res.agent || currentAgent;
    await refreshAgents();
    currentAgent = matchingAgent(payload.videoUrl) || currentAgent;
    setPreview(document.getElementById('commentsActionPreview'), res);
    setPostingStatus('Posted YouTube comment on demand successfully.', false);
    notify('Posted YouTube comment on demand');
  }

  async function runDueAgentsNow() {
    const res = await api('/api/engage/youtube-comment-agents/run-due', {
      method: 'POST',
    });
    await refreshAgents();
    const currentVideoUrl = String(document.getElementById('commentsVideoUrlSelect')?.value || currentRun?.video_url || '').trim();
    currentAgent = matchingAgent(currentVideoUrl) || currentAgent;
    setPreview(document.getElementById('commentsActionPreview'), res);
    updateScheduleStatusFromAgent();
    notify(`Processed ${Number(res.totalProcessed || 0)} due YouTube comment agent${Number(res.totalProcessed || 0) === 1 ? '' : 's'}`);
  }

  async function refreshQueue() {
    await refreshAgents();
    const currentVideoUrl = String(document.getElementById('commentsVideoUrlSelect')?.value || currentRun?.video_url || '').trim();
    currentAgent = matchingAgent(currentVideoUrl) || currentAgent;
    updateScheduleStatusFromAgent();
  }

  function startQueuePolling() {
    if (queueRefreshTimer) return;
    queueRefreshTimer = window.setInterval(() => {
      const page = document.getElementById('youtubeCommentsPage');
      if (!page || page.classList.contains('hidden')) return;
      refreshQueue().catch(() => null);
    }, 15000);
  }

  function resetHeader() {
    const titleEl = document.getElementById('commentsPageVideoTitle');
    const channelEl = document.getElementById('commentsPageChannel');
    const countEl = document.getElementById('commentsPageCount');
    if (titleEl) titleEl.textContent = '-';
    if (channelEl) channelEl.textContent = '';
    if (countEl) countEl.textContent = '';
  }

  function renderEmptyState(message) {
    const tbody = document.getElementById('commentsTable');
    const emptyState = document.getElementById('commentsPageEmptyState');
    const countEl = document.getElementById('commentsFilteredCount');
    if (countEl) countEl.textContent = '0';
    if (emptyState) emptyState.classList.remove('hidden');
    if (!tbody) return;
    tbody.innerHTML = '';
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.textContent = message || 'No comments loaded yet.';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  // -------------------------------------------------------------------------
  // Navigation helpers — called from youtube.js
  // -------------------------------------------------------------------------

  async function openPage(options) {
    sourcePageId = String(options?.sourcePage || sourcePageId || 'acquireYoutubePage');
    updateBackButton();
    await refreshRepositoryVideos();
    await refreshAgents();
    currentAgent = matchingAgent(currentRun && currentRun.video_url) || currentAgent;
    updateScheduleStatusFromAgent();
    updateScheduleUi();
    startQueuePolling();
    if (!currentRunId) {
      resetHeader();
      renderEmptyState('Open a YouTube comment run to review comments here.');
    }
    App.setActivePage('youtubeCommentsPage');
  }

  function openForRun(run, options) {
    // run = { run_id, title, video_url, channel_name, comment_count }
    sourcePageId = String(options?.sourcePage || sourcePageId || 'acquireYoutubePage');
    currentRunId = run.run_id;
    currentRun  = run;  // Store run info for table display
    allComments  = [];

    updateBackButton();

    // Update page header info
    const titleEl   = document.getElementById('commentsPageVideoTitle');
    const channelEl = document.getElementById('commentsPageChannel');
    const countEl   = document.getElementById('commentsPageCount');
    if (titleEl)   titleEl.textContent   = run.title        || run.video_url || run.run_id;
    if (channelEl) channelEl.textContent = run.channel_name || '-';
    if (countEl)   countEl.textContent   = Number(run.comment_count || 0).toLocaleString() + ' comments';
    renderVideoUrlOptions(run.video_url);

    // Reset filters
    filters.from     = '';
    filters.to       = '';
    filters.search   = '';
    filters.type     = 'all';
    filters.minLikes = '';
    const fromEl  = document.getElementById('commentsFromDate');
    const toEl    = document.getElementById('commentsToDate');
    const searchEl = document.getElementById('commentSearchFilter');
    const typeEl   = document.getElementById('commentTypeFilter');
    const likesEl  = document.getElementById('commentMinLikesFilter');
    if (fromEl)  fromEl.value  = '';
    if (toEl)    toEl.value    = '';
    if (searchEl) searchEl.value = '';
    if (typeEl)   typeEl.value   = 'all';
    if (likesEl)  likesEl.value  = '';

    openPage({ sourcePage: sourcePageId });
    loadComments(run.run_id);
  }

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  async function loadComments(runId) {
    const tbody = document.getElementById('commentsTable');
    if (!tbody) return;
    const emptyState = document.getElementById('commentsPageEmptyState');
    if (emptyState) emptyState.classList.add('hidden');
    tbody.innerHTML = '<tr><td colspan="7">Loading...</td></tr>';

    try {
      const res = await api(`/api/acquire/youtube-comment-runs/${encodeURIComponent(runId)}`);
      const run = res.run || res.data || {};
      const result = run.result || run.result_json || {};
      allComments = Array.isArray(result.comments) ? result.comments : [];
      // Update currentRun with API data, but preserve existing title if it's good
      // Always try to get/update title from API response
      const existingTitle = currentRun && currentRun.title && String(currentRun.title).trim();
      const apiTitle = (run.title && String(run.title).trim()) || (result.title && String(result.title).trim());
      // Use existing title if it's good, otherwise use API title
      const finalTitle = existingTitle || apiTitle;
      
      // Merge API data into currentRun, but never overwrite a good title with an empty one
      currentRun = {
        ...currentRun,
        ...run,
        // Only set title if we have a good one (preserve existing good title)
        title: finalTitle || (currentRun && currentRun.title ? currentRun.title : null),
        video_url: run.video_url || result.video_url || (currentRun && currentRun.video_url)
      };
      renderCommentsTable();
    } catch (err) {
      notify(err.message, true);
      if (tbody) tbody.innerHTML = `<tr><td colspan="7">Error loading comments: ${err.message}</td></tr>`;
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  function getFilteredComments() {
    const from     = normalizeFilterDate(filters.from);
    const to       = normalizeFilterDate(filters.to);
    const search   = filters.search.toLowerCase();
    const minLikes = Number(filters.minLikes) || 0;

    return allComments.filter((c) => {
      const publishedKey = toLocalDateKey(c.published_at);
      if (from) {
        if (!publishedKey) return false;
        if (publishedKey < from) return false;
      }
      if (to) {
        if (!publishedKey) return false;
        if (publishedKey > to) return false;
      }
      if (filters.type === 'top'   && c.is_reply)  return false;
      if (filters.type === 'reply' && !c.is_reply) return false;
      if (minLikes && c.like_count < minLikes)     return false;
      if (search) {
        const text    = String(c.text   || '').toLowerCase();
        const author  = String(c.author || '').toLowerCase();
        if (!text.includes(search) && !author.includes(search)) return false;
      }
      return true;
    });
  }

  function renderCommentsTable() {
    const tbody = document.getElementById('commentsTable');
    if (!tbody) return;
    tbody.innerHTML = '';

    const comments = getFilteredComments();
    const countEl  = document.getElementById('commentsFilteredCount');
    if (countEl) countEl.textContent = `${comments.length.toLocaleString()} of ${allComments.length.toLocaleString()}`;

    if (!comments.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = allComments.length ? 'No comments match current filters.' : 'No comments found for this run.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    comments.forEach((c) => {
      const tr = document.createElement('tr');
      if (c.is_reply) tr.classList.add('comment-reply-row');

      // Published date
      const dateTd = document.createElement('td');
      dateTd.textContent = c.published_at ? new Date(c.published_at).toLocaleString() : '-';
      dateTd.style.whiteSpace = 'nowrap';

      // Video title (linked to video URL)
      const videoTitleTd = document.createElement('td');
      if (currentRun && currentRun.video_url) {
        const a = document.createElement('a');
        a.href = currentRun.video_url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        // Use title if it exists and is not empty, otherwise show URL
        const titleText = currentRun.title && String(currentRun.title).trim() 
          ? String(currentRun.title).trim() 
          : null;
        a.textContent = titleText || currentRun.video_url || '-';
        a.style.textDecoration = 'underline';
        a.style.color = '#0066cc';
        videoTitleTd.appendChild(a);
      } else {
        videoTitleTd.textContent = '-';
      }
      videoTitleTd.style.maxWidth = '300px';
      videoTitleTd.style.whiteSpace = 'nowrap';
      videoTitleTd.style.overflow = 'hidden';
      videoTitleTd.style.textOverflow = 'ellipsis';

      // Author
      const authorTd = document.createElement('td');
      if (c.author_channel_url) {
        const a = document.createElement('a');
        a.href = c.author_channel_url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = c.author || '-';
        authorTd.appendChild(a);
      } else {
        authorTd.textContent = c.author || '-';
      }

      // Comment text
      const textTd = document.createElement('td');
      textTd.textContent = c.text || '-';
      textTd.style.maxWidth = '480px';

      // Type (top-level / reply)
      const typeTd = document.createElement('td');
      typeTd.textContent = c.is_reply ? 'Reply' : 'Top-level';
      typeTd.style.whiteSpace = 'nowrap';

      // Likes
      const likesTd = document.createElement('td');
      likesTd.textContent = Number(c.like_count || 0).toLocaleString();
      likesTd.style.textAlign = 'right';

      // Reply count (only meaningful for top-level)
      const repliesTd = document.createElement('td');
      repliesTd.textContent = c.is_reply ? '-' : Number(c.reply_count || 0).toLocaleString();
      repliesTd.style.textAlign = 'right';

      tr.appendChild(dateTd);
      tr.appendChild(videoTitleTd);
      tr.appendChild(authorTd);
      tr.appendChild(textTd);
      tr.appendChild(typeTd);
      tr.appendChild(likesTd);
      tr.appendChild(repliesTd);
      tbody.appendChild(tr);
    });
  }

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------

  function init() {
    // Back button
    const backBtn = document.getElementById('commentsPageBackBtn');
    if (backBtn) {
      backBtn.addEventListener('click', () => App.setActivePage(sourcePageId || 'acquireYoutubePage'));
    }

    const openYoutubeBtn = document.getElementById('commentsPageOpenYoutubeBtn');
    if (openYoutubeBtn) {
      openYoutubeBtn.addEventListener('click', () => App.setActivePage('acquireYoutubePage'));
    }

    // Date filters
    const fromEl = document.getElementById('commentsFromDate');
    if (fromEl) {
      fromEl.addEventListener('change', () => {
        filters.from = String(fromEl.value || '');
        renderCommentsTable();
      });
    }
    const toEl = document.getElementById('commentsToDate');
    if (toEl) {
      toEl.addEventListener('change', () => {
        filters.to = String(toEl.value || '');
        renderCommentsTable();
      });
    }
    const videoSelectEl = document.getElementById('commentsVideoUrlSelect');
    if (videoSelectEl) {
      videoSelectEl.addEventListener('change', () => {
        const nextUrl = String(videoSelectEl.value || '').trim();
        const match = getRepositoryVideos().find((video) => String(video && video.video_url || '').trim() === nextUrl) || null;
        currentAgent = matchingAgent(nextUrl);
        if (match) {
          currentRun = {
            ...(currentRun || {}),
            video_url: nextUrl,
            title: String(match.title || '').trim(),
            channel_name: String(match.channel_name || '').trim(),
            comment_count: Number(match.comment_count || 0) || 0,
          };
          syncHeaderFromCurrentRun();
        }
        updateScheduleStatusFromAgent();
        renderAgentQueue();
        if (!currentAgent) setPostingStatus('Posting setup has not been checked yet.', false);
      });
    }
    const freqEl = document.getElementById('commentsFrequencyInput');
    if (freqEl) {
      freqEl.addEventListener('input', updateScheduleUi);
      freqEl.addEventListener('change', updateScheduleUi);
    }
    const timeframeEl = document.getElementById('commentsTimeframeSelect');
    if (timeframeEl) {
      timeframeEl.addEventListener('change', updateScheduleUi);
    }
    const saveAgentBtn = document.getElementById('commentsSaveAgentBtn');
    if (saveAgentBtn) {
      saveAgentBtn.addEventListener('click', () => {
        savePromotionAgent().catch((err) => notify(err.message, true));
      });
    }
    const checkSetupBtn = document.getElementById('commentsCheckSetupBtn');
    if (checkSetupBtn) {
      checkSetupBtn.addEventListener('click', () => {
        checkPostingSetup().catch((err) => {
          setPostingStatus(err.message || 'Could not check posting setup.', true);
          notify(err.message, true);
        });
      });
    }
    const postNowBtn = document.getElementById('commentsPostNowBtn');
    if (postNowBtn) {
      postNowBtn.addEventListener('click', () => {
        postOnDemand().catch((err) => {
          setPostingStatus(err.message || 'Could not post YouTube comment.', true);
          notify(err.message, true);
        });
      });
    }
    const runDueBtn = document.getElementById('commentsRunDueBtn');
    if (runDueBtn) {
      runDueBtn.addEventListener('click', () => {
        runDueAgentsNow().catch((err) => {
          setPostingStatus(err.message || 'Could not run due YouTube agents.', true);
          notify(err.message, true);
        });
      });
    }
    const refreshQueueBtn = document.getElementById('commentsRefreshQueueBtn');
    if (refreshQueueBtn) {
      refreshQueueBtn.addEventListener('click', () => {
        refreshQueue()
          .then(() => notify('Refreshed scheduled YouTube queue'))
          .catch((err) => notify(err.message, true));
      });
    }

    resetHeader();
    updateBackButton();
    renderVideoUrlOptions('');
    renderAgentQueue();
    updateScheduleUi();
    setPostingStatus('Posting setup has not been checked yet.', false);
    setPreview(document.getElementById('commentsActionPreview'), {});
    renderEmptyState('Open a YouTube comment run to review comments here.');
    startQueuePolling();
  }

  return {
    manifest: { id: 'youtubeComments', label: 'YouTube Comments', pageId: 'youtubeCommentsPage' },
    init,
    refresh: async function refresh() {
      await refreshRepositoryVideos();
      await refreshQueue();
    },
    onPageActivated: async function onPageActivated() {
      await refreshRepositoryVideos();
      await refreshQueue();
    },
    openPage,
    openForRun,
  };
})();
