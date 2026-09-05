'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { normalizeMessagingTag } = require('./messagingTagNormalize');
const { normalizeMessagingTagSource } = require('./messagingTagSource');
const {
  scopedListQuery,
  scopedIdQuery,
  scopedInsertRow,
  scopedPatchRow,
} = require('./projectScope');

function table() {
  return tableConfig().messagingTags;
}

/**
 * The tag as the messaging side AUTHORS a new one: hashtag-shaped — title-cased
 * and at most three words (lib/messagingTagNormalize.js). That is a rule about
 * how Messaging COINS a tag, not a property of the table, so it is applied on
 * create and nowhere else.
 */
function authoredText(value, max = 240) {
  return normalizeMessagingTag(String(value || '').trim().replace(/\s+/g, ' ').slice(0, max));
}

/**
 * The tag as it is STORED: trimmed, inner whitespace collapsed, nothing else.
 *
 * Reading a row through the messaging vocabulary is what broke once the two tag
 * lists became one table (86bbu4gdu, round 1). A media tag typed as
 * "Center Court North Entrance" came back out of here as "Center Court North";
 * and because Messaging > Tags prefills its edit form from that value and
 * PATCHes `tag` back on save, an admin opening the tag merely to change its
 * topic rewrote the shared row to the truncation — permanently, and no longer
 * matching the strings on `assets.tags`.
 *
 * So the vocabulary is never applied on the way OUT, and never on an UPDATE,
 * which would rewrite a value this side did not author.
 */
function storedText(value, max = 240) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

/** The key uniqueness is judged on — the expression idx_messaging_tags_project_tag uses. */
function tagKey(value) {
  return storedText(value, 240).toLowerCase();
}

function cleanTopic(value, max = 240) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function cleanImportance(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const rounded = Math.round(num);
  if (rounded < 1 || rounded > 5) return null;
  return rounded;
}

function errorText(res) {
  return String(res?.error || res?.message || '').toLowerCase();
}

function shouldRetryWithLegacyCategory(res) {
  const text = errorText(res);
  return text.includes('topic') && (text.includes('column') || text.includes('schema cache'));
}

/**
 * True when the database refused the write because
 * idx_messaging_tags_project_tag already holds this (project_id, lower(tag)).
 * Deliberately narrow — any other refusal is returned to the caller untouched
 * (CLAUDE.md landmine 15: a fallback is for a thing being ABSENT, never for the
 * database saying no).
 */
function isDuplicateTag(res) {
  if (!res || res.ok) return false;
  const text = errorText(res);
  return text.includes('duplicate key')
    && (text.includes('idx_messaging_tags_project_tag') || text.includes('messaging_tags'));
}

/**
 * Why the tag was refused, in a sentence an admin can act on.
 *
 * Two things have to be said, because either one alone reads as the feature
 * being broken (CLAUDE.md landmine 17). First, that the project already has
 * this tag. Second — when the vocabulary changed what was typed — what it
 * became, which is the whole explanation for the case the review found:
 * "Clone Tag" appends " Copy", and for a three-word tag that fourth word is
 * dropped again, so the clone collides with the tag it was cloned from.
 */
function duplicateTagMessage(typed, stored) {
  const collapsed = storedText(typed, 240);
  const shortened = collapsed && tagKey(collapsed) !== tagKey(stored)
    ? ` ("${collapsed}" becomes "${stored}" — a messaging tag is title-cased and keeps at most three words)`
    : '';
  return `This project already has a tag called "${stored}"${shortened}. `
    + 'Tags are compared without regard to capitals.';
}

function rowToMessagingTag(row) {
  if (!row) return null;
  return {
    id: Number(row.id || 0) || 0,
    tag: storedText(row.tag, 240),
    topic: cleanTopic(row.topic != null ? row.topic : row.category, 240),
    importance: cleanImportance(row.importance),
    // Which side of the platform created this tag. '' means "origin not
    // recorded" — the honest answer for every row that predates the column.
    // The Media Manager writes 'client-admin' through lib/assetTagsStore.js;
    // the Starcaster back-end leaves it alone, which is why nothing here
    // stamps it on create. See lib/messagingTagSource.js.
    source: normalizeMessagingTagSource(row.source),
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  };
}

async function listMessagingTags(limit = 5000, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 5000, 5000));
  const query = await scopedListQuery(table(), `select=*&order=tag.asc&limit=${safeLimit}`, scope);
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToMessagingTag) : [],
  };
}

/**
 * Case-insensitive lookup of a tag within this project — exactly the question
 * the unique index asks, asked before it can answer with a constraint dump.
 */
async function findMessagingTagByName(tag, scope = null) {
  const key = tagKey(tag);
  if (!key) return { ok: true, status: 200, data: [] };
  const listed = await listMessagingTags(5000, scope);
  if (!listed.ok) return listed;
  const rows = Array.isArray(listed.data) ? listed.data : [];
  return { ok: true, status: 200, data: rows.filter((row) => tagKey(row.tag) === key) };
}

