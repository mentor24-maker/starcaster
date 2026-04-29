const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

// 1. Fix appendChatNode empty-state error
content = content.replace(
  "if (devElements.log.querySelector('.empty-state')) {\n    devElements.log.innerHTML = '';\n  }",
  "if (logContainer && logContainer.querySelector('.empty-state')) {\n    logContainer.innerHTML = '';\n  }"
);

// 2. Fix loadHistory catch block
content = content.replace(
  "devElements.log.innerHTML = `<div class=\"error-msg\">Failed to load history. Error: ${err.message}<br><pre>${err.stack}</pre></div>`;\n    devElements.input.disabled = false;",
  "if(targetLog) targetLog.innerHTML = `<div class=\"error-msg\">Failed to load history. Error: ${err.message}<br><pre>${err.stack}</pre></div>`;\n    if (devElements.input) devElements.input.disabled = false;"
);

// 3. Add viewTaskProject function
const viewProjFunc = `
App.devAgent.viewTaskProject = function() {
  const projId = document.getElementById('devEditTaskProject').value;
  if (projId) {
    if (App.setActivePage) App.setActivePage('devProjectsPage');
    setTimeout(() => {
      App.devAgent.openProjectEditor(projId);
    }, 100);
  }
};
`;
if (!content.includes('App.devAgent.viewTaskProject')) {
  content += '\n' + viewProjFunc;
}

// 4. Update openTaskEditor to show view project btn, hide kanban, and set skipNextBrowserReset
content = content.replace(
  "App.devAgent.openTaskEditor = async function(taskId, returnToProjectId = null) {\n  App.setActivePage('devTasksPage');",
  "App.devAgent.openTaskEditor = async function(taskId, returnToProjectId = null) {\n  devState.skipNextBrowserReset = true;\n  App.setActivePage('devTasksPage');"
);

content = content.replace(
  "const browserPanel = document.getElementById('devTaskBrowserPanel'); if(browserPanel) browserPanel.classList.add('hidden');",
  "const browserPanel = document.getElementById('devTaskBrowserPanel'); if(browserPanel) browserPanel.classList.add('hidden');\n  const kanban = document.getElementById('devDashboardKanban'); if(kanban) { kanban.classList.add('hidden'); kanban.style.display = 'none'; }"
);

content = content.replace(
  "document.getElementById('devTaskEditorHeader').textContent = 'New Task';",
  "document.getElementById('devTaskEditorHeader').textContent = 'New Task';\n        const viewProjBtn = document.getElementById('devTasksViewProjectBtn'); if(viewProjBtn) viewProjBtn.classList.add('hidden');"
);

content = content.replace(
  "document.getElementById('devEditTaskProject');\n      if (projSel) projSel.value = log.project_id || '';",
  "document.getElementById('devEditTaskProject');\n      if (projSel) projSel.value = log.project_id || '';\n      const viewProjBtn = document.getElementById('devTasksViewProjectBtn');\n      if (viewProjBtn) {\n        if (log.project_id) viewProjBtn.classList.remove('hidden');\n        else viewProjBtn.classList.add('hidden');\n      }"
);

// 5. Fix closeTaskEditor
const oldCloseTask = `App.devAgent.closeTaskEditor = function() {
  const p = document.getElementById('devTaskEditorPanel'); p.classList.add('hidden'); p.style.display = '';
  if (devState.returnToProjectEditorId) {
    const projectId = devState.returnToProjectEditorId;
    devState.returnToProjectEditorId = null;
    App.devAgent.openProjectEditor(projectId);
    return;
  }
  App.devAgent.restoreChatPanel();
};`;

const newCloseTask = `App.devAgent.closeTaskEditor = function() {
  const viewProjBtn = document.getElementById('devTasksViewProjectBtn'); if(viewProjBtn) viewProjBtn.classList.add('hidden');
  const p = document.getElementById('devTaskEditorPanel'); p.classList.add('hidden'); p.style.display = '';
  if (devState.returnToProjectEditorId) {
    const projectId = devState.returnToProjectEditorId;
    devState.returnToProjectEditorId = null;
    App.devAgent.openProjectEditor(projectId);
    return;
  }
  App.devAgent.showTaskBrowser();
};`;
content = content.replace(oldCloseTask, newCloseTask);

