/**
 * Site Import — Phase 3: reconcile imported pages onto hand-built pages.
 *
 * Phase 2 (map.ts) turned a captured site into one Builder draft per
 * original URL. This engine answers the next question: the operator has
 * since hand-built a fresh set of pages from the NEW menu — which imported
 * page belongs to which new page, and what content moves across.
 *
 * Pure: no I/O, no database, no clock. The runner
 * (scripts/site_import_reconcile.mjs) fetches, then writes what this plans.
 *
 * THE SHAPE OF THE PROBLEM (measured on delraytennis, 2026-08-16)
 *   93 imported pages, but only ~17 of them are real site pages. The rest
 *   are WordPress tag/category/author archives and blog posts. Matching
 *   before classifying is what makes `/tag/tennis/` score a perfect 1.00
 *   against a real "Tennis" page — so this engine classifies first, using
 *   the ORIGINAL SITE'S OWN MENU as the statement of what is a real page
 *   (DOCTRINE.md §5.6, the same rule that governs crawl order).
 *
 * WHAT IT NEVER DOES
 *   - Never matches an archive or a blog post to a page. They are set
 *     aside with a reason, by class, and nothing is written for them.
 *   - Never guesses past the confidence bar. A pair below CLEAN_SCORE, or
 *     within MIN_MARGIN of the runner-up, goes to the review pile with its
 *     candidates listed — an ambiguous auto-match is worse than no match.
 *   - Never copies chrome. The old header and footer ride on every
 *     imported page; only the middle content section moves.
 */

/** A Builder page reduced to what reconciliation needs. */
export type ReconcilePage = {
  id: string;
  slug: string;
  name: string;
  sections: any[];
};

/** How an imported page is classified before any matching happens. */
export type SourceClass = 'home' | 'nav-page' | 'archive' | 'post' | 'orphan';

export type NavEntry = { label: string; path: string };

export type Candidate = { targetSlug: string; score: number; reason: MatchReason };

export type MatchReason =
  | 'decision-file'
  | 'exact-title'
  | 'exact-nav-label'
  | 'fuzzy-title'
  | 'fuzzy-nav-label'
  | 'fuzzy-slug';

export type Pairing = {
  sourceId: string;
  sourceSlug: string;
  sourcePath: string;
  sourceTitle: string;
  navLabel: string;
  targetId: string;
  targetSlug: string;
  targetName: string;
  score: number;
  margin: number;
  reason: MatchReason;
  sectionCount: number;
  moduleCount: number;
};

export type SetAside = {
  sourceId: string;
  sourceSlug: string;
  sourcePath: string;
  sourceTitle: string;
  sourceClass: SourceClass;
  reason: string;
  candidates: Candidate[];
};

/** One target page's write plan. */
export type PagePlan = {
  targetId: string;
  targetSlug: string;
  /** Index in the target's section list where imported content is inserted. */
  insertAt: number;
  /** Section ids on the target that this plan removes (the placeholder). */
  removesSectionIds: string[];
  /** Fully-formed sections to insert, ids already rewritten. */
  sections: any[];
  /** sha256 inputs — the runner hashes these for the clobber guard. */
  sectionIds: string[];
  fromSourceSlug: string;
};

export type ReconcileReport = {
  sources: {
    total: number;
    paired: number;
    setAside: number;
    byClass: Record<SourceClass, number>;
  };
  targets: {
    total: number;
    eligible: number;
    filled: number;
    leftEmpty: string[];
  };
  chromeSignatures: { signature: string; pageCount: number }[];
  collisions: { targetSlug: string; sourceSlugs: string[] }[];
  boilerplateStripped: number;
  /** The shared page-title suffix that was detected and discounted. */
  siteSuffix: string;
  /** Shared head/tail furniture found inside the prose, by variant length. */
  commonAffixes: { prefixLengths: number[]; suffixLengths: number[] };
};

export type ReconcileOutput = {
  pairings: Pairing[];
  setAside: SetAside[];
  plans: PagePlan[];
  report: ReconcileReport;
};

