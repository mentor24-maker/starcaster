const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

// Store project tasks in state
const newFuncs = `
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
  const statusFilter = document.getElementById('devProjectTasksFilterStatus').value;
  const priorityFilter = document.getElementById('devProjectTasksFilterPriority').value;
  
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
  
  filtered.forEach(t => {
    const tr = document.createElement('tr');
    tr.innerHTML = \`
      <td>\${t.title}</td>
      <td><span class="badge badge-gray" style="text-transform: capitalize;">\${t.status.replace('_', ' ')}</span></td>
      <td><span class="badge badge-gray" style="text-transform: capitalize;">\${t.priority}</span></td>
      <td style="text-transform: capitalize;">\${t.assignee}</td>
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
      App.devAgent.openTaskEditor(t.id, t.project_id);
    });
    
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Are you sure you want to delete this task?')) {
        try {
          await window.supabaseClient.from('dev_tasks').delete().eq('id', t.id);
          App.notify('Task deleted successfully', 'success');
          App.devAgent.openProjectEditor(t.project_id); // Reload the list
          if (typeof App.devAgent.loadDashboard === 'function') App.devAgent.loadDashboard();
        } catch (err) {
          App.notify('Failed to delete task', 'error');
        }
      }
    });
    
    taskTbody.appendChild(tr);
  });
};
`;

if (!content.includes('App.devAgent.currentProjectTasks')) {
  content += '\n' + newFuncs;
}

// Extract old render logic and replace it with state saving and rendering
const startToken = "if (!tasks || tasks.length === 0) {";
const endToken = "taskTbody.appendChild(tr);\n           });\n        }";
const replaceTarget = content.substring(content.indexOf(startToken), content.indexOf(endToken) + endToken.length);

const replacement = `App.devAgent.currentProjectTasks = tasks || [];
        App.devAgent.renderProjectTasks();`;

content = content.replace(replaceTarget, replacement);

fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
