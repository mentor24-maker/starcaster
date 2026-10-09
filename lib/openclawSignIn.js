'use strict';

/**
 * Is the Mini's OpenClaw browser signed in as Dane of Earth? The ONE copy of
 * that question, shared by the by-hand check (scripts/openclaw_smoke.mjs,
 * YouTube outreach 3/7) and the posting worker's hourly check
 * (workers/youtube-outreach/health.js, YouTube outreach 7/7, task 86bcda6dt).
 * Two copies of "what counts as signed in" would drift, and the drift would
 * surface as the worker and the by-hand check disagreeing about one browser.
 *
 * WHAT EACH SITE'S CHECK READS (the SITES table holds the instructions):
 *   youtube   a "Sign in" button top right means signed out; otherwise the
 *             channel name at the top of the avatar menu.
 *   substack  substack.com/home. A "Sign in" button (or the sign-in page it
 *             redirects to) means signed out; otherwise the display name on
 *             the account's profile, reached from the avatar / "Profile" link.
 *             The name compared is the DISPLAY name ("Dane of Earth"), not the
 *             @handle, because the display name is what a reader sees on a
 *             Note and the handle could change without the account changing.
 *
 * Verdict codes follow scripts/ui/harness-exit.mjs (docs/DOCTRINE.md §5.33):
 *   0  signed in as the expected account
 *   1  a reading was taken and it is wrong: signed out, or someone else
 *   2  no reading could be taken
 *
 * GATEWAY DOWN IS NOT SIGNED OUT. `probeGateway` asks a different question
 * first — does anything answer at the gateway's address at all? — because the
 * two failures have different fixes (restart a service vs sign in by hand),
 * and an alarm that names the wrong fix sends Dane to the wrong machine screen.
 */

const EXPECTED_CHANNEL = 'Dane of Earth';

/**
 * The states the posting worker's hourly check can end in
 * (workers/youtube-outreach/health.js). Both settings stores — YouTube
 * outreach and Substack Notes — save one of these, so they read ONE list.
 */
const BROWSER_STATES = ['signed_in', 'signed_out', 'wrong_account', 'gateway_down', 'cannot_tell'];
const EXPECTED_SUBSTACK_ACCOUNT = 'Dane of Earth';

// One entry per site. `nameKey` is the field the browser's JSON answer carries
// the account name in; `label` is how the verdict names the site.
const SITES = {
  youtube: {
    label: 'YouTube',
    expected: EXPECTED_CHANNEL,
    nameKey: 'channelName',
    signedOut: 'The browser is SIGNED OUT of YouTube. Dane needs to sign in again (docs/NODE_PROVISIONING.md, "openclaw").',
    steps: [
      'Open https://www.youtube.com and wait for it to load.',
      'If a "Sign in" button is showing in the top right, the browser is signed out.',
      'Otherwise click the account avatar in the top right and read the channel name shown at the top of that menu, then press Escape.',
      'Reply with ONLY this JSON and nothing else:',
      '{"signedIn": true or false, "channelName": "the name, or null"}',
    ],
  },
  substack: {
    label: 'Substack',
    expected: EXPECTED_SUBSTACK_ACCOUNT,
    nameKey: 'accountName',
    signedOut: 'Substack on the Mini is signed out of Dane of Earth. Sign in again in the dane-of-earth browser.',
    steps: [
      'Open https://substack.com/home and wait for it to load.',
      'If it shows a "Sign in" button, or it lands on a sign-in or "create account" page, the browser is signed out.',
      'Otherwise open the signed-in account\'s own profile (the avatar, or the "Profile" link in the menu) and read the account\'s display name — the name, not the @handle. Do not follow, subscribe or change anything.',
      'Reply with ONLY this JSON and nothing else:',
      '{"signedIn": true or false, "accountName": "the display name, or null"}',
    ],
  },
};

/**
 * Turn the agent's answer into a verdict. Pure, so the three outcomes are
 * decided in one place. `kind` says which of the wrong answers it was, so a
 * caller can word "signed out" and "signed in as someone else" differently.
 */
function judge(answer, site = 'youtube') {
  const s = SITES[site];
  if (!s) return { code: 2, kind: 'cannot_tell', message: `Unknown site "${site}". Known: ${Object.keys(SITES).join(', ')}.` };
  if (!answer || typeof answer !== 'object' || typeof answer.signedIn !== 'boolean') {
    return { code: 2, kind: 'cannot_tell', message: 'Could not read the browser\'s answer, so there is no verdict either way.' };
  }
  if (!answer.signedIn) {
    return { code: 1, kind: 'signed_out', message: s.signedOut };
  }
  const name = String(answer[s.nameKey] || '').trim();
  if (!name) {
    return { code: 2, kind: 'cannot_tell', message: `The browser looks signed in to ${s.label}, but it could not read the account name.` };
  }
  if (name.toLowerCase() !== s.expected.toLowerCase()) {
    return { code: 1, kind: 'wrong_account', name, message: `Signed in to ${s.label} as "${name}", not "${s.expected}".` };
  }
  return { code: 0, kind: 'signed_in', name, message: `Signed in to ${s.label} as "${name}".` };
}

/** The request that asks the browser which account is signed in. Read-only. */
function signInRequest(site, profile) {
  return {
    user: 'starcaster:openclaw-smoke',
    timeoutMs: 180000,
    instructions: 'You are running a read-only check. Do not post, comment, like, subscribe, or change any setting.',
    input: [
      `Use the browser tool with profile "${profile}".`,
      ...SITES[site].steps,
    ].join('\n'),
  };
}

/**
 * Does anything answer at the gateway's address? ANY HTTP reply — even a 401
 * or a 404 — means the gateway process is up; only a refused or timed-out
 * connection means it is down. Asking a page rather than the browser keeps
 * this cheap and keeps it from ever being mistaken for a sign-in problem.
 */
async function probeGateway(baseUrl, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const url = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!url) return { up: false, why: 'no gateway address is configured' };
  try {
    const res = await fetchImpl(`${url}/`, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
    return { up: true, status: res.status };
  } catch (err) {
    const cause = err?.cause?.code || err?.code || err?.name || '';
    const why = cause === 'ECONNREFUSED'
      ? `nothing is listening at ${url}`
      : (cause === 'TimeoutError' || cause === 'AbortError')
        ? `${url} did not answer within ${Math.round(timeoutMs / 1000)}s`
        : `${url} could not be reached (${err?.message || cause || 'unknown error'})`;
    return { up: false, why };
  }
}

module.exports = {
  SITES,
  BROWSER_STATES,
  EXPECTED_CHANNEL,
  judge,
  signInRequest,
  probeGateway,
};
