/**
 * The Tag Cloud module's rendering decisions, in one place.
 *
 * There are TWO programs that draw this module, and until 2026-09-03 they
 * disagreed about almost everything:
 *
 *   - the Builder canvas card  (components/builder/builder-module-card.tsx)
 *   - the LIVE tenant site     (BlogTagCloudPreview, in
 *                               components/builder-template-preview.tsx)
 *
 * The live site is reached by routes/publicSitePages.js -> public/site.html ->
 * builder-react-entry.tsx `mountPublicSite` -> BuilderPublicSitePage ->
 * BuilderTemplatePreview -> BlogTagCloudPreview. There is no server-side
 * renderer for this module type, so that component IS what a visitor sees.
 *
 * The canvas honoured `layout`, the count-weighted font sizes, `alignment` and
 * `inactiveColor`; the live renderer honoured none of them, and rendered every
 * tag as a `<span>` with no `href` — so the module the palette describes as
 * "Tag navigation widget … that filters posts by ?tag=slug" navigated
 * nowhere. An operator would set a layout, watch it apply on the canvas,
 * publish, and get a plain pill row.
 *
 * Two renderers reading two copies of the rules is why they drifted. They read
 * this module now, so a change lands on both or neither.
 */

export type CloudTag = { id: string; label: string; slug: string; count?: number };

export type TagCloudLayout = "cloud" | "pills" | "list";

/**
 * Where the tags come from.
 *
 * `auto` reads the tenant's real BLOG tags from `GET /api/blog/tags` — the
 * same derived list the Blog Links manager shows, already carrying a post
 * count per tag and ordered busiest first.
 *
 * It is NOT `/api/messaging/tags`. This ticket originally specified that, and
 * it is a different feature's table: Messaging Topics and Tags have nothing to
 * do with the blog. Pointing a blog widget at them is what produced
 * "No tags found. Add tags in the Messaging section." on a public tenant page
 * (operator report, 2026-09-03).
 */
export type TagCloudSource = "auto" | "manual";

/** Every setting the module offers, resolved once with its fallback applied. */
export type ResolvedTagCloud = {
  source: TagCloudSource;
  title: string;
  layout: TagCloudLayout;
  alignment: "left" | "center";
  showCounts: boolean;
  minFontSize: number;
  maxFontSize: number;
  gap: number;
  activeColor: string;
  inactiveColor: string;
  inactiveBg: string;
  filterParam: string;
  targetPageUrl: string;
};

/**
 * The fallbacks are duplicated from the module's defaults in
 * builder-template.ts on purpose: a module inserted from the palette carries
 * only `{ layout: "cloud" }`, so every other key arrives undefined and the
 * renderer is the last line of defence.
 */
const FALLBACK = {
  layout: "cloud" as TagCloudLayout,
  alignment: "left" as const,
  minFontSize: 12,
  maxFontSize: 22,
  gap: 8,
  activeColor: "#0f4f8f",
  inactiveColor: "#587592",
  inactiveBg: "#f0f4f8",
  filterParam: "tag"
};

