'use strict';

/**
 * The YouTube adapter for the Mini's posting worker (YouTube outreach 5/7,
 * task 86bcda68h). Everything YouTube-specific lives here; the loop, the
 * never-retry rule and the proof rule live in ../poster.js, which knows no site.
 *
 * WHAT AN ADAPTER PROVIDES (the contract ../poster.js calls, and the one
 * Substack Notes 6/7 implements a second time):
 *
 *   name, label                      'youtube', 'YouTube'
 *   handCheckWords                   the sentence ending a "check this by hand"
 *                                    error: 'Check the video by hand.'
 *   beginPass()                      forget anything cached from the last pass
 *   listApproved()                   envelope: approved items, oldest first
 *   checkLimits(item, now)           { ok } | { ok: false, scope, reason }
 *   noteWaiting(item, reason)        envelope
 *   markPosting / markPosted / markFailed / flagForHandCheck   envelopes
 *                                    (markPosted also gets post()'s answer as a third argument)
 *   post(item)                       ask OpenClaw; { ok, url, said, screenshot } |
 *                                    { ok: false, uncertain?, error, screenshot? }
 *                                    (a screenshot on a refusal is kept on the failed row)
 *   verify(item, url, attempt)       { verdict: 'proven' | 'refuted' | 'cannot-tell', reason }
 *                                    (attempt = post()'s whole answer; Substack's likes need it)
 *   keepScreenshot(item, screenshot) { url } | { note }
 *   browserChecks()                  [{ site, accountKey, profile, who, record(reading) }]
 *                                    — one per account it posts with, for the
 *                                    hourly sign-in check (../health.js, 7/7)
 *
 * PROOF IS TAKEN FROM YOUTUBE, NOT FROM THE BROWSER AGENT. OpenClaw's answer
 * is a claim; on 2026-07-19 an agent claimed a Facebook post succeeded and
 * nothing had been posted (fixed in b0ec0724). So `verify` asks YouTube's own
 * Data API for the comment at the returned link and compares its words with the
 * approved text. The agent cannot make that read come back right by saying so.
 *
 * Every dependency is a seam (`deps`), so the tests run the whole adapter
 * against a stand-in OpenClaw, a stand-in YouTube and the SQL-backed fake
 * database without a network.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const limits = require('../limits.js');

/** Which OpenClaw browser profile posts for which account. */
const DEFAULT_PROFILES = Object.freeze({ dane_of_earth: 'dane-of-earth' });

/** How the account is named on YouTube — the agent checks it before typing. */
const DEFAULT_ACCOUNT_NAMES = Object.freeze({ dane_of_earth: 'Dane of Earth' });

/** A browser posting one comment: open, scroll, type, click, read the link back. */
const POST_TIMEOUT_MS = 5 * 60 * 1000;

/** YouTube's API can lag a just-posted comment by a few seconds. */
const VERIFY_ATTEMPTS = 3;
const VERIFY_WAIT_MS = 15 * 1000;

const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

function text(value) {
  return String(value == null ? '' : value).trim();
}

/** Words compared the way a reader would: same characters, any run of spaces is one. */
function normalizeWords(value) {
  return text(value).normalize('NFC').replace(/\s+/g, ' ');
}

/**
 * The comment id out of a YouTube comment link, and whether the link is for
 * THIS video. `https://www.youtube.com/watch?v=<video>&lc=<comment>` is the
 * shape YouTube's own "link to comment" produces; a reply's id carries a dot.
 */
function parseCommentLink(link, videoId) {
  let url;
  try { url = new URL(text(link)); } catch { return { ok: false, why: `"${text(link)}" is not a web address` }; }
  if (!/(^|\.)youtube\.com$/i.test(url.hostname)) {
    return { ok: false, why: `the link goes to ${url.hostname}, not youtube.com` };
  }
  const v = url.searchParams.get('v') || '';
  if (v !== videoId) {
    return { ok: false, why: `the link is for video "${v || '(none)'}", not this comment's video "${videoId}"` };
  }
  const lc = url.searchParams.get('lc') || '';
  if (!/^[A-Za-z0-9_.-]{6,200}$/.test(lc)) {
    return { ok: false, why: 'the link does not point at a comment (it has no lc= comment id)' };
  }
  return { ok: true, commentId: lc };
}

