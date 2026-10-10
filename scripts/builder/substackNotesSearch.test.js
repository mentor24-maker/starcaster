'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Substack Miner 6/7 (86bcfpry2) — writers found through Substack's Notes
 * search: each author's publication upserted as a candidate carrying the
 * keyword, the Note kept as evidence, nothing added twice; the Mini's pass
 * searches ONE keyword and refuses, writing nothing, when the browser is not
 * signed in as Dane of Earth.
 *
 * The stores are the REAL ones over ONE fake database whose schema is read
 * from both setup files, so a column the SQL lacks fails here too.
 */

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'SQL');
const { parseSchemaText, createFakeDb } = require('./sqlSchemaFake.js');

const supabasePath = require.resolve('../../lib/supabase.js');
const projectScopePath = require.resolve('../../lib/projectScope.js');
const minerPath = require.resolve('../../lib/substackMinerStore.js');
const notesPath = require.resolve('../../lib/substackNotesStore.js');
const capturePath = require.resolve('../../lib/acquire/SubstackNotesCapture.js');
const readRunPath = require.resolve('../../lib/acquire/SubstackNotesReadRun.js');
const searchPath = require.resolve('../../lib/acquire/SubstackNotesSearch.js');
const ALL = [projectScopePath, minerPath, notesPath, capturePath, readRunPath, searchPath];

const SCOPE_A = { projectId: 'proj_a', userId: 'user_1' };
const SCOPE_B = { projectId: 'proj_b', userId: 'user_2' };

function withDb() {
  const sql = ['substack_miner_setup.sql', 'substack_notes_setup.sql']
    .map((f) => fs.readFileSync(path.join(SQL_DIR, f), 'utf8')).join('\n');
  const db = createFakeDb(parseSchemaText(sql));
  const fakeSupabase = {
    isConfigured: () => true,
    tableConfig: () => ({
      substackCandidates: 'substack_candidates',
      substackMinerSettings: 'substack_miner_settings',
      substackNotesItems: 'substack_notes_items',
      substackNotesSettings: 'substack_notes_settings',
    }),
    sbQuery: db.sbQuery,
  };
  const realSupabase = require.cache[supabasePath];
  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: fakeSupabase };
  for (const p of ALL) delete require.cache[p];
  const miner = require(minerPath);
  const notes = require(notesPath);
  const search = require(searchPath);
  function restore() {
    if (realSupabase) require.cache[supabasePath] = realSupabase;
    else delete require.cache[supabasePath];
    for (const p of ALL) delete require.cache[p];
  }
  return { db, miner, notes, search, restore };
}

/** Public profiles by person handle; anything else answers 404. */
const PROFILES = {
  ada: { id: 1, handle: 'ada', primaryPublication: { subdomain: 'adawrites', name: 'Ada Writes' } },
  bo: { id: 2, handle: 'bo', primaryPublication: { subdomain: 'bo-thinks', name: 'Bo Thinks' } },
  cy: { id: 3, handle: 'cy', primaryPublication: null, publicationUsers: [{ role: 'admin', publication: { subdomain: 'cyletters', name: 'Cy Letters' } }] },
  dee: { id: 4, handle: 'dee', primaryPublication: { subdomain: 'deedeep', name: 'Dee Deep' } },
  reader: { id: 5, handle: 'reader', primaryPublication: null, publicationUsers: [] },
};

function fakeFetch(calls = []) {
  return async (url) => {
    calls.push(url);
    const m = url.match(/\/user\/([^/]+)\/public_profile$/);
    const profile = m && PROFILES[decodeURIComponent(m[1])];
    if (!profile) return { ok: false, httpStatus: 404, reason: 'answered HTTP 404' };
    return { ok: true, data: profile };
  };
}

const deps = (extra = {}) => ({ fetchJson: fakeFetch(), sleep: async () => {}, ...extra });

