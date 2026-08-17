/**
 * THE CSS CHECK — ask the browser what it actually kept.
 *
 * WHY THIS EXISTS
 * Nothing in this repo tests CSS (docs/DOCTRINE.md §5.14), and the gap has a
 * specific shape: a declaration the browser THREW AWAY reads perfectly in the
 * diff, in review, and in the source. On 2026-08-17 the image module's
 * never-upscale cap shipped as `max-width: min(100%, max-content)`. Intrinsic
 * keywords are not allowed inside `min()`, so Chrome binned the whole
 * declaration and the computed value was `none` — a cap that looked right
 * everywhere except in a running browser, where it did nothing.
 *
 * So this check does not attempt to know which CSS is valid. It asks the only
 * party that does. Every declaration in `src/css/` is handed to a real
 * Chromium; anything it refuses is a line that does nothing.
 *
 * Three assertions, all cheap and all corpus-wide:
 *   C1  a declaration the browser refused
 *   C2  an `animation-name` with no `@keyframes` behind it
 *   C3  a `var(--x)` used with NO fallback and defined nowhere
 *
 * C2 is the general form of the bug that started all of this: Cruise and
 * Tumbleweed were offered in two panels for months with no stylesheet rule
 * behind them, so choosing one set a class nobody had styled and the operator
 * saw a still picture, for months, with no error anywhere.
 *
 * NEEDS NOTHING. No server, no database, no login, no fixture — which is what
 * makes it the one browser check that can gate CI, and CI is the whole point:
 * `check:panels` has existed for months and reached the operator twice anyway,
 * because a check that only runs when a person remembers is a check that does
 * not run.
 *
 *   npm run check:css
 *   npm run check:css -- --update-baseline    # after fixing known findings
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  animationNamesFromDeclaration,
  customPropertiesInSource,
  scanCssSource,
  varUsesFromValue,
} from './css-source-scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'package.json'));
const { chromium } = require('playwright');

/**
 * THE SOURCE, NOT THE BUILD.
 *
 * `public/styles.css` is a build artifact; a line number in it is not
 * somewhere anyone can go and fix the problem. Reading the partials means
 * every finding names the file and line a human actually edits — which is the
 * difference between a check people act on and a check people mute.
 */
const CSS_DIR = path.join(ROOT, 'src', 'css');

/**
 * Where a custom property may be DEFINED from outside the stylesheet. The
 * image effects set every `--sc-effect-*` variable as an inline style at
 * render time, so without this C3 would report the entire effects system as
 * undefined — noise on that scale is how a check gets switched off.
 */
const RUNTIME_PROPERTY_SOURCES = ['components', 'lib', 'public/js', 'public/shared', 'src'];
const RUNTIME_PROPERTY_EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.html']);

/**
 * Findings already in the corpus when this check was written.
 *
 * A BASELINE IS A LIABILITY AND IS BUILT TO SHRINK. It exists because the
 * first run found 39 genuinely dead declarations in `legacy.css` —
 * `var(--text-dark)` and friends, referencing a token set that does not exist
 * and shipping to production doing nothing. Fixing them is real work with
 * real visual risk (defining those variables would CHANGE rendering, which is
 * a design decision, not a lint fix), and holding the gate hostage to it
 * would have meant this check never landed at all.
 *
 * So: anything listed here is known and does not fail. Anything NEW fails.
 * And a listed finding that no longer exists ALSO fails, with instructions to
 * prune — otherwise the file quietly accumulates until the day it covers a
 * real bug. The count only ever goes down.
 */
const BASELINE_FILE = path.join(ROOT, 'scripts', 'ui', 'css-check-baseline.json');
const UPDATE_BASELINE = process.argv.includes('--update-baseline');

/** Stable across edits above it — deliberately NOT keyed on a line number. */
const fingerprint = (f) => [f.code, f.file, f.detail].join(' | ');

async function readBaseline() {
  try {
    return JSON.parse(await readFile(BASELINE_FILE, 'utf8'));
  } catch {
    // No baseline yet is a legitimate state — a fresh corpus with nothing
    // known. It must not be a crash, or the first run of the check fails for
    // a reason that has nothing to do with the CSS.
    return {};
  }
}

/**
 * Vendor-prefixed properties and values are SKIPPED by C1, deliberately.
 *
 * `-moz-osx-font-smoothing: grayscale` and `display: -ms-flexbox` are correct,
 * intentional cross-browser fallbacks, and Chromium drops both — so probing
 * them reports a page of findings that are all working as designed. A check
 * whose first run is mostly false positives never gets a second run.
 */
