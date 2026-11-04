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
 * It lives here, as CommonJS beside public-site-page-slugs.js, because the
 * server (routes/) and the browser bundle (components/) must apply the SAME
 * rule, and this is the pattern both can import.
 */

const PAGE_LINK_PREFIX = 'page:';

// The id is everything up to the first "|"; ids here are integers or slugs of
// letters, digits, "_" and "-". The fallback is everything after it.
const PAGE_LINK_RE = /^page:([A-Za-z0-9_-]+)\|(.*)$/s;

// Finds every reference inside any text — including a page document turned
// into JSON, where a table's cells sit inside a JSON string of their own.
const PAGE_LINK_ID_SCAN_RE = /page:([A-Za-z0-9_-]+)\|/g;

/** True when the value is a stored page reference. */
function isPageLink(value) {
  return typeof value === 'string' && PAGE_LINK_RE.test(value);
}

/** `{ pageId, fallback }` for a stored reference, or null for anything else. */
function parsePageLink(value) {
  if (typeof value !== 'string') return null;
  const match = PAGE_LINK_RE.exec(value);
  if (!match) return null;
  return { pageId: match[1], fallback: match[2] };
}

/** The value a picker writes when a page is chosen. */
function makePageLink(pageId, fallback) {
  const id = String(pageId ?? '').trim();
  if (!id) return String(fallback ?? '');
  return `${PAGE_LINK_PREFIX}${id}|${String(fallback ?? '')}`;
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
    return { href: addressForSlug(slug, parsed.fallback), pageId: parsed.pageId, missing: false };
  }
  return { href: parsed.fallback, pageId: parsed.pageId, missing: Boolean(addresses) };
}

/** Just the address — the form every renderer wants. */
function pageLinkHref(value, addresses) {
  return resolvePageLink(value, addresses).href;
}

// A whole JSON string literal holding a reference: "page:<id>|<fallback>".
const PAGE_LINK_JSON_LITERAL_RE = /"page:[A-Za-z0-9_-]+\|(?:[^"\\]|\\.)*"/g;

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
 * setting that IS a reference, and references inside a setting that holds a
 * list as JSON text (a menu's items, cards, slides). Returns the SAME object
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
    else if (typeof value === 'string') resolved = resolvePageLinksInJsonText(value, addresses);
    if (resolved === value) continue;
    if (!next) next = { ...settings };
    next[key] = resolved;
  }
  return next || settings;
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

/** `{ [id]: slug }` from a list of page records ({ id, slug }). */
function buildPageAddressMap(pages) {
  const map = {};
  for (const page of Array.isArray(pages) ? pages : []) {
    const id = String(page?.id ?? '').trim();
    if (!id) continue;
    map[id] = String(page?.slug ?? '').replace(/^\/+/, '');
  }
  return map;
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
  collectPageLinkIds,
  buildPageAddressMap,
};
