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
async function callClaude({ model, system, prompt, content, schema, tools, expectText = false, maxTokens = 4000, apiKey }) {
  const key = apiKey || resolveApiKey();
  if (!key) return { ok: false, status: 400, error: 'Anthropic API key not configured.' };

  const body = {
    model,
    max_tokens: maxTokens,
    system,
    // `content` carries structured blocks (an image, say); `prompt` is the
    // plain-text shorthand for the common case.
    messages: [{ role: 'user', content: content || prompt }],
    fallbacks: 'default',
  };

  // Schema and tools are mutually exclusive here on purpose. A tool-using turn
  // can come back as tool_use or pause_turn rather than the final answer, and
  // forcing a schema onto that turn makes the failure modes multiply. Callers
  // that need both do the tool call first and normalise its prose after.
  if (schema) body.output_config = { format: { type: 'json_schema', schema } };
  if (tools) body.tools = tools;

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

  // With server tools the reply interleaves tool results and prose, so join
  // every text block rather than taking the first — the first is usually
  // "let me look that up".
  const text = (Array.isArray(payload?.content) ? payload.content : [])
    .filter((block) => block?.type === 'text')
    .map((block) => clean(block.text))
    .filter(Boolean)
    .join('\n\n');

  const usage = payload?.usage || null;
  const servedBy = clean(payload?.model) || model;

  if (!text) {
    // pause_turn means the server-side tool loop hit its iteration cap with
    // nothing written yet. Distinguish it, because "try again" is good advice
    // for this and useless for an empty answer.
    if (payload?.stop_reason === 'pause_turn') {
      return { ok: false, status: 504, error: 'The model was still working when the turn ended. Try that again.' };
    }
    return { ok: false, status: 502, error: 'The model returned an empty response.' };
  }

  // Unconstrained callers (the tool-using ones) want the prose, not JSON.
  if (expectText || !schema) return { ok: true, status: 200, text, usage, servedBy };

  // A schema'd answer that ran out of room is cut off mid-object, so it fails
  // JSON.parse — and "not valid JSON" then sends the next person hunting for a
  // malformed request that is in fact fine. Name the real cause. Output size
  // varies run to run for identical input, so this shows up as an intermittent
  // failure on a prompt that worked five minutes ago.
  if (payload?.stop_reason === 'max_tokens') {
    return {
      ok: false,
      status: 502,
      error: `The model ran out of room mid-answer (its ${maxTokens}-token limit) and what came back `
        + 'was cut off. Nothing was saved; try that again.',
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, status: 502, error: 'The model returned something that is not valid JSON.' };
  }

  return { ok: true, status: 200, data: parsed, usage, servedBy };
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

const BRIEF_SYSTEM = 'You read organisations and summarise them so a designer who has never seen them '
  + 'could choose a visual direction. You are concise and you do not invent facts.';

/**
 * Seed adapter — a typed description (spec §5, seed_type "brief").
 *
 * The simplest of the four and often the best: the operator already knows who
 * the client is, and a sentence from them beats anything inferred from page
 * titles.
 */
async function buildStyleBriefFromText({ text }, apiKey) {
  const body = clean(text);
  if (!body) return { ok: false, status: 400, error: 'Describe the organisation first.' };
  return callClaude({
    model: MODEL_UTILITY,
    system: BRIEF_SYSTEM,
    prompt: `Someone describes the organisation this way:\n\n${body.slice(0, 8000)}\n\n`
      + 'Normalise that into the structured brief. Where they were vague, stay vague rather than inventing detail.',
    schema: STYLE_BRIEF_SCHEMA,
    maxTokens: 1500,
    apiKey,
  });
}

/**
 * Seed adapter — an external site (spec §5, seed_type "external_url").
 *
 * DEVIATION FROM SPEC §9, stated plainly: the spec routes this through a Site
 * Import capture. That pipeline needs the operator to run a Playwright worker on
 * their own machine, which is a heavy dependency for pasting a URL — and the
 * style brief is text, so a full visual capture is not what it needs. This uses
 * the model's own web fetch instead: no worker, no infrastructure, works on
 * Vercel. If a genuinely visual read is wanted later, the capture path can be
 * added alongside without disturbing this.
 *
 * Two calls rather than one: the fetch turn can come back as tool_use or
 * pause_turn, so it is left unconstrained and its prose is normalised after.
 */
async function buildStyleBriefFromUrl({ url }, apiKey) {
  const target = clean(url);
  if (!target) return { ok: false, status: 400, error: 'Enter a website address first.' };

  // Reject a foreign scheme BEFORE defaulting to https. Prepending https to
  // "ftp://files.example.com" yields a URL whose host is literally "ftp" —
  // it parses, passes a protocol check, and gets fetched. Catch it here.
  const scheme = target.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (scheme && !/^https?$/i.test(scheme[1])) {
    return { ok: false, status: 400, error: `Only http and https addresses can be read, not ${scheme[1]}.` };
  }

  let parsed;
  try {
    parsed = new URL(scheme ? target : `https://${target}`);
  } catch {
    return { ok: false, status: 400, error: `That does not look like a website address: ${target}` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, status: 400, error: 'Only http and https addresses can be read.' };
  }
  if (!parsed.hostname.includes('.')) {
    return { ok: false, status: 400, error: `That does not look like a website address: ${target}` };
  }

  const read = await callClaude({
    model: MODEL_UTILITY,
    system: 'You look at websites and describe the organisation behind them.',
    prompt: `Fetch ${parsed.href} and describe the organisation behind it: what they do, who they `
      + 'are speaking to, and the register their writing is in. If the page cannot be read, say so plainly.',
    tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 }],
    maxTokens: 3000,
    apiKey,
    expectText: true,
  });
  if (!read.ok) return read;

  const description = clean(read.text);
  if (!description) {
    return { ok: false, status: 502, error: `Nothing could be read from ${parsed.href}.` };
  }

  const normalised = await buildStyleBriefFromText({ text: description }, apiKey);
  if (!normalised.ok) return normalised;
  // Report both calls' tokens so the session tally is not silently short.
  return { ...normalised, usage: mergeUsage(read.usage, normalised.usage) };
}

