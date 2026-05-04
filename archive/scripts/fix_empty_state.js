const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

content = content.replace("if (devElements.log.querySelector('.empty-state')) {\n    devElements.log.innerHTML = '';\n  }", "if (logContainer && logContainer.querySelector('.empty-state')) {\n    logContainer.innerHTML = '';\n  }");

fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
