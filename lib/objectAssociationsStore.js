'use strict';

/**
 * lib/objectAssociationsStore.js
 * Two-way links between any two objects (see docs/SQL/object_associations_setup.sql).
 *
 * A link has no direction. To keep one pair from being stored twice — once as
 * A->B and once as B->A — the two sides are put in canonical order before
 * writing: whichever "type:id" sorts first becomes side A. The unique index in
 * the database enforces the same thing, so a duplicate is rejected rather than
 * silently doubled.
 *
 * Reads run from either side, which is the whole point: the old
 * asset_associations table could only answer "what is linked to this asset?",
 * never "what is linked to this tweet?".
 */

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow } = require('./projectScope');
const { isKnownAssociationType } = require('./associationTypes');

const LIST_LIMIT = 500;

function tableName() {
  return tableConfig().objectAssociations || 'object_associations';
}

function safeText(value, max = 240) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

/**
 * Accepts {type, id, label} in either camelCase or snake_case and returns a
 * clean reference, or null when it is unusable.
 */
function normalizeObjectRef(input) {
  if (!input || typeof input !== 'object') return null;
  const type = safeText(input.type ?? input.objectType ?? input.object_type, 80);
  const id = safeText(input.id ?? input.objectId ?? input.object_id, 120);
  if (!type || !id) return null;
  return { type, id, label: safeText(input.label ?? input.objectLabel ?? input.object_label, 200) };
}

function objectKey(ref) {
  return ref ? `${ref.type}:${ref.id}` : '';
}

function sameObject(left, right) {
  return Boolean(left) && Boolean(right) && objectKey(left) === objectKey(right);
}

/**
 * Puts two references into the fixed order the table stores them in.
 * Returns { ok: false, error } for anything that cannot be a valid link.
 */
function canonicalPair(firstInput, secondInput) {
  const first = normalizeObjectRef(firstInput);
  const second = normalizeObjectRef(secondInput);
  if (!first) return { ok: false, error: 'Both sides of an association need a type and an id' };
  if (!second) return { ok: false, error: 'Both sides of an association need a type and an id' };
  if (!isKnownAssociationType(first.type)) return { ok: false, error: `Unknown object type "${first.type}"` };
  if (!isKnownAssociationType(second.type)) return { ok: false, error: `Unknown object type "${second.type}"` };
  if (sameObject(first, second)) return { ok: false, error: 'An object cannot be associated with itself' };

  const firstLeads = objectKey(first) <= objectKey(second);
  return {
    ok: true,
    a: firstLeads ? first : second,
    b: firstLeads ? second : first,
  };
}

function rowToAssociation(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    a: { type: safeText(row.a_type, 80), id: safeText(row.a_id, 120), label: safeText(row.a_label, 200) },
    b: { type: safeText(row.b_type, 80), id: safeText(row.b_id, 120), label: safeText(row.b_label, 200) },
    createdAt: String(row.created_at || ''),
  };
}

/**
 * Given an association and the object you looked it up by, returns the OTHER
 * side — the thing that is linked to you. Returns null if the association does
 * not actually involve that object.
 */
function associationOtherSide(association, selfInput) {
  const self = normalizeObjectRef(selfInput);
  if (!association || !self) return null;
  if (sameObject(association.a, self)) return association.b;
  if (sameObject(association.b, self)) return association.a;
  return null;
}

/**
 * Everything linked to one object, from either side.
 *
 * Deliberately two queries rather than one OR: scopedListQuery already appends
 * its own `or=` for project scoping, and PostgREST cannot take two `or=`
 * parameters on one request. Merging two scoped reads keeps the tenant filter
 * intact, which matters more than the extra round trip.
 */
async function listAssociationsForObject(refInput, scope = null) {
  const ref = normalizeObjectRef(refInput);
  if (!ref) return { ok: false, status: 400, error: 'type and id are required' };
  if (!isKnownAssociationType(ref.type)) {
    return { ok: false, status: 400, error: `Unknown object type "${ref.type}"` };
  }

  const type = encodeURIComponent(ref.type);
  const id = encodeURIComponent(ref.id);
  const sides = [
    `select=*&a_type=eq.${type}&a_id=eq.${id}&order=created_at.desc&limit=${LIST_LIMIT}`,
    `select=*&b_type=eq.${type}&b_id=eq.${id}&order=created_at.desc&limit=${LIST_LIMIT}`,
  ];

  const rows = [];
  const seen = new Set();
  for (const base of sides) {
    const query = await scopedListQuery(tableName(), base, scope);
    const res = await sbQuery({ table: tableName(), query });
    if (!res.ok) return res;
    for (const row of Array.isArray(res.data) ? res.data : []) {
      const key = String(row?.id || '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }

  rows.sort((left, right) => String(right?.created_at || '').localeCompare(String(left?.created_at || '')));
  return { ok: true, status: 200, data: rows };
}

async function createAssociation(input, scope = null) {
  const pair = canonicalPair(input?.a ?? input?.from, input?.b ?? input?.to);
  if (!pair.ok) return { ok: false, status: 400, error: pair.error };

  const row = await scopedInsertRow(tableName(), {
    a_type: pair.a.type,
    a_id: pair.a.id,
    a_label: pair.a.label,
    b_type: pair.b.type,
    b_id: pair.b.id,
    b_label: pair.b.label,
  }, scope);

  return sbQuery({
    method: 'POST',
    table: tableName(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
}

async function deleteAssociation(associationId, scope = null) {
  const id = Number(associationId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    return { ok: false, status: 400, error: 'association id is required' };
  }
  const query = await scopedIdQuery(tableName(), `id=eq.${id}&select=*`, scope);
  return sbQuery({
    method: 'DELETE',
    table: tableName(),
    query,
    headers: { Prefer: 'return=representation' },
  });
}

module.exports = {
  normalizeObjectRef,
  objectKey,
  sameObject,
  canonicalPair,
  rowToAssociation,
  associationOtherSide,
  listAssociationsForObject,
  createAssociation,
  deleteAssociation,
};
