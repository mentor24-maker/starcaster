'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

/**
 * Substack Notes 3/7 (86bcet6pa) — drafting a Note or reply in the account's
 * voice, and Dane's approve / reject on the Approvals tab.
 *
 * The fake database reads its schema from docs/SQL/substack_notes_setup.sql.
 * The AI call and the Substack read are stand-ins: every test says exactly
 * what the "model" wrote, so a rule check can be shown to catch it.
 */

const SQL_PATH = path.join(__dirname, '..', '..', 'docs', 'SQL', 'substack_notes_setup.sql');
const { parseSchemaFile, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/substackNotesStore.js');
const drafter = require('../../lib/substackNotesDrafter.js');

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };
const NOTE_URL = 'https://substack.com/@someone/note/c-12345';
const GOOD = 'Winter air is drier, so the stars look sharper. I stood outside for an hour last night and it felt like the sky had moved closer.';

function withDb() {
  const db = createFakeDb(parseSchemaFile(SQL_PATH));
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ substackNotesItems: 'substack_notes_items', substackNotesSettings: 'substack_notes_settings' }),
    sbQuery: db.sbQuery,
  };
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  for (const p of [projectScopePath, storePath]) delete require.cache[p];
  const store = require(storePath);
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of [projectScopePath, storePath]) delete require.cache[p];
  }
  return { db, store, restore };
}

/** A "model" that answers with each of `replies` in turn, recording what it was asked. */
function scripted(...replies) {
  const asked = [];
  const generate = async (system, prompt) => {
    asked.push({ system, prompt });
    const next = replies[Math.min(asked.length - 1, replies.length - 1)];
    return typeof next === 'string' ? { ok: true, text: JSON.stringify({ text: next }) } : next;
  };
  return { generate, asked };
}

async function addIdea(store, ideaText = 'Why the stars feel closer in winter', scope = SCOPE_A) {
  const made = await store.createItem({ kind: 'note', ideaText }, scope);
  assert.equal(made.ok, true, made.error);
  return made.data;
}

// ── The rules, on their own ────────────────────────────────────────────────

