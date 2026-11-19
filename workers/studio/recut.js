'use strict';

/**
 * THE RE-CUT — Dane's note on a rough cut, turned into a new edit.
 *
 * Reel Spinner 4d (SC-836). When he sends a rough cut back with a note ("start
 * at the part about water rights", "cut the bit where I lose my train of
 * thought"), the AI door reads the note, the edit as it stands and the timed
 * transcript, and answers with the stretches of the recording to keep. This
 * file builds that question, reads the answer, and puts the answer through
 * the edit-list rules (workers/studio/editList.js) before anything is
 * rendered. workers/studio/recutPass.js does the rest.
 *
 * THE AI ANSWERS COARSELY, AND THE RULES DO THE FINE WORK. A full edit of an
 * hour's recording keeps hundreds of stretches, because every pause, "um" and
 * repeat is a gap. Asking a model to write all of those back is slow, costly
 * and easy to get wrong, and it is not what the note is about. So the edit is
 * shown to it as its SPOKEN stretches — kept ranges joined across every gap
 * where no word sounds (the gaps the cut marks made) — and it answers in the
 * same shape. The answer then has the cut marks taken out again with the
 * same `keepRanges` rule the first cut used, so a re-cut can never bring back
 * a pause or a filler the first cut removed.
 *
 * WHAT THE RULES CHECK, and refuse rather than guess at:
 *   - every stretch is a pair of numbers of seconds, start before end;
 *   - inside the recording (a hair past the end is trimmed, not refused);
 *   - in order and not overlapping;
 *   - something is kept, and it is not the edit he sent back unchanged.
 * A boundary that lands inside a word is moved to that word's edge, outwards,
 * so the word is kept whole: when unsure, keep the speech (cutMarks.js,
 * editList.js). A refusal comes back with the reason, and the edit goes back
 * to him unchanged with that reason on its card. Never silently.
 *
 * Through `generate()` (lib/aiClient.js, SC-843), never a provider by name;
 * the door meters the call itself, under FEATURE.
 */

const { generate } = require('../../lib/aiClient.js');
const { removals, soundingWords, keepRanges, soundFor } = require('./editList.js');

/** What the spend is metered under. */
const FEATURE = 'studio_recut';
/** A note is Dane's judgment about his own words: the strong tier. */
const DEFAULT_TIER = 'strong';
/** The answer is a short list of stretches and one sentence. */
const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_TIMEOUT_MS = 120 * 1000;

/** Bump when the question or the rules below change. */
const RULES_VERSION = '1';

/** How many re-cuts one edit gets before the Mini stops and says so. */
const MAX_RECUTS = 3;

/** Without a measured frame rate, a frame is this long (30 fps), as in editList.js. */
const DEFAULT_FPS = 30;
/** Times within this many seconds are the same instant. */
const EPS = 0.005;
/** An answer may run this far past the recording's end and be trimmed rather than refused. */
const END_SLACK_S = 0.5;
/** Seconds per transcript line in the question. */
const LINE_MAX_S = 5;

/** Every provider's way of saying "the answer hit the token limit". */
const CUT_OFF = new Set(['max_tokens', 'length', 'MAX_TOKENS']);

function text(value) {
  return String(value == null ? '' : value).trim();
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function isSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function secondsText(s) {
  return `${round(s).toFixed(2)}`;
}

function recutConfig(env = process.env) {
  const tier = ['fast', 'strong'].includes(text(env.STUDIO_RECUT_TIER)) ? text(env.STUDIO_RECUT_TIER) : DEFAULT_TIER;
  const asked = Number(env.STUDIO_RECUT_MAX_TOKENS);
  const maxTokens = Number.isInteger(asked) && asked > 0 ? asked : DEFAULT_MAX_TOKENS;
  return { tier, maxTokens, timeoutMs: DEFAULT_TIMEOUT_MS };
}

/** `[{ start_s, end_s }]` (the row's shape) as `[{ start, end }]`, usable ones only, in order. */
function fromRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && isSeconds(r.start_s) && isSeconds(r.end_s) && r.end_s > r.start_s)
    .map((r) => ({ start: r.start_s, end: r.end_s }))
    .sort((a, b) => a.start - b.start);
}

function toRows(ranges) {
  return ranges.map((r) => ({ start_s: round(r.start), end_s: round(r.end) }));
}

