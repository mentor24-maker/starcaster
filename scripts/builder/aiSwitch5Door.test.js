'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/**
 * SC-847 (AI switch 5): the last hand-written AI calls go through the AI door.
 *
 * Messaging content suggestions (short options, long drafts, topic groups),
 * the format transformer, the web-page keyword and tag imports, the website
 * peer classifier and the contact persona synthesis each called Anthropic or
 * Gemini by hand. They now call generate() (lib/aiClient.js), which uses
 * whichever provider comes first on Settings › APIs › AI provider.
 *
 * Each feature is driven here through the REAL door, with the network replaced
 * by a recorded reply from Anthropic and then from OpenAI. Whichever answers,
 * the feature must get a usable result out of it, ask for the model of its
 * tier, and be metered under its own name.
 *
 * Then `npm run check:ai-door`, which stops the next hand-written call.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const aiClient = require('../../lib/aiClient');

// The project's writing rules live in the database; none are needed here.
const trainingPath = require.resolve('../../lib/trainingStore');
require.cache[trainingPath] = {
  id: trainingPath, filename: trainingPath, loaded: true,
  exports: { getTrainingPromptConfig: async () => ({ context: '', guidelines: '' }) },
};

const realGenerate = aiClient.generate;
let calls = [];
let metered = [];
let firstProvider = 'anthropic';
let replyText = '';

function anthropicReply(text, model) {
  return { model, content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } };
}
function openaiReply(text, model) {
  return { model, choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
}

const doorDeps = () => ({
  fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const json = url.includes('anthropic.com') ? anthropicReply(replyText, body.model) : openaiReply(replyText, body.model);
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
  },
  recordUsage: async (entry) => { metered.push(entry); },
  postBus: async () => ({ ok: true }),
  getKey: () => 'test-key',
  order: () => aiClient.getAiProviderOrder({
    env: { AI_PROVIDER_ORDER: firstProvider === 'anthropic' ? 'anthropic,openai' : 'openai,anthropic' },
    readSettings: async () => ({ ok: true, data: { exists: false } }),
  }),
  now: () => 0,
});
// Every moved file calls aiClient.generate at call time, so this reaches them all.
aiClient.generate = (opts) => realGenerate(opts, doorDeps());

const suggestions = require('../../lib/messagingContentSuggestions');
const { transformContent } = require('../../lib/messagingFormatTransformer');
const { getFormatSpec } = require('../../lib/messagingFormatRegistry');
const keywordImport = require('../../lib/webPageKeywordImport');
const tagImport = require('../../lib/webPageTagImport');
const peers = require('../../lib/websitePeerClassifier');

test.after(() => {
  aiClient.generate = realGenerate;
  aiClient._resetNoticeMemory();
  delete require.cache[trainingPath];
});

const SCOPE = { projectId: 'p1' };
const MODELS = {
  anthropic: { fast: 'claude-haiku-5-5', strong: 'claude-sonnet-5-5' },
  openai: { fast: 'gpt-5.4-mini', strong: 'gpt-5.5' },
};
const PAGE = { title: 'Junior tennis', content: 'Coaching for juniors at the Delray Beach Tennis Center, every weekday after school.' };

