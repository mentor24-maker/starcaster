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
import { readFile } from 'node:fs/promises';
import { BASE_URL, ensureBuildIsCurrent } from './app-driver.mjs';
import { cannotTell, verdict, EXIT_FAIL, EXIT_CANNOT_TELL } from './harness-exit.mjs';
import {
  RENDER_CONTRACTS,
  RENDER_DIFFERENTIALS,
  effectClassesInCss,
  effectSweepModule,
  floatingImageModule,
  imageEffectClassMapFromSource,
  imageEffectOptionsFromSource,
} from './render-contracts.mjs';

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
  cannotTell('check:render',
    'lib/builder/template.js is missing — it is a generated file and a fresh worktree\ndoes not have one.\n\nRun `npm run build:builder-template`.');
}

/** The preview page reads its document from here (BUILDER_PREVIEW_STORAGE_KEY). */
const DRAFT_KEY = 'starcaster_builder_preview_draft';
const WIDTH = Number(process.env.UI_HARNESS_WIDTH || 1440);
/** Long enough for an animation's currentTime to move visibly past jitter. */
const SETTLE_MS = 600;

function moduleFrom(spec, index) {
  /*
   * `column` defaults to "main", which is the only column a single-column row
   * has, so every contract written before this reads exactly as it did.
   *
   * It is settable because a CELL-level setting cannot be reached otherwise:
   * proving one column is tinted and the one beside it is not needs a module
   * in each, and with the column hardcoded both landed in "main" — a column
   * a two-column row does not have. The renderer then filtered them out of
   * both cells, so the contract measured an EMPTY row and its own assertion
   * about the untouched column passed for the wrong reason.
   */
  const base = createEmptyModule(spec.type, spec.column ?? 'main');
  return {
    ...base,
    id: `module-render-contract-${spec.type}-${index}`,
    name: spec.type,
    column: spec.column ?? base.column ?? 'main',
    text: spec.text ?? base.text ?? '',
    settings: { ...base.settings, ...(spec.settings || {}) },
  };
}

/** A whole page document carrying the given modules, in order. */
function documentFor(...specs) {
  return {
    name: 'Render Contract',
    layoutSections: [{
      id: 'section-render-contract',
      title: 'Render Contract',
      layout: 'single',
      locked: false,
      alignment: 'left',
      widthMode: 'contained',
      modules: specs.map(moduleFrom),
    }],
  };
}

/** A page carrying ONE section with the given layout + modules — so a contract
 *  can measure a SECTION-level layout (e.g. the 4/5/6 equal-column rows), which
 *  documentFor (always `layout: 'single'`) cannot reach. */
