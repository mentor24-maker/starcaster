'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Substack Notes 1/7 (86bcet65t) — the actions list and the account settings.
 *
 * The fake database reads its schema FROM docs/SQL/substack_notes_setup.sql
 * (scripts/builder/sqlSchemaFake.js), so a column dropped from the SQL fails
 * here rather than quietly disagreeing with the store. The tenant columns
 * matter most: a table with only project_id makes scopedInsertRow stamp
 * NEITHER, and the insert still succeeds (CLAUDE.md landmine 12).
 */

const SQL_PATH = path.join(__dirname, '..', '..', 'docs', 'SQL', 'substack_notes_setup.sql');
const { parseSchemaFile, parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/substackNotesStore.js');

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };
const TABLES = ['substack_notes_items', 'substack_notes_settings'];

const NOTE_URL = 'https://substack.com/@someone/note/c-12345';
const NOTE_URL_2 = 'https://substack.com/@other/note/c-67890';

function withDb() {
  const schema = parseSchemaFile(SQL_PATH);
  const db = createFakeDb(schema);
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({
      substackNotesItems: 'substack_notes_items',
      substackNotesSettings: 'substack_notes_settings',
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

async function addItem(store, input = { kind: 'note', ideaText: 'Why I stopped scheduling posts' }, scope = SCOPE_A) {
  const created = await store.createItem(input, scope);
  assert.equal(created.ok, true, created.error);
  return created.data;
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
    const schema = parseSchemaFile(SQL_PATH);
    const items = schema.tables.get('substack_notes_items').columns;
    const settings = schema.tables.get('substack_notes_settings').columns;
    assert.deepEqual([...items.get('kind').allowed].sort(), [...store.CHOICES.kind].sort());
    assert.deepEqual([...items.get('source').allowed].sort(), [...store.CHOICES.source].sort());
    assert.deepEqual([...items.get('status').allowed].sort(), [...store.CHOICES.status].sort());
    assert.deepEqual([...settings.get('link_policy').allowed].sort(), [...store.CHOICES.linkPolicy].sort());
    // Every status has a place in the path, and every move lands on a real status.
    assert.deepEqual(Object.keys(store.STATUS_MOVES).sort(), [...store.CHOICES.status].sort());
    for (const next of Object.values(store.STATUS_MOVES)) {
      for (const status of next) assert.ok(store.CHOICES.status.includes(status), status);
    }
  } finally {
    restore();
  }
});

// ── Creating items ──────────────────────────────────────────────────────────

test('each kind saves as an idea with the right source, and READS BACK tenanted (landmine 12)', async () => {
  const { db, store, restore } = withDb();
  try {
    const note = await addItem(store);
    const reply = await addItem(store, { kind: 'reply', targetUrl: NOTE_URL, targetText: 'What do you all use?' });
    const restack = await addItem(store, { kind: 'restack', targetUrl: NOTE_URL_2 });
    const like = await addItem(store, { kind: 'like', targetUrl: `${NOTE_URL}/` });
    const fromVideo = await addItem(store, {
      kind: 'note', source: 'new_content', contentUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', contentTitle: 'New video',
    });

    assert.equal(note.source, 'jotted');
    assert.equal(reply.source, 'target');
    assert.equal(restack.source, 'target');
    assert.equal(like.targetUrl, NOTE_URL, 'a trailing slash should not make a second address for one Note');
    assert.equal(fromVideo.source, 'new_content');
    for (const item of [note, reply, restack, like, fromVideo]) assert.equal(item.status, 'idea');

    // Do not trust the insert's success — read the stored rows themselves.
    const rows = db.data.get('substack_notes_items');
    assert.equal(rows.length, 5);
    for (const row of rows) {
      assert.equal(row.project_id, 'proj_a');
      assert.equal(row.owner_user_id, 'user_1');
      assert.equal(row.account_key, 'dane_of_earth');
    }
    const readBack = await store.getItemById(reply.id, SCOPE_A);
    assert.equal(readBack.ok, true, readBack.error);
    assert.equal(readBack.data.projectId, 'proj_a');
    assert.equal(readBack.data.ownerUserId, 'user_1');
    assert.equal(readBack.data.targetText, 'What do you all use?');
  } finally {
    restore();
  }
});

test('bad kinds, sources and target links are refused by name, and nothing is saved', async () => {
  const { db, store, restore } = withDb();
  try {
    const cases = [
      [{}, /kind is required/],
      [{ kind: 'post', ideaText: 'x' }, /kind must be one of/],
      [{ kind: 'note', source: 'rumour', ideaText: 'x' }, /source must be one of/],
      [{ kind: 'note', source: 'target', targetUrl: NOTE_URL }, /source target does not fit a note/],
      [{ kind: 'reply', source: 'jotted', ideaText: 'x' }, /source jotted does not fit a reply/],
      [{ kind: 'reply' }, /targetUrl is required for a reply/],
      [{ kind: 'like', targetUrl: 'https://example.com/note/c-1' }, /targetUrl must be a link to a Note on substack\.com/],
      [{ kind: 'like', targetUrl: 'http://substack.com/@a/note/c-1' }, /targetUrl must be a link to a Note/],
      [{ kind: 'restack', targetUrl: 'https://substack.com/@someone' }, /not to a Note/],
      [{ kind: 'restack', targetUrl: 'https://someone.substack.com/p/a-post' }, /targetUrl must be a link to a Note on substack\.com/],
      [{ kind: 'reply', targetUrl: 'not a url' }, /targetUrl/],
      [{ kind: 'note', targetUrl: NOTE_URL, ideaText: 'x' }, /source target does not fit|targetUrl is only used/],
      [{ kind: 'note' }, /ideaText is required/],
      [{ kind: 'note', source: 'new_content' }, /contentUrl is required/],
      [{ kind: 'note', source: 'new_content', contentUrl: 'javascript:alert(1)' }, /contentUrl/],
      [{ kind: 'note', ideaText: 'x', accountKey: 'Dane Of Earth!' }, /accountKey/],
      [{ kind: 'note', ideaText: 'x', status: 'approved' }, /Unknown field: status/],
      [{ kind: 'note', ideaText: 'x', colour: 'blue' }, /Unknown field: colour/],
      [{ kind: 'note', ideaText: 42 }, /ideaText must be text/],
    ];
    for (const [input, pattern] of cases) {
      const res = await store.createItem(input, SCOPE_A);
      assert.equal(res.ok, false, `accepted ${JSON.stringify(input)}`);
      assert.equal(res.status, 400, `${JSON.stringify(input)} → ${res.status}`);
      assert.match(res.error, pattern, `${JSON.stringify(input)} → "${res.error}"`);
    }
    assert.equal((db.data.get('substack_notes_items') || []).length, 0, 'a refused item was saved anyway');
  } finally {
    restore();
  }
});

// ── Moving through approval ─────────────────────────────────────────────────

test('a Note walks idea → draft → approved → posting → posted, stamped along the way', async () => {
  const { store, restore } = withDb();
  try {
    const note = await addItem(store);

    const noText = await store.updateItem(note.id, { status: 'draft' }, SCOPE_A);
    assert.equal(noText.ok, false);
    assert.match(noText.error, /draftText is required/);

    const tooEarly = await store.updateItem(note.id, { status: 'approved' }, SCOPE_A);
    assert.equal(tooEarly.ok, false);
    assert.match(tooEarly.error, /cannot be approved with no text/);

    const draft = await store.updateItem(note.id, { status: 'draft', draftText: 'I stopped scheduling. Here is why.' }, SCOPE_A);
    assert.equal(draft.ok, true, draft.error);
    assert.equal(draft.data.status, 'draft');

    const approved = await store.updateItem(note.id, { status: 'approved', finalText: 'I stopped scheduling posts. Here is why.' }, SCOPE_A);
    assert.equal(approved.ok, true, approved.error);
    assert.equal(approved.data.approvedBy, 'user_1');
    assert.ok(approved.data.approvedAt);
    assert.equal(approved.data.finalText, 'I stopped scheduling posts. Here is why.');

    const posting = await store.updateItem(note.id, { status: 'posting' }, SCOPE_A);
    assert.equal(posting.ok, true, posting.error);

    const noProof = await store.updateItem(note.id, { status: 'posted' }, SCOPE_A);
    assert.equal(noProof.ok, false);
    assert.match(noProof.error, /postedUrl is required/);

    const posted = await store.updateItem(note.id, { status: 'posted', postedUrl: 'https://substack.com/@danofearth/note/c-999' }, SCOPE_A);
    assert.equal(posted.ok, true, posted.error);
    assert.ok(posted.data.postedAt);

    const after = await store.updateItem(note.id, { status: 'draft' }, SCOPE_A);
    assert.equal(after.ok, false);
    assert.match(after.error, /from posted it can go to nothing/);
  } finally {
    restore();
  }
});

test('a restack or like is approved straight from idea, and has no draft step', async () => {
  const { store, restore } = withDb();
  try {
    const like = await addItem(store, { kind: 'like', targetUrl: NOTE_URL });
    const draft = await store.updateItem(like.id, { status: 'draft', draftText: 'nice' }, SCOPE_A);
    assert.equal(draft.ok, false);
    assert.match(draft.error, /a like has no text to draft/);

    const approved = await store.updateItem(like.id, { status: 'approved' }, SCOPE_A);
    assert.equal(approved.ok, true, approved.error);
    assert.equal(approved.data.status, 'approved');

    const restack = await addItem(store, { kind: 'restack', targetUrl: NOTE_URL_2 });
    const restacked = await store.updateItem(restack.id, { status: 'approved' }, SCOPE_A);
    assert.equal(restacked.ok, true, restacked.error);
  } finally {
    restore();
  }
});

test('bad status moves are refused by name; reject, retry and think-again work', async () => {
  const { store, restore } = withDb();
  try {
    const note = await addItem(store);
    const cases = [
      [{ status: 'posted', postedUrl: 'https://substack.com/@a/note/c-1' }, /cannot move from idea to posted/],
      [{ status: 'posting' }, /cannot move from idea to posting/],
      [{ status: 'sleeping' }, /status must be one of/],
    ];
    for (const [patch, pattern] of cases) {
      const res = await store.updateItem(note.id, patch, SCOPE_A);
      assert.equal(res.ok, false, `accepted ${JSON.stringify(patch)}`);
      assert.equal(res.status, 400);
      assert.match(res.error, pattern, `${JSON.stringify(patch)} → "${res.error}"`);
    }

    // Locked once saved.
    const locked = await store.updateItem(note.id, { kind: 'reply' }, SCOPE_A);
    assert.equal(locked.ok, false);
    assert.match(locked.error, /kind cannot be changed/);

    // approved → rejected clears the approval; rejected → idea to think again.
    await store.updateItem(note.id, { status: 'draft', draftText: 'A draft.' }, SCOPE_A);
    await store.updateItem(note.id, { status: 'approved' }, SCOPE_A);
    const rejected = await store.updateItem(note.id, { status: 'rejected' }, SCOPE_A);
    assert.equal(rejected.ok, true, rejected.error);
    assert.equal(rejected.data.approvedBy, '');
    assert.equal(rejected.data.approvedAt, null);
    const again = await store.updateItem(note.id, { status: 'idea' }, SCOPE_A);
    assert.equal(again.ok, true, again.error);

    // failed needs a reason, and can be approved again to retry.
    const like = await addItem(store, { kind: 'like', targetUrl: NOTE_URL });
    await store.updateItem(like.id, { status: 'approved' }, SCOPE_A);
    await store.updateItem(like.id, { status: 'posting' }, SCOPE_A);
    const silent = await store.updateItem(like.id, { status: 'failed' }, SCOPE_A);
    assert.equal(silent.ok, false);
    assert.match(silent.error, /error is required/);
    const failed = await store.updateItem(like.id, { status: 'failed', error: 'Substack signed the Mini out' }, SCOPE_A);
    assert.equal(failed.ok, true, failed.error);
    const retry = await store.updateItem(like.id, { status: 'approved' }, SCOPE_A);
    assert.equal(retry.ok, true, retry.error);
  } finally {
    restore();
  }
});

// ── Listing and deleting ────────────────────────────────────────────────────

test('the list filters by kind and status, and delete removes the row', async () => {
  const { db, store, restore } = withDb();
  try {
    const note = await addItem(store);
    const like = await addItem(store, { kind: 'like', targetUrl: NOTE_URL });
    await store.updateItem(like.id, { status: 'approved' }, SCOPE_A);

    const all = await store.listItems(200, SCOPE_A);
    assert.equal(all.ok, true, all.error);
    assert.equal(all.data.length, 2);
    const likes = await store.listItems(200, SCOPE_A, { kind: 'like' });
    assert.deepEqual(likes.data.map((i) => i.id), [like.id]);
    const ideas = await store.listItems(200, SCOPE_A, { status: 'idea' });
    assert.deepEqual(ideas.data.map((i) => i.id), [note.id]);
    const bad = await store.listItems(200, SCOPE_A, { kind: 'post' });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /kind must be one of/);

    const removed = await store.deleteItem(note.id, SCOPE_A);
    assert.equal(removed.ok, true, removed.error);
    assert.equal(db.data.get('substack_notes_items').length, 1);
    const gone = await store.getItemById(note.id, SCOPE_A);
    assert.equal(gone.status, 404);
  } finally {
    restore();
  }
});

