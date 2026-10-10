'use strict';

/**
 * Substack Miner — the header's counts in one call (Substack Miner 7/7, task
 * 86bcfprya): is the Substack push working?
 *
 *   found       every writer found for the project
 *   approved    writers Dane approved
 *   rejected    writers Dane rejected
 *   inContacts  writers with a contact behind them
 *   engaged     approved writers with at least one POSTED like, reply or
 *               restack aimed at one of their Notes
 *   subscribed  approved writers whose contact carries
 *               custom_fields.substack_subscribed_at (set by the subscriber
 *               import, lib/acquire/SubstackSubscriberImport.js)
 *
 * WHICH NOTES ARE A WRITER'S. The ticket counts a Note as the writer's when
 * its address is in the writer's `recent_notes` — but that list is filled by
 * Substack Miner 5/7, which is not built yet. So a Note also counts when its
 * address names the writer's handle (`https://substack.com/@<handle>/note/c-…`).
 * The two agree once 5/7 lands; until then the second is the only one that
 * can match anything.
 *
 * A COUNT THAT COULD NOT BE TAKEN IS null, never 0, and `unknown` says why.
 * Zero engaged and "the Notes table could not be read" are different answers,
 * and the screen shows them differently.
 *
 * Every outside dependency comes in through `deps`, so
 * scripts/builder/substackMinerStats.test.js drives it with no database.
 */

const minerStore = require('../substackMinerStore');
const notesStore = require('../substackNotesStore');
const contactsStore = require('../ContactsStore');
const { subscribedAtOf } = require('./SubstackSubscriberImport');

/** The store's own ceiling for one list (lib/storeLimit.js). */
const LIST_LIMIT = 1000;
const CONTACT_LIST_LIMIT = 5000;
/** The kinds aimed at someone else's Note. */
const ENGAGEMENT_KINDS = ['like', 'reply', 'restack'];

/** One spelling for a Note address, so a trailing slash or `www.` is the same Note. */
function noteKey(url) {
  return String(url || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

/** The `@name` a Note address carries, lowercased, or ''. */
function noteHandle(url) {
  const match = noteKey(url).match(/^substack\.com\/@([a-z0-9_.-]+)\/note\//);
  return match ? match[1] : '';
}

function errorOf(res, what) {
  return `${what} could not be read: ${res.error || `status ${res.status}`}`;
}

async function minerStats(scope = null, deps = {}) {
  const store = deps.minerStore || minerStore;
  const notes = deps.notesStore || notesStore;
  const contacts = deps.contactsStore || contactsStore;

  const listed = await store.listCandidates(LIST_LIMIT, scope);
  if (!listed.ok) return listed;
  const candidates = Array.isArray(listed.data) ? listed.data : [];
  const approved = candidates.filter((c) => c.status === 'approved');

  const data = {
    found: candidates.length,
    approved: approved.length,
    rejected: candidates.filter((c) => c.status === 'rejected').length,
    inContacts: candidates.filter((c) => Boolean(c.contactId)).length,
    engaged: null,
    subscribed: null,
    approvedWithContact: approved.filter((c) => Boolean(c.contactId)).length,
    // The counts cover the most recently seen LIST_LIMIT writers only.
    truncated: candidates.length >= LIST_LIMIT,
    unknown: [],
  };

  // Engaged.
  const posted = await notes.listPostedForLimits(LIST_LIMIT, scope);
  if (!posted.ok) {
    data.unknown.push({ count: 'engaged', reason: errorOf(posted, 'The Substack Notes actions') });
  } else {
    const items = (posted.data || []).filter((item) => item.status === 'posted'
      && ENGAGEMENT_KINDS.includes(item.kind) && item.targetUrl);
    const postedKeys = new Set(items.map((item) => noteKey(item.targetUrl)));
    const postedHandles = new Set(items.map((item) => noteHandle(item.targetUrl)).filter(Boolean));
    data.engaged = approved.filter((c) => {
      if (postedHandles.has(String(c.handle || '').toLowerCase())) return true;
      return (c.recentNotes || []).some((note) => postedKeys.has(noteKey(note.url)));
    }).length;
  }

  // Subscribed.
  if (!data.approvedWithContact) {
    // Nothing to look up: no approved writer has a contact to carry the mark.
    data.subscribed = 0;
  } else {
    const people = await contacts.listContacts({ limit: CONTACT_LIST_LIMIT, orderBy: 'created_at', orderDir: 'asc', scope });
    if (!people.ok) {
      data.unknown.push({ count: 'subscribed', reason: errorOf(people, 'The contacts') });
    } else {
      const marked = new Set(
        (Array.isArray(people.data) ? people.data : [])
          .map(contacts.rowToContact)
          .filter((c) => c && subscribedAtOf(c))
          .map((c) => c.id)
      );
      data.subscribed = approved.filter((c) => c.contactId && marked.has(c.contactId)).length;
    }
  }

  return { ok: true, status: 200, data };
}

module.exports = { minerStats, noteKey, noteHandle, ENGAGEMENT_KINDS };
