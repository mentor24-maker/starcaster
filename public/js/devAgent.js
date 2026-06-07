'use strict';

window.App = window.App || {};
App.devAgent = App.devAgent || {};

// Capture core navigation before init() wraps setActivePage (team add flow must not trip dev loaders).
if (typeof App.setActivePage === 'function' && !App._baseSetActivePage) {
  App._baseSetActivePage = App.setActivePage;
}

/**
 * Add Dev Team member — opens Contacts add form; never calls openEditPage(null).
 * Defined at load time so inline onclick works even if later devAgent.init() fails.
 */
App.devAgent.openAddTeamMember = function openAddTeamMember() {
  const ctx = {
    returnPageId: 'devTeamPage',
    contactType: 'team-admin',
    contactClass: 'personnel',
  };
  App.devAgent.teamAddContext = ctx;
  if (typeof App.contacts?.armTeamMemberCreate === 'function') {
    App.contacts.armTeamMemberCreate(ctx);
  } else if (typeof App.contacts?.openAddPage === 'function') {
    App.contacts.openAddPage(ctx.returnPageId, ctx);
    return;
  }
  const form = document.getElementById('contactForm');
  if (form) form.reset();
  const go = App._baseSetActivePage || App.setActivePage;
  if (typeof go !== 'function') {
    App.notify('Navigation is not ready. Hard-refresh the page (Cmd+Shift+R).', true);
    return;
  }
  go.call(App, 'addContactPage');
};
window.__starcasterOpenAddTeamMember = App.devAgent.openAddTeamMember;

const devState = {
  activeSessionId: null,
  activeDevPage: null,
  sessions: [],
  stagedFiles: [],
  actionItemsState: [] // Dynamically populated
};

const devElements = {
  log: null,
  form: null,
  input: null,
  sessionList: null,
  taskList: null,
  actionItemsList: null,
  newSessionBtn: null,
  activeSessionTitle: null,
  fileInput: null,
  fileBtn: null,
  attachmentsContainer: null
};

App.devAgent.init = async function() {
  try {
    const cfgRes = await App.api('/api/develop/devAgent/config');
    if (cfgRes && cfgRes.data && cfgRes.data.url && cfgRes.data.anonKey && window.supabase) {
      window.supabaseClient = window.supabase.createClient(cfgRes.data.url, cfgRes.data.anonKey);
    }
  } catch(e) { console.error('Failed to load Supabase Realtime Config', e); }

  devElements.log = document.getElementById('devChatLog');
  devElements.form = document.getElementById('devChatForm');
  devElements.input = document.getElementById('devChatInput');
  devElements.sessionList = document.getElementById('devSessionList');
  devElements.taskList = document.getElementById('devTaskList');
  devElements.actionItemsList = document.getElementById('devActionItemsList');
  devElements.newSessionBtn = document.getElementById('devNewSessionBtn');
  devElements.activeSessionTitle = document.getElementById('devActiveSessionTitle');
  
  App.devAgent.loadActionItems();

  devElements.fileInput = document.getElementById('devChatFile');
  devElements.fileBtn = document.getElementById('devFileTriggerBtn');
  devElements.attachmentsContainer = document.getElementById('devChatAttachmentsContainer');

  if (devElements.fileBtn) {
    devElements.fileBtn.addEventListener('click', () => {
      if (devElements.fileInput) devElements.fileInput.click();
    });
  }

  if (devElements.previewClearBtn) {
    devElements.previewClearBtn.addEventListener('click', () => {
      App.devAgent.clearStagedFile();
    });
  }

  if (devElements.fileInput) {
    devElements.fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        alert("File too large. Max 5MB.");
        e.target.value = '';
        return;
      }
      
      const fileId = Date.now().toString() + Math.random().toString().substring(2, 6);
      const reader = new FileReader();
      reader.onload = (evt) => {
        devState.stagedFiles.push({
          id: fileId,
          name: file.name,
          mime: file.type,
          base64: evt.target.result
        });
        App.devAgent.renderStagedFiles();
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });
  }

  if (devElements.form) {
    devElements.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await App.devAgent.submitChat();
    });
    
    devElements.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        App.devAgent.submitChat();
      }
    });
  }

  const devCopySessionBtn = document.getElementById('devCopySessionBtn');
  if (devCopySessionBtn) {
    devCopySessionBtn.addEventListener('click', async () => {
      if (!devElements.log) return;
      const nodes = devElements.log.querySelectorAll('.dev-chat-bubble');
      let fullText = '';
      nodes.forEach(n => {
        const header = n.querySelector('.dev-chat-header strong');
        const author = header ? header.textContent : 'Unknown';
        const content = n.querySelector('.dev-chat-content');
        let text = content ? content.innerText : '';
        fullText += `[${author}]:\n${text}\n\n`;
      });
      try {
        await navigator.clipboard.writeText(fullText.trim());
        const svg = devCopySessionBtn.querySelector('svg');
        if (svg) {
          const originalNodes = Array.from(svg.childNodes);
          svg.textContent = '';
          const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          polyline.setAttribute('points', '20 6 9 17 4 12');
          polyline.setAttribute('fill', 'none');
          polyline.setAttribute('stroke', 'currentColor');
          polyline.setAttribute('stroke-width', '2');
          svg.appendChild(polyline);
          setTimeout(() => {
            svg.textContent = '';
            originalNodes.forEach(n => svg.appendChild(n));
          }, 2000);
        }
      } catch (err) {}
    });
  }

  const devSaveSessionBtn = document.getElementById('devSaveSessionBtn');
  if (devSaveSessionBtn) {
    devSaveSessionBtn.addEventListener('click', () => {
      if (!devElements.log) return;
      let sessionName = 'chat-session';
      if (devElements.activeSessionTitle && devElements.activeSessionTitle.textContent !== 'Loading Session...') {
        sessionName = devElements.activeSessionTitle.textContent.trim().replace(/[^a-z0-9_-]/gi, '_');
      }

      const nodes = devElements.log.querySelectorAll('.dev-chat-bubble');
      let fullText = `# ${devElements.activeSessionTitle.textContent}\n\n`;
      nodes.forEach(n => {
        const header = n.querySelector('.dev-chat-header strong');
        const author = header ? header.textContent : 'Unknown';
        const timeNode = n.querySelector('.chat-time');
        const timeStr = timeNode ? timeNode.textContent : '';
        const content = n.querySelector('.dev-chat-content');
        let text = content ? content.innerText : '';
        fullText += `### ${author} \`${timeStr}\`\n\n${text}\n\n---\n\n`;
      });
      
      try {
        const blob = new Blob([fullText.trim()], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${sessionName}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        const svg = devSaveSessionBtn.querySelector('svg');
        if (svg) {
          const originalNodes = Array.from(svg.childNodes);
          svg.textContent = '';
          const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          polyline.setAttribute('points', '20 6 9 17 4 12');
          polyline.setAttribute('fill', 'none');
          polyline.setAttribute('stroke', 'currentColor');
          polyline.setAttribute('stroke-width', '2');
          svg.appendChild(polyline);
          setTimeout(() => {
            svg.textContent = '';
            originalNodes.forEach(n => svg.appendChild(n));
          }, 2000);
        }
      } catch (err) {
        App.notify("Failed to save transcript: " + err, true);
      }
    });
  }

  if (devElements.newSessionBtn) {
    devElements.newSessionBtn.addEventListener('click', () => {
      const today = new Date().toISOString().split('T')[0];
      App.devAgent.createNewSession(`${today}_New_Discussion`);
    });
  }

  if (devElements.activeSessionTitle) {
    devElements.activeSessionTitle.addEventListener('click', () => {
      const titleEl = devElements.activeSessionTitle;
      if (titleEl.classList.contains('editing')) return;
      
      const session = devState.sessions.find(s => s.id === devState.activeSessionId);
      if (!session) return;
      
      const currentName = session.name;
      titleEl.textContent = '';
      const sessionInput = document.createElement('input');
      sessionInput.type = 'text';
      sessionInput.className = 'session-title-edit';
      sessionInput.value = currentName;
      titleEl.appendChild(sessionInput);
      titleEl.classList.add('editing');
      
      const input = titleEl.querySelector('input');
      input.focus();
      
      const commit = async () => {
        const newName = input.value.trim() || currentName;
        titleEl.classList.remove('editing');
        titleEl.textContent = newName;
        
        if (newName !== currentName) {
          session.name = newName;
          const li = devElements.sessionList.querySelector(`[data-session-id="${session.id}"]`);
          if (li) li.textContent = newName;
          
          try {
            await App.api('/api/develop/devAgent/sessions', {
              method: 'PATCH',
              body: JSON.stringify({ sessionId: session.id, name: newName })
            });
          } catch(err) {
            App.notify("Failed to rename session: " + err, true);
          }
        }
      };
      
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
      });
    });
  }

  const originalSetActivePage = App._baseSetActivePage || App.setActivePage;
  App._baseSetActivePage = originalSetActivePage;
  App.devAgent._setActivePageBase = originalSetActivePage;
  App.setActivePage = async function(pageId) {
    if (devState.activeDevPage && devState.activeDevPage !== pageId && devState.activeDevPage.startsWith('dev')) {
      App.devAgent.cleanup(devState.activeDevPage);
    }
    const prevPage = App.state.activePage;
    
    const isDevRoute = pageId.startsWith('dev');
    if (isDevRoute) {
      devState.activeDevPage = pageId;
    } else {
      devState.activeDevPage = null;
    }

    originalSetActivePage.apply(App, arguments);
    if (isDevRoute) {
      if (!window.supabaseClient) await App.devAgent.init();
    }
    
    // Skip panel resets if the page hasn't changed (e.g. clicking New Task while on Tasks page)
    if (prevPage === pageId) {
      if (pageId === 'devTeamPage') {
        await App.devAgent.ensureProjectContext();
        await App.devAgent.showTeamBrowser();
      }
      return;
    }
    
    try {
      if (pageId === 'devProjectsPage') {
        await App.devAgent.loadTasks(); // Keep sidebar loaded
        setTimeout(() => {
          App.devAgent.showProjectBrowser();
          App.devAgent.loadActionItems();
        }, 50);
      } else if (pageId === 'devTasksPage') {
        await App.devAgent.loadTasks();
        if (devState.skipNextBrowserReset) {
          devState.skipNextBrowserReset = false;
        } else {
          setTimeout(() => App.devAgent.showTaskBrowser(), 50);
        }
      } else if (pageId === 'devDashboardPage') {
        await App.devAgent.loadTasks();
        setTimeout(() => App.devAgent.loadDashboard(), 50);
        setTimeout(() => App.devAgent.loadActionItems(), 50);
        setTimeout(() => App.devAgent.loadGitStatus(), 50);
        setTimeout(() => App.devAgent.loadSessions(), 50);
        setTimeout(() => App.devAgent.loadTeam(), 50);
      } else if (pageId === 'devForumPage') {
        await App.devAgent.loadSessions();
        setTimeout(() => App.devAgent.restoreChatPanel(), 50);
      } else if (pageId === 'devTeamPage') {
        await App.devAgent.ensureProjectContext();
        await App.devAgent.loadTeam();
        await App.devAgent.showTeamBrowser();
      } else if (pageId === 'devRolesPage') {
        await App.devAgent.loadTeam();
        setTimeout(() => App.devAgent.showRolesBrowser(), 50);
      } else if (pageId === 'devFrictionPage') {
        if (App.devAgentFriction) await App.devAgentFriction.loadLogs();
        setTimeout(() => {
           const fricBrowser = document.getElementById('devFrictionBrowserPanel');
           const fricEditor = document.getElementById('devFrictionEditorPanel');
           if (fricBrowser) fricBrowser.classList.remove('hidden');
           if (fricEditor) fricEditor.classList.add('hidden');
        }, 50);
      }
    } catch (err) {
      console.error(`Error loading dev page ${pageId}:`, err);
      App.devAgent.renderErrorState(pageId, err);
    }
  };

  App.devAgent.renderErrorState = function(containerId, err, isInline = false) {
    const el = document.getElementById(containerId);
    if (!el) return;
    
    const message = err.message || err.toString() || 'Unknown error occurred.';
    if (isInline) {
      const li = document.createElement('li');
      li.className = 'error-msg';
      li.style.padding = '1rem';
      li.style.color = '#dc2626';
      li.textContent = `Failed to load: ${message}`;
      el.textContent = '';
      el.appendChild(li);
    } else {
      const parser = new DOMParser();
      const safeHtml = `
        <div class="page-heading-row"><h2>Error Loading Section</h2></div>
        <div style="padding: 2rem; border-radius: var(--radius-md); border: 1px solid var(--accent-warning); background: rgba(245, 158, 11, 0.05); margin: 1rem;">
          <h3 style="color: var(--accent-warning); margin-top: 0; display: flex; align-items: center; gap: 0.5rem;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            Error Details
          </h3>
          <p style="color: var(--text-color-secondary);"></p>
        </div>
      `;
      const doc = parser.parseFromString(safeHtml, 'text/html');
      doc.body.querySelector('p').textContent = message;
      el.textContent = '';
      Array.from(doc.body.childNodes).forEach(n => el.appendChild(n.cloneNode(true)));
    }
  };

  App.devAgent.cleanup = function(pageId) {
    if (pageId === 'devForumPage') {
      if (window.supabaseRealtimeDevChannel) {
        window.supabaseClient.removeChannel(window.supabaseRealtimeDevChannel);
        window.supabaseRealtimeDevChannel = null;
      }
    } else if (pageId === 'devProjectsPage') {
      const el = document.getElementById('devProjectBrowserTable');
      if (el) el.textContent = '';
      if (App.devAgent.closeProjectEditor) App.devAgent.closeProjectEditor();
    } else if (pageId === 'devTasksPage') {
      const el = document.getElementById('devTaskBrowserTable');
      if (el) el.textContent = '';
      if (App.devAgent.closeTaskEditor) App.devAgent.closeTaskEditor();
    } else if (pageId === 'devTeamPage') {
      const el = document.getElementById('devTeamBrowserTable');
      if (el) el.textContent = '';
    } else if (pageId === 'devRolesPage') {
      const el = document.getElementById('devRolesBrowserTable');
      if (el) el.textContent = '';
    }
    
    if (devElements.activeSessionTitle && devElements.activeSessionTitle.classList.contains('editing')) {
       devElements.activeSessionTitle.classList.remove('editing');
    }
  };
};


App.devAgent.loadGitStatus = async function() {
  const container = document.getElementById('devGitStatusContainer');
  if (!container) return;
  
  container.textContent = '';
  const loadingDiv = document.createElement('div');
  loadingDiv.style.color = '#666';
  loadingDiv.style.fontStyle = 'italic';
  loadingDiv.textContent = 'Loading git metrics...';
  container.appendChild(loadingDiv);
  
  try {
    const res = await fetch('/api/develop/devAgent/git-status');
    if (!res.ok) throw new Error('Network response was not ok');
    const data = await res.json();
    
    if (data.ok && data.data) {
      const d = data.data;
      
      const unpushedColor = d.unpushedCommits > 0 ? '#b45309' : '#15803d'; // orange/green
      const uncommittedColor = d.uncommittedFiles > 0 ? '#dc2626' : '#15803d'; // red/green
      
      // Format dates nicely
      const formatDate = (dateStr) => {
        if (!dateStr || dateStr.includes('No origin')) return 'None';
        try {
          const dt = new Date(dateStr);
          return dt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch(e) { return dateStr; }
      };
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(`
        <div style="display: flex; justify-content: space-between; padding-bottom: 0.25rem; border-bottom: 1px solid rgba(0,0,0,0.05);">
          <span style="color: #555; font-weight: 500;">Branch:</span>
          <span style="font-family: monospace; background: #e2e8f0; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.8rem;" class="branch-val"></span>
        </div>
        <div style="display: flex; justify-content: space-between; padding-bottom: 0.25rem; border-bottom: 1px solid rgba(0,0,0,0.05);">
          <span style="color: #555; font-weight: 500;">Last Commit:</span>
          <span style="font-size: 0.85rem;" class="commit-val"></span>
        </div>
        <div style="display: flex; justify-content: space-between; padding-bottom: 0.25rem; border-bottom: 1px solid rgba(0,0,0,0.05);">
          <span style="color: #555; font-weight: 500;">Last Push:</span>
          <span style="font-size: 0.85rem;" class="push-val"></span>
        </div>
        <div style="display: flex; justify-content: space-between; padding-bottom: 0.25rem; border-bottom: 1px solid rgba(0,0,0,0.05);">
          <span style="color: #555; font-weight: 500;">Unpushed Commits:</span>
          <span style="font-weight: bold;" class="unpushed-val"></span>
        </div>
        <div style="display: flex; justify-content: space-between; padding-bottom: 0.25rem; border-bottom: 1px solid rgba(0,0,0,0.05);">
          <span style="color: #555; font-weight: 500;">Uncommitted Files:</span>
          <span style="font-weight: bold;" class="uncommitted-val"></span>
        </div>
      `, 'text/html');
      doc.body.querySelector('.branch-val').textContent = String(d.currentBranch);
      doc.body.querySelector('.commit-val').textContent = formatDate(d.lastCommitDate);
      doc.body.querySelector('.push-val').textContent = formatDate(d.lastPushDate);
      doc.body.querySelector('.unpushed-val').textContent = String(d.unpushedCommits);
      doc.body.querySelector('.unpushed-val').style.color = unpushedColor;
      doc.body.querySelector('.uncommitted-val').textContent = String(d.uncommittedFiles);
      doc.body.querySelector('.uncommitted-val').style.color = uncommittedColor;
      
      container.textContent = '';
      Array.from(doc.body.childNodes).forEach(n => container.appendChild(n.cloneNode(true)));
    } else {
      throw new Error(data.error || 'Unknown error');
    }
  } catch (err) {
    console.error('Failed to load git status:', err);
    container.textContent = '';
    const errDiv = document.createElement('div');
    errDiv.style.color = '#dc2626';
    errDiv.textContent = `Failed to load metrics: ${err.message}`;
    container.appendChild(errDiv);
  }
};

App.devAgent.loadActionItems = async function() {
  if (!devElements.actionItemsList) return;
  if (!window.supabaseClient) return;
  
  try {
    const res = await window.supabaseClient
      .from('dev_tasks')
      .select('*')
      .or('status.eq.review,assignee.eq.mentor')
      .neq('status', 'completed')
      .order('created_at', { ascending: false });

    if (res.error) throw res.error;
    
    devState.actionItemsState = res.data || [];
  } catch (err) {
    console.error('Failed to load action items', err);
    devElements.actionItemsList.textContent = '';
    const errLi = document.createElement('li');
    errLi.className = 'dev-session-item error-msg';
    errLi.textContent = 'Failed to load actions.';
    devElements.actionItemsList.appendChild(errLi);
    return;
  }
  
  const pendingItems = devState.actionItemsState;
  
  if (pendingItems.length === 0) {
    devElements.actionItemsList.textContent = '';
    const noneLi = document.createElement('li');
    noneLi.className = 'dev-session-item';
    noneLi.style.color = '#666';
    noneLi.style.fontStyle = 'italic';
    noneLi.textContent = 'No pending actions.';
    devElements.actionItemsList.appendChild(noneLi);
    return;
  }
  
  devElements.actionItemsList.textContent = '';
  
  pendingItems.forEach(item => {
    const li = document.createElement('li');
    li.className = 'dev-session-item';
    li.style.whiteSpace = 'nowrap';
    li.style.overflow = 'hidden';
    li.style.textOverflow = 'ellipsis';
    li.style.display = 'block';
    li.style.cursor = 'pointer';
    
    let typeLabel = item.status === 'review' ? 'Review Requested' : 'Task Assigned';
    let displayTitle = item.title ? item.title : typeLabel;
    
    li.title = displayTitle; // Add hover text
    li.textContent = '';
    const bulletSpan = document.createElement('span');
    bulletSpan.style.color = 'var(--accent-warning)';
    bulletSpan.style.fontWeight = 'bold';
    bulletSpan.style.marginRight = '4px';
    bulletSpan.textContent = '•';
    li.appendChild(bulletSpan);
    li.appendChild(document.createTextNode(displayTitle));
    
    li.addEventListener('click', () => {
      if (App.devAgent.openTaskEditor) {
        App.devAgent.openTaskEditor(item.id);
      }
    });
    
    devElements.actionItemsList.appendChild(li);
  });
};

App.devAgent.loadTasks = async function(projectId = null) {
  if (!devElements.taskList) return;
  if (!window.supabaseClient) {
    devElements.taskList.innerHTML = '<li class="dev-session-item" style="color:#dc2626; font-style:italic;">Supabase Client Not Initialized.</li>';
    return;
  }
  try {
    devElements.taskList.textContent = '';
    const loadLi = document.createElement('li');
    loadLi.style.padding = '1rem';
    loadLi.style.opacity = '0.7';
    loadLi.textContent = 'Loading...';
    devElements.taskList.appendChild(loadLi);
    
    let query = window.supabaseClient
      .from('dev_tasks')
      .select('*')
      .neq('status', 'completed');
      
    if (projectId) {
      query = query.eq('project_id', projectId);
    }
    
    const res = await query.order('created_at', { ascending: false });
      
    devElements.taskList.textContent = '';
    
    if (res.error) {
      devElements.taskList.textContent = '';
      const errLi2 = document.createElement('li');
      errLi2.className = 'error-msg';
      errLi2.textContent = 'Failed to load tasks';
      devElements.taskList.appendChild(errLi2);
      return;
    }
    
    const tasks = res.data || [];
    devState.tasks = tasks;
    
    if (tasks.length === 0) {
      devElements.taskList.textContent = '';
      const noTasksLi = document.createElement('li');
      noTasksLi.className = 'dev-session-item';
      noTasksLi.style.color = '#666';
      noTasksLi.style.fontStyle = 'italic';
      noTasksLi.textContent = 'No active tasks.';
      devElements.taskList.appendChild(noTasksLi);
      return;
    }

    tasks.forEach(task => {
      const li = document.createElement('li');
      li.className = 'dev-session-item';
      li.dataset.taskId = task.id;
      const taskTitle = task.title || 'Untitled';
      const shortTitle = taskTitle.length > 25 ? taskTitle.substring(0,25) + '...' : taskTitle;
      
      const statusColors = {
        backlog: '#9ca3af',
        todo: '#3b82f6',
        in_progress: '#f59e0b',
        review: '#8b5cf6',
        completed: '#10b981'
      };
      const badgeColor = statusColors[task.status] || '#9ca3af';
      const statusLabel = (task.status || 'unknown').replace('_', ' ').toUpperCase();

      let timerNode = null;
      if (task.timer_active && task.estimated_completion_time) {
        const now = new Date();
        const est = new Date(task.estimated_completion_time);
        const diffMs = est - now;
        timerNode = document.createElement('span');
        timerNode.style.fontSize = '0.6rem';
        timerNode.style.marginRight = '4px';
        timerNode.style.padding = '0.15rem 0.4rem';
        timerNode.style.borderRadius = '10px';
        timerNode.style.whiteSpace = 'nowrap';
        
        if (diffMs > 0) {
          const diffMins = Math.ceil(diffMs / 60000);
          timerNode.style.background = '#1f2937';
          timerNode.style.color = '#f3f4f6';
          timerNode.style.border = '1px solid #374151';
          timerNode.title = 'Time until agent evaluation';
          timerNode.textContent = `⏱ ${diffMins}m`;
        } else {
          timerNode.style.background = '#7f1d1d';
          timerNode.style.color = '#fca5a5';
          timerNode.style.border = '1px solid #991b1b';
          timerNode.textContent = '⏱ Expired';
        }
      }

      const parser = new DOMParser();
      const htmlStr = `
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding-right: 0.5rem; margin-bottom: 2px;">
          <span style="flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" class="task-title-span">
            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px;" class="task-badge-span"></span> <span class="task-short-title-span"></span>
          </span>
          <div style="display:flex; align-items:center;" class="task-status-container">
            <span class="status-label-span" style="font-size:0.6rem; padding:0.15rem 0.4rem; border-radius:10px; white-space:nowrap; font-weight:600;"></span>
          </div>
        </div>
      `;
      const doc = parser.parseFromString(htmlStr, 'text/html');
      const titleSpan = doc.body.querySelector('.task-title-span');
      titleSpan.title = taskTitle;
      doc.body.querySelector('.task-badge-span').style.background = badgeColor;
      doc.body.querySelector('.task-short-title-span').textContent = shortTitle;
      
      const statusLabelSpan = doc.body.querySelector('.status-label-span');
      statusLabelSpan.style.background = badgeColor + '22';
      statusLabelSpan.style.color = badgeColor;
      statusLabelSpan.style.border = '1px solid ' + badgeColor + '44';
      statusLabelSpan.textContent = statusLabel;
      
      if (timerNode) {
        doc.body.querySelector('.task-status-container').insertBefore(timerNode, statusLabelSpan);
      }
      
      li.textContent = '';
      Array.from(doc.body.childNodes).forEach(n => li.appendChild(n.cloneNode(true)));
      li.addEventListener('click', () => {
        App.devAgent.openTaskEditor(task.id);
      });
      devElements.taskList.appendChild(li);
    });
    
    // Also refresh the dashboard if it's rendered
    if (typeof App.devAgent.loadDashboard === 'function') {
      App.devAgent.loadDashboard();
    }
  } catch (err) {
    console.error('loadTasks failed:', err); 
    if (devElements.taskList) {
       devElements.taskList.textContent = '';
       const listErr = document.createElement('li');
       listErr.className = 'error-msg';
       listErr.style.color = '#dc2626';
       listErr.textContent = err.message;
       devElements.taskList.appendChild(listErr);
    }
  }
};

App.devAgent.loadSessions = async function() { 
  App.devAgent.loadAllMessages();
  const accordionContainer = document.getElementById('devThreadsAccordionContainer');
  const dashboardList = document.getElementById('devSessionList');
  
  if (!accordionContainer && !dashboardList) return;
  
  try {
    if (dashboardList) {
      dashboardList.textContent = '';
      const loadLi = document.createElement('li');
      loadLi.style.padding = '1rem';
      loadLi.style.opacity = '0.7';
      loadLi.textContent = 'Loading...';
      dashboardList.appendChild(loadLi);
    }
    if (accordionContainer) {
      accordionContainer.textContent = '';
      const loadDiv = document.createElement('div');
      loadDiv.style.padding = '1rem';
      loadDiv.style.textAlign = 'center';
      loadDiv.style.color = '#666';
      loadDiv.style.fontStyle = 'italic';
      loadDiv.textContent = 'Loading threads...';
      accordionContainer.appendChild(loadDiv);
    }
    
    const res = await App.api('/api/develop/devAgent/sessions');
    
    if (dashboardList) dashboardList.textContent = '';
    if (accordionContainer) accordionContainer.textContent = '';
    
    if (res.error) {
      if (dashboardList) {
        dashboardList.textContent = '';
        const errLi = document.createElement('li');
        errLi.className = 'error-msg';
        errLi.textContent = 'Failed to load';
        dashboardList.appendChild(errLi);
      }
      if (accordionContainer) {
        accordionContainer.textContent = '';
        const errDiv = document.createElement('div');
        errDiv.className = 'error-msg';
        errDiv.textContent = 'Failed to load';
        accordionContainer.appendChild(errDiv);
      }
      return;
    }
    
    devState.sessions = res.sessions || res.data || [];
    
    if (devState.sessions.length === 0) {
      if (dashboardList) {
        dashboardList.textContent = '';
        const noLi = document.createElement('li');
        noLi.className = 'dev-session-item';
        noLi.style.color = '#666';
        noLi.style.fontStyle = 'italic';
        noLi.textContent = 'No active discussions.';
        dashboardList.appendChild(noLi);
      }
      if (accordionContainer) {
        accordionContainer.textContent = '';
        const noDiv = document.createElement('div');
        noDiv.style.color = '#666';
        noDiv.style.fontStyle = 'italic';
        noDiv.style.textAlign = 'center';
        noDiv.textContent = 'No active discussions.';
        accordionContainer.appendChild(noDiv);
      }
      return;
    }

    // Sort by id descending (newest first)
    devState.sessions.sort((a, b) => b.id - a.id);

    // Render Dashboard List (Top 10)
    if (dashboardList) {
      devState.sessions.slice(0, 10).forEach(session => {
        const li = document.createElement('li');
        li.className = 'dev-session-item';
        li.dataset.sessionId = session.id;
        li.textContent = '';
        const titleDiv = document.createElement('div');
        titleDiv.className = 'dev-session-item-title';
        titleDiv.textContent = session.name || 'Untitled Thread';
        li.appendChild(titleDiv);
        li.addEventListener('click', () => {
          if (App.setActivePage) App.setActivePage('devForumPage');
          App.devAgent.expandThreadAccordion(session.id);
        });
        dashboardList.appendChild(li);
      });
    }

    // Render Forum Accordions
    if (accordionContainer) {
      devState.sessions.forEach(session => {
        const accordion = App.devAgent.createThreadAccordion(session);
        accordionContainer.appendChild(accordion);
      });
      
      // Auto-expand the active session if one exists
      if (devState.activeSessionId) {
        App.devAgent.expandThreadAccordion(devState.activeSessionId);
      }
    }
    
    // Also load pending action items
    App.devAgent.loadPendingCommands();
  } catch (err) {
    if (dashboardList) App.devAgent.renderErrorState('devDashboardForumList', err, true);
    if (accordionContainer) App.devAgent.renderErrorState('devSessionList', err, true);
  }
};

App.devAgent.createThreadAccordion = function(session) {
  const container = document.createElement('div');
  container.className = 'dev-thread-accordion';
  container.dataset.sessionId = session.id;
  container.style.border = '1px solid var(--border-light)';
  container.style.borderRadius = '8px';
  container.style.background = 'var(--bg-card)';
  container.style.overflow = 'hidden';
  container.style.flexShrink = '0';

  const header = document.createElement('div');
  header.className = 'dev-thread-accordion-header';
  header.style.padding = '1rem';
  header.style.cursor = 'pointer';
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.background = 'var(--bg-input)';
  header.textContent = '';
  const h3 = document.createElement('h3');
  h3.style.margin = '0';
  h3.style.fontSize = '1.05rem';
  h3.textContent = session.name;
  const icon = document.createElement('span');
  icon.className = 'dev-accordion-icon';
  icon.textContent = '▼';
  header.appendChild(h3);
  header.appendChild(icon);
  
  const body = document.createElement('div');
  body.className = 'dev-thread-accordion-body hidden';
  body.style.padding = '1rem';
  body.style.borderTop = '1px solid var(--border-light)';
  
  header.addEventListener('click', () => {
    if (body.classList.contains('hidden')) {
      App.devAgent.expandThreadAccordion(session.id);
    } else {
      App.devAgent.collapseThreadAccordion(session.id);
    }
  });

  container.appendChild(header);
  container.appendChild(body);
  return container;
};

App.devAgent.expandThreadAccordion = function(sessionId) {
  devState.activeSessionId = sessionId;
  
  const container = document.getElementById('devThreadsAccordionContainer');
  if (!container) return;
  
  const accordions = container.querySelectorAll('.dev-thread-accordion');
  accordions.forEach(acc => {
    const body = acc.querySelector('.dev-thread-accordion-body');
    const icon = acc.querySelector('.dev-accordion-icon');
    if (Number(acc.dataset.sessionId) === sessionId) {
      body.classList.remove('hidden');
      icon.textContent = '▲';
      
      // Load history into this accordion if it's not already loaded
      if (!body.querySelector('.dev-chat-log')) {
        body.textContent = '';
        const chatLog = document.createElement('div');
        chatLog.className = 'dev-chat-log';
        chatLog.style.maxHeight = '400px';
        chatLog.style.overflowY = 'auto';
        body.appendChild(chatLog);
        
        // Clone chat form template
        const template = document.getElementById('devChatFormTemplate');
        if (template) {
          const formClone = template.content.cloneNode(true);
          body.appendChild(formClone);
          
          // Bind form submit event
          const form = body.querySelector('.dev-inline-chat-form');
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            App.devAgent.submitChat(form);
          });
          
          // Bind file trigger
          const fileTrigger = form.querySelector('.dev-file-trigger-btn');
          const fileInput = form.querySelector('.dev-chat-file');
          if (fileTrigger && fileInput) {
             fileTrigger.addEventListener('click', () => fileInput.click());
             fileInput.addEventListener('change', (e) => {
                if (App.devAgent.handleFileSelect) {
                    App.devAgent.handleFileSelect(e, form);
                }
             });
          }
        }
        
        App.devAgent.loadHistory(sessionId, body.querySelector('.dev-chat-log'));
      }
      
      // Focus the input
      const chatInput = body.querySelector('.dev-chat-input');
      if (chatInput) {
        setTimeout(() => chatInput.focus(), 100);
      }
    } else {
      body.classList.add('hidden');
      icon.textContent = '▼';
    }
  });
};

