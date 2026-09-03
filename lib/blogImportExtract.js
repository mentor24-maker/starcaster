'use strict';

/**
 * Blog bulk-import: turn an orphaned published-page snapshot into blog post
 * fields (docs/BLOG_BULK_IMPORT_HANDOFF.md, ticket 86bbtuh3y).
 *
 * The source rows are Site Import's scrape of the 2018 WordPress site poured
 * whole into rich-text modules — the module HTML carries the original page's
 * nav, social strip and site title, and the "Imported: section" block carries
 * a 1x1 WordPress analytics beacon as an image module. Everything here exists
 * to hand back the ARTICLE and nothing else, and to say plainly which fields
 * the source did not have (six posts have no date, six no author — a silent
 * empty string there is the failure mode the picker exists to avoid).
 */

// Same test the builder itself ships (canonical === true && savedSectionId).
// Template chrome is decided structurally, never by section title.
const { isFrameSection } = require('./builder/template-frame');

const TRACKING_HOSTS = ['pixel.wp.com'];
const MIN_FEATURED_IMAGE_PX = 100;
const EXCERPT_MAX_CHARS = 280;

// Module types that are page furniture, not article content. The blog-*
// modules and tractor-nav leaked from a page that was mid-redesign (handoff
// §3); a carousel has no meaningful HTML serialization for a post body.
const SKIP_MODULE_TYPES = new Set([
  'tractor-nav', 'carousel', 'blog-search', 'blog-tag-cloud', 'blog-related-posts',
]);

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function decodeEntities(input) {
  return String(input || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(html) {
  return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function isTrackingUrl(url) {
  const value = String(url || '').toLowerCase();
  return TRACKING_HOSTS.some((host) => value.includes(host)) || value.includes('/g.gif');
}

/**
 * The non-template sections of a snapshot payload, flattened into one HTML
 * string. Text, code and heading modules carry their HTML in `module.text`;
 * image modules carry a URL in `settings.url`.
 */
function collectContentHtml(payload) {
  const sections = Array.isArray(payload?.layoutSections) ? payload.layoutSections : [];
  const contentSections = sections.filter((section) => !isFrameSection(section));
  const parts = [];
  for (const section of contentSections) {
    for (const mod of (Array.isArray(section.modules) ? section.modules : [])) {
      const type = String(mod?.type || '');
      if (SKIP_MODULE_TYPES.has(type)) continue;
      if (type === 'image') {
        const url = String(mod?.settings?.url || '').trim();
        if (url) parts.push(`<img src="${url}" alt="${String(mod?.settings?.alt || '')}">`);
        continue;
      }
      if (type === 'heading') {
        const level = /^h[1-6]$/.test(String(mod?.settings?.level || '')) ? mod.settings.level : 'h2';
        const text = String(mod?.text || '');
        if (text.trim()) parts.push(`<${level}>${text}</${level}>`);
        continue;
      }
      // text, code, and anything future: the HTML is module.text.
      const html = String(mod?.text || '');
      if (html.trim()) parts.push(html);
    }
  }
  return { html: parts.join('\n'), contentSectionCount: contentSections.length };
}

/**
 * "June 6, 2018" (or an ISO datetime attribute) → ISO string, or null.
 * Deliberate parse: an unrecognized value returns null so the caller records
 * "no date found" instead of new Date() minting an Invalid Date.
 */
function parseHumanDate(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  // ISO-shaped values (from <time datetime="...">) — only trust ones that
  // start with a full date; Date.parse alone accepts far too much.
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const parsed = Date.parse(text);
    if (Number.isFinite(parsed)) {
      // A bare date gets noon UTC so it renders as the same calendar day in
      // US timezones; a full timestamp is kept as-is.
      return /[T ]\d{2}:\d{2}/.test(text)
        ? new Date(parsed).toISOString()
        : `${text.slice(0, 10)}T12:00:00.000Z`;
    }
    return null;
  }
  const match = text.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!month || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T12:00:00.000Z`;
}

function firstImageAfter(html) {
  const imgRe = /<img\b[^>]*>/gi;
  let match;
  while ((match = imgRe.exec(html)) !== null) {
    const tag = match[0];
    const src = decodeEntities((tag.match(/\bsrc=["']([^"']+)["']/i) || [])[1] || '');
    if (!src || isTrackingUrl(src)) continue;
    // Only images Site Import copied into our storage: an external hotlink
    // from a 2018 scrape is a broken image waiting to happen.
    if (!/site_import/i.test(src)) continue;
    // The icon strip and the beacon declare tiny width/height; a missing
    // attribute is accepted (most content images carry none).
    const width = Number((tag.match(/\bwidth=["']?(\d+)/i) || [])[1] || NaN);
    const height = Number((tag.match(/\bheight=["']?(\d+)/i) || [])[1] || NaN);
    if (Number.isFinite(width) && width < MIN_FEATURED_IMAGE_PX) continue;
    if (Number.isFinite(height) && height < MIN_FEATURED_IMAGE_PX) continue;
    return src;
  }
  return '';
}

function firstParagraphText(html, skipText) {
  const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  const skip = String(skipText || '').trim().toLowerCase();
  let match;
  while ((match = pRe.exec(html)) !== null) {
    const text = stripTags(match[1]);
    if (text.length < 40) continue; // bylines, dates, leftover crumbs
    if (skip && text.trim().toLowerCase() === skip) continue; // a repeat of the headline
    if (text.length <= EXCERPT_MAX_CHARS) return text;
    const cut = text.slice(0, EXCERPT_MAX_CHARS);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), EXCERPT_MAX_CHARS - 40))}…`;
  }
  return '';
}

/*
 * Site furniture at the END of the scrape — the Genesis sidebar heading, the
 * archive pagination, the footer. Cutting before the <h1> removes the header
 * chrome; without this the same posts end with "Primary Sidebar · Copyright ©
 * 2026 Delray Beach Tennis Center · Powered by …", which is the same defect
 * at the other end of the article. Structural markers only, in the order they
 * appear in the markup.
 */
const TRAILING_CHROME = [
  /<h\d\b[^>]*class=["'][^"']*genesis-sidebar-title[^"']*["'][^>]*>/i,
  /<(?:nav|div)\b[^>]*class=["'][^"']*(?:archive-pagination|adjacent-entry-pagination)[^"']*["'][^>]*>/i,
  /<(?:footer|div)\b[^>]*class=["'][^"']*site-footer[^"']*["'][^>]*>/i,
];

function cutTrailingChrome(html) {
  let cut = -1;
  for (const pattern of TRAILING_CHROME) {
    const match = html.match(pattern);
    if (match && match.index >= 0 && (cut < 0 || match.index < cut)) cut = match.index;
  }
  return cut < 0 ? { html, trailingChromeRemoved: false } : { html: html.slice(0, cut), trailingChromeRemoved: true };
}

/*
 * WordPress writes the post's tags into the entry footer as
 * `<a href="/tag-foo" rel="tag">foo</a>`. That block survives the scrape and
 * sits INSIDE the article region — before the `genesis-sidebar-title` marker
 * `cutTrailingChrome` cuts at, and inside the `<p class="entry-meta">` wrapper
 * `cleanBody` deletes. So the tags must be read after the trailing cut (which
 * keeps a sidebar tag cloud out) and before the body clean (which is what
 * would otherwise throw them away).
 *
 * The rel value is matched EXACTLY: WordPress marks category links
 * `rel="category tag"`, and a looser test would file every category as a tag.
 * Categories are the `blog_categories` table's business, not this column's.
 *
 * ONE post in the Delray scrape does not carry `rel="tag"` at all
 * (`pickleball-social-mixer-…-july-4th`): its links were rewritten to
 * `rel="noopener noreferrer"`, so the only thing marking them as tags is the
 * "Tagged With:" label and the `/tag-…` href. A rel-only matcher reports that
 * post as "no tags in source", which is a visibly wrong answer sitting in the
 * picker next to its obvious tag list — so the label is a second, narrower
 * route. It is scoped to the run AFTER "Tagged With:" precisely so a nav link
 * to a tag archive elsewhere on the page cannot be mistaken for a tag.
 */
const TAG_LINK = /<a\b[^>]*\brel=["']tag["'][^>]*>([\s\S]*?)<\/a>/gi;
const TAGGED_WITH = /Tagged With:([\s\S]*?)(?:<\/p>|<\/span>|<h\d\b|$)/i;
const TAG_HREF_LINK = /<a\b[^>]*\bhref=["'][^"']*\/tag[-/][^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;

function collectInto(seen, source, pattern) {
  pattern.lastIndex = 0;
  let match = pattern.exec(source);
  while (match) {
    const name = stripTags(match[1]);
    // Same word in two cases is one tag; the first spelling in the source wins.
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    match = pattern.exec(source);
  }
}

function extractTags(html) {
  const seen = new Map();
  const source = String(html || '');
  collectInto(seen, source, TAG_LINK);
  if (seen.size === 0) {
    const taggedWith = source.match(TAGGED_WITH);
    if (taggedWith) collectInto(seen, taggedWith[1], TAG_HREF_LINK);
  }
  return [...seen.values()];
}

/** Strip the WordPress byline block and analytics beacons from a body. */
function cleanBody(html) {
  return String(html || '')
    // meta/byline wrappers (p/span only — these never nest in the scrape)
    .replace(/<(p|span)\b[^>]*class=["'][^"']*(entry-meta|posted-on|byline|entry-author|entry-date)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi, '')
    // The same block with its class stripped — one post in the Delray scrape
    // carries a bare <p>Filed Under: … Tagged With: …</p>, which the rule above
    // cannot see, and which was reading as article text at the foot of the post.
    .replace(/<p\b[^>]*>\s*(?:Filed Under:|Tagged With:)[\s\S]*?<\/p>/gi, '')
    .replace(/<time\b[^>]*>[\s\S]*?<\/time>/gi, '')
    .replace(/<img\b[^>]*src=["'][^"']*(pixel\.wp\.com|\/g\.gif)[^"']*["'][^>]*\/?>/gi, '')
    .replace(/^\s+/, '');
}

/**
 * The seven extraction steps from the handoff (§4). Every "not found" is a
 * flag, never a silent empty string.
 */
function extractPost(rawHtml) {
  const html = String(rawHtml || '');

  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const titleFound = Boolean(h1 && stripTags(h1[1]));
  const title = titleFound ? stripTags(h1[1]) : '';
  // Everything before the <h1> is site chrome — nav, social strip, site
  // title — and this one cut removes all of it (handoff §4 step 1).
  const afterTitle = h1 ? html.slice(h1.index + h1[0].length) : html;

  const timeTag = afterTitle.match(/<time\b[^>]*>([\s\S]*?)<\/time>/i);
  const datetimeAttr = (afterTitle.match(/<time\b[^>]*\bdatetime=["']([^"']+)["']/i) || [])[1] || '';
  const dateText = datetimeAttr || (timeTag ? stripTags(timeTag[1]) : '');
  const publishedAt = parseHumanDate(dateText);
  const dateFound = Boolean(publishedAt);

  const authorMatch = afterTitle.match(/<span\b[^>]*class=["'][^"']*entry-author-name[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
  const author = authorMatch ? stripTags(authorMatch[1]) : '';
  const authorFound = Boolean(author);

  const trimmed = cutTrailingChrome(titleFound ? afterTitle : html);
  // Read the tags off the trimmed HTML: cleanBody is about to delete the
  // entry-meta wrapper they live in.
  const tags = extractTags(trimmed.html);
  const body = cleanBody(trimmed.html);
  const bodyText = stripTags(body);
  const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;

  return {
    title,
    titleFound,
    publishedAt: publishedAt || null,
    dateFound,
    dateText: dateFound ? dateText : '',
    author,
    authorFound,
    tags,
    // A post the source never tagged and a post whose tags we failed to read
    // must not look the same; the picker says which (handoff §4).
    tagsFound: tags.length > 0,
    body,
    trailingChromeRemoved: trimmed.trailingChromeRemoved,
    featuredImageUrl: firstImageAfter(trimmed.html),
    excerpt: firstParagraphText(body, title),
    wordCount,
    textLength: bodyText.length,
  };
}

/**
 * One orphan snapshot row → one import candidate. `looksLikePost` is a
 * confidence rating for the picker, not a gate — Dane sees both piles and
 * ticks what he wants (handoff §5).
 */
function buildCandidate(row) {
  let payload = row?.payload;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = null; }
  }
  const { html, contentSectionCount } = collectContentHtml(payload || {});
  const extracted = extractPost(html);
  const pageName = String(payload?.name || '').trim();
  if (!extracted.titleFound && pageName) {
    // No headline in the source: fall back to the page's own name, and keep
    // titleFound false so the picker says so instead of hiding it.
    extracted.title = pageName;
  }
  return {
    pageId: String(row?.page_id ?? ''),
    slug: String(row?.slug || '').trim(),
    pageName,
    publishedSnapshotAt: row?.published_at || '',
    ...extracted,
    // A blank page or a scrap with no headline and no real body is
    // "probably not a post"; the picker shows it anyway, unticked.
    // (The shortest real posts have ~290 characters of body after the
    // chrome cut; the genuine non-posts top out under 50.)
    looksLikePost: contentSectionCount > 0 && extracted.titleFound && extracted.textLength > 150,
    contentSectionCount,
  };
}

module.exports = {
  collectContentHtml,
  extractPost,
  parseHumanDate,
  buildCandidate,
  stripTags,
  MIN_FEATURED_IMAGE_PX,
};
