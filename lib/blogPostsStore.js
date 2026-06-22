'use strict';

const fs = require('fs');
const path = require('path');
const { nextId } = require('../routes/http');
const { sbQuery, tableConfig, isConfigured: isSupabaseConfigured } = require('./supabase');
const { writeJsonAtomic, ensureJsonFile } = require('./localDataFs');

const POSTS_FILE      = path.join(__dirname, '..', 'data', 'blog_posts.json');
const JOIN_FILE       = path.join(__dirname, '..', 'data', 'blog_post_categories.json');
const SUPPORT_CACHE   = new Map();

function t()    { return tableConfig().blogPosts; }
function tJoin(){ return tableConfig().blogPostCategories; }

function ensurePosts() { ensureJsonFile(POSTS_FILE, { posts: [] }, { mode: 0o600 }); }
function ensureJoin()  { ensureJsonFile(JOIN_FILE,  { rows: []  }, { mode: 0o600 }); }

function readPosts() {
  try {
    ensurePosts();
    const raw = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8'));
    if (!Array.isArray(raw?.posts)) return { posts: [] };
    return raw;
  } catch { return { posts: [] }; }
}

function writePosts(store) {
  ensurePosts();
  writeJsonAtomic(POSTS_FILE, store, { mode: 0o600 });
}

function readJoin() {
  try {
    ensureJoin();
    const raw = JSON.parse(fs.readFileSync(JOIN_FILE, 'utf8'));
    if (!Array.isArray(raw?.rows)) return { rows: [] };
    return raw;
  } catch { return { rows: [] }; }
}

function writeJoin(store) {
  ensureJoin();
  writeJsonAtomic(JOIN_FILE, store, { mode: 0o600 });
}

function safeText(v) { return String(v || '').trim(); }

function sanitize(input) {
  if (!input || typeof input !== 'object') return null;
  return {
    id:                   String(input.id || ''),
    projectId:            safeText(input.projectId || input.project_id),
    ownerUserId:          safeText(input.ownerUserId || input.owner_user_id),
    title:                String(input.title || ''),
    slug:                 String(input.slug || ''),
    status:               String(input.status || 'draft'),
    author:               String(input.author || ''),
    authorUserId:         safeText(input.authorUserId || input.author_user_id),
    featuredImageUrl:     String(input.featuredImageUrl || input.featured_image_url || ''),
    featuredImageAssetId: safeText(input.featuredImageAssetId || input.featured_image_asset_id),
    excerpt:              String(input.excerpt || ''),
    body:                 String(input.body || ''),
    seoTitle:             String(input.seoTitle || input.seo_title || ''),
    seoDescription:       String(input.seoDescription || input.seo_description || ''),
    tags:                 Array.isArray(input.tags) ? input.tags.map(String) : (safeText(input.tags) ? safeText(input.tags).split(',').map((t) => t.trim()).filter(Boolean) : []),
    readingTimeMinutes:   input.readingTimeMinutes != null ? Number(input.readingTimeMinutes) : (input.reading_time_minutes != null ? Number(input.reading_time_minutes) : null),
    publishedAt:          input.publishedAt || input.published_at || null,
    categoryIds:          Array.isArray(input.categoryIds) ? input.categoryIds : [],
    createdAt:            String(input.createdAt || input.created_at || ''),
    updatedAt:            String(input.updatedAt || input.updated_at || ''),
  };
}

function toRow(p) {
  return {
    id:                    p.id,
    project_id:            p.projectId,
    owner_user_id:         p.ownerUserId || null,
    title:                 p.title,
    slug:                  p.slug,
    status:                p.status,
    author:                p.author,
    author_user_id:        p.authorUserId || null,
    featured_image_url:    p.featuredImageUrl,
    featured_image_asset_id: p.featuredImageAssetId || null,
    excerpt:               p.excerpt,
    body:                  p.body,
    seo_title:             p.seoTitle,
    seo_description:       p.seoDescription,
    tags:                  p.tags,
    reading_time_minutes:  p.readingTimeMinutes ?? null,
    published_at:          p.publishedAt || null,
  };
}

