
/**
 * app.js — Application entry point and module orchestrator.
 *
 * ── Adding a new feature module ───────────────────────────────────────────
 *   1. Create public/js/myModule.js following the window.App namespace pattern.
 *      Its returned object must include a `manifest` property:
 *        manifest: { id: 'myModule', label: 'My Module', pageId: 'myModulePage' }
 *      It should expose an `init()` function and optionally a `refresh()` function.
 *   2. Add one <script> tag for it in index.html (before app.js).
 *   3. Register it in App.manifests below — one line.
 *   That's it. app.js auto-calls init() and refresh() for every registered module.
 * ──────────────────────────────────────────────────────────────────────────
 */

// ---------------------------------------------------------------------------
// Module registry — every feature module is listed once here.
// Order determines init() call order. app.js does the rest automatically.
// ---------------------------------------------------------------------------

App.manifests = [
  App.contacts,
  App.segments,
  App.campaigns,
  App.promoLeads,
  App.assets,
  App.assetCategories,
  App.channels,
  App.settings,
  App.acquire,
  App.youtube,
  App.youtubeComments,
  App.messaging,
  App.promoteEmail,
  App.promoteSocial,
  App.engageComments,
  App.docsApiSetup,
  App.develop,
  App.activityLog,
  App.observe,          // Integrates observe.js page views and API quotas
  App.envConfig,        // #7 — Env Configuration
];

// ---------------------------------------------------------------------------
// Global refresh — calls refresh() on any module that exposes it,
// plus fetches shared state (contacts, segments, campaigns).
// ---------------------------------------------------------------------------

