'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');
const { createTheme } = require('./builderThemesStore');
// Apply-snapshots reuse the Builder's existing page-snapshot table rather than
// a wizard-private one (spec §5 allowed either). Same rows the Builder's own
// restore path reads, so a wizard revert and a manual restore cannot diverge.
const { createPageSnapshot, getPageSnapshot } = require('./builderPageSnapshotsStore');

function tableSessions() { return tableConfig().themeWizardSessions; }
function tableCandidates() { return tableConfig().themeWizardCandidates; }
function tableLibraryEntries() { return tableConfig().themeWizardLibraryEntries; }

function safeText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseJson(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function nextId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function rowToSession(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 120),
    projectId: safeText(row.project_id, 120),
    ownerUserId: safeText(row.owner_user_id, 120),
    seedType: safeText(row.seed_type, 120),
    seedPayload: parseJson(row.seed_payload, {}),
    styleBrief: parseJson(row.style_brief, {}),
    previewPageId: safeText(row.preview_page_id, 120),
    lockedValues: parseJson(row.locked_values, {}),
    roundCount: safeNumber(row.round_count, 0),
    tokensSpent: safeNumber(row.tokens_spent, 0),
    status: safeText(row.status, 120) || 'active',
    // Set by apply; the pair is what makes revert a single operation.
    appliedCandidateId: safeText(row.applied_candidate_id, 120),
    applySnapshotId: safeText(row.apply_snapshot_id, 120),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function rowToCandidate(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 120),
    sessionId: safeText(row.session_id, 120),
    projectId: safeText(row.project_id, 120),
    round: safeNumber(row.round, 1),
    slot: safeNumber(row.slot, 1),
    direction: safeText(row.direction, 500),
    rationale: safeText(row.rationale, 2000),
    themePatch: parseJson(row.theme_patch, {}),
    parentCandidateId: safeText(row.parent_candidate_id, 120),
    rank: row.rank == null ? null : safeNumber(row.rank, 0),
    feedback: safeText(row.feedback, 2000),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function rowToLibraryEntry(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 120),
    name: safeText(row.name, 255),
    themePatch: parseJson(row.theme_patch, {}),
    sourceSessionId: safeText(row.source_session_id, 120),
    originProjectId: safeText(row.origin_project_id, 120),
    createdBy: safeText(row.created_by, 120),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function rowToJob(row) {
  if (!row) return null;
  return {
    id: safeText(row.id, 120),
    sessionId: safeText(row.session_id, 120),
    projectId: safeText(row.project_id, 120),
    ownerUserId: safeText(row.owner_user_id, 120),
    type: safeText(row.type, 120),
    input: parseJson(row.input, {}),
    status: safeText(row.status, 120) || 'queued',
    error: safeText(row.error, 2000),
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
  };
}

function tableJobs() { return tableConfig().themeWizardJobs; }

async function createJob(input, scope = null) {
  const jobId = safeText(input?.id, 120) || nextId('twjob');
  const row = await scopedInsertRow(tableJobs(), {
    id: jobId,
    session_id: safeText(input?.sessionId),
    project_id: safeText(input?.projectId),
    owner_user_id: safeText(input?.ownerUserId),
    type: safeText(input?.type) || 'generate_round',
    input: input?.input || {},
    status: safeText(input?.status) || 'queued',
    error: safeText(input?.error, 2000),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    started_at: input?.startedAt || null,
    finished_at: input?.finishedAt || null,
  }, scope);
  const res = await sbQuery({ method: 'POST', table: tableJobs(), query: 'select=*', headers: { Prefer: 'return=representation' }, body: [row] });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToJob(created) };
}

async function getJob(id, scope = null) {
  const jobId = safeText(id, 120);
  if (!jobId) return { ok: false, status: 400, error: 'job id is required' };
  const query = await scopedIdQuery(tableJobs(), `select=*&id=eq.${encodeURIComponent(jobId)}&limit=1`, scope);
  const res = await sbQuery({ method: 'GET', table: tableJobs(), query });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Job not found' };
  return { ok: true, status: 200, data: rowToJob(row) };
}

