const fs = require('fs');
let code = fs.readFileSync('routes/roger.js', 'utf8');

const target1 = "  if (pathname === '/api/develop/roger/chat' && requestMethod === 'PATCH') {";
const replacement1 = `  if (pathname === '/api/develop/roger/config' && requestMethod === 'GET') {
    const config = require('../lib/config');
    const url = config.get('supabaseUrl') || '';
    const anonKey = config.get('supabaseAnonKey') || '';
    if (!url || !anonKey) return sendErr(res, 500, 'Supabase URL or Anon Key is missing from Server Env variables'), true;
    return sendOk(res, 200, { url, anonKey }), true;
  }

  if (pathname === '/api/develop/roger/chat' && requestMethod === 'PATCH') {`;

code = code.replace(target1, replacement1);

const target2 = `  if (pathname === '/api/develop/roger/stream' && requestMethod === 'GET') {
    const urlObj = getUrlObj(req);
    const sessionId = Number(urlObj.searchParams.get('sessionId') || 0);

    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'sessionId is required' }));
      return true;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    res.write(\`data: \${JSON.stringify({ type: 'ping' })}\\n\\n\`);

    const interval = setInterval(async () => {
      try {
        const historyRes = await listRogerChats(sessionId, projectId, 20); 
        const history = historyRes.ok && Array.isArray(historyRes.data) ? historyRes.data : [];
        if (history.length > 0) {
                  const rawHash = JSON.stringify(history.slice(-5));
          if (res.locals && res.locals.lastHash !== rawHash) {
             res.write(\`data: \${JSON.stringify({ type: 'sync', chats: history })}\\n\\n\`);
             res.locals = { lastHash: rawHash };
          } else if (!res.locals) {
             res.locals = { lastHash: rawHash }; // skip initial payload, wait for deltas
          }

          
        }
      } catch (err) {
         console.error('SSE Stream Error:', err);
      }
    }, 2500); 

    req.on('close', () => {
      clearInterval(interval);
    });

    return true;
  }`;

code = code.replace(target2, "");

fs.writeFileSync('routes/roger.js', code);
console.log("Script execution finished.");
