'use strict';

/**
 * The MOMENTS — which short stretches of one recording are worth sharing on
 * their own, and a one-paragraph summary of the whole thing.
 *
 * Reel Spinner 2c (SC-828). Pure apart from ONE injected model call: given a
 * recording's transcript words, its cut marks (Reel Spinner 1b) and the
 * channel notes Dane switched on for Reel Spinner (2a's `readContextFor`), it
 * asks the AI door (whichever provider can pay) for moments of 20 to 60
 * seconds and then checks every one of them itself. The Mini pass that runs it on the queue and writes
 * `video_moments` is 2d; nothing here touches a database, a file or the queue.
 *
 * WHAT "WORTH SHARING" MEANS IS DANE'S, NOT OURS. The rubric is his channel
 * notes, read at run time and put in the prompt word for word — never pasted
 * here, never paraphrased into a viral-video rubric. What this file adds is
 * only the shape of the answer and the three questions SC-828 names: would it
 * draw the kind of person who would join WaveCenter; does it explain something
 * about the world and move people to act; does it make sense without the rest
 * of the recording. Mass appeal and entertainment are explicitly NOT scored,
 * because his notes say he is not a content creator chasing an audience.
 *
 * No notes switched on is a REFUSAL, never a score against nothing: a model
 * with no brief falls back on exactly the generic "engaging content" rubric
 * his words reject.
 *
 * THE MODEL'S ANSWER IS A PROPOSAL, NOT A RESULT. `checkAnswer` snaps every
 * start and end to a word boundary, moves a boundary that lands inside a cut
 * out of it, trims a moment that runs past the end of the recording, drops one
 * that starts past it, and clamps lengths into 20-60 s. An answer that is not
 * the agreed shape is a `failed` result with the reason — never an empty list,
 * which would read on the review screen as "nothing interesting was said".
 *
 * A moment may CONTAIN cuts (an "um", a long pause): the edit takes those out
 * later. What it may not do is start or end inside one, or the clip would open
 * on half an "uh" or on a second of silence.
 */

const { generate } = require('../../lib/aiClient.js');

/**
 * Bump when any rule below changes (the prompt, the checks, the limits), so
 * stored moments can say which rules made them and a later change can find
 * old rows and redo them. Text, because video_moments.rules_version is.
 */
const RULES_VERSION = '1';

/**
 * Which of the AI door's two tiers scores a recording. The door (lib/aiClient.js
 * `generate`, SC-843) picks the provider and its model for the tier, so this
 * file never names one: Dane switches between Anthropic, OpenAI or any other
 * provider's credit on Settings › APIs, and scoring follows.
 */
const DEFAULT_TIER = 'strong';

/**
 * Output budget. Ten moments with reasons and quotes plus the summary is about
 * 2,500 tokens; the headroom is for a long recording with many candidates.
 * Overridable with STUDIO_MOMENTS_MAX_TOKENS.
 */
const DEFAULT_MAX_TOKENS = 8000;

/** A long recording's prompt is ~30k tokens; Sonnet answers it in well under this. */
const DEFAULT_TIMEOUT_MS = 180000;

/** Dane's numbers (SC-828): a moment is 20 to 60 seconds long. */
const MIN_S = 20;
const MAX_S = 60;

/** How many moments to ask for. The review screen shows the best first. */
const MAX_MOMENTS = 10;

/**
 * What a moment can speak to. Canonical spelling first; matched without case
 * or spaces so "Wave Center" and "starcaster" land on the same one.
 */
const PROJECTS = ['WaveCenter', 'DEO', 'Alphire', 'StarCaster', 'Spirality', 'personal story'];

/**
 * The mood word, used later to pick music (Reel Spinner 5). A short fixed
 * list on purpose: a free word cannot be matched to a track.
 */
const MOODS = ['hopeful', 'urgent', 'reflective', 'determined', 'playful', 'calm'];

/** The exact refusal SC-828 names, so the review screen can say it as written. */
const NO_BRIEF_REASON = 'no Reel Spinner notes switched on in this project';