App.refresh = async function refresh() {
  const { state, api, notify } = App;
  const activePageId = String(state.activePage || '');
  if (Array.isArray(App.PUBLIC_LEGAL_PAGE_IDS) && App.PUBLIC_LEGAL_PAGE_IDS.includes(activePageId)) {
    return;
  }
  const shouldNotifySharedDataErrors = (() => {
    if (!activePageId) return true;
    const relevantPrefixes = [
      'contacts',
      'segments',
      'campaigns',
      'promoteEmailPage',
      'promoteSocialPage',
      'engageEmailPage'
    ];
    return relevantPrefixes.some((prefix) => activePageId.startsWith(prefix));
  })();

  const [contactsRes, segmentsRes, campaignsRes] = await Promise.allSettled([
    api('/api/contacts'),
    api('/api/segments'),
    api('/api/campaigns')
  ]);

  if (contactsRes.status === 'fulfilled') {
    state.contacts = App.normalizeApiArray(contactsRes.value, 'contacts');
  } else {
    state.contacts = [];
    if (shouldNotifySharedDataErrors) {
      notify(`Contacts load failed: ${contactsRes.reason?.message || 'unknown error'}`, true);
    }
  }

  if (segmentsRes.status === 'fulfilled') {
    state.segments = App.normalizeApiArray(segmentsRes.value, 'segments');
  } else {
    state.segments = [];
    if (shouldNotifySharedDataErrors) {
      notify(`Segments load failed: ${segmentsRes.reason?.message || 'unknown error'}`, true);
    }
  }

  if (campaignsRes.status === 'fulfilled') {
    state.campaigns = App.normalizeApiArray(campaignsRes.value, 'campaigns');
  } else {
    state.campaigns = [];
    if (shouldNotifySharedDataErrors) {
      notify(`Campaigns load failed: ${campaignsRes.reason?.message || 'unknown error'}`, true);
    }
  }

  // Render modules that depend on shared state
  App.contacts.renderContacts();
  App.segments.renderSegments();
  App.campaigns.renderCampaigns();

  // Refresh only active-page modules (or global modules without page binding).
  // This prevents unrelated API calls/noise while the user is on another section.
  for (const mod of App.manifests) {
    if (!mod || typeof mod !== 'object') continue;
    if (typeof mod.refresh === 'function') {
      const pageId = String(mod?.manifest?.pageId || '');
      const pagePrefixes = Array.isArray(mod?.manifest?.pagePrefixes)
        ? mod.manifest.pagePrefixes.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
      const matchesPrefix = Boolean(
        activePageId
        && pagePrefixes.some((prefix) => activePageId.startsWith(prefix))
      );
      if (pageId && activePageId && pageId !== activePageId && !matchesPrefix) continue;
      try {
        await mod.refresh();
      } catch (err) {
        const label = mod.manifest?.label || mod.manifest?.id || 'module';
        notify(`${label} refresh failed: ${err.message}`, true);
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Navigation — load page data when the page is first shown
// ---------------------------------------------------------------------------

if (App.els.topNav) {
  App.els.topNav.addEventListener('click', (event) => {
    const link = event.target.closest('.menu-link[data-page]');
    if (!link) return;
    event.preventDefault();
    const requestedPage = String(link.dataset.page || '');
    const assetType = String(link.dataset.assetType || '').trim();
    const assetCategory = String(link.dataset.assetCategory || '').trim();
    const targetPage = (assetType || assetCategory) ? 'manageAssetsPage' : requestedPage;

    if ((assetType || assetCategory) && App.state?.assetsFilters) {
      App.state.assetsFilters.asset_type = assetType || '';
      App.state.assetsFilters.category = assetCategory || '';
      if (App.els?.assetsFilterType) {
        App.els.assetsFilterType.value = assetType || '';
      }
    }

    App.setActivePage(targetPage);
    App.refresh().catch((err) => App.notify(err.message, true));

    // Trigger on-activation callbacks for modules that want them
    for (const mod of App.manifests) {
      if (!mod || typeof mod !== 'object') continue;
      const pageId = String(mod?.manifest?.pageId || '');
      const pagePrefixes = Array.isArray(mod?.manifest?.pagePrefixes)
        ? mod.manifest.pagePrefixes.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
      const matchesPrefix = pagePrefixes.some((prefix) => targetPage.startsWith(prefix));
      if (mod.manifest && (pageId === targetPage || matchesPrefix) &&
          typeof mod.onPageActivated === 'function') {
        mod.onPageActivated(targetPage);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Boot — init all registered modules, then start
// ---------------------------------------------------------------------------

App.bootMainApp = function bootMainApp() {
  if (App._bootedMainApp) return;
  App._bootedMainApp = true;

  if (App.pageHeadingNav?.init) {
    try {
      App.pageHeadingNav.init();
    } catch (err) {
      console.error('Page heading navigation init failed:', err);
    }
  }

  if (App.assetFieldImport?.init) {
    try {
      App.assetFieldImport.init();
    } catch (err) {
      console.error('Asset field import init failed:', err);
    }
  }

  for (const mod of App.manifests) {
    if (!mod || typeof mod !== 'object') continue;
    if (typeof mod.init === 'function') {
      try {
        mod.init();
      } catch (err) {
        console.error(`Module initialization failed:`, err);
      }
    }
  }

  if (App.pageHeadingNav?.bindBackLinks) App.pageHeadingNav.bindBackLinks();

  const initialPage = App.getInitialPage();
  App.setActivePage(initialPage, { persist: false });
  
  // Trigger on-activation callbacks for the initial page
  for (const mod of App.manifests) {
    if (!mod || typeof mod !== 'object') continue;
    const pageId = String(mod?.manifest?.pageId || '');
    const pagePrefixes = Array.isArray(mod?.manifest?.pagePrefixes)
      ? mod.manifest.pagePrefixes.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const matchesPrefix = pagePrefixes.some((prefix) => initialPage.startsWith(prefix));
    if (mod.manifest && (pageId === initialPage || matchesPrefix) &&
        typeof mod.onPageActivated === 'function') {
      try {
        mod.onPageActivated(initialPage);
      } catch (err) {
        console.error(`Page activation failed:`, err);
      }
    }
  }

  try {
    App.youtube.renderYoutubeAcquireResult();
  } catch (err) {
    console.error(`Youtube render failed:`, err);
  }
  App.refresh().catch((err) => App.notify(err.message, true));
};

if (App.auth && typeof App.auth.init === 'function') {
  App.auth.init(App.bootMainApp);
} else {
  App.bootMainApp();
}
