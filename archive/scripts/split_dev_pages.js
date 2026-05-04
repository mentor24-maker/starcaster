const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// 1. Update navigation menu
const navOld = `<a href="#" class="menu-link" data-page="devTasksPage">Dev</a>
          <div class="submenu">
            <a href="#" class="menu-link submenu-link" onclick="App.devAgent.openProjectsPage(); return false;" data-page="devProjectsPage">Projects</a>
            <a href="#" class="menu-link submenu-link" onclick="App.devAgent.openTasksPage(); return false;" data-page="devTasksPage">Tasks</a>
            <a href="#" class="menu-link submenu-link" onclick="App.devAgent.openForumPage(); return false;" data-page="devForumPage">Forum</a>
            <a href="#" class="menu-link submenu-link" onclick="App.devAgent.openTeamPage(); return false;" data-page="devTeamPage">Team</a>
            <a href="#" class="menu-link submenu-link" onclick="App.devAgent.openRolesPage(); return false;" data-page="devRolesPage">Roles</a>
            <a href="#" class="menu-link submenu-link" onclick="App.devAgent.openFrictionPage(); return false;" data-page="devFrictionPage">Friction Logs</a>
          </div>`;

const navNew = `<a href="#" class="menu-link" data-page="devTasksPage">Dev</a>
          <div class="submenu">
            <a href="#" class="menu-link submenu-link" data-page="devProjectsPage">Projects</a>
            <a href="#" class="menu-link submenu-link" data-page="devTasksPage">Tasks</a>
            <a href="#" class="menu-link submenu-link" data-page="devForumPage">Forum</a>
            <a href="#" class="menu-link submenu-link" data-page="devTeamPage">Team</a>
            <a href="#" class="menu-link submenu-link" data-page="devRolesPage">Roles</a>
            <a href="#" class="menu-link submenu-link" data-page="devFrictionPage">Friction Logs</a>
          </div>`;

html = html.replace(navOld, navNew);

// 2. Extract pieces from devAgentPage
// It's a huge string. I'll read it manually.
