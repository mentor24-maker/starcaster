'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Schedule harvest (task 86bbztj0e). The AI door's network, keys and provider
 * order are faked (SC-896), so no test spends money; what is tested is everything around it —
 * the refusals before paying, the handling of what comes back, and the
 * lines-to-series merge that decides how many events a flyer becomes.
 */

const harvest = require('../../lib/eventHarvest');
const {
  HarvestError, readUpload, normalizeExtraction, mergeSessions, matchExisting, matchVenues, extractSchedule, setDoorDeps,
} = harvest;

const PNG = { mimeType: 'image/png', fileBase64: Buffer.from('fake image').toString('base64') };

// A slice of Delray's Weekly Program Guide, transcribed one line per day.
const LINES = [
  { day: 'Mon', date: '2026-08-31', title: 'Drills & Games I', instructor: 'Wayne L', startTime: '08:30', endTime: '10:00', venue: 'Delray Beach Tennis Center' },
  { day: 'Mon', date: '2026-08-31', title: 'Intro to WWO', instructor: 'Vincent W', startTime: '08:30', endTime: '10:00', venue: 'Delray Beach Tennis Center' },
  { day: 'Tue', date: '2026-09-01', title: 'Drills & Games I', instructor: 'Wayne L', startTime: '08:30', endTime: '10:00', venue: 'Delray Beach Tennis Center' },
  { day: 'Tue', date: '2026-09-01', title: 'Intro to WWO', instructor: 'Danny Z/Mark W', startTime: '09:00', endTime: '10:00', venue: 'Delray Beach Tennis Center' },
  { day: 'Wed', date: '2026-09-02', title: 'drills & games i', instructor: 'Wayne L', startTime: '08:30', endTime: '10:00', venue: 'Delray Beach Tennis Center' },
  { day: 'Mon', date: '2026-08-31', title: 'PB 101', instructor: 'Mike C', startTime: '08:00', endTime: '09:00', venue: 'Pickleball' },
  { day: 'Sun', date: '2026-09-06', title: 'Elite', instructor: 'Bob D', startTime: '15:00', endTime: '18:00', venue: 'Delray Swim & Tennis Club' },
];

test('an upload is refused before any money is spent when it cannot be read', () => {
  assert.throws(() => readUpload({}), HarvestError);
  assert.throws(() => readUpload({ mimeType: 'text/plain', fileBase64: 'aGVsbG8=' }), /cannot be read/);
  assert.throws(() => readUpload({ mimeType: 'application/pdf', fileBase64: 'A'.repeat(9_000_001) }), /too large/);
  assert.throws(() => readUpload({ mimeType: 'image/png', fileBase64: 'not base64!!' }), /readable file/);
  assert.equal(readUpload({ mimeType: 'application/pdf', fileBase64: 'data:application/pdf;base64,JVBERi0=' }).data, 'JVBERi0=');
});

test('what the model returns is checked, not trusted', () => {
  const out = normalizeExtraction({
    weekStart: '2026-08-31',
    venues: [{ name: 'Pickleball', color: '#F7A600' }, { name: 'pickleball', color: '#000000' }, { name: 'Club', color: 'orange' }],
    sessions: [
      ...LINES,
      { day: 'Funday', title: 'X', startTime: '08:00' },
      { day: 'Mon', title: '', startTime: '08:00' },
      { day: 'Mon', title: 'Bad time', startTime: '8am' },
      { day: 'Mon', title: 'Backwards', instructor: '', startTime: '10:00', endTime: '09:00', venue: '' },
    ],
  });
  assert.equal(out.weekStart, '2026-08-31');
  assert.deepEqual(out.venues, [{ name: 'Pickleball', color: '#f7a600' }, { name: 'Club', color: '' }]);
  assert.equal(out.sessions.length, LINES.length + 1);
  assert.equal(out.dropped, 3, 'the three unusable lines are counted, so the reviewer can be told');
  assert.equal(out.sessions.at(-1).endTime, '', 'an end before its start is blanked rather than saved backwards');
});

