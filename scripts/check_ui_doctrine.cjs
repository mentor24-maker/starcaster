#!/usr/bin/env node
/**
 * UI doctrine checks — the mechanical half of docs/MODULE_UI_DOCTRINE.md.
 *
 * Every UI rule in this repo was honour-system until 2026-08-08, and the
 * measurement was brutal: 5 of 37 settings editors followed the field-strip
 * rule that had been written down for months. Meanwhile the build-artifact
 * rules — the ones with a pre-commit hook — held perfectly. The difference
 * was the hook. This file is that hook for UI.
 *
 * Modes:
 *   (default)  staged mode — only your staged changes. Runs at pre-commit.
 *   --all      whole repo. Runs in CI. Only rules that are currently CLEAN
 *              repo-wide live here, so CI is green today and any NEW
 *              violation fails it.
 *   --report   whole-repo debt report for rules too far gone to gate on
 *              (e.g. field-strip adoption). Never exits non-zero.
 *
 * Bypass: SKIP_CONVENTIONS=1, with a stated reason (repo convention).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CSS_DIR = 'src/css';
const SETTINGS_GLOB = /components\/builder\/.*-module-settings\.tsx$/;

// ---------------------------------------------------------------------------
// R1 allowlist — selectors that are LEGITIMATELY breakpoint-only.
//
// These live here rather than as a comment marker in the CSS because
// _builder-react.css is regenerated wholesale by extract_builder_css.mjs; a
// marker in that file would not survive the next regeneration.
// Every entry needs a reason. "It was already like that" is not a reason.
// ---------------------------------------------------------------------------
const R1_ALLOW = new Map([
  ['.builder-react-root .builder-preview-column-mobile-hidden',
    'the class exists only to hide a column on mobile — a base rule would hide it everywhere'],
  ['.builder-react-root .builder-preview-module-mobile-hidden',
    'same: mobile-only visibility toggle, meaningless above the breakpoint'],
  ['.site-nav:not(.site-nav--vertical)',
    'Top Menu hamburger collapse — the collapsed nav is a state that only exists below the breakpoint'],
  ['.site-nav:not(.site-nav--vertical) .site-nav-toggle',
    'hamburger button is not rendered as a control above the breakpoint'],
  ['.site-nav:not(.site-nav--vertical).site-nav--open .site-nav-items',
    'the open/closed drawer state only exists in the collapsed nav'],
  ['.site-nav:not(.site-nav--vertical) .site-nav-items .site-nav-link',
    'stacked drawer link layout applies only to the collapsed nav'],
  ['.site-nav:not(.site-nav--vertical) .site-nav-dropdown',
    'dropdowns become inline accordions only in the collapsed nav'],
  ['.site-nav:not(.site-nav--vertical) .site-nav-dropdown-menu',
    'same accordion behaviour; above the breakpoint this is a hover flyout'],
]);

// Structural properties. A media query may ADJUST these; it may not be the
// only place they are ever set. (Doctrine 1b.R1.)
const LAYOUT_PROP =
  /(?:^|;)\s*(display|position|flex|flex-\w+|grid|grid-\w+|width|height|min-width|max-width|min-height|max-height|top|right|bottom|left|inset|gap|row-gap|column-gap|float|align-items|justify-content|overflow|overflow-x|overflow-y)\s*:/;

const failures = [];
const notes = [];

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function stagedFiles() {
  return sh('git diff --cached --name-only --diff-filter=ACMR').split('\n').filter(Boolean);
}

/**
 * True while a merge is in progress.
 *
 * Added-line checks must not run on a merge commit: the incoming branch's
 * lines all look "added" to `git diff --cached`, so merging main would fail on
 * work that is already reviewed and on main. Blocking a merge on someone
 * else's committed code is how a gate teaches people to reach for
 * SKIP_CONVENTIONS — and a gate that is routinely bypassed is not a gate.
 * (Found 2026-08-08 merging the Theme Wizard, #106.)
 */
function isMerging() {
  return sh('git rev-parse -q --verify MERGE_HEAD').trim() !== '';
}

