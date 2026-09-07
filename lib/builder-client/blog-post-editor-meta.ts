/**
 * The Edit Post form's two "meta" pieces (86bbvtzt1):
 *
 *  - the post date, which the store keeps as an ISO timestamp and the form
 *    shows in a browser date picker (a day, no time), and
 *  - the link from the editor's featured-image thumbnail to the post as a
 *    reader would see it.
 *
 * Both are here rather than inline in the form so they can be tested
 * without a browser: the date conversion crosses a timezone boundary twice,
 * which is exactly where a day quietly turns into the day before.
 */

/** Two-digit, for the YYYY-MM-DD the date input wants. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * The stored timestamp as the LOCAL day it falls on, in the date input's
 * own format. Blank when there is no stamp or it does not parse.
 *
 * Local, not UTC: a post published at 10pm in Denver is stamped at 04:00Z
 * the next day, and a picker showing that UTC day would be one day off from
 * what the public post page prints (it uses toLocaleDateString).
 */
export function publishedAtToDateInput(iso: string | null | undefined): string {
  const raw = String(iso ?? "").trim();
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * What to send as `publishedAt`, given what the picker holds and what the
 * post had when it loaded.
 *
 *  - `undefined`: leave the key out of the request. The day is unchanged, so
 *    the stored stamp (and its time of day) is kept exactly as it was; on a
 *    draft with no date this also lets the store stamp "now" at publish
 *    time, which is what a blank field means.
 *  - `null`: the field was cleared — remove the date.
 *  - an ISO string: the day changed. Stamped at NOON local, so the value
 *    survives the trip through UTC and back on either side of the date line
 *    without landing on a neighbouring day.
 */
export function dateInputToPublishedAt(
  dateInput: string,
  previousIso: string | null | undefined
): string | null | undefined {
  const typed = String(dateInput ?? "").trim();
  if (typed === publishedAtToDateInput(previousIso)) return undefined;
  if (!typed) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typed);
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** The public post page's address for one post — the one link shape, used by the manager list and the editor alike. */
export function blogPostViewHref(baseUrl: string, slug: string): string {
  const base = String(baseUrl ?? "").trim();
  const s = String(slug ?? "").trim();
  if (!base || !s) return "";
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}post=${encodeURIComponent(s)}`;
}

export type BlogPostViewLink = {
  href: string;
  /** What the link says under the thumbnail. */
  label: string;
  /** The tooltip — where it goes and who can see it. */
  title: string;
  live: boolean;
};

/**
 * The thumbnail's link, or null when there is nothing to link to yet.
 *
 * A published post links to the live page. A draft links to the SAME page:
 * the post API serves a draft by slug to a signed-in user and answers
 * not-found to a visitor, so the address is a preview for the editor and a
 * dead end for everyone else — the label says so. A post that has never
 * been saved has no slug and no status, so no link: an address it does not
 * have yet would 404 and read as a broken editor.
 */
export function blogPostViewLink(
  baseUrl: string,
  saved: { slug?: string | null; status?: string | null } | null | undefined
): BlogPostViewLink | null {
  if (!saved) return null;
  const href = blogPostViewHref(baseUrl, String(saved.slug ?? ""));
  if (!href) return null;
  const live = String(saved.status ?? "").trim() === "published";
  return live
    ? {
        href,
        label: "View live post",
        title: "Opens the post as visitors see it, in a new tab.",
        live: true
      }
    : {
        href,
        label: "Preview draft",
        title: "Opens the draft as it will look once published, in a new tab. Only you can see it while signed in; a visitor gets a not-found page.",
        live: false
      };
}

/**
 * Where a site's post page lives when no module setting says. Two names are
 * in use: `/blog-post-view` is the platform default (what the Blog Manager,
 * the Post Feed and Search Results all assume) and `/blog-post` is the page
 * the blog template installs — Delray's site has ONLY the second, so every
 * link built from the default there opened a page that does not exist
 * (86bbvtzt1). In order of preference.
 */
export const POST_PAGE_SLUG_CANDIDATES = ["blog-post-view", "blog-post"] as const;

/**
 * Pick the post page from the candidates the site actually has. `exists`
 * answers "does this project have a page at this slug?"; the first yes wins.
 * `null` when none of them exist — the caller decides what to fall back on,
 * because "no post page" and "the default post page" are different facts.
 */
export async function pickPostPagePath(
  exists: (slug: string) => Promise<boolean>,
  candidates: readonly string[] = POST_PAGE_SLUG_CANDIDATES
): Promise<string | null> {
  for (const slug of candidates) {
    let found = false;
    try {
      found = await exists(slug);
    } catch {
      found = false;
    }
    if (found) return `/${slug}`;
  }
  return null;
}
