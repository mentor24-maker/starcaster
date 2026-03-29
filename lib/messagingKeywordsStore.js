'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { createMessagingTextStore } = require('./messagingTextStore');
const { scopedInsertRow } = require('./projectScope');

const base = createMessagingTextStore({
  tableKey: 'messagingKeywords',
  field: 'keyword',
  label: 'Keyword',
  maxLength: 240,
});

function clean(value, max = 240) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function errorText(res) {
  return String(res?.error || res?.message || '').toLowerCase();
}

function shouldRetryWithLegacyCategory(res) {
  const text = errorText(res);
  return text.includes('topic') && (text.includes('column') || text.includes('schema cache'));
}

async function createMessagingKeyword(input, scope = null) {
  const keyword = clean(input?.keyword, 240);
  const topic = clean(input?.topic != null ? input.topic : input?.category, 240);
  if (!keyword) return { ok: false, status: 400, error: 'keyword is required' };
  const row = await scopedInsertRow(tableConfig().messagingKeywords, { keyword, topic }, scope);
  let res = await sbQuery({
    method: 'POST',
    table: tableConfig().messagingKeywords,
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok && shouldRetryWithLegacyCategory(res)) {
    const legacyRow = await scopedInsertRow(tableConfig().messagingKeywords, { keyword, category: topic }, scope);
    res = await sbQuery({
      method: 'POST',
      table: tableConfig().messagingKeywords,
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [legacyRow],
    });
  }
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: base.rowToItem(created) };
}

module.exports = {
  listMessagingKeywords: base.list,
  createMessagingKeyword,
  updateMessagingKeyword: base.update,
  deleteMessagingKeyword: base.remove,
  rowToKeyword: base.rowToItem,
};