export type ReconcileOptions = {
  sources: ReconcilePage[];
  targets: ReconcilePage[];
  /** builderPageId -> original captured path, from checkpoints.map.pageIds. */
  sourcePaths: Record<string, string>;
  /** The ORIGINAL site's header menu — the statement of what is a real page. */
  navEntries: NavEntry[];
  /** Paths linked from the blog and archive listings — i.e. blog posts. */
  postPaths?: string[];
  /**
   * Operator overrides, keyed by source slug:
   *   "<target-slug>" pair it there regardless of score
   *   null / ""       set it aside deliberately
   */
  decisions?: Record<string, string | null>;
  /** Strip the WordPress site-title/description block that leads each section. */
  stripBoilerplate?: boolean;
  /** Keep the target's PLACEHOLDER SECTION instead of replacing it. */
  keepPlaceholder?: boolean;
};

/** A pair must clear this to apply without review. */
export const CLEAN_SCORE = 0.6;
/** ...and must beat the runner-up by this much, or it is ambiguous. */
export const MIN_MARGIN = 0.15;
/** A section signature on this share of imported pages is site chrome. */
export const CHROME_SHARE = 0.5;

/** A shared run must be at least this long to count as furniture. */
export const MIN_AFFIX_LENGTH = 80;
/**
 * A run cut short by the 10,000-character module cap may end well before
 * that. Matching it is safe at a lower bar because it is checked against a
 * footer already proven to repeat, rather than discovered from scratch.
 */
export const MIN_TRUNCATED_AFFIX_LENGTH = 40;

/** Targets carry this section until real content replaces it. */
export const PLACEHOLDER_TITLE = 'PLACEHOLDER SECTION';

/**
 * The two vocabularies genuinely differ on these words. The old site used
 * /course/ for the tennis centre itself, so "course" and "court" name the
 * same thing across the two sets; the rest are plural/singular drift.
 */
const SYNONYMS: Record<string, string> = {
  course: 'court',
  instructional: 'instruct',
  racquet: 'racket',
};

/**
 * Plural drift is the single commonest reason a real pair misses — "Job
 * Opportunity" against "Job Opportunities" scores 0.33 and lands in review
 * for no good reason. A stemmer handles the whole class, where a synonym
 * table only ever handles the cases someone already noticed.
 *
 * Deliberately conservative: "tennis" must not become "tenni", so anything
 * ending -ss, -us or -is is left alone, as is any word too short to be a
 * safe plural.
 */
export function stem(word: string): string {
  if (word.length <= 3) return word;
  if (/(ss|us|is)$/.test(word)) return word;
  if (/[^aeiou]ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ch|sh|s|x|z)es$/.test(word)) return word.slice(0, -2);
  if (/[^s]s$/.test(word)) return word.slice(0, -1);
  return word;
}

const STOPWORDS = new Set(['and', 'the', 'of', 'a', 'an', 'our', 'us', 'to', 'for', 'info', 'at', 'in']);

/**
 * Every captured <title> ends in the site's own name ("Court Fees - Delray
 * Beach Tennis Center"). Left in place those shared words dominate the token
 * set and drag every real match down — "Court Fees" against "Court Fees"
 * scores 0.33 rather than 1.00. Detect the suffix the same way chrome is
 * detected: it is whatever repeats. Nothing is hardcoded, so a different
 * site's import gets its own answer.
 */
export function detectSiteSuffix(sources: ReconcilePage[]): string {
  const tally = new Map<string, { count: number; text: string }>();
  for (const page of sources) {
    const parts = String(page.name || '').split(/\s+[-–—|]\s+/);
    if (parts.length < 2) continue;
    const last = parts[parts.length - 1].trim();
    if (!last) continue;
    const key = simplify(last);
    const entry = tally.get(key) || { count: 0, text: last };
    entry.count += 1;
    tally.set(key, entry);
  }
  let best = { count: 0, text: '' };
  tally.forEach((entry) => {
    if (entry.count > best.count) best = entry;
  });
  return best.count >= Math.max(2, Math.ceil(sources.length * CHROME_SHARE)) ? best.text : '';
}

/** Strip a trailing " - Site Name" that every captured <title> carries. */
export function stripSiteSuffix(title: string, siteName: string): string {
  const raw = String(title || '').trim();
  if (!siteName) return raw;
  const norm = simplify(siteName);
  const parts = raw.split(/\s+[-–—|]\s+/);
  while (parts.length > 1 && simplify(parts[parts.length - 1]) === norm) parts.pop();
  return parts.join(' - ').trim();
}

function simplify(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(value: string): string[] {
  return simplify(value)
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t))
    .map((t) => stem(SYNONYMS[t] || t));
}

