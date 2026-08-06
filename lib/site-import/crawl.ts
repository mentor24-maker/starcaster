/**
 * Site Import — crawl planning: URL normalization, robots.txt, sitemaps,
 * link extraction, and the BFS queue (spec §1b "Capture procedure").
 *
 * Ports the proven ideas from lib/directAcquire.js (sitemap candidates,
 * <loc> scraping, visited-set BFS with a backlog cap) without touching it —
 * that path stays live for Acquire. Differences: all sub-sitemaps of a
 * sitemap index are fetched (directAcquire stops at the first), and
 * robots.txt is parsed and honored here (ratified decision 4).
 *
 * Everything network-shaped takes an injected `fetchText` so the whole
 * module is unit-testable offline; the worker supplies the real fetch.
 */

import * as cheerio from "cheerio";

/* ---------------------------------------------------------------------------
 * URL normalization + same-site test
 * ------------------------------------------------------------------------ */

/** Query params that identify a visitor, not a page. */
const TRACKING_PARAM_RE = /^(utm_\w+|fbclid|gclid|msclkid|mc_cid|mc_eid|ref|igshid)$/i;

/**
 * Canonical form used for crawl dedupe: absolute, fragment stripped,
 * tracking params stripped, host lowercased, default port dropped,
 * trailing slash removed (except at the root). Returns null for anything
 * that is not an http(s) URL.
 */
export function normalizeCrawlUrl(raw: string, base?: string): string | null {
  let u: URL;
  try {
    u = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  const kept = new URLSearchParams();
  for (const [key, value] of u.searchParams.entries()) {
    if (!TRACKING_PARAM_RE.test(key)) kept.append(key, value);
  }
  u.search = kept.toString() ? `?${kept.toString()}` : "";
  let path = u.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  u.pathname = path;
  return u.href;
}

/** Multi-part public suffixes common enough to matter for client sites.
 *  A full Public Suffix List is overkill for an internal tool; extend this
 *  set if an import ever mis-scopes. */
const TWO_LEVEL_TLDS = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au",
  "co.nz", "co.jp", "com.br", "com.mx", "co.za", "com.sg",
]);

export function registrableDomain(hostname: string): string {
  const parts = String(hostname || "").toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  const take = TWO_LEVEL_TLDS.has(lastTwo) ? 3 : 2;
  return parts.slice(-take).join(".");
}

/** Same registrable domain — www.example.com and blog.example.com are the
 *  same site for crawl purposes (spec: "same-registrable-domain BFS"). */
export function sameSite(urlA: string, urlB: string): boolean {
  try {
    return (
      registrableDomain(new URL(urlA).hostname) ===
      registrableDomain(new URL(urlB).hostname)
    );
  } catch {
    return false;
  }
}

const NON_HTML_EXT_RE =
  /\.(png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|json|xml|txt|pdf|zip|gz|tar|mp3|mp4|mov|webm|avi|wav|ogg|woff2?|ttf|otf|eot|doc|docx|xls|xlsx|ppt|pptx|dmg|exe)$/i;

/** Cheap filter for "worth sending a browser at" — asset URLs go to the
 *  asset pipeline, not the page queue. */
export function looksLikeHtmlUrl(url: string): boolean {
  try {
    return !NON_HTML_EXT_RE.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------------
 * robots.txt (ratified decision 4: honored by default, overridable with
 * attribution; a blocked job must NAME the blocking rule)
 * ------------------------------------------------------------------------ */

export type RobotsRule = { allow: boolean; path: string };
export type RobotsGroup = { agents: string[]; rules: RobotsRule[] };
export type RobotsFile = { groups: RobotsGroup[]; sitemaps: string[] };

export function parseRobots(txt: string): RobotsFile {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of String(txt || "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (field === "user-agent") {
      // Consecutive user-agent lines share one group.
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if ((field === "allow" || field === "disallow") && current) {
      // Empty Disallow means "allow everything" — representable as no rule.
      if (value) current.rules.push({ allow: field === "allow", path: value });
    }
  }
  return { groups, sitemaps };
}

export type RobotsVerdict = {
  allowed: boolean;
  /** The winning rule, for the "blocked by <rule>" error message. */
  rule: string | null;
};

/**
 * Google-style evaluation: pick the group whose agent token is the longest
 * substring match of our user agent (falling back to "*"), then the
 * longest-path rule wins, Allow beating Disallow on equal length.
 * Wildcard `*` inside paths and `$` anchors are supported.
 */
export function robotsVerdict(
  robots: RobotsFile,
  userAgent: string,
  path: string
): RobotsVerdict {
  const ua = String(userAgent || "").toLowerCase();
  let group: RobotsGroup | null = null;
  let bestLen = -1;
  for (const g of robots.groups) {
    for (const agent of g.agents) {
      if (agent !== "*" && ua.includes(agent) && agent.length > bestLen) {
        group = g;
        bestLen = agent.length;
      }
    }
  }
  if (!group) {
    group = robots.groups.find((g) => g.agents.includes("*")) || null;
  }
  if (!group) return { allowed: true, rule: null };

  let winner: RobotsRule | null = null;
  for (const rule of group.rules) {
    if (!robotsPathMatches(rule.path, path)) continue;
    if (
      !winner ||
      rule.path.length > winner.path.length ||
      (rule.path.length === winner.path.length && rule.allow && !winner.allow)
    ) {
      winner = rule;
    }
  }
  if (!winner) return { allowed: true, rule: null };
  return {
    allowed: winner.allow,
    rule: `${winner.allow ? "Allow" : "Disallow"}: ${winner.path}`,
  };
}

function robotsPathMatches(rulePath: string, path: string): boolean {
  // Escape regex chars, then translate robots wildcards: * → .*, $ → end.
  const anchored = rulePath.endsWith("$");
  const body = anchored ? rulePath.slice(0, -1) : rulePath;
  const pattern = body
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const re = new RegExp(`^${pattern}${anchored ? "$" : ""}`);
  return re.test(path);
}

/* ---------------------------------------------------------------------------
 * Sitemap discovery
 * ------------------------------------------------------------------------ */

export type FetchText = (url: string) => Promise<string>;

function extractLocs(xml: string): string[] {
  // Same battle-tested <loc> scrape as directAcquire — sitemaps in the
  // wild are too messy for a strict XML parser to be worth it.
  const locs: string[] = [];
  const locRegex = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = locRegex.exec(xml)) !== null) {
    const loc = m[1].trim();
    if (loc) locs.push(loc);
  }
  return locs;
}

