'use strict';

/**
 * Events store — one row per calendar event, scoped to a project.
 *
 * Same shape as lib/blogCategoriesStore.js and lib/blogPostsStore.js:
 * Supabase when it is configured and the table exists, a local JSON file
 * otherwise, with `sanitize()` as the single boundary between the snake_case
 * row and the camelCase object the routes and modules speak.
 */

const fs = require('fs');
const path = require('path');
const { nextId } = require('../routes/http');
const { sbQuery, tableConfig, isConfigured: isSupabaseConfigured } = require('./supabase');
const { writeJsonAtomic, ensureJsonFile } = require('./localDataFs');

const STORE_FILE = path.join(__dirname, '..', 'data', 'events.json');
const SUPPORT_CACHE = new Map();

/** draft is the safe default: an event nobody meant to publish stays invisible. */
const EVENT_STATUSES = new Set(['draft', 'published', 'cancelled']);

function t() { return tableConfig().events; }

function ensureFile() {
  ensureJsonFile(STORE_FILE, { events: [] }, { mode: 0o600 });
}

function readStore() {
  try {
    ensureFile();
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { events: [] };
    if (!Array.isArray(parsed.events)) parsed.events = [];
    return parsed;
  } catch {
    return { events: [] };
  }
}

function writeStore(store) {
  ensureFile();
  writeJsonAtomic(STORE_FILE, store, { mode: 0o600 });
}

function safeText(v) { return String(v || '').trim(); }

function safeBool(v, fallback = false) {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === null || typeof v === 'undefined' || v === '') return fallback;
  return Boolean(v);
}

/**
 * A timestamp, or null.
 *
 * An unparseable date becomes null rather than the string: a bad value in a
 * timestamptz column is a 400 from PostgREST that reads like a server fault,
 * and an event with no start is a state the calendar already handles.
 */
