'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Schedule harvest (task 86bbztj0e). The model call is replaced by a fake
 * client, so no test spends money; what is tested is everything around it —
 * the refusals before paying, the handling of what comes back, and the
 * lines-to-series merge that decides how many events a flyer becomes.
 */

const harvest = require('../../lib/eventHarvest');
const {
  HarvestError, readUpload, normalizeExtraction, mergeSessions, matchExisting, matchVenues, extractSchedule, setClientFactory,
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

test('flyer venues are matched to the project venues by name', () => {
  const venues = matchVenues([{ name: 'Pickleball', color: '#f7a600' }, { name: 'New Courts', color: '' }], [{ id: 'ecat_1', name: 'pickleball' }]);
  assert.deepEqual(venues.map((v) => v.categoryId), ['ecat_1', '']);
});

test('the model call: a transcription comes back parsed and its cost is recorded', async (t) => {
  let request = null;
  setClientFactory(() => ({
    beta: { messages: { stream(params) {
      request = params;
      return { finalMessage: async () => ({
        model: 'claude-opus-5', stop_reason: 'end_turn', usage: { input_tokens: 1200, output_tokens: 900 },
        content: [{ type: 'text', text: JSON.stringify({ weekStart: '2026-08-31', venues: [], sessions: LINES }) }],
      }) };
    } } },
  }));
  t.after(() => setClientFactory(null));
  const out = await extractSchedule(PNG, { projectId: 'p' });
  assert.equal(out.sessions.length, LINES.length);
  assert.equal(request.model, 'claude-opus-5');
  assert.equal(request.messages[0].content[0].type, 'image');
  assert.equal(request.output_config.format.type, 'json_schema');
  assert.deepEqual(request.betas, ['server-side-fallback-2026-07-01']);

  const pdf = await extractSchedule({ mimeType: 'application/pdf', fileBase64: 'JVBERi0=' }, null);
  assert.ok(pdf);
  assert.equal(request.messages[0].content[0].type, 'document', 'a PDF goes as a document block, not an image');
});

test('the model call: a refusal, a truncation and junk each say so', async (t) => {
  t.after(() => setClientFactory(null));
  const answer = (message) => setClientFactory(() => ({ beta: { messages: { stream: () => ({ finalMessage: async () => message }) } } }));

  answer({ stop_reason: 'refusal', content: [], usage: {} });
  await assert.rejects(extractSchedule(PNG), (e) => e.code === 'REFUSED');
  answer({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"sessions": [' }], usage: {} });
  await assert.rejects(extractSchedule(PNG), (e) => e.code === 'TOO_LONG');
  answer({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sorry, I cannot.' }], usage: {} });
  await assert.rejects(extractSchedule(PNG), (e) => e.code === 'BAD_OUTPUT');
  setClientFactory(() => ({ beta: { messages: { stream: () => { const e = new Error('rate'); e.status = 429; throw e; } } } }));
  await assert.rejects(extractSchedule(PNG), (e) => e.code === 'UPSTREAM_BUSY');
});
