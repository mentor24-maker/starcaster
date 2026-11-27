'use strict';

/**
 * Theme Wizard — the generator (spec §6).
 *
 * Model choice (§6.1, changed 2026-11-26 by SC-898): every call goes through
 * the AI door, `generate()` in lib/aiClient.js, so the designs come from
 * whichever provider is first on Settings › APIs › AI provider, like every
 * other feature. The wizard used to ask for claude-fable-5 by name, because
 * "design taste is the entire product", and so stopped whenever Anthropic ran
 * out of credit (from 2026-10-30) while a funded OpenAI key sat unused. Dane
 * chose option B on SC-898: the first provider, not Fable by name. Every call
 * asks for the door's strong tier.
 *
 * Variety (§6.2/§6.4) is the hard part and the reason this file is shaped the
 * way it is. Current models reject temperature/top_p/top_k, so you cannot get
 * three different answers by rolling the dice three times; and left to itself
 * the model reaches for the same warm cream-and-serif look every time. So the
 * three DIRECTIONS are decided first, in their own call, and each candidate is
 * then generated separately against its own committed brief. One prompt asking
 * for "three options" produces three shades of one look.
 */

const aiClient = require('./aiClient');
const { FONT_KEYS } = require('./themeWizardValidate');

/** The name the door meters every wizard call under (lib/aiFeatureGroups.js lists it). */
const FEATURE = 'theme_wizard';
/** The door's tier for every wizard call: design work, so its most capable model. */
const TIER = 'strong';

// A candidate on a strong model is slow; the door's own 60s default would cut
// a normal round off. One call per HTTP request (routes/themeWizard.js) keeps
// this inside the serverless ceiling.
const REQUEST_TIMEOUT_MS = 180000;

