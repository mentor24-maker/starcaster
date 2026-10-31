'use strict';

/**
 * The AI spending alarm (AI Quota 4/5, task 86bcvj7zm).
 *
 * On Oct 28-30, 2026 the Anthropic account drained two nights running and the
 * first sign anyone had was an empty balance. This is the check that would have
 * said so on the first evening. It runs every hour on Vercel's scheduler
 * (`/api/ai-quota/check`, vercel.json) and asks two questions of TODAY's spend
 * (UTC day, the same day Anthropic's bill uses):
 *
 *  - over-limit: has it passed Dane's daily limit (default $5)?
 *  - spike:      is it more than his multiple (default 3x) of the 7-day daily
 *                average? Not judged when the last 7 days averaged $0 — any
 *                spend at all would be "infinitely" above that, and the limit
 *                already covers it.
 *
 * Which spend: Anthropic's own bill when ANTHROPIC_ADMIN_KEY is set (AI Quota
 * 2/5) — it sees the Mini's calls, which Starcaster's meter does not — and
 * Starcaster's estimate otherwise. Every message says which one it used.
 *
 * Discipline, the same as every other alarm here:
 *  - each kind of alert goes out at most once per 6 hours;
 *  - it clears on the first check that finds it quiet, and says so once;
 *  - "could not read the spend" is its own alert, never silence — and a
 *    reading that failed never clears an over-limit or spike alert, because
 *    not knowing is not the same as quiet.
 *
 * The decisions are pure functions (tested in scripts/builder/aiSpendAlarm.test.js);
 * `runSpendCheck` is the only part that touches the network, and takes every
 * dependency as an argument.
 */

const REPEAT_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BASELINE_DAYS = 7;
const KINDS = Object.freeze(['over-limit', 'spike', 'unreadable']);
const PAGE_URL = 'https://app.starcaster.pro/#page=settingsAiQuotaPage';
const SIGNATURE = '[Starcaster AI spend alarm]';

