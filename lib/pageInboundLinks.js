'use strict';

/**
 * WHAT POINTS AT THIS PAGE? — the one answer, used by two callers.
 *
 * Once page links are stored as the page itself (`page:<id>|<fallback>`,
 * lib/builder-client/page-link.js — tasks 86bcxmrw2, 86bcxmt5x), renaming a
 * page can no longer break a link to it. One way remains: DELETING a page
 * that buttons, menus or forms still point to (task 86bcxn69z). Two things
 * ask about that, and they must not be able to disagree, so both call this:
 *
 *   - the delete dialog on Builder › Pages (routes/builderPageLinks.js) —
 *     "these links still point at the page you are about to delete";
 *   - the weekly check across every project (scripts/broken_links_check.mjs)
 *     — "these links point at a page that no longer exists".
 *
 * Pure: it is handed the rows and reads nothing itself. The callers own I/O.
 *
 * WHAT COUNTS AS A LINK TO A PAGE
 *   - a stored reference, `page:<id>|…`, in ANY module setting — found by
 *     scanning the text, so a setting that starts storing references later is
 *     covered without anybody remembering this file;
 *   - a TYPED address ("/about", or "https://<the project's domain>/about") in
 *     one of the link settings listed below. Every link saved before 86bcxmrw2
 *     is still one of these until the one-time upgrade runs (86bcxthkp), and
 *     menus store typed addresses until 86bcxmt5x is live. A setting that
 *     starts holding links is ONE entry in LINK_SETTINGS or LIST_LINK_SETTINGS;
 *   - a CRM form's "After submit: go to a page" (stored by id, task 86bcxmq23)
 *     or a typed After-submit address on the project's own domain.
 *
 * WHAT IT DOES NOT SEE (named so nobody reads silence as "checked"):
 *   - links typed inside rich text (a text block's own <a href>) — 86bcxthq5;
 *   - published snapshots: drafts are the authority on what a page links to,
 *     the same choice lib/pageLinkAddresses.js makes;
 *   - links to other websites (a non-goal of 86bcxn69z).
 *
 * SHARED HEADERS AND FOOTERS are counted once. A page's copy of a saved
 * section it follows (`canonical: true`) carries the same menu as the saved
 * section, and listing "Header › About" for each of forty pages would bury
 * the one line that matters. So a copy's link that the saved section also
 * has is reported once, against the saved section, with how many pages show
 * it. A link that only the page's copy has (a "Changed" copy) is still
 * reported against the page.
 */

const { parsePageLink, collectPageLinkIds } = require('./builder-client/page-link');
const { normalizePublicSiteHost } = require('./publicSiteHosts');
const { readFormHandlingMeta, normalizeFormHandling } = require('./crmFormHandling');

/**
 * module type → { setting: shape }. `path` settings hold "/slug" addresses,
 * `slug` settings hold a bare slug. These are the settings the page picker
 * writes (scripts/convert_page_links_to_references.js PICKER_FIELDS) plus the
 * typed link boxes 86bcxmt5x turns into pickers.
 */
const LINK_SETTINGS = {
  button: { href: 'path' },
  'admin-login': { successRedirect: 'path' },
  'admin-nav-link': { linkHref: 'path' },
  'site-search': { targetPageUrl: 'path' },
  'blog-search': { targetPageUrl: 'path' },
  'blog-post-tags': { targetPageUrl: 'path' },
  'blog-category-filter': { targetPageUrl: 'path' },
  'blog-tag-cloud': { targetPageUrl: 'path' },
  'messaging-topic-list': { targetPageUrl: 'path' },
  'blog-search-results': { postPageUrl: 'path' },
  'blog-post-create': { viewPageUrl: 'path', redirectAfterCreate: 'path' },
  'blog-post-manager': { editPageUrl: 'path', viewPageUrl: 'path' },
  'event-calendar': { eventPageUrl: 'path' },
  'event-detail': { backLinkUrl: 'path' },
  'event-manager': { viewPageUrl: 'path' },
  'blog-post-list': { postSlug: 'slug' },
  'blog-latest-posts': { postSlug: 'slug' },
  image: { linkUrl: 'path' },
  galaxy: { linkUrl: 'path' },
  'blog-post-card': { url: 'path' },
};

