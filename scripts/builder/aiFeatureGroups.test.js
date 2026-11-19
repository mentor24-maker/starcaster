'use strict';

// AI provider groups 1 (SC-872): every feature that asks the AI door belongs
// to exactly one group, and each group follows the main order or its own.
//
// The scan below is the guard Dane's request needs: a new generate() call with
// a feature name no group lists must FAIL here, naming the file and the
// feature, rather than quietly billing whatever "Everything else" bills.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ai = require('../../lib/aiClient');
const store = require('../../lib/aiProviderSettingsStore');
const groups = require('../../lib/aiFeatureGroups');

const ROOT = path.resolve(__dirname, '..', '..');
const SCAN_DIRS = ['lib', 'routes', 'scripts', 'workers'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git']);
// Generated server libs (CLAUDE.md "Generated files") and tests are not callers.
const SKIP_FILES = /(^|\/)lib\/builder\/|\.test\.(c|m)?js$|(^|\/)scripts\/ui\//;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(c|m)?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** The text of the balanced `{ ... }` starting at `open`, or '' if unbalanced. */
function objectAt(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(open, i + 1); }
  }
  return '';
}

/**
 * Every feature name one source file hands the AI door, and every problem:
 *   { doorFile, features: [{ name, line }], problems: [string] }
 * A door file is one that takes `generate` from lib/aiClient. In it:
 *  - every `feature: <value>` must resolve to names: a string literal, a
 *    `const NAME = '...'` in the same file, or `a || b` of those; a value read
 *    off another object (`source.feature`) is passed through, and the names it
 *    carries are the literals this scan already found in that file;
 *  - every direct door call with an object argument must say `feature`, or the
 *    door names it "unknown", which is in no group.
 */
/**
 * The source with comment lines blanked (newlines kept, so line numbers still
 * match): a feature named in a comment is not a call. Deliberately simple, a
 * line-start rule rather than a tokenizer, because a hand tokenizer that
 * misreads one regex literal goes blind to the rest of the file.
 */
function codeOnly(src) {
  let inBlock = false;
  return src.split('\n').map((line) => {
    const t = line.trim();
    if (inBlock) { if (t.includes('*/')) inBlock = false; return ''; }
    if (t.startsWith('/*')) { if (!t.includes('*/')) inBlock = true; return ''; }
    if (t.startsWith('//') || t.startsWith('*')) return '';
    return line;
  }).join('\n');
}

