'use strict';

/**
 * Everything that uses AI — the list on Settings › AI Quota.
 *
 * On Oct 28-30, 2026 the Mac Mini's AI browser (OpenClaw) spent about $35 on
 * the mentor24 Anthropic account overnight, and nothing in Starcaster showed
 * it: the spend panel only sees calls the website makes. A spend total is only
 * honest next to a list of what it does NOT count, so every job that calls a
 * model is listed here with whether Starcaster's meter can see it.
 *
 * Two halves, and they come from different places on purpose:
 *
 *  - **Website features** come from the metering rows (lib/aiUsage.js →
 *    observe_usage_logs). `npm run check:ai-metering` already fails the build
 *    when a website model call has no meter, so the rows ARE the list — a
 *    hand-kept copy here would only be a second list to drift.
 *  - **Jobs on the Mini** are written down below, because no row is ever
 *    written for them. Their schedules and model are checked against the
 *    install scripts that set them (scripts/builder/aiJobs.test.js), so this
 *    file cannot quietly disagree with what the Mini actually runs.
 *
 * Since AI Quota 3/5 (86bcvj7vc) every OpenClaw request writes a meter row
 * naming its job by the `user` label it sent (lib/openclawResponsesClient.js).
 * Each Mini job lists the labels it sends in `labels`, and the rows are matched
 * to it here; a label nobody listed still appears, under its own name, so a
 * new OpenClaw caller can never spend off the page. A job that runs no paid
 * model says so rather than being left off, so its absence is explained.
 */

/** OpenClaw's model, as scripts/install_openclaw.sh configures it on the Mini. */
const OPENCLAW_MODEL = 'claude-sonnet-5-5';

const NOT_METERED = 'not metered yet';
const METERED = 'metered';

/**
 * Jobs that call a model from the Mini. `everyHours` is the schedule where one
 * exists; `cadence` is what the page shows.
 */
const MINI_JOBS = [
  {
    id: 'openclaw-sign-in-check',
    name: 'Sign-in check (YouTube, Substack, Reddit)',
    machine: 'Mac Mini',
    runner: 'OpenClaw browser',
    everyHours: 6,
    cadence: 'every 6 hours, per site — and when "Check now" is pressed',
    model: OPENCLAW_MODEL,
    labels: ['starcaster:openclaw-smoke'],
    metered: true,
    meterNote: METERED,
  },
  {
    id: 'reddit-watch',
    name: 'Reddit watch — finds fresh posts on chosen subreddits',
    machine: 'Mac Mini',
    runner: 'OpenClaw browser',
    everyHours: 4,
    cadence: 'every 4 hours',
    model: OPENCLAW_MODEL,
    labels: ['starcaster:reddit-watch'],
    metered: true,
    meterNote: METERED,
  },
  {
    id: 'substack-notes-search',
    name: 'Substack Notes search',
    machine: 'Mac Mini',
    runner: 'OpenClaw browser',
    everyHours: 6,
    cadence: 'every 6 hours',
    model: OPENCLAW_MODEL,
    labels: ['starcaster:substack-miner-notes-search'],
    metered: true,
    meterNote: METERED,
  },
  {
    id: 'outreach-posting',
    name: 'Posting approved replies (YouTube, Substack, Reddit) and reading Reddit threads',
    machine: 'Mac Mini',
    runner: 'OpenClaw browser',
    everyHours: null,
    cadence: 'checks every 2 minutes; uses AI only when there is an approved reply to post',
    model: OPENCLAW_MODEL,
    labels: [
      'starcaster:youtube-outreach-poster',
      'starcaster:substack-notes-poster',
      'starcaster:reddit-comments-poster',
      'starcaster:reddit-post-reader',
    ],
    metered: true,
    meterNote: METERED,
  },
  {
    id: 'facebook-personal-posting',
    name: 'Facebook personal-profile posting',
    machine: 'Mac Mini',
    runner: 'OpenClaw browser',
    everyHours: null,
    cadence: 'when a post is published to a Facebook Personal channel',
    model: OPENCLAW_MODEL,
    labels: ['starcaster:facebook_personal'],
    metered: true,
    meterNote: METERED,
  },
  {
    id: 'studio-transcribe',
    name: 'Studio worker — transcribes footage',
    machine: 'Mac Mini',
    runner: 'whisper.cpp, on the Mini itself',
    everyHours: null,
    cadence: 'when new footage arrives',
    model: 'whisper large-v3-turbo (local)',
    labels: [],
    metered: false,
    meterNote: 'runs on the Mini — no AI bill',
  },
];

