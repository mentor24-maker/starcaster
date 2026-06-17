'use strict';

const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright');

const DEFAULT_URL = 'http://127.0.0.1:3000';
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT_DIR = path.join(ROOT, 'public', '_temp');
const OUT_DIR = process.env.STARCASTER_SCREENSHOT_DIR
  ? path.resolve(process.env.STARCASTER_SCREENSHOT_DIR)
  : DEFAULT_OUT_DIR;
// Public URL prefix — only meaningful when OUT_DIR is inside public/
const PUBLIC_PREFIX = OUT_DIR === DEFAULT_OUT_DIR ? '/_temp' : null;
const USER_DATA_DIR = process.env.STARCASTER_SCREENSHOT_PROFILE
  ? path.resolve(process.env.STARCASTER_SCREENSHOT_PROFILE)
  : path.join(ROOT, '.playwright', 'starcaster-screenshot-profile');

const SECTIONS = [
  { name: 'acquire', label: 'Acquire', pageId: 'acquirePage' },
  { name: 'contacts', label: 'Contacts', pageId: 'contactsPage' },
  { name: 'channels', label: 'Channels', pageId: 'channelsPage' },
  { name: 'messaging', label: 'Messaging', pageId: 'messagingContentPage' },
  { name: 'assets', label: 'Assets', pageId: 'assetsPage' },
  { name: 'builder', label: 'Builder', pageId: 'developPage' },
  { name: 'campaigns', label: 'Campaigns', pageId: 'campaignsPage' },
  { name: 'promote', label: 'Promote', pageId: 'promoteSocialPage' },
  { name: 'observe', label: 'Observe', pageId: 'observePage' },
  { name: 'engage', label: 'Engage', pageId: 'engageCommentResponsesPage' },
  { name: 'training', label: 'Training', pageId: 'trainingKnowledgebasePage' },
  { name: 'settings', label: 'Settings', pageId: 'settingsApisPage' },
  { name: 'help', label: 'Help', pageId: 'docsPage' },
  { name: 'dev', label: 'Dev', pageId: 'devTasksPage' },
];

function selectedSections() {
  const only = String(process.env.STARCASTER_SCREENSHOTS || '').trim();
  if (!only) return SECTIONS;
  const wanted = new Set(only.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean));
  return SECTIONS.filter((section) => (
    wanted.has(section.name.toLowerCase())
    || wanted.has(section.label.toLowerCase())
    || wanted.has(section.pageId.toLowerCase())
  ));
}

async function maybeLogin(page, baseUrl) {
  const sessionToken = String(process.env.STARCASTER_SESSION_TOKEN || '').trim();
  if (sessionToken) {
    const parsed = new URL(baseUrl);
    await page.context().addCookies([{
      name: 'app_session',
      value: sessionToken,
      domain: parsed.hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      secure: parsed.protocol === 'https:',
    }]);
  }

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  const appVisible = await page.locator('#appShell:not(.hidden)').count();
  if (appVisible) return;

  const email = String(process.env.STARCASTER_EMAIL || '').trim();
  const password = String(process.env.STARCASTER_PASSWORD || '');
  if (!email || !password) {
    throw new Error(
      'StarCaster is showing the login screen. Set STARCASTER_EMAIL and STARCASTER_PASSWORD, '
      + 'or run once with a persistent profile that is already logged in.'
    );
  }

  await page.locator('#authLoginForm input[name="email"]').fill(email);
  await page.locator('#authLoginForm input[name="password"]').fill(password);
  await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/auth/login')).catch(() => null),
    page.locator('#authLoginForm button[type="submit"]').click(),
  ]);
  await page.locator('#appShell:not(.hidden)').waitFor({ timeout: 15000 });
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function activatePage(page, pageId) {
  await page.evaluate(async (targetPageId) => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (let i = 0; i < 100; i += 1) {
      if (window.App && typeof window.App.setActivePage === 'function') break;
      await wait(100);
    }
    if (!window.App || typeof window.App.setActivePage !== 'function') {
      throw new Error('App.setActivePage is unavailable.');
    }
    window.App.setActivePage(targetPageId, { persist: false });
  }, pageId);
  await page.locator(`#${pageId}:not(.hidden)`).waitFor({ timeout: 15000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(900);
}

async function captureSection(page, section) {
  await activatePage(page, section.pageId);
  await page.evaluate(() => window.scrollTo(0, 0));
  const filename = `${String(section.name).padStart(2, '0')}.png`;
  const filepath = path.join(OUT_DIR, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  return {
    ...section,
    file: filepath,
    publicPath: PUBLIC_PREFIX ? `${PUBLIC_PREFIX}/${filename}` : null,
  };
}

async function main() {
  const baseUrl = String(process.env.STARCASTER_URL || DEFAULT_URL).replace(/\/$/, '');
  const sections = selectedSections();
  if (!sections.length) throw new Error('No screenshot sections matched STARCASTER_SCREENSHOTS.');

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(USER_DATA_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: process.env.HEADLESS !== 'false',
    viewport: {
      width: Number(process.env.SCREENSHOT_WIDTH || 1440),
      height: Number(process.env.SCREENSHOT_HEIGHT || 1000),
    },
    deviceScaleFactor: Number(process.env.SCREENSHOT_SCALE || 1),
  });

  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    await maybeLogin(page, baseUrl);
    const manifest = [];
    for (const section of sections) {
      const item = await captureSection(page, section);
      manifest.push(item);
      console.log(`Captured ${item.label}: ${path.relative(ROOT, item.file)}`);
    }
    await fs.writeFile(
      path.join(OUT_DIR, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    );
    console.log(`Wrote ${path.relative(ROOT, path.join(OUT_DIR, 'manifest.json'))}`);
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
