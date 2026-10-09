'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * YouTube outreach 7/7 (86bcda6dt) — Dane is told by name when the Mini stops
 * posting or YouTube signs it out.
 *
 * What each test pins: the alarm is worded by its FIX (signed out vs signed in
 * as someone else vs OpenClaw not answering), it posts once and then stays
 * quiet for six hours, the next good check clears it with one line, a reading
 * nobody could take neither alarms nor clears, and the reading reaches the
 * settings row the screen and Observe read. OpenClaw, the bus and the ledger
 * file are stand-ins; nothing reaches the network.
 */

const health = require('../../workers/youtube-outreach/health.js');
const poster = require('../../workers/youtube-outreach/poster.js');
const youtube = require('../../workers/youtube-outreach/adapters/youtube.js');
const signIn = require('../../lib/openclawSignIn.js');
const { openclawCardFromCheck, OPENCLAW_READING_STALE_MS } = require('../../routes/observe.js');

const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const SETTINGS_SQL = path.join(SQL_DIR, 'youtube_outreach_setup.sql');
const CHECK_SQL = path.join(SQL_DIR, 'youtube_outreach_browser_check.sql');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/youtubeOutreachStore.js');

const PROJECT = 'proj_doe';
const SCOPE = { projectId: PROJECT, userId: 'user_dane' };
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const T0 = Date.parse('2026-10-08T15:00:00Z');

const SUBSTACK_SIGNED_OUT = 'Substack on the Mini is signed out of Dane of Earth. Sign in again in the dane-of-earth browser.';
const SUBSTACK_SQL = path.join(SQL_DIR, 'substack_notes_setup.sql');
const SUBSTACK_CHECK_SQL = path.join(SQL_DIR, 'substack_notes_browser_check.sql');
const substackStorePath = require.resolve('../../lib/substackNotesStore.js');

const SIGNED_OUT_WORDS = 'YouTube on the Mini is signed out of Dane of Earth — open Screen Sharing to the Mini and sign in again in the dane-of-earth browser.';

// ── A stand-in Mini: a gateway, a browser, a bus and a ledger ───────────────

function standIn() {
  const mini = {
    gatewayUp: true,
    browser: { signedIn: true, channelName: 'Dane of Earth' },
    substack: { signedIn: true, accountName: 'Dane of Earth' },
    askFails: null, // an OpenClaw reply envelope to return instead of an answer
    busDown: false,
    posts: [],
    recorded: [],
    ledger: {},
  };
  mini.deps = {
    node: 'mac-mini',
    probe: async () => (mini.gatewayUp ? { up: true, status: 401 } : { up: false, why: 'nothing is listening at http://127.0.0.1:18789' }),
    // The request names the site it opens, so one stand-in browser can be
    // signed in to YouTube and out of Substack at the same time.
    ask: async (request) => (mini.askFails || {
      ok: true,
      text: JSON.stringify(/substack\.com/.test(request.input) ? mini.substack : mini.browser),
    }),
    extractJson: (raw) => { try { return JSON.parse(raw); } catch { return null; } },
    post: async (body) => {
      if (mini.busDown) throw new Error('ClickUp did not answer');
      mini.posts.push(body);
    },
    readLedger: () => JSON.parse(JSON.stringify(mini.ledger)),
    writeLedger: (ledger) => { mini.ledger = JSON.parse(JSON.stringify(ledger)); },
  };
  mini.checks = [{
    site: 'youtube',
    accountKey: 'dane_of_earth',
    profile: 'dane-of-earth',
    who: 'Dane of Earth',
    record: async (reading) => { mini.recorded.push(reading); return { ok: true, status: 200, data: reading }; },
  }];
  mini.run = (now) => health.runHealthCheck({ checks: mini.checks, deps: mini.deps, now });
  return mini;
}

// ── The alarm rule on its own ───────────────────────────────────────────────