const FEATURES = [
  {
    feature: 'messaging_content_short',
    tier: 'strong',
    json: true,
    reply: '{"options":["Serve up summer","Rally with the best"]}',
    run: () => suggestions.generateMessagingContentSuggestions({ format: 'Headlines', topic: 'Summer camp' }, SCOPE),
    sent: ['Summer camp', 'sharp marketing content options'],
    usable: (out) => {
      assert.equal(out.ok, true, out.error);
      assert.deepEqual(out.data.options, ['Serve up summer', 'Rally with the best']);
    },
  },
  {
    feature: 'messaging_content_long',
    tier: 'strong',
    json: true,
    reply: '{"title":"Why juniors play","subtitle":"","body":"Long body text about coaching juniors."}',
    run: () => suggestions.generateMessagingContentSuggestions({ format: 'Articles', topic: 'Juniors' }, SCOPE),
    sent: ['Juniors', 'publication-ready'],
    usable: (out) => {
      assert.equal(out.ok, true, out.error);
      assert.equal(out.data.kind, 'long');
      assert.ok(out.data.draft, 'a draft');
    },
  },
  {
    feature: 'messaging_topic_suggestions',
    tier: 'strong',
    json: true,
    reply: '{"groups":[{"label":"Programs","topics":["Junior camps","Adult clinics"]}]}',
    run: () => suggestions.generateMessagingTopicSuggestions({ website_data: { source_url: 'https://example.com', keywords: [], pages: [] } }, SCOPE),
    sent: ['information architect'],
    usable: (out) => {
      assert.equal(out.ok, true, out.error);
      assert.equal(out.data.total_topics, 2);
    },
  },
  {
    feature: 'messaging_format_transform',
    tier: 'strong',
    reply: '#tennis\n#juniors\nnot a tag',
    run: () => transformContent('Our junior camp opens Monday.', getFormatSpec('tweet'), getFormatSpec('hashtag')),
    sent: ['Our junior camp opens Monday.', 'Output hashtags only'],
    usable: (out) => {
      assert.equal(out.ok, true, out.error);
      assert.deepEqual(out.content.split('\n'), ['#tennis', '#juniors']);
    },
  },
  {
    // SC-847 review: the long-form target parses strict JSON, so it asks the
    // door for JSON mode the way the suggestions do.
    feature: 'messaging_format_transform',
    tier: 'strong',
    json: true,
    reply: '{"title":"Junior camp opens Monday","content":"Our junior camp opens Monday at Delray."}',
    run: () => transformContent('Our junior camp opens Monday.', getFormatSpec('tweet'), getFormatSpec('article')),
    sent: ['Our junior camp opens Monday.', 'strict JSON only'],
    usable: (out) => {
      assert.equal(out.ok, true, out.error);
      assert.equal(out.title, 'Junior camp opens Monday');
      assert.equal(out.content, 'Our junior camp opens Monday at Delray.');
    },
  },
  {
    feature: 'webpage_keyword_import',
    tier: 'strong',
    reply: 'junior tennis\ntennis coaching\n1. delray beach',
    run: () => keywordImport.distillKeywordsFromWebPage(PAGE, SCOPE),
    sent: ['Coaching for juniors', 'extract search keywords'],
    usable: (out) => {
      assert.equal(out.ok, true, out.error);
      assert.deepEqual(out.keywords, ['junior tennis', 'tennis coaching', 'delray beach']);
    },
  },
  {
    feature: 'webpage_tag_import',
    tier: 'strong',
    reply: 'Junior Tennis\nCoaching',
    run: () => tagImport.distillTagsFromWebPage(PAGE, SCOPE),
    sent: ['Coaching for juniors', 'plain content tags'],
    usable: (out) => {
      assert.equal(out.ok, true, out.error);
      assert.deepEqual(out.tags, ['Junior Tennis', 'Coaching']);
    },
  },
  {
    feature: 'website_peer_classification',
    tier: 'fast',
    json: true,
    reply: '{"classifications":[{"domain":"rivalclub.com","website_model":"Direct Competitors","suggested_reference_role":"peer","confidence":0.9,"rationale":"same service"}]}',
    run: () => peers.classifyCandidateBatch([{ domain: 'rivalclub.com', title: 'Rival Club' }], { project: {}, taxonomy: {}, examples: [] }, SCOPE),
    sent: ['rivalclub.com', 'You classify discovered websites'],
    usable: (out) => {
      assert.equal(out.ok, true, out.error);
      assert.equal(out.classifications[0].domain, 'rivalclub.com');
      assert.equal(out.classifications[0].website_model, 'Direct Competitors');
      assert.equal(out.tokens, 15, 'the tokens the provider reported');
    },
  },
];