function documentForSection({
  layout = 'single',
  modules = [],
  background,
  overlayScreen,
  cellBackgrounds,
  cellOverlayScreens,
  spacers = 0,
  themeTreatments,
} = {}) {
  /*
   * SPACER SECTIONS, above and below, so the page is tall enough to SCROLL.
   *
   * Most contracts read one frame of a section that fits on the screen, and
   * for those `spacers` stays 0 and the document is exactly what it always
   * was. Parallax is the exception: it does not exist as a property of a
   * frame at all — it is the difference between two scroll positions — and a
   * page that cannot scroll cannot express it. A contract that could not
   * scroll would have had to assert on the transform being *present*, which is
   * the same shape as asserting on a transition property and calling it a
   * dissolve. That one passed on a completely dead crossfade.
   */
  const spacer = (side, index) => ({
    id: `section-render-contract-spacer-${side}-${index}`,
    title: `Spacer ${side} ${index}`,
    layout: 'single',
    locked: false,
    alignment: 'left',
    widthMode: 'contained',
    minHeight: '600',
    modules: [moduleFrom({ type: 'heading', text: `Spacer ${side} ${index}`, settings: {} }, index)],
  });

  const subject = {
    id: 'section-render-contract',
    title: 'Render Contract Section',
    layout,
    locked: false,
    alignment: 'left',
    widthMode: 'contained',
    // Section-level background and tint. Dropping these was fine while every
    // background was CSS on the section itself; a video background renders a
    // real element, so a contract cannot reach it without them.
    ...(background ? { background } : {}),
    ...(overlayScreen ? { overlayScreen } : {}),
    // The CELL's fill and tint, for the same reason as the two above: a cell
    // overlay is a real element, so a contract cannot reach it unless the
    // fixture carries the field. Whitelisted rather than spread, so a typo in
    // a contract is a field that is visibly missing rather than one silently
    // along for the ride.
    ...(cellBackgrounds ? { cellBackgrounds } : {}),
    ...(cellOverlayScreens ? { cellOverlayScreens } : {}),
    modules: modules.map(moduleFrom),
  };

  const before = Array.from({ length: spacers }, (_, i) => spacer('before', i));
  const after = Array.from({ length: spacers }, (_, i) => spacer('after', i));

  /*
   * A THEME, WITHOUT A DATABASE.
   *
   * Some rendering is only wrong when a theme is on — the photo overlay tint
   * is the case that forced this, because a parallax layer covering it is
   * invisible on the untinted section every other contract here uses. The
   * preview page reads `themeShellBackground` straight out of this stored
   * draft and builds the theme styles from it, and it skips its API call
   * entirely when the stored palette already carries colours. So a contract
   * can ask for a themed page and this file keeps its bargain: no database,
   * no login, no fixture.
   *
   * Contracts that want no theme leave it out and the draft is byte-for-byte
   * what it always was — the keys are not written at all.
   */
  const theme = themeTreatments
    ? {
        themePalette: {
          primaryColor: '#1f4d8f',
          secondaryColor: '#8f1f4d',
          backgroundColor: '#ffffff',
          accentColor: '#4d8f1f',
        },
        themeShellBackground: {
          primaryColor: '#1f4d8f',
          secondaryColor: '#8f1f4d',
          backgroundColor: '#ffffff',
          accentColor: '#4d8f1f',
          treatments: themeTreatments,
        },
      }
    : {};

  return {
    name: 'Render Contract Section',
    layoutSections: [...before, subject, ...after],
    ...theme,
  };
}

async function render(page, doc) {
  await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [DRAFT_KEY, JSON.stringify(doc)]);
  // NOT `networkidle`: the page runs animations and never goes idle, so it
  // times out after 30s having rendered perfectly. Wait for the module.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.builder-preview-module', { timeout: 20000 }).catch(() => {});
  // Back to the top before anything is measured. A reload restores the
  // previous scroll position, so a scrolling contract would otherwise start
  // wherever the one before it finished — and read completely different
  // numbers depending on the order of the list.
  await page.evaluate(() => {
    (document.scrollingElement || document.documentElement).scrollTop = 0;
  });
  await page.waitForTimeout(1200);
}

/**
 * Everything a contract can assert on, sampled twice so motion is provable.
 */
