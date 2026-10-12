'use strict';

/**
 * Reddit comments 1/4 (task 86bch3jmr) — Dane of Earth's canon, copied out of
 * his vault into the database so a drafter on Vercel can read it.
 *
 * Table: docs/SQL/canon_documents_setup.sql. The only writer is
 * `npm run canon:sync` (scripts/sync_canon.mjs, logic in lib/canonSync.js).
 *
 * Every function returns the `{ ok, status, data }` envelope (DOCTRINE 5.10);
 * the list takes the limit FIRST (landmine 12b).
 *
 * TENANCY FAILS CLOSED. Both tenant columns are written explicitly from the
 * scope rather than through scopedInsertRow, whose column probe can quietly
 * stamp neither (landmine 12). A scope without a project AND a user is refused
 * before any request is made.
 *
 * THE DATABASE IS THE ONLY STORE. There is no local-file fallback: when
 * PostgREST refuses a write, the caller gets `ok: false` with its reason
 * (landmine 15 — a fallback is for a store being ABSENT, never for it refusing).
 */

const crypto = require('crypto');
const supabase = require('./supabase');
const { resolveLimit } = require('./storeLimit');

const DOC_KEY_RE = /^[A-Z0-9][A-Z0-9-]{0,79}$/;

function table() {
  return supabase.tableConfig().canonDocuments || 'canon_documents';
}

function safeText(value, max = 400) {
  return String(value ?? '').trim().slice(0, max);
}

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

/** sha256 of a document's body — what "unchanged" is decided on. */
function hashCanon(body) {
  return crypto.createHash('sha256').update(String(body ?? ''), 'utf8').digest('hex');
}

function scopeOrError(scope) {
  const projectId = safeText(scope?.projectId || scope?.project_id, 120);
  const userId = safeText(scope?.userId || scope?.user_id, 120);
  if (!projectId) return { error: refuse('No project was given, so there is no canon to read or write.') };
  if (!userId) return { error: refuse('No owner was given for the canon rows — both tenant columns are required.') };
  return { projectId, userId };
}

function rowToDoc(row) {
  return {
    id: row.id,
    projectId: row.project_id ?? '',
    ownerUserId: row.owner_user_id ?? '',
    docKey: row.doc_key,
    title: row.title || '',
    body: row.body || '',
    sourcePath: row.source_path || '',
    contentHash: row.content_hash || '',
    syncedAt: row.synced_at || null,
  };
}

/** Every canon document in the project, by doc_key. */
async function listCanon(limit, scope) {
  const lim = resolveLimit(limit, { fallback: 100, max: 500 });
  if (!lim.ok) return refuse(lim.error);
  const s = scopeOrError(scope);
  if (s.error) return s.error;

  const res = await supabase.sbQuery({
    table: table(),
    query: `select=*&project_id=eq.${encodeURIComponent(s.projectId)}&order=doc_key.asc&limit=${lim.limit}`,
  });
  if (!res.ok) return refuse(`Could not read the canon: ${res.error}`, res.status || 502);
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToDoc) };
}

/**
 * Insert or replace one document, keyed on (project_id, doc_key).
 * `doc` is { docKey, title, body, sourcePath }; the hash and sync time are
 * computed here so a caller cannot record a hash that does not match the body.
 */
async function upsertCanonDocument(doc, scope) {
  const s = scopeOrError(scope);
  if (s.error) return s.error;
  const docKey = safeText(doc?.docKey ?? doc?.doc_key, 80);
  if (!DOC_KEY_RE.test(docKey)) return refuse(`"${docKey}" is not a canon key (capitals, digits and dashes, e.g. DANE-OF-EARTH).`);
  const body = String(doc?.body ?? '');
  if (!body.trim()) return refuse(`${docKey} has an empty body — refusing to store a blank canon document.`);

  const now = new Date().toISOString();
  const row = {
    project_id: s.projectId,
    owner_user_id: s.userId,
    doc_key: docKey,
    title: safeText(doc?.title, 300),
    body,
    source_path: safeText(doc?.sourcePath ?? doc?.source_path, 300),
    content_hash: hashCanon(body),
    synced_at: now,
    updated_at: now,
  };

  const res = await supabase.sbQuery({
    method: 'POST',
    table: table(),
    query: 'on_conflict=project_id,doc_key',
    body: [row],
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
  });
  if (!res.ok) {
    return refuse(`Could not save canon document ${docKey}: ${res.error}`, res.status || 502);
  }
  const saved = Array.isArray(res.data) ? res.data[0] : null;
  if (!saved) return refuse(`Saving canon document ${docKey} returned no row.`, 502);
  return { ok: true, status: res.status || 200, data: rowToDoc(saved) };
}

module.exports = { listCanon, upsertCanonDocument, hashCanon, DOC_KEY_RE };
