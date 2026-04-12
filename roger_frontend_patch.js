const fs = require('fs');
let code = fs.readFileSync('public/js/roger.js', 'utf8');

// 1. Hook initStream into loadHistory
code = code.replace(
  "App.roger.loadHistory(sessionId);\n};",
  "App.roger.loadHistory(sessionId);\n  App.roger.initStream(sessionId);\n};"
);

// 2. inject initStream definition and remove pollRetry functions
const streamDef = `
App.roger.initStream = function(sessionId) {
  if (App.roger.eventSource) App.roger.eventSource.close();
  App.roger.eventSource = new EventSource('/api/develop/roger/stream?sessionId=' + sessionId);
  
  App.roger.eventSource.onmessage = function(e) {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'ping') return;
      if (data.type === 'sync' && data.chats) {
        data.chats.forEach(chat => {
          const existingNode = document.getElementById('rogerChatNode_' + chat.id);
          if (existingNode) {
            if (chat.content !== '[SYSTEM::QUEUED]' && existingNode.dataset.status === 'queued') {
              existingNode.outerHTML = '';
              App.roger.appendChatNode(chat);
              App.roger.scrollToBottom();
            }
          } else {
             App.roger.appendChatNode(chat);
             App.roger.scrollToBottom();
          }
        });
      }
    } catch(err) {
      console.error('SSE parsing error', err);
    }
  };
};
`;
// Replace the two retry functions with the streamDef
code = code.replace(/App\.roger\.startRetryCountdown = function[\s\S]*?App\.roger\.renderStagedFiles = function/, streamDef + "\n\nApp.roger.renderStagedFiles = function");

// 3. Update appendChatNode spinner logic
const nodeInject = `
  if (!rogerElements.log) return;
  
  if (chat.content === '[SYSTEM::QUEUED]') {
    const spinner = document.createElement('div');
    spinner.className = 'roger-chat-bubble-wrapper ' + chat.role;
    spinner.id = 'rogerChatNode_' + chat.id;
    spinner.dataset.status = 'queued';
    spinner.innerHTML = \`
      <div class="roger-chat-avatar \${chat.role}" style="background-image: url('/images/\${chat.role}.png');"></div>
      <div class="roger-chat-content-col">
        <div class="roger-chat-bubble \${chat.role} loading">Agent is processing objective...</div>
      </div>
    \`;
    rogerElements.log.appendChild(spinner);
    return;
  }

  if (rogerElements.log.querySelector('.empty-state')) {`;
code = code.replace(
  "if (!rogerElements.log) return;\n  if (rogerElements.log.querySelector('.empty-state')) {",
  nodeInject
);

// We must also ensure wrapper has an ID for non-queued
code = code.replace(
  "const wrapper = document.createElement('div');\n  wrapper.className = `roger-chat-bubble-wrapper ${chat.role}`;",
  "const wrapper = document.createElement('div');\n  wrapper.className = `roger-chat-bubble-wrapper ${chat.role}`;\n  if (chat.id) wrapper.id = 'rogerChatNode_' + chat.id;"
);

// 4. Update submitChat to remove the fake UI and retry logic
// Replace from `const bubbleId = 'rogerLoadingBubble_'` to the end of `try...catch`
code = code.replace(
  /const bubbleId = 'rogerLoadingBubble_'[\s\S]*?App\.roger\.startRetryCountdown\(sessionId, bubbleId, 1\);\n  } finally {/g,
  `try {
    const payload = { 
      sessionId: rogerState.activeSessionId, 
      content: triAgentPayload 
    };
    if (staged) {
      payload.attachmentBase64 = staged.base64;
      payload.attachmentMime = staged.mime;
      payload.attachmentName = staged.name;
    }

    const res = await App.api('/api/develop/roger/chat', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    if (res.error) {
      alert("Agent Failed to Respond: " + (res.error.message || res.error));
    } else if (res.data?.userChat) {
       // Only append the user chat immediately. SSE Stream will push the System Queued row a split second later.
    }
  } catch (err) {
    App.notify("Fetch issue: " + (err.message || err), true);
  } finally {`
);

fs.writeFileSync('public/js/roger.js', code);
