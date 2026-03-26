window.App = window.App || {};

App.contactPersonas = (function () {
  const { state, api, notify } = App;

  const tableState = {
    sort: {
      key: 'persona',
      dir: 'asc',
    },
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function safeText(value) {
    return String(value || '').trim();
  }

  function sortedPersonas() {
    const items = Array.isArray(state.contactPersonas) ? [...state.contactPersonas] : [];
    const { key, dir } = tableState.sort;
    items.sort((a, b) => {
      const aValue = safeText(a?.[key]).toLowerCase();
      const bValue = safeText(b?.[key]).toLowerCase();
      if (aValue === bValue) return 0;
      const result = aValue < bValue ? -1 : 1;
      return dir === 'asc' ? result : -result;
    });
    return items;
  }

  function syncSortLabel() {
    const btn = byId('contactPersonasSortPersona');
    if (!btn) return;
    const marker = tableState.sort.key === 'persona'
      ? (tableState.sort.dir === 'asc' ? ' ▲' : ' ▼')
      : '';
    btn.textContent = `Persona${marker}`;
  }

  function openEditPage(item) {
    if (!item || !item.id) return notify('Persona id is missing', true);
    const form = byId('contactPersonaEditForm');
    if (form) form.reset();
    const idInput = byId('contactPersonaEditId');
    const personaInput = byId('contactPersonaEditName');
    const descriptionInput = byId('contactPersonaEditDescription');
    if (idInput) idInput.value = String(item.id);
    if (personaInput) personaInput.value = safeText(item.persona);
    if (descriptionInput) descriptionInput.value = safeText(item.description);
    App.setActivePage('editContactPersonaPage');
  }

  async function deletePersona(item) {
    if (!item || !item.id) return notify('Persona id is missing', true);
    if (!window.confirm(`Delete persona "${safeText(item.persona)}"?`)) return;
    try {
      await api(`/api/contact-personas/${item.id}`, { method: 'DELETE' });
      notify('Persona deleted');
      await refresh();
    } catch (err) {
      notify(err.message, true);
    }
  }

  function renderMap() {
    const container = byId('contactPersonasMap');
    if (!container) return;
    container.innerHTML = '';

    const items = sortedPersonas();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'messaging-content-node asset-category-node';
      empty.innerHTML = '<span class="messaging-content-node-kicker">Contacts</span><span class="messaging-content-node-title">No Personas Yet</span>';
      container.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'messaging-content-node asset-category-node';
      button.innerHTML = `<span class="messaging-content-node-kicker">Persona</span><span class="messaging-content-node-title">${safeText(item.persona)}</span>`;
      if (safeText(item.description)) button.title = safeText(item.description);
      button.addEventListener('click', () => openEditPage(item));
      container.appendChild(button);
    });
  }

  function renderTable() {
    const tbody = byId('contactPersonasTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    syncSortLabel();

    sortedPersonas().forEach((item) => {
      const tr = document.createElement('tr');

      const personaTd = document.createElement('td');
      personaTd.textContent = safeText(item.persona) || '-';

      const descriptionTd = document.createElement('td');
      descriptionTd.textContent = safeText(item.description) || '-';

      const actionsTd = document.createElement('td');
      const editBtn = App.makeIconButton('edit', 'Edit Persona', () => openEditPage(item));
      const deleteBtn = App.makeIconButton('delete', 'Delete Persona', () => deletePersona(item), { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);

      tr.appendChild(personaTd);
      tr.appendChild(descriptionTd);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });

    if (!tbody.children.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.textContent = 'No personas yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }

  async function refresh() {
    const result = await api('/api/contact-personas');
    state.contactPersonas = result.personas || [];
    renderMap();
    renderTable();
  }

  function init() {
    const sortBtn = byId('contactPersonasSortPersona');
    if (sortBtn) {
      sortBtn.addEventListener('click', () => {
        if (tableState.sort.key === 'persona') {
          tableState.sort.dir = tableState.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          tableState.sort.key = 'persona';
          tableState.sort.dir = 'asc';
        }
        renderTable();
      });
    }

    const openCreateBtn = byId('openCreateContactPersonaPageBtn');
    if (openCreateBtn) {
      openCreateBtn.addEventListener('click', () => {
        const form = byId('contactPersonaForm');
        if (form) form.reset();
        App.setActivePage('createContactPersonaPage');
      });
    }

    const backToManageBtn = byId('backToContactPersonasBtn');
    if (backToManageBtn) {
      backToManageBtn.addEventListener('click', () => App.setActivePage('manageContactPersonasPage'));
    }

    const backFromEditBtn = byId('backFromEditContactPersonaBtn');
    if (backFromEditBtn) {
      backFromEditBtn.addEventListener('click', () => App.setActivePage('manageContactPersonasPage'));
    }

    const createForm = byId('contactPersonaForm');
    if (createForm) {
      createForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(createForm);
        const payload = {
          persona: safeText(formData.get('persona')),
          description: safeText(formData.get('description')),
        };
        try {
          await api('/api/contact-personas', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          notify('Persona created');
          createForm.reset();
          await refresh();
          App.setActivePage('manageContactPersonasPage');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }

    const editForm = byId('contactPersonaEditForm');
    if (editForm) {
      editForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(editForm);
        const id = Number(formData.get('id') || 0) || 0;
        if (!id) return notify('Persona id is required', true);
        const payload = {
          persona: safeText(formData.get('persona')),
          description: safeText(formData.get('description')),
        };
        try {
          await api(`/api/contact-personas/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
          notify('Persona updated');
          editForm.reset();
          await refresh();
          App.setActivePage('manageContactPersonasPage');
        } catch (err) {
          notify(err.message, true);
        }
      });
    }
  }

  return {
    manifest: { id: 'contactPersonas', label: 'Contact Personas', pageId: 'contactsPersonasPage' },
    init,
    refresh,
    onPageActivated: refresh,
  };
})();
