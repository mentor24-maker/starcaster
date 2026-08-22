'use strict';

/**
 * Bug Report 5/5 — the scheduled sweep that collects abandoned screenshots.
 *
 * Why this exists: a screenshot uploads BEFORE the report is submitted (task
 * 2/5), landing as a `bug-report-pending` asset — a row plus a public blob.
 * Submitting flips it to `bug-report`. Closing the tab instead leaves both
 * behind forever, and the blob is publicly readable. Task 2/5 deliberately
 * refused to claim a sweep existed; this is that machinery.
 *
 * Three rules shape every line below.
 *
 *  - THE REFERENCE CHECK IS LOAD-BEARING, AND ITS FAILURE IS NOT A PASS.
 *    An asset named by any report's `screenshot_asset_ids` is NEVER an orphan,
 *    even if the pending→attached flip once failed and left it in the pending
 *    category. So the sweep asks the reports table per project first — and if
 *    that question cannot be answered, every candidate in that project is
 *    reported under `couldNotCheck` and left alone. `if (error) continue` is
 *    the shape that produced a false all-clear on 95 tables (DOCTRINE §3.11);
 *    "could not check" is never folded into "clean".
 *
 *  - THE BLOB GOES FIRST, AND A FAILED BLOB DELETE STOPS THE ROW.
 *    Delete the row first and a failed blob delete leaves a public file that
 *    nothing in the database points at — an orphan no later run can even find.
 *    So: blob, then row, and if the blob will not go, the row stays and the
 *    pair is reported. Google Drive has no deleter wired (`assetStorage`
 *    returns 501); those are reported, not silently skipped.
 *
 *  - DRY RUN IS THE DEFAULT. Deleting is opt-in per call.
 */

const { sbQuery, tableConfig } = require('./supabase');
const { deleteUploadedAsset } = require('./assetStorage');
const { deleteAsset } = require('./assetsStore');
const { PENDING_CATEGORY } = require('./projectBugReportScreenshots');

/** How old an abandoned upload must be before it is collectable. A form that
 *  is open in a tab overnight is a real thing; 24 hours is generous and the
 *  cost of waiting is one small file. */
const DEFAULT_ORPHAN_AGE_HOURS = 24;

/** Rows examined in one run. A serverless function has 300 seconds and each
 *  orphan is a blob delete plus a row delete, so this is a wall-clock bound,
 *  not a correctness one — whatever it leaves is reported as `truncated` and
 *  collected by the next run. */
const DEFAULT_SCAN_LIMIT = 500;

const SCAN_COLUMNS = 'id,project_id,category,location,asset_name,created_at';

function hoursToMs(hours) {
  return Math.max(0, Number(hours) || 0) * 60 * 60 * 1000;
}

/** The instant before which a pending upload counts as abandoned. */
function orphanCutoffIso(nowMs, olderThanHours) {
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  return new Date(now - hoursToMs(olderThanHours)).toISOString();
}

/** Every asset id any of these report rows points at, as numbers. The column
 *  is jsonb, so it can hold strings, nulls or junk — coerce, keep integers. */
function referencedAssetIds(reportRows) {
  const ids = new Set();
  for (const row of Array.isArray(reportRows) ? reportRows : []) {
    const list = row && Array.isArray(row.screenshot_asset_ids) ? row.screenshot_asset_ids : [];
    for (const value of list) {
      const id = Number(value);
      if (Number.isInteger(id) && id > 0) ids.add(id);
    }
  }
  return ids;
}

function describeError(res) {
  const status = res && res.status ? res.status : 0;
  const message = String((res && (res.error || res.message)) || 'no error message returned');
  return status ? `${status}: ${message}` : message;
}

/** Pending rows older than the cutoff, oldest first, across every project. */
async function loadPendingCandidates(cutoffIso, limit) {
  const query =
    `select=${SCAN_COLUMNS}` +
    `&category=eq.${encodeURIComponent(PENDING_CATEGORY)}` +
    `&created_at=lt.${encodeURIComponent(cutoffIso)}` +
    `&order=created_at.asc&limit=${Math.max(1, Number(limit) || DEFAULT_SCAN_LIMIT)}`;
  return sbQuery({ table: tableConfig().assets, query });
}

/** Every report row's screenshot ids for one project. Not scoped through
 *  lib/projectScope: this runs without a session and must read every project,
 *  so the filter is written here and is the ONLY thing keeping one project's
 *  reports from answering for another's. */
async function loadReferencedIdsForProject(projectId) {
  const filter = projectId
    ? `&project_id=eq.${encodeURIComponent(projectId)}`
    : '&or=(project_id.is.null,project_id.eq.)';
  const res = await sbQuery({
    table: tableConfig().projectBugReports,
    query: `select=screenshot_asset_ids${filter}&limit=5000`,
  });
  if (!res.ok) return res;
  return { ok: true, status: 200, data: referencedAssetIds(res.data) };
}

