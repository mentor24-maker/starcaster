#!/usr/bin/env node
/**
 * Check every CRUD screen against the width and alignment rules in
 * docs/UI_RULES.md, in a real browser, at several viewport widths.
 *
 *   T0  — no CRUD extends beyond the screen; the page body never scrolls
 *         sideways. A table scrolling inside its OWN container is T7 rung
 *         12: legal, reported as a note, never a failure.
 *   T10 — bulk-action toolbars are right-aligned and stay inside their cell.
 *   A box marked `data-ui-no-sideways` (text meant to wrap, inside its own
 *         scroll box) never scrolls sideways. Its overflow is contained, so
 *         the page-width check above cannot see a line that failed to wrap —
 *         a reader just gets a sideways scrollbar (86bcdek0e, found by
 *         breaking the transcript view on purpose and watching T0 pass).
 *
 * NOT A CI GATE. CI has no browsers — that is why smoke_capture.mjs is
 * marked manual too. This is a command you run before shipping UI work.
 *
 * WHAT IT WILL NOT CATCH
 * Assertions only check what someone thought to assert. On 2026-08-10 an
 * Assets toolbar passed every numeric check while stacking its buttons into
 * a ragged column, and the fix was only obvious in the screenshot. So this
 * always writes screenshots, and "0 failures" is an invitation to look at
 * them, not a substitute.
 *
 * USAGE
 *   npm run dev                       # in another shell
 *   node scripts/ui/seed_fixture.mjs  # once, so screens have content
 *   npm run check:screens
 *   npm run check:screens -- --widths 1280,1440 --screen builderManagePagesPage
 *   npm run check:screens -- --headed          # watch it drive
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  launch, signIn, activateProject, gotoScreen, revealPanels, measureActiveScreen,
  BASE_URL, FIXTURE_PROJECT_NAME,
} from './app-driver.mjs';
import { verdict, EXIT_CANNOT_TELL } from './harness-exit.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOT_DIR = path.join(ROOT, '.ui-check');

/**
 * The screens under test. Adding one is a line here, not a new script.
 * `label` is what a human reads in the report.
 *
 * `open` (optional) is a selector clicked before measuring, for content that
 * only exists once something is opened — the Footage transcript view
 * (86bcdek0e) is ~1,000 lines nobody would see on a bare page load. If nothing
 * matches, the screen is SKIPPED (unmeasured), never reported as fitting.
 * It must be a toggle carrying `aria-expanded`: navigation here does not reload
 * the page, so the step opens it only if it is not open already, and closes it
 * again after measuring so the plain entry at the next width sees it closed.
 *
 * `search` (optional) types `text` into `input`, presses Return, and measures
 * once `ready` appears — for results that only exist after a search, like the
 * Footage screen's "Search what you said" (86bcdek0z). No `ready` means the
 * screen is SKIPPED, never reported as fitting; `clear` is clicked afterwards
 * so the next entry sees the bare page.
 */
const SCREENS = [
  { id: 'builderManagePagesPage', label: 'Builder: Pages' },
  { id: 'builderTemplatesPage', label: 'Builder: Templates' },
  // builderModulesPage opens the workspace rather than a CRUD, so it is not
  // in this sweep; add screens here only when they own a table.
  { id: 'contactsPersonasPage', label: 'Contacts: Personas' },
  { id: 'assetsPage', label: 'Assets' },
  { id: 'assetsFootagePage', label: 'Assets: Footage' },
  { id: 'assetsFootagePage', label: 'Assets: Footage, transcript open', open: '[data-testid="studio-transcript-open"]' },
  {
    id: 'assetsFootagePage',
    label: 'Assets: Footage, search results',
    // "link" is said on the fixture's line with an unbroken 180-character URL,
    // in the file with the longest name — the two things that could widen it.
    search: {
      input: '[data-testid="studio-search-input"]',
      text: 'link',
      ready: '[data-testid="studio-search-results"]',
      clear: '[data-testid="studio-search-clear"]',
    },
  },
  { id: 'contactsPage', label: 'Contacts' },
  { id: 'acquireYoutubePage', label: 'Acquire: YouTube' },
  { id: 'acquireWebPage', label: 'Acquire: Web' },
  { id: 'messagingContentPage', label: 'Messaging: Content' },
  { id: 'campaignsPage', label: 'Campaigns' },
  { id: 'engageYoutubeOutreachPage', label: 'Engage: YouTube Outreach' },
  { id: 'engageSubstackNotesPage', label: 'Engage: Substack Notes' },
];

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const WIDTHS = String(arg('widths', '1280,1440,1920')).split(',').map(Number);
const ONLY = arg('screen', '');
const HEADED = process.argv.includes('--headed');
const REVEAL_HIDDEN = process.argv.includes('--reveal-hidden');

