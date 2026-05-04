global.window = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
global.document = { getElementById: () => ({ classList: { toggle: () => {}, add: () => {}, remove: () => {} }, addEventListener: () => {} }) };
global.App = { api: () => {} };
try {
  const fs = require('fs');
  const code = fs.readFileSync('./public/js/auth.js', 'utf8');
  eval(code);
  console.log('SUCCESS');
} catch (e) {
  console.error('ERROR:', e);
}
