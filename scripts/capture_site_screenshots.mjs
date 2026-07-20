'use strict';

/**
 * capture_site_screenshots.mjs
 * ----------------------------
 * Take screenshots of one or more PUBLIC websites and save them as image
 * files you can drop into a video or slide deck. Runs on your own computer
 * (it uses the browser Playwright already installed), NOT on the live site.
 *
 * Usage:
 *   node scripts/capture_site_screenshots.mjs
 *       -> screenshots https://www.sofiachristensen.com (the default)
 *
 *   node scripts/capture_site_screenshots.mjs https://www.sofiachristensen.com https://example.com
 *       -> screenshots each address you list
 *
 * For every address it saves, into ./screenshots/ :
 *   - <name>-desktop-full.png  : the whole page, top to bottom (great for a scroll shot)
 *   - <name>-desktop-hero.png  : just the first screenful on a big monitor
 *   - <name>-mobile-full.png   : the whole page as it looks on a phone
 *
 * Images are captured at 2x ("retina") resolution so they stay crisp in HD video.
 */

import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

const DEFAULT_URLS = ['https://www.sofiachristensen.com'];
const OUT_DIR = path.resolve(process.cwd(), 'screenshots');

// How long to let a page settle after it loads, so fonts/images/animations
// finish before we take the picture (milliseconds).
const SETTLE_MS = 2500;

function slugForUrl(rawUrl) {
  const u = new URL(rawUrl);
  const host = u.hostname.replace(/^www\./, '');
  const pathPart = u.pathname.replace(/\/+$/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return pathPart ? `${host}-${pathPart}` : host;
}

async function captureOne(browser, rawUrl) {
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const slug = slugForUrl(url);
  console.log(`\nCapturing ${url}`);

  const shots = [
    {
      label: 'desktop-full',
      viewport: { width: 1920, height: 1080 },
      fullPage: true,
    },
    {
      label: 'desktop-hero',
      viewport: { width: 1920, height: 1080 },
      fullPage: false,
    },
    {
      label: 'mobile-full',
      viewport: { width: 390, height: 844 },
      fullPage: true,
      isMobile: true,
    },
  ];

  for (const shot of shots) {
    const context = await browser.newContext({
      viewport: shot.viewport,
      deviceScaleFactor: 2, // 2x = retina-crisp for HD video
      isMobile: Boolean(shot.isMobile),
      userAgent: shot.isMobile
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        : undefined,
    });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    } catch (_) {
      // networkidle can time out on sites that keep a connection open; fall back.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    }
    await page.waitForTimeout(SETTLE_MS);

    const outPath = path.join(OUT_DIR, `${slug}-${shot.label}.png`);
    await page.screenshot({ path: outPath, fullPage: shot.fullPage, type: 'png' });
    console.log(`  saved  ${path.relative(process.cwd(), outPath)}`);

    await context.close();
  }
}

async function main() {
  const urls = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_URLS;
  await fs.mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    for (const url of urls) {
      try {
        await captureOne(browser, url);
      } catch (err) {
        console.error(`  FAILED ${url}: ${err.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\nDone. Your images are in: ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
