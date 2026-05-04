const fs = require('fs');
const execSync = require('child_process').execSync;

let html = fs.readFileSync('public/index.html', 'utf8');

function extractPanel(htmlStr, startPattern, endPattern) {
    const startIdx = htmlStr.indexOf(startPattern);
    if (startIdx === -1) return '';
    const endIdx = htmlStr.indexOf(endPattern, startIdx);
    if (endIdx === -1) return '';
    return htmlStr.substring(startIdx, endIdx + endPattern.length);
}

// 1. Get HEAD html
const headHtml = execSync('git show HEAD:public/index.html').toString();

// Extract from HEAD using the exact patterns that worked before
let taskBrowserPanel = extractPanel(headHtml, '<div id="devTaskBrowserPanel"', '</div>\n            </div>');
let taskEditorPanel = extractPanel(headHtml, '<div id="devTaskEditorPanel"', '</form>\n            </div>');
let frictionEditorPanel = extractPanel(headHtml, '<div id="devFrictionEditorPanel"', '</form>\n            </div>');
let frictionSidebar = extractPanel(headHtml, '<aside class="dev-friction-sidebar"', '</aside>');

console.log('Extraction success:', {
  taskBrowser: !!taskBrowserPanel,
  taskEditor: !!taskEditorPanel,
  frictionEditor: !!frictionEditorPanel,
  frictionSidebar: !!frictionSidebar
});

// 2. Get scratch HTML
const scratchCode = fs.readFileSync('scratch/refactor_dev_html.js', 'utf8');
function extractVarFromScratch(varName) {
    const startStr = `const ${varName} = \``;
    const startIdx = scratchCode.indexOf(startStr);
    if (startIdx === -1) return null;
    const endIdx = scratchCode.indexOf('`;', startIdx);
    return scratchCode.substring(startIdx + startStr.length, endIdx);
}

const projPageHTML = extractVarFromScratch('devProjectsPage');
const teamPageHTML = extractVarFromScratch('devTeamPage');
const rolesPageHTML = extractVarFromScratch('devRolesPage');

// 3. Inject taskBrowserPanel and taskEditorPanel into devTasksPage BEFORE kanban
if (taskBrowserPanel && taskEditorPanel) {
    taskBrowserPanel = taskBrowserPanel.replace('class="hidden"', 'class=""');
    // Important: Add a div wrap to make sure they display as expected
    const injection = taskBrowserPanel + '\n        ' + taskEditorPanel + '\n        <div id="devDashboardKanban"';
    if (html.includes('<div id="devDashboardKanban"')) {
       html = html.replace('<div id="devDashboardKanban"', injection);
       console.log('Injected Tasks panels');
    } else {
       console.log('Failed to find Kanban in devTasksPage to inject before.');
    }
} else {
    console.log('Failed to extract Tasks panels from HEAD');
}

// 4. Inject Projects, Team, Roles (by replacing their empty <section> completely)
function replaceSection(id, newHtml) {
    const startStr = `<section id="${id}"`;
    const startIdx = html.indexOf(startStr);
    if (startIdx === -1) return false;
    let count = 0;
    let inQuotes = false;
    let i = startIdx;
    let endIdx = -1;
    while (i < html.length) {
        if (html[i] === '"') inQuotes = !inQuotes;
        if (!inQuotes) {
            if (html.substr(i, 8) === '<section') { count++; }
            if (html.substr(i, 9) === '</section') { count--; }
        }
        if (count === 0 && html.substr(i, 10) === '</section>') {
            endIdx = i + 10;
            break;
        }
        i++;
    }
    if (endIdx !== -1) {
        html = html.substring(0, startIdx) + newHtml + html.substring(endIdx);
        return true;
    }
    return false;
}

if (projPageHTML) {
    if (replaceSection('devProjectsPage', projPageHTML)) console.log('Replaced devProjectsPage');
}
if (teamPageHTML) {
    if (replaceSection('devTeamPage', teamPageHTML)) console.log('Replaced devTeamPage');
}
if (rolesPageHTML) {
    if (replaceSection('devRolesPage', rolesPageHTML)) console.log('Replaced devRolesPage');
}

// 5. Build Friction page using the extracted components
if (frictionEditorPanel && frictionSidebar) {
    frictionEditorPanel = frictionEditorPanel.replace('class="hidden"', 'class=""');
    const newFrictionPage = `      <section id="devFrictionPage" class="app-page hidden">
        <div class="page-heading-row">
          <h2>Friction Logs</h2>
          <button id="devNewFrictionBtn" class="primary-btn" onclick="App.devAgent.openFrictionEditor()">+ New Log</button>
        </div>
        <div style="display: flex; flex-direction: row; gap: 2rem; padding: 2rem; height: calc(100vh - 120px); align-items: flex-start;">
          <div style="flex: 1; min-width: 0;">
            ${frictionEditorPanel}
          </div>
          <div style="width: 400px; flex-shrink: 0; position: static; height: 100%;">
            ${frictionSidebar}
          </div>
        </div>
      </section>`;
    if (replaceSection('devFrictionPage', newFrictionPage)) console.log('Replaced devFrictionPage');
}

fs.writeFileSync('public/index.html', html);
console.log('Done restoring missing panels.');