function addedLines(pathspec) {
  return sh(`git diff --cached --unified=0 -- ${pathspec}`)
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1));
}

// ---------------------------------------------------------------------------
// CSS corpus parser.
//
// All of src/css is parsed as ONE corpus on purpose: a selector's base rules
// may live in a different file from its media rules. The Card Slider fix
// landed in _builder-react-overrides.css while its media rules stayed in
// _builder-react.css — a per-file check would report it as still broken.
// ---------------------------------------------------------------------------
function parseCssInto(file, base, media) {
  const raw = fs.readFileSync(file, 'utf8');
  // Blank comments out rather than deleting, so line numbers stay truthful.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const stack = [];
  let buf = '';
  let mediaDepth = 0;
  let line = 1;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\n') line++;
    if (ch === '{') {
      const head = buf.trim();
      buf = '';
      if (/^@(media|supports|container)\b/.test(head)) {
        stack.push('at-conditional');
        if (/^@media\b/.test(head)) mediaDepth++;
      } else if (head.startsWith('@')) {
        stack.push('at-other');
      } else {
        stack.push({ sel: head, line });
      }
      continue;
    }
    if (ch === '}') {
      const top = stack.pop();
      if (top === 'at-conditional') {
        if (mediaDepth > 0) mediaDepth--;
      } else if (top && top.sel) {
        for (const sel of top.sel.split(',').map((s) => s.trim()).filter(Boolean)) {
          const rec = { file, line: top.line, body: buf };
          const target = mediaDepth > 0 ? media : base;
          if (!target.has(sel)) target.set(sel, []);
          target.get(sel).push(rec);
        }
      }
      buf = '';
      continue;
    }
    buf += ch;
  }
}

function cssCorpus() {
  const base = new Map();
  const media = new Map();
  if (!fs.existsSync(CSS_DIR)) return { base, media };
  for (const f of fs.readdirSync(CSS_DIR).filter((n) => n.endsWith('.css'))) {
    parseCssInto(path.join(CSS_DIR, f), base, media);
  }
  return { base, media };
}

