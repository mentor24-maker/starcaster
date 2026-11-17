'use strict';

/**
 * readContextFor({ projectId, use }) — the Context notes one tool is switched
 * on to read, as plain text (ticket SC-826, Reel Spinner 2a).
 *
 * Reel Spinner's scoring (2c, 2d) calls this and nothing else to learn what
 * the channel is for. It returns the `{ ok, status, data }` envelope every
 * store here returns (DOCTRINE 5.10); `data` is:
 *
 *   text         every switched-on entry as plain text, oldest first (then by
 *                id), each under a "## <title>" line. '' when none.
 *   fingerprint  a hash of the use and each switched-on entry's id +
 *                updated_at. It changes when an entry is switched on or off,
 *                added, removed, or edited, and not otherwise; a score stores
 *                it, so a note edited later is visible on every score made
 *                under the old wording.
 *   entries      [{ id, title, kind, updatedAt }] for each entry read in.
 *   unreadable   [{ id, title, fileName, reason }] for each switched-on file
 *                whose words could not be read (a PDF, an image, a download
 *                that failed). Named, never silently dropped.
 *   reason       '' when there is text; otherwise a sentence saying why not.
 *
 * NOTHING SWITCHED ON IS AN ANSWER, NOT AN ERROR: ok:true, text '', and a
 * reason. Could not READ (no project, the table or the used_by column absent,
 * the database not answering) is ok:false, so a tool never scores against
 * "no context" when the truth is "could not tell".
 *
 * Scoped by project_id through lib/contextStore.js's listEntries, which
 * filters on the project written out (never the NULL-project compat filter).
 */

const crypto = require('crypto');
const contextStore = require('./contextStore');
const { htmlToText } = require('./contextReadout');
const { isContextFileUrl } = require('./contextFileTypes');
const { USE_IDS, useById, entryReadability } = require('./contextUses');
const { sbQuery } = require('./supabase');

const FETCH_TIMEOUT_MS = 30000;
// A tool's prompt is not the place for a 50MB text file.
const MAX_FILE_TEXT = 200_000;

function fingerprintOf(use, entries) {
  const hash = crypto.createHash('sha256');
  hash.update(`use:${use}\n`);
  for (const e of entries) hash.update(`${e.id}\t${e.updatedAt}\n`);
  return hash.digest('hex').slice(0, 32);
}

function stableOrder(a, b) {
  const ca = String(a.createdAt || '');
  const cb = String(b.createdAt || '');
  if (ca !== cb) return ca < cb ? -1 : 1;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}

async function readFileText(entry, projectId, fetchImpl) {
  if (!isContextFileUrl(entry.fileUrl, projectId)) {
    return { error: 'its address is not one of this project\'s stored context files, so it was not fetched.' };
  }
  try {
    const res = await fetchImpl(entry.fileUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res || !res.ok) return { error: `the download answered ${res ? res.status : 'nothing'}.` };
    const text = String(await res.text());
    if (text.length > MAX_FILE_TEXT) {
      return { error: `it is ${Math.round(text.length / 1000)} thousand characters, over the ${MAX_FILE_TEXT / 1000} thousand a tool reads.` };
    }
    return { text: text.trim() };
  } catch (err) {
    return { error: `could not download it: ${err && err.message ? err.message : String(err)}.` };
  }
}

/** Is used_by in this database? Only a definite "no such column" is false. */
async function usedByColumnPresent() {
  const probe = await sbQuery({ table: contextStore.TABLE, query: 'select=used_by&limit=1' });
  if (probe.ok) return { ok: true };
  const said = String(probe.error || '');
  if (/used_by/.test(said)) {
    return {
      ok: false,
      status: 503,
      error: 'The switches that say which tools read a Context entry are not in this database yet, so nothing was read. '
        + `They are added by ${contextStore.USED_BY_SQL_FILE}.`,
    };
  }
  return { ok: false, status: probe.status || 503, error: `Could not read the Context entries: ${said || 'the database did not say why'}` };
}

async function readContextFor({ projectId, use, fetchImpl = globalThis.fetch } = {}) {
  const pid = String(projectId || '').trim();
  if (!pid) return { ok: false, status: 400, error: 'No project was named, so there is no context to read.' };
  if (!USE_IDS.includes(use)) {
    return { ok: false, status: 400, error: `Unknown use ${JSON.stringify(use)}. The uses are: ${USE_IDS.join(', ')}.` };
  }
  const tool = useById(use).tool;

  const listed = await contextStore.listEntries(2000, { projectId: pid });
  if (!listed.ok) return listed;
  const column = await usedByColumnPresent();
  if (!column.ok) return column;

  // listEntries already filtered on this project; the check here is a second
  // lock, so a store change can never hand one project another's notes.
  const switchedOn = listed.data
    .filter((e) => e.projectId === pid && e.usedBy.includes(use))
    .sort(stableOrder);

  const parts = [];
  const read = [];
  const unreadable = [];
  for (const entry of switchedOn) {
    const readable = entryReadability(entry, tool);
    if (!readable.readable) {
      unreadable.push({ id: entry.id, title: entry.title, fileName: entry.fileName, reason: readable.reason });
      continue;
    }
    let words = '';
    if (entry.kind === 'file') {
      // eslint-disable-next-line no-await-in-loop
      const got = await readFileText(entry, pid, fetchImpl);
      if (got.error) {
        unreadable.push({ id: entry.id, title: entry.title, fileName: entry.fileName, reason: `${tool} could not read this file: ${got.error}` });
        continue;
      }
      const note = htmlToText(entry.bodyHtml);
      words = [note, got.text].filter(Boolean).join('\n\n');
    } else {
      words = htmlToText(entry.bodyHtml);
    }
    parts.push(`## ${entry.title}\n\n${words || '(This entry has no text.)'}`);
    read.push({ id: entry.id, title: entry.title, kind: entry.kind, updatedAt: entry.updatedAt });
  }

  let reason = '';
  if (!switchedOn.length) {
    reason = listed.data.length
      ? `No Context entry in this project is switched on for ${tool}. Switch one on with "${useById(use).label}" on Assets › Context.`
      : `This project has no Context entries, so there is nothing for ${tool} to read.`;
  } else if (!read.length) {
    reason = `Every Context entry switched on for ${tool} is one it cannot read (see unreadable).`;
  }

  return {
    ok: true,
    status: 200,
    data: {
      text: parts.join('\n\n'),
      // Over every switched-on entry, read or not: switching a PDF on or
      // off is still a change in what the tool was told to read.
      fingerprint: fingerprintOf(use, switchedOn),
      entries: read,
      unreadable,
      reason,
    },
  };
}

module.exports = { readContextFor, fingerprintOf };
