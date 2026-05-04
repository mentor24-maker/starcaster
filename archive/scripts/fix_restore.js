const fs = require('fs');
let html = fs.readFileSync('public/js/devAgent.js', 'utf8');

const target = `App.devAgent.restoreChatPanel = function() {
  const pb = document.getElementById('devProjectBrowserPanel'); if(pb) pb.classList.add('hidden');
  const pe = document.getElementById('devProjectEditorPanel'); if(pe) pe.classList.add('hidden');

  document.getElementById('devChatLog').classList.remove('hidden');
  document.getElementById('devChatForm').classList.remove('hidden');
  const header = document.getElementById('devChatMainHeader'); if(header) header.classList.remove('hidden');
  
  // Reparent chat interface back to main panel
  const chatInterface = document.getElementById('devChatInterface');
  const mainPanel = document.querySelector('.dev-chat-main-panel');
  if (chatInterface && mainPanel && chatInterface.parentElement !== mainPanel) {
    mainPanel.appendChild(chatInterface);
  }
  
  // Ensure Task Accordions bodies are reset
  const taskEditorPanel = document.getElementById('devTaskEditorPanel'); if(taskEditorPanel) taskEditorPanel.classList.add('hidden');
  // In general chat, the task editor panel is closed. The chat log and form remain visible for discussion.
  const detailsBtn = document.getElementById('devTaskDetailsAccordionBtn'); if(detailsBtn) { detailsBtn.classList.add('hidden'); }
  const discBtn = document.getElementById('devTaskDiscussionAccordionBtn'); if(discBtn) { discBtn.classList.add('hidden'); }
  // devChatMainActions removed from DOM
  
  // Unhide general buttons
  const newThreadBtn = document.getElementById('devNewSessionBtn'); if(newThreadBtn) newThreadBtn.classList.remove('hidden');
  
  // Restore Chat Input style
  const chatInput = document.getElementById('devChatInput');
  if (chatInput) {
    chatInput.placeholder = 'Message Dev Agent...';
    chatInput.classList.remove('task-discussion-input');
  }

  const overlay = document.getElementById('devPersistentOverlay'); if(overlay) overlay.classList.add('hidden');
  const fricPanel = document.getElementById('devFrictionEditorPanel'); if(fricPanel) fricPanel.classList.add('hidden');
};`;

const replacement = `App.devAgent.restoreChatPanel = function() {
  if (App.setActivePage) {
    App.setActivePage('devForumPage');
  }
};`;

if (html.includes(target)) {
    html = html.replace(target, replacement);
    fs.writeFileSync('public/js/devAgent.js', html);
    console.log("Success");
} else {
    console.log("Failed to find target");
}
