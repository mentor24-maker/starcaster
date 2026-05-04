const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

// Find the first instance of showProjectBrowser, which contains devElements.actionItemsList
content = content.replace("App.devAgent.showProjectBrowser = async function() { console.log('[TRACE] showProjectBrowser started');\n  if (!devElements.actionItemsList) return;", "App.devAgent.loadActionItems = async function() {\n  if (!devElements.actionItemsList) return;");

fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
console.log('Fixed loadActionItems');
