'use strict';

/**
 * The font library API (Font Library 1/7, task 86bchyd3n).
 *
 *   GET    /api/fonts        → { ok, data: { fonts, total } }   shared library + this project's own
 *   POST   /api/fonts        → { ok, data: { font } }           JSON: family + category + licence
 *                                                                + files [{ name, data: base64 }]
 *                                                                (lib/fontUploadBody.js has the rest)
 *   PATCH  /api/fonts/:id    → { ok, data: { font } }           JSON { tags?, previewText? }
 *   DELETE /api/fonts/:id    → { ok, data: { font, filesRemoved, filesNotRemoved } }
 *   GET    /api/fonts/:id/usage → { ok, data: { font, sites, totalPages, truncated } }
 *                                the published public pages using it, by site
 *                                (Font Library 6/7, lib/fontUsageStore.js)
 *
 * A project may change and delete only its own fonts; a shared-library font
 * answers 403 with the reason. Uploads are refused unless the licence allows
 * use on a business website (lib/fontLicence.js), and a refused upload stores
 * nothing (lib/fontUpload.js).
 *
 * AUTHENTICATED: no exemption in routes/index.js, so a session is required,
 * and every call is scoped to the caller's active project.
 */

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { requestProjectScope } = require('../lib/requestProjectScope');
const fontsStore = require('../lib/fontsStore');
const { uploadProjectFont, removeFontFiles } = require('../lib/fontUpload');
const { readFontUploadBody } = require('../lib/fontUploadBody');
const { getFontUsage } = require('../lib/fontUsageStore');

const manifest = {
  id: 'fonts',
  label: 'Font library (shared + project fonts, upload, tags)',
  prefixes: ['/api/fonts'],
};

const ID_PATH = /^\/api\/fonts\/([^/]+)\/?$/;
const USAGE_PATH = /^\/api\/fonts\/([^/]+)\/usage\/?$/;

function fail(res, result, fallback) {
  return sendErr(res, result.status || 500, result.error || fallback), true;
}

async function handle(req, res, pathname, method, deps = {}) {
  const path = String(pathname || '');
  const verb = String(method || '').toUpperCase();
  const isCollection = path === '/api/fonts' || path === '/api/fonts/';
  const idMatch = path.match(ID_PATH);
  const usageMatch = path.match(USAGE_PATH);
  if (!isCollection && !idMatch && !usageMatch) return false;

  const scope = requestProjectScope(req);
  if (!scope.projectId) return sendErr(res, 400, 'No active project', { code: 'PROJECT_REQUIRED' }), true;

  if (isCollection && verb === 'GET') {
    const result = await fontsStore.listFonts(500, scope);
    if (!result.ok) return fail(res, result, 'Could not read the font library');
    return sendOk(res, 200, { fonts: result.data, total: result.data.length }), true;
  }

  if (usageMatch) {
    if (verb !== 'GET') return sendErr(res, 405, `${verb} is not supported on ${path}`), true;
    const result = await (deps.getFontUsage || getFontUsage)(decodeURIComponent(usageMatch[1]), scope);
    if (!result.ok) return fail(res, result, 'Could not read which sites use this font');
    return sendOk(res, 200, result.data), true;
  }

  if (isCollection && verb === 'POST') {
    // Refused BEFORE the body is read. On Vercel a multipart (or untyped)
    // body has already been read and discarded by the runtime, so waiting on
    // the stream would hang until the function timed out.
    if (!/^application\/json\b/i.test(String(req.headers?.['content-type'] || ''))) {
      return sendErr(res, 415, 'Send the font as JSON (Content-Type: application/json), with each file as base64.'), true;
    }
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return sendErr(res, 413, err.message || 'The upload could not be read'), true;
    }
    const form = readFontUploadBody(body);
    if (!form.ok) return sendErr(res, form.status, form.message), true;
    const result = await uploadProjectFont(form, scope, deps);
    if (!result.ok) return fail(res, result, 'Could not save the font');
    return sendOk(res, 201, { font: result.data }), true;
  }

  if (idMatch && verb === 'PATCH') {
    let body;
    try {
      body = await parseJsonBody(req);
    } catch (err) {
      return sendErr(res, 400, err.message || 'Invalid JSON body'), true;
    }
    const result = await fontsStore.updateFontTags(
      decodeURIComponent(idMatch[1]),
      { tags: body?.tags, previewText: body?.previewText },
      scope
    );
    if (!result.ok) return fail(res, result, 'Could not change the font');
    return sendOk(res, 200, { font: result.data }), true;
  }

  if (idMatch && verb === 'DELETE') {
    const result = await fontsStore.deleteFont(decodeURIComponent(idMatch[1]), scope);
    if (!result.ok) return fail(res, result, 'Could not delete the font');
    const files = await removeFontFiles(result.data, deps);
    return sendOk(res, 200, {
      font: result.data,
      filesRemoved: files.removed,
      // Named, not hidden: the row is gone either way, but a file that could
      // not be removed is still on blob storage.
      filesNotRemoved: files.failed,
    }), true;
  }

  return sendErr(res, 405, `${verb} is not supported on ${path}`), true;
}

module.exports = { handle, manifest };
