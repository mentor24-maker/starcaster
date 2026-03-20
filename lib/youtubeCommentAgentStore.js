'use strict';

const fs = require('fs');
const path = require('path');
const { nextId } = require('../routes/http');
const { isConfigured: isBlobConfigured } = require('./blobStorage');

const STORE_FILE = path.join(__dirname, '..', 'data', 'youtube_comment_agents.json');
const BLOB_PATHNAME = String(process.env.YOUTUBE_COMMENT_AGENTS_BLOB_PATH || 'APP/state/youtube_comment_agents.json').trim();
const BLOB_ACCESS = String(process.env.YOUTUBE_COMMENT_AGENTS_BLOB_ACCESS || 'public').trim().toLowerCase() === 'private'
  ? 'private'
  : 'public';

function ensureFile() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ agents: [] }, null, 2), { mode: 0o600 });
    fs.chmodSync(STORE_FILE, 0o600);
  }
}

async function loadBlobSdk() {
  try {
    return require('@vercel/blob');
  } catch (_) {
    return null;
  }
}

async function readBlobStore() {
  const sdk = await loadBlobSdk();
  if (!sdk || !isBlobConfigured()) return null;
  try {
    if (typeof sdk.get !== 'function') return null;
    const blob = await sdk.get(BLOB_PATHNAME, {
      access: BLOB_ACCESS,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    if (!blob) return { agents: [] };
    const raw = typeof blob.text === 'function'
      ? await blob.text()
      : '';
    const parsed = raw ? JSON.parse(raw) : { agents: [] };
    if (!parsed || typeof parsed !== 'object') return { agents: [] };
    if (!Array.isArray(parsed.agents)) parsed.agents = [];
    return parsed;
  } catch (err) {
    const message = String(err?.message || '').toLowerCase();
    if (message.includes('not found') || message.includes('404')) return { agents: [] };
    throw err;
  }
}

async function writeBlobStore(store) {
  const sdk = await loadBlobSdk();
  if (!sdk || !isBlobConfigured()) return false;
  if (typeof sdk.put !== 'function') return false;
  await sdk.put(BLOB_PATHNAME, JSON.stringify(store, null, 2), {
    access: BLOB_ACCESS,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
  return true;
}

async function readFileStore() {
  try {
    ensureFile();
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { agents: [] };
    if (!Array.isArray(parsed.agents)) parsed.agents = [];
    return parsed;
  } catch {
    return { agents: [] };
  }
}

async function writeFileStore(store) {
  ensureFile();
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STORE_FILE);
  fs.chmodSync(STORE_FILE, 0o600);
}

async function readStore() {
  if (isBlobConfigured()) {
    const blobStore = await readBlobStore();
    if (blobStore) return blobStore;
  }
  return readFileStore();
}

async function writeStore(store) {
  if (isBlobConfigured()) {
    const written = await writeBlobStore(store);
    if (written) return;
  }
  await writeFileStore(store);
}

function safeText(value) {
  return String(value || '').trim();
}

function sanitize(agent) {
  if (!agent || typeof agent !== 'object') return null;
  return {
    id: safeText(agent.id),
    channel: 'youtube_comments',
    videoUrl: safeText(agent.videoUrl),
    fromDate: safeText(agent.fromDate),
    toDate: safeText(agent.toDate),
    frequency: Number(agent.frequency || 1) || 1,
    timeframe: safeText(agent.timeframe) || 'month',
    maxPosts: Number(agent.maxPosts || 1) || 1,
    videoCommentRatio: safeText(agent.videoCommentRatio) || '100/0',
    jitterHours: Number(agent.jitterHours || 10) || 10,
    scheduleEnabled: agent.scheduleEnabled === true,
    scheduleStatus: safeText(agent.scheduleStatus) || 'disabled',
    scheduleNote: safeText(agent.scheduleNote) || 'Scheduling is configured but disabled.',
    createdAt: safeText(agent.createdAt),
    updatedAt: safeText(agent.updatedAt),
    nextRunAt: safeText(agent.nextRunAt),
    lastRunAttemptedAt: safeText(agent.lastRunAttemptedAt),
    lastPostedAt: safeText(agent.lastPostedAt),
    lastPostedCommentId: safeText(agent.lastPostedCommentId),
    lastPostedThreadId: safeText(agent.lastPostedThreadId),
    totalPostsCount: Math.max(0, Number(agent.totalPostsCount || 0) || 0),
    lastError: safeText(agent.lastError),
    lastTestPostedAt: safeText(agent.lastTestPostedAt),
    lastTestCommentId: safeText(agent.lastTestCommentId),
    lastTestThreadId: safeText(agent.lastTestThreadId),
    lastTestCommentText: safeText(agent.lastTestCommentText),
  };
}

async function listAgents() {
  const store = await readStore();
  return store.agents.map(sanitize).filter(Boolean).sort((a, b) => {
    return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
  });
}

async function createAgent(input) {
  const now = new Date().toISOString();
  const store = await readStore();
  const agent = {
    id: nextId('ytagent'),
    channel: 'youtube_comments',
    videoUrl: safeText(input.videoUrl),
    fromDate: safeText(input.fromDate),
    toDate: safeText(input.toDate),
    frequency: Number(input.frequency || 1) || 1,
    timeframe: safeText(input.timeframe) || 'month',
    maxPosts: Number(input.maxPosts || 1) || 1,
    videoCommentRatio: safeText(input.videoCommentRatio) || '100/0',
    jitterHours: Number(input.jitterHours || 10) || 10,
    scheduleEnabled: input.scheduleEnabled === true,
    scheduleStatus: safeText(input.scheduleStatus) || 'disabled',
    scheduleNote: safeText(input.scheduleNote) || 'Scheduling is configured but disabled.',
    createdAt: now,
    updatedAt: now,
    nextRunAt: safeText(input.nextRunAt),
    lastRunAttemptedAt: '',
    lastPostedAt: '',
    lastPostedCommentId: '',
    lastPostedThreadId: '',
    totalPostsCount: Math.max(0, Number(input.totalPostsCount || 0) || 0),
    lastError: '',
    lastTestPostedAt: '',
    lastTestCommentId: '',
    lastTestThreadId: '',
    lastTestCommentText: '',
  };
  store.agents.unshift(agent);
  await writeStore(store);
  return sanitize(agent);
}

async function updateAgent(id, patch) {
  const agentId = safeText(id);
  if (!agentId) return null;
  const store = await readStore();
  const idx = store.agents.findIndex((item) => safeText(item.id) === agentId);
  if (idx < 0) return null;
  const current = store.agents[idx];
  const next = {
    ...current,
    ...patch,
    id: current.id,
    channel: 'youtube_comments',
    updatedAt: new Date().toISOString(),
  };
  store.agents[idx] = next;
  await writeStore(store);
  return sanitize(next);
}

async function getAgent(id) {
  const items = await listAgents();
  return items.find((agent) => safeText(agent.id) === safeText(id)) || null;
}

module.exports = {
  listAgents,
  createAgent,
  updateAgent,
  getAgent,
};