/** Order-independent set key, so "Junior Programs" === "programs-junior". */
export function canonicalKey(value: string): string {
  return Array.from(new Set(tokenize(value))).sort().join(' ');
}

export function similarity(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  A.forEach((t) => {
    if (B.has(t)) shared += 1;
  });
  return shared / (A.size + B.size - shared);
}

/** Normalize a captured URL or path down to a comparable path. */
export function toPath(hrefOrPath: string): string {
  let value = String(hrefOrPath || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) {
    const afterHost = value.replace(/^https?:\/\/[^/]*/i, '');
    value = afterHost || '/';
  }
  value = value.split('#')[0].split('?')[0];
  if (!value.startsWith('/')) value = `/${value}`;
  value = value.replace(/\/+/g, '/');
  if (value.length > 1) value = value.replace(/\/+$/, '');
  return value.toLowerCase() || '/';
}

/**
 * Classify by the ORIGINAL path, not the Builder slug — the slug has already
 * been flattened (`/tag/tennis/` → `tag-tennis`) and a real page could
 * legitimately be called "tag-team". The path is what the site actually said.
 */
export function classifySource(
  sourcePath: string,
  navPaths: Set<string>,
  postPaths: Set<string> = new Set()
): SourceClass {
  const path = toPath(sourcePath);
  if (path === '/') return 'home';
  if (!path) return 'orphan';
  if (navPaths.has(path)) return 'nav-page';
  if (/^\/(tag|category|author)\//.test(path)) return 'archive';
  // WordPress serves posts from the site root (`/some-post-title/`), so depth
  // cannot separate a post from a real page the menu forgot. What can: the
  // blog and the archive listings link to every post and to nothing else.
  if (postPaths.has(path)) return 'post';
  return 'orphan';
}

function sectionSignature(section: any): string {
  const title = String(section?.title || '');
  const types = (section?.modules || []).map((m: any) => String(m?.type || '')).join('+');
  const lead = String((section?.modules || [])[0]?.text || '').slice(0, 120);
  return `${title}|${types}|${lead}`;
}

/**
 * Chrome is whatever repeats across the imported set. Deriving it from the
 * data rather than hardcoding "section 0 and section 2" means a differently
 * shaped import does not silently copy its header onto every page.
 */
export function detectChromeSignatures(
  sources: ReconcilePage[],
  share = CHROME_SHARE
): { signatures: Set<string>; listed: { signature: string; pageCount: number }[] } {
  const pagesBySignature = new Map<string, Set<string>>();
  for (const page of sources) {
    for (const section of page.sections || []) {
      const sig = sectionSignature(section);
      if (!pagesBySignature.has(sig)) pagesBySignature.set(sig, new Set());
      pagesBySignature.get(sig)!.add(page.id);
    }
  }
  const threshold = Math.max(2, Math.ceil(sources.length * share));
  const signatures = new Set<string>();
  const listed: { signature: string; pageCount: number }[] = [];
  pagesBySignature.forEach((pages, sig) => {
    if (pages.size >= threshold) {
      signatures.add(sig);
      listed.push({ signature: sig.slice(0, 160), pageCount: pages.size });
    }
  });
  listed.sort((a, b) => b.pageCount - a.pageCount);
  return { signatures, listed };
}

/** The imported nav instance is chrome by construction, whatever it contains. */
function isNavInstance(section: any): boolean {
  return String(section?.id || '').startsWith('impnavinst_');
}

export function isChromeSection(section: any, chrome: Set<string>): boolean {
  return isNavInstance(section) || chrome.has(sectionSignature(section));
}

/**
 * Every captured section leads with the WordPress site title, description and
 * social icons — the theme's header block, which the DOM put inside the
 * content column. It is chrome that survived section-level detection because
 * it lives in the same module as real prose.
 */
export function stripSiteBoilerplate(html: string): { html: string; stripped: boolean } {
  const raw = String(html || '');
  const match = raw.match(/^\s*<p class="site-title">[\s\S]*?<\/p>\s*(?:<p class="site-description">[\s\S]*?<\/p>\s*)?/i);
  if (!match) return { html: raw, stripped: false };
  let rest = raw.slice(match[0].length);
  // The social-icon anchors that follow the description are part of the block.
  const icons = rest.match(/^\s*(?:<a[^>]*>\s*<img[^>]*>\s*<\/a>\s*)+/i);
  if (icons) rest = rest.slice(icons[0].length);
  return { html: rest.trim(), stripped: true };
}

/** The shared head and tail carried by every captured content module. */
export type CommonAffixes = { prefixes: string[]; suffixes: string[] };

/**
 * Section-level chrome detection is not enough. The capture flattens each
 * page into one text module, so the old site's header block (title, social
 * icons, phone, address) and its footer (sidebar heading, copyright, "powered
 * by") sit INSIDE the same module as the real prose. Stripping them by
 * pattern would mean hardcoding one WordPress theme's class names.
 *
 * The same principle that finds chrome sections finds these: chrome is what
 * repeats. Whatever every content module starts with, and whatever they all
 * end with, is the page furniture; what differs is the page.
 *
 * Cut points are pulled back to a tag boundary so a strip can never leave a
 * half-open element behind, and a short common run is ignored — a handful of
 * shared characters is coincidence, not a header.
 */
/**
 * Every run of shared text that more than a stray page carries, longest first.
 *
 * Two earlier shapes of this were wrong, and both failures are worth keeping
 * in mind. Requiring the run to be shared by ALL texts collapses it to
 * nothing: Phase 2 rewrote some internal links, so the header block exists in
 * two forms that diverge 32 characters in — one links home as `/`, the other
 * as `/imported-home`. Taking a single majority run then strips one form and
 * silently leaves the furniture on every page carrying the other — and
 * because those forms are DIFFERENT LENGTHS, a single shared cut-off length
 * cannot describe them both.
 *
 * So: cluster the texts by how they begin (or end), then measure each
 * cluster's own shared run. Each variant gets the length that fits it.
 */
function clusteredAffixes(
  texts: string[],
  minLength: number,
  fromEnd: boolean
): string[] {
  const usable = texts.filter((t) => typeof t === 'string' && t.length > minLength);
  if (usable.length < 2) return [];
  const edge = (text: string, length: number) =>
    fromEnd ? text.slice(Math.max(0, text.length - length)) : text.slice(0, length);

  // Cluster on a short window — long enough to separate genuinely different
  // furniture, short enough that one rewritten link does not fragment it.
  const clusters = new Map<string, string[]>();
  for (const text of usable) {
    const key = edge(text, minLength);
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key)!.push(text);
  }

  const floor = Math.max(2, Math.ceil(usable.length * 0.05));
  const out: string[] = [];
  clusters.forEach((members) => {
    if (members.length < floor) return;
    // The run every member of this cluster shares, exactly.
    let run = members[0];
    for (const text of members.slice(1)) {
      let i = 0;
      while (
        i < run.length && i < text.length &&
        (fromEnd
          ? run[run.length - 1 - i] === text[text.length - 1 - i]
          : run[i] === text[i])
      ) i += 1;
      run = fromEnd ? run.slice(run.length - i) : run.slice(0, i);
      if (!run) return;
    }

    // Cut on an ELEMENT boundary, not merely a '>'. Ending a prefix just after
    // an opening tag would hand the page `Court Fees</h1>` — a stray closing
    // tag and unbalanced markup — so a prefix ends at the last CLOSING tag and
    // a suffix starts at the first OPENING tag.
    let trimmed = run;
    if (fromEnd) {
      const open = trimmed.search(/<[a-zA-Z]/);
      if (open === -1) return;
      // Bare text ahead of that tag is still shared furniture, and taking
      // plain text cannot unbalance markup — so it comes too.
      const lead = trimmed.slice(0, open);
      const lastGt = lead.lastIndexOf('>');
      // Text after the last '>' is plain content; text before it belongs to
      // markup we are not keeping. With no '>' at all, a stray '<' means the
      // run starts mid-tag, so take nothing.
      const candidate = lastGt === -1 ? lead : lead.slice(lastGt + 1);
      const bare = candidate.includes('<') ? '' : candidate;
      trimmed = bare + trimmed.slice(open);
    } else {
      const closes = [...trimmed.matchAll(/<\/[a-zA-Z][^>]*>/g)];
      const last = closes[closes.length - 1];
      if (!last) return;
      const cut = last.index + last[0].length;
      // ...and the same on this end: the old theme leaves a bare "PrevNext"
      // between the header block and the page's own heading.
      const tail = run.slice(cut);
      const nextTag = tail.indexOf('<');
      const bare = nextTag === -1 ? tail : tail.slice(0, nextTag);
      trimmed = run.slice(0, cut) + (/[<>]/.test(bare) ? '' : bare);
    }
    if (trimmed.length >= minLength) out.push(trimmed);
  });
  // Longest first, so the most complete match wins when variants nest.
  return out.sort((a, b) => b.length - a.length);
}

