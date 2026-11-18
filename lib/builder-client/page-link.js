'use strict';

/**
 * A link to one of the site's own pages, stored BY REFERENCE.
 *
 * Every Builder setting that picks a page from a list (a Button's Link, the
 * search/blog/event "target page" settings, a table cell image link, …) used
 * to save a COPY of the page's address — "/about". Rename the page, or change
 * its address, and every one of those copies kept pointing at the old address:
 * the button 404'd on the live site and the picker quietly showed it as
 * "Custom…". Dane, 2026-11-03: "We need all such links to be done by reference
 * so that if the source changes, all references to it change accordingly."
 * (task 86bcxmrw2; the rule itself is DOCTRINE, task 86bcxmq23).
 *
 * THE ONE STORED SHAPE
 *
 *     page:<pageId>|<fallback>
 *
 * - `<pageId>` is the page's id — the part that never changes.
 * - `<fallback>` is the address as it was when the link was picked, in the
 *   shape the setting has always stored: a path ("/about") for most settings,
 *   a bare slug ("about") for the two that store slugs. It is used ONLY when
 *   the page no longer exists, and it decides the shape of the answer: a
 *   fallback starting with "/" resolves to a path, anything else to a slug.
 *
 * It is a plain string on purpose. Every one of these settings is a string in
 * `module.settings`, so nothing about how modules are saved, copied, merged or
 * normalized has to learn a new type — and a value that is NOT this shape
 * (every link saved before this existed, every typed "Custom…" address, every
 * external URL) is returned exactly as it is. Old values keep working
 * unchanged; that is the property the whole change rests on.
 *
 * THE ONE WAY BACK TO AN ADDRESS
 *
 * `resolvePageLink(value, addresses)` — `addresses` maps page id → the page's
 * CURRENT slug. The server builds that map for the pages a served page links
 * to (lib/pageLinkAddresses.js), and the Builder's preview builds it from the
 * page list it already has. Nothing else turns a reference into an address.
 *
 * A LINK TO A SECTION OF A PAGE (task SC-852)
 *
 *     page:<pageId>#<sectionId>|<fallback>
 *
 * The same shape with the section's own id after a "#". The section's id never
 * changes; its ANCHOR NAME (the `#about-us` a visitor sees in the address) is a
 * setting on the section that may be renamed at any time, so the name is
 * looked up when the page is shown, exactly as the page's address is. The
 * fallback carries the whole address as it was when picked ("/about#team"),
 * used only when the page or the section can no longer be found.
 *
 * The address map carries those names beside the slugs, under the key
 * `<pageId>#<sectionId>` (see `sectionAnchorKey`), so every caller that already
 * passes a map gets section links resolved with no new argument.
 *
 * It lives here, as CommonJS beside public-site-page-slugs.js, because the
 * server (routes/) and the browser bundle (components/) must apply the SAME
 * rule, and this is the pattern both can import.
 */

// The one slug rule (routes/CLAUDE.md): an anchor name is cleaned exactly the
// way a page address is.
const { slugify } = require('../slugify');

const PAGE_LINK_PREFIX = 'page:';

