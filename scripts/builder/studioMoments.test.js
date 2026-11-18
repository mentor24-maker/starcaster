'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Reel Spinner 2c (SC-828) — the rules that score a recording's best moments.
 *
 * recording.json is REAL: recording e8699ace in the Dane of Earth project, its
 * transcript words and its cut marks exactly as production stores them
 * (fixture header says when and how it was taken). reply.txt is the model's
 * answer in the agreed shape; the tests below bend it to make each bad answer
 * the rules have to catch. No test touches the network: the model call is
 * injected.
 */

const {
  scoreMoments,
  buildPrompt,
  parseAnswer,
  checkAnswer,
  placeMoment,
  momentsConfig,
  NO_BRIEF_REASON,
  DEFAULT_MODEL,
  RULES_VERSION,
  MIN_S,
  MAX_S,
  PROJECTS,
  MOODS,
} = require('../../workers/studio/moments.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'studio-moments');
const recording = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'recording.json'), 'utf8'));
const replyText = fs.readFileSync(path.join(FIXTURE, 'reply.txt'), 'utf8');
const reply = () => parseAnswer(replyText).value;

const BRIEF = {
  text: 'the purpose of this channel is to attract collaborators to my various projects, especially WaveCenter and the DEO movement.',
  fingerprint: 'sha256:fixture-0001',
};
const input = (over = {}) => ({
  words: recording.words,
  marks: recording.marks,
  durationS: recording.durationS,
  brief: BRIEF,
  ...over,
});

const EPS = 0.005;
const wordStarts = new Set(recording.words.map((w) => w.start));
const wordEnds = new Set(recording.words.map((w) => w.end));
const insideCut = (t) => recording.marks.some((m) => t > m.start + EPS && t < m.end - EPS);

/** Every property SC-828's first acceptance line names, for every moment. */
function assertSound(moments) {
  for (const m of moments) {
    const len = m.end_s - m.start_s;
    assert.ok(len >= MIN_S - EPS && len <= MAX_S + EPS, `${m.start_s}-${m.end_s} is ${len} s, outside ${MIN_S}-${MAX_S}`);
    assert.ok(wordStarts.has(m.start_s), `${m.start_s} is not the start of a word`);
    assert.ok(wordEnds.has(m.end_s), `${m.end_s} is not the end of a word`);
    assert.ok(!insideCut(m.start_s), `${m.start_s} starts inside a cut`);
    assert.ok(!insideCut(m.end_s), `${m.end_s} ends inside a cut`);
    assert.ok(m.start_s >= 0 && m.end_s <= recording.durationS + EPS, 'inside the recording');
    assert.ok(PROJECTS.includes(m.project));
    assert.ok(MOODS.includes(m.mood));
  }
}

/** A query stub that records what it was asked and answers `text`. */
function stub(text, extra = {}) {
  const calls = [];
  const query = async (system, user, options) => {
    calls.push({ system, user, options });
    return { ok: true, text, model: DEFAULT_MODEL, usage: { input_tokens: 9000, output_tokens: 1200 }, ...extra };
  };
  return { query, calls };
}

const CONFIG = { model: DEFAULT_MODEL, maxTokens: 8000, timeoutMs: 1000 };

test('the fixture is the real recording it says it is', () => {
  assert.equal(recording.sourceId, 'e8699ace-b192-40f3-b574-110ac98347df');
  assert.equal(recording.words.length, 1877);
  assert.equal(recording.marks.length, 59);
  assert.equal(recording.durationS, 835.65);
});

test('on the real recording every returned moment is 20-60 s, on word boundaries, clear of every cut', async () => {
  const { query } = stub(replyText);
  const res = await scoreMoments(input(), { query, config: CONFIG });
  assert.equal(res.state, 'done', res.reason);
  assert.equal(res.moments.length, 5);
  assertSound(res.moments);
  assert.deepEqual(res.moments.map((m) => m.score), [88, 84, 80, 72, 55], 'best first');
  assert.ok(res.summary.length > 40);
  assert.equal(res.rulesVersion, RULES_VERSION);
});

test('the snapping really moved something: the reply\'s rough times are not word boundaries', () => {
  // Without this, the test above could pass because the fixture reply was
  // already perfect, and the snapping would be untested.
  const rough = reply().moments.filter((m) => !wordStarts.has(m.start_s) || !wordEnds.has(m.end_s));
  assert.ok(rough.length >= 4, 'the reply carries line-level times, as a model would');
});

