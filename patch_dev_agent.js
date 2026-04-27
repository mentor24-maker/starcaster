const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

// 1. Add projects nav binding
content = content.replace(
  "if (navItem === 'tasks') App.devAgent.showTaskBrowser();",
  "if (navItem === 'projects') App.devAgent.showProjectBrowser();\n      else if (navItem === 'tasks') App.devAgent.showTaskBrowser();"
);

// 2. Make showProjectBrowser and project CRUD functions
const projectCode = `
App.devAgent.showProjectBrowser = async function() {
  document.getElementById('devChatLog').classList.add('hidden');
  document.getElementById('devChatForm').classList.add('hidden');
  const header = document.getElementById('devChatMainHeader'); if(header) header.classList.add('hidden');
  const overlay = document.getElementById('devPersistentOverlay'); if(overlay) overlay.classList.add('hidden');
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
  
  await App.devAgent.loadProjects();
};

App.devAgent.loadProjects = async function() {
  if (!window.supabaseClient) return;
  const tbody = document.getElementById('devProjectBrowserTable');
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Loading...</td></tr>';
  
  const { data, error } = await window.supabaseClient.from('dev_projects').select('*, dev_project_members(count)').order('created_at', { ascending: false });
  if (error) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:red;">Error loading projects</td></tr>';
    return;
  }
  
  devState.projects = data || [];
  
  // also populate the task project dropdown
  const taskProjectSelect = document.getElementById('devEditTaskProject');
  if (taskProjectSelect) {
     const currentVal = taskProjectSelect.value;
     taskProjectSelect.innerHTML = '<option value="">-- No Project --</option>';
     devState.projects.forEach(p => {
       const opt = document.createElement('option');
       opt.value = p.id;
       opt.textContent = p.name;
       taskProjectSelect.appendChild(opt);
     });
     taskProjectSelect.value = currentVal;
  }
  
  if (!tbody) return;
  tbody.innerHTML = '';
  if (devState.projects.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No active projects.</td></tr>';
    return;
  }
  
  devState.projects.forEach(proj => {
    const tr = document.createElement('tr');
    tr.innerHTML = \`
      <td><strong>\${proj.name}</strong></td>
      <td>\${proj.description || ''}</td>
      <td><span class="badge">\${proj.status}</span></td>
      <td>\${proj.dev_project_members[0].count}</td>
      <td>\${new Date(proj.created_at).toLocaleDateString()}</td>
      <td style="text-align:right;">
        <button type="button" class="secondary-btn tiny-btn" onclick="App.devAgent.openProjectEditor('\${proj.id}')">Edit</button>
      </td>
    \`;
    tbody.appendChild(tr);
  });
};

App.devAgent.openProjectEditor = async function(id = null) {
  const browserPanel = document.getElementById('devProjectBrowserPanel'); if(browserPanel) browserPanel.classList.add('hidden');
  const editorPanel = document.getElementById('devProjectEditorPanel'); if(editorPanel) editorPanel.classList.remove('hidden');
  
  document.getElementById('devProjectEditorHeader').textContent = id ? 'Edit Project' : 'New Project';
  const form = document.getElementById('devProjectEditorForm');
  if (form) form.reset();
  document.getElementById('devEditProjectId').value = id || '';
  
  const memberList = document.getElementById('devEditProjectMembersList');
  if (memberList) memberList.innerHTML = '';
  
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
          badge.innerHTML = \`\${m.contacts ? m.contacts.first_name + ' ' + m.contacts.last_name : m.contact_id} <span style="cursor:pointer; margin-left:4px;" onclick="App.devAgent.removeProjectMember('\${m.id}', '\${id}')">&times;</span>\`;
          memberList.appendChild(badge);
        });
      }
    }
  }
  
  // load available team members into select
  const memberSelect = document.getElementById('devEditProjectMemberSelect');
  if (memberSelect) {
     memberSelect.innerHTML = '<option value="">-- Add Team Member --</option>';
     const { data: team } = await window.supabaseClient.from('dev_team').select('*, contacts(*)');
     if (team) {
       team.forEach(t => {
         if (t.contacts) {
            const opt = document.createElement('option');
            opt.value = t.contacts.id;
            opt.textContent = \`\${t.contacts.first_name} \${t.contacts.last_name} (\${t.role})\`;
            memberSelect.appendChild(opt);
         }
       });
     }
  }
};

App.devAgent.closeProjectEditor = function() {
  document.getElementById('devProjectEditorPanel').classList.add('hidden');
  App.devAgent.showProjectBrowser();
};

App.devAgent.saveProjectEditor = async function(e) {
  e.preventDefault();
  const id = document.getElementById('devEditProjectId').value;
  const name = document.getElementById('devEditProjectName').value;
  const description = document.getElementById('devEditProjectDesc').value;
  const status = document.getElementById('devEditProjectStatus').value;
  
  const payload = { name, description, status };
  if (id) {
    await window.supabaseClient.from('dev_projects').update(payload).eq('id', id);
  } else {
    await window.supabaseClient.from('dev_projects').insert([payload]);
  }
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
`;