async function updateJob(id, input, scope = null) {
  const jobId = safeText(id, 120);
  if (!jobId) return { ok: false, status: 400, error: 'job id is required' };
  const row = await scopedPatchRow(tableJobs(), {
    status: input?.status !== undefined ? safeText(input.status) : undefined,
    error: input?.error !== undefined ? safeText(input.error, 2000) : undefined,
    input: input?.input !== undefined ? input.input : undefined,
    started_at: input?.startedAt !== undefined ? input.startedAt : undefined,
    finished_at: input?.finishedAt !== undefined ? input.finishedAt : undefined,
    updated_at: new Date().toISOString(),
  }, scope);
  const query = await scopedIdQuery(tableJobs(), `select=*&id=eq.${encodeURIComponent(jobId)}&limit=1`, scope);
  const res = await sbQuery({ method: 'PATCH', table: tableJobs(), query, headers: { Prefer: 'return=representation' }, body: row });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Job not found' };
  return { ok: true, status: 200, data: rowToJob(updated) };
}

async function listJobs(sessionId, scope = null, limit = 100) {
  const safeSessionId = safeText(sessionId);
  if (!safeSessionId) return { ok: false, status: 400, error: 'session id is required' };
  const query = await scopedListQuery(tableJobs(), `select=*&session_id=eq.${encodeURIComponent(safeSessionId)}&order=created_at.desc&limit=${Math.max(1, Math.min(Number(limit) || 100, 500))}`, scope);
  const res = await sbQuery({ method: 'GET', table: tableJobs(), query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: Array.isArray(res.data) ? res.data.map(rowToJob) : [] };
}

async function listSessions(scope = null) {
  const query = await scopedListQuery(tableSessions(), 'select=*&order=updated_at.desc&limit=100', scope);
  const res = await sbQuery({ method: 'GET', table: tableSessions(), query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: Array.isArray(res.data) ? res.data.map(rowToSession) : [] };
}

async function getSession(id, scope = null) {
  const sessionId = safeText(id);
  if (!sessionId) return { ok: false, status: 400, error: 'session id is required' };
  const query = await scopedIdQuery(tableSessions(), `select=*&id=eq.${encodeURIComponent(sessionId)}&limit=1`, scope);
  const res = await sbQuery({ method: 'GET', table: tableSessions(), query });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Session not found' };
  return { ok: true, status: 200, data: rowToSession(row) };
}

async function createSession(input, scope = null) {
  const sessionId = safeText(input?.id, 120) || nextId('twiz');
  const row = await scopedInsertRow(tableSessions(), {
    id: sessionId,
    seed_type: safeText(input?.seedType),
    seed_payload: input?.seedPayload || {},
    style_brief: input?.styleBrief || {},
    preview_page_id: safeText(input?.previewPageId),
    locked_values: input?.lockedValues || {},
    round_count: safeNumber(input?.roundCount, 0),
    tokens_spent: safeNumber(input?.tokensSpent, 0),
    status: safeText(input?.status) || 'active',
    applied_candidate_id: safeText(input?.appliedCandidateId),
    apply_snapshot_id: safeText(input?.applySnapshotId),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, scope);

  const res = await sbQuery({ method: 'POST', table: tableSessions(), query: 'select=*', headers: { Prefer: 'return=representation' }, body: [row] });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToSession(created) };
}

async function updateSession(id, input, scope = null) {
  const sessionId = safeText(id);
  if (!sessionId) return { ok: false, status: 400, error: 'session id is required' };
  const row = await scopedPatchRow(tableSessions(), {
    seed_type: input?.seedType !== undefined ? safeText(input.seedType) : undefined,
    seed_payload: input?.seedPayload !== undefined ? input.seedPayload : undefined,
    style_brief: input?.styleBrief !== undefined ? input.styleBrief : undefined,
    preview_page_id: input?.previewPageId !== undefined ? safeText(input.previewPageId) : undefined,
    locked_values: input?.lockedValues !== undefined ? input.lockedValues : undefined,
    round_count: input?.roundCount !== undefined ? safeNumber(input.roundCount, 0) : undefined,
    tokens_spent: input?.tokensSpent !== undefined ? safeNumber(input.tokensSpent, 0) : undefined,
    status: input?.status !== undefined ? safeText(input.status) : undefined,
    applied_candidate_id: input?.appliedCandidateId !== undefined ? safeText(input.appliedCandidateId) : undefined,
    apply_snapshot_id: input?.applySnapshotId !== undefined ? safeText(input.applySnapshotId) : undefined,
    updated_at: new Date().toISOString(),
  }, scope);

  const query = await scopedIdQuery(tableSessions(), `id=eq.${encodeURIComponent(sessionId)}&select=*`, scope);
  const res = await sbQuery({ method: 'PATCH', table: tableSessions(), query, headers: { Prefer: 'return=representation' }, body: row });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Session not found' };
  return { ok: true, status: 200, data: rowToSession(updated) };
}

async function listCandidates(sessionId, scope = null) {
  const safeSessionId = safeText(sessionId);
  if (!safeSessionId) return { ok: false, status: 400, error: 'session id is required' };
  const query = await scopedListQuery(tableCandidates(), `select=*&session_id=eq.${encodeURIComponent(safeSessionId)}&order=round.asc,slot.asc&limit=500`, scope);
  const res = await sbQuery({ method: 'GET', table: tableCandidates(), query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: Array.isArray(res.data) ? res.data.map(rowToCandidate) : [] };
}

async function getCandidate(id, scope = null) {
  const candidateId = safeText(id);
  if (!candidateId) return { ok: false, status: 400, error: 'candidate id is required' };
  const query = await scopedIdQuery(tableCandidates(), `select=*&id=eq.${encodeURIComponent(candidateId)}&limit=1`, scope);
  const res = await sbQuery({ method: 'GET', table: tableCandidates(), query });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Candidate not found' };
  return { ok: true, status: 200, data: rowToCandidate(row) };
}

async function createCandidate(input, scope = null) {
  const candidateId = safeText(input?.id, 120) || nextId('twcd');
  const row = await scopedInsertRow(tableCandidates(), {
    id: candidateId,
    session_id: safeText(input?.sessionId),
    project_id: safeText(input?.projectId),
    round: safeNumber(input?.round, 1),
    slot: safeNumber(input?.slot, 1),
    direction: safeText(input?.direction, 500),
    rationale: safeText(input?.rationale, 2000),
    theme_patch: input?.themePatch || {},
    parent_candidate_id: safeText(input?.parentCandidateId),
    rank: input?.rank !== undefined ? safeNumber(input.rank, 0) : null,
    feedback: safeText(input?.feedback, 2000),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, scope);
  const res = await sbQuery({ method: 'POST', table: tableCandidates(), query: 'select=*', headers: { Prefer: 'return=representation' }, body: [row] });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToCandidate(created) };
}

async function updateCandidate(id, input, scope = null) {
  const candidateId = safeText(id);
  if (!candidateId) return { ok: false, status: 400, error: 'candidate id is required' };
  const row = await scopedPatchRow(tableCandidates(), {
    rank: input?.rank !== undefined ? safeNumber(input.rank, 0) : undefined,
    feedback: input?.feedback !== undefined ? safeText(input.feedback, 2000) : undefined,
    updated_at: new Date().toISOString(),
  }, scope);
  if (input?.direction !== undefined) row.direction = safeText(input.direction, 500);
  if (input?.rationale !== undefined) row.rationale = safeText(input.rationale, 2000);
  if (input?.themePatch !== undefined) row.theme_patch = input.themePatch;
  if (input?.parentCandidateId !== undefined) row.parent_candidate_id = safeText(input.parentCandidateId);
  const query = await scopedIdQuery(tableCandidates(), `id=eq.${encodeURIComponent(candidateId)}&select=*`, scope);
  const res = await sbQuery({ method: 'PATCH', table: tableCandidates(), query, headers: { Prefer: 'return=representation' }, body: row });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Candidate not found' };
  return { ok: true, status: 200, data: rowToCandidate(updated) };
}

async function createLibraryEntry(input) {
  const entryId = safeText(input?.id, 120) || nextId('tlib');
  const row = {
    id: entryId,
    name: safeText(input?.name, 255),
    theme_patch: input?.themePatch || {},
    source_session_id: safeText(input?.sourceSessionId),
    origin_project_id: safeText(input?.originProjectId),
    created_by: safeText(input?.createdBy),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const res = await sbQuery({ method: 'POST', table: tableLibraryEntries(), query: 'select=*', headers: { Prefer: 'return=representation' }, body: [row] });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToLibraryEntry(created) };
}

async function listLibraryEntries(limit = 1000) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 5000));
  const query = `select=*&order=updated_at.desc,created_at.desc&limit=${safeLimit}`;
  const res = await sbQuery({ method: 'GET', table: tableLibraryEntries(), query });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: Array.isArray(res.data) ? res.data.map(rowToLibraryEntry) : [] };
}

