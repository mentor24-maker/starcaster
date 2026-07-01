window.App = window.App || {};

App.assetCategories = (function () {
  const { state, els, api, notify } = App;
  const tableState = {
    filters: {
      assetType: '',
    },
    sort: {
      key: 'assetType',
      dir: 'asc',
    },
  };
  const collapsedCategoryIds = new Set();

  function byId(id) {
    return document.getElementById(id);
  }

  function safeText(value) {
    return String(value || '').trim();
  }

  function displayAssetType(value) {
    const type = safeText(value);
    if (type === 'Lead Magnet') return 'PDF';
    if (type === 'File') return 'File';
    return type || '-';
  }

  function persistedCategories() {
    return (Array.isArray(state.assetCategories) ? state.assetCategories : [])
      .filter((item) => Number(item?.id || 0) > 0);
  }

  function categoriesById() {
    const map = new Map();
    persistedCategories().forEach((item) => {
      map.set(Number(item.id), item);
    });
    return map;
  }

  function parentLabel(item, lookup) {
    const parentId = Number(item?.parentCategoryId || 0);
    if (!parentId) return '—';
    const parent = lookup.get(parentId);
    return parent ? parent.category : '—';
  }

  function categoryPathLabel(item, lookup) {
    const parts = [];
    const guard = new Set();
    let current = item;
    while (current && current.id && !guard.has(current.id)) {
      guard.add(current.id);
      parts.unshift(safeText(current.category) || 'Category');
      const parentId = Number(current.parentCategoryId || 0);
      current = parentId ? lookup.get(parentId) : null;
    }
    return parts.join(' / ');
  }

  function isDescendantCategory(candidateId, ancestorId, lookup) {
    const target = Number(ancestorId || 0);
    let currentId = Number(candidateId || 0);
    const guard = new Set();
    while (currentId && !guard.has(currentId)) {
      guard.add(currentId);
      if (currentId === target) return true;
      const row = lookup.get(currentId);
      currentId = Number(row?.parentCategoryId || 0);
    }
    return false;
  }

  function buildParentOptions(assetType, excludeId = 0) {
    const typeFilter = safeText(assetType);
    const lookup = categoriesById();
    const items = persistedCategories()
      .filter((item) => !typeFilter || safeText(item.assetType) === typeFilter)
      .filter((item) => !excludeId || (item.id !== excludeId && !isDescendantCategory(item.id, excludeId, lookup)))
      .map((item) => ({
        value: String(item.id),
        label: categoryPathLabel(item, lookup),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return items;
  }

  function syncParentSelect(selectEl, assetType, selectedParentId, excludeId = 0) {
    if (!selectEl) return;
    const current = safeText(selectedParentId);
    const options = buildParentOptions(assetType, excludeId);
    selectEl.innerHTML = '<option value="">None (Top Level)</option>';
    options.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.value;
      option.textContent = entry.label;
      selectEl.appendChild(option);
    });
    selectEl.value = current && options.some((entry) => entry.value === current) ? current : '';
  }

  function syncCreateParentSelect() {
    const assetType = safeText(byId('assetCategoryType')?.value || els.assetCategoryForm?.asset_type?.value);
    syncParentSelect(byId('assetCategoryParent'), assetType, byId('assetCategoryParent')?.value, 0);
  }

  function syncEditParentSelect(excludeId, selectedParentId) {
    const assetType = safeText(byId('assetCategoryEditType')?.value || els.assetCategoryEditForm?.asset_type?.value);
    syncParentSelect(byId('assetCategoryEditParent'), assetType, selectedParentId, excludeId);
  }

  function setCreatePanelVisible(visible) {
    const panel = byId('assetCategoryCreatePanel');
    if (!panel) return;
    panel.classList.toggle('hidden', !visible);
  }

  function openCategoriesPage() {
    setCreatePanelVisible(false);
    App.setActivePage('assetCategoriesPage');
    refresh().catch((err) => notify(err.message || 'Unable to load categories', true));
    window.setTimeout(() => {
      refresh().catch(() => {});
    }, 250);
    return false;
  }

  function openCategoriesCreate() {
    if (els.assetCategoryForm) els.assetCategoryForm.reset();
    syncCreateParentSelect();
    setCreatePanelVisible(true);
    App.setActivePage('assetCategoriesPage');
    const panel = byId('assetCategoryCreatePanel');
    if (panel && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return false;
  }

  function getFilteredCategories() {
    const typeFilter = safeText(tableState.filters.assetType);
    return (Array.isArray(state.assetCategories) ? state.assetCategories : []).filter((item) => {
      const assetType = safeText(item?.assetType);
      if (typeFilter && assetType !== typeFilter) return false;
      return true;
    });
  }

  function compareCategories(a, b) {
    const { key, dir } = tableState.sort;
    const direction = dir === 'desc' ? -1 : 1;
    if (key === 'parentCategory') {
      const lookup = categoriesById();
      const aParent = parentLabel(a, lookup).toLowerCase();
      const bParent = parentLabel(b, lookup).toLowerCase();
      if (aParent === bParent) {
        return safeText(a.category).localeCompare(safeText(b.category)) * direction;
      }
      return aParent.localeCompare(bParent) * direction;
    }
    const aValue = safeText(a?.[key]).toLowerCase();
    const bValue = safeText(b?.[key]).toLowerCase();
    if (aValue === bValue) return 0;
    return (aValue < bValue ? -1 : 1) * direction;
  }

  function buildCategoryTreeRows(items) {
    const lookup = categoriesById();
    const presentIds = new Set();
    items.forEach((item) => {
      const id = Number(item?.id || 0);
      if (id > 0) presentIds.add(id);
    });
    const byParent = new Map();
    items.forEach((item) => {
      const id = Number(item?.id || 0);
      let parentId = Number(item.parentCategoryId || 0) || 0;
      // Treat missing/self parents as top level so the row still renders.
      if (parentId === id || !presentIds.has(parentId)) parentId = 0;
      if (!byParent.has(parentId)) byParent.set(parentId, []);
      byParent.get(parentId).push(item);
    });
    byParent.forEach((children) => children.sort(compareCategories));

    const rows = [];
    const visited = new Set();
    const walk = (parentId, depth) => {
      const children = byParent.get(parentId) || [];
      children.forEach((item) => {
        const id = Number(item.id || 0);
        if (id > 0) {
          if (visited.has(id)) return;
          visited.add(id);
        }
        // id 0 = unsaved placeholder from assets; it can never have children,
        // and recursing on it would re-walk the root forever.
        const childCount = id > 0 ? (byParent.get(id) || []).length : 0;
        rows.push({ item, depth, childCount, lookup });
        if (childCount && !collapsedCategoryIds.has(id)) {
          walk(id, depth + 1);
        }
      });
    };
    walk(0, 0);
    // Parent-link cycles are unreachable from the root; surface them as top-level rows.
    items.forEach((item) => {
      const id = Number(item?.id || 0);
      if (id > 0 && !visited.has(id)) {
        visited.add(id);
        rows.push({ item, depth: 0, childCount: 0, lookup });
      }
    });
    return rows;
  }

  function syncSortLabels() {
    const markers = {
      assetType: 'assetCategoriesSortType',
      category: 'assetCategoriesSortCategory',
      parentCategory: 'assetCategoriesSortParent',
    };
    Object.entries(markers).forEach(([key, id]) => {
      const btn = byId(id);
      if (!btn) return;
      const base = key === 'assetType'
        ? 'Asset Type'
        : key === 'category'
          ? 'Category Name'
          : 'Parent Category';
      const marker = tableState.sort.key === key
        ? (tableState.sort.dir === 'asc' ? ' ▲' : ' ▼')
        : '';
      btn.textContent = `${base}${marker}`;
    });
  }

  function openEditPage(item) {
    if (!item || !item.id || !els.assetCategoryEditForm) {
      return notify('Category id is missing', true);
    }
    els.assetCategoryEditForm.reset();
    if (els.assetCategoryEditId) els.assetCategoryEditId.value = String(item.id);
    els.assetCategoryEditForm.asset_type.value = String(item.assetType || '');
    els.assetCategoryEditForm.category.value = String(item.category || '');
    syncEditParentSelect(item.id, item.parentCategoryId || '');
    App.setActivePage('editAssetCategoryPage');
  }

  async function deleteCategory(item) {
    if (!item || !item.id) return notify('Category id is missing', true);
    if (!confirm(`Delete category "${item.category}"?`)) return;
    try {
      await api(`/api/asset-categories/${item.id}`, { method: 'DELETE' });
      notify('Category deleted');
      await refresh();
    } catch (err) {
      notify(err.message, true);
    }
  }

  async function viewCategory(item) {
    const category = String(item?.category || '').trim();
    const assetType = String(item?.assetType || '').trim();
    if (!category) return notify('Category is required to filter assets', true);
    if (App.assets && typeof App.assets.openAssetsManager === 'function') {
      try {
        await App.assets.openAssetsManager(assetType, category);
      } catch (err) {
        notify(err.message, true);
      }
      return;
    }
    if (App.state?.assetsFilters) {
      App.state.assetsFilters.asset_type = assetType;
      App.state.assetsFilters.category = category;
    }
    App.setActivePage('manageAssetsPage');
  }

  function renderCategoryRow({ item, depth, childCount, lookup }) {
    const tr = document.createElement('tr');
    tr.dataset.categoryId = String(item.id || '');

    const typeTd = document.createElement('td');
    typeTd.textContent = displayAssetType(item.assetType);

    const categoryTd = document.createElement('td');
    const nameCell = document.createElement('div');
    nameCell.className = 'asset-category-name-cell';
    nameCell.style.setProperty('--asset-category-depth', String(depth));

    const indent = document.createElement('span');
    indent.className = 'asset-category-tree-indent';
    indent.setAttribute('aria-hidden', 'true');

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `asset-category-tree-toggle${childCount ? '' : ' is-empty'}`;
    toggle.setAttribute('aria-label', childCount ? 'Toggle child categories' : '');
    const id = Number(item.id || 0);
    const isCollapsed = childCount && collapsedCategoryIds.has(id);
    toggle.textContent = childCount ? (isCollapsed ? '▶' : '▼') : '▶';
    toggle.disabled = !childCount;
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!childCount) return;
      if (collapsedCategoryIds.has(id)) collapsedCategoryIds.delete(id);
      else collapsedCategoryIds.add(id);
      renderCategories();
    });

    const label = document.createElement('span');
    label.className = 'asset-category-name-label';
    label.textContent = item.category || '-';
    if (item.source === 'assets') {
      label.textContent += ' (from assets)';
    }

    nameCell.appendChild(indent);
    nameCell.appendChild(toggle);
    nameCell.appendChild(label);
    categoryTd.appendChild(nameCell);

    const parentTd = document.createElement('td');
    parentTd.textContent = parentLabel(item, lookup);

    const actionsTd = document.createElement('td');
    const viewBtn = App.makeIconButton('view', 'View Category', () => viewCategory(item));
    const editBtn = App.makeIconButton('edit', 'Edit Category', () => openEditPage(item));
    const deleteBtn = App.makeIconButton('delete', 'Delete Category', () => deleteCategory(item), { danger: true });
    if (item.id) {
      App.finishTableActionsCell(actionsTd, viewBtn, editBtn, deleteBtn);
    } else {
      actionsTd.textContent = '—';
    }

    tr.appendChild(typeTd);
    tr.appendChild(categoryTd);
    tr.appendChild(parentTd);
    tr.appendChild(actionsTd);
    return tr;
  }

  function renderCategories() {
    if (!els.assetCategoriesTable) return;
    els.assetCategoriesTable.innerHTML = '';
    syncSortLabels();
    syncCreateParentSelect();

    const filtered = getFilteredCategories();
    const treeRows = buildCategoryTreeRows(filtered);
    treeRows.forEach((row) => {
      els.assetCategoriesTable.appendChild(renderCategoryRow(row));
    });

    if (!els.assetCategoriesTable.children.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 4;
      td.textContent = 'No categories match the current filters.';
      tr.appendChild(td);
      els.assetCategoriesTable.appendChild(tr);
    }
  }

  function renderCategoriesMap() {
    // Asset Categories use the editor table as the primary management surface.
  }

  async function refresh() {
    const result = await api('/api/asset-categories');
    state.assetCategories = Array.isArray(result?.categories)
      ? result.categories
      : Array.isArray(result?.data)
        ? result.data
        : [];
    renderCategoriesMap();
    renderCategories();
  }

  function bindSortButton(buttonId, key) {
    const btn = byId(buttonId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (tableState.sort.key === key) {
        tableState.sort.dir = tableState.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        tableState.sort.key = key;
        tableState.sort.dir = 'asc';
      }
      renderCategories();
    });
  }

  function init() {
    const filterTypeInput = byId('assetCategoriesFilterType');
    bindSortButton('assetCategoriesSortType', 'assetType');
    bindSortButton('assetCategoriesSortCategory', 'category');
    bindSortButton('assetCategoriesSortParent', 'parentCategory');

    if (filterTypeInput) {
      filterTypeInput.addEventListener('change', () => {
        tableState.filters.assetType = safeText(filterTypeInput.value);
        renderCategories();
      });
    }

    const createTypeSelect = byId('assetCategoryType');
    if (createTypeSelect) {
      createTypeSelect.addEventListener('change', syncCreateParentSelect);
    }
    const editTypeSelect = byId('assetCategoryEditType');
    if (editTypeSelect) {
      editTypeSelect.addEventListener('change', () => {
        const excludeId = Number(byId('assetCategoryEditId')?.value || 0) || 0;
        syncEditParentSelect(excludeId, byId('assetCategoryEditParent')?.value);
      });
    }

    if (els.openCreateAssetCategoryPageBtn) {
      els.openCreateAssetCategoryPageBtn.addEventListener('click', () => {
        openCategoriesCreate();
      });
    }

    if (els.backToAssetCategoriesBtn) {
      els.backToAssetCategoriesBtn.addEventListener('click', () => {
        openCategoriesPage();
      });
    }

    if (els.backFromEditAssetCategoryBtn) {
      els.backFromEditAssetCategoryBtn.addEventListener('click', () => {
        openCategoriesPage();
      });
    }
  }

  async function submitCategoryCreate(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const form = els.assetCategoryForm;
    if (!form) return false;
    const formData = new FormData(form);
    const parentRaw = safeText(formData.get('parent_category'));
    const payload = {
      assetType: String(formData.get('asset_type') || '').trim(),
      category: String(formData.get('category') || '').trim(),
      parentCategoryId: parentRaw ? Number(parentRaw) : null,
    };

    try {
      await api('/api/asset-categories', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      notify('Category created');
      form.reset();
      await refresh();
      setCreatePanelVisible(true);
      App.setActivePage('assetCategoriesPage');
    } catch (err) {
      notify(err.message, true);
    }
    return false;
  }

  async function submitCategoryEdit(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const form = els.assetCategoryEditForm;
    if (!form) return false;
    const formData = new FormData(form);
    const categoryId = Number(formData.get('id') || 0) || 0;
    if (!categoryId) return notify('Category id is required', true);
    const parentRaw = safeText(formData.get('parent_category'));

    const payload = {
      assetType: String(formData.get('asset_type') || '').trim(),
      category: String(formData.get('category') || '').trim(),
      parentCategoryId: parentRaw ? Number(parentRaw) : null,
    };

    try {
      await api(`/api/asset-categories/${categoryId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      notify('Category updated');
      form.reset();
      await refresh();
      openCategoriesPage();
    } catch (err) {
      notify(err.message, true);
    }
    return false;
  }

  return {
    manifest: { id: 'assetCategories', label: 'Asset Categories', pageId: 'assetCategoriesPage' },
    init,
    openCategoriesPage,
    openCategoriesCreate,
    refresh,
    submitCategoryCreate,
    submitCategoryEdit,
    onPageActivated: refresh,
  };
})();
