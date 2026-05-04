'use strict';

/**
 * public/js/polls.js
 * Frontend logic for Polls Management
 */

window.App = window.App || {};

App.polls = (function() {
  const { byId, on, api, notify, safeText, empty, makeIconButton, parseCsv } = App;
  
  let pollsList = [];
  
  // Elements
  let grid = null;
  
  // Form Modal
  const modal = byId('pollFormModal');
  const form = byId('pollForm');
  const pollEditId = byId('pollEditId');
  const optionsContainer = byId('pollOptionsContainer');
  
  // Import Modal
  const importModal = byId('importPollsModal');
  const importForm = byId('importPollsForm');
  const csvFileInput = byId('pollsCsvFile');
  const csvPreview = byId('pollsCsvPreview');
  
  let parsedCsvData = null;

  const COLUMNS = [
    { key: 'question', label: 'Question', render: val => {
        const span = document.createElement('span');
        span.style.fontWeight = '500';
        span.textContent = safeText(val);
        return span;
      } 
    },
    { key: 'category', label: 'Category' },
    { key: 'poll_options', label: 'Options', sortable: false, render: val => {
        const opts = val || [];
        if (!opts.length) return 'None';
        const labels = opts.map(o => o.label).join(', ');
        return labels.length > 50 ? labels.substring(0, 50) + '...' : labels;
      }
    },
    { key: 'created_at', label: 'Created', render: val => new Date(val).toLocaleDateString() },
    { key: 'actions', label: 'Actions', sortable: false, render: (val, row) => {
        const div = document.createElement('div');
        div.style.textAlign = 'right';
        const editBtn = makeIconButton('edit', 'Edit Poll', () => openForm(row));
        const delBtn = makeIconButton('delete', 'Delete Poll', async () => {
          if (!confirm('Are you sure you want to delete this poll?')) return;
          try {
            await api(`/api/polls/${encodeURIComponent(row.id)}`, { method: 'DELETE' });
            notify('Poll deleted');
            loadPolls();
          } catch (err) {
            notify(err.message, true);
          }
        }, { danger: true, marginLeft: '8px' });
        div.appendChild(editBtn);
        div.appendChild(delBtn);
        return div;
      }
    }
  ];

  function setupGrid() {
    const mountPoint = byId('pollsGridMountPoint');
    if (!mountPoint || grid) return;

    grid = App.components.DataGrid({
      columns: COLUMNS,
      rows: pollsList,
      emptyMessage: 'No polls found.',
      filterable: true,
      sortable: true,
      selectable: true,
      bulkActions: [
        {
          label: 'Delete Selected',
          danger: true,
          onClick: async (selectedIds, clearSelection) => {
            if (!confirm(`Are you sure you want to delete ${selectedIds.length} poll(s)?`)) return;
            try {
              await Promise.all(selectedIds.map(id => api(`/api/polls/${encodeURIComponent(id)}`, { method: 'DELETE' })));
              notify(`${selectedIds.length} poll(s) deleted`);
              clearSelection();
              loadPolls();
            } catch (err) {
              notify(err.message, true);
            }
          }
        }
      ]
    });
    mountPoint.appendChild(grid.el);
  }

  async function loadPolls() {
    setupGrid();
    try {
      const res = await api('/api/polls');
      pollsList = res.data || [];
      if (grid) grid.update({ rows: pollsList });
    } catch (err) {
      notify('Error loading polls: ' + err.message, true);
    }
  }

  function createOptionRow(val = '') {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '0.5rem';
    row.style.alignItems = 'center';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'poll-option-input';
    input.value = val;
    input.placeholder = 'Option text...';
    input.required = true;
    input.style.flex = '1';
    
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.innerHTML = '&times;';
    removeBtn.title = 'Remove option';
    removeBtn.style.background = 'transparent';
    removeBtn.style.border = 'none';
    removeBtn.style.color = 'var(--danger)';
    removeBtn.style.fontSize = '1.2rem';
    removeBtn.style.cursor = 'pointer';
    removeBtn.onclick = () => row.remove();
    
    row.appendChild(input);
    row.appendChild(removeBtn);
    return row;
  }

  function openForm(poll = null) {
    form.reset();
    empty(optionsContainer);
    
    if (poll) {
      byId('pollFormTitle').textContent = 'Edit Poll';
      pollEditId.value = poll.id;
      byId('pollQuestion').value = poll.question || '';
      byId('pollCategory').value = poll.category || '';
      
      const opts = poll.poll_options || [];
      if (opts.length) {
        opts.forEach(opt => optionsContainer.appendChild(createOptionRow(opt.label)));
      } else {
        optionsContainer.appendChild(createOptionRow(''));
        optionsContainer.appendChild(createOptionRow(''));
      }
    } else {
      byId('pollFormTitle').textContent = 'Create Poll';
      pollEditId.value = '';
      optionsContainer.appendChild(createOptionRow(''));
      optionsContainer.appendChild(createOptionRow(''));
    }
    
    if (modal.tagName === 'DIALOG') {
      modal.showModal();
    } else {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
    }
  }

  function closeForm() {
    if (modal.tagName === 'DIALOG') {
      modal.close();
    } else {
      modal.classList.add('hidden');
      modal.style.display = 'none';
    }
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    const id = pollEditId.value;
    const question = byId('pollQuestion').value;
    const category = byId('pollCategory').value;
    
    const inputs = optionsContainer.querySelectorAll('.poll-option-input');
    const options = Array.from(inputs).map((input, i) => ({
      label: input.value,
      sort_order: i + 1
    })).filter(o => o.label.trim() !== '');
    
    const payload = { question, category, options };
    
    try {
      if (id) {
        await api(`/api/polls/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
        notify('Poll updated');
      } else {
        await api('/api/polls', { method: 'POST', body: JSON.stringify(payload) });
        notify('Poll created');
      }
      closeForm();
      loadPolls();
    } catch (err) {
      notify(err.message, true);
    }
  }

  function openImport() {
    importForm.reset();
    csvPreview.style.display = 'none';
    parsedCsvData = null;
    if (importModal.tagName === 'DIALOG') {
      importModal.showModal();
    } else {
      importModal.classList.remove('hidden');
      importModal.style.display = 'flex';
    }
  }
  
  function closeImport() {
    if (importModal.tagName === 'DIALOG') {
      importModal.close();
    } else {
      importModal.classList.add('hidden');
      importModal.style.display = 'none';
    }
  }

  async function handleCsvSelect(e) {
    const file = e.target.files[0];
    if (!file) {
      parsedCsvData = null;
      csvPreview.style.display = 'none';
      return;
    }
    
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows || rows.length === 0) {
      csvPreview.textContent = 'No valid rows found in CSV.';
      csvPreview.style.display = 'block';
      csvPreview.style.color = 'var(--danger)';
      parsedCsvData = null;
      return;
    }
    
    parsedCsvData = rows;
    csvPreview.textContent = `Found ${rows.length} rows to import. First row: "${rows[0].Question || '?'}"`;
    csvPreview.style.display = 'block';
    csvPreview.style.color = 'var(--ink)';
  }

  async function handleImportSubmit(e) {
    e.preventDefault();
    if (!parsedCsvData || !parsedCsvData.length) {
      notify('Please select a valid CSV file first', true);
      return;
    }
    
    const btn = byId('uploadPollsCsvBtn');
    const origText = btn.textContent;
    btn.textContent = 'Importing...';
    btn.disabled = true;
    
    try {
      const res = await api('/api/polls/import', {
        method: 'POST',
        body: JSON.stringify({ rows: parsedCsvData })
      });
      notify(`Successfully imported ${res.data?.count || 0} polls`);
      closeImport();
      loadPolls();
    } catch (err) {
      notify(err.message, true);
    } finally {
      btn.textContent = origText;
      btn.disabled = false;
    }
  }

  function init() {
    if (byId('pollForm')) {
      on('openCreatePollBtn', 'click', () => openForm());
      on('closePollFormBtn', 'click', closeForm);
      on('pollForm', 'submit', handleFormSubmit);
      on('addPollOptionBtn', 'click', () => optionsContainer.appendChild(createOptionRow('')));
      
      on('openImportPollsBtn', 'click', openImport);
      on('closeImportPollsBtn', 'click', closeImport);
      on('pollsCsvFile', 'change', handleCsvSelect);
      on('importPollsForm', 'submit', handleImportSubmit);
      
      // Hook into App.setActivePage to load data when page shown
      const originalSetActivePage = App.setActivePage;
      App.setActivePage = function(pageId) {
        if (typeof originalSetActivePage === 'function') {
          originalSetActivePage.apply(this, arguments);
        }
        if (pageId === 'pollsPage' || pageId === 'developModulesPage') {
          loadPolls();
        }
      };
    }
  }

  // Auto-init on DOMContentLoaded if App calls it, otherwise we hook into ready
  document.addEventListener('DOMContentLoaded', init);

  return {
    loadPolls
  };
})();
