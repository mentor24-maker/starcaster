'use strict';

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const { listRogerChats, createRogerChat, updateRogerChat, listRogerSessions, createRogerSession, updateRogerSession } = require('../lib/rogerChatsStore');
const { consultRoger } = require('../lib/rogerClient');
const { resolveCurrentProject } = require('../lib/projectsStore');
const { uploadAssetToBlob } = require('../lib/blobStorage');

const manifest = {
  id: 'develop-roger',
  label: 'Ask Roger API',
  prefixes: ['/api/develop/roger']
};

function parseTriAgentBackend(rawString) {
  if (!rawString || typeof rawString !== 'string') return null;
  const match = rawString.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const potentialJson = match ? match[1] : rawString.trim();
  try {
    const data = JSON.parse(potentialJson);
    if (data && data.state) {
      if (data.state.stateversionid !== undefined && data.state.state_version_id === undefined) {
        data.state.state_version_id = data.state.stateversionid;
        delete data.state.stateversionid;
      }
      if (data.state.contextchecksum !== undefined && data.state.context_checksum === undefined) {
        data.state.context_checksum = data.state.contextchecksum;
        delete data.state.contextchecksum;
      }
      if (data.state.state_version_id !== undefined) {
        data.state.state_version_id = Number(data.state.state_version_id);
        if (!isNaN(data.state.state_version_id)) return data;
      }
    }
  } catch(e) {}
  return null;
}

