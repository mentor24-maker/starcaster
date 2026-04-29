const fs = require('fs');

let lines = fs.readFileSync('public/js/devAgent.js', 'utf8').split('\n');
let inProjPage = false;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes("if (pageId === 'devProjectsPage')")) {
    inProjPage = true;
  }
  if (inProjPage && lines[i].includes('loadActionItems')) {
    lines[i] = lines[i].replace('loadActionItems', 'showProjectBrowser');
    inProjPage = false; // replaced, done
  }
}

fs.writeFileSync('public/js/devAgent.js', lines.join('\n'), 'utf8');
console.log('Fixed devProjectsPage initialization hook.');
