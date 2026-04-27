const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// --- 1. Swap Buttons on Forum Page ---
const copySaveIcons = `
            <button id="devCopySessionBtn" class="dev-header-icon" title="Copy Entire Discussion">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
              </svg>
            </button>
            <button id="devSaveSessionBtn" class="dev-header-icon" title="Save Entire Discussion as .md">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                <polyline points="7 3 7 8 15 8"></polyline>
              </svg>
            </button>`;

const blackButtons = `
                <button id="devTestBtn" class="secondary-btn tiny-btn hidden" style="padding:0.2rem 0.6rem; font-size: 0.75rem;">Test Connection</button>
                <button id="devNewSessionBtn" class="primary-btn" style="white-space:nowrap;">+ New Thread</button>
                <button id="devNewTaskBtn" class="primary-btn" style="white-space:nowrap;">+ New Task</button>
                <button id="devFrictionToggleBtn" class="primary-btn" style="white-space:nowrap;">Friction</button>`;

// Replace in heading row
html = html.replace(copySaveIcons, blackButtons);
// Replace in chat header
html = html.replace(blackButtons, copySaveIcons);

// --- 2. Remove Sidebar from devForumPage & Setup 2 Columns ---
const forumContainerRegex = /<div class="dev-chat-container">/;
html = html.replace(forumContainerRegex, '<div class="dev-chat-container" style="display: flex; flex-direction: row; gap: 0;">');

// Find and extract dev-sessions-sidebar
const sidebarRegex = /<aside class="dev-sessions-sidebar">[\s\S]*?<\/aside>/;
html = html.replace(sidebarRegex, ''); // Remove it from Forum Page

// Now add devAllMessagesPanel right after dev-chat-main-panel
const mainPanelEndRegex = /<\/form>\n            <\/div>\n            \n            \n\n            \n            \n            \n            \n          <\/div>/;

const allMessagesPanel = `
          </div>
          <div id="devAllMessagesPanel" style="flex: 1; display: flex; flex-direction: column; background: var(--bg-card); border-left: 1px solid var(--border-light); overflow-y: hidden;">
            <div style="padding: 1rem; border-bottom: 1px solid var(--border-light); display: flex; justify-content: space-between; align-items: center;">
              <h3 style="margin: 0; font-size: 1.1rem;">System Messages</h3>
              <input type="text" id="devAllMessagesFilter" placeholder="Filter messages..." oninput="App.devAgent.filterAllMessages()" style="padding: 0.4rem; border-radius: 4px; border: 1px solid #888; background: var(--bg-input); color: var(--text-primary); width: 250px;" />
            </div>
            <div class="table-wrap" style="flex: 1; overflow-y: auto; padding: 0;">
              <table class="data-table" style="width: 100%; font-size: 0.85rem; border-collapse: collapse;">
                <thead style="position: sticky; top: 0; background: var(--bg-card); z-index: 10;">
                  <tr>
                    <th style="cursor: pointer;" onclick="App.devAgent.sortAllMessages('created_at')">Date/Time</th>
                    <th style="cursor: pointer;" onclick="App.devAgent.sortAllMessages('task_title')">Task Title</th>
                    <th style="cursor: pointer;" onclick="App.devAgent.sortAllMessages('sender')">Sender</th>
                    <th style="cursor: pointer;" onclick="App.devAgent.sortAllMessages('receiver')">Receiver</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody id="devAllMessagesTableBody">
                  <tr><td colspan="5" style="text-align: center; color: #666; font-style: italic;">Loading messages...</td></tr>
                </tbody>
              </table>
            </div>
          </div>`;

html = html.replace(mainPanelEndRegex, `</form>\n            </div>\n          </div>${allMessagesPanel}`);

// --- 3. Dashboard Redesign ---
// Extract devDashboardKanban
const kanbanRegex = /<div id="devDashboardKanban" class="kanban-board">[\s\S]*?<\/div>\n        <\/div>/;
const kanbanMatch = html.match(kanbanRegex);
const kanbanHTML = kanbanMatch ? kanbanMatch[0] : '';
html = html.replace(kanbanRegex, ''); // Remove kanban from dashboard

