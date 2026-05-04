const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// --- 1. Fix devForumPage ---
// Currently devForumPage has:
// <div class="dev-chat-container" style="grid-template-columns: 1fr 1fr;">
//   <div class="dev-chat-main-panel">...</div>
//   <div style="width: 400px; flex-shrink: 0; position: static; height: 100%;">
//     <aside class="dev-friction-sidebar" id="devFrictionSidebar">...</aside>
//   </div>
//   <div id="devAllMessagesPanel" ...>...</div>
// </div>

const chatContainerStartRegex = /<div class="dev-chat-container" style="grid-template-columns: 1fr 1fr;">/;
const chatMainPanelRegex = /<div class="dev-chat-main-panel">/;

if (html.match(chatContainerStartRegex)) {
  html = html.replace(chatMainPanelRegex, '<div style="display: flex; flex-direction: row; min-width: 0; flex: 1; overflow: hidden;">\n          <div class="dev-chat-main-panel">');
  
  // We need to close this wrapper div just before devAllMessagesPanel
  const allMessagesPanelRegex = /<div id="devAllMessagesPanel"/;
  html = html.replace(allMessagesPanelRegex, '</div>\n          <div id="devAllMessagesPanel"');
}

// --- 2. Redesign devDashboardPage ---
// Currently it is:
// <section id="devDashboardPage" class="app-page hidden">
//   <div class="page-heading-row">
//     <h2>Dev Dashboard</h2>
//   </div>
//   <div style="display: flex; height: calc(100vh - 200px); min-height: 400px; overflow: hidden; margin-top: 1rem;">
//     <aside class="dev-sessions-sidebar" style="...padding-right: 20px; height: 100%; border-right: 1px solid #c0c0c0; border-radius: 8px;">
//        ... accordion headers and dev-session-lists ...
//     </aside>
//     <div style="flex: 1; padding: 2rem; display: flex; align-items: center; justify-content: center; color: #888;">
//       <p>Dashboard main content area.</p>
//     </div>
//   </div>
// </section>

// Let's completely replace the dashboard content block
const dashboardRegex = /<section id="devDashboardPage" class="app-page hidden">[\s\S]*?<\/section>/;

const newDashboardHTML = `<section id="devDashboardPage" class="app-page hidden">
        <div class="page-heading-row">
          <h2>Dev Dashboard</h2>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 2rem; height: calc(100vh - 180px); min-height: 600px; margin-top: 1.5rem;">
          
          <!-- Column 1: Action Items -->
          <div style="background: var(--bg-card); border-radius: 8px; padding: 1.5rem; display: flex; flex-direction: column; grid-row: span 2; border: 1px solid var(--border-light); overflow-y: hidden;">
            <h3 style="margin-top: 0; border-bottom: 1px solid var(--border-light); padding-bottom: 0.5rem; color: var(--text-primary);">Action Items</h3>
            <ul id="devActionItemsList" class="dev-session-list" style="flex: 1; overflow-y: auto; list-style: none; padding-left: 0; margin-top: 0.5rem;">
              <li class="dev-session-item" style="color: #666; font-style: italic;">No pending actions.</li>
            </ul>
          </div>

          <!-- Column 2, Row 1: Tasks -->
          <div style="background: var(--bg-card); border-radius: 8px; padding: 1.5rem; display: flex; flex-direction: column; border: 1px solid var(--border-light); overflow-y: hidden;">
            <h3 style="margin-top: 0; border-bottom: 1px solid var(--border-light); padding-bottom: 0.5rem; color: var(--text-primary);">Tasks</h3>
            <ul id="devTaskList" class="dev-session-list" style="flex: 1; overflow-y: auto; list-style: none; padding-left: 0; margin-top: 0.5rem;">
              <li class="dev-session-item" style="color: #666; font-style: italic;">No active tasks.</li>
            </ul>
          </div>

          <!-- Column 2, Row 2: Forum (Sessions) -->
          <div style="background: var(--bg-card); border-radius: 8px; padding: 1.5rem; display: flex; flex-direction: column; border: 1px solid var(--border-light); overflow-y: hidden;">
            <h3 style="margin-top: 0; border-bottom: 1px solid var(--border-light); padding-bottom: 0.5rem; color: var(--text-primary);">Forum</h3>
            <ul id="devSessionList" class="dev-session-list" style="flex: 1; overflow-y: auto; list-style: none; padding-left: 0; margin-top: 0.5rem;">
              <!-- Dynamically populated -->
            </ul>
          </div>

          <!-- Column 3, Row 1: Team -->
          <div style="background: var(--bg-card); border-radius: 8px; padding: 1.5rem; display: flex; flex-direction: column; border: 1px solid var(--border-light); overflow-y: hidden;">
            <h3 style="margin-top: 0; border-bottom: 1px solid var(--border-light); padding-bottom: 0.5rem; color: var(--text-primary);">Team</h3>
            <ul id="devTeamList" class="dev-session-list" style="flex: 1; overflow-y: auto; list-style: none; padding-left: 0; margin-top: 0.5rem;">
              <li class="dev-session-item" style="color: #666; font-style: italic;">No team members.</li>
            </ul>
          </div>

          <!-- Column 3, Row 2: Friction Log -->
          <div style="background: var(--bg-card); border-radius: 8px; padding: 1.5rem; display: flex; flex-direction: column; border: 1px solid var(--border-light); overflow-y: hidden;">
            <h3 style="margin-top: 0; border-bottom: 1px solid var(--border-light); padding-bottom: 0.5rem; color: var(--text-primary);">Friction Log</h3>
            <ul id="devFrictionSidebarList" class="dev-session-list" style="flex: 1; overflow-y: auto; list-style: none; padding-left: 0; margin-top: 0.5rem;">
              <!-- Dynamically populated -->
            </ul>
          </div>

        </div>
      </section>`;

html = html.replace(dashboardRegex, newDashboardHTML);

fs.writeFileSync('public/index.html', html, 'utf8');
console.log("Updated public/index.html");

