'use strict';

/**
 * Title Case for form field labels — UI_RULES L10 (SC-811, SC-812).
 *
 * Dane chose Title Case for field labels in both projects on 2026-11-15
 * (SP-318): "Theme Name", not "Theme name". The rule is Spirality's
 * docs/UI_DOCTRINE.md §1, and this file is StarCaster's copy of the check
 * Spirality's tracker/style.test.mjs runs, extended to the places labels live
 * here: `label="…"` props in the React admin and Builder panels, Builder
 * settings fields declared as data (`{ key, label, control }`), and the text
 * of `<label>` elements in React, in the admin app's HTML and in the frozen
 * vanilla JS.
 *
 * `scripts/builder/labelCase.test.js` runs `findLabelProblems()` over the
 * whole tree inside `npm run verify`, so a sentence-case label fails the pull
 * request instead of reaching the screen.
 */

const fs = require('fs');
const path = require('path');

/** Words that stay lower case inside a title (the same list as docs/UI_DOCTRINE.md). */
const SMALL_WORDS = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'nor', 'for', 'so', 'yet', 'as', 'at', 'by', 'in',
  'of', 'on', 'to', 'up', 'via', 'per', 'vs', 'with', 'from', 'into', 'onto',
]);

/**
 * Units of measure written lower case on purpose ("Size (px)", "Delay (ms)").
 * They are symbols, not words, so "(Px)" would be wrong.
 */
const UNITS = new Set(['px', 'em', 'rem', 'ms', 's', 'sec', 'min', 'deg', 'vw', 'vh', 'pt', 'fr', 'x', 'kb', 'mb', 'h']);

/** A placeholder standing for a part filled in at run time (`${…}` or `{…}`). */
const FILL = '\u0000';

/**
 * A word the rule leaves alone even when it starts lower case: a unit, a
 * brand written with an inner capital ("iPhone", "eBay"), an address or a
 * path ("/about", "e.g.", "#anchor"), or code written in a label.
 */
