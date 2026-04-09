'use strict';

const { sendOk, sendErr, parseJsonBody, getUrlObj } = require('./http');
const { listRogerChats, createRogerChat } = require('../lib/rogerChatsStore');
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

  if (pathname === '/api/develop/roger/history' && requestMethod === 'GET') {
    const urlObj = getUrlObj(req);
    const limit = Number(urlObj.searchParams.get('limit') || 100);
    const result = await listRogerChats(projectId, limit);
    if (!result.ok) return sendErr(res, result.status || 500, result.error), true;
    return sendOk(res, 200, result.data, { chats: result.data }, { total: result.data.length }), true;
  }

  if (pathname === '/api/develop/roger/chat' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const content = String(body?.content || '').trim();
    if (!content) return sendErr(res, 400, 'Content is required', { code: 'VALIDATION_ERROR' }), true;

    // 1. Save user message to DB
    const userSaveRes = await createRogerChat({ project_id: projectId, role: 'user', content });
    if (!userSaveRes.ok) return sendErr(res, userSaveRes.status || 500, userSaveRes.error), true;
    
    // 2. Fetch history to provide context to Gemini
    const historyRes = await listRogerChats(projectId, 30);
    const history = historyRes.ok && Array.isArray(historyRes.data) ? historyRes.data : [];

    // Map DB rows to Gemini parts array
    // Antigravity (the system agent) or the developer can be mapped appropriately.
    // We treat everything that isn't 'model' or 'assistant' as 'user' for Gemini.
    const messages = history.map(row => ({
      role: row.role === 'model' || row.role === 'roger' ? 'model' : 'user',
      text: row.content
    }));

    // 3. Ask Roger via Gemini API
    const geminiRes = await consultRoger(messages);
    if (!geminiRes.ok) {
      return sendErr(res, 502, `Roger API failed: ${geminiRes.error}`), true;
    }

    // 4. Save Roger response to DB
    const rogerSaveRes = await createRogerChat({ project_id: projectId, role: 'roger', content: geminiRes.text });
    if (!rogerSaveRes.ok) return sendErr(res, rogerSaveRes.status || 500, rogerSaveRes.error), true;

    return sendOk(res, 201, {
      userChat: userSaveRes.data,
      rogerChat: rogerSaveRes.data
    }), true;
  }

  return false;
}

module.exports = { manifest, handle };
