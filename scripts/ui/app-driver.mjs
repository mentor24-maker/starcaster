/**
 * Drive the admin app in a real browser — the shared plumbing every UI
 * check sits on.
 *
 * WHY THIS EXISTS
 * Reading the CSS is not enough to know what a screen looks like. On
 * 2026-08-09/10 four separate layout bugs were diagnosed wrongly from the
 * source and only fell out once the running app was measured: the Pages
 * table's `width: max-content`, the nav overflowing by 53px, the header's
 * unshrinkable logo, and a bulk toolbar whose `text-align: right` was being
 * silently outranked. Every one cost a round trip because there was no
 * standing way to open a screen and measure it. This is that way.
 *
 * SAFETY
 * Refuses any base URL that is not localhost. These checks click real
 * buttons; pointing them at production would act on live tenant data.
 *
 * THE TRAP THIS ENCODES
 * The admin app is a single page: every screen exists in the DOM at once
 * and all but one carry `hidden`. An unscoped `document.querySelector` in a
 * check therefore measures some other screen's markup and reports a
 * confident pass. `activeSection()` is the only correct root for a query,
 * and `revealPanels()` only ever opens things inside it.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium } = require('playwright');

export const BASE_URL = process.env.UI_HARNESS_BASE_URL || 'http://localhost:3001';
/** Local dev credentials. Not secrets — the harness refuses non-localhost. */
const EMAIL = process.env.UI_HARNESS_EMAIL || 'mentor24@gmail.com';
const PASSWORD = process.env.UI_HARNESS_PASSWORD || 'localdev123';

export const FIXTURE_PROJECT_NAME = process.env.UI_HARNESS_PROJECT || 'UI Harness Fixture';

function assertLocal(url) {
  const { hostname } = new URL(url);
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    throw new Error(
      `Refusing to drive ${hostname}. This harness clicks real controls; it only runs against localhost. ` +
      'Start the app with `npm run dev`.'
    );
  }
}

/**
 * ARE WE MEASURING THIS CHECKOUT'S BUILD?
 *
 * Two ways to be looking at the wrong app, both of which cost real time on
 * 2026-08-15 and neither of which looks like an environment problem from the
 * output:
 *
 *  1. `public/builder-bundle.js` on disk is older than the source it comes
 *     from. The server has no build step — it serves whatever file is there —
 *     so the browser gets the LAST build, not your change.
 *  2. BASE_URL points at another checkout's server. In a worktree this is the
 *     default: 3001 is wherever `npm run dev` happened to be started, which is
 *     usually the main folder. The harness then drives someone else's code and
 *     reports the result as yours.
 *
 * Both surface downstream as an assertion that makes no sense — on 2026-08-15
 * as "No panels carrying `.is-lattice` were found", which reads as "the
 * navigation broke" and sent the investigation into the check itself. The
 * bundle was simply stale; one `npm run build:builder` fixed it.
 *
 * Comparing the SERVED bytes to the LOCAL bytes catches both at once, and
 * catches them before a browser opens.
 */
let freshnessCheck = null;

/** Memoised: launch() runs once per width, and the answer cannot change mid-run. */
function assertServingThisCheckout(baseUrl) {
  if (!freshnessCheck) freshnessCheck = checkServingThisCheckout(baseUrl);
  return freshnessCheck;
}

/**
 * The built files the harness drives. A missing or stale one is not a subtle
 * problem: app-shell.html IS the admin app, so without it the browser gets a
 * 404 and every later assertion measures an empty page.
 */
const REQUIRED_ARTIFACTS = [
  {
    file: 'public/app-shell.html',
    sources: ['src/layout.html', 'src/pages'],
    rebuild: 'npm run build:html',
    note: 'this file IS the admin app; without it the browser loads nothing to measure',
  },
  {
    file: 'public/builder-bundle.js',
    sources: ['components', 'lib/builder-client', 'builder-react-entry.tsx'],
    rebuild: 'npm run build:builder',
    note: 'the Builder UI',
  },
  {
    file: 'public/styles.css',
    sources: ['src/css'],
    rebuild: 'npm run build:css',
    note: 'every width this harness measures comes from here',
  },
];

