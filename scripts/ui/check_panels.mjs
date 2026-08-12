/**
 * THE LATTICE CHECK — master rule W0 (docs/UI_RULES.md, operator 8/12).
 *
 * "Every label should take up the same width, and every field should take up
 * the same width."
 *
 * WHY THIS EXISTS AS A BROWSER CHECK AND NOT A REVIEW NOTE
 * A written rule alone has already failed here twice. R9 (label colour) sat
 * in the doctrine for two days while a duplicate CSS rule quietly overrode
 * it in every panel in the app, and nobody could see it from the source. W0
 * is geometry — it cannot be read off the CSS at all, because the old
 * stagger came from `max-content` tracks resolving differently per row. The
 * only way to know is to measure the running app.
 *
 * WHAT IT ASSERTS, per panel carrying `.is-lattice`:
 *   1. every field label has the SAME width
 *   2. every field starts at the SAME x-offset inside its column
 *   3. every stretchable control (select / text / number) has the SAME width
 *   4. no label overflows its track (which would crop a word — rule L4)
 *
 * Controls that cannot stretch — checkbox, colour swatch, alignment icon
 * group — are exempt from (3) by design: they keep their natural size at the
 * start of the slot. They are still bound by (1) and (2).
 *
 * Not in CI (CI has no browsers). Run it before shipping panel work, like
 * check_screens.mjs.
 *
 *   npm run dev                       # in another shell
 *   npm run seed:ui-fixture           # once
 *   npm run check:panels
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, signIn, activateProject, BASE_URL } from './app-driver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { createRequire } = await import('node:module');
const { BUILDER_MODULE_TYPES } = createRequire(path.join(ROOT, 'package.json'))(
  path.join(ROOT, 'lib/builder/template.js')
);
const EXPECTED_MODULES = BUILDER_MODULE_TYPES.length;
const PROJECT_ID = process.env.UI_HARNESS_PROJECT_ID || '';
/*
 * Seeded by `npm run seed:ui-fixture`, which is the point: this used to
 * default to a page somebody had built by hand in their own local database,
 * so what the check measured depended on the machine. On 2026-08-11 Heading
 * joined the lattice and this reported a clean pass over six TABLE panels
 * without ever seeing a heading. Re-seed after pulling — the seeder now
 * rewrites this page's modules every run so it is always what the fixture
 * says it is.
 */
const PAGE_NAME = process.env.UI_HARNESS_PANEL_PAGE || 'Panel Lattice Check';
const WIDTHS = (process.env.UI_HARNESS_WIDTHS || '1440,1600').split(',').map(Number);

/** Field kinds whose control keeps its natural size (W0's stated exception). */
const NON_STRETCH = ['check', 'align', 'color'];

if (!PROJECT_ID) {
  console.error(
    'Set UI_HARNESS_PROJECT_ID first — `npm run seed:ui-fixture` prints it.\n' +
    'Without a project the builder renders an empty page and every assertion\n' +
    'passes on zero panels, which is worse than failing.'
  );
  process.exit(2);
}

