/**
 * public/js/admin.js
 * Admin module — platform user management (list, create, edit, delete).
 */

window.App = window.App || {};
App.admin = (function () {
  const { api, notify, setActivePage } = App;

  let users = [];

  function el(id) { return document.getElementById(id); }

  // ── Navigation ───────────────────────────────────────────────────────────────

  function openPage() {
    setActivePage('adminPage');
    loadUsers();
  }

  function openAddUserPage() {
    resetAddForm();
    setActivePage('adminAddUserPage');
  }

  function openEditUserPage(userId) {
    const user = users.find((u) => u.id === userId);
    if (!user) { notify('User not found', true); return; }
    el('adminEditUserId').value = user.id;
    el('adminEditName').value = user.name || '';
    el('adminEditEmail').value = user.email || '';
    el('adminEditRole').value = user.role || 'user';
    const msgEl = el('adminEditMsg');
    if (msgEl) { msgEl.textContent = ''; msgEl.classList.add('hidden'); }
    setActivePage('adminEditUserPage');
  }

  // ── Data ─────────────────────────────────────────────────────────────────────

  async function loadUsers() {
    try {
      const res = await api('/api/admin/users');
      users = App.normalizeApiArray(res, 'users');
      renderTable();
    } catch (err) {
      notify(`Admin users load failed: ${err.message}`, true);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  function renderTable() {
    const tbody = el('adminUsersTableBody');
    if (!tbody) return;
    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="meta">No users found.</td></tr>';
      return;
    }
    tbody.innerHTML = users.map((u) => {
      const created = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—';
      return `
        <tr>
          <td>${esc(u.name || '—')}</td>
          <td>${esc(u.email || '—')}</td>
          <td><span class="badge">${esc(u.role || 'user')}</span></td>
          <td class="meta">${esc(created)}</td>
          <td style="white-space:nowrap;">
            <button type="button" class="btn" style="padding:0.2rem 0.6rem; font-size:0.8rem; margin-right:0.25rem;"
              onclick="App.admin.openEditUserPage('${esc(u.id)}')">Edit</button>
            <button type="button" class="btn" style="padding:0.2rem 0.6rem; font-size:0.8rem;"
              onclick="App.admin.deleteUser('${esc(u.id)}', '${esc(u.email)}')">Delete</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Create ───────────────────────────────────────────────────────────────────

  function resetAddForm() {
    const form = el('adminAddUserForm');
    if (form) form.reset();
    const msgEl = el('adminAddMsg');
    if (msgEl) { msgEl.textContent = ''; msgEl.classList.add('hidden'); }
  }

  function bindAddForm() {
    const form = el('adminAddUserForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msgEl = el('adminAddMsg');
      const name = String(el('adminAddName')?.value || '').trim();
      const email = String(el('adminAddEmail')?.value || '').trim();
      const password = String(el('adminAddPassword')?.value || '').trim();
      const role = String(el('adminAddRole')?.value || 'user').trim();
      if (!name || !email || !password) {
        if (msgEl) { msgEl.textContent = 'Name, email, and password are required.'; msgEl.classList.remove('hidden'); }
        return;
      }
      try {
        const res = await api('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password, role }),
        });
        const user = res.data || res.user || res;
        users.unshift(user);
        notify(`User "${email}" created.`);
        openPage();
      } catch (err) {
        if (msgEl) { msgEl.textContent = err.message || 'Failed to create user.'; msgEl.classList.remove('hidden'); }
      }
    });
  }

  // ── Edit ─────────────────────────────────────────────────────────────────────

  function bindEditForm() {
    const form = el('adminEditUserForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msgEl = el('adminEditMsg');
      const id = String(el('adminEditUserId')?.value || '').trim();
      const name = String(el('adminEditName')?.value || '').trim();
      const role = String(el('adminEditRole')?.value || 'user').trim();
      if (!id || !name) {
        if (msgEl) { msgEl.textContent = 'Name is required.'; msgEl.classList.remove('hidden'); }
        return;
      }
      try {
        const res = await api(`/api/admin/users/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, role }),
        });
        const updated = res.data || res.user || res;
        const index = users.findIndex((u) => u.id === id);
        if (index !== -1) users[index] = updated;
        notify(`User updated.`);
        openPage();
      } catch (err) {
        if (msgEl) { msgEl.textContent = err.message || 'Failed to update user.'; msgEl.classList.remove('hidden'); }
      }
    });
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  async function deleteUser(userId, email) {
    if (!confirm(`Delete user "${email}"? This cannot be undone.`)) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      users = users.filter((u) => u.id !== userId);
      renderTable();
      notify(`User "${email}" deleted.`);
    } catch (err) {
      notify(err.message || 'Failed to delete user.', true);
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  function init() {
    bindAddForm();
    bindEditForm();
  }

  async function refresh() {
    const active = String(App.state?.activePage || '');
    if (active === 'adminPage') await loadUsers();
  }

  return {
    manifest: {
      id: 'admin',
      label: 'Admin',
      pageId: 'adminPage',
      pagePrefixes: ['admin'],
    },
    init,
    refresh,
    openPage,
    openAddUserPage,
    openEditUserPage,
    deleteUser,
  };
})();