/** The browser instructions for one comment. Pure — tested directly. */
function buildPostInstructions({ item, placement, replyToCommentId, profile, accountName }) {
  const video = `https://www.youtube.com/watch?v=${item.videoId}`;
  const where = {
    top_level: [
      `Open ${video} and wait for it to load. Scroll down until the comments section loads.`,
      'Click the "Add a comment..." box at the top of the comments.',
    ],
    reply_top_comment: [
      `Open ${video} and wait for it to load. Scroll down until the comments section loads.`,
      'Make sure the comments are sorted by "Top comments".',
      `Find the first comment that was NOT written by "${accountName}" and click "Reply" under it.`,
    ],
    reply_specific: [
      `Open ${video}&lc=${replyToCommentId} and wait for it to load. That link highlights one comment at the top of the comments.`,
      'Click "Reply" under that highlighted comment. If no comment is highlighted, stop and report that the comment to reply to was not found.',
    ],
  }[placement];

  return [
    `Use the browser tool with profile "${profile}".`,
    `Before typing anything, check the signed-in YouTube account is "${accountName}". If it is not, or the browser is signed out, stop and report that.`,
    ...where,
    'Type EXACTLY the text between the <comment> tags below. Do not change, shorten, translate or add a single character.',
    `<comment>${item.text}</comment>`,
    'Click the button that posts it ("Comment" or "Reply") once. Never click it twice.',
    'Wait for the posted comment to appear. Its time stamp (for example "1 second ago") is a link: read that link\'s full address.',
    'Take a screenshot of the posted comment and save it as a PNG file.',
    'Reply with ONLY this JSON and nothing else:',
    '{"posted": true or false, "commentUrl": "the time stamp link\'s full address, or null", '
      + '"screenshotPath": "the full path of the PNG you saved, or null", "problem": "what went wrong, in your own words, or null"}',
  ].join('\n');
}

/** Read the comment at `commentId` from YouTube's Data API. */
async function fetchCommentFromYoutube(commentId) {
  const { ytFetch } = require('../../../lib/acquire/YoutubeCommentsRun');
  const { resolveYoutubeApiKey } = require('../../../lib/acquire/youtubeApiKey');
  const key = resolveYoutubeApiKey();
  if (!key) return { ok: false, error: 'no YouTube API key is set on this machine, so the link could not be checked' };
  try {
    const body = await ytFetch('comments', { part: 'snippet', id: commentId, textFormat: 'plainText', key });
    const found = Array.isArray(body?.items) ? body.items[0] : null;
    if (!found) return { ok: true, found: false };
    const s = found.snippet || {};
    return {
      ok: true,
      found: true,
      text: String(s.textOriginal || s.textDisplay || ''),
      videoId: text(s.videoId),
      authorChannelId: text(s.authorChannelId?.value),
      authorName: text(s.authorDisplayName),
    };
  } catch (err) {
    return { ok: false, error: `YouTube's API did not answer: ${err.message}` };
  }
}