/** A transcript line is cut here, so the model can place a moment to ~5 s. */
const LINE_MAX_S = 5;

/** Times within this many seconds are the same instant (as in cutMarks.js). */
const EPS = 0.005;

const FEATURE = 'studio_reel_moments';

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function isSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function keyOf(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

const PROJECT_BY_KEY = new Map(PROJECTS.map((p) => [keyOf(p), p]));
// The spoken forms Dane uses for the same things.
PROJECT_BY_KEY.set('personal', 'personal story');
PROJECT_BY_KEY.set('daneofearth', 'personal story');
PROJECT_BY_KEY.set('deomovement', 'DEO');
const MOOD_BY_KEY = new Map(MOODS.map((m) => [keyOf(m), m]));

/**
 * Tier and output budget from the environment, falling back to the defaults.
 * A budget that is not a positive whole number is ignored, not obeyed, and a
 * tier the door does not have is ignored the same way.
 */
function momentsConfig(env = process.env) {
  const tier = ['fast', 'strong'].includes(String(env.STUDIO_MOMENTS_TIER || '').trim())
    ? String(env.STUDIO_MOMENTS_TIER).trim() : DEFAULT_TIER;
  const asked = Number(env.STUDIO_MOMENTS_MAX_TOKENS);
  const maxTokens = Number.isInteger(asked) && asked > 0 ? asked : DEFAULT_MAX_TOKENS;
  return { tier, maxTokens, timeoutMs: DEFAULT_TIMEOUT_MS };
}

/** Every provider's way of saying "the answer hit the token limit". */
const CUT_OFF = new Set(['max_tokens', 'length', 'MAX_TOKENS']);

/**
 * The default model call: one request through the AI door, in the shape
 * `scoreMoments` reads. The door's failure `code` comes back with it, because
 * the Mini pass treats "no provider can pay" (`no_provider`) as the machine's
 * fault and everything else as this recording's.
 */
async function queryThroughDoor(system, user, options = {}, door = generate) {
  const res = await door({
    feature: options.feature || FEATURE,
    scope: options.scope || null,
    system,
    messages: user,
    tier: options.tier || DEFAULT_TIER,
    maxTokens: options.maxTokens,
    timeoutMs: options.timeoutMs,
  });
  if (!res || !res.ok) {
    return {
      ok: false,
      error: (res && res.error) || 'the AI door gave no answer',
      code: (res && res.code) || 'no_answer',
      skipped: (res && res.skipped) || [],
    };
  }
  return {
    ok: true,
    text: res.text,
    provider: res.provider,
    providerLabel: res.providerLabel,
    model: res.provider ? `${res.provider}/${res.model}` : res.model,
    usage: res.usage || null,
    stopReason: res.stopReason,
    skipped: res.skipped || [],
  };
}

/** Words with usable times, in order. whisper's words carry `{ start, end, word }`. */
function usableWords(words) {
  if (!Array.isArray(words)) return [];
  return words
    .filter((w) => w && isSeconds(w.start) && isSeconds(w.end) && w.end >= w.start
      && String(w.word == null ? '' : w.word).trim())
    .map((w) => ({ start: w.start, end: w.end, word: String(w.word).trim() }))
    .sort((a, b) => a.start - b.start);
}

/** Cut marks as `{ start, end, kind }`, in order. Only the span matters here. */
function usableCuts(marks) {
  if (!Array.isArray(marks)) return [];
  return marks
    .filter((m) => m && isSeconds(m.start) && isSeconds(m.end) && m.end > m.start)
    .map((m) => ({ start: m.start, end: m.end, kind: String(m.kind || 'cut') }))
    .sort((a, b) => a.start - b.start);
}

/** `[12.40-16.90] words said in those seconds`, a new line every ~5 s or at a gap. */
function transcriptLines(words) {
  const lines = [];
  let line = null;
  for (const w of words) {
    if (line && (w.end - line.start > LINE_MAX_S || w.start - line.end > 1)) {
      lines.push(line);
      line = null;
    }
    if (!line) line = { start: w.start, end: w.end, text: [] };
    line.end = w.end;
    line.text.push(w.word);
  }
  if (line) lines.push(line);
  return lines.map((l) => `[${l.start.toFixed(2)}-${l.end.toFixed(2)}] ${l.text.join(' ')}`);
}

/**
 * The prompt. `brief.text` goes in untouched, between markers, so a reviewer
 * can see it is Dane's words and not ours.
 *
 * @returns {{ system: string, user: string }}
 */
function buildPrompt({ words, marks, brief, durationS }) {
  const said = usableWords(words);
  const cuts = usableCuts(marks);
  const length = isSeconds(durationS) && durationS > 0 ? durationS : (said.length ? said[said.length - 1].end : 0);

  const system = [
    'You help Dane choose short clips from his own recordings to share on his channel.',
    'What the channel is for is in his own words below, between the BRIEF markers.',
    'Everything you judge, you judge against that brief and nothing else.',
    '',
    '=== BRIEF (Dane\'s words) ===',
    String(brief.text),
    '=== END BRIEF ===',
    '',
    'Score each moment 0-100 on three questions, together:',
    '1. Would it draw the kind of person who would want to join WaveCenter or the other projects in the brief?',
    '2. Does it explain something about the world and move people to act?',
    '3. Does it make sense on its own, to someone who has not seen the rest of the recording?',
    'Do NOT score for mass appeal, virality or entertainment value. The brief rules those out.',
    'A screen-share narration that only makes sense while watching the screen fails question 3.',
    '',
    'Answer with ONE JSON object and nothing else, in exactly this shape:',
    '{',
    '  "summary": "one plain paragraph: what this recording is about and who it is for",',
    '  "moments": [',
    '    {',
    '      "start_s": 123.4,',
    '      "end_s": 160.2,',
    '      "score": 0-100,',
    '      "reasons": ["plain sentence", "plain sentence"],',
    `      "project": one of ${PROJECTS.map((p) => JSON.stringify(p)).join(', ')},`,
    `      "mood": one of ${MOODS.map((m) => JSON.stringify(m)).join(', ')},`,
    '      "quote": "the words that carry the moment, exactly as in the transcript"',
    '    }',
    '  ],',
    '  "none_reason": "only when moments is empty: why nothing here stands on its own"',
    '}',
    '',
    `Rules: up to ${MAX_MOMENTS} moments, best first. Each is ${MIN_S} to ${MAX_S} seconds long.`,
    'Start where a thought starts and end where it ends. Moments must not overlap each other.',
    'Never start or end a moment inside one of the CUTS listed with the transcript; a moment may contain cuts.',
    'Times are seconds from the start of the recording, taken from the transcript\'s line times.',
    'Reasons name which part of the brief the moment serves, in plain words.',
  ].join('\n');

  const user = [
    `Recording length: ${round(length)} s.`,
    '',
    'TRANSCRIPT (each line: [start-end seconds] words):',
    ...transcriptLines(said),
    '',
    cuts.length
      ? 'CUTS (stretches the edit removes: [start-end seconds] kind):'
      : 'CUTS: none.',
    ...cuts.map((c) => `[${c.start.toFixed(2)}-${c.end.toFixed(2)}] ${c.kind}`),
  ].join('\n');

  return { system, user };
}

/** The model's text → the JSON object in it, or a reason it is not one. */
function parseAnswer(text) {
  let body = String(text == null ? '' : text).trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(body);
  if (fenced) body = fenced[1];
  if (!body.startsWith('{')) {
    const first = body.indexOf('{');
    const last = body.lastIndexOf('}');
    if (first < 0 || last <= first) return { ok: false, reason: 'the answer had no JSON object in it' };
    body = body.slice(first, last + 1);
  }
  try {
    const value = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, reason: 'the answer was JSON but not an object' };
    }
    return { ok: true, value };
  } catch (err) {
    return { ok: false, reason: `the answer was not valid JSON (${err.message})` };
  }
}