App.devAgent.collapseThreadAccordion = function(sessionId) {
  const container = document.getElementById('devThreadsAccordionContainer');
  if (!container) return;
  const acc = container.querySelector(`.dev-thread-accordion[data-session-id="${sessionId}"]`);
  if (acc) {
    acc.querySelector('.dev-thread-accordion-body').classList.add('hidden');
    acc.querySelector('.dev-accordion-icon').textContent = '▼';
  }
  if (devState.activeSessionId === sessionId) {
    devState.activeSessionId = null;
  }
};

App.devAgent.loadPendingCommands = async function() {
  const listEl = document.getElementById('devActionItemsList');
  if (!listEl) return;
  
  try {
    const res = await App.api('/api/develop/devAgent/pendingCommands');
    
    await App.devAgent.loadActionItems(); // This clears and rebuilds the basic action items
    
    if (res.error) {
      console.error('Failed to load pending commands', res.error);
      return;
    }
    
    const commands = res.commands || res.data || [];
    
    if (commands.length === 0) {
      return;
    }
    
    // Remove the "No pending actions" item if loadActionItems inserted it and we have commands to add
    const pendingItems = devState.actionItemsState;
    if (pendingItems.length === 0) {
      listEl.textContent = '';
    }
    
    commands.forEach(cmdObj => {
      const li = document.createElement('li');
      li.className = 'dev-session-item';
      li.style.whiteSpace = 'nowrap';
      li.style.overflow = 'hidden';
      li.style.textOverflow = 'ellipsis';
      li.style.display = 'block';
      li.style.cursor = 'pointer';
      
      const parsed = cmdObj.parsed;
      let taskId = parsed.state?.active_objective_id;
      
      const applyTitle = (tName) => {
        let finalTitle = "Approval Required";
        if (tName) finalTitle += `: ${tName}`;
        li.textContent = '';
        const bulletSpan = document.createElement('span');
        bulletSpan.style.color = 'var(--accent-warning)';
        bulletSpan.style.fontWeight = 'bold';
        bulletSpan.style.marginRight = '4px';
        bulletSpan.textContent = '•';
        li.appendChild(bulletSpan);
        li.appendChild(document.createTextNode(finalTitle));
        li.title = finalTitle;
      };
      
      applyTitle(); // Initial render
      
      if (taskId && taskId.length > 20) {
        if (devState.tasks && devState.tasks.length > 0) {
          const t = devState.tasks.find(x => x.id === taskId);
          if (t) applyTitle(t.title);
          else {
            window.supabaseClient.from('dev_tasks').select('title').eq('id', taskId).single()
              .then(res => { if (res.data) applyTitle(res.data.title); else applyTitle(taskId.substring(0,8) + '...'); })
              .catch(() => applyTitle(taskId.substring(0,8) + '...'));
          }
        } else {
          window.supabaseClient.from('dev_tasks').select('title').eq('id', taskId).single()
            .then(res => { if (res.data) applyTitle(res.data.title); else applyTitle(taskId.substring(0,8) + '...'); })
            .catch(() => applyTitle(taskId.substring(0,8) + '...'));
        }
      } else if (taskId) {
        applyTitle(taskId);
      }
      
      li.addEventListener('click', (e) => {
        if (App.setActivePage) App.setActivePage('devForumPage');
        if (App.devAgent && App.devAgent.selectSession && cmdObj.chat && cmdObj.chat.session_id) {
          App.devAgent.selectSession(cmdObj.chat.session_id);
        }
      });
      
      listEl.appendChild(li);
    });
    
  } catch(err) {
    listEl.textContent = '';
    const errLi = document.createElement('li');
    errLi.className = 'error-msg';
    errLi.style.fontSize = '0.8rem';
    errLi.textContent = 'Error loading actions';
    listEl.appendChild(errLi);
  }
};

App.devAgent.createNewSession = async function(name = 'New Discussion') {
  try {
    const res = await App.api('/api/develop/devAgent/sessions', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    const sessionData = res.session || res.data;
    if (sessionData) {
      devState.activeSessionId = sessionData.id;
      App.devAgent.loadSessions();
    }
  } catch (e) {
    alert("Could not create session: " + e.message);
  }
};

App.devAgent.appendSessionNode = function(session) {
  if (!devElements.sessionList) return;
  const li = document.createElement('li');
  li.className = 'dev-session-item';
  li.dataset.sessionId = session.id;
  li.textContent = session.name;
  if (session.id === devState.activeSessionId) {
    li.classList.add('active');
  }
  
  li.addEventListener('click', () => {
    App.devAgent.selectSession(session.id);
  });
  
  devElements.sessionList.appendChild(li);
};

App.devAgent.selectSession = function(sessionId, isFromTaskEditor = false) {
  devState.activeSessionId = sessionId;
  
  // If we are not opening this session from the task editor, switch to forum page and expand
  if (!isFromTaskEditor) {
    App.devAgent.restoreChatPanel();
    App.devAgent.expandThreadAccordion(sessionId);
  }
  
  // Highlighting dashboard list if available
  if (devElements.sessionList) {
    const items = devElements.sessionList.querySelectorAll('.dev-session-item');
    items.forEach(el => {
      if (Number(el.dataset.sessionId) === sessionId) el.classList.add('active');
      else el.classList.remove('active');
    });
  }
  
  App.devAgent.initSupabaseRealtime(sessionId);
};

App.devAgent.toggleTaskLinkDropdown = async function() {
  const select = document.getElementById('devThreadTaskLinkSelect');
  if (!select) return;
  
  if (select.classList.contains('hidden')) {
    // Populate dropdown
    select.textContent = '';
    select.appendChild(new Option('Select Task...', ''));
    if (devState.tasks && devState.tasks.length > 0) {
      devState.tasks.forEach(task => {
        const opt = document.createElement('option');
        opt.value = task.id;
        opt.textContent = task.title;
        select.appendChild(opt);
      });
    } else {
       const opt = document.createElement('option');
       opt.value = "";
       opt.textContent = "No tasks available";
       select.appendChild(opt);
    }
    select.classList.remove('hidden');
  } else {
    select.classList.add('hidden');
  }
};

App.devAgent.linkThreadToSelectedTask = async function(taskId) {
  if (!taskId || !devState.activeSessionId) return;
  
  try {
    const { error } = await window.supabaseClient.from('dev_tasks')
      .update({ session_id: devState.activeSessionId })
      .eq('id', taskId);
      
    if (error) throw error;
    
    App.notify('Thread linked to task successfully.', false);
    App.devAgent.loadTasks(); // refresh task list to show linked session
    
    document.getElementById('devThreadTaskLinkSelect').classList.add('hidden');
    document.getElementById('devThreadTaskLinkSelect').value = '';
  } catch (err) {
    App.notify('Failed to link thread: ' + err.message, true);
  }
};

App.devAgent.loadHistory = async function(sessionId, customLogContainer = null) {
  const targetLog = customLogContainer || devElements.log;
  if (!targetLog || !sessionId) return;
  try {
    targetLog.textContent = '';
    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    spinner.textContent = 'Loading chat history...';
    targetLog.appendChild(spinner);
    if (devElements.input) devElements.input.disabled = true;
    const res = await App.api(`/api/develop/devAgent/history?sessionId=${sessionId}&limit=1000&_t=${Date.now()}`);
    targetLog.textContent = '';
    if (devElements.input) devElements.input.disabled = false;
    
    if (res.error) {
      console.error('[devAgent] loadHistory API error:', res.error);
      targetLog.textContent = '';
      const errDiv = document.createElement('div');
      errDiv.className = 'error-msg';
      errDiv.textContent = `Could not load chats: ${res.error.message || res.error}`;
      targetLog.appendChild(errDiv);
      return;
    }
    
    const chats = res.chats || res.data || [];
    console.log(`[devAgent] loadHistory sessionId=${sessionId} returned ${chats.length} chats`);
    
    // Sniff historical sync arrays for `OBJ-002.2` compliance
    let maxVersion = 0;
    chats.forEach(chat => {
      const p = App.devAgent.parseTriAgent(chat.content);
      if (p && p.valid && p.data && p.data.state && p.data.state.state_version_id) {
         maxVersion = Math.max(maxVersion, Number(p.data.state.state_version_id));
      }
    });
    devState.localVersionId = Math.max(devState.localVersionId || 0, maxVersion);

    if (chats.length === 0) {
      targetLog.textContent = '';
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'dev-chat-item dev-chat-system';
      emptyDiv.style.opacity = '0.5';
      emptyDiv.textContent = 'No message history.';
      targetLog.appendChild(emptyDiv);
    } else {
      App.devAgent.activePendingCommand = null;
      chats.forEach(chat => {
        // Find if we are rendering into a specific accordion body
        App.devAgent.appendChatNode(chat, targetLog);
        
        // Track functional command resolutions
        const p = App.devAgent.parseTriAgent(chat.content);
        if (p && p.valid && p.data && p.data.payload) {
          if (p.data.payload.type === 'COMMAND' && chat.role === 'model') {
             App.devAgent.activePendingCommand = {
               hash: p.data.state.context_checksum,
               content: p.data.payload.content,
               version: p.data.state.state_version_id
             };
          } else if (p.data.payload.type === 'COMMAND' && chat.role === 'user') {
             try {
               const confObj = JSON.parse(p.data.payload.content);
               if (App.devAgent.activePendingCommand && confObj.commandhash === App.devAgent.activePendingCommand.hash) {
                 App.devAgent.activePendingCommand = null;
               }
             } catch(e) {}
          }
        }
      });
      setTimeout(() => {
        App.devAgent.scrollToBottom();
      }, 50);
      App.devAgent.generateGlossary();
    }
    
    // Evaluate constraints natively post-load
    App.devAgent.renderActiveCommand();
  } catch (err) {
    if(targetLog) {
      targetLog.textContent = '';
      const errDiv = document.createElement('div');
      errDiv.className = 'error-msg';
      errDiv.textContent = `Failed to load history. Error: ${err.message}`;
      const br = document.createElement('br');
      const pre = document.createElement('pre');
      pre.textContent = err.stack;
      errDiv.appendChild(br);
      errDiv.appendChild(pre);
      targetLog.appendChild(errDiv);
    }
    if (devElements.input) devElements.input.disabled = false;
  }
};

App.devAgent.formatMarkdown = function(text) {
  if (!text) return '';
  if (typeof text === 'object') {
    text = "```json\n" + JSON.stringify(text, null, 2) + "\n```";
  }
  
  // 1. Extract code blocks and replace with placeholders
  let chunks = [];
  let html = String(text).replace(/```(?:[a-z0-9]*)?\n([\s\S]*?)```/gi, (match, rawCodeBlock) => {
    let unescapedCodeBlock = rawCodeBlock.replace(/^>\s?/gm, '');
    let index = chunks.length;
    chunks.push(unescapedCodeBlock);
    return `@@@CODEBLOCK${index}@@@`;
  });

  // 2. Escape all remaining text globally (user text outside codeblocks)
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 3. Process markdown formatting for bold, emphasis, inline code, and block quotes
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
  html = html.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
  // 3.5 Process markdown links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    if (url.startsWith('#dev-task-')) {
      const taskId = url.replace('#dev-task-', '');
      return `<a href="${url}" onclick="App.devAgent.openTaskEditor('${taskId}'); return false;">${text}</a>`;
    }
    return `<a href="${url}" target="_blank">${text}</a>`;
  });
  
  // 4. Replace linebreaks outside of blocks
  html = html.replace(/\n/g, '<br/>');

  // 4.5 Bind State Version anchors to allow interactive routing
  const versionRegex = /\b(?:(?:state_?)?version_?id|version|commandhash)(?:\\n|\s|<br\s*\/?>|"|'|&quot;)*:(?:\\n|\s|<br\s*\/?>|"|'|&quot;)*([\w\d]+)/gi;
  html = html.replace(versionRegex, '<a href="#devChatVersion_$1" class="dev-version-link" onclick="App.devAgent.scrollToVersion(\'$1\'); return false;">$&</a>');

  // 5. Restore code blocks, but now we format them properly with our UI wrapper
  html = html.replace(/@@@CODEBLOCK(\d+)@@@/g, (match, i) => {
    const codeBlock = chunks[parseInt(i)];
    let filename = 'code.txt';
    const lines = codeBlock.split('\n');
    for (const line of lines) {
      const matchFile = line.match(/\/\/\s*FILE:\s*([^\s]+)/i) || line.match(/\/\/\s*TARGET FILE:\s*([^\s]+)/i);
      if (matchFile) {
        filename = matchFile[1].trim();
        break;
      }
    }
    const encoded = btoa(unescape(encodeURIComponent(codeBlock)));
    let escapedCode = codeBlock
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
      
    // Apply Version binding to text within code blocks 
    escapedCode = escapedCode.replace(versionRegex, '<a href="#devChatVersion_$1" class="dev-version-link" onclick="App.devAgent.scrollToVersion($1); return false;">$&</a>');

    return `<div class="code-block-wrapper" style="margin: 0.5rem 0; display: flex; flex-direction: column; border-radius: var(--radius-md); overflow: hidden; border: 1px solid var(--border-light);">
      <div class="dev-code-header" style="display: flex; justify-content: space-between; align-items: center; background: #2d2d2d; padding: 0.25rem 0.5rem; color: #a0a0a0; font-size: 0.8rem; border-bottom: 1px solid #111;">
        <span style="font-family: monospace;">${filename}</span>
        <div class="dev-code-actions">
          <button class="dev-copy-btn" title="Copy Code" data-content="${encoded}" onclick="App.devAgent.copyCodeBlock(this)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
            </svg>
          </button>
          <button class="dev-code-save-btn" title="Save File" data-filename="${filename}" data-content="${encoded}" onclick="App.devAgent.saveCodeBlock(this)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
              <polyline points="17 21 17 13 7 13 7 21"></polyline>
              <polyline points="7 3 7 8 15 8"></polyline>
            </svg>
          </button>
        </div>
      </div>
      <pre style="margin:0; border-radius: 0;"><code>${escapedCode}</code></pre>
    </div>`;
  });

  return html;
};

App.devAgent.copyCodeBlock = async function(btn) {
  const encoded = btn.getAttribute('data-content');
  if (!encoded) return;
  
  try {
    const rawCodeBlock = decodeURIComponent(escape(atob(encoded)));
    await navigator.clipboard.writeText(rawCodeBlock);
    
    // Provide a visual checkmark feedback
    const svg = btn.querySelector('svg');
    if (svg) {
      const originalNodes = Array.from(svg.childNodes);
      svg.textContent = '';
      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      polyline.setAttribute('points', '20 6 9 17 4 12');
      svg.appendChild(polyline);
      setTimeout(() => {
        svg.textContent = '';
        originalNodes.forEach(n => svg.appendChild(n));
      }, 2000);
    }
  } catch(e) {
    console.error("Failed to decode and copy code block:", e);
  }
};

