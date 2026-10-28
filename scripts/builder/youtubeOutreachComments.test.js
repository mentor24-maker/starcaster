'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * YouTube outreach 4/7 (86bcda661) — drafting a comment per target, and
 * Dane's approve / reject.
 *
 * The fake database reads BOTH setup files (the comments table references the
 * targets table), so a column dropped from either SQL fails here. The AI call
 * and the YouTube read are stand-ins: every test says exactly what the "model"
 * wrote, so a rule check can be shown to catch it.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const TARGETS_SQL = path.join(SQL_DIR, 'youtube_outreach_setup.sql');
const COMMENTS_SQL = path.join(SQL_DIR, 'youtube_outreach_comments_setup.sql');
const OPTIONS_SQL = path.join(SQL_DIR, 'youtube_outreach_draft_options.sql');
const { lessonsSql } = require('./outreachLessonsSql.js');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');
const { withCanon, CANON_DOCS } = require('./canonFixture.js');
const { prepareCanon } = require('../../lib/canonPrompt.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const targetsStorePath = require.resolve('../../lib/youtubeOutreachStore.js');
const commentsStorePath = require.resolve('../../lib/youtubeOutreachCommentsStore.js');
const drafter = require('../../lib/youtubeOutreachDrafter.js');

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };
const VIDEO_1 = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

const GOOD_MEDIUM = 'The bit about practising the serve toss without a racket first finally made it click for me. Does the same drill work for a kick serve?';

/** Both setup files, plus 10/19's option columns unless `withOptions` is false (the database before that SQL has run). */
function schemaText({ withOptions = true } = {}) {
  const base = `${fs.readFileSync(TARGETS_SQL, 'utf8')}\n${fs.readFileSync(COMMENTS_SQL, 'utf8')}`;
  const lessons = lessonsSql(['youtube_outreach_comments']);
  return withOptions ? `${base}\n${fs.readFileSync(OPTIONS_SQL, 'utf8')}\n${lessons}` : `${base}\n${lessons}`;
}

async function fakeLookup(videoId) {
  return {
    ok: true,
    data: { title: `Video ${videoId}`, channelName: 'Some Channel', channelId: 'UC123', publishedAt: '2026-09-01T12:00:00Z', viewCount: 10 },
  };
}

const quietVideo = async () => ({ description: 'A serve lesson.', topComments: [{ author: 'Sam', text: 'Great drill' }], note: '' });

/**
 * A "model" that answers with each of `replies` in turn, recording what it
 * was asked. Since 10/19 a draft is THREE options: a string is that wording
 * for every option asked for (three, or as many as a retry names); an array
 * of strings is those options exactly; an object is the raw answer.
 */
function scripted(...replies) {
  const asked = [];
  const generate = async (system, prompt) => {
    asked.push({ system, prompt });
    const next = replies[Math.min(asked.length - 1, replies.length - 1)];
    if (typeof next === 'string') {
      const wanted = Number((/Write (\d+) new repl/.exec(prompt) || [])[1]) || 3;
      return { ok: true, text: JSON.stringify({ options: Array.from({ length: wanted }, (_, i) => ({ angle: `angle ${i + 1}`, text: next })) }) };
    }
    if (Array.isArray(next)) {
      return { ok: true, text: JSON.stringify({ options: next.map((text, i) => ({ angle: `angle ${i + 1}`, text })) }) };
    }
    return next;
  };
  return { generate, asked };
}

function withDb({ withOptions = true } = {}) {
  const schema = parseSchemaText(schemaText({ withOptions }));
  const db = createFakeDb(schema);
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({
      youtubeOutreachTargets: 'youtube_outreach_targets',
      youtubeOutreachSettings: 'youtube_outreach_settings',
      youtubeOutreachComments: 'youtube_outreach_comments',
    }),
    sbQuery: withCanon(db.sbQuery),
  };
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  for (const p of [projectScopePath, targetsStorePath, commentsStorePath]) delete require.cache[p];
  const projectScope = require(projectScopePath);
  const targets = require(targetsStorePath);
  const comments = require(commentsStorePath);

  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of [projectScopePath, targetsStorePath, commentsStorePath]) delete require.cache[p];
  }
  return { db, projectScope, targets, comments, restore };
}

