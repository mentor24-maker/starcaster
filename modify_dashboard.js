const fs = require('fs');

let html = fs.readFileSync('public/index.html', 'utf8');

// 1. Remove grid-row: span 2 from action items
html = html.replace(
  'display: flex; flex-direction: column; grid-row: span 2; border: 2px solid #bae6fd;',
  'display: flex; flex-direction: column; border: 2px solid #bae6fd;'
);

// 2. Add the Git Status pod HTML before the end of the dashboard grid
const gitPodHTML = `
          <div style="background: #e8f5e9; border-radius: 40px; padding: 2rem; display: flex; flex-direction: column; border: 2px solid #c8e6c9; overflow-y: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05);">
            <h3 style="margin-top: 0; border-bottom: 1px solid var(--border-light); padding-bottom: 0.5rem; color: var(--text-primary); display: flex; justify-content: space-between; align-items: center;">
              Git Status
              <button id="devRefreshGitBtn" class="secondary-btn tiny-btn" onclick="App.devAgent.loadGitStatus()" style="padding: 0.1rem 0.5rem; font-size: 0.7rem;">Refresh</button>
            </h3>
            <div id="devGitStatusContainer" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.5rem; font-size: 0.9rem;">
              <div style="color: #666; font-style: italic;">Loading git metrics...</div>
            </div>
          </div>
`;

// Find where devFrictionSidebarList pod ends
const searchStr = '<ul id="devFrictionSidebarList" class="dev-session-list" style="flex: 1; overflow-y: auto; list-style: none; padding-left: 0; margin-top: 0.5rem;">\n            </ul>\n          </div>';
if (html.includes(searchStr)) {
  html = html.replace(searchStr, searchStr + '\n' + gitPodHTML);
  fs.writeFileSync('public/index.html', html, 'utf8');
  console.log('Successfully injected Git Status pod HTML.');
} else {
  console.log('Failed to find insertion point.');
}

