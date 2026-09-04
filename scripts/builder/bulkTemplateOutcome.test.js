'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  tallyBulkTemplateRows,
  describeBulkTemplateOutcome,
  describeBulkTemplateInterruption,
} = require('../../public/shared/bulkTemplateOutcome');

/**
 * What the bulk template change SAYS once it has run.
 *
 * The write path is covered by bulkSetPageTemplateWrite.test.js and was sound
 * at review. These are the four defects review found in the layer above it —
 * the layer that tells the operator what happened — and every one of them
 * survived a full gate run, a code review and a real browser pass because the
 * report was built inline in public/js/builder.js, which nothing parses but a
 * browser (landmine 9). Moving the sentence into public/shared/ is what makes
 * these assertions possible at all.
 */

function row(over) {
  return Object.assign({ id: '1', name: 'Home', ok: true, verified: true }, over);
}

// ── The tally ───────────────────────────────────────────────────────────────

test('the three verdicts are counted separately, never folded together', () => {
  const t = tallyBulkTemplateRows([
    row({ id: '1' }),
    row({ id: '2', ok: false, error: 'permission denied' }),
    row({ id: '3', verified: false }),
  ]);
  assert.equal(t.total, 3);
  assert.equal(t.confirmed.length, 1);
  assert.equal(t.failed.length, 1);
  assert.equal(t.unconfirmed.length, 1);
});

test('a row that is not shaped like a result counts as FAILED, never as moved', () => {
  // "Could not tell" must not render as "fine" — a malformed row is the one
  // case where guessing costs a page.
  const t = tallyBulkTemplateRows([null, 'nonsense', 7, undefined]);
  assert.equal(t.failed.length, 4);
  assert.equal(t.confirmed.length, 0);
});

test('a non-array of results does not throw', () => {
  for (const rows of [null, undefined, 'x', 7, {}]) {
    assert.equal(tallyBulkTemplateRows(rows).total, 0);
  }
});

// ── Defect 2: the mixed run — some failed AND some unconfirmed ───────────────

/**
 * THE ONE THIS TICKET WAS SENT BACK FOR.
 *
 * The report branched: `if (failed) … else if (unverified) … else …`. A run
 * with both produced "41 of 43 pages moved to X; 2 failed" — the read-back
 * warning gone entirely, and the 41 arrived at as `rows.length -
 * failed.length`, which INCLUDES every page the database accepted and did not
 * actually store. That is the 2026-08-16 shape (fourteen pages emptied, every
 * write reporting success), dropped in exactly the run where it matters most.
 *
 * Every fixture before this one set failPageIds OR silentlyDropPageIds. This
 * one sets both, which is the only reason it can fail.
 */
test('a run with BOTH failures and unconfirmed pages reports all three counts', () => {
  const rows = [];
  for (let i = 0; i < 39; i += 1) rows.push(row({ id: `c${i}` }));
  for (let i = 0; i < 2; i += 1) rows.push(row({ id: `f${i}`, name: 'About', ok: false, error: 'permission denied for this page' }));
  for (let i = 0; i < 2; i += 1) rows.push(row({ id: `u${i}`, verified: false }));

  const out = describeBulkTemplateOutcome({ rows, templateName: 'Blog Home' });

  assert.equal(out.counts.confirmed, 39);
  assert.equal(out.counts.failed, 2);
  assert.equal(out.counts.unconfirmed, 2);
  // The moved figure is the CONFIRMED figure. 41 would be the defect.
  assert.match(out.message, /39 of 43 pages moved to Blog Home and confirmed/);
  assert.doesNotMatch(out.message, /41 of 43/);
  // The read-back warning survives the presence of failures.
  assert.match(out.message, /could not be read back/);
  assert.match(out.message, /2 failed/);
  assert.equal(out.isError, true);
});

test('failures alone still name the page and the reason, and say those pages are unchanged', () => {
  const out = describeBulkTemplateOutcome({
    rows: [row({ id: '1' }), row({ id: '2', name: 'About', ok: false, error: 'permission denied' })],
    templateName: 'Blog Home',
  });
  assert.match(out.message, /1 of 2 pages moved to Blog Home and confirmed/);
  assert.match(out.message, /About: permission denied/);
  assert.match(out.message, /unchanged/);
});

test('a failure with no error text still reads as a sentence', () => {
  const out = describeBulkTemplateOutcome({
    rows: [row({ id: '2', ok: false, name: '' })],
    templateName: 'Blog Home',
  });
  assert.match(out.message, /unknown error/);
});

// ── Defect 3: "check them before publishing" names a gate that does not exist ─

