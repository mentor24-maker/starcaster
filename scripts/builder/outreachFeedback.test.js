'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Outreach wizard 12/19 (86bcrmbnw) — WHY Dane rejected a draft, and what he
 * did with one he approved, on all three channels.
 *
 * The fake database reads its schema from the real SQL files, so a tenant
 * column dropped from docs/SQL/outreach_feedback_setup.sql fails here
 * (landmine 12). Drafts are put straight into each channel's table — how they
 * are WRITTEN is those stores' own tests; this file is about the decision.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const FEEDBACK_SQL = 'outreach_feedback_setup.sql';
const { lessonsSql } = require('./outreachLessonsSql.js');
const CHANNEL_SQL = [
  'reddit_comments_setup.sql', 'reddit_comments_posting.sql', 'reddit_comments_browser_read.sql', 'reddit_comments_draft_options.sql',
  'youtube_outreach_setup.sql', 'youtube_outreach_comments_setup.sql', 'youtube_outreach_draft_options.sql',
  'substack_notes_setup.sql', 'substack_notes_draft_options.sql',
];
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const aiPath = require.resolve('../../lib/aiClient.js');
const STORE_PATHS = [
  '../../lib/outreachFeedbackStore.js',
  '../../lib/redditCommentsStore.js',
  '../../lib/youtubeOutreachCommentsStore.js',
  '../../lib/youtubeOutreachStore.js',
  '../../lib/substackNotesStore.js',
  '../../lib/projectScope.js',
  '../../lib/canonStore.js',
].map((p) => require.resolve(p));

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };
const GOOD = 'I lost the thread for most of a year and came back by sitting for two minutes, not twenty.';
const OTHER = 'Two minutes a day did more for me than any app. The length mattered less than not skipping.';
const CANON = [
  { docKey: 'VOICE', title: 'Voice', body: '# Voice\nShort declaratives.', syncedAt: '2026-10-12T23:27:39.644Z' },
  { docKey: 'AIISM-BLOCKLIST', title: 'AIism Blocklist', body: '# AIism Blocklist\n\n## FENCE — never emit\n\n| Entry | Why |\n|---|---|\n| "deceptively simple" | Stock pair. |\n', syncedAt: '2026-10-12T22:47:41.063Z' },
];

function schemaText({ withFeedback = true } = {}) {
  const grant = /\ndo \$\$[\s\S]*?end \$\$;\s*$/i;
  const files = withFeedback ? [...CHANNEL_SQL, FEEDBACK_SQL] : CHANNEL_SQL;
  const lessons = withFeedback ? [lessonsSql(['reddit_comment_items', 'youtube_outreach_comments', 'substack_notes_items'])] : [];
  return [...files.map((file) => fs.readFileSync(path.join(SQL_DIR, file), 'utf8').replace(grant, '\n')), ...lessons].join('\n');
}

function withDb({ withFeedback = true } = {}) {
  const db = createFakeDb(parseSchemaText(schemaText({ withFeedback })));
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({
      redditCommentItems: 'reddit_comment_items',
      youtubeOutreachTargets: 'youtube_outreach_targets',
      youtubeOutreachSettings: 'youtube_outreach_settings',
      youtubeOutreachComments: 'youtube_outreach_comments',
      substackNotesItems: 'substack_notes_items',
      substackNotesSettings: 'substack_notes_settings',
      canonDocuments: 'canon_documents',
    }),
    sbQuery: async (req) => {
      if (req.table === 'canon_documents') return { ok: true, status: 200, data: [] };
      return db.sbQuery(req);
    },
  };
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  // Every fifth decision asks the AI to refresh the lessons (13/19); in a test
  // that must never be a real, paid call.
  const realAi = require.cache[aiPath];
  require.cache[aiPath] = { id: aiPath, filename: aiPath, loaded: true, exports: { queryAnthropic: async () => ({ ok: false, error: 'no AI in tests' }) } };
  for (const p of STORE_PATHS) delete require.cache[p];
  const [feedback, reddit, youtube, , substack] = STORE_PATHS.map((p) => require(p));
  function restore() {
    if (realAi) require.cache[aiPath] = realAi;
    else delete require.cache[aiPath];
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of STORE_PATHS) delete require.cache[p];
  }
  return { db, feedback, reddit, youtube, substack, restore };
}

