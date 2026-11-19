'use strict';

/**
 * Which files Assets › Context accepts, and where they are stored
 * (ticket SC-809, slice 2 of 3).
 *
 * ONE copy, read by both sides: the page (components/context/context-manager.tsx)
 * refuses a file before uploading it, and the server
 * (routes/context.js, lib/contextStore.js) refuses the same file again when
 * it hands out an upload token and when it records the entry. Two lists would
 * drift, and the one that drifted would be the one nobody tests.
 *
 * The TYPE is decided by the file's extension, not by what the browser says
 * the file is: browsers disagree about .md and .csv (blank, text/x-markdown,
 * application/vnd.ms-excel), and the extension is what the person picked. The
 * upload is then sent with the canonical content type for that extension, so
 * the stored file opens the right way in a browser.
 */

const MAX_FILE_BYTES = 50 * 1024 * 1024;

const ACCEPTED = Object.freeze({
  pdf: { label: 'PDF', mime: 'application/pdf' },
  txt: { label: 'Text', mime: 'text/plain' },
  md: { label: 'Markdown', mime: 'text/markdown' },
  markdown: { label: 'Markdown', mime: 'text/markdown' },
  csv: { label: 'CSV', mime: 'text/csv' },
  json: { label: 'JSON', mime: 'application/json' },
  docx: { label: 'Word', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xlsx: { label: 'Excel', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  png: { label: 'PNG', mime: 'image/png' },
  jpg: { label: 'JPG', mime: 'image/jpeg' },
  jpeg: { label: 'JPG', mime: 'image/jpeg' },
  gif: { label: 'GIF', mime: 'image/gif' },
  webp: { label: 'WebP', mime: 'image/webp' },
});

/** Every content type an upload may carry (the token's allow-list). */
const ACCEPTED_MIME_TYPES = Object.freeze([...new Set(Object.values(ACCEPTED).map((t) => t.mime))]);

/** For the file picker's `accept` attribute. */
const ACCEPT_ATTRIBUTE = Object.keys(ACCEPTED).map((ext) => `.${ext}`).join(',');

function fileExtension(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || '').trim());
  return match ? match[1].toLowerCase() : '';
}

/** The accepted type for a file name, or null. */
function contextFileType(name) {
  const ext = fileExtension(name);
  return (ext && Object.prototype.hasOwnProperty.call(ACCEPTED, ext)) ? { ext, ...ACCEPTED[ext] } : null;
}

/** "20 MB", "340 KB", "12 bytes". 1 MB = 1024 × 1024 bytes. */
function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} byte${n === 1 ? '' : 's'}`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  const shown = mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb);
  return `${shown} MB`;
}

/**
 * May this file be uploaded? `{ ok: true, type }` or `{ ok: false, message }`,
 * where the message names the type or the size that was refused.
 */
function checkContextFile({ name, size } = {}) {
  const type = contextFileType(name);
  if (!type) {
    const ext = fileExtension(name);
    return {
      ok: false,
      message: ext
        ? `This file type is not accepted: .${ext}`
        : 'This file type is not accepted: the file has no extension (for example .pdf), so its type cannot be told.',
    };
  }
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { ok: false, message: `This file is empty, so there is nothing to upload: ${String(name || '').trim()}` };
  }
  if (bytes > MAX_FILE_BYTES) {
    return {
      ok: false,
      message: `This file is ${formatFileSize(bytes)}, and the limit is ${formatFileSize(MAX_FILE_BYTES)}.`,
    };
  }
  return { ok: true, type };
}

/**
 * The folder a project's context files live in. Every file in it belongs to
 * that project; the server refuses a token or a record for any other folder,
 * which is what keeps one project from recording (and later deleting) another
 * project's file.
 */
function contextFolder(projectId) {
  const seg = String(projectId || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return seg ? `APP/Assets/Context/${seg}/` : '';
}

/** A file name made safe for a storage path, keeping its extension. */
function safeStorageName(name) {
  const cleaned = String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[_.]+|_+$/g, '');
  return cleaned || 'file';
}

/** Where the page asks to put a file: `<folder><time>_<name>`. */
function contextStoragePath(projectId, name, now = Date.now()) {
  const folder = contextFolder(projectId);
  if (!folder) return '';
  return `${folder}${now}_${safeStorageName(name)}`;
}

/**
 * Is this address one of this project's stored context files? Only Vercel
 * Blob addresses inside the project's own folder qualify.
 */
function isContextFileUrl(url, projectId) {
  const folder = contextFolder(projectId);
  if (!folder) return false;
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch (_) {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (!/\.blob\.vercel-storage\.com$/i.test(parsed.hostname)) return false;
  let path;
  try {
    path = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
  } catch (_) {
    return false;
  }
  if (path.includes('..')) return false;
  return path.startsWith(folder) && path.length > folder.length;
}

module.exports = {
  MAX_FILE_BYTES,
  ACCEPTED,
  ACCEPTED_MIME_TYPES,
  ACCEPT_ATTRIBUTE,
  fileExtension,
  contextFileType,
  formatFileSize,
  checkContextFile,
  contextFolder,
  contextStoragePath,
  isContextFileUrl,
};