/** Five Notes by four authors (Ada twice), the ticket's first acceptance case. */
const FIVE = [
  { authorHandle: 'ada', authorName: 'Ada', url: 'https://substack.com/@ada/note/c-1', text: 'Dear Substack, connect me with the polymaths' },
  { authorHandle: '@Bo', authorName: 'Bo', url: 'https://substack.com/@bo/note/c-2', text: 'Polymath here' },
  { authorHandle: 'ada', authorName: 'Ada', url: 'https://substack.com/@ada/note/c-3', text: 'Another one' },
  { authorHandle: 'cy', authorName: 'Cy', url: 'https://substack.com/@cy/note/c-4', text: 'Count me in' },
  { authorHandle: 'dee', authorName: 'Dee', url: 'https://substack.com/@dee/note/c-5', text: 'Same' },
];

async function all(miner, scope = SCOPE_A) {
  const res = await miner.listCandidates(500, scope);
  assert.equal(res.ok, true, res.error);
  return res.data;
}

// ── The endpoint: upsert each author, keep the Note, never twice ─────────────

test('five Notes by four authors make four candidates, each carrying the keyword and found via Notes', async () => {
  const { miner, search, restore } = withDb();
  try {
    const res = await search.captureNotesSearch({ keyword: 'polymath', notes: FIVE }, SCOPE_A, deps());
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.authors, 4);
    assert.equal(res.data.added.length, 4);
    assert.equal(res.data.notesStored, 5);

    const rows = await all(miner);
    assert.deepEqual(rows.map((r) => r.handle).sort(), ['adawrites', 'bo-thinks', 'cyletters', 'deedeep']);
    for (const r of rows) {
      assert.equal(r.foundVia, 'notes_search');
      assert.deepEqual(r.keywordsHit, ['polymath']);
      assert.equal(r.status, 'candidate');
      assert.equal(r.lastNotesReadAt, null, 'finding a Note is not reading the writer\'s Notes');
    }
    const ada = rows.find((r) => r.handle === 'adawrites');
    assert.equal(ada.name, 'Ada Writes');
    assert.deepEqual(ada.recentNotes.map((n) => n.url).sort(), ['https://substack.com/@ada/note/c-1', 'https://substack.com/@ada/note/c-3']);
    assert.equal(ada.recentNotes[0].keyword, 'polymath');
    assert.equal(ada.recentNotes[0].foundBy, 'notes_search');
  } finally {
    restore();
  }
});

test('the same payload sent again adds no candidates and no duplicate Notes', async () => {
  const { miner, search, restore } = withDb();
  try {
    await search.captureNotesSearch({ keyword: 'polymath', notes: FIVE }, SCOPE_A, deps());
    const again = await search.captureNotesSearch({ keyword: 'polymath', notes: FIVE }, SCOPE_A, deps());
    assert.equal(again.ok, true, again.error);
    assert.equal(again.data.added.length, 0);
    assert.equal(again.data.merged.length, 4);
    assert.equal(again.data.notesStored, 0);
    const rows = await all(miner);
    assert.equal(rows.length, 4);
    assert.equal(rows.find((r) => r.handle === 'adawrites').recentNotes.length, 2);
  } finally {
    restore();
  }
});

test('a writer already on the list keeps how it was first found and Dane\'s decision, and gains the keyword', async () => {
  const { miner, search, restore } = withDb();
  try {
    const made = await miner.upsertCandidate({ handle: 'adawrites', keywordsHit: ['renaissance'], foundVia: 'web_search' }, SCOPE_A);
    await miner.updateCandidate(made.data.id, { status: 'approved' }, SCOPE_A);
    const res = await search.captureNotesSearch({ keyword: 'polymath', notes: FIVE.slice(0, 1) }, SCOPE_A, deps());
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.merged.length, 1);
    const ada = (await all(miner)).find((r) => r.handle === 'adawrites');
    assert.equal(ada.foundVia, 'web_search');
    assert.equal(ada.status, 'approved');
    assert.deepEqual(ada.keywordsHit, ['renaissance', 'polymath']);
    assert.equal(ada.recentNotes.length, 1);
  } finally {
    restore();
  }
});

