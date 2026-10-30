'use strict';

/**
 * Settings › AI Quota, "What Anthropic actually billed" (AI Quota 2/5, task
 * 86bcvj7v0). The bill sits beside Starcaster's meter so the gap between them
 * is the alarm — on Oct 28-30, 2026 the Mini spent about $35 the meter never
 * saw. These hold the three things that would make that alarm lie: dollars
 * read wrong (the report is in CENTS), a missing key or failed read shown as
 * $0, and the warning firing (or not) on the wrong side of 20%.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getAnthropicBilling,
  compareMeterToBill,
  summariseCost,
  summariseUsageByKey,
  estimateUsageUsd,
  billingWindow,
  clearBillingCache,
} = require('../../lib/anthropicBilling');

const NOW = Date.parse('2026-10-30T15:00:00Z');

function withKey(value, fn) {
  const before = process.env.ANTHROPIC_ADMIN_KEY;
  if (value === undefined) delete process.env.ANTHROPIC_ADMIN_KEY;
  else process.env.ANTHROPIC_ADMIN_KEY = value;
  clearBillingCache();
  return Promise.resolve(fn()).finally(() => {
    if (before === undefined) delete process.env.ANTHROPIC_ADMIN_KEY;
    else process.env.ANTHROPIC_ADMIN_KEY = before;
    clearBillingCache();
  });
}

function json(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const COST_PAGE = {
  data: [
    {
      starting_at: '2026-10-29T00:00:00Z',
      ending_at: '2026-10-30T00:00:00Z',
      results: [
        { currency: 'USD', amount: '3500.25', description: 'Claude Sonnet 5.5 Usage - Input Tokens', model: 'claude-sonnet-5-5' },
        { currency: 'USD', amount: '499.75', description: 'Claude Sonnet 5.5 Usage - Output Tokens', model: 'claude-sonnet-5-5' },
      ],
    },
    {
      starting_at: '2026-10-30T00:00:00Z',
      ending_at: '2026-10-31T00:00:00Z',
      results: [{ currency: 'USD', amount: '100', description: 'Claude Haiku 5.5 Usage', model: 'claude-haiku-5-5' }],
    },
  ],
  has_more: false,
  next_page: null,
};

const USAGE_PAGE = {
  data: [{
    starting_at: '2026-10-29T00:00:00Z',
    ending_at: '2026-10-30T00:00:00Z',
    results: [
      { api_key_id: 'apikey_mini', model: 'claude-sonnet-5-5', uncached_input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 0, cache_creation: {} },
      { api_key_id: null, model: 'claude-mystery-9', uncached_input_tokens: 10, output_tokens: 10 },
    ],
  }],
  has_more: false,
};

function fakeFetch(calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/cost_report')) return json(COST_PAGE);
    if (url.includes('/usage_report/messages')) return json(USAGE_PAGE);
    if (url.includes('/api_keys')) return json({ data: [{ id: 'apikey_mini', name: 'Mac Mini OpenClaw' }], has_more: false });
    return json({ error: { message: 'unexpected' } }, 404);
  };
}

test('no Admin key reads as "not connected" — never $0, and nothing is fetched', async () => {
  await withKey(undefined, async () => {
    const calls = [];
    const res = await getAnthropicBilling({ now: NOW, fetchImpl: fakeFetch(calls) });
    assert.deepEqual(res, { ok: true, data: { status: 'not-connected' } });
    assert.equal(calls.length, 0);
  });
});

test('cost report amounts are CENTS: 3500.25 + 499.75 cents is $40.00, not $4000', () => {
  const out = summariseCost(COST_PAGE.data, '2026-10-30T00:00:00.000Z');
  assert.equal(out.byDay[0].costUsd, 40);
  assert.equal(out.finishedUsd, 40, 'only finished days go into the comparison figure');
  assert.equal(out.totalUsd, 41, 'today so far is in the total');
  assert.equal(out.byDay[1].finished, false, 'today is marked as still filling in');
  assert.deepEqual(out.byModel.map((m) => m.model), ['claude-sonnet-5-5', 'claude-haiku-5-5']);
});

test('the warning fires only when the bill is MORE than 20% above the meter', () => {
  assert.equal(compareMeterToBill(10, 12).alarm, false, 'exactly 20% over is not an alarm');
  const over = compareMeterToBill(10, 45);
  assert.equal(over.alarm, true);
  assert.equal(over.unseenUsd, 35, 'the sentence names the gap in dollars');
  assert.equal(compareMeterToBill(0, 35).alarm, true, 'a meter that saw nothing is the Oct 28-30 case');
  assert.equal(compareMeterToBill(50, 40).alarm, false, 'a bill below the meter is the meter erring high, by design');
  assert.equal(compareMeterToBill(0, 0).alarm, false);
});

test('per-key spend is priced at list rates, and an unknown model is flagged, not $0', () => {
  // Sonnet 5.5 at $2/$10: 1M input = $2, 100K output = $1.
  assert.equal(estimateUsageUsd(USAGE_PAGE.data[0].results[0]), 3);
  assert.equal(estimateUsageUsd({ model: 'claude-sonnet-5-5', cache_creation: { ephemeral_1h_input_tokens: 1_000_000 } }), 4, '1-hour cache writes bill at 2x input');
  assert.equal(estimateUsageUsd({ model: 'claude-mystery-9', output_tokens: 5 }), null);

  const keys = summariseUsageByKey(USAGE_PAGE.data, { apikey_mini: 'Mac Mini OpenClaw' });
  assert.equal(keys[0].name, 'Mac Mini OpenClaw');
  assert.equal(keys[0].estimatedUsd, 3);
  const keyless = keys.find((k) => k.apiKeyId === '');
  assert.match(keyless.name, /No API key/);
  assert.deepEqual(keyless.unpricedModels, ['claude-mystery-9']);
});

test('the window is 30 finished UTC days plus today', () => {
  const w = billingWindow(30, NOW);
  assert.equal(w.finishedUntil, '2026-10-30T00:00:00.000Z');
  assert.equal(w.startingAt, '2026-09-30T00:00:00.000Z');
});

test('a full read sends the Admin key server-side, groups as the ticket asks, and caches for 15 minutes', async () => {
  await withKey('sk-ant-admin-test', async () => {
    const calls = [];
    const first = await getAnthropicBilling({ now: NOW, fetchImpl: fakeFetch(calls) });
    assert.equal(first.ok, true);
    assert.equal(first.data.status, 'ok');
    assert.equal(first.data.finishedUsd, 40);
    assert.equal(first.data.byKey[0].name, 'Mac Mini OpenClaw');

    const cost = calls.find((c) => c.url.includes('/cost_report'));
    assert.equal(cost.init.headers['x-api-key'], 'sk-ant-admin-test');
    assert.match(decodeURIComponent(cost.url), /group_by\[\]=description/);
    assert.match(decodeURIComponent(cost.url), /bucket_width=1d/);
    const usage = calls.find((c) => c.url.includes('/usage_report/messages'));
    assert.match(decodeURIComponent(usage.url), /group_by\[\]=api_key_id/);
    assert.match(decodeURIComponent(usage.url), /group_by\[\]=model/);

    const before = calls.length;
    const again = await getAnthropicBilling({ now: NOW + 14 * 60 * 1000, fetchImpl: fakeFetch(calls) });
    assert.equal(calls.length, before, 'a second read inside 15 minutes is served from the cache');
    assert.equal(again.data.cached, true);
    await getAnthropicBilling({ now: NOW + 16 * 60 * 1000, fetchImpl: fakeFetch(calls) });
    assert.ok(calls.length > before, 'after 15 minutes it reads again');
  });
});

test('a refused key is a failed read with the reason — never a $0 bill', async () => {
  await withKey('sk-ant-api-wrong-kind', async () => {
    const res = await getAnthropicBilling({
      now: NOW,
      fetchImpl: async () => json({ error: { message: 'invalid x-api-key' } }, 401),
    });
    assert.equal(res.ok, false);
    assert.match(res.error, /invalid x-api-key/);
    assert.match(res.error, /Admin key/);
  });
});

test('pages are followed until has_more is false', async () => {
  await withKey('sk-ant-admin-test', async () => {
    const pages = {
      '': { data: [COST_PAGE.data[0]], has_more: true, next_page: 'p2' },
      p2: { data: [COST_PAGE.data[1]], has_more: false, next_page: null },
    };
    const res = await getAnthropicBilling({
      now: NOW,
      fetchImpl: async (url) => {
        if (url.includes('/cost_report')) return json(pages[new URL(url).searchParams.get('page') || '']);
        return json({ data: [], has_more: false });
      },
    });
    assert.equal(res.data.byDay.length, 2);
    assert.equal(res.data.totalUsd, 41);
  });
});

test('a failed per-key read keeps the bill and says the split is missing', async () => {
  await withKey('sk-ant-admin-test', async () => {
    const res = await getAnthropicBilling({
      now: NOW,
      fetchImpl: async (url) => (url.includes('/cost_report') ? json(COST_PAGE) : json({ error: { message: 'boom' } }, 500)),
    });
    assert.equal(res.ok, true);
    assert.equal(res.data.byKey, null);
    assert.match(res.data.byKeyError, /boom/);
  });
});