function skipFromProbe(decl, propsInBlock) {
  if (decl.custom) return true;             // `--x` accepts nearly anything
  if (decl.prop.startsWith('-')) return true;
  if (/^-(moz|ms|o)-/i.test(decl.value)) return true;
  // THE STANDARDS-TRACK TWIN.
  //
  // `line-clamp: 2` sitting directly below a working `-webkit-line-clamp: 2`
  // is an author writing for the browser that will support it, not a mistake
  // — Chromium drops the unprefixed one today and clamps by the prefixed one
  // anyway. Flagging that would train people to ignore this check, so a
  // property is exempt when a vendor twin shares its rule block.
  const siblings = propsInBlock.get(decl.block);
  if (siblings) {
    for (const prefix of ['-webkit-', '-moz-', '-ms-', '-o-']) {
      if (siblings.has(prefix + decl.prop)) return true;
    }
  }
  return false;
}

async function readCssSources() {
  const files = (await readdir(CSS_DIR)).filter((f) => f.endsWith('.css')).sort();
  const sheets = [];
  for (const name of files) {
    const rel = path.join('src', 'css', name);
    const text = await readFile(path.join(CSS_DIR, name), 'utf8');
    sheets.push({ rel, ...scanCssSource(text, rel) });
  }
  return sheets;
}

async function readRuntimeProperties() {
  const defined = new Set();
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!RUNTIME_PROPERTY_EXTS.has(path.extname(entry.name))) continue;
      for (const name of customPropertiesInSource(await readFile(full, 'utf8'))) defined.add(name);
    }
  }
  for (const dir of RUNTIME_PROPERTY_SOURCES) await walk(path.join(ROOT, dir));
  return defined;
}

/** Hand every distinct declaration to Chromium and collect what it refused. */
async function findDroppedDeclarations(pairs) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    return await page.evaluate((input) => {
      const probe = document.createElement('div').style;
      const dropped = [];
      for (const [prop, value] of input) {
        probe.cssText = '';
        try {
          probe.setProperty(prop, value);
        } catch {
          dropped.push([prop, value]);
          continue;
        }
        // COUNT THE LONGHANDS, DO NOT READ THE VALUE BACK.
        //
        // `getPropertyValue(prop) === ''` is the obvious test and it is wrong
        // for shorthands: `border: none` sets seventeen longhands and still
        // reads back as an empty string, because the shorthand cannot be
        // re-serialised losslessly. The first run of this check reported 64
        // dropped declarations and 63 of them were ordinary working CSS
        // caught by exactly that mistake.
        //
        // A declaration the engine refused sets NOTHING, so its length is 0 —
        // true for shorthands and longhands alike.
        if (probe.length === 0) dropped.push([prop, value]);
      }
      return dropped;
    }, pairs);
  } finally {
    await browser.close();
  }
}

const sheets = await readCssSources();
const declarations = sheets.flatMap((s) => s.declarations);

/*
 * ZERO SCANNED IS A FAILURE, NOT A PASS.
 *
 * The single most repeated way a check dies here: `check:panels` reported
 * clean over empty item managers twice, and over a fixture cut from 53 modules
 * to 3 once. Each time a green run was read as proof. If the scanner ever
 * stops finding declarations — a moved directory, a rewritten parser — this
 * must be loud, because every assertion below trivially passes on nothing.
 */
if (!declarations.length) {
  console.error(
    `\n[check:css] Scanned ${sheets.length} stylesheet(s) in src/css/ and found NO declarations.\n` +
    'That is a failure, not a pass: every assertion below passes trivially on an empty\n' +
    'corpus. Either the source moved, or scanCssSource stopped parsing.\n'
  );
  process.exit(1);
}

const propsInBlock = new Map();
for (const d of declarations) {
  if (!propsInBlock.has(d.block)) propsInBlock.set(d.block, new Set());
  propsInBlock.get(d.block).add(d.prop);
}

const findings = [];
const add = (code, decl, detail, message) => {
  findings.push({ code, file: decl.file, line: decl.line, detail, message });
};

