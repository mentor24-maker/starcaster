'use strict';

window.App = window.App || {};
App.roger = {};

const rogerState = {
  activeSessionId: null,
  sessions: [],
  stagedFile: null
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
  previewWrap: null,
  previewName: null,
  previewClearBtn: null
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
  rogerElements.previewWrap = document.getElementById('rogerChatAttachmentPreview');
  rogerElements.previewName = document.getElementById('rogerChatAttachmentName');
  rogerElements.previewClearBtn = document.getElementById('rogerChatAttachmentClearBtn');

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
      
      const reader = new FileReader();
      reader.onload = (evt) => {
        rogerState.stagedFile = {
          name: file.name,
          mime: file.type,
          base64: evt.target.result
        };
        if (rogerElements.previewName) rogerElements.previewName.textContent = file.name;
        if (rogerElements.previewWrap) rogerElements.previewWrap.classList.remove('hidden');
      };
      reader.readAsDataURL(file);
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

  // Replace code blocks and inject a Save button
  html = html.replace(/```(?:[a-z0-9]*)?\n([\s\S]*?)```/gi, (match, codeBlock) => {
    let filename = 'code.txt';
    const lines = codeBlock.split('\n');
    for (const line of lines) {
      const matchFile = line.match(/\/\/\s*FILE:\s*([^\s]+)/i) || line.match(/\/\/\s*TARGET FILE:\s*([^\s]+)/i);
      if (matchFile) {
        filename = matchFile[1].trim();
        break;
      }
    }
    
    // Fallback if the user wrote "Code for index.js:" right before it?
    // Let's just rely on the "// FILE: index.js" convention since Roger does it.
    
    // Base64 encode the content safely
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

  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
  
  // Need to be careful not to replace newlines inside the generated HTML from our code blocks
  // A simple <br/> replacement outside of our <pre> wrapper:
  // But since we just returned HTML strings, doing a global \n will mess up the pre content.
  // Wait! The previous implementation just did \n blindly!
  // To protect our newly added `<pre>` blocks, let's just do it directly.
  
  return html;
};

// Because the original formatMarkdown did a blind \n -> <br/> at the END, it broke <pre> formatting!
// Let's patch `\n` to `<br/>` but ONLY outside of <pre> or <div class="code-block-wrapper">
const _originalFormat = App.roger.formatMarkdown;
App.roger.formatMarkdown = function(text) {
  let html = _originalFormat(text);
  // Actually, wait, replacing \n globally is bad for HTML readability anyway.
  // Instead of replacing newlines globally, I'll do a custom split-and-replace so we don't break our pre.
  
  const tokens = html.split(/(<div class="code-block-wrapper"[\s\S]*?<\/div>)/i);
  for (let i = 0; i < tokens.length; i++) {
    if (!tokens[i].startsWith('<div class="code-block-wrapper"')) {
      tokens[i] = tokens[i].replace(/\n/g, '<br/>');
    }
  }
  return tokens.join('');
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
  if (chat.role === 'user') author = 'Mentor';
  if (chat.role === 'roger') author = '@RogerThorson';
  if (chat.role === 'antigravity') author = '@antigravity';

  const dateStr = chat.created_at ? new Date(chat.created_at).toLocaleString() : new Date().toLocaleString();
  
  const copyBtnId = `copyChat_${chat.id || Math.random().toString(36).substr(2, 9)}`;
  header.innerHTML = `
    <div><strong>${author}</strong> <span class="chat-time">${dateStr}</span></div>
    <div class="roger-copy-btn-container">
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
  content.innerHTML = App.roger.formatMarkdown(chat.content);

  if (chat.attachment_url) {
    const attachWrap = document.createElement('div');
    attachWrap.className = 'roger-chat-attachment';
    attachWrap.innerHTML = `<a href="${chat.attachment_url}" target="_blank"><img src="${chat.attachment_url}" style="max-width:100%; border-radius:4px; margin-top:8px; display:block;" alt="Attached" /></a>`;
    content.appendChild(attachWrap);
  }

  const plainTextSummary = (chat.content || '').replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').substring(0, 80).trim() + '...';
  const summaryNode = document.createElement('div');
  summaryNode.className = 'roger-chat-summary';
  summaryNode.innerHTML = `<strong>${dateStr} - ${author}:</strong> ${plainTextSummary} <a href="#" class="roger-expand-link" onclick="event.preventDefault(); this.closest('.roger-chat-bubble').classList.toggle('expanded'); this.closest('.roger-chat-bubble-wrapper').classList.toggle('expanded');">Expand</a>`;

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
};

App.roger.scrollToBottom = function() {
  if (rogerElements.log) {
    rogerElements.log.scrollTop = rogerElements.log.scrollHeight;
  }
};

App.roger.startRetryCountdown = function(sessionId, bubbleId, attemptNumber = 1) {
  let secondsLeft = 10;
  
  const tick = () => {
    const loadingNode = document.getElementById(bubbleId);
    if (!loadingNode || rogerState.activeSessionId !== sessionId) return;

    const bubble = loadingNode.querySelector('.roger-chat-bubble');
    if (bubble) {
      if (secondsLeft > 0) {
        bubble.innerHTML = `Response pending... (Attempt #${attemptNumber} failed. Retrying in ${secondsLeft}s)`;
        secondsLeft--;
        setTimeout(tick, 1000);
      } else {
        bubble.innerHTML = `Response pending... (Pinging API... Attempt #${attemptNumber + 1})`;
        App.roger.pollRetry(sessionId, bubbleId, attemptNumber + 1);
      }
    }
  };
  
  tick();
};

