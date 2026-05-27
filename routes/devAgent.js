'use strict';

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const { listRogerChats, createRogerChat, updateRogerChat, listRogerSessions, createRogerSession, updateRogerSession, evaluateAndUpdateTaskStatus, createMessageLink, listPendingCommands } = require('../lib/rogerChatsStore');
const { consultRoger } = require('../lib/rogerClient');
const { resolveCurrentProject } = require('../lib/projectsStore');
const { uploadAssetToBlob } = require('../lib/blobStorage');
const {
  listDevTeamMembers,
  getDevTeamMember,
  addDevTeamMember,
  removeDevTeamMember,
} = require('../lib/devTeamStore');
const { listDevRoles } = require('../lib/devRolesStore');
const {
  canManageTeamInvites,
  sendTeamMemberInvitation,
} = require('../lib/teamInviteDelivery');
const {
  revokeTeamInvitation,
  getActiveInvitationForDevTeam,
} = require('../lib/teamInvitationsStore');

function projectIdFromRequest(req) {
  return String(
    req?.projectContext?.project?.id
    || req.headers['x-project-id']
    || req.headers['X-Project-ID']
    || ''
  ).trim() || null;
}

async function resolveProjectIdForRequest(req) {
  const fromContext = projectIdFromRequest(req);
  if (fromContext) return fromContext;
  const userId = String(req?.authUser?.id || '').trim();
  if (!userId) return null;
  const result = await resolveCurrentProject({
    userId,
    requestedProjectId: String(req.headers['x-project-id'] || req.headers['X-Project-ID'] || '').trim(),
    autoCreateDefault: true,
  });
  return result.ok ? String(result.data?.project?.id || '').trim() || null : null;
}

const manifest = {
  id: 'develop-roger',
  label: 'Ask Roger API',
  prefixes: ['/api/develop/devAgent']
};

