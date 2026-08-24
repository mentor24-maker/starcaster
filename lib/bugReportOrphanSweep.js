'use strict';

/**
 * Bug Report screenshots — the orphan sweep (ClickUp 86bbjk5wj).
 *
 * WHY THIS EXISTS
 * A screenshot is uploaded BEFORE the bug report is submitted, because the
 * form posts one file per request and attaches them by (id, token) afterwards.
 * So an abandoned form leaves a fully-recorded `bug-report-pending` asset —
 * a database row AND a public blob — that nothing will ever reference.
 * PR #362 handles the other residue (a blob whose row failed to insert is
 * deleted on the spot) and deliberately declined to claim this sweep existed.
 * This is it.
 *
 * THE ONE LOAD-BEARING CHECK
 * "Not referenced by any report" is what separates rubbish from a visitor's
 * evidence. It is checked against `project_bug_reports.screenshot_asset_ids`
 * and NOT against the asset's own category, because those two can disagree:
 * `markScreenshotsAttached` is best-effort, so a report can reference a
 * screenshot whose pending→attached flip failed. Such a row is still pending
 * and still old, and deleting it would break a real report.
 *
 * REFUSING BEATS GUESSING
 * Every way of failing to read the reference set makes rubbish and evidence
 * look identical, so a failed or truncated read aborts the whole sweep and
 * deletes nothing (docs/DOCTRINE.md §3.11 — a sweep says what it could not
 * check). That includes hitting the scan ceiling: "I read 20,000 reports and
 * there may be more" is not a basis for deleting anything.
 *
 * ORDER OF DESTRUCTION
 * Blob first, row only if the blob actually went. The reverse leaves a public
 * image with no row to ever find it again — an orphan nobody can even see.
 * A row whose blob could not be deleted is therefore KEPT and reported, which
 * is why this function can return ok:false with real work done.
 *
 * Drive-hosted uploads have no deleter wired (lib/assetStorage), so they come
 * back as NO_DELETER: reported by location, row left alone, deliberately not
 * treated as a success.
 */

const { sbQuery, tableConfig } = require('./supabase');
const { deleteUploadedAsset } = require('./assetStorage');
const { PENDING_CATEGORY } = require('./projectBugReportScreenshots');

/** Old enough that an unreferenced upload is abandonment, not a slow typist. */
const DEFAULT_OLDER_THAN_HOURS = 24;

/** Ceilings. Reaching either one aborts rather than truncates — see above. */
const PENDING_SCAN_LIMIT = 5000;
const REPORT_SCAN_LIMIT = 20000;

const HOUR_MS = 60 * 60 * 1000;

function assetsTable() { return tableConfig().assets; }
function reportsTable() { return tableConfig().projectBugReports; }

function positiveInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * Every asset id any bug report claims, across every project.
 *
 * Deliberately NOT scoped per project: asset ids are globally unique, so a
 * global set is strictly more conservative than a per-project one — an id
 * referenced from anywhere survives. Being over-cautious here costs disk;
 * being under-cautious costs a reporter's screenshot.
 */
async function collectReferencedAssetIds() {
  const res = await sbQuery({
    table: reportsTable(),
    query: `select=screenshot_asset_ids&limit=${REPORT_SCAN_LIMIT}`,
  });
  if (!res.ok) {
    return {
      ok: false,
      status: res.status || 502,
      error: `Could not read bug reports (${res.error || 'unknown error'}) — refusing to sweep, because every screenshot would look unreferenced.`,
      code: 'REFERENCE_READ_FAILED',
    };
  }
  const rows = Array.isArray(res.data) ? res.data : [];
  if (rows.length >= REPORT_SCAN_LIMIT) {
    return {
      ok: false,
      status: 500,
      error: `Read ${rows.length} bug reports, which is the ceiling — there may be more, so the reference list is incomplete and nothing will be deleted.`,
      code: 'REFERENCE_SCAN_TRUNCATED',
    };
  }
  const ids = new Set();
  for (const row of rows) {
    const list = Array.isArray(row?.screenshot_asset_ids) ? row.screenshot_asset_ids : [];
    for (const value of list) {
      const id = positiveInteger(value);
      if (id) ids.add(id);
    }
  }
  return { ok: true, status: 200, data: ids, reportsRead: rows.length };
}

