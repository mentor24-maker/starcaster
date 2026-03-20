'use strict';

const fs = require('fs');
const path = require('path');
const { nextId } = require('../routes/http');

const STORE_FILE = path.join(__dirname, '..', 'data', 'youtube_comment_agents.json');

function ensureFile() {
  const dir = path.dirname(STORE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify({ agents: [] }, null, 2), { mode: 0o600 });
    fs.chmodSync(STORE_FILE, 0o600);
  }
}

function readStore() {
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

function writeStore(store) {
  ensureFile();
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STORE_FILE);
  fs.chmodSync(STORE_FILE, 0o600);
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

function listAgents() {
  return readStore().agents.map(sanitize).filter(Boolean).sort((a, b) => {
    return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
  });
}

function createAgent(input) {
  const now = new Date().toISOString();
  const store = readStore();
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
  writeStore(store);
  return sanitize(agent);
}

function updateAgent(id, patch) {
  const agentId = safeText(id);
  if (!agentId) return null;
  const store = readStore();
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
  writeStore(store);
  return sanitize(next);
}

function getAgent(id) {
  return listAgents().find((agent) => safeText(agent.id) === safeText(id)) || null;
}

module.exports = {
  listAgents,
  createAgent,
  updateAgent,
  getAgent,
};
