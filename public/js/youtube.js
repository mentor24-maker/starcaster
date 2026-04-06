/**
 * public/js/youtube.js
 * YouTube video acquire workflow and run history display.
 */

window.App = window.App || {};
App.youtube = (function () {
  const { state, els, api, notify, setPreview } = App;
  const runFilters = {
    from: '', to: '', title: '', channel: '', category: '', tags: '', transcript: '',
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
  var youtubeMinerMode = 'training';
  var activeVideoSnapshot = null;
  var youtubeMinerRunDetails = [];
  var youtubeMinerCategoryConfig = [];
  var youtubeMinerAttributeConfig = [];
  var youtubeMinerApproachConfig = [];
  var youtubeMinerCategorySelectedIds = new Set();
  var youtubeMinerAttributeSelectedIds = new Set();
  var youtubeMinerApproachSelectedIds = new Set();
  var youtubeMinerCategoryEditingIds = new Set();
  var youtubeMinerAttributeEditingIds = new Set();
  var youtubeMinerApproachEditingIds = new Set();
  var youtubeMinerRuleGuideRows = [];
  var youtubeMinerRuleGuideSelectedIds = new Set();
  var youtubeMinerRuleGuideEditingIds = new Set();
  var youtubeMinerLastResult = null;
  var YT_MINER_CATEGORY_CONFIG_KEY = 'yt_miner_category_config_v1';
  var YT_MINER_ATTRIBUTE_CONFIG_KEY = 'yt_miner_attribute_config_v1';
  var YT_MINER_APPROACH_CONFIG_KEY = 'yt_miner_approach_config_v1';
  var YT_MINER_RESPONSE_CONTEXT_KEY = 'yt_miner_response_context_v1';
  var YT_MINER_RESPONSE_GUIDELINES_KEY = 'yt_miner_response_guidelines_v1';
  var YT_MINER_LAST_RESULT_KEY = 'yt_miner_last_result_v1';
  var YT_MINER_LAST_INPUT_KEY = 'yt_miner_last_input_v1';
  var YT_RESEARCH_LAST_RESULT_KEY = 'yt_research_last_result_v1';
  var YT_ACTIVE_VIDEO_KEY = 'yt_active_video_v1';
  var YT_MINER_FEEDBACK_KEY_PREFIX = 'yt_miner_feedback:';
  var YT_MINER_RULE_GUIDES_KEY = 'yt_miner_rules_guides_v1';
  var youtubeMinerContextSaveTimer = null;
  var youtubeMinerConfigSaveTimers = {
    category: null,
    attribute: null,
    approach: null,
    ruleGuide: null,
  };
  var youtubeMinerContextSaving = false;
  var youtubeResearchLastResult = null;
  var youtubeResearchMessagingCache = null;
  var selectedResearchTargetUrls = new Set();
  var youtubeResearchTableSort = {
    key: 'view_count',
    dir: 'desc',
  };
  var youtubeResearchHoverPreviewEl = null;
  var youtubeMinerTargetHistory = [];
  var selectedCommentRowIds = new Set();
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

  function formatDateTime(value) {
    var raw = safeText(value);
    if (!raw) return '-';
    var parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleString();
  }

  function formatInteger(value) {
    var num = Number(value || 0) || 0;
    return num.toLocaleString();
  }

  function compareTextSort(left, right) {
    return safeText(left).localeCompare(safeText(right), undefined, { sensitivity: 'base' });
  }

  function truncateWords(value, maxLength) {
    var text = safeText(value);
    var limit = Math.max(0, Number(maxLength) || 0);
    if (!text || !limit || text.length <= limit) return text;
    var slice = text.slice(0, limit + 1);
    var lastSpace = slice.lastIndexOf(' ');
    var cutoff = lastSpace >= Math.floor(limit * 0.6) ? lastSpace : limit;
    return safeText(text.slice(0, cutoff)) + '...';
  }

  function getYoutubeResearchSortValue(row, key) {
    if (!row || !key) return '';
    if (key === 'view_count' || key === 'like_count' || key === 'comment_count') {
      return Number(row[key] || 0) || 0;
    }
    return safeText(row[key]);
  }

  function ensureYoutubeResearchHoverPreview() {
    if (youtubeResearchHoverPreviewEl && document.body.contains(youtubeResearchHoverPreviewEl)) {
      return youtubeResearchHoverPreviewEl;
    }
    var el = document.createElement('div');
    el.className = 'youtube-research-hover-preview hidden';
    document.body.appendChild(el);
    youtubeResearchHoverPreviewEl = el;
    return el;
  }

  function hideYoutubeResearchHoverPreview() {
    var el = ensureYoutubeResearchHoverPreview();
    el.classList.add('hidden');
    el.innerHTML = '';
  }

  function positionYoutubeResearchHoverPreview(clientX, clientY) {
    var el = ensureYoutubeResearchHoverPreview();
    if (el.classList.contains('hidden')) return;
    var offset = 18;
    var width = el.offsetWidth || 360;
    var height = el.offsetHeight || 220;
    var left = clientX + offset;
    var top = clientY + offset;
    if (left + width > window.innerWidth - 12) left = Math.max(12, clientX - width - offset);
    if (top + height > window.innerHeight - 12) top = Math.max(12, clientY - height - offset);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  function showYoutubeResearchHoverPreview(row, event) {
    var el = ensureYoutubeResearchHoverPreview();
    var thumbnailUrl = safeText(row && row.thumbnail_url);
    var description = safeText(row && row.description) || 'No description available.';
    var title = safeText(row && row.title) || safeText(row && row.video_url) || 'Video preview';
    el.innerHTML = '';
    var card = document.createElement('div');
    card.className = 'youtube-research-hover-preview-card';
    if (thumbnailUrl) {
      var img = document.createElement('img');
      img.src = thumbnailUrl;
      img.alt = title;
      card.appendChild(img);
    }
    var titleEl = document.createElement('div');
    titleEl.className = 'youtube-research-hover-preview-title';
    titleEl.textContent = title;
    card.appendChild(titleEl);
    var descriptionEl = document.createElement('div');
    descriptionEl.className = 'youtube-research-hover-preview-description';
    descriptionEl.textContent = truncateWords(description, 320) || 'No description available.';
    card.appendChild(descriptionEl);
    el.appendChild(card);
    el.classList.remove('hidden');
    positionYoutubeResearchHoverPreview(event.clientX, event.clientY);
  }

  function parseSimpleTagList(value) {
    return String(value || '')
      .split(/[,\n]/g)
      .map(function(item) { return safeText(item); })
      .filter(Boolean);
  }

  function extractYoutubeBanReasonFromTags(value) {
    var token = parseSimpleTagList(value).find(function(item) {
      return safeText(item).toLowerCase().indexOf('ban_reason:') === 0;
    });
    return token ? safeText(token.split(':')[1]) : '';
  }

  function buildYoutubeBanTags(existingTags, reason) {
    var tokens = parseSimpleTagList(existingTags).filter(function(item) {
      var lower = safeText(item).toLowerCase();
      return lower !== 'banned' && lower.indexOf('ban_reason:') !== 0;
    });
    var nextReason = safeText(reason).toLowerCase();
    if (nextReason) {
      tokens.push('banned');
      tokens.push('ban_reason:' + nextReason);
    }
    return Array.from(new Set(tokens)).join(', ');
  }

  function slugifyYoutubeBanReasonLabel(label) {
    return safeText(label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function getYoutubeBanReasonOptions() {
    var defaults = ['Corporate', 'Personal', 'Not Serious', 'Low Volume', 'AI Slop'];
    var fromSettings = typeof App.getAcquireYoutubeBanReasons === 'function'
      ? App.getAcquireYoutubeBanReasons()
      : defaults;
    var labels = Array.from(new Set(toArray(fromSettings).map(function(item) {
      return safeText(item);
    }).filter(Boolean)));
    if (!labels.length) labels = defaults.slice();
    return labels.map(function(label) {
      return {
        value: slugifyYoutubeBanReasonLabel(label),
        label: label,
      };
    });
  }

  function isYoutubeVideoBannedFromTags(value) {
    return parseSimpleTagList(value).some(function(item) {
      var lower = safeText(item).toLowerCase();
      return lower === 'banned' || lower.indexOf('ban_reason:') === 0;
    });
  }

  function extractYoutubeVideoId(value) {
    var raw = safeText(value);
    if (!raw) return '';
    if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
    try {
      var url = new URL(raw);
      var host = String(url.hostname || '').toLowerCase();
      if (host.indexOf('youtu.be') >= 0) {
        var shortId = safeText(url.pathname.split('/').filter(Boolean)[0]);
        return /^[A-Za-z0-9_-]{11}$/.test(shortId) ? shortId : '';
      }
      var queryId = safeText(url.searchParams.get('v'));
      if (/^[A-Za-z0-9_-]{11}$/.test(queryId)) return queryId;
      var parts = url.pathname.split('/').filter(Boolean);
      var embedIndex = parts.indexOf('embed');
      if (embedIndex >= 0 && /^[A-Za-z0-9_-]{11}$/.test(safeText(parts[embedIndex + 1]))) {
        return safeText(parts[embedIndex + 1]);
      }
    } catch (_) {
      return '';
    }
    return '';
  }

  function makeYoutubeVideoRecordId(videoId, videoUrl) {
    var stableId = safeText(videoId) || extractYoutubeVideoId(videoUrl);
    if (stableId) return 'ytvideo_' + stableId;
    var url = safeText(videoUrl);
    if (!url) return '';
    try {
      return 'ytvideo_url_' + btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '').slice(0, 48);
    } catch (_) {
      return '';
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeRationaleHtml(input) {
    var raw = String(input || '');
    if (!raw) return '';
    var root = document.createElement('div');
    root.innerHTML = raw;
    var allowed = {
      B: true,
      STRONG: true,
      I: true,
      EM: true,
      U: true,
      P: true,
      BR: true,
      UL: true,
      OL: true,
      LI: true,
      A: true,
    };
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    var toProcess = [];
    while (walker.nextNode()) toProcess.push(walker.currentNode);
    toProcess.forEach(function(node) {
      var tag = String(node.tagName || '').toUpperCase();
      if (!allowed[tag]) {
        var parent = node.parentNode;
        if (!parent) return;
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        parent.removeChild(node);
        return;
      }
      Array.prototype.slice.call(node.attributes || []).forEach(function(attr) {
        var attrName = String(attr && attr.name || '').toLowerCase();
        if (tag === 'A' && attrName === 'href') return;
        node.removeAttribute(attr.name);
      });
      if (tag === 'A') {
        var href = safeText(node.getAttribute('href'));
        if (!/^https?:\/\//i.test(href)) {
          node.removeAttribute('href');
        } else {
          node.setAttribute('href', href);
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        }
      }
    });
    return safeText(root.innerHTML);
  }

  function toArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function makeYoutubeMinerCategoryId() {
    return 'cat_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function feedbackHasReview(feedback) {
    return Boolean(
      Boolean(feedback && feedback.ignored)
      ||
      Number(feedback && feedback.quality || 0) > 0
      || toArray(feedback && feedback.categories).length
      || safeText(feedback && feedback.category_explain)
      || toArray(feedback && feedback.attributes).length
      || safeText(feedback && feedback.attributes_explain)
      || toArray(feedback && feedback.approaches).length
      || safeText(feedback && feedback.approaches_explain)
      || safeText(feedback && feedback.hashtags)
      || safeText(feedback && feedback.note)
      || safeText(feedback && feedback.response_type)
      || safeText(feedback && feedback.suggested_response)
      || toArray(feedback && feedback.offer_feedback).some(function(item) {
        return (Number(item && item.rating || 0) > 0) || safeText(item && item.why);
      })
    );
  }

  function feedbackKeyForRow(row) {
    return YT_MINER_FEEDBACK_KEY_PREFIX + [safeText(row && row.video_id), safeText(row && row.id)].join(':');
  }

  function getCommentSelectionKey(row) {
    return [
      safeText(row && row.video_id),
      safeText(row && row.video_url),
      safeText(row && row.id),
      safeText(row && row.author_channel_id),
      safeText(row && row.author),
    ].join('::');
  }

  function readFeedback(row) {
    try {
      var raw = window.localStorage.getItem(feedbackKeyForRow(row));
      if (!raw) return {
        quality: 0,
        categories: [],
        category_explain: '',
        attributes: [],
        attributes_explain: '',
        approaches: [],
        approaches_explain: '',
        hashtags: '',
        note: '',
        response_type: '',
        suggested_response: '',
        offer_feedback: [],
        ignored: false,
        updated_at: ''
      };
      var parsed = JSON.parse(raw);
      var categories = [];
      var attributes = [];
      var approaches = [];
      var offerFeedback = [];
      if (Array.isArray(parsed && parsed.categories)) {
        categories = parsed.categories.map(function(item) { return safeText(item); }).filter(Boolean);
      } else if (safeText(parsed && parsed.category)) {
        categories = safeText(parsed.category).split(/\r?\n|,/g).map(function(item) { return safeText(item); }).filter(Boolean);
      }
      if (Array.isArray(parsed && parsed.attributes)) {
        attributes = parsed.attributes.map(function(item) { return safeText(item); }).filter(Boolean);
      } else if (safeText(parsed && parsed.attribute)) {
        attributes = safeText(parsed.attribute).split(/\r?\n|,/g).map(function(item) { return safeText(item); }).filter(Boolean);
      }
      if (Array.isArray(parsed && parsed.approaches)) {
        approaches = parsed.approaches.map(function(item) { return safeText(item); }).filter(Boolean);
      } else if (safeText(parsed && parsed.approach)) {
        approaches = safeText(parsed.approach).split(/\r?\n|,/g).map(function(item) { return safeText(item); }).filter(Boolean);
      } else if (safeText(parsed && (parsed.response_type || parsed.response_style))) {
        approaches = [safeText(parsed.response_type || parsed.response_style)];
      }
      if (Array.isArray(parsed && parsed.offer_feedback)) {
        offerFeedback = parsed.offer_feedback.map(function(item) {
          return {
            index: Math.max(0, Number(item && item.index) || 0),
            response: safeText(item && (item.response || item.offer || item.text)),
            rating: Math.max(0, Math.min(Number(item && item.rating) || 0, 5)),
            why: safeText(item && item.why),
            selected: Boolean(item && item.selected),
          };
        }).filter(function(item) {
          return item.response || item.rating > 0 || item.why;
        }).slice(0, 12);
      }
      return {
        quality: Math.max(0, Math.min(Number(parsed && parsed.quality) || 0, 5)),
        categories: Array.from(new Set(categories)).slice(0, 20),
        category_explain: safeText(parsed && parsed.category_explain),
        attributes: Array.from(new Set(attributes)).slice(0, 20),
        attributes_explain: safeText(parsed && parsed.attributes_explain),
        approaches: Array.from(new Set(approaches)).slice(0, 20),
        approaches_explain: safeText(parsed && parsed.approaches_explain),
        hashtags: safeText(parsed && (parsed.hashtags || parsed.tags)),
        note: safeText(parsed && parsed.note),
        response_type: safeText(parsed && (parsed.response_type || parsed.response_style)),
        suggested_response: safeText(parsed && (parsed.suggested_response || parsed.response_example)),
        offer_feedback: offerFeedback,
        ignored: Boolean(parsed && parsed.ignored),
        updated_at: safeText(parsed && parsed.updated_at),
      };
    } catch (_) {
      return {
        quality: 0,
        categories: [],
        category_explain: '',
        attributes: [],
        attributes_explain: '',
        approaches: [],
        approaches_explain: '',
        hashtags: '',
        note: '',
        response_type: '',
        suggested_response: '',
        offer_feedback: [],
        ignored: false,
        updated_at: ''
      };
    }
  }

  function saveFeedback(row, feedbackPatch) {
    var existing = readFeedback(row);
    var merged = Object.assign({}, existing, feedbackPatch || {});
    merged.quality = Math.max(0, Math.min(Number(merged.quality) || 0, 5));
    merged.categories = toArray(merged.categories).map(function(item) { return safeText(item); }).filter(Boolean);
    merged.categories = Array.from(new Set(merged.categories)).slice(0, 20);
    merged.category_explain = safeText(merged.category_explain);
    merged.attributes = toArray(merged.attributes).map(function(item) { return safeText(item); }).filter(Boolean);
    merged.attributes = Array.from(new Set(merged.attributes)).slice(0, 20);
    merged.attributes_explain = safeText(merged.attributes_explain);
    merged.approaches = toArray(merged.approaches).map(function(item) { return safeText(item); }).filter(Boolean);
    merged.approaches = Array.from(new Set(merged.approaches)).slice(0, 20);
    merged.approaches_explain = safeText(merged.approaches_explain);
    merged.hashtags = safeText(merged.hashtags || merged.tags);
    delete merged.tags;
    merged.note = safeText(merged.note);
    merged.response_type = safeText(merged.response_type) || safeText(merged.approaches[0]);
    merged.suggested_response = safeText(merged.suggested_response);
    merged.ignored = Boolean(merged.ignored);
    merged.offer_feedback = toArray(merged.offer_feedback).map(function(item) {
      return {
        index: Math.max(0, Number(item && item.index) || 0),
        response: safeText(item && (item.response || item.offer || item.text)),
        rating: Math.max(0, Math.min(Number(item && item.rating) || 0, 5)),
        why: safeText(item && item.why),
        selected: Boolean(item && item.selected),
      };
    }).filter(function(item) {
      return item.response || item.rating > 0 || item.why;
    }).slice(0, 12);
    merged.updated_at = new Date().toISOString();
    if (!feedbackHasReview(merged)) {
      try { window.localStorage.removeItem(feedbackKeyForRow(row)); } catch (_) { /* ignore */ }
      return;
    }
    try { window.localStorage.setItem(feedbackKeyForRow(row), JSON.stringify(merged)); } catch (_) { /* ignore */ }
  }

  function collectYoutubeMinerFeedbackCorpus() {
    var entries = [];
    try {
      for (var i = 0; i < window.localStorage.length; i += 1) {
        var key = String(window.localStorage.key(i) || '');
        if (!key.startsWith(YT_MINER_FEEDBACK_KEY_PREFIX)) continue;
        var raw = window.localStorage.getItem(key);
        if (!raw) continue;
        var parsed = JSON.parse(raw);
        var quality = Math.max(0, Math.min(Number(parsed && parsed.quality) || 0, 5));
        var hasAnyReviewSignal = Boolean(
          quality
          || safeText(parsed && parsed.category)
          || (Array.isArray(parsed && parsed.categories) && parsed.categories.length)
          || safeText(parsed && parsed.category_explain)
          || safeText(parsed && parsed.attribute)
          || (Array.isArray(parsed && parsed.attributes) && parsed.attributes.length)
          || safeText(parsed && parsed.attributes_explain)
          || safeText(parsed && parsed.approach)
          || (Array.isArray(parsed && parsed.approaches) && parsed.approaches.length)
          || safeText(parsed && parsed.approaches_explain)
          || safeText(parsed && parsed.note)
          || safeText(parsed && parsed.suggested_response)
          || safeText(parsed && parsed.response_example)
          || (Array.isArray(parsed && parsed.offer_feedback) && parsed.offer_feedback.some(function(item) {
            return (Number(item && item.rating || 0) > 0) || safeText(item && item.why);
          }))
        );
        if (!hasAnyReviewSignal) continue;
        var idPart = key.slice(YT_MINER_FEEDBACK_KEY_PREFIX.length);
        var splitIdx = idPart.indexOf(':');
        var videoId = splitIdx >= 0 ? idPart.slice(0, splitIdx) : '';
        var commentId = splitIdx >= 0 ? idPart.slice(splitIdx + 1) : idPart;
        entries.push({
          video_id: safeText(videoId),
          comment_id: safeText(commentId),
          quality: quality,
          categories: Array.isArray(parsed && parsed.categories)
            ? parsed.categories.map(function(item) { return safeText(item); }).filter(Boolean)
            : safeText(parsed && parsed.category).split(/\r?\n|,/g).map(function(item) { return safeText(item); }).filter(Boolean),
          category_explain: safeText(parsed && parsed.category_explain),
          attributes: Array.isArray(parsed && parsed.attributes)
            ? parsed.attributes.map(function(item) { return safeText(item); }).filter(Boolean)
            : safeText(parsed && parsed.attribute).split(/\r?\n|,/g).map(function(item) { return safeText(item); }).filter(Boolean),
          attributes_explain: safeText(parsed && parsed.attributes_explain),
          approaches: Array.isArray(parsed && parsed.approaches)
            ? parsed.approaches.map(function(item) { return safeText(item); }).filter(Boolean)
            : safeText(parsed && (parsed.approach || parsed.response_type || parsed.response_style)).split(/\r?\n|,/g).map(function(item) { return safeText(item); }).filter(Boolean),
          approaches_explain: safeText(parsed && parsed.approaches_explain),
          hashtags: safeText(parsed && (parsed.hashtags || parsed.tags)),
          note: safeText(parsed && parsed.note),
          response_type: safeText(parsed && (parsed.response_type || parsed.response_style)),
          suggested_response: safeText(parsed && (parsed.suggested_response || parsed.response_example)),
          ignored: Boolean(parsed && parsed.ignored),
          offer_feedback: Array.isArray(parsed && parsed.offer_feedback)
            ? parsed.offer_feedback.map(function(item) {
                return {
                  index: Math.max(0, Number(item && item.index) || 0),
                  response: safeText(item && (item.response || item.offer || item.text)),
                  rating: Math.max(0, Math.min(Number(item && item.rating) || 0, 5)),
                  why: safeText(item && item.why),
                  selected: Boolean(item && item.selected),
                };
              }).filter(function(item) {
                return item.response || item.rating > 0 || item.why;
              }).slice(0, 12)
            : [],
          updated_at: safeText(parsed && parsed.updated_at),
        });
      }
    } catch (_) { /* ignore */ }
    return entries.sort(function(a, b) {
      return safeText(b.updated_at).localeCompare(safeText(a.updated_at));
    }).slice(0, 500);
  }

  function normalizeYoutubeTarget(value) {
    return safeText(value)
      .replace(/\s+/g, ' ')
      .trim();
  }

  function mergeTargetsUnique(existing, incoming) {
    var out = [];
    var seen = new Set();
    function addValue(value) {
      var normalized = normalizeYoutubeTarget(value);
      if (!normalized) return;
      var key = normalized.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(normalized);
    }
    toArray(existing).forEach(addValue);
    toArray(incoming).forEach(addValue);
    return out;
  }

  function renderYoutubeMinerTargetHistory() {
    var selectEl = document.getElementById('youtubeMinerTargetHistorySelect');
    if (!selectEl) return;
    var previous = safeText(selectEl.value);
    selectEl.innerHTML = '<option value="">Previously entered targets…</option>';
    toArray(youtubeMinerTargetHistory).forEach(function(item) {
      var target = safeText(item && item.target);
      if (!target) return;
      var option = document.createElement('option');
      option.value = target;
      option.textContent = target;
      selectEl.appendChild(option);
    });
    if (previous) selectEl.value = previous;
  }

  async function refreshYoutubeMinerTargetHistory(limit) {
    var safeLimit = Math.max(1, Math.min(Number(limit) || 500, 2000));
    var res = await api('/api/acquire/youtube-target-history?limit=' + safeLimit);
    youtubeMinerTargetHistory = Array.isArray(res.targets) ? res.targets : [];
    renderYoutubeMinerTargetHistory();
  }

  function addSelectedTargetHistoryToTextarea() {
    var selectEl = document.getElementById('youtubeMinerTargetHistorySelect');
    var textEl = document.getElementById('youtubeMinerTargets');
    if (!selectEl || !textEl) return;
    var selected = safeText(selectEl.value);
    if (!selected) {
      notify('Select a previously entered target first.', true);
      return;
    }
    var current = String(textEl.value || '')
      .split(/\r?\n/g)
      .map(function(line) { return normalizeYoutubeTarget(line); })
      .filter(Boolean);
    var merged = mergeTargetsUnique(current, [selected]);
    textEl.value = merged.join('\n');
    notify('Target added');
  }

  function makeYoutubeMinerConfigId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function defaultYoutubeMinerCategoryConfig() {
    return [
      { id: makeYoutubeMinerConfigId('cat'), name: 'intent', rationale: 'Clear action-seeking language. Prioritize for fast follow-up and concrete next steps.', value_rank: 5, match_hashtags: ['purchase_intent', 'solution_seeking'] },
      { id: makeYoutubeMinerConfigId('cat'), name: 'pain_point', rationale: 'Active frustration or blockers. Lead with empathy and one diagnostic question.', value_rank: 5, match_hashtags: ['pain_point', 'problem_signal'] },
      { id: makeYoutubeMinerConfigId('cat'), name: 'growth', rationale: 'Self-development or identity-shift signal. Use aspirational but practical framing.', value_rank: 5, match_hashtags: ['growth_openness', 'identity_shift'] },
      { id: makeYoutubeMinerConfigId('cat'), name: 'question', rationale: 'Direct information request. Provide concise value, then invite one-step continuation.', value_rank: 4, match_hashtags: ['question'] },
      { id: makeYoutubeMinerConfigId('cat'), name: 'positive', rationale: 'Supportive sentiment without clear need. Keep warm and lightweight.', value_rank: 3, match_hashtags: ['positive_signal'] },
      { id: makeYoutubeMinerConfigId('cat'), name: 'risk', rationale: 'Trust skepticism or scam concern. Respond with clarity and credibility.', value_rank: 2, match_hashtags: ['trust_risk'] },
      { id: makeYoutubeMinerConfigId('cat'), name: 'general', rationale: 'Low-actionability baseline. Deprioritize unless paired with strong attributes.', value_rank: 1, match_hashtags: [] },
    ];
  }

  function defaultYoutubeMinerAttributeConfig() {
    return [
      { id: makeYoutubeMinerConfigId('attr'), name: 'motivated', rationale: 'Ready to act now. Prioritize with specific, low-friction next steps.', value_rank: 5, match_hashtags: ['growth_openness', 'purchase_intent', 'identity_shift'] },
      { id: makeYoutubeMinerConfigId('attr'), name: 'self_involved', rationale: 'Status-centered framing. Keep engagement brief unless stronger intent appears.', value_rank: 2, match_hashtags: ['social_handle'] },
      { id: makeYoutubeMinerConfigId('attr'), name: 'negative_outlook', rationale: 'Pessimistic tone. Acknowledge first, then gently reframe toward agency.', value_rank: 2, match_hashtags: ['pain_point', 'trust_risk'] },
      { id: makeYoutubeMinerConfigId('attr'), name: 'fan', rationale: 'High affinity and goodwill. Useful for rapport and lightweight engagement.', value_rank: 3, match_hashtags: ['positive_signal'] },
      { id: makeYoutubeMinerConfigId('attr'), name: 'introvert', rationale: 'Reflective communication style. Prefer thoughtful prompts over hard push.', value_rank: 3, match_hashtags: ['question', 'growth_openness'] },
    ];
  }

  function defaultYoutubeMinerApproachConfig() {
    return [
      { id: makeYoutubeMinerConfigId('approach'), name: 'ignore', rationale: 'Skip low-signal/noise comments to conserve effort for actionable conversations.', value_rank: 5, match_hashtags: ['noise'] },
      { id: makeYoutubeMinerConfigId('approach'), name: 'encourage', rationale: 'Affirm momentum and reinforce identity shift. Best for growth-oriented or positive comments.', value_rank: 4, match_hashtags: ['growth_openness', 'positive_signal', 'identity_shift'] },
      { id: makeYoutubeMinerConfigId('approach'), name: 'intrigue', rationale: 'Use curiosity/open loops to continue conversation when intent is emerging but not explicit.', value_rank: 3, match_hashtags: ['solution_seeking'] },
      { id: makeYoutubeMinerConfigId('approach'), name: 'inquire', rationale: 'Lead with a clarifying question to diagnose context before advising. Best for pain/question comments.', value_rank: 4, match_hashtags: ['question', 'pain_point'] },
      { id: makeYoutubeMinerConfigId('approach'), name: 'direct_cta', rationale: 'Offer one concrete next step when intent is explicit and friction is low.', value_rank: 5, match_hashtags: ['purchase_intent'] },
    ];
  }

  function applyRecommendedRows(kind, rows) {
    var bundle = getYoutubeMinerConfigBundle(kind);
    var recommended = bundle.defaultRows().map(function(item) {
      return {
        name: safeText(item && item.name).toLowerCase(),
        rationale: safeText(item && item.rationale),
        value_rank: Number(item && item.value_rank) || 3,
        match_hashtags: toArray(item && item.match_hashtags).map(function(v) { return safeText(v).toLowerCase(); }).filter(Boolean),
      };
    });
    var byName = {};
    recommended.forEach(function(item) {
      if (item.name) byName[item.name] = item;
    });
    return normalizeYoutubeMinerRows(kind, rows).map(function(row) {
      var name = safeText(row && row.name).toLowerCase();
      var rec = byName[name];
      if (!rec) return row;
      return {
        id: safeText(row && row.id) || makeYoutubeMinerConfigId(bundle.idPrefix),
        name: safeText(row && row.name),
        rationale: rec.rationale,
        value_rank: rec.value_rank,
        match_hashtags: rec.match_hashtags.slice(),
      };
    });
  }

  function normalizeYoutubeMinerConfigRows(rows, idPrefix, fallbackName) {
    return toArray(rows).map(function(row) {
      var rankNum = Number(row && row.value_rank);
      var tagsRaw = row && (row.match_hashtags || row.match_tags);
      var tags = [];
      if (Array.isArray(tagsRaw)) {
        tags = tagsRaw.map(function(v) { return safeText(v).toLowerCase(); }).filter(Boolean);
      } else {
        tags = String(tagsRaw || '')
          .split(/\r?\n|,/g)
          .map(function(v) { return safeText(v).toLowerCase(); })
          .filter(Boolean);
      }
      return {
        id: safeText(row && row.id) || makeYoutubeMinerConfigId(idPrefix),
        name: safeText(row && row.name) || fallbackName,
        rationale: safeText(row && row.rationale),
        value_rank: Math.max(1, Math.min(Number.isFinite(rankNum) ? rankNum : 3, 5)),
        match_hashtags: Array.from(new Set(tags)).slice(0, 20),
      };
    }).filter(function(row) { return Boolean(safeText(row && row.name)); });
  }

  function getYoutubeMinerConfigBundle(kind) {
    if (kind === 'attribute') {
      return {
        idPrefix: 'attr',
        fallbackName: 'new_attribute',
        tableId: 'youtubeMinerAttributeConfigTable',
        selectAllId: 'youtubeMinerAttributeSelectAll',
        addBtnId: 'youtubeMinerAddAttributeBtn',
        editCheckedBtnId: 'youtubeMinerEditAttributesCheckedBtn',
        deleteCheckedBtnId: 'youtubeMinerDeleteAttributesCheckedBtn',
        storageKey: YT_MINER_ATTRIBUTE_CONFIG_KEY,
        getRows: function() { return youtubeMinerAttributeConfig; },
        setRows: function(rows) { youtubeMinerAttributeConfig = rows; },
        getSelected: function() { return youtubeMinerAttributeSelectedIds; },
        setSelected: function(set) { youtubeMinerAttributeSelectedIds = set; },
        getEditing: function() { return youtubeMinerAttributeEditingIds; },
        setEditing: function(set) { youtubeMinerAttributeEditingIds = set; },
        defaultRows: defaultYoutubeMinerAttributeConfig,
        entityLabel: 'attribute',
      };
    }
    if (kind === 'approach') {
      return {
        idPrefix: 'approach',
        fallbackName: 'new_approach',
        tableId: 'youtubeMinerApproachConfigTable',
        selectAllId: 'youtubeMinerApproachSelectAll',
        addBtnId: 'youtubeMinerAddApproachBtn',
        editCheckedBtnId: 'youtubeMinerEditApproachesCheckedBtn',
        deleteCheckedBtnId: 'youtubeMinerDeleteApproachesCheckedBtn',
        storageKey: YT_MINER_APPROACH_CONFIG_KEY,
        getRows: function() { return youtubeMinerApproachConfig; },
        setRows: function(rows) { youtubeMinerApproachConfig = rows; },
        getSelected: function() { return youtubeMinerApproachSelectedIds; },
        setSelected: function(set) { youtubeMinerApproachSelectedIds = set; },
        getEditing: function() { return youtubeMinerApproachEditingIds; },
        setEditing: function(set) { youtubeMinerApproachEditingIds = set; },
        defaultRows: defaultYoutubeMinerApproachConfig,
        entityLabel: 'approach',
      };
    }
    return {
      idPrefix: 'cat',
      fallbackName: 'general',
      tableId: 'youtubeMinerCategoryConfigTable',
      selectAllId: 'youtubeMinerCategorySelectAll',
      addBtnId: 'youtubeMinerAddCategoryBtn',
      editCheckedBtnId: 'youtubeMinerEditCheckedBtn',
      deleteCheckedBtnId: 'youtubeMinerDeleteCheckedBtn',
      storageKey: YT_MINER_CATEGORY_CONFIG_KEY,
      getRows: function() { return youtubeMinerCategoryConfig; },
      setRows: function(rows) { youtubeMinerCategoryConfig = rows; },
      getSelected: function() { return youtubeMinerCategorySelectedIds; },
      setSelected: function(set) { youtubeMinerCategorySelectedIds = set; },
      getEditing: function() { return youtubeMinerCategoryEditingIds; },
      setEditing: function(set) { youtubeMinerCategoryEditingIds = set; },
      defaultRows: defaultYoutubeMinerCategoryConfig,
      entityLabel: 'category',
    };
  }

  function normalizeYoutubeMinerRows(kind, rows) {
    var bundle = getYoutubeMinerConfigBundle(kind);
    return normalizeYoutubeMinerConfigRows(rows, bundle.idPrefix, bundle.fallbackName);
  }

  function loadYoutubeMinerConfig(kind) {
    var bundle = getYoutubeMinerConfigBundle(kind);
    try {
      var raw = window.localStorage.getItem(bundle.storageKey);
      if (!raw) return bundle.defaultRows();
      var parsed = JSON.parse(raw);
      var normalized = normalizeYoutubeMinerRows(kind, parsed);
      return normalized.length ? normalized : bundle.defaultRows();
    } catch (_) {
      return bundle.defaultRows();
    }
  }

  function saveYoutubeMinerConfig(kind, rows) {
    var bundle = getYoutubeMinerConfigBundle(kind);
    try {
      window.localStorage.setItem(bundle.storageKey, JSON.stringify(rows));
    } catch (_) { /* ignore */ }
  }

  function loadYoutubeMinerResponseContext() {
    try {
      return safeText(window.localStorage.getItem(YT_MINER_RESPONSE_CONTEXT_KEY) || '');
    } catch (_) {
      return '';
    }
  }

  function saveYoutubeMinerResponseContext(value) {
    try {
      window.localStorage.setItem(YT_MINER_RESPONSE_CONTEXT_KEY, safeText(value || ''));
    } catch (_) { /* ignore */ }
  }

  function loadYoutubeMinerResponseGuidelines() {
    try {
      return safeText(window.localStorage.getItem(YT_MINER_RESPONSE_GUIDELINES_KEY) || '');
    } catch (_) {
      return '';
    }
  }

  function saveYoutubeMinerResponseGuidelines(value) {
    try {
      window.localStorage.setItem(YT_MINER_RESPONSE_GUIDELINES_KEY, safeText(value || ''));
    } catch (_) { /* ignore */ }
  }

  function normalizeYoutubeMinerRuleGuides(rowsInput) {
    var rows = Array.isArray(rowsInput) ? rowsInput : [];
    return rows.map(function(item, index) {
      return {
        id: safeText(item && (item.id || item.item_id)) || makeYoutubeMinerConfigId('ruleguide'),
        type: safeText(item && item.type).toLowerCase() === 'guide' ? 'guide' : 'rule',
        text: safeText(item && (item.text || item.name)),
        enabled: item && item.enabled !== false,
        sort_order: Number.isFinite(Number(item && item.sort_order)) ? Number(item.sort_order) : index,
      };
    }).filter(function(item) { return Boolean(item.text); });
  }

  function parseYoutubeMinerRuleGuidesFromText(value) {
    return safeText(value)
      .split(/\r?\n/g)
      .map(function(line) { return safeText(line.replace(/^[-*]\s*/, '')); })
      .filter(Boolean)
      .map(function(text, index) {
        return {
          id: makeYoutubeMinerConfigId('ruleguide'),
          type: 'rule',
          text: text,
          enabled: true,
          sort_order: index,
        };
      });
  }

  function composeYoutubeMinerRuleGuidesText(rowsInput) {
    return normalizeYoutubeMinerRuleGuides(rowsInput)
      .filter(function(item) { return item.enabled; })
      .map(function(item) {
        return (item.type === 'guide' ? 'Guide: ' : 'Rule: ') + item.text;
      })
      .join('\n');
  }

  function loadYoutubeMinerRuleGuides() {
    try {
      var raw = window.localStorage.getItem(YT_MINER_RULE_GUIDES_KEY);
      if (!raw) return [];
      return normalizeYoutubeMinerRuleGuides(JSON.parse(raw));
    } catch (_) {
      return [];
    }
  }

  function saveYoutubeMinerRuleGuides(rowsInput) {
    var rows = normalizeYoutubeMinerRuleGuides(rowsInput);
    try {
      window.localStorage.setItem(YT_MINER_RULE_GUIDES_KEY, JSON.stringify(rows));
    } catch (_) { /* ignore */ }
    youtubeMinerRuleGuideRows = rows.slice();
    saveYoutubeMinerResponseGuidelines(composeYoutubeMinerRuleGuidesText(rows));
  }

  function saveYoutubeMinerLastResult(result) {
    try {
      window.localStorage.setItem(YT_MINER_LAST_RESULT_KEY, JSON.stringify(result || {}));
    } catch (_) { /* ignore */ }
  }

  function loadYoutubeMinerLastResult() {
    try {
      var raw = window.localStorage.getItem(YT_MINER_LAST_RESULT_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function saveYoutubeMinerLastInput(input) {
    try {
      window.localStorage.setItem(YT_MINER_LAST_INPUT_KEY, JSON.stringify(input || {}));
    } catch (_) { /* ignore */ }
  }

  function loadYoutubeMinerLastInput() {
    try {
      var raw = window.localStorage.getItem(YT_MINER_LAST_INPUT_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function saveYoutubeResearchLastResult(result) {
    try {
      window.localStorage.setItem(YT_RESEARCH_LAST_RESULT_KEY, JSON.stringify(result || {}));
    } catch (_) { /* ignore */ }
  }

  function loadYoutubeResearchLastResult() {
    try {
      var raw = window.localStorage.getItem(YT_RESEARCH_LAST_RESULT_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function saveActiveVideoSnapshot(snapshot) {
    try {
      window.localStorage.setItem(YT_ACTIVE_VIDEO_KEY, JSON.stringify(snapshot || {}));
    } catch (_) {
      /* ignore */
    }
  }

  function loadActiveVideoSnapshot() {
    try {
      var raw = window.localStorage.getItem(YT_ACTIVE_VIDEO_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function rememberActiveVideo(snapshot) {
    var next = {
      video_url: safeText(snapshot && snapshot.video_url),
      video_id: safeText(snapshot && snapshot.video_id) || extractYoutubeVideoId(snapshot && snapshot.video_url),
      title: safeText(snapshot && snapshot.title),
      channel_name: safeText(snapshot && snapshot.channel_name),
      channel_url: safeText(snapshot && snapshot.channel_url),
    };
    if (!next.video_url && !next.video_id && !next.title) return null;
    activeVideoSnapshot = Object.assign({}, activeVideoSnapshot || {}, next);
    saveActiveVideoSnapshot(activeVideoSnapshot);
    return activeVideoSnapshot;
  }

  function findYoutubeDetailsRunByVideo(videoUrl) {
    var targetUrl = safeText(videoUrl);
    var targetId = extractYoutubeVideoId(videoUrl);
    return (state.acquireYoutubeDetails || []).find(function(run) {
      var runUrl = safeText(run && run.video_url);
      var runId = extractYoutubeVideoId(runUrl);
      if (targetUrl && runUrl && targetUrl === runUrl) return true;
      if (targetId && runId && targetId === runId) return true;
      return false;
    }) || null;
  }

  function youtubeRunHasMeaningfulDetails(run) {
    return Boolean(
      safeText(run && run.title) ||
      safeText(run && run.channel_name) ||
      safeText(run && run.video_id) ||
      safeText(run && run.category) ||
      safeText(run && run.tags)
    );
  }

  function compareRunCreatedDesc(left, right) {
    return String(right && right.created_at || '').localeCompare(String(left && left.created_at || ''));
  }

  function findBestYoutubeDetailsRunForVideo(videoUrl) {
    var targetUrl = safeText(videoUrl);
    var targetId = extractYoutubeVideoId(videoUrl);
    var matches = (state.acquireYoutubeDetails || []).filter(function(run) {
      var runUrl = safeText(run && run.video_url);
      var runId = extractYoutubeVideoId(runUrl) || safeText(run && run.video_id);
      if (targetUrl && runUrl && targetUrl === runUrl) return true;
      if (targetId && runId && targetId === runId) return true;
      return false;
    }).sort(compareRunCreatedDesc);
    if (!matches.length) return null;
    return matches.find(youtubeRunHasMeaningfulDetails) || matches[0];
  }

  function hydrateRepositoryRow(run) {
    var row = Object.assign({}, run || {});
    var detailRun = findBestYoutubeDetailsRunForVideo(row.video_url);
    if (!detailRun) return row;
    row.detail_run_id = safeText(detailRun && detailRun.run_id) || safeText(row.detail_run_id);
    row.has_details = Boolean(row.has_details || (detailRun && detailRun.run_id));
    row.title = safeText(row.title) || safeText(detailRun && detailRun.title);
    row.channel_name = safeText(row.channel_name) || safeText(detailRun && detailRun.channel_name);
    row.channel_url = safeText(row.channel_url) || safeText(detailRun && detailRun.channel_url);
    row.category = safeText(row.category) || safeText(detailRun && detailRun.category);
    row.tags = safeText(row.tags) || safeText(detailRun && detailRun.tags);
    row.transcript_status = safeText(row.transcript_status) || safeText(detailRun && detailRun.transcript_status) || 'unavailable';
    row.created_at = safeText(row.created_at) || safeText(detailRun && detailRun.created_at);
    return row;
  }

  function parseTagTokens(value) {
    return String(value || '')
      .split(/[\s,|;]+/g)
      .map(function(item) { return safeText(item).toLowerCase(); })
      .map(function(item) { return item.startsWith('#') ? item : '#' + item; })
      .filter(function(item) { return item.length > 1; });
  }

  function phraseFromTag(tag) {
    return safeText(String(tag || '').replace(/^#/, '').replace(/[_-]+/g, ' '));
  }

  function collectTagsFromRecord(record) {
    var tags = [];
    Object.keys(record || {}).forEach(function(key) {
      var field = String(key || '').toLowerCase();
      if (field.includes('hashtag') || field === 'tags') {
        tags = tags.concat(parseTagTokens(record[key]));
        return;
      }
      var value = record[key];
      if (typeof value === 'string' && value.indexOf('#') >= 0) {
        var matches = value.match(/#[a-z0-9_]+/gi) || [];
        tags = tags.concat(matches.map(function(item) { return safeText(item).toLowerCase(); }));
      }
    });
    return Array.from(new Set(tags)).slice(0, 200);
  }

  function getYoutubeResearchTopicValue(record) {
    return safeText(record && (record.topic || record.category));
  }

  async function loadYoutubeResearchMessagingCache() {
    if (youtubeResearchMessagingCache) return youtubeResearchMessagingCache;
    var requests = [
      api('/api/messaging/topics?limit=5000'),
      api('/api/messaging/hashtags?limit=5000'),
      api('/api/messaging/articles?limit=5000'),
      api('/api/messaging/posts?limit=5000'),
      api('/api/messaging/tweets?limit=5000'),
    ];
    var results = await Promise.allSettled(requests);
    var categories = [];
    var hashtags = [];
    var articles = [];
    var posts = [];
    var tweets = [];
    if (results[0].status === 'fulfilled') {
      categories = toArray(results[0].value?.topics || results[0].value?.categories || results[0].value?.data || results[0].value);
    }
    if (results[1].status === 'fulfilled') hashtags = toArray(results[1].value?.hashtags);
    if (results[2].status === 'fulfilled') articles = toArray(results[2].value?.articles);
    if (results[3].status === 'fulfilled') posts = toArray(results[3].value?.posts);
    if (results[4].status === 'fulfilled') tweets = toArray(results[4].value?.tweets);
    youtubeResearchMessagingCache = {
      categories: categories,
      hashtags: hashtags,
      records: [].concat(hashtags, articles, posts, tweets),
    };
    return youtubeResearchMessagingCache;
  }

  function populateYoutubeResearchCategoryOptions(categories, selectedCategory) {
    var select = document.getElementById('youtubeResearchMessagingCategory');
    if (!select) return;
    var current = safeText(selectedCategory || select.value);
    select.innerHTML = '<option value="">All Topics</option>';
    var rows = toArray(categories).slice().sort(function(a, b) {
      return getYoutubeResearchTopicValue(a).localeCompare(getYoutubeResearchTopicValue(b));
    });
    rows.forEach(function(row) {
      var name = getYoutubeResearchTopicValue(row);
      if (!name) return;
      var opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === current) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function populateYoutubeResearchHashtagOptions(records, category, selectedHashtag) {
    var select = document.getElementById('youtubeResearchHashtagSelect');
    if (!select) return;
    var current = safeText(selectedHashtag || select.value).toLowerCase();
    var cat = safeText(category).toLowerCase();
    var tags = [];
    toArray(records).forEach(function(record) {
      var recCategory = getYoutubeResearchTopicValue(record).toLowerCase();
      if (cat && recCategory !== cat) return;
      tags = tags.concat(collectTagsFromRecord(record));
    });
    tags = Array.from(new Set(tags)).sort();
    select.innerHTML = '<option value="">All Hashtags</option>';
    tags.forEach(function(tag) {
      var opt = document.createElement('option');
      opt.value = tag;
      opt.textContent = tag;
      if (tag === current) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function buildYoutubeResearchSuggestedPhrases(records, category, hashtag, limit) {
    var cap = Math.max(1, Math.min(Number(limit) || 10, 20));
    var cat = safeText(category).toLowerCase();
    var hash = safeText(hashtag).toLowerCase();
    if (!cat) return [];
    var phrases = [];
    var seen = new Set();

    var pushPhrase = function(value) {
      var phrase = safeText(value).replace(/^#/, '').replace(/[_-]+/g, ' ').trim();
      var key = phrase.toLowerCase();
      if (!phrase || seen.has(key)) return;
      seen.add(key);
      phrases.push(phrase);
    };

    pushPhrase(category);
    if (hash) pushPhrase(hash);

    toArray(records).forEach(function(record) {
      var recCategory = getYoutubeResearchTopicValue(record).toLowerCase();
      if (cat && recCategory !== cat) return;
      var tags = collectTagsFromRecord(record);
      var filteredTags = hash
        ? tags.filter(function(tag) { return tag === hash; })
        : tags;
      filteredTags.forEach(function(tag) {
        pushPhrase(tag);
      });
    });

    return phrases.slice(0, cap);
  }

  async function refreshYoutubeResearchCategoryHashtagHints() {
    var cache = await loadYoutubeResearchMessagingCache();
    var categorySelect = document.getElementById('youtubeResearchMessagingCategory');
    var hashtagSelect = document.getElementById('youtubeResearchHashtagSelect');
    var phrasesArea = document.getElementById('youtubeResearchManualPhrases');
    if (!categorySelect || !hashtagSelect || !phrasesArea) return;

    var selectedCategory = safeText(categorySelect.value);
    var selectedHashtag = safeText(hashtagSelect.value).toLowerCase();
    populateYoutubeResearchCategoryOptions(cache.categories, selectedCategory);
    populateYoutubeResearchHashtagOptions(cache.hashtags, selectedCategory, selectedHashtag);

    // Re-resolve after options are rebuilt.
    selectedCategory = safeText(categorySelect.value);
    selectedHashtag = safeText(hashtagSelect.value).toLowerCase();
    var suggestions = buildYoutubeResearchSuggestedPhrases(cache.hashtags.length ? cache.hashtags : cache.records, selectedCategory, selectedHashtag, 10);
    phrasesArea.value = suggestions.join('\n');
  }

  async function loadPersistedYoutubeMinerResponseContext() {
    try {
      var res = await api('/api/settings/training/context', { method: 'GET' });
      return {
        context: safeText(res?.training_context || res?.data?.training_context || res?.youtube_response_context || res?.data?.youtube_response_context || ''),
        guidelines: safeText(res?.training_guidelines || res?.data?.training_guidelines || res?.youtube_response_guidelines || res?.data?.youtube_response_guidelines || ''),
      };
    } catch (_) {
      return { context: '', guidelines: '' };
    }
  }

  async function savePersistedYoutubeMinerResponseContext(contextValue, guidelinesValue) {
    return api('/api/settings/training/context', {
      method: 'POST',
      body: JSON.stringify({
        training_context: safeText(contextValue || ''),
        training_guidelines: safeText(guidelinesValue || ''),
      }),
    });
  }

  function persistedYoutubeMinerConfigPath(kind) {
    if (kind === 'attribute') return '/api/settings/training/attributes';
    if (kind === 'approach') return '/api/settings/training/approaches';
    return '/api/settings/training/categories';
  }

  async function loadPersistedYoutubeMinerConfig(kind) {
    try {
      var res = await api(persistedYoutubeMinerConfigPath(kind), { method: 'GET' });
      var items = Array.isArray(res?.items) ? res.items : (Array.isArray(res?.data?.items) ? res.data.items : []);
      return normalizeYoutubeMinerRows(kind, items);
    } catch (_) {
      return [];
    }
  }

  async function savePersistedYoutubeMinerConfig(kind, rows) {
    return api(persistedYoutubeMinerConfigPath(kind), {
      method: 'POST',
      body: JSON.stringify({
        items: normalizeYoutubeMinerRows(kind, rows),
      }),
    });
  }

  async function loadPersistedYoutubeMinerRuleGuides() {
    try {
      var res = await api('/api/settings/training/rules-guides', { method: 'GET' });
      var items = Array.isArray(res?.items) ? res.items : (Array.isArray(res?.data?.items) ? res.data.items : []);
      return normalizeYoutubeMinerRuleGuides(items);
    } catch (_) {
      return [];
    }
  }

  async function savePersistedYoutubeMinerRuleGuides(rows) {
    return api('/api/settings/training/rules-guides', {
      method: 'POST',
      body: JSON.stringify({
        items: normalizeYoutubeMinerRuleGuides(rows),
      }),
    });
  }

  function defaultTrainingReplyMixSettings() {
    return {
      explicit_isitas_percent: 50,
      subtle_shared_framing_percent: 40,
      generic_context_percent: 10,
    };
  }

  function normalizeTrainingReplyMixSettings(input) {
    var fallback = defaultTrainingReplyMixSettings();
    var source = input && typeof input === 'object' ? input : {};
    var explicitPercent = Math.max(0, Math.min(Number(source.explicit_isitas_percent), 100));
    var subtlePercent = Math.max(0, Math.min(Number(source.subtle_shared_framing_percent), 100));
    var genericPercent = Math.max(0, Math.min(Number(source.generic_context_percent), 100));
    if (!Number.isFinite(explicitPercent)) explicitPercent = fallback.explicit_isitas_percent;
    if (!Number.isFinite(subtlePercent)) subtlePercent = fallback.subtle_shared_framing_percent;
    if (!Number.isFinite(genericPercent)) genericPercent = fallback.generic_context_percent;
    var total = explicitPercent + subtlePercent + genericPercent;
    if (total !== 100) {
      var nonGenericTarget = Math.max(0, 100 - genericPercent);
      var explicitShare = (explicitPercent + subtlePercent) > 0
        ? explicitPercent / (explicitPercent + subtlePercent)
        : (fallback.explicit_isitas_percent / (fallback.explicit_isitas_percent + fallback.subtle_shared_framing_percent));
      explicitPercent = Math.round(nonGenericTarget * explicitShare);
      subtlePercent = Math.max(0, nonGenericTarget - explicitPercent);
      genericPercent = Math.max(0, 100 - explicitPercent - subtlePercent);
    }
    return {
      explicit_isitas_percent: explicitPercent,
      subtle_shared_framing_percent: subtlePercent,
      generic_context_percent: genericPercent,
    };
  }

  async function loadPersistedTrainingReplyMixSettings() {
    try {
      var res = await api('/api/settings/training/settings', { method: 'GET' });
      return normalizeTrainingReplyMixSettings(res?.data || res);
    } catch (_) {
      return defaultTrainingReplyMixSettings();
    }
  }

  async function savePersistedTrainingReplyMixSettings(settings) {
    return api('/api/settings/training/settings', {
      method: 'POST',
      body: JSON.stringify(normalizeTrainingReplyMixSettings(settings)),
    });
  }

  function renderTrainingReplyMixTotal(settings) {
    var totalEl = document.getElementById('trainingReplyMixTotal');
    if (!totalEl) return;
    var normalized = normalizeTrainingReplyMixSettings(settings);
    var total = Number(normalized.explicit_isitas_percent || 0)
      + Number(normalized.subtle_shared_framing_percent || 0)
      + Number(normalized.generic_context_percent || 0);
    totalEl.textContent = String(total) + '%';
  }

  function collectTrainingReplyMixSettingsFromUi() {
    return normalizeTrainingReplyMixSettings({
      explicit_isitas_percent: document.getElementById('trainingExplicitIsitasPercent')?.value,
      subtle_shared_framing_percent: document.getElementById('trainingSubtleFramingPercent')?.value,
      generic_context_percent: document.getElementById('trainingGenericContextPercent')?.value,
    });
  }

  function applyTrainingReplyMixSettingsToUi(settings) {
    var normalized = normalizeTrainingReplyMixSettings(settings);
    var explicitEl = document.getElementById('trainingExplicitIsitasPercent');
    var subtleEl = document.getElementById('trainingSubtleFramingPercent');
    var genericEl = document.getElementById('trainingGenericContextPercent');
    if (explicitEl) explicitEl.value = String(normalized.explicit_isitas_percent);
    if (subtleEl) subtleEl.value = String(normalized.subtle_shared_framing_percent);
    if (genericEl) genericEl.value = String(normalized.generic_context_percent);
    renderTrainingReplyMixTotal(normalized);
  }

  function bindTrainingReplyMixSettings() {
    var ids = [
      'trainingExplicitIsitasPercent',
      'trainingSubtleFramingPercent',
      'trainingGenericContextPercent',
    ];
    var timer = null;
    ids.forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', function() {
        renderTrainingReplyMixTotal(collectTrainingReplyMixSettingsFromUi());
        if (timer) clearTimeout(timer);
        timer = setTimeout(async function() {
          try {
            var normalized = collectTrainingReplyMixSettingsFromUi();
            applyTrainingReplyMixSettingsToUi(normalized);
            await savePersistedTrainingReplyMixSettings(normalized);
          } catch (err) {
            notify(err.message || 'Could not save training reply mix settings', true);
          }
        }, 500);
      });
    });
  }

  function schedulePersistYoutubeMinerResponseContext(contextValue, guidelinesValue) {
    if (youtubeMinerContextSaveTimer) clearTimeout(youtubeMinerContextSaveTimer);
    var nextContextValue = safeText(contextValue || '');
    var nextGuidelinesValue = safeText(guidelinesValue || '');
    youtubeMinerContextSaveTimer = setTimeout(async function() {
      if (youtubeMinerContextSaving) return;
      youtubeMinerContextSaving = true;
      try {
        await savePersistedYoutubeMinerResponseContext(nextContextValue, nextGuidelinesValue);
      } catch (err) {
        notify(err.message || 'Could not save Context/Guidelines', true);
      } finally {
        youtubeMinerContextSaving = false;
      }
    }, 700);
  }

  function schedulePersistYoutubeMinerConfig(kind, rows) {
    if (youtubeMinerConfigSaveTimers[kind]) clearTimeout(youtubeMinerConfigSaveTimers[kind]);
    var nextRows = normalizeYoutubeMinerRows(kind, rows);
    youtubeMinerConfigSaveTimers[kind] = setTimeout(async function() {
      try {
        await savePersistedYoutubeMinerConfig(kind, nextRows);
      } catch (err) {
        notify(err.message || ('Could not save shared ' + kind + ' training config'), true);
      }
    }, 500);
  }

  function schedulePersistYoutubeMinerRuleGuides(rows) {
    if (youtubeMinerConfigSaveTimers.ruleGuide) clearTimeout(youtubeMinerConfigSaveTimers.ruleGuide);
    var nextRows = normalizeYoutubeMinerRuleGuides(rows);
    youtubeMinerConfigSaveTimers.ruleGuide = setTimeout(async function() {
      try {
        await savePersistedYoutubeMinerRuleGuides(nextRows);
      } catch (err) {
        notify(err.message || 'Could not save shared rules/guides', true);
      }
    }, 500);
  }

  function makeYoutubeRteToolbar(editorEl) {
    var toolbar = document.createElement('div');
    toolbar.className = 'yt-miner-cat-rationale-toolbar';

    function makeBtn(label, title, commandFn) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'yt-miner-rte-btn';
      btn.textContent = label;
      btn.title = title;
      btn.addEventListener('click', commandFn);
      return btn;
    }

    toolbar.appendChild(makeBtn('B', 'Bold', function() {
      editorEl.focus();
      document.execCommand('bold');
    }));
    toolbar.appendChild(makeBtn('I', 'Italic', function() {
      editorEl.focus();
      document.execCommand('italic');
    }));
    toolbar.appendChild(makeBtn('• List', 'Bullet list', function() {
      editorEl.focus();
      document.execCommand('insertUnorderedList');
    }));
    toolbar.appendChild(makeBtn('Link', 'Insert link', function() {
      editorEl.focus();
      var url = window.prompt('Enter URL (https://...)', 'https://');
      if (!url) return;
      var clean = safeText(url);
      if (!/^https?:\/\//i.test(clean)) {
        notify('URL must start with http:// or https://', true);
        return;
      }
      document.execCommand('createLink', false, clean);
    }));
    return toolbar;
  }

  function syncYoutubeMinerRowsFromEditingDom(kind) {
    var bundle = getYoutubeMinerConfigBundle(kind);
    var tbody = document.getElementById(bundle.tableId);
    if (!tbody) return;
    var rows = bundle.getRows();
    var editRows = Array.prototype.slice.call(tbody.querySelectorAll('tr[data-editing="true"]'));
    if (!editRows.length) return;
    editRows.forEach(function(tr) {
      var rowId = safeText(tr.getAttribute('data-row-id'));
      if (!rowId) return;
      var idx = rows.findIndex(function(item) { return safeText(item && item.id) === rowId; });
      if (idx < 0) return;
      var rationaleRich = tr.querySelector('.yt-miner-config-rationale-rich');
      rows[idx] = {
        id: rowId,
        name: safeText(tr.querySelector('.yt-miner-config-name') && tr.querySelector('.yt-miner-config-name').value) || bundle.fallbackName,
        rationale: rationaleRich ? sanitizeRationaleHtml(rationaleRich.innerHTML) : '',
        value_rank: Number(tr.querySelector('.yt-miner-config-rank') && tr.querySelector('.yt-miner-config-rank').value),
        match_hashtags: safeText(tr.querySelector('.yt-miner-config-tags') && tr.querySelector('.yt-miner-config-tags').value),
      };
    });
    rows = normalizeYoutubeMinerRows(kind, rows);
    bundle.setRows(rows);
  }

  function collectYoutubeMinerConfigFromUi(kind) {
    syncYoutubeMinerRowsFromEditingDom(kind);
    return normalizeYoutubeMinerRows(kind, getYoutubeMinerConfigBundle(kind).getRows());
  }

  function syncYoutubeMinerToolbarState(kind) {
    var bundle = getYoutubeMinerConfigBundle(kind);
    var selectAll = document.getElementById(bundle.selectAllId);
    var editCheckedBtn = document.getElementById(bundle.editCheckedBtnId);
    var deleteCheckedBtn = document.getElementById(bundle.deleteCheckedBtnId);
    var rows = bundle.getRows();
    var selected = bundle.getSelected();
    var visibleIds = rows.map(function(row) { return safeText(row && row.id); }).filter(Boolean);
    var selectedVisible = visibleIds.filter(function(id) { return selected.has(id); });
    if (selectAll) {
      selectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
      selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
    }
    if (editCheckedBtn) editCheckedBtn.disabled = selectedVisible.length === 0;
    if (deleteCheckedBtn) deleteCheckedBtn.disabled = selectedVisible.length === 0;
  }

  function renderYoutubeMinerConfig(kind) {
    var bundle = getYoutubeMinerConfigBundle(kind);
    var tbody = document.getElementById(bundle.tableId);
    if (!tbody) return;
    tbody.innerHTML = '';

    var rows = bundle.getRows();
    if (!rows.length) {
      rows = bundle.defaultRows();
      bundle.setRows(rows);
    }
    var editingIds = bundle.getEditing();
    var selectedIds = bundle.getSelected();

    rows.forEach(function(row) {
      var rowId = safeText(row && row.id) || makeYoutubeMinerConfigId(bundle.idPrefix);
      row.id = rowId;
      var editing = editingIds.has(rowId);
      var tr = document.createElement('tr');
      tr.setAttribute('data-row-id', rowId);
      tr.setAttribute('data-editing', editing ? 'true' : 'false');

      var selectTd = document.createElement('td');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedIds.has(rowId);
      checkbox.setAttribute('aria-label', 'Select ' + bundle.entityLabel + ' ' + (safeText(row && row.name) || rowId));
      checkbox.addEventListener('change', function() {
        if (checkbox.checked) selectedIds.add(rowId);
        else selectedIds.delete(rowId);
        syncYoutubeMinerToolbarState(kind);
      });
      selectTd.appendChild(checkbox);

      var nameTd = document.createElement('td');
      var rationaleTd = document.createElement('td');
      var rankTd = document.createElement('td');
      var tagsTd = document.createElement('td');
      var actionTd = document.createElement('td');

      if (editing) {
        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.className = 'yt-miner-config-name';
        nameInput.value = safeText(row && row.name);
        nameTd.appendChild(nameInput);

        var rationaleWrap = document.createElement('div');
        rationaleWrap.className = 'yt-miner-cat-rationale-editor';
        var rationaleRich = document.createElement('div');
        rationaleRich.className = 'yt-miner-config-rationale-rich yt-miner-cat-rationale-rich';
        rationaleRich.contentEditable = 'true';
        rationaleRich.innerHTML = sanitizeRationaleHtml(safeText(row && row.rationale));
        rationaleWrap.appendChild(makeYoutubeRteToolbar(rationaleRich));
        rationaleWrap.appendChild(rationaleRich);
        rationaleTd.appendChild(rationaleWrap);

        var rankInput = document.createElement('input');
        rankInput.type = 'number';
        rankInput.min = '1';
        rankInput.max = '5';
        rankInput.step = '1';
        rankInput.className = 'yt-miner-config-rank';
        rankInput.value = String(Math.max(1, Math.min(Number(row && row.value_rank) || 3, 5)));
        rankTd.appendChild(rankInput);

        var tagsInput = document.createElement('input');
        tagsInput.type = 'text';
        tagsInput.className = 'yt-miner-config-tags';
        tagsInput.value = toArray(row && (row.match_hashtags || row.match_tags)).join(', ');
        tagsInput.placeholder = 'pain_point, growth_openness';
        tagsTd.appendChild(tagsInput);
      } else {
        nameTd.textContent = safeText(row && row.name) || '-';
        var rationaleHtml = sanitizeRationaleHtml(safeText(row && row.rationale));
        rationaleTd.innerHTML = rationaleHtml || '-';
        rankTd.textContent = String(Math.max(1, Math.min(Number(row && row.value_rank) || 3, 5)));
        tagsTd.textContent = toArray(row && (row.match_hashtags || row.match_tags)).join(', ') || '-';
      }

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = editing ? 'Save' : 'Edit';
      editBtn.addEventListener('click', function() {
        if (!editing) {
          editingIds.add(rowId);
          renderYoutubeMinerConfig(kind);
          return;
        }
        syncYoutubeMinerRowsFromEditingDom(kind);
        editingIds.delete(rowId);
        saveYoutubeMinerConfig(kind, bundle.getRows());
        schedulePersistYoutubeMinerConfig(kind, bundle.getRows());
        renderYoutubeMinerConfig(kind);
      });
      actionTd.appendChild(editBtn);

      if (editing) {
        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', function() {
          editingIds.delete(rowId);
          renderYoutubeMinerConfig(kind);
        });
        actionTd.appendChild(cancelBtn);
      }

      var deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', function() {
        if (!window.confirm('Delete ' + bundle.entityLabel + ' "' + (safeText(row && row.name) || rowId) + '"?')) return;
        var nextRows = bundle.getRows().filter(function(item) {
          return safeText(item && item.id) !== rowId;
        });
        bundle.setRows(nextRows);
        selectedIds.delete(rowId);
        editingIds.delete(rowId);
        saveYoutubeMinerConfig(kind, nextRows);
        schedulePersistYoutubeMinerConfig(kind, nextRows);
        renderYoutubeMinerConfig(kind);
      });
      actionTd.appendChild(deleteBtn);

      tr.appendChild(selectTd);
      tr.appendChild(nameTd);
      tr.appendChild(rationaleTd);
      tr.appendChild(rankTd);
      tr.appendChild(tagsTd);
      tr.appendChild(actionTd);
      tbody.appendChild(tr);
    });

    syncYoutubeMinerToolbarState(kind);
  }

  function bindYoutubeMinerConfigEvents(kind) {
    var bundle = getYoutubeMinerConfigBundle(kind);
    var addBtn = document.getElementById(bundle.addBtnId);
    var editCheckedBtn = document.getElementById(bundle.editCheckedBtnId);
    var deleteCheckedBtn = document.getElementById(bundle.deleteCheckedBtnId);
    var selectAll = document.getElementById(bundle.selectAllId);

    if (addBtn) {
      addBtn.addEventListener('click', function() {
        var rows = collectYoutubeMinerConfigFromUi(kind);
        var id = makeYoutubeMinerConfigId(bundle.idPrefix);
        rows.push({
          id: id,
          name: bundle.fallbackName,
          rationale: '',
          value_rank: 3,
          match_hashtags: [],
        });
        bundle.setRows(rows);
        var editing = bundle.getEditing();
        var selected = bundle.getSelected();
        editing.add(id);
        selected.add(id);
        saveYoutubeMinerConfig(kind, rows);
        schedulePersistYoutubeMinerConfig(kind, rows);
        renderYoutubeMinerConfig(kind);
      });
    }

    if (selectAll) {
      selectAll.addEventListener('change', function() {
        var rows = bundle.getRows();
        var selected = bundle.getSelected();
        if (selectAll.checked) {
          rows.forEach(function(row) {
            var id = safeText(row && row.id);
            if (id) selected.add(id);
          });
        } else {
          selected.clear();
        }
        renderYoutubeMinerConfig(kind);
      });
    }

    if (editCheckedBtn) {
      editCheckedBtn.addEventListener('click', function() {
        var selected = bundle.getSelected();
        if (!selected.size) {
          notify('Select at least one ' + bundle.entityLabel + ' row to edit.', true);
          return;
        }
        syncYoutubeMinerRowsFromEditingDom(kind);
        var editing = bundle.getEditing();
        Array.from(selected).forEach(function(id) { editing.add(id); });
        renderYoutubeMinerConfig(kind);
      });
    }

    if (deleteCheckedBtn) {
      deleteCheckedBtn.addEventListener('click', function() {
        var selected = bundle.getSelected();
        if (!selected.size) {
          notify('Select at least one ' + bundle.entityLabel + ' row to delete.', true);
          return;
        }
        if (!window.confirm('Delete ' + selected.size + ' checked ' + bundle.entityLabel + ' row(s)?')) return;
        var selectedSet = new Set(Array.from(selected));
        var rows = bundle.getRows().filter(function(row) {
          return !selectedSet.has(safeText(row && row.id));
        });
        bundle.setRows(rows);
        selected.clear();
        var editing = bundle.getEditing();
        bundle.setEditing(new Set(Array.from(editing).filter(function(id) { return !selectedSet.has(id); })));
        saveYoutubeMinerConfig(kind, rows);
        schedulePersistYoutubeMinerConfig(kind, rows);
        renderYoutubeMinerConfig(kind);
      });
    }
  }

  function loadYoutubeMinerCategoryConfig() {
    return loadYoutubeMinerConfig('category');
  }

  function saveYoutubeMinerCategoryConfig(rows) {
    saveYoutubeMinerConfig('category', rows);
  }

  function collectYoutubeMinerCategoryConfigFromUi() {
    return collectYoutubeMinerConfigFromUi('category');
  }

  function renderYoutubeMinerCategoryConfig() {
    renderYoutubeMinerConfig('category');
  }

  function syncYoutubeMinerRuleGuideToolbarState() {
    var selectAll = document.getElementById('youtubeMinerRuleGuideSelectAll');
    var editBtn = document.getElementById('youtubeMinerEditRuleGuidesCheckedBtn');
    var deleteBtn = document.getElementById('youtubeMinerDeleteRuleGuidesCheckedBtn');
    var visibleIds = youtubeMinerRuleGuideRows.map(function(row) { return safeText(row && row.id); }).filter(Boolean);
    var selectedVisible = visibleIds.filter(function(id) { return youtubeMinerRuleGuideSelectedIds.has(id); });
    if (selectAll) {
      selectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
      selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
    }
    if (editBtn) editBtn.disabled = selectedVisible.length === 0;
    if (deleteBtn) deleteBtn.disabled = selectedVisible.length === 0;
  }

  function collectYoutubeMinerRuleGuidesFromUi() {
    var tbody = document.getElementById('youtubeMinerRuleGuideTable');
    if (!tbody) return normalizeYoutubeMinerRuleGuides(youtubeMinerRuleGuideRows);
    var nextRows = youtubeMinerRuleGuideRows.slice();
    Array.prototype.slice.call(tbody.querySelectorAll('tr[data-row-id]')).forEach(function(tr) {
      var rowId = safeText(tr.getAttribute('data-row-id'));
      if (!rowId) return;
      var idx = nextRows.findIndex(function(item) { return safeText(item && item.id) === rowId; });
      if (idx < 0) return;
      var editing = tr.getAttribute('data-editing') === 'true';
      if (!editing) return;
      var typeEl = tr.querySelector('.yt-miner-ruleguide-type');
      var enabledEl = tr.querySelector('.yt-miner-ruleguide-enabled');
      var textEl = tr.querySelector('.yt-miner-ruleguide-text');
      nextRows[idx] = {
        id: rowId,
        type: safeText(typeEl && typeEl.value).toLowerCase() === 'guide' ? 'guide' : 'rule',
        enabled: Boolean(enabledEl && enabledEl.checked),
        text: safeText(textEl && textEl.value),
        sort_order: idx,
      };
    });
    return normalizeYoutubeMinerRuleGuides(nextRows);
  }

  function renderYoutubeMinerRuleGuides() {
    var tbody = document.getElementById('youtubeMinerRuleGuideTable');
    var legacyTextarea = document.getElementById('youtubeMinerGuidelines');
    if (!tbody) return;
    tbody.innerHTML = '';
    var rows = normalizeYoutubeMinerRuleGuides(youtubeMinerRuleGuideRows);
    youtubeMinerRuleGuideRows = rows.slice();
    if (legacyTextarea) legacyTextarea.value = composeYoutubeMinerRuleGuidesText(rows);

    rows.forEach(function(row) {
      var rowId = safeText(row && row.id) || makeYoutubeMinerConfigId('ruleguide');
      var editing = youtubeMinerRuleGuideEditingIds.has(rowId);
      row.id = rowId;

      var tr = document.createElement('tr');
      tr.setAttribute('data-row-id', rowId);
      tr.setAttribute('data-editing', editing ? 'true' : 'false');

      var selectTd = document.createElement('td');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = youtubeMinerRuleGuideSelectedIds.has(rowId);
      checkbox.addEventListener('change', function() {
        if (checkbox.checked) youtubeMinerRuleGuideSelectedIds.add(rowId);
        else youtubeMinerRuleGuideSelectedIds.delete(rowId);
        syncYoutubeMinerRuleGuideToolbarState();
      });
      selectTd.appendChild(checkbox);

      var enabledTd = document.createElement('td');
      var typeTd = document.createElement('td');
      var textTd = document.createElement('td');
      var actionTd = document.createElement('td');

      if (editing) {
        var enabledInput = document.createElement('input');
        enabledInput.type = 'checkbox';
        enabledInput.className = 'yt-miner-ruleguide-enabled';
        enabledInput.checked = row.enabled !== false;
        enabledTd.appendChild(enabledInput);

        var typeSelect = document.createElement('select');
        typeSelect.className = 'yt-miner-ruleguide-type';
        ['rule', 'guide'].forEach(function(value) {
          var option = document.createElement('option');
          option.value = value;
          option.textContent = value.charAt(0).toUpperCase() + value.slice(1);
          option.selected = row.type === value;
          typeSelect.appendChild(option);
        });
        typeTd.appendChild(typeSelect);

        var textInput = document.createElement('textarea');
        textInput.className = 'yt-miner-ruleguide-text';
        textInput.rows = 3;
        textInput.value = safeText(row && row.text);
        textInput.placeholder = 'Enter one rule or guide';
        textTd.appendChild(textInput);
      } else {
        enabledTd.textContent = row.enabled !== false ? 'On' : 'Off';
        typeTd.textContent = row.type === 'guide' ? 'Guide' : 'Rule';
        textTd.textContent = safeText(row && row.text) || '-';
      }

      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = editing ? 'Save' : 'Edit';
      editBtn.addEventListener('click', function() {
        if (!editing) {
          youtubeMinerRuleGuideEditingIds.add(rowId);
          renderYoutubeMinerRuleGuides();
          return;
        }
        youtubeMinerRuleGuideRows = collectYoutubeMinerRuleGuidesFromUi();
        youtubeMinerRuleGuideEditingIds.delete(rowId);
        saveYoutubeMinerRuleGuides(youtubeMinerRuleGuideRows);
        schedulePersistYoutubeMinerRuleGuides(youtubeMinerRuleGuideRows);
        renderYoutubeMinerRuleGuides();
      });
      actionTd.appendChild(editBtn);

      if (editing) {
        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', function() {
          youtubeMinerRuleGuideEditingIds.delete(rowId);
          renderYoutubeMinerRuleGuides();
        });
        actionTd.appendChild(cancelBtn);
      }

      var deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', function() {
        if (!window.confirm('Delete this rules/guides row?')) return;
        youtubeMinerRuleGuideRows = youtubeMinerRuleGuideRows.filter(function(item) {
          return safeText(item && item.id) !== rowId;
        });
        youtubeMinerRuleGuideSelectedIds.delete(rowId);
        youtubeMinerRuleGuideEditingIds.delete(rowId);
        saveYoutubeMinerRuleGuides(youtubeMinerRuleGuideRows);
        schedulePersistYoutubeMinerRuleGuides(youtubeMinerRuleGuideRows);
        renderYoutubeMinerRuleGuides();
      });
      actionTd.appendChild(deleteBtn);

      tr.appendChild(selectTd);
      tr.appendChild(enabledTd);
      tr.appendChild(typeTd);
      tr.appendChild(textTd);
      tr.appendChild(actionTd);
      tbody.appendChild(tr);
    });

    syncYoutubeMinerRuleGuideToolbarState();
  }

  function bindYoutubeMinerRuleGuideEvents() {
    var addBtn = document.getElementById('youtubeMinerAddRuleGuideBtn');
    var editBtn = document.getElementById('youtubeMinerEditRuleGuidesCheckedBtn');
    var deleteBtn = document.getElementById('youtubeMinerDeleteRuleGuidesCheckedBtn');
    var selectAll = document.getElementById('youtubeMinerRuleGuideSelectAll');

    if (addBtn) {
      addBtn.addEventListener('click', function() {
        youtubeMinerRuleGuideRows = collectYoutubeMinerRuleGuidesFromUi();
        var id = makeYoutubeMinerConfigId('ruleguide');
        youtubeMinerRuleGuideRows.push({
          id: id,
          type: 'rule',
          text: 'New rule',
          enabled: true,
          sort_order: youtubeMinerRuleGuideRows.length,
        });
        youtubeMinerRuleGuideEditingIds.add(id);
        youtubeMinerRuleGuideSelectedIds.add(id);
        renderYoutubeMinerRuleGuides();
      });
    }

    if (selectAll) {
      selectAll.addEventListener('change', function() {
        if (selectAll.checked) {
          youtubeMinerRuleGuideRows.forEach(function(row) {
            var id = safeText(row && row.id);
            if (id) youtubeMinerRuleGuideSelectedIds.add(id);
          });
        } else {
          youtubeMinerRuleGuideSelectedIds.clear();
        }
        renderYoutubeMinerRuleGuides();
      });
    }

    if (editBtn) {
      editBtn.addEventListener('click', function() {
        if (!youtubeMinerRuleGuideSelectedIds.size) {
          notify('Select at least one rules/guides row to edit.', true);
          return;
        }
        Array.from(youtubeMinerRuleGuideSelectedIds).forEach(function(id) {
          youtubeMinerRuleGuideEditingIds.add(id);
        });
        renderYoutubeMinerRuleGuides();
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener('click', function() {
        if (!youtubeMinerRuleGuideSelectedIds.size) {
          notify('Select at least one rules/guides row to delete.', true);
          return;
        }
        if (!window.confirm('Delete ' + youtubeMinerRuleGuideSelectedIds.size + ' selected rules/guides row(s)?')) return;
        var selected = new Set(Array.from(youtubeMinerRuleGuideSelectedIds));
        youtubeMinerRuleGuideRows = youtubeMinerRuleGuideRows.filter(function(row) {
          return !selected.has(safeText(row && row.id));
        });
        youtubeMinerRuleGuideEditingIds = new Set(Array.from(youtubeMinerRuleGuideEditingIds).filter(function(id) { return !selected.has(id); }));
        youtubeMinerRuleGuideSelectedIds.clear();
        saveYoutubeMinerRuleGuides(youtubeMinerRuleGuideRows);
        schedulePersistYoutubeMinerRuleGuides(youtubeMinerRuleGuideRows);
        renderYoutubeMinerRuleGuides();
      });
    }
  }

  function getYoutubeCategories() {
    return Array.isArray(state.acquireYoutubeCategories) ? state.acquireYoutubeCategories : [];
  }

  function getYoutubeTrainingCategoryNames() {
    return (Array.isArray(youtubeMinerCategoryConfig) ? youtubeMinerCategoryConfig : [])
      .map(function(item) { return safeText(item && item.name); })
      .filter(Boolean);
  }

  function categoryOptions() {
    var trainingNames = getYoutubeTrainingCategoryNames();
    if (trainingNames.length) return trainingNames;
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
    var validIds = new Set(getFilteredYoutubeRuns().map(function(run) {
      return getRepositorySelectionKey(run);
    }).filter(Boolean));
    Array.from(selectedRunIds).forEach(function(runId) {
      if (!validIds.has(runId)) selectedRunIds.delete(runId);
    });
  }

  function getRepositorySelectionKey(run) {
    return safeText(run && run.video_record_id)
      || safeText(run && run.repository_run_id)
      || safeText(run && run.detail_run_id)
      || safeText(run && run.video_url);
  }

  function findCommentRunForVideoUrl(videoUrl) {
    var url = String(videoUrl || '').trim();
    if (!url) return null;
    return (state.acquireYoutubeComments || []).find(function(r) {
      return String(r.video_url || '').trim() === url;
    }) || null;
  }

  function getSelectedYoutubeRows() {
    return getFilteredYoutubeRuns().filter(function(run) {
      return selectedRunIds.has(getRepositorySelectionKey(run));
    });
  }

  function getRepositoryDeleteTargets(run) {
    var detailRunId = safeText(run && run.detail_run_id);
    var commentMatch = findCommentRunForVideoUrl(run && run.video_url)
      || (run && run.comment_run_id ? { run_id: run.comment_run_id } : null);
    var commentRunId = safeText(commentMatch && commentMatch.run_id) || safeText(run && run.comment_run_id);
    return {
      videoRecordId: safeText(run && run.video_record_id),
      detailRunId: detailRunId,
      commentRunId: commentRunId,
    };
  }

  function syncBulkSelectionUi() {
    var selectAll = document.getElementById('youtubeRunsSelectAllVisible');
    var bulkBtn = document.getElementById('youtubeRunsBulkEditBtn');
    var augmentBtn = document.getElementById('youtubeRunsAugmentBtn');
    var diagnoseBtn = document.getElementById('youtubeRunsDiagnoseBtn');
    var deleteBtn = document.getElementById('youtubeRunsDeleteBtn');
    var visibleIds = getFilteredYoutubeRuns().map(function(run) { return getRepositorySelectionKey(run); }).filter(Boolean);
    var selectedVisible = visibleIds.filter(function(runId) { return selectedRunIds.has(runId); });
    var selectedRows = getSelectedYoutubeRows();

    if (selectAll) {
      selectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
      selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
    }
    if (bulkBtn) {
      bulkBtn.disabled = selectedRows.filter(function(run) { return safeText(run && run.detail_run_id); }).length === 0;
    }
    if (augmentBtn) {
      augmentBtn.disabled = selectedRows.filter(function(run) { return safeText(run && run.video_url); }).length === 0;
    }
    if (diagnoseBtn) {
      diagnoseBtn.disabled = selectedRows.filter(function(run) { return safeText(run && run.video_url); }).length === 0;
    }
    if (deleteBtn) {
      deleteBtn.disabled = selectedRows.filter(function(run) {
        var targets = getRepositoryDeleteTargets(run);
        return targets.videoRecordId || targets.detailRunId || targets.commentRunId;
      }).length === 0;
    }
  }

  function updateBulkEditSummary() {
    var summaryEl = document.getElementById('youtubeBulkEditSummary');
    if (!summaryEl) return;
    summaryEl.textContent = selectedRunIds.size === 1
      ? '1 video selected.'
      : (String(selectedRunIds.size) + ' videos selected.');
  }

  function buildRepositoryRows() {
    if (Array.isArray(state.acquireYoutubeVideos) && state.acquireYoutubeVideos.length) {
      return state.acquireYoutubeVideos
        .filter(function(run) { return !isYoutubeVideoBannedFromTags(run && run.tags); })
        .map(hydrateRepositoryRow)
        .sort(function(a, b) {
          return String(b && (b.updated_at || b.created_at) || '').localeCompare(String(a && (a.updated_at || a.created_at) || ''));
        });
    }

    var rows = [];
    (state.acquireYoutubeComments || []).filter(function(commentRun) {
      var runId = safeText(commentRun && commentRun.run_id).toLowerCase();
      var videoUrl = safeText(commentRun && commentRun.video_url);
      if (!videoUrl) return false;
      if (runId.indexOf('ytminer_') === 0) return false;
      if (runId.indexOf('ytresearch_') === 0) return false;
      return true;
    }).map(function(commentRun) {
      var detailRun = findYoutubeDetailsRunByVideo(safeText(commentRun && commentRun.video_url));
      var detailResult = detailRun && detailRun.result ? detailRun.result : {};
      var detailVideo = detailResult && detailResult.video ? detailResult.video : {};
      rows.push({
        repository_run_id: safeText(commentRun && commentRun.run_id),
        detail_run_id: safeText(detailRun && detailRun.run_id),
        comment_run_id: safeText(commentRun && commentRun.run_id),
        source: 'comment_run',
        created_at: safeText(commentRun && commentRun.created_at) || safeText(detailRun && detailRun.created_at),
        video_url: safeText(commentRun && commentRun.video_url) || safeText(detailRun && detailRun.video_url),
        title: safeText(commentRun && commentRun.title) || safeText(detailRun && detailRun.title) || safeText(detailVideo && detailVideo.title),
        channel_name: safeText(commentRun && commentRun.channel_name) || safeText(detailRun && detailRun.channel_name),
        channel_url: safeText(detailRun && detailRun.channel_url),
        category: safeText(detailRun && detailRun.category),
        tags: safeText(detailRun && detailRun.tags) || formatHashtags(detailVideo && detailVideo.hashtags),
        transcript_status: safeText(detailRun && detailRun.transcript_status) || safeText(detailVideo && detailVideo.transcript_status) || 'unavailable',
        comment_count: Number(commentRun && commentRun.comment_count || 0) || 0,
        has_details: Boolean(detailRun && detailRun.run_id),
      });
    });

    youtubeMinerRunDetails.forEach(function(run) {
      var result = run && run.result ? run.result : {};
      var comments = toArray(result && result.comments);
      var grouped = new Map();
      comments.forEach(function(row) {
        var videoUrl = safeText(row && row.video_url);
        if (!videoUrl) return;
        if (!grouped.has(videoUrl)) {
          grouped.set(videoUrl, {
            video_url: videoUrl,
            title: safeText(row && row.video_title),
            channel_name: safeText(row && row.channel_name),
            comment_count: 0,
          });
        }
        grouped.get(videoUrl).comment_count += 1;
      });
      grouped.forEach(function(item) {
        if (rows.some(function(existing) { return safeText(existing.video_url) === safeText(item.video_url); })) return;
        var detailRun = findYoutubeDetailsRunByVideo(item.video_url);
        var detailResult = detailRun && detailRun.result ? detailRun.result : {};
        var detailVideo = detailResult && detailResult.video ? detailResult.video : {};
        rows.push({
          repository_run_id: safeText(run && run.run_id) + ':' + safeText(item.video_url),
          detail_run_id: safeText(detailRun && detailRun.run_id),
          comment_run_id: '',
          source: 'miner_run',
          created_at: safeText(run && run.created_at) || safeText(detailRun && detailRun.created_at),
          video_url: safeText(item.video_url),
          title: safeText(item.title) || safeText(detailRun && detailRun.title) || safeText(detailVideo && detailVideo.title),
          channel_name: safeText(item.channel_name) || safeText(detailRun && detailRun.channel_name),
          channel_url: safeText(detailRun && detailRun.channel_url),
          category: safeText(detailRun && detailRun.category),
          tags: safeText(detailRun && detailRun.tags) || formatHashtags(detailVideo && detailVideo.hashtags),
          transcript_status: safeText(detailRun && detailRun.transcript_status) || safeText(detailVideo && detailVideo.transcript_status) || 'unavailable',
          comment_count: Number(item.comment_count || 0) || 0,
          has_details: Boolean(detailRun && detailRun.run_id),
        });
      });
    });

    return rows.filter(function(run) {
      return !isYoutubeVideoBannedFromTags(run && run.tags);
    }).sort(function(a, b) {
      return String(b && b.created_at || '').localeCompare(String(a && a.created_at || ''));
    });
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

  function renderVideoMedia(video, runMeta) {
    var videoUrl = safeText(video && video.url) || safeText(runMeta && runMeta.video_url);
    var videoId = safeText(video && video.id) || extractYoutubeVideoId(videoUrl);
    var embedUrl = videoId ? ('https://www.youtube-nocookie.com/embed/' + encodeURIComponent(videoId)) : '';
    renderYoutubePlayerFrame(document.getElementById('youtubeVideoPlayer'), document.getElementById('youtubeVideoMediaEmpty'), embedUrl, videoUrl);
  }

  function renderYoutubePlayerFrame(playerEl, emptyEl, embedUrl, videoUrl) {
    if (!playerEl || !emptyEl) return;

    playerEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    playerEl.removeAttribute('src');

    if (!videoUrl && !videoId) {
      emptyEl.textContent = 'No video loaded yet.';
      return;
    }

    if (embedUrl) {
      emptyEl.classList.add('hidden');
      playerEl.src = embedUrl;
      playerEl.classList.remove('hidden');
    } else {
      emptyEl.textContent = 'Preview unavailable for this video.';
      emptyEl.classList.remove('hidden');
    }
  }

  function renderFallbackVideoDetails(videoUrl, fallbackMeta) {
    var meta = Object.assign({}, currentDetailsRun || {}, fallbackMeta || {}, { video_url: safeText(videoUrl) });
    currentDetailsRun = meta;
    rememberActiveVideo(meta);
    renderVideoTitleLink({
      title: safeText(meta && meta.title),
      url: safeText(videoUrl),
      id: safeText(meta && meta.video_id),
    }, {
      name: safeText(meta && meta.channel_name),
      profile_url: safeText(meta && meta.channel_url),
    }, meta);
    setDetailsField('youtubeDescriptionText', '', 'Video details are not loaded for this video yet.');
    setDetailsField('youtubeHashtagsText', '', '-');
    if (els.youtubeTranscriptPreview) {
      els.youtubeTranscriptPreview.textContent = 'Transcript unavailable for this video.';
    }
    renderVideoMedia({
      url: safeText(videoUrl),
      id: safeText(meta && meta.video_id),
      title: safeText(meta && meta.title),
    }, meta);
    loadInlineCommentsForVideo(videoUrl);
  }

  function syncActiveVideoFromUrl(videoUrl, fallbackMeta) {
    var url = safeText(videoUrl);
    if (!url) return false;
    var matchedRun = findYoutubeDetailsRunByVideo(url);
    if (matchedRun) {
      currentDetailsRun = matchedRun;
      rememberActiveVideo({
        video_url: matchedRun.video_url,
        title: matchedRun.title,
        channel_name: matchedRun.channel_name,
        channel_url: matchedRun.channel_url,
      });
      state.youtubeAcquireResult = matchedRun.result || null;
      renderYoutubeAcquireResult();
      return true;
    }
    renderFallbackVideoDetails(url, fallbackMeta || {});
    return true;
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
    var rows = Array.isArray(comments) ? comments : [];
    inlineCommentsCache = rows.slice();
    if (!rows.length) {
      el.textContent = String(fallback || 'No comments loaded for this video.');
      return;
    }
    var totalLikes = rows.reduce(function(sum, comment) {
      return sum + (Number(comment && comment.like_count ? comment.like_count : 0) || 0);
    }, 0);
    el.textContent = rows.length.toLocaleString() + ' comments loaded'
      + (totalLikes ? (' | ' + totalLikes.toLocaleString() + ' total likes') : '');
  }

  async function loadInlineCommentsForVideo(videoUrl) {
    var url = String(videoUrl || '').trim();
    if (!url) {
      renderInlineComments([], 'No comment metadata loaded for this video.');
      return;
    }
    var match = (state.acquireYoutubeComments || []).find(function(r) {
      return String(r.video_url || '').trim() === url;
    });
    if (!match || !match.run_id) {
      renderInlineComments([], 'No acquired comment metadata found for this video.');
      return;
    }
    var token = ++activeCommentsLoadToken;
    try {
      var res = await api('/api/acquire/youtube-comment-runs/' + encodeURIComponent(match.run_id));
      if (token !== activeCommentsLoadToken) return;
      var run = res.run || {};
      var result = run.result || run.result_json || {};
      var comments = Array.isArray(result.comments) ? result.comments : [];
      renderInlineComments(comments, 'No comment metadata found in this run.');
    } catch (err) {
      if (token !== activeCommentsLoadToken) return;
      renderInlineComments([], 'Comment metadata could not be loaded.');
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
    var fromSnapshot = String(activeVideoSnapshot && activeVideoSnapshot.video_url || '').trim();
    if (fromSnapshot) return fromSnapshot;
    if (els.youtubeAcquireForm) {
      var input = els.youtubeAcquireForm.querySelector('[name="video_url"]');
      var fromForm = String(input && input.value || '').trim();
      if (fromForm) return fromForm;
    }
    return '';
  }

  function getPrimaryResearchRunVideo(run, result) {
    var request = run && run.request && typeof run.request === 'object' ? run.request : {};
    var research = result && result.research && typeof result.research === 'object' ? result.research : {};
    var requestItems = Array.isArray(request.distilled_target_items) ? request.distilled_target_items : [];
    var researchItems = Array.isArray(research.distilled_target_items) ? research.distilled_target_items : [];
    var primaryItem = requestItems[0] || researchItems[0] || null;
    var primaryUrl = safeText(primaryItem && primaryItem.video_url)
      || safeText(run && run.primary_video_url)
      || safeText(Array.isArray(request.distilled_targets) ? request.distilled_targets[0] : '')
      || safeText(Array.isArray(research.distilled_targets) ? research.distilled_targets[0] : '');
    var primaryTitle = safeText(primaryItem && (primaryItem.title || primaryItem.video_title))
      || safeText(run && run.primary_video_title);
    var primaryChannel = safeText(primaryItem && primaryItem.channel_name);
    if (!primaryTitle && primaryUrl && Array.isArray(result && result.comments)) {
      var matchingComment = result.comments.find(function(item) {
        return safeText(item && item.video_url) === primaryUrl;
      });
      primaryTitle = safeText(matchingComment && matchingComment.video_title);
      primaryChannel = primaryChannel || safeText(matchingComment && matchingComment.channel_name);
    }
    return {
      video_url: primaryUrl,
      video_id: extractYoutubeVideoId(primaryUrl),
      title: primaryTitle,
      channel_name: primaryChannel,
    };
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
      renderVideoMedia({}, currentDetailsRun || {});
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
    currentDetailsRun = Object.assign({}, currentDetailsRun || {}, {
      video_url: video.url || (currentDetailsRun && currentDetailsRun.video_url) || '',
      video_id: video.id || '',
      title: video.title || (currentDetailsRun && currentDetailsRun.title) || '',
      channel_name: owner.name || (currentDetailsRun && currentDetailsRun.channel_name) || '',
      channel_url: owner.profile_url || (currentDetailsRun && currentDetailsRun.channel_url) || '',
    });
    rememberActiveVideo(currentDetailsRun);
    setDetailsField('youtubeDescriptionText', video.description, '-');
    setDetailsField('youtubeHashtagsText', formatHashtags(video.hashtags), '-');
    renderVideoTitleLink(video, owner, currentDetailsRun || {});
    renderVideoMedia(video, currentDetailsRun || {});
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
    var videoUrl = safeText(result && result.video_url);
    syncActiveVideoFromUrl(videoUrl, {
      title: safeText(result && result.title),
    });
    setCommentSubmitStatus('', false);
    renderGeneratedCommentOptions([]);
    setSuggestionStatus('Load video details to generate comment ideas from transcript/description.', true);
    renderInlineComments(comments, 'No comments loaded for this video.');
    setPreview(els.youtubeRawPreview, result || {});
  }

  function tokenizeReplyText(value) {
    return safeText(value)
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/g)
      .filter(Boolean)
      .filter(function(token) { return token.length > 2; });
  }

  function commentFocusSnippet(comment) {
    var text = safeText(comment);
    if (!text) return '';
    var firstSentence = text.split(/[.!?]\s+/g)[0] || text;
    var trimmed = safeText(firstSentence);
    if (trimmed.length <= 120) return trimmed;
    return trimmed.slice(0, 117) + '...';
  }

  function normalizeReplyCandidate(text) {
    return safeText(text)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .trim();
  }

  function collectUsedRepliesForCurrentRun(excludeRow) {
    var used = new Set();
    var excludeVideo = safeText(excludeRow && excludeRow.video_id);
    var excludeComment = safeText(excludeRow && excludeRow.id);
    toArray(youtubeMinerLastResult && youtubeMinerLastResult.comments).forEach(function(row) {
      var rowVideo = safeText(row && row.video_id);
      var rowComment = safeText(row && row.id);
      if (excludeVideo && excludeComment && rowVideo === excludeVideo && rowComment === excludeComment) return;
      var feedback = readFeedback(row);
      var picked = safeText(feedback && feedback.suggested_response);
      if (picked) used.add(normalizeReplyCandidate(picked));
      toArray(feedback && feedback.offer_feedback).forEach(function(item) {
        if (item && item.selected && safeText(item.response)) {
          used.add(normalizeReplyCandidate(item.response));
        }
      });
    });
    return used;
  }

  function scoreCorpusMatch(entry, row, feedback) {
    var score = 0;
    var rowCats = mergeTargetsUnique(toArray(row && (row.category ? [row.category] : [])), toArray(feedback && feedback.categories)).map(function(v) { return v.toLowerCase(); });
    var rowAttrs = mergeTargetsUnique(toArray(row && (row.attributes || row.attribute_names)), toArray(feedback && feedback.attributes)).map(function(v) { return v.toLowerCase(); });
    var rowApps = mergeTargetsUnique(toArray(row && (row.approach || row.approach_name ? [row.approach || row.approach_name] : [])), toArray(feedback && feedback.approaches)).map(function(v) { return v.toLowerCase(); });
    var entryCats = toArray(entry && entry.categories).map(function(v) { return safeText(v).toLowerCase(); });
    var entryAttrs = toArray(entry && entry.attributes).map(function(v) { return safeText(v).toLowerCase(); });
    var entryApps = toArray(entry && entry.approaches).map(function(v) { return safeText(v).toLowerCase(); });
    rowCats.forEach(function(cat) { if (entryCats.indexOf(cat) >= 0) score += 4; });
    rowAttrs.forEach(function(attr) { if (entryAttrs.indexOf(attr) >= 0) score += 2; });
    rowApps.forEach(function(app) { if (entryApps.indexOf(app) >= 0) score += 3; });
    score += Math.max(0, Math.min(Number(entry && entry.quality) || 0, 5));
    return score;
  }

  function buildReplyLearningProfile(row, feedback) {
    var corpus = collectYoutubeMinerFeedbackCorpus();
    var scored = corpus.map(function(entry) {
      return { entry: entry, score: scoreCorpusMatch(entry, row, feedback) };
    }).sort(function(a, b) { return b.score - a.score; });

    var preferred = [];
    var discouraged = [];
    var preferredApproaches = [];
    scored.forEach(function(item) {
      var entry = item.entry || {};
      if ((Number(entry.quality || 0) >= 4 || item.score >= 8) && safeText(entry.suggested_response)) {
        preferred.push(safeText(entry.suggested_response));
      }
      toArray(entry.offer_feedback).forEach(function(of) {
        var response = safeText(of && of.response);
        var rating = Number(of && of.rating || 0);
        if (!response) return;
        if (rating >= 4 || of && of.selected) preferred.push(response);
        if (rating > 0 && rating <= 2) discouraged.push(response);
      });
      if (Number(entry.quality || 0) >= 4) {
        preferredApproaches = preferredApproaches.concat(toArray(entry.approaches));
      }
      var why = safeText(entry.note + ' ' + entry.category_explain + ' ' + entry.attributes_explain + ' ' + entry.approaches_explain);
      if (/(generic|mindless|template|robot|canned|vague|surface)/i.test(why)) {
        var sample = safeText(entry.suggested_response);
        if (sample) discouraged.push(sample);
      }
    });

    var hardBan = [
      'Appreciate you sharing this.',
      'If you want, I can suggest one simple next step based on your situation.',
      'Would you prefer a quick tactical tip, or a deeper strategy?',
      'What outcome matters most to you from here?',
    ];
    discouraged = mergeTargetsUnique(discouraged, hardBan);

    return {
      preferred: mergeTargetsUnique([], preferred).slice(0, 24),
      discouraged: mergeTargetsUnique([], discouraged).slice(0, 40),
      preferredApproaches: mergeTargetsUnique([], preferredApproaches).slice(0, 12),
    };
  }

  function stripDiscouragedPhrases(text, discouraged) {
    var out = safeText(text);
    toArray(discouraged).forEach(function(phrase) {
      var p = safeText(phrase);
      if (!p) return;
      var escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(escaped, 'ig'), '').replace(/\s{2,}/g, ' ').trim();
    });
    return out;
  }

  function synthesizeReply(row, feedback, learning, variant) {
    var comment = safeText(row && row.text);
    var focus = commentFocusSnippet(comment);
    var category = mergeTargetsUnique(toArray(feedback && feedback.categories), toArray(row && (row.category ? [row.category] : []))).slice(0, 2).join(', ');
    var attributes = mergeTargetsUnique(toArray(feedback && feedback.attributes), toArray(row && (row.attributes || row.attribute_names))).slice(0, 2).join(', ');
    var approaches = mergeTargetsUnique(toArray(feedback && feedback.approaches), toArray(row && (row.approach || row.approach_name ? [row.approach || row.approach_name] : [])));
    var chosenApproach = safeText(approaches[0] || learning.preferredApproaches[0] || 'inquire').toLowerCase();
    var contextEl = document.getElementById('youtubeMinerResponseContext');
    var context = safeText(contextEl && contextEl.value);
    var guidelinesEl = document.getElementById('youtubeMinerGuidelines');
    var guidelines = safeText(guidelinesEl && guidelinesEl.value).toLowerCase();
    var contextHint = '';
    if (/isitas|alignment|self-alignment/i.test(context)) {
      contextHint = ' In ISITAS terms, this reads like a self-alignment moment.';
    }
    var prefix = 'You\'re pointing to something real here';
    if (chosenApproach === 'encourage') prefix = 'This is a strong growth signal';
    if (chosenApproach === 'intrigue') prefix = 'Interesting inflection point';
    if (chosenApproach === 'direct_cta') prefix = 'This looks ready for action';
    if (chosenApproach === 'ignore') prefix = 'This may not need a direct reply';
    var angle = category ? (' around ' + category) : '';
    var persona = attributes ? (' (' + attributes + ')') : '';
    var quote = focus ? (' "' + focus + '"') : '';

    var templates = [
      prefix + angle + persona + '.' + quote + contextHint
        + ' If you had to pick one concrete change for the next 7 days, what would it be?',
      'What I hear in your comment is a transition from old patterns to something more intentional.' + quote
        + (category ? (' The category I\'d map this to is ' + category + '.') : '')
        + ' A practical move is to define one boundary and one new habit this week.',
      'This comment feels directionally clear: you want movement, not more noise.' + quote
        + ' I\'d respond with one focused experiment this week and a quick reflection on what changed.'
        + (contextHint ? contextHint : ''),
      'You already named the core tension.' + quote
        + ' The useful next step is deciding what you\'re done tolerating and what standard replaces it.',
      'There\'s a lot of self-awareness in this.' + quote
        + ' If you turn that into one public commitment, momentum usually follows.',
      'This reads like someone outgrowing an old script.' + quote
        + ' A strong response is to ask: what identity are you ready to practice daily now?',
      'You\'re not confused, you\'re at an inflection point.' + quote
        + ' I\'d challenge this with one measurable action this week and a short debrief after.',
      'I like the honesty here.' + quote
        + ' Consider reframing it as a design question: what environment would make your next version inevitable?'
    ];
    var index = Math.max(0, (Number(variant) || 1) - 1) % templates.length;
    var drafted = stripDiscouragedPhrases(templates[index], learning.discouraged);
    if (guidelines.includes('no links') || guidelines.includes('avoid links')) {
      drafted = drafted.replace(/\s*https?:\/\/\S+/gi, '').trim();
    }
    if (guidelines.includes('no question') || guidelines.includes('avoid question')) {
      drafted = drafted.replace(/\?/g, '.').replace(/\s{2,}/g, ' ').trim();
    }
    return drafted;
  }

  function buildProvideReplyOffersFallback(row, feedback) {
    var explicitSuggestion = safeText(feedback && feedback.suggested_response);
    var learning = buildReplyLearningProfile(row, feedback);
    var usedInRun = collectUsedRepliesForCurrentRun(row);
    var offers = [];
    var seen = new Set();

    function pushUnique(candidate) {
      var text = safeText(candidate);
      if (!text) return;
      var cleaned = stripDiscouragedPhrases(text, learning.discouraged);
      var normalized = normalizeReplyCandidate(cleaned);
      if (!normalized) return;
      if (seen.has(normalized)) return;
      if (usedInRun.has(normalized)) return;
      seen.add(normalized);
      offers.push(cleaned);
    }

    if (explicitSuggestion) pushUnique(explicitSuggestion);

    var variant = 1;
    while (offers.length < 3 && variant <= 24) {
      pushUnique(synthesizeReply(row, feedback, learning, variant));
      variant += 1;
    }

    if (offers.length < 3) {
      var focus = commentFocusSnippet(safeText(row && row.text));
      while (offers.length < 3) {
        var idx = offers.length + 1;
        var fallback = 'I hear you. ' + (focus ? ('You said "' + focus + '". ') : '')
          + 'If you had to choose one next move today, what would it be (' + idx + ')?';
        var normalizedFallback = normalizeReplyCandidate(fallback);
        if (!seen.has(normalizedFallback)) {
          seen.add(normalizedFallback);
          offers.push(fallback);
        } else {
          offers.push(fallback + ' ');
        }
      }
    }

    return offers.slice(0, 3);
  }

  async function fetchAiProvideReplyOffers(row, feedback, learning) {
    var contextEl = document.getElementById('youtubeMinerResponseContext');
    var contextValue = safeText(contextEl && contextEl.value);
    var guidelinesEl = document.getElementById('youtubeMinerGuidelines');
    var guidelinesValue = safeText(guidelinesEl && guidelinesEl.value);
    var usedInRun = Array.from(collectUsedRepliesForCurrentRun(row));
    var payload = {
      comment: safeText(row && row.text),
      video_title: safeText(row && row.video_title),
      video_id: safeText(row && row.video_id),
      categories: mergeTargetsUnique(toArray(feedback && feedback.categories), toArray(row && (row.category ? [row.category] : []))),
      attributes: mergeTargetsUnique(toArray(feedback && feedback.attributes), toArray(row && (row.attributes || row.attribute_names))),
      approaches: mergeTargetsUnique(toArray(feedback && feedback.approaches), toArray(row && (row.approach || row.approach_name ? [row.approach || row.approach_name] : []))),
      training_notes: safeText([
        feedback && feedback.note,
        feedback && feedback.category_explain,
        feedback && feedback.attributes_explain,
        feedback && feedback.approaches_explain
      ].join(' ')),
      response_context: contextValue,
      response_guidelines: guidelinesValue,
      discouraged_phrases: toArray(learning && learning.discouraged),
      used_replies: usedInRun,
    };
    var res = await api('/api/acquire/youtube-reply-offers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    var offers = toArray(res && res.offers).map(function(item) {
      return {
        text: safeText(item && item.text),
        why: safeText(item && item.why),
      };
    }).filter(function(item) { return item.text; });
    return offers.slice(0, 3);
  }

  async function buildProvideReplyOffers(row, feedback) {
    var learning = buildReplyLearningProfile(row, feedback);
    var aiOffers = await fetchAiProvideReplyOffers(row, feedback, learning);
    if (aiOffers.length < 3) {
      throw new Error('AI returned fewer than 3 reply offers');
    }
    return aiOffers.slice(0, 3);
  }

  async function openProvideRepliesModal(row, feedback, onPick) {
    if (!App.components || !App.components.Modal) {
      notify('Reply picker modal is unavailable', true);
      return;
    }
    var offersWithWhy = await buildProvideReplyOffers(row, feedback);
    var offers = offersWithWhy.map(function(item) { return safeText(item && item.text); }).filter(Boolean);
    while (offers.length < 3) offers.push('');
    offers = offers.slice(0, 3);
    var selectedIndex = 0;
    var body = document.createElement('div');
    body.className = 'youtube-miner-reply-picker';
    var intro = document.createElement('p');
    intro.className = 'muted';
    intro.textContent = 'Select the best reply offer:';
    body.appendChild(intro);
    var existingOfferFeedback = toArray(feedback && feedback.offer_feedback);
    var offerFeedback = offers.map(function(offer, idx) {
      var existing = existingOfferFeedback.find(function(item) {
        return Number(item && item.index) === idx
          || safeText(item && item.response) === safeText(offer);
      });
      var aiWhy = safeText(offersWithWhy[idx] && offersWithWhy[idx].why);
      return {
        index: idx,
        response: safeText(offer),
        rating: Math.max(0, Math.min(Number(existing && existing.rating) || 0, 5)),
        why: safeText(existing && existing.why) || aiWhy,
        selected: idx === 0,
      };
    });

    offers.forEach(function(offer, idx) {
      var label = document.createElement('label');
      label.className = 'youtube-miner-reply-offer';
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'ytMinerReplyOffer';
      radio.value = String(idx);
      radio.checked = idx === 0;
      radio.addEventListener('change', function() {
        selectedIndex = idx;
      });
      var text = document.createElement('textarea');
      text.rows = 4;
      text.value = offer;
      text.addEventListener('input', function() {
        offers[idx] = safeText(text.value);
        offerFeedback[idx].response = safeText(text.value);
      });
      var rateLabel = document.createElement('span');
      rateLabel.className = 'youtube-miner-reply-mini-label';
      rateLabel.textContent = 'Rating';
      var rateInput = document.createElement('select');
      rateInput.className = 'youtube-miner-reply-rating';
      rateInput.innerHTML = ''
        + '<option value="0">\u2606\u2606\u2606\u2606\u2606</option>'
        + '<option value="1">\u2605\u2606\u2606\u2606\u2606</option>'
        + '<option value="2">\u2605\u2605\u2606\u2606\u2606</option>'
        + '<option value="3">\u2605\u2605\u2605\u2606\u2606</option>'
        + '<option value="4">\u2605\u2605\u2605\u2605\u2606</option>'
        + '<option value="5">\u2605\u2605\u2605\u2605\u2605</option>';
      rateInput.value = String(Math.max(0, Math.min(Number(offerFeedback[idx].rating) || 0, 5)));
      rateInput.addEventListener('change', function() {
        offerFeedback[idx].rating = Math.max(0, Math.min(Number(rateInput.value) || 0, 5));
      });
      var whyLabel = document.createElement('span');
      whyLabel.className = 'youtube-miner-reply-mini-label';
      whyLabel.textContent = 'Why?';
      var whyInput = document.createElement('input');
      whyInput.type = 'text';
      whyInput.className = 'youtube-miner-reply-why';
      whyInput.placeholder = 'Why this works / fails';
      whyInput.value = safeText(offerFeedback[idx].why);
      whyInput.addEventListener('input', function() {
        offerFeedback[idx].why = safeText(whyInput.value);
      });
      var meta = document.createElement('div');
      meta.className = 'youtube-miner-reply-meta';
      meta.appendChild(rateLabel);
      meta.appendChild(rateInput);
      meta.appendChild(whyLabel);
      meta.appendChild(whyInput);
      label.appendChild(radio);
      label.appendChild(text);
      label.appendChild(meta);
      body.appendChild(label);
    });

    var modal = App.components.Modal({
      title: 'Provide Replies',
      dialogClass: 'youtube-miner-replies-modal',
      bodyClass: 'youtube-miner-replies-modal-body',
      body: body,
      actions: [
        { label: 'Cancel', onClick: function() { modal.close(); } },
        {
          label: 'Use Selected',
          primary: true,
          onClick: function() {
            var selected = safeText(offers[selectedIndex] || offers[0] || '');
            if (!selected) return notify('Selected reply is empty', true);
            offerFeedback.forEach(function(item, idx) {
              item.selected = idx === selectedIndex;
              item.response = safeText(offers[idx] || item.response);
            });
            modal.close();
            onPick(selected, offerFeedback);
          }
        }
      ],
    });
    modal.open();
  }

  function openScoreBreakdownModal(row) {
    if (!App.components || !App.components.Modal) {
      notify('Score details modal is unavailable', true);
      return;
    }
    var wrap = document.createElement('div');
    wrap.className = 'youtube-miner-score-modal';
    var score = Number(row && row.score || 0) || 0;
    var title = document.createElement('h4');
    title.textContent = 'Score: ' + String(score);
    wrap.appendChild(title);

    var whyList = document.createElement('ul');
    var whyItems = toArray(row && row.why).filter(Boolean);
    if (!whyItems.length) {
      var empty = document.createElement('li');
      empty.textContent = 'No scoring reasons were recorded for this row.';
      whyList.appendChild(empty);
    } else {
      whyItems.forEach(function(reason) {
        var li = document.createElement('li');
        li.textContent = String(reason);
        whyList.appendChild(li);
      });
    }
    wrap.appendChild(whyList);

    var meta = document.createElement('div');
    meta.className = 'youtube-miner-score-meta';
    var bits = [
      ['Category', safeText(row && row.category) || '-'],
      ['Category Rank', String(Number(row && row.category_value_rank || 0) || 0)],
      ['Attributes', toArray(row && (row.attributes || row.attribute_names)).join(', ') || '-'],
      ['Approach', safeText(row && (row.approach || row.approach_name)) || '-'],
      ['Hashtags', toArray(row && (row.hashtags || row.tags)).join(', ') || '-'],
      ['Noise Flag', row && row.is_noise ? 'Yes' : 'No'],
    ];
    bits.forEach(function(pair) {
      var p = document.createElement('p');
      p.innerHTML = '<strong>' + escapeHtml(pair[0]) + ':</strong> ' + escapeHtml(pair[1]);
      meta.appendChild(p);
    });
    wrap.appendChild(meta);

    var modal = App.components.Modal({
      title: 'Score Breakdown',
      body: wrap,
      actions: [{ label: 'Close', primary: true, onClick: function() { modal.close(); } }],
    });
    modal.open();
  }

  function getFilteredYoutubeCommentRows(activeResult) {
    var result = activeResult && typeof activeResult === 'object' ? activeResult : (youtubeMinerLastResult || {});
    var comments = toArray(result && result.comments).slice(0, 200);
    var videoInput = document.getElementById('youtubeMinerContentVideoFilter');
    var topicInput = document.getElementById('youtubeMinerContentTopicFilter');
    var approachInput = document.getElementById('youtubeMinerContentApproachFilter');
    var authorInput = document.getElementById('youtubeMinerContentAuthorFilter');
    var commentInput = document.getElementById('youtubeMinerContentCommentFilter');
    var videoFilter = safeText(videoInput && videoInput.value).toLowerCase();
    var topicFilter = safeText(topicInput && topicInput.value);
    var approachFilter = safeText(approachInput && approachInput.value);
    var authorFilter = safeText(authorInput && authorInput.value).toLowerCase();
    var commentFilter = safeText(commentInput && commentInput.value).toLowerCase();

    return comments.filter(function(row) {
      var rowFeedback = readFeedback(row);
      if (rowFeedback && rowFeedback.ignored) return false;
      var rowVideo = safeText(row && row.video_title).toLowerCase();
      var rowTopic = rowFeedback && rowFeedback.categories.length
        ? safeText(rowFeedback.categories[0])
        : safeText(row && row.category);
      var rowApproach = rowFeedback && rowFeedback.approaches.length
        ? safeText(rowFeedback.approaches[0])
        : safeText(row && (row.approach || row.approach_name));
      var rowAuthor = safeText(row && row.author).toLowerCase();
      var rowComment = safeText(row && row.text).toLowerCase();
      if (videoFilter && rowVideo.indexOf(videoFilter) === -1) return false;
      if (topicFilter && rowTopic !== topicFilter) return false;
      if (approachFilter && rowApproach !== approachFilter) return false;
      if (authorFilter && rowAuthor.indexOf(authorFilter) === -1) return false;
      if (commentFilter && rowComment.indexOf(commentFilter) === -1) return false;
      return true;
    });
  }

  function highlightFilterMatch(text, query) {
    var rawText = String(text || '');
    var needle = safeText(query);
    if (!needle) return escapeHtml(rawText);
    var lowerHaystack = rawText.toLowerCase();
    var lowerNeedle = needle.toLowerCase();
    var start = 0;
    var html = '';
    var index = lowerHaystack.indexOf(lowerNeedle, start);
    if (index === -1) return escapeHtml(rawText);
    while (index !== -1) {
      html += escapeHtml(rawText.slice(start, index));
      html += '<mark class="youtube-comment-highlight">' + escapeHtml(rawText.slice(index, index + needle.length)) + '</mark>';
      start = index + needle.length;
      index = lowerHaystack.indexOf(lowerNeedle, start);
    }
    html += escapeHtml(rawText.slice(start));
    return html;
  }

  function truncateText(value, limit) {
    var raw = safeText(value);
    var max = Math.max(1, Number(limit) || 100);
    if (!raw || raw.length <= max) return raw;
    var clipped = raw.slice(0, max + 1);
    var lastSpace = clipped.lastIndexOf(' ');
    if (lastSpace >= Math.floor(max * 0.65)) {
      clipped = clipped.slice(0, lastSpace);
    } else {
      clipped = clipped.slice(0, max);
    }
    return clipped.trimEnd() + '...';
  }

  function buildYoutubeCommentFeedbackControl(row, feedback) {
    var wrap = document.createElement('div');
    wrap.className = 'youtube-miner-feedback-wrap';

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'youtube-miner-feedback-icon' + (feedbackHasReview(feedback) ? ' has-feedback' : '');
    button.textContent = '\u270E';
    button.title = 'Training feedback';
    wrap.appendChild(button);

    var pop = document.createElement('div');
    pop.className = 'youtube-miner-feedback-pop hidden';

    var heading = document.createElement('h4');
    heading.textContent = 'Training Feedback';
    pop.appendChild(heading);

    function selectedValues(selectEl) {
      return Array.prototype.slice.call(selectEl && selectEl.options || [])
        .filter(function(option) { return option.selected; })
        .map(function(option) { return safeText(option.value); })
        .filter(Boolean);
    }

    function placeFeedbackPopup() {
      if (pop.classList.contains('hidden')) return;
      pop.style.left = '16px';
      pop.style.top = '16px';
      pop.style.maxHeight = 'calc(100vh - 24px)';
      pop.style.width = 'min(960px, 88vw)';
      var anchorRect = wrap.getBoundingClientRect();
      var popRect = pop.getBoundingClientRect();
      var margin = 10;
      var left = anchorRect.left - popRect.width - 12;
      if (left < margin) {
        left = anchorRect.right + 12;
      }
      if (left + popRect.width > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - popRect.width - margin);
      }
      var top = anchorRect.top - 8;
      var maxTop = Math.max(margin, window.innerHeight - popRect.height - margin);
      if (top > maxTop) top = maxTop;
      if (top < margin) top = margin;
      pop.style.left = Math.round(left) + 'px';
      pop.style.top = Math.round(top) + 'px';
    }

    var qualityRow = document.createElement('div');
    qualityRow.className = 'form-row';
    var qualityLabel = document.createElement('label');
    qualityLabel.textContent = 'Quality (1-5)';
    var qualityInput = document.createElement('select');
    qualityInput.innerHTML = '<option value="0">0 (unset)</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option>';
    qualityInput.value = String(feedback.quality || 0);
    qualityRow.appendChild(qualityLabel);
    qualityRow.appendChild(qualityInput);
    pop.appendChild(qualityRow);

    var catRow = document.createElement('div');
    catRow.className = 'form-row youtube-miner-feedback-factor-row';
    var catLabel = document.createElement('label');
    catLabel.textContent = 'Category (multi-select)';
    var catInput = document.createElement('select');
    catInput.multiple = true;
    catInput.size = 5;
    youtubeMinerCategoryConfig.map(function(item) {
      return safeText(item && (item.name || item.label));
    }).filter(Boolean).forEach(function(topic) {
      var option = document.createElement('option');
      option.value = topic;
      option.textContent = topic;
      option.selected = feedback.categories.indexOf(topic) >= 0;
      catInput.appendChild(option);
    });
    var catExplain = document.createElement('input');
    catExplain.type = 'text';
    catExplain.placeholder = 'Explain';
    catExplain.value = safeText(feedback.category_explain);
    catRow.appendChild(catLabel);
    catRow.appendChild(catInput);
    catRow.appendChild(catExplain);
    pop.appendChild(catRow);

    var attrRow = document.createElement('div');
    attrRow.className = 'form-row youtube-miner-feedback-factor-row';
    var attrLabel = document.createElement('label');
    attrLabel.textContent = 'Attributes (multi-select)';
    var attrInput = document.createElement('select');
    attrInput.multiple = true;
    attrInput.size = 5;
    youtubeMinerAttributeConfig.map(function(item) {
      return safeText(item && (item.name || item.label));
    }).filter(Boolean).forEach(function(attribute) {
      var option = document.createElement('option');
      option.value = attribute;
      option.textContent = attribute;
      option.selected = feedback.attributes.indexOf(attribute) >= 0;
      attrInput.appendChild(option);
    });
    var attrExplain = document.createElement('input');
    attrExplain.type = 'text';
    attrExplain.placeholder = 'Explain';
    attrExplain.value = safeText(feedback.attributes_explain);
    attrRow.appendChild(attrLabel);
    attrRow.appendChild(attrInput);
    attrRow.appendChild(attrExplain);
    pop.appendChild(attrRow);

    var approachRow = document.createElement('div');
    approachRow.className = 'form-row youtube-miner-feedback-factor-row';
    var approachLabel = document.createElement('label');
    approachLabel.textContent = 'Approach (multi-select)';
    var approachInput = document.createElement('select');
    approachInput.multiple = true;
    approachInput.size = 5;
    youtubeMinerApproachConfig.map(function(item) {
      return safeText(item && (item.name || item.label));
    }).filter(Boolean).forEach(function(approach) {
      var option = document.createElement('option');
      option.value = approach;
      option.textContent = approach;
      option.selected = feedback.approaches.indexOf(approach) >= 0;
      approachInput.appendChild(option);
    });
    var approachExplain = document.createElement('input');
    approachExplain.type = 'text';
    approachExplain.placeholder = 'Explain';
    approachExplain.value = safeText(feedback.approaches_explain);
    approachRow.appendChild(approachLabel);
    approachRow.appendChild(approachInput);
    approachRow.appendChild(approachExplain);
    pop.appendChild(approachRow);

    var noteRow = document.createElement('div');
    noteRow.className = 'form-row';
    var noteLabel = document.createElement('label');
    noteLabel.textContent = 'What do you like about this comment?';
    var noteInput = document.createElement('textarea');
    noteInput.rows = 8;
    noteInput.placeholder = 'Explain what makes this comment valuable, what signals matter, and what reply style would fit.';
    noteInput.value = safeText(feedback.note);
    noteRow.appendChild(noteLabel);
    noteRow.appendChild(noteInput);
    pop.appendChild(noteRow);

    var suggestedRow = document.createElement('div');
    suggestedRow.className = 'form-row';
    var suggestedLabel = document.createElement('label');
    suggestedLabel.textContent = 'Suggested Response';
    var suggestedInput = document.createElement('textarea');
    suggestedInput.rows = 4;
    suggestedInput.placeholder = 'Optional: write the exact style or sample response you would want here.';
    suggestedInput.value = safeText(feedback.suggested_response);
    suggestedRow.appendChild(suggestedLabel);
    suggestedRow.appendChild(suggestedInput);
    pop.appendChild(suggestedRow);

    var actionRow = document.createElement('div');
    actionRow.className = 'youtube-miner-feedback-actions';
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'youtube-miner-inline-action';
    closeBtn.textContent = 'Close';
    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'youtube-miner-inline-action';
    saveBtn.textContent = 'Save Feedback';
    actionRow.appendChild(closeBtn);
    actionRow.appendChild(saveBtn);
    pop.appendChild(actionRow);

    closeBtn.addEventListener('click', function() {
      pop.classList.add('hidden');
    });

    saveBtn.addEventListener('click', function() {
      var selectedCategories = selectedValues(catInput);
      var selectedAttributes = selectedValues(attrInput);
      var selectedApproaches = selectedValues(approachInput);
      saveFeedback(row, {
        quality: Number(qualityInput.value || 0),
        categories: selectedCategories,
        category_explain: catExplain.value,
        attributes: selectedAttributes,
        attributes_explain: attrExplain.value,
        approaches: selectedApproaches,
        approaches_explain: approachExplain.value,
        note: safeText(noteInput.value),
        response_type: selectedApproaches[0] || '',
        suggested_response: suggestedInput.value,
      });
      button.classList.toggle('has-feedback', feedbackHasReview(readFeedback(row)));
      pop.classList.add('hidden');
      notify('Training feedback saved');
      renderYoutubeCommentMinerResult();
    });

    button.addEventListener('click', function(event) {
      event.preventDefault();
      event.stopPropagation();
      document.querySelectorAll('.youtube-miner-feedback-pop').forEach(function(node) {
        if (node !== pop) node.classList.add('hidden');
      });
      var isHidden = pop.classList.contains('hidden');
      pop.classList.toggle('hidden', !isHidden);
      if (isHidden) placeFeedbackPopup();
    });

    wrap.appendChild(pop);
    return wrap;
  }

  function pruneSelectedYoutubeCommentRows(activeResult) {
    var validIds = new Set(getFilteredYoutubeCommentRows(activeResult).map(getCommentSelectionKey).filter(Boolean));
    Array.from(selectedCommentRowIds).forEach(function(id) {
      if (!validIds.has(id)) selectedCommentRowIds.delete(id);
    });
  }

  function syncYoutubeCommentBulkSelectionUi(activeResult) {
    var selectAll = document.getElementById('youtubeCommentMinerSelectAllVisible');
    var editBtn = document.getElementById('youtubeCommentMinerEditSelectedBtn');
    var deleteBtn = document.getElementById('youtubeCommentMinerDeleteSelectedBtn');
    var addContactBtn = document.getElementById('youtubeCommentMinerAddContactBtn');
    var visibleRows = getFilteredYoutubeCommentRows(activeResult);
    var visibleIds = visibleRows.map(getCommentSelectionKey).filter(Boolean);
    var selectedVisible = visibleIds.filter(function(id) { return selectedCommentRowIds.has(id); });
    if (selectAll) {
      selectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
      selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
    }
    if (editBtn) {
      editBtn.disabled = selectedVisible.length === 0;
    }
    if (deleteBtn) {
      deleteBtn.disabled = selectedVisible.length === 0;
    }
    if (addContactBtn) {
      addContactBtn.disabled = visibleRows.filter(function(row) {
        return selectedCommentRowIds.has(getCommentSelectionKey(row))
          && (safeText(row && row.author_channel_url) || safeText(row && row.author_channel_id) || safeText(row && row.author));
      }).length === 0;
    }
  }

  function bulkUpdateSelectedYoutubeComments() {
    var topicInput = document.getElementById('youtubeMinerContentTopicFilter');
    var approachInput = document.getElementById('youtubeMinerContentApproachFilter');
    var selectedTopic = safeText(topicInput && topicInput.value);
    var selectedApproach = safeText(approachInput && approachInput.value);
    if (!selectedTopic && !selectedApproach) {
      notify('Select a Topic or Approach filter before using Edit Selected.', true);
      return;
    }
    var selectedRows = getFilteredYoutubeCommentRows(youtubeMinerLastResult || {}).filter(function(row) {
      return selectedCommentRowIds.has(getCommentSelectionKey(row));
    });
    if (!selectedRows.length) {
      notify('No checked comment rows are available to edit.', true);
      return;
    }
    selectedRows.forEach(function(row) {
      var patch = {};
      if (selectedTopic) patch.categories = [selectedTopic];
      if (selectedApproach) {
        patch.approaches = [selectedApproach];
        patch.response_type = selectedApproach;
      }
      saveFeedback(row, patch);
    });
    notify('Updated ' + selectedRows.length + ' checked comment row' + (selectedRows.length === 1 ? '' : 's'));
    renderYoutubeCommentMinerResult();
  }

  function bulkDeleteSelectedYoutubeComments() {
    var selectedRows = getFilteredYoutubeCommentRows(youtubeMinerLastResult || {}).filter(function(row) {
      return selectedCommentRowIds.has(getCommentSelectionKey(row));
    });
    if (!selectedRows.length) {
      notify('No checked comment rows are available to delete.', true);
      return;
    }
    selectedRows.forEach(function(row) {
      var currentFeedback = readFeedback(row);
      var nextApproaches = toArray(currentFeedback && currentFeedback.approaches);
      if (nextApproaches.indexOf('ignore') === -1) nextApproaches.push('ignore');
      saveFeedback(row, {
        ignored: true,
        approaches: nextApproaches,
        response_type: 'ignore',
      });
      selectedCommentRowIds.delete(getCommentSelectionKey(row));
    });
    notify('Deleted ' + selectedRows.length + ' checked comment row' + (selectedRows.length === 1 ? '' : 's'));
    renderYoutubeCommentMinerResult();
  }

  async function addContactsFromSelectedYoutubeComments() {
    var selectedRows = getFilteredYoutubeCommentRows(youtubeMinerLastResult || {}).filter(function(row) {
      return selectedCommentRowIds.has(getCommentSelectionKey(row));
    });
    var deduped = [];
    var seen = new Set();
    selectedRows.forEach(function(row) {
      var authorName = safeText(row && row.author);
      var authorChannelId = safeText(row && row.author_channel_id);
      var authorUrl = safeText(row && row.author_channel_url)
        || (authorChannelId ? ('https://www.youtube.com/channel/' + encodeURIComponent(authorChannelId)) : '')
        || (authorName && authorName.charAt(0) === '@' ? ('https://www.youtube.com/' + authorName) : '');
      var key = safeText(authorChannelId || authorUrl || authorName).toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      deduped.push({
        row: row,
        authorName: authorName,
        authorUrl: authorUrl,
      });
    });
    if (!deduped.length) {
      notify('No checked comment authors are available to add as contacts.', true);
      return;
    }
    var results = await Promise.all(deduped.map(function(item) {
      var row = item.row;
      var payload = {
        contactType: 'prospect',
        company: item.authorName,
        youtube: item.authorUrl,
        source: 'acquire.youtube.comments',
        status: 'captured',
        tags: [safeText(row && row.category)].filter(Boolean),
        notes: [
          'Captured from YouTube comment author.',
          safeText(row && row.video_title) ? ('Video: ' + safeText(row && row.video_title)) : '',
          safeText(row && row.text) ? ('Comment: ' + safeText(row && row.text)) : '',
        ].filter(Boolean).join('\n'),
      };
      return api('/api/contacts', {
        method: 'POST',
        body: JSON.stringify(payload),
      }).then(function() {
        return { ok: true };
      }).catch(function(err) {
        return { ok: false, error: err };
      });
    }));
    var created = results.filter(function(item) { return item.ok; }).length;
    var failed = results.filter(function(item) { return !item.ok; }).length;
    notify('Add Contact complete: ' + created + ' created, ' + failed + ' failed');
  }

  function renderYoutubeCommentMinerResult(result) {
    if (result && typeof result === 'object') {
      youtubeMinerLastResult = result;
      saveYoutubeMinerLastResult(result);
    }
    var activeResult = youtubeMinerLastResult || {};
    var summaryEl = document.getElementById('youtubeCommentMinerSummary');
    var tableEl = document.getElementById('youtubeCommentMinerTable');
    var metaEl = document.getElementById('youtubeCommentMinerMeta');
    if (!summaryEl || !tableEl) return;

    var stats = activeResult && activeResult.stats ? activeResult.stats : {};
    var comments = toArray(activeResult && activeResult.comments).slice(0, 200);
    var topicInput = document.getElementById('youtubeMinerContentTopicFilter');
    var approachInput = document.getElementById('youtubeMinerContentApproachFilter');
    var commentFilterInput = document.getElementById('youtubeMinerContentCommentFilter');
    var commentFilterQuery = safeText(commentFilterInput && commentFilterInput.value);

    if (topicInput) {
      var categories = Array.from(new Set(comments.map(function(row) {
        return safeText(row && row.category);
      }).filter(Boolean))).sort(function(a, b) {
        return a.localeCompare(b);
      });
      var previousValue = safeText(topicInput.value);
      topicInput.innerHTML = '<option value="">All Topics</option>';
      categories.forEach(function(cat) {
        var option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        option.selected = previousValue === cat;
        topicInput.appendChild(option);
      });
    }
    if (approachInput) {
      var approaches = Array.from(new Set(comments.map(function(row) {
        return safeText(row && (row.approach || row.approach_name));
      }).filter(Boolean))).sort(function(a, b) {
        return a.localeCompare(b);
      });
      var previousApproach = safeText(approachInput.value);
      approachInput.innerHTML = '<option value="">All Approaches</option>';
      approaches.forEach(function(approach) {
        var option = document.createElement('option');
        option.value = approach;
        option.textContent = approach;
        option.selected = previousApproach === approach;
        approachInput.appendChild(option);
      });
    }

    comments = getFilteredYoutubeCommentRows(activeResult);
    pruneSelectedYoutubeCommentRows(activeResult);
    comments.sort(function(a, b) {
      var scoreA = Number(a && a.score || 0) || 0;
      var scoreB = Number(b && b.score || 0) || 0;
      return scoreB - scoreA;
    });

    var activeVideoUrl = getActiveVideoUrl();
    var matchingActiveRow = comments.find(function(row) {
      return safeText(row && row.video_url) && safeText(row && row.video_url) === activeVideoUrl;
    });
    var selectedVideoRow = matchingActiveRow || comments[0] || null;
    if (selectedVideoRow && safeText(selectedVideoRow.video_url)) {
      syncActiveVideoFromUrl(selectedVideoRow.video_url, {
        title: safeText(selectedVideoRow.video_title),
        channel_name: safeText(selectedVideoRow.channel_name),
      });
    }

    var harvestedVideos = Number(stats.harvested_videos || 0) || 0;
    var totalRaw = Number(stats.total_comments_raw || 0) || 0;
    var totalFiltered = Number(stats.total_comments_filtered || 0) || 0;
    var reviewedCount = comments.reduce(function(count, row) {
      return count + (feedbackHasReview(readFeedback(row)) ? 1 : 0);
    }, 0);
    summaryEl.textContent = 'Videos harvested: ' + harvestedVideos + ' | Raw comments: ' + totalRaw + ' | Filtered comments: ' + totalFiltered + ' | Visible rows: ' + comments.length + ' | Reviewed: ' + reviewedCount;

    if (metaEl) {
      metaEl.textContent = App.prettyJson({
        input: activeResult && activeResult.input ? activeResult.input : {},
        stats: stats,
        category_counts: activeResult && activeResult.category_counts ? activeResult.category_counts : {},
        attribute_counts: activeResult && activeResult.attribute_counts ? activeResult.attribute_counts : {},
        approach_counts: activeResult && activeResult.approach_counts ? activeResult.approach_counts : {},
        hashtag_counts: activeResult && (activeResult.hashtag_counts || activeResult.tag_counts)
          ? (activeResult.hashtag_counts || activeResult.tag_counts)
          : {},
        warnings: toArray(activeResult && activeResult.warnings),
        errors: toArray(activeResult && activeResult.errors),
      });
    }

    tableEl.innerHTML = '';
    if (!comments.length) {
      var emptyTr = document.createElement('tr');
      var emptyTd = document.createElement('td');
      emptyTd.colSpan = 8;
      emptyTd.textContent = 'No filtered comments found for current settings.';
      emptyTr.appendChild(emptyTd);
      tableEl.appendChild(emptyTr);
      syncYoutubeCommentBulkSelectionUi(activeResult);
      return;
    }

    comments.forEach(function(row) {
      var tr = document.createElement('tr');
      var selectionKey = getCommentSelectionKey(row);
      var feedback = readFeedback(row);
      var isReviewedRow = feedbackHasReview(feedback);
      var isIgnoredRow = Boolean(feedback && feedback.ignored);
      if (isReviewedRow) tr.classList.add('youtube-miner-row-reviewed');
      if (isIgnoredRow) tr.classList.add('youtube-miner-row-ignored');

      var selectTd = document.createElement('td');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedCommentRowIds.has(selectionKey);
      checkbox.disabled = !selectionKey;
      checkbox.setAttribute('aria-label', 'Select comment by ' + (safeText(row && row.author) || 'author'));
      checkbox.addEventListener('change', function() {
        if (checkbox.checked) selectedCommentRowIds.add(selectionKey);
        else selectedCommentRowIds.delete(selectionKey);
        syncYoutubeCommentBulkSelectionUi(activeResult);
      });
      selectTd.appendChild(checkbox);

      var videoTd = document.createElement('td');
      var videoTitle = safeText(row && row.video_title) || safeText(row && row.video_id) || '-';
      var videoUrl = safeText(row && row.video_url);
      if (videoUrl) {
        var link = document.createElement('a');
        link.href = videoUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = videoTitle;
        link.addEventListener('click', function() {
          syncActiveVideoFromUrl(videoUrl, {
            title: videoTitle,
            channel_name: safeText(row && row.channel_name),
          });
        });
        videoTd.appendChild(link);
      } else {
        videoTd.textContent = videoTitle;
      }

      var authorTd = document.createElement('td');
      var authorName = safeText(row && row.author) || '-';
      var authorUrl = safeText(row && row.author_channel_url);
      var authorChannelId = safeText(row && row.author_channel_id);
      if (!authorUrl && authorChannelId) {
        authorUrl = 'https://www.youtube.com/channel/' + encodeURIComponent(authorChannelId);
      }
      if (!authorUrl && authorName.startsWith('@')) {
        authorUrl = 'https://www.youtube.com/' + authorName;
      }
      if (authorUrl) {
        var authorLink = document.createElement('a');
        authorLink.href = authorUrl;
        authorLink.target = '_blank';
        authorLink.rel = 'noopener noreferrer';
        authorLink.textContent = authorName;
        authorTd.appendChild(authorLink);
      } else {
        authorTd.textContent = authorName;
      }

      var topicTd = document.createElement('td');
      topicTd.textContent = (feedback.categories.length ? feedback.categories[0] : safeText(row && row.category)) || '-';

      var commentTd = document.createElement('td');
      var commentText = document.createElement('div');
      var fullCommentText = safeText(row && row.text) || '-';
      commentText.className = 'youtube-miner-comment-text is-truncated';
      commentText.innerHTML = highlightFilterMatch(truncateText(fullCommentText, 200) || '-', commentFilterQuery);
      commentText.title = fullCommentText;
      commentTd.appendChild(commentText);

      var replyTd = document.createElement('td');
      var replyWrap = document.createElement('div');
      replyWrap.className = 'youtube-miner-reply-cell';
      var replyText = document.createElement('div');
      var fullReplyText = safeText(feedback && feedback.suggested_response) || '-';
      replyText.className = 'youtube-miner-reply-text';
      replyText.textContent = truncateText(fullReplyText, 100) || '-';
      replyText.title = fullReplyText;
      replyWrap.appendChild(replyText);
      var replyBtn = document.createElement('button');
      replyBtn.type = 'button';
      replyBtn.className = 'tiny-btn youtube-miner-provide-replies-btn';
      var ignoreBtn = document.createElement('button');
      ignoreBtn.type = 'button';
      ignoreBtn.className = 'tiny-btn youtube-miner-ignore-btn';
      function updateProvideRepliesBtnState() {
        var currentFeedback = readFeedback(row);
        ignoreBtn.textContent = 'Ignore';
        ignoreBtn.classList.remove('is-ignored');
        tr.classList.remove('youtube-miner-row-ignored');
        var hasSubmittedRepliesForm = toArray(currentFeedback && currentFeedback.offer_feedback).some(function(item) {
          return Boolean(
            item
            && (
              item.selected === true
              || Number(item.rating || 0) > 0
              || safeText(item.why)
              || safeText(item.response)
            )
          );
        });
        replyBtn.classList.toggle('is-ready', hasSubmittedRepliesForm);
        replyBtn.classList.toggle('is-pending', !hasSubmittedRepliesForm);
        replyBtn.textContent = hasSubmittedRepliesForm ? 'Replies Provided' : 'Provide Replies';
      }
      updateProvideRepliesBtnState();
      ignoreBtn.addEventListener('click', function() {
        var currentFeedback = readFeedback(row);
        if (Boolean(currentFeedback && currentFeedback.ignored)) {
          notify('Comment already ignored');
          return;
        }
        var nextApproaches = toArray(currentFeedback && currentFeedback.approaches);
        if (nextApproaches.indexOf('ignore') === -1) nextApproaches.push('ignore');
        saveFeedback(row, {
          ignored: true,
          approaches: nextApproaches,
          response_type: 'ignore',
        });
        notify('Comment marked ignore');
        renderYoutubeCommentMinerResult(youtubeMinerLastResult || {});
      });
      replyBtn.addEventListener('click', function() {
        openProvideRepliesModal(row, feedback, function(selected, offerFeedback) {
          row.reply_draft = selected;
          replyText.textContent = truncateText(selected, 100) || '-';
          replyText.title = selected;
          saveFeedback(row, {
            suggested_response: selected,
            offer_feedback: offerFeedback,
          });
          updateProvideRepliesBtnState();
          renderYoutubeCommentMinerResult();
        });
      });
      replyWrap.appendChild(replyBtn);
      replyWrap.appendChild(ignoreBtn);
      replyTd.appendChild(replyWrap);

      var feedbackTd = document.createElement('td');
      var feedbackCellWrap = document.createElement('div');
      feedbackCellWrap.className = 'youtube-miner-feedback-cell';
      feedbackCellWrap.appendChild(buildYoutubeCommentFeedbackControl(row, feedback));
      var feedbackSummary = document.createElement('div');
      feedbackSummary.textContent = feedback.quality > 0
        ? ('Q' + String(feedback.quality)
          + (feedback.categories.length ? (' | ' + feedback.categories.join(', ')) : '')
          + (feedback.approaches.length ? (' | ' + feedback.approaches.join(', ')) : ''))
        : (isReviewedRow ? 'Reviewed' : '-');
      feedbackCellWrap.appendChild(feedbackSummary);
      feedbackTd.appendChild(feedbackCellWrap);
      tr.appendChild(selectTd);
      tr.appendChild(videoTd);
      tr.appendChild(authorTd);
      tr.appendChild(topicTd);
      tr.appendChild(commentTd);
      tr.appendChild(document.createElement('td')).textContent = (feedback.approaches.length ? feedback.approaches[0] : safeText(row && (row.approach || row.approach_name))) || '-';
      tr.appendChild(replyTd);
      tr.appendChild(feedbackTd);
      tableEl.appendChild(tr);
    });
    syncYoutubeCommentBulkSelectionUi(activeResult);

  }

  function setYoutubeMinerMode(mode) {
    youtubeMinerMode = mode === 'production' ? 'production' : 'training';
    var trainingPanel = document.getElementById('youtubeMinerTrainingPanel');
    if (trainingPanel) trainingPanel.classList.toggle('hidden', false);
  }

  function setupYoutubeMinerCollapsibles() {
    var orderedTargetIds = [
      'youtubeResearchBody',
      'youtubeMinerRepositoryBody',
      'youtubeMinerTrainingBody',
      'youtubeMinerContentBody'
    ];
    var toggles = Array.prototype.slice.call(document.querySelectorAll('.youtube-miner-collapsible-toggle[data-target-id]'));
    toggles.forEach(function(toggle) {
      var targetId = safeText(toggle.getAttribute('data-target-id'));
      var badgeIndex = orderedTargetIds.indexOf(targetId) + 1;
      if (badgeIndex > 0 && !toggle.querySelector('.youtube-miner-section-badge')) {
        var badge = document.createElement('span');
        badge.className = 'youtube-miner-section-badge';
        badge.setAttribute('data-step-index', String(badgeIndex));
        badge.textContent = String(badgeIndex);
        toggle.insertBefore(badge, toggle.firstChild);
      }
      toggle.addEventListener('click', function() {
        var targetId = safeText(toggle.getAttribute('data-target-id'));
        if (!targetId) return;
        var body = document.getElementById(targetId);
        if (!body) return;
        var container = toggle.closest('.youtube-miner-collapsible');
        if (!container) return;
        var isOpen = container.classList.contains('is-open');
        container.classList.toggle('is-open', !isOpen);
        toggle.setAttribute('aria-expanded', String(!isOpen));
      });
    });
  }

  function setYoutubeMinerCollapsibleOpen(targetId, open) {
    var id = safeText(targetId);
    if (!id) return;
    var body = document.getElementById(id);
    if (!body) return;
    var container = body.closest('.youtube-miner-collapsible');
    if (!container) return;
    var toggle = container.querySelector('.youtube-miner-collapsible-toggle[data-target-id]');
    var shouldOpen = open !== false;
    container.classList.toggle('is-open', shouldOpen);
    if (toggle) toggle.setAttribute('aria-expanded', String(shouldOpen));
  }

  function applyYoutubeMinerInputToForm(formEl, input) {
    if (!formEl || !input || typeof input !== 'object') return;
    function setValue(name, value) {
      var field = formEl.querySelector('[name="' + name + '"]');
      if (!field) return;
      if (field.type === 'checkbox') {
        field.checked = value === true || value === 'on' || value === 1 || value === '1';
        return;
      }
      if (value == null) return;
      field.value = String(value);
    }
    setValue('targets', input.targets_text);
    setValue('include_phrases_text', input.include_phrases_text);
    setValue('exclude_phrases_text', input.exclude_phrases_text);
    setValue('videos_per_channel', input.videos_per_channel);
    setValue('max_comments_per_video', input.max_comments_per_video);
    setValue('min_score', input.min_score);
    setValue('sort_by', input.sort_by);
    setValue('include_replies', input.include_replies);
    setValue('exclude_noise', input.exclude_noise);
    setValue('response_context', input.response_context);
    setValue('response_guidelines', input.response_guidelines);
  }

  function renderYoutubeResearchResult(result) {
    youtubeResearchLastResult = result && typeof result === 'object' ? result : null;
    if (youtubeResearchLastResult) saveYoutubeResearchLastResult(youtubeResearchLastResult);

    var summaryEl = document.getElementById('youtubeResearchSummary');
    if (summaryEl) {
      var stats = youtubeResearchLastResult?.stats || {};
      var research = youtubeResearchLastResult?.research || {};
      if (!youtubeResearchLastResult) {
        summaryEl.textContent = 'No research run yet.';
      } else {
        summaryEl.textContent = [
          'Research run complete.',
          'Phrases: ' + String(Number(research.phrases?.length || stats.phrase_count || 0) || 0),
          'Discovered targets: ' + String(Number(research.discovered_count || stats.discovered_target_count || 0) || 0),
          'Excluded: ' + String(Number(research.excluded_count || stats.excluded_target_count || 0) || 0),
          'Candidate videos: ' + String(Number(research.distilled_count || stats.distilled_target_count || 0) || 0),
        ].join(' | ');
      }
    }
    renderYoutubeResearchRunsTable();
  }

  function getYoutubeResearchCandidateRows() {
    var research = youtubeResearchLastResult && youtubeResearchLastResult.research ? youtubeResearchLastResult.research : {};
    var rows = toArray(research.distilled_target_items).map(function(item) {
      return {
        video_url: safeText(item && item.video_url),
        video_id: safeText(item && item.video_id),
        title: safeText(item && item.title),
        channel_name: safeText(item && item.channel_name),
        channel_url: safeText(item && item.channel_url),
        description: safeText(item && item.description),
        thumbnail_url: safeText(item && item.thumbnail_url),
        phrase: safeText(item && item.phrase),
        published_at: safeText(item && item.published_at),
        view_count: Number(item && item.view_count || 0) || 0,
        like_count: Number(item && item.like_count || 0) || 0,
        comment_count: Number(item && item.comment_count || 0) || 0,
      };
    }).filter(function(item) {
      return item.video_url;
    }).filter(function(item) {
      var repositoryRun = findRepositoryRunByVideoUrl(item.video_url);
      return !isYoutubeVideoBannedFromTags(repositoryRun && repositoryRun.tags);
    });
    var sortKey = safeText(youtubeResearchTableSort.key) || 'view_count';
    var sortDir = youtubeResearchTableSort.dir === 'asc' ? 'asc' : 'desc';
    rows.sort(function(left, right) {
      var a = getYoutubeResearchSortValue(left, sortKey);
      var b = getYoutubeResearchSortValue(right, sortKey);
      var result = (typeof a === 'number' && typeof b === 'number') ? (a - b) : compareTextSort(a, b);
      if (result === 0) result = compareTextSort(left.title, right.title);
      return sortDir === 'asc' ? result : -result;
    });
    return rows;
  }

  function syncYoutubeResearchBulkSelectionUi() {
    var selectAll = document.getElementById('youtubeResearchSelectAllVisible');
    var addBtn = document.getElementById('youtubeResearchAddToRepositoryBtn');
    var banBtn = document.getElementById('youtubeResearchBanSelectedBtn');
    var sendBtn = document.getElementById('youtubeResearchSendToTargetingBtn');
    var rows = getYoutubeResearchCandidateRows();
    var visibleIds = rows.map(function(row) { return safeText(row.video_url); }).filter(Boolean);
    Array.from(selectedResearchTargetUrls).forEach(function(url) {
      if (visibleIds.indexOf(url) === -1) selectedResearchTargetUrls.delete(url);
    });
    var selectedVisible = visibleIds.filter(function(url) {
      return selectedResearchTargetUrls.has(url);
    });
    if (selectAll) {
      selectAll.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
      selectAll.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;
    }
    if (addBtn) addBtn.disabled = selectedVisible.length === 0;
    if (banBtn) banBtn.disabled = selectedVisible.length === 0;
    if (sendBtn) sendBtn.disabled = selectedVisible.length === 0;
  }

  function renderYoutubeResearchRunsTable() {
    var tbody = document.getElementById('youtubeResearchRunsTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    var rows = getYoutubeResearchCandidateRows();
    if (!rows.length) {
      var emptyTr = document.createElement('tr');
      var emptyTd = document.createElement('td');
      emptyTd.colSpan = 7;
      emptyTd.textContent = 'No research candidates yet.';
      emptyTr.appendChild(emptyTd);
      tbody.appendChild(emptyTr);
      syncYoutubeResearchBulkSelectionUi();
      return;
    }
    rows.forEach(function(row) {
      var tr = document.createElement('tr');
      var videoUrl = safeText(row.video_url);
      var selectionKey = videoUrl;

      var selectTd = document.createElement('td');
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedResearchTargetUrls.has(selectionKey);
      checkbox.setAttribute('aria-label', 'Select research candidate ' + (safeText(row.title) || videoUrl || 'video'));
      checkbox.addEventListener('change', function() {
        if (checkbox.checked) selectedResearchTargetUrls.add(selectionKey);
        else selectedResearchTargetUrls.delete(selectionKey);
        syncYoutubeResearchBulkSelectionUi();
      });
      selectTd.appendChild(checkbox);

      var titleTd = document.createElement('td');
      var titleLink = document.createElement('a');
      titleLink.href = videoUrl;
      titleLink.target = '_blank';
      titleLink.rel = 'noopener noreferrer';
      titleLink.textContent = safeText(row.title) || videoUrl || '-';
      titleLink.addEventListener('mouseenter', function(event) {
        showYoutubeResearchHoverPreview(row, event);
      });
      titleLink.addEventListener('mousemove', function(event) {
        positionYoutubeResearchHoverPreview(event.clientX, event.clientY);
      });
      titleLink.addEventListener('mouseleave', function() {
        hideYoutubeResearchHoverPreview();
      });
      titleTd.appendChild(titleLink);

      var channelTd = document.createElement('td');
      var channelName = safeText(row.channel_name) || '-';
      var channelUrl = safeText(row.channel_url);
      if (channelUrl) {
        var channelLink = document.createElement('a');
        channelLink.href = channelUrl;
        channelLink.target = '_blank';
        channelLink.rel = 'noopener noreferrer';
        channelLink.textContent = channelName;
        channelTd.appendChild(channelLink);
      } else {
        channelTd.textContent = channelName;
      }

      var viewsTd = document.createElement('td');
      viewsTd.className = 'numeric-col';
      viewsTd.textContent = formatInteger(row.view_count);

      var likesTd = document.createElement('td');
      likesTd.className = 'numeric-col';
      likesTd.textContent = formatInteger(row.like_count);

      var commentsTd = document.createElement('td');
      commentsTd.className = 'numeric-col';
      commentsTd.textContent = formatInteger(row.comment_count);

      var actionsTd = document.createElement('td');
      var repositoryRun = findRepositoryRunByVideoUrl(videoUrl);
      var isInRepository = Boolean(repositoryRun && safeText(repositoryRun.video_record_id));
      var repoBtn = App.makeIconButton('archive', 'Add To Repository', function() {
        addYoutubeResearchTargetsToRepository([videoUrl]).catch(function(err) {
          notify(err.message, true);
        });
      });
      var banBtn = App.makeIconButton('ban', 'Ban', function() {
        banYoutubeResearchCandidate(row).catch(function(err) {
          notify(err.message, true);
        });
      }, { danger: true, marginLeft: '8px' });
      repoBtn.style.marginLeft = '0';
      if (isInRepository) {
        repoBtn.style.background = '#1f8f4e';
        repoBtn.style.borderColor = '#1f8f4e';
        repoBtn.style.color = '#fff';
      }
      actionsTd.appendChild(repoBtn);
      actionsTd.appendChild(banBtn);

      tr.appendChild(selectTd);
      tr.appendChild(titleTd);
      tr.appendChild(channelTd);
      tr.appendChild(viewsTd);
      tr.appendChild(likesTd);
      tr.appendChild(commentsTd);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });
    syncYoutubeResearchBulkSelectionUi();
  }

  async function refreshYoutubeResearchRuns(limit) {
    var safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
    var res = await api('/api/acquire/youtube-research-runs?limit=' + safeLimit);
    state.acquireYoutubeResearch = Array.isArray(res.runs) ? res.runs : [];
    if (state.acquireYoutubeResearch.length) {
      await loadYoutubeResearchRun(state.acquireYoutubeResearch[0].run_id, { silent: true });
    } else {
      renderYoutubeResearchResult(null);
    }
  }

  async function loadYoutubeResearchRun(runId, options) {
    var id = safeText(runId);
    if (!id) return;
    var res = await api('/api/acquire/youtube-research-runs/' + encodeURIComponent(id));
    var run = res.run || null;
    var result = run && run.result ? run.result : null;
    if (!result) throw new Error('Research run has no result payload.');
    selectedResearchTargetUrls.clear();
    renderYoutubeResearchResult(result);
    if (!(options && options.silent)) {
      var distilledTargets = toArray(result?.research?.distilled_targets);
      notify('Research run loaded (' + distilledTargets.length + ' candidate videos)');
      var researchEl = document.getElementById('youtubeResearchBody');
      if (researchEl && typeof researchEl.scrollIntoView === 'function') {
        researchEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  async function addYoutubeResearchTargetsToRepository(videoUrls) {
    var urls = toArray(videoUrls).map(function(item) { return safeText(item); }).filter(Boolean);
    if (!urls.length) {
      notify('Select at least one research candidate first.', true);
      return;
    }
    await api('/api/acquire/youtube-videos/backfill-details', {
      method: 'POST',
      body: JSON.stringify({ video_urls: urls }),
    });
    urls.forEach(function(url) {
      selectedResearchTargetUrls.delete(url);
    });
    await Promise.all([refreshYoutubeVideos(200), refreshYoutubeRuns(200)]);
    renderYoutubeResearchRunsTable();
    notify('Added ' + urls.length + ' research candidate' + (urls.length === 1 ? '' : 's') + ' to Repository');
  }

  function findRepositoryRunByVideoUrl(videoUrl) {
    var url = safeText(videoUrl);
    if (!url) return null;
    var match = toArray(state.acquireYoutubeVideos).find(function(run) {
      return safeText(run && run.video_url) === url;
    }) || toArray(state.acquireYoutubeDetails).find(function(run) {
      return safeText(run && run.video_url) === url;
    }) || null;
    if (!match) return null;
    if (!safeText(match.video_record_id)) {
      match = Object.assign({}, match, {
        video_record_id: makeYoutubeVideoRecordId(match.video_id, match.video_url),
      });
    }
    return match;
  }

  async function banYoutubeResearchCandidate(row) {
    var videoUrl = safeText(row && row.video_url);
    if (!videoUrl) {
      notify('Video URL is required to ban this research candidate.', true);
      return;
    }
    var repositoryRun = findRepositoryRunByVideoUrl(videoUrl);
    if (!repositoryRun || !safeText(repositoryRun.video_record_id)) {
      await addYoutubeResearchTargetsToRepository([videoUrl]);
      repositoryRun = findRepositoryRunByVideoUrl(videoUrl);
    }
    if (!repositoryRun || !safeText(repositoryRun.video_record_id)) {
      repositoryRun = {
        video_record_id: makeYoutubeVideoRecordId(row && row.video_id, videoUrl),
        video_url: videoUrl,
        video_id: safeText(row && row.video_id),
        title: safeText(row && row.title),
        channel_name: safeText(row && row.channel_name),
        tags: '',
      };
    }
    openYoutubeBanVideoModal(repositoryRun);
  }

  async function banSelectedYoutubeResearchCandidates() {
    var selectedRows = getYoutubeResearchCandidateRows().filter(function(row) {
      return selectedResearchTargetUrls.has(safeText(row && row.video_url));
    });
    if (!selectedRows.length) {
      notify('Select at least one research candidate first.', true);
      return;
    }
    if (selectedRows.length === 1) {
      await banYoutubeResearchCandidate(selectedRows[0]);
      return;
    }
    var urls = selectedRows.map(function(row) { return safeText(row && row.video_url); }).filter(Boolean);
    await addYoutubeResearchTargetsToRepository(urls);
    var repositoryRows = urls.map(findRepositoryRunByVideoUrl).filter(function(row) {
      return row && safeText(row.video_record_id);
    });
    if (!repositoryRows.length) {
      notify('Could not save the selected candidates to the repository for banning.', true);
      return;
    }
    openYoutubeBanVideoModal(repositoryRows);
  }

  async function deleteYoutubeResearchRun(runId) {
    var id = safeText(runId);
    if (!id) throw new Error('Research run id is required');
    await api('/api/acquire/youtube-research-runs/' + encodeURIComponent(id), { method: 'DELETE' });
    await refreshYoutubeResearchRuns(30);
    notify('Research run deleted (' + id + ')');
  }

  function openYoutubeBanVideoModal(runOrRuns) {
    var runs = toArray(runOrRuns && !Array.isArray(runOrRuns) ? [runOrRuns] : runOrRuns).filter(function(run) {
      return run && safeText(run.video_record_id);
    });
    if (!runs.length) {
      notify('This video must be in the repository before it can be banned.', true);
      return;
    }
    if (!App.components || !App.components.Modal) {
      notify('Ban modal is unavailable', true);
      return;
    }
    var body = document.createElement('div');
    body.className = 'stack-form';
    var intro = document.createElement('p');
    intro.textContent = runs.length === 1
      ? 'Choose why this video should be excluded from future research results.'
      : 'Choose why these videos should be excluded from future research results.';
    body.appendChild(intro);

    var row = document.createElement('div');
    row.className = 'form-row';
    var label = document.createElement('label');
    label.textContent = 'Ban Reason';
    var select = document.createElement('select');
    select.innerHTML = '<option value=\"\">Select reason</option>';
    getYoutubeBanReasonOptions().forEach(function(optionData) {
      var option = document.createElement('option');
      option.value = optionData.value;
      option.textContent = optionData.label;
      select.appendChild(option);
    });
    if (runs.length === 1) select.value = extractYoutubeBanReasonFromTags(runs[0].tags);
    row.appendChild(label);
    row.appendChild(select);
    body.appendChild(row);

    var modal = App.components.Modal({
      title: runs.length === 1 ? 'Ban Video' : ('Ban ' + runs.length + ' Videos'),
      body: body,
      actions: [
        { label: 'Cancel', onClick: function() { modal.close(); } },
        {
          label: 'Save Ban',
          primary: true,
          onClick: function() {
            var reason = safeText(select.value);
            if (!reason) {
              notify('Choose a ban reason first.', true);
              return;
            }
            Promise.all(runs.map(function(run) {
              return api('/api/acquire/youtube-videos/' + encodeURIComponent(run.video_record_id), {
                method: 'PATCH',
                body: JSON.stringify({ tags: buildYoutubeBanTags(run.tags, reason) }),
              });
            })).then(function() {
              modal.close();
              notify((runs.length === 1 ? 'Video' : (runs.length + ' videos')) + ' banned for future research');
              return Promise.all([refreshYoutubeVideos(200), refreshYoutubeRuns(20)]);
            }).catch(function(err) {
              notify(err.message, true);
            });
          }
        }
      ],
    });
    modal.open();
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
      var selectionKey = getRepositorySelectionKey(run);
      checkbox.type = 'checkbox';
      checkbox.checked = selectedRunIds.has(selectionKey);
      checkbox.disabled = !selectionKey;
      checkbox.setAttribute('aria-label', 'Select YouTube video ' + String(run.repository_run_id || run.detail_run_id || run.video_url || ''));
      checkbox.addEventListener('change', function() {
        var runId = selectionKey;
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
      if (safeText(run.category)) {
        categoryTd.textContent = safeText(run.category);
      } else if (safeText(run.video_record_id) || safeText(run.detail_run_id)) {
        var categorySelect = document.createElement('select');
        categorySelect.innerHTML = '<option value="">Select Category</option>';
        categoryOptions().forEach(function(category) {
          var option = document.createElement('option');
          option.value = category;
          option.textContent = category;
          categorySelect.appendChild(option);
        });
        categorySelect.addEventListener('change', function() {
          var nextCategory = safeText(categorySelect.value);
          if (!nextCategory) return;
          var endpoint = safeText(run.video_record_id)
            ? '/api/acquire/youtube-videos/' + encodeURIComponent(run.video_record_id)
            : '/api/acquire/youtube-runs/' + encodeURIComponent(run.detail_run_id);
          api(endpoint, {
            method: 'PATCH',
            body: JSON.stringify({ category: nextCategory }),
          })
            .then(function() {
              notify('Category updated');
              return Promise.all([refreshYoutubeVideos(200), refreshYoutubeRuns(20)]);
            })
            .catch(function(e) {
              notify(e.message, true);
              categorySelect.value = '';
            });
        });
        categoryTd.appendChild(categorySelect);
      } else {
        categoryTd.textContent = '-';
      }

      var tagsTd = document.createElement('td');
      tagsTd.textContent = safeText(run.tags) || '-';

      var transcriptTd = document.createElement('td');
      transcriptTd.textContent = run.transcript_status || 'unavailable';

      var actionsTd = document.createElement('td');
      tr.appendChild(selectTd); tr.appendChild(createdTd); tr.appendChild(titleTd); tr.appendChild(channelTd);
      tr.appendChild(categoryTd); tr.appendChild(tagsTd); tr.appendChild(transcriptTd); tr.appendChild(actionsTd);

      function mkBtn(label, fn) {
        var iconMap = {
          'Copy URL': 'copy',
          'View': 'view',
          'Edit': 'edit',
          'Ban': 'delete',
          'Add Contact': 'contact',
          'View Comments': 'comments',
          'Acquire Comments': 'comments',
          'Delete': 'delete'
        };
        return App.makeIconButton(iconMap[label] || 'view', label, fn, {
          primary: label === 'View Comments',
          danger: label === 'Delete' || label === 'Ban'
        });
      }

      function copyTextToClipboard(text) {
        var value = String(text || '').trim();
        if (!value) return Promise.reject(new Error('No URL available to copy'));
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          return navigator.clipboard.writeText(value);
        }
        return new Promise(function(resolve, reject) {
          try {
            var ta = document.createElement('textarea');
            ta.value = value;
            ta.setAttribute('readonly', 'readonly');
            ta.style.position = 'absolute';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            var ok = document.execCommand('copy');
            document.body.removeChild(ta);
            if (!ok) return reject(new Error('Copy command was blocked'));
            resolve();
          } catch (err) {
            reject(err || new Error('Copy failed'));
          }
        });
      }
      
      var copyBtn         = mkBtn('Copy URL',        function() {
        copyTextToClipboard(run.video_url)
          .then(function() { notify('Video URL copied'); })
          .catch(function(e) { notify(safeText(e && e.message) || 'Could not copy URL', true); });
      });
      var resolvedDetailRun = findBestYoutubeDetailsRunForVideo(run.video_url);
      var resolvedDetailRunId = safeText(resolvedDetailRun && resolvedDetailRun.run_id) || safeText(run.detail_run_id);

      var viewBtn         = mkBtn('View', function() {
        if (resolvedDetailRunId) {
          loadYoutubeRun(resolvedDetailRunId).catch(function(e) { notify(e.message, true); });
          return;
        }
        currentDetailsRun = {
          video_url: safeText(run.video_url),
          title: safeText(run.title),
          channel_name: safeText(run.channel_name),
          channel_url: safeText(run.channel_url),
        };
        rememberActiveVideo(currentDetailsRun);
        syncActiveVideoFromUrl(run.video_url, currentDetailsRun);
        scrollToYoutubeDetails();
        notify('Loaded analyzed video');
      });
      var editBtn         = mkBtn('Edit',            function() { openEditRun(resolvedDetailRunId).catch(function(e) { notify(e.message, true); }); });
      var banBtn          = mkBtn('Ban',             function() { openYoutubeBanVideoModal(run); });
      var addBtn          = mkBtn('Add Contact',      function() { addContactFromRun(resolvedDetailRunId).catch(function(e) { notify(e.message, true); }); });
      
      var commentMatch = findCommentRunForVideoUrl(run.video_url) || (run.comment_run_id ? { run_id: run.comment_run_id, video_url: run.video_url, title: run.title, channel_name: run.channel_name, comment_count: run.comment_count } : null);
      var commentRunId = safeText(commentMatch && commentMatch.run_id) || safeText(run.comment_run_id);
      var commentsBtn = mkBtn('View Comments', function() {
        if (!commentMatch) return notify('No comment run found for this video.', true);
        App.youtubeComments.openForRun(commentMatch);
      });
      if (commentMatch) {
        commentsBtn.classList.add('tiny-btn-blue');
      }
      var delBtn          = mkBtn('Delete',           function() {
        if (!commentRunId) return notify('No comment run is available to delete for this video.', true);
        if (!confirm('Delete analyzed comment run ' + commentRunId + '?')) return;
        deleteCommentRun(commentRunId).catch(function(e) { notify(e.message, true); });
      });

      if (!resolvedDetailRunId) {
        editBtn.disabled = true;
        addBtn.disabled = true;
      }

      editBtn.style.marginLeft = '8px';
      banBtn.style.marginLeft = '8px';
      viewBtn.style.marginLeft = '8px';
      addBtn.style.marginLeft = '8px';
      commentsBtn.style.marginLeft = '8px';
      delBtn.style.marginLeft = '8px';
      actionsTd.appendChild(copyBtn); actionsTd.appendChild(viewBtn); actionsTd.appendChild(editBtn); actionsTd.appendChild(banBtn); actionsTd.appendChild(addBtn);
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
    var rows = buildRepositoryRows();
    var from       = normalizeFilterDate(runFilters.from);
    var to         = normalizeFilterDate(runFilters.to);
    var title      = String(runFilters.title      || '').trim().toLowerCase();
    var channel    = String(runFilters.channel    || '').trim().toLowerCase();
    var category   = String(runFilters.category   || '').trim().toLowerCase();
    var transcript = String(runFilters.transcript || '').trim().toLowerCase();
    var tags = String(runFilters.tags || '').trim().toLowerCase();
    return rows.filter(function(run) {
      var runDate       = toLocalDateKey(run.created_at);
      var runTitle      = String(run.title || '').toLowerCase();
      var runChannel    = String(run.channel_name || '').toLowerCase();
      var runCategory   = String(run.category || '').toLowerCase();
      var runTags       = String(run.tags || run.hashtags || '').toLowerCase();
      var runTranscript = String(run.transcript_status || 'unavailable').toLowerCase();
      if (from && runDate && runDate < from)           return false;
      if (to   && runDate && runDate > to)             return false;
      if (title      && runTitle.indexOf(title) < 0)  return false;
      if (channel    && runChannel.indexOf(channel) < 0) return false;
      if (category   && runCategory !== category)     return false;
      if (tags       && runTags.indexOf(tags) < 0)    return false;
      if (transcript && runTranscript !== transcript)  return false;
      return true;
    });
  }

  async function refreshYoutubeRuns(limit) {
    if (!els.youtubeRunsTable) return;
    var safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
    var res = await api('/api/acquire/youtube-runs?limit=' + safeLimit);
    state.acquireYoutubeDetails = Array.isArray(res.runs) ? res.runs : [];
    var activeUrl = safeText(currentDetailsRun && currentDetailsRun.video_url) || safeText(activeVideoSnapshot && activeVideoSnapshot.video_url);
    if (activeUrl) {
      syncActiveVideoFromUrl(activeUrl, currentDetailsRun || activeVideoSnapshot || {});
    }
    renderYoutubeRunsTable();
  }

  async function refreshYoutubeVideos(limit) {
    var safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
    try {
      var res = await api('/api/acquire/youtube-videos?limit=' + safeLimit);
      state.acquireYoutubeVideos = Array.isArray(res.videos) ? res.videos : [];
    } catch (_) {
      state.acquireYoutubeVideos = [];
    }
    renderYoutubeRunsTable();
  }

  async function refreshCommentRuns(limit) {
    var safeLimit = Math.max(1, Math.min(Number(limit) || 20, 200));
    var res = await api('/api/acquire/youtube-comment-runs?limit=' + safeLimit);
    state.acquireYoutubeComments = Array.isArray(res.runs) ? res.runs : [];
    // Comment runs affect whether the main runs table shows "Acquire" vs "View"
    renderYoutubeRunsTable();
  }

  async function refreshYoutubeMinerRuns(limit) {
    var safeLimit = Math.max(1, Math.min(Number(limit) || 10, 30));
    try {
      var res = await api('/api/acquire/youtube-miner-runs?limit=' + safeLimit);
      var runs = Array.isArray(res.runs) ? res.runs : [];
      var detailResponses = await Promise.all(runs.map(function(run) {
        var runId = safeText(run && run.run_id);
        if (!runId) return null;
        return api('/api/acquire/youtube-miner-runs/' + encodeURIComponent(runId))
          .then(function(detailRes) { return detailRes.run || null; })
          .catch(function() { return null; });
      }));
      youtubeMinerRunDetails = detailResponses.filter(Boolean);
    } catch (_) {
      youtubeMinerRunDetails = [];
    }
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
    var editPlayer = document.getElementById('youtubeRunEditPlayer');
    var editPlayerEmpty = document.getElementById('youtubeRunEditPlayerEmpty');

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
    renderYoutubePlayerFrame(
      editPlayer,
      editPlayerEmpty,
      extractYoutubeVideoId(run && run.video_url)
        ? ('https://www.youtube-nocookie.com/embed/' + encodeURIComponent(extractYoutubeVideoId(run && run.video_url)))
        : '',
      safeText(run && run.video_url)
    );

    App.setActivePage('editYoutubeRunPage');
  }

  function openBulkEditPage() {
    var editableRows = getSelectedYoutubeRows().filter(function(run) {
      return safeText(run && run.detail_run_id);
    });
    if (!editableRows.length) {
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
    rememberActiveVideo({
      video_url: safeText(run && run.video_url),
      title: safeText(run && run.title),
      channel_name: safeText(run && run.channel_name),
      channel_url: safeText(run && run.channel_url),
    });
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
    var id = safeText(runId);
    if (!id) throw new Error('Comment run id is required');
    await api('/api/acquire/youtube-comment-runs/' + encodeURIComponent(id), { method: 'DELETE' });
    await refreshCommentRuns();
    notify('Comment run deleted (' + id + ')');
  }

  function bulkDeleteSelectedRepositoryRows() {
    var selectedRows = getSelectedYoutubeRows();
    var videoRecordIds = [];
    var detailRunIds = [];
    var commentRunIds = [];
    var seenVideoRecords = new Set();
    var seenDetailRuns = new Set();
    var seenCommentRuns = new Set();
    selectedRows.forEach(function(run) {
      var targets = getRepositoryDeleteTargets(run);
      if (targets.videoRecordId && !seenVideoRecords.has(targets.videoRecordId)) {
        seenVideoRecords.add(targets.videoRecordId);
        videoRecordIds.push(targets.videoRecordId);
      }
      if (targets.detailRunId && !seenDetailRuns.has(targets.detailRunId)) {
        seenDetailRuns.add(targets.detailRunId);
        detailRunIds.push(targets.detailRunId);
      }
      if (targets.commentRunId && !seenCommentRuns.has(targets.commentRunId)) {
        seenCommentRuns.add(targets.commentRunId);
        commentRunIds.push(targets.commentRunId);
      }
    });
    var totalTargets = videoRecordIds.length + detailRunIds.length + commentRunIds.length;
    if (!totalTargets) {
      notify('No repository rows are available to delete for the checked videos.', true);
      return Promise.resolve();
    }
    if (!confirm('Delete ' + selectedRows.length + ' selected repository row' + (selectedRows.length === 1 ? '' : 's') + '?')) {
      return Promise.resolve();
    }
    var requests = [];
    var selectedKeys = selectedRows.map(function(run) { return getRepositorySelectionKey(run); }).filter(Boolean);
    videoRecordIds.forEach(function(videoRecordId) {
      requests.push(
        api('/api/acquire/youtube-videos/' + encodeURIComponent(videoRecordId), { method: 'DELETE' })
          .then(function() { return { ok: true, kind: 'video', id: videoRecordId }; })
          .catch(function(err) { return { ok: false, kind: 'video', id: videoRecordId, error: err }; })
      );
    });
    detailRunIds.forEach(function(runId) {
      requests.push(
        api('/api/acquire/youtube-runs/' + encodeURIComponent(runId), { method: 'DELETE' })
          .then(function() { return { ok: true, kind: 'detail', id: runId }; })
          .catch(function(err) { return { ok: false, kind: 'detail', id: runId, error: err }; })
      );
    });
    commentRunIds.forEach(function(runId) {
      requests.push(
        api('/api/acquire/youtube-comment-runs/' + encodeURIComponent(runId), { method: 'DELETE' })
          .then(function() { return { ok: true, kind: 'comment', id: runId }; })
          .catch(function(err) { return { ok: false, kind: 'comment', id: runId, error: err }; })
      );
    });
    return Promise.all(requests).then(function(results) {
      var deleted = results.filter(function(item) { return item.ok; }).length;
      var failed = results.filter(function(item) { return !item.ok; }).length;
      return Promise.all([
        refreshYoutubeVideos(200),
        refreshYoutubeRuns(20),
        refreshCommentRuns(20),
        refreshYoutubeMinerRuns(10),
      ]).then(function() {
        selectedKeys.forEach(function(key) {
          if (key) selectedRunIds.delete(key);
        });
        renderYoutubeRunsTable();
        notify('Delete selected complete: ' + deleted + ' deleted, ' + failed + ' failed');
      });
    });
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
    rememberActiveVideo({
      video_url: videoUrl,
      title: safeText(run && run.title),
      channel_name: safeText(run && run.channel_name),
      channel_url: safeText(run && run.channel_url),
    });
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

  function augmentSelectedYoutubeVideos() {
    var selectedRows = getSelectedYoutubeRows().filter(function(run) {
      return safeText(run && run.video_url);
    });
    if (!selectedRows.length) {
      notify('Select at least one YouTube video first', true);
      return Promise.resolve();
    }

    var videoUrls = [];
    var seen = new Set();
    selectedRows.forEach(function(run) {
      var videoUrl = safeText(run && run.video_url);
      if (!videoUrl) return;
      var key = videoUrl.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      videoUrls.push(videoUrl);
    });

    notify('Augmenting ' + videoUrls.length + ' selected video' + (videoUrls.length === 1 ? '' : 's') + '...');
    return api('/api/acquire/youtube-videos/backfill-details', {
      method: 'POST',
      body: JSON.stringify({
        video_urls: videoUrls,
        limit: videoUrls.length,
        delay_ms: 500,
        force: false,
      }),
    }).then(function(res) {
      var backfill = res && res.backfill ? res.backfill : res || {};
      var updated = Number(backfill.created_runs || 0) || 0;
      var skipped = Number(backfill.skipped || 0) || 0;
      var failed = Number(backfill.failed || 0) || 0;
      notify('Augment complete: ' + updated + ' updated, ' + skipped + ' skipped, ' + failed + ' failed');
      return Promise.all([refreshYoutubeVideos(200), refreshYoutubeRuns(20), refreshCommentRuns(20)]);
    }).catch(function(err) {
      notify(err.message || 'Could not augment selected videos', true);
    });
  }

  function diagnoseSelectedYoutubeVideos() {
    var selectedRows = getSelectedYoutubeRows().filter(function(run) {
      return safeText(run && run.video_url);
    });
    if (!selectedRows.length) {
      notify('Select at least one YouTube video first', true);
      return Promise.resolve();
    }

    var videoUrls = [];
    var seen = new Set();
    selectedRows.forEach(function(run) {
      var videoUrl = safeText(run && run.video_url);
      if (!videoUrl) return;
      var key = videoUrl.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      videoUrls.push(videoUrl);
    });

    notify('Running diagnostics for ' + videoUrls.length + ' selected video' + (videoUrls.length === 1 ? '' : 's') + '...');
    return api('/api/acquire/youtube-videos/diagnostics', {
      method: 'POST',
      body: JSON.stringify({
        video_urls: videoUrls,
        include_harvest_preview: videoUrls.length === 1,
      }),
    }).then(function(res) {
      var diagnostics = Array.isArray(res && res.diagnostics) ? res.diagnostics : [];
      var repositoryPanel = document.getElementById('youtubeRepositoryDiagnosticsPanel');
      var repositoryPreview = document.getElementById('youtubeRepositoryDiagnosticsPreview');
      if (repositoryPreview) {
        setPreview(repositoryPreview, {
          selected_video_urls: videoUrls,
          diagnostics: diagnostics,
        });
      }
      if (repositoryPanel) repositoryPanel.open = true;
      setPreview(document.getElementById('youtubeRawPreview'), {
        selected_video_urls: videoUrls,
        diagnostics: diagnostics,
      });
      notify('Diagnostics loaded into Repository Diagnostics');
      var targetWrap = repositoryPanel || repositoryPreview || document.getElementById('youtubeRawPreview');
      if (targetWrap && targetWrap.scrollIntoView) targetWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function(err) {
      notify(err.message || 'Could not load video diagnostics', true);
    });
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
    var augmentBtn = document.getElementById('youtubeRunsAugmentBtn');
    var diagnoseBtn = document.getElementById('youtubeRunsDiagnoseBtn');
    var deleteBtn = document.getElementById('youtubeRunsDeleteBtn');
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
          var runId = getRepositorySelectionKey(run);
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
    if (augmentBtn) {
      augmentBtn.addEventListener('click', function() {
        augmentSelectedYoutubeVideos();
      });
    }
    if (diagnoseBtn) {
      diagnoseBtn.addEventListener('click', function() {
        diagnoseSelectedYoutubeVideos();
      });
    }
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function() {
        bulkDeleteSelectedRepositoryRows().catch(function(err) {
          notify(err.message || 'Could not delete selected repository rows', true);
        });
      });
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
            rememberActiveVideo({ video_url: payload.video_url });
            renderYoutubeCommentsResult(res.result || {});
            var total = Number(res.result && res.result.stats ? res.result.stats.total_comments : 0) || 0;
            notify('YouTube comments acquire complete (' + total + ' comments)');
            await refreshCommentRuns();
          } else {
            var dres = await api('/api/acquire/youtube', { method: 'POST', body: JSON.stringify(payload) });
            currentDetailsRun = dres.run || { video_url: payload.video_url, category: selectedCategory };
            rememberActiveVideo({
              video_url: safeText(currentDetailsRun && currentDetailsRun.video_url),
              title: safeText(currentDetailsRun && currentDetailsRun.title),
              channel_name: safeText(currentDetailsRun && currentDetailsRun.channel_name),
              channel_url: safeText(currentDetailsRun && currentDetailsRun.channel_url),
            });
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

    var youtubeResearchForm = document.getElementById('youtubeResearchForm');
    var youtubeResearchSubmitBtn = document.getElementById('youtubeResearchSubmitBtn');
    var youtubeResearchRefreshBtn = document.getElementById('youtubeResearchRefreshBtn');
    var youtubeResearchAddToRepositoryBtn = document.getElementById('youtubeResearchAddToRepositoryBtn');
    var youtubeResearchBanSelectedBtn = document.getElementById('youtubeResearchBanSelectedBtn');
    var youtubeResearchSendToTargetingBtn = document.getElementById('youtubeResearchSendToTargetingBtn');
    var youtubeResearchSelectAllVisible = document.getElementById('youtubeResearchSelectAllVisible');
    var youtubeResearchMessagingCategory = document.getElementById('youtubeResearchMessagingCategory');
    var youtubeResearchHashtagSelect = document.getElementById('youtubeResearchHashtagSelect');
    var youtubeMinerTargetHistoryAddBtn = document.getElementById('youtubeMinerTargetHistoryAddBtn');
    var youtubeMinerTargetHistoryRefreshBtn = document.getElementById('youtubeMinerTargetHistoryRefreshBtn');
    if (youtubeResearchForm) {
      youtubeResearchForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        try {
          var formData = new FormData(youtubeResearchForm);
          var payload = {
            manual_phrases_text: String(formData.get('manual_phrases_text') || '').trim(),
            include_messaging: formData.get('include_messaging') === 'on',
            max_phrases: Number(formData.get('max_phrases') || 25) || 25,
            videos_per_phrase: Number(formData.get('videos_per_phrase') || 3) || 3,
            distilled_target_limit: Number(formData.get('distilled_target_limit') || 30) || 30,
            max_comments_per_video: Number(formData.get('max_comments_per_video') || 100) || 100,
            include_replies: formData.get('include_replies') === 'on',
            include_transcript: formData.get('include_transcript') === 'on',
            messaging_category: safeText(formData.get('messaging_category')),
            messaging_hashtag: safeText(formData.get('messaging_hashtag')),
            include_phrases_text: '',
            exclude_phrases_text: '',
            category_config: collectYoutubeMinerCategoryConfigFromUi(),
            attribute_config: collectYoutubeMinerConfigFromUi('attribute'),
            approach_config: collectYoutubeMinerConfigFromUi('approach'),
            response_context: safeText(document.getElementById('youtubeMinerResponseContext')?.value),
            training_feedback: collectYoutubeMinerFeedbackCorpus(),
          };
          if (youtubeResearchSubmitBtn) youtubeResearchSubmitBtn.disabled = true;
          var res = await api('/api/acquire/youtube-research', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          var result = res.result || {};
          selectedResearchTargetUrls.clear();
          renderYoutubeResearchResult(result);
          await refreshYoutubeResearchRuns(30);
          notify('YouTube Research complete');
        } catch (err) {
          notify(err.message, true);
        } finally {
          if (youtubeResearchSubmitBtn) youtubeResearchSubmitBtn.disabled = false;
        }
      });
    }
    if (youtubeResearchMessagingCategory) {
      youtubeResearchMessagingCategory.addEventListener('change', function() {
        refreshYoutubeResearchCategoryHashtagHints().catch(function(err) {
          notify(err.message || 'Could not refresh category suggestions', true);
        });
      });
    }
    if (youtubeResearchHashtagSelect) {
      youtubeResearchHashtagSelect.addEventListener('change', function() {
        refreshYoutubeResearchCategoryHashtagHints().catch(function(err) {
          notify(err.message || 'Could not refresh hashtag suggestions', true);
        });
      });
    }
    if (youtubeResearchRefreshBtn) {
      youtubeResearchRefreshBtn.addEventListener('click', function() {
        refreshYoutubeResearchRuns(30).then(function() {
          notify('Research runs refreshed');
        }).catch(function(err) {
          notify(err.message, true);
        });
      });
    }
    if (youtubeResearchAddToRepositoryBtn) {
      youtubeResearchAddToRepositoryBtn.addEventListener('click', function() {
        addYoutubeResearchTargetsToRepository(Array.from(selectedResearchTargetUrls)).catch(function(err) {
          notify(err.message, true);
        });
      });
    }
    if (youtubeResearchBanSelectedBtn) {
      youtubeResearchBanSelectedBtn.addEventListener('click', function() {
        banSelectedYoutubeResearchCandidates().catch(function(err) {
          notify(err.message, true);
        });
      });
    }
    if (youtubeResearchSendToTargetingBtn) {
      youtubeResearchSendToTargetingBtn.addEventListener('click', function() {
        var targets = Array.from(selectedResearchTargetUrls).filter(Boolean);
        if (!targets.length) {
          notify('Select at least one research candidate first.', true);
          return;
        }
        var targetField = document.getElementById('youtubeMinerTargets');
        if (targetField) targetField.value = targets.join('\n');
        setYoutubeMinerMode('training');
        var targetingBody = document.getElementById('youtubeMinerTrainingBody');
        if (targetingBody) {
          var targetingWrap = targetingBody.closest('.youtube-miner-collapsible');
          var targetingToggle = targetingWrap ? targetingWrap.querySelector('.youtube-miner-collapsible-toggle') : null;
          if (targetingWrap) targetingWrap.classList.add('is-open');
          if (targetingToggle) targetingToggle.setAttribute('aria-expanded', 'true');
        }
        notify('Sent ' + targets.length + ' research target' + (targets.length === 1 ? '' : 's') + ' to Targeting');
      });
    }
    if (youtubeResearchSelectAllVisible) {
      youtubeResearchSelectAllVisible.addEventListener('change', function() {
        getYoutubeResearchCandidateRows().forEach(function(row) {
          var url = safeText(row && row.video_url);
          if (!url) return;
          if (youtubeResearchSelectAllVisible.checked) selectedResearchTargetUrls.add(url);
          else selectedResearchTargetUrls.delete(url);
        });
        renderYoutubeResearchRunsTable();
      });
    }
    [
      ['youtubeResearchSortTitleBtn', 'title'],
      ['youtubeResearchSortChannelBtn', 'channel_name'],
      ['youtubeResearchSortViewsBtn', 'view_count'],
      ['youtubeResearchSortLikesBtn', 'like_count'],
      ['youtubeResearchSortCommentsBtn', 'comment_count'],
    ].forEach(function(entry) {
      var sortBtn = document.getElementById(entry[0]);
      if (!sortBtn) return;
      sortBtn.addEventListener('click', function() {
        var key = entry[1];
        if (youtubeResearchTableSort.key === key) {
          youtubeResearchTableSort.dir = youtubeResearchTableSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          youtubeResearchTableSort.key = key;
          youtubeResearchTableSort.dir = key === 'title' || key === 'channel_name' ? 'asc' : 'desc';
        }
        renderYoutubeResearchRunsTable();
      });
    });
    document.addEventListener('scroll', hideYoutubeResearchHoverPreview, true);
    document.addEventListener('pointerdown', hideYoutubeResearchHoverPreview, true);
    if (youtubeMinerTargetHistoryAddBtn) {
      youtubeMinerTargetHistoryAddBtn.addEventListener('click', function() {
        addSelectedTargetHistoryToTextarea();
      });
    }
    if (youtubeMinerTargetHistoryRefreshBtn) {
      youtubeMinerTargetHistoryRefreshBtn.addEventListener('click', function() {
        refreshYoutubeMinerTargetHistory(700)
          .then(function() { notify('Target history refreshed'); })
          .catch(function(err) { notify(err.message, true); });
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
            include_phrases_text: String(formData.get('include_phrases_text') || '').trim(),
            exclude_phrases_text: String(formData.get('exclude_phrases_text') || '').trim(),
            category_config: collectYoutubeMinerCategoryConfigFromUi(),
            attribute_config: collectYoutubeMinerConfigFromUi('attribute'),
            approach_config: collectYoutubeMinerConfigFromUi('approach'),
            response_context: String(formData.get('response_context') || '').trim(),
            response_guidelines: String(formData.get('response_guidelines') || '').trim(),
            training_feedback: collectYoutubeMinerFeedbackCorpus(),
          };
          if (!payload.targets_text) throw new Error('Add at least one video/channel target.');
          saveYoutubeMinerLastInput(payload);
          saveYoutubeMinerCategoryConfig(payload.category_config);
          youtubeMinerCategoryConfig = payload.category_config.slice();
          saveYoutubeMinerConfig('attribute', payload.attribute_config);
          youtubeMinerAttributeConfig = payload.attribute_config.slice();
          saveYoutubeMinerConfig('approach', payload.approach_config);
          youtubeMinerApproachConfig = payload.approach_config.slice();
          saveYoutubeMinerResponseContext(payload.response_context);
          saveYoutubeMinerResponseGuidelines(payload.response_guidelines);
          try {
            await savePersistedYoutubeMinerResponseContext(payload.response_context, payload.response_guidelines);
          } catch (_) {
            // Do not block miner execution if context persistence endpoint is unavailable.
          }
          if (submitBtn) submitBtn.disabled = true;
          var res = await api('/api/acquire/youtube-comments/miner', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          var result = res.result || {};
          renderYoutubeCommentMinerResult(result);
          refreshYoutubeMinerTargetHistory(700).catch(function() {});
          notify('YouTube Comment Miner complete (' + String(Number(result?.stats?.total_comments_filtered || 0) || 0) + ' filtered comments)');
        } catch (err) {
          notify(err.message, true);
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }

    var youtubeMinerContentVideoFilter = document.getElementById('youtubeMinerContentVideoFilter');
    var youtubeMinerContentTopicFilter = document.getElementById('youtubeMinerContentTopicFilter');
    var youtubeMinerContentApproachFilter = document.getElementById('youtubeMinerContentApproachFilter');
    var youtubeMinerContentAuthorFilter = document.getElementById('youtubeMinerContentAuthorFilter');
    var youtubeMinerContentCommentFilter = document.getElementById('youtubeMinerContentCommentFilter');
    var youtubeCommentMinerSelectAllVisible = document.getElementById('youtubeCommentMinerSelectAllVisible');
    var youtubeCommentMinerEditSelectedBtn = document.getElementById('youtubeCommentMinerEditSelectedBtn');
    var youtubeCommentMinerDeleteSelectedBtn = document.getElementById('youtubeCommentMinerDeleteSelectedBtn');
    var youtubeCommentMinerAddContactBtn = document.getElementById('youtubeCommentMinerAddContactBtn');
    var youtubeMinerResponseContext = document.getElementById('youtubeMinerResponseContext');
    var youtubeMinerGuidelines = document.getElementById('youtubeMinerGuidelines');
    youtubeMinerCategoryConfig = applyRecommendedRows('category', loadYoutubeMinerCategoryConfig());
    youtubeMinerAttributeConfig = applyRecommendedRows('attribute', loadYoutubeMinerConfig('attribute'));
    youtubeMinerApproachConfig = applyRecommendedRows('approach', loadYoutubeMinerConfig('approach'));
    youtubeMinerRuleGuideRows = normalizeYoutubeMinerRuleGuides(loadYoutubeMinerRuleGuides());
    saveYoutubeMinerCategoryConfig(youtubeMinerCategoryConfig);
    saveYoutubeMinerConfig('attribute', youtubeMinerAttributeConfig);
    saveYoutubeMinerConfig('approach', youtubeMinerApproachConfig);
    if (youtubeMinerResponseContext || youtubeMinerGuidelines) {
      if (youtubeMinerResponseContext) youtubeMinerResponseContext.value = loadYoutubeMinerResponseContext();
      if (youtubeMinerGuidelines) youtubeMinerGuidelines.value = loadYoutubeMinerResponseGuidelines();
      if (!youtubeMinerRuleGuideRows.length && youtubeMinerGuidelines) {
        youtubeMinerRuleGuideRows = parseYoutubeMinerRuleGuidesFromText(youtubeMinerGuidelines.value);
      }
      saveYoutubeMinerRuleGuides(youtubeMinerRuleGuideRows);
      loadPersistedYoutubeMinerResponseContext().then(function(serverValue) {
        var contextValue = safeText(serverValue && serverValue.context);
        var guidelinesValue = safeText(serverValue && serverValue.guidelines);
        if (contextValue) {
          youtubeMinerResponseContext.value = contextValue;
          saveYoutubeMinerResponseContext(contextValue);
        }
        if (youtubeMinerGuidelines && guidelinesValue) {
          youtubeMinerGuidelines.value = guidelinesValue;
          saveYoutubeMinerResponseGuidelines(guidelinesValue);
        }
        if (!youtubeMinerRuleGuideRows.length && guidelinesValue) {
          youtubeMinerRuleGuideRows = parseYoutubeMinerRuleGuidesFromText(guidelinesValue);
          saveYoutubeMinerRuleGuides(youtubeMinerRuleGuideRows);
          renderYoutubeMinerRuleGuides();
        }
        if ((!contextValue && youtubeMinerResponseContext && safeText(youtubeMinerResponseContext.value))
          || (!guidelinesValue && youtubeMinerGuidelines && safeText(youtubeMinerGuidelines.value))) {
          schedulePersistYoutubeMinerResponseContext(
            youtubeMinerResponseContext ? youtubeMinerResponseContext.value : '',
            youtubeMinerGuidelines ? youtubeMinerGuidelines.value : ''
          );
        }
      });
      var persistContextGuidelines = function() {
        var contextValue = youtubeMinerResponseContext ? youtubeMinerResponseContext.value : '';
        var guidelinesValue = youtubeMinerGuidelines ? youtubeMinerGuidelines.value : '';
        saveYoutubeMinerResponseContext(contextValue);
        saveYoutubeMinerResponseGuidelines(guidelinesValue);
        schedulePersistYoutubeMinerResponseContext(contextValue, guidelinesValue);
      };
      if (youtubeMinerResponseContext) {
        youtubeMinerResponseContext.addEventListener('input', persistContextGuidelines);
      }
      if (youtubeMinerGuidelines) {
        youtubeMinerGuidelines.addEventListener('input', persistContextGuidelines);
      }
    }
    renderYoutubeMinerCategoryConfig();
    renderYoutubeMinerConfig('attribute');
    renderYoutubeMinerConfig('approach');
    renderYoutubeMinerRuleGuides();
    bindYoutubeMinerConfigEvents('category');
    bindYoutubeMinerConfigEvents('attribute');
    bindYoutubeMinerConfigEvents('approach');
    bindYoutubeMinerRuleGuideEvents();
    ['category', 'attribute', 'approach'].forEach(function(kind) {
      loadPersistedYoutubeMinerConfig(kind).then(function(serverRows) {
        if (Array.isArray(serverRows) && serverRows.length) {
          var appliedRows = applyRecommendedRows(kind, serverRows);
          if (kind === 'category') saveYoutubeMinerCategoryConfig(appliedRows);
          else saveYoutubeMinerConfig(kind, appliedRows);
          getYoutubeMinerConfigBundle(kind).setRows(appliedRows);
          renderYoutubeMinerConfig(kind);
          return;
        }
        schedulePersistYoutubeMinerConfig(kind, getYoutubeMinerConfigBundle(kind).getRows());
      });
    });
    loadPersistedYoutubeMinerRuleGuides().then(function(serverRows) {
      if (Array.isArray(serverRows) && serverRows.length) {
        youtubeMinerRuleGuideRows = normalizeYoutubeMinerRuleGuides(serverRows);
        saveYoutubeMinerRuleGuides(youtubeMinerRuleGuideRows);
        renderYoutubeMinerRuleGuides();
        return;
      }
      var textareaValue = youtubeMinerGuidelines ? safeText(youtubeMinerGuidelines.value) : '';
      if (!youtubeMinerRuleGuideRows.length && textareaValue) {
        youtubeMinerRuleGuideRows = parseYoutubeMinerRuleGuidesFromText(textareaValue);
        saveYoutubeMinerRuleGuides(youtubeMinerRuleGuideRows);
        renderYoutubeMinerRuleGuides();
      }
      schedulePersistYoutubeMinerRuleGuides(youtubeMinerRuleGuideRows);
    });
    applyTrainingReplyMixSettingsToUi(defaultTrainingReplyMixSettings());
    bindTrainingReplyMixSettings();
    loadPersistedTrainingReplyMixSettings().then(function(settings) {
      applyTrainingReplyMixSettingsToUi(settings);
    });
    activeVideoSnapshot = loadActiveVideoSnapshot();
    if (activeVideoSnapshot && !currentDetailsRun) {
      currentDetailsRun = Object.assign({}, activeVideoSnapshot);
    }
    setYoutubeMinerMode('training');
    setupYoutubeMinerCollapsibles();
    // Keep the YouTube miner sections collapsed by default.
    setYoutubeMinerCollapsibleOpen('youtubeMinerResponseContextBody', false);
    setYoutubeMinerCollapsibleOpen('youtubeMinerCategoriesBody', false);
    setYoutubeMinerCollapsibleOpen('youtubeMinerGuidelinesBody', false);
    setYoutubeMinerCollapsibleOpen('youtubeResearchBody', false);
    setYoutubeMinerCollapsibleOpen('youtubeMinerRepositoryBody', false);
    setYoutubeMinerCollapsibleOpen('youtubeMinerTrainingBody', false);
    setYoutubeMinerCollapsibleOpen('youtubeMinerContentBody', true);
    refreshYoutubeResearchCategoryHashtagHints().catch(function(err) {
      notify(err.message || 'Could not load messaging categories/hashtags for research', true);
    });
    refreshYoutubeMinerTargetHistory(700).catch(function() {});
    var restoredResearch = loadYoutubeResearchLastResult();
    if (restoredResearch) {
      renderYoutubeResearchResult(restoredResearch);
    } else {
      renderYoutubeResearchResult(null);
    }
    refreshYoutubeResearchRuns(30).catch(function() {});
    if (youtubeCommentMinerForm) {
      applyYoutubeMinerInputToForm(youtubeCommentMinerForm, loadYoutubeMinerLastInput());
    }
    var restoredMinerResult = loadYoutubeMinerLastResult();
    if (restoredMinerResult) {
      renderYoutubeCommentMinerResult(restoredMinerResult);
    } else if (activeVideoSnapshot && activeVideoSnapshot.video_url) {
      syncActiveVideoFromUrl(activeVideoSnapshot.video_url, activeVideoSnapshot);
    }
    if (youtubeMinerContentVideoFilter) {
      youtubeMinerContentVideoFilter.addEventListener('input', function() {
        renderYoutubeCommentMinerResult();
      });
    }
    if (youtubeMinerContentTopicFilter) {
      youtubeMinerContentTopicFilter.addEventListener('change', function() {
        renderYoutubeCommentMinerResult();
      });
    }
    if (youtubeMinerContentApproachFilter) {
      youtubeMinerContentApproachFilter.addEventListener('change', function() {
        renderYoutubeCommentMinerResult();
      });
    }
    if (youtubeMinerContentAuthorFilter) {
      youtubeMinerContentAuthorFilter.addEventListener('input', function() {
        renderYoutubeCommentMinerResult();
      });
    }
    if (youtubeMinerContentCommentFilter) {
      youtubeMinerContentCommentFilter.addEventListener('input', function() {
        renderYoutubeCommentMinerResult();
      });
    }
    if (youtubeCommentMinerSelectAllVisible) {
      youtubeCommentMinerSelectAllVisible.addEventListener('change', function() {
        getFilteredYoutubeCommentRows(youtubeMinerLastResult || {}).forEach(function(row) {
          var key = getCommentSelectionKey(row);
          if (!key) return;
          if (youtubeCommentMinerSelectAllVisible.checked) selectedCommentRowIds.add(key);
          else selectedCommentRowIds.delete(key);
        });
        renderYoutubeCommentMinerResult();
      });
    }
    if (youtubeCommentMinerEditSelectedBtn) {
      youtubeCommentMinerEditSelectedBtn.addEventListener('click', function() {
        bulkUpdateSelectedYoutubeComments();
      });
    }
    if (youtubeCommentMinerDeleteSelectedBtn) {
      youtubeCommentMinerDeleteSelectedBtn.addEventListener('click', function() {
        bulkDeleteSelectedYoutubeComments();
      });
    }
    if (youtubeCommentMinerAddContactBtn) {
      youtubeCommentMinerAddContactBtn.addEventListener('click', function() {
        addContactsFromSelectedYoutubeComments().catch(function(err) {
          notify(err.message || 'Could not add selected comment authors to contacts', true);
        });
      });
    }
    document.addEventListener('click', function(event) {
      var target = event && event.target;
      if (target && target.closest && target.closest('.youtube-miner-feedback-wrap')) return;
      document.querySelectorAll('.youtube-miner-feedback-pop').forEach(function(node) {
        node.classList.add('hidden');
      });
    });

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

        var runIds = getSelectedYoutubeRows().map(function(run) {
          return safeText(run && run.detail_run_id);
        }).filter(Boolean);
        if (!runIds.length) return notify('Select at least one editable YouTube run first', true);

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
    bindFilter('youtubeRunsHashtagsFilter',   runFilters,        'tags',       renderYoutubeRunsTable);
    bindFilter('youtubeRunsTranscriptFilter', runFilters,        'transcript', renderYoutubeRunsTable);
    renderCategoryControls();
    renderYoutubeCategoriesTable();
    syncBulkSelectionUi();
  }

  return {
    manifest: { id: 'youtube', label: 'YouTube Acquire', pageId: 'acquireYoutubePage' },
    init,
    refresh:         function() { return Promise.all([refreshYoutubeVideos(200), refreshYoutubeRuns(20), refreshCommentRuns(20), refreshYoutubeMinerRuns(10), refreshYoutubeResearchRuns(30), refreshYoutubeCategories()]); },
    onPageActivated: function() { return Promise.all([refreshYoutubeVideos(200), refreshYoutubeRuns(20), refreshCommentRuns(20), refreshYoutubeMinerRuns(10), refreshYoutubeResearchRuns(30), refreshYoutubeCategories()]); },
    refreshYoutubeRuns,
    refreshCommentRuns,
    refreshYoutubeCategories,
    renderYoutubeAcquireResult,
  };
})();
