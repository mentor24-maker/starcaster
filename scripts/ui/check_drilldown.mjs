/**
 * check:drilldown — does the Builder's drill-down still step light-to-dark
 * blue, evenly, with the same gap around every level?
 *
 * WHY THIS EXISTS
 * Dane asked twice (tasks 86bch66at 2026-10-12, 86bchhgae 2026-10-13) for the
 * editor's nested boxes — workspace, section, column, module — to go from a
 * light blue to a dark one in steady steps, each with the same 10px of its own
 * colour around the box inside it. Both times the cause was invisible to every
 * other gate: the tier colours were right in the stylesheet and wrong on the
 * screen, because the cards painted the PAGE DESIGN's own background, padding
 * and margins over them. Measured before the fix: gaps of 15, 19, 0 and 18px,
 * and a grey gradient where a column's blue should be. Nothing tests CSS, so
 * this opens the real editor and measures the boxes.
 *
 * WHAT IT ASSERTS, per level, on the fixture page:
 *   1. the box paints exactly its tier token (`--builder-bg-*`);
 *   2. each level is darker than the one around it, and the steps between
 *      tiers are even in perceived lightness (OKLab L, within 0.01);
 *   3. the visible gap between a box's inner edge and the box inside it is
 *      `--builder-depth-gap` on the left AND the right.
 *
 *   npm run seed:ui-fixture          # once; prints UI_HARNESS_PROJECT_ID
 *   PORT=3058 node server.js
 *   UI_HARNESS_BASE_URL=http://localhost:3058 UI_HARNESS_PROJECT_ID=... npm run check:drilldown
 *
 * Exit 0 pass, 1 a level is wrong, 2 could not take a reading (harness-exit.mjs).
 */
import { launch, signIn, activateProject, BASE_URL } from './app-driver.mjs';
import { cannotTell, verdict } from './harness-exit.mjs';

const LABEL = 'check:drilldown';
const PROJECT_ID = process.env.UI_HARNESS_PROJECT_ID || '';
const PAGE_NAME = process.env.UI_HARNESS_PANEL_PAGE || 'Panel Lattice Check';

if (!PROJECT_ID) {
  cannotTell(LABEL,
    'Set UI_HARNESS_PROJECT_ID first — `npm run seed:ui-fixture` prints it.\n' +
    'Without a project the builder has no section to drill into.');
}