async function insert(db, table, row) {
  const res = await db.sbQuery({ method: 'POST', table, query: 'select=*', headers: { Prefer: 'return=representation' }, body: [row] });
  assert.equal(res.ok, true, res.error);
  return Array.isArray(res.data) ? res.data[0] : res.data;
}

async function feedbackRows(db, scope = SCOPE_A) {
  const res = await db.sbQuery({ table: 'outreach_feedback', query: `project_id=eq.${scope.projectId}&select=*` });
  assert.equal(res.ok, true, res.error);
  return res.data;
}

const OPTIONS = [{ angle: 'a', text: GOOD }, { angle: 'b', text: OTHER }];

function redditDraft(db, scope = SCOPE_A) {
  return insert(db, 'reddit_comment_items', {
    project_id: scope.projectId,
    owner_user_id: scope.userId,
    target_url: 'https://www.reddit.com/r/Meditation/comments/1abc2de/x/',
    post_id: '1abc2de',
    status: 'draft',
    draft_text: GOOD,
    draft_options: OPTIONS,
  });
}

// ── Reading a Reject ──────────────────────────────────────────────────────

test('readRejectInput: no body is Skip; reasons are cleaned, de-duplicated and bounded', () => {
  const { feedback, restore } = withDb();
  try {
    assert.deepEqual(feedback.readRejectInput(undefined).data, { reasons: [], note: '' });
    assert.deepEqual(feedback.readRejectInput({}).data, { reasons: [], note: '' });
    assert.deepEqual(
      feedback.readRejectInput({ reasons: [' Too  salesy ', 'too salesy', '', 'not my voice'], note: '  Sounds like an ad. ' }).data,
      { reasons: ['Too salesy', 'not my voice'], note: 'Sounds like an ad.' },
    );
    assert.match(feedback.readRejectInput({ reasons: 'too salesy' }).error, /must be a list/);
    assert.match(feedback.readRejectInput({ reasons: ['x'.repeat(81)] }).error, /80 characters at most/);
    assert.match(feedback.readRejectInput({ why: 'x' }).error, /Unknown field: why/);
    assert.match(feedback.readRejectInput({ note: 5 }).error, /note must be a sentence/);
  } finally {
    restore();
  }
});

test('approvalAction tells an unchanged pick, an unchanged draft and an edit apart', () => {
  const { feedback, restore } = withDb();
  try {
    assert.equal(feedback.approvalAction({ shown: GOOD, finalText: ` ${GOOD} `, picked: 1 }), 'chose-option');
    assert.equal(feedback.approvalAction({ shown: GOOD, finalText: GOOD, picked: null }), 'approved-as-is');
    assert.equal(feedback.approvalAction({ shown: GOOD, finalText: `${GOOD} Edited.`, picked: 0 }), 'approved-edited');
    assert.equal(feedback.approvalAction({ shown: GOOD, finalText: `${GOOD} Edited.`, picked: null }), 'approved-edited');
  } finally {
    restore();
  }
});

// ── Reddit, end to end ────────────────────────────────────────────────────

test('Reject with one chip lands a row carrying BOTH tenant columns, and the draft is rejected', async () => {
  const { db, reddit, restore } = withDb();
  try {
    const item = await redditDraft(db);
    const rejected = await reddit.rejectItem(item.id, SCOPE_A, { reasons: ['too salesy'] });
    assert.equal(rejected.ok, true, rejected.error);
    assert.equal(rejected.data.status, 'rejected');
    assert.deepEqual(rejected.data.feedback, { recorded: true, error: '' });

    // Read it back — the insert answering ok is not the evidence (landmine 12).
    const rows = await feedbackRows(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].project_id, 'proj_a');
    assert.equal(rows[0].owner_user_id, 'user_1');
    assert.equal(rows[0].channel, 'reddit');
    assert.equal(rows[0].item_id, item.id);
    assert.equal(rows[0].action, 'rejected');
    assert.deepEqual(rows[0].reason_tags, ['too salesy']);
    assert.equal(rows[0].draft_text, GOOD);
    assert.equal(rows[0].final_text, '');
    assert.deepEqual(await feedbackRows(db, SCOPE_B), [], 'another project sees none of it');
  } finally {
    restore();
  }
});

