'use strict';

/**
 * Site Import API — queue and monitor site-capture jobs (spec
 * docs/site-import/01-capture-and-ir.md §1e).
 *
 * The API only writes bookkeeping: creating a job puts a 'queued' row in
 * app_site_import_jobs. The actual capture runs OFF-VERCEL — the operator
 * starts scripts/site_import_worker.mjs on their machine (Playwright can't
 * run here and captures outlive the 300 s ceiling). The UI says so plainly.
 *
 * AUTH: staff-only (ratified decision 3). Requires a platform app_session
 * (centralized in routes/index.js), and '/api/site-import' sits in
 * PROJECT_ADMIN_SESSION_DENY_PREFIXES so tenant project-admin sessions
 * cannot reach it — imports of un-reviewed third-party content are an
 * Alphire-internal tool.
 */

const { parseJsonBody, sendOk, sendErr } = require('./http');
const { requestProjectScope } = require('../lib/requestProjectScope');
const { checkEndpointLimit } = require('../lib/rateLimiter');
const store = require('../lib/siteImportStore');
const importTheme = require('../lib/siteImportTheme');

const PREFIX = '/api/site-import';

function requireProject(req, res) {
  const scope = requestProjectScope(req);
  if (!scope.projectId) {
    sendErr(res, 400, 'An active project is required (x-project-id header)', { code: 'PROJECT_REQUIRED' });
    return null;
  }
  return scope;
}

/** http(s) URLs only — the worker refuses anything else anyway; failing
 *  here gives the operator the message at submit time instead. */
function validateSourceUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return { error: 'Please enter the website address to import' };
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return { error: `That does not look like a website address: ${value}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: 'Only http(s) sites can be imported' };
  }
  return { url: url.href };
}

async function handle(req, res, pathname, method) {
  if (!pathname.startsWith(PREFIX)) return false;
  if (!req.authUser) return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' }), true;

  // POST /api/site-import/jobs — queue a new import
  if (pathname === `${PREFIX}/jobs` && method === 'POST') {
    // Landmine #11: checkEndpointLimit returns true when it has ALREADY
    // sent the 429 — never invert this.
    if (checkEndpointLimit(req, res, 'siteImport.jobs')) return true;
    const scope = requireProject(req, res);
    if (!scope) return true;

    const body = await parseJsonBody(req);
    const { url, error } = validateSourceUrl(body.sourceUrl);
    if (error) return sendErr(res, 400, error, { code: 'VALIDATION_ERROR' }), true;

    const created = await store.createJob({
      projectId: scope.projectId,
      ownerUserId: scope.userId,
      sourceUrl: url,
      caps: body.caps,
      clientAuthorization: body.clientAuthorization,
    });
    if (!created.ok) return sendErr(res, created.status || 500, created.error), true;
    return sendOk(res, 201, { job: created.data }), true;
  }

  // GET /api/site-import/jobs — list this project's jobs
  if (pathname === `${PREFIX}/jobs` && method === 'GET') {
    const scope = requireProject(req, res);
    if (!scope) return true;
    const listed = await store.listJobs(scope.projectId);
    if (!listed.ok) return sendErr(res, listed.status || 500, listed.error), true;
    return sendOk(res, 200, { jobs: listed.data }), true;
  }

  const jobMatch = pathname.match(new RegExp(`^${PREFIX}/jobs/([^/]+)(/assets|/cancel|/theme)?$`));
  if (!jobMatch) return sendErr(res, 404, 'Unknown Site Import endpoint', { code: 'NOT_FOUND' }), true;
  const jobId = decodeURIComponent(jobMatch[1]);
  const tail = jobMatch[2] || '';

  const scope = requireProject(req, res);
  if (!scope) return true;
  // Scoped read: a job id from another project 404s rather than leaks.
  const jobRes = await store.getJob(jobId, scope.projectId);
  if (!jobRes.ok) return sendErr(res, jobRes.status || 500, jobRes.error, { code: 'NOT_FOUND' }), true;
  const job = jobRes.data;

  // GET /api/site-import/jobs/:id — status + coverage + checkpoints
  if (!tail && method === 'GET') {
    return sendOk(res, 200, { job }), true;
  }

  // GET /api/site-import/jobs/:id/assets — manifest incl. failures
  if (tail === '/assets' && method === 'GET') {
    const assets = await store.listAssets(job.id);
    if (!assets.ok) return sendErr(res, assets.status || 500, assets.error), true;
    return sendOk(res, 200, { assets: assets.data }), true;
  }

  // POST /api/site-import/jobs/:id/cancel — mark for cancellation; the
  // worker checks between stages (there is no process to signal from here).
  if (tail === '/cancel' && method === 'POST') {
    if (job.finishedAt) {
      return sendErr(res, 409, `Job is already ${job.status}`, { code: 'ALREADY_FINISHED' }), true;
    }
    const updated = await store.updateJob(job.id, {
      checkpoints: { ...job.checkpoints, cancelRequested: true },
    });
    if (!updated.ok) return sendErr(res, updated.status || 500, updated.error), true;
    return sendOk(res, 200, { job: updated.data }), true;
  }

  // GET  /api/site-import/jobs/:id/theme — the theme this import WOULD make
  // POST /api/site-import/jobs/:id/theme — make it, touching no page
  // (task 86bctakkk). Body { makeDefault?: boolean } — only an explicit true
  // makes it the default, because that restyles every published page with no
  // theme of its own on the live site at once; GET returns that count as
  // `pagesRestyledByDefault` (null when it could not be read — never 0).
  // Always a NEW theme: the name is the next free "<site> N", so a theme
  // somebody adjusted is never overwritten.
  if (tail === '/theme' && (method === 'GET' || method === 'POST')) {
    try {
      if (method === 'GET') {
        const plan = await importTheme.planImportTheme(job, scope);
        let pagesRestyledByDefault = null;
        try {
          pagesRestyledByDefault = await importTheme.pagesRestyledByDefault(scope);
        } catch {
          // The preview still answers; the screen says it could not count.
        }
        return sendOk(res, 200, {
          theme: plan.theme, name: plan.name, notes: plan.notes, previousDefault: plan.previousDefault, pagesRestyledByDefault,
        }), true;
      }
      if (checkEndpointLimit(req, res, 'siteImport.theme')) return true;
      const body = await parseJsonBody(req);
      const makeDefault = body.makeDefault === true;
      const plan = await importTheme.planImportTheme(job, scope);
      const checkpoint = await importTheme.saveImportTheme(plan, scope, { makeDefault });
      const updated = await store.updateJob(job.id, {
        checkpoints: { ...job.checkpoints, theme: { ...checkpoint, at: new Date().toISOString() } },
      });
      // The theme exists either way; say so rather than reporting a failure
      // the operator would answer by clicking again and making "<site> 2".
      return sendOk(res, 201, {
        theme: checkpoint,
        undo: importTheme.undoLine(checkpoint),
        job: updated.ok ? updated.data : job,
        ...(updated.ok ? {} : { warning: `The theme was created, but recording it on the import failed: ${updated.error}` }),
      }), true;
    } catch (err) {
      const status = err.code === 'NOT_CAPTURED' ? 409 : 500;
      return sendErr(res, status, err.message, { code: err.code || 'THEME_FAILED' }), true;
    }
  }

  return sendErr(res, 405, 'Method not allowed', { code: 'METHOD_NOT_ALLOWED' }), true;
}

module.exports = {
  handle,
  manifest: {
    id: 'siteImport',
    label: 'Site Import',
    prefixes: [PREFIX],
  },
};
