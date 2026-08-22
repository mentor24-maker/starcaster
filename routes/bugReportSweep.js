'use strict';

/**
 * The scheduled cleanup of abandoned bug-report screenshots.
 *
 *   GET|POST /api/maintenance/bug-report-screenshots/sweep
 *
 * AUTH: the path is listed in CRON_PATHS in routes/index.js, which is what
 * lets Vercel Cron reach it with no session (and what lets a `Bearer
 * $CRON_SECRET` call do the same). Any OTHER caller has already been through
 * the normal session gate by the time it gets here, and this handler refuses
 * a tenant-admin session on top of that: the sweep reads and deletes across
 * EVERY project, so a per-tenant login has no business driving it.
 *
 * DRY RUN IS THE DEFAULT. Deleting takes `?apply=1`. That ordering is
 * deliberate for the scheduled caller too — vercel.json asks for `apply=1`
 * explicitly, so if that query string is ever lost the job degrades to a
 * report rather than to an unattended delete nobody asked for.
 */

const { sendOk, sendErr, getUrlObj, parseJsonBody } = require('./http');
const {
  sweepBugReportScreenshotOrphans,
  DEFAULT_ORPHAN_AGE_HOURS,
} = require('../lib/bugReportScreenshotOrphans');

const SWEEP_PATH = '/api/maintenance/bug-report-screenshots/sweep';

function isTruthyFlag(value) {
  const text = String(value == null ? '' : value).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes';
}

function readParams(req, body) {
  let search = null;
  try { search = getUrlObj(req).searchParams; } catch (_) { search = null; }
  const fromQuery = (name) => (search ? search.get(name) : null);
  const fromBody = (name) => (body && typeof body === 'object' ? body[name] : undefined);
  const pick = (name) => {
    const q = fromQuery(name);
    if (q !== null && q !== undefined && q !== '') return q;
    return fromBody(name);
  };
  return {
    apply: isTruthyFlag(pick('apply')),
    olderThanHours: pick('olderThanHours'),
  };
}

async function handleSweep(req, res, method) {
  const body = method === 'POST' ? await parseJsonBody(req).catch(() => ({})) : {};
  const params = readParams(req, body);

  if (!req.cronPublish && req.authUser && req.authUser.isProjectAdmin) {
    return sendErr(res, 403, 'This cleanup runs across every project, so a site admin cannot start it.', { code: 'FORBIDDEN' });
  }

  const hoursInput = Number(params.olderThanHours);
  const olderThanHours = Number.isFinite(hoursInput) && hoursInput >= 0
    ? hoursInput
    : DEFAULT_ORPHAN_AGE_HOURS;

  const result = await sweepBugReportScreenshotOrphans({
    olderThanHours,
    dryRun: !params.apply,
  });

  if (!result.ok) {
    return sendErr(res, result.status || 502, result.error || 'The screenshot cleanup could not run.', {
      code: result.code || 'SWEEP_FAILED',
    });
  }

  // One line per run in the logs, always naming what could NOT be done — the
  // number that a "0 deleted" summary would otherwise hide (DOCTRINE §3.11).
  console.log(`[bug-report sweep] ${result.data.summary} cron=${Boolean(req.cronPublish)}`);
  for (const item of result.data.couldNotCheck) {
    console.warn(`[bug-report sweep] COULD NOT CHECK asset ${item.assetId} (project ${item.projectId || 'none'}): ${item.reason}`);
  }
  for (const item of result.data.couldNotDelete) {
    console.error(`[bug-report sweep] COULD NOT DELETE asset ${item.assetId} at ${item.stage} (${item.location || 'no location'}): ${item.reason}`);
  }

  return sendOk(res, 200, result.data, result.data);
}

async function handle(req, res, pathname, method) {
  const normalizedPath = String(pathname || '').replace(/\/+$/, '') || '/';
  const requestMethod = String(method || '').toUpperCase();

  if (normalizedPath === SWEEP_PATH && (requestMethod === 'GET' || requestMethod === 'POST')) {
    await handleSweep(req, res, requestMethod);
    return true;
  }

  return false;
}

const manifest = {
  id: 'bugReportSweep',
  label: 'Bug-report screenshot cleanup',
  prefixes: ['/api/maintenance'],
};

module.exports = { handle, manifest, SWEEP_PATH };