/** sRGB "rgb(r, g, b)" → OKLab lightness. */
function oklabL(rgb) {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

const { browser, page } = await launch({ width: 1600, height: 1400 });
const failures = [];
let blind = 0;
try {
  await signIn(page);
  await activateProject(page, PROJECT_ID);
  await page.goto(`${BASE_URL}/#page=builderPagesPage`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const opened = await page.evaluate((name) => {
    const row = [...document.querySelectorAll('tr')].find((tr) => (tr.textContent || '').includes(name));
    const edit = row && [...row.querySelectorAll('button, a')]
      .find((el) => /edit/i.test(el.getAttribute('title') || el.getAttribute('aria-label') || ''));
    if (!edit) return false;
    edit.click();
    return true;
  }, PAGE_NAME);
  if (!opened) cannotTell(LABEL, `No page named "${PAGE_NAME}" with an Edit action. Run \`npm run seed:ui-fixture\`.`);
  await page.waitForTimeout(8000);

  // Drill in: workspace → first section → its column panels → first module.
  const step = (fn) => page.evaluate(fn).then(() => page.waitForTimeout(2500));
  await step(() => {
    const t = [...document.querySelectorAll('button.builder-panel-toggle')]
      .find((b) => /^workspace$/i.test((b.textContent || '').trim()));
    if (t && t.getAttribute('aria-expanded') !== 'true') t.click();
  });
  await step(() => {
    const card = document.querySelector('.builder-section-card');
    const b = card && [...card.querySelectorAll('button')].find((x) => /expand section/i.test(x.getAttribute('title') || ''));
    if (b) b.click();
  });
  await step(() => {
    const card = document.querySelector('.builder-section-card .builder-module-card');
    const b = card && [...card.querySelectorAll('button')].find((x) => /expand module/i.test(x.getAttribute('title') || ''));
    if (b) b.click();
  });

  const reading = await page.evaluate(() => {
    const module = document.querySelector('.builder-section-card .builder-column-card .builder-module-card');
    if (!module) return null;
    const column = module.closest('.builder-column-card');
    const section = column.closest('.builder-section-card');
    const shell = section.closest('.builder-workspace-shell');
    const root = document.querySelector('.builder-react-root');
    const token = (name) => {
      // Resolve a custom property to the colour the browser actually paints.
      const probe = document.createElement('div');
      probe.style.background = `var(${name})`;
      root.appendChild(probe);
      const c = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return c;
    };
    // Declared in px in _variables.css, so the raw value parses directly.
    const gap = parseFloat(getComputedStyle(root).getPropertyValue('--builder-depth-gap'));
    const box = (el, tier) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        tier, bg: cs.backgroundColor, expected: token(`--builder-bg-${tier}`),
        left: r.left, right: r.right,
        innerLeft: r.left + parseFloat(cs.borderLeftWidth),
        innerRight: r.right - parseFloat(cs.borderRightWidth)
      };
    };
    return {
      gap,
      sectionExpanded: !!section.querySelector('.builder-section-header[aria-expanded="true"]'),
      levels: [box(shell, 'workspace'), box(section, 'cell'), box(column, 'column'), box(module, 'module')],
      ladder: ['workspace', 'section', 'cell', 'column', 'module'].map((t) => token(`--builder-bg-${t}`))
    };
  });

  if (!reading) {
    blind += 1;
    console.log(`[${LABEL}] BLIND — no module inside a column inside a section on "${PAGE_NAME}".`);
  } else {
    if (!reading.sectionExpanded) {
      blind += 1;
      console.log(`[${LABEL}] BLIND — the section did not expand, so its colour is the collapsed one.`);
    }
    if (!(reading.gap > 0)) failures.push(`--builder-depth-gap resolved to ${reading.gap}px.`);

    // 2. The ladder itself: strictly darker, evenly spaced.
    const Ls = reading.ladder.map(oklabL);
    const steps = Ls.slice(1).map((L, i) => Ls[i] - L);
    if (steps.some((d) => d <= 0)) failures.push(`Tiers do not get darker at every step: L = ${Ls.map((l) => l.toFixed(3)).join(' → ')}`);
    const spread = Math.max(...steps) - Math.min(...steps);
    if (spread > 0.01) failures.push(`Uneven steps: ${steps.map((d) => d.toFixed(3)).join(', ')} (spread ${spread.toFixed(3)}, allowed 0.010).`);

    reading.levels.forEach((lvl, i) => {
      // 1. Paints its own tier, not the page design's background.
      const ok = lvl.bg === lvl.expected;
      console.log(`  ${lvl.tier.padEnd(9)} ${lvl.bg.padEnd(20)} ${ok ? 'ok' : `expected ${lvl.expected}`}`);
      if (!ok) failures.push(`${lvl.tier} box paints ${lvl.bg}, not its tier colour ${lvl.expected}.`);
      // 3. The gap around the box inside it.
      const inner = reading.levels[i + 1];
      if (!inner) return;
      const left = Math.round(inner.left - lvl.innerLeft);
      const right = Math.round(lvl.innerRight - inner.right);
      console.log(`  ${''.padEnd(9)} gap around ${inner.tier}: left ${left}px, right ${right}px`);
      if (left !== reading.gap || right !== reading.gap) {
        failures.push(`Gap between ${lvl.tier} and ${inner.tier} is ${left}px / ${right}px, not ${reading.gap}px.`);
      }
    });
  }
  if (page.rateLimited) { blind += 1; console.log(`[${LABEL}] BLIND — ${page.rateLimited} request(s) were rate-limited.`); }
} finally {
  await browser.close();
}

failures.forEach((f) => console.log(`[${LABEL}] FAIL — ${f}`));
const code = verdict({ failures: failures.length, blind });
console.log(`[${LABEL}] ${code === 0 ? 'OK — every level steps darker, evenly, with the same gap.' : code === 1 ? `${failures.length} problem(s).` : 'could not take a full reading.'}`);
process.exit(code);
