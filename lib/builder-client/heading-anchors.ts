import { normalizeAnchorName } from "@/lib/page-link";

/**
 * Automatic anchors for the headings inside rich text (task SC-856).
 *
 * Every `<h1>`–`<h6>` in a Text module or a blog post body gets an `id` made
 * from its words — "Junior Programs" becomes `junior-programs` — so any heading
 * can be linked to (`/programs#junior-programs`) and a Table of contents
 * (SC-863) has something to list.
 *
 * Four rules, each one a decision:
 *
 * - **Added when the page is drawn, never saved.** The stored text is not
 *   rewritten, so renaming a heading renames its anchor and nothing stored goes
 *   stale (CLAUDE.md landmine 19).
 * - **A heading that already has an id keeps it, untouched.** A builder's own
 *   name, or one an imported page kept, always wins — and its name is
 *   reserved, so no automatic id copies it.
 * - **One page, one numbering.** Each Text module is drawn on its own, so the
 *   ids are planned for the whole page at once (`planHeadingAnchors`): two
 *   "Junior Programs" headings in two modules are `junior-programs` and
 *   `junior-programs-2`, and none takes a section's anchor name (SC-852).
 * - **No words, no id.** A heading that is empty or only an emoji gets none.
 *
 * The id is the same cleaned shape a section anchor has
 * (`normalizeAnchorName`, lib/builder-client/page-link.js): lower case letters,
 * digits and single hyphens, accents folded — `"Café & Courts!"` → `cafe-courts`.
 *
 * The page shell's own ids (`siteRoot`, `builderPreviewRoot`) carry capitals,
 * which no automatic id ever does, so they cannot collide.
 *
 * Pure string work on HTML that has ALREADY been through the sanitizer, so the
 * tags are well formed; the ids added are `[a-z0-9-]` only and need no
 * escaping.
 */

/** One heading tag in sanitized HTML: level, its attributes, its inner HTML. */
const HEADING_RE = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1\s*>/gi;
const ID_ATTR_RE = /(?:^|\s)id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  ndash: "–",
  mdash: "—"
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** The words a heading's inner HTML shows a reader. */
function headingText(innerHtml: string): string {
  return decodeEntities(innerHtml.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/** The anchor a heading's words make, or "" when they make none. */
export function headingAnchorBase(text: string): string {
  return normalizeAnchorName(String(text ?? ""));
}

export type RichTextHeading = {
  /** The id the heading already carries, or "" when it has none. */
  existingId: string;
  /** The anchor its words make, or "" when they make none. */
  base: string;
};

/** Every heading in sanitized HTML, in order. */
export function listHeadings(html: string): RichTextHeading[] {
  const headings: RichTextHeading[] = [];
  for (const match of String(html || "").matchAll(HEADING_RE)) {
    const idMatch = ID_ATTR_RE.exec(match[2] || "");
    const existingId = idMatch ? (idMatch[1] ?? idMatch[2] ?? idMatch[3] ?? "").trim() : "";
    headings.push({ existingId, base: existingId ? "" : headingAnchorBase(headingText(match[3] || "")) });
  }
  return headings;
}

/**
 * Hands out ids that are unique against everything already taken:
 * `junior-programs`, then `junior-programs-2`, `junior-programs-3`.
 */
export type HeadingAnchorAllocator = {
  has: (id: string) => boolean;
  fork: () => HeadingAnchorAllocator;
  reserve: (id: string) => void;
  take: (base: string) => string;
};

export function createAnchorAllocator(taken: Iterable<string> = []): HeadingAnchorAllocator {
  const used = new Set<string>();
  for (const id of taken) if (id) used.add(id);
  return {
    has: (id: string) => used.has(id),
    /**
     * A new allocator holding every id this one has handed out or reserved,
     * leaving this one untouched. Rendering must not change the page's plan:
     * React may draw a module twice, and a second draw that found its own ids
     * already taken would number them `-2`.
     */
    fork: () => createAnchorAllocator(used),
    reserve: (id: string) => {
      if (id) used.add(id);
    },
    take(base: string): string {
      if (!base) return "";
      let id = base;
      for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
      used.add(id);
      return id;
    }
  };
}

/**
 * The ids to give one piece of rich text's headings, one entry per heading in
 * order: the id to add, or "" for a heading left as it is (it has its own id,
 * or no words).
 */
export function allocateHeadingAnchors(html: string, allocator: HeadingAnchorAllocator): string[] {
  return listHeadings(html).map((heading) => (heading.existingId ? "" : allocator.take(heading.base)));
}

/**
 * The page-wide plan: `{ key → ids }` for every piece of rich text on the
 * page, numbered in the order given (the order the page shows them). Every
 * id a heading already has, and every `reserved` id (section anchor names),
 * is taken first, so no automatic id duplicates one.
 *
 * Also returns the allocator, still holding every id the page uses, for rich
 * text that arrives after the page has drawn (a blog post's body), or whose
 * key appears twice (and so is left out of `ids`).
 */
export function planHeadingAnchors(
  entries: Array<{ key: string; html: string }>,
  reserved: Iterable<string> = []
): { ids: Map<string, string[]>; allocator: HeadingAnchorAllocator } {
  const allocator = createAnchorAllocator(reserved);
  for (const entry of entries) {
    for (const heading of listHeadings(entry.html)) allocator.reserve(heading.existingId);
  }
  const ids = new Map<string, string[]>();
  const repeated = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.key)) repeated.add(entry.key);
    ids.set(entry.key, [...(ids.get(entry.key) || []), ...allocateHeadingAnchors(entry.html, allocator)]);
  }
  // Two pieces of rich text under one key (a module pasted with its id) cannot
  // tell which plan is theirs, so neither gets one: each is numbered on its own
  // against the page's ids, rather than both drawing the first one's.
  for (const key of repeated) ids.delete(key);
  return { ids, allocator };
}

/**
 * Put the planned ids on the headings. `ids[i]` belongs to the i-th heading;
 * an empty entry, a heading past the end of the list, or a heading that has
 * an id of its own is left exactly as it was.
 */
export function applyHeadingAnchors(html: string, ids: readonly string[] | undefined): string {
  if (!html || !ids || ids.length === 0) return html;
  let index = 0;
  return html.replace(HEADING_RE, (whole, level: string, attrs: string, inner: string) => {
    const id = ids[index];
    index += 1;
    if (!id || ID_ATTR_RE.test(attrs || "")) return whole;
    return `<h${level} id="${id}"${attrs}>${inner}</h${level}>`;
  });
}

/**
 * One piece of rich text given anchors on its own, numbered against an
 * allocator that already holds the page's ids. For rich text the page-wide
 * plan could not see in advance (a blog post's body, fetched after the page).
 * The allocator IS written to — pass `plan.allocator.fork()` from a render.
 */
export function addHeadingAnchors(html: string, allocator: HeadingAnchorAllocator = createAnchorAllocator()): string {
  if (!html) return html;
  for (const heading of listHeadings(html)) allocator.reserve(heading.existingId);
  return applyHeadingAnchors(html, allocateHeadingAnchors(html, allocator));
}