mkdirSync(SHOT_DIR, { recursive: true });

const failures = [];
const notes = [];
/*
 * Reasons this run could not measure what it claims to measure. Every one of
 * these used to print and then exit 0 — the text said "hollow", "may render
 * empty", "treat everything above as unreliable", and the exit code said pass
 * (task 86bbt6hgx). They are collected rather than exited on immediately so
 * the run still produces its screenshots and its report; only the VERDICT
 * changes.
 */
const blind = [];
let checked = 0;
let skipped = 0;
let throttled = 0;

console.log(`Checking ${BASE_URL} at ${WIDTHS.join(', ')}px\n`);

// One browser, one sign-in, resized between widths. A browser per width
// meant a login per width, and the app's global rate limiter (500 requests)
// tripped partway through — which surfaced as a baffling "sign-in timed out"
// on the second pass rather than as "you are being throttled".
const { browser, page } = await launch({ width: WIDTHS[0], headless: !HEADED });
try {
  await signIn(page);

  const projectId = process.env.UI_HARNESS_PROJECT_ID;
  if (projectId) {
    const how = await activateProject(page, projectId);
    if (String(how).startsWith('failed')) {
      console.log(`  (could not activate ${projectId}: ${how} — screens may render empty)`);
      blind.push(`the fixture project ${projectId} would not activate (${how}), so screens render empty`);
    }
  } else {
    // An inactive project renders empty tables, which measure as "fits" and
    // prove nothing. Say so rather than reporting a hollow pass.
    console.log(
      `  (no UI_HARNESS_PROJECT_ID set — screens may render empty.\n` +
      `   Run npm run seed:ui-fixture and export the id it prints, or these checks are hollow.)\n`
    );
    blind.push('no UI_HARNESS_PROJECT_ID — run `npm run seed:ui-fixture` and export the id it prints');
  }

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(600);

    for (const screen of SCREENS) {
      if (ONLY && screen.id !== ONLY) continue;
      const nav = await gotoScreen(page, screen.id);
      if (!nav.ok && !nav.active) {
        console.log(`skip  ${String(width).padStart(4)}  ${screen.label} — ${nav.reason || 'not reachable'}`);
        skipped += 1;
        continue;
      }
      if (nav.active !== screen.id) {
        console.log(`skip  ${String(width).padStart(4)}  ${screen.label} — landed on "${nav.active}"`);
        skipped += 1;
        continue;
      }

      await revealPanels(page, { revealSelfHidden: REVEAL_HIDDEN });
      await page.waitForTimeout(900);
      if (screen.open) {
        const target = page.locator(screen.open).first();
        if (!(await target.count())) {
          console.log(`skip  ${String(width).padStart(4)}  ${screen.label} — nothing matches ${screen.open} (is the fixture seeded?)`);
          skipped += 1;
          continue;
        }
        if ((await target.getAttribute('aria-expanded')) !== 'true') await target.click();
        await page.waitForTimeout(900);
      }
      if (screen.search) {
        const input = page.locator(screen.search.input).first();
        if (!(await input.count())) {
          console.log(`skip  ${String(width).padStart(4)}  ${screen.label} — nothing matches ${screen.search.input}`);
          skipped += 1;
          continue;
        }
        await input.fill(screen.search.text);
        await input.press('Enter');
        const ready = await page.locator(screen.search.ready).first()
          .waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
        if (!ready) {
          console.log(`skip  ${String(width).padStart(4)}  ${screen.label} — searching "${screen.search.text}" showed no results (is the fixture seeded?)`);
          skipped += 1;
          const clear = page.locator(screen.search.clear).first();
          if (await clear.count() && await clear.isEnabled()) await clear.click();
          continue;
        }
        await page.waitForTimeout(300);
      }
      const m = await measureActiveScreen(page);
      // Measured BEFORE the `open` step closes what it opened.
      const sideways = await page.evaluate(() => {
        const sec = [...document.querySelectorAll('section.app-page')].find((x) => !x.classList.contains('hidden'));
        return [...(sec?.querySelectorAll('[data-ui-no-sideways]') || [])]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => `${el.getAttribute('data-ui-no-sideways') || el.className} (${el.scrollWidth}px of text in ${el.clientWidth}px)`);
      });
      const shot = path.join(SHOT_DIR, `${screen.id}${screen.open ? '-opened' : ''}${screen.search ? '-searched' : ''}-${width}.png`);
      await page.screenshot({ path: shot });
      checked += 1;
      if (screen.open) {
        const opened = page.locator(`${screen.open}[aria-expanded="true"]`).first();
        if (await opened.count()) await opened.click();
      }
      if (screen.search) {
        const clear = page.locator(screen.search.clear).first();
        if (await clear.count() && await clear.isEnabled()) await clear.click();
      }

      const problems = [];
      if (m.pageScrollsSideways) {
        const worst = m.overflowing[0];
        problems.push(
          `page scrolls sideways (${m.pageScrollWidth}px vs ${m.viewport}px)` +
          (worst ? ` — widest offender: ${worst.tag}.${worst.cls} reaching ${worst.right}px` : '')
        );
      }
      for (const what of sideways) problems.push(`${what} scrolls sideways inside itself — its text is not wrapping`);
      for (const t of m.toolbars) {
        if (t.justify !== 'flex-end') problems.push(`toolbar "${t.id}" is ${t.justify}, not right-aligned (T10)`);
        if (t.overflowsHost) problems.push(`toolbar "${t.id}" overflows its cell (T10)`);
      }
      for (const tbl of m.tables) {
        if (tbl.hiddenPx > 0 && !tbl.hasScrollContainer) {
          problems.push(`table "${tbl.id}" overflows with no scroll container (T0)`);
        } else if (tbl.scrollsInContainer) {
          notes.push(`${screen.label} @${width}: table "${tbl.id}" scrolls in its container, ${tbl.hiddenPx}px hidden (T7 rung 12)`);
        }
      }

      if (problems.length) {
        failures.push({ screen: screen.label, width, problems, shot });
        console.log(`FAIL  ${String(width).padStart(4)}  ${screen.label}`);
        problems.forEach((p) => console.log(`        ${p}`));
      } else {
        console.log(`ok    ${String(width).padStart(4)}  ${screen.label}` +
          ` (${m.tables.length} table(s), ${m.toolbars.length} toolbar(s))`);
      }
    }
  }
  throttled = page.rateLimited || 0;
} finally {
  await browser.close();
}