test('an alarm posts once, stays quiet for six hours, then says it again', () => {
  const first = health.decideAlarm({ entry: undefined, state: 'signed_out', now: T0 });
  assert.equal(first.action, 'post');
  const again = health.decideAlarm({ entry: first.entry, state: 'signed_out', now: T0 + 5 * HOUR });
  assert.equal(again.action, 'quiet');
  const later = health.decideAlarm({ entry: first.entry, state: 'signed_out', now: T0 + 6 * HOUR });
  assert.equal(later.action, 'post');
});

test('a new KIND of alarm posts at once, inside the window of the old one', () => {
  const first = health.decideAlarm({ entry: undefined, state: 'signed_out', now: T0 });
  const changed = health.decideAlarm({ entry: first.entry, state: 'wrong_account', now: T0 + HOUR });
  assert.equal(changed.action, 'post');
});

test('a good check clears an open alarm, and says nothing when none was open', () => {
  const open = health.decideAlarm({ entry: undefined, state: 'gateway_down', now: T0 });
  assert.equal(health.decideAlarm({ entry: open.entry, state: 'signed_in', now: T0 + HOUR }).action, 'clear');
  assert.equal(health.decideAlarm({ entry: undefined, state: 'signed_in', now: T0 }).action, 'quiet');
});

test('a reading nobody could take neither alarms nor clears', () => {
  const open = health.decideAlarm({ entry: undefined, state: 'signed_out', now: T0 });
  const blind = health.decideAlarm({ entry: open.entry, state: 'cannot_tell', now: T0 + 7 * HOUR });
  assert.equal(blind.action, 'quiet');
  assert.deepEqual(blind.entry, open.entry, 'the open alarm must survive a blind check');
  assert.equal(health.decideAlarm({ entry: undefined, state: 'cannot_tell', now: T0 }).action, 'quiet');
});

// ── The whole check against the stand-in Mini ──────────────────────────────

test('signed out: exactly one bus message, in words that name the fix', async () => {
  const mini = standIn();
  mini.browser = { signedIn: false, channelName: null };
  const run = await mini.run(T0);
  assert.equal(run.results[0].state, 'signed_out');
  assert.equal(mini.posts.length, 1);
  assert.match(mini.posts[0], /YouTube outreach \(mac-mini\)/);
  assert.ok(mini.posts[0].includes(SIGNED_OUT_WORDS), mini.posts[0]);
  assert.equal(mini.recorded[0].message, SIGNED_OUT_WORDS, 'the screen gets the same sentence');

  await mini.run(T0 + HOUR);
  await mini.run(T0 + 2 * HOUR);
  assert.equal(mini.posts.length, 1, 'still signed out an hour later is NOT a second message');
});

test('signing back in clears both: one all-clear, and the screen reads signed in', async () => {
  const mini = standIn();
  mini.browser = { signedIn: false, channelName: null };
  await mini.run(T0);
  mini.browser = { signedIn: true, channelName: 'Dane of Earth' };
  const run = await mini.run(T0 + HOUR);
  assert.equal(run.results[0].state, 'signed_in');
  assert.equal(mini.posts.length, 2);
  assert.match(mini.posts[1], /cleared: Mini: connected to YouTube as Dane of Earth/);
  assert.equal(mini.recorded.at(-1).state, 'signed_in');
  assert.deepEqual(mini.ledger, {}, 'nothing left open');

  await mini.run(T0 + 2 * HOUR);
  assert.equal(mini.posts.length, 2, 'a healthy hour posts nothing — no "all is well" x365');
});

test('signed in as someone else is its own alarm, naming who', async () => {
  const mini = standIn();
  mini.browser = { signedIn: true, channelName: 'Rich Tennis' };
  const run = await mini.run(T0);
  assert.equal(run.results[0].state, 'wrong_account');
  assert.match(mini.posts[0], /signed in as "Rich Tennis", not Dane of Earth/);
});

