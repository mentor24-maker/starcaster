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

  function formatTags(tags) {
    return Array.isArray(tags) ? tags.map((item) => safeText(item)).filter(Boolean).join(', ') : '';
  }

  function parentPersonaName(parentId, excludeId = null) {
    const id = Number(parentId || 0) || 0;
    if (!id) return '';
    const match = (Array.isArray(state.contactPersonas) ? state.contactPersonas : []).find((item) => {
      const itemId = Number(item?.id || 0) || 0;
      if (excludeId && itemId === Number(excludeId || 0)) return false;
      return itemId === id;
    });
    return safeText(match?.persona);
  }

  function populateParentSelect(selectId, selectedId = '', excludeId = null) {
    const select = byId(selectId);
    if (!select) return;
    const current = String(selectedId || '');
    select.innerHTML = '<option value="">No Parent</option>';
    sortedPersonas().forEach((item) => {
      const itemId = Number(item?.id || 0) || 0;
      if (excludeId && itemId === Number(excludeId || 0)) return;
      const option = document.createElement('option');
      option.value = String(itemId);
      option.textContent = safeText(item.persona) || `Persona ${itemId}`;
      if (String(itemId) === current) option.selected = true;
      select.appendChild(option);
    });
  }

  function setCreatePanelVisible(visible) {
    const panel = byId('contactPersonaCreatePanel');
    if (!panel) return;
    panel.classList.toggle('hidden', !visible);
  }

  function openCreatePage(selectedParentId = '') {
    const form = byId('contactPersonaForm');
    if (form) form.reset();
    populateParentSelect('contactPersonaParent', selectedParentId);
    setCreatePanelVisible(true);
    App.setActivePage('contactsPersonasPage');
    const panel = byId('contactPersonaCreatePanel');
    if (panel && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function goBackToPersonas() {
    setCreatePanelVisible(false);
    App.setActivePage('contactsPersonasPage');
    return false;
  }

  function openEditPage(item) {
    if (!item || !item.id) return notify('Persona id is missing', true);
    const form = byId('contactPersonaEditForm');
    if (form) form.reset();
    const idInput = byId('contactPersonaEditId');
    const personaInput = byId('contactPersonaEditName');
    const tagsInput = byId('contactPersonaEditTags');
    const parentSelect = byId('contactPersonaEditParent');
    const descriptionInput = byId('contactPersonaEditDescription');
    if (idInput) idInput.value = String(item.id);
    if (personaInput) personaInput.value = safeText(item.persona);
    if (tagsInput) tagsInput.value = formatTags(item.tags);
    populateParentSelect('contactPersonaEditParent', item.parentPersonaId, item.id);
    if (parentSelect) parentSelect.value = item.parentPersonaId ? String(item.parentPersonaId) : '';
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

  async function clonePersona(item) {
    if (!item) return notify('Persona is missing', true);
    const baseName = safeText(item.persona);
    const payload = {
      persona: baseName ? `${baseName} (Copy)` : 'Persona Copy',
      parentPersonaId: Number(item.parentPersonaId || 0) || null,
      tags: Array.isArray(item.tags) ? item.tags : [],
      description: safeText(item.description),
    };
    try {
      await api('/api/contact-personas', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      notify('Persona cloned');
      await refresh();
      App.setActivePage('contactsPersonasPage');
    } catch (err) {
      notify(err.message, true);
    }
  }

  function renderMap() {
    // Personas now use the editor table as the primary management surface.
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

      const parentTd = document.createElement('td');
      parentTd.textContent = parentPersonaName(item.parentPersonaId, item.id) || '-';

      const tagsTd = document.createElement('td');
      tagsTd.textContent = formatTags(item.tags) || '-';

      const descriptionTd = document.createElement('td');
      descriptionTd.textContent = safeText(item.description) || '-';

      const actionsTd = document.createElement('td');
      actionsTd.className = 'contact-personas-actions-cell';
      const editBtn = App.makeIconButton('edit', 'Edit Persona', () => openEditPage(item));
      const cloneBtn = App.makeIconButton('clone', 'Clone Persona', () => clonePersona(item), { marginLeft: '8px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete Persona', () => deletePersona(item), { danger: true, marginLeft: '8px' });
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(cloneBtn);
      actionsTd.appendChild(deleteBtn);

      tr.appendChild(personaTd);
      tr.appendChild(parentTd);
      tr.appendChild(tagsTd);
      tr.appendChild(descriptionTd);
      tr.appendChild(actionsTd);
      tbody.appendChild(tr);
    });

    if (!tbody.children.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'No personas yet.';
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }

  async function refresh() {
    try {
      const result = await api('/api/contact-personas');
      const personas = Array.isArray(result?.personas)
        ? result.personas
        : Array.isArray(result?.data)
          ? result.data
          : Array.isArray(result)
            ? result
            : [];
      state.contactPersonas = personas;
      populateParentSelect('contactPersonaParent');
      populateParentSelect('contactPersonaEditParent');
      renderMap();
      renderTable();
    } catch (err) {
      state.contactPersonas = [];
      renderTable();
      notify(err.message || 'Unable to load personas', true);
    }
  }

  async function submitCreateForm(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const createForm = byId('contactPersonaForm');
    if (!createForm) return false;
    const formData = new FormData(createForm);
    const payload = {
      persona: safeText(formData.get('persona')),
      description: safeText(formData.get('description')),
    };
    const tags = safeText(formData.get('tags'));
    const parentPersonaId = Number(formData.get('parent_persona_id') || 0) || null;
    if (tags) payload.tags = tags;
    if (parentPersonaId) payload.parentPersonaId = parentPersonaId;
    try {
      const result = await api('/api/contact-personas', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const createdId = Number(result?.persona?.id || 0) || null;
      notify('Persona created');
      createForm.reset();
      await refresh();
      populateParentSelect('contactPersonaParent');
      setCreatePanelVisible(true);
      App.setActivePage('contactsPersonasPage');
    } catch (err) {
      notify(err.message, true);
    }
    return false;
  }

  async function submitEditForm(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const editForm = byId('contactPersonaEditForm');
    if (!editForm) return false;
    const formData = new FormData(editForm);
    const id = Number(formData.get('id') || 0) || 0;
    if (!id) {
      notify('Persona id is required', true);
      return false;
    }
    const payload = {
      persona: safeText(formData.get('persona')),
      description: safeText(formData.get('description')),
    };
    const tags = safeText(formData.get('tags'));
    const parentPersonaId = Number(formData.get('parent_persona_id') || 0) || null;
    if (tags) payload.tags = tags;
    if (parentPersonaId) payload.parentPersonaId = parentPersonaId;
    try {
      await api(`/api/contact-personas/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      notify('Persona updated');
      editForm.reset();
      await refresh();
      App.setActivePage('contactsPersonasPage');
    } catch (err) {
      notify(err.message, true);
    }
    return false;
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
    const openCreateFromLandingBtn = byId('openCreateContactPersonaFromLandingBtn');
    if (openCreateBtn) {
      openCreateBtn.addEventListener('click', () => openCreatePage());
    }

    if (openCreateFromLandingBtn) {
      openCreateFromLandingBtn.addEventListener('click', () => openCreatePage());
    }

  }

  return {
    manifest: { id: 'contactPersonas', label: 'Contact Personas', pageId: 'contactsPersonasPage' },
    clonePersona,
    deletePersona,
    goBackToPersonas,
    openCreatePage,
    openEditPage,
    init,
    refresh,
    submitCreateForm,
    submitEditForm,
    onPageActivated: refresh,
  };
})();
