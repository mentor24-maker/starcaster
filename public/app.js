
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
  App.engageSocial,
  App.develop,
  App.activityLog,
  App.envConfig,        // #7 — Env Configuration
];

// ---------------------------------------------------------------------------
// Global refresh — calls refresh() on any module that exposes it,
// plus fetches shared state (contacts, segments, campaigns).
// ---------------------------------------------------------------------------

App.refresh = async function refresh() {
  const { state, api, notify } = App;

  const [contactsRes, segmentsRes, campaignsRes] = await Promise.allSettled([
    api('/api/contacts'),
    api('/api/segments'),
    api('/api/campaigns')
  ]);

  if (contactsRes.status === 'fulfilled') {
    state.contacts = contactsRes.value.contacts || [];
  } else {
    state.contacts = [];
    notify(`Contacts load failed: ${contactsRes.reason?.message || 'unknown error'}`, true);
  }

  if (segmentsRes.status === 'fulfilled') {
    state.segments = segmentsRes.value.segments || [];
  } else {
    state.segments = [];
    notify(`Segments load failed: ${segmentsRes.reason?.message || 'unknown error'}`, true);
  }

  if (campaignsRes.status === 'fulfilled') {
    state.campaigns = campaignsRes.value.campaigns || [];
  } else {
    state.campaigns = [];
    notify(`Campaigns load failed: ${campaignsRes.reason?.message || 'unknown error'}`, true);
  }

  // Render modules that depend on shared state
  App.contacts.renderContacts();
  App.segments.renderSegments();
  App.campaigns.renderCampaigns();

  // Call refresh() on any registered module that exposes it
  for (const mod of App.manifests) {
    if (typeof mod.refresh === 'function') {
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

    // Trigger on-activation callbacks for modules that want them
    for (const mod of App.manifests) {
      if (mod.manifest && mod.manifest.pageId === targetPage &&
          typeof mod.onPageActivated === 'function') {
        mod.onPageActivated();
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Boot — init all registered modules, then start
// ---------------------------------------------------------------------------

for (const mod of App.manifests) {
  if (typeof mod.init === 'function') {
    mod.init();
  }
}

App.setActivePage(App.getInitialPage(), { persist: false });
App.youtube.renderYoutubeAcquireResult();
App.refresh().catch((err) => App.notify(err.message, true));
