'use strict';

// scripts/openclaw_smoke.mjs answers "is the Mini's browser signed in to
// YouTube as Dane of Earth?" (ticket 86bcda5wp) and, with --site substack, the
// same question for Substack (ticket 86bcet7r8). Its live run needs the Mini;
// the verdict it draws from the browser's answer is tested here.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'openclaw_smoke.mjs')).href);

test('signed in as Dane of Earth is the only pass, whatever the capitals', async () => {
  const { judge } = await load();
  assert.equal(judge({ signedIn: true, channelName: 'Dane of Earth' }).code, 0);
  assert.equal(judge({ signedIn: true, channelName: ' dane of earth ' }).code, 0);
});

test('signed out, or signed in as somebody else, is a wrong answer (1)', async () => {
  const { judge } = await load();
  assert.equal(judge({ signedIn: false, channelName: null }).code, 1);
  const other = judge({ signedIn: true, channelName: 'Alphire' });
  assert.equal(other.code, 1);
  assert.match(other.message, /"Alphire"/, 'say WHO it is signed in as');
});

test('an answer it cannot read is no reading (2), never a pass', async () => {
  const { judge } = await load();
  for (const answer of [null, undefined, {}, { signedIn: 'yes' }, { signedIn: true }, { signedIn: true, channelName: '' }]) {
    assert.equal(judge(answer).code, 2, JSON.stringify(answer));
  }
});

test('with no site named, the verdict is about YouTube, as it always was', async () => {
  const { judge } = await load();
  assert.match(judge({ signedIn: false, channelName: null }).message, /YouTube/);
  assert.match(judge({ signedIn: true, channelName: 'Dane of Earth' }).message, /YouTube/);
});

test('Substack: signed in as Dane of Earth passes', async () => {
  const { judge } = await load();
  const v = judge({ signedIn: true, accountName: 'Dane of Earth' }, 'substack');
  assert.equal(v.code, 0);
  assert.match(v.message, /Substack as "Dane of Earth"/);
});

test('Substack: signed out is a wrong answer (1), in the words the alarm uses', async () => {
  const { judge } = await load();
  const v = judge({ signedIn: false, accountName: null }, 'substack');
  assert.equal(v.code, 1);
  assert.equal(v.message, 'Substack on the Mini is signed out of Dane of Earth. Sign in again in the dane-of-earth browser.');
});

test('Substack: signed in as somebody else is a wrong answer (1) that names them', async () => {
  const { judge } = await load();
  const v = judge({ signedIn: true, accountName: 'Alphire' }, 'substack');
  assert.equal(v.code, 1);
  assert.match(v.message, /Substack as "Alphire", not "Dane of Earth"/);
});

test('Substack reads accountName — a YouTube-shaped answer is no reading, never a pass', async () => {
  const { judge } = await load();
  assert.equal(judge({ signedIn: true, channelName: 'Dane of Earth' }, 'substack').code, 2);
  assert.equal(judge({ signedIn: true, accountName: '' }, 'substack').code, 2);
  assert.equal(judge(null, 'substack').code, 2);
});

test('an unknown site is no reading (2), never a pass', async () => {
  const { judge } = await load();
  assert.equal(judge({ signedIn: true, accountName: 'Dane of Earth' }, 'medium').code, 2);
});
