'use strict';

/**
 * A ticket Dane is working on by hand must not be sent back to the build loop
 * whenever anything comments on it (task 86bccgp8q).
 *
 * The incident, 2026-10-03, on the MaxOne erase ticket 86bbvr0zf. The comment
 * shapes below are the real ones from that trail, in the real order:
 *
 *   16:28:07Z  `pipeline sweep --apply` note, UNSTAMPED, under Dane's token
 *   16:28:26Z  escalation card (stamped)
 *   16:37:10Z  relay receipt: "This ticket is being returned to Queued"
 *   17:34:03Z  Dane: "Done(?)"  — mid-task, in his own session
 *   18:02:03Z  card saying "held by Dane's own session... leave it here"
 *   19:51:20Z  Dane answers that card — and the relay re-queued it again
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  answerAwaitingHandback, receiptTargetFor, handHeldText, isHandHeldMarker,
  ESCALATION_BANNER, operatorComments,
} = require('./busRelayPlan.js');
const { isMachineComment, stampMachineComment } = require('./machineComment.js');
const { sweptTicketNote } = require('./pipelinePause.js');
const { sweepStranded } = require('./pipelineSweep.js');
const { answerFindings } = require('../../lib/staleAnswer.js');

const DANE = 48012725;
const opts = { operatorId: DANE, isMachine: isMachineComment };
const t = (iso) => String(Date.parse(iso));
const card = (id, iso) => ({
  id, date: t(iso), user: { id: DANE },
  comment_text: stampMachineComment(`Context.\n\n#############################\n${ESCALATION_BANNER} Sign in to Drive again.`),
});
const his = (id, iso, text) => ({ id, date: t(iso), user: { id: DANE }, comment_text: text });
const hold = (id, iso) => ({
  id, date: t(iso), user: { id: DANE },
  comment_text: stampMachineComment(handHeldText({ at: iso, by: 'fast-track session' })),
});

// ---------------------------------------------------------------------------
// The sweep's note
// ---------------------------------------------------------------------------

test('the sweep note it POSTS carries the machine stamp, so the relay never reads it as Dane', async () => {
  const NOW = Date.parse('2026-10-03T16:28:00Z');
  const task = {
    id: 'b1', name: 'MaxOne erase', status: { status: 'building' }, assignees: [],
    date_updated: String(NOW - 3 * 60 * 60 * 1000),
    custom_fields: [{ name: 'Loop note', value: '🔨 building — claimed 2:10am' }],
  };
  const posted = [];
  const tryCall = async (method, path, body) => {
    if (method === 'POST') { posted.push(body.comment_text); return { ok: true, res: { status: 200 }, json: {} }; }
    return { ok: true, res: { status: 200 }, json: { status: { status: body.status } } };
  };
  await sweepStranded({
    by: 'a test', queue: { readable: true, tasks: [task] }, nowMs: NOW, apply: true,
    buildStartFor: async () => ({ action: 'fresh' }),
    clearLoopNote: async () => true,
    tryCall,
    findLocalWork: async () => ({ verdict: 'none', work: [], unseen: [], unlooked: [] }),
    log: () => {},
  });
  assert.equal(posted.length, 1, 'the sweep posted its hand-back note');
  assert.ok(isMachineComment(posted[0]), `the posted note must be machine-stamped:\n${posted[0]}`);
  assert.equal(
    operatorComments([{ id: 'n', user: { id: DANE }, comment_text: posted[0] }], opts).length, 0,
    'and therefore is never counted as his comment',
  );
});

test('a sweep note landing on a Needs-your-input ticket leaves it where it is', () => {
  const note = stampMachineComment(sweptTicketNote({ at: 'now', by: 'an agent session' }));
  const out = answerAwaitingHandback({
    ...opts,
    comments: [card('c', '2026-10-03T16:28:26Z'), { id: 'n', date: t('2026-10-03T16:40:00Z'), user: { id: DANE }, comment_text: note }],
  });
  assert.equal(out.state, 'none', 'no answer of his after the card, so nothing releases it');
});

test('the 10:37am shape: an UNSTAMPED note before the card releases nothing, and its receipt names no move', () => {
  const unstamped = his('n', '2026-10-03T16:28:07Z', sweptTicketNote({ at: 'now', by: 'an agent session' }));
  const comments = [unstamped, card('c', '2026-10-03T16:28:26Z')];
  const verdict = answerAwaitingHandback({ ...opts, comments });
  assert.equal(verdict.state, 'none');
  // The old receipt said "This ticket is being returned to Queued" here.
  assert.equal(receiptTargetFor({ verdict, commentId: 'n', target: 'Queued' }), null);
});

// ---------------------------------------------------------------------------
// The hold
// ---------------------------------------------------------------------------

test('held by hand: his answer to the card is relayed but does NOT hand the ticket back', () => {
  const comments = [
    card('c', '2026-10-03T18:02:03Z'),
    hold('h', '2026-10-03T18:02:05Z'),
    his('a', '2026-10-03T19:51:20Z', 'mentorofaio Gdrive\nDoppler'),
  ];
  const verdict = answerAwaitingHandback({ ...opts, comments, delivered: () => true });
  assert.equal(verdict.state, 'hand-held');
  assert.equal(verdict.answer.id, 'a', 'his answer is still identified, so it is still relayed');
  assert.equal(receiptTargetFor({ verdict, commentId: 'a', target: 'Queued' }), null,
    'and the receipt does not claim a move');
});

test('a "Done(?)" mid-task on a held ticket does not release it either', () => {
  const comments = [card('c', '2026-10-03T16:28:26Z'), hold('h', '2026-10-03T16:28:30Z'), his('d', '2026-10-03T17:34:03Z', 'Done(?)')];
  assert.equal(answerAwaitingHandback({ ...opts, comments }).state, 'hand-held');
});

test('a newer question card from a loop ends the hold', () => {
  const comments = [
    card('c1', '2026-10-03T16:28:26Z'), hold('h', '2026-10-03T16:28:30Z'),
    card('c2', '2026-10-04T09:00:00Z'), his('a', '2026-10-04T10:00:00Z', 'B'),
  ];
  const verdict = answerAwaitingHandback({ ...opts, comments, delivered: () => true });
  assert.equal(verdict.state, 'answered');
  assert.equal(receiptTargetFor({ verdict, commentId: 'a', target: 'Queued' }), 'Queued');
});

test('Dane quoting the hold text is not a hold — only a machine-written marker counts', () => {
  const quoted = his('q', '2026-10-03T16:29:00Z', handHeldText({ at: 'x' }));
  assert.ok(isHandHeldMarker(quoted.comment_text), 'the text matches the marker');
  const comments = [card('c', '2026-10-03T16:28:26Z'), quoted, his('a', '2026-10-03T17:00:00Z', 'go')];
  assert.equal(answerAwaitingHandback({ ...opts, comments }).state, 'answered');
});

test('a hold OLDER than the newest card has lapsed', () => {
  const comments = [hold('h', '2026-10-01T00:00:00Z'), card('c', '2026-10-03T16:28:26Z'), his('a', '2026-10-03T17:00:00Z', 'go')];
  assert.equal(answerAwaitingHandback({ ...opts, comments }).state, 'answered');
});

test('the stale-answer watchdog stays quiet on a held ticket instead of calling the hand-back broken', () => {
  const { findings, fresh } = answerFindings([
    { taskId: 'x', name: 'held', state: 'hand-held', answerMinutes: 600, delivered: true, commentsReadable: true },
  ]);
  assert.deepEqual(findings, []);
  assert.deepEqual(fresh, ['x']);
});

// ---------------------------------------------------------------------------
// The receipt
// ---------------------------------------------------------------------------

test('the receipt names the move only for the comment that makes it', () => {
  const comments = [his('old', '2026-10-03T10:00:00Z', 'earlier'), card('c', '2026-10-03T16:28:26Z'),
    his('a1', '2026-10-03T17:00:00Z', 'first'), his('a2', '2026-10-03T17:05:00Z', 'second')];
  const verdict = answerAwaitingHandback({ ...opts, comments });
  assert.equal(receiptTargetFor({ verdict, commentId: 'a2', target: 'Queued' }), 'Queued', 'the newest answer moves it');
  assert.equal(receiptTargetFor({ verdict, commentId: 'a1', target: 'Queued' }), null);
  assert.equal(receiptTargetFor({ verdict, commentId: 'old', target: 'Queued' }), null);
  // No card on the trail: the old fresh-comment rule still moves it, so the
  // receipt may still say so.
  const noCard = answerAwaitingHandback({ ...opts, comments: [his('a', '2026-10-03T17:00:00Z', 'go')] });
  assert.equal(receiptTargetFor({ verdict: noCard, commentId: 'a', target: 'Queued' }), 'Queued');
  assert.equal(receiptTargetFor({ verdict, commentId: 'a2', target: null }), null, 'a notify-only watch has no target');
});

// ---------------------------------------------------------------------------
// Wiring — the two places the rules above must actually be called from.
// ---------------------------------------------------------------------------

const fs = require('node:fs');
const path = require('node:path');
const src = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('the relay passes its receipt target through receiptTargetFor', () => {
  const relay = src('clickup_direct.mjs');
  assert.match(relay, /const simTarget = receiptTargetFor\(\{\s*verdict: releaseVerdict,/,
    'the receipt target must come from receiptTargetFor, or the receipt claims moves that never happen');
});

test('pipeline.mjs stamps every comment it posts, at its own door', () => {
  const pipeline = src('pipeline.mjs');
  assert.match(pipeline, /async function call\(method, path, body\) \{[\s\S]{0,600}?isCommentPostPath\(path\)\) body = stampCommentBody\(body\)/);
});
