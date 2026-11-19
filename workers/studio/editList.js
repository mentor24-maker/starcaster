'use strict';

/**
 * THE EDIT LIST — exactly which stretches of time to keep, and from which
 * recording's sound.
 *
 * Reel Spinner 4a (SC-833). Pure: no network, no files, no clock, no queue,
 * no database. Given one recording's transcript words, its cut marks
 * (Reel Spinner 1b, workers/studio/cutMarks.js), its moments (2c,
 * workers/studio/moments.js) and its line-up with another recording if it has
 * one (3a, a `video_audio_pairs` row as lib/videoAudioPairsStore.js reads it),
 * it says what the edit keeps. The rough cut (4b) and the finished render (5c)
 * both render FROM THIS LIST, so the two can never disagree about what was cut.
 *
 * Two kinds of edit:
 *
 *   full   the whole recording minus every cut mark — pauses shortened to the
 *          0.5 s they keep, fillers, repeats and false starts taken out.
 *   short  one moment's stretch minus the cuts inside it, with a short lead-in
 *          and lead-out so the clip does not open or close on the very edge of
 *          a word, and never extends into one.
 *
 * WHAT "INSIDE A WORD" MEANS HERE (measured on the 2c fixture, recording
 * e8699ace, 2026-11-18). whisper stretches a word's time across the silence
 * after it: "to" is stamped 5.90-7.82 s though it is said in about a quarter
 * of a second and the rest is a 1.5 s pause. By raw whisper times, 34 of that
 * recording's 59 cut edges fall "inside a word" — every one of them in a
 * silence ffmpeg measured or on an extra 1b found. So a word here is where it
 * SOUNDS: its whisper span with every cut mark's span taken off (a cut mark
 * is 1b's finding that this stretch is silence or an extra, and 1b is the
 * stage that listened). `soundingWords` is that rule, and the tests check
 * every boundary against it.
 *
 * WHEN UNSURE, KEEP THE SPEECH (as cutMarks.js does). A kept stretch shorter
 * than a quarter second is dropped as a sliver — unless a word sounds in it,
 * because dropping that would cut a real word out of the edit.
 */

const { PAUSE_KEEP_S } = require('./cutMarks.js');

/** Bump when any rule below changes, so a stored edit can say which rules made it. */
const RULES_VERSION = '3';

/** Without a measured frame rate, a frame is this long (30 fps). */
const DEFAULT_FPS = 30;

/** A kept stretch shorter than this is a sliver, and goes (unless a word sounds in it). */
const SLIVER_S = 0.25;

/**
 * A short opens this much before its moment's first word and closes this much
 * after its last, as far as the silence there allows: a lead-in never reaches
 * back into the word before, a lead-out never into the word after, and
 * neither reaches into a stretch a cut removes.
 */
const LEAD_IN_S = 0.25;
const LEAD_OUT_S = 0.5;

/** Settings (SC-833): which moments become shorts, and how many. */
const DEFAULT_SHORT_MIN_SCORE = 60;
const DEFAULT_SHORTS_PER_RECORDING = 3;

/** Times within this many seconds are the same instant (as in cutMarks.js). */
const EPS = 0.005;

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function isSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The two settings from the environment, falling back to the defaults. A value
 * that is not a whole number in range is ignored, not obeyed — a typo in the
 * settings must not turn every moment into a short, or none.
 */
function editListConfig(env = process.env) {
  const score = Number(String(env.STUDIO_SHORT_MIN_SCORE ?? '').trim() || NaN);
  const count = Number(String(env.STUDIO_SHORTS_PER_RECORDING ?? '').trim() || NaN);
  return {
    minShortScore: Number.isInteger(score) && score >= 0 && score <= 100 ? score : DEFAULT_SHORT_MIN_SCORE,
    shortsPerRecording: Number.isInteger(count) && count >= 0 ? count : DEFAULT_SHORTS_PER_RECORDING,
  };
}

/** Words with usable times, in order. */
function usableWords(words) {
  if (!Array.isArray(words)) return [];
  return words
    .filter((w) => w && isSeconds(w.start) && isSeconds(w.end) && w.end > w.start
      && String(w.word == null ? '' : w.word).trim())
    .map((w) => ({ start: w.start, end: w.end, word: String(w.word).trim() }))
    .sort((a, b) => a.start - b.start);
}

