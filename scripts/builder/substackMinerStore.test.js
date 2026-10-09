'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Substack Miner 1/7 (86bcfprx5) — the writers found, the keyword settings,
 * and a real `substack` column on every contact.
 *
 * The fake database reads its schema FROM docs/SQL/substack_miner_setup.sql
 * (scripts/builder/sqlSchemaFake.js), so a column dropped from the SQL fails
 * here rather than quietly disagreeing with the store. The tenant columns
 * matter most: a table with only project_id makes scopedInsertRow stamp
 * NEITHER, and the insert still succeeds (CLAUDE.md landmine 12).
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const SQL_PATH = path.join(SQL_DIR, 'substack_miner_setup.sql');
const PEOPLE_SQL_PATH = path.join(SQL_DIR, 'people_add_substack_column.sql');
const { parseSchemaFile, parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/substackMinerStore.js');

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };
const TABLES = ['substack_candidates', 'substack_miner_settings'];

function withDb() {
  const schema = parseSchemaFile(SQL_PATH);
  const db = createFakeDb(schema);
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({
      substackCandidates: 'substack_candidates',
      substackMinerSettings: 'substack_miner_settings',
    }),
    sbQuery: db.sbQuery,
  };
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase,
  };
  // projectScope destructures sbQuery at load AND caches its column probe per
  // table, so it is re-required per test or it answers from the last one.
  delete require.cache[projectScopePath];
  delete require.cache[storePath];
  const projectScope = require(projectScopePath);
  const store = require(storePath);

  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    delete require.cache[projectScopePath];
    delete require.cache[storePath];
  }
  return { db, projectScope, store, restore };
}

async function find(store, input, scope = SCOPE_A) {
  const saved = await store.upsertCandidate(input, scope);
  assert.equal(saved.ok, true, saved.error);
  return saved;
}

async function allRows(store, scope = SCOPE_A) {
  const listed = await store.listCandidates(500, scope);
  assert.equal(listed.ok, true, listed.error);
  return listed.data;
}

// ── The schema ──────────────────────────────────────────────────────────────

test('both tables carry BOTH tenant columns, project_id is text, and RLS is on', () => {
  const schema = parseSchemaFile(SQL_PATH);
  for (const tableName of TABLES) {
    const table = schema.tables.get(tableName);
    assert.ok(table, `${tableName} is missing from the SQL`);
    const projectId = table.columns.get('project_id');
    assert.ok(projectId, `${tableName} has no project_id`);
    assert.ok(table.columns.get('owner_user_id'), `${tableName} has project_id but no owner_user_id — scopedInsertRow would stamp NEITHER`);
    assert.equal(projectId.type, 'text', `${tableName}.project_id must be text, never uuid (DOCTRINE 5.13)`);
    assert.equal(projectId.notNull, true);
    assert.ok(schema.rlsEnabled.has(tableName), `${tableName} does not enable row level security`);
  }
});

test("projectScope's column probe succeeds on both tables", async () => {
  const { projectScope, restore } = withDb();
  try {
    for (const tableName of TABLES) {
      assert.equal(await projectScope.supportsProjectColumns(tableName), true, tableName);
    }
  } finally {
    restore();
  }
});

test('the SQL is idempotent and destroys nothing', () => {
  const sql = fs.readFileSync(SQL_PATH, 'utf8');
  const once = parseSchemaText(sql);
  const twice = parseSchemaText(`${sql}\n${sql}`);
  assert.deepEqual([...twice.tables.keys()], [...once.tables.keys()]);
  assert.deepEqual(twice.indexes.map((i) => i.name), once.indexes.map((i) => i.name));
  for (const statement of once.statements) {
    const normalized = statement.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.startsWith('create')) {
      assert.ok(normalized.includes('if not exists'), `not idempotent: "${normalized.slice(0, 70)}"`);
    }
    assert.ok(!/^(drop|truncate|delete)\b/.test(normalized), `a setup file must not destroy anything: "${normalized.slice(0, 70)}"`);
  }
});

