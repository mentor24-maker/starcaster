'use strict';

/**
 * The Substack adapter for the Mini's posting worker (Substack Notes 6/7, task
 * 86bcet7qr). Approved Notes, replies, restacks and likes happen on Substack
 * as Dane of Earth, through OpenClaw's signed-in browser on this machine.
 * The loop, the never-twice rule and the proof rule live in ../poster.js; the
 * adapter contract is written at the top of ./youtube.js.
 *
 * FOUR KINDS, TWO KINDS OF PROOF.
 *
 *   note, reply      OpenClaw must return the new Note's link, AND Substack's
 *                    own reader must show a Note at that link saying the
 *                    approved words. The browser's answer is a claim; on
 *                    2026-07-19 an agent claimed a Facebook post that never
 *                    happened (fixed in b0ec0724). No link is `failed`; a link
 *                    whose words differ is `failed`; a link nobody could read
 *                    is left `posting` for a person to check.
 *
 *   restack, like    Substack gives no link for a click, so the link kept is
 *                    the Note acted on, and the proof is the page state the
 *                    browser reports AFTER the click: the button showing
 *                    "restacked" / "liked". No such state is `failed`.
 *
 * A LIKE OR A RESTACK CLICKED TWICE IS UNDONE. Both buttons are toggles, so
 * the browser is told to leave one already on alone and report it, and the
 * limits refuse a second like (or restack) of a Note already liked here.
 *
 * Every dependency is a seam (`options`), so the tests run the whole adapter
 * against a stand-in OpenClaw, a stand-in Substack and the SQL-backed fake
 * database without a network. The one real post waits for Dane to sign the
 * Mini's browser in to Substack (Substack Notes 7/7).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const limits = require('../limits.js');
const { normalizeWords, screenshotPathAllowed } = require('./youtube.js');

/** Which OpenClaw browser profile acts for which account. */
const DEFAULT_PROFILES = Object.freeze({ dane_of_earth: 'dane-of-earth' });

/** How the account is named on Substack — the agent checks it before acting. */
const DEFAULT_ACCOUNT_NAMES = Object.freeze({ dane_of_earth: 'Dane of Earth' });

/** A browser posting one Note: open, type, click, read the link back. */
const POST_TIMEOUT_MS = 5 * 60 * 1000;

/** Substack's reader can lag a just-posted Note by a few seconds. */
const VERIFY_ATTEMPTS = 3;
const VERIFY_WAIT_MS = 15 * 1000;

const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

/** A Note's own address: substack.com/@handle/note/c-123 (or the older /note/c-123). */
const NOTE_PATH_RE = /^\/(?:@[A-Za-z0-9_.-]+\/)?note\/c-(\d+)\/?$/;

/** The words each kind is called by in a sentence. */
const KIND_WORDS = Object.freeze({ note: 'Note', reply: 'reply', restack: 'restack', like: 'like' });

/** The page state that proves a click, per kind. */
const DONE_STATE = Object.freeze({ restack: 'restacked', like: 'liked' });

function text(value) {
  return String(value == null ? '' : value).trim();
}

/**
 * The Note id out of a Substack Note link. `https://substack.com/@name/note/c-123`
 * is the shape Substack's own "copy link" produces; a reply is a Note too.
 */
function parseNoteLink(link) {
  let url;
  try { url = new URL(text(link)); } catch { return { ok: false, why: `"${text(link)}" is not a web address` }; }
  const host = url.hostname.toLowerCase();
  if (host !== 'substack.com' && host !== 'www.substack.com') {
    return { ok: false, why: `the link goes to ${url.hostname}, not substack.com` };
  }
  const match = NOTE_PATH_RE.exec(url.pathname);
  if (!match) return { ok: false, why: 'the link does not point at a Note (a Note\'s address ends /note/c-<number>)' };
  return { ok: true, noteId: match[1] };
}