test('OpenClaw down is the GATEWAY alarm, not the signed-out one', async () => {
  const mini = standIn();
  mini.gatewayUp = false;
  const run = await mini.run(T0);
  assert.equal(run.results[0].state, 'gateway_down');
  assert.equal(mini.posts.length, 1);
  assert.match(mini.posts[0], /OpenClaw on the Mini is not answering/);
  assert.match(mini.posts[0], /install_openclaw\.sh/);
  assert.doesNotMatch(mini.posts[0], /signed out|sign in again/i);
  assert.deepEqual(Object.keys(mini.ledger), ['gateway']);

  mini.gatewayUp = true;
  await mini.run(T0 + HOUR);
  assert.equal(mini.posts.length, 2);
  assert.match(mini.posts[1], /cleared: OpenClaw on the Mini is answering again/);
});

test('while the gateway is down, an open sign-in alarm is neither repeated nor cleared', async () => {
  const mini = standIn();
  mini.browser = { signedIn: false, channelName: null };
  await mini.run(T0);
  const signedOutEntry = mini.ledger['youtube:dane_of_earth'];
  mini.gatewayUp = false;
  await mini.run(T0 + 7 * HOUR);
  assert.deepEqual(mini.ledger['youtube:dane_of_earth'], signedOutEntry);
  assert.equal(mini.posts.filter((p) => /signed out/.test(p)).length, 1);
});

test('the gateway dropping DURING the check is still the gateway alarm', async () => {
  const mini = standIn();
  mini.askFails = { ok: false, status: 502, error: 'Failed to reach OpenClaw at http://127.0.0.1:18789. Confirm the gateway is running and reachable.' };
  const run = await mini.run(T0);
  assert.equal(run.results[0].state, 'gateway_down');
});

test('an unreadable answer is "could not tell" on the screen, and silent on the bus', async () => {
  const mini = standIn();
  mini.askFails = { ok: false, status: 500, error: 'the model failed' };
  const run = await mini.run(T0);
  assert.equal(run.results[0].state, 'cannot_tell');
  assert.match(mini.recorded[0].message, /could not tell whether YouTube is signed in as Dane of Earth: the model failed/);
  assert.equal(mini.posts.length, 0);
});

test('a bus that is down leaves the alarm unsent, so the next check tries again', async () => {
  const mini = standIn();
  mini.browser = { signedIn: false, channelName: null };
  mini.busDown = true;
  const run = await mini.run(T0);
  assert.equal(mini.posts.length, 0);
  assert.match(run.problems.join('\n'), /could not be posted to the bus/);
  mini.busDown = false;
  await mini.run(T0 + HOUR);
  assert.equal(mini.posts.length, 1);
});

test('the ledger survives on disk between runs', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'yto-ledger-'));
  const file = path.join(dir, 'nested', 'alarms.json');
  assert.deepEqual(health.readLedger(file), {}, 'no file yet is an empty ledger');
  health.writeLedger(file, { gateway: { state: 'gateway_down', postedAt: new Date(T0).toISOString() } });
  assert.equal(health.readLedger(file).gateway.state, 'gateway_down');
});

test('the smoke script and the worker judge with ONE copy', async () => {
  const smoke = await import('../openclaw_smoke.mjs');
  assert.equal(smoke.SITES, signIn.SITES);
  assert.equal(smoke.judge({ signedIn: false }).code, 1);
  assert.equal(signIn.judge({ signedIn: true, channelName: 'Someone' }).kind, 'wrong_account');
});

test('probeGateway: any reply is up, a refused connection is down', async () => {
  const up = await signIn.probeGateway('http://127.0.0.1:18789', { fetchImpl: async () => ({ status: 401 }) });
  assert.equal(up.up, true);
  const refused = Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  const down = await signIn.probeGateway('http://127.0.0.1:18789', { fetchImpl: async () => { throw refused; } });
  assert.equal(down.up, false);
  assert.match(down.why, /nothing is listening/);
});