function isMissingTable(err) {
  const text = String(err || '').toLowerCase();
  return text.includes('does not exist') || text.includes('relation') || text.includes('schema cache');
}

async function supportsSupabase(which = 'posts') {
  if (!isSupabaseConfigured()) return false;
  const table = which === 'join' ? tJoin() : t();
  if (!table) return false;
  if (SUPPORT_CACHE.has(table)) return SUPPORT_CACHE.get(table);
  const probe = await sbQuery({ table, query: 'select=id&limit=1' });
  const ok = probe.ok || !isMissingTable(probe.error);
  SUPPORT_CACHE.set(table, ok);
  return ok;
}

// ── Join table helpers ────────────────────────────────────────────────────────

async function getCategoryIdsForPost(postId) {
  if (await supportsSupabase('join')) {
    const result = await sbQuery({ table: tJoin(), query: `select=category_id&post_id=eq.${encodeURIComponent(postId)}&limit=200` });
    if (result.ok) return (Array.isArray(result.data) ? result.data : []).map((r) => String(r.category_id || '')).filter(Boolean);
  }
  const store = readJoin();
  return store.rows.filter((r) => r.post_id === postId).map((r) => r.category_id).filter(Boolean);
}

async function setCategoryIds(postId, categoryIds) {
  const ids = Array.isArray(categoryIds) ? categoryIds.filter(Boolean) : [];

  if (await supportsSupabase('join')) {
    await sbQuery({ method: 'DELETE', table: tJoin(), query: `post_id=eq.${encodeURIComponent(postId)}` });
    if (ids.length > 0) {
      await sbQuery({ method: 'POST', table: tJoin(), query: '', body: ids.map((catId) => ({ post_id: postId, category_id: catId })) });
    }
    return;
  }

  const store = readJoin();
  store.rows = store.rows.filter((r) => r.post_id !== postId);
  for (const catId of ids) store.rows.push({ post_id: postId, category_id: catId });
  writeJoin(store);
}

async function getPostIdsForCategory(categoryId) {
  if (await supportsSupabase('join')) {
    const result = await sbQuery({ table: tJoin(), query: `select=post_id&category_id=eq.${encodeURIComponent(categoryId)}&limit=500` });
    if (result.ok) return (Array.isArray(result.data) ? result.data : []).map((r) => String(r.post_id || '')).filter(Boolean);
  }
  const store = readJoin();
  return store.rows.filter((r) => r.category_id === categoryId).map((r) => r.post_id).filter(Boolean);
}

// ── Public API ────────────────────────────────────────────────────────────────

async function listPosts({ status, categoryId, page = 1, limit = 20 } = {}, scope = null) {
  const projectId = safeText(scope?.projectId);
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * pageSize;

  // Resolve post IDs for category filter before querying posts
  let filterPostIds = null;
  if (categoryId) {
    filterPostIds = await getPostIdsForCategory(categoryId);
    if (filterPostIds.length === 0) return [];
  }

  if (await supportsSupabase()) {
    let query = `select=*&order=published_at.desc.nullslast,created_at.desc&limit=${pageSize}&offset=${offset}`;
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    if (status)    query += `&status=eq.${encodeURIComponent(status)}`;
    if (filterPostIds) query += `&id=in.(${filterPostIds.map(encodeURIComponent).join(',')})`;
    const result = await sbQuery({ table: t(), query });
    if (result.ok) {
      const posts = (Array.isArray(result.data) ? result.data : []).map(sanitize).filter(Boolean);
      // Attach categoryIds to each post
      for (const post of posts) {
        post.categoryIds = await getCategoryIdsForPost(post.id);
      }
      return posts;
    }
    if (!isMissingTable(result.error)) return [];
  }

  // JSON fallback
  const store = readPosts();
  const join = readJoin();
  let posts = store.posts.map(sanitize).filter(Boolean)
    .filter((p) => !projectId || p.projectId === projectId)
    .filter((p) => !status || p.status === status);
  if (filterPostIds) {
    const idSet = new Set(filterPostIds);
    posts = posts.filter((p) => idSet.has(p.id));
  }
  posts.sort((a, b) => {
    const aT = new Date(a.publishedAt || a.createdAt || 0).getTime();
    const bT = new Date(b.publishedAt || b.createdAt || 0).getTime();
    return bT - aT;
  });
  const page_slice = posts.slice(offset, offset + pageSize);
  for (const post of page_slice) {
    post.categoryIds = join.rows.filter((r) => r.post_id === post.id).map((r) => r.category_id);
  }
  return page_slice;
}