test('an author with no publication, or no readable profile, is named as not added — never guessed', async () => {
  const { miner, search, restore } = withDb();
  try {
    const res = await search.captureNotesSearch({
      keyword: 'polymath',
      notes: [
        { authorHandle: 'reader', authorName: 'Just A Reader', url: 'https://substack.com/@reader/note/c-9', text: 'hi' },
        { authorHandle: 'ghost', authorName: 'Ghost', url: 'https://substack.com/@ghost/note/c-10', text: 'boo' },
      ],
    }, SCOPE_A, deps());
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.added.length, 0);
    assert.equal(res.data.notAdded.length, 2);
    assert.match(res.data.notAdded[0].reason, /no Substack publication of their own/);
    assert.match(res.data.notAdded[1].reason, /HTTP 404/);
    assert.equal((await all(miner)).length, 0);
  } finally {
    restore();
  }
});

test('a bad Note is refused by position while the good ones are used', async () => {
  const { search, restore } = withDb();
  try {
    const res = await search.captureNotesSearch({
      keyword: 'polymath',
      notes: [
        { authorHandle: 'ada', url: 'https://example.com/not-a-note', text: 'x' },
        { authorHandle: 'not a handle!', url: 'https://substack.com/@x/note/c-11' },
        { authorHandle: 'bo', url: 'https://substack.com/@bo/note/c-2', text: 'ok', likes: 4 },
        { authorHandle: 'bo', url: 'https://substack.com/@bo/note/c-2', text: 'ok' },
      ],
    }, SCOPE_A, deps());
    assert.equal(res.ok, true, res.error);
    assert.deepEqual(res.data.refusedNotes.map((r) => r.index), [0, 1, 2]);
    assert.equal(res.data.added.length, 1);
  } finally {
    restore();
  }
});

test('the request itself is checked: keyword required, notes a list, no unknown fields', async () => {
  const { search, restore } = withDb();
  try {
    assert.match((await search.captureNotesSearch({ notes: [] }, SCOPE_A, deps())).error, /keyword is required/);
    assert.match((await search.captureNotesSearch({ keyword: 'p', notes: 'x' }, SCOPE_A, deps())).error, /notes must be a list/);
    assert.match((await search.captureNotesSearch({ keyword: 'p', notes: [], extra: 1 }, SCOPE_A, deps())).error, /extra/);
    assert.match((await search.captureNotesSearch({ keyword: 'p', notes: [] }, {}, deps())).error, /No project is selected/);
  } finally {
    restore();
  }
});

test('one project\'s Notes search never touches another\'s writers', async () => {
  const { miner, search, restore } = withDb();
  try {
    await search.captureNotesSearch({ keyword: 'polymath', notes: FIVE }, SCOPE_A, deps());
    assert.equal((await all(miner, SCOPE_B)).length, 0);
  } finally {
    restore();
  }
});

test('the profile reads are spaced by the Miner\'s own pause, one per author', async () => {
  const { search, restore } = withDb();
  try {
    const calls = [];
    const waits = [];
    await search.captureNotesSearch({ keyword: 'polymath', notes: FIVE }, SCOPE_A, {
      fetchJson: fakeFetch(calls),
      sleep: async (ms) => { waits.push(ms); },
    });
    assert.equal(calls.length, 4, 'one profile read per author, not per Note');
    assert.deepEqual(waits, [1500, 1500, 1500]);
  } finally {
    restore();
  }
});