export function commonPrefix(texts: string[], minLength = MIN_AFFIX_LENGTH): string[] {
  return clusteredAffixes(texts, minLength, false);
}

export function commonSuffix(texts: string[], minLength = MIN_AFFIX_LENGTH): string[] {
  return clusteredAffixes(texts, minLength, true);
}

/**
 * The furniture is not spread evenly through a section: the header block
 * lands in whichever text module comes FIRST and the copyright in the LAST.
 * Comparing every module against every other collapses the common run to
 * nothing, so each end is measured against its own kind.
 */
export function detectCommonAffixes(
  firstTexts: string[],
  lastTexts: string[],
  minLength = MIN_AFFIX_LENGTH
): CommonAffixes {
  return {
    prefixes: commonPrefix(firstTexts, minLength),
    suffixes: commonSuffix(lastTexts, minLength),
  };
}

export function stripAffixes(html: string, affixes: CommonAffixes): { html: string; stripped: boolean } {
  let out = String(html || '');
  let stripped = false;
  for (const prefix of affixes.prefixes) {
    if (prefix && out.startsWith(prefix)) {
      out = out.slice(prefix.length);
      stripped = true;
      break;
    }
  }
  for (const suffix of affixes.suffixes) {
    if (!suffix) continue;
    if (out.endsWith(suffix)) {
      out = out.slice(0, out.length - suffix.length);
      stripped = true;
      break;
    }
    // The footer is often cut short: `module.text` caps at 10,000 characters,
    // so the last module ends part-way through it ("…Powered by"). What
    // remains is a PREFIX of the known footer sitting at the end of the text.
    const limit = Math.min(suffix.length, out.length);
    let matched = 0;
    for (let k = limit; k >= MIN_TRUNCATED_AFFIX_LENGTH; k -= 1) {
      if (out.endsWith(suffix.slice(0, k))) { matched = k; break; }
    }
    if (matched) {
      out = out.slice(0, out.length - matched);
      stripped = true;
      break;
    }
  }
  return { html: out.trim(), stripped };
}

