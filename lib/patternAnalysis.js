'use strict';

/**
 * Pattern Analysis
 * ────────────────
 * Inspects raw HTML from a crawl run to produce:
 *   matchedHandlers   — existing sanitization rules that fired, with counts + examples
 *   unmatchedPatterns — structural HTML patterns not covered by any handler
 *
 * Used by the Pattern Inspector modal in Acquire: Web > Website Pages.
 */

const { sanitizeImportHtml, identifyHeaderLines } = require('./contentDisplayModels');

// ─── Matched handler detection ────────────────────────────────────────────────

const BUILT_IN_HANDLER_DETECTORS = [
  {
    id: 'strip-dangerous-tags',
    name: 'Strip dangerous tags',
    description: 'Removes <script>, <style>, <iframe> and similar tags along with all their content.',
    detect(raw) {
      const re = /<(script|style|noscript|iframe|object|embed|form|svg|canvas)\b[\s\S]*?<\/\1\s*>/gi;
      return [...raw.matchAll(re)].map((m) => m[0].slice(0, 120));
    },
  },
  {
    id: 'strip-style-class-attrs',
    name: 'Strip style/class attributes',
    description: 'Removes every style= and class= attribute from all HTML tags.',
    detect(raw) {
      const re = /\s+(?:style|class)\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/gi;
      return [...raw.matchAll(re)].map((m) => m[0].slice(0, 80));
    },
  },
  {
    id: 'strip-disallowed-tags',
    name: 'Strip disallowed tags',
    description: 'Removes tags outside the allowed semantic set (div, span, table, etc.), preserving text content.',
    detect(raw) {
      const allowed = new Set(['h1','h2','h3','h4','h5','h6','p','br','hr','ul','ol','li','strong','em','b','i','u','s','blockquote','pre','code','a','img']);
      const re = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
      const hits = [];
      for (const m of raw.matchAll(re)) {
        if (!allowed.has(m[1].toLowerCase())) hits.push(m[0].slice(0, 60));
      }
      return hits;
    },
  },
  {
    id: 'promote-p-bold-h2',
    name: 'Bold paragraph → H2 heading',
    description: '<p><b>text</b></p> (or <strong>) promoted to <h2>. If the bold content contains a <br>, text before becomes the heading and text after remains a paragraph.',
    detect(raw) {
      const re = /<p>\s*<(b|strong)>([\s\S]*?)<\/\1>\s*<\/p>/gi;
      return [...raw.matchAll(re)].map((m) => ({ before: m[0].slice(0, 120), after: `<h2>${m[2].slice(0,80)}</h2>` }));
    },
  },
  {
    id: 'promote-line-bold-h2',
    name: 'Bold-only line → H2 heading',
    description: 'A <b> or <strong> element that is the sole content of its line is promoted to <h2>.',
    detect(raw) {
      const re = /^<(b|strong)>([\s\S]*?)<\/\1>$/gim;
      return [...raw.matchAll(re)].map((m) => ({ before: m[0].slice(0, 120), after: `<h2>${m[2].slice(0,80)}</h2>` }));
    },
  },
  {
    id: 'identify-header-lines',
    name: 'Bold + <br> → H2 heading',
    description: 'Bold text immediately adjacent to a <br> tag (before or after) is promoted to <h2>.',
    detect(raw) {
      const re1 = /(<br\s*\/?>\s*)<(b|strong)>([\s\S]*?)<\/\2>/gi;
      const re2 = /^<(b|strong)>([\s\S]*?)<\/\1>(\s*<br\s*\/?>)/gim;
      return [
        ...[...raw.matchAll(re1)].map((m) => m[0].slice(0, 120)),
        ...[...raw.matchAll(re2)].map((m) => m[0].slice(0, 120)),
      ];
    },
  },
];

// ─── Unmatched pattern detection ──────────────────────────────────────────────

