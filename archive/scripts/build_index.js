const fs = require('fs');
let html = fs.readFileSync('public/index.html.new', 'utf8');

// 1. Update the Dev menu
const navOld = `<a href="#" class="menu-link" data-page="devAgentPage">Dev</a>
          <div class="submenu">
            <a href="#" class="menu-link submenu-link" data-page="devAgentPage">Tasks</a>
            <a href="#" class="menu-link submenu-link" data-page="devAgentPage">Forum</a>
            <a href="#" class="menu-link submenu-link" data-page="devAgentPage">Team</a>
            <a href="#" class="menu-link submenu-link" data-page="devAgentPage">Friction</a>
          </div>`;

const navNew = `<a href="#" class="menu-link" data-page="devDashboardPage">Dev</a>
          <div class="submenu">
            <a href="#" class="menu-link submenu-link" data-page="devDashboardPage">Dashboard</a>
            <a href="#" class="menu-link submenu-link" data-page="devProjectsPage">Projects</a>
            <a href="#" class="menu-link submenu-link" data-page="devTasksPage">Tasks</a>
            <a href="#" class="menu-link submenu-link" data-page="devForumPage">Forum</a>
            <a href="#" class="menu-link submenu-link" data-page="devTeamPage">Team</a>
            <a href="#" class="menu-link submenu-link" data-page="devRolesPage">Roles</a>
            <a href="#" class="menu-link submenu-link" data-page="devFrictionPage">Friction Logs</a>
          </div>`;

if (html.includes(navOld)) {
    html = html.replace(navOld, navNew);
} else {
    console.log("Could not find nav menu to replace! Maybe already updated?");
}

// 2. Add devDashboardPage
const dashboardPage = `      <section id="devDashboardPage" class="app-page hidden">
        <div class="page-heading-row">
          <h2>Dev Dashboard</h2>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
          <div style="background: #e3f2fd; border-radius: 40px; padding: 2rem; display: flex; flex-direction: column; border: 2px solid #bbdefb; overflow-y: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
            <h3 style="margin-top: 0; border-bottom: 1px solid var(--border-light); padding-bottom: 0.5rem; color: var(--text-primary);">Recent Threads</h3>
            <ul id="devDashboardForumList" class="dev-session-list" style="flex: 1; overflow-y: auto; list-style: none; padding-left: 0; margin-top: 0.5rem;">
            </ul>
          </div>
          <div style="background: #e3f2fd; border-radius: 40px; padding: 2rem; display: flex; flex-direction: column; border: 2px solid #bbdefb; overflow-y: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
            <h3 style="margin-top: 0; border-bottom: 1px solid var(--border-light); padding-bottom: 0.5rem; color: var(--text-primary);">Friction Log</h3>
            <ul id="devDashboardFrictionList" class="dev-session-list" style="flex: 1; overflow-y: auto; list-style: none; padding-left: 0; margin-top: 0.5rem;">
            </ul>
          </div>
        </div>
      </section>
`;
if (!html.includes('id="devDashboardPage"')) {
    html = html.replace('<section id="devProjectsPage"', dashboardPage + '      <section id="devProjectsPage"');
}

// 3. Inject task panels into devTasksPage
const devTasksPageTarget = `<section id="devTasksPage" class="app-page hidden">
        <div class="page-heading-row">
          <h2>Tasks</h2>
        </div>
        
        
      </section>`;

const taskPanels = fs.readFileSync('task_panels.txt', 'utf8');

const devTasksPageNew = `<section id="devTasksPage" class="app-page hidden">
        <div class="page-heading-row">
          <h2>Tasks</h2>
        </div>
        <div style="display:flex; gap:0.5rem; justify-content: flex-end; margin-bottom: 1rem;">
          <button id="devTasksToggleViewBtn" class="secondary-btn" onclick="App.devAgent.toggleTasksView()">Kanban View</button>
          <button id="devTasksNewTaskBtn" class="primary-btn" onclick="App.devAgent.openTaskEditor()">+ New Task</button>
        </div>
        ${taskPanels}
      </section>`;

if (html.includes(devTasksPageTarget)) {
    html = html.replace(devTasksPageTarget, devTasksPageNew);
} else {
    console.log("Could not find devTasksPage to replace!");
}

// 4. Ensure structural balance (adding the missing closing div for appShell)
let d = 0;
for(let i=0; i<html.length; i++){
    if(html.startsWith('<div', i) && (html[i+4]===' ' || html[i+4]==='>')) d++;
    else if(html.startsWith('</div', i) && html[i+5]==='>') d--;
}
if(d > 0) {
    html = html.replace('    <!-- SDKs -->', '    ' + '</div>\n'.repeat(d) + '    <!-- SDKs -->');
}

fs.writeFileSync('public/index.html', html);
console.log("Built index.html successfully. Imbalance was:", d);