/** Walk from the pages list into an expanded module panel. */
async function openPanels(page) {
  await page.goto(`${BASE_URL}/#page=builderPagesPage`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const opened = await page.evaluate((name) => {
    const row = [...document.querySelectorAll('tr')].find((tr) => (tr.textContent || '').includes(name));
    if (!row) return `no row named "${name}"`;
    const edit = [...row.querySelectorAll('button, a')].find((el) =>
      /edit/i.test(el.getAttribute('title') || el.getAttribute('aria-label') || '')
    );
    if (!edit) return 'row has no edit action';
    edit.click();
    return null;
  }, PAGE_NAME);
  if (opened) return opened;
  await page.waitForTimeout(8000);

  // Workspace → every section → every module. Each starts collapsed, and a
  // collapsed panel has no layout to measure.
  await page.evaluate(() => {
    const t = [...document.querySelectorAll('button.builder-panel-toggle')]
      .find((b) => /^workspace$/i.test((b.textContent || '').trim()));
    if (t) t.click();
  });
  await page.waitForTimeout(3000);

  await page.evaluate(() => {
    document.querySelectorAll('.builder-section-card').forEach((card) => {
      const b = [...card.querySelectorAll('button')]
        .find((x) => /expand section/i.test(x.getAttribute('title') || ''));
      if (b) b.click();
    });
  });
  await page.waitForTimeout(3000);

  await page.evaluate(() => {
    document.querySelectorAll('.builder-module-card').forEach((card) => {
      const b = [...card.querySelectorAll('button')]
        .find((x) => /expand module/i.test(x.getAttribute('title') || ''));
      if (b) b.click();
    });
  });
  await page.waitForTimeout(4000);
  return null;
}

function measure(page, nonStretch) {
  return page.evaluate((exempt) => {
    /** Width of an element's rendered text, ignoring its padding. */
    function textWidth(el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      range.detach?.();
      return r.width;
    }

    // Every lattice surface, not just module panels: the row (section) editor
    // joined on 2026-08-13 and is measured by exactly the same rule. Selecting
    // on `.is-lattice` rather than a specific container is what makes the next
    // surface automatic instead of another thing to remember.
    const panels = [...document.querySelectorAll('.is-lattice')]
      .filter((el) => !el.parentElement?.closest('.is-lattice'));
    return panels.flatMap((panel, index) => {
      // W0 is scoped PER COLUMN (operator 8/13): each column sizes to its own
      // longest label and longest control. Checking per panel would demand
      // that Structure and Placement match, which the rule deliberately does
      // not ask for. Chrome outside any axis column is its own group.
      const groups = [...panel.querySelectorAll('.builder-schema-panel-column')];
      const loose = [...panel.querySelectorAll('.builder-module-chrome .builder-module-field-strip')];
      return [...groups, ...loose].map((group, gi) => {
      const groupName = ((group.querySelector('.builder-schema-group-title') || {}).textContent || '').trim()
        || `chrome strip ${gi}`;
      // Legacy BuilderSettingRow pairs are measured too. They were not,
      // and on 2026-08-11 the heading panel's offsets sat 12px right of
      // every field label above them while this reported a clean pass —
      // `.builder-setting-label` carries a left padding `.builder-module-
      // field-label` does not. A control the check cannot see is a control
      // the rule does not cover.
      const pairs = [
        ...group.querySelectorAll('.builder-module-field'),
        ...group.querySelectorAll('.builder-setting-row, .builder-setting-row-full'),
      ];
      const fields = pairs.map((f) => {
        const label = f.querySelector('.builder-module-field-label, .builder-setting-label');
        let control = f.querySelector('.builder-module-field-control, .builder-setting-value');
        if (!label || !control) return null;

        // A `full`-width field spans both tracks by design — it is long text
        // keeping the room, not a staggered row. Out of scope for W0.
        if (f.classList.contains('builder-module-field--full')) return null;

        // A wrapper flattened into the column grid (`display: contents`) has
        // NO BOX, so its rect is 0×0 at 0,0 — measuring it would report a
        // field starting a few hundred pixels left of the panel and fail on
        // a row that is actually fine. Descend to the first thing that has
        // a box; that is the control the operator sees.
        while (control && control.getBoundingClientRect().width === 0 && control.firstElementChild) {
          control = control.firstElementChild;
        }
        if (!control || control.getBoundingClientRect().width === 0) return null;

        const kind = [...f.classList]
          .map((c) => c.replace('builder-module-field--', ''))
          .find((c) => c !== 'builder-module-field') || '';

        const or = group.getBoundingClientRect();
        const lr = label.getBoundingClientRect();
        const cr = control.getBoundingClientRect();

        return {
          name: (label.textContent || '').trim() || '(unlabelled)',
          kind,
          labelW: Math.round(lr.width),
          // The TEXT width, not the box. scrollWidth counts padding, and the
          // 40px of room IS padding — using it here would compare the box to
          // itself and the room assertion would always pass.
          labelTextW: Math.round(textWidth(label)),
          // Where the label's TEXT starts, not its box. The boxes are grid
          // cells and are equal by construction, so they cannot detect a
          // label indented by its own padding — which is exactly how the
          // heading offsets sat 12px right of every label above them while
          // this check passed.
          labelTextX: Math.round(label.getBoundingClientRect().left
            + parseFloat(getComputedStyle(label).paddingLeft || '0') - or.left),
          fieldX: Math.round(cr.left - or.left),
          fieldW: Math.round(cr.width),
          // Classify by the CONTROL, not only by a width-token class. Legacy
          // BuilderSettingRow pairs (the row editor) carry no `--check`
          // modifier, so a checkbox and a radio pair were being measured as
          // stretchable and reported as "2 different widths" for doing
          // exactly what W0's exception tells them to do: keep their natural
          // size at the start of the slot.
          stretchable: !exempt.includes(kind)
            && !control.querySelector(':scope > input[type="checkbox"], :scope > input[type="radio"]')
            && !control.querySelector(':scope > .builder-radio-group')
            && !control.querySelector(':scope > .builder-theme-color-field, :scope > .builder-color-swatch')
        };
      }).filter(Boolean);
      return { index, group: groupName, fields };
      });
    });
  }, nonStretch);
}

function assertLattice(panels, width) {
  const failures = [];

  for (const panel of panels) {
    const { fields } = panel;
    if (!fields.length) continue;
    const where = `${width}px panel #${panel.index} / ${panel.group}`;

    const labelWidths = [...new Set(fields.map((f) => f.labelW))];
    if (labelWidths.length > 1) {
      const worst = fields
        .map((f) => `${f.name}=${f.labelW}px`)
        .join(', ');
      failures.push(
        `${where}: labels are ${labelWidths.length} different widths (${labelWidths.join('/')}px) — ${worst}`
      );
    }

    const labelTextXs = [...new Set(fields.map((f) => f.labelTextX))];
    if (labelTextXs.length > 1) {
      failures.push(
        `${where}: label text starts at ${labelTextXs.length} different x-positions ` +
        `(${labelTextXs.join('/')}px) — ` + fields.map((f) => `${f.name}@${f.labelTextX}`).join(', ') +
        ' (a label indented by its own padding; the grid cells are equal, the words are not)'
      );
    }

    const fieldXs = [...new Set(fields.map((f) => f.fieldX))];
    if (fieldXs.length > 1) {
      failures.push(
        `${where}: fields start at ${fieldXs.length} different x-positions (${fieldXs.join('/')}px) — ` +
        fields.map((f) => `${f.name}@${f.fieldX}`).join(', ')
      );
    }

    const stretch = fields.filter((f) => f.stretchable);
    const fieldWidths = [...new Set(stretch.map((f) => f.fieldW))];
    if (fieldWidths.length > 1) {
      failures.push(
        `${where}: stretchable fields are ${fieldWidths.length} different widths (${fieldWidths.join('/')}px) — ` +
        stretch.map((f) => `${f.name}=${f.fieldW}`).join(', ')
      );
    }

    // The room the operator asked for: "40px more than the longest string".
    // Without this the check would pass on tracks that fit the text exactly,
    // which is the cramped look the rule was written against.
    const room = fields.map((f) => f.labelW - f.labelTextW).filter((n) => Number.isFinite(n));
    const tight = room.filter((r) => r < 30);
    if (tight.length) {
      failures.push(
        `${where}: label track is only ${Math.min(...room)}px wider than its longest label — ` +
        'the rule asks for 40px of room (--builder-field-room)'
      );
    }

    // L4: a label wider than its track is a cropped word, which the lattice
    // must never buy. The answer is a shorter label or a wider token — never
    // a per-field override.
    for (const f of fields) {
      if (f.labelTextW > f.labelW + 1) {
        failures.push(
          `${where}: label "${f.name}" text needs ${f.labelTextW}px but its track is ${f.labelW}px ` +
          '(L4, cropped word) — the track should have grown to fit it, so a fixed width has crept back in'
        );
      }
    }
  }

  return failures;
}

const allFailures = [];
let panelsSeen = 0;
let cardsSeen = 0;

for (const width of WIDTHS) {
  const { browser, page } = await launch({ width, height: 1400, headless: true });
  try {
    await signIn(page);
    await activateProject(page, PROJECT_ID);
    const problem = await openPanels(page);
    if (problem) {
      allFailures.push(`${width}px: could not open a panel — ${problem}`);
      continue;
    }
    cardsSeen = Math.max(cardsSeen, await page.evaluate(
      () => document.querySelectorAll('.builder-module-card').length
    ));
    const panels = measure(page, NON_STRETCH);
    const measured = await panels;
    panelsSeen += measured.length;
    allFailures.push(...assertLattice(measured, width));
  } finally {
    await browser.close();
  }
}

// The fixture is shared local state: another session running
// `npm run seed:ui-fixture` from its own worktree rewrites the SAME page in
// the SAME database. On 2026-08-13 that silently cut this page from 53
// modules to 3, and the check reported a confident pass over what was left.
// Counting the cards is what makes that loud instead of invisible.
if (cardsSeen > 0 && cardsSeen < EXPECTED_MODULES) {
  console.error(
    `\n[check:panels] The fixture is INCOMPLETE — ${cardsSeen} module cards on the page, ` +
    `${EXPECTED_MODULES} module types exist.\n` +
    'Another session has probably re-seeded over it. Re-run `npm run seed:ui-fixture`\n' +
    'and check again; a pass over a partial fixture is not a pass.\n'
  );
  process.exit(1);
}

if (panelsSeen === 0) {
  console.error(
    'No panels carrying `.is-lattice` were found.\n' +
    'That is a FAILURE, not a pass: either the page has no modules whose type\n' +
    'is in LATTICE_MODULE_TYPES (builder-module-card.tsx), or the navigation\n' +
    'above stopped working. Zero assertions is never a green result.'
  );
  process.exit(1);
}

if (allFailures.length) {
  console.error(`\n[check:panels] W0 (the lattice) FAILED — ${allFailures.length} problem(s):\n`);
  for (const f of allFailures) console.error(`  ✗ ${f}`);
  console.error(
    '\nW0: one label width and one field width per panel. The two numbers live in\n' +
    'src/css/_variables.css (--builder-field-label-w / --builder-field-control-w).\n' +
    'Fix them there — never by putting a width on one field.\n'
  );
  process.exit(1);
}

console.log(`[check:panels] OK — W0 holds across ${panelsSeen} panel(s) at ${WIDTHS.join('/')}px.`);
