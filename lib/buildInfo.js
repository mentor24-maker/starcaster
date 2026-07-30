'use strict';

/**
 * What deployment is actually running, and how old is it?
 *
 * The point is to make the Vercel redeploy trap visible. An environment
 * variable edited in the dashboard does not reach the deployment already
 * serving traffic, so a credential can be correct in Vercel and still wrong in
 * production. Being able to say "this deployment was built at 09:14, three days
 * ago" turns an invisible trap into a checkable fact.
 *
 * Build time comes from lib/build-stamp.json, written by
 * scripts/write_build_stamp.mjs during `npm run build` (which is what Vercel
 * runs). Commit and branch prefer Vercel's runtime env vars and fall back to
 * the stamp, so this still says something useful if the stamp is missing.
 */

const path = require('path');

const STAMP_PATH = path.join(__dirname, 'build-stamp.json');

function readStamp() {
  try {
    // require() caches, which is what we want — the file cannot change while
    // the process is alive.
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(STAMP_PATH);
  } catch (_) {
    // Absent in a fresh clone that has not run `npm run build` yet. Not an
    // error: everything below degrades to nulls and the callers say "unknown"
    // rather than inventing a time.
    return null;
  }
}

function envText(name) {
  return String(process.env[name] || '').trim();
}

/** Plain-language age, e.g. "3 days ago". Empty when the build time is unknown. */
function humanAge(builtAtIso, now = Date.now()) {
  if (!builtAtIso) return '';
  const built = Date.parse(builtAtIso);
  if (!Number.isFinite(built)) return '';
  const seconds = Math.max(0, Math.round((now - built) / 1000));
  if (seconds < 90) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  // Switch to days at 24h, not 36h: with a 36h cutoff the days branch could
  // never produce 1, so "1 day ago" was unreachable.
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function getBuildInfo(now = Date.now()) {
  const stamp = readStamp();
  const builtAt = stamp && typeof stamp.builtAt === 'string' ? stamp.builtAt : null;
  const commit = envText('VERCEL_GIT_COMMIT_SHA') || String(stamp?.commit || '').trim();
  const branch = envText('VERCEL_GIT_COMMIT_REF') || String(stamp?.branch || '').trim();
  return {
    builtAt,
    builtAgo: humanAge(builtAt, now),
    commit,
    shortCommit: commit ? commit.slice(0, 7) : '',
    branch,
    vercelEnv: envText('VERCEL_ENV') || String(stamp?.vercelEnv || '').trim(),
    onVercel: Boolean(envText('VERCEL')) || Boolean(stamp?.onVercel),
    // False when there is no stamp — callers must not claim a build time they
    // do not have.
    known: Boolean(builtAt),
  };
}

/**
 * One sentence naming when the running deployment was built, for appending to a
 * credential failure whose value came from an environment variable. Returns ''
 * when the build time is unknown, so callers can fall back to the generic
 * warning rather than printing a half-sentence.
 */
function describeRunningBuild(now = Date.now()) {
  const info = getBuildInfo(now);
  if (!info.known) return '';
  const when = info.builtAgo ? `${info.builtAt} (${info.builtAgo})` : info.builtAt;
  const commit = info.shortCommit ? `, commit ${info.shortCommit}` : '';
  return `This deployment was built ${when}${commit}.`;
}

module.exports = {
  getBuildInfo,
  describeRunningBuild,
  humanAge,
};