// Why a provider stopped, in each provider's own words (Anthropic, OpenAI-style, Gemini).
const TRUNCATED = new Set(['max_tokens', 'length', 'MAX_TOKENS']);
const REFUSED = new Set(['refusal', 'content_filter', 'SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

const AVAILABLE_FONTS = [...FONT_KEYS].filter(Boolean).join(', ');

// Test seam: the door's own dependencies (fetch, key lookup, provider order).
let doorDeps = {};
/** Tests only: hand the door fakes so no request leaves the machine. */
function setDoorDeps(deps) { doorDeps = deps || {}; }

function clean(value) { return String(value == null ? '' : value).trim(); }

/**
 * Total billable tokens for one call. The door reports
 * { promptTokens, completionTokens, cachedTokens, totalTokens } for every
 * provider; Anthropic's raw shape (input_tokens ...) is still read, so an older
 * tally adds up the same way. Cache reads and writes count, because they are
 * billed.
 */
function sumUsage(usage) {
  if (!usage || typeof usage !== 'object') return 0;
  const n = (value) => { const num = Number(value); return Number.isFinite(num) ? num : 0; };
  if (usage.totalTokens !== undefined) return n(usage.totalTokens);
  return n(usage.input_tokens) + n(usage.output_tokens)
    + n(usage.cache_creation_input_tokens) + n(usage.cache_read_input_tokens);
}

const SKIP_WORDS = {
  'NOT SET': 'has no key',
  INVALID: 'refused its key',
  'OUT OF CREDIT': 'is out of credit',
};

/** "Anthropic is out of credit; Kimi cannot read images": every provider passed over, in plain words. */
function describeSkipped(skipped) {
  return (skipped || []).map((s) => ((s.verdict === aiClient.CANNOT_READ || s.verdict === aiClient.CANNOT_READ_PAGE) && s.reason
    ? s.reason
    : `${s.label} ${SKIP_WORDS[s.verdict] || `was skipped (${s.reason || s.verdict})`}`)).join('; ');
}

/** A door answer that did not produce what the wizard asked for, as { ok: false, status, error } for the operator. */
function doorFailure(reply, maxTokens) {
  const who = reply.providerLabel || (reply.provider ? (aiClient.AI_PROVIDERS[reply.provider]?.label || reply.provider) : 'The AI');
  const passed = describeSkipped(reply.skipped);
  const stop = String(reply.stopReason || '');
  const fail = (status, error) => ({ ok: false, status, error, provider: reply.provider || null });

  if (reply.code === 'no_provider') {
    return fail(503, passed
      ? `No AI provider could make the designs: ${passed}. Add a key or credit for one in Settings › APIs › AI provider.`
      : 'No AI provider is set up. Switch one on in Settings › APIs › AI provider.');
  }
  // §6.6: a refusal is a successful reply with an empty or partial answer.
  if (REFUSED.has(stop)) {
    return fail(422, `${who} declined this request (reason: ${stop}). Nothing was saved.`);
  }
  if (reply.code === 'bad_json') {
    // A structured answer that ran out of room is cut off mid-object, so it
    // fails to parse, and "not valid JSON" sends the next person hunting for a
    // malformed request that is in fact fine. Name the real cause. Output size
    // varies run to run for identical input, so this shows up as an
    // intermittent failure on a prompt that worked five minutes ago.
    if (TRUNCATED.has(stop)) {
      return fail(502, `${who} ran out of room mid-answer (its ${maxTokens}-token limit) and what came back `
        + 'was cut off. Nothing was saved; try that again.');
    }
    return fail(502, `${who} returned something that is not valid JSON in the shape asked for. `
      + `Nothing was saved; try that again. (${clean(reply.error)})`);
  }
  if (reply.code === 'page_unreadable') {
    return fail(502, `${clean(reply.error) || 'The page could not be read.'} Check the address, or describe the organisation instead.`);
  }
  if (reply.code === 'no_answer') {
    return fail(504, /no answer within/.test(String(reply.error || ''))
      ? `${who} did not answer within ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s. Nothing was saved; try the round again.`
      : `${clean(reply.error) || `${who} did not answer`}. Try that again.`);
  }
  if (reply.code === 'provider_error') {
    // Hazard 4.5: under zero data retention Anthropic 400s some models with a
    // message that reads like a malformed payload. Say so, or the next hour is
    // spent debugging a request body that was fine. Anthropic only: no other
    // provider has this setting.
    if (reply.provider === 'anthropic' && reply.status === 400 && /retention/i.test(String(reply.error || ''))) {
      return fail(400, 'This model needs 30-day data retention enabled on the Anthropic account. '
        + `This is an account setting, not a problem with the request. (${clean(reply.error)})`);
    }
    return fail(reply.status || 502, clean(reply.error) || `${who} refused the request`);
  }
  return fail(reply.code === 'bad_request' ? 400 : 502, clean(reply.error) || `${who} could not be reached. Try again in a moment.`);
}

/**
 * One wizard call through the AI door. Returns { ok, data } where data is the
 * parsed JSON object the schema describes, { ok, text } for a prose caller,
 * or { ok: false, status, error } with a message written for the operator
 * rather than for a log. `providerLabel` and `model` say who answered.
 *
 * `files` carries an image (a logo, a hero banner) by its web address; `pages`
 * names web pages for the AI to read first. A schema'd call and a page read
 * are separate calls on purpose: the page-reading turn is left unconstrained
 * and its prose is normalised after.
 */
async function callModel({ system, prompt, files, pages, schema, maxTokens = 4000 }) {
  const reply = await aiClient.generate({
    feature: FEATURE,
    tier: TIER,
    system,
    messages: [{ role: 'user', content: prompt, ...(files && files.length ? { files } : {}) }],
    ...(schema ? { schema } : {}),
    ...(pages && pages.length ? { pages } : {}),
    maxTokens,
    timeoutMs: REQUEST_TIMEOUT_MS,
  }, doorDeps);

  if (!reply.ok) return doorFailure(reply, maxTokens);
  const stop = String(reply.stopReason || '');
  const who = { provider: reply.provider, providerLabel: reply.providerLabel, model: reply.model, usage: reply.usage || null };
  if (REFUSED.has(stop)) return doorFailure(reply, maxTokens);

  if (!schema) {
    // A prose read that ran out of room is degraded but still usable: it is
    // normalised by a second, schema'd call afterwards.
    const text = clean(reply.text);
    if (!text) return { ok: false, status: 502, error: `${reply.providerLabel || 'The AI'} returned an empty response.` };
    return { ok: true, status: 200, text, ...who };
  }
  if (TRUNCATED.has(stop)) return doorFailure({ ...reply, code: 'bad_json' }, maxTokens);
  if (!reply.json || typeof reply.json !== 'object' || Array.isArray(reply.json)) {
    return doorFailure({ ...reply, code: 'bad_json', error: 'not a JSON object' }, maxTokens);
  }
  return { ok: true, status: 200, data: reply.json, ...who };
}

/**
 * A website address the operator typed, as a URL: a bare domain is read over
 * https, and anything that is not http or https is refused before a request.
 * { ok: true, url } or { ok: false, status: 400, error }.
 */
function webAddress(target) {
  // Reject a foreign scheme BEFORE defaulting to https. Prepending https to
  // "ftp://files.example.com" yields a URL whose host is literally "ftp" —
  // it parses, passes a protocol check, and gets fetched. Catch it here.
  const scheme = target.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (scheme && !/^https?$/i.test(scheme[1])) {
    return { ok: false, status: 400, error: `Only http and https addresses can be read, not ${scheme[1]}.` };
  }
  let url;
  try {
    url = new URL(scheme ? target : `https://${target}`);
  } catch {
    return { ok: false, status: 400, error: `That does not look like a website address: ${target}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, status: 400, error: 'Only http and https addresses can be read.' };
  }
  if (!url.hostname.includes('.')) {
    return { ok: false, status: 400, error: `That does not look like a website address: ${target}` };
  }
  return { ok: true, url };
}

const IMAGE_EXTENSION = /\.(?:jpe?g|png|gif|webp|heic|heif)$/i;

/**
 * An image at a web address, as the door takes it. The door works out the type
 * from the address's extension; a hero banner pasted from a photo site often
 * has none ("…/photo-1501?w=1600"), so it is labelled a JPEG, the type such
 * links almost always serve. The provider fetching it reads the real type.
 */
function imageFile(url) {
  const path = String(url).split(/[?#]/)[0];
  return IMAGE_EXTENSION.test(path) ? { url } : { url, mimeType: 'image/jpeg' };
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
async function buildStyleBrief({ pages, projectName }) {
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

  return callModel({
    system: 'You read websites and summarise what kind of organisation they belong to. You are concise and you do not invent facts.',
    prompt,
    schema: STYLE_BRIEF_SCHEMA,
    maxTokens: 1500,
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
async function buildStyleBriefFromText({ text }) {
  const body = clean(text);
  if (!body) return { ok: false, status: 400, error: 'Describe the organisation first.' };
  return callModel({
    system: BRIEF_SYSTEM,
    prompt: `Someone describes the organisation this way:\n\n${body.slice(0, 8000)}\n\n`
      + 'Normalise that into the structured brief. Where they were vague, stay vague rather than inventing detail.',
    schema: STYLE_BRIEF_SCHEMA,
    maxTokens: 1500,
  });
}

/**
 * Seed adapter — an external site (spec §5, seed_type "external_url").
 *
 * DEVIATION FROM SPEC §9, stated plainly: the spec routes this through a Site
 * Import capture. That pipeline needs the operator to run a Playwright worker on
 * their own machine, which is a heavy dependency for pasting a URL — and the
 * style brief is text, so a full visual capture is not what it needs. This uses
 * a web read instead: no worker, no infrastructure, works on
 * Vercel. If a genuinely visual read is wanted later, the capture path can be
 * added alongside without disturbing this.
 *
 * This uses the AI door's page reading (SC-897) rather than one provider's
 * fetch tool, so it works on whichever provider is first.
 *
 * Two calls rather than one: the page-reading turn is left unconstrained and
 * its prose is normalised after.
 */
async function buildStyleBriefFromUrl({ url }) {
  const target = clean(url);
  if (!target) return { ok: false, status: 400, error: 'Enter a website address first.' };

  const address = webAddress(target);
  if (!address.ok) return address;
  const parsed = address.url;

  // The door reads the page: a provider with its own web fetch is handed the
  // address, any other is sent the page's text, read for it by the door.
  const read = await callModel({
    system: 'You look at websites and describe the organisation behind them.',
    prompt: `Describe the organisation behind the web page ${parsed.href}: what they do, who they `
      + 'are speaking to, and the register their writing is in. If the page cannot be read, say so plainly.',
    pages: [parsed.href],
    maxTokens: 3000,
  });
  if (!read.ok) return read;

  const description = clean(read.text);
  if (!description) {
    return { ok: false, status: 502, error: `Nothing could be read from ${parsed.href}.` };
  }

  const normalised = await buildStyleBriefFromText({ text: description });
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
async function buildStyleBriefFromImage({ imageUrl, note }) {
  const src = clean(imageUrl);
  if (!src) return { ok: false, status: 400, error: 'Pick a logo or brand image first.' };

  return callModel({
    system: BRIEF_SYSTEM,
    files: [imageFile(src)],
    prompt: 'This is the organisation\'s logo or brand artwork. From it, describe the organisation '
      + 'and the visual register it already lives in — the colours actually present, and whether '
      + 'the mark reads formal, playful, technical, traditional. Say what you can see; do not guess '
      + 'at a sector the image does not support.'
      + (clean(note) ? `\n\nThe operator adds: ${clean(note).slice(0, 2000)}` : ''),
    schema: STYLE_BRIEF_SCHEMA,
    maxTokens: 1500,
  });
}

/**
 * Describe a reference site's hero/banner area (spec: the operator can paste a
 * URL whose top-of-page treatment they want the looks to learn from). Prose in,
 * prose out — it feeds the candidate prompt, not a schema.
 */
async function describeHeroReference({ url }) {
  const target = clean(url);
  if (!target) return { ok: true, text: '', usage: null };
  const address = webAddress(target);
  if (!address.ok) return address;
  return callModel({
    system: 'You look at websites and describe their visual design precisely, for a designer who cannot see them.',
    prompt: `Describe ONLY the hero/banner area at the top of the web page ${address.url.href}: `
      + 'how the imagery is treated (overlay? tint? crop?), where the headline sits and how it is set, '
      + 'what the calls-to-action look like, and how the band below the hero relates to it. '
      + 'Be concrete about colours and contrast. If the page cannot be read, say so plainly.',
    pages: [address.url.href],
    maxTokens: 2000,
  });
}

/** Sum two usage objects so a two-call adapter reports its full cost. */
function mergeUsage(a, b) {
  const keys = ['promptTokens', 'completionTokens', 'cachedTokens'];
  const out = {};
  for (const key of keys) out[key] = (Number(a?.[key]) || 0) + (Number(b?.[key]) || 0);
  out.totalTokens = sumUsage(a) + sumUsage(b);
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

async function deriveDirections({ styleBrief, priorDirections = [], feedback = '' }) {
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

  return callModel({
    system: DIRECTIONS_SYSTEM,
    prompt,
    schema: DIRECTIONS_SCHEMA,
    // Measured 2026-08-09: three directions cost 1050–1340 output tokens for
    // identical input. The old 2000 left barely a third in hand, and a verbose
    // run truncated into an unparseable answer. Headroom is cheap — output is
    // billed on what is used, not on the ceiling.
    maxTokens: 4000,
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

async function generateCandidate({ styleBrief, direction, lockedValues = {}, parentPatch = null, feedback = '', heroImage = null }) {
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

  // A hero banner turns the palette from taste into observation: the image
  // goes in as an image and the look is KEYED to it — colours pulled from or
  // deliberately set against what is actually in the photograph.
  const hero = heroImage && clean(heroImage.url) ? heroImage : null;
  const heroWords = hero
    ? 'This is the hero banner this look is keyed to. It will sit at the top of the page '
      + 'under your heroOverlay tint, with headlines in your palette on top of it. Draw the '
      + 'palette from this image — its dominant tones, its light, one colour worth amplifying — '
      + 'and choose an overlay tint and opacity that makes text readable on THIS image without '
      + 'burying it.'
      + (clean(hero.note) ? `\n\nThe operator says about the banner area: ${clean(hero.note).slice(0, 2000)}` : '')
      + '\n\n'
    : '';

  return callModel({
    system: CANDIDATE_SYSTEM,
    prompt: heroWords + prompt,
    ...(hero ? { files: [imageFile(clean(hero.url))] } : {}),
    schema: CANDIDATE_SCHEMA,
    // Measured 2026-08-09 with the role palette in the schema: 980–1580 output
    // tokens for identical input. Same reasoning as deriveDirections — the
    // spread between runs is wide, so the ceiling sits well clear of it.
    maxTokens: 5000,
  });
}

module.exports = {
  FEATURE,
  TIER,
  setDoorDeps,
  sumUsage,
  mergeUsage,
  callModel,
  buildStyleBrief,
  buildStyleBriefFromText,
  buildStyleBriefFromUrl,
  buildStyleBriefFromImage,
  describeHeroReference,
  deriveDirections,
  generateCandidate,
};
