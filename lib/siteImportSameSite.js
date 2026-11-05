'use strict';

/**
 * Site Import — "is this the same site?" (task 86bcynqrt).
 *
 * On 2026-11-04 one project held two imports of wavecenter.com — one typed
 * with "www.", one without — and the worker captured the whole site a second
 * time while another client's import waited 31 hours behind it. Nothing
 * noticed the two were the same site, because nothing ever asked.
 *
 * This module is the ONE place that answers it, for the create route
 * (routes/siteImport.js) and for the worker's claim (lib/siteImportStore.js
 * claimNextQueued). Two rules that lived apart would drift, and a route that
 * refuses what the worker would run (or the reverse) is worse than either.
 *
 * Same site: the host matches with a leading "www." and letter case ignored,
 * and the path matches with a trailing slash ignored. Scheme, query and
 * fragment are ignored. Different path = a different site on purpose: an
 * import of /blog is not an import of the home page.
 */

/** Statuses meaning "still waiting or running". */
const ACTIVE_STATUSES = Object.freeze(['queued', 'capturing', 'normalizing', 'extracting']);

/** The comparable form of an address, or '' when it cannot be read. */
function siteKey(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return '';
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!host) return '';
  const path = (url.pathname || '/').replace(/\/+$/, '') || '/';
  return `${host}${path}`;
}

function isSameSite(a, b) {
  const ka = siteKey(a);
  return Boolean(ka) && ka === siteKey(b);
}

/** A cancel the worker has not reached yet counts as cancelled, not waiting. */
function isActive(job) {
  if (!job || !ACTIVE_STATUSES.includes(job.status)) return false;
  return !(job.checkpoints && job.checkpoints.cancelRequested);
}

function isComplete(job) {
  return Boolean(job) && job.status === 'complete';
}

function timeOf(value) {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? t : null;
}

/** Job ids are simp_<epoch ms>_<rand>; the fallback when created_at is absent. */
function idTime(id) {
  const m = /^simp_(\d+)_/.exec(String(id || ''));
  return m ? Number(m[1]) : null;
}

/** Was `a` filed before `b`? */
function filedBefore(a, b) {
  const ta = timeOf(a.createdAt) ?? idTime(a.id);
  const tb = timeOf(b.createdAt) ?? idTime(b.id);
  if (ta != null && tb != null && ta !== tb) return ta < tb;
  return String(a.id) < String(b.id);
}

function newestFirst(list, field) {
  return list.slice().sort((a, b) => (timeOf(b[field]) ?? 0) - (timeOf(a[field]) ?? 0));
}

/**
 * For a NEW request: what the project already holds for this site.
 * `active` — the most recently filed same-site job still waiting or running.
 * `complete` — the most recently finished same-site job that completed.
 * Failed jobs (which includes cancelled ones) count as neither.
 */
function findSameSite(jobs, sourceUrl) {
  const same = (Array.isArray(jobs) ? jobs : []).filter((j) => j && isSameSite(j.sourceUrl, sourceUrl));
  const active = newestFirst(same.filter(isActive), 'createdAt')[0] || null;
  const complete = newestFirst(same.filter(isComplete), 'finishedAt')[0] || null;
  return { active, complete };
}

/**
 * For a QUEUED job the worker is about to start: the earlier job that makes it
 * a duplicate, or null when it may run. A duplicate is a same-site job in the
 * same project, filed BEFORE this one, that is still active — or that is
 * complete, unless this job is a confirmed re-import (`checkpoints.reimportOf`).
 * Only earlier jobs count, so of two queued copies the first one runs.
 */
function duplicateOf(job, projectJobs) {
  if (!job) return null;
  const earlier = (Array.isArray(projectJobs) ? projectJobs : []).filter(
    (j) => j && j.id !== job.id && isSameSite(j.sourceUrl, job.sourceUrl) && filedBefore(j, job)
  );
  const active = newestFirst(earlier.filter(isActive), 'createdAt')[0];
  if (active) return active;
  const confirmed = Boolean(job.checkpoints && job.checkpoints.reimportOf);
  if (confirmed) return null;
  return newestFirst(earlier.filter(isComplete), 'finishedAt')[0] || null;
}

/** "Nov 4, 2026" — Mountain time, which is where the operator reads it. */
function formatDay(value) {
  const t = timeOf(value);
  if (t == null) return 'an unknown date';
  return new Date(t).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Denver',
  });
}

/** The address as a person would say it: host + path, no scheme. */
function displayAddress(raw) {
  const value = String(raw || '').trim();
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.hostname}${path}`;
  } catch {
    return value;
  }
}

/** The error a skipped duplicate carries on its own row. */
function duplicateFailureMessage(earlier) {
  const address = displayAddress(earlier.sourceUrl);
  const when = isComplete(earlier)
    ? `imported ${formatDay(earlier.finishedAt || earlier.updatedAt)}`
    : `still ${earlier.status} since ${formatDay(earlier.createdAt)}`;
  return `Not started: duplicate of ${address}, ${when} (job ${earlier.id})`;
}

module.exports = {
  ACTIVE_STATUSES,
  siteKey,
  isSameSite,
  isActive,
  findSameSite,
  duplicateOf,
  formatDay,
  displayAddress,
  duplicateFailureMessage,
};