const UNMATCHED_PATTERN_DETECTORS = [
  {
    id: 'underline-standalone',
    suggestedName: 'Underline element on its own line',
    suggestedType: 'promote-h2',
    suggestedTag: 'u',
    description: '<u>text</u> appears alone on a line — often used as a heading style in WordPress/Divi sites.',
    detect(sanitized) {
      const re = /^<u>([\s\S]*?)<\/u>$/gim;
      return [...sanitized.matchAll(re)].map((m) => m[0]);
    },
  },
  {
    id: 'italic-standalone',
    suggestedName: 'Italic element on its own line',
    suggestedType: 'promote-h3',
    suggestedTag: 'em',
    description: '<em> or <i> appearing alone on a line — may represent a sub-heading or caption.',
    detect(sanitized) {
      const re = /^<(?:em|i)>([\s\S]*?)<\/(?:em|i)>$/gim;
      return [...sanitized.matchAll(re)].map((m) => m[0]);
    },
  },
  {
    id: 'bold-residual',
    suggestedName: 'Bold text (not promoted)',
    suggestedType: 'promote-h2',
    suggestedTag: 'b',
    description: 'Remaining <b>/<strong> elements that did not meet promotion criteria — may be sub-headings or key phrases worth promoting.',
    detect(sanitized) {
      const re = /<(?:b|strong)>([^<]{8,})<\/(?:b|strong)>/gi;
      return [...sanitized.matchAll(re)].map((m) => m[0]);
    },
  },
  {
    id: 'all-caps-line',
    suggestedName: 'ALL CAPS text line',
    suggestedType: 'promote-h2',
    description: 'Lines in all caps (min 4 chars) — common heading pattern in plain-text-heavy sites.',
    detect(sanitized) {
      const stripped = sanitized.replace(/<[^>]+>/g, ' ').replace(/\s+/g, '\n');
      const re = /^([A-Z][A-Z\s&.,!?''"\-]{3,})$/gm;
      return [...stripped.matchAll(re)].map((m) => m[1].trim()).filter((s) => s.length >= 4 && s.length <= 80);
    },
  },
  {
    id: 'phone-numbers',
    suggestedName: 'Phone numbers in text',
    suggestedType: 'delete',
    description: 'Telephone numbers found in page text — often boilerplate that should be stripped from content blocks.',
    detect(sanitized) {
      const stripped = sanitized.replace(/<[^>]+>/g, ' ');
      const re = /\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/g;
      return [...stripped.matchAll(re)].map((m) => m[0]);
    },
  },
  {
    id: 'informal-numbered-list',
    suggestedName: 'Informal numbered list items',
    suggestedType: 'strip-tag',
    description: 'Lines beginning with "1." "2." etc. outside an <ol> — may benefit from a wrap-in-ol handler.',
    detect(sanitized) {
      const stripped = sanitized.replace(/<[^>]+>/g, ' ');
      const re = /^\s*(\d+[.)]\s+.{5,80})$/gm;
      return [...stripped.matchAll(re)].map((m) => m[1].trim());
    },
  },
  {
    id: 'bare-hr',
    suggestedName: 'Horizontal rule divider',
    suggestedType: 'delete',
    description: '<hr> tags in content — often decorative separators that may clutter extracted content.',
    detect(sanitized) {
      const re = /<hr\s*\/?>/gi;
      return [...sanitized.matchAll(re)].map((m) => m[0]);
    },
  },
];

// ─── Per-page analysis ────────────────────────────────────────────────────────

function analyzePage(page) {
  const raw = String(page.body_raw || '');
  if (!raw) return null;

  const sanitized = identifyHeaderLines(sanitizeImportHtml(raw));

  const handlerHits = BUILT_IN_HANDLER_DETECTORS.map((d) => {
    const examples = d.detect(raw);
    return examples.length ? { id: d.id, name: d.name, description: d.description, count: examples.length, examples: examples.slice(0, 2) } : null;
  }).filter(Boolean);

  const patternHits = UNMATCHED_PATTERN_DETECTORS.map((d) => {
    const examples = d.detect(sanitized);
    const unique = [...new Set(examples.map((e) => String(e).trim()))].filter(Boolean);
    return unique.length ? {
      id: d.id,
      suggestedName: d.suggestedName,
      suggestedType: d.suggestedType,
      suggestedTag: d.suggestedTag || '',
      description: d.description,
      count: unique.length,
      examples: unique.slice(0, 3),
    } : null;
  }).filter(Boolean);

  return { handlerHits, patternHits };
}

// ─── Run-level aggregation ────────────────────────────────────────────────────

function analyzeRunPages(pages) {
  const handlerMap = {};
  const patternMap = {};
  let pagesAnalyzed = 0;

  for (const page of pages) {
    const result = analyzePage(page);
    if (!result) continue;
    pagesAnalyzed++;

    for (const h of result.handlerHits) {
      if (!handlerMap[h.id]) {
        handlerMap[h.id] = { ...h, totalCount: 0, examples: [] };
      }
      handlerMap[h.id].totalCount += h.count;
      if (handlerMap[h.id].examples.length < 2) {
        handlerMap[h.id].examples.push(...h.examples.slice(0, 2 - handlerMap[h.id].examples.length));
      }
    }

    for (const p of result.patternHits) {
      if (!patternMap[p.id]) {
        patternMap[p.id] = { ...p, totalCount: 0, examples: [] };
      }
      patternMap[p.id].totalCount += p.count;
      if (patternMap[p.id].examples.length < 3) {
        patternMap[p.id].examples.push(...p.examples.slice(0, 3 - patternMap[p.id].examples.length));
      }
    }
  }

  const matchedHandlers = Object.values(handlerMap).sort((a, b) => b.totalCount - a.totalCount);
  const unmatchedPatterns = Object.values(patternMap).sort((a, b) => b.totalCount - a.totalCount);

  return { pagesAnalyzed, matchedHandlers, unmatchedPatterns };
}

module.exports = { analyzeRunPages };
