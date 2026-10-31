'use strict';

/**
 * The AI spending alarm's routes (AI Quota 4/5, task 86bcvj7zm). Logic lives in
 * lib/aiSpendAlarm.js; the row in lib/aiSpendAlarmStore.js.
 *
 *   GET  /api/ai-quota/alarm   the settings and the last check (platform owner)
 *   PUT  /api/ai-quota/alarm   save the daily limit, spike multiple, email (platform owner)
 *   GET  /api/ai-quota/check   the scheduled check — CRON ONLY
 *   GET  /api/ai-quota/mini-limit  today's use of the Mini's background-AI limit
 *                              (AI Quota 5/5, lib/miniAiLimit.js) — any signed-in
 *                              user, because the Outreach screen shows it
 *
 * Owner-only because the alarm guards the whole account's bill, the same rule
 * `/api/observe/ai-billed` keeps.
 */

const { sendOk, sendErr, parseJsonBody } = require('./http');

const PREFIX = '/api/ai-quota';
const manifest = { id: 'aiQuota', label: 'AI Quota alarm', prefixes: [PREFIX] };

function isOwner(req) {
  return String(req?.authUser?.role || '').trim().toLowerCase() === 'owner';
}

function checkDeps() {
  const store = require('../lib/aiSpendAlarmStore');
  return {
    readAlarm: store.readAlarm,
    writeCheck: store.writeCheck,
    readBill: (opts) => require('../lib/anthropicBilling').getAnthropicBilling(opts),
    readMeter: (since) => require('../lib/observeStore').getMeteredSpendByDay(since),
    postBus: (text) => require('../lib/clickupForward').postBusMessage(text),
    sendEmail: (msg) => require('../lib/mailer').sendEmail(msg),
  };
}

async function handle(req, res, pathname, method) {
  if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) return false;

  if (pathname === `${PREFIX}/check`) {
    if (method !== 'GET' && method !== 'POST') return sendErr(res, 405, 'Method not allowed'), true;
    // `req.cronPublish` is set in routes/index.js only for a CRON_PATHS path
    // carrying Vercel's cron header or the CRON_SECRET bearer token.
    if (!req.cronPublish) {
      return sendErr(res, 403, 'The AI spending check runs on a schedule only', { code: 'CRON_ONLY' }), true;
    }
    const { runSpendCheck, formatCheckLog } = require('../lib/aiSpendAlarm');
    const result = await runSpendCheck(checkDeps());
    if (!result.ok) {
      console.error(`[ai-spend-check] REFUSED: ${result.error}`);
      return sendErr(res, result.status || 500, result.error, { code: 'ALARM_UNREADABLE' }), true;
    }
    const line = formatCheckLog(result.data);
    if (/UNREADABLE|NOT RECORDED|NOT DELIVERED|:post/.test(line)) console.error(line);
    else console.log(line);
    return sendOk(res, 200, result.data), true;
  }

  if (pathname === `${PREFIX}/mini-limit`) {
    if (method !== 'GET') return sendErr(res, 405, 'Method not allowed'), true;
    if (!req.authUser) return sendErr(res, 401, 'Sign in to read the Mini\'s AI limit'), true;
    const read = await require('../lib/miniAiLimit').readLimitStatus();
    // "Could not tell" is an answer the screen shows, never an empty one.
    if (!read.ok) return sendOk(res, 200, { status: 'error', message: read.error }), true;
    return sendOk(res, 200, { status: 'ok', ...read.data }), true;
  }

  if (pathname === `${PREFIX}/alarm`) {
    if (!isOwner(req)) return sendOk(res, 200, { status: 'owner-only' }), true;
    const store = require('../lib/aiSpendAlarmStore');
    if (method === 'GET') {
      const alarm = await store.readAlarm();
      if (!alarm.ok) return sendOk(res, 200, { status: 'error', message: alarm.error }), true;
      return sendOk(res, 200, { status: 'ok', ...alarm.data, defaultEmail: String(req.authUser?.email || '') }), true;
    }
    if (method === 'PUT') {
      const body = await parseJsonBody(req);
      // A blank address means "email me" — the owner saving the form.
      const input = store.validateSettingsInput({ ...body, alertEmail: String(body?.alertEmail ?? '').trim() || String(req.authUser?.email || '') });
      if (!input.ok) return sendErr(res, 400, input.error, { code: 'INVALID_ALARM_SETTINGS' }), true;
      const saved = await store.saveSettings(input.data, {
        projectId: req?.projectContext?.project?.id,
        userId: req?.authUser?.id,
      });
      if (!saved.ok) return sendErr(res, saved.status || 500, saved.error), true;
      return sendOk(res, 200, { status: 'ok', ...saved.data, defaultEmail: String(req.authUser?.email || '') }), true;
    }
    return sendErr(res, 405, 'Method not allowed'), true;
  }

  return sendErr(res, 404, 'AI Quota endpoint not found', { code: 'NOT_FOUND' }), true;
}

module.exports = { handle, manifest };
