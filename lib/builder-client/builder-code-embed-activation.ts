/**
 * Whether a Code module's embed waits for a click before it loads, and what
 * the button over it should call the thing it is hiding.
 *
 * The shield was written for one real problem: Dexscreener-style chart
 * widgets grab focus and scroll the page to themselves the moment their
 * iframe loads. It was applied to EVERY iframe, which put a grey
 * "Load Chart" panel over the Google Map on the Delray directions page —
 * the map a visitor opened that page to look at (task 86bbugzep,
 * 2026-09-03). The shield is right; applying it to everything was not.
 *
 * "auto" is the default AND the answer for a module with nothing stored, so
 * pages built before this setting existed keep the shield exactly where it
 * was earned — on the hosts below — and lose it everywhere else.
 */

export type EmbedActivationMode = "auto" | "click" | "immediate";

export const EMBED_ACTIVATION_MODES: readonly EmbedActivationMode[] = ["auto", "click", "immediate"];

/**
 * Hosts whose widgets steal focus and scroll position on load. Under "auto"
 * these get the shield and nothing else does. Add to this list rather than
 * flipping a whole site to "click".
 */
const FOCUS_STEALING_EMBED_HOSTS: readonly string[] = [
  "dexscreener.com",
  "dextools.io",
  "birdeye.so",
  "geckoterminal.com",
  "poocoin.app",
  "tradingview.com"
];

const MAP_EMBED_HOSTS: readonly string[] = [
  "google.com/maps",
  "maps.google.",
  "openstreetmap.org",
  "mapbox.com",
  "waze.com"
];

const VIDEO_EMBED_HOSTS: readonly string[] = [
  "youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
  "vimeo.com",
  "wistia.net",
  "wistia.com",
  "loom.com",
  "dailymotion.com"
];

/**
 * Every iframe source in a snippet, including one already parked in
 * `data-deferred-src` by a previous render — otherwise a snippet re-read
 * after the shield deferred it looks like it has no iframes at all.
 */
export function embedIframeSources(html: string): string[] {
  const sources: string[] = [];
  if (!html) return sources;

  const iframes = html.match(/<iframe\b[^>]*>/gi) ?? [];
  for (const tag of iframes) {
    const match = /\s(?:data-deferred-)?src\s*=\s*(["'])([^"']*)\1/i.exec(tag);
    if (match?.[2]) sources.push(match[2]);
  }
  return sources;
}

function sourceMatchesAny(sources: string[], needles: readonly string[]): boolean {
  return sources.some((source) => {
    const value = source.toLowerCase();
    return needles.some((needle) => value.includes(needle));
  });
}

/** An unknown or missing value reads as "auto" — never as "click". */
export function normalizeEmbedActivationMode(value: unknown): EmbedActivationMode {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return EMBED_ACTIVATION_MODES.includes(text as EmbedActivationMode)
    ? (text as EmbedActivationMode)
    : "auto";
}

/** Does this snippet embed one of the widgets the shield was written for? */
export function embedLooksFocusStealing(html: string): boolean {
  return sourceMatchesAny(embedIframeSources(html), FOCUS_STEALING_EMBED_HOSTS);
}

export function embedRequiresActivation(html: string, mode: unknown): boolean {
  const resolved = normalizeEmbedActivationMode(mode);
  if (resolved === "immediate") return false;
  if (resolved === "click") return true;
  return embedLooksFocusStealing(html);
}

export type EmbedKind = "chart" | "map" | "video" | "embed";

/** What the snippet is, for the shield's label — never "chart" by default. */
export function embedKind(html: string): EmbedKind {
  const sources = embedIframeSources(html);
  if (sourceMatchesAny(sources, FOCUS_STEALING_EMBED_HOSTS)) return "chart";
  if (sourceMatchesAny(sources, MAP_EMBED_HOSTS)) return "map";
  if (sourceMatchesAny(sources, VIDEO_EMBED_HOSTS)) return "video";
  return "embed";
}

export function embedShieldLabel(html: string): string {
  const kind = embedKind(html);
  return kind === "embed" ? "Load embed" : `Load ${kind}`;
}

export function embedShieldAriaLabel(html: string): string {
  const kind = embedKind(html);
  return kind === "embed" ? "Load this embed" : `Load interactive ${kind}`;
}
