'use strict';

/**
 * Substack's "Find conversations" stage — Outreach wizard 14/19 (task
 * 86bcrmbqu). The Notes the scheduled read and search found, ranked best first
 * (lib/outreachRanking.js), each with who wrote it and one sentence on why it
 * ranked where it did.
 *
 * WHERE THE NOTES COME FROM. Both scheduled passes keep what they find on the
 * writer's Substack Miner row (`recent_notes`):
 *
 *   - the two-hourly read (lib/acquire/SubstackNotesReadDue.js) keeps each
 *     APPROVED writer's newest Notes, dated, with replies and likes;
 *   - the Mini's six-hourly search (lib/acquire/SubstackNotesSearchDue.js)
 *     keeps the Notes a KEYWORD found, on the writer it found — approved or
 *     not — with `foundBy: 'notes_search'` and no date.
 *
 * A writer Dane rejected is left out, Notes he skipped are left out, and so
 * are Notes he has already replied to or decided a reply for. A reply still
 * waiting as an idea or a draft does NOT hide the Note: it is shown with
 * `replyStatus`, and Write replies picks that item up rather than making a
 * second one.
 *
 * "CANNOT TELL", NEVER "0 FOUND". An empty list is only "nothing new" when the
 * readings behind it are current. An approved writer never read, or not read
 * since the read's own seven-day window plus a day, means a reading did not
 * come back — Substack refused it, or it timed out, or the schedule is not
 * running — and the answer says that, naming the writers, whatever the list
 * holds. Stored readings are the evidence; nothing here keeps a record of its
 * own (landmine 17: an unexplained empty screen reads as a broken one).
 */

const minerStore = require('./substackMinerStore');
const notesStore = require('./substackNotesStore');
const feedbackStore = require('./outreachFeedbackStore');
const ranking = require('./outreachRanking');
const { readCanonDocs } = require('./canonPrompt');

const DAY_MS = 24 * 60 * 60 * 1000;
/** A Note older than this is not a conversation worth joining. */
const FRESH_FOR_MS = 14 * DAY_MS;
/** The read skips a writer for 7 days; past this, a reading is overdue. */
const OVERDUE_DAYS = 8;
const READING_OVERDUE_MS = OVERDUE_DAYS * DAY_MS;
/** What a skipped Note is recorded as in outreach_feedback. */
const SKIP_ITEM_KIND = 'conversation';
/** Reply statuses that are still Dane's to finish — the Note stays listed. */
const OPEN_REPLY_STATUSES = new Set(['idea', 'draft']);
const MAX_LISTED = 50;

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

