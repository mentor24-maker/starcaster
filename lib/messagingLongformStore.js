'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const {
  scopedListQuery,
  scopedIdQuery,
  scopedInsertRow,
  scopedPatchRow,
} = require('./projectScope');

function createMessagingLongformStore(options) {
  const {
    tableKey,
    label = 'Item',
    includePdf = false,
  } = options || {};

  function table() {
    return tableConfig()[tableKey];
  }

  function safeText(value, max = 10000) {
    return String(value || '').trim().slice(0, max);
  }

  function cleanTopic(input) {
    return safeText(input?.topic != null ? input.topic : input?.category, 240);
  }

  function errorText(res) {
    return String(res?.error || res?.message || '').toLowerCase();
  }

  function shouldRetryWithoutTopic(res) {
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
    const base = {
      id: Number(row.id || 0) || 0,
      topic: safeText(row.topic || row.category, 240),
      category: safeText(row.topic || row.category, 240),
      platform: safeText(row.platform, 120),
      author: safeText(row.author, 180),
      title: safeText(row.title, 300),
      subtitle: safeText(row.subtitle, 500),
      url: safeText(row.url, 1200),
      content: safeText(row.content, 50000),
      feedback: safeText(row.feedback, 12000),
      prompt_id: Number(row.prompt_id || 0) || null,
      quality_score: Math.max(0, Math.min(Number(row.quality_score || 0) || 0, 5)),
      publish_date: row.publish_date || null,
      thumbnail_asset_id: Number(row.thumbnail_asset_id || 0) || null,
      created_at: row.created_at || '',
      updated_at: row.updated_at || '',
    };
    if (includePdf) {
      base.pdf_name = safeText(row.pdf_name, 255);
      base.pdf_mime_type = safeText(row.pdf_mime_type, 120);
      base.pdf_data_url = safeText(row.pdf_data_url, 9_000_000);
    }
    return base;
  }

  function inputToRow(input) {
    const row = {
      topic: cleanTopic(input),
      platform: safeText(input?.platform, 120),
      author: safeText(input?.author, 180),
      title: safeText(input?.title, 300),
      subtitle: safeText(input?.subtitle, 500),
      url: safeText(input?.url, 1200),
      content: safeText(input?.content, 50000),
      feedback: safeText(input?.feedback, 12000),
      prompt_id: Number(input?.prompt_id || 0) || null,
      quality_score: Math.max(0, Math.min(Number(input?.quality_score || 0) || 0, 5)),
      publish_date: input?.publish_date ? new Date(input.publish_date).toISOString() : null,
      thumbnail_asset_id: Number(input?.thumbnail_asset_id || 0) || null,
    };
    if (includePdf) {
      row.pdf_name = safeText(input?.pdf_name, 255);
      row.pdf_mime_type = safeText(input?.pdf_mime_type, 120);
      row.pdf_data_url = safeText(input?.pdf_data_url, 9_000_000);
    }
    return row;
  }

  async function list(limit = 200, scope = null) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 1000));
    const query = await scopedListQuery(
      table(),
      `select=*&order=publish_date.desc.nullslast,created_at.desc&limit=${safeLimit}`,
      scope
    );
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
    const baseRow = inputToRow(input);
    const row = await scopedInsertRow(table(), baseRow, scope);

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
    if (!res.ok && shouldRetryWithoutTopic(res)) {
      const legacyRow = { ...row };
      delete legacyRow.topic;
      res = await sbQuery({
        method: 'POST',
        table: table(),
        query: 'select=*',
        headers: { Prefer: 'return=representation' },
        body: [legacyRow],
      });
      if (!res.ok && shouldRetryWithoutFeedback(res)) {
        const legacyNoFeedbackRow = { ...legacyRow };
        delete legacyNoFeedbackRow.feedback;
        res = await sbQuery({
          method: 'POST',
          table: table(),
          query: 'select=*',
          headers: { Prefer: 'return=representation' },
          body: [legacyNoFeedbackRow],
        });
      }
    }
    if (!res.ok) return res;
    const created = Array.isArray(res.data) ? res.data[0] : res.data;
    return {
      ok: true,
      status: 201,
      data: rowToItem(created),
    };
  }

  async function update(id, input, scope = null) {
    const itemId = Number(id || 0) || 0;
    if (!itemId) return { ok: false, status: 400, error: 'id is required' };
    const baseRow = inputToRow(input);
    const row = await scopedPatchRow(table(), baseRow, scope);
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
    if (!res.ok && shouldRetryWithoutTopic(res)) {
      const legacyRow = { ...row };
      delete legacyRow.topic;
      res = await sbQuery({
        method: 'PATCH',
        table: table(),
        query,
        headers: { Prefer: 'return=representation' },
        body: legacyRow,
      });
      if (!res.ok && shouldRetryWithoutFeedback(res)) {
        const legacyNoFeedbackRow = { ...legacyRow };
        delete legacyNoFeedbackRow.feedback;
        res = await sbQuery({
          method: 'PATCH',
          table: table(),
          query,
          headers: { Prefer: 'return=representation' },
          body: legacyNoFeedbackRow,
        });
      }
    }
    if (!res.ok) return res;
    const updated = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!updated) return { ok: false, status: 404, error: `${label} not found` };
    return {
      ok: true,
      status: 200,
      data: rowToItem(updated),
    };
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
    return {
      ok: true,
      status: 200,
      data: rowToItem(deleted),
    };
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
  createMessagingLongformStore,
};
