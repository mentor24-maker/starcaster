const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

content = content.replace("App.devAgent.closeTaskEditor = function() {\n  const p = document.getElementById('devTaskEditorPanel');", "App.devAgent.closeTaskEditor = function() {\n  const viewProjBtn = document.getElementById('devTasksViewProjectBtn'); if(viewProjBtn) viewProjBtn.classList.add('hidden');\n  const p = document.getElementById('devTaskEditorPanel');");

fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
console.log('Success adding hide btn logic');