App.devAgent.saveCodeBlock = function(btn) {
  const filename = btn.getAttribute('data-filename') || 'code.txt';
  const encoded = btn.getAttribute('data-content');
  if (!encoded) return;
  
  try {
    const rawCodeBlock = decodeURIComponent(escape(atob(encoded)));
    const blob = new Blob([rawCodeBlock], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch(e) {
    console.error("Failed to decode and save file:", e);
    alert("Could not save the file.");
  }
};

App.devAgent.appendChatNode = function(chat, targetLogContainer = null) {
  const logContainer = targetLogContainer || devElements.log;
  if (!logContainer) return;
  
  // Normalize chat.content to a string if it was accidentally saved as JSON/Array
  if (Array.isArray(chat.content)) {
    chat.content = chat.content.map(part => typeof part === 'string' ? part : part.text || JSON.stringify(part)).join('\n');
  } else if (typeof chat.content === 'object' && chat.content !== null) {
    chat.content = JSON.stringify(chat.content, null, 2);
  } else {
    chat.content = String(chat.content || '');
  }
  
  if (chat.status === 'processing') {
    if (chat.id && document.getElementById('devChatNode_' + chat.id)) return; // Prevent duplicate processing nodes
    
    const spinner = document.createElement('div');
    spinner.className = 'dev-chat-bubble-wrapper ' + chat.role;
    spinner.id = 'devChatNode_' + chat.id;
    spinner.dataset.status = 'processing';
    const parser = new DOMParser();
    const doc = parser.parseFromString(`
      <div class="dev-chat-avatar ${chat.role}" style="background-image: url('/images/${chat.role}.png');"></div>
      <div class="dev-chat-content-col">
        <div class="dev-chat-bubble ${chat.role} loading">Agent is processing objective...</div>
      </div>
    `, 'text/html');
    spinner.textContent = '';
    Array.from(doc.body.childNodes).forEach(n => spinner.appendChild(n.cloneNode(true)));

    const outerWrapper = document.createElement('div');
    outerWrapper.className = 'dev-chat-thread-block';
    outerWrapper.id = 'devChatThread_' + chat.id;
    outerWrapper.appendChild(spinner);
    
    if (chat.parent_id) {
       const parentContainer = document.getElementById('devChatChildren_' + chat.parent_id);
       if (parentContainer) parentContainer.appendChild(outerWrapper);
       else logContainer.appendChild(outerWrapper);
    } else {
       logContainer.appendChild(outerWrapper);
    }
    logContainer.scrollTop = logContainer.scrollHeight;
    return;
  }

  if (logContainer && logContainer.querySelector('.empty-state')) {
    logContainer.textContent = '';
  }

  if (chat.id) {
    const existingNode = document.getElementById('devChatNode_' + chat.id);
    if (existingNode) {
      if (existingNode.dataset.status === 'processing') {
        existingNode.remove(); // Remove the processing spinner to replace it with the actual message
      } else {
        return; // Node already exists, prevent duplication
      }
    }
  }

  const wrapper = document.createElement('div');
  wrapper.className = `dev-chat-bubble-wrapper ${chat.role}`;
  if (chat.id) wrapper.id = 'devChatNode_' + chat.id;
  
  let parsedTriAgent = App.devAgent.parseTriAgent(chat.content);
  let triAgentData = null;
  if (parsedTriAgent && parsedTriAgent.valid) {
    triAgentData = parsedTriAgent.data;
  } else if (parsedTriAgent && !parsedTriAgent.valid && chat.content && typeof chat.content === 'string' && chat.content.includes('"state"')) {
    // We'll handle the DESYNC event lower down
  }

  const payloadType = String(triAgentData?.payload?.type || '').toUpperCase();
  const sourceAgent = String(triAgentData?.state?.source_agent || '').toUpperCase();
  const targetAgent = String(triAgentData?.state?.target_agent || '').toUpperCase();
  const taskStatus = String(triAgentData?.state?.task_status || '').toLowerCase();
  const payloadContentString = String(triAgentData?.payload?.content || '');

  const isApprovalPrompt = 
       (payloadType === 'COMMAND' && sourceAgent === '@ROGER') || 
       (payloadType === 'QUERY' && sourceAgent === '@ANTIGRAVITY' && payloadContentString.toLowerCase().includes('awaiting confirmation')) ||
       (targetAgent === '@MENTOR' && (taskStatus === 'review' || payloadContentString.toLowerCase().includes('if you approve') || payloadContentString.toLowerCase().includes('final sign-off')));

  const avatar = document.createElement('div');
  avatar.className = `dev-chat-avatar ${chat.role}`;
  
  const hasCheckdev = typeof chat.content === 'string' && chat.content.toLowerCase().includes('checkdev');
  const hasAcquire = typeof chat.content === 'string' && (chat.content.toLowerCase().includes('trigger acquire') || chat.content.toLowerCase().includes('training acquire'));
  
  if (chat.role !== 'user' && (hasCheckdev || isApprovalPrompt)) {
    avatar.classList.add('checkdev-alert');
    avatar.style.cursor = 'pointer';
    avatar.title = hasCheckdev ? 'Click to trigger Archie (Shift-click to dismiss)' : 'Action Required - See Message (Shift-click to dismiss)';
    avatar.onclick = async (e) => {
      avatar.classList.remove('checkdev-alert');
      avatar.style.cursor = 'default';
      avatar.title = '';
      
      if (e && e.shiftKey) {
        return; // Silent dismiss
      }
      
      if (hasCheckdev) {
        try {
          const res = await fetch('http://localhost:3005/trigger', { method: 'POST' });
          if (res.ok) console.log('Archie macro triggered successfully!');
          else console.error('Archie macro failed to trigger.');
        } catch (err) {
          console.error('Failed to connect to Archie macro server. Is it running on port 3005?', err);
        }
      } else {
        // Just scroll down to the message
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
  } else if (chat.role !== 'user' && hasAcquire) {
    avatar.classList.add('acquire-alert');
    avatar.style.cursor = 'pointer';
    avatar.title = 'Click to trigger Training Acquire (Shift-click to dismiss)';
    avatar.onclick = async (e) => {
      avatar.classList.remove('acquire-alert');
      avatar.style.cursor = 'default';
      avatar.title = '';
      
      if (e && e.shiftKey) {
        return; // Silent dismiss
      }
      
      App.notify('Triggering Knowledge Acquire...', false);
      try {
        const res = await fetch('/api/develop/devAgent/acquire', { method: 'POST' });
        if (res.ok) {
           App.notify('Training Acquire completed!', false);
        } else {
           App.notify('Training Acquire failed.', true);
        }
      } catch (err) {
        console.error('Failed to connect to acquire endpoint.', err);
        App.notify('Failed to connect to acquire endpoint.', true);
      }
    };
  }
  if (chat.role === 'user') {
    avatar.style.backgroundImage = 'url("/images/mentor.png")';
  } else if (chat.role === 'roger') {
    avatar.style.backgroundImage = 'url("/images/roger.png")';
  } else if (chat.role === 'antigravity') {
    avatar.style.backgroundImage = 'url("/images/roger.png")'; // Antigravity is now Roger_Thorson
  } else if (chat.role === 'angie') {
    avatar.style.backgroundImage = 'url("/images/antigravity.png")';
  } else if (chat.role === 'archie') {
    avatar.style.backgroundImage = 'url("/images/antigravity.png")';
    avatar.style.filter = 'hue-rotate(270deg) saturate(300%) contrast(1.2)';
    avatar.style.border = '2px solid #10b981';
  }

  const contentCol = document.createElement('div');
  contentCol.className = 'dev-chat-content-col';
  
  const bubble = document.createElement('div');
  bubble.className = `dev-chat-bubble ${chat.role}`;
  if (chat.status === 'failed') {
    bubble.style.border = '2px solid #ef4444';
    bubble.style.backgroundColor = '#fef2f2';
    bubble.style.color = '#dc2626';
    bubble.style.fontWeight = 'bold';
  }

  const header = document.createElement('div');
  header.className = 'dev-chat-header';
  
  let author = 'Unknown';
  if (chat.role === 'user') author = 'Mentor';
  if (chat.role === 'roger') author = '@Angie';
  if (chat.role === 'antigravity') author = '@Roger_Thorson';
  if (chat.role === 'angie') author = '@Angie';
  if (chat.role === 'archie') author = '@Archie';

  const dateStr = chat.created_at ? new Date(chat.created_at).toLocaleString() : new Date().toLocaleString();
  
  if (chat.role === 'user' && chat.id) {
    bubble.dataset.rawContent = encodeURIComponent(chat.content);
  }

  let editBtnHTML = '';
  if (chat.role === 'user' && chat.id) {
    editBtnHTML = `
      <button class="dev-copy-btn" onclick="App.devAgent.editChat(${chat.id}, this);" title="Edit Message" style="margin-right: 4px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      </button>
    `;
  }

  const copyBtnId = `copyChat_${chat.id || Math.random().toString(36).substr(2, 9)}`;
  const linkBtnId = `linkChat_${chat.id || Math.random().toString(36).substr(2, 9)}`;
  const parser = new DOMParser();
  const safeHeaderHtml = `
    <div><strong>${author}</strong> <span class="chat-time">${dateStr}</span></div>
    <div class="dev-copy-btn-container">
      ${editBtnHTML}
      <button class="dev-copy-btn" title="Reply to Message" style="margin-right: 4px;" onclick="App.devAgent.toggleInlineReply(${chat.id || null}, this)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
      <button id="${linkBtnId}" class="dev-copy-btn" title="Link Message to Task/Chat" style="margin-right: 4px;" ${chat.id ? `onclick="App.devAgent.startLinkingMode('${chat.id}')"` : ''}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
      </button>
      <button id="${copyBtnId}" class="dev-copy-btn" title="Copy Message">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
        </svg>
      </button>
    </div>
  `;
  const doc = parser.parseFromString(safeHeaderHtml, 'text/html');
  header.textContent = '';
  Array.from(doc.body.childNodes).forEach(n => header.appendChild(n.cloneNode(true)));
  
  const content = document.createElement('div');
  content.className = 'dev-chat-content';


  if (parsedTriAgent && !parsedTriAgent.valid) {
    if (typeof chat.content === 'string' && chat.content.includes('"state"')) {
       App.devAgent.appendChatNode({
         role: 'roger',
         content: `**SYSTEM NOTICE / DESYNC EVENT:** TriAgent Schema Validation explicitly failed. ${parsedTriAgent.error}`,
         created_at: new Date().toISOString()
       });
    }
    parsedTriAgent = null; // Revert to generic markdown handler below
  } else if (parsedTriAgent) {
    parsedTriAgent = parsedTriAgent.data;
  }

  if (parsedTriAgent) {
    if (parsedTriAgent.state && parsedTriAgent.state.state_version_id) {
       bubble.id = 'devChatVersion_' + parsedTriAgent.state.state_version_id;
    }
    const rawContentHTML = App.devAgent.formatMarkdown(parsedTriAgent.payload.content);
    let finalUI = rawContentHTML;
    
    if ( isApprovalPrompt ) {
      finalUI = `
        <div style="background:rgba(245, 158, 11, 0.1); border: 2px solid var(--accent-warning); padding:1rem; border-radius:var(--radius-md); box-shadow: 0 4px 12px rgba(245,158,11,0.15);">
          <div style="display:flex; align-items:center; gap: 8px; margin-bottom: 0.75rem; border-bottom:1px solid rgba(245, 158, 11, 0.3); padding-bottom:0.5rem;">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-warning)" stroke-width="2" width="24" height="24">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <strong style="color:var(--accent-warning); font-size:1.1rem; letter-spacing: 0.5px;">APPROVAL REQUIRED</strong>
          </div>
          <div style="font-size:0.95rem; line-height: 1.5; color: var(--text-dark);">
            ${rawContentHTML}
          </div>
          <div style="display:flex; gap:10px; margin-top:1rem; padding-top:0.75rem; border-top:1px solid rgba(245, 158, 11, 0.3);">
            <button type="button" class="primary-btn" onclick="App.devAgent.sendProtocolAction('CONFIRM', '${parsedTriAgent.state.context_checksum}', this)" style="background:#10b981; border:none; flex:1; padding:0.75rem;">APPROVE & CONFIRM</button>
            <button type="button" class="secondary-btn" onclick="App.devAgent.sendProtocolAction('DENY', '${parsedTriAgent.state.context_checksum}', this)" style="flex:1; padding:0.75rem; background:rgba(0,0,0,0.05);">DENY / REJECT</button>
          </div>
        </div>
      `;
    }
    
    let handoffBtnId = null;
    if ( !isApprovalPrompt ) {
      const textContent = (chat.content || '').toLowerCase();
      const targetAgent = (parsedTriAgent.state?.target_agent || '').toLowerCase();
      const isArchieTarget = targetAgent.includes('archie') || targetAgent.includes('antigravity') || textContent.includes('awaiting archie') || textContent.includes('awaiting @archie') || textContent.includes('to: @archie');
      
      if (isArchieTarget) {
        handoffBtnId = `handoff_${chat.id || Math.random().toString(36).substr(2, 9)}`;
        finalUI += `
          <div style="margin-top:1rem; padding-top:0.75rem; border-top:1px solid rgba(0,0,0,0.1);">
            <button id="${handoffBtnId}" type="button" class="primary-btn" style="display:inline-flex; align-items:center; gap:6px; background:var(--accent-warning); color:#fff; border:none; padding:0.5rem 1rem;">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect></svg>
              Copy Handoff Prompt
            </button>
          </div>
        `;
      }
    }
    
    const versionStr = parsedTriAgent.state?.state_version_id ? `v${parsedTriAgent.state.state_version_id}` : '';
    const parserHead = new DOMParser();
    const docHead = parserHead.parseFromString(`
      <div style="flex: 1; display:flex; align-items:center;"><strong>${author}</strong> <span class="chat-time" style="margin-left: 0.5rem">${dateStr}</span></div>
      <div style="flex: 1; text-align: center; color: rgba(0,0,0,0.5); font-family: monospace; font-weight: bold; font-size: 0.85rem;">${versionStr ? '[' + versionStr + ']' : ''}</div>
      <div style="flex: 1; justify-content: flex-end;" class="dev-copy-btn-container">
        ${editBtnHTML}
        <button class="dev-copy-btn" title="Reply to Message" style="margin-right: 4px;" onclick="App.devAgent.toggleInlineReply(${chat.id || null}, this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
        <button id="${linkBtnId}" class="dev-copy-btn" title="Link Message to Task/Chat" style="margin-right: 4px;" ${chat.id ? `onclick="App.devAgent.startLinkingMode('${chat.id}')"` : ''}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
          </svg>
        </button>
        <button id="${copyBtnId}" class="dev-copy-btn" title="Copy Message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
          </svg>
        </button>
      </div>
    `, 'text/html');
    header.textContent = '';
    Array.from(docHead.body.childNodes).forEach(n => header.appendChild(n.cloneNode(true)));

    const parserContent = new DOMParser();
    const docContent = parserContent.parseFromString(finalUI + `
      <details style="margin-top:12px; font-size:0.75rem; color:#888; background:rgba(0,0,0,0.02); padding:4px 8px; border-radius:4px;">
        <summary style="cursor:pointer; user-select:none;">TriAgentState Protocol Wrapper (${versionStr})</summary>
        <pre style="margin-top:5px; white-space:pre-wrap; word-break:break-all; tab-size:2;">${JSON.stringify(parsedTriAgent.state, null, 2)}</pre>
      </details>
    `, 'text/html');
    content.textContent = '';
    Array.from(docContent.body.childNodes).forEach(n => content.appendChild(n.cloneNode(true)));
    
    // Rewrite internal chat.content so the summary extractor later on uses human-readable text
    chat.content = parsedTriAgent.payload.content; 
  } else {
    let finalUI = App.devAgent.formatMarkdown(chat.content);
    
    const textContent = (chat.content || '').toLowerCase();
    const isArchieTarget = textContent.includes('awaiting archie') || textContent.includes('awaiting @archie') || textContent.includes('to: @archie');
    
    let handoffBtnId = null;
    if (isArchieTarget) {
      handoffBtnId = `handoff_${chat.id || Math.random().toString(36).substr(2, 9)}`;
      finalUI += `
        <div style="margin-top:1rem; padding-top:0.75rem; border-top:1px solid rgba(0,0,0,0.1);">
          <button id="${handoffBtnId}" type="button" class="primary-btn" style="display:inline-flex; align-items:center; gap:6px; background:var(--accent-warning); color:#fff; border:none; padding:0.5rem 1rem;">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect></svg>
            Copy Handoff Prompt
          </button>
        </div>
      `;
      
      // Wire up the button using setTimeout to ensure it's in the DOM
      setTimeout(() => {
        const handoffBtn = document.getElementById(handoffBtnId);
        if (handoffBtn) {
          handoffBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            let prompt = chat.raw_content || chat.content || '';
            try {
              await navigator.clipboard.writeText(prompt);
              const originalNodes = Array.from(handoffBtn.childNodes);
              handoffBtn.textContent = 'Copied! Paste to IDE';
              handoffBtn.style.background = 'var(--accent-success)';
              setTimeout(() => {
                handoffBtn.textContent = '';
                originalNodes.forEach(n => handoffBtn.appendChild(n));
                handoffBtn.style.background = 'var(--accent-warning)';
              }, 3000);
            } catch(err) {
              App.notify("Failed to copy handoff prompt.", true);
            }
          });
        }
      }, 0);
    }
    
    const parserFinalUI = new DOMParser();
    const docFinalUI = parserFinalUI.parseFromString(finalUI, 'text/html');
    content.textContent = '';
    Array.from(docFinalUI.body.childNodes).forEach(n => content.appendChild(n.cloneNode(true)));
  }

  if (chat.attachment_url) {
    const attachWrap = document.createElement('div');
    attachWrap.className = 'dev-chat-attachment';
    if (chat.attachment_url.includes('image/') || chat.attachment_url.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i)) {
      const a = document.createElement('a');
      a.href = chat.attachment_url;
      a.target = '_blank';
      const img = document.createElement('img');
      img.src = chat.attachment_url;
      img.style.maxWidth = '100%';
      img.style.borderRadius = '4px';
      img.style.marginTop = '8px';
      img.style.display = 'block';
      img.alt = 'Attached';
      a.appendChild(img);
      attachWrap.appendChild(a);
    } else {
      const a2 = document.createElement('a');
      a2.href = chat.attachment_url;
      a2.target = '_blank';
      a2.download = 'attachment';
      a2.className = 'primary-btn';
      a2.style.display = 'inline-block';
      a2.style.marginTop = '8px';
      a2.textContent = 'Download File attachment';
      attachWrap.appendChild(a2);
    }
    content.appendChild(attachWrap);
  }

  let rawText = '';
  if (typeof chat.content === 'object' && chat.content !== null) {
    rawText = JSON.stringify(chat.content).replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
  } else {
    rawText = String(chat.content || '').replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
  }
  let plainTextSummary = rawText;
  const sentenceMatches = rawText.match(/.*?[.!?](?:\s|$)/g);
  if (sentenceMatches && sentenceMatches.length > 0) {
    plainTextSummary = sentenceMatches.slice(0, 2).join(' ').trim();
  } else {
    plainTextSummary = rawText.substring(0, 150) + (rawText.length > 150 ? '...' : '');
  }
  
  if (plainTextSummary.length > 280) {
    plainTextSummary = plainTextSummary.substring(0, 280).trim() + '...';
  } else if (plainTextSummary.length < rawText.length) {
    plainTextSummary += '...';
  }

  const summaryNode = document.createElement('div');
  summaryNode.className = 'dev-chat-summary';
  summaryNode.style.cursor = 'pointer';
  summaryNode.onclick = function(e) {
    e.preventDefault();
    const b = this.closest('.dev-chat-bubble');
    b.classList.add('expanded');
    this.closest('.dev-chat-bubble-wrapper').classList.add('expanded');
  };
  const parserSummary = new DOMParser();
  const docSummary = parserSummary.parseFromString(`<strong>${dateStr} - ${author}:</strong> ${plainTextSummary} <span style="color:#2563eb; margin-left:8px; font-family:monospace; font-weight:bold;">[+]</span>`, 'text/html');
  summaryNode.textContent = '';
  Array.from(docSummary.body.childNodes).forEach(n => summaryNode.appendChild(n.cloneNode(true)));

  // Make header clickable to collapse
  header.style.cursor = 'pointer';
  header.onclick = function(e) {
    if (e.target.closest('button') || e.target.closest('a')) return; // ignore button clicks
    e.preventDefault();
    const b = this.closest('.dev-chat-bubble');
    b.classList.remove('expanded');
    this.closest('.dev-chat-bubble-wrapper').classList.remove('expanded');
  };
  
  // Inject the [-] into the header display
  const minusSpan = document.createElement('span');
  minusSpan.style.color = '#2563eb';
  minusSpan.style.marginRight = '8px';
  minusSpan.style.fontFamily = 'monospace';
  minusSpan.style.fontWeight = 'bold';
  minusSpan.textContent = '[-]';
  header.firstElementChild.insertBefore(minusSpan, header.firstElementChild.firstChild);

  bubble.appendChild(summaryNode);
  bubble.appendChild(header);
  bubble.appendChild(content);
  contentCol.appendChild(bubble);
  
  wrapper.appendChild(avatar);
  wrapper.appendChild(contentCol);
  
  const outerWrapper = document.createElement('div');
  outerWrapper.className = 'dev-chat-thread-block';
  outerWrapper.id = 'devChatThread_' + chat.id;
  outerWrapper.appendChild(wrapper);
  
  const childrenContainer = document.createElement('div');
  childrenContainer.className = 'dev-chat-children';
  childrenContainer.id = 'devChatChildren_' + chat.id;
  outerWrapper.appendChild(childrenContainer);

  if (chat.parent_id) {
    const parentContainer = document.getElementById('devChatChildren_' + chat.parent_id);
    if (parentContainer) {
      parentContainer.appendChild(outerWrapper);
    } else {
      logContainer.appendChild(outerWrapper);
    }
  } else {
    logContainer.appendChild(outerWrapper);
  }

  const copyBtn = bubble.querySelector(`#${copyBtnId}`);
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(chat.content || '');
        const svg = copyBtn.querySelector('svg');
        if (svg) {
          const originalNodes = Array.from(svg.childNodes);
          svg.textContent = '';
          const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          polyline.setAttribute('points', '20 6 9 17 4 12');
          svg.appendChild(polyline);
          setTimeout(() => {
            svg.textContent = '';
            originalNodes.forEach(n => svg.appendChild(n));
          }, 2000);
        }
      } catch (err) {}
    });
  }

  // Trigger dynamic glossary sync
  if (App.devAgent.glossaryTimeout) clearTimeout(App.devAgent.glossaryTimeout);
  App.devAgent.glossaryTimeout = setTimeout(App.devAgent.generateGlossary, 600);
};
App.devAgent.toggleInlineReply = function(chatId, btn) {
  const containerId = 'devChatChildren_' + chatId;
  const container = document.getElementById(containerId);
  if (!container) return;
  
  let replyBox = document.getElementById('devInlineReply_' + chatId);
  if (replyBox) {
    replyBox.remove();
    return;
  }
  
  replyBox = document.createElement('div');
  replyBox.id = 'devInlineReply_' + chatId;
  replyBox.className = 'dev-inline-reply-box';
  const parserReply = new DOMParser();
  const docReply = parserReply.parseFromString(`
    <textarea id="devInlineReplyInput_${chatId}" placeholder="Write a reply..." class="form-input" style="width:100%; min-height:60px; margin-bottom:8px; border-radius: var(--radius-md); padding: 8px;"></textarea>
    <div style="display:flex; justify-content:flex-end; gap:8px;">
      <button class="secondary-btn" onclick="document.getElementById('devInlineReply_${chatId}').remove();">Cancel</button>
      <button class="primary-btn" onclick="App.devAgent.submitInlineReply(${chatId})">Reply</button>
    </div>
  `, 'text/html');
  replyBox.textContent = '';
  Array.from(docReply.body.childNodes).forEach(n => replyBox.appendChild(n.cloneNode(true)));
  container.insertBefore(replyBox, container.firstChild);
  document.getElementById('devInlineReplyInput_' + chatId).focus();
};

App.devAgent.submitInlineReply = async function(parentId) {
  const input = document.getElementById('devInlineReplyInput_' + parentId);
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  
  const sessionId = devState.activeSessionId;
  const projectId = window.App?.currentProjectId || null;
  
  const btn = input.nextElementSibling.querySelector('.primary-btn');
  btn.innerText = 'Sending...';
  btn.disabled = true;

  try {
    const res = await App.api('/api/develop/devAgent/chat', {
      method: 'POST',
      body: JSON.stringify({
        sessionId,
        projectId,
        content: text,
        parentId
      })
    });
    
    document.getElementById('devInlineReply_' + parentId).remove();
    // Supabase realtime will pick up the new message and append it
  } catch (err) {
    console.error(err);
    App.notify('Error sending reply', true);
    btn.innerText = 'Reply';
    btn.disabled = false;
  }
};

App.devAgent.scrollToBottom = function() {
  if (devState.activeSessionId) {
    const acc = document.querySelector(`.dev-thread-accordion[data-session-id="${devState.activeSessionId}"]`);
    if (acc) {
      const scrollContainer = acc.querySelector('.dev-chat-log');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
        return;
      }
    }
  }
  const genericContainer = document.querySelector('.dev-chat-log');
  if (genericContainer) {
    genericContainer.scrollTop = genericContainer.scrollHeight;
  }
};


App.devAgent.initSupabaseRealtime = function(sessionId) {
  if (!window.supabaseClient) {
    console.warn('Supabase Realtime not initialized. Ensure URL and ANON_KEY are in settings.');
    return;
  }
  if (App.devAgent.realtimeChannel) {
    App.devAgent.realtimeChannel.unsubscribe();
  }
  
  App.devAgent.realtimeChannel = window.supabaseClient.channel('dev_chats_' + sessionId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'agent_messages', filter: 'session_id=eq.' + sessionId },
      (payload) => {
        const chat = payload.new;
        if (!chat) return;
        const existingNode = document.getElementById('devChatNode_' + chat.id);
        if (existingNode) {
          if (chat.status !== 'processing' && existingNode.dataset.status === 'processing') {
            const threadBlock = document.getElementById('devChatThread_' + chat.id);
            if (threadBlock) threadBlock.remove();
            else existingNode.remove();
            App.devAgent.appendChatNode(chat);
            App.devAgent.scrollToBottom();
          }
        } else {
           App.devAgent.appendChatNode(chat);
           App.devAgent.scrollToBottom();
        }
      }
    )
    .subscribe();
};


App.devAgent.renderStagedFiles = function() {
  if (!devElements.attachmentsContainer) return;
  devElements.attachmentsContainer.textContent = '';
  if (devState.stagedFiles.length === 0) return;
  
  devState.stagedFiles.forEach(fileObj => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.fontSize = '0.85rem';
    row.style.color = '#6b7280';
    
    const parserRow = new DOMParser();
    const docRow = parserRow.parseFromString(`
      <span>Attached:</span>
      <a href="${fileObj.base64}" download="${fileObj.name}" target="_blank" style="text-decoration:underline; color: var(--accent);">${fileObj.name}</a>
      <a href="#" title="Remove attachment" style="color: #ef4444; font-size:18px; font-weight:bold; cursor:pointer; text-decoration:none; margin-left:8px;" onclick="event.preventDefault(); App.devAgent.removeStagedFile('${fileObj.id}');">&times;</a>
    `, 'text/html');
    row.textContent = '';
    Array.from(docRow.body.childNodes).forEach(n => row.appendChild(n.cloneNode(true)));
    devElements.attachmentsContainer.appendChild(row);
  });
};

App.devAgent.parseTriAgent = function(rawText) {
  if (!rawText) return null;
  try {
    let maybeJson = String(rawText).trim();
    if (maybeJson.startsWith('```json')) maybeJson = maybeJson.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    else if (maybeJson.startsWith('```')) maybeJson = maybeJson.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
    let parsed = JSON.parse(maybeJson);
    
    if (Array.isArray(parsed)) {
      const combinedContent = parsed.map(p => p.payload?.content || '').filter(Boolean).join('\n\n---\n\n');
      let targetObj = parsed.find(p => p.payload?.type === 'COMMAND') || parsed[parsed.length - 1];
      if (targetObj && targetObj.payload) {
         targetObj.payload.content = combinedContent;
      }
      parsed = targetObj;
    }
    
    if (parsed && parsed.payload && parsed.payload.content) {
      
      // Auto-unwrap if the LLM double-encapsulated the JSON schema inside payload.content
      try {
         let innerText = String(parsed.payload.content).trim();
         if (innerText.startsWith('```json')) innerText = innerText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
         else if (innerText.startsWith('```')) innerText = innerText.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
         
         const innerParsed = JSON.parse(innerText);
         if (innerParsed && innerParsed.payload && innerParsed.payload.content) {
             parsed.state = { ...parsed.state, ...innerParsed.state };
             parsed.payload = { ...parsed.payload, ...innerParsed.payload };
         }
      } catch(e3) {
         // Malformed inner double-wrapped payload. Fallback to extracting the content string manually.
         let innerText = String(parsed.payload.content).trim();
         if (innerText.includes('"state"') && innerText.includes('"payload"')) {
            const innerContentMatch = innerText.match(/"content"\s*:\s*([\s\S]*)/);
            if (innerContentMatch) {
               let innerContentStr = innerContentMatch[1].trim();
               // Strip trailing JSON array brackets, rogue concatenated payloads, etc
               innerContentStr = innerContentStr.replace(/\"\s*\}?\s*\}?\s*\]?\s*(```)?\s*(,\s*\{[\s\S]*)?$/g, '');
               if (innerContentStr.startsWith('"')) innerContentStr = innerContentStr.substring(1);
               innerContentStr = innerContentStr.replace(/\\n/g, '\n').replace(/\\"/g, '"');
               parsed.payload.content = innerContentStr;
            }
         }
      }

      // We only care about payload content rendering.
      // Strict state schema missing property validation is bypassed here to allow rendering older chat histories.
      return { valid: true, data: parsed };
    }
  } catch (e) {
    // Heuristic fallback for pure markdown panic attacks
    let rawStr = String(rawText).trim();
    if (!rawStr.startsWith('{') && !rawStr.startsWith('[')) {
      let target = '@Human';
      if (rawStr.toLowerCase().includes('@angie')) target = '@Angie';
      else if (rawStr.toLowerCase().includes('@archie') || rawStr.toLowerCase().includes('@antigravity')) target = '@Archie';
      
      let type = rawStr.includes('COMMAND:') ? 'COMMAND' : 'RESPONSE';
      
      return {
        valid: true,
        data: {
          state: { target_agent: target, source_agent: '@Roger', state_version_id: 1, context_checksum: 'RAW' },
          payload: { type: type, content: rawStr }
        }
      };
    }
    
    // Regex Recovery for structurally broken JSON (unescaped quotes/newlines inside payload.content)
    try {
      const contentMatch = rawStr.match(/"content"\s*:\s*([\s\S]*)/);
      if (contentMatch) {
         let contentStr = contentMatch[1].trim();
         // Strip the trailing JSON brackets, quotes, trailing array comma payloads, and Markdown ticks
         contentStr = contentStr.replace(/\"\s*\}?\s*\}?\s*\]?\s*(```)?\s*(,\s*\{[\s\S]*)?$/g, '');
         if (contentStr.startsWith('"')) contentStr = contentStr.substring(1);
         // Unescape standard JSON text escapes since we bypassed parser
         contentStr = contentStr.replace(/\\n/g, '\n').replace(/\\"/g, '"');
         
         return {
            valid: true,
            data: {
               state: { state_version_id: 1, session_id: '0' },
               payload: { type: 'RESPONSE', content: contentStr }
            }
         };
      }
    } catch(regexErr) {}
  }
  return null; // Not valid JSON, fallback to generic Markdown text formatting
};

App.devAgent.scrollToVersion = function(versionId) {
  const el = document.getElementById('devChatVersion_' + versionId);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('highlight-ping');
    void el.offsetWidth; // trigger layout reflow to restart animation sequence
    el.classList.add('highlight-ping');
  } else {
    console.warn(`Chat version ID ${versionId} not yet loaded or missing from current DOM.`);
  }
};

App.devAgent.editChat = function(chatId, btn) {
  const wrapper = btn.closest('.dev-chat-bubble');
  const contentDiv = wrapper.querySelector('.dev-chat-content');
  if (!contentDiv) return;

  const rawEncoded = wrapper.dataset.rawContent || '';
  const rawString = decodeURIComponent(rawEncoded);

  // Unwrap TriAgent if applicable for editing pure text
  let editableText = rawString;
  const p = App.devAgent.parseTriAgent(rawString);
  if (p && p.valid && p.data.payload) {
    editableText = p.data.payload.content || '';
  }

  Array.from(contentDiv.childNodes).forEach(n => {
    if (n.nodeType === Node.ELEMENT_NODE) n.style.display = 'none';
    else if (n.nodeType === Node.TEXT_NODE) {
      const span = document.createElement('span');
      span.textContent = n.textContent;
      span.style.display = 'none';
      contentDiv.replaceChild(span, n);
    }
  });

  const editorWrap = document.createElement('div');
  editorWrap.style.display = 'flex';
  editorWrap.style.flexDirection = 'column';
  editorWrap.style.gap = '8px';
  editorWrap.className = 'dev-chat-editor-wrap';

  const ta = document.createElement('textarea');
  ta.id = `editChatText_${chatId}`;
  ta.style.width = '100%';
  ta.style.minHeight = '100px';
  ta.style.padding = '10px';
  ta.style.borderRadius = '4px';
  ta.style.border = '1px solid #ccc';
  ta.style.background = 'var(--bg-input)';
  ta.style.color = 'var(--text-primary)';
  ta.style.fontFamily = 'inherit';
  ta.value = editableText;

  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.gap = '8px';
  btnRow.style.justifyContent = 'flex-end';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'secondary-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => {
    editorWrap.remove();
    Array.from(contentDiv.childNodes).forEach(n => {
      if (n.nodeType === Node.ELEMENT_NODE && !n.classList.contains('dev-chat-editor-wrap')) {
        n.style.display = '';
      }
    });
  };

  const saveBtn = document.createElement('button');
  saveBtn.className = 'primary-btn';
  saveBtn.textContent = 'Save Changes';
  saveBtn.onclick = function() { App.devAgent.saveChatEdit(chatId, this); };

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(saveBtn);
  editorWrap.appendChild(ta);
  editorWrap.appendChild(btnRow);
  contentDiv.appendChild(editorWrap);
};

App.devAgent.saveChatEdit = async function(chatId, btn) {
  const wrapper = btn.closest('.dev-chat-bubble');
  const textarea = document.getElementById(`editChatText_${chatId}`);
  if (!textarea) return;
  const newText = textarea.value.trim();

  const rawEncoded = wrapper.dataset.rawContent || '';
  const rawString = decodeURIComponent(rawEncoded);
  let finalPayloadStr = newText;

  const p = App.devAgent.parseTriAgent(rawString);
  if (p && p.valid && p.data) {
     p.data.payload.content = newText;
     p.data.state.state_version_id = Math.max(Number(p.data.state.state_version_id) + 1, ++devState.localVersionId);
     finalPayloadStr = JSON.stringify(p.data, null, 2);
  }

  btn.disabled = true;
  btn.textContent = 'Saving...';
  
  const res = await App.api('/api/develop/devAgent/chat', {
    method: 'PATCH',
    body: JSON.stringify({ chatId: chatId, content: finalPayloadStr })
  });

  if (res.error) {
     alert("Failed to edit chat: " + (res.error.message || res.error));
     btn.disabled = false;
     btn.textContent = 'Save Changes';
     return;
  }
  
  // Reload history to properly re-sync the DOM
  App.devAgent.loadHistory(devState.activeSessionId);
    // Force default to projects
    setTimeout(() => App.devAgent.loadActionItems(), 100);
};

App.devAgent.renderActiveCommand = function() {
  const overlay = document.getElementById('rogerPersistentOverlay');
  const chatForm = document.getElementById('devChatForm');
  if (!overlay || !chatForm) return;

  if (App.devAgent.activePendingCommand) {
    const rawContentHTML = App.devAgent.formatMarkdown(App.devAgent.activePendingCommand.content);
    const parserOverlay = new DOMParser();
    const docOverlay = parserOverlay.parseFromString(`
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" width="24" height="24">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
        <strong style="color:var(--accent-warning); letter-spacing: 0.5px;">PENDING PROVISIONAL COMMAND</strong>
      </div>
      <div style="font-size:0.9rem; line-height: 1.4; color: var(--text-dark); max-height:150px; overflow-y:auto; border-left:3px solid var(--accent-warning); padding-left:12px; margin-bottom:16px;">
        ${rawContentHTML}
      </div>
      <div style="display:flex; gap:10px; border-top:1px solid #eee; padding-top:16px;">
        <button type="button" class="primary-btn" onclick="App.devAgent.sendProtocolAction('CONFIRM', '${App.devAgent.activePendingCommand.hash}', this)" style="background:#10b981; border:none; flex:1;">CONFIRM</button>
        <button type="button" class="secondary-btn" onclick="App.devAgent.sendProtocolAction('DENY', '${App.devAgent.activePendingCommand.hash}', this)" style="flex:1; background:rgba(0,0,0,0.05);">DENY</button>
      </div>
    `, 'text/html');
    overlay.textContent = '';
    Array.from(docOverlay.body.childNodes).forEach(n => overlay.appendChild(n.cloneNode(true)));
    overlay.classList.remove('hidden');
    chatForm.classList.add('dev-overlay-active');
  } else {
    overlay.textContent = '';
    overlay.classList.add('hidden');
    chatForm.classList.remove('dev-overlay-active');
  }
};

App.devAgent.removeStagedFile = function(id) {
  devState.stagedFiles = devState.stagedFiles.filter(f => f.id !== id);
  App.devAgent.renderStagedFiles();
};

App.devAgent.clearStagedFiles = function() {
  devState.stagedFiles = [];
  if (devElements.fileInput) devElements.fileInput.value = '';
  App.devAgent.renderStagedFiles();
};

App.devAgent.sendProtocolAction = function(actionType, commandHash, btnEl) {
  if (!devState.activeSessionId) return;
  
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = actionType === 'CONFIRM' ? 'Confirmed ✓' : 'Denied X';
    btnEl.style.opacity = '0.7';
    btnEl.style.cursor = 'not-allowed';
    
    const wrapper = btnEl.closest('.dev-chat-bubble-wrapper');
    if (wrapper) {
      const avatar = wrapper.querySelector('.dev-chat-avatar');
      if (avatar) {
        avatar.classList.remove('checkdev-alert');
        avatar.style.cursor = 'default';
        avatar.title = '';
      }
    }
  }

  devState.localVersionId = devState.localVersionId || 1;
  const triAgentPayload = JSON.stringify({
    state: {
      session_id: devState.activeSessionId,
      state_version_id: ++devState.localVersionId,
      timestamp: new Date().toISOString(),
      source_agent: window.App?.state?.profile?.contactName ? '@' + window.App.state.profile.contactName.replace(/[^a-zA-Z0-9_-]/g, '') : '@Mentor',
      target_agent: '@Antigravity',
      active_objective_id: 'ACTIVE-SESSION',
      context_checksum: 'N/A'
    },
    payload: {
      type: 'COMMAND',
      content: JSON.stringify({ action: actionType, commandhash: commandHash })
    }
  }, null, 2);

  const payload = { 
    sessionId: devState.activeSessionId, 
    content: triAgentPayload 
  };

  App.api('/api/develop/devAgent/chat', {
    method: 'POST',
    body: JSON.stringify(payload)
  }).then(res => {
    if (res.data?.userChat) {
      App.devAgent.appendChatNode(res.data.userChat);
    }
    if (res.data?.devChat) {
      App.devAgent.appendChatNode(res.data.devChat);

    }
    App.devAgent.scrollToBottom();
  });
};

App.devAgent.submitChat = async function(formEl = null) {
  let inputEl = formEl ? formEl.querySelector('.dev-chat-input') : devElements.input;
  let fileBtn = formEl ? formEl.querySelector('.dev-file-trigger-btn') : devElements.fileBtn;
  
  const text = inputEl?.value.trim();
  if (!text && devState.stagedFiles.length === 0) return; // Do nothing if no input
  if (!devState.activeSessionId) return;

  const staged = devState.stagedFiles[0] || null;

  if (inputEl) {
    inputEl.value = '';
    inputEl.disabled = true;
  }
  if (fileBtn) fileBtn.disabled = true;
  App.devAgent.clearStagedFiles();

  let activeTaskId = 'ACTIVE-SESSION';
  let activeTaskTitle = '';
  if (window.supabaseClient) {
    try {
      const { data: taskData } = await window.supabaseClient.from('dev_tasks').select('id, title').eq('session_id', devState.activeSessionId).maybeSingle();
      if (taskData) {
        activeTaskId = taskData.id;
        activeTaskTitle = taskData.title;
      }
    } catch(e) { console.error("Error fetching task context:", e); }
  }

  devState.localVersionId = devState.localVersionId || 1;
  const triAgentPayload = JSON.stringify({
    state: {
      session_id: devState.activeSessionId,
      state_version_id: ++devState.localVersionId,
      timestamp: new Date().toISOString(),
      source_agent: window.App?.state?.profile?.contactName ? '@' + window.App.state.profile.contactName.replace(/[^a-zA-Z0-9_-]/g, '') : '@Mentor',
      target_agent: '@Roger',
      active_objective_id: activeTaskId,
      context_checksum: activeTaskTitle ? `Task: ${activeTaskTitle}` : 'N/A'
    },
    payload: {
      type: 'QUERY',
      content: text
    }
  }, null, 2);

  try {
    const payload = { 
      sessionId: devState.activeSessionId, 
      content: triAgentPayload 
    };
    if (staged) {
      payload.attachmentBase64 = staged.base64;
      payload.attachmentMime = staged.mime;
      payload.attachmentName = staged.name;
    }

    const res = await App.api('/api/develop/devAgent/chat', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    console.log("========== DIAGNOSTIC DIAGNOSTIC ==========");
    console.log("RAW DISPATCH URL: /api/develop/devAgent/chat");
    console.log("PAYLOAD OUT:", payload);
    console.log("RAW RESPONSE OBJECT:", JSON.parse(JSON.stringify(res)));
    console.log("has res.data?", !!res.data);
    console.log("res.data contents:", res.data);
    console.log("isArray(res.data.replies)?", res.data ? Array.isArray(res.data.replies) : false);
    console.log("==========================================");

    if (res.error) {
      App.devAgent.appendChatNode({
        role: 'roger', // Use a generic agent role for system errors
        status: 'failed',
        content: `API Error: ${res.error.message || res.error}`,
        created_at: new Date().toISOString()
      });
    } else if (res.data) {
       // The backend should return the user's message for persistence.
       if (res.data.userChat) {
         console.log("appending userChat");
         App.devAgent.appendChatNode(res.data.userChat);
       }

       // Handle new multi-response format from agents.
       if (Array.isArray(res.data.replies) && res.data.replies.length > 0) {
         console.log("appending replies array of len", res.data.replies.length);
         res.data.replies.forEach(chat => App.devAgent.appendChatNode(chat));
       } 
       // Fallback for older, single-response format.
       else if (res.data.devChat) {
         console.log("appending devChat legacy fallback");
         App.devAgent.appendChatNode(res.data.devChat);
       } else {
         console.log("CRITICAL WARN: missing replies array OR devChat legacy node!");
       }
    } else {
      console.log("CRITICAL WARN: no res.error AND no res.data!!!");
    }
  } catch (err) {
    // Display client-side or network errors directly in the chat UI.
    App.devAgent.appendChatNode({
      role: 'roger',
      status: 'failed',
      content: `Client-side Error: ${err.message || 'An unknown error occurred.'}`,
      created_at: new Date().toISOString()
    });
    App.notify("Request failed: " + (err.message || err), true);
  } finally {
    if (inputEl) {
      inputEl.disabled = false;
      inputEl.focus();
    }
    if (fileBtn) fileBtn.disabled = false;
    App.devAgent.scrollToBottom();
  }
};


document.addEventListener('DOMContentLoaded', () => {
  if (typeof App.whenAuthenticated === 'function') {
    App.whenAuthenticated(() => App.devAgent.init());
  }
});

App.devAgent.searchHits = [];
App.devAgent.currentSearchIndex = -1;

App.devAgent.applySearchHighlights = function(term) {
  const log = document.getElementById('devChatLog');
  if (!log) return;
  
  // 1. Clear existing highlights
  const existingMatches = log.querySelectorAll('mark.dev-search-match');
  existingMatches.forEach(mark => {
    const parent = mark.parentNode;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });

  App.devAgent.searchHits = [];
  App.devAgent.currentSearchIndex = -1;
  const countSpan = document.getElementById('devSearchCount');

  if (!term || !term.trim()) {
    if (countSpan) countSpan.textContent = '';
    return;
  }

  const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')})`, 'gi');

  // 2. Highlight text nodes safely
  const walker = document.createTreeWalker(log, NodeFilter.SHOW_TEXT, null, false);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach(node => {
    if (node.parentNode && (node.parentNode.nodeName === 'MARK' || node.parentNode.nodeName === 'SCRIPT')) return;
    
    const text = node.nodeValue;
    if (text.match(regex)) {
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      let match;
      regex.lastIndex = 0;
      
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }
        const mark = document.createElement('mark');
        mark.className = 'dev-search-match';
        mark.textContent = match[0];
        fragment.appendChild(mark);
        App.devAgent.searchHits.push(mark);
        lastIndex = regex.lastIndex;
      }
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }
      
      node.parentNode.replaceChild(fragment, node);
    }
  });

  const hitCount = App.devAgent.searchHits.length;
  if (countSpan) {
    countSpan.textContent = `${hitCount} match${hitCount !== 1 ? 'es' : ''}`;
    if (hitCount > 0) {
      countSpan.style.cursor = 'pointer';
      countSpan.style.textDecoration = 'underline';
      countSpan.style.color = '#2563eb';
      countSpan.title = 'Click to cycle to the next result';
      countSpan.onclick = function() {
        App.devAgent.focusSearchHit(App.devAgent.currentSearchIndex + 1);
      };
    } else {
      countSpan.style.cursor = 'default';
      countSpan.style.textDecoration = 'none';
      countSpan.style.color = 'inherit';
      countSpan.title = '';
      countSpan.onclick = null;
    }
  }
  
  // Automatically focus the first hit if any exist
  if (hitCount > 0) {
    App.devAgent.focusSearchHit(0);
  }
};

