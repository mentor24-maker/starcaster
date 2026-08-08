'use strict';

/**
 * Theme Wizard — the generator (spec §6).
 *
 * Model choice (§6.1): candidates come from claude-fable-5, because design taste
 * is the entire product. Everything cheaper and more mechanical — reading the
 * site, deciding the three directions — runs on claude-opus-5.
 *
 * Variety (§6.2/§6.4) is the hard part and the reason this file is shaped the
 * way it is. Current models reject temperature/top_p/top_k, so you cannot get
 * three different answers by rolling the dice three times; and left to itself
 * the model reaches for the same warm cream-and-serif look every time. So the
 * three DIRECTIONS are decided first, in their own call, and each candidate is
 * then generated separately against its own committed brief. One prompt asking
 * for "three options" produces three shades of one look.
 *
 * HTTP rather than the SDK: every other Claude call in this repo is a raw fetch
 * to api.anthropic.com and @anthropic-ai/sdk is not a dependency. Matching the
 * house pattern beats introducing a second way of doing it for one feature.
 */

const { getProviderValues } = require('./apiSettings');
const { FONT_KEYS } = require('./themeWizardValidate');

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const MODEL_CANDIDATES = 'claude-fable-5';
const MODEL_UTILITY = 'claude-opus-5';

// A declined request re-runs on the recommended fallback inside the same call
// instead of failing the round (§6.6). "default" routes by refusal category, so
// there is no model list here to go stale.
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const REQUEST_TIMEOUT_MS = 180000;

const AVAILABLE_FONTS = [...FONT_KEYS].filter(Boolean).join(', ');

function clean(value) { return String(value == null ? '' : value).trim(); }

/**
 * Total billable tokens for one call. Cache reads and writes are counted
 * because they are billed — at a different rate, but a running tally that
 * ignores them under-reports what the round actually cost.
 */
function sumUsage(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  const parts = [
    usage.input_tokens,
    usage.output_tokens,
    usage.cache_creation_input_tokens,
    usage.cache_read_input_tokens,
  ];
  return parts.reduce((total, value) => {
    const num = Number(value);
    return total + (Number.isFinite(num) ? num : 0);
  }, 0);
}

function resolveApiKey() {
  const cfg = getProviderValues('anthropic') || {};
  return clean(cfg.api_key || process.env.ANTHROPIC_API_KEY);
}

/**
 * One Claude call. Returns { ok, data } where data is the parsed JSON object the
 * schema describes, or { ok: false, status, error } with a message written for
 * the operator rather than for a log.
 */
async function callClaude({ model, system, prompt, schema, maxTokens = 4000, apiKey }) {
  const key = apiKey || resolveApiKey();
  if (!key) return { ok: false, status: 400, error: 'Anthropic API key not configured.' };

  const body = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: prompt }],
    // Constrain the response to the shape we are going to parse, so a chatty
    // preamble cannot break JSON.parse.
    output_config: { format: { type: 'json_schema', schema } },
    fallbacks: 'default',
  };

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': FALLBACK_BETA,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || /abort/i.test(String(err?.message || ''));
    return {
      ok: false,
      status: 504,
      error: timedOut
        ? `The model did not answer within ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s. Nothing was saved; try the round again.`
        : `Could not reach Anthropic: ${err.message}`,
    };
  }

  const payload = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message = clean(payload?.error?.message) || 'Anthropic request failed';
    // Hazard 4.5: under zero data retention EVERY Fable 5 request 400s, and the
    // message reads like a malformed payload. Say so, or the next hour is spent
    // debugging a request body that was fine.
    if (res.status === 400 && model === MODEL_CANDIDATES && /retention|not available/i.test(message)) {
      return {
        ok: false,
        status: 400,
        error: `${MODEL_CANDIDATES} needs 30-day data retention enabled on the Anthropic account. `
          + `This is an account setting, not a problem with the request. (${message})`,
      };
    }
    return { ok: false, status: res.status || 500, error: message };
  }

  // §6.6 — a refusal is HTTP 200 with empty or partial content. Reading
  // content[0] without checking this throws on a successful response.
  if (payload?.stop_reason === 'refusal') {
    const category = clean(payload?.stop_details?.category) || 'unspecified';
    return {
      ok: false,
      status: 422,
      error: `The model declined this request (category: ${category}) and the fallback did not answer either. `
        + 'Nothing was saved.',
    };
  }

  const textBlock = (Array.isArray(payload?.content) ? payload.content : [])
    .find((block) => block?.type === 'text');
  const text = clean(textBlock?.text);
  if (!text) return { ok: false, status: 502, error: 'The model returned an empty response.' };

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, status: 502, error: 'The model returned something that is not valid JSON.' };
  }

  return {
    ok: true,
    status: 200,
    data: parsed,
    usage: payload?.usage || null,
    servedBy: clean(payload?.model) || model,
  };
}

