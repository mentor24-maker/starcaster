'use strict';

/**
 * Hand-picked "related articles" links between blog posts.
 *
 * Relations are MUTUAL: relating A, B and C means each sees the other two.
 * One row per pair, with the ids canonically ordered so the same two posts
 * cannot become two rows. The ordering and pair arithmetic live in
 * lib/builder-client/blog-post-relations.ts and are shared with the browser --
 * a second implementation here would drift from it silently.
 */

const fs = require('fs');
const path = require('path');
const { nextId } = require('../routes/http');
const { sbQuery, tableConfig, isConfigured: isSupabaseConfigured } = require('./supabase');
const { writeJsonAtomic, ensureJsonFile } = require('./localDataFs');

const STORE_FILE = path.join(__dirname, '..', 'data', 'blog_post_relations.json');
const SUPPORT_CACHE = new Map();

function t() { return tableConfig().blogPostRelations; }

function safeText(v) { return String(v || '').trim(); }

/**
 * Order a pair so the same two posts always produce the same row. Mirrors
 * canonicalPair() in blog-post-relations.ts; returns null for a self-pair or a
 * blank side, neither of which is a relation.
 */
function canonicalPair(first, second) {
  const a = safeText(first);
  const b = safeText(second);
  if (!a || !b || a === b) return null;
  return a < b ? { postIdA: a, postIdB: b } : { postIdA: b, postIdB: a };
}

function pairKey(pair) { return `${pair.postIdA} ${pair.postIdB}`; }

function ensureFile() {
  ensureJsonFile(STORE_FILE, { relations: [] }, { mode: 0o600 });
}

function readStore() {
  try {
    ensureFile();
    const parsed = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { relations: [] };
    if (!Array.isArray(parsed.relations)) parsed.relations = [];
    return parsed;
  } catch {
    return { relations: [] };
  }
}

function writeStore(store) {
  ensureFile();
  writeJsonAtomic(STORE_FILE, store, { mode: 0o600 });
}

function sanitize(input) {
  if (!input || typeof input !== 'object') return null;
  const pair = canonicalPair(
    input.postIdA || input.post_id_a,
    input.postIdB || input.post_id_b
  );
  if (!pair) return null;
  return {
    id:          String(input.id || ''),
    projectId:   safeText(input.projectId || input.project_id),
    ownerUserId: safeText(input.ownerUserId || input.owner_user_id),
    postIdA:     pair.postIdA,
    postIdB:     pair.postIdB,
    createdAt:   String(input.createdAt || input.created_at || ''),
  };
}

function toRow(r) {
  return {
    id:            r.id,
    project_id:    r.projectId,
    owner_user_id: r.ownerUserId || null,
    post_id_a:     r.postIdA,
    post_id_b:     r.postIdB,
  };
}

