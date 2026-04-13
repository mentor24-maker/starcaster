const fs = require('fs');
let code = fs.readFileSync('routes/roger.js', 'utf8');

// 1. Remove the activeInferenceJobs global
code = code.replace("const activeInferenceJobs = new Set();\n\n", "");

// 2. Add POST /worker
const workerEndpoint = `  if (pathname === '/api/develop/roger/worker' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const { sessionId, projectId, chatId, respondingAgent } = body;
    if (!sessionId || !chatId || !respondingAgent) return sendErr(res, 400, 'Missing worker params'), true;

    // Do NOT return response early. The browser holds this open to keep Vercel alive.
    
    try {
      const historyRes = await listRogerChats(sessionId, projectId, 70);
      let history = historyRes.ok && Array.isArray(historyRes.data) ? historyRes.data : [];
      let maxVersion = 0;
      history.forEach(chat => {
        const p = parseTriAgentBackend(chat.content);
        if (p && p.state && typeof p.state.state_version_id === 'number') {
          if (p.state.state_version_id > maxVersion) maxVersion = p.state.state_version_id;
        }
      });
      // Filter out pending states from context to avoid Agent confusion
      history = history.filter(h => h.id !== chatId && h.content !== '[SYSTEM::QUEUED]');
      
      const messages = history.map(row => {
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
      let cleanText = geminiRes.ok ? geminiRes.text.replace(/^\[From.*?\\]:\\s*\\n*/i, '') : \`**SYSTEM ERROR:** Agent \${respondingAgent} failed to respond -> \${geminiRes.error}\`;

      const outData = parseTriAgentBackend(cleanText);
      if (outData && outData.state) {
        outData.state.state_version_id = maxVersion + 1; 
        cleanText = "\`\`\`json\\n" + JSON.stringify(outData, null, 2) + "\\n\`\`\`";
      }

      await updateRogerChat(chatId, { content: cleanText });
    } catch(err) {
      await updateRogerChat(chatId, { content: \`**SYSTEM ERROR EXCEPTION:** Worker thread collapsed randomly -> \${err.message}\` });
    }
    
    sendOk(res, 200, { success: true });
    return true;
  }
`;

// Insert the worker endpoint right before GET /stream
code = code.replace(
  "  if (pathname === '/api/develop/roger/stream' && requestMethod === 'GET') {",
  workerEndpoint + "\n  if (pathname === '/api/develop/roger/stream' && requestMethod === 'GET') {"
);

// 3. Remove the entire inference binding from GET /stream
code = code.replace(
  /\/\/ \[VERCEL AVOIDANCE PROTOCOL\] Trigger inline LLM inference binding[\s\S]*?\)\(\);\n          \}/g,
  ""
);

fs.writeFileSync('routes/roger.js', code);