function cutContaining(cuts, t) {
  return cuts.find((c) => t > c.start + EPS && t < c.end - EPS) || null;
}

/** Index of the first word that ends after `t` (the word `t` is in, or the next one). */
function wordAtOrAfter(words, t) {
  for (let i = 0; i < words.length; i += 1) if (words[i].end > t + EPS) return i;
  return -1;
}

/** Index of the last word that starts before `t`. */
function wordAtOrBefore(words, t) {
  for (let i = words.length - 1; i >= 0; i -= 1) if (words[i].start < t - EPS) return i;
  return -1;
}

/** The first word whose start is not inside a cut, from index `i` on. */
function startWordFrom(words, cuts, i) {
  for (let k = i; k >= 0 && k < words.length; k += 1) if (!cutContaining(cuts, words[k].start)) return k;
  return -1;
}

/** The last word whose end is not inside a cut, from index `i` back. */
function endWordFrom(words, cuts, i, floor) {
  for (let k = i; k >= floor; k -= 1) if (!cutContaining(cuts, words[k].end)) return k;
  return -1;
}

/**
 * Put one proposed moment on word boundaries, clear of every cut, inside the
 * recording and 20-60 s long — or say why it cannot be.
 *
 * @returns {{ ok: true, start: number, end: number, changed: string[] } | { ok: false, why: string }}
 */