async function checkServingThisCheckout(baseUrl) {
  const missing = [];
  const stale = [];

  for (const artifact of REQUIRED_ARTIFACTS) {
    const full = path.join(ROOT, artifact.file);
    let built;
    try {
      built = (await stat(full)).mtimeMs;
    } catch {
      missing.push(artifact);
      continue;
    }
    if ((await newestMtime(artifact.sources)) > built) stale.push(artifact);
  }

  if (missing.length) {
    throw new Error(
      'This checkout has not been built — the harness drives the BUILT app, not the source.\n\n' +
      missing.map((a) => `  missing: ${a.file}  (${a.note})`).join('\n') +
      '\n\nRun `npm run build` once in this folder.\n' +
      'A fresh worktree only gets `npm run build:assets`, which does not produce these.\n' +
      'On 2026-08-15 the missing file was app-shell.html, and the check reported it as\n' +
      '"No panels carrying `.is-lattice` were found" — which reads like the navigation\n' +
      'broke and sent the investigation into the check itself.'
    );
  }

  if (stale.length) {
    throw new Error(
      'Built files are OLDER than the source they come from.\n' +
      'The dev server has no build step — it serves the file on disk — so the browser\n' +
      'would load your PREVIOUS build and every measurement would describe code you\n' +
      'are not testing.\n\n' +
      stale.map((a) => `  stale: ${a.file}  →  ${a.rebuild}`).join('\n') + '\n'
    );
  }

  // The bundle is the cheapest byte-for-byte proof that the server on this
  // port is THIS folder's. In a worktree, 3001 is usually the main checkout.
  const local = await readFile(path.join(ROOT, 'public', 'builder-bundle.js'));
  let served;
  try {
    const res = await fetch(`${baseUrl}/builder-bundle.js`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    served = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    throw new Error(
      `Could not fetch ${baseUrl}/builder-bundle.js (${e.message}).\n` +
      'Is the app running? Start it with `npm run dev` in this folder.'
    );
  }

  const digest = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 12);
  if (digest(served) !== digest(local)) {
    throw new Error(
      `The app at ${baseUrl} is serving a DIFFERENT build than this checkout.\n` +
      `  served: ${digest(served)}   this folder: ${digest(local)}\n\n` +
      "Almost always this means another worktree's `npm run dev` owns that port,\n" +
      'so the harness would drive that folder\'s code and report it as yours.\n\n' +
      "Start this folder's own server on its own port and point the harness at it:\n" +
      '  PORT=3009 npm run dev\n' +
      '  UI_HARNESS_BASE_URL=http://localhost:3009 npm run check:panels'
    );
  }
}

