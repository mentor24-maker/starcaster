'use strict';

/**
 * Harvest a club's printed schedule into events (task 86bbztj0e).
 *
 * Dane uploads a flyer — Delray's "Weekly Program Guide", a PDF or an image —
 * the AI reads it, and the Event Manager shows what was found for review.
 * Nothing here writes an event: the review table does that, one row at a time,
 * through the ordinary /api/events route and its validation.
 *
 * Two halves, deliberately split:
 *
 *   1. `extractSchedule` asks the model for ONE LINE PER PROGRAM PER DAY, exactly
 *      as printed. It is told nothing about repeats. A model asked to merge
 *      would merge differently on different days; a model asked to transcribe
 *      has one right answer, which is what a reviewer can check against paper.
 *   2. `mergeSessions` turns those lines into weekly series in plain code, and
 *      `matchExisting` marks what the calendar already has. Both are pure and
 *      tested, because "Drills & Games I Mon–Sat" becoming six events is the
 *      failure that would reach a client's site.
 *
 * The AI call goes through the AI door, `generate()` in lib/aiClient.js
 * (SC-896). Until then it called Anthropic by hand, so when Anthropic's credit
 * ran out (from 2026-10-30) a flyer could not be read even with OpenAI funded
 * and first on Settings › APIs › AI provider. Now it goes to the first provider
 * in that order that can read the file, and the door meters the spend under
 * FEATURE on every answer.
 *
 * Spend: every upload bills whichever provider answers, on Alphire's account,
 * which is why the route is platform-only (lib/projectAdminApiAuth.js) and rate
 * limited.
 */

const aiClient = require('./aiClient');

const FEATURE = 'event_harvest';

/** What a flyer may be: a PDF, or one of these pictures. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const PDF_TYPE = 'application/pdf';

/** ~7MB of file. The JSON body limit is 10MB and base64 adds a third. */
const MAX_BASE64_CHARS = 9_000_000;

/** A whole week can be several hundred lines of JSON; reading one takes minutes. */
const MAX_TOKENS = 32000;
const TIMEOUT_MS = 5 * 60 * 1000;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/*
 * How each provider says why it stopped (Anthropic, OpenAI-style, Gemini).
 * Cut off at the length limit, or declined to answer.
 */
const TRUNCATED = new Set(['max_tokens', 'length', 'MAX_TOKENS']);
const REFUSED = new Set(['refusal', 'content_filter', 'SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

class HarvestError extends Error {
  constructor(message, status = 400, code = 'HARVEST_ERROR') {
    super(message);
    this.name = 'HarvestError';
    this.status = status;
    this.code = code;
  }
}

/**
 * The shape the model must return. Strings rather than nullable fields so the
 * reviewer's table never has to tell "missing" from "empty". It is sent as
 * part of the instructions (not every provider can be held to a schema), and
 * normalizeExtraction checks every answer against it.
 */
const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['weekStart', 'venues', 'sessions'],
  properties: {
    weekStart: {
      type: 'string',
      description: 'The first date of the week the schedule covers, as YYYY-MM-DD, or "" if the document does not say.',
    },
    venues: {
      type: 'array',
      description: 'Every venue or program category in the document key/legend, with its colour.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'color'],
        properties: {
          name: { type: 'string' },
          color: { type: 'string', description: 'The key colour as #rrggbb, or "" if none.' },
        },
      },
    },
    sessions: {
      type: 'array',
      description: 'One entry per program line per day, in the order printed.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['day', 'date', 'title', 'instructor', 'startTime', 'endTime', 'venue'],
        properties: {
          day: { type: 'string', enum: WEEKDAYS },
          date: { type: 'string', description: 'YYYY-MM-DD if printed for that day, else "".' },
          title: { type: 'string' },
          instructor: { type: 'string', description: 'Exactly as printed, e.g. "Brent/Chris", or "".' },
          startTime: { type: 'string', description: '24-hour HH:MM.' },
          endTime: { type: 'string', description: '24-hour HH:MM, or "" if not printed.' },
          venue: { type: 'string', description: 'Name of the venue from the key this line is coloured as, or "".' },
        },
      },
    },
  },
};