// ── The loop runs it hourly ─────────────────────────────────────────────────

test('the worker checks on its first pass and then once an hour', async () => {
  let now = T0;
  const calls = [];
  await poster.runPoster({
    adapters: [],
    stopAfterPasses: 4,
    clock: () => now,
    sleep: async () => { now += 30 * MINUTE; },
    write: () => {},
    recordBeat: () => {},
    checkHealth: async () => { calls.push(now); return ''; },
  });
  assert.deepEqual(calls, [T0, T0 + HOUR]);
});

test('a check that throws does not stop posting', async () => {
  const lines = [];
  const out = await poster.runPoster({
    adapters: [],
    stopAfterPasses: 2,
    clock: () => T0,
    sleep: async () => {},
    write: (l) => lines.push(l),
    recordBeat: () => {},
    checkHealth: async () => { throw new Error('boom'); },
  });
  assert.equal(out.passes, 2);
  assert.match(lines.join('\n'), /the sign-in check could not run: boom — posting continues/);
});

// ── The reading reaches the settings row the screen reads ──────────────────

function withDb() {
  const schema = `${fs.readFileSync(SETTINGS_SQL, 'utf8')}\n${fs.readFileSync(CHECK_SQL, 'utf8')}`;
  const db = createFakeDb(parseSchemaText(schema));
  const fake = {
    isConfigured: () => true,
    tableConfig: () => ({
      youtubeOutreachTargets: 'youtube_outreach_targets',
      youtubeOutreachSettings: 'youtube_outreach_settings',
      youtubeOutreachComments: 'youtube_outreach_comments',
    }),
    sbQuery: db.sbQuery,
  };
  const real = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fake };
  for (const p of [projectScopePath, storePath]) delete require.cache[p];
  const store = require(storePath);
  return {
    store,
    restore() {
      if (real) require.cache[supabasePath] = real;
      else delete require.cache[supabasePath];
      for (const p of [projectScopePath, storePath]) delete require.cache[p];
    },
  };
}

test('a reading is saved on the settings row, and the screen\'s Save leaves it alone', async () => {
  const { store, restore } = withDb();
  try {
    const before = await store.getSettings(SCOPE);
    assert.equal(before.data.browserCheck.state, '', 'never checked reads as blank, not as fine');

    const at1 = new Date(T0).toISOString();
    const first = await store.recordBrowserCheck({ state: 'signed_in', message: 'Mini: connected to YouTube as Dane of Earth.', checkedAt: at1 }, SCOPE);
    assert.equal(first.ok, true, first.error);
    const created = await store.getSettings(SCOPE);
    assert.equal(created.data.saved, true, 'the first reading creates the row with the default limits');
    assert.equal(created.data.maxCommentsPerDay, 10);
    assert.equal(created.data.browserCheck.state, 'signed_in');

    const at2 = new Date(T0 + HOUR).toISOString();
    const second = await store.recordBrowserCheck({ state: 'signed_out', message: SIGNED_OUT_WORDS, checkedAt: at2 }, SCOPE);
    assert.equal(second.ok, true, second.error);
    let read = (await store.getSettings(SCOPE)).data.browserCheck;
    assert.equal(read.state, 'signed_out');
    assert.equal(read.message, SIGNED_OUT_WORDS);
    assert.equal(Date.parse(read.checkedAt), T0 + HOUR);
    assert.equal(Date.parse(read.signedInAt), T0, 'a bad check leaves the last good time standing');

    const saved = await store.saveSettings({ maxCommentsPerDay: 3 }, SCOPE);
    assert.equal(saved.ok, true, saved.error);
    read = (await store.getSettings(SCOPE)).data.browserCheck;
    assert.equal(read.state, 'signed_out', 'saving the limits must not clear the Mini\'s reading');

    const bad = await store.recordBrowserCheck({ state: 'fine', checkedAt: at2 }, SCOPE);
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 400);
  } finally {
    restore();
  }
});

