'use strict';

window.App = window.App || {};
App.devAgent = {};

const devState = {
  activeSessionId: null,
  sessions: [],
  stagedFiles: []
};

const devElements = {
  log: null,
  form: null,
  input: null,
  sessionList: null,
  taskList: null,
  newSessionBtn: null,
  activeSessionTitle: null,
  fileInput: null,
  fileBtn: null,
  attachmentsContainer: null
};

App.devAgent.init = async function() {
  try {
    const cfgRes = await App.api('/api/develop/devAgent/config');
    if (cfgRes && cfgRes.data && cfgRes.data.url && cfgRes.data.anonKey && window.supabase) {
      window.supabaseClient = window.supabase.createClient(cfgRes.data.url, cfgRes.data.anonKey);
    }
  } catch(e) { console.error('Failed to load Supabase Realtime Config', e); }

  devElements.log = document.getElementById('devChatLog');
  devElements.form = document.getElementById('devChatForm');
  devElements.input = document.getElementById('devChatInput');
  devElements.sessionList = document.getElementById('devSessionList');
  devElements.taskList = document.getElementById('devTaskList');
  devElements.newSessionBtn = document.getElementById('devNewSessionBtn');
  devElements.activeSessionTitle = document.getElementById('devActiveSessionTitle');

  devElements.fileInput = document.getElementById('devChatFile');
  devElements.fileBtn = document.getElementById('devFileTriggerBtn');
  devElements.attachmentsContainer = document.getElementById('devChatAttachmentsContainer');

  if (devElements.fileBtn) {
    devElements.fileBtn.addEventListener('click', () => {
      if (devElements.fileInput) devElements.fileInput.click();
    });
  }

  if (devElements.previewClearBtn) {
    devElements.previewClearBtn.addEventListener('click', () => {
      App.devAgent.clearStagedFile();
    });
  }

  if (devElements.fileInput) {
    devElements.fileInput.addEventListener('change', (e) => {
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
        devState.stagedFiles.push({
          id: fileId,
          name: file.name,
          mime: file.type,
          base64: evt.target.result
        });
        App.devAgent.renderStagedFiles();
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });
  }

  if (devElements.form) {
    devElements.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await App.devAgent.submitChat();
    });
    
    devElements.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        App.devAgent.submitChat();
      }
    });
  }

  const devCopySessionBtn = document.getElementById('devCopySessionBtn');
  if (devCopySessionBtn) {
    devCopySessionBtn.addEventListener('click', async () => {
      if (!devElements.log) return;
      const nodes = devElements.log.querySelectorAll('.dev-chat-bubble');
      let fullText = '';
      nodes.forEach(n => {
        const header = n.querySelector('.dev-chat-header strong');
        const author = header ? header.textContent : 'Unknown';
        const content = n.querySelector('.dev-chat-content');
        let text = content ? content.innerText : '';
        fullText += `[${author}]:\n${text}\n\n`;
      });
      try {
        await navigator.clipboard.writeText(fullText.trim());
        const svg = devCopySessionBtn.querySelector('svg');
        if (svg) {
          const originalHTML = svg.innerHTML;
          svg.innerHTML = '<polyline points="20 6 9 17 4 12" fill="none" stroke="currentColor" stroke-width="2"></polyline>';
          setTimeout(() => {
            svg.innerHTML = originalHTML;
          }, 2000);
        }
      } catch (err) {}
    });
  }

  const devSaveSessionBtn = document.getElementById('devSaveSessionBtn');
  if (devSaveSessionBtn) {
    devSaveSessionBtn.addEventListener('click', () => {
      if (!devElements.log) return;
      let sessionName = 'chat-session';
      if (devElements.activeSessionTitle && devElements.activeSessionTitle.textContent !== 'Loading Session...') {
        sessionName = devElements.activeSessionTitle.textContent.trim().replace(/[^a-z0-9_-]/gi, '_');
      }

      const nodes = devElements.log.querySelectorAll('.dev-chat-bubble');
      let fullText = `# ${devElements.activeSessionTitle.textContent}\n\n`;
      nodes.forEach(n => {
        const header = n.querySelector('.dev-chat-header strong');
        const author = header ? header.textContent : 'Unknown';
        const timeNode = n.querySelector('.chat-time');
        const timeStr = timeNode ? timeNode.textContent : '';
        const content = n.querySelector('.dev-chat-content');
        let text = content ? content.innerText : '';
        fullText += `### ${author} \`${timeStr}\`\n\n${text}\n\n---\n\n`;
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
        
        const svg = devSaveSessionBtn.querySelector('svg');
        if (svg) {
          const originalHTML = svg.innerHTML;
          svg.innerHTML = '<polyline points="20 6 9 17 4 12" fill="none" stroke="currentColor" stroke-width="2"></polyline>';
          setTimeout(() => {
            svg.innerHTML = originalHTML;
          }, 2000);
        }
      } catch (err) {
        App.notify("Failed to save transcript: " + err, true);
      }
    });
  }

  if (devElements.newSessionBtn) {
    devElements.newSessionBtn.addEventListener('click', () => {
      const today = new Date().toISOString().split('T')[0];
      App.devAgent.createNewSession(`${today}_New_Discussion`);
    });
  }

  if (devElements.activeSessionTitle) {
    devElements.activeSessionTitle.addEventListener('click', () => {
      const titleEl = devElements.activeSessionTitle;
      if (titleEl.classList.contains('editing')) return;
      
      const session = devState.sessions.find(s => s.id === devState.activeSessionId);
      if (!session) return;
      
      const currentName = session.name;
      titleEl.innerHTML = `<input type="text" class="session-title-edit" value="${currentName}" />`;
      titleEl.classList.add('editing');
      
      const input = titleEl.querySelector('input');
      input.focus();
      
      const commit = async () => {
        const newName = input.value.trim() || currentName;
        titleEl.classList.remove('editing');
        titleEl.textContent = newName;
        
        if (newName !== currentName) {
          session.name = newName;
          const li = devElements.sessionList.querySelector(`[data-session-id="${session.id}"]`);
          if (li) li.textContent = newName;
          
          try {
            await App.api('/api/develop/devAgent/sessions', {
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
    if (pageId === 'devAgentPage') {
      App.devAgent.loadSessions();
      App.devAgent.loadTasks();
    }
  };
};

App.devAgent.loadTasks = async function() {
  if (!devElements.taskList) return;
  try {
    devElements.taskList.innerHTML = '<li style="padding: 1rem; opacity: 0.7;">Loading...</li>';
    const res = await window.supabaseClient
      .from('dev_tasks')
      .select('*')
      .neq('status', 'completed')
      .order('created_at', { ascending: false });
      
    devElements.taskList.innerHTML = '';
    
    if (res.error) {
      devElements.taskList.innerHTML = `<li class="error-msg">Failed to load tasks</li>`;
      return;
    }
    
    const tasks = res.data || [];
    
    if (tasks.length === 0) {
      devElements.taskList.innerHTML = '<li class="dev-session-item" style="color: #666; font-style: italic;">No active tasks.</li>';
      return;
    }

    tasks.forEach(task => {
      const li = document.createElement('li');
      li.className = 'dev-session-item';
      li.dataset.taskId = task.id;
      // Truncate title
      const shortTitle = task.title.length > 25 ? task.title.substring(0,25) + '...' : task.title;
      li.innerHTML = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--accent); margin-right:6px;"></span> ${shortTitle}`;
      li.addEventListener('click', () => {
        App.devAgent.openTaskEditor(task.id);
      });
      devElements.taskList.appendChild(li);
    });
  } catch (err) {
    devElements.taskList.innerHTML = `<li class="error-msg">Error executing tasks table logic.</li>`;
  }
};

App.devAgent.loadSessions = async function() {
  if (!devElements.sessionList) return;
  try {
    devElements.sessionList.innerHTML = '<li style="padding: 1rem; opacity: 0.7;">Loading...</li>';
    const res = await App.api('/api/develop/devAgent/sessions');
    devElements.sessionList.innerHTML = '';
    
    if (res.error) {
      devElements.sessionList.innerHTML = `<li class="error-msg">Failed to load</li>`;
      return;
    }
    
    devState.sessions = res.sessions || res.data || [];
    
    if (devState.sessions.length === 0) {
      // First boot, create a default session implicitly
      const today = new Date().toISOString().split('T')[0];
      await App.devAgent.createNewSession(`${today}_New_Discussion`);
      return;
    }

    devState.sessions.forEach(session => App.devAgent.appendSessionNode(session));
    
    // Auto-select latest session if none is active
    if (!devState.activeSessionId && devState.sessions.length > 0) {
      App.devAgent.selectSession(devState.sessions[0].id);
    } else if (devState.activeSessionId) {
      App.devAgent.selectSession(devState.activeSessionId);
    }
  } catch (err) {
    devElements.sessionList.innerHTML = `<li class="error-msg">Error.</li>`;
  }
};

App.devAgent.createNewSession = async function(name = 'New Discussion') {
  try {
    const res = await App.api('/api/develop/devAgent/sessions', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    const sessionData = res.session || res.data;
    if (sessionData) {
      devState.sessions.unshift(sessionData);
      // Re-render
      devElements.sessionList.innerHTML = '';
      devState.sessions.forEach(s => App.devAgent.appendSessionNode(s));
      App.devAgent.selectSession(sessionData.id);
    }
  } catch (e) {
    alert("Could not create session: " + e.message);
  }
};

App.devAgent.appendSessionNode = function(session) {
  if (!devElements.sessionList) return;
  const li = document.createElement('li');
  li.className = 'dev-session-item';
  li.dataset.sessionId = session.id;
  li.textContent = session.name;
  if (session.id === devState.activeSessionId) {
    li.classList.add('active');
  }
  
  li.addEventListener('click', () => {
    App.devAgent.selectSession(session.id);
  });
  
  devElements.sessionList.appendChild(li);
};

App.devAgent.selectSession = function(sessionId) {
  devState.activeSessionId = sessionId;
  
  // Close the Friction Editor natively if it happens to be masking the screen
  if (App.devAgentFriction && typeof App.devAgentFriction.closeEditor === 'function') {
    App.devAgentFriction.closeEditor();
  }
  
  // Highlight UI
  if (devElements.sessionList) {
    const items = devElements.sessionList.querySelectorAll('.dev-session-item');
    items.forEach(el => {
      if (Number(el.dataset.sessionId) === sessionId) el.classList.add('active');
      else el.classList.remove('active');
    });
  }
  
  const activeSessionData = devState.sessions.find(s => s.id === sessionId);
  if (activeSessionData && devElements.activeSessionTitle) {
    devElements.activeSessionTitle.textContent = activeSessionData.name;
  }
  
  App.devAgent.loadHistory(sessionId);
  App.devAgent.initSupabaseRealtime(sessionId);
};

App.devAgent.loadHistory = async function(sessionId) {
  if (!devElements.log || !sessionId) return;
  try {
    devElements.log.innerHTML = '<div class="loading-spinner">Loading chat history...</div>';
    devElements.input.disabled = true;
    const res = await App.api(`/api/develop/devAgent/history?sessionId=${sessionId}`);
    devElements.log.innerHTML = '';
    devElements.input.disabled = false;
    
    if (res.error) {
      devElements.log.innerHTML = `<div class="error-msg">Could not load chats: ${res.error.message || res.error}</div>`;
      return;
    }
    
    const chats = res.chats || res.data || [];
    
    // Sniff historical sync arrays for `OBJ-002.2` compliance
    let maxVersion = 0;
    chats.forEach(chat => {
      const p = App.devAgent.parseTriAgent(chat.content);
      if (p && p.valid && p.data && p.data.state && p.data.state.state_version_id) {
         maxVersion = Math.max(maxVersion, Number(p.data.state.state_version_id));
      }
    });
    devState.localVersionId = Math.max(devState.localVersionId || 0, maxVersion);

    if (chats.length === 0) {
    } else {
      App.devAgent.activePendingCommand = null;
      chats.forEach(chat => {
        App.devAgent.appendChatNode(chat);
        
        // Track functional command resolutions
        const p = App.devAgent.parseTriAgent(chat.content);
        if (p && p.valid && p.data && p.data.payload) {
          if (p.data.payload.type === 'COMMAND' && chat.role === 'model') {
             App.devAgent.activePendingCommand = {
               hash: p.data.state.context_checksum,
               content: p.data.payload.content,
               version: p.data.state.state_version_id
             };
          } else if (p.data.payload.type === 'COMMAND' && chat.role === 'user') {
             try {
               const confObj = JSON.parse(p.data.payload.content);
               if (App.devAgent.activePendingCommand && confObj.commandhash === App.devAgent.activePendingCommand.hash) {
                 App.devAgent.activePendingCommand = null;
               }
             } catch(e) {}
          }
        }
      });
      App.devAgent.scrollToBottom();
      App.devAgent.generateGlossary();
    }
    
    // Evaluate constraints natively post-load
    App.devAgent.renderActiveCommand();
  } catch (err) {
    devElements.log.innerHTML = `<div class="error-msg">Failed to load history.</div>`;
    devElements.input.disabled = false;
  }
};

App.devAgent.formatMarkdown = function(text) {
  if (!text) return '';
  
  // 1. Extract code blocks and replace with placeholders
  let chunks = [];
  let html = String(text).replace(/```(?:[a-z0-9]*)?\n([\s\S]*?)```/gi, (match, rawCodeBlock) => {
    let unescapedCodeBlock = rawCodeBlock.replace(/^>\s?/gm, '');
    let index = chunks.length;
    chunks.push(unescapedCodeBlock);
    return `@@@CODEBLOCK${index}@@@`;
  });

  // 2. Escape all remaining text globally (user text outside codeblocks)
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 3. Process markdown formatting for bold, emphasis, inline code, and block quotes
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
  html = html.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
  
  // 4. Replace linebreaks outside of blocks
  html = html.replace(/\n/g, '<br/>');

  // 4.5 Bind State Version anchors to allow interactive routing
  const versionRegex = /\b(?:(?:state_?)?version_?id|version|commandhash)(?:\\n|\s|<br\s*\/?>|"|'|&quot;)*:(?:\\n|\s|<br\s*\/?>|"|'|&quot;)*([\w\d]+)/gi;
  html = html.replace(versionRegex, '<a href="#devChatVersion_$1" class="dev-version-link" onclick="App.devAgent.scrollToVersion(\'$1\'); return false;">$&</a>');

  // 5. Restore code blocks, but now we format them properly with our UI wrapper
  html = html.replace(/@@@CODEBLOCK(\d+)@@@/g, (match, i) => {
    const codeBlock = chunks[parseInt(i)];
    let filename = 'code.txt';
    const lines = codeBlock.split('\n');
    for (const line of lines) {
      const matchFile = line.match(/\/\/\s*FILE:\s*([^\s]+)/i) || line.match(/\/\/\s*TARGET FILE:\s*([^\s]+)/i);
      if (matchFile) {
        filename = matchFile[1].trim();
        break;
      }
    }
    const encoded = btoa(unescape(encodeURIComponent(codeBlock)));
    let escapedCode = codeBlock
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
      
    // Apply Version binding to text within code blocks 
    escapedCode = escapedCode.replace(versionRegex, '<a href="#devChatVersion_$1" class="dev-version-link" onclick="App.devAgent.scrollToVersion($1); return false;">$&</a>');

    return `<div class="code-block-wrapper" style="position:relative; margin: 0.5rem 0;">
      <div class="dev-code-actions">
        <button class="dev-copy-btn" title="Copy Code" data-content="${encoded}" onclick="App.devAgent.copyCodeBlock(this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
          </svg>
        </button>
        <button class="dev-code-save-btn" title="Save File" data-filename="${filename}" data-content="${encoded}" onclick="App.devAgent.saveCodeBlock(this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
            <polyline points="17 21 17 13 7 13 7 21"></polyline>
            <polyline points="7 3 7 8 15 8"></polyline>
          </svg>
        </button>
      </div>
      <pre style="margin:0;"><code>${escapedCode}</code></pre>
    </div>`;
  });

  return html;
};

App.devAgent.copyCodeBlock = async function(btn) {
  const encoded = btn.getAttribute('data-content');
  if (!encoded) return;
  
  try {
    const rawCodeBlock = decodeURIComponent(escape(atob(encoded)));
    await navigator.clipboard.writeText(rawCodeBlock);
    
    // Provide a visual checkmark feedback
    const svg = btn.querySelector('svg');
    if (svg) {
      const originalHTML = svg.innerHTML;
      svg.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
      setTimeout(() => {
        svg.innerHTML = originalHTML;
      }, 2000);
    }
  } catch(e) {
    console.error("Failed to decode and copy code block:", e);
  }
};

App.devAgent.saveCodeBlock = function(btn) {
  const filename = btn.getAttribute('data-filename') || 'code.txt';
  const encoded = btn.getAttribute('data-content');
  if (!encoded) return;
  
  try {
    const rawCodeBlock = decodeURIComponent(escape(atob(encoded)));
    const blob = new Blob([rawCodeBlock], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch(e) {
    console.error("Failed to decode and save file:", e);
    alert("Could not save the file.");
  }
};

App.devAgent.appendChatNode = function(chat) {
  
  if (!devElements.log) return;
  
  if (chat.status === 'processing') {
    const spinner = document.createElement('div');
    spinner.className = 'dev-chat-bubble-wrapper ' + chat.role;
    spinner.id = 'devChatNode_' + chat.id;
    spinner.dataset.status = 'processing';
    spinner.innerHTML = `
      <div class="dev-chat-avatar ${chat.role}" style="background-image: url('/images/${chat.role}.png');"></div>
      <div class="dev-chat-content-col">
        <div class="dev-chat-bubble ${chat.role} loading">Agent is processing objective...</div>
      </div>
    `;
    devElements.log.appendChild(spinner);
    return;
  }

  if (devElements.log.querySelector('.empty-state')) {
    devElements.log.innerHTML = '';
  }

  const wrapper = document.createElement('div');
  wrapper.className = `dev-chat-bubble-wrapper ${chat.role}`;
  if (chat.id) wrapper.id = 'devChatNode_' + chat.id;
  
  const avatar = document.createElement('div');
  avatar.className = `dev-chat-avatar ${chat.role}`;
  if (chat.role === 'user') {
    avatar.style.backgroundImage = 'url("/images/mentor.png")';
  } else if (chat.role === 'roger') {
    avatar.style.backgroundImage = 'url("/images/roger.png")';
  } else if (chat.role === 'antigravity') {
    avatar.style.backgroundImage = 'url("/images/antigravity.png")'; // Fix the ext from svg to png
  }

  const contentCol = document.createElement('div');
  contentCol.className = 'dev-chat-content-col';
  
  const bubble = document.createElement('div');
  bubble.className = `dev-chat-bubble ${chat.role}`;
  if (chat.status === 'failed') {
    bubble.style.border = '2px solid #ef4444';
    bubble.style.backgroundColor = '#fef2f2';
    bubble.style.color = '#dc2626';
    bubble.style.fontWeight = 'bold';
  }

  const header = document.createElement('div');
  header.className = 'dev-chat-header';
  
  let author = 'Unknown';
  if (chat.role === 'user') author = 'Mentor';
  if (chat.role === 'roger') author = '@DevAgent';
  if (chat.role === 'antigravity') author = '@antigravity';

  const dateStr = chat.created_at ? new Date(chat.created_at).toLocaleString() : new Date().toLocaleString();
  
  if (chat.role === 'user' && chat.id) {
    bubble.dataset.rawContent = encodeURIComponent(chat.content);
  }

  let editBtnHTML = '';
  if (chat.role === 'user' && chat.id) {
    editBtnHTML = `
      <button class="dev-copy-btn" onclick="App.devAgent.editChat(${chat.id}, this);" title="Edit Message" style="margin-right: 4px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      </button>
    `;
  }

  const copyBtnId = `copyChat_${chat.id || Math.random().toString(36).substr(2, 9)}`;
  header.innerHTML = `
    <div><strong>${author}</strong> <span class="chat-time">${dateStr}</span></div>
    <div class="dev-copy-btn-container">
      ${editBtnHTML}
      <button id="${copyBtnId}" class="dev-copy-btn" title="Copy Message">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
        </svg>
      </button>
    </div>
  `;
  
  const content = document.createElement('div');
  content.className = 'dev-chat-content';

  let parsedTriAgent = App.devAgent.parseTriAgent(chat.content);

  if (parsedTriAgent && !parsedTriAgent.valid) {
    if (chat.content && chat.content.includes('"state"')) {
       App.devAgent.appendChatNode({
         role: 'roger',
         content: `**SYSTEM NOTICE / DESYNC EVENT:** TriAgent Schema Validation explicitly failed. ${parsedTriAgent.error}`,
         created_at: new Date().toISOString()
       });
    }
    parsedTriAgent = null; // Revert to generic markdown handler below
  } else if (parsedTriAgent) {
    parsedTriAgent = parsedTriAgent.data;
  }

  if (parsedTriAgent) {
    if (parsedTriAgent.state && parsedTriAgent.state.state_version_id) {
       bubble.id = 'devChatVersion_' + parsedTriAgent.state.state_version_id;
    }
    const rawContentHTML = App.devAgent.formatMarkdown(parsedTriAgent.payload.content);
    let finalUI = rawContentHTML;
    
    // Robust parsing for case-insensitive and safe property access
    const payloadType = String(parsedTriAgent.payload?.type || '').toUpperCase();
    const sourceAgent = String(parsedTriAgent.state?.source_agent || '').toUpperCase();
    const payloadContentString = String(parsedTriAgent.payload?.content || '');

    // UI/UX Distinction: Mandatory card encapsulation for Auth streams
    if ( (payloadType === 'COMMAND' && sourceAgent === '@ROGER') || 
         (payloadType === 'QUERY' && sourceAgent === '@ANTIGRAVITY' && payloadContentString.toLowerCase().includes('awaiting confirmation')) ) {
      finalUI = `
        <div style="background:rgba(245, 158, 11, 0.1); border: 2px solid var(--accent-warning); padding:1rem; border-radius:var(--radius-md); box-shadow: 0 4px 12px rgba(245,158,11,0.15);">
          <div style="display:flex; align-items:center; gap: 8px; margin-bottom: 0.75rem; border-bottom:1px solid rgba(245, 158, 11, 0.3); padding-bottom:0.5rem;">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-warning)" stroke-width="2" width="24" height="24">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <strong style="color:var(--accent-warning); font-size:1.1rem; letter-spacing: 0.5px;">AUTHORIZATION REQUIRED</strong>
          </div>
          <div style="font-size:0.95rem; line-height: 1.5; color: var(--text-dark);">
            ${rawContentHTML}
          </div>
          <div style="display:flex; gap:10px; margin-top:1rem; padding-top:0.75rem; border-top:1px solid rgba(245, 158, 11, 0.3);">
            <button type="button" class="primary-btn" onclick="App.devAgent.sendProtocolAction('CONFIRM', '${parsedTriAgent.state.context_checksum}', this)" style="background:#10b981; border:none; flex:1; padding:0.75rem;">CONFIRM COMMAND</button>
            <button type="button" class="secondary-btn" onclick="App.devAgent.sendProtocolAction('DENY', '${parsedTriAgent.state.context_checksum}', this)" style="flex:1; padding:0.75rem; background:rgba(0,0,0,0.05);">DENY COMMAND</button>
          </div>
        </div>
      `;
    }
    
    const versionStr = `v${parsedTriAgent.state.state_version_id}`;
    header.innerHTML = `
      <div style="flex: 1; display:flex; align-items:center;"><strong>${author}</strong> <span class="chat-time" style="margin-left: 0.5rem">${dateStr}</span></div>
      <div style="flex: 1; text-align: center; color: rgba(0,0,0,0.5); font-family: monospace; font-weight: bold; font-size: 0.85rem;">[${versionStr}]</div>
      <div style="flex: 1; justify-content: flex-end;" class="dev-copy-btn-container">
        ${editBtnHTML}
        <button id="${copyBtnId}" class="dev-copy-btn" title="Copy Message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
          </svg>
        </button>
      </div>
    `;

    content.innerHTML = finalUI + `
      <details style="margin-top:12px; font-size:0.75rem; color:#888; background:rgba(0,0,0,0.02); padding:4px 8px; border-radius:4px;">
        <summary style="cursor:pointer; user-select:none;">TriAgentState Protocol Wrapper (${versionStr})</summary>
        <pre style="margin-top:5px; white-space:pre-wrap; word-break:break-all; tab-size:2;">${JSON.stringify(parsedTriAgent.state, null, 2)}</pre>
      </details>
    `;
    
    // Rewrite internal chat.content so the summary extractor later on uses human-readable text
    chat.content = parsedTriAgent.payload.content; 
  } else {
    content.innerHTML = App.devAgent.formatMarkdown(chat.content);
  }

  if (chat.attachment_url) {
    const attachWrap = document.createElement('div');
    attachWrap.className = 'dev-chat-attachment';
    if (chat.attachment_url.includes('image/') || chat.attachment_url.match(/\.(jpeg|jpg|gif|png|webp|svg)$/i)) {
      attachWrap.innerHTML = `<a href="${chat.attachment_url}" target="_blank"><img src="${chat.attachment_url}" style="max-width:100%; border-radius:4px; margin-top:8px; display:block;" alt="Attached" /></a>`;
    } else {
      attachWrap.innerHTML = `<a href="${chat.attachment_url}" target="_blank" download="attachment" class="primary-btn" style="display:inline-block; margin-top:8px;">Download File attachment</a>`;
    }
    content.appendChild(attachWrap);
  }

  let rawText = (chat.content || '').replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
  let plainTextSummary = rawText;
  const sentenceMatches = rawText.match(/.*?[.!?](?:\s|$)/g);
  if (sentenceMatches && sentenceMatches.length > 0) {
    plainTextSummary = sentenceMatches.slice(0, 2).join(' ').trim();
  } else {
    plainTextSummary = rawText.substring(0, 150) + (rawText.length > 150 ? '...' : '');
  }
  
  if (plainTextSummary.length > 280) {
    plainTextSummary = plainTextSummary.substring(0, 280).trim() + '...';
  } else if (plainTextSummary.length < rawText.length) {
    plainTextSummary += '...';
  }

  const summaryNode = document.createElement('div');
  summaryNode.className = 'dev-chat-summary';
  summaryNode.style.cursor = 'pointer';
  summaryNode.onclick = function(e) {
    e.preventDefault();
    const b = this.closest('.dev-chat-bubble');
    b.classList.add('expanded');
    this.closest('.dev-chat-bubble-wrapper').classList.add('expanded');
  };
  summaryNode.innerHTML = `<strong>${dateStr} - ${author}:</strong> ${plainTextSummary} <span style="color:#2563eb; margin-left:8px; font-family:monospace; font-weight:bold;">[+]</span>`;

  // Make header clickable to collapse
  header.style.cursor = 'pointer';
  header.onclick = function(e) {
    if (e.target.closest('button') || e.target.closest('a')) return; // ignore button clicks
    e.preventDefault();
    const b = this.closest('.dev-chat-bubble');
    b.classList.remove('expanded');
    this.closest('.dev-chat-bubble-wrapper').classList.remove('expanded');
  };
  
  // Inject the [-] into the header display
  header.firstElementChild.innerHTML = `<span style="color:#2563eb; margin-right:8px; font-family:monospace; font-weight:bold;">[-]</span>` + header.firstElementChild.innerHTML;

  bubble.appendChild(summaryNode);
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
  
  devElements.log.appendChild(wrapper);

  const copyBtn = bubble.querySelector(`#${copyBtnId}`);
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(chat.content || '');
        const svg = copyBtn.querySelector('svg');
        if (svg) {
          const originalHTML = svg.innerHTML;
          svg.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
          setTimeout(() => {
            svg.innerHTML = originalHTML;
          }, 2000);
        }
      } catch (err) {}
    });
  }

  // Trigger dynamic glossary sync
  if (App.devAgent.glossaryTimeout) clearTimeout(App.devAgent.glossaryTimeout);
  App.devAgent.glossaryTimeout = setTimeout(App.devAgent.generateGlossary, 600);
};

App.devAgent.scrollToBottom = function() {
  if (devElements.log) {
    devElements.log.scrollTop = devElements.log.scrollHeight;
  }
};


App.devAgent.initSupabaseRealtime = function(sessionId) {
  if (!window.supabaseClient) {
    console.warn('Supabase Realtime not initialized. Ensure URL and ANON_KEY are in settings.');
    return;
  }
  if (App.devAgent.realtimeChannel) {
    App.devAgent.realtimeChannel.unsubscribe();
  }
  
  App.devAgent.realtimeChannel = window.supabaseClient.channel('dev_chats_' + sessionId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'agent_messages', filter: 'session_id=eq.' + sessionId },
      (payload) => {
        const chat = payload.new;
        if (!chat) return;
        const existingNode = document.getElementById('devChatNode_' + chat.id);
        if (existingNode) {
          if (chat.status !== 'processing' && existingNode.dataset.status === 'processing') {
            existingNode.outerHTML = '';
            App.devAgent.appendChatNode(chat);
            App.devAgent.scrollToBottom();
          }
        } else {
           App.devAgent.appendChatNode(chat);
           App.devAgent.scrollToBottom();
        }
      }
    )
    .subscribe();
};


App.devAgent.renderStagedFiles = function() {
  if (!devElements.attachmentsContainer) return;
  devElements.attachmentsContainer.innerHTML = '';
  if (devState.stagedFiles.length === 0) return;
  
  devState.stagedFiles.forEach(fileObj => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.fontSize = '0.85rem';
    row.style.color = '#6b7280';
    
    row.innerHTML = `
      <span>Attached:</span>
      <a href="${fileObj.base64}" download="${fileObj.name}" target="_blank" style="text-decoration:underline; color: var(--accent);">${fileObj.name}</a>
      <a href="#" title="Remove attachment" style="color: #ef4444; font-size:18px; font-weight:bold; cursor:pointer; text-decoration:none; margin-left:8px;" onclick="event.preventDefault(); App.devAgent.removeStagedFile('${fileObj.id}');">&times;</a>
    `;
    devElements.attachmentsContainer.appendChild(row);
  });
};

App.devAgent.parseTriAgent = function(rawText) {
  if (!rawText) return null;
  try {
    let maybeJson = String(rawText).trim();
    if (maybeJson.startsWith('```json')) maybeJson = maybeJson.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    else if (maybeJson.startsWith('```')) maybeJson = maybeJson.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(maybeJson);
    
    if (parsed && parsed.payload && parsed.payload.content) {
      
      // Auto-unwrap if the LLM double-encapsulated the JSON schema inside payload.content
      try {
         let innerText = String(parsed.payload.content).trim();
         if (innerText.startsWith('```json')) innerText = innerText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
         else if (innerText.startsWith('```')) innerText = innerText.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
         
         const innerParsed = JSON.parse(innerText);
         if (innerParsed && innerParsed.payload && innerParsed.payload.content) {
             parsed.state = { ...parsed.state, ...innerParsed.state };
             parsed.payload = { ...parsed.payload, ...innerParsed.payload };
         }
      } catch(e3) {
         // Malformed inner double-wrapped payload. Fallback to extracting the content string manually.
         let innerText = String(parsed.payload.content).trim();
         if (innerText.includes('"state"') && innerText.includes('"payload"')) {
            const innerContentMatch = innerText.match(/"content"\s*:\s*([\s\S]*)/);
            if (innerContentMatch) {
               let innerContentStr = innerContentMatch[1].trim();
               // Strip trailing JSON array brackets, rogue concatenated payloads, etc
               innerContentStr = innerContentStr.replace(/\"\s*\}?\s*\}?\s*\]?\s*(```)?\s*(,\s*\{[\s\S]*)?$/g, '');
               if (innerContentStr.startsWith('"')) innerContentStr = innerContentStr.substring(1);
               innerContentStr = innerContentStr.replace(/\\n/g, '\n').replace(/\\"/g, '"');
               parsed.payload.content = innerContentStr;
            }
         }
      }

      // We only care about payload content rendering.
      // Strict state schema missing property validation is bypassed here to allow rendering older chat histories.
      return { valid: true, data: parsed };
    }
  } catch (e) {
    // Regex Recovery for structurally broken JSON (unescaped quotes/newlines inside payload.content)
    try {
      let rawStr = String(rawText).trim();
      const contentMatch = rawStr.match(/"content"\s*:\s*([\s\S]*)/);
      if (contentMatch) {
         let contentStr = contentMatch[1].trim();
         // Strip the trailing JSON brackets, quotes, trailing array comma payloads, and Markdown ticks
         contentStr = contentStr.replace(/\"\s*\}?\s*\}?\s*\]?\s*(```)?\s*(,\s*\{[\s\S]*)?$/g, '');
         if (contentStr.startsWith('"')) contentStr = contentStr.substring(1);
         // Unescape standard JSON text escapes since we bypassed parser
         contentStr = contentStr.replace(/\\n/g, '\n').replace(/\\"/g, '"');
         
         return {
            valid: true,
            data: {
               state: { state_version_id: 1, session_id: '0' },
               payload: { type: 'RESPONSE', content: contentStr }
            }
         };
      }
    } catch(regexErr) {}
  }
  return null; // Not valid JSON, fallback to generic Markdown text formatting
};

App.devAgent.scrollToVersion = function(versionId) {
  const el = document.getElementById('devChatVersion_' + versionId);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('highlight-ping');
    void el.offsetWidth; // trigger layout reflow to restart animation sequence
    el.classList.add('highlight-ping');
  } else {
    console.warn(`Chat version ID ${versionId} not yet loaded or missing from current DOM.`);
  }
};

App.devAgent.editChat = function(chatId, btn) {
  const wrapper = btn.closest('.dev-chat-bubble');
  const contentDiv = wrapper.querySelector('.dev-chat-content');
  if (!contentDiv) return;

  const rawEncoded = wrapper.dataset.rawContent || '';
  const rawString = decodeURIComponent(rawEncoded);

  // Unwrap TriAgent if applicable for editing pure text
  let editableText = rawString;
  const p = App.devAgent.parseTriAgent(rawString);
  if (p && p.valid && p.data.payload) {
    editableText = p.data.payload.content || '';
  }

  contentDiv.dataset.originalHtml = contentDiv.innerHTML;
  
  contentDiv.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:8px;">
      <textarea id="editChatText_${chatId}" style="width:100%; min-height:100px; padding:10px; border-radius:4px; border:1px solid #ccc; background:var(--bg-input); color:var(--text-primary); font-family:inherit;">${editableText}</textarea>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
         <button class="secondary-btn" onclick="const p=this.closest('.dev-chat-content'); p.innerHTML=p.dataset.originalHtml;">Cancel</button>
         <button class="primary-btn" onclick="App.devAgent.saveChatEdit(${chatId}, this)">Save Changes</button>
      </div>
    </div>
  `;
};

App.devAgent.saveChatEdit = async function(chatId, btn) {
  const wrapper = btn.closest('.dev-chat-bubble');
  const textarea = document.getElementById(`editChatText_${chatId}`);
  if (!textarea) return;
  const newText = textarea.value.trim();

  const rawEncoded = wrapper.dataset.rawContent || '';
  const rawString = decodeURIComponent(rawEncoded);
  let finalPayloadStr = newText;

  const p = App.devAgent.parseTriAgent(rawString);
  if (p && p.valid && p.data) {
     p.data.payload.content = newText;
     p.data.state.state_version_id = Math.max(Number(p.data.state.state_version_id) + 1, ++devState.localVersionId);
     finalPayloadStr = JSON.stringify(p.data, null, 2);
  }

  btn.disabled = true;
  btn.textContent = 'Saving...';
  
  const res = await App.api('/api/develop/devAgent/chat', {
    method: 'PATCH',
    body: JSON.stringify({ chatId: chatId, content: finalPayloadStr })
  });

  if (res.error) {
     alert("Failed to edit chat: " + (res.error.message || res.error));
     btn.disabled = false;
     btn.textContent = 'Save Changes';
     return;
  }
  
  // Reload history to properly re-sync the DOM
  App.devAgent.loadHistory(devState.activeSessionId);
};

App.devAgent.renderActiveCommand = function() {
  const overlay = document.getElementById('rogerPersistentOverlay');
  const chatForm = document.getElementById('devChatForm');
  if (!overlay || !chatForm) return;

  if (App.devAgent.activePendingCommand) {
    const rawContentHTML = App.devAgent.formatMarkdown(App.devAgent.activePendingCommand.content);
    overlay.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" width="24" height="24">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
        <strong style="color:var(--accent-warning); letter-spacing: 0.5px;">PENDING PROVISIONAL COMMAND</strong>
      </div>
      <div style="font-size:0.9rem; line-height: 1.4; color: var(--text-dark); max-height:150px; overflow-y:auto; border-left:3px solid var(--accent-warning); padding-left:12px; margin-bottom:16px;">
        ${rawContentHTML}
      </div>
      <div style="display:flex; gap:10px; border-top:1px solid #eee; padding-top:16px;">
        <button type="button" class="primary-btn" onclick="App.devAgent.sendProtocolAction('CONFIRM', '${App.devAgent.activePendingCommand.hash}', this)" style="background:#10b981; border:none; flex:1;">CONFIRM</button>
        <button type="button" class="secondary-btn" onclick="App.devAgent.sendProtocolAction('DENY', '${App.devAgent.activePendingCommand.hash}', this)" style="flex:1; background:rgba(0,0,0,0.05);">DENY</button>
      </div>
    `;
    overlay.classList.remove('hidden');
    chatForm.classList.add('dev-overlay-active');
  } else {
    overlay.innerHTML = '';
    overlay.classList.add('hidden');
    chatForm.classList.remove('dev-overlay-active');
  }
};

App.devAgent.removeStagedFile = function(id) {
  devState.stagedFiles = devState.stagedFiles.filter(f => f.id !== id);
  App.devAgent.renderStagedFiles();
};

App.devAgent.clearStagedFiles = function() {
  devState.stagedFiles = [];
  if (devElements.fileInput) devElements.fileInput.value = '';
  App.devAgent.renderStagedFiles();
};

App.devAgent.sendProtocolAction = function(actionType, commandHash, btnEl) {
  if (!devState.activeSessionId) return;
  
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = actionType === 'CONFIRM' ? 'Confirmed ✓' : 'Denied X';
    btnEl.style.opacity = '0.7';
    btnEl.style.cursor = 'not-allowed';
  }

  devState.localVersionId = devState.localVersionId || 1;
  const triAgentPayload = JSON.stringify({
    state: {
      session_id: devState.activeSessionId,
      state_version_id: ++devState.localVersionId,
      timestamp: new Date().toISOString(),
      source_agent: '@Human',
      target_agent: '@Antigravity',
      active_objective_id: 'ACTIVE-SESSION',
      context_checksum: 'N/A'
    },
    payload: {
      type: 'COMMAND',
      content: JSON.stringify({ action: actionType, commandhash: commandHash })
    }
  }, null, 2);

  const payload = { 
    sessionId: devState.activeSessionId, 
    content: triAgentPayload 
  };

  App.api('/api/develop/devAgent/chat', {
    method: 'POST',
    body: JSON.stringify(payload)
  }).then(res => {
    if (res.data?.userChat) {
      App.devAgent.appendChatNode(res.data.userChat);
    }
    if (res.data?.devChat) {
      App.devAgent.appendChatNode(res.data.devChat);

    }
    App.devAgent.scrollToBottom();
  });
};

App.devAgent.submitChat = async function() {
  const text = devElements.input?.value.trim();
  if (!text && devState.stagedFiles.length === 0) return; // Do nothing if no input
  if (!devState.activeSessionId) return;

  const staged = devState.stagedFiles[0] || null;

  devElements.input.value = '';
  devElements.input.disabled = true;
  if (devElements.fileBtn) devElements.fileBtn.disabled = true;
  App.devAgent.clearStagedFiles();

  devState.localVersionId = devState.localVersionId || 1;
  const triAgentPayload = JSON.stringify({
    state: {
      session_id: devState.activeSessionId,
      state_version_id: ++devState.localVersionId,
      timestamp: new Date().toISOString(),
      source_agent: '@Human',
      target_agent: '@Roger',
      active_objective_id: 'ACTIVE-SESSION',
      context_checksum: 'N/A'
    },
    payload: {
      type: 'QUERY',
      content: text
    }
  }, null, 2);

  try {
    const payload = { 
      sessionId: devState.activeSessionId, 
      content: triAgentPayload 
    };
    if (staged) {
      payload.attachmentBase64 = staged.base64;
      payload.attachmentMime = staged.mime;
      payload.attachmentName = staged.name;
    }

    const res = await App.api('/api/develop/devAgent/chat', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    console.log("========== DIAGNOSTIC DIAGNOSTIC ==========");
    console.log("RAW DISPATCH URL: /api/develop/devAgent/chat");
    console.log("PAYLOAD OUT:", payload);
    console.log("RAW RESPONSE OBJECT:", JSON.parse(JSON.stringify(res)));
    console.log("has res.data?", !!res.data);
    console.log("res.data contents:", res.data);
    console.log("isArray(res.data.replies)?", res.data ? Array.isArray(res.data.replies) : false);
    console.log("==========================================");

    if (res.error) {
      App.devAgent.appendChatNode({
        role: 'roger', // Use a generic agent role for system errors
        status: 'failed',
        content: `API Error: ${res.error.message || res.error}`,
        created_at: new Date().toISOString()
      });
    } else if (res.data) {
       // The backend should return the user's message for persistence.
       if (res.data.userChat) {
         console.log("appending userChat");
         App.devAgent.appendChatNode(res.data.userChat);
       }

       // Handle new multi-response format from agents.
       if (Array.isArray(res.data.replies) && res.data.replies.length > 0) {
         console.log("appending replies array of len", res.data.replies.length);
         res.data.replies.forEach(chat => App.devAgent.appendChatNode(chat));
       } 
       // Fallback for older, single-response format.
       else if (res.data.devChat) {
         console.log("appending devChat legacy fallback");
         App.devAgent.appendChatNode(res.data.devChat);
       } else {
         console.log("CRITICAL WARN: missing replies array OR devChat legacy node!");
       }
    } else {
      console.log("CRITICAL WARN: no res.error AND no res.data!!!");
    }
  } catch (err) {
    // Display client-side or network errors directly in the chat UI.
    App.devAgent.appendChatNode({
      role: 'roger',
      status: 'failed',
      content: `Client-side Error: ${err.message || 'An unknown error occurred.'}`,
      created_at: new Date().toISOString()
    });
    App.notify("Request failed: " + (err.message || err), true);
  } finally {
    devElements.input.disabled = false;
    if (devElements.fileBtn) devElements.fileBtn.disabled = false;
    devElements.input.focus();
    App.devAgent.scrollToBottom();
  }
};


document.addEventListener('DOMContentLoaded', () => {
  App.devAgent.init();
});

App.devAgent.searchHits = [];
App.devAgent.currentSearchIndex = -1;

App.devAgent.applySearchHighlights = function(term) {
  const log = document.getElementById('devChatLog');
  if (!log) return;
  
  // 1. Clear existing highlights
  const existingMatches = log.querySelectorAll('mark.dev-search-match');
  existingMatches.forEach(mark => {
    const parent = mark.parentNode;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });

  App.devAgent.searchHits = [];
  App.devAgent.currentSearchIndex = -1;
  const countSpan = document.getElementById('devSearchCount');

  if (!term || !term.trim()) {
    if (countSpan) countSpan.textContent = '';
    return;
  }

  const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')})`, 'gi');

  // 2. Highlight text nodes safely
  const walker = document.createTreeWalker(log, NodeFilter.SHOW_TEXT, null, false);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  textNodes.forEach(node => {
    if (node.parentNode && (node.parentNode.nodeName === 'MARK' || node.parentNode.nodeName === 'SCRIPT')) return;
    
    const text = node.nodeValue;
    if (text.match(regex)) {
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      let match;
      regex.lastIndex = 0;
      
      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }
        const mark = document.createElement('mark');
        mark.className = 'dev-search-match';
        mark.textContent = match[0];
        fragment.appendChild(mark);
        App.devAgent.searchHits.push(mark);
        lastIndex = regex.lastIndex;
      }
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }
      
      node.parentNode.replaceChild(fragment, node);
    }
  });

  const hitCount = App.devAgent.searchHits.length;
  if (countSpan) {
    countSpan.textContent = `${hitCount} match${hitCount !== 1 ? 'es' : ''}`;
    if (hitCount > 0) {
      countSpan.style.cursor = 'pointer';
      countSpan.style.textDecoration = 'underline';
      countSpan.style.color = '#2563eb';
      countSpan.title = 'Click to cycle to the next result';
      countSpan.onclick = function() {
        App.devAgent.focusSearchHit(App.devAgent.currentSearchIndex + 1);
      };
    } else {
      countSpan.style.cursor = 'default';
      countSpan.style.textDecoration = 'none';
      countSpan.style.color = 'inherit';
      countSpan.title = '';
      countSpan.onclick = null;
    }
  }
  
  // Automatically focus the first hit if any exist
  if (hitCount > 0) {
    App.devAgent.focusSearchHit(0);
  }
};

App.devAgent.focusSearchHit = function(index) {
  if (App.devAgent.searchHits.length === 0) return;
  
  if (App.devAgent.currentSearchIndex >= 0 && App.devAgent.currentSearchIndex < App.devAgent.searchHits.length) {
    App.devAgent.searchHits[App.devAgent.currentSearchIndex].classList.remove('active-match');
  }
  
  App.devAgent.currentSearchIndex = index % App.devAgent.searchHits.length;
  if (App.devAgent.currentSearchIndex < 0) {
    App.devAgent.currentSearchIndex += App.devAgent.searchHits.length;
  }
  
  const targetMark = App.devAgent.searchHits[App.devAgent.currentSearchIndex];
  
  const bubble = targetMark.closest('.dev-chat-bubble');
  if (bubble) {
    bubble.classList.add('expanded');
    const wrapper = targetMark.closest('.dev-chat-bubble-wrapper');
    if (wrapper) wrapper.classList.add('expanded');
  }

  targetMark.classList.add('active-match');
  setTimeout(() => {
    targetMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 50);
};

const rogerStopWords = new Set(['i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', "you're", "you've", "you'll", "you'd", 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', "she's", 'her', 'hers', 'herself', 'it', "it's", 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', "that'll", 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', "don't", 'should', "should've", 'now', 'd', 'll', 'm', 'o', 're', 've', 'y', 'ain', 'aren', "aren't", 'couldn', "couldn't", 'didn', "didn't", 'doesn', "doesn't", 'hadn', "hadn't", 'hasn', "hasn't", 'haven', "haven't", 'isn', "isn't", 'ma', 'mightn', "mightn't", 'mustn', "mustn't", 'needn', "needn't", 'shan', "shan't", 'shouldn', "shouldn't", 'wasn', "wasn't", 'weren', "weren't", 'won', "won't", 'wouldn', "wouldn't"]);

App.devAgent.generateGlossary = function() {
  const log = document.getElementById('devChatLog');
  const select = document.getElementById('devGlossarySelect');
  if (!log || !select) return;

  const rawText = log.innerText || log.textContent;
  const words = rawText.match(/\b[a-zA-Z]{4,}\b/g) || [];
  
  const frequency = {};
  words.forEach(w => {
    const lower = w.toLowerCase();
    if (!rogerStopWords.has(lower)) {
      frequency[lower] = (frequency[lower] || 0) + 1;
    }
  });

  const uniqueTerms = Object.keys(frequency).sort((a, b) => frequency[b] - frequency[a]);
  const topTerms = uniqueTerms.slice(0, 40).sort();

  select.innerHTML = '<option value="" disabled selected>Keywords</option>';
  topTerms.forEach(term => {
    const opt = document.createElement('option');
    opt.value = term;
    opt.textContent = term;
    select.appendChild(opt);
  });
};

document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('devToggleCollapseBtn');
  const searchInput = document.getElementById('devSearchInput');
  const log = document.getElementById('devChatLog');
  const glossarySelect = document.getElementById('devGlossarySelect');

  if (toggleBtn && log) {
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      log.classList.toggle('dev-collapsed-mode');
      
      const expandedNodes = log.querySelectorAll('.expanded');
      expandedNodes.forEach(node => node.classList.remove('expanded'));
    });
  }

  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        App.devAgent.applySearchHighlights(e.target.value);
      }, 300);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (App.devAgent.searchHits.length > 0) {
          const step = e.shiftKey ? -1 : 1;
          App.devAgent.focusSearchHit(App.devAgent.currentSearchIndex + step);
        }
      }
    });
  }

  if (glossarySelect && searchInput) {
    glossarySelect.addEventListener('change', (e) => {
      const term = e.target.value;
      if (term) {
        searchInput.value = term;
        App.devAgent.applySearchHighlights(term);
      }
    });
  }

  const testBtn = document.getElementById('devTestBtn');
  if (testBtn) {
    testBtn.addEventListener('click', App.devAgent.testAiConnection);
  }

  const newTaskBtn = document.getElementById('devNewTaskBtn');
  if (newTaskBtn) {
    newTaskBtn.addEventListener('click', App.devAgent.promptNewTask);
  }
});