test('a later 5/7 read keeps the found Note behind the dated ones rather than in a random place', async () => {
  const { miner, search, restore } = withDb();
  try {
    await search.captureNotesSearch({ keyword: 'polymath', notes: FIVE.slice(0, 1) }, SCOPE_A, deps());
    const ada = (await all(miner)).find((r) => r.handle === 'adawrites');
    const read = await miner.recordRecentNotes(ada.id, [
      { url: 'https://substack.com/@ada/note/c-50', text: 'a', postedAt: '2026-10-01T00:00:00Z' },
      { url: 'https://substack.com/@ada/note/c-60', text: 'b', postedAt: '2026-10-05T00:00:00Z' },
    ], SCOPE_A);
    assert.equal(read.ok, true, read.error);
    assert.deepEqual(read.data.candidate.recentNotes.map((n) => n.url), [
      'https://substack.com/@ada/note/c-60',
      'https://substack.com/@ada/note/c-50',
      'https://substack.com/@ada/note/c-1',
    ]);
  } finally {
    restore();
  }
});

// ── The Mini's pass: one keyword, through the signed-in browser ──────────────

async function settingsFor(miner, notes, { keywords = ['polymath', 'renaissance'], active = null } = {}) {
  const saved = await miner.saveSettings({ keywords, maxResultsPerKeyword: 20 }, SCOPE_A);
  assert.equal(saved.ok, true, saved.error);
  if (active) {
    const acct = await notes.saveSettings({ activeStartHour: active[0], activeEndHour: active[1], timeZone: 'UTC' }, SCOPE_A);
    assert.equal(acct.ok, true, acct.error);
  }
}

function browser(answer, asked = []) {
  return async (request) => {
    asked.push(request);
    return { ok: true, status: 200, text: JSON.stringify(answer) };
  };
}

const SIGNED_IN = { signedIn: true, accountName: 'Dane of Earth' };

test('the pass searches the named keyword, says which, and adds what the browser found', async () => {
  const { miner, notes, search, restore } = withDb();
  try {
    await settingsFor(miner, notes);
    const asked = [];
    const run = await search.runNotesSearchPass({ keyword: 'Polymath' }, SCOPE_A, deps({
      callOpenClaw: browser({ ...SIGNED_IN, notes: FIVE }, asked),
    }));
    assert.equal(run.ok, true, run.error);
    assert.equal(run.data.keyword, 'polymath');
    assert.equal(run.data.keywordChosen, 'named');
    assert.equal(run.data.added.length, 4);
    assert.equal(asked.length, 1, 'one browser request per pass');
    assert.match(asked[0].input, /substack\.com\/search\/polymath/);
    assert.match(asked[0].input, /"Notes" tab/);
    assert.match(asked[0].input, /at most 20/);
    const printed = search.formatSearchSummary(run.data);
    assert.match(printed, /^Keyword: "polymath"/);
    assert.match(printed, /5 Notes read by 4 authors: 4 writers added/);
  } finally {
    restore();
  }
});

test('without a keyword the pass takes this hour\'s turn — one keyword, never all of them', async () => {
  const { miner, notes, search, restore } = withDb();
  try {
    await settingsFor(miner, notes);
    const asked = [];
    const hour = 60 * 60 * 1000;
    const run = await search.runNotesSearchPass({}, SCOPE_A, deps({
      callOpenClaw: browser({ ...SIGNED_IN, notes: [] }, asked),
      now: () => 13 * hour,
    }));
    assert.equal(run.ok, true, run.error);
    assert.equal(run.data.keyword, 'renaissance');
    assert.equal(run.data.keywordChosen, 'keyword 2 of 2, this hour\'s turn');
    assert.equal(asked.length, 1);
  } finally {
    restore();
  }
});

