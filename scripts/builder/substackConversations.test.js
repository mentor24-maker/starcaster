'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * Outreach wizard 14/19 (86bcrmbqu) — Substack finds conversations on its own:
 * the two-hourly read and the six-hourly search are scheduled, what they find
 * is ranked with a reason on every row, and a reading that did not come back
 * reads as "cannot tell", never as "0 found".
 *
 * Every store is a fake handed in through `deps`, so nothing here touches a
 * database, the network or a browser.
 */

const ranking = require('../../lib/outreachRanking');
const conversations = require('../../lib/substackConversations');
const readDue = require('../../lib/acquire/SubstackNotesReadDue');
const searchDue = require('../../lib/acquire/SubstackNotesSearchDue');
const { parseProfileNotes } = require('../../lib/acquire/SubstackNotesReadRun');
const os = require('os');
const { activeHoursVerdict } = require('../../lib/acquire/SubstackNotesReadRun');

const ROOT = path.join(__dirname, '..', '..');
const NOW = Date.parse('2026-10-28T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SCOPE = { projectId: 'proj_a', userId: 'user_1' };

const CANON = [
  { docKey: 'VOICE', body: 'attention attention attention attention plainly plainly plainly' },
  { docKey: 'THESIS', body: 'polymath polymath polymath attention attention attention commons commons commons the the the' },
];

// ── the ranking ────────────────────────────────────────────────────────────

test('canon words come from the thesis documents, never from the voice document', () => {
  const terms = ranking.canonTerms(CANON);
  assert.ok(terms.includes('polymath'));
  assert.ok(terms.includes('commons'));
  assert.ok(!terms.includes('plainly'), 'the VOICE document is about how he writes, not what about');
  assert.ok(!terms.includes('the'), 'short filler is not a canon word');
});

test('every scored conversation carries a reason naming what put it there', () => {
  const terms = ranking.canonTerms(CANON);
  const s = ranking.scoreConversation({
    text: 'Where are the polymaths and the commons?', postedAt: new Date(NOW - 3 * HOUR).toISOString(),
    approved: true, replies: 4, likes: 10,
  }, { terms, now: NOW });
  assert.equal(s.parts.source, ranking.WEIGHTS.approved);
  assert.equal(s.parts.recency, ranking.WEIGHTS.recency);
  assert.equal(s.parts.canon, 10, '"polymaths" is not "polymath"; only "commons" matches');
  assert.ok(s.parts.conversation > 0);
  assert.match(s.reason, /^From a writer you approved, posted 3 hours ago, mentions "commons" from your canon, already has 4 replies and 10 likes\.$/);
});

test('a keyword hit with no date says it was FOUND, not posted, and ranks below an approved writer', () => {
  const ranked = ranking.rankConversations([
    { url: 'k', text: 'nothing', foundAt: new Date(NOW - HOUR * 2).toISOString(), keyword: 'polymath' },
    { url: 'a', text: 'nothing', postedAt: new Date(NOW - HOUR * 2).toISOString(), approved: true },
  ], { terms: [], now: NOW });
  assert.deepEqual(ranked.map((r) => r.url), ['a', 'k']);
  assert.match(ranked[1].reason, /^Found by your keyword "polymath", found 2 hours ago \(no posting date\)\.$/);
});

test('recency runs out after a week; a Note with nothing going for it still gets a sentence', () => {
  const old = ranking.scoreConversation({ text: '', postedAt: new Date(NOW - 8 * DAY).toISOString() }, { now: NOW });
  assert.equal(old.parts.recency, 0);
  const bare = ranking.scoreConversation({}, { now: NOW });
  assert.equal(bare.score, 0);
  assert.ok(bare.reason.length > 10);
});

// ── the reader keeps how much conversation a Note has ──────────────────────

test('the profile feed parser keeps replies and likes (children_count, reaction_count)', () => {
  const feed = { items: [{ type: 'comment', context: { type: 'note' }, comment: {
    id: 77, user_id: 9, handle: 'ann', body: 'hi', date: '2026-10-27T10:00:00Z', ancestor_path: '',
    children_count: 3, reaction_count: 12,
  } }] };
  const [n] = parseProfileNotes(feed, 9, 'ann');
  assert.equal(n.replies, 3);
  assert.equal(n.likes, 12);
});

test('the miner store accepts replies and likes on a Note, and refuses a bad count', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/substackMinerStore.js'), 'utf8');
  assert.match(src, /unknownKeyError\(note, \['url', 'text', 'postedAt', 'replies', 'likes'\]\)/);
  assert.match(src, /must be a whole number, 0 or more/);
});