/** Deterministic so that a re-run rewrites the same ids instead of duplicating. */
function reconciledSectionId(sourceSectionId: string): string {
  return `recs_${String(sourceSectionId || '').replace(/[^a-zA-Z0-9]/g, '')}`.slice(0, 120);
}

function reconciledModuleId(sourceModuleId: string, index: number): string {
  const base = String(sourceModuleId || '').replace(/[^a-zA-Z0-9]/g, '');
  return `recm_${base || `i${index}`}`.slice(0, 120);
}

/**
 * Copy a source section into a target-ready section: new ids, provenance
 * recorded, and any canonical/saved-section linkage severed. Carrying
 * `savedSectionId` across would enrol the copy in canonical propagation and
 * fan a later edit out across the whole tenant (the 2026-07-21 menu loss).
 */
export function adoptSection(
  section: any,
  sourceSlug: string,
  sourcePath: string,
  stripBoilerplate: boolean,
  affixes: CommonAffixes = { prefixes: [], suffixes: [] }
): { section: any; stripped: number } {
  const next: any = { ...section };
  delete next.savedSectionId;
  delete next.canonical;
  delete next.locked;
  next.id = reconciledSectionId(section?.id || sourceSlug);

  let stripped = 0;
  const textIndexes = (section?.modules || [])
    .map((m: any, i: number) => (m?.type === 'text' && typeof m.text === 'string' ? i : -1))
    .filter((i: number) => i !== -1);
  const firstTextIndex = textIndexes[0];
  const lastTextIndex = textIndexes[textIndexes.length - 1];

  next.modules = (section?.modules || []).map((module: any, index: number) => {
    const copy: any = { ...module };
    copy.id = reconciledModuleId(module?.id, index);
    delete copy.savedModuleId;
    delete copy.canonicalLocked;
    if (stripBoilerplate && copy.type === 'text' && typeof copy.text === 'string') {
      // Shared head/tail first — it is the whole furniture block. The
      // site-title pattern then catches any page the affix scan could not
      // cover (a lone page, or one whose header differs slightly).
      const trimmed = stripAffixes(copy.text, {
        prefixes: index === firstTextIndex ? affixes.prefixes : [],
        suffixes: index === lastTextIndex ? affixes.suffixes : [],
      });
      const result = stripSiteBoilerplate(trimmed.html);
      if (trimmed.stripped || result.stripped) stripped += 1;
      copy.text = result.html;
    }
    copy.settings = {
      ...(module?.settings && typeof module.settings === 'object' ? module.settings : {}),
      reconciledFromPath: sourcePath,
      reconciledFromSlug: sourceSlug,
    };
    return copy;
  });
  // A module left with nothing after the boilerplate strip is dropped, not
  // shipped as an empty text block.
  next.modules = next.modules.filter(
    (m: any) => !(m.type === 'text' && typeof m.text === 'string' && !m.text.trim())
  );
  return { section: next, stripped };
}

