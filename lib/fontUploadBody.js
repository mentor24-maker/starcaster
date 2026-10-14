'use strict';

/**
 * Reading a font upload from a JSON request (Font Library 1/7).
 *
 * The upload is JSON with each file as base64 — the same way every other
 * upload here travels — and NOT a multipart form. On Vercel the Node runtime
 * reads the whole request before our handler runs and only hands the bytes
 * back for JSON, text, urlencoded and octet-stream; a multipart body is read
 * and thrown away, so a handler that waits on the stream waits forever
 * (round-1 review of 86bchyd3n). JSON arrives on `req.body` already parsed,
 * and `parseJsonBody` uses it.
 *
 *   {
 *     family, category, licence,                 required
 *     licenceText, sourceName, sourceUrl,         optional
 *     previewText,
 *     tags:   ["sci-fi", …]   or "sci-fi, …",
 *     styles: [{ weight, style }, …]   parallel to files; a file it does not
 *                                      cover is read from its file name
 *     files:  [{ name: "Orbitron-Bold.woff2", data: "<base64>" }, …]
 *   }
 *
 * The result is the `{ fields, files }` shape lib/fontUpload.js takes.
 */

// Vercel refuses a function request over 4.5 MB before our code runs, with a
// bare error page. base64 is a third bigger than the file, so 3 MB of font
// files is the most that fits — refused here first, in words.
const MAX_FILE_BYTES = 3 * 1024 * 1024;

const TEXT_FIELDS = ['family', 'category', 'licence', 'licenceText', 'sourceName', 'sourceUrl', 'previewText'];
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function decodeBase64(value) {
  // A browser's FileReader gives "data:font/woff2;base64,AAAA" — take what follows the comma.
  const text = String(value || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!text || text.length % 4 !== 0 || !BASE64.test(text)) return null;
  return Buffer.from(text, 'base64');
}

/**
 * @param {unknown} body   the parsed JSON request body
 * @returns {{ ok: true, fields: Record<string, string>, files: Array<{ fileName: string, buffer: Buffer }> }
 *          | { ok: false, status: number, message: string }}
 */
function readFontUploadBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, message: 'Send the font as JSON: family, category, licence and files.' };
  }
  const fields = {};
  for (const name of TEXT_FIELDS) {
    if (body[name] !== undefined && body[name] !== null) fields[name] = String(body[name]);
  }
  // fontUpload reads these two as text (comma list or JSON), so a list sent
  // as a real JSON array is handed on as JSON text.
  for (const name of ['tags', 'styles']) {
    const value = body[name];
    if (value === undefined || value === null) continue;
    fields[name] = typeof value === 'string' ? value : JSON.stringify(value);
  }

  const raw = body.files;
  if (raw !== undefined && !Array.isArray(raw)) {
    return { ok: false, status: 400, message: 'files must be a list like [{ "name": "MyFont-Regular.woff2", "data": "<base64>" }].' };
  }
  const files = [];
  let total = 0;
  for (const entry of raw || []) {
    const fileName = String(entry?.name || '').trim();
    if (!fileName) return { ok: false, status: 400, message: 'Every file needs its name, for example "MyFont-Bold.woff2".' };
    const buffer = decodeBase64(entry?.data);
    if (!buffer) return { ok: false, status: 400, message: `${fileName}: the file's contents did not arrive as base64.` };
    total += buffer.length;
    if (total > MAX_FILE_BYTES) {
      return {
        ok: false,
        status: 413,
        message: `The files add up to more than ${MAX_FILE_BYTES / (1024 * 1024)} MB. Upload fewer files at a time.`,
      };
    }
    files.push({ fileName, buffer });
  }
  return { ok: true, fields, files };
}

module.exports = { MAX_FILE_BYTES, readFontUploadBody };