if (throttled > 0) {
  console.log(
    `\nWARNING: ${throttled} request(s) were rate-limited (HTTP 429) during this run.\n` +
    '  Screens load partial data once that starts, so later measurements describe a\n' +
    '  broken app while looking like clean results. Restart `npm run dev` and re-run;\n' +
    '  treat everything above as unreliable.'
  );
  blind.push(`${throttled} request(s) were rate-limited — every measurement after the first is unreliable`);
}

console.log(`\n${checked} screen-width combination(s) checked, ${skipped} skipped, ${failures.length} failing.`);
if (notes.length) {
  console.log('\nNotes (legal, but the width ladder was skipped):');
  [...new Set(notes)].forEach((n) => console.log(`  ${n}`));
}
console.log(`\nScreenshots: ${path.relative(ROOT, SHOT_DIR)}/ — look at them. Passing assertions are not proof.`);

/*
 * A SKIPPED SCREEN IS AN UNMEASURED SCREEN — at any count, not just zero.
 *
 * This used to fire only when NOTHING was measured, which drew the line in an
 * arbitrary place: 8 of 9 screens unreachable with 1 measured still printed
 * "0 failing" and exited 0. Both skip paths above are instrument problems (the
 * screen would not load, or the app landed somewhere else), so by this file's
 * own definition those screens were not checked — and a run cannot call clean
 * what it never looked at.
 */
if (!checked) {
  blind.push(`not one of the ${SCREENS.length} screen(s) was measured (${skipped} skipped) — there is nothing here to pass`);
} else if (skipped > 0) {
  blind.push(
    `${skipped} screen-width combination(s) were skipped and ${checked} measured — the skipped ones ` +
    'are unreachable, not clean, so this run says nothing about them (the "skip" lines above name each)'
  );
}

const code = verdict({ failures: failures.length, blind: blind.length });
if (code === EXIT_CANNOT_TELL) {
  console.error(
    `\n[check:screens] COULD NOT TAKE A READING — exiting ${EXIT_CANNOT_TELL}.\n\n` +
    'No screen failed, but this run could not see what it is supposed to see, so a pass\n' +
    'would be a pass over nothing:\n\n' +
    blind.map((b) => `  • ${b}`).join('\n') +
    '\n\nFix the instrument and run it again. Exit 2 means "could not tell", never "failed" —\n' +
    'nothing above says anything about the code you are changing.\n'
  );
}
process.exitCode = code;