/**
 * Seed adapter — an uploaded logo or brand asset (spec §5, seed_type
 * "brand_kit"). The one seed where the model genuinely has to look at
 * something, so the image goes in as an image block rather than a description
 * of it.
 */
async function buildStyleBriefFromImage({ imageUrl, note }, apiKey) {
  const src = clean(imageUrl);
  if (!src) return { ok: false, status: 400, error: 'Pick a logo or brand image first.' };

  return callClaude({
    model: MODEL_UTILITY,
    system: BRIEF_SYSTEM,
    content: [
      { type: 'image', source: { type: 'url', url: src } },
      {
        type: 'text',
        text: 'This is the organisation\'s logo or brand artwork. From it, describe the organisation '
          + 'and the visual register it already lives in — the colours actually present, and whether '
          + 'the mark reads formal, playful, technical, traditional. Say what you can see; do not guess '
          + 'at a sector the image does not support.'
          + (clean(note) ? `\n\nThe operator adds: ${clean(note).slice(0, 2000)}` : ''),
      },
    ],
    schema: STYLE_BRIEF_SCHEMA,
    maxTokens: 1500,
    apiKey,
  });
}

/** Sum two usage objects so a two-call adapter reports its full cost. */
function mergeUsage(a, b) {
  const keys = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
  const out = {};
  for (const key of keys) out[key] = (Number(a?.[key]) || 0) + (Number(b?.[key]) || 0);
  return out;
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
    // Measured 2026-08-09: three directions cost 1050–1340 output tokens for
    // identical input. The old 2000 left barely a third in hand, and a verbose
    // run truncated into an unparseable answer. Headroom is cheap — output is
    // billed on what is used, not on the ceiling.
    maxTokens: 4000,
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
    palette: {
      type: 'object',
      description: 'The role palette — five background/text pairs that turn one wash of colour into a designed page',
      properties: {
        surface: { type: 'string', description: 'Main content section background, usually white or near-white' },
        surfaceText: { type: 'string', description: 'Body text on surface' },
        band: { type: 'string', description: 'Alternating tinted section background that separates content bands — a quiet shift from surface, not a statement' },
        bandText: { type: 'string', description: 'Body text on band' },
        inverse: { type: 'string', description: 'Dark statement band for weighty sections and big footers — commit to real depth here' },
        inverseText: { type: 'string', description: 'Text on inverse — light, comfortably readable on the dark band' },
        header: { type: 'string', description: 'Site header / navigation bar background — often the inverse family' },
        headerText: { type: 'string', description: 'Navigation text on header' },
        button: { type: 'string', description: 'Primary call-to-action fill — the colour that pops against every band' },
        buttonText: { type: 'string', description: 'Button label text on button' },
      },
      required: [
        'surface', 'surfaceText', 'band', 'bandText', 'inverse', 'inverseText',
        'header', 'headerText', 'button', 'buttonText',
      ],
      additionalProperties: false,
    },
    treatments: {
      type: 'object',
      description: 'Design treatments — styling moves applied to content the site already has',
      properties: {
        heroOverlay: { type: 'string', description: 'Tint colour laid over photo sections so text reads on them — usually the inverse family' },
        heroOverlayOpacity: { type: 'number', description: '0.2 (photo-forward) to 0.6 (moody); the photo must still read through' },
        cardOverlap: { type: 'boolean', description: 'Card rows directly after a photo section pull up over its bottom edge' },
        footerInverse: { type: 'boolean', description: 'The last section becomes the dark closing band big footers use' },
      },
      required: ['heroOverlay', 'heroOverlayOpacity', 'cardOverlap', 'footerInverse'],
      additionalProperties: false,
    },
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
  required: ['rationale', 'primaryColor', 'secondaryColor', 'backgroundColor', 'accentColor', 'palette', 'treatments', 'typography'],
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
  'A designed page is a SYSTEM OF BANDS, not one wash of colour: a header bar,',
  'white-ish content surfaces, a quiet tinted band alternating between them, one',
  'dark statement band, and a button colour that pops against all of them. The',
  'palette roles express that system. Make surface and band close relatives (the',
  'shift between them should be felt, not shouted), make inverse genuinely dark',
  'and confident, and let header usually share the inverse family. backgroundColor',
  'remains the page ground behind everything.',
  '',
  'The treatments are how the design engages with the site\'s own photography:',
  'the hero overlay tints photo sections so headlines sit on them like a real',
  'hero, card rows can pull up over a photo\'s bottom edge, and the footer can',
  'close on the dark band. Commit these to your direction too — a bright open',
  'look wants a light-handed overlay, a moody one can go heavy.',
  '',
  'Colours are six-digit hex. Every background/text pair in the palette must stay',
  'comfortably readable — pairs are contrast-checked and an unreadable pair fails',
  'the whole design. A direction that commits to low contrast still has to be',
  'legible.',
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
    // Measured 2026-08-09 with the role palette in the schema: 980–1580 output
    // tokens for identical input. Same reasoning as deriveDirections — the
    // spread between runs is wide, so the ceiling sits well clear of it.
    maxTokens: 5000,
    apiKey,
  });
}

module.exports = {
  MODEL_CANDIDATES,
  MODEL_UTILITY,
  sumUsage,
  mergeUsage,
  callClaude,
  buildStyleBrief,
  buildStyleBriefFromText,
  buildStyleBriefFromUrl,
  buildStyleBriefFromImage,
  deriveDirections,
  generateCandidate,
  resolveApiKey,
};