test("the store's choice lists match the SQL's check constraints exactly", () => {
  const { store, restore } = withDb();
  try {
    const columns = parseSchemaFile(SQL_PATH).tables.get('substack_candidates').columns;
    assert.deepEqual([...columns.get('found_via').allowed].sort(), [...store.CHOICES.foundVia].sort());
    assert.deepEqual([...columns.get('status').allowed].sort(), [...store.CHOICES.status].sort());
    assert.deepEqual(Object.keys(store.STATUS_MOVES).sort(), [...store.CHOICES.status].sort());
    for (const next of Object.values(store.STATUS_MOVES)) {
      for (const status of next) assert.ok(store.CHOICES.status.includes(status), status);
    }
  } finally {
    restore();
  }
});

// ── Finding a writer ────────────────────────────────────────────────────────

test('a new writer is added as a candidate, tenanted, with its address filled in (landmine 12)', async () => {
  const { db, store, restore } = withDb();
  try {
    const saved = await find(store, { handle: 'Plainwords', name: 'Plain Words', keywordsHit: ['solopreneur'], foundVia: 'web_search' });
    assert.equal(saved.status, 201);
    assert.equal(saved.data.handle, 'plainwords');
    assert.equal(saved.data.publicationUrl, 'https://plainwords.substack.com');
    assert.equal(saved.data.status, 'candidate');
    assert.equal(saved.data.foundVia, 'web_search');
    assert.deepEqual(saved.data.keywordsHit, ['solopreneur']);
    const [row] = db.data.get('substack_candidates');
    assert.equal(row.project_id, 'proj_a', 'the row landed with no tenant');
    assert.equal(row.owner_user_id, 'user_1', 'the row landed with no owner');
  } finally {
    restore();
  }
});

test('a writer posted twice with different keywords reads back ONCE with both keywords', async () => {
  const { store, restore } = withDb();
  try {
    await find(store, { handle: 'plainwords', keywordsHit: ['solopreneur'], foundVia: 'web_search' });
    const second = await find(store, {
      publicationUrl: 'https://plainwords.substack.com/',
      keywordsHit: ['indie video', 'SOLOPRENEUR'],
      recommendedBy: ['https://other.substack.com'],
      foundVia: 'recommendations',
      subscriberText: '2,400 subscribers',
    });
    assert.equal(second.status, 200, 'a second find must merge, not add');
    const rows = await allRows(store);
    assert.equal(rows.length, 1, 'the same writer was stored twice');
    assert.deepEqual(rows[0].keywordsHit, ['solopreneur', 'indie video']);
    assert.deepEqual(rows[0].recommendedBy, ['other']);
    assert.equal(rows[0].foundVia, 'web_search', 'found_via keeps how it was FIRST found');
    assert.equal(rows[0].subscriberText, '2,400 subscribers', 'a new non-blank detail is taken');
  } finally {
    restore();
  }
});

test('a blank detail on a later find does not wipe one already known', async () => {
  const { store, restore } = withDb();
  try {
    await find(store, { handle: 'plainwords', name: 'Plain Words', description: 'Essays on making things.' });
    await find(store, { handle: 'plainwords', name: '', keywordsHit: ['craft'] });
    const [row] = await allRows(store);
    assert.equal(row.name, 'Plain Words');
    assert.equal(row.description, 'Essays on making things.');
  } finally {
    restore();
  }
});

test('an APPROVED writer is not downgraded by a later find, and Dane\'s note and contact survive it', async () => {
  const { store, restore } = withDb();
  try {
    const first = await find(store, { handle: 'plainwords', keywordsHit: ['solopreneur'] });
    const approved = await store.updateCandidate(first.data.id, { status: 'approved', note: 'Great fit', contactId: 'contact_123' }, SCOPE_A);
    assert.equal(approved.ok, true, approved.error);
    await find(store, { handle: 'plainwords', keywordsHit: ['craft'], foundVia: 'notes_search' });
    const [row] = await allRows(store);
    assert.equal(row.status, 'approved', 'a search downgraded an approved writer');
    assert.equal(row.note, 'Great fit');
    assert.equal(row.contactId, 'contact_123');
    assert.deepEqual(row.keywordsHit, ['solopreneur', 'craft']);
  } finally {
    restore();
  }
});

test('a REJECTED writer stays rejected when a search finds them again', async () => {
  const { store, restore } = withDb();
  try {
    const first = await find(store, { handle: 'plainwords' });
    await store.updateCandidate(first.data.id, { status: 'rejected' }, SCOPE_A);
    await find(store, { handle: 'plainwords', keywordsHit: ['craft'] });
    const [row] = await allRows(store);
    assert.equal(row.status, 'rejected');
  } finally {
    restore();
  }
});

