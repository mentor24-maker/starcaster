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
 * IT ALSO ASSERTS W9 — no field spans its container:
 *   5. no text control anywhere on the surface renders wider than
 *      `--builder-field-long-max` (560px)
 *
 * (5) is measured over EVERYTHING, including the `full` fields and the item
 * managers that (1)–(4) deliberately skip. Those exclusions are what let the
 * Slideshow editor ship a 2,000px-wide image URL field while this reported a
 * clean pass — a control the check cannot see is a control the rule does not
 * cover, for the third time.
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
// lib/builder/template.js is a GENERATED artifact and a fresh worktree has
// none. Without this the run dies on a raw MODULE_NOT_FOUND stack that says
// nothing about which command produces it — which is exactly how it read on
// 2026-08-15, twice, in two different worktrees.
let BUILDER_MODULE_TYPES;
try {
  ({ BUILDER_MODULE_TYPES } = createRequire(path.join(ROOT, 'package.json'))(
    path.join(ROOT, 'lib/builder/template.js')
  ));
} catch {
  console.error(
    '\n[check:panels] lib/builder/template.js is missing — it is a generated file\n' +
    'and a fresh worktree does not have one.\n\n' +
    'Run `npm run build:builder-template`.\n'
  );
  process.exit(2);
}
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
/*
 * 1920 joined on 2026-08-13, and it is the width that matters most: it is the
 * operator's own screen. The Feature Cards block reached the same right edge
 * at 1440 and 1600 and stopped short at 1920 — the wide rows hit the W9
 * ceiling while the fields above them kept going — and two green runs at the
 * narrower widths were reported as proof it was fixed.
 */
