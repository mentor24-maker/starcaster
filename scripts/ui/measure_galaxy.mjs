#!/usr/bin/env node
/**
 * Measure the Galaxy module's cost in a real browser: frames per second and
 * main-thread CPU over ten seconds, on a desktop-sized window and on a phone
 * emulated with Chrome's 4× CPU throttle, plus the CPU it costs once it has
 * paused out of view (Galaxy module 6/6, task 86bc7f5hp).
 *
 *   PORT=3061 node server.js
 *   UI_HARNESS_BASE_URL=http://localhost:3061 node scripts/ui/measure_galaxy.mjs [--headless] [--seconds 10]
 *
 * Headed by default: a headless browser draws a canvas without the GPU and
 * frames without a display, so its numbers describe a machine nobody browses
 * on. The table it prints is the one in docs/GALAXY.md, "Performance".
 *
 * CPU is Chrome's own `TaskDuration` (time the page's main thread spent
 * busy) over wall time — the tab's share of one core. Frames are the
 * runtime's own `data-galaxy-frame` counter, so a frame is a drawn frame.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_URL, ensureBuildIsCurrent } from './app-driver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium } = require('playwright');
const { createEmptyModule } = require(path.join(ROOT, 'lib/builder/template.js'));

const args = process.argv.slice(2);
const HEADLESS = args.includes('--headless');
const secondsAt = args.indexOf('--seconds');
const SECONDS = secondsAt >= 0 ? Number(args[secondsAt + 1]) || 10 : 10;
const DRAFT_KEY = 'starcaster_builder_preview_draft';

function galaxyDoc(settings) {
  const base = createEmptyModule('galaxy', 'main');
  const spacer = (side, i) => ({
    id: `spacer-${side}-${i}`, title: `Spacer ${side}`, layout: 'single', locked: false, alignment: 'left',
    widthMode: 'contained', minHeight: '900',
    modules: [{ ...createEmptyModule('heading', 'main'), id: `h-${side}-${i}`, text: `Spacer ${side} ${i}` }],
  });
  return {
    name: 'Galaxy measurement',
    layoutSections: [
      {
        id: 'galaxy-measure', title: 'Galaxy', layout: 'single', locked: false, alignment: 'left', widthMode: 'full-width',
        modules: [{ ...base, id: 'galaxy-measure-module', settings: { ...base.settings, ...settings } }],
      },
      spacer('after', 0), spacer('after', 1), spacer('after', 2),
    ],
  };
}

async function measure(page, cdp, seconds) {
  const read = () => page.evaluate(() => {
    const c = document.querySelector('canvas[data-galaxy-count]');
    return { frame: Number(c?.getAttribute('data-galaxy-frame')), count: c?.getAttribute('data-galaxy-count'),
      paused: c?.getAttribute('data-galaxy-paused'), budget: c?.getAttribute('data-galaxy-budget') };
  });
  const task = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value;
  const before = await read();
  const t0 = await task();
  const w0 = Date.now();
  await page.waitForTimeout(seconds * 1000);
  const after = await read();
  const t1 = await task();
  const wall = (Date.now() - w0) / 1000;
  return {
    stars: after.count, budget: after.budget, paused: after.paused,
    fps: Math.round(((after.frame - before.frame) / wall) * 10) / 10,
    cpu: Math.round(((t1 - t0) / wall) * 1000) / 10,
  };
}

async function scenario(browser, { name, viewport, mobile = false, throttle = 1, settings, scrollTo = 0 }) {
  const context = await browser.newContext({
    viewport, reducedMotion: 'no-preference',
    ...(mobile ? { deviceScaleFactor: 3, isMobile: true, hasTouch: true } : {}),
  });
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(`${BASE_URL}/builder-preview.html?live=1`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [DRAFT_KEY, JSON.stringify(galaxyDoc(settings))]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('canvas[data-galaxy-count]', { timeout: 20000 });
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  if (scrollTo) await page.evaluate((y) => window.scrollTo(0, y), scrollTo);
  await page.waitForTimeout(1500);
  const result = { name, ...(await measure(page, cdp, SECONDS)) };
  await context.close();
  return result;
}

await ensureBuildIsCurrent(BASE_URL);
const browser = await chromium.launch({ headless: HEADLESS });
const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };
const backdrop = { particleCount: '4000', intro: 'none' };
const block = { particleCount: '4000', intro: 'none', placement: 'inline', height: '600' };

const rows = [];
for (const s of [
  { name: 'Desktop, Window backdrop', viewport: desktop, settings: backdrop },
  { name: 'Desktop, Window backdrop scrolled away', viewport: desktop, settings: backdrop, scrollTo: 2400 },
  { name: 'Desktop, In Place 600px', viewport: desktop, settings: block },
  { name: 'Desktop, In Place scrolled out of view', viewport: desktop, settings: block, scrollTo: 2400 },
  { name: 'Phone (iPhone 14 emulated, 4× CPU throttle), Window', viewport: phone, mobile: true, throttle: 4, settings: backdrop },
  { name: 'Phone (iPhone 14 emulated, 4× CPU throttle), In Place', viewport: phone, mobile: true, throttle: 4, settings: block },
]) {
  rows.push(await scenario(browser, s));
  const r = rows[rows.length - 1];
  console.log(`${r.name}: ${r.stars} stars (${r.budget}), ${r.fps} fps, ${r.cpu}% CPU, paused=${r.paused}`);
}
await browser.close();

console.log(`\nMeasured ${new Date().toISOString().slice(0, 16).replace('T', ' ')}, ${SECONDS}s each, ${HEADLESS ? 'headless' : 'headed'} Chromium.\n`);
console.log('| Scenario | Stars | fps | CPU (main thread) | Paused |');
console.log('|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.name} | ${r.stars}${r.budget && r.budget !== 'full' ? ` (${r.budget})` : ''} | ${r.fps} | ${r.cpu}% | ${r.paused} |`);
