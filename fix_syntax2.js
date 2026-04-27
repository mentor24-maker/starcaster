const fs = require('fs');
let code = fs.readFileSync('public/js/devAgent.js', 'utf8');

code = code.replace(
  'const devRoleEditorForm = document.getElementById(\'devRoleEditorForm\');\n});',
  'const devRoleEditorForm = document.getElementById(\'devRoleEditorForm\');\n  if (devRoleEditorForm) devRoleEditorForm.addEventListener(\'submit\', App.devAgent.saveRole);\n});'
);

// We should also get rid of somePlaceholder and just put the logic in a proper place or remove it.
// Actually, since we removed the hidden state resets from restoreChatPanel, the panels (overlay, fricPanel, taskPanel) won't hide automatically when we call restoreChatPanel anymore.
// BUT since we are redirecting to devForumPage using setActivePage, App.setActivePage HIDES everything else anyway!!
// So we don't need those manual classList.add('hidden') calls at all!

code = code.replace(/App\.devAgent\.somePlaceholder = function\(\) \{ \/\/ Added this just so the file continues cleanly[\s\S]*?const teamBrowserPanel = document\.getElementById\('devTeamBrowserPanel'\); if\(teamBrowserPanel\) teamBrowserPanel\.classList\.add\('hidden'\);/, '');

fs.writeFileSync('public/js/devAgent.js', code);
console.log("Fixed missing listener");
