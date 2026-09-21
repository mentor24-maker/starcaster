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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, signIn, activateProject, BASE_URL } from './app-driver.mjs';
import { assertManagerRoom, bucketFields, findUncomparableManagers } from './lattice-room.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { cannotTell, verdict, EXIT_FAIL, EXIT_CANNOT_TELL } = await import('./harness-exit.mjs');
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
  cannotTell('check:panels',
    'lib/builder/template.js is missing — it is a generated file and a fresh worktree\n' +
    'does not have one.\n\nRun `npm run build:builder-template`.');
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
  cannotTell('check:panels',
    'Set UI_HARNESS_PROJECT_ID first — `npm run seed:ui-fixture` prints it.\n' +
    'Without a project the builder renders an empty page and every assertion\n' +
    'passes on zero panels, which is worse than failing.');
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

  // The Phone version of a row's style panel (device styles, task 86bc13a6v)
  // is a different arrangement of the same lattice — groups removed, a banner
  // on top — and it only exists after a click. ONE row is switched, so every
  // other row is still measured in its Desktop form.
  const switchedToPhone = await page.evaluate(() => {
    // The LAST row, not the first — the fixture's last row is the two-column
    // one (`PANEL_CHECK_MULTI_COLUMN_SECTION`), and several row controls exist
    // only where there is more than one column: Column Gap, Column Widths,
    // Match Column Heights, and Mobile Layout on the Phone panel. Switching a
    // single-column row measured a Phone panel those controls cannot appear
    // in, and reported a green that covered none of them (task 86bc14pgq).
    // It also keeps the sentence above true: one row goes to Phone, the rest
    // stay in their Desktop form.
    const panels = [...document.querySelectorAll('.builder-section-settings-panel')];
    const panel = panels[panels.length - 1];
    const button = panel && panel.querySelector('.builder-device-switch-button[title^="Phone"]');
    if (button) button.click();
    return Boolean(button);
  });
  if (!switchedToPhone) {
    return 'no row carried the Phone/Tablet/Desktop switch, so the Phone style panel could not be opened and measured';
  }
  await page.waitForTimeout(2000);

  // The same switch on a MODULE (device styles 3/4, task 86bc14pfq). A
  // module's Phone panel is its own arrangement — a banner, then the chrome
  // strip's fields and nothing else — so it is a panel this check has never
  // seen unless it clicks. ONE module is switched, for the same reason one
  // row is: every other module stays measured in its Desktop form.
  const moduleSwitchedToPhone = await page.evaluate(() => {
    const button = document.querySelector('.builder-module-card .builder-device-switch-button[title^="Phone"]');
    if (button) button.click();
    return Boolean(button);
  });
  if (!moduleSwitchedToPhone) {
    return 'no module carried the Phone/Tablet/Desktop switch, so a module\'s Phone panel could not be opened and measured';
  }
  await page.waitForTimeout(2000);

  // And the Phone version of a CELL's style panel (device styles 2 of 4, task
  // 86bc14pey) — a different arrangement again: the Overlay axis drops out,
  // the Frame axis keeps only its border rows, and a banner sits on top. ONE
  // cell is switched, so every other cell is still measured in its Desktop
  // form. Scoped to a column card so it cannot pick up the ROW's switch, which
  // the block above has already used.
  const switchedCellToPhone = await page.evaluate(() => {
    const button = document.querySelector(
      '.builder-column-card .builder-cell-panel .builder-device-switch-button[title^="Phone"]'
    );
    if (button) button.click();
    return Boolean(button);
  });
  if (!switchedCellToPhone) {
    return 'no cell carried the Phone/Tablet/Desktop switch, so the Phone cell panel could not be opened and measured';
  }
  await page.waitForTimeout(2000);

  // A FOURTH collapsed panel: the Reminders module's record cards, one per
  // reminder, each collapsed until clicked (`isRecordCollapsed` returns true
  // by default). Panel sweep 2/15 seeded two real records here and said in the
  // fixture itself that seeding them did NOT make them measurable, because
  // nothing opened them — so for as long as this check has existed the whole
  // reminder editor was one field, the module's Label, and everything the
  // panel actually contains was measured by nothing. That is the same blind
  // spot as the cell editor above and the table headings before it, and it is
  // ticket 86bbjt1b9's to close.
  //
  // Their expand button is named after the record (`Expand Signup Nudge`), so
  // there is no fixed label to match on — the card class is what identifies
  // them. Scoped to that class rather than to every `Expand *` button on the
  // page, because a blanket click would also open surfaces no rule has been
  // applied to yet and fail this ticket on other people's panels.
  const openedRecords = await page.evaluate(() => {
    let clicked = 0;
    document.querySelectorAll('.builder-reminder-record-card').forEach((card) => {
      const button = [...card.querySelectorAll('button[aria-label]')]
        .find((el) => /^expand /i.test(el.getAttribute('aria-label') || ''));
      if (button) {
        button.click();
        clicked += 1;
      }
    });
    return clicked;
  });
  if (openedRecords) await page.waitForTimeout(3000);
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
       * A MANAGER THAT REPEATS IS STILL ONE LATTICE (ticket 86bbjt1b9, round 2).
       *
       * `data-lattice-pairs` is read off the element that carries it, so a
       * manager rendered once per item in a list above it becomes N groups,
       * each measured against itself. That is the group-of-one blind spot the
       * `shared` unit below already exists to close, arriving by a different
       * route: the Reminders panel renders one criteria block inside every
       * record card, so criteria in card 1 and card 2 could drift apart by any
       * amount and both report clean. The CSS makes them one track on purpose
       * (list -> card -> settings -> criteria panel, subgrid all the way down)
       * and `docs/UI_RULES.md` records these very tracks once measuring 124px
       * and 118px, six pixels apart — so the drift is real and this check was
       * blind to it.
       *
       * There is no element to hang one declaration on: the blocks are
       * siblings under different cards, and their only common ancestor is the
       * list, which is already a manager declaring a different pair count. So
       * the repeated blocks NAME the lattice they share, and every box wearing
       * one name is measured as a single group against the PANEL — the same
       * "boxes plus an origin" shape, and the same reason for it.
       */
      /*
       * ONE TEST FOR "IS THIS BOX NAMED", NOT TWO (round 3 of the same ticket).
       *
       * The map below skipped a falsy name while the `units` list below
       * excluded a manager with `hasAttribute` — so a box carrying
       * `data-lattice-group=""` was in neither list: not measured as a group of
       * its own, not merged into a named one, and not reported as a manager
       * that declared pairs and rendered nothing. It would simply vanish from a
       * 690-panel sweep with the sweep still saying OK. Nothing writes an empty
       * value today; the point is that the two conditions have to BE one
       * condition, or they drift apart again the next time either is edited.
       */
      const latticeGroupName = (el) => el.getAttribute('data-lattice-group') || '';

      const named = new Map();
      for (const el of managers) {
        const name = latticeGroupName(el);
        if (!name) continue;
        if (!named.has(name)) named.set(name, []);
        named.get(name).push(el);
      }

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
        ...managers
          .filter((el) => !latticeGroupName(el))
          .map((el) => ({ els: [el], origin: el })),
        ...[...named].map(([name, els]) => ({ els, origin: panel, merged: true, mergedName: name })),
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
        : unit.merged
        ? `item manager ${unit.mergedName} — ${unit.els.length} box(es)`
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
      /*
       * A FOURTH PAIR SHAPE: `.bcm-control` (panel sweep 14/15, 86bbjt1be).
       *
       * The Blog Card Template designer renders inside the Card Manager's
       * settings panel and is built from none of the three shapes above — its
       * label is a bare `<span class="bcm-label">` stacked over the control.
       * So the panel's own content matched no selector here and was measured
       * by nothing: `check:panels` reported a clean green over a bar whose
       * seven Structure controls sat at seven different left edges across
       * three wrapped lines. Carousel's lesson word for word — a surface that
       * opts into neither attribute is not passing, it is absent.
       *
       * Read rather than converted. The obvious retrofit is `label.field`,
       * which is this same stacked shape — but W0 says that one is being
       * RETIRED, not styled, because it breaks the moment a control grows a
       * third child, and half these controls already have a number box and a
       * unit inside them.
       */
      const pairs = unit.els.flatMap((el) => [
        ...el.querySelectorAll('.builder-module-field'),
        ...el.querySelectorAll('.builder-setting-row, .builder-setting-row-full'),
        ...el.querySelectorAll('label.field'),
        ...el.querySelectorAll('.bcm-control'),
      ]).filter((el) => !el.closest('.builder-slider-item-grid, .builder-item-grid'))
      /*
       * A DECLARED MANAGER RUNS ITS OWN LATTICE, so its fields do not belong
       * to the axis column that happens to contain it (L6a). The two older
       * manager shapes were excluded above by class name; a manager on
       * `.builder-cards-panel-fields` was not, because until 2026-09-03 every
       * one of them sat OUTSIDE the schema columns — Carousel and Program List
       * are each half of a 50/50 editor. The Tag Cloud's tag manager is the
       * first to live inside an axis (it is a Content-axis field), and its
       * three short labels were being measured against that axis's own
       * "URL Param" and "Target Page": 12 failures describing a panel that is
       * correct, because two lattices were being held to one set of widths.
       *
       * The manager is still measured — it is its own group in `managers`
       * above — which is why the exclusion has to spare the group being
       * measured. Without that clause a manager would exclude its own fields
       * and report "declares data-lattice-pairs but rendered no rows", the
       * silent-pass failure this attribute exists to prevent.
       */
      .filter((el) => {
        const manager = el.closest('[data-lattice-pairs]');
        // `unit.els` rather than `group`, so a manager named into a merged
        // lattice keeps the fields of every box in it. For every other unit
        // `els` is `[group]` and this reads exactly as it did before.
        return !manager || unit.els.includes(manager);
      });
      // ITEM MANAGERS ARE OUT OF SCOPE, deliberately and not by accident.
      // A repeating card editor (social links, TOC entries, tag rows) is a
      // titled-column grid governed by L6, not a column of the panel
      // lattice — its fields legitimately share a row. Excluded here so a
      // future fixture WITH items in it reports honestly instead of failing
      // a rule that was never meant to cover them. Today they render empty
      // in the fixture, so without this line the pass would be luck.
      const fields = pairs.map((f) => {
        const label = f.querySelector('.builder-module-field-label, .builder-setting-label')
          || (f.matches('label.field') ? f.querySelector(':scope > span') : null)
          || (f.matches('.bcm-control') ? f.querySelector(':scope > .bcm-label') : null);
        let control = f.querySelector('.builder-module-field-control, .builder-setting-value')
          || (f.matches('label.field') ? f.querySelector(':scope > *:not(span)') : null)
          || (f.matches('.bcm-control') ? f.querySelector(':scope > *:not(.bcm-label)') : null);
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

        /*
         * A COMPOSITE CONTROL — an entry box sharing its slot with a button.
         *
         * Everything else here measures the SLOT, which for a picker is the
         * grid cell holding an input and a "Choose Image" button side by side.
         * A slot can be exactly the right width while the input inside it is a
         * third of its neighbours, and nothing above can tell: a `full` field
         * is dropped from the width comparisons by design (it is meant to be
         * wider), so the one field in the manager with something competing for
         * its room is the one field nobody measures.
         *
         * That shipped. Related Posts' Image row had a correct 312px slot
         * reaching the block's right edge, a 176px button, and a **96px**
         * input showing `/images/l` where the whole path had been visible
         * before — beside four 312px siblings, exit 0 (review round 2,
         * 2026-09-13). It is the slot-versus-control gap that also let the
         * breadcrumb Separator ship 165px short in sweep 10/15.
         *
         * So when a control holds a button AND an entry box, the entry box is
         * measured too. Only then: an alignment group is all buttons and no
         * entry, and a lone input is already the slot.
         */
        const entryW = (() => {
          if (!control.querySelector(':scope > button')) return null;
          const box = control.querySelector(
            ':scope > input[type="text"], :scope > select, :scope > textarea'
          );
          return box ? Math.round(box.getBoundingClientRect().width) : null;
        })();

        return {
          name: (label.textContent || '').trim() || '(unlabelled)',
          kind,
          full,
          /*
           * STACKED: the control sits BELOW its label rather than beside it,
           * on the same left edge. Read from geometry, never from a class, so
           * it describes what rendered rather than what the markup intended.
           *
           * It exists because `room` (labelW - labelTextW) measures the
           * horizontal gap between a label and its field, and a stacked pair
           * HAS no horizontal gap — its label box is the whole column, which
           * the field fills too. So the number that means "a notch pushing
           * every control sideways" in a beside-pair means nothing at all
           * here: it is just however much of the column the label's own word
           * happens not to cover. See the two guards that consume this.
           */
          stacked: Math.abs(cr.left - lr.left) <= 1 && cr.top >= lr.bottom - 1,
          entryW,
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
          /*
           * The control may BE the fixed-size input rather than wrap one.
           * Every `:scope >` test below asks whether the control CONTAINS a
           * checkbox / radio / swatch, which is true of a
           * `.builder-module-field-control` box and false of a bare
           * `<input type="checkbox">` — and the fourth pair shape above hands
           * us exactly that bare input. Without this line the designer's
           * Link Image checkbox and its three colour swatches would be held
           * to the stretchable field width and fail for keeping the natural
           * size W0's own exception tells them to keep.
           */
          stretchable: !exempt.includes(kind)
            && !control.matches('input[type="checkbox"], input[type="radio"], input[type="color"]')
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

/* ---------------------------------------------------------------------------
 * THE SEAM — the chrome and the settings column stacked with it
 * (ticket 86bbw8643, 2026-09-07. The instrument half of 86bbq065f.)
 *
 * Everything above measures each lattice group against ITSELF. Two groups
 * that each agree internally both pass while disagreeing with EACH OTHER,
 * and that blind spot is not hypothetical: measured on 2026-09-07, 35 of the
 * 37 panels carrying both a chrome strip and a settings column put their
 * controls on two different vertical lines — from -25px on `image` to +78px
 * on `breadcrumb` — while this check reported a clean pass over all 224
 * panels, as it had for weeks.
 *
 * `measure()` already has a cross-group unit for the two editors that opted
 * in by placing both halves on the `lattice-start` grid line. That is the
 * FIX declaring itself, so it can only ever measure a panel already fixed:
 * `feature-cards` and `program-list` are the only two, and they are the only
 * two that line up. An assertion that can only see the panels that pass is
 * not an assertion. This one reads geometry instead, so it sees every panel
 * whether or not it has been fixed.
 *
 * WHICH COLUMN IS "THE FIRST SETTINGS COLUMN". Not `columns[0]` — that was
 * the first thing tried and it is wrong twice over:
 *
 *   · The chrome is BELOW the settings columns on 30 of the 35, not above
 *     them. A module with its own settings editor renders the editor first
 *     and the shared chrome after it (builder-module-card.tsx). The panels
 *     with the chrome on top are the minority — `image`, `speech-bubble`,
 *     `crm-form`, `text` — so an assertion written for "the strip across the
 *     top" would have been written for a layout most panels do not have.
 *
 *   · `carousel` puts its Image Border column BESIDE the chrome, in its own
 *     track of a three-column editor. Nothing is stacked with the chrome
 *     there, so there is nothing to share an edge WITH, and comparing them
 *     reports a 389px "stagger" on a panel that is laid out correctly. A
 *     side-by-side column is a different lattice by design.
 *
 * So: a column is stacked with the chrome when their vertical bands are
 * DISJOINT — one genuinely above or below the other — and the leftmost such
 * column is the one that shares the panel's left edge with it. A panel where
 * no column is stacked is skipped, and named in the note rather than dropped
 * in silence.
 * ------------------------------------------------------------------------ */
function measureSeam(page) {
  return page.evaluate(() => {
    const panels = [...document.querySelectorAll('.is-lattice')]
      .filter((el) => !el.parentElement?.closest('.is-lattice'));

    /*
     * The box's two track offsets: where its LABEL track starts and where its
     * CONTROL track starts.
     *
     * They are read from different rows on purpose, and that is not a
     * shortcut. A `full` field spans both tracks by design, so its control
     * begins in the LABEL track — comparing one would report a stagger on a
     * row that is obeying the rule. But its LABEL is still an ordinary
     * occupant of the label track, and on `speech-bubble` the leftmost
     * column holds exactly one field and it is `full` ("Content"). Excluding
     * the whole row dropped that panel out of the comparison entirely while
     * it sat in the baseline as a recorded defect — recorded, and never
     * looked at, which is the shape of failure this whole check exists to
     * stop. So the label offset comes from the first labelled row of any
     * kind, and the control offset from the first row that actually occupies
     * the control track.
     */
    function trackOffsets(root, origin, without) {
      const rows = [...root.querySelectorAll('.builder-module-field, .builder-setting-row, .builder-setting-row-full')]
        // An item manager runs its own lattice (L6a) and is not part of the
        // panel column's tracks — the same exclusion `measure()` makes.
        .filter((el) => !el.closest('[data-lattice-pairs]'))
        // On a MERGED panel the chrome's rows are rows of this column, which is
        // the whole point — but they are the other half of the comparison, so
        // measuring the column with them in it would compare the merged set to
        // itself and could never fail (ticket 86bbq065f).
        .filter((el) => !without || !without.contains(el));

      const or = origin.getBoundingClientRect();
      const found = { name: null, labelX: null, controlX: null, controlName: null };

      for (const f of rows) {
        const label = f.querySelector('.builder-module-field-label, .builder-setting-label');
        if (!label) continue;
        const lr = label.getBoundingClientRect();
        if (!lr.width) continue;

        if (found.labelX === null) {
          found.name = (label.textContent || '').trim() || '(unlabelled)';
          found.labelX = Math.round(lr.left - or.left);
        }

        if (found.controlX !== null) continue;
        if (f.classList.contains('builder-module-field--full')) continue;

        let control = f.querySelector('.builder-module-field-control, .builder-setting-value');
        if (!control) continue;
        // A wrapper flattened into the grid (`display: contents`) has no box:
        // its rect is 0x0 at the viewport origin, which would turn the offset
        // into a raw coordinate. Descend to the first thing with a box.
        while (control && control.getBoundingClientRect().width === 0 && control.firstElementChild) {
          control = control.firstElementChild;
        }
        if (!control || control.getBoundingClientRect().width === 0) continue;
        found.controlName = (label.textContent || '').trim() || '(unlabelled)';
        found.controlX = Math.round(control.getBoundingClientRect().left - or.left);
      }

      return found.labelX === null ? null : found;
    }

    return panels.flatMap((panel, index) => {
      const panelName = (
        [...panel.classList].find((c) => c.startsWith('builder-module-editor--'))
          ?.replace('builder-module-editor--', '')
        || [...panel.classList].find((c) => c !== 'is-lattice' && c.endsWith('-settings'))
        || [...panel.classList].find((c) => c !== 'is-lattice')
        || ''
      );

      // The chrome's own strip, by DIRECT child — the same selector
      // `measure()` settled on, and for the same reason: the background
      // picker brings a strip of its own, and any-descendant would measure
      // that instead of the chrome.
      const chromeStrip = panel.querySelector('.builder-module-chrome > .builder-module-field-strip');
      const columns = [...panel.querySelectorAll('.builder-schema-panel-column')];
      if (!chromeStrip || !columns.length) return [];

      /*
       * MERGED — the chrome is INSIDE a settings column (ticket 86bbq065f).
       *
       * This is what the fix looks like: the card portals the chrome into a
       * slot in the first settings column and the boxes between are
       * `display: contents`, so the chrome's labels and controls are grid
       * items of that column and the two tracks are one measurement. There is
       * no seam left to measure across, because there are no longer two grids.
       *
       * It still has to be able to FAIL, or this branch would be a way of
       * passing by disappearing — the exact shape of the blind spot this whole
       * assertion was written against. So it is measured, not waved through:
       * the chrome's own rows against the column's other rows. Take the
       * flattening out and the chrome becomes ONE cell of the column that lays
       * its rows out inside itself, its offsets stop matching, and this fails
       * with the same message every other staggered panel gets.
       *
       * Read before the strip's box, because a `display: contents` element
       * measures 0x0 and the `!cr.width` guard below would drop the panel out
       * of the run entirely — silently, and taking its baseline entry with it.
       */
      const owningColumn = chromeStrip.closest('.builder-schema-panel-column');
      if (owningColumn) {
        const chrome = trackOffsets(chromeStrip, panel);
        const settings = trackOffsets(owningColumn, panel, chromeStrip);
        if (!chrome || !settings) return [{ index, panelName, nothingToCompare: true }];
        const bothControls = chrome.controlX !== null && settings.controlX !== null;
        return [{
          index,
          panelName,
          merged: true,
          chromeBelow: chromeStrip.getBoundingClientRect().top >= owningColumn.getBoundingClientRect().bottom - 2,
          chrome,
          settings,
          labelOut: settings.labelX - chrome.labelX,
          controlOut: bothControls ? settings.controlX - chrome.controlX : null
        }];
      }

      const cr = chromeStrip.getBoundingClientRect();
      if (!cr.width || !cr.height) return [];

      const stacked = columns
        .filter((c) => {
          const r = c.getBoundingClientRect();
          if (!r.width || !r.height) return false;
          // Vertically disjoint — one is genuinely above or below the other.
          // 2px of slack for sub-pixel rounding, not for judgement.
          return r.top >= cr.bottom - 2 || r.bottom <= cr.top + 2;
        })
        .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

      if (!stacked.length) {
        return [{ index, panelName, besideOnly: true }];
      }

      const column = stacked[0];
      const chrome = trackOffsets(chromeStrip, panel);
      const settings = trackOffsets(column, panel);
      if (!chrome || !settings) {
        return [{ index, panelName, nothingToCompare: true }];
      }

      const bothControls = chrome.controlX !== null && settings.controlX !== null;
      return [{
        index,
        panelName,
        chromeBelow: cr.top >= column.getBoundingClientRect().bottom - 2,
        chrome,
        settings,
        labelOut: settings.labelX - chrome.labelX,
        // Null, never 0, when one side has no row in the control track. A 0
        // here would read as "they agree" on a comparison that never happened.
        controlOut: bothControls ? settings.controlX - chrome.controlX : null
      }];
    });
  });
}

/**
 * The seam verdict, against the recorded baseline.
 *
 * A BASELINE, AND WHY IT IS NOT A SILENT CAP. Asserting this outright today
 * fails 35 panels, which would leave `check:panels` red for every other lane
 * until 86bbq065f lands — a permanently red gate is a gate everybody learns
 * to ignore, and that is a worse outcome than the stagger. So the panels
 * known to be staggered are recorded in `panel-seam-baseline.json`, and this
 * check enforces movement in one direction only:
 *
 *   · a staggered panel that is NOT recorded    -> FAIL, a new regression
 *   · a recorded panel that now LINES UP        -> FAIL, the record is stale
 *   · a recorded panel that is still staggered  -> counted, and named on
 *                                                  every run, green or red
 *
 * The second rule is what makes the list shrink rather than rot: a panel
 * cannot be fixed and left in the record, so the record can only ever get
 * shorter, and 86bbq065f's pull request empties it. The third is the reason
 * the whole ticket exists — a bounded check that does not say what it
 * excluded reads as a clean sweep, which is exactly the report this check
 * has been filing while the defect was in front of the operator.
 *
 * Aggregated BY PANEL NAME, not per instance: `event-calendar` renders twice
 * on the fixture page. A name is recorded if ANY instance of it is staggered,
 * and is stale only when EVERY instance lines up — otherwise fixing one of
 * two copies would report the record as stale and as a regression at once.
 */
function assertSeam(seams, width, baseline) {
  const failures = [];
  const skipped = [];
  /*
   * Recorded panels this run could only measure on HALF the seam — the label
   * track lines up and no row of either box occupies the control track. Not a
   * failure and emphatically not a pass: see the guard on the stale rule below.
   */
  const recordedHalfMeasured = [];
  const byName = new Map();

  for (const s of seams) {
    const name = s.panelName || `panel #${s.index}`;
    if (s.besideOnly) {
      skipped.push(`${name} — every settings column sits BESIDE the chrome, not stacked with it, `
        + 'so there is no shared edge to hold it to (a side-by-side column is its own lattice)');
      continue;
    }
    if (s.nothingToCompare) {
      skipped.push(`${name} — the chrome or the column rendered no comparable label/control pair`);
      continue;
    }
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(s);
  }

  for (const [name, instances] of byName) {
    const off = instances.filter((s) => s.labelOut !== 0 || (s.controlOut !== null && s.controlOut !== 0));
    const recorded = baseline.includes(name);

    if (off.length && !recorded) {
      const s = off[0];
      const control = s.controlOut === null
        ? 'its control track could not be compared (no row of either box occupies it)'
        // NAME THE ROWS THE NUMBER CAME FROM. The label offsets above are read
        // from the first LABELLED row of each box and the control offset from
        // the first row that actually OCCUPIES the control track, and those are
        // routinely different rows (a leading `full` field has a label and no
        // control). Quoting only the label-track names beside a control-track
        // delta invites the reader to measure two rows that did not produce it —
        // review round 2 hit exactly that, reading "Label"/"Separator" beside a
        // +78px delta that came from elsewhere. `controlName` was computed for
        // this and never read; it is read now.
        : `${s.controlOut >= 0 ? '+' : ''}${s.controlOut}px on the control track, `
          + `where the chrome's "${s.chrome.controlName}" and the column's "${s.settings.controlName}" `
          + `start their controls at ${s.chrome.controlX} and ${s.settings.controlX}`;
      failures.push(
        `${width}px panel #${s.index} (${name}): the chrome and the settings column ${s.chromeBelow ? 'above' : 'below'} it `
        + `do not share an edge — the chrome's "${s.chrome.name}" starts its label at ${s.chrome.labelX}, the column's `
        + `"${s.settings.name}" at ${s.settings.labelX} `
        + `(${s.labelOut >= 0 ? '+' : ''}${s.labelOut}px on the label track, ${control}). `
        + 'L8: the panel is one rectangle, so the chrome and the column stacked with it share one lattice. '
        + (s.merged
          ? 'This panel HAS the chrome in its settings column, so the two are already one box — what is broken is the '
            + 'flattening that puts the chrome\'s rows on the column\'s tracks. See THE CHROME JOINS THE FIRST '
            + 'SETTINGS COLUMN in src/css/_builder-react-overrides.css; the chrome, the slot and the strip inside it '
            + 'all have to be `display: contents` or the chrome takes one cell and lays its own rows out inside it.'
          : 'The mechanism is a chrome slot in the first settings column — see '
            + 'components/builder/builder-module-chrome-slot.tsx and THE CHROME JOINS THE FIRST SETTINGS COLUMN in '
            + 'src/css/_builder-react-overrides.css. A panel that renders no `BuilderModuleChromeSlot` keeps its '
            + 'chrome outside every column, which is what this is measuring. feature-cards and program-list reach '
            + 'the same place with subgrid instead, because their column is a direct grid item of the editor.')
      );
    }

    if (!off.length && recorded) {
      /*
       * STALE ON HALF A MEASUREMENT IS NOT STALE.
       *
       * `off` counts a null `controlOut` as agreement, which is right for the
       * regression rule — you cannot fail a panel on a comparison that did not
       * happen — and wrong for this one, which DEMANDS a name be deleted from
       * the record. A recorded panel whose labels line up while its control
       * track was never compared has been half looked at, and this file's own
       * rule is that the baseline may only ever shrink for a reason the check
       * actually MEASURED. Deleting it on that evidence retires a recorded
       * defect nobody has seen.
       *
       * Latent until now only because `speech-bubble` was deliberately kept
       * OUT of the baseline for precisely this reason; the next label-track-only
       * panel that gets recorded walks straight into it (review round 2).
       */
      if (instances.every((s) => s.controlOut === null)) {
        recordedHalfMeasured.push(name);
      } else {
        failures.push(
          `${width}px panel #${instances[0].index} (${name}): recorded in panel-seam-baseline.json as staggered, but its `
          + 'chrome and settings column now share an edge. Take it out of the baseline — the record may only ever '
          + 'shrink, and a fixed panel left in it is room for the next regression to hide in.'
        );
      }
    }
  }

  /*
   * A RECORDED PANEL THAT WAS NEVER REACHED IS NOT A PASS.
   *
   * Both rules above are driven by what the run measured, so a baseline entry
   * the run never saw — the module missing from the fixture, its panel
   * skipped, its name changed — costs nothing and says nothing. That is the
   * silence this ticket is about, one level down: the record would keep
   * asserting a defect exists on a panel nobody has looked at since it was
   * written down. `speech-bubble` was in exactly that state on the first run
   * of this check.
   */
  const unreached = baseline.filter((name) => !byName.has(name));

  /*
   * Panels held to the LABEL track only. Where one side of the seam has no
   * row occupying the control track — `speech-bubble`'s leftmost column is a
   * single `full` field — half the comparison did not happen, and a panel
   * that passed on half a comparison must not be counted with the ones that
   * passed on all of it.
   */
  const labelTrackOnly = [...byName.entries()]
    .filter(([, insts]) => insts.every((s) => s.controlOut === null))
    .map(([name]) => name);

  return {
    failures,
    skipped,
    unreached,
    labelTrackOnly,
    recordedHalfMeasured,
    compared: byName.size,
    recordedSeen: [...byName.keys()].filter((n) => baseline.includes(n)).length
  };
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

    /*
     * THE OTHER HALF OF THE ROOM RULE — the track can also be too WIDE.
     *
     * Everything below this line compares fields to EACH OTHER, so a block
     * whose every row shares the same wrong geometry agrees with itself
     * perfectly, and a block rendering a single row has nothing to compare at
     * all. Both were true of the Trigger panel on 2026-09-03, which is how two
     * deliberate breaks of the defect PR #449 had just fixed came back green.
     * This one is a property of the field set rather than a comparison, so it
     * still bites at n=1. `scripts/ui/lattice-room.mjs` carries the mechanism
     * and the measurements the ceiling was derived from.
     */
    failures.push(...assertManagerRoom(panel, width));

    // W0 is per COLUMN. A group that puts two label/field pairs on a row
    // (L6a — the Feature Cards manager) therefore has two columns inside it,
    // and each is held to the rule on its own. Bucketing is by the label's
    // own x, and ONLY for a group that declared it: an undeclared group
    // stays one bucket, so a genuine stagger still fails rather than being
    // explained away as a second column.
    const declared = panel.pairs || 1;
    const buckets = bucketFields(panel);

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

    /*
     * A WIDE FIELD MAY BE WIDER THAN ITS NEIGHBOURS, NEVER NARROWER.
     *
     * The assertion that goes with the composite measurement above. A picker
     * earns its wide row because it needs MORE room than an ordinary field;
     * ending up with less is the defect, whatever the slot around it measures.
     *
     * The baseline is the narrowest ordinary stretchable field in this same
     * group, so it is derived rather than a number somebody chose: on the
     * five-track grid the picker's input came to 198px beside 141px fields and
     * passes, and on the one-pair-per-row grid it came to 96px beside 312px
     * fields and does not.
     */
    const narrowest = fieldWidths.length ? Math.min(...stretch.map((f) => f.fieldW)) : null;
    if (narrowest !== null) {
      /*
       * ONLY the fields the comparison above DROPS — the `full` ones.
       *
       * The first version of this ran over every field and was wrong in a way
       * worth keeping: it failed 14 panels on "V Margin" and "H Margin", whose
       * control is an input with a 28px stepper beside it (532px inside a
       * 560px slot). The reason that was wrong is ONE reason, not two: those
       * fields are in `stretch`, so `narrowest` is drawn from their own slots,
       * and the rule was comparing a field against itself and calling the
       * stepper a defect.
       *
       * REVIEW ROUND 3 (2026-09-14) corrected this comment, and the sentence
       * it removed is worth naming because it is the kind a later sweep reads
       * to decide it need not look. It said a non-`full` composite is
       * "already covered — they are in `stretch`, so the width assertion
       * measures them". IT DOES NOT. The width assertion above compares
       * `fieldW`, which is the SLOT; no assertion anywhere reads `entryW`
       * except this one. A non-`full` composite's entry box is measured by
       * nothing — it is merely not FALSELY failed, which is a different thing
       * from being checked.
       *
       * WHAT THIS STILL DOES NOT SEE, stated plainly so nobody has to
       * rediscover it. Line ~343 drops a `full` field from the field list
       * ENTIRELY unless its group declares `data-lattice-pairs`, and that drop
       * happens before any of this runs. So this assertion reaches a picker
       * inside a DECLARED manager and no other picker in the app. Measured at
       * 1440 while reviewing this PR: 4 of the app's 14 composite picker
       * fields are in undeclared ordinary columns and unmeasured, and 3 of
       * those show a 207px entry box inside a correct 373px slot beside 373px
       * siblings — `blog-post-card` Featured Image, `blog-author-bio` Photo,
       * `blog-newsletter-subscribe` Image URL. Identical on `main`, so
       * pre-existing rather than introduced here. The exemption and its reason
       * are written down in `docs/UI_RULES.md` ("What the panel checker cannot
       * see"), and `builder-lattice-inventory.test.tsx` pins that table to this
       * code so it cannot rot quietly.
       *
       * A `full` field inside a declared manager is the one shape nothing else
       * checks, which is the whole reason this exists. Narrowing to it is not
       * a tolerance; it is the scope this assertion actually has.
       */
      for (const f of fields.filter((x) => x.full)) {
        // Two pixels of rounding, not a tolerance for being short: a control
        // that is genuinely squeezed is short by a third, never by one.
        if (f.entryW !== null && f.entryW !== undefined && f.entryW + 2 < narrowest) {
          failures.push(
            `${where}: "${f.name}" has a ${f.fieldW}px slot but its entry box is only ` +
            `${f.entryW}px — a button is taking the room. The narrowest ordinary field ` +
            `here is ${narrowest}px, and a wide field may be wider than its neighbours, ` +
            'never narrower (the slot reaches the right edge, so nothing else can see this)'
          );
        }
      }
    }

    // The room the operator asked for: "40px more than the longest string".
    // Without this the check would pass on tracks that fit the text exactly,
    // which is the cramped look the rule was written against.
    // Beside-pairs only — see `stacked` above. A stacked pair's label box IS
    // the column, so this subtraction measures the unused tail of a word, not
    // the room between a label and a field, and both bounds are meaningless on
    // it. What still governs a stacked column is every assertion above this
    // one: same label x, same field x, one stretchable field width, no cropped
    // label. Those are the four that caught the real defect on this panel.
    const room = fields.filter((f) => !f.stacked)
      .map((f) => f.labelW - f.labelTextW).filter((n) => Number.isFinite(n));
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
    /*
     * THE NAME HAS TO BE UNIQUE, because a run-level tally is keyed by it.
     *
     * It used to be the FIRST class token, which for the flat shape is the
     * generic `builder-item-grid` — shared today by three variants in
     * `src/css/_builder-react-overrides.css` (--crumbs, --prices, --sessions)
     * and by every future adopter. One token for several managers means the
     * per-run Map collapses them into a single entry: the count reads 1 when
     * there are 2, the second manager's tracks and rows are thrown away, and
     * its widths append to the first's list so the note prints
     * `(at 1440/1600/1920/1440/1600/1920px)`. That is the same defect the
     * single-pair count paid for on 2026-09-05 — a count that reads as a
     * verdict while being quietly wrong — arriving through the key instead of
     * through the arithmetic (review round 1, task 86bbjt1b6).
     *
     * The full class string separates the variants, and an ordinal separates
     * two instances of the SAME component, so the identity is unique by
     * construction rather than by nobody having adopted it yet. It is stable
     * across the three widths because the DOM is: the settings panel is a
     * fixed-width sidebar and the same elements are measured in the same
     * document order at every width.
     */
    const seenClasses = new Map();
    return managers.map((m, index) => {
      const declaredRaw = m.getAttribute('data-lattice-columns');
      const declared = Number(declaredRaw || '0') || 0;
      const classes = (m.className || '').trim().replace(/\s+/g, ' ');
      const ordinal = (seenClasses.get(classes) || 0) + 1;
      seenClasses.set(classes, ordinal);
      const name = `${classes || `manager ${index}`}${ordinal > 1 ? ` #${ordinal}` : ''}`;
      /*
       * A DECLARATION THAT IS NOT A POSITIVE NUMBER STOPS HERE, measuring
       * nothing, so the failure is reported instead of the process hanging.
       *
       * `Number(x || '0') || 0` turns `data-lattice-columns=""`, `="0"` and a
       * typo like `="three"` all into 0 — and the flat path steps the cells
       * with `i += declared`, which at 0 never advances. That loop runs inside
       * `page.evaluate` pushing a line per iteration, so the gate does not
       * fail: it hangs and then dies on memory, having said nothing at all.
       * A check that cannot report is worse than one that fails (review round
       * 1, task 86bbjt1b6). The nav and table shapes never hung, but they gave
       * a confusing "declares 0 column(s) but N row(s) render 3 cell(s)", so
       * the guard is taken once here for all three shapes and names the
       * attribute's actual value.
       */
      if (declared < 1) {
        return { index, name, declared, declaredRaw, shape: 'undeclared', header: null, rows: [] };
      }
      // THREE markup shapes wear this declaration.
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
      //
      // The THIRD is `.builder-item-grid` (breadcrumb, panel sweep 10/15,
      // 2026-09-13): ONE flat grid whose header titles and every row's cells
      // are all direct children, laid out in document order. It matched
      // neither selector above, so it could not opt in at all — and
      // `check_panels` excludes `.builder-item-grid` from the ordinary
      // lattice measurement too, so the largest thing in the breadcrumb panel
      // had never been measured by anything. That is the Carousel finding
      // again: a manager that opts into neither attribute is not passing, it
      // is absent, and the two read identically from the summary line.
      //
      // WHAT IS AND IS NOT WORTH ASSERTING ON THIS SHAPE. A flat grid cannot
      // compute its columns per row — there is one grid and one set of
      // tracks, and every child stretches to the track it lands in. Measured
      // on the breadcrumb manager, the header spans and the row inputs sit at
      // exactly the same offsets and widths (0/121, 129/121, 258/86), so the
      // four comparative assertions below are satisfied BY CONSTRUCTION and
      // could not fail whatever the CSS said. Saying that out loud is the
      // point of the note this run prints (docs/UI_RULES.md, "what a green
      // run on a declared block is, and is not, evidence of").
      //
      // What CAN fail here, and does: a row rendering a different number of
      // children from the header — which silently shifts every cell after it
      // — and a track list that has drifted from the declared count. Those
      // are asserted in `assertColumnGrids`, and both are real.
      //
      // THE FIRST OF THOSE ONLY BECAME REAL ON 2026-09-13 (review round 2,
      // task 86bbjt1b6), and how it failed before is worth keeping. The rows
      // were cut out of the cell list with a fixed stride — `i += declared`
      // — so every chunk held exactly `declared` cells by arithmetic, and the
      // assertion under it could only ever fire when the TOTAL was not a
      // multiple of `declared`. The thing it was documented as catching was
      // the one thing it could not see.
      //
      // Chunking by the grid row instead does not fix it, which was measured
      // in the browser before this was written rather than reasoned about.
      // Auto-placed cells fill `declared` tracks per row whatever the markup
      // did, so a grid row ALWAYS holds exactly `declared` cells: on a panel
      // deliberately broken into a 2-cell item and a 4-cell item, grouping by
      // resolved grid row, by wrap in x, and by y all returned 3/3/3/3.
      // (`gridRowStart` computes to `auto` here in any case — Chromium does
      // not resolve auto-placement into computed style.) A missing cell does
      // not SHORTEN a row; it shifts every later cell up one slot, which is
      // the visible defect and is invisible to every geometric reading.
      //
      // So the row has to be DECLARED. `data-lattice-row` carries the item
      // index (or `header`) on each cell, and the cells are grouped by it —
      // the check then holds what the markup says is one row to `declared`
      // cells, and names the item that is wrong.
      const isTable = m.tagName === 'TABLE';
      const navItems = m.querySelector('.builder-nav-items');
      const navHeader = m.querySelector('.builder-nav-items-header');
      // Flat only when neither of the other two shapes is present. A nav
      // manager that LOST its header band still has `.builder-nav-items`, so
      // it stays a nav manager and keeps failing with "no header band" rather
      // than being quietly re-read as a flat grid.
      //
      // `display` is readable only on an element that GENERATES a box: with
      // `display: none` on the manager itself it computes to `none`, never
      // `grid`. Taking the shape from it while boxless dropped a hidden flat
      // grid into the nav branch below, which then reports "rendered no rows
      // - nothing was measured. Seed real content for this module in
      // scripts/ui/seed_fixture.mjs" - a confident instruction to go fix a
      // fixture, about a reading that was never taken (review round 3, task
      // 86bbjt1b6). The ancestor-hidden case reached the CANNOT TELL guard
      // below because the ancestor's `none` does not reach the manager's own
      // computed `display`; the manager hidden ON ITSELF did not, and it is
      // the same class of wrong verdict the guard was written against.
      //
      // So ask whether there is a box FIRST, and when there is none, let a
      // non-table non-nav manager be read as the flat shape its markup says
      // it is. Nothing is measured either way - the guard inside the branch
      // turns it into a blind spot. The two other shapes are decided by
      // markup (`tagName`, a `querySelector`), both of which read correctly
      // on a hidden element, so their behaviour is unchanged here; a boxless
      // nav or table manager still goes green, which is pre-existing and
      // named in docs/UI_RULES.md rather than fixed under this ticket.
      const hasBox = m.getClientRects().length > 0;
      const isFlat = !isTable && !navItems && !navHeader
        && (!hasBox || getComputedStyle(m).display.includes('grid'));
      const header = isTable
        ? m.querySelector(':scope > thead > tr')
        : navHeader;
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
      const items = isTable ? m.querySelector(':scope > tbody') : navItems;
      const rows = items ? rowsOf(items) : [];
      /*
       * A flat grid has no row ELEMENT to measure, so a line is read from the
       * cells the markup DECLARES to be one row, via `data-lattice-row`. Its
       * box is the manager's own content box rather than the span of its
       * cells: every line of a flat grid occupies the same tracks, and taking
       * min-left..max-right of the cells would make the header band — three
       * short titles — read as a narrower "row" than the inputs under it and
       * fail the equal-widths assertion for doing exactly what it should.
       *
       * Returns `null` when the cells carry no `data-lattice-row` at all:
       * that is a reading this check CANNOT take, not a pass. See the long
       * comment above for why no geometric grouping can substitute.
       */
      const flatLines = () => {
        const mb = rect(m);
        const cells = [...m.children]
          .flatMap((c) => (getComputedStyle(c).display === 'contents' ? [...c.children] : [c]))
          .filter((c) => {
            const s = getComputedStyle(c);
            if (s.display === 'none') return false;
            // A cell spanning the whole grid is its own line (the sub-row an
            // item grid puts under its primary row), not one of the n columns.
            return !(s.gridColumnStart === '1' && s.gridColumnEnd === '-1');
          });
        if (!cells.length) return [];
        // EVERY cell must declare its row, not merely one of them. A partial
        // stamping would silently drop the undeclared cells out of the
        // measurement, which is the "measured less, went green" failure this
        // whole file exists against.
        const undeclared = cells.filter((c) => c.getAttribute('data-lattice-row') === null);
        if (undeclared.length) return { undeclared: undeclared.length, total: cells.length };
        // Grouped by the declared key, in first-appearance order, so the
        // header (`data-lattice-row="header"`, stamped first) stays line 0.
        const groups = new Map();
        for (const c of cells) {
          const key = c.getAttribute('data-lattice-row');
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(c);
        }
        return [...groups.entries()].map(([key, group]) => ({
          key,
          left: Math.round(mb.left),
          width: Math.round(mb.width),
          cells: group.map((c) => ({
            x: Math.round(rect(c).left - mb.left),
            w: Math.round(rect(c).width)
          }))
        }));
      };
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
      if (isFlat) {
        /*
         * A MANAGER WITH NO LAYOUT BOX CANNOT BE READ, AND MUST NOT BE
         * FAILED (review round 2, task 86bbjt1b6).
         *
         * `grid-template-columns` resolves to used pixel values only for an
         * element that generates a box. Inside a `display: none` ancestor it
         * computes back to the SPECIFIED value — for the crumbs grid,
         * `minmax(96px, 1fr) minmax(96px, 1.4fr) max-content` — which the
         * whitespace parser below counts as five tracks against a declared
         * three, and reports as "the markup and grid-template-columns have
         * drifted apart" with exit 1. That is a confident verdict about a
         * drift that has not happened, from a reading that was never taken.
         *
         * MEASURED, not assumed, and NOT reachable through today's three
         * declarers: a collapsed module card unmounts its editor rather than
         * hiding it, so there is no live path to a hidden declared manager.
         * Hiding the crumbs grid's ancestor by hand in the browser reproduces
         * the five-track miscount exactly, and this guard turns it into a
         * CANNOT TELL. It is a guard against a future hidden surface, not a
         * live bug — said out loud so a green run over it is never counted as
         * evidence of anything.
         */
        if (!hasBox) {
          return { index, name, declared, shape: 'boxless', header: null, rows: [] };
        }
        const lines = flatLines();
        // The cells do not say which row they belong to, so no per-row
        // reading exists to take. Reported as its own shape rather than
        // measured around.
        if (lines && !Array.isArray(lines)) {
          return {
            index,
            name,
            declared,
            shape: 'unstamped',
            undeclared: lines.undeclared,
            cellTotal: lines.total,
            header: null,
            rows: []
          };
        }
        return {
          index,
          name,
          declared,
          shape: 'flat',
          // The resolved track list, so the declaration can be held to the
          // CSS rather than to itself. `repeat()` and `fr` are already
          // resolved to used pixel values here, so splitting on whitespace
          // is a real count — but only after two things are taken out of the
          // string first, or this assertion reports a drift that did not
          // happen. NAMED GRID LINES (`[label] 121px [field] 213px`) are part
          // of the computed value and would each count as a track. And an
          // element with no explicit `grid-template-columns` computes to the
          // keyword `none`, which would split to a single token and read as
          // one track; that is reported as 0 and failed on its own message
          // rather than counted.
          //
          // MEASURED, rather than assumed (review round 1, task 86bbjt1b6).
          // The named-line half is live: putting `[label] … [url] … [action]
          // … [end]` on the crumbs grid makes the old parser count SEVEN
          // tracks against a declared 3 and fail for a drift that did not
          // happen; with the strip it stays 3 and passes. The `none` half is
          // defensive and unreachable today — probed in this browser, a grid
          // computes `none` only when it has NO children (an implicit grid
          // WITH children resolves to used pixel widths), and a manager with
          // no children is already stopped above by the no-rows check, which
          // says something more useful. It is kept so `none` can never be
          // counted as one track if that ordering ever changes.
          tracks: (() => {
            const raw = getComputedStyle(m).gridTemplateColumns.trim();
            if (!raw || raw === 'none') return 0;
            return raw.replace(/\[[^\]]*\]/g, ' ').trim().split(/\s+/)
              .filter(Boolean).length;
          })(),
          trackSource: getComputedStyle(m).gridTemplateColumns.trim(),
          /*
           * THE HEADER IS THE GROUP THAT SAYS IT IS THE HEADER, NOT THE FIRST
           * ONE (review round 3, task 86bbjt1b6).
           *
           * `lines` is the declared groups in first-appearance order, so
           * `lines[0]` is the header band when one exists - and ITEM 0 when
           * one does not. That silently promoted the first trail item into
           * the header's role, which made the "declares data-lattice-columns
           * but has no header band to title the columns" failure below
           * unreachable on this shape: there was always a header, so the one
           * thing `data-lattice-columns` exists to assert could not fire.
           * Broken on purpose and watched: deleting the three
           * `builder-item-grid-header` spans from the crumbs grid gave exit
           * 0, and reported "2 row(s)" where three items render, because one
           * of them was being counted as the titles.
           *
           * Picking it by key also makes `rows` mean what it says. A grid
           * that renders ONLY a header band now has no rows and fails on the
           * "rendered no rows" message above, which is the true thing to say
           * about it.
           */
          header: lines.find((l) => l.key === 'header') || null,
          rows: lines.filter((l) => l.key !== 'header')
        };
      }
      return {
        index,
        name,
        declared,
        shape: isTable ? 'table' : 'nav',
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

    // The declaration itself is unusable — see the guard in
    // `measureColumnGrids`. Nothing was measured, on purpose, so this is the
    // only thing worth saying about this manager.
    if (m.shape === 'undeclared') {
      failures.push(
        `${where}: data-lattice-columns is "${m.declaredRaw === null ? '' : m.declaredRaw}", ` +
        'which is not a column count — it must be a whole number of 1 or more, ' +
        'counting the actions column. Nothing on this manager was measured.'
      );
      continue;
    }

    // No box, so no reading — collected as a blind spot by the caller and
    // reported as CANNOT TELL. Deliberately NOT a failure: the honest answer
    // to "did this manager's tracks drift?" is that nobody could look.
    if (m.shape === 'boxless') continue;

    /*
     * A flat grid whose cells do not say which row they belong to. There is
     * no per-row reading to take on this shape, and the assertion that used
     * to stand here was satisfied by arithmetic rather than by measurement
     * (review round 2, task 86bbjt1b6) — so this is a failure naming the
     * fix, not a quiet pass over a manager the check cannot read.
     */
    if (m.shape === 'unstamped') {
      failures.push(
        `${where}: is a flat grid whose cells carry no data-lattice-row — ` +
        `${m.undeclared} of ${m.cellTotal} cell(s) are unstamped, so there is no way to tell ` +
        'which cells were meant to be one row. Stamp every cell with the item index it ' +
        'belongs to (data-lattice-row={index}, and "header" on the title band). Grouping ' +
        'by geometry cannot substitute: auto-placed cells fill the tracks whatever the ' +
        'markup did, so a broken row still reads as the declared number of cells.'
      );
      continue;
    }

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

    /*
     * A FLAT grid's declaration held to the CSS rather than to itself.
     *
     * On this shape the four comparative assertions below are satisfied by
     * construction — one grid, one set of tracks, every child stretched to
     * the track it lands in — so they can never fail here and a green run
     * over them is worth nothing on its own. This is the assertion that CAN
     * fail: the number of tracks the CSS actually resolved against the count
     * the markup declared. They drift the moment somebody adds a column to
     * one and forgets the other, and every cell after the drift lands in the
     * wrong column with no error anywhere.
     */
    if (m.shape === 'flat' && m.tracks === 0) {
      failures.push(
        `${where}: declares ${m.declared} column(s) but its CSS resolves no explicit tracks ` +
        `(grid-template-columns: ${m.trackSource || 'none'}) — the columns are being created ` +
        'implicitly, so there is nothing for the declaration to be held to and the cells land ' +
        'wherever the browser puts them'
      );
      continue;
    }
    if (m.shape === 'flat' && m.tracks !== m.declared) {
      failures.push(
        `${where}: declares ${m.declared} column(s) but its CSS resolves ${m.tracks} track(s) — ` +
        'the markup and grid-template-columns have drifted apart, so the cells after the ' +
        'difference land in the wrong column'
      );
      continue;
    }

    /*
     * The row that renders the wrong number of cells, NAMED. On a flat grid
     * this is the assertion the whole `data-lattice-row` stamp exists for:
     * an item rendering two cells where the header renders three does not
     * shorten a grid row, it shifts every later cell up one slot, so the
     * panel is visibly scrambled while every measurable row still holds
     * three. Which row is wrong is the only useful thing to say about it,
     * and the old message could not say it — it was reporting a count that
     * arithmetic had already guaranteed.
     */
    const wrong = [m.header, ...m.rows].filter((r) => r.cells.length !== m.declared);
    if (wrong.length) {
      /*
       * The stamp is a STRING, and only the flat shape sets one at all.
       * `Number(r.key) + 1` printed `item NaN` for any non-numeric key other
       * than "header" - a future manager stamping `item.id`, say - which
       * loses the single detail the whole stamp exists to report, on the one
       * message whose job is to name the row that is wrong (review round 3,
       * task 86bbjt1b6). A key that is not a run of digits is quoted back
       * verbatim instead. Tested for digits rather than with `Number()`,
       * which reads "" and " " as 0 and would report them as `item 1`.
       */
      const rowName = (r) => {
        if (r.key === undefined) return 'row';
        if (r.key === 'header') return 'the header';
        return /^\d+$/.test(r.key) ? `item ${Number(r.key) + 1}` : `item "${r.key}"`;
      };
      const named = wrong
        .map((r) => `${rowName(r)} renders ${r.cells.length}`)
        .join(', ');
      failures.push(
        `${where}: declares ${m.declared} column(s) but ${wrong.length} row(s) render ` +
        `${[...new Set(wrong.map((r) => r.cells.length))].join('/')} cell(s) (${named}) — ` +
        'a row with a missing or extra child shifts every cell after it into the wrong column'
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

/*
 * The recorded stagger. Read rather than imported so a malformed or missing
 * file is a CANNOT TELL with the filename in it, not a raw JSON stack: the
 * baseline is the instrument's own calibration, and a check that cannot read
 * its calibration has not measured anything.
 */
/* ---------------------------------------------------------------------------
 * THE STRIP — dead space between a column's content and the column's edge
 * (ticket 86bbzux9m, 2026-09-20)
 *
 * Everything above measures a column's rows against EACH OTHER. A column
 * whose rows all agree, all stop at the same x, and all sit inside a box that
 * is 647px wider than they are passes every one of those assertions — and
 * reads as loose rows floating in a rectangle, which is the complaint that
 * opened the panel sweep in the first place (Dane, 2026-08-13).
 *
 * WHY THE SLOT MEASUREMENTS ABOVE CANNOT SEE IT. They compare a field's slot
 * to the other slots in the same column, and in all 19 panels reported on
 * 2026-09-13 the slots were correct — identical widths, identical offsets.
 * The defect is one level out: the column BOX against the tracks it resolved.
 * That is why every one of those panels had been passing this check for weeks.
 *
 * TWO NUMBERS, because the same fight between W9 and L8 surfaces two ways and
 * a check that asked only one of them would call the other a pass:
 *
 *   · STRIP — the column box minus the sum of its tracks. A grid item
 *     stretches to its area and a child of a column-flex box stretches to the
 *     container, both by default, so a column in either lands wider than its
 *     content with a hairline drawn the full width. Measured on `main` at
 *     1440: Motion 679px, Video 647px, Slideshow Format 120px.
 *
 *   · CONTROL TRACK OVER THE CEILING — the other half. `.builder-project-data-picker`
 *     is a select plus an input, so W9's per-control 560px cap does not bound
 *     the pair; at 846px the composite SIZES the `max-content` track and every
 *     correctly-capped control in the column ends 286px short of it. Here the
 *     dead space is inside the rows rather than beside them, and the strip
 *     number alone reads 0.
 *
 * SUBGRID COLUMNS ARE EXCLUDED, and that is a real exclusion rather than a
 * convenience: a `grid-template-columns: subgrid` column takes its tracks
 * from the area it occupies, so it MUST fill that area — Feature Cards and
 * Program List share the chrome's lattice exactly that way. `getComputedStyle`
 * reports the literal keyword for them, with no track lengths to sum, so a
 * strip computed from it would be the whole column width: a fabricated
 * failure on the two panels that are most correct. They are counted and named
 * in the run note rather than dropped in silence.
 *
 * TOLERANCE. 40px — `--builder-field-room`, the gap the lattice already puts
 * between a label and its control, and the number the ticket's acceptance
 * criteria name. Sub-pixel track rounding is a fraction of a pixel, so
 * nothing sits near this boundary: the smallest real defect measured was 65px
 * and the largest non-defect 0.
 * ------------------------------------------------------------------------ */
const STRIP_TOLERANCE = 40;

function measureColumnStrips(page) {
  return page.evaluate(() => {
    const cap = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--builder-field-long-max')
    ) || 560;
    const panels = [...document.querySelectorAll('.is-lattice')]
      .filter((el) => !el.parentElement?.closest('.is-lattice'));

    return panels.flatMap((panel, index) => {
      const panelName = (
        [...panel.classList].find((c) => c.startsWith('builder-module-editor--'))
          ?.replace('builder-module-editor--', '')
        || [...panel.classList].find((c) => c !== 'is-lattice' && c.endsWith('-settings'))
        || [...panel.classList].find((c) => c !== 'is-lattice')
        || ''
      );
      return [...panel.querySelectorAll('.builder-schema-panel-column')].map((col) => {
        const box = col.getBoundingClientRect();
        // A collapsed or hidden column measured nothing; saying so is the
        // difference between this and a pass over what it could not see.
        if (box.width < 5) return { index, panelName, shape: 'boxless', title: '' };
        const declared = getComputedStyle(col).gridTemplateColumns;
        if (declared.includes('subgrid')) return { index, panelName, shape: 'subgrid', title: '' };
        const tracks = declared.split(' ').map(parseFloat).filter((n) => !Number.isNaN(n));
        if (!tracks.length) return { index, panelName, shape: 'trackless', title: '' };
        const title = (
          col.querySelector(':scope > .builder-schema-group-title, :scope > .builder-cards-panel-heading')
            ?.textContent || ''
        ).trim().slice(0, 40);
        const sum = tracks.reduce((a, b) => a + b, 0);
        return {
          index,
          panelName,
          shape: 'measured',
          title,
          columnWidth: Math.round(box.width),
          trackSum: Math.round(sum),
          strip: Math.round(box.width - sum),
          controlTrack: Math.round(tracks[tracks.length - 1]),
          cap,
        };
      });
    });
  });
}

function assertColumnStrips(columns, width) {
  const failures = [];
  for (const c of columns.filter((c) => c.shape === 'measured')) {
    const where = `${width}px panel #${c.index}${c.panelName ? ` (${c.panelName})` : ''}` +
      `${c.title ? `, column "${c.title}"` : ''}`;
    if (c.strip > STRIP_TOLERANCE) {
      failures.push(
        `${where}: the column box is ${c.columnWidth}px but its tracks resolve to ` +
        `${c.trackSum}px — ${c.strip}px of dead space to the right of every row in it ` +
        `(tolerance ${STRIP_TOLERANCE}px).\n` +
        'The column is being STRETCHED by whatever box holds it — a grid item stretches to\n' +
        'its area, a child of a column-flex box to the container. Bound the block: give the\n' +
        'column `justify-self: start` / `align-self: start` where it sits, never a width of\n' +
        'its own (W0), and never by widening the controls to fill it (W9).'
      );
    }
    if (c.controlTrack > c.cap) {
      failures.push(
        `${where}: the control track is ${c.controlTrack}px, over the ${c.cap}px ceiling (W9).\n` +
        'Every control capped at the ceiling therefore stops short of the one row that set\n' +
        'the track, which is the notch L8 names. The usual cause is a COMPOSITE control —\n' +
        '`.builder-project-data-picker` is a select plus an input, and the per-control cap\n' +
        'does not bound the pair. Bound the composite, do not raise the ceiling.'
      );
    }
  }
  return failures;
}

const SEAM_BASELINE_PATH = path.join(ROOT, 'scripts', 'ui', 'panel-seam-baseline.json');
let SEAM_BASELINE;
try {
  SEAM_BASELINE = JSON.parse(fs.readFileSync(SEAM_BASELINE_PATH, 'utf8')).staggered;
  if (!Array.isArray(SEAM_BASELINE)) throw new Error('no "staggered" array');
} catch (err) {
  cannotTell('check:panels',
    `scripts/ui/panel-seam-baseline.json could not be read — ${err.message}.\n\n` +
    'It records the panels whose chrome and settings column are known not to share\n' +
    'an edge (ticket 86bbq065f). Without it the seam assertion cannot tell a new\n' +
    'regression from the backlog, so this run would grade nothing.');
}

const allFailures = [];
const seamSkipped = new Map();     // panel name -> the widths it was skipped at
const seamUnreached = new Map();   // baselined panel name -> the widths it was never seen at
const seamLabelOnly = new Map();   // panel name -> widths where only the label track was comparable
const seamHalfMeasured = new Map();  // recorded panel name -> widths where only half the seam was comparable

/*
 * PER WIDTH, NOT `Math.max` ACROSS THEM.
 *
 * These two used to be `Math.max(...)` over the three widths, which reports
 * the BEST width's numbers as the whole run's. A run blind at 1920 and fine at
 * 1440 then printed "compared on 34 panel(s)" and exited 0, because the
 * zero-comparison refusal below only fired when EVERY width measured nothing.
 *
 * The per-entry unreached guard covered that by accident today — a width that
 * reaches nothing leaves every baseline name unreached — but that cover
 * disappears the moment 86bbq065f empties the baseline, which is the one
 * window this instrument was built for (review round 2).
 */
const seamByWidth = new Map();    // width -> { compared, recorded }
let panelsSeen = 0;
let cardsSeen = 0;
// Seam failures counted on their own, apart from `allFailures`. The seam note
// has to be able to say whether ITS assertion found anything, and an
// unrelated W0 or W9 violation must not answer that question for it.
let seamFailureCount = 0;
let columnGridsSeen = 0;
const stripsByWidth = new Map();      // width -> columns actually measured for dead space
const stripUnmeasured = new Map();    // "<panel> (<shape>)" -> the widths it could not be measured at
/*
 * Titled-column managers built as ONE flat grid (breadcrumb's trail items).
 *
 * Counted and named, never failed — the same discipline the single-pair count
 * uses, and for the same reason. On a flat grid the header titles and the row
 * cells are children of one grid reading one set of tracks, so every child
 * stretches to its column and the four comparative assertions are true before
 * any CSS is written. A run that reported them as "checked" would be claiming
 * to have verified something it structurally cannot. What it CAN verify on
 * this shape — the resolved track count against the declared one, and every
 * line rendering the declared number of cells — is asserted and can fail.
 */
const flatGrids = new Map();   // manager class -> { tracks, rows, widths }
/*
 * Declared managers that generated no layout box at the width they were
 * measured at, so no reading could be taken. A blind spot, never a failure —
 * see the guard in `measureColumnGrids`.
 */
const boxlessManagers = new Map();   // manager name -> the widths it was blind at
/*
 * Declared managers that rendered a SINGLE label/field pair.
 *
 * Counted and reported, never failed. A one-row manager can be entirely
 * correct — the Trigger block on any module that is not Confetti has exactly
 * one row and there is nothing to seed that would give it a second — but the
 * four comparative assertions (label widths, label-text offsets, field
 * offsets, field widths) are all `new Set(...).length > 1` tests, so on such a
 * block they cannot fail. Saying so is the difference between a count and a
 * verdict, and on 2026-09-03 that difference cost a reviewer a round: a green
 * run over the Trigger panel was reported as proof the layout was right when
 * most of what the reader assumes was checked had never been able to fail
 * (task 86bbufmdt).
 *
 * PER PAIR-COLUMN and KEYED, both learned in review round 1 of that same
 * ticket. Per column because the comparative assertions run inside the bucket
 * loop, so a two-column manager holding one item has every one of them vacuous
 * while its group-wide field count looks like a comparable 2. Keyed because
 * the first version added the per-width count three times and printed 9 for
 * 3 real blocks.
 */
const uncomparableManagers = new Map();   // stable key -> the widths it was seen at

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
    for (const u of findUncomparableManagers(measured)) {
      // Keyed, not summed. Adding the per-width count over three widths
      // printed "9 declared manager(s)" for 3 real blocks — three times the
      // truth, on the one ticket whose acceptance criterion is that a count
      // must not read as a verdict (review round 1, 2026-09-05).
      if (!uncomparableManagers.has(u.key)) uncomparableManagers.set(u.key, { label: u.label, widths: [] });
      uncomparableManagers.get(u.key).widths.push(width);
    }
    allFailures.push(...assertLattice(measured, width));
    // W9 runs at every width on purpose: a ceiling is only interesting on the
    // wide end, and 1440 alone would let a 1600px-only overflow through.
    allFailures.push(...assertCeiling(await measureWidths(page), width));
    // The seam runs at every width for the same reason W9 does: these tracks
    // are `max-content`, so the stagger is content-driven and identical at
    // 1440 and 1920 today — but a future width-dependent rule would show up
    // at one width only, and a check that samples one width could not see it.
    const seam = assertSeam(await measureSeam(page), width, SEAM_BASELINE);
    allFailures.push(...seam.failures);
    seamFailureCount += seam.failures.length;
    seamByWidth.set(width, { compared: seam.compared, recorded: seam.recordedSeen });
    // Keyed by name, not summed: three widths would otherwise report three
    // times the truth, which is the mistake the manager note above already
    // paid for once (review round 1, 2026-09-05).
    for (const note of seam.skipped) {
      const key = note.split(' — ')[0];
      if (!seamSkipped.has(key)) seamSkipped.set(key, { note, widths: [] });
      seamSkipped.get(key).widths.push(width);
    }
    for (const name of seam.unreached) {
      if (!seamUnreached.has(name)) seamUnreached.set(name, []);
      seamUnreached.get(name).push(width);
    }
    for (const name of seam.labelTrackOnly) {
      if (!seamLabelOnly.has(name)) seamLabelOnly.set(name, []);
      seamLabelOnly.get(name).push(width);
    }
    for (const name of seam.recordedHalfMeasured) {
      if (!seamHalfMeasured.has(name)) seamHalfMeasured.set(name, []);
      seamHalfMeasured.get(name).push(width);
    }

    const columnGrids = await measureColumnGrids(page);
    columnGridsSeen += columnGrids.length;
    // Keyed by name, not summed over the widths — the same lesson the
    // single-pair count learned on 2026-09-05, where adding the per-width
    // count three times printed 9 declared managers for 3 real blocks.
    // The key has to be UNIQUE for that to hold, which is why `name` is the
    // manager's full class string plus an ordinal rather than its first class
    // token: see the comment at the top of `measureColumnGrids`. Keyed on the
    // first token, a second adopter of `.builder-item-grid` would have
    // collapsed into the first one's entry and gone unreported.
    for (const g of columnGrids.filter((g) => g.shape === 'flat')) {
      if (!flatGrids.has(g.name)) flatGrids.set(g.name, { tracks: g.tracks, rows: g.rows.length, widths: [] });
      flatGrids.get(g.name).widths.push(width);
    }
    for (const g of columnGrids.filter((g) => g.shape === 'boxless')) {
      if (!boxlessManagers.has(g.name)) boxlessManagers.set(g.name, []);
      boxlessManagers.get(g.name).push(width);
    }
    allFailures.push(...assertColumnGrids(columnGrids, width));

    const columnStrips = await measureColumnStrips(page);
    stripsByWidth.set(width, columnStrips.filter((c) => c.shape === 'measured').length);
    for (const c of columnStrips.filter((c) => c.shape !== 'measured')) {
      const key = `${c.panelName || `panel #${c.index}`} (${c.shape})`;
      if (!stripUnmeasured.has(key)) stripUnmeasured.set(key, []);
      if (!stripUnmeasured.get(key).includes(width)) stripUnmeasured.get(key).push(width);
    }
    allFailures.push(...assertColumnStrips(columnStrips, width));
  } finally {
    await browser.close();
  }
}

// The fixture is shared local state: another session running
// `npm run seed:ui-fixture` from its own worktree rewrites the SAME page in
// the SAME database. On 2026-08-13 that silently cut this page from 53
// modules to 3, and the check reported a confident pass over what was left.
// Counting the cards is what makes that loud instead of invisible.
const blind = [];

/*
 * A declared manager that had no layout box is a reading NOT TAKEN, and it
 * has to move the exit code (to 2) rather than sit in the pass. Before the
 * guard that produces this, the same manager failed with a confident
 * five-tracks-against-three drift report — a verdict from a measurement that
 * never happened, which is worse than either a pass or a failure.
 */
for (const [name, widths] of boxlessManagers) {
  blind.push(
    `${name} declares data-lattice-columns but generated NO LAYOUT BOX at ` +
    `${widths.join('/')}px — it or an ancestor is display:none.\n` +
    'Nothing about it was measured: grid-template-columns falls back to the specified\n' +
    'value for a boxless element, so counting its tracks would report a drift that has\n' +
    'not happened. Open the surface this manager sits on before believing this run.');
}

if (cardsSeen > 0 && cardsSeen < EXPECTED_MODULES) {
  // A 2, not a 1: the fixture is the INSTRUMENT. Nothing here says the panels
  // are wrong, and reporting it as a failure sends the reader hunting a defect
  // in code that could be perfect (task 86bbt6hgx).
  blind.push(
    `The fixture is INCOMPLETE — ${cardsSeen} module cards on the page, ` +
    `${EXPECTED_MODULES} module types exist.\n` +
    'Another session has probably re-seeded over it. Re-run `npm run seed:ui-fixture`\n' +
    'and check again; a pass over a partial fixture is not a pass.');
}

if (panelsSeen === 0) {
  blind.push(
    'No panels carrying `.is-lattice` were found.\n' +
    'Zero assertions is never a green result. The class is stamped on EVERY module\n' +
    'editor by ModuleEditorWrapper (components/builder/builder-module-card.tsx)\n' +
    'and on the section, cell and table-cell editors, so finding none means\n' +
    'either the fixture page has no modules (`npm run seed:ui-fixture`) or the\n' +
    'navigation above stopped working — an instrument problem either way, which\n' +
    'is why this is a 2 rather than a 1.');
}

/*
 * A SEAM SWEEP THAT MEASURED NOTHING IS A 2, NOT A GREEN RUN.
 *
 * Round 1 of this ticket printed a note reading "That is not a pass" beside
 * exit 0 — the exact shape `harness-exit.mjs` and DOCTRINE §5.33 were written
 * against, reproduced inside the check built to close it. Renaming the chrome
 * selector to something that matches no element (the shape a React refactor
 * takes) left all 31 recorded panels ungraded and the whole assertion dead,
 * under an `OK` headline. The exit code is what gets read, so the exit code is
 * what has to move.
 */
/*
 * AND IT IS ASKED PER WIDTH. A width that measured nothing is a blind width
 * even when the other two were fine — the seam runs at every width precisely
 * because a future width-dependent rule would show up at one of them only, so
 * a run that could not look at one of them has not run the assertion it claims.
 */
/*
 * THE SAME QUESTION FOR THE STRIP, PER WIDTH. A width at which no column
 * could be measured has not run this assertion, whatever the other two did —
 * and what it looks for is a stretched BOX, exactly the kind of thing a
 * width-dependent rule changes. Reporting that as a pass is the shape
 * DOCTRINE §5.33 was written against.
 */
const stripBlindWidths = WIDTHS.filter((w) => !(stripsByWidth.get(w) > 0));

if (stripBlindWidths.length) {
  blind.push(
    'No lattice column could be measured for dead space at ' +
    `${stripBlindWidths.join('/')}px.\n` +
    'Every column was hidden, collapsed, subgrid or trackless, so the strip assertion\n' +
    'ran against nothing. Zero assertions is not a pass — open the fixture page and\n' +
    'check the panels are expanded before believing this run.');
}

const seamBlindWidths = WIDTHS.filter((w) => !(seamByWidth.get(w)?.compared > 0));

if (seamBlindWidths.length) {
  const everyWidth = seamBlindWidths.length === WIDTHS.length;
  const measuredAt = WIDTHS.filter((w) => !seamBlindWidths.includes(w));
  blind.push(
    (everyWidth
      ? 'The chrome/column seam was NOT MEASURED AT ANY WIDTH — no panel presented both a\n'
      : `The chrome/column seam was NOT MEASURED at ${seamBlindWidths.join('/')}px (it was measured\n`
        + `at ${measuredAt.join('/')}px) — at those widths no panel presented both a\n`) +
    `chrome strip and a settings column stacked with it, so all ${SEAM_BASELINE.length} recorded panel(s)\n` +
    'went ungraded there. Zero comparisons is never a green result, and the widths that DID\n' +
    'measure do not answer for the ones that did not. Four things do this: the fixture\n' +
    'rendered no such panel (`npm run seed:ui-fixture`); the chrome selector stopped matching\n' +
    'anything, which a rename under components/builder/ does silently; EVERY settings column\n' +
    'landed beside its chrome rather than stacked with it; or that width never opened its\n' +
    'panels at all. The seam note below lists what was skipped and why. An instrument problem\n' +
    'in every case, which is why this is a 2 rather than a 1.');
}

/*
 * A RECORDED PANEL MEASURED ON HALF THE SEAM IS A 2 TOO.
 *
 * `assertSeam` refuses to call such a panel STALE, because deleting a name
 * from the record on a comparison that did not happen retires a defect nobody
 * has looked at. Refusing to fail it is only half the answer: staying silent
 * would leave it reading as a recorded panel duly held where it is, when in
 * fact only its label track was compared (review round 2).
 */
if (seamHalfMeasured.size) {
  blind.push(
    `${seamHalfMeasured.size} panel(s) recorded in scripts/ui/panel-seam-baseline.json were measured on\n` +
    `HALF the seam only: ${[...seamHalfMeasured.keys()].join(', ')}.\n` +
    'Their label tracks line up and no row of either box occupies the control track, so this\n' +
    'run can say neither that they are still staggered nor that they are fixed. They were NOT\n' +
    'reported as stale — the record may only ever shrink for a reason this check actually\n' +
    'MEASURED. Seed a row that occupies the control track in scripts/ui/seed_fixture.mjs.');
}

/*
 * A RECORDED PANEL THE RUN NEVER REACHED IS A 2 AS WELL — the same rule, per
 * entry. `assertSeam` states it over the code that computes `unreached`
 * ("A RECORDED PANEL THAT WAS NEVER REACHED IS NOT A PASS") and round 1 then
 * reported it as a note beside exit 0, so the code disagreed with its own
 * comment. A module that stops being seeded, or is renamed, leaves a recorded
 * defect permanently unverifiable while the gate stays green.
 *
 * It matters most while this baseline is EMPTYING. 86bbq065f straightens these
 * panels and deletes their entries as it goes; a run that quietly stopped
 * reaching them would read exactly like the fix succeeding.
 */
if (seamUnreached.size) {
  blind.push(
    `${seamUnreached.size} panel(s) recorded in scripts/ui/panel-seam-baseline.json were NEVER\n` +
    `REACHED by this run: ${[...seamUnreached.keys()].join(', ')}.\n` +
    'Nothing about them was verified — not that they are still staggered, and not that they\n' +
    'are fixed. Either the fixture no longer renders that module, or its panel was skipped,\n' +
    'or its name changed. Re-seed (`npm run seed:ui-fixture`) or correct the entry: the\n' +
    'baseline may only ever shrink for a reason this check actually MEASURED.');
}

/*
 * FAILURES FIRST, THEN THE REFUSAL. Both guards above used to exit 2 on the
 * spot, ahead of this block — so a partial fixture plus a genuine W0/W9
 * violation on the panels that DID render reported as a broken instrument and
 * threw the violation list away (review round 1, task 86bbt6hgx). The
 * incomplete-fixture case is the common one: another session re-seeding over
 * the shared page did exactly this on 2026-08-13. A width that is wrong is
 * wrong whatever else about the run was hollow, which is the ranking
 * `verdict()` encodes.
 */
/*
 * WHAT A PASS OVER A DECLARED MANAGER IS WORTH — printed on EVERY run, green
 * or red, including when the number is zero.
 *
 * Round 1 of this ticket wrote "printed on every green run, not only when it
 * is non-zero, so the reader is never left inferring it from silence" directly
 * above an `if (uncomparableManagers)`, which printed nothing at zero — the
 * exact silence the comment claimed to have removed. A comment that describes
 * the opposite of its code is worse than no comment, because it is read as
 * evidence. Zero now says so out loud.
 */
/*
 * WHAT THE STRIP ASSERTION MEASURED, AND WHAT IT COULD NOT.
 *
 * A count, per width, and the columns it had to skip with the reason —
 * because "0 failures" and "0 columns looked at" print the same headline
 * otherwise, and the subgrid exclusion is deliberate enough that a reader
 * should be able to see it was applied rather than take it on trust.
 */
function stripNote() {
  const measured = WIDTHS.map((w) => `${stripsByWidth.get(w) || 0} at ${w}px`).join(', ');
  const lines = [`[check:panels] Dead space: ${measured} — column box against resolved tracks, ` +
    `tolerance ${STRIP_TOLERANCE}px.`];
  if (stripUnmeasured.size) {
    lines.push('  Not measured for dead space, and the reason is not "it passed":');
    for (const [key, widths] of stripUnmeasured) {
      lines.push(`      \u00b7 ${key} [${widths.join('/')}px]` +
        (key.includes('subgrid')
          ? ' — a subgrid column takes its tracks from its area and MUST fill it'
          : ''));
    }
  }
  return lines.join('\n');
}

function uncomparableNote() {
  if (!uncomparableManagers.size) {
    return '[check:panels] NOTE — every declared item manager rendered at least two label/field\n'
      + '  pairs in every pair-column, so the four comparative assertions (label widths,\n'
      + '  label-text offsets, field offsets, field widths) were live on all of them.';
  }
  const rows = [...uncomparableManagers.values()]
    .map((u) => `      · ${u.label} (at ${u.widths.join('/')}px)`)
    .join('\n');
  return `[check:panels] NOTE — ${uncomparableManagers.size} declared pair-column(s) rendered a single\n`
    + '  label/field pair, so the four comparative assertions (label widths, label-text\n'
    + '  offsets, field offsets, field widths) had nothing to compare and could not fail on\n'
    + '  them. The per-field assertions — the cropped-word check and control-right-of-label —\n'
    + '  did run, and so did the label-room floor and ceiling EXCEPT on a stacked pair\n'
    + '  (control below its label, same left edge), where the two have nothing to measure:\n'
    + '  the label box there is the whole column rather than a track beside the field. Saying\n'
    + '  which assertions were live is the whole point of this note; listing two that were\n'
    + '  not would make it the confident-count-as-verdict it exists to prevent.\n'
    + '  Seed a second row in\n'
    + '  scripts/ui/seed_fixture.mjs if these should be compared too:\n'
    + rows;
}

/*
 * WHAT A PASS OVER A FLAT-GRID MANAGER IS WORTH — printed whenever one was
 * measured, and silent when none was.
 *
 * The silence is deliberate and it is NOT the case the note above covers.
 * `uncomparableNote()` answers "were the comparative assertions live on the
 * managers we measured?", which has a real answer at zero — yes, vacuously,
 * and saying so is what stops a reader inferring coverage from silence. This
 * one answers "of the managers we measured, which are one flat grid?", and at
 * zero there is no such manager to say anything about: the run already names
 * how many declared managers it saw. Every call site guards with
 * `if (flatGridNote())` accordingly.
 *
 * It used to sit directly under the "Zero now says so out loud" comment,
 * which belongs to `uncomparableNote()` and describes the opposite of what
 * this function does — the exact shape that comment was written about. This
 * file has paid twice for a comment read as evidence of the code beneath it
 * (review round 1, task 86bbjt1b6).
 */
function flatGridNote() {
  if (!flatGrids.size) return '';
  const rows = [...flatGrids.entries()]
    .map(([name, g]) => `      · ${name} — ${g.tracks} track(s), ${g.rows} row(s) (at ${g.widths.join('/')}px)`)
    .join('\n');
  return `[check:panels] NOTE — ${flatGrids.size} titled-column manager(s) are ONE flat grid, so\n`
    + '  their header titles and row cells read the same tracks by construction. The four\n'
    + '  comparative assertions (row widths, per-column offsets, per-column widths, title\n'
    + '  containment) are therefore satisfied before any CSS is written and could not fail\n'
    + '  on them. What WAS asserted here, and can fail: the resolved track count against the\n'
    + '  declared one, and every DECLARED row — the cells sharing a data-lattice-row — \n'
    + '  rendering the declared number of cells. That second one reads the stamp and not\n'
    + '  the geometry on purpose: auto-placed cells fill the tracks whatever the markup\n'
    + '  did, so a scrambled panel still measures the declared number of cells per grid\n'
    + '  row (measured 2026-09-13, review round 2, task 86bbjt1b6).\n'
    + rows;
}

/*
 * WHAT THE SEAM CHECK MEASURED, AND WHAT IT IS STILL LETTING THROUGH —
 * printed on EVERY run, green or red, including when the record is empty.
 *
 * This is the point of ticket 86bbw8643. A bounded check that does not
 * announce its bound reads as a clean sweep: this check printed
 * "OK — W0 and W9 hold across 224 panel(s)" for weeks while 35 panels were
 * visibly staggered, and the pass was read as verification. A recorded
 * defect that says nothing is the same failure with a JSON file in front of
 * it, so the count and the owning ticket go out on every single run.
 */
/*
 * WHAT THIS RUN ACTUALLY DID ABOUT A BLIND SPOT — read off the verdict, never
 * asserted.
 *
 * Round 2 of this ticket printed, verbatim, "so this run refuses too — COULD
 * NOT TAKE A READING (exit 2), never a green pass" underneath a FAILED headline
 * that then exited 1. `verdict()` ranks failures above blindness on purpose
 * (DOCTRINE §5.33), so that sentence was wrong on every run where both were
 * true — and the pull request quoted that very run as proof a real failure
 * outranks a blind spot. The exit code was right; the sentence beside it said
 * the opposite. A check that misreports its own exit number is this ticket's
 * own defect, one level in, so the number is now taken FROM the verdict.
 */
function blindVerdictSentence(code) {
  if (code === EXIT_FAIL) {
    return '    This run does not report that as a pass. It exits 1 for the failures listed above,\n'
      + '    which outrank a blind spot — the blindness is ON TOP OF them, not instead of them,\n'
      + '    and it means there may be more failures that went unmeasured.';
  }
  if (code === EXIT_CANNOT_TELL) {
    return '    This run does not report that as a pass. It refuses with COULD NOT TAKE A READING\n'
      + '    (exit 2), and the refusal printed above says how to fix it.';
  }
  return '    This run exited 0, which it should NOT have — a blind spot has to move the exit code.\n'
    + '    Read that as a defect in check:panels itself, not as a clean sweep.';
}

function seamNote(code) {
  const lines = [];
  const recorded = SEAM_BASELINE.length;

  // Per width, because `seamByWidth` is per width. Collapsing to one number is
  // only honest when the widths agree; when they do not, saying so IS the
  // finding.
  const comparedCounts = WIDTHS.map((w) => seamByWidth.get(w)?.compared ?? 0);
  const recordedCounts = WIDTHS.map((w) => seamByWidth.get(w)?.recorded ?? 0);
  const agree = (counts) => new Set(counts).size === 1;
  const spread = (counts) => counts.map((n, i) => `${n} at ${WIDTHS[i]}px`).join(', ');
  const comparedText = agree(comparedCounts)
    ? `${comparedCounts[0]} panel(s) at each of ${WIDTHS.join('/')}px`
    : `a DIFFERENT number of panels at each width (${spread(comparedCounts)})`;
  const recordedText = agree(recordedCounts)
    ? `${recordedCounts[0]}`
    : `${spread(recordedCounts)}`;

  if (!comparedCounts.some((n) => n > 0)) {
    lines.push('[check:panels] NOTE — no panel presented both a chrome strip and a settings column');
    lines.push(`  stacked with it at ANY width, so the chrome/column seam was not measured at all and all ${recorded}`);
    lines.push('  recorded panel(s) went ungraded. Three things do that, and the lists below say which:');
    lines.push('  the fixture rendered no such panel, the chrome selector stopped matching anything, or');
    lines.push('  every settings column landed BESIDE its chrome rather than stacked with it.');
    lines.push(blindVerdictSentence(code));
  } else if (seamBlindWidths.length) {
    lines.push(`[check:panels] NOTE — the chrome/column seam was NOT MEASURED at ${seamBlindWidths.join('/')}px, and`);
    lines.push(`  was compared on ${spread(comparedCounts)}. The widths that measured do not answer for the`);
    lines.push('  ones that did not: these tracks are content-driven today, but the seam is asserted at');
    lines.push('  every width precisely so a width-dependent rule cannot hide at the width nobody looked at.');
    lines.push(blindVerdictSentence(code));
  } else if (recorded) {
    lines.push(`[check:panels] NOTE — the chrome/column seam was compared on ${comparedText}, of which`);
    lines.push(`  ${recordedText} are RECORDED AS STAGGERED in scripts/ui/panel-seam-baseline.json (${recorded} entries in all).`);
    lines.push('  Those are a known, open defect owned by ticket 86bbq065f — the chrome and the');
    lines.push('  settings column stacked with it do not share one left edge. THIS RUN DID NOT');
    lines.push('  VERIFY THEM; it only held them where they are. A new panel joining them fails,');
    lines.push('  and so does one of them being fixed and left in the record.');
    if (seamFailureCount) {
      lines.push(`  ${seamFailureCount} seam comparison(s) FAILED on this run and are listed above. This note says`);
      lines.push('  what was EXCLUDED from the assertion; it is not a verdict on the run.');
    }
  } else if (seamFailureCount) {
    /*
     * THE EMPTY BASELINE, WITH FAILURES. Round 2 printed "every one of them
     * shares one left edge, with nothing recorded as staggered" underneath 62
     * listed seam failures — a flat false all-clear, and not a corner case:
     * this branch fires exactly when 86bbq065f has emptied the file, which is
     * the one job this instrument exists to grade. A regression during that
     * work read as the fix having succeeded.
     */
    lines.push(`[check:panels] NOTE — the chrome/column seam was compared on ${comparedText}, and`);
    lines.push(`  ${seamFailureCount} of those comparison(s) FAILED — they are listed above. The record in`);
    lines.push('  scripts/ui/panel-seam-baseline.json is EMPTY, so every one of them is a NEW regression:');
    lines.push('  nothing is being excused here, and this note vouches for nothing lining up.');
    lines.push('  Straighten the panel, or record it and say why on ticket 86bbq065f.');
  } else {
    lines.push(`[check:panels] NOTE — the chrome/column seam was compared on ${comparedText} and`);
    lines.push('  every one of them shares one left edge, with nothing recorded as staggered.');
    lines.push('  scripts/ui/panel-seam-baseline.json is empty, which is what 86bbq065f was for.');
  }

  if (seamUnreached.size) {
    lines.push(`  ${seamUnreached.size} recorded panel(s) were NEVER REACHED by this run, so nothing about them`);
    lines.push('  was verified — not that they are still staggered, and not that they are fixed:');
    for (const [name, widths] of seamUnreached) {
      lines.push(`      \u00b7 ${name} [not seen at ${[...new Set(widths)].join('/')}px]`);
    }
    lines.push('    Either the fixture no longer renders that module, or its panel was skipped');
    lines.push('    for a reason listed below. A record nobody reads is how a defect outlives its ticket.');
    lines.push(blindVerdictSentence(code));
  }

  if (seamHalfMeasured.size) {
    lines.push(`  ${seamHalfMeasured.size} recorded panel(s) were measured on HALF the seam — their labels line up and`);
    lines.push('  no row of either box occupies the control track, so they were NOT called stale:');
    for (const [name, widths] of seamHalfMeasured) {
      lines.push(`      \u00b7 ${name} [${[...new Set(widths)].join('/')}px]`);
    }
    lines.push('    The record may only ever shrink for a reason this check actually MEASURED.');
    lines.push(blindVerdictSentence(code));
  }

  if (seamLabelOnly.size) {
    lines.push(`  ${seamLabelOnly.size} panel(s) were held to the LABEL track only — one side of the seam has no`);
    lines.push('  row occupying the control track, so half the comparison did not happen:');
    for (const [name, widths] of seamLabelOnly) {
      lines.push(`      \u00b7 ${name} [${[...new Set(widths)].join('/')}px]`);
    }
  }

  if (seamSkipped.size) {
    lines.push(`  ${seamSkipped.size} panel(s) were SKIPPED, and the reason is not "it passed":`);
    for (const { note: text, widths } of seamSkipped.values()) {
      lines.push(`      \u00b7 ${text} [${[...new Set(widths)].join('/')}px]`);
    }
  }

  return lines.join('\n');
}

const code = verdict({ failures: allFailures.length, blind: blind.length });

if (code === EXIT_FAIL) {
  console.error(`\n[check:panels] FAILED — ${allFailures.length} problem(s):\n`);
  for (const f of allFailures) console.error(`  ✗ ${f}`);
  if (blind.length) {
    console.error(
      '\nAND the run was partly blind, which does NOT excuse the failures above —\n' +
      'it means there may be more of them that went unmeasured:\n\n' +
      blind.map((b) => `  • ${b.split('\n')[0]}`).join('\n') + '\n'
    );
  }
  console.error(`\n${uncomparableNote()}`);
  if (flatGridNote()) console.error(flatGridNote());
  console.error(`${seamNote(code)}\n`);
  console.error(
    '\nW0: one label width and one field width per panel. The two numbers live in\n' +
    'src/css/_variables.css (--builder-field-label-w / --builder-field-control-w).\n' +
    'W9: no field spans its container — the ceiling is --builder-field-long-max\n' +
    'in the same file. Fix them there — never by putting a width on one field.\n'
  );
  process.exit(1);
}

if (code === EXIT_CANNOT_TELL) {
  // Both notes print here too. The comment over `seamNote` promises them on
  // EVERY run, and this refusal is now a path the seam assertion itself
  // reaches — leaving them out would make that comment describe the opposite
  // of its code, which this file has already paid for once.
  console.error(`\n${uncomparableNote()}`);
  if (flatGridNote()) console.error(flatGridNote());
  console.error(seamNote(code));
  cannotTell('check:panels', blind.join('\n\n'));
}

console.log(
  `[check:panels] OK — W0 and W9 hold across ${panelsSeen} panel(s) `
  + `and ${columnGridsSeen} titled-column manager(s) at ${WIDTHS.join('/')}px.`
);

console.log(stripNote());
console.log(uncomparableNote());
if (flatGridNote()) console.log(flatGridNote());
console.log(seamNote(code));
