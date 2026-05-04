const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

// 1. Fix loadSessions targeting wrong ID for Forum page
content = content.replace(
  "const accordionContainer = document.getElementById('devSessionList');",
  "const accordionContainer = document.getElementById('devThreadsAccordionContainer');"
);

// 2. Fix unsafe UI resets that cause crashes
const unsafeLines = [
  "document.getElementById('devChatLog').classList.add('hidden');",
  "document.getElementById('devChatForm').classList.add('hidden');",
  "const header = document.getElementById('devChatMainHeader'); if(header) header.classList.add('hidden');",
  "const overlay = document.getElementById('devPersistentOverlay'); if(overlay) overlay.classList.add('hidden');"
];

for (const line of unsafeLines) {
  // Convert unsafe line to safe line if it's the direct call
  if (line.includes('classList.add')) {
    const idMatch = line.match(/'([^']+)'/);
    if (idMatch) {
      const id = idMatch[1];
      const safeLine = `const ${id}El = document.getElementById('${id}'); if (${id}El) ${id}El.classList.add('hidden');`;
      // Global replace but be careful about existing safe versions
      content = content.split(line).join(safeLine);
    }
  }
}

fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
console.log('done');
