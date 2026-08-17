/**
 * Read the CSS source into the handful of facts `check_css.mjs` asserts on.
 *
 * WHY THIS IS A SEPARATE FILE
 * The check itself needs a browser, which means it cannot run without one and
 * cannot be unit-tested cheaply. Everything here is pure text in, plain
 * objects out — so the parsing half, which is where the bugs actually were,
 * is tested by `scripts/builder/cssSourceScan.test.js` under
 * `npm run test:builder` like any other module. That test caught two real
 * defects before this shipped: every line number was off by one, and a
 * `var(--x, 8s)` fallback was being read as an animation name.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * This is not a CSS parser and must never grow into one. It finds
 * declarations, their line numbers, `@keyframes` names, animation-name
 * references and `var()` usage. The question "is this declaration valid?" is
 * never answered here — that is the browser's job, and the whole point of the
 * check is that only the browser knows.
 */

/** Values the browser accepts in `animation` that are not the NAME. */
const ANIMATION_KEYWORDS = new Set([
  'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end',
  'normal', 'reverse', 'alternate', 'alternate-reverse',
  'none', 'forwards', 'backwards', 'both',
  'running', 'paused',
  'infinite',
  'initial', 'inherit', 'unset', 'revert',
]);

/** `3s`, `.5s`, `300ms`, `2` — a duration, delay or iteration count. */
function isNumeric(token) {
  return /^[+-]?(\d+\.?\d*|\.\d+)(s|ms|%)?$/i.test(token);
}

/**
 * Split on separators that are NOT inside parentheses.
 *
 * A plain `value.split(',')` cuts `var(--sc-effect-travel-duration, 8s)` in
 * half and leaves `8s)` looking like an animation name — which is exactly
 * what the first run of this check reported, five times, against working
 * image effects. The separator that matters is always at depth zero.
 */
