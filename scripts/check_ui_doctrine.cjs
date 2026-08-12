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

// ---------------------------------------------------------------------------
// W8 — a size dropdown that spans past 100px counts in at least fives.
//
// Operator, 2026-08-12: "update any dropdown that lets you set the field width
// of something that would typically be more than 100px to increment by 5px
// instead of 1px." Site Search's Field Width ran 0–1200 in ones — 1,201
// options, and scrolling it to 400 was the worst control in the panel.
//
// The rule is keyed on the KEY NAME rather than on the option count, because
// a long list is not the problem by itself: `particleCount` (1–500) and
// `spread` (0–180) are a count and an angle, where every value is meaningful.
// Pixels above 100 are not — nobody sets a field width to the nearest pixel.
//
// Both steps that satisfy this today were set by hand, which is exactly why
// the check exists: the next width control would have started at 1 again.
// ---------------------------------------------------------------------------

/** Keys that name a pixel measurement rather than a count, angle, or index. */
const W8_SIZE_KEY = /(width|height|size)$/i;

/** Where the schema declares fields — editors, plus shared field modules. */
const W8_GLOB = /components\/builder\/.*\.tsx$/;

/** Smallest acceptable step once a size dropdown reaches past 100px. */
const W8_MIN_STEP = 5;

// Every entry needs a reason. "It was already like that" is not a reason.
const W8_ALLOW = new Map([]);

/**
 * Every `control: "number"` field in a source file, parsed from its OWN
 * object literal.
 *
 * Brace-matched rather than regex-scanned: a flat regex reading forward from
 * a `key:` happily walks past the end of its object and pairs a key with the
 * next field's min/max. That is not hypothetical — it is how a first pass at
 * this reported a Search Param with a range of 1–200.
 */
