'use strict';

/**
 * Which tools may be switched on to read a Context entry (ticket SC-826).
 *
 * A Context entry carries `used_by`, a list of the tools that read it. The
 * list of tools is HERE and nowhere else: the page draws one switch per use
 * from it, the store refuses any value not in it, and a tool asks for its
 * notes by naming one of these ids (lib/contextFor.js). Free text is never
 * accepted, so a typo can never switch a note on for a tool that does not
 * exist, and a renamed tool cannot silently stop reading its notes.
 *
 * Shared by the browser (components/context/context-manager.tsx) and the
 * server, the way lib/contextFileTypes.js is, so it requires nothing.
 */

const CONTEXT_USES = Object.freeze([
  Object.freeze({
    id: 'reel-spinner',
    label: 'Reel Spinner reads this',
    tool: 'Reel Spinner',
  }),
]);

const USE_IDS = Object.freeze(CONTEXT_USES.map((use) => use.id));

/**
 * File kinds a tool can read the words of. Everything else (PDF, Word,
 * Excel, images, CSV, JSON) is listed as unreadable with a reason rather than
 * silently skipped.
 */
const READABLE_FILE_EXTENSIONS = Object.freeze(['txt', 'md', 'markdown']);

function useById(id) {
  return CONTEXT_USES.find((use) => use.id === id) || null;
}

/**
 * Check a `usedBy` value sent by a client: an array of known use ids.
 * `{ ok: true, usedBy }` (deduplicated, in CONTEXT_USES order) or
 * `{ ok: false, message }` naming the value that was refused.
 */
function checkUsedBy(value) {
  if (!Array.isArray(value)) return { ok: false, message: 'usedBy must be a list of uses, for example ["reel-spinner"].' };
  const unknown = value.filter((v) => typeof v !== 'string' || !USE_IDS.includes(v));
  if (unknown.length) {
    return {
      ok: false,
      message: `Unknown use ${unknown.map((v) => JSON.stringify(v)).join(', ')}. The uses are: ${USE_IDS.join(', ')}.`,
    };
  }
  return { ok: true, usedBy: USE_IDS.filter((id) => value.includes(id)) };
}

/** What the database holds, as a clean list (a missing column reads as none). */
function normalizeUsedBy(value) {
  return Array.isArray(value) ? USE_IDS.filter((id) => value.includes(id)) : [];
}

function extensionOf(name) {
  const match = /\.([a-z0-9]+)$/i.exec(String(name || '').trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * Can a tool read this entry's words? Notes always; files only when they are
 * plain text or Markdown. `{ readable: true }` or `{ readable: false, reason }`
 * where the reason is a plain sentence for the page and the tool's report.
 */
function entryReadability(entry, toolName = 'This tool') {
  if (!entry || entry.kind !== 'file') return { readable: true };
  const ext = extensionOf(entry.fileName || entry.fileUrl || entry.title);
  if (READABLE_FILE_EXTENSIONS.includes(ext)) return { readable: true };
  const kind = ext ? `.${ext} files` : 'files without an extension';
  return {
    readable: false,
    reason: `${toolName} cannot read ${kind}; it reads notes and .txt or .md files only, so it will skip this one.`,
  };
}

module.exports = {
  CONTEXT_USES,
  USE_IDS,
  READABLE_FILE_EXTENSIONS,
  useById,
  checkUsedBy,
  normalizeUsedBy,
  entryReadability,
};
