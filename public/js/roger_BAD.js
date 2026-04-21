// public/js/roger.js - CORRECTED AND COMPLETE FILE

window.App = window.App || {};
App.roger = {};

const rogerState = {
  activeSessionId: null,
  sessions: [],
  stagedFiles: []
};

const rogerElements = {
  log: null,
  form: null,
  input: null,
  sessionList: null,
  newSessionBtn: null,
  activeSessionTitle: null,
  fileInput: null,
  fileBtn: null,
  attachmentsContainer: null
};

App.roger.init = async function() {
  try {
    const cfgRes = await App.api('/api/develop/roger/config');
    if (cfgRes && cfgRes.url && cfgRes.anonKey && window.supabase) {
      window.supabaseClient = window.supabase.createClient(cfgRes.url, cfgRes.anonKey);
    }
  } catch(e) { console.error('Failed to load Supabase Realtime Config', e); }

  rogerElements.log = document.getElementById('rogerChatLog');
  rogerElements.form = document.getElementById('rogerChatForm');
  rogerElements.input = document.getElementById('rogerChatInput');
  rogerElements.sessionList = document.getElementById('rogerSessionList');
  rogerElements.newSessionBtn = document.getElementById('rogerNewSessionBtn');
  rogerElements.activeSessionTitle = document.getElementById('rogerActiveSessionTitle');

  rogerElements.fileInput = document.getElementById('rogerChatFile');
  rogerElements.fileBtn = document.getElementById('rogerFileTriggerBtn');
  rogerElements.attachmentsContainer = document.getElementById('rogerChatAttachmentsContainer');

  if (rogerElements.fileBtn) {
    rogerElements.fileBtn.addEventListener('click', () => {
      if (rogerElements.fileInput) rogerElements.fileInput.click();
    });
  }

  if (rogerElements.previewClearBtn) {
    rogerElements.previewClearBtn.addEventListener('click', () => {
      App.roger.clearStagedFile();
    });
  }

  if (rogerElements.fileInput) {
    rogerElements.fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        alert("File too large. Max 5MB.");
        e.target.value = '';
        return;
      }
      
      const fileId = Date.now().toString() + Math.random().toString().substring(2, 6);
      const reader = new FileReader();
      reader.onload = (evt) => {
        rogerState.stagedFiles.push({
          id: fileId,
          name: file.name,
          mime: file.type,
          base64: evt.target.result
        });
        App.roger.renderStagedFiles();
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });
  }

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

  const rogerCopySessionBtn = document.getElementById('rogerCopySessionBtn');
  if (rogerCopySessionBtn) {
    rogerCopySessionBtn.addEventListener('click', async () => {
      if (!rogerElements.log) return;
      const nodes = rogerElements.log.querySelectorAll('.roger-chat-bubble');
      let fullText = '';
      nodes.forEach(n => {
        const header = n.querySelector('.roger-chat-header strong');
        const author = header ? header.textContent : 'Unknown';
        const content = n.querySelector('.roger-chat-content');
        let text = content ? content.innerText : '';
        fullText += `[${author}]:\
${text}\
\
`;
      });
      try {
        await navigator.clipboard.writeText(fullText.trim());
        const svg = rogerCopySessionBtn.querySelector('svg');
        if (svg) {
          const originalHTML = svg.innerHTML;
          svg.innerHTML = '<polyline points=\\"20 6 9 17 4 12\\" fill=\\"none\\" stroke=\\"currentColor\\" stroke-width=\\"2\\"></polyline>';
          setTimeout(() => {
            svg.innerHTML = originalHTML;
          }, 2000);
        }
      } catch (err) {}
    });
  }

  const rogerSaveSessionBtn = document.getElementById('rogerSaveSessionBtn');
  if (rogerSaveSessionBtn) {
    rogerSaveSessionBtn.addEventListener('click', () => {
      if (!rogerElements.log) return;
      let sessionName = 'chat-session';
      if (rogerElements.activeSessionTitle && rogerElements.activeSessionTitle.textContent !== 'Loading Session...') {
        sessionName = rogerElements.activeSessionTitle.textContent.trim().replace(/[^a-z0-9_-]/gi, '_');
      }

      const nodes = rogerElements.log.querySelectorAll('.roger-chat-bubble');
      let fullText = `# ${rogerElements.activeSessionTitle.textContent}\
\
`;
      nodes.forEach(n => {
        const header = n.querySelector('.roger-chat-header strong');
        const author = header ? header.textContent : 'Unknown';
        const timeNode = n.querySelector('.chat-time');
        const timeStr = timeNode ? timeNode.textContent : '';
        const content = n.querySelector('.roger-chat-content');
        let text = content ? content.innerText : '';
        fullText += `### ${author} \\`${timeStr}\\`\
\
${text}\
\
---\
\
`;
      });
      
      try {
        const blob = new Blob([fullText.trim()], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${sessionName}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        const svg = rogerSaveSessionBtn.querySelector('svg');
        if (svg) {
          const originalHTML = svg.innerHTML;
          svg.innerHTML = '<polyline points=\\"20 6 9 17 4 12\\" fill=\\"none\\" stroke=\\"currentColor\\" stroke-width=\\"2\\"></polyline>';
          setTimeout(() => {
            svg.innerHTML = originalHTML;
          }, 2000);
        }
      } catch (err) {
        App.notify("Failed to save transcript: " + err, true);
      }
    });
  }

  if (rogerElements.newSessionBtn) {
    rogerElements.newSessionBtn.addEventListener('click', () => {
      const today = new Date().toISOString().split('T')[0];
      App.roger.createNewSession(`${today}_New_Discussion`);
    });
  }

  if (rogerElements.activeSessionTitle) {
    rogerElements.activeSessionTitle.addEventListener('click', () => {
      const titleEl = rogerElements.activeSessionTitle;
      if (titleEl.classList.contains('editing')) return;
      
      const session = rogerState.sessions.find(s => s.id === rogerState.activeSessionId);
      if (!session) return;
      
      const currentName = session.name;
      titleEl.innerHTML = `<input type=\\"text\\" class=\\"session-title-edit\\" value=\\"${currentName}\\" />`;
      titleEl.classList.add('editing');
      
      const input = titleEl.querySelector('input');
      input.focus();
      
      const commit = async () => {
        const newName = input.value.trim() || currentName;
        titleEl.classList.remove('editing');
        titleEl.textContent = newName;
        
        if (newName !== currentName) {
          session.name = newName;
          const li = rogerElements.sessionList.querySelector(`[data-session-id=\\"${session.id}\\"]`);
          if (li) li.textContent = newName;
          
          try {
            await App.api('/api/develop/roger/sessions', {
              method: 'PATCH',
              body: JSON.stringify({ sessionId: session.id, name: newName })
            });
          } catch(err) {
            App.notify("Failed to rename session: " + err, true);
          }
        }
      };
      
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          input.blur();
        }
      });
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
    rogerElements.sessionList.innerHTML = '<li style=\\"padding: 1rem; opacity: 0.7;\\">Loading...</li>';
    const res = await App.api('/api/develop/roger/sessions');
    rogerElements.sessionList.innerHTML = '';
    
    if (res.error) {
      rogerElements.sessionList.innerHTML = `<li class=\\"error-msg\\">Failed to load</li>`;
      return;
    }
    
    rogerState.sessions = res.sessions || res.data || [];
    
    if (rogerState.sessions.length === 0) {
      // First boot, create a default session implicitly
      const today = new Date().toISOString().split('T')[0];
      await App.roger.createNewSession(`${today}_New_Discussion`);
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
    rogerElements.sessionList.innerHTML = `<li class=\\"error-msg\\">Error.</li>`;
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
  li.textContent = session.name;
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
    rogerElements.activeSessionTitle.textContent = activeSessionData.name;
  }
  
  App.roger.loadHistory(sessionId);
  App.roger.initSupabaseRealtime(sessionId);
};

