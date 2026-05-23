'use strict';

const fs = require('fs');
const path = require('path');
const { nextId } = require('../routes/http');
const { sbQuery, tableConfig, isConfigured: isSupabaseConfigured } = require('./supabase');
const {
  scopedListQuery,
  scopedIdQuery,
  scopedInsertRow,
  scopedPatchRow,
} = require('./projectScope');
const {
  matchesScopedRecord,
  attachScopeFields,
  normalizeScope,
} = require('./projectScopeFile');
const { writeJsonAtomic, ensureJsonFile } = require('./localDataFs');

const STORE_FILE = path.join(__dirname, '..', 'data', 'engage_social_posts.json');
const SUPPORT_CACHE = new Map();

function table() {
  return tableConfig().engageSocialPosts;
}

function ensureFile() {
  ensureJsonFile(STORE_FILE, { posts: [] }, { mode: 0o600 });
}

function readFileStore() {
  try {
    ensureFile();
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { posts: [] };
    if (!Array.isArray(parsed.posts)) parsed.posts = [];
    return parsed;
  } catch {
    return { posts: [] };
  }
}

function writeFileStore(store) {
  ensureFile();
  writeJsonAtomic(STORE_FILE, store, { mode: 0o600 });
}

function isMissingTableError(errorInput) {
  const text = String(errorInput || '').toLowerCase();
  return text.includes('does not exist') || text.includes('relation') || text.includes('schema cache');
}

async function supportsSupabasePosts() {
  if (!isSupabaseConfigured()) return false;
  const tableName = table();
  if (!tableName) return false;
  if (SUPPORT_CACHE.has(tableName)) return SUPPORT_CACHE.get(tableName);
  const probe = await sbQuery({ table: tableName, query: 'select=id&limit=1' });
  const supported = probe.ok || !isMissingTableError(probe.error);
  SUPPORT_CACHE.set(tableName, supported);
  return supported;
}

function rowToPost(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: String(row.id || ''),
    channel: String(row.channel || 'x').trim().toLowerCase() || 'x',
    campaignId: String(row.campaign_id || row.campaignId || ''),
    imageUrl: String(row.image_url || row.imageUrl || ''),
    imageAlt: String(row.image_alt || row.imageAlt || ''),
    text: String(row.post_text || row.text || ''),
    status: String(row.status || 'scheduled'),
    scheduledFor: String(row.scheduled_for || row.scheduledFor || ''),
    createdAt: String(row.created_at || row.createdAt || ''),
    updatedAt: String(row.updated_at || row.updatedAt || ''),
    publishedAt: String(row.published_at || row.publishedAt || ''),
    remoteId: String(row.remote_id || row.remoteId || ''),
    error: String(row.error || ''),
    diagnostics: row.diagnostics && typeof row.diagnostics === 'object' ? row.diagnostics : null,
    projectId: String(row.project_id || row.projectId || ''),
    ownerUserId: String(row.owner_user_id || row.ownerUserId || ''),
  };
}

function postToRow(post) {
  const clean = rowToPost(post);
  if (!clean) return null;
  return {
    id: clean.id,
    channel: clean.channel,
    campaign_id: clean.campaignId,
    image_url: clean.imageUrl,
    image_alt: clean.imageAlt,
    post_text: clean.text,
    status: clean.status,
    scheduled_for: clean.scheduledFor || null,
    published_at: clean.publishedAt || null,
    remote_id: clean.remoteId,
    error: clean.error,
    diagnostics: clean.diagnostics || {},
    project_id: clean.projectId || null,
    owner_user_id: clean.ownerUserId || null,
    created_at: clean.createdAt || new Date().toISOString(),
    updated_at: clean.updatedAt || new Date().toISOString(),
  };
}

function sortPosts(posts) {
  return posts.sort((a, b) => {
    const aTime = new Date(a.scheduledFor || a.createdAt || 0).getTime();
    const bTime = new Date(b.scheduledFor || b.createdAt || 0).getTime();
    return bTime - aTime;
  });
}

async function listPosts(scope = null) {
  if (await supportsSupabasePosts()) {
    const query = await scopedListQuery(
      table(),
      'select=*&order=updated_at.desc,created_at.desc&limit=5000',
      scope
    );
    const result = await sbQuery({ table: table(), query });
    if (result.ok) {
      return (Array.isArray(result.data) ? result.data : [])
        .map(rowToPost)
        .filter(Boolean);
    }
    if (!isMissingTableError(result.error)) {
      return [];
    }
  }

  const store = readFileStore();
  return sortPosts(
    store.posts
      .map((post) => rowToPost(post))
      .filter(Boolean)
      .filter((post) => matchesScopedRecord(post, scope))
  );
}

