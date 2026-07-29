'use strict';

/**
 * SEO Alt Text — core logic for the "SEO Alt Text" Builder extension.
 *
 * For every image on a page that is missing alt text (or all images, when
 * `overwrite` is set), this gathers the words already in the image's section
 * plus the page's own name/slug, asks a web-search provider what is actually
 * ranking for those terms, then asks an AI model to write a short, natural,
 * keyword-grounded alt description and writes it into the image's `settings.alt`.
 *
 * The orchestration is kept pure and side-effect free: the two things that
 * touch the network — web search and the AI call — are injected as `search`
 * and `generateAlt`. The route wires the real Brave/Google search and the real
 * AI helper; the unit test injects fakes so no API calls are made. That mirrors
 * the shape of lib/populateModuleTitles.js (walk sections/modules, return a new
 * sections array plus a change report; input is never mutated).
 *
 * IMPORTANT: one page per call. The public site is served from Vercel, where a
 * serverless function is frozen the moment it returns its response — so we can't
 * fire-and-forget a long background loop across many pages (that truncated the
 * Header/Footer propagation on 7/22). The browser drives the loop instead,
 * calling the route once per page and advancing a progress bar as each returns.
 */

const { htmlToPlainText } = require('./builderPageContentExtract');

const MAX_ALT_LENGTH = 125; // Common accessibility/SEO guidance: keep alt text short.
const MAX_SECTION_TEXT = 1500; // Cap the section blob we hand to search/AI.
const MAX_SEARCH_RESULTS = 6; // Top Brave/Google results fed to the AI as grounding.

const IMAGE_TYPES = new Set(['image', 'floating-image']);
const TEXT_TYPES = new Set(['text']);
const HEADING_TYPES = new Set(['heading']);
const BUTTON_TYPES = new Set(['button']);
const QUOTE_TYPES = new Set(['quote', 'speech-bubble']);

function moduleType(module) {
  return String(module?.type || '').trim().toLowerCase();
}

function imageUrlOf(module) {
  const settings = module?.settings || {};
  return settings.imageUrl || settings.url || '';
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

function clean(value) {
  return htmlToPlainText(value).replace(/\s+/g, ' ').trim();
}

/** Alt text is fair game to fill when it is empty (unless overwrite is on). */
function isBlank(value) {
  return !String(value || '').trim();
}

function truncate(text, max) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}

/**
 * Collect the human-readable text of a section — headings (dedicated modules
 * and <h1>-<h6> embedded in rich text), paragraph text, button labels, quotes.
 * This is the raw material for both the search query and the AI prompt.
 */
const HTML_HEADING_RE = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;

function collectSectionText(section) {
  const parts = [];
  for (const module of Array.isArray(section?.modules) ? section.modules : []) {
    if (!module || typeof module !== 'object') continue;
    const type = moduleType(module);
    if (HEADING_TYPES.has(type)) {
      const text = clean(module.text);
      if (text) parts.push(text);
    } else if (TEXT_TYPES.has(type)) {
      const html = String(module.text || '');
      for (const match of html.matchAll(HTML_HEADING_RE)) {
        const text = clean(match[2]);
        if (text) parts.push(text);
      }
      const body = clean(module.text);
      if (body) parts.push(body);
    } else if (BUTTON_TYPES.has(type) || QUOTE_TYPES.has(type)) {
      const text = clean(module.text);
      if (text) parts.push(text);
    }
  }
  const sectionTitle = clean(section?.title);
  if (sectionTitle) parts.unshift(sectionTitle);
  return truncate(parts.join(' '), MAX_SECTION_TEXT);
}

/** Turn a page record into a compact context string (name + slug words). */
function pageContext(page) {
  const name = clean(page?.name);
  const slugWords = String(page?.slug || '')
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [name, slugWords].filter(Boolean).join(' ');
}

/**
 * Build the query we send to web search. Prefers the section's own words; falls
 * back to the image filename and page context so an image in a text-light
 * section still produces a meaningful search.
 */
function buildSearchQuery(sectionText, filename, ctx) {
  const primary = sectionText || filename;
  const query = [ctx, primary].filter(Boolean).join(' ').trim();
  return truncate(query, 300);
}

/** Compact the top search results into a grounding block for the AI prompt. */
function summarizeSearchResults(items) {
  return (Array.isArray(items) ? items : [])
    .slice(0, MAX_SEARCH_RESULTS)
    .map((item) => {
      const title = clean(item?.title);
      const snippet = truncate(clean(item?.snippet), 200);
      return [title, snippet].filter(Boolean).join(' — ');
    })
    .filter(Boolean)
    .join('\n');
}

