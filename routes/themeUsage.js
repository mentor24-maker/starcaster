'use strict';

/**
 * Which pages does a theme reach?
 *
 *   GET /api/builder/themes/:id/usage  →  { ok, data: { pages: [{ id, name, slug }], total } }
 *
 * The Themes page asks this BEFORE saving an existing theme, so it can put the
 * same Save / Save & Publish / Cancel question in front of the operator that
 * the saved-section and saved-module managers ask — and hand the page ids to
 * `POST /api/builder/publish` afterwards, so a theme change reaches the live
 * site without opening every page by hand (task 86bbzy9ym).
 *
 * Its own module rather than another branch in routes/builder.js, per
 * routes/CLAUDE.md. Registered AHEAD of `builder` in routes/index.js: builder
 * matches `/api/builder/themes/<id>` with a regex that stops at one segment,
 * so this path would fall through today — but the day builder grows a
 * catch-all, this would 405 with nothing to point at.
 *
 * AUTHENTICATED: /api/builder/* requires a session (routes/index.js) and the
 * read is scoped to the caller's active project.
 */

const { sendOk, sendErr } = require('./http');
const { listPagesFollowingTheme } = require('../lib/builderPagesStore');

const manifest = {
  id: 'theme-usage',
  label: 'Theme usage (which pages a theme reaches)',
  prefixes: ['/api/builder/themes/'],
};

const USAGE_PATH = /^\/api\/builder\/themes\/([^/]+)\/usage$/;

async function handle(req, res, pathname, method) {
  const match = String(pathname || '').match(USAGE_PATH);
  if (!match) return false;
  if (String(method || '').toUpperCase() !== 'GET') return false;

  const projectId = String(req?.projectContext?.project?.id || '').trim();
  if (!projectId) {
    return sendErr(res, 400, 'No active project', { code: 'PROJECT_REQUIRED' }), true;
  }

  const result = await listPagesFollowingTheme(projectId, decodeURIComponent(match[1]));
  if (!result.ok) {
    return sendErr(res, result.status || 500, result.error || 'Could not read which pages use this theme'), true;
  }
  const pages = Array.isArray(result.data) ? result.data : [];
  return sendOk(res, 200, { pages, total: pages.length }), true;
}

module.exports = { handle, manifest };
