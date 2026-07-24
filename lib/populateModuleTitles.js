'use strict';

/**
 * Populate Module Titles — core logic.
 *
 * Walks a page's sections and modules and fills the optional title fields
 * (`section.title` and `module.name`) from the content already inside each
 * container, using an operator-configurable priority order.
 *
 * Pure and side-effect free so it can be unit-tested (scripts/builder/
 * populateModuleTitles.test.js) and reused from the batch API route.
 *
 * The two title fields that exist in the data model today:
 *   - section.title  (the section's optional title)
 *   - module.name    (a module's optional title)
 * Columns/"cells" have no stored title field, so they are intentionally
 * not touched.
 */

const { htmlToPlainText } = require('./builderPageContentExtract');

const MAX_TITLE_LENGTH = 120;

const HEADING_TYPES = new Set(['heading']);
const IMAGE_TYPES = new Set(['image', 'floating-image']);
const BUTTON_TYPES = new Set(['button']);
const TEXT_TYPES = new Set(['text']);
const QUOTE_TYPES = new Set(['quote', 'speech-bubble']);

/**
 * Canonical source list. `key` is what gets persisted in the tool config and
 * reordered by the operator; `label` is the human-facing name. Each source has
 * a `kind` (what content it reads) and a `column` preference (which column the
 * content must sit in). The default array order encodes the operator's spec:
 *   1) left-most largest H  2) right-side largest H  3) largest H anywhere
 *   4) left-most image alt  5) right-side image alt  (+ configurable extras)
 */
const TITLE_SOURCES = [
  { key: 'heading-leftmost', label: 'Left-most, largest heading', kind: 'heading', column: 'leftmost' },
  { key: 'heading-rightside', label: 'Right-side, largest heading (two columns)', kind: 'heading', column: 'rightside' },
  { key: 'heading-largest', label: 'Largest heading anywhere', kind: 'heading', column: 'any' },
  { key: 'image-leftmost', label: 'Left-most image, Alt text', kind: 'image-alt', column: 'leftmost' },
  { key: 'image-rightside', label: 'Right-side image, Alt text (two columns)', kind: 'image-alt', column: 'rightside' },
  { key: 'image-any', label: 'Any image, Alt text', kind: 'image-alt', column: 'any' },
  { key: 'button', label: 'Button label', kind: 'button', column: 'any' },
  { key: 'text-first-line', label: 'First line of a text module', kind: 'text', column: 'any' },
  { key: 'quote', label: 'Quote text', kind: 'quote', column: 'any' },
  { key: 'image-filename', label: 'Image filename (when no Alt text)', kind: 'image-filename', column: 'any' },
];

const SOURCE_BY_KEY = new Map(TITLE_SOURCES.map((s) => [s.key, s]));
const DEFAULT_TITLE_PRIORITY = TITLE_SOURCES.map((s) => s.key);

/** Normalize a stored/legacy column name to a left→right rank. */
function columnRank(column) {
  const c = String(column || '').trim().toLowerCase();
  if (c === 'right' || c === 'col3') return 2;
  if (c === 'center' || c === 'middle' || c === 'col2') return 1;
  // left, main, col1, blank, or anything unrecognized → left-most
  return 0;
}

