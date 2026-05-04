const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// 1. Add toggle button
html = html.replace(
  '<button id="devTasksNewTaskBtn" class="primary-btn" onclick="App.devAgent.openTaskEditor()">+ New Task</button>',
  '<div style="display:flex; gap:0.5rem;"><button id="devTasksToggleViewBtn" class="secondary-btn" onclick="App.devAgent.toggleTasksView()">Kanban View</button><button id="devTasksNewTaskBtn" class="primary-btn" onclick="App.devAgent.openTaskEditor()">+ New Task</button></div>'
);

// 2. Add the Kanban HTML right after the devTaskBrowserPanel
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

// Find where devTaskBrowserPanel ends. Actually, it's safer to just inject it right before devTaskEditorPanel
html = html.replace(
  '<div id="devTaskEditorPanel"',
  kanbanHTML + '\n        <div id="devTaskEditorPanel"'
);

fs.writeFileSync('public/index.html', html, 'utf8');

// 3. Update public/js/devAgent.js with the toggle logic
let js = fs.readFileSync('public/js/devAgent.js', 'utf8');

const toggleCode = `
App.devAgent.currentTasksView = 'list';

App.devAgent.toggleTasksView = function() {
  const browser = document.getElementById('devTaskBrowserPanel');
  const kanban = document.getElementById('devDashboardKanban');
  const btn = document.getElementById('devTasksToggleViewBtn');
  const editor = document.getElementById('devTaskEditorPanel');
  
  if (editor && !editor.classList.contains('hidden')) {
    editor.classList.add('hidden');
  }

  if (App.devAgent.currentTasksView === 'list') {
    App.devAgent.currentTasksView = 'kanban';
    if(browser) {
      browser.classList.add('hidden');
      browser.style.display = 'none';
    }
    if(kanban) {
      kanban.classList.remove('hidden');
      kanban.style.display = 'flex';
    }
    if(btn) btn.innerText = 'List View';
    App.devAgent.loadDashboard(); // Refreshes Kanban items
  } else {
    App.devAgent.currentTasksView = 'list';
    if(kanban) {
      kanban.classList.add('hidden');
      kanban.style.display = 'none';
    }
    if(browser) {
      browser.classList.remove('hidden');
      browser.style.display = 'flex';
    }
    if(btn) btn.innerText = 'Kanban View';
    App.devAgent.loadTasksTable();
  }
};

// Also ensure showTaskBrowser resets appropriately
const oldShowTaskBrowser = App.devAgent.showTaskBrowser;
App.devAgent.showTaskBrowser = function() {
  const btn = document.getElementById('devTasksToggleViewBtn');
  const kanban = document.getElementById('devDashboardKanban');
  if (kanban && !kanban.classList.contains('hidden')) {
    // If we're coming out of the editor back to the browser, preserve kanban view if it was active
    const editor = document.getElementById('devTaskEditorPanel');
    if (editor) editor.classList.add('hidden');
    return;
  }
  
  if (oldShowTaskBrowser) oldShowTaskBrowser.apply(this, arguments);
  if (App.devAgent.currentTasksView === 'kanban') {
     App.devAgent.currentTasksView = 'list';
     if(btn) btn.innerText = 'Kanban View';
     if(kanban) {
       kanban.classList.add('hidden');
       kanban.style.display = 'none';
     }
     const browser = document.getElementById('devTaskBrowserPanel');
     if(browser) browser.style.display = 'flex';
  }
};
`;

js = js + '\n' + toggleCode;
fs.writeFileSync('public/js/devAgent.js', js, 'utf8');

console.log("Added Kanban and toggle logic");
