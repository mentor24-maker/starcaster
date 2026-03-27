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

  function byId(id) {
    return document.getElementById(id);
  }

  function safeText(value) {
    return String(value || '').trim();
  }

  function displayAssetType(value) {
    const type = safeText(value);
    if (type === 'Lead Magnet') return 'PDF';
    return type || '-';
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
    setCreatePanelVisible(true);
    App.setActivePage('assetCategoriesPage');
    const panel = byId('assetCategoryCreatePanel');
    if (panel && typeof panel.scrollIntoView === 'function') {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    return false;
  }

  function getFilteredSortedCategories() {
    const typeFilter = safeText(tableState.filters.assetType);
    const items = Array.isArray(state.assetCategories) ? [...state.assetCategories] : [];

    const filtered = items.filter((item) => {
      const assetType = safeText(item?.assetType);
      if (typeFilter && assetType !== typeFilter) return false;
      return true;
    });

    const { key, dir } = tableState.sort;
    filtered.sort((a, b) => {
      const aValue = safeText(a?.[key]).toLowerCase();
      const bValue = safeText(b?.[key]).toLowerCase();
      if (aValue === bValue) return 0;
      const result = aValue < bValue ? -1 : 1;
      return dir === 'asc' ? result : -result;
    });

    return filtered;
  }

  function syncSortLabels() {
    const typeBtn = byId('assetCategoriesSortType');
    const categoryBtn = byId('assetCategoriesSortCategory');
    if (typeBtn) {
      const marker = tableState.sort.key === 'assetType'
        ? (tableState.sort.dir === 'asc' ? ' ▲' : ' ▼')
        : '';
      typeBtn.textContent = `Asset Type${marker}`;
    }
    if (categoryBtn) {
      const marker = tableState.sort.key === 'category'
        ? (tableState.sort.dir === 'asc' ? ' ▲' : ' ▼')
        : '';
      categoryBtn.textContent = `Category${marker}`;
    }
  }

  function openEditPage(item) {
    if (!item || !item.id || !els.assetCategoryEditForm) {
      return notify('Category id is missing', true);
    }
    els.assetCategoryEditForm.reset();
    if (els.assetCategoryEditId) els.assetCategoryEditId.value = String(item.id);
    els.assetCategoryEditForm.asset_type.value = String(item.assetType || '');
    els.assetCategoryEditForm.category.value = String(item.category || '');
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

  function renderCategories() {
    if (!els.assetCategoriesTable) return;
    els.assetCategoriesTable.innerHTML = '';
    syncSortLabels();
    getFilteredSortedCategories().forEach((item) => {
      const tr = document.createElement('tr');
      const typeTd = document.createElement('td');
      typeTd.textContent = displayAssetType(item.assetType);

      const categoryTd = document.createElement('td');
      categoryTd.textContent = item.category || '-';

      const actionsTd = document.createElement('td');
      actionsTd.className = 'asset-categories-actions-cell';
      const viewBtn = App.makeIconButton('view', 'View Category', () => viewCategory(item));
      const editBtn = App.makeIconButton('edit', 'Edit Category', () => openEditPage(item), { marginLeft: '8px' });
      const deleteBtn = App.makeIconButton('delete', 'Delete Category', () => deleteCategory(item), { danger: true, marginLeft: '8px' });

      actionsTd.appendChild(viewBtn);
      actionsTd.appendChild(editBtn);
      actionsTd.appendChild(deleteBtn);

      tr.appendChild(typeTd);
      tr.appendChild(categoryTd);
      tr.appendChild(actionsTd);
      els.assetCategoriesTable.appendChild(tr);
    });

    if (!els.assetCategoriesTable.children.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.textContent = 'No categories match the current filters.';
      tr.appendChild(td);
      els.assetCategoriesTable.appendChild(tr);
    }
  }

  function renderCategoriesMap() {
    // Asset Categories now use the editor table as the primary management surface.
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

  function init() {
    const filterTypeInput = byId('assetCategoriesFilterType');
    const sortTypeBtn = byId('assetCategoriesSortType');
    const sortCategoryBtn = byId('assetCategoriesSortCategory');

    if (filterTypeInput) {
      filterTypeInput.addEventListener('change', () => {
        tableState.filters.assetType = safeText(filterTypeInput.value);
        renderCategories();
      });
    }

    if (sortTypeBtn) {
      sortTypeBtn.addEventListener('click', () => {
        if (tableState.sort.key === 'assetType') {
          tableState.sort.dir = tableState.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          tableState.sort.key = 'assetType';
          tableState.sort.dir = 'asc';
        }
        renderCategories();
      });
    }

    if (sortCategoryBtn) {
      sortCategoryBtn.addEventListener('click', () => {
        if (tableState.sort.key === 'category') {
          tableState.sort.dir = tableState.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          tableState.sort.key = 'category';
          tableState.sort.dir = 'asc';
        }
        renderCategories();
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

    if (els.assetCategoryForm) {
      els.assetCategoryForm.addEventListener('submit', async (e) => {
        return submitCategoryCreate(e);
      });
    }

    if (els.assetCategoryEditForm) {
      els.assetCategoryEditForm.addEventListener('submit', async (e) => {
        return submitCategoryEdit(e);
      });
    }
  }

  async function submitCategoryCreate(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    const form = els.assetCategoryForm;
    if (!form) return false;
    const formData = new FormData(form);
    const payload = {
      assetType: String(formData.get('asset_type') || '').trim(),
      category: String(formData.get('category') || '').trim(),
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

    const payload = {
      assetType: String(formData.get('asset_type') || '').trim(),
      category: String(formData.get('category') || '').trim(),
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
