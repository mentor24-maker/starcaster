const fs = require('fs');
let js = fs.readFileSync('public/js/devAgent.js', 'utf8');

function replaceOrThrow(desc, find, replace) {
  if (js.indexOf(find) === -1) {
    throw new Error(`Could not find string for: ${desc}`);
  }
  js = js.replace(find, replace);
}

// 1. Rewrite loadSessions
const oldLoadSessions = `App.devAgent.loadSessions = async function() { App.devAgent.loadAllMessages();
  if (!devElements.sessionList) return;
  try {
    devElements.sessionList.innerHTML = '<li style="padding: 1rem; opacity: 0.7;">Loading...</li>';
    const res = await App.api('/api/develop/devAgent/sessions');
    devElements.sessionList.innerHTML = '';
    
    if (res.error) {
      devElements.sessionList.innerHTML = \`<li class="error-msg">Failed to load</li>\`;
      return;
    }
    
    devState.sessions = res.sessions || res.data || [];
    
    if (devState.sessions.length === 0) {
      devElements.sessionList.innerHTML = '<li class="dev-session-item" style="color: #666; font-style: italic;">No active discussions.</li>';
      return;
    }

    devState.sessions.forEach(session => App.devAgent.appendSessionNode(session));
    
    // Auto-select latest session if none is active
    if (!devState.activeSessionId && devState.sessions.length > 0) {
      // Pass true to suppress restoring the chat panel, allowing the default page (Projects) to render
      App.devAgent.selectSession(devState.sessions[0].id, true);
    } else if (devState.activeSessionId) {
      // Just highlight the active session in the list without re-triggering selectSession
      const items = devElements.sessionList.querySelectorAll('.dev-session-item');
      items.forEach(el => {
        if (Number(el.dataset.sessionId) === devState.activeSessionId) el.classList.add('active');
        else el.classList.remove('active');
      });
    }
    
    // Also load pending action items
    App.devAgent.loadPendingCommands();
  } catch (err) {
    App.devAgent.renderErrorState('devSessionList', err, true);
  }
};`;

const newLoadSessions = `App.devAgent.loadSessions = async function() { 
  App.devAgent.loadAllMessages();
  const accordionContainer = document.getElementById('devThreadsAccordionContainer');
  const dashboardList = document.getElementById('devSessionList');
  
  if (!accordionContainer && !dashboardList) return;
  
  try {
    if (dashboardList) dashboardList.innerHTML = '<li style="padding: 1rem; opacity: 0.7;">Loading...</li>';
    if (accordionContainer) accordionContainer.innerHTML = '<div style="padding: 1rem; text-align: center; color: #666; font-style: italic;">Loading threads...</div>';
    
    const res = await App.api('/api/develop/devAgent/sessions');
    
    if (dashboardList) dashboardList.innerHTML = '';
    if (accordionContainer) accordionContainer.innerHTML = '';
    
    if (res.error) {
      if (dashboardList) dashboardList.innerHTML = \`<li class="error-msg">Failed to load</li>\`;
      if (accordionContainer) accordionContainer.innerHTML = \`<div class="error-msg">Failed to load</div>\`;
      return;
    }
    
    devState.sessions = res.sessions || res.data || [];
    
    if (devState.sessions.length === 0) {
      if (dashboardList) dashboardList.innerHTML = '<li class="dev-session-item" style="color: #666; font-style: italic;">No active discussions.</li>';
      if (accordionContainer) accordionContainer.innerHTML = '<div style="color: #666; font-style: italic; text-align: center;">No active discussions.</div>';
      return;
    }

    // Sort by id descending (newest first)
    devState.sessions.sort((a, b) => b.id - a.id);

    // Render Dashboard List (Top 10)
    if (dashboardList) {
      devState.sessions.slice(0, 10).forEach(session => {
        const li = document.createElement('li');
        li.className = 'dev-session-item';
        li.dataset.sessionId = session.id;
        li.innerHTML = \`
          <div class="dev-session-item-title">\${session.name || 'Untitled Thread'}</div>
        \`;
        li.addEventListener('click', () => {
          if (App.setActivePage) App.setActivePage('devForumPage');
          App.devAgent.expandThreadAccordion(session.id);
        });
        dashboardList.appendChild(li);
      });
    }

    // Render Forum Accordions
    if (accordionContainer) {
      devState.sessions.forEach(session => {
        const accordion = App.devAgent.createThreadAccordion(session);
        accordionContainer.appendChild(accordion);
      });
      
      // Auto-expand the active session if one exists
      if (devState.activeSessionId) {
        App.devAgent.expandThreadAccordion(devState.activeSessionId);
      }
    }
    
    // Also load pending action items
    App.devAgent.loadPendingCommands();
  } catch (err) {
    if (dashboardList) App.devAgent.renderErrorState('devSessionList', err, true);
    if (accordionContainer) App.devAgent.renderErrorState('devThreadsAccordionContainer', err, true);
  }
};

App.devAgent.createThreadAccordion = function(session) {
  const container = document.createElement('div');
  container.className = 'dev-thread-accordion';
  container.dataset.sessionId = session.id;
  container.style.border = '1px solid var(--border-light)';
  container.style.borderRadius = '8px';
  container.style.background = 'var(--bg-card)';
  container.style.overflow = 'hidden';

  const header = document.createElement('div');
  header.className = 'dev-thread-accordion-header';
  header.style.padding = '1rem';
  header.style.cursor = 'pointer';
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.background = 'var(--bg-input)';
  header.innerHTML = \`<h3 style="margin:0; font-size: 1.05rem;">\${session.name}</h3><span class="dev-accordion-icon">▼</span>\`;
  
  const body = document.createElement('div');
  body.className = 'dev-thread-accordion-body hidden';
  body.style.padding = '1rem';
  body.style.borderTop = '1px solid var(--border-light)';
  
  header.addEventListener('click', () => {
    if (body.classList.contains('hidden')) {
      App.devAgent.expandThreadAccordion(session.id);
    } else {
      App.devAgent.collapseThreadAccordion(session.id);
    }
  });

  container.appendChild(header);
  container.appendChild(body);
  return container;
};

App.devAgent.expandThreadAccordion = function(sessionId) {
  devState.activeSessionId = sessionId;
  
  const container = document.getElementById('devThreadsAccordionContainer');
  if (!container) return;
  
  const accordions = container.querySelectorAll('.dev-thread-accordion');
  accordions.forEach(acc => {
    const body = acc.querySelector('.dev-thread-accordion-body');
    const icon = acc.querySelector('.dev-accordion-icon');
    if (Number(acc.dataset.sessionId) === sessionId) {
      body.classList.remove('hidden');
      icon.textContent = '▲';
      
      // Load history into this accordion if it's not already loaded
      if (!body.querySelector('.dev-chat-log')) {
        body.innerHTML = '<div class="dev-chat-log" style="max-height: 400px; overflow-y: auto;"></div>';
        
        // Clone chat form template
        const template = document.getElementById('devChatFormTemplate');
        if (template) {
          const formClone = template.content.cloneNode(true);
          body.appendChild(formClone);
          
          // Bind form submit event
          const form = body.querySelector('.dev-inline-chat-form');
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            App.devAgent.sendMessage(sessionId, form);
          });
          
          // Bind file trigger
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
        
        App.devAgent.loadHistory(sessionId, body.querySelector('.dev-chat-log'));
      }
    } else {
      body.classList.add('hidden');
      icon.textContent = '▼';
    }
  });
};

App.devAgent.collapseThreadAccordion = function(sessionId) {
  const container = document.getElementById('devThreadsAccordionContainer');
  if (!container) return;
  const acc = container.querySelector(\`.dev-thread-accordion[data-session-id="\${sessionId}"]\`);
  if (acc) {
    acc.querySelector('.dev-thread-accordion-body').classList.add('hidden');
    acc.querySelector('.dev-accordion-icon').textContent = '▼';
  }
  if (devState.activeSessionId === sessionId) {
    devState.activeSessionId = null;
  }
};
`;

