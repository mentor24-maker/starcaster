'use strict';

// The one "same site" rule Site Import uses (task 86bcynqrt). The incident:
// https://www.wavecenter.com/ and https://wavecenter.com/ were imported into
// one project two weeks apart and nothing noticed they were the same site.

const test = require('node:test');
const assert = require('node:assert/strict');

const ss = require('../../lib/siteImportSameSite.js');

test('www and no-www are the same site (the wavecenter incident)', () => {
  assert.equal(ss.isSameSite('https://www.wavecenter.com/', 'https://wavecenter.com/'), true);
  assert.equal(ss.isSameSite('https://www.wavecenter.com/', 'wavecenter.com'), true);
});

test('a trailing slash does not make a different site', () => {
  assert.equal(ss.isSameSite('https://wavecenter.com', 'https://wavecenter.com/'), true);
  assert.equal(ss.isSameSite('https://wavecenter.com/blog/', 'https://wavecenter.com/blog'), true);
});

test('letter case is ignored in the host', () => {
  assert.equal(ss.isSameSite('https://WWW.WaveCenter.COM/', 'https://wavecenter.com'), true);
});

test('a different path is a different site', () => {
  assert.equal(ss.isSameSite('https://wavecenter.com/blog', 'https://wavecenter.com/'), false);
});

test('a different host is a different site', () => {
  assert.equal(ss.isSameSite('https://wavecenter.com/', 'https://pressplay.today/'), false);
  assert.equal(ss.isSameSite('https://shop.wavecenter.com/', 'https://wavecenter.com/'), false);
});

test('an unreadable address matches nothing, not even itself', () => {
  assert.equal(ss.isSameSite('', ''), false);
  assert.equal(ss.isSameSite('http://', 'http://'), false);
});

const job = (over) => ({
  id: 'simp_1', sourceUrl: 'https://www.wavecenter.com/', status: 'complete',
  checkpoints: {}, createdAt: '2026-10-13T12:00:00Z', finishedAt: '2026-11-05T00:51:00Z', ...over,
});

test('findSameSite: failed and cancelled imports count as neither active nor complete', () => {
  const found = ss.findSameSite([
    job({ status: 'failed' }),
    job({ id: 'simp_2', status: 'queued', checkpoints: { cancelRequested: true } }),
  ], 'https://wavecenter.com');
  assert.deepEqual(found, { active: null, complete: null });
});

test('findSameSite: the newest finished import is the one a re-import points at', () => {
  const found = ss.findSameSite([
    job({ id: 'simp_old', finishedAt: '2026-10-01T00:00:00Z' }),
    job({ id: 'simp_new', finishedAt: '2026-11-05T00:51:00Z' }),
  ], 'wavecenter.com');
  assert.equal(found.complete.id, 'simp_new');
  assert.equal(found.active, null);
});

test('duplicateOf: a queued copy of a finished site, unconfirmed, is a duplicate', () => {
  const earlier = job({ id: 'simp_1791865101467_8mi74x' });
  const later = job({ id: 'simp_1793638349324_xq8r45', sourceUrl: 'https://wavecenter.com/', status: 'queued', createdAt: '2026-11-02T12:00:00Z', finishedAt: null });
  assert.equal(ss.duplicateOf(later, [earlier, later]).id, earlier.id);
  assert.equal(
    ss.duplicateFailureMessage(earlier),
    'Not started: duplicate of www.wavecenter.com, imported Nov 4, 2026 (job simp_1791865101467_8mi74x)'
  );
});

test('duplicateOf: a confirmed re-import of a finished site may run', () => {
  const earlier = job({});
  const later = job({ id: 'simp_9', status: 'queued', createdAt: '2026-11-06T00:00:00Z', checkpoints: { reimportOf: 'simp_1' } });
  assert.equal(ss.duplicateOf(later, [earlier, later]), null);
});

test('duplicateOf: even a confirmed re-import waits out a running import of the same site', () => {
  const running = job({ id: 'simp_r', status: 'capturing', createdAt: '2026-11-05T00:00:00Z', finishedAt: null });
  const later = job({ id: 'simp_9', status: 'queued', createdAt: '2026-11-06T00:00:00Z', checkpoints: { reimportOf: 'simp_1' } });
  assert.equal(ss.duplicateOf(later, [running, later]).id, 'simp_r');
});

test('duplicateOf: of two queued copies, the first filed runs and the second does not', () => {
  const first = job({ id: 'simp_a', status: 'queued', createdAt: '2026-11-01T00:00:00Z', finishedAt: null });
  const second = job({ id: 'simp_b', status: 'queued', createdAt: '2026-11-02T00:00:00Z', finishedAt: null });
  assert.equal(ss.duplicateOf(first, [first, second]), null);
  assert.equal(ss.duplicateOf(second, [first, second]).id, 'simp_a');
});

test('duplicateOf: an earlier failed import does not block', () => {
  const earlier = job({ status: 'failed' });
  const later = job({ id: 'simp_9', status: 'queued', createdAt: '2026-11-06T00:00:00Z' });
  assert.equal(ss.duplicateOf(later, [earlier, later]), null);
});