/**
 * The website's half, from the spend summary's by-feature rows.
 *
 * @param {Array<{feature: string, calls: number, models: Record<string, number>}>} byFeature
 */
function websiteJobs(byFeature) {
  return (Array.isArray(byFeature) ? byFeature : []).map((row) => ({
    id: `website:${row.feature}`,
    name: String(row.feature || 'unattributed'),
    machine: 'Website (Vercel)',
    runner: 'Starcaster',
    everyHours: null,
    cadence: `${Number(row.calls) || 0} call${Number(row.calls) === 1 ? '' : 's'} in the last 30 days`,
    model: Object.keys(row.models || {}).join(', ') || 'unknown',
    metered: true,
    meterNote: 'metered',
  }));
}

function emptyWindow() {
  return { calls: 0, costUsd: 0, unpricedCalls: 0 };
}

/** Add one job's meter rows (the summary's byJob entries) into a usage tally. */
function addUsage(into, row) {
  into.calls += Number(row.calls) || 0;
  into.failedCalls += Number(row.failedCalls) || 0;
  into.unpricedCalls += Number(row.unpricedCalls) || 0;
  into.costUsd += Number(row.costUsd) || 0;
  for (const name of ['last24h', 'last7d']) {
    const w = row[name] || {};
    into[name].calls += Number(w.calls) || 0;
    into[name].costUsd += Number(w.costUsd) || 0;
    into[name].unpricedCalls += Number(w.unpricedCalls) || 0;
  }
  return into;
}

function emptyUsage() {
  return { calls: 0, failedCalls: 0, unpricedCalls: 0, costUsd: 0, last24h: emptyWindow(), last7d: emptyWindow() };
}

/**
 * The Mini's half, with each OpenClaw job's calls from the meter rows. A
 * metered job with no rows gets zeros — it really made no calls in the window.
 *
 * @param {Array<{job: string}>} byJob The spend summary's byJob rows
 */
function miniJobs(byJob) {
  const rows = Array.isArray(byJob) ? byJob : [];
  const owner = new Map();
  for (const job of MINI_JOBS) for (const label of job.labels) owner.set(label, job.id);

  const usage = new Map(MINI_JOBS.filter((job) => job.metered).map((job) => [job.id, emptyUsage()]));
  const strays = [];
  for (const row of rows) {
    const id = owner.get(String(row.job || ''));
    if (id) addUsage(usage.get(id), row);
    else strays.push(row);
  }

  const listed = MINI_JOBS.map((job) => ({ ...job, usage: usage.get(job.id) || null }));
  // A label no job lists: still on the page, under its own name.
  const unlisted = strays.map((row) => ({
    id: `openclaw:${row.job}`,
    name: `OpenClaw request labelled “${row.job}”`,
    machine: 'Wherever OpenClaw answered it',
    runner: 'OpenClaw',
    everyHours: null,
    cadence: `${Number(row.calls) || 0} call${Number(row.calls) === 1 ? '' : 's'} in the last 30 days`,
    model: OPENCLAW_MODEL,
    labels: [String(row.job || '')],
    metered: true,
    meterNote: METERED,
    usage: addUsage(emptyUsage(), row),
  }));
  return [...listed, ...unlisted];
}

/** Every job, website first. */
function listAiJobs(byFeature, byJob) {
  return [...websiteJobs(byFeature), ...miniJobs(byJob)];
}

module.exports = { listAiJobs, websiteJobs, miniJobs, MINI_JOBS, OPENCLAW_MODEL, NOT_METERED, METERED };
