/**
 * public/js/projectAdmin.js
 * Project Admin — a standalone CMS for team members with project-specific
 * credentials (separate from starcaster.pro platform accounts).
 *
 * Auth lifecycle is independent from App.auth:
 *  - Calls /api/admin/auth/me on page activation (not on every boot).
 *  - Uses fetch() directly to avoid App.api() injecting platform headers.
 *  - Admin session cookie (app_admin_session) is sent automatically.
 */

window.App = window.App || {};

App.projectAdmin = (function () {
  const ADMIN_TOKEN_KEY = 'app.adminSessionToken';

  let _adminUser = null;
  let _projectId = null;
  let _builderMounted = false;

  // ---------------------------------------------------------------------------
  // Token helpers (localStorage — cookie is the auth-of-record on the server)
  // ---------------------------------------------------------------------------
  function getAdminToken() {
    try { return String(window.localStorage.getItem(ADMIN_TOKEN_KEY) || '').trim(); } catch { return ''; }
  }

  function setAdminToken(token) {
    try { window.localStorage.setItem(ADMIN_TOKEN_KEY, String(token || '')); } catch {}
  }

  function clearAdminToken() {
    try { window.localStorage.removeItem(ADMIN_TOKEN_KEY); } catch {}
  }

  // ---------------------------------------------------------------------------
  // URL hash helpers
  // ---------------------------------------------------------------------------
  function readProjectIdFromHash() {
    try {
      const hash = String(window.location.hash || '');
      const m = hash.match(/[#&]project=([^&]+)/);
      return m ? decodeURIComponent(m[1]) : '';
    } catch { return ''; }
  }

  // ---------------------------------------------------------------------------
  // API helpers — use fetch() directly, not App.api()
  // ---------------------------------------------------------------------------
  async function adminFetch(pathname, options = {}) {
    const token = getAdminToken();
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(pathname, { credentials: 'include', ...options, headers });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body?.error?.message || body?.error || 'Request failed'), { status: res.status });
    return body;
  }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------
  function el(id) { return document.getElementById(id); }

  function showLoginView() {
    el('adminLoginView')?.classList.remove('hidden');
    el('adminAppView')?.classList.add('hidden');
    const msgEl = el('adminLoginMessage');
    if (msgEl) msgEl.textContent = '';
  }

  function showAppView(adminUser, projectId) {
    _adminUser = adminUser;
    _projectId = projectId;

    const nameEl = el('adminWelcomeName');
    if (nameEl) nameEl.textContent = adminUser.email || '';

    const projectEl = el('adminProjectName');
    if (projectEl) projectEl.textContent = projectId || '';

    el('adminLoginView')?.classList.add('hidden');
    el('adminAppView')?.classList.remove('hidden');

    // Set the platform's project-id state so App.api() sends the right header
    // for any internal builder API calls.
    if (projectId) {
      try { App.state.currentProjectId = projectId; } catch {}
    }

    mountBuilder();
  }

  // ---------------------------------------------------------------------------
  // Builder mounting
  // ---------------------------------------------------------------------------
  function mountBuilder() {
    if (_builderMounted) return;
    const host = el('adminBuilderReactRoot');
    if (!host) return;
    if (typeof window.BuilderReact?.mount !== 'function') {
      console.warn('[ProjectAdmin] BuilderReact not available yet');
      return;
    }
    window.BuilderReact.mount(host, {
      surface: 'hub',
      editorMode: 'template',
      onClose: () => {},
    });
    _builderMounted = true;
  }

  // ---------------------------------------------------------------------------
  // Auth checks
  // ---------------------------------------------------------------------------
  async function checkAdminSession() {
    try {
      const body = await adminFetch('/api/admin/auth/me', { method: 'GET' });
      return body?.data || null;
    } catch { return null; }
  }

  async function login(projectId, email, password) {
    const body = await adminFetch('/api/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ projectId, email, password }),
    });
    const token = String(body?.data?.sessionToken || body?.sessionToken || '').trim();
    if (token) setAdminToken(token);
    return body?.data || body;
  }

  async function logout() {
    try {
      await adminFetch('/api/admin/auth/logout', { method: 'POST' });
    } catch {}
    clearAdminToken();
    _adminUser = null;
    _projectId = null;
    _builderMounted = false;
    if (typeof window.BuilderReact?.unmount === 'function') {
      window.BuilderReact.unmount();
    }
  }

  // ---------------------------------------------------------------------------
  // Event bindings
  // ---------------------------------------------------------------------------
  function bindLoginForm() {
    const form = el('adminLoginForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msgEl = el('adminLoginMessage');
      const data = new FormData(form);
      const projectId = String(data.get('projectId') || '').trim();
      const email = String(data.get('email') || '').trim();
      const password = String(data.get('password') || '');
      if (msgEl) { msgEl.textContent = 'Signing in...'; msgEl.classList.remove('error'); }
      try {
        const result = await login(projectId, email, password);
        const adminUser = result?.adminUser || result;
        const pid = String(adminUser?.projectId || projectId).trim();
        showAppView(adminUser, pid);
        if (msgEl) msgEl.textContent = '';
      } catch (err) {
        if (msgEl) { msgEl.textContent = err.message || 'Sign in failed'; msgEl.classList.add('error'); }
      }
    });
  }

  function bindLogoutButton() {
    const btn = el('adminLogoutBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      await logout();
      showLoginView();
    });
  }

  // ---------------------------------------------------------------------------
  // Module lifecycle
  // ---------------------------------------------------------------------------
  function init() {
    bindLoginForm();
    bindLogoutButton();
  }

  async function onPageActivated(pageId) {
    if (pageId !== 'projectAdminPage') return;

    // Populate the hidden projectId field from the URL hash if present
    const hashProjectId = readProjectIdFromHash();
    const projectInput = el('adminProjectIdInput');
    if (projectInput && hashProjectId) projectInput.value = hashProjectId;

    // If already mounted with a valid session, stay put
    if (_adminUser && _builderMounted) return;

    // Check for an existing admin session
    const session = await checkAdminSession();
    if (session?.adminUser) {
      const pid = String(session.projectId || hashProjectId || '').trim();
      showAppView(session.adminUser, pid);
    } else {
      clearAdminToken();
      showLoginView();
    }
  }

  return {
    manifest: {
      id: 'projectAdmin',
      label: 'Project Admin',
      pageId: 'projectAdminPage',
    },
    init,
    onPageActivated,
  };
})();
