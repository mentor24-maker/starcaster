const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

content = content.replace("document.getElementById('devActiveSessionTitle').textContent = `New Task`;", "const ast = document.getElementById('devActiveSessionTitle'); if(ast) ast.textContent = `New Task`;");
content = content.replace("document.getElementById('devTaskProjectContext').innerHTML = `<p style=\"color: var(--text-muted); font-style: italic;\">Save the task to see project context.</p>`;", "const ptc = document.getElementById('devTaskProjectContext'); if(ptc) ptc.innerHTML = `<p style=\"color: var(--text-muted); font-style: italic;\">Save the task to see project context.</p>`;");
content = content.replace("document.getElementById('devChatLog').innerHTML = '<div style=\"padding: 2rem; color: var(--text-muted); font-style: italic;\">Save the task to start a discussion.</div>';", "const cl = document.getElementById('devChatLog'); if(cl) cl.innerHTML = '<div style=\"padding: 2rem; color: var(--text-muted); font-style: italic;\">Save the task to start a discussion.</div>';");
content = content.replace("document.getElementById('devActiveSessionTitle').textContent = `Task: ${log.title}`;", "const ast2 = document.getElementById('devActiveSessionTitle'); if(ast2) ast2.textContent = `Task: ${log.title}`;");
content = content.replace("document.getElementById('devTaskProjectContext').innerHTML = html;", "const ptc2 = document.getElementById('devTaskProjectContext'); if(ptc2) ptc2.innerHTML = html;");
content = content.replace("document.getElementById('devTaskProjectContext').innerHTML = `<p style=\"color: var(--text-muted); font-style: italic;\">Task does not belong to a project.</p>`;", "const ptc3 = document.getElementById('devTaskProjectContext'); if(ptc3) ptc3.innerHTML = `<p style=\"color: var(--text-muted); font-style: italic;\">Task does not belong to a project.</p>`;");
content = content.replace("document.getElementById('devChatLog').innerHTML = '<div style=\"padding: 2rem; color: var(--text-muted); font-style: italic;\">Failed to initialize discussion thread.</div>';", "const cl2 = document.getElementById('devChatLog'); if(cl2) cl2.innerHTML = '<div style=\"padding: 2rem; color: var(--text-muted); font-style: italic;\">Failed to initialize discussion thread.</div>';");

fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
console.log('Fixed task editor crashes');
