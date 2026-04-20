'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');

function t() { return tableConfig(); }

function safeText(value) {
  return String(value || '').trim();
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map((item) => safeText(item)).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((item) => safeText(item))
    .filter(Boolean);
}

function extractMissingColumn(error) {
  const text = safeText(error);
  if (!text) return '';
  const match = text.match(/Could not find the '([^']+)' column/i);
  return match ? safeText(match[1]) : '';
}

async function retryWithoutMissingColumns(runQuery, rowInput) {
  const attempted = new Set();
  let currentInput = { ...(rowInput || {}) };

  for (;;) {
    const result = await runQuery(currentInput);
    if (result && result.ok) return result;
    const missingColumn = extractMissingColumn(result && result.error);
    if (!missingColumn || attempted.has(missingColumn) || !(missingColumn in currentInput)) {
      return result;
    }
    attempted.add(missingColumn);
    delete currentInput[missingColumn];
  }
}

function rowToContactPersona(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    type: safeText(row.type) || 'persona',
    persona: safeText(row.persona),
    description: safeText(row.description),
    tags: normalizeTags(row.tags),
    parentPersonaId: Number(row.parent_persona_id || 0) || null,
    createdAt: safeText(row.created_at),
    updatedAt: safeText(row.updated_at),
  };
}

async function listContactPersonas(scope = null, queryParams = {}) {
  let baseQuery = 'select=*&order=persona.asc&limit=5000';
  if (queryParams && queryParams.type) {
    baseQuery += '&type=eq.' + encodeURIComponent(safeText(queryParams.type));
  }
  const query = await scopedListQuery(
    t().contactPersonas,
    baseQuery,
    scope
  );
  return sbQuery({
    table: t().contactPersonas,
    query,
  });
}

async function createContactPersona(input, scope = null) {
  const rowInput = {
    persona: safeText(input.persona),
    type: safeText(input.type) || 'persona',
    description: safeText(input.description),
  };
  const normalizedTags = normalizeTags(input.tags);
  if (normalizedTags.length) rowInput.tags = normalizedTags;
  const parentPersonaId = Number(input.parentPersonaId || input.parent_persona_id || 0) || 0;
  if (parentPersonaId > 0) rowInput.parent_persona_id = parentPersonaId;

  const row = await scopedInsertRow(t().contactPersonas, rowInput, scope);
  return retryWithoutMissingColumns(
    (candidateRow) => sbQuery({
      method: 'POST',
      table: t().contactPersonas,
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [candidateRow],
    }),
    row
  );
}

async function getContactPersonaById(personaId, scope = null) {
  const id = Number(personaId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid persona id is required' };
  }
  const query = await scopedIdQuery(t().contactPersonas, `select=*&id=eq.${id}&limit=1`, scope);
  return sbQuery({
    table: t().contactPersonas,
    query,
  });
}

async function updateContactPersona(personaId, input, scope = null) {
  const id = Number(personaId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid persona id is required' };
  }

  const patch = {};
  if (input.persona != null) patch.persona = safeText(input.persona);
  if (input.type != null) patch.type = safeText(input.type);
  if (input.description != null) patch.description = safeText(input.description);
  if (input.tags != null) {
    const normalizedTags = normalizeTags(input.tags);
    if (normalizedTags.length) patch.tags = normalizedTags;
  }
  if ((input.parentPersonaId != null || input.parent_persona_id != null) && String(input.parentPersonaId || input.parent_persona_id || '').trim()) {
    patch.parent_persona_id = Number(input.parentPersonaId || input.parent_persona_id || 0) || null;
  }
  if (!Object.keys(patch).length) {
    return { ok: false, status: 400, error: 'No fields to update' };
  }

  const scopedPatch = await scopedPatchRow(t().contactPersonas, patch, scope);
  const query = await scopedIdQuery(t().contactPersonas, `id=eq.${id}&select=*`, scope);
  return retryWithoutMissingColumns(
    (candidatePatch) => sbQuery({
      method: 'PATCH',
      table: t().contactPersonas,
      query,
      headers: { Prefer: 'return=representation' },
      body: candidatePatch,
    }),
    scopedPatch
  );
}

async function deleteContactPersona(personaId, scope = null) {
  const id = Number(personaId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'Valid persona id is required' };
  }
  const query = await scopedIdQuery(t().contactPersonas, `id=eq.${id}&select=*`, scope);
  return sbQuery({
    method: 'DELETE',
    table: t().contactPersonas,
    query,
    headers: { Prefer: 'return=representation' },
  });
}

module.exports = {
  rowToContactPersona,
  listContactPersonas,
  createContactPersona,
  getContactPersonaById,
  updateContactPersona,
  deleteContactPersona,
};