async function addTarget(targets, input = {}, scope = SCOPE_A) {
  const created = await targets.createTarget({ videoUrl: VIDEO_1, ...input }, scope, { lookup: fakeLookup });
  assert.equal(created.ok, true, created.error);
  return created.data;
}

async function draft(comments, targetId, model, scope = SCOPE_A) {
  return comments.writeDraftForTarget(targetId, scope, { generate: model.generate, readVideo: quietVideo });
}

// ── The schema ──────────────────────────────────────────────────────────────

test('the comments table carries BOTH tenant columns, text project_id, RLS, and cascades with its target', () => {
  const schema = parseSchemaText(schemaText());
  const table = schema.tables.get('youtube_outreach_comments');
  assert.ok(table, 'youtube_outreach_comments is missing from the SQL');
  assert.equal(table.columns.get('project_id').type, 'text');
  assert.equal(table.columns.get('project_id').notNull, true);
  assert.ok(table.columns.get('owner_user_id'), 'project_id without owner_user_id makes scopedInsertRow stamp NEITHER');
  assert.ok(schema.rlsEnabled.has('youtube_outreach_comments'));
  const ref = table.columns.get('target_id').references;
  assert.equal(ref.table, 'youtube_outreach_targets');
  assert.equal(ref.onDelete, 'cascade', 'a removed target must take its approved-but-unposted comments with it');
  assert.deepEqual(
    [...table.columns.get('status').allowed].sort(),
    ['approved', 'draft', 'failed', 'posted', 'posting', 'rejected']
  );
});

test('the comments SQL is idempotent and destroys nothing', () => {
  const sql = fs.readFileSync(COMMENTS_SQL, 'utf8');
  for (const statement of parseSchemaText(`${fs.readFileSync(TARGETS_SQL, 'utf8')}\n${sql}`).statements) {
    const normalized = statement.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.startsWith('create')) assert.ok(normalized.includes('if not exists'), normalized.slice(0, 70));
    assert.ok(!/^(drop|truncate|delete)\b/.test(normalized), normalized.slice(0, 70));
  }
  const once = parseSchemaText(schemaText());
  const twice = parseSchemaText(`${schemaText()}\n${sql}`);
  assert.deepEqual([...twice.tables.keys()], [...once.tables.keys()]);
});

test("projectScope's column probe succeeds on the comments table", async () => {
  const { projectScope, restore } = withDb();
  try {
    assert.equal(await projectScope.supportsProjectColumns('youtube_outreach_comments'), true);
  } finally {
    restore();
  }
});

// ── The rule checks (pure) ──────────────────────────────────────────────────

const NEVER_LINK = { commentLength: 'medium', linkPolicy: 'never', linkUrl: '' };

test('a link of any shape breaks a Never link policy, and the rule is named', () => {
  for (const text of [
    `${GOOD_MEDIUM} https://example.com/x`,
    `${GOOD_MEDIUM} See www.example.com for more.`,
    `${GOOD_MEDIUM} I wrote about it at daneofearth.com.`,
  ]) {
    const checked = drafter.checkComment(text, { target: NEVER_LINK, settings: {} });
    assert.equal(checked.ok, false, text);
    assert.equal(checked.problems[0].rule, 'link');
    assert.match(checked.problems[0].message, /link setting is Never/);
  }
  assert.equal(drafter.checkComment(GOOD_MEDIUM, { target: NEVER_LINK, settings: {} }).ok, true);
});

test('with a link allowed, only THAT link may appear', () => {
  const target = { commentLength: 'medium', linkPolicy: 'allowed', linkUrl: 'https://daneofearth.com/serve' };
  assert.equal(drafter.checkComment(`${GOOD_MEDIUM} daneofearth.com/serve`, { target, settings: {} }).ok, true);
  const other = drafter.checkComment(`${GOOD_MEDIUM} https://spam.example.com`, { target, settings: {} });
  assert.equal(other.ok, false);
  assert.match(other.problems[0].message, /only link allowed for this video is https:\/\/daneofearth.com\/serve/);
});