export function contentSections(page: ReconcilePage, chrome: Set<string>): any[] {
  return (page.sections || []).filter((section) => !isChromeSection(section, chrome));
}

/** A target can receive content only if it still has its placeholder. */
export function placeholderIndex(target: ReconcilePage): number {
  return (target.sections || []).findIndex(
    (section) => String(section?.title || '').trim().toUpperCase() === PLACEHOLDER_TITLE
  );
}

function scoreAgainstTarget(
  source: { title: string; slug: string; navLabel: string },
  target: ReconcilePage
): Candidate {
  const title = source.title;
  const navLabel = source.navLabel;

  if (navLabel && canonicalKey(navLabel) === canonicalKey(target.name)) {
    return { targetSlug: target.slug, score: 1, reason: 'exact-nav-label' };
  }
  if (title && canonicalKey(title) === canonicalKey(target.name)) {
    return { targetSlug: target.slug, score: 1, reason: 'exact-title' };
  }
  if (navLabel && canonicalKey(navLabel) === canonicalKey(target.slug)) {
    return { targetSlug: target.slug, score: 1, reason: 'exact-nav-label' };
  }
  if (title && canonicalKey(title) === canonicalKey(target.slug)) {
    return { targetSlug: target.slug, score: 1, reason: 'exact-title' };
  }

  const byNav = Math.max(similarity(navLabel, target.name), similarity(navLabel, target.slug));
  const byTitle = Math.max(similarity(title, target.name), similarity(title, target.slug));
  const bySlug = similarity(source.slug, target.slug) * 0.9;
  const best = Math.max(byNav, byTitle, bySlug);
  const reason: MatchReason = best === byNav ? 'fuzzy-nav-label' : best === byTitle ? 'fuzzy-title' : 'fuzzy-slug';
  return { targetSlug: target.slug, score: best, reason };
}

