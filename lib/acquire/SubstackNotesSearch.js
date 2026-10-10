'use strict';

/**
 * Substack Miner — find writers through Substack's Notes search (Substack
 * Miner 6/7, task 86bcfpry2). The web search in 2/7 indexes publications and
 * posts, not Notes, so it cannot find the people who write "Dear Substack,
 * connect me with the polymaths…" Notes, or the people who answer them.
 *
 * TWO HALVES, ONE FILE.
 *
 *   captureNotesSearch   what POST /api/acquire/substack-miner/notes-search
 *                        runs: `{ keyword, notes: [{ authorHandle, authorName,
 *                        url, text }] }` → each author upserted as a candidate
 *                        (`found_via: 'notes_search'` on a first find), the
 *                        keyword merged into `keywords_hit`, the Note kept on
 *                        `recent_notes` as evidence (deduplicated by link).
 *
 *   runNotesSearchPass   the Mini's pass (npm run substack-miner:search-notes):
 *                        ONE keyword, through OpenClaw's signed-in browser, then
 *                        the capture above.
 *
 * WHY A BROWSER HERE, WHEN 5/7 NEEDED NONE. 5/7 found that a writer's own
 * Notes come from a public feed. Search does not: Substack's public search
 * (`/api/v1/top/search`) answers with posts and profiles and at most a stray
 * Note, and takes no filter that narrows it to Notes (measured 2026-10-10:
 * `type`, `searchType`, `tab`, `filter`, `searching` and `types[]` all
 * returned the same mixed list for "polymath" — 11 posts, one Note). The Notes
 * tab exists only on the page, so the browser reads it.
 *
 * WHO A NOTE'S AUTHOR IS, AS A CANDIDATE. A candidate is a PUBLICATION (its
 * handle is the part before .substack.com); a Note's author is a PERSON, whose
 * @handle can differ from their publication's, or who may have none. So each
 * author's public profile (`/api/v1/user/<handle>/public_profile`, no sign-in)
 * says which publication is theirs — their primary one, else one they are the
 * admin of. An author with none is reported by name as not added, never
 * guessed: a guess would put a stranger's publication on Dane's list.
 *
 * Every outside dependency comes in through `deps`, so
 * scripts/builder/substackNotesSearch.test.js drives both halves with no
 * network and no browser.
 */

const minerStore = require('../substackMinerStore');
const { fetchSubstackJson, activeHoursVerdict } = require('./SubstackNotesReadRun');
const { unknownKeyError } = require('../storeInput');

/** The fields one found Note may carry, as the browser sends them. */
const NOTE_FIELDS = ['authorHandle', 'authorName', 'url', 'text'];
/** The most Notes one keyword's page may send — max_results_per_keyword tops out at 100. */
const MAX_NOTES_PER_SEARCH = 100;
/** The browser reading one results page: open, choose the tab, read, answer. */
const SEARCH_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_PROFILE = 'dane-of-earth';
const HOUR_MS = 60 * 60 * 1000;

// A Substack person's @handle: letters, numbers, underscores, dots and dashes.
const PERSON_HANDLE_RE = /^[a-z0-9_][a-z0-9_.-]{0,79}$/;

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

