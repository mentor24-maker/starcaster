const fs = require('fs');
let code = fs.readFileSync('public/js/devAgent.js', 'utf8');

const target = `  const teamEditorPanel = document.getElementById('devTeamEditorPanel'); if(teamEditorPanel) teamEditorPanel.classList.add('hidden');
  const rolesBrowserPanel = document.getElementById('devRolesBrowserPanel'); if(rolesBrowserPanel) rolesBrowserPanel.classList.add('hidden');
  const roleEditorPanel = document.getElementById('devRoleEditorPanel'); if(roleEditorPanel) roleEditorPanel.classList.add('hidden');
};`;

code = code.replace(target, '');
fs.writeFileSync('public/js/devAgent.js', code);
console.log("Cleaned stray lines");