/** module type → { setting holding a JSON list: { item field: shape } }. */
const LIST_LINK_SETTINGS = {
  navigation: { navItems: { href: 'path' } },
  'feature-cards': { cards: { linkUrl: 'path' } },
  carousel: { items: { linkUrl: 'path' } },
};

/** How a setting reads to a person. Unlisted settings show their key. */
const SETTING_LABELS = {
  href: 'Link',
  linkUrl: 'Link',
  linkHref: 'Link',
  url: 'Link',
  successRedirect: 'After sign-in page',
  targetPageUrl: 'Results page',
  postPageUrl: 'Post page',
  viewPageUrl: 'View page',
  editPageUrl: 'Edit page',
  redirectAfterCreate: 'After create page',
  eventPageUrl: 'Event page',
  backLinkUrl: 'Back link',
  postSlug: 'Post page',
};

const LIST_LABELS = { navItems: 'Menu item', cards: 'Card', items: 'Slide' };

const MODULE_LABELS = {
  navigation: 'Menu',
  button: 'Button',
  image: 'Image',
  'feature-cards': 'Cards',
  carousel: 'Carousel',
};

/**
 * Addresses a site answers that are not Builder pages, so a typed link to one
 * is never "broken". `admin-logout` is a virtual action
 * (lib/builder-client/public-site-page-slugs.js).
 */
const NON_PAGE_ADDRESSES = new Set(['admin-logout']);

// ------------------------------------------------------------- addresses

/** "/About/" → "about"; "/" and "/home" → "" (both mean the home page). */
function normalizeAddress(value) {
  const slug = String(value ?? '').trim().toLowerCase().replace(/^\/+|\/+$/g, '');
  return slug === 'home' ? '' : slug;
}

/**
 * The page address a typed value names, or null when it does not name one of
 * the project's own pages: an external site, a mail link, an anchor, a merge
 * token, a deeper path (no page slug contains "/").
 *
 *   domain — the project's own domain, so "https://<domain>/about" counts.
 */
