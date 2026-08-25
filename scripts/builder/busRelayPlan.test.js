'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { defaultWatches, handbackTarget } = require('./busRelayPlan.js');

const watches = defaultWatches({ agentResponseList: 'AR', loopQueueList: 'LQ' });
const agentResponse = watches.find((w) => w.list === 'AR');
const loopQueue = watches.find((w) => w.list === 'LQ');

test('both standing watches exist and carry their statuses', () => {
  assert.deepEqual(agentResponse.statuses, ['pending response', 'responding']);
  assert.deepEqual(loopQueue.statuses, ['needs your input', 'ready to launch']);
});

test('an answered "needs your input" ticket goes back to Queued', () => {
  assert.equal(handbackTarget(loopQueue, 'needs your input', 1), 'Queued');
});

test('status match is case-insensitive (ClickUp echoes lowercase, humans type anything)', () => {
  assert.equal(handbackTarget(loopQueue, 'Needs Your Input', 2), 'Queued');
});

test('"ready to launch" is notify-only: a comment never moves it', () => {
  assert.equal(handbackTarget(loopQueue, 'ready to launch', 1), null);
});

test('no fresh comment, no move — a parked ticket with old comments stays parked', () => {
  assert.equal(handbackTarget(loopQueue, 'needs your input', 0), null);
});

test('the Agent Response list never hands anything back', () => {
  assert.equal(handbackTarget(agentResponse, 'pending response', 3), null);
});

test('a watch with no handback table at all is safe', () => {
  assert.equal(handbackTarget({ statuses: [] }, 'needs your input', 1), null);
});

test('an unknown status is never moved even with fresh comments', () => {
  assert.equal(handbackTarget(loopQueue, 'building', 1), null);
});

test('only the Loop Queue watch may merge — Agent Response never can', () => {
  const { mergeEnabled } = require('./busRelayPlan.js');
  assert.equal(mergeEnabled(loopQueue), true);
  assert.equal(mergeEnabled(agentResponse), false);
});

test('an ad-hoc --list watch (no merge flag) can never merge anything', () => {
  const { mergeEnabled } = require('./busRelayPlan.js');
  assert.equal(mergeEnabled({ list: 'X', statuses: ['ready to launch'], handback: {} }), false);
  assert.equal(mergeEnabled(undefined), false);
});

// ---------------------------------------------------------------------------
// Delivery: what satisfies the handback gate (task 86bbjxew2, 2026-08-23).
// ---------------------------------------------------------------------------

const {
  BUS_RELAY_MARKER,
  deliveryVerdict,
  relayMarkerText,
  receiptText,
  RECEIPT_FINGERPRINT,
  receiptSignature,
  isThisReceipt,
  busFailureBucket,
} = require('./busRelayPlan.js');

const AT = '2026-08-23T22:04:00.000Z';

test('delivered via chat: the party line worked, nothing else was needed', () => {
  const v = deliveryVerdict({ chatOk: true, receiptOk: false, handsBack: true });
  assert.deepEqual(v, { ok: true, via: 'chat' });
  assert.equal(
    relayMarkerText({ ...v, channel: '2kydhxeu-474', at: AT }),
    '[bus-relay] sent to channel 2kydhxeu-474 at 2026-08-23T22:04:00.000Z',
  );
});

test('chat winning is not conditional on the receipt — it is preferred, not a tie', () => {
  assert.deepEqual(deliveryVerdict({ chatOk: true, receiptOk: true, handsBack: true }), { ok: true, via: 'chat' });
});

test('delivered via the fallback: chat failed, the ticket receipt landed', () => {
  const v = deliveryVerdict({
    chatOk: false, handsBack: true, receiptAttempted: true, receiptPosted: true, receiptOk: true,
  });
  assert.deepEqual(v, { ok: true, via: 'ticket' });
  assert.equal(
    relayMarkerText({ ...v, channel: '2kydhxeu-474', at: AT }),
    '[bus-relay] chat unavailable, receipted on the ticket at 2026-08-23T22:04:00.000Z',
  );
});

test('delivered by neither: not delivered, no marker, and so no handback', () => {
  const v = deliveryVerdict({
    chatOk: false, handsBack: true, receiptAttempted: true, receiptPosted: false, receiptStatus: 401,
  });
  assert.equal(v.ok, false);
  assert.equal(v.via, 'none');
  assert.match(v.why, /receipt comment also failed \(HTTP 401\)/);
  // Nothing to mark — a comment nobody received is retried next pass.
  assert.equal(relayMarkerText({ ...v, channel: 'X', at: AT }), null);
  // And the gate holds: fresh counts only delivered comments, so this task
  // stays exactly where it is. This is the non-goal made executable.
  assert.equal(handbackTarget(loopQueue, 'needs your input', 0), null);
});

