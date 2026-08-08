'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * A round is four model calls: read the site, choose three directions, then one
 * candidate each. Fable 5 is not fast, and four of those inside one request
 * would blow the serverless ceiling — the 2026-07-22 failure shape, frozen
 * mid-loop with part of the work done and no record of which part (hazard 4.2).
 *
 * So each HTTP request does exactly one call. These tests pin that: the number
 * of steps, the order, that a step's failure stops the round with a message
 * rather than half-finishing it, and that a malformed patch never becomes a
 * candidate row.
 */

const httpPath = require.resolve('../../routes/http.js');
const scopePath = require.resolve('../../lib/requestProjectScope.js');
const limiterPath = require.resolve('../../lib/rateLimiter.js');
const pagesPath = require.resolve('../../lib/builderPagesStore.js');
const themesPath = require.resolve('../../lib/builderThemesStore.js');
const storePath = require.resolve('../../lib/themeWizardStore.js');
const generatorPath = require.resolve('../../lib/themeWizardGenerator.js');
const routePath = require.resolve('../../routes/themeWizard.js');

const GOOD_CANDIDATE = {
  rationale: 'It reads as calm and serious, which suits the audience.',
  primaryColor: '#1f2933',
  backgroundColor: '#f5f7fa',
  typography: {
    fonts: { heading: 'archivo', body: 'inter' },
    colors: { text: '#1f2933', link: '#2b6cb0' },
    scale: { baseSize: 16, ratio: 1.25, baseLineHeight: 1.5 },
  },
};

const DIRECTIONS = [
  { label: 'Cool technical', typeCharacter: 'geometric sans', colorTemperature: 'cool', contrastPhilosophy: 'crisp' },
  { label: 'Warm editorial', typeCharacter: 'humanist serif', colorTemperature: 'warm', contrastPhilosophy: 'soft' },
  { label: 'Near monochrome', typeCharacter: 'condensed', colorTemperature: 'neutral', contrastPhilosophy: 'high' },
];

