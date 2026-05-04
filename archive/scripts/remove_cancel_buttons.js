const fs = require('fs');

const path = 'public/index.html';
let content = fs.readFileSync(path, 'utf8');
const lines = content.split('\n');

const newLines = lines.filter(line => {
  if (line.match(/<button.*>Cancel( Edit)?<\/button>/i)) return false;
  if (line.match(/<button.*>Close Editor<\/button>/i)) return false;
  if (line.match(/<button.*id="developCancelFormEditBtn".*>Close<\/button>/i)) return false;
  return true;
});

fs.writeFileSync(path, newLines.join('\n'));
console.log('Removed ' + (lines.length - newLines.length) + ' cancel/close buttons.');