const INSTRUCTIONS = [
  'This is a weekly schedule of classes or programs published by a sports club.',
  'Transcribe it. Return one session for every program line under every day, exactly as printed —',
  'do not merge days, do not skip repeated programs, do not invent programs that are not shown.',
  'Times: convert to 24-hour HH:MM. A range like "8:30 - 10:00am" means 08:30 to 10:00; "4:00 - 7:00pm" means 16:00 to 19:00;',
  'use the am/pm printed at the end of a range for both ends unless that would put the end before the start.',
  'Venue: the schedule colour-codes lines against a key; give each session the key name its colour matches.',
  'If a line is in the default text colour and the key has no matching entry, use "".',
].join(' ');

const PROMPT = `${INSTRUCTIONS}\n\nAnswer with one JSON object matching this JSON Schema exactly:\n${JSON.stringify(EXTRACTION_SCHEMA)}`;

let doorDeps = {};
/** Tests fake the door's network, keys and order; production uses the real ones. */
function setDoorDeps(deps) { doorDeps = deps || {}; }

/**
 * Can any provider in this feature's order read a flyer right now? Only a key
 * is checked, not credit, so the button shows whenever a reading is possible;
 * a provider out of credit is skipped at upload time and the next one answers.
 */
async function isAvailable() {
  const getKey = doorDeps.getKey || ((def) => aiClient.providerKeyFor(def));
  const order = doorDeps.order || ((feature) => aiClient.getAiProviderOrder({ feature }));
  let providers = [];
  try {
    ({ providers = [] } = (await order(FEATURE)) || {});
  } catch {
    return false;
  }
  const pdf = [{ kind: 'pdf', mimeType: PDF_TYPE, base64: 'x' }];
  const image = [{ kind: 'image', mimeType: 'image/png', base64: 'x' }];
  return providers.some((def) => (!aiClient.cannotRead(def, pdf) || !aiClient.cannotRead(def, image)) && Boolean(getKey(def)));
}

