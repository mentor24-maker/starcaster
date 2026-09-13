'use strict';

/**
 * Harvest a club's printed schedule into events (task 86bbztj0e).
 *
 * Dane uploads a flyer — Delray's "Weekly Program Guide", a PDF or an image —
 * Claude reads it, and the Event Manager shows what was found for review.
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
 * Spend: this bills Alphire's Anthropic account on every upload, which is why
 * the route is platform-only (lib/projectAdminApiAuth.js) and rate limited, and
 * why every call is recorded with recordAiUsage — including failed ones that
 * still returned usage.
 */

const { recordAiUsage } = require('./aiUsage');
const { getProviderValues } = require('./apiSettings');

const MODEL = 'claude-opus-5';
const FEATURE = 'event_harvest';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** What a flyer may be. Claude reads PDFs as documents and these as images. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const PDF_TYPE = 'application/pdf';

/** ~7MB of file. The JSON body limit is 10MB and base64 adds a third. */
const MAX_BASE64_CHARS = 9_000_000;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
 * reviewer's table never has to tell "missing" from "empty".
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

function resolveApiKey() {
  try {
    const stored = getProviderValues('anthropic');
    if (stored && stored.api_key) return String(stored.api_key);
  } catch { /* fall through to the environment */ }
  return String(process.env.ANTHROPIC_API_KEY || '');
}

function isAvailable() {
  return Boolean(resolveApiKey());
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

function fileBlock({ mimeType, data }) {
  return mimeType === PDF_TYPE
    ? { type: 'document', source: { type: 'base64', media_type: PDF_TYPE, data } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType, data } };
}

let clientFactory = null;
/** Tests replace the client; production builds the real one lazily. */
function setClientFactory(factory) { clientFactory = factory; }

function makeClient() {
  if (clientFactory) return clientFactory();
  const { Anthropic } = require('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: resolveApiKey(), timeout: 5 * 60 * 1000 });
}

/**
 * Ask Claude to transcribe the schedule. Returns the raw extraction, already
 * shape-checked. Every failure is a HarvestError with a sentence Dane can act on.
 */
async function extractSchedule(body, scope = null) {
  const upload = readUpload(body);
  if (!clientFactory && !isAvailable()) {
    throw new HarvestError('No Anthropic API key is configured, so schedules cannot be read.', 503, 'NOT_CONFIGURED');
  }

  const client = makeClient();
  let response;
  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: EXTRACTION_SCHEMA },
      },
      messages: [{
        role: 'user',
        content: [fileBlock(upload), { type: 'text', text: INSTRUCTIONS }],
      }],
    });
    response = await stream.finalMessage();
  } catch (err) {
    const status = Number(err?.status) || 0;
    if (status === 429) throw new HarvestError('The AI service is busy right now. Wait a minute and try again.', 429, 'UPSTREAM_BUSY');
    if (status === 400) throw new HarvestError(`The AI service could not read that file: ${String(err?.message || '').slice(0, 200)}`, 400, 'UPSTREAM_REJECTED');
    throw new HarvestError('The AI service could not be reached. Try again in a moment.', 502, 'UPSTREAM_FAILED');
  }

  await recordAiUsage({ provider: 'anthropic', model: response?.model || MODEL, feature: FEATURE, body: response, scope });

  if (response?.stop_reason === 'refusal') {
    throw new HarvestError('The AI declined to read this file. If it is a schedule, try a cleaner export of it.', 422, 'REFUSED');
  }
  if (response?.stop_reason === 'max_tokens') {
    throw new HarvestError('The schedule was too long to read in one go. Upload one week per file.', 422, 'TOO_LONG');
  }

  const text = (response?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    throw new HarvestError('The AI returned something that was not a schedule. Try again.', 502, 'BAD_OUTPUT');
  }
  return normalizeExtraction(parsed);
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

/** Venue names from the flyer, matched to the project's venues by name. */
function matchVenues(venues, categories) {
  return (venues || []).map((v) => {
    const hit = (categories || []).find((c) => key(c.name) === key(v.name));
    return { ...v, categoryId: hit ? hit.id : '' };
  });
}

module.exports = {
  MODEL,
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
  setClientFactory,
};