test('every marker starts with the shared prefix, so "already relayed" still matches', () => {
  for (const via of ['chat', 'ticket']) {
    const text = relayMarkerText({ via, channel: 'C', at: AT });
    assert.ok(text.startsWith(BUS_RELAY_MARKER), `${via} marker must start with the prefix`);
  }
});

test('the receipt is a receipt, not a re-quote of his words', () => {
  const text = receiptText({ why: 'HTTP 400', target: 'Queued', at: AT });
  assert.match(text, /Your answer was read/);
  assert.match(text, /being returned to Queued/);
  assert.match(text, /HTTP 400/);
  assert.match(text, /party line is unavailable/i);
});

// Defence in depth only: since the review fix, deliverToBus never writes a
// receipt without a handback target, because a receipt there delivers nothing.
// The branch stays so a future caller cannot produce a sentence promising a
// move that was never going to happen.
test('a receipt with no target promises no move (unreachable, kept as a guard)', () => {
  const text = receiptText({ why: 'HTTP 400' });
  assert.match(text, /read and picked up/);
  assert.doesNotMatch(text, /going back to/);
});

test('a bus failure that still reached the ticket is skipped, not unchecked', () => {
  assert.equal(busFailureBucket({ delivered: true, cosmetic: false }), 'skipped');
});

test('a bus failure whose explanation is already on the ticket is cosmetic', () => {
  // The merge step's own three posts: each writes its real explanation as a
  // task comment first, so the bus post carries nothing that was lost.
  assert.equal(busFailureBucket({ delivered: false, cosmetic: true }), 'skipped');
});

test('a bus failure nobody was told about is still "could not fully verify"', () => {
  assert.equal(busFailureBucket({ delivered: false, cosmetic: false }), 'unchecked');
  assert.equal(busFailureBucket({}), 'unchecked');
});

// ── The receipt only delivers where something reads the ticket ────────────

/**
 * Review finding, 2026-08-23, and the one that mattered. Of the three watches
 * only ONE hands the ticket back:
 *
 *   Agent Response, fresh comment   -> no target
 *   Loop Queue, "ready to launch"   -> no target
 *   Loop Queue, "needs your input"  -> Queued
 *
 * The fallback's whole justification is "the answer is already a comment on
 * the ticket, which is where every loop reads it from" — true only for that
 * last one. On the other two the party line IS the delivery, so counting a
 * receipt would post a note to Dane on a ticket he is already reading, write
 * the permanent dedup marker, and lose the bus message for good once chat
 * recovered. That converts a self-healing retry into silent permanent loss,
 * which is the exact bug this whole ticket exists to remove.
 */
test('a receipt on a watch that hands nothing back is NOT delivery', () => {
  const v = deliveryVerdict({ chatOk: false, receiptAttempted: true, receiptOk: true, handsBack: false });
  assert.equal(v.ok, false, 'nothing reads this ticket — the party line was the delivery');
  assert.equal(v.via, 'none');
  assert.match(v.why, /hands nothing back/);
});

test('handsBack omitted is treated as no handback, not as yes', () => {
  // The safe default, because the failure is silent in one direction only.
  assert.equal(deliveryVerdict({ chatOk: false, receiptAttempted: true, receiptPosted: true, receiptOk: true }).ok, false);
});

test('and so no marker is written for it — it retries next pass', () => {
  const v = deliveryVerdict({ chatOk: false, receiptAttempted: true, receiptOk: true, handsBack: false });
  assert.equal(relayMarkerText({ ...v, channel: 'c', at: AT }), null,
    'a marker here would make the "already relayed" check skip it forever');
});

test('exactly one of the three watched cases hands the ticket back', () => {
  const handsBack = (watch, status) => Boolean(handbackTarget(watch, status, 1));
  // This is the table the fix is built on, asserted rather than assumed.
  assert.equal(handsBack(loopQueue, 'needs your input'), true);
  assert.equal(handsBack(loopQueue, 'ready to launch'), false);
  assert.equal(handsBack(agentResponse, 'pending response'), false);
  assert.equal(handsBack(agentResponse, 'responding'), false);
});

// ── The receipt says what has happened, never what is about to ────────────

