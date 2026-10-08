#!/usr/bin/env node
//
// Is the Mini's OpenClaw browser signed in as Dane of Earth — on YouTube
// (YouTube outreach 3/7, ticket 86bcda5wp) or on Substack (Substack Notes 7/7,
// ticket 86bcet7r8)? Run it ON the Mini:
//
//   node scripts/openclaw_smoke.mjs                       # YouTube, the dane-of-earth profile
//   node scripts/openclaw_smoke.mjs --site substack       # Substack, same profile
//   node scripts/openclaw_smoke.mjs --profile <name>      # another profile
//
// It asks the LOCAL gateway (/v1/responses, through lib/openclawResponsesClient.js)
// to open the site in that browser profile and say which account is signed
// in. It posts nothing, clicks nothing that changes anything, and prints no
// secret. With no --site it checks YouTube, exactly as it always has.
//
// WHAT EACH SITE'S CHECK READS (the SITES table below holds the instructions):
//   youtube   a "Sign in" button top right means signed out; otherwise the
//             channel name at the top of the avatar menu.
//   substack  substack.com/home. A "Sign in" button (or the sign-in page it
//             redirects to) means signed out; otherwise the display name on
//             the account's profile, reached from the avatar / "Profile" link.
//             The name compared is the DISPLAY name ("Dane of Earth"), not the
//             @handle, because the display name is what a reader sees on a
//             Note and the handle could change without the account changing.
//
// Exit codes follow scripts/ui/harness-exit.mjs (docs/DOCTRINE.md §5.33):
//   0  signed in as Dane of Earth
//   1  a reading was taken and it is wrong: signed out, signed in as someone
//      else, or no browser profile by that name exists
//   2  no reading could be taken: the gateway is down or refused the token, the
//      token file is missing, the model failed, or the answer was unreadable
//
// WHY IT REFUSES ANY ADDRESS BUT THIS MACHINE. The client library prefers a
// value saved in Settings > APIs over the environment, and a stale entry there
// (the July EC2 gateway, 18.222.149.88) would send the gateway token across
// the internet. So it checks the address the library WILL use, not the one
// this script set, and stops on anything that is not loopback.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EXPECTED_CHANNEL = 'Dane of Earth';
const EXPECTED_SUBSTACK_ACCOUNT = 'Dane of Earth';

// One entry per site. `nameKey` is the field the browser's JSON answer carries
// the account name in; `label` is how the verdict names the site.
export const SITES = {
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
const STATE_DIR = path.join(os.homedir(), '.openclaw');
const CONFIG = path.join(STATE_DIR, 'openclaw.json');
const ENV_FILE = path.join(STATE_DIR, '.env');
const PORT = 18789;

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function finish(code, message) {
  console.log(message);
  process.exit(code);
}

// The one value this script needs from ~/.openclaw/.env. Read, never printed.
function readEnvValue(file, name) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return ''; }
  const line = text.split('\n').find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : '';
}

/**
 * Turn the agent's answer into a verdict. Pure, so the three outcomes are
 * decided in one place.
 */
export function judge(answer, site = 'youtube') {
  const s = SITES[site];
  if (!s) return { code: 2, message: `Unknown site "${site}". Known: ${Object.keys(SITES).join(', ')}.` };
  if (!answer || typeof answer !== 'object' || typeof answer.signedIn !== 'boolean') {
    return { code: 2, message: 'Could not read the browser\'s answer, so there is no verdict either way.' };
  }
  if (!answer.signedIn) {
    return { code: 1, message: s.signedOut };
  }
  const name = String(answer[s.nameKey] || '').trim();
  if (!name) {
    return { code: 2, message: `The browser looks signed in to ${s.label}, but it could not read the account name.` };
  }
  if (name.toLowerCase() !== s.expected.toLowerCase()) {
    return { code: 1, message: `Signed in to ${s.label} as "${name}", not "${s.expected}".` };
  }
  return { code: 0, message: `Signed in to ${s.label} as "${name}".` };
}

async function main() {
  const profile = argValue('--profile', 'dane-of-earth');
  const site = argValue('--site', 'youtube');
  if (!SITES[site]) {
    finish(2, `Unknown --site "${site}". Known: ${Object.keys(SITES).join(', ')}.`);
  }

  // 1. Does the profile exist? A misspelt name is a wrong answer, not a blind one.
  let config;
  try { config = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch {
    finish(2, `Cannot read ${CONFIG}. Is OpenClaw installed here? (./scripts/install_openclaw.sh --status)`);
  }
  const profiles = Object.keys(config?.browser?.profiles || {});
  if (!profiles.includes(profile)) {
    finish(1, `There is no browser profile named "${profile}". Profiles on this machine: ${profiles.join(', ') || '(none)'}.`);
  }

  // 2. Point the client at THIS machine, and prove it will go there.
  const token = readEnvValue(ENV_FILE, 'OPENCLAW_GATEWAY_TOKEN');
  if (!token) finish(2, `No gateway token in ${ENV_FILE}. Re-run ./scripts/install_openclaw.sh.`);
  process.env.OPENCLAW_BASE_URL = `http://127.0.0.1:${PORT}`;
  process.env.OPENCLAW_API_KEY = token;
  const client = require(path.join(REPO, 'lib/openclawResponsesClient.js'));
  const { baseUrl } = client.getOpenClawConfig();
  let host = '';
  try { host = new URL(baseUrl).hostname; } catch { /* reported below */ }
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    finish(2, `Refusing to send the gateway token to "${baseUrl}": a saved setting (Settings > APIs > OpenClaw) `
      + 'overrides this machine\'s address. Clear it, then run this again.');
  }

  // 3. Ask.
  const res = await client.callOpenClawResponses({
    user: 'starcaster:openclaw-smoke',
    timeoutMs: 180000,
    instructions: 'You are running a read-only check. Do not post, comment, like, subscribe, or change any setting.',
    input: [
      `Use the browser tool with profile "${profile}".`,
      ...SITES[site].steps,
    ].join('\n'),
  });
  if (!res.ok) {
    finish(2, `No reading: ${res.error}`);
  }
  const verdict = judge(client.extractJsonFromText(res.text), site);
  finish(verdict.code, verdict.message);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => finish(2, `No reading: ${err?.message || err}`));
}
