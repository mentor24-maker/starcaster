const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

content = content.replace("const browserPanel = document.getElementById('devTaskBrowserPanel'); if(browserPanel) browserPanel.classList.add('hidden');", "const browserPanel = document.getElementById('devTaskBrowserPanel'); if(browserPanel) browserPanel.classList.add('hidden');\n  const kanban = document.getElementById('devDashboardKanban'); if(kanban) { kanban.classList.add('hidden'); kanban.style.display = 'none'; }");

fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
