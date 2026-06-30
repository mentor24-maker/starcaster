#!/usr/bin/env node
/**
 * Extract Builder-related rules from a globals.css-style source file into
 * src/css/_builder-react.css, scoping every selector under
 * .builder-react-root so the ported React UI cannot collide with
 * starcaster's vanilla styles.
 *
 * starcaster's Builder CSS is now maintained directly in
 * src/css/_builder-react.css (it is no longer regenerated automatically).
 * This script is a manual one-off import tool for pulling rules from an
 * external globals.css source when needed — it requires an explicit path:
 *   node scripts/extract_builder_css.mjs <path-to-source-globals.css>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/extract_builder_css.mjs <path-to-source-globals.css>');
  process.exit(1);
}
const outfile = path.join(root, 'src', 'css', '_builder-react.css');

// Class-name prefixes the ported components use (see components/ and
// components/builder/). A rule is kept when any selector references one.
const KEEP_PATTERNS = [
  /\.builder[-_]/,
  /\.admin-/,
  /\.rich-text/,
  /\.site-nav/,
  /\.poll-/,
  /\.polls-/,
  /\.player-game/,
  /\.speech-bubble/,
  /\.panel\b/,
  /\.panel-(label|copy)/,
  /\.(secondary|danger|submit|option)-button/,
  /\.option-list/,
  /\.result-(bar|list|meta|panel|row)/,
  /\.gallery-meta/,
  /\.crud-actions/,
  /\.action-panel/,
  /\.product-card/,
  /\.table-shell/,
  /\.template-id/,
  /\.page-(copy|eyebrow)/,
  /\.empty-cell/,
  /\.field\b/,
  /\.notice\b/,
  /\.error\b/,
  /\.success\b/,
  /\.sr-only/,
  /\.starcaster-effect/,
  /\.blog-post/
];

function keepSelector(selectorList) {
  return KEEP_PATTERNS.some((pattern) => pattern.test(selectorList));
}

function scopeSelector(selectorList) {
  return selectorList
    .split(',')
    .map((selector) => {
      const s = selector.trim();
      if (!s) return s;
      if (s.startsWith(':root')) return s.replace(':root', '.builder-react-root');
      if (/^(html|body)\b/.test(s)) return `.builder-react-root${s.replace(/^(html|body)/, '')}`;
      return `.builder-react-root ${s}`;
    })
    .join(',\n');
}

/** Split a css block body into top-level rules: [{selector, body}] */
function parseRules(css) {
  const rules = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    const selector = css.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
      j += 1;
    }
    rules.push({ selector, body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return rules;
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const css = stripComments(fs.readFileSync(source, 'utf8'));
const out = [];
const rootVars = [];

for (const rule of parseRules(css)) {
  const { selector, body } = rule;

  if (selector.startsWith('@media') || selector.startsWith('@supports')) {
    const kept = parseRules(body)
      .filter((inner) => keepSelector(inner.selector))
      .map((inner) => `  ${scopeSelector(inner.selector)} {${inner.body}}`);
    if (kept.length) out.push(`${selector} {\n${kept.join('\n')}\n}`);
    continue;
  }

  if (selector.startsWith('@keyframes') || selector.startsWith('@font-face')) {
    out.push(`${selector} {${body}}`);
    continue;
  }

  if (selector.startsWith('@')) continue;

  if (/^:root\b/.test(selector)) {
    rootVars.push(body.trim());
    continue;
  }

  if (keepSelector(selector)) {
    out.push(`${scopeSelector(selector)} {${body}}`);
  }
}

const banner = `/*\n * Imported by scripts/extract_builder_css.mjs from: ${source}\n * Re-running this script will overwrite the file with a fresh import.\n */\n`;
const vars = rootVars.length ? `.builder-react-root {\n${rootVars.join('\n')}\n}\n\n` : '';
fs.writeFileSync(outfile, banner + vars + out.join('\n\n') + '\n');
console.log(`Wrote ${path.relative(root, outfile)} (${out.length} rules, ${rootVars.length} :root blocks)`);
