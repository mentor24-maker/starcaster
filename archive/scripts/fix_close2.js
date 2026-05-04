const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

content = content.replace("document.getElementById('devProjectEditorPanel').classList.add('hidden');", "const p = document.getElementById('devProjectEditorPanel'); p.classList.add('hidden'); p.style.display = '';");

fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
