
  // Replace logic in appendChatNode
  if (chat.content === '[SYSTEM::QUEUED]') {
    wrapper.id = 'rogerChatNode_' + chat.id;
    wrapper.dataset.status = 'queued';
    wrapper.innerHTML = `
      <div class="roger-chat-avatar ${chat.role}" style="background-image: url('/images/${chat.role}.png');"></div>
      <div class="roger-chat-content-col">
        <div class="roger-chat-bubble ${chat.role} loading">Agent is analyzing...</div>
      </div>
    `;
    rogerElements.log.appendChild(wrapper);
    return;
  }
  
  if (chat.id) wrapper.id = 'rogerChatNode_' + chat.id;

