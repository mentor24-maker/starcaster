'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

/**
 * Substack Miner 4/7 (86bcfprxq) — approving a writer puts them in Contacts.
 *
 * The writers live in the REAL lib/substackMinerStore.js over the fake database
 * that reads its schema from docs/SQL/substack_miner_setup.sql, so a status
 * move the store refuses is refused here too. Contacts are a small fake that
 * keeps one list PER PROJECT, so "linked the other project's contact" is
 * distinguishable from "linked this one's".
 */

const SQL_PATH = path.join(__dirname, '..', '..', 'docs', 'SQL', 'substack_miner_setup.sql');
const { parseSchemaFile, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/substackMinerStore.js');
const capturePath = require.resolve('../../lib/acquire/SubstackContactCapture.js');

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };

function withDb() {
  const db = createFakeDb(parseSchemaFile(SQL_PATH));
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({
      substackCandidates: 'substack_candidates',
      substackMinerSettings: 'substack_miner_settings',
    }),
    sbQuery: db.sbQuery,
  };
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  delete require.cache[projectScopePath];
  delete require.cache[storePath];
  delete require.cache[capturePath];
  const store = require(storePath);
  const capture = require(capturePath);
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    delete require.cache[projectScopePath];
    delete require.cache[storePath];
    delete require.cache[capturePath];
  }
  return { store, capture, restore };
}

/** Contacts, one list per project. `listContacts` without a scope is refused, as a leak. */
function fakeContacts() {
  const byProject = new Map();
  const calls = { created: 0 };
  const list = (scope) => {
    const key = scope?.projectId;
    if (!byProject.has(key)) byProject.set(key, []);
    return byProject.get(key);
  };
  return {
    calls,
    rows: (scope) => list(scope),
    add: (scope, contact) => list(scope).push({ ...contact }),
    rowToContact: (row) => (row ? { customFields: {}, ...row } : null),
    async listContacts(opts = {}) {
      if (!opts.scope?.projectId) return { ok: false, status: 500, error: 'listContacts called with no project scope' };
      return { ok: true, status: 200, data: list(opts.scope).map((c) => ({ ...c })) };
    },
    async getContact(id, scope) {
      const hit = list(scope).find((c) => c.id === id);
      return hit ? { ok: true, status: 200, data: { ...hit } } : { ok: false, status: 404, error: 'Contact not found' };
    },
    async createContact(contact, scope) {
      if (!scope?.projectId) return { ok: false, status: 500, error: 'createContact called with no project scope' };
      calls.created += 1;
      list(scope).push({ ...contact });
      return { ok: true, status: 201, data: { ...contact } };
    },
  };
}

async function writer(store, input, scope = SCOPE_A) {
  const saved = await store.upsertCandidate(input, scope);
  assert.equal(saved.ok, true, saved.error);
  return saved.data;
}

test('approving makes exactly one contact, shaped the way the ticket says', async () => {
  const { store, capture, restore } = withDb();
  try {
    const contacts = fakeContacts();
    const w = await writer(store, {
      handle: 'kindoftsetsy', name: 'Kind of Tsetsy', description: 'writes about how the Substack algorithm works',
      keywordsHit: ['substack growth', 'notes'], foundVia: 'web_search',
    });
    const res = await capture.approveCandidate(w.id, { status: 'approved' }, SCOPE_A, { contactsStore: contacts });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.status, 'approved');
    assert.equal(res.data.contact.mode, 'created');
    assert.equal(contacts.calls.created, 1);

    const [made] = contacts.rows(SCOPE_A);
    assert.equal(made.source, 'substack_miner');
    assert.equal(made.substack, 'https://kindoftsetsy.substack.com');
    assert.equal(made.website, 'https://kindoftsetsy.substack.com');
    assert.equal(made.contactClass, 'persona');
    assert.equal(made.contactType, 'prospect');
    assert.equal(made.firstName, 'Kind');
    assert.equal(made.lastName, 'of Tsetsy');
    assert.equal(made.customFields.substack_miner_keywords, 'substack growth, notes');
    assert.equal(made.customFields.substack_miner_why_fit, 'writes about how the Substack algorithm works');

    // Read back from the store, not the reply: the contact id is ON the writer.
    const reread = await store.getCandidateById(w.id, SCOPE_A);
    assert.equal(reread.data.contactId, made.id);
    assert.equal(reread.data.status, 'approved');
  } finally {
    restore();
  }
});

test('a second writer with the same publication links the SAME contact', async () => {
  const { store, capture, restore } = withDb();
  try {
    const contacts = fakeContacts();
    const one = await writer(store, { handle: 'samepub', name: 'Same Pub' });
    const two = await writer(store, { handle: 'samepub-alias', publicationUrl: 'https://SamePub.substack.com/', name: 'Alias' });
    const first = await capture.approveCandidate(one.id, { status: 'approved' }, SCOPE_A, { contactsStore: contacts });
    const second = await capture.approveCandidate(two.id, { status: 'approved' }, SCOPE_A, { contactsStore: contacts });
    assert.equal(first.ok && second.ok, true, first.error || second.error);
    assert.equal(contacts.calls.created, 1, 'a second contact was made for the same publication');
    assert.equal(second.data.contact.mode, 'linked');
    assert.equal(second.data.contactId, first.data.contactId);
  } finally {
    restore();
  }
});

