const fs = require('fs');

let html = fs.readFileSync('public/index.html', 'utf8');

// 1. Update Navigation
const navOld = `        <li class="menu-item has-submenu">
          <a href="#" class="menu-link" data-page="devAgentPage">Dev</a>
          <ul class="submenu">
            <a href="#" class="menu-link submenu-link" data-page="devAgentPage">Tasks</a>
            <a href="#" class="menu-link submenu-link" data-page="devAgentPage">Forum</a>
            <a href="#" class="menu-link submenu-link" data-page="devAgentPage">Team</a>
            <a href="#" class="menu-link submenu-link" data-page="devAgentPage">Friction</a>
            <a href="#" class="menu-link submenu-link" data-page="devAgentPage">IDE Log</a>
          </ul>
        </li>`;
const navNew = `        <li class="menu-item has-submenu">
          <a href="#" class="menu-link" data-page="devProjectsPage">Dev</a>
          <ul class="submenu">
            <a href="#page=devProjectsPage" class="menu-link submenu-link">Projects</a>
            <a href="#page=devTasksPage" class="menu-link submenu-link">Tasks</a>
            <a href="#page=devForumPage" class="menu-link submenu-link">Forum</a>
            <a href="#page=devTeamPage" class="menu-link submenu-link">Team</a>
            <a href="#page=devRolesPage" class="menu-link submenu-link">Roles</a>
            <a href="#page=devFrictionPage" class="menu-link submenu-link">Friction Logs</a>
          </ul>
        </li>`;

html = html.replace(navOld, navNew);

// 2. Extract specific panels from devAgentPage
function extractPanel(htmlStr, startPattern, endPattern) {
    const startIdx = htmlStr.indexOf(startPattern);
    if (startIdx === -1) return { extracted: '', remaining: htmlStr };
    const endIdx = htmlStr.indexOf(endPattern, startIdx);
    if (endIdx === -1) return { extracted: '', remaining: htmlStr };
    
    const extracted = htmlStr.substring(startIdx, endIdx + endPattern.length);
    const remaining = htmlStr.substring(0, startIdx) + htmlStr.substring(endIdx + endPattern.length);
    return { extracted, remaining };
}

let res;

res = extractPanel(html, '<div id="devTaskBrowserPanel"', '</div>\n            </div>');
const taskBrowserPanel = res.extracted;
html = res.remaining;

res = extractPanel(html, '<div id="devTaskEditorPanel"', '</form>\n            </div>');
const taskEditorPanel = res.extracted;
html = res.remaining;

res = extractPanel(html, '<div id="devFrictionEditorPanel"', '</form>\n            </div>');
const frictionEditorPanel = res.extracted;
html = res.remaining;

res = extractPanel(html, '<aside class="dev-friction-sidebar"', '</aside>');
const frictionSidebar = res.extracted;
html = res.remaining;

// 3. Define new HTML pages

const devProjectsPage = `
      <section id="devProjectsPage" class="app-page hidden">
        <div class="page-heading-row">
          <h2>Projects</h2>
          <button id="devNewProjectBtn" class="primary-btn">+ New Project</button>
        </div>
        <div id="devProjectBrowserPanel" style="flex-direction: column; width: 100%; height: 100%; padding: 2rem; background: var(--bg-card); overflow-y: auto;">
          <div class="table-wrap">
            <table class="data-table" style="width: 100%;">
              <thead>
                <tr><th style="text-align:left;">Project Name</th><th>Description</th><th>Status</th><th>Members</th><th>Actions</th></tr>
              </thead>
              <tbody id="devProjectBrowserTable"></tbody>
            </table>
          </div>
        </div>
        <div id="devProjectEditorPanel" class="hidden" style="flex-direction: column; width: 100%; height: 100%; padding: 2rem; background: var(--bg-card); overflow-y: auto;">
          <h2 id="devProjectEditorHeader" style="margin-top: 0;">Project Details</h2>
          <form id="devProjectEditorForm" class="standard-form-grid" style="max-width: 800px;">
            <input type="hidden" id="devEditProjectId" />
            <div class="form-group full-width">
              <label for="devEditProjectName">Project Name</label>
              <input type="text" id="devEditProjectName" required />
            </div>
            <div class="form-group full-width">
              <label for="devEditProjectDesc">Description</label>
              <textarea id="devEditProjectDesc" style="min-height: 120px;"></textarea>
            </div>
            <div class="form-group">
              <label for="devEditProjectStatus">Status</label>
              <select id="devEditProjectStatus">
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <div class="form-group">
              <label>Team Members</label>
              <div id="devProjectMemberList" style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.5rem;"></div>
              <select id="devAddProjectMemberSelect"></select>
              <button type="button" id="devAddProjectMemberBtn" class="secondary-btn" style="margin-top:0.5rem;">Add Member</button>
            </div>
            <div class="form-actions full-width" style="margin-top: 1rem;">
              <button type="submit" class="primary-btn">Save Project</button>
              <button type="button" id="devCloseProjectEditorBtn" class="secondary-btn">Close</button>
            </div>
          </form>
        </div>
      </section>
`;

