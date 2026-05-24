'use strict';

const { sbQuery, tableConfig } = require('./supabase');

const POLL_WRITABLE_FIELDS = [
  'question',
  'category',
  'order_index',
  'is_published',
  'external_id',
  'personality_system',
  'trait_dimension',
  'scoring_logic',
  'weight',
  'reverse_scored',
  'ai_interpretation_tag',
];

function buildPollBody(pollData) {
  const body = {};
  for (const key of POLL_WRITABLE_FIELDS) {
    if (pollData[key] === undefined) continue;
    body[key] = pollData[key];
  }
  if (body.question != null) body.question = String(body.question).trim();
  if (body.category != null) body.category = String(body.category).trim() || null;
  if (body.external_id != null) body.external_id = String(body.external_id).trim() || null;
  if (body.personality_system != null) body.personality_system = String(body.personality_system).trim() || null;
  if (body.trait_dimension != null) body.trait_dimension = String(body.trait_dimension).trim() || null;
  if (body.scoring_logic != null) body.scoring_logic = String(body.scoring_logic).trim() || null;
  if (body.ai_interpretation_tag != null) {
    body.ai_interpretation_tag = String(body.ai_interpretation_tag).trim() || null;
  }
  if (body.weight != null) {
    const w = Number(body.weight);
    body.weight = Number.isFinite(w) ? w : 1;
  }
  if (body.reverse_scored != null) body.reverse_scored = Boolean(body.reverse_scored);
  if (body.is_published === undefined) body.is_published = true;
  if (body.order_index == null || body.order_index === '') body.order_index = 0;
  return body;
}

function buildOptionsBody(pollId, optionsList) {
  return optionsList.map((opt, i) => {
    const row = {
      poll_id: pollId,
      label: String(opt.label || '').trim(),
      sort_order: opt.sort_order ?? (i + 1),
    };
    if (opt.score_code != null && String(opt.score_code).trim()) {
      row.score_code = String(opt.score_code).trim();
    }
    return row;
  });
}

/**
 * List all polls, optionally with their options
 */
async function listPolls() {
  const table = tableConfig().polls;
  const optionsKey = tableConfig().pollOptions;
  // Use postgrest embedding to get options with polls if possible, 
  // or fetch them separately if foreign keys aren't introspected
  const res = await sbQuery({
    method: 'GET',
    table,
    query: `select=*,${optionsKey}(*)&order=created_at.desc`
  });
  
  if (!res.ok) {
    // Fallback: If the embedding fails due to schema cache issues, fetch separately
    const plainRes = await sbQuery({
      method: 'GET',
      table,
      query: 'order=created_at.desc'
    });
    if (!plainRes.ok) throw new Error(plainRes.error || 'Failed to list polls');
    
    const polls = plainRes.data || [];
    if (!polls.length) return [];
    
    const optionsRes = await sbQuery({
      method: 'GET',
      table: optionsKey,
      query: 'order=sort_order.asc'
    });
    
    const options = optionsRes.ok ? (optionsRes.data || []) : [];
    const optionsByPoll = {};
    for (const opt of options) {
      if (!optionsByPoll[opt.poll_id]) optionsByPoll[opt.poll_id] = [];
      optionsByPoll[opt.poll_id].push(opt);
    }
    
    return polls.map(p => ({
      ...p,
      poll_options: optionsByPoll[p.id] || []
    }));
  }
  
  return (res.data || []).map(p => {
    const pCopy = { ...p };
    if (pCopy[optionsKey]) {
      pCopy.poll_options = pCopy[optionsKey];
      if (optionsKey !== 'poll_options') delete pCopy[optionsKey];
    } else if (!pCopy.poll_options) {
      pCopy.poll_options = [];
    }
    return pCopy;
  });
}

function uniqueTableNames(names) {
  const seen = new Set();
  return names
    .map((name) => String(name || '').trim())
    .filter((name) => {
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return true;
    });
}

async function fetchPollRows(table) {
  const res = await sbQuery({
    method: 'GET',
    table,
    query: 'select=*&limit=5000',
  });
  if (!res.ok) return [];
  return Array.isArray(res.data) ? res.data : [];
}

async function listWyrQuestionPolls() {
  const tables = uniqueTableNames([
    process.env.SUPABASE_WYR_POLLS_TABLE,
    'polls',
    tableConfig().polls,
  ]);

  let fallbackRows = [];
  for (const table of tables) {
    const rows = (await fetchPollRows(table))
      .filter((row) => String(row?.question || row?.prompt || row?.text || '').trim());
    if (!rows.length) continue;
    if (table === tableConfig().polls) fallbackRows = rows;
    else return rows;
  }
  return fallbackRows;
}

