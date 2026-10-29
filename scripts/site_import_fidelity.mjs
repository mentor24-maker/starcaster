#!/usr/bin/env node
/**
 * SITE IMPORT FIDELITY REPORT — what did this import lose? (task 86bctde11)
 *
 * For every imported page, and every section the capture recorded on it, puts
 * the ORIGINAL section's screenshot beside a photograph of the IMPORTED rows,
 * and lists under seven named categories each captured style the import did
 * not reproduce: background, decorative layers, shadows and glow, shapes,
 * column layout, text styling, and files downloaded but never placed.
 *
 * Read-only. The only thing it writes is its own report:
 * SiteImport/<jobId>/fidelity.html in Blob (plus the photographs beside it),
 * and a local copy in the temp folder.
 *
 * Why it exists: on 2026-10-27 the Alphire import "bears little resemblance"
 * to the original, and the only way to say what was lost was to look. Every
 * ticket in the site-import-fidelity epic is now measured with this instead.
 *
 * The judgement lives in lib/site-import/fidelity.ts (pure, tested in
 * scripts/site-import/fidelity.test.js). This file is the plumbing: load,
 * photograph, write.
 *
 * NEVER "NO DIFFERENCES" FOR SOMETHING IT COULD NOT SEE. A page with no
 * Builder page, or one the browser could not photograph, is CANNOT TELL; so is
 * a section no imported row carries; and on an import captured before the
 * capture recorded ::before/::after layers (task 86bctde48), decorative
 * layers are named as not measurable rather than counted as none.
 *
 * USAGE
 *   PORT=3061 node server.js                       # any local server of THIS checkout
 *   doppler run --config prd -- node scripts/site_import_fidelity.mjs --job <id> [--page /about/]
 *
 *   --base-url <url>   the local server to photograph through
 *                      (default $UI_HARNESS_BASE_URL, else http://localhost:3001)
 *   --readonly-db      read the job, pages and themes through PROD_DB_READONLY_URL
 *                      (Doppler `dev`), for a machine with no production keys.
 *                      Needs the local Supabase container running.
 *   --no-upload        write the local copy only
 *
 * EXIT
 *   0  report written; every page was found and photographed
 *   2  report written, but at least one page is CANNOT TELL (or it could not
 *      be uploaded) — it says which and why
 *   1  could not produce a report at all
 */
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { comparePixels, describeChange } from './ui/visual-diff.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'package.json'));

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const flagValue = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) { console.error(`${name} requires a value.`); process.exit(1); }
  return v;
};