for (const f of FEATURES) {
  for (const provider of ['anthropic', 'openai']) {
    test(`${f.feature}: a usable result when ${provider} answers`, async () => {
      calls = [];
      metered = [];
      firstProvider = provider;
      replyText = f.reply;
      aiClient._resetNoticeMemory();
      const out = await f.run();
      f.usable(out);
      assert.equal(calls.length, 1, 'one request, to the first provider');
      assert.equal(calls[0].url.includes('anthropic.com') ? 'anthropic' : 'openai', provider);
      assert.equal(calls[0].body.model, MODELS[provider][f.tier], `the ${f.tier} model`);
      for (const refused of ['temperature', 'top_p', 'top_k']) assert.equal(refused in calls[0].body, false, refused);
      const sent = JSON.stringify(calls[0].body);
      for (const words of f.sent) assert.ok(sent.includes(words), `${words} in the request`);
      // A feature that parses JSON asks the door for JSON, so OpenAI's JSON mode is on.
      if (provider === 'openai') assert.equal(calls[0].body.response_format?.type === 'json_object', Boolean(f.json), 'JSON mode');
      assert.equal(metered.length, 1);
      assert.equal(metered[0].feature, f.feature, 'metered under the feature');
      assert.equal(metered[0].provider, provider, 'metered under the provider that answered');
    });
  }
}

test('a door with no provider is reported, never read as an empty answer', async () => {
  const saved = aiClient.generate;
  aiClient.generate = (opts) => realGenerate(opts, { ...doorDeps(), getKey: () => '' });
  try {
    const out = await suggestions.generateMessagingContentSuggestions({ format: 'Headlines', topic: 'x' }, SCOPE);
    assert.equal(out.ok, false);
    assert.equal(out.status, 400, 'nothing is set up: the same 400 a missing key gave');
    assert.match(out.error, /No AI provider could answer/);
    const tags = await tagImport.distillTagsFromWebPage(PAGE, SCOPE);
    assert.equal(tags.ok, false);
    assert.equal(tags.code, 'no_provider');
  } finally {
    aiClient.generate = saved;
  }
});

test('the peer classifier stops after the first batch when nothing can answer', async () => {
  const saved = aiClient.generate;
  let asked = 0;
  aiClient.generate = async () => { asked += 1; return { ok: false, code: 'no_provider', error: 'No AI provider is set up.', skipped: [] }; };
  const prevProvider = process.env.PEER_CLASSIFICATION_PROVIDER;
  const prevKey = process.env.OPENAI_API_KEY;
  process.env.PEER_CLASSIFICATION_PROVIDER = 'gemini';
  process.env.OPENAI_API_KEY = 'test-key';
  try {
    const candidates = Array.from({ length: peers.BATCH_SIZE * 3 }, (_, i) => ({ domain: `site${i}.com` }));
    const { results, meta } = await peers.applyHybridClassification(candidates, { scope: SCOPE });
    assert.equal(asked, 1, 'one batch asked, not three');
    assert.equal(results.length, candidates.length, 'every site still classified, by the heuristic');
    assert.deepEqual(meta.errors, ['No AI provider is set up.']);
  } finally {
    aiClient.generate = saved;
    if (prevProvider === undefined) delete process.env.PEER_CLASSIFICATION_PROVIDER; else process.env.PEER_CLASSIFICATION_PROVIDER = prevProvider;
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = prevKey;
  }
});

