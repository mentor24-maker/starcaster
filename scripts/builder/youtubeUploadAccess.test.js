'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pickTokenSource, hasUploadScope, judgeUploadAccess, exitCodeFor,
} = require('../../lib/youtubeUploadAccess');

const UPLOAD = 'https://www.googleapis.com/auth/youtube.upload';
const DRIVE = 'https://www.googleapis.com/auth/drive';

test('the upload sign-in wins over the Drive sign-in; neither is none', () => {
  assert.equal(pickTokenSource({ YOUTUBE_UPLOAD_REFRESH_TOKEN: 'a', GOOGLE_DRIVE_REFRESH_TOKEN: 'b' }).name, 'YOUTUBE_UPLOAD_REFRESH_TOKEN');
  assert.equal(pickTokenSource({ GOOGLE_DRIVE_REFRESH_TOKEN: 'b' }).name, 'GOOGLE_DRIVE_REFRESH_TOKEN');
  assert.equal(pickTokenSource({ YOUTUBE_UPLOAD_REFRESH_TOKEN: '  ' }), null);
});

test('any of the three YouTube write scopes counts as upload permission; Drive does not', () => {
  assert.equal(hasUploadScope([DRIVE]), false);
  assert.equal(hasUploadScope([DRIVE, UPLOAD]), true);
  assert.equal(hasUploadScope(['https://www.googleapis.com/auth/youtube']), true);
  assert.equal(hasUploadScope(['https://www.googleapis.com/auth/youtube.readonly']), false);
  assert.equal(hasUploadScope(undefined), false);
});

test('READY only for the Dane of Earth channel with upload permission', () => {
  const judged = judgeUploadAccess({ scopes: { ok: true, scopes: [UPLOAD] }, channels: { ok: true, titles: ['Dane of Earth'] } });
  assert.deepEqual([judged.verdict, judged.channel, judged.upload], ['READY', 'Dane of Earth', 'yes']);
  assert.equal(exitCodeFor(judged.verdict), 0);
});

test('a sign-in for another channel is NOT READY and names that channel', () => {
  const judged = judgeUploadAccess({ scopes: { ok: true, scopes: [UPLOAD] }, channels: { ok: true, titles: ['Alphire'] } });
  assert.equal(judged.verdict, 'NOT READY');
  assert.equal(judged.channel, 'Alphire');
  assert.match(judged.reasons.join(' '), /"Alphire", not "Dane of Earth"/);
  assert.equal(exitCodeFor(judged.verdict), 1);
});

test('the Drive-only sign-in seen live on 2026-11-17 is NOT READY, not CANNOT TELL', () => {
  // Google answered the permission question (Drive only), so the answer is a
  // real no, even though YouTube then refused to name the channel.
  const judged = judgeUploadAccess({
    scopes: { ok: true, scopes: [DRIVE] },
    channels: { ok: false, error: 'YouTube said 403: Request had insufficient authentication scopes.' },
  });
  assert.equal(judged.verdict, 'NOT READY');
  assert.equal(judged.upload, 'no');
});

test('a lookup that failed is CANNOT TELL, never read as "no permission"', () => {
  const judged = judgeUploadAccess({ scopes: { ok: false, error: 'timeout' }, channels: { ok: false, error: 'timeout' } });
  assert.equal(judged.verdict, 'CANNOT TELL');
  assert.equal(judged.upload, 'unknown');
  assert.equal(exitCodeFor(judged.verdict), 2);
});

test('upload permission with the channel unreadable is CANNOT TELL, not READY', () => {
  const judged = judgeUploadAccess({ scopes: { ok: true, scopes: [UPLOAD] }, channels: { ok: false, error: '500' } });
  assert.equal(judged.verdict, 'CANNOT TELL');
});

test('an account with no channel at all is NOT READY and says so', () => {
  const judged = judgeUploadAccess({ scopes: { ok: true, scopes: [UPLOAD] }, channels: { ok: true, titles: [] } });
  assert.equal(judged.verdict, 'NOT READY');
  assert.match(judged.reasons.join(' '), /no YouTube channel/);
});