/**
 * Create a new poll with options
 */
async function findPollIdByExternalId(externalId) {
  const id = String(externalId || '').trim();
  if (!id) return null;
  const table = tableConfig().polls;
  const res = await sbQuery({
    method: 'GET',
    table,
    query: `external_id=eq.${encodeURIComponent(id)}&select=id&limit=1`,
  });
  if (!res.ok) return null;
  return res.data?.[0]?.id || null;
}

async function createPoll(pollData, optionsList = []) {
  const table = tableConfig().polls;
  const body = buildPollBody({ ...pollData, is_published: pollData.is_published !== false });
  if (!body.question) throw new Error('Question is required');

  const res = await sbQuery({
    method: 'POST',
    table,
    body,
    headers: { Prefer: 'return=representation' },
  });

  if (!res.ok) throw new Error(res.error || 'Failed to create poll');
  const poll = res.data?.[0];
  if (!poll) throw new Error('No data returned on poll creation');

  const savedOptions = [];
  if (optionsList.length > 0) {
    const optsBody = buildOptionsBody(poll.id, optionsList);

    const optRes = await sbQuery({
      method: 'POST',
      table: tableConfig().pollOptions,
      body: optsBody,
      headers: { Prefer: 'return=representation' },
    });

    if (optRes.ok && optRes.data) {
      savedOptions.push(...optRes.data);
    }
  }

  return { ...poll, poll_options: savedOptions };
}

async function upsertPoll(pollData, optionsList = []) {
  const externalId = String(pollData.external_id || '').trim();
  if (externalId) {
    const existingId = await findPollIdByExternalId(externalId);
    if (existingId) {
      await updatePoll(existingId, buildPollBody(pollData), optionsList);
      return { id: existingId, updated: true };
    }
  }
  const created = await createPoll(pollData, optionsList);
  return { id: created.id, updated: false };
}

/**
 * Import mapped poll rows ({ poll, options }[]). Uses upsert when external_id is set.
 */
async function importPollRows(mappedRows, { upsert = false } = {}) {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];

  for (const mapped of mappedRows) {
    if (!mapped?.poll?.question) {
      skipped += 1;
      continue;
    }
    try {
      if (upsert && mapped.poll.external_id) {
        const result = await upsertPoll(mapped.poll, mapped.options || []);
        if (result.updated) updated += 1;
        else created += 1;
      } else {
        await createPoll(mapped.poll, mapped.options || []);
        created += 1;
      }
    } catch (err) {
      errors.push({
        external_id: mapped.poll.external_id || null,
        message: err.message || String(err),
      });
    }
  }

  return { created, updated, skipped, errors, count: created + updated };
}

/**
 * Update a poll and its options
 */
async function updatePoll(id, pollData, optionsList = null) {
  const table = tableConfig().polls;
  
  // 1. Update poll
  const patchBody = buildPollBody(pollData);
  if (Object.keys(patchBody).length > 0) {
    const res = await sbQuery({
      method: 'PATCH',
      table,
      query: `id=eq.${encodeURIComponent(id)}`,
      body: patchBody,
      headers: { Prefer: 'return=representation' },
    });
    if (!res.ok) throw new Error(res.error || 'Failed to update poll');
  }
  
  // 2. Replace options if provided
  if (optionsList !== null) {
    const optsTable = tableConfig().pollOptions;
    // Delete existing options
    await sbQuery({
      method: 'DELETE',
      table: optsTable,
      query: `poll_id=eq.${encodeURIComponent(id)}`
    });
    
    // Insert new options
    if (optionsList.length > 0) {
      const optsBody = buildOptionsBody(id, optionsList);
      await sbQuery({
        method: 'POST',
        table: optsTable,
        body: optsBody,
      });
    }
  }
  
  return { success: true };
}

/**
 * Delete a poll
 */
async function deletePoll(id) {
  const table = tableConfig().polls;
  const res = await sbQuery({
    method: 'DELETE',
    table,
    query: `id=eq.${encodeURIComponent(id)}`
  });
  if (!res.ok) throw new Error(res.error || 'Failed to delete poll');
  return { success: true };
}

module.exports = {
  listPolls,
  listWyrQuestionPolls,
  createPoll,
  updatePoll,
  deletePoll,
  upsertPoll,
  importPollRows,
  findPollIdByExternalId,
};
