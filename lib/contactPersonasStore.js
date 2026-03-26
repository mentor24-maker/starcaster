'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');

function t() { return tableConfig(); }

function safeText(value) {
  return String(value || '').trim();
}

function rowToContactPersona(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    persona: safeText(row.persona),
    description: safeText(row.description),
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