test('Skip records "no reason given"; a bad body refuses BEFORE the draft is touched', async () => {
  const { db, reddit, feedback, restore } = withDb();
  try {
    const item = await redditDraft(db);
    const bad = await reddit.rejectItem(item.id, SCOPE_A, { reasons: 'too salesy' });
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 400);
    assert.equal((await reddit.getItemById(item.id, SCOPE_A)).data.status, 'draft');
    assert.deepEqual(await feedbackRows(db), []);

    const skipped = await reddit.rejectItem(item.id, SCOPE_A);
    assert.equal(skipped.data.feedback.recorded, true);
    const [row] = await feedbackRows(db);
    assert.deepEqual(row.reason_tags, []);
    assert.equal(row.note, '');
    const listed = await feedback.listReasons(SCOPE_A);
    assert.equal(listed.ok, true, listed.error);
    assert.deepEqual(listed.data.saved, []);
  } finally {
    restore();
  }
});

test('approving an edited draft records both texts; an unchanged pick records which option', async () => {
  const { db, reddit, restore } = withDb();
  try {
    const edited = await redditDraft(db);
    const editedText = `${OTHER} And I mean every day.`;
    const approved = await reddit.approveItem(edited.id, { text: editedText, option: 1 }, SCOPE_A, { canonDocs: CANON });
    assert.equal(approved.ok, true, approved.error);
    assert.equal(approved.data.feedback.recorded, true);

    const picked = await redditDraft(db);
    assert.equal((await reddit.approveItem(picked.id, { option: 0 }, SCOPE_A, { canonDocs: CANON })).ok, true);

    const rows = await feedbackRows(db);
    const byItem = Object.fromEntries(rows.map((r) => [r.item_id, r]));
    assert.equal(byItem[edited.id].action, 'approved-edited');
    assert.equal(byItem[edited.id].draft_text, OTHER, 'the words he was shown — the option he picked');
    assert.equal(byItem[edited.id].final_text, editedText);
    assert.equal(byItem[edited.id].chosen_option, 1);
    assert.equal(byItem[edited.id].owner_user_id, 'user_1');
    assert.equal(byItem[picked.id].action, 'chose-option');
    assert.equal(byItem[picked.id].chosen_option, 0);
    assert.equal(byItem[picked.id].final_text, GOOD);
  } finally {
    restore();
  }
});

test('before the SQL has run, the reject still happens and says the reason was NOT saved', async () => {
  const { db, reddit, restore } = withDb({ withFeedback: false });
  try {
    const item = await redditDraft(db);
    const rejected = await reddit.rejectItem(item.id, SCOPE_A, { reasons: ['too long'] });
    assert.equal(rejected.ok, true, rejected.error);
    assert.equal(rejected.data.status, 'rejected');
    assert.equal(rejected.data.feedback.recorded, false);
    assert.match(rejected.data.feedback.error, /outreach_feedback_setup\.sql/);
  } finally {
    restore();
  }
});

// ── The picker's saved reasons ────────────────────────────────────────────

test('listReasons: the five defaults always, then his own reasons, most used first, this project only', async () => {
  const { db, feedback, restore } = withDb();
  try {
    const save = (reasons, scope = SCOPE_A, action = 'rejected') => feedback.recordFeedback({ channel: 'youtube', itemId: 'x', action, reasons }, scope);
    await save(['too salesy', 'Preachy']);
    await save(['preachy ']);
    await save(['wrong audience']);
    await save(['ignored'], SCOPE_A, 'approved-edited');
    await save(['other project'], SCOPE_B);
    const listed = await feedback.listReasons(SCOPE_A);
    assert.equal(listed.ok, true, listed.error);
    assert.deepEqual(listed.data.defaults.map((d) => d.reason), ['too salesy', 'not my voice', 'misses the point', 'too long', 'too generic']);
    assert.equal(listed.data.defaults[0].count, 1);
    // "Preachy" and "preachy " are one reason. Which spelling is shown is the
    // newest one's, and two saves in the same millisecond tie — so the test
    // asks for the merge, not for a spelling the clock decides.
    assert.deepEqual(listed.data.saved.map((r) => [r.reason.toLowerCase(), r.count]), [['preachy', 2], ['wrong audience', 1]]);
    assert.equal((await feedbackRows(db)).length, 4);
  } finally {
    restore();
  }
});