function totalS(ranges) {
  return ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
}

function soundsIn(sounding, start, end) {
  return sounding.some((w) => w.start < end - EPS && w.end > start + EPS);
}

/**
 * The edit as SPOKEN stretches: its kept ranges joined across every gap in
 * which no word sounds. Those gaps are the cut marks' work (a pause, a filler,
 * a repeat: soundingWords takes every mark's span off the words), so what is
 * left is where the edit really cuts something someone said — which is what a
 * note talks about.
 */
function spokenStretches(ranges, sounding) {
  const out = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && !soundsIn(sounding, last.end, r.start)) last.end = Math.max(last.end, r.end);
    else out.push({ start: r.start, end: r.end });
  }
  return out;
}

/** `[12.40-16.90] words said in those seconds`, a new line every ~5 s or at a gap. */
function transcriptLines(sounding) {
  const lines = [];
  let line = null;
  for (const w of sounding) {
    if (line && (w.end - line.start > LINE_MAX_S || w.start - line.end > 1)) {
      lines.push(line);
      line = null;
    }
    if (!line) line = { start: w.start, end: w.end, words: [] };
    line.end = w.end;
    line.words.push(w.word);
  }
  if (line) lines.push(line);
  return lines.map((l) => `[${secondsText(l.start)}-${secondsText(l.end)}] ${l.words.join(' ')}`);
}

/** The words said inside one stretch, shortened in the middle when long. */
function wordsIn(sounding, start, end, max = 24) {
  const said = sounding.filter((w) => w.start < end - EPS && w.end > start + EPS).map((w) => w.word);
  if (said.length <= max) return said.join(' ');
  return `${said.slice(0, max / 2).join(' ')} … ${said.slice(-max / 2).join(' ')}`;
}

/**
 * The question. `input` is the edit's kind, its keep ranges (row shape), the
 * note, and the recording's words, cut marks and length.
 */
function buildRecutPrompt(input) {
  const sounding = soundingWords(input.words, input.marks);
  const stretches = spokenStretches(fromRows(input.keepRanges), sounding);
  const duration = isSeconds(input.durationS) ? input.durationS : 0;
  const system = [
    'You re-edit a video from the editor\'s note. The video is cut from one recording; an edit is the list of',
    'stretches of that recording it keeps, played one after another.',
    '',
    'Answer ONLY with JSON, one of:',
    '  {"keep": [{"start_s": <seconds>, "end_s": <seconds>}, ...], "changed": "<one plain sentence saying what you changed>"}',
    '  {"cannot": "<one plain sentence saying why the note cannot be done by choosing what to keep>"}',
    '',
    'Rules:',
    '- Times are seconds on the RECORDING\'s clock, taken from the transcript\'s [start-end] stamps.',
    '- List stretches in order, not overlapping, inside the recording.',
    '- Answer in broad spoken stretches, like the current edit is shown to you. Pauses, "um"s, repeats and false',
    '  starts inside a stretch are removed automatically afterwards, so never split a stretch just to drop one.',
    '- Start and end each stretch between words, never in the middle of one.',
    '- Change only what the note asks for; keep everything else of the current edit exactly as it is.',
    '- The note may ask for something outside the current edit (for a short: "start earlier"); any part of the',
    '  recording may be kept.',
    '- If the note asks for something that is not a choice of what to keep (music, colour, titles, a different',
    '  recording, re-recording), or you cannot find what it refers to, answer with "cannot".',
  ].join('\n');
  const user = [
    `This is a ${input.kind === 'short' ? 'short clip' : 'full edit'} of a ${secondsText(duration)}-second recording.`,
    '',
    'The editor\'s note:',
    `"${text(input.note)}"`,
    '',
    'The current edit keeps these spoken stretches:',
    ...(stretches.length
      ? stretches.map((s) => `  ${secondsText(s.start)}-${secondsText(s.end)}: ${wordsIn(sounding, s.start, s.end) || '(no words)'}`)
      : ['  (nothing)']),
    '',
    'The recording\'s transcript:',
    ...transcriptLines(sounding),
  ].join('\n');
  return { system, user, stretches };
}

