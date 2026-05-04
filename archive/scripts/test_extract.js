const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');
const startStr = `<div id="devProjectBrowserPanel"`;
console.log(html.indexOf(startStr));
