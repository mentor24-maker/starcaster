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
  App.settings,
  App.acquire,
  App.youtube,
  App.develop
];

// ---------------------------------------------------------------------------
// Global refresh — calls refresh() on any module that exposes it,
// plus fetches shared state (contacts, segments, campaigns).
// ---------------------------------------------------------------------------

App.refresh = async function refresh() {
  const { state, api, notify } = App;

  const [contacts, segments, campaigns] = await Promise.all([
    api('/api/contacts'),
    api('/api/segments'),
    api('/api/campaigns')
  ]);

  state.contacts  = contacts.contacts   || [];
  state.segments  = segments.segments   || [];
  state.campaigns = campaigns.campaigns || [];

  // Render modules that depend on shared state
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
// Navigation
// ---------------------------------------------------------------------------

if (App.els.topNav) {
  App.els.topNav.addEventListener('click', (event) => {
    const link = event.target.closest('.menu-link[data-page]');
    if (!link) return;
    event.preventDefault();
    App.setActivePage(link.dataset.page);
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

App.setActivePage('contactsPage');
App.youtube.renderYoutubeAcquireResult();
App.refresh().catch((err) => App.notify(err.message, true));