test('the YouTube adapter offers one check per account, writing that account\'s row', async () => {
  const written = [];
  const adapter = youtube.createYoutubeAdapter({
    projectId: PROJECT,
    store: {},
    targets: { recordBrowserCheck: async (reading, scope, opts) => { written.push({ reading, scope, opts }); return { ok: true }; } },
  });
  const checks = adapter.browserChecks();
  assert.deepEqual(checks.map((c) => [c.site, c.accountKey, c.profile, c.who]), [['youtube', 'dane_of_earth', 'dane-of-earth', 'Dane of Earth']]);
  await checks[0].record({ state: 'signed_in', message: 'x', checkedAt: new Date(T0).toISOString() });
  assert.deepEqual(written[0].opts, { accountKey: 'dane_of_earth' });
  assert.equal(written[0].scope.projectId, PROJECT);
});

// ── Observe's OpenClaw card reports the Mini's reading, not a dead ping ─────

test('Observe: never checked, fresh, bad and stale readings each say so', () => {
  const never = openclawCardFromCheck({ state: '', message: '', checkedAt: null }, T0);
  assert.equal(never.status, 'error');
  assert.match(never.message, /never checked/);

  const fresh = openclawCardFromCheck({ state: 'signed_in', message: 'Mini: connected to YouTube as Dane of Earth.', checkedAt: new Date(T0 - 10 * MINUTE).toISOString() }, T0);
  assert.equal(fresh.status, 'healthy');

  const out = openclawCardFromCheck({ state: 'signed_out', message: SIGNED_OUT_WORDS, checkedAt: new Date(T0 - 10 * MINUTE).toISOString() }, T0);
  assert.equal(out.status, 'error');
  assert.ok(out.message.startsWith(SIGNED_OUT_WORDS));

  const stale = openclawCardFromCheck({ state: 'signed_in', message: 'ok', checkedAt: new Date(T0 - OPENCLAW_READING_STALE_MS - MINUTE).toISOString() }, T0);
  assert.equal(stale.status, 'error', 'a good reading nobody has refreshed is not "healthy"');
  assert.match(stale.message, /has not reported since/);
});

// ── Substack, checked hourly beside YouTube (review round 1) ────────────────
//
// Substack Notes 6/7 adds the Substack posting adapter and defers its sign-in
// alarm to this ticket, so the check must not wait for an adapter: it comes
// from poster.js SIGN_IN_CHECKS.

function withSubstack(mini) {
  mini.substackRecorded = [];
  mini.checks.push({
    site: 'substack',
    accountKey: 'dane_of_earth',
    profile: 'dane-of-earth',
    who: 'Dane of Earth',
    record: async (reading) => { mini.substackRecorded.push(reading); return { ok: true, status: 200, data: reading }; },
  });
  return mini;
}

test('Substack signed out: one bus message in the Notes ticket\'s own words, under its own key', async () => {
  const mini = withSubstack(standIn());
  mini.substack = { signedIn: false, accountName: null };
  const run = await mini.run(T0);
  assert.deepEqual(run.results.map((r) => [r.site, r.state]), [['youtube', 'signed_in'], ['substack', 'signed_out']]);
  assert.equal(mini.posts.length, 1, 'YouTube is fine, so only Substack speaks');
  assert.match(mini.posts[0], /^⚠️ \*\*Substack Notes \(mac-mini\)\*\*/, 'a Substack alarm must not read as YouTube outreach');
  assert.ok(mini.posts[0].includes(SUBSTACK_SIGNED_OUT), mini.posts[0]);
  assert.equal(mini.substackRecorded[0].message, SUBSTACK_SIGNED_OUT, 'the screen gets the same sentence');
  assert.equal(mini.substackRecorded[0].state, 'signed_out');
  assert.deepEqual(Object.keys(mini.ledger), ['substack:dane_of_earth']);

  await mini.run(T0 + HOUR);
  await mini.run(T0 + 5 * HOUR);
  assert.equal(mini.posts.length, 1, 'still signed out within six hours is NOT a second message');
  await mini.run(T0 + 6 * HOUR);
  assert.equal(mini.posts.length, 2, 'six hours on, it is said again');
});