App.devAgent.focusSearchHit = function(index) {
  if (App.devAgent.searchHits.length === 0) return;
  
  if (App.devAgent.currentSearchIndex >= 0 && App.devAgent.currentSearchIndex < App.devAgent.searchHits.length) {
    App.devAgent.searchHits[App.devAgent.currentSearchIndex].classList.remove('active-match');
  }
  
  App.devAgent.currentSearchIndex = index % App.devAgent.searchHits.length;
  if (App.devAgent.currentSearchIndex < 0) {
    App.devAgent.currentSearchIndex += App.devAgent.searchHits.length;
  }
  
  const targetMark = App.devAgent.searchHits[App.devAgent.currentSearchIndex];
  
  const bubble = targetMark.closest('.dev-chat-bubble');
  if (bubble) {
    bubble.classList.add('expanded');
    const wrapper = targetMark.closest('.dev-chat-bubble-wrapper');
    if (wrapper) wrapper.classList.add('expanded');
  }

  targetMark.classList.add('active-match');
  setTimeout(() => {
    targetMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 50);
};

const rogerStopWords = new Set(['i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', "you're", "you've", "you'll", "you'd", 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', "she's", 'her', 'hers', 'herself', 'it', "it's", 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', "that'll", 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', "don't", 'should', "should've", 'now', 'd', 'll', 'm', 'o', 're', 've', 'y', 'ain', 'aren', "aren't", 'couldn', "couldn't", 'didn', "didn't", 'doesn', "doesn't", 'hadn', "hadn't", 'hasn', "hasn't", 'haven', "haven't", 'isn', "isn't", 'ma', 'mightn', "mightn't", 'mustn', "mustn't", 'needn', "needn't", 'shan', "shan't", 'shouldn', "shouldn't", 'wasn', "wasn't", 'weren', "weren't", 'won', "won't", 'wouldn', "wouldn't"]);

App.devAgent.generateGlossary = function() {
  const log = document.getElementById('devChatLog');
  const select = document.getElementById('devGlossarySelect');
  if (!log || !select) return;

  const rawText = log.innerText || log.textContent;
  const words = rawText.match(/\b[a-zA-Z]{4,}\b/g) || [];
  
  const frequency = {};
  words.forEach(w => {
    const lower = w.toLowerCase();
    if (!rogerStopWords.has(lower)) {
      frequency[lower] = (frequency[lower] || 0) + 1;
    }
  });

  const uniqueTerms = Object.keys(frequency).sort((a, b) => frequency[b] - frequency[a]);
  const topTerms = uniqueTerms.slice(0, 40).sort();

  select.textContent = '';
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.disabled = true;
  defaultOpt.selected = true;
  defaultOpt.textContent = 'Keywords';
  select.appendChild(defaultOpt);
  topTerms.forEach(term => {
    const opt = document.createElement('option');
    opt.value = term;
    opt.textContent = term;
    select.appendChild(opt);
  });
};

document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('devToggleCollapseBtn');
  const searchInput = document.getElementById('devSearchInput');
  const log = document.getElementById('devChatLog');
  const glossarySelect = document.getElementById('devGlossarySelect');

  if (toggleBtn && log) {
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      log.classList.toggle('dev-collapsed-mode');
      
      const expandedNodes = log.querySelectorAll('.expanded');
      expandedNodes.forEach(node => node.classList.remove('expanded'));
    });
  }

  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        App.devAgent.applySearchHighlights(e.target.value);
      }, 300);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (App.devAgent.searchHits.length > 0) {
          const step = e.shiftKey ? -1 : 1;
          App.devAgent.focusSearchHit(App.devAgent.currentSearchIndex + step);
        }
      }
    });
  }

  if (glossarySelect && searchInput) {
    glossarySelect.addEventListener('change', (e) => {
      const term = e.target.value;
      if (term) {
        searchInput.value = term;
        App.devAgent.applySearchHighlights(term);
      }
    });
  }

  const testBtn = document.getElementById('devTestBtn');
  if (testBtn) {
    testBtn.addEventListener('click', App.devAgent.testAiConnection);
  }

  const newTaskBtn = document.getElementById('devNewTaskBtn');
  if (newTaskBtn) {
    newTaskBtn.addEventListener('click', App.devAgent.promptNewTask);
  }
  const newProjectTaskBtn = document.getElementById('devNewProjectTaskBtn');
  if (newProjectTaskBtn) {
    newProjectTaskBtn.addEventListener('click', async () => {
      const projectId = document.getElementById('devEditProjectId').value;
      if (!projectId) {
        App.notify('Save the project first before adding tasks.', true);
        return;
      }
      await App.devAgent.createProjectTask(projectId);
    });
  }
});

App.devAgent.promptNewTask = async function() {
  App.devAgent.openTaskEditor(null);
};

App.devAgent.testAiConnection = async function() {
  const btn = document.getElementById('devTestBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Testing...';
  }
  
  try {
    const res = await App.api('/api/develop/devAgent/test', {
      method: 'GET'
    });
    
    if (res.error) {
       App.notify("AI Setup Failed: " + (res.error.message || res.error), true);
    } else {
       App.notify("AI Connection OK! " + JSON.stringify(res.data), false);
    }
  } catch(e) {
    App.notify("Request failed: " + e.message, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Test Connection';
    }
  }
};

// ==========================================
// HITL Friction Logger Implementation
// ==========================================
App.devAgentFriction = {
  elements: {
    form: document.getElementById('devFrictionForm'),
    input: document.getElementById('devFrictionInput'),
    list: document.getElementById('devFrictionList'),
    sidebar: document.getElementById('devFrictionSidebar'),
    toggleBtn: document.getElementById('devFrictionToggleBtn'),
    closeBtn: document.getElementById('devFrictionCloseBtn'),
    leftSidebarList: document.getElementById('devFrictionSidebarList'),
    editorPanelWrapper: document.getElementById('devFrictionEditorPanel'),
    
    // Editor Form Elements
    editorForm: document.getElementById('devFrictionEditorForm'),
    editTitle: document.getElementById('rogerEditFrictionTitle'),
    editSection: document.getElementById('rogerEditFrictionSection'),
    editDesc: document.getElementById('rogerEditFrictionDesc'),
    editStatus: document.getElementById('rogerEditFrictionStatus'),
    editResNotes: document.getElementById('rogerEditFrictionResolution'),
    editorCloseBtn: document.getElementById('rogerCloseFrictionEditorBtn'),
    
    activeLogId: null
  },

  toggleDrawer() {
    if (this.elements.sidebar) {
      this.elements.sidebar.classList.toggle('visible');
    }
  },

  async loadLogs() {
    if (!this.elements.list) return;
    try {
      if (!window.supabaseClient) {
        console.warn("Supabase client not initialized yet.");
        return;
      }
      
      const { data, error } = await window.supabaseClient
        .from('dev_friction_logs')
        .select('id, title, section, description, status, resolution_notes')
        .neq('status', 'documented')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      if (this.elements.list) this.elements.list.textContent = '';
      if (this.elements.leftSidebarList) this.elements.leftSidebarList.textContent = '';

      if (data && data.length > 0) {
        data.forEach(log => {
          // Right drawer generic render
          const li = document.createElement('li');
          li.className = 'dev-friction-item ' + (log.status === 'resolved' ? 'resolved' : '');
          const parserLi = new DOMParser();
          const docLi = parserLi.parseFromString(`
            <div><strong>${log.title || 'New Friction Log'}</strong> - ${log.status.toUpperCase()}</div>
            <div style="font-size:0.8rem; margin-top:0.2rem;">${log.description.substring(0,60)}...</div>
          `, 'text/html');
          li.textContent = '';
          Array.from(docLi.body.childNodes).forEach(n => li.appendChild(n.cloneNode(true)));
          if (this.elements.list) this.elements.list.appendChild(li);

          // Left Sidebar render with inline editing structure
          if (this.elements.leftSidebarList) {
            const sideLi = document.createElement('li');
            sideLi.className = 'dev-session-item' + (this.elements.activeLogId === log.id ? ' active' : '');
            
            const titleSpan = document.createElement('span');
            titleSpan.className = 'session-title';
            titleSpan.textContent = log.title || 'New Friction Log';
            
            // Inline editing via double click
            titleSpan.addEventListener('dblclick', (e) => {
              e.stopPropagation();
              titleSpan.contentEditable = true;
              titleSpan.focus();
              titleSpan.classList.add('editing');
            });
            
            const saveTitle = async () => {
              titleSpan.contentEditable = false;
              titleSpan.classList.remove('editing');
              const newTitle = titleSpan.textContent.trim();
              if (newTitle && newTitle !== log.title) {
                try {
                  await window.supabaseClient.from('dev_friction_logs').update({title: newTitle}).eq('id', log.id);
                  if (this.elements.activeLogId === log.id && this.elements.editTitle) {
                    this.elements.editTitle.value = newTitle;
                  }
                } catch(err) { console.error("Inline edit failed", err); }
              }
            };
            titleSpan.addEventListener('blur', saveTitle);
            titleSpan.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') { e.preventDefault(); saveTitle(); }
            });

            sideLi.appendChild(titleSpan);
            
            // Click to open editor
            sideLi.addEventListener('click', (e) => {
              // Ignore if we are currently editing the title
              if (titleSpan.classList.contains('editing')) return;
              document.querySelectorAll('#devFrictionSidebarList .dev-session-item').forEach(el => el.classList.remove('active'));
              sideLi.classList.add('active');
              this.openEditor(log);
            });
            
            this.elements.leftSidebarList.appendChild(sideLi);
          }
        });
      } else {
        if (this.elements.list) {
          this.elements.list.textContent = '';
          const emptyLi = document.createElement('li');
          emptyLi.className = 'dev-friction-item';
          const emptyDiv = document.createElement('div');
          emptyDiv.style.color = '#666';
          emptyDiv.style.fontStyle = 'italic';
          emptyDiv.style.textAlign = 'center';
          emptyDiv.textContent = 'No unresolved friction logs.';
          emptyLi.appendChild(emptyDiv);
          this.elements.list.appendChild(emptyLi);
        }
        if (this.elements.leftSidebarList) {
          this.elements.leftSidebarList.textContent = '';
          const emptyLi2 = document.createElement('li');
          emptyLi2.className = 'dev-session-item';
          emptyLi2.style.color = '#666';
          emptyLi2.style.fontStyle = 'italic';
          emptyLi2.textContent = 'Nothing logged.';
          this.elements.leftSidebarList.appendChild(emptyLi2);
        }
      }
    } catch (e) {
      console.error("Failed to load friction logs", e);
      if (this.elements.leftSidebarList) {
        this.elements.leftSidebarList.textContent = '';
        const errLi = document.createElement('li');
        errLi.className = 'dev-session-item';
        errLi.style.color = 'red';
        errLi.style.fontSize = '0.75rem';
        errLi.textContent = `Error: ${e.message}`;
        this.elements.leftSidebarList.appendChild(errLi);
      }
    }
  },

  async submitLog(e) {
    e.preventDefault();
    const txt = this.elements.input.value.trim();
    if (!txt) return;

    try {
      if (!window.supabaseClient) throw new Error("Database disconnected.");

      const { data, error } = await window.supabaseClient
        .from('dev_friction_logs')
        .insert([{ description: txt, status: 'open' }]);

      if (!error) {
        this.elements.input.value = '';
        App.notify("Friction Logged successfully.");
        this.loadLogs();
        
        // Auto-ping Roger with context
        const chatInput = document.getElementById('devChatInput');
        if (chatInput && App.devAgent && App.devAgent.submitChat) {
          chatInput.value = `### SYSTEM NOTIFICATION
@Human has logged a new HITL Friction Intervention: "${txt}". 
Please analyze this friction boundary and formulate an architectural plan to engineer this bottleneck out of the system.`;
          App.devAgent.submitChat();
        }
        
      } else {
        App.notify(error.message || "Failed to log friction", true);
      }
    } catch (err) {
      App.notify("Error: " + err.message, true);
    }
  },

  openEditor(log) {
    this.elements.activeLogId = log.id;
    // Hide standard chat internals
    const chatLog = document.getElementById('devChatLog');
    const chatForm = document.getElementById('devChatForm');
    const header = document.querySelector('.dev-chat-main-header');
    
    if (chatLog) chatLog.classList.add('hidden');
    if (chatForm) chatForm.classList.add('hidden');
    if (header) header.classList.add('hidden');
    
    // Show editor panel
    if (this.elements.editorPanelWrapper) this.elements.editorPanelWrapper.classList.remove('hidden');
    
    // Seed fields
    if (this.elements.editTitle) this.elements.editTitle.value = log.title || '';
    if (this.elements.editSection) this.elements.editSection.value = log.section || 'Acquire';
    if (this.elements.editDesc) this.elements.editDesc.value = log.description || '';
    if (this.elements.editStatus) this.elements.editStatus.value = log.status || 'open';
    if (this.elements.editResNotes) this.elements.editResNotes.value = log.resolution_notes || '';
  },

  closeEditor() {
    this.elements.activeLogId = null;
    if (this.elements.editorPanelWrapper) this.elements.editorPanelWrapper.classList.add('hidden');
    App.devAgent.restoreChatPanel();
    
    // Reset selection styling
    document.querySelectorAll('#devFrictionSidebarList .dev-session-item').forEach(el => el.classList.remove('active'));
    App.devAgent.scrollToBottom();
  },

  async saveEditorChanges(e) {
    e.preventDefault();
    if (!this.elements.activeLogId) return;
    
    const payload = {
      title: this.elements.editTitle.value.trim(),
      section: this.elements.editSection ? this.elements.editSection.value : 'Acquire',
      description: this.elements.editDesc.value.trim(),
      status: this.elements.editStatus.value,
      resolution_notes: this.elements.editResNotes.value.trim()
    };
    
    try {
      const { error } = await window.supabaseClient
        .from('dev_friction_logs')
        .update(payload)
        .eq('id', this.elements.activeLogId);
        
      if (!error) {
        App.notify("Friction Log updated successfully.");
        this.loadLogs(); // Refresh lists
        
        if (payload.status === 'documented') {
           this.closeEditor(); // Jump out if documented out of scope
        }
      } else {
        App.notify(error.message || "Failed to update", true);
      }
    } catch(err) {
      App.notify("Error: " + err.message, true);
    }
  },

  init() {
    // Re-bind elements in case it's called late
    this.elements.form = document.getElementById('devFrictionForm');
    this.elements.input = document.getElementById('devFrictionInput');
    this.elements.list = document.getElementById('devFrictionList');
    this.elements.sidebar = document.getElementById('devFrictionSidebar');
    this.elements.toggleBtn = document.getElementById('devFrictionToggleBtn');
    this.elements.closeBtn = document.getElementById('devFrictionCloseBtn');
    
    this.elements.leftSidebarList = document.getElementById('devFrictionSidebarList');
    this.elements.editorPanelWrapper = document.getElementById('devFrictionEditorPanel');
    this.elements.editorForm = document.getElementById('devFrictionEditorForm');
    this.elements.editTitle = document.getElementById('rogerEditFrictionTitle');
    this.elements.editSection = document.getElementById('rogerEditFrictionSection');
    this.elements.editDesc = document.getElementById('rogerEditFrictionDesc');
    this.elements.editStatus = document.getElementById('rogerEditFrictionStatus');
    this.elements.editResNotes = document.getElementById('rogerEditFrictionResolution');
    this.elements.editorCloseBtn = document.getElementById('rogerCloseFrictionEditorBtn');
    
    if (this.elements.form) {
      this.elements.form.addEventListener('submit', (e) => this.submitLog(e));
    }
    if (this.elements.toggleBtn) {
      this.elements.toggleBtn.addEventListener('click', () => this.toggleDrawer());
    }
    if (this.elements.closeBtn) {
      this.elements.closeBtn.addEventListener('click', () => this.toggleDrawer());
    }
    if (this.elements.editorForm) {
      this.elements.editorForm.addEventListener('submit', (e) => this.saveEditorChanges(e));
    }
    if (this.elements.editorCloseBtn) {
      this.elements.editorCloseBtn.addEventListener('click', () => this.closeEditor());
    }
    
    // Bind to the Dev Agent page show event to refresh logs
    document.addEventListener('pageChanged', (e) => {
      if (e.detail && e.detail.pageId === 'devAgentPage') {
        this.loadLogs();
      }
    });

    // Initial load
    this.loadLogs();
  }
};

