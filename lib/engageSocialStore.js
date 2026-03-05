'use strict';

const fs = require('fs');
const path = require('path');
const { nextId } = require('../routes/http');

const STORE_FILE = path.join(__dirname, '..', 'data', 'engage_social_posts.json');

function ensureFile() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ posts: [] }, null, 2), { mode: 0o600 });
    fs.chmodSync(STORE_FILE, 0o600);
  }
}

function readStore() {
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

function writeStore(store) {
  ensureFile();
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STORE_FILE);
  fs.chmodSync(STORE_FILE, 0o600);
}

function sanitize(post) {
  if (!post || typeof post !== 'object') return null;
  return {
    id: String(post.id || ''),
    channel: 'x',
    text: String(post.text || ''),
    status: String(post.status || 'scheduled'),
    scheduledFor: String(post.scheduledFor || ''),
    createdAt: String(post.createdAt || ''),
    updatedAt: String(post.updatedAt || ''),
    publishedAt: String(post.publishedAt || ''),
    remoteId: String(post.remoteId || ''),
    error: String(post.error || ''),
  };
}

function listPosts() {
  const store = readStore();
  return store.posts
    .map(sanitize)
    .filter(Boolean)
    .sort((a, b) => {
      const aTime = new Date(a.scheduledFor || a.createdAt || 0).getTime();
      const bTime = new Date(b.scheduledFor || b.createdAt || 0).getTime();
      return bTime - aTime;
    });
}

function createPost(input) {
  const text = String(input.text || '').trim();
  const status = String(input.status || 'scheduled').trim() || 'scheduled';
  const scheduledFor = String(input.scheduledFor || '').trim();
  const now = new Date().toISOString();
  const store = readStore();
  const post = {
    id: nextId('spost'),
    channel: 'x',
    text,
    status,
    scheduledFor,
    createdAt: now,
    updatedAt: now,
    publishedAt: '',
    remoteId: '',
    error: '',
  };
  store.posts.unshift(post);
  writeStore(store);
  return sanitize(post);
}

function updatePost(id, patch) {
  const postId = String(id || '').trim();
  if (!postId) return null;
  const store = readStore();
  const idx = store.posts.findIndex((p) => String(p.id || '') === postId);
  if (idx < 0) return null;
  const current = store.posts[idx];
  const next = {
    ...current,
    ...patch,
    id: current.id,
    channel: 'x',
    updatedAt: new Date().toISOString(),
  };
  store.posts[idx] = next;
  writeStore(store);
  return sanitize(next);
}

function deletePost(id) {
  const postId = String(id || '').trim();
  if (!postId) return null;
  const store = readStore();
  const idx = store.posts.findIndex((p) => String(p.id || '') === postId);
  if (idx < 0) return null;
  const [removed] = store.posts.splice(idx, 1);
  writeStore(store);
  return sanitize(removed);
}

function getPost(id) {
  return listPosts().find((p) => p.id === String(id || '').trim()) || null;
}

function listDuePosts(nowIso = new Date().toISOString()) {
  const now = new Date(nowIso).getTime();
  return listPosts().filter((post) => {
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