test('a boundary inside a cut is moved out of it', () => {
  // A start in the middle of a long pause moves forward to the next word.
  const pause = recording.marks.find((m) => m.kind === 'pause' && m.start > 60 && m.end - m.start > 2);
  assert.ok(pause, 'the fixture has a long pause to aim at');
  const inPause = (pause.start + pause.end) / 2;
  const a = placeMoment(inPause, inPause + 40, recording.words, recording.marks, recording.durationS);
  assert.equal(a.ok, true, a.why);
  assert.ok(!insideCut(a.start), `still starts inside the pause at ${pause.start}`);
  assert.ok(a.start >= pause.end - EPS, 'moved forward past the pause');

  // An end in the middle of an "Uh," comes back to the last word clear of it.
  // whisper's clean words overlap this filler ("cue" ends at 68.40, inside
  // 68.06-68.42), so the end lands on the word before.
  const filler = recording.marks.find((m) => m.kind === 'filler' && m.start > 60 && m.start < 700);
  assert.ok(filler, 'the fixture has a filler to aim at');
  const inFiller = (filler.start + filler.end) / 2;
  const b = placeMoment(inFiller - 40, inFiller, recording.words, recording.marks, recording.durationS);
  assert.equal(b.ok, true, b.why);
  assert.ok(!insideCut(b.end), `still ends inside the ${filler.kind} at ${filler.start}`);
  assert.ok(b.end <= filler.start + EPS, 'brought back before the filler');
});

test('a moment past the end of the recording is trimmed, and one starting past it is dropped', () => {
  const answer = reply();
  answer.moments[0].start_s = 800;
  answer.moments[0].end_s = 900; // 64 s past the end
  answer.moments[1].start_s = 850; // starts after 835.65
  answer.moments[1].end_s = 880;
  const res = checkAnswer(answer, input());
  assert.equal(res.ok, true, res.reason);
  assertSound(res.moments);
  const trimmed = res.moments.find((m) => m.score === 88);
  assert.ok(trimmed, 'the over-running moment is kept');
  assert.ok(trimmed.end_s <= recording.durationS, 'and ends inside the recording');
  assert.ok(trimmed.adjusted.some((a) => /trimmed to the end/.test(a)));
  assert.equal(res.moments.find((m) => m.score === 84), undefined, 'the one starting past the end is gone');
  assert.match(res.dropped.find((d) => d.index === 1).why, /after the recording ends/);
});

test('lengths are clamped: too long is shortened, too short is lengthened', () => {
  const answer = reply();
  answer.moments[0].end_s = answer.moments[0].start_s + 120;
  answer.moments[2].end_s = answer.moments[2].start_s + 6;
  const res = checkAnswer(answer, input());
  assert.equal(res.ok, true, res.reason);
  assertSound(res.moments);
  assert.ok(res.moments.find((m) => m.score === 88).adjusted.some((a) => /shortened/.test(a)));
  assert.ok(res.moments.find((m) => m.score === 80).adjusted.some((a) => /lengthened/.test(a)));
});

test('a moment overlapping a better one is dropped, never kept twice', () => {
  const answer = reply();
  answer.moments.push({ ...answer.moments[0], score: 40, start_s: answer.moments[0].start_s + 10 });
  const res = checkAnswer(answer, input());
  assert.equal(res.moments.length, 5);
  assert.match(res.dropped[0].why, /overlaps a better moment/);
});

test('a moment naming a project or mood not on the list is dropped with the reason', () => {
  const answer = reply();
  answer.moments[0].project = 'MrBeast';
  answer.moments[1].mood = 'viral';
  answer.moments[2].project = 'Wave Center'; // the spoken form still lands
  const res = checkAnswer(answer, input());
  assert.equal(res.moments.length, 3);
  assert.match(res.dropped.find((d) => d.index === 0).why, /project not on the list/);
  assert.match(res.dropped.find((d) => d.index === 1).why, /mood not on the list/);
  assert.equal(res.moments.find((m) => m.score === 80).project, 'WaveCenter');
});