/** Refuse what cannot be sent before paying for a request. */
function readUpload(body) {
  const mimeType = String(body?.mimeType || '').trim().toLowerCase();
  const data = String(body?.fileBase64 || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!data) throw new HarvestError('Choose a PDF or image of the schedule to upload.');
  if (mimeType !== PDF_TYPE && !IMAGE_TYPES.has(mimeType)) {
    throw new HarvestError(`"${mimeType || 'unknown'}" files cannot be read — upload a PDF, PNG, JPEG, WebP or GIF.`);
  }
  if (data.length > MAX_BASE64_CHARS) {
    throw new HarvestError('That file is too large to read (about 7MB is the limit). Export the page at a smaller size and try again.');
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new HarvestError('The upload did not arrive as a readable file. Try choosing it again.');
  return { mimeType, data };
}

const SKIP_WORDS = {
  'NOT SET': 'has no key',
  INVALID: 'refused its key',
  'OUT OF CREDIT': 'is out of credit',
  [aiClient.CANNOT_READ]: 'cannot read this kind of file',
};

/** "OpenAI is out of credit; Kimi cannot read PDFs": every provider passed over, in plain words. */
function describeSkipped(skipped) {
  return (skipped || []).map((s) => (s.verdict === aiClient.CANNOT_READ && s.reason
    ? s.reason
    : `${s.label} ${SKIP_WORDS[s.verdict] || `was skipped (${s.reason || s.verdict})`}`)).join('; ');
}

/** A door answer that did not produce a schedule, as a sentence Dane can act on. */
function doorFailure(reply) {
  const who = reply.providerLabel || (reply.provider ? (aiClient.AI_PROVIDERS[reply.provider]?.label || reply.provider) : 'The AI service');
  const passed = describeSkipped(reply.skipped);
  const before = passed ? ` (${passed})` : '';
  if (reply.code === 'no_provider') {
    const tried = passed
      ? `No AI provider could read the schedule: ${passed}.`
      : 'No AI provider is set up, so schedules cannot be read.';
    return new HarvestError(`${tried} Add a key or credit for one that reads PDFs and images (Anthropic, OpenAI or Google Gemini) in Settings › APIs.`, 503, 'NOT_CONFIGURED');
  }
  if (reply.code === 'bad_json') {
    if (TRUNCATED.has(String(reply.stopReason))) return new HarvestError('The schedule was too long to read in one go. Upload one week per file.', 422, 'TOO_LONG');
    if (REFUSED.has(String(reply.stopReason))) return new HarvestError(`${who} declined to read this file. If it is a schedule, try a cleaner export of it.`, 422, 'REFUSED');
    return new HarvestError(`${who} returned something that was not a schedule. Try again.`, 502, 'BAD_OUTPUT');
  }
  if (reply.code === 'provider_error' && reply.status === 429) {
    return new HarvestError(`${who} is busy right now${before}. Wait a minute and try again.`, 429, 'UPSTREAM_BUSY');
  }
  if (reply.code === 'provider_error' && reply.status === 400) {
    return new HarvestError(`${who} could not read that file: ${String(reply.error || '').slice(0, 200)}`, 400, 'UPSTREAM_REJECTED');
  }
  if (reply.code === 'bad_request') return new HarvestError(String(reply.error || 'The file could not be sent.'), 400, 'BAD_REQUEST');
  return new HarvestError(`${who} could not be reached${before}. Try again in a moment.`, 502, 'UPSTREAM_FAILED');
}

/**
 * Ask the AI to transcribe the schedule. Returns the raw extraction, already
 * shape-checked. Every failure is a HarvestError with a sentence Dane can act on.
 */
async function extractSchedule(body, scope = null) {
  const upload = readUpload(body);
  const reply = await aiClient.generate({
    feature: FEATURE,
    scope: scope || undefined,
    tier: 'strong',
    json: true,
    maxTokens: MAX_TOKENS,
    timeoutMs: TIMEOUT_MS,
    messages: [{ role: 'user', content: PROMPT, files: [{ mimeType: upload.mimeType, base64: upload.data }] }],
  }, doorDeps);

  if (!reply.ok) throw doorFailure(reply);
  const stop = String(reply.stopReason || '');
  if (REFUSED.has(stop)) {
    throw new HarvestError(`${reply.providerLabel || 'The AI'} declined to read this file. If it is a schedule, try a cleaner export of it.`, 422, 'REFUSED');
  }
  if (TRUNCATED.has(stop)) {
    throw new HarvestError('The schedule was too long to read in one go. Upload one week per file.', 422, 'TOO_LONG');
  }
  if (!reply.json || typeof reply.json !== 'object' || Array.isArray(reply.json)) {
    throw new HarvestError(`${reply.providerLabel || 'The AI'} returned something that was not a schedule. Try again.`, 502, 'BAD_OUTPUT');
  }
  return normalizeExtraction(reply.json);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

function clean(value, max = 200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Drop anything malformed rather than trust it; count what was dropped. */
function normalizeExtraction(raw) {
  const venues = [];
  for (const v of Array.isArray(raw?.venues) ? raw.venues : []) {
    const name = clean(v?.name, 80);
    if (!name || venues.some((x) => x.name.toLowerCase() === name.toLowerCase())) continue;
    venues.push({ name, color: HEX_RE.test(String(v?.color || '')) ? String(v.color).toLowerCase() : '' });
  }
  const sessions = [];
  let dropped = 0;
  for (const s of Array.isArray(raw?.sessions) ? raw.sessions : []) {
    const day = WEEKDAYS.indexOf(String(s?.day || ''));
    const title = clean(s?.title, 120);
    const startTime = String(s?.startTime || '');
    if (day < 0 || !title || !TIME_RE.test(startTime)) { dropped += 1; continue; }
    const endTime = TIME_RE.test(String(s?.endTime || '')) && String(s.endTime) > startTime ? String(s.endTime) : '';
    sessions.push({
      weekday: day,
      date: DATE_RE.test(String(s?.date || '')) ? String(s.date) : '',
      title,
      instructor: clean(s?.instructor, 120),
      startTime,
      endTime,
      venue: clean(s?.venue, 80),
    });
  }
  return {
    weekStart: DATE_RE.test(String(raw?.weekStart || '')) ? String(raw.weekStart) : '',
    venues,
    sessions,
    dropped,
  };
}

function key(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Lines → weekly series. Two lines are one series when the program, the
 * instructor, both times and the venue all match: "Intro to WWO · Vincent W ·
 * 8:30" and "Intro to WWO · Danny Z/Mark W · 9:00" are two programs to a
 * reviewer, and merging them would put the wrong coach on half the dates.
 */
function mergeSessions(sessions) {
  const byKey = new Map();
  for (const s of sessions || []) {
    const k = [key(s.title), key(s.instructor), s.startTime, s.endTime, key(s.venue)].join('|');
    const existing = byKey.get(k);
    if (existing) {
      if (!existing.weekdays.includes(s.weekday)) existing.weekdays.push(s.weekday);
      if (s.date && !existing.dates.includes(s.date)) existing.dates.push(s.date);
      continue;
    }
    byKey.set(k, {
      key: k,
      title: s.title,
      instructor: s.instructor,
      startTime: s.startTime,
      endTime: s.endTime,
      venue: s.venue,
      weekdays: [s.weekday],
      dates: s.date ? [s.date] : [],
    });
  }
  const series = Array.from(byKey.values());
  for (const item of series) {
    item.weekdays.sort((a, b) => a - b);
    item.dates.sort();
  }
  // Earliest in the week first, then by time — the order the flyer reads in.
  return series.sort((a, b) => {
    const dayA = Math.min(...a.weekdays.map((d) => (d + 6) % 7));
    const dayB = Math.min(...b.weekdays.map((d) => (d + 6) % 7));
    return dayA - dayB || a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title);
  });
}

function localClock(iso, timeZone) {
  const ms = Date.parse(String(iso || ''));
  if (!Number.isFinite(ms)) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timeZone || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(ms));
  } catch {
    return '';
  }
}

/**
 * Which proposed series the calendar already carries. Same program name, same
 * start time in the event's own zone, and at least one weekday in common — an
 * instructor change alone should not create a second copy of a program.
 */
function matchExisting(series, events) {
  const candidates = (events || []).filter((e) => e && e.recurrence && Array.isArray(e.recurrence.weekdays));
  return series.map((item) => {
    const hit = candidates.find((e) => key(e.title) === key(item.title)
      && localClock(e.startsAt, e.timezone) === item.startTime
      && e.recurrence.weekdays.some((d) => item.weekdays.includes(d)));
    return hit ? { ...item, existingEventId: hit.id, existingTitle: hit.title } : { ...item, existingEventId: '' };
  });
}

/**
 * A key printed in capitals ("DELRAY SWIM & TENNIS CLUB") would become a venue
 * shouted on every calendar. Only an ALL-CAPS name is changed; short words keep
 * their capitals when they read as initials (DBTC, PB).
 */
function tidyName(name) {
  const text = clean(name, 80);
  if (!/[A-Z]/.test(text) || text !== text.toUpperCase()) return text;
  return text.split(' ').map((word, i) => {
    const lower = word.toLowerCase();
    if (i > 0 && ['and', 'of', 'the', 'at'].includes(lower)) return lower;
    const letters = word.replace(/[^A-Z]/g, '');
    // Initials keep their capitals: two letters or fewer, or no vowels at all
    // (PB, DBTC). "CLUB" and "TENNIS" are words.
    if (letters.length <= 2 || !/[AEIOUY]/.test(letters)) return word;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ');
}

/**
 * Venue names from the flyer, matched to the project's venues by name. A
 * matched venue takes the project's own spelling, and the series that name it
 * follow, so "PICKLEBALL" on paper files under the existing "Pickleball".
 */
function matchVenues(venues, categories, series = []) {
  const renamed = new Map();
  const matched = (venues || []).map((v) => {
    const hit = (categories || []).find((c) => key(c.name) === key(v.name));
    const name = hit ? hit.name : tidyName(v.name);
    renamed.set(key(v.name), name);
    return { ...v, name, categoryId: hit ? hit.id : '' };
  });
  const renamedSeries = (series || []).map((s) => (renamed.has(key(s.venue)) ? { ...s, venue: renamed.get(key(s.venue)) } : s));
  return { venues: matched, series: renamedSeries };
}

/**
 * The zone to read the flyer's times in: the one the project's events already
 * use most. UTC is skipped — it is the default a project gets, not a club's
 * zone. With nothing to go on this answers '' and the reviewer must type it,
 * because guessing the reviewer's own zone would put every program hours out
 * for a club in another state.
 */
function suggestTimeZone(events) {
  const counts = new Map();
  for (const e of events || []) {
    const tz = String(e?.timezone || '').trim();
    if (!tz || tz === 'UTC') continue;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { continue; }
    counts.set(tz, (counts.get(tz) || 0) + 1);
  }
  let best = '';
  for (const [tz, n] of counts) if (!best || n > counts.get(best)) best = tz;
  return best;
}

module.exports = {
  FEATURE,
  HarvestError,
  EXTRACTION_SCHEMA,
  isAvailable,
  readUpload,
  extractSchedule,
  normalizeExtraction,
  mergeSessions,
  matchExisting,
  matchVenues,
  suggestTimeZone,
  tidyName,
  setDoorDeps,
  describeSkipped,
};