/**
 * A page with no published snapshot is served straight from its draft
 * (routes/publicSite.js → getPublishedPage falls back to
 * getPublishedPageForProject), so on a project that has never published — most
 * of them — the re-pour is on the tenant's public domain the moment the call
 * returns. Telling the operator to check "before publishing" invites them to
 * believe there is a step between here and the visitor.
 */
test('an unconfirmed page that is live says so, and never says "before publishing"', () => {
  const out = describeBulkTemplateOutcome({
    rows: [row({ id: '1' }), row({ id: '2', verified: false, isLive: true })],
    templateName: 'Blog Home',
  });
  assert.match(out.message, /live on the public site right now/);
  assert.match(out.message, /Restore All from Archives/);
  assert.doesNotMatch(out.message, /before publishing/i);
});

test('when only SOME of the unconfirmed pages are live, the count says which', () => {
  const out = describeBulkTemplateOutcome({
    rows: [
      row({ id: '1', verified: false, isLive: true }),
      row({ id: '2', verified: false, isLive: false }),
    ],
    templateName: 'Blog Home',
  });
  // Naming the number is the difference between a fact and a scare.
  assert.match(out.message, /1 of them is live/);
});

test('unconfirmed pages that are NOT live do not claim to be', () => {
  const out = describeBulkTemplateOutcome({
    rows: [row({ id: '1', verified: false, isLive: false })],
    templateName: 'Blog Home',
  });
  assert.doesNotMatch(out.message, /live on the public site/);
  assert.match(out.message, /check those before trusting them/);
  assert.doesNotMatch(out.message, /before publishing/i);
});

// ── The clean run, and the empty one ────────────────────────────────────────

test('an all-confirmed run is a short sentence and is not an error', () => {
  const out = describeBulkTemplateOutcome({
    rows: [row({ id: '1' }), row({ id: '2' })],
    templateName: 'Blog Home',
  });
  assert.equal(out.isError, false);
  assert.match(out.message, /^2 pages moved to Blog Home, all confirmed\./);
});

test('one page reads as "1 page", not "1 pages"', () => {
  const out = describeBulkTemplateOutcome({ rows: [row({ id: '1' })], templateName: 'Blog Home' });
  assert.match(out.message, /^1 page moved to/);
});

test('a server answer naming no pages is an error, not a silent success', () => {
  const out = describeBulkTemplateOutcome({ rows: [], templateName: 'Blog Home' });
  assert.equal(out.isError, true);
  assert.match(out.message, /named no pages/);
});

test('a missing template name does not render as "undefined"', () => {
  const out = describeBulkTemplateOutcome({ rows: [row({ id: '1' })] });
  assert.doesNotMatch(out.message, /undefined/);
  assert.match(out.message, /the new template/);
});

test('called with nothing at all, it still answers', () => {
  assert.equal(describeBulkTemplateOutcome().isError, true);
  assert.equal(describeBulkTemplateOutcome(null).isError, true);
});

// ── Defect 1: the request that dies part-way ────────────────────────────────

/**
 * The store only reports failure when EVERY page failed, so a plain 500 is
 * harmless. The reachable case is the request dying after the server has
 * already written some pages — a serverless timeout, a dropped connection, or
 * a non-JSON response. This repo has that on file: a canonical propagation
 * that updated 30 of 50 pages before the function was frozen.
 *
 * The old catch notified and left the table showing the OLD template values,
 * so the operator read "nothing moved" off a screen whose pages had been
 * re-poured underneath it.
 */
test('an interrupted run says the outcome is unknown in BOTH directions', () => {
  const out = describeBulkTemplateInterruption({ error: 'Invalid API response', liveCount: 0 });
  assert.equal(out.isError, true);
  assert.match(out.message, /Invalid API response/);
  assert.match(out.message, /may already have been changed/);
  assert.match(out.message, /some may not/);
  // The table it is describing has been reloaded, and it says so — otherwise
  // the operator has no way to know the screen is current.
  assert.match(out.message, /the list has been reloaded/);
  assert.match(out.message, /Restore All from Archives/);
});

test('an interrupted run names how many of the selected pages are live', () => {
  const out = describeBulkTemplateInterruption({ error: 'network error', liveCount: 43 });
  assert.match(out.message, /43 of the selected pages are live on the public site/);
});

test('an interrupted run with nothing live does not invent a live count', () => {
  const out = describeBulkTemplateInterruption({ error: 'network error', liveCount: 0 });
  assert.doesNotMatch(out.message, /live on the public site/);
});

test('an interruption with no message still reads as a sentence', () => {
  for (const opts of [undefined, null, {}, { error: '' }, { error: null, liveCount: 'x' }]) {
    const out = describeBulkTemplateInterruption(opts);
    assert.match(out.message, /^the request failed\./i);
    assert.doesNotMatch(out.message, /undefined|NaN/);
  }
});
