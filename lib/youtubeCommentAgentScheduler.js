'use strict';

function safeText(value) {
  return String(value || '').trim();
}

const TIMEFRAME_MS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

function clampInteger(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function parseStartMs(dateText) {
  const text = safeText(dateText);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return NaN;
  return Date.parse(`${text}T00:00:00.000Z`);
}

function parseEndMs(dateText) {
  const text = safeText(dateText);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return NaN;
  return Date.parse(`${text}T23:59:59.999Z`);
}

function timeframeIntervalMs(agent) {
  const timeframe = safeText(agent?.timeframe).toLowerCase() || 'month';
  const unitMs = TIMEFRAME_MS[timeframe] || TIMEFRAME_MS.month;
  const frequency = clampInteger(agent?.frequency, 1, 60, 1);
  return Math.max(1000, Math.floor(unitMs / frequency));
}

function hashSeed(input) {
  const text = safeText(input);
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function jitterMsForSlot(agent, intervalMs, slotIndex) {
  const requested = Math.max(0, Number(agent?.jitterHours || 10) || 0) * 60 * 60 * 1000;
  if (!requested || intervalMs <= (60 * 60 * 1000)) return 0;
  const bounded = Math.min(requested, Math.floor(intervalMs * 0.35));
  if (!bounded) return 0;
  const hash = hashSeed(`${safeText(agent?.id)}:${slotIndex}`);
  const ratio = (hash % 10000) / 9999;
  return Math.round((ratio * 2 * bounded) - bounded);
}

function scheduleWindow(agent) {
  const createdMs = Date.parse(safeText(agent?.createdAt) || 0);
  const startMsRaw = parseStartMs(agent?.fromDate);
  const endMsRaw = parseEndMs(agent?.toDate);
  const startMs = Number.isFinite(startMsRaw)
    ? Math.max(startMsRaw, Number.isFinite(createdMs) ? createdMs : startMsRaw)
    : (Number.isFinite(createdMs) ? createdMs : Date.now());
  const endMs = Number.isFinite(endMsRaw) ? endMsRaw : Number.POSITIVE_INFINITY;
  return { startMs, endMs };
}

function slotScheduledMs(agent, slotIndex) {
  const { startMs, endMs } = scheduleWindow(agent);
  const intervalMs = timeframeIntervalMs(agent);
  const nominalMs = startMs + (Math.max(0, slotIndex) * intervalMs);
  const jitterMs = jitterMsForSlot(agent, intervalMs, slotIndex);
  const scheduledMs = Math.max(startMs, nominalMs + jitterMs);
  if (scheduledMs > endMs) return NaN;
  return scheduledMs;
}

function totalPostsLimit(agent) {
  return clampInteger(agent?.maxPosts, 1, 20, 1);
}

function computeNextRunAt(agent) {
  const totalPostsCount = Math.max(0, Number(agent?.totalPostsCount || 0) || 0);
  const maxPosts = totalPostsLimit(agent);
  if (totalPostsCount >= maxPosts) return '';
  const nextMs = slotScheduledMs(agent, totalPostsCount);
  if (!Number.isFinite(nextMs)) return '';
  return new Date(nextMs).toISOString();
}

function scheduleStatus(agent, nowIso = new Date().toISOString()) {
  const nowMs = Date.parse(nowIso);
  const totalPostsCount = Math.max(0, Number(agent?.totalPostsCount || 0) || 0);
  const maxPosts = totalPostsLimit(agent);
  const { startMs, endMs } = scheduleWindow(agent);
  const nextRunAt = safeText(agent?.nextRunAt) || computeNextRunAt(agent);
  const nextMs = Date.parse(nextRunAt || 0);

  if (agent?.scheduleEnabled !== true) return 'disabled';
  if (totalPostsCount >= maxPosts) return 'completed';
  if (Number.isFinite(endMs) && nowMs > endMs && (!Number.isFinite(nextMs) || nextMs > endMs)) return 'completed';
  if (safeText(agent?.lastError)) return 'error';
  if (Number.isFinite(startMs) && nowMs < startMs) return 'scheduled';
  if (Number.isFinite(nextMs) && nextMs <= nowMs) return 'due';
  return 'scheduled';
}

function isDue(agent, nowIso = new Date().toISOString()) {
  return scheduleStatus(agent, nowIso) === 'due';
}

module.exports = {
  TIMEFRAME_MS,
  computeNextRunAt,
  scheduleStatus,
  isDue,
  totalPostsLimit,
};