test('lines become one weekly series per program, instructor and time', () => {
  const series = mergeSessions(normalizeExtraction({ sessions: LINES }).sessions);
  const drills = series.find((s) => s.title === 'Drills & Games I');
  assert.deepEqual(drills.weekdays, [1, 2, 3], 'Mon/Tue/Wed of the same program merge, case-insensitively');
  assert.deepEqual(drills.dates, ['2026-08-31', '2026-09-01', '2026-09-02']);
  const wwo = series.filter((s) => s.title === 'Intro to WWO');
  assert.equal(wwo.length, 2, 'a different coach and time is a different program, not one to merge');
  assert.equal(series.length, 5);
  assert.deepEqual(series.map((s) => s.title), ['PB 101', 'Drills & Games I', 'Intro to WWO', 'Intro to WWO', 'Elite'],
    'ordered Monday-first and by time, the way the flyer reads — Sunday last');
});

test('a program already on the calendar is recognised, not proposed twice', () => {
  const series = mergeSessions(normalizeExtraction({ sessions: LINES }).sessions);
  const events = [
    { id: 'evt_1', title: 'Drills & Games I', timezone: 'America/New_York', startsAt: '2026-09-14T12:30:00.000Z', recurrence: { weekdays: [1, 2, 3, 4, 5, 6] } },
    { id: 'evt_2', title: 'PB 101', timezone: 'America/New_York', startsAt: '2026-09-14T11:30:00.000Z', recurrence: { weekdays: [1] } }, // 7:30, not 8:00
    { id: 'evt_3', title: 'Elite', timezone: 'America/New_York', startsAt: '2026-09-15T19:00:00.000Z', recurrence: null }, // one-off
  ];
  const matched = matchExisting(series, events);
  assert.equal(matched.find((s) => s.title === 'Drills & Games I').existingEventId, 'evt_1');
  assert.equal(matched.find((s) => s.title === 'PB 101').existingEventId, '', 'a different start time is a different program');
  assert.equal(matched.find((s) => s.title === 'Elite').existingEventId, '');
});

test('flyer venues take the project spelling, and a shouted new venue is tidied', () => {
  const { venues, series } = matchVenues(
    [{ name: 'PICKLEBALL', color: '#f7a600' }, { name: 'DELRAY SWIM & TENNIS CLUB', color: '#72b62f' }, { name: 'DBTC', color: '' }],
    [{ id: 'ecat_1', name: 'Pickleball' }],
    [{ title: 'PB 101', venue: 'PICKLEBALL' }, { title: 'Elite', venue: 'DELRAY SWIM & TENNIS CLUB' }],
  );
  assert.deepEqual(venues.map((v) => [v.name, v.categoryId]), [['Pickleball', 'ecat_1'], ['Delray Swim & Tennis Club', ''], ['DBTC', '']]);
  assert.deepEqual(series.map((s) => s.venue), ['Pickleball', 'Delray Swim & Tennis Club'], 'series follow their venue name');
});

test("the flyer's times default to the zone the club's events already use — never a guess", () => {
  const { suggestTimeZone } = harvest;
  assert.equal(suggestTimeZone([{ timezone: 'America/Denver' }, { timezone: 'America/New_York' }, { timezone: 'America/New_York' }, { timezone: 'UTC' }, { timezone: 'UTC' }, { timezone: 'UTC' }]), 'America/New_York');
  assert.equal(suggestTimeZone([{ timezone: 'UTC' }, { timezone: 'Nowhere/Real' }, {}]), '', 'no usable zone means the reviewer must enter one');
});

const { AI_PROVIDERS } = require('../../lib/aiClient');

/**
 * A faked AI door: `order` is the provider order, `keys` which providers have
 * one, `answer(def, body)` what each provider sends back. Every request sent is
 * kept, so a test can read exactly what went where.
 */
function fakeDoor({ order = ['openai'], keys = order, answer, signals = [] }) {
  const sent = [];
  const usage = [];
  setDoorDeps({
    order: async () => ({ providers: order.map((id) => AI_PROVIDERS[id]), ignored: [], group: null, orderUsed: 'main' }),
    getKey: (def) => (keys.includes(def.id) ? `key-${def.id}` : ''),
    recordUsage: async (row) => { usage.push(row); },
    postBus: async () => true,
    // No shared notice row in a test: this door limits the notice by its own memory (SC-925).
    noticeStore: null,
    now: () => Date.now(),
    fetchImpl: async (url, init) => {
      signals.push(init.signal);
      const body = JSON.parse(init.body);
      const def = Object.values(AI_PROVIDERS).find((d) => url.startsWith(d.baseUrl || 'https://api.anthropic.com') || (d.kind === 'gemini' && url.includes('generativelanguage')));
      sent.push({ url, provider: def.id, body });
      const { status = 200, json, error } = answer(def, body);
      if (error) throw error;
      return { ok: status < 400, status, text: async () => JSON.stringify(json) };
    },
  });
  return { sent, usage };
}