const WIDTHS = (process.env.UI_HARNESS_WIDTHS || '1440,1600,1920').split(',').map(Number);

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

  // The cell (column) editor is a third collapsed panel, one per column, and
  // it was invisible to this check until it joined the lattice on 2026-08-11.
  // Opening it here is the difference between "W0 holds" and "W0 holds on the
  // surfaces we happened to open" — the same blind spot that let six TABLE
  // panels report a clean pass without a heading among them.
  //
  // "Section Settings and Styles" is the row's own editor, which folded behind
  // a bar on 2026-08-15. Expanding a row no longer reveals it, so without this
  // line the whole row lattice — Structure, Placement, Frame, Visibility —
  // would drop out of the measurement and the check would go green by seeing
  // less: 603 groups instead of 615.
  await page.evaluate(() => {
    document.querySelectorAll('button[aria-label]').forEach((button) => {
      const label = button.getAttribute('aria-label') || '';
      if (/^expand (styles|section settings and styles)$/i.test(label)) button.click();
    });
  });
  await page.waitForTimeout(3000);
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
      // The chrome's OWN strip, by direct child (2026-08-25, ticket
      // 86bbjt1aq). It used to be any descendant strip, which read as the
      // safer selector and was the looser one in the way that matters: the
      // background picker brings a strip of its own, so `Background` was
      // measured as a group of one — a group of one always agrees with
      // itself — instead of as a row of the chrome. Its label sat 55px left
      // of every other chrome control for weeks and this reported a clean
      // pass the whole time. As a direct child the group is the whole chrome
      // and the background's rows are inside it, where they can disagree.
      const loose = [...panel.querySelectorAll('.builder-module-chrome > .builder-module-field-strip')];
      // An item manager running its own lattice (L6a) opts in by declaring
      // how many label/field pairs it puts on a row. It is measured like any
      // other group — this check reported a clean pass on the Feature Cards
      // card list for a day because the list matched none of the selectors
      // above, and the pass was read as verification. A surface the check
      // cannot see is a surface the rule does not cover.
      const managers = [...panel.querySelectorAll('[data-lattice-pairs]')];

      /*
       * A GROUP CAN BE MORE THAN ONE BOX (ticket 86bbmafd6, 2026-08-26).
       *
       * Everything above measures each box against ITSELF, which is why this
       * check passed for weeks over the bug the operator was looking at: in a
       * stacked two-column editor the chrome and the settings column below it
       * were two grids, each perfectly aligned internally, disagreeing with
       * each other by 33px. Two groups that each agree with themselves is the
       * same blind spot as a group of one, one level up.
       *
       * The boxes that claim to share the editor's lattice say so in the
       * cascade — they are the ones placed on the `lattice-start` line — so
       * that is what identifies them, and they are measured together against
       * the PANEL, not each against its own rect. Now their offsets are in
       * one coordinate system and every assertion below applies across the
       * seam.
       *
       * Two or more, never one: a lone sharer agrees with itself, and this
       * check has already been fooled by that exact shape once (#432).
       */
      const shared = [...panel.querySelectorAll('.builder-module-field-strip, .builder-schema-panel-column')]
        .filter((el) => getComputedStyle(el).gridColumnStart === 'lattice-start');

      /*
       * A unit is the boxes to read pairs from plus the origin to measure
       * them against. For every group above those are the same element; for a
       * shared lattice they are not, which is the only reason this is a pair
       * of fields rather than one.
       */
      const units = [
        ...groups.map((el) => ({ els: [el], origin: el })),
        ...loose.map((el) => ({ els: [el], origin: el })),
        ...managers.map((el) => ({ els: [el], origin: el })),
        ...(shared.length > 1 ? [{ els: shared, origin: panel, shared: true }] : []),
      ];

      /*
       * WHICH PANEL IS #18? Until 2026-09-02 a failure said only `panel #18`,
       * and the index is an ordinal in a 594-panel sweep — it names nothing a
       * person can search for. That cost this ticket a whole round: a reviewer
       * broke the Carousel lattice four ways, could not find the word
       * "carousel" anywhere in the output, and concluded the check never
       * opened the panel. It does open it; the breaks had been swallowed by a
       * `max-width` and a flex-shrink, so nothing over-wide was ever rendered
       * to report. The pass was honest and the diagnosis was not, and the only
       * reason the two could not be told apart is that the failure text does
       * not say what it is looking at.
       *
       * The editor already carries its own type as a modifier class, so this
       * is a read, not a new attribute to remember to add.
       */
      const panelName = (
        [...panel.classList].find((c) => c.startsWith('builder-module-editor--'))
          ?.replace('builder-module-editor--', '')
        || [...panel.classList].find((c) => c !== 'is-lattice' && c.endsWith('-settings'))
        || [...panel.classList].find((c) => c !== 'is-lattice')
        || ''
      );

      return units.map((unit, gi) => {
      const group = unit.els[0];
      /*
       * An item manager's title is its SIBLING, not its child — the heading
       * ("Slides", "Cards") sits above `.builder-cards-panel-fields` rather
       * than inside it. So the child lookup below found nothing and a
       * declared manager was reported as `chrome strip 3`, which reads as
       * anonymous chrome and is the opposite of what it is.
       */
      const ownTitle = ((group.querySelector('.builder-schema-group-title') || {}).textContent || '').trim();
      const siblingTitle = ((group.previousElementSibling?.matches?.('.builder-schema-group-title, .builder-cards-panel-heading')
        ? group.previousElementSibling.textContent : '') || '').trim();
      const groupName = unit.shared
        ? `shared lattice — chrome + settings, ${unit.els.length} boxes`
        : ownTitle
        || siblingTitle
        || (group.hasAttribute('data-lattice-pairs') ? `item manager ${gi}` : `chrome strip ${gi}`);
      // Legacy BuilderSettingRow pairs are measured too. They were not,
      // and on 2026-08-11 the heading panel's offsets sat 12px right of
      // every field label above them while this reported a clean pass —
      // `.builder-setting-label` carries a left padding `.builder-module-
      // field-label` does not. A control the check cannot see is a control
      // the rule does not cover.
      // THREE pair shapes exist, and the check has to know all of them.
      // `label.field` was the one it could not see: the table CELL editor is
      // built from it, so an image opened inside a table cell rendered a
      // whole modal of stacked full-width boxes while this reported a clean
      // pass (operator 8/12). A control the check cannot see is a control the
      // rule does not cover — the same lesson as the heading offsets.
      const pairs = unit.els.flatMap((el) => [
        ...el.querySelectorAll('.builder-module-field'),
        ...el.querySelectorAll('.builder-setting-row, .builder-setting-row-full'),
        ...el.querySelectorAll('label.field'),
      ]).filter((el) => !el.closest('.builder-slider-item-grid, .builder-item-grid'));
      // ITEM MANAGERS ARE OUT OF SCOPE, deliberately and not by accident.
      // A repeating card editor (social links, TOC entries, tag rows) is a
      // titled-column grid governed by L6, not a column of the panel
      // lattice — its fields legitimately share a row. Excluded here so a
      // future fixture WITH items in it reports honestly instead of failing
      // a rule that was never meant to cover them. Today they render empty
      // in the fixture, so without this line the pass would be luck.
      const fields = pairs.map((f) => {
        const label = f.querySelector('.builder-module-field-label, .builder-setting-label')
          || (f.matches('label.field') ? f.querySelector(':scope > span') : null);
        let control = f.querySelector('.builder-module-field-control, .builder-setting-value')
          || (f.matches('label.field') ? f.querySelector(':scope > *:not(span)') : null);
        if (!label || !control) return null;

        // A `full`-width field spans both tracks by design — it is long text
        // keeping the room, not a staggered row. Its CONTROL is out of scope
        // for W0.
        //
        // Its LABEL is not, and that gap cost a day (2026-08-12). In the
        // Feature Cards manager the longest labels — "Description", "Icon
        // Image" — belong to full fields, so skipping the whole pair left the
        // label track measured by the SHORT labels only. A fixed 11ch track
        // that cramped "Description" to 10px of room sailed through, and the
        // green run was reported as proof the layout obeyed the rule.
        const full = f.classList.contains('builder-module-field--full');
        if (full && !group.hasAttribute('data-lattice-pairs')) return null;

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

        const or = unit.origin.getBoundingClientRect();
        const lr = label.getBoundingClientRect();
        const cr = control.getBoundingClientRect();

        return {
          name: (label.textContent || '').trim() || '(unlabelled)',
          kind,
          full,
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
          // The label BOX's x, used to bucket a multi-pair group into its
          // columns. Distinct from labelTextX, which is about padding.
          labelBoxX: Math.round(lr.left - or.left),
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
      const declaredPairs = Number(group.getAttribute('data-lattice-pairs') || '1') || 1;
      // Whether this group is an item manager that OPTED IN to being
      // measured. Distinct from `pairs`, which defaults to 1 and so cannot
      // tell "declared one column" from "declared nothing" — and that
      // distinction is what makes an unmeasured manager detectable below.
      const declaredManager = group.hasAttribute('data-lattice-pairs');
      return { index, panelName, group: groupName, pairs: declaredPairs, declaredManager, fields };
      });
    });
  }, nonStretch);
}

