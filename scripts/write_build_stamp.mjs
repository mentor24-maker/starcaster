#!/usr/bin/env node
/**
 * Stamp the moment this deployment was built.
 *
 * Why this exists: Vercel bakes environment variables into a deployment at
 * build time, so editing one in the dashboard does nothing to the deployment
 * already serving traffic. On 2026-07-29 that cost an hour — a valid-looking X
 * token kept failing because production was running a build made before the
 * good values were in place, and nothing in the app could say so.
 *
 * Vercel exposes the commit at runtime (VERCEL_GIT_COMMIT_SHA) but no build
 * timestamp, so there is no way to answer "was this variable changed after this
 * deployment was built?" without recording the build moment ourselves. This
 * script runs as part of `npm run build`, which is what Vercel executes, so the
 * stamp is the real build time of the real deployment.
 *
 * The output is a gitignored build artifact — never commit it. lib/buildInfo.js
 * degrades gracefully when it is absent (a fresh clone that has not built yet).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const outPath = join(repoRoot, 'lib', 'build-stamp.json');

/** Local git commit, for dev builds where Vercel's env vars are absent. */
function localCommit() {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch (_) {
    return '';
  }
}

function localBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch (_) {
    return '';
  }
}

const env = (name) => String(process.env[name] || '').trim();

const stamp = {
  builtAt: new Date().toISOString(),
  commit: env('VERCEL_GIT_COMMIT_SHA') || localCommit(),
  branch: env('VERCEL_GIT_COMMIT_REF') || localBranch(),
  // 'production' | 'preview' | 'development' on Vercel; empty for a local build.
  vercelEnv: env('VERCEL_ENV'),
  onVercel: Boolean(env('VERCEL')),
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');

const where = stamp.onVercel ? `Vercel ${stamp.vercelEnv || 'build'}` : 'local build';
console.log(`[build:stamp] ${stamp.builtAt} (${where}, commit ${stamp.commit.slice(0, 7) || 'unknown'})`);