const JOB_ID = flagValue('--job');
const PAGE_FILTER = flagValue('--page');
const BASE_URL = (flagValue('--base-url') || process.env.UI_HARNESS_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
const READONLY_DB = flag('--readonly-db');
const NO_UPLOAD = flag('--no-upload');
const PREVIEW_SLUG = 'site-import-fidelity-preview';

if (!JOB_ID) {
  console.error('Usage: node scripts/site_import_fidelity.mjs --job <id> [--page <path>] [--base-url <url>] [--readonly-db] [--no-upload]');
  process.exit(1);
}

let fidelity;
let mapLib;
try {
  fidelity = require('./lib/site-import/dist/fidelity.js');
  mapLib = require('./lib/site-import/dist/map.js');
} catch {
  console.error('lib/site-import/dist/ is missing — it is generated. Run `npm run build:site-import`.');
  process.exit(1);
}
const { rowToJob } = require('./lib/siteImportStore.js');
const { rowToPage } = require('./lib/builderPagesStore.js');
const { rowToTheme, orderDefaultThemeFirst } = require('./lib/builderThemesStore.js');
const sharp = require('sharp');

/* ---------------------------------------------------------------------------
 * Loading: the stores (production keys), or the read-only connection
 * ------------------------------------------------------------------------ */

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** psql in the local Supabase container against PROD_DB_READONLY_URL. The
 *  URL is handed over as PG* variables, so it never reaches argv or a log. */
function readonlyQuery(sql) {
  const url = new URL(process.env.PROD_DB_READONLY_URL);
  const env = {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.replace(/^\//, '') || 'postgres',
  };
  const dockerArgs = ['exec', '-i'];
  for (const key of Object.keys(env)) dockerArgs.push('-e', key);
  dockerArgs.push('supabase_db_starcaster', 'psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', '-');
  const out = execFileSync('docker', dockerArgs, {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 512,
    env: { ...process.env, ...env },
  }).trim();
  return out ? JSON.parse(out) : null;
}

function makeLoader() {
  if (READONLY_DB) {
    if (!process.env.PROD_DB_READONLY_URL) {
      throw new Error('--readonly-db needs PROD_DB_READONLY_URL — run through `doppler run --project starcaster --config dev --`.');
    }
    return {
      describe: 'production, read-only connection',
      async job(id) {
        if (!SAFE_ID.test(id)) throw new Error(`not a job id: ${id}`);
        const row = readonlyQuery(`select row_to_json(t) from app_site_import_jobs t where id = '${id}';`);
        return row ? rowToJob(row) : null;
      },
      async pages(ids) {
        const clean = ids.map(Number).filter((n) => Number.isInteger(n) && n > 0);
        if (!clean.length) return [];
        const rows = readonlyQuery(`select coalesce(json_agg(row_to_json(t)), '[]') from builder_landing_page t where id in (${clean.join(',')});`);
        return (rows || []).map(rowToPage);
      },
      async themes(projectId) {
        if (!SAFE_ID.test(projectId)) throw new Error(`not a project id: ${projectId}`);
        const rows = readonlyQuery(
          `select coalesce(json_agg(row_to_json(t) order by t.updated_at desc), '[]') from builder_themes t where project_id = '${projectId}';`
        ) || [];
        return orderDefaultThemeFirst(rows, rows.map(rowToTheme));
      },
    };
  }
  if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error('No Supabase credentials. Run through `doppler run --config prd --`, or add --readonly-db.');
  }
  if (/localhost|127\.0\.0\.1/.test(process.env.SUPABASE_URL)) {
    throw new Error('This is pointed at a local database, which holds no import jobs worth measuring. Use --readonly-db, or the prd config.');
  }
  const store = require('./lib/siteImportStore.js');
  const pagesStore = require('./lib/builderPagesStore.js');
  const themesStore = require('./lib/builderThemesStore.js');
  const must = (res, what) => {
    if (!res || res.ok === false) throw new Error(`${what}: ${res?.error || `status ${res?.status}`}`);
    return res.data;
  };
  let scope = null;
  return {
    describe: 'production, through the stores',
    async job(id) {
      const job = must(await store.getJob(id), 'load job');
      scope = { projectId: job.projectId, userId: job.ownerUserId || '' };
      return job;
    },
    async pages(ids) {
      const out = [];
      for (const id of ids) {
        const res = await pagesStore.getPage(id, scope);
        if (res.ok) out.push(res.data);
      }
      return out;
    },
    async themes() {
      return must(await themesStore.listThemes(500, scope), 'list themes');
    },
  };
}

/* ---------------------------------------------------------------------------
 * Pictures
 * ------------------------------------------------------------------------ */

async function fetchBuffer(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Busyness of each half, read off a 360px-wide copy so dithering and
 *  anti-aliasing do not count as content. */
async function sidesOf(png) {
  const raw = await sharp(png).resize({ width: 360 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return fidelity.sideBusyness({ data: raw.data, width: raw.info.width, height: raw.info.height, channels: raw.info.channels });
}

/** Exact pixel comparison (visual-diff.mjs) once both are the same size —
 *  the imported photo is stretched to the original's box first, because two
 *  renders of different heights are otherwise "1 of 1 changed". */
async function pixelVerdict(label, originalPng, importedPng) {
  const original = await sharp(originalPng).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = original.info;
  const imported = await sharp(importedPng).resize({ width, height, fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const before = { data: original.data, width, height, channels: original.info.channels };
  const after = { data: imported.data, width, height, channels: imported.info.channels };
  const importedMeta = await sharp(importedPng).metadata();
  return `${describeChange(label, comparePixels(before, after))} — original ${width}×${height}, import ${importedMeta.width}×${importedMeta.height}`;
}

/**
 * Photographs through the local server's builder-preview.html — the same
 * React render the Builder's own preview uses. The page and its theme are
 * handed to it by intercepting the two requests it makes for them, so it needs
 * no login, no project switch and no copy of production data in the local
 * database.
 */
async function openCamera() {
  const reach = await fetch(`${BASE_URL}/builder-preview.html`, { signal: AbortSignal.timeout(10000) }).catch((err) => ({ ok: false, status: err.message }));
  if (!reach.ok) {
    return { error: `no app answered at ${BASE_URL}/builder-preview.html (${reach.status}). Start one: PORT=3061 node server.js, then --base-url http://localhost:3061` };
  }
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const tab = await context.newPage();
  const state = { page: null, themes: [] };
  await tab.route('**/api/builder/landing-pages**', (route) =>
    route.fulfill({ json: { ok: true, pages: state.page ? [state.page] : [] } }));
  await tab.route('**/api/builder/themes**', (route) =>
    route.fulfill({ json: { ok: true, themes: state.themes, data: state.themes } }));
  let shot = 0;
  return {
    async photograph(pageRecord, layoutSections, themes, { fullPage = false } = {}) {
      state.page = { ...pageRecord, slug: PREVIEW_SLUG, layoutSections };
      state.themes = themes;
      shot += 1;
      await tab.goto(`${BASE_URL}/builder-preview.html?embed=1&slug=${PREVIEW_SLUG}&shot=${shot}`, { waitUntil: 'domcontentloaded' });
      const found = await tab.waitForSelector('.builder-preview-section', { timeout: 20000 }).then(() => true, () => false);
      if (!found) throw new Error('the preview rendered no section');
      await tab.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await tab.waitForTimeout(800);
      if (fullPage) return tab.screenshot({ fullPage: true });
      // Just the rows. The page shell is at least a screen tall and is a grid,
      // so it stretched the last row until every photo was 900px. Release the
      // WRAPPERS only — a row's own minimum height is what Builder renders.
      const clip = await tab.evaluate(async () => {
        let wrapper = document.querySelector('.builder-preview-section')?.parentElement;
        for (; wrapper; wrapper = wrapper.parentElement) wrapper.style.setProperty('min-height', '0', 'important');
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const boxes = Array.from(document.querySelectorAll('.builder-preview-section'))
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0 && r.height > 0);
        if (!boxes.length) return null;
        const top = Math.min(...boxes.map((r) => r.top)) + window.scrollY;
        const bottom = Math.max(...boxes.map((r) => r.bottom)) + window.scrollY;
        return { x: 0, y: Math.max(0, top), width: document.documentElement.clientWidth, height: Math.max(1, bottom - top) };
      });
      if (!clip) throw new Error('the imported rows rendered with no size');
      return tab.screenshot({ clip, fullPage: true });
    },
    close: () => browser.close(),
  };
}

/* ---------------------------------------------------------------------------
 * The report
 * ------------------------------------------------------------------------ */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const labelOf = Object.fromEntries(fidelity.FIDELITY_CATEGORIES.map((c) => [c.key, c.label]));

function findingsHtml(findings, notMeasured) {
  const groups = fidelity.FIDELITY_CATEGORIES.map((c) => ({
    ...c,
    items: findings.filter((f) => f.category === c.key),
    blind: notMeasured.filter((n) => n.category === c.key),
  })).filter((g) => g.items.length || g.blind.length);
  if (!groups.length) return '<p class="none">Nothing lost in the measured categories.</p>';
  return groups.map((g) => `
    <h4>${esc(g.label)}</h4>
    <ul>${g.items.map((f) => `<li><b>Original:</b> ${esc(f.what)}<br><b>Import:</b> ${esc(f.imported)}</li>`).join('')}
    ${g.blind.map((n) => `<li class="blind"><b>CANNOT TELL:</b> ${esc(n.why)}</li>`).join('')}</ul>`).join('');
}

function pair(originalUrl, importedUrl, importedNote) {
  return `<div class="pair">
    <figure><figcaption>Original</figcaption>${originalUrl ? `<img loading="lazy" src="${esc(originalUrl)}">` : '<p class="blind">No screenshot was captured.</p>'}</figure>
    <figure><figcaption>Import</figcaption>${importedUrl ? `<img loading="lazy" src="${esc(importedUrl)}">` : `<p class="blind">CANNOT TELL — ${esc(importedNote || 'not photographed')}</p>`}</figure>
  </div>`;
}

/** Sections this report could not judge for decorations — an import captured
 *  before task 86bctde48. Zero there is "not looked at", never "none". */
function decorativeBlind(pages) {
  return pages.flatMap((p) => p.sections || []).filter((s) => (s.notMeasured || []).some((n) => n.category === 'decorative')).length;
}

function renderReport({ job, pages, totals, generatedAt }) {
  const blindDecor = decorativeBlind(pages);
  const summary = fidelity.FIDELITY_CATEGORIES.map((c) =>
    `<tr><td>${esc(c.label)}</td><td>${c.key === 'decorative' && blindDecor ? `${totals[c.key]} — and CANNOT TELL on ${blindDecor} section(s) captured before layers were recorded` : totals[c.key]}</td></tr>`).join('');
  const body = pages.map((p) => `
  <section class="page">
    <h2>${esc(p.path)} <small>${p.status === 'cannot-tell' ? `<span class="blind">CANNOT TELL — ${esc(p.reason)}</span>` : `Builder page ${esc(p.builderPageId)}`}</small></h2>
    ${p.fullPair ? `<details><summary>Whole page</summary>${p.fullPair}</details>` : ''}
    ${p.pageFindings.length ? `<div class="findings">${findingsHtml(p.pageFindings, [])}</div>` : ''}
    ${p.sections.map((s) => `
    <article>
      <h3>Section ${esc(s.sourceId)} <small>${s.status === 'cannot-tell' ? `<span class="blind">CANNOT TELL — ${esc(s.reason)}</span>` : `rows ${esc(s.builderRowIds.join(', '))}`}</small></h3>
      ${pair(s.originalUrl, s.importedUrl, s.photoNote)}
      ${s.pixels ? `<p class="pixels">${esc(s.pixels)}</p>` : ''}
      ${s.status === 'cannot-tell' ? '' : `<div class="findings">${findingsHtml(s.findings, s.notMeasured)}</div>`}
    </article>`).join('')}
  </section>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Import fidelity — ${esc(job.sourceUrl)}</title>
<style>
body{font:14px/1.5 -apple-system,system-ui,sans-serif;margin:24px;color:#111;background:#f6f6f4}
h1{margin:0 0 4px} .meta{color:#555;margin:0 0 16px}
table{border-collapse:collapse;margin:8px 0 24px;background:#fff} td{border:1px solid #ddd;padding:4px 10px}
.page{background:#fff;border:1px solid #ddd;border-radius:8px;padding:16px;margin:0 0 28px}
article{border-top:1px solid #eee;padding-top:12px;margin-top:12px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}
figure{margin:0} figcaption{font-weight:600;margin-bottom:4px} figure img{width:100%;border:1px solid #ccc}
h4{margin:10px 0 2px} ul{margin:0;padding-left:20px} li{margin:4px 0}
.blind{color:#9a5b00;font-weight:600} .none{color:#2f6b2f} .pixels{color:#666;font-size:12px}
small{font-weight:400;color:#666;font-size:13px}
</style></head><body>
<h1>What the import lost</h1>
<p class="meta">${esc(job.sourceUrl)} · job ${esc(job.id)} · project ${esc(job.projectId)} · generated ${esc(generatedAt)}</p>
<p>Each section of the original sits beside the same section as imported, with every captured style the import did not reproduce listed underneath by category. It measures; it fixes nothing. <b>CANNOT TELL</b> means it could not look — never that nothing was lost.</p>
<table><tr><td><b>Category</b></td><td><b>Things lost (all pages)</b></td></tr>${summary}</table>
${body}
</body></html>`;
}

/* ---------------------------------------------------------------------------
 * Main
 * ------------------------------------------------------------------------ */

const keyOfPath = (p) => String(p || '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'home';

async function main() {
  const loader = makeLoader();
  console.log(`Reading: ${loader.describe}`);
  const job = await loader.job(JOB_ID);
  if (!job) throw new Error(`No import job ${JOB_ID}.`);
  const irUrl = job.checkpoints?.normalize?.blobPath;
  if (!irUrl) throw new Error('This job has no normalize checkpoint — it never finished capturing.');
  const ir = JSON.parse((await fetchBuffer(irUrl)).toString('utf8'));
  const pageIds = job.checkpoints?.map?.pageIds || {};
  console.log(`Job:     ${job.id} (${job.sourceUrl}), project ${job.projectId}`);

  // The same keys the mapper wrote pages under (map.ts, pageWriteKey).
  const { kept } = mapLib.dropRepeatCaptures(ir.pages || []);
  const seen = new Map();
  const irPages = kept.map((page) => {
    const n = (seen.get(page.path) || 0) + 1;
    seen.set(page.path, n);
    return { page, key: mapLib.pageWriteKey(page.path, n) };
  }).filter(({ page }) => !PAGE_FILTER || page.path.replace(/\/+$/, '') === PAGE_FILTER.replace(/\/+$/, ''));
  if (!irPages.length) throw new Error(PAGE_FILTER ? `No captured page has the path ${PAGE_FILTER}.` : 'The IR has no pages.');

  const builderPages = await loader.pages(irPages.map(({ key }) => pageIds[key]).filter(Boolean));
  const themes = await loader.themes(job.projectId);

  const camera = await openCamera();
  if (camera.error) console.log(`Camera:  CANNOT TELL — ${camera.error}`);

  const upload = NO_UPLOAD ? null : (() => {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
    const { uploadBufferToBlobAtPath } = require('./lib/blobStorage.js');
    return async (pathname, buffer, mimeType) => {
      const res = await uploadBufferToBlobAtPath({ pathname, mimeType, fileBuffer: buffer });
      if (!res.ok) throw new Error(`upload ${pathname}: ${res.error || res.status}`);
      return res.data.location;
    };
  })();
  const outDir = path.join(os.tmpdir(), `site-import-fidelity-${job.id}`);
  mkdirSync(outDir, { recursive: true });
  /** Where a photo goes: Blob when uploading, else beside the local report. */
  const keep = async (relPath, png) => {
    if (upload) return upload(`SiteImport/${job.id}/fidelity/${relPath}`, png, 'image/png');
    const file = path.join(outDir, relPath);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, png);
    return relPath;
  };

  const surfaceColors = [
    ...(ir.styleSummary?.pageBackgrounds || []).map((t) => fidelity.hexOf(t.value)),
  ].filter(Boolean);

  const reportPages = [];
  const allFindings = [];
  let blindPages = 0;
  for (const { page: irPage, key } of irPages) {
    const builderPageId = pageIds[key];
    const builderPage = builderPages.find((p) => String(p.id) === String(builderPageId));
    const entry = { path: key, builderPageId, status: 'compared', reason: '', sections: [], pageFindings: [], fullPair: '' };
    reportPages.push(entry);
    if (!builderPage) {
      Object.assign(entry, fidelity.pageVerdict({ builderPageId, builderPageFound: false, cameraError: '', sectionsWithRows: 0, photographed: 0 }));
      blindPages += 1;
      console.log(`  ${key}  CANNOT TELL — ${entry.reason}`);
      continue;
    }
    const theme = themes.find((t) => t.id === builderPage.themeId) || themes[0] || null;
    const themeText = fidelity.themeTextOf(theme);
    const pageSurfaces = [...surfaceColors, String(theme?.typography?.palette?.surface || '').toLowerCase()].filter(Boolean);
    const rows = builderPage.layoutSections || [];

    if (!camera.error) {
      try {
        const full = await camera.photograph(builderPage, rows, themes, { fullPage: true });
        entry.fullPair = pair(irPage.screenshots?.desktop || '', await keep(`${keyOfPath(key)}/page.png`, full), '');
      } catch (err) {
        entry.fullPair = pair(irPage.screenshots?.desktop || '', '', err.message);
      }
    }

    let photographed = 0;
    let sectionsWithRows = 0;
    for (const section of irPage.sections || []) {
      const sectionRows = fidelity.rowsForSection(section.sourceId, rows);
      const s = { sourceId: section.sourceId, originalUrl: section.screenshot || '', importedUrl: '', photoNote: '', pixels: '' };
      let originalPng = null;
      let originalSides = null;
      let sectionWidth = 1440;
      if (s.originalUrl) {
        try {
          originalPng = await fetchBuffer(s.originalUrl);
          originalSides = await sidesOf(originalPng);
          sectionWidth = (await sharp(originalPng).metadata()).width || 1440;
        } catch (err) {
          s.photoNote = `the original screenshot could not be read (${err.message})`;
        }
      }
      let importedSides = null;
      if (sectionRows.length) sectionsWithRows += 1;
      if (!sectionRows.length) {
        s.photoNote = 'no imported row to photograph';
      } else if (camera.error) {
        s.photoNote = camera.error;
      } else {
        try {
          const png = await camera.photograph(builderPage, sectionRows, themes);
          s.importedUrl = await keep(`${keyOfPath(key)}/${section.sourceId}.png`, png);
          importedSides = await sidesOf(png);
          photographed += 1;
          if (originalPng) s.pixels = await pixelVerdict(`section ${section.sourceId}`, originalPng, png);
        } catch (err) {
          s.photoNote = `the browser could not photograph it: ${err.message}`;
        }
      }
      const comparison = fidelity.compareSection(section, {
        rows,
        theme: themeText,
        surfaceColors: pageSurfaces,
        sides: { original: originalSides, imported: importedSides },
        sectionWidth,
      });
      entry.sections.push({ ...s, ...comparison });
      allFindings.push(...comparison.findings);
    }
    // Layers whose owner sits outside every section (a page wrapper).
    for (const finding of fidelity.decorationFindings(irPage.decorations)) {
      entry.pageFindings.push(finding);
      allFindings.push(finding);
    }
    for (const { finding } of fidelity.unplacedAssets(ir.assets || [], irPage.url, JSON.stringify(builderPage))) {
      entry.pageFindings.push(finding);
      allFindings.push(finding);
    }
    Object.assign(entry, fidelity.pageVerdict({
      builderPageId, builderPageFound: true, cameraError: camera.error || '', sectionsWithRows, photographed,
    }));
    if (entry.status === 'cannot-tell') blindPages += 1;
    const counts = fidelity.countByCategory([...entry.pageFindings, ...entry.sections.flatMap((x) => x.findings)]);
    const blindSections = entry.sections.filter((x) => x.status === 'cannot-tell').length;
    console.log(`  ${key}  ${entry.status === 'cannot-tell' ? `CANNOT TELL (${entry.reason}) — ` : ''}` +
      `${Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ') || 'nothing lost in the measured categories'}` +
      `${blindSections ? `; ${blindSections} section(s) CANNOT TELL` : ''}`);
  }
  if (!camera.error) await camera.close();

  const totals = fidelity.countByCategory(allFindings);
  const html = renderReport({ job, pages: reportPages, totals, generatedAt: new Date().toISOString() });
  const localFile = path.join(outDir, 'fidelity.html');
  writeFileSync(localFile, html);
  let link = localFile;
  let uploadNote = '';
  if (upload) {
    link = await upload(`SiteImport/${job.id}/fidelity.html`, Buffer.from(html), 'text/html; charset=utf-8');
  } else {
    uploadNote = NO_UPLOAD ? 'not uploaded (--no-upload)' : 'NOT UPLOADED — BLOB_READ_WRITE_TOKEN is missing';
  }

  console.log('\nThings lost, all pages:');
  for (const c of fidelity.FIDELITY_CATEGORIES) {
    const n = totals[c.key];
    const blindDecor = c.key === 'decorative' ? decorativeBlind(reportPages) : 0;
    console.log(`  ${labelOf[c.key].padEnd(40)} ${n}${blindDecor ? ` — and CANNOT TELL on ${blindDecor} section(s): captured before ::before/::after layers were recorded` : ''}`);
  }
  if (blindPages) console.log(`\n${blindPages} page(s) CANNOT TELL — see the report; that is not "no differences".`);
  console.log(`\nReport: ${link}${uploadNote ? `  (${uploadNote}; local copy)` : ''}`);
  process.exit(blindPages || uploadNote.startsWith('NOT') ? 2 : 0);
}

main().catch((err) => {
  console.error(`\nNo report: ${err.message}`);
  process.exit(1);
});
