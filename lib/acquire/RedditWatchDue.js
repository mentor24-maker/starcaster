'use strict';

/**
 * The Mini's Reddit watch — Outreach wizard 18/19 (task 86bcrmbwm). launchd
 * runs scripts/run_reddit_watch.sh every four hours on the Mini
 * (scripts/install_reddit_watch.sh, role `reddit-watch` in lib/nodeRoles.js);
 * that runs scripts/reddit_watch_due.mjs, which runs this.
 *
 * For every project with approved subreddits (lib/redditWatchStore.js):
 *
 *   1. the subreddits read longest ago (never-read first), at most
 *      SUBREDDITS_PER_PASS of them — each one's NEW and RISING listings and
 *      its sidebar, through OpenClaw's signed-in browser, in one visit;
 *   2. the posts kept are the ones that match a keyword of Dane's (the
 *      wizard's shared list) or use at least CANON_WORDS_TO_KEEP of his
 *      canon words (lib/outreachRanking.js canonTerms);
 *   3. for the best COMMENT_READS_PER_SUBREDDIT kept posts whose comments
 *      were never read, the post is opened and its strongest comments read,
 *      with the reader Outreach wizard 17/19 built for Add
 *      (workers/youtube-outreach/adapters/reddit.js buildReadInstructions).
 *
 * WHY THE BROWSER, WHY THE MINI. Reddit refuses its public JSON to anything
 * not signed in (measured 2026-10-12 and 10-13, lib/redditPostReader.js), so
 * the only reader is the signed-in browser, and that is on the Mini.
 *
 * WHY SO FEW A PASS. This is browser activity on Dane's real account. Two
 * subreddits and four post visits every four hours is a reading pace, not a
 * crawl; with more subreddits approved, each is simply read less often, and
 * the wizard's "is this current?" rule scales with how many there are
 * (lib/redditConversations.js readingVerdict).
 *
 * SIGNED OUT IS A FAILURE, NEVER "FOUND NOTHING". A read the browser answers
 * signed out is recorded on the subreddit as `signed_out` — which is what
 * makes the wizard say "the Mini is signed out" instead of "0 found" — and the
 * rest of that project's pass stops, because every other read would say the
 * same. The runner exits non-zero for any failed read, records no beat, and
 * posts to the bus. A pass that read NOTHING (no project has an approved
 * subreddit) is not a failure, but it records no beat either, so a schedule
 * that never reads goes stale on the roll call instead of reading as healthy.
 */

const watchStore = require('../redditWatchStore');
const ranking = require('../outreachRanking');
const { readCanonDocs } = require('../canonPrompt');

const SUBREDDITS_PER_PASS = 2;
const COMMENT_READS_PER_SUBREDDIT = 2;
/** How many posts the browser reads from each listing. */
const POSTS_PER_LISTING = 25;
/** A post with no keyword match is kept when it uses this many canon words. */
const CANON_WORDS_TO_KEEP = 2;
/** One browser visit to a subreddit: two listings and the sidebar. */
const LISTING_TIMEOUT_MS = 5 * 60 * 1000;
const COMMENTS_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_PROFILE = 'dane-of-earth';
/** A post older than this is not a conversation to join (lib/redditConversations.js says the same). */
const FRESH_FOR_MS = 14 * 24 * 60 * 60 * 1000;

