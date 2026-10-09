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
// What each site's check reads, and how an answer becomes a verdict, live in
// lib/openclawSignIn.js — shared with the posting worker's hourly check
// (YouTube outreach 7/7, 86bcda6dt), so the two can never disagree.
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

const signIn = require(path.join(REPO, 'lib/openclawSignIn.js'));
export const SITES = signIn.SITES;
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

/** The verdict for one answer — see lib/openclawSignIn.js. */
export function judge(answer, site = 'youtube') {
  const { code, message } = signIn.judge(answer, site);
  return { code, message };
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
  const res = await client.callOpenClawResponses(signIn.signInRequest(site, profile));
  if (!res.ok) {
    finish(2, `No reading: ${res.error}`);
  }
  const verdict = judge(client.extractJsonFromText(res.text), site);
  finish(verdict.code, verdict.message);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => finish(2, `No reading: ${err?.message || err}`));
}