App.roger.pollRetry = async function(sessionId, bubbleId, attemptNumber = 1) {
  const loadingNode = document.getElementById(bubbleId);
  if (!loadingNode || rogerState.activeSessionId !== sessionId) return;

  try {
    const res = await App.api('/api/develop/roger/retry', {
      method: 'POST',
      body: JSON.stringify({ sessionId })
    });
    
    const chatData = res.rogerChat || res.data?.rogerChat;
    if (chatData) {
      const node = document.getElementById(bubbleId);
      if (node) node.remove();
      App.roger.appendChatNode(chatData);
      App.roger.scrollToBottom();
      return; 
    }
  } catch (err) {
    if (document.getElementById(bubbleId) && rogerState.activeSessionId === sessionId) {
      App.roger.startRetryCountdown(sessionId, bubbleId, attemptNumber);
    }
  }
};

App.roger.clearStagedFile = function() {
  rogerState.stagedFile = null;
  if (rogerElements.fileInput) rogerElements.fileInput.value = '';
  if (rogerElements.previewWrap) rogerElements.previewWrap.classList.add('hidden');
  if (rogerElements.previewName) rogerElements.previewName.textContent = '';
};

App.roger.submitChat = async function() {
  const text = rogerElements.input?.value.trim();
  if (!text || !rogerState.activeSessionId) return;

  const staged = rogerState.stagedFile;

  rogerElements.input.value = '';
  rogerElements.input.disabled = true;
  if (rogerElements.fileBtn) rogerElements.fileBtn.disabled = true;
  App.roger.clearStagedFile();

  // Optimistically append user node
  const tempUserChat = { 
    role: 'user', 
    content: text, 
    created_at: new Date().toISOString(),
    attachment_url: staged ? staged.base64 : null // Optimistic visual render
  };
  App.roger.appendChatNode(tempUserChat);
  App.roger.scrollToBottom();

  const bubbleId = 'rogerLoadingBubble_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const loadingWrapper = document.createElement('div');
  loadingWrapper.className = 'roger-chat-bubble-wrapper roger';
  loadingWrapper.id = bubbleId;
  loadingWrapper.innerHTML = `
    <div class="roger-chat-avatar roger" style="background-image: url('/images/roger.png');"></div>
    <div class="roger-chat-content-col">
      <div class="roger-chat-bubble roger loading">Roger is analyzing...</div>
    </div>
  `;
  rogerElements.log.appendChild(loadingWrapper);
  App.roger.scrollToBottom();

  try {
    const payload = { 
      sessionId: rogerState.activeSessionId, 
      content: text 
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
    
    const loadingNode = document.getElementById(bubbleId);
    if (loadingNode) loadingNode.remove();

    if (res.error) {
      alert("Agent Failed to Respond: " + (res.error.message || res.error));
    } else if (res.data?.rogerChat || res.rogerChat) {
      const chatNode = res.rogerChat || res.data.rogerChat;
      App.roger.appendChatNode(chatNode);
      App.roger.scrollToBottom();
    }
  } catch (err) {
    const loadingNode = document.getElementById(bubbleId);
    if (loadingNode) {
      const bubble = loadingNode.querySelector('.roger-chat-bubble');
      if (bubble) {
        bubble.className = 'roger-chat-bubble roger pending';
      }
    }
    App.notify("Agent encountered an issue: " + (err.message || err) + " - The system will continue to ping the API in the background until a response is ready. You can continue working.", true);
    
    // Begin background retry loop
    const sessionId = rogerState.activeSessionId;
    App.roger.startRetryCountdown(sessionId, bubbleId, 1);
  } finally {
    rogerElements.input.disabled = false;
    if (rogerElements.fileBtn) rogerElements.fileBtn.disabled = false;
    rogerElements.input.focus();
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.roger.init();
});

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

  let matchCount = 0;
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
        lastIndex = regex.lastIndex;
        matchCount++;
      }
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }
      
      node.parentNode.replaceChild(fragment, node);
    }
  });

  if (countSpan) {
    countSpan.textContent = `${matchCount} match${matchCount !== 1 ? 'es' : ''}`;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('rogerToggleCollapseBtn');
  const searchInput = document.getElementById('rogerSearchInput');
  const log = document.getElementById('rogerChatLog');

  if (toggleBtn && log) {
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const isCollapsed = log.classList.toggle('roger-collapsed-mode');
      toggleBtn.textContent = isCollapsed ? 'Expand' : 'Collapse';
    });
  }

  if (searchInput) {
    // Debounce search input
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        App.roger.applySearchHighlights(e.target.value);
      }, 300);
    });
  }
});