/** Cut marks with usable times, in order, with the `keep_s` they leave in place. */
function usableMarks(marks) {
  if (!Array.isArray(marks)) return [];
  return marks
    .filter((m) => m && isSeconds(m.start) && isSeconds(m.end) && m.end > m.start)
    .map((m) => {
      const keep = isSeconds(m.keep_s) && m.keep_s > 0 ? m.keep_s
        : (m.kind === 'pause' && !isSeconds(m.keep_s) ? PAUSE_KEEP_S : 0);
      return { start: m.start, end: m.end, kind: String(m.kind || 'cut'), keep: Math.min(keep, m.end - m.start) };
    })
    .sort((a, b) => a.start - b.start);
}

/** Sorted, overlapping-or-touching ranges joined. */
function union(ranges) {
  const out = [];
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + EPS) last.end = Math.max(last.end, r.end);
    else out.push({ start: r.start, end: r.end });
  }
  return out;
}

/**
 * What each cut mark takes away: its span less the `keep_s` it leaves, half
 * on each side (cutMarks.js shortens a pause that way: a quarter second stays
 * at each end).
 */
function removals(marks) {
  return union(usableMarks(marks)
    .map((m) => ({ start: m.start + m.keep / 2, end: m.end - m.keep / 2 }))
    .filter((r) => r.end - r.start > EPS));
}

/**
 * Where each word actually SOUNDS: its whisper span with every cut mark's span
 * taken off. A mark that splits a word leaves the longer side (whisper's word
 * stretched over a pause on both sides; the sound is on one of them). A word
 * entirely covered by marks does not sound at all and is left out.
 */
function soundingWords(words, marks) {
  const said = usableWords(words);
  const quiet = union(usableMarks(marks));
  const out = [];
  for (const w of said) {
    let pieces = [{ start: w.start, end: w.end }];
    for (const q of quiet) {
      if (q.end <= w.start + EPS || q.start >= w.end - EPS) continue;
      pieces = pieces.flatMap((p) => {
        if (q.end <= p.start + EPS || q.start >= p.end - EPS) return [p];
        const left = { start: p.start, end: Math.max(p.start, q.start) };
        const right = { start: Math.min(p.end, q.end), end: p.end };
        return [left, right].filter((x) => x.end - x.start > EPS);
      });
    }
    if (!pieces.length) continue;
    const best = pieces.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
    out.push({ start: best.start, end: best.end, word: w.word });
  }
  return out;
}

function soundsIn(sounding, start, end) {
  return sounding.some((w) => w.start < end - EPS && w.end > start + EPS);
}

/**
 * `window` minus `cuts`, then tidied: two kept stretches closer than a frame
 * are joined (a cut that short cannot be rendered), and a kept stretch under a
 * quarter second is dropped unless a word sounds in it.
 *
 * @returns {{ ranges: {start,end}[], merged: number, droppedSlivers: number, keptSlivers: number }}
 */
function keepRanges(window, cuts, { frameS, sounding }) {
  let ranges = [{ start: window.start, end: window.end }];
  for (const c of cuts) {
    if (c.end <= window.start + EPS || c.start >= window.end - EPS) continue;
    ranges = ranges.flatMap((r) => {
      if (c.end <= r.start + EPS || c.start >= r.end - EPS) return [r];
      return [{ start: r.start, end: Math.max(r.start, c.start) }, { start: Math.min(r.end, c.end), end: r.end }]
        .filter((x) => x.end - x.start > EPS);
    });
  }

  let merged = 0;
  const joined = [];
  for (const r of ranges) {
    const last = joined[joined.length - 1];
    // A cut shorter than one frame cannot be rendered, so it is joined over.
    // (No EPS slack here: `frameS - EPS` left a 0.030 s cut at 30 fps unjoined.)
    if (last && r.start - last.end < frameS) {
      last.end = r.end;
      merged += 1;
    } else joined.push({ ...r });
  }

  let droppedSlivers = 0;
  let keptSlivers = 0;
  const kept = joined.filter((r) => {
    if (r.end - r.start >= SLIVER_S - EPS) return true;
    if (soundsIn(sounding, r.start, r.end)) {
      keptSlivers += 1;
      return true;
    }
    droppedSlivers += 1;
    return false;
  });
  return { ranges: kept.map((r) => ({ start: round(r.start), end: round(r.end) })), merged, droppedSlivers, keptSlivers };
}

