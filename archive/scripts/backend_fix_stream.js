const fs = require('fs');
let code = fs.readFileSync('routes/roger.js', 'utf8');

// 1. Add activeInferenceJobs tracking
if (!code.includes('const activeInferenceJobs = new Set();')) {
  code = code.replace(
    "function parseTriAgentBackend(rawString) {",
    "const activeInferenceJobs = new Set();\n\nfunction parseTriAgentBackend(rawString) {"
  );
}

// 2. Remove worker fetch from POST /chat
code = code.replace(
  /const proto = req\.headers\['x-forwarded-proto'\][\s\S]*?\}\)\.catch\(e => console\.error\("Worker fetch failed:", e\)\);/,
  "// Decoupled. Logic handled seamlessly downstream by SSE daemon."
);

// 3. Remove POST /worker entirely
code = code.replace(
  /if \(pathname === '\/api\/develop\/roger\/worker' && requestMethod === 'POST'\) \{[\s\S]*?return true;\n  \}\n/,
  ""
);

// 4. Implement inference check inside GET /stream
// We look for the "const rawHash =" line.
const streamInjection = `        const rawHash = JSON.stringify(history.slice(-5));
          if (res.locals && res.locals.lastHash !== rawHash) {
             res.write(\`data: \${JSON.stringify({ type: 'sync', chats: history })}\\n\\n\`);
             res.locals = { lastHash: rawHash };
          } else if (!res.locals) {
             res.locals = { lastHash: rawHash }; // skip initial payload, wait for deltas
          }

          // [VERCEL AVOIDANCE PROTOCOL] Trigger inline LLM inference binding
          const lastChat = history[history.length - 1];
          if (lastChat.content === '[SYSTEM::QUEUED]' && !activeInferenceJobs.has(lastChat.id)) {
            activeInferenceJobs.add(lastChat.id);
            (async () => {
              try {
                const isForAntigravity = (history.length > 1 && history[history.length - 2].content.toLowerCase().includes('@antigravity'));
                const respondingAgent = isForAntigravity ? 'antigravity' : 'roger';
                let maxVersion = 0;
                history.forEach(chat => {
                  const p = parseTriAgentBackend(chat.content);
                  if (p && p.state && typeof p.state.state_version_id === 'number') {
                    if (p.state.state_version_id > maxVersion) maxVersion = p.state.state_version_id;
                  }
                });
                
                const processHistory = history.filter(h => h.id !== lastChat.id && h.content !== '[SYSTEM::QUEUED]');
                const messages = processHistory.map(row => {
                  let prefix = '';
                  if (row.role === 'user') prefix = '[From Human]: ';
                  if (row.role === 'antigravity') prefix = '[From Antigravity (IDE Agent)]: ';
                  if (row.role === 'roger') prefix = '[From Roger Thorson]: ';
                  return {
                    role: row.role === respondingAgent || row.role === 'model' ? 'model' : 'user',
                    text: prefix + row.content
                  };
                });
                
                const geminiRes = await consultRoger(messages, { agentRole: respondingAgent });
                let cleanText = geminiRes.ok ? geminiRes.text.replace(/^\\[From.*?\\]:\\s*\\n*/i, '') : \`**SYSTEM ERROR:** Agent \${respondingAgent} failed. \${geminiRes.error}\`;
                
                const outData = parseTriAgentBackend(cleanText);
                if (outData && outData.state) {
                  outData.state.state_version_id = maxVersion + 1; 
                  cleanText = "\`\`\`json\\n" + JSON.stringify(outData, null, 2) + "\\n\`\`\`";
                }
                await updateRogerChat(lastChat.id, { content: cleanText });
              } catch(err) {} finally {
                activeInferenceJobs.delete(lastChat.id);
              }
            })();
          }`;

code = code.replace(
  /const rawHash = JSON\.stringify\(history\.slice\(-5\)\);[\s\S]*?res\.locals = \{ lastHash: rawHash \}; \/\/ skip initial payload, wait for deltas\n          \}/,
  streamInjection
);

fs.writeFileSync('routes/roger.js', code);
