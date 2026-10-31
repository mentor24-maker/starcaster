'use strict';

// lib/aiKeys.js — which account each AI key bills and whether it works
// (ticket 86bcvhfht). Every reading here is a real provider reply shape; the
// two credit messages are the exact words measured on 2026-10-30.

const test = require('node:test');
const assert = require('node:assert/strict');
const aiKeys = require('../../lib/aiKeys.js');

const { VERDICT } = aiKeys;
const ORG = '33d0ab74-d6bd-4d7d-a525-029a6e4217d1';
const OTHER_ORG = '11111111-2222-3333-4444-555555555555';

const ANTHROPIC_DRY = {
  status: 400,
  account: ORG,
  body: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } },
};
const OPENAI_DRY = {
  status: 429,
  body: { error: { message: 'You have no credits remaining. Add credits to continue using the API.', type: 'insufficient_quota', code: 'insufficient_quota' } },
};

test('classify: the two out-of-credit replies measured on 2026-10-30 read OUT OF CREDIT, with the account', () => {
  const a = aiKeys.classify('anthropic', ANTHROPIC_DRY);
  assert.equal(a.verdict, VERDICT.OUT_OF_CREDIT);
  assert.equal(a.account, ORG);
  assert.equal(aiKeys.classify('openai', OPENAI_DRY).verdict, VERDICT.OUT_OF_CREDIT);
});

