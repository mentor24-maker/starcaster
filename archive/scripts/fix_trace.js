const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

content = content.replace("App.devAgent.loadProjects = async function() { console.log('[TRACE] loadProjects started');", "App.devAgent.loadProjects = async function() {");
content = content.replace("if (tbody) tbody.innerHTML = '<tr><td colspan=\"6\" style=\"text-align:center;\">Loading...</td></tr>'; console.log('[TRACE] loadProjects set Loading...', !!window.supabaseClient);", "if (tbody) tbody.innerHTML = '<tr><td colspan=\"6\" style=\"text-align:center;\">Loading...</td></tr>';");

fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
console.log('Traces removed');