function sample(page, selector, read, settleMs, series, probes) {
  return page.evaluate(async ({ selector, read, settleMs, series, probes }) => {
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

    /*
     * A TIME SERIES, for behaviour that only exists as a change.
     *
     * Some things cannot be read from one frame. A crossfade at a video's loop
     * seam is the case that forced this: the two elements exist, they carry an
     * opacity transition, and every single-instant assertion about them passes
     * with the handoff completely dead — measured, not guessed. What proves a
     * dissolve is two copies both PARTLY visible at the same moment, and that
     * only appears if you watch.
     *
     * Each entry samples the named selectors' computed properties repeatedly
     * and hands the whole series to `expect`.
     */
    let seriesOut = null;
    if (series) {
      seriesOut = [];
      /*
       * A SCROLLING series. `scrollBy` moves the page a fixed number of pixels
       * between frames, which is the only way to sample an effect whose whole
       * definition is "as the page scrolls". Contracts that read motion in
       * place leave it unset and nothing scrolls, exactly as before.
       *
       * `scrollY` rides along in every frame because the assertion that
       * matters is a COMPARISON — the background must move LESS than the page
       * did — and a series that recorded only the element's transform could
       * not tell "drifting slower" from "not moving because the page did not
       * move either", which is the way this check would most plausibly die.
       */
      const scroller = series.scrollBy
        ? (document.scrollingElement || document.documentElement)
        : null;
      for (let i = 0; i < series.count; i += 1) {
        if (scroller && i > 0) {
          scroller.scrollTop += series.scrollBy;
          // One animation frame, so the rAF loop under test has actually run
          // against the new scroll position before anything is read.
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        }
        const frame = { scrollY: scroller ? scroller.scrollTop : 0 };
        for (const [name, sel] of Object.entries(series.selectors)) {
          const node = document.querySelector(sel);
          if (!node) { frame[name] = null; continue; }
          const style = getComputedStyle(node);
          const box = node.getBoundingClientRect();
          frame[name] = {
            ...Object.fromEntries(series.read.map((prop) => [prop, style[prop]])),
            top: box.top,
            height: box.height,
          };
        }
        seriesOut.push(frame);
        await new Promise((resolve) => setTimeout(resolve, series.everyMs));
      }
    }

    /*
     * WHAT ACTUALLY PAINTS ON TOP, WHERE TWO ELEMENTS OVERLAP.
     *
     * The series above reads z-index, and z-index alone cannot answer this
     * question — which is the whole reason this exists. Two elements can keep
     * the same numbers and swap places, because a number only means anything
     * inside the stacking context that resolves it: giving a cell
     * `isolation: isolate` moved a floating image's `z-index: 40` from the
     * section's context into the cell's, and the column next door started
     * painting over the part of the image that hangs into it. Every z-index
     * reading in that scene was identical before and after, and so was the
     * image's rect. Only the answer to "what is on top" changed (round 2 of
     * 86bbqb0ac).
     *
     * Each probe names two selectors, intersects their boxes and asks the
     * browser what is at the middle of the overlap.
     *
     * WHAT IT CANNOT SEE, and this is not a footnote: `elementFromPoint` skips
     * anything with `pointer-events: none`, which every tint screen in this
     * codebase sets. A probe can therefore never report a screen as being on
     * top, and a contract written to prove one covers something would pass
     * while doing nothing. Probes are for elements that take hit-testing —
     * decor, text, backgrounds. Use z-index readings, or a person's eye, for
     * the screens.
     *
     * `overlap` rides along in every result on purpose. Two boxes that do not
     * actually overlap would make any assertion here unfalsifiable — the point
     * would land somewhere neither element is, and whatever it hit would be
     * read as an answer. A contract MUST reject a non-positive overlap.
     */
    let probesOut = null;
    if (probes) {
      probesOut = {};
      for (const [name, spec] of Object.entries(probes)) {
        const subject = document.querySelector(spec.subject);
        const against = document.querySelector(spec.against);
        if (!subject || !against) {
          probesOut[name] = {
            subject: !!subject, against: !!against, overlap: 0,
            missing: !subject ? spec.subject : spec.against,
          };
          continue;
        }
        const sb = subject.getBoundingClientRect();
        const ab = against.getBoundingClientRect();
        const left = Math.max(sb.left, ab.left);
        const right = Math.min(sb.right, ab.right);
        const top = Math.max(sb.top, ab.top);
        const bottom = Math.min(sb.bottom, ab.bottom);
        const overlapX = right - left;
        const overlapY = bottom - top;
        const x = (left + right) / 2;
        const y = (top + bottom) / 2;
        const hit = overlapX > 0 && overlapY > 0 ? document.elementFromPoint(x, y) : null;
        probesOut[name] = {
          subject: true,
          against: true,
          overlap: Math.round(Math.min(overlapX, overlapY)),
          overlapX: Math.round(overlapX),
          overlapY: Math.round(overlapY),
          point: { x: Math.round(x), y: Math.round(y) },
          subjectBox: { left: Math.round(sb.left), right: Math.round(sb.right) },
          againstBox: { left: Math.round(ab.left), right: Math.round(ab.right) },
          hit: hit ? `${hit.tagName.toLowerCase()}${hit.className ? `.${String(hit.className).trim().split(/\s+/)[0]}` : ''}` : null,
          onSubject: !!(hit && subject.contains(hit)),
          onAgainst: !!(hit && against.contains(hit)),
        };
      }
    }

    const rect = el.getBoundingClientRect();
    return {
      found: true,
      page: page_,
      series: seriesOut,
      probes: probesOut,
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
  }, { selector, read, settleMs, series: series ?? null, probes: probes ?? null });
}

/**
 * WHAT THE MODULE RENDERS, AS A COMPARABLE FINGERPRINT.
 *
 * Two exclusions carry the whole idea, and getting either wrong turns this
 * into a check that passes on the exact bug it was built for:
 *
 *  1. CLASS NAMES ARE NOT IN THE FINGERPRINT. "A class name is not a
 *     rendering" is the lesson this feature was born from — Cruise and
 *     Tumbleweed set classes nobody had styled. Including the class attribute
 *     would make every dead effect look like a change.
 *  2. `animation-*` COMPUTED STYLES ARE NOT IN IT EITHER, because
 *     getComputedStyle reports animations the engine cannot run: with
 *     `animation: real 5s, ghost 5s` and no `ghost` keyframes it returns
 *     "real, ghost". A ghost declaration would read as a difference. Real
 *     animations come from getAnimations(), which only ever lists what is
 *     actually running.
 *
 * What is left is what a person would see: computed style, real animations,
 * and size. Animations are paused at time zero first, or two samples of the
 * same thing differ by however many milliseconds apart they were taken.
 */
function compareRenderedModules(page) {
  return page.evaluate(() => {
    /*
     * SAMPLED AT SEVERAL PHASES, NOT JUST AT REST.
     *
     * Animations are paused and scrubbed to fixed times so the reading is
     * deterministic — but scrubbing to 0 alone is not enough, and that cost a
     * false failure: a 50% hop and a 400% hop are both at their STARTING
     * position at time zero, so Bounce Height read as a dead control. Anything
     * a keyframe drives is only visible part-way through, so the fingerprint
     * is the render at rest AND part-way through.
     */
    const PHASES = [0, 700, 1500];

    const scrub = (ms) => {
      for (const animation of document.getAnimations()) {
        try { animation.pause(); animation.currentTime = ms; } catch { /* not all are seekable */ }
      }
    };

    const modules = [...document.querySelectorAll('.builder-preview-module')];
    if (modules.length !== 2) return { modules: modules.length };

    const snapshot = (module) => {
      const elements = [module, ...module.querySelectorAll('*')].map((el) => {
        const cs = getComputedStyle(el);
        const styles = {};
        for (const prop of cs) {
          // See (2) above. `transition-*` goes too: it describes what WOULD
          // happen on a state change, not what is rendered now.
          if (prop.startsWith('animation') || prop.startsWith('transition')) continue;
          // (3) CUSTOM PROPERTIES ARE INPUTS, NOT OUTPUTS — and getComputedStyle
          // enumerates them (457 properties on a bare div, `--sc-test` among
          // them). The renderer passes every effect setting in as a
          // `--sc-effect-*` variable, so leaving these in meant the
          // differential compared the SETTING to itself: freezing both the
          // travel and the hop duration so Speed changed nothing a person
          // could see still "passed", because the variable had changed.
          //
          // A variable nobody reads is the same species as a class nobody
          // styled — a declaration, not a rendering. Caught by breaking the
          // differential on purpose and watching it stay green, twice.
          if (prop.startsWith('--')) continue;
          styles[prop] = cs.getPropertyValue(prop);
        }
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          styles,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });

      const animations = module.getAnimations({ subtree: true }).map((a) => {
        const timing = a.effect ? a.effect.getTiming() : {};
        return {
          name: a.animationName,
          duration: String(timing.duration ?? ''),
          iterations: String(timing.iterations ?? ''),
          delay: String(timing.delay ?? ''),
          direction: String(timing.direction ?? ''),
          easing: String(timing.easing ?? ''),
        };
      });

      return { elements, animations };
    };

    // Compared IN THE PAGE rather than shipped to node: 457 computed
    // properties across every element, at three phases, for two modules is a
    // megabyte of strings that only ever gets diffed anyway.
    const notes = [];
    const a0 = snapshot(modules[0]);
    const b0 = snapshot(modules[1]);
    const animA = JSON.stringify(a0.animations);
    const animB = JSON.stringify(b0.animations);
    if (animA !== animB) notes.push(`animations ${animA || '[]'} → ${animB || '[]'}`);
    if (a0.elements.length !== b0.elements.length) {
      notes.push(`element count ${a0.elements.length} → ${b0.elements.length}`);
    }

    for (const phase of PHASES) {
      scrub(phase);
      const a = snapshot(modules[0]);
      const b = snapshot(modules[1]);
      const shared = Math.min(a.elements.length, b.elements.length);
      for (let i = 0; i < shared; i += 1) {
        const ea = a.elements[i];
        const eb = b.elements[i];
        const at = phase ? ` @${phase}ms` : '';
        if (ea.width !== eb.width || ea.height !== eb.height) {
          notes.push(`<${ea.tag}>${at} size ${ea.width}x${ea.height} → ${eb.width}x${eb.height}`);
        }
        for (const prop of Object.keys(ea.styles)) {
          if (ea.styles[prop] !== eb.styles[prop]) {
            notes.push(`<${ea.tag}>${at} ${prop}: ${ea.styles[prop]} → ${eb.styles[prop]}`);
          }
        }
      }
      if (notes.length) break; // one real difference is enough
    }

    return { modules: modules.length, identical: notes.length === 0, notes: notes.slice(0, 5) };
  });
}

/** Live animations anywhere in the first rendered module, for the effect sweep. */
function animationsInFirstModule(page) {
  return page.evaluate(() => {
    const module = document.querySelector('.builder-preview-module');
    if (!module) return null;
    return module.getAnimations({ subtree: true }).map((a) => a.animationName);
  });
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
const notices = [];
let measured = 0;
let sweepsRun = 0;

/*
 * The failure report, in one place because two paths reach it: the baseline
 * guard below, which stops the run before any contract is tried, and the tail
 * of the sweep. One `process.exit(1)` in the file, so "a real failure exits 1"
 * cannot drift apart between them.
 */
function reportFailures(list) {
  console.error(`\n[check:render] FAILED — ${list.length} problem(s):\n`);
  for (const f of list) console.error(`  ✗ ${f}`);
  console.error(
    '\nThese are read out of a real browser, so "the setting reaches the renderer" is not a\n' +
    'counter-argument — what renders is what this measured. Each contract in\n' +
    'scripts/ui/render-contracts.mjs carries the incident it guards; read the `why`.\n' +
    '\nA differential failure means a control changed NOTHING a person could see. It does not\n' +
    'mean the change is wrong when it passes: a difference proves something moved, never that\n' +
    'it moved correctly. That judgement is still the operator\'s eye.\n'
  );
  process.exit(1);
}

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
   *   2. Until 86bbq2y7x the preview's own admin chrome overflowed by 2px
   *      with NO module on the page at all, so the document already
   *      "scrolled sideways" before anything was rendered. The preview now
   *      renders the live-site markup under a thin strip, so that particular
   *      noise is gone — but points 1 and 3 still stand on their own.
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
    /*
     * A 1, not a 2 — and getting this backwards is exactly the mistake this
     * ticket is about, committed by its own first fix (review round 1).
     *
     * There are two reasons the baseline can fail to render: the bundle is
     * stale, or the preview surface itself no longer works. Only the first is
     * an instrument problem, and `ensureBuildIsCurrent` above has ALREADY
     * caught that one and exited 2 before this line is reached. So what is
     * left here is the code under test having broken the preview — a defect,
     * and one that must print as a defect rather than as a broken instrument.
     * Measured: break the preview renderer on purpose and this exits 1.
     */
    failures.push(
      'baseline: the baseline page rendered no text module, so not one contract below could be ' +
      'measured against it. The build is current (checked above), which leaves the preview surface ' +
      'itself — components/builder-preview-page.tsx and the module registry it renders through.'
    );
    reportFailures(failures);
  }
  const DEFAULT_VIEWPORT = page.viewportSize();
  for (const contract of RENDER_CONTRACTS) {
    /*
     * Optional emulation. Some behaviour is only correct in a condition the
     * default browser is not in — a visitor who asked for reduced motion, or a
     * phone-width window. Those paths used to be untestable here, which meant
     * the only evidence they worked was somebody remembering to toggle a
     * system setting by hand.
     */
    if (contract.emulate?.reducedMotion) {
      await page.emulateMedia({ reducedMotion: contract.emulate.reducedMotion });
    }
    if (contract.emulate?.viewport) {
      await page.setViewportSize(contract.emulate.viewport);
    }

    await render(page, contract.section ? documentForSection(contract.section) : documentFor(contract.module));

    /*
     * Optional HOVER, for behaviour that only exists while the pointer is on
     * something. Everything else here reads one static frame, which cannot see
     * a `:hover` or `:focus-within` rule at all — so a menu item that changes
     * shape while its dropdown is open was unmeasurable, and the only evidence
     * available was a unit test on the variable plus somebody's eye on the
     * page (86bbum0x9).
     *
     * `page.hover` moves the real mouse and the position survives the
     * `page.evaluate` inside sample(), so the frame that gets measured is the
     * hovered one. A selector that matches nothing FAILS the contract rather
     * than sampling the un-hovered page — silently measuring the wrong state
     * is how a check reports green over a dead feature.
     */
    let hoverError = null;
    if (contract.hover) {
      try {
        await page.hover(contract.hover, { timeout: 4000 });
        await page.waitForTimeout(120);
      } catch (err) {
        hoverError = `${contract.id}: could not hover \`${contract.hover}\` — ` +
          'the element the contract needs to put the pointer on did not appear, so the state it ' +
          `measures was never entered. ${String(err && err.message || err).split('\n')[0]}`;
      }
    }

    const result = hoverError ? null : await sample(
      page,
      contract.selector,
      contract.read || [],
      SETTLE_MS,
      contract.series,
      contract.probes
    );

    if (contract.emulate?.reducedMotion) await page.emulateMedia({ reducedMotion: null });
    if (contract.emulate?.viewport && DEFAULT_VIEWPORT) await page.setViewportSize(DEFAULT_VIEWPORT);
    if (contract.hover) await page.mouse.move(0, 0);

    if (hoverError) {
      failures.push(hoverError);
      continue;
    }

    /*
     * An ABSENCE contract inverts R1: the whole assertion is that nothing
     * matches. Kept explicit rather than letting "not found" quietly pass,
     * because a silent not-found is exactly how the checks in this repo have
     * died before — this one has to say out loud that absence is the point.
     */
    if (contract.absent) {
      if (result.found) {
        failures.push(
          `${contract.id}: \`${contract.selector}\` IS present and it must not be. ` +
          (contract.why ? `${contract.why}` : '')
        );
      } else {
        measured += 1;
      }
      continue;
    }

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

  /*
   * PROVE THE INSTRUMENT BEFORE TRUSTING ITS READINGS.
   *
   * The differential below concludes "this setting is dead" from two
   * fingerprints being identical. That inference is only sound if two renders
   * of the SAME thing are reliably identical — if the fingerprint carries any
   * noise (a font arriving late, a measured position, a timestamp), then every
   * differential passes for the wrong reason and the sweep is decoration.
   *
   * So: render one module twice, same settings, and require no difference at
   * all. This must be the first thing that fails when the method rots.
   */
  await render(page, documentFor(
    { type: 'image', settings: { url: '/images/Gemini_Generated_starcaster_banner.png', alt: 'control', size: '40', effect: 'tumbleweed' } },
    { type: 'image', settings: { url: '/images/Gemini_Generated_starcaster_banner.png', alt: 'control', size: '40', effect: 'tumbleweed' } },
  ));
  const control = await compareRenderedModules(page);
  if (control.modules !== 2) {
    failures.push(
      `differential control: expected 2 modules on the page, found ${control.modules}. ` +
      'Nothing below this can be trusted.'
    );
  } else if (!control.identical) {
    failures.push(
      'differential control: two renders of the IDENTICAL module differ, so the fingerprint carries ' +
      `noise and every differential result below is meaningless — ${control.notes.join('; ')}`
    );
  }

  /*
   * THE EFFECT SWEEP — every effect the panels offer must actually animate.
   *
   * Driven from IMAGE_EFFECT_OPTIONS rather than a list kept here, so an
   * effect added tomorrow is covered tomorrow. This is the check that would
   * have caught Cruise and Tumbleweed on the day they shipped: both were
   * offered for months with no stylesheet rule behind them, and the only
   * symptom was a picture that did not move.
   */
  const effectsSource = await readFile(path.join(ROOT, 'components/builder/builder-image-effects.ts'), 'utf8');
  const offered = imageEffectOptionsFromSource(effectsSource);
  if (!offered.length) {
    failures.push(
      'the effect sweep read ZERO effects out of components/builder/builder-image-effects.ts. ' +
      'That is a failure rather than a pass — the sweep would otherwise verify nothing while looking green. ' +
      'IMAGE_EFFECT_OPTIONS has probably been reshaped; fix imageEffectOptionsFromSource.'
    );
  }
  for (const effect of offered) {
    await render(page, documentFor(effectSweepModule(effect)));
    const running = await animationsInFirstModule(page);
    if (running === null) {
      failures.push(`effect "${effect}": the module did not render at all, so nothing was measured.`);
      continue;
    }
    sweepsRun += 1;
    if (!running.length) {
      failures.push(
        `effect "${effect}" is offered in the panel but renders NO live animation — the class is set and ` +
        'the engine runs nothing. This is the Cruise/Tumbleweed bug: a stylesheet rule is missing, and ' +
        'the only symptom a person sees is a picture that does not move.'
      );
    }
  }

  /*
   * THE DIFFERENTIAL — a control that changes nothing fails by construction.
   *
   * Both variants render on ONE page, which is not just faster: two modules in
   * the same document share fonts, layout pass and clock, so a difference
   * between them cannot be an artefact of two separate page loads.
   */
  for (const diff of RENDER_DIFFERENTIALS) {
    const variant = (value) => ({
      ...diff.module,
      settings: { ...diff.module.settings, [diff.setting]: value },
    });
    await render(page, documentFor(variant(diff.from), variant(diff.to)));
    const pair = await compareRenderedModules(page);
    if (pair.modules !== 2) {
      failures.push(
        `${diff.id}: expected both variants to render, found ${pair.modules} module(s). NOTHING WAS MEASURED.`
      );
      continue;
    }
    sweepsRun += 1;
    if (pair.identical) {
      failures.push(
        `${diff.id}: setting \`${diff.setting}\` from "${diff.from}" to "${diff.to}" on a ${diff.module.type} ` +
        'module changes NOTHING about what renders — same computed styles, same animations, same sizes. ' +
        `The control is dead. (${diff.why})`
      );
    }
  }
  /*
   * SLIDE ON A FLOATING IMAGE LANDS WHERE THE OTHER TRAVELLER DOES.
   *
   * Slide collapsed a floating image's overlay shell to 0px wide — the picture
   * vanished — because its class matched the buried effect's dead `!important`
   * overlay-LAYOUT rules still carried in the regenerated base stylesheet
   * (`:has(.starcaster-effect-slide)`).
   *
   * The reference used to be Cruise. Cruise was RETIRED on 2026-08-22 (it was
   * Slide under a second name) and `cruise` now normalizes TO `slide` — so the
   * old comparison would have rendered the same effect twice and compared it to
   * itself. That is an assertion that cannot fail, which this repo has shipped
   * twice before; Tumbleweed is the reference now. It is the other effect that
   * travels the full corridor, and it never had the legacy `:has()` rules, so
   * its shell is what "correct" looks like.
   *
   * Every OTHER image contract uses an inline `image`, whose shell is a
   * different element the dead rules do not touch — which is exactly why 8/8
   * green missed this twice. A FLOATING image is the only place it shows.
   *
   * BREAK-ON-PURPOSE: point getImageEffectClassName('slide') back at
   * `starcaster-effect-slide`, rebuild CSS — Slide's shell measures 0-wide and
   * the assertion below fails. (Round-4 fix, task 86bbh8zc5.)
   */
  const SHELL = '.builder-preview-image-shell-overlay';
  await render(page, documentFor(floatingImageModule('tumbleweed')));
  const referenceShell = await sample(page, SHELL, [], SETTLE_MS);
  await render(page, documentFor(floatingImageModule('slide')));
  const slideShell = await sample(page, SHELL, [], SETTLE_MS);

  if (!referenceShell.found || !referenceShell.box.width || !referenceShell.box.height) {
    // The harness could not render a floating overlay shell at all. Do NOT let
    // that pass as if Slide were fine — report it loudly (DOCTRINE §3.11) so a
    // harness gap can never masquerade as a verified Slide.
    notices.push(
      'floating-image-slide-shell: could not measure a floating overlay shell for Tumbleweed ' +
      `(found=${referenceShell.found}, box=${referenceShell.box ? `${referenceShell.box.width}x${referenceShell.box.height}` : 'n/a'}). ` +
      'The Slide shell comparison DID NOT RUN — treat Slide on a floating image as unverified here.'
    );
  } else {
    sweepsRun += 2;
    if (!slideShell.found || !slideShell.box.width || !slideShell.box.height) {
      failures.push(
        `floating-image-slide-shell: Slide's overlay shell measured ` +
        `${slideShell.box ? `${slideShell.box.width}x${slideShell.box.height}` : 'nothing'} — it collapsed ` +
        `instead of landing where Tumbleweed's (${referenceShell.box.width}x${referenceShell.box.height}) does. ` +
        'The live class is matching the buried effect\'s dead `!important` layout rules again.'
      );
    } else if (Math.abs(slideShell.box.width - referenceShell.box.width) > 2 ||
               Math.abs(slideShell.box.height - referenceShell.box.height) > 2) {
      failures.push(
        `floating-image-slide-shell: Slide's shell is ${slideShell.box.width}x${slideShell.box.height} but ` +
        `Tumbleweed's is ${referenceShell.box.width}x${referenceShell.box.height} — both travel the same ` +
        'corridor, so their floating shells must land in the same place.'
      );
    }
  }

  /*
   * THE OPPOSITE GAP, REPORTED RATHER THAN FAILED.  /*
   * THE OPPOSITE GAP, REPORTED RATHER THAN FAILED.
   *
   * The dead Tumbleweed was a panel option with no stylesheet rule. The mirror
   * image also exists: full keyframes in the CSS that appear in no panel,
   * reachable only by hand-editing a setting. That is not a bug the build can
   * decide — surfacing them or deleting them is the operator's call — but it
   * must not be silent either, because "nobody mentioned it" is how they came
   * to sit there unnoticed in the first place (DOCTRINE §3.11: a sweep reports
   * what it could not settle).
   */
  const cssText = [
    await readFile(path.join(ROOT, 'src/css/_builder-react.css'), 'utf8'),
    await readFile(path.join(ROOT, 'src/css/_builder-react-overrides.css'), 'utf8'),
  ].join('\n');
  const styled = effectClassesInCss(cssText);
  // Compare against the class each effect EMITS, not its raw value: Slide's
  // class is `slide-motion`, so `offered.includes('slide-motion')` is false and
  // the rename would otherwise read as an unstyled orphan.
  const classToEffect = imageEffectClassMapFromSource(effectsSource);
  const orphans = [...styled].filter((name) => !offered.includes(classToEffect.get(name) || name)).sort();
  if (orphans.length) {
    notices.push(
      `${orphans.length} effect(s) have keyframes in the stylesheet and appear in NO panel: ` +
      `${orphans.join(', ')}. They are reachable only by hand-editing a page's settings. ` +
      'Surfacing them or deleting them is a design decision, not a build failure — but they should ' +
      'not sit unnoticed, which is exactly how the unstyled effects lasted months.'
    );
  }
} finally {
  await browser.close();
}

for (const notice of notices) console.log(`[check:render] NOTE — ${notice}`);

/*
 * FAILURES FIRST, THEN THE REFUSAL — the order is the whole point.
 *
 * `verdict()` ranks a real failure above a could-not-tell, and this tail used
 * to ask the two questions the other way round: the `!measured` guard ran
 * first and exited 2. Every contract that fails R1 (`!result.found`) pushes a
 * failure and `continue`s WITHOUT incrementing `measured` — so a change that
 * broke all 41 contracts produced `failures = 41, measured = 0`, exited 2
 * saying "not a failure of your change either", and printed none of them
 * (review round 1, task 86bbt6hgx).
 */
const code = verdict({ failures: failures.length, blind: measured ? 0 : 1 });
if (code === EXIT_FAIL) reportFailures(failures);
if (code === EXIT_CANNOT_TELL) {
  cannotTell('check:render',
    `${RENDER_CONTRACTS.length} contract(s) defined and NONE were measured.\n` +
    'Every assertion is vacuous on a page that did not render, so this is not a pass —\n' +
    'and it is not a failure of your change either. Nothing was read.');
}

console.log(
  `[check:render] OK — ${measured}/${RENDER_CONTRACTS.length} contract(s), ` +
  `${sweepsRun} swept render(s) at ${WIDTH}px against a real browser.`
);