function groupByProject(rows) {
  const groups = new Map();
  for (const row of rows) {
    const projectId = String((row && row.project_id) || '');
    if (!groups.has(projectId)) groups.set(projectId, []);
    groups.get(projectId).push(row);
  }
  return groups;
}

/**
 * Find, and optionally collect, abandoned bug-report screenshots.
 *
 * Returns `{ ok, status, data }` where data always carries FOUR counts, never
 * three: swept, spared, could-not-check and could-not-delete. A caller that
 * reads only `deleted.length` and prints "clean" is reading it wrong, which is
 * why `complete` exists and why `summary` names all four.
 */
async function sweepBugReportScreenshotOrphans({
  olderThanHours = DEFAULT_ORPHAN_AGE_HOURS,
  dryRun = true,
  limit = DEFAULT_SCAN_LIMIT,
  now = Date.now(),
} = {}) {
  const ageHours = Math.max(0, Number(olderThanHours) || 0);
  const scanLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_SCAN_LIMIT, 5000));
  const cutoff = orphanCutoffIso(now, ageHours);

  const scan = await loadPendingCandidates(cutoff, scanLimit);
  if (!scan.ok) {
    return {
      ok: false,
      status: scan.status || 502,
      error: `Could not list pending bug-report screenshots (${describeError(scan)}).`,
      code: 'SWEEP_SCAN_FAILED',
    };
  }

  const candidates = Array.isArray(scan.data) ? scan.data : [];
  const proposed = [];
  const deleted = [];
  const couldNotCheck = [];
  const couldNotDelete = [];
  let referenced = 0;
  let wrongCategory = 0;

  for (const [projectId, rows] of groupByProject(candidates)) {
    const refs = await loadReferencedIdsForProject(projectId);
    if (!refs.ok) {
      // The one branch this whole file is written around: an unanswerable
      // reference question means these rows are UNKNOWN, not orphaned.
      for (const row of rows) {
        couldNotCheck.push({
          assetId: Number(row.id),
          projectId,
          reason: `Could not read this project's bug reports (${describeError(refs)}), so it is unknown whether this screenshot is still in use.`,
        });
      }
      continue;
    }

    for (const row of rows) {
      const assetId = Number(row.id);
      const location = String(row.location || '');

      // Belt and braces. The query already filters on the pending category;
      // this refuses to act if that filter is ever edited wrong, because the
      // blast radius of a category mistake here is a tenant's image library.
      if (String(row.category || '') !== PENDING_CATEGORY) {
        wrongCategory += 1;
        continue;
      }

      if (refs.data.has(assetId)) {
        referenced += 1;
        continue;
      }

      const orphan = { assetId, projectId, location, createdAt: String(row.created_at || '') };

      if (dryRun) {
        proposed.push(orphan);
        continue;
      }

      if (location) {
        const blob = await deleteUploadedAsset(location);
        if (!blob.ok) {
          // Row stays. A deleted row with a live blob is an orphan nothing can
          // find; a live row with a live blob is just next run's work.
          couldNotDelete.push({ ...orphan, stage: 'blob', reason: describeError(blob) });
          continue;
        }
      }

      const removed = await deleteAsset(assetId, { projectId });
      if (!removed.ok) {
        couldNotDelete.push({ ...orphan, stage: 'row', reason: describeError(removed) });
        continue;
      }
      deleted.push(orphan);
    }
  }

  const truncated = candidates.length >= scanLimit;
  const complete = couldNotCheck.length === 0 && couldNotDelete.length === 0 && !truncated;

  const summary =
    `${dryRun ? 'Dry run' : 'Swept'}: ${candidates.length} pending screenshot(s) older than ${ageHours}h — ` +
    `${dryRun ? `${proposed.length} would be deleted` : `${deleted.length} deleted`}, ` +
    `${referenced} still in use by a report, ` +
    `${couldNotCheck.length} could not be checked, ` +
    `${couldNotDelete.length} could not be deleted` +
    (wrongCategory ? `, ${wrongCategory} skipped for the wrong category` : '') +
    (truncated ? `. More may remain — the ${scanLimit}-row scan limit was reached.` : '.');

  return {
    ok: true,
    status: 200,
    data: {
      dryRun: Boolean(dryRun),
      olderThanHours: ageHours,
      cutoff,
      scanLimit,
      truncated,
      complete,
      scanned: candidates.length,
      referenced,
      wrongCategory,
      proposed,
      deleted,
      couldNotCheck,
      couldNotDelete,
      summary,
    },
  };
}

module.exports = {
  DEFAULT_ORPHAN_AGE_HOURS,
  DEFAULT_SCAN_LIMIT,
  orphanCutoffIso,
  referencedAssetIds,
  sweepBugReportScreenshotOrphans,
};
