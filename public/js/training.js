window.App = window.App || {};

App.training = {
  elements: {},

  init() {
    this.elements.tableBody = document.getElementById('trainingContextRepoTable');
    this.elements.countBadge = document.getElementById('trainingContextRepoCount');
    this.elements.refreshBtn = document.getElementById('refreshTrainingCorpusBtn');
    this.elements.triggerAcquireBtn = document.getElementById('triggerAcquireBtn');
    this.elements.filesystemRefreshBtn = document.getElementById('trainingFilesystemRefreshBtn');
    
    this.elements.viewerModal = document.getElementById('trainingCorpusViewerModal');
    this.elements.viewerTitle = document.getElementById('trainingCorpusViewerTitle');
    this.elements.viewerContent = document.getElementById('trainingCorpusViewerContent');
    this.elements.viewerClose = document.getElementById('trainingCorpusViewerCloseBtn');
    this.elements.viewerEditBtn = document.getElementById('trainingCorpusViewerEditBtn');
    this.elements.viewerSaveBtn = document.getElementById('trainingCorpusViewerSaveBtn');
    this.elements.viewerTextarea = document.getElementById('trainingCorpusViewerTextarea');

    if (this.elements.viewerEditBtn) {
      this.elements.viewerEditBtn.addEventListener('click', () => {
        this.elements.viewerContent.classList.add('hidden');
        this.elements.viewerContent.style.display = 'none';
        this.elements.viewerTextarea.classList.remove('hidden');
        this.elements.viewerTextarea.style.display = 'block';
        this.elements.viewerTextarea.value = this.elements.viewerContent.textContent;
        this.elements.viewerEditBtn.style.display = 'none';
        this.elements.viewerSaveBtn.style.display = 'block';
      });
    }

    if (this.elements.viewerSaveBtn) {
      this.elements.viewerSaveBtn.addEventListener('click', async () => {
        if (typeof this._currentSaveCallback === 'function') {
          const originalText = this.elements.viewerSaveBtn.textContent;
          this.elements.viewerSaveBtn.textContent = 'Saving...';
          try {
            await this._currentSaveCallback(this.elements.viewerTextarea.value);
            this.elements.viewerContent.textContent = this.elements.viewerTextarea.value;
            this.elements.viewerTextarea.classList.add('hidden');
            this.elements.viewerTextarea.style.display = 'none';
            this.elements.viewerContent.classList.remove('hidden');
            this.elements.viewerContent.style.display = 'block';
            this.elements.viewerSaveBtn.style.display = 'none';
            this.elements.viewerEditBtn.style.display = 'block';
          } catch(e) {
            alert('Save failed: ' + e.message);
          } finally {
            this.elements.viewerSaveBtn.textContent = originalText;
          }
        }
      });
    }
    
    this.elements.knowledgebaseTable = document.getElementById('trainingKnowledgebaseTable');
    this.elements.knowledgebaseRefreshBtn = document.getElementById('trainingKnowledgebaseRefreshBtn');

    if (this.elements.knowledgebaseRefreshBtn) {
      this.elements.knowledgebaseRefreshBtn.addEventListener('click', () => this.fetchKnowledgeItems());
    }

    if (this.elements.viewerClose) {
      this.elements.viewerClose.addEventListener('click', () => {
        this.elements.viewerModal.classList.add('hidden');
        this.elements.viewerModal.style.display = 'none';
      });
    }

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

    if (this.elements.triggerAcquireBtn) {
      this.elements.triggerAcquireBtn.addEventListener('click', async () => {
        const btn = this.elements.triggerAcquireBtn;
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = "Starting Acquire...";
        try {
          const res = await fetch('/api/develop/training/acquire', { method: 'POST' });
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to start acquire');
          }
          alert("Knowledge acquire started in the background. Check logs for progress. You can refresh knowledge manually after a few moments.");
        } catch (e) {
          console.error(e);
          alert("Error starting acquire: " + e.message);
        } finally {
          btn.disabled = false;
          btn.textContent = originalText;
        }
      });
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
      if (e.detail && e.detail.pageId === 'trainingKnowledgebasePage') {
        this.fetchKnowledgeItems();
      }
      if (e.detail && e.detail.pageId === 'trainingFilesystemPage') {
        this.loadFilesystem();
      }
    });

    if (this.elements.filesystemRefreshBtn) {
      this.elements.filesystemRefreshBtn.addEventListener('click', () => this.loadFilesystem());
    }

    // Attempt initial load just in case we boot directly to Training
    this.loadCorpus();
  },

  async fetchKnowledgeItems() {
    if (!this.elements.knowledgebaseTable) return;
    
    this.elements.knowledgebaseTable.innerHTML = '';
    const loadingTr = document.createElement('tr');
    const loadingTd = document.createElement('td');
    loadingTd.colSpan = 4;
    loadingTd.style.cssText = 'text-align:center; padding:2rem; opacity:0.6;';
    loadingTd.textContent = 'Loading Knowledge Items...';
    loadingTr.appendChild(loadingTd);
    this.elements.knowledgebaseTable.appendChild(loadingTr);
    
    try {
      const res = await fetch('/api/system/knowledge');
      if (!res.ok) throw new Error('Failed to fetch knowledge items');
      const data = await res.json();
      
      this.elements.knowledgebaseTable.innerHTML = '';
      
      if (!data || data.length === 0) {
        const emptyTr = document.createElement('tr');
        const emptyTd = document.createElement('td');
        emptyTd.colSpan = 4;
        emptyTd.style.cssText = 'text-align:center; padding:2rem; opacity:0.6;';
        emptyTd.textContent = 'No local knowledge items found in ~/.gemini/antigravity/knowledge.';
        emptyTr.appendChild(emptyTd);
        this.elements.knowledgebaseTable.appendChild(emptyTr);
        return;
      }
      
      data.forEach(item => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-light)';
        
        const tdTitle = document.createElement('td');
        tdTitle.style.cssText = 'padding: 0.75rem 1rem; font-weight: 500;';
        const aTitle = document.createElement('a');
        aTitle.href = '#';
        aTitle.style.cssText = 'color: var(--link-color, #3b82f6); text-decoration: underline;';
        aTitle.textContent = item.title;
        aTitle.addEventListener('click', async (e) => {
          e.preventDefault();
          this.openViewer(item.title, 'Loading content...', async (newContent) => {
            const res = await fetch(`/api/system/knowledge/content?id=${encodeURIComponent(item.id)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: newContent })
            });
            if (!res.ok) throw new Error('Failed to save');
          });
          try {
            const res = await fetch(`/api/system/knowledge/content?id=${encodeURIComponent(item.id)}`);
            if (!res.ok) throw new Error('Failed to load content');
            const result = await res.json();
            this.elements.viewerContent.textContent = result.content;
          } catch (err) {
            this.elements.viewerContent.textContent = 'Error loading content: ' + err.message;
          }
        });
        tdTitle.appendChild(aTitle);
        
        const tdSummary = document.createElement('td');
        tdSummary.style.cssText = 'padding: 0.75rem 1rem; color: var(--text-color-secondary);';
        tdSummary.textContent = item.summary;
        
        const tdUpdated = document.createElement('td');
        tdUpdated.style.cssText = 'padding: 0.75rem 1rem; font-size: 0.85rem;';
        const dateObj = item.timestamp ? new Date(item.timestamp) : new Date();
        tdUpdated.textContent = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        const tdPath = document.createElement('td');
        tdPath.style.cssText = 'padding: 0.75rem 1rem; font-size: 0.75rem; font-family: monospace; color: var(--muted);';
        tdPath.textContent = item.path;
        
        tr.appendChild(tdTitle);
        tr.appendChild(tdSummary);
        tr.appendChild(tdUpdated);
        tr.appendChild(tdPath);
        
        this.elements.knowledgebaseTable.appendChild(tr);
      });
    } catch (e) {
      console.error(e);
      this.elements.knowledgebaseTable.innerHTML = '';
      const errTr = document.createElement('tr');
      const errTd = document.createElement('td');
      errTd.colSpan = 4;
      errTd.style.cssText = 'text-align:center; padding:2rem; color:red;';
      errTd.textContent = String(e.message || 'Error loading knowledge items');
      errTr.appendChild(errTd);
      this.elements.knowledgebaseTable.appendChild(errTr);
    }
  },

  async loadCorpus() {
    if (!this.elements.tableBody) return;
    try {
      if (!window.supabaseClient) {
        console.warn("Supabase client not initialized yet.");
        return;
      }
      
      this.elements.tableBody.innerHTML = '';
      const loadTr = document.createElement('tr');
      const loadTd = document.createElement('td');
      loadTd.colSpan = 5;
      loadTd.style.cssText = 'text-align:center; padding:2rem; opacity:0.6;';
      loadTd.textContent = 'Loading Knowledge Base vectors...';
      loadTr.appendChild(loadTd);
      this.elements.tableBody.appendChild(loadTr);
      
      let query = window.supabaseClient
        .from('training_corpus')
        .select('id, title, source_type, category, updated_at', { count: 'exact' });

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
        query = query.gte('updated_at', `${this.elements.filterStart.value}T00:00:00Z`);
      }
      if (this.elements.filterEnd && this.elements.filterEnd.value) {
        query = query.lte('updated_at', `${this.elements.filterEnd.value}T23:59:59Z`);
      }

      const { data, error, count } = await query
        .order('updated_at', { ascending: false })
        .limit(200);

      if (error) throw error;

      if (this.elements.countBadge) {
        this.elements.countBadge.textContent = count || (data ? data.length : 0);
      }

      this.elements.tableBody.innerHTML = '';

      if (!data || data.length === 0) {
        const emptyTr = document.createElement('tr');
        const emptyTd = document.createElement('td');
        emptyTd.colSpan = 5;
        emptyTd.style.cssText = 'text-align:center; padding:2rem; opacity:0.6;';
        emptyTd.textContent = 'No data found in training_corpus.';
        emptyTr.appendChild(emptyTd);
        this.elements.tableBody.appendChild(emptyTr);
        return;
      }

      data.forEach(item => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-light)';
        
        const dateObj = new Date(item.updated_at);
        const dateStr = dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const tdTitle = document.createElement('td');
        tdTitle.style.cssText = 'padding: 0.75rem 1rem; font-weight: 500;';
        const aTitle = document.createElement('a');
        aTitle.href = '#';
        aTitle.className = 'view-corpus-btn';
        aTitle.style.cssText = 'color: var(--link-color, #3b82f6); text-decoration: underline;';
        aTitle.textContent = item.title || 'Untitled';
        tdTitle.appendChild(aTitle);
        tr.appendChild(tdTitle);

        const tdDomain = document.createElement('td');
        tdDomain.style.cssText = 'padding: 0.75rem 1rem;';
        const spanDomain = document.createElement('span');
        spanDomain.style.cssText = 'background:var(--bg-input); padding:0.15rem 0.5rem; border-radius:10px; font-size:0.75rem;';
        spanDomain.textContent = item.source_type || '';
        tdDomain.appendChild(spanDomain);
        tr.appendChild(tdDomain);

        const tdCategory = document.createElement('td');
        tdCategory.style.cssText = 'padding: 0.75rem 1rem;';
        tdCategory.textContent = item.category || '-';
        tr.appendChild(tdCategory);

        const tdDate = document.createElement('td');
        tdDate.style.cssText = 'padding: 0.75rem 1rem; font-size: 0.85rem; color: var(--text-color-secondary);';
        tdDate.textContent = dateStr;
        tr.appendChild(tdDate);

        const tdAction = document.createElement('td');
        tdAction.style.cssText = 'padding: 0.75rem 1rem; text-align: right;';
        const btnDelete = document.createElement('button');
        btnDelete.className = 'danger-btn tiny-btn delete-btn';
        btnDelete.dataset.id = item.id;
        btnDelete.style.cssText = 'padding:0.2rem 0.6rem; font-size:0.75rem; background:transparent; color:#e02424; border:1px solid #e02424;';
        btnDelete.textContent = 'Delete';
        tdAction.appendChild(btnDelete);
        tr.appendChild(tdAction);

        const viewBtn = tr.querySelector('.view-corpus-btn');
        if (viewBtn) {
          viewBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            this.openViewer(item.title, 'Loading content...', async (newContent) => {
              const { error } = await window.supabaseClient
                .from('training_corpus')
                .update({ content_text: newContent })
                .eq('id', item.id);
              if (error) throw error;
            });
            try {
              const { data: doc, error: docErr } = await window.supabaseClient
                .from('training_corpus')
                .select('content_text')
                .eq('id', item.id)
                .single();
              if (docErr) throw docErr;
              this.elements.viewerContent.textContent = doc.content_text || '// No text available.';
            } catch (err) {
              this.elements.viewerContent.textContent = 'Error loading content: ' + err.message;
            }
          });
        }

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
      this.elements.tableBody.innerHTML = '';
      const errTr = document.createElement('tr');
      const errTd = document.createElement('td');
      errTd.colSpan = 5;
      errTd.style.cssText = 'text-align:center; padding:2rem; color:red;';
      errTd.textContent = 'Error: ' + String(e.message || 'Error loading training corpus');
      errTr.appendChild(errTd);
      this.elements.tableBody.appendChild(errTr);
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
  },

  openViewer(title, rawText, onSaveCallback) {
    if (!this.elements.viewerModal) return;
    this.elements.viewerTitle.textContent = title || 'Document Viewer';
    this.elements.viewerContent.textContent = rawText || '// No text extracted or vector is corrupted.';
    this.elements.viewerContent.classList.remove('hidden');
    this.elements.viewerContent.style.display = 'block';

    const descContainer = document.getElementById('trainingCorpusViewerDescriptionContainer');
    if (descContainer) {
      descContainer.classList.add('hidden');
      descContainer.style.display = 'none';
    }
    
    if (this.elements.viewerTextarea) {
      this.elements.viewerTextarea.classList.add('hidden');
      this.elements.viewerTextarea.style.display = 'none';
    }

    this._currentSaveCallback = onSaveCallback;

    if (this.elements.viewerEditBtn && this.elements.viewerSaveBtn) {
      if (typeof onSaveCallback === 'function') {
        this.elements.viewerEditBtn.style.display = 'block';
        this.elements.viewerSaveBtn.style.display = 'none';
      } else {
        this.elements.viewerEditBtn.style.display = 'none';
        this.elements.viewerSaveBtn.style.display = 'none';
      }
    }

    this.elements.viewerModal.classList.remove('hidden');
    this.elements.viewerModal.style.display = 'flex';
  },

  async loadFilesystem() {
    const rootEl = document.getElementById('trainingFilesystemRoot');
    if (!rootEl) return;
    
    rootEl.innerHTML = '<li style="opacity:0.6; padding: 1rem; text-align:center;">Loading Filesystem...</li>';
    try {
      const res = await fetch('/api/system/filesystem/tree');
      if (!res.ok) throw new Error('Failed to load filesystem tree');
      const tree = await res.json();
      rootEl.innerHTML = '';
      this.renderFileTree(tree, rootEl);
    } catch (e) {
      console.error(e);
      rootEl.innerHTML = `<li style="color:red; padding:1rem; text-align:center;">Error: ${e.message}</li>`;
    }
  },

  renderFileTree(node, container) {
    const li = document.createElement('li');
    li.style.margin = '0.2rem 0';
    
    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.cursor = 'pointer';
    wrapper.style.padding = '0.4rem 0.6rem';
    wrapper.style.borderRadius = '6px';
    wrapper.style.background = 'var(--bg-input)';
    wrapper.style.marginBottom = '0.2rem';
    wrapper.style.border = '1px solid transparent';
    wrapper.style.transition = 'all 0.2s';
    wrapper.addEventListener('mouseover', () => {
      wrapper.style.background = 'var(--bg-hover)';
      wrapper.style.borderColor = 'var(--border-light)';
    });
    wrapper.addEventListener('mouseout', () => {
      wrapper.style.background = 'var(--bg-input)';
      wrapper.style.borderColor = 'transparent';
    });
    
    const icon = document.createElement('span');
    icon.style.marginRight = '0.5rem';
    
    const label = document.createElement('span');
    label.style.flex = '1';
    label.textContent = node.name;

    const infoBtn = document.createElement('span');
    infoBtn.textContent = '+';
    infoBtn.style.cssText = 'font-size: 0.75rem; font-weight: bold; color: var(--text-color-secondary); border: 1px solid var(--border-light); padding: 0 5px; border-radius: 4px; cursor: pointer; background: transparent; transition: all 0.2s;';
    infoBtn.addEventListener('mouseover', () => { infoBtn.style.background = 'var(--bg-input)'; infoBtn.style.color = 'var(--text-color)'; });
    infoBtn.addEventListener('mouseout', () => { infoBtn.style.background = 'transparent'; infoBtn.style.color = 'var(--text-color-secondary)'; });
    
    wrapper.appendChild(icon);
    wrapper.appendChild(label);
    wrapper.appendChild(infoBtn);
    li.appendChild(wrapper);
    container.appendChild(li);

    const openOverviewFn = async (e) => {
        if (e) e.stopPropagation();
        this.openViewer(node.path, `Loading ${node.type === 'directory' ? 'directory contents' : 'content'}...`, node.type === 'directory' ? null : async (newContent) => {
           const res = await fetch(`/api/system/filesystem/content?path=${encodeURIComponent(node.path)}`, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ content: newContent })
           });
           if (!res.ok) {
             const err = await res.json();
             throw new Error(err.error || 'Failed to save');
           }
        });
        
        try {
          const res = await fetch(`/api/system/filesystem/content?path=${encodeURIComponent(node.path)}`);
          if (!res.ok) throw new Error('Failed to load file');
          const data = await res.json();
          this.elements.viewerContent.textContent = data.content;
        } catch (err) {
          this.elements.viewerContent.textContent = err.message;
        }

        const descContainer = document.getElementById('trainingCorpusViewerDescriptionContainer');
        const descSpan = document.getElementById('trainingCorpusViewerDescription');
        if (descContainer && descSpan) {
          descContainer.classList.remove('hidden');
          descContainer.style.display = 'block';
          descSpan.textContent = `Analyzing ${node.type}...`;
          
          fetch(`/api/system/filesystem/summary?path=${encodeURIComponent(node.path)}`)
            .then(r => r.json())
            .then(data => {
              if (data.summary) {
                descSpan.textContent = data.summary;
              } else {
                descSpan.textContent = 'No summary available.';
              }
            })
            .catch(err => {
              descSpan.textContent = 'Error loading summary.';
            });
        }
    };

    infoBtn.addEventListener('click', openOverviewFn);

    if (node.type === 'directory') {
      icon.textContent = '📁';
      label.style.fontWeight = 'bold';
      
      const childrenContainer = document.createElement('ul');
      childrenContainer.style.listStyle = 'none';
      childrenContainer.style.paddingLeft = '1.5rem';
      childrenContainer.style.margin = '0';
      childrenContainer.style.display = 'none'; // collapsed by default
      li.appendChild(childrenContainer);
      
      const toggleFn = (e) => {
        if (e) e.stopPropagation();
        const isHidden = childrenContainer.style.display === 'none';
        childrenContainer.style.display = isHidden ? 'block' : 'none';
        icon.textContent = isHidden ? '📂' : '📁';
      };
      
      wrapper.addEventListener('click', toggleFn);
      
      if (node.children) {
        node.children.forEach(child => this.renderFileTree(child, childrenContainer));
      }
    } else {
      icon.textContent = '📄';
      wrapper.addEventListener('click', openOverviewFn);
    }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  const boot = () => setTimeout(() => App.training.init(), 1000);
  if (typeof App.whenAuthenticated === 'function') {
    App.whenAuthenticated(boot);
  } else {
    boot();
  }
});
