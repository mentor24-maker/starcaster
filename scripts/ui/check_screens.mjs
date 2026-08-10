#!/usr/bin/env node
/**
 * Check every CRUD screen against the width and alignment rules in
 * docs/UI_RULES.md, in a real browser, at several viewport widths.
 *
 *   T0  — no CRUD extends beyond the screen; the page body never scrolls
 *         sideways. A table scrolling inside its OWN container is T7 rung
 *         12: legal, reported as a note, never a failure.
 *   T10 — bulk-action toolbars are right-aligned and stay inside their cell.
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOT_DIR = path.join(ROOT, '.ui-check');

/**
 * The screens under test. Adding one is a line here, not a new script.
 * `label` is what a human reads in the report.
 */
const SCREENS = [
  { id: 'builderManagePagesPage', label: 'Builder: Pages' },
  { id: 'builderTemplatesPage', label: 'Builder: Templates' },
  // builderModulesPage opens the workspace rather than a CRUD, so it is not
  // in this sweep; add screens here only when they own a table.
  { id: 'contactsPersonasPage', label: 'Contacts: Personas' },
  { id: 'assetsPage', label: 'Assets' },
  { id: 'contactsPage', label: 'Contacts' },
  { id: 'acquireYoutubePage', label: 'Acquire: YouTube' },
  { id: 'acquireWebPage', label: 'Acquire: Web' },
  { id: 'messagingContentPage', label: 'Messaging: Content' },
  { id: 'campaignsPage', label: 'Campaigns' },
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
    }
  } else {
    // An inactive project renders empty tables, which measure as "fits" and
    // prove nothing. Say so rather than reporting a hollow pass.
    console.log(
      `  (no UI_HARNESS_PROJECT_ID set — screens may render empty.\n` +
      `   Run npm run seed:ui-fixture and export the id it prints, or these checks are hollow.)\n`
    );
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
      const m = await measureActiveScreen(page);
      const shot = path.join(SHOT_DIR, `${screen.id}-${width}.png`);
      await page.screenshot({ path: shot });
      checked += 1;

      const problems = [];
      if (m.pageScrollsSideways) {
        const worst = m.overflowing[0];
        problems.push(
          `page scrolls sideways (${m.pageScrollWidth}px vs ${m.viewport}px)` +
          (worst ? ` — widest offender: ${worst.tag}.${worst.cls} reaching ${worst.right}px` : '')
        );
      }
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
}

console.log(`\n${checked} screen-width combination(s) checked, ${skipped} skipped, ${failures.length} failing.`);
if (notes.length) {
  console.log('\nNotes (legal, but the width ladder was skipped):');
  [...new Set(notes)].forEach((n) => console.log(`  ${n}`));
}
console.log(`\nScreenshots: ${path.relative(ROOT, SHOT_DIR)}/ — look at them. Passing assertions are not proof.`);
process.exitCode = failures.length ? 1 : 0;