/** True when `index` sits inside a template literal opened earlier on its line (a printed message, not code). */
function insideTemplate(src, index) {
  const lineStart = src.lastIndexOf('\n', index) + 1;
  return (src.slice(lineStart, index).match(/`/g) || []).length % 2 === 1;
}

function scanSource(rel, raw) {
  const src = codeOnly(raw);
  const out = { doorFile: false, features: [], problems: [] };
  const lineOf = (index) => src.slice(0, index).split('\n').length;
  const doorNames = new Set();
  const destructured = /const\s*\{([^}]*)\}\s*=\s*require\(\s*['"][./]*(?:lib\/)?aiClient(?:\.js)?['"]\s*\)/g;
  for (const m of src.matchAll(destructured)) {
    for (const part of m[1].split(',')) {
      const [orig, alias] = part.split(':').map((x) => x.trim());
      if (orig === 'generate') doorNames.add(alias || 'generate');
    }
  }
  const moduleVar = /const\s+(\w+)\s*=\s*require\(\s*['"][./]*(?:lib\/)?aiClient(?:\.js)?['"]\s*\)\s*;/g;
  for (const m of src.matchAll(moduleVar)) {
    if (new RegExp(`\\b${m[1]}\\.generate\\s*\\(`).test(src)) doorNames.add(`${m[1]}.generate`);
  }
  if (/require\(\s*['"][./]*(?:lib\/)?aiClient(?:\.js)?['"]\s*\)\.generate\s*\(/.test(src)) doorNames.add("require('./aiClient').generate");
  if (!doorNames.size) return out;
  out.doorFile = true;

  const consts = new Map();
  for (const m of src.matchAll(/const\s+([A-Z_][A-Z0-9_]*)\s*=\s*(['"`])([^'"`\n]+)\2\s*;/g)) consts.set(m[1], m[3]);

  for (const m of src.matchAll(/\bfeature\s*:\s*([^,\n}]+)/g)) {
    if (insideTemplate(src, m.index)) continue;
    const expr = m[1].trim();
    for (const alt of expr.split('||').map((x) => x.trim())) {
      const lit = alt.match(/^(['"`])([^'"`]*)\1$/);
      if (lit) { out.features.push({ name: lit[2], line: lineOf(m.index) }); continue; }
      if (/^[A-Z_][A-Z0-9_]*$/.test(alt)) {
        if (consts.has(alt)) out.features.push({ name: consts.get(alt), line: lineOf(m.index) });
        else out.problems.push(`${rel}:${lineOf(m.index)} passes feature ${alt}, which this scan cannot resolve to a name`);
        continue;
      }
      // A value passed through (`source.feature`, `options.feature`, a
      // parameter): its names are the literals this scan finds where they are written.
      if (/^[a-z_$][\w$]*(\.[\w$]+)*$/.test(alt)) continue;
      out.problems.push(`${rel}:${lineOf(m.index)} passes feature \`${alt}\`, which this scan cannot resolve to a name`);
    }
  }

  for (const name of doorNames) {
    const call = new RegExp(`${name.replace(/[.()'/]/g, '\\$&')}\\s*\\(\\s*\\{`, 'g');
    for (const m of src.matchAll(call)) {
      const obj = objectAt(src, m.index + m[0].length - 1);
      if (!/\bfeature\b/.test(obj)) {
        out.problems.push(`${rel}:${lineOf(m.index)} calls the AI door with no feature, so it is "${groups.UNASSIGNED_FEATURE}", which is in no group`);
      }
    }
  }
  return out;
}

/** The scan's verdict: every problem, plus every feature name no group lists. */
function unassigned(scans) {
  const problems = [];
  for (const [rel, s] of scans) {
    problems.push(...s.problems);
    for (const f of s.features) {
      if (!groups.groupForFeature(f.name)) {
        problems.push(`${rel}:${f.line} asks the AI door as feature "${f.name}", which is in no group in lib/aiFeatureGroups.js`);
      }
    }
  }
  return problems;
}

function scanRepo() {
  const scans = new Map();
  for (const dir of SCAN_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (SKIP_FILES.test(rel) || rel === 'lib/aiClient.js') continue;
      const s = scanSource(rel, fs.readFileSync(file, 'utf8'));
      if (s.doorFile) scans.set(rel, s);
    }
  }
  return scans;
}

// ── The scan ───────────────────────────────────────────────────────────────

test('every feature that asks the AI door is in exactly one group', () => {
  const scans = scanRepo();
  assert.ok(scans.size >= 15, `the scan found only ${scans.size} door files; it has stopped seeing the callers`);
  assert.deepEqual(unassigned(scans), []);
});

test('the scan sees the callers it must: drafters, Acquire, Studio, alt text and ai_try', () => {
  const scans = scanRepo();
  const found = new Set([...scans.values()].flatMap((s) => s.features.map((f) => f.name)));
  for (const name of ['reddit-comment-draft', 'substack-miner-suggest', 'outreach-youtube-creators-suggest',
    'outreach.reddit.subreddit-suggest', 'studio_reel_moments', 'seo_alt_text', 'font-autotag',
    'acquire_content_handler_generate', 'ai-try']) {
    assert.ok(found.has(name), `the scan no longer finds "${name}"`);
  }
});

test('a new generate() call with a feature no group lists fails, naming the file and the feature', () => {
  const src = "const { generate } = require('./aiClient');\nasync function x() {\n  return generate({ feature: 'brand-new-thing', messages: 'hi' });\n}\n";
  const problems = unassigned(new Map([['lib/brandNew.js', scanSource('lib/brandNew.js', src)]]));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^lib\/brandNew\.js:3 .*"brand-new-thing".*no group/);
});

test('a feature named through a constant, or through an alias, is still found', () => {
  const src = "const { generate: door } = require('../aiClient');\nconst FEATURE = 'other-new-thing';\ndoor({ feature: FEATURE, messages: 'x' });\n";
  const problems = unassigned(new Map([['lib/a/b.js', scanSource('lib/a/b.js', src)]]));
  assert.match(problems.join('\n'), /lib\/a\/b\.js:3 .*"other-new-thing"/);
});

test('a door call that names no feature, or names "unknown", counts as unassigned', () => {
  const none = "const aiClient = require('./aiClient');\naiClient.generate({ messages: 'x' });\n";
  assert.match(unassigned(new Map([['lib/n.js', scanSource('lib/n.js', none)]])).join('\n'), /lib\/n\.js:2 .*no feature/);
  const unknown = "const { generate } = require('./aiClient');\ngenerate({ feature: 'unknown', messages: 'x' });\n";
  assert.match(unassigned(new Map([['lib/u.js', scanSource('lib/u.js', unknown)]])).join('\n'), /"unknown".*no group/);
});

test('a file that does not use the door is not a door file', () => {
  const src = "const { queryGemini } = require('./aiClient');\nqueryGemini('s', 'p', { feature: 'legacy' });\n";
  assert.equal(scanSource('lib/old.js', src).doorFile, false);
});

// ── The groups themselves ──────────────────────────────────────────────────

test('the five groups Dane named exist, and "unknown" is in none', () => {
  assert.deepEqual(groups.AI_FEATURE_GROUPS.map((g) => g.label), ['Outreach', 'Studio / Reel Spinner', 'Writing', 'Acquire', 'Everything else']);
  assert.equal(groups.groupForFeature('unknown'), null);
  assert.equal(groups.groupForFeature(''), null);
  assert.equal(groups.groupForFeature('reddit-comment-draft').id, 'outreach');
  assert.equal(groups.groupForFeature('seo_alt_text').id, 'writing');
});

// ── The door follows each group's order ────────────────────────────────────

const ALL = ['anthropic', 'openai', 'gemini', 'kimi'];
function list(order) {
  return order.map((id) => ({ id, enabled: id !== 'kimi', fast: ai.AI_PROVIDERS[id].models.fast, strong: ai.AI_PROVIDERS[id].models.strong }));
}
function settingsWith(groupOrders, mainOrder = ['anthropic', 'openai', 'gemini', 'kimi']) {
  const main = store.validateInput({ providers: list(mainOrder), customProviders: [] }).data;
  const row = { id: 'platform', providers: main.providers, custom_providers: [], group_orders: groupOrders };
  return { ok: true, data: store.normaliseRow(row) };
}

function harness(settings) {
  const sent = [];
  const deps = {
    order: (feature) => ai.getAiProviderOrder({ env: {}, readSettings: async () => settings, feature }),
    getKey: () => 'k',
    recordUsage: async () => {},
    postBus: async () => {},
    fetchImpl: async (url) => {
      sent.push(url);
      if (/openai/.test(url)) return new Response(JSON.stringify({ model: 'gpt-5.4-mini', choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] }), { status: 200 });
      return new Response(JSON.stringify({ model: 'claude-haiku-4-5', content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' }), { status: 200 });
    },
  };
  return { sent, ask: (feature) => ai.generate({ feature, messages: 'hi', tier: 'fast' }, deps) };
}

test('Outreach on its own order (OpenAI first) is answered by OpenAI; Writing, on the main order, by Anthropic', async () => {
  const h = harness(settingsWith({ outreach: list(['openai', 'anthropic', 'gemini', 'kimi']) }));
  const outreach = await h.ask('reddit-comment-draft');
  assert.equal(outreach.provider, 'openai');
  assert.equal(outreach.group, 'outreach');
  assert.equal(outreach.groupLabel, 'Outreach');
  assert.equal(outreach.orderUsed, 'group');
  const writing = await h.ask('seo_alt_text');
  assert.equal(writing.provider, 'anthropic');
  assert.equal(writing.group, 'writing');
  assert.equal(writing.orderUsed, 'main');
});

test('a group that follows main uses the main order exactly', async () => {
  const settings = settingsWith({ outreach: null }, ['gemini', 'openai', 'anthropic', 'kimi']);
  const main = await ai.getAiProviderOrder({ env: {}, readSettings: async () => settings });
  for (const feature of ['reddit-comment-draft', 'studio_reel_moments', 'seo_alt_text', 'acquire_content_handler_generate', 'ai-try']) {
    const g = await ai.getAiProviderOrder({ env: {}, readSettings: async () => settings, feature });
    assert.equal(g.orderUsed, 'main', feature);
    assert.deepEqual(g.providers, main.providers, feature);
    assert.equal(g.groupNote, undefined, feature);
  }
});

test('the column not there yet (SQL not run) means every group follows main, with no complaint', async () => {
  const main = store.validateInput({ providers: list(ALL), customProviders: [] }).data;
  const settings = { ok: true, data: store.normaliseRow({ id: 'platform', providers: main.providers, custom_providers: [] }) };
  const g = await ai.getAiProviderOrder({ env: {}, readSettings: async () => settings, feature: 'reddit-comment-draft' });
  assert.equal(g.orderUsed, 'main');
  assert.equal(g.groupNote, undefined);
});

test('an unreadable group setting falls back to the main order and the reply says so', async () => {
  // The group's own entry is damaged.
  const damaged = harness(settingsWith({ outreach: 'openai first please' }));
  const a = await damaged.ask('reddit-comment-draft');
  assert.equal(a.ok, true);
  assert.equal(a.provider, 'anthropic');
  assert.equal(a.orderUsed, 'main');
  assert.match(a.orderNote, /Outreach's own order could not be read .* uses the main order/);

  // The whole row cannot be read: the main order is the environment's, and both are said.
  const gone = harness({ ok: false, error: 'HTTP 500' });
  const b = await gone.ask('reddit-comment-draft');
  assert.equal(b.ok, true);
  assert.equal(b.orderUsed, 'main');
  assert.match(b.orderNote, /could not read whether Outreach has its own order/);
  const direct = await ai.getAiProviderOrder({ env: {}, readSettings: async () => ({ ok: false, error: 'HTTP 500' }), feature: 'reddit-comment-draft' });
  assert.match(direct.fallbackReason, /could not be read \(HTTP 500\)/);
  assert.ok(direct.providers.length > 0, 'never "no providers" because a read failed');
});

test('a group order with nothing usable switched on falls back to main and says so', async () => {
  const settings = settingsWith({ studio: [{ id: 'retired-thing', enabled: true, fast: 'x', strong: 'y' }] });
  const g = await ai.getAiProviderOrder({ env: {}, readSettings: async () => settings, feature: 'studio_reel_moments' });
  assert.equal(g.orderUsed, 'main');
  assert.match(g.groupNote, /Studio \/ Reel Spinner's own order has no provider/);
  assert.equal(g.providers[0].id, 'anthropic');
});

test('a feature in no group uses the main order, never "Everything else"\'s own', async () => {
  const h = harness(settingsWith({ 'everything-else': list(['openai', 'anthropic', 'gemini', 'kimi']) }));
  const r = await h.ask('not-a-listed-feature');
  assert.equal(r.provider, 'anthropic');
  assert.equal(r.group, null);
  assert.match(r.orderNote, /in no feature group/);
  const listed = await h.ask('ai-try');
  assert.equal(listed.provider, 'openai', '"Everything else" can still have its own order for its own members');
});

test('one reading of the row serves every group for the minute', async () => {
  const original = store.readSettings;
  let reads = 0;
  const settings = settingsWith({ outreach: list(['openai', 'anthropic', 'gemini', 'kimi']) });
  require.cache[require.resolve('../../lib/aiProviderSettingsStore')].exports.readSettings = async () => { reads += 1; return settings; };
  try {
    ai.forgetProviderOrder();
    const t0 = 5_000_000;
    const a = await ai.getAiProviderOrder({ now: t0, feature: 'reddit-comment-draft' });
    const b = await ai.getAiProviderOrder({ now: t0 + 1, feature: 'seo_alt_text' });
    assert.equal(reads, 1);
    assert.equal(a.providers[0].id, 'openai');
    assert.equal(b.providers[0].id, 'anthropic');
  } finally {
    require.cache[require.resolve('../../lib/aiProviderSettingsStore')].exports.readSettings = original;
    ai.forgetProviderOrder();
  }
});

// ── Saving a group's order ─────────────────────────────────────────────────

test('group orders: follows-main is null, an own order has the main order\'s shape, unknown groups refused', () => {
  const ok = store.validateGroupOrders({ outreach: list(['openai', 'anthropic', 'gemini', 'kimi']), writing: null });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.outreach[0].id, 'openai');
  assert.equal(ok.data.writing, null);
  assert.equal(ok.data.studio, null, 'a group left out follows main');
  assert.match(store.validateGroupOrders({ marketing: null }).error, /"marketing" is not a feature group/);
  assert.match(store.validateGroupOrders({ outreach: list(['openai', 'anthropic', 'gemini']) }).error, /^Outreach: .*Kimi" is missing/);
  const off = list(ALL).map((p) => ({ ...p, enabled: false }));
  assert.match(store.validateGroupOrders({ outreach: off }).error, /^Outreach: Switch at least one provider on/);
});

test('saving group orders writes only that field (the main order is left alone), with merge-duplicates', async () => {
  const supabase = require('../../lib/supabase');
  const original = supabase.sbQuery;
  let sent = null;
  supabase.sbQuery = async (req) => { sent = req; return { ok: true, data: [] }; };
  try {
    const res = await store.saveGroupOrders({ outreach: list(ALL) }, { projectId: 'p1', userId: 'u1' });
    assert.equal(res.ok, true);
    assert.match(sent.headers.Prefer, /resolution=merge-duplicates/);
    assert.equal('providers' in sent.body, false);
    assert.equal(sent.body.project_id, 'p1');
    assert.equal(sent.body.owner_user_id, 'u1');
    assert.equal(sent.body.group_orders.outreach.length, 4);
  } finally {
    supabase.sbQuery = original;
  }
});
