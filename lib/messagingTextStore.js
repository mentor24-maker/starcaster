'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const {
  scopedListQuery,
  scopedIdQuery,
  scopedInsertRow,
  scopedPatchRow,
} = require('./projectScope');

function defaultNormalize(value) {
  return value;
}

function createMessagingTextStore(options) {
  const {
    tableKey,
    field,
    label = field,
    maxLength = 4000,
    normalize = defaultNormalize,
  } = options || {};

  function table() {
    return tableConfig()[tableKey];
  }

  function clean(value, max = maxLength) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
  }

  function normalizeFieldValue(value) {
    return clean(normalize(clean(value, maxLength)) || '', maxLength);
  }

  function cleanTopic(input) {
    return clean(input?.topic != null ? input.topic : input?.category, 240);
  }

  function errorText(res) {
    return String(res?.error || res?.message || '').toLowerCase();
  }

  function shouldRetryWithLegacyCategory(res) {
    const text = errorText(res);
    return text.includes('topic') && (text.includes('column') || text.includes('schema cache'));
  }

  function shouldRetryWithoutFeedback(res) {
    const text = errorText(res);
    return text.includes('feedback') && (text.includes('column') || text.includes('schema cache'));
  }

  function shouldRetryWithoutPromptId(res) {
    const text = errorText(res);
    return text.includes('prompt_id') && (text.includes('column') || text.includes('schema cache'));
  }

  function shouldRetryWithoutQualityScore(res) {
    const text = errorText(res);
    return text.includes('quality_score') && (text.includes('column') || text.includes('schema cache'));
  }

  function rowToItem(row) {
    if (!row) return null;
    const topic = clean(row.topic != null ? row.topic : row.category, 240);
    return {
      id: Number(row.id || 0) || 0,
      [field]: normalizeFieldValue(row[field]),
      topic,
      category: topic,
      feedback: clean(row.feedback, 12000),
      prompt_id: Number(row.prompt_id || 0) || null,
      quality_score: Math.max(0, Math.min(Number(row.quality_score || 0) || 0, 5)),
      created_at: String(row.created_at || ''),
      updated_at: String(row.updated_at || ''),
    };
  }

  function inputToRow(input) {
    return {
      [field]: normalizeFieldValue(input?.[field]),
      topic: cleanTopic(input),
      feedback: clean(input?.feedback, 12000),
      prompt_id: Number(input?.prompt_id || 0) || null,
      quality_score: Math.max(0, Math.min(Number(input?.quality_score || 0) || 0, 5)),
    };
  }

  async function list(limit = 5000, scope = null) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 5000, 5000));
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
      data: Array.isArray(res.data) ? res.data.map(rowToItem) : [],
    };
  }

  async function create(input, scope = null) {
    const row = await scopedInsertRow(table(), inputToRow(input), scope);
    let res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [row],
    });
    if (!res.ok && shouldRetryWithoutFeedback(res)) {
      const noFeedbackRow = { ...row };
      delete noFeedbackRow.feedback;
      res = await sbQuery({
        method: 'POST',
        table: table(),
        query: 'select=*',
        headers: { Prefer: 'return=representation' },
        body: [noFeedbackRow],
      });
    }
    if (!res.ok && shouldRetryWithoutPromptId(res)) {
      const noPromptRow = { ...row };
      delete noPromptRow.prompt_id;
      res = await sbQuery({
        method: 'POST',
        table: table(),
        query: 'select=*',
        headers: { Prefer: 'return=representation' },
        body: [noPromptRow],
      });
    }
    if (!res.ok && shouldRetryWithoutQualityScore(res)) {
      const noQualityRow = { ...row };
      delete noQualityRow.quality_score;
      res = await sbQuery({
        method: 'POST',
        table: table(),
        query: 'select=*',
        headers: { Prefer: 'return=representation' },
        body: [noQualityRow],
      });
    }
    if (!res.ok && shouldRetryWithLegacyCategory(res)) {
      const legacyBody = { [field]: row[field], category: cleanTopic(input) };
      if (!shouldRetryWithoutFeedback(res) && row.feedback) legacyBody.feedback = row.feedback;
      if (!shouldRetryWithoutPromptId(res) && row.prompt_id) legacyBody.prompt_id = row.prompt_id;
      if (!shouldRetryWithoutQualityScore(res) && row.quality_score) legacyBody.quality_score = row.quality_score;
      res = await sbQuery({
        method: 'POST',
        table: table(),
        query: 'select=*',
        headers: { Prefer: 'return=representation' },
        body: [await scopedInsertRow(table(), legacyBody, scope)],
      });
      if (!res.ok && shouldRetryWithoutFeedback(res)) {
        res = await sbQuery({
          method: 'POST',
          table: table(),
          query: 'select=*',
          headers: { Prefer: 'return=representation' },
          body: [await scopedInsertRow(table(), { [field]: row[field], category: cleanTopic(input) }, scope)],
        });
      }
    }
    if (!res.ok) return res;
    const created = Array.isArray(res.data) ? res.data[0] : res.data;
    return { ok: true, status: 201, data: rowToItem(created) };
  }

  async function update(id, input, scope = null) {
    const itemId = Number(id || 0) || 0;
    if (!itemId) return { ok: false, status: 400, error: 'id is required' };
    const row = await scopedPatchRow(table(), inputToRow(input), scope);
    const query = await scopedIdQuery(table(), `id=eq.${itemId}&select=*`, scope);
    let res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: row,
    });
    if (!res.ok && shouldRetryWithoutFeedback(res)) {
      const noFeedbackRow = { ...row };
      delete noFeedbackRow.feedback;
      res = await sbQuery({
        method: 'PATCH',
        table: table(),
        query,
        headers: { Prefer: 'return=representation' },
        body: noFeedbackRow,
      });
    }
    if (!res.ok && shouldRetryWithoutPromptId(res)) {
      const noPromptRow = { ...row };
      delete noPromptRow.prompt_id;
      res = await sbQuery({
        method: 'PATCH',
        table: table(),
        query,
        headers: { Prefer: 'return=representation' },
        body: noPromptRow,
      });
    }
    if (!res.ok && shouldRetryWithoutQualityScore(res)) {
      const noQualityRow = { ...row };
      delete noQualityRow.quality_score;
      res = await sbQuery({
        method: 'PATCH',
        table: table(),
        query,
        headers: { Prefer: 'return=representation' },
        body: noQualityRow,
      });
    }
    if (!res.ok && shouldRetryWithLegacyCategory(res)) {
      const legacyBody = { [field]: row[field], category: cleanTopic(input) };
      if (!shouldRetryWithoutFeedback(res) && row.feedback) legacyBody.feedback = row.feedback;
      if (!shouldRetryWithoutPromptId(res) && row.prompt_id) legacyBody.prompt_id = row.prompt_id;
      if (!shouldRetryWithoutQualityScore(res) && row.quality_score) legacyBody.quality_score = row.quality_score;
      res = await sbQuery({
        method: 'PATCH',
        table: table(),
        query,
        headers: { Prefer: 'return=representation' },
        body: await scopedPatchRow(table(), legacyBody, scope),
      });
      if (!res.ok && shouldRetryWithoutFeedback(res)) {
        res = await sbQuery({
          method: 'PATCH',
          table: table(),
          query,
          headers: { Prefer: 'return=representation' },
          body: await scopedPatchRow(table(), { [field]: row[field], category: cleanTopic(input) }, scope),
        });
      }
    }
    if (!res.ok) return res;
    const updated = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!updated) return { ok: false, status: 404, error: `${label} not found` };
    return { ok: true, status: 200, data: rowToItem(updated) };
  }

  async function remove(id, scope = null) {
    const itemId = Number(id || 0) || 0;
    if (!itemId) return { ok: false, status: 400, error: 'id is required' };
    const query = await scopedIdQuery(table(), `id=eq.${itemId}&select=*`, scope);
    const res = await sbQuery({
      method: 'DELETE',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
    });
    if (!res.ok) return res;
    const deleted = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!deleted) return { ok: false, status: 404, error: `${label} not found` };
    return { ok: true, status: 200, data: rowToItem(deleted) };
  }

  return {
    list,
    create,
    update,
    remove,
    rowToItem,
  };
}

module.exports = {
  createMessagingTextStore,
};