function typedAddress(raw, shape, domain = '') {
  let value = typeof raw === 'string' ? raw.trim() : '';
  if (!value || parsePageLink(value)) return null;
  if (/^https?:\/\//i.test(value)) {
    const own = normalizePublicSiteHost(domain);
    if (!own) return null;
    let url;
    try { url = new URL(value); } catch (_) { return null; }
    if (normalizePublicSiteHost(url.host) !== own) return null;
    value = url.pathname || '/';
  } else if (shape === 'path') {
    if (!value.startsWith('/') || value.startsWith('//')) return null;
  } else if (/[/:]/.test(value.replace(/^\/+/, ''))) {
    return null;
  }
  const bare = value.replace(/[?#].*$/s, '');
  const address = normalizeAddress(bare);
  if (address.includes('/')) return null;
  return address;
}

// ------------------------------------------------------------- the walk

function moduleName(mod) {
  const type = String(mod?.type || 'module');
  const name = String(mod?.name || '').trim();
  const kind = MODULE_LABELS[type] || type;
  return name && name !== type ? `${kind} "${name}"` : kind;
}

function settingLabel(key) {
  return SETTING_LABELS[key] || key;
}

/**
 * One link. `target` is { pageId } for a reference, { address } for a typed
 * address. `item` names the menu item / card / slide, when there is one.
 */
function linkFrom(base, setting, item, value, target) {
  return { ...base, setting, item, value: String(value ?? ''), ...target };
}

function linksInValue(base, setting, item, value, shape, domain) {
  const out = [];
  const ref = parsePageLink(typeof value === 'string' ? value.trim() : value);
  if (ref) {
    out.push(linkFrom(base, setting, item, value, { pageId: ref.pageId }));
    return out;
  }
  if (shape) {
    const address = typedAddress(value, shape, domain);
    if (address !== null) out.push(linkFrom(base, setting, item, value, { address }));
    return out;
  }
  // An unlisted setting: references only, wherever they sit in its text.
  if (typeof value === 'string' && value.includes('page:')) {
    for (const pageId of collectPageLinkIds(value)) out.push(linkFrom(base, setting, item, value, { pageId }));
  }
  return out;
}

function parseList(text) {
  if (typeof text !== 'string' || !text) return null;
  try {
    const list = JSON.parse(text);
    return Array.isArray(list) ? list : null;
  } catch (_) {
    return null;
  }
}

/** Every link one module holds, table cells included. */
function linksInModule(mod, where, domain) {
  if (!mod || typeof mod !== 'object') return [];
  const type = String(mod.type || '');
  const settings = mod.settings && typeof mod.settings === 'object' ? mod.settings : {};
  const base = { where, module: moduleName(mod) };
  const fields = LINK_SETTINGS[type] || {};
  const lists = LIST_LINK_SETTINGS[type] || {};
  const out = [];

  for (const [key, value] of Object.entries(settings)) {
    if (lists[key]) {
      const items = parseList(value);
      if (!items) continue;
      items.forEach((item, index) => {
        if (!item || typeof item !== 'object') return;
        const label = String(item.label || item.title || item.heading || '').trim() || `#${index + 1}`;
        const named = `${LIST_LABELS[key] || 'Item'} "${label}"`;
        for (const [field, shape] of Object.entries(lists[key])) {
          out.push(...linksInValue(base, settingLabel(field), named, item[field], shape, domain));
        }
      });
      continue;
    }
    if (type === 'table' && key === 'tableData') {
      let data = null;
      try { data = typeof value === 'string' && value ? JSON.parse(value) : null; } catch (_) { data = null; }
      const cells = data && data.cells && typeof data.cells === 'object' ? data.cells : {};
      for (const [cellKey, children] of Object.entries(cells)) {
        if (!Array.isArray(children)) continue;
        for (const child of children) out.push(...linksInModule(child, `${where} › ${base.module} › cell ${cellKey}`, domain));
      }
      continue;
    }
    out.push(...linksInValue(base, settingLabel(key), '', value, fields[key], domain));
  }
  return out;
}

function sectionLabel(section, index) {
  return String(section?.title || section?.name || '').trim() || `Section ${index + 1}`;
}

function linksInSection(section, index, where, domain) {
  if (!section || !Array.isArray(section.modules)) return [];
  const label = `${where} › ${sectionLabel(section, index)}`;
  return section.modules.flatMap((mod) => linksInModule(mod, label, domain));
}

/** The sections array whichever shape the row stores (`{ sections }` or bare). */
function sectionsOf(layout) {
  if (Array.isArray(layout)) return layout;
  if (layout && Array.isArray(layout.sections)) return layout.sections;
  return [];
}

/** What makes two links "the same link" across a saved section and its copies. */
function signature(link) {
  return [link.module, link.setting, link.item, link.value].join('\u0000');
}

function pageName(page) {
  const name = String(page?.name || '').trim();
  if (name) return `${name} page`;
  const slug = String(page?.slug || '').trim();
  return slug ? `/${slug}` : 'Home page';
}

/**
 * Every link in one project.
 *
 *   pages          [{ id, name, slug, layoutSections | layout_sections }]
 *   savedSections  [{ id, name, section }]
 *   forms          [{ id, name, fields | handling }]  (raw rows are fine)
 *   domain         the project's own domain, '' when it has none
 *
 * Returns [{ source: { kind, id, name }, where, module, setting, item, value,
 *            pageId? , address?, shownOn? }].
 */
function collectProjectLinks({ pages = [], savedSections = [], forms = [], domain = '' } = {}) {
  const links = [];
  const savedById = new Map();
  for (const saved of savedSections || []) {
    const id = String(saved?.id ?? '').trim();
    if (!id) continue;
    const name = String(saved?.name || '').trim() || `Saved section ${id}`;
    const source = { kind: 'saved-section', id, name };
    const found = linksInSection(saved.section, 0, `Saved section "${name}"`, domain)
      .map((link) => ({ ...link, source, shownOn: 0 }));
    savedById.set(id, { found, signatures: new Map(found.map((link) => [signature(link), link])) });
    links.push(...found);
  }

  for (const page of pages || []) {
    const id = String(page?.id ?? '').trim();
    if (!id) continue;
    const name = pageName(page);
    const source = { kind: 'page', id, name };
    const sections = sectionsOf(page.layoutSections ?? page.layout_sections);
    sections.forEach((section, index) => {
      const savedId = String(section?.savedSectionId ?? '').trim();
      const master = section?.canonical === true && savedId ? savedById.get(savedId) : null;
      const found = linksInSection(section, index, name, domain).map((link) => ({ ...link, source }));
      const counted = new Set();
      for (const link of found) {
        const twin = master ? master.signatures.get(signature(link)) : null;
        if (twin) {
          // Once per page, however many times the copy repeats it.
          if (!counted.has(twin)) { twin.shownOn += 1; counted.add(twin); }
          continue;
        }
        links.push(link);
      }
    });
  }

  for (const form of forms || []) {
    const id = String(form?.id ?? '').trim();
    if (!id) continue;
    const handling = normalizeFormHandling(form.handling !== undefined ? form.handling : readFormHandlingMeta(form.fields));
    if (handling.afterSubmit !== 'redirect') continue;
    const name = String(form?.name || '').trim() || `Form ${id}`;
    const base = {
      source: { kind: 'form', id, name },
      where: `CRM form "${name}"`,
      module: 'Form',
      setting: 'After submit',
      item: '',
    };
    if (handling.redirectPageId) {
      links.push({ ...base, value: handling.redirectPageId, pageId: handling.redirectPageId });
    } else {
      const address = typedAddress(handling.redirectUrl, 'path', domain);
      if (address !== null) links.push({ ...base, value: handling.redirectUrl, address });
    }
  }
  return links;
}

// ------------------------------------------------------------- the two questions

function pagesByAddress(pages) {
  const map = new Map();
  for (const page of pages || []) {
    const address = normalizeAddress(page?.slug);
    if (!map.has(address)) map.set(address, []);
    map.get(address).push(String(page.id));
  }
  return map;
}

function pointsAt(link, page) {
  const id = String(page?.id ?? '');
  if (link.pageId !== undefined) return link.pageId === id;
  return link.address === normalizeAddress(page?.slug);
}

/**
 * For the delete dialog: { [pageId]: links } for each page about to be
 * deleted. A link FROM a page in the same batch does not count — it is going
 * too. Pages nothing points at are absent from the answer.
 */
function linksToPages(links, pages, deletingIds) {
  const deleting = new Set((deletingIds || []).map(String));
  const out = {};
  for (const page of pages || []) {
    const id = String(page?.id ?? '');
    if (!deleting.has(id)) continue;
    const hits = links.filter((link) => !(link.source.kind === 'page' && deleting.has(link.source.id)) && pointsAt(link, page));
    if (hits.length) out[id] = hits;
  }
  return out;
}

/**
 * For the weekly check: every link whose page does not exist. A reference
 * whose id is no page in the project; a typed address no page answers.
 * `reason` says which, in words.
 */
function brokenLinks(links, pages) {
  const ids = new Set((pages || []).map((page) => String(page?.id ?? '')));
  const addresses = pagesByAddress(pages);
  const out = [];
  for (const link of links) {
    if (link.pageId !== undefined) {
      if (!ids.has(link.pageId)) out.push({ ...link, reason: `points at page ${link.pageId}, which no longer exists` });
    } else if (!addresses.has(link.address) && !NON_PAGE_ADDRESSES.has(link.address)) {
      out.push({ ...link, reason: `goes to ${link.address ? `/${link.address}` : '/'}, and no page has that address` });
    }
  }
  return out;
}

/** "Saved section "Header" › Menu › Menu item "About" › Link" — one line a person reads. */
function describeLink(link) {
  const parts = [link.where, link.module];
  if (link.item) parts.push(link.item);
  if (link.setting && link.setting !== 'Link') parts.push(link.setting);
  let text = parts.filter(Boolean).join(' › ');
  if (link.source?.kind === 'saved-section' && link.shownOn) {
    text += ` (shown on ${link.shownOn} page${link.shownOn === 1 ? '' : 's'})`;
  }
  return text;
}

module.exports = {
  LINK_SETTINGS,
  LIST_LINK_SETTINGS,
  NON_PAGE_ADDRESSES,
  normalizeAddress,
  typedAddress,
  collectProjectLinks,
  linksToPages,
  brokenLinks,
  describeLink,
};
