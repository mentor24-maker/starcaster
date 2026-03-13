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
  var youtubeMinerMode = 'training';
  var youtubeMinerCategoryConfig = [];
  var youtubeMinerAttributeConfig = [];
  var youtubeMinerApproachConfig = [];
  var youtubeMinerCategorySelectedIds = new Set();
  var youtubeMinerAttributeSelectedIds = new Set();
  var youtubeMinerApproachSelectedIds = new Set();
  var youtubeMinerCategoryEditingIds = new Set();
  var youtubeMinerAttributeEditingIds = new Set();
  var youtubeMinerApproachEditingIds = new Set();
  var youtubeMinerLastResult = null;
  var YT_MINER_CATEGORY_CONFIG_KEY = 'yt_miner_category_config_v1';
  var YT_MINER_ATTRIBUTE_CONFIG_KEY = 'yt_miner_attribute_config_v1';
  var YT_MINER_APPROACH_CONFIG_KEY = 'yt_miner_approach_config_v1';
  var YT_MINER_RESPONSE_CONTEXT_KEY = 'yt_miner_response_context_v1';
  var YT_MINER_FEEDBACK_KEY_PREFIX = 'yt_miner_feedback:';
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

  function feedbackKeyForRow(row) {
    return YT_MINER_FEEDBACK_KEY_PREFIX + [safeText(row && row.video_id), safeText(row && row.id)].join(':');
  }

  function readFeedback(row) {
    try {
      var raw = window.localStorage.getItem(feedbackKeyForRow(row));
      if (!raw) return { quality: 0, categories: [], hashtags: '', note: '', response_type: '', suggested_response: '', updated_at: '' };
      var parsed = JSON.parse(raw);
      var categories = [];
      if (Array.isArray(parsed && parsed.categories)) {
        categories = parsed.categories.map(function(item) { return safeText(item); }).filter(Boolean);
      } else if (safeText(parsed && parsed.category)) {
        categories = safeText(parsed.category).split(/\r?\n|,/g).map(function(item) { return safeText(item); }).filter(Boolean);
      }
      return {
        quality: Math.max(0, Math.min(Number(parsed && parsed.quality) || 0, 5)),
        categories: Array.from(new Set(categories)).slice(0, 20),
        hashtags: safeText(parsed && (parsed.hashtags || parsed.tags)),
        note: safeText(parsed && parsed.note),
        response_type: safeText(parsed && (parsed.response_type || parsed.response_style)),
        suggested_response: safeText(parsed && (parsed.suggested_response || parsed.response_example)),
        updated_at: safeText(parsed && parsed.updated_at),
      };
    } catch (_) {
      return { quality: 0, categories: [], hashtags: '', note: '', response_type: '', suggested_response: '', updated_at: '' };
    }
  }

  function saveFeedback(row, feedbackPatch) {
    var existing = readFeedback(row);
    var merged = Object.assign({}, existing, feedbackPatch || {});
    merged.quality = Math.max(0, Math.min(Number(merged.quality) || 0, 5));
    merged.categories = toArray(merged.categories).map(function(item) { return safeText(item); }).filter(Boolean);
    merged.categories = Array.from(new Set(merged.categories)).slice(0, 20);
    merged.hashtags = safeText(merged.hashtags || merged.tags);
    delete merged.tags;
    merged.note = safeText(merged.note);
    merged.response_type = safeText(merged.response_type);
    merged.suggested_response = safeText(merged.suggested_response);
    merged.updated_at = new Date().toISOString();
    if (!merged.quality && !merged.categories.length && !merged.hashtags && !merged.note && !merged.response_type && !merged.suggested_response) {
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
        if (!quality) continue;
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
          hashtags: safeText(parsed && (parsed.hashtags || parsed.tags)),
          note: safeText(parsed && parsed.note),
          response_type: safeText(parsed && (parsed.response_type || parsed.response_style)),
          suggested_response: safeText(parsed && (parsed.suggested_response || parsed.response_example)),
          updated_at: safeText(parsed && parsed.updated_at),
        });
      }
    } catch (_) { /* ignore */ }
    return entries.sort(function(a, b) {
      return safeText(b.updated_at).localeCompare(safeText(a.updated_at));
    }).slice(0, 500);
  }

  function makeYoutubeMinerConfigId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function defaultYoutubeMinerCategoryConfig() {
    return [
      { id: makeYoutubeMinerConfigId('cat'), name: 'intent', rationale: 'Explicit “how do I start / what should I buy / what does it cost” language. High conversion potential; prioritize for direct follow-up.', value_rank: 5, match_hashtags: ['purchase_intent', 'solution_seeking'] },
      { id: makeYoutubeMinerConfigId('cat'), name: 'pain_point', rationale: 'Clear friction, dissatisfaction, or stuck-state statements. Valuable for empathy-first engagement and diagnostic questions.', value_rank: 5, match_hashtags: ['pain_point', 'problem_signal'] },
      { id: makeYoutubeMinerConfigId('cat'), name: 'growth', rationale: 'Identity-shift and self-improvement language (“want more,” “outgrowing old self”). Strong fit for aspirational messaging.', value_rank: 5, match_hashtags: ['growth_openness', 'identity_shift'] },
      { id: makeYoutubeMinerConfigId('cat'), name: 'question', rationale: 'Genuine information-seeking questions. Good candidates for trust-building, useful replies, and soft invitation to continue.', value_rank: 4, match_hashtags: ['question'] },
      { id: makeYoutubeMinerConfigId('cat'), name: 'positive', rationale: 'Supportive/affirming comments with low friction. Useful for community warmth but usually lower urgency than intent or pain.', value_rank: 3, match_hashtags: ['positive_signal'] },
      { id: makeYoutubeMinerConfigId('cat'), name: 'risk', rationale: 'Scam/fake/bot/skeptic cues. Requires credibility-first messaging and can be deprioritized unless strategically important.', value_rank: 2, match_hashtags: ['trust_risk'] },
      { id: makeYoutubeMinerConfigId('cat'), name: 'general', rationale: 'No strong actionable signal detected. Keep as background unless combined with high-value attributes.', value_rank: 1, match_hashtags: [] },
    ];
  }

  function defaultYoutubeMinerAttributeConfig() {
    return [
      { id: makeYoutubeMinerConfigId('attr'), name: 'motivated', rationale: 'Displays readiness to change behavior now (not “someday”). Prioritize because response likelihood and follow-through are high.', value_rank: 5, match_hashtags: ['growth_openness', 'purchase_intent', 'identity_shift'] },
      { id: makeYoutubeMinerConfigId('attr'), name: 'self_involved', rationale: 'Language centers status/appearance over substance. Engage lightly unless paired with intent or growth signals.', value_rank: 2, match_hashtags: ['social_handle'] },
      { id: makeYoutubeMinerConfigId('attr'), name: 'negative_outlook', rationale: 'Defeatist/cynical framing. Requires careful tone; avoid hard CTA and lead with acknowledgement + reframing.', value_rank: 2, match_hashtags: ['pain_point', 'trust_risk'] },
      { id: makeYoutubeMinerConfigId('attr'), name: 'fan', rationale: 'High affinity and goodwill. Useful for amplification and relationship-building, but often lower conversion urgency.', value_rank: 3, match_hashtags: ['positive_signal'] },
      { id: makeYoutubeMinerConfigId('attr'), name: 'introvert', rationale: 'Reflective and internal processing style. Better with thoughtful, non-pushy prompts and one clear next question.', value_rank: 3, match_hashtags: ['question', 'growth_openness'] },
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
    if (result && typeof result === 'object') {
      youtubeMinerLastResult = result;
    }
    var activeResult = youtubeMinerLastResult || {};
    var summaryEl = document.getElementById('youtubeCommentMinerSummary');
    var tableEl = document.getElementById('youtubeCommentMinerTable');
    var metaEl = document.getElementById('youtubeCommentMinerMeta');
    if (!summaryEl || !tableEl) return;

    var stats = activeResult && activeResult.stats ? activeResult.stats : {};
    var comments = toArray(activeResult && activeResult.comments).slice(0, 200);
    var contentSearchInput = document.getElementById('youtubeMinerContentSearch');
    var contentCategoryInput = document.getElementById('youtubeMinerContentCategoryFilter');
    var contentSortInput = document.getElementById('youtubeMinerContentSort');
    var searchQuery = safeText(contentSearchInput && contentSearchInput.value).toLowerCase();
    var categoryFilter = safeText(contentCategoryInput && contentCategoryInput.value);
    var sortBy = safeText(contentSortInput && contentSortInput.value) || 'score_desc';

    if (contentCategoryInput) {
      var categories = Array.from(new Set(comments.map(function(row) {
        return safeText(row && row.category);
      }).filter(Boolean))).sort(function(a, b) {
        return a.localeCompare(b);
      });
      var previousValue = contentCategoryInput.value;
      contentCategoryInput.innerHTML = '<option value="">All categories</option>';
      categories.forEach(function(cat) {
        var option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        contentCategoryInput.appendChild(option);
      });
      if (previousValue && categories.indexOf(previousValue) !== -1) {
        contentCategoryInput.value = previousValue;
      }
    }

    comments = comments.filter(function(row) {
      var rowCategory = safeText(row && row.category);
      if (categoryFilter && rowCategory !== categoryFilter) return false;
      if (!searchQuery) return true;
      var haystack = [
        safeText(row && row.text),
        safeText(row && row.author),
        safeText(row && row.video_title),
        safeText(row && row.video_id),
        toArray(row && (row.hashtags || row.tags)).join(' '),
        toArray(row && (row.attributes || row.attribute_names)).join(' '),
        safeText(row && (row.approach || row.approach_name)),
        toArray(row && row.why).join(' '),
      ].join(' ').toLowerCase();
      return haystack.indexOf(searchQuery) !== -1;
    });

    comments.sort(function(a, b) {
      var scoreA = Number(a && a.score || 0) || 0;
      var scoreB = Number(b && b.score || 0) || 0;
      if (sortBy === 'score_asc') return scoreA - scoreB;
      if (sortBy === 'category_asc') return safeText(a && a.category).localeCompare(safeText(b && b.category));
      if (sortBy === 'author_asc') return safeText(a && a.author).localeCompare(safeText(b && b.author));
      return scoreB - scoreA;
    });

    var harvestedVideos = Number(stats.harvested_videos || 0) || 0;
    var totalRaw = Number(stats.total_comments_raw || 0) || 0;
    var totalFiltered = Number(stats.total_comments_filtered || 0) || 0;
    summaryEl.textContent = 'Videos harvested: ' + harvestedVideos + ' | Raw comments: ' + totalRaw + ' | Filtered comments: ' + totalFiltered + ' | Visible rows: ' + comments.length;

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
      emptyTd.colSpan = 11;
      emptyTd.textContent = 'No filtered comments found for current settings.';
      emptyTr.appendChild(emptyTd);
      tableEl.appendChild(emptyTr);
      return;
    }

    comments.forEach(function(row) {
      var tr = document.createElement('tr');
      var feedback = readFeedback(row);

      var scoreTd = document.createElement('td');
      scoreTd.textContent = String(Number(row && row.score || 0) || 0);

      var categoryTd = document.createElement('td');
      var categoryName = safeText(row && row.category) || '-';
      var valueRank = Number(row && row.category_value_rank || 0) || 0;
      categoryTd.textContent = valueRank > 0 ? (categoryName + ' (' + valueRank + ')') : categoryName;

      var attributesTd = document.createElement('td');
      attributesTd.textContent = toArray(row && (row.attributes || row.attribute_names)).join(', ') || '-';

      var approachTd = document.createElement('td');
      approachTd.textContent = safeText(row && (row.approach || row.approach_name)) || '-';

      var whyTd = document.createElement('td');
      whyTd.textContent = toArray(row && row.why).join(' | ') || '-';

      var tagsTd = document.createElement('td');
      tagsTd.textContent = toArray(row && (row.hashtags || row.tags)).join(', ') || '-';

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
      var commentCell = document.createElement('div');
      commentCell.className = 'youtube-miner-comment-cell';

      var commentText = document.createElement('div');
      commentText.className = 'youtube-miner-comment-text';
      commentText.textContent = safeText(row && row.text) || '-';
      commentCell.appendChild(commentText);

      var feedbackWrap = document.createElement('div');
      feedbackWrap.className = 'youtube-miner-feedback-wrap';

      var feedbackBtn = document.createElement('button');
      feedbackBtn.type = 'button';
      feedbackBtn.className = 'youtube-miner-feedback-icon';
      feedbackBtn.title = 'Training feedback';
      feedbackBtn.textContent = '\u270E';
      if (feedback.quality > 0) feedbackBtn.classList.add('has-feedback');

      var feedbackPop = document.createElement('div');
      feedbackPop.className = 'youtube-miner-feedback-pop hidden';

      var feedbackHeading = document.createElement('h4');
      feedbackHeading.textContent = 'Training Feedback';
      feedbackPop.appendChild(feedbackHeading);

      var qualityRow = document.createElement('div');
      qualityRow.className = 'form-row';
      var qualityLabel = document.createElement('label');
      qualityLabel.textContent = 'Quality (1-5)';
      var qualityInput = document.createElement('select');
      qualityInput.innerHTML = '<option value="0">0 (unset)</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option>';
      qualityInput.value = String(feedback.quality || 0);
      qualityRow.appendChild(qualityLabel);
      qualityRow.appendChild(qualityInput);
      feedbackPop.appendChild(qualityRow);

      var catRow = document.createElement('div');
      catRow.className = 'form-row';
      var catLabel = document.createElement('label');
      catLabel.textContent = 'Category (multi-select)';
      var catInput = document.createElement('select');
      catInput.multiple = true;
      catInput.size = 6;
      var categoryNames = youtubeMinerCategoryConfig.map(function(item) {
        return safeText(item && item.name);
      }).filter(Boolean);
      categoryNames.forEach(function(name) {
        var option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        option.selected = feedback.categories.indexOf(name) !== -1;
        catInput.appendChild(option);
      });
      catRow.appendChild(catLabel);
      catRow.appendChild(catInput);
      feedbackPop.appendChild(catRow);

      var tagsRow = document.createElement('div');
      tagsRow.className = 'form-row';
      var tagsLabel = document.createElement('label');
      tagsLabel.textContent = 'Hashtags';
      var tagsInput = document.createElement('input');
      tagsInput.type = 'text';
      tagsInput.placeholder = 'comma,separated,hashtags';
      tagsInput.value = feedback.hashtags || toArray(row && (row.hashtags || row.tags)).join(', ');
      tagsRow.appendChild(tagsLabel);
      tagsRow.appendChild(tagsInput);
      feedbackPop.appendChild(tagsRow);

      var responseTypeRow = document.createElement('div');
      responseTypeRow.className = 'form-row';
      var responseTypeLabel = document.createElement('label');
      responseTypeLabel.textContent = 'Response Type';
      var responseTypeInput = document.createElement('select');
      responseTypeInput.innerHTML = [
        '<option value="">(unset)</option>',
        '<option value="empathetic">Empathetic</option>',
        '<option value="practical">Practical</option>',
        '<option value="question_back">Question Back</option>',
        '<option value="challenger">Challenger</option>',
        '<option value="invitational">Invitational</option>',
        '<option value="affirming">Affirming</option>',
        '<option value="resource_drop">Resource Drop</option>',
        '<option value="cta_soft">Soft CTA</option>',
        '<option value="cta_direct">Direct CTA</option>'
      ].join('');
      responseTypeInput.value = feedback.response_type || '';
      responseTypeRow.appendChild(responseTypeLabel);
      responseTypeRow.appendChild(responseTypeInput);
      feedbackPop.appendChild(responseTypeRow);

      var noteRow = document.createElement('div');
      noteRow.className = 'form-row';
      var noteLabel = document.createElement('label');
      noteLabel.textContent = 'What do you like about this comment?';
      var noteInput = document.createElement('textarea');
      noteInput.rows = 8;
      noteInput.placeholder = 'Explain what makes this comment valuable, what signals matter, and what reply style would fit.';
      noteInput.value = feedback.note || '';
      noteRow.appendChild(noteLabel);
      noteRow.appendChild(noteInput);
      feedbackPop.appendChild(noteRow);

      var suggestedRow = document.createElement('div');
      suggestedRow.className = 'form-row';
      var suggestedLabel = document.createElement('label');
      suggestedLabel.textContent = 'Suggested Response';
      var suggestedInput = document.createElement('textarea');
      suggestedInput.rows = 4;
      suggestedInput.placeholder = 'Optional: write the exact style or sample response you would want here.';
      suggestedInput.value = feedback.suggested_response || '';
      suggestedRow.appendChild(suggestedLabel);
      suggestedRow.appendChild(suggestedInput);
      feedbackPop.appendChild(suggestedRow);

      var actionRow = document.createElement('div');
      actionRow.className = 'youtube-miner-feedback-actions';
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = 'Close';
      var saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.textContent = 'Save Feedback';
      actionRow.appendChild(closeBtn);
      actionRow.appendChild(saveBtn);
      feedbackPop.appendChild(actionRow);

      feedbackBtn.addEventListener('click', function() {
        var isHidden = feedbackPop.classList.contains('hidden');
        document.querySelectorAll('.youtube-miner-feedback-pop').forEach(function(node) {
          if (node !== feedbackPop) node.classList.add('hidden');
        });
        feedbackPop.classList.toggle('hidden', !isHidden);
      });
      closeBtn.addEventListener('click', function() {
        feedbackPop.classList.add('hidden');
      });
      saveBtn.addEventListener('click', function() {
        var selectedCategories = Array.prototype.slice.call(catInput.options || [])
          .filter(function(option) { return option.selected; })
          .map(function(option) { return safeText(option.value); })
          .filter(Boolean);
        saveFeedback(row, {
          quality: Number(qualityInput.value || 0),
          categories: selectedCategories,
          hashtags: tagsInput.value,
          note: noteInput.value,
          response_type: responseTypeInput.value,
          suggested_response: suggestedInput.value,
        });
        var updated = readFeedback(row);
        feedbackBtn.classList.toggle('has-feedback', Number(updated.quality || 0) > 0);
        feedbackTd.textContent = updated.quality > 0
          ? ('Q' + String(updated.quality)
            + (updated.categories.length ? (' | ' + updated.categories.join(', ')) : '')
            + (updated.response_type ? (' | ' + updated.response_type) : ''))
          : '-';
        feedbackPop.classList.add('hidden');
        notify('Training feedback saved');
      });

      feedbackWrap.appendChild(feedbackBtn);
      feedbackWrap.appendChild(feedbackPop);
      commentCell.appendChild(feedbackWrap);
      commentTd.appendChild(commentCell);

      var draftTd = document.createElement('td');
      draftTd.textContent = safeText(row && row.reply_draft) || '-';

      var feedbackTd = document.createElement('td');
      feedbackTd.textContent = feedback.quality > 0
        ? ('Q' + String(feedback.quality)
          + (feedback.categories.length ? (' | ' + feedback.categories.join(', ')) : '')
          + (feedback.response_type ? (' | ' + feedback.response_type) : ''))
        : '-';

      tr.appendChild(scoreTd);
      tr.appendChild(categoryTd);
      tr.appendChild(attributesTd);
      tr.appendChild(approachTd);
      tr.appendChild(whyTd);
      tr.appendChild(tagsTd);
      tr.appendChild(authorTd);
      tr.appendChild(videoTd);
      tr.appendChild(commentTd);
      tr.appendChild(draftTd);
      tr.appendChild(feedbackTd);
      tableEl.appendChild(tr);
    });
  }

  function setYoutubeMinerMode(mode) {
    youtubeMinerMode = mode === 'production' ? 'production' : 'training';
    var trainingBtn = document.getElementById('youtubeMinerTrainingBtn');
    var productionBtn = document.getElementById('youtubeMinerProductionBtn');
    var trainingPanel = document.getElementById('youtubeMinerTrainingPanel');
    var productionPanel = document.getElementById('youtubeMinerProductionPanel');
    if (trainingBtn) trainingBtn.classList.toggle('active', youtubeMinerMode === 'training');
    if (productionBtn) productionBtn.classList.toggle('active', youtubeMinerMode === 'production');
    if (trainingPanel) trainingPanel.classList.toggle('hidden', youtubeMinerMode !== 'training');
    if (productionPanel) productionPanel.classList.toggle('hidden', youtubeMinerMode !== 'production');
  }

  function setupYoutubeMinerCollapsibles() {
    var toggles = Array.prototype.slice.call(document.querySelectorAll('.youtube-miner-collapsible-toggle[data-target-id]'));
    toggles.forEach(function(toggle) {
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
          'Copy URL': 'copy',
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
      
      function findCommentRunForVideoUrl(videoUrl) {
        var url = String(videoUrl || '').trim();
        if (!url) return null;
        return (state.acquireYoutubeComments || []).find(function(r) {
          return String(r.video_url || '').trim() === url;
        }) || null;
      }

      var copyBtn         = mkBtn('Copy URL',        function() {
        copyTextToClipboard(run.video_url)
          .then(function() { notify('Video URL copied'); })
          .catch(function(e) { notify(safeText(e && e.message) || 'Could not copy URL', true); });
      });
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
      actionsTd.appendChild(copyBtn); actionsTd.appendChild(viewBtn); actionsTd.appendChild(editBtn); actionsTd.appendChild(addBtn);
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
            include_phrases_text: String(formData.get('include_phrases_text') || '').trim(),
            exclude_phrases_text: String(formData.get('exclude_phrases_text') || '').trim(),
            category_config: collectYoutubeMinerCategoryConfigFromUi(),
            attribute_config: collectYoutubeMinerConfigFromUi('attribute'),
            approach_config: collectYoutubeMinerConfigFromUi('approach'),
            response_context: String(formData.get('response_context') || '').trim(),
            training_feedback: collectYoutubeMinerFeedbackCorpus(),
          };
          if (!payload.targets_text) throw new Error('Add at least one video/channel target.');
          saveYoutubeMinerCategoryConfig(payload.category_config);
          youtubeMinerCategoryConfig = payload.category_config.slice();
          saveYoutubeMinerConfig('attribute', payload.attribute_config);
          youtubeMinerAttributeConfig = payload.attribute_config.slice();
          saveYoutubeMinerConfig('approach', payload.approach_config);
          youtubeMinerApproachConfig = payload.approach_config.slice();
          saveYoutubeMinerResponseContext(payload.response_context);
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

    var youtubeMinerTrainingBtn = document.getElementById('youtubeMinerTrainingBtn');
    var youtubeMinerProductionBtn = document.getElementById('youtubeMinerProductionBtn');
    var youtubeMinerContentSearch = document.getElementById('youtubeMinerContentSearch');
    var youtubeMinerContentCategoryFilter = document.getElementById('youtubeMinerContentCategoryFilter');
    var youtubeMinerContentSort = document.getElementById('youtubeMinerContentSort');
    var youtubeMinerResponseContext = document.getElementById('youtubeMinerResponseContext');
    if (youtubeMinerTrainingBtn) {
      youtubeMinerTrainingBtn.addEventListener('click', function() { setYoutubeMinerMode('training'); });
    }
    if (youtubeMinerProductionBtn) {
      youtubeMinerProductionBtn.addEventListener('click', function() { setYoutubeMinerMode('production'); });
    }
    youtubeMinerCategoryConfig = applyRecommendedRows('category', loadYoutubeMinerCategoryConfig());
    youtubeMinerAttributeConfig = applyRecommendedRows('attribute', loadYoutubeMinerConfig('attribute'));
    youtubeMinerApproachConfig = applyRecommendedRows('approach', loadYoutubeMinerConfig('approach'));
    saveYoutubeMinerCategoryConfig(youtubeMinerCategoryConfig);
    saveYoutubeMinerConfig('attribute', youtubeMinerAttributeConfig);
    saveYoutubeMinerConfig('approach', youtubeMinerApproachConfig);
    if (youtubeMinerResponseContext) {
      youtubeMinerResponseContext.value = loadYoutubeMinerResponseContext();
      youtubeMinerResponseContext.addEventListener('input', function() {
        saveYoutubeMinerResponseContext(youtubeMinerResponseContext.value);
      });
    }
    renderYoutubeMinerCategoryConfig();
    renderYoutubeMinerConfig('attribute');
    renderYoutubeMinerConfig('approach');
    bindYoutubeMinerConfigEvents('category');
    bindYoutubeMinerConfigEvents('attribute');
    bindYoutubeMinerConfigEvents('approach');
    setYoutubeMinerMode('training');
    setupYoutubeMinerCollapsibles();
    if (youtubeMinerContentSearch) {
      youtubeMinerContentSearch.addEventListener('input', function() {
        renderYoutubeCommentMinerResult();
      });
    }
    if (youtubeMinerContentCategoryFilter) {
      youtubeMinerContentCategoryFilter.addEventListener('change', function() {
        renderYoutubeCommentMinerResult();
      });
    }
    if (youtubeMinerContentSort) {
      youtubeMinerContentSort.addEventListener('change', function() {
        renderYoutubeCommentMinerResult();
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
