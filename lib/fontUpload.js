'use strict';

/**
 * Turning an uploaded form into a stored font (Font Library 1/7).
 *
 * The order is the point: EVERY check runs before the first file is written,
 * so a refused font — the wrong licence, a bad name, a file that is not a
 * font, a family the project already has — leaves nothing in blob storage.
 * Then the files are stored, then the row is saved; if the row is refused
 * after all, the files just stored are removed again rather than left as
 * orphans nobody can see or delete.
 *
 * Blob storage is passed in (`deps`) so the tests can prove "nothing was
 * stored" by counting calls, not by reading a log.
 */

const blobStorage = require('./blobStorage');
const fontsStore = require('./fontsStore');
const { detectFontFormat, inferFontStyle, checkFontStyle } = require('./fontFiles');

const MAX_FILES = 18; // nine weights, upright and italic

function safeSegment(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
}

/**
 * The weight/style each file is, in file order. The form may send `styles` as
 * a JSON list parallel to the files (`[{"weight":700,"style":"italic"}, …]`);
 * any file it does not cover is read from its file name.
 */
function stylesForFiles(files, stylesField) {
  let declared = [];
  if (stylesField !== undefined && String(stylesField).trim() !== '') {
    try {
      declared = JSON.parse(stylesField);
    } catch {
      return { ok: false, message: 'styles must be a JSON list like [{"weight":400,"style":"normal"}].' };
    }
    if (!Array.isArray(declared)) {
      return { ok: false, message: 'styles must be a JSON list like [{"weight":400,"style":"normal"}].' };
    }
  }
  const out = [];
  for (let i = 0; i < files.length; i += 1) {
    const guess = declared[i] && typeof declared[i] === 'object' ? declared[i] : inferFontStyle(files[i].fileName);
    const checked = checkFontStyle(guess);
    if (!checked.ok) return { ok: false, message: `${files[i].fileName}: ${checked.message}` };
    out.push({ weight: checked.weight, style: checked.style });
  }
  return { ok: true, styles: out };
}

function parseTagsField(value) {
  if (value === undefined) return undefined;
  const text = String(value).trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }
  return text.split(',');
}

/**
 * @param {{ fields: Record<string,string>, files: Array<{fileName:string, buffer:Buffer}> }} form
 * @param {object} scope   requestProjectScope(req)
 * @param {{ uploadBufferToBlobAtPath?: Function, deleteBlob?: Function, store?: object, now?: () => number }} [deps]
 * @returns the store envelope — `{ ok, status, data: font }` or `{ ok:false, status, error }`
 */
async function uploadProjectFont(form, scope, deps = {}) {
  const upload = deps.uploadBufferToBlobAtPath || blobStorage.uploadBufferToBlobAtPath;
  const remove = deps.deleteBlob || blobStorage.deleteBlob;
  const store = deps.store || fontsStore;
  const now = deps.now || Date.now;
  const fields = form?.fields || {};
  const files = (form?.files || []).filter((f) => f && f.buffer && f.buffer.length);

  const tags = parseTagsField(fields.tags);
  if (tags === null) return { ok: false, status: 400, error: 'tags must be a comma-separated list or a JSON list.' };

  // 1. The licence, name and category — before anything else, so the licence
  //    refusal is the answer even when the files are fine.
  const checked = store.checkFontInput({
    family: fields.family,
    category: fields.category,
    licence: fields.licence,
    licenceText: fields.licenceText,
    sourceUrl: fields.sourceUrl,
    sourceName: fields.sourceName || 'Upload',
    previewText: fields.previewText,
    tags,
  });
  if (!checked.ok) return checked;
  const font = checked.data;

  // 2. The files: present, not too many, and really fonts.
  if (!files.length) return { ok: false, status: 400, error: 'Choose at least one font file (.woff2, .woff, .ttf or .otf).' };
  if (files.length > MAX_FILES) return { ok: false, status: 400, error: `Upload at most ${MAX_FILES} files for one font.` };
  const formats = [];
  for (const file of files) {
    const detected = detectFontFormat(file.fileName, file.buffer);
    if (!detected.ok) return { ok: false, status: 400, error: detected.message };
    formats.push(detected);
  }
  const styles = stylesForFiles(files, fields.styles);
  if (!styles.ok) return { ok: false, status: 400, error: styles.message };
  const seen = new Set();
  for (const s of styles.styles) {
    const key = `${s.weight}-${s.style}`;
    if (seen.has(key)) {
      return {
        ok: false,
        status: 400,
        error: `Two files are both weight ${s.weight} ${s.style}. Each weight and style needs its own file — rename them (for example "-Bold", "-Italic") or send styles.`,
      };
    }
    seen.add(key);
  }

  // 3. Not a family this project already has.
  const existing = await store.findFontBySlug(font.slug, scope);
  if (!existing.ok) return existing;
  if (existing.data) {
    return { ok: false, status: 409, error: `A font called "${existing.data.family}" is already in this project.` };
  }

  // 4. Store the files.
  const projectId = String(scope?.projectId || '').trim();
  const folder = `Fonts/${safeSegment(projectId)}/${font.slug}-${now()}`;
  const stored = [];
  async function cleanUp() {
    for (const s of stored) {
      // Best effort: the row was never saved, so nothing points at these.
      try { await remove(s.url); } catch { /* reported by the caller's error */ }
    }
  }
  for (let i = 0; i < files.length; i += 1) {
    const { weight, style } = styles.styles[i];
    const { format, mime } = formats[i];
    const pathname = `${folder}/${weight}-${style}.${format}`;
    const put = await upload({ pathname, mimeType: mime, fileBuffer: files[i].buffer });
    if (!put.ok) {
      await cleanUp();
      return { ok: false, status: put.status || 502, error: `Storing ${files[i].fileName} failed: ${put.error || 'unknown error'}` };
    }
    stored.push({ weight, style, format, url: put.data.location, pathname: put.data.pathname || pathname });
  }

  // 5. Save the row; undo the files if it is refused.
  const created = await store.createFont({ ...font, styles: stored }, scope);
  if (!created.ok) {
    await cleanUp();
    return created;
  }
  return created;
}

/**
 * Delete a font's files after its row is gone. Reports how many could not be
 * removed rather than claiming a clean delete it did not do.
 */
async function removeFontFiles(font, deps = {}) {
  const remove = deps.deleteBlob || blobStorage.deleteBlob;
  const failed = [];
  for (const s of font?.styles || []) {
    if (!s?.url) continue;
    const res = await remove(s.url);
    if (!res || !res.ok) failed.push(s.url);
  }
  return { removed: (font?.styles || []).length - failed.length, failed };
}

module.exports = { MAX_FILES, removeFontFiles, stylesForFiles, uploadProjectFont };
