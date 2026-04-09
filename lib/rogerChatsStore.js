'use strict';

const { sbQuery, tableConfig } = require('./supabase');

function table() {
  return tableConfig().rogerChats || 'roger_chats';
}

function rowToChat(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    project_id: Number(row.project_id || 0) || null,
    role: String(row.role || ''),
    content: String(row.content || ''),
    created_at: String(row.created_at || ''),
  };
}

async function listRogerChats(projectId = null, limit = 50) {
  let query = `select=*&order=id.asc&limit=${limit}`;
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
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToChat) : [],
  };
}

async function createRogerChat(input) {
  const payload = {
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

module.exports = {
  listRogerChats,
  createRogerChat
};