test('an invalid answer is a named failure, never an empty list', async () => {
  const cases = [
    ['Sure! Here are some great moments.', /no JSON object/],
    ['{"summary": "x", "moments": [', /not valid JSON/],
    ['{"moments": []}', /no summary/],
    ['{"summary": "A talk.", "moments": "lots"}', /no "moments" list/],
    ['{"summary": "A talk.", "moments": []}', /no moments and gave no reason/],
    [JSON.stringify({ summary: 'A talk.', moments: [{ start_s: 900, end_s: 950, score: 50, reasons: ['x'], project: 'DEO', mood: 'calm', quote: 'x' }] }),
      /none of the 1 moment\(s\) in the answer could be used: #1 starts at 900 s/],
  ];
  for (const [text, expected] of cases) {
    const { query } = stub(text);
    const res = await scoreMoments(input(), { query, config: CONFIG });
    assert.equal(res.state, 'failed', text);
    assert.match(res.reason, expected, text);
    assert.equal(res.moments, undefined, 'a failure carries no moments list at all');
    assert.equal(res.retryable, false);
  }
});

test('an answer cut off at the token limit is a failure, not a short list', async () => {
  const { query } = stub(replyText, { stopReason: 'max_tokens' });
  const res = await scoreMoments(input(), { query, config: CONFIG });
  assert.equal(res.state, 'failed');
  assert.match(res.reason, /cut off at the 8000-token limit/);
});

test('"nothing stands on its own" is only accepted with a reason', async () => {
  const { query } = stub('{"summary": "Dane tests his camera.", "moments": [], "none_reason": "Seven words of checking the microphone."}');
  const res = await scoreMoments(input(), { query, config: CONFIG });
  assert.equal(res.state, 'done');
  assert.deepEqual(res.moments, []);
  assert.equal(res.noneReason, 'Seven words of checking the microphone.');
});

test('the prompt carries the brief word for word, and the fingerprint comes back with the result', async () => {
  const { query, calls } = stub(replyText);
  const res = await scoreMoments(input(), { query, config: CONFIG });
  assert.equal(calls.length, 1);
  assert.ok(calls[0].system.includes(BRIEF.text), 'brief text verbatim in the prompt');
  assert.equal(res.briefFingerprint, BRIEF.fingerprint);
  // The transcript and the cuts are in it too, with their times.
  assert.match(calls[0].user, /\[3\.98-[\d.]+\] i just wanted to take a few minutes/);
  assert.match(calls[0].user, /\[0\.00-3\.44\] pause/);
  assert.match(calls[0].system, /Do NOT score for mass appeal/);
});

test('an empty brief is refused with the named reason and never sent to the model', async () => {
  for (const brief of [{ text: '', fingerprint: 'x' }, { text: '   \n', fingerprint: 'x' }, undefined, null]) {
    const { query, calls } = stub(replyText);
    const res = await scoreMoments(input({ brief }), { query, config: CONFIG });
    assert.equal(res.state, 'failed');
    assert.equal(res.reason, NO_BRIEF_REASON);
    assert.equal(res.reason, 'no Reel Spinner notes switched on in this project');
    assert.equal(calls.length, 0, 'never scored against nothing');
  }
});

test('a brief without a fingerprint is refused, because a later edit could not be detected', async () => {
  const { query, calls } = stub(replyText);
  const res = await scoreMoments(input({ brief: { text: BRIEF.text } }), { query, config: CONFIG });
  assert.equal(res.state, 'failed');
  assert.match(res.reason, /without a fingerprint/);
  assert.equal(calls.length, 0);
});

test('a failed call is a retryable failure naming the model', async () => {
  const query = async () => ({ ok: false, error: 'Your credit balance is too low' });
  const res = await scoreMoments(input(), { query, config: CONFIG });
  assert.equal(res.state, 'failed');
  assert.equal(res.retryable, true);
  assert.match(res.reason, /claude-sonnet-5-5 failed: Your credit balance is too low/);
  const thrown = await scoreMoments(input(), { query: async () => { throw new Error('socket hang up'); }, config: CONFIG });
  assert.equal(thrown.retryable, true);
  assert.match(thrown.reason, /socket hang up/);
});

test('model and token limit come from configuration, defaulting to the current Sonnet', async () => {
  assert.deepEqual(momentsConfig({}), { model: 'claude-sonnet-5-5', maxTokens: 8000, timeoutMs: 180000 });
  const set = momentsConfig({ STUDIO_MOMENTS_MODEL: 'claude-opus-5-5', STUDIO_MOMENTS_MAX_TOKENS: '12000' });
  assert.equal(set.model, 'claude-opus-5-5');
  assert.equal(set.maxTokens, 12000);
  assert.equal(momentsConfig({ STUDIO_MOMENTS_MAX_TOKENS: 'lots' }).maxTokens, 8000);
  assert.notEqual(DEFAULT_MODEL, 'claude-opus-4-8', 'never the retired default in lib/aiClient.js');

  const { query, calls } = stub(replyText);
  await scoreMoments(input(), { query, config: set });
  assert.equal(calls[0].options.anthropicModel, 'claude-opus-5-5');
  assert.equal(calls[0].options.maxTokens, 12000);
  assert.equal(calls[0].options.feature, 'studio_reel_moments');
});

test('buildPrompt lists no cuts as "none" rather than an empty heading', () => {
  const { user } = buildPrompt({ words: recording.words, marks: [], brief: BRIEF, durationS: recording.durationS });
  assert.match(user, /CUTS: none\./);
});
