'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const {
  scopedListQuery,
  scopedIdQuery,
  scopedInsertRow,
} = require('./projectScope');

function table() {
  return tableConfig().messagingPrompts;
}

function clean(value, max = 12000) {
  return String(value || '').trim().slice(0, max);
}

function rowToPrompt(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    format: clean(row.format, 160),
    topic: clean(row.topic, 240),
    prompt_text: clean(row.prompt_text, 20000),
    prompt_kind: clean(row.prompt_kind, 80),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

function inputToRow(input) {
  return {
    format: clean(input?.format, 160),
    topic: clean(input?.topic, 240),
    prompt_text: clean(input?.prompt_text, 20000),
    prompt_kind: clean(input?.prompt_kind, 80),
  };
}

async function listMessagingPrompts(limit = 200, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
  const query = await scopedListQuery(table(), `select=*&order=created_at.desc&limit=${safeLimit}`, scope);
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToPrompt) : [],
  };
}

async function getMessagingPrompt(id, scope = null) {
  const itemId = Number(id || 0) || 0;
  if (!itemId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `id=eq.${itemId}&select=*&limit=1`, scope);
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Prompt not found' };
  return { ok: true, status: 200, data: rowToPrompt(row) };
}

async function createMessagingPrompt(input, scope = null) {
  const row = await scopedInsertRow(table(), inputToRow(input), scope);
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToPrompt(created) };
}

module.exports = {
  listMessagingPrompts,
  getMessagingPrompt,
  createMessagingPrompt,
};
