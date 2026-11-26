'use strict';

// AI provider groups 2 (SC-876): each feature group's row on Settings › APIs,
// the one Save that writes the main order and the group orders together, the
// last-call reading per group, and the four SC-872 review items:
//   1. a row with only group orders is "main order not saved" for every reader
//   2. a key used only by a group's own order is still checked and alarmed
//   3. removing a service on the main list takes it out of group orders too
//   4. one Save is one write, so its "saved by" stamp is true of all of it

const test = require('node:test');
const assert = require('node:assert/strict');

const ai = require('../../lib/aiClient');
const store = require('../../lib/aiProviderSettingsStore');
const aiKeys = require('../../lib/aiKeys');
const supabase = require('../../lib/supabase');
const route = require('../../routes/aiProviders');
const { lastCallPerGroup, readLastCalls } = require('../../lib/aiGroupLastCalls');
const { GROUP_IDS } = require('../../lib/aiFeatureGroups');

const ALL = Object.keys(ai.AI_PROVIDERS);
const ON = new Set(['anthropic', 'openai', 'gemini']);
function list(order = ALL, on = ON) {
  return order.map((id) => ({ id, enabled: on.has(id), fast: ai.AI_PROVIDERS[id]?.models.fast || 'm-fast', strong: ai.AI_PROVIDERS[id]?.models.strong || 'm-strong' }));
}
const OPENAI_FIRST = ['openai', ...ALL.filter((id) => id !== 'openai')];

/**
 * A stand-in for the database that behaves like PostgREST with
 * merge-duplicates on the provider row: a POST merges the columns it names
 * into the one row, a GET returns it. Usage reads answer `usage`.
 */
function fakeDb({ row = null, usage = { ok: true, data: [] }, failWrite = false, noGroupColumn = false } = {}) {
  const db = { row, writes: [] };
  db.sbQuery = async (req) => {
    if (req.table === supabase.tableConfig().observeUsageLogs) return typeof usage === 'function' ? usage(req) : usage;
    if (req.table !== supabase.tableConfig().aiProviderSettings) return { ok: true, data: [] }; // the activity log
    if (req.method === 'GET') return { ok: true, data: db.row ? [db.row] : [] };
    db.writes.push(req.body);
    if (failWrite) return { ok: false, status: 500, error: { message: 'refused' } };
    if (noGroupColumn && 'group_orders' in req.body) return { ok: false, status: 400, error: { message: 'column "group_orders" does not exist' } };
    db.row = { providers: [], custom_providers: [], ...(db.row || {}), ...req.body };
    return { ok: true, data: [db.row] };
  };
  return db;
}

async function withDb(db, fn) {
  const original = { sbQuery: supabase.sbQuery, isConfigured: supabase.isConfigured };
  supabase.sbQuery = db.sbQuery;
  supabase.isConfigured = () => true;
  ai.forgetProviderOrder();
  try {
    return await fn();
  } finally {
    supabase.sbQuery = original.sbQuery;
    supabase.isConfigured = original.isConfigured;
    ai.forgetProviderOrder();
  }
}

async function call(method, body) {
  const req = { method, url: '/api/settings/ai-providers', authUser: { role: 'owner', id: 'u1' }, projectContext: { project: { id: 'p1' } }, body, headers: {} };
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(text) { this.text = text; } };
  await route.handle(req, res, '/api/settings/ai-providers', method);
  return { status: res.statusCode, json: JSON.parse(res.text) };
}

// ── The screen read ────────────────────────────────────────────────────────

test('every group is on the screen, following the main setting, with what it covers', async () => {
  const db = fakeDb({ row: { id: 'platform', providers: list(), custom_providers: [] } });
  const { status, json } = await withDb(db, () => call('GET'));
  assert.equal(status, 200);
  const groups = json.data.groups;
  assert.deepEqual(groups.map((g) => g.id), GROUP_IDS);
  assert.deepEqual(groups.map((g) => g.label), ['Outreach', 'Studio / Reel Spinner', 'Writing', 'Acquire', 'Everything else']);
  for (const g of groups) {
    assert.equal(g.follows, true, g.id);
    assert.ok(g.about.length > 10, `${g.id} says what it covers`);
    assert.deepEqual(g.providers.map((p) => p.id), json.data.providers.map((p) => p.id), `${g.id} starts from the main order`);
    assert.match(g.lastCallNone, /^No AI calls yet/);
  }
});

