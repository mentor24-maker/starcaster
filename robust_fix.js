const fs = require('fs');

// We start from the clean 0b29f47 index.html
require('child_process').execSync('git checkout HEAD public/index.html');
let lines = fs.readFileSync('public/index.html', 'utf8').split('\n');

let newLines = [];
let i = 0;

// 1. Kanban Injection Setup
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
        </div>`;

// 2. Dashboard Pods Injection Setup
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

let inYoutubeMinerCollapsible = false;

while (i < lines.length) {
  let line = lines[i];

  // Inject Kanban Toggle Button
  if (line.includes('<button id="devTasksNewTaskBtn"')) {
    line = line.replace(
      '<button id="devTasksNewTaskBtn" class="primary-btn" onclick="App.devAgent.openTaskEditor()">+ New Task</button>',
      '<div style="display:flex; gap:0.5rem;"><button id="devTasksToggleViewBtn" class="secondary-btn" onclick="App.devAgent.toggleTasksView()">Kanban View</button><button id="devTasksNewTaskBtn" class="primary-btn" onclick="App.devAgent.openTaskEditor()">+ New Task</button></div>'
    );
  }

  // Inject Kanban Board
  if (line.includes('<div id="devTaskEditorPanel"')) {
    newLines.push(kanbanHTML);
  }

  // Inject Dashboard (if devDashboardPage exists)
  if (line.includes('<section id="devDashboardPage"')) {
    // Skip old devDashboardPage
    while (!lines[i].includes('</section>') || !lines[i].trim().startsWith('</section>')) {
        i++;
    }
    // We are at </section> of devDashboardPage
    newLines.push(newDashboardHTML);
    i++;
    continue;
  }

  // YouTube Accordions Rewrite
  if (line.includes('<section class="youtube-miner-collapsible')) {
    // We found a wrapper. Skip this wrapper opening line.
    inYoutubeMinerCollapsible = true;
    i++;
    continue;
  }

  if (inYoutubeMinerCollapsible && line.includes('class="youtube-miner-collapsible-toggle"')) {
    // Rewrite the toggle button to accordion-header
    let targetId = line.match(/data-target-id="([^"]+)"/)[1];
    let title = "Accordion";
    if (targetId === "youtubeResearchBody") title = "Research";
    if (targetId === "youtubeMinerRepositoryBody") title = "Target";
    if (targetId === "youtubeMinerContentBody") title = "Extract";
    
    newLines.push(\`          <button type="button" class="accordion-header" data-target-id="\${targetId}" aria-expanded="true">\`);
    newLines.push(\`            <span class="accordion-title">\${title}</span>\`);
    newLines.push(\`            <span class="accordion-toggle"><span class="accordion-arrow" aria-hidden="true">▾</span></span>\`);
    newLines.push(\`          </button>\`);
    
    // Skip the inner <span> lines until we reach </button>
    while (!lines[i].includes('</button>')) {
      i++;
    }
    i++; // Skip </button>
    continue;
  }

  if (inYoutubeMinerCollapsible && line.includes('class="youtube-miner-collapsible-body"')) {
    // Replace the opening div with just the ID
    let targetId = line.match(/id="([^"]+)"/)[1];
    newLines.push(\`          <div id="\${targetId}">\`);
    i++;
    continue;
  }

  if (inYoutubeMinerCollapsible && line.trim() === '</section>') {
    // This is the closing tag of youtube-miner-collapsible.
    // Since we didn't output the <section>, we must output </div> to close the body div!
    newLines.push('          </div>');
    inYoutubeMinerCollapsible = false;
    i++;
    continue;
  }

  newLines.push(line);
  i++;
}

fs.writeFileSync('public/index.html', newLines.join('\n'), 'utf8');
console.log('Robust fix applied.');