/** Selectors that set a layout property inside a media query and nowhere outside one. */
function breakpointOnlyLayout() {
  const { base, media } = cssCorpus();
  const out = [];
  for (const [sel, entries] of media) {
    if (base.has(sel)) continue;
    if (R1_ALLOW.has(sel)) continue;
    const offending = entries.filter((e) => LAYOUT_PROP.test(e.body));
    if (offending.length) out.push({ sel, ...offending[0] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** R1 — no layout CSS that exists only inside a breakpoint. */
function checkBreakpointOnlyLayout({ all }) {
  const offenders = breakpointOnlyLayout();
  if (!offenders.length) return;

  let relevant = offenders;
  if (!all) {
    // Staged mode: only complain about selectors this commit actually touched.
    const added = addedLines('src/css').join('\n');
    relevant = offenders.filter((o) => added.includes(o.sel.replace(/^\s+/, '')));
  }
  for (const o of relevant) {
    failures.push(
      `[R1] Layout CSS lives only inside a @media block: "${o.sel}"\n` +
        `      ${o.file}:${o.line}\n` +
        `      Structural rules belong in the BASE layer; media queries may only adjust them.\n` +
        `      Above the breakpoint this selector has no layout at all. (Card Slider, 2026-08-06.)\n` +
        `      Genuinely mobile-only? Add it to R1_ALLOW in scripts/check_ui_doctrine.cjs WITH A REASON.`
    );
  }
}

/** R2 — the regenerated CSS layer is not hand-edited. */
function checkRegeneratedCssLayer(files) {
  if (!files.includes('src/css/_builder-react.css')) return;
  if (String(process.env.ALLOW_BUILDER_CSS_REGEN || '') === '1') {
    notes.push('[R2] _builder-react.css staged with ALLOW_BUILDER_CSS_REGEN=1 — treated as a regeneration.');
    return;
  }
  failures.push(
    `[R2] src/css/_builder-react.css is staged.\n` +
      `      That file is REGENERATED wholesale by extract_builder_css.mjs — hand edits are erased,\n` +
      `      and commit 2bd3018 silently deleted the CRM modal styles this way, breaking Contacts\n` +
      `      delete for a month. Put hand-written rules in src/css/_builder-react-overrides.css.\n` +
      `      If this genuinely IS a regeneration, re-run with ALLOW_BUILDER_CSS_REGEN=1.`
  );
}

/** R3 — colour comes from tokens, not hex literals (added lines only). */
function checkHexLiterals(files) {
  const cssFiles = files.filter(
    (f) => f.startsWith('src/css/') && f.endsWith('.css') && !f.endsWith('_variables.css')
  );
  if (!cssFiles.length) return;
  for (const file of cssFiles) {
    for (const raw of addedLines(file)) {
      // Ignore url(#...) fragments and hex inside data: URIs.
      if (/data:|url\(/.test(raw)) continue;
      // A hex inside var(--token, #fallback) is the CORRECT pattern — the
      // token wins when it is defined and the literal is only the fallback.
      // Flagging it would punish exactly the behaviour this rule wants.
      const line = raw.replace(/var\(\s*--[\w-]+\s*,[^)]*\)/g, 'var(--token)');
      const hits = line.match(/#[0-9a-fA-F]{3,8}\b/g);
      if (!hits) continue;
      failures.push(
        `[R3] Hardcoded colour ${hits.join(', ')} added in ${file}:\n` +
          `        ${raw.trim().slice(0, 100)}\n` +
          `      Use a token from src/css/_variables.css (var(--ink-primary), var(--border-light),\n` +
          `      var(--btn-bg), var(--accent), var(--bg-page)). A hex literal is a module that\n` +
          `      will not follow a tenant's theme.`
      );
    }
  }
}

/** R8 — type sizes come from the scale, not literals (added lines only). */
function checkTypeScaleLiterals(files) {
  const cssFiles = files.filter(
    (f) => f.startsWith('src/css/') && f.endsWith('.css') && !f.endsWith('_variables.css')
  );
  if (!cssFiles.length) return;
  for (const file of cssFiles) {
    for (const raw of addedLines(file)) {
      // A literal inside var(--text-sm, 0.82rem) is the fallback pattern and
      // is correct — same treatment as R3's hex-in-fallback.
      const line = raw.replace(/var\(\s*--[\w-]+\s*,[^)]*\)/g, 'var(--token)');
      const hit = line.match(/font-size\s*:\s*([0-9.]+(?:px|rem))/);
      if (!hit) continue;
      failures.push(
        `[R8] Literal font-size ${hit[1]} added in ${file}:\n` +
          `        ${raw.trim().slice(0, 100)}\n` +
          `      Use the type scale in src/css/_variables.css (--text-xs … --text-3xl).\n` +
          `      20+ one-off sizes accumulated exactly this way; the scale exists so the\n` +
          `      count goes down, not up. Nearest step wins — the scale canonizes the\n` +
          `      sizes already in majority use, so substitution rarely changes pixels.`
      );
    }
  }
}

/**
 * True when an editor is built to E1: either directly from field strips, or
 * from the schema generator (which renders field strips itself — an editor
 * using it never touches the markup at all, which is the stronger position).
 */
function usesFieldStrips(src) {
  return src.includes('BuilderModuleFieldStrip') || src.includes('BuilderSchemaModuleSettings');
}

/** E1 — module settings editors are built from field strips. */
function checkFieldStripAdoption(files) {
  for (const file of files.filter((f) => SETTINGS_GLOB.test(f))) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    if (usesFieldStrips(src)) continue;
    failures.push(
      `[E1] ${file} does not use BuilderModuleFieldStrip.\n` +
        `      Settings editors are built from BuilderModuleFieldStrip + BuilderModuleField —\n` +
        `      or declared as a schema and generated (builder-schema-module-settings.tsx) —\n` +
        `      never a hand-rolled grid or a bespoke flex row. Reference implementation:\n` +
        `      components/builder/builder-image-module-settings.tsx\n` +
        `      (Boy-scout rule: a module you touch comes up to standard in the same PR.)`
    );
  }
}

/**
 * E4 — a spacing box is offered as FOUR sides or not at all.
 *
 * Widened from the H+V pair on 2026-08-11 (W7, operator: "standardize all
 * objects on the Top/Bottom/Left/Right model"). A panel that names one side
 * names all four, in one order — anything less sends an operator hunting for
 * a control that is not there, which is the whole reason the pair failed:
 * the one number that could close the gap above a banner logo also threw
 * away the padding holding it off the left edge.
 *
 * Detection matches SETTINGS-KEY usage only (quoted key or `settings.`
 * access) — a bare `marginTop:` is an inline style, and counting those
 * flagged two innocent files the day the pair version was written.
 *
 * A panel that reaches the sides through the shared `MODULE_MARGIN_SIDES` /
 * `MODULE_PADDING_SIDES` tables satisfies this by construction; naming the
 * table counts as naming every side in it.
 */
function usesSettingsKey(src, key) {
  return new RegExp(`["'\`]${key}["'\`]|settings\\.${key}`).test(src);
}

const SPACING_BOXES = [
  { name: 'margin', table: 'MODULE_MARGIN_SIDES', legacy: ['verticalMargin', 'horizontalMargin'] },
  { name: 'padding', table: 'MODULE_PADDING_SIDES', legacy: ['verticalPadding', 'horizontalPadding'] }
];

function checkMarginPairing(files) {
  for (const file of files.filter((f) => SETTINGS_GLOB.test(f))) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');

    for (const box of SPACING_BOXES) {
      // The shared table, or the helper built from it, offers all four.
      if (src.includes(box.table) || src.includes(`${box.name}Fields(`)) continue;

      const sides = ['Top', 'Bottom', 'Left', 'Right'];
      const present = sides.filter((side) => usesSettingsKey(src, `${box.name}${side}`));
      if (present.length === 0 || present.length === 4) {
        // Still catch the retired pair, which is what four sides replaced.
        const stale = box.legacy.filter((key) => usesSettingsKey(src, key));
        if (!stale.length || present.length === 4) continue;
        failures.push(
          `[E4/W7] ${file} still offers ${stale.join(' / ')}.\n` +
            `      Spacing is four sides now — Top, Bottom, Left, Right — on every object.\n` +
            `      Use MODULE_${box.name.toUpperCase()}_SIDES (or ${box.name}Fields()) from the settings schema.`
        );
        continue;
      }

      failures.push(
        `[E4/W7] ${file} offers ${present.length} of the four ${box.name} sides ` +
          `(${present.join(', ')}).\n` +
          `      Name one side and you name all four, in Top/Bottom/Left/Right order. An operator who\n` +
          `      needs the missing one goes hunting for a control that isn't there.`
      );
    }
  }
}

/** E6 — universal chrome is not duplicated inside a per-type editor. */
function checkNoDuplicatedChrome(files) {
  for (const file of files.filter((f) => SETTINGS_GLOB.test(f))) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    const hits = ['mobileHidden', 'desktopHidden'].filter((k) => src.includes(k));
    if (!hits.length) continue;
    failures.push(
      `[E6] ${file} defines universal chrome (${hits.join(', ')}).\n` +
        `      Mobile/desktop visibility and vertical margin come from the SHARED module chrome.\n` +
        `      Duplicating them gives one setting two controls, and the operator learns that\n` +
        `      changing the wrong one does nothing.`
    );
  }
}

// ---------------------------------------------------------------------------
// Debt report (never gates — these are too far gone to block on today)
// ---------------------------------------------------------------------------
function report() {
  const dir = 'components/builder';
  const settings = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('-module-settings.tsx'))
    : [];
  const adopted = settings.filter((f) => usesFieldStrips(fs.readFileSync(path.join(dir, f), 'utf8')));
  const offenders = breakpointOnlyLayout();
  // Editors still spelling spacing as a vertical/horizontal pair rather than
  // the four sides every object uses (W7).
  const unpaired = settings.filter((f) => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    return ['verticalMargin', 'horizontalMargin', 'verticalPadding', 'horizontalPadding']
      .some((key) => usesSettingsKey(src, key));
  });

  // R8 debt: distinct literal font sizes still in the hand-authored CSS.
  const sizeLiterals = new Set();
  if (fs.existsSync(CSS_DIR)) {
    for (const f of fs.readdirSync(CSS_DIR).filter((n) => n.endsWith('.css') && n !== '_variables.css')) {
      const src = fs.readFileSync(path.join(CSS_DIR, f), 'utf8')
        .replace(/var\(\s*--[\w-]+\s*,[^)]*\)/g, 'var(--token)');
      for (const m of src.matchAll(/font-size\s*:\s*([0-9.]+(?:px|rem))/g)) sizeLiterals.add(m[1]);
    }
  }

  console.log('\nUI doctrine — whole-repo debt (docs/MODULE_UI_DOCTRINE.md)\n');
  console.log(`  [E1] field-strip adoption ....... ${adopted.length}/${settings.length} editors`);
  console.log(`  [E4] spacing still a V/H pair ... ${unpaired.length} editors`);
  for (const f of unpaired) console.log(`         ${f}`);
  console.log(`  [R1] breakpoint-only layout ..... ${offenders.length} selectors (excl. ${R1_ALLOW.size} allowlisted)`);
  for (const o of offenders) console.log(`         ${o.file}:${o.line}  ${o.sel}`);
  console.log(`  [R8] distinct literal font sizes  ${sizeLiterals.size} (scale has 8 steps)`);
  console.log('\n  These numbers should only ever go down.\n');
  console.log('  Not yet adopted:');
  for (const f of settings.filter((x) => !adopted.includes(x))) console.log(`    - ${f}`);
  console.log('');
}

