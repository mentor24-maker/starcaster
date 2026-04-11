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
    if (data && data.state && typeof data.state.state_version_id === 'number') {
      return data;
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

    // Map DB rows to Gemini parts array
    const messages = history.map(row => {
      let prefix = '';
      if (row.role === 'user') prefix = '[From Human]: ';
      if (row.role === 'antigravity') prefix = '[From Antigravity (IDE Agent)]: ';
      if (row.role === 'roger') prefix = '[From Roger Thorson]: ';
      
      let inlineData = undefined;
      if (row.id === userSaveRes.data?.id && attachmentBase64 && attachmentMime.startsWith('image/')) {
        inlineData = {
          mimeType: attachmentMime,
          data: attachmentBase64.replace(/^data:image\/[a-z]+;base64,/, '')
        };
      }

      return {
        role: row.role === respondingAgent || row.role === 'model' ? 'model' : 'user',
        text: prefix + row.content,
        // The inlineData key will only be added to the payload if the variable is defined
        ...(inlineData && { inlineData })
      };
    });

    // 3. Ask Agent via Gemini API
    const geminiRes = await consultRoger(messages, { agentRole: respondingAgent });
    if (!geminiRes.ok) {
      return sendErr(res, 502, `${respondingAgent} API failed: ${geminiRes.error}`), true;
    }

    // 4. Clean Agent response to prevent prefix bleeding
    let cleanText = geminiRes.text.replace(/^\[From.*?\]:\s*\n*/i, '');
    
    // Server Authoritative verification for the AI payload
    const outData = parseTriAgentBackend(cleanText);
    if (outData && outData.state) {
      outData.state.state_version_id = maxVersion + 2; 
      cleanText = "```json\n" + JSON.stringify(outData, null, 2) + "\n```";
    }

    // 5. Save Agent response to DB
    const rogerSaveRes = await createRogerChat({ session_id: sessionId, project_id: projectId, role: respondingAgent, content: cleanText });
    if (!rogerSaveRes.ok) return sendErr(res, rogerSaveRes.status || 500, rogerSaveRes.error), true;

    return sendOk(res, 201, {
      userChat: userSaveRes.data,
      rogerChat: rogerSaveRes.data
    }), true;
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
