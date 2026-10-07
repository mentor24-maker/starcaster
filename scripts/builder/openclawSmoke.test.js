'use strict';

// scripts/openclaw_smoke.mjs answers "is the Mini's browser signed in to
// YouTube as Dane of Earth?" (ticket 86bcda5wp). Its live run needs the Mini;
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