// ── Tenant isolation ────────────────────────────────────────────────────────

test("one project does not see another's items: project A cannot list, read, update or delete project B's", async () => {
  const { db, store, restore } = withDb();
  try {
    const mine = await addItem(store, undefined, SCOPE_A);
    const theirs = await addItem(store, { kind: 'note', ideaText: 'B private' }, SCOPE_B);

    const listA = await store.listItems(200, SCOPE_A);
    assert.equal(listA.ok, true);
    assert.deepEqual(listA.data.map((i) => i.id), [mine.id], "project A's list shows project B's item");

    const read = await store.getItemById(theirs.id, SCOPE_A);
    assert.equal(read.ok, false);
    assert.equal(read.status, 404);

    const update = await store.updateItem(theirs.id, { ideaText: 'hijacked' }, SCOPE_A);
    assert.equal(update.ok, false);
    assert.equal(update.status, 404);

    const del = await store.deleteItem(theirs.id, SCOPE_A);
    assert.equal(del.ok, false);
    assert.equal(del.status, 404);

    const stored = db.data.get('substack_notes_items').find((row) => row.id === theirs.id);
    assert.ok(stored, "project B's item was deleted by project A");
    assert.equal(stored.idea_text, 'B private');
    assert.equal(stored.project_id, 'proj_b');
  } finally {
    restore();
  }
});

