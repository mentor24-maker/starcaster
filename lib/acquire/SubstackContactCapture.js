'use strict';

/**
 * Substack Miner — approving a writer puts them in Contacts (Substack Miner
 * 4/7, task 86bcfprxq).
 *
 * `approveCandidate` is what `PATCH /candidates/:id { status: 'approved' }`
 * runs. It finds the writer, checks the move is allowed, finds or makes ONE
 * contact for their publication, and only then marks the writer approved with
 * that contact's id — so a writer is never shown as approved with no contact
 * behind it. If the contact is made and the last write fails, approving again
 * finds that contact by its Substack address and links it, rather than making
 * a second.
 *
 * The contact is the shape lib/acquire/YoutubeContactCapture.js makes for a
 * YouTube channel owner: name split into first/last where it has two parts,
 * `website` and `substack` = the publication, `source` = `substack_miner`, a
 * `persona` / `prospect`, and the keywords and why-it-fits in custom_fields.
 * Unlike that file, every contact read and write here carries the project
 * scope: a contact in another project with the same Substack is not this
 * project's contact.
 *
 * One contact per publication per project: a contact already holding the
 * same Substack address (or, for an older row, the same address in
 * custom_fields.substack) is linked, never duplicated and never overwritten.
 *
 * Every outside dependency comes in through `deps`, so
 * scripts/builder/substackContactCapture.test.js drives it with no database.
 */

const minerStore = require('../substackMinerStore');
const contactsStore = require('../ContactsStore');

const CONTACT_LIST_LIMIT = 5000;

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

function nextId() {
  return `contact_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * One spelling for a publication address, so `https://Name.substack.com/`,
 * `http://www.name.substack.com` and `name.substack.com` are the same place.
 */
function publicationKey(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  return text
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

/** "Kind of Tsetsy" → Kind / of Tsetsy; a one-word name is all first name. */
function splitName(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { firstName: '', lastName: '' };
  return { firstName: words[0], lastName: words.slice(1).join(' ') };
}

function contactFromCandidate(candidate) {
  const publicationUrl = candidate.publicationUrl || `https://${candidate.handle}.substack.com`;
  const { firstName, lastName } = splitName(candidate.name || candidate.handle);
  const customFields = { substack_handle: candidate.handle };
  if (candidate.keywordsHit.length) customFields.substack_miner_keywords = candidate.keywordsHit.join(', ');
  if (candidate.description) customFields.substack_miner_why_fit = candidate.description;
  const notes = [
    'Approved in the Substack Miner.',
    `Substack: ${publicationUrl}`,
    candidate.note ? `Note: ${candidate.note}` : '',
  ].filter(Boolean);
  return {
    contactType: 'prospect',
    contactClass: 'persona',
    firstName,
    lastName,
    website: publicationUrl,
    substack: publicationUrl,
    source: 'substack_miner',
    status: 'new',
    notes: notes.join('\n'),
    tags: ['substack', 'substack-miner'],
    customFields,
  };
}

function contactSubstack(contact) {
  if (contact.substack) return contact.substack;
  const custom = contact.customFields && typeof contact.customFields === 'object' ? contact.customFields : {};
  return typeof custom.substack === 'string' ? custom.substack : '';
}

/** The contact in this project for this publication, or null. */
async function findContactForPublication(publicationUrl, scope, store) {
  const wanted = publicationKey(publicationUrl);
  const listed = await store.listContacts({ limit: CONTACT_LIST_LIMIT, orderBy: 'created_at', orderDir: 'asc', scope });
  if (!listed.ok) return listed;
  const rows = Array.isArray(listed.data) ? listed.data : [];
  const contacts = rows.map(store.rowToContact).filter(Boolean);
  const hit = contacts.find((c) => publicationKey(contactSubstack(c)) === wanted) || null;
  return { ok: true, status: 200, data: hit };
}

/** The contact a writer already points at, if it is still there. */
async function readLinkedContact(contactId, scope, store) {
  if (!contactId) return { ok: true, status: 200, data: null };
  const found = await store.getContact(contactId, scope);
  if (found.ok) return { ok: true, status: 200, data: store.rowToContact(found.data) };
  if (found.status === 404) return { ok: true, status: 200, data: null };
  return found;
}

function contactSummary(contact) {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
  return { id: contact.id, name: name || contact.company || contact.substack || contact.id, contact };
}

/**
 * Approve a writer and put them in Contacts. `patch` is the PATCH body: its
 * `status` is 'approved'; a `note` alongside it is saved in the same write.
 * The answer is the saved writer plus `contact: { id, name, mode, contact }`,
 * where mode says whether the contact was `created`, or `linked` to one
 * already here.
 */
async function approveCandidate(id, patch, scope = null, deps = {}) {
  const store = deps.minerStore || minerStore;
  const contacts = deps.contactsStore || contactsStore;

  const existing = await store.getCandidateById(id, scope);
  if (!existing.ok) return existing;
  const candidate = existing.data;

  const extra = Object.keys(patch || {}).filter((key) => key !== 'status' && key !== 'note');
  if (extra.length) {
    return refuse(`Approving a writer can carry a note and nothing else — ${extra.join(', ')} must be saved on its own`);
  }

  const from = candidate.status;
  if (from !== 'approved' && !store.STATUS_MOVES[from].includes('approved')) {
    return refuse(`status cannot move from ${from} to approved — from ${from} it can go to ${store.STATUS_MOVES[from].join(', ')}`);
  }

  const forContact = patch && typeof patch.note === 'string' ? { ...candidate, note: patch.note } : candidate;
  const publicationUrl = candidate.publicationUrl || `https://${candidate.handle}.substack.com`;

  let mode = 'linked';
  let contact = null;
  const linked = await readLinkedContact(candidate.contactId, scope, contacts);
  if (!linked.ok) return linked;
  contact = linked.data;

  if (!contact) {
    const found = await findContactForPublication(publicationUrl, scope, contacts);
    if (!found.ok) return found;
    contact = found.data;
  }

  if (!contact) {
    const created = await contacts.createContact({ id: nextId(), ...contactFromCandidate(forContact) }, scope);
    if (!created.ok) {
      return { ...created, error: `The writer was not approved — the contact could not be made: ${created.error || 'the database refused it'}` };
    }
    const row = Array.isArray(created.data) ? created.data[0] : created.data;
    if (!row) return refuse('The writer was not approved — the contact was not made (the database returned no row).', 500);
    contact = contacts.rowToContact(row);
    mode = 'created';
  }

  const update = { status: 'approved', contactId: contact.id };
  if (patch && patch.note !== undefined) update.note = patch.note;
  const saved = await store.updateCandidate(candidate.id, update, scope);
  if (!saved.ok) {
    const made = mode === 'created' ? ` Contact ${contact.id} was made; approving again will link it rather than make a second.` : '';
    return { ...saved, error: `The writer was not marked approved: ${saved.error || 'the database refused it'}.${made}` };
  }
  return { ok: true, status: 200, data: { ...saved.data, contact: { ...contactSummary(contact), mode } } };
}

module.exports = {
  approveCandidate,
  contactFromCandidate,
  publicationKey,
  splitName,
};
