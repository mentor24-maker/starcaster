'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { sendOk, sendErr, parseJsonBody } = require('./http');
const { readSessionToken } = require('./auth');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'capture_platform_screenshots.js');

function requestOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || '').trim() || 'http';
  const host = String(req.headers.host || '').trim() || '127.0.0.1:3000';
  return `${proto}://${host}`;
}

function normalizeSections(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || '').split(',');
  return list
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join(',');
}

async function handle(req, res, pathname, requestMethod) {
  if (pathname !== '/api/platform-screenshots/run') return false;
  if (requestMethod !== 'POST') {
    return sendErr(res, 405, 'Method not allowed', { code: 'METHOD_NOT_ALLOWED' }), true;
  }

  const body = await parseJsonBody(req);
  const sessionToken = readSessionToken(req);
  if (!sessionToken) return sendErr(res, 401, 'Not authenticated', { code: 'AUTH_REQUIRED' }), true;

  const sections = normalizeSections(body?.sections);

  // On Lambda/serverless the app root (/var/task) is read-only; only /tmp is writable.
  // Playwright also cannot run in those environments, so redirect output there.
  const isServerless = Boolean(process.env.LAMBDA_TASK_ROOT || process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const outDir = isServerless ? '/tmp/_temp' : path.join(ROOT, 'public', '_temp');

  const env = {
    ...process.env,
    STARCASTER_URL: String(body?.url || requestOrigin(req)).replace(/\/$/, ''),
    STARCASTER_SESSION_TOKEN: sessionToken,
    HEADLESS: body?.headless === false ? 'false' : 'true',
    STARCASTER_SCREENSHOT_DIR: outDir,
  };
  if (sections) env.STARCASTER_SCREENSHOTS = sections;
  if (body?.width) env.SCREENSHOT_WIDTH = String(body.width);
  if (body?.height) env.SCREENSHOT_HEIGHT = String(body.height);

  const child = spawn(process.execPath, [SCRIPT_PATH], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const result = await new Promise((resolve) => {
    child.on('error', (error) => resolve({ ok: false, code: -1, error: error.message }));
    child.on('close', (code) => resolve({ ok: code === 0, code }));
  });

  const publicOutputDir = isServerless ? null : '/_temp';
  const manifestPath = publicOutputDir ? `${publicOutputDir}/manifest.json` : null;
  const payload = {
    exitCode: result.code,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    manifestPath,
    outputDir: publicOutputDir,
    screenshotDir: outDir,
  };

  if (!result.ok) {
    return sendErr(res, 500, result.error || stderr.trim() || 'Screenshot capture failed', {
      code: 'SCREENSHOT_CAPTURE_FAILED',
      ...payload,
    }), true;
  }

  return sendOk(res, 200, payload, { screenshots: payload }), true;
}

module.exports = {
  handle,
  manifest: {
    id: 'platform-screenshots',
    label: 'Platform Screenshot Capture',
    prefixes: ['/api/platform-screenshots'],
  },
};
