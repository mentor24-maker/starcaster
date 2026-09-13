'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const n = require('./loopNoteComment.js');

const field = (value) => ({ custom_fields: [{ name: 'Loop note', value }] });

test('a note comment carries a fixed marker and reads back as its one line', () => {
  const body = n.renderNoteComment('🔍 being checked — a review pass started 9/13 9:40am');
  assert.equal(body, '🔖 Loop note: 🔍 being checked — a review pass started 9/13 9:40am');
  assert.equal(n.noteOfComment({ comment_text: body }), '🔍 being checked — a review pass started 9/13 9:40am');
  assert.equal(n.noteOfComment({ comment_text: 'PR opened: https://github.com/x/y/pull/1' }), '', 'an ordinary comment is not a note');
  assert.throws(() => n.renderNoteComment('   '), /needs text/);
});

test('the newest note comment wins, by date not by position', () => {
  const comments = [
    { date: '300', comment_text: n.renderNoteComment('🔀 PR #9 open') },
    { date: '100', comment_text: n.renderNoteComment('🔨 building — claimed 9:00am') },
    { date: '400', comment_text: 'an unrelated remark' },
  ];
  assert.equal(n.latestNote(comments), '🔀 PR #9 open');
  assert.equal(n.latestNote([]), '');
});

test('a read note comment outranks the field, which only fills in when none was read', () => {
  const stale = field('🔨 building — claimed 9/7');
  assert.equal(n.resolveLoopNote(stale), '🔨 building — claimed 9/7', 'unread: the field, as before');
  assert.equal(n.resolveLoopNote({ ...stale, loop_note_comment: '👀 verified' }), '👀 verified',
    'the field has been frozen since the plan refused writes; the comment is the live record');
  assert.equal(n.resolveLoopNote({ ...stale, loop_note_comment: '' }), '🔨 building — claimed 9/7');
});

test('only in-flight tickets are read, and a failed read is counted rather than hidden', async () => {
  const tasks = [
    { id: 'a', status: { status: 'in review' }, ...field('') },
    { id: 'b', status: { status: 'queued' } },
    { id: 'c', status: { status: 'Building' } },
    { id: 'd', status: { status: 'live' } },
  ];
  const asked = [];
  const result = await n.hydrateLoopNotes(tasks, async (id) => {
    asked.push(id);
    if (id === 'c') throw new Error('429');
    return [{ date: '1', comment_text: n.renderNoteComment('🔍 being checked') }];
  });
  assert.deepEqual(asked, ['a', 'c'], 'queued and closed tickets cost no request');
  assert.deepEqual(result, { read: 1, failed: 1 });
  assert.equal(n.resolveLoopNote(tasks[0]), '🔍 being checked');
  assert.equal(tasks[2].loop_note_comment, undefined);
});

test('the pause and sweep reader sees a review claim that exists only as a comment', async () => {
  const store = require('./pipelinePauseStore.js');
  const claim = n.renderNoteComment('🔍 being checked — a review pass started 9/13 9:40am');
  const call = async (method, path) => {
    if (path.includes('/list/') && path.includes('page=0')) {
      return { res: { ok: true, status: 200 }, json: { tasks: [
        { id: 'r1', name: 'Being reviewed', status: { status: 'in review' }, custom_fields: [{ name: 'Loop note', value: '' }] },
        { id: 'q1', name: 'Waiting', status: { status: 'queued' } },
      ] } };
    }
    if (path.includes('/list/')) return { res: { ok: true, status: 200 }, json: { tasks: [] } };
    if (path === '/api/v2/task/r1/comment') return { res: { ok: true, status: 200 }, json: { comments: [{ id: 'c', date: '9', comment_text: claim }] } };
    throw new Error(`unexpected ${method} ${path}`);
  };
  const q = await store.fetchQueue({ call, list: 'L' });
  assert.equal(q.readable, true);
  const reviewed = q.tasks.find((t) => t.id === 'r1');
  assert.equal(store.loopNoteOf(reviewed), '🔍 being checked — a review pass started 9/13 9:40am',
    'with the field refusing writes, the claim lives only in the comment — the sweep must see it or it treats a live review as stranded');
});
