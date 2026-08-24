'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyReportOrigin } = require('../../lib/bugReportOrigin');
const { createSyntheticReportTask, HELD_STATUS, SYNTHETIC_STATUS } = require('../../lib/clickupForward');
const { forwardBugReport } = require('../../lib/bugReportForward');

/**
 * Task 86bbk0tvk — our own test harness filed three bug reports into Dane's
 * inbox, each indistinguishable from a customer complaint, and he closed all
 * three by hand.
 *
 * THE ASYMMETRY IS THE WHOLE DESIGN, and it is what most of these tests
 * defend. Calling a synthetic report real costs one interruption. Calling a
 * REAL one synthetic loses a customer's bug into a closed ticket nobody reads.
 * So the classifier needs a signal no human could produce, or two independent
 * weak ones — and the test that matters most is the one that fails if a
 * genuine report is ever swallowed.
 */

// ── The three reports that actually happened ─────────────────────────────

test('the harness report that started this (86bbjwapg) is recognised', () => {
  const out = classifyReportOrigin({
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0 Safari/537.36',
    pageUrl: 'http://localhost:3074/builder-preview.html',
    projectName: 'UI Harness Fixture',
  });
  assert.equal(out.synthetic, true, out.why);
  assert.ok(out.signals.length >= 2, 'should not have rested on a single signal');
});

test('the two LIVE CHECK curl probes are recognised even on a real page', () => {
  // These are the harder ones: a probe can hit a genuine tenant URL, so the
  // page gives nothing away. The user agent alone has to carry it.
  const out = classifyReportOrigin({
    userAgent: 'curl/8.7.1',
    pageUrl: 'https://brandonmarinoff.com/',
    projectName: 'Brandon Marinoff',
  });
  assert.equal(out.synthetic, true, out.why);
  assert.deepEqual(out.signals, ['non-browser-agent']);
});

// ── AC2: a real report must never be swallowed ───────────────────────────

test('a real person on a real tenant page is left completely alone', () => {
  const out = classifyReportOrigin({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    pageUrl: 'https://brandonmarinoff.com/contact',
    projectName: 'Brandon Marinoff',
  });
  assert.equal(out.synthetic, false, out.why);
});

test('ONE weak signal is never enough — each in turn', () => {
  const real = {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Safari/604.1',
    pageUrl: 'https://delraytennis.com/lessons',
    projectName: 'Delray Beach Tennis Center',
  };
  // A client whose company name happens to contain a fixture word.
  assert.equal(classifyReportOrigin({ ...real, projectName: 'Test Kitchen Ltd' }).synthetic, false);
  // A real person whose browser reports no page URL (privacy extension, odd embed).
  assert.equal(classifyReportOrigin({ ...real, pageUrl: '' }).synthetic, false);
  // An accessibility or embedded browser reporting a headless string.
  assert.equal(classifyReportOrigin({ ...real, userAgent: 'HeadlessChrome/120' }).synthetic, false);
});

test('a real person on a real page with an unparseable URL is still real', () => {
  const out = classifyReportOrigin({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/121.0',
    pageUrl: 'not a url at all',
    projectName: 'Delray Beach Tennis Center',
  });
  assert.equal(out.synthetic, false, out.why);
});

test('the substring trap: "Java" in a normal browser agent is not a Java client', () => {
  // A naive /java/i would match half the browsers on earth via "JavaScript".
  const out = classifyReportOrigin({
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 JavaScriptCore',
    pageUrl: 'https://delraytennis.com/',
  });
  assert.equal(out.synthetic, false, out.why);
});

// ── AC1: the synthetic path cannot land in the operator's lane ───────────

test('createSyntheticReportTask refuses the held status outright', async () => {
  const out = await createSyntheticReportTask(
    { name: 'x' },
    { token: 't', status: HELD_STATUS, fetchImpl: async () => { throw new Error('must not reach the network'); } }
  );
  assert.equal(out.ok, false);
  assert.equal(out.code, 'SYNTHETIC_MUST_NOT_HOLD');
});

test('createSyntheticReportTask refuses to assign anybody', async () => {
  const out = await createSyntheticReportTask(
    { name: 'x' },
    { token: 't', assignees: [48012725], fetchImpl: async () => { throw new Error('must not reach the network'); } }
  );
  assert.equal(out.ok, false);
  assert.equal(out.code, 'SYNTHETIC_MUST_NOT_ASSIGN');
});

test('a synthetic task that lands assigned anyway is reported, not accepted', async () => {
  // The mirror of createHeldTask's read-back: a 200 proves a write happened,
  // not that the right thing landed.
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    const json = (status, payload) => ({ ok: status < 300, status, text: async () => JSON.stringify(payload) });
    if (method === 'POST') return json(200, { id: 'syn_1', url: 'https://app.clickup.com/t/syn_1' });
    return json(200, { id: 'syn_1', status: { status: HELD_STATUS }, assignees: [{ id: 48012725 }] });
  };
  const out = await createSyntheticReportTask({ name: 'x' }, { token: 't', fetchImpl });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'SYNTHETIC_LANDED_ASSIGNED');
  assert.match(out.error, /operator's lane/);
});

// ── The routing itself, end to end through forwardBugReport ──────────────

function routingHarness() {
  const calls = [];
  return {
    calls,
    deps: {
      token: 't',
      log: () => {},
      createHeldTask: async (task) => { calls.push({ path: 'held', task }); return { ok: true, taskId: 'h1', url: 'u' }; },
      createSyntheticReportTask: async (task) => { calls.push({ path: 'synthetic', task }); return { ok: true, taskId: 's1', url: 'u' }; },
    },
  };
}

test('a harness report takes the synthetic path', async () => {
  const h = routingHarness();
  await forwardBugReport(
    { id: 'r1', description: 'x', pageUrl: 'http://localhost:3074/p', userAgent: 'HeadlessChrome/120', screenshotAssetIds: [] },
    { projectId: 'p1' },
    h.deps
  );
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].path, 'synthetic');
  assert.match(h.calls[0].task.markdownDescription, /Filed closed and unassigned/);
});

test('a real report still takes the operator path, unchanged', async () => {
  // AC2, and the assertion this whole ticket must not break: if the routing
  // ever swallows a genuine report, this fails.
  const h = routingHarness();
  await forwardBugReport(
    {
      id: 'r2',
      description: 'The booking button does nothing',
      pageUrl: 'https://brandonmarinoff.com/book',
      userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
      screenshotAssetIds: [],
    },
    { projectId: 'p1' },
    h.deps
  );
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].path, 'held', 'a real report must still reach the operator');
  assert.doesNotMatch(h.calls[0].task.markdownDescription, /Filed closed and unassigned/);
});

test('the two statuses are not the same status', () => {
  // A guard against a future edit quietly pointing both at one place.
  assert.notEqual(SYNTHETIC_STATUS.toLowerCase(), HELD_STATUS.toLowerCase());
});
