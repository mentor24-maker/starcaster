'use strict';

/**
 * Read a `multipart/form-data` request into fields and files (Font Library
 * 1/7 — the first route here that takes a browser FormData upload; every
 * other upload sends base64 inside JSON or goes straight to blob storage).
 *
 * Small on purpose: the whole body is held in memory, which is fine for font
 * files (tens to hundreds of KB) and is all Vercel allows anyway — a function
 * request body is capped at 4.5 MB, so `maxBytes` defaults below that and the
 * refusal says so in words rather than as a dropped connection.
 */

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * The request body as one Buffer.
 *
 * Vercel may have read the stream already and left the bytes on `req.body`
 * (a Buffer, or a string for text-ish types); the local server never does. So
 * use what is there, and only read the stream when nothing is.
 */
function readRawBody(req, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => new Error(
      `The upload is larger than ${Math.round(maxBytes / (1024 * 1024))} MB. Upload fewer files at a time.`
    );
    const ready = req?.body;
    if (Buffer.isBuffer(ready)) return ready.length > maxBytes ? reject(tooLarge()) : resolve(ready);
    if (typeof ready === 'string') {
      const buf = Buffer.from(ready, 'latin1');
      return buf.length > maxBytes ? reject(tooLarge()) : resolve(buf);
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > maxBytes) {
        failed = true;
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on('error', (err) => { if (!failed) reject(err); });
  });
}

function boundaryFrom(contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(contentType || ''));
  return match ? (match[1] || match[2]) : '';
}

function parsePartHeaders(text) {
  const headers = {};
  for (const line of text.split('\r\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return headers;
}

function dispositionParam(disposition, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(disposition || '');
  return match ? match[1] : null;
}

/**
 * @param {Buffer} body
 * @param {string} contentType   the request's Content-Type header
 * @returns {{ ok: true, fields: Record<string, string>, files: Array<{ field: string, fileName: string, mimeType: string, buffer: Buffer }> }
 *          | { ok: false, message: string }}
 */
function parseMultipart(body, contentType) {
  if (!/^multipart\/form-data/i.test(String(contentType || ''))) {
    return { ok: false, message: 'Send the font as a form upload (multipart/form-data).' };
  }
  const boundary = boundaryFrom(contentType);
  if (!boundary) return { ok: false, message: 'The form upload has no boundary, so it cannot be read.' };
  if (!Buffer.isBuffer(body)) return { ok: false, message: 'The form upload was empty.' };

  const delimiter = Buffer.from(`--${boundary}`, 'latin1');
  const fields = {};
  const files = [];

  let pos = body.indexOf(delimiter);
  if (pos < 0) return { ok: false, message: 'The form upload was empty.' };
  while (pos >= 0) {
    let start = pos + delimiter.length;
    // `--boundary--` closes the body.
    if (body.slice(start, start + 2).toString('latin1') === '--') break;
    if (body.slice(start, start + 2).toString('latin1') === '\r\n') start += 2;
    const next = body.indexOf(delimiter, start);
    if (next < 0) return { ok: false, message: 'The form upload was cut off before it ended.' };
    // Each part ends with the CRLF that precedes the next delimiter.
    const part = body.slice(start, next - 2 >= start ? next - 2 : next);
    const split = part.indexOf('\r\n\r\n');
    if (split >= 0) {
      const headers = parsePartHeaders(part.slice(0, split).toString('utf8'));
      const content = part.slice(split + 4);
      const disposition = headers['content-disposition'] || '';
      const name = dispositionParam(disposition, 'name');
      const fileName = dispositionParam(disposition, 'filename');
      if (name !== null) {
        if (fileName !== null) {
          if (fileName || content.length) {
            files.push({
              field: name,
              fileName,
              mimeType: headers['content-type'] || 'application/octet-stream',
              buffer: Buffer.from(content),
            });
          }
        } else {
          fields[name] = content.toString('utf8');
        }
      }
    }
    pos = next;
  }
  return { ok: true, fields, files };
}

module.exports = { DEFAULT_MAX_BYTES, parseMultipart, readRawBody };
