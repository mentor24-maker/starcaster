/**
 * THE RENDER CHECK — measure what a module actually looks like on a page.
 *
 * WHY THIS EXISTS
 * `check:panels` measures panel geometry, which is the EDITOR. `check:css`
 * asks the browser which declarations survived, which is the STYLESHEET.
 * Between them sat every rendered module on every page, and that gap is where
 * the image effects died: Cruise and Tumbleweed were offered in two panels for
 * months with no stylesheet rule behind them, so the operator saw a still
 * picture and no error (docs/IMAGE_EFFECTS.md, "a class name is not a
 * rendering").
 *
 * THE SURFACE, AND WHY IT IS CHEAP
 * `public/builder-preview.html` is a plain static, UNAUTHENTICATED page that
 * renders a whole page document straight out of localStorage, through the same
 * React path the public site uses. So this needs no database, no login, no
 * seeded fixture and no clicking through the Builder — the harness writes a
 * document, reloads, and measures. Nothing here can collide with another
 * session's fixture, because there is no shared fixture.
 *
 *   PORT=3058 node server.js                                  # in another shell
 *   UI_HARNESS_BASE_URL=http://localhost:3058 npm run check:render
 *
 * READ THIS BEFORE WRITING AN ASSERTION ABOUT MOTION
 * `getComputedStyle(el).animationName` REPORTS ANIMATIONS THE ENGINE CANNOT
 * RUN. With `animation: real 5s, ghost 5s` where `ghost` has no keyframes, it
 * returns "real, ghost" while `el.getAnimations()` returns only ["real"]. The
 * obvious check — assert animationName is not "none" — would have passed the
 * dead Tumbleweed. Everything about motion here goes through getAnimations(),
 * and a name that is present but parked is caught by watching currentTime.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_URL, ensureBuildIsCurrent } from './app-driver.mjs';
import { RENDER_CONTRACTS } from './render-contracts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium } = require('playwright');

// lib/builder/template.js is a GENERATED artifact and a fresh worktree has
// none. Without this the run dies on a raw MODULE_NOT_FOUND stack that says
// nothing about which command produces it — the same trap check_panels names.
let createEmptyModule;
try {
  ({ createEmptyModule } = require(path.join(ROOT, 'lib/builder/template.js')));
} catch {
  console.error(
    '\n[check:render] lib/builder/template.js is missing — it is a generated file\n' +
    'and a fresh worktree does not have one.\n\n' +
    'Run `npm run build:builder-template`.\n'
  );
  process.exit(2);
}

/** The preview page reads its document from here (BUILDER_PREVIEW_STORAGE_KEY). */
const DRAFT_KEY = 'starcaster_builder_preview_draft';
const WIDTH = Number(process.env.UI_HARNESS_WIDTH || 1440);
/** Long enough for an animation's currentTime to move visibly past jitter. */
const SETTLE_MS = 600;

/** A whole page document carrying exactly one module. */
function documentFor(spec) {
  const base = createEmptyModule(spec.type, 'main');
  return {
    name: 'Render Contract',
    layoutSections: [{
      id: 'section-render-contract',
      title: 'Render Contract',
      layout: 'single',
      locked: false,
      alignment: 'left',
      widthMode: 'contained',
      modules: [{
        ...base,
        id: `module-render-contract-${spec.type}`,
        name: spec.type,
        text: spec.text ?? base.text ?? '',
        settings: { ...base.settings, ...(spec.settings || {}) },
      }],
    }],
  };
}

async function render(page, doc) {
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [DRAFT_KEY, JSON.stringify(doc)]);
  // NOT `networkidle`: the page runs animations and never goes idle, so it
  // times out after 30s having rendered perfectly. Wait for the module.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.builder-preview-module', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

/**
 * Everything a contract can assert on, sampled twice so motion is provable.
 */
function sample(page, selector, read, settleMs) {
  return page.evaluate(async ({ selector, read, settleMs }) => {
    const doc = document.documentElement;
    const modules = document.querySelectorAll('.builder-preview-module');
    const el = document.querySelector(selector);

    const page_ = {
      modules: modules.length,
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      corridors: document.querySelectorAll('.starcaster-effect-motion-clip').length,
    };
    if (!el) return { found: false, page: page_ };

    const readAnimations = () => el.getAnimations().map((a) => ({
      name: a.animationName,
      playState: a.playState,
      currentTime: Number(a.currentTime) || 0,
    }));

    const before = readAnimations();
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    const after = readAnimations();

    const cs = getComputedStyle(el);
    const styles = {};
    for (const prop of read) styles[prop] = cs[prop];

    const rect = el.getBoundingClientRect();
    return {
      found: true,
      page: page_,
      box: { width: Math.round(rect.width), height: Math.round(rect.height) },
      styles,
      animations: after,
      // Every animation moved. `.every` on an empty list is true, so callers
      // that care about motion must also check that animations exist —
      // otherwise "nothing is running" reads as "everything advanced".
      advanced: after.length > 0 && after.every((a, i) => a.currentTime > (before[i]?.currentTime ?? 0)),
      text: (el.textContent || '').trim().slice(0, 200),
      settleMs,
    };
  }, { selector, read, settleMs });
}