function text(value) {
  return String(value == null ? '' : value).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** "@Name" or "substack.com/@name" → "name"; '' when it is not a handle. */
function personHandle(value) {
  let raw = text(value);
  const fromLink = raw.match(/substack\.com\/@([^/?#]+)/i);
  if (fromLink) raw = fromLink[1];
  raw = raw.replace(/^@+/, '').toLowerCase();
  return PERSON_HANDLE_RE.test(raw) ? raw : '';
}

/**
 * Which publication a Substack person writes, from their public profile: the
 * primary publication, else the first one they are the admin of. Never throws.
 */
async function publicationForAuthor(handle, { fetchJson }) {
  const profile = await fetchJson(`https://substack.com/api/v1/user/${encodeURIComponent(handle)}/public_profile`);
  if (!profile.ok) return { ok: false, reason: `their Substack profile ${profile.reason}` };
  const p = profile.data || {};
  const primary = p.primaryPublication;
  if (text(primary?.subdomain)) {
    return { ok: true, handle: text(primary.subdomain).toLowerCase(), name: text(primary.name) };
  }
  const admin = (Array.isArray(p.publicationUsers) ? p.publicationUsers : [])
    .find((pu) => text(pu?.role) === 'admin' && text(pu?.publication?.subdomain));
  if (admin) {
    return { ok: true, handle: text(admin.publication.subdomain).toLowerCase(), name: text(admin.publication.name) };
  }
  return { ok: false, reason: 'they write Notes but have no Substack publication of their own, so there is nothing to add as a candidate' };
}

/**
 * Store what one keyword's Notes search found. Every Note is judged on its own:
 * a bad one is refused and NAMED (position and why) while the good ones are
 * used, and every author is accounted for — added, merged, or not added with
 * the reason.
 */
async function captureNotesSearch(input, scope = null, deps = {}) {
  const store = deps.minerStore || minerStore;
  const fetchJson = deps.fetchJson || fetchSubstackJson;
  const wait = deps.sleep || sleep;
  const { normalizeNoteUrl } = require('../substackNotesStore');

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return refuse('The request must be an object like { "keyword", "notes": [{ "authorHandle", "authorName", "url", "text" }] }');
  }
  const unknown = unknownKeyError(input, ['keyword', 'notes']);
  if (unknown) return unknown;
  if (typeof input.keyword !== 'string' || !input.keyword.trim()) {
    return refuse('keyword is required — the keyword whose Notes search found these');
  }
  const keyword = input.keyword.trim();
  if (keyword.length > 200) return refuse('keyword must be 200 characters or fewer');
  if (!Array.isArray(input.notes)) return refuse('notes must be a list like [{ "authorHandle", "authorName", "url", "text" }]');
  if (input.notes.length > MAX_NOTES_PER_SEARCH) {
    return refuse(`notes can hold at most ${MAX_NOTES_PER_SEARCH} Notes at a time — got ${input.notes.length}`);
  }

  // Settings first: a missing project or table stops the whole thing, loudly.
  const settings = await store.getSettings(scope);
  if (!settings.ok) return settings;
  const pauseMs = Math.max(0, Number(settings.data.pauseMsBetweenFetches ?? minerStore.SETTINGS_DEFAULTS.pauseMsBetweenFetches) || 0);

  const summary = {
    keyword,
    notesSent: input.notes.length,
    authors: 0,
    added: [],
    merged: [],
    notAdded: [],
    refusedNotes: [],
    notesStored: 0,
  };

  // Group by author, keeping the order they were found in.
  const byAuthor = new Map();
  input.notes.forEach((note, index) => {
    const where = `notes[${index}]`;
    if (!note || typeof note !== 'object' || Array.isArray(note)) {
      summary.refusedNotes.push({ index, error: `${where} must be an object like { "authorHandle", "authorName", "url", "text" }` });
      return;
    }
    const bad = unknownKeyError(note, NOTE_FIELDS);
    if (bad) {
      summary.refusedNotes.push({ index, error: `${where}: ${bad.error}` });
      return;
    }
    const author = personHandle(note.authorHandle);
    if (!author) {
      summary.refusedNotes.push({ index, error: `${where}.authorHandle ${JSON.stringify(note.authorHandle)} is not a Substack @handle` });
      return;
    }
    const url = normalizeNoteUrl(note.url);
    if (!url.ok || !url.value) {
      summary.refusedNotes.push({ index, error: `${where}.url is not a Note's own link (it ends /note/c-<number>) — got ${JSON.stringify(note.url)}` });
      return;
    }
    if (!byAuthor.has(author)) byAuthor.set(author, { name: '', notes: [] });
    const entry = byAuthor.get(author);
    if (!entry.name) entry.name = text(note.authorName).slice(0, 300);
    entry.notes.push({ url: url.value, text: text(note.text) });
  });
  summary.authors = byAuthor.size;

  let fetches = 0;
  const politeFetch = async (url) => {
    if (fetches > 0 && pauseMs) await wait(pauseMs);
    fetches += 1;
    return fetchJson(url);
  };

  for (const [author, entry] of byAuthor) {
    const label = entry.name || `@${author}`;
    const pub = await publicationForAuthor(author, { fetchJson: politeFetch });
    if (!pub.ok) {
      summary.notAdded.push({ authorHandle: author, name: label, reason: pub.reason });
      continue;
    }
    const saved = await store.upsertCandidate({
      handle: pub.handle,
      name: pub.name || entry.name,
      keywordsHit: [keyword],
      foundVia: 'notes_search',
    }, scope);
    if (!saved.ok) {
      // A tenancy or database failure is not one writer's fault: stop and say so.
      if (saved.status !== 400) return saved;
      summary.notAdded.push({ authorHandle: author, name: label, reason: saved.error });
      continue;
    }
    const kept = await store.recordFoundNotes(saved.data.id, entry.notes, keyword, scope, { now: deps.now ? deps.now() : undefined });
    if (!kept.ok) {
      return { ...kept, error: `${label} was saved as a candidate, but the Notes that found them could not be kept: ${kept.error}` };
    }
    summary.notesStored += kept.data.stored;
    const row = { authorHandle: author, handle: pub.handle, name: pub.name || label, notes: kept.data.stored };
    if (saved.status === 201) summary.added.push(row);
    else summary.merged.push(row);
  }

  return { ok: true, status: 200, data: summary };
}

/**
 * Which keyword this pass searches. A named one must be on the list; otherwise
 * the list is walked one keyword per hour, so an hourly pass covers every
 * keyword in turn without keeping any state of its own.
 */
function pickKeyword(keywords, requested, now) {
  const list = (Array.isArray(keywords) ? keywords : []).map(text).filter(Boolean);
  if (!list.length) {
    return refuse('There are no keywords to search — add some on the Substack Miner Run tab first.');
  }
  const wanted = text(requested);
  if (wanted) {
    const found = list.find((k) => k.toLowerCase() === wanted.toLowerCase());
    if (!found) return refuse(`"${wanted}" is not one of the keywords on the Run tab (${list.join(', ')}). Add it there first.`);
    return { ok: true, keyword: found, how: 'named' };
  }
  const index = Math.floor(now / HOUR_MS) % list.length;
  return { ok: true, keyword: list[index], how: `keyword ${index + 1} of ${list.length}, this hour's turn` };
}

/** The browser instructions for one keyword's Notes search. Pure — tested directly. */
function buildSearchInstructions({ keyword, profile, accountName, max }) {
  const signIn = require('../openclawSignIn').SITES.substack;
  return [
    `Use the browser tool with profile "${profile}".`,
    `First check the browser is signed in to Substack as "${accountName}":`,
    ...signIn.steps.slice(0, 3),
    `If it is signed out, or signed in as anyone other than "${accountName}", stop there and reply with the JSON below with "notes": [].`,
    `Then open https://substack.com/search/${encodeURIComponent(keyword)} and wait for the results.`,
    'Choose the "Notes" tab of the results. If a sort choice is offered, choose the most recent first.',
    `Read the Notes on the first page of results, at most ${max}. Do not scroll for more, open no reply threads, and do not like, restack, reply, follow or subscribe.`,
    'For each Note read: the author\'s @handle (the part after substack.com/@ in the link to their profile), the author\'s display name,',
    'the Note\'s own address (it looks like https://substack.com/@handle/note/c-123456 — read it from the Note\'s time stamp link), and its first 300 characters exactly as written.',
    'Reply with ONLY this JSON and nothing else:',
    '{"signedIn": true or false, "accountName": "the signed-in display name, or null", '
      + '"notes": [{"authorHandle": "...", "authorName": "...", "url": "...", "text": "..."}], '
      + '"problem": "what went wrong, in your own words, or null"}',
  ].join('\n');
}

/**
 * The Mini's pass for one project: ONE keyword through the signed-in browser,
 * then captureNotesSearch.
 *
 *   input.keyword  a keyword from the list (default: this hour's turn)
 *   input.anyHour  true searches even outside the account's active hours
 *
 * Refuses, with the reason and nothing written, when it is outside the active
 * hours (409), when the browser is not signed in as Dane of Earth (`signIn`
 * carries the verdict), or when the browser's answer cannot be read.
 */
async function runNotesSearchPass(input = {}, scope = null, deps = {}) {
  const store = deps.minerStore || minerStore;
  const notesStore = deps.notesStore || require('../substackNotesStore');
  const callOpenClaw = deps.callOpenClaw
    || ((request) => require('../openclawResponsesClient').callOpenClawResponses(request));
  const extractJson = deps.extractJson
    || ((raw) => require('../openclawResponsesClient').extractJsonFromText(raw));
  const signIn = require('../openclawSignIn');
  const now = deps.now || Date.now;
  const projectTimeZone = deps.projectTimeZone || (async () => '');
  const profile = deps.profile || DEFAULT_PROFILE;

  const account = await notesStore.getSettings(scope);
  if (!account.ok) return account;
  const settings = await store.getSettings(scope);
  if (!settings.ok) return settings;

  const pick = pickKeyword(settings.data.keywords, input?.keyword, now());
  if (!pick.ok) return pick;
  const keyword = pick.keyword;

  if (!input?.anyHour) {
    let zone = text(account.data.timeZone);
    const valid = (z) => { try { return Boolean(z) && Boolean(new Intl.DateTimeFormat('en-US', { timeZone: z })); } catch { return false; } };
    if (!valid(zone)) zone = text(await projectTimeZone(scope?.projectId));
    if (!valid(zone)) zone = 'UTC';
    const hours = activeHoursVerdict(account.data, now(), zone);
    if (!hours.ok) return { ...refuse(hours.reason.replace('Not reading now', 'Not searching now').replace('the reading runs', 'the search runs'), 409), keyword };
  }

  const max = Number(settings.data.maxResultsPerKeyword) || minerStore.SETTINGS_DEFAULTS.maxResultsPerKeyword;
  const res = await callOpenClaw({
    user: 'starcaster:substack-miner-notes-search',
    timeoutMs: SEARCH_TIMEOUT_MS,
    instructions: 'You are running a read-only search on Substack. Do not post, reply, like, restack, follow, subscribe, or change any setting.',
    input: buildSearchInstructions({ keyword, profile, accountName: signIn.SITES.substack.expected, max }),
  });
  if (!res.ok) return { ...refuse(`The browser could not be asked: OpenClaw ${res.error}`, 502), keyword };

  const answer = extractJson(res.text);
  const verdict = signIn.judge(answer, 'substack');
  if (verdict.code !== 0) {
    // Signed out / someone else (1) or an answer it could not read (2): nothing is written.
    return { ...refuse(`Not searching: ${verdict.message}`, verdict.code === 1 ? 401 : 502), keyword, signIn: verdict };
  }
  if (!Array.isArray(answer.notes)) {
    return { ...refuse(`The browser answered without a list of Notes${text(answer.problem) ? `: ${text(answer.problem)}` : ''}.`, 502), keyword };
  }

  const notes = answer.notes.slice(0, max).map((n) => {
    const note = n && typeof n === 'object' ? n : {};
    return {
      authorHandle: text(note.authorHandle),
      authorName: text(note.authorName),
      url: text(note.url),
      text: text(note.text).slice(0, minerStore.MAX_FOUND_NOTE_TEXT_LENGTH),
    };
  });
  const captured = await captureNotesSearch({ keyword, notes }, scope, deps);
  if (!captured.ok) return { ...captured, keyword };
  return {
    ok: true,
    status: 200,
    data: { ...captured.data, keywordChosen: pick.how, browserSaid: text(answer.problem) },
  };
}

/** What the terminal prints: which keyword, how many Notes, how many writers. */
function formatSearchSummary(s) {
  const lines = [`Keyword: "${s.keyword}"${s.keywordChosen ? ` (${s.keywordChosen})` : ''}`];
  for (const r of s.added) lines.push(`${r.name} (${r.handle}): added — ${r.notes} Note${r.notes === 1 ? '' : 's'} kept`);
  for (const r of s.merged) lines.push(`${r.name} (${r.handle}): already on the list — keyword added, ${r.notes} new Note${r.notes === 1 ? '' : 's'} kept`);
  for (const r of s.notAdded) lines.push(`${r.name} (@${r.authorHandle}): NOT ADDED — ${r.reason}`);
  for (const r of s.refusedNotes) lines.push(`Note ${r.index + 1} skipped — ${r.error}`);
  if (s.browserSaid) lines.push(`The browser said: ${s.browserSaid}`);
  lines.push(`${s.notesSent} Note${s.notesSent === 1 ? '' : 's'} read by ${s.authors} author${s.authors === 1 ? '' : 's'}: `
    + `${s.added.length} writer${s.added.length === 1 ? '' : 's'} added, ${s.merged.length} already on the list, `
    + `${s.notAdded.length} not added, ${s.refusedNotes.length} Note${s.refusedNotes.length === 1 ? '' : 's'} skipped.`);
  return lines.join('\n');
}

module.exports = {
  captureNotesSearch,
  runNotesSearchPass,
  formatSearchSummary,
  publicationForAuthor,
  pickKeyword,
  buildSearchInstructions,
  personHandle,
  MAX_NOTES_PER_SEARCH,
};
