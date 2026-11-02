'use strict';

/**
 * The CUT MARKS — what to take out of one recording.
 *
 * Reel Spinner 1b (86bcwaw8a). Pure: no network, no files, no clock. Given two
 * whisper transcripts of the same audio and ffmpeg's silence report, it says
 * which stretches are "um"s, repeated words, short false starts, and pauses
 * long enough to shorten. Nothing runs it on real footage yet — 1c wires it
 * into the Mini's worker, 1d shows the marks on the Footage screen.
 *
 * WHY TWO TRANSCRIPTS (measured on the Mini, 2026-11-01, five minutes of a
 * Zoom call — the fixture under scripts/builder/fixtures/studio-cut-marks/).
 * whisper tidies speech by default: the pipeline's settings wrote 1 filler in
 * 783 words and dropped every repeated word. With VERBATIM_PROMPT it wrote 24
 * fillers in 804 words and kept the repeats — but it also CHANGED real words
 * ("just bash my hands. Yeah, and so" became "just, yeah, yeah, yeah, and, and
 * so"). So the verbatim transcript is never trusted on its own:
 *
 *   A word is only a cut candidate if it is in the verbatim transcript and NOT
 *   in the clean one — an extra the clean pass tidied away. Where the two
 *   disagree any other way (a word swapped, a word only the clean pass heard),
 *   nothing nearby is marked. When unsure, keep the speech.
 *
 * Everyone's speech is treated the same — guests too, no speaker detection
 * (Dane, 2026-11-01).
 */

const { whisperArgs } = require('./transcribePass.js');

/**
 * Bump when any rule below changes, so stored marks can say which rules made
 * them. Text, because video_cut_marks.rules_version is.
 */
const RULES_VERSION = '1';

/** The hint that makes whisper write what was said rather than what was meant. */
const VERBATIM_PROMPT = 'Umm, uh, so, like, I mean, you know, I- I was, uh, thinking, hmm.';

/**
 * Pauses: a silence longer than PAUSE_MIN_S is shortened so PAUSE_KEEP_S
 * stays, half on each side. Dane's numbers (2026-11-01: "shorten to a beat").
 */
const PAUSE_MIN_S = 1.0;
const PAUSE_KEEP_S = 0.5;

/**
 * The level ffmpeg's silencedetect calls silence. Measured on the Mini,
 * 2026-11-01, over the first 600 s of each analysis WAV, as the loudness of
 * every 0.1 s window (RMS dB; p10 ≈ the room when nobody speaks, p50/p90 ≈
 * speech), and how many >1.0 s silences each threshold finds:
 *
 *   recording                         p10    p50    p90   -30dB -35dB -40dB -45dB
 *   Zoom call (77602703, 2026-10-15)  -60.4  -27.4  -19.5    19    14    11    10
 *   iPhone talking (IMG_1962)         -56.4  -37.8  -25.9    21    15    12    10
 *   iPhone, noisy room (IMG_1636)     -39.9  -31.7  -22.9     0     0     0     0
 *   iPhone, quiet room (IMG_2022)     -61.6  -57.4  -50.8    18    52    85    85
 *
 * -35 dB sits well between the room and the speech on the Zoom call and the
 * talking clip, where Studio's footage mostly comes from. The noisy room never
 * gets below -40 dB, so no threshold finds a pause there — the safe failure,
 * nothing is cut. The quiet room is the dangerous one: it is nearly all room
 * tone (whisper invented "All right" 25 times over it), and at -35 dB 739 s of
 * its 754 s reads as silence. That is why a pause is never shortened where a
 * word starts inside it (`pauseMarks`): on that clip the guard drops 24 of the
 * 65 silences at -35 dB. A level derived per recording from its own p10/p90 is
 * the better rule if quiet recordings turn out to matter; this is not it.
 */
const SILENCE_NOISE_DB = -35;

/** Up to this many words count as one repeat or one false start. */
const MAX_RUN_WORDS = 4;

/**
 * An extra this close to a disagreement is not trusted: when the two passes
 * heard different words a word or two away, the alignment itself is a guess.
 * Counted in agreed words between the two.
 */
const ANCHOR_WORDS = 2;

/** Times within this many seconds are the same instant. */
const EPS = 0.005;

const FILLER = /^(?:u+h*m+|u+h+|e+r+|a+h+|h+m+)$/;