// ---------------------------------------------------------------- C1
const probeable = declarations.filter((d) => !skipFromProbe(d, propsInBlock));
const seen = new Map();
for (const d of probeable) {
  const key = `${d.prop} ${d.value}`;
  if (!seen.has(key)) seen.set(key, { prop: d.prop, value: d.value, decls: [] });
  seen.get(key).decls.push(d);
}
// Carried as a pair, never re-split out of the key: a value is full of spaces,
// so splitting `prop value` back apart would hand the browser three fragments
// of `min(100%, max-content)` and report a failure of our own making.
const pairs = [...seen.values()].map((entry) => [entry.prop, entry.value]);
for (const [prop, value] of await findDroppedDeclarations(pairs)) {
  for (const d of seen.get(`${prop} ${value}`)?.decls || []) {
    add('C1', d, `${prop}: ${value}`,
      `\`${prop}: ${value}\` — the browser threw this declaration away. ` +
      'It computes to nothing, so the rule reads as if it applies and does not.');
  }
}

// ---------------------------------------------------------------- C2
const definedKeyframes = new Set(sheets.flatMap((s) => s.keyframes.map((k) => k.name)));
for (const d of declarations) {
  for (const name of animationNamesFromDeclaration(d.prop, d.value)) {
    if (definedKeyframes.has(name)) continue;
    add('C2', d, name,
      `animation \`${name}\` has no \`@keyframes\` anywhere in src/css/ — the element ` +
      'carries an animation the engine cannot run, and stands still with no error.');
  }
}

// ---------------------------------------------------------------- C3
const definedProperties = new Set(declarations.filter((d) => d.custom).map((d) => d.prop));
for (const name of await readRuntimeProperties()) definedProperties.add(name);
for (const d of declarations) {
  for (const use of varUsesFromValue(d.value)) {
    // WITH a fallback this is a deliberate default and none of our business.
    // Without one it resolves to nothing, which invalidates the whole
    // declaration at computed-value time — silently.
    if (use.hasFallback || definedProperties.has(use.name)) continue;
    add('C3', d, `${d.prop} var(${use.name})`,
      `\`${d.prop}\` reads \`var(${use.name})\`, which is defined nowhere and has no ` +
      'fallback — the declaration is discarded at computed-value time.');
  }
}

// ---------------------------------------------------------------- baseline
const baseline = UPDATE_BASELINE ? {} : await readBaseline();
const counted = new Map();
for (const f of findings) {
  const key = fingerprint(f);
  counted.set(key, (counted.get(key) || 0) + 1);
}

if (UPDATE_BASELINE) {
  const next = Object.fromEntries([...counted.entries()].sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(
    `[check:css] Baseline rewritten with ${counted.size} known finding(s) ` +
    `(${findings.length} occurrence(s)). Commit ${path.relative(ROOT, BASELINE_FILE)}.`
  );
  process.exit(0);
}

const fresh = [];
for (const f of findings) {
  const key = fingerprint(f);
  const allowed = baseline[key] || 0;
  if (counted.get(key) > allowed) fresh.push(f);
}
// A baseline entry the corpus no longer produces. Pruned rather than kept:
// a stale allowance is an unlocked door nobody remembers leaving open.
const stale = Object.keys(baseline).filter((key) => !counted.has(key));

if (fresh.length) {
  console.error(`\n[check:css] FAILED — ${fresh.length} new problem(s):\n`);
  for (const f of fresh.sort((a, b) => `${a.file}:${a.line}`.localeCompare(`${b.file}:${b.line}`))) {
    console.error(`  ✗ ${f.code}  ${f.file}:${f.line}\n      ${f.message}`);
  }
  console.error(
    '\nThese are read back from a real browser, so "it looks correct" is not a\n' +
    'counter-argument — the engine has already refused them. Fix the source in\n' +
    'src/css/, never public/styles.css, and never src/css/_builder-react.css\n' +
    '(regenerated wholesale — put the fix in _builder-react-overrides.css).\n'
  );
  process.exit(1);
}

if (stale.length) {
  console.error(
    `\n[check:css] The baseline lists ${stale.length} finding(s) that no longer exist:\n\n` +
    stale.map((s) => `  ${s}`).join('\n') +
    '\n\nThat is good news — something got fixed. Prune the file so the allowance\n' +
    'cannot outlive the problem:\n\n  npm run check:css -- --update-baseline\n'
  );
  process.exit(1);
}

const known = findings.length;
console.log(
  `[check:css] OK — ${declarations.length} declarations across ${sheets.length} stylesheet(s); ` +
  `${seen.size} distinct pairs put to the browser, ${definedKeyframes.size} keyframes, ` +
  `${definedProperties.size} custom properties.` +
  (known ? `\n[check:css] ${known} known finding(s) held in the baseline — see scripts/ui/css-check-baseline.json.` : '')
);
