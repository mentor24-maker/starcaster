#!/usr/bin/env node
'use strict';

/**
 * One-time helper: turn a short-lived Instagram token into the two values the
 * publisher actually needs, and write them into .env.local:
 *
 *   INSTAGRAM_ACCESS_TOKEN        (long-lived, ~60 days)
 *   INSTAGRAM_BUSINESS_ACCOUNT_ID (the numeric account id, not the @handle)
 *
 * Reads INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET from .env.local. The
 * short-lived token is read from stdin (never argv, so it stays out of shell
 * history) and no token is ever printed back to the terminal.
 *
 * Meta ships two different Instagram APIs and the dashboard does not make the
 * difference obvious, so this script detects which one your token belongs to:
 *
 *   facebook  — "Instagram Graph API", tokens from Graph API Explorer.
 *               Needs an IG Business/Creator account linked to a FB Page.
 *   instagram — "Instagram API with Instagram Login", no FB Page required.
 *               Needs INSTAGRAM_BASE_URL pointed at graph.instagram.com.
 *
 *   node scripts/get_instagram_token.cjs
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV_PATH = path.join(__dirname, '..', '.env.local');
const GRAPH_VERSION = 'v22.0';
const FB_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const IG_BASE = 'https://graph.instagram.com';

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

/** Instagram Graph API path: FB Page -> linked IG Business account. */
async function resolveViaFacebook(shortToken, appId, appSecret) {
  const exchanged = await getJson(
    `${FB_BASE}/oauth/access_token?grant_type=fb_exchange_token`
    + `&client_id=${encodeURIComponent(appId)}`
    + `&client_secret=${encodeURIComponent(appSecret)}`
    + `&fb_exchange_token=${encodeURIComponent(shortToken)}`
  );
  if (!exchanged.ok) return { ok: false, error: exchanged.error };

  const longToken = String(exchanged.data?.access_token || '');
  if (!longToken) return { ok: false, error: 'Exchange succeeded but returned no access_token' };

  const pages = await getJson(
    `${FB_BASE}/me/accounts?fields=name,instagram_business_account{id,username}`
    + `&access_token=${encodeURIComponent(longToken)}`
  );
  if (!pages.ok) return { ok: false, error: pages.error };

  const linked = (pages.data?.data || []).filter((p) => p?.instagram_business_account?.id);
  if (!linked.length) {
    return {
      ok: false,
      error: 'No Instagram Business account is linked to any Facebook Page on this token.',
      hint: 'Either the IG account is still a personal account, or it is not linked to a Page, '
        + 'or the token is missing the instagram_basic / pages_show_list permissions.',
    };
  }

  return { ok: true, flavor: 'facebook', longToken, candidates: linked.map((p) => ({
    pageName: p.name,
    id: p.instagram_business_account.id,
    username: p.instagram_business_account.username || '(unknown)',
  })) };
}

/** Instagram Login path: the token already belongs to the IG account itself. */
async function resolveViaInstagram(shortToken, appSecret) {
  const exchanged = await getJson(
    `${IG_BASE}/access_token?grant_type=ig_exchange_token`
    + `&client_secret=${encodeURIComponent(appSecret)}`
    + `&access_token=${encodeURIComponent(shortToken)}`
  );
  if (!exchanged.ok) return { ok: false, error: exchanged.error };

  const longToken = String(exchanged.data?.access_token || '');
  if (!longToken) return { ok: false, error: 'Exchange succeeded but returned no access_token' };

  const me = await getJson(
    `${IG_BASE}/me?fields=id,username,account_type&access_token=${encodeURIComponent(longToken)}`
  );
  if (!me.ok) return { ok: false, error: me.error };
  if (!me.data?.id) return { ok: false, error: 'Could not read the Instagram account id from the token' };

  return { ok: true, flavor: 'instagram', longToken, candidates: [{
    pageName: '(Instagram Login — no Facebook Page)',
    id: String(me.data.id),
    username: me.data.username || '(unknown)',
    accountType: me.data.account_type || '',
  }] };
}

(async () => {
  if (!fs.existsSync(ENV_PATH)) fail('.env.local not found', 'Expected it at the repo root.');

  const appId = readEnvValue('INSTAGRAM_APP_ID');
  const appSecret = readEnvValue('INSTAGRAM_APP_SECRET');
  if (!appId || !appSecret) {
    fail(
      'Missing INSTAGRAM_APP_ID or INSTAGRAM_APP_SECRET in .env.local',
      'Add both lines to .env.local first, then re-run this script.'
    );
  }

  console.log('\nPaste the short-lived Instagram token from the Meta dashboard.');
  console.log('It is not echoed to the screen and never leaves this machine.\n');
  const shortToken = await ask('Short-lived token: ');
  if (!shortToken) fail('No token entered.');

  console.log('\nWorking out which Instagram API this token belongs to...');

  let result = await resolveViaFacebook(shortToken, appId, appSecret);
  if (!result.ok) {
    const firstError = result.error;
    const viaIg = await resolveViaInstagram(shortToken, appSecret);
    if (viaIg.ok) {
      result = viaIg;
    } else {
      fail(
        `Could not resolve the token on either API.\n\n  Facebook Graph said:  ${firstError}\n  Instagram Login said: ${viaIg.error}`,
        result.hint || 'Most often this means the token expired (they last about an hour) — generate a fresh one and retry.'
      );
    }
  }

  let chosen = result.candidates[0];
  if (result.candidates.length > 1) {
    console.log('\nThis token can reach more than one Instagram account:\n');
    result.candidates.forEach((c, i) => {
      console.log(`  ${i + 1}. @${c.username}  (id ${c.id})  via Page: ${c.pageName}`);
    });
    const pick = await ask(`\nWhich one should StarCaster post to? [1-${result.candidates.length}]: `);
    const idx = Number(pick) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= result.candidates.length) fail('Not a valid choice.');
    chosen = result.candidates[idx];
  }

  writeEnvValue('INSTAGRAM_ACCESS_TOKEN', result.longToken);
  writeEnvValue('INSTAGRAM_BUSINESS_ACCOUNT_ID', chosen.id);
  if (result.flavor === 'instagram') writeEnvValue('INSTAGRAM_BASE_URL', IG_BASE);

  console.log(`\n✔ Wrote credentials to .env.local for @${chosen.username} (id ${chosen.id}).`);
  console.log(`  API flavor: ${result.flavor === 'facebook' ? 'Instagram Graph API (via Facebook Page)' : 'Instagram API with Instagram Login'}`);
  console.log('  The token itself was not printed. It lasts about 60 days.');
  console.log('\nNext: restart the dev server, then Settings > Instagram > run the auth test.');
})();
