/**
 * public/js/youtubeComments.js
 * Dedicated Comments page — displays individual comments from a
 * acquire_youtube_comments run. Navigated to from the YouTube page.
 */

window.App = window.App || {};
App.youtubeComments = (function () {
  const { state, els, api, notify } = App;

  let currentRunId = null;
  let allComments  = [];
  let currentRun   = null;  // Store run info (title, video_url) for table display
  let sourcePageId = 'acquireYoutubePage';

  const filters = {
    from:    '',
    to:      '',
    search:  '',
    type:    'all',   // 'all' | 'top' | 'reply'
    minLikes: '',
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

  function openPage(options) {
    sourcePageId = String(options?.sourcePage || sourcePageId || 'acquireYoutubePage');
    updateBackButton();
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

    // Search filter
    const searchEl = document.getElementById('commentSearchFilter');
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        filters.search = String(searchEl.value || '');
        renderCommentsTable();
      });
    }

    // Type filter
    const typeEl = document.getElementById('commentTypeFilter');
    if (typeEl) {
      typeEl.addEventListener('change', () => {
        filters.type = String(typeEl.value || 'all');
        renderCommentsTable();
      });
    }

    // Min likes filter
    const likesEl = document.getElementById('commentMinLikesFilter');
    if (likesEl) {
      likesEl.addEventListener('input', () => {
        filters.minLikes = String(likesEl.value || '');
        renderCommentsTable();
      });
    }

    resetHeader();
    updateBackButton();
    renderEmptyState('Open a YouTube comment run to review comments here.');
  }

  return {
    manifest: { id: 'youtubeComments', label: 'YouTube Comments', pageId: 'youtubeCommentsPage' },
    init,
    openPage,
    openForRun,
  };
})();
