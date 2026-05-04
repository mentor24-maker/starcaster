const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');
const regex = /<div id="(dev[^"]+Panel)"/g;
let match;
while ((match = regex.exec(html)) !== null) {
  console.log(match[1]);
}