test('recordFeedback refuses without both tenant columns, a known channel, or a known action', async () => {
  const { feedback, restore } = withDb();
  try {
    assert.match((await feedback.recordFeedback({ channel: 'reddit', itemId: 'x', action: 'rejected' }, { projectId: 'proj_a' })).error, /both tenant columns/);
    assert.match((await feedback.recordFeedback({ channel: 'tiktok', itemId: 'x', action: 'rejected' }, SCOPE_A)).error, /channel must be one of/);
    assert.match((await feedback.recordFeedback({ channel: 'reddit', itemId: 'x', action: 'meh' }, SCOPE_A)).error, /action must be one of/);
  } finally {
    restore();
  }
});

// ── YouTube and Substack ──────────────────────────────────────────────────

test('YouTube: Reject with a reason records it against the comment', async () => {
  const { db, youtube, restore } = withDb();
  try {
    const target = await insert(db, 'youtube_outreach_targets', {
      project_id: 'proj_a', owner_user_id: 'user_1', video_url: 'https://www.youtube.com/watch?v=abc', video_id: 'abc', message_types: ['comment'],
    });
    const comment = await insert(db, 'youtube_outreach_comments', {
      project_id: 'proj_a', owner_user_id: 'user_1', target_id: target.id, draft_text: GOOD, status: 'draft',
    });
    const rejected = await youtube.rejectComment(comment.id, SCOPE_A, { reasons: ['not my voice'], note: 'Too chirpy.' });
    assert.equal(rejected.ok, true, rejected.error);
    assert.equal(rejected.data.status, 'rejected');
    assert.equal(rejected.data.feedback.recorded, true);
    const [row] = await feedbackRows(db);
    assert.equal(row.channel, 'youtube');
    assert.equal(row.item_id, comment.id);
    assert.deepEqual(row.reason_tags, ['not my voice']);
    assert.equal(row.note, 'Too chirpy.');
    assert.equal(row.owner_user_id, 'user_1');
  } finally {
    restore();
  }
});

test('Substack: Reject with a reason records it, with the item kind', async () => {
  const { db, substack, restore } = withDb();
  try {
    const item = await insert(db, 'substack_notes_items', {
      project_id: 'proj_a', owner_user_id: 'user_1', kind: 'note', source: 'topic', status: 'draft', draft_text: GOOD,
    });
    const rejected = await substack.rejectItem(item.id, SCOPE_A, { reasons: ['too generic'] });
    assert.equal(rejected.ok, true, rejected.error);
    assert.equal(rejected.data.status, 'rejected');
    assert.equal(rejected.data.feedback.recorded, true);
    const [row] = await feedbackRows(db);
    assert.equal(row.channel, 'substack');
    assert.equal(row.item_kind, 'note');
    assert.deepEqual(row.reason_tags, ['too generic']);
    assert.equal(row.draft_text, GOOD);
  } finally {
    restore();
  }
});

// ── The route ─────────────────────────────────────────────────────────────

test('GET /api/outreach/feedback/reasons answers the picker\'s chips for the signed-in project', async () => {
  const route = require('../../routes/outreach');
  function fakeRes() {
    const res = { statusCode: 0, body: '', headers: {} };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.writeHead = (st, h) => { res.statusCode = st; Object.assign(res.headers, h || {}); };
    res.end = (b) => { res.body = String(b || ''); };
    return res;
  }
  const asked = [];
  const feedback = { listReasons: async (scope) => { asked.push(scope); return { ok: true, status: 200, data: { defaults: [], saved: [{ reason: 'Preachy', count: 2 }] } }; } };
  const req = { headers: {}, projectContext: { project: { id: 'proj_a' } }, authUser: { id: 'user_1' } };

  const ok = fakeRes();
  assert.equal(await route.handle(req, ok, '/api/outreach/feedback/reasons', 'GET', { feedback }), true);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(JSON.parse(ok.body).data.saved, [{ reason: 'Preachy', count: 2 }]);
  assert.deepEqual(asked, [{ projectId: 'proj_a', userId: 'user_1' }]);

  const post = fakeRes();
  await route.handle(req, post, '/api/outreach/feedback/reasons', 'POST', { feedback });
  assert.equal(post.statusCode, 405);
});