test('a word on the avoid list is caught as a whole word, ignoring case, and named', () => {
  const settings = { avoidWords: ['subscribe', 'crypto'] };
  const hit = drafter.checkComment(`${GOOD_MEDIUM} Please SUBSCRIBE.`, { target: NEVER_LINK, settings });
  assert.equal(hit.ok, false);
  assert.equal(hit.problems[0].rule, 'avoid_words');
  assert.match(hit.problems[0].message, /"subscribe"/);
  // "cryptography" is not the word "crypto".
  assert.equal(drafter.checkComment(`${GOOD_MEDIUM} Like cryptography.`, { target: NEVER_LINK, settings }).ok, true);
});

test('length bounds follow the setting for a draft, and not for an approval', () => {
  const short = { commentLength: 'short', linkPolicy: 'never' };
  const tooLong = drafter.checkComment('x'.repeat(250), { target: short, settings: {} });
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.problems[0].message, /length setting \(short\) allows at most 200/);
  const tooShort = drafter.checkComment('Nice.', { target: { ...short, commentLength: 'long' }, settings: {} });
  assert.match(tooShort.problems[0].message, /needs at least 150/);
  // Dane trimming a draft is his choice; only YouTube's own ceiling holds then.
  assert.equal(drafter.checkComment('Nice.', { target: { ...short, commentLength: 'long' }, settings: {} }, { forApproval: true }).ok, true);
  assert.equal(drafter.checkComment('x'.repeat(10001), { target: short, settings: {} }, { forApproval: true }).ok, false);
});

test('the prompt carries the canon, then the extra notes, plus the target settings and the avoid list', () => {
  const { system, prompt } = drafter.buildPrompt({
    target: {
      videoTitle: 'Serve clinic', channelName: 'Tennis Co', objective: 'appreciation', commentPlacement: 'top_level',
      messageTypes: ['question'], commentLength: 'short', linkPolicy: 'never', mentionPolicy: 'never', notes: 'Mention the toss.',
    },
    settings: { voice: 'Warm, plain, a coach.', avoidWords: ['subscribe'] },
    video: { description: 'How to serve.', topComments: [{ author: 'Sam', text: 'Love it' }] },
    canon: prepareCanon(CANON_DOCS),
  });
  assert.match(system, /HOW DANE WRITES[\s\S]*Every sentence gets its predicate/);
  assert.match(system, /THE AI-ISM BLOCKLIST:[\s\S]*"delve into"/);
  assert.match(system, /background only[\s\S]*The organism thesis/);
  // The free-text setting comes AFTER the canon, under its new name.
  assert.match(system, /THE AI-ISM BLOCKLIST[\s\S]*EXTRA NOTES FOR THIS CHANNEL[^\n]*\nWarm, plain, a coach\./);
  assert.doesNotMatch(prompt, /Voice — how the account sounds/);
  assert.match(prompt, /thank the creator/);
  assert.match(prompt, /under 200 characters/);
  assert.match(prompt, /Do not include any link/);
  assert.match(prompt, /Never use these words: subscribe/);
  assert.match(prompt, /Mention the toss/);
  assert.match(prompt, /Sam: Love it/);
});

test('the reply is read whether it is JSON, fenced JSON or plain text', () => {
  assert.equal(drafter.parseReply('{"comment":"Hi there"}'), 'Hi there');
  assert.equal(drafter.parseReply('```json\n{"comment":"Hi"}\n```'), 'Hi');
  assert.equal(drafter.parseReply('Just words'), 'Just words');
  assert.equal(drafter.parseReply('{not json'), '');
});

// ── Writing a draft ─────────────────────────────────────────────────────────

