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
 * `metered: false` rows say "not metered yet" until AI Quota 3/5 (86bcvj7vc)
 * counts OpenClaw requests. A job that runs no paid model says so rather than
 * being left off, so its absence from the spend total is explained.
 */

/** OpenClaw's model, as scripts/install_openclaw.sh configures it on the Mini. */
const OPENCLAW_MODEL = 'claude-sonnet-5-5';

const NOT_METERED = 'not metered yet';

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
    metered: false,
    meterNote: NOT_METERED,
  },
  {
    id: 'reddit-watch',
    name: 'Reddit watch — finds fresh posts on chosen subreddits',
    machine: 'Mac Mini',
    runner: 'OpenClaw browser',
    everyHours: 4,
    cadence: 'every 4 hours',
    model: OPENCLAW_MODEL,
    metered: false,
    meterNote: NOT_METERED,
  },
  {
    id: 'substack-notes-search',
    name: 'Substack Notes search',
    machine: 'Mac Mini',
    runner: 'OpenClaw browser',
    everyHours: 6,
    cadence: 'every 6 hours',
    model: OPENCLAW_MODEL,
    metered: false,
    meterNote: NOT_METERED,
  },
  {
    id: 'outreach-posting',
    name: 'Posting approved replies (YouTube, Substack, Reddit) and reading Reddit threads',
    machine: 'Mac Mini',
    runner: 'OpenClaw browser',
    everyHours: null,
    cadence: 'checks every 2 minutes; uses AI only when there is an approved reply to post',
    model: OPENCLAW_MODEL,
    metered: false,
    meterNote: NOT_METERED,
  },
  {
    id: 'facebook-personal-posting',
    name: 'Facebook personal-profile posting',
    machine: 'Mac Mini',
    runner: 'OpenClaw browser',
    everyHours: null,
    cadence: 'when a post is published to a Facebook Personal channel',
    model: OPENCLAW_MODEL,
    metered: false,
    meterNote: NOT_METERED,
  },
  {
    id: 'studio-transcribe',
    name: 'Studio worker — transcribes footage',
    machine: 'Mac Mini',
    runner: 'whisper.cpp, on the Mini itself',
    everyHours: null,
    cadence: 'when new footage arrives',
    model: 'whisper large-v3-turbo (local)',
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

/** Every job, website first. */
function listAiJobs(byFeature) {
  return [...websiteJobs(byFeature), ...MINI_JOBS.map((job) => ({ ...job }))];
}

module.exports = { listAiJobs, websiteJobs, MINI_JOBS, OPENCLAW_MODEL, NOT_METERED };