// ---------------------------------------------------------------------------

function run({ all = false } = {}) {
  failures.length = 0;
  notes.length = 0;

  if (all) {
    // Repo-wide: only rules that are clean today, so CI is green and any NEW
    // violation fails it. E1/E3 are staged-only until the backlog is worked
    // down — see --report for the standing debt.
    checkBreakpointOnlyLayout({ all: true });
    const tracked = sh("git ls-files 'components/builder/*-module-settings.tsx'").split('\n').filter(Boolean);
    checkNoDuplicatedChrome(tracked);
    // E4 gated repo-wide since 2026-08-09: the two original violators are
    // fixed — current-poll's renderer honours both margins and pairs the
    // controls; heading gained horizontal margin capability by operator
    // ruling (its Top/Bottom split satisfies the vertical side).
    checkMarginPairing(tracked);
  } else {
    const files = stagedFiles();
    if (!files.length) return { failures, notes };

    // Whole-file checks are safe during a merge: they judge the RESULT, which
    // is what actually ships. R1 in particular is the reason the broken
    // Theme Wizard merge was caught at all.
    checkBreakpointOnlyLayout({ all: false });
    checkFieldStripAdoption(files);
    checkMarginPairing(files);
    checkNoDuplicatedChrome(files);

    if (isMerging()) {
      notes.push(
        'merge in progress — added-line checks (R2, R3) skipped; the incoming ' +
          'branch\'s lines are already reviewed on its own PR. Whole-file checks still ran.'
      );
    } else {
      checkRegeneratedCssLayer(files);
      checkHexLiterals(files);
      checkTypeScaleLiterals(files);
    }
  }
  return { failures, notes };
}

module.exports = { run };

if (require.main === module) {
  if (String(process.env.SKIP_CONVENTIONS || '') === '1') {
    console.log('[ui-doctrine] SKIP_CONVENTIONS=1 — checks bypassed.');
    process.exit(0);
  }
  if (process.argv.includes('--report')) {
    report();
    process.exit(0);
  }
  const { failures: f, notes: n } = run({ all: process.argv.includes('--all') });
  for (const note of n) console.log(`[ui-doctrine] ${note}`);
  if (f.length) {
    console.error('\n[ui-doctrine] Blocked — docs/MODULE_UI_DOCTRINE.md:\n');
    for (const x of f) console.error(`  ✗ ${x}\n`);
    process.exit(1);
  }
  console.log('[ui-doctrine] All UI checks passed.');
}
