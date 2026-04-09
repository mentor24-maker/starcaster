'use strict';

window.App = window.App || {};
App.roger = {};

const rogerState = {
  activeSessionId: null,
  sessions: []
};

const rogerElements = {
  log: null,
  form: null,
  input: null,
  sessionList: null,
  newSessionBtn: null,
  activeSessionTitle: null
};

App.roger.init = function() {
  rogerElements.log = document.getElementById('rogerChatLog');
  rogerElements.form = document.getElementById('rogerChatForm');
  rogerElements.input = document.getElementById('rogerChatInput');
  rogerElements.sessionList = document.getElementById('rogerSessionList');
  rogerElements.newSessionBtn = document.getElementById('rogerNewSessionBtn');
  rogerElements.activeSessionTitle = document.getElementById('rogerActiveSessionTitle');

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

  if (rogerElements.newSessionBtn) {
    rogerElements.newSessionBtn.addEventListener('click', () => {
      App.roger.createNewSession('New Discussion');
    });
  }

  const originalSetActivePage = App.setActivePage;
  App.setActivePage = function(pageId) {
    originalSetActivePage.apply(App, arguments);
    if (pageId === 'askRogerPage') {
      App.roger.loadSessions();
    }
  };
};

App.roger.loadSessions = async function() {
  if (!rogerElements.sessionList) return;
  try {
    rogerElements.sessionList.innerHTML = '<li style="padding: 1rem; opacity: 0.7;">Loading...</li>';
    const res = await App.api('/api/develop/roger/sessions');
    rogerElements.sessionList.innerHTML = '';
    
    if (res.error) {
      rogerElements.sessionList.innerHTML = `<li class="error-msg">Failed to load</li>`;
      return;
    }
    
    rogerState.sessions = res.sessions || res.data || [];
    
    if (rogerState.sessions.length === 0) {
      // First boot, create a default session implicitly
      await App.roger.createNewSession('Global Project Scope');
      return;
    }

    rogerState.sessions.forEach(session => App.roger.appendSessionNode(session));
    
    // Auto-select latest session if none is active
    if (!rogerState.activeSessionId && rogerState.sessions.length > 0) {
      App.roger.selectSession(rogerState.sessions[0].id);
    } else if (rogerState.activeSessionId) {
      App.roger.selectSession(rogerState.activeSessionId);
    }
  } catch (err) {
    rogerElements.sessionList.innerHTML = `<li class="error-msg">Error.</li>`;
  }
};

App.roger.createNewSession = async function(name = 'New Discussion') {
  try {
    const res = await App.api('/api/develop/roger/sessions', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    const sessionData = res.session || res.data;
    if (sessionData) {
      rogerState.sessions.unshift(sessionData);
      // Re-render
      rogerElements.sessionList.innerHTML = '';
      rogerState.sessions.forEach(s => App.roger.appendSessionNode(s));
      App.roger.selectSession(sessionData.id);
    }
  } catch (e) {
    alert("Could not create session: " + e.message);
  }
};

App.roger.appendSessionNode = function(session) {
  if (!rogerElements.sessionList) return;
  const li = document.createElement('li');
  li.className = 'roger-session-item';
  li.dataset.sessionId = session.id;
  li.textContent = `[#${session.id}] ${session.name}`;
  if (session.id === rogerState.activeSessionId) {
    li.classList.add('active');
  }
  
  li.addEventListener('click', () => {
    App.roger.selectSession(session.id);
  });
  
  rogerElements.sessionList.appendChild(li);
};

App.roger.selectSession = function(sessionId) {
  rogerState.activeSessionId = sessionId;
  
  // Highlight UI
  if (rogerElements.sessionList) {
    const items = rogerElements.sessionList.querySelectorAll('.roger-session-item');
    items.forEach(el => {
      if (Number(el.dataset.sessionId) === sessionId) el.classList.add('active');
      else el.classList.remove('active');
    });
  }
  
  const activeSessionData = rogerState.sessions.find(s => s.id === sessionId);
  if (activeSessionData && rogerElements.activeSessionTitle) {
    rogerElements.activeSessionTitle.textContent = `[#${activeSessionData.id}] ${activeSessionData.name}`;
  }
  
  App.roger.loadHistory(sessionId);
};

App.roger.loadHistory = async function(sessionId) {
  if (!rogerElements.log || !sessionId) return;
  try {
    rogerElements.log.innerHTML = '<div class="loading-spinner">Loading chat history...</div>';
    rogerElements.input.disabled = true;
    const res = await App.api(`/api/develop/roger/history?sessionId=${sessionId}`);
    rogerElements.log.innerHTML = '';
    rogerElements.input.disabled = false;
    
    if (res.error) {
      rogerElements.log.innerHTML = `<div class="error-msg">Could not load chats: ${res.error.message || res.error}</div>`;
      return;
    }
    
    const chats = res.chats || res.data || [];
    if (chats.length === 0) {
      rogerElements.log.innerHTML = '<div class="empty-state">No discussion history found for this session. Say hello to Roger Thorson!</div>';
    } else {
      chats.forEach(chat => App.roger.appendChatNode(chat));
      App.roger.scrollToBottom();
    }
  } catch (err) {
    rogerElements.log.innerHTML = `<div class="error-msg">Failed to load history.</div>`;
    rogerElements.input.disabled = false;
  }
};

App.roger.formatMarkdown = function(text) {
  if (!text) return '';
  let html = String(text);
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
  html = html.replace(/\n/g, '<br/>');
  return html;
};

App.roger.appendChatNode = function(chat) {
  if (!rogerElements.log) return;
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
    avatar.style.backgroundImage = 'url("/images/roger.png")';
  } else if (chat.role === 'antigravity') {
    avatar.style.backgroundImage = 'url("/images/antigravity.png")'; // Fix the ext from svg to png
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
  const text = rogerElements.input?.value.trim();
  if (!text || !rogerState.activeSessionId) return;

  rogerElements.input.value = '';
  rogerElements.input.disabled = true;

  // Optimistically append user node
  const tempUserChat = { role: 'user', content: text, created_at: new Date().toISOString() };
  App.roger.appendChatNode(tempUserChat);
  App.roger.scrollToBottom();

  const loadingWrapper = document.createElement('div');
  loadingWrapper.className = 'roger-chat-bubble-wrapper roger';
  loadingWrapper.id = 'rogerLoadingBubble';
  loadingWrapper.innerHTML = `
    <div class="roger-chat-avatar roger" style="background-image: url('/images/roger.png');"></div>
    <div class="roger-chat-content-col">
      <div class="roger-chat-bubble roger loading">Roger is analyzing...</div>
    </div>
  `;
  rogerElements.log.appendChild(loadingWrapper);
  App.roger.scrollToBottom();

  try {
    const res = await App.api('/api/develop/roger/chat', {
      method: 'POST',
      body: JSON.stringify({ sessionId: rogerState.activeSessionId, content: text })
    });
    
    const loadingNode = document.getElementById('rogerLoadingBubble');
    if (loadingNode) loadingNode.remove();

    if (res.error) {
      alert("Roger Failed to Respond: " + (res.error.message || res.error));
    } else if (res.data?.rogerChat) {
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

document.addEventListener('DOMContentLoaded', () => {
  App.roger.init();
});