// ── the list ───────────────────────────────────────────────────────────────

function note(id, extra = {}) {
  return { url: `https://substack.com/@ann/note/c-${id}`, text: `note ${id} about the commons`, postedAt: new Date(NOW - HOUR).toISOString(), ...extra };
}

function fakeDeps({ candidates, items = [], skipped = [], canonOk = true } = {}) {
  const recorded = [];
  const created = [];
  const drafted = [];
  return {
    recorded,
    created,
    drafted,
    deps: {
      now: () => NOW,
      canonDocs: canonOk ? CANON : undefined,
      minerStore: { listCandidates: async () => ({ ok: true, data: candidates }) },
      notesStore: {
        DEFAULT_ACCOUNT: 'dane-of-earth',
        listItems: async () => ({ ok: true, data: items }),
        normalizeNoteUrl: require('../../lib/substackNotesStore').normalizeNoteUrl,
        createItem: async (input) => { created.push(input); return { ok: true, data: { id: 'item_new', status: 'idea' } }; },
        writeDraftForItem: async (id) => { drafted.push(id); return { ok: true, data: { id, status: 'draft' } }; },
      },
      feedbackStore: {
        readRejectInput: require('../../lib/outreachFeedbackStore').readRejectInput,
        listDecidedItemIds: async () => ({ ok: true, data: skipped }),
        recordFeedback: async (entry) => { recorded.push(entry); return { ok: true, data: { id: 'fb1' } }; },
      },
    },
  };
}

const ANN = (extra = {}) => ({
  id: 'w1', handle: 'ann', name: 'Ann', status: 'approved', publicationUrl: 'https://ann.substack.com',
  lastNotesReadAt: new Date(NOW - DAY).toISOString(), recentNotes: [note(1)], ...extra,
});

test('the list ranks the read Notes and names their writer, with a profile link', async () => {
  const { deps } = fakeDeps({ candidates: [ANN()] });
  const res = await conversations.listSubstackConversations(SCOPE, deps);
  assert.equal(res.ok, true);
  assert.equal(res.data.newCount, 1);
  const [c] = res.data.items;
  assert.equal(c.writer.name, 'Ann');
  assert.equal(c.author.profileUrl, 'https://substack.com/@ann');
  assert.ok(c.reason);
  assert.equal(res.data.reading.state, 'current');
});

test('the count is every Note found, not the 50 listed; the reading sentence says 8 days and minds its grammar', async () => {
  const many = Array.from({ length: 70 }, (_, i) => note(i + 1));
  const { deps } = fakeDeps({ candidates: [ANN({ recentNotes: many })] });
  const res = await conversations.listSubstackConversations(SCOPE, deps);
  assert.equal(res.data.items.length, 50);
  assert.equal(res.data.newCount, 70);
  assert.equal(res.data.reading.sentence, 'The one approved writer was read in the last 8 days.');
  const two = await conversations.listSubstackConversations(SCOPE, fakeDeps({ candidates: [ANN(), ANN({ id: 'w2', handle: 'bo', name: 'Bo', recentNotes: [] })] }).deps);
  assert.equal(two.data.reading.sentence, 'All 2 approved writers were read in the last 8 days.');
  const { conversationsStage } = require('../../lib/outreachOverview');
  const stage = await conversationsStage({ listSubstackConversations: async () => res }, SCOPE, { label: 'x', page: 'y' });
  assert.equal(stage.sentence, '70 new Notes worth replying to; the best 50 are listed, best first.');
});