window.addEventListener('DOMContentLoaded', () => {
  const bootFriction = () => setTimeout(() => App.devAgentFriction.init(), 1000);
  if (typeof App.whenAuthenticated === 'function') {
    App.whenAuthenticated(bootFriction);
  } else {
    bootFriction();
  }
  
  // Bind collapsible sidebar headers
  const toggles = document.querySelectorAll('#devAgentPage .accordion-toggle');
  toggles.forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', !isExpanded);
      const targetId = toggle.getAttribute('aria-controls');
      const targetList = document.getElementById(targetId);
      if (targetList) {
        targetList.style.display = isExpanded ? 'none' : 'block';
      }
    });
  });

  // Bind sidebar nav links mapper
  const navLinks = document.querySelectorAll('.sidebar-nav-link, .accordion-title[data-nav]');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const navItem = link.getAttribute('data-nav');
      if (navItem === 'projects') App.devAgent.loadActionItems();
      else if (navItem === 'tasks') App.devAgent.showTaskBrowser();
      else if (navItem === 'team') App.devAgent.showTeamBrowser();
      else if (navItem === 'forum') App.devAgent.restoreChatPanel();
    });
  });
  
  
  const devNewProjectBtn = document.getElementById('devNewProjectBtn');
  if (devNewProjectBtn) devNewProjectBtn.addEventListener('click', () => App.devAgent.openProjectEditor());
  const devCloseProjectEditorBtn = document.getElementById('devCloseProjectEditorBtn');
  if (devCloseProjectEditorBtn) devCloseProjectEditorBtn.addEventListener('click', App.devAgent.closeProjectEditor);
  const devProjectEditorForm = document.getElementById('devProjectEditorForm');
  if (devProjectEditorForm) devProjectEditorForm.addEventListener('submit', App.devAgent.saveProjectEditor);
  const devEditProjectMemberAddBtn = document.getElementById('devEditProjectMemberAddBtn');
  if (devEditProjectMemberAddBtn) devEditProjectMemberAddBtn.addEventListener('click', App.devAgent.addProjectMember);

  // Tasks binding
  const devCloseTaskEditorBtn = document.getElementById('devCloseTaskEditorBtn');
  if (devCloseTaskEditorBtn) {
    devCloseTaskEditorBtn.addEventListener('click', App.devAgent.closeTaskEditor);
  }
  const devTaskEditorForm = document.getElementById('devTaskEditorForm');
  if (devTaskEditorForm) {
    devTaskEditorForm.addEventListener('submit', App.devAgent.saveTaskEditor);
  }
  
  const devTaskFilterInputs = ['devTaskFilterText', 'devTaskFilterStatus', 'devTaskFilterProject', 'devTaskFilterPriority'];
  devTaskFilterInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', App.devAgent.renderTasksTable);
  });
  
  // Team binding
  const devAddTeamMemberBtn = document.getElementById('devAddTeamMemberBtn');
  if (devAddTeamMemberBtn) {
    devAddTeamMemberBtn.addEventListener('click', () => App.devAgent.openTeamEditor());
  }
  const devNewTeamBtn = document.getElementById('devNewTeamBtn');
  if (devNewTeamBtn && !devNewTeamBtn.dataset.teamBound) {
    devNewTeamBtn.dataset.teamBound = 'true';
    devNewTeamBtn.addEventListener('click', (e) => {
      e.preventDefault();
      App.devAgent.openAddTeamMember();
    });
  }
  const devAssignTeamBtn = document.getElementById('devAssignTeamBtn');
  if (devAssignTeamBtn) {
    devAssignTeamBtn.addEventListener('click', () => App.devAgent.openTeamEditor());
  }
  const devCloseTeamEditorBtn = document.getElementById('devCloseTeamEditorBtn');
  if (devCloseTeamEditorBtn) {
    devCloseTeamEditorBtn.addEventListener('click', App.devAgent.closeTeamEditor);
  }
  const devPickTeamContactBtn = document.getElementById('devPickTeamContactBtn');
  if (devPickTeamContactBtn) {
    devPickTeamContactBtn.addEventListener('click', () => App.devAgent.openContactSelectorModal());
  }
  const devCloseContactSelectorBtn = document.getElementById('devCloseContactSelectorBtn');
  if (devCloseContactSelectorBtn) {
    devCloseContactSelectorBtn.addEventListener('click', App.devAgent.closeContactSelectorModal);
  }
  ['devContactSelectorSearch', 'devContactSelectorCompany', 'devContactSelectorEntityType'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', App.devAgent.filterModalContacts);
    if (el && el.tagName === 'SELECT') el.addEventListener('change', App.devAgent.filterModalContacts);
  });
  const devTeamEditorForm = document.getElementById('devTeamEditorForm');
  if (devTeamEditorForm) {
    devTeamEditorForm.addEventListener('submit', App.devAgent.saveTeamEditor);
  }
  
  // Roles binding
  const devManageRolesBtn = document.getElementById('devManageRolesBtn');
  if (devManageRolesBtn) devManageRolesBtn.addEventListener('click', App.devAgent.showRolesBrowser);
  const devBackToTeamBtn = document.getElementById('devBackToTeamBtn');
  if (devBackToTeamBtn) devBackToTeamBtn.addEventListener('click', App.devAgent.showTeamBrowser);
  const devNewRoleBtn = document.getElementById('devNewRoleBtn');
  const devAddRoleBtn = document.getElementById('devAddRoleBtn');
  const addRoleBtn = devNewRoleBtn || devAddRoleBtn;
  if (addRoleBtn) addRoleBtn.addEventListener('click', () => App.devAgent.openRoleEditor());
  const devCloseRoleEditorBtn = document.getElementById('devCloseRoleEditorBtn');
  if (devCloseRoleEditorBtn) devCloseRoleEditorBtn.addEventListener('click', App.devAgent.closeRoleEditor);
  const devRoleEditorForm = document.getElementById('devRoleEditorForm');
  if (devRoleEditorForm) devRoleEditorForm.addEventListener('submit', App.devAgent.saveRoleEditor);
});

App.devAgent.restoreChatPanel = function() {
  if (App.setActivePage) {
    App.setActivePage('devForumPage');
  }
};




App.devAgent.showTaskBrowser = async function() {
  const pb = document.getElementById('devProjectBrowserPanel'); if(pb) pb.classList.add('hidden');
  const pe = document.getElementById('devProjectEditorPanel'); if(pe) pe.classList.add('hidden');

  const devChatLogEl = document.getElementById('devChatLog'); if (devChatLogEl) devChatLogEl.classList.add('hidden');
  const devChatFormEl = document.getElementById('devChatForm'); if (devChatFormEl) devChatFormEl.classList.add('hidden');
  const devChatMainHeaderEl = document.getElementById('devChatMainHeader'); if (devChatMainHeaderEl) devChatMainHeaderEl.classList.add('hidden');
  const devPersistentOverlayEl = document.getElementById('devPersistentOverlay'); if (devPersistentOverlayEl) devPersistentOverlayEl.classList.add('hidden');
  const fricPanel = document.getElementById('devFrictionEditorPanel'); if(fricPanel) fricPanel.classList.add('hidden');
  const editorPanel = document.getElementById('devTaskEditorPanel'); if(editorPanel) editorPanel.classList.add('hidden');
  const teamBrowserPanel = document.getElementById('devTeamBrowserPanel'); if(teamBrowserPanel) teamBrowserPanel.classList.add('hidden');
  const teamEditorPanel = document.getElementById('devTeamEditorPanel'); if(teamEditorPanel) teamEditorPanel.classList.add('hidden');
  const rolesBrowserPanel = document.getElementById('devRolesBrowserPanel'); if(rolesBrowserPanel) rolesBrowserPanel.classList.add('hidden');
  const roleEditorPanel = document.getElementById('devRoleEditorPanel'); if(roleEditorPanel) roleEditorPanel.classList.add('hidden');
  
  const browserPanel = document.getElementById('devTaskBrowserPanel');
  if (browserPanel) browserPanel.classList.remove('hidden');
  
  App.devAgent.loadTasks(); // Reset sidebar task filter to show all tasks
  
  const tbody = document.getElementById('devTaskBrowserTable');
  
  // Populate project filter dropdown
  const projSelect = document.getElementById('devTaskFilterProject');
  if (projSelect && window.supabaseClient && projSelect.options.length <= 1) {
    const { data: projects } = await window.supabaseClient.from('dev_projects').select('id, name').order('name');
    projSelect.textContent = '';
    const optAll = document.createElement('option');
    optAll.value = 'all';
    optAll.textContent = 'All Projects';
    projSelect.appendChild(optAll);
    if (projects) {
      projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        projSelect.appendChild(opt);
      });
    }
  }

  App.devAgent.loadTasksTable();
};

App.devAgent.getAssigneeName = function(id) {
  if (!id) return 'Unassigned';
  
  const knownAgents = {
    'mentor': 'Mentor',
    'antigravity': 'Roger',
    'roger': 'Angie',
    'angie': 'Angie',
    'archie': 'Archie'
  };
  
  if (knownAgents[id.toLowerCase()]) {
    return knownAgents[id.toLowerCase()];
  }
  
  if (devState && devState.teamData && devState.teamData.contactMap && devState.teamData.contactMap[id]) {
    return devState.teamData.contactMap[id];
  }
  
  if (!id.includes('-') && id.length < 20) {
     return id.charAt(0).toUpperCase() + id.slice(1);
  }
  
  return id;
};

App.devAgent.loadDashboard = async function() {
  if (!document.getElementById('devDashboardKanban')) return;
  if (!window.supabaseClient) return;

  const { data: tasks, error } = await window.supabaseClient.from('dev_tasks').select('*, dev_projects(name)').order('created_at', { ascending: false });
  if (error || !tasks) return;

  const columns = {
    backlog: { el: document.getElementById('colBacklog'), count: document.getElementById('countBacklog'), tasks: [] },
    todo: { el: document.getElementById('colTodo'), count: document.getElementById('countTodo'), tasks: [] },
    in_progress: { el: document.getElementById('colInProgress'), count: document.getElementById('countInProgress'), tasks: [] },
    review: { el: document.getElementById('colReview'), count: document.getElementById('countReview'), tasks: [] },
    completed: { el: document.getElementById('colCompleted'), count: document.getElementById('countCompleted'), tasks: [] }
  };

  tasks.forEach(t => {
    const s = t.status || 'backlog';
    if (columns[s]) columns[s].tasks.push(t);
  });

  Object.values(columns).forEach(col => {
    if (!col.el) return;
    if (col.count) col.count.textContent = col.tasks.length;
    col.el.textContent = '';
    col.tasks.forEach(t => {
      const projectName = t.dev_projects && t.dev_projects.name ? t.dev_projects.name : '-';
      let assigneeName = App.devAgent.getAssigneeName(t.assignee);
      
      const card = document.createElement('div');
      card.className = 'kanban-card';
      card.dataset.status = t.status || 'backlog';
      card.draggable = true;
      card.onclick = () => App.devAgent.openTaskEditor(t.id);
      card.ondragstart = (e) => App.devAgent.handleDragStart(e, t.id);
      
      const parserCard = new DOMParser();
      const docCard = parserCard.parseFromString(`
        <div class="kanban-card-title">${t.title}</div>
        <div class="kanban-card-meta">
          <span title="Project">📌 ${projectName}</span>
          <span class="kanban-priority ${t.priority || 'low'}">${t.priority || 'low'}</span>
        </div>
        <div class="kanban-assignee">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          ${assigneeName}
        </div>
      `, 'text/html');
      card.textContent = '';
      Array.from(docCard.body.childNodes).forEach(n => card.appendChild(n.cloneNode(true)));
      col.el.appendChild(card);
    });
  });
};

App.devAgent.handleDragStart = function(e, taskId) {
  e.dataTransfer.setData('text/plain', taskId);
  e.dataTransfer.effectAllowed = 'move';
  // Small timeout to allow the drag image to capture the element before we change its style
  setTimeout(() => { e.target.style.opacity = '0.5'; }, 0);
};

App.devAgent.handleDragOver = function(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const column = e.target.closest('.kanban-column-body');
  if (column && !column.classList.contains('drag-over')) {
    column.classList.add('drag-over');
  }
};

App.devAgent.handleDragLeave = function(e) {
  e.preventDefault();
  const column = e.target.closest('.kanban-column-body');
  if (column) {
    column.classList.remove('drag-over');
  }
};

App.devAgent.handleDrop = async function(e, newStatus) {
  e.preventDefault();
  const column = e.target.closest('.kanban-column-body');
  if (column) {
    column.classList.remove('drag-over');
  }
  
  const taskId = e.dataTransfer.getData('text/plain');
  if (!taskId) return;
  
  // Find the card element and restore opacity
  const draggedCard = document.querySelector(`.kanban-card[draggable="true"]`);
  if (draggedCard) draggedCard.style.opacity = '1';
  
  try {
    const { error } = await window.supabaseClient.from('dev_tasks').update({ status: newStatus }).eq('id', taskId);
    if (error) throw error;
    
    // Refresh the dashboard and task lists
    App.notify('Task status updated.');
    App.devAgent.loadActionItems();
    App.devAgent.loadTasks(); // refreshes the sidebar lists and tables if active
  } catch(err) {
    App.notify('Failed to update task status: ' + err.message, true);
    App.devAgent.loadActionItems(); // revert visual state
  }
};

App.devAgent.tasksSortKey = 'created_at';
App.devAgent.tasksSortAsc = false;

App.devAgent.sortTasks = function(key) {
  if (App.devAgent.tasksSortKey === key) {
    App.devAgent.tasksSortAsc = !App.devAgent.tasksSortAsc;
  } else {
    App.devAgent.tasksSortKey = key;
    App.devAgent.tasksSortAsc = true;
  }
  App.devAgent.renderTasksTable();
};

App.devAgent.loadTasksTable = async function() {
  const tbody = document.getElementById('devTaskBrowserTable');
  if (tbody && window.supabaseClient) {
    tbody.textContent = '';
    const loadingTr = document.createElement('tr');
    const loadingTd = document.createElement('td');
    loadingTd.colSpan = 7;
    loadingTd.style.padding = '1rem';
    loadingTd.style.opacity = '0.7';
    loadingTd.style.textAlign = 'center';
    loadingTd.textContent = 'Loading tasks...';
    loadingTr.appendChild(loadingTd);
    tbody.appendChild(loadingTr);
    
    const { data: tasks, error } = await window.supabaseClient.from('dev_tasks').select('*, dev_projects(name)').order('created_at', { ascending: false });
    
    if (error) {
      tbody.textContent = '';
      const errTr = document.createElement('tr');
      const errTd = document.createElement('td');
      errTd.colSpan = 7;
      errTd.style.textAlign = 'center';
      errTd.style.color = 'red';
      errTd.textContent = 'Failed to fetch.';
      errTr.appendChild(errTd);
      tbody.appendChild(errTr);
      return;
    }
    
    devState.allTasks = tasks || [];
    
    // Normalize data for easy sorting
    devState.allTasks.forEach(t => {
      t.project_name = t.dev_projects && t.dev_projects.name ? t.dev_projects.name : '';
      t.assignee_name = App.devAgent.getAssigneeName(t.assignee) || '';
    });
    
    App.devAgent.renderTasksTable();
  }
};

App.devAgent.renderTasksTable = function() {
  const tbody = document.getElementById('devTaskBrowserTable');
  if (!tbody) return;
  
  if (!devState.allTasks) {
    tbody.textContent = '';
    const loadingTr2 = document.createElement('tr');
    const loadingTd2 = document.createElement('td');
    loadingTd2.colSpan = 7;
    loadingTd2.style.padding = '1rem';
    loadingTd2.style.opacity = '0.7';
    loadingTd2.style.textAlign = 'center';
    loadingTd2.textContent = 'Loading tasks...';
    loadingTr2.appendChild(loadingTd2);
    tbody.appendChild(loadingTr2);
    return;
  }
  
  const filterText = (document.getElementById('devTaskFilterText')?.value || '').toLowerCase();
  const filterStatus = document.getElementById('devTaskFilterStatus')?.value || 'all';
  const filterProject = document.getElementById('devTaskFilterProject')?.value || 'all';
  const filterPriority = document.getElementById('devTaskFilterPriority')?.value || 'all';
  
  let filtered = devState.allTasks.filter(t => {
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    if (filterProject !== 'all' && t.project_id !== filterProject) return false;
    if (filterPriority !== 'all' && t.priority !== filterPriority) return false;
    if (filterText) {
      if (!((t.title && t.title.toLowerCase().includes(filterText)) ||
            (t.project_name && t.project_name.toLowerCase().includes(filterText)) ||
            (t.assignee_name && t.assignee_name.toLowerCase().includes(filterText)))) {
        return false;
      }
    }
    return true;
  });
  
  const key = App.devAgent.tasksSortKey;
  const asc = App.devAgent.tasksSortAsc;
  
  filtered.sort((a, b) => {
    let valA = a[key] !== undefined ? a[key] : '';
    let valB = b[key] !== undefined ? b[key] : '';
    
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    
    if (valA < valB) return asc ? -1 : 1;
    if (valA > valB) return asc ? 1 : -1;
    return 0;
  });
  
  // Update UI icons
  const keys = ['title', 'project_name', 'status', 'priority', 'assignee_name', 'created_at'];
  keys.forEach(k => {
    const el = document.getElementById(`sortIcon_task_${k}`);
    if (el) {
      if (k === key) {
        el.textContent = asc ? ' ▲' : ' ▼';
      } else {
        el.textContent = '';
      }
    }
  });

  tbody.textContent = '';
  if (filtered.length === 0) {
    const emptyTr = document.createElement('tr');
    const emptyTd = document.createElement('td');
    emptyTd.colSpan = 7;
    emptyTd.style.padding = '1rem';
    emptyTd.style.opacity = '0.7';
    emptyTd.style.textAlign = 'center';
    emptyTd.textContent = 'No matching tasks found.';
    emptyTr.appendChild(emptyTd);
    tbody.appendChild(emptyTr);
    return;
  }
  
  filtered.forEach(t => {
    const projectName = t.project_name || '-';
    let assigneeName = t.assignee_name;

    const tr = document.createElement('tr');
    tr.textContent = '';
    
    const tdId = document.createElement('td');
    tdId.style.fontFamily = 'monospace';
    tdId.style.fontSize = '0.8em';
    tdId.style.color = 'var(--text-muted)';
    tdId.textContent = t.id.substring(0,8);
    tr.appendChild(tdId);
    
    const tdTitle = document.createElement('td');
    tdTitle.style.textAlign = 'left';
    tdTitle.style.whiteSpace = 'nowrap';
    tdTitle.style.overflow = 'hidden';
    tdTitle.style.textOverflow = 'ellipsis';
    const strongTitle = document.createElement('strong');
    strongTitle.textContent = t.title;
    tdTitle.appendChild(strongTitle);
    tr.appendChild(tdTitle);
    
    const tdProj = document.createElement('td');
    tdProj.textContent = projectName;
    tr.appendChild(tdProj);
    
    const tdStatus = document.createElement('td');
    tdStatus.textContent = t.status || '-';
    tr.appendChild(tdStatus);
    
    const tdPrio = document.createElement('td');
    tdPrio.textContent = t.priority || '-';
    tr.appendChild(tdPrio);
    
    const tdAss = document.createElement('td');
    tdAss.textContent = assigneeName;
    tr.appendChild(tdAss);
    
    const tdDate = document.createElement('td');
    tdDate.textContent = new Date(t.created_at).toLocaleDateString();
    tr.appendChild(tdDate);
    
    const tdActions = document.createElement('td');
    tdActions.style.textAlign = 'center';
    tdActions.style.whiteSpace = 'nowrap';
    tdActions.style.gap = '0.5rem';
    tdActions.style.display = 'flex';
    tdActions.style.justifyContent = 'center';
    
    const parserSvg = new DOMParser();
    const docBtns = parserSvg.parseFromString(`
        <button class="icon-btn" onclick="App.devAgent.openTaskEditor('${t.id}')" title="Edit Task">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
        <button class="icon-btn" onclick="App.devAgent.cloneTask('${t.id}')" title="Clone Task">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
        <button class="icon-btn danger-hover" onclick="App.devAgent.deleteTask('${t.id}')" title="Delete Task">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
    `, 'text/html');
    Array.from(docBtns.body.childNodes).forEach(n => tdActions.appendChild(n.cloneNode(true)));
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });
};

App.devAgent.openTaskEditor = async function(taskId, returnToProjectId = null) {
  devState.skipNextBrowserReset = true;
  App.setActivePage('devTasksPage');
  devState.returnToProjectEditorId = returnToProjectId || null;
  const devPersistentOverlayEl = document.getElementById('devPersistentOverlay'); if (devPersistentOverlayEl) devPersistentOverlayEl.classList.add('hidden');
  const fricPanel = document.getElementById('devFrictionEditorPanel'); if(fricPanel) fricPanel.classList.add('hidden');
  const browserPanel = document.getElementById('devTaskBrowserPanel'); if(browserPanel) browserPanel.classList.add('hidden');
  const kanban = document.getElementById('devDashboardKanban'); if(kanban) { kanban.classList.add('hidden'); kanban.style.display = 'none'; }
  const teamBrowserPanel = document.getElementById('devTeamBrowserPanel'); if(teamBrowserPanel) teamBrowserPanel.classList.add('hidden');
  const teamEditorPanel = document.getElementById('devTeamEditorPanel'); if(teamEditorPanel) teamEditorPanel.classList.add('hidden');
  const rolesBrowserPanel = document.getElementById('devRolesBrowserPanel'); if(rolesBrowserPanel) rolesBrowserPanel.classList.add('hidden');
  const roleEditorPanel = document.getElementById('devRoleEditorPanel'); if(roleEditorPanel) roleEditorPanel.classList.add('hidden');

  const panel = document.getElementById('devTaskEditorPanel');
  if (panel) {
    panel.classList.remove('hidden');
    document.getElementById('devTaskEditorHeader').textContent = 'Loading...';

    
    // Default hide the new thread button until existing task is confirmed
    const newThreadBtn = document.getElementById('devTaskNewThreadBtn');
    if (newThreadBtn) newThreadBtn.classList.add('hidden');
    try {
      // Fetch available projects for the dropdown
      const { data: projects } = await window.supabaseClient.from('dev_projects').select('id, name').order('name');
      const projSelect = document.getElementById('devEditTaskProject');
      if (projSelect) {
        projSelect.textContent = '';
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '-- No Project --';
        projSelect.appendChild(defaultOpt);
        if (projects) {
          projects.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            projSelect.appendChild(opt);
          });
        }
      }

      // Populate Assignee Dropdown dynamically
      const assgSel = document.getElementById('devEditTaskAssignee');
      if (assgSel) {
        assgSel.textContent = '';
        const defaultAssg = document.createElement('option');
        defaultAssg.value = '';
        defaultAssg.textContent = '-- Select Assignee --';
        assgSel.appendChild(defaultAssg);
        try {
          const coreTeam = ['mentor', 'roger', 'angie', 'archie'];
          coreTeam.forEach(id => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = App.devAgent.getAssigneeName(id);
            assgSel.appendChild(opt);
          });
        } catch(assgErr) {
          console.error("Error populating assignees:", assgErr);
        }
      }

      if (!taskId) {
        // NEW TASK MODE
        document.getElementById('devTaskEditorHeader').textContent = 'New Task';
        const viewProjBtn = document.getElementById('devTasksViewProjectBtn'); if(viewProjBtn) viewProjBtn.classList.add('hidden');
        const sessionTitle = document.getElementById('devActiveSessionTitle');
        if (sessionTitle) sessionTitle.textContent = `New Task`;
        document.getElementById('devEditTaskId').value = '';
        document.getElementById('devEditTaskTitle').value = '';
        document.getElementById('devEditTaskDesc').value = '';
        const statusSel = document.getElementById('devEditTaskStatus'); if (statusSel) statusSel.value = 'todo';
        const prioSel = document.getElementById('devEditTaskPriority'); if (prioSel) prioSel.value = 'medium';
        if (projSelect && returnToProjectId) {
          projSelect.value = returnToProjectId;
        } else if (projSelect) {
          projSelect.value = '';
        }
        
        const projContext = document.getElementById('devTaskProjectContext');
        if (projContext) {
          projContext.textContent = '';
          const pEl = document.createElement('p');
          pEl.style.color = 'var(--text-muted)';
          pEl.style.fontStyle = 'italic';
          pEl.textContent = 'Save the task to see project context.';
          projContext.appendChild(pEl);
        }
        
        const chatContainer = document.getElementById('devTaskChatContainer');
        if (chatContainer) {
          chatContainer.textContent = '';
          const infoDiv = document.createElement('div');
          infoDiv.style.padding = '2rem';
          infoDiv.style.color = 'var(--text-muted)';
          infoDiv.style.fontStyle = 'italic';
          infoDiv.style.textAlign = 'center';
          infoDiv.textContent = 'Save the task to start a discussion.';
          chatContainer.appendChild(infoDiv);
        }
        
        return; // Stop here for new tasks
      }

      // EXISTING TASK MODE
      
      if (newThreadBtn) newThreadBtn.classList.remove('hidden');

      const { data: log, error } = await window.supabaseClient.from('dev_tasks').select('*').eq('id', taskId).single();
      if (error) throw error;
      document.getElementById('devTaskEditorHeader').textContent = 'Task Details';
      const sessionTitle = document.getElementById('devActiveSessionTitle');
      if (sessionTitle) sessionTitle.textContent = `Task: ${log.title}`;
      
      // Lazy load a dev_session for this task if it doesn't exist
      if (!log.session_id) {
        try {
          const sessionRes = await App.api('/api/develop/devAgent/sessions', {
             method: 'POST',
             body: JSON.stringify({ name: `Task: ${log.title}`, projectId: log.project_id || null })
          });
          
          if (sessionRes && sessionRes.data && sessionRes.data.id) {
             log.session_id = sessionRes.data.id;
             await window.supabaseClient.from('dev_tasks').update({ session_id: log.session_id }).eq('id', log.id);
             await App.devAgent.loadSessions(); // Refresh the sidebar
          } else {
             console.error("Failed to auto-create session for task:", sessionRes.error);
          }
        } catch (sessionErr) {
          console.error("Error creating task session:", sessionErr);
        }
      }
      
      // Fetch project context and peer tasks
      if (log.project_id) {
         const { data: project } = await window.supabaseClient.from('dev_projects').select('name, description').eq('id', log.project_id).single();
         const { data: peers } = await window.supabaseClient.from('dev_tasks').select('id, title, status').eq('project_id', log.project_id).neq('id', log.id);
         
         let html = `<h3 style="margin-top:0;">Project: ${project ? project.name : 'Unknown'}</h3>`;
         if (project && project.description) {
           html += `<p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.5rem;">${project.description}</p>`;
         }
         
         html += `<h4 style="margin-bottom:0.5rem; border-bottom:1px solid var(--border-light); padding-bottom:0.25rem;">Peer Tasks</h4>`;
         if (peers && peers.length > 0) {
           html += `<ul style="list-style: none; padding: 0; margin: 0; font-size: 0.85rem;">`;
           peers.forEach(p => {
             html += `<li style="padding: 0.5rem 0; border-bottom: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items:center;">
               <span style="font-weight:500;">${p.title}</span>
               <span style="color: var(--text-muted); font-size:0.75rem; background:var(--bg-hover); padding:0.1rem 0.4rem; border-radius:1rem;">${p.status}</span>
             </li>`;
           });
           html += `</ul>`;
         } else {
           html += `<p style="font-size: 0.85rem; color: var(--text-muted);">No other tasks in this project.</p>`;
         }
         
         const projContext = document.getElementById('devTaskProjectContext');
         if (projContext) {
           const parserHtml = new DOMParser();
           const docHtml = parserHtml.parseFromString(html, 'text/html');
           projContext.textContent = '';
           Array.from(docHtml.body.childNodes).forEach(n => projContext.appendChild(n.cloneNode(true)));
         }
      } else {
         const projContext = document.getElementById('devTaskProjectContext');
         if (projContext) {
           projContext.textContent = '';
           const errP = document.createElement('p');
           errP.style.color = 'var(--text-muted)';
           errP.style.fontStyle = 'italic';
           errP.textContent = 'Task does not belong to a project.';
           projContext.appendChild(errP);
         }
      }

      // Load the session into the chat log
      const chatContainer = document.getElementById('devTaskChatContainer');
      if (chatContainer) {
        if (log.session_id) {
           devState.activeSessionId = log.session_id; // Set active session for the chat form
           chatContainer.textContent = '';
           const logDiv = document.createElement('div');
           logDiv.className = 'dev-chat-log';
           logDiv.style.flex = '1';
           logDiv.style.overflowY = 'auto';
           chatContainer.appendChild(logDiv);
           
           // Clone chat form template
           const template = document.getElementById('devChatFormTemplate');
           if (template) {
             const formClone = template.content.cloneNode(true);
             chatContainer.appendChild(formClone);
             
             // Bind form submit event
             const form = chatContainer.querySelector('.dev-inline-chat-form');
             if (form) {
               form.addEventListener('submit', (e) => {
                 e.preventDefault();
                 App.devAgent.submitChat(form);
               });
               
               // Bind file trigger
               const fileTrigger = form.querySelector('.dev-file-trigger-btn');
               const fileInput = form.querySelector('.dev-chat-file');
               if (fileTrigger && fileInput) {
                  fileTrigger.addEventListener('click', () => fileInput.click());
                  fileInput.addEventListener('change', (e) => {
                     if (App.devAgent.handleFileSelect) {
                         App.devAgent.handleFileSelect(e, form);
                     }
                  });
               }
             }
           }
           
           App.devAgent.loadHistory(log.session_id, chatContainer.querySelector('.dev-chat-log'));
        } else {
           chatContainer.textContent = '';
           const failDiv = document.createElement('div');
           failDiv.style.padding = '2rem';
           failDiv.style.color = 'var(--text-muted)';
           failDiv.style.fontStyle = 'italic';
           failDiv.style.textAlign = 'center';
           failDiv.textContent = 'Failed to initialize discussion thread.';
           chatContainer.appendChild(failDiv);
        }
      }

      document.getElementById('devEditTaskId').value = log.id;
      document.getElementById('devEditTaskTitle').value = log.title || '';
      document.getElementById('devEditTaskDesc').value = log.description || '';
      let statusSel = document.getElementById('devEditTaskStatus'); if(statusSel) statusSel.value = log.status || 'todo';
      let prioSel = document.getElementById('devEditTaskPriority'); if(prioSel) prioSel.value = log.priority || 'medium';
      
      let projSel = document.getElementById('devEditTaskProject');
      if (projSel) projSel.value = log.project_id || '';
      const viewProjBtn = document.getElementById('devTasksViewProjectBtn');
      if (viewProjBtn) {
        if (log.project_id) viewProjBtn.classList.remove('hidden');
        else viewProjBtn.classList.add('hidden');
      }

      // Ensure correct assignee is selected
      const assgSelExisting = document.getElementById('devEditTaskAssignee');
      if (assgSelExisting) {
        assgSelExisting.value = log.assignee || '';
      }
    } catch (e) {
      console.error("Task Editor Error:", e);
      document.getElementById('devTaskEditorHeader').textContent = 'Task Unresolved (' + e.message + ')';
    }
  }
};