async function getPost(id, scope = null) {
  const postId = String(id || '').trim();
  if (!postId) return null;
  if (await supportsSupabasePosts()) {
    const query = await scopedIdQuery(table(), `select=*&id=eq.${encodeURIComponent(postId)}&limit=1`, scope);
    const result = await sbQuery({ table: table(), query });
    if (result.ok) {
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      return row ? rowToPost(row) : null;
    }
  }
  return (await listPosts(scope)).find((post) => post.id === postId) || null;
}

async function createPost(input, scope = null) {
  const text = String(input?.text || '').trim();
  const status = String(input?.status || 'scheduled').trim() || 'scheduled';
  const scheduledFor = String(input?.scheduledFor || '').trim();
  const now = new Date().toISOString();
  const scoped = normalizeScope(scope);

  const post = {
    id: nextId('spost'),
    channel: String(input?.channel || 'x').trim().toLowerCase() || 'x',
    campaignId: String(input?.campaignId || ''),
    imageUrl: String(input?.imageUrl || ''),
    imageAlt: String(input?.imageAlt || ''),
    text,
    status,
    scheduledFor,
    createdAt: now,
    updatedAt: now,
    publishedAt: '',
    remoteId: '',
    error: '',
    diagnostics: input?.diagnostics && typeof input.diagnostics === 'object' ? input.diagnostics : null,
    projectId: scoped.projectId,
    ownerUserId: scoped.userId,
  };

  if (await supportsSupabasePosts()) {
    const row = await scopedInsertRow(table(), postToRow(post), scope);
    const insert = await sbQuery({
      method: 'POST',
      table: table(),
      query: 'select=*',
      headers: { Prefer: 'return=representation' },
      body: row,
    });
    if (insert.ok) {
      const saved = Array.isArray(insert.data) ? insert.data[0] : insert.data;
      return rowToPost(saved);
    }
  }

  const store = readFileStore();
  const filePost = attachScopeFields(post, scope);
  store.posts.unshift(filePost);
  writeFileStore(store);
  return rowToPost(filePost);
}

async function updatePost(id, patch, scope = null) {
  const postId = String(id || '').trim();
  if (!postId) return null;
  const existing = await getPost(postId, scope);
  if (!existing) return null;

  const next = {
    ...existing,
    ...patch,
    id: existing.id,
    updatedAt: new Date().toISOString(),
  };

  if (await supportsSupabasePosts()) {
    const rowPatch = await scopedPatchRow(table(), {
      channel: next.channel,
      campaign_id: next.campaignId,
      image_url: next.imageUrl,
      image_alt: next.imageAlt,
      post_text: next.text,
      status: next.status,
      scheduled_for: next.scheduledFor || null,
      published_at: next.publishedAt || null,
      remote_id: next.remoteId,
      error: next.error,
      diagnostics: next.diagnostics || {},
      updated_at: next.updatedAt,
    }, scope);
    const query = await scopedIdQuery(table(), `id=eq.${encodeURIComponent(postId)}&select=*`, scope);
    const result = await sbQuery({
      method: 'PATCH',
      table: table(),
      query,
      headers: { Prefer: 'return=representation' },
      body: rowPatch,
    });
    if (result.ok) {
      const row = Array.isArray(result.data) ? result.data[0] : result.data;
      return row ? rowToPost(row) : rowToPost(next);
    }
  }

  const store = readFileStore();
  const idx = store.posts.findIndex((p) => String(p.id || '') === postId);
  if (idx < 0) return null;
  store.posts[idx] = attachScopeFields({ ...store.posts[idx], ...next }, scope);
  writeFileStore(store);
  return rowToPost(store.posts[idx]);
}

async function deletePost(id, scope = null) {
  const postId = String(id || '').trim();
  if (!postId) return null;
  const existing = await getPost(postId, scope);
  if (!existing) return null;

  if (await supportsSupabasePosts()) {
    const query = await scopedIdQuery(table(), `id=eq.${encodeURIComponent(postId)}&select=*`, scope);
    const result = await sbQuery({ method: 'DELETE', table: table(), query });
    if (result.ok) return existing;
  }

  const store = readFileStore();
  const idx = store.posts.findIndex((p) => String(p.id || '') === postId);
  if (idx < 0) return null;
  const [removed] = store.posts.splice(idx, 1);
  writeFileStore(store);
  return rowToPost(removed);
}

async function listDuePosts(scope = null, nowIso = new Date().toISOString()) {
  const now = new Date(nowIso).getTime();
  const posts = await listPosts(scope);
  return posts.filter((post) => {
    if (post.status !== 'scheduled') return false;
    if (!post.scheduledFor) return true;
    const scheduled = new Date(post.scheduledFor).getTime();
    return Number.isFinite(scheduled) && scheduled <= now;
  });
}

module.exports = {
  listPosts,
  createPost,
  updatePost,
  deletePost,
  getPost,
  listDuePosts,
};
