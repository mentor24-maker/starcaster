'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * YouTube outreach 1/7 (86bcda5vb) — the target list and the account limits.
 *
 * The fake database reads its schema FROM docs/SQL/youtube_outreach_setup.sql
 * (scripts/builder/sqlSchemaFake.js), so a column dropped from the SQL fails
 * here rather than quietly disagreeing with the store. The tenant columns
 * matter most: a table with only project_id makes scopedInsertRow stamp
 * NEITHER, and the insert still succeeds (CLAUDE.md landmine 12).
 */

const SQL_PATH = path.join(__dirname, '..', '..', 'docs', 'SQL', 'youtube_outreach_setup.sql');
const { parseSchemaFile, parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/youtubeOutreachStore.js');

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };
const TABLES = ['youtube_outreach_targets', 'youtube_outreach_settings'];

const VIDEO_1 = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const VIDEO_2 = 'https://youtu.be/9bZkp7q19f0';

/** A lookup that answers like YouTube did, without the network. */
async function fakeLookup(videoId) {
  return {
    ok: true,
    data: {
      title: `Video ${videoId}`,
      channelName: 'Some Channel',
      channelId: 'UC123',
      publishedAt: '2026-09-01T12:00:00Z',
      viewCount: 4321,
    },
  };
}

function withDb() {
  const schema = parseSchemaFile(SQL_PATH);
  const db = createFakeDb(schema);
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({
      youtubeOutreachTargets: 'youtube_outreach_targets',
      youtubeOutreachSettings: 'youtube_outreach_settings',
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

async function addTarget(store, input = { videoUrl: VIDEO_1 }, scope = SCOPE_A) {
  const created = await store.createTarget(input, scope, { lookup: fakeLookup });
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
    const columns = parseSchemaFile(SQL_PATH).tables.get('youtube_outreach_targets').columns;
    const pairs = {
      source: 'source', objective: 'objective', commentPlacement: 'comment_placement',
      commentLength: 'comment_length', linkPolicy: 'link_policy', mentionPolicy: 'mention_policy',
      repeatMode: 'repeat_mode', priority: 'priority', status: 'status',
    };
    for (const [field, column] of Object.entries(pairs)) {
      assert.deepEqual([...columns.get(column).allowed].sort(), [...store.CHOICES[field]].sort(), `${field} vs ${column}`);
    }
  } finally {
    restore();
  }
});

// ── Creating a target ───────────────────────────────────────────────────────

test('a target made from just a link stores every approved default and the fetched details', async () => {
  const { db, store, restore } = withDb();
  try {
    const target = await addTarget(store);
    const stored = db.data.get('youtube_outreach_targets')[0];

    assert.equal(stored.video_id, 'dQw4w9WgXcQ');
    assert.equal(stored.video_url, VIDEO_1);
    assert.equal(stored.video_title, 'Video dQw4w9WgXcQ');
    assert.equal(stored.channel_name, 'Some Channel');
    assert.equal(stored.view_count, 4321);
    assert.equal(stored.details_error, '');
    assert.ok(stored.details_fetched_at);

    // Dane's approved defaults, 2026-10-05.
    assert.equal(stored.account_key, 'dane_of_earth');
    assert.equal(stored.source, 'manual');
    assert.equal(stored.objective, 'join_conversation');
    assert.equal(stored.comment_placement, 'top_level');
    assert.deepEqual(stored.message_types, ['insight', 'question']);
    assert.equal(stored.comment_length, 'medium');
    assert.equal(stored.link_policy, 'never');
    assert.equal(stored.mention_policy, 'never');
    assert.equal(stored.repeat_mode, 'once');
    assert.equal(stored.repeat_every_days, null);
    assert.equal(stored.priority, 'normal');
    assert.equal(stored.status, 'active');

    assert.equal(target.videoTitle, 'Video dQw4w9WgXcQ');
    assert.equal(target.channelName, 'Some Channel');
  } finally {
    restore();
  }
});

test('a target READS BACK with project_id AND owner_user_id filled in (landmine 12)', async () => {
  const { db, store, restore } = withDb();
  try {
    const target = await addTarget(store);
    // Do not trust the insert's success — read the stored row itself.
    const stored = db.data.get('youtube_outreach_targets')[0];
    assert.equal(stored.project_id, 'proj_a');
    assert.equal(stored.owner_user_id, 'user_1');
    const readBack = await store.getTargetById(target.id, SCOPE_A);
    assert.equal(readBack.ok, true);
    assert.equal(readBack.data.projectId, 'proj_a');
    assert.equal(readBack.data.ownerUserId, 'user_1');
  } finally {
    restore();
  }
});

test('a YouTube failure still saves the link, and says why the details are blank', async () => {
  const { store, restore } = withDb();
  try {
    const created = await store.createTarget({ videoUrl: VIDEO_1 }, SCOPE_A, {
      lookup: async () => ({ ok: false, error: 'YouTube did not return the video details: quota exceeded' }),
    });
    assert.equal(created.ok, true, created.error);
    assert.equal(created.data.videoTitle, '');
    assert.match(created.data.detailsError, /quota exceeded/);
  } finally {
    restore();
  }
});

test('the same video twice on one account is a 409 naming the video, not a duplicate', async () => {
  const { store, restore } = withDb();
  try {
    await addTarget(store);
    const again = await store.createTarget({ videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }, SCOPE_A, { lookup: fakeLookup });
    assert.equal(again.ok, false);
    assert.equal(again.status, 409);
    assert.match(again.error, /dQw4w9WgXcQ/);
    // Another project may list the same video.
    const other = await store.createTarget({ videoUrl: VIDEO_1 }, SCOPE_B, { lookup: fakeLookup });
    assert.equal(other.ok, true, other.error);
  } finally {
    restore();
  }
});

// ── Refusing bad values, by name ────────────────────────────────────────────

test('invalid values are refused with a message naming the field, and nothing is saved', async () => {
  const { db, store, restore } = withDb();
  try {
    const cases = [
      [{ videoUrl: VIDEO_1, objective: 'go_viral' }, /objective/],
      [{ videoUrl: VIDEO_1, repeatMode: 'repeat', repeatEveryDays: 7, repeatMaxTimes: -2 }, /repeatMaxTimes/],
      [{ videoUrl: VIDEO_1, repeatMode: 'repeat', repeatEveryDays: -1, repeatMaxTimes: 3 }, /repeatEveryDays/],
      [{ videoUrl: VIDEO_1, repeatMode: 'repeat', repeatEveryDays: 2.5, repeatMaxTimes: 3 }, /repeatEveryDays/],
      [{ videoUrl: VIDEO_1, repeatMode: 'repeat', repeatMaxTimes: 3 }, /repeatEveryDays/],
      [{ videoUrl: VIDEO_1, repeatEveryDays: 7 }, /repeatEveryDays is only used/],
      [{ videoUrl: VIDEO_1, messageTypes: ['insight', 'rant'] }, /messageTypes/],
      [{ videoUrl: VIDEO_1, messageTypes: [] }, /messageTypes/],
      [{ videoUrl: VIDEO_1, messageTypes: 'insight' }, /messageTypes/],
      [{ videoUrl: VIDEO_1, commentPlacement: 'reply_specific' }, /replyToCommentId/],
      [{ videoUrl: VIDEO_1, linkPolicy: 'allowed' }, /linkUrl/],
      [{ videoUrl: VIDEO_1, linkPolicy: 'allowed', linkUrl: 'javascript:alert(1)' }, /linkUrl/],
      [{ videoUrl: VIDEO_1, repeatMode: 'repeat', repeatEveryDays: 7, repeatMaxTimes: 3, repeatUntil: '2026-02-30' }, /repeatUntil/],
      [{ videoUrl: VIDEO_1, priority: 'urgent' }, /priority/],
      [{ videoUrl: VIDEO_1, accountKey: 'Dane Of Earth!' }, /accountKey/],
      [{ videoUrl: VIDEO_1, colour: 'blue' }, /Unknown field: colour/],
      [{ videoUrl: 'https://example.com/not-youtube' }, /videoUrl/],
      [{}, /videoUrl/],
    ];
    for (const [input, pattern] of cases) {
      const res = await store.createTarget(input, SCOPE_A, { lookup: fakeLookup });
      assert.equal(res.ok, false, `accepted ${JSON.stringify(input)}`);
      assert.equal(res.status, 400, `${JSON.stringify(input)} → ${res.status}`);
      assert.match(res.error, pattern, `${JSON.stringify(input)} → "${res.error}"`);
    }
    assert.equal((db.data.get('youtube_outreach_targets') || []).length, 0, 'a refused target was saved anyway');
  } finally {
    restore();
  }
});

test('a full repeating target with every setting saves and reads back as given', async () => {
  const { store, restore } = withDb();
  try {
    const target = await addTarget(store, {
      videoUrl: VIDEO_2,
      objective: 'drive_link',
      commentPlacement: 'reply_specific',
      replyToCommentId: 'UgxAbC123',
      messageTypes: ['story', 'mention_work', 'story'],
      commentLength: 'long',
      linkPolicy: 'if_natural',
      linkUrl: 'https://danofearth.com',
      mentionPolicy: 'subtle',
      repeatMode: 'repeat',
      repeatEveryDays: '14',
      repeatMaxTimes: 3,
      repeatUntil: '2026-12-31',
      priority: 'high',
      notes: 'Be kind.',
    });
    assert.equal(target.videoId, '9bZkp7q19f0');
    assert.equal(target.commentPlacement, 'reply_specific');
    assert.equal(target.replyToCommentId, 'UgxAbC123');
    assert.deepEqual(target.messageTypes, ['story', 'mention_work']);
    assert.equal(target.repeatEveryDays, 14);
    assert.equal(target.repeatMaxTimes, 3);
    assert.equal(target.repeatUntil, '2026-12-31');
    assert.equal(target.priority, 'high');
  } finally {
    restore();
  }
});

// ── Updating, pausing, deleting ─────────────────────────────────────────────

test('an update is judged against the whole target, and switching to once clears the repeat', async () => {
  const { store, restore } = withDb();
  try {
    const target = await addTarget(store, {
      videoUrl: VIDEO_1, repeatMode: 'repeat', repeatEveryDays: 7, repeatMaxTimes: 4,
    });

    const half = await store.updateTarget(target.id, { commentPlacement: 'reply_specific' }, SCOPE_A);
    assert.equal(half.ok, false);
    assert.match(half.error, /replyToCommentId/);

    const once = await store.updateTarget(target.id, { repeatMode: 'once' }, SCOPE_A);
    assert.equal(once.ok, true, once.error);
    assert.equal(once.data.repeatEveryDays, null);
    assert.equal(once.data.repeatMaxTimes, null);

    const locked = await store.updateTarget(target.id, { videoUrl: VIDEO_2 }, SCOPE_A);
    assert.equal(locked.ok, false);
    assert.match(locked.error, /videoUrl cannot be changed/);

    const notes = await store.updateTarget(target.id, { notes: 'Mention the tennis clinic.' }, SCOPE_A);
    assert.equal(notes.ok, true, notes.error);
    assert.equal(notes.data.notes, 'Mention the tennis clinic.');
    assert.equal(notes.data.objective, 'join_conversation', 'an unrelated setting changed');
  } finally {
    restore();
  }
});

test('pause and resume move the status, and the list can filter by it', async () => {
  const { store, restore } = withDb();
  try {
    const first = await addTarget(store, { videoUrl: VIDEO_1 });
    await addTarget(store, { videoUrl: VIDEO_2 });
    const paused = await store.setTargetStatus(first.id, 'paused', SCOPE_A);
    assert.equal(paused.ok, true, paused.error);
    assert.equal(paused.data.status, 'paused');

    const active = await store.listTargets(200, SCOPE_A, { status: 'active' });
    assert.deepEqual(active.data.map((t) => t.videoId), ['9bZkp7q19f0']);

    const resumed = await store.setTargetStatus(first.id, 'active', SCOPE_A);
    assert.equal(resumed.data.status, 'active');
    const bogus = await store.setTargetStatus(first.id, 'sleeping', SCOPE_A);
    assert.equal(bogus.ok, false);
    assert.match(bogus.error, /status/);
  } finally {
    restore();
  }
});

test('the list puts high priority first, and delete removes the row', async () => {
  const { db, store, restore } = withDb();
  try {
    const low = await addTarget(store, { videoUrl: VIDEO_1, priority: 'low' });
    await addTarget(store, { videoUrl: VIDEO_2, priority: 'high' });
    const list = await store.listTargets(200, SCOPE_A);
    assert.deepEqual(list.data.map((t) => t.priority), ['high', 'low']);

    const removed = await store.deleteTarget(low.id, SCOPE_A);
    assert.equal(removed.ok, true, removed.error);
    assert.equal(db.data.get('youtube_outreach_targets').length, 1);
    const gone = await store.getTargetById(low.id, SCOPE_A);
    assert.equal(gone.status, 404);
  } finally {
    restore();
  }
});

// ── Tenant isolation ────────────────────────────────────────────────────────

test("one project does not see another's targets: project A cannot list, read, update or delete project B's", async () => {
  const { db, store, restore } = withDb();
  try {
    const mine = await addTarget(store, { videoUrl: VIDEO_1 }, SCOPE_A);
    const theirs = await addTarget(store, { videoUrl: VIDEO_2, notes: 'B private' }, SCOPE_B);

    const listA = await store.listTargets(200, SCOPE_A);
    assert.equal(listA.ok, true);
    assert.deepEqual(listA.data.map((t) => t.id), [mine.id], "project A's list shows project B's target");

    const read = await store.getTargetById(theirs.id, SCOPE_A);
    assert.equal(read.ok, false);
    assert.equal(read.status, 404);

    const update = await store.updateTarget(theirs.id, { notes: 'hijacked' }, SCOPE_A);
    assert.equal(update.ok, false);
    assert.equal(update.status, 404);

    const pause = await store.setTargetStatus(theirs.id, 'paused', SCOPE_A);
    assert.equal(pause.status, 404);

    const del = await store.deleteTarget(theirs.id, SCOPE_A);
    assert.equal(del.ok, false);
    assert.equal(del.status, 404);

    const stored = db.data.get('youtube_outreach_targets').find((row) => row.id === theirs.id);
    assert.ok(stored, "project B's target was deleted by project A");
    assert.equal(stored.notes, 'B private');
    assert.equal(stored.status, 'active');
  } finally {
    restore();
  }
});

test('no project in the scope is a refusal, never every project\'s rows', async () => {
  const { store, restore } = withDb();
  try {
    await addTarget(store, { videoUrl: VIDEO_1 }, SCOPE_A);
    for (const scope of [null, {}, { userId: 'user_1' }]) {
      const list = await store.listTargets(200, scope);
      assert.equal(list.ok, false, `listed with scope ${JSON.stringify(scope)}`);
      assert.equal(list.status, 400);
    }
    const created = await store.createTarget({ videoUrl: VIDEO_2 }, null, { lookup: fakeLookup });
    assert.equal(created.ok, false);
    const settings = await store.getSettings(null);
    assert.equal(settings.ok, false);
  } finally {
    restore();
  }
});

test('a scope in the limit position is refused, not read as "no filter" (DOCTRINE 5.10)', async () => {
  const { store, restore } = withDb();
  try {
    await addTarget(store, { videoUrl: VIDEO_1 }, SCOPE_A);
    const wrong = await store.listTargets(SCOPE_B);
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
    assert.equal(res.data.maxCommentsPerDay, 10);
    assert.equal(res.data.minMinutesBetween, 45);
    assert.equal(res.data.activeStartHour, 8);
    assert.equal(res.data.activeEndHour, 22);
    assert.equal(res.data.oneCommentPerVideo, true);
    assert.deepEqual(res.data.avoidChannels, []);
    assert.deepEqual(res.data.avoidWords, []);
  } finally {
    restore();
  }
});

test('saving settings inserts once, then patches the same row, tenanted', async () => {
  const { db, store, restore } = withDb();
  try {
    const first = await store.saveSettings({ maxCommentsPerDay: 6, avoidWords: ['crypto', ' Crypto ', 'giveaway'] }, SCOPE_A);
    assert.equal(first.ok, true, first.error);
    assert.equal(first.status, 201);
    assert.deepEqual(first.data.avoidWords, ['crypto', 'giveaway']);
    assert.equal(first.data.minMinutesBetween, 45, 'an unsupplied setting lost its default');

    const second = await store.saveSettings({ voice: 'Warm, curious, never salesy.', timeZone: 'America/Denver' }, SCOPE_A);
    assert.equal(second.ok, true, second.error);
    assert.equal(second.status, 200);
    assert.equal(second.data.maxCommentsPerDay, 6, 'the second save reset the first');

    const rows = db.data.get('youtube_outreach_settings');
    assert.equal(rows.length, 1, 'a second save made a second row');
    assert.equal(rows[0].project_id, 'proj_a');
    assert.equal(rows[0].owner_user_id, 'user_1');

    // Project B still sees its own defaults, not A's limits.
    const other = await store.getSettings(SCOPE_B);
    assert.equal(other.data.saved, false);
    assert.equal(other.data.maxCommentsPerDay, 10);
  } finally {
    restore();
  }
});

test('invalid settings are refused by name', async () => {
  const { db, store, restore } = withDb();
  try {
    const cases = [
      [{ maxCommentsPerDay: -1 }, /maxCommentsPerDay/],
      [{ minMinutesBetween: 'soon' }, /minMinutesBetween/],
      [{ activeStartHour: 25 }, /activeStartHour/],
      [{ activeStartHour: 22, activeEndHour: 8 }, /activeStartHour .* earlier/],
      [{ timeZone: 'Mars/Olympus' }, /timeZone/],
      [{ oneCommentPerVideo: 'yes' }, /oneCommentPerVideo/],
      [{ avoidChannels: 'spam' }, /avoidChannels/],
      [{ dailyCap: 3 }, /Unknown field: dailyCap/],
      [{}, /Nothing to save/],
    ];
    for (const [input, pattern] of cases) {
      const res = await store.saveSettings(input, SCOPE_A);
      assert.equal(res.ok, false, `accepted ${JSON.stringify(input)}`);
      assert.equal(res.status, 400);
      assert.match(res.error, pattern, `${JSON.stringify(input)} → "${res.error}"`);
    }
    assert.equal((db.data.get('youtube_outreach_settings') || []).length, 0);
  } finally {
    restore();
  }
});

// ── The route ───────────────────────────────────────────────────────────────

test("a client's own site admin cannot reach the outreach API", () => {
  const { acceptsProjectAdminSession } = require('../../lib/projectAdminApiAuth.js');
  assert.equal(acceptsProjectAdminSession('/api/youtube-outreach/targets', { method: 'GET' }), false);
  assert.equal(acceptsProjectAdminSession('/api/youtube-outreach/settings', { method: 'PUT' }), false);
});

test('the route module is registered with the dispatcher', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'index.js'), 'utf8');
  assert.match(source, /require\('\.\/youtubeOutreach'\)/);
  assert.match(source, /^\s+youtubeOutreach,$/m);
});
