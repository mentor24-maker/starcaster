const fs = require('fs');
let code = fs.readFileSync('public/js/roger.js', 'utf8');

// 1. Rewrite App.roger.init to load config
const initFunctionOld = "App.roger.init = function() {";
const initFunctionNew = `App.roger.init = async function() {
  try {
    const cfgRes = await App.api('/api/develop/roger/config');
    if (cfgRes && cfgRes.url && cfgRes.anonKey && window.supabase) {
      window.supabaseClient = window.supabase.createClient(cfgRes.url, cfgRes.anonKey);
    }
  } catch(e) { console.error('Failed to load Supabase Realtime Config', e); }
`;
code = code.replace(initFunctionOld, initFunctionNew);

// 2. Change selectSession to initSupabaseRealtime instead of initStream
code = code.replace("  App.roger.initStream(sessionId);\n};", "  App.roger.initSupabaseRealtime(sessionId);\n};");

// 3. Delete initStream and replace with initSupabaseRealtime
const initStreamTarget = `App.roger.initStream = function(sessionId) {
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
};`;

const initSupabaseRealtimeNew = `App.roger.initSupabaseRealtime = function(sessionId) {
  if (!window.supabaseClient) {
    console.warn('Supabase Realtime not initialized. Ensure URL and ANON_KEY are in settings.');
    return;
  }
  if (App.roger.realtimeChannel) {
    App.roger.realtimeChannel.unsubscribe();
  }
  
  App.roger.realtimeChannel = window.supabaseClient.channel('roger_chats_' + sessionId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'roger_chats', filter: 'session_id=eq.' + sessionId },
      (payload) => {
        const chat = payload.new;
        if (!chat) return;
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
      }
    )
    .subscribe();
};`;

code = code.replace(initStreamTarget, initSupabaseRealtimeNew);

// 4. Remove fetch(/worker) from submitChat and sendProtocolAction
const fetchWorkerTarget = `       if (res.data.rogerChat) {
         fetch('/api/develop/roger/worker', {
           method: 'POST',
           headers: {
             'Content-Type': 'application/json',
             'Authorization': \`Bearer \${localStorage.getItem('token') || ''}\`
           },
           body: JSON.stringify({
             sessionId: rogerState.activeSessionId,
             chatId: res.data.rogerChat.id,
             respondingAgent: triAgentPayload.toLowerCase().includes('@antigravity') ? 'antigravity' : 'roger'
           })
         }).catch(e => console.error('Worker fetch error:', e));
       }`;

code = code.replace(fetchWorkerTarget, "");
code = code.replace(fetchWorkerTarget, ""); // Replace second occurrence

fs.writeFileSync('public/js/roger.js', code);