function intSetting(raw: string | undefined, fallback: number): number {
  const parsed = parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseCloudTags(settings: Record<string, string>): CloudTag[] {
  try {
    const parsed = JSON.parse(settings.tags || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is CloudTag => x && typeof x.label === "string");
  } catch {
    return [];
  }
}

export function serializeCloudTags(tags: CloudTag[]): string {
  return JSON.stringify(tags);
}

/**
 * Which source a module is on, including the migration for pages that predate
 * the setting.
 *
 * A page saved before `tagSource` existed carries a hand-typed `tags` list and
 * no source. Defaulting those to `auto` would silently replace a curated list
 * an operator built, on a live site, with no edit — so **an existing non-empty
 * list means `manual`**. Only a module with nothing typed into it defaults to
 * `auto`, where it has nothing to lose.
 */
export function resolveTagCloudSource(settings: Record<string, string>): TagCloudSource {
  const declared = (settings.tagSource ?? "").trim();
  if (declared === "auto" || declared === "manual") return declared;
  return parseCloudTags(settings).length > 0 ? "manual" : "auto";
}

export function resolveTagCloudSettings(settings: Record<string, string>): ResolvedTagCloud {
  const layout = settings.layout as TagCloudLayout | undefined;
  return {
    source: resolveTagCloudSource(settings),
    title: (settings.title ?? "").trim(),
    layout: layout === "pills" || layout === "list" ? layout : FALLBACK.layout,
    alignment: settings.alignment === "center" ? "center" : FALLBACK.alignment,
    // `=== "true"` and not `!== "false"`. The old live renderer used the
    // second form, so a module whose setting was simply never set showed its
    // counts while the panel's checkbox read unchecked.
    showCounts: settings.showCounts === "true",
    minFontSize: intSetting(settings.minFontSize, FALLBACK.minFontSize),
    maxFontSize: intSetting(settings.maxFontSize, FALLBACK.maxFontSize),
    gap: intSetting(settings.gap, FALLBACK.gap),
    activeColor: settings.activeColor || FALLBACK.activeColor,
    inactiveColor: settings.inactiveColor || FALLBACK.inactiveColor,
    inactiveBg: settings.inactiveBg || FALLBACK.inactiveBg,
    filterParam: (settings.filterParam || "").trim() || FALLBACK.filterParam,
    targetPageUrl: (settings.targetPageUrl ?? "").trim()
  };
}

/**
 * Only the "cloud" layout is sized by count — that is the whole difference
 * between it and "pills". A single tag, or a set that all share one count,
 * sizes to the minimum rather than dividing by zero.
 */
export function tagFontSize(
  count: number | undefined,
  maxCount: number,
  resolved: Pick<ResolvedTagCloud, "layout" | "minFontSize" | "maxFontSize">
): number {
  if (resolved.layout !== "cloud") return resolved.minFontSize;
  const safeMax = maxCount > 0 ? maxCount : 1;
  const share = Math.min(Math.max((count ?? 1) / safeMax, 0), 1);
  return Math.round(resolved.minFontSize + share * (resolved.maxFontSize - resolved.minFontSize));
}

export function maxTagCount(tags: CloudTag[]): number {
  return tags.reduce((max, tag) => Math.max(max, tag.count ?? 1), 1);
}

/**
 * Where a tag links to. `targetPageUrl` empty means "filter the page the
 * visitor is already on", which is the common case for a sidebar cloud, so the
 * href is the query string alone rather than a link back to "/".
 */
export function tagHref(slug: string, resolved: Pick<ResolvedTagCloud, "filterParam" | "targetPageUrl">): string {
  const value = encodeURIComponent(String(slug ?? "").trim());
  const query = `${encodeURIComponent(resolved.filterParam)}=${value}`;
  return resolved.targetPageUrl ? `${resolved.targetPageUrl}?${query}` : `?${query}`;
}

/**
 * Which tag the visitor is currently filtered to, read off the real URL. The
 * active tag is the one styled with `activeColor` — before this, the live
 * renderer coloured EVERY tag with the active colour and the canvas coloured
 * whichever happened to be first, neither of which is the one being filtered.
 */
export function activeTagSlug(search: string, resolved: Pick<ResolvedTagCloud, "filterParam">): string {
  try {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    return (params.get(resolved.filterParam) ?? "").trim();
  } catch {
    return "";
  }
}

/**
 * A row from `GET /api/blog/tags` turned into a cloud tag.
 *
 * THE SLUG IS THE TAG WORD, deliberately and not a slugified version of it.
 * The blog listing filters with `post.tags?.includes(tagFilter)` — an exact
 * match against the word stored on the post — so `?tag=Delray Beach Open`
 * matches and `?tag=delray-beach-open` matches nothing at all. Slugifying here
 * would give every link in the cloud a filter that silently finds no posts,
 * which reads as working navigation.
 */
export function blogTagToCloudTag(row: { tag?: unknown; postCount?: unknown }): CloudTag | null {
  const label = String(row?.tag ?? "").trim();
  if (!label) return null;
  const count = Number(row?.postCount ?? 0);
  return {
    id: `blog:${label}`,
    label,
    slug: label,
    count: Number.isFinite(count) && count > 0 ? count : 1
  };
}

/** Every usable tag from an `/api/blog/tags` payload, in the order served. */
export function blogTagsToCloudTags(rows: unknown): CloudTag[] {
  if (!Array.isArray(rows)) return [];
  const out: CloudTag[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const tag = blogTagToCloudTag(row as { tag?: unknown; postCount?: unknown });
    if (!tag || seen.has(tag.id)) continue;
    seen.add(tag.id);
    out.push(tag);
  }
  return out;
}

/**
 * What the BUILDER CANVAS shows instead of an empty box while designing.
 *
 * It must never render on a live tenant page. It used to: the live renderer
 * fell back to it whenever the list was empty, so a real tenant's blog
 * advertised "react / typescript / design / tutorial" to visitors
 * (operator report, 2026-09-03). A published page with no tags renders
 * nothing at all now.
 */
export const PLACEHOLDER_TAGS: CloudTag[] = [
  { id: "p1", label: "react", slug: "react", count: 24 },
  { id: "p2", label: "typescript", slug: "typescript", count: 18 },
  { id: "p3", label: "design", slug: "design", count: 12 },
  { id: "p4", label: "tutorial", slug: "tutorial", count: 8 }
];
