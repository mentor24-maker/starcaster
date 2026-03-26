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

function rowToContactPersona(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    persona: safeText(row.persona),
    description: safeText(row.description),
    tags: normalizeTags(row.tags),
    parentPersonaId: Number(row.parent_persona_id || 0) || null,
    createdAt: safeText(row.created_at),
    updatedAt: safeText(row.updated_at),
  };
}

async function listContactPersonas(scope = null) {
  const query = await scopedListQuery(
    t().contactPersonas,
    'select=*&order=persona.asc&limit=5000',
    scope
  );
  return sbQuery({
    table: t().contactPersonas,
    query,
  });
}

async function createContactPersona(input, scope = null) {
  const row = await scopedInsertRow(t().contactPersonas, {
    persona: safeText(input.persona),
    description: safeText(input.description),
    tags: normalizeTags(input.tags),
    parent_persona_id: Number(input.parentPersonaId || input.parent_persona_id || 0) || null,
  }, scope);
  return sbQuery({
    method: 'POST',
    table: t().contactPersonas,
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
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
  if (input.description != null) patch.description = safeText(input.description);
  if (input.tags != null) patch.tags = normalizeTags(input.tags);
  if (input.parentPersonaId != null || input.parent_persona_id != null) {
    patch.parent_persona_id = Number(input.parentPersonaId || input.parent_persona_id || 0) || null;
  }
  if (!Object.keys(patch).length) {
    return { ok: false, status: 400, error: 'No fields to update' };
  }

  const scopedPatch = await scopedPatchRow(t().contactPersonas, patch, scope);
  const query = await scopedIdQuery(t().contactPersonas, `id=eq.${id}&select=*`, scope);
  return sbQuery({
    method: 'PATCH',
    table: t().contactPersonas,
    query,
    headers: { Prefer: 'return=representation' },
    body: scopedPatch,
  });
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