test('signed out, or signed in as someone else, the pass refuses with the reason and writes nothing', async () => {
  const { miner, notes, search, restore } = withDb();
  try {
    await settingsFor(miner, notes);
    const out = await search.runNotesSearchPass({ keyword: 'polymath' }, SCOPE_A, deps({
      callOpenClaw: browser({ signedIn: false, accountName: null, notes: FIVE }),
    }));
    assert.equal(out.ok, false);
    assert.equal(out.keyword, 'polymath');
    assert.match(out.error, /signed out of Dane of Earth/);
    assert.equal(out.signIn.kind, 'signed_out');

    const other = await search.runNotesSearchPass({ keyword: 'polymath' }, SCOPE_A, deps({
      callOpenClaw: browser({ signedIn: true, accountName: 'Somebody Else', notes: FIVE }),
    }));
    assert.equal(other.ok, false);
    assert.match(other.error, /Somebody Else/);
    assert.equal((await all(miner)).length, 0);
  } finally {
    restore();
  }
});

test('an answer the pass cannot read, or OpenClaw down, is "could not tell" (502), not a refusal', async () => {
  const { miner, notes, search, restore } = withDb();
  try {
    await settingsFor(miner, notes);
    const garbled = await search.runNotesSearchPass({ keyword: 'polymath' }, SCOPE_A, deps({
      callOpenClaw: async () => ({ ok: true, status: 200, text: 'I could not find the page' }),
    }));
    assert.equal(garbled.status, 502);
    const down = await search.runNotesSearchPass({ keyword: 'polymath' }, SCOPE_A, deps({
      callOpenClaw: async () => ({ ok: false, status: 502, error: 'Failed to reach OpenClaw' }),
    }));
    assert.equal(down.status, 502);
    assert.equal((await all(miner)).length, 0);
  } finally {
    restore();
  }
});

test('outside the account\'s active hours the pass does not open the browser at all', async () => {
  const { miner, notes, search, restore } = withDb();
  try {
    await settingsFor(miner, notes, { active: [9, 17] });
    const asked = [];
    const at3am = Date.parse('2026-10-10T03:00:00Z');
    const run = await search.runNotesSearchPass({ keyword: 'polymath' }, SCOPE_A, deps({
      callOpenClaw: browser({ ...SIGNED_IN, notes: FIVE }, asked),
      now: () => at3am,
    }));
    assert.equal(run.status, 409);
    assert.match(run.error, /^Not searching now/);
    assert.equal(asked.length, 0);
    const anyHour = await search.runNotesSearchPass({ keyword: 'polymath', anyHour: true }, SCOPE_A, deps({
      callOpenClaw: browser({ ...SIGNED_IN, notes: FIVE }, asked),
      now: () => at3am,
    }));
    assert.equal(anyHour.ok, true, anyHour.error);
  } finally {
    restore();
  }
});

test('a keyword that is not on the Run tab is refused, naming the list', async () => {
  const { miner, notes, search, restore } = withDb();
  try {
    await settingsFor(miner, notes);
    const run = await search.runNotesSearchPass({ keyword: 'astrology' }, SCOPE_A, deps({ callOpenClaw: browser(SIGNED_IN) }));
    assert.equal(run.ok, false);
    assert.match(run.error, /"astrology" is not one of the keywords on the Run tab \(polymath, renaissance\)/);
  } finally {
    restore();
  }
});

test('the browser\'s list is cut to max_results_per_keyword and each Note to 300 characters', async () => {
  const { miner, notes, search, restore } = withDb();
  try {
    await miner.saveSettings({ keywords: ['polymath'], maxResultsPerKeyword: 2 }, SCOPE_A);
    const long = 'x'.repeat(900);
    const run = await search.runNotesSearchPass({ keyword: 'polymath' }, SCOPE_A, deps({
      callOpenClaw: browser({ ...SIGNED_IN, notes: FIVE.map((n) => ({ ...n, text: long })) }),
    }));
    assert.equal(run.ok, true, run.error);
    assert.equal(run.data.notesSent, 2);
    const ada = (await all(miner)).find((r) => r.handle === 'adawrites');
    assert.equal(ada.recentNotes[0].text.length, 300);
    void notes;
  } finally {
    restore();
  }
});