async function getPost(id, scope = null) {
  const postId = safeText(id);
  if (!postId) return null;
  const projectId = safeText(scope?.projectId);

  if (await supportsSupabase()) {
    let query = `select=*&id=eq.${encodeURIComponent(postId)}&limit=1`;
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const result = await sbQuery({ table: t(), query });
    if (result.ok) {
      const post = sanitize(Array.isArray(result.data) ? result.data[0] : null);
      if (post) post.categoryIds = await getCategoryIdsForPost(post.id);
      return post;
    }
    if (!isMissingTable(result.error)) return null;
  }

  const store = readPosts();
  const post = sanitize(store.posts.find((p) => sanitize(p)?.id === postId));
  if (!post) return null;
  const join = readJoin();
  post.categoryIds = join.rows.filter((r) => r.post_id === postId).map((r) => r.category_id);
  return post;
}

async function getPostBySlug(slug, scope = null) {
  const postSlug = safeText(slug);
  if (!postSlug) return null;
  const projectId = safeText(scope?.projectId);

  if (await supportsSupabase()) {
    let query = `select=*&slug=eq.${encodeURIComponent(postSlug)}&limit=1`;
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const result = await sbQuery({ table: t(), query });
    if (result.ok) {
      const post = sanitize(Array.isArray(result.data) ? result.data[0] : null);
      if (post) post.categoryIds = await getCategoryIdsForPost(post.id);
      return post;
    }
    if (!isMissingTable(result.error)) return null;
  }

  const store = readPosts();
  const projectPosts = store.posts.map(sanitize).filter(Boolean)
    .filter((p) => !projectId || p.projectId === projectId);
  const post = projectPosts.find((p) => p.slug === postSlug) || null;
  if (!post) return null;
  const join = readJoin();
  post.categoryIds = join.rows.filter((r) => r.post_id === post.id).map((r) => r.category_id);
  return post;
}

async function createPost(input, scope = null) {
  const now = new Date().toISOString();
  const projectId = safeText(scope?.projectId);
  const userId = safeText(scope?.userId);

  const status = safeText(input.status) || 'draft';
  const publishedAt = status === 'published' ? (input.publishedAt || now) : (input.publishedAt || null);

  const post = sanitize({
    id:                   nextId('bpost'),
    projectId,
    ownerUserId:          userId,
    title:                safeText(input.title),
    slug:                 safeText(input.slug),
    status,
    author:               safeText(input.author),
    authorUserId:         safeText(input.authorUserId),
    featuredImageUrl:     safeText(input.featuredImageUrl),
    featuredImageAssetId: safeText(input.featuredImageAssetId),
    excerpt:              safeText(input.excerpt),
    body:                 String(input.body || ''),
    seoTitle:             safeText(input.seoTitle),
    seoDescription:       safeText(input.seoDescription),
    tags:                 Array.isArray(input.tags) ? input.tags : [],
    readingTimeMinutes:   input.readingTimeMinutes != null ? Number(input.readingTimeMinutes) : null,
    publishedAt,
    categoryIds:          [],
    createdAt:            now,
    updatedAt:            now,
  });

  if (await supportsSupabase()) {
    const row = { ...toRow(post), created_at: now, updated_at: now };
    const result = await sbQuery({
      method: 'POST', table: t(), query: 'select=*',
      headers: { Prefer: 'return=representation' }, body: [row],
    });
    if (result.ok) {
      const created = sanitize(Array.isArray(result.data) ? result.data[0] : result.data);
      if (created) {
        const catIds = Array.isArray(input.categoryIds) ? input.categoryIds : [];
        await setCategoryIds(created.id, catIds);
        created.categoryIds = catIds;
      }
      return created;
    }
    if (!isMissingTable(result.error)) return null;
  }

  const store = readPosts();
  store.posts.unshift(post);
  writePosts(store);
  const catIds = Array.isArray(input.categoryIds) ? input.categoryIds : [];
  await setCategoryIds(post.id, catIds);
  post.categoryIds = catIds;
  return post;
}