// Insert the code at the bottom of the file
content += "\n" + projectCode;

// 3. Bind new project buttons
const bindCode = `
  const devNewProjectBtn = document.getElementById('devNewProjectBtn');
  if (devNewProjectBtn) devNewProjectBtn.addEventListener('click', () => App.devAgent.openProjectEditor());
  const devCloseProjectEditorBtn = document.getElementById('devCloseProjectEditorBtn');
  if (devCloseProjectEditorBtn) devCloseProjectEditorBtn.addEventListener('click', App.devAgent.closeProjectEditor);
  const devProjectEditorForm = document.getElementById('devProjectEditorForm');
  if (devProjectEditorForm) devProjectEditorForm.addEventListener('submit', App.devAgent.saveProjectEditor);
  const devEditProjectMemberAddBtn = document.getElementById('devEditProjectMemberAddBtn');
  if (devEditProjectMemberAddBtn) devEditProjectMemberAddBtn.addEventListener('click', App.devAgent.addProjectMember);
`;
content = content.replace(
  "// Tasks binding",
  bindCode + "\n  // Tasks binding"
);

// 4. Update restoreChatPanel and other show functions to hide the project panels
const panelsToHide = "  const pb = document.getElementById('devProjectBrowserPanel'); if(pb) pb.classList.add('hidden');\n  const pe = document.getElementById('devProjectEditorPanel'); if(pe) pe.classList.add('hidden');\n";
content = content.replace(/App\.devAgent\.restoreChatPanel = function\(\) \{/, "App.devAgent.restoreChatPanel = function() {\n" + panelsToHide);
content = content.replace(/App\.devAgent\.showTaskBrowser = async function\(\) \{/, "App.devAgent.showTaskBrowser = async function() {\n" + panelsToHide);
content = content.replace(/App\.devAgent\.showTeamBrowser = async function\(\) \{/, "App.devAgent.showTeamBrowser = async function() {\n" + panelsToHide);
content = content.replace(/App\.devAgent\.showRolesBrowser = async function\(\) \{/, "App.devAgent.showRolesBrowser = async function() {\n" + panelsToHide);

// 5. Default to showProjectBrowser on dev load instead of restoreChatPanel or whatever it was
// Actually, let's find loadHistory or init.
content = content.replace(
  "App.devAgent.loadHistory(devState.activeSessionId);",
  "App.devAgent.loadHistory(devState.activeSessionId);\n    // Force default to projects\n    setTimeout(() => App.devAgent.showProjectBrowser(), 100);"
);

// Update task loading to include project
content = content.replace(
  "const { data, error } = await window.supabaseClient.from('dev_tasks').select('*')",
  "const { data, error } = await window.supabaseClient.from('dev_tasks').select('*, dev_projects(name)')"
);

// Update task rendering to include project name
content = content.replace(
  "<td><strong>${task.title}</strong></td>",
  "<td><strong>${task.title}</strong></td>\n      <td>${task.dev_projects ? task.dev_projects.name : ''}</td>"
);

// Update saveTaskEditor to save project
content = content.replace(
  "const status = document.getElementById('devEditTaskStatus').value;",
  "const status = document.getElementById('devEditTaskStatus').value;\n  const project_id = document.getElementById('devEditTaskProject').value || null;"
);
content = content.replace(
  "const payload = { title, description, status, priority, assignee };",
  "const payload = { title, description, status, priority, assignee, project_id };"
);

// Update openTaskEditor to load project
content = content.replace(
  "document.getElementById('devEditTaskStatus').value = task.status || 'todo';",
  "document.getElementById('devEditTaskStatus').value = task.status || 'todo';\n      document.getElementById('devEditTaskProject').value = task.project_id || '';"
);

fs.writeFileSync('public/js/devAgent.js', content);
console.log("Patched devAgent.js");