App.devAgent.createNewTaskThread = async function() {
  const taskId = document.getElementById('devEditTaskId').value;
  if (!taskId) return;
  
  if (!confirm('Start a new discussion thread for this task? The current thread history will be preserved but detached from this task view.')) return;
  
  try {
    const { data: log, error } = await window.supabaseClient.from('dev_tasks').select('*').eq('id', taskId).single();
    if (error) throw error;
    
    // Create new session via backend to trigger agent notification
    const res = await App.api(`/api/tasks/${taskId}/thread`, {
      method: 'POST'
    });
    
    if (res && res.data && res.data.session_id) {
      App.notify('New discussion thread created.', false);
      // Reload task editor
      App.devAgent.openTaskEditor(taskId);
      await App.devAgent.loadSessions(); // refresh sidebar
    } else {
      throw new Error(res.error || 'Failed to create new thread');
    }
  } catch (err) {
    App.notify('Failed to create new thread: ' + err.message, true);
  }
};

App.devAgent.saveTaskEditor = async function(e) {
  e.preventDefault();
  const taskId = document.getElementById('devEditTaskId').value;
  const payload = {
    title: document.getElementById('devEditTaskTitle').value,
    description: document.getElementById('devEditTaskDesc').value,
    status: document.getElementById('devEditTaskStatus') ? document.getElementById('devEditTaskStatus').value : 'todo',
    priority: document.getElementById('devEditTaskPriority') ? document.getElementById('devEditTaskPriority').value : 'medium',
    assignee: document.getElementById('devEditTaskAssignee') ? document.getElementById('devEditTaskAssignee').value : 'mentor',
    project_id: document.getElementById('devEditTaskProject') && document.getElementById('devEditTaskProject').value !== "" ? document.getElementById('devEditTaskProject').value : null,
  };
  try {
    if (taskId) {
      const res = await App.api('/api/tasks/' + taskId, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      if (res.error) throw new Error(res.error);
    } else {
      const res = await App.api('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (res.error) throw new Error(res.error);
    }
    App.notify('Task saved.', false);
    App.devAgent.loadTasks(); // refresh sidebar bounds
    if (devState.returnToProjectEditorId) {
      const projectId = devState.returnToProjectEditorId;
      devState.returnToProjectEditorId = null;
      App.devAgent.openProjectEditor(projectId);
    } else {
      App.devAgent.showTaskBrowser(); // switch panel back to list
    }
  } catch (err) {
    App.notify('Failed to save task: ' + err.message, true);
  }
};

App.devAgent.closeTaskEditor = function() {
  document.getElementById('devTaskEditorPanel').classList.add('hidden');
  if (devState.returnToProjectEditorId) {
    const projectId = devState.returnToProjectEditorId;
    devState.returnToProjectEditorId = null;
    App.devAgent.openProjectEditor(projectId);
    return;
  }
  App.devAgent.restoreChatPanel();
};

// ==========================================
// Dev Team Module Functions
// ==========================================

App.devAgent.currentTeamProjectId = function() {
  const fromState = String(App.state?.currentProjectId || '').trim();
  if (fromState) return fromState;
  try {
    const key = App.CURRENT_PROJECT_ID_STORAGE_KEY || 'alphire.currentProjectId';
    return String(window.localStorage.getItem(key) || '').trim();
  } catch (_) {
    return '';
  }
};

App.devAgent.ensureProjectContext = async function() {
  const existing = App.devAgent.currentTeamProjectId();
  if (existing) {
    if (!String(App.state?.currentProjectId || '').trim()) {
      App.state.currentProjectId = existing;
    }
    return existing;
  }
  try {
    const current = await App.api('/api/projects/current', { method: 'GET' });
    const project = current?.project || current?.data?.project || null;
    const id = String(project?.id || '').trim();
    if (id) {
      App.state.currentProjectId = id;
      App.state.currentProject = project;
      const key = App.CURRENT_PROJECT_ID_STORAGE_KEY || 'alphire.currentProjectId';
      window.localStorage.setItem(key, id);
      return id;
    }
  } catch (_) {
    // fall through
  }
  return '';
};

App.devAgent.updateTeamPageHeading = async function() {
  const titleEl = document.getElementById('devTeamPageTitle');
  if (!titleEl) return;
  const base = 'Dev Agent: Team';
  try {
    const projectId = await App.devAgent.ensureProjectContext();
    if (!projectId) {
      titleEl.textContent = base;
      return;
    }
    let name = '';
    if (App.state?.currentProject?.id === projectId && App.state.currentProject?.name) {
      name = String(App.state.currentProject.name).trim();
    }
    if (!name) {
      const current = await App.api('/api/projects/current', { method: 'GET' });
      const project = current?.project || current?.data?.project || null;
      if (project?.id === projectId && project?.name) {
        name = String(project.name).trim();
        App.state.currentProject = project;
        App.state.currentProjectId = project.id;
      }
    }
    if (!name && Array.isArray(App.state?.projects)) {
      const match = App.state.projects.find((p) => p.id === projectId);
      if (match?.name) name = String(match.name).trim();
    }
    titleEl.textContent = name ? `${base} (${name})` : base;
  } catch (_) {
    titleEl.textContent = base;
  }
};

App.devAgent.populateDevRolesSelect = async function(selectEl, preselectedRole) {
  if (!selectEl) return;
  selectEl.textContent = '';
  const loadOpt = document.createElement('option');
  loadOpt.value = '';
  loadOpt.textContent = 'Loading roles...';
  selectEl.appendChild(loadOpt);

  const projectId = await App.devAgent.ensureProjectContext();
  if (!projectId) {
    selectEl.textContent = '';
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Select a project first';
    selectEl.appendChild(opt);
    return;
  }

  try {
    const res = await App.api('/api/develop/devAgent/roles');
    const roles = res.roles || res.data || [];
    selectEl.textContent = '';
    const selOpt = document.createElement('option');
    selOpt.value = '';
    selOpt.textContent = 'Select Role...';
    selectEl.appendChild(selOpt);
    if (!roles.length) {
      const emptyOpt = document.createElement('option');
      emptyOpt.value = '';
      emptyOpt.textContent = 'No roles — create under Dev Agent → Roles';
      emptyOpt.disabled = true;
      selectEl.appendChild(emptyOpt);
      return;
    }
    roles.forEach((r) => {
      const roleName = String(r.role_name || r.roleName || '').trim();
      if (!roleName) return;
      const opt = document.createElement('option');
      opt.value = roleName;
      opt.textContent = roleName;
      if (preselectedRole && roleName === preselectedRole) opt.selected = true;
      selectEl.appendChild(opt);
    });
  } catch (err) {
    selectEl.textContent = '';
    const errOpt = document.createElement('option');
    errOpt.value = '';
    errOpt.textContent = 'Failed to load roles';
    selectEl.appendChild(errOpt);
  }
};

App.devAgent.teamAccountStatusLabel = function(member) {
  const status = String(member?.accountStatus || member?.account_status || 'not_invited').trim();
  if (status === 'active') return 'Active';
  if (status === 'invite_pending') return 'Invite Pending';
  return 'Not Invited';
};

App.devAgent.sendTeamInvitation = async function(teamId, options = {}) {
  const id = String(teamId || '').trim();
  if (!id) return;
  const resend = Boolean(options.resend);
  const path = resend
    ? `/api/develop/devAgent/team/${encodeURIComponent(id)}/invite/resend`
    : `/api/develop/devAgent/team/${encodeURIComponent(id)}/invite`;
  try {
    await App.api(path, { method: 'POST' });
    if (App.components?.Toast?.show) {
      App.components.Toast.show(resend ? 'Invitation resent.' : 'Invitation sent.', 'success');
    } else {
      App.notify(resend ? 'Invitation resent.' : 'Invitation sent.', false);
    }
    await App.devAgent.showTeamBrowser();
  } catch (err) {
    const msg = err?.message || err?.error?.message || 'Failed to send invitation';
    if (App.components?.Toast?.show) App.components.Toast.show(msg, 'error');
    else App.notify(msg, true);
  }
};

App.devAgent.revokeTeamInvitation = async function(teamId) {
  const id = String(teamId || '').trim();
  if (!id) return;
  if (!window.confirm('Revoke the pending invitation for this team member?')) return;
  try {
    await App.api(`/api/develop/devAgent/team/${encodeURIComponent(id)}/invite`, { method: 'DELETE' });
    if (App.components?.Toast?.show) App.components.Toast.show('Invitation revoked.', 'success');
    else App.notify('Invitation revoked.', false);
    await App.devAgent.showTeamBrowser();
  } catch (err) {
    const msg = err?.message || err?.error?.message || 'Failed to revoke invitation';
    if (App.components?.Toast?.show) App.components.Toast.show(msg, 'error');
    else App.notify(msg, true);
  }
};

App.devAgent.normalizeTeamMembersResponse = function(res) {
  if (Array.isArray(res?.members)) return res.members;
  if (Array.isArray(res?.data)) return res.data;
  if (res?.data && Array.isArray(res.data.members)) return res.data.members;
  return [];
};

App.devAgent.loadTeamMembersFromApi = async function() {
  const projectId = await App.devAgent.ensureProjectContext();
  if (!projectId) {
    return {
      members: [],
      error: new Error('Select an active project in Settings → Projects, then try again.'),
    };
  }
  try {
    const res = await App.api('/api/develop/devAgent/team');
    return { members: App.devAgent.normalizeTeamMembersResponse(res), error: null };
  } catch (err) {
    return { members: [], error: err };
  }
};

App.devAgent.contactDisplayName = function(contact) {
  if (!contact) return '';
  if (typeof App.contacts?.contactValue === 'function') {
    const first = App.contacts.contactValue(contact, 'first_name');
    const last = App.contacts.contactValue(contact, 'last_name');
    const full = `${first} ${last}`.trim();
    if (full) return full;
    const email = App.contacts.contactValue(contact, 'email');
    if (email) return email;
  }
  const full = `${contact.first_name || contact.firstName || ''} ${contact.last_name || contact.lastName || ''}`.trim();
  return full || contact.email || contact.id || '';
};

App.devAgent.contactEntityType = function(contact) {
  if (!contact) return 'Human';
  if (typeof App.contacts?.contactValue === 'function') {
    return App.contacts.contactValue(contact, 'entity_type') || 'Human';
  }
  return contact.entity_type || contact.entityType || 'Human';
};

App.devAgent.contactTypeLabel = function(contact) {
  if (!contact) return '';
  if (typeof App.contacts?.contactValue === 'function') {
    return App.contacts.contactValue(contact, 'contact_type') || App.contacts.contactValue(contact, 'contactType') || '';
  }
  return contact.contact_type || contact.contactType || '';
};

App.devAgent.buildTeamContactMap = function(teamMembers, contacts) {
  const map = {};
  const contactsById = {};
  (contacts || []).forEach((c) => {
    const id = String(c?.id || '').trim();
    if (!id) return;
    map[id] = App.devAgent.contactDisplayName(c);
    contactsById[id] = c;
  });
  (teamMembers || []).forEach((m) => {
    const id = String(m?.contact_id || '').trim();
    if (id && !map[id]) map[id] = '';
  });
  return { map, contactsById };
};

App.devAgent.hydrateTeamContactMap = async function(map, contactsById, teamMembers) {
  const missingIds = [...new Set(
    (teamMembers || [])
      .map((m) => String(m?.contact_id || '').trim())
      .filter((id) => id && !map[id])
  )].slice(0, 25);
  if (!missingIds.length) return;
  await Promise.all(missingIds.map(async (id) => {
    try {
      const res = await App.api(`/api/contacts/${encodeURIComponent(id)}`);
      const contact = res?.contact || res?.data;
      if (contact?.id) {
        map[contact.id] = App.devAgent.contactDisplayName(contact);
        contactsById[contact.id] = contact;
      }
    } catch (_) {
      // Contact may be outside current project scope
    }
  }));
};

App.devAgent.afterTeamContactCreated = async function(contact) {
  App.setActivePage('devTeamPage');
  const id = String(contact?.id || '').trim();
  const name = App.devAgent.contactDisplayName(contact);
  if (!id) {
    App.devAgent.showTeamBrowser();
    return;
  }
  await App.devAgent.openTeamEditorWithContact(id, name);
};

App.devAgent.openTeamEditorWithContact = async function(contactId, displayName) {
  await App.devAgent.openTeamEditor();
  const idInput = document.getElementById('devEditTeamContactId');
  const displayInput = document.getElementById('devEditTeamContactDisplay');
  if (idInput) idInput.value = String(contactId || '').trim();
  if (displayInput) displayInput.value = String(displayName || '').trim();
};

App.devAgent.loadTeam = async function() {
  const teamList = document.getElementById('devTeamList');
  if (!teamList) return;
  try {
    teamList.textContent = '';
    const loadLi = document.createElement('li');
    loadLi.style.padding = '1rem';
    loadLi.style.opacity = '0.7';
    loadLi.textContent = 'Loading...';
    teamList.appendChild(loadLi);
    
    const { members: teamMembers, error } = await App.devAgent.loadTeamMembersFromApi();
      
    teamList.textContent = '';
    
    if (error) {
      teamList.textContent = '';
      const errLi = document.createElement('li');
      errLi.className = 'error-msg';
      errLi.textContent = error.message || 'Failed to load team';
      teamList.appendChild(errLi);
      return;
    }

    devState.teamData = { members: teamMembers };
    
    if (teamMembers.length === 0) {
      teamList.textContent = '';
      const noLi = document.createElement('li');
      noLi.className = 'dev-session-item';
      noLi.style.color = '#666';
      noLi.style.fontStyle = 'italic';
      noLi.textContent = 'No team members.';
      teamList.appendChild(noLi);
      return;
    }

    teamMembers.forEach(member => {
      const li = document.createElement('li');
      li.className = 'dev-session-item';
      li.dataset.teamId = member.id;
      
      const titleSpan = document.createElement('span');
      titleSpan.className = 'session-title';
      titleSpan.textContent = member.member_name || App.devAgent.contactDisplayName(member.contact) || 'Unknown Member';
      
      // Navigate to Contact profile on click
      li.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof App.contacts?.openEditPage === 'function') {
          void App.contacts.openEditPage(member.contact || member.contact_id, 'devTeamPage');
        }
      });
      
      li.appendChild(titleSpan);
      teamList.appendChild(li);
    });
  } catch (e) {
    teamList.textContent = '';
    const errorLi = document.createElement('li');
    errorLi.className = 'error-msg';
    errorLi.textContent = 'Error loading team.';
    teamList.appendChild(errorLi);
  }
};

App.devAgent._teamBrowserLoadSeq = 0;