test('no project in the scope is a refusal, never every project\'s rows', async () => {
  const { store, restore } = withDb();
  try {
    await addItem(store, undefined, SCOPE_A);
    for (const scope of [null, {}, { userId: 'user_1' }]) {
      const list = await store.listItems(200, scope);
      assert.equal(list.ok, false, `listed with scope ${JSON.stringify(scope)}`);
      assert.equal(list.status, 400);
    }
    const created = await store.createItem({ kind: 'note', ideaText: 'x' }, null);
    assert.equal(created.ok, false);
    const settings = await store.getSettings(null);
    assert.equal(settings.ok, false);
    const saved = await store.saveSettings({ maxActionsPerDay: 2 }, null);
    assert.equal(saved.ok, false);
  } finally {
    restore();
  }
});

test('a scope in the limit position is refused, not read as "no filter" (DOCTRINE 5.10)', async () => {
  const { store, restore } = withDb();
  try {
    await addItem(store, undefined, SCOPE_A);
    const wrong = await store.listItems(SCOPE_B);
    assert.equal(wrong.ok, false);
    assert.match(wrong.error, /limit must be a number/);
  } finally {
    restore();
  }
});

// ── Account settings ────────────────────────────────────────────────────────

test('settings read back as the approved defaults before anything is saved', async () => {
  const { store, restore } = withDb();
  try {
    const res = await store.getSettings(SCOPE_A);
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.saved, false);
    assert.equal(res.data.accountKey, 'dane_of_earth');
    assert.equal(res.data.maxActionsPerDay, 3);
    assert.equal(res.data.minMinutesBetween, 90);
    assert.equal(res.data.jitterMinutes, 30);
    assert.equal(res.data.activeStartHour, 8);
    assert.equal(res.data.activeEndHour, 22);
    assert.equal(res.data.linkPolicy, 'if_natural');
    assert.deepEqual(res.data.topics, []);
    assert.deepEqual(res.data.avoidWords, []);
  } finally {
    restore();
  }
});

