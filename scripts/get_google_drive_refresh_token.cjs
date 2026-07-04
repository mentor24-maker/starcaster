#!/usr/bin/env node
'use strict';

/**
 * One-time helper: obtain a Google Drive OAuth refresh token via the browser
 * consent flow and write it into .env.local as GOOGLE_DRIVE_REFRESH_TOKEN.
 *
 * Reads GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET from .env.local.
 * The token is written to the file only — never printed.
 *
 *   node scripts/get_google_drive_refresh_token.cjs
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { OAuth2Client } = require('google-auth-library');

const ENV_PATH = path.join(__dirname, '..', '.env.local');
const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
// App both reads and writes Drive (creates folders, uploads) → full scope.
const SCOPES = ['https://www.googleapis.com/auth/drive'];

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

const clientId = readEnvValue('GOOGLE_DRIVE_CLIENT_ID');
const clientSecret = readEnvValue('GOOGLE_DRIVE_CLIENT_SECRET');
if (!clientId || !clientSecret) {
  console.error('Missing GOOGLE_DRIVE_CLIENT_ID or GOOGLE_DRIVE_CLIENT_SECRET in .env.local');
  process.exit(1);
}

const oauth2 = new OAuth2Client(clientId, clientSecret, REDIRECT_URI);
const authParams = {
  access_type: 'offline',
  prompt: 'consent select_account', // force refresh_token + account chooser
  scope: SCOPES,
};
// Pin the account so the browser can't silently use the wrong logged-in one.
if (process.env.GOOGLE_TEST_USER_HINT) authParams.login_hint = process.env.GOOGLE_TEST_USER_HINT;
const authUrl = oauth2.generateAuthUrl(authParams);

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) {
    res.writeHead(404); res.end('Not found'); return;
  }
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');
  if (err) {
    res.writeHead(400); res.end(`Authorization failed: ${err}`);
    console.error(`\nAuthorization failed: ${err}`);
    server.close(); process.exit(1);
  }
  try {
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      res.writeHead(400); res.end('No refresh token returned. Revoke prior access and retry.');
      console.error('\nNo refresh_token returned — revoke the app at myaccount.google.com/permissions and re-run.');
      server.close(); process.exit(1);
    }
    writeEnvValue('GOOGLE_DRIVE_REFRESH_TOKEN', tokens.refresh_token);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>Success.</h2><p>Refresh token saved to .env.local. You can close this tab and return to the terminal.</p>');
    console.log('\nSUCCESS: GOOGLE_DRIVE_REFRESH_TOKEN written to .env.local (value not printed).');
    server.close(); process.exit(0);
  } catch (e) {
    res.writeHead(500); res.end('Token exchange failed.');
    console.error('\nToken exchange failed:', e.message);
    server.close(); process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('\n1. Ensure this redirect URI is registered on your OAuth client in Google Cloud Console:');
  console.log(`     ${REDIRECT_URI}`);
  console.log('\n2. Open this URL in your browser and approve access:\n');
  console.log(authUrl);
  console.log('\nWaiting for the browser redirect...');
});