App.devAgent.promptNewTask = async function() {
  const title = prompt("Enter a title for the new Task:");
  if (!title) return;
  
  try {
    if (!window.supabaseClient) throw new Error("Database not connected.");
    
    // Default task attributes using 'todo' and standard metadata
    const { error } = await window.supabaseClient
      .from('dev_tasks')
      .insert([{ 
        title: title, 
        status: 'todo',
        priority: 'medium',
        assignee: 'mentor'
      }]);
      
    if (error) throw error;
    App.notify("Task created securely.");
    App.devAgent.loadTasks(); // Automatically refresh the Tasks list in the left panel
  } catch (err) {
    App.notify("Error creating task: " + err.message, true);
  }
};

App.devAgent.testAiConnection = async function() {
  const btn = document.getElementById('devTestBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Testing...';
  }
  
  try {
    const res = await App.api('/api/develop/devAgent/test', {
      method: 'GET'
    });
    
    if (res.error) {
       App.notify("AI Setup Failed: " + (res.error.message || res.error), true);
    } else {
       App.notify("AI Connection OK! " + JSON.stringify(res.data), false);
    }
  } catch(e) {
    App.notify("Request failed: " + e.message, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Test Connection';
    }
  }
};

// ==========================================
// HITL Friction Logger Implementation
// ==========================================
App.devAgentFriction = {
  elements: {
    form: document.getElementById('devFrictionForm'),
    input: document.getElementById('devFrictionInput'),
    list: document.getElementById('devFrictionList'),
    sidebar: document.getElementById('devFrictionSidebar'),
    toggleBtn: document.getElementById('devFrictionToggleBtn'),
    closeBtn: document.getElementById('devFrictionCloseBtn'),
    leftSidebarList: document.getElementById('devFrictionSidebarList'),
    editorPanelWrapper: document.getElementById('devFrictionEditorPanel'),
    
    // Editor Form Elements
    editorForm: document.getElementById('devFrictionEditorForm'),
    editTitle: document.getElementById('rogerEditFrictionTitle'),
    editSection: document.getElementById('rogerEditFrictionSection'),
    editDesc: document.getElementById('rogerEditFrictionDesc'),
    editStatus: document.getElementById('rogerEditFrictionStatus'),
    editResNotes: document.getElementById('rogerEditFrictionResolution'),
    editorCloseBtn: document.getElementById('rogerCloseFrictionEditorBtn'),
    
    activeLogId: null
  },

  toggleDrawer() {
    if (this.elements.sidebar) {
      this.elements.sidebar.classList.toggle('visible');
    }
  },

  async loadLogs() {
    if (!this.elements.list) return;
    try {
      if (!window.supabaseClient) {
        console.warn("Supabase client not initialized yet.");
        return;
      }
      
      const { data, error } = await window.supabaseClient
        .from('dev_friction_logs')
        .select('id, title, section, description, status, resolution_notes')
        .neq('status', 'documented')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      if (this.elements.list) this.elements.list.innerHTML = '';
      if (this.elements.leftSidebarList) this.elements.leftSidebarList.innerHTML = '';

      if (data && data.length > 0) {
        data.forEach(log => {
          // Right drawer generic render
          const li = document.createElement('li');
          li.className = 'dev-friction-item ' + (log.status === 'resolved' ? 'resolved' : '');
          li.innerHTML = `
            <div><strong>${log.title || 'New Friction Log'}</strong> - ${log.status.toUpperCase()}</div>
            <div style="font-size:0.8rem; margin-top:0.2rem;">${log.description.substring(0,60)}...</div>
          `;
          if (this.elements.list) this.elements.list.appendChild(li);

          // Left Sidebar render with inline editing structure
          if (this.elements.leftSidebarList) {
            const sideLi = document.createElement('li');
            sideLi.className = 'dev-session-item' + (this.elements.activeLogId === log.id ? ' active' : '');
            
            const titleSpan = document.createElement('span');
            titleSpan.className = 'session-title';
            titleSpan.textContent = log.title || 'New Friction Log';
            
            // Inline editing via double click
            titleSpan.addEventListener('dblclick', (e) => {
              e.stopPropagation();
              titleSpan.contentEditable = true;
              titleSpan.focus();
              titleSpan.classList.add('editing');
            });
            
            const saveTitle = async () => {
              titleSpan.contentEditable = false;
              titleSpan.classList.remove('editing');
              const newTitle = titleSpan.textContent.trim();
              if (newTitle && newTitle !== log.title) {
                try {
                  await window.supabaseClient.from('dev_friction_logs').update({title: newTitle}).eq('id', log.id);
                  if (this.elements.activeLogId === log.id && this.elements.editTitle) {
                    this.elements.editTitle.value = newTitle;
                  }
                } catch(err) { console.error("Inline edit failed", err); }
              }
            };
            titleSpan.addEventListener('blur', saveTitle);
            titleSpan.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') { e.preventDefault(); saveTitle(); }
            });

            sideLi.appendChild(titleSpan);
            
            // Click to open editor
            sideLi.addEventListener('click', (e) => {
              // Ignore if we are currently editing the title
              if (titleSpan.classList.contains('editing')) return;
              document.querySelectorAll('#devFrictionSidebarList .dev-session-item').forEach(el => el.classList.remove('active'));
              sideLi.classList.add('active');
              this.openEditor(log);
            });
            
            this.elements.leftSidebarList.appendChild(sideLi);
          }
        });
      } else {
        if (this.elements.list) this.elements.list.innerHTML = '<li class="dev-friction-item"><div style="color: #666; font-style: italic; text-align: center;">No unresolved friction logs.</div></li>';
        if (this.elements.leftSidebarList) this.elements.leftSidebarList.innerHTML = '<li class="dev-session-item" style="color: #666; font-style: italic;">Nothing logged.</li>';
      }
    } catch (e) {
      console.error("Failed to load friction logs", e);
      if (this.elements.leftSidebarList) {
        this.elements.leftSidebarList.innerHTML = `<li class="dev-session-item" style="color: red; font-size:0.75rem;">Error: ${e.message}</li>`;
      }
    }
  },

  async submitLog(e) {
    e.preventDefault();
    const txt = this.elements.input.value.trim();
    if (!txt) return;

    try {
      if (!window.supabaseClient) throw new Error("Database disconnected.");

      const { data, error } = await window.supabaseClient
        .from('dev_friction_logs')
        .insert([{ description: txt, status: 'open' }]);

      if (!error) {
        this.elements.input.value = '';
        App.notify("Friction Logged successfully.");
        this.loadLogs();
        
        // Auto-ping Roger with context
        const chatInput = document.getElementById('devChatInput');
        if (chatInput && App.devAgent && App.devAgent.submitChat) {
          chatInput.value = `### SYSTEM NOTIFICATION
@Human has logged a new HITL Friction Intervention: "${txt}". 
Please analyze this friction boundary and formulate an architectural plan to engineer this bottleneck out of the system.`;
          App.devAgent.submitChat();
        }
        
      } else {
        App.notify(error.message || "Failed to log friction", true);
      }
    } catch (err) {
      App.notify("Error: " + err.message, true);
    }
  },

  openEditor(log) {
    this.elements.activeLogId = log.id;
    // Hide standard chat internals
    const chatLog = document.getElementById('devChatLog');
    const chatForm = document.getElementById('devChatForm');
    const header = document.querySelector('.dev-chat-main-header');
    
    if (chatLog) chatLog.classList.add('hidden');
    if (chatForm) chatForm.classList.add('hidden');
    if (header) header.classList.add('hidden');
    
    // Show editor panel
    if (this.elements.editorPanelWrapper) this.elements.editorPanelWrapper.classList.remove('hidden');
    
    // Seed fields
    if (this.elements.editTitle) this.elements.editTitle.value = log.title || '';
    if (this.elements.editSection) this.elements.editSection.value = log.section || 'Acquire';
    if (this.elements.editDesc) this.elements.editDesc.value = log.description || '';
    if (this.elements.editStatus) this.elements.editStatus.value = log.status || 'open';
    if (this.elements.editResNotes) this.elements.editResNotes.value = log.resolution_notes || '';
  },

  closeEditor() {
    this.elements.activeLogId = null;
    const chatLog = document.getElementById('devChatLog');
    const chatForm = document.getElementById('devChatForm');
    const header = document.querySelector('.dev-chat-main-header');
    
    if (chatLog) chatLog.classList.remove('hidden');
    if (chatForm) chatForm.classList.remove('hidden');
    if (header) header.classList.remove('hidden');
    
    if (this.elements.editorPanelWrapper) this.elements.editorPanelWrapper.classList.add('hidden');
    
    // Reset selection styling
    document.querySelectorAll('#devFrictionSidebarList .dev-session-item').forEach(el => el.classList.remove('active'));
    App.devAgent.scrollToBottom();
  },

  async saveEditorChanges(e) {
    e.preventDefault();
    if (!this.elements.activeLogId) return;
    
    const payload = {
      title: this.elements.editTitle.value.trim(),
      section: this.elements.editSection ? this.elements.editSection.value : 'Acquire',
      description: this.elements.editDesc.value.trim(),
      status: this.elements.editStatus.value,
      resolution_notes: this.elements.editResNotes.value.trim()
    };
    
    try {
      const { error } = await window.supabaseClient
        .from('dev_friction_logs')
        .update(payload)
        .eq('id', this.elements.activeLogId);
        
      if (!error) {
        App.notify("Friction Log updated successfully.");
        this.loadLogs(); // Refresh lists
        
        if (payload.status === 'documented') {
           this.closeEditor(); // Jump out if documented out of scope
        }
      } else {
        App.notify(error.message || "Failed to update", true);
      }
    } catch(err) {
      App.notify("Error: " + err.message, true);
    }
  },

  init() {
    // Re-bind elements in case it's called late
    this.elements.form = document.getElementById('devFrictionForm');
    this.elements.input = document.getElementById('devFrictionInput');
    this.elements.list = document.getElementById('devFrictionList');
    this.elements.sidebar = document.getElementById('devFrictionSidebar');
    this.elements.toggleBtn = document.getElementById('devFrictionToggleBtn');
    this.elements.closeBtn = document.getElementById('devFrictionCloseBtn');
    
    this.elements.leftSidebarList = document.getElementById('devFrictionSidebarList');
    this.elements.editorPanelWrapper = document.getElementById('devFrictionEditorPanel');
    this.elements.editorForm = document.getElementById('devFrictionEditorForm');
    this.elements.editTitle = document.getElementById('rogerEditFrictionTitle');
    this.elements.editSection = document.getElementById('rogerEditFrictionSection');
    this.elements.editDesc = document.getElementById('rogerEditFrictionDesc');
    this.elements.editStatus = document.getElementById('rogerEditFrictionStatus');
    this.elements.editResNotes = document.getElementById('rogerEditFrictionResolution');
    this.elements.editorCloseBtn = document.getElementById('rogerCloseFrictionEditorBtn');
    
    if (this.elements.form) {
      this.elements.form.addEventListener('submit', (e) => this.submitLog(e));
    }
    if (this.elements.toggleBtn) {
      this.elements.toggleBtn.addEventListener('click', () => this.toggleDrawer());
    }
    if (this.elements.closeBtn) {
      this.elements.closeBtn.addEventListener('click', () => this.toggleDrawer());
    }
    if (this.elements.editorForm) {
      this.elements.editorForm.addEventListener('submit', (e) => this.saveEditorChanges(e));
    }
    if (this.elements.editorCloseBtn) {
      this.elements.editorCloseBtn.addEventListener('click', () => this.closeEditor());
    }
    
    // Bind to the Dev Agent page show event to refresh logs
    document.addEventListener('pageChanged', (e) => {
      if (e.detail && e.detail.pageId === 'devAgentPage') {
        this.loadLogs();
      }
    });

    // Initial load
    this.loadLogs();
  }
};

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => App.devAgentFriction.init(), 1000);
  
  // Bind collapsible sidebar headers strictly to chevron icons
  const toggles = document.querySelectorAll('.sidebar-section-chevron');
  toggles.forEach(toggle => {
    toggle.addEventListener('click', () => {
      const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', !isExpanded);
      const targetId = toggle.getAttribute('aria-controls');
      const targetList = document.getElementById(targetId);
      if (targetList) {
        targetList.style.display = isExpanded ? 'none' : 'block';
      }
    });
  });

  // Bind sidebar nav links mapper
  const navLinks = document.querySelectorAll('.sidebar-nav-link');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const navItem = link.getAttribute('data-nav');
      if (navItem === 'tasks') App.devAgent.showTaskBrowser();
      else if (navItem === 'forum') App.devAgent.restoreChatPanel();
    });
  });
  
  // Tasks binding
  const devCloseTaskEditorBtn = document.getElementById('devCloseTaskEditorBtn');
  if (devCloseTaskEditorBtn) {
    devCloseTaskEditorBtn.addEventListener('click', App.devAgent.closeTaskEditor);
  }
  const devTaskEditorForm = document.getElementById('devTaskEditorForm');
  if (devTaskEditorForm) {
    devTaskEditorForm.addEventListener('submit', App.devAgent.saveTaskEditor);
  }
});