const ALT_SYSTEM_PROMPT = `You write image alt text for a website. Alt text must be a single, natural, factual sentence that describes what the image most likely shows, grounded in the page's own topic. Prefer plain descriptive language a screen reader can read aloud and a search engine can quote. Do NOT stuff keywords, do NOT list comma-separated terms, do NOT start with "image of" or "picture of", do NOT use quotes. Reply with ONLY the alt text, nothing else.`;

/** Build the user prompt for one image from its section + search grounding. */
function buildAltPrompt({ sectionText, filename, searchSummary, ctx }) {
  const lines = ['Write alt text for an image on this web page.'];
  if (ctx) lines.push(`Page topic: ${ctx}`);
  if (sectionText) lines.push(`Text near the image:\n${sectionText}`);
  if (filename) lines.push(`Image file name: ${filename}`);
  if (searchSummary) {
    lines.push(
      `What currently ranks in search for these terms (use as grounding for real-world phrasing, not to copy):\n${searchSummary}`
    );
  }
  lines.push('Alt text:');
  return lines.join('\n\n');
}

/**
 * Find every image module that should get alt text on a page's sections.
 * Returns lightweight descriptors so the orchestrator can process them one at a
 * time without re-walking the tree.
 */
function collectImageTargets(sections, { overwrite = false } = {}) {
  const targets = [];
  (Array.isArray(sections) ? sections : []).forEach((section, sectionIndex) => {
    if (!section || typeof section !== 'object') return;
    const sectionText = collectSectionText(section);
    (Array.isArray(section.modules) ? section.modules : []).forEach((module, moduleIndex) => {
      if (!module || typeof module !== 'object') return;
      if (!IMAGE_TYPES.has(moduleType(module))) return;
      const currentAlt = module.settings?.alt;
      if (!overwrite && !isBlank(currentAlt)) return;
      targets.push({
        sectionIndex,
        moduleIndex,
        moduleId: module.id || '',
        sectionId: section.id || '',
        currentAlt: String(currentAlt || ''),
        filename: filenameFromUrl(imageUrlOf(module)),
        sectionText,
      });
    });
  });
  return targets;
}

/**
 * Generate alt text for every eligible image on ONE page. Returns a new
 * sections array (input untouched), a change report, and the changed flag.
 *
 * @param {object} args
 * @param {object} args.page              - a Builder page record
 * @param {boolean} [args.overwrite]      - replace existing alt text too
 * @param {function} args.search          - async (query) => [{ title, snippet, link }]
 * @param {function} args.generateAlt     - async ({ sectionText, filename, searchSummary, ctx, prompt }) => string
 */
async function generateAltTextForPage({ page, overwrite = false, search, generateAlt }) {
  const sections = Array.isArray(page?.layoutSections) ? page.layoutSections : [];
  const targets = collectImageTargets(sections, { overwrite });
  const ctx = pageContext(page);
  const changes = [];

  // Clone only the sections/modules we touch (structural sharing elsewhere).
  const nextSections = sections.map((s) => (s && typeof s === 'object' ? { ...s } : s));

  for (const target of targets) {
    let searchSummary = '';
    try {
      const query = buildSearchQuery(target.sectionText, target.filename, ctx);
      const results = query ? await search(query) : [];
      searchSummary = summarizeSearchResults(results);
    } catch {
      searchSummary = ''; // Search is grounding, not required — degrade gracefully.
    }

    const prompt = buildAltPrompt({
      sectionText: target.sectionText,
      filename: target.filename,
      searchSummary,
      ctx,
    });

    let alt = '';
    try {
      alt = truncate(
        String(
          (await generateAlt({
            sectionText: target.sectionText,
            filename: target.filename,
            searchSummary,
            ctx,
            prompt,
          })) || ''
        )
          .replace(/^["'\s]+|["'\s]+$/g, '')
          .replace(/\s+/g, ' '),
        MAX_ALT_LENGTH
      );
    } catch {
      alt = '';
    }

    if (!alt || alt === target.currentAlt) continue;

    const section = nextSections[target.sectionIndex];
    const modules = Array.isArray(section.modules) ? section.modules.slice() : [];
    const module = modules[target.moduleIndex];
    if (!module || typeof module !== 'object') continue;
    modules[target.moduleIndex] = {
      ...module,
      settings: { ...(module.settings || {}), alt },
    };
    section.modules = modules;

    changes.push({
      sectionId: target.sectionId,
      moduleId: target.moduleId,
      from: target.currentAlt,
      to: alt,
    });
  }

  return { sections: nextSections, changes, changed: changes.length > 0 };
}

module.exports = {
  MAX_ALT_LENGTH,
  MAX_SEARCH_RESULTS,
  ALT_SYSTEM_PROMPT,
  collectSectionText,
  pageContext,
  buildSearchQuery,
  summarizeSearchResults,
  buildAltPrompt,
  collectImageTargets,
  generateAltTextForPage,
};