/** Candidate rows: pending bug-report screenshots, every project, oldest first. */
async function listPendingScreenshotAssets(limit = PENDING_SCAN_LIMIT) {
  const cap = positiveInteger(limit) || PENDING_SCAN_LIMIT;
  const res = await sbQuery({
    table: assetsTable(),
    query: `select=id,project_id,category,location,created_at&category=eq.${encodeURIComponent(PENDING_CATEGORY)}&order=created_at.asc&limit=${cap}`,
  });
  if (!res.ok) {
    return {
      ok: false,
      status: res.status || 502,
      error: `Could not read pending screenshots (${res.error || 'unknown error'}).`,
      code: 'PENDING_READ_FAILED',
    };
  }
  return { ok: true, status: 200, data: Array.isArray(res.data) ? res.data : [] };
}

/**
 * The whole decision, with no I/O in it, so every branch is testable without
 * a database: which candidates are orphans and — just as important — which
 * are kept and why.
 */
function planOrphanSweep({
  pendingAssets = [],
  referencedAssetIds = new Set(),
  now = Date.now(),
  olderThanHours = DEFAULT_OLDER_THAN_HOURS,
} = {}) {
  const referenced = referencedAssetIds instanceof Set
    ? referencedAssetIds
    : new Set((Array.isArray(referencedAssetIds) ? referencedAssetIds : []).map(positiveInteger).filter(Boolean));
  const hours = Number.isFinite(Number(olderThanHours)) && Number(olderThanHours) >= 0
    ? Number(olderThanHours)
    : DEFAULT_OLDER_THAN_HOURS;
  const cutoff = Number(now) - (hours * HOUR_MS);

  const orphans = [];
  const kept = [];

  for (const row of Array.isArray(pendingAssets) ? pendingAssets : []) {
    const id = positiveInteger(row?.id);
    const projectId = String(row?.project_id || '');
    const location = String(row?.location || '');
    const createdAtText = String(row?.created_at || '');

    if (!id) {
      kept.push({ id: row?.id ?? null, projectId, reason: 'UNUSABLE_ID' });
      continue;
    }
    // Belt and braces: the query already filters on the category, so a row
    // arriving here with another one means the filter did not do what it says.
    if (String(row?.category || '').trim() !== PENDING_CATEGORY) {
      kept.push({ id, projectId, reason: 'NOT_A_PENDING_BUG_REPORT_ASSET' });
      continue;
    }
    if (referenced.has(id)) {
      kept.push({ id, projectId, reason: 'REFERENCED_BY_A_REPORT' });
      continue;
    }
    const createdAt = Date.parse(createdAtText);
    if (!Number.isFinite(createdAt)) {
      kept.push({ id, projectId, reason: 'UNREADABLE_CREATED_AT' });
      continue;
    }
    if (createdAt > cutoff) {
      kept.push({ id, projectId, reason: 'NEWER_THAN_THRESHOLD' });
      continue;
    }
    orphans.push({ id, projectId, location, createdAt: createdAtText });
  }

  return { orphans, kept };
}

/**
 * Has this row changed since the scan? A form submitted in the meantime flips
 * the category to `bug-report`, and the sweep must not destroy the image of a
 * report filed sixty seconds ago. Cheap, because orphans are rare.
 */
async function stillPending(id) {
  const res = await sbQuery({
    table: assetsTable(),
    query: `select=id,category&id=eq.${positiveInteger(id)}&limit=1`,
  });
  if (!res.ok) return { ok: false, error: res.error || 'unknown error' };
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, pending: Boolean(row) && String(row.category || '').trim() === PENDING_CATEGORY };
}