function placeMoment(startS, endS, words, cuts, durationS) {
  const changed = [];
  if (startS >= durationS - EPS) return { ok: false, why: `starts at ${round(startS)} s, after the recording ends (${round(durationS)} s)` };
  if (endS <= startS) return { ok: false, why: `ends (${round(endS)} s) before it starts (${round(startS)} s)` };
  let start = Math.max(0, startS);
  let end = endS;
  if (startS < 0) changed.push('start moved up to the beginning of the recording');
  if (end > durationS + EPS) {
    end = durationS;
    changed.push(`end trimmed to the end of the recording (${round(durationS)} s)`);
  }

  let first = startWordFrom(words, cuts, wordAtOrAfter(words, start));
  if (first < 0) return { ok: false, why: 'no word is said after its start' };
  let last = endWordFrom(words, cuts, wordAtOrBefore(words, end), first);
  if (last < first) return { ok: false, why: 'no word is said between its start and end' };

  // Too long: bring the end back to the last clear word inside 60 s.
  if (words[last].end - words[first].start > MAX_S + EPS) {
    const limit = words[first].start + MAX_S;
    let k = last;
    while (k > first && words[k].end > limit + EPS) k -= 1;
    k = endWordFrom(words, cuts, k, first);
    if (k < first) return { ok: false, why: `could not be cut down to ${MAX_S} s on a word boundary` };
    last = k;
    changed.push(`shortened to ${MAX_S} s or less`);
  }

  // Too short: carry the end on to the first clear word that reaches 20 s.
  if (words[last].end - words[first].start < MIN_S - EPS) {
    const need = words[first].start + MIN_S;
    let k = last;
    while (k < words.length - 1 && (words[k].end < need - EPS || cutContaining(cuts, words[k].end))) k += 1;
    const span = words[k].end - words[first].start;
    if (span < MIN_S - EPS || span > MAX_S + EPS || cutContaining(cuts, words[k].end)) {
      return { ok: false, why: `is under ${MIN_S} s and cannot be lengthened inside the recording` };
    }
    last = k;
    changed.push(`lengthened to ${MIN_S} s`);
  }

  const snappedStart = words[first].start;
  const snappedEnd = words[last].end;
  if (Math.abs(snappedStart - start) > EPS || Math.abs(snappedEnd - end) > EPS) changed.push('snapped to word boundaries');
  return { ok: true, start: round(snappedStart), end: round(snappedEnd), changed };
}

function reasonsOf(value) {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return null;
  const out = value.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim());
  return out.length ? out : null;
}

