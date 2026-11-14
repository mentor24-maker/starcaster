'use strict';

/**
 * Context entries — written reference material a project keeps for agent
 * sessions to read (Assets › Context, ticket SC-808).
 *
 * Table: docs/SQL/context_entries_setup.sql. Slice 1 stores notes (a title and
 * rich text). File uploads are SC-809, and the agent read-out is SC-810.
 *
 * Every function returns the `{ ok, status, data }` envelope, never a bare row
 * (DOCTRINE 5.10). The list takes the limit FIRST (CLAUDE.md landmine 12b).
 *
 * TENANCY FAILS CLOSED. Every query filters on `project_id = <active project>`
 * written out here, rather than through lib/projectScope.js's compat filter,
 * which also lets NULL-project legacy rows through. A new table has no legacy
 * rows, so it has no reason to accept that. And if the table is missing its
 * tenant columns (or is missing altogether), the store refuses with 503 and
 * names the SQL file, rather than reading unscoped.
 *
 * A database refusal is reported as an error. There is no local-file fallback
 * (CLAUDE.md landmines 6 and 15).
 */

const { sbQuery } = require('./supabase');
const { supportsProjectColumns } = require('./projectScope');
const { resolveLimit } = require('./storeLimit');

const TABLE = 'context_entries';
const SQL_FILE = 'docs/SQL/context_entries_setup.sql';

const MAX_TITLE = 200;
// Rich text is HTML, which is wordy; 1MB holds a long document comfortably and
// keeps one entry from swallowing a request.
const MAX_BODY = 1_000_000;

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

function safeText(value, max = 2000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

// The database answering "no such table / no such column", as opposed to not
// answering. Same test lib/projectScope.js uses before caching a refusal.
function isDefiniteMissing(probe) {
  if (probe.status === 400 || probe.status === 404) return true;
  const text = String(probe.error || '').toLowerCase();
  return text.includes('does not exist') || text.includes('schema cache')
    || text.includes('project_id') || text.includes('owner_user_id');
}

async function requireScope(scope) {
  const projectId = safeText(scope?.projectId || scope?.project_id, 120);
  if (!projectId) return refuse('No project is selected, so there are no context entries to read or change.');
  const supported = await supportsProjectColumns(TABLE);
  if (!supported) {
    // supportsProjectColumns answers false for two different things: the
    // database saying the table (or its tenant columns) is not there, and the
    // question never arriving at all (a timeout, a 502, a cold start). Only
    // the first is a reason to send anyone to run the SQL file, so ask once
    // more ourselves and tell the two apart.
    const probe = await sbQuery({ table: TABLE, query: 'select=project_id,owner_user_id&limit=1' });
    if (!probe.ok) {
      if (isDefiniteMissing(probe)) {
        return refuse(
          'The context entries table is not in this database yet, so nothing can be read or saved. '
          + `It is created by ${SQL_FILE}.`,
          503
        );
      }
      return refuse(
        'Could not reach the database to check the context entries table, so nothing was read or saved. '
        + 'Try again in a moment.',
        503
      );
    }
  }
  return { ok: true, projectId, userId: safeText(scope?.userId || scope?.user_id, 120) };
}

function rowToEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    bodyHtml: row.body_html || '',
    fileUrl: row.file_url || '',
    fileName: row.file_name || '',
    fileType: row.file_type || '',
    fileSize: row.file_size == null ? null : Number(row.file_size),
    projectId: row.project_id,
    ownerUserId: row.owner_user_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function checkTitle(value) {
  const title = safeText(value, MAX_TITLE + 1).replace(/\s+/g, ' ');
  if (!title) return { ok: false, message: 'An entry needs a title.' };
  if (title.length > MAX_TITLE) return { ok: false, message: `A title can be at most ${MAX_TITLE} characters.` };
  return { ok: true, title };
}

function checkBody(value) {
  if (value != null && typeof value !== 'string') return { ok: false, message: 'bodyHtml must be text.' };
  const body = String(value || '');
  if (body.length > MAX_BODY) return { ok: false, message: 'This entry is too long to save (over 1MB of text).' };
  return { ok: true, body };
}

// An id that is not a uuid cannot match a row, and Postgres answers it with a
// 400 about uuid syntax that reads like a server fault. Say "not found".
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkId(id) {
  const entryId = safeText(id, 80);
  if (!entryId) return refuse('Which entry? No id was given.');
  if (!UUID.test(entryId)) return refuse('That context entry is not in this project.', 404);
  return { ok: true, entryId };
}

function idPart(entry, projectId) {
  return `id=eq.${encodeURIComponent(entry)}&project_id=eq.${encodeURIComponent(projectId)}`;
}

/** This project's entries, most recently changed first. Limit FIRST. */
async function listEntries(limit, scope) {
  const lim = resolveLimit(limit, { fallback: 500, max: 2000 });
  if (!lim.ok) return refuse(lim.error, 500);
  const gate = await requireScope(scope);
  if (!gate.ok) return gate;
  const query = `select=*&project_id=eq.${encodeURIComponent(gate.projectId)}`
    + `&order=updated_at.desc&limit=${lim.limit}`;
  const res = await sbQuery({ method: 'GET', table: TABLE, query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToEntry) };
}

async function getEntry(id, scope) {
  const idCheck = checkId(id);
  if (!idCheck.ok) return idCheck;
  const { entryId } = idCheck;
  const gate = await requireScope(scope);
  if (!gate.ok) return gate;
  const res = await sbQuery({ method: 'GET', table: TABLE, query: `select=*&${idPart(entryId, gate.projectId)}&limit=1` });
  if (!res.ok) return res;
  const found = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!found) return refuse('That context entry is not in this project.', 404);
  return { ok: true, status: 200, data: rowToEntry(found) };
}

