const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

const oldStr = `App.devAgent.closeTaskEditor = function() {
  const viewProjBtn = document.getElementById('devTasksViewProjectBtn'); if(viewProjBtn) viewProjBtn.classList.add('hidden');
  const p = document.getElementById('devTaskEditorPanel'); p.classList.add('hidden'); p.style.display = '';
  if (devState.returnToProjectEditorId) {
    const projectId = devState.returnToProjectEditorId;
    devState.returnToProjectEditorId = null;
    App.devAgent.openProjectEditor(projectId);
    return;
  }
  App.devAgent.restoreChatPanel();
};`;

const newStr = `App.devAgent.closeTaskEditor = function() {
  const viewProjBtn = document.getElementById('devTasksViewProjectBtn'); if(viewProjBtn) viewProjBtn.classList.add('hidden');
  const p = document.getElementById('devTaskEditorPanel'); p.classList.add('hidden'); p.style.display = '';
  if (devState.returnToProjectEditorId) {
    const projectId = devState.returnToProjectEditorId;
    devState.returnToProjectEditorId = null;
    App.devAgent.openProjectEditor(projectId);
    return;
  }
  App.devAgent.showTaskBrowser();
};`;

content = content.replace(oldStr, newStr);

fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