function total(ranges) {
  return ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
}

/** The gaps between kept stretches inside `window`: what the edit takes out. */
function gaps(window, ranges) {
  const out = [];
  let at = window.start;
  for (const r of ranges) {
    if (r.start > at + EPS) out.push({ start: round(at), end: round(r.start) });
    at = Math.max(at, r.end);
  }
  if (window.end > at + EPS) out.push({ start: round(at), end: round(window.end) });
  return out;
}

/**
 * Whose sound the edit uses, and how far its clock is from this recording's.
 * `shiftS` is added to a time on THIS recording to get the same instant on
 * the sound's recording. `offsetS` on a pair is how many seconds after A's
 * first frame B's first frame was recorded, so on A, B's clock reads
 * `t - offsetS`, and on B, A's reads `t + offsetS`.
 *
 * The pair's `audioSourceId` decides (the line-up's measurement, or Dane's
 * choice, which the store never lets a measurement overwrite). No pair, a
 * failed line-up, no choice yet, or this recording chosen: its own sound.
 */
function soundSource(sourceId, pair) {
  const own = (why) => ({ sourceId: sourceId || null, shiftS: 0, paired: false, why });
  if (!pair) return own('no line-up with another recording');
  if (pair.status !== 'done') return own(`the line-up ${pair.status === 'failed' ? 'failed' : 'is not done'}${pair.error ? `: ${pair.error}` : ''}`);
  if (!isSeconds(pair.offsetS)) return own('the line-up has no offset');
  const id = String(sourceId || '').toLowerCase();
  const a = String(pair.sourceAId || '').toLowerCase();
  const b = String(pair.sourceBId || '').toLowerCase();
  if (id !== a && id !== b) return own('the line-up is not for this recording');
  const other = id === a ? b : a;
  const chosen = String(pair.audioSourceId || '').toLowerCase();
  if (!chosen) return own('no sound chosen on the line-up yet');
  if (chosen === id) return own(`this recording's own sound was chosen (${pair.chosenBy === 'dane' ? 'by Dane' : 'as the cleaner'})`);
  if (chosen !== other) return own('the chosen sound is neither recording');
  return {
    sourceId: other,
    shiftS: id === a ? -pair.offsetS : pair.offsetS,
    paired: true,
    why: `the other recording's sound (${pair.chosenBy === 'dane' ? 'chosen by Dane' : 'measured cleaner'})`,
  };
}

/**
 * The sound's keep ranges: the picture's, shifted onto the sound's clock.
 *
 * The other recording only covers part of this one's clock: from its first
 * frame (`-shiftS` here) to its end (`otherDurationS - shiftS`, when known). A
 * kept stretch that runs outside that is trimmed to the covered part WHEN NO
 * WORD SOUNDS in the trimmed-off piece — the opening quarter second of pause
 * every recording keeps is the usual case, and losing it costs nothing. The
 * picture is trimmed the same way, so picture and sound stay the same length.
 * Only when real speech would lose its sound does the edit fall back to its
 * own sound and say why: a clip with half its sound missing is worse than a
 * clip with the plainer sound.
 *
 * @returns {{ sourceId, shiftS, ranges, pictureRanges, trimmedS, why }}
 */
