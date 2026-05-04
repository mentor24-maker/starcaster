const fs = require('fs');
let content = fs.readFileSync('public/js/devAgent.js', 'utf8');

const newLogic = `      if (log.session_id) {
         devState.activeSessionId = log.session_id;
         const chatContainer = document.getElementById('devTaskChatContainer');
         if (chatContainer) {
            chatContainer.innerHTML = '<div class="dev-chat-log" style="flex: 1; overflow-y: auto;"></div>';
            
            const template = document.getElementById('devChatFormTemplate');
            if (template) {
              const formClone = template.content.cloneNode(true);
              chatContainer.appendChild(formClone);
              
              const form = chatContainer.querySelector('.dev-inline-chat-form');
              form.addEventListener('submit', (e) => {
                e.preventDefault();
                App.devAgent.submitChat(form);
              });
              
              const fileTrigger = form.querySelector('.dev-file-trigger-btn');
              const fileInput = form.querySelector('.dev-chat-file');
              if (fileTrigger && fileInput) {
                 fileTrigger.addEventListener('click', () => fileInput.click());
                 fileInput.addEventListener('change', (e) => {
                    if (App.devAgent.handleFileSelect) {
                        App.devAgent.handleFileSelect(e, form);
                    }
                 });
              }
            }
            
            App.devAgent.loadHistory(log.session_id, chatContainer.querySelector('.dev-chat-log'));
            App.devAgent.initSupabaseRealtime(log.session_id);
         }
      } else {
         const cl2 = document.getElementById('devTaskChatContainer'); if(cl2) cl2.innerHTML = '<div style="padding: 2rem; color: var(--text-muted); font-style: italic;">Failed to initialize discussion thread.</div>';
      }`;

const oldLogicRegex = /\/\/ Load the session into the chat log[\s\S]*?failed to initialize discussion thread[^\n]*\n      \}/i;

const oldStr1 = `      // Load the session into the chat log
      if (log.session_id) {
         App.devAgent.selectSession(log.session_id, true); // true = isFromTaskEditor
      } else {
         const cl2 = document.getElementById('devChatLog'); if(cl2) cl2.innerHTML = '<div style="padding: 2rem; color: var(--text-muted); font-style: italic;">Failed to initialize discussion thread.</div>';
      }`;

if (content.includes(oldStr1)) {
   content = content.replace(oldStr1, newLogic);
} else {
   console.log("Could not find oldStr1");
   // Try regex
   if (oldLogicRegex.test(content)) {
     content = content.replace(oldLogicRegex, newLogic);
   } else {
     console.log("Could not match regex");
   }
}

// Ensure "Save the task to start a discussion" targets devTaskChatContainer instead of devChatLog
content = content.replace("const cl = document.getElementById('devChatLog'); if(cl) cl.innerHTML = '<div style=\"padding: 2rem; color: var(--text-muted); font-style: italic;\">Save the task to start a discussion.</div>';", "const cl = document.getElementById('devTaskChatContainer'); if(cl) cl.innerHTML = '<div style=\"padding: 2rem; color: var(--text-muted); font-style: italic; text-align: center; margin-top: 2rem;\">Save the task to start a discussion.</div>';");

// Make the editor Panel display flex
content = content.replace("const panel = document.getElementById('devTaskEditorPanel');\n  if (panel) {\n    panel.classList.remove('hidden');", "const panel = document.getElementById('devTaskEditorPanel');\n  if (panel) {\n    panel.classList.remove('hidden');\n    panel.style.display = 'flex';");

fs.writeFileSync('public/js/devAgent.js', content, 'utf8');
console.log('Success updating task editor chat injection');
