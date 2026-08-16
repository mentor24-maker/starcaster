/**
 * Site Import — Phase 3b: put back the images the capture downloaded but
 * never placed on a page.
 *
 * Phase 3 (reconcile.ts) moved each imported page's content onto the
 * hand-built page it belongs to. That moves every image the capture managed
 * to put IN the content — but the old site's gallery and carousels loaded
 * their pictures with JavaScript, so those never appeared in the HTML the
 * capture reads. The crawler downloaded them anyway; there was simply nowhere
 * in the content flow to put them. On delraytennis that left the Photo
 * Gallery page with 43 of its photos downloaded and none of them on the page.
 *
 * The mapping needs no guesswork: the import already recorded, for every
 * downloaded asset, which original page referenced it
 * (`app_site_import_assets.referenced_by`). Combined with the pairings Phase 3
 * produced, that says exactly which images belong on which new page.
 *
 * Pure: no I/O, no network, no clock. The runner fetches, copies blobs and
 * writes; this decides what should happen.
 */

export type ImportedAsset = {
  originalUrl: string;
  storageUrl: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  altText: string;
  /** Original page paths that referenced this asset, already normalized. */
  referencedPaths: string[];
};

export type TopUpTarget = {
  /** Original captured path, e.g. "/course/photo-gallery". */
  sourcePath: string;
  targetId: string;
  targetSlug: string;
  /** Every image URL already on the target page, module settings and inline. */
  alreadyOnPage: string[];
};

export type TopUpImage = {
  originalUrl: string;
  storageUrl: string;
  alt: string;
  width: number;
  height: number;
  byteSize: number;
  /** How many size variants of this same photo were collapsed away. */
  variantsCollapsed: number;
};

export type TopUpPlan = {
  targetId: string;
  targetSlug: string;
  sourcePaths: string[];
  images: TopUpImage[];
  presentation: 'slideshow' | 'images';
  totalBytes: number;
};

export type TopUpReport = {
  assetsConsidered: number;
  furnitureExcluded: number;
  variantsCollapsed: number;
  alreadyOnPage: number;
  capped: number;
  planned: number;
  byPage: {
    targetSlug: string;
    sourcePaths: string[];
    captured: number;
    furniture: number;
    variants: number;
    already: number;
    /** Dropped by an explicit per-page cap — never a silent truncation. */
    capped: number;
    planned: number;
    presentation: string;
  }[];
};

export type TopUpOptions = {
  assets: ImportedAsset[];
  targets: TopUpTarget[];
  /** Referenced by this share of captured pages ⇒ site furniture. */
  furnitureShare?: number;
  /** At or above this many images, a page gets one slideshow module. */
  slideshowThreshold?: number;
  /** Cap per page; 0 means no cap. */
  limitPerPage?: number;
};

/** Referenced by at least this share of captured pages ⇒ site furniture. */
export const FURNITURE_SHARE = 0.5;
/** At or above this many images, one slideshow beats a stack of modules. */
export const SLIDESHOW_THRESHOLD = 5;

/**
 * The stable identity of a photograph across every hop it makes.
 *
 * The same picture appears under several URLs: WordPress writes size variants
 * (`foo-768x576.jpg`, `foo-scaled.jpg`) and serves resize queries
 * (`foo.jpg?resize=768,576`), and promotion into the asset library prefixes an
 * epoch (`1786559901016_foo.jpg`, sometimes twice). Comparing raw URLs makes
 * the same photo look like four different ones — which is how a gallery ends
 * up with every picture in it three times.
 */
export function photoStem(url: string): string {
  const clean = String(url || '').split('?')[0].split('#')[0];
  return clean
    .slice(clean.lastIndexOf('/') + 1)
    .toLowerCase()
    .replace(/^\d{10,}_(?:\d{10,}_)?/, '')  // promotion epoch prefix(es)
    .replace(/-\d+x\d+(\.[a-z0-9]+)$/, '$1') // -768x576
    .replace(/-scaled(\.[a-z0-9]+)$/, '$1')
    .replace(/-e\d{10,}(\.[a-z0-9]+)$/, '$1'); // WordPress edit stamp
}