test('acceptance 1: Outreach on its own order, OpenAI first, survives a reload; every other group still follows', async () => {
  const db = fakeDb({ row: { id: 'platform', providers: list(), custom_providers: [] } });
  await withDb(db, async () => {
    const saved = await call('PUT', { providers: list(), customProviders: [], groupOrders: { outreach: list(OPENAI_FIRST) } });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.equal(saved.json.data.saved, true);
    // One write for the whole save (review item 4).
    assert.equal(db.writes.length, 1);
    assert.ok('providers' in db.writes[0] && 'group_orders' in db.writes[0]);
    const reload = await call('GET');
    const byId = Object.fromEntries(reload.json.data.groups.map((g) => [g.id, g]));
    assert.equal(byId.outreach.follows, false);
    assert.equal(byId.outreach.providers[0].id, 'openai');
    for (const id of GROUP_IDS.filter((x) => x !== 'outreach')) assert.equal(byId[id].follows, true, id);
    // And the door agrees with the screen.
    const order = await ai.getAiProviderOrder({ feature: 'reddit-comment-draft', fresh: true });
    assert.equal(order.orderUsed, 'group');
    assert.equal(order.providers[0].id, 'openai');
  });
});

test('a save whose group orders do not read back is not reported as saved', async () => {
  const db = fakeDb({ row: { id: 'platform', providers: list(), custom_providers: [] } });
  const sb = db.sbQuery;
  db.sbQuery = async (req) => {
    const r = await sb(req);
    if (req.method === 'POST') db.row.group_orders = null; // the database dropped the column's value
    return r;
  };
  const { status, json } = await withDb(db, () => call('PUT', { providers: list(), customProviders: [], groupOrders: { outreach: list(OPENAI_FIRST) } }));
  assert.equal(status, 502);
  assert.equal(json.error.code, 'AI_PROVIDERS_MISMATCH');
});

test('an invalid group order is refused before anything is written', async () => {
  const db = fakeDb({ row: { id: 'platform', providers: list(), custom_providers: [] } });
  const off = list(ALL, new Set());
  const { status, json } = await withDb(db, () => call('PUT', { providers: list(), customProviders: [], groupOrders: { outreach: off } }));
  assert.equal(status, 400);
  assert.match(json.error.message, /^Outreach: Switch at least one provider on/);
  assert.equal(db.writes.length, 0);
});

test('a main-only save leaves the group column alone where no group has ever had its own order (SQL not run)', async () => {
  const db = fakeDb({ row: { id: 'platform', providers: list(), custom_providers: [] }, noGroupColumn: true });
  const allFollow = Object.fromEntries(GROUP_IDS.map((id) => [id, null]));
  const { status } = await withDb(db, () => call('PUT', { providers: list(OPENAI_FIRST), customProviders: [], groupOrders: allFollow }));
  assert.equal(status, 200);
  assert.equal('group_orders' in db.writes[0], false);
});

// ── Review item 1: one "main order saved" flag, every reader ──────────────

test('a row with only group orders is "main not saved" to the screen, the door and the keys check', async () => {
  const row = { id: 'platform', providers: [], custom_providers: [], group_orders: { outreach: list(OPENAI_FIRST) } };
  const n = store.normaliseRow(row);
  assert.equal(n.exists, true);
  assert.equal(n.mainSaved, false);
  // The screen shows the fallback order switched ON, not every provider off.
  const rows = route.screenRows({ settings: n, fallback: ai.envProviderOrder({ env: {} }), builtIns: ai.AI_PROVIDERS, keyIsSet: () => true });
  assert.equal(rows.filter((r) => r.enabled).length, 3);
  // The keys check follows the environment's main order too.
  const order = aiKeys.switchProviders({ settings: n, env: {}, fallbackReason: 'main not saved' });
  assert.notEqual(order.source, 'settings');
  assert.equal(order.providers.filter((p) => p.enabled).length, 3);
  // The door's main order is not empty.
  const door = await ai.getAiProviderOrder({ env: {}, readSettings: async () => ({ ok: true, data: n }) });
  assert.ok(door.providers.length > 0);
});