function soundFor(ranges, sourceId, pair, otherDurationS, sounding = []) {
  const src = soundSource(sourceId, pair);
  const ownSound = (why) => ({
    sourceId: soundSource(sourceId, null).sourceId,
    shiftS: 0,
    ranges: ranges.map((r) => ({ ...r })),
    pictureRanges: ranges.map((r) => ({ ...r })),
    trimmedS: 0,
    why,
  });
  if (!src.paired) return { ...ownSound(src.why) };

  const knowsEnd = isSeconds(otherDurationS) && otherDurationS > 0;
  const lo = -src.shiftS;
  const hi = knowsEnd ? otherDurationS - src.shiftS : Infinity;
  const picture = [];
  let trimmedS = 0;
  for (const r of ranges) {
    const start = Math.max(r.start, lo);
    const end = Math.min(r.end, hi);
    const lost = [];
    if (start > r.start + EPS) lost.push({ start: r.start, end: Math.min(r.end, start), at: 'start' });
    if (end < r.end - EPS) lost.push({ start: Math.max(r.start, end), end: r.end, at: 'end' });
    const spoken = lost.find((l) => soundsIn(sounding, l.start, l.end));
    if (spoken) {
      return ownSound(`own sound: the other recording ${spoken.at === 'start' ? 'had not started' : 'had already stopped'} where this edit has speech (${round(spoken.start)}-${round(spoken.end)} s)`);
    }
    trimmedS += lost.reduce((n, l) => n + (l.end - l.start), 0);
    if (end - start <= EPS) continue;
    // keepRanges tidied BEFORE this trim, so tidy what the trim left: a
    // remnant under a quarter second is a sliver like any other, and goes
    // unless a word sounds in it (a 0-0.25 s opening pause with the other
    // recording starting at 0.24 s left 0.24-0.25 s otherwise).
    if (end - start < SLIVER_S - EPS && !soundsIn(sounding, start, end)) {
      trimmedS += end - start;
      continue;
    }
    picture.push({ start: round(start), end: round(end) });
  }
  if (!picture.length) return ownSound('own sound: the other recording covers none of this edit');

  // Offsets are measured to the millisecond; round the shift before adding it
  // so sound times stay on the same millisecond grid as picture times.
  const shiftS = round(src.shiftS);
  const notes = [src.why];
  if (trimmedS > EPS) notes.push(`${round(trimmedS)} s of silence the other recording did not cover was trimmed`);
  if (!knowsEnd) notes.push("could not check the other recording's end: its length was not given");
  return {
    sourceId: src.sourceId,
    shiftS,
    ranges: picture.map((r) => ({ start: round(r.start + shiftS), end: round(r.end + shiftS) })),
    pictureRanges: picture,
    trimmedS: round(trimmedS),
    why: notes.join('; '),
  };
}

/**
 * Settle the sound, and let it trim the picture: an edit's `ranges` and its
 * `sound.ranges` always pair up one to one and run the same length.
 */
function withSound(kept, input, ctx) {
  const sound = soundFor(kept.ranges, input.sourceId, input.pair, input.otherDurationS, ctx.sounding);
  const { pictureRanges, ...rest } = sound;
  return { kept: { ...kept, ranges: pictureRanges }, sound: rest };
}

function summarise(kind, window, kept, extra) {
  const keptS = total(kept.ranges);
  const cut = gaps(window, kept.ranges);
  const cutS = total(cut);
  return {
    kind,
    startS: round(window.start),
    endS: round(window.end),
    spanS: round(window.end - window.start),
    ranges: kept.ranges,
    keptS: round(keptS),
    cutS: round(cutS),
    savedS: round(cutS),
    tidy: { merged: kept.merged, droppedSlivers: kept.droppedSlivers, keptSlivers: kept.keptSlivers },
    ...extra,
  };
}

function context(input) {
  const said = usableWords(input.words);
  const duration = isSeconds(input.durationS) && input.durationS > 0
    ? input.durationS : (said.length ? said[said.length - 1].end : 0);
  const fps = isSeconds(input.fps) && input.fps > 0 ? input.fps : DEFAULT_FPS;
  return {
    duration,
    frameS: 1 / fps,
    cuts: removals(input.marks),
    sounding: soundingWords(input.words, input.marks),
  };
}

/**
 * The full edit: the whole recording minus every cut.
 *
 * @param {object} input
 * @param {object[]} input.words       transcript words `{ start, end, word }`
 * @param {object[]} input.marks       cut marks `{ start, end, kind, keep_s }`
 * @param {number}   input.durationS   the recording's length
 * @param {number}   [input.fps]       its frame rate (probe.js); 30 when unknown
 * @param {string}   [input.sourceId]  this recording's id, to match a pair
 * @param {object}   [input.pair]      its `video_audio_pairs` row, as the store reads it
 * @param {number}   [input.otherDurationS] the paired recording's length, when known
 */
function fullEdit(input) {
  const ctx = context(input);
  const window = { start: 0, end: ctx.duration };
  const { kept, sound } = withSound(keepRanges(window, ctx.cuts, ctx), input, ctx);
  return summarise('full', window, kept, { sound });
}

/**
 * Where a short opens and closes: the moment, plus up to LEAD_IN_S before and
 * LEAD_OUT_S after, stopped by the nearest sounding word, the nearest stretch
 * a cut removes, and the ends of the recording.
 */
