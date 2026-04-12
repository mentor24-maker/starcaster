
App.roger.initStream = function(sessionId) {
  if (App.roger.eventSource) {
    App.roger.eventSource.close();
  }
  App.roger.eventSource = new EventSource('/api/develop/roger/stream?sessionId=' + sessionId);
  
  App.roger.eventSource.onmessage = function(e) {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'ping') return;
      
      if (data.type === 'sync' && data.chats) {
        data.chats.forEach(chat => {
          const existingNode = document.getElementById('rogerChatNode_' + chat.id);
          if (existingNode) {
            // Update node if the queued state advanced to a real response
            if (chat.content !== '[SYSTEM::QUEUED]' && existingNode.dataset.status === 'queued') {
              existingNode.outerHTML = ''; // Remove the spinner node
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

  App.roger.eventSource.onerror = function(e) {
    console.error('SSE Error', e);
  };
};

