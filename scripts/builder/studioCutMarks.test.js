'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Reel Spinner 1b (86bcwaw8a) — the cut-mark rules.
 *
 * The fixture is REAL: five minutes (600–900 s, so times here run 0–300) of
 * Zoom call 77602703-5c1f-4389-915a-d5181ec76d63, transcribed on the Mini on
 * 2026-11-01 with the pipeline's whisper settings (clean.json) and with
 * verbatimWhisperArgs (verbatim.json), plus ffmpeg silencedetect at
 * SILENCE_NOISE_DB. The JSON is trimmed to the fields parseWhisperJson reads,
 * and goes through that same reader — the one production uses.
 */

const { parseWhisperJson, whisperArgs } = require('../../workers/studio/transcribePass.js');
const {
  findCutMarks,
  parseSilencedetect,
  verbatimWhisperArgs,
  silencedetectFilter,
  isFiller,
  diffWords,
  RULES_VERSION,
  VERBATIM_PROMPT,
} = require('../../workers/studio/cutMarks.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'studio-cut-marks');

function readWords(name) {
  const parsed = parseWhisperJson(fs.readFileSync(path.join(FIXTURE, name), 'utf8'));
  assert.equal(parsed.ok, true, `${name} must parse with the production reader`);
  return parsed.words;
}

const clean = readWords('clean.json');
const verbatim = readWords('verbatim.json');
const silences = parseSilencedetect(fs.readFileSync(path.join(FIXTURE, 'silencedetect.txt'), 'utf8'));
const result = findCutMarks({ cleanWords: clean, verbatimWords: verbatim, silences, durationS: 300 });

const norm = (w) => String(w).toLowerCase().replace(/[^a-z0-9]/g, '');
const inMark = (t) => result.marks.some((m) => t >= m.start - 0.005 && t < m.end - 0.005);
const cutWords = verbatim.filter((w) => inMark(w.start));

/** Where a run of words starts in the verbatim transcript. */
function findRun(words, run) {
  for (let i = 0; i + run.length <= words.length; i += 1) {
    if (run.every((r, j) => norm(words[i + j].word) === r)) return i;
  }
  return -1;
}

test('the fixture is the measured one: 783 clean words with 1 filler, 804 verbatim with 24', () => {
  assert.equal(clean.length, 783);
  assert.equal(verbatim.length, 804);
  assert.equal(clean.filter((w) => isFiller(w.word)).length, 1);
  assert.equal(verbatim.filter((w) => isFiller(w.word)).length, 24);
  assert.equal(silences.length, 11);
});

test('the fillers are found — all but the three the rules keep on purpose', () => {
  const fillersCut = cutWords.filter((w) => isFiller(w.word));
  assert.ok(fillersCut.length >= 20, `expected 20+ fillers cut, got ${fillersCut.length}`);
  // The three kept, and why:
  //  131.44 "uh, you, you got" — the clean pass heard "You got, you got": a
  //         disagreement right beside it, so the alignment is a guess.
  //  194.82 "gonna, um," — the clean pass heard "going to,": same.
  //  160.64 "ah" — the clean pass has it too, so it is not an extra.
  const kept = verbatim.filter((w) => isFiller(w.word) && !inMark(w.start)).map((w) => w.start);
  assert.deepEqual(kept, [131.44, 160.64, 194.82]);
});

test('"because, because" yields exactly one repeat, and the second "because" stays', () => {
  const i = findRun(verbatim, ['because', 'because']);
  assert.ok(i >= 0, 'the fixture has "because, because"');
  const first = verbatim[i];
  const second = verbatim[i + 1];
  const repeats = result.marks.filter((m) => m.kind.includes('repeat') && m.start <= first.start && m.end > first.start);
  assert.equal(repeats.length, 1);
  assert.equal(repeats[0].text, first.word);
  assert.equal(inMark(second.start), false, 'the second copy is the one kept');
});

test('the "bash my hands" disagreement yields NO mark', () => {
  // clean:    "just bash my hands. Yeah, and so"
  // verbatim: "just, yeah, yeah, yeah, and, and so"
  // The verbatim pass changed real words here; nothing in it may be cut.
  assert.ok(findRun(clean, ['just', 'bash', 'my', 'hands']) >= 0);
  const i = findRun(verbatim, ['just', 'yeah', 'yeah', 'yeah', 'and', 'and', 'so']);
  assert.ok(i >= 0, 'the fixture has the hinted version');
  const from = verbatim[i].start;
  const to = verbatim[i + 6].end;
  const overlapping = result.marks.filter((m) => m.start < to && m.end > from);
  assert.deepEqual(overlapping, [], `marks inside "just … so" (${from}–${to}s)`);
});

test('nothing the clean transcript has is cut — it is still all there in what is kept', () => {
  const cleanNorm = clean.map((w) => norm(w.word)).filter(Boolean);
  const agreed = (b) => diffWords(cleanNorm, b).filter((o) => o.op === 'eq').length;
  const all = verbatim.map((w) => norm(w.word)).filter(Boolean);
  const kept = verbatim.filter((w) => !inMark(w.start)).map((w) => norm(w.word)).filter(Boolean);
  assert.equal(agreed(kept), agreed(all));
});

test('the fixture marks, for the ticket', () => {
  // Printed so the build pass can paste them; the asserts above are the proof.
  const lines = result.marks.map((m) => `${m.start.toFixed(2)}–${m.end.toFixed(2)} ${m.kind}${m.text ? ` "${m.text}"` : ''}`);
  console.log(`${lines.join('\n')}\n${result.marks.length} marks, ${result.cutS}s removed of 300s`);
  assert.ok(result.cutS > 0 && result.cutS < 60);
  assert.equal(result.rulesVersion, RULES_VERSION);
  for (let i = 1; i < result.marks.length; i += 1) {
    assert.ok(result.marks[i].start > result.marks[i - 1].end, 'marks are sorted and do not overlap');
  }
});

// --- the rules one at a time, on made-up words ---------------------------------

/** Words one per 0.4 s from `t0`, the way parseWhisperJson shapes them. */
function words(text, t0 = 0, step = 0.4) {
  return text.split(' ').map((word, i) => ({ word, start: t0 + i * step, end: t0 + (i + 1) * step }));
}

test('a repeat cuts the FIRST copy: "I, I was" → the first "I"', () => {
  const { marks } = findCutMarks({ cleanWords: words('so I was there today'), verbatimWords: words('so I, I was there today') });
  assert.deepEqual(marks.map((m) => [m.kind, m.text, m.start]), [['repeat', 'I,', 0.4]]);
});

test('a two-word repeat: "I was, I was going" → "I was,"', () => {
  const { marks } = findCutMarks({
    cleanWords: words('and then I was going home now'),
    verbatimWords: words('and then I was, I was going home now'),
  });
  assert.deepEqual(marks.map((m) => [m.kind, m.text]), [['repeat', 'I was,']]);
});

test('a false start: "I was, I started" → "I was," marked as weaker evidence', () => {
  const { marks } = findCutMarks({
    cleanWords: words('then I started building it'),
    verbatimWords: words('then I was, I started building it'),
  });
  assert.deepEqual(marks.map((m) => [m.kind, m.text]), [['false_start', 'I was,']]);
  assert.match(marks[0].why, /weaker evidence/);
});

test('an extra the rules cannot explain is kept', () => {
  const { marks } = findCutMarks({
    cleanWords: words('we went to the shop today'),
    verbatimWords: words('we went to the big shop today'),
  });
  assert.deepEqual(marks, []);
});

test('a filler beside a swapped word is kept: when unsure, keep the speech', () => {
  const { marks } = findCutMarks({
    cleanWords: words('and I am going to show you'),
    verbatimWords: words('and I am gonna, um, show you'),
  });
  assert.deepEqual(marks, []);
});

test('a filler the clean pass ALSO heard is not cut', () => {
  const { marks } = findCutMarks({ cleanWords: words('it was, ah, hard'), verbatimWords: words('it was, ah, hard') });
  assert.deepEqual(marks, []);
});

test('fillers: um umm uh uhh er ah hmm, any case, with punctuation', () => {
  for (const w of ['um', 'Umm,', 'uh.', 'UHH', 'er', 'ah,', 'Hmm?', 'ummm']) assert.equal(isFiller(w), true, w);
  for (const w of ['umbrella', 'her', 'aha', 'hum', 'Mm-hmm', 'I', 'and']) assert.equal(isFiller(w), false, w);
});

test('a pause longer than 1.0 s keeps 0.5 s, a quarter second each side', () => {
  const cleanWords = [...words('one two three', 0), ...words('four five', 4)];
  const { marks, cutS } = findCutMarks({ cleanWords, verbatimWords: cleanWords, silences: [{ start: 1.2, end: 4.0 }] });
  assert.deepEqual(marks.map((m) => [m.kind, m.start, m.end]), [['pause', 1.45, 3.75]]);
  assert.equal(cutS, 2.3);
});

test('a silence of 1.0 s or less is left alone', () => {
  const { marks } = findCutMarks({ silences: [{ start: 1, end: 2 }, { start: 5, end: 5.9 }] });
  assert.deepEqual(marks, []);
});

test('a "silence" with a word starting inside it is not shortened', () => {
  const cleanWords = words('one two three four five six', 0, 0.5);
  const { marks } = findCutMarks({ cleanWords, verbatimWords: cleanWords, silences: [{ start: 0.2, end: 2.8 }] });
  assert.deepEqual(marks, []);
});

test('a silence still open at the end of the file runs to the duration', () => {
  const { marks } = findCutMarks({ silences: [{ start: 8, end: null }], durationS: 10 });
  assert.deepEqual(marks.map((m) => [m.start, m.end]), [[8.25, 9.75]]);
});

test('overlapping marks merge into one, naming both', () => {
  const cleanWords = [...words('so then', 0), ...words('we left', 3)];
  const verbatimWords = [...words('so then uh', 0), ...words('we left', 3)];
  verbatimWords[2].end = 3; // the last word before a pause stretches across it
  const { marks } = findCutMarks({ cleanWords, verbatimWords, silences: [{ start: 1.0, end: 3.0 }], durationS: 4 });
  assert.equal(marks.length, 1);
  assert.equal(marks[0].kind, 'filler+pause');
  assert.deepEqual([marks[0].start, marks[0].end], [0.8, 3]);
});

test('parseSilencedetect reads ffmpeg\'s lines, a negative start, and an unfinished silence', () => {
  const stderr = [
    'Input #0, wav, from \'cut.wav\':',
    '[silencedetect @ 0x1] silence_start: -0.0123',
    '[silencedetect @ 0x1] silence_end: 1.5 | silence_duration: 1.51',
    'size=N/A time=00:00:05.00 bitrate=N/A speed= 500x',
    '[silencedetect @ 0x1] silence_start: 60.115',
    '[silencedetect @ 0x1] silence_end: 61.184812 | silence_duration: 1.069813',
    '[silencedetect @ 0x1] silence_start: 290.5',
  ].join('\n');
  assert.deepEqual(parseSilencedetect(stderr), [
    { start: 0, end: 1.5 },
    { start: 60.115, end: 61.184812 },
    { start: 290.5, end: null },
  ]);
  assert.deepEqual(parseSilencedetect(''), []);
  assert.deepEqual(parseSilencedetect(null), []);
});

test('verbatimWhisperArgs is the pipeline\'s own arguments plus the hint', () => {
  const settings = { model: 'm.bin', wav: 'a.wav', outBase: 'out', dtw: 'large.v3.turbo', language: 'en' };
  assert.deepEqual(verbatimWhisperArgs(settings), [...whisperArgs(settings), '--prompt', VERBATIM_PROMPT]);
  assert.equal(silencedetectFilter(), 'silencedetect=noise=-35dB:d=1');
});

test('diffWords lines up insertions and deletions', () => {
  const ops = diffWords(['a', 'b', 'c'], ['a', 'x', 'b', 'd']).map((o) => o.op);
  assert.deepEqual(ops.filter((o) => o === 'eq').length, 2);
  assert.deepEqual(ops.filter((o) => o === 'ins').length, 2);
  assert.deepEqual(ops.filter((o) => o === 'del').length, 1);
  assert.deepEqual(diffWords([], []), []);
});