/** Newest mtime across a set of files and/or directories, 0 if none exist. */
async function newestMtime(targets) {
  let newest = 0;
  async function walk(target) {
    let info;
    try {
      info = await stat(target);
    } catch {
      return;
    }
    if (info.isFile()) {
      newest = Math.max(newest, info.mtimeMs);
      return;
    }
    if (!info.isDirectory()) return;
    for (const entry of await readdir(target, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      await walk(path.join(target, entry.name));
    }
  }
  for (const target of targets) await walk(path.join(ROOT, target));
  return newest;
}

export async function launch({ width = 1440, height = 1000, headless = true } = {}) {
  assertLocal(BASE_URL);
  try {
    await assertServingThisCheckout(BASE_URL);
  } catch (e) {
    // Printed and exited here rather than thrown on: every caller is a
    // top-level await, so a thrown error surfaces as a stack trace with the
    // explanation buried in it. This message IS the fix instructions.
    console.error(`\n[ui-harness] ${e.message}\n`);
    process.exit(2);
  }
  const browser = await chromium.launch({ headless });
  const page = await browser.newPage({ viewport: { width, height } });

  /**
   * Count throttled responses. A long sweep can exhaust the app's global
   * rate limit (500 requests), after which screens render half their data
   * and every measurement taken from then on describes a broken app while
   * looking exactly like a clean result. Callers must surface this — a
   * throttled run is not a valid run.
   */
  page.rateLimited = 0;
  page.on('response', (res) => { if (res.status() === 429) page.rateLimited += 1; });

  return { browser, page };
}

/**
 * Sign in and WAIT UNTIL IT TOOK. A fixed sleep after pressing Enter is not
 * enough: one browser in a multi-width run raced ahead and every later step
 * failed with "Not authenticated", killing the whole sweep. Poll for the
 * signed-in shell instead of guessing at a duration.
 */
export async function signIn(page, { timeoutMs = 30000 } = {}) {
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  // "No password field in the DOM" is the wrong test — the shell keeps them
  // on other screens. Only a *visible* one means we are still at the gate.
  const signedIn = () => page.evaluate(() => {
    const nav = document.querySelector('[data-page]');
    const visiblePassword = [...document.querySelectorAll('input[type="password"]')]
      .some((el) => el.offsetParent !== null);
    return !!nav && !visiblePassword;
  });

  if (await signedIn()) return false;

  const email = page.locator('input[type="email"], input[name="email"]').first();
  if (!(await email.count())) return false;
  await email.fill(EMAIL);
  const pw = page.locator('input[type="password"]').first();
  await pw.fill(PASSWORD);
  await pw.press('Enter');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    if (await signedIn()) return true;
  }
  throw new Error(`Sign-in as ${EMAIL} did not complete within ${timeoutMs}ms against ${BASE_URL}.`);
}

/**
 * Make a project active for the session. Most screens refuse to load data
 * without one and render an empty table, which measures as "fits" and means
 * nothing — the reason an early version of this sweep reported a hollow
 * pass on zero rows.
 */
export async function activateProject(page, projectId) {
  // Never throw: a project that will not activate should degrade to "screens
  // render empty", reported by the caller, not abort the whole sweep.
  const how = await page.evaluate(async (id) => {
    try {
      if (window.App?.projectContext?.switchSessionProject) {
        await window.App.projectContext.switchSessionProject(id, { keepView: true, refresh: true });
        return 'switchSessionProject';
      }
      const key = window.App?.CURRENT_PROJECT_ID_STORAGE_KEY || 'alphire.currentProjectId';
      window.localStorage.setItem(key, id);
      return 'localStorage';
    } catch (err) {
      return `failed: ${String(err && err.message || err).slice(0, 80)}`;
    }
  }, projectId);
  await page.waitForTimeout(4000);
  return how;
}

/** Click a top-level or submenu nav entry by its data-page id. */
export async function gotoScreen(page, pageId, { settleMs = 4000 } = {}) {
  const clicked = await page.evaluate((id) => {
    const el = document.querySelector(`[data-page="${id}"]`);
    if (!el) return false;
    el.click();
    return true;
  }, pageId);
  if (!clicked) return { ok: false, reason: `no nav entry [data-page="${pageId}"]` };
  await page.waitForTimeout(settleMs);
  const active = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('section.app-page')].find((s) => !s.classList.contains('hidden'));
    return sec ? sec.id || '(unnamed section)' : null;
  });
  return { ok: active === pageId, active };
}

/**
 * Open collapsed panels INSIDE the active screen so their tables lay out.
 * Two different mechanisms are in play: a `hidden` class, and Acquire's
 * `.youtube-miner-collapsible:not(.is-open)`.
 *
 * `revealSelfHidden` also un-hides toolbars that hide themselves until rows
 * are checked. Leave it off to measure the default view — with it on, two
 * mutually exclusive toolbars can be visible at once and the layout you
 * measure is one no user ever sees.
 */
