/**
 * public/js/activityLog.js
 * Activity Log page — refactored to use App.components.DataGrid.
 *
 * This is the reference implementation for the DataGrid component.
 * The render pattern here can be copied to any other page:
 *   1. Declare columns with optional render functions
 *   2. Create the grid once in init/onPageActivated
 *   3. Call grid.update({ rows }) when data changes
 */

window.App = window.App || {};
App.activityLog = (function () {
  const { api, notify, components } = App;
  const { DataGrid, Toast } = components;

  // ── State ────────────────────────────────────────────────────────────────

  let allEntries = [];
  let filterAction = '';
  let loading = false;
  let grid = null;   // DataGrid instance

  // ── DOM helpers ──────────────────────────────────────────────────────────

  function el(id) { return document.getElementById(id); }

  // ── Badge helper ─────────────────────────────────────────────────────────

  const BADGE_CLASSES = {
    contact:   'badge-blue',
    segment:   'badge-purple',
    campaign:  'badge-green',
    promolead: 'badge-orange',
    settings:  'badge-grey',
    openclaw:  'badge-red',
    acquire:   'badge-teal',
    config:    'badge-grey',
  };

  function badgeClass(action) {
    const prefix = String(action || '').split('.')[0].toLowerCase();
    return BADGE_CLASSES[prefix] || 'badge-grey';
  }

  // ── Column definitions ───────────────────────────────────────────────────

  const COLUMNS = [
    {
      key:   'created_at',
      label: 'Time',
      render: (val) => {
        if (!val) return '—';
        return new Date(val).toLocaleString(undefined, {
          dateStyle: 'short', timeStyle: 'short'
        });
      }
    },
    {
      key:   'action',
      label: 'Action',
      filterOptions: [
        { value: '', label: 'All actions' },
        { value: 'contact', label: 'Contacts' },
        { value: 'segment', label: 'Segments' },
        { value: 'campaign', label: 'Campaigns' },
        { value: 'promolead', label: 'Promo Leads' },
        { value: 'settings', label: 'Settings' },
        { value: 'openclaw', label: 'OpenClaw' },
        { value: 'acquire', label: 'Acquire' },
      ],
      render: (val) => {
        const span = document.createElement('span');
        span.className = 'badge ' + badgeClass(val);
        span.textContent = val || '—';
        return span;
      }
    },
    {
      key:   'summary',
      label: 'Summary',
    },
    {
      key:   'entity_type',
      label: 'Entity',
      render: (val, row) => {
        if (!val && !row.entity_id) return '';
        const parts = [val || ''];
        if (row.entity_id) parts.push(`#${row.entity_id}`);
        return parts.join(' ');
      }
    },
  ];

  // ── Grid setup ───────────────────────────────────────────────────────────

  function setupGrid() {
    const mountPoint = el('activityLogGrid');
    if (!mountPoint || grid) return;

    grid = DataGrid({
      columns:      COLUMNS,
      rows:         [],
      emptyMessage: 'No activity recorded yet. Actions you take in the platform will appear here.',
      filterable:   true,
      sortable:     true,
    });

    mountPoint.appendChild(grid.el);
  }

  function updateGrid() {
    if (!grid) return;
    grid.update({ rows: allEntries });

    const countEl = el('activityLogCount');
    if (countEl) countEl.textContent = `${allEntries.length} entr${allEntries.length !== 1 ? 'ies' : 'y'}`;
  }

  // ── Load data ────────────────────────────────────────────────────────────

  async function loadLog() {
    if (loading) return;
    loading = true;

    const spinner = el('activityLogSpinner');
    if (spinner) spinner.style.display = 'inline-block';

    try {
      const result = await api('/api/activity-log?limit=200');
      // #9 envelope: data is the array, entries is the legacy key
      allEntries = Array.isArray(result.data) ? result.data
                 : Array.isArray(result.entries) ? result.entries
                 : [];
      updateGrid();
    } catch (err) {
      Toast.error(`Activity log unavailable: ${err.message}`);
      allEntries = [];
      updateGrid();
    } finally {
      loading = false;
      if (spinner) spinner.style.display = 'none';
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  function init() {
    // Refresh button
    const refreshBtn = el('activityLogRefresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
         loadLog();
         if (App.observe && typeof App.observe.loadPageViews === 'function') {
            App.observe.loadPageViews();
         }
      });
    }
  }

  // Called by app.js on every global refresh
  async function refresh() {
    const page = el('activityPage');
    if (page && page.classList.contains('active')) {
      await loadLog();
    }
  }

  function onPageActivated() {
    setupGrid();   // mount grid the first time the page is shown
    loadLog();
  }

  return {
    manifest: { id: 'activityLog', label: 'Activity', pageId: 'activityPage' },
    init,
    refresh,
    onPageActivated,
    loadLog,
  };
}());