// ── Review item 2: a key only a group uses is checked and alarmed ─────────

test('a provider off in the main order but on in Outreach\'s own order is still a used key', async () => {
  const main = list(ALL, new Set(['anthropic']));
  const settings = store.normaliseRow({ id: 'platform', providers: main, custom_providers: [], group_orders: { outreach: list(OPENAI_FIRST, new Set(['openai'])) } });
  const order = aiKeys.switchProviders({ settings });
  const openai = order.providers.find((p) => p.def.id === 'openai');
  assert.equal(openai.enabled, false, 'still off in the main order');
  assert.deepEqual(openai.groups, ['Outreach']);
  const entries = aiKeys.switchEntries(order, { keyFor: () => ({ key: 'k' }), place: 'the website' });
  assert.match(entries.find((e) => e.provider === 'openai').job, /Outreach's own order only/);
  const rows = await aiKeys.checkKeys(entries, {
    probe: async (provider) => (provider === 'openai'
      ? { status: 400, body: { error: { type: 'insufficient_quota', message: 'You exceeded your current quota' } } }
      : { status: 200, body: {} }),
  });
  const row = rows.find((r) => r.provider === 'openai');
  assert.equal(row.verdict, aiKeys.VERDICT.OUT_OF_CREDIT);
  const plan = aiKeys.planAlarms({ rows, state: {} });
  assert.ok(plan.post.some((r) => r.provider === 'openai'), 'its running dry is news, because Outreach bills it');
  assert.match(aiKeys.rowLine(row), /off in the main order; on for Outreach/);
  // Gemini is off everywhere: still not news.
  assert.equal(plan.post.some((r) => r.provider === 'gemini'), false);
});

// ── Review item 3: a removed service leaves the group orders ──────────────

const GROQ = { label: 'Groq Cloud', baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'AI_SERVICE_GROQ_API_KEY', id: 'custom-groq-cloud' };

test('removing a service on the main list takes it out of a group\'s stored order (screen did not send groups)', async () => {
  const withGroq = [...list(), { id: GROQ.id, enabled: false, fast: 'llama', strong: 'llama' }];
  const outreach = [{ id: GROQ.id, enabled: true, fast: 'llama', strong: 'llama' }, ...list()];
  const db = fakeDb({ row: { id: 'platform', providers: withGroq, custom_providers: [GROQ], group_orders: { outreach } } });
  const { status } = await withDb(db, () => call('PUT', { providers: list(), customProviders: [] }));
  assert.equal(status, 200);
  const stored = db.row.group_orders.outreach;
  assert.equal(stored.some((p) => p.id === GROQ.id), false);
  assert.equal(stored.length, ALL.length);
  assert.equal(stored[0].id, 'anthropic', 'the rest of Outreach\'s order is kept as it was');
});

test('removing the only provider a group has switched on is refused, not quietly moved to the main order', async () => {
  const withGroq = [...list(), { id: GROQ.id, enabled: false, fast: 'llama', strong: 'llama' }];
  const outreach = [{ id: GROQ.id, enabled: true, fast: 'llama', strong: 'llama' }, ...list(ALL, new Set())];
  const db = fakeDb({ row: { id: 'platform', providers: withGroq, custom_providers: [GROQ], group_orders: { outreach } } });
  const { status, json } = await withDb(db, () => call('PUT', { providers: list(), customProviders: [] }));
  assert.equal(status, 400);
  assert.match(json.error.message, /Outreach's own order uses only custom-groq-cloud/);
  assert.equal(db.writes.length, 0);
});

test('a group order the screen sends must name the services in this same save', async () => {
  const db = fakeDb({ row: { id: 'platform', providers: list(), custom_providers: [] } });
  const stale = [{ id: GROQ.id, enabled: true, fast: 'llama', strong: 'llama' }, ...list()];
  const { status, json } = await withDb(db, () => call('PUT', { providers: list(), customProviders: [], groupOrders: { outreach: stale } }));
  assert.equal(status, 400);
  assert.match(json.error.message, /not a provider this screen knows/);
});

// ── The last call per group ────────────────────────────────────────────────

test('acceptance 2: after one Outreach call, the Outreach row names the provider that answered it', async () => {
  const usage = { ok: true, data: [
    { created_at: '2026-11-25T22:04:00Z', provider: 'openai', metadata: { feature: 'reddit-comment-draft', model: 'gpt-5.5' } },
    { created_at: '2026-11-25T21:00:00Z', provider: 'anthropic', metadata: { feature: 'seo_alt_text', model: 'claude-sonnet-5-5' } },
    { created_at: '2026-11-25T20:00:00Z', provider: 'anthropic', metadata: { feature: 'reddit-comment-draft', model: 'x' } },
  ] };
  const db = fakeDb({ row: { id: 'platform', providers: list(), custom_providers: [] }, usage });
  const { json } = await withDb(db, () => call('GET'));
  const byId = Object.fromEntries(json.data.groups.map((g) => [g.id, g]));
  assert.equal(byId.outreach.lastCall.provider, 'openai', 'the NEWEST Outreach call');
  assert.equal(byId.outreach.lastCall.providerLabel, 'OpenAI');
  assert.equal(byId.writing.lastCall.provider, 'anthropic');
  assert.equal(byId.studio.lastCall, null);
  assert.match(byId.studio.lastCallNone, /No AI calls yet/);
});

test('acceptance 3: a meter that cannot be read says so on every row, never "No AI calls yet"', async () => {
  const db = fakeDb({ row: { id: 'platform', providers: list(), custom_providers: [] }, usage: { ok: false, status: 500, error: { message: 'timeout' } } });
  const { json } = await withDb(db, () => call('GET'));
  for (const g of json.data.groups) {
    assert.match(g.lastCallError, /could not be read \(timeout\)/, g.id);
    assert.equal(g.lastCallNone, '', g.id);
    assert.equal(g.lastCall, null, g.id);
  }
});

test('the meter read is one bounded query of AI rows only, and a full read does not claim "never"', async () => {
  let asked = null;
  const rows = Array.from({ length: 5000 }, (_, i) => ({ created_at: `2026-11-25T00:00:${String(i % 60).padStart(2, '0')}Z`, provider: 'anthropic', metadata: { feature: 'seo_alt_text' } }));
  const read = await readLastCalls({ sbQuery: async (req) => { asked = req; return { ok: true, data: rows }; }, table: 'observe_usage_logs' });
  assert.match(asked.query, /usage_type=eq\.llm_tokens/);
  assert.match(asked.query, /created_at=gte\./);
  assert.match(asked.query, /limit=5000/);
  assert.equal(read.data.truncated, true);
  const screen = route.groupRows({ settings: null, mainRows: [], builtIns: ai.AI_PROVIDERS, keyIsSet: () => false, lastCalls: read });
  assert.match(screen.find((g) => g.id === 'studio').lastCallNone, /latest 5,000 recorded \(an older one may exist\)/);
});

test('a call from a feature in no group is not credited to any group', () => {
  const out = lastCallPerGroup([{ created_at: 'x', provider: 'openai', metadata: { feature: 'unknown' } }, { created_at: 'y', provider: 'openai', metadata: {} }]);
  assert.deepEqual(Object.values(out), GROUP_IDS.map(() => null));
});

test('the screen read never returns a key value', async () => {
  const db = fakeDb({ row: { id: 'platform', providers: list(), custom_providers: [], group_orders: { outreach: list(OPENAI_FIRST) } } });
  const { json } = await withDb(db, () => call('GET'));
  assert.equal(JSON.stringify(json).includes('"key":'), false);
});
