'use strict';

/**
 * The Reddit adapter for the Mini's posting worker (Reddit comments 4/4, task
 * 86bch3jpg). Comments Dane approves on Engage → Comments are posted on Reddit
 * through OpenClaw's signed-in browser on this machine. The loop, the
 * never-twice rule and the proof rule live in ../poster.js; the adapter
 * contract is written at the top of ./youtube.js.
 *
 * PROOF IS TAKEN FROM REDDIT, NOT FROM THE BROWSER AGENT. OpenClaw must return
 * the new comment's permalink, AND Reddit's public JSON for that comment must
 * show it on the right post, by the expected account, saying the approved
 * words. The browser's answer is a claim; on 2026-07-19 an agent claimed a
 * Facebook post that never happened (fixed in b0ec0724).
 *
 *   no link                         failed
 *   a link Reddit has no comment at failed
 *   other words, author, or post    failed
 *   Reddit refuses or cannot be read  left `posting` for Dane to check by hand
 *
 * MEASURED 2026-10-13, 11:50am, from the Mini: Reddit refuses its public JSON
 * to this machine (403 "blocked by network security" on www.reddit.com,
 * api.reddit.com and a permalink + .json), as 2/4 measured the night before.
 * So until that changes, a real post lands as "check this one by hand", with
 * its link — which is the ticket's own rule for an unreadable proof, kept as
 * written. A weaker proof is Dane's decision, not this file's (comment on the
 * ticket, same time).
 *
 * NOTHING POSTS UNTIL AN ACCOUNT IS CHOSEN. Dane chooses the Reddit account on
 * Engage › Outreach (Outreach wizard 2/19); it is saved on the channel's
 * settings row (lib/outreachAccounts.js) and read again every pass. While none
 * is chosen every approved comment waits and says why, because "whoever is
 * signed in" is not an account. The pace lives on the same row.
 *
 * Every dependency is a seam (`options`), so the tests run the whole adapter
 * against a stand-in OpenClaw, a stand-in Reddit and the SQL-backed fake
 * database without a network.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const limits = require('../limits.js');
const { normalizeWords, screenshotPathAllowed } = require('./youtube.js');

/** Which OpenClaw browser profile posts for which account. */
const DEFAULT_PROFILES = Object.freeze({ dane_of_earth: 'dane-of-earth' });

/** A browser posting one comment: open, type, click, read the link back. */
const POST_TIMEOUT_MS = 5 * 60 * 1000;

/** Reddit's public JSON can lag a just-posted comment by a few seconds. */
const VERIFY_ATTEMPTS = 3;
const VERIFY_WAIT_MS = 15 * 1000;

const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const READ_TIMEOUT_MS = 10000;

/** Why every comment waits while no account is chosen — the wording the ticket asked for. */
const CHOOSE_ACCOUNT_REASON = 'Waiting: choose the account to post as — Engage › Outreach, Reddit, Connect.';

/** What Reddit shows in place of a comment taken down. */
const GONE = new Set(['[removed]', '[deleted]']);

function text(value) {
  return String(value == null ? '' : value).trim();
}

/**
 * A comment's words as the reader sees them. Reddit's editor escapes markdown
 * characters it would otherwise format ("3 \* 4"), and those backslashes are
 * not part of what Dane approved.
 */