replaceOrThrow("loadSessions rewrite", oldLoadSessions, newLoadSessions);

// 2. Modify loadHistory to accept custom log container
const oldLoadHistory = `App.devAgent.loadHistory = async function(sessionId) {
  if (!devElements.log || !sessionId) return;
  try {
    devElements.log.innerHTML = '<div class="loading-spinner">Loading chat history...</div>';
    devElements.input.disabled = true;
    const res = await App.api(\`/api/develop/devAgent/history?sessionId=\${sessionId}&limit=1000&_t=\${Date.now()}\`);
    devElements.log.innerHTML = '';
    devElements.input.disabled = false;
    
    if (res.error) {
      console.error('[devAgent] loadHistory API error:', res.error);
      devElements.log.innerHTML = \`<div class="error-msg">Could not load chats: \${res.error.message || res.error}</div>\`;
      return;
    }

    if (res.messages && res.messages.length > 0) {
      // Filter out messages that contain action metadata but no visible content, 
      // or filter them internally inside renderSessionMessages
      // For now, render all and let renderSessionMessages handle formatting
      const reversed = res.messages.reverse();
      devState.chatHistory = reversed;
      
      reversed.forEach(msg => App.devAgent.renderSessionMessages([msg], true));
    } else {
      devElements.log.innerHTML = '<div class="dev-chat-item dev-chat-system" style="opacity: 0.5;">No message history.</div>';
    }
  } catch(err) {
    console.error('loadHistory caught err:', err);
    devElements.log.innerHTML = \`<div class="error-msg">Failed to load history</div>\`;
  }
};`;

const newLoadHistory = `App.devAgent.loadHistory = async function(sessionId, customLogContainer = null) {
  const targetLog = customLogContainer || devElements.log;
  if (!targetLog || !sessionId) return;
  try {
    targetLog.innerHTML = '<div class="loading-spinner">Loading chat history...</div>';
    const res = await App.api(\`/api/develop/devAgent/history?sessionId=\${sessionId}&limit=1000&_t=\${Date.now()}\`);
    targetLog.innerHTML = '';
    
    if (res.error) {
      console.error('[devAgent] loadHistory API error:', res.error);
      targetLog.innerHTML = \`<div class="error-msg">Could not load chats: \${res.error.message || res.error}</div>\`;
      return;
    }

    if (res.messages && res.messages.length > 0) {
      const reversed = res.messages.reverse();
      devState.chatHistory = reversed;
      
      reversed.forEach(msg => App.devAgent.renderSessionMessages([msg], true, targetLog));
      targetLog.scrollTop = targetLog.scrollHeight;
    } else {
      targetLog.innerHTML = '<div class="dev-chat-item dev-chat-system" style="opacity: 0.5;">No message history.</div>';
    }
  } catch(err) {
    console.error('loadHistory caught err:', err);
    targetLog.innerHTML = \`<div class="error-msg">Failed to load history</div>\`;
  }
};`;

replaceOrThrow("loadHistory rewrite", oldLoadHistory, newLoadHistory);

fs.writeFileSync('public/js/devAgent.js', js, 'utf8');
console.log("Rewrote loadHistory and loadSessions successfully");