App.devAgent.restoreChatPanel = function() {
  document.getElementById('devChatLog').classList.remove('hidden');
  document.getElementById('devChatForm').classList.remove('hidden');
  const overlay = document.getElementById('devPersistentOverlay'); if(overlay) overlay.classList.add('hidden');
  const fricPanel = document.getElementById('devFrictionEditorPanel'); if(fricPanel) fricPanel.classList.add('hidden');
  const taskPanel = document.getElementById('devTaskEditorPanel'); if(taskPanel) taskPanel.classList.add('hidden');
  const browserPanel = document.getElementById('devTaskBrowserPanel'); if(browserPanel) browserPanel.classList.add('hidden');
};

App.devAgent.showTaskBrowser = async function() {
  document.getElementById('devChatLog').classList.add('hidden');
  document.getElementById('devChatForm').classList.add('hidden');
  const overlay = document.getElementById('devPersistentOverlay'); if(overlay) overlay.classList.add('hidden');
  const fricPanel = document.getElementById('devFrictionEditorPanel'); if(fricPanel) fricPanel.classList.add('hidden');
  const editorPanel = document.getElementById('devTaskEditorPanel'); if(editorPanel) editorPanel.classList.add('hidden');
  
  const browserPanel = document.getElementById('devTaskBrowserPanel');
  if (browserPanel) browserPanel.classList.remove('hidden');
  
  const tbody = document.getElementById('devTaskBrowserTable');
  if (tbody && window.supabaseClient) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:1rem; opacity:0.7;">Loading tasks...</td></tr>';
    const { data: tasks, error } = await window.supabaseClient.from('dev_tasks').select('*').order('created_at', { ascending: false });
    if (error) {
      tbody.innerHTML = '<tr><td colspan="5">Failed to fetch.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    tasks.forEach(t => {
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => App.devAgent.openTaskEditor(t.id));
      tr.innerHTML = `
        <td style="text-align:left;"><strong>${t.title}</strong></td>
        <td>${t.status}</td>
        <td>${t.priority}</td>
        <td>${t.assignee}</td>
        <td>${new Date(t.created_at).toLocaleDateString()}</td>
      `;
      tbody.appendChild(tr);
    });
  }
};

