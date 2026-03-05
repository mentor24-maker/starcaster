/**
 * public/js/promoLeads.js
 * Promo leads grid, segment lead grid, custom field management, and lead CRUD.
 */

window.App = window.App || {};
App.promoLeads = (function () {
  const { state, els, api, notify, normalizeKey, isStandardLeadColumn,
          titleFromKey, truncateDisplay } = App;

  function isLeadContact(contact) {
    const t = String(contact?.contactType || contact?.contact_type || 'lead').toLowerCase();
    return t === 'lead';
  }

  function getLeadContacts() {
    return (Array.isArray(state.contacts) ? state.contacts : []).filter(isLeadContact);
  }

  function replaceLeadsInState(leads) {
    const nonLeads = (Array.isArray(state.contacts) ? state.contacts : []).filter((c) => !isLeadContact(c));
    state.contacts = [...(Array.isArray(leads) ? leads : []), ...nonLeads];
    // Compatibility mirror during migration
    state.promoLeads = Array.isArray(leads) ? [...leads] : [];
  }

  // ---------------------------------------------------------------------------
  // Column helpers
  // ---------------------------------------------------------------------------

  function buildLeadColumns() {
    const customConfigured = state.promoFields.map((f) => f.key).filter(Boolean);
    const customFromRows = new Set();
    getLeadContacts().forEach((row) => {
      const custom = (
        (row.customFields && typeof row.customFields === 'object' && row.customFields) ||
        (row.custom_fields && typeof row.custom_fields === 'object' && row.custom_fields) ||
        {}
      );
      Object.keys(custom).forEach((k) => customFromRows.add(k));
    });
    const custom = Array.from(new Set([...customConfigured, ...customFromRows])).sort();
    state.leadColumns = [...App.STANDARD_LEAD_COLUMNS, ...custom];
  }

  function leadCellValue(row, key) {
    const custom = (
      (row.customFields && typeof row.customFields === 'object' && row.customFields) ||
      (row.custom_fields && typeof row.custom_fields === 'object' && row.custom_fields) ||
      {}
    );
    const camel = String(key || '').replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const value = (
      row[key] !== undefined ? row[key]
      : row[camel] !== undefined ? row[camel]
      : custom[key]
    );
    if (key === 'tags') return Array.isArray(value) ? value.join(', ') : (value || '');
    if (Array.isArray(value)) return value.join(', ');
    return value == null ? '' : String(value);
  }

  // ---------------------------------------------------------------------------
  // Filtered/sorted data
  // ---------------------------------------------------------------------------

  function filteredSortedLeads() {
    let rows = [...getLeadContacts()];
    const filters = state.leadFilters;
    rows = rows.filter((row) =>
      state.leadColumns.every((col) => {
        const needle = String(filters[col] || '').trim().toLowerCase();
        return !needle || String(leadCellValue(row, col)).toLowerCase().includes(needle);
      })
    );
    const { key, dir } = state.leadSort;
    rows.sort((a, b) => {
      const av = String(leadCellValue(a, key)).toLowerCase();
      const bv = String(leadCellValue(b, key)).toLowerCase();
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1  : -1;
      return 0;
    });
    return rows;
  }

  function filteredSortedSegmentLeads() {
    const visibleCols = state.leadColumns.filter((col) => !App.SEGMENT_EXCLUDED_COLUMNS.has(col));
    let rows = [...getLeadContacts()];
    const filters = state.segmentLeadFilters || {};

    rows = rows.filter((row) =>
      visibleCols.every((col) => {
        const needle = String(filters[col] || '').trim().toLowerCase();
        return !needle || String(leadCellValue(row, col)).toLowerCase().includes(needle);
      })
    );

    const activePresence = App.SEGMENT_SOCIAL_FIELDS
      .map((f) => f.key)
      .filter((key) => state.segmentSocialPresence[key]);

    if (activePresence.length) {
      const mode = state.segmentSocialMode === 'all' ? 'all' : 'any';
      rows = rows.filter((row) => {
        const hasValue = (key) => String(leadCellValue(row, key) || '').trim().length > 0;
        return mode === 'all' ? activePresence.every(hasValue) : activePresence.some(hasValue);
      });
    }

    const socialNeedle   = String(state.segmentSocialSearchQuery    || '').trim().toLowerCase();
    const socialPlatform = String(state.segmentSocialSearchPlatform || '').trim().toLowerCase();
    if (socialNeedle && socialPlatform) {
      rows = rows.filter((row) =>
        String(leadCellValue(row, socialPlatform) || '').toLowerCase().includes(socialNeedle)
      );
    }

    const { key, dir } = state.segmentLeadSort;
    rows.sort((a, b) => {
      const av = String(leadCellValue(a, key)).toLowerCase();
      const bv = String(leadCellValue(b, key)).toLowerCase();
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1  : -1;
      return 0;
    });
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Render functions
  // ---------------------------------------------------------------------------

  function renderLeadFilters() {
    if (!els.promoLeadsFilters) return;
    els.promoLeadsFilters.innerHTML = '';
    state.leadColumns.forEach((key) => {
      const input = document.createElement('input');
      input.placeholder = key;
      input.value = state.leadFilters[key] || '';
      input.addEventListener('input', () => { state.leadFilters[key] = input.value; renderLeadGrid(); });
      els.promoLeadsFilters.appendChild(input);
    });
  }

  function renderSegmentLeadFilters() {
    if (!els.segmentsLeadFilters) return;
    els.segmentsLeadFilters.innerHTML = '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Filter Contacts';
    btn.style.width = 'auto';
    btn.style.minWidth = '400px';
    btn.style.maxWidth = '100%';
    btn.style.gridColumn = '1 / -1';
    btn.style.justifySelf = 'center';
    btn.style.display = 'inline-flex';
    btn.style.justifyContent = 'center';
    btn.style.textAlign = 'center';
    btn.addEventListener('click', () => {
      if (typeof App.contacts?.applyExploreFilters === 'function') {
        App.contacts.applyExploreFilters();
      }
    });
    els.segmentsLeadFilters.appendChild(btn);
  }

  function renderSegmentSocialControls() {
    if (els.segmentsSocialChecks) {
      els.segmentsSocialChecks.innerHTML = '';
      App.SEGMENT_SOCIAL_FIELDS.forEach(({ key, label }) => {
        const wrapper = document.createElement('label');
        wrapper.className = 'checkbox-row';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!state.segmentSocialPresence[key];
        input.addEventListener('change', () => { state.segmentSocialPresence[key] = input.checked; renderSegmentLeadGrid(); });
        wrapper.appendChild(input);
        wrapper.appendChild(document.createTextNode(label));
        els.segmentsSocialChecks.appendChild(wrapper);
      });
    }
    if (els.segmentsSocialModeAny) els.segmentsSocialModeAny.checked = state.segmentSocialMode !== 'all';
    if (els.segmentsSocialModeAll) els.segmentsSocialModeAll.checked = state.segmentSocialMode === 'all';
    if (els.segmentsSocialSearchPlatform) {
      if (!els.segmentsSocialSearchPlatform.options.length) {
        App.SEGMENT_SOCIAL_FIELDS.forEach(({ key, label }) => {
          const option = document.createElement('option');
          option.value = key; option.textContent = label;
          els.segmentsSocialSearchPlatform.appendChild(option);
        });
      }
      els.segmentsSocialSearchPlatform.value = state.segmentSocialSearchPlatform || 'youtube';
    }
    if (els.segmentsSocialSearchQuery) els.segmentsSocialSearchQuery.value = state.segmentSocialSearchQuery || '';
  }

  function renderPromoFields() {
    if (!els.promoFieldsTable) return;
    els.promoFieldsTable.innerHTML = '';
    state.promoFields.forEach((field) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${field.key}</td><td>${field.label || '-'}</td><td>${field.type || 'text'}</td>
        <td>${field.required ? 'yes' : 'no'}</td><td>${field.is_active === false ? 'no' : 'yes'}</td>
      `;
      els.promoFieldsTable.appendChild(tr);
    });
  }

  function renderLeadGrid() {
    if (!els.promoLeadsHead || !els.promoLeadsBody) return;
    buildLeadColumns();
    renderLeadFilters();
    els.promoLeadsHead.innerHTML = '';
    const trHead = document.createElement('tr');
    state.leadColumns.forEach((key) => {
      const th  = document.createElement('th');
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'tiny-btn';
      const marker = state.leadSort.key === key ? (state.leadSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
      btn.textContent = `${key}${marker}`;
      btn.addEventListener('click', () => {
        if (state.leadSort.key === key) {
          state.leadSort.dir = state.leadSort.dir === 'asc' ? 'desc' : 'asc';
        } else { state.leadSort.key = key; state.leadSort.dir = 'asc'; }
        renderLeadGrid();
      });
      th.appendChild(btn); trHead.appendChild(th);
    });
    const actionsTh = document.createElement('th');
    actionsTh.textContent = 'actions';
    trHead.appendChild(actionsTh);
    els.promoLeadsHead.appendChild(trHead);

    els.promoLeadsBody.innerHTML = '';
    filteredSortedLeads().forEach((row) => {
      const tr = document.createElement('tr');
      state.leadColumns.forEach((key) => {
        const td = document.createElement('td');
        const input = document.createElement('input');
        input.value = leadCellValue(row, key);
        input.addEventListener('change', async () => {
          try { await updateLeadCell(row.id, key, input.value); notify(`Saved row ${row.id}`); }
          catch (err) { notify(err.message, true); }
        });
        td.appendChild(input); tr.appendChild(td);
      });
      const tdActions = document.createElement('td');
      const delBtn = App.makeIconButton('delete', 'Delete Lead', async () => {
        if (!confirm(`Delete lead ${row.id}?`)) return;
        try { await deleteLead(row.id); renderLeadGrid(); notify(`Deleted row ${row.id}`); }
        catch (err) { notify(err.message, true); }
      }, { danger: true });
      tdActions.appendChild(delBtn); tr.appendChild(tdActions);
      els.promoLeadsBody.appendChild(tr);
    });
  }

  function renderSegmentLeadGrid() {
    renderSegmentLeadFilters();
    if (typeof App.contacts?.renderContacts === 'function') {
      App.contacts.renderContacts();
    }
  }

  // ---------------------------------------------------------------------------
  // Data mutations
  // ---------------------------------------------------------------------------

  async function updateLeadCell(rowId, key, value) {
    const res = await api(`/api/promo-leads/${rowId}`, {
      method: 'PUT', body: JSON.stringify({ [key]: value })
    });
    if (!res.lead) return;
    const next = (Array.isArray(state.contacts) ? state.contacts : []).map((row) =>
      String(row.id) === String(rowId) ? res.lead : row
    );
    state.contacts = next;
    replaceLeadsInState(getLeadContacts());
  }

  async function deleteLead(rowId) {
    await api(`/api/promo-leads/${rowId}`, { method: 'DELETE' });
    state.contacts = (Array.isArray(state.contacts) ? state.contacts : [])
      .filter((r) => String(r.id) !== String(rowId));
    replaceLeadsInState(getLeadContacts());
  }

  // ---------------------------------------------------------------------------
  // Data refresh
  // ---------------------------------------------------------------------------

  async function refresh() {
    const [fieldsRes, leadsRes] = await Promise.all([
      api('/api/promo-leads/fields'),
      api('/api/contacts?type=lead')
    ]);
    state.promoFields = fieldsRes.fields || [];
    replaceLeadsInState(leadsRes.contacts || []);
    renderPromoFields();
    App.settings.renderDatabaseFieldsTable();
    renderLeadGrid();
    renderSegmentLeadGrid();
    App.contacts.renderContacts();
  }

  // ---------------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------------

  function init() {
    // Custom field form
    if (els.promoFieldForm) {
      els.promoFieldForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(els.promoFieldForm);
        const payload = {
          key: formData.get('key'), label: formData.get('label'), type: formData.get('type'),
          position: Number(formData.get('position') || 0),
          required: formData.get('required') === 'on',
          is_active: formData.get('is_active') === 'on'
        };
        try {
          await api('/api/promo-leads/fields', { method: 'POST', body: JSON.stringify(payload) });
          els.promoFieldForm.reset();
          notify('Custom field added');
          await refresh();
        } catch (err) { notify(err.message, true); }
      });
    }

    // Add lead button
    if (els.addLeadRowBtn) {
      els.addLeadRowBtn.addEventListener('click', async () => {
        const email = prompt('New lead email:');
        if (!email) return;
        try {
          await api('/api/promo-leads', { method: 'POST', body: JSON.stringify({ email }) });
          notify('Lead added');
          await refresh();
        } catch (err) { notify(err.message, true); }
      });
    }

    // Refresh button
    if (els.refreshLeadsBtn) {
      els.refreshLeadsBtn.addEventListener('click', async () => {
        try { await refresh(); notify('Contacts refreshed'); }
        catch (err) { notify(err.message, true); }
      });
    }
  }

  return {
    manifest: { id: 'promoLeads', label: 'Contacts', pageId: 'contactsPage' },
    init, refresh, refreshPromoLeads: refresh, renderLeadGrid, renderSegmentLeadGrid, renderPromoFields
  };
})();