/**
 * Page URLs from the site's sitemaps: tries robots-declared sitemaps
 * first, then /sitemap.xml and /sitemap_index.xml. Follows every
 * sub-sitemap of an index (up to `limit` collected URLs). Errors are
 * swallowed — a sitemap is a hint, never a requirement.
 */
export async function fetchSitemapUrls(
  fetchText: FetchText,
  baseUrl: string,
  opts: { limit: number; robotsSitemaps?: string[] }
): Promise<string[]> {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }
  const candidates = [
    ...(opts.robotsSitemaps || []),
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
  ];
  const seen = new Set<string>();
  for (const sitemapUrl of candidates) {
    let xml: string;
    try {
      xml = await fetchText(sitemapUrl);
    } catch {
      continue;
    }
    const pageUrls: string[] = [];
    for (const loc of extractLocs(xml)) {
      if (pageUrls.length >= opts.limit) break;
      if (/\.xml(\?|$)/i.test(loc)) {
        // Sitemap index — pull every sub-sitemap (deviation from
        // directAcquire, which stops at the first).
        if (seen.has(loc)) continue;
        seen.add(loc);
        try {
          const subXml = await fetchText(loc);
          for (const sub of extractLocs(subXml)) {
            if (pageUrls.length >= opts.limit) break;
            if (!/\.xml(\?|$)/i.test(sub) && sameSite(sub, baseUrl)) {
              pageUrls.push(sub);
            }
          }
        } catch {
          /* broken sub-sitemap — ignore */
        }
      } else if (sameSite(loc, baseUrl)) {
        pageUrls.push(loc);
      }
    }
    if (pageUrls.length) return pageUrls;
  }
  return [];
}

/* ---------------------------------------------------------------------------
 * Link extraction (feeds the BFS from each captured page)
 * ------------------------------------------------------------------------ */

export function extractLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  try {
    const $ = cheerio.load(String(html ?? ""));
    $("a[href]").each((_i, el) => {
      const href = String(($(el).attr("href") || "")).trim();
      if (!href) return;
      const normalized = normalizeCrawlUrl(href, baseUrl);
      if (normalized) out.push(normalized);
    });
  } catch {
    /* unparseable html yields no links — capture still has the page */
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * The BFS queue
 * ------------------------------------------------------------------------ */

export type CrawlQueueOptions = {
  seedUrl: string;
  maxPages: number;
  maxDepth: number;
};

export type CrawlItem = { url: string; depth: number };

/**
 * Visited-set BFS over normalized URLs, scoped to the seed's registrable
 * domain, page- and depth-capped, with a backlog cap (maxPages × 4, as in
 * directAcquire) so link-farm pages can't balloon memory. The worker
 * drives it: next() → capture → add(discovered links) → repeat.
 */
export class CrawlQueue {
  private queue: CrawlItem[] = [];
  private enqueued = new Set<string>();
  private served = 0;
  private opts: CrawlQueueOptions;
  /** True once a cap refused work — reported in coverage.caps. */
  hitPageCap = false;
  hitDepthCap = false;

  constructor(opts: CrawlQueueOptions) {
    this.opts = opts;
    const seed = normalizeCrawlUrl(opts.seedUrl);
    if (seed) this.add(seed, 0);
  }

  /** Returns true if the URL joined the queue. */
  add(url: string, depth: number): boolean {
    const normalized = normalizeCrawlUrl(url);
    if (!normalized) return false;
    if (this.enqueued.has(normalized)) return false;
    if (!sameSite(normalized, this.opts.seedUrl)) return false;
    if (!looksLikeHtmlUrl(normalized)) return false;
    if (depth > this.opts.maxDepth) {
      this.hitDepthCap = true;
      return false;
    }
    if (this.queue.length >= this.opts.maxPages * 4) return false;
    this.enqueued.add(normalized);
    this.queue.push({ url: normalized, depth });
    return true;
  }

  /** Next page to capture, or null when done (drained or page cap hit). */
  next(): CrawlItem | null {
    if (this.served >= this.opts.maxPages) {
      if (this.queue.length > 0) this.hitPageCap = true;
      return null;
    }
    const item = this.queue.shift();
    if (!item) return null;
    this.served += 1;
    return item;
  }

  get discovered(): number {
    return this.enqueued.size;
  }

  get captured(): number {
    return this.served;
  }
}