/** The answer's JSON, from the door's parse or from the text (a fenced block is unwrapped). */
function parseRecutAnswer(res) {
  if (res && res.json && typeof res.json === 'object') return { ok: true, value: res.json };
  const raw = text(res && res.text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!raw) return { ok: false, reason: 'the AI gave an empty answer' };
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'the AI\'s answer was not a JSON object' };
    return { ok: true, value };
  } catch (err) {
    return { ok: false, reason: `the AI's answer was not JSON (${err.message})` };
  }
}

/** A boundary inside a sounding word moves to that word's edge, outwards. */
function widenToWords(range, sounding) {
  let { start, end } = range;
  const moved = [];
  for (const w of sounding) {
    if (start > w.start + EPS && start < w.end - EPS) {
      moved.push(`${secondsText(start)} s was inside "${w.word}", so the stretch starts at ${secondsText(w.start)} s`);
      start = w.start;
    }
    if (end > w.start + EPS && end < w.end - EPS) {
      moved.push(`${secondsText(end)} s was inside "${w.word}", so the stretch ends at ${secondsText(w.end)} s`);
      end = w.end;
    }
  }
  return { range: { start, end }, moved };
}

function sameRanges(a, b) {
  return a.length === b.length && a.every((r, i) => Math.abs(r.start - b[i].start) < 0.001 && Math.abs(r.end - b[i].end) < 0.001);
}

/**
 * Put the answer through the rules. `input` as buildRecutPrompt, plus `fps`,
 * and — when the edit uses another recording's sound — `sourceId`, `pair` and
 * `otherDurationS`, so the new picture is checked against the stretch that
 * recording covers, exactly as the first cut was (editList.js soundFor).
 *
 * @returns {{ ok: true, ranges: {start_s,end_s}[], audioSourceId: string|null, stretches, notes: string[], soundWhy: string }
 *         | { ok: false, reason: string }}
 */
function checkRecut(answer, input) {
  if (text(answer.cannot)) return { ok: false, reason: `the AI says ${text(answer.cannot)}` };
  if (!Array.isArray(answer.keep)) return { ok: false, reason: 'the AI\'s answer had neither a list of stretches to keep nor a reason it could not' };
  const duration = isSeconds(input.durationS) && input.durationS > 0 ? input.durationS : 0;
  if (!duration) return { ok: false, reason: 'the recording\'s length is not known, so no stretch could be checked against it' };
  const sounding = soundingWords(input.words, input.marks);
  const notes = [];
  const asked = [];
  for (let i = 0; i < answer.keep.length; i += 1) {
    const item = answer.keep[i];
    const n = `stretch ${i + 1}`;
    if (!item || !isSeconds(item.start_s) || !isSeconds(item.end_s)) return { ok: false, reason: `${n} of the AI's answer is not a pair of numbers of seconds` };
    if (item.start_s >= item.end_s) return { ok: false, reason: `${n} of the AI's answer ends (${item.end_s} s) before it starts (${item.start_s} s)` };
    if (item.start_s < -EPS || item.start_s >= duration) {
      return { ok: false, reason: `${n} of the AI's answer starts at ${item.start_s} s, outside the ${secondsText(duration)}-second recording` };
    }
    if (item.end_s > duration + END_SLACK_S) {
      return { ok: false, reason: `${n} of the AI's answer ends at ${item.end_s} s, past the end of the ${secondsText(duration)}-second recording` };
    }
    const previous = asked[asked.length - 1];
    if (previous && item.start_s < previous.end - EPS) {
      return { ok: false, reason: `${n} of the AI's answer starts at ${item.start_s} s, before the stretch before it ends (${round(previous.end)} s)` };
    }
    const widened = widenToWords({ start: Math.max(0, item.start_s), end: Math.min(duration, item.end_s) }, sounding);
    notes.push(...widened.moved);
    asked.push(widened.range);
  }
  if (!asked.length) return { ok: false, reason: 'the AI\'s answer keeps nothing, so there would be no video' };

  // The same rule the first cut used: the cut marks come out of each stretch,
  // a cut under a frame is joined over, a sliver with no word in it goes.
  const fps = isSeconds(input.fps) && input.fps > 0 ? input.fps : DEFAULT_FPS;
  const cuts = removals(input.marks);
  let ranges = [];
  for (const r of asked) {
    ranges.push(...keepRanges(r, cuts, { frameS: 1 / fps, sounding }).ranges);
  }
  // Widening can make two stretches touch; join them so the list stays in order.
  ranges = ranges.sort((a, b) => a.start - b.start).reduce((out, r) => {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + EPS) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
    return out;
  }, []);
  if (!ranges.length) return { ok: false, reason: 'once the pauses and fillers were taken out, the AI\'s stretches kept nothing' };

  let audioSourceId = text(input.audioSourceId) || null;
  let soundWhy = '';
  const ownId = text(input.sourceId).toLowerCase();
  if (audioSourceId && audioSourceId.toLowerCase() !== ownId) {
    const sound = soundFor(ranges, input.sourceId, input.pair || null, input.otherDurationS, sounding);
    ranges = sound.pictureRanges;
    audioSourceId = sound.sourceId || null;
    soundWhy = sound.why;
    if (!ranges.length) return { ok: false, reason: 'the other recording\'s sound covers none of the AI\'s stretches' };
  }

  if (sameRanges(ranges, fromRows(input.keepRanges))) {
    return { ok: false, reason: 'the AI\'s edit came out the same as the one you sent back' };
  }
  return { ok: true, ranges: toRows(ranges), audioSourceId, notes, soundWhy, keptS: round(totalS(ranges)) };
}

