'use strict';

/**
 * The ONE reader of a Substack publication's public archive (Substack Miner
 * upgrade 1/4, task 86bcuxwhy). The suggestion pass (./SubstackSuggestRun.js)
 * and the posts pass (./SubstackPostsReadRun.js) both read a writer's newest
 * posts through readArchive, so the two cannot read a post differently —
 * scripts/builder/substackPostsReadRun.test.js fails if either one builds an
 * archive address of its own.
 *
 * `<publication>/api/v1/archive?sort=new&limit=8` answers a plain request with
 * no sign-in. The field names below were read off real answers on 2026-10-29
 * (astralcodexten, noahpinion, garymarcus), not guessed. Each post carries:
 *
 *   title, subtitle         text; subtitle is often "" or "..."
 *   canonical_url           the post's own address (the custom domain when
 *                           the publication has one), e.g.
 *                           https://www.astralcodexten.com/p/links-for-october-2026
 *   slug                    the /p/<slug> part, used when canonical_url is missing
 *   post_date               ISO time, e.g. "2026-10-29T16:33:24.608Z"
 *   truncated_body_text     the opening of the body — present on paid posts
 *                           too (it is the free teaser); null on some
 *                           publications
 *   cover_image             an https image address, or null
 *   audience                "everyone", "only_subscribers" (free sign-up),
 *                           "only_paid", "founding"
 *   publishedBylines[]      { id, name, handle, photo_url, is_guest,
 *                           publicationUsers: [{ publication_id, role,
 *                           publication: { logo_url, subdomain } }] } — the
 *                           admin byline is the writer, so its photo and its
 *                           publication's logo come with the posts for free
 */

/** The newest posts read per writer. */
const POSTS_READ = 8;
const MAX_TITLE = 300;
const MAX_SUBTITLE = 300;
const MAX_EXCERPT = 500;
const PAID_AUDIENCES = new Set(['only_paid', 'founding']);

function text(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** An https address, or '' — nothing else is stored as a link or a picture. */
function httpsUrl(value) {
  const raw = text(value, 2000);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

/** Where the publication lives: its own address when it has one, else the subdomain. */
function publicationBase(c) {
  let base = `https://${c.handle}.substack.com`;
  try {
    const url = new URL(c.publicationUrl || '');
    if (url.protocol === 'https:') base = url.origin;
  } catch { /* no usable address: the subdomain it is */ }
  return base;
}

/** The archive address for a writer's newest posts. */
function archiveUrl(c, limit = POSTS_READ) {
  return `${publicationBase(c)}/api/v1/archive?sort=new&limit=${limit}`;
}

/**
 * The archive answer as stored posts, in the order Substack gave them (newest
 * first), at most POSTS_READ:
 *   { title, url, postedAt, subtitle, excerpt, coverImage, paid }
 * A post with no title, subtitle or address is dropped. A post whose date does
 * not parse keeps postedAt '' rather than being dropped, so the suggestion pass
 * still sees every title it used to.
 */
function parseArchivePosts(data, base = '') {
  const out = [];
  for (const p of Array.isArray(data) ? data : []) {
    if (!p || typeof p !== 'object') continue;
    const slug = text(p.slug, 300);
    const url = httpsUrl(p.canonical_url) || (base && slug ? httpsUrl(`${base}/p/${encodeURIComponent(slug)}`) : '');
    const title = text(p.title, MAX_TITLE);
    const subtitle = text(p.subtitle, MAX_SUBTITLE);
    if (!title && !subtitle && !url) continue;
    const posted = Date.parse(text(p.post_date, 60));
    out.push({
      title,
      url,
      postedAt: Number.isFinite(posted) ? new Date(posted).toISOString() : '',
      subtitle,
      excerpt: text(p.truncated_body_text, MAX_EXCERPT),
      coverImage: httpsUrl(p.cover_image),
      paid: PAID_AUDIENCES.has(text(p.audience, 40)),
    });
    if (out.length >= POSTS_READ) break;
  }
  return out;
}

/**
 * The writer's photo and the publication's logo, from the admin byline on the
 * newest post that has one. Guests are skipped: their photo is not the
 * writer's. Either may come back '' — the caller asks the public profile then.
 */
function imagesFromArchive(data) {
  for (const post of Array.isArray(data) ? data : []) {
    const pubId = post?.publication_id;
    for (const byline of Array.isArray(post?.publishedBylines) ? post.publishedBylines : []) {
      if (!byline || byline.is_guest) continue;
      const admin = (Array.isArray(byline.publicationUsers) ? byline.publicationUsers : [])
        .find((pu) => pu?.publication_id === pubId && pu?.role === 'admin');
      if (!admin) continue;
      return { photoUrl: httpsUrl(byline.photo_url), logoUrl: httpsUrl(admin.publication?.logo_url) };
    }
  }
  return { photoUrl: '', logoUrl: '' };
}

/**
 * Read one writer's newest posts. `fetchJson(url)` answers `{ ok, data }` or
 * `{ ok: false, reason }` (./SubstackNotesReadRun.js fetchSubstackJson); it is
 * passed in so each caller's polite spacing covers this read too.
 *
 * Answers `{ ok: true, posts, images }` or `{ ok: false, reason }`; never throws.
 */
async function readArchive(writer, fetchJson) {
  const archive = await fetchJson(archiveUrl(writer));
  if (!archive.ok) return { ok: false, reason: archive.reason || 'could not be read' };
  if (!Array.isArray(archive.data)) return { ok: false, reason: 'answered, but not with a list of posts' };
  return {
    ok: true,
    posts: parseArchivePosts(archive.data, publicationBase(writer)),
    images: imagesFromArchive(archive.data),
  };
}

module.exports = {
  readArchive,
  archiveUrl,
  parseArchivePosts,
  imagesFromArchive,
  httpsUrl,
  POSTS_READ,
  MAX_EXCERPT,
};