// 6. Fix setActivePage setTimeout
content = content.replace(
  "      } else if (pageId === 'devTasksPage') {\n        await App.devAgent.loadTasks();\n        setTimeout(() => App.devAgent.showTaskBrowser(), 50);",
  "      } else if (pageId === 'devTasksPage') {\n        await App.devAgent.loadTasks();\n        if (devState.skipNextBrowserReset) {\n          devState.skipNextBrowserReset = false;\n        } else {\n          setTimeout(() => App.devAgent.showTaskBrowser(), 50);\n        }"
);


// 7. Update loadProjectTasks for sorting/filtering
const oldLoadProjectTasks = `App.devAgent.loadProjectTasks = async function(projectId) {
  const tbody = document.getElementById('devProjectTaskTableBody');
  if (!tbody) return;
  if (!projectId) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1rem; opacity:0.7;">Save the project first to add tasks.</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1rem; opacity:0.7;">Loading tasks...</td></tr>';
  try {
    const { data: tasks, error } = await window.supabaseClient
      .from('dev_tasks')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    if (!tasks || tasks.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1rem; opacity:0.7;">No tasks assigned to this project.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    tasks.forEach(task => {
      const tr = document.createElement('tr');
      tr.innerHTML = \`
        <td><strong>\${task.title || ''}</strong></td>
        <td>\${task.status || ''}</td>
        <td>\${task.priority || ''}</td>
        <td>\${task.assignee || ''}</td>
        <td>\${task.created_at ? new Date(task.created_at).toLocaleDateString() : ''}</td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="icon-btn" onclick="App.devAgent.openTaskEditor('\${task.id}', '\${projectId}')" title="Edit Task">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <button class="icon-btn danger-hover" onclick="App.devAgent.deleteProjectTask('\${task.id}', '\${projectId}')" title="Delete Task">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
          </button>
        </td>
      \`;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = \`<tr><td colspan="6" style="text-align:center; padding:1rem; color:red;">\${err.message || 'Unable to load tasks'}</td></tr>\`;
  }
};`;

const newLoadProjectTasks = `
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
    if (el) el.innerHTML = '';
  });
  
  const activeIcon = document.getElementById('devProjectTasksSort_' + key);
  if (activeIcon) {
    activeIcon.innerHTML = App.devAgent.projectTasksSortAsc ? '▲' : '▼';
  }
  
  App.devAgent.renderProjectTasks();
};

App.devAgent.renderProjectTasks = function() {
  const taskTbody = document.getElementById('devProjectTasksTableBody');
  if (!taskTbody) return;
  
  const titleFilter = (document.getElementById('devProjectTasksFilterTitle').value || '').toLowerCase();
  const statusFilter = document.getElementById('devProjectTasksFilterStatus').value || 'all';
  const priorityFilter = document.getElementById('devProjectTasksFilterPriority').value || 'all';
  
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
  
  taskTbody.innerHTML = '';
  
  if (filtered.length === 0) {
    taskTbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #666; font-style: italic;">No tasks match your filters.</td></tr>';
    return;
  }
  
  filtered.forEach(task => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', (e) => {
      e.stopPropagation();
      App.devAgent.openTaskEditor(task.id, task.project_id);
    });
    
    tr.innerHTML = \`
      <td>\${task.title || ''}</td>
      <td><span class="badge badge-gray" style="text-transform: capitalize;">\${(task.status || '').replace('_', ' ')}</span></td>
      <td><span class="badge badge-gray" style="text-transform: capitalize;">\${task.priority || ''}</span></td>
      <td style="text-transform: capitalize;">\${task.assignee || ''}</td>
      <td style="text-align: right; white-space: nowrap;">
        <button type="button" class="dev-action-btn edit-task-btn" title="Edit Task" style="background:none; border:none; cursor:pointer; color:var(--text-muted); padding:4px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
        </button>
        <button type="button" class="dev-action-btn del-task-btn" title="Delete Task" style="background:none; border:none; cursor:pointer; color:var(--accent-danger); padding:4px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
        </button>
      </td>
    \`;
    
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
  if (!projectId) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:1rem; opacity:0.7;">Save the project first to add tasks.</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:1rem; opacity:0.7;">Loading tasks...</td></tr>';
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
    tbody.innerHTML = \`<tr><td colspan="5" style="text-align:center; padding:1rem; color:red;">\${err.message || 'Unable to load tasks'}</td></tr>\`;
  }
};
`;

content = content.replace(oldLoadProjectTasks, newLoadProjectTasks);

fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
console.log('done');