test('checkNoteText names the link, avoid-word and length rules it catches', () => {
  const settings = { linkPolicy: 'never', avoidWords: ['synergy', 'game changer'] };
  assert.equal(drafter.checkNoteText(GOOD, { kind: 'note', settings }).ok, true);

  const link = drafter.checkNoteText('Read it at example.com today', { kind: 'note', settings });
  assert.deepEqual(link.problems.map((p) => p.rule), ['link']);
  assert.match(link.problems[0].message, /link setting is Never/);
  assert.equal(drafter.checkNoteText('Read it at example.com today', { kind: 'note', settings: { linkPolicy: 'if_natural' } }).ok, true);

  const avoided = drafter.checkNoteText('A real Game Changer, pure SYNERGY.', { kind: 'note', settings });
  assert.deepEqual(avoided.problems.map((p) => p.rule), ['avoid_words']);
  assert.match(avoided.problems[0].message, /"synergy", "game changer", which are on the account's words-to-avoid list/);
  // Whole words only: "synergyst" is not "synergy".
  assert.equal(drafter.checkNoteText('A synergyst walks in', { kind: 'note', settings }).ok, true);

  const longReply = drafter.checkNoteText('x'.repeat(drafter.REPLY_MAX_LENGTH + 1), { kind: 'reply', settings: {} });
  assert.match(longReply.problems[0].message, /a reply may be at most 1000/);
  assert.equal(drafter.checkNoteText('x'.repeat(drafter.REPLY_MAX_LENGTH + 1), { kind: 'note', settings: {} }).ok, true);
  assert.match(drafter.checkNoteText('x'.repeat(drafter.NOTE_MAX_LENGTH + 1), { kind: 'note', settings: {} }).problems[0].message, /a Note may be at most 10000/);
  assert.equal(drafter.checkNoteText('  ', { kind: 'note', settings: {} }).problems[0].rule, 'empty');
});

test('the prompt carries the idea, the voice, the avoid list and the link rule', () => {
  const { system, prompt } = drafter.buildPrompt({
    item: { kind: 'note', source: 'jotted', ideaText: 'Winter stars' },
    settings: { voice: 'Warm, plain, a little wry.', avoidWords: ['synergy'], linkPolicy: 'never' },
  });
  assert.match(system, /Substack Note/);
  assert.match(prompt, /Idea: Winter stars/);
  assert.match(prompt, /Voice — how the account sounds: Warm, plain, a little wry\./);
  assert.match(prompt, /Never use these words: synergy\./);
  assert.match(prompt, /Do not include any link/);

  const reply = drafter.buildPrompt({
    item: { kind: 'reply', source: 'target', targetText: 'Their thought', ideaText: 'Agree, add winter' },
    settings: {},
  }).prompt;
  assert.match(reply, /Their Note: Their thought/);
  assert.match(reply, /roughly: Agree, add winter/);
});

test('a draft that breaks a rule twice is refused with the rule named; one fixed on the retry is kept', async () => {
  const settings = { linkPolicy: 'never', avoidWords: ['synergy'] };
  const item = { kind: 'note', source: 'jotted', ideaText: 'x' };

  const twice = scripted('So much synergy here.');
  const refused = await drafter.writeDraft({ item, settings }, { generate: twice.generate });
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 422);
  assert.match(refused.error, /"synergy", which is on the account's words-to-avoid list/);
  assert.equal(twice.asked.length, 2);
  assert.match(twice.asked[1].prompt, /Your last draft broke these rules: it uses "synergy"/);

  const fixed = scripted('See example.com for more.', GOOD);
  const kept = await drafter.writeDraft({ item, settings }, { generate: fixed.generate });
  assert.equal(kept.ok, true, kept.error);
  assert.equal(kept.data.text, GOOD);

  const down = await drafter.writeDraft({ item, settings }, { generate: async () => ({ ok: false, error: 'overloaded' }) });
  assert.equal(down.status, 502);
  assert.match(down.error, /overloaded/);
});

// ── Reading the Note being replied to ──────────────────────────────────────

test('readNoteText takes the JSON body first, the page description second, and says what failed', async () => {
  const asked = [];
  const viaJson = await drafter.readNoteText(NOTE_URL, {
    fetcher: async (url) => { asked.push(url); return { ok: true, status: 200, text: JSON.stringify({ item: { comment: { body: 'Full text' } } }) }; },
  });
  assert.deepEqual(viaJson, { ok: true, text: 'Full text' });
  assert.deepEqual(asked, ['https://substack.com/api/v1/reader/comment/12345']);

  const viaPage = await drafter.readNoteText(NOTE_URL, {
    fetcher: async (url) => (url === NOTE_URL
      ? { ok: true, status: 200, text: '<title data-rh="true">Sam (@sam): &quot;Stars&quot;</title><meta data-rh="true" property="og:description" content="Stars &amp; &quot;winter&quot;"/>' }
      : { ok: false, status: 404, text: '' }),
  });
  assert.deepEqual(viaPage, { ok: true, text: 'Stars & "winter"' });

  // A missing Note's link answers 200 with Substack's generic page; its slogan is not a Note.
  const generic = await drafter.readNoteText(NOTE_URL, {
    fetcher: async (url) => (url === NOTE_URL
      ? { ok: true, status: 200, text: '<title data-rh="true">Substack</title><meta data-rh="true" property="og:description" content="The app for independent voices"/>' }
      : { ok: true, status: 200, text: '{"error":""}' }),
  });
  assert.equal(generic.ok, false);
  assert.match(generic.reason, /sent no Note text; the Note's page showed no Note/);

  const neither = await drafter.readNoteText(NOTE_URL, { fetcher: async () => { throw new Error('offline'); } });
  assert.equal(neither.ok, false);
  assert.match(neither.reason, /Substack could not be reached \(offline\); the Note's page could not be reached \(offline\)/);
});

// ── The store: draft, approve, reject ──────────────────────────────────────

test('Write a draft turns an idea into a draft; Approve with an edit saves the edit as approved', async () => {
  const { store, restore } = withDb();
  try {
    await store.saveSettings({ voice: 'Warm and plain.' }, SCOPE_A);
    const idea = await addIdea(store);
    const model = scripted(GOOD);
    const drafted = await store.writeDraftForItem(idea.id, SCOPE_A, { generate: model.generate });
    assert.equal(drafted.ok, true, drafted.error);
    assert.equal(drafted.data.status, 'draft');
    assert.equal(drafted.data.draftText, GOOD);
    assert.match(model.asked[0].prompt, /Warm and plain\./);
    assert.equal(store.awaitsApproval(drafted.data), true);

    const approved = await store.approveItem(idea.id, { text: 'My edited words.' }, SCOPE_A);
    assert.equal(approved.ok, true, approved.error);
    const reread = await store.getItemById(idea.id, SCOPE_A);
    assert.equal(reread.data.status, 'approved');
    assert.equal(reread.data.finalText, 'My edited words.');
    assert.equal(reread.data.draftText, GOOD);
    assert.equal(reread.data.approvedBy, 'user_1');

    const again = await store.approveItem(idea.id, {}, SCOPE_A);
    assert.equal(again.status, 409);
  } finally {
    restore();
  }
});

test('an edit that breaks the avoid list is never approved — on Approve or through a plain PATCH', async () => {
  const { store, restore } = withDb();
  try {
    await store.saveSettings({ avoidWords: ['synergy'], linkPolicy: 'never' }, SCOPE_A);
    const idea = await addIdea(store);
    await store.writeDraftForItem(idea.id, SCOPE_A, { generate: scripted(GOOD).generate });

    const viaApprove = await store.approveItem(idea.id, { text: 'Pure synergy.' }, SCOPE_A);
    assert.equal(viaApprove.ok, false);
    assert.equal(viaApprove.status, 422);
    assert.match(viaApprove.error, /Not approved: it uses "synergy"/);

    const viaPatch = await store.updateItem(idea.id, { status: 'approved', finalText: 'See example.com' }, SCOPE_A);
    assert.equal(viaPatch.ok, false);
    assert.match(viaPatch.error, /link setting is Never/);

    assert.equal((await store.getItemById(idea.id, SCOPE_A)).data.status, 'draft');
  } finally {
    restore();
  }
});

test('a rule-breaking draft is not saved; the idea stays an idea', async () => {
  const { store, restore } = withDb();
  try {
    await store.saveSettings({ avoidWords: ['synergy'] }, SCOPE_A);
    const idea = await addIdea(store);
    const refused = await store.writeDraftForItem(idea.id, SCOPE_A, { generate: scripted('synergy synergy').generate });
    assert.equal(refused.status, 422);
    const reread = await store.getItemById(idea.id, SCOPE_A);
    assert.equal(reread.data.status, 'idea');
    assert.equal(reread.data.draftText, '');
  } finally {
    restore();
  }
});

test('Write another replaces a waiting draft; Reject leaves it on its row marked rejected', async () => {
  const { store, restore } = withDb();
  try {
    const idea = await addIdea(store);
    await store.writeDraftForItem(idea.id, SCOPE_A, { generate: scripted('First words here.').generate });
    const another = await store.writeDraftForItem(idea.id, SCOPE_A, { generate: scripted('Second words here.').generate });
    assert.equal(another.data.draftText, 'Second words here.');
    assert.equal(another.data.status, 'draft');

    const rejected = await store.rejectItem(idea.id, SCOPE_A);
    assert.equal(rejected.ok, true, rejected.error);
    const reread = await store.getItemById(idea.id, SCOPE_A);
    assert.equal(reread.data.status, 'rejected');
    assert.equal(reread.data.draftText, 'Second words here.');
    assert.equal(store.awaitsApproval(reread.data), false);

    const late = await store.writeDraftForItem(idea.id, SCOPE_A, { generate: scripted(GOOD).generate });
    assert.equal(late.status, 409);
  } finally {
    restore();
  }
});

test('a Like waits for approval with no text, and cannot be drafted', async () => {
  const { store, restore } = withDb();
  try {
    const like = (await store.createItem({ kind: 'like', targetUrl: NOTE_URL }, SCOPE_A)).data;
    assert.equal(store.awaitsApproval(like), true);
    const drafted = await store.writeDraftForItem(like.id, SCOPE_A, { generate: scripted(GOOD).generate });
    assert.equal(drafted.status, 409);
    assert.match(drafted.error, /no words to draft/);
    const withText = await store.approveItem(like.id, { text: 'hello' }, SCOPE_A);
    assert.match(withText.error, /has no words/);
    const approved = await store.approveItem(like.id, {}, SCOPE_A);
    assert.equal(approved.ok, true, approved.error);
    assert.equal(approved.data.status, 'approved');
  } finally {
    restore();
  }
});

test('a reply reads the Note it answers and keeps that text; when it cannot, it asks for a paste', async () => {
  const { store, restore } = withDb();
  try {
    const reply = (await store.createItem({ kind: 'reply', targetUrl: NOTE_URL, ideaText: 'Agree' }, SCOPE_A)).data;

    const blind = await store.writeDraftForItem(reply.id, SCOPE_A, {
      generate: scripted(GOOD).generate,
      readNote: async () => ({ ok: false, reason: 'Substack answered 403' }),
    });
    assert.equal(blind.status, 409);
    assert.equal(blind.code, 'NOTE_TEXT_NEEDED');
    assert.match(blind.error, /could not be read \(Substack answered 403\)\. Paste its text/);

    const model = scripted('Yes, and winter makes it sharper.');
    const drafted = await store.writeDraftForItem(reply.id, SCOPE_A, {
      generate: model.generate,
      readNote: async () => ({ ok: true, text: 'The sky is closer in winter.' }),
    });
    assert.equal(drafted.ok, true, drafted.error);
    assert.equal(drafted.data.targetText, 'The sky is closer in winter.');
    assert.match(model.asked[0].prompt, /Their Note: The sky is closer in winter\./);

    // A pasted text is used as-is; Substack is not asked again.
    const pasted = (await store.createItem({ kind: 'reply', targetUrl: NOTE_URL, targetText: 'Pasted words' }, SCOPE_A)).data;
    let read = 0;
    await store.writeDraftForItem(pasted.id, SCOPE_A, { generate: scripted(GOOD).generate, readNote: async () => { read += 1; return { ok: true, text: 'x' }; } });
    assert.equal(read, 0);
  } finally {
    restore();
  }
});

test('another project cannot draft, approve or reject this one\'s items', async () => {
  const { store, restore } = withDb();
  try {
    const idea = await addIdea(store);
    assert.equal((await store.writeDraftForItem(idea.id, SCOPE_B, { generate: scripted(GOOD).generate })).status, 404);
    assert.equal((await store.approveItem(idea.id, {}, SCOPE_B)).status, 404);
    assert.equal((await store.rejectItem(idea.id, SCOPE_B)).status, 404);
    assert.equal((await store.getItemById(idea.id, SCOPE_A)).data.status, 'idea');
  } finally {
    restore();
  }
});
