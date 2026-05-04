const fs = require('fs');
let code = fs.readFileSync('public/js/roger.js', 'utf8');

// 1. sendProtocolAction
code = code.replace(
  `  const tempUserChat = { 
    role: 'user', 
    content: triAgentPayload, 
    created_at: new Date().toISOString(),
    attachment_url: null
  };
  App.roger.appendChatNode(tempUserChat);
  App.roger.scrollToBottom();

  App.api('/api/develop/roger/chat', {
    method: 'POST',
    body: JSON.stringify(payload)
  }).then(res => {
    if (res.data?.rogerChat || res.rogerChat) {
      App.roger.appendChatNode(res.rogerChat || res.data.rogerChat);
      App.roger.scrollToBottom();
    }
  });`,
  `  App.api('/api/develop/roger/chat', {
    method: 'POST',
    body: JSON.stringify(payload)
  }).then(res => {
    if (res.data?.userChat) {
      App.roger.appendChatNode(res.data.userChat);
    }
    if (res.data?.rogerChat) {
      App.roger.appendChatNode(res.data.rogerChat);
    }
    App.roger.scrollToBottom();
  });`
);

// 2. submitChat
code = code.replace(
  `  // Optimistically append user node natively bound to protocol
  const tempUserChat = { 
    role: 'user', 
    content: triAgentPayload, 
    created_at: new Date().toISOString(),
    attachment_url: staged ? staged.base64 : null // Optimistic visual render
  };
  App.roger.appendChatNode(tempUserChat);
  App.roger.scrollToBottom();

  try {
    const payload = { 
      sessionId: rogerState.activeSessionId, 
      content: triAgentPayload 
    };`,
  `  try {
    const payload = { 
      sessionId: rogerState.activeSessionId, 
      content: triAgentPayload 
    };`
);

// And update the block in try...catch
code = code.replace(
  `    if (res.error) {
      alert("Agent Failed to Respond: " + (res.error.message || res.error));
    } else if (res.data?.userChat) {
       // Only append the user chat immediately. SSE Stream will push the System Queued row a split second later.
    }`,
  `    if (res.error) {
      alert("Agent Failed to Receive Message: " + (res.error.message || res.error));
    } else if (res.data?.userChat) {
       App.roger.appendChatNode(res.data.userChat);
       if (res.data.rogerChat) App.roger.appendChatNode(res.data.rogerChat);
       App.roger.scrollToBottom();
    }`
);

fs.writeFileSync('public/js/roger.js', code);