await ensureBuildIsCurrent(BASE_URL);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: WIDTH, height: 1000 },
  // PINNED, not inherited. Every effect stops under prefers-reduced-motion, so
  // without this the result depends on the machine's system settings and the
  // same commit passes on one laptop and fails on another.
  reducedMotion: 'no-preference',
});
// A font host must never decide a measurement: builder-preview.html pulls
// Google Fonts, so a laptop with network and a CI box without would measure
// different pixels and disagree forever.
await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());

const failures = [];
let measured = 0;

try {
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/builder-preview.html`, { waitUntil: 'domcontentloaded' });

  /*
   * R4 — "THE PAGE DOES NOT SCROLL SIDEWAYS" IS NOT ASSERTED HERE, AND THAT
   * IS A FINDING RATHER THAN AN OMISSION.
   *
   * It was written, and then removed after trying to break it on purpose and
   * WATCHING IT PASS. Three separate things make horizontal overflow
   * unmeasurable on this surface:
   *
   *   1. `.builder-preview-shell` carries `overflow-x: clip`, so it absorbs
   *      any module overflow before the page ever sees it. Disabling the
   *      corridor's own clip — the regression worth catching — changed the
   *      page width by exactly 0px.
   *   2. The preview harness's own admin chrome overflows by 2px with NO
   *      module on the page at all, so the document already "scrolls
   *      sideways" before anything is rendered.
   *   3. A travelling module sits hundreds of pixels off-screen ON PURPOSE
   *      mid-crossing (measured at left: -332px), which any naive overflow
   *      sweep reports as a violation.
   *
   * An assertion that cannot fail is worse than no assertion, because a green
   * run gets read as proof the case is covered. R4 belongs on the public-site
   * surface (`site.html`), where the page IS the shell and there is no device
   * frame clipping the answer. Filed separately rather than faked here.
   *
   * The baseline render below stays, doing the one honest job it can: proving
   * the preview surface works at all before any contract is trusted.
   */
  await render(page, documentFor({ type: 'text', text: '<p>Baseline</p>', settings: {} }));
  const baseline = await sample(page, '.builder-preview-text', [], 0);
  if (!baseline.found) {
    console.error(
      '\n[check:render] The baseline page rendered no text module.\n' +
      'Nothing below could be measured against it, so this is a failure rather than a pass.\n' +
      'Either the preview surface changed or the bundle is stale — `npm run build:builder`.\n'
    );
    process.exit(1);
  }
  for (const contract of RENDER_CONTRACTS) {
    await render(page, documentFor(contract.module));
    const result = await sample(page, contract.selector, contract.read || [], SETTLE_MS);

    // R1 — IT RENDERED AT ALL. Zero measured is a failure, never a pass: this
    // is the single most repeated way a check dies in this repo, and
    // check:panels had to learn it three times before it stuck.
    if (!result.found) {
      failures.push(
        `${contract.id}: nothing matched \`${contract.selector}\` ` +
        `(${result.page.modules} module(s) on the page). NOTHING WAS MEASURED — the module did not ` +
        'render, or the selector is stale. A contract that measures nothing cannot verify anything.'
      );
      continue;
    }
    if (!result.box.width || !result.box.height) {
      failures.push(
        `${contract.id}: \`${contract.selector}\` rendered a ${result.box.width}x${result.box.height} box — ` +
        'it is in the DOM but occupies no space, so nothing about it is visible to measure.'
      );
      continue;
    }
    measured += 1;

    // R2/R3 — whatever this contract came here to prove.
    const problem = contract.expect(result);
    if (problem) failures.push(`${contract.id}: ${problem}`);
  }
} finally {
  await browser.close();
}

if (!measured) {
  console.error(
    `\n[check:render] ${RENDER_CONTRACTS.length} contract(s) defined and NONE were measured.\n` +
    'That is a failure, not a pass. Every assertion is vacuous on a page that did not render.\n'
  );
  process.exit(1);
}

if (failures.length) {
  console.error(`\n[check:render] FAILED — ${failures.length} problem(s):\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(
    '\nThese are read out of a real browser, so "the setting reaches the renderer" is not a\n' +
    'counter-argument — what renders is what this measured. Each contract in\n' +
    'scripts/ui/render-contracts.mjs carries the incident it guards; read the `why`.\n'
  );
  process.exit(1);
}

console.log(
  `[check:render] OK — ${measured}/${RENDER_CONTRACTS.length} contract(s) measured at ${WIDTH}px ` +
  'against a real browser.'
);
