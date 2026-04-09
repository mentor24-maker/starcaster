'use strict';

window.App = window.App || {};
App.roger = {};

const rogerElements = {
  log: null,
  form: null,
  input: null
};

App.roger.init = function() {
  rogerElements.log = document.getElementById('rogerChatLog');
  rogerElements.form = document.getElementById('rogerChatForm');
  rogerElements.input = document.getElementById('rogerChatInput');

  if (rogerElements.form) {
    rogerElements.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await App.roger.submitChat();
    });
    
    rogerElements.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        App.roger.submitChat();
      }
    });
  }

  // Bind the page transition specifically
  const originalSetActivePage = App.setActivePage;
  App.setActivePage = function(pageId) {
    originalSetActivePage.apply(App, arguments);
    if (pageId === 'askRogerPage') {
      App.roger.loadHistory();
    }
  };
};

App.roger.loadHistory = async function() {
  if (!rogerElements.log) return;
  try {
    rogerElements.log.innerHTML = '<div class="loading-spinner">Loading chat history...</div>';
    const res = await App.api('/api/develop/roger/history');
    rogerElements.log.innerHTML = '';
    
    if (res.error) {
      rogerElements.log.innerHTML = `<div class="error-msg">Could not load chats: ${res.error.message || res.error}</div>`;
      return;
    }
    
    const chats = res.data?.chats || [];
    if (chats.length === 0) {
      rogerElements.log.innerHTML = '<div class="empty-state">No discussion history found. Say hello to Roger Thorson!</div>';
    } else {
      chats.forEach(chat => App.roger.appendChatNode(chat));
      App.roger.scrollToBottom();
    }
  } catch (err) {
    rogerElements.log.innerHTML = `<div class="error-msg">Failed to load history.</div>`;
  }
};

App.roger.formatMarkdown = function(text) {
  if (!text) return '';
  // Basic markdown parsing for the UI (Bold, Italics, Lists, Codeblocks)
  let html = String(text);
  
  // Code Fences
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  // Inline Code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
  // Line Breaks
  html = html.replace(/\n/g, '<br/>');

  return html;
};

App.roger.appendChatNode = function(chat) {
  if (!rogerElements.log) return;
  // Remove empty states if present
  if (rogerElements.log.querySelector('.empty-state')) {
    rogerElements.log.innerHTML = '';
  }

  const wrapper = document.createElement('div');
  wrapper.className = `roger-chat-bubble-wrapper ${chat.role}`;
  
  const avatar = document.createElement('div');
  avatar.className = `roger-chat-avatar ${chat.role}`;
  if (chat.role === 'user') {
    avatar.style.backgroundImage = 'url("/images/mentor.png")';
  } else if (chat.role === 'roger') {
    avatar.style.backgroundImage = 'url("/images/roger.svg")';
  } else if (chat.role === 'antigravity') {
    avatar.style.backgroundImage = 'url("/images/antigravity.svg")';
  }

  const contentCol = document.createElement('div');
  contentCol.className = 'roger-chat-content-col';
  
  const bubble = document.createElement('div');
  bubble.className = `roger-chat-bubble ${chat.role}`;

  const header = document.createElement('div');
  header.className = 'roger-chat-header';
  
  let author = 'Unknown';
  if (chat.role === 'user') author = 'You';
  if (chat.role === 'roger') author = 'Roger Thorson';
  if (chat.role === 'antigravity') author = 'Antigravity';

  const dateStr = chat.created_at ? new Date(chat.created_at).toLocaleString() : new Date().toLocaleString();
  
  header.innerHTML = `<strong>${author}</strong> <span class="chat-time">${dateStr}</span>`;
  
  const content = document.createElement('div');
  content.className = 'roger-chat-content';
  content.innerHTML = App.roger.formatMarkdown(chat.content);

  bubble.appendChild(header);
  bubble.appendChild(content);
  
  contentCol.appendChild(bubble);
  
  if (chat.role === 'user') {
    wrapper.appendChild(contentCol);
    wrapper.appendChild(avatar);
  } else {
    wrapper.appendChild(avatar);
    wrapper.appendChild(contentCol);
  }
  
  rogerElements.log.appendChild(wrapper);
};

App.roger.scrollToBottom = function() {
  if (rogerElements.log) {
    rogerElements.log.scrollTop = rogerElements.log.scrollHeight;
  }
};

App.roger.submitChat = async function() {
  if (!rogerElements.input) return;
  const text = rogerElements.input.value.trim();
  if (!text) return;

  rogerElements.input.value = '';
  rogerElements.input.disabled = true;

  // Optimistically append user node
  const tempUserChat = { role: 'user', content: text, created_at: new Date().toISOString() };
  App.roger.appendChatNode(tempUserChat);
  App.roger.scrollToBottom();

  const loadingWrapper = document.createElement('div');
  loadingWrapper.className = 'roger-chat-bubble-wrapper roger';
  loadingWrapper.id = 'rogerLoadingBubble';
  loadingWrapper.innerHTML = `<div class="roger-chat-bubble roger loading">Roger is analyzing...</div>`;
  rogerElements.log.appendChild(loadingWrapper);
  App.roger.scrollToBottom();

  try {
    const res = await App.api('/api/develop/roger/chat', {
      method: 'POST',
      body: JSON.stringify({ content: text })
    });
    
    const loadingNode = document.getElementById('rogerLoadingBubble');
    if (loadingNode) loadingNode.remove();

    if (res.error) {
      alert("Roger Failed to Respond: " + (res.error.message || res.error));
    } else if (res.data?.rogerChat) {
      // Re-load the specific roger response perfectly
      App.roger.appendChatNode(res.data.rogerChat);
      App.roger.scrollToBottom();
    }
  } catch (err) {
    const loadingNode = document.getElementById('rogerLoadingBubble');
    if (loadingNode) loadingNode.remove();
    alert("Roger encountered an issue: " + (err.message || err));
  } finally {
    rogerElements.input.disabled = false;
    rogerElements.input.focus();
  }
};

// Auto-init on script load
document.addEventListener('DOMContentLoaded', () => {
  App.roger.init();
});