async function updatePost(id, input, scope = null) {
  const postId = safeText(id);
  if (!postId) return null;
  const projectId = safeText(scope?.projectId);

  if (await supportsSupabase()) {
    let existQuery = `select=*&id=eq.${encodeURIComponent(postId)}&limit=1`;
    if (projectId) existQuery += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const existResult = await sbQuery({ table: t(), query: existQuery });
    if (existResult.ok) {
      const existing = sanitize(Array.isArray(existResult.data) ? existResult.data[0] : null);
      if (!existing) return null;

      const newStatus = input.status !== undefined ? safeText(input.status) : existing.status;
      const publishedAt = newStatus === 'published' && !existing.publishedAt
        ? (input.publishedAt || new Date().toISOString())
        : (input.publishedAt !== undefined ? (input.publishedAt || null) : existing.publishedAt);

      const merged = sanitize({
        ...existing,
        ...input,
        id: postId,
        projectId: existing.projectId,
        status: newStatus,
        publishedAt,
        updatedAt: new Date().toISOString(),
      });
      let patchQuery = `id=eq.${encodeURIComponent(postId)}&select=*`;
      if (projectId) patchQuery += `&project_id=eq.${encodeURIComponent(projectId)}`;
      const updated = await sbQuery({
        method: 'PATCH', table: t(), query: patchQuery,
        headers: { Prefer: 'return=representation' }, body: toRow(merged),
      });
      if (updated.ok) {
        const next = sanitize(Array.isArray(updated.data) ? updated.data[0] : updated.data);
        if (next) {
          if (Array.isArray(input.categoryIds)) await setCategoryIds(postId, input.categoryIds);
          next.categoryIds = await getCategoryIdsForPost(postId);
        }
        return next;
      }
      if (!isMissingTable(updated.error)) return null;
    } else if (!isMissingTable(existResult.error)) {
      return null;
    }
  }

  const store = readPosts();
  const idx = store.posts.findIndex((p) => sanitize(p)?.id === postId);
  if (idx < 0) return null;
  const existing = sanitize(store.posts[idx]);
  const newStatus = input.status !== undefined ? safeText(input.status) : existing.status;
  const publishedAt = newStatus === 'published' && !existing.publishedAt
    ? (input.publishedAt || new Date().toISOString())
    : (input.publishedAt !== undefined ? (input.publishedAt || null) : existing.publishedAt);
  const next = sanitize({ ...existing, ...input, id: postId, projectId: existing.projectId, status: newStatus, publishedAt, updatedAt: new Date().toISOString() });
  store.posts[idx] = next;
  writePosts(store);
  if (Array.isArray(input.categoryIds)) await setCategoryIds(postId, input.categoryIds);
  const join = readJoin();
  next.categoryIds = join.rows.filter((r) => r.post_id === postId).map((r) => r.category_id);
  return next;
}

async function deletePost(id, scope = null) {
  const postId = safeText(id);
  if (!postId) return null;
  const projectId = safeText(scope?.projectId);

  if (await supportsSupabase()) {
    let query = `id=eq.${encodeURIComponent(postId)}&select=*`;
    if (projectId) query += `&project_id=eq.${encodeURIComponent(projectId)}`;
    const result = await sbQuery({ method: 'DELETE', table: t(), query, headers: { Prefer: 'return=representation' } });
    if (result.ok) return sanitize(Array.isArray(result.data) ? result.data[0] : result.data);
    if (!isMissingTable(result.error)) return null;
  }

  const store = readPosts();
  const idx = store.posts.findIndex((p) => sanitize(p)?.id === postId);
  if (idx < 0) return null;
  const [removed] = store.posts.splice(idx, 1);
  writePosts(store);
  // join rows cascade in DB; clean up locally
  const join = readJoin();
  join.rows = join.rows.filter((r) => r.post_id !== postId);
  writeJoin(join);
  return sanitize(removed);
}

module.exports = { listPosts, getPost, getPostBySlug, createPost, updatePost, deletePost };
