window.App = window.App || {};

App.training = {
  elements: {},

  init() {
    this.elements.tableBody = document.getElementById('trainingContextRepoTable');
    this.elements.countBadge = document.getElementById('trainingContextRepoCount');
    this.elements.refreshBtn = document.getElementById('refreshTrainingCorpusBtn');
    
    // Filters
    this.elements.filterFileType = document.getElementById('filterTrainingFileType');
    this.elements.filterDomain = document.getElementById('filterTrainingDomain');
    this.elements.filterCategory = document.getElementById('filterTrainingCategory');
    this.elements.filterSearch = document.getElementById('filterTrainingSearch');
    this.elements.filterStart = document.getElementById('filterTrainingStartDate');
    this.elements.filterEnd = document.getElementById('filterTrainingEndDate');

    if (this.elements.refreshBtn) {
      this.elements.refreshBtn.addEventListener('click', () => this.loadCorpus());
    }
    
    // Bind auto-refresh to filter changes
    [this.elements.filterFileType, this.elements.filterDomain, this.elements.filterCategory, this.elements.filterSearch, this.elements.filterStart, this.elements.filterEnd].forEach(el => {
      if (el) {
        // Use 'input' for text/date, 'change' for select
        el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
          // Debounce text inputs slightly to prevent query spam
          clearTimeout(this._filterTimeout);
          this._filterTimeout = setTimeout(() => this.loadCorpus(), 300);
        });
      }
    });

    // Bind to the Training page show event to refresh logs
    document.addEventListener('pageChanged', (e) => {
      if (e.detail && e.detail.pageId === 'trainingContextPage') {
        this.loadCorpus();
      }
    });

    // Attempt initial load just in case we boot directly to Training
    this.loadCorpus();
  },

  async loadCorpus() {
    if (!this.elements.tableBody) return;
    try {
      if (!window.supabaseClient) {
        console.warn("Supabase client not initialized yet.");
        return;
      }
      
      this.elements.tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:2rem; opacity:0.6;">Loading Knowledge Base vectors...</td></tr>';
      
      let query = window.supabaseClient
        .from('training_corpus')
        .select('id, title, source_type, category, created_at', { count: 'exact' });

      // Apply Filters
      if (this.elements.filterFileType && this.elements.filterFileType.value) {
        query = query.ilike('title', `%${this.elements.filterFileType.value}%`);
      }
      if (this.elements.filterDomain && this.elements.filterDomain.value) {
        query = query.eq('source_type', this.elements.filterDomain.value);
      }
      if (this.elements.filterCategory && this.elements.filterCategory.value.trim()) {
        query = query.ilike('category', `%${this.elements.filterCategory.value.trim()}%`);
      }
      if (this.elements.filterSearch && this.elements.filterSearch.value.trim()) {
        query = query.ilike('title', `%${this.elements.filterSearch.value.trim()}%`);
      }
      if (this.elements.filterStart && this.elements.filterStart.value) {
        // Append time to ensure start of day inclusion natively
        query = query.gte('created_at', `${this.elements.filterStart.value}T00:00:00Z`);
      }
      if (this.elements.filterEnd && this.elements.filterEnd.value) {
        query = query.lte('created_at', `${this.elements.filterEnd.value}T23:59:59Z`);
      }

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;

      if (this.elements.countBadge) {
        this.elements.countBadge.textContent = count || (data ? data.length : 0);
      }

      this.elements.tableBody.innerHTML = '';

      if (!data || data.length === 0) {
        this.elements.tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:2rem; opacity:0.6;">No data found in training_corpus.</td></tr>';
        return;
      }

      data.forEach(item => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-light)';
        
        const dateObj = new Date(item.created_at);
        const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        tr.innerHTML = `
          <td style="padding: 0.75rem 1rem; font-weight: 500;">${item.title || 'Untitled'}</td>
          <td style="padding: 0.75rem 1rem;"><span style="background:var(--bg-input); padding:0.15rem 0.5rem; border-radius:10px; font-size:0.75rem;">${item.source_type}</span></td>
          <td style="padding: 0.75rem 1rem;">${item.category || '-'}</td>
          <td style="padding: 0.75rem 1rem; font-size: 0.85rem; color: var(--text-color-secondary);">${dateStr}</td>
          <td style="padding: 0.75rem 1rem; text-align: right;">
            <button class="danger-btn tiny-btn delete-btn" data-id="${item.id}" style="padding:0.2rem 0.6rem; font-size:0.75rem; background:transparent; color:#e02424; border:1px solid #e02424;">Delete</button>
          </td>
        `;

        const delBtn = tr.querySelector('.delete-btn');
        if (delBtn) {
          delBtn.addEventListener('click', async (e) => {
            if (confirm(`Remove abstract chunk: '${item.title}' from the Agent RAG Memory?`)) {
              await this.deleteCorpusItem(item.id);
            }
          });
        }

        this.elements.tableBody.appendChild(tr);
      });

    } catch (e) {
      console.error("Failed to load training corpus", e);
      this.elements.tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:2rem; color:red;">Error: ${e.message}</td></tr>`;
    }
  },
  
  async deleteCorpusItem(id) {
    try {
      const { error } = await window.supabaseClient
        .from('training_corpus')
        .delete()
        .eq('id', id);
        
      if (error) throw error;
      
      // Refresh UI natively
      this.loadCorpus();
    } catch (e) {
      alert("Error deleting record: " + e.message);
    }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => App.training.init(), 1000);
});
