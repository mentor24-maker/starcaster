const fs = require('fs');

let html = fs.readFileSync('public/index.html', 'utf8');

// Update top nav
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

if (html.includes(navOld)) {
  html = html.replace(navOld, navNew);
  console.log("Nav menu updated.");
} else {
  console.log("Nav menu exact string not found, skipping or already updated.");
}

function extractDiv(id) {
    const startStr = `<div id="${id}"`;
    const startIdx = html.indexOf(startStr);
    if (startIdx === -1) return null;
    let divCount = 0;
    let inQuotes = false;
    let i = startIdx;
    while (i < html.length) {
        if (html[i] === '"') inQuotes = !inQuotes;
        if (!inQuotes) {
            if (html.substr(i, 4) === '<div') { divCount++; }
            if (html.substr(i, 6) === '</div') { divCount--; }
        }
        if (divCount === 0 && html.substr(i, 6) === '</div>') {
            return {
                html: html.substring(startIdx, i + 6),
                start: startIdx,
                end: i + 6
            };
        }
        i++;
    }
    return null;
}

function extractSection(id) {
    const startStr = `<section id="${id}"`;
    const startIdx = html.indexOf(startStr);
    if (startIdx === -1) return null;
    let count = 0;
    let inQuotes = false;
    let i = startIdx;
    while (i < html.length) {
        if (html[i] === '"') inQuotes = !inQuotes;
        if (!inQuotes) {
            if (html.substr(i, 8) === '<section') { count++; }
            if (html.substr(i, 9) === '</section') { count--; }
        }
        if (count === 0 && html.substr(i, 10) === '</section>') {
            return {
                html: html.substring(startIdx, i + 10),
                start: startIdx,
                end: i + 10
            };
        }
        i++;
    }
    return null;
}

const devAgentPage = extractSection('devAgentPage');
if (!devAgentPage) {
    console.log("Could not find devAgentPage");
    process.exit(1);
}

// Sub components
const projBrowser = extractDiv('devProjectBrowserPanel');
const projEditor = extractDiv('devProjectEditorPanel');
const taskBrowser = extractDiv('devTaskBrowserPanel');
const taskEditorWrap = extractDiv('devTaskEditorFormWrapper'); // Extracting wrapper because taskEditorPanel wraps it
const taskEditorPanel = extractDiv('devTaskEditorPanel');
const teamBrowser = extractDiv('devTeamBrowserPanel');
const teamEditor = extractDiv('devTeamEditorPanel');
const rolesBrowser = extractDiv('devRolesBrowserPanel');
const rolesEditor = extractDiv('devRoleEditorPanel');
const frictionEditor = extractDiv('devFrictionEditorPanel');

const pageHeadingRowMatch = devAgentPage.html.match(/<div class="page-heading-row"[\s\S]*?<\/div>\s*<\/div>/);
const pageHeadingRowHtml = pageHeadingRowMatch ? pageHeadingRowMatch[0] : '';

// devForumPage will keep the sidebar for sessions but ONLY the sessions list, maybe?
// Actually, let's keep the devForumPage similar to what we have but remove the other accordions from the sidebar.
let devForumHtml = `
      <section id="devForumPage" class="app-page hidden">
        ${pageHeadingRowHtml}
        <div class="dev-chat-container">
          <aside class="dev-sessions-sidebar">
            <div class="accordion-header">
              <a href="javascript:void(0);" class="accordion-title" data-nav="forum">Forum Sessions</a>
            </div>
            <ul id="devSessionList" class="dev-session-list">
              <!-- Dynamically populated -->
            </ul>
          </aside>
          <div class="dev-chat-main-panel">
            <div id="devChatMainHeader" class="dev-chat-main-header" style="justify-content: space-between;">
              <div style="display:flex; align-items:center; gap:0.5rem; flex:1;">
                <h3 id="devActiveSessionTitle">Loading Session...</h3>
              </div>
            </div>
            <div id="devChatLog" class="dev-chat-log dev-collapsed-mode"></div>
            <div id="devPersistentOverlay" class="dev-persistent-overlay hidden"></div>
            <form id="devChatForm" class="dev-chat-input-area">
              <div id="devChatAttachmentsContainer" style="display:flex; flex-direction:column; gap:4px; margin-bottom:8px; align-self:flex-start;">
              </div>
              <div class="dev-chat-input-row" style="display: flex; gap: 8px; width: 100%;">
                <button type="button" id="devFileTriggerBtn" class="secondary-btn" title="Attach file" aria-label="Attach file">📎</button>
                <input type="file" id="devChatFile" class="hidden" accept=".md,.txt,.csv,.json,text/markdown,text/plain,image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.zip" />
                <textarea id="devChatInput" placeholder="Message Dev Agent..."></textarea>
                <button type="submit" class="primary-btn">Send</button>
              </div>
            </form>
          </div>
        </div>
      </section>`;

