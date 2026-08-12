/**
 * Which scaled-down copies exist for an image, and the `srcset` that lets the
 * browser choose between them.
 *
 * A registry rather than a lookup, for the same reason
 * `adapters/gallery-media-thumbnail.ts` is one: the page modules only ever hold
 * an image URL, never an asset id, and the data that knows about copies arrives
 * separately (the media library in admin, `GET /api/public/pages` on a live
 * site). Whoever loads that data registers it; every `<img>` can then ask.
 *
 * Nothing here invents a URL. An image with no registered copies renders
 * exactly as it did before — a `srcset` pointing at a file that was never
 * generated would show a broken image, which is far worse than a heavy one.
 */

export type ImageRendition = {
  w: number;
  h?: number;
  url: string;
  format?: string;
  role?: string;
};

export type ImageSourceSet = {
  src: string;
  srcSet: string;
  sizes: string;
};

/** What a slot is worth when the caller has not said. Full page width. */
export const DEFAULT_IMAGE_SIZES = "100vw";

const renditionsByUrl = new Map<string, ImageRendition[]>();

function cleanUrl(value: unknown): string {
  return String(value ?? "").trim();
}

export function registerImageRenditions(originalUrl: unknown, renditions: unknown): void {
  const key = cleanUrl(originalUrl);
  if (!key || !Array.isArray(renditions)) return;

  const toRendition = (item: unknown): ImageRendition | null => {
    if (!item || typeof item !== "object") return null;
    const raw = item as Record<string, unknown>;
    const w = Number(raw.w ?? raw.width ?? 0);
    const url = cleanUrl(raw.url);
    if (!Number.isFinite(w) || w <= 0 || !url) return null;
    const h = Number(raw.h ?? raw.height ?? 0);
    return {
      w,
      h: Number.isFinite(h) && h > 0 ? h : undefined,
      url,
      format: cleanUrl(raw.format).toLowerCase() || undefined,
      role: cleanUrl(raw.role).toLowerCase() || undefined
    };
  };

  const usable = renditions
    .map(toRendition)
    .filter((item): item is ImageRendition => item !== null)
    .sort((a, b) => a.w - b.w);

  if (usable.length) renditionsByUrl.set(key, usable);
  else renditionsByUrl.delete(key);
}

export function registerImageRenditionMap(map: unknown): void {
  if (!map || typeof map !== "object") return;
  for (const [url, renditions] of Object.entries(map as Record<string, unknown>)) {
    registerImageRenditions(url, renditions);
  }
}

/** Test seam. Nothing in the app clears the registry. */
export function clearImageRenditions(): void {
  renditionsByUrl.clear();
}

export function getImageRenditions(url: unknown): ImageRendition[] {
  return renditionsByUrl.get(cleanUrl(url)) ?? [];
}

/**
 * The JPEG kept at social-media width. This is the file to hand someone who is
 * about to post the picture — the platforms are still uneven about WebP uploads.
 */
export function socialImageUrl(url: unknown): string {
  const social = getImageRenditions(url).find((item) => item.role === "social");
  return social ? social.url : "";
}

/**
 * `src` / `srcSet` / `sizes` for one image, or null when there is nothing to
 * choose from and the caller should render the plain original.
 *
 * The social JPEG is deliberately left out of the srcset: it is a duplicate of
 * a width the browser can already get in WebP, and offering both would let it
 * pick the heavier file.
 *
 * `sizes` matters more than it looks. It tells the browser how wide the slot
 * will be BEFORE layout, and it assumes full page width when unset — so a
 * half-column image left at the default fetches a file twice as wide as it
 * needs. Call sites that know their column should say so.
 */
export function imageSourceSetFor(url: unknown, options: { sizes?: string } = {}): ImageSourceSet | null {
  const src = cleanUrl(url);
  if (!src) return null;

  const usable = getImageRenditions(src).filter((item) => item.role !== "social");
  if (usable.length < 2) return null;

  return {
    src,
    srcSet: usable.map((item) => `${item.url} ${item.w}w`).join(", "),
    sizes: cleanUrl(options.sizes) || DEFAULT_IMAGE_SIZES
  };
}

/**
 * Roughly how wide the page's content column gets before it stops growing.
 * Only used to turn a module's width percentage into a pixel hint, so being a
 * little out costs a slightly larger file, never a broken layout.
 */
export const CONTENT_WIDTH_PX = 1200;

/**
 * A `sizes` hint for a module that occupies `percent` of the content column.
 *
 * Below the content width the column IS the viewport, so the slot is that
 * percentage of `vw`; above it the column stops growing and the slot is a fixed
 * pixel width. Without this every image claims the full page width and the
 * browser fetches a file twice as wide as the slot — which is most of the
 * saving thrown away.
 */
export function sizesForWidthPercent(percent: unknown, contentWidthPx = CONTENT_WIDTH_PX): string {
  const raw = Number(percent);
  const clamped = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 100) : 100;
  const pixels = Math.round((contentWidthPx * clamped) / 100);
  return `(max-width: ${contentWidthPx}px) ${Math.round(clamped)}vw, ${pixels}px`;
}

/**
 * Spreadable `<img>` props. Returns just `{ src }` when the image has no
 * copies, so a call site can always spread the result and never branch.
 */
export function imageProps(url: unknown, options: { sizes?: string } = {}): {
  src: string;
  srcSet?: string;
  sizes?: string;
} {
  const resolved = imageSourceSetFor(url, options);
  if (!resolved) return { src: cleanUrl(url) };
  return { src: resolved.src, srcSet: resolved.srcSet, sizes: resolved.sizes };
}
