'use strict';

/**
 * Does a Google sign-in let the Mac Mini upload to the right YouTube channel?
 * Reel Spinner 6b (SC-841). The rules only; `scripts/studio_youtube_check.cjs`
 * makes the three calls (refresh the token, ask Google which permissions it
 * carries, ask YouTube which channel it belongs to) and hands the answers here.
 *
 * Three verdicts, never two (DOCTRINE 5.33): READY, NOT READY (it answered,
 * and the answer is no), CANNOT TELL (a call failed, so there is no answer).
 * A failed lookup is never read as "no permission" — that would send Dane to
 * redo a sign-in that may be fine.
 */

/** The channel Reel Spinner uploads to (Dane's choice, 2026-11-16). */
const EXPECTED_CHANNEL = 'Dane of Earth';

/** Any one of these lets an app upload videos. */
const UPLOAD_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

/** Where the sign-in can come from, first match wins. Names only, never values. */
const TOKEN_SOURCES = [
  { name: 'YOUTUBE_UPLOAD_REFRESH_TOKEN', why: 'the Reel Spinner upload sign-in' },
  { name: 'GOOGLE_DRIVE_REFRESH_TOKEN', why: 'the Drive sign-in (also used for posting comments)' },
];

/** Which setting holds the sign-in to use. Takes `process.env`-shaped input. */
function pickTokenSource(env) {
  for (const source of TOKEN_SOURCES) {
    if (String(env[source.name] || '').trim()) return source;
  }
  return null;
}

function hasUploadScope(scopes) {
  return (Array.isArray(scopes) ? scopes : []).some((scope) => UPLOAD_SCOPES.includes(String(scope).trim()));
}

/**
 * The verdict, from what Google and YouTube said.
 *
 *   scopes    { ok, scopes: [...] } or { ok: false, error }
 *   channels  { ok, titles: [...] } or { ok: false, error }
 *
 * Returns { verdict: 'READY' | 'NOT READY' | 'CANNOT TELL', channel, upload, reasons }.
 * `upload` is 'yes' / 'no' / 'unknown'; `channel` is the title or ''.
 */
function judgeUploadAccess({ scopes, channels, expected = EXPECTED_CHANNEL }) {
  const reasons = [];
  let upload = 'unknown';
  if (scopes && scopes.ok) {
    upload = hasUploadScope(scopes.scopes) ? 'yes' : 'no';
    if (upload === 'no') reasons.push('the sign-in does not carry YouTube upload permission');
  } else {
    reasons.push(`could not read the sign-in's permissions: ${(scopes && scopes.error) || 'no answer'}`);
  }

  let channel = '';
  let channelKnown = false;
  if (channels && channels.ok) {
    channelKnown = true;
    const titles = (Array.isArray(channels.titles) ? channels.titles : []).map((t) => String(t).trim()).filter(Boolean);
    if (!titles.length) {
      reasons.push('the account this sign-in belongs to has no YouTube channel');
    } else {
      channel = titles.includes(expected) ? expected : titles.join(', ');
      if (!titles.includes(expected)) {
        reasons.push(`the sign-in belongs to "${titles.join('", "')}", not "${expected}"`);
      }
    }
  } else {
    reasons.push(`could not ask YouTube which channel this is: ${(channels && channels.error) || 'no answer'}`);
  }

  let verdict;
  if (upload === 'yes' && channel === expected) verdict = 'READY';
  else if ((scopes && scopes.ok && upload === 'no') || (channelKnown && channel !== expected)) verdict = 'NOT READY';
  else verdict = 'CANNOT TELL';
  return { verdict, channel, upload, reasons };
}

/** Exit code for a verdict: 0 ready, 1 not ready, 2 could not tell. */
function exitCodeFor(verdict) {
  if (verdict === 'READY') return 0;
  if (verdict === 'NOT READY') return 1;
  return 2;
}

module.exports = {
  EXPECTED_CHANNEL,
  UPLOAD_SCOPES,
  TOKEN_SOURCES,
  pickTokenSource,
  hasUploadScope,
  judgeUploadAccess,
  exitCodeFor,
};