// ---------------------------------------------------------------------------
// Step 1 — read the site into a style brief
// ---------------------------------------------------------------------------

const STYLE_BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    sector: { type: 'string', description: 'What kind of organisation this is, in a few words' },
    audience: { type: 'string', description: 'Who the site is speaking to' },
    tone: { type: 'string', description: 'The register the copy is written in' },
    formality: { type: 'string', enum: ['formal', 'neutral', 'casual'] },
    notes: { type: 'string', description: 'Anything that should shape the visual direction' },
  },
  required: ['sector', 'audience', 'tone', 'formality', 'notes'],
  additionalProperties: false,
};

/**
 * Reads the project's existing pages and normalises them into the style brief
 * that later steps reason about. Kept separate from the seed payload so
 * re-running this never destroys the original input (§5).
 */
async function buildStyleBrief({ pages, projectName }, apiKey) {
  const sample = (Array.isArray(pages) ? pages : []).slice(0, 12).map((page) => ({
    name: clean(page?.name).slice(0, 120),
    slug: clean(page?.slug).slice(0, 120),
  }));

  const prompt = [
    `Project name: ${clean(projectName) || '(unknown)'}`,
    '',
    'Pages on the current site:',
    JSON.stringify(sample, null, 2),
    '',
    'From this, describe the organisation so a designer who has never seen the site',
    'could choose a visual direction for it. Be concrete and specific. If the pages',
    'do not tell you something, say what you can actually infer rather than guessing.',
  ].join('\n');

  return callClaude({
    model: MODEL_UTILITY,
    system: 'You read websites and summarise what kind of organisation they belong to. You are concise and you do not invent facts.',
    prompt,
    schema: STYLE_BRIEF_SCHEMA,
    maxTokens: 1500,
    apiKey,
  });
}

// ---------------------------------------------------------------------------
// Step 2 — decide three genuinely distinct directions
// ---------------------------------------------------------------------------

const DIRECTIONS_SCHEMA = {
  type: 'object',
  properties: {
    // No minItems/maxItems: structured outputs rejects array length constraints
    // other than 0 or 1 with a 400. The count is stated in the prompt and
    // enforced in the caller, which has to happen anyway.
    directions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Six words or fewer, describing the look' },
          typeCharacter: { type: 'string', description: 'The type character this direction commits to' },
          colorTemperature: { type: 'string', description: 'Colour temperature and saturation this direction commits to' },
          contrastPhilosophy: { type: 'string', description: 'How much contrast this direction commits to, and why' },
        },
        required: ['label', 'typeCharacter', 'colorTemperature', 'contrastPhilosophy'],
        additionalProperties: false,
      },
    },
  },
  required: ['directions'],
  additionalProperties: false,
};

const DIRECTIONS_SYSTEM = [
  'You are an art director choosing distinct visual directions for a website.',
  '',
  'Your directions must differ on axes a non-designer can FEEL when they look at',
  'the three side by side — type character, colour temperature and saturation,',
  'and contrast philosophy. They must not be three adjectives for the same look.',
  '',
  'Tailor the axes to the organisation. A law firm and a surf school should not',
  'be offered the same three choices.',
  '',
  'Avoid defaulting to warm cream backgrounds with serif display type and a',
  'terracotta accent. It is a fine look and it is not the only one; at most one',
  'of your three directions may be in that territory.',
].join('\n');

