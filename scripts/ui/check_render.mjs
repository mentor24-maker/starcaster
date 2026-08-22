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

function moduleFrom(spec, index) {
  const base = createEmptyModule(spec.type, 'main');
  return {
    ...base,
    id: `module-render-contract-${spec.type}-${index}`,
    name: spec.type,
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
   * SLIDE ON A FLOATING IMAGE LANDS WHERE CRUISE DOES.
   *
   * Slide collapsed a floating image's overlay shell to 0px wide — the picture
   * vanished — because its class matched the buried effect's dead `!important`
   * overlay-LAYOUT rules still carried in the regenerated base stylesheet
   * (`:has(.starcaster-effect-slide)`). Cruise never had such legacy rules, so
   * it is the reference for "correct": Slide is mechanically identical to it, so
   * its shell must land in the same box.
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
  await render(page, documentFor(floatingImageModule('cruise')));
  const cruiseShell = await sample(page, SHELL, [], SETTLE_MS);
  await render(page, documentFor(floatingImageModule('slide')));
  const slideShell = await sample(page, SHELL, [], SETTLE_MS);

  if (!cruiseShell.found || !cruiseShell.box.width || !cruiseShell.box.height) {
    // The harness could not render a floating overlay shell at all. Do NOT let
    // that pass as if Slide were fine — report it loudly (DOCTRINE §3.11) so a
    // harness gap can never masquerade as a verified Slide.
    notices.push(
      'floating-image-slide-shell: could not measure a floating overlay shell for Cruise ' +
      `(found=${cruiseShell.found}, box=${cruiseShell.box ? `${cruiseShell.box.width}x${cruiseShell.box.height}` : 'n/a'}). ` +
      'The Slide-vs-Cruise shell comparison DID NOT RUN — treat Slide on a floating image as unverified here.'
    );
  } else {
    sweepsRun += 2;
    if (!slideShell.found || !slideShell.box.width || !slideShell.box.height) {
      failures.push(
        `floating-image-slide-shell: Slide's overlay shell measured ` +
        `${slideShell.box ? `${slideShell.box.width}x${slideShell.box.height}` : 'nothing'} — it collapsed ` +
        `instead of landing where Cruise's (${cruiseShell.box.width}x${cruiseShell.box.height}) does. ` +
        'The live class is matching the buried effect\'s dead `!important` layout rules again.'
      );
    } else if (Math.abs(slideShell.box.width - cruiseShell.box.width) > 2 ||
               Math.abs(slideShell.box.height - cruiseShell.box.height) > 2) {
      failures.push(
        `floating-image-slide-shell: Slide's shell is ${slideShell.box.width}x${slideShell.box.height} but ` +
        `Cruise's is ${cruiseShell.box.width}x${cruiseShell.box.height} — Slide is mechanically identical to ` +
        'Cruise, so its floating shell must land in the same place.'
      );
    }
  }

  /*
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

if (!measured) {
  console.error(
    `\n[check:render] ${RENDER_CONTRACTS.length} contract(s) defined and NONE were measured.\n` +
    'That is a failure, not a pass. Every assertion is vacuous on a page that did not render.\n'
  );
  process.exit(1);
}

for (const notice of notices) console.log(`[check:render] NOTE — ${notice}`);

if (failures.length) {
  console.error(`\n[check:render] FAILED — ${failures.length} problem(s):\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
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

console.log(
  `[check:render] OK — ${measured}/${RENDER_CONTRACTS.length} contract(s), ` +
  `${sweepsRun} swept render(s) at ${WIDTH}px against a real browser.`
);
