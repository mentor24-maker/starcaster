#!/usr/bin/env node
'use strict';
/**
 * The Mini's scheduled Reddit watch, for EVERY project with approved
 * subreddits: each pass reads the two subreddits read longest ago — their new
 * and rising posts and their sidebar rules — through the signed-in OpenClaw
 * browser, keeps the posts that match a keyword or the canon, and reads the
 * strongest comments on the best of them (lib/acquire/RedditWatchDue.js,
 * Outreach wizard 18/19). launchd runs it every four hours through
 * scripts/run_reddit_watch.sh; run it by hand the same way:
 *
 *   doppler run --scope ~/Studio --project starcaster --config prd -- node scripts/reddit_watch_due.mjs
 *
 * It talks only to the OpenClaw gateway on THIS machine, and refuses to start
 * if a saved setting would send the gateway token anywhere else
 * (workers/youtube-outreach/poster.js configureOpenClaw).
 *
 * Exit: 0 at least one subreddit read and none failed; 1 a read failed or was
 * refused for at least one subreddit — signed out, the browser down, an answer
 * it could not read — or the project list could not be read; 4 NOTHING was
 * read (no project has an approved subreddit); 5 the Mini's daily AI limit
 * (AI Quota 5/5) stopped the pass before anything was read — a normal decline,
 * with no failure post (the limit posts its own line). A failed read is never
 * "found nothing", and a pass that read nothing is not a clean pass: the
 * runner records no beat for any of these. A pass that read some subreddits
 * and was then stopped is a clean pass for what it read: exit 0.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/** Nothing was due: no beat, and no failure post either. */
const NOTHING_READ = 4;
/** Stopped for today by the Mini's daily AI limit, nothing read: no beat, no failure post. */
const STOPPED_FOR_TODAY = 5;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));

try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });
  dotenv.config({ path: path.join(ROOT, '.env.local'), override: false, quiet: true });
} catch { /* no dotenv: the environment must already carry the settings */ }

const { isConfigured } = require(path.join(ROOT, 'lib/supabase.js'));
const { configureOpenClaw } = require(path.join(ROOT, 'workers/youtube-outreach/poster.js'));
const { runRedditWatchDue, formatWatchLog } = require(path.join(ROOT, 'lib/acquire/RedditWatchDue.js'));

console.log(`=== reddit-watch ${new Date().toISOString()}`);
if (!isConfigured()) {
  console.error('Supabase is not configured here. Run it through Doppler (see the header of this file).');
  process.exit(1);
}
const openclaw = configureOpenClaw(process.env);
if (!openclaw.ok) {
  console.error(`No watch: ${openclaw.why}`);
  process.exit(1);
}

const run = await runRedditWatchDue();
if (!run.ok) {
  console.error(run.error);
  process.exit(1);
}
console.log(formatWatchLog(run.data));
if (run.data.failed) process.exit(1);
if (run.data.read) process.exit(0);
process.exit(run.data.stoppedForToday ? STOPPED_FOR_TODAY : NOTHING_READ);