test('an approved writer never read is CANNOT TELL — never "0 found"', async () => {
  const { deps } = fakeDeps({ candidates: [ANN({ lastNotesReadAt: null, recentNotes: [] })] });
  const res = await conversations.listSubstackConversations(SCOPE, deps);
  assert.equal(res.data.newCount, 0);
  assert.equal(res.data.reading.state, 'cannot_tell');
  assert.match(res.data.reading.sentence, /never been read \(Ann\)/);
});

test('a writer whose reading is overdue (refused or timed out every pass) is named', async () => {
  const { deps } = fakeDeps({ candidates: [ANN({ lastNotesReadAt: new Date(NOW - 9 * DAY).toISOString() })] });
  const res = await conversations.listSubstackConversations(SCOPE, deps);
  assert.equal(res.data.reading.state, 'cannot_tell');
  assert.match(res.data.reading.sentence, /not been read for over 8 days \(Ann\)/);
});

test('rejected writers, skipped Notes, decided replies and stale Notes are left out; an open reply is kept', async () => {
  const { deps } = fakeDeps({
    candidates: [
      ANN({ recentNotes: [note(1), note(2), note(3), note(4), note(5, { postedAt: new Date(NOW - 20 * DAY).toISOString() })] }),
      { id: 'w2', handle: 'bob', name: 'Bob', status: 'rejected', recentNotes: [{ ...note(9), url: 'https://substack.com/@bob/note/c-9' }] },
    ],
    items: [
      { id: 'r2', kind: 'reply', targetUrl: note(2).url, status: 'posted' },
      { id: 'r3', kind: 'reply', targetUrl: note(3).url, status: 'idea' },
    ],
    skipped: ['c-4'],
  });
  const res = await conversations.listSubstackConversations(SCOPE, deps);
  const urls = res.data.items.map((i) => i.url).sort();
  assert.deepEqual(urls, [note(1).url, note(3).url]);
  assert.equal(res.data.items.find((i) => i.url === note(3).url).replyItemId, 'r3');
});

test('an unapproved writer appears only for what a keyword found, with an Add writer target', async () => {
  const { deps } = fakeDeps({ candidates: [{
    id: 'w3', handle: 'cy', name: 'Cy', status: 'candidate', recentNotes: [
      { url: 'https://substack.com/@cy/note/c-30', text: 'found', postedAt: '', foundBy: 'notes_search', keyword: 'polymath', foundAt: new Date(NOW - HOUR).toISOString() },
      { url: 'https://substack.com/@cy/note/c-31', text: 'own read', postedAt: new Date(NOW - HOUR).toISOString() },
    ],
  }] });
  const res = await conversations.listSubstackConversations(SCOPE, deps);
  assert.deepEqual(res.data.items.map((i) => i.url), ['https://substack.com/@cy/note/c-30']);
  assert.equal(res.data.items[0].writer.status, 'candidate');
  assert.equal(res.data.reading.state, 'no_writers');
});

test('a store that cannot be read is a refusal naming it, never an empty list', async () => {
  const { deps } = fakeDeps({ candidates: [] });
  deps.minerStore.listCandidates = async () => ({ ok: false, status: 502, error: 'boom' });
  const res = await conversations.listSubstackConversations(SCOPE, deps);
  assert.equal(res.ok, false);
  assert.match(res.error, /writer list could not be read: boom/);
});