test('Write a draft saves a draft that followed the target, tenant columns filled', async () => {
  const { db, targets, comments, restore } = withDb();
  try {
    const target = await addTarget(targets, { commentLength: 'short', objective: 'appreciation' });
    const model = scripted('Thanks for slowing the toss down — that one frame fixed my serve.');
    const made = await draft(comments, target.id, model);
    assert.equal(made.ok, true, made.error);
    assert.equal(made.status, 201);
    assert.equal(made.data.status, 'draft');
    assert.equal(made.data.followed.commentLength, 'short');
    assert.equal(made.data.followed.objective, 'appreciation');
    assert.match(model.asked[0].prompt, /under 200 characters/);

    const stored = db.data.get('youtube_outreach_comments')[0];
    assert.equal(stored.project_id, 'proj_a');
    assert.equal(stored.owner_user_id, 'user_1');
    assert.equal(stored.target_id, target.id);
    assert.equal(stored.video_title, 'Video dQw4w9WgXcQ');
  } finally {
    restore();
  }
});

test('options with a link under a Never policy get one retry naming the rule, and nothing is saved if every one breaks it again', async () => {
  const { db, targets, comments, restore } = withDb();
  try {
    const target = await addTarget(targets);
    const model = scripted(`${GOOD_MEDIUM} https://example.com`, `${GOOD_MEDIUM} www.example.com`);
    const made = await draft(comments, target.id, model);
    assert.equal(made.ok, false);
    assert.equal(made.status, 422);
    assert.match(made.error, /Every reply broke a rule, so none was kept: .*link setting is Never/);
    assert.equal(model.asked.length, 2, 'one call for three options, one retry for the broken ones');
    assert.match(model.asked[1].prompt, /These replies broke the rules — option 1 \("angle 1"\): it contains a link/);
    assert.equal(db.data.get('youtube_outreach_comments').length, 0, 'a rule-breaking draft must never be saved as approvable');
  } finally {
    restore();
  }
});

test('a retry that fixes the rule is kept', async () => {
  const { targets, comments, restore } = withDb();
  try {
    const target = await addTarget(targets);
    const made = await draft(comments, target.id, scripted(`${GOOD_MEDIUM} https://example.com`, GOOD_MEDIUM));
    assert.equal(made.ok, true, made.error);
    assert.equal(made.data.draftText, GOOD_MEDIUM);
  } finally {
    restore();
  }
});