test('a contact already in Contacts with that Substack (even in custom_fields) is linked, not duplicated', async () => {
  const { store, capture, restore } = withDb();
  try {
    const contacts = fakeContacts();
    contacts.add(SCOPE_A, { id: 'c_old', firstName: 'Old', substack: '', customFields: { substack: 'http://www.oldpub.substack.com' } });
    const w = await writer(store, { handle: 'oldpub' });
    const res = await capture.approveCandidate(w.id, { status: 'approved' }, SCOPE_A, { contactsStore: contacts });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.contactId, 'c_old');
    assert.equal(contacts.calls.created, 0);
  } finally {
    restore();
  }
});

test("another project's contact with the same Substack is NOT linked", async () => {
  const { store, capture, restore } = withDb();
  try {
    const contacts = fakeContacts();
    contacts.add(SCOPE_B, { id: 'c_other', substack: 'https://shared.substack.com' });
    const w = await writer(store, { handle: 'shared' });
    const res = await capture.approveCandidate(w.id, { status: 'approved' }, SCOPE_A, { contactsStore: contacts });
    assert.equal(res.ok, true, res.error);
    assert.notEqual(res.data.contactId, 'c_other');
    assert.equal(contacts.rows(SCOPE_A).length, 1);
    assert.equal(contacts.rows(SCOPE_B).length, 1);
  } finally {
    restore();
  }
});

test('approving again after a reject re-uses the contact the writer already points at', async () => {
  const { store, capture, restore } = withDb();
  try {
    const contacts = fakeContacts();
    const w = await writer(store, { handle: 'backagain' });
    const first = await capture.approveCandidate(w.id, { status: 'approved' }, SCOPE_A, { contactsStore: contacts });
    assert.equal(first.ok, true, first.error);
    for (const status of ['rejected', 'candidate']) {
      const moved = await store.updateCandidate(w.id, { status }, SCOPE_A);
      assert.equal(moved.ok, true, moved.error);
    }
    const again = await capture.approveCandidate(w.id, { status: 'approved' }, SCOPE_A, { contactsStore: contacts });
    assert.equal(again.ok, true, again.error);
    assert.equal(again.data.contactId, first.data.contactId);
    assert.equal(contacts.calls.created, 1);
  } finally {
    restore();
  }
});

test('a rejected writer cannot jump straight to approved, and no contact is made', async () => {
  const { store, capture, restore } = withDb();
  try {
    const contacts = fakeContacts();
    const w = await writer(store, { handle: 'nope' });
    assert.equal((await store.updateCandidate(w.id, { status: 'rejected' }, SCOPE_A)).ok, true);
    const res = await capture.approveCandidate(w.id, { status: 'approved' }, SCOPE_A, { contactsStore: contacts });
    assert.equal(res.ok, false);
    assert.equal(res.status, 400);
    assert.match(res.error, /cannot move from rejected to approved/);
    assert.equal(contacts.calls.created, 0);
  } finally {
    restore();
  }
});

test('a contact that cannot be made leaves the writer a candidate, and says why', async () => {
  const { store, capture, restore } = withDb();
  try {
    const contacts = fakeContacts();
    contacts.createContact = async () => ({ ok: false, status: 500, error: 'disk full' });
    const w = await writer(store, { handle: 'refused' });
    const res = await capture.approveCandidate(w.id, { status: 'approved' }, SCOPE_A, { contactsStore: contacts });
    assert.equal(res.ok, false);
    assert.match(res.error, /not approved.*disk full/);
    assert.equal((await store.getCandidateById(w.id, SCOPE_A)).data.status, 'candidate');
  } finally {
    restore();
  }
});

test("a writer in another project is not found, and nothing is made", async () => {
  const { store, capture, restore } = withDb();
  try {
    const contacts = fakeContacts();
    const w = await writer(store, { handle: 'elsewhere' }, SCOPE_B);
    const res = await capture.approveCandidate(w.id, { status: 'approved' }, SCOPE_A, { contactsStore: contacts });
    assert.equal(res.ok, false);
    assert.equal(res.status, 404);
    assert.equal(contacts.calls.created, 0);
  } finally {
    restore();
  }
});

test('a note travels with the approve; anything else is refused by name', async () => {
  const { store, capture, restore } = withDb();
  try {
    const contacts = fakeContacts();
    const w = await writer(store, { handle: 'noted' });
    const bad = await capture.approveCandidate(w.id, { status: 'approved', name: 'x' }, SCOPE_A, { contactsStore: contacts });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /name/);
    const res = await capture.approveCandidate(w.id, { status: 'approved', note: 'great on Notes' }, SCOPE_A, { contactsStore: contacts });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.note, 'great on Notes');
    assert.match(contacts.rows(SCOPE_A)[0].notes, /Note: great on Notes/);
  } finally {
    restore();
  }
});

test('publicationKey treats case, scheme, www and a trailing slash as one address', () => {
  const { capture, restore } = withDb();
  try {
    const key = capture.publicationKey;
    assert.equal(key('https://Name.substack.com/'), 'name.substack.com');
    assert.equal(key('http://www.name.substack.com'), 'name.substack.com');
    assert.equal(key('name.substack.com'), 'name.substack.com');
    assert.equal(key(''), '');
  } finally {
    restore();
  }
});