function text(value, max = 2000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

/**
 * The id a skipped Note is recorded under: its Substack comment id (`c-123`).
 * Not the link — outreach_feedback keeps 120 characters of an id, and a long
 * @handle would push a link past that and make the skip unfindable.
 */
function noteKey(url) {
  const m = String(url || '').match(/\/note\/(c-\d+)/i);
  return m ? m[1].toLowerCase() : text(url, 120);
}

/** "@handle" out of a Note's own link, or ''. */
function authorFromUrl(url) {
  const m = String(url || '').match(/substack\.com\/@([^/?#]+)\/note\//i);
  return m ? m[1] : '';
}

function names(list) {
  const shown = list.slice(0, 3).map((w) => w.name || w.handle);
  const more = list.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ').replace(/, ([^,]*)$/, ' and $1');
}

/**
 * Has every approved writer been read recently enough to trust an empty list?
 * `{ state: 'current' | 'cannot_tell' | 'no_writers', sentence, unread, overdue }`.
 */
function readingVerdict(approved, now) {
  if (!approved.length) {
    return { state: 'no_writers', sentence: 'No writers are approved yet, so there are no Notes to read. Approve writers in the Substack Miner first.', unread: [], overdue: [] };
  }
  const unread = [];
  const overdue = [];
  for (const w of approved) {
    const at = Date.parse(w.lastNotesReadAt || '');
    if (!Number.isFinite(at)) unread.push(w);
    else if (now - at > READING_OVERDUE_MS) overdue.push(w);
  }
  if (!unread.length && !overdue.length) {
    const all = approved.length === 1 ? 'The one approved writer was' : `All ${approved.length} approved writers were`;
    return { state: 'current', sentence: `${all} read in the last ${OVERDUE_DAYS} days.`, unread, overdue };
  }
  const bits = [];
  if (unread.length) bits.push(`${unread.length} approved writer${unread.length === 1 ? ' has' : 's have'} never been read (${names(unread)})`);
  if (overdue.length) bits.push(`${overdue.length} ${overdue.length === 1 ? 'has' : 'have'} not been read for over ${OVERDUE_DAYS} days (${names(overdue)})`);
  return {
    state: 'cannot_tell',
    sentence: `Cannot tell whether there is more to reply to: ${bits.join(', and ')}. The scheduled read runs every two hours; `
      + 'if this stays, Substack refused it or the schedule is not running.',
    unread,
    overdue,
  };
}

/** The Notes found, before ranking: one entry per Note link. */
function collectNotes(candidates, now) {
  const byUrl = new Map();
  for (const w of candidates) {
    if (w.status === 'rejected') continue;
    const approved = w.status === 'approved';
    for (const n of Array.isArray(w.recentNotes) ? w.recentNotes : []) {
      const url = text(n.url, 500);
      if (!url) continue;
      const fromSearch = n.foundBy === 'notes_search';
      // An unapproved writer is listed only for what a keyword found — a
      // writer's own newest Notes are read only once he approves them.
      if (!approved && !fromSearch) continue;
      const when = Date.parse(n.postedAt || n.foundAt || '');
      if (Number.isFinite(when) && now - when > FRESH_FOR_MS) continue;
      const prior = byUrl.get(url);
      const authorHandle = authorFromUrl(url);
      const entry = {
        url,
        text: text(n.text, 1000),
        postedAt: n.postedAt || '',
        foundAt: n.foundAt || '',
        keyword: text(n.keyword, 200) || (prior ? prior.keyword : ''),
        approved,
        replies: n.replies,
        likes: n.likes,
        writer: {
          id: w.id,
          handle: w.handle,
          name: w.name || w.handle,
          status: w.status,
          publicationUrl: w.publicationUrl || `https://${w.handle}.substack.com`,
        },
        author: {
          handle: authorHandle,
          profileUrl: authorHandle ? `https://substack.com/@${authorHandle}` : (w.publicationUrl || `https://${w.handle}.substack.com`),
        },
      };
      // The same Note seen twice (read AND found): keep the richer copy.
      if (!prior || (!prior.postedAt && entry.postedAt)) byUrl.set(url, { ...entry, keyword: entry.keyword || (prior ? prior.keyword : '') });
    }
  }
  return [...byUrl.values()];
}

/**
 * The ranked list for one project. `deps` replaces the stores and the clock
 * (tests). Answers `{ ok, data: { items, newCount, reading, skippedCount } }`;
 * a store that cannot be read is a refusal naming it, never an empty list.
 */
async function listSubstackConversations(scope, deps = {}) {
  const miner = deps.minerStore || minerStore;
  const notes = deps.notesStore || notesStore;
  const feedback = deps.feedbackStore || feedbackStore;
  const now = (deps.now || Date.now)();

  const listed = await miner.listCandidates(1000, scope);
  if (!listed.ok) return { ...listed, error: `The Substack Miner writer list could not be read: ${listed.error}` };
  const candidates = Array.isArray(listed.data) ? listed.data : [];

  const items = await notes.listItems(1000, scope, { accountKey: notes.DEFAULT_ACCOUNT });
  if (!items.ok) return { ...items, error: `The Substack Notes list could not be read: ${items.error}` };
  const skipped = await feedback.listDecidedItemIds({ channel: 'substack', itemKind: SKIP_ITEM_KIND }, scope);
  if (!skipped.ok) return { ...skipped, error: `The Notes you skipped could not be read: ${skipped.error}` };
  const canon = await readCanonDocs(scope, { canonDocs: deps.canonDocs }, 'Not ranked');
  // No canon is not fatal: the ranking loses its canon part and says so.
  const terms = canon.ok ? ranking.canonTerms(canon.data) : [];

  const replyFor = new Map();
  for (const item of Array.isArray(items.data) ? items.data : []) {
    if (item.kind !== 'reply' || !item.targetUrl) continue;
    const prior = replyFor.get(item.targetUrl);
    // An open reply wins over a decided one only if nothing was decided yet.
    if (!prior || !OPEN_REPLY_STATUSES.has(item.status)) replyFor.set(item.targetUrl, item);
  }
  const skippedSet = new Set(skipped.data);

  const fresh = collectNotes(candidates, now).filter((n) => {
    if (skippedSet.has(noteKey(n.url))) return false;
    const reply = replyFor.get(n.url);
    return !reply || OPEN_REPLY_STATUSES.has(reply.status);
  }).map((n) => {
    const reply = replyFor.get(n.url);
    return { ...n, replyItemId: reply ? reply.id : '', replyStatus: reply ? reply.status : '' };
  });

  // Counted BEFORE the cap: 120 found Notes are 120, even though the best 50 are listed.
  const allRanked = ranking.rankConversations(fresh, { terms, now });
  const ranked = allRanked.slice(0, MAX_LISTED);
  const approved = candidates.filter((c) => c.status === 'approved');
  return {
    ok: true,
    status: 200,
    data: {
      items: ranked,
      newCount: allRanked.length,
      reading: readingVerdict(approved, now),
      canon: canon.ok ? { ok: true, words: terms.length } : { ok: false, error: canon.error },
      skippedCount: skippedSet.size,
    },
  };
}

/** Find the Note among the ones listed — Write replies and Skip act on nothing else. */
async function findListed(url, scope, deps) {
  const wanted = notesStore.normalizeNoteUrl(url);
  if (!wanted.ok || !wanted.value) return refuse('url must be the Note\'s own link, ending /note/c-<number>');
  const list = await listSubstackConversations(scope, deps);
  if (!list.ok) return list;
  const hit = list.data.items.find((n) => n.url === wanted.value);
  if (!hit) return refuse('That Note is not on the list any more — it was skipped, replied to, or is over two weeks old. Reload the list.', 404);
  return { ok: true, data: hit };
}

/**
 * Write replies: the reply item for this Note (made now if there is none), with
 * its three options written, ready for the chooser on the Substack Notes
 * screen. A reply already drafted is left as it is.
 */
async function writeRepliesFor(input, scope, deps = {}) {
  const notes = deps.notesStore || notesStore;
  const found = await findListed(input?.url, scope, deps);
  if (!found.ok) return found;
  const note = found.data;
  let itemId = note.replyItemId;
  let created = false;
  if (!itemId) {
    const made = await notes.createItem({ kind: 'reply', source: 'target', targetUrl: note.url, targetText: note.text }, scope);
    if (!made.ok) return { ...made, error: `The reply could not be lined up: ${made.error}` };
    itemId = made.data.id;
    created = true;
  }
  if (note.replyStatus === 'draft') return { ok: true, status: 200, data: { itemId, created, drafted: false, status: 'draft' } };
  const written = await notes.writeDraftForItem(itemId, scope, { generate: deps.generate, canonDocs: deps.canonDocs });
  if (!written.ok) {
    return { ...written, error: `The reply is lined up on the Substack Notes screen, but its options were not written: ${written.error}` };
  }
  return { ok: true, status: 200, data: { itemId, created, drafted: true, status: written.data.status } };
}

/**
 * Skip: record why (or "no reason given") and take the Note off the list.
 * The reason goes where every outreach rejection goes (outreach_feedback), so
 * the reason picker offers it next time.
 */
async function skipConversation(input, scope, deps = {}) {
  const feedback = deps.feedbackStore || feedbackStore;
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const why = feedback.readRejectInput({ reasons: body.reasons, note: body.note });
  if (!why.ok) return why;
  const found = await findListed(body.url, scope, deps);
  if (!found.ok) return found;
  const saved = await feedback.recordFeedback({
    channel: 'substack',
    itemId: noteKey(found.data.url),
    itemKind: SKIP_ITEM_KIND,
    action: 'rejected',
    reasons: why.data.reasons,
    note: why.data.note,
    draftText: found.data.text,
  }, scope);
  if (!saved.ok) return { ...saved, error: `The Note was NOT skipped: ${saved.error}` };
  return { ok: true, status: 200, data: { url: found.data.url, reasons: why.data.reasons } };
}

module.exports = {
  listSubstackConversations,
  writeRepliesFor,
  skipConversation,
  readingVerdict,
  collectNotes,
  noteKey,
  SKIP_ITEM_KIND,
  READING_OVERDUE_MS,
  FRESH_FOR_MS,
};