function commentWords(value) {
  return normalizeWords(String(value == null ? '' : value).replace(/\\([\\`*_{}[\]()#+\-.!>~|^])/g, '$1'));
}

/**
 * The post id and comment id out of a comment's permalink. Reddit gives two
 * shapes — /r/<sub>/comments/<post>/<slug>/<comment>/ and the newer
 * /r/<sub>/comments/<post>/comment/<comment>/ — and both carry the comment id
 * in the same place.
 */
function parsePermalink(link) {
  const { parseRedditLink } = require('../../../lib/redditPostReader');
  const parsed = parseRedditLink(text(link));
  if (!parsed.ok) return { ok: false, why: parsed.error.replace(/\.$/, '') };
  if (!parsed.data.commentId) return { ok: false, why: 'it is a link to the post, not to one comment on it' };
  return { ok: true, postId: parsed.data.postId, commentId: parsed.data.commentId };
}

/** The browser instructions for one comment. Pure — tested directly. */
function buildPostInstructions({ item, profile, accountName }) {
  const where = item.parentCommentId
    ? [
      `Open ${item.targetUrl} and wait for it to load. That link shows one comment (the one being replied to) at the top.`,
      'Click "Reply" under that comment. If the comment is not there, or says [removed] or [deleted], stop and report that.',
    ]
    : [
      `Open ${item.targetUrl} and wait for the post to load. If the page says the post is removed, deleted or locked, stop and report that.`,
      'Click the box for adding a comment to the post ("Join the conversation" or "Add a comment").',
    ];
  return [
    `Use the browser tool with profile "${profile}".`,
    `Before typing anything, check the signed-in Reddit account is "${accountName}" (the avatar menu, top right, shows u/name). If it is not, or the browser is signed out, stop and report that.`,
    ...where,
    'Type EXACTLY the text between the <comment> tags below. Do not change, shorten, translate or add a single character.',
    `<comment>${item.text}</comment>`,
    'Click the "Comment" button once. Never click it twice.',
    'Wait for your posted comment to appear. Its time stamp (for example "just now") is a link to the comment on its own: read that link\'s full address. It has /comments/ and the comment\'s own id in it, and it is NOT the address of the post or of the comment you replied to.',
    'Take a screenshot of the posted comment and save it as a PNG file.',
    'Reply with ONLY this JSON and nothing else:',
    '{"posted": true or false, "commentUrl": "the full address of your comment, or null", '
      + '"screenshotPath": "the full path of the PNG you saved, or null", "problem": "what went wrong, in your own words, or null"}',
  ].join('\n');
}

/**
 * Read one comment from Reddit's public JSON. A refusal is `ok: false` with
 * Reddit's own reason in a sentence; no such comment is `found: false`.
 */
async function readCommentFromReddit(commentId, { fetchImpl = fetch } = {}) {
  const { describeRefusal, USER_AGENT } = require('../../../lib/redditPostReader');
  let res;
  let body;
  try {
    res = await fetchImpl(`https://www.reddit.com/api/info.json?id=t1_${encodeURIComponent(commentId)}&raw_json=1`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    body = await res.text();
  } catch (err) {
    return { ok: false, error: `Reddit could not be reached (${err.message})` };
  }
  if (res.status !== 200) {
    const location = typeof res.headers?.get === 'function' ? res.headers.get('location') : '';
    return { ok: false, error: describeRefusal(res.status, body, location).error.replace(/ Paste the post's title and text instead\.$/, '') };
  }
  let payload;
  try { payload = JSON.parse(body); } catch { return { ok: false, error: 'Reddit answered, but not with the comment\'s data' }; }
  const found = payload?.data?.children?.find((c) => c?.kind === 't1')?.data;
  if (!found) return { ok: true, found: false };
  return {
    ok: true,
    found: true,
    author: text(found.author),
    text: String(found.body || ''),
    linkId: text(found.link_id),
    parentId: text(found.parent_id),
  };
}

function createRedditAdapter(options = {}) {
  const projectId = text(options.projectId);
  if (!projectId) throw new Error('the Reddit adapter needs a projectId (REDDIT_COMMENTS_PROJECT_ID, or YOUTUBE_OUTREACH_PROJECT_ID)');
  const scope = { projectId };
  const signIn = require('../../../lib/openclawSignIn.js');
  const deps = {
    store: options.store || require('../../../lib/redditCommentsStore'),
    callOpenClaw: options.callOpenClaw || ((request) => require('../../../lib/openclawResponsesClient').callOpenClawResponses(request)),
    extractJson: options.extractJson || ((raw) => require('../../../lib/openclawResponsesClient').extractJsonFromText(raw)),
    readComment: options.readComment || readCommentFromReddit,
    upload: options.upload || ((args) => require('../../../lib/blobStorage').uploadBufferToBlob(args)),
    projectTimeZone: options.projectTimeZone || (async () => ''),
    readFile: options.readFile || ((file) => fs.readFileSync(file)),
    statFile: options.statFile || ((file) => fs.statSync(file)),
    sleep: options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    homedir: options.homedir || os.homedir(),
    // The account Dane chose, and the pace, from the channel's settings row.
    readAccount: options.readAccount
      || ((accountKey) => require('../../../lib/outreachAccounts').readAccountForWorker('reddit', projectId, accountKey)),
  };
  const profiles = { ...DEFAULT_PROFILES, ...(options.profiles || {}) };
  // A fixed account and pace, for tests; otherwise both are read every pass.
  const fixedAccount = options.accountName !== undefined ? signIn.redditUsername(options.accountName) : null;
  const fixedPace = options.pace ? { ...limits.REDDIT_PACE, ...options.pace } : null;

  // Per pass: one read of each account's settings and history.
  let accounts = new Map();
  let settingsCache = new Map();
  let zoneCache = null;

  /** { accountName, pace } for this pass: '' means nobody has chosen one. */
  async function settingsFor(accountKey) {
    if (settingsCache.has(accountKey)) return settingsCache.get(accountKey);
    let found = { accountName: fixedAccount || '', pace: fixedPace || { ...limits.REDDIT_PACE } };
    if (fixedAccount === null || !fixedPace) {
      const res = await deps.readAccount(accountKey);
      if (!res.ok) throw new Error(`could not read which Reddit account to post as: ${res.error}`);
      found = {
        accountName: fixedAccount !== null ? fixedAccount : signIn.redditUsername(res.data.expectedAccount),
        pace: fixedPace || { ...limits.REDDIT_PACE, ...(res.data.pace || {}) },
      };
    }
    settingsCache.set(accountKey, found);
    return found;
  }

  async function timeZone() {
    if (zoneCache === null) zoneCache = text(await deps.projectTimeZone(projectId));
    return limits.isValidTimeZone(zoneCache) ? zoneCache : 'UTC';
  }

  async function historyFor(accountKey) {
    if (accounts.has(accountKey)) return accounts.get(accountKey);
    const history = await deps.store.listPostedForLimits(500, scope, { accountKey });
    if (!history.ok) throw new Error(`could not read what ${accountKey} has already posted on Reddit: ${history.error}`);
    accounts.set(accountKey, history.data);
    return history.data;
  }

  return {
    name: 'reddit',
    label: 'Reddit',
    handCheckWords: 'Open the post on Reddit and check by hand.',
    projectId,
    // Before any pass has read the row: the fixed pace, or the defaults.
    pace: fixedPace || { ...limits.REDDIT_PACE },

    beginPass() {
      accounts = new Map();
      settingsCache = new Map();
      zoneCache = null;
    },

    async listApproved() {
      const res = await deps.store.listApprovedForPosting(50, scope);
      if (!res.ok) return res;
      return {
        ok: true,
        status: 200,
        data: res.data.map((c) => ({ ...c, text: c.finalText || c.draftText })),
      };
    },

    async checkLimits(item, now) {
      if (!profiles[item.accountKey]) {
        return {
          ok: false,
          scope: 'item',
          reason: `Not posting: no browser on the Mini is set up for the "${item.accountKey}" account.`,
        };
      }
      // Holds every comment, so it is account-wide: nothing posts as "whoever is signed in".
      const { accountName, pace } = await settingsFor(item.accountKey);
      if (!accountName) return { ok: false, scope: 'account', reason: CHOOSE_ACCOUNT_REASON };
      if (!text(item.text)) return { ok: false, scope: 'item', reason: 'Not posting: this comment has no words.' };
      if (!text(item.targetUrl) || !text(item.postId)) {
        return { ok: false, scope: 'item', reason: 'Not posting: this comment names no Reddit post to go on.' };
      }
      const history = await historyFor(item.accountKey);
      return limits.checkAccountLimits({
        settings: pace,
        history: history.filter((h) => h.id !== item.id),
        itemId: item.id,
        now,
        timeZone: await timeZone(),
      });
    },

    noteWaiting: (item, reason) => deps.store.noteWaiting(item.id, reason, scope),
    markPosting: (item) => deps.store.markPosting(item.id, scope),
    markPosted: (item, proof) => deps.store.markPosted(item.id, proof, scope),
    markFailed: (item, failure) => deps.store.markFailed(item.id, failure, scope),
    flagForHandCheck: (item, details) => deps.store.flagForHandCheck(item.id, details, scope),

    async post(item) {
      const { accountName } = await settingsFor(item.accountKey);
      if (!accountName) return { ok: false, error: CHOOSE_ACCOUNT_REASON };
      const res = await deps.callOpenClaw({
        user: 'starcaster:reddit-comments-poster',
        timeoutMs: POST_TIMEOUT_MS,
        instructions: 'You are posting ONE Reddit comment that a person has approved, word for word. '
          + 'Post it at most once. Do not vote, join, follow, message or change anything else.',
        input: buildPostInstructions({ item, profile: profiles[item.accountKey], accountName }),
      });
      if (!res.ok) {
        // A timeout is the one refusal that does not prove nothing happened:
        // the browser may still be mid-click when the request gives up.
        const uncertain = res.status === 504;
        return { ok: false, uncertain, error: `OpenClaw: ${res.error}` };
      }
      const answer = deps.extractJson(res.text);
      const said = text(res.text).slice(0, 800);
      if (!answer || typeof answer !== 'object') {
        return { ok: false, uncertain: true, error: `OpenClaw answered, but not with the JSON it was asked for, so whether it posted is unknown. It said: ${said || '(nothing)'}` };
      }
      const screenshot = text(answer.screenshotPath);
      if (answer.posted !== true) {
        // The screenshot goes along: a refusal is when the picture helps most.
        return { ok: false, error: `OpenClaw did not post it: ${text(answer.problem) || said || 'it gave no reason'}`, screenshot };
      }
      return { ok: true, url: text(answer.commentUrl), said: text(answer.problem), screenshot };
    },

    async verify(item, url) {
      const { accountName } = await settingsFor(item.accountKey);
      const link = parsePermalink(url);
      if (!link.ok) return { verdict: 'refuted', reason: `The link OpenClaw returned is not a link to a Reddit comment: ${link.why}.` };
      if (link.postId !== text(item.postId).toLowerCase()) {
        return { verdict: 'refuted', reason: `The link OpenClaw returned is a comment on a different post (${link.postId}), not this one (${item.postId}).` };
      }
      if (item.parentCommentId && link.commentId === text(item.parentCommentId).toLowerCase()) {
        return { verdict: 'refuted', reason: 'The link OpenClaw returned is the comment being replied to, not the reply, so it proves nothing.' };
      }
      let read = null;
      for (let tries = 1; tries <= VERIFY_ATTEMPTS; tries += 1) {
        read = await deps.readComment(link.commentId);
        if (!read.ok || read.found) break;
        if (tries < VERIFY_ATTEMPTS) await deps.sleep(VERIFY_WAIT_MS);
      }
      if (!read.ok) return { verdict: 'cannot-tell', reason: `OpenClaw says it posted, but ${read.error}, so the link could not be checked.` };
      if (!read.found) {
        return { verdict: 'refuted', reason: 'OpenClaw returned a link, but Reddit has no comment at it, so it is not counted as posted.' };
      }
      if (GONE.has(text(read.text))) {
        return {
          verdict: 'refuted',
          reason: `Reddit shows the comment at that link as ${text(read.text)} — the subreddit's moderators or Reddit's spam filter took it down, so it is not counted as posted.`,
        };
      }
      if (read.linkId && read.linkId !== `t3_${text(item.postId).toLowerCase()}`) {
        return { verdict: 'refuted', reason: 'The comment at that link is on a different post, not this one.' };
      }
      if (item.parentCommentId && read.parentId && read.parentId !== `t1_${text(item.parentCommentId).toLowerCase()}`) {
        return { verdict: 'refuted', reason: 'The comment at that link is on this post, but not under the comment it was meant to reply to.' };
      }
      if (signIn.redditUsername(read.author).toLowerCase() !== accountName.toLowerCase()) {
        return { verdict: 'refuted', reason: `The comment at that link was written by "${read.author || 'nobody Reddit names'}", not ${accountName}.` };
      }
      if (commentWords(read.text) !== commentWords(item.text)) {
        return {
          verdict: 'refuted',
          reason: `The comment at that link does not say what was approved. Reddit shows: "${commentWords(read.text).slice(0, 300)}"`,
        };
      }
      return { verdict: 'proven', reason: '' };
    },

    // The hourly sign-in check (../health.js): one entry per account, each
    // writing its reading where the Comments screen reads it.
    browserChecks() {
      return Object.keys(profiles).map((accountKey) => ({
        site: 'reddit',
        accountKey,
        profile: profiles[accountKey],
        who: fixedAccount || '',
        // The account Dane chose, read at check time (../health.js).
        resolve: async () => {
          if (fixedAccount !== null) return { who: fixedAccount };
          const res = await deps.readAccount(accountKey);
          if (!res.ok) throw new Error(res.error);
          return { who: signIn.redditUsername(res.data.compareWith) };
        },
        record: (reading) => deps.store.recordBrowserCheck(reading, scope, { accountKey }),
      }));
    },

    async keepScreenshot(item, screenshot) {
      const file = text(screenshot);
      if (!file) return { note: 'OpenClaw did not save a screenshot.' };
      if (!screenshotPathAllowed(file, deps.homedir)) {
        return { note: `The screenshot was not kept: "${file}" is outside the folders OpenClaw writes to.` };
      }
      if (!/\.(png|jpe?g)$/i.test(file)) return { note: 'The screenshot was not kept: it is not a PNG or JPEG file.' };
      let buffer;
      try {
        const size = deps.statFile(file).size;
        if (size > MAX_SCREENSHOT_BYTES) return { note: `The screenshot was not kept: it is ${Math.round(size / 1048576)} MB.` };
        buffer = deps.readFile(file);
      } catch (err) {
        return { note: `The screenshot could not be read: ${err.message}` };
      }
      const uploaded = await deps.upload({
        assetType: 'RedditComments',
        category: projectId,
        fileName: `comment-${item.id}${path.extname(file).toLowerCase()}`,
        mimeType: /\.png$/i.test(file) ? 'image/png' : 'image/jpeg',
        fileBuffer: buffer,
      });
      if (!uploaded.ok) return { note: `The screenshot could not be uploaded: ${uploaded.error}` };
      return { url: text(uploaded.data?.location) };
    },
  };
}

module.exports = {
  createRedditAdapter,
  buildPostInstructions,
  parsePermalink,
  commentWords,
  readCommentFromReddit,
  DEFAULT_PROFILES,
  VERIFY_ATTEMPTS,
  CHOOSE_ACCOUNT_REASON,
};
