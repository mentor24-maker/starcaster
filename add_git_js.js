const fs = require('fs');

const jsCode = `
App.devAgent.loadGitStatus = async function() {
  const container = document.getElementById('devGitStatusContainer');
  if (!container) return;
  
  container.innerHTML = '<div style="color: #666; font-style: italic;">Loading git metrics...</div>';
  
  try {
    const res = await fetch('/api/develop/devAgent/git-status');
    if (!res.ok) throw new Error('Network response was not ok');
    const data = await res.json();
    
    if (data.success && data.data) {
      const d = data.data;
      
      const unpushedColor = d.unpushedCommits > 0 ? '#b45309' : '#15803d'; // orange/green
      const uncommittedColor = d.uncommittedFiles > 0 ? '#dc2626' : '#15803d'; // red/green
      
      // Format dates nicely
      const formatDate = (dateStr) => {
        if (!dateStr || dateStr.includes('No origin')) return 'None';
        try {
          const dt = new Date(dateStr);
          return dt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch(e) { return dateStr; }
      };
      
      container.innerHTML = \`
        <div style="display: flex; justify-content: space-between; padding-bottom: 0.25rem; border-bottom: 1px solid rgba(0,0,0,0.05);">
          <span style="color: #555; font-weight: 500;">Branch:</span>
          <span style="font-family: monospace; background: #e2e8f0; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.8rem;">\${d.currentBranch}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding-bottom: 0.25rem; border-bottom: 1px solid rgba(0,0,0,0.05);">
          <span style="color: #555; font-weight: 500;">Last Commit:</span>
          <span style="font-size: 0.85rem;">\${formatDate(d.lastCommitDate)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding-bottom: 0.25rem; border-bottom: 1px solid rgba(0,0,0,0.05);">
          <span style="color: #555; font-weight: 500;">Last Push:</span>
          <span style="font-size: 0.85rem;">\${formatDate(d.lastPushDate)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding-bottom: 0.25rem; border-bottom: 1px solid rgba(0,0,0,0.05);">
          <span style="color: #555; font-weight: 500;">Unpushed Commits:</span>
          <span style="font-weight: bold; color: \${unpushedColor};">\${d.unpushedCommits}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding-bottom: 0.25rem; border-bottom: 1px solid rgba(0,0,0,0.05);">
          <span style="color: #555; font-weight: 500;">Uncommitted Files:</span>
          <span style="font-weight: bold; color: \${uncommittedColor};">\${d.uncommittedFiles}</span>
        </div>
      \`;
    } else {
      throw new Error(data.error || 'Unknown error');
    }
  } catch (err) {
    console.error('Failed to load git status:', err);
    container.innerHTML = \`<div style="color: #dc2626;">Failed to load metrics: \${err.message}</div>\`;
  }
};
`;

let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

// Inject the function before App.devAgent.loadActionItems
content = content.replace(
  'App.devAgent.loadActionItems = async function() {',
  jsCode + '\nApp.devAgent.loadActionItems = async function() {'
);

// Add the call to loadGitStatus in the dashboard init
content = content.replace(
  'setTimeout(() => App.devAgent.loadActionItems(), 50);',
  'setTimeout(() => App.devAgent.loadActionItems(), 50);\n        setTimeout(() => App.devAgent.loadGitStatus(), 50);'
);

// Do it for both dashboard occurrences
content = content.replace(
  'setTimeout(() => App.devAgent.loadActionItems(), 50);',
  'setTimeout(() => App.devAgent.loadActionItems(), 50);\n        setTimeout(() => App.devAgent.loadGitStatus(), 50);'
);


fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
console.log('Injected Git JS logic');