test('a find cannot carry Dane\'s decision', async () => {
  const { store, restore } = withDb();
  try {
    for (const field of ['status', 'note', 'contactId']) {
      const res = await store.upsertCandidate({ handle: 'plainwords', [field]: 'approved' }, SCOPE_A);
      assert.equal(res.ok, false, field);
      assert.equal(res.status, 400);
      assert.match(res.error, /Dane's decision/);
    }
    assert.equal((await allRows(store)).length, 0);
  } finally {
    restore();
  }
});

test('the handle is read from an address, an @name or the bare word, and refused when it names something else', async () => {
  const { store, restore } = withDb();
  try {
    for (const [input, expected] of [
      ['plainwords', 'plainwords'],
      ['@PlainWords', 'plainwords'],
      ['plainwords.substack.com', 'plainwords'],
      ['https://plainwords.substack.com/p/some-post', 'plainwords'],
      ['https://www.plainwords.substack.com', 'plainwords'],
    ]) {
      const read = store.handleOrError(input);
      assert.equal(read.ok, true, `${input}: ${read.error}`);
      assert.equal(read.value, expected, input);
    }
    for (const [input, reason] of [
      ['https://substack.com/@someone', /profile link/],
      ['https://www.lennysnewsletter.com', /not a substack\.com address/],
      ['plain words', /not a Substack handle/],
      ['-dash', /not a Substack handle/],
      ['', /required/],
    ]) {
      const read = store.handleOrError(input);
      assert.equal(read.ok, false, input);
      assert.match(read.error, reason, input);
    }
    // A custom domain is fine as the ADDRESS as long as the handle is given.
    const custom = await find(store, { handle: 'lenny', publicationUrl: 'https://www.lennysnewsletter.com' });
    assert.equal(custom.data.publicationUrl, 'https://www.lennysnewsletter.com');
    const noHandle = await store.upsertCandidate({ publicationUrl: 'https://www.lennysnewsletter.com' }, SCOPE_A);
    assert.equal(noHandle.ok, false);
    assert.match(noHandle.error, /handle is required/);
  } finally {
    restore();
  }
});

// ── Tenancy ─────────────────────────────────────────────────────────────────

test('a request with no project is refused (400), never answered with another project\'s rows', async () => {
  const { store, restore } = withDb();
  try {
    const mine = await find(store, { handle: 'plainwords' });
    await store.saveSettings({ keywords: ['secret'] }, SCOPE_A);
    for (const scope of [null, {}, { projectId: '' }, { userId: 'user_1' }]) {
      const calls = {
        list: await store.listCandidates(200, scope),
        get: await store.getCandidateById(mine.data.id, scope),
        upsert: await store.upsertCandidate({ handle: 'another' }, scope),
        update: await store.updateCandidate(mine.data.id, { note: 'x' }, scope),
        import: await store.importCandidates([{ handle: 'another' }], scope),
        getSettings: await store.getSettings(scope),
        saveSettings: await store.saveSettings({ keywords: ['x'] }, scope),
      };
      for (const [name, res] of Object.entries(calls)) {
        assert.equal(res.ok, false, `${name} answered with no project: ${JSON.stringify(scope)}`);
        assert.equal(res.status, 400, name);
        assert.match(res.error, /No project is selected/, name);
      }
    }
    assert.equal((await allRows(store)).length, 1, 'an unscoped call wrote a row');
  } finally {
    restore();
  }
});

test('another project sees none of this project\'s writers or settings, and one handle can live in both', async () => {
  const { store, restore } = withDb();
  try {
    const mine = await find(store, { handle: 'plainwords', keywordsHit: ['a'] });
    await store.saveSettings({ keywords: ['mine'] }, SCOPE_A);
    assert.deepEqual(await allRows(store, SCOPE_B), []);
    const theirs = await store.getCandidateById(mine.data.id, SCOPE_B);
    assert.equal(theirs.status, 404);
    const patched = await store.updateCandidate(mine.data.id, { status: 'approved' }, SCOPE_B);
    assert.equal(patched.status, 404);
    const settingsB = await store.getSettings(SCOPE_B);
    assert.equal(settingsB.data.saved, false);
    assert.deepEqual(settingsB.data.keywords, []);
    // The same writer found for project B is B's own row, not a merge into A's.
    const forB = await find(store, { handle: 'plainwords', keywordsHit: ['b'] }, SCOPE_B);
    assert.equal(forB.status, 201);
    assert.deepEqual((await allRows(store))[0].keywordsHit, ['a']);
  } finally {
    restore();
  }
});

test('a scope passed where the limit goes is refused, not read as "every project"', async () => {
  const { store, restore } = withDb();
  try {
    const res = await store.listCandidates(SCOPE_A);
    assert.equal(res.ok, false);
    assert.match(res.error, /limit must be a number/);
  } finally {
    restore();
  }
});

// ── Dane's decisions ────────────────────────────────────────────────────────

test('status moves along the path, and every other move is refused by name', async () => {
  const { store, restore } = withDb();
  try {
    const { data } = await find(store, { handle: 'plainwords' });
    const move = (status) => store.updateCandidate(data.id, { status }, SCOPE_A);
    assert.equal((await move('approved')).data.status, 'approved');
    const back = await move('candidate');
    assert.equal(back.ok, false);
    assert.match(back.error, /cannot move from approved to candidate/);
    assert.equal((await move('rejected')).data.status, 'rejected');
    const straightToApproved = await move('approved');
    assert.equal(straightToApproved.ok, false);
    assert.match(straightToApproved.error, /from rejected it can go to candidate/);
    assert.equal((await move('candidate')).data.status, 'candidate');
    assert.equal((await move('rejected')).data.status, 'rejected');
    const bogus = await move('maybe');
    assert.equal(bogus.ok, false);
    assert.match(bogus.error, /status must be one of/);
  } finally {
    restore();
  }
});

test('the handle, how it was found and the lists cannot be changed by an update', async () => {
  const { store, restore } = withDb();
  try {
    const { data } = await find(store, { handle: 'plainwords' });
    for (const field of ['handle', 'foundVia', 'keywordsHit', 'recommendedBy']) {
      const res = await store.updateCandidate(data.id, { [field]: field === 'handle' ? 'other' : [] }, SCOPE_A);
      assert.equal(res.ok, false, field);
      assert.match(res.error, /cannot be changed on a saved writer/, field);
    }
    const typo = await store.updateCandidate(data.id, { notes: 'x' }, SCOPE_A);
    assert.equal(typo.ok, false);
    assert.match(typo.error, /Unknown field: notes/);
  } finally {
    restore();
  }
});

test('the list filters by status and by how a writer was found', async () => {
  const { store, restore } = withDb();
  try {
    const a = await find(store, { handle: 'one', foundVia: 'web_search' });
    await find(store, { handle: 'two', foundVia: 'recommendations' });
    await store.updateCandidate(a.data.id, { status: 'approved' }, SCOPE_A);
    const approved = await store.listCandidates(50, SCOPE_A, { status: 'approved' });
    assert.deepEqual(approved.data.map((row) => row.handle), ['one']);
    const recommended = await store.listCandidates(50, SCOPE_A, { foundVia: 'recommendations' });
    assert.deepEqual(recommended.data.map((row) => row.handle), ['two']);
    const bad = await store.listCandidates(50, SCOPE_A, { status: 'pending' });
    assert.equal(bad.ok, false);
  } finally {
    restore();
  }
});

// ── Importing a seed list ───────────────────────────────────────────────────

test('an import counts what it added, merged and refused, and names every refusal', async () => {
  const { store, restore } = withDb();
  try {
    await find(store, { handle: 'already', keywordsHit: ['old'], foundVia: 'web_search' });
    const res = await store.importCandidates([
      { handle: 'fresh', name: 'Fresh', whyFit: 'Writes about filming alone', keywordsHit: ['solo filming'] },
      { publicationUrl: 'https://already.substack.com', keywordsHit: ['new'] },
      { handle: 'https://substack.com/@person' },
      { handle: 'ok-two', status: 'approved' },
      'not an object',
      { handle: 'fresh', keywordsHit: ['again'] },
    ], SCOPE_A);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.added, 1);
    assert.equal(res.data.merged, 2);
    assert.equal(res.data.refused, 3);
    assert.deepEqual(res.data.refusals.map((r) => r.index), [2, 3, 4]);
    assert.match(res.data.refusals[0].error, /profile link/);
    assert.match(res.data.refusals[1].error, /Unknown field: status/);

    const rows = await allRows(store);
    assert.equal(rows.length, 2);
    const fresh = rows.find((row) => row.handle === 'fresh');
    assert.equal(fresh.foundVia, 'seed');
    assert.equal(fresh.description, 'Writes about filming alone', 'whyFit is kept as the description');
    assert.deepEqual(fresh.keywordsHit, ['solo filming', 'again']);
    const already = rows.find((row) => row.handle === 'already');
    assert.equal(already.foundVia, 'web_search', 'an import does not rewrite how a writer was first found');
    assert.deepEqual(already.keywordsHit, ['old', 'new']);
  } finally {
    restore();
  }
});