const newDashboardHTML = `<section id="devDashboardPage" class="app-page hidden">
        <div class="page-heading-row">
          <h2>Dev Dashboard</h2>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 2rem; height: calc(100vh - 180px); min-height: 600px; margin-top: 1.5rem;">
          
          <div style="background: #e0f2fe; border-radius: 40px; padding: 2rem; display: flex; flex-direction: column; grid-row: span 2; border: 2px solid #bae6fd; overflow-y: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
            <h3 style="margin-top: 0; border-bottom: 1px solid var(--border-light); padding-bottom: 0.5rem; color: var(--text-primary);">Action Items</h3>
            <ul id="devActionItemsList" class="dev-session-list" style="flex: 1; overflow-y: auto; list-style: none; padding-left: 0; margin-top: 0.5rem;">
              <li class="dev-session-item" style="color: #666; font-style: italic;">No pending actions.</li>
            </ul>
          </div>

          <div style="background: #e1f5fe; border-radius: 40px; padding: 2rem; display: flex; flex-direction: column; border: 2px solid #b3e5fc; overflow-y: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
            <h3 style="margin-top: 0; border-bottom: 1px solid var(--border-light); padding-bottom: 0.5rem; color: var(--text-primary);">Tasks</h3>
            <ul id="devTaskList" class="dev-session-list" style="flex: 1; overflow-y: auto; list-style: none; padding-left: 0; margin-top: 0.5rem;">
              <li class="dev-session-item" style="color: #666; font-style: italic;">No active tasks.</li>
            </ul>
          </div>

          <div style="background: #e0f7fa; border-radius: 40px; padding: 2rem; display: flex; flex-direction: column; border: 2px solid #b2ebf2; overflow-y: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
            <h3 style="margin-top: 0; border-bottom: 1px solid var(--border-light); padding-bottom: 0.5rem; color: var(--text-primary);">Forum</h3>
            <ul id="devSessionList" class="dev-session-list" style="flex: 1; overflow-y: auto; list-style: none; padding-left: 0; margin-top: 0.5rem;">
            </ul>
          </div>

          <div style="background: #e8eaf6; border-radius: 40px; padding: 2rem; display: flex; flex-direction: column; border: 2px solid #c5cae9; overflow-y: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
            <h3 style="margin-top: 0; border-bottom: 1px solid var(--border-light); padding-bottom: 0.5rem; color: var(--text-primary);">Team</h3>
            <ul id="devTeamList" class="dev-session-list" style="flex: 1; overflow-y: auto; list-style: none; padding-left: 0; margin-top: 0.5rem;">
              <li class="dev-session-item" style="color: #666; font-style: italic;">No team members.</li>
            </ul>
          </div>

          <div style="background: #e3f2fd; border-radius: 40px; padding: 2rem; display: flex; flex-direction: column; border: 2px solid #bbdefb; overflow-y: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
            <h3 style="margin-top: 0; border-bottom: 1px solid var(--border-light); padding-bottom: 0.5rem; color: var(--text-primary);">Friction Log</h3>
            <ul id="devFrictionSidebarList" class="dev-session-list" style="flex: 1; overflow-y: auto; list-style: none; padding-left: 0; margin-top: 0.5rem;">
            </ul>
          </div>

        </div>
      </section>`;

const dashboardPageRegex = /<section id="devDashboardPage" class="app-page hidden">[\s\S]*?<\/section>/;
html = html.replace(dashboardPageRegex, newDashboardHTML);

// --- 4. Tasks Page Kanban ---
html = html.replace(
  '<button id="devTasksNewTaskBtn" class="primary-btn" onclick="App.devAgent.openTaskEditor()">+ New Task</button>',
  '<div style="display:flex; gap:0.5rem;"><button id="devTasksToggleViewBtn" class="secondary-btn" onclick="App.devAgent.toggleTasksView()">Kanban View</button><button id="devTasksNewTaskBtn" class="primary-btn" onclick="App.devAgent.openTaskEditor()">+ New Task</button></div>'
);

const injectedKanban = kanbanHTML.replace('class="kanban-board"', 'class="kanban-board hidden" style="width: 100%; height: 100%; padding: 2rem; background: var(--bg-card); overflow-x: auto; display: none;"');
html = html.replace('<div id="devTaskEditorPanel"', injectedKanban + '\n        <div id="devTaskEditorPanel"');

fs.writeFileSync('public/index.html', html, 'utf8');
console.log("Re-applied all HTML layout fixes correctly!");
