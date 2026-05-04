const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

content = content.replace("taskTbody.innerHTML = \\`<tr><td colspan=\"4\" style=\"text-align: center; color: red;\">Failed to load tasks: \\${err.message}</td></tr>\\`;", "taskTbody.innerHTML = \\`<tr><td colspan=\"5\" style=\"text-align: center; color: red;\">Failed to load tasks: \\${err.message}</td></tr>\\`;");

fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