/** The browser instructions for one item. Pure — tested directly. */
function buildPostInstructions({ item, profile, accountName }) {
  const head = [
    `Use the browser tool with profile "${profile}".`,
    `Before doing anything else, check the signed-in Substack account is "${accountName}". If it is not, or the browser is signed out, stop and report that.`,
  ];
  const typeIt = [
    'Type EXACTLY the text between the <note> tags below. Do not change, shorten, translate or add a single character.',
    `<note>${item.text}</note>`,
  ];
  const linkReply = 'Reply with ONLY this JSON and nothing else:\n'
    + '{"done": true or false, "noteUrl": "the full address of the Note you just posted, or null", '
    + '"screenshotPath": "the full path of the PNG you saved, or null", "problem": "what went wrong, in your own words, or null"}';

  if (item.kind === 'note') {
    return [
      ...head,
      'Open https://substack.com/home and wait for it to load.',
      'Click the box for writing a new Note ("What\'s on your mind?").',
      ...typeIt,
      'Click "Post" once. Never click it twice.',
      'Wait for your new Note to appear, then open it on its own page. Its address ends /note/c- and a number: read that full address.',
      'Take a screenshot of the posted Note and save it as a PNG file.',
      linkReply,
    ].join('\n');
  }
  if (item.kind === 'reply') {
    return [
      ...head,
      `Open ${item.targetUrl} and wait for the Note to load. If the page says the Note is gone, stop and report that.`,
      'Click "Reply" (the speech-bubble button) under that Note.',
      ...typeIt,
      'Click the button that posts the reply once. Never click it twice.',
      'Wait for your reply to appear under the Note, then open your reply on its own page (click its time stamp). Its address ends /note/c- and a number, and it is NOT the address of the Note you replied to: read that full address.',
      'Take a screenshot of the posted reply and save it as a PNG file.',
      linkReply,
    ].join('\n');
  }
  const state = DONE_STATE[item.kind];
  const button = item.kind === 'like' ? '"Like" (the heart)' : '"Restack" (the two arrows), then the plain "Restack" choice — never "Restack with quote"';
  return [
    ...head,
    `Open ${item.targetUrl} and wait for the Note to load. If the page says the Note is gone, stop and report that.`,
    `Look at the ${item.kind === 'like' ? 'Like' : 'Restack'} button under the Note FIRST. If it already shows the Note ${state} by this account, do NOT click it — clicking again would undo it. Just report it.`,
    `Otherwise click ${button} once. Never click it twice.`,
    `Then look again: does the button now show the Note ${state} by this account?`,
    `Take a screenshot showing the Note and that button, and save it as a PNG file.`,
    'Reply with ONLY this JSON and nothing else:',
    `{"done": true or false, "${state}": true or false (what the button shows NOW), "alreadyDone": true if it was already ${state} before you arrived, `
      + '"screenshotPath": "the full path of the PNG you saved, or null", "problem": "what went wrong, in your own words, or null"}',
  ].join('\n');
}