test('an import that is not a list, is empty, or is too long is refused whole', async () => {
  const { store, restore } = withDb();
  try {
    assert.match((await store.importCandidates(undefined, SCOPE_A)).error, /must be a list/);
    assert.match((await store.importCandidates([], SCOPE_A)).error, /empty/);
    const tooMany = Array.from({ length: store.MAX_IMPORT_ROWS + 1 }, (_, i) => ({ handle: `w${i}` }));
    assert.match((await store.importCandidates(tooMany, SCOPE_A)).error, /at most/);
    assert.equal((await allRows(store)).length, 0);
  } finally {
    restore();
  }
});

// ── Settings ────────────────────────────────────────────────────────────────

test('settings read as the defaults until saved, then save, patch and refuse bad values', async () => {
  const { db, store, restore } = withDb();
  try {
    const before = await store.getSettings(SCOPE_A);
    assert.equal(before.ok, true, before.error);
    assert.deepEqual(before.data.keywords, []);
    assert.equal(before.data.maxResultsPerKeyword, 20);
    assert.equal(before.data.pauseMsBetweenFetches, 1500);
    assert.equal(before.data.saved, false);

    const first = await store.saveSettings({ keywords: ['solopreneur', ' Solopreneur ', 'indie video', ''] }, SCOPE_A);
    assert.equal(first.status, 201, first.error);
    assert.deepEqual(first.data.keywords, ['solopreneur', 'indie video']);
    assert.equal(first.data.maxResultsPerKeyword, 20);

    const second = await store.saveSettings({ maxResultsPerKeyword: 40 }, SCOPE_A);
    assert.equal(second.status, 200, second.error);
    assert.deepEqual(second.data.keywords, ['solopreneur', 'indie video'], 'a partial save kept the keywords');
    assert.equal(db.data.get('substack_miner_settings').length, 1);
    assert.equal(db.data.get('substack_miner_settings')[0].project_id, 'proj_a');

    for (const [input, reason] of [
      [{ maxResultsPerKeyword: 0 }, /between 1 and 100/],
      [{ maxResultsPerKeyword: 2.5 }, /whole number/],
      [{ pauseMsBetweenFetches: -1 }, /between 0 and 60000/],
      [{ keywords: 'solopreneur' }, /must be a list/],
      [{ keyword: ['x'] }, /Unknown field/],
      [{}, /Nothing to save/],
    ]) {
      const res = await store.saveSettings(input, SCOPE_A);
      assert.equal(res.ok, false, JSON.stringify(input));
      assert.match(res.error, reason, JSON.stringify(input));
    }
  } finally {
    restore();
  }
});

