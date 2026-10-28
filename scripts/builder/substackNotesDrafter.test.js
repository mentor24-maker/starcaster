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

const fs = require('fs');

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const SETUP_SQL = fs.readFileSync(path.join(SQL_DIR, 'substack_notes_setup.sql'), 'utf8');
const OPTIONS_SQL = fs.readFileSync(path.join(SQL_DIR, 'substack_notes_draft_options.sql'), 'utf8');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');
const { withCanon, CANON_DOCS } = require('./canonFixture.js');
const { prepareCanon } = require('../../lib/canonPrompt.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const storePath = require.resolve('../../lib/substackNotesStore.js');
const drafter = require('../../lib/substackNotesDrafter.js');

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };
const NOTE_URL = 'https://substack.com/@someone/note/c-12345';
const GOOD = 'Winter air is drier, so the stars look sharper. I stood outside for an hour last night and it felt like the sky had moved closer.';

function withDb({ withOptionsSql = true } = {}) {
  const db = createFakeDb(parseSchemaText(withOptionsSql ? `${SETUP_SQL}\n${OPTIONS_SQL}` : SETUP_SQL));
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({ substackNotesItems: 'substack_notes_items', substackNotesSettings: 'substack_notes_settings' }),
    sbQuery: withCanon(db.sbQuery),
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

/**
 * A "model" that answers with each of `replies` in turn, recording what it was
 * asked. A string reply is written in BOTH answer shapes — `text` for the
 * one-draft writer, and three `options` carrying it for the three-option one
 * the store uses since 11/19 — so every older test reads the words it scripted.
 */
function scripted(...replies) {
  const asked = [];
  const generate = async (system, prompt) => {
    asked.push({ system, prompt });
    const next = replies[Math.min(asked.length - 1, replies.length - 1)];
    if (typeof next !== 'string') return next;
    const options = [1, 2, 3].map((n) => ({ angle: `angle ${n}`, text: next }));
    return { ok: true, text: JSON.stringify({ text: next, options }) };
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

test('the prompt carries the canon, then the extra notes, plus the idea, the avoid list and the link rule', () => {
  const canon = prepareCanon(CANON_DOCS);
  const { system, prompt } = drafter.buildPrompt({
    item: { kind: 'note', source: 'jotted', ideaText: 'Winter stars' },
    settings: { voice: 'Warm, plain, a little wry.', avoidWords: ['synergy'], linkPolicy: 'never' },
    canon,
  });
  assert.match(system, /Substack Note/);
  assert.match(system, /HOW DANE WRITES[\s\S]*Every sentence gets its predicate/);
  assert.match(system, /THE AI-ISM BLOCKLIST:[\s\S]*"delve into"/);
  assert.match(system, /background only[\s\S]*A stewardship ethic/);
  // The free-text setting comes AFTER the canon, under its new name.
  assert.match(system, /THE AI-ISM BLOCKLIST[\s\S]*EXTRA NOTES FOR THIS CHANNEL[^\n]*\nWarm, plain, a little wry\./);
  assert.doesNotMatch(prompt, /Voice — how the account sounds/);
  assert.match(prompt, /Idea: Winter stars/);
  assert.match(prompt, /Never use these words: synergy\./);
  assert.match(prompt, /Do not include any link/);

  const reply = drafter.buildPrompt({
    item: { kind: 'reply', source: 'target', targetText: 'Their thought', ideaText: 'Agree, add winter' },
    settings: {},
    canon,
  }).prompt;
  assert.match(reply, /Their Note: Their thought/);
  assert.match(reply, /roughly: Agree, add winter/);
});

test('a draft that breaks a rule twice is refused with the rule named; one fixed on the retry is kept', async () => {
  const settings = { linkPolicy: 'never', avoidWords: ['synergy'] };
  const item = { kind: 'note', source: 'jotted', ideaText: 'x' };

  const twice = scripted('So much synergy here.');
  const refused = await drafter.writeDraft({ item, settings, canonDocs: CANON_DOCS }, { generate: twice.generate });
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 422);
  assert.match(refused.error, /"synergy", which is on the account's words-to-avoid list/);
  assert.equal(twice.asked.length, 2);
  assert.match(twice.asked[1].prompt, /Your last draft broke these rules: it uses "synergy"/);

  const fixed = scripted('See example.com for more.', GOOD);
  const kept = await drafter.writeDraft({ item, settings, canonDocs: CANON_DOCS }, { generate: fixed.generate });
  assert.equal(kept.ok, true, kept.error);
  assert.equal(kept.data.text, GOOD);

  const down = await drafter.writeDraft({ item, settings, canonDocs: CANON_DOCS }, { generate: async () => ({ ok: false, error: 'overloaded' }) });
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
    assert.match(model.asked[0].system, /EXTRA NOTES FOR THIS CHANNEL[^\n]*\nWarm and plain\./);
    assert.equal(store.awaitsApproval(drafted.data), true);
    // Outreach wizard 8/19: the draft records the canon it was written from — read back, not the write's echo.
    const back = await store.getItemById(idea.id, SCOPE_A);
    assert.deepEqual(back.data.canonUsed, CANON_DOCS.map((d) => ({ docKey: d.docKey, syncedAt: d.syncedAt })));
    assert.equal(back.data.canonUsed.length, 7);

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

// ── The canon (Outreach wizard 8/19, 86bcrmbje) ───────────────────────────

test('a blocklisted phrase from the stand-in AI is refused twice and never saved; an edit carrying one is never approved', async () => {
  const { store, restore } = withDb();
  try {
    const idea = await addIdea(store);
    const model = scripted('Let us delve into the winter sky together.');
    const refused = await store.writeDraftForItem(idea.id, SCOPE_A, { generate: model.generate });
    assert.equal(refused.status, 422);
    assert.match(refused.error, /"delve into", which is on the AI-ism blocklist/);
    assert.equal(model.asked.length, 2);
    assert.equal((await store.getItemById(idea.id, SCOPE_A)).data.status, 'idea');

    await store.writeDraftForItem(idea.id, SCOPE_A, { generate: scripted(GOOD).generate });
    const edited = await store.approveItem(idea.id, { text: 'A rich tapestry of stars.' }, SCOPE_A);
    assert.equal(edited.status, 422);
    assert.match(edited.error, /"tapestry", which is on the AI-ism blocklist/);
    assert.equal((await store.getItemById(idea.id, SCOPE_A)).data.status, 'draft');
  } finally {
    restore();
  }
});

test('with no canon copied, no draft is written and the AI is never asked', async () => {
  const { store, restore } = withDb();
  try {
    const idea = await addIdea(store);
    const model = scripted(GOOD);
    const refused = await store.writeDraftForItem(idea.id, SCOPE_A, { generate: model.generate, canonDocs: [] });
    assert.equal(refused.status, 409);
    assert.match(refused.error, /no canon copied yet — run npm run canon:sync/);
    assert.equal(model.asked.length, 0);
    assert.equal((await store.getItemById(idea.id, SCOPE_A)).data.status, 'idea');
  } finally {
    restore();
  }
});

// ── Three to choose from (Outreach wizard 11/19, task 86bcrmbmy) ────────────

/** A "model" answering with three labelled options; `texts[i]` per slot, then `retry` for any second try. */
function threeOptions(texts, retry = null) {
  const asked = [];
  const generate = async (system, prompt) => {
    asked.push({ system, prompt });
    const list = asked.length === 1 ? texts : retry;
    return { ok: true, text: JSON.stringify({ options: list.map((text, i) => ({ angle: `angle ${i + 1}`, text })) }) };
  };
  return { generate, asked };
}

const OTHER = 'The cold makes everything quieter, and the sky does the talking.';
const THIRD = 'Has anyone else noticed the stars seem closer once the leaves are down?';

test('Write a draft saves three labelled options; the first is the draft text, and the prompt asks for three', async () => {
  const { store, restore } = withDb();
  try {
    const idea = await addIdea(store);
    const model = threeOptions([GOOD, OTHER, THIRD]);
    const drafted = await store.writeDraftForItem(idea.id, SCOPE_A, { generate: model.generate });
    assert.equal(drafted.ok, true, drafted.error);
    assert.equal(model.asked.length, 1);
    assert.match(model.asked[0].system, /Write 3 different replies/);
    assert.doesNotMatch(model.asked[0].system, /exactly \{"text"/);

    const back = await store.getItemById(idea.id, SCOPE_A);
    assert.equal(back.data.status, 'draft');
    assert.equal(back.data.draftText, GOOD);
    assert.deepEqual(back.data.draftOptions.map((o) => [o.angle, o.text, o.rule.ok]), [
      ['angle 1', GOOD, true], ['angle 2', OTHER, true], ['angle 3', THIRD, true],
    ]);
    assert.equal(back.data.chosenOption, null);
  } finally {
    restore();
  }
});

test('an option that breaks a rule twice is dropped and named; the others are kept', async () => {
  const { store, restore } = withDb();
  try {
    await store.saveSettings({ avoidWords: ['synergy'] }, SCOPE_A);
    const idea = await addIdea(store);
    const model = threeOptions([GOOD, 'Pure synergy tonight.', THIRD], ['Still synergy.']);
    const drafted = await store.writeDraftForItem(idea.id, SCOPE_A, { generate: model.generate });
    assert.equal(drafted.ok, true, drafted.error);
    assert.equal(model.asked.length, 2);
    const options = (await store.getItemById(idea.id, SCOPE_A)).data.draftOptions;
    assert.deepEqual(options.filter((o) => !o.dropped).map((o) => o.text), [GOOD, THIRD]);
    const dropped = options.filter((o) => o.dropped);
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0].text, undefined, 'a dropped option keeps no words to pick');
    assert.match(dropped[0].rule.reason, /"synergy", which is on the account's words-to-avoid list/);
  } finally {
    restore();
  }
});

test('Approve with a pick records which option it was, and the words default to that option', async () => {
  const { store, restore } = withDb();
  try {
    const idea = await addIdea(store);
    await store.writeDraftForItem(idea.id, SCOPE_A, { generate: threeOptions([GOOD, OTHER, THIRD]).generate });

    const bad = await store.approveItem(idea.id, { option: 7 }, SCOPE_A);
    assert.equal(bad.status, 400);
    assert.match(bad.error, /option must be the number of one of this draft's Notes \(0, 1, 2\) — got 7/);

    const approved = await store.approveItem(idea.id, { option: 1 }, SCOPE_A);
    assert.equal(approved.ok, true, approved.error);
    const back = await store.getItemById(idea.id, SCOPE_A);
    assert.equal(back.data.status, 'approved');
    assert.equal(back.data.chosenOption, 1);
    assert.equal(back.data.finalText, OTHER);
  } finally {
    restore();
  }
});

test('an edited pick is checked against the rules and saved with its option number', async () => {
  const { store, restore } = withDb();
  try {
    await store.saveSettings({ avoidWords: ['synergy'] }, SCOPE_A);
    const idea = await addIdea(store);
    await store.writeDraftForItem(idea.id, SCOPE_A, { generate: threeOptions([GOOD, OTHER, THIRD]).generate });

    const refused = await store.approveItem(idea.id, { option: 2, text: 'Synergy under the stars.' }, SCOPE_A);
    assert.equal(refused.status, 422);
    assert.equal((await store.getItemById(idea.id, SCOPE_A)).data.status, 'draft');

    const approved = await store.approveItem(idea.id, { option: 2, text: `${THIRD} Mine are.` }, SCOPE_A);
    assert.equal(approved.ok, true, approved.error);
    const back = await store.getItemById(idea.id, SCOPE_A);
    assert.equal(back.data.chosenOption, 2);
    assert.equal(back.data.finalText, `${THIRD} Mine are.`);
  } finally {
    restore();
  }
});

test('a draft written before options keeps approving as one draft, with no option recorded', async () => {
  const { store, restore } = withDb();
  try {
    const item = await addIdea(store);
    // An old-style draft, the way 3/7 wrote them: words, and no options.
    const moved = await store.updateItem(item.id, { draftText: GOOD, status: 'draft' }, SCOPE_A);
    assert.equal(moved.ok, true, moved.error);
    assert.deepEqual(moved.data.draftOptions, []);
    const picked = await store.approveItem(moved.data.id, { option: 0 }, SCOPE_A);
    assert.equal(picked.status, 400);
    assert.match(picked.error, /nothing to choose from/);
    const approved = await store.approveItem(moved.data.id, {}, SCOPE_A);
    assert.equal(approved.ok, true, approved.error);
    assert.equal(approved.data.finalText, GOOD);
    assert.equal(approved.data.chosenOption, null);
  } finally {
    restore();
  }
});

test('without docs/SQL/substack_notes_draft_options.sql, Write a draft refuses and names the file', async () => {
  const { store, restore } = withDb({ withOptionsSql: false });
  try {
    const idea = await addIdea(store);
    const refused = await store.writeDraftForItem(idea.id, SCOPE_A, { generate: threeOptions([GOOD, OTHER, THIRD]).generate });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'SQL_NOT_RUN');
    assert.match(refused.error, /run docs\/SQL\/substack_notes_draft_options\.sql/);
    assert.equal((await store.getItemById(idea.id, SCOPE_A)).data.status, 'idea');
  } finally {
    restore();
  }
});