/** "Umm," → "umm"; "I-" → "i"; "don't" → "dont". Case and punctuation are not words. */
function norm(word) {
  return String(word == null ? '' : word).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isFiller(word) {
  return FILLER.test(norm(word));
}

/** The whisper arguments for the verbatim pass: the pipeline's own, plus the hint. */
function verbatimWhisperArgs(settings) {
  return [...whisperArgs(settings), '--prompt', VERBATIM_PROMPT];
}

/** The silencedetect filter for SILENCE_NOISE_DB and PAUSE_MIN_S. */
function silencedetectFilter(noiseDb = SILENCE_NOISE_DB, minS = PAUSE_MIN_S) {
  return `silencedetect=noise=${noiseDb}dB:d=${minS}`;
}

/**
 * ffmpeg's silencedetect stderr → `[{ start, end }]` in seconds.
 * A silence still open when the file ends has `end: null` — the caller knows
 * the duration, this text does not. A start just below zero (ffmpeg prints
 * one at the very top of a file) is read as zero.
 */
function parseSilencedetect(stderr) {
  const out = [];
  let open = null;
  for (const line of String(stderr == null ? '' : stderr).split('\n')) {
    const start = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (start) {
      open = Math.max(0, Number(start[1]));
      continue;
    }
    const end = /silence_end:\s*(-?[\d.]+)/.exec(line);
    if (end && open !== null) {
      out.push({ start: open, end: Number(end[1]) });
      open = null;
    }
  }
  if (open !== null) out.push({ start: open, end: null });
  return out.filter((s) => Number.isFinite(s.start) && (s.end === null || s.end > s.start));
}

/**
 * Myers' diff of two word lists → one op per word, in order:
 * `eq` (both), `ins` (only in b, the verbatim pass), `del` (only in a, the clean pass).
 * O((N+M)·D) time and O(D²) memory, so an hour of speech with a few hundred
 * differences stays small.
 */
function diffWords(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d += 1) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x += 1; y += 1; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
  }

  const ops = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const prev = trace[d];
    const at = (k) => prev[k + d + 1];
    const k = x - y;
    const prevK = (k === -d || (k !== d && at(k - 1) < at(k + 1))) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x -= 1; y -= 1; ops.push({ op: 'eq', a: x, b: y }); }
    if (prevK === k + 1) ops.push({ op: 'ins', b: prevY });
    else ops.push({ op: 'del', a: prevX });
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) { x -= 1; y -= 1; ops.push({ op: 'eq', a: x, b: y }); }
  return ops.reverse();
}

/**
 * Line the two transcripts up. Returns, for every verbatim word, whether the
 * clean pass has it (`eq`) or it is an extra, and the stretches where they
 * differ (`hunks`): `trusted` only for a pure run of extras with no other
 * disagreement within ANCHOR_WORDS agreed words.
 */
function align(cleanWords, verbatimWords) {
  const a = cleanWords.map((w) => norm(w.word));
  const vIdx = [];
  for (let i = 0; i < verbatimWords.length; i += 1) if (norm(verbatimWords[i].word)) vIdx.push(i);
  const b = vIdx.map((i) => norm(verbatimWords[i].word));
  const aKeep = [];
  for (let i = 0; i < a.length; i += 1) if (a[i]) aKeep.push(a[i]);

  const ops = diffWords(aKeep, b);
  const inClean = new Array(b.length).fill(false);
  const hunks = [];
  let cur = null;
  let bPos = 0;
  for (const o of ops) {
    if (o.op === 'eq') {
      inClean[o.b] = true;
      bPos = o.b + 1;
      cur = null;
      continue;
    }
    if (!cur) { cur = { start: bPos, end: bPos, dels: 0 }; hunks.push(cur); }
    if (o.op === 'ins') { cur.end = o.b + 1; bPos = o.b + 1; } else cur.dels += 1;
  }

  // Slide each run of extras as far left as the words allow, so of "because,
  // because" it is the FIRST copy that reads as the extra.
  for (const h of hunks) {
    if (h.dels) continue;
    while (h.start > 0 && inClean[h.start - 1] && b[h.start - 1] === b[h.end - 1]) {
      inClean[h.start - 1] = false;
      inClean[h.end - 1] = true;
      h.start -= 1;
      h.end -= 1;
    }
  }

  // Agreed words before each position, to measure the distance between hunks.
  const agreed = new Int32Array(b.length + 1);
  for (let i = 0; i < b.length; i += 1) agreed[i + 1] = agreed[i] + (inClean[i] ? 1 : 0);
  const between = (from, to) => (to > from ? agreed[to] - agreed[from] : 0);
  for (const h of hunks) {
    h.trusted = h.dels === 0 && h.end > h.start && !hunks.some((g) => g !== h && g.dels
      && (g.end <= h.start ? between(g.end, h.start) : between(h.end, g.start)) < ANCHOR_WORDS);
  }
  return { b, vIdx, inClean, hunks };
}