/** The door's call, in the shape `recutFromNote` reads; the door's failure `code` comes back with it. */
async function queryThroughDoor(system, user, options = {}, door = generate) {
  return door({
    feature: FEATURE,
    scope: options.scope || null,
    system,
    messages: user,
    json: true,
    tier: options.tier || DEFAULT_TIER,
    maxTokens: options.maxTokens,
    timeoutMs: options.timeoutMs,
  });
}

/**
 * Is a failed call the MACHINE's fault? No provider able to pay, or no network
 * at all (2d's rule, workers/studio/momentsPass.js isMachineFault). A timeout
 * is not: it may be this note's question.
 */
function isMachineCode(code, error) {
  if (code === 'no_provider') return true;
  if (code === 'no_answer') return !/no answer within/i.test(text(error));
  return false;
}

/**
 * Ask, read, check.
 *
 * @returns {Promise<
 *   { state: 'done', ranges, audioSourceId, changed, notes, soundWhy, keptS, model, provider, usage }
 * | { state: 'refused', reason, model?, usage? }                the note could not become a valid edit
 * | { state: 'failed', machine: boolean, reason, code, skipped }   the call itself failed
 * >}
 */
async function recutFromNote(input, deps = {}) {
  const config = deps.config || recutConfig();
  const query = deps.query || queryThroughDoor;
  if (!text(input.note)) return { state: 'refused', reason: 'there is no note on it saying what to change' };
  const { system, user } = buildRecutPrompt(input);
  let res;
  try {
    res = await query(system, user, { ...config, scope: deps.scope || null });
  } catch (err) {
    return { state: 'failed', machine: false, reason: `the call to the AI door failed: ${err && err.message ? err.message : err}`, code: 'no_answer', skipped: [] };
  }
  if (!res || !res.ok) {
    const code = (res && res.code) || 'no_answer';
    const error = (res && res.error) || 'no answer';
    if (code === 'bad_json') return { state: 'refused', reason: `the AI's answer could not be read: ${error}` };
    return { state: 'failed', machine: isMachineCode(code, error), reason: `the call to the AI door failed: ${error}`, code, skipped: (res && res.skipped) || [] };
  }
  const answered = { model: res.provider ? `${res.provider}/${res.model}` : text(res.model), provider: text(res.provider), usage: res.usage || null };
  if (CUT_OFF.has(res.stopReason)) return { state: 'refused', reason: `the AI's answer was cut off at the ${config.maxTokens}-token limit`, ...answered };
  const parsed = parseRecutAnswer(res);
  if (!parsed.ok) return { state: 'refused', reason: parsed.reason, ...answered };
  const checked = checkRecut(parsed.value, input);
  if (!checked.ok) return { state: 'refused', reason: checked.reason, ...answered };
  return { state: 'done', changed: text(parsed.value.changed), ...checked, ...answered };
}

module.exports = {
  FEATURE,
  DEFAULT_TIER,
  RULES_VERSION,
  MAX_RECUTS,
  recutConfig,
  spokenStretches,
  buildRecutPrompt,
  parseRecutAnswer,
  checkRecut,
  queryThroughDoor,
  isMachineCode,
  recutFromNote,
};