// Strip out inline styles from the panels so they become proper pages
function cleanPanelAsPage(htmlStr, id, title) {
    if (!htmlStr) return '';
    // remove the id, class, inline style of the outer div
    // We will just replace it with <section id="..." class="app-page hidden">
    const innerContent = htmlStr.replace(/^<div id="[^"]+" class="hidden" style="[^"]+">/, '').replace(/<\/div>$/, '');
    return `      <section id="${id}" class="app-page hidden">
        <div class="page-heading-row">
          <h2>${title}</h2>
        </div>
        ${innerContent}
      </section>`;
}

const devProjectsPage = `      <section id="devProjectsPage" class="app-page hidden">
        <div class="page-heading-row">
          <h2>Projects</h2>
        </div>
        ${projBrowser ? projBrowser.html : ''}
        ${projEditor ? projEditor.html : ''}
      </section>`;

const devTasksPage = `      <section id="devTasksPage" class="app-page hidden">
        <div class="page-heading-row">
          <h2>Tasks</h2>
        </div>
        ${taskBrowser ? taskBrowser.html : ''}
        ${taskEditorPanel ? taskEditorPanel.html : ''}
      </section>`;

const devTeamPage = `      <section id="devTeamPage" class="app-page hidden">
        <div class="page-heading-row">
          <h2>Team</h2>
        </div>
        ${teamBrowser ? teamBrowser.html : ''}
        ${teamEditor ? teamEditor.html : ''}
      </section>`;

const devRolesPage = `      <section id="devRolesPage" class="app-page hidden">
        <div class="page-heading-row">
          <h2>Roles</h2>
        </div>
        ${rolesBrowser ? rolesBrowser.html : ''}
        ${rolesEditor ? rolesEditor.html : ''}
      </section>`;

const devFrictionSidebar = extractDiv('devFrictionSidebar');
let frictionBrowserHtml = '';
if (devFrictionSidebar) {
   // Extract the friction list from the sidebar to put into the page
   const ulMatch = devFrictionSidebar.html.match(/<ul id="devFrictionList"[\s\S]*?<\/ul>/);
   const formMatch = devFrictionSidebar.html.match(/<form id="devFrictionForm"[\s\S]*?<\/form>/);
   frictionBrowserHtml = `
        <div style="display:grid; grid-template-columns: 350px 1fr; gap: 2rem;">
            <div>
               <h3>Log Friction</h3>
               ${formMatch ? formMatch[0] : ''}
            </div>
            <div>
               <h3>Friction Logs</h3>
               ${ulMatch ? ulMatch[0] : ''}
            </div>
        </div>
   `;
}

const devFrictionPage = `      <section id="devFrictionPage" class="app-page hidden">
        <div class="page-heading-row">
          <h2>Friction Logs</h2>
        </div>
        ${frictionBrowserHtml}
        ${frictionEditor ? frictionEditor.html : ''}
      </section>`;

const newSections = [
    devProjectsPage,
    devTasksPage,
    devForumPage = devForumHtml,
    devTeamPage,
    devRolesPage,
    devFrictionPage
].join('\n');

html = html.substring(0, devAgentPage.start) + newSections + html.substring(devAgentPage.end);

fs.writeFileSync('public/index.html.new', html);
console.log("Wrote to index.html.new");
