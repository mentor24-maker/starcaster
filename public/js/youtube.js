/**
 * public/js/youtube.js
 * YouTube video acquire workflow and run history display.
 */

window.App = window.App || {};
App.youtube = (function () {
  const { state, els, api, notify, setPreview } = App;
  const runFilters = {
    from: '', to: '', title: '', channel: '', category: '', transcript: '',
  };
  const categoryTableState = {
    sort: {
      key: 'category',
      dir: 'asc',
    },
  };
  var selectedRunIds = new Set();
  var currentDetailsRun = null;
  var currentEditRun = null;
  var activeCommentsLoadToken = 0;
  var inlineCommentsCache = [];
  var suggestionLoadToken = 0;
  // Comment run data is still fetched to support "View Comments" behavior
  // (even though we no longer render the comment runs history table on this page).

  function decodeHtmlEntities(input) {
    return String(input || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  function safeText(value) {
    return String(value || '').trim();
  }

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function getYoutubeCategories() {
    return Array.isArray(state.acquireYoutubeCategories) ? state.acquireYoutubeCategories : [];
  }

  function categoryOptions() {
    return getYoutubeCategories()
      .map(function(item) { return safeText(item && item.category); })
      .filter(Boolean);
  }

  function syncSelectOptions(selectEl, placeholder, selected) {
    if (!selectEl) return;
    var chosen = safeText(selected);
    var items = categoryOptions().slice();
    if (chosen && items.indexOf(chosen) < 0) items.push(chosen);
    items.sort(function(a, b) { return a.localeCompare(b); });

    selectEl.innerHTML = '';
    var defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = placeholder;
    selectEl.appendChild(defaultOption);

    items.forEach(function(category) {
      var option = document.createElement('option');
      option.value = category;
      option.textContent = category;
      selectEl.appendChild(option);
    });

    selectEl.value = chosen && items.indexOf(chosen) >= 0 ? chosen : '';
  }

  function renderCategoryControls() {
    var formSelect = document.getElementById('youtubeCategoryInput');
    var currentFormValue = safeText(formSelect && formSelect.value);
    syncSelectOptions(formSelect, 'Select Category', currentFormValue || safeText(currentDetailsRun && currentDetailsRun.category));
    syncSelectOptions(document.getElementById('youtubeRunsCategoryFilter'), 'All Categories', runFilters.category);
    syncSelectOptions(document.getElementById('youtubeRunEditCategory'), 'Select Category', safeText(currentEditRun && currentEditRun.category));
    syncSelectOptions(document.getElementById('youtubeBulkEditCategory'), 'Select Category', safeText(document.getElementById('youtubeBulkEditCategory') && document.getElementById('youtubeBulkEditCategory').value));
  }

  function pruneSelectedRunIds() {
    var validIds = new Set((state.acquireYoutubeDetails || []).map(function(run) { return String(run && run.run_id || '').trim(); }).filter(Boolean));
    Array.from(selectedRunIds).forEach(function(runId) {
      if (!validIds.has(runId)) selectedRunIds.delete(runId);
    });
  }

  function syncBulkSelectionUi() {
    var selectAll = document.getElementById('youtubeRunsSelectAllVisible');
    var bulkBtn = document.getElementById('youtubeRunsBulkEditBtn');
    var visibleIds = getFilteredYoutubeRuns().map(function(run) { return String(run && run.run_id || '').trim(); }).filter(Boolean);
    var selectedVisible = visibleIds.filter(function(runId) { return selectedRunIds.has(runId); });

    if (selectAll) {
      selectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
      selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
    }
    if (bulkBtn) {
      bulkBtn.disabled = selectedRunIds.size === 0;
    }
  }

  function updateBulkEditSummary() {
    var summaryEl = document.getElementById('youtubeBulkEditSummary');
    if (!summaryEl) return;
    summaryEl.textContent = selectedRunIds.size === 1
      ? '1 run selected.'
      : (String(selectedRunIds.size) + ' runs selected.');
  }

  function extractFromXmlTranscript(raw) {
    var chunks = [];
    var regex = /<text[^>]*>([\s\S]*?)<\/text>/gi;
    var match;
    while ((match = regex.exec(String(raw || '')))) {
      var segment = decodeHtmlEntities(match[1]);
      if (segment && segment.trim()) chunks.push(segment.trim());
    }
    return chunks.join(' ').replace(/\s+/g, ' ').trim();
  }

  function transcriptTextFromStructured(value) {
    if (typeof value === 'string') return value.trim();
    if (!value || typeof value !== 'object') return '';

    if (Array.isArray(value)) {
      return value
        .map(function(item) {
          if (typeof item === 'string') return item.trim();
          if (!item || typeof item !== 'object') return '';
          var candidate = item.text || item.snippet || item.content || item.utf8 || '';
          return String(candidate || '').trim();
        })
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    if (typeof value.transcript === 'string') return value.transcript.trim();
    if (Array.isArray(value.transcript)) return transcriptTextFromStructured(value.transcript);
    if (typeof value.text === 'string') return value.text.trim();
    if (Array.isArray(value.text)) return transcriptTextFromStructured(value.text);
    if (Array.isArray(value.captions)) return transcriptTextFromStructured(value.captions);
    if (Array.isArray(value.data)) return transcriptTextFromStructured(value.data);
    if (Array.isArray(value.results)) return transcriptTextFromStructured(value.results);

    if (Array.isArray(value.events)) {
      var eventSegments = value.events
        .map(function(ev) {
          var segs = Array.isArray(ev && ev.segs) ? ev.segs : [];
          return segs.map(function(s) { return String((s && s.utf8) || ''); }).join('').trim();
        })
        .filter(Boolean);
      return eventSegments.join(' ').replace(/\s+/g, ' ').trim();
    }

    return '';
  }

  function parseTranscriptForDisplay(raw) {
    if (raw == null) return '';
    if (typeof raw === 'object') return transcriptTextFromStructured(raw);

    var text = String(raw).trim();
    if (!text) return '';

    if (text.indexOf('<text') >= 0 && text.indexOf('</text>') >= 0) {
      var xmlText = extractFromXmlTranscript(text);
      if (xmlText) return xmlText;
    }

    var first = text.charAt(0);
    if (first === '{' || first === '[' || (first === '"' && text.charAt(text.length - 1) === '"')) {
      try {
        var parsed = JSON.parse(text);
        var structured = transcriptTextFromStructured(parsed);
        if (structured) return structured;
        if (typeof parsed === 'string') return parsed.trim();
      } catch (_) {
        // keep original text fallback
      }
    }

    if (text.indexOf('\\n') >= 0) text = text.replace(/\\n/g, '\n');
    if (text.indexOf('\\"') >= 0) text = text.replace(/\\"/g, '"');
    return decodeHtmlEntities(text).trim();
  }

  function renderVideoTitleLink(video, owner, runMeta) {
    var headingEl = document.getElementById('youtubeVideoTitleHeading');
    var channelLinkEl = document.getElementById('youtubeChannelLink');
    var dashEl = document.getElementById('youtubeHeadingDash');
    var titleLinkEl = document.getElementById('youtubeVideoTitleLink');
    if (!headingEl || !channelLinkEl || !dashEl || !titleLinkEl) return;

    var title = String(video && video.title ? video.title : '').trim();
    var videoUrl = String(video && video.url ? video.url : '').trim()
      || String(runMeta && runMeta.video_url ? runMeta.video_url : '').trim();
    var channelName = String(owner && owner.name ? owner.name : '').trim()
      || String(runMeta && runMeta.channel_name ? runMeta.channel_name : '').trim();
    var channelUrl = String(owner && owner.profile_url ? owner.profile_url : '').trim()
      || String(runMeta && runMeta.channel_url ? runMeta.channel_url : '').trim();

    if (!title && !videoUrl && !channelName) {
      headingEl.classList.add('hidden');
      return;
    }

    if (channelName) {
      channelLinkEl.textContent = channelName;
      channelLinkEl.href = channelUrl || '#';
      channelLinkEl.classList.remove('hidden');
    } else {
      channelLinkEl.textContent = '';
      channelLinkEl.href = '#';
      channelLinkEl.classList.add('hidden');
    }

    titleLinkEl.textContent = title || videoUrl || '-';
    titleLinkEl.href = videoUrl || '#';

    if (channelName && (title || videoUrl)) dashEl.classList.remove('hidden');
    else dashEl.classList.add('hidden');

    headingEl.classList.remove('hidden');
  }

  function setDetailsField(id, value, fallback) {
    var el = document.getElementById(id);
    if (!el) return;
    var text = String(value || '').trim();
    el.textContent = text || String(fallback || '-');
  }

  function formatHashtags(value) {
    if (Array.isArray(value)) {
      var tags = value.map(function(tag) { return String(tag || '').trim(); }).filter(Boolean);
      return tags.length ? tags.join(' ') : '';
    }
    return String(value || '').trim();
  }

  function renderInlineComments(comments, fallback) {
    var el = document.getElementById('youtubeCommentsPreview');
    if (!el) return;
    el.innerHTML = '';
    var rows = Array.isArray(comments) ? comments : [];
    inlineCommentsCache = rows.slice();
    if (!rows.length) {
      el.textContent = String(fallback || 'No comments loaded for this video.');
      return;
    }
    rows.slice(0, 30).forEach(function(comment) {
      var wrap = document.createElement('div');
      wrap.className = 'youtube-comment-item';

      var meta = document.createElement('div');
      meta.className = 'youtube-comment-meta';
      var author = String(comment && comment.author ? comment.author : '').trim() || 'Unknown author';
      var likes = Number(comment && comment.like_count ? comment.like_count : 0) || 0;
      meta.textContent = author + ' - ' + likes.toLocaleString() + ' likes';

      var body = document.createElement('div');
      body.className = 'youtube-detail-text';
      body.textContent = String(comment && comment.text ? comment.text : '').trim() || '-';

      wrap.appendChild(meta);
      wrap.appendChild(body);
      el.appendChild(wrap);
    });
  }

  async function loadInlineCommentsForVideo(videoUrl) {
    var url = String(videoUrl || '').trim();
    if (!url) {
      renderInlineComments([], 'No comments loaded for this video.');
      return;
    }
    var match = (state.acquireYoutubeComments || []).find(function(r) {
      return String(r.video_url || '').trim() === url;
    });
    if (!match || !match.run_id) {
      renderInlineComments([], 'No acquired comments found for this video.');
      return;
    }
    var token = ++activeCommentsLoadToken;
    try {
      var res = await api('/api/acquire/youtube-comment-runs/' + encodeURIComponent(match.run_id));
      if (token !== activeCommentsLoadToken) return;
      var run = res.run || {};
      var result = run.result || run.result_json || {};
      var comments = Array.isArray(result.comments) ? result.comments : [];
      renderInlineComments(comments, 'No comments found in this run.');
    } catch (err) {
      if (token !== activeCommentsLoadToken) return;
      renderInlineComments([], 'Comments could not be loaded.');
    }
  }

  function scrollToYoutubeDetails() {
    var section = document.getElementById('youtubeVideoDetailsSection');
    if (!section) return;
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function scrollToYoutubeTop() {
    var page = document.getElementById('acquireYoutubePage');
    if (page) page.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function getActiveVideoUrl() {
    var fromResult = String(state.youtubeAcquireResult && state.youtubeAcquireResult.video && state.youtubeAcquireResult.video.url || '').trim();
    if (fromResult) return fromResult;
    var fromRun = String(currentDetailsRun && currentDetailsRun.video_url || '').trim();
    if (fromRun) return fromRun;
    if (els.youtubeAcquireForm) {
      var input = els.youtubeAcquireForm.querySelector('[name="video_url"]');
      var fromForm = String(input && input.value || '').trim();
      if (fromForm) return fromForm;
    }
    return '';
  }

  function setCommentSubmitStatus(text, isError) {
    var statusEl = document.getElementById('youtubeCommentSubmitStatus');
    if (!statusEl) return;
    statusEl.textContent = String(text || '');
    statusEl.style.color = isError ? '#b42318' : '#4b5563';
  }

  function setSuggestionStatus(text, isError) {
    var statusEl = document.getElementById('youtubeCommentSuggestionsStatus');
    if (!statusEl) return;
    statusEl.textContent = String(text || '');
    statusEl.style.color = isError ? '#b42318' : '#4b5563';
  }

  function selectedGeneratedComment() {
    var checked = document.querySelector('input[name="youtubeGeneratedComment"]:checked');
    if (!checked) return '';
    return String(checked.value || '').trim();
  }

  function clearGeneratedCommentSelection() {
    var checked = document.querySelector('input[name="youtubeGeneratedComment"]:checked');
    if (checked) checked.checked = false;
  }

  function renderGeneratedCommentOptions(comments) {
    var listEl = document.getElementById('youtubeCommentSuggestionsList');
    if (!listEl) return;
    listEl.innerHTML = '';
    var items = Array.isArray(comments) ? comments : [];
    if (!items.length) return;

    items.forEach(function(text, idx) {
      var row = document.createElement('div');
      row.className = 'youtube-comment-suggestion-item';

      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'youtubeGeneratedComment';
      input.id = 'youtubeGeneratedComment_' + idx;
      input.value = String(text || '');

      var label = document.createElement('label');
      label.setAttribute('for', input.id);
      label.textContent = String(text || '');

      row.appendChild(input);
      row.appendChild(label);
      listEl.appendChild(row);
    });
  }

  async function generateCommentSuggestions(video) {
    var videoObj = video || {};
    var transcriptText = parseTranscriptForDisplay(videoObj.transcript || '');
    var description = String(videoObj.description || '').trim();
    if (!description && !transcriptText) {
      renderGeneratedCommentOptions([]);
      setSuggestionStatus('No description/transcript available for suggestions.', true);
      return;
    }

    var token = ++suggestionLoadToken;
    renderGeneratedCommentOptions([]);
    setSuggestionStatus('Generating 3 comment ideas...', false);
    try {
      var res = await api('/api/acquire/youtube-comment-suggestions', {
        method: 'POST',
        body: JSON.stringify({
          video_url: videoObj.url || getActiveVideoUrl(),
          title: videoObj.title || '',
          channel_name: String(currentDetailsRun && currentDetailsRun.channel_name || ''),
          description: description,
          transcript: transcriptText,
        }),
      });
      if (token !== suggestionLoadToken) return;
      var comments = Array.isArray(res.comments) ? res.comments : [];
      renderGeneratedCommentOptions(comments);
      setSuggestionStatus(comments.length ? 'Choose one, or write your own comment above.' : 'No suggestions generated.', !comments.length);
    } catch (err) {
      if (token !== suggestionLoadToken) return;
      renderGeneratedCommentOptions([]);
      setSuggestionStatus(err.message || 'Could not generate suggestions.', true);
    }
  }

  async function submitYoutubeComment() {
    var inputEl = document.getElementById('youtubeCommentInput');
    var submitBtn = document.getElementById('youtubeCommentSubmitBtn');
    if (!inputEl || !submitBtn) return;

    var typedComment = String(inputEl.value || '').trim();
    var pickedComment = selectedGeneratedComment();
    var commentText = typedComment || pickedComment;
    var videoUrl = getActiveVideoUrl();
    if (!videoUrl) {
      setCommentSubmitStatus('Load or enter a YouTube video first.', true);
      return;
    }
    if (!commentText) {
      setCommentSubmitStatus('Enter a comment before submitting.', true);
      return;
    }

    submitBtn.disabled = true;
    setCommentSubmitStatus('Posting comment...', false);
    try {
      var res = await api('/api/acquire/youtube-comment', {
        method: 'POST',
        body: JSON.stringify({ video_url: videoUrl, comment_text: commentText }),
      });
      var posted = res.comment || {};
      inputEl.value = '';
      clearGeneratedCommentSelection();
      setCommentSubmitStatus('Comment posted.', false);
      notify('YouTube comment posted');

      var newComment = {
        author: posted.author || 'You',
        like_count: 0,
        text: posted.text || commentText,
      };
      var nextComments = [newComment].concat(Array.isArray(inlineCommentsCache) ? inlineCommentsCache : []);
      renderInlineComments(nextComments.slice(0, 30), 'No comments loaded for this video.');
    } catch (err) {
      setCommentSubmitStatus(err.message || 'Could not post comment.', true);
      notify(err.message || 'Could not post comment.', true);
    } finally {
      submitBtn.disabled = false;
    }
  }

  function renderYoutubeAcquireResult() {
    const result = state.youtubeAcquireResult;
    if (!result) {
      setDetailsField('youtubeDescriptionText', '', 'No video loaded yet.');
      setDetailsField('youtubeHashtagsText', '', '-');
      renderVideoTitleLink({}, {}, currentDetailsRun || {});
      if (els.youtubeTranscriptPreview) {
        els.youtubeTranscriptPreview.textContent = 'No transcript loaded yet.';
      }
      setCommentSubmitStatus('', false);
      renderGeneratedCommentOptions([]);
      setSuggestionStatus('', false);
      renderInlineComments([], 'No comments loaded for this video.');
      setPreview(els.youtubeRawPreview, {});
      return;
    }
    const video = result.video || {};
    const owner = result.channel_owner || {};
    setDetailsField('youtubeDescriptionText', video.description, '-');
    setDetailsField('youtubeHashtagsText', formatHashtags(video.hashtags), '-');
    renderVideoTitleLink(video, owner, currentDetailsRun || {});
    if (els.youtubeTranscriptPreview) {
      var transcriptText = parseTranscriptForDisplay(video.transcript);
      els.youtubeTranscriptPreview.textContent = transcriptText || 'Transcript unavailable for this video.';
    }
    setCommentSubmitStatus('', false);
    generateCommentSuggestions(video);
    loadInlineCommentsForVideo(video.url || (currentDetailsRun && currentDetailsRun.video_url) || '');
    setPreview(els.youtubeRawPreview, result);
  }

  function renderYoutubeCommentsResult(result) {
    const comments = Array.isArray(result && result.comments) ? result.comments : [];
    renderVideoTitleLink({
      title: result && result.title ? result.title : '',
      url: result && result.video_url ? result.video_url : ''
    }, {}, currentDetailsRun || {});
    setDetailsField('youtubeDescriptionText', '', '-');
    setDetailsField('youtubeHashtagsText', '', '-');
    if (els.youtubeTranscriptPreview) {
      els.youtubeTranscriptPreview.textContent = 'Comments acquire runs do not include transcript.';
    }
    setCommentSubmitStatus('', false);
    renderGeneratedCommentOptions([]);
    setSuggestionStatus('Load video details to generate comment ideas from transcript/description.', true);
    renderInlineComments(comments, 'No comments loaded for this video.');
    setPreview(els.youtubeRawPreview, result || {});
  }

  function renderYoutubeCommentMinerResult(result) {
    var summaryEl = document.getElementById('youtubeCommentMinerSummary');
    var metaEl = document.getElementById('youtubeCommentMinerMeta');
    var tableEl = document.getElementById('youtubeCommentMinerTable');
    if (!summaryEl || !metaEl || !tableEl) return;

    var stats = result && result.stats ? result.stats : {};
    var comments = toArray(result && result.comments).slice(0, 200);
    var harvestedVideos = Number(stats.harvested_videos || 0) || 0;
    var totalRaw = Number(stats.total_comments_raw || 0) || 0;
    var totalFiltered = Number(stats.total_comments_filtered || 0) || 0;
    summaryEl.textContent = 'Videos harvested: ' + harvestedVideos + ' | Raw comments: ' + totalRaw + ' | Filtered comments: ' + totalFiltered;

    metaEl.textContent = App.prettyJson({
      input: result && result.input ? result.input : {},
      stats: stats,
      category_counts: result && result.category_counts ? result.category_counts : {},
      tag_counts: result && result.tag_counts ? result.tag_counts : {},
      warnings: toArray(result && result.warnings),
      errors: toArray(result && result.errors),
    });

    tableEl.innerHTML = '';
    if (!comments.length) {
      var emptyTr = document.createElement('tr');
      var emptyTd = document.createElement('td');
      emptyTd.colSpan = 7;
      emptyTd.textContent = 'No filtered comments found for current settings.';
      emptyTr.appendChild(emptyTd);
      tableEl.appendChild(emptyTr);
      return;
    }

    comments.forEach(function(row) {
      var tr = document.createElement('tr');

      var scoreTd = document.createElement('td');
      scoreTd.textContent = String(Number(row && row.score || 0) || 0);

      var categoryTd = document.createElement('td');
      categoryTd.textContent = safeText(row && row.category) || '-';

      var tagsTd = document.createElement('td');
      tagsTd.textContent = toArray(row && row.tags).join(', ') || '-';

      var authorTd = document.createElement('td');
      authorTd.textContent = safeText(row && row.author) || '-';

      var videoTd = document.createElement('td');
      var videoTitle = safeText(row && row.video_title) || safeText(row && row.video_id) || '-';
      var videoUrl = safeText(row && row.video_url);
      if (videoUrl) {
        var link = document.createElement('a');
        link.href = videoUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = videoTitle;
        videoTd.appendChild(link);
      } else {
        videoTd.textContent = videoTitle;
      }

      var commentTd = document.createElement('td');
      commentTd.textContent = safeText(row && row.text) || '-';

      var draftTd = document.createElement('td');
      draftTd.textContent = safeText(row && row.reply_draft) || '-';

      tr.appendChild(scoreTd);
      tr.appendChild(categoryTd);
      tr.appendChild(tagsTd);
      tr.appendChild(authorTd);
      tr.appendChild(videoTd);
      tr.appendChild(commentTd);
      tr.appendChild(draftTd);
      tableEl.appendChild(tr);
    });
  }

  function renderYoutubeRunsTable() {
    if (!els.youtubeRunsTable) return;
    els.youtubeRunsTable.innerHTML = '';
    pruneSelectedRunIds();
    var runs = getFilteredYoutubeRuns();
    if (!runs.length) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 8; td.textContent = 'No YouTube runs match current filters.';
      tr.appendChild(td); els.youtubeRunsTable.appendChild(tr);
      syncBulkSelectionUi();
      return;
    }
    runs.forEach(function(run) {
      var tr = document.createElement('tr');

      var selectTd = document.createElement('td');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedRunIds.has(String(run.run_id || ''));
      checkbox.setAttribute('aria-label', 'Select YouTube run ' + String(run.run_id || ''));
      checkbox.addEventListener('change', function() {
        var runId = String(run.run_id || '');
        if (checkbox.checked) selectedRunIds.add(runId);
        else selectedRunIds.delete(runId);
        syncBulkSelectionUi();
      });
      selectTd.appendChild(checkbox);

      var createdTd = document.createElement('td');
      createdTd.textContent = run.created_at ? new Date(run.created_at).toLocaleString() : '-';

      var titleTd = document.createElement('td');
      var titleText = String(run.title || '').trim();
      var videoUrl  = String(run.video_url || '').trim();
      if (videoUrl) {
        var a = document.createElement('a');
        a.href = videoUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.textContent = titleText || '-'; titleTd.appendChild(a);
      } else { titleTd.textContent = titleText || '-'; }

      var channelTd = document.createElement('td');
      var channelText = String(run.channel_name || '').trim();
      var channelUrl  = String(run.channel_url  || '').trim();
      if (channelUrl) {
        var ca = document.createElement('a');
        ca.href = channelUrl; ca.target = '_blank'; ca.rel = 'noopener noreferrer';
        ca.textContent = channelText || '-'; channelTd.appendChild(ca);
      } else { channelTd.textContent = channelText || '-'; }

      var categoryTd = document.createElement('td');
      categoryTd.textContent = safeText(run.category) || '-';

      var tagsTd = document.createElement('td');
      tagsTd.textContent = safeText(run.tags) || '-';

      var transcriptTd = document.createElement('td');
      transcriptTd.textContent = run.transcript_status || 'unavailable';

      var actionsTd = document.createElement('td');
      tr.appendChild(selectTd); tr.appendChild(createdTd); tr.appendChild(titleTd); tr.appendChild(channelTd);
      tr.appendChild(categoryTd); tr.appendChild(tagsTd); tr.appendChild(transcriptTd); tr.appendChild(actionsTd);

      function mkBtn(label, fn) {
        var iconMap = {
          'View': 'view',
          'Edit': 'edit',
          'Add Contact': 'contact',
          'View Comments': 'comments',
          'Acquire Comments': 'comments',
          'Delete': 'delete'
        };
        return App.makeIconButton(iconMap[label] || 'view', label, fn, {
          primary: label === 'View Comments',
          danger: label === 'Delete'
        });
      }
      
      function findCommentRunForVideoUrl(videoUrl) {
        var url = String(videoUrl || '').trim();
        if (!url) return null;
        return (state.acquireYoutubeComments || []).find(function(r) {
          return String(r.video_url || '').trim() === url;
        }) || null;
      }

      var viewBtn         = mkBtn('View',            function() { loadYoutubeRun(run.run_id).catch(function(e) { notify(e.message, true); }); });
      var editBtn         = mkBtn('Edit',            function() { openEditRun(run.run_id).catch(function(e) { notify(e.message, true); }); });
      var addBtn          = mkBtn('Add Contact',      function() { addContactFromRun(run.run_id).catch(function(e) { notify(e.message, true); }); });
      
      var commentMatch = findCommentRunForVideoUrl(run.video_url);
      var commentsBtnLabel = commentMatch ? 'View Comments' : 'Acquire Comments';
      var commentsBtn = mkBtn(commentsBtnLabel, function() {
        if (commentMatch) {
          App.youtubeComments.openForRun(commentMatch);
          return;
        }
        harvestCommentsFromRun(run)
          .then(function() { return refreshCommentRuns(50); })
          .then(function() { renderYoutubeRunsTable(); })
          .catch(function(e) { notify(e.message, true); });
      });
      if (commentMatch) {
        commentsBtn.classList.add('tiny-btn-blue');
      }
      var delBtn          = mkBtn('Delete',           function() {
        if (!confirm('Delete YouTube run ' + run.run_id + '?')) return;
        deleteYoutubeRun(run.run_id).catch(function(e) { notify(e.message, true); });
      });

      editBtn.style.marginLeft = '8px';
      addBtn.style.marginLeft = '8px';
      commentsBtn.style.marginLeft = '8px';
      delBtn.style.marginLeft = '8px';
      actionsTd.appendChild(viewBtn); actionsTd.appendChild(editBtn); actionsTd.appendChild(addBtn);
      actionsTd.appendChild(commentsBtn);
      actionsTd.appendChild(delBtn);
      els.youtubeRunsTable.appendChild(tr);
    });
    syncBulkSelectionUi();
  }

  function toLocalDateKey(input) {
    if (!input) return '';
    var d = new Date(input);
    if (isNaN(d.getTime())) return '';
    var y   = d.getFullYear();
    var m   = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function normalizeFilterDate(input) {
    var raw = String(input || '').trim();
    if (!raw) return '';
    var iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) {
      var y = Number(iso[1]); var m = Number(iso[2]); var d = Number(iso[3]);
      if (y >= 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31)
        return String(y).padStart(4,'0') + '-' + String(m).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    }
    var us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (us) {
      var um = Number(us[1]); var ud = Number(us[2]); var uy = Number(us[3]);
      if (uy < 100) uy += 2000;
      if (uy >= 1900 && um >= 1 && um <= 12 && ud >= 1 && ud <= 31)
        return String(uy).padStart(4,'0') + '-' + String(um).padStart(2,'0') + '-' + String(ud).padStart(2,'0');
    }
    var parsed = new Date(raw);
    if (isNaN(parsed.getTime())) return '';
    return toLocalDateKey(parsed.toISOString());
  }

  function getFilteredYoutubeRuns() {
    var from       = normalizeFilterDate(runFilters.from);
    var to         = normalizeFilterDate(runFilters.to);
    var title      = String(runFilters.title      || '').trim().toLowerCase();
    var channel    = String(runFilters.channel    || '').trim().toLowerCase();
    var category   = String(runFilters.category   || '').trim().toLowerCase();
    var transcript = String(runFilters.transcript || '').trim().toLowerCase();
    return (state.acquireYoutubeDetails || []).filter(function(run) {
      var runDate       = toLocalDateKey(run.created_at);
      var runTitle      = String(run.title || '').toLowerCase();
      var runChannel    = String(run.channel_name || '').toLowerCase();
      var runCategory   = String(run.category || '').toLowerCase();
      var runTranscript = String(run.transcript_status || 'unavailable').toLowerCase();
      if (from && runDate && runDate < from)           return false;
      if (to   && runDate && runDate > to)             return false;
      if (title      && runTitle.indexOf(title) < 0)  return false;
      if (channel    && runChannel.indexOf(channel) < 0) return false;
      if (category   && runCategory !== category)     return false;
      if (transcript && runTranscript !== transcript)  return false;
      return true;
    });
  }

  async function refreshYoutubeRuns(limit) {
    if (!els.youtubeRunsTable) return;
    var safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
    var res = await api('/api/acquire/youtube-runs?limit=' + safeLimit);
    state.acquireYoutubeDetails = Array.isArray(res.runs) ? res.runs : [];
    renderYoutubeRunsTable();
  }

  async function refreshCommentRuns(limit) {
    var safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
    var res = await api('/api/acquire/youtube-comment-runs?limit=' + safeLimit);
    state.acquireYoutubeComments = Array.isArray(res.runs) ? res.runs : [];
    // Comment runs affect whether the main runs table shows "Acquire" vs "View"
    renderYoutubeRunsTable();
  }

  function getSortedYoutubeCategories() {
    var items = getYoutubeCategories().slice();
    items.sort(function(a, b) {
      var left = safeText(a && a.category).toLowerCase();
      var right = safeText(b && b.category).toLowerCase();
      if (left === right) return 0;
      var result = left < right ? -1 : 1;
      return categoryTableState.sort.dir === 'asc' ? result : -result;
    });
    return items;
  }

  function renderYoutubeCategoriesTable() {
    var tbody = document.getElementById('youtubeCategoriesTable');
    var sortBtn = document.getElementById('youtubeCategoriesSortCategory');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (sortBtn) {
      sortBtn.textContent = 'Category' + (categoryTableState.sort.dir === 'asc' ? ' ▲' : ' ▼');
    }

    getSortedYoutubeCategories().forEach(function(item) {
      var tr = document.createElement('tr');

      var categoryTd = document.createElement('td');
      categoryTd.textContent = safeText(item && item.category) || '-';

      var actionsTd = document.createElement('td');
      var viewBtn = App.makeIconButton('view', 'View Category', function() {
        runFilters.category = safeText(item && item.category);
        renderCategoryControls();
        renderYoutubeRunsTable();
        App.setActivePage('acquireYoutubePage');
      });
      var editBtn = App.makeIconButton('edit', 'Edit Category', function() {
        var form = document.getElementById('youtubeCategoryEditForm');
        var idInput = document.getElementById('youtubeCategoryEditId');
        if (!form || !idInput) return notify('Category form is unavailable', true);
        form.reset();
        idInput.value = String(item.id || '');
        form.category.value = safeText(item && item.category);
        App.setActivePage('editYoutubeCategoryPage');
      }, { marginLeft: '8px' });
      var deleteBtn = App.makeIconButton('delete', 'Delete Category', function() {
        if (!item || !item.id) return notify('Category id is missing', true);
        if (!confirm('Delete category "' + safeText(item.category) + '"?')) return;
        api('/api/acquire/youtube-categories/' + encodeURIComponent(item.id), { method: 'DELETE' })
          .then(function() {
            if (runFilters.category === safeText(item.category)) {
              runFilters.category = '';
            }
            if (currentDetailsRun && safeText(currentDetailsRun.category) === safeText(item.category)) {
              currentDetailsRun.category = '';
            }
            notify('Category deleted');
            return refreshYoutubeCategories();
          })
          .then(function() { renderYoutubeRunsTable(); })
          .catch(function(err) { notify(err.message, true); });
      }, { danger: true, marginLeft: '8px' });

      actionsTd.appendChild(viewBtn);
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);

      tr.appendChild(categoryTd);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });

    if (!tbody.children.length) {
      var emptyTr = document.createElement('tr');
      var emptyTd = document.createElement('td');
      emptyTd.colSpan = 2;
      emptyTd.textContent = 'No YouTube categories have been created yet.';
      emptyTr.appendChild(emptyTd);
      tbody.appendChild(emptyTr);
    }
  }

  async function refreshYoutubeCategories() {
    var res = await api('/api/acquire/youtube-categories');
    state.acquireYoutubeCategories = Array.isArray(res.categories) ? res.categories : [];
    renderCategoryControls();
    renderYoutubeCategoriesTable();
  }

  async function openEditRun(runId) {
    var id = safeText(runId);
    if (!id) return notify('Run id is required', true);
    var res = await api('/api/acquire/youtube-runs/' + encodeURIComponent(id));
    var run = res.run || null;
    if (!run) return notify('Run not found', true);

    currentEditRun = run;
    var form = document.getElementById('youtubeRunEditForm');
    var idInput = document.getElementById('youtubeRunEditId');
    var urlInput = document.getElementById('youtubeRunEditVideoUrl');
    var titleInput = document.getElementById('youtubeRunEditTitle');
    var categoryInput = document.getElementById('youtubeRunEditCategory');
    var tagsInput = document.getElementById('youtubeRunEditTags');
    var captureWrap = document.getElementById('youtubeRunEditCaptureWrap');
    var captureInput = document.getElementById('youtubeRunEditCaptureContact');
    var transcriptBtn = document.getElementById('youtubeRunEditTranscriptBtn');

    if (form) form.reset();
    if (idInput) idInput.value = id;
    if (urlInput) urlInput.value = safeText(run.video_url);
    if (titleInput) titleInput.value = safeText(run.title);
    renderCategoryControls();
    if (categoryInput) categoryInput.value = safeText(run.category);
    if (tagsInput) tagsInput.value = safeText(run.tags);

    var contactCaptured = run.contact_captured === true;
    if (captureWrap) captureWrap.classList.toggle('hidden', contactCaptured);
    if (captureInput) captureInput.checked = false;

    var transcriptMissing = safeText(run.transcript_status).toLowerCase() !== 'found';
    if (transcriptBtn) transcriptBtn.classList.toggle('hidden', !transcriptMissing);

    App.setActivePage('editYoutubeRunPage');
  }

  function openBulkEditPage() {
    if (!selectedRunIds.size) {
      notify('Select at least one YouTube run first', true);
      return;
    }
    updateBulkEditSummary();
    renderCategoryControls();
    var selectEl = document.getElementById('youtubeBulkEditCategory');
    if (selectEl) selectEl.value = '';
    App.setActivePage('bulkEditYoutubeRunsPage');
  }

  async function loadYoutubeRun(runId) {
    var res = await api('/api/acquire/youtube-runs/' + encodeURIComponent(runId));
    var run = res.run || null;
    currentDetailsRun = run;
    state.youtubeAcquireResult = run && run.result ? run.result : null;
    if (run && run.video_url && els.youtubeAcquireForm) {
      var input = els.youtubeAcquireForm.querySelector('[name="video_url"]');
      if (input) input.value = run.video_url;
      var categoryInput = els.youtubeAcquireForm.querySelector('[name="category"]');
      if (categoryInput) categoryInput.value = safeText(run && run.category);
    }
    renderCategoryControls();
    renderYoutubeAcquireResult();
    scrollToYoutubeDetails();
    notify('Loaded YouTube run ' + runId);
  }

  async function deleteYoutubeRun(runId) {
    await api('/api/acquire/youtube-runs/' + encodeURIComponent(runId), { method: 'DELETE' });
    await refreshYoutubeRuns();
    notify('YouTube run deleted (' + runId + ')');
  }

  async function deleteCommentRun(runId) {
    await api('/api/acquire/youtube-comment-runs/' + encodeURIComponent(runId), { method: 'DELETE' });
    await refreshCommentRuns();
    notify('Comment run deleted (' + runId + ')');
  }

  async function addContactFromRun(runId) {
    var res = await api('/api/acquire/youtube-runs/' + encodeURIComponent(runId) + '/add-contact', {
      method: 'POST', body: JSON.stringify({}),
    });
    await refreshYoutubeRuns(20);
    var capture = res.contactCapture || {};
    var mode = String(capture.mode || 'updated');
    if (mode === 'created')       notify('Contact created from YouTube run');
    else if (mode === 'existing') notify('Contact already existed');
    else                          notify('Contact updated from YouTube run');
  }

  async function harvestCommentsFromRun(run) {
    var videoUrl = String(run && run.video_url ? run.video_url : '').trim();
    if (!videoUrl) throw new Error('This run has no video URL to acquire comments from.');
    var res = await api('/api/acquire/youtube-comments', {
      method: 'POST', body: JSON.stringify({ video_url: videoUrl }),
    });
    currentDetailsRun = run || currentDetailsRun;
    renderYoutubeCommentsResult(res.result || {});
    var total = Number(res.result && res.result.stats ? res.result.stats.total_comments : 0) || 0;
    notify('YouTube comments acquire complete (' + total + ' comments)');
    await refreshCommentRuns();
    renderYoutubeRunsTable();
  }

  async function viewCommentsForRun(detailsRun) {
    var videoUrl = String(detailsRun && detailsRun.video_url ? detailsRun.video_url : '').trim();
    if (!videoUrl) { notify('No video URL on this run', true); return; }
    await refreshCommentRuns();
    var match = (state.acquireYoutubeComments || []).find(function(r) {
      return String(r.video_url || '').trim() === videoUrl;
    });
    if (!match) {
      notify('No comment acquire run found for this video. Use Acquire Comments first.', true);
      return;
    }
    App.youtubeComments.openForRun(match);
  }

  function init() {
    var topBtn = document.getElementById('youtubeDetailsTopBtn');
    var openCategoriesBtn = document.getElementById('youtubeCategoriesOpenBtn');
    var openCreateBtn = document.getElementById('openCreateYoutubeCategoryPageBtn');
    var backToYoutubeBtn = document.getElementById('backToYoutubePageBtn');
    var backToCategoriesBtn = document.getElementById('backToYoutubeCategoriesBtn');
    var backFromEditBtn = document.getElementById('backFromEditYoutubeCategoryBtn');
    var sortCategoryBtn = document.getElementById('youtubeCategoriesSortCategory');
    var youtubeCategoryForm = document.getElementById('youtubeCategoryForm');
    var youtubeCategoryEditForm = document.getElementById('youtubeCategoryEditForm');
    var selectAllRuns = document.getElementById('youtubeRunsSelectAllVisible');
    var bulkEditBtn = document.getElementById('youtubeRunsBulkEditBtn');
    var backFromEditRunBtn = document.getElementById('backFromEditYoutubeRunBtn');
    var backFromBulkEditBtn = document.getElementById('backFromBulkEditYoutubeRunsBtn');
    var youtubeRunEditForm = document.getElementById('youtubeRunEditForm');
    var youtubeBulkEditForm = document.getElementById('youtubeBulkEditForm');
    var transcriptBtn = document.getElementById('youtubeRunEditTranscriptBtn');

    if (topBtn) {
      topBtn.addEventListener('click', scrollToYoutubeTop);
    }
    if (openCategoriesBtn) {
      openCategoriesBtn.addEventListener('click', function() {
        renderYoutubeCategoriesTable();
        App.setActivePage('youtubeCategoriesPage');
      });
    }
    if (openCreateBtn) {
      openCreateBtn.addEventListener('click', function() {
        if (youtubeCategoryForm) youtubeCategoryForm.reset();
        App.setActivePage('createYoutubeCategoryPage');
      });
    }
    if (backToYoutubeBtn) {
      backToYoutubeBtn.addEventListener('click', function() {
        App.setActivePage('acquireYoutubePage');
      });
    }
    if (backToCategoriesBtn) {
      backToCategoriesBtn.addEventListener('click', function() {
        App.setActivePage('youtubeCategoriesPage');
      });
    }
    if (backFromEditBtn) {
      backFromEditBtn.addEventListener('click', function() {
        App.setActivePage('youtubeCategoriesPage');
      });
    }
    if (sortCategoryBtn) {
      sortCategoryBtn.addEventListener('click', function() {
        categoryTableState.sort.dir = categoryTableState.sort.dir === 'asc' ? 'desc' : 'asc';
        renderYoutubeCategoriesTable();
      });
    }
    if (selectAllRuns) {
      selectAllRuns.addEventListener('change', function() {
        getFilteredYoutubeRuns().forEach(function(run) {
          var runId = safeText(run && run.run_id);
          if (!runId) return;
          if (selectAllRuns.checked) selectedRunIds.add(runId);
          else selectedRunIds.delete(runId);
        });
        renderYoutubeRunsTable();
      });
    }
    if (bulkEditBtn) {
      bulkEditBtn.addEventListener('click', openBulkEditPage);
    }
    if (backFromEditRunBtn) {
      backFromEditRunBtn.addEventListener('click', function() {
        App.setActivePage('acquireYoutubePage');
      });
    }
    if (backFromBulkEditBtn) {
      backFromBulkEditBtn.addEventListener('click', function() {
        App.setActivePage('acquireYoutubePage');
      });
    }
    var submitCommentBtn = document.getElementById('youtubeCommentSubmitBtn');
    if (submitCommentBtn) {
      submitCommentBtn.addEventListener('click', function() {
        submitYoutubeComment().catch(function(e) { notify(e.message, true); });
      });
    }

    if (els.youtubeAcquireForm) {
      els.youtubeAcquireForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        try {
          var formData = new FormData(els.youtubeAcquireForm);
          var action = String(e.submitter && e.submitter.dataset && e.submitter.dataset.acquireAction ? e.submitter.dataset.acquireAction : 'details').toLowerCase();
          var selectedCategory = String(formData.get('category') || '').trim();
          var payload = {
            capture_contact: formData.get('capture_contact') === 'on',
            video_url: String(formData.get('video_url') || '').trim(),
            category: selectedCategory
          };
          if (action === 'comments') {
            var res = await api('/api/acquire/youtube-comments', { method: 'POST', body: JSON.stringify(payload) });
            currentDetailsRun = { video_url: payload.video_url, category: selectedCategory };
            renderYoutubeCommentsResult(res.result || {});
            var total = Number(res.result && res.result.stats ? res.result.stats.total_comments : 0) || 0;
            notify('YouTube comments acquire complete (' + total + ' comments)');
            await refreshCommentRuns();
          } else {
            var dres = await api('/api/acquire/youtube', { method: 'POST', body: JSON.stringify(payload) });
            currentDetailsRun = dres.run || { video_url: payload.video_url, category: selectedCategory };
            state.youtubeAcquireResult = dres.result || null;
            renderCategoryControls();
            renderYoutubeAcquireResult();
            await refreshYoutubeRuns();
            var capture = dres.contactCapture || null;
            if (capture) {
              var mode = String(capture.mode || 'updated');
              if (mode === 'created')       notify('YouTube acquire complete. Contact created.');
              else if (mode === 'existing') notify('YouTube acquire complete. Contact already existed.');
              else                          notify('YouTube acquire complete. Contact updated.');
            } else {
              notify('YouTube acquire complete');
            }
          }
        } catch (err) { notify(err.message, true); }
      });
    }

    var youtubeCommentMinerForm = document.getElementById('youtubeCommentMinerForm');
    if (youtubeCommentMinerForm) {
      youtubeCommentMinerForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        var submitBtn = document.getElementById('youtubeCommentMinerSubmitBtn');
        try {
          var formData = new FormData(youtubeCommentMinerForm);
          var payload = {
            targets_text: String(formData.get('targets') || '').trim(),
            videos_per_channel: Number(formData.get('videos_per_channel') || 5) || 5,
            max_comments_per_video: Number(formData.get('max_comments_per_video') || 100) || 100,
            min_score: Number(formData.get('min_score') || 3) || 3,
            sort_by: String(formData.get('sort_by') || 'relevance'),
            include_replies: formData.get('include_replies') === 'on',
            exclude_noise: formData.get('exclude_noise') === 'on',
          };
          if (!payload.targets_text) throw new Error('Add at least one video/channel target.');
          if (submitBtn) submitBtn.disabled = true;
          var res = await api('/api/acquire/youtube-comments/miner', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          var result = res.result || {};
          renderYoutubeCommentMinerResult(result);
          notify('YouTube Comment Miner complete (' + String(Number(result?.stats?.total_comments_filtered || 0) || 0) + ' filtered comments)');
        } catch (err) {
          notify(err.message, true);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }

    if (youtubeRunEditForm) {
      youtubeRunEditForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var formData = new FormData(youtubeRunEditForm);
        var runId = safeText(formData.get('run_id'));
        if (!runId) return notify('Run id is required', true);

        var category = safeText(formData.get('category'));
        var tags = safeText(formData.get('tags'));
        var shouldCaptureContact = formData.get('capture_contact') === 'on';

        api('/api/acquire/youtube-runs/' + encodeURIComponent(runId), {
          method: 'PATCH',
          body: JSON.stringify({ category: category, tags: tags }),
        }).then(function() {
          if (!shouldCaptureContact) return null;
          return api('/api/acquire/youtube-runs/' + encodeURIComponent(runId) + '/add-contact', {
            method: 'POST',
            body: JSON.stringify({}),
          });
        }).then(function() {
          notify('YouTube run updated');
          return Promise.all([refreshYoutubeRuns(20), refreshYoutubeCategories()]);
        }).then(function() {
          return openEditRun(runId);
        }).catch(function(err) {
          notify(err.message, true);
        });
      });
    }

    if (transcriptBtn) {
      transcriptBtn.addEventListener('click', function() {
        var runId = safeText(currentEditRun && currentEditRun.run_id);
        if (!runId) return notify('Run id is required', true);
        transcriptBtn.disabled = true;
        api('/api/acquire/youtube-runs/' + encodeURIComponent(runId) + '/refresh-transcript', {
          method: 'POST',
          body: JSON.stringify({}),
        }).then(function() {
          notify('Transcript refreshed');
          return refreshYoutubeRuns(20);
        }).then(function() {
          return openEditRun(runId);
        }).catch(function(err) {
          notify(err.message, true);
        }).finally(function() {
          transcriptBtn.disabled = false;
        });
      });
    }

    if (youtubeBulkEditForm) {
      youtubeBulkEditForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var formData = new FormData(youtubeBulkEditForm);
        var category = safeText(formData.get('category'));
        var tags = safeText(formData.get('tags'));
        if (!category && !tags) return notify('Enter a category, tags, or both', true);

        var runIds = Array.from(selectedRunIds);
        if (!runIds.length) return notify('Select at least one YouTube run first', true);

        Promise.all(runIds.map(function(runId) {
          return api('/api/acquire/youtube-runs/' + encodeURIComponent(runId), {
            method: 'PATCH',
            body: JSON.stringify({ category: category, tags: tags }),
          });
        })).then(function() {
          notify('YouTube runs updated');
          return refreshYoutubeRuns(20);
        }).then(function() {
          App.setActivePage('acquireYoutubePage');
        }).catch(function(err) {
          notify(err.message, true);
        });
      });
    }

    if (youtubeCategoryForm) {
      youtubeCategoryForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var formData = new FormData(youtubeCategoryForm);
        var payload = { category: String(formData.get('category') || '').trim() };
        api('/api/acquire/youtube-categories', {
          method: 'POST',
          body: JSON.stringify(payload),
        }).then(function() {
          notify('Category created');
          youtubeCategoryForm.reset();
          return refreshYoutubeCategories();
        }).then(function() {
          App.setActivePage('youtubeCategoriesPage');
        }).catch(function(err) {
          notify(err.message, true);
        });
      });
    }

    if (youtubeCategoryEditForm) {
      youtubeCategoryEditForm.addEventListener('submit', function(e) {
        e.preventDefault();
        var formData = new FormData(youtubeCategoryEditForm);
        var categoryId = Number(formData.get('id') || 0) || 0;
        if (!categoryId) return notify('Category id is required', true);
        var payload = { category: String(formData.get('category') || '').trim() };
        api('/api/acquire/youtube-categories/' + encodeURIComponent(categoryId), {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }).then(function() {
          notify('Category updated');
          youtubeCategoryEditForm.reset();
          return refreshYoutubeCategories();
        }).then(function() {
          App.setActivePage('youtubeCategoriesPage');
        }).catch(function(err) {
          notify(err.message, true);
        });
      });
    }

    function bindFilter(id, obj, key, renderFn) {
      var el = document.getElementById(id);
      if (!el) return;
      var evt = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(evt, function() { obj[key] = String(el.value || ''); renderFn(); });
    }

    bindFilter('youtubeRunsFromDate',         runFilters,        'from',       renderYoutubeRunsTable);
    bindFilter('youtubeRunsToDate',           runFilters,        'to',         renderYoutubeRunsTable);
    bindFilter('youtubeRunsTitleFilter',      runFilters,        'title',      renderYoutubeRunsTable);
    bindFilter('youtubeRunsChannelFilter',    runFilters,        'channel',    renderYoutubeRunsTable);
    bindFilter('youtubeRunsCategoryFilter',   runFilters,        'category',   renderYoutubeRunsTable);
    bindFilter('youtubeRunsTranscriptFilter', runFilters,        'transcript', renderYoutubeRunsTable);
    renderCategoryControls();
    renderYoutubeCategoriesTable();
    syncBulkSelectionUi();
  }

  return {
    manifest: { id: 'youtube', label: 'YouTube Acquire', pageId: 'acquireYoutubePage' },
    init,
    refresh:         function() { return Promise.all([refreshYoutubeRuns(20), refreshCommentRuns(20), refreshYoutubeCategories()]); },
    onPageActivated: function() { return Promise.all([refreshYoutubeRuns(20), refreshCommentRuns(20), refreshYoutubeCategories()]); },
    refreshYoutubeRuns,
    refreshCommentRuns,
    refreshYoutubeCategories,
    renderYoutubeAcquireResult,
  };
})();