function parseTriAgentBackend(rawString) {
  if (!rawString || typeof rawString !== 'string') return null;
  const match = rawString.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const potentialJson = match ? match[1] : rawString.trim();
  try {
    let data = JSON.parse(potentialJson);
    if (Array.isArray(data)) {
      const combinedContent = data.map(d => d.payload?.content || '').filter(Boolean).join('\n\n---\n\n');
      let targetObj = data.find(d => d.payload?.type === 'COMMAND') || data[data.length - 1];
      if (targetObj && targetObj.payload) {
         targetObj.payload.content = combinedContent;
      }
      data = targetObj;
    }
    if (data && data.state) {
      if (data.state.sessionid !== undefined && data.state.session_id === undefined) {
        data.state.session_id = data.state.sessionid;
        delete data.state.sessionid;
      }
      if (data.state.stateversionid !== undefined && data.state.state_version_id === undefined) {
        data.state.state_version_id = data.state.stateversionid;
        delete data.state.stateversionid;
      }
      if (data.state.contextchecksum !== undefined && data.state.context_checksum === undefined) {
        data.state.context_checksum = data.state.contextchecksum;
        delete data.state.contextchecksum;
      }
      if (data.state.sourceagent !== undefined && data.state.source_agent === undefined) {
        data.state.source_agent = data.state.sourceagent;
        delete data.state.sourceagent;
      }
      if (data.state.targetagent !== undefined && data.state.target_agent === undefined) {
        data.state.target_agent = data.state.targetagent;
        delete data.state.targetagent;
      }
      if (data.state.activeobjectiveid !== undefined && data.state.active_objective_id === undefined) {
        data.state.active_objective_id = data.state.activeobjectiveid;
        delete data.state.activeobjectiveid;
      }
      if (data.state.state_version_id !== undefined) {
        data.state.state_version_id = Number(data.state.state_version_id);
        if (!isNaN(data.state.state_version_id)) {
           return data;
        }
      }
    }
  } catch (e) {
    // Regex Recovery for structurally broken JSON (unescaped quotes/newlines inside payload.content)
    try {
      let rawStr = String(rawString).trim();
      const contentMatch = rawStr.match(/"content"\s*:\s*([\s\S]*)/);
      if (contentMatch) {
         let contentStr = contentMatch[1].trim();
         // Strip the trailing JSON brackets and quotes like: " \n  }\n}
         contentStr = contentStr.replace(/\"\s*\}?\s*\}?\s*$/g, '');
         if (contentStr.startsWith('"')) contentStr = contentStr.substring(1);
         // Unescape standard JSON text escapes since we bypassed parser
         contentStr = contentStr.replace(/\\n/g, '\n').replace(/\\"/g, '"');
         
          let stateObj = { state_version_id: 1 };
         // Try to regex extract the state block
         const stateMatch = rawStr.match(/"state"\s*:\s*(\{[\s\S]*?\})\s*,\s*"payload"/);
         if (stateMatch) {
            try { stateObj = JSON.parse(stateMatch[1]); } catch(e2) {}
         }
         return {
            state: stateObj,
            payload: { type: 'RESPONSE', content: contentStr }
         };
      }
      
      // Heuristic fallback for pure markdown panic attacks
      if (!rawStr.startsWith('{') && !rawStr.startsWith('[')) {
         let target = '@Human';
         if (rawStr.toLowerCase().includes('@angie')) target = '@Angie';
         else if (rawStr.toLowerCase().includes('@archie') || rawStr.toLowerCase().includes('@antigravity')) target = '@Archie';
         
         let type = rawStr.includes('COMMAND:') ? 'COMMAND' : 'RESPONSE';
         
         return {
            state: { target_agent: target, source_agent: '@Roger', state_version_id: 1 },
            payload: { type: type, content: rawStr }
         };
      }
    } catch(regexErr) {}
  }
  return null;
}

async function handle(req, res, pathname, requestMethod) {
  const projectId = await resolveProjectIdForRequest(req);

  if (pathname === '/api/develop/devAgent/sessions' && requestMethod === 'GET') {
    const result = await listRogerSessions(projectId);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { sessions: result.data }, { total: result.data.length }), true;
  }

  if (pathname === '/api/develop/devAgent/sessions' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const result = await createRogerSession({ project_id: projectId, name: body?.name });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, result.data, { session: result.data }), true;
  }

  if (pathname === '/api/develop/devAgent/sessions' && requestMethod === 'PATCH') {
    const body = await parseJsonBody(req);
    const sessionId = Number(body?.sessionId || 0);
    if (!sessionId) return sendErr(res, 400, 'sessionId is required', { code: 'VALIDATION_ERROR' }), true;

    // TODO: Verify the session belongs to the current project
    const result = await updateRogerSession(sessionId, { name: body?.name });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { session: result.data }), true;
  }

  if (pathname === '/api/develop/devAgent/history' && requestMethod === 'GET') {
    const urlObj = getUrlObj(req);
    const sessionId = Number(urlObj.searchParams.get('sessionId') || 0);
    if (!sessionId) return sendErr(res, 400, 'sessionId is required', { code: 'VALIDATION_ERROR' }), true;
    
    const limit = Number(urlObj.searchParams.get('limit') || 100);
    const result = await listRogerChats(sessionId, projectId, limit);
    require('fs').writeFileSync('/Users/mentor/Desktop/ISITAS/Development/alphire-promo/history_debug.json', JSON.stringify({ sessionId, projectId, limit, returnedCount: result.data ? result.data.length : 'error', firstFew: result.data ? result.data.slice(0, 7).map(c => c.id) : null }));
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { chats: result.data }, { total: result.data.length }), true;
  }

  if (pathname === '/api/develop/devAgent/links' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const sourceMessageId = Number(body?.source_message_id || 0);
    const targetType = String(body?.target_type || '');
    const targetId = String(body?.target_id || '');
    
    if (!sourceMessageId || !targetType || !targetId) {
      return sendErr(res, 400, 'Missing required fields: source_message_id, target_type, target_id', { code: 'VALIDATION_ERROR' }), true;
    }
    
    const result = await createMessageLink(sourceMessageId, targetType, targetId);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, result.data, { link: result.data }), true;
  }

  if (pathname === '/api/develop/devAgent/pendingCommands' && requestMethod === 'GET') {
    const result = await listPendingCommands(projectId);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { commands: result.data }, { total: result.data.length }), true;
  }

  if (pathname === '/api/develop/devAgent/config' && requestMethod === 'GET') {
    const config = require('../lib/config');
    const url = config.get('supabaseUrl') || '';
    const anonKey = config.get('supabaseAnonKey') || '';
    if (!url || !anonKey) return sendErr(res, 500, 'Supabase URL or Anon Key is missing from Server Env variables'), true;
    return sendOk(res, 200, { url, anonKey }), true;
  }

  if (pathname === '/api/develop/devAgent/test' && requestMethod === 'GET') {
    const geminiRes = await consultRoger([ { role: 'user', content: 'Ping' } ], { agentRole: 'roger' });
    if (!geminiRes.ok) {
       return sendErr(res, 502, `AI Test Failed: ${geminiRes.error}`), true;
    }
    return sendOk(res, 200, { status: "Success", message: "AI Engine is responding correctly." }), true;
  }

  if (pathname === '/api/develop/devAgent/chat' && requestMethod === 'PATCH') {
    const body = await parseJsonBody(req);
    const chatId = Number(body?.chatId || 0);
    if (!chatId) return sendErr(res, 400, 'chatId is required', { code: 'VALIDATION_ERROR' }), true;

    const content = String(body?.content || '').trim();
    if (!content) return sendErr(res, 400, 'Content is required', { code: 'VALIDATION_ERROR' }), true;

    const result = await updateRogerChat(chatId, { content });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    
    return sendOk(res, 200, result.data, { chat: result.data }), true;
  }

  if (pathname === '/api/develop/devAgent/chat' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const sessionId = Number(body?.sessionId || 0);
    if (!sessionId) return sendErr(res, 400, 'sessionId is required', { code: 'VALIDATION_ERROR' }), true;
    
    const content = String(body?.content || '').trim();
    if (!content) return sendErr(res, 400, 'Content is required', { code: 'VALIDATION_ERROR' }), true;
    const parentId = body?.parentId ? Number(body.parentId) : null;

    let attachmentBase64 = String(body?.attachmentBase64 || '').trim();
    if (attachmentBase64 && attachmentBase64.includes('base64,')) {
      attachmentBase64 = attachmentBase64.split('base64,')[1];
    }
    const attachmentMime = String(body?.attachmentMime || '').trim();
    const attachmentName = String(body?.attachmentName || '').trim();

    let attachmentUrl = null;
    if (attachmentBase64) {
      const uploadRes = await uploadAssetToBlob({
        assetType: 'RogerChatAttachment',
        category: `Session_${sessionId}`,
        fileName: attachmentName || 'attachment',
        mimeType: attachmentMime || 'application/octet-stream',
        fileBase64: attachmentBase64
      });
      if (uploadRes.ok && uploadRes.data && uploadRes.data.location) {
        attachmentUrl = uploadRes.data.location;
      }
    }

    // 1. Fetch history BEFORE saving to assert server-authoritative state version
    const historyRes = await listRogerChats(sessionId, projectId, 30);
    const history = historyRes.ok && Array.isArray(historyRes.data) ? historyRes.data : [];

    let maxVersion = 0;
    history.forEach(chat => {
      const p = parseTriAgentBackend(chat.content);
      if (p && p.state && typeof p.state.state_version_id === 'number') {
        if (p.state.state_version_id > maxVersion) maxVersion = p.state.state_version_id;
      }
    });

    // Overwrite the incoming user payload if it is JSON
    let finalContent = content;
    const incomingData = parseTriAgentBackend(content);
    if (incomingData && incomingData.state) {
      incomingData.state.state_version_id = maxVersion + 1;
      finalContent = "```json\n" + JSON.stringify(incomingData, null, 2) + "\n```";
    }

    // 2. Save user message to DB
    const chatOptions = { session_id: sessionId, project_id: projectId, role: 'user', content: finalContent };
    if (parentId) chatOptions.parent_id = parentId;
    if (attachmentUrl) {
      chatOptions.attachment_url = attachmentUrl;
      chatOptions.attachment_mime = attachmentMime;
      chatOptions.attachment_name = attachmentName;
    }
    const userSaveRes = await createRogerChat(chatOptions);
    if (!userSaveRes.ok) return sendErr(res, userSaveRes.status || 500, userSaveRes.error), true;
    
    // Add the newly saved user record to the working history matrix
    history.push(userSaveRes.data);

    // Dynamic Routing based on Mentioned Handles
    let agentsToTrigger = [];
    const contentLower = content.toLowerCase();
    
    if (contentLower.includes('@all')) {
      agentsToTrigger = ['antigravity', 'angie'];
    } else {
      if (contentLower.includes('@roger')) agentsToTrigger.push('antigravity');
      if (contentLower.includes('@angie')) agentsToTrigger.push('angie');
    }
    
    // Broadcast to everyone if no specific agent is addressed
    if (agentsToTrigger.length === 0) {
      agentsToTrigger = ['antigravity'];
    }

    const processingNodes = [];
    for (const agent of agentsToTrigger) {
      const agentOptions = { session_id: sessionId, project_id: projectId, role: agent, status: 'processing', content: '[SYSTEM::PROCESSING]' };
      // Always make the agent's response a child of the user's message
      agentOptions.parent_id = userSaveRes.data.id;
      
      const rogerSaveRes = await createRogerChat(agentOptions);
      if (rogerSaveRes.ok) {
        processingNodes.push(rogerSaveRes.data);
      } else {
        return sendErr(res, rogerSaveRes.status || 500, rogerSaveRes.error), true;
      }
    }

    // Fire and forget via internal fetch wrapper
    // Decoupled. Logic handled seamlessly downstream by SSE daemon, but we must manually trigger locally
    const host = req.headers.host || '127.0.0.1:3000';
    const protocol = (host.includes('localhost') || host.includes('127.0.0.1')) ? 'http' : 'https';
    let triggerHost = host;
    if (triggerHost.startsWith('localhost:')) {
      triggerHost = triggerHost.replace('localhost:', '127.0.0.1:');
    }
    for (const node of processingNodes) {
      fetch(`${protocol}://${triggerHost}/api/develop/devAgent/worker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'INSERT', record: node })
      }).catch(err => console.error("Internal worker trigger failed:", err));
    }

    evaluateAndUpdateTaskStatus(sessionId).catch(e => console.error("[evaluateAndUpdateTaskStatus] Error:", e));

    return sendOk(res, 202, {
      userChat: userSaveRes.data,
      replies: processingNodes
    }), true;
  }

  
  if (pathname === '/api/develop/devAgent/worker' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    let sessionId, projectId, chatId, respondingAgent;
    if (body && body.type === 'INSERT' && body.record) {
      if (body.record.status !== 'processing' && body.record.content !== '[SYSTEM::PROCESSING]' && body.record.content !== '[SYSTEM::QUEUED]') return sendOk(res, 200, { ignored: true }), true;
      sessionId = Number(body.record.session_id || 0);
      projectId = body.record.project_id ? Number(body.record.project_id) : null;
      chatId = Number(body.record.id || 0);
      respondingAgent = String(body.record.role || 'roger');
    } else {
      sessionId = Number(body?.sessionId || 0);
      projectId = body?.projectId ? Number(body.projectId) : null;
      chatId = Number(body?.chatId || 0);
      respondingAgent = String(body?.respondingAgent || '');
    }

    if (!sessionId || !chatId || !respondingAgent) return sendErr(res, 400, 'Missing worker params'), true;

    // Do NOT return response early. The browser holds this open to keep Vercel alive.
    
    try {
      console.log(`[Worker] Started processing for chatId ${chatId} (${respondingAgent})`);
      const historyRes = await listRogerChats(sessionId, projectId, 70);
      let history = historyRes.ok && Array.isArray(historyRes.data) ? historyRes.data : [];
      console.log(`[Worker] Loaded ${history.length} history items for session ${sessionId}`);
      let maxVersion = 0;
      history.forEach(chat => {
        const p = parseTriAgentBackend(chat.content);
        if (p && p.state && typeof p.state.state_version_id === 'number') {
          if (p.state.state_version_id > maxVersion) maxVersion = p.state.state_version_id;
        }
      });
      history = history.filter(h => h.id !== chatId && h.content !== '[SYSTEM::QUEUED]' && h.content !== '[SYSTEM::PROCESSING]' && !h.content.includes('SYSTEM ERROR') && h.status !== 'failed');
      
      const messages = [];
      for (const row of history) {
        let prefix = '';
        if (row.role === 'user') prefix = '[From Human]: ';
        if (row.role === 'antigravity') prefix = '[From Roger]: ';
        if (row.role === 'roger') prefix = '[From DevAgent]: ';
        let rowText = prefix + row.content;
        
        if (row.attachment_url && (row.attachment_name?.endsWith('.md') || Object.is(row.attachment_mime, 'application/octet-stream') || row.attachment_mime?.startsWith('text/'))) {
           try {
              const fetchRes = await fetch(row.attachment_url);
              if (fetchRes.ok) {
                 const textData = await fetchRes.text();
                 rowText += "\n\n[ATTACHED FILE CONTENT: " + (row.attachment_name || "attachment") + "]\n" + textData;
              }
           } catch (e) {
              rowText += "\n\n[SYSTEM ERROR: Could not fetch attachment at " + row.attachment_url + "]";
           }
        }

        messages.push({
          role: row.role === respondingAgent || row.role === 'model' ? 'model' : 'user',
          text: rowText
        });
      }

      console.log(`[Worker] Executing inference loop via consultRoger for ${respondingAgent}...`);
      
      let timer;
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Inference timed out after 60 seconds')), 60000);
      });
      const geminiRes = await Promise.race([
        consultRoger(messages, { agentRole: respondingAgent }),
        timeoutPromise
      ]).finally(() => clearTimeout(timer));

      console.log(`[Worker] Inference complete for ${respondingAgent} (ok: ${geminiRes.ok})`);

      if (!geminiRes.ok) {
        const isQuotaErr = geminiRes.error && (geminiRes.error.toLowerCase().includes('quota') || geminiRes.error.toLowerCase().includes('demand'));
        if (isQuotaErr) {
          const mockTriAgentStr = JSON.stringify({
            state: {
              session_id: sessionId,
              state_version_id: maxVersion + 1,
              timestamp: new Date().toISOString(),
              source_agent: respondingAgent === 'antigravity' ? '@Antigravity' : '@Roger',
              target_agent: '@Human',
              active_objective_id: "ACTIVE-SESSION",
              context_checksum: Math.random().toString(36).substring(2,8)
            },
            payload: {
              type: "QUERY",
              content: `**API QUOTA EXHAUSTED:** The AI API failed. \n\n*Error: ${geminiRes.error}*\n\nI have automatically generated this placeholder payload so that frontend UI testing and state machine verification can continue uninterrupted.`
            }
          }, null, 2);
          
          let cleanText = "```json\n" + mockTriAgentStr + "\n```";
          const uRes = await updateRogerChat(chatId, { content: cleanText, status: 'complete' });
          if (!uRes.ok) {
            await createRogerChat({ session_id: sessionId, project_id: projectId, role: 'antigravity', status: 'complete', content: `**SYSTEM ERROR:** Webhook could not update existing row ${chatId}. Reason: \`${JSON.stringify(uRes.error)}\`` });
          }
          sendOk(res, 200, { success: true });
          return true;
        } else {
          throw new Error(geminiRes.error || "Unknown Inference Engine Exception");
        }
      }
      let cleanText = geminiRes.text.replace(/^\[From.*?\]:\s*\n*/i, '');

      const outData = parseTriAgentBackend(cleanText);
      if (outData && outData.state) {
        outData.state.state_version_id = maxVersion + 1; 
        cleanText = "```json\n" + JSON.stringify(outData, null, 2) + "\n```";
      }

      const uRes = await updateRogerChat(chatId, { content: cleanText, status: 'complete' });
      if (!uRes.ok) {
        await createRogerChat({ session_id: sessionId, project_id: projectId, role: 'antigravity', status: 'complete', content: `**SYSTEM ERROR:** Webhook could not update existing row ${chatId}. Reason: \`${JSON.stringify(uRes.error)}\`` });
      }

      // Inter-Agent Handoff Routing
      if (outData && outData.state && outData.state.target_agent) {
        const targetAgent = String(outData.state.target_agent).toLowerCase();
        let nextRole = null;
        
        if (targetAgent.includes('@angie')) {
          nextRole = 'roger'; // Role 'roger' maps to @Angie
        } else if (targetAgent.includes('@roger')) {
          nextRole = 'antigravity'; // Role 'antigravity' maps to @Roger_Thorson
        } else if (targetAgent.includes('@archie') || targetAgent.includes('@antigravity')) {
          // DO NOT auto-trigger the backend. Archie is the IDE agent controlled by the human.
          console.log(`[Worker] Target is Archie/Antigravity. Halting inter-agent chain to wait for human handoff.`);
        }

        if (nextRole && nextRole !== respondingAgent) {
          console.log(`[Worker] Agent ${respondingAgent} handed off to ${nextRole}. Enqueuing next node...`);
          const rogerSaveRes = await createRogerChat({ session_id: sessionId, project_id: projectId, role: nextRole, status: 'processing', content: '[SYSTEM::PROCESSING]', parent_id: chatId });
          if (rogerSaveRes.ok) {
            const host = req.headers.host || '127.0.0.1:3000';
            const protocol = (host.includes('localhost') || host.includes('127.0.0.1')) ? 'http' : 'https';
            let triggerHost = host.startsWith('localhost:') ? host.replace('localhost:', '127.0.0.1:') : host;
            
            fetch(`${protocol}://${triggerHost}/api/develop/devAgent/worker`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'INSERT', record: rogerSaveRes.data })
            }).catch(err => console.error("[Worker] Inter-agent chain trigger failed:", err));
          }
        }
      }
    } catch(err) {
      const fRes = await updateRogerChat(chatId, { status: 'failed', error_details: err.message, content: `An error occurred with the AI Inference engine. => ${err.message}` });
      if (!fRes.ok) {
        await createRogerChat({ session_id: sessionId, project_id: projectId, role: 'antigravity', status: 'complete', content: `**SYSTEM ERROR:** Webhook caught exception \`${err.message}\` BUT could not update the row. DB Error: \`${JSON.stringify(fRes.error)}\`` });
      }
    }
    evaluateAndUpdateTaskStatus(sessionId).catch(e => console.error("[evaluateAndUpdateTaskStatus] Error:", e));
    
    sendOk(res, 200, { success: true });
    return true;
  }

  if (pathname === '/api/develop/devAgent/harvest' && requestMethod === 'POST') {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      const path = require('path');
      const scriptPath = path.resolve(__dirname, '../scripts/harvest_knowledge.mjs');
      
      exec(`node ${scriptPath}`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Harvest Error: ${error}`);
          resolve(sendErr(res, 500, `Harvest failed: ${error.message}`));
        } else {
          console.log(`Harvest Output: ${stdout}`);
          resolve(sendOk(res, 200, { success: true, output: stdout }));
        }
      });
    }).then(() => true);
  }


  if (pathname === '/api/develop/devAgent/retry' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const sessionId = Number(body?.sessionId || 0);
    if (!sessionId) return sendErr(res, 400, 'sessionId is required', { code: 'VALIDATION_ERROR' }), true;

    const historyRes = await listRogerChats(sessionId, projectId, 30);
    const history = historyRes.ok && Array.isArray(historyRes.data) ? historyRes.data : [];

    if (history.length === 0) {
      return sendErr(res, 400, 'No history found to retry', { code: 'VALIDATION_ERROR' }), true;
    }

    const lastMessage = history[history.length - 1];
    if (lastMessage.role !== 'user') {
      // Background process completed successfully but client connection originally dropped.
      // Return the generated agent message to terminate the client's retry loop.
      return sendOk(res, 200, {
        rogerChat: lastMessage
      }), true;
    }

    const isAngie = lastMessage.role === 'angie';
    const isAntigravity = lastMessage.role === 'antigravity';
    const respondingAgent = isAngie ? 'angie' : (isAntigravity ? 'antigravity' : 'roger');

    let messagesHistory = history;
    messagesHistory = messagesHistory.filter(h => h.content !== '[SYSTEM::QUEUED]' && !h.content.includes('SYSTEM ERROR'));

    const messages = messagesHistory.map(row => {
      let prefix = '';
      if (row.role === 'user') prefix = '[From Human]: ';
      if (row.role === 'antigravity') prefix = '[From Roger]: ';
      if (row.role === 'roger') prefix = '[From DevAgent]: ';
      
      return {
        role: row.role === respondingAgent || row.role === 'model' ? 'model' : 'user',
        text: prefix + row.content
      };
    });

    const geminiRes = await consultRoger(messages, { agentRole: respondingAgent });
    if (!geminiRes.ok) {
      const isQuotaErr = geminiRes.error && (geminiRes.error.toLowerCase().includes('quota') || geminiRes.error.toLowerCase().includes('demand'));
      if (isQuotaErr) {
        let maxVersionFallback = 0;
        history.forEach(chat => {
          const p = parseTriAgentBackend(chat.content);
          if (p && p.state && typeof p.state.state_version_id === 'number') {
            if (p.state.state_version_id > maxVersionFallback) maxVersionFallback = p.state.state_version_id;
          }
        });
        const mockTriAgentStr = JSON.stringify({
          state: {
            session_id: sessionId,
            state_version_id: maxVersionFallback + 1,
            timestamp: new Date().toISOString(),
            source_agent: respondingAgent === 'antigravity' ? '@Antigravity' : '@Roger',
            target_agent: '@Human',
            active_objective_id: "ACTIVE-SESSION",
            context_checksum: Math.random().toString(36).substring(2,8)
          },
          payload: {
            type: "QUERY",
            content: `**RETRIED - API QUOTA EXHAUSTED:** The AI API failed again. \n\n*Error: ${geminiRes.error}*\n\nPlaceholder payload injected so development can continue.`
          }
        }, null, 2);
        
        let cleanText = "```json\n" + mockTriAgentStr + "\n```";
        const rogerSaveRes = await createRogerChat({ session_id: sessionId, project_id: projectId, role: respondingAgent, content: cleanText });
        if (!rogerSaveRes.ok) return sendErr(res, rogerSaveRes.status || 500, rogerSaveRes.error), true;
        return sendOk(res, 201, { rogerChat: rogerSaveRes.data }), true;
      }
      return sendErr(res, 502, `${respondingAgent} API failed: ${geminiRes.error}`), true;
    }

    // Clean Agent response to prevent prefix bleeding
    let cleanText = geminiRes.text.replace(/^\[From.*?\]:\s*\n*/i, '');

    let maxVersion = 0;
    history.forEach(chat => {
      const p = parseTriAgentBackend(chat.content);
      if (p && p.state && typeof p.state.state_version_id === 'number') {
        if (p.state.state_version_id > maxVersion) maxVersion = p.state.state_version_id;
      }
    });
    
    // Server Authoritative verification for the AI payload
    const outData = parseTriAgentBackend(cleanText);
    if (outData && outData.state) {
      outData.state.state_version_id = maxVersion + 1; 
      cleanText = "```json\n" + JSON.stringify(outData, null, 2) + "\n```";
    }

    const rogerSaveRes = await createRogerChat({ session_id: sessionId, project_id: projectId, role: respondingAgent, content: cleanText });
    if (!rogerSaveRes.ok) return sendErr(res, rogerSaveRes.status || 500, rogerSaveRes.error), true;

    evaluateAndUpdateTaskStatus(sessionId).catch(e => console.error("[evaluateAndUpdateTaskStatus] Error:", e));

    return sendOk(res, 201, {
      rogerChat: rogerSaveRes.data
    }), true;
  }


  if (pathname === '/api/develop/devAgent/roles' && requestMethod === 'GET') {
    if (!projectId) return sendErr(res, 400, 'Active project is required', { code: 'PROJECT_REQUIRED' }), true;
    const result = await listDevRoles(projectId);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const roles = result.data || [];
    return sendOk(res, 200, roles, { roles }), true;
  }

  if (pathname === '/api/develop/devAgent/team' && requestMethod === 'GET') {
    if (!projectId) return sendErr(res, 400, 'Active project is required', { code: 'PROJECT_REQUIRED' }), true;
    const result = await listDevTeamMembers(projectId);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    const members = result.data || [];
    return sendOk(res, 200, members, { members }, { total: members.length }), true;
  }

  if (pathname === '/api/develop/devAgent/team' && requestMethod === 'POST') {
    if (!projectId) return sendErr(res, 400, 'Active project is required', { code: 'PROJECT_REQUIRED' }), true;
    const body = await parseJsonBody(req);
    const result = await addDevTeamMember({
      projectId,
      contactId: body?.contactId || body?.contact_id,
      role: body?.role,
    });
    if (!result.ok) {
      const code = result.status === 409 ? 'CONFLICT' : result.status === 404 ? 'NOT_FOUND' : 'DB_ERROR';
      return sendErr(res, result.status || 500, result.error, { code }), true;
    }
    return sendOk(res, 201, result.data, { member: result.data }), true;
  }

  const teamInviteResendMatch = pathname.match(/^\/api\/develop\/devAgent\/team\/([^/]+)\/invite\/resend$/);
  if (teamInviteResendMatch && requestMethod === 'POST') {
    if (!projectId) return sendErr(res, 400, 'Active project is required', { code: 'PROJECT_REQUIRED' }), true;
    if (!canManageTeamInvites(req)) {
      return sendErr(res, 403, 'Only project owners can send team invitations', { code: 'FORBIDDEN' }), true;
    }
    const teamId = decodeURIComponent(teamInviteResendMatch[1]);
    const projectName = String(req?.projectContext?.project?.name || '').trim();
    const inviterName = String(req?.authUser?.name || req?.authUser?.email || '').trim();
    const result = await sendTeamMemberInvitation({
      projectId,
      teamMemberId: teamId,
      invitedByUserId: String(req?.authUser?.id || '').trim(),
      inviterName,
      projectName,
      req,
    });
    if (!result.ok) {
      const code = result.status === 404 ? 'NOT_FOUND' : result.status === 409 ? 'CONFLICT' : 'INVITE_FAILED';
      return sendErr(res, result.status || 500, result.error, { code, invitation: result.data?.invitation }), true;
    }
    return sendOk(res, 200, result.data, { ...result.data, resent: true }), true;
  }

  const teamInviteMatch = pathname.match(/^\/api\/develop\/devAgent\/team\/([^/]+)\/invite$/);
  if (teamInviteMatch && requestMethod === 'POST') {
    if (!projectId) return sendErr(res, 400, 'Active project is required', { code: 'PROJECT_REQUIRED' }), true;
    if (!canManageTeamInvites(req)) {
      return sendErr(res, 403, 'Only project owners can send team invitations', { code: 'FORBIDDEN' }), true;
    }
    const teamId = decodeURIComponent(teamInviteMatch[1]);
    const projectName = String(req?.projectContext?.project?.name || '').trim();
    const inviterName = String(req?.authUser?.name || req?.authUser?.email || '').trim();
    const result = await sendTeamMemberInvitation({
      projectId,
      teamMemberId: teamId,
      invitedByUserId: String(req?.authUser?.id || '').trim(),
      inviterName,
      projectName,
      req,
    });
    if (!result.ok) {
      const code = result.status === 404 ? 'NOT_FOUND' : result.status === 409 ? 'CONFLICT' : 'INVITE_FAILED';
      return sendErr(res, result.status || 500, result.error, { code, invitation: result.data?.invitation }), true;
    }
    return sendOk(res, 200, result.data, result.data), true;
  }

  const teamInviteRevokeMatch = pathname.match(/^\/api\/develop\/devAgent\/team\/([^/]+)\/invite$/);
  if (teamInviteRevokeMatch && requestMethod === 'DELETE') {
    if (!projectId) return sendErr(res, 400, 'Active project is required', { code: 'PROJECT_REQUIRED' }), true;
    if (!canManageTeamInvites(req)) {
      return sendErr(res, 403, 'Only project owners can revoke team invitations', { code: 'FORBIDDEN' }), true;
    }
    const teamId = decodeURIComponent(teamInviteRevokeMatch[1]);
    const memberRes = await getDevTeamMember(teamId, projectId);
    if (!memberRes.ok) return sendErr(res, memberRes.status || 500, memberRes.error), true;
    const invRes = await getActiveInvitationForDevTeam(projectId, teamId);
    if (!invRes.ok) return sendErr(res, invRes.status || 500, invRes.error), true;
    if (!invRes.data) {
      return sendErr(res, 404, 'No pending invitation for this team member', { code: 'NOT_FOUND' }), true;
    }
    const revoked = await revokeTeamInvitation({ id: invRes.data.id, projectId });
    if (!revoked.ok) return sendErr(res, revoked.status || 500, revoked.error), true;
    return sendOk(res, 200, { revoked: true, invitation: revoked.data }), true;
  }

  const teamMemberMatch = pathname.match(/^\/api\/develop\/devAgent\/team\/([^/]+)$/);
  if (teamMemberMatch && requestMethod === 'DELETE') {
    if (!projectId) return sendErr(res, 400, 'Active project is required', { code: 'PROJECT_REQUIRED' }), true;
    const teamId = decodeURIComponent(teamMemberMatch[1]);
    const result = await removeDevTeamMember(teamId, projectId);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, { deleted: true }), true;
  }

  if (pathname === '/api/develop/devAgent/git-status' && requestMethod === 'GET') {
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      const cmds = [
        'git log -1 --format=%cd',
        'git log -1 --format=%cd origin/main || echo "No origin/main"',
        'git rev-list origin/main..HEAD --count || echo "0"',
        'git status --porcelain | wc -l',
        'git branch --show-current'
      ];
      
      exec(cmds.join(' && '), (error, stdout, stderr) => {
        if (error) {
          console.error('[Git Status Error]', error);
          resolve(sendErr(res, 500, 'Git command failed'));
          return;
        }
        const lines = stdout.trim().split('\n');
        resolve(sendOk(res, 200, {
          lastCommitDate: lines[0],
          lastPushDate: lines[1],
          unpushedCommits: parseInt(lines[2]) || 0,
          uncommittedFiles: parseInt(lines[3]) || 0,
          currentBranch: lines[4]
        }));
      });
    }).then(() => true);
  }

  return false;
}

module.exports = { manifest, handle };
