const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

content = content.replace("devElements.log.innerHTML = `<div class=\"error-msg\">Failed to load history. Error: ${err.message}<br><pre>${err.stack}</pre></div>`;", "if(targetLog) targetLog.innerHTML = `<div class=\"error-msg\">Failed to load history. Error: ${err.message}<br><pre>${err.stack}</pre></div>`;");

fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
