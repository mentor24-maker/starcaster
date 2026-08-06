#!/usr/bin/env node
'use strict';
/**
 * Capture a real site into a committed test fixture (spec §Testing: the
 * three archetype fixtures are "captured once with the real provider, then
 * committed as JSON so tests run offline").
 *
 * Deliberately NOT the worker: no credentials, no database, no Blob — it
 * only reads the public site and writes a NormalizeInput-shaped JSON into
 * scripts/site-import/fixtures/. Screenshot binaries are discarded and
 * their fields left as placeholder strings; the snapshot tests exercise
 * parsing/normalization, not pixels. robots.txt is honored, always — a
 * fixture is never worth an unauthorized crawl.
 *
 * Usage:
 *   npm run build:site-import
 *   node scripts/site-import/capture_fixture.mjs <url> <fixtureName> [--pages N]
 * Then regenerate the expected snapshots and REVIEW the diff:
 *   UPDATE_SNAPSHOTS=1 npm run test:site-import
 */

import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const {
  PlaywrightCaptureProvider, VIEWPORTS, DEFAULT_USER_AGENT,
} = require('../../lib/site-import/dist/capture-playwright.js');
const {
  parseRobots, robotsVerdict, fetchSitemapUrls, extractLinks,
  normalizeCrawlUrl, CrawlQueue,
} = require('../../lib/site-import/dist/crawl.js');
const { computeSourceId } = require('../../lib/site-import/dist/normalize.js');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [rawUrl, fixtureName] = args;
const pagesFlag = process.argv.indexOf('--pages');
const MAX_PAGES = pagesFlag !== -1 ? Math.max(1, Number(process.argv[pagesFlag + 1]) || 2) : 2;

if (!rawUrl || !fixtureName || !/^[a-z0-9-]+$/.test(fixtureName)) {
  console.error('Usage: node scripts/site-import/capture_fixture.mjs <url> <fixture-name> [--pages N]');
  console.error('  fixture-name: lowercase-with-dashes, e.g. "wordpress"');
  process.exit(1);
}

const seed = normalizeCrawlUrl(rawUrl);
if (!seed) {
  console.error(`Not a crawlable URL: ${rawUrl}`);
  process.exit(1);
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': DEFAULT_USER_AGENT },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// robots.txt — no override path here on purpose; fixtures come only from
// sites that welcome crawlers.
let robots = parseRobots('');
try {
  robots = parseRobots(await fetchText(new URL(seed).origin + '/robots.txt'));
} catch { /* none */ }
const verdict = robotsVerdict(robots, DEFAULT_USER_AGENT, new URL(seed).pathname);
if (!verdict.allowed) {
  console.error(`robots.txt disallows crawling ${seed} (${verdict.rule}) — pick another fixture site.`);
  process.exit(1);
}

const queue = new CrawlQueue({ seedUrl: seed, maxPages: MAX_PAGES, maxDepth: 2 });
try {
  const sitemapUrls = await fetchSitemapUrls(fetchText, seed, {
    limit: MAX_PAGES * 2,
    robotsSitemaps: robots.sitemaps,
  });
  for (const url of sitemapUrls) queue.add(url, 0);
} catch { /* sitemap optional */ }

const provider = new PlaywrightCaptureProvider();
const pages = [];
const assetMap = new Map();
try {
  for (;;) {
    const item = queue.next();
    if (!item) break;
    const pageVerdict = robotsVerdict(robots, DEFAULT_USER_AGENT, new URL(item.url).pathname);
    if (!pageVerdict.allowed) continue;
    console.log(`capturing [${pages.length}] ${item.url}`);
    try {
      const pageIdx = pages.length;
      const raw = await provider.capture(item.url, {
        viewport: VIEWPORTS.desktop,
        timeoutMs: 45000,
        userAgent: DEFAULT_USER_AGENT,
      });
      // Fixture = the persisted CaptureResult shape with placeholder
      // screenshot paths (binaries discarded; tests don't look at pixels).
      const desktop = {
        url: raw.url,
        finalUrl: raw.finalUrl,
        viewport: raw.viewport,
        html: raw.html,
        styles: raw.styles,
        assetUrls: raw.assetUrls,
        fontFamilies: raw.fontFamilies,
        meta: raw.meta,
        fullPageScreenshot: `fixture://shots/p${pageIdx}.desktop.full.png`,
        sectionScreenshots: Object.fromEntries(
          raw.screenshots.sections.map((s) => [String(s.index), `fixture://shots/p${pageIdx}.s${s.index}.png`])
        ),
        elementScreenshots: Object.fromEntries(
          raw.screenshots.elements.map((e) => [
            computeSourceId(pageIdx, e.domPath),
            `fixture://shots/p${pageIdx}.e-${e.domPath.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.png`,
          ])
        ),
      };
      for (const ref of raw.assetUrls) {
        if (!assetMap.has(ref.url)) assetMap.set(ref.url, ref.alt || '');
      }
      for (const link of extractLinks(raw.html, raw.finalUrl || item.url)) {
        queue.add(link, item.depth + 1);
      }
      pages.push({ desktop });
      await new Promise((r) => setTimeout(r, 750)); // politeness
    } catch (err) {
      console.error(`  failed: ${err.message}`);
    }
  }
} finally {
  await provider.close();
}

if (!pages.length) {
  console.error('No pages captured — fixture not written.');
  process.exit(1);
}

const fixture = {
  __comment:
    `Real CaptureResult fixture captured from ${seed} with the Playwright provider ` +
    `(capture_fixture.mjs) — re-capture with that script rather than editing by hand. ` +
    'Screenshot paths are fixture:// placeholders; binaries are not committed.',
  jobId: `job-fixture-${fixtureName}`,
  sourceUrl: seed,
  capturedAt: new Date().toISOString(),
  assets: Array.from(assetMap.entries()).map(([url, alt], i) => ({
    id: `f${i + 1}`,
    originalUrl: url,
    storageUrl: '',
    contentHash: '',
    mimeType: '',
    byteSize: 0,
    altText: alt,
    referencedBy: [],
    status: 'pending',
    error: '',
  })),
  pageStats: { discovered: queue.discovered, captured: pages.length, failed: 0 },
  capsHit: [],
  pages,
};

const outPath = path.join(__dirname, 'fixtures', `${fixtureName}.json`);
writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n');
const kb = Math.round(JSON.stringify(fixture).length / 1024);
console.log(`Wrote ${outPath} (${pages.length} pages, ${assetMap.size} assets, ~${kb} KB)`);
console.log('Now: UPDATE_SNAPSHOTS=1 npm run test:site-import  — and review the snapshot diff.');