function stub(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

function loadRoute(overrides = {}) {
  const calls = [];
  const saved = new Map();
  const all = [httpPath, scopePath, limiterPath, pagesPath, themesPath, storePath, generatorPath, routePath];
  for (const p of all) saved.set(p, require.cache[p]);

  const sent = {};
  // The job row lives here so successive advance calls see the previous one's work.
  const job = { id: 'twjob_1', sessionId: 'twiz_1', status: 'queued', error: '', input: { round: 1, parentCandidateId: '', feedback: '', step: 'brief', directions: null, completedSlots: 0, warnings: [] } };
  const session = { id: 'twiz_1', status: 'active', roundCount: 0, tokensSpent: 0, styleBrief: overrides.styleBrief || {}, lockedValues: overrides.lockedValues || {} };
  const candidates = [];

  stub(httpPath, {
    parseJsonBody: async () => overrides.body || {},
    sendOk: (res, status, data) => { sent.ok = { status, data }; },
    sendErr: (res, status, message, extra) => { sent.err = { status, message, code: extra?.code }; },
  });
  stub(scopePath, { requestProjectScope: () => ({ projectId: 'proj_1', userId: 'u1', project: { name: 'Test Co' }, projectIds: ['proj_1'] }) });
  stub(limiterPath, { checkEndpointLimit: () => false, checkLimit: () => false, LIMITS: {} });
  stub(pagesPath, {
    listPages: async () => ({ ok: true, data: [{ id: 'p1', name: 'Home', slug: '/' }] }),
    updatePage: async () => ({ ok: true }),
  });
  stub(themesPath, { createTheme: async () => ({ ok: true, data: {} }) });

  const USAGE = { input_tokens: 100, output_tokens: 50 };
  stub(generatorPath, {
    sumUsage: (usage) => (usage ? (usage.input_tokens || 0) + (usage.output_tokens || 0) : 0),
    buildStyleBrief: async () => { calls.push('buildStyleBrief'); return { ok: true, data: { sector: 'test' }, usage: USAGE }; },
    deriveDirections: async () => { calls.push('deriveDirections'); return { ok: true, data: { directions: DIRECTIONS }, usage: USAGE }; },
    generateCandidate: async () => {
      calls.push('generateCandidate');
      return overrides.candidateResult || { ok: true, data: GOOD_CANDIDATE, usage: USAGE };
    },
  });

  stub(storePath, {
    createJob: async (input) => {
      job.input = input.input;
      job.status = input.status || 'queued';
      return { ok: true, data: JSON.parse(JSON.stringify(job)) };
    },
    getJob: async () => ({ ok: true, data: JSON.parse(JSON.stringify(job)) }),
    updateJob: async (_id, patch) => {
      if (patch.input !== undefined) job.input = patch.input;
      if (patch.status !== undefined) job.status = patch.status;
      if (patch.error !== undefined) job.error = patch.error;
      return { ok: true, data: JSON.parse(JSON.stringify(job)) };
    },
    getSession: async () => ({ ok: true, data: JSON.parse(JSON.stringify(session)) }),
    updateSession: async (_id, patch) => {
      Object.assign(session, patch);
      return { ok: true, data: session };
    },
    listCandidates: async () => ({ ok: true, data: candidates.slice() }),
    getCandidate: async () => ({ ok: true, data: { id: 'twcd_p', themePatch: { primaryColor: '#000000' } } }),
    createCandidate: async (input) => {
      calls.push(`createCandidate:slot${input.slot}`);
      const row = { ...input, id: `twcd_${input.slot}` };
      candidates.push(row);
      return { ok: true, data: row };
    },
  });

  delete require.cache[routePath];
  const route = require(routePath);

  return {
    route, calls, sent, job, session, candidates,
    async advance() {
      sent.ok = undefined; sent.err = undefined;
      await route.handle({ authUser: { id: 'u1' }, headers: {} }, {}, '/api/builder/theme-wizard/jobs/twjob_1/advance', 'POST');
      return { ok: sent.ok, err: sent.err };
    },
    restore() { for (const [p, mod] of saved) { if (mod) require.cache[p] = mod; else delete require.cache[p]; } },
  };
}

test('a full round takes five requests and one model call each', async () => {
  const h = loadRoute();
  try {
    const seen = [];
    const isModelCall = (c) => !c.startsWith('createCandidate');
    for (let i = 0; i < 5; i += 1) {
      const before = h.calls.filter(isModelCall).length;
      const { ok } = await h.advance();
      assert.ok(ok, `step ${i + 1} should succeed`);
      assert.equal(h.calls.filter(isModelCall).length - before, 1,
        `step ${i + 1} must make exactly one model call`);
      seen.push(ok.data.progress.label);
      if (ok.data.done) break;
    }
    assert.deepEqual(h.calls, [
      'buildStyleBrief',
      'deriveDirections',
      'generateCandidate', 'createCandidate:slot1',
      'generateCandidate', 'createCandidate:slot2',
      'generateCandidate', 'createCandidate:slot3',
    ]);
    assert.equal(h.job.status, 'succeeded');
    assert.equal(h.session.roundCount, 1, 'the round only counts once it finished');
    assert.deepEqual(seen, [
      'Choosing three directions',
      'Generating 1 of 3',
      'Generating 2 of 3',
      'Generating 3 of 3',
      'Finished',
    ], 'progress text is derived from real state, not guessed');
  } finally { h.restore(); }
});

test('a site already read skips straight past the brief step', async () => {
  const h = loadRoute({ styleBrief: { sector: 'already known' } });
  try {
    // The route only skips at queue time, so drive generate first.
    await h.route.handle({ authUser: { id: 'u1' }, headers: {} }, {}, '/api/builder/theme-wizard/sessions/twiz_1/generate', 'POST');
    assert.equal(h.sent.ok.data.progress.step, 'directions',
      'the brief describes the site, not the round — re-reading it every round is wasted money');
  } finally { h.restore(); }
});

test('a malformed patch fails the round instead of becoming a candidate', async () => {
  const h = loadRoute({
    candidateResult: { ok: true, data: { rationale: 'x', typography: { fonts: { heading: 'Comic Sans' } } } },
  });
  try {
    await h.advance(); // brief
    await h.advance(); // directions
    const { err } = await h.advance(); // candidate 1

    assert.ok(err, 'a malformed patch must not report success');
    assert.match(err.message, /malformed/);
    assert.match(err.message, /Comic Sans/, 'say which value was wrong');
    assert.equal(h.candidates.length, 0, 'nothing may be saved');
    assert.equal(h.job.status, 'failed');
  } finally { h.restore(); }
});

test('a model failure stops the round on the step that failed', async () => {
  const h = loadRoute({ candidateResult: { ok: false, status: 502, error: 'upstream exploded' } });
  try {
    await h.advance();
    await h.advance();
    const { err } = await h.advance();
    assert.match(err.message, /upstream exploded/);
    assert.equal(h.job.status, 'failed');
    assert.equal(h.job.input.completedSlots, 0, 'a failed slot is not counted as done');
  } finally { h.restore(); }
});

test('pinned values survive a model that ignored them', async () => {
  const h = loadRoute({ lockedValues: { primaryColor: '#1a4d8f' } });
  try {
    await h.advance();
    await h.advance();
    await h.advance();
    assert.equal(h.candidates[0].themePatch.primaryColor, '#1a4d8f',
      'the model returned #1f2933; the lock is a guarantee, not a request');
  } finally { h.restore(); }
});

test('every model call adds its tokens to the session tally', async () => {
  // tokens_spent is what a future cost throttle will read (spec §9). A column
  // that exists and is never written is worse than no column: it reads as
  // "this session was free".
  const h = loadRoute();
  try {
    for (let i = 0; i < 5; i += 1) await h.advance();
    // Five steps, 150 tokens each: brief, directions, three candidates.
    assert.equal(h.session.tokensSpent, 750);
  } finally { h.restore(); }
});

test('advancing a finished round is a no-op rather than a second charge', async () => {
  const h = loadRoute();
  try {
    for (let i = 0; i < 5; i += 1) await h.advance();
    const before = h.calls.length;
    const { ok } = await h.advance();
    assert.equal(ok.data.done, true);
    assert.equal(h.calls.length, before, 'no further model calls');
  } finally { h.restore(); }
});
