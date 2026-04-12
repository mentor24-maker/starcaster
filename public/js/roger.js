'use strict';

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

App.roger.init = function() {
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
        fullText += `[${author}]:\n${text}\n\n`;
      });
      try {
        await navigator.clipboard.writeText(fullText.trim());
        const svg = rogerCopySessionBtn.querySelector('svg');
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

  const rogerSaveSessionBtn = document.getElementById('rogerSaveSessionBtn');
  if (rogerSaveSessionBtn) {
    rogerSaveSessionBtn.addEventListener('click', () => {
      if (!rogerElements.log) return;
      let sessionName = 'chat-session';
      if (rogerElements.activeSessionTitle && rogerElements.activeSessionTitle.textContent !== 'Loading Session...') {
        sessionName = rogerElements.activeSessionTitle.textContent.trim().replace(/[^a-z0-9_-]/gi, '_');
      }

      const nodes = rogerElements.log.querySelectorAll('.roger-chat-bubble');
      let fullText = `# ${rogerElements.activeSessionTitle.textContent}\n\n`;
      nodes.forEach(n => {
        const header = n.querySelector('.roger-chat-header strong');
        const author = header ? header.textContent : 'Unknown';
        const timeNode = n.querySelector('.chat-time');
        const timeStr = timeNode ? timeNode.textContent : '';
        const content = n.querySelector('.roger-chat-content');
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
        
        const svg = rogerSaveSessionBtn.querySelector('svg');
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
          const li = rogerElements.sessionList.querySelector(`[data-session-id="${session.id}"]`);
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
  App.roger.initStream(sessionId);
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
    rogerElements.log.innerHTML = `<div class="error-msg">Failed to load history.</div>`;
    rogerElements.input.disabled = false;
  }
};

App.roger.formatMarkdown = function(text) {
  if (!text) return '';
  
  // 1. Extract code blocks and replace with placeholders
  let chunks = [];
  let html = String(text).replace(/```(?:[a-z0-9]*)?\n([\s\S]*?)```/gi, (match, rawCodeBlock) => {
    let unescapedCodeBlock = rawCodeBlock.replace(/^>\s?/gm, '');
    let index = chunks.length;
    chunks.push(unescapedCodeBlock);
    return `__CODEBLOCK_${index}__`;
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

  // 5. Restore code blocks, but now we format them properly with our UI wrapper
  html = html.replace(/__CODEBLOCK_(\d+)__/g, (match, i) => {
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
    const escapedCode = codeBlock
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return `<div class="code-block-wrapper" style="position:relative; margin: 0.5rem 0;">
      <div class="roger-code-actions">
        <button class="roger-copy-btn" title="Copy Code" data-content="${encoded}" onclick="App.roger.copyCodeBlock(this)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
          </svg>
        </button>
        <button class="roger-code-save-btn" title="Save File" data-filename="${filename}" data-content="${encoded}" onclick="App.roger.saveCodeBlock(this)">
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

App.roger.copyCodeBlock = async function(btn) {
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

App.roger.saveCodeBlock = function(btn) {
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

App.roger.appendChatNode = function(chat) {
  
  if (!rogerElements.log) return;
  
  if (chat.content === '[SYSTEM::QUEUED]') {
    const spinner = document.createElement('div');
    spinner.className = 'roger-chat-bubble-wrapper ' + chat.role;
    spinner.id = 'rogerChatNode_' + chat.id;
    spinner.dataset.status = 'queued';
    spinner.innerHTML = `
      <div class="roger-chat-avatar ${chat.role}" style="background-image: url('/images/${chat.role}.png');"></div>
      <div class="roger-chat-content-col">
        <div class="roger-chat-bubble ${chat.role} loading">Agent is processing objective...</div>
      </div>
    `;
    rogerElements.log.appendChild(spinner);
    return;
  }

  if (rogerElements.log.querySelector('.empty-state')) {
    rogerElements.log.innerHTML = '';
  }

  const wrapper = document.createElement('div');
  wrapper.className = `roger-chat-bubble-wrapper ${chat.role}`;
  if (chat.id) wrapper.id = 'rogerChatNode_' + chat.id;
  
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
  if (chat.role === 'user') author = 'Mentor';
  if (chat.role === 'roger') author = '@RogerThorson';
  if (chat.role === 'antigravity') author = '@antigravity';

  const dateStr = chat.created_at ? new Date(chat.created_at).toLocaleString() : new Date().toLocaleString();
  
  if (chat.role === 'user' && chat.id) {
    bubble.dataset.rawContent = encodeURIComponent(chat.content);
  }

  let editBtnHTML = '';
  if (chat.role === 'user' && chat.id) {
    editBtnHTML = `
      <button class="roger-copy-btn" onclick="App.roger.editChat(${chat.id}, this);" title="Edit Message" style="margin-right: 4px;">
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
    <div class="roger-copy-btn-container">
      ${editBtnHTML}
      <button id="${copyBtnId}" class="roger-copy-btn" title="Copy Message">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
        </svg>
      </button>
    </div>
  `;
  
  const content = document.createElement('div');
  content.className = 'roger-chat-content';

  let parsedTriAgent = App.roger.parseTriAgent(chat.content);

  if (parsedTriAgent && !parsedTriAgent.valid) {
    if (chat.content && chat.content.includes('"state"')) {
       App.roger.appendChatNode({
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
    const rawContentHTML = App.roger.formatMarkdown(parsedTriAgent.payload.content);
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
            <button type="button" class="primary-btn" onclick="App.roger.sendProtocolAction('CONFIRM', '${parsedTriAgent.state.context_checksum}', this)" style="background:#10b981; border:none; flex:1; padding:0.75rem;">CONFIRM COMMAND</button>
            <button type="button" class="secondary-btn" onclick="App.roger.sendProtocolAction('DENY', '${parsedTriAgent.state.context_checksum}', this)" style="flex:1; padding:0.75rem; background:rgba(0,0,0,0.05);">DENY COMMAND</button>
          </div>
        </div>
      `;
    }
    
    content.innerHTML = finalUI + `
      <details style="margin-top:12px; font-size:0.75rem; color:#888; background:rgba(0,0,0,0.02); padding:4px 8px; border-radius:4px;">
        <summary style="cursor:pointer; user-select:none;">TriAgentState Protocol Wrapper (v${parsedTriAgent.state.state_version_id})</summary>
        <pre style="margin-top:5px; white-space:pre-wrap; word-break:break-all; tab-size:2;">${JSON.stringify(parsedTriAgent.state, null, 2)}</pre>
      </details>
    `;
    
    // Rewrite internal chat.content so the summary extractor later on uses human-readable text
    chat.content = parsedTriAgent.payload.content; 
  } else {
    content.innerHTML = App.roger.formatMarkdown(chat.content);
  }

  if (chat.attachment_url) {
    const attachWrap = document.createElement('div');
    attachWrap.className = 'roger-chat-attachment';
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
  summaryNode.className = 'roger-chat-summary';
  summaryNode.style.cursor = 'pointer';
  summaryNode.onclick = function(e) {
    e.preventDefault();
    const b = this.closest('.roger-chat-bubble');
    b.classList.add('expanded');
    this.closest('.roger-chat-bubble-wrapper').classList.add('expanded');
  };
  summaryNode.innerHTML = `<strong>${dateStr} - ${author}:</strong> ${plainTextSummary} <span style="color:#2563eb; margin-left:8px; font-family:monospace; font-weight:bold;">[+]</span>`;

  // Make header clickable to collapse
  header.style.cursor = 'pointer';
  header.onclick = function(e) {
    if (e.target.closest('button') || e.target.closest('a')) return; // ignore button clicks
    e.preventDefault();
    const b = this.closest('.roger-chat-bubble');
    b.classList.remove('expanded');
    this.closest('.roger-chat-bubble-wrapper').classList.remove('expanded');
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
  
  rogerElements.log.appendChild(wrapper);

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
  if (App.roger.glossaryTimeout) clearTimeout(App.roger.glossaryTimeout);
  App.roger.glossaryTimeout = setTimeout(App.roger.generateGlossary, 600);
};

App.roger.scrollToBottom = function() {
  if (rogerElements.log) {
    rogerElements.log.scrollTop = rogerElements.log.scrollHeight;
  }
};


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


App.roger.renderStagedFiles = function() {
  if (!rogerElements.attachmentsContainer) return;
  rogerElements.attachmentsContainer.innerHTML = '';
  if (rogerState.stagedFiles.length === 0) return;
  
  rogerState.stagedFiles.forEach(fileObj => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.fontSize = '0.85rem';
    row.style.color = '#6b7280';
    
    row.innerHTML = `
      <span>Attached:</span>
      <a href="${fileObj.base64}" download="${fileObj.name}" target="_blank" style="text-decoration:underline; color: var(--accent);">${fileObj.name}</a>
      <a href="#" title="Remove attachment" style="color: #ef4444; font-size:18px; font-weight:bold; cursor:pointer; text-decoration:none; margin-left:8px;" onclick="event.preventDefault(); App.roger.removeStagedFile('${fileObj.id}');">&times;</a>
    `;
    rogerElements.attachmentsContainer.appendChild(row);
  });
};

App.roger.parseTriAgent = function(rawText) {
  if (!rawText) return null;
  try {
    let maybeJson = String(rawText).trim();
    if (maybeJson.startsWith('```json')) maybeJson = maybeJson.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    else if (maybeJson.startsWith('```')) maybeJson = maybeJson.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(maybeJson);
    if (parsed && parsed.state && parsed.payload) {
      if (!parsed.state.state_version_id || !parsed.state.session_id) {
         return { valid: false, error: 'Malformed TriAgentState JSON Schema detected. Missing core keys.' };
      }
      return { valid: true, data: parsed };
    }
    return null;
  } catch (e) {
    return null; // Not valid JSON, which is fine for generic text
  }
};

App.roger.editChat = function(chatId, btn) {
  const wrapper = btn.closest('.roger-chat-bubble');
  const contentDiv = wrapper.querySelector('.roger-chat-content');
  if (!contentDiv) return;

  const rawEncoded = wrapper.dataset.rawContent || '';
  const rawString = decodeURIComponent(rawEncoded);

  // Unwrap TriAgent if applicable for editing pure text
  let editableText = rawString;
  const p = App.roger.parseTriAgent(rawString);
  if (p && p.valid && p.data.payload) {
    editableText = p.data.payload.content || '';
  }

  contentDiv.dataset.originalHtml = contentDiv.innerHTML;
  
  contentDiv.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:8px;">
      <textarea id="editChatText_${chatId}" style="width:100%; min-height:100px; padding:10px; border-radius:4px; border:1px solid #ccc; background:var(--bg-input); color:var(--text-primary); font-family:inherit;">${editableText}</textarea>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
         <button class="secondary-btn" onclick="const p=this.closest('.roger-chat-content'); p.innerHTML=p.dataset.originalHtml;">Cancel</button>
         <button class="primary-btn" onclick="App.roger.saveChatEdit(${chatId}, this)">Save Changes</button>
      </div>
    </div>
  `;
};

App.roger.saveChatEdit = async function(chatId, btn) {
  const wrapper = btn.closest('.roger-chat-bubble');
  const textarea = document.getElementById(`editChatText_${chatId}`);
  if (!textarea) return;
  const newText = textarea.value.trim();

  const rawEncoded = wrapper.dataset.rawContent || '';
  const rawString = decodeURIComponent(rawEncoded);
  let finalPayloadStr = newText;

  const p = App.roger.parseTriAgent(rawString);
  if (p && p.valid && p.data) {
     p.data.payload.content = newText;
     p.data.state.state_version_id = Math.max(Number(p.data.state.state_version_id) + 1, ++rogerState.localVersionId);
     finalPayloadStr = JSON.stringify(p.data, null, 2);
  }

  btn.disabled = true;
  btn.textContent = 'Saving...';
  
  const res = await App.api('/api/develop/roger/chat', {
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
  App.roger.loadHistory(rogerState.activeSessionId);
};

App.roger.renderActiveCommand = function() {
  const overlay = document.getElementById('rogerPersistentOverlay');
  const chatForm = document.getElementById('rogerChatForm');
  if (!overlay || !chatForm) return;

  if (App.roger.activePendingCommand) {
    const rawContentHTML = App.roger.formatMarkdown(App.roger.activePendingCommand.content);
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
        <button type="button" class="primary-btn" onclick="App.roger.sendProtocolAction('CONFIRM', '${App.roger.activePendingCommand.hash}', this)" style="background:#10b981; border:none; flex:1;">CONFIRM</button>
        <button type="button" class="secondary-btn" onclick="App.roger.sendProtocolAction('DENY', '${App.roger.activePendingCommand.hash}', this)" style="flex:1; background:rgba(0,0,0,0.05);">DENY</button>
      </div>
    `;
    overlay.classList.remove('hidden');
    chatForm.classList.add('roger-overlay-active');
  } else {
    overlay.innerHTML = '';
    overlay.classList.add('hidden');
    chatForm.classList.remove('roger-overlay-active');
  }
};

App.roger.removeStagedFile = function(id) {
  rogerState.stagedFiles = rogerState.stagedFiles.filter(f => f.id !== id);
  App.roger.renderStagedFiles();
};

App.roger.clearStagedFiles = function() {
  rogerState.stagedFiles = [];
  if (rogerElements.fileInput) rogerElements.fileInput.value = '';
  App.roger.renderStagedFiles();
};

App.roger.sendProtocolAction = function(actionType, commandHash, btnEl) {
  if (!rogerState.activeSessionId) return;
  
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = actionType === 'CONFIRM' ? 'Confirmed ✓' : 'Denied X';
    btnEl.style.opacity = '0.7';
    btnEl.style.cursor = 'not-allowed';
  }

  rogerState.localVersionId = rogerState.localVersionId || 1;
  const triAgentPayload = JSON.stringify({
    state: {
      session_id: rogerState.activeSessionId,
      state_version_id: ++rogerState.localVersionId,
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
    sessionId: rogerState.activeSessionId, 
    content: triAgentPayload 
  };

  App.api('/api/develop/roger/chat', {
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
  });
};

App.roger.submitChat = async function() {
  const text = rogerElements.input?.value.trim();
  if (!text || !rogerState.activeSessionId) return;

  const staged = rogerState.stagedFiles[0] || null;

  rogerElements.input.value = '';
  rogerElements.input.disabled = true;
  if (rogerElements.fileBtn) rogerElements.fileBtn.disabled = true;
  App.roger.clearStagedFiles();

  rogerState.localVersionId = rogerState.localVersionId || 1;
  const triAgentPayload = JSON.stringify({
    state: {
      session_id: rogerState.activeSessionId,
      state_version_id: ++rogerState.localVersionId,
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
      alert("Agent Failed to Receive Message: " + (res.error.message || res.error));
    } else if (res.data?.userChat) {
       App.roger.appendChatNode(res.data.userChat);
       if (res.data.rogerChat) App.roger.appendChatNode(res.data.rogerChat);
       App.roger.scrollToBottom();
    }
  } catch (err) {
    App.notify("Fetch issue: " + (err.message || err), true);
  } finally {
    rogerElements.input.disabled = false;
    if (rogerElements.fileBtn) rogerElements.fileBtn.disabled = false;
    rogerElements.input.focus();
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.roger.init();
});

App.roger.searchHits = [];
App.roger.currentSearchIndex = -1;

App.roger.applySearchHighlights = function(term) {
  const log = document.getElementById('rogerChatLog');
  if (!log) return;
  
  // 1. Clear existing highlights
  const existingMatches = log.querySelectorAll('mark.roger-search-match');
  existingMatches.forEach(mark => {
    const parent = mark.parentNode;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });

  App.roger.searchHits = [];
  App.roger.currentSearchIndex = -1;
  const countSpan = document.getElementById('rogerSearchCount');

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
        mark.className = 'roger-search-match';
        mark.textContent = match[0];
        fragment.appendChild(mark);
        App.roger.searchHits.push(mark);
        lastIndex = regex.lastIndex;
      }
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }
      
      node.parentNode.replaceChild(fragment, node);
    }
  });

  const hitCount = App.roger.searchHits.length;
  if (countSpan) {
    countSpan.textContent = `${hitCount} match${hitCount !== 1 ? 'es' : ''}`;
    if (hitCount > 0) {
      countSpan.style.cursor = 'pointer';
      countSpan.style.textDecoration = 'underline';
      countSpan.style.color = '#2563eb';
      countSpan.title = 'Click to cycle to the next result';
      countSpan.onclick = function() {
        App.roger.focusSearchHit(App.roger.currentSearchIndex + 1);
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
    App.roger.focusSearchHit(0);
  }
};

App.roger.focusSearchHit = function(index) {
  if (App.roger.searchHits.length === 0) return;
  
  if (App.roger.currentSearchIndex >= 0 && App.roger.currentSearchIndex < App.roger.searchHits.length) {
    App.roger.searchHits[App.roger.currentSearchIndex].classList.remove('active-match');
  }
  
  App.roger.currentSearchIndex = index % App.roger.searchHits.length;
  if (App.roger.currentSearchIndex < 0) {
    App.roger.currentSearchIndex += App.roger.searchHits.length;
  }
  
  const targetMark = App.roger.searchHits[App.roger.currentSearchIndex];
  
  const bubble = targetMark.closest('.roger-chat-bubble');
  if (bubble) {
    bubble.classList.add('expanded');
    const wrapper = targetMark.closest('.roger-chat-bubble-wrapper');
    if (wrapper) wrapper.classList.add('expanded');
  }

  targetMark.classList.add('active-match');
  setTimeout(() => {
    targetMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 50);
};

const rogerStopWords = new Set(['i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', "you're", "you've", "you'll", "you'd", 'your', 'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', "she's", 'her', 'hers', 'herself', 'it', "it's", 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that', "that'll", 'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', "don't", 'should', "should've", 'now', 'd', 'll', 'm', 'o', 're', 've', 'y', 'ain', 'aren', "aren't", 'couldn', "couldn't", 'didn', "didn't", 'doesn', "doesn't", 'hadn', "hadn't", 'hasn', "hasn't", 'haven', "haven't", 'isn', "isn't", 'ma', 'mightn', "mightn't", 'mustn', "mustn't", 'needn', "needn't", 'shan', "shan't", 'shouldn', "shouldn't", 'wasn', "wasn't", 'weren', "weren't", 'won', "won't", 'wouldn', "wouldn't"]);

App.roger.generateGlossary = function() {
  const log = document.getElementById('rogerChatLog');
  const select = document.getElementById('rogerGlossarySelect');
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
  const toggleBtn = document.getElementById('rogerToggleCollapseBtn');
  const searchInput = document.getElementById('rogerSearchInput');
  const log = document.getElementById('rogerChatLog');
  const glossarySelect = document.getElementById('rogerGlossarySelect');

  if (toggleBtn && log) {
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const isCollapsed = log.classList.toggle('roger-collapsed-mode');
      toggleBtn.textContent = isCollapsed ? 'Expand All' : 'Collapse All';
      
      const expandedNodes = log.querySelectorAll('.expanded');
      expandedNodes.forEach(node => node.classList.remove('expanded'));
    });
  }

  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        App.roger.applySearchHighlights(e.target.value);
      }, 300);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        if (App.roger.searchHits.length > 0) {
          const step = e.shiftKey ? -1 : 1;
          App.roger.focusSearchHit(App.roger.currentSearchIndex + step);
        }
      }
    });
  }

  if (glossarySelect && searchInput) {
    glossarySelect.addEventListener('change', (e) => {
      const term = e.target.value;
      if (term) {
        searchInput.value = term;
        App.roger.applySearchHighlights(term);
      }
    });
  }
});
