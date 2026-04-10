'use strict';

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const { listRogerChats, createRogerChat, listRogerSessions, createRogerSession, updateRogerSession } = require('../lib/rogerChatsStore');
const { consultRoger } = require('../lib/rogerClient');
const { resolveCurrentProject } = require('../lib/projectsStore');

const manifest = {
  id: 'develop-roger',
  label: 'Ask Roger API',
  prefixes: ['/api/develop/roger']
};

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

  if (pathname === '/api/develop/roger/chat' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const sessionId = Number(body?.sessionId || 0);
    if (!sessionId) return sendErr(res, 400, 'sessionId is required', { code: 'VALIDATION_ERROR' }), true;
    
    const content = String(body?.content || '').trim();
    if (!content) return sendErr(res, 400, 'Content is required', { code: 'VALIDATION_ERROR' }), true;

    // 1. Save user message to DB
    const userSaveRes = await createRogerChat({ session_id: sessionId, project_id: projectId, role: 'user', content });
    if (!userSaveRes.ok) return sendErr(res, userSaveRes.status || 500, userSaveRes.error), true;
    
    // 2. Fetch history to provide context to Gemini
    const historyRes = await listRogerChats(sessionId, projectId, 30);
    const history = historyRes.ok && Array.isArray(historyRes.data) ? historyRes.data : [];

    // Map DB rows to Gemini parts array
    // Antigravity (the system agent) or the developer can be mapped appropriately.
    const messages = history.map(row => {
      let prefix = '';
      if (row.role === 'user') prefix = '[From Human]: ';
      if (row.role === 'antigravity') prefix = '[From Antigravity (IDE Agent)]: ';
      
      return {
        role: row.role === 'model' || row.role === 'roger' ? 'model' : 'user',
        text: prefix + row.content
      };
    });

    // Determine target agent based on mention in the human's latest prompt
    const isForAntigravity = content.toLowerCase().includes('@antigravity');
    const respondingAgent = isForAntigravity ? 'antigravity' : 'roger';

    // 3. Ask Agent via Gemini API
    const geminiRes = await consultRoger(messages, { agentRole: respondingAgent });
    if (!geminiRes.ok) {
      return sendErr(res, 502, `${respondingAgent} API failed: ${geminiRes.error}`), true;
    }

    // 4. Clean Agent response to prevent prefix bleeding
    let cleanText = geminiRes.text.replace(/^\[From.*?\]:\s*\n*/i, '');

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

    const messages = history.map(row => {
      let prefix = '';
      if (row.role === 'user') prefix = '[From Human]: ';
      if (row.role === 'antigravity') prefix = '[From Antigravity (IDE Agent)]: ';
      
      return {
        role: row.role === 'model' || row.role === 'roger' ? 'model' : 'user',
        text: prefix + row.content
      };
    });

    const isForAntigravity = lastMessage.content.toLowerCase().includes('@antigravity');
    const respondingAgent = isForAntigravity ? 'antigravity' : 'roger';

    const geminiRes = await consultRoger(messages, { agentRole: respondingAgent });
    if (!geminiRes.ok) {
      return sendErr(res, 502, `${respondingAgent} API failed: ${geminiRes.error}`), true;
    }

    // Clean Agent response to prevent prefix bleeding
    let cleanText = geminiRes.text.replace(/^\[From.*?\]:\s*\n*/i, '');

    const rogerSaveRes = await createRogerChat({ session_id: sessionId, project_id: projectId, role: respondingAgent, content: cleanText });
    if (!rogerSaveRes.ok) return sendErr(res, rogerSaveRes.status || 500, rogerSaveRes.error), true;

    return sendOk(res, 201, {
      rogerChat: rogerSaveRes.data
    }), true;
  }

  return false;
}

module.exports = { manifest, handle };