App.roger.loadHistory = async function(sessionId) {
  if (!rogerElements.log || !sessionId) return;
  try {
    rogerElements.log.innerHTML = '<div class=\\"loading-spinner\\">Loading chat history...</div>';
    rogerElements.input.disabled = true;
    const res = await App.api(`/api/develop/roger/history?sessionId=${sessionId}`);
    rogerElements.log.innerHTML = '';
    rogerElements.input.disabled = false;
    
    if (res.error) {
      rogerElements.log.innerHTML = `<div class=\\"error-msg\\">Could not load chats: ${res.error.message || res.error}</div>`;
      return;
    }
    
    const chats = res.chats || res.data || [];
    
    // Sniff historical sync arrays for `OBJ-002.2` compliance
    let maxVersion = 0;
    chats.forEach(chat => {
      const p = App.roger.parseTriAgent(chat.content);
      if (p && p.valid && p.data && p.data.state && p.data.state.state_version_id) {
         maxVersion = Math.max(maxVersion, Number(p.data.state.state_version_id));
      }
    });
    rogerState.localVersionId = Math.max(rogerState.localVersionId || 0, maxVersion);

    if (chats.length === 0) {
    } else {
      App.roger.activePendingCommand = null;
      chats.forEach(chat => {
        App.roger.appendChatNode(chat);
        
        // Track functional command resolutions
        const p = App.roger.parseTriAgent(chat.content);
        if (p && p.valid && p.data && p.data.payload) {
          if (p.data.payload.type === 'COMMAND' && chat.role === 'model') {
             App.roger.activePendingCommand = {
               hash: p.data.state.context_checksum,
               content: p.data.payload.content,
               version: p.data.state.state_version_id
             };
          } else if (p.data.payload.type === 'COMMAND' && chat.role === 'user') {
             try {
               const confObj = JSON.parse(p.data.payload.content);
               if (App.roger.activePendingCommand && confObj.commandhash === App.roger.activePendingCommand.hash) {
                 App.roger.activePendingCommand = null;
               }
             } catch(e) {}
          }
        }
      });
      App.roger.scrollToBottom();
      App.roger.generateGlossary();
    }
    
    // Evaluate constraints natively post-load
    App.roger.renderActiveCommand();
  } catch (err) {
    rogerElements.log.innerHTML = `<div class=\\"error-msg\\">Failed to load history.</div>`;
    rogerElements.input.disabled = false;
  }
};

App.roger.formatMarkdown = function(text) {
  if (!text) return '';
  
  // 1. Extract code blocks and replace with placeholders
  let chunks = [];
  let html = String(text).replace(/