'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Reel Spinner 4a (SC-833) — the rules that turn cut marks into an edit list.
 *
 * On the SAME real fixture as 2c (scripts/builder/fixtures/studio-moments/):
 * recording e8699ace's transcript words and cut marks exactly as production
 * stores them, and 2c's moments as checkAnswer makes them from the fixture
 * reply. Small made-up recordings are used only where the real one has no
 * example of a rule (a lead-in after a pause, a sliver with a word in it).
 */

const {
  planEdits,
  fullEdit,
  shortEdit,
  editListConfig,
  soundingWords,
  keepRanges,
  soundSource,
  DEFAULT_SHORT_MIN_SCORE,
  DEFAULT_SHORTS_PER_RECORDING,
  LEAD_IN_S,
  SLIVER_S,
} = require('../../workers/studio/editList.js');
const { parseAnswer, checkAnswer } = require('../../workers/studio/moments.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'studio-moments');
const recording = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'recording.json'), 'utf8'));
const reply = parseAnswer(fs.readFileSync(path.join(FIXTURE, 'reply.txt'), 'utf8')).value;
const moments = checkAnswer(reply, recording).moments;

const EPS = 0.005;
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const CONFIG = { minShortScore: 60, shortsPerRecording: 3 };

const input = (over = {}) => ({
  words: recording.words,
  marks: recording.marks,
  durationS: recording.durationS,
  fps: 30,
  sourceId: recording.sourceId,
  moments,
  ...over,
});

const sum = (ranges) => ranges.reduce((s, r) => s + (r.end - r.start), 0);
const sounding = soundingWords(recording.words, recording.marks);
const insideSoundingWord = (t) => sounding.find((w) => t > w.start + EPS && t < w.end - EPS);
const insideRawWord = (t) => recording.words.find((w) => t > w.start + EPS && t < w.end - EPS);
const inAMark = (t) => recording.marks.some((m) => t >= m.start - EPS && t <= m.end + EPS);

function assertOrdered(edit) {
  let at = edit.startS - EPS;
  for (const r of edit.ranges) {
    assert.ok(r.start >= at, `range ${r.start}-${r.end} overlaps or is out of order`);
    assert.ok(r.end > r.start, `range ${r.start}-${r.end} is empty`);
    at = r.end;
  }
  assert.ok(at <= edit.endS + EPS, 'a range runs past the edit');
}

test('full edit: kept length + cut length = the recording length', () => {
  const full = fullEdit(input());
  assertOrdered(full);
  assert.equal(full.startS, 0);
  assert.equal(full.endS, recording.durationS);
  assert.ok(Math.abs(full.keptS + full.cutS - recording.durationS) < 0.002, `${full.keptS} + ${full.cutS} != ${recording.durationS}`);
  assert.ok(Math.abs(sum(full.ranges) - full.keptS) < 0.002, 'keptS is not the sum of the ranges');
  assert.equal(full.savedS, full.cutS);
  // 1b says these marks take out 83.295 s. The one 0.02 s cut (a repeated
  // "and") is shorter than a frame at 30 fps, so it cannot be rendered and is
  // joined over: the edit saves that much less, and says it merged one.
  assert.equal(full.tidy.merged, 1);
  assert.ok(Math.abs(full.cutS - (recording.cutS - 0.02)) < 0.002, `cut ${full.cutS}, expected ${recording.cutS - 0.02}`);
});

test('a short: kept length + cut length = the short\'s span', () => {
  for (const s of planEdits(input(), { config: CONFIG }).shorts) {
    assertOrdered(s);
    assert.ok(Math.abs(s.keptS + s.cutS - s.spanS) < 0.002, `${s.keptS} + ${s.cutS} != ${s.spanS}`);
    assert.ok(s.startS <= s.moment.startS + EPS && s.endS >= s.moment.endS - EPS, 'a short lost part of its moment');
  }
});

test('no range starts or ends inside a word, on the full edit and every short', () => {
  const plan = planEdits(input(), { config: CONFIG });
  let rawInside = 0;
  for (const edit of [plan.full, ...plan.shorts]) {
    for (const r of edit.ranges) {
      for (const t of [r.start, r.end]) {
        const w = insideSoundingWord(t);
        assert.equal(w, undefined, `${edit.kind} boundary ${t} is inside "${w && w.word}" (${w && w.start}-${w && w.end})`);
        // And independently of that rule: a boundary is either an end of the
        // edit or inside a stretch 1b marked as silence or an extra.
        if (t > edit.startS + EPS && t < edit.endS - EPS) assert.ok(inAMark(t), `${edit.kind} boundary ${t} is not in any cut mark`);
        if (insideRawWord(t)) rawInside += 1;
      }
    }
  }
  // Why "inside a word" has to mean where a word SOUNDS: by whisper's raw
  // times, which stretch a word across the pause after it, most of these
  // boundaries would read as mid-word. If this ever drops to zero, whisper's
  // times have changed and the rule in soundingWords should be revisited.
  assert.ok(rawInside > 20, `only ${rawInside} boundaries inside raw whisper spans`);
});

test('soundingWords takes a pause off a word whisper stretched across it', () => {
  // whisper: "to" 5.90-7.82; 1b: a pause 6.162-7.733 (a 1.57 s silence).
  const to = recording.words.find((w) => w.start === 5.9);
  assert.equal(to.end, 7.82);
  const heard = sounding.find((w) => w.start === 5.9);
  assert.ok(heard.end < 6.2, `"to" still sounds until ${heard.end}`);
});

test('a short\'s lead-in reaches back into a pause but never into the word before', () => {
  const words = [
    { start: 0.5, end: 1.0, word: 'before' },
    { start: 3.0, end: 3.4, word: 'moment' },
    { start: 3.4, end: 25.0, word: 'speech' },
    { start: 25.08, end: 25.5, word: 'after' },
  ];
  // A 2 s silence between "before" and "moment", shortened to 0.5 s by 1b.
  const marks = [{ start: 1.0, end: 3.0, kind: 'pause', keep_s: 0.5 }];
  const s = shortEdit({ words, marks, durationS: 30 }, { start_s: 3.0, end_s: 25.0, score: 90 });
  assert.equal(s.leadInS, LEAD_IN_S, 'the quarter second the pause keeps is the lead-in');
  assert.equal(s.startS, 2.75);
  assert.ok(s.startS >= 1.0, 'reached back into "before"');
  assert.equal(s.endS, 25.08, 'the lead-out stops where "after" starts');
  assert.equal(s.leadOutS, 0.08);

  // No pause at all: "before" ends 0.1 s before the moment, so that is the lead-in.
  const tight = shortEdit({ words: [{ start: 2.0, end: 2.9, word: 'before' }, ...words.slice(1)], marks: [], durationS: 30 },
    { start_s: 3.0, end_s: 25.0, score: 90 });
  assert.equal(tight.startS, 2.9);
});

test('ranges closer than a frame are joined; a sliver goes unless a word sounds in it', () => {
  const window = { start: 0, end: 10 };
  const frame = { frameS: 1 / 30, sounding: [] };
  const merged = keepRanges(window, [{ start: 4, end: 4.02 }], frame);
  assert.deepEqual(merged.ranges, [{ start: 0, end: 10 }]);
  assert.equal(merged.merged, 1);
  // 0.03 s is still under a 30 fps frame (0.0333 s), so it is joined too.
  const nearFrame = keepRanges(window, [{ start: 4, end: 4.03 }], frame);
  assert.deepEqual(nearFrame.ranges, [{ start: 0, end: 10 }]);
  assert.equal(nearFrame.merged, 1);
  // A cut of two frames is real, and stays.
  const twoFrames = keepRanges(window, [{ start: 4, end: 4.067 }], frame);
  assert.equal(twoFrames.ranges.length, 2);
  assert.equal(twoFrames.merged, 0);

  const cuts = [{ start: 4, end: 5 }, { start: 5.1, end: 6 }]; // leaves 5.0-5.1
  const silent = keepRanges(window, cuts, frame);
  assert.deepEqual(silent.ranges, [{ start: 0, end: 4 }, { start: 6, end: 10 }]);
  assert.equal(silent.droppedSlivers, 1);

  const spoken = keepRanges(window, cuts, { ...frame, sounding: [{ start: 5.0, end: 5.1, word: 'no' }] });
  assert.deepEqual(spoken.ranges, [{ start: 0, end: 4 }, { start: 5, end: 5.1 }, { start: 6, end: 10 }]);
  assert.equal(spoken.keptSlivers, 1);
  assert.ok(0.1 < SLIVER_S);
});

test('a paired recording\'s sound ranges are shifted by exactly the offset', () => {
  const pair = { sourceAId: A, sourceBId: B, offsetS: 2.345, status: 'done', audioSourceId: B, chosenBy: 'measured' };

  // B started 2.345 s after A, so A's clock reads 2.345 s more than B's.
  const asA = shortEdit(input({ sourceId: A, pair, otherDurationS: 2000 }), moments[0]);
  assert.equal(asA.sound.sourceId, B);
  assert.equal(asA.sound.shiftS, -2.345);
  asA.ranges.forEach((r, i) => {
    const s = asA.sound.ranges[i];
    assert.ok(Math.abs(s.start - (r.start - 2.345)) < 1e-9 && Math.abs(s.end - (r.end - 2.345)) < 1e-9, `range ${i} not shifted by -2.345`);
  });

  const later = { ...pair, offsetS: -2.345 }; // B started first
  const asA2 = fullEdit(input({ sourceId: A, pair: later, otherDurationS: 2000 }));
  assert.equal(asA2.sound.sourceId, B);
  assert.equal(asA2.sound.shiftS, 2.345);
  asA2.ranges.forEach((r, i) => {
    const s = asA2.sound.ranges[i];
    assert.ok(Math.abs(s.start - r.start - 2.345) < 1e-9 && Math.abs(s.end - r.end - 2.345) < 1e-9, `range ${i} not shifted by 2.345`);
  });

  const asB = fullEdit(input({ sourceId: B, pair: { ...pair, audioSourceId: A }, otherDurationS: 2000 }));
  assert.equal(asB.sound.sourceId, A);
  assert.equal(asB.sound.shiftS, 2.345);
  asB.ranges.forEach((r, i) => {
    assert.ok(Math.abs(asB.sound.ranges[i].start - (r.start + 2.345)) < 1e-9, `range ${i} not shifted`);
  });
});

test('the recording that started first still gets the paired sound on its full edit', () => {
  // The full edit opens on the quarter second of pause every recording keeps
  // (0-0.25 s). B started 2.345 s after A, so B has nothing there — but no
  // word sounds there either, so that silence is trimmed, not the pairing.
  const pair = { sourceAId: A, sourceBId: B, offsetS: 2.345, status: 'done', audioSourceId: B, chosenBy: 'measured' };
  const own = fullEdit(input({ sourceId: A }));
  const full = fullEdit(input({ sourceId: A, pair, otherDurationS: 2000 }));
  assert.equal(full.sound.sourceId, B);
  assert.equal(full.sound.shiftS, -2.345);
  assert.deepEqual(own.ranges[0], { start: 0, end: 0.25 });
  assert.deepEqual(full.ranges, own.ranges.slice(1), 'only the uncovered opening silence went');
  assert.equal(full.sound.trimmedS, 0.25);
  assert.match(full.sound.why, /0\.25 s of silence .* trimmed/);
  assert.equal(full.sound.ranges.length, full.ranges.length);
  full.ranges.forEach((r, i) => {
    assert.ok(Math.abs(full.sound.ranges[i].start - (r.start - 2.345)) < 1e-9, `range ${i} not shifted`);
    assert.ok(full.sound.ranges[i].start >= 0, `range ${i} starts before B's first frame`);
  });
  assert.ok(Math.abs(full.keptS + full.cutS - recording.durationS) < 0.002, 'kept + cut no longer equals the length');
});

test('the edit falls back to its own sound only when speech would lose its sound, and says why', () => {
  const pair = { sourceAId: A, sourceBId: B, offsetS: 4, status: 'done', audioSourceId: B };
  // B started 4 s in, and A is already talking at 3.193 s.
  const early = fullEdit(input({ sourceId: A, pair, otherDurationS: 2000 }));
  assert.equal(early.sound.sourceId, A);
  assert.match(early.sound.why, /had not started where this edit has speech/);
  assert.deepEqual(early.sound.ranges, early.ranges);

  const short = fullEdit(input({ sourceId: A, pair: { ...pair, offsetS: -1 }, otherDurationS: 500 }));
  assert.equal(short.sound.sourceId, A);
  assert.match(short.sound.why, /had already stopped/);

  // The other recording's length not given: used, and the gap in the check is named.
  const unknownEnd = fullEdit(input({ sourceId: A, pair: { ...pair, offsetS: -1 } }));
  assert.equal(unknownEnd.sound.sourceId, B);
  assert.match(unknownEnd.sound.why, /could not check the other recording's end: its length was not given/);

  assert.match(soundSource(A, null).why, /no line-up/);
  assert.match(soundSource(A, { ...pair, status: 'failed', error: 'clocks drift' }).why, /failed: clocks drift/);
  assert.match(soundSource(A, { ...pair, audioSourceId: A, chosenBy: 'dane' }).why, /own sound was chosen \(by Dane\)/);
  assert.match(soundSource(A, { ...pair, audioSourceId: null }).why, /no sound chosen/);
  const own = fullEdit(input({ sourceId: A }));
  assert.deepEqual(own.sound.ranges, own.ranges);
  assert.equal(own.sound.shiftS, 0);
});

test('thresholds come from the settings, never the pass', () => {
  assert.deepEqual(editListConfig({}), { minShortScore: DEFAULT_SHORT_MIN_SCORE, shortsPerRecording: DEFAULT_SHORTS_PER_RECORDING });
  assert.equal(DEFAULT_SHORT_MIN_SCORE, 60);
  assert.equal(DEFAULT_SHORTS_PER_RECORDING, 3);
  assert.deepEqual(editListConfig({ STUDIO_SHORT_MIN_SCORE: '80', STUDIO_SHORTS_PER_RECORDING: '1' }), { minShortScore: 80, shortsPerRecording: 1 });
  // A typo is ignored, not obeyed.
  assert.deepEqual(editListConfig({ STUDIO_SHORT_MIN_SCORE: 'sixty', STUDIO_SHORTS_PER_RECORDING: '-2' }), { minShortScore: 60, shortsPerRecording: 3 });
  assert.deepEqual(editListConfig({ STUDIO_SHORT_MIN_SCORE: '150', STUDIO_SHORTS_PER_RECORDING: '2.5' }), { minShortScore: 60, shortsPerRecording: 3 });

  // The fixture's moments score 88, 84, 80, 72, 55.
  const scores = (config) => planEdits(input(), { config }).shorts.map((s) => s.moment.score);
  assert.deepEqual(scores({ minShortScore: 60, shortsPerRecording: 3 }), [88, 84, 80]);
  assert.deepEqual(scores({ minShortScore: 60, shortsPerRecording: 10 }), [88, 84, 80, 72]);
  assert.deepEqual(scores({ minShortScore: 50, shortsPerRecording: 10 }), [88, 84, 80, 72, 55]);
  assert.deepEqual(scores({ minShortScore: 85, shortsPerRecording: 3 }), [88]);
  assert.deepEqual(scores({ minShortScore: 60, shortsPerRecording: 0 }), []);

  // With no config handed in, planEdits reads the settings itself.
  const saved = { ...process.env };
  try {
    process.env.STUDIO_SHORT_MIN_SCORE = '83';
    process.env.STUDIO_SHORTS_PER_RECORDING = '5';
    const plan = planEdits(input());
    assert.deepEqual(plan.config, { minShortScore: 83, shortsPerRecording: 5 });
    assert.deepEqual(plan.shorts.map((s) => s.moment.score), [88, 84]);
  } finally {
    for (const k of ['STUDIO_SHORT_MIN_SCORE', 'STUDIO_SHORTS_PER_RECORDING']) {
      if (k in saved) process.env[k] = saved[k]; else delete process.env[k];
    }
  }
});

test('every moment not made into a short says why', () => {
  const plan = planEdits(input(), { config: CONFIG });
  assert.equal(plan.full.kind, 'full');
  assert.equal(plan.shorts.length + plan.passedOver.length, moments.length);
  assert.deepEqual(plan.passedOver.map((p) => p.score), [72, 55]);
  assert.match(plan.passedOver[0].why, /3 better-scoring/);
  assert.match(plan.passedOver[1].why, /scored 55, under the 60/);
});

test('a moment dropped for bad times, no score, or starting past the end is listed with why', () => {
  const extra = [
    { start_s: 50, end_s: 40, score: 99 },
    { start_s: 'x', end_s: 10, score: 99 },
    { start_s: 100, end_s: 120 },
    { start_s: 900, end_s: 910, score: 99 },
    null,
  ];
  const plan = planEdits(input({ moments: [...moments, ...extra] }), { config: CONFIG });
  assert.equal(plan.shorts.length + plan.passedOver.length, moments.length + extra.length);
  const why = plan.passedOver.map((p) => p.why);
  assert.equal(why.filter((w) => /times are not usable/.test(w)).length, 3);
  assert.equal(why.filter((w) => /no score/.test(w)).length, 1);
  assert.ok(why.some((w) => /starts at 900 s, after the recording ends \(835\.65 s\)/.test(w)));
  assert.deepEqual(plan.shorts.map((s) => s.moment.score), [88, 84, 80], 'bad moments must not displace good ones');
});

test('a trim that leaves less than a quarter second of silence drops it, and counts it as trimmed', () => {
  // B started 0.24 s after A — two cameras started together land here. The
  // opening pause A keeps is 0-0.25 s, so trimming to B's first frame leaves
  // 0.24-0.25 s: a 0.01 s sliver no render could use. It goes, and the full
  // 0.25 s counts as trimmed so kept + cut still equals the length.
  const pair = { sourceAId: A, sourceBId: B, offsetS: 0.24, status: 'done', audioSourceId: B, chosenBy: 'measured' };
  const full = fullEdit(input({ sourceId: A, pair, otherDurationS: 2000 }));
  assert.equal(full.sound.sourceId, B);
  assert.deepEqual(full.ranges[0], { start: 3.193, end: 6.412 });
  assert.equal(full.sound.trimmedS, 0.25);
  for (const r of full.ranges) {
    assert.ok(r.end - r.start >= SLIVER_S - EPS || sounding.some((w) => w.start < r.end - EPS && w.end > r.start + EPS),
      `${r.start}-${r.end} is a silent sliver`);
  }
  assert.equal(full.sound.ranges.length, full.ranges.length);
  assert.ok(Math.abs(full.keptS + full.cutS - recording.durationS) < 0.002, 'kept + cut no longer equals the length');
});

test('a short never reaches outside the recording, even when its moment does', () => {
  const s = shortEdit(input(), { start_s: 829.75, end_s: 900, score: 90 });
  assert.ok(s.startS >= 0 && s.endS <= recording.durationS, `${s.startS}-${s.endS} is outside 0-${recording.durationS}`);
  assert.equal(s.endS, recording.durationS);
  for (const r of s.ranges) assert.ok(r.end <= recording.durationS + EPS);
  const early = shortEdit(input(), { start_s: -5, end_s: 10, score: 90 });
  assert.equal(early.startS, 0);
});

test('a config naming one setting keeps the other from the settings', () => {
  const plan = planEdits(input(), { config: { minShortScore: 70 } });
  assert.deepEqual(plan.config, { minShortScore: 70, shortsPerRecording: DEFAULT_SHORTS_PER_RECORDING });
  assert.deepEqual(plan.shorts.map((s) => s.moment.score), [88, 84, 80], 'the cap of 3 must still hold');
  const capOnly = planEdits(input(), { config: { shortsPerRecording: 1 } });
  assert.deepEqual(capOnly.config, { minShortScore: DEFAULT_SHORT_MIN_SCORE, shortsPerRecording: 1 });
});