function text(value, max = 2000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

/** The browser instructions for one subreddit visit. Pure — tested directly. */
function buildListingInstructions({ subreddit, profile = DEFAULT_PROFILE }) {
  return [
    `Use the browser tool with profile "${profile}".`,
    `Open https://www.reddit.com/r/${subreddit}/new/ and wait for it to load.`,
    'Check whether the browser is signed in to Reddit (the avatar menu, top right, shows u/name). If it is NOT signed in, stop and reply {"signedIn": false} and nothing else.',
    'If Reddit says the subreddit does not exist, is private, banned or quarantined, set "found" to false and say which in "problem".',
    `Read up to ${POSTS_PER_LISTING} posts from this list, newest first: each one's id (the part after /comments/ in its link), its title, `
      + 'its text (empty if it is only a link or a picture; the first 1500 characters is enough), its author\'s username, '
      + 'when it was posted (as an ISO date and time if the page shows one, else null), its score and its number of comments.',
    `Then open https://www.reddit.com/r/${subreddit}/rising/ and read up to ${POSTS_PER_LISTING} posts the same way.`,
    'Then read the subreddit\'s rules (the sidebar, or the "Rules" section). If a rule says anything about self-promotion, '
      + 'advertising, linking to your own work or a ratio of promotion to participation, copy that rule\'s words into "promotionRule". '
      + 'If no rule mentions it, set "promotionRule" to "".',
    'Do not click Join, vote, comment, follow, message or change anything. Only read.',
    'Reply with ONLY this JSON and nothing else:',
    '{"signedIn": true or false, "found": true or false, "promotionRule": "the rule\'s words, or \\"\\"", '
      + '"new": [{"id": "...", "title": "...", "body": "...", "author": "...", "postedAt": "ISO time or null", "score": a number, "comments": a number}], '
      + '"rising": [the same shape], "problem": "anything that went wrong, in your own words, or null"}',
  ].join('\n');
}

/**
 * The visit, judged: `{ ok: true, posts, promotionRule }` or
 * `{ ok: false, state: 'signed_out' | 'failed', error }`. Pure.
 */
function interpretListing(subreddit, answer, said = '') {
  if (!answer || typeof answer !== 'object') {
    return { ok: false, state: 'failed', error: `The Mini's browser answered, but not with the posts${said ? `. It said: ${text(said, 300)}` : ''}.` };
  }
  if (answer.signedIn === false) {
    return { ok: false, state: 'signed_out', error: 'The Mini\'s browser is not signed in to Reddit, so Reddit would not show it the subreddit. Sign it in on Engage › Outreach, Reddit, Connect.' };
  }
  if (answer.found === false) {
    return { ok: false, state: 'failed', error: `Reddit would not show r/${subreddit}${text(answer.problem) ? `: ${text(answer.problem, 300)}` : ' — it may be private, banned or misspelled'}.` };
  }
  const posts = [];
  for (const listing of ['new', 'rising']) {
    const list = Array.isArray(answer[listing]) ? answer[listing] : [];
    for (const p of list.slice(0, POSTS_PER_LISTING)) {
      if (!p || typeof p !== 'object') continue;
      const id = text(p.id, 40).toLowerCase().replace(/^t3_/, '');
      if (!/^[a-z0-9]{1,12}$/.test(id) || !text(p.title)) continue;
      posts.push({
        postId: id,
        subreddit,
        title: text(p.title, 1000),
        body: text(p.body, 6000),
        author: text(p.author, 100).replace(/^\/?u\//i, ''),
        postedAt: text(p.postedAt, 60),
        score: Number(p.score) || 0,
        numComments: Number(p.comments) || 0,
        listing,
      });
    }
  }
  if (!posts.length && !Array.isArray(answer.new) && !Array.isArray(answer.rising)) {
    return { ok: false, state: 'failed', error: `The Mini opened r/${subreddit} but sent back no list of posts${text(answer.problem) ? ` (it said: ${text(answer.problem, 300)})` : ''}.` };
  }
  return { ok: true, posts, promotionRule: text(answer.promotionRule, 1000) };
}

/** The keyword of Dane's a post's words contain, or ''. Whole words, any case. */
function matchKeyword(post, keywords) {
  const hay = ` ${`${post.title} ${post.body}`.toLowerCase().replace(/[^a-z0-9']+/g, ' ')} `;
  for (const k of keywords) {
    const needle = text(k, 200).toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim();
    if (needle && hay.includes(` ${needle} `)) return text(k, 200);
  }
  return '';
}

/**
 * Which posts to keep, and the keyword each matched: a keyword hit, or at
 * least CANON_WORDS_TO_KEEP canon words. One post seen on both listings is
 * kept once (rising wins: it says the conversation is moving). Pure.
 */
function keepPosts(posts, { keywords = [], terms = [], now = Date.now() } = {}) {
  const byId = new Map();
  for (const p of posts) {
    const when = Date.parse(p.postedAt || '');
    if (Number.isFinite(when) && now - when > FRESH_FOR_MS) continue;
    const keyword = matchKeyword(p, keywords);
    const canonHits = ranking.canonMatches(`${p.title} ${p.body}`, terms).length;
    if (!keyword && canonHits < CANON_WORDS_TO_KEEP) continue;
    const prior = byId.get(p.postId);
    if (!prior || p.listing === 'rising') byId.set(p.postId, { ...p, keyword: keyword || prior?.keyword || '' });
  }
  return [...byId.values()];
}

/** The subreddits to read this pass: approved, read longest ago first, never-read before all. Pure. */
function pickSubreddits(subreddits, max = SUBREDDITS_PER_PASS) {
  return subreddits
    .filter((s) => s.status === 'approved')
    .sort((a, b) => (Date.parse(a.lastReadAt || '') || 0) - (Date.parse(b.lastReadAt || '') || 0) || a.name.localeCompare(b.name))
    .slice(0, max);
}

/**
 * One project's pass. Answers `{ subreddits: [{ name, verdict, message, seen,
 * kept, commentsRead }], stoppedSignedOut }` — never throws for a refused read.
 */
async function watchProject(project, deps) {
  const scope = { projectId: project.projectId, userId: project.userId };
  const store = deps.store || watchStore;
  const out = { projectId: project.projectId, subreddits: [], stoppedSignedOut: false, error: '' };

  const listed = await store.listSubreddits(1000, scope);
  if (!listed.ok) { out.error = listed.error; return out; }
  const keywordsRead = await deps.readKeywords(scope);
  if (!keywordsRead.ok) { out.error = `The keywords could not be read: ${keywordsRead.error}`; return out; }
  const keywords = keywordsRead.data;
  const canon = await readCanonDocs(scope, { canonDocs: deps.canonDocs }, 'Not ranked');
  const terms = canon.ok ? ranking.canonTerms(canon.data) : [];
  if (!keywords.length && !terms.length) {
    out.error = 'There are no keywords and no canon words to match posts against, so nothing would be kept. Save keywords on the Outreach screen.';
    return out;
  }
  const already = await store.listPosts(1000, scope);
  if (!already.ok) { out.error = already.error; return out; }
  const commentsRead = new Set(already.data.filter((p) => p.commentsReadAt).map((p) => p.postId));

  for (const sub of pickSubreddits(listed.data)) {
    // eslint-disable-next-line no-await-in-loop
    const res = await deps.callOpenClaw({
      user: 'starcaster:reddit-watch',
      timeoutMs: LISTING_TIMEOUT_MS,
      instructions: 'You are reading one subreddit\'s newest posts so a person can choose conversations to join. '
        + 'Only read. Do not post, vote, join, follow, message or change anything.',
      input: buildListingInstructions({ subreddit: sub.name, profile: deps.profile }),
    });
    const judged = res.ok
      ? interpretListing(sub.name, deps.extractJson(res.text), text(res.text))
      : { ok: false, state: 'failed', error: `The Mini's browser could not be asked (OpenClaw: ${res.error}).` };
    if (!judged.ok) {
      // eslint-disable-next-line no-await-in-loop
      const rec = await store.recordRead(sub.id, { state: judged.state, error: judged.error }, scope);
      out.subreddits.push({ name: sub.name, verdict: judged.state, message: judged.error + (rec.ok ? '' : ` (and that could not be recorded: ${rec.error})`), seen: 0, kept: 0, commentsRead: 0 });
      if (judged.state === 'signed_out') { out.stoppedSignedOut = true; break; }
      continue;
    }
    const kept = keepPosts(judged.posts, { keywords, terms, now: deps.now() });
    // eslint-disable-next-line no-await-in-loop
    const saved = await store.savePosts(kept, scope);
    if (!saved.ok) {
      out.subreddits.push({ name: sub.name, verdict: 'failed', message: saved.error, seen: judged.posts.length, kept: 0, commentsRead: 0 });
      continue;
    }

    // The strongest comments, for the best few kept posts not read before.
    const best = ranking.rankConversations(
      kept.filter((p) => !commentsRead.has(p.postId)).map((p) => ({ ...p, text: `${p.title}\n${p.body}`, replies: p.numComments, likes: p.score })),
      { terms, now: deps.now() },
    ).slice(0, COMMENT_READS_PER_SUBREDDIT);
    let read = 0;
    const notes = [];
    for (const p of best) {
      // eslint-disable-next-line no-await-in-loop
      const comments = await deps.readComments({ postId: p.postId, subreddit: sub.name }, deps);
      if (!comments.ok) {
        notes.push(`comments of ${p.postId} not read: ${comments.error}`);
        if (comments.code === 'MINI_SIGNED_OUT') { out.stoppedSignedOut = true; break; }
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const put = await store.saveComments(p.postId, comments.topComments, scope);
      if (put.ok) { read += 1; commentsRead.add(p.postId); } else notes.push(`comments of ${p.postId} not saved: ${put.error}`);
    }
    // eslint-disable-next-line no-await-in-loop
    const rec = await store.recordRead(sub.id, { state: 'read', seen: judged.posts.length, kept: kept.length, promotionRule: judged.promotionRule }, scope);
    out.subreddits.push({
      name: sub.name,
      verdict: rec.ok ? 'read' : 'failed',
      message: [rec.ok ? '' : `the read was not recorded: ${rec.error}`, ...notes].filter(Boolean).join('; '),
      seen: judged.posts.length,
      kept: kept.length,
      commentsRead: read,
    });
    if (out.stoppedSignedOut) {
      // eslint-disable-next-line no-await-in-loop
      await store.recordRead(sub.id, { state: 'signed_out', error: 'The Mini\'s browser was signed out of Reddit part-way through reading this subreddit\'s comments.' }, scope);
      out.subreddits[out.subreddits.length - 1].verdict = 'signed_out';
      break;
    }
  }
  return out;
}

/** Read one post's strongest comments with 17/19's reader. */
async function defaultReadComments({ postId, subreddit }, deps) {
  const adapter = require('../../workers/youtube-outreach/adapters/reddit.js');
  const item = { targetUrl: `https://www.reddit.com/r/${subreddit}/comments/${postId}/`, parentCommentId: '', subreddit };
  const res = await deps.callOpenClaw({
    user: 'starcaster:reddit-watch',
    timeoutMs: COMMENTS_TIMEOUT_MS,
    instructions: 'You are reading ONE Reddit post and its top comments so a person can answer it. '
      + 'Only read. Do not post, vote, join, follow, message or change anything.',
    input: adapter.buildReadInstructions({ item, profile: deps.profile || DEFAULT_PROFILE }),
  });
  if (!res.ok) return { ok: false, code: 'READ_BROWSER_FAILED', error: `OpenClaw: ${res.error}` };
  const judged = adapter.interpretRead(item, deps.extractJson(res.text), text(res.text));
  if (!judged.ok) return { ok: false, code: judged.code, error: judged.error };
  return { ok: true, topComments: judged.post.topComments };
}

/**
 * One pass over every watched project. `deps` replaces each moving part
 * (tests): listProjects, store, callOpenClaw, extractJson, readKeywords,
 * readComments, canonDocs, now, profile. `data.read` counts subreddits read,
 * `data.failed` counts failed reads and projects that could not be started;
 * the runner's exit code reads both.
 */
async function runRedditWatchDue(deps = {}) {
  const full = {
    store: deps.store || watchStore,
    callOpenClaw: deps.callOpenClaw || ((request) => require('../openclawResponsesClient').callOpenClawResponses(request)),
    extractJson: deps.extractJson || ((raw) => require('../openclawResponsesClient').extractJsonFromText(raw)),
    readKeywords: deps.readKeywords || (async (scope) => {
      const r = await require('../youtubeCreatorsStore').getKeywords(scope);
      return r.ok ? { ok: true, data: r.data.keywords } : r;
    }),
    readComments: deps.readComments || defaultReadComments,
    canonDocs: deps.canonDocs,
    now: deps.now || Date.now,
    profile: deps.profile || DEFAULT_PROFILE,
  };
  const listProjects = deps.listProjects || (() => full.store.listWatchedProjects());
  const found = await listProjects();
  if (!found.ok) return { ok: false, status: found.status || 500, error: `Could not read which projects watch subreddits: ${found.error}` };

  const projects = [];
  for (const project of found.data) {
    // eslint-disable-next-line no-await-in-loop
    projects.push(await watchProject(project, full));
  }
  const all = projects.flatMap((p) => p.subreddits);
  return {
    ok: true,
    status: 200,
    data: {
      projects,
      read: all.filter((s) => s.verdict === 'read').length,
      failed: all.filter((s) => s.verdict !== 'read').length + projects.filter((p) => p.error).length,
    },
  };
}

/** What the log prints: a line per subreddit, then the total. */
function formatWatchLog(report) {
  const lines = [];
  for (const p of report.projects) {
    lines.push(`--- project ${p.projectId}`);
    if (p.error) { lines.push(`NOT STARTED: ${p.error}`); continue; }
    for (const s of p.subreddits) {
      if (s.verdict === 'read') {
        lines.push(`r/${s.name}: ${s.seen} posts looked at, ${s.kept} kept, comments read on ${s.commentsRead}${s.message ? ` (${s.message})` : ''}.`);
      } else {
        lines.push(`r/${s.name} ${s.verdict === 'signed_out' ? 'SIGNED OUT' : 'READ FAILED'}: ${s.message}`);
      }
    }
    if (p.stoppedSignedOut) lines.push('Stopped this project: the browser is signed out of Reddit, so every other read would say the same.');
  }
  lines.push(`${report.projects.length} project${report.projects.length === 1 ? '' : 's'} watching subreddits: ${report.read} read, ${report.failed} failed.`);
  if (!report.read && !report.failed) {
    lines.push('Nothing was read this pass, so no beat is recorded: a schedule that never reads must go stale, not read as healthy.');
  }
  return lines.join('\n');
}

module.exports = {
  runRedditWatchDue,
  watchProject,
  buildListingInstructions,
  interpretListing,
  keepPosts,
  matchKeyword,
  pickSubreddits,
  formatWatchLog,
  SUBREDDITS_PER_PASS,
  COMMENT_READS_PER_SUBREDDIT,
  CANON_WORDS_TO_KEEP,
  FRESH_FOR_MS,
};