test('Substack signing back in clears its alarm with one line, and leaves YouTube\'s alone', async () => {
  const mini = withSubstack(standIn());
  mini.substack = { signedIn: false, accountName: null };
  mini.browser = { signedIn: false, channelName: null };
  await mini.run(T0);
  assert.equal(mini.posts.length, 2, 'two sites signed out are two alarms, each naming its own fix');
  mini.substack = { signedIn: true, accountName: 'Dane of Earth' };
  const run = await mini.run(T0 + HOUR);
  assert.equal(run.results[1].state, 'signed_in');
  assert.equal(mini.posts.length, 3);
  assert.match(mini.posts[2], /^✅ \*\*Substack Notes \(mac-mini\)\*\* — cleared: Mini: signed in to Substack as Dane of Earth\./);
  assert.deepEqual(Object.keys(mini.ledger), ['youtube:dane_of_earth'], 'YouTube\'s alarm is still open');
});

test('Substack signed in as someone else names who, and is its own alarm', async () => {
  const mini = withSubstack(standIn());
  mini.substack = { signedIn: true, accountName: 'Somebody Else' };
  const run = await mini.run(T0);
  assert.equal(run.results[1].state, 'wrong_account');
  assert.equal(mini.posts.length, 1);
  assert.match(mini.posts[0], /Substack on the Mini is signed in as "Somebody Else", not Dane of Earth/);
});

test('OpenClaw down is ONE gateway alarm, not one per site, and no sign-in alarm', async () => {
  const mini = withSubstack(standIn());
  mini.gatewayUp = false;
  const run = await mini.run(T0);
  assert.deepEqual(run.results.map((r) => r.state), ['gateway_down', 'gateway_down']);
  assert.equal(mini.posts.length, 1);
  assert.match(mini.posts[0], /^⚠️ \*\*Posting browser \(mac-mini\)\*\* — OpenClaw on the Mini is not answering/);
  assert.deepEqual(Object.keys(mini.ledger), ['gateway']);
});

test('the worker runs the Substack check with no Substack adapter, and an adapter\'s own entry replaces it', () => {
  const built = poster.buildSignInChecks({ YOUTUBE_OUTREACH_PROJECT_ID: PROJECT });
  assert.deepEqual(built.problems, []);
  assert.deepEqual(built.checks.map((c) => [c.site, c.accountKey, c.profile, c.who]), [['substack', 'dane_of_earth', 'dane-of-earth', 'Dane of Earth']]);

  const yt = { browserChecks: () => [{ site: 'youtube', accountKey: 'dane_of_earth' }] };
  assert.deepEqual(poster.browserChecksFor([yt], built.checks).map((c) => c.site), ['youtube', 'substack'],
    'with only the YouTube adapter, Substack is still checked');

  const own = { site: 'substack', accountKey: 'dane_of_earth', mine: true };
  const sub = { browserChecks: () => [own] };
  const merged = poster.browserChecksFor([yt, sub], built.checks);
  assert.equal(merged.filter((c) => c.site === 'substack').length, 1, 'the browser is never asked twice');
  assert.equal(merged.find((c) => c.site === 'substack').mine, true, 'the adapter\'s entry wins');

  const none = poster.buildSignInChecks({});
  assert.equal(none.checks.length, 0);
  assert.match(none.problems[0], /^substack: no project to save the Substack reading on/);
  const own2 = poster.buildSignInChecks({ YOUTUBE_OUTREACH_PROJECT_ID: 'a', SUBSTACK_NOTES_PROJECT_ID: 'b' });
  assert.equal(own2.problems.length, 0);
});