test('an avoided word in the draft is refused by name', async () => {
  const { targets, comments, restore } = withDb();
  try {
    await targets.saveSettings({ avoidWords: ['subscribe'] }, SCOPE_A);
    const target = await addTarget(targets);
    const made = await draft(comments, target.id, scripted(`${GOOD_MEDIUM} Subscribe!`));
    assert.equal(made.ok, false);
    assert.match(made.error, /"subscribe", which is on the account's words-to-avoid list/);
  } finally {
    restore();
  }
});

test('a paused target, an avoided channel and an AI failure each refuse with the reason', async () => {
  const { targets, comments, restore } = withDb();
  try {
    const target = await addTarget(targets);
    await targets.setTargetStatus(target.id, 'paused', SCOPE_A);
    const paused = await draft(comments, target.id, scripted(GOOD_MEDIUM));
    assert.equal(paused.status, 409);
    assert.match(paused.error, /is paused, so no draft was written/);

    await targets.setTargetStatus(target.id, 'active', SCOPE_A);
    await targets.saveSettings({ avoidChannels: ['Some Channel'] }, SCOPE_A);
    const avoided = await draft(comments, target.id, scripted(GOOD_MEDIUM));
    assert.match(avoided.error, /channels-to-avoid list/);

    await targets.saveSettings({ avoidChannels: [] }, SCOPE_A);
    const down = await draft(comments, target.id, scripted({ ok: false, error: 'overloaded' }));
    assert.equal(down.status, 502);
    assert.match(down.error, /The AI did not write any replies: overloaded/);
  } finally {
    restore();
  }
});

// ── Approve / reject ────────────────────────────────────────────────────────

test('approve with an edit stores the edited wording and who approved it, and it reads back approved', async () => {
  const { comments, targets, restore } = withDb();
  try {
    const target = await addTarget(targets);
    const made = await draft(comments, target.id, scripted(GOOD_MEDIUM));
    const edited = `${GOOD_MEDIUM} Thanks!`;
    const approved = await comments.approveComment(made.data.id, { text: edited }, SCOPE_A);
    assert.equal(approved.ok, true, approved.error);

    const readBack = await comments.getComment(made.data.id, SCOPE_A);
    assert.equal(readBack.data.status, 'approved');
    assert.equal(readBack.data.finalText, edited);
    assert.equal(readBack.data.draftText, GOOD_MEDIUM, 'the agent\'s own words are kept unchanged');
    assert.equal(readBack.data.approvedBy, 'user_1');
    assert.ok(readBack.data.approvedAt);
  } finally {
    restore();
  }
});

test('an edit that adds a link under Never is refused by name, and the draft stays a draft', async () => {
  const { comments, targets, restore } = withDb();
  try {
    const target = await addTarget(targets);
    const made = await draft(comments, target.id, scripted(GOOD_MEDIUM));
    const refused = await comments.approveComment(made.data.id, { text: `${GOOD_MEDIUM} example.com` }, SCOPE_A);
    assert.equal(refused.ok, false);
    assert.equal(refused.status, 422);
    assert.match(refused.error, /^Not approved: it contains a link/);
    assert.equal((await comments.getComment(made.data.id, SCOPE_A)).data.status, 'draft');
  } finally {
    restore();
  }
});

test('reject keeps the row in the target history, marked rejected, off the approvals list', async () => {
  const { comments, targets, restore } = withDb();
  try {
    const target = await addTarget(targets);
    const made = await draft(comments, target.id, scripted(GOOD_MEDIUM));
    const rejected = await comments.rejectComment(made.data.id, SCOPE_A);
    assert.equal(rejected.ok, true, rejected.error);

    const waiting = await comments.listComments(200, SCOPE_A, { statuses: ['draft', 'approved'] });
    assert.equal(waiting.data.length, 0);
    const history = await comments.listComments(200, SCOPE_A, { targetId: target.id });
    assert.deepEqual(history.data.map((c) => c.status), ['rejected']);
  } finally {
    restore();
  }
});

test('a decision is made once: approving a rejected comment is refused, not overwritten', async () => {
  const { comments, targets, restore } = withDb();
  try {
    const target = await addTarget(targets);
    const made = await draft(comments, target.id, scripted(GOOD_MEDIUM));
    await comments.rejectComment(made.data.id, SCOPE_A);
    const again = await comments.approveComment(made.data.id, {}, SCOPE_A);
    assert.equal(again.status, 409);
    assert.match(again.error, /is rejected, not waiting for approval/);
    assert.equal((await comments.getComment(made.data.id, SCOPE_A)).data.status, 'rejected');
  } finally {
    restore();
  }
});

test('Write another adds a fresh draft and marks the old one rejected', async () => {
  const { comments, targets, restore } = withDb();
  try {
    const target = await addTarget(targets);
    const first = await draft(comments, target.id, scripted(GOOD_MEDIUM));
    const second = await comments.redraftComment(first.data.id, SCOPE_A, {
      generate: scripted(`${GOOD_MEDIUM} Second take.`).generate, readVideo: quietVideo,
    });
    assert.equal(second.ok, true, second.error);
    assert.notEqual(second.data.id, first.data.id);
    const history = await comments.listComments(200, SCOPE_A, { targetId: target.id });
    assert.deepEqual(history.data.map((c) => c.status).sort(), ['draft', 'rejected']);
  } finally {
    restore();
  }
});

test('a failed Write another leaves the old draft waiting', async () => {
  const { comments, targets, restore } = withDb();
  try {
    const target = await addTarget(targets);
    const first = await draft(comments, target.id, scripted(GOOD_MEDIUM));
    const failed = await comments.redraftComment(first.data.id, SCOPE_A, {
      generate: scripted({ ok: false, error: 'overloaded' }).generate, readVideo: quietVideo,
    });
    assert.equal(failed.ok, false);
    assert.equal((await comments.getComment(first.data.id, SCOPE_A)).data.status, 'draft');
  } finally {
    restore();
  }
});

// ── Tenancy ─────────────────────────────────────────────────────────────────

test('one project cannot see, approve or draft against another project\'s comments', async () => {
  const { comments, targets, restore } = withDb();
  try {
    const target = await addTarget(targets);
    const made = await draft(comments, target.id, scripted(GOOD_MEDIUM));

    assert.equal((await comments.listComments(200, SCOPE_B, {})).data.length, 0);
    assert.equal((await comments.getComment(made.data.id, SCOPE_B)).status, 404);
    assert.equal((await comments.approveComment(made.data.id, {}, SCOPE_B)).status, 404);
    assert.equal((await draft(comments, target.id, scripted(GOOD_MEDIUM), SCOPE_B)).status, 404);
    assert.equal((await comments.getComment(made.data.id, SCOPE_A)).data.status, 'draft');
  } finally {
    restore();
  }
});

test('no project selected is a refusal, never every project\'s comments', async () => {
  const { comments, restore } = withDb();
  try {
    const listed = await comments.listComments(200, { userId: 'user_1' }, {});
    assert.equal(listed.ok, false);
    assert.match(listed.error, /No project is selected/);
    const bad = await comments.listComments(200, SCOPE_A, { statuses: ['nonsense'] });
    assert.equal(bad.status, 400);
  } finally {
    restore();
  }
});

// ── The canon (Outreach wizard 8/19, 86bcrmbje) ───────────────────────────

test('a draft records the 7 canon documents it was written from, read back from the database', async () => {
  const { targets, comments, restore } = withDb();
  try {
    const target = await addTarget(targets);
    const model = scripted(GOOD_MEDIUM);
    const drafted = await draft(comments, target.id, model);
    assert.equal(drafted.ok, true, drafted.error);
    assert.match(model.asked[0].system, /HOW DANE WRITES[\s\S]*Every sentence gets its predicate/);
    const back = await comments.getComment(drafted.data.id, SCOPE_A);
    assert.deepEqual(back.data.canonUsed, CANON_DOCS.map((d) => ({ docKey: d.docKey, syncedAt: d.syncedAt })));
    assert.equal(back.data.canonUsed.length, 7);
  } finally {
    restore();
  }
});

test('a blocklisted phrase from the stand-in AI is refused twice and never saved; an edit carrying one is never approved', async () => {
  const { targets, comments, restore } = withDb();
  try {
    const target = await addTarget(targets);
    const model = scripted(`${GOOD_MEDIUM} Let me delve into it.`);
    const refused = await draft(comments, target.id, model);
    assert.equal(refused.status, 422);
    assert.match(refused.error, /"delve into", which is on the AI-ism blocklist/);
    assert.equal(model.asked.length, 2);
    assert.equal((await comments.listComments(10, SCOPE_A, { targetId: target.id })).data.length, 0);

    const kept = await draft(comments, target.id, scripted(GOOD_MEDIUM));
    const edited = await comments.approveComment(kept.data.id, { text: `${GOOD_MEDIUM} A tapestry of serves.` }, SCOPE_A);
    assert.equal(edited.status, 422);
    assert.match(edited.error, /"tapestry", which is on the AI-ism blocklist/);
    assert.equal((await comments.getComment(kept.data.id, SCOPE_A)).data.status, 'draft');
  } finally {
    restore();
  }
});

test('with no canon copied, no draft is written and the AI is never asked', async () => {
  const { targets, comments, restore } = withDb();
  try {
    const target = await addTarget(targets);
    const model = scripted(GOOD_MEDIUM);
    const refused = await comments.writeDraftForTarget(target.id, SCOPE_A, { generate: model.generate, readVideo: quietVideo, canonDocs: [] });
    assert.equal(refused.status, 409);
    assert.match(refused.error, /no canon copied yet — run npm run canon:sync/);
    assert.equal(model.asked.length, 0);
  } finally {
    restore();
  }
});

// ── Three to choose from (Outreach wizard 10/19, task 86bcrmbm0) ───────────

const OTHER_A = 'I tried the toss drill this morning and my first serves went in far more often. Any tips for keeping it going under match pressure?';
const OTHER_B = 'Loved how you slowed the footage down at the release point. It made the whole motion easier to see than any written guide has.';

test('Write a draft saves three labelled options, the first as draft_text', async () => {
  const { db, targets, comments, restore } = withDb();
  try {
    const target = await addTarget(targets);
    const model = scripted([GOOD_MEDIUM, OTHER_A, OTHER_B]);
    const made = await draft(comments, target.id, model);
    assert.equal(made.ok, true, made.error);
    assert.equal(model.asked.length, 1, 'three options come from ONE AI call');
    assert.match(model.asked[0].system, /Write 3 different replies/);
    assert.doesNotMatch(model.asked[0].system, /"comment"/, 'the one-draft answer shape is left off');
    assert.deepEqual(made.data.draftOptions.map((o) => [o.angle, o.text]), [
      ['angle 1', GOOD_MEDIUM], ['angle 2', OTHER_A], ['angle 3', OTHER_B],
    ]);
    assert.equal(made.data.draftText, GOOD_MEDIUM);
    assert.equal(made.data.chosenOption, null);
    assert.equal(db.data.get('youtube_outreach_comments')[0].draft_options.length, 3);
  } finally {
    restore();
  }
});

test('an option that breaks a rule twice is dropped and named; the other two are kept', async () => {
  const { targets, comments, restore } = withDb();
  try {
    const target = await addTarget(targets);
    const linked = `${OTHER_A} https://example.com`;
    const model = scripted([GOOD_MEDIUM, linked, OTHER_B], [linked]);
    const made = await draft(comments, target.id, model);
    assert.equal(made.ok, true, made.error);
    assert.equal(model.asked.length, 2);
    assert.match(model.asked[1].prompt, /option 2 \("angle 2"\): it contains a link/);
    const options = made.data.draftOptions;
    assert.deepEqual(options.filter((o) => !o.dropped).map((o) => o.text), [GOOD_MEDIUM, OTHER_B]);
    const dropped = options.find((o) => o.dropped);
    assert.equal(dropped.text, undefined, 'a dropped option\'s words are never kept');
    assert.match(dropped.rule.reason, /link setting is Never/);
  } finally {
    restore();
  }
});

test('Approve with a pick takes that option\'s words, records which one, and refuses a dropped or unknown pick', async () => {
  const { targets, comments, restore } = withDb();
  try {
    const target = await addTarget(targets);
    const linked = `${OTHER_A} https://example.com`;
    const made = await draft(comments, target.id, scripted([GOOD_MEDIUM, linked, OTHER_B], [linked]));
    const droppedIndex = made.data.draftOptions.findIndex((o) => o.dropped);
    const keptLast = made.data.draftOptions.findIndex((o) => o.text === OTHER_B);

    for (const bad of [droppedIndex, 7, '1']) {
      const refused = await comments.approveComment(made.data.id, { option: bad }, SCOPE_A);
      assert.equal(refused.ok, false, `option ${JSON.stringify(bad)} must be refused`);
      assert.match(refused.error, /option must be the number of one of this draft's comments/);
    }

    const approved = await comments.approveComment(made.data.id, { option: keptLast }, SCOPE_A);
    assert.equal(approved.ok, true, approved.error);
    const readBack = await comments.getComment(made.data.id, SCOPE_A);
    assert.equal(readBack.data.finalText, OTHER_B);
    assert.equal(readBack.data.chosenOption, keptLast);
  } finally {
    restore();
  }
});

test('Approve with a pick AND an edit stores the edit, still re-checked against the rules', async () => {
  const { targets, comments, restore } = withDb();
  try {
    const target = await addTarget(targets);
    const made = await draft(comments, target.id, scripted([GOOD_MEDIUM, OTHER_A, OTHER_B]));
    const withLink = await comments.approveComment(made.data.id, { option: 1, text: `${OTHER_A} https://example.com` }, SCOPE_A);
    assert.equal(withLink.status, 422);
    assert.match(withLink.error, /link setting is Never/);

    const approved = await comments.approveComment(made.data.id, { option: 1, text: `${OTHER_A} Thanks!` }, SCOPE_A);
    assert.equal(approved.ok, true, approved.error);
    assert.equal(approved.data.finalText, `${OTHER_A} Thanks!`);
    assert.equal(approved.data.chosenOption, 1);
  } finally {
    restore();
  }
});

test('on a database without the option columns, Write a draft says which SQL to run instead of failing vaguely', async () => {
  const { db, targets, comments, restore } = withDb({ withOptions: false });
  try {
    const target = await addTarget(targets);
    const made = await draft(comments, target.id, scripted(GOOD_MEDIUM));
    assert.equal(made.ok, false);
    assert.equal(made.code, 'SQL_NOT_RUN');
    assert.match(made.error, /run docs\/SQL\/youtube_outreach_draft_options\.sql/);
    assert.equal(db.data.get('youtube_outreach_comments').length, 0, 'nothing half-saved');
  } finally {
    restore();
  }
});

test('the options SQL only adds columns, with defaults, and is idempotent', () => {
  const sql = fs.readFileSync(OPTIONS_SQL, 'utf8');
  const statements = sql.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--'));
  for (const line of statements) assert.match(line, /^alter table public\.youtube_outreach_comments add column if not exists /);
  assert.doesNotThrow(() => parseSchemaText(`${schemaText()}\n${sql}`));
});

// ── Lessons (Outreach wizard 13/19, 86bcrmbpm) ─────────────────────────────

test('youtube: a draft is written with the lessons that are ON, after the canon, and records them as lessons_used', async () => {
  const ctx = withDb();
  const lessons = require('../../lib/outreachLessons');
  try {
    const mine = await lessons.createLesson({ channel: 'youtube', text: 'Never open with a compliment.' }, SCOPE_A);
    const everywhere = await lessons.createLesson({ channel: 'all', text: 'End on a question.' }, SCOPE_A);
    const off = await lessons.createLesson({ channel: 'youtube', text: 'Mention the weather.' }, SCOPE_A);
    const elsewhere = await lessons.createLesson({ channel: 'reddit', text: 'Two sentences at most.' }, SCOPE_A);
    for (const r of [mine, everywhere, off, elsewhere]) assert.equal(r.ok, true, r.error);
    assert.equal((await lessons.updateLesson(off.data.id, { enabled: false }, SCOPE_A)).ok, true);
    const target = await addTarget(ctx.targets);
    const model = scripted(GOOD_MEDIUM);
    const drafted = await draft(ctx.comments, target.id, model);
    assert.equal(drafted.ok, true, drafted.error);
    const system = model.asked[0].system;
    assert.match(system, /HOW DANE WRITES[\s\S]*LESSONS FROM DANE'S PAST CHOICES[^\n]*\n- End on a question\.\n- Never open with a compliment\./);
    // BREAK TEST: a lesson switched off, or another channel's, never reaches the prompt.
    assert.doesNotMatch(system, /Mention the weather/);
    assert.doesNotMatch(system, /Two sentences at most/);
    const back = await ctx.comments.getComment(drafted.data.id, SCOPE_A);
    assert.deepEqual(back.data.lessonsUsed, [
      { id: everywhere.data.id, text: 'End on a question.' },
      { id: mine.data.id, text: 'Never open with a compliment.' },
    ]);
  } finally {
    ctx.restore();
  }
});

test('youtube: with no lessons the prompt has no lessons heading, and the draft records an empty list', async () => {
  const ctx = withDb();
  try {
    const target = await addTarget(ctx.targets);
    const model = scripted(GOOD_MEDIUM);
    const drafted = await draft(ctx.comments, target.id, model);
    assert.equal(drafted.ok, true, drafted.error);
    assert.doesNotMatch(model.asked[0].system, /LESSONS FROM DANE/);
    const back = await ctx.comments.getComment(drafted.data.id, SCOPE_A);
    assert.deepEqual(back.data.lessonsUsed, []);
  } finally {
    ctx.restore();
  }
});
