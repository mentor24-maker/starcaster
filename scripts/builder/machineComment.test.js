'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MACHINE_MARKER,
  MACHINE_MARKER_LINE,
  isMachineComment,
  stampMachineComment,
  commentTextKey,
  isCommentPostPath,
} = require('./machineComment.js');

const { waitingVerdict, newestComment, operatorSpokeLast, WAITING, NOT_WAITING } = require('./waitingOnOperator.js');

const DANE = 48012725;

/* ------------------------------------------------------------------ *
 * The marker itself
 * ------------------------------------------------------------------ */

test('an unmarked comment is not machine-written', () => {
  assert.equal(isMachineComment('A'), false);
  assert.equal(isMachineComment('merge'), false);
});

test('a stamped comment is machine-written, and the original text survives', () => {
  const stamped = stampMachineComment('Card body here');
  assert.equal(isMachineComment(stamped), true);
  assert.ok(stamped.startsWith('Card body here'));
});

test('stamping is idempotent — a retry cannot leave two markers', () => {
  const once = stampMachineComment('body');
  const twice = stampMachineComment(once);
  assert.equal(once, twice);
  assert.equal(twice.split(MACHINE_MARKER).length - 1, 1);
});

test('an empty comment is not machine-written (nothing was read)', () => {
  assert.equal(isMachineComment(''), false);
  assert.equal(isMachineComment('   \n  '), false);
});

test('an unreadable comment is NOT called machine-written — that is a "could not tell"', () => {
  assert.equal(isMachineComment(null), false);
  assert.equal(isMachineComment(undefined), false);
});

test('legacy machine comments are recognised by their announced prefix', () => {
  assert.equal(isMachineComment('[CC-starcaster bus-relay] Dane replied on "x"'), true);
  assert.equal(isMachineComment('[auto-merge] armed PR #438 lane A — 2026-08-30'), true);
});

/* --- the direction it fails in, which is the point of the anchoring --- */

test('Dane quoting a machine card is still Dane — the marker is not the last line', () => {
  const hisAnswer = `You wrote:\n\n${MACHINE_MARKER_LINE}\n\nand my answer is B`;
  assert.equal(isMachineComment(hisAnswer), false);
});

test('the marker is only honoured on the LAST non-empty line', () => {
  assert.equal(isMachineComment(`${MACHINE_MARKER_LINE}\n\nbut then he typed more`), false);
  assert.equal(isMachineComment(`he typed this\n\n${MACHINE_MARKER_LINE}\n\n  \n`), true);
});

/* ------------------------------------------------------------------ *
 * The choke point: which requests get stamped
 * ------------------------------------------------------------------ */

test('task-comment and reply POSTs are comment posts; nothing else is', () => {
  assert.equal(isCommentPostPath('/api/v2/task/86bbqx2xe/comment'), true);
  assert.equal(isCommentPostPath('/api/v2/comment/12345/reply'), true);
  assert.equal(isCommentPostPath('/api/v2/task/86bbqx2xe'), false);
  assert.equal(isCommentPostPath('/api/v2/list/901418546619/task'), false);
  // The bus is a chat channel, not a ticket — his own relayed words must never
  // be stamped as a machine's.
  assert.equal(isCommentPostPath('/api/v3/workspaces/1/channels/2/messages'), false);
});

test('the text key is found in both body shapes, and the rich array form is left alone', () => {
  assert.equal(commentTextKey({ comment_text: 'x' }), 'comment_text');
  assert.equal(commentTextKey({ comment: 'x' }), 'comment');
  assert.equal(commentTextKey({ comment: [{ text: 'x' }] }), null);
  assert.equal(commentTextKey(null), null);
});

/* ------------------------------------------------------------------ *
 * The two consumers. This is the bug itself, in both directions.
 * ------------------------------------------------------------------ */

const machineCard = {
  id: '1', date: '2000', user: { id: DANE, username: 'Dane' },
  comment_text: stampMachineComment('@@ASKED Which option?'),
};
const hisAnswer = {
  id: '2', date: '3000', user: { id: DANE, username: 'Dane' }, comment_text: 'B',
};

test('a machine card under his id is not his last word', () => {
  assert.equal(operatorSpokeLast([machineCard], { operatorId: DANE }), false);
  assert.equal(newestComment([machineCard], { operatorId: DANE }).isOperator, false);
  assert.equal(newestComment([machineCard], { operatorId: DANE }).byMachine, true);
});

test('his real answer still counts as his — the guard did not break the good case', () => {
  assert.equal(operatorSpokeLast([machineCard, hisAnswer], { operatorId: DANE }), true);
  assert.equal(newestComment([machineCard, hisAnswer], { operatorId: DANE }).isOperator, true);
});

test('THE BUG: an escalated ticket whose newest comment is its own ask card is WAITING on Dane', () => {
  const verdict = waitingVerdict({
    task: { status: { status: 'Needs your input' }, assignees: [{ id: DANE }] },
    comments: [machineCard],
  }, { operatorId: DANE });
  assert.equal(verdict.verdict, WAITING);
});

test('and once he answers it, it is NOT waiting on him any more', () => {
  const verdict = waitingVerdict({
    task: { status: { status: 'Needs your input' }, assignees: [{ id: DANE }] },
    comments: [machineCard, hisAnswer],
  }, { operatorId: DANE });
  assert.equal(verdict.verdict, NOT_WAITING);
});

test('THE UNDER-REPORT: Ready to launch with a machine verdict card still reports as his', () => {
  const passCard = {
    id: '9', date: '5000', user: { id: DANE, username: 'Dane' },
    comment_text: stampMachineComment('REVIEW: PASS — every gate green.'),
  };
  const verdict = waitingVerdict({
    task: { status: { status: 'Ready to launch' }, assignees: [{ id: DANE }] },
    comments: [passCard],
  }, { operatorId: DANE });
  assert.equal(verdict.verdict, WAITING);
});