test('the receipt does not announce a move it has not made', () => {
  const text = receiptText({ why: 'HTTP 400', target: 'Queued' });
  assert.match(text, /Your answer was read and picked up\./);
  assert.match(text, /being returned to Queued/);
  // "is going back to" promised a completed move before the PUT was tried; a
  // failed move then left the ticket carrying a comment saying otherwise.
  assert.doesNotMatch(text, /is going back to/);
  assert.doesNotMatch(text, /has been returned|was returned|has moved/);
});

test('the receipt carries the fingerprint the read-back searches for', () => {
  // deliverToBus proves the receipt stuck by finding this string. If the
  // wording and the fingerprint ever drift apart, every receipt reads as
  // "posted but could not be read back" and no ticket is ever handed back.
  assert.ok(receiptText({ why: 'x', target: 'Queued' }).includes(RECEIPT_FINGERPRINT));
});

test('the receipt still names why the party line was skipped', () => {
  assert.match(receiptText({ why: 'HTTP 400', target: 'Queued' }), /HTTP 400/);
  assert.match(receiptText({ target: 'Queued' }), /reason unknown/);
});

// ── The undelivered reason is a decision, not a sentence in the caller ────

/**
 * Review finding, 2026-08-24, hit verbatim in a real run. The caller printed
 * "the party line failed and so did the receipt comment" for EVERY undelivered
 * case — including the notify-only watches, where no receipt is ever attempted.
 * During a chat outage that line appears against every Agent Response comment
 * and tells the reader task comments are failing too, which is the opposite of
 * what is true and the opposite of what LOOP_ENGINEERING says to conclude.
 */
test('no handback, no receipt attempted: the reason says exactly that', () => {
  const v = deliveryVerdict({ chatOk: false, handsBack: false, receiptAttempted: false });
  assert.equal(v.ok, false);
  assert.match(v.why, /no receipt was attempted/);
  assert.match(v.why, /hands nothing back/);
  // The wrong sentence, made unsayable.
  assert.doesNotMatch(v.why, /also failed/);
});

test('the receipt POST failing names the status it actually got', () => {
  const v = deliveryVerdict({
    chatOk: false, handsBack: true, receiptAttempted: true, receiptPosted: false, receiptStatus: 503,
  });
  assert.equal(v.ok, false);
  assert.match(v.why, /receipt comment also failed \(HTTP 503\)/);
});

test('a 200 that did not stick is reported as unread-back, not as a failed post', () => {
  const v = deliveryVerdict({
    chatOk: false, handsBack: true, receiptAttempted: true, receiptPosted: true, receiptOk: false,
  });
  assert.equal(v.ok, false, 'an unverified receipt is not delivery');
  assert.match(v.why, /could not be read back/);
  assert.doesNotMatch(v.why, /also failed/);
});

test('a delivered verdict carries no reason to print', () => {
  for (const v of [
    deliveryVerdict({ chatOk: true }),
    deliveryVerdict({ chatOk: false, handsBack: true, receiptAttempted: true, receiptPosted: true, receiptOk: true }),
  ]) {
    assert.equal(v.ok, true);
    assert.equal(v.why, undefined, 'nothing failed, so there is nothing to explain');
  }
});

// ── Telling THIS receipt from a receipt ───────────────────────────────────

/**
 * Review finding, 2026-08-24. The read-back searched every comment on the task
 * for RECEIPT_FINGERPRINT, a constant. A ticket that took a receipt during one
 * outage, went back to Queued, later returned to "Needs your input" and hit a
 * second outage would have its new 200-that-did-not-stick "verified" by the
 * leftover from the first — the precise case the read-back was added to catch.
 */
test('the receipt carries the instant it was written', () => {
  const text = receiptText({ why: 'HTTP 400', target: 'Queued', at: AT });
  assert.ok(text.includes(receiptSignature(AT)));
  assert.match(text, /2026-08-23T22:04:00\.000Z/);
});

test('an older receipt on the same ticket does NOT verify a newer write', () => {
  const older = { id: 111, comment_text: receiptText({ why: 'HTTP 400', target: 'Queued', at: '2026-08-01T00:00:00.000Z' }) };
  assert.equal(isThisReceipt(older, { id: 222, at: AT }), false,
    'a leftover receipt must not stand in for one that never stuck');
});

test('the id from the POST identifies it', () => {
  assert.equal(isThisReceipt({ id: 222, comment_text: 'anything' }, { id: 222, at: AT }), true);
  assert.equal(isThisReceipt({ id: '222', comment_text: '' }, { id: 222 }), true, 'ids compare as strings');
});

