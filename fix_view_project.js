const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

// Add viewTaskProject function
const newFunc = `
App.devAgent.viewTaskProject = function() {
  const projId = document.getElementById('devEditTaskProject').value;
  if (projId) {
    if (App.setActivePage) App.setActivePage('devProjectsPage');
    setTimeout(() => {
      App.devAgent.openProjectEditor(projId);
    }, 100);
  }
};
`;

if (!content.includes('App.devAgent.viewTaskProject')) {
  content += '\n' + newFunc;
}

// Update openTaskEditor to show/hide the button
content = content.replace("document.getElementById('devEditTaskProject');\n      if (projSel) projSel.value = log.project_id || '';", "document.getElementById('devEditTaskProject');\n      if (projSel) projSel.value = log.project_id || '';\n      const viewProjBtn = document.getElementById('devTasksViewProjectBtn');\n      if (viewProjBtn) {\n        if (log.project_id) viewProjBtn.classList.remove('hidden');\n        else viewProjBtn.classList.add('hidden');\n      }");

// Hide the button when closing the editor or opening a new task
content = content.replace("document.getElementById('devTaskEditorHeader').textContent = 'New Task';", "document.getElementById('devTaskEditorHeader').textContent = 'New Task';\n        const viewProjBtn = document.getElementById('devTasksViewProjectBtn'); if(viewProjBtn) viewProjBtn.classList.add('hidden');");

fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
console.log('Success adding View Project logic');
