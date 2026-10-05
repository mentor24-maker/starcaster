'use strict';

/**
 * Can PRODUCTION reach the YouTube download helper on the Mac Mini?
 *
 * Ticket 86bccrz1v. On 2026-10-04 Dane clicked Acquire Video and got "fetch
 * failed". The helper itself was healthy the whole time — `localhost:8080`
 * answered throughout — but the Tailscale tunnel that gives the Mini its public
 * address had been off since 2026-09-10, because it was started by hand and
 * nothing restarts it after a reboot. Production could not reach the Mini for
 * 24 days and nothing noticed: the roll call lists `youtube-media` as NOT
 * REPORTING by design, so no alarm could fire. It was found because Dane
 * happened to try a download.
 *
 * So this asks the question through the PUBLIC address, exactly as Vercel
 * does, and never through localhost — a probe of the local port would have
 * passed for all 24 days.
 *
 * WHERE IT RUNS, and why ownership plays no part. `scripts/run_bus_relay.sh`
 * calls it on every machine's ten-minute wake, BEFORE the relay's ownership
 * check, beside the other watchdogs. A probe that ran only where the helper
 * runs could not report that machine switched off; the other machine's idle
 * wake can. The Mini probing its own public address still goes out through the
 * tunnel, so it catches a dead tunnel too — which is why this is not gated the
 * other way either. Nothing here reads `lib/nodeRoles.js`, and a test pins that.
 *
 * Three verdicts, never two (docs/DOCTRINE.md §3.11):
 *   OK           /health answered 2xx through the public address
 *   UNREACHABLE  it did not answer, or answered with an error
 *   CANNOT TELL  no address is configured to probe — never a pass
 *
 * The pure half lives here so it can be tested without a network;
 * `scripts/worker_watch.mjs` does the probing, the stamps and the posting.
 */

const VERDICT = Object.freeze({ OK: 'OK', UNREACHABLE: 'UNREACHABLE', CANNOT_TELL: 'CANNOT TELL' });
const EXIT = Object.freeze({ OK: 0, UNREACHABLE: 1, 'CANNOT TELL': 2 });

/** The worker's base URL, from the same variable production reads. */
function workerUrl(env = process.env) {
  return String(env.YOUTUBE_MEDIA_WORKER_URL || '').trim().replace(/\/+$/, '');
}

/**
 * Turn one probe into a verdict.
 *   url    — the base URL probed ('' when none is configured)
 *   probe  — { status, body } when it answered, { error } when it did not
 */
function judge({ url, probe }) {
  if (!url) {
    return {
      verdict: VERDICT.CANNOT_TELL,
      reason: 'YOUTUBE_MEDIA_WORKER_URL is not set where this check runs (the Doppler dev config), '
        + 'so there is no public address to probe.',
    };
  }
  const target = `${url}/health`;
  if (!probe || probe.error) {
    return {
      verdict: VERDICT.UNREACHABLE,
      target,
      reason: `no answer from ${target} (${String(probe?.error || 'no reading')})`,
    };
  }
  const status = Number(probe.status) || 0;
  if (status >= 200 && status < 300) {
    return { verdict: VERDICT.OK, target, reason: `${target} answered ${status}` };
  }
  // The helper's own /health says 503 when yt-dlp or ffmpeg is missing; a dead
  // backend behind a live tunnel tends to come back 502. Either way production
  // cannot use it, and the status is the clue to which.
  return {
    verdict: VERDICT.UNREACHABLE,
    target,
    reason: `${target} answered ${status}${probe.body ? ` — ${String(probe.body).slice(0, 200)}` : ''}`,
  };
}

/**
 * What to do with a verdict, given what has already been said.
 *   alarmAt — when the last alarm for THIS verdict was posted ('' if never)
 *   anyOpen — whether any alarm (either kind) is currently open
 * Returns { action: 'post' | 'clear' | 'none', why }.
 *
 * Once per 6h while it fails, the same discipline report_job_failure.mjs and
 * `throughput --check` use; on recovery a single all-clear, sent ONLY if an
 * alarm actually went out, so a healthy helper is never chatter on the bus.
 */
function plan({ verdict, alarmAt = '', anyOpen = false, now = Date.now(), everyMs = 6 * 60 * 60 * 1000 }) {
  if (verdict === VERDICT.OK) {
    return anyOpen
      ? { action: 'clear', why: 'it answers again and an alarm was out — say so once and clear it' }
      : { action: 'none', why: 'it answers and nothing was ever raised' };
  }
  const then = Date.parse(alarmAt);
  if (alarmAt && Number.isFinite(then) && now - then < everyMs) {
    return { action: 'none', why: `already posted ${Math.round((now - then) / 60000)}m ago — once per 6h` };
  }
  return { action: 'post', why: 'not posted in the last 6h' };
}

function renderAlarm({ judged, node, at }) {
  if (judged.verdict === VERDICT.CANNOT_TELL) {
    return [
      '[CC-starcaster] ⚠️ YouTube download helper — CANNOT TELL whether production can reach it',
      '',
      `${judged.reason}`,
      '',
      'This is not a pass. Until the address is set, a dead Tailscale tunnel on the Mac Mini goes unnoticed — '
        + 'exactly what happened from 2026-09-10 to 2026-10-04.',
      `Checked from ${node} at ${at}. Re-posts every 6h while it stays this way.`,
    ].join('\n');
  }
  return [
    '[CC-starcaster] 🔴 YouTube download helper is UNREACHABLE from the internet',
    '',
    'Acquire Video cannot download .mp4/.mp3 files until this is fixed. The helper runs on the Mac Mini and '
      + 'production reaches it through its Tailscale tunnel.',
    '',
    `What failed: ${judged.reason}`,
    '',
    'Most likely the tunnel is down (it does not restart itself after a reboot) or the Mini is off. '
      + 'On the Mini: `tailscale status`, then `curl -s localhost:8080/health` to see whether the helper itself is up.',
    `Checked from ${node} at ${at}. Re-posts every 6h while it stays down; one all-clear when it answers again.`,
  ].join('\n');
}

function renderClear({ judged, node, at }) {
  return [
    '[CC-starcaster] ✅ YouTube download helper answers again',
    '',
    `${judged.reason}. Acquire Video can download files again.`,
    `Checked from ${node} at ${at}.`,
  ].join('\n');
}

module.exports = { VERDICT, EXIT, workerUrl, judge, plan, renderAlarm, renderClear };