const devTasksPage = `
      <section id="devTasksPage" class="app-page hidden">
        <div class="page-heading-row">
          <h2>Tasks</h2>
          <button id="devTasksNewTaskBtn" class="primary-btn" onclick="App.devAgent.openTaskEditor()">+ New Task</button>
        </div>
        ${taskBrowserPanel.replace('class="hidden"', 'class=""')}
        ${taskEditorPanel}
      </section>
`;

const devTeamPage = `
      <section id="devTeamPage" class="app-page hidden">
        <div class="page-heading-row">
          <h2>Team Members</h2>
          <button id="devNewTeamBtn" class="primary-btn" onclick="App.contacts.openEditPage(null, 'devTeamPage')">+ Add Member (via Contacts)</button>
        </div>
        <div id="devTeamBrowserPanel" style="flex-direction: column; width: 100%; height: 100%; padding: 2rem; background: var(--bg-card); overflow-y: auto;">
          <div class="table-wrap">
            <table class="data-table" style="width: 100%;">
              <thead>
                <tr><th style="text-align:left;">Member Name</th><th>Type</th><th>Role</th><th>Joined</th><th>Actions</th></tr>
              </thead>
              <tbody id="devTeamBrowserTable"></tbody>
            </table>
          </div>
        </div>
        <div id="devTeamEditorPanel" class="hidden" style="flex-direction: column; width: 100%; height: 100%; padding: 2rem; background: var(--bg-card); overflow-y: auto;">
           <!-- Editor functionality uses Contacts UI -->
        </div>
      </section>
`;

const devRolesPage = `
      <section id="devRolesPage" class="app-page hidden">
        <div class="page-heading-row">
          <h2>Roles & Permissions</h2>
          <button id="devNewRoleBtn" class="primary-btn">+ New Role</button>
        </div>
        <div id="devRolesBrowserPanel" style="flex-direction: column; width: 100%; height: 100%; padding: 2rem; background: var(--bg-card); overflow-y: auto;">
          <div class="table-wrap">
            <table class="data-table" style="width: 100%;">
              <thead>
                <tr><th style="text-align:left;">Role Name</th><th>Description</th></tr>
              </thead>
              <tbody id="devRolesBrowserTable"></tbody>
            </table>
          </div>
        </div>
        <div id="devRoleEditorPanel" class="hidden" style="flex-direction: column; width: 100%; height: 100%; padding: 2rem; background: var(--bg-card); overflow-y: auto;">
          <h2 id="devRoleEditorHeader" style="margin-top: 0;">Role Details</h2>
          <form id="devRoleEditorForm" class="standard-form-grid" style="max-width: 800px;">
            <input type="hidden" id="devEditRoleId" />
            <div class="form-group full-width">
              <label for="devEditRoleName">Role Name</label>
              <input type="text" id="devEditRoleName" required />
            </div>
            <div class="form-group full-width">
              <label for="devEditRoleDesc">Description</label>
              <textarea id="devEditRoleDesc" style="min-height: 120px;"></textarea>
            </div>
            <div class="form-actions full-width" style="margin-top: 1rem;">
              <button type="submit" class="primary-btn">Save Role</button>
              <button type="button" id="devCloseRoleEditorBtn" class="secondary-btn">Close</button>
            </div>
          </form>
        </div>
      </section>
`;

const devFrictionPage = `
      <section id="devFrictionPage" class="app-page hidden">
        <div class="page-heading-row">
          <h2>Friction Logs</h2>
          <button id="devNewFrictionBtn" class="primary-btn">+ New Log</button>
        </div>
        <div style="display: flex; flex-direction: row; gap: 2rem; padding: 2rem; height: calc(100vh - 120px); align-items: flex-start;">
          <div style="flex: 1; min-width: 0;">
            ${frictionEditorPanel.replace('class="hidden"', 'class=""')}
          </div>
          <div style="width: 400px; flex-shrink: 0; position: static; height: 100%;">
            ${frictionSidebar}
          </div>
        </div>
      </section>
`;

// Also rename devAgentPage to devForumPage
html = html.replace('<section id="devAgentPage" class="app-page hidden">', '<section id="devForumPage" class="app-page hidden">');

// Insert the new pages right after devForumPage closes
const forumCloseTag = '      </section>\n\n      <section id="askIzzyPage"';
const pagesToInsert = `
${devProjectsPage}
${devTasksPage}
${devTeamPage}
${devRolesPage}
${devFrictionPage}
      </section>\n\n      <section id="askIzzyPage"`;

html = html.replace(forumCloseTag, pagesToInsert);

fs.writeFileSync('public/index.html.new', html);
console.log('Processed. Original Length:', fs.readFileSync('public/index.html', 'utf8').length, 'New Length:', html.length);