/**
 * W9 — every text control on the surface, with its rendered width.
 *
 * Measured OVER THE WHOLE PANEL rather than per column, and with none of the
 * exclusions the lattice check needs: a `full` field and an item-manager cell
 * are exempt from W0 because they legitimately span their tracks, and that is
 * precisely where an unbounded field hides. Selects are in too — one with a
 * long option list will happily grow past the ceiling.
 *
 * Reported by the deepest identifying label available, since an item-grid
 * input has no label element of its own; its `aria-label` is what names the
 * row ("Slide 2 alt text") when a failure has to be found by hand.
 */
function measureWidths(page) {
  return page.evaluate(() => {
    const panels = [...document.querySelectorAll('.is-lattice')]
      .filter((el) => !el.parentElement?.closest('.is-lattice'));
    const cap = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--builder-field-long-max')
    ) || 560;

    return panels.flatMap((panel, index) => {
      // Same reason as the lattice failures name their panel: an index alone
      // sends a reader hunting through 594 panels for the one that failed.
      const panelName = (
        [...panel.classList].find((c) => c.startsWith('builder-module-editor--'))
          ?.replace('builder-module-editor--', '')
        || [...panel.classList].find((c) => c !== 'is-lattice' && c.endsWith('-settings'))
        || [...panel.classList].find((c) => c !== 'is-lattice')
        || ''
      );
      const controls = [...panel.querySelectorAll(
        'input[type="text"], input[type="url"], input[type="search"], input[type="number"], textarea, select'
      )];
      return controls.map((el) => {
        const w = Math.round(el.getBoundingClientRect().width);
        if (w <= cap) return null;
        const named = el.getAttribute('aria-label')
          || el.closest('.builder-module-field, .builder-setting-row, label.field')
            ?.querySelector('.builder-module-field-label, .builder-setting-label, :scope > span')
            ?.textContent?.trim()
          || el.getAttribute('placeholder')
          || el.tagName.toLowerCase();
        return { index, panelName, name: named, width: w, cap };
      }).filter(Boolean);
    });
  });
}

function assertCeiling(overflows, width) {
  return overflows.map((o) =>
    `${width}px panel #${o.index}${o.panelName ? ` (${o.panelName})` : ''}: "${o.name}" renders ${o.width}px wide, over the ` +
    `${o.cap}px ceiling (W9) — a field with no size constraint. The cap is ` +
    '--builder-field-long-max; raise the field\'s own width token, never the cap.'
  );
}