test('Skip records the reason under the Note\'s comment id; Write replies lines up ONE reply and drafts it', async () => {
  const f = fakeDeps({ candidates: [ANN({ recentNotes: [note(1), note(3)] })], items: [{ id: 'r3', kind: 'reply', targetUrl: note(3).url, status: 'idea' }] });
  const skip = await conversations.skipConversation({ url: note(1).url, reasons: ['too generic'], note: '' }, SCOPE, f.deps);
  assert.equal(skip.ok, true);
  assert.equal(f.recorded[0].itemId, 'c-1');
  assert.equal(f.recorded[0].itemKind, 'conversation');
  assert.deepEqual(f.recorded[0].reasons, ['too generic']);

  const fresh = await conversations.writeRepliesFor({ url: note(1).url }, SCOPE, f.deps);
  assert.equal(fresh.ok, true);
  assert.equal(f.created.length, 1, 'no reply existed for note 1, so one is made');
  const reuse = await conversations.writeRepliesFor({ url: note(3).url }, SCOPE, f.deps);
  assert.equal(reuse.data.itemId, 'r3');
  assert.equal(f.created.length, 1, 'the waiting reply idea is used, not a second one');
  assert.deepEqual(f.drafted, ['item_new', 'r3']);
});

test('Skip and Write replies refuse a Note that is not on the list', async () => {
  const f = fakeDeps({ candidates: [ANN()] });
  const res = await conversations.skipConversation({ url: 'https://substack.com/@zed/note/c-999' }, SCOPE, f.deps);
  assert.equal(res.status, 404);
  assert.equal(f.recorded.length, 0);
});

// ── the two-hourly read on Vercel ──────────────────────────────────────────

test('the scheduled read runs each project, reports "not now" apart from failures, and shares one clock', async () => {
  let clock = NOW;
  const seen = [];
  const res = await readDue.runNotesReadDue({
    now: () => clock,
    budgetMs: 80000,
    projectTimeZone: async () => 'UTC',
    discover: async () => ({ ok: true, data: [{ projectId: 'p1', userId: 'u' }, { projectId: 'p2', userId: 'u' }, { projectId: 'p3', userId: 'u' }, { projectId: 'p4', userId: 'u' }] }),
    read: async (input, scope, readDeps) => {
      seen.push([scope.projectId, readDeps.timeBudgetMs]);
      clock += 25000;
      if (scope.projectId === 'p1') return { ok: true, data: { approved: 2, read: [{ notes: 3 }], skipped: [], failed: [{ handle: 'x', reason: 'answered HTTP 403' }], notReached: [] } };
      if (scope.projectId === 'p2') return { ok: false, status: 409, error: 'outside the active hours' };
      return { ok: false, status: 502, error: 'db down' };
    },
  });
  assert.equal(res.ok, true);
  assert.deepEqual(seen.map((s) => s[0]), ['p1', 'p2', 'p3']);
  assert.equal(seen[1][1], 55000, 'the second project gets what the first left');
  assert.equal(res.data.notNow.length, 1);
  assert.equal(res.data.failed.length, 1);
  assert.equal(res.data.notReached[0].projectId, 'p4');
  const log = readDue.formatReadDueLog(res.data).join('\n');
  assert.match(log, /WRITER NOT READ project=p1 writer=x: answered HTTP 403/);
  assert.match(log, /NOT REACHED project=p4/);
});