function money(value) {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The previous `BASELINE_DAYS` UTC days, newest first, not counting today. */
function baselineDays(now) {
  const today = Date.parse(`${utcDay(now)}T00:00:00.000Z`);
  return Array.from({ length: BASELINE_DAYS }, (_, i) => utcDay(today - (i + 1) * DAY_MS));
}

/**
 * Today's spend and the 7-day average out of Anthropic's bill
 * (lib/anthropicBilling.js getAnthropicBilling data, status 'ok').
 * A day with no bucket counts as $0 — the report was read and held nothing.
 */
function readingFromBill(bill, now) {
  const byDay = Object.fromEntries((bill.byDay || []).map((d) => [d.day, Number(d.costUsd) || 0]));
  const past = baselineDays(now).map((day) => byDay[day] || 0);
  const today = bill.today || { costUsd: byDay[utcDay(now)] || 0, byModel: [], byKey: null };
  return {
    source: 'bill',
    day: utcDay(now),
    todayUsd: Number(today.costUsd) || 0,
    averageUsd: past.reduce((a, b) => a + b, 0) / BASELINE_DAYS,
    topSpender: topSpenderFromBill(today),
    caveats: [],
  };
}

/**
 * Who spent most of today's bill. The per-key split names the machine ("the
 * key Mac Mini OpenClaw") when the usage report came back; otherwise the model.
 * The per-key dollars are list-price estimates, so they only pick the name.
 */
function topSpenderFromBill(today) {
  const keys = Array.isArray(today.byKey) ? today.byKey.filter((k) => k.estimatedUsd > 0 || k.tokens > 0) : [];
  if (keys.length) {
    const top = keys[0];
    const label = top.apiKeyId ? `the API key “${top.name || top.apiKeyId}”` : 'calls made without an API key (Console / Workbench)';
    return { label, usd: null };
  }
  const models = Array.isArray(today.byModel) ? today.byModel.filter((m) => m.costUsd > 0) : [];
  if (models.length) return { label: models[0].model, usd: models[0].costUsd };
  return null;
}

/**
 * Today's spend and the 7-day average out of Starcaster's own meter
 * (lib/observeStore.js getMeteredSpendByDay). The meter only sees calls the
 * website makes, so the reading says so — and says how many calls had no price.
 */
function readingFromMeter(meter, now) {
  const days = meter.byDay || {};
  const todayRow = days[utcDay(now)] || { costUsd: 0, calls: 0, unpricedCalls: 0, byFeature: {} };
  const past = baselineDays(now).map((day) => Number(days[day]?.costUsd) || 0);
  const features = Object.entries(todayRow.byFeature || {}).filter(([, usd]) => usd > 0).sort((a, b) => b[1] - a[1]);
  const caveats = ['Starcaster’s meter does not see the Mac Mini’s AI calls, so the real figure may be higher.'];
  if (todayRow.unpricedCalls) caveats.push(`${todayRow.unpricedCalls} of today’s calls have no price and are not in that figure.`);
  if (meter.truncated) caveats.push('The meter held more calls than one read can take, so the figure is a floor.');
  return {
    source: 'meter',
    day: utcDay(now),
    todayUsd: Number(todayRow.costUsd) || 0,
    averageUsd: past.reduce((a, b) => a + b, 0) / BASELINE_DAYS,
    topSpender: features.length ? { label: `the “${features[0][0]}” feature`, usd: features[0][1] } : null,
    caveats,
  };
}

/** Which alerts are active right now. `reading` null means it could not be read. */
function judge({ settings, reading, unreadableWhy = '' }) {
  if (!reading) {
    return { readable: false, active: { unreadable: true }, why: unreadableWhy || 'the spend could not be read' };
  }
  const overLimit = reading.todayUsd > settings.dailyLimitUsd;
  const spikeJudged = reading.averageUsd > 0;
  const ratio = spikeJudged ? reading.todayUsd / reading.averageUsd : null;
  const spike = spikeJudged && ratio > settings.spikeMultiple;
  return {
    readable: true,
    active: { 'over-limit': overLimit, spike, unreadable: false },
    ratio,
    spikeJudged,
  };
}

/**
 * What to do about each kind, given when it last went out.
 * Returns `{ [kind]: 'post' | 'clear' | 'hold' | 'none' }`:
 *  post  — active and not sent in the last 6 hours (or never);
 *  hold  — active, already sent within 6 hours;
 *  clear — quiet now, and an alert had gone out;
 *  none  — quiet, nothing open.
 * When the reading failed, over-limit and spike are left exactly as they were.
 */
function plan({ judged, stamps = {}, now }) {
  const actions = {};
  for (const kind of KINDS) {
    const stamp = stamps[kind] ? Date.parse(stamps[kind]) : NaN;
    const open = Number.isFinite(stamp);
    if (!judged.readable && kind !== 'unreadable') {
      actions[kind] = open ? 'hold' : 'none';
      continue;
    }
    if (judged.active[kind]) actions[kind] = open && now - stamp < REPEAT_MS ? 'hold' : 'post';
    else actions[kind] = open ? 'clear' : 'none';
  }
  return actions;
}

function sourceLine(reading) {
  const used = reading.source === 'bill' ? 'Anthropic’s bill' : 'Starcaster’s estimate (Anthropic’s bill is not connected)';
  return `Read from ${used}.${reading.fallbackWhy ? ` ${reading.fallbackWhy}` : ''}`;
}

function spenderClause(reading) {
  const top = reading.topSpender;
  if (!top) return '';
  return `; most of it is ${top.label}${top.usd !== null && top.usd !== undefined ? ` (${money(top.usd)})` : ''}`;
}

/** The alert itself: one line a non-programmer can act on, then the details. */
function renderAlert(kind, { settings, reading, judged }) {
  let headline;
  if (kind === 'unreadable') {
    headline = `The AI spending alarm could not read today’s spend: ${judged.why}. Until this clears, a runaway job would go unnoticed.`;
  } else if (kind === 'over-limit') {
    headline = `AI spend today is ${money(reading.todayUsd)}, over your ${money(settings.dailyLimitUsd)} limit${spenderClause(reading)}.`;
  } else {
    headline = `AI spend today is ${money(reading.todayUsd)}, ${judged.ratio.toFixed(1)}× the 7-day average of ${money(reading.averageUsd)} a day (you are alerted above ${settings.spikeMultiple}×)${spenderClause(reading)}.`;
  }
  const lines = [`⚠️ ${headline}`];
  if (reading) {
    lines.push(sourceLine(reading));
    lines.push(...reading.caveats);
  }
  lines.push(`Settings › AI Quota: ${PAGE_URL}`);
  lines.push(`Repeats at most every 6 hours while it lasts. ${SIGNATURE}`);
  return lines.join('\n');
}

function renderClear(kind, { settings, reading }) {
  const today = reading ? ` Today so far: ${money(reading.todayUsd)}.` : '';
  const what = {
    'over-limit': `AI spend is back under your ${money(settings.dailyLimitUsd)} daily limit.`,
    spike: 'AI spend is back to a normal level for the last 7 days.',
    unreadable: 'The AI spending alarm can read the spend again.',
  }[kind];
  return `✅ ${what}${today} ${SIGNATURE}`;
}

function emailSubject(kind, { settings, reading }) {
  if (kind === 'unreadable') return 'AI spend alarm: could not read today’s spend';
  if (kind === 'over-limit') return `AI spend alert: ${money(reading.todayUsd)} today, over your ${money(settings.dailyLimitUsd)} limit`;
  return `AI spend alert: ${money(reading.todayUsd)} today, far above normal`;
}

function alertEmailAddress(settings, env = process.env) {
  return settings.alertEmail
    || String(env.AI_SPEND_ALERT_EMAIL || '').trim()
    || String(env.SUPPORT_ALERT_EMAIL || '').trim();
}

/**
 * Read the spend: the bill when it is connected and answers, the meter
 * otherwise. Returns `{ reading }` or `{ reading: null, why }`.
 */
async function readSpend({ now, readBill, readMeter }) {
  let fallbackWhy = '';
  const bill = await readBill({ days: BASELINE_DAYS + 1, now });
  if (bill.ok && bill.data?.status === 'ok') return { reading: readingFromBill(bill.data, now) };
  if (!bill.ok) fallbackWhy = `Anthropic’s bill could not be read (${bill.error}), so this used Starcaster’s estimate.`;

  const since = new Date(Date.parse(`${baselineDays(now)[BASELINE_DAYS - 1]}T00:00:00.000Z`)).toISOString();
  const meter = await readMeter(since);
  if (!meter.ok) {
    const why = [bill.ok ? '' : `Anthropic’s bill: ${bill.error}`, `Starcaster’s meter: ${meter.error}`].filter(Boolean).join('; ');
    return { reading: null, why };
  }
  const reading = readingFromMeter(meter.data, now);
  if (fallbackWhy) {
    reading.fallbackWhy = fallbackWhy;
  }
  return { reading };
}

/**
 * One scheduled run. Every dependency is injected:
 *   readAlarm, writeCheck   — lib/aiSpendAlarmStore.js
 *   readBill                — lib/anthropicBilling.js getAnthropicBilling
 *   readMeter               — lib/observeStore.js getMeteredSpendByDay
 *   postBus                 — lib/clickupForward.js postBusMessage
 *   sendEmail               — lib/mailer.js sendEmail
 *
 * A stamp moves only when the alert was DELIVERED somewhere (bus or email) —
 * an alert recorded as sent that nobody received would silence its own repeat.
 */
async function runSpendCheck(deps) {
  const now = Number(deps.now) || Date.now();
  const at = new Date(now).toISOString();
  const alarm = await deps.readAlarm();
  // Without its row the alarm has no memory, so it cannot keep to once per
  // 6 hours. It refuses loudly in the log (and the page says so) rather than
  // posting every hour; `npm run sql:unapplied` reports the missing table.
  if (!alarm.ok) return { ok: false, status: alarm.status || 500, error: alarm.error };
  const settings = alarm.data;

  const { reading, why } = await readSpend({ now, readBill: deps.readBill, readMeter: deps.readMeter });
  const judged = judge({ settings, reading, unreadableWhy: why });
  const actions = plan({ judged, stamps: settings.stamps, now });
  const context = { settings, reading, judged };
  const to = alertEmailAddress(settings, deps.env || process.env);

  const stamps = {};
  const delivered = {};
  for (const kind of KINDS) {
    const action = actions[kind];
    if (action === 'post') {
      const text = renderAlert(kind, context);
      const bus = await deps.postBus(text);
      const mail = to
        ? await deps.sendEmail({ to, subject: emailSubject(kind, context), text })
        : { ok: false, error: 'no address — set one on Settings › AI Quota' };
      delivered[kind] = { bus: bus.ok ? 'sent' : `FAILED: ${bus.why}`, email: mail.ok ? `sent to ${to}` : `FAILED: ${mail.error}` };
      if (bus.ok || mail.ok) stamps[kind] = at;
    } else if (action === 'clear') {
      const bus = await deps.postBus(renderClear(kind, context));
      delivered[kind] = { bus: bus.ok ? 'sent' : `FAILED: ${bus.why}` };
      // Cleared even if the "all clear" did not land: the alert is over either
      // way, and holding the stamp would mute the next real alert for 6 hours.
      stamps[kind] = null;
    }
  }

  const lastCheck = {
    at,
    source: reading ? reading.source : null,
    fallbackWhy: reading?.fallbackWhy || '',
    day: reading ? reading.day : utcDay(now),
    todayUsd: reading ? reading.todayUsd : null,
    averageUsd: reading ? reading.averageUsd : null,
    topSpender: reading?.topSpender?.label || '',
    // The limits THIS check judged against — the page must not quote a limit
    // saved after the check ran as the one it broke.
    dailyLimitUsd: settings.dailyLimitUsd,
    spikeMultiple: settings.spikeMultiple,
    unreadableWhy: reading ? '' : judged.why,
    active: judged.active,
    actions,
    delivered,
  };
  const written = await deps.writeCheck({ stamps, lastCheck, at });
  return {
    ok: true,
    status: 200,
    data: { ...lastCheck, recorded: written.ok, recordError: written.ok ? '' : written.error },
  };
}

/** One log line per run, the quiet ones too: "quiet" and "never ran" must not look alike. */
function formatCheckLog(data) {
  const spend = data.todayUsd === null ? 'spend UNREADABLE' : `today ${money(data.todayUsd)} (${data.source}), 7-day average ${money(data.averageUsd)}`;
  const acts = Object.entries(data.actions || {}).filter(([, a]) => a !== 'none').map(([k, a]) => `${k}:${a}`).join(' ') || 'quiet';
  const undelivered = Object.entries(data.delivered || {})
    .flatMap(([kind, ways]) => Object.entries(ways).filter(([, v]) => String(v).startsWith('FAILED')).map(([way, v]) => `${kind} ${way} ${v}`));
  const tail = (undelivered.length ? ` — NOT DELIVERED: ${undelivered.join('; ')}` : '')
    + (data.recorded === false ? ` — STATE NOT RECORDED: ${data.recordError}` : '');
  return `[ai-spend-check] ${spend} — ${acts}${tail}`;
}

module.exports = {
  REPEAT_MS,
  BASELINE_DAYS,
  KINDS,
  baselineDays,
  readingFromBill,
  readingFromMeter,
  topSpenderFromBill,
  judge,
  plan,
  renderAlert,
  renderClear,
  emailSubject,
  alertEmailAddress,
  readSpend,
  runSpendCheck,
  formatCheckLog,
};