App.devAgent.showTeamBrowser = async function() {
  const loadSeq = ++App.devAgent._teamBrowserLoadSeq;
  const isStale = () => loadSeq !== App.devAgent._teamBrowserLoadSeq;

  await App.devAgent.ensureProjectContext();
  void App.devAgent.updateTeamPageHeading();
  const pb = document.getElementById('devProjectBrowserPanel'); if(pb) pb.classList.add('hidden');
  const pe = document.getElementById('devProjectEditorPanel'); if(pe) pe.classList.add('hidden');

  const devChatLogEl = document.getElementById('devChatLog'); if (devChatLogEl) devChatLogEl.classList.add('hidden');
  const devChatFormEl = document.getElementById('devChatForm'); if (devChatFormEl) devChatFormEl.classList.add('hidden');
  const devChatMainHeaderEl = document.getElementById('devChatMainHeader'); if (devChatMainHeaderEl) devChatMainHeaderEl.classList.add('hidden');
  const devPersistentOverlayEl = document.getElementById('devPersistentOverlay'); if (devPersistentOverlayEl) devPersistentOverlayEl.classList.add('hidden');
  const fricPanel = document.getElementById('devFrictionEditorPanel'); if(fricPanel) fricPanel.classList.add('hidden');
  const taskEditorPanel = document.getElementById('devTaskEditorPanel'); if(taskEditorPanel) taskEditorPanel.classList.add('hidden');
  const taskBrowserPanel = document.getElementById('devTaskBrowserPanel'); if(taskBrowserPanel) taskBrowserPanel.classList.add('hidden');
  const teamEditorPanel = document.getElementById('devTeamEditorPanel'); if(teamEditorPanel) teamEditorPanel.classList.add('hidden');
  const rolesBrowserPanel = document.getElementById('devRolesBrowserPanel'); if(rolesBrowserPanel) rolesBrowserPanel.classList.add('hidden');
  const roleEditorPanel = document.getElementById('devRoleEditorPanel'); if(roleEditorPanel) roleEditorPanel.classList.add('hidden');
  
  const browserPanel = document.getElementById('devTeamBrowserPanel');
  if (browserPanel) browserPanel.classList.remove('hidden');
  
  const tbody = document.getElementById('devTeamBrowserTable');
  if (!tbody) {
    console.warn('[devAgent] devTeamBrowserTable not found');
    return;
  }

  const renderTeamLoadError = (message) => {
    if (isStale()) return;
    tbody.textContent = '';
    const errTr = document.createElement('tr');
    const errTd = document.createElement('td');
    errTd.colSpan = 6;
    errTd.style.padding = '2rem';
    errTd.style.textAlign = 'center';
    errTd.style.color = '#dc2626';
    errTd.textContent = message;
    errTr.appendChild(errTd);
    tbody.appendChild(errTr);
  };

  try {
    tbody.textContent = '';
    const loadTr = document.createElement('tr');
    const loadTd = document.createElement('td');
    loadTd.colSpan = 6;
    loadTd.style.padding = '1rem';
    loadTd.style.opacity = '0.7';
    loadTd.textContent = 'Loading team...';
    loadTr.appendChild(loadTd);
    tbody.appendChild(loadTr);

    const { members: teamMembers, error } = await App.devAgent.loadTeamMembersFromApi();
    if (isStale()) return;
    if (error) {
      renderTeamLoadError(error.message || 'Failed to load team');
      return;
    }

    const members = Array.isArray(teamMembers) ? teamMembers : [];
    tbody.textContent = '';
    if (!members.length) {
      const noTr = document.createElement('tr');
      const noTd = document.createElement('td');
      noTd.colSpan = 6;
      noTd.style.textAlign = 'center';
      noTd.style.padding = '2rem';
      noTd.style.color = '#666';
      noTd.style.fontStyle = 'italic';
      noTd.textContent = 'No team members.';
      noTr.appendChild(noTd);
      tbody.appendChild(noTr);
      return;
    }

    members.forEach((t) => {
      if (isStale()) return;
      const contact = t.contact || {};
      const fullName = t.member_name || App.devAgent.contactDisplayName(contact) || 'Unknown Member';
      const cType = App.devAgent.contactEntityType(contact);
      const typeBadge = App.devAgent.contactTypeLabel(contact) || cType;

      const tr = document.createElement('tr');
      
      const nameTd = document.createElement('td');
      nameTd.style.textAlign = 'left';
      nameTd.textContent = '';
      const strongName = document.createElement('strong');
      strongName.textContent = fullName;
      nameTd.appendChild(strongName);
      
      const typeTd = document.createElement('td');
      typeTd.textContent = '';
      const badgeSpan = document.createElement('span');
      badgeSpan.className = `badge ${cType === 'Agent' ? 'badge-blue' : 'badge-gray'}`;
      badgeSpan.textContent = typeBadge;
      typeTd.appendChild(badgeSpan);
      
      const roleTd = document.createElement('td');
      roleTd.textContent = t.role || 'Unassigned';

      const accountTd = document.createElement('td');
      accountTd.textContent = App.devAgent.teamAccountStatusLabel(t);

      const dateTd = document.createElement('td');
      dateTd.textContent = new Date(t.created_at).toLocaleDateString();
      
      const actionsTd = document.createElement('td');
      actionsTd.className = 'contacts-actions-cell';

      const accountStatus = String(t.accountStatus || t.account_status || 'not_invited').trim();
      const contactEmail = String(contact.email || contact.Email || '').trim();
      const inviteButtons = [];

      if (accountStatus === 'invite_pending') {
        const resendBtn = document.createElement('button');
        resendBtn.type = 'button';
        resendBtn.className = 'btn btn-ghost tiny-btn';
        resendBtn.textContent = 'Resend';
        resendBtn.style.whiteSpace = 'nowrap';
        resendBtn.addEventListener('click', () => App.devAgent.sendTeamInvitation(t.id, { resend: true }));
        inviteButtons.push(resendBtn);

        const revokeBtn = document.createElement('button');
        revokeBtn.type = 'button';
        revokeBtn.className = 'btn btn-ghost tiny-btn';
        revokeBtn.textContent = 'Revoke';
        revokeBtn.style.whiteSpace = 'nowrap';
        revokeBtn.addEventListener('click', () => App.devAgent.revokeTeamInvitation(t.id));
        inviteButtons.push(revokeBtn);
      } else if (accountStatus !== 'active') {
        const inviteBtn = document.createElement('button');
        inviteBtn.type = 'button';
        inviteBtn.className = 'btn btn-primary tiny-btn';
        inviteBtn.textContent = 'Invite';
        inviteBtn.style.whiteSpace = 'nowrap';
        inviteBtn.disabled = !contactEmail;
        inviteBtn.title = contactEmail ? 'Send email invitation' : 'Add an email to the contact first';
        inviteBtn.addEventListener('click', () => {
          if (!contactEmail) {
            App.notify('Add an email address on the contact record before sending an invitation.', true);
            return;
          }
          App.devAgent.sendTeamInvitation(t.id);
        });
        inviteButtons.push(inviteBtn);
      }
      
      if (typeof App.makeIconButton === 'function' && App.contacts) {
        const viewBtn = App.makeIconButton('view', 'View Contact', () => App.contacts.openViewPage(contact.id ? contact : t.contact_id));
        const editBtn = App.makeIconButton('edit', 'Edit Contact', () => App.contacts.openEditPage(contact.id ? contact : t.contact_id, 'devTeamPage'), { marginLeft: '8px' });
        const cloneBtn = App.makeIconButton('copy', 'Clone Contact', () => App.contacts.openClonePage(contact.id ? contact : t.contact_id), { marginLeft: '8px' });
        const deleteBtn = App.makeIconButton('delete', 'Remove from Team', () => App.devAgent.deleteTeamMember(t.id), { danger: true, marginLeft: '8px' });

        if (typeof App.finishTableActionsCell === 'function') {
          App.finishTableActionsCell(actionsTd, ...inviteButtons, viewBtn, editBtn, cloneBtn, deleteBtn);
        } else {
          inviteButtons.forEach((btn) => actionsTd.appendChild(btn));
          actionsTd.appendChild(viewBtn);
          actionsTd.appendChild(editBtn);
          actionsTd.appendChild(cloneBtn);
          actionsTd.appendChild(deleteBtn);
        }
      } else {
        actionsTd.textContent = '';
        inviteButtons.forEach((btn) => actionsTd.appendChild(btn));

        const viewBtn2 = document.createElement('button');
        viewBtn2.type = 'button';
        viewBtn2.className = 'secondary-btn tiny-btn';
        viewBtn2.textContent = 'View';
        viewBtn2.onclick = () => { window.location.hash = `#page=viewContactPage&id=${encodeURIComponent(t.contact_id)}`; };
        
        const editBtn2 = document.createElement('button');
        editBtn2.type = 'button';
        editBtn2.className = 'secondary-btn tiny-btn';
        editBtn2.textContent = 'Edit';
        editBtn2.onclick = () => { window.location.hash = `#page=editContactPage&id=${encodeURIComponent(t.contact_id)}`; };
        
        const removeBtn2 = document.createElement('button');
        removeBtn2.type = 'button';
        removeBtn2.className = 'secondary-btn tiny-btn';
        removeBtn2.textContent = 'Remove';
        removeBtn2.onclick = () => App.devAgent.deleteTeamMember(t.id);
        
        actionsTd.appendChild(viewBtn2);
        actionsTd.appendChild(editBtn2);
        actionsTd.appendChild(removeBtn2);
      }

      tr.appendChild(nameTd);
      tr.appendChild(typeTd);
      tr.appendChild(roleTd);
      tr.appendChild(accountTd);
      tr.appendChild(dateTd);
      tr.appendChild(actionsTd);
      
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('showTeamBrowser failed:', err);
    renderTeamLoadError(`Render error: ${err.message || err}`);
  }
};

App.devAgent.openTeamEditor = async function() {
  const devChatLogEl = document.getElementById('devChatLog'); if (devChatLogEl) devChatLogEl.classList.add('hidden');
  const devChatFormEl = document.getElementById('devChatForm'); if (devChatFormEl) devChatFormEl.classList.add('hidden');
  const devChatMainHeaderEl = document.getElementById('devChatMainHeader'); if (devChatMainHeaderEl) devChatMainHeaderEl.classList.add('hidden');
  const devPersistentOverlayEl = document.getElementById('devPersistentOverlay'); if (devPersistentOverlayEl) devPersistentOverlayEl.classList.add('hidden');
  const fricPanel = document.getElementById('devFrictionEditorPanel'); if(fricPanel) fricPanel.classList.add('hidden');
  const taskEditorPanel = document.getElementById('devTaskEditorPanel'); if(taskEditorPanel) taskEditorPanel.classList.add('hidden');
  const taskBrowserPanel = document.getElementById('devTaskBrowserPanel'); if(taskBrowserPanel) taskBrowserPanel.classList.add('hidden');
  const teamBrowserPanel = document.getElementById('devTeamBrowserPanel'); if(teamBrowserPanel) teamBrowserPanel.classList.add('hidden');
  const rolesBrowserPanel = document.getElementById('devRolesBrowserPanel'); if(rolesBrowserPanel) rolesBrowserPanel.classList.add('hidden');
  const roleEditorPanel = document.getElementById('devRoleEditorPanel'); if(roleEditorPanel) roleEditorPanel.classList.add('hidden');
  
  const panel = document.getElementById('devTeamEditorPanel');
  if (panel) {
    panel.classList.remove('hidden');
    document.getElementById('devTeamEditorHeader').textContent = 'Add Team Member';
    document.getElementById('devEditTeamId').value = '';
    
    document.getElementById('devEditTeamContactId').value = '';
    document.getElementById('devEditTeamContactDisplay').value = '';
    
    const roleSelect = document.getElementById('devEditTeamRole');
    await App.devAgent.populateDevRolesSelect(roleSelect);
  }
};

App.devAgent.saveTeamEditor = async function(e) {
  e.preventDefault();
  const contactId = document.getElementById('devEditTeamContactId').value;
  const role = document.getElementById('devEditTeamRole').value;
  if (!contactId || !role) {
    App.notify('Please select a contact and a role.', true);
    return;
  }

  const projectId = await App.devAgent.ensureProjectContext();
  if (!projectId) {
    App.notify('Select an active project in Settings → Projects, then try again.', true);
    return;
  }
  
  try {
    await App.api('/api/develop/devAgent/team', {
      method: 'POST',
      body: JSON.stringify({ contactId, role }),
    });
    App.notify('Team member added successfully.', false);
    App.devAgent.loadTeam();
    App.devAgent.showTeamBrowser();
  } catch (err) {
    const msg = err?.message || err?.error?.message || 'Failed to add member';
    App.notify(msg, true);
  }
};

App.devAgent.closeTeamEditor = function() {
  document.getElementById('devTeamEditorPanel').classList.add('hidden');
  App.devAgent.showTeamBrowser(); // return to list view instead of chat
};

App.devAgent.deleteTeamMember = async function(teamId) {
  if (!confirm('Are you sure you want to remove this team member?')) return;
  try {
    await App.api(`/api/develop/devAgent/team/${encodeURIComponent(teamId)}`, { method: 'DELETE' });
    App.notify('Team member removed.');
    App.devAgent.loadTeam();
    App.devAgent.showTeamBrowser();
  } catch (err) {
    App.notify(err.message || 'Failed to remove member', true);
  }
};

// ==========================================
// Dev Roles Module Functions
// ==========================================

App.devAgent.showRolesBrowser = async function() {
  const pb = document.getElementById('devProjectBrowserPanel'); if(pb) pb.classList.add('hidden');
  const pe = document.getElementById('devProjectEditorPanel'); if(pe) pe.classList.add('hidden');

  const devChatLogEl = document.getElementById('devChatLog'); if (devChatLogEl) devChatLogEl.classList.add('hidden');
  const devChatFormEl = document.getElementById('devChatForm'); if (devChatFormEl) devChatFormEl.classList.add('hidden');
  const devChatMainHeaderEl = document.getElementById('devChatMainHeader'); if (devChatMainHeaderEl) devChatMainHeaderEl.classList.add('hidden');
  const devPersistentOverlayEl = document.getElementById('devPersistentOverlay'); if (devPersistentOverlayEl) devPersistentOverlayEl.classList.add('hidden');
  const fricPanel = document.getElementById('devFrictionEditorPanel'); if(fricPanel) fricPanel.classList.add('hidden');
  const taskEditorPanel = document.getElementById('devTaskEditorPanel'); if(taskEditorPanel) taskEditorPanel.classList.add('hidden');
  const taskBrowserPanel = document.getElementById('devTaskBrowserPanel'); if(taskBrowserPanel) taskBrowserPanel.classList.add('hidden');
  const teamEditorPanel = document.getElementById('devTeamEditorPanel'); if(teamEditorPanel) teamEditorPanel.classList.add('hidden');
  const teamBrowserPanel = document.getElementById('devTeamBrowserPanel'); if(teamBrowserPanel) teamBrowserPanel.classList.add('hidden');
  const roleEditorPanel = document.getElementById('devRoleEditorPanel'); if(roleEditorPanel) roleEditorPanel.classList.add('hidden');
  
  const browserPanel = document.getElementById('devRolesBrowserPanel');
  if (browserPanel) browserPanel.classList.remove('hidden');
  
  const tbody = document.getElementById('devRolesBrowserTable');
  if (!tbody) return;
  try {
    tbody.textContent = '';
    const rLoadTr = document.createElement('tr');
    const rLoadTd = document.createElement('td');
    rLoadTd.colSpan = 4;
    rLoadTd.style.padding = '1rem';
    rLoadTd.style.opacity = '0.7';
    rLoadTd.textContent = 'Loading roles...';
    rLoadTr.appendChild(rLoadTd);
    tbody.appendChild(rLoadTr);

    const projectId = await App.devAgent.ensureProjectContext();
    if (!projectId) {
      tbody.textContent = '';
      const needTr = document.createElement('tr');
      const needTd = document.createElement('td');
      needTd.colSpan = 4;
      needTd.style.padding = '2rem';
      needTd.style.textAlign = 'center';
      needTd.style.color = '#dc2626';
      needTd.textContent = 'Select an active project in Settings → Projects, then try again.';
      needTr.appendChild(needTd);
      tbody.appendChild(needTr);
      return;
    }

    let roles;
    try {
      const res = await App.api('/api/develop/devAgent/roles');
      roles = res.roles || res.data || [];
    } catch (_) {
      tbody.textContent = '';
      const rErrTr = document.createElement('tr');
      const rErrTd = document.createElement('td');
      rErrTd.colSpan = 4;
      rErrTd.textContent = 'Failed to fetch roles.';
      rErrTr.appendChild(rErrTd);
      tbody.appendChild(rErrTr);
      return;
    }
    
    tbody.textContent = '';
    if (!roles || roles.length === 0) {
      const noRoleTr = document.createElement('tr');
      const noRoleTd = document.createElement('td');
      noRoleTd.colSpan = 4;
      noRoleTd.style.padding = '1rem';
      noRoleTd.style.opacity = '0.7';
      noRoleTd.style.textAlign = 'center';
      noRoleTd.textContent = 'No roles found.';
      noRoleTr.appendChild(noRoleTd);
      tbody.appendChild(noRoleTr);
      return;
    }
    
    roles.forEach(r => {
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', (e) => {
        if (e.target.tagName.toLowerCase() === 'button' || e.target.closest('button')) return;
        App.devAgent.openRoleEditor(r.id);
      });
      const tdName = document.createElement('td');
      tdName.style.textAlign = 'left';
      const sName = document.createElement('strong');
      sName.textContent = r.role_name || r.name || 'Unnamed Role';
      tdName.appendChild(sName);
      
      const tdDesc = document.createElement('td');
      tdDesc.textContent = r.description || '';
      
      const tdDate = document.createElement('td');
      tdDate.textContent = new Date(r.created_at).toLocaleDateString();
      
      const tdActions = document.createElement('td');
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'secondary-btn tiny-btn';
      delBtn.textContent = 'Delete';
      delBtn.onclick = (e) => { e.stopPropagation(); App.devAgent.deleteRole(r.id); };
      tdActions.appendChild(delBtn);
      
      tr.textContent = '';
      tr.appendChild(tdName);
      tr.appendChild(tdDesc);
      tr.appendChild(tdDate);
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('showRolesBrowser failed:', err);
    tbody.innerHTML = `<tr><td colspan="4" style="padding: 2rem; text-align: center; color: #dc2626; font-style: italic;">Render Error: ${err.message}</td></tr>`;
  }
};

App.devAgent.openRoleEditor = async function(roleId = null) {
  const devChatLogEl = document.getElementById('devChatLog'); if (devChatLogEl) devChatLogEl.classList.add('hidden');
  const devChatFormEl = document.getElementById('devChatForm'); if (devChatFormEl) devChatFormEl.classList.add('hidden');
  const devChatMainHeaderEl = document.getElementById('devChatMainHeader'); if (devChatMainHeaderEl) devChatMainHeaderEl.classList.add('hidden');
  const devPersistentOverlayEl = document.getElementById('devPersistentOverlay'); if (devPersistentOverlayEl) devPersistentOverlayEl.classList.add('hidden');
  const fricPanel = document.getElementById('devFrictionEditorPanel'); if(fricPanel) fricPanel.classList.add('hidden');
  const taskEditorPanel = document.getElementById('devTaskEditorPanel'); if(taskEditorPanel) taskEditorPanel.classList.add('hidden');
  const taskBrowserPanel = document.getElementById('devTaskBrowserPanel'); if(taskBrowserPanel) taskBrowserPanel.classList.add('hidden');
  const teamBrowserPanel = document.getElementById('devTeamBrowserPanel'); if(teamBrowserPanel) teamBrowserPanel.classList.add('hidden');
  const teamEditorPanel = document.getElementById('devTeamEditorPanel'); if(teamEditorPanel) teamEditorPanel.classList.add('hidden');
  const rolesBrowserPanel = document.getElementById('devRolesBrowserPanel'); if(rolesBrowserPanel) rolesBrowserPanel.classList.add('hidden');
  
  const panel = document.getElementById('devRoleEditorPanel');
  if (panel) {
    panel.classList.remove('hidden');
    document.getElementById('devRoleEditorHeader').textContent = roleId ? 'Edit Role' : 'Add Role';
    document.getElementById('devEditRoleId').value = roleId || '';
    
    if (roleId && window.supabaseClient) {
      document.getElementById('devEditRoleName').value = 'Loading...';
      document.getElementById('devEditRoleDesc').value = '';
      try {
        const { data: role, error } = await window.supabaseClient.from('dev_roles').select('*').eq('id', roleId).single();
        if (error) throw error;
        document.getElementById('devEditRoleName').value = role.role_name || '';
        document.getElementById('devEditRoleDesc').value = role.description || '';
      } catch (e) {
        document.getElementById('devRoleEditorHeader').textContent = 'Role Unresolved';
        document.getElementById('devEditRoleName').value = '';
      }
    } else {
      document.getElementById('devEditRoleName').value = '';
      document.getElementById('devEditRoleDesc').value = '';
    }
  }
};

App.devAgent.saveRoleEditor = async function(e) {
  e.preventDefault();
  const roleId = document.getElementById('devEditRoleId').value;
  const roleName = document.getElementById('devEditRoleName').value;
  const roleDesc = document.getElementById('devEditRoleDesc').value;
  
  if (!roleName) return;
  
  const projectId = await App.devAgent.ensureProjectContext();
  if (!projectId) {
    App.notify('Select an active project in Settings → Projects, then try again.', true);
    return;
  }

  const payload = {
    project_id: projectId,
    role_name: roleName,
    description: roleDesc
  };
  
  try {
    if (!window.supabaseClient) {
      throw new Error('Supabase client is not initialized.');
    }
    let error;
    if (roleId) {
      const res = await window.supabaseClient.from('dev_roles').update(payload).eq('id', roleId);
      error = res.error;
    } else {
      const res = await window.supabaseClient.from('dev_roles').insert([payload]);
      error = res.error;
    }
    
    if (error) {
      if (error.code === '23505') {
        throw new Error('A role with this name already exists.');
      }
      throw error;
    }
    App.notify(roleId ? 'Role updated successfully.' : 'Role created successfully.', false);
    App.devAgent.showRolesBrowser();
  } catch (err) {
    App.notify('Failed to save role: ' + err.message, true);
  }
};

App.devAgent.closeRoleEditor = function() {
  document.getElementById('devRoleEditorPanel').classList.add('hidden');
  App.devAgent.showRolesBrowser();
};

App.devAgent.deleteRole = async function(roleId) {
  if (!confirm('Are you sure you want to delete this role? Existing team members with this role will not be affected, but you won\'t be able to assign this role to new members.')) return;
  try {
    const { error } = await window.supabaseClient.from('dev_roles').delete().eq('id', roleId);
    if (error) throw error;
    App.notify('Role deleted.');
    App.devAgent.showRolesBrowser();
  } catch (err) {
    App.notify('Failed to delete role: ' + err.message, true);
  }
};

// ==========================================
// Contact Selector Modal Functions
// ==========================================

App.devAgent.modalContacts = [];

App.devAgent.openContactSelectorModal = async function() {
  const modal = document.getElementById('devContactSelectorModal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'block';
    document.getElementById('devContactSelectorSearch').value = '';
    document.getElementById('devContactSelectorEntityType').value = 'All';
    
    const tbody = document.getElementById('devContactSelectorTableBody');
    if (tbody) {
      tbody.textContent = '';
      const tLoadTr = document.createElement('tr');
      const tLoadTd = document.createElement('td');
      tLoadTd.colSpan = 4;
      tLoadTd.style.textAlign = 'center';
      tLoadTd.style.padding = '2rem';
      tLoadTd.textContent = 'Loading contacts...';
      tLoadTr.appendChild(tLoadTd);
      tbody.appendChild(tLoadTr);
    }
    
    try {
      const res = await App.api('/api/contacts');
      App.devAgent.modalContacts = res.contacts || res.data || [];
      App.devAgent.filterModalContacts();
    } catch (e) {
      if (tbody) {
        tbody.textContent = '';
        const tErrTr = document.createElement('tr');
        const tErrTd = document.createElement('td');
        tErrTd.colSpan = 4;
        tErrTd.style.textAlign = 'center';
        tErrTd.style.padding = '2rem';
        tErrTd.style.color = 'red';
        tErrTd.textContent = 'Failed to load contacts.';
        tErrTr.appendChild(tErrTd);
        tbody.appendChild(tErrTr);
      }
    }
  }
};

App.devAgent.closeContactSelectorModal = function() {
  const modal = document.getElementById('devContactSelectorModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
};

App.devAgent.filterModalContacts = function() {
  const searchStr = (document.getElementById('devContactSelectorSearch').value || '').toLowerCase();
  const companyStr = (document.getElementById('devContactSelectorCompany').value || '').toLowerCase();
  const entityType = document.getElementById('devContactSelectorEntityType').value;
  
  const filtered = App.devAgent.modalContacts.filter(c => {
    const cType = c.entity_type || 'Human';
    if (entityType !== 'All' && cType !== entityType) return false;
    
    if (searchStr) {
      const name = `${c.first_name || c.firstName || ''} ${c.middle_name || c.middleName || ''} ${c.last_name || c.lastName || ''}`.replace(/\s+/g, ' ').trim().toLowerCase();
      const em = (c.email || '').toLowerCase();
      if (!name.includes(searchStr) && !em.includes(searchStr)) {
        return false;
      }
    }
    if (companyStr) {
      const comp = (c.company || '').toLowerCase();
      if (!comp.includes(companyStr)) {
        return false;
      }
    }
    return true;
  });
  
  const tbody = document.getElementById('devContactSelectorTableBody');
  if (!tbody) return;
  
  tbody.textContent = '';
  
  if (filtered.length === 0) {
    const tNoTr = document.createElement('tr');
    const tNoTd = document.createElement('td');
    tNoTd.colSpan = 4;
    tNoTd.style.textAlign = 'center';
    tNoTd.style.padding = '2rem';
    tNoTd.textContent = 'No contacts found.';
    tNoTr.appendChild(tNoTd);
    tbody.appendChild(tNoTr);
    return;
  }
  
  filtered.forEach(c => {
    const tr = document.createElement('tr');
    const fullName = `${c.first_name || c.firstName || ''} ${c.middle_name || c.middleName || ''} ${c.last_name || c.lastName || ''}`.replace(/\s+/g, ' ').trim() || c.email || c.id;
    const cType = c.entity_type || c.entityType || 'Human';
    
    const tNameTd = document.createElement('td');
    tNameTd.style.textAlign = 'left';
    const sName = document.createElement('strong');
    sName.textContent = fullName;
    tNameTd.appendChild(sName);
    
    const tEmailTd = document.createElement('td');
    tEmailTd.style.textAlign = 'left';
    tEmailTd.textContent = c.email || '';
    
    const tCompTd = document.createElement('td');
    tCompTd.textContent = c.company || '';
    
    const tTypeTd = document.createElement('td');
    const badgeSp = document.createElement('span');
    badgeSp.className = `badge ${cType === 'Agent' ? 'badge-blue' : 'badge-gray'}`;
    badgeSp.textContent = cType;
    tTypeTd.appendChild(badgeSp);
    
    const tActTd = document.createElement('td');
    tActTd.style.textAlign = 'center';
    const selBtn = document.createElement('button');
    selBtn.type = 'button';
    selBtn.className = 'secondary-btn tiny-btn';
    selBtn.textContent = 'Select';
    selBtn.onclick = () => { App.devAgent.selectModalContact(c.id, fullName.replace(/'/g, "\\'")); };
    tActTd.appendChild(selBtn);
    
    tr.textContent = '';
    tr.appendChild(tNameTd);
    tr.appendChild(tEmailTd);
    tr.appendChild(tCompTd);
    tr.appendChild(tTypeTd);
    tr.appendChild(tActTd);
    tbody.appendChild(tr);
  });
};

App.devAgent.selectModalContact = function(id, name) {
  const displayInput = document.getElementById('devEditTeamContactDisplay');
  const idInput = document.getElementById('devEditTeamContactId');
  
  if (displayInput) displayInput.value = name;
  if (idInput) idInput.value = id;
  
  App.devAgent.closeContactSelectorModal();
};


App.devAgent.showProjectBrowser = async function() {
  const devChatLogEl = document.getElementById('devChatLog'); if (devChatLogEl) devChatLogEl.classList.add('hidden');
  const devChatFormEl = document.getElementById('devChatForm'); if (devChatFormEl) devChatFormEl.classList.add('hidden');
  const devChatMainHeaderEl = document.getElementById('devChatMainHeader'); if (devChatMainHeaderEl) devChatMainHeaderEl.classList.add('hidden');
  const devPersistentOverlayEl = document.getElementById('devPersistentOverlay'); if (devPersistentOverlayEl) devPersistentOverlayEl.classList.add('hidden');
  const fricPanel = document.getElementById('devFrictionEditorPanel'); if(fricPanel) fricPanel.classList.add('hidden');
  const editorPanel = document.getElementById('devTaskEditorPanel'); if(editorPanel) editorPanel.classList.add('hidden');
  const taskBrowserPanel = document.getElementById('devTaskBrowserPanel'); if(taskBrowserPanel) taskBrowserPanel.classList.add('hidden');
  const teamBrowserPanel = document.getElementById('devTeamBrowserPanel'); if(teamBrowserPanel) teamBrowserPanel.classList.add('hidden');
  const teamEditorPanel = document.getElementById('devTeamEditorPanel'); if(teamEditorPanel) teamEditorPanel.classList.add('hidden');
  const rolesBrowserPanel = document.getElementById('devRolesBrowserPanel'); if(rolesBrowserPanel) rolesBrowserPanel.classList.add('hidden');
  const roleEditorPanel = document.getElementById('devRoleEditorPanel'); if(roleEditorPanel) roleEditorPanel.classList.add('hidden');
  const projEditorPanel = document.getElementById('devProjectEditorPanel'); if(projEditorPanel) projEditorPanel.classList.add('hidden');
  
  const pbPanel = document.getElementById('devProjectBrowserPanel'); 
  if(pbPanel) pbPanel.classList.remove('hidden');
  
  App.devAgent.loadTasks(); // Reset sidebar task filter
  await App.devAgent.loadProjects();
};

App.devAgent.loadProjects = async function() {
  if (!window.supabaseClient) return;
  const tbody = document.getElementById('devProjectBrowserTable');
  if (tbody) {
    tbody.textContent = '';
    const loadTr = document.createElement('tr');
    const loadTd = document.createElement('td');
    loadTd.colSpan = 6;
    loadTd.style.textAlign = 'center';
    loadTd.textContent = 'Loading...';
    loadTr.appendChild(loadTd);
    tbody.appendChild(loadTr);
  }
  
  const { data, error } = await window.supabaseClient.from('dev_projects').select('*, dev_project_members(count), dev_tasks(count)').order('created_at', { ascending: false });
  if (error) {
    if (tbody) {
      tbody.textContent = '';
      const errTr = document.createElement('tr');
      const errTd = document.createElement('td');
      errTd.colSpan = 6;
      errTd.style.textAlign = 'center';
      errTd.style.color = 'red';
      errTd.textContent = 'Error loading projects';
      errTr.appendChild(errTd);
      tbody.appendChild(errTr);
    }
    return;
  }
  
  devState.projects = data || [];
  
  // also populate the task project dropdown
  const taskProjectSelect = document.getElementById('devEditTaskProject');
  if (taskProjectSelect) {
     const currentVal = taskProjectSelect.value;
     taskProjectSelect.textContent = '';
     const nullOpt = document.createElement('option');
     nullOpt.value = '';
     nullOpt.textContent = '-- No Project --';
     taskProjectSelect.appendChild(nullOpt);
     devState.projects.forEach(p => {
       const opt = document.createElement('option');
       opt.value = p.id;
       opt.textContent = p.name;
       taskProjectSelect.appendChild(opt);
     });
     taskProjectSelect.value = currentVal;
  }
  
  const projList = document.getElementById('devProjectList');
  if (projList) projList.textContent = '';
  
  if (devState.projects.length === 0) {
    if (tbody) {
      tbody.textContent = '';
      const noneTr = document.createElement('tr');
      const noneTd = document.createElement('td');
      noneTd.colSpan = 6;
      noneTd.style.textAlign = 'center';
      noneTd.textContent = 'No active projects.';
      noneTr.appendChild(noneTd);
      tbody.appendChild(noneTr);
    }
    if (projList) {
      projList.textContent = '';
      const noneLi = document.createElement('li');
      noneLi.className = 'dev-session-item';
      noneLi.style.color = '#666';
      noneLi.style.fontStyle = 'italic';
      noneLi.textContent = 'No active projects.';
      projList.appendChild(noneLi);
    }
    return;
  }
  
  devState.projects.forEach(proj => {
    // Populate Sidebar
    if (projList) {
      const li = document.createElement('li');
      li.className = 'dev-session-item';
      li.dataset.projectId = proj.id;
      const projName = proj.name || 'Untitled';
      const shortTitle = projName.length > 25 ? projName.substring(0,25) + '...' : projName;
      li.textContent = '';
      const dotSp = document.createElement('span');
      dotSp.style.display = 'inline-block';
      dotSp.style.width = '8px';
      dotSp.style.height = '8px';
      dotSp.style.borderRadius = '50%';
      dotSp.style.background = 'var(--accent-info, #3b82f6)';
      dotSp.style.marginRight = '6px';
      li.appendChild(dotSp);
      li.appendChild(document.createTextNode(' ' + shortTitle));
      li.addEventListener('click', () => {
        App.devAgent.openProjectEditor(proj.id);
      });
      projList.appendChild(li);
    }
  });
  
  if (!tbody) return;
  App.devAgent.renderProjects();
};

App.devAgent.projectsSortKey = 'created_at';
App.devAgent.projectsSortAsc = false;

App.devAgent.sortProjects = function(key) {
  if (App.devAgent.projectsSortKey === key) {
    App.devAgent.projectsSortAsc = !App.devAgent.projectsSortAsc;
  } else {
    App.devAgent.projectsSortKey = key;
    App.devAgent.projectsSortAsc = true;
  }
  App.devAgent.renderProjects();
};

App.devAgent.renderProjects = function() {
  const tbody = document.getElementById('devProjectBrowserTable');
  if (!tbody) return;
  
  const filterText = (document.getElementById('devProjectFilterText')?.value || '').toLowerCase();
  const filterStatus = document.getElementById('devProjectFilterStatus')?.value || 'all';
  
  let filtered = devState.projects.filter(proj => {
    if (filterStatus !== 'all' && proj.status !== filterStatus) return false;
    if (filterText) {
      if (!((proj.name && proj.name.toLowerCase().includes(filterText)) ||
            (proj.description && proj.description.toLowerCase().includes(filterText)))) {
        return false;
      }
    }
    return true;
  });
  
  const key = App.devAgent.projectsSortKey;
  const asc = App.devAgent.projectsSortAsc;
  
  filtered.sort((a, b) => {
    let valA = a[key] !== undefined ? a[key] : '';
    let valB = b[key] !== undefined ? b[key] : '';
    
    // Derived fields
    if (key === 'members_count') {
      valA = a.dev_project_members?.[0]?.count || 0;
      valB = b.dev_project_members?.[0]?.count || 0;
    } else if (key === 'tasks_count') {
      valA = a.dev_tasks?.[0]?.count || 0;
      valB = b.dev_tasks?.[0]?.count || 0;
    }
    
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    
    if (valA < valB) return asc ? -1 : 1;
    if (valA > valB) return asc ? 1 : -1;
    return 0;
  });
  
  // Update UI icons
  const keys = ['name', 'description', 'status', 'members_count', 'tasks_count', 'created_at'];
  keys.forEach(k => {
    const el = document.getElementById(`sortIcon_proj_${k}`);
    if (el) {
      if (k === key) {
        el.textContent = asc ? ' ▲' : ' ▼';
      } else {
        el.textContent = '';
      }
    }
  });
  
  tbody.textContent = '';
  if (filtered.length === 0) {
    const noTr = document.createElement('tr');
    const noTd = document.createElement('td');
    noTd.colSpan = 7;
    noTd.style.textAlign = 'center';
    noTd.textContent = 'No matching projects.';
    noTr.appendChild(noTd);
    tbody.appendChild(noTr);
    return;
  }
  
  filtered.forEach(proj => {
    const escapeHTML = (str) => {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };
    const tr = document.createElement('tr');
    const safeName = escapeHTML(proj.name || 'Untitled');
    const safeDesc = escapeHTML(proj.description || '');
    const parserProj = new DOMParser();
    const docProj = parserProj.parseFromString(`
      <td><strong>${safeName}</strong></td>
      <td style="max-width: 350px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${safeDesc}">${safeDesc}</td>
      <td><span class="badge">${escapeHTML(proj.status)}</span></td>
      <td>${proj.dev_project_members?.[0]?.count || 0}</td>
      <td>${proj.dev_tasks?.[0]?.count || 0}</td>
      <td>${new Date(proj.created_at).toLocaleDateString()}</td>
      <td style="text-align: center; white-space: nowrap; gap: 0.5rem; display: flex; justify-content: center;">
        <button class="icon-btn" onclick="App.devAgent.openProjectEditor('${proj.id}')" title="Edit Project">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
        <button class="icon-btn" onclick="App.devAgent.cloneProject('${proj.id}')" title="Clone Project">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
        <button class="icon-btn danger-hover" onclick="App.devAgent.deleteProject('${proj.id}')" title="Delete Project">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
      </td>
    `, 'text/html');
    tr.textContent = '';
    
    // We cannot just cloneNode on body children because they are TDs and parser puts them into body but might strip tr/td.
    // Let's create the TDs safely.
    
    const tdName = document.createElement('td');
    const sName = document.createElement('strong');
    sName.textContent = proj.name || '';
    tdName.appendChild(sName);
    
    const tdDesc = document.createElement('td');
    tdDesc.style.maxWidth = '350px';
    tdDesc.style.whiteSpace = 'nowrap';
    tdDesc.style.overflow = 'hidden';
    tdDesc.style.textOverflow = 'ellipsis';
    tdDesc.title = proj.description || '';
    tdDesc.textContent = proj.description || '';
    
    const tdStat = document.createElement('td');
    const bStat = document.createElement('span');
    bStat.className = 'badge';
    bStat.textContent = proj.status || '';
    tdStat.appendChild(bStat);
    
    const tdMems = document.createElement('td');
    tdMems.textContent = proj.dev_project_members?.[0]?.count || 0;
    
    const tdTasks = document.createElement('td');
    tdTasks.textContent = proj.dev_tasks?.[0]?.count || 0;
    
    const tdDate = document.createElement('td');
    tdDate.textContent = new Date(proj.created_at).toLocaleDateString();
    
    const tdActs = document.createElement('td');
    tdActs.style.textAlign = 'center';
    tdActs.style.whiteSpace = 'nowrap';
    tdActs.style.gap = '0.5rem';
    tdActs.style.display = 'flex';
    tdActs.style.justifyContent = 'center';
    
    const actsParser = new DOMParser();
    const actsDoc = actsParser.parseFromString(`
        <button class="icon-btn" onclick="App.devAgent.openProjectEditor('${proj.id}')" title="Edit Project">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
        <button class="icon-btn" onclick="App.devAgent.cloneProject('${proj.id}')" title="Clone Project">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
        <button class="icon-btn danger-hover" onclick="App.devAgent.deleteProject('${proj.id}')" title="Delete Project">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
    `, 'text/html');
    Array.from(actsDoc.body.childNodes).forEach(n => tdActs.appendChild(n.cloneNode(true)));
    
    tr.appendChild(tdName);
    tr.appendChild(tdDesc);
    tr.appendChild(tdStat);
    tr.appendChild(tdMems);
    tr.appendChild(tdTasks);
    tr.appendChild(tdDate);
    tr.appendChild(tdActs);
    tbody.appendChild(tr);
  });
};


App.devAgent.currentProjectTasks = [];
App.devAgent.projectTasksSortKey = 'created_at';
App.devAgent.projectTasksSortAsc = false;

App.devAgent.filterProjectTasks = function() {
  App.devAgent.renderProjectTasks();
};

App.devAgent.sortProjectTasks = function(key) {
  if (App.devAgent.projectTasksSortKey === key) {
    App.devAgent.projectTasksSortAsc = !App.devAgent.projectTasksSortAsc;
  } else {
    App.devAgent.projectTasksSortKey = key;
    App.devAgent.projectTasksSortAsc = true; // default to asc for new column
  }
  
  // Update icons
  ['title', 'status', 'priority', 'assignee'].forEach(k => {
    const el = document.getElementById('devProjectTasksSort_' + k);
    if (el) el.textContent = '';
  });
  
  const activeIcon = document.getElementById('devProjectTasksSort_' + key);
  if (activeIcon) {
    activeIcon.textContent = App.devAgent.projectTasksSortAsc ? '▲' : '▼';
  }
  
  App.devAgent.renderProjectTasks();
};

App.devAgent.renderProjectTasks = function() {
  const taskTbody = document.getElementById('devProjectTasksTableBody');
  if (!taskTbody) return;
  
  const titleFilter = (document.getElementById('devProjectTasksFilterTitle')?.value || '').toLowerCase();
  const statusFilter = document.getElementById('devProjectTasksFilterStatus')?.value || 'all';
  const priorityFilter = document.getElementById('devProjectTasksFilterPriority')?.value || 'all';
  
  let filtered = App.devAgent.currentProjectTasks.filter(t => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
    if (titleFilter && (!t.title || !t.title.toLowerCase().includes(titleFilter))) return false;
    return true;
  });
  
  const key = App.devAgent.projectTasksSortKey;
  const asc = App.devAgent.projectTasksSortAsc;
  
  filtered.sort((a, b) => {
    let valA = a[key] || '';
    let valB = b[key] || '';
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    if (valA < valB) return asc ? -1 : 1;
    if (valA > valB) return asc ? 1 : -1;
    return 0;
  });
  
  taskTbody.textContent = '';
  
  if (filtered.length === 0) {
    const pNoTr = document.createElement('tr');
    const pNoTd = document.createElement('td');
    pNoTd.colSpan = 5;
    pNoTd.style.textAlign = 'center';
    pNoTd.style.color = '#666';
    pNoTd.style.fontStyle = 'italic';
    pNoTd.textContent = 'No tasks match your filters.';
    pNoTr.appendChild(pNoTd);
    taskTbody.appendChild(pNoTr);
    return;
  }
  
  filtered.forEach(task => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', (e) => {
      e.stopPropagation();
      App.devAgent.openTaskEditor(task.id, task.project_id);
    });
    
    const escapeHTML = (str) => {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };
    
    const tTd1 = document.createElement('td');
    tTd1.style.fontFamily = 'monospace';
    tTd1.style.fontSize = '0.8em';
    tTd1.style.color = 'var(--text-muted)';
    tTd1.textContent = task.id.substring(0,8);
    
    const tTd2 = document.createElement('td');
    tTd2.style.maxWidth = '350px';
    tTd2.style.whiteSpace = 'nowrap';
    tTd2.style.overflow = 'hidden';
    tTd2.style.textOverflow = 'ellipsis';
    tTd2.title = task.title || '';
    tTd2.textContent = task.title || '';
    
    const tTd3 = document.createElement('td');
    const b3 = document.createElement('span');
    b3.className = 'badge badge-gray';
    b3.style.textTransform = 'capitalize';
    b3.textContent = (task.status || '').replace('_', ' ');
    tTd3.appendChild(b3);
    
    const tTd4 = document.createElement('td');
    const b4 = document.createElement('span');
    b4.className = 'badge badge-gray';
    b4.style.textTransform = 'capitalize';
    b4.textContent = task.priority || '';
    tTd4.appendChild(b4);
    
    const tTd5 = document.createElement('td');
    tTd5.style.textTransform = 'capitalize';
    tTd5.textContent = task.assignee || '';
    
    const tTd6 = document.createElement('td');
    tTd6.style.textAlign = 'right';
    tTd6.style.whiteSpace = 'nowrap';
    
    const actsP = new DOMParser();
    const actsD = actsP.parseFromString(`
        <button type="button" class="dev-action-btn edit-task-btn" title="Edit Task" style="background:none; border:none; cursor:pointer; color:var(--text-muted); padding:4px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
        </button>
        <button type="button" class="dev-action-btn del-task-btn" title="Delete Task" style="background:none; border:none; cursor:pointer; color:var(--accent-danger); padding:4px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
    `, 'text/html');
    Array.from(actsD.body.childNodes).forEach(n => tTd6.appendChild(n.cloneNode(true)));
    
    tr.textContent = '';
    tr.appendChild(tTd1);
    tr.appendChild(tTd2);
    tr.appendChild(tTd3);
    tr.appendChild(tTd4);
    tr.appendChild(tTd5);
    tr.appendChild(tTd6);
    
    const editBtn = tr.querySelector('.edit-task-btn');
    const delBtn = tr.querySelector('.del-task-btn');
    
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      App.devAgent.openTaskEditor(task.id, task.project_id);
    });
    
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Are you sure you want to delete this task?')) {
        try {
          await window.supabaseClient.from('dev_tasks').delete().eq('id', task.id);
          App.notify('Task deleted successfully', 'success');
          App.devAgent.loadProjectTasks(task.project_id); // Reload the list
          if (typeof App.devAgent.loadDashboard === 'function') App.devAgent.loadDashboard();
        } catch (err) {
          App.notify('Failed to delete task', 'error');
        }
      }
    });
    
    taskTbody.appendChild(tr);
  });
};