function shortWindow(moment, ctx) {
  const from = moment.start_s;
  const to = moment.end_s;
  let start = Math.max(0, from - LEAD_IN_S);
  let end = Math.min(ctx.duration, to + LEAD_OUT_S);
  for (const w of ctx.sounding) {
    if (w.end <= from + EPS && w.end > start) start = w.end;
    if (w.start >= to - EPS && w.start < end) end = w.start;
  }
  for (const c of ctx.cuts) {
    if (c.end <= from + EPS && c.end > start) start = c.end;
    if (c.start >= to - EPS && c.start < end) end = c.start;
  }
  // The moment's own times win over the lead-in rules, but never past the
  // recording's ends: a moment stamped beyond them must not reach outside.
  return { start: Math.max(0, Math.min(start, from)), end: Math.min(ctx.duration, Math.max(end, to)) };
}

/**
 * One short: a moment (2c's `{ start_s, end_s, score, ... }`) minus the cuts
 * inside it, with its lead-in and lead-out. Takes the same input as fullEdit.
 */
function shortEdit(input, moment) {
  const ctx = context(input);
  const window = shortWindow(moment, ctx);
  const { kept, sound } = withSound(keepRanges(window, ctx.cuts, ctx), input, ctx);
  return summarise('short', window, kept, {
    moment: {
      startS: moment.start_s,
      endS: moment.end_s,
      score: moment.score,
      ...(moment.quote ? { quote: moment.quote } : {}),
      ...(moment.project ? { project: moment.project } : {}),
      ...(moment.mood ? { mood: moment.mood } : {}),
    },
    leadInS: round(Math.max(0, moment.start_s - window.start)),
    leadOutS: round(Math.max(0, window.end - moment.end_s)),
    sound,
  });
}

function pickDefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Every edit one recording gets: one `full`, plus one `short` for each moment
 * scoring at least `minShortScore`, best first, at most `shortsPerRecording`.
 * A moment that is not made into a short is listed in `passedOver` with why,
 * so "no shorts" can always say whether nothing scored or nothing was scored.
 *
 * @param {object} input  as fullEdit, plus `moments` (2c's list)
 * @param {object} [deps]
 * @param {object} [deps.config] `{ minShortScore, shortsPerRecording }`, either or both;
 *   laid over editListConfig(), so naming one never unsets the other
 */
function planEdits(input, deps = {}) {
  const config = { ...editListConfig(), ...pickDefined(deps.config) };
  const ctx = context(input);
  const shorts = [];
  const passedOver = [];
  const moments = [];
  for (const m of Array.isArray(input.moments) ? input.moments : []) {
    const at = { startS: m && m.start_s, endS: m && m.end_s, score: m && m.score };
    if (!m || !isSeconds(m.start_s) || !isSeconds(m.end_s) || m.end_s <= m.start_s) {
      passedOver.push({ ...at, why: 'its times are not usable (missing, or it ends before it starts)' });
    } else if (!isSeconds(m.score)) {
      passedOver.push({ ...at, why: 'it has no score' });
    } else if (m.start_s >= ctx.duration) {
      passedOver.push({ ...at, why: `it starts at ${m.start_s} s, after the recording ends (${round(ctx.duration)} s)` });
    } else moments.push(m);
  }
  const ranked = [...moments].sort((a, b) => b.score - a.score || a.start_s - b.start_s);
  for (const m of ranked) {
    const at = { startS: m.start_s, endS: m.end_s, score: m.score };
    if (m.score < config.minShortScore) passedOver.push({ ...at, why: `scored ${m.score}, under the ${config.minShortScore} a short needs` });
    else if (shorts.length >= config.shortsPerRecording) passedOver.push({ ...at, why: `${config.shortsPerRecording} better-scoring short(s) already made for this recording` });
    else shorts.push(shortEdit(input, m));
  }
  return {
    rulesVersion: RULES_VERSION,
    config,
    full: fullEdit(input),
    shorts,
    passedOver,
  };
}

module.exports = {
  RULES_VERSION,
  DEFAULT_FPS,
  SLIVER_S,
  LEAD_IN_S,
  LEAD_OUT_S,
  DEFAULT_SHORT_MIN_SCORE,
  DEFAULT_SHORTS_PER_RECORDING,
  editListConfig,
  removals,
  soundingWords,
  keepRanges,
  soundSource,
  soundFor,
  fullEdit,
  shortEdit,
  planEdits,
};
