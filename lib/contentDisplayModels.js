'use strict';

/**
 * Content Display Models
 * ─────────────────────
 * Each model represents a recognizable source-page layout pattern. Models are
 * identified by `id`, can detect themselves in raw HTML, and extract an ordered
 * array of content blocks that map onto a target template's layout sections.
 *
 * Block schema:
 *   { imageUrl: string, imageAlt: string, html: string, layout: 'image-left'|'image-right' }
 *
 * Adding a new model: push a new entry to MODELS below following the same shape.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isLogoUrl(url) {
  return /logo|icon|favicon|header/i.test(url);
}

// ─── Model 1: DudaMobile Alternating Two-Column ────────────────────────────────
// Matches interior pages on sites built with DudaMobile/Duda's flex layout engine.
// Each content "row" is a `data-auto="flex-section"` container that holds a grid
// with two `flex-element group` columns — one with a `data-widget-type="image"`
// and one with a `data-widget-type="paragraph"`. The columns alternate position
// (image-left for block 1, image-right for block 2, etc.).

function extractDudaAlternating2Col(rawHtml) {
  const blocks = [];
  // Each top-level section starts at `data-auto="flex-section"`.
  // Split there so we process one section at a time without needing a full DOM parser.
  const chunks = rawHtml.split(/(?=<div[^>]+data-auto="flex-section")/i);

  for (const chunk of chunks) {
    const hasImage = chunk.includes('data-widget-type="image"');
    const hasPara  = chunk.includes('data-widget-type="paragraph"');
    if (!hasImage || !hasPara) continue;

    // Skip the site header row — it contains a navigation widget; content rows never do.
    if (chunk.includes('data-widget-type="navigation"')) continue;

    // Content image: prefer data-dm-image-path (full-res URL) over src (CDN-optimised)
    const imgPathM = chunk.match(/data-dm-image-path="([^"]+)"/i);
    if (!imgPathM) continue;
    const imageUrl = imgPathM[1];
    if (isLogoUrl(imageUrl)) continue;

    // Alt text — look for the nearest alt attribute on the <img> tag that has our image path
    const imgTagM = chunk.match(/<img[^>]+data-dm-image-path="[^"]+"[^>]*>/i)
                 || chunk.match(/<img[^>]+src="[^"]*(?:\.jpg|\.jpeg|\.png|\.webp)[^"]*"[^>]*>/i);
    const imageAlt = imgTagM
      ? ((imgTagM[0].match(/\balt="([^"]*)"/i) || [])[1] || '')
      : '';

    // Paragraph HTML — grab the first dmNewParagraph content block
    const paraM = chunk.match(/<div[^>]+class="[^"]*dmNewParagraph[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*dmNewParagraph|<\/div>\s*<\/div>\s*<\/div>\s*(?:<\/div>|$))/i);
    if (!paraM) continue;
    const html = paraM[1].trim();
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length < 30) continue; // skip near-empty sections

    // Layout direction: whichever widget appears first in the chunk determines col-1
    const imagePos = chunk.indexOf('data-widget-type="image"');
    const paraPos  = chunk.indexOf('data-widget-type="paragraph"');
    const layout = imagePos < paraPos ? 'image-left' : 'image-right';

    blocks.push({ imageUrl, imageAlt, html, layout });
  }

  return blocks;
}

// ─── Section filler ───────────────────────────────────────────────────────────
/**
 * Apply extracted blocks onto a template's layoutSections (deep-cloned).
 * Blocks are matched to sections by index (block[0] → section[0], etc.).
 * Within each section, image modules get their `settings.url` updated;
 * text/heading modules get their `text` replaced with the block HTML.
 */
function applyBlocksToSections(layoutSections, blocks) {
  const sections = JSON.parse(JSON.stringify(layoutSections));
  const count = Math.min(blocks.length, sections.length);

  for (let i = 0; i < count; i++) {
    const block   = blocks[i];
    const section = sections[i];

    for (const mod of (section.modules || [])) {
      if (mod.type === 'image' || mod.type === 'floating-image') {
        mod.settings = { ...mod.settings, url: block.imageUrl, alt: block.imageAlt };
      } else if (mod.type === 'text') {
        mod.text = block.html;
      } else if (mod.type === 'heading') {
        // Pull the first heading tag's plain text, or fall back to full html
        const hM = block.html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
        mod.text = hM ? hM[1].replace(/<[^>]+>/g, '').trim() : '';
      }
    }
  }

  return sections;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

/**
 * Add new content display models here.
 * Each entry must implement:
 *   detect(rawHtml: string): boolean  — quick heuristic, no side-effects
 *   extract(rawHtml: string): Block[] — returns ordered content blocks
 */
const MODELS = [
  {
    id: 'duda-alternating-2col',
    name: 'Alternating Two-Column Blocks',
    description:
      'Pairs of content blocks where each block alternates between '
      + 'image-left/text-right and text-left/image-right. '
      + 'Designed for DudaMobile flex-grid interior pages.',
    detect(rawHtml) {
      return (
        rawHtml.includes('data-widget-type="image"') &&
        rawHtml.includes('data-widget-type="paragraph"') &&
        rawHtml.includes('flex-element group') &&
        rawHtml.includes('data-dm-image-path=')
      );
    },
    extract: extractDudaAlternating2Col,
    applyToSections: applyBlocksToSections,
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

function getModel(id) {
  return MODELS.find((m) => m.id === id) || null;
}

function listModels() {
  return MODELS.map(({ id, name, description }) => ({ id, name, description }));
}

/**
 * Auto-detect which model fits the given rawHtml.
 * Returns the first matching model, or null if none match.
 */
function detectModel(rawHtml) {
  return MODELS.find((m) => m.detect(rawHtml)) || null;
}

module.exports = { MODELS, getModel, listModels, detectModel, applyBlocksToSections };