async function getLibraryEntry(id) {
  const entryId = safeText(id);
  if (!entryId) return { ok: false, status: 400, error: 'library entry id is required' };
  const query = `select=*&id=eq.${encodeURIComponent(entryId)}&limit=1`;
  const res = await sbQuery({ method: 'GET', table: tableLibraryEntries(), query });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Library entry not found' };
  return { ok: true, status: 200, data: rowToLibraryEntry(row) };
}

async function copyLibraryEntryToProject(id, outputName, scope = null) {
  const existing = await getLibraryEntry(id);
  if (!existing.ok) return existing;
  const entry = existing.data;
  const name = safeText(outputName || entry.name, 255);
  if (!name) return { ok: false, status: 400, error: 'name is required' };
  const themePatch = entry.themePatch || {};
  const themeResult = await createTheme({ name, ...themePatch }, scope);
  if (!themeResult.ok) return themeResult;
  return themeResult;
}

// Capture every page's current state BEFORE an apply rewrites them. Applying a
// theme walks every landing page and template in the project (hazard 4.1 — the
// same bulk-rewrite shape that lost the Marinoff menu), so nothing may be
// written until this has succeeded.
async function createApplySnapshot(input, scope = null) {
  const safeSessionId = safeText(input?.sessionId);
  if (!safeSessionId) return { ok: false, status: 400, error: 'session id is required' };
  const pages = Array.isArray(input?.pages) ? input.pages : [];
  // A zero-page snapshot would restore nothing while still reading as a
  // successful backup — refuse rather than hand back a useless undo.
  if (!pages.length) return { ok: false, status: 400, error: 'Refusing to snapshot zero pages' };
  const label = safeText(input?.label, 255) || `Theme Wizard — before apply (${safeSessionId})`;
  return createPageSnapshot({ label, pages }, scope);
}

// Revert reads the snapshot id recorded on the session, so it never has to
// guess which snapshot belongs to this apply.
async function getApplySnapshot(snapshotId, scope = null) {
  const id = safeText(snapshotId);
  if (!id) return { ok: false, status: 404, error: 'This session has no snapshot to revert to' };
  return getPageSnapshot(id, scope);
}

module.exports = {
  listSessions,
  getSession,
  createSession,
  updateSession,
  listCandidates,
  getCandidate,
  createCandidate,
  updateCandidate,
  createJob,
  getJob,
  updateJob,
  listJobs,
  createLibraryEntry,
  listLibraryEntries,
  getLibraryEntry,
  copyLibraryEntryToProject,
  createApplySnapshot,
  getApplySnapshot,
};