test('the timestamp identifies it when the response carried no id', () => {
  const mine = { id: 999, comment_text: receiptText({ why: 'HTTP 400', target: 'Queued', at: AT }) };
  assert.equal(isThisReceipt(mine, { id: undefined, at: AT }), true);
});

test('a comment that is not a receipt at all never matches', () => {
  assert.equal(isThisReceipt({ id: 1, comment_text: 'Dane: go ahead' }, { id: 2, at: AT }), false);
  assert.equal(isThisReceipt(null, { id: 2, at: AT }), false);
  // And with nothing to match on, nothing matches — an unverifiable write is
  // reported, never assumed.
  assert.equal(isThisReceipt({ id: 1, comment_text: receiptText({ why: 'x', target: 'Queued', at: AT }) }, {}), false);
});

// ── The plumbing side of the two review findings ──────────────────────────

/**
 * These two fixes live in scripts/clickup_direct.mjs, which holds only network
 * plumbing and has no test harness. They are pinned here because both fail
 * SILENTLY: an unverified receipt hands a ticket back with the acknowledgement
 * existing nowhere, and a per-comment receipt piles duplicate notes onto a
 * ticket during exactly the outage this feature exists for.
 */
const RELAY_SRC = require('node:fs').readFileSync(
  require('node:path').join(__dirname, '../clickup_direct.mjs'), 'utf8');

test('the receipt is read back before it is trusted', () => {
  const post = RELAY_SRC.indexOf('comment_text: body });');
  assert.ok(post > -1, 'the receipt POST moved — re-point this test');
  assert.ok(RELAY_SRC.includes('isThisReceipt(c, { id: out.json && out.json.id, at })'),
    'the read-back must identify THIS write, by id or by its timestamp');
  // The verdict must be built from the read-back, never from the POST status.
  assert.match(RELAY_SRC, /receiptPosted: posted, receiptOk: stuck/,
    'the verdict must use the read-back result, not out.res.ok, as the delivery');
});

test('the read-back does not search for the bare fingerprint', () => {
  // Review finding, 2026-08-24. RECEIPT_FINGERPRINT is a constant, so every
  // receipt ever written to a ticket looks identical to it: a leftover from an
  // earlier outage would "verify" a fresh POST that never stuck, which is the
  // precise case the read-back exists to catch.
  assert.ok(!RELAY_SRC.includes('RECEIPT_FINGERPRINT'),
    'matching on the constant fingerprint cannot tell this receipt from an old one');
});

test('a watch with no handback target never posts a receipt at all', () => {
  // Not merely "does not count it" — does not write it. This watch retries
  // every pass until the bus accepts, so a receipt per pass would pile
  // identical notes onto the ticket forever while still losing the message.
  assert.match(RELAY_SRC, /if \(!handsBack\) \{/,
    'deliverToBus must bail out before the receipt when nothing hands back');
});

test('the undelivered line quotes the verdict, it does not invent a reason', () => {
  // Review finding, 2026-08-24: the line hard-coded "and so did the receipt
  // comment" even where no receipt was ever attempted, telling the reader task
  // comments were failing too — the opposite of the truth, during exactly the
  // outage the reader is trying to diagnose.
  assert.ok(!RELAY_SRC.includes('and so did the receipt comment'),
    'the caller must not assert a receipt attempt it knows nothing about');
  assert.match(RELAY_SRC, /delivery\.reason/,
    'the printed reason must come from deliveryVerdict');
  // ...and `reason` must survive: the original bug was spreading the verdict
  // and then overwriting its `why` with the chat failure.
  assert.match(RELAY_SRC, /reason: verdict\.why \|\| ''/,
    'the verdict reason and the chat reason must be separate fields');
});

test('the receipt is deduped per ticket, and remembers whether it verified', () => {
  assert.match(RELAY_SRC, /receipted\.has\(String\(taskId\)\)/);
  assert.match(RELAY_SRC, /const receipted = new Map\(\)/,
    'a Set cannot carry the verified flag a repeat comment needs');
  // Review finding, 2026-08-24: recording only on a successful read-back left
  // a transient GET failure unrecorded, so the next comment in the same pass
  // posted a second identical note — the pile-up the dedup exists to prevent.
  assert.match(RELAY_SRC, /if \(posted && receipted\) receipted\.set\(String\(taskId\), stuck\)/,
    'the ticket is recorded once the POST lands; verification travels in the value');
});