// The id is everything up to the first "|" (or "#"); ids here are integers or
// slugs of letters, digits, "_" and "-". An optional "#<sectionId>" names one
// section of that page. The fallback is everything after the "|".
const PAGE_LINK_RE = /^page:([A-Za-z0-9_-]+)(?:#([A-Za-z0-9_-]+))?\|(.*)$/s;

// Finds every reference inside any text — including a page document turned
// into JSON, where a table's cells sit inside a JSON string of their own.
const PAGE_LINK_ID_SCAN_RE = /page:([A-Za-z0-9_-]+)(?:#[A-Za-z0-9_-]+)?\|/g;

// The longest anchor name a section may carry.
const ANCHOR_NAME_MAX = 80;

/**
 * A section's anchor name as it is stored and rendered: the slug rule of
 * lib/slugify.js — lower case letters, digits and single hyphens, no hyphen at
 * either end ("About us!" → "about-us").
 * "" when nothing usable is left. The panel and the server both clean through
 * this, so a name the panel would refuse can never be saved by another route.
 */
function normalizeAnchorName(value) {
  if (typeof value !== 'string') return '';
  return slugify(value.trim().replace(/^#+/, '')).slice(0, ANCHOR_NAME_MAX).replace(/-+$/g, '');
}

/** The address-map key holding one section's anchor name. */
function sectionAnchorKey(pageId, sectionId) {
  return `${String(pageId ?? '').trim()}#${String(sectionId ?? '').trim()}`;
}

/** True when the value is a stored page reference. */
function isPageLink(value) {
  return typeof value === 'string' && PAGE_LINK_RE.test(value);
}

/**
 * `{ pageId, sectionId, fallback }` for a stored reference, or null for
 * anything else. `sectionId` is "" for a link to the top of a page.
 */
function parsePageLink(value) {
  if (typeof value !== 'string') return null;
  const match = PAGE_LINK_RE.exec(value);
  if (!match) return null;
  return { pageId: match[1], sectionId: match[2] || '', fallback: match[3] };
}

/**
 * The value a picker writes when a page — or one section of it — is chosen.
 * A section id that is not a plain id is dropped rather than stored, so the
 * value always parses back.
 */
function makePageLink(pageId, fallback, sectionId) {
  const id = String(pageId ?? '').trim();
  if (!id) return String(fallback ?? '');
  const section = String(sectionId ?? '').trim();
  const sectionPart = /^[A-Za-z0-9_-]+$/.test(section) ? `#${section}` : '';
  return `${PAGE_LINK_PREFIX}${id}${sectionPart}|${String(fallback ?? '')}`;
}

/** The "#name" part of an address, without the "#"; "" when it has none. */
function hashOf(address) {
  const text = String(address ?? '');
  const at = text.indexOf('#');
  return at === -1 ? '' : text.slice(at + 1);
}

/** An address with its "#name" part removed. */
function withoutHash(address) {
  const text = String(address ?? '');
  const at = text.indexOf('#');
  return at === -1 ? text : text.slice(0, at);
}

/**
 * The address for a slug, in the shape the fallback has: "/slug" when the
 * fallback is a path, the bare slug otherwise. The home page (slug "" or
 * "home") is "/".
 */
function addressForSlug(slugInput, fallback) {
  const slug = String(slugInput ?? '').trim().replace(/^\/+/, '');
  const wantsPath = String(fallback ?? '').startsWith('/');
  if (!wantsPath) return slug;
  return slug ? `/${slug}` : '/';
}

function lookupSlug(addresses, pageId) {
  if (!addresses) return undefined;
  if (addresses instanceof Map) return addresses.get(pageId);
  if (Object.prototype.hasOwnProperty.call(addresses, pageId)) return addresses[pageId];
  return undefined;
}

/**
 * Resolve one stored value.
 *
 * Returns `{ href, pageId, missing }`:
 * - not a reference → `{ href: value, pageId: '', missing: false }` (unchanged)
 * - a reference to a known page → its CURRENT address
 * - a reference to a page the map does not know → the saved fallback, with
 *   `missing: true` — but only when the map was actually supplied. With no
 *   map at all (nobody could look) the fallback is used and `missing` stays
 *   false, because "could not check" is not "the page is gone".
 */
function resolvePageLink(value, addresses) {
  const parsed = parsePageLink(value);
  if (!parsed) return { href: typeof value === 'string' ? value : '', pageId: '', missing: false };
  const slug = lookupSlug(addresses, parsed.pageId);
  if (typeof slug === 'string') {
    const base = addressForSlug(slug, withoutHash(parsed.fallback));
    if (!parsed.sectionId) return { href: base, pageId: parsed.pageId, missing: false };
    // A section link: the section's anchor name NOW. A section that has lost
    // its name, or is gone, keeps the name it had when the link was picked —
    // the page still opens, and lands there if a section carries that name.
    const anchor = lookupSlug(addresses, sectionAnchorKey(parsed.pageId, parsed.sectionId));
    const name = typeof anchor === 'string' && anchor ? anchor : hashOf(parsed.fallback);
    return { href: name ? `${base}#${name}` : base, pageId: parsed.pageId, missing: false };
  }
  return { href: parsed.fallback, pageId: parsed.pageId, missing: Boolean(addresses) };
}

/** Just the address — the form every renderer wants. */
function pageLinkHref(value, addresses) {
  return resolvePageLink(value, addresses).href;
}

// A whole JSON string literal holding a reference: "page:<id>|<fallback>".
// The opening quote must be a REAL one — not preceded by an odd run of
// backslashes — or the `\"page:` of a rich-text link's attribute inside a
// JSON string reads as a literal of its own, and replacing it shreds the rest
// of that HTML (task 86bcxthq5).
const PAGE_LINK_JSON_LITERAL_RE = /(?<=(?:^|[^\\])(?:\\\\)*)"page:[A-Za-z0-9_-]+(?:#[A-Za-z0-9_-]+)?\|(?:[^"\\]|\\.)*"/g;

/**
 * A setting that stores a LIST as JSON text — a menu's `navItems`, a card
 * grid's cards, a carousel's slides — with references resolved inside it
 * (task 86bcxmt5x). Only string values that ARE a reference are touched, one
 * JSON literal at a time, so everything else in the text is left byte for
 * byte. Returns the same string when there is nothing to resolve.
 */
function resolvePageLinksInJsonText(text, addresses) {
  if (typeof text !== 'string' || text.indexOf('"page:') === -1) return text;
  const head = text.trimStart().charAt(0);
  if (head !== '[' && head !== '{') return text;
  return text.replace(PAGE_LINK_JSON_LITERAL_RE, (literal) => {
    let value;
    try {
      value = JSON.parse(literal);
    } catch (_) {
      return literal;
    }
    if (!isPageLink(value)) return literal;
    return JSON.stringify(pageLinkHref(value, addresses));
  });
}

/**
 * A copy of a module's settings with every stored reference resolved — a
 * setting that IS a reference, references inside a setting that holds a
 * list as JSON text (a menu's items, cards, slides), and links inside a
 * setting that holds rich-text HTML. Returns the SAME object
 * when there is nothing to resolve, so a render that has no references
 * allocates nothing and memoised children do not re-render.
 */
function resolvePageLinksInSettings(settings, addresses) {
  if (!settings || typeof settings !== 'object') return settings;
  let next = null;
  for (const key of Object.keys(settings)) {
    const value = settings[key];
    let resolved = value;
    if (isPageLink(value)) resolved = pageLinkHref(value, addresses);
    else if (typeof value === 'string') {
      // A list held as JSON text, or rich-text HTML — never both: an anchor
      // inside JSON text has escaped quotes the HTML reader must not touch.
      const head = value.trimStart().charAt(0);
      resolved = head === '[' || head === '{'
        ? resolvePageLinksInJsonText(value, addresses)
        : resolvePageLinksInHtml(value, addresses);
    }
    if (resolved === value) continue;
    if (!next) next = { ...settings };
    next[key] = resolved;
  }
  return next || settings;
}

// A link typed inside rich text (task 86bcxthq5). The HTML keeps a working
// `href` — the address at the time the page was picked — and carries the
// reference beside it:
//
//     <a href="/about" data-page-link="page:12|/about">
//
// so a copy of the HTML that never meets this file (an export, an email, a
// page served before this existed) still has a link that went somewhere, and
// `collectPageLinkIds` finds the id with no change because it scans for the
// "page:<id>|" text wherever it sits.
const PAGE_LINK_ATTR = 'data-page-link';
const ANCHOR_OPEN_TAG_RE = /<a\b[^>]*>/gi;
const PAGE_LINK_ATTR_RE = /\sdata-page-link\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const HREF_ATTR_RE = /(\shref\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i;

function decodeAttributeValue(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function encodeAttributeValue(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Rich-text HTML with every `<a data-page-link="page:<id>|…">` pointed at the
 * page's CURRENT address. Only the `href` of those anchors changes; every
 * other byte — and every link typed as a plain address — is left exactly as
 * it was. Returns the same string when there is nothing to resolve.
 */
function resolvePageLinksInHtml(html, addresses) {
  if (typeof html !== 'string' || html.indexOf(PAGE_LINK_ATTR) === -1) return html;
  return html.replace(ANCHOR_OPEN_TAG_RE, (tag) => {
    const attr = PAGE_LINK_ATTR_RE.exec(tag);
    if (!attr) return tag;
    const reference = decodeAttributeValue(attr[1] ?? attr[2] ?? '');
    if (!isPageLink(reference)) return tag;
    const href = encodeAttributeValue(pageLinkHref(reference, addresses));
    if (HREF_ATTR_RE.test(tag)) return tag.replace(HREF_ATTR_RE, (_, lead) => `${lead}"${href}"`);
    return tag.replace(/^<a\b/i, `<a href="${href}"`);
  });
}

/** Every page id referenced anywhere in `value` (any depth, inside JSON text too). */
function collectPageLinkIds(value) {
  const ids = new Set();
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch (_) {
    return ids;
  }
  if (!text || text.indexOf(PAGE_LINK_PREFIX) === -1) return ids;
  PAGE_LINK_ID_SCAN_RE.lastIndex = 0;
  let match;
  while ((match = PAGE_LINK_ID_SCAN_RE.exec(text))) ids.add(match[1]);
  return ids;
}

/** The sections array whichever shape it arrives in (`{ sections }`, bare, or JSON text). */
function sectionsOfLayout(layout) {
  let value = layout;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (_) {
      return [];
    }
  }
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.sections)) return value.sections;
  return [];
}

/**
 * Add one page's section anchor names to an address map, under
 * `sectionAnchorKey(pageId, sectionId)`. Only sections that carry a name.
 */
function addSectionAnchors(map, pageId, layout) {
  const id = String(pageId ?? '').trim();
  if (!id) return map;
  for (const section of sectionsOfLayout(layout)) {
    const sectionId = String(section?.id ?? '').trim();
    const name = normalizeAnchorName(section?.anchorName);
    if (sectionId && name) map[sectionAnchorKey(id, sectionId)] = name;
  }
  return map;
}

/**
 * `{ [id]: slug }` from a list of page records ({ id, slug }), plus each named
 * section's anchor name when the records carry their sections
 * (`layoutSections`).
 */
function buildPageAddressMap(pages) {
  const map = {};
  for (const page of Array.isArray(pages) ? pages : []) {
    const id = String(page?.id ?? '').trim();
    if (!id) continue;
    map[id] = String(page?.slug ?? '').replace(/^\/+/, '');
    if (page?.layoutSections) addSectionAnchors(map, id, page.layoutSections);
  }
  return map;
}

/**
 * Every named section of one page, in page order: `{ sectionId, anchorName,
 * title }`. What a link picker lists under "a section of this page".
 */
function listSectionAnchors(layout) {
  const out = [];
  for (const section of sectionsOfLayout(layout)) {
    const sectionId = String(section?.id ?? '').trim();
    const anchorName = normalizeAnchorName(section?.anchorName);
    if (!sectionId || !anchorName) continue;
    out.push({ sectionId, anchorName, title: String(section?.title ?? '').trim() });
  }
  return out;
}

/** True when any reference in `value` names a section (`page:<id>#<section>|`). */
function mentionsSectionLink(value) {
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch (_) {
    return false;
  }
  return Boolean(text) && /page:[A-Za-z0-9_-]+#[A-Za-z0-9_-]+\|/.test(text);
}

/*
 * DOES A "#name" LINK LAND? (task SC-855)
 *
 * A link that jumps to part of a page only works when something on that page
 * carries the name. Bayside's import went live with a top menu of `#services`,
 * `#about` and `#contact` and no section carrying any of them — every click did
 * nothing — and the two checks that should have said so only ever asked
 * whether the PAGE existed. These are the one answer to "would it land?", used
 * by the import difference report (lib/site-import/fidelity.ts) and the
 * broken-links scan (lib/pageInboundLinks.js), so the two cannot disagree.
 */

// `id="services"` inside a module's HTML (rich text keeps ids — sanitize-html
// allows them), in plain HTML or inside JSON text where the quotes are escaped.
const HTML_ID_RE = /\bid\s*=\s*(?:\\?"|\\?')([^"'\\<>\s]+)(?:\\?"|\\?')/g;

/**
 * Every name a "#name" link on this page can land on: each section's anchor
 * name (rendered as the section's `id`) and every `id="…"` written inside a
 * module's content.
 */
function anchorTargetsOf(layout) {
  const names = new Set();
  for (const section of sectionsOfLayout(layout)) {
    const name = normalizeAnchorName(section?.anchorName);
    if (name) names.add(name);
    let text = '';
    try {
      text = JSON.stringify(section?.modules ?? []);
    } catch (_) {
      text = '';
    }
    HTML_ID_RE.lastIndex = 0;
    let match;
    while ((match = HTML_ID_RE.exec(text))) names.add(match[1]);
  }
  return names;
}

/** A "#name" as the browser would look it up; "" for one that names no place. */
function jumpName(raw) {
  let name = String(raw ?? '');
  try {
    name = decodeURIComponent(name);
  } catch (_) {
    // the browser looks up the raw text, so this does too
  }
  // "#" is a placeholder (a menu parent with no page of its own), "#top" is the
  // top of the page whatever carries it, and "#!/…" / "#/…" are app routes.
  if (!name || name.toLowerCase() === 'top' || /^[!/]/.test(name)) return '';
  return name;
}

/**
 * What a stored link value jumps to, or null when it jumps to no part of a
 * page (no "#", a placeholder "#", an external site, a mail link):
 *   { kind: 'reference', pageId, sectionId, name } — `page:<id>#<section>|…`;
 *       `name` is the one the link was saved with (the fallback's "#name")
 *   { kind: 'same-page', name }                    — "#services"
 *   { kind: 'address', address, name }             — "/about#team", address "about" ("" = home)
 * `ownHosts` are the site's own domains, so "https://<domain>/about#team" counts.
 */
function jumpOf(value, ownHosts = []) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  const ref = parsePageLink(text);
  if (ref) {
    if (!ref.sectionId) return null;
    return { kind: 'reference', pageId: ref.pageId, sectionId: ref.sectionId, name: jumpName(hashOf(ref.fallback)) };
  }
  const at = text.indexOf('#');
  if (at === -1) return null;
  const name = jumpName(text.slice(at + 1));
  if (!name) return null;
  let path = text.slice(0, at);
  if (!path) return { kind: 'same-page', name };
  if (/^https?:\/\//i.test(path)) {
    let url;
    try {
      url = new URL(path);
    } catch (_) {
      return null;
    }
    const hosts = (ownHosts || []).map((h) => String(h || '').toLowerCase().replace(/^www\./, '')).filter(Boolean);
    if (!hosts.includes(url.host.toLowerCase().replace(/^www\./, ''))) return null;
    path = url.pathname || '/';
  } else if (!path.startsWith('/') || path.startsWith('//')) {
    return null;
  }
  const address = path.replace(/\?.*$/s, '').replace(/\.html$/i, '').trim().toLowerCase().replace(/^\/+|\/+$/g, '');
  return { kind: 'address', address: address === 'home' ? '' : address, name };
}

/**
 * Does a jump land on its page? `layout` is the page's sections.
 *   { lands: true }
 *   { lands: false, why } — in words, for the report
 * A reference follows the section's anchor name as it is NOW, and falls back to
 * the name the link was saved with, exactly as `resolvePageLink` renders it.
 */
function jumpLands(jump, layout) {
  const targets = anchorTargetsOf(layout);
  if (jump.kind === 'reference') {
    const section = sectionsOfLayout(layout).find((s) => String(s?.id ?? '') === jump.sectionId);
    const current = normalizeAnchorName(section?.anchorName);
    const name = current || jump.name;
    if (name && targets.has(name)) return { lands: true };
    if (!section) {
      return { lands: false, why: `jumps to a section that is no longer on the page${jump.name ? ` (it was #${jump.name})` : ''}` };
    }
    return { lands: false, why: 'jumps to a section that has no Anchor Name, so it opens the top of the page' };
  }
  if (targets.has(jump.name)) return { lands: true };
  return { lands: false, why: `jumps to #${jump.name}, and nothing on the page has that name` };
}

module.exports = {
  PAGE_LINK_PREFIX,
  isPageLink,
  parsePageLink,
  makePageLink,
  addressForSlug,
  resolvePageLink,
  pageLinkHref,
  resolvePageLinksInSettings,
  resolvePageLinksInJsonText,
  PAGE_LINK_ATTR,
  resolvePageLinksInHtml,
  collectPageLinkIds,
  buildPageAddressMap,
  ANCHOR_NAME_MAX,
  normalizeAnchorName,
  sectionAnchorKey,
  sectionsOfLayout,
  addSectionAnchors,
  listSectionAnchors,
  mentionsSectionLink,
  anchorTargetsOf,
  jumpOf,
  jumpLands,
};
