const fs = require('fs');
let code = fs.readFileSync('public/js/roger.js', 'utf8');

const workerBlock = `       if (res.data.rogerChat) {
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

// Patch submitChat
code = code.replace(
  /if \(res\.data\.rogerChat\) App\.roger\.appendChatNode\(res\.data\.rogerChat\);\n       App\.roger\.scrollToBottom\(\);\n    \}/,
  `if (res.data.rogerChat) App.roger.appendChatNode(res.data.rogerChat);
       App.roger.scrollToBottom();
${workerBlock}
    }`
);

// Patch sendProtocolAction
code = code.replace(
  /if \(res\.data\?\.rogerChat\) \{\n      App\.roger\.appendChatNode\(res\.data\.rogerChat\);\n    \}\n    App\.roger\.scrollToBottom\(\);/,
  `if (res.data?.rogerChat) {
      App.roger.appendChatNode(res.data.rogerChat);
${workerBlock}
    }
    App.roger.scrollToBottom();`
);

fs.writeFileSync('public/js/roger.js', code);
