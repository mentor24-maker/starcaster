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
 *   POST /api/builder/themes/:id/default  →  { ok, data: { theme } }
 *
 * Makes that theme the one every page WITHOUT a theme of its own uses (task
 * 86bbzybx6). That used to be whichever theme was saved last, so saving any
 * theme could recolour every such page. Lives here, beside usage, because the
 * Themes page asks both questions about one theme and builder.js's
 * one-segment theme regex cannot see either path.
 *
 * AUTHENTICATED: /api/builder/* requires a session (routes/index.js) and the
 * read is scoped to the caller's active project.
 */

const { sendOk, sendErr } = require('./http');
const { listPagesFollowingTheme } = require('../lib/builderPagesStore');
const { setDefaultTheme } = require('../lib/builderThemesStore');
const { requestProjectScope } = require('../lib/requestProjectScope');

const manifest = {
  id: 'theme-usage',
  label: 'Theme usage (which pages a theme reaches) and the project default theme',
  prefixes: ['/api/builder/themes/'],
};

const USAGE_PATH = /^\/api\/builder\/themes\/([^/]+)\/usage$/;
const DEFAULT_PATH = /^\/api\/builder\/themes\/([^/]+)\/default$/;

async function handle(req, res, pathname, method) {
  const defaultMatch = String(pathname || '').match(DEFAULT_PATH);
  if (defaultMatch) {
    if (String(method || '').toUpperCase() !== 'POST') return false;
    const projectId = String(req?.projectContext?.project?.id || '').trim();
    if (!projectId) {
      return sendErr(res, 400, 'No active project', { code: 'PROJECT_REQUIRED' }), true;
    }
    const result = await setDefaultTheme(decodeURIComponent(defaultMatch[1]), requestProjectScope(req));
    if (!result.ok) {
      return sendErr(res, result.status || 500, result.error || 'Could not make this the default theme'), true;
    }
    return sendOk(res, 200, { theme: result.data }), true;
  }

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