/**
 * Check one parsed answer against the recording. Every moment that survives is
 * on word boundaries, clear of every cut, inside the recording, 20-60 s, and
 * not overlapping a better one. The answer as a whole is refused (`ok: false`)
 * when it is not the agreed shape, or when it proposed moments and NONE
 * survived — an empty list there would read as "nothing worth sharing" when the
 * truth is "the answer was unusable".
 *
 * @returns {{ ok: true, summary: string, moments: object[], dropped: object[], noneReason: string|null }
 *          | { ok: false, reason: string, dropped?: object[] }}
 */
function checkAnswer(answer, { words, marks, durationS }) {
  if (!answer || typeof answer !== 'object') return { ok: false, reason: 'the answer was not an object' };
  const summary = typeof answer.summary === 'string' ? answer.summary.trim() : '';
  if (!summary) return { ok: false, reason: 'the answer had no summary' };
  if (!Array.isArray(answer.moments)) return { ok: false, reason: 'the answer had no "moments" list' };

  const said = usableWords(words);
  const cuts = usableCuts(marks);
  if (!said.length) return { ok: false, reason: 'the recording has no transcribed words to place moments on' };
  const length = isSeconds(durationS) && durationS > 0 ? durationS : said[said.length - 1].end;

  if (!answer.moments.length) {
    const noneReason = typeof answer.none_reason === 'string' ? answer.none_reason.trim() : '';
    if (!noneReason) return { ok: false, reason: 'the answer listed no moments and gave no reason why' };
    return { ok: true, summary, moments: [], dropped: [], noneReason };
  }

  const dropped = [];
  const placed = [];
  answer.moments.forEach((m, index) => {
    const drop = (why) => dropped.push({ index, why });
    if (!m || typeof m !== 'object') return drop('is not an object');
    if (!isSeconds(m.start_s) || !isSeconds(m.end_s)) return drop('has no start_s/end_s in seconds');
    if (!isSeconds(m.score) || m.score < 0 || m.score > 100) return drop('has no score from 0 to 100');
    const reasons = reasonsOf(m.reasons);
    if (!reasons) return drop('gives no reasons');
    const project = PROJECT_BY_KEY.get(keyOf(m.project));
    if (!project) return drop(`names a project not on the list (${JSON.stringify(m.project)})`);
    const mood = MOOD_BY_KEY.get(keyOf(m.mood));
    if (!mood) return drop(`names a mood not on the list (${JSON.stringify(m.mood)})`);
    const quote = typeof m.quote === 'string' ? m.quote.trim() : '';
    if (!quote) return drop('has no quote');
    const spot = placeMoment(m.start_s, m.end_s, said, cuts, length);
    if (!spot.ok) return drop(spot.why);
    placed.push({
      index,
      start_s: spot.start,
      end_s: spot.end,
      score: Math.round(m.score),
      reasons,
      project,
      mood,
      quote,
      adjusted: spot.changed,
    });
  });

  // Best first; a moment overlapping a better one already kept is dropped.
  placed.sort((a, b) => b.score - a.score || a.start_s - b.start_s);
  const moments = [];
  for (const p of placed) {
    const clash = moments.find((k) => p.start_s < k.end_s - EPS && p.end_s > k.start_s + EPS);
    if (clash) {
      dropped.push({ index: p.index, why: `overlaps a better moment (${clash.start_s}-${clash.end_s} s)` });
      continue;
    }
    moments.push(p);
  }
  dropped.sort((a, b) => a.index - b.index);

  if (!moments.length) {
    return {
      ok: false,
      reason: `none of the ${answer.moments.length} moment(s) in the answer could be used: `
        + dropped.map((d) => `#${d.index + 1} ${d.why}`).join('; '),
      dropped,
    };
  }
  return {
    ok: true,
    summary,
    moments: moments.map(({ index, ...rest }) => rest),
    dropped,
    noneReason: null,
  };
}