test('the contact persona synthesis asks the door, never a provider by name', () => {
  const source = fs.readFileSync(path.join(ROOT, 'routes/contacts.js'), 'utf8');
  const block = source.slice(source.indexOf('RAW CONTACT MATRIX'), source.indexOf('Step 4: Inject Synthesized Persona'));
  assert.match(block, /aiClient\.generate\(\{/);
  assert.match(block, /feature: 'contact_persona_synthesis'/);
  assert.doesNotMatch(block, /queryGemini|queryAnthropic|queryOpenAI/);
});

// ── npm run check:ai-door ──────────────────────────────────────────────────

const { findViolations, ALLOWED, WAITING, SKIP_FILES } = require('../check_ai_door.cjs');

function tempRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-door-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test('check:ai-door passes on this repository as it stands', () => {
  assert.deepEqual(findViolations(ROOT), []);
});

test('check:ai-door names a hand-written call to any provider, file and line', () => {
  const dir = tempRepo({
    'lib/a.js': "const x = 1;\nfetch('https://api.anthropic.com/v1/messages', {});\n",
    'lib/sub/b.js': "await fetch('https://api.openai.com/v1/chat/completions');\n",
    'routes/c.js': 'const u = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;\n',
    'lib/d.js': "await fetch('https://api.moonshot.ai/v1/chat/completions');\n",
    'lib/e.js': "const { Anthropic } = require('@anthropic-ai/sdk');\n",
  });
  const found = findViolations(dir).map((f) => `${f.rel}:${f.line}`).sort();
  assert.deepEqual(found, ['lib/a.js:2', 'lib/d.js:1', 'lib/e.js:1', 'lib/sub/b.js:1', 'routes/c.js:1']);
});

test('check:ai-door names a one-provider helper used outside the door, import or call', () => {
  // SC-847 review: lib/wyrTweetOcr.js called queryGemini, which names no
  // address, and the check printed "every AI call goes through the door".
  const dir = tempRepo({
    'lib/a.js': "const { queryGemini } = require('./aiClient');\nawait queryGemini(sys, msgs);\n",
    'lib/b.js': "const ai = require('./aiClient');\nconst r = await ai.queryAnthropic(sys, msgs);\n",
    'routes/c.js': "const {\n  queryOpenAI,\n} = require('../lib/aiClient');\n",
    'lib/d.js': "aiClient['queryKimi'](s, m);\n",
    'lib/comment.js': "// queryGemini() forces JSON, so this file uses generate()\n * see queryAnthropic()\nconst x = 1;\n",
    'lib/aiClient.js': "async function queryGemini() {}\nmodule.exports = { queryGemini };\n",
  });
  const found = findViolations(dir).map((f) => `${f.rel}:${f.line}`).sort();
  assert.deepEqual(found, ['lib/a.js:1', 'lib/a.js:2', 'lib/b.js:2', 'lib/d.js:1', 'routes/c.js:2']);
});

// Runs the real command against a temporary tree. Break-test files are planted
// there, never in this repository's lib/: node --test runs test files in
// parallel, and another repo-scanning test could list a planted file mid-run
// (SC-847 review, 2026-11-19).
function runCheck(root) {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/check_ai_door.cjs'), '--root', root], { stdio: 'pipe' });
    return { status: 0, stdout: String(out), stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: String(err.stdout), stderr: String(err.stderr) };
  }
}

test('check:ai-door fails the command on a one-provider helper in a lib file', () => {
  // Break test: the old helper, no address in sight.
  const dir = tempRepo({ 'lib/planted.js': "const { queryAnthropic } = require('./aiClient');\n" });
  const run = runCheck(dir);
  assert.equal(run.status, 1, 'the check must fail');
  assert.match(run.stderr, /lib\/planted\.js:1 {2}names the one-provider helper queryAnthropic/);
  assert.match(run.stderr, /generate\(\)/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('check:ai-door passes the same tree once the planted call is gone', () => {
  const dir = tempRepo({ 'lib/planted.js': "const aiClient = require('./aiClient');\n" });
  assert.equal(runCheck(dir).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('check:ai-door says it could not read a --root that does not exist, exit 2', () => {
  const run = runCheck(path.join(os.tmpdir(), 'ai-door-no-such-folder-' + process.pid));
  assert.equal(run.status, 2);
  assert.match(run.stderr, /cannot read --root/);
});

test('the passing line never claims every call goes through the door while files still wait', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/check_ai_door.cjs')], { cwd: ROOT }).toString();
  if (WAITING.size) {
    assert.match(out, new RegExp(`except the ${WAITING.size} file\\(s\\) still waiting`));
    for (const rel of WAITING.keys()) assert.ok(out.includes(`waiting  ${rel}`), `${rel} is printed`);
  }
});

test('the flyer upload and the Would You Rather image reader go through the door, not round it (SC-896)', () => {
  for (const rel of ['lib/eventHarvest.js', 'lib/wyrTweetOcr.js']) {
    assert.equal(WAITING.has(rel), false, `${rel} is off the waiting list`);
    assert.equal(ALLOWED.has(rel), false, `${rel} is not exempt either`);
    const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(source, /aiClient\.generate\(\{/, `${rel} asks the door`);
    assert.doesNotMatch(source, /@anthropic-ai\/sdk|api\.anthropic\.com|claude-[a-z]|queryGemini\(|gemini-2/, `${rel} names no provider, SDK or model`);
  }
});

test('check:ai-door lets the door, the key checks and model listing through', () => {
  const dir = tempRepo({
    'lib/aiClient.js': "fetch('https://api.anthropic.com/v1/messages');\n",
    'lib/aiKeys.js': "fetch('https://api.openai.com/v1/chat/completions');\n",
    'lib/other.js': "fetch('https://api.anthropic.com/v1/models');\nfetch('https://api.openai.com/v1/embeddings');\n",
    'lib/x.test.js': "fetch('https://api.anthropic.com/v1/messages');\n",
    'lib/builder/template.js': "fetch('https://api.anthropic.com/v1/messages');\n",
    'lib/builder/email-render.js': "fetch('https://api.anthropic.com/v1/messages');\n",
    'lib/site-import/dist/run.js': "fetch('https://api.anthropic.com/v1/messages');\n",
  });
  assert.deepEqual(findViolations(dir), []);
});

test('check:ai-door reads the hand-written files in lib/builder, skipping only the generated ones', () => {
  // SC-847 review: the whole folder was skipped, so a direct call in the
  // committed lib/builder/document.js passed unread.
  const dir = tempRepo({
    'lib/builder/document.js': "fetch('https://api.anthropic.com/v1/messages');\n",
    'lib/builder/index.js': "const { queryOpenAI } = require('../aiClient');\n",
    'lib/builder/template.js': "fetch('https://api.anthropic.com/v1/messages');\n",
  });
  const found = findViolations(dir).map((f) => `${f.rel}:${f.line}`).sort();
  assert.deepEqual(found, ['lib/builder/document.js:1', 'lib/builder/index.js:1']);
});

test('every generated file the check skips is gitignored, so nothing hand-written hides behind the list', () => {
  for (const rel of SKIP_FILES) {
    let ignored = true;
    try {
      execFileSync('git', ['check-ignore', '-q', rel], { cwd: ROOT, stdio: 'pipe' });
    } catch {
      ignored = false;
    }
    assert.ok(ignored, `${rel} is on the skip list but is not a gitignored build artifact`);
  }
});

test('check:ai-door fails the command, naming the file and saying to use generate()', () => {
  // Break test: a hand-written call in a lib file.
  const dir = tempRepo({ 'lib/planted.js': "fetch('https://api.anthropic.com/v1/messages', {});\n" });
  const run = runCheck(dir);
  assert.equal(run.status, 1, 'the check must fail');
  assert.match(run.stderr, /lib\/planted\.js:1/);
  assert.match(run.stderr, /generate\(\)/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('every exception on the list says why and still exists', () => {
  for (const [rel, why] of [...ALLOWED, ...WAITING]) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} is gone: take it off the list`);
    assert.ok(String(why).length > 10, `${rel} needs its reason`);
  }
  for (const [rel, why] of WAITING) assert.match(why, /SC-\d+/, `${rel} names the ticket that moves it`);
});