export function reconcile(options: ReconcileOptions): ReconcileOutput {
  const {
    sources,
    targets,
    sourcePaths,
    navEntries,
    postPaths = [],
    decisions = {},
    stripBoilerplate = true,
    keepPlaceholder = false,
  } = options;

  const navPaths = new Set(navEntries.map((entry) => toPath(entry.path)));
  // A page in both sets is a real menu page: the menu wins.
  const postPathSet = new Set(postPaths.map(toPath));
  const navLabelByPath = new Map<string, string>();
  for (const entry of navEntries) {
    const path = toPath(entry.path);
    // First label wins: a parent item and its first child often share a URL,
    // and the parent is the one the operator named the section after.
    if (!navLabelByPath.has(path)) navLabelByPath.set(path, entry.label);
  }

  const { signatures: chrome, listed: chromeListed } = detectChromeSignatures(sources);
  const siteSuffix = detectSiteSuffix(sources);
  // Computed over every source's content prose, so the shared furniture is
  // found even for the pages this run will not end up pairing.
  // Classify before measuring furniture. The home page is both an imported
  // page and the one the operator has since rebuilt by hand, so its dozens of
  // new sections would otherwise outvote the real captured furniture and drag
  // the shared prefix down from the whole header block to a few characters.
  const classOf = new Map<string, SourceClass>();
  for (const page of sources) {
    classOf.set(page.id, classifySource(toPath(sourcePaths[page.id] || ''), navPaths, postPathSet));
  }

  const firstTexts: string[] = [];
  const lastTexts: string[] = [];
  for (const page of sources) {
    if (classOf.get(page.id) === 'home') continue;
    for (const section of contentSections(page, chrome)) {
      const texts = (section.modules || [])
        .filter((m: any) => m?.type === 'text' && typeof m.text === 'string')
        .map((m: any) => m.text as string);
      if (!texts.length) continue;
      firstTexts.push(texts[0]);
      lastTexts.push(texts[texts.length - 1]);
    }
  }
  const affixes = stripBoilerplate
    ? detectCommonAffixes(firstTexts, lastTexts)
    : { prefixes: [], suffixes: [] };

  const eligibleTargets = targets.filter((target) => placeholderIndex(target) !== -1);
  const targetBySlug = new Map(targets.map((t) => [t.slug, t]));
  // Hand-built pages can carry the same suffix (a page duplicated from an
  // imported one keeps its <title>), so both sides are stripped before scoring.
  const scoringTargets = eligibleTargets.map((t) => ({ ...t, name: stripSiteSuffix(t.name, siteSuffix) }));

  const pairings: Pairing[] = [];
  const setAside: SetAside[] = [];
  const byClass: Record<SourceClass, number> = { home: 0, 'nav-page': 0, archive: 0, post: 0, orphan: 0 };
  let boilerplateStripped = 0;

  for (const source of sources) {
    const sourcePath = toPath(sourcePaths[source.id] || '');
    const sourceClass = classOf.get(source.id) as SourceClass;
    byClass[sourceClass] += 1;

    const sourceTitle = stripSiteSuffix(source.name, siteSuffix);
    const navLabel = navLabelByPath.get(sourcePath) || '';
    const sections = contentSections(source, chrome);
    const moduleCount = sections.reduce((n, s) => n + (s.modules || []).length, 0);

    const base = {
      sourceId: source.id,
      sourceSlug: source.slug,
      sourcePath,
      sourceTitle,
      sourceClass,
    };

    const decided = Object.prototype.hasOwnProperty.call(decisions, source.slug)
      ? decisions[source.slug]
      : undefined;

    // An explicit decision outranks every score, in both directions.
    if (decided !== undefined) {
      if (!decided) {
        setAside.push({ ...base, reason: 'set aside by decision file', candidates: [] });
        continue;
      }
      const target = targetBySlug.get(decided);
      if (!target) {
        setAside.push({
          ...base,
          reason: `decision file names "${decided}", which is not a page in this project`,
          candidates: [],
        });
        continue;
      }
      if (placeholderIndex(target) === -1 && !keepPlaceholder) {
        setAside.push({
          ...base,
          reason: `decision file names "${decided}", which has no ${PLACEHOLDER_TITLE} to fill`,
          candidates: [],
        });
        continue;
      }
      pairings.push({
        ...base,
        navLabel,
        targetId: target.id,
        targetSlug: target.slug,
        targetName: target.name,
        score: 1,
        margin: 1,
        reason: 'decision-file',
        sectionCount: sections.length,
        moduleCount,
      });
      continue;
    }

    if (sourceClass !== 'nav-page') {
      const reasonByClass: Record<SourceClass, string> = {
        home: 'home page — the new home is already built by hand',
        'nav-page': '',
        archive: 'WordPress archive listing, not a content page',
        post: 'blog post — belongs to the blog, not a menu page',
        orphan: 'not linked from the original site menu',
      };
      setAside.push({
        ...base,
        reason: reasonByClass[sourceClass],
        candidates: rankCandidates({ title: sourceTitle, slug: source.slug, navLabel }, scoringTargets, 3),
      });
      continue;
    }

    if (!sections.length) {
      setAside.push({ ...base, reason: 'nothing but chrome — no content section to copy', candidates: [] });
      continue;
    }

    const ranked = rankCandidates({ title: sourceTitle, slug: source.slug, navLabel }, scoringTargets, 5);
    const best = ranked[0];
    const margin = best ? best.score - (ranked[1]?.score || 0) : 0;

    if (!best || best.score < CLEAN_SCORE || margin < MIN_MARGIN) {
      setAside.push({
        ...base,
        reason: !best
          ? 'no page to match against'
          : best.score < CLEAN_SCORE
            ? `best match scored ${best.score.toFixed(2)}, below the ${CLEAN_SCORE} bar`
            : `too close to call — "${best.targetSlug}" beat "${ranked[1].targetSlug}" by only ${margin.toFixed(2)}`,
        candidates: ranked.slice(0, 3),
      });
      continue;
    }

    const target = targetBySlug.get(best.targetSlug)!;
    pairings.push({
      ...base,
      navLabel,
      targetId: target.id,
      targetSlug: target.slug,
      targetName: target.name,
      score: best.score,
      margin,
      reason: best.reason,
      sectionCount: sections.length,
      moduleCount,
    });
  }

  // Two imported pages landing on one target is a real outcome (an old site
  // often split what the new menu merges). Both are kept, in path order, so
  // the operator sees the whole picture rather than a silent first-wins.
  const plansByTarget = new Map<string, PagePlan>();
  const orderedPairings = [...pairings].sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));

  for (const pairing of orderedPairings) {
    const source = sources.find((s) => s.id === pairing.sourceId)!;
    const target = targets.find((t) => t.id === pairing.targetId)!;
    const adopted: any[] = [];
    for (const section of contentSections(source, chrome)) {
      const result = adoptSection(section, pairing.sourceSlug, pairing.sourcePath, stripBoilerplate, affixes);
      boilerplateStripped += result.stripped;
      if ((result.section.modules || []).length) adopted.push(result.section);
    }
    if (!adopted.length) continue;

    const existing = plansByTarget.get(pairing.targetId);
    if (existing) {
      existing.sections.push(...adopted);
      existing.sectionIds.push(...adopted.map((s) => s.id));
      existing.fromSourceSlug += `, ${pairing.sourceSlug}`;
      continue;
    }

    const placeholderAt = placeholderIndex(target);
    const insertAt = placeholderAt === -1 ? (target.sections || []).length : placeholderAt;
    const placeholder = placeholderAt === -1 ? null : target.sections[placeholderAt];
    plansByTarget.set(pairing.targetId, {
      targetId: pairing.targetId,
      targetSlug: pairing.targetSlug,
      insertAt,
      removesSectionIds: placeholder && !keepPlaceholder ? [String(placeholder.id)] : [],
      sections: adopted,
      sectionIds: adopted.map((s) => s.id),
      fromSourceSlug: pairing.sourceSlug,
    });
  }

  const plans = Array.from(plansByTarget.values());
  const filledSlugs = new Set(plans.map((p) => p.targetSlug));

  const collisionMap = new Map<string, string[]>();
  for (const pairing of orderedPairings) {
    if (!collisionMap.has(pairing.targetSlug)) collisionMap.set(pairing.targetSlug, []);
    collisionMap.get(pairing.targetSlug)!.push(pairing.sourceSlug);
  }
  const collisions = Array.from(collisionMap.entries())
    .filter(([, slugs]) => slugs.length > 1)
    .map(([targetSlug, sourceSlugs]) => ({ targetSlug, sourceSlugs }));

  const report: ReconcileReport = {
    sources: {
      total: sources.length,
      paired: pairings.length,
      setAside: setAside.length,
      byClass,
    },
    targets: {
      total: targets.length,
      eligible: eligibleTargets.length,
      filled: filledSlugs.size,
      leftEmpty: eligibleTargets.filter((t) => !filledSlugs.has(t.slug)).map((t) => t.slug).sort(),
    },
    chromeSignatures: chromeListed,
    collisions,
    boilerplateStripped,
    siteSuffix,
    commonAffixes: {
      prefixLengths: affixes.prefixes.map((p) => p.length),
      suffixLengths: affixes.suffixes.map((p) => p.length),
    },
  };

  return { pairings, setAside, plans, report };
}

/**
 * Every imported page must be accounted for exactly once. A dry run whose
 * numbers do not add up must refuse to apply — the same rule Phase 2 uses,
 * for the same reason: a page that quietly falls out of both lists is
 * indistinguishable from one that was never there.
 */
export function reportReconciles(report: ReconcileReport): boolean {
  const { total, paired, setAside, byClass } = report.sources;
  const classTotal = Object.values(byClass).reduce((n, v) => n + v, 0);
  return total === paired + setAside && total === classTotal;
}

function rankCandidates(
  source: { title: string; slug: string; navLabel: string },
  targets: ReconcilePage[],
  limit: number
): Candidate[] {
  return targets
    .map((target) => scoreAgainstTarget(source, target))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
