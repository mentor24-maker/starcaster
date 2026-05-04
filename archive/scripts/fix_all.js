const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// 1. KANBAN INJECTION
if (!html.includes('devTasksToggleViewBtn')) {
  html = html.replace(
    '<button id="devTasksNewTaskBtn" class="primary-btn" onclick="App.devAgent.openTaskEditor()">+ New Task</button>',
    '<div style="display:flex; gap:0.5rem;"><button id="devTasksToggleViewBtn" class="secondary-btn" onclick="App.devAgent.toggleTasksView()">Kanban View</button><button id="devTasksNewTaskBtn" class="primary-btn" onclick="App.devAgent.openTaskEditor()">+ New Task</button></div>'
  );
}
const kanbanHTML = `
        <div id="devDashboardKanban" class="kanban-board hidden" style="width: 100%; height: 100%; padding: 2rem; background: var(--bg-card); overflow-x: auto; display: none;">
          <div class="kanban-column" id="kanbanBacklog">
            <h3 class="kanban-column-header">Backlog <span class="kanban-count" id="countBacklog">0</span></h3>
            <div class="kanban-column-body" id="colBacklog" ondragover="App.devAgent.handleDragOver(event)" ondragleave="App.devAgent.handleDragLeave(event)" ondrop="App.devAgent.handleDrop(event, 'backlog')"></div>
          </div>
          <div class="kanban-column" id="kanbanTodo">
            <h3 class="kanban-column-header">Todo <span class="kanban-count" id="countTodo">0</span></h3>
            <div class="kanban-column-body" id="colTodo" ondragover="App.devAgent.handleDragOver(event)" ondragleave="App.devAgent.handleDragLeave(event)" ondrop="App.devAgent.handleDrop(event, 'todo')"></div>
          </div>
          <div class="kanban-column" id="kanbanInProgress">
            <h3 class="kanban-column-header">In Progress <span class="kanban-count" id="countInProgress">0</span></h3>
            <div class="kanban-column-body" id="colInProgress" ondragover="App.devAgent.handleDragOver(event)" ondragleave="App.devAgent.handleDragLeave(event)" ondrop="App.devAgent.handleDrop(event, 'in_progress')"></div>
          </div>
          <div class="kanban-column" id="kanbanReview">
            <h3 class="kanban-column-header">Review <span class="kanban-count" id="countReview">0</span></h3>
            <div class="kanban-column-body" id="colReview" ondragover="App.devAgent.handleDragOver(event)" ondragleave="App.devAgent.handleDragLeave(event)" ondrop="App.devAgent.handleDrop(event, 'review')"></div>
          </div>
          <div class="kanban-column" id="kanbanCompleted">
            <h3 class="kanban-column-header">Completed <span class="kanban-count" id="countCompleted">0</span></h3>
            <div class="kanban-column-body" id="colCompleted" ondragover="App.devAgent.handleDragOver(event)" ondragleave="App.devAgent.handleDragLeave(event)" ondrop="App.devAgent.handleDrop(event, 'completed')"></div>
          </div>
        </div>
`;
if (!html.includes('devDashboardKanban')) {
  html = html.replace(
    '<div id="devTaskEditorPanel"',
    kanbanHTML + '\n        <div id="devTaskEditorPanel"'
  );
}

// 2. DASHBOARD 5 PODS
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
            <ul id="devDashboardForumList" class="dev-session-list" style="flex: 1; overflow-y: auto; list-style: none; padding-left: 0; margin-top: 0.5rem;">
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
            </ul>
          </div>

        </div>
      </section>`;
html = html.replace(dashboardRegex, newDashboardHTML);

// 3. YOUTUBE ACCORDIONS
// Replace Research
html = html.replace(
  /<section class="youtube-miner-collapsible is-open">\s*<button type="button" class="youtube-miner-collapsible-toggle" data-target-id="youtubeResearchBody" aria-expanded="true">\s*<span>Research<\/span>\s*<span class="youtube-miner-collapsible-arrow" aria-hidden="true"><\/span>\s*<\/button>\s*<div id="youtubeResearchBody" class="youtube-miner-collapsible-body">/,
  `<button type="button" class="accordion-header" data-target-id="youtubeResearchBody" aria-expanded="true">
    <span class="accordion-title">Research</span>
    <span class="accordion-toggle"><span class="accordion-arrow" aria-hidden="true">▾</span></span>
  </button>
  <div id="youtubeResearchBody">`
);

// Replace Target
html = html.replace(
  /<section class="youtube-miner-collapsible is-open">\s*<button type="button" class="youtube-miner-collapsible-toggle" data-target-id="youtubeMinerRepositoryBody" aria-expanded="true">\s*<span>Target<\/span>\s*<span class="youtube-miner-collapsible-arrow" aria-hidden="true"><\/span>\s*<\/button>\s*<div id="youtubeMinerRepositoryBody" class="youtube-miner-collapsible-body">/,
  `<button type="button" class="accordion-header" data-target-id="youtubeMinerRepositoryBody" aria-expanded="true">
    <span class="accordion-title">Target</span>
    <span class="accordion-toggle"><span class="accordion-arrow" aria-hidden="true">▾</span></span>
  </button>
  <div id="youtubeMinerRepositoryBody">`
);

// Replace Extract
html = html.replace(
  /<section class="youtube-miner-collapsible is-open">\s*<button type="button" class="youtube-miner-collapsible-toggle" data-target-id="youtubeMinerContentBody" aria-expanded="true">\s*<span>Extract<\/span>\s*<span class="youtube-miner-collapsible-arrow" aria-hidden="true"><\/span>\s*<\/button>\s*<div id="youtubeMinerContentBody" class="youtube-miner-collapsible-body">/,
  `<button type="button" class="accordion-header" data-target-id="youtubeMinerContentBody" aria-expanded="true">
    <span class="accordion-title">Extract</span>
    <span class="accordion-toggle"><span class="accordion-arrow" aria-hidden="true">▾</span></span>
  </button>
  <div id="youtubeMinerContentBody">`
);

// Now carefully remove the trailing </section> for each of these 3 bodies
// We find where the body ends (</div>\n          </section>) and remove the </section>
html = html.replace(
  /<\/div>\s*<\/section>\s*<button type="button" class="accordion-header" data-target-id="youtubeMinerRepositoryBody"/,
  `</div>\n\n          <button type="button" class="accordion-header" data-target-id="youtubeMinerRepositoryBody"`
);

html = html.replace(
  /<\/div>\s*<\/section>\s*<button type="button" class="accordion-header" data-target-id="youtubeMinerContentBody"/,
  `</div>\n\n          <button type="button" class="accordion-header" data-target-id="youtubeMinerContentBody"`
);

html = html.replace(
  /<\/tbody>\s*<\/table>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/section>\s*<\/section>/,
  `</tbody>\n                </table>\n              </div>\n            </div>\n          </div>\n        </section>`
);

fs.writeFileSync('public/index.html', html, 'utf8');
console.log('fix_all complete');
