'use strict';

/**
 * Run history for the Auto-tag extension (ticket 86bbw4dch): one row per post
 * a run touched, holding ONLY the tags the run added. That is what makes undo
 * exact -- it removes tags_added and nothing else.
 *
 * NO FILE FALLBACK, ON PURPOSE. A store that writes a local JSON file when the
 * database refuses answers 200 while the row never lands (CLAUDE.md landmine
 * 15); on Vercel the file write vanishes outright (landmine 6). A missing table
 * is reported as a 500 naming the SQL to run, and the run stops before it has
 * added a tag it could not remember.
 */

const { sbQuery, tableConfig } = require('./supabase');
const { scopedInsertRow } = require('./projectScope');
const { nextId } = require('../routes/http');

const SETUP_SQL = 'docs/SQL/blog_tag_runs_setup.sql';

function table() {
  return tableConfig().blogTagRuns;
}

function safeText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function isMissingTable(error) {
  const text = String(error || '').toLowerCase();
  return text.includes('does not exist') || text.includes('relation') || text.includes('schema cache');
}

function missingTableResult(res) {
  if (res && !res.ok && isMissingTable(res.error)) {
    return {
      ok: false,
      status: 500,
      error: `The auto-tag run history table is missing. Run ${SETUP_SQL} in Supabase.`,
      code: 'RUN_TABLE_MISSING',
    };
  }
  return null;
}

function rowToEntry(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 160),
    runId: safeText(row.run_id, 160),
    postId: safeText(row.post_id, 160),
    tagsAdded: Array.isArray(row.tags_added) ? row.tags_added.map((t) => safeText(t)).filter(Boolean) : [],
    createdAt: row.created_at || '',
    undoneAt: row.undone_at || null,
  };
}

function projectFilter(scope) {
  const projectId = safeText(scope?.projectId, 160);
  return projectId ? `&project_id=eq.${encodeURIComponent(projectId)}` : '';
}

/**
 * Record what a run added to a set of posts. Entries with nothing added are
 * skipped -- a row that says "added nothing" would make undo touch a post it
 * has no business touching.
 *
 * @param {string} runId
 * @param {Array<{ postId: string, tagsAdded: string[] }>} entries
 */
async function recordRunEntries(runId, entries, scope = null) {
  const id = safeText(runId, 160);
  if (!id) return { ok: false, status: 400, error: 'runId is required' };
  const rows = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const postId = safeText(entry?.postId, 160);
    const tagsAdded = (Array.isArray(entry?.tagsAdded) ? entry.tagsAdded : []).map((t) => safeText(t)).filter(Boolean);
    if (!postId || !tagsAdded.length) continue;
    rows.push(await scopedInsertRow(table(), {
      id: nextId('tagrun'),
      run_id: id,
      post_id: postId,
      tags_added: tagsAdded,
    }, scope));
  }
  if (!rows.length) return { ok: true, status: 200, data: [] };

  const res = await sbQuery({
    method: 'POST',
    table: table(),
    headers: { Prefer: 'return=representation' },
    body: rows,
  });
  const missing = missingTableResult(res);
  if (missing) return missing;
  if (!res.ok) return { ok: false, status: res.status || 500, error: res.error || 'Could not record the run' };

  // Read back: the write's success line is not the row.
  const written = Array.isArray(res.data) ? res.data.map(rowToEntry).filter(Boolean) : [];
  if (written.length !== rows.length) {
    return { ok: false, status: 500, error: `Recorded ${written.length} of ${rows.length} run entries` };
  }
  return { ok: true, status: 200, data: written };
}

/** Every entry of one run, in the order they were written. */
async function listRunEntries(runId, scope = null) {
  const id = safeText(runId, 160);
  if (!id) return { ok: false, status: 400, error: 'runId is required' };
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query: `select=*&run_id=eq.${encodeURIComponent(id)}${projectFilter(scope)}&order=created_at.asc&limit=5000`,
  });
  const missing = missingTableResult(res);
  if (missing) return missing;
  if (!res.ok) return { ok: false, status: res.status || 500, error: res.error || 'Could not read the run' };
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToEntry).filter(Boolean) };
}

/** Stamp every entry of the run as undone. Read back and counted. */
async function markRunUndone(runId, scope = null) {
  const id = safeText(runId, 160);
  if (!id) return { ok: false, status: 400, error: 'runId is required' };
  const undoneAt = new Date().toISOString();
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query: `run_id=eq.${encodeURIComponent(id)}${projectFilter(scope)}&undone_at=is.null&select=*`,
    headers: { Prefer: 'return=representation' },
    body: { undone_at: undoneAt },
  });
  const missing = missingTableResult(res);
  if (missing) return missing;
  if (!res.ok) return { ok: false, status: res.status || 500, error: res.error || 'Could not mark the run undone' };
  return { ok: true, status: 200, data: (Array.isArray(res.data) ? res.data : []).map(rowToEntry).filter(Boolean) };
}

module.exports = { recordRunEntries, listRunEntries, markRunUndone, SETUP_SQL };