export async function revealPanels(page, { revealSelfHidden = false } = {}) {
  return page.evaluate((opts) => {
    const sec = [...document.querySelectorAll('section.app-page')].find((s) => !s.classList.contains('hidden'));
    if (!sec) return null;
    sec.querySelectorAll('.youtube-miner-collapsible').forEach((el) => el.classList.add('is-open'));
    sec.querySelectorAll('.youtube-miner-collapsible-body, .studio-collapsible-body').forEach((el) => el.classList.remove('hidden'));
    const targets = sec.querySelectorAll('table, .crud-bulk-actions-row');
    targets.forEach((node) => {
      let el = opts.revealSelfHidden ? node : node.parentElement;
      while (el && el !== sec.parentElement) { el.classList.remove('hidden'); el = el.parentElement; }
    });
    return sec.id || '(unnamed section)';
  }, { revealSelfHidden });
}

/** Everything a layout check needs about the screen that is actually showing. */
export async function measureActiveScreen(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const sec = [...document.querySelectorAll('section.app-page')].find((s) => !s.classList.contains('hidden'));
    const viewport = doc.clientWidth;
    const out = {
      section: sec ? sec.id || '(unnamed)' : null,
      viewport,
      // Only the PAGE scrolling sideways violates T0. A table scrolling
      // inside its own container is T7 rung 12 — legal, and reported
      // separately so it is visible without being a failure.
      pageScrollsSideways: doc.scrollWidth > doc.clientWidth + 1,
      pageScrollWidth: doc.scrollWidth,
      tables: [],
      toolbars: [],
      overflowing: [],
    };
    if (!sec) return out;

    // A table with no id or class still has to be nameable, or the report
    // says "(unnamed table) scrolls 359px" and nobody can act on it. Fall
    // back to the nearest heading above it, then to its column headings.
    const describeTable = (tbl) => {
      if (tbl.id) return tbl.id;
      if (tbl.className) return String(tbl.className).slice(0, 46);
      let node = tbl;
      while (node && node !== sec) {
        let sib = node.previousElementSibling;
        while (sib) {
          const heading = sib.matches('h1,h2,h3,h4') ? sib : sib.querySelector('h1,h2,h3,h4');
          const text = heading && heading.textContent.trim();
          if (text) return `under "${text.slice(0, 34)}"`;
          sib = sib.previousElementSibling;
        }
        node = node.parentElement;
      }
      const cols = [...tbl.querySelectorAll('thead tr:last-child th')]
        .map((th) => th.textContent.trim()).filter(Boolean).slice(0, 3);
      return cols.length ? `columns: ${cols.join('/')}` : '(unnamed table)';
    };

    sec.querySelectorAll('table').forEach((tbl) => {
      const r = tbl.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const wrap = tbl.closest('.table-wrap, .table-shell');
      out.tables.push({
        id: describeTable(tbl),
        width: Math.round(r.width),
        containerWidth: wrap ? wrap.clientWidth : null,
        hiddenPx: wrap ? Math.max(0, wrap.scrollWidth - wrap.clientWidth) : 0,
        scrollsInContainer: !!(wrap && wrap.scrollWidth > wrap.clientWidth + 1),
        hasScrollContainer: !!wrap,
      });
    });

    sec.querySelectorAll('.crud-bulk-actions-row').forEach((row) => {
      const r = row.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const host = row.closest('th') || row.parentElement;
      const h = host.getBoundingClientRect();
      out.toolbars.push({
        id: row.id || row.className.replace('crud-bulk-actions-row', '').trim() || '(unnamed toolbar)',
        justify: getComputedStyle(row).justifyContent,
        gapToHostRight: Math.round(h.right - r.right),
        overflowsHost: Math.round(r.width) > Math.round(h.width) + 1,
      });
    });

    // Anything sticking out past the viewport, shallowest first — the
    // shallowest offender is almost always the actual cause.
    sec.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right <= viewport + 1) return;
      if (el.closest('.table-wrap, .table-shell')) return; // rung 12, not a violation
      let depth = 0, p = el;
      while ((p = p.parentElement)) depth += 1;
      out.overflowing.push({
        depth,
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').slice(0, 46),
        right: Math.round(r.right),
      });
    });
    out.overflowing.sort((a, b) => a.depth - b.depth);
    out.overflowing = out.overflowing.slice(0, 5);
    return out;
  });
}