/** Is `file` somewhere OpenClaw is allowed to have written a screenshot? */
function screenshotPathAllowed(file, homedir = os.homedir()) {
  if (!path.isAbsolute(file)) return false;
  const resolved = path.resolve(file);
  const roots = [path.join(homedir, '.openclaw'), os.tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'];
  return roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
}

function createYoutubeAdapter(options = {}) {
  const projectId = text(options.projectId);
  if (!projectId) throw new Error('the YouTube adapter needs a projectId (YOUTUBE_OUTREACH_PROJECT_ID)');
  const scope = { projectId };
  const deps = {
    store: options.store || require('../../../lib/youtubeOutreachCommentsStore'),
    targets: options.targets || require('../../../lib/youtubeOutreachStore'),
    callOpenClaw: options.callOpenClaw || ((request) => require('../../../lib/openclawResponsesClient').callOpenClawResponses(request)),
    extractJson: options.extractJson || ((raw) => require('../../../lib/openclawResponsesClient').extractJsonFromText(raw)),
    fetchComment: options.fetchComment || fetchCommentFromYoutube,
    upload: options.upload || ((args) => require('../../../lib/blobStorage').uploadBufferToBlob(args)),
    projectTimeZone: options.projectTimeZone || (async () => ''),
    readFile: options.readFile || ((file) => fs.readFileSync(file)),
    statFile: options.statFile || ((file) => fs.statSync(file)),
    sleep: options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    homedir: options.homedir || os.homedir(),
  };
  const profiles = { ...DEFAULT_PROFILES, ...(options.profiles || {}) };
  const accountNames = { ...DEFAULT_ACCOUNT_NAMES, ...(options.accountNames || {}) };
  const expectedChannelId = text(options.expectedChannelId);

  // Per pass: one read of each account's settings and history, one of each target.
  let accounts = new Map();
  let targetCache = new Map();
  let zoneCache = null;

  async function zoneFor(settings) {
    if (limits.isValidTimeZone(settings.timeZone)) return settings.timeZone;
    if (zoneCache === null) zoneCache = text(await deps.projectTimeZone(projectId));
    return limits.isValidTimeZone(zoneCache) ? zoneCache : 'UTC';
  }

  async function accountContext(accountKey) {
    if (accounts.has(accountKey)) return accounts.get(accountKey);
    const settings = await deps.targets.getSettings(scope, { accountKey });
    if (!settings.ok) throw new Error(`could not read the ${accountKey} account settings: ${settings.error}`);
    const history = await deps.store.listPostedForLimits(500, scope, { accountKey });
    if (!history.ok) throw new Error(`could not read what ${accountKey} has already posted: ${history.error}`);
    const ctx = { settings: settings.data, history: history.data, timeZone: await zoneFor(settings.data) };
    accounts.set(accountKey, ctx);
    return ctx;
  }

  async function targetFor(targetId) {
    if (targetCache.has(targetId)) return targetCache.get(targetId);
    const res = await deps.targets.getTargetById(targetId, scope);
    if (!res.ok && res.status !== 404) throw new Error(`could not read the target video: ${res.error}`);
    const target = res.ok ? res.data : null;
    targetCache.set(targetId, target);
    return target;
  }

  return {
    name: 'youtube',
    label: 'YouTube',
    handCheckWords: 'Check the video by hand.',
    projectId,

    beginPass() {
      accounts = new Map();
      targetCache = new Map();
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
      const ctx = await accountContext(item.accountKey);
      const target = await targetFor(item.targetId);
      const videoHistory = ctx.history.filter((h) => h.videoId === item.videoId && h.id !== item.id);
      const own = limits.checkItemRules({ settings: ctx.settings, target, videoHistory, now, timeZone: ctx.timeZone });
      if (!own.ok) return own;
      return limits.checkAccountLimits({
        settings: ctx.settings,
        history: ctx.history.filter((h) => h.id !== item.id),
        itemId: item.id,
        now,
        timeZone: ctx.timeZone,
      });
    },

    noteWaiting: (item, reason) => deps.store.noteWaiting(item.id, reason, scope),
    markPosting: (item) => deps.store.markPosting(item.id, scope),
    markPosted: (item, proof) => deps.store.markPosted(item.id, proof, scope),
    markFailed: (item, failure) => deps.store.markFailed(item.id, failure, scope),
    flagForHandCheck: (item, details) => deps.store.flagForHandCheck(item.id, details, scope),

    async post(item) {
      const target = await targetFor(item.targetId);
      const placement = text(item.followed?.commentPlacement) || text(target?.commentPlacement) || 'top_level';
      const replyToCommentId = text(target?.replyToCommentId);
      if (placement === 'reply_specific' && !replyToCommentId) {
        return { ok: false, error: 'This comment is meant as a reply to a specific comment, but its target names no comment to reply to.' };
      }
      const res = await deps.callOpenClaw({
        user: 'starcaster:youtube-outreach-poster',
        timeoutMs: POST_TIMEOUT_MS,
        instructions: 'You are posting ONE YouTube comment that a person has approved, word for word. '
          + 'Post it at most once. Do not like, subscribe, follow or change anything else.',
        input: buildPostInstructions({
          item,
          placement,
          replyToCommentId,
          profile: profiles[item.accountKey],
          accountName: accountNames[item.accountKey] || item.accountKey,
        }),
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
      if (answer.posted !== true) {
        return { ok: false, error: `OpenClaw did not post it: ${text(answer.problem) || said || 'it gave no reason'}` };
      }
      return { ok: true, url: text(answer.commentUrl), said: text(answer.problem) || '', screenshot: text(answer.screenshotPath) };
    },

    async verify(item, url) {
      const link = parseCommentLink(url, item.videoId);
      if (!link.ok) return { verdict: 'refuted', reason: `The link OpenClaw returned is not a link to a comment on this video: ${link.why}.` };
      let read = null;
      for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt += 1) {
        read = await deps.fetchComment(link.commentId);
        if (!read.ok || read.found) break;
        if (attempt < VERIFY_ATTEMPTS) await deps.sleep(VERIFY_WAIT_MS);
      }
      if (!read.ok) return { verdict: 'cannot-tell', reason: `OpenClaw says it posted, but ${read.error}.` };
      if (!read.found) {
        return {
          verdict: 'refuted',
          reason: 'OpenClaw returned a link, but YouTube has no comment at it, so it is not counted as posted. '
            + 'If the channel holds new comments for review it may appear later — open the link to check.',
        };
      }
      if (read.videoId && read.videoId !== item.videoId) {
        return { verdict: 'refuted', reason: `The comment at that link is on video "${read.videoId}", not this one.` };
      }
      if (expectedChannelId && read.authorChannelId && read.authorChannelId !== expectedChannelId) {
        return { verdict: 'refuted', reason: `The comment at that link was written by "${read.authorName || read.authorChannelId}", not this account.` };
      }
      if (normalizeWords(read.text) !== normalizeWords(item.text)) {
        return {
          verdict: 'refuted',
          reason: `The comment at that link does not say what was approved. YouTube shows: "${normalizeWords(read.text).slice(0, 300)}"`,
        };
      }
      return { verdict: 'proven', reason: '' };
    },

    // The hourly sign-in check (7/7, 86bcda6dt): one entry per account this
    // adapter can post with, each writing its reading onto that account's
    // settings row, where the screen reads it.
    browserChecks() {
      return Object.keys(profiles).map((accountKey) => ({
        site: 'youtube',
        accountKey,
        profile: profiles[accountKey],
        who: accountNames[accountKey] || accountKey,
        record: (reading) => deps.targets.recordBrowserCheck(reading, scope, { accountKey }),
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
        assetType: 'YoutubeOutreach',
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
  createYoutubeAdapter,
  buildPostInstructions,
  parseCommentLink,
  normalizeWords,
  screenshotPathAllowed,
  fetchCommentFromYoutube,
  DEFAULT_PROFILES,
  VERIFY_ATTEMPTS,
};
