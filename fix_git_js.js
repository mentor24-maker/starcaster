const fs = require('fs');

let lines = fs.readFileSync('public/js/devAgent.js', 'utf8').split('\n');

let newLines = [];
let i = 0;
while (i < lines.length) {
  if (lines[i].includes('setTimeout(() => App.devAgent.loadGitStatus(), 50);')) {
    i++;
    continue;
  }
  newLines.push(lines[i]);
  
  if (lines[i].includes('setTimeout(() => App.devAgent.loadActionItems(), 50);') && lines[i-1].includes('loadTasks()') && lines[i-2].includes('devDashboardPage')) {
    newLines.push('        setTimeout(() => App.devAgent.loadGitStatus(), 50);');
  }
  
  i++;
}

fs.writeFileSync('public/js/devAgent.js', newLines.join('\n'), 'utf8');
console.log('Fixed properly.');