function exempt(bare, word) {
  if (UNITS.has(bare.toLowerCase())) return true;
  if (/^\p{Ll}+\p{Lu}/u.test(bare)) return true; // iPhone, eBay, iOS
  const w = word.replace(/[.,;:!?)]+$/, '');
  if (/^[(]?[/.#@]/.test(w) || /:\/\/|[=_]|\p{L}\.\p{L}/u.test(w)) return true; // /about, .mp4, https://, some_key, a.b
  if (/^(e\.g|i\.e|etc)\b/i.test(word)) return true;
  return false;
}

/**
 * Split a word into its leading punctuation, its letters, and the rest, so
 * "(px)" → ["(", "px", ")"].
 */
function parts(word) {
  const m = word.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}'’-]*)(.*)$/su);
  return { lead: m[1], core: m[2], tail: m[3] };
}

/**
 * Walk the words of `text` and call `flag(word, parts)` for each one Title
 * Case would capitalise. Fill-ins are not checked. The first word, and the
 * first after a colon or an opening bracket, is always capitalised (unless it
 * is a unit); a small word elsewhere may be either ("Set Up a Project" — only
 * a person can tell a small word that is part of the verb). The check and the
 * rewrite both use this, so they cannot disagree about which word is wrong.
 */
function eachWrongWord(text, flag) {
  let start = true;
  return String(text).replace(/\S+/g, (word) => {
    if (word.includes(FILL) || word.includes('$') || word.includes('{')) { start = false; return word; }
    const p = parts(word);
    if (!p.core) { if (/:$/.test(word)) start = true; return word; }
    const bare = p.core.replace(/['’-].*$/, '').toLowerCase();
    const opensClause = p.lead.includes('(') || p.lead.includes('[');
    let out = word;
    if (/\p{Ll}/u.test(p.core[0]) && !exempt(p.core, word) &&
        (start || opensClause || !SMALL_WORDS.has(bare))) {
      out = flag(word, p) ?? word;
    }
    start = /:$/.test(word);
    return out;
  });
}

/**
 * Why `text` is not in Title Case, or null when it is. A label written as a
 * full sentence keeps sentence case, except where `sentences` is false: a
 * checkbox's caption is a label, and a full stop added to one is a way round
 * the rule, not a sentence (SC-812's second send-back).
 */
function titleCaseProblem(text, { sentences = true } = {}) {
  if (sentences && isSentence(text)) return null;
  let first = null;
  eachWrongWord(text, (word) => { first = first ?? word; });
  if (first) return `"${first}" should start with a capital letter`;
  if (isSentence(text)) return 'a checkbox caption is a label, not a sentence: drop the full stop and put the explanation in help text';
  return null;
}

/**
 * `text` rewritten in Title Case: every word that the check would flag gets
 * its first letter capitalised. Nothing is ever lower-cased, so "CRM",
 * "YouTube" and a small word someone capitalised on purpose ("Set Up") are
 * kept as written, and a sentence is left as a sentence, as the check leaves it.
 */
function toTitleCase(text) {
  if (isSentence(text)) return String(text);
  return eachWrongWord(text, (word, { lead, core, tail }) => lead + core[0].toUpperCase() + core.slice(1) + tail);
}

/**
 * A label written as a full sentence ("Every field starts empty.")
 * is a sentence, and sentences keep sentence case (docs/UI_DOCTRINE.md §1.2).
 * The full stop is what says so.
 */
function isSentence(text) {
  return /[^.]\.\s*$/.test(String(text).trim()) && !/\b(e\.g|i\.e|etc)\.\s*$/i.test(String(text).trim());
}

/**
 * `source` with every comment blanked out (newlines kept, so line numbers
 * stay true) — a `<label>` mentioned in a comment is not a label.
 */
function blankComments(source) {
  const keepLines = (t) => t.replace(/[^\n]/g, ' ');
  return source
    // <!-- a comment --> in the admin app's HTML (SC-812's second send-back).
    .replace(/<!--[\s\S]*?-->/g, keepLines)
    // A comment opens after a space, a brace or the start of a line; "video/*"
    // and "https://" are text, not comments.
    .replace(/(^|[\s{;(),])\/\*[\s\S]*?\*\//g, (m, pre) => pre + keepLines(m.slice(pre.length)))
    .replace(/(^|[\s{;)])\/\/[^\n]*/gm, (m, pre) => pre + keepLines(m.slice(pre.length)));
}

/** Replace every balanced `${…}` / `{…}` with a fill-in placeholder. */
function fillIns(text) {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const dollar = text[i] === '$' && text[i + 1] === '{';
    if (dollar || text[i] === '{') {
      let depth = 0;
      let j = dollar ? i + 1 : i;
      for (; j < text.length; j += 1) {
        if (text[j] === '{') depth += 1;
        else if (text[j] === '}' && (depth -= 1) === 0) break;
      }
      out += ` ${FILL} `;
      i = j;
    } else {
      out += text[i];
    }
  }
  return out;
}

/**
 * The words a `<label>` element shows directly — its own text, not the text
 * of an element inside it (a `<span class="meta">` hint inside a label is a
 * sentence and stays one). Each run of text between child elements is its
 * own label, so a checkbox's caption after the `<input>` is read too.
 */
function labelTextRuns(inner) {
  // Own text that is only a fill-in or punctuation (`{required ? ' *' : null}`,
  // a trailing ':') is not a caption, so the label still counts as having no
  // text of its own and its caption <span> is read (SC-812's second send-back).
  const own = textRuns(inner, false).filter(checkable);
  return own.length ? own : textRuns(inner, true);
}

/** labelTextRuns' worker; `captions` also reads a caption <span>'s text. */
function textRuns(inner, captions) {
  const runs = [];
  let depth = 0;
  let buf = '';
  const flush = () => {
    const t = buf.replace(/&(apos|rsquo|#39);/gi, "'").replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
    if (t) runs.push(t);
    buf = '';
  };
  const filled = fillIns(inner);
  const re = /<(\/?)([a-zA-Z][\w.-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let last = 0;
  // The depth at which a caption <span> opened, or -1: its text is read as
  // the label's caption, as if it sat directly in the <label>.
  let captionAt = -1;
  let m;
  while ((m = re.exec(filled))) {
    if (depth === 0 || captionAt === depth - 1) buf += filled.slice(last, m.index);
    flush();
    const closing = m[1] === '/';
    const selfClosing = m[4] === '/' || /^(input|br|img|hr)$/i.test(m[2]);
    if (closing) {
      depth = Math.max(0, depth - 1);
      if (captionAt === depth) captionAt = -1;
    } else if (!selfClosing) {
      if (captions && depth === 0 && captionAt < 0 && isCaptionSpan(m[2], m[3])) captionAt = 0;
      depth += 1;
    }
    last = re.lastIndex;
  }
  if (depth === 0) buf += filled.slice(last);
  flush();
  return runs;
}

/**
 * <label><span>Font Size</span><input /></label> — when a label has no text
 * of its own, a <span> directly inside it is the label's caption, unless its class marks it as a hint ("meta",
 * "hint", "muted", "help", "note", "sub", "desc"), which is a sentence and
 * stays one. SC-812's send-back found seven captions written this way that
 * the check could not see.
 */
function isCaptionSpan(tag, attrs) {
  if (tag.toLowerCase() !== 'span') return false;
  const cls = String(attrs || '').match(/class(?:Name)?=(?:"([^"]*)"|'([^']*)'|\{[^}]*?["'`]([^"'`]*)["'`][^}]*\})/);
  const names = cls ? (cls[1] ?? cls[2] ?? cls[3] ?? '') : '';
  return !/(^|[\s_-])(meta|hint|muted|help|note|sub|desc|description|caption-hint|subtle|secondary)([\s_-]|$)/i.test(names);
}

/** A label that is only a fill-in, punctuation or a symbol is not a label to check. */
function checkable(text) {
  const t = text.split(FILL).join(' ').trim();
  // A lone small word ("to" between two controls) joins them; it is not a label.
  return /\p{L}/u.test(t) && !/^\p{L}$/u.test(t) && !SMALL_WORDS.has(t.toLowerCase());
}

/**
 * The text of the object literal around `index`, with every object nested
 * inside it blanked — so a field's `options: [{ value, label }]` does not
 * make the field look like an option, nor an option look like a field.
 */
function ownText(source, index) {
  let depth = 0;
  let start = index;
  for (; start >= 0; start -= 1) {
    if (source[start] === '}') depth += 1;
    else if (source[start] === '{') { if (depth === 0) break; depth -= 1; }
  }
  depth = 0;
  let end = index;
  for (; end < source.length; end += 1) {
    if (source[end] === '{') depth += 1;
    else if (source[end] === '}') { if (depth === 0) break; depth -= 1; }
  }
  if (start < 0 || end >= source.length) return '';
  let body = source.slice(start + 1, end);
  let prev;
  do { prev = body; body = body.replace(/\{[^{}]*\}/g, ''); } while (body !== prev);
  return body;
}

/**
 * A Builder settings field: an object naming the setting it edits (`key:`)
 * and the control that edits it (`control:`). A dropdown option is
 * `{ value, label }`, and an option's label is not a field label.
 */
function isFieldConfig(own) {
  return /(?<![\w-])key:/.test(own) && /(?<![\w-])control:/.test(own) && !/(?<![\w-])value:/.test(own);
}

/**
 * Every field label in `source`, as { line, kind, text, raw }. `raw` is the
 * exact substring to rewrite for a `label="…"` prop; `<label>` runs carry
 * their text only.
 */
function labelsOf(source, { jsx, fields = jsx }) {
  const found = [];
  const lineOf = (index) => source.slice(0, index).split('\n').length;
  if (jsx || fields) {
    // { key: "iconSize", label: "Icon size", control: "number" } — a Builder
    // settings field declared as data, which the panel renders as a label.
    // The frozen Builder (public/js/builder.js) declares its fields the same
    // way in plain JS, so this runs there too (SC-812's send-back).
    // Either quote, holding the other ("What didn't work").
    for (const m of source.matchAll(/(?<![\w-])label:\s*(?:"([^"\n{}$]+)"|'([^'\n{}$]+)')/g)) {
      const text = m[1] ?? m[2];
      if (isFieldConfig(ownText(source, m.index)) && checkable(text)) {
        found.push({ line: lineOf(m.index), kind: 'field config', text: text.trim() });
      }
    }
  }
  if (jsx) {
    // label="Theme name" — a prop. aria-label / data-label are not field labels.
    for (const m of source.matchAll(/(?<![\w-])label="([^"{}\n]+)"/g)) {
      if (NOT_FIELD_LABEL.has(tagBefore(source, m.index))) continue;
      if (checkable(m[1])) found.push({ line: lineOf(m.index), kind: 'label prop', text: m[1].trim() });
    }
    // label={editing ? 'Their Note, Pasted' : `Last ${n} Days`} — a label chosen
    // by an expression. Each quoted string the expression can RESULT in is read
    // (after `?`, `:`, `??`, `||`, or as the whole expression); a string it only
    // compares against (`=== 'targetText'`) is not. SC-812's send-back found
    // three such labels left in sentence case beside their converted twins.
    for (const m of source.matchAll(/(?<![\w-])label=\{/g)) {
      if (NOT_FIELD_LABEL.has(tagBefore(source, m.index))) continue;
      const open = m.index + m[0].length - 1;
      const close = matchingBrace(source, open);
      if (close < 0) continue;
      const expr = source.slice(open + 1, close);
      for (const lm of expr.matchAll(/(^|\?\?|\|\||[?:(])\s*(['"`])((?:(?!\2)[^\\\n]|\\.)*)\2\s*(?=$|[:)])/g)) {
        const text = fillIns(lm[3]).replace(/\s+/g, ' ').trim();
        if (checkable(text)) found.push({ line: lineOf(m.index), kind: 'label expression', text });
      }
    }
  }
  for (const m of source.matchAll(/<label\b(?:[^>"'{]|"[^"]*"|'[^']*'|\{[^}]*\})*>([\s\S]*?)<\/label>/g)) {
    const start = m.index + m[0].length - m[1].length - '</label>'.length;
    // A <label> holding a checkbox: its words are the box's caption, and a
    // caption is never a sentence. (A radio button's label is one choice among
    // several, like a dropdown option, and may explain itself in a sentence.)
    const kind = holdsCheckbox(m[1]) ? 'checkbox caption' : '<label>';
    for (const text of labelTextRuns(m[1])) {
      if (checkable(text)) found.push({ line: lineOf(start), kind, text });
    }
  }
  return found;
}

/**
 * Components whose `label` prop is not a field label: DriveLink's is a link's
 * spoken name (it becomes aria-label), RunResult's names a status region for a
 * screen reader only, LessonRow's is a channel tag beside a lesson. Their
 * strings are sentences or names, not captions over an input.
 */
const NOT_FIELD_LABEL = new Set(['DriveLink', 'LessonRow', 'RunResult']);

/** The name of the JSX element whose attributes contain `index`. */
function tagBefore(source, index) {
  const open = source.lastIndexOf('<', index);
  const m = open < 0 ? null : source.slice(open).match(/^<([A-Za-z][\w.]*)/);
  return m ? m[1] : '';
}

/**
 * Each `<input …>` tag in `source`, read whole: a `>` inside a quoted value or
 * a `{…}` attribute (the `=>` of `onChange={(event) => …}`) does not end the
 * tag. Stopping at the first `>` hid a checkbox whose handler came before
 * `type="checkbox"` (SC-812's third send-back).
 */
function inputTags(source) {
  const tags = [];
  for (const m of source.matchAll(/<input\b/g)) {
    let depth = 0;
    let quote = '';
    let i = m.index + m[0].length;
    for (; i < source.length; i += 1) {
      const c = source[i];
      if (quote) { if (c === quote) quote = ''; continue; }
      if (c === '"' || c === "'" || (depth > 0 && c === '`')) quote = c;
      else if (c === '{') depth += 1;
      else if (c === '}') depth = Math.max(0, depth - 1);
      else if (c === '>' && depth === 0) break;
    }
    tags.push(source.slice(m.index, i + 1));
  }
  return tags;
}

/** Whether a `<label>`'s inner markup holds a checkbox. */
function holdsCheckbox(inner) {
  return inputTags(inner).some((tag) =>
    /\btype=(?:"checkbox"|'checkbox'|\{\s*["'`]checkbox["'`]\s*\})/.test(tag));
}

/** The index of the `}` closing the `{` at `open`, or -1. */
function matchingBrace(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && (depth -= 1) === 0) return i;
  }
  return -1;
}

const ROOT = path.join(__dirname, '..');

/**
 * Where field labels live. Tests are skipped (their strings are fixtures),
 * and so is the live-site renderer's tenant content.
 */
const SCAN = [
  { dir: 'components', exts: ['.tsx'], jsx: true },
  { dir: 'lib/builder-client', exts: ['.tsx'], jsx: true },
  { dir: 'src/pages', exts: ['.html'], jsx: false },
  { dir: 'src/layout.html', exts: ['.html'], jsx: false },
  { dir: 'public/js', exts: ['.js'], jsx: false, fields: true, skip: /richtext-vendor/ },
];

function walk(rel, exts, out) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return out;
  const stat = fs.statSync(abs);
  if (stat.isFile()) { if (exts.includes(path.extname(abs))) out.push(rel); return out; }
  for (const name of fs.readdirSync(abs).sort()) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    walk(path.join(rel, name), exts, out);
  }
  return out;
}

/** Every file the check reads, as { file, jsx }. */
function scannedFiles() {
  const files = [];
  for (const { dir, exts, jsx, fields = jsx, skip } of SCAN) {
    for (const file of walk(dir, exts, [])) {
      if (/\.test\.|\.spec\./.test(file)) continue;
      if (skip && skip.test(file)) continue;
      files.push({ file, jsx, fields });
    }
  }
  return files;
}

/** Why one found label breaks the rule, or null. A checkbox caption may not be a sentence. */
function labelProblem(label) {
  return titleCaseProblem(label.text, { sentences: label.kind !== 'checkbox caption' });
}

/** { seen, problems: [{ file, line, kind, text, why }] } over the whole tree. */
function findLabelProblems() {
  let seen = 0;
  const problems = [];
  for (const { file, jsx, fields } of scannedFiles()) {
    const source = blankComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    for (const label of labelsOf(source, { jsx, fields })) {
      seen += 1;
      const why = labelProblem(label);
      if (why) problems.push({ file, ...label, why });
    }
  }
  return { seen, problems };
}

module.exports = {
  SMALL_WORDS,
  titleCaseProblem,
  toTitleCase,
  isSentence,
  blankComments,
  labelsOf,
  labelTextRuns,
  scannedFiles,
  findLabelProblems,
  labelProblem,
  FILL,
};