// ── people.substack ─────────────────────────────────────────────────────────

test('people.substack round-trips through the contact shape, and the old custom field still reads', () => {
  const peopleStore = require('../../lib/peopleStore.js');
  const { rowToContact, contactToRow } = require('../../lib/ContactsStore.js');

  // Write: the API's camelCase field becomes the people column.
  assert.equal(peopleStore.personToRow({ substack: ' plainwords ' }).substack, 'plainwords');
  assert.equal(contactToRow({ substack: 'plainwords' }).substack, 'plainwords');
  const { person, membership } = peopleStore.splitIncomingContact({ substack: 'plainwords', notes: 'n' }, contactToRow);
  assert.equal(person.substack, 'plainwords', 'substack must be stored on the person, not the membership');
  assert.equal(membership.substack, undefined);

  // Read: the embedded people row's column comes back out of the Contacts API shape.
  const contact = rowToContact({ id: 'c1', people: { id: 'p1', substack: 'plainwords', custom_fields: { substack: 'stale' } } });
  assert.equal(contact.substack, 'plainwords', 'the column is read first');
  assert.equal(peopleStore.rowToPerson({ id: 'p1', substack: 'plainwords' }).substack, 'plainwords');

  // A row the SQL copy has not reached still shows its Substack from the custom field.
  const legacy = rowToContact({ id: 'c2', people: { id: 'p2', substack: '', custom_fields: { substack: 'https://old.substack.com' } } });
  assert.equal(legacy.substack, 'https://old.substack.com');
  // And a database that has not had the column added at all reads the same way.
  const noColumn = rowToContact({ id: 'c3', custom_fields: { substack: 'older' } });
  assert.equal(noColumn.substack, 'older');
  assert.equal(rowToContact({ id: 'c4' }).substack, '');
});