/**
 * Furniture is what appears everywhere — the logo, the social icons, the
 * "powered by" badge. Same rule the section and prose detectors use, for the
 * same reason: derive it from repetition rather than naming files.
 */
export function detectFurnitureImages(
  assets: ImportedAsset[],
  share = FURNITURE_SHARE
): Set<string> {
  const pages = new Set<string>();
  for (const asset of assets) for (const p of asset.referencedPaths) pages.add(p);
  if (pages.size < 3) return new Set();

  const pagesByStem = new Map<string, Set<string>>();
  for (const asset of assets) {
    const stem = photoStem(asset.originalUrl);
    if (!pagesByStem.has(stem)) pagesByStem.set(stem, new Set());
    for (const p of asset.referencedPaths) pagesByStem.get(stem)!.add(p);
  }
  const threshold = Math.max(2, Math.ceil(pages.size * share));
  const furniture = new Set<string>();
  pagesByStem.forEach((refs, stem) => {
    if (refs.size >= threshold) furniture.add(stem);
  });
  return furniture;
}

/** Of several size variants of one photo, the biggest file is the original. */
function pickLargest(variants: ImportedAsset[]): ImportedAsset {
  return [...variants].sort((a, b) => {
    const byBytes = (b.byteSize || 0) - (a.byteSize || 0);
    if (byBytes !== 0) return byBytes;
    return (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0);
  })[0];
}

export function planImageTopUp(options: TopUpOptions): { plans: TopUpPlan[]; report: TopUpReport } {
  const {
    assets,
    targets,
    furnitureShare = FURNITURE_SHARE,
    slideshowThreshold = SLIDESHOW_THRESHOLD,
    limitPerPage = 0,
  } = options;

  const furniture = detectFurnitureImages(assets, furnitureShare);

  // One target page can be fed by several original paths (the operator pointed
  // two old pages at one new page), so gather by target, not by path.
  const byTarget = new Map<string, TopUpTarget[]>();
  for (const target of targets) {
    if (!byTarget.has(target.targetId)) byTarget.set(target.targetId, []);
    byTarget.get(target.targetId)!.push(target);
  }

  const plans: TopUpPlan[] = [];
  const reportPages: TopUpReport['byPage'] = [];
  let furnitureExcluded = 0;
  let variantsCollapsed = 0;
  let alreadyCount = 0;
  let cappedCount = 0;
  let considered = 0;

  byTarget.forEach((group) => {
    const paths = new Set(group.map((t) => t.sourcePath));
    const onPage = new Set<string>();
    for (const t of group) for (const url of t.alreadyOnPage) onPage.add(photoStem(url));

    const captured = assets.filter((a) => a.referencedPaths.some((p) => paths.has(p)));
    considered += captured.length;

    const content = captured.filter((a) => !furniture.has(photoStem(a.originalUrl)));
    const furnitureHere = captured.length - content.length;
    furnitureExcluded += furnitureHere;

    // Collapse size variants, keeping the largest of each photo.
    const groups = new Map<string, ImportedAsset[]>();
    for (const asset of content) {
      const stem = photoStem(asset.originalUrl);
      if (!groups.has(stem)) groups.set(stem, []);
      groups.get(stem)!.push(asset);
    }
    const collapsedHere = content.length - groups.size;
    variantsCollapsed += collapsedHere;

    const chosen: TopUpImage[] = [];
    let alreadyHere = 0;
    groups.forEach((variants, stem) => {
      if (onPage.has(stem)) { alreadyHere += 1; return; }
      const best = pickLargest(variants);
      chosen.push({
        originalUrl: best.originalUrl,
        storageUrl: best.storageUrl,
        alt: best.altText || '',
        width: best.width || 0,
        height: best.height || 0,
        byteSize: best.byteSize || 0,
        variantsCollapsed: variants.length - 1,
      });
    });
    alreadyCount += alreadyHere;

    // Stable order: the capture's own order, which follows the page.
    const position = new Map(assets.map((a, i) => [photoStem(a.originalUrl), i]));
    chosen.sort((a, b) => (position.get(photoStem(a.originalUrl)) || 0) - (position.get(photoStem(b.originalUrl)) || 0));

    const limited = limitPerPage > 0 ? chosen.slice(0, limitPerPage) : chosen;
    cappedCount += chosen.length - limited.length;
    const first = group[0];

    reportPages.push({
      targetSlug: first.targetSlug,
      sourcePaths: [...paths].sort(),
      captured: captured.length,
      furniture: furnitureHere,
      variants: collapsedHere,
      already: alreadyHere,
      capped: chosen.length - limited.length,
      planned: limited.length,
      presentation: limited.length >= slideshowThreshold ? 'slideshow' : 'images',
    });

    if (!limited.length) return;
    plans.push({
      targetId: first.targetId,
      targetSlug: first.targetSlug,
      sourcePaths: [...paths].sort(),
      images: limited,
      presentation: limited.length >= slideshowThreshold ? 'slideshow' : 'images',
      totalBytes: limited.reduce((n, i) => n + i.byteSize, 0),
    });
  });

  plans.sort((a, b) => a.targetSlug.localeCompare(b.targetSlug));
  reportPages.sort((a, b) => a.targetSlug.localeCompare(b.targetSlug));

  return {
    plans,
    report: {
      assetsConsidered: considered,
      furnitureExcluded,
      variantsCollapsed,
      alreadyOnPage: alreadyCount,
      capped: cappedCount,
      planned: plans.reduce((n, p) => n + p.images.length, 0),
      byPage: reportPages,
    },
  };
}