/** DELETE conditioned on the category, so the race above cannot be lost twice. */
async function deletePendingAssetRow(id) {
  const res = await sbQuery({
    method: 'DELETE',
    table: assetsTable(),
    query: `id=eq.${positiveInteger(id)}&category=eq.${encodeURIComponent(PENDING_CATEGORY)}&select=id`,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return { ok: false, error: res.error || 'unknown error', matched: 0 };
  const matched = Array.isArray(res.data) ? res.data.length : (res.data ? 1 : 0);
  return { ok: true, matched };
}

function summarizeByProject(items) {
  const byProject = {};
  for (const item of items) {
    const key = item.projectId || '(no project)';
    byProject[key] = (byProject[key] || 0) + 1;
  }
  return byProject;
}

/**
 * Run the sweep. Dry-run by default — a caller that wants deletion says so.
 *
 * Returns { ok, status, data }. `ok` is false when anything could not be
 * deleted OR could not be checked, so a caller cannot read "finished" as
 * "clean" (docs/DOCTRINE.md §3.11).
 */
async function sweepBugReportOrphans({
  olderThanHours = DEFAULT_OLDER_THAN_HOURS,
  dryRun = true,
  now = Date.now(),
  limit = PENDING_SCAN_LIMIT,
} = {}) {
  const pending = await listPendingScreenshotAssets(limit);
  if (!pending.ok) return pending;

  const referenced = await collectReferencedAssetIds();
  if (!referenced.ok) return referenced;

  const { orphans, kept } = planOrphanSweep({
    pendingAssets: pending.data,
    referencedAssetIds: referenced.data,
    now,
    olderThanHours,
  });

  const deleted = [];
  const notDeleted = [];

  if (!dryRun) {
    for (const orphan of orphans) {
      const recheck = await stillPending(orphan.id);
      if (!recheck.ok) {
        notDeleted.push({ ...orphan, code: 'RECHECK_FAILED', error: recheck.error });
        continue;
      }
      if (!recheck.pending) {
        notDeleted.push({ ...orphan, code: 'CHANGED_UNDERNEATH', error: 'attached to a report between the scan and the delete' });
        continue;
      }

      if (!orphan.location) {
        notDeleted.push({ ...orphan, code: 'NO_LOCATION', error: 'row has no stored location, so no file can be deleted' });
        continue;
      }
      const blob = await deleteUploadedAsset(orphan.location);
      if (!blob.ok) {
        notDeleted.push({
          ...orphan,
          code: blob.status === 501 ? 'NO_DELETER' : 'BLOB_DELETE_FAILED',
          error: blob.error || 'unknown error',
        });
        continue;
      }

      const row = await deletePendingAssetRow(orphan.id);
      if (!row.ok) {
        notDeleted.push({ ...orphan, code: 'ROW_DELETE_FAILED', error: `${row.error} — the file is gone but the row remains` });
        continue;
      }
      if (!row.matched) {
        notDeleted.push({ ...orphan, code: 'ROW_VANISHED', error: 'no pending row matched the delete — the file is gone' });
        continue;
      }
      deleted.push(orphan);
    }
  }

  const data = {
    dryRun: Boolean(dryRun),
    olderThanHours: Number(olderThanHours),
    scanned: pending.data.length,
    reportsRead: referenced.reportsRead,
    proposed: orphans,
    kept,
    deleted,
    notDeleted,
    byProject: {
      proposed: summarizeByProject(orphans),
      deleted: summarizeByProject(deleted),
      notDeleted: summarizeByProject(notDeleted),
    },
  };

  return { ok: notDeleted.length === 0, status: 200, data };
}

module.exports = {
  DEFAULT_OLDER_THAN_HOURS,
  PENDING_SCAN_LIMIT,
  REPORT_SCAN_LIMIT,
  PENDING_CATEGORY,
  planOrphanSweep,
  collectReferencedAssetIds,
  listPendingScreenshotAssets,
  sweepBugReportOrphans,
};