async function deriveDirections({ styleBrief, priorDirections = [], feedback = '' }, apiKey) {
  const prompt = [
    'Organisation:',
    JSON.stringify(styleBrief || {}, null, 2),
    '',
    priorDirections.length
      ? `Directions already shown to this user in earlier rounds — do NOT propose these again:\n${priorDirections.map((d) => `- ${d}`).join('\n')}`
      : 'This is the first round.',
    '',
    feedback ? `What the user said about the previous round:\n${feedback}` : '',
    '',
    'Choose exactly three directions.',
  ].filter(Boolean).join('\n');

  return callClaude({
    model: MODEL_UTILITY,
    system: DIRECTIONS_SYSTEM,
    prompt,
    schema: DIRECTIONS_SCHEMA,
    maxTokens: 2000,
    apiKey,
  });
}

// ---------------------------------------------------------------------------
// Step 3 — generate one candidate against one committed direction
// ---------------------------------------------------------------------------

const CANDIDATE_SCHEMA = {
  type: 'object',
  properties: {
    rationale: { type: 'string', description: 'One paragraph, addressed to the site owner, explaining why it looks like this' },
    primaryColor: { type: 'string' },
    secondaryColor: { type: 'string' },
    backgroundColor: { type: 'string' },
    accentColor: { type: 'string' },
    typography: {
      type: 'object',
      properties: {
        fonts: {
          type: 'object',
          properties: {
            heading: { type: 'string' },
            body: { type: 'string' },
          },
          required: ['heading', 'body'],
          additionalProperties: false,
        },
        colors: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            heading: { type: 'string' },
            muted: { type: 'string' },
            link: { type: 'string' },
            linkHover: { type: 'string' },
          },
          required: ['text', 'heading', 'muted', 'link', 'linkHover'],
          additionalProperties: false,
        },
        scale: {
          type: 'object',
          properties: {
            baseSize: { type: 'number' },
            ratio: { type: 'number' },
            baseLineHeight: { type: 'number' },
          },
          required: ['baseSize', 'ratio', 'baseLineHeight'],
          additionalProperties: false,
        },
      },
      required: ['fonts', 'colors', 'scale'],
      additionalProperties: false,
    },
  },
  required: ['rationale', 'primaryColor', 'secondaryColor', 'backgroundColor', 'accentColor', 'typography'],
  additionalProperties: false,
};

const CANDIDATE_SYSTEM = [
  'You are designing the colour and type system for one website.',
  '',
  'You will be given ONE direction. Commit to it completely. Do not hedge toward',
  'the middle, and do not blend in the other directions you are not being shown.',
  '',
  `Fonts must be chosen from exactly this list: ${AVAILABLE_FONTS}.`,
  'Any other font name renders as nothing at all, so a name outside this list is',
  'not a near miss — it is a broken theme.',
  '',
  'Colours are six-digit hex. Text on background must stay comfortably readable;',
  'a direction that commits to low contrast still has to be legible.',
  '',
  'The rationale is read by the site owner, who is not a designer. Say what the',
  'look is going for and why it suits them. No jargon, no lists, one paragraph.',
].join('\n');

async function generateCandidate({ styleBrief, direction, lockedValues = {}, parentPatch = null, feedback = '' }, apiKey) {
  const lockEntries = Object.entries(lockedValues || {});
  const prompt = [
    'Organisation:',
    JSON.stringify(styleBrief || {}, null, 2),
    '',
    'Your direction — commit to this one:',
    JSON.stringify(direction || {}, null, 2),
    '',
    parentPatch
      ? `This round builds on a theme the user picked as their favourite. Stay recognisably related to it while moving in your direction:\n${JSON.stringify(parentPatch, null, 2)}`
      : '',
    feedback ? `What the user said about the previous round:\n${feedback}` : '',
    lockEntries.length
      ? `HARD CONSTRAINTS — these exact values were pinned by the user and must appear unchanged in your answer:\n${lockEntries.map(([k, v]) => `- ${k} = ${v}`).join('\n')}`
      : '',
    '',
    'Produce the theme.',
  ].filter(Boolean).join('\n');

  return callClaude({
    model: MODEL_CANDIDATES,
    system: CANDIDATE_SYSTEM,
    prompt,
    schema: CANDIDATE_SCHEMA,
    maxTokens: 3000,
    apiKey,
  });
}

module.exports = {
  MODEL_CANDIDATES,
  MODEL_UTILITY,
  sumUsage,
  callClaude,
  buildStyleBrief,
  deriveDirections,
  generateCandidate,
  resolveApiKey,
};
