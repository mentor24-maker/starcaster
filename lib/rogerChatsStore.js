'use strict';

const { sbQuery, tableConfig } = require('./supabase');

function table() {
  return tableConfig().rogerChats || 'roger_chats';
}

function sessionsTable() {
  return tableConfig().rogerSessions || 'roger_sessions';
}

function rowToChat(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    session_id: Number(row.session_id || 0) || 0,
    project_id: Number(row.project_id || 0) || null,
    role: String(row.role || ''),
    content: String(row.content || ''),
    created_at: String(row.created_at || ''),
  };
}

function rowToSession(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    project_id: Number(row.project_id || 0) || null,
    name: String(row.name || ''),
    created_at: String(row.created_at || ''),
  };
}

async function listRogerSessions(projectId = null) {
  let query = `select=*&order=id.desc`;
  if (projectId) {
    query += `&project_id=eq.${Number(projectId)}`;
  } else {
    query += `&project_id=is.null`;
  }
  
  const res = await sbQuery({
    method: 'GET',
    table: sessionsTable(),
    query,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToSession) : [],
  };
}

async function createRogerSession(input) {
  const payload = {
    name: String(input?.name || 'New Discussion'),
  };
  if (input?.project_id) {
    payload.project_id = Number(input.project_id);
  }

  const res = await sbQuery({
    method: 'POST',
    table: sessionsTable(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [payload],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToSession(created) };
}

async function listRogerChats(sessionId, projectId = null, limit = 100) {
  let query = `select=*&session_id=eq.${Number(sessionId)}&order=id.desc&limit=${limit}`;
  if (projectId) {
    query += `&project_id=eq.${Number(projectId)}`;
  } else {
    query += `&project_id=is.null`;
  }
  
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  const data = Array.isArray(res.data) ? res.data.map(rowToChat) : [];
  data.reverse(); // Reverse back to chronological asc
  
  return {
    ok: true,
    status: 200,
    data,
  };
}

async function createRogerChat(input) {
  const payload = {
    session_id: Number(input?.session_id || 0),
    role: String(input?.role || 'user'),
    content: String(input?.content || '').trim(),
  };
  if (input?.project_id) {
    payload.project_id = Number(input.project_id);
  }

  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [payload],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToChat(created) };
}

async function updateRogerSession(sessionId, input) {
  const payload = {};
  if (input?.name !== undefined) payload.name = String(input.name);
  if (Object.keys(payload).length === 0) return { ok: false, status: 400, error: 'No fields to update' };

  const res = await sbQuery({
    method: 'PATCH',
    table: sessionsTable(),
    query: `id=eq.${Number(sessionId)}&select=*`,
    headers: { Prefer: 'return=representation' },
    body: payload,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 200, data: rowToSession(updated) };
}

module.exports = {
  listRogerSessions,
  createRogerSession,
  updateRogerSession,
  listRogerChats,
  createRogerChat
};