test('saving settings twice keeps ONE row, tenanted, and the second save keeps the first', async () => {
  const { db, store, restore } = withDb();
  try {
    const first = await store.saveSettings({
      substackUrl: 'https://danofearth.substack.com',
      maxActionsPerDay: 2,
      topics: ['creativity', ' Creativity ', 'AI and art'],
    }, SCOPE_A);
    assert.equal(first.ok, true, first.error);
    assert.equal(first.status, 201);
    assert.deepEqual(first.data.topics, ['creativity', 'AI and art']);
    assert.equal(first.data.minMinutesBetween, 90, 'an unsupplied setting lost its default');

    const second = await store.saveSettings({
      voice: 'Warm, curious, never salesy.',
      timeZone: 'America/Denver',
      youtubeChannelId: 'UC1234567890abcdefghijkl',
      linkPolicy: 'never',
    }, SCOPE_A);
    assert.equal(second.ok, true, second.error);
    assert.equal(second.status, 200);
    assert.equal(second.data.maxActionsPerDay, 2, 'the second save reset the first');
    assert.equal(second.data.substackUrl, 'https://danofearth.substack.com');

    const rows = db.data.get('substack_notes_settings');
    assert.equal(rows.length, 1, 'a second save made a second row');
    assert.equal(rows[0].project_id, 'proj_a');
    assert.equal(rows[0].owner_user_id, 'user_1');
    assert.equal(rows[0].link_policy, 'never');

    // Project B still sees its own defaults, not A's settings.
    const other = await store.getSettings(SCOPE_B);
    assert.equal(other.data.saved, false);
    assert.equal(other.data.maxActionsPerDay, 3);
  } finally {
    restore();
  }
});

