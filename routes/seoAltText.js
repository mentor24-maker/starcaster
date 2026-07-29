'use strict';

/**
 * SEO Alt Text extension — API route.
 *
 * ONE page per request. The browser drives the loop across the pages the
 * operator selected, advancing a progress bar as each returns. This is a
 * deliberate design choice: the public site runs on Vercel, where a serverless
 * function is frozen the instant it returns — so a server-side "process every
 * page in the background" loop would be killed part-way through (the same trap
 * that truncated Header/Footer canonical propagation on 7/22). Client-driven
 * chunking survives freezes and gives an accurate "page N of M" progress popup.
 *
 * POST /api/builder/seo-alt-text
 *   body: { pageId, overwrite?, dryRun?, countOnly? }
 *   - countOnly: return the eligible-image count only (no search / no AI) so the
 *     client can size the progress bar / ETA before it starts.
 *   - dryRun:    generate alt text and report it, but do not save.
 *   - otherwise: generate and save.
 */

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { requestProjectScope } = require('../lib/requestProjectScope');
const { getPage, updatePage } = require('../lib/builderPagesStore');
const { checkEndpointLimit } = require('../lib/rateLimiter');
const { collectImageTargets, generateAltTextForPage } = require('../lib/seoAltText');
const { searchFor, generateAlt } = require('../lib/altTextProviders');

async function handle(req, res, pathname, method) {
  const requestMethod = String(method || '').toUpperCase();
  if (pathname !== '/api/builder/seo-alt-text' || requestMethod !== 'POST') return false;

  const scope = requestProjectScope(req);
  const body = await parseJsonBody(req).catch(() => ({}));
  const pageId = String(body.pageId || '').trim();
  if (!pageId) return sendErr(res, 400, 'pageId is required'), true;

  const overwrite = body.overwrite === true;
  const dryRun = body.dryRun === true;
  const countOnly = body.countOnly === true;

  const pageRes = await getPage(pageId, scope);
  if (!pageRes.ok) {
    return sendErr(res, pageRes.status || 404, pageRes.error || 'Page not found'), true;
  }
  const page = pageRes.data;
  const sections = Array.isArray(page.layoutSections) ? page.layoutSections : [];

  // Cheap count pass — no search, no AI. Lets the client compute the ETA.
  if (countOnly) {
    const imageCount = collectImageTargets(sections, { overwrite }).length;
    const result = { pageId, name: page.name, slug: page.slug, imageCount };
    return sendOk(res, 200, result, result), true;
  }

  // Only the real (search + AI) path counts against the rate limit.
  if (checkEndpointLimit(req, res, 'builder.seoAltText')) return true;

  const { sections: nextSections, changes, changed } = await generateAltTextForPage({
    page,
    overwrite,
    search: searchFor,
    generateAlt,
  });

  let applied = false;
  if (changed && !dryRun) {
    const updateRes = await updatePage(
      pageId,
      { layoutSections: nextSections, pageBackground: page.pageBackground, theme: page.theme },
      scope
    );
    if (!updateRes.ok) {
      return sendErr(res, updateRes.status || 500, updateRes.error || 'Could not save the page.'), true;
    }
    applied = true;
  }

  const result = {
    pageId,
    name: page.name,
    slug: page.slug,
    altFilled: changes.length,
    changes,
    applied,
    dryRun,
  };
  return sendOk(res, 200, result, result), true;
}

const manifest = {
  id: 'seoAltText',
  label: 'SEO Alt Text',
  prefixes: ['/api/builder/seo-alt-text'],
};

module.exports = { handle, manifest };
