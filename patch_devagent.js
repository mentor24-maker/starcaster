const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

// Replace add('hidden')
content = content.replace(/document\.getElementById\('devChatLog'\)\.classList\.add\('hidden'\);/g, "const _cL = document.getElementById('devChatLog'); if(_cL) _cL.classList.add('hidden');");
content = content.replace(/document\.getElementById\('devChatForm'\)\.classList\.add\('hidden'\);/g, "const _cF = document.getElementById('devChatForm'); if(_cF) _cF.classList.add('hidden');");

// Replace remove('hidden')
content = content.replace(/document\.getElementById\('devChatLog'\)\.classList\.remove\('hidden'\);/g, "const _cL = document.getElementById('devChatLog'); if(_cL) _cL.classList.remove('hidden');");
content = content.replace(/document\.getElementById\('devChatForm'\)\.classList\.remove\('hidden'\);/g, "const _cF = document.getElementById('devChatForm'); if(_cF) _cF.classList.remove('hidden');");

fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
console.log('Patched all missing element checks in devAgent.js');