test('the read is scheduled every two hours and is a cron-only path', () => {
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const cron = vercel.crons.find((c) => c.path === '/api/acquire/substack-miner/read-notes-due');
  assert.ok(cron, 'vercel.json schedules it');
  assert.match(cron.schedule, /^\d+ \*\/2 \* \* \*$/);
  const index = fs.readFileSync(path.join(ROOT, 'routes/index.js'), 'utf8');
  assert.match(index, /'\/api\/acquire\/substack-miner\/read-notes-due',/);
  const route = fs.readFileSync(path.join(ROOT, 'routes/substackMiner.js'), 'utf8');
  assert.match(route, /read-notes-due`\) \{[\s\S]{0,200}if \(!req\.cronPublish\)/);
});

// ── the six-hourly search on the Mini ──────────────────────────────────────

/** A walk kept in memory, so no test writes the real file in the home folder. */
function memoryWalk(initial = {}) {
  const box = { walk: JSON.parse(JSON.stringify(initial)), writes: 0 };
  box.deps = {
    readWalk: () => ({ walk: JSON.parse(JSON.stringify(box.walk)), note: '' }),
    writeWalk: (walk) => { box.walk = JSON.parse(JSON.stringify(walk)); box.writes += 1; return { ok: true }; },
  };
  return box;
}

test('the keyword walk takes the keyword after the last one searched, and starts again when that one is gone', () => {
  const words = ['a', 'b', 'c'];
  assert.equal(searchDue.nextKeyword(words, '').keyword, 'a');
  assert.equal(searchDue.nextKeyword(words, 'a').keyword, 'b');
  assert.equal(searchDue.nextKeyword(words, 'C').keyword, 'a', 'wraps, and matches regardless of case');
  assert.equal(searchDue.nextKeyword(words, 'removed since').keyword, 'a');
  assert.equal(searchDue.nextKeyword([], 'a').ok, false);
});

test('every keyword is searched, even with the active hours refusing the night pass', async () => {
  // Round-1 review of 86bcrmbqu: walked by six-hour period, four keywords each
  // landed on the same time of day for ever, and the one on the night slot was
  // refused on every pass. Run the walk THROUGH the real active-hours check.
  const words = ['a', 'b', 'c', 'd'];
  const zone = 'America/Denver';
  const hours = { activeStartHour: 8, activeEndHour: 22 };
  const box = memoryWalk();
  const searched = [];
  const start = Date.parse('2026-10-28T00:00:00Z');
  for (let i = 0; i < 16; i += 1) {
    const at = start + i * 6 * HOUR;
    // eslint-disable-next-line no-await-in-loop
    await searchDue.runNotesSearchDue({
      ...box.deps,
      now: () => at,
      projectTimeZone: async () => zone,
      discover: async () => ({ ok: true, data: [{ projectId: 'p1', userId: 'u', keywords: words }] }),
      search: async (input) => {
        if (!activeHoursVerdict(hours, at, zone).ok) return { ok: false, status: 409, error: 'outside the active hours' };
        searched.push(input.keyword);
        return { ok: true, data: { keyword: input.keyword } };
      },
      suggest: async () => ({ ok: true, data: {} }),
    });
  }
  for (const w of words) {
    assert.ok(searched.filter((k) => k === w).length >= 2, `"${w}" searched at least twice in four days (got ${searched.join(',')})`);
  }
  assert.deepEqual(searched.slice(0, 4), words, 'in order, one per pass that searched');
});

test('only a pass that searched moves the walk on; a refused or failed one keeps the keyword\'s turn', async () => {
  const box = memoryWalk({ p1: { lastKeyword: 'a' }, p2: { lastKeyword: 'a' }, p3: { lastKeyword: 'a' } });
  const asked = [];
  const res = await searchDue.runNotesSearchDue({
    ...box.deps,
    now: () => NOW,
    projectTimeZone: async () => 'UTC',
    discover: async () => ({ ok: true, data: ['p1', 'p2', 'p3'].map((projectId) => ({ projectId, userId: 'u', keywords: ['a', 'b', 'c'] })) }),
    search: async (input, scope) => {
      asked.push([scope.projectId, input.keyword]);
      if (scope.projectId === 'p2') return { ok: false, status: 409, error: 'not now' };
      if (scope.projectId === 'p3') return { ok: false, status: 502, error: 'browser down' };
      return { ok: true, data: { keyword: input.keyword } };
    },
    suggest: async () => ({ ok: true, data: {} }),
  });
  assert.deepEqual(asked, [['p1', 'b'], ['p2', 'b'], ['p3', 'b']]);
  assert.equal(box.walk.p1.lastKeyword, 'b');
  assert.equal(box.walk.p2.lastKeyword, 'a', 'not now: b waits for the next pass');
  assert.equal(box.walk.p3.lastKeyword, 'a', 'failed: b waits for the next pass');
  assert.equal(res.data.searched, 1);
});

test('a walk that cannot be saved is a failure, or every pass would search the same keyword', async () => {
  const res = await searchDue.runNotesSearchDue({
    readWalk: () => ({ walk: {}, note: '' }),
    writeWalk: () => ({ ok: false, error: 'The keyword walk could not be saved to X: EACCES' }),
    now: () => NOW,
    projectTimeZone: async () => 'UTC',
    discover: async () => ({ ok: true, data: [{ projectId: 'p1', userId: 'u', keywords: ['a'] }] }),
    search: async (input) => ({ ok: true, data: { keyword: input.keyword } }),
    suggest: async () => ({ ok: true, data: {} }),
  });
  assert.equal(res.data.failed, 1);
  assert.match(searchDue.formatSearchDueLog(res.data, { formatSearchSummary: () => 's' }), /WALK NOT SAVED: .*EACCES/);
});

test('the walk file: missing is a first pass, unreadable starts again and says so, and a save reads back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-walk-'));
  try {
    const file = path.join(dir, 'nested', 'walk.json');
    assert.deepEqual(searchDue.readWalk({ file }), { walk: {}, note: '' });
    assert.equal(searchDue.writeWalk({ p1: { lastKeyword: 'b' } }, { file }).ok, true);
    assert.equal(searchDue.readWalk({ file }).walk.p1.lastKeyword, 'b');
    fs.writeFileSync(file, '{not json');
    const broken = searchDue.readWalk({ file });
    assert.deepEqual(broken.walk, {});
    assert.match(broken.note, /starting it again at the first keyword/);
    assert.match(searchDue.walkFile('/Users/x'), /Application Support\/starcaster\/substack-notes-search-walk\.json$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a pass that searched nothing is not a clean pass: it exits 4 and the runner records no beat for it', async () => {
  const res = await searchDue.runNotesSearchDue({
    ...memoryWalk().deps,
    now: () => NOW,
    projectTimeZone: async () => 'UTC',
    discover: async () => ({ ok: true, data: [{ projectId: 'p1', userId: 'u', keywords: ['a'] }] }),
    search: async () => ({ ok: false, status: 409, error: 'outside the active hours' }),
    suggest: async () => ({ ok: true, data: {} }),
  });
  assert.equal(res.data.searched, 0);
  assert.equal(res.data.failed, 0);
  assert.match(searchDue.formatSearchDueLog(res.data, { formatSearchSummary: () => 's' }), /Nothing was searched this pass, so no beat/);
  const script = fs.readFileSync(path.join(ROOT, 'scripts/substack_notes_search_due.mjs'), 'utf8');
  assert.match(script, /process\.exit\(run\.data\.searched \? 0 : NOTHING_SEARCHED\)/);
  assert.match(script, /const NOTHING_SEARCHED = 4;/);
  const runner = fs.readFileSync(path.join(ROOT, 'scripts/run_substack_notes_search.sh'), 'utf8');
  const branch = runner.match(/elif \[ "\$status" -eq 4 \]; then\n([\s\S]*?)\nelse/);
  assert.ok(branch, 'the runner has its own branch for exit 4');
  assert.doesNotMatch(branch[1], /heartbeat|report:failure/, 'exit 4 neither beats nor posts a failure');
});

test('Suggest runs after every successful search; a refused search is a failure, not "found nothing"', async () => {
  const suggested = [];
  const res = await searchDue.runNotesSearchDue({
    ...memoryWalk().deps,
    now: () => NOW,
    projectTimeZone: async () => 'UTC',
    discover: async () => ({ ok: true, data: [
      { projectId: 'p1', userId: 'u', keywords: ['polymath'] },
      { projectId: 'p2', userId: 'u', keywords: ['commons'] },
      { projectId: 'p3', userId: 'u', keywords: ['x'] },
    ] }),
    search: async (input, scope) => {
      if (scope.projectId === 'p2') return { ok: false, status: 401, error: 'Not searching: signed out' };
      if (scope.projectId === 'p3') return { ok: false, status: 409, error: 'outside hours' };
      return { ok: true, data: { keyword: input.keyword, notesSent: 2, authors: 1, added: [], merged: [], notAdded: [], refusedNotes: [], notesStored: 2 } };
    },
    suggest: async (scope) => { suggested.push(scope.projectId); return { ok: true, data: { suggested: [{}] } }; },
  });
  assert.deepEqual(suggested, ['p1']);
  assert.deepEqual(res.data.projects.map((p) => p.verdict), ['searched', 'failed', 'not_now']);
  assert.equal(res.data.failed, 1);
  const log = searchDue.formatSearchDueLog(res.data, { formatSearchSummary: () => 'summary' });
  assert.match(log, /SEARCH FAILED: Not searching: signed out/);
  assert.match(log, /1 searched, 1 not now .* 1 failed/);
});

test('the Mini job is the Mini\'s, its runner beats only on a clean pass, and the roll call says why it is not beating yet', () => {
  const roles = require('../../lib/nodeRoles');
  const hb = require('../../lib/nodeHeartbeat');
  assert.equal(roles.ROLES['substack-notes-search'].owner, roles.ROLES.openclaw.owner, 'it needs the OpenClaw browser');
  assert.ok(hb.NOT_REPORTING_WHY['substack-notes-search'] || hb.BEAT_EMITTERS['substack-notes-search']);
  const runner = fs.readFileSync(path.join(ROOT, 'scripts/run_substack_notes_search.sh'), 'utf8');
  assert.match(runner, /if \[ "\$status" -eq 0 \]; then\n\s+npm run --silent heartbeat -- --beat --role "\$ROLE"/);
  const installer = fs.readFileSync(path.join(ROOT, 'scripts/install_substack_notes_search.sh'), 'utf8');
  assert.match(installer, /<integer>21600<\/integer>/);
});

// ── the stage sentence is the headline ─────────────────────────────────────

test('the Find conversations stage says how many, and is CANNOT TELL — never "0 found" — while a reading is missing', async () => {
  const { conversationsStage } = require('../../lib/outreachOverview');
  const fake = (newCount, state, sentence = 'S.') => ({ listSubstackConversations: async () => ({ ok: true, data: { newCount, reading: { state, sentence } } }) });
  const next = { label: 'Open Substack Notes', page: 'engageSubstackNotesPage' };
  const three = await conversationsStage(fake(3, 'current'), SCOPE, next);
  assert.equal(three.state, 'needs_you');
  assert.equal(three.sentence, '3 new Notes worth replying to, best first.');
  const blind = await conversationsStage(fake(0, 'cannot_tell', 'Cannot tell whether there is more: Ann was never read.'), SCOPE, next);
  assert.equal(blind.state, 'cannot_tell');
  assert.doesNotMatch(blind.sentence, /\b0\b/);
  const partial = await conversationsStage(fake(2, 'cannot_tell', 'Cannot tell: Ann was never read.'), SCOPE, next);
  assert.equal(partial.state, 'cannot_tell');
  assert.match(partial.sentence, /^2 new Notes worth replying to so far\. Cannot tell/);
  const quiet = await conversationsStage(fake(0, 'current', 'All 4 approved writers were read in the last week.'), SCOPE, next);
  assert.equal(quiet.state, 'done');
  assert.match(quiet.sentence, /^Nothing new to reply to\. All 4/);
  const broken = await conversationsStage({ listSubstackConversations: async () => ({ ok: false, error: 'db down' }) }, SCOPE, next);
  assert.equal(broken.state, 'cannot_tell');
});
