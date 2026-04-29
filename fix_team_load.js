const fs = require('fs');
let lines = fs.readFileSync('public/js/devAgent.js', 'utf8').split('\n');

let newLines = [];
let injected = false;
for (let i = 0; i < lines.length; i++) {
  newLines.push(lines[i]);
  if (lines[i].includes('setTimeout(() => App.devAgent.loadGitStatus(), 50);') && !injected) {
    newLines.push('        setTimeout(() => App.devAgent.loadTeam(), 50);');
    injected = true;
  }
}

fs.writeFileSync('public/js/devAgent.js', newLines.join('\n'), 'utf8');
console.log('Injected loadTeam into devDashboardPage initialization.');