/** A new note. Stamps BOTH tenant columns itself (landmine 12). */
async function createEntry(input = {}, scope) {
  const title = checkTitle(input.title);
  if (!title.ok) return refuse(title.message);
  const body = checkBody(input.bodyHtml);
  if (!body.ok) return refuse(body.message);
  const gate = await requireScope(scope);
  if (!gate.ok) return gate;

  const now = new Date().toISOString();
  const row = {
    project_id: gate.projectId,
    owner_user_id: gate.userId || null,
    title: title.title,
    kind: 'note',
    body_html: body.body,
    created_at: now,
    updated_at: now,
  };
  const res = await sbQuery({
    method: 'POST',
    table: TABLE,
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const saved = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!saved) return refuse('The entry was not saved: the database returned no row.', 500);
  return { ok: true, status: 201, data: rowToEntry(saved) };
}

/** Change an entry's title and/or text. Only this project's own entries. */
async function updateEntry(id, input = {}, scope) {
  const idCheck = checkId(id);
  if (!idCheck.ok) return idCheck;
  const { entryId } = idCheck;
  const body = { updated_at: new Date().toISOString() };
  if (input.title != null) {
    const title = checkTitle(input.title);
    if (!title.ok) return refuse(title.message);
    body.title = title.title;
  }
  // null means "not sent", exactly like undefined: a client that nulls a
  // field it did not touch must not erase the note.
  if (input.bodyHtml != null) {
    const checked = checkBody(input.bodyHtml);
    if (!checked.ok) return refuse(checked.message);
    body.body_html = checked.body;
  }
  if (Object.keys(body).length === 1) return refuse('Nothing to change: send title or bodyHtml.');
  const gate = await requireScope(scope);
  if (!gate.ok) return gate;

  const res = await sbQuery({
    method: 'PATCH',
    table: TABLE,
    query: `${idPart(entryId, gate.projectId)}&select=*`,
    headers: { Prefer: 'return=representation' },
    body,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return refuse('That context entry is not in this project, so nothing was changed.', 404);
  return { ok: true, status: 200, data: rowToEntry(updated) };
}

async function deleteEntry(id, scope) {
  const idCheck = checkId(id);
  if (!idCheck.ok) return idCheck;
  const { entryId } = idCheck;
  const gate = await requireScope(scope);
  if (!gate.ok) return gate;
  const res = await sbQuery({
    method: 'DELETE',
    table: TABLE,
    query: idPart(entryId, gate.projectId),
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const removed = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!removed) return refuse('That context entry is not in this project, so nothing was deleted.', 404);
  return { ok: true, status: 200, data: rowToEntry(removed) };
}

module.exports = {
  TABLE,
  MAX_TITLE,
  listEntries,
  getEntry,
  createEntry,
  updateEntry,
  deleteEntry,
};