/**
 * Score one recording. Never throws. The result is the row 2d writes:
 *
 *   { state: 'done', summary, moments, dropped, briefFingerprint, model, provider, rulesVersion, usage }
 *   { state: 'failed', reason, retryable, callCode?, skipped?, briefFingerprint, model, rulesVersion, usage? }
 *
 * `model` is `<provider>/<model>` as the AI door reports the one that ANSWERED
 * (provider id, a slash, then the model id), or '' when no call was made.
 *
 * `retryable` is true only when the CALL failed (network, credit, rate limit,
 * timeout) — the same recording may well succeed later; `callCode` is then the
 * door's code (`no_provider`, `no_answer`, `provider_error`, ...) and
 * `skipped` the providers it could not use and why. A refused
 * brief or an unusable answer is not retryable as-is.
 *
 * @param {object} input
 * @param {object[]} input.words     transcript words `{ start, end, word }`
 * @param {object[]} input.marks     cut marks `{ start, end, kind }`
 * @param {number}   input.durationS the recording's length
 * @param {{ text: string, fingerprint: string }} input.brief  2a's readContextFor result
 * @param {object} [deps]
 * @param {Function} [deps.query]  `(system, user, options) → { ok, text, usage, model, provider, error, code }`; the AI door by default
 * @param {object}   [deps.config] `{ tier, maxTokens, timeoutMs }`; momentsConfig() by default
 * @param {object}   [deps.scope]  project scope for usage metering
 */
async function scoreMoments(input, deps = {}) {
  const config = deps.config || momentsConfig();
  const query = deps.query || queryThroughDoor;
  const brief = (input && input.brief) || {};
  const briefText = typeof brief.text === 'string' ? brief.text.trim() : '';
  const briefFingerprint = typeof brief.fingerprint === 'string' && brief.fingerprint.trim()
    ? brief.fingerprint.trim() : null;
  const base = { briefFingerprint, model: '', rulesVersion: RULES_VERSION };
  const failed = (reason, retryable, extra = {}) => ({ state: 'failed', reason, retryable, ...base, ...extra });

  if (!briefText) return failed(NO_BRIEF_REASON, false);
  if (!briefFingerprint) return failed('the Reel Spinner notes came without a fingerprint, so a later edit to them could not be told apart', false);
  if (!usableWords(input.words).length) return failed('the recording has no transcribed words to score', false);

  const { system, user } = buildPrompt({ ...input, brief: { text: briefText } });
  let res;
  try {
    res = await query(system, user, {
      tier: config.tier,
      maxTokens: config.maxTokens,
      timeoutMs: config.timeoutMs,
      feature: FEATURE,
      scope: deps.scope || null,
    });
  } catch (err) {
    return failed(`the call to the AI door failed: ${err && err.message ? err.message : err}`, true, { callCode: 'no_answer' });
  }
  if (!res || !res.ok) {
    return failed(`the call to the AI door failed: ${(res && res.error) || 'no answer'}`, true,
      { callCode: (res && res.code) || 'no_answer', skipped: (res && res.skipped) || [] });
  }
  const usage = res.usage || null;
  const answered = { model: res.model || '', provider: res.provider || '' };
  if (CUT_OFF.has(res.stopReason)) {
    return failed(`the answer was cut off at the ${config.maxTokens}-token limit`, false, { usage, ...answered });
  }

  const parsed = parseAnswer(res.text);
  if (!parsed.ok) return failed(parsed.reason, false, { usage, ...answered });
  const checked = checkAnswer(parsed.value, input);
  if (!checked.ok) return failed(checked.reason, false, { usage, ...answered, dropped: checked.dropped || [] });

  return {
    state: 'done',
    summary: checked.summary,
    moments: checked.moments,
    dropped: checked.dropped,
    noneReason: checked.noneReason,
    ...base,
    ...answered,
    usage,
  };
}

module.exports = {
  RULES_VERSION,
  DEFAULT_TIER,
  FEATURE,
  DEFAULT_MAX_TOKENS,
  MIN_S,
  MAX_S,
  MAX_MOMENTS,
  PROJECTS,
  MOODS,
  NO_BRIEF_REASON,
  momentsConfig,
  queryThroughDoor,
  buildPrompt,
  transcriptLines,
  parseAnswer,
  placeMoment,
  checkAnswer,
  scoreMoments,
};