test('classify: a refused key is INVALID, a plain rate limit still WORKS, an outage is CANNOT TELL', () => {
  assert.equal(aiKeys.classify('anthropic', { status: 401, body: { error: { type: 'authentication_error', message: 'invalid x-api-key' } } }).verdict, VERDICT.INVALID);
  assert.equal(aiKeys.classify('gemini', { status: 400, body: { error: { message: 'API key not valid.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } } }).verdict, VERDICT.INVALID);
  assert.equal(aiKeys.classify('openai', { status: 429, body: { error: { code: 'rate_limit_exceeded', message: 'Rate limit reached' } } }).verdict, VERDICT.WORKS);
  assert.equal(aiKeys.classify('anthropic', { status: 529, body: { error: { type: 'overloaded_error', message: 'Overloaded' } } }).verdict, VERDICT.CANNOT_TELL);
  assert.equal(aiKeys.classify('anthropic', { error: 'no answer within 20s' }).verdict, VERDICT.CANNOT_TELL);
  assert.equal(aiKeys.classify('anthropic', { status: 200, body: {}, account: ORG }).verdict, VERDICT.WORKS);
});

test('fingerprint: tells keys apart, never contains the key', () => {
  const key = 'sk-ant-api03-SECRETSECRETSECRET';
  const fp = aiKeys.fingerprint(key);
  assert.match(fp, /^[0-9a-f]{8}$/);
  assert.ok(!key.includes(fp));
  assert.notEqual(fp, aiKeys.fingerprint(`${key}x`));
  assert.equal(aiKeys.fingerprint(''), '');
});

test('probeKey: reads the account off the anthropic-organization-id header and meters a served probe', async () => {
  const metered = [];
  const fetchImpl = async (url, init) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(JSON.parse(init.body).max_tokens, 1);
    return new Response(JSON.stringify({ usage: { input_tokens: 8, output_tokens: 1 } }), {
      status: 200, headers: { 'anthropic-organization-id': ORG },
    });
  };
  const probe = await aiKeys.probeKey('anthropic', 'k', { fetchImpl, recordUsage: async (u) => { metered.push(u); } });
  assert.equal(probe.account, ORG);
  assert.equal(metered.length, 1);
  assert.equal(metered[0].feature, 'ai-keys-check');
});

test('checkKeys: swapping in a key from a different org shows in the account column', async () => {
  const accountByKey = { 'key-a': ORG, 'key-b': OTHER_ORG };
  const probe = async (_p, key) => ({ status: 200, body: {}, account: accountByKey[key] });
  const before = await aiKeys.checkKeys([{ id: 'website-anthropic', provider: 'anthropic', place: 'w', job: 'j', key: 'key-a' }], { probe });
  const after = await aiKeys.checkKeys([{ id: 'website-anthropic', provider: 'anthropic', place: 'w', job: 'j', key: 'key-b' }], { probe });
  assert.equal(before[0].account, ORG);
  assert.equal(after[0].account, OTHER_ORG);
  assert.notEqual(before[0].fingerprint, after[0].fingerprint);
});

test('checkKeys: the same key in two places is probed once; unreadable is CANNOT TELL; empty is NOT SET', async () => {
  let calls = 0;
  const probe = async () => { calls += 1; return ANTHROPIC_DRY; };
  const rows = await aiKeys.checkKeys([
    { id: 'website-anthropic', provider: 'anthropic', place: 'w', job: 'j', key: 'same' },
    { id: 'openclaw-anthropic', provider: 'anthropic', place: 'm', job: 'j', key: 'same' },
    { id: 'website-openai', provider: 'openai', place: 'w', job: 'j', unreadable: 'no prd access' },
    { id: 'website-gemini', provider: 'gemini', place: 'w', job: 'j', key: '' },
  ], { probe });
  assert.equal(calls, 1);
  assert.deepEqual(rows.map((r) => r.verdict), [VERDICT.OUT_OF_CREDIT, VERDICT.OUT_OF_CREDIT, VERDICT.CANNOT_TELL, VERDICT.NOT_SET]);
  assert.equal(rows[0].account, ORG);
  assert.equal(rows[1].account, ORG);
  // A key that is down outranks a reading that could not be taken.
  assert.equal(aiKeys.exitCode(rows), 1);
  assert.equal(aiKeys.exitCode(rows.slice(2)), 2);
  assert.equal(aiKeys.exitCode(rows.slice(3)), 0);
});

test('compareKeys: a different copy on the Mini is a MISMATCH unless it is listed as deliberate', () => {
  const rows = [
    { id: 'website-anthropic', place: 'the website', fingerprint: 'aaaaaaaa', account: ORG },
    { id: 'openclaw-anthropic', place: 'the Mini', fingerprint: 'bbbbbbbb', account: OTHER_ORG },
  ];
  const [mismatch] = aiKeys.compareKeys(rows);
  assert.equal(mismatch.same, false);
  assert.equal(mismatch.deliberate, false);
  assert.match(mismatch.text, /MISMATCH/);
  assert.match(mismatch.text, /DIFFERENT accounts/);

  const [split] = aiKeys.compareKeys(rows, { separate: new Set(['openclaw-anthropic']) });
  assert.equal(split.deliberate, true);
  assert.doesNotMatch(split.text, /MISMATCH/);

  const [same] = aiKeys.compareKeys([rows[0], { ...rows[1], fingerprint: 'aaaaaaaa' }]);
  assert.equal(same.same, true);
});

test('planAlarms: a dry account posts once, stays quiet for 6h, re-posts after, and clears once when it works', () => {
  const T0 = Date.parse('2026-10-30T12:00:00Z');
  const dry = [{ id: 'website-anthropic', verdict: VERDICT.OUT_OF_CREDIT }];
  const first = aiKeys.planAlarms({ rows: dry, state: {}, now: T0 });
  assert.equal(first.post.length, 1);

  const tenMinLater = aiKeys.planAlarms({ rows: dry, state: first.next, now: T0 + 10 * 60000 });
  assert.equal(tenMinLater.post.length, 0, 'the next relay wake must not post it again');

  const sixHoursLater = aiKeys.planAlarms({ rows: dry, state: first.next, now: T0 + 6 * 3600000 });
  assert.equal(sixHoursLater.post.length, 1);

  const blip = aiKeys.planAlarms({ rows: [{ id: 'website-anthropic', verdict: VERDICT.CANNOT_TELL }], state: first.next, now: T0 + 3600000 });
  assert.equal(blip.clear.length, 0, 'a network blip is not a recovery');
  assert.ok(blip.next['website-anthropic']);

  const fixed = aiKeys.planAlarms({ rows: [{ id: 'website-anthropic', verdict: VERDICT.WORKS }], state: first.next, now: T0 + 3600000 });
  assert.equal(fixed.clear.length, 1);
  assert.deepEqual(fixed.next, {});

  const healthy = aiKeys.planAlarms({ rows: [{ id: 'website-anthropic', verdict: VERDICT.WORKS }], state: {}, now: T0 });
  assert.equal(healthy.clear.length + healthy.post.length, 0, 'a key that never went down is never news');

  const worse = aiKeys.planAlarms({ rows: [{ id: 'website-anthropic', verdict: VERDICT.INVALID }], state: first.next, now: T0 + 60000 });
  assert.equal(worse.post.length, 1, 'going down in a different way is news at once');
});

test('planAlarms: a blind check stays quiet for a blip, posts once after an hour, re-posts after 6h, and clears on a reading', () => {
  const T0 = Date.parse('2026-10-30T12:00:00Z');
  const MIN = 60000;
  const blindRow = [{ id: 'website-anthropic', verdict: VERDICT.CANNOT_TELL, reason: 'Doppler prd could not be read' }];

  const first = aiKeys.planAlarms({ rows: blindRow, state: {}, now: T0 });
  assert.equal(first.blind.length + first.post.length, 0, 'one CANNOT TELL is a blip, not news');
  assert.equal(first.next['blind:website-anthropic'].since, new Date(T0).toISOString(), 'the first blind wake must be recorded');

  const recovered = aiKeys.planAlarms({ rows: [{ id: 'website-anthropic', verdict: VERDICT.WORKS }], state: first.next, now: T0 + 10 * MIN });
  assert.equal(recovered.sighted.length, 0, 'a blip that was never announced gets no all-clear');
  assert.deepEqual(recovered.next, {});

  const fiftyMin = aiKeys.planAlarms({ rows: blindRow, state: first.next, now: T0 + 50 * MIN });
  assert.equal(fiftyMin.blind.length, 0);

  const anHour = aiKeys.planAlarms({ rows: blindRow, state: fiftyMin.next, now: T0 + 60 * MIN });
  assert.equal(anHour.blind.length, 1, 'blind for an hour must reach the bus');
  assert.match(aiKeys.renderMessage({ ...anHour, node: 'mac-mini', at: 'now' }), /check is blind[\s\S]*Doppler prd could not be read/);

  const nextWake = aiKeys.planAlarms({ rows: blindRow, state: anHour.next, now: T0 + 70 * MIN });
  assert.equal(nextWake.blind.length, 0, 'once per 6h, not every wake');

  const sixLater = aiKeys.planAlarms({ rows: blindRow, state: nextWake.next, now: T0 + 60 * MIN + 6 * 3600000 });
  assert.equal(sixLater.blind.length, 1, 'still blind 6h later says so again');

  const reading = aiKeys.planAlarms({ rows: [{ id: 'website-anthropic', verdict: VERDICT.OUT_OF_CREDIT }], state: sixLater.next, now: T0 + 8 * 3600000 });
  assert.equal(reading.sighted.length, 1, 'a real reading clears the blind alarm');
  assert.equal(reading.post.length, 1, 'and is judged on its own');
  assert.equal(reading.next['blind:website-anthropic'], undefined);
});

test('renderMessage: names the account to top up and never a key value', () => {
  const row = {
    id: 'website-anthropic', provider: 'anthropic', place: 'the website (Doppler prd)', job: 'Write with AI',
    fingerprint: 'abcd1234', verdict: VERDICT.OUT_OF_CREDIT, reason: 'anthropic answered 400', account: ORG,
  };
  const text = aiKeys.renderMessage({ post: [row], node: 'mac-mini', at: '2026-10-30T12:00:00Z' });
  assert.match(text, /org 33d0ab74…/);
  assert.match(text, /THE ACCOUNT NAMED ABOVE/);
  assert.match(text, /console\.anthropic\.com/);
  assert.doesNotMatch(text, /sk-/);
});

test('describeAccount: shows a name once one is recorded, the id either way', () => {
  assert.equal(aiKeys.describeAccount(ORG, { [ORG]: 'Alphire' }), 'Alphire (org 33d0ab74…)');
  assert.equal(aiKeys.describeAccount(ORG, {}), 'org 33d0ab74… (not named yet)');
});