export function splitTopLevel(value, separator = ',') {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === separator && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/**
 * Strip balanced one-level function calls — `steps(4, end)`,
 * `cubic-bezier(.4, 0, .2, 1)`, `var(--x, 3s)` — so the remaining tokens can
 * be split on whitespace. Repeated until stable so nested calls go too.
 */
function stripFunctions(value) {
  let out = value;
  for (let pass = 0; pass < 8; pass += 1) {
    const next = out.replace(/[\w-]*\([^()]*\)/g, ' ');
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * The animation names a declaration references, if any.
 *
 * Handles both `animation-name: a, b` and the `animation:` shorthand, where
 * the name is positional and sits among up to seven other values. A name
 * supplied through `var()` is unknowable here and is skipped rather than
 * guessed at — better to miss one than to report a keyframe that is not
 * actually missing.
 */
export function animationNamesFromDeclaration(prop, value) {
  const property = prop.replace(/^-(webkit|moz|ms|o)-/, '');
  if (property !== 'animation' && property !== 'animation-name') return [];

  const names = [];
  for (const part of splitTopLevel(value, ',')) {
    if (property === 'animation-name') {
      const name = part.trim();
      if (!name || name.includes('var(')) continue;
      if (ANIMATION_KEYWORDS.has(name.toLowerCase())) continue;
      names.push(name);
      continue;
    }
    for (const token of stripFunctions(part).trim().split(/\s+/)) {
      if (!token) continue;
      if (isNumeric(token)) continue;
      if (ANIMATION_KEYWORDS.has(token.toLowerCase())) continue;
      names.push(token);
      break; // the first token that is not a keyword or a number IS the name
    }
  }
  return names;
}

/** Every `var(--x)` in a value, and whether it was given a fallback. */
export function varUsesFromValue(value) {
  const uses = [];
  const re = /var\(\s*(--[A-Za-z0-9_-]+)\s*([,)])/g;
  let match;
  while ((match = re.exec(value))) {
    uses.push({ name: match[1], hasFallback: match[2] === ',' });
  }
  return uses;
}

/**
 * Walk one stylesheet.
 *
 * The scan tracks brace depth, paren depth, strings and comments, which is
 * more bookkeeping than it looks like it needs — but `url(data:image/svg+xml;
 * base64,...)` carries both a `;` and a `:` inside parens, and splitting on
 * either one naively turns a working rule into a fake finding.
 */
export function scanCssSource(text, file = '') {
  const declarations = [];
  const keyframes = [];
  let line = 1;
  let depth = 0;
  let parens = 0;
  let buf = '';
  let colonAt = -1;
  /**
   * The line the declaration STARTS on, which is not the line the buffer
   * opened on: a buffer begins at the `{` or `;` and then collects the
   * newline and indentation before the property name. Anchoring to the buffer
   * reported every declaration one line early — a check that names the wrong
   * line sends people to the wrong place, which is worse than not checking.
   * -1 until the first non-whitespace character arrives.
   */
  let contentLine = -1;
  // Which rule block each declaration sits in. Needed because some questions
  // are only answerable among SIBLING declarations — `line-clamp: 2` beside a
  // working `-webkit-line-clamp: 2` is deliberate future-proofing, while the
  // same line on its own is dead.
  let blockCounter = 0;
  const blockStack = [];

  const append = (chars) => {
    if (contentLine === -1 && /\S/.test(chars)) contentLine = line;
    buf += chars;
  };

  const reset = () => {
    buf = '';
    colonAt = -1;
    contentLine = -1;
  };

  const flush = () => {
    const raw = buf;
    const startLine = contentLine === -1 ? line : contentLine;
    const at = colonAt;
    reset();
    // Only inside a rule block, and only a real `prop: value` pair.
    if (depth < 1 || at < 0) return;
    const prop = raw.slice(0, at).trim();
    let value = raw.slice(at + 1).trim();
    if (!/^(--)?[A-Za-z-][A-Za-z0-9_-]*$/.test(prop)) return;
    if (!value) return;
    let important = false;
    const bang = value.match(/!\s*important\s*$/i);
    if (bang) {
      important = true;
      value = value.slice(0, bang.index).trim();
    }
    if (!value) return;
    declarations.push({
      file,
      line: startLine,
      prop,
      value,
      important,
      custom: prop.startsWith('--'),
      block: blockStack[blockStack.length - 1] ?? 0,
    });
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (let j = i; j < stop; j += 1) if (text[j] === '\n') line += 1;
      i = stop - 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      append(ch);
      for (let j = i + 1; j < text.length; j += 1) {
        buf += text[j];
        if (text[j] === '\n') line += 1;
        if (text[j] === '\\') { buf += text[j + 1] ?? ''; j += 1; continue; }
        if (text[j] === ch) { i = j; break; }
        if (j === text.length - 1) i = j;
      }
      continue;
    }

    if (ch === '\n') { line += 1; buf += ch; continue; }
    if (ch === '(') { parens += 1; append(ch); continue; }
    if (ch === ')') { parens = Math.max(0, parens - 1); append(ch); continue; }

    if (parens > 0) { append(ch); continue; }

    if (ch === ':' && colonAt === -1) { colonAt = buf.length; append(ch); continue; }

    if (ch === '{') {
      const prelude = buf.trim();
      const kf = prelude.match(/^@(?:-\w+-)?keyframes\s+([^\s{]+)/i);
      if (kf) {
        keyframes.push({
          file,
          line: contentLine === -1 ? line : contentLine,
          name: kf[1].replace(/^["']|["']$/g, ''),
        });
      }
      blockCounter += 1;
      blockStack.push(blockCounter);
      depth += 1;
      reset();
      continue;
    }

    if (ch === '}') {
      flush();
      blockStack.pop();
      depth = Math.max(0, depth - 1);
      reset();
      continue;
    }

    if (ch === ';') { flush(); continue; }

    append(ch);
  }

  return { declarations, keyframes };
}

/**
 * Custom properties a stylesheet can legitimately read but never defines,
 * because something outside CSS sets them — every `--sc-effect-*` variable is
 * an inline style written by the renderer. Without this, C3 would report the
 * whole image-effects system as undefined, which is the kind of noise that
 * gets a check switched off.
 */
export function customPropertiesInSource(text) {
  const found = new Set();
  // Two shapes, because a property gets set from outside CSS in two ways:
  //   setProperty("--sc-effect-bounce", …) / { "--sc-effect-bounce": … }
  const quoted = /(['"`])(--[A-Za-z0-9_-]+)\1/g;
  //   <section style="--auth-bg-image: url(…)">  — an inline style attribute,
  // which is how `src/layout.html` defines the auth background. Missing this
  // shape reported a variable that IS defined, and a check that cries wolf on
  // working code is one people learn to skip.
  const assigned = /(--[A-Za-z0-9_-]+)\s*:/g;
  for (const re of [quoted, assigned]) {
    let match;
    while ((match = re.exec(text))) found.add(match[re === quoted ? 2 : 1]);
  }
  return found;
}
