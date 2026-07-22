#!/usr/bin/env node
'use strict';

/**
 * One-time helper: turn a short-lived Threads token into the two values the
 * publisher actually needs, and write them into .env.local:
 *
 *   THREADS_ACCESS_TOKEN  (long-lived, ~60 days)
 *   THREADS_USER_ID       (the numeric Threads user id, not the @handle)
 *
 * Reads THREADS_APP_SECRET from .env.local. The short-lived token is read from
 * stdin (never argv, so it stays out of shell history) and no token is ever
 * printed back to the terminal.
 *
 * Threads tokens come in two states and the dashboard does not label them, so
 * this script tries the exchange first and falls back to verifying the pasted
 * token as-is:
 *
 *   short-lived — straight from the Meta dashboard, lasts about an hour.
 *                 Exchanged here for a ~60-day token.
 *   long-lived  — already exchanged. Reused as-is once /me confirms it works.
 *
 *   node scripts/get_threads_token.cjs
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV_PATH = path.join(__dirname, '..', '.env.local');
const THREADS_HOST = 'https://graph.threads.net';
const THREADS_BASE = `${THREADS_HOST}/v1.0`;

function readEnvValue(key) {
  const line = fs.readFileSync(ENV_PATH, 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
  if (!line) return '';
  let v = line.slice(key.length + 1).trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  return v;
}

function writeEnvValue(key, value) {
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  const lines = raw.split('\n');
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  const entry = `${key}=${value}`;
  if (idx >= 0) lines[idx] = entry;
  else {
    if (lines.length && lines[lines.length - 1] === '') lines.splice(lines.length - 1, 0, entry);
    else lines.push(entry);
  }
  fs.writeFileSync(ENV_PATH, lines.join('\n'));
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(String(answer || '').trim()); }));
}

async function getJson(url) {
  let response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  } catch (err) {
    return { ok: false, error: `Network error: ${err?.message || 'request failed'}` };
  }
  const raw = await response.text().catch(() => '');
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }
  if (!response.ok) {
    return { ok: false, error: payload?.error?.message || payload?.message || raw || `API error (${response.status})` };
  }
  return { ok: true, data: payload };
}

function fail(message, hint) {
  console.error(`\n✖ ${message}`);
  if (hint) console.error(`\n  ${hint}`);
  process.exit(1);
}

/** Trade a short-lived token for the ~60-day one. */
async function exchangeForLongLived(shortToken, appSecret) {
  const exchanged = await getJson(
    `${THREADS_HOST}/access_token?grant_type=th_exchange_token`
    + `&client_secret=${encodeURIComponent(appSecret)}`
    + `&access_token=${encodeURIComponent(shortToken)}`
  );
  if (!exchanged.ok) return { ok: false, error: exchanged.error };

  const longToken = String(exchanged.data?.access_token || '');
  if (!longToken) return { ok: false, error: 'Exchange succeeded but returned no access_token' };
  return { ok: true, longToken };
}

/** Confirm a token works and read the account it belongs to. */
async function resolveAccount(token) {
  const me = await getJson(
    `${THREADS_BASE}/me?fields=id,username&access_token=${encodeURIComponent(token)}`
  );
  if (!me.ok) return { ok: false, error: me.error };
  if (!me.data?.id) return { ok: false, error: 'Could not read the Threads user id from the token' };
  return { ok: true, id: String(me.data.id), username: me.data.username || '(unknown)' };
}

(async () => {
  if (!fs.existsSync(ENV_PATH)) fail('.env.local not found', 'Expected it at the repo root.');

  const appSecret = readEnvValue('THREADS_APP_SECRET');
  if (!appSecret) {
    fail(
      'Missing THREADS_APP_SECRET in .env.local',
      'Add it from your Meta app (the one with Threads API access), then re-run this script.'
    );
  }

  console.log('\nPaste the short-lived Threads token from the Meta dashboard.');
  console.log('It is not echoed to the screen and never leaves this machine.\n');
  const shortToken = await ask('Short-lived token: ');
  if (!shortToken) fail('No token entered.');

  console.log('\nExchanging it for a long-lived token...');

  let accessToken = '';
  let exchanged = true;
  const exchange = await exchangeForLongLived(shortToken, appSecret);
  if (exchange.ok) {
    accessToken = exchange.longToken;
  } else {
    // Meta rejects the exchange when the token is already long-lived, so try it as-is.
    exchanged = false;
    accessToken = shortToken;
  }

  const account = await resolveAccount(accessToken);
  if (!account.ok) {
    fail(
      `Could not verify the token.\n\n  Exchange said: ${exchange.ok ? '(succeeded)' : exchange.error}\n  Threads /me said:  ${account.error}`,
      'Most often this means the token expired (short-lived ones last about an hour) or it is '
        + 'missing the threads_basic scope — generate a fresh one and retry.'
    );
  }

  writeEnvValue('THREADS_ACCESS_TOKEN', accessToken);
  writeEnvValue('THREADS_USER_ID', account.id);

  console.log(`\n✔ Wrote credentials to .env.local for @${account.username} (id ${account.id}).`);
  console.log(`  Token: ${exchanged ? 'exchanged for a long-lived one (~60 days)' : 'already long-lived, reused as-is'}`);
  console.log('  The token itself was not printed.');
  console.log('\nNote: publishing also needs the threads_content_publish scope on the token.');
  console.log('\nNext: restart the dev server, then Settings > Threads > run the auth test.');
})();