function safeTimestamp(v) {
  const text = safeText(v);
  if (!text) return null;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/** A title as a URL-safe slug. Same shape the Builder uses elsewhere. */
function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * The slug an event will actually be saved under.
 *
 * Derived from the title when none was given, because a slug is what gives an
 * event a public URL — an event created through the API with no slug could
 * never be linked to, and nothing would have said so.
 *
 * Uniqueness is per project (the partial unique index in
 * docs/SQL/events_setup.sql), so a collision is suffixed rather than allowed
 * to surface as a raw 409 that the manager can only report as "Failed to
 * create event". Bounded: after a handful of tries it gives up and lets the
 * database have the last word, rather than looping on a condition it cannot
 * fix.
 */
async function resolveSlug(requested, title, scope, excludeId = '') {
  const base = slugify(requested) || slugify(title);
  if (!base) return '';
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await getEventBySlug(candidate, scope);
    if (!clash || (excludeId && clash.id === excludeId)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function safeStatus(v) {
  const text = safeText(v).toLowerCase();
  return EVENT_STATUSES.has(text) ? text : 'draft';
}

function sanitize(input) {
  if (!input || typeof input !== 'object') return null;
  return {
    id:               String(input.id || ''),
    projectId:        safeText(input.projectId || input.project_id),
    ownerUserId:      safeText(input.ownerUserId || input.owner_user_id),

    title:            String(input.title || ''),
    slug:             String(input.slug || ''),
    status:           safeStatus(input.status),
    description:      String(input.description || ''),
    excerpt:          String(input.excerpt || ''),
    imageUrl:         String(input.imageUrl ?? input.image_url ?? ''),
    imageAlt:         String(input.imageAlt ?? input.image_alt ?? ''),
    url:              String(input.url || ''),
    featured:         safeBool(input.featured),

    startsAt:         safeTimestamp(input.startsAt ?? input.starts_at),
    endsAt:           safeTimestamp(input.endsAt ?? input.ends_at),
    allDay:           safeBool(input.allDay ?? input.all_day),
    timezone:         String(input.timezone || ''),

    locationName:     String(input.locationName ?? input.location_name ?? ''),
    locationAddress:  String(input.locationAddress ?? input.location_address ?? ''),
    locationUrl:      String(input.locationUrl ?? input.location_url ?? ''),

    organizerName:    String(input.organizerName ?? input.organizer_name ?? ''),
    organizerContact: String(input.organizerContact ?? input.organizer_contact ?? ''),

    seoTitle:         String(input.seoTitle ?? input.seo_title ?? ''),
    seoDescription:   String(input.seoDescription ?? input.seo_description ?? ''),

    createdAt:        String(input.createdAt || input.created_at || ''),
    updatedAt:        String(input.updatedAt || input.updated_at || ''),
  };
}

function toRow(e) {
  return {
    id:                e.id,
    project_id:        e.projectId,
    owner_user_id:     e.ownerUserId || null,
    title:             e.title,
    slug:              e.slug,
    status:            e.status,
    description:       e.description,
    excerpt:           e.excerpt,
    image_url:         e.imageUrl,
    image_alt:         e.imageAlt,
    url:               e.url,
    featured:          e.featured,
    starts_at:         e.startsAt,
    ends_at:           e.endsAt,
    all_day:           e.allDay,
    timezone:          e.timezone,
    location_name:     e.locationName,
    location_address:  e.locationAddress,
    location_url:      e.locationUrl,
    organizer_name:    e.organizerName,
    organizer_contact: e.organizerContact,
    seo_title:         e.seoTitle,
    seo_description:   e.seoDescription,
  };
}

function isMissingTable(err) {
  const text = String(err || '').toLowerCase();
  return text.includes('does not exist') || text.includes('relation') || text.includes('schema cache');
}

async function supportsSupabase() {
  if (!isSupabaseConfigured()) return false;
  const table = t();
  if (!table) return false;
  if (SUPPORT_CACHE.has(table)) return SUPPORT_CACHE.get(table);
  const probe = await sbQuery({ table, query: 'select=id&limit=1' });
  const ok = probe.ok || !isMissingTable(probe.error);
  SUPPORT_CACHE.set(table, ok);
  return ok;
}

/**
 * Events for a project, soonest first.
 *
 * `status` filters; omitted means every status, which is what the admin
 * manager wants. Events with no start date sort last — they are unscheduled,
 * not ancient.
 */
async function listEvents(options = {}, scope = null) {
  const projectId = safeText(scope?.projectId);
  const status = safeText(options.status);
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 50));

  if (await supportsSupabase()) {
    let query = `select=*&order=starts_at.asc.nullslast,title.asc&limit=${limit}`;
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    if (status) query += `&status=eq.${encodeURIComponent(status)}`;
    const result = await sbQuery({ table: t(), query });
    if (result.ok) return (Array.isArray(result.data) ? result.data : []).map(sanitize).filter(Boolean);
    if (!isMissingTable(result.error)) return [];
  }

  const store = readStore();
  return store.events
    .map(sanitize)
    .filter(Boolean)
    .filter((e) => !projectId || e.projectId === projectId)
    .filter((e) => !status || e.status === status)
    .sort((a, b) => {
      if (!a.startsAt && !b.startsAt) return a.title.localeCompare(b.title);
      if (!a.startsAt) return 1;
      if (!b.startsAt) return -1;
      const diff = Date.parse(a.startsAt) - Date.parse(b.startsAt);
      return diff !== 0 ? diff : a.title.localeCompare(b.title);
    })
    .slice(0, limit);
}

async function getEvent(id, scope = null) {
  const eventId = safeText(id);
  if (!eventId) return null;
  const projectId = safeText(scope?.projectId);

  if (await supportsSupabase()) {
    let query = `select=*&id=eq.${encodeURIComponent(eventId)}&limit=1`;
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const result = await sbQuery({ table: t(), query });
    if (result.ok) return sanitize(Array.isArray(result.data) ? result.data[0] : null);
    if (!isMissingTable(result.error)) return null;
  }

  const store = readStore();
  const found = store.events
    .map(sanitize)
    .filter(Boolean)
    .filter((e) => !projectId || e.projectId === projectId)
    .find((e) => e.id === eventId);
  return found || null;
}

async function getEventBySlug(slug, scope = null) {
  const eventSlug = safeText(slug);
  if (!eventSlug) return null;
  const projectId = safeText(scope?.projectId);

  if (await supportsSupabase()) {
    let query = `select=*&slug=eq.${encodeURIComponent(eventSlug)}&limit=1`;
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const result = await sbQuery({ table: t(), query });
    if (result.ok) return sanitize(Array.isArray(result.data) ? result.data[0] : null);
    if (!isMissingTable(result.error)) return null;
  }

  const store = readStore();
  const projectEvents = store.events
    .map(sanitize)
    .filter(Boolean)
    .filter((e) => !projectId || e.projectId === projectId);
  return projectEvents.find((e) => e.slug === eventSlug) || null;
}

async function createEvent(input, scope = null) {
  const now = new Date().toISOString();
  const projectId = safeText(scope?.projectId);
  const userId = safeText(scope?.userId);

  const event = sanitize({
    id: nextId('evt'),
    projectId,
    ownerUserId: userId,
    ...input,
    slug: await resolveSlug(input.slug, input.title, scope),
    createdAt: now,
    updatedAt: now,
  });

  if (await supportsSupabase()) {
    const row = { ...toRow(event), created_at: now, updated_at: now };
    const result = await sbQuery({
      method: 'POST', table: t(), query: 'select=*',
      headers: { Prefer: 'return=representation' }, body: [row],
    });
    if (result.ok) return sanitize(Array.isArray(result.data) ? result.data[0] : result.data);
    if (!isMissingTable(result.error)) return null;
  }

  const store = readStore();
  store.events.unshift(event);
  writeStore(store);
  return event;
}

async function updateEvent(id, input, scope = null) {
  const eventId = safeText(id);
  if (!eventId) return null;
  const projectId = safeText(scope?.projectId);

  if (await supportsSupabase()) {
    let existQuery = `select=*&id=eq.${encodeURIComponent(eventId)}&limit=1`;
    if (projectId) existQuery += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const existResult = await sbQuery({ table: t(), query: existQuery });
    if (existResult.ok) {
      const existing = sanitize(Array.isArray(existResult.data) ? existResult.data[0] : null);
      if (!existing) return null;
      const merged = sanitize({
        ...existing,
        ...input,
        id: eventId,
        projectId: existing.projectId,
        slug: input.slug !== undefined || !existing.slug
          ? await resolveSlug(input.slug ?? existing.slug, input.title ?? existing.title, scope, eventId)
          : existing.slug,
        updatedAt: new Date().toISOString(),
      });
      let patchQuery = `id=eq.${encodeURIComponent(eventId)}&select=*`;
      if (projectId) patchQuery += `&project_id=eq.${encodeURIComponent(projectId)}`;
      const updated = await sbQuery({
        method: 'PATCH', table: t(), query: patchQuery,
        headers: { Prefer: 'return=representation' }, body: toRow(merged),
      });
      if (updated.ok) return sanitize(Array.isArray(updated.data) ? updated.data[0] : updated.data);
      if (!isMissingTable(updated.error)) return null;
    } else if (!isMissingTable(existResult.error)) {
      return null;
    }
  }

  const store = readStore();
  const idx = store.events.findIndex((e) => {
    const row = sanitize(e);
    if (!row || row.id !== eventId) return false;
    return !projectId || row.projectId === projectId;
  });
  if (idx < 0) return null;
  const existing = sanitize(store.events[idx]);
  const next = sanitize({
    ...existing,
    ...input,
    id: eventId,
    projectId: existing.projectId,
    slug: input.slug !== undefined || !existing.slug
      ? await resolveSlug(input.slug ?? existing.slug, input.title ?? existing.title, scope, eventId)
      : existing.slug,
    updatedAt: new Date().toISOString(),
  });
  store.events[idx] = next;
  writeStore(store);
  return next;
}

async function deleteEvent(id, scope = null) {
  const eventId = safeText(id);
  if (!eventId) return null;
  const projectId = safeText(scope?.projectId);

  if (await supportsSupabase()) {
    let query = `id=eq.${encodeURIComponent(eventId)}&select=*`;
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const result = await sbQuery({
      method: 'DELETE', table: t(), query,
      headers: { Prefer: 'return=representation' },
    });
    if (result.ok) return sanitize(Array.isArray(result.data) ? result.data[0] : result.data);
    if (!isMissingTable(result.error)) return null;
  }

  const store = readStore();
  const idx = store.events.findIndex((e) => {
    const row = sanitize(e);
    if (!row || row.id !== eventId) return false;
    return !projectId || row.projectId === projectId;
  });
  if (idx < 0) return null;
  const [removed] = store.events.splice(idx, 1);
  writeStore(store);
  return sanitize(removed);
}

module.exports = {
  EVENT_STATUSES,
  listEvents,
  getEvent,
  getEventBySlug,
  createEvent,
  updateEvent,
  deleteEvent,
};