/** Deterministic, so a re-run replaces its own section instead of adding another. */
export function topUpSectionId(targetId: string): string {
  return `recsimg_${String(targetId).replace(/[^a-zA-Z0-9]/g, '')}`.slice(0, 120);
}

/**
 * Build the section to add. A handful of pictures reads better as ordinary
 * image modules the operator can move individually; a gallery's worth is one
 * slideshow, which is what the old page was.
 */
export function buildTopUpSection(
  plan: TopUpPlan,
  urlFor: (image: TopUpImage) => string
): any {
  const sectionId = topUpSectionId(plan.targetId);
  const provenance = {
    topUpFromPaths: plan.sourcePaths.join(','),
    topUpImageCount: String(plan.images.length),
  };

  if (plan.presentation === 'slideshow') {
    const slides = plan.images.map((image, index) => ({
      id: `${sectionId}-s${index}`,
      url: urlFor(image),
      alt: image.alt,
    }));
    return {
      id: sectionId,
      title: 'Imported: Gallery',
      layout: 'single',
      widthMode: 'contained',
      modules: [{
        id: `${sectionId}-slideshow`,
        type: 'slideshow',
        column: 'main',
        name: 'Imported gallery',
        text: '',
        settings: {
          slides: JSON.stringify(slides),
          intervalMs: '5000',
          transition: 'slide',
          heightPx: '',
          ...provenance,
        },
      }],
    };
  }

  return {
    id: sectionId,
    title: 'Imported: Images',
    layout: 'single',
    widthMode: 'contained',
    modules: plan.images.map((image, index) => ({
      id: `${sectionId}-m${index}`,
      type: 'image',
      column: 'main',
      name: 'Imported image',
      text: '',
      settings: {
        url: urlFor(image),
        alt: image.alt,
        size: '100',
        ...provenance,
      },
    })),
  };
}

/**
 * Every captured image must end up in exactly one bucket. A picture that
 * falls out of all of them is indistinguishable from one that was never
 * downloaded, which is the failure this accounting exists to make loud.
 */
export function topUpReconciles(report: TopUpReport): boolean {
  const accounted = report.byPage.reduce(
    (n, p) => n + p.furniture + p.variants + p.already + p.capped + p.planned,
    0
  );
  const captured = report.byPage.reduce((n, p) => n + p.captured, 0);
  return accounted === captured;
}
