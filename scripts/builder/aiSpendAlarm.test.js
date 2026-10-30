'use strict';

/**
 * The AI spending alarm (AI Quota 4/5, task 86bcvj7zm). On Oct 28-30, 2026 the
 * Anthropic account drained two nights running and the first sign was an empty
 * balance. These hold the ways the alarm could stay quiet when it should speak,
 * or speak every hour when it should not:
 *  - the limit and the spike judged on the right side of the line;
 *  - once per 6 hours, cleared by a quiet check, and a failed read NEVER
 *    clearing an open alert;
 *  - "could not read" is its own alert;
 *  - a stamp only moves when the alert reached somebody;
 *  - every message says which spend it read.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const alarm = require('../../lib/aiSpendAlarm');
const store = require('../../lib/aiSpendAlarmStore');
const { summariseToday } = require('../../lib/anthropicBilling');

const NOW = Date.parse('2026-10-30T18:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const SETTINGS = { dailyLimitUsd: 5, spikeMultiple: 3, alertEmail: 'dane@example.com', stamps: {} };

function billData({ today = 14.2, past = 1, byKey = null, byModel = [{ model: 'claude-sonnet-5-5', costUsd: 14.2 }] } = {}) {
  const byDay = alarm.baselineDays(NOW).map((day) => ({ day, costUsd: past, finished: true }));
  byDay.push({ day: '2026-10-30', costUsd: today, finished: false });
  return { status: 'ok', byDay, today: { day: '2026-10-30', costUsd: today, byModel, byKey } };
}

function fakeDeps(overrides = {}) {
  const sent = { bus: [], email: [], writes: [] };
  const deps = {
    now: NOW,
    env: {},
    readAlarm: async () => ({ ok: true, data: { ...SETTINGS } }),
    readBill: async () => ({ ok: true, data: billData() }),
    readMeter: async () => ({ ok: true, data: { byDay: {}, calls: 0, truncated: false } }),
    postBus: async (text) => { sent.bus.push(text); return { ok: true, why: '' }; },
    sendEmail: async (msg) => { sent.email.push(msg); return { ok: true }; },
    writeCheck: async (w) => { sent.writes.push(w); return { ok: true }; },
    ...overrides,
  };
  return { deps, sent };
}

test('the limit: over it alerts, at or under it does not', () => {
  const at = (todayUsd) => alarm.judge({ settings: SETTINGS, reading: { todayUsd, averageUsd: 10 } }).active['over-limit'];
  assert.equal(at(5.01), true);
  assert.equal(at(5), false);
  assert.equal(at(0), false);
});

test('the spike: above the multiple of the 7-day average, and not judged on a $0 week', () => {
  const spike = (todayUsd, averageUsd) => alarm.judge({ settings: { ...SETTINGS, dailyLimitUsd: 1000 }, reading: { todayUsd, averageUsd } });
  assert.equal(spike(3.01, 1).active.spike, true);
  assert.equal(spike(3, 1).active.spike, false);
  const zeroWeek = spike(0.5, 0);
  assert.equal(zeroWeek.active.spike, false);
  assert.equal(zeroWeek.spikeJudged, false);
});

test('the 7-day average is over seven days, with a missing day counted as $0', () => {
  const data = billData({ past: 7 });
  data.byDay = data.byDay.filter((d) => d.day !== '2026-10-29');
  const reading = alarm.readingFromBill(data, NOW);
  assert.equal(reading.averageUsd, 6);
  assert.equal(reading.todayUsd, 14.2);
  assert.equal(reading.source, 'bill');
});

test('once per 6 hours: posts, holds inside the window, posts again after it', () => {
  const judged = { readable: true, active: { 'over-limit': true, spike: false, unreadable: false } };
  assert.equal(alarm.plan({ judged, stamps: {}, now: NOW })['over-limit'], 'post');
  const recent = new Date(NOW - 5 * HOUR).toISOString();
  assert.equal(alarm.plan({ judged, stamps: { 'over-limit': recent }, now: NOW })['over-limit'], 'hold');
  const old = new Date(NOW - 6 * HOUR).toISOString();
  assert.equal(alarm.plan({ judged, stamps: { 'over-limit': old }, now: NOW })['over-limit'], 'post');
});

test('a quiet check clears an open alert; a failed read never does', () => {
  const stamps = { 'over-limit': new Date(NOW - HOUR).toISOString() };
  const quiet = { readable: true, active: { 'over-limit': false, spike: false, unreadable: false } };
  assert.equal(alarm.plan({ judged: quiet, stamps, now: NOW })['over-limit'], 'clear');
  const blind = alarm.judge({ settings: SETTINGS, reading: null, unreadableWhy: 'timeout' });
  const actions = alarm.plan({ judged: blind, stamps, now: NOW });
  assert.equal(actions['over-limit'], 'hold', 'not knowing is not the same as quiet');
  assert.equal(actions.unreadable, 'post');
});

test('the alert names the amount, the limit, the biggest spender and the source', async () => {
  const byKey = [{ apiKeyId: 'apikey_mini', name: 'Mac Mini OpenClaw', tokens: 9e6, estimatedUsd: 13 }];
  const { deps, sent } = fakeDeps({ readBill: async () => ({ ok: true, data: billData({ byKey }) }) });
  const result = await alarm.runSpendCheck(deps);
  assert.equal(result.ok, true);
  assert.equal(sent.bus.length, 2, 'over the limit AND 14.2x a $1 week');
  const text = sent.bus[0];
  assert.match(text, /AI spend today is \$14\.20, over your \$5\.00 limit; most of it is the API key “Mac Mini OpenClaw”\./);
  assert.match(text, /Read from Anthropic’s bill\./);
  assert.match(sent.bus[1], /14\.2× the 7-day average of \$1\.00 a day/);
  assert.equal(sent.email[0].to, 'dane@example.com');
  assert.match(sent.email[0].subject, /\$14\.20 today, over your \$5\.00 limit/);
  assert.ok(sent.writes[0].stamps['over-limit'], 'stamped because it was delivered');
});

test('without the bill it reads the meter and says so, with what the meter cannot see', async () => {
  const meter = { byDay: { '2026-10-30': { costUsd: 6, calls: 3, unpricedCalls: 1, byFeature: { 'outreach.drafts': 6 } } }, calls: 3, truncated: false };
  const { deps, sent } = fakeDeps({
    readBill: async () => ({ ok: true, data: { status: 'not-connected' } }),
    readMeter: async () => ({ ok: true, data: meter }),
  });
  await alarm.runSpendCheck(deps);
  assert.equal(sent.bus.length, 1, 'over the limit; no spike on a $0 week');
  assert.match(sent.bus[0], /most of it is the “outreach\.drafts” feature \(\$6\.00\)/);
  assert.match(sent.bus[0], /Read from Starcaster’s estimate \(Anthropic’s bill is not connected\)/);
  assert.match(sent.bus[0], /does not see the Mac Mini/);
  assert.match(sent.bus[0], /1 of today’s calls have no price/);
});

test('a bill that fails falls back to the meter and says why', async () => {
  const { deps, sent } = fakeDeps({
    readBill: async () => ({ ok: false, error: 'HTTP 500' }),
    readMeter: async () => ({ ok: true, data: { byDay: { '2026-10-30': { costUsd: 9, calls: 1, unpricedCalls: 0, byFeature: {} } }, calls: 1, truncated: false } }),
  });
  await alarm.runSpendCheck(deps);
  assert.match(sent.bus[0], /Anthropic’s bill could not be read \(HTTP 500\), so this used Starcaster’s estimate/);
});

test('"could not read the spend" is its own alert, never silence', async () => {
  const { deps, sent } = fakeDeps({
    readBill: async () => ({ ok: false, error: 'HTTP 500' }),
    readMeter: async () => ({ ok: false, error: 'Supabase down' }),
  });
  const result = await alarm.runSpendCheck(deps);
  assert.equal(result.ok, true);
  assert.equal(result.data.todayUsd, null, 'never $0 for "could not tell"');
  assert.equal(sent.bus.length, 1);
  assert.match(sent.bus[0], /could not read today’s spend: Anthropic’s bill: HTTP 500; Starcaster’s meter: Supabase down/);
  assert.ok(sent.writes[0].stamps.unreadable);
});

test('a stamp moves only when the alert reached somebody', async () => {
  const { deps, sent } = fakeDeps({
    postBus: async () => ({ ok: false, why: 'HTTP 401' }),
    sendEmail: async () => ({ ok: false, error: 'Resend down' }),
  });
  const result = await alarm.runSpendCheck(deps);
  assert.equal(sent.writes[0].stamps['over-limit'], undefined, 'nobody was told, so the next hour tries again');
  assert.match(result.data.delivered['over-limit'].bus, /FAILED: HTTP 401/);
});

test('a quiet day posts one all-clear for an open alert and clears its stamp', async () => {
  const stamps = { 'over-limit': new Date(NOW - 2 * HOUR).toISOString() };
  const { deps, sent } = fakeDeps({
    readAlarm: async () => ({ ok: true, data: { ...SETTINGS, stamps } }),
    readBill: async () => ({ ok: true, data: billData({ today: 0.4, past: 1 }) }),
  });
  await alarm.runSpendCheck(deps);
  assert.equal(sent.bus.length, 1);
  assert.match(sent.bus[0], /back under your \$5\.00 daily limit/);
  assert.equal(sent.email.length, 0);
  assert.equal(sent.writes[0].stamps['over-limit'], null);
});

test('no settings row readable: refuses loudly rather than posting every hour', async () => {
  const { deps, sent } = fakeDeps({ readAlarm: async () => ({ ok: false, status: 500, error: 'relation "ai_spend_alarm" does not exist' }) });
  const result = await alarm.runSpendCheck(deps);
  assert.equal(result.ok, false);
  assert.match(result.error, /ai_spend_alarm/);
  assert.equal(sent.bus.length, 0);
});

test('no address on the row falls back to AI_SPEND_ALERT_EMAIL, then SUPPORT_ALERT_EMAIL', () => {
  assert.equal(alarm.alertEmailAddress({ alertEmail: '' }, { AI_SPEND_ALERT_EMAIL: 'a@x.co', SUPPORT_ALERT_EMAIL: 'b@x.co' }), 'a@x.co');
  assert.equal(alarm.alertEmailAddress({ alertEmail: '' }, { SUPPORT_ALERT_EMAIL: 'b@x.co' }), 'b@x.co');
  assert.equal(alarm.alertEmailAddress({ alertEmail: 'd@x.co' }, { SUPPORT_ALERT_EMAIL: 'b@x.co' }), 'd@x.co');
});

test('settings: defaults before the first save, and bad input refused rather than clamped', () => {
  const empty = store.normaliseRow(null);
  assert.equal(empty.exists, false);
  assert.equal(empty.dailyLimitUsd, 5);
  assert.equal(empty.spikeMultiple, 3);
  assert.equal(store.validateSettingsInput({ dailyLimitUsd: 0.01, spikeMultiple: 3 }).ok, true);
  assert.equal(store.validateSettingsInput({ dailyLimitUsd: 0, spikeMultiple: 3 }).ok, false);
  assert.equal(store.validateSettingsInput({ dailyLimitUsd: 5, spikeMultiple: 0.5 }).ok, false);
  assert.equal(store.validateSettingsInput({ dailyLimitUsd: 'five', spikeMultiple: 3 }).ok, false);
  assert.equal(store.validateSettingsInput({ dailyLimitUsd: 5, spikeMultiple: 3, alertEmail: 'nope' }).ok, false);
});

test("today's bill is split out of the window by UTC day", () => {
  const cost = [
    { starting_at: '2026-10-29T00:00:00Z', ending_at: '2026-10-30T00:00:00Z', results: [{ amount: '100', model: 'claude-opus-5-5' }] },
    { starting_at: '2026-10-30T00:00:00Z', ending_at: '2026-10-31T00:00:00Z', results: [{ amount: '1420', model: 'claude-sonnet-5-5' }] },
  ];
  const usage = [
    { starting_at: '2026-10-29T00:00:00Z', results: [{ api_key_id: 'k_web', model: 'claude-opus-5-5', output_tokens: 10 }] },
    { starting_at: '2026-10-30T00:00:00Z', results: [{ api_key_id: 'k_mini', model: 'claude-sonnet-5-5', output_tokens: 1000 }] },
  ];
  const today = summariseToday(cost, usage, { k_mini: 'Mac Mini OpenClaw' }, NOW);
  assert.equal(today.day, '2026-10-30');
  assert.equal(today.costUsd, 14.2);
  assert.deepEqual(today.byModel.map((m) => m.model), ['claude-sonnet-5-5']);
  assert.deepEqual(today.byKey.map((k) => k.name), ['Mac Mini OpenClaw']);
  assert.equal(summariseToday(cost, null, {}, NOW).byKey, null);
});

test('the scheduled path is registered: CRON_PATHS, vercel.json, and the route list', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '..', '..');
  const index = fs.readFileSync(path.join(root, 'routes/index.js'), 'utf8');
  assert.match(index, /'\/api\/ai-quota\/check',/);
  assert.match(index, /\n  aiQuota,\n/);
  const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  assert.ok(vercel.crons.some((c) => c.path === '/api/ai-quota/check'));
});

test('the log line says when an alert reached nobody', () => {
  const line = alarm.formatCheckLog({ todayUsd: 1, averageUsd: 0, source: 'meter', actions: { 'over-limit': 'post' }, delivered: { 'over-limit': { bus: 'FAILED: HTTP 401', email: 'sent to d@x.co' } }, recorded: true });
  assert.match(line, /over-limit:post — NOT DELIVERED: over-limit bus FAILED: HTTP 401$/);
  assert.match(alarm.formatCheckLog({ todayUsd: null, actions: {}, recorded: true }), /spend UNREADABLE — quiet/);
});
