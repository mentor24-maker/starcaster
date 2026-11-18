'use strict';

/**
 * The import difference report as the build's last step (SC-862): what a run
 * of scripts/site_import_fidelity.mjs MEANS once the build has read it back,
 * and the files-only server the report photographs through on the worker.
 *
 * The rule under test is the report's own: CANNOT TELL is never "no
 * differences", and a report that could not be made says why instead of
 * vanishing.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const R = require('../../lib/siteImportFidelityRun.js');

const NOW = new Date('2026-11-17T20:00:00.000Z');
const TOTALS = [
  { key: 'text', label: 'Text styling', count: 26 },
  { key: 'links', label: 'Links', count: 3 },
  { key: 'shadow', label: 'Shadows and glow', count: 0 },
];

test('a clean run is done, with its link and counts', () => {
  const cp = R.fidelityCheckpoint({
    exitCode: 0,
    result: { ok: true, reportUrl: 'https://blob/fidelity.html', totals: TOTALS, pages: [{ path: '/', status: 'compared', reason: '' }], blindSections: 0, notes: [] },
    now: NOW,
  });
  assert.equal(cp.status, 'done');
  assert.equal(cp.reportUrl, 'https://blob/fidelity.html');
  assert.deepEqual(cp.totals.map((t) => t.count), [26, 3, 0]);
  assert.deepEqual(cp.cannotTell, []);
  assert.equal(cp.at, NOW.toISOString());
  assert.equal(R.fidelitySummaryLine(cp), 'Difference report: Text styling 26, Links 3 (https://blob/fidelity.html)');
});

test('a page it could not see is CANNOT TELL and named, never done', () => {
  const cp = R.fidelityCheckpoint({
    exitCode: 2,
    result: {
      ok: true, reportUrl: 'https://blob/f.html', totals: TOTALS,
      pages: [{ path: '/', status: 'compared' }, { path: '/contact/', status: 'cannot-tell', reason: 'no Builder page was recorded for it' }],
    },
    now: NOW,
  });
  assert.equal(cp.status, 'cannot-tell');
  assert.deepEqual(cp.cannotTell, [{ path: '/contact/', reason: 'no Builder page was recorded for it' }]);
  assert.match(R.fidelitySummaryLine(cp), /CANNOT TELL on \/contact\//);
});

test('exit 2 that names nothing still says it could not see', () => {
  const cp = R.fidelityCheckpoint({ exitCode: 2, result: { ok: true, reportUrl: '', totals: TOTALS, pages: [] }, now: NOW });
  assert.equal(cp.status, 'cannot-tell');
  assert.equal(cp.notes.length, 1);
  assert.match(cp.notes[0], /not uploaded/);
});

test('a section it could not compare makes the report CANNOT TELL', () => {
  const cp = R.fidelityCheckpoint({ exitCode: 0, result: { ok: true, reportUrl: 'u', totals: TOTALS, pages: [{ path: '/', status: 'compared' }], blindSections: 1 }, now: NOW });
  assert.equal(cp.status, 'cannot-tell');
  assert.match(R.fidelitySummaryLine(cp), /CANNOT TELL on 1 section\(s\)/);
});

test('a report with no link is never shown as clean, even on exit 0', () => {
  const cp = R.fidelityCheckpoint({ exitCode: 0, result: { ok: true, reportUrl: '', totals: TOTALS, pages: [] }, now: NOW });
  assert.equal(cp.status, 'cannot-tell');
});

test('no report is failed, with the reason the script gave', () => {
  const reason = R.fidelityFailureReason('Reading: production\n\nNo report: This job has no normalize checkpoint — it never finished capturing.\n', 1, null);
  assert.equal(reason, 'This job has no normalize checkpoint — it never finished capturing.');
  const fromResult = R.fidelityCheckpoint({ exitCode: 1, result: { ok: false, error: 'No import job x.' }, error: reason, now: NOW });
  assert.equal(fromResult.status, 'failed');
  assert.equal(fromResult.error, 'No import job x.');
  const noResult = R.fidelityCheckpoint({ exitCode: 1, result: null, error: reason, now: NOW });
  assert.equal(noResult.status, 'failed');
  assert.equal(noResult.error, reason);
  assert.match(R.fidelitySummaryLine(noResult), /^Difference report: COULD NOT BE MADE — /);
});

test('a killed run with a stale result file is failed, not trusted', () => {
  assert.equal(R.fidelityCheckpoint({ exitCode: null, result: { ok: true, reportUrl: 'x', totals: [] }, error: 'stopped', now: NOW }).status, 'failed');
  assert.equal(R.fidelityFailureReason('', null, 'SIGTERM'), 'the report was stopped (SIGTERM) before it finished');
});

test('the build runs the report through its own files-only server', () => {
  assert.deepEqual(R.fidelityScriptArgs('simp_1', '/tmp/r.json'), ['--job', 'simp_1', '--own-server', '--result-file', '/tmp/r.json']);
});

test('the files-only server serves public/ files and no API', async () => {
  const { startStaticPreviewServer, resolvePublicFile } = await import('../lib/static_preview_server.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'static-preview-'));
  fs.mkdirSync(path.join(root, 'public'));
  fs.writeFileSync(path.join(root, 'public', 'builder-preview.html'), '<p>preview</p>');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'outside');
  const server = await startStaticPreviewServer(root);
  try {
    const page = await fetch(`${server.url}/builder-preview.html?embed=1`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.equal(await page.text(), '<p>preview</p>');
    const api = await fetch(`${server.url}/api/builder/landing-pages`);
    assert.equal(api.status, 404);
    assert.equal((await api.json()).ok, false);
    assert.equal((await fetch(`${server.url}/missing.js`)).status, 404);
    assert.equal(resolvePublicFile(path.join(root, 'public'), '/../secret.txt'), null);
    assert.equal(resolvePublicFile(path.join(root, 'public'), '/%2e%2e/secret.txt'), null);
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
