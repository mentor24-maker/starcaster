import { normalizeBuilderAssetUrl } from "./builder-asset-url";

/**
 * How big is too big for a background video, and how to say so in plain words.
 *
 * A background video autoplays the moment a visitor lands, before anything
 * else on the page can finish. A 34MB clip on phone data is several seconds of
 * a blank or poster-only section, and the operator picking it has no way to
 * know that from the file name alone — the gallery shows a name and a
 * thumbnail, never a weight.
 *
 * This ADVISES. Nothing here refuses a video, disables a control, or changes
 * what is saved: the operator knows things this code does not (a hero clip on
 * a desktop-heavy site, a client who insisted), and a warning he can overrule
 * is the shape that survives being wrong.
 *
 * Kept apart from the panel that renders it so the threshold and the wording
 * can be tested without a browser — nothing in this repo tests CSS or React
 * layout, so the part that CAN be tested should not be tangled with the part
 * that cannot.
 */

/**
 * 10MB. Not a measured cliff — there isn't one — but the number the ticket
 * names and a defensible "a visitor on a phone will notice" line. Exported so
 * the test and the panel cannot drift to two different numbers.
 */
export const BACKGROUND_VIDEO_WARN_BYTES = 10 * 1024 * 1024;

/**
 * Bytes as the operator would say them: "34 MB", "820 KB", "1.4 MB".
 *
 * Decimal units (1 MB = 1,000,000 bytes) on purpose: that is what macOS
 * Finder, every browser download panel and every "file too large" message he
 * has ever seen use, so a video Finder calls 34 MB must not read as 32 MB
 * here. The WARNING THRESHOLD above is binary (10 × 1024 × 1024) because it is
 * an internal limit nobody reads off a screen; the difference between the two
 * is under 5% and lands nowhere near a decision.
 */
export function formatFileSize(bytes: number): string {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1000) return `${Math.round(value)} bytes`;
  if (value < 1000 * 1000) return `${Math.round(value / 1000)} KB`;
  const megabytes = value / (1000 * 1000);
  // One decimal place below 10MB, none above: "1.4 MB" is useful, "34.2 MB" is
  // noise in a sentence whose whole job is "this is too big".
  return megabytes < 10 ? `${megabytes.toFixed(1)} MB` : `${Math.round(megabytes)} MB`;
}

export type BackgroundVideoSizeNotice = {
  /** "34 MB" — shown whether or not the video is oversized. */
  sizeText: string;
  /** Whether it is over the threshold. */
  isOversized: boolean;
  /** The plain-English sentence, or "" when the video is a comfortable size. */
  warning: string;
};

/**
 * What to say about a background video of `bytes` bytes.
 *
 * Returns `null` when the size is unknown — which is a real and ordinary
 * state, not an error: a video typed in as a URL by hand, or picked before
 * this session loaded the asset library, has no size to report. Saying
 * nothing is correct there. Inventing "unknown size" text would put a
 * permanent shrug in a panel that is fine.
 */
export function backgroundVideoSizeNotice(bytes: number | null | undefined): BackgroundVideoSizeNotice | null {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return null;

  const sizeText = formatFileSize(value);
  const isOversized = value > BACKGROUND_VIDEO_WARN_BYTES;

  return {
    sizeText,
    isOversized,
    warning: isOversized
      ? `This video is ${sizeText}. Visitors on phone data will wait several seconds for it. Under 10MB is a comfortable size for a background.`
      : ""
  };
}

/**
 * Path → byte size for assets this session has seen.
 *
 * The same shape as the thumbnail registry next door, and for the same reason:
 * a background setting stores a URL and nothing else, so the only place the
 * size exists is the asset list the gallery already loaded. Registering it as
 * that list arrives means the panel can still name the size when it is
 * reopened later, rather than only in the seconds after a click.
 *
 * A miss is expected and harmless — see `backgroundVideoSizeNotice`.
 *
 * BOTH ENDS NORMALIZE THE KEY, and that is the whole reason this is a function
 * rather than a bare Map. An asset's `location` and the `videoUrl` a panel
 * stores are the same file under two spellings — `gallery/clip.mp4` going in,
 * `/gallery/clip.mp4` coming back out of `normalizeBuilderAssetUrl` — so a
 * raw-string Map misses on every lookup and the feature silently does nothing
 * at all. Nothing would error; the size would simply never appear.
 */
const bytesByPath = new Map<string, number>();

function sizeKey(path: string): string {
  return normalizeBuilderAssetUrl(path).trim();
}

export function rememberAssetByteSize(path: string, bytes: number): void {
  const key = sizeKey(path);
  const value = Number(bytes);
  if (!key || !Number.isFinite(value) || value <= 0) return;
  bytesByPath.set(key, value);
}

export function recallAssetByteSize(path: string): number | null {
  const key = sizeKey(path);
  if (!key) return null;
  return bytesByPath.get(key) ?? null;
}