function assertLattice(panels, width) {
  const failures = [];

  for (const panel of panels) {
    const { fields: allFields } = panel;

    // AN UNMEASURED MANAGER IS A FAILURE, NOT A PASS.
    //
    // This `continue` used to be unconditional, and it is the reason this
    // check reported clean on two broken panels: Feature Cards on
    // 2026-08-12 and Programs on 2026-08-13. Both rendered EMPTY in the
    // fixture, so the group was found, measured nothing, and skipped — and
    // in both cases the green run was read as proof the layout obeyed W0
    // when it had never been looked at.
    //
    // A group that declares `data-lattice-pairs` is an item manager saying
    // "measure me". If it then yields no label/field pairs, the fixture does
    // not exercise it and NOTHING here was verified. Saying so out loud is
    // the only way a missing seed stops being invisible: the operator should
    // never be the mechanism that discovers a staggered form.
    if (panel.declaredManager && !allFields.length) {
      failures.push(
        `${width}px panel #${panel.index}${panel.panelName ? ` (${panel.panelName})` : ''} / ${panel.group}: declares data-lattice-pairs but rendered no ` +
        `label/field pairs — nothing was measured. Seed real content for this module in ` +
        `scripts/ui/seed_fixture.mjs; an empty manager cannot verify anything.`
      );
      continue;
    }

    if (!allFields.length) continue;

    // W0 is per COLUMN. A group that puts two label/field pairs on a row
    // (L6a — the Feature Cards manager) therefore has two columns inside it,
    // and each is held to the rule on its own. Bucketing is by the label's
    // own x, and ONLY for a group that declared it: an undeclared group
    // stays one bucket, so a genuine stagger still fails rather than being
    // explained away as a second column.
    const declared = panel.pairs || 1;
    const buckets = declared > 1
      ? [...new Map(allFields.map((f) => [f.labelBoxX, null])).keys()]
        .sort((a, b) => a - b)
        .map((x) => allFields.filter((f) => f.labelBoxX === x))
      : [allFields];

    if (declared > 1 && buckets.length > declared) {
      failures.push(
        `${width}px panel #${panel.index}${panel.panelName ? ` (${panel.panelName})` : ''} / ${panel.group}: declares ${declared} pair-column(s) but its labels ` +
        `start at ${buckets.length} different x-positions — the extra one is a stagger, not a column`
      );
    }

    for (const [bi, fields] of buckets.entries()) {
    const where = `${width}px panel #${panel.index}${panel.panelName ? ` (${panel.panelName})` : ''} / ${panel.group}`
      + (declared > 1 ? ` pair-column ${bi + 1}` : '');

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

    const placed = fields.filter((f) => !f.full);
    const fieldXs = [...new Set(placed.map((f) => f.fieldX))];
    if (fieldXs.length > 1) {
      failures.push(
        `${where}: fields start at ${fieldXs.length} different x-positions (${fieldXs.join('/')}px) — ` +
        placed.map((f) => `${f.name}@${f.fieldX}`).join(', ')
      );
    }

    const stretch = placed.filter((f) => f.stretchable);
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

    /*
     * THE PAIR IS STILL A PAIR — every control sits to the RIGHT of its own
     * label.
     *
     * Added 2026-08-16, from a failure this check watched go by. Social took
     * a second settings column, and its column heading was left occupying one
     * grid cell instead of spanning both tracks. That pushed every pair below
     * it along by one: the swatch rendered in the label track and the word
     * "Icon Fill" in the control track, all the way down the column. Nine
     * rows of scrambled panel, obvious the moment a person looked at it — and
     * a clean run here, because everything above measures whether the rows
     * agree with EACH OTHER, and a whole column shifted by one cell agrees
     * with itself perfectly.
     *
     * One pixel of tolerance: a control whose box starts exactly where its
     * label's does is a `full` field spanning the tracks, and those are
     * already out of scope above.
     */
    for (const f of placed) {
      if (f.fieldX + 1 < f.labelBoxX) {
        failures.push(
          `${where}: "${f.name}" renders its control LEFT of its own label ` +
          `(control@${f.fieldX}, label@${f.labelBoxX}) — the label/control pairing has slipped a cell, ` +
          'usually a heading or a wrapper taking a grid cell instead of spanning the tracks'
        );
      }
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
  }

  return failures;
}

/**
 * L6a's OTHER shape — a titled-column grid.
 *
 * `data-lattice-pairs` covers the manager that became one labelled block per
 * item (Feature Cards, Social). The other legal shape has no per-row labels
 * at all: the titles sit once in a header band and the rows are cells under
 * them, which is what the Navigation Links list is and what a genuinely
 * tabular manager should stay. That shape matched none of the pair selectors,
 * so it was skipped in silence — and the Links list had spent months with its
 * header and its rows computing their columns separately, "Slug" sitting 21px
 * right of the field it titles at 1440.
 *
 * A manager opts in with `data-lattice-columns="<n>"`, n being the number of
 * titled columns including the actions column. What is asserted:
 *   1. it rendered rows at all (an empty manager verifies nothing)
 *   2. every row puts n cells on its line
 *   3. down each column, every cell starts at the same offset and is the
 *      same width
 *   4. each header title sits over the column it titles
 *
 * (3) is measured RELATIVE TO THE ROW, not to the manager, because an
 * indented child row is a documented exemption (docs/UI_RULES.md, L8): it
 * slides sideways as a whole and keeps its widths. Measuring absolutely
 * would fail it for obeying a rule the operator asked for. The row's own
 * width is checked instead, which is what "the indent is paid back" means
 * and what would break if a child row ever started shrinking.
 */
function measureColumnGrids(page) {
  return page.evaluate(() => {
    const managers = [...document.querySelectorAll('[data-lattice-columns]')];
    return managers.map((m, index) => {
      const declared = Number(m.getAttribute('data-lattice-columns') || '0') || 0;
      const name = (m.className || '').split(/\s+/)[0] || `manager ${index}`;
      // TWO markup shapes wear this declaration.
      //
      // The Navigation Links list is a div grid: a header band, a rows
      // container, and rows, all reading one set of CSS tracks. The Table
      // module's editor is a real <table> — thead/tbody/tr/th/td — which
      // shares its tracks by construction rather than by agreement.
      //
      // Teaching the check the second shape is what lets a genuinely tabular
      // manager opt in at all. Before this, declaring on a <table> failed
      // with "rendered no rows", so the only options were to leave it
      // unmeasured or to rewrite a spreadsheet as a div grid.
      const isTable = m.tagName === 'TABLE';
      const header = isTable
        ? m.querySelector(':scope > thead > tr')
        : m.querySelector('.builder-nav-items-header');
      // Every direct grid cell of a row, in visual order. `display: contents`
      // wrappers have no box, so descend through them the same way the
      // lattice measurement does.
      const cellsOf = (row) => [...row.children].flatMap((child) => (
        // A table cell is already a box; only the div grid hides cells behind
        // `display: contents` wrappers that have none.
        getComputedStyle(child).display === 'contents' ? [...child.children] : [child]
      ));
      const rect = (el) => el.getBoundingClientRect();
      const rowsOf = (root) => (isTable
        ? [...root.querySelectorAll(':scope > tr')]
        : [...root.querySelectorAll(':scope > .builder-nav-item-row')]);
      const items = isTable ? m.querySelector(':scope > tbody') : m.querySelector('.builder-nav-items');
      const rows = items ? rowsOf(items) : [];
      const read = (row) => {
        const rr = rect(row);
        return {
          left: Math.round(rr.left),
          width: Math.round(rr.width),
          // A cell that spans the whole grid is its own line (the mega
          // menu's Feature column disclosure), not one of the n columns.
          cells: cellsOf(row)
            // A cell that spans the whole grid is its own line (the mega
            // menu's Feature column disclosure), not one of the n columns.
            // In a real table the equivalent is an explicit colspan.
            .filter((c) => (c.colSpan || 1) === 1)
            .filter((c) => getComputedStyle(c).gridColumnStart !== '1'
              || getComputedStyle(c).gridColumnEnd !== '-1')
            .map((c) => ({
              x: Math.round(rect(c).left - rr.left),
              w: Math.round(rect(c).width)
            }))
        };
      };
      return {
        index,
        name,
        declared,
        header: header ? read(header) : null,
        rows: rows.map(read)
      };
    });
  });
}

function assertColumnGrids(managers, width) {
  const failures = [];
  for (const m of managers) {
    const where = `${width}px ${m.name}`;

    if (!m.rows.length) {
      failures.push(
        `${where}: declares data-lattice-columns but rendered no rows — nothing was measured. ` +
        'Seed real content for this module in scripts/ui/seed_fixture.mjs; an empty manager ' +
        'cannot verify anything.'
      );
      continue;
    }
    if (!m.header) {
      failures.push(`${where}: declares data-lattice-columns but has no header band to title the columns`);
      continue;
    }

    const wrong = [m.header, ...m.rows].filter((r) => r.cells.length !== m.declared);
    if (wrong.length) {
      failures.push(
        `${where}: declares ${m.declared} column(s) but ${wrong.length} row(s) render ` +
        `${[...new Set(wrong.map((r) => r.cells.length))].join('/')} cell(s) — ` +
        'a row with an extra child is a row whose columns no longer match the others'
      );
      continue;
    }

    // The indent is paid back on the right (operator, 2026-08-14), so an
    // indented row is the same WIDTH as a top-level one even though it does
    // not start in the same place. A child row that shrank instead would be
    // the regression this catches.
    const widths = [...new Set([m.header, ...m.rows].map((r) => r.width))];
    if (widths.length > 1) {
      failures.push(
        `${where}: rows are ${widths.length} different widths (${widths.join('/')}px) — ` +
        'an indented row slides, it does not shrink (L8 exemption, docs/UI_RULES.md)'
      );
    }

    for (let c = 0; c < m.declared; c += 1) {
      const xs = [...new Set(m.rows.map((r) => r.cells[c].x))];
      if (xs.length > 1) {
        failures.push(
          `${where}: column ${c + 1} starts at ${xs.length} different offsets (${xs.join('/')}px) ` +
          'within its own row — the columns are being computed per row instead of once'
        );
      }
      const ws = [...new Set(m.rows.map((r) => r.cells[c].w))];
      if (ws.length > 1) {
        failures.push(
          `${where}: column ${c + 1} is ${ws.length} different widths (${ws.join('/')}px) — ` +
          'one row is taking width from the others'
        );
      }
      /*
       * The title has to sit OVER the column it titles. This is the one the
       * header/rows split actually broke: two flex containers dividing
       * different available widths drifted further apart with each column,
       * so by the third title "Slug" had wandered 21px clear of its field.
       *
       * Containment rather than a matching left edge, because a title is not
       * always left-aligned: "Action" titles three icon buttons that end on
       * the block edge, so it is right-aligned to that edge and its box
       * legitimately starts 36px right of the column's. A title that has
       * drifted leaves its column's span in one direction or the other, which
       * is what this catches — and it does catch the original: every one of
       * the three titles overhung its column's right edge.
       */
      const head = m.header.cells[c];
      const cell = m.rows[0].cells[c];
      if (head.x < cell.x - 1 || head.x + head.w > cell.x + cell.w + 1) {
        failures.push(
          `${where}: column ${c + 1}'s title (${head.x}..${head.x + head.w}px) is not inside the ` +
          `column it titles (${cell.x}..${cell.x + cell.w}px) — the header and the rows are not ` +
          'reading the same tracks'
        );
      }
    }
  }
  return failures;
}

const allFailures = [];
let panelsSeen = 0;
let cardsSeen = 0;
let columnGridsSeen = 0;

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
    // W9 runs at every width on purpose: a ceiling is only interesting on the
    // wide end, and 1440 alone would let a 1600px-only overflow through.
    allFailures.push(...assertCeiling(await measureWidths(page), width));
    const columnGrids = await measureColumnGrids(page);
    columnGridsSeen += columnGrids.length;
    allFailures.push(...assertColumnGrids(columnGrids, width));
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
    'That is a FAILURE, not a pass. The class is stamped on EVERY module\n' +
    'editor by ModuleEditorWrapper (components/builder/builder-module-card.tsx)\n' +
    'and on the section, cell and table-cell editors, so finding none means\n' +
    'either the fixture page has no modules (`npm run seed:ui-fixture`) or the\n' +
    'navigation above stopped working. Zero assertions is never a green result.'
  );
  process.exit(1);
}

if (allFailures.length) {
  console.error(`\n[check:panels] FAILED — ${allFailures.length} problem(s):\n`);
  for (const f of allFailures) console.error(`  ✗ ${f}`);
  console.error(
    '\nW0: one label width and one field width per panel. The two numbers live in\n' +
    'src/css/_variables.css (--builder-field-label-w / --builder-field-control-w).\n' +
    'W9: no field spans its container — the ceiling is --builder-field-long-max\n' +
    'in the same file. Fix them there — never by putting a width on one field.\n'
  );
  process.exit(1);
}

console.log(
  `[check:panels] OK — W0 and W9 hold across ${panelsSeen} panel(s) `
  + `and ${columnGridsSeen} titled-column manager(s) at ${WIDTHS.join('/')}px.`
);