App.devAgent.loadProjectTasks = async function(projectId) {
  const tbody = document.getElementById('devProjectTasksTableBody');
  if (!tbody) return;
  
  if (!window.supabaseClient) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding: 1rem; text-align: center; color: #dc2626; font-style: italic;">Supabase Client Not Initialized.</td></tr>';
    return;
  }
  
  if (!projectId) {
    tbody.textContent = '';
    const pNoTr = document.createElement('tr');
    const pNoTd = document.createElement('td');
    pNoTd.colSpan = 5;
    pNoTd.style.textAlign = 'center';
    pNoTd.style.padding = '1rem';
    pNoTd.style.opacity = '0.7';
    pNoTd.textContent = 'Save the project first to add tasks.';
    pNoTr.appendChild(pNoTd);
    tbody.appendChild(pNoTr);
    return;
  }

  tbody.textContent = '';
  const pLoadTr = document.createElement('tr');
  const pLoadTd = document.createElement('td');
  pLoadTd.colSpan = 5;
  pLoadTd.style.textAlign = 'center';
  pLoadTd.style.padding = '1rem';
  pLoadTd.style.opacity = '0.7';
  pLoadTd.textContent = 'Loading tasks...';
  pLoadTr.appendChild(pLoadTd);
  tbody.appendChild(pLoadTr);
  
  try {
    const { data: tasks, error } = await window.supabaseClient
      .from('dev_tasks')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    
    App.devAgent.currentProjectTasks = tasks || [];
    App.devAgent.renderProjectTasks();

  } catch (err) {
    tbody.textContent = '';
    const pErrTr = document.createElement('tr');
    const pErrTd = document.createElement('td');
    pErrTd.colSpan = 5;
    pErrTd.style.textAlign = 'center';
    pErrTd.style.padding = '1rem';
    pErrTd.style.color = 'red';
    pErrTd.textContent = err.message || 'Unable to load tasks';
    pErrTr.appendChild(pErrTd);
    tbody.appendChild(pErrTr);
  }
};


App.devAgent.createProjectTask = async function(projectId) {
  App.devAgent.openTaskEditor(null, projectId);
};

App.devAgent.deleteProjectTask = async function(taskId, projectId) {
  if (!taskId || !confirm('Delete this task?')) return;
  try {
    const { error } = await window.supabaseClient.from('dev_tasks').delete().eq('id', taskId);
    if (error) throw error;
    App.notify('Task deleted.');
    await App.devAgent.loadProjectTasks(projectId);
    App.devAgent.loadTasks();
  } catch (err) {
    App.notify('Error deleting task: ' + err.message, true);
  }
};

App.devAgent.deleteTask = async function(taskId) {
  if (!taskId || !confirm('Delete this task?')) return;
  try {
    const { error } = await window.supabaseClient.from('dev_tasks').delete().eq('id', taskId);
    if (error) throw error;
    App.notify('Task deleted.');
    App.devAgent.showTaskBrowser();
  } catch (err) {
    App.notify('Error deleting task: ' + err.message, true);
  }
};

App.devAgent.openProjectEditor = async function(id = null) {
  const browserPanel = document.getElementById('devProjectBrowserPanel'); if(browserPanel) browserPanel.classList.add('hidden');
  const editorPanel = document.getElementById('devProjectEditorPanel'); if(editorPanel) editorPanel.classList.remove('hidden');
  
  document.getElementById('devProjectEditorHeader').textContent = id ? 'Edit Project' : 'New Project';
  const form = document.getElementById('devProjectEditorForm');
  if (form) form.reset();
  document.getElementById('devEditProjectId').value = id || '';
  
  const memberList = document.getElementById('devEditProjectMembersList');
  if (memberList) memberList.textContent = '';

  await App.devAgent.loadProjectTasks(id);
  App.devAgent.loadTasks(id); // Update the left panel to only show this project's tasks
  
  // Hide team members area if new project
  const memberSection = document.getElementById('devEditProjectMemberSelect')?.closest('.form-group');
  if (memberSection) {
     memberSection.style.display = id ? 'block' : 'none';
     
     // Also update the label right above it
     const label = memberSection.previousElementSibling;
     if (label && label.tagName === 'LABEL') {
       label.style.display = id ? 'block' : 'none';
       
       if (!id) {
          // insert a small helper note
          let note = document.getElementById('devNewProjectTeamNote');
          if (!note) {
             note = document.createElement('div');
             note.id = 'devNewProjectTeamNote';
             note.style.fontStyle = 'italic';
             note.style.color = '#666';
             note.style.marginBottom = '1rem';
             note.textContent = 'Save the project first to assign team members.';
             memberSection.parentNode.insertBefore(note, memberSection);
          }
          note.style.display = 'block';
       } else {
          const note = document.getElementById('devNewProjectTeamNote');
          if (note) note.style.display = 'none';
       }
     }
  }
  
  if (id) {
    const proj = devState.projects.find(p => p.id === id);
    if (proj) {
      document.getElementById('devEditProjectName').value = proj.name;
      document.getElementById('devEditProjectDesc').value = proj.description || '';
      document.getElementById('devEditProjectStatus').value = proj.status || 'active';
      
      // Load members
      const { data: members } = await window.supabaseClient.from('dev_project_members').select('*, contacts(*)').eq('dev_project_id', id);
      if (members && memberList) {
        members.forEach(m => {
          const badge = document.createElement('span');
          badge.className = 'badge badge-blue';
          badge.textContent = '';
          badge.appendChild(document.createTextNode(m.contacts ? m.contacts.first_name + ' ' + m.contacts.last_name : m.contact_id));
          const remSpan = document.createElement('span');
          remSpan.style.cursor = 'pointer';
          remSpan.style.marginLeft = '4px';
          remSpan.textContent = '×';
          remSpan.onclick = () => App.devAgent.removeProjectMember(m.id, id);
          badge.appendChild(document.createTextNode(' '));
          badge.appendChild(remSpan);
          memberList.appendChild(badge);
        });
      }
    }
  }
  
  // load available team members into select
  const memberSelect = document.getElementById('devEditProjectMemberSelect');
  if (memberSelect) {
     memberSelect.textContent = '';
     const defOpt = document.createElement('option');
     defOpt.value = '';
     defOpt.textContent = '-- Add Team Member --';
     memberSelect.appendChild(defOpt);
     const { data: team } = await window.supabaseClient.from('dev_team').select('*, contacts(*)');
     if (team) {
       team.forEach(t => {
         if (t.contacts) {
            const opt = document.createElement('option');
            opt.value = t.contacts.id;
            opt.textContent = `${t.contacts.first_name} ${t.contacts.last_name} (${t.role})`;
            memberSelect.appendChild(opt);
         }
       });
     }
  }
};

App.devAgent.closeProjectEditor = function() {
  document.getElementById('devProjectEditorPanel').classList.add('hidden');
  App.devAgent.loadActionItems();
};

App.devAgent.saveProjectEditor = async function(e) {
  e.preventDefault();
  const id = document.getElementById('devEditProjectId').value;
  const name = document.getElementById('devEditProjectName').value;
  const description = document.getElementById('devEditProjectDesc').value;
  const status = document.getElementById('devEditProjectStatus').value;
  
  const payload = { name, description, status };
  
  // Provide a default app_project_id if not using multi-tenant JWTs yet
  payload.app_project_id = 'default';
  
  let result;
  if (id) {
    result = await window.supabaseClient.from('dev_projects').update(payload).eq('id', id);
  } else {
    result = await window.supabaseClient.from('dev_projects').insert([payload]);
  }
  
  if (result.error) {
    alert("Error saving project: " + result.error.message);
    return;
  }
  
  await App.devAgent.loadProjects();
  App.devAgent.closeProjectEditor();
};

App.devAgent.addProjectMember = async function() {
  const projId = document.getElementById('devEditProjectId').value;
  const contactId = document.getElementById('devEditProjectMemberSelect').value;
  if (!projId || !contactId) return;
  await window.supabaseClient.from('dev_project_members').insert([{ dev_project_id: projId, contact_id: contactId }]);
  App.devAgent.openProjectEditor(projId);
};

App.devAgent.removeProjectMember = async function(memberId, projId) {
  await window.supabaseClient.from('dev_project_members').delete().eq('id', memberId);
  App.devAgent.openProjectEditor(projId);
};

App.devAgent.cloneProject = async function(projectId) {
  if (!confirm('Are you sure you want to clone this project?')) return;
  try {
    const { data: proj, error } = await window.supabaseClient.from('dev_projects').select('*').eq('id', projectId).single();
    if (error) throw error;
    
    const newProj = {
      name: proj.name + ' (Clone)',
      description: proj.description,
      status: 'planning',
      repo_url: proj.repo_url
    };
    
    const { error: insertErr } = await window.supabaseClient.from('dev_projects').insert([newProj]);
    if (insertErr) throw insertErr;
    
    App.notify('Project cloned successfully.', false);
    App.devAgent.loadProjects();
  } catch (err) {
    App.notify('Error cloning project: ' + err.message, true);
  }
};

App.devAgent.deleteProject = async function(projectId) {
  if (!confirm('Are you sure you want to delete this project? This will also delete all associated tasks.')) return;
  try {
    await window.supabaseClient.from('dev_tasks').delete().eq('project_id', projectId);
    const { error } = await window.supabaseClient.from('dev_projects').delete().eq('id', projectId);
    if (error) throw error;
    
    App.notify('Project deleted.', false);
    App.devAgent.loadProjects();
  } catch (err) {
    App.notify('Error deleting project: ' + err.message, true);
  }
};

App.devAgent.cloneTask = async function(taskId) {
  if (!confirm('Are you sure you want to clone this task?')) return;
  try {
    const { data: task, error } = await window.supabaseClient.from('dev_tasks').select('*').eq('id', taskId).single();
    if (error) throw error;
    
    const newTask = {
      title: task.title + ' (Clone)',
      description: task.description,
      status: 'backlog',
      priority: task.priority,
      assignee: task.assignee,
      project_id: task.project_id
    };
    
    const { error: insertErr } = await window.supabaseClient.from('dev_tasks').insert([newTask]);
    if (insertErr) throw insertErr;
    
    App.notify('Task cloned successfully.', false);
    App.devAgent.loadTasks();
  } catch (err) {
    App.notify('Error cloning task: ' + err.message, true);
  }
};

App.devAgent.startLinkingMode = function(sourceMessageId) {
  devState.linkingMode = { active: true, sourceMessageId };
  document.body.classList.add('dev-linking-mode');
  App.showToast('Select a task or another message to link...', 'info');
};

App.devAgent.finalizeLink = async function(targetType, targetId) {
  if (!devState.linkingMode || !devState.linkingMode.active) return;
  const sourceId = devState.linkingMode.sourceMessageId;
  devState.linkingMode = { active: false };
  document.body.classList.remove('dev-linking-mode');
  
  if (targetType === 'message' && String(sourceId) === String(targetId)) {
    App.showToast('Cannot link a message to itself', 'error');
    return;
  }
  
  try {
    const res = await App.api('/api/develop/devAgent/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_message_id: sourceId, target_type: targetType, target_id: targetId })
    });
    if (res.ok) {
      App.showToast('Successfully linked!', 'success');
    } else {
      App.showToast('Failed to link: ' + (res.error?.message || res.error), 'error');
    }
  } catch (err) {
    App.showToast('Failed to link.', 'error');
  }
};

// Global click handler for linking mode
document.body.addEventListener('click', (e) => {
  if (devState.linkingMode && devState.linkingMode.active) {
    // Allow clicking the 'Link' button itself without cancelling
    if (e.target.closest('.dev-copy-btn[id^="linkChat_"]')) return;
    
    const bubble = e.target.closest('.dev-chat-bubble-wrapper');
    if (bubble && bubble.id) {
       e.preventDefault(); e.stopPropagation();
       const targetId = bubble.id.replace('devChatNode_', '');
       return App.devAgent.finalizeLink('message', targetId);
    }
    
    const taskLi = e.target.closest('.dev-session-item');
    if (taskLi && taskLi.dataset.taskId) {
       e.preventDefault(); e.stopPropagation();
       return App.devAgent.finalizeLink('task', taskLi.dataset.taskId);
    }
    
    const taskBtn = e.target.closest('button[onclick^="App.devAgent.openTaskEditor"]');
    if (taskBtn) {
       e.preventDefault(); e.stopPropagation();
       const match = taskBtn.getAttribute('onclick').match(/'([^']+)'/);
       if (match && match[1]) return App.devAgent.finalizeLink('task', match[1]);
    }
    
    // If clicked anywhere else, cancel linking mode
    App.showToast('Linking mode cancelled', 'info');
    devState.linkingMode.active = false;
    document.body.classList.remove('dev-linking-mode');
  }
}, true);

// Auto-refresh dev dashboard and tasks pages when activated
if (typeof window.App !== 'undefined') {
  if (!window.App.manifests) window.App.manifests = [];
  window.App.manifests.push({
    manifest: { id: 'devAgentModule', pagePrefixes: ['devDashboard', 'devTasks', 'devForum', 'devTeam', 'devRoles', 'devProjects'] },
    onPageActivated: function(pageId) {
      const chatPanel = document.getElementById('devAllMessagesPanel');
      if (pageId === 'devDashboardPage') {
        if (typeof App.devAgent.loadActionItems === 'function') App.devAgent.loadActionItems();
        if (typeof App.devAgent.loadSessions === 'function') App.devAgent.loadSessions();
        if (typeof App.devAgent.loadTeam === 'function') App.devAgent.loadTeam();
      } else if (pageId === 'devTasksPage') {
        if (typeof App.devAgent.loadTasksTable === 'function') App.devAgent.loadTasksTable();
      } else if (pageId === 'devForumPage') {
        if (typeof App.devAgent.loadSessions === 'function') App.devAgent.loadSessions();
        const rightCol = document.getElementById('devForumRightColumn');
        if (chatPanel && rightCol) rightCol.appendChild(chatPanel);
      } else if (pageId === 'devTeamPage') {
        if (typeof App.devAgent.showTeamBrowser === 'function') {
          void App.devAgent.ensureProjectContext().then(() => App.devAgent.showTeamBrowser());
        }
      } else if (pageId === 'devRolesPage') {
        if (typeof App.devAgent.showRolesBrowser === 'function') App.devAgent.showRolesBrowser();
      } else if (pageId === 'devProjectsPage') {
        if (typeof App.devAgent.showProjectBrowser === 'function') App.devAgent.showProjectBrowser();
      }
    }
  });
}


// --- Global Messages Feature ---

App.devAgent.allMessages = [];
App.devAgent.allMessagesSortKey = 'created_at';
App.devAgent.allMessagesSortAsc = false;

App.devAgent.loadAllMessages = async function() {
  if (!window.supabaseClient) return;
  const { data: messages, error: msgsError } = await window.supabaseClient
    .from('agent_messages')
    .select('id, session_id, role, created_at, content')
    .order('created_at', { ascending: false })
    .limit(100);

  if (msgsError) {
    console.error("Error fetching agent_messages:", msgsError);
    return;
  }

  const sessionIds = [...new Set(messages.map(m => m.session_id).filter(id => id))];
  
  let tasksDict = {};
  if (sessionIds.length > 0) {
    const { data: tasks, error: tasksError } = await window.supabaseClient
      .from('dev_tasks')
      .select('session_id, title')
      .in('session_id', sessionIds);

    if (!tasksError && tasks) {
      tasks.forEach(t => {
        tasksDict[t.session_id] = t.title;
      });
    }
  }

  const parseTargetAgent = (content) => {
    if (!content) return '-';
    try {
      const match = content.match(/\`\`\`json\n([\s\S]*?)\n\`\`\`/);
      if (match) {
        const json = JSON.parse(match[1]);
        if (json.state && json.state.target_agent) return json.state.target_agent;
      }
    } catch(e) {}
    return '-';
  };

  const parseMessageSnippet = (content) => {
    if (!content) return '-';
    try {
      const match = content.match(/\`\`\`json\n([\s\S]*?)\n\`\`\`/);
      if (match) {
        const json = JSON.parse(match[1]);
        if (json.payload && json.payload.content) {
            const txt = typeof json.payload.content === 'string' ? json.payload.content : JSON.stringify(json.payload.content);
            return txt.length > 100 ? txt.substring(0, 100) + '...' : txt;
        }
      }
    } catch(e) {}
    const cleanContent = content.replace(/\`\`\`[\s\S]*?\`\`\`/g, '').trim();
    return cleanContent.length > 100 ? cleanContent.substring(0, 100) + '...' : cleanContent || '[JSON Payload]';
  };

  App.devAgent.allMessages = messages.map(m => ({
    created_at: m.created_at,
    task_title: tasksDict[m.session_id] || `Session ${m.session_id}`,
    sender: m.role,
    receiver: parseTargetAgent(m.content),
    message: parseMessageSnippet(m.content),
    raw_content: m.content
  }));

  App.devAgent.renderAllMessages();
};

App.devAgent.renderAllMessages = function() {
  const tbody = document.getElementById('devAllMessagesTableBody');
  if (!tbody) return;

  const filterText = (document.getElementById('devAllMessagesFilter')?.value || '').toLowerCase();

  let filtered = App.devAgent.allMessages.filter(m => {
    if (!filterText) return true;
    return (m.task_title && m.task_title.toLowerCase().includes(filterText)) ||
           (m.sender && m.sender.toLowerCase().includes(filterText)) ||
           (m.receiver && m.receiver.toLowerCase().includes(filterText)) ||
           (m.message && m.message.toLowerCase().includes(filterText));
  });

  const key = App.devAgent.allMessagesSortKey;
  const asc = App.devAgent.allMessagesSortAsc;
  
  filtered.sort((a, b) => {
    let valA = a[key] || '';
    let valB = b[key] || '';
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();
    if (valA < valB) return asc ? -1 : 1;
    if (valA > valB) return asc ? 1 : -1;
    return 0;
  });

  tbody.textContent = '';
  filtered.forEach(m => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.onclick = () => App.devAgent.openMessageDetail(m);
    
    const dtTd = document.createElement('td');
    dtTd.style.whiteSpace = 'nowrap';
    dtTd.textContent = new Date(m.created_at).toLocaleString();
    
    const taskTd = document.createElement('td');
    taskTd.textContent = m.task_title;
    
    const sendTd = document.createElement('td');
    sendTd.style.textTransform = 'capitalize';
    const strongSend = document.createElement('strong');
    strongSend.textContent = m.sender;
    sendTd.appendChild(strongSend);
    
    const recvTd = document.createElement('td');
    recvTd.textContent = m.receiver;
    
    const msgTd = document.createElement('td');
    msgTd.style.color = '#666';
    msgTd.style.maxWidth = '300px';
    msgTd.style.whiteSpace = 'nowrap';
    msgTd.style.overflow = 'hidden';
    msgTd.style.textOverflow = 'ellipsis';
    msgTd.title = m.message;
    msgTd.textContent = m.message;
    
    tr.appendChild(dtTd);
    tr.appendChild(taskTd);
    tr.appendChild(sendTd);
    tr.appendChild(recvTd);
    tr.appendChild(msgTd);
    
    tbody.appendChild(tr);
  });
};

App.devAgent.openMessageDetail = function(msg) {
  const tableContainer = document.getElementById('devAllMessagesTableContainer');
  const detailContainer = document.getElementById('devMessageDetailContainer');
  const header = document.getElementById('devAllMessagesHeader');
  
  if(tableContainer) {
    tableContainer.style.display = 'none';
    tableContainer.classList.add('hidden');
  }
  if(header) {
    header.style.display = 'none';
    header.classList.add('hidden');
  }
  
  if(detailContainer) {
    detailContainer.style.display = 'flex';
    detailContainer.classList.remove('hidden');
    
    document.getElementById('devMessageDetailTitle').innerText = `Message from ${msg.sender}`;
    
    // Attempt to parse JSON payload to render nicely if it's a tool output/command
    let contentHtml = ``;
    try {
      const parsed = JSON.parse(msg.message);
      contentHtml = `<pre style="background:var(--bg-main); padding:1rem; border-radius:6px; overflow-x:auto; font-family:monospace; font-size:0.9rem; border:1px solid var(--border-light);">${JSON.stringify(parsed, null, 2)}</pre>`;
    } catch(e) {
      contentHtml = `<div style="white-space:pre-wrap; font-size:0.95rem; line-height:1.5;">${msg.message}</div>`;
    }
    
    const msgHtmlStr = `
      <div style="margin-bottom:1.5rem; font-size:0.9rem; color:var(--text-muted); border-bottom:1px solid var(--border-light); padding-bottom:1rem;">
        <div><strong>Task:</strong> ${msg.task_title || ''}</div>
        <div><strong>Date:</strong> ${new Date(msg.created_at).toLocaleString()}</div>
        <div><strong>To:</strong> ${msg.receiver || ''}</div>
      </div>
      ${contentHtml}
    `;
    const pDetail = new DOMParser();
    const dDoc = pDetail.parseFromString(msgHtmlStr, 'text/html');
    const msgDetailBody = document.getElementById('devMessageDetailBody');
    if (msgDetailBody) {
      msgDetailBody.textContent = '';
      Array.from(dDoc.body.childNodes).forEach(n => msgDetailBody.appendChild(n.cloneNode(true)));
    }
  }
};

App.devAgent.closeMessageDetail = function() {
  const tableContainer = document.getElementById('devAllMessagesTableContainer');
  const detailContainer = document.getElementById('devMessageDetailContainer');
  const header = document.getElementById('devAllMessagesHeader');
  
  if(detailContainer) {
    detailContainer.style.display = 'none';
    detailContainer.classList.add('hidden');
  }
  if(tableContainer) {
    tableContainer.style.display = 'block';
    tableContainer.classList.remove('hidden');
  }
  if(header) {
    header.style.display = 'flex';
    header.classList.remove('hidden');
  }
};

App.devAgent.sortAllMessages = function(key) {
  if (App.devAgent.allMessagesSortKey === key) {
    App.devAgent.allMessagesSortAsc = !App.devAgent.allMessagesSortAsc;
  } else {
    App.devAgent.allMessagesSortKey = key;
    App.devAgent.allMessagesSortAsc = true;
  }
  App.devAgent.renderAllMessages();
};

App.devAgent.filterAllMessages = function() {
  App.devAgent.renderAllMessages();
};


App.devAgent.currentTasksView = 'kanban';

App.devAgent.toggleTasksView = function() {
  const browser = document.getElementById('devTaskBrowserPanel');
  const kanban = document.getElementById('devDashboardKanban');
  const btn = document.getElementById('devTasksToggleViewBtn');
  const editor = document.getElementById('devTaskEditorPanel');
  
  if (editor && !editor.classList.contains('hidden')) {
    editor.classList.add('hidden');
  }

  if (App.devAgent.currentTasksView === 'list') {
    App.devAgent.currentTasksView = 'kanban';
    if(browser) {
      browser.classList.add('hidden');
      browser.style.display = 'none';
    }
    if(kanban) {
      kanban.classList.remove('hidden');
      kanban.style.display = 'flex';
    }
    if(btn) btn.innerText = 'List View';
    App.devAgent.loadActionItems(); // Refreshes Kanban items
  } else {
    App.devAgent.currentTasksView = 'list';
    if(kanban) {
      kanban.classList.add('hidden');
      kanban.style.display = 'none';
    }
    if(browser) {
      browser.classList.remove('hidden');
      browser.style.display = 'flex';
    }
    if(btn) btn.innerText = 'Kanban View';
    App.devAgent.loadTasksTable(); // Refresh table view
  }
};

// Also ensure showTaskBrowser resets appropriately
const oldShowTaskBrowser = App.devAgent.showTaskBrowser;
App.devAgent.showTaskBrowser = function() {
  const btn = document.getElementById('devTasksToggleViewBtn');
  const kanban = document.getElementById('devDashboardKanban');
  const browser = document.getElementById('devTaskBrowserPanel');
  
  if (kanban && !kanban.classList.contains('hidden')) {
    // If we're coming out of the editor back to the browser, preserve kanban view if it was active
    const editor = document.getElementById('devTaskEditorPanel');
    if (editor) editor.classList.add('hidden');
    App.devAgent.loadDashboard();
    return;
  }
  
  if (oldShowTaskBrowser) oldShowTaskBrowser.apply(this, arguments);
  
  if (App.devAgent.currentTasksView === 'kanban') {
     if(btn) btn.innerText = 'List View';
     if(browser) {
       browser.classList.add('hidden');
       browser.style.display = 'none';
     }
     if(kanban) {
       kanban.classList.remove('hidden');
       kanban.style.display = 'flex';
     }
     App.devAgent.loadDashboard();
  } else {
     if(btn) btn.innerText = 'Kanban View';
     if(kanban) {
       kanban.classList.add('hidden');
       kanban.style.display = 'none';
     }
     if(browser) {
       browser.classList.remove('hidden');
       browser.style.display = 'flex';
     }
     App.devAgent.loadTasksTable();
  }
};


App.devAgent.viewTaskProject = function() {
  const projId = document.getElementById('devEditTaskProject').value;
  if (projId) {
    if (App.setActivePage) App.setActivePage('devProjectsPage');
    setTimeout(() => {
      App.devAgent.openProjectEditor(projId);
    }, 100);
  }
};