App.devAgent.openTaskEditor = async function(taskId) {
  document.getElementById('devChatLog').classList.add('hidden');
  document.getElementById('devChatForm').classList.add('hidden');
  const overlay = document.getElementById('devPersistentOverlay'); if(overlay) overlay.classList.add('hidden');
  const fricPanel = document.getElementById('devFrictionEditorPanel'); if(fricPanel) fricPanel.classList.add('hidden');
  const browserPanel = document.getElementById('devTaskBrowserPanel'); if(browserPanel) browserPanel.classList.add('hidden');
  
  const panel = document.getElementById('devTaskEditorPanel');
  if (panel) {
    panel.classList.remove('hidden');
    document.getElementById('devTaskEditorHeader').textContent = 'Loading...';
    try {
      const { data: log, error } = await window.supabaseClient.from('dev_tasks').select('*').eq('id', taskId).single();
      if (error) throw error;
      document.getElementById('devTaskEditorHeader').textContent = 'Edit Task';
      document.getElementById('devEditTaskId').value = log.id;
      document.getElementById('devEditTaskTitle').value = log.title || '';
      document.getElementById('devEditTaskDesc').value = log.description || '';
      let statusSel = document.getElementById('devEditTaskStatus'); if(statusSel) statusSel.value = log.status || 'todo';
      let prioSel = document.getElementById('devEditTaskPriority'); if(prioSel) prioSel.value = log.priority || 'medium';
      let assgSel = document.getElementById('devEditTaskAssignee'); if(assgSel) assgSel.value = log.assignee || 'mentor';
    } catch (e) {
      document.getElementById('devTaskEditorHeader').textContent = 'Task Unresolved';
    }
  }
};

App.devAgent.saveTaskEditor = async function(e) {
  e.preventDefault();
  const taskId = document.getElementById('devEditTaskId').value;
  if (!taskId) return;
  const payload = {
    title: document.getElementById('devEditTaskTitle').value,
    description: document.getElementById('devEditTaskDesc').value,
    status: document.getElementById('devEditTaskStatus') ? document.getElementById('devEditTaskStatus').value : 'todo',
    priority: document.getElementById('devEditTaskPriority') ? document.getElementById('devEditTaskPriority').value : 'medium',
    assignee: document.getElementById('devEditTaskAssignee') ? document.getElementById('devEditTaskAssignee').value : 'mentor',
  };
  try {
    const { error } = await window.supabaseClient.from('dev_tasks').update(payload).eq('id', taskId);
    if (error) throw error;
    App.notify('Task saved.', false);
    App.devAgent.loadTasks(); // refresh sidebar bounds
    App.devAgent.showTaskBrowser(); // switch panel back to list
  } catch (err) {
    App.notify('Failed to save task: ' + err.message, true);
  }
};

App.devAgent.closeTaskEditor = function() {
  document.getElementById('devTaskEditorPanel').classList.add('hidden');
  App.devAgent.restoreChatPanel();
};
