const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

const sidebarRegex = /<aside class="dev-sessions-sidebar">[\s\S]*?<\/aside>/;
const sidebarMatch = html.match(sidebarRegex);
if (!sidebarMatch) {
  console.error("Could not find sidebar");
  process.exit(1);
}
const sidebarHTML = sidebarMatch[0];

html = html.replace(sidebarRegex, '');

const dashboardRegex = /<section id="devDashboardPage" class="app-page hidden">[\s\S]*?<\/section>/;
const dashboardMatch = html.match(dashboardRegex);
if (!dashboardMatch) {
  console.error("Could not find dashboard");
  process.exit(1);
}

const newDashboardHTML = `<section id="devDashboardPage" class="app-page hidden">
        <div class="page-heading-row">
          <h2>Dev Dashboard</h2>
        </div>
        <div style="display: flex; height: calc(100vh - 200px); min-height: 400px; overflow: hidden; margin-top: 1rem;">
          ${sidebarHTML.replace('padding-right: 20px;', 'padding-right: 20px; height: 100%; border-right: 1px solid #c0c0c0; border-radius: 8px;')}
          <div style="flex: 1; padding: 2rem; display: flex; align-items: center; justify-content: center; color: #888;">
            <p>Dashboard main content area.</p>
          </div>
        </div>
      </section>`;

html = html.replace(dashboardRegex, newDashboardHTML);

html = html.replace(
  '<div class="dev-chat-container">',
  '<div class="dev-chat-container" style="grid-template-columns: 1fr 1fr;">'
);

// We need to add the right column to dev-chat-container
// Before: <div class="dev-chat-main-panel">...</div></div>
// After: <div class="dev-chat-main-panel">...</div><div id="devAllMessagesPanel">...</div></div>

const mainPanelRegex = /(<div class="dev-chat-main-panel">[\s\S]*?<\/aside>\n\s*<\/div>)/;
const mainPanelMatch = html.match(mainPanelRegex);
if (!mainPanelMatch) {
  console.error("Could not find dev-chat-main-panel");
  process.exit(1);
}

const newRightColumnHTML = `
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
                    <th style="text-align: left;">Message</th>
                  </tr>
                </thead>
                <tbody id="devAllMessagesTable"></tbody>
              </table>
            </div>
          </div>
`;

html = html.replace(mainPanelRegex, `$1${newRightColumnHTML}`);

fs.writeFileSync('public/index.html', html, 'utf8');
console.log("HTML updated.");