const openaiSays = (text, finish = 'stop') => ({ json: { model: 'gpt-5.5', choices: [{ message: { content: text }, finish_reason: finish }], usage: { prompt_tokens: 1200, completion_tokens: 900 } } });
const TRANSCRIPT = JSON.stringify({ weekStart: '2026-08-31', venues: [], sessions: LINES });

test('the model call goes through the AI door: a transcription comes back parsed and its spend is metered', async (t) => {
  t.after(() => setDoorDeps(null));
  const { sent, usage } = fakeDoor({ order: ['openai'], answer: () => openaiSays(TRANSCRIPT) });
  const out = await extractSchedule(PNG, { projectId: 'p' });
  assert.equal(out.sessions.length, LINES.length);
  assert.equal(sent.length, 1);
  const content = sent[0].body.messages.at(-1).content;
  assert.equal(content[0].type, 'image_url', 'the flyer picture travels with the request');
  assert.equal(content[0].image_url.url, `data:image/png;base64,${PNG.fileBase64}`);
  assert.match(content[1].text, /Transcribe it/);
  assert.match(content[1].text, /"sessions"/, 'the answer shape is spelled out, since not every provider takes a schema');
  assert.deepEqual(sent[0].body.response_format, { type: 'json_object' });
  assert.equal(usage[0].feature, 'event_harvest', 'the spend shows on Observe under the same spender as before');
  assert.deepEqual(usage[0].scope, { projectId: 'p' });

  await extractSchedule({ mimeType: 'application/pdf', fileBase64: 'JVBERi0=' }, null);
  assert.equal(sent[1].body.messages.at(-1).content[0].type, 'file', 'a PDF goes as a file, not a picture');
  assert.equal(sent[1].body.messages.at(-1).content[0].file.file_data, 'data:application/pdf;base64,JVBERi0=');
});

test('with Anthropic out of credit, the flyer still reaches OpenAI and is read', async (t) => {
  t.after(() => setDoorDeps(null));
  const { sent } = fakeDoor({
    order: ['anthropic', 'openai'],
    answer: (def) => (def.id === 'anthropic'
      ? { status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } } }
      : openaiSays(TRANSCRIPT)),
  });
  const out = await extractSchedule({ mimeType: 'application/pdf', fileBase64: 'JVBERi0=' }, { projectId: 'p' });
  assert.equal(out.sessions.length, LINES.length);
  assert.deepEqual(sent.map((r) => r.provider), ['anthropic', 'openai']);
  assert.equal(sent[1].body.messages.at(-1).content[0].file.file_data, 'data:application/pdf;base64,JVBERi0=', 'OpenAI was sent the flyer itself');
});

test('when no provider can read the flyer, the upload names each one tried and why', async (t) => {
  t.after(() => setDoorDeps(null));
  const { sent } = fakeDoor({ order: ['kimi', 'anthropic', 'openai'], keys: ['kimi'], answer: () => openaiSays(TRANSCRIPT) });
  await assert.rejects(extractSchedule({ mimeType: 'application/pdf', fileBase64: 'JVBERi0=' }), (e) => {
    assert.equal(e.code, 'NOT_CONFIGURED');
    assert.equal(e.status, 503);
    assert.match(e.message, /Kimi cannot read PDFs/);
    assert.match(e.message, /Anthropic has no key/);
    assert.match(e.message, /OpenAI has no key/);
    assert.doesNotMatch(e.message, /No Anthropic API key is configured/);
    return true;
  });
  assert.equal(sent.length, 0, 'nothing is sent, and nothing is spent');
});

