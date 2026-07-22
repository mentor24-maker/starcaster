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

/**
 * Report what a Facebook token can actually see, so a failure names one cause
 * instead of listing possibilities. Three different problems produce the same
 * "no linked Instagram account" result and each needs a different fix:
 * a missing permission, no visible Pages at all, or Pages with nothing attached.
 */
async function inspectFacebookToken(longToken, pagesSeen) {
  const NEEDED = ['pages_show_list', 'instagram_basic', 'instagram_content_publish'];
  const lines = [];

  const me = await getJson(`${FB_BASE}/me?fields=name&access_token=${encodeURIComponent(longToken)}`);
  if (me.ok && me.data?.name) lines.push(`Signed in as: ${me.data.name}`);

  const perms = await getJson(`${FB_BASE}/me/permissions?access_token=${encodeURIComponent(longToken)}`);
  const rows = perms.ok ? (perms.data?.data || []) : [];
  const granted = rows.filter((r) => r.status === 'granted').map((r) => r.permission);
  const declined = rows.filter((r) => r.status !== 'granted').map((r) => r.permission);
  const missing = NEEDED.filter((name) => !granted.includes(name));

  if (granted.length) lines.push(`Permissions granted: ${granted.join(', ')}`);
  if (declined.length) lines.push(`Permissions DECLINED: ${declined.join(', ')}`);

  lines.push(`Facebook Pages visible: ${pagesSeen.length}`);
  pagesSeen.forEach((page) => {
    lines.push(`  - ${page.name || '(unnamed)'} — no Instagram account attached`);
  });

  let diagnosis;
  let fix;
  if (missing.length) {
    diagnosis = `This token is missing: ${missing.join(', ')}.`;
    fix = 'In Graph API Explorer these must be ticked BEFORE clicking Generate Access Token, '
      + 'and the Facebook popup must be allowed to finish. If a permission keeps coming back '
      + 'missing, it was declined in the popup rather than never requested.';
  } else if (!pagesSeen.length) {
    diagnosis = 'The token carries the right permissions but can see zero Facebook Pages.';
    fix = 'Two likely causes, cheapest first.\n'
      + '    1. The Facebook popup never granted the Page. Its second screen lists your Pages\n'
      + '       with checkboxes and grants NONE by default — clicking straight through produces\n'
      + '       exactly this result. Regenerate the token and tick the Page explicitly.\n'
      + '    2. The Page belongs to a Business portfolio. Add the business_management permission\n'
      + '       in Graph API Explorer alongside the others, then generate a new token.';
  } else {
    diagnosis = `${pagesSeen.length} Page(s) are visible, but none has an Instagram professional `
      + 'account attached.';
    fix = 'Link it from the Page side rather than the phone: open the Facebook Page -> Settings -> '
      + 'Linked accounts -> Instagram -> Connect account. Linking from the Instagram app often '
      + 'connects the account to your personal profile instead of to the Page. Then generate a '
      + 'new token.';
  }

  return { lines, diagnosis, fix };
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
    // "No linked account" has three very different causes that need opposite
    // fixes. Ask Facebook what this token can actually see and name the real one.
    return {
      ok: false,
      error: 'No Instagram Business account is linked to any Facebook Page on this token.',
      detail: await inspectFacebookToken(longToken, pages.data?.data || []),
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
    } else if (result.detail) {
      // The Facebook token was valid and we know exactly what it can see, so
      // report that rather than the Instagram-side error, which is just the
      // other API refusing a token that was never meant for it.
      const { lines, diagnosis, fix } = result.detail;
      console.error(`\n✖ ${firstError}\n`);
      console.error('  What this token can actually see:\n');
      lines.forEach((line) => console.error(`    ${line}`));
      console.error(`\n  Diagnosis: ${diagnosis}`);
      console.error(`\n  Fix: ${fix}\n`);
      process.exit(1);
    } else {
      fail(
        `Could not resolve the token on either API.\n\n  Facebook Graph said:  ${firstError}\n  Instagram Login said: ${viaIg.error}`,
        'Most often this means the token expired (they last about an hour) — generate a fresh one and retry.'
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
