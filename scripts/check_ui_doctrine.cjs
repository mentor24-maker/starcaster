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
    for (const line of addedLines(file)) {
      // Ignore url(#...) fragments and hex inside data: URIs.
      if (/data:|url\(/.test(line)) continue;
      const hits = line.match(/#[0-9a-fA-F]{3,8}\b/g);
      if (!hits) continue;
      failures.push(
        `[R3] Hardcoded colour ${hits.join(', ')} added in ${file}:\n` +
          `        ${line.trim().slice(0, 100)}\n` +
          `      Use a token from src/css/_variables.css (var(--ink-primary), var(--border-light),\n` +
          `      var(--btn-bg), var(--accent), var(--bg-page)). A hex literal is a module that\n` +
          `      will not follow a tenant's theme.`
      );
    }
  }
}

/** E1 — module settings editors are built from field strips. */
function checkFieldStripAdoption(files) {
  for (const file of files.filter((f) => SETTINGS_GLOB.test(f))) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    if (src.includes('BuilderModuleFieldStrip')) continue;
    failures.push(
      `[E1] ${file} does not use BuilderModuleFieldStrip.\n` +
        `      Settings editors are built from BuilderModuleFieldStrip + BuilderModuleField,\n` +
        `      never a hand-rolled grid or a bespoke flex row. Reference implementation:\n` +
        `      components/builder/builder-image-module-settings.tsx\n` +
        `      (Boy-scout rule: a module you touch comes up to standard in the same PR.)`
    );
  }
}

/** E4 — horizontal and vertical margin are always offered together. */
function checkMarginPairing(files) {
  for (const file of files.filter((f) => SETTINGS_GLOB.test(f))) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    const h = src.includes('horizontalMargin');
    const v = src.includes('verticalMargin');
    if (h === v) continue;
    failures.push(
      `[E4] ${file} offers ${h ? 'horizontalMargin without verticalMargin' : 'verticalMargin without horizontalMargin'}.\n` +
        `      Always offer both, adjacent in the same strip — never a lone "Margin". An operator\n` +
        `      who needs the missing one goes hunting through Advanced for a control that isn't there.`
    );
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
  const adopted = settings.filter((f) =>
    fs.readFileSync(path.join(dir, f), 'utf8').includes('BuilderModuleFieldStrip')
  );
  const offenders = breakpointOnlyLayout();
  const unpaired = settings.filter((f) => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    return src.includes('horizontalMargin') !== src.includes('verticalMargin');
  });

  console.log('\nUI doctrine — whole-repo debt (docs/MODULE_UI_DOCTRINE.md)\n');
  console.log(`  [E1] field-strip adoption ....... ${adopted.length}/${settings.length} editors`);
  console.log(`  [E4] unpaired H/V margin ........ ${unpaired.length} editors`);
  for (const f of unpaired) console.log(`         ${f}`);
  console.log(`  [R1] breakpoint-only layout ..... ${offenders.length} selectors (excl. ${R1_ALLOW.size} allowlisted)`);
  for (const o of offenders) console.log(`         ${o.file}:${o.line}  ${o.sel}`);
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
    // E4 is deliberately NOT gated repo-wide: two editors violate it today
    // (heading, current-poll), and fixing them means confirming the renderer
    // actually honours horizontalMargin first — adding the control blind would
    // violate E7 (no dead controls). Tracked in --report until then.
  } else {
    const files = stagedFiles();
    if (!files.length) return { failures, notes };
    checkBreakpointOnlyLayout({ all: false });
    checkRegeneratedCssLayer(files);
    checkHexLiterals(files);
    checkFieldStripAdoption(files);
    checkMarginPairing(files);
    checkNoDuplicatedChrome(files);
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
