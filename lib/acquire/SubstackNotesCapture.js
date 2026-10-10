'use strict';

/**
 * Substack Miner — an approved writer's newest Notes, lined up for Dane to
 * like or reply to (Substack Miner 5/7, task 86bcfpry0).
 *
 * `captureCandidateNotes` is what `POST /candidates/:id/notes` runs, and what
 * the reading pass (./SubstackNotesReadRun.js) calls for each writer it reads.
 * It:
 *
 *   1. refuses a writer Dane has not approved — finding people is not the same
 *      as engaging them, and only approval says he wants to;
 *   2. stores the Notes on the writer (`recent_notes`, newest first, at most
 *      10) and stamps `last_notes_read_at`;
 *   3. for the NEWEST Note only, makes one `like` and one `reply` item on the
 *      Substack Notes screen (source `target`), each only if this account has
 *      no item of that kind for that Note already — whatever its status. So
 *      reading the same Notes again lines up nothing, and a reply Dane rejected
 *      is not offered to him a second time.
 *
 * Nothing is liked or posted here: the items start as ideas, and the Notes
 * screen and the Mini's poster (Substack Notes 3/7-6/7) own everything after.
 *
 * Every outside dependency comes in through `deps`, so
 * scripts/builder/substackNotesCapture.test.js drives it over the fake database.
 */

const minerStore = require('../substackMinerStore');

/** The two things lined up for the newest Note, in the order they are made. */
const LINED_UP_KINDS = Object.freeze(['like', 'reply']);

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

async function captureCandidateNotes(id, notes, scope = null, deps = {}) {
  const store = deps.minerStore || minerStore;
  const notesStore = deps.notesStore || require('../substackNotesStore');

  const found = await store.getCandidateById(id, scope);
  if (!found.ok) return found;
  const writer = found.data;
  if (writer.status !== 'approved') {
    return refuse(
      `${writer.name || writer.handle} is ${writer.status}, not approved — Notes are only read and lined up for writers Dane has approved.`,
      409
    );
  }

  const recorded = await store.recordRecentNotes(writer.id, notes, scope, { now: deps.now ? deps.now() : undefined });
  if (!recorded.ok) return recorded;
  const sent = recorded.data.notes;
  const newest = sent[0] || null;

  const linedUp = {};
  if (newest) {
    const existing = await notesStore.listItemsForTarget(50, scope, { targetUrl: newest.url });
    if (!existing.ok) return existing;
    for (const kind of LINED_UP_KINDS) {
      const already = existing.data.find((item) => item.kind === kind);
      if (already) {
        linedUp[kind] = { created: false, id: already.id, status: already.status };
        continue;
      }
      const made = await notesStore.createItem({
        kind,
        source: 'target',
        targetUrl: newest.url,
        targetText: newest.text,
      }, scope);
      if (!made.ok) {
        return {
          ...made,
          error: `The Notes were saved, but the ${kind} for the newest one could not be lined up: ${made.error}`,
        };
      }
      linedUp[kind] = { created: true, id: made.data.id, status: made.data.status };
    }
  }

  return {
    ok: true,
    status: 200,
    data: {
      candidate: recorded.data.candidate,
      stored: sent.length,
      newestUrl: newest ? newest.url : '',
      linedUp,
    },
  };
}

module.exports = { captureCandidateNotes, LINED_UP_KINDS };