async function createMessagingTag(input, scope = null) {
  const tag = authoredText(input?.tag, 240);
  const topic = cleanTopic(input?.topic != null ? input.topic : input?.category, 240);
  const importance = cleanImportance(input?.importance);
  if (!tag) return { ok: false, status: 400, error: 'tag is required' };

  // Ask the uniqueness question before the index does. Until 86bbu4gdu round 2
  // there was no check here at all, so the moment
  // docs/SQL/messaging_tags_source.sql is applied, Messaging > Tags would have
  // started putting `duplicate key value violates unique constraint
  // "idx_messaging_tags_project_tag"` in a toast. The Media Manager has had a
  // graceful path all along (lib/assetTagsStore.js) — this is the same
  // question, answered differently on purpose: see the note there.
  const existing = await findMessagingTagByName(tag, scope);
  if (!existing.ok) return existing;
  if (Array.isArray(existing.data) && existing.data.length) {
    return {
      ok: false,
      status: 409,
      error: duplicateTagMessage(input?.tag, existing.data[0].tag),
    };
  }

  const insertPayload = { tag, topic };
  if (importance != null) insertPayload.importance = importance;
  const row = await scopedInsertRow(table(), insertPayload, scope);
  let res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok && shouldRetryWithLegacyCategory(res)) {
    const legacyRow = await scopedInsertRow(table(), { tag, category: topic }, scope);
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [legacyRow],
    });
  }
  if (!res.ok && topic && errorText(res).includes('topic') && errorText(res).includes('column')) {
    const fallbackRow = await scopedInsertRow(table(), { tag }, scope);
    res = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: [fallbackRow],
    });
  }
  if (!res.ok) {
    // Two writers can still race past the check above. Translate only the
    // uniqueness refusal; everything else reaches the caller as it came.
    if (isDuplicateTag(res)) {
      return { ok: false, status: 409, error: duplicateTagMessage(input?.tag, tag) };
    }
    return res;
  }
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToMessagingTag(created) };
}

async function getMessagingTag(id, scope = null) {
  const tagId = Number(id || 0) || 0;
  if (!tagId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `select=*&id=eq.${tagId}&limit=1`, scope);
  const res = await sbQuery({
    method: 'GET',
    table: table(),
    query,
  });
  if (!res.ok) return res;
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!row) return { ok: false, status: 404, error: 'Tag not found' };
  return { ok: true, status: 200, data: rowToMessagingTag(row) };
}

function buildTagPatch(input) {
  const patch = {};
  if (input?.tag != null) {
    // storedText, NOT authoredText: an update must not rewrite a value this
    // side did not author. See the note on storedText.
    const tag = storedText(input.tag, 240);
    if (!tag) return { ok: false, error: 'tag is required' };
    patch.tag = tag;
  }
  if (input?.topic != null || input?.category != null) {
    patch.topic = cleanTopic(input?.topic != null ? input.topic : input?.category, 240);
  }
  if (input?.importance != null) {
    patch.importance = cleanImportance(input.importance);
  } else if (Object.prototype.hasOwnProperty.call(input || {}, 'importance')) {
    patch.importance = null;
  }
  if (!Object.keys(patch).length) {
    return { ok: false, error: 'No fields to update' };
  }
  return { ok: true, patch };
}

async function updateMessagingTag(id, input, scope = null) {
  const tagId = Number(id || 0) || 0;
  if (!tagId) return { ok: false, status: 400, error: 'id is required' };
  const built = buildTagPatch(input || {});
  if (!built.ok) return { ok: false, status: 400, error: built.error || 'No fields to update' };

  // Renaming onto an existing tag hits the same unique index a create does, so
  // it needs the same sentence rather than the same constraint dump. The row
  // being edited is excluded, or saving a tag without changing its name would
  // report the tag as a duplicate of itself.
  if (built.patch.tag != null) {
    const clash = await findMessagingTagByName(built.patch.tag, scope);
    if (!clash.ok) return clash;
    const other = (Array.isArray(clash.data) ? clash.data : []).find((r) => Number(r.id) !== tagId);
    if (other) {
      return { ok: false, status: 409, error: duplicateTagMessage(input?.tag, other.tag) };
    }
  }

  let row = await scopedPatchRow(table(), built.patch, scope);
  let query = await scopedIdQuery(table(), `id=eq.${tagId}&select=*`, scope);
  let res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok && shouldRetryWithLegacyCategory(res)) {
    const legacyPatch = { ...built.patch };
    if (legacyPatch.topic != null) {
      legacyPatch.category = legacyPatch.topic;
      delete legacyPatch.topic;
    }
    row = await scopedPatchRow(table(), legacyPatch, scope);
    query = await scopedIdQuery(table(), `id=eq.${tagId}&select=*`, scope);
    res = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: row,
    });
  }
  if (!res.ok) {
    if (isDuplicateTag(res)) {
      return {
        ok: false,
        status: 409,
        error: duplicateTagMessage(input?.tag, built.patch.tag || storedText(input?.tag, 240)),
      };
    }
    return res;
  }
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Tag not found' };
  return { ok: true, status: 200, data: rowToMessagingTag(updated) };
}

async function deleteMessagingTag(id, scope = null) {
  const tagId = Number(id || 0) || 0;
  if (!tagId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `id=eq.${tagId}&select=*`, scope);
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const deleted = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!deleted) return { ok: false, status: 404, error: 'Tag not found' };
  return { ok: true, status: 200, data: rowToMessagingTag(deleted) };
}

module.exports = {
  // Exported for the tests that guard the read/write asymmetry — the messaging
  // vocabulary shapes a tag on create only.
  authoredText,
  storedText,
  tagKey,
  buildTagPatch,
  rowToMessagingTag,
  isDuplicateTag,
  duplicateTagMessage,
  findMessagingTagByName,
  listMessagingTags,
  createMessagingTag,
  getMessagingTag,
  updateMessagingTag,
  deleteMessagingTag,
};
