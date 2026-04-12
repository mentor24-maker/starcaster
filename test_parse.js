const fs = require('fs');
const js = fs.readFileSync('public/js/roger.js', 'utf8');
// Try to evaluate it inside a JSDOM or just run standard static checks
