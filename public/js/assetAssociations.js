window.App = window.App || {};

App.assetAssociations = (function assetAssociationsModule() {
  const { api, notify } = App;

  const MESSAGING_TARGETS = [
    { type: 'messaging_headlines', label: 'Headlines', endpoint: '/api/messaging/headlines?limit=5000', keys: ['headlines'], fields: ['headline'] },
    { type: 'messaging_subheadings', label: 'Sub-headings', endpoint: '/api/messaging/subheadings?limit=5000', keys: ['subheadings'], fields: ['subheading'] },
    { type: 'messaging_taglines', label: 'Taglines', endpoint: '/api/messaging/taglines?limit=5000', keys: ['taglines'], fields: ['tagline'] },
    { type: 'messaging_pitches', label: 'Pitches', endpoint: '/api/messaging/pitches?limit=5000', keys: ['pitches'], fields: ['pitch'] },
    { type: 'messaging_articles', label: 'Articles', endpoint: '/api/messaging/articles?limit=5000', keys: ['articles'], fields: ['title'] },
    { type: 'messaging_reports', label: 'Reports', endpoint: '/api/messaging/reports?limit=5000', keys: ['reports'], fields: ['title'] },
    { type: 'messaging_white_papers', label: 'White Papers', endpoint: '/api/messaging/white-papers?limit=5000', keys: ['whitePapers', 'white_papers'], fields: ['title'] },
    { type: 'messaging_ebooks', label: 'eBooks', endpoint: '/api/messaging/ebooks?limit=5000', keys: ['ebooks'], fields: ['title'] },
    { type: 'messaging_emails', label: 'Emails', endpoint: '/api/messaging/emails?limit=5000', keys: ['emails'], fields: ['subject', 'email'] },
    { type: 'messaging_tweets', label: 'Tweets', endpoint: '/api/messaging/tweets?limit=5000', keys: ['tweets'], fields: ['content'] },
    { type: 'messaging_posts', label: 'Posts', endpoint: '/api/messaging/posts?limit=5000', keys: ['posts'], fields: ['post'] },
    { type: 'messaging_descriptions', label: 'Descriptions', endpoint: '/api/messaging/descriptions?limit=5000', keys: ['descriptions'], fields: ['description'] },
    { type: 'messaging_transcripts', label: 'Transcripts', endpoint: '/api/messaging/transcripts?limit=5000', keys: ['transcripts'], fields: ['transcript'] },
    { type: 'messaging_comments', label: 'Comments', endpoint: '/api/messaging/comments?limit=5000', keys: ['comments'], fields: ['comment'] },
    { type: 'messaging_keywords', label: 'Keywords', endpoint: '/api/messaging/keywords?limit=5000', keys: ['keywords'], fields: ['keyword'] },
    { type: 'messaging_hashtags', label: 'Hashtags', endpoint: '/api/messaging/hashtags?limit=5000', keys: ['hashtags'], fields: ['hashtag'] },
    { type: 'messaging_ctas', label: 'Calls to Action', endpoint: '/api/messaging/ctas?limit=5000', keys: ['ctas'], fields: ['cta'] },
  ];

  const TARGET_GROUPS = [
    { id: 'messaging', label: 'Messaging Content', children: MESSAGING_TARGETS },
    {
      id: 'assets',
      label: 'Assets',
      type: 'asset',
      endpoint: '/api/assets',
      keys: ['assets', 'data'],
      fields: ['assetName', 'asset_name'],
      excludeSelf: true,
    },
    {
      id: 'asset_categories',
      label: 'Asset Categories',
      type: 'asset_category',
      endpoint: '/api/asset-categories',
      keys: ['categories', 'assetCategories', 'data'],
      fields: ['category'],
      formatLabel: (item) => {
        const type = String(item.assetType || item.asset_type || '').trim();
        const name = String(item.category || '').trim() || '(unnamed)';
        return type ? `${name} (${type})` : name;
      },
    },
    {
      id: 'campaigns',
      label: 'Campaigns',
      type: 'campaign',
      endpoint: '/api/campaigns',
      keys: ['campaigns', 'data'],
      fields: ['name', 'subject'],
    },
    {
      id: 'landing_pages',
      label: 'Builder Pages',
      type: 'landing_page',
      endpoint: '/api/builder/landing-pages',
      keys: ['pages', 'landing_pages', 'data'],
      fields: ['name'],
    },
    {
      id: 'topics',
      label: 'Topics',
      type: 'messaging_topic',
      endpoint: '/api/messaging/topics?limit=5000',
      keys: ['topics', 'categories', 'data'],
      fields: ['topic', 'category'],
    },
    {
      id: 'polls',
      label: 'Polls',
      type: 'poll',
      endpoint: '/api/polls',
      keys: ['polls', 'data'],
      fields: ['question'],
    },
  ];

  const els = {};
  let activeAsset = null;
  let associations = [];
  let navStack = [];
  let listLoading = false;
  let cachedItems = [];
  let browserFilterQuery = '';

  function byId(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    els.modal = byId('assetAssociationsModal');
    els.closeBtn = byId('assetAssociationsCloseBtn');
    els.assetPanel = byId('assetAssociationsAssetPanel');
    els.linkedList = byId('assetAssociationsLinkedList');
    els.breadcrumb = byId('assetAssociationsBreadcrumb');
    els.browserList = byId('assetAssociationsBrowserList');
    els.browserStatus = byId('assetAssociationsBrowserStatus');
    els.backBtn = byId('assetAssociationsBackBtn');
    els.searchInput = byId('assetAssociationsSearch');
  }

  function normalizeFilterQuery() {
    return String(browserFilterQuery || '').trim().toLowerCase();
  }

  function clearBrowserFilter() {
    browserFilterQuery = '';
    if (els.searchInput) els.searchInput.value = '';
  }

  function matchesBrowserFilter(haystack, query) {
    if (!query) return true;
    return String(haystack || '').toLowerCase().includes(query);
  }

  function itemSearchHaystack(item, config, label) {
    const parts = [label];
    const fields = Array.isArray(config?.fields) ? config.fields : [];
    fields.forEach((field) => {
      const snake = field.replace(/([A-Z])/g, '_$1').toLowerCase();
      parts.push(item?.[field], item?.[snake]);
    });
    parts.push(item?.topic, item?.category, item?.id);
    return parts.filter(Boolean).join(' ');
  }

  function syncSearchField() {
    if (!els.searchInput) return;
    const nav = currentNav();
    const atItems = nav?.kind === 'target';
    els.searchInput.placeholder = atItems ? 'Search items' : 'Search object types';
    els.searchInput.disabled = Boolean(listLoading);
    els.searchInput.setAttribute('aria-label', atItems ? 'Search items' : 'Search object types');
  }

  function filterStatusMessage(shown, total, emptyLabel, filteredEmptyLabel) {
    const query = normalizeFilterQuery();
    if (!total) return emptyLabel;
    if (!shown && query) return filteredEmptyLabel;
    if (query && shown < total) return `${shown} of ${total} match your search.`;
    return emptyLabel;
  }

  function truncate(text, max = 120) {
    const value = String(text || '').trim();
    if (value.length <= max) return value || '(untitled)';
    return `${value.slice(0, max - 1)}…`;
  }

  function extractItems(res, keys) {
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const key of keyList) {
      if (Array.isArray(res?.[key])) return res[key];
    }
    if (Array.isArray(res?.data)) return res.data;
    return [];
  }

  function itemLabel(item, config) {
    if (typeof config.formatLabel === 'function') {
      return truncate(config.formatLabel(item));
    }
    const fields = Array.isArray(config.fields) ? config.fields : [];
    for (const field of fields) {
      const snake = field.replace(/([A-Z])/g, '_$1').toLowerCase();
      const value = String(item?.[field] ?? item?.[snake] ?? '').trim();
      if (value) return truncate(value);
    }
    const id = item?.id;
    return id != null ? `Item ${id}` : '(untitled)';
  }

  function itemId(item) {
    const id = item?.id;
    if (id == null || id === '') return '';
    return String(id);
  }

  function targetTypeLabel(type) {
    const fromMessaging = MESSAGING_TARGETS.find((entry) => entry.type === type);
    if (fromMessaging) return fromMessaging.label;
    const fromGroup = TARGET_GROUPS.find((group) => group.type === type);
    if (fromGroup) return fromGroup.label;
    return String(type || '').replace(/_/g, ' ');
  }

  function displayAssetType(value) {
    const type = String(value || '').trim();
    if (type === 'Lead Magnet') return 'PDF';
    return type || '-';
  }

  function assetThumbUrl(asset) {
    if (!asset || typeof App.assets?.assetImageUrl !== 'function') return '';
    return App.assets.assetImageUrl(asset) || '';
  }

  function renderAssetPanel() {
    if (!els.assetPanel || !activeAsset) return;
    const name = String(activeAsset.assetName || '').trim() || 'Asset';
    const type = displayAssetType(activeAsset.assetType);
    const category = String(activeAsset.category || '').trim() || '-';
    const thumb = assetThumbUrl(activeAsset);
    const thumbHtml = thumb
      ? `<img class="asset-associations-thumb" src="${thumb}" alt="" />`
      : '<div class="asset-associations-thumb asset-associations-thumb--empty">No Preview</div>';

    els.assetPanel.innerHTML = `
      ${thumbHtml}
      <h3 class="asset-associations-asset-name">${name}</h3>
      <dl class="asset-associations-meta">
        <dt>Type</dt><dd>${type}</dd>
        <dt>Category</dt><dd>${category}</dd>
      </dl>
    `;
    renderLinkedAssociations();
  }

  function renderLinkedAssociations() {
    if (!els.linkedList) return;
    els.linkedList.innerHTML = '';
    if (!associations.length) {
      const empty = document.createElement('li');
      empty.className = 'asset-associations-empty';
      empty.textContent = 'No associations yet.';
      els.linkedList.appendChild(empty);
      return;
    }

    associations.forEach((assoc) => {
      const li = document.createElement('li');
      li.className = 'asset-associations-linked-item';
      const label = document.createElement('span');
      label.className = 'asset-associations-linked-label';
      const display = String(assoc.targetLabel || '').trim()
        || `${targetTypeLabel(assoc.targetType)} #${assoc.targetId}`;
      label.textContent = display;
      label.title = display;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn tiny-btn icon-btn icon-btn-danger';
      removeBtn.setAttribute('aria-label', 'Remove Association');
      removeBtn.title = 'Remove Association';
      removeBtn.appendChild(App.makeInlineIcon('delete'));
      removeBtn.addEventListener('click', () => removeAssociation(assoc.id));

      li.appendChild(label);
      li.appendChild(removeBtn);
      els.linkedList.appendChild(li);
    });
  }

  function setBrowserStatus(text, isError = false) {
    if (!els.browserStatus) return;
    els.browserStatus.textContent = String(text || '');
    els.browserStatus.classList.toggle('is-error', Boolean(isError));
  }

  function currentNav() {
    return navStack.length ? navStack[navStack.length - 1] : null;
  }

  function renderBreadcrumb() {
    if (!els.breadcrumb) return;
    els.breadcrumb.innerHTML = '';
    const crumbs = [{ label: 'Object Types', action: () => resetNav() }];
    navStack.forEach((entry, index) => {
      if (entry.kind === 'group' && entry.group?.children) {
        crumbs.push({
          label: entry.group.label,
          action: index < navStack.length - 1 ? () => {
            navStack = navStack.slice(0, index + 1);
            renderBrowser();
          } : null,
        });
      } else if (entry.kind === 'target') {
        crumbs.push({
          label: entry.config.label || entry.config.type,
          action: index < navStack.length - 1 ? () => {
            navStack = navStack.slice(0, index + 1);
            renderBrowser();
          } : null,
        });
      }
    });

    crumbs.forEach((crumb, index) => {
      if (index > 0) {
        const sep = document.createElement('span');
        sep.className = 'asset-associations-crumb-sep';
        sep.textContent = '›';
        sep.setAttribute('aria-hidden', 'true');
        els.breadcrumb.appendChild(sep);
      }
      if (crumb.action && index < crumbs.length - 1) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'asset-associations-crumb-btn';
        btn.textContent = crumb.label;
        btn.addEventListener('click', crumb.action);
        els.breadcrumb.appendChild(btn);
      } else {
        const span = document.createElement('span');
        span.className = 'asset-associations-crumb-current';
        span.textContent = crumb.label;
        els.breadcrumb.appendChild(span);
      }
    });

    if (els.backBtn) {
      els.backBtn.disabled = navStack.length === 0;
    }
  }

  function resetNav() {
    navStack = [];
    cachedItems = [];
    clearBrowserFilter();
    renderBrowser();
  }

  function pushNav(entry) {
    clearBrowserFilter();
    navStack.push(entry);
    renderBrowser();
  }

  function popNav() {
    if (!navStack.length) return;
    clearBrowserFilter();
    navStack.pop();
    cachedItems = [];
    renderBrowser();
  }

  function renderTypeList(entries, onPick) {
    if (!els.browserList) return;
    els.browserList.innerHTML = '';
    const query = normalizeFilterQuery();
    const sorted = [...entries].sort((a, b) => String(a.label).localeCompare(String(b.label)));
    const filtered = sorted.filter((entry) => matchesBrowserFilter(entry.label, query));
    filtered.forEach((entry) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'asset-associations-picker-row';
      btn.textContent = entry.label;
      btn.addEventListener('click', () => onPick(entry));
      els.browserList.appendChild(btn);
    });
    setBrowserStatus(filterStatusMessage(
      filtered.length,
      sorted.length,
      sorted.length ? 'Select an object type.' : 'No object types available.',
      'No object types match your search.'
    ));
  }

  function renderItemList(items, config) {
    if (!els.browserList) return;
    els.browserList.innerHTML = '';
    const query = normalizeFilterQuery();
    const candidates = [];
    items.forEach((item) => {
      const id = itemId(item);
      if (!id) return;
      if (config.excludeSelf && activeAsset && String(activeAsset.id) === id) return;
      const label = itemLabel(item, config);
      candidates.push({ item, label, haystack: itemSearchHaystack(item, config, label) });
    });
    const sorted = candidates.sort((a, b) => a.label.localeCompare(b.label));
    const filtered = sorted.filter((entry) => matchesBrowserFilter(entry.haystack, query));
    filtered.forEach((entry) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'asset-associations-picker-row';
      btn.textContent = entry.label;
      btn.addEventListener('click', () => associateWithTarget(config, entry.item));
      els.browserList.appendChild(btn);
    });
    setBrowserStatus(filterStatusMessage(
      filtered.length,
      sorted.length,
      sorted.length ? 'Click an item to associate it with this asset.' : 'No items found for this type.',
      'No items match your search.'
    ));
  }

  function renderBrowser() {
    syncSearchField();
    renderBreadcrumb();
    const nav = currentNav();
    if (!nav) {
      renderTypeList(
        TARGET_GROUPS.map((group) => ({ label: group.label, group })),
        (entry) => {
          if (entry.group.children) {
            pushNav({ kind: 'group', group: entry.group });
          } else {
            pushNav({ kind: 'target', config: entry.group });
            loadTargetItems(entry.group);
          }
        }
      );
      return;
    }

    if (nav.kind === 'group' && nav.group?.children) {
      renderTypeList(
        nav.group.children.map((child) => ({ label: child.label, config: child })),
        (entry) => {
          pushNav({ kind: 'target', config: entry.config });
          loadTargetItems(entry.config);
        }
      );
      return;
    }

    if (nav.kind === 'target') {
      if (listLoading) {
        if (els.browserList) els.browserList.innerHTML = '';
        setBrowserStatus('Loading…');
        return;
      }
      renderItemList(cachedItems, nav.config);
    }
  }

  async function loadAssociations() {
    if (!activeAsset?.id) {
      associations = [];
      renderLinkedAssociations();
      return;
    }
    try {
      const res = await api(`/api/assets/${encodeURIComponent(activeAsset.id)}/associations`);
      associations = Array.isArray(res?.associations)
        ? res.associations
        : Array.isArray(res?.data)
          ? res.data
          : [];
    } catch (err) {
      associations = [];
      notify(`Could not load associations: ${err.message}`, true);
    }
    renderLinkedAssociations();
  }

  async function loadTargetItems(config) {
    listLoading = true;
    cachedItems = [];
    renderBrowser();
    try {
      const res = await api(config.endpoint);
      cachedItems = extractItems(res, config.keys);
    } catch (err) {
      cachedItems = [];
      setBrowserStatus(`Could not load items: ${err.message}`, true);
      if (App.components?.Toast) {
        App.components.Toast.show(`Could not load ${config.label}: ${err.message}`, 'error');
      }
    } finally {
      listLoading = false;
      renderBrowser();
    }
  }

  async function associateWithTarget(config, item) {
    const targetId = itemId(item);
    if (!activeAsset?.id || !targetId) return;
    const targetType = config.type;
    const targetLabel = itemLabel(item, config);
    try {
      const res = await api(`/api/assets/${encodeURIComponent(activeAsset.id)}/associations`, {
        method: 'POST',
        body: JSON.stringify({
          targetType,
          targetId,
          targetLabel: `${targetTypeLabel(targetType)}: ${targetLabel}`,
        }),
      });
      const created = res?.association || res?.data;
      if (created) {
        associations = [created, ...associations.filter((row) => row.id !== created.id)];
      } else {
        await loadAssociations();
      }
      renderLinkedAssociations();
      if (App.components?.Toast) {
        App.components.Toast.show('Association saved.', 'success');
      } else {
        notify('Association saved.');
      }
    } catch (err) {
      const msg = String(err.message || 'Request failed');
      if (App.components?.Toast) {
        App.components.Toast.show(msg, 'error');
      } else {
        notify(msg, true);
      }
    }
  }

  async function removeAssociation(associationId) {
    const id = Number(associationId || 0);
    if (!id) return;
    try {
      await api(`/api/assets/associations/${encodeURIComponent(id)}`, { method: 'DELETE' });
      associations = associations.filter((row) => Number(row.id) !== id);
      renderLinkedAssociations();
      if (App.components?.Toast) {
        App.components.Toast.show('Association removed.', 'success');
      }
    } catch (err) {
      notify(`Could not remove association: ${err.message}`, true);
    }
  }

  function openModal(asset) {
    if (!els.modal || !asset) return;
    activeAsset = asset;
    navStack = [];
    cachedItems = [];
    listLoading = false;
    clearBrowserFilter();
    renderAssetPanel();
    loadAssociations();
    resetNav();
    els.modal.classList.remove('hidden');
    document.body.classList.add('asset-associations-modal-open');
  }

  function closeModal() {
    if (!els.modal) return;
    els.modal.classList.add('hidden');
    document.body.classList.remove('asset-associations-modal-open');
    activeAsset = null;
    associations = [];
    navStack = [];
    cachedItems = [];
    clearBrowserFilter();
  }

  function init() {
    cacheElements();
    if (!els.modal) return;

    els.closeBtn?.addEventListener('click', closeModal);
    els.backBtn?.addEventListener('click', popNav);
    els.searchInput?.addEventListener('input', () => {
      browserFilterQuery = String(els.searchInput?.value || '');
      renderBrowser();
    });
    els.modal.addEventListener('click', (event) => {
      if (event.target === els.modal) closeModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && els.modal && !els.modal.classList.contains('hidden')) {
        closeModal();
      }
    });
  }

  return {
    init,
    openModal,
    closeModal,
  };
})();