async function handle(req, res, pathname, requestMethod) {
  const scope = await resolveCurrentProject(req);
  const projectId = scope?.projectId || null;

  if (pathname === '/api/develop/roger/sessions' && requestMethod === 'GET') {
    const result = await listRogerSessions(projectId);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { sessions: result.data }, { total: result.data.length }), true;
  }

  if (pathname === '/api/develop/roger/sessions' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const result = await createRogerSession({ project_id: projectId, name: body?.name });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 201, result.data, { session: result.data }), true;
  }

  if (pathname === '/api/develop/roger/sessions' && requestMethod === 'PATCH') {
    const body = await parseJsonBody(req);
    const sessionId = Number(body?.sessionId || 0);
    if (!sessionId) return sendErr(res, 400, 'sessionId is required', { code: 'VALIDATION_ERROR' }), true;

    // TODO: Verify the session belongs to the current project
    const result = await updateRogerSession(sessionId, { name: body?.name });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { session: result.data }), true;
  }

  if (pathname === '/api/develop/roger/history' && requestMethod === 'GET') {
    const urlObj = getUrlObj(req);
    const sessionId = Number(urlObj.searchParams.get('sessionId') || 0);
    if (!sessionId) return sendErr(res, 400, 'sessionId is required', { code: 'VALIDATION_ERROR' }), true;
    
    const limit = Number(urlObj.searchParams.get('limit') || 100);
    const result = await listRogerChats(sessionId, projectId, limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { chats: result.data }, { total: result.data.length }), true;
  }

  if (pathname === '/api/develop/roger/config' && requestMethod === 'GET') {
    const config = require('../lib/config');
    const url = config.get('supabaseUrl') || '';
    const anonKey = config.get('supabaseAnonKey') || '';
    if (!url || !anonKey) return sendErr(res, 500, 'Supabase URL or Anon Key is missing from Server Env variables'), true;
    return sendOk(res, 200, { url, anonKey }), true;
  }

  if (pathname === '/api/develop/roger/test' && requestMethod === 'GET') {
    const geminiRes = await consultRoger([ { role: 'user', content: 'Ping' } ], { agentRole: 'roger' });
    if (!geminiRes.ok) {
       return sendErr(res, 502, `AI Test Failed: ${geminiRes.error}`), true;
    }
    return sendOk(res, 200, { status: "Success", message: "AI Engine is responding correctly." }), true;
  }

  if (pathname === '/api/develop/roger/chat' && requestMethod === 'PATCH') {
    const body = await parseJsonBody(req);
    const chatId = Number(body?.chatId || 0);
    if (!chatId) return sendErr(res, 400, 'chatId is required', { code: 'VALIDATION_ERROR' }), true;

    const content = String(body?.content || '').trim();
    if (!content) return sendErr(res, 400, 'Content is required', { code: 'VALIDATION_ERROR' }), true;

    const result = await updateRogerChat(chatId, { content });
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    
    return sendOk(res, 200, result.data, { chat: result.data }), true;
  }

  if (pathname === '/api/develop/roger/chat' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const sessionId = Number(body?.sessionId || 0);
    if (!sessionId) return sendErr(res, 400, 'sessionId is required', { code: 'VALIDATION_ERROR' }), true;
    
    const content = String(body?.content || '').trim();
    if (!content) return sendErr(res, 400, 'Content is required', { code: 'VALIDATION_ERROR' }), true;

    const attachmentBase64 = String(body?.attachmentBase64 || '').trim();
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
    if (attachmentUrl) {
      chatOptions.attachment_url = attachmentUrl;
      chatOptions.attachment_mime = attachmentMime;
      chatOptions.attachment_name = attachmentName;
    }
    const userSaveRes = await createRogerChat(chatOptions);
    if (!userSaveRes.ok) return sendErr(res, userSaveRes.status || 500, userSaveRes.error), true;
    
    // Add the newly saved user record to the working history matrix
    history.push(userSaveRes.data);

    // Determine target agent based on mention in the human's latest prompt
    const isForAntigravity = finalContent.toLowerCase().includes('@antigravity');
    const respondingAgent = isForAntigravity ? 'antigravity' : 'roger';

    const rogerSaveRes = await createRogerChat({ session_id: sessionId, project_id: projectId, role: respondingAgent, status: 'processing', content: '[SYSTEM::PROCESSING]' });
    if (!rogerSaveRes.ok) return sendErr(res, rogerSaveRes.status || 500, rogerSaveRes.error), true;

    // Fire and forget via internal fetch wrapper
    // Decoupled. Logic handled seamlessly downstream by SSE daemon.

    return sendOk(res, 202, {
      userChat: userSaveRes.data,
      rogerChat: rogerSaveRes.data
    }), true;
  }

  
  if (pathname === '/api/develop/roger/worker' && requestMethod === 'POST') {
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
      const historyRes = await listRogerChats(sessionId, projectId, 70);
      let history = historyRes.ok && Array.isArray(historyRes.data) ? historyRes.data : [];
      let maxVersion = 0;
      history.forEach(chat => {
        const p = parseTriAgentBackend(chat.content);
        if (p && p.state && typeof p.state.state_version_id === 'number') {
          if (p.state.state_version_id > maxVersion) maxVersion = p.state.state_version_id;
        }
      });
      history = history.filter(h => h.id !== chatId && h.content !== '[SYSTEM::QUEUED]' && h.content !== '[SYSTEM::PROCESSING]' && !h.content.includes('SYSTEM ERROR') && h.status !== 'failed');
      
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
    } catch(err) {
      const fRes = await updateRogerChat(chatId, { status: 'failed', error_details: err.message, content: `An error occurred with the AI Inference engine. => ${err.message}` });
      if (!fRes.ok) {
        await createRogerChat({ session_id: sessionId, project_id: projectId, role: 'antigravity', status: 'complete', content: `**SYSTEM ERROR:** Webhook caught exception \`${err.message}\` BUT could not update the row. DB Error: \`${JSON.stringify(fRes.error)}\`` });
      }
    }
    
    sendOk(res, 200, { success: true });
    return true;
  }



  if (pathname === '/api/develop/roger/retry' && requestMethod === 'POST') {
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

    const isForAntigravity = lastMessage.content.toLowerCase().includes('@antigravity');
    const respondingAgent = isForAntigravity ? 'antigravity' : 'roger';

    let messagesHistory = history;
    messagesHistory = messagesHistory.filter(h => h.content !== '[SYSTEM::QUEUED]' && !h.content.includes('SYSTEM ERROR'));

    const messages = messagesHistory.map(row => {
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

    return sendOk(res, 201, {
      rogerChat: rogerSaveRes.data
    }), true;
  }

  return false;
}

module.exports = { manifest, handle };