/** Read the Note at `noteId` from Substack's own reader. */
async function readNoteFromSubstack(noteId) {
  let res;
  try {
    res = await fetch(`https://substack.com/api/v1/reader/comment/${encodeURIComponent(noteId)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Starcaster Substack Notes)', Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    return { ok: false, error: `Substack could not be reached (${err.message})` };
  }
  if (res.status === 404) return { ok: true, found: false };
  if (!res.ok) return { ok: false, error: `Substack answered ${res.status}` };
  let body;
  try { body = await res.json(); } catch { return { ok: false, error: 'Substack answered, but not with a Note it could read' }; }
  const comment = body?.item?.comment || body?.comment || null;
  if (!comment) return { ok: true, found: false };
  return { ok: true, found: true, text: String(comment.body || '') };
}

function createSubstackAdapter(options = {}) {
  const projectId = text(options.projectId);
  if (!projectId) throw new Error('the Substack adapter needs a projectId (SUBSTACK_NOTES_PROJECT_ID, or YOUTUBE_OUTREACH_PROJECT_ID)');
  const scope = { projectId };
  const deps = {
    store: options.store || require('../../../lib/substackNotesStore'),
    callOpenClaw: options.callOpenClaw || ((request) => require('../../../lib/openclawResponsesClient').callOpenClawResponses(request)),
    extractJson: options.extractJson || ((raw) => require('../../../lib/openclawResponsesClient').extractJsonFromText(raw)),
    readNote: options.readNote || readNoteFromSubstack,
    upload: options.upload || ((args) => require('../../../lib/blobStorage').uploadBufferToBlob(args)),
    projectTimeZone: options.projectTimeZone || (async () => ''),
    readFile: options.readFile || ((file) => fs.readFileSync(file)),
    statFile: options.statFile || ((file) => fs.statSync(file)),
    sleep: options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    homedir: options.homedir || os.homedir(),
  };
  const profiles = { ...DEFAULT_PROFILES, ...(options.profiles || {}) };
  const accountNames = { ...DEFAULT_ACCOUNT_NAMES, ...(options.accountNames || {}) };

  // Per pass: one read of each account's settings and history.
  let accounts = new Map();
  let zoneCache = null;

  async function zoneFor(settings) {
    if (limits.isValidTimeZone(settings.timeZone)) return settings.timeZone;
    if (zoneCache === null) zoneCache = text(await deps.projectTimeZone(projectId));
    return limits.isValidTimeZone(zoneCache) ? zoneCache : 'UTC';
  }

  async function accountContext(accountKey) {
    if (accounts.has(accountKey)) return accounts.get(accountKey);
    const settings = await deps.store.getSettings(scope, { accountKey });
    if (!settings.ok) throw new Error(`could not read the ${accountKey} Substack settings: ${settings.error}`);
    const history = await deps.store.listPostedForLimits(500, scope, { accountKey });
    if (!history.ok) throw new Error(`could not read what ${accountKey} has already done on Substack: ${history.error}`);
    const ctx = { settings: settings.data, history: history.data, timeZone: await zoneFor(settings.data) };
    accounts.set(accountKey, ctx);
    return ctx;
  }

  return {
    name: 'substack',
    label: 'Substack',
    handCheckWords: 'Check Substack by hand.',
    projectId,

    beginPass() {
      accounts = new Map();
      zoneCache = null;
    },

    async listApproved() {
      const res = await deps.store.listApprovedForPosting(50, scope);
      if (!res.ok) return res;
      return {
        ok: true,
        status: 200,
        data: res.data.map((i) => ({ ...i, text: i.finalText || i.draftText })),
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
      if ((item.kind === 'note' || item.kind === 'reply') && !text(item.text)) {
        return { ok: false, scope: 'item', reason: `Not posting: this ${KIND_WORDS[item.kind]} has no words.` };
      }
      if (item.kind !== 'note' && !text(item.targetUrl)) {
        return { ok: false, scope: 'item', reason: `Not posting: this ${KIND_WORDS[item.kind]} names no Note to act on.` };
      }
      const ctx = await accountContext(item.accountKey);
      const others = ctx.history.filter((h) => h.id !== item.id);
      // Both buttons are toggles: a second like of the same Note takes the first away.
      if (DONE_STATE[item.kind]) {
        const before = others.find((h) => h.kind === item.kind && h.targetUrl === item.targetUrl);
        if (before) {
          return {
            ok: false,
            scope: 'item',
            reason: `Not posting: this Note was already ${DONE_STATE[item.kind]} from here, and clicking again would undo it.`,
          };
        }
      }
      // A like or restack found already on clicked nothing, so it uses no
      // allowance and starts no gap — it is still in `others` above, so the
      // toggle guard keeps it from being clicked off.
      return limits.checkAccountLimits({
        settings: { ...ctx.settings, maxCommentsPerDay: ctx.settings.maxActionsPerDay },
        history: others.filter((h) => !h.alreadyDone),
        itemId: item.id,
        now,
        timeZone: ctx.timeZone,
        noun: 'action',
      });
    },

    noteWaiting: (item, reason) => deps.store.noteWaiting(item.id, reason, scope),
    markPosting: (item) => deps.store.markPosting(item.id, scope),
    // A like or restack that was already on when the browser arrived clicked
    // nothing, so it is recorded as such and costs no allowance (checkLimits).
    markPosted(item, proof, attempt = {}) {
      if (!DONE_STATE[item.kind] || attempt.pageState?.alreadyDone !== true) {
        return deps.store.markPosted(item.id, proof, scope);
      }
      const already = `It was already ${DONE_STATE[item.kind]} from this account, so nothing was clicked and it does not count toward the daily maximum.`;
      return deps.store.markPosted(item.id, {
        ...proof,
        alreadyDone: true,
        note: [text(proof.note), already].filter(Boolean).join(' '),
      }, scope);
    },
    markFailed: (item, failure) => deps.store.markFailed(item.id, failure, scope),
    flagForHandCheck: (item, details) => deps.store.flagForHandCheck(item.id, details, scope),

    async post(item) {
      const res = await deps.callOpenClaw({
        user: 'starcaster:substack-notes-poster',
        timeoutMs: POST_TIMEOUT_MS,
        instructions: `You are doing ONE thing on Substack that a person has approved: a ${KIND_WORDS[item.kind]}. `
          + 'Do it at most once. Do not follow, subscribe, like, restack or change anything else.',
        input: buildPostInstructions({
          item,
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
        return { ok: false, uncertain: true, error: `OpenClaw answered, but not with the JSON it was asked for, so whether it went out is unknown. It said: ${said || '(nothing)'}` };
      }
      const screenshot = text(answer.screenshotPath);
      if (answer.done !== true && answer.alreadyDone !== true) {
        // The screenshot goes along: a refusal is when the picture helps most.
        return { ok: false, error: `OpenClaw did not do it: ${text(answer.problem) || said || 'it gave no reason'}`, screenshot };
      }
      if (DONE_STATE[item.kind]) {
        // No link of its own: the Note acted on is the link, and the state is the proof.
        return {
          ok: true,
          url: item.targetUrl,
          said: text(answer.problem),
          screenshot,
          pageState: { [DONE_STATE[item.kind]]: answer[DONE_STATE[item.kind]] === true, alreadyDone: answer.alreadyDone === true },
        };
      }
      return { ok: true, url: text(answer.noteUrl), said: text(answer.problem), screenshot };
    },

    async verify(item, url, attempt = {}) {
      const state = DONE_STATE[item.kind];
      if (state) {
        if (attempt.pageState?.[state] === true) return { verdict: 'proven', reason: '' };
        return {
          verdict: 'refuted',
          reason: `OpenClaw said it clicked, but the page it reported back does not show the Note ${state}, so it is not counted as done.`
            + (text(attempt.said) ? ` It said: ${text(attempt.said)}` : ''),
        };
      }

      const link = parseNoteLink(url);
      if (!link.ok) return { verdict: 'refuted', reason: `The link OpenClaw returned is not a link to a Note: ${link.why}.` };
      if (item.kind === 'reply') {
        const target = parseNoteLink(item.targetUrl);
        if (target.ok && target.noteId === link.noteId) {
          return { verdict: 'refuted', reason: 'The link OpenClaw returned is the Note being replied to, not the reply, so it proves nothing.' };
        }
      }
      let read = null;
      for (let tries = 1; tries <= VERIFY_ATTEMPTS; tries += 1) {
        read = await deps.readNote(link.noteId);
        if (!read.ok || read.found) break;
        if (tries < VERIFY_ATTEMPTS) await deps.sleep(VERIFY_WAIT_MS);
      }
      if (!read.ok) return { verdict: 'cannot-tell', reason: `OpenClaw says it posted, but ${read.error}, so the link could not be checked.` };
      if (!read.found) {
        return { verdict: 'refuted', reason: 'OpenClaw returned a link, but Substack has no Note at it, so it is not counted as posted.' };
      }
      if (!normalizeWords(read.text).includes(normalizeWords(item.text))) {
        return {
          verdict: 'refuted',
          reason: `The Note at that link does not say what was approved. Substack shows: "${normalizeWords(read.text).slice(0, 300)}"`,
        };
      }
      return { verdict: 'proven', reason: '' };
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
        assetType: 'SubstackNotes',
        category: projectId,
        fileName: `${item.kind}-${item.id}${path.extname(file).toLowerCase()}`,
        mimeType: /\.png$/i.test(file) ? 'image/png' : 'image/jpeg',
        fileBuffer: buffer,
      });
      if (!uploaded.ok) return { note: `The screenshot could not be uploaded: ${uploaded.error}` };
      return { url: text(uploaded.data?.location) };
    },
  };
}

module.exports = {
  createSubstackAdapter,
  buildPostInstructions,
  parseNoteLink,
  readNoteFromSubstack,
  DEFAULT_PROFILES,
  DONE_STATE,
  VERIFY_ATTEMPTS,
};
