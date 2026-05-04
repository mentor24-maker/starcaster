const fs = require('fs');

const rawChats = JSON.parse(fs.readFileSync('scratch.json', 'utf8'));

// Snipped version of devAgent functions
function parseTriAgentBackend(rawText) {
  if (!rawText) return null;
  try {
    let maybeJson = String(rawText).trim();
    if (maybeJson.startsWith('```json')) maybeJson = maybeJson.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    else if (maybeJson.startsWith('```')) maybeJson = maybeJson.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(maybeJson);
    
    if (parsed && parsed.payload && parsed.payload.content) {
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
         let innerText = String(parsed.payload.content).trim();
         if (innerText.includes('"state"') && innerText.includes('"payload"')) {
            const innerContentMatch = innerText.match(/"content"\s*:\s*([\s\S]*)/);
            if (innerContentMatch) {
               let innerContentStr = innerContentMatch[1].trim();
               innerContentStr = innerContentStr.replace(/\"\s*\}?\s*\}?\s*\]?\s*(```)?\s*(,\s*\{[\s\S]*)?$/g, '');
               if (innerContentStr.startsWith('"')) innerContentStr = innerContentStr.substring(1);
               innerContentStr = innerContentStr.replace(/\\n/g, '\n').replace(/\\"/g, '"');
               parsed.payload.content = innerContentStr;
            }
         }
      }
      return { valid: true, data: parsed };
    }
  } catch (e) {
    try {
      let rawStr = String(rawText).trim();
      const contentMatch = rawStr.match(/"content"\s*:\s*([\s\S]*)/);
      if (contentMatch) {
         let contentStr = contentMatch[1].trim();
         contentStr = contentStr.replace(/\"\s*\}?\s*\}?\s*\]?\s*(```)?\s*(,\s*\{[\s\S]*)?$/g, '');
         if (contentStr.startsWith('"')) contentStr = contentStr.substring(1);
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
  return null;
}

try {
  let maxVersion = 0;
  rawChats.forEach((chat, i) => {
    try {
      const p = parseTriAgentBackend(chat.content);
      if (p && p.valid && p.data && p.data.state && p.data.state.state_version_id) {
         maxVersion = Math.max(maxVersion, Number(p.data.state.state_version_id));
      }
    } catch(e) {
      console.log('Error parsing chat at index', i, 'ID:', chat.id);
      throw e;
    }
  });

  rawChats.forEach((chat, i) => {
    try {
      // Simulate appendChatNode throwing?
      // appendChatNode logic:
      const dateStr = chat.created_at ? new Date(chat.created_at).toLocaleString() : new Date().toLocaleString();
      let parsedTriAgent = parseTriAgentBackend(chat.content);
      
      let finalHtml = chat.content;
      if (parsedTriAgent && parsedTriAgent.valid && parsedTriAgent.data && parsedTriAgent.data.payload) {
        if (parsedTriAgent.data.payload.type === 'COMMAND') {
           finalHtml = parsedTriAgent.data.payload.content;
        } else {
           finalHtml = parsedTriAgent.data.payload.content;
        }
      }
      
      if (chat.role === 'user' && chat.id) {
        encodeURIComponent(chat.content); // this could throw URIError?
      }
    } catch(e) {
       console.log('Error appending chat at index', i, 'ID:', chat.id);
       throw e;
    }
  });
  console.log("No errors thrown!");
} catch (e) {
  console.log(e.stack);
}