function withSubstackDb() {
  const schema = `${fs.readFileSync(SUBSTACK_SQL, 'utf8')}\n${fs.readFileSync(SUBSTACK_CHECK_SQL, 'utf8')}`;
  const db = createFakeDb(parseSchemaText(schema));
  const fake = {
    isConfigured: () => true,
    tableConfig: () => ({
      substackNotesItems: 'substack_notes_items',
      substackNotesSettings: 'substack_notes_settings',
    }),
    sbQuery: db.sbQuery,
  };
  const real = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fake };
  for (const p of [projectScopePath, substackStorePath]) delete require.cache[p];
  const store = require(substackStorePath);
  return {
    store,
    restore() {
      if (real) require.cache[supabasePath] = real;
      else delete require.cache[supabasePath];
      for (const p of [projectScopePath, substackStorePath]) delete require.cache[p];
    },
  };
}

test('the Substack reading is saved on the Substack Notes settings row, and its Save leaves it alone', async () => {
  const { store, restore } = withSubstackDb();
  try {
    const before = await store.getSettings(SCOPE);
    assert.equal(before.data.browserCheck.state, '', 'never checked reads as blank, not as fine');

    const at1 = new Date(T0).toISOString();
    const first = await store.recordBrowserCheck({ state: 'signed_in', message: 'Mini: signed in to Substack as Dane of Earth.', checkedAt: at1 }, SCOPE);
    assert.equal(first.ok, true, first.error);
    const created = await store.getSettings(SCOPE);
    assert.equal(created.data.saved, true, 'the first reading creates the row with the default settings');
    assert.equal(created.data.maxActionsPerDay, 3);
    assert.deepEqual(created.data.topics, []);
    assert.equal(created.data.browserCheck.state, 'signed_in');
    assert.equal(Date.parse(created.data.browserCheck.checkedAt), T0);

    const at2 = new Date(T0 + HOUR).toISOString();
    const second = await store.recordBrowserCheck({ state: 'signed_out', message: SUBSTACK_SIGNED_OUT, checkedAt: at2 }, SCOPE);
    assert.equal(second.ok, true, second.error);
    let read = (await store.getSettings(SCOPE)).data.browserCheck;
    assert.equal(read.state, 'signed_out');
    assert.equal(read.message, SUBSTACK_SIGNED_OUT);
    assert.equal(Date.parse(read.signedInAt), T0, 'a bad check leaves the last good time standing');

    const saved = await store.saveSettings({ maxActionsPerDay: 2 }, SCOPE);
    assert.equal(saved.ok, true, saved.error);
    read = (await store.getSettings(SCOPE)).data.browserCheck;
    assert.equal(read.state, 'signed_out', 'saving the settings must not clear the Mini\'s reading');

    const sneaky = await store.saveSettings({ browserState: 'signed_in' }, SCOPE);
    assert.equal(sneaky.ok, false, 'the screen\'s Save cannot fake a reading');

    const bad = await store.recordBrowserCheck({ state: 'fine', checkedAt: at2 }, SCOPE);
    assert.equal(bad.status, 400);
    const undated = await store.recordBrowserCheck({ state: 'signed_in' }, SCOPE);
    assert.equal(undated.status, 400);
    const unscoped = await store.recordBrowserCheck({ state: 'signed_in', checkedAt: at2 }, null);
    assert.equal(unscoped.ok, false);
  } finally {
    restore();
  }
});

test('the Substack sign-in SQL only adds columns, and can run twice', () => {
  const sql = fs.readFileSync(SUBSTACK_CHECK_SQL, 'utf8').replace(/--.*$/gm, '');
  const statements = sql.split(';').map((x) => x.trim()).filter(Boolean);
  assert.equal(statements.length, 4);
  for (const st of statements) assert.match(st, /^alter table public\.substack_notes_settings add column if not exists browser_/);
});
