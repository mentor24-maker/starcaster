#!/usr/bin/env node
/**
 * Site Import capture smoke test — MANUAL, not part of `npm run
 * test:site-import` (CI has no browsers). Boots a throwaway local HTTP
 * server with a known page, runs the real Playwright provider against it
 * at desktop + mobile, re-keys element crops the way the worker will
 * (computeSourceId over domPath), pushes the result through the
 * normalizer, and fails loudly unless coverage.dropped is empty and the
 * form's screenshot crop joined onto its emitted element.
 *
 * Run:  npm run build:site-import && node scripts/site-import/smoke_capture.mjs
 * No credentials, no network beyond 127.0.0.1.
 */

import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PlaywrightCaptureProvider, VIEWPORTS, DEFAULT_USER_AGENT } =
  require('../../lib/site-import/dist/capture-playwright.js');
const { normalizeSite, computeSourceId } =
  require('../../lib/site-import/dist/normalize.js');

const PAGE = `<!DOCTYPE html>
<html lang="en"><head><title>Smoke Test Site</title>
<meta name="description" content="Local capture smoke test">
<link rel="canonical" href="/">
<style>
  body { margin: 0; font-family: Arial, sans-serif; }
  .hero { background-color: rgb(13, 148, 136); padding: 40px; }
  .hero h1 { color: rgb(255, 255, 255); font-size: 40px; }
</style></head>
<body>
<div id="page">
  <header><nav><ul>
    <li><a href="/">Home</a></li>
    <li><a href="/about">About</a></li>
  </ul></nav></header>
  <main>
    <section class="hero">
      <h1>Smoke Test Headline</h1>
      <p>A paragraph with an <a href="/inline">inline link</a> inside it.</p>
    </section>
    <section class="content">
      <h2>Second Section</h2>
      <div>Bare text run in a div.</div>
      <img src="/pixel.png" alt="One pixel">
      <form action="/submit"><input type="email" name="e"><input type="submit" value="Go"></form>
      <table><tr><td>A</td><td>B</td></tr></table>
    </section>
  </main>
  <footer><p>Footer text</p></footer>
</div>
</body></html>`;

// 1x1 transparent PNG.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

const server = http.createServer((req, res) => {
  if (req.url === '/pixel.png') {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(PIXEL);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
console.log(`Serving smoke page at ${base}`);

const provider = new PlaywrightCaptureProvider();
let failed = false;
try {
  const captureOpts = (label) => ({
    viewport: VIEWPORTS[label],
    timeoutMs: 30000,
    userAgent: DEFAULT_USER_AGENT,
  });
  const desktopRaw = await provider.capture(base, captureOpts('desktop'));
  const mobileRaw = await provider.capture(base, captureOpts('mobile'));

  // Worker-preview: upload step replaced by fake Blob paths; element crops
  // re-keyed from domPath to sourceId exactly as the worker will.
  const toCaptureResult = (raw, pageIdx) => ({
    url: raw.url,
    finalUrl: raw.finalUrl,
    viewport: raw.viewport,
    html: raw.html,
    styles: raw.styles,
    assetUrls: raw.assetUrls,
    fontFamilies: raw.fontFamilies,
    meta: raw.meta,
    fullPageScreenshot: `fake/shots/p${pageIdx}.${raw.viewport}.full.png`,
    sectionScreenshots: Object.fromEntries(
      raw.screenshots.sections.map((s) => [String(s.index), `fake/shots/p${pageIdx}.s${s.index}.png`])
    ),
    elementScreenshots: Object.fromEntries(
      raw.screenshots.elements.map((e) => [
        computeSourceId(pageIdx, e.domPath),
        `fake/shots/p${pageIdx}.e-${e.domPath.replace(/[^a-z0-9]+/gi, '_')}.png`,
      ])
    ),
  });

  const { ir, coverage } = normalizeSite({
    jobId: 'smoke',
    sourceUrl: base,
    capturedAt: new Date().toISOString(),
    assets: [],
    pages: [{ desktop: toCaptureResult(desktopRaw, 0), mobile: toCaptureResult(mobileRaw, 0) }],
  });

  console.log('coverage:', JSON.stringify(coverage, null, 2));
  console.log('sections:', ir.pages[0].sections.map((s) => s.elements.map((e) => e.class).join(',')));
  console.log('navs:', JSON.stringify(ir.taxonomy.navs));
  console.log(
    'screenshot bytes: full=%d sections=%d crops=%d',
    desktopRaw.screenshots.fullPage.length,
    desktopRaw.screenshots.sections.length,
    desktopRaw.screenshots.elements.length
  );

  const check = (ok, label) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
    if (!ok) failed = true;
  };
  const elements = ir.pages[0].sections.flatMap((s) => s.elements);
  check(Object.keys(coverage.dropped).length === 0, 'coverage.dropped is empty');
  const form = elements.find((e) => e.class === 'form');
  check(Boolean(form && form.screenshot), 'form element crop joined by sourceId');
  const table = elements.find((e) => e.class === 'table');
  check(Boolean(table && table.screenshot), 'table element crop joined by sourceId');
  const h1 = elements.find((e) => e.class === 'heading');
  check(
    Boolean(h1 && h1.computedStyles['font-size'] === '40px'),
    'computed styles joined via data-scim (h1 font-size 40px)'
  );
  check(ir.taxonomy.navs.length === 1 && ir.taxonomy.navs[0].items.length === 2, 'nav extracted');
  check(
    desktopRaw.assetUrls.some((a) => a.url.endsWith('/pixel.png')),
    'img asset observed'
  );
  check(!ir.pages[0].sections.some((s) => s.elements.some((e) => e.html.includes('data-scim'))),
    'no data-scim markers in emitted HTML');
} finally {
  await provider.close();
  server.close();
}

process.exit(failed ? 1 : 0);