function isMissingTable(err) {
  const t = String(err || '').toLowerCase();
  return t.includes('does not exist') || t.includes('relation') || t.includes('schema cache');
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

/** Every relation pair in a project. */
async function listRelations(scope = null) {
  const projectId = safeText(scope?.projectId);

  if (await supportsSupabase()) {
    let query = 'select=*&limit=5000';
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const result = await sbQuery({ table: t(), query });
    if (result.ok) return (Array.isArray(result.data) ? result.data : []).map(sanitize).filter(Boolean);
    if (!isMissingTable(result.error)) return [];
  }

  const store = readStore();
  return store.relations
    .map(sanitize)
    .filter(Boolean)
    .filter((r) => !projectId || r.projectId === projectId);
}

/** The post ids related to one post, in either direction. */
async function listRelatedPostIds(postId, scope = null) {
  const target = safeText(postId);
  if (!target) return [];
  const relations = await listRelations(scope);
  const out = [];
  const seen = new Set();
  for (const rel of relations) {
    const other = rel.postIdA === target ? rel.postIdB : rel.postIdB === target ? rel.postIdA : '';
    if (!other || seen.has(other)) continue;
    seen.add(other);
    out.push(other);
  }
  return out;
}

/**
 * Relate a set of posts to each other. Every pair the set implies is written,
 * minus the ones already stored -- so pressing Relate Checked twice on the
 * same selection is a no-op rather than a duplicate-key failure.
 *
 * Returns { added, alreadyRelated, pairs } so the caller can say what actually
 * happened. Fewer than two distinct posts adds nothing.
 */
async function relatePosts(postIds, scope = null) {
  const projectId = safeText(scope?.projectId);
  const userId = safeText(scope?.userId);

  const ids = [];
  const seenId = new Set();
  for (const raw of Array.isArray(postIds) ? postIds : []) {
    const id = safeText(raw);
    if (!id || seenId.has(id)) continue;
    seenId.add(id);
    ids.push(id);
  }

  const wanted = [];
  const emitted = new Set();
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const pair = canonicalPair(ids[i], ids[j]);
      if (!pair) continue;
      const key = pairKey(pair);
      if (emitted.has(key)) continue;
      emitted.add(key);
      wanted.push(pair);
    }
  }
  if (wanted.length === 0) return { added: 0, alreadyRelated: 0, pairs: [] };

  const existing = await listRelations(scope);
  const have = new Set(existing.map(pairKey));
  const toAdd = wanted.filter((p) => !have.has(pairKey(p)));
  const alreadyRelated = wanted.length - toAdd.length;
  if (toAdd.length === 0) return { added: 0, alreadyRelated, pairs: [] };

  const now = new Date().toISOString();
  const rows = toAdd.map((pair) => sanitize({
    id:          nextId('brel'),
    projectId,
    ownerUserId: userId,
    postIdA:     pair.postIdA,
    postIdB:     pair.postIdB,
    createdAt:   now,
  })).filter(Boolean);

  if (await supportsSupabase()) {
    const result = await sbQuery({
      method: 'POST', table: t(), query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: rows.map((r) => ({ ...toRow(r), created_at: now })),
    });
    if (result.ok) {
      const written = (Array.isArray(result.data) ? result.data : []).map(sanitize).filter(Boolean);
      return { added: written.length, alreadyRelated, pairs: written };
    }
    // A refusal is NOT a reason to fall back to the local file: the database
    // said no, and answering 200 with the caller's own input would report a
    // save that did not happen (CLAUDE.md landmine 15). The file fallback is
    // for the table being ABSENT, never for it refusing.
    if (!isMissingTable(result.error)) return null;
  }

  const store = readStore();
  store.relations.push(...rows);
  writeStore(store);
  return { added: rows.length, alreadyRelated, pairs: rows };
}

/** Remove one relation. Order of the two ids does not matter. */
async function unrelatePosts(firstId, secondId, scope = null) {
  const pair = canonicalPair(firstId, secondId);
  if (!pair) return null;
  const projectId = safeText(scope?.projectId);

  if (await supportsSupabase()) {
    let query = `post_id_a=eq.${encodeURIComponent(pair.postIdA)}&post_id_b=eq.${encodeURIComponent(pair.postIdB)}&select=*`;
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const result = await sbQuery({
      method: 'DELETE', table: t(), query,
      headers: { Prefer: 'return=representation' },
    });
    if (result.ok) {
      const removed = (Array.isArray(result.data) ? result.data : []).map(sanitize).filter(Boolean);
      return { removed: removed.length, pair };
    }
    if (!isMissingTable(result.error)) return null;
  }

  const store = readStore();
  const before = store.relations.length;
  store.relations = store.relations.filter((r) => {
    const rel = sanitize(r);
    if (!rel) return false;
    if (projectId && rel.projectId !== projectId) return true;
    return !(rel.postIdA === pair.postIdA && rel.postIdB === pair.postIdB);
  });
  writeStore(store);
  return { removed: before - store.relations.length, pair };
}

module.exports = { listRelations, listRelatedPostIds, relatePosts, unrelatePosts };