/**
 * Within one trusted run of extras [start, end) of the verbatim sequence `b`,
 * say which words are a filler, a repeat or a false start. A word none of the
 * rules explains is kept.
 */
function classifyRun(b, start, end) {
  const found = [];
  const nonFillerAfter = (from, count) => {
    const out = [];
    for (let j = from; j < b.length && out.length < count; j += 1) if (!FILLER.test(b[j])) out.push(b[j]);
    return out;
  };
  const nonFillerBefore = (to, count) => {
    const out = [];
    for (let j = to - 1; j >= 0 && out.length < count; j -= 1) if (!FILLER.test(b[j])) out.unshift(b[j]);
    return out;
  };
  const same = (xs, ys) => xs.length === ys.length && xs.every((x, i) => x === ys[i]);

  let i = start;
  while (i < end) {
    if (FILLER.test(b[i])) { found.push({ kind: 'filler', from: i, to: i + 1 }); i += 1; continue; }
    let k = Math.min(MAX_RUN_WORDS, end - i);
    for (; k >= 1; k -= 1) {
      const run = b.slice(i, i + k);
      if (run.some((w) => FILLER.test(w))) continue;
      if (same(run, nonFillerAfter(i + k, k)) || same(run, nonFillerBefore(i, k))) break;
    }
    if (k >= 1) { found.push({ kind: 'repeat', from: i, to: i + k }); i += k; continue; }
    if (end - i >= 2 && end - i <= MAX_RUN_WORDS && end < b.length && b[i] === b[end]) {
      found.push({ kind: 'false_start', from: i, to: end });
      break;
    }
    i += 1;
  }
  return found;
}

const WHY = {
  filler: 'A filler word ("um", "uh") that the clean transcript left out.',
  repeat: 'A word said twice in a row; the clean transcript has it once, so the first copy goes.',
  false_start: 'A start that was abandoned and begun again with the same word. Weaker evidence than a filler or a repeat.',
  pause: `A silence longer than ${PAUSE_MIN_S} s, shortened so ${PAUSE_KEEP_S} s stays — a quarter second each side.`,
};

/**
 * The pause marks: each silence longer than PAUSE_MIN_S, stored whole with
 * `keep_s: PAUSE_KEEP_S` — the shape lib/videoCutMarksStore.js keeps, where a
 * pause is shortened, not removed. A silence with a kept word starting inside
 * what would be cut is not silence — the room is loud or the speaker is
 * quiet — so it is left alone.
 */
function pauseMarks(silences, keptStarts, durationS) {
  const marks = [];
  for (const s of silences) {
    const end = Math.min(s.end == null ? durationS : s.end, durationS);
    if (!Number.isFinite(s.start) || !Number.isFinite(end)) continue;
    if (end - s.start <= PAUSE_MIN_S + EPS) continue;
    const from = s.start + PAUSE_KEEP_S / 2;
    const to = end - PAUSE_KEEP_S / 2;
    if (keptStarts.some((t) => t > from + EPS && t < to - EPS)) continue;
    marks.push({ start: s.start, end, kind: 'pause', keep_s: PAUSE_KEEP_S, words: '', why: WHY.pause });
  }
  return marks;
}

/**
 * A word's end is the next word's start (docs/STUDIO.md, "Word timing"), so
 * the last word before a pause stretches across it. The silence report says
 * where the sound actually stopped: a word mark ends where a silence begins
 * and starts where one ends. Then a word mark and a pause never overlap, and
 * each keeps its own kind.
 */
