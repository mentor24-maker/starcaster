const fs = require('fs');
const code = fs.readFileSync('public/js/devAgent.js', 'utf8');

let stack = [];
for (let i = 0; i < code.length; i++) {
  const c = code[i];
  // Simple check ignoring strings and comments for a moment, just to get an idea
  if (c === '{') stack.push({ char: '{', line: code.substring(0, i).split('\n').length });
  else if (c === '}') {
    if (stack.length === 0) {
      console.log('Extra } at line', code.substring(0, i).split('\n').length);
    } else {
      stack.pop();
    }
  }
}

if (stack.length > 0) {
  console.log('Unclosed { opened at lines:', stack.map(s => s.line).slice(-10));
} else {
  console.log('Brackets matched? (crude test)');
}
