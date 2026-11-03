'use strict';

/**
 * One row per CRM form submission, duplicates included (task 86bcx1858).
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

/** A same-site path or an http(s) address, capped; anything else is blank. */
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

/**
 * Record one submission. `scope.projectId` is the tenant the public request
 * resolved to; `scope.userId` is the owner stamped on the row — a visitor has
 * no account, so the route passes the form's owner.
 *
 * Both tenant columns are written on the row directly rather than through
 * scopedInsertRow: that helper silently stops stamping EITHER column when its
 * probe of the table fails (CLAUDE.md landmine 12), and an untenanted row is
 * invisible to the Submissions list, which reads back by project.
 */
async function createSubmission(input, scope) {
  const projectId = text(scope?.projectId);
  const ownerUserId = text(scope?.userId);
  const crmFormId = text(input?.crmFormId);
  if (!projectId || !crmFormId) return { ok: false, status: 400, error: 'projectId and crmFormId are required', data: null };
  if (!isSupabaseConfigured()) return { ok: false, status: 503, error: 'Database is not configured', data: null };

  const row = {
    id: nextId('crmsub'),
    project_id: projectId,
    owner_user_id: ownerUserId,
    crm_form_id: crmFormId,
    crm_contact_id: text(input?.crmContactId) || null,
    email: text(input?.email).toLowerCase() || null,
    data: cleanData(input?.data),
    page_url: cleanPageUrl(input?.pageUrl),
    created_at: new Date().toISOString(),
  };
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
  const rows = (Array.isArray(result.data) ? result.data : []).map(sanitize).filter(Boolean);
  // Ordered again here so the newest-first promise does not rest on the query alone.
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { ok: true, status: 200, data: rows };
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

/**
 * The submit endpoint's call: keep this submission, and never throw. By the
 * time it runs the visitor's contact is saved and the alert still goes out
 * with every field, so a missing table or a refused write is logged loudly
 * and the visitor still gets the form's answer (acceptance criterion 3).
 * Returns whether the row was written, for the log and the tests.
 */
async function recordPublicSubmission({ form, projectId, contactId, email, data, pageUrl }) {
  if (!form?.id) return false;
  try {
    const saved = await createSubmission(
      { crmFormId: form.id, crmContactId: contactId, email, data, pageUrl },
      { projectId, userId: form.ownerUserId || '' },
    );
    if (!saved.ok) console.error(`[crm] Form submission row was NOT written (form ${form.id}):`, saved.error);
    return saved.ok;
  } catch (err) {
    console.error(`[crm] Form submission row threw (form ${form.id}):`, err?.message || err);
    return false;
  }
}

/**
 * The form a public submission names, inside the project the request resolved
 * to. A form id from another project — or another CRM — reads as no form at
 * all, so a submission can never be filed under someone else's form. Any
 * failure here also reads as no form: the contact is still kept, only the
 * submission row is skipped (and the visitor sees no difference).
 */
async function formForSubmission(crmFormId, crmConfigId, projectId) {
  const id = text(crmFormId);
  if (!id) return null;
  try {
    // Required at call time so the node suite can swap the forms store per test.
    const { getForm } = require('./crmFormsStore');
    const form = await getForm(id, { projectId, userId: '' });
    if (!form) return null;
    if (form.projectId && form.projectId !== projectId) return null;
    if (form.crmConfigId && crmConfigId && form.crmConfigId !== crmConfigId) return null;
    return form;
  } catch (err) {
    console.error('[crm] Loading the submitted form failed:', err?.message || err);
    return null;
  }
}

/** The contact's `source`, naming the form that captured it. */
function contactSourceForForm(form, fallback) {
  const name = text(form?.name);
  if (name) return `Form: ${name}`.slice(0, 200);
  return text(fallback) || 'form';
}

module.exports = { formForSubmission, contactSourceForForm, recordPublicSubmission, createSubmission, listSubmissions, countSubmissionsByForm, sanitizeSubmission: sanitize, cleanPageUrl };
