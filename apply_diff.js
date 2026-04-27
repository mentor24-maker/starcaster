const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

const extracted = fs.readFileSync('extracted_sections.html', 'utf8');

// 1. Replace the menu
const menuStart = '<li class="menu-item menu-item-right has-submenu">\n          <a href="#" class="menu-link" data-page="devAgentPage">Dev</a>';
const menuEnd = '          </div>\n        </li>';
const startIdx = html.indexOf(menuStart);
const endIdx = html.indexOf(menuEnd, startIdx);

const newMenu = `<li class="menu-item menu-item-right has-submenu">
          <a href="#" class="menu-link" data-page="devDashboardPage">Dev</a>
          <div class="submenu">
            <a href="#" class="menu-link submenu-link" data-page="devDashboardPage">Dashboard</a>
            <a href="#" class="menu-link submenu-link" data-page="devProjectsPage">Projects</a>
            <a href="#" class="menu-link submenu-link" data-page="devTasksPage">Tasks</a>
            <a href="#" class="menu-link submenu-link" data-page="devForumPage">Forum</a>
            <a href="#" class="menu-link submenu-link" data-page="devTeamPage">Team</a>
            <a href="#" class="menu-link submenu-link" data-page="devRolesPage">Roles</a>
            <a href="#" class="menu-link submenu-link" data-page="devFrictionPage">Friction Logs</a>
          </div>
        </li>`;

if (startIdx !== -1 && endIdx !== -1) {
  html = html.substring(0, startIdx) + newMenu + html.substring(endIdx + menuEnd.length);
  console.log('Menu replaced successfully.');
} else {
  console.log('Could not find menu block!');
}

// 2. Replace the devAgentPage section
const sectionStart = '<section id="devAgentPage" class="app-page hidden">';
const sectionEndStr = '<section id="askIzzyPage"';
const sStartIdx = html.indexOf(sectionStart);
const sEndIdx = html.indexOf(sectionEndStr, sStartIdx);

if (sStartIdx !== -1 && sEndIdx !== -1) {
  html = html.substring(0, sStartIdx) + extracted + '\n\n      ' + html.substring(sEndIdx);
  console.log('Sections replaced successfully.');
} else {
  console.log('Could not find devAgentPage block!');
}

fs.writeFileSync('public/index.html', html);
console.log('Done writing index.html.');