test('invalid settings are refused by name', async () => {
  const { db, store, restore } = withDb();
  try {
    const cases = [
      [{ maxActionsPerDay: -1 }, /maxActionsPerDay/],
      [{ minMinutesBetween: 'soon' }, /minMinutesBetween/],
      [{ activeStartHour: 25 }, /activeStartHour/],
      [{ activeStartHour: 22, activeEndHour: 8 }, /activeStartHour .* earlier/],
      [{ timeZone: 'Mars/Olympus' }, /timeZone/],
      [{ substackUrl: 'http://danofearth.substack.com' }, /substackUrl/],
      [{ youtubeChannelId: '@danofearth' }, /youtubeChannelId/],
      [{ linkPolicy: 'always' }, /linkPolicy/],
      [{ topics: 'art' }, /topics/],
      [{ dailyCap: 3 }, /Unknown field: dailyCap/],
      [{}, /Nothing to save/],
    ];
    for (const [input, pattern] of cases) {
      const res = await store.saveSettings(input, SCOPE_A);
      assert.equal(res.ok, false, `accepted ${JSON.stringify(input)}`);
      assert.equal(res.status, 400);
      assert.match(res.error, pattern, `${JSON.stringify(input)} → "${res.error}"`);
    }
    assert.equal((db.data.get('substack_notes_settings') || []).length, 0);
  } finally {
    restore();
  }
});

// ── The route ───────────────────────────────────────────────────────────────

test("a client's own site admin cannot reach the Substack Notes API", () => {
  const { acceptsProjectAdminSession } = require('../../lib/projectAdminApiAuth.js');
  assert.equal(acceptsProjectAdminSession('/api/engage/substack-notes/items', { method: 'GET' }), false);
  assert.equal(acceptsProjectAdminSession('/api/engage/substack-notes/settings', { method: 'PUT' }), false);
});

test('the route module is registered with the dispatcher, ahead of engage', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'index.js'), 'utf8');
  assert.match(source, /require\('\.\/substackNotes'\)/);
  const registry = source.slice(source.indexOf('const ROUTE_MODULES'));
  const mine = registry.search(/^\s+substackNotes,$/m);
  const engage = registry.search(/^\s+engage,$/m);
  assert.ok(mine > 0, 'substackNotes is not in ROUTE_MODULES');
  assert.ok(mine < engage, 'substackNotes must come before engage, which owns the wider /api/engage prefix');
});

test('the route answers its own paths and leaves everything else to other modules', async () => {
  const route = require('../../routes/substackNotes.js');
  assert.equal(await route.handle({}, {}, '/api/engage/reddit/status', 'GET'), false);
  assert.equal(await route.handle({}, {}, '/api/engage/substack-notesy', 'GET'), false);
  assert.deepEqual(route.manifest.prefixes, ['/api/engage/substack-notes']);
});
