'use strict';

/**
 * Substack Miner — which publication a pasted LINK belongs to, when the link
 * itself does not say (task 86bcux874).
 *
 * Dane, 2026-10-29: "I need a way to directly enter articles and account urls
 * for Substack in the Find Creators page." What he has to hand is whatever his
 * browser shows, and the store only understands name.substack.com. Three
 * shapes it got wrong:
 *
 *   www.lennysnewsletter.com/p/...        a publication on its own domain —
 *                                         refused as "not a substack.com address"
 *   substack.com/home/post/p-123          a post opened in the Substack app —
 *                                         refused as a "profile link"
 *   open.substack.com/pub/lenny/p/...     Substack's Share button — saved as a
 *                                         writer called "open"
 *
 * The share link names its publication in the path, so it needs no lookup.
 * The other two are read: redirects are followed BY HAND, and the first hop
 * onto a name.substack.com address answers it (a substack.com post redirects
 * to its publication); otherwise the page's own data block (`preloads-json`,
 * the JSON every Substack page carries) names the publication in `pub`. A page
 * with neither is not on Substack and is refused with that reason.
 *
 * Only https pages on a real domain name are fetched — never a bare IP,
 * localhost or an internal name — and nothing read is returned except the
 * publication's handle and name. Never throws.
 */

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;
// The subdomains Substack uses for itself rather than for a publication.
const SUBSTACK_OWN = new Set(['www', 'open', 'on', 'api', 'cdn', 'support', 'reader']);
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function text(value) {
  return String(value == null ? '' : value).trim();
}

/** A URL when `value` is written as a web address, else null. A bare handle is not. */
function asUrl(value) {
  const raw = text(value);
  if (!raw || /\s/.test(raw)) return null;
  if (!/^https?:\/\//i.test(raw) && !raw.includes('/') && !/\.[a-z]{2,}$/i.test(raw)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.includes('.') ? url : null;
  } catch {
    return null;
  }
}

/**
 * The publication handle an address names by itself: name.substack.com, or
 * open.substack.com/pub/name/... ('' when it names none).
 */
function handleFromAddress(url) {
  const host = url.hostname.toLowerCase();
  if (!host.endsWith('.substack.com')) return '';
  const sub = host.slice(0, -'.substack.com'.length);
  if (sub === 'open') {
    const m = url.pathname.match(/^\/pub\/([^/]+)/i);
    const handle = m ? m[1].toLowerCase() : '';
    return HANDLE_RE.test(handle) ? handle : '';
  }
  return SUBSTACK_OWN.has(sub) || !HANDLE_RE.test(sub) ? '' : sub;
}

/**
 * What a pasted line needs before the ordinary import can take it:
 *   { kind: 'share', handle }  open.substack.com/pub/<handle> — no lookup
 *   { kind: 'page', url }      a substack.com page that is not a profile, or
 *                              any other domain — read to find its publication
 *   null                       leave it to the store (a handle, a
 *                              name.substack.com address, a profile link)
 */
function linkKind(value) {
  const url = asUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'open.substack.com') {
    const handle = handleFromAddress(url);
    return handle ? { kind: 'share', handle } : { kind: 'page', url: url.href };
  }
  if (host.endsWith('.substack.com')) return null;
  if (host === 'substack.com' && /^\/@/.test(url.pathname)) return null;
  url.protocol = 'https:';
  return { kind: 'page', url: url.href };
}

/** Never fetch a bare IP address, localhost or a one-word internal name. */
function fetchable(url) {
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:') return false;
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return false;
  if (/^[\d.]+$/.test(host) || host.startsWith('[')) return false;
  return true;
}

/** The publication a Substack page's own data names, or null. */
function publicationFromHtml(html) {
  const source = String(html || '');
  const candidates = [];
  const block = source.match(/<script[^>]*id=["']preloads-json["'][^>]*>([\s\S]*?)<\/script>/i);
  if (block) candidates.push(() => JSON.parse(block[1]));
  // The older shape: window._preloads = JSON.parse("...escaped JSON...")
  const inline = source.match(/window\._preloads\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/);
  if (inline) candidates.push(() => JSON.parse(JSON.parse(inline[1])));
  for (const read of candidates) {
    try {
      const pub = read()?.pub;
      const handle = text(pub?.subdomain).toLowerCase();
      if (HANDLE_RE.test(handle)) return { handle, name: text(pub?.name) };
    } catch {
      // Not readable; try the next shape.
    }
  }
  return null;
}

/** GET one page WITHOUT following redirects. `{ ok, location?, html? }` or `{ ok: false, reason }`. */
async function fetchSubstackPage(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, reason: `could not be reached: ${err.message}` };
  }
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location');
    return location ? { ok: true, location } : { ok: false, reason: `answered HTTP ${res.status} without saying where to` };
  }
  if (!res.ok) return { ok: false, reason: `answered HTTP ${res.status}` };
  try {
    return { ok: true, html: await res.text() };
  } catch {
    return { ok: false, reason: 'answered, but not with a page it could read' };
  }
}

/**
 * Which publication the page at `href` belongs to:
 * `{ ok: true, handle, name }` or `{ ok: false, reason }`. Never throws.
 */
async function publicationForLink(href, { fetchPage = fetchSubstackPage } = {}) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return { ok: false, reason: 'it is not a web address' };
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const named = handleFromAddress(url);
    if (named) return { ok: true, handle: named, name: '' };
    if (!fetchable(url)) return { ok: false, reason: `${url.hostname} is not a public web address, so it was not read` };
    const page = await fetchPage(url.href);
    if (!page.ok) return { ok: false, reason: `the page ${page.reason}` };
    if (page.location) {
      try {
        url = new URL(page.location, url);
      } catch {
        return { ok: false, reason: 'the page redirected to an address that could not be read' };
      }
      continue;
    }
    const pub = publicationFromHtml(page.html);
    if (pub) return { ok: true, ...pub };
    return { ok: false, reason: 'that page is not on Substack, so there is no Substack writer to add' };
  }
  return { ok: false, reason: `the page redirected more than ${MAX_REDIRECTS} times, so where it ends up could not be found` };
}

module.exports = {
  linkKind,
  publicationForLink,
  publicationFromHtml,
  fetchSubstackPage,
};
