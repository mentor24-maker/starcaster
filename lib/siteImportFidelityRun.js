'use strict';

/**
 * The import difference report as the LAST STEP of building an import's pages
 * (SC-862). Dane's standing rule (DOCTRINE §6.25): every difference between an
 * original and its import is a missing capability to file, measured with the
 * side-by-side report scripts/site_import_fidelity.mjs makes. Until this, the
 * report only ran if an agent session remembered to run it, and on 2026-11-17
 * Bayside went live without it — five differences went unfiled until Dane
 * asked where the policy stood.
 *
 * So `scripts/site_import_map.mjs --apply` (which the Imports screen's Build
 * button runs through the Mac Mini import worker) now runs the report itself,
 * and records the outcome on the job for the screen:
 *
 *   checkpoints.fidelity  { at, status, reportUrl, totals, cannotTell,
 *                           blindSections, notes, error }
 *
 * status is one of THREE, never two:
 *   'done'         the report was made and every page was compared
 *   'cannot-tell'  the report was made, but some page (or the upload) could
 *                  not be looked at — the screen names which, never "no
 *                  differences"
 *   'failed'       no report could be made — the screen says why
 *
 * Nothing here files a ticket. The report is the list an agent session (or
 * Dane) files from, as §6.25 says.
 *
 * Pure: the mapper does the spawning; this module decides what the result
 * MEANS, so it is tested without a browser, a database or a child process
 * (scripts/site-import/fidelityRun.test.js).
 */

/** How long the report may run before the build stops waiting for it. */
const FIDELITY_TIMEOUT_MS = 45 * 60 * 1000;

/** Arguments for scripts/site_import_fidelity.mjs, run by the build. */
function fidelityScriptArgs(jobId, resultFile) {
  // --own-server: the build runs on the import worker, where no copy of the
  // app is necessarily listening. The report starts a files-only preview
  // server of its own rather than the full app, which would start background
  // jobs against the production database.
  return ['--job', String(jobId), '--own-server', '--result-file', resultFile];
}

/**
 * The last thing the report said before it stopped, as one plain line. The
 * script ends a failed run with "No report: <reason>".
 */
function fidelityFailureReason(stderr, exitCode, signal) {
  const lines = String(stderr || '').split('\n').map((l) => l.trim()).filter(Boolean).reverse();
  const said = lines.find((l) => /^No report:/.test(l));
  if (said) return said.replace(/^No report:\s*/, '');
  if (signal) return `the report was stopped (${signal}) before it finished`;
  if (lines.length) return lines[0];
  return `the report script exited with code ${exitCode} without saying why`;
}

const cleanCount = (n) => (Number.isFinite(Number(n)) && Number(n) >= 0 ? Math.floor(Number(n)) : 0);

/**
 * The checkpoint to record from one run of the report.
 *   exitCode  the script's exit code (0 / 2 / 1, see the script's header)
 *   result    what it wrote to --result-file, or null
 *   error     why it could not be run or read, when it could not
 */
function fidelityCheckpoint({ exitCode, result, error = '', now = new Date() }) {
  const at = now.toISOString();
  const r = result && typeof result === 'object' ? result : null;
  if (!r || r.ok === false || exitCode === 1 || (exitCode !== 0 && exitCode !== 2)) {
    return {
      at,
      status: 'failed',
      reportUrl: '',
      totals: [],
      cannotTell: [],
      blindSections: 0,
      notes: [],
      error: String((r && r.error) || error || `the report script exited with code ${exitCode} without saying why`),
    };
  }
  const totals = (Array.isArray(r.totals) ? r.totals : [])
    .filter((t) => t && typeof t.key === 'string')
    .map((t) => ({ key: t.key, label: String(t.label || t.key), count: cleanCount(t.count) }));
  const cannotTell = (Array.isArray(r.pages) ? r.pages : [])
    .filter((p) => p && p.status === 'cannot-tell')
    .map((p) => ({ path: String(p.path || ''), reason: String(p.reason || 'the report gives no reason') }));
  const notes = (Array.isArray(r.notes) ? r.notes : []).map(String).filter(Boolean);
  // Exit 2 with nothing named would read as a clean report on the screen.
  // Say that it could not see, even when the result does not say where.
  const blindSections = cleanCount(r.blindSections);
  const blind = exitCode === 2 || cannotTell.length > 0 || blindSections > 0 || !r.reportUrl;
  if (blind && !cannotTell.length && !blindSections && !notes.length) {
    notes.push(r.reportUrl
      ? 'The report says part of it could not be looked at, without naming which part.'
      : 'The report was made but not uploaded, so there is no link to it.');
  }
  return {
    at,
    status: blind ? 'cannot-tell' : 'done',
    reportUrl: String(r.reportUrl || ''),
    totals,
    cannotTell,
    blindSections,
    notes,
    error: '',
  };
}

/** One line for the build's own log and its warnings list. */
function fidelitySummaryLine(checkpoint) {
  if (!checkpoint) return 'Difference report: not made.';
  if (checkpoint.status === 'failed') return `Difference report: COULD NOT BE MADE — ${checkpoint.error}`;
  const counts = checkpoint.totals.filter((t) => t.count).map((t) => `${t.label} ${t.count}`).join(', ') || 'nothing lost in the measured categories';
  const blind = checkpoint.status === 'cannot-tell'
    ? ` — CANNOT TELL on ${[
      ...checkpoint.cannotTell.map((p) => p.path),
      ...(checkpoint.blindSections ? [`${checkpoint.blindSections} section(s)`] : []),
    ].join(', ') || 'part of it'}`
    : '';
  return `Difference report: ${counts}${blind}${checkpoint.reportUrl ? ` (${checkpoint.reportUrl})` : ''}`;
}

module.exports = {
  FIDELITY_TIMEOUT_MS,
  fidelityScriptArgs,
  fidelityFailureReason,
  fidelityCheckpoint,
  fidelitySummaryLine,
};