/** Clean an extracted string down to a single-line title. */
function toTitle(value) {
  const text = htmlToPlainText(value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > MAX_TITLE_LENGTH ? `${text.slice(0, MAX_TITLE_LENGTH - 1).trim()}…` : text;
}

/** Heading level as a number (h1 → 1). Lower means larger. Defaults to h2. */
function headingLevel(module) {
  const raw = String(module?.settings?.level || '').trim().toLowerCase();
  const match = raw.match(/^h([1-6])$/);
  return match ? Number(match[1]) : 2;
}

function fontSizeOf(module) {
  return Number(module?.settings?.fontSize || 0) || 0;
}

/** Filename (no extension, separators → spaces) from an image URL. */
function filenameFromUrl(url) {
  const clean = String(url || '').trim();
  if (!clean) return '';
  const withoutQuery = clean.split(/[?#]/)[0];
  const last = withoutQuery.split('/').filter(Boolean).pop() || '';
  const base = last.replace(/\.[a-z0-9]{1,5}$/i, '');
  return base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function moduleType(module) {
  return String(module?.type || '').trim().toLowerCase();
}

function imageUrlOf(module) {
  const settings = module?.settings || {};
  return settings.imageUrl || settings.url || '';
}

/**
 * Pull a candidate title of the given `kind` out of a list of modules
 * (already filtered to the relevant column). Returns '' when none qualify.
 */
function extractByKind(kind, modules) {
  if (kind === 'heading') {
    const headings = modules.filter((m) => HEADING_TYPES.has(moduleType(m)) && toTitle(m.text));
    if (!headings.length) return '';
    // Largest = smallest level number, then biggest font size, then first seen.
    const best = headings.reduce((winner, candidate) => {
      if (!winner) return candidate;
      const lw = headingLevel(winner);
      const lc = headingLevel(candidate);
      if (lc !== lw) return lc < lw ? candidate : winner;
      const fw = fontSizeOf(winner);
      const fc = fontSizeOf(candidate);
      if (fc !== fw) return fc > fw ? candidate : winner;
      return winner;
    }, null);
    return toTitle(best.text);
  }

  if (kind === 'image-alt') {
    for (const m of modules) {
      if (IMAGE_TYPES.has(moduleType(m))) {
        const alt = toTitle(m.settings?.alt);
        if (alt) return alt;
      }
    }
    return '';
  }

  if (kind === 'image-filename') {
    for (const m of modules) {
      if (IMAGE_TYPES.has(moduleType(m))) {
        const name = toTitle(filenameFromUrl(imageUrlOf(m)));
        if (name) return name;
      }
    }
    return '';
  }

  if (kind === 'button') {
    for (const m of modules) {
      if (BUTTON_TYPES.has(moduleType(m))) {
        const label = toTitle(m.text);
        if (label) return label;
      }
    }
    return '';
  }

  if (kind === 'text') {
    for (const m of modules) {
      if (TEXT_TYPES.has(moduleType(m))) {
        const line = htmlToPlainText(m.text).split('\n').map((s) => s.trim()).find(Boolean);
        const title = toTitle(line);
        if (title) return title;
      }
    }
    return '';
  }

  if (kind === 'quote') {
    for (const m of modules) {
      if (QUOTE_TYPES.has(moduleType(m))) {
        const line = htmlToPlainText(m.text).split('\n').map((s) => s.trim()).find(Boolean);
        const title = toTitle(line);
        if (title) return title;
      }
    }
    return '';
  }

  return '';
}

/** Filter modules by a source's column preference (left-most / right-side / any). */
function filterByColumn(columnPref, modules) {
  if (columnPref === 'any') return modules;

  const ranks = modules.map((m) => columnRank(m.column));
  const distinct = new Set(ranks);
  if (columnPref === 'leftmost') {
    const leftRank = Math.min(...ranks);
    return modules.filter((m) => columnRank(m.column) === leftRank);
  }
  if (columnPref === 'rightside') {
    // "if two columns" — only applies when modules span more than one column.
    if (distinct.size < 2) return [];
    const rightRank = Math.max(...ranks);
    return modules.filter((m) => columnRank(m.column) === rightRank);
  }
  return modules;
}

/**
 * Derive a single title from a set of modules using the ordered priority list.
 * First source that yields a non-empty candidate wins.
 */
function deriveTitle(modules, priority) {
  const list = Array.isArray(modules) ? modules.filter((m) => m && typeof m === 'object') : [];
  if (!list.length) return '';
  for (const key of normalizePriority(priority)) {
    const source = SOURCE_BY_KEY.get(key);
    if (!source) continue;
    const scoped = filterByColumn(source.column, list);
    if (!scoped.length) continue;
    const candidate = extractByKind(source.kind, scoped);
    if (candidate) return candidate;
  }
  return '';
}

/** Validate/complete a priority array: keep known keys in order, dedupe, then
 * append any known keys the caller omitted so the list is always exhaustive. */
function normalizePriority(priority) {
  const seen = new Set();
  const ordered = [];
  for (const key of Array.isArray(priority) ? priority : []) {
    if (SOURCE_BY_KEY.has(key) && !seen.has(key)) {
      seen.add(key);
      ordered.push(key);
    }
  }
  for (const key of DEFAULT_TITLE_PRIORITY) {
    if (!seen.has(key)) ordered.push(key);
  }
  return ordered;
}

function isBlank(value) {
  return !String(value || '').trim();
}

/**
 * Auto-generated placeholder titles the builder assigns (e.g. "Content Block",
 * "Content Block 1", "Content Block 2") are not titles the operator chose, so
 * "fill blanks only" should still replace them. Add more patterns here if other
 * default names turn up.
 */
const DEFAULT_TITLE_PATTERNS = [/^content block\b/i];

function isDefaultTitle(value) {
  const text = String(value || '').trim();
  return DEFAULT_TITLE_PATTERNS.some((pattern) => pattern.test(text));
}

/** A title is fair game to fill when it is empty or an auto-generated default. */
function isReplaceable(value) {
  return isBlank(value) || isDefaultTitle(value);
}

/**
 * Populate blank (or all, when overwrite) titles across a page's sections.
 * Returns a new sections array plus a change report; input is not mutated.
 *
 * @param {Array} sections - page.layoutSections
 * @param {object} [options]
 * @param {string[]} [options.priority] - ordered TITLE_SOURCES keys
 * @param {boolean} [options.overwrite] - replace existing titles too
 * @returns {{ sections: Array, changes: Array, changed: boolean }}
 */
function populateTitlesInSections(sections, options = {}) {
  const priority = normalizePriority(options.priority);
  const overwrite = options.overwrite === true;
  const changes = [];

  const nextSections = (Array.isArray(sections) ? sections : []).map((section) => {
    if (!section || typeof section !== 'object') return section;
    const modules = Array.isArray(section.modules) ? section.modules : [];

    const nextModules = modules.map((module) => {
      if (!module || typeof module !== 'object') return module;
      if (!overwrite && !isReplaceable(module.name)) return module;
      const title = deriveTitle([module], priority);
      if (!title || title === module.name) return module;
      changes.push({
        level: 'module',
        sectionId: section.id || '',
        moduleId: module.id || '',
        from: String(module.name || ''),
        to: title,
      });
      return { ...module, name: title };
    });

    let nextTitle = section.title;
    if (overwrite || isReplaceable(section.title)) {
      const title = deriveTitle(modules, priority);
      if (title && title !== section.title) {
        changes.push({
          level: 'section',
          sectionId: section.id || '',
          from: String(section.title || ''),
          to: title,
        });
        nextTitle = title;
      }
    }

    if (nextTitle === section.title && nextModules === section.modules) return section;
    return { ...section, title: nextTitle, modules: nextModules };
  });

  return { sections: nextSections, changes, changed: changes.length > 0 };
}

module.exports = {
  TITLE_SOURCES,
  DEFAULT_TITLE_PRIORITY,
  normalizePriority,
  deriveTitle,
  populateTitlesInSections,
};