function w8NumberFields(src) {
  const fields = [];
  const marker = /control:\s*["']number["']/g;
  let m;

  while ((m = marker.exec(src))) {
    // Walk back to the `{` that opens this field's object.
    let depth = 0;
    let start = -1;
    for (let i = m.index; i >= 0; i--) {
      const ch = src[i];
      if (ch === '}') depth++;
      else if (ch === '{') {
        if (depth === 0) { start = i; break; }
        depth--;
      }
    }
    if (start < 0) continue;

    // ...and forward to its matching `}`.
    depth = 0;
    let end = -1;
    for (let i = start; i < src.length; i++) {
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end < 0) continue;

    const body = src.slice(start, end + 1);
    const read = (name) => {
      const hit = new RegExp(`\\b${name}:\\s*(-?\\d+)`).exec(body);
      return hit ? Number(hit[1]) : null;
    };
    const key = /\bkey:\s*["']([\w-]+)["']/.exec(body)?.[1];
    const max = read('max');
    if (!key || max === null) continue;

    fields.push({ key, min: read('min') ?? 0, max, step: read('step') ?? 1 });
  }

  return fields;
}

function checkSizeSelectStep(files) {
  for (const file of files.filter((f) => W8_GLOB.test(f))) {
    if (!fs.existsSync(file)) continue;

    for (const field of w8NumberFields(fs.readFileSync(file, 'utf8'))) {
      if (!W8_SIZE_KEY.test(field.key)) continue;
      if (field.max <= 100) continue;
      if (field.step >= W8_MIN_STEP) continue;
      if (W8_ALLOW.has(field.key)) continue;

      const options = Math.floor((field.max - field.min) / field.step) + 1;
      failures.push(
        `[W8] ${file} — \`${field.key}\` spans ${field.min}–${field.max}px in steps of ` +
          `${field.step}, so its dropdown holds ${options} options.\n` +
          `      A size past 100px counts in ${W8_MIN_STEP}s or coarser: add \`step: ${W8_MIN_STEP}\` ` +
          `(that would be ${Math.floor((field.max - field.min) / W8_MIN_STEP) + 1} options).\n` +
          `      Nobody sets a width to the nearest pixel. If this one genuinely needs every\n` +
          `      value, add it to W8_ALLOW in this file with the reason.`
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
// D7 — dialogs and popup editors size to their content.
//
// A dialog declares a floor, grows to fit what is inside it, and stops at 75%
// of the screen. A lone px width or max-width on a dialog shell is a guess
// about content someone made once — the operator has now reported a cramped
// editor four times, most recently a popped-out module panel capped at 680px
// with two thirds of the screen empty (2026-08-11 sweep).
//
// Allowlist entries need a reason. "It was already like that" is not one.
// ---------------------------------------------------------------------------
const DIALOG_SELECTOR = /(-modal|-popup|-dialog)\s*$/;

const D7_ALLOW = new Map([
  ['.builder-react-root .builder-gallery-modal.builder-module-palette-modal',
    'a picker grid of fixed-size cards, not an editor — 1200 is exactly four card columns'],
  ['.c-modal__dialog.builder-theme-picker-modal',
    'already opens at 98vw; the px value is only the ceiling on an ultrawide screen'],
  ['.c-modal__dialog.builder-theme-picker-modal.builder-module-image-picker-modal',
    'image picker grid, sized to its thumbnails, and it docks to one side rather than centring'],
  ['.c-modal__dialog.builder-theme-image-preview-modal',
    'a single preview image at 96vw — content sizing would shrink to the image, not grow'],
  ['.c-modal__dialog.campaign-preview-modal',
    'renders a post preview at its real posted width; growing it would misrepresent the post'],
  ['.c-modal__dialog.campaign-hashtag-modal', 'hashtag list, already 94vw'],
  ['.c-modal__dialog.peer-keyword-archive-dialog', 'confirmation, prose only'],
  ['.c-modal__dialog.peer-keyword-harvest-dialog', 'confirmation, prose only'],
  ['.promote-social-post-failure-dialog', 'an error message, prose only'],
  ['.youtube-miner-replies-modal', 'reply list, already min(1120px, 96vw)'],
  ['.builder-react-root .admin-image-preview-modal',
    'a single preview image; content sizing would shrink it to the intrinsic image width'],
]);

/**
 * Selectors the hand-authored overrides layer already content-sizes.
 *
 * A dialog defined in the REGENERATED layer cannot be fixed in place — the
 * next `extract_builder_css.mjs` run erases the edit (R2) — so its floor and
 * ceiling live in `_builder-react-overrides.css`, imported after and winning
 * by cascade. What ships is the override, so that is what D7 judges.
 */
function overriddenDialogSelectors() {
  const file = path.join(CSS_DIR, '_builder-react-overrides.css');
  if (!fs.existsSync(file)) return new Set();
  const src = fs.readFileSync(file, 'utf8');
  const fixed = new Set();
  for (const block of src.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!/width\s*:\s*max-content/.test(block[2])) continue;
    for (const sel of block[1].split(',')) fixed.add(sel.trim().split('\n').pop().trim());
  }
  return fixed;
}

function checkDialogWidths(files) {
  const overridden = overriddenDialogSelectors();

  // CSS: a dialog shell may declare min-width in px (a floor) but not a bare
  // width/max-width in px (a cap).
  for (const file of files.filter((f) => f.startsWith(CSS_DIR) && f.endsWith('.css'))) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split('\n');
    for (const block of src.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = block[1].trim().split('\n').pop().trim();
      if (!DIALOG_SELECTOR.test(selector) || D7_ALLOW.has(selector)) continue;
      if (overridden.has(selector)) continue;
      for (const decl of block[2].matchAll(/(?:^|;)\s*(max-width|width)\s*:\s*([^;]+)/g)) {
        const value = decl[2].trim();
        if (!/\d+(?:\.\d+)?px/.test(value)) continue;
        if (/\b(?:75|80)vw\b/.test(value)) continue;
        const line = lines.findIndex((l) => l.includes(selector.split(' ').pop())) + 1;
        failures.push(
          `[D7] ${file}:${line || '?'} ${selector} caps itself: ${decl[1]}: ${value}\n` +
            `      A dialog sizes to its content. Use a floor, not a cap:\n` +
            `        width: max-content;\n` +
            `        min-width: min(${value.match(/(\d+)px/)?.[1] || '520'}px, 100%);\n` +
            `        max-width: min(75vw, 100%);\n` +
            `      If this one genuinely should not grow, add it to D7_ALLOW with the reason.`
        );
      }
    }
  }

  // Components: no call site hands a modal a width number. The shell owns it.
  for (const file of files.filter((f) => f.endsWith('.tsx'))) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const hit of src.matchAll(/<Builder(\w*Modal|EditorPopup)\b[^>]*?\b(maxWidth|minWidth)=\{(\d+)\}/gs)) {
      failures.push(
        `[D7] ${file} passes ${hit[2]}={${hit[3]}} to <Builder${hit[1]}>.\n` +
          `      Call sites do not size dialogs — the shell sizes itself to its content\n` +
          `      and stops at 75% of the screen. Drop the prop.`
      );
    }
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
    // D7 is gated repo-wide from day one: the 2026-08-11 sweep left it clean,
    // so anything this catches is new.
    checkDialogWidths([
      ...sh("git ls-files 'src/css/*.css'").split('\n').filter(Boolean),
      ...sh("git ls-files 'components/**/*.tsx'").split('\n').filter(Boolean),
    ]);
    // E4 gated repo-wide since 2026-08-09: the two original violators are
    // fixed — current-poll's renderer honours both margins and pairs the
    // controls; heading gained horizontal margin capability by operator
    // ruling (its Top/Bottom split satisfies the vertical side).
    checkMarginPairing(tracked);
    // W8 is gated repo-wide from day one: the two controls that violated it
    // were fixed in the same change that added this, so anything it catches
    // is new.
    checkSizeSelectStep(sh("git ls-files 'components/builder/*.tsx'").split('\n').filter(Boolean));
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
    checkDialogWidths(files);
    checkSizeSelectStep(files);

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

// w8NumberFields is exported for scripts/builder/uiDoctrineSizeStep.test.js —
// the parser is the part with edge cases, and a checker nobody tests is a
// checker that can silently stop catching things.
module.exports = { run, w8NumberFields };

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