function trimToSound(mark, silences, durationS) {
  let { start, end } = mark;
  for (const s of silences) {
    const sEnd = s.end == null ? durationS : s.end;
    if (s.start > start + EPS && s.start < end) end = s.start;
    if (sEnd > start && sEnd < end - EPS && s.start <= start + EPS) start = sEnd;
  }
  return { ...mark, start, end };
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * What to cut from one recording.
 *
 * @param {object} input
 * @param {Array<{start,end,word}>} input.cleanWords    words from the pipeline's own whisper settings
 * @param {Array<{start,end,word}>} input.verbatimWords words from `verbatimWhisperArgs`, same audio
 * @param {Array<{start,end}>}      input.silences      `parseSilencedetect` of the same audio
 * @param {number}                  input.durationS     the audio's length
 * @returns {{ marks: Array<{start,end,kind,keep_s,words,why}>, cutS: number, rulesVersion: string }}
 *   `marks` in the shape lib/videoCutMarksStore.js keeps, sorted, never
 *   overlapping (overlaps merge); `cutS` the seconds they remove, computed
 *   the way the store computes it.
 */
function findCutMarks({ cleanWords = [], verbatimWords = [], silences = [], durationS = null } = {}) {
  const duration = Number.isFinite(Number(durationS)) && Number(durationS) > 0 ? Number(durationS) : Infinity;
  const quiet = (Array.isArray(silences) ? silences : []).filter((s) => s && Number.isFinite(s.start));
  const { b, vIdx, inClean, hunks } = align(cleanWords, verbatimWords);

  // Starts of every word the cut must keep. A verbatim word's start is its
  // own audio; the clean pass's starts are a second opinion on where speech is.
  const keptVerbatimStarts = [];
  for (let i = 0; i < b.length; i += 1) if (inClean[i]) keptVerbatimStarts.push(Number(verbatimWords[vIdx[i]].start));
  const keptStarts = keptVerbatimStarts.concat(cleanWords.map((w) => Number(w.start)))
    .filter(Number.isFinite);

  const raw = [];
  for (const h of hunks) {
    if (!h.trusted) continue;
    for (const f of classifyRun(b, h.start, h.end)) {
      const start = Number(verbatimWords[vIdx[f.from]].start);
      const end = Number(verbatimWords[vIdx[f.to - 1]].end);
      if (!(end > start)) continue;
      // Never cut into a word both passes heard.
      if (keptVerbatimStarts.some((t) => t > start + EPS && t < end - EPS)) continue;
      const words = verbatimWords.slice(vIdx[f.from], vIdx[f.to - 1] + 1).map((w) => w.word).join(' ');
      raw.push(trimToSound({ start, end, kind: f.kind, keep_s: 0, words, why: WHY[f.kind] }, quiet, duration));
    }
  }
  raw.push(...pauseMarks(quiet, keptStarts, duration));

  const sorted = raw
    .map((m) => ({ ...m, start: round3(Math.max(0, m.start)), end: round3(Math.min(duration, m.end)) }))
    .filter((m) => m.end - m.start > EPS)
    .sort((x, y) => x.start - y.start || x.end - y.end);

  // Overlaps merge. Two of one kind become one mark; a mark overlapping one
  // of another kind keeps only the part after it, so every mark still has
  // exactly one kind and the time is never counted twice.
  const marks = [];
  for (const m of sorted) {
    const prev = marks[marks.length - 1];
    if (prev && m.start < prev.end - EPS) {
      if (m.kind === prev.kind) {
        prev.end = Math.max(prev.end, m.end);
        prev.words = [prev.words, m.words].filter(Boolean).join(' ');
        continue;
      }
      if (m.end <= prev.end + EPS) continue;
      m.start = prev.end;
      m.keep_s = Math.min(m.keep_s, round3(m.end - m.start));
    }
    marks.push({ ...m });
  }
  const cutS = round3(marks.reduce((sum, m) => sum + (m.end - m.start - m.keep_s), 0));
  return { marks, cutS, rulesVersion: RULES_VERSION };
}

module.exports = {
  RULES_VERSION,
  VERBATIM_PROMPT,
  PAUSE_MIN_S,
  PAUSE_KEEP_S,
  SILENCE_NOISE_DB,
  findCutMarks,
  parseSilencedetect,
  verbatimWhisperArgs,
  silencedetectFilter,
  isFiller,
  diffWords,
};
