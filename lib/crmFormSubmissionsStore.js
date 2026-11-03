'use strict';

/**
 * One row per CRM form submission, duplicates included (task 86bcwy44f).
 *
 * Before this table, a returning visitor's second message was thrown away the
 * moment their email matched an existing contact — only the alert email ever
 * saw it. The contact list answers "who"; this answers "what did they send,
 * from which form and which page, and when".
 *
 * Supabase only. There is deliberately no data/*.json fallback: on Vercel that
 * write vanishes (CLAUDE.md landmine 6), and a store that reports success on a
 * write that vanished is landmine 15. A refusal comes back as `{ ok: false }`.
 *
 * Every function returns an envelope `{ ok, status, data, error }`.
 */

const { nextId } = require('../routes/http');
const { sbQuery, tableConfig, isConfigured: isSupabaseConfigured } = require('./supabase');
const { scopedInsertRow } = require('./projectScope');

const MAX_DATA_KEYS = 100;
const MAX_VALUE_LENGTH = 10000;

function t() {
  return tableConfig().crmFormSubmissions || 'crm_form_submissions';
}

function text(value) {
  return String(value ?? '').trim();
}

/** Plain string values only, capped, so a hostile POST cannot store a novel. */
function cleanData(input) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input).slice(0, MAX_DATA_KEYS)) {
    const k = text(key).slice(0, 100);
    if (!k) continue;
    out[k] = (typeof value === 'string' ? value : String(value ?? '')).slice(0, MAX_VALUE_LENGTH);
  }
  return out;
}

function sanitize(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: text(row.id),
    projectId: text(row.project_id ?? row.projectId),
    ownerUserId: text(row.owner_user_id ?? row.ownerUserId),
    crmFormId: text(row.crm_form_id ?? row.crmFormId),
    crmContactId: text(row.crm_contact_id ?? row.crmContactId),
    email: text(row.email) || null,
    data: row.data && typeof row.data === 'object' ? row.data : {},
    pageUrl: text(row.page_url ?? row.pageUrl),
    createdAt: text(row.created_at ?? row.createdAt),
  };
}

/** Only a same-origin-looking page address is worth keeping; capped. */
function cleanPageUrl(input) {
  const url = text(input).slice(0, 2000);
  if (!url) return '';
  if (url.startsWith('/')) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

/**
 * Record one submission. `scope.projectId` is the tenant the public request
 * resolved to; `scope.userId` is the owner stamped on the row — a visitor has
 * no account, so the route passes the form's owner.
 *
 * Both columns are set on the row directly AND passed through scopedInsertRow:
 * that helper stops stamping either column if its probe of the table fails
 * (CLAUDE.md landmine 12), and a submission row with no tenant is invisible to
 * the Submissions list that reads it back by project.
 */
async function createSubmission(input, scope) {
  const projectId = text(scope?.projectId);
  const ownerUserId = text(scope?.userId);
  if (!projectId) return { ok: false, status: 400, error: 'projectId is required', data: null };
  if (!isSupabaseConfigured()) return { ok: false, status: 503, error: 'Database is not configured', data: null };

  const now = new Date().toISOString();
  const base = {
    id: nextId('crmsub'),
    project_id: projectId,
    owner_user_id: ownerUserId,
    crm_form_id: text(input?.crmFormId),
    crm_contact_id: text(input?.crmContactId) || null,
    email: text(input?.email).toLowerCase() || null,
    data: cleanData(input?.data),
    page_url: cleanPageUrl(input?.pageUrl),
    created_at: now,
  };
  const row = { ...(await scopedInsertRow(t(), base, scope)), project_id: projectId, owner_user_id: ownerUserId };

  const result = await sbQuery({
    method: 'POST',
    table: t(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!result.ok) return { ok: false, status: result.status || 500, error: result.error || 'Failed to record the submission', data: null };
  const saved = sanitize(Array.isArray(result.data) ? result.data[0] : result.data);
  if (!saved) return { ok: false, status: 500, error: 'The submission was written but could not be read back', data: null };
  return { ok: true, status: 201, data: saved };
}

/** A form's submissions, newest first, within the project. */
async function listSubmissions(crmFormId, scope, limit = 500) {
  const formId = text(crmFormId);
  const projectId = text(scope?.projectId);
  if (!formId || !projectId) return { ok: false, status: 400, error: 'crmFormId and projectId are required', data: [] };
  if (!isSupabaseConfigured()) return { ok: false, status: 503, error: 'Database is not configured', data: [] };
  const cap = Math.max(1, Math.min(Number(limit) || 500, 2000));
  const result = await sbQuery({
    table: t(),
    query: `select=*&crm_form_id=eq.${encodeURIComponent(formId)}&project_id=eq.${encodeURIComponent(projectId)}&order=created_at.desc&limit=${cap}`,
  });
  if (!result.ok) return { ok: false, status: result.status || 500, error: result.error || 'Failed to read submissions', data: [] };
  return { ok: true, status: 200, data: (Array.isArray(result.data) ? result.data : []).map(sanitize).filter(Boolean) };
}

/**
 * `{ [crmFormId]: count }` for the given forms. A failed read is `ok: false`,
 * never a map of zeros — "0 submissions" and "could not count" must not look
 * the same on the Forms list (CLAUDE.md landmine 17).
 */
async function countSubmissionsByForm(crmFormIds, scope) {
  const ids = [...new Set((Array.isArray(crmFormIds) ? crmFormIds : []).map(text).filter(Boolean))];
  const projectId = text(scope?.projectId);
  if (!ids.length) return { ok: true, status: 200, data: {} };
  if (!projectId) return { ok: false, status: 400, error: 'projectId is required', data: {} };
  if (!isSupabaseConfigured()) return { ok: false, status: 503, error: 'Database is not configured', data: {} };
  const inList = ids.map((id) => `"${id.replace(/"/g, '')}"`).join(',');
  const result = await sbQuery({
    table: t(),
    query: `select=crm_form_id&crm_form_id=in.(${encodeURIComponent(inList)})&project_id=eq.${encodeURIComponent(projectId)}&limit=100000`,
  });
  if (!result.ok) return { ok: false, status: result.status || 500, error: result.error || 'Failed to count submissions', data: {} };
  const counts = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const row of Array.isArray(result.data) ? result.data : []) {
    const id = text(row?.crm_form_id);
    if (id in counts) counts[id] += 1;
  }
  return { ok: true, status: 200, data: counts };
}

module.exports = { createSubmission, listSubmissions, countSubmissionsByForm, sanitizeSubmission: sanitize };