test('the model call: a refusal, a truncation and junk each say so', async (t) => {
  t.after(() => setDoorDeps(null));
  const cases = [
    [openaiSays('', 'content_filter'), 'REFUSED'],
    [openaiSays('{"sessions": [', 'length'), 'TOO_LONG'],
    [openaiSays('Sorry, I cannot.'), 'BAD_OUTPUT'],
    [openaiSays('[1, 2]'), 'BAD_OUTPUT'],
    [{ status: 429, json: { error: { message: 'Rate limit reached for requests' } } }, 'UPSTREAM_BUSY'],
    [{ status: 500, json: { error: { message: 'server error' } } }, 'UPSTREAM_FAILED'],
  ];
  for (const [reply, code] of cases) {
    fakeDoor({ order: ['openai'], answer: () => reply });
    await assert.rejects(extractSchedule(PNG), (e) => e.code === code, `${JSON.stringify(reply).slice(0, 80)} reads as ${code}`);
  }
});

test('a refusal other than busy or bad-request keeps the provider\'s own reason (SC-896 review)', async (t) => {
  t.after(() => setDoorDeps(null));
  fakeDoor({ order: ['openai'], answer: () => ({ status: 413, json: { error: { message: 'Request entity too large: file exceeds 20MB' } } }) });
  await assert.rejects(extractSchedule(PNG), (e) => {
    assert.equal(e.code, 'UPSTREAM_REJECTED');
    assert.match(e.message, /413/);
    assert.match(e.message, /file exceeds 20MB/, 'the provider\'s reason reaches Dane');
    assert.doesNotMatch(e.message, /could not be reached/);
    return true;
  });
});

test('a read that outlasts the wait says it took too long, and the wait ends before Vercel\'s 300s', async (t) => {
  t.after(() => setDoorDeps(null));
  const signals = [];
  const timedOut = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  fakeDoor({ order: ['openai'], signals, answer: () => ({ error: timedOut }) });
  await assert.rejects(extractSchedule(PNG), (e) => {
    assert.equal(e.code, 'UPSTREAM_TIMEOUT');
    assert.match(e.message, /took longer than 4 minutes/);
    assert.match(e.message, /one week per file/);
    return true;
  });
  assert.ok(signals[0], 'the request carried a time limit');
  assert.ok(harvest.TIMEOUT_MS < 300 * 1000 - 30 * 1000, `the wait (${harvest.TIMEOUT_MS}ms) ends well inside Vercel's 300s`);
});

test('the upload button shows only when a provider in the order can read a flyer and has a key', async (t) => {
  t.after(() => setDoorDeps(null));
  const { isAvailable } = harvest;
  fakeDoor({ order: ['kimi', 'openai'], keys: ['openai'], answer: () => openaiSays('{}') });
  assert.equal(await isAvailable(), true);
  fakeDoor({ order: ['deepseek', 'openai'], keys: ['deepseek'], answer: () => openaiSays('{}') });
  assert.equal(await isAvailable(), false, 'a text-only provider with a key cannot read a flyer');
  fakeDoor({ order: [], answer: () => openaiSays('{}') });
  assert.equal(await isAvailable(), false);
});

test('only Alphire staff may read schedules: platform users, and club admins who also hold a platform account', async () => {
  const { isAlphireStaff } = require('../../routes/eventHarvest');
  const staffEmails = new Set(['dane@alphire.test']);
  const find = async (email) => (staffEmails.has(email) ? { id: 'u1', email } : null);
  assert.equal(await isAlphireStaff(null, find), false);
  assert.equal(await isAlphireStaff({ id: 'u1', email: 'dane@alphire.test' }, find), true, 'a platform session is staff');
  assert.equal(await isAlphireStaff({ id: 'padm_1', email: 'dane@alphire.test', isProjectAdmin: true }, find), true);
  assert.equal(await isAlphireStaff({ id: 'padm_2', email: 'coach@delraytennis.test', isProjectAdmin: true }, find), false, "a club's own admin is refused");
  assert.equal(await isAlphireStaff({ id: 'padm_3', email: '', isProjectAdmin: true }, find), false);
  const broken = async () => { throw new Error('database down'); };
  assert.equal(await isAlphireStaff({ id: 'padm_1', email: 'dane@alphire.test', isProjectAdmin: true }, broken), false, 'a failed lookup refuses, never grants');
});