test('nothing writes the substack column unless a caller actually sent one (deploy-order guard)', () => {
  const peopleStore = require('../../lib/peopleStore.js');
  const { contactToRow } = require('../../lib/ContactsStore.js');
  const { CONTACT_CREATE_SCHEMA } = require('../../routes/contacts.js');
  // Until docs/SQL/people_add_substack_column.sql runs, the column does not
  // exist, and a write naming it is refused — so a default here would refuse
  // EVERY new contact.
  assert.ok(CONTACT_CREATE_SCHEMA.substack, 'substack is not accepted on create');
  assert.equal(CONTACT_CREATE_SCHEMA.substack.default, undefined, 'a default writes substack on every create');
  assert.equal('substack' in contactToRow({ firstName: 'A' }), false);
  assert.equal('substack' in peopleStore.personToRow({ firstName: 'A' }), false);
  assert.equal('substack' in peopleStore.personRowFromContactRow({ first_name: 'A' }), false);
  assert.equal(peopleStore.personRowFromContactRow({ substack: 'plainwords' }).substack, 'plainwords');
});

test('segments read a contact\'s Substack from the column first and the custom field second', () => {
  const { segmentFieldValue } = require('../../routes/contacts.js');
  assert.equal(segmentFieldValue({ substack: 'col', customFields: { substack: 'old' } }, 'substack'), 'col');
  assert.equal(segmentFieldValue({ substack: '', customFields: { substack: 'old' } }, 'substack'), 'old');
  assert.equal(segmentFieldValue({ custom_fields: { substack: 'older' } }, 'substack'), 'older');
  assert.equal(segmentFieldValue({}, 'substack'), '');
  assert.match(segmentFieldValue({ substack: 'col', youtube: 'yt' }, 'social'), /col/);
});

test('the people migration adds the column, copies only into blanks, and keeps the custom field', () => {
  const sql = fs.readFileSync(PEOPLE_SQL_PATH, 'utf8').replace(/--.*$/gm, '');
  assert.match(sql, /alter table public\.people\s+add column if not exists substack text not null default ''/);
  assert.match(sql, /alter table public\.contacts\s+add column if not exists substack/);
  const updates = sql.match(/update public\.\w+[\s\S]*?;/g) || [];
  assert.equal(updates.length, 2, 'expected one copy for people and one for contacts');
  for (const update of updates) {
    assert.match(update, /set substack = trim\(custom_fields->>'substack'\)/);
    assert.match(update, /where coalesce\(substack, ''\) = ''/, 'the copy must only fill a blank column');
  }
  assert.ok(!/custom_fields\s*-\s*'substack'/.test(sql), 'the migration must not delete the old custom field');
  assert.ok(!/\b(drop|truncate|delete)\b/i.test(sql));

  const architecture = fs.readFileSync(path.join(SQL_DIR, 'people_contacts_architecture_setup.sql'), 'utf8');
  assert.match(architecture, /\n\s+substack\s+text\s+not null default '',/, 'a database built from scratch has the column');
});

test('contact_sources lists substack_miner, beside youtube_miner', () => {
  const seed = fs.readFileSync(path.join(SQL_DIR, 'contacts_options_management_setup.sql'), 'utf8');
  assert.match(seed, /\('youtube_miner', 'YouTube Miner', \d+\),\s*\('substack_miner', 'Substack Miner', \d+\)/);
  const migration = fs.readFileSync(PEOPLE_SQL_PATH, 'utf8');
  assert.match(migration, /insert into public\.contact_sources[\s\S]*'substack_miner', 'Substack Miner'[\s\S]*on conflict \(key\) do nothing/);
});
