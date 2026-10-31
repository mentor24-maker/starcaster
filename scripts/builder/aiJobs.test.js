'use strict';

/**
 * Settings › AI Quota lists every job that calls a model (task 86bcvj7k9).
 * The Mini's half is written down by hand in lib/aiJobs.js, because no meter
 * row is ever written for it — so these tests hold that list to the install
 * scripts that actually set each schedule and model on the Mini. A list that
 * says "every 4 hours" while launchd runs it hourly is the Oct 28-30 shape
 * again: a page that looks complete and is not.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { listAiJobs, MINI_JOBS, OPENCLAW_MODEL, NOT_METERED } = require('../../lib/aiJobs');
const { priceCall } = require('../../lib/aiPricing');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const job = (id) => MINI_JOBS.find((j) => j.id === id);

function startIntervalHours(script) {
  const m = read(script).match(/<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/);
  assert.ok(m, `${script} has no StartInterval`);
  return Number(m[1]) / 3600;
}

test('the OpenClaw model is the one install_openclaw.sh configures, and it is priced', () => {
  const m = read('scripts/install_openclaw.sh').match(/^MODEL="anthropic\/([^"]+)"/m);
  assert.ok(m, 'install_openclaw.sh no longer sets MODEL the way this test reads it');
  assert.equal(OPENCLAW_MODEL, m[1]);
  // AI Quota 3/5 will price these calls; a model with no rate would read
  // "incomplete" from the first metered request.
  assert.equal(priceCall({ provider: 'anthropic', model: OPENCLAW_MODEL, promptTokens: 1 }).priced, true);
});

test('the schedules listed match the Mini install scripts', () => {
  assert.equal(job('reddit-watch').everyHours, startIntervalHours('scripts/install_reddit_watch.sh'));
  assert.equal(job('substack-notes-search').everyHours, startIntervalHours('scripts/install_substack_notes_search.sh'));
  const { CHECK_EVERY_MS } = require('../../lib/openclawSignIn.js');
  assert.equal(job('openclaw-sign-in-check').everyHours, CHECK_EVERY_MS / 3600000);
});

test('every Mini job says it is not metered, and why', () => {
  for (const j of MINI_JOBS) {
    assert.equal(j.metered, false, j.id);
    assert.ok(j.meterNote, `${j.id} must say why it is not in the total`);
  }
  for (const id of ['openclaw-sign-in-check', 'reddit-watch', 'substack-notes-search', 'outreach-posting']) {
    assert.equal(job(id).meterNote, NOT_METERED, id);
  }
});

test('website features come from the meter rows and are marked metered', () => {
  const jobs = listAiJobs([
    { feature: 'theme_wizard', calls: 3, models: { 'claude-sonnet-5-5': 3 } },
    { feature: 'alt_text', calls: 1, models: { 'gemini-2.5-flash': 1 } },
  ]);
  const site = jobs.filter((j) => j.machine.startsWith('Website'));
  assert.deepEqual(site.map((j) => j.name), ['theme_wizard', 'alt_text']);
  assert.ok(site.every((j) => j.metered));
  assert.equal(site[0].model, 'claude-sonnet-5-5');
  assert.equal(site[1].cadence, '1 call in the last 30 days');
  // The Mini's jobs are listed even when the website made no calls at all.
  assert.equal(listAiJobs([]).length, MINI_JOBS.length);
});
