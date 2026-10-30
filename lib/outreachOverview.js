'use strict';

/**
 * Outreach wizard 1/19 (task 86bcrmb8x) — where each outreach channel stands.
 *
 * For YouTube, Substack and Reddit, five stages (Connect, Find creators, Find
 * conversations, Write replies, Learn), each with a state, one plain sentence
 * and the one next step. It REPORTS and ROUTES only: every number comes from a
 * store that already exists, and the `next` step names an existing screen.
 *
 * States:
 *   done          the stage has happened and nothing of Dane's is waiting
 *   needs_you     something only Dane can do (approve, sign in, add a link)
 *   waiting_mini  handed to the Mac Mini, which has not done it (or not lately)
 *   not_started   nothing has happened here yet, or the step does not exist yet
 *   cannot_tell   a reading failed — the sentence says which and why
 *
 * A READ THAT FAILS IS "CANNOT TELL", NEVER "DONE". Each stage's reading is
 * taken on its own and a throw is caught there, so one broken store blanks
 * one stage and names itself rather than taking the whole screen down
 * (docs/DOCTRINE.md §5.33, CLAUDE.md landmine 17).
 *
 * The stores are passed in (`deps`) so the test can make any one of them throw.
 */

/** MINI_STALE_MS: older than this means the checker stopped (one number, lib/openclawSignIn.js). */
const { EXPECTED_CHANNEL, MINI_STALE_MS } = require('./openclawSignIn');

/** How many rows a count reads. A count that reaches it says "at least". */
const COUNT_LIMIT = 1000;

const STATES = Object.freeze(['done', 'needs_you', 'waiting_mini', 'not_started', 'cannot_tell']);

const STAGES = Object.freeze([
  { key: 'connect', label: 'Connect' },
  { key: 'creators', label: 'Find creators' },
  { key: 'conversations', label: 'Find conversations' },
  { key: 'replies', label: 'Write replies' },
  { key: 'learn', label: 'Learn' },
]);

/** The existing screens a `next` step can open (the `data-page` ids in src/layout.html). */
const PAGES = Object.freeze({
  youtube: 'engageYoutubeOutreachPage',
  substackNotes: 'engageSubstackNotesPage',
  substackMiner: 'acquireSubstackPage',
  reddit: 'engageCommentResponsesPage',
});

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "17", or "at least 1000" when the read stopped at its limit. */
function countText(n, limit = COUNT_LIMIT) {
  return n >= limit ? `at least ${n}` : String(n);
}

/** "12 minutes ago", "3 hours ago" — the same wording as the Engage screens. */
function agoText(iso, now) {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return '';
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function dayText(iso) {
  const at = iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime())) return '';
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
}

function trimStop(text) {
  return String(text || '').trim().replace(/\.$/, '');
}

/**
 * Take one reading. A store envelope that is not ok, or a store that throws,
 * becomes `{ ok: false, error }` naming what was being read.
 */
async function read(what, fn) {
  try {
    const res = await fn();
    if (!res || !res.ok) {
      return { ok: false, error: `${what} could not be read: ${trimStop(res?.error) || 'no reason was given'}.` };
    }
    return { ok: true, data: res.data };
  } catch (err) {
    return { ok: false, error: `${what} could not be read: ${trimStop(err?.message) || 'unknown error'}.` };
  }
}

function stage(key, state, sentence, next) {
  const def = STAGES.find((s) => s.key === key);
  return { key, label: def.label, state, sentence, next };
}

function cannotTell(key, error, next) {
  return stage(key, 'cannot_tell', `Cannot tell. ${error}`, next);
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows || []) {
    const value = row?.[field];
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

/**
 * Connect: the Mini's last look at its own browser for this site. Pure.
 * `check` is a BrowserCheck ({ state, message, checkedAt, signedInAt }).
 */
function connectStage(siteLabel, check, next, now) {
  const checkedAt = check?.checkedAt ? Date.parse(check.checkedAt) : NaN;
  if (!check?.state || !Number.isFinite(checkedAt)) {
    return stage('connect', 'waiting_mini',
      `The Mini has never checked whether its browser is signed in to ${siteLabel}, so its posting job may not be running.`, next);
  }
  const ago = agoText(check.checkedAt, now);
  const message = trimStop(check.message);
  if (now - checkedAt > MINI_STALE_MS) {
    return stage('connect', 'waiting_mini',
      `The Mini last checked its ${siteLabel} sign-in ${ago}, so its posting job may have stopped. That check said: ${message || check.state}.`, next);
  }
  if (check.state === 'signed_in') {
    return stage('connect', 'done', `${message || `Signed in to ${siteLabel}`}, checked ${ago}.`, next);
  }
  if (check.state === 'gateway_down') {
    return stage('connect', 'waiting_mini', `The Mini's browser did not answer when it checked ${ago}: ${message}.`, next);
  }
  if (check.state === 'cannot_tell') {
    return stage('connect', 'cannot_tell', `Cannot tell. ${message} (checked ${ago}).`, next);
  }
  return stage('connect', 'needs_you', `${message}. Checked ${ago}.`, next);
}

/**
 * Connect, once the account question is asked first (Outreach wizard 2/19).
 * Pure. Until Dane has chosen the account this channel posts as, the stage is
 * his — whatever the browser says — because nothing posts until he does. Once
 * he has, it is the Mini's sign-in reading as before.
 *
 * `account` is lib/outreachAccounts.js rowToAccount, or a failed read.
 */
function connectWithAccount(siteLabel, check, account, next, now) {
  if (!account?.ok) return cannotTell('connect', account?.error || `The ${siteLabel} account could not be read`, next);
  const { expectedAccount, observedAccount } = account.data;
  if (!expectedAccount) {
    const seen = observedAccount
      ? `The Mini is signed in to ${siteLabel} as ${observedAccount}. `
      : `The Mini has not yet read which account its browser is signed in to ${siteLabel} as. `;
    return stage('connect', 'needs_you', `${seen}Choose the account to post as — nothing posts on ${siteLabel} until you do.`, next);
  }
  return connectStage(siteLabel, check, next, now);
}

/** What the Connect stage's controls need, for the screen. Never a secret. */
function accountView(account) {
  if (!account?.ok) return null;
  const a = account.data;
  const view = {
    expectedAccount: a.expectedAccount,
    observedAccount: a.observedAccount,
    confirmedAt: a.confirmedAt,
    checkRequestedAt: a.checkRequestedAt,
    browserCheckedAt: a.browserCheckedAt,
  };
  if (a.pace) view.pace = { maxCommentsPerDay: a.pace.maxCommentsPerDay, minMinutesBetween: a.pace.minMinutesBetween };
  return view;
}

/**
 * The Learn stage (Outreach wizard 13/19, lib/outreachLessons.js): how many
 * lessons are on for this channel (its own and the all-channel ones), and the
 * score. Its work happens on this screen, so there is no other screen to open.
 */
async function learnStage(deps, channel, scope) {
  const view = await read('The lessons', () => deps.outreachLessons.learnView(channel, scope));
  if (!view.ok) return cannotTell('learn', view.error, null);
  const lessons = Array.isArray(view.data?.lessons) ? view.data.lessons : [];
  const on = lessons.filter((l) => l.enabled).length;
  const off = lessons.length - on;
  const score = view.data?.score;
  const scoreWords = score ? score.sentence : trimStop(view.data?.scoreError) + '.';
  const every = deps.outreachLessons.REFRESH_EVERY || 5;
  if (on) {
    return stage('learn', 'done', `Drafts are written with ${plural(on, 'lesson')}${off ? ` (${off} switched off)` : ''}. ${scoreWords}`, null);
  }
  const decided = score ? score.counted : 0;
  const offWords = off ? ` ${plural(off, 'lesson is', 'lessons are')} switched off.` : '';
  if (score && decided < every) {
    return stage('learn', 'not_started',
      `No lessons yet.${offWords} ${plural(decided, 'decision')} recorded; lessons are suggested after every ${every} approvals or rejections, or click Refresh lessons.`, null);
  }
  return stage('learn', 'needs_you', `No lessons are on.${offWords} ${scoreWords} Click Refresh lessons to have some suggested, or add your own.`, null);
}

/**
 * Write replies, from a status count. Pure. `nouns` names what is written
 * ("comment", "Note or reply").
 */
function repliesStage(counts, total, words, next) {
  const waiting = (counts.draft || 0);
  const toWrite = (counts.idea || 0);
  const queued = (counts.approved || 0) + (counts.posting || 0);
  const posted = counts.posted || 0;
  const failed = counts.failed || 0;
  const rejected = counts.rejected || 0;
  const parts = [];
  if (toWrite) parts.push(`${plural(toWrite, words.idea, words.ideas)} waiting to be written`);
  if (waiting) parts.push(`${plural(waiting, words.one, words.many)} waiting for your approval`);
  if (failed) parts.push(`${plural(failed, words.one, words.many)} failed to post`);
  if (queued) parts.push(`${plural(queued, words.one, words.many)} approved and waiting for the Mini to post`);
  if (posted) parts.push(`${plural(posted, words.one, words.many)} posted`);
  if (!total || !parts.length) {
    const gone = rejected ? ` (${rejected} rejected)` : '';
    return stage('replies', 'not_started', `No ${words.many} written yet: 0 drafts, 0 approved, 0 posted${gone}.`, next);
  }
  if (rejected) parts.push(`${rejected} rejected`);
  const sentence = `${parts.join(', ')}.`.replace(/^./, (c) => c.toUpperCase());
  if (toWrite || waiting || failed) return stage('replies', 'needs_you', sentence, next);
  if (queued) return stage('replies', 'waiting_mini', sentence, next);
  return stage('replies', 'done', sentence, next);
}

function go(label, page) {
  return { label, page };
}

/**
 * A stage whose work happens on this screen (Outreach wizard 15/19): it has no
 * `next` screen to open, and says so with `inline: true` rather than a null
 * that could be mistaken for a step that was forgotten.
 */
function inline(st) {
  return { ...st, next: null, inline: true };
}

/** YouTube's Find creators: the channel list (lib/youtubeCreatorsStore.js). Pure. */
function youtubeCreatorsStage(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const by = countBy(list, 'status');
  const approved = by.approved || 0;
  const rejected = by.rejected || 0;
  const waiting = by.candidate || 0;
  const suggested = list.filter((r) => r.status === 'candidate' && r.suggestion).length;
  if (!list.length) {
    return inline(stage('creators', 'not_started', 'No YouTube channels found yet. Find channels searches YouTube for your keywords.', null));
  }
  const decided = `${approved} approved, ${rejected} rejected`;
  if (waiting) {
    return inline(stage('creators', 'needs_you',
      `${plural(waiting, 'channel')} waiting for your decision (${suggested} with a suggestion); ${decided}.`, null));
  }
  if (!approved) {
    return inline(stage('creators', 'needs_you', `No channel approved yet: all ${rejected} found were rejected. Find channels again, or change the keywords.`, null));
  }
  return inline(stage('creators', 'done', `${countText(approved)} ${approved === 1 ? 'channel' : 'channels'} approved, ${rejected} rejected, none waiting.`, null));
}

/** Reddit's Find creators: the subreddits the Mini watches (lib/redditWatchStore.js). Pure. */
function subredditsStage(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const by = countBy(list, 'status');
  const approved = by.approved || 0;
  const rejected = by.rejected || 0;
  const waiting = by.candidate || 0;
  if (!list.length) {
    return inline(stage('creators', 'not_started', 'No subreddits chosen yet. Find subreddits for my topics suggests some from your canon and keywords.', null));
  }
  const decided = `${approved} approved, ${rejected} rejected`;
  if (waiting) return inline(stage('creators', 'needs_you', `${plural(waiting, 'subreddit')} waiting for your decision; ${decided}.`, null));
  if (!approved) {
    return inline(stage('creators', 'needs_you', `No subreddit approved yet: all ${rejected} suggested were rejected. Find more, or add one by name.`, null));
  }
  return inline(stage('creators', 'done', `${countText(approved)} ${approved === 1 ? 'subreddit' : 'subreddits'} watched, ${rejected} rejected, none waiting.`, null));
}

/**
 * Reddit's Find conversations, from the ranked list (lib/redditConversations.js).
 * Signed out or a reading that did not come back is "cannot tell" even when
 * the list has posts in it — never "0 found".
 */
async function redditConversationsStage(conversations, scope) {
  const list = await read('The Reddit conversations list', () => conversations.listRedditConversations(scope));
  if (!list.ok) return inline(cannotTell('conversations', list.error, null));
  const { newCount, reading, items } = list.data;
  const listed = Array.isArray(items) ? items.length : newCount;
  const worth = `${countText(newCount)} new ${newCount === 1 ? 'post' : 'posts'} worth replying to`;
  const capped = listed < newCount ? `; the best ${listed} are listed` : '';
  if (reading.state === 'no_subreddits') return inline(stage('conversations', 'not_started', reading.sentence, null));
  if (reading.state === 'signed_out' || reading.state === 'cannot_tell') {
    return inline(stage('conversations', 'cannot_tell', newCount ? `${worth} so far${capped}. ${reading.sentence}` : reading.sentence, null));
  }
  if (newCount) return inline(stage('conversations', 'needs_you', `${worth}${capped}, best first.`, null));
  return inline(stage('conversations', 'done', `Nothing new to reply to. ${reading.sentence}`, null));
}

async function youtubeChannel(deps, scope, now) {
  const { youtubeOutreachStore, youtubeOutreachCommentsStore } = deps;
  const accountKey = youtubeOutreachStore.DEFAULT_ACCOUNT;
  const screen = PAGES.youtube;
  const stages = [];

  const settings = await read('The YouTube sign-in check', () => youtubeOutreachStore.getSettings(scope, { accountKey }));
  const account = await read('The YouTube account to post as', () => deps.outreachAccounts.getAccount('youtube', scope, { accountKey }));
  const connectNext = go('Open YouTube outreach', screen);
  stages.push(settings.ok
    ? connectWithAccount('YouTube', settings.data?.browserCheck, account, connectNext, now)
    : cannotTell('connect', settings.error, connectNext));

  const creators = await read('The YouTube creator list', () => deps.youtubeCreatorsStore.listCreators(COUNT_LIMIT, scope));
  stages.push(creators.ok ? youtubeCreatorsStage(creators.data) : inline(cannotTell('creators', creators.error, null)));

  // Outreach wizard 16/19: the comments worth replying to, ranked, worked right here.
  stages.push(await youtubeConversationsStage(deps.youtubeConversations, scope));

  const comments = await read('The YouTube comments', () => youtubeOutreachCommentsStore.listComments(COUNT_LIMIT, scope, { accountKey }));
  const commentsNext = go('Review YouTube comments', screen);
  if (!comments.ok) {
    stages.push(cannotTell('replies', comments.error, commentsNext));
  } else {
    const rows = Array.isArray(comments.data) ? comments.data : [];
    stages.push(repliesStage(countBy(rows, 'status'), rows.length, { one: 'comment', many: 'comments' }, commentsNext));
  }

  stages.push(await learnStage(deps, 'youtube', scope));
  return { key: 'youtube', label: 'YouTube', stages, account: accountView(account) };
}

async function substackChannel(deps, scope, now) {
  const { substackNotesStore, substackMinerStore } = deps;
  const accountKey = substackNotesStore.DEFAULT_ACCOUNT;
  const notes = PAGES.substackNotes;
  const miner = PAGES.substackMiner;
  const stages = [];

  const settings = await read('The Substack sign-in check', () => substackNotesStore.getSettings(scope, { accountKey }));
  const account = await read('The Substack account to post as', () => deps.outreachAccounts.getAccount('substack', scope, { accountKey }));
  const connectNext = go('Open Substack Notes', notes);
  stages.push(settings.ok
    ? connectWithAccount('Substack', settings.data?.browserCheck, account, connectNext, now)
    : cannotTell('connect', settings.error, connectNext));

  const candidates = await read('The Substack Miner writer list', () => substackMinerStore.listCandidates(COUNT_LIMIT, scope));
  const minerNext = go('Open the Substack Miner', miner);
  let approvedWriters = null;
  if (!candidates.ok) {
    stages.push(cannotTell('creators', candidates.error, minerNext));
  } else {
    const rows = Array.isArray(candidates.data) ? candidates.data : [];
    const byStatus = countBy(rows, 'status');
    const approved = byStatus.approved || 0;
    const undecided = byStatus.candidate || 0;
    approvedWriters = approved;
    const waitingText = undecided ? `, ${undecided} more waiting for your Approve or Reject` : '';
    if (!rows.length) {
      stages.push(stage('creators', 'not_started', 'No Substack writers found yet: 0 writers in the Miner. Paste a writer\'s article or profile link there, or search your keywords.', minerNext));
    } else if (!approved) {
      stages.push(stage('creators', 'needs_you', `${countText(rows.length)} writers found, 0 approved${waitingText}.`, minerNext));
    } else {
      stages.push(stage('creators', 'done', `${plural(approved, 'writer')} approved${waitingText}.`, minerNext));
    }
  }

  const items = await read('The Substack Notes list', () => substackNotesStore.listItems(COUNT_LIMIT, scope, { accountKey }));
  const notesNext = go('Open Substack Notes', notes);
  if (!items.ok) {
    stages.push(cannotTell('conversations', items.error, notesNext));
    stages.push(cannotTell('replies', items.error, notesNext));
  } else {
    const rows = Array.isArray(items.data) ? items.data : [];
    // Other people's Notes to reply to, restack or like: those come from a target.
    const found = rows.filter((r) => r?.source === 'target').length;
    const writers = approvedWriters === null ? '' : `${plural(approvedWriters, 'writer')} approved, `;
    if (deps.substackConversations) {
      // Outreach wizard 14/19: the ranked list the scheduled read and search fill.
      stages.push(await conversationsStage(deps.substackConversations, scope, notesNext));
    } else if (!found) {
      stages.push(stage('conversations', 'not_started', `${writers}0 Notes found to reply to yet.`.replace(/^./, (c) => c.toUpperCase()), notesNext));
    } else {
      stages.push(stage('conversations', 'done', `${countText(found)} other people's ${found === 1 ? 'Note' : 'Notes'} found to reply to, restack or like.`, notesNext));
    }
    stages.push(repliesStage(countBy(rows, 'status'), rows.length,
      { one: 'Note or reply', many: 'Notes and replies', idea: 'idea', ideas: 'ideas' },
      go('Review Substack Notes', notes)));
  }

  stages.push(await learnStage(deps, 'substack', scope));
  return { key: 'substack', label: 'Substack', stages, account: accountView(account) };
}

/**
 * Substack's Find conversations, from the ranked list (lib/substackConversations.js).
 * A reading that has not come back is "cannot tell" even when the list has
 * Notes in it — the list could be missing the writers who were not read.
 */
async function conversationsStage(conversations, scope, next) {
  const list = await read('The Substack conversations list', () => conversations.listSubstackConversations(scope));
  if (!list.ok) return cannotTell('conversations', list.error, next);
  const { newCount, reading, items } = list.data;
  const listed = Array.isArray(items) ? items.length : newCount;
  const worth = `${countText(newCount)} new ${newCount === 1 ? 'Note' : 'Notes'} worth replying to`;
  // The list is capped (lib/substackConversations.js MAX_LISTED); say so rather
  // than letting the count and the list disagree.
  const capped = listed < newCount ? `; the best ${listed} are listed` : '';
  if (reading.state === 'no_writers') return stage('conversations', 'not_started', reading.sentence, next);
  if (reading.state === 'cannot_tell') {
    return stage('conversations', 'cannot_tell', newCount ? `${worth} so far${capped}. ${reading.sentence}` : reading.sentence, next);
  }
  if (newCount) return stage('conversations', 'needs_you', capped ? `${worth}${capped}, best first.` : `${worth}, best first.`, next);
  return stage('conversations', 'done', `Nothing new to reply to. ${reading.sentence}`, next);
}

/**
 * YouTube's Find conversations, from the ranked comment list
 * (lib/youtubeConversationFinder.js) — the YouTube twin of conversationsStage.
 * Worked on this screen, so it names no other one.
 */
async function youtubeConversationsStage(finder, scope) {
  const list = await read('The YouTube conversations list', () => finder.listYoutubeConversations(scope));
  if (!list.ok) return inline(cannotTell('conversations', list.error, null));
  const { newCount, reading, videos } = list.data;
  const listed = (Array.isArray(videos) ? videos : []).reduce((n, v) => n + (v.comments || []).length, 0);
  const onVideos = (Array.isArray(videos) ? videos : []).filter((v) => (v.comments || []).length).length;
  const worth = `${countText(newCount)} ${newCount === 1 ? 'comment' : 'comments'} worth replying to on ${plural(onVideos, 'video')}`;
  const capped = listed < newCount ? `; the best ${listed} are listed` : '';
  if (reading.state === 'no_creators') return inline(stage('conversations', 'not_started', reading.sentence, null));
  if (reading.state === 'cannot_tell') {
    return inline(stage('conversations', 'cannot_tell', newCount ? `${worth} so far${capped}. ${reading.sentence}` : reading.sentence, null));
  }
  if (newCount) return inline(stage('conversations', 'needs_you', `${worth}${capped}, best first.`, null));
  return inline(stage('conversations', 'done', `Nothing new to reply to. ${reading.sentence}`, null));
}

async function redditChannel(deps, scope, now) {
  const { redditCommentsStore, canonStore } = deps;
  const screen = PAGES.reddit;
  const stages = [];
  const connectNext = go('Open Reddit comments', screen);

  const account = await read('The Reddit account to post as', () => deps.outreachAccounts.getAccount('reddit', scope));
  const check = await read('The Reddit sign-in check', () => redditCommentsStore.getBrowserCheck(scope));
  stages.push(check.ok ? connectWithAccount('Reddit', check.data, account, connectNext, now) : cannotTell('connect', check.error, connectNext));

  if (deps.redditWatchStore) {
    // Outreach wizard 18/19: the subreddits the Mini watches, chosen right here.
    const subs = await read('The subreddit list', () => deps.redditWatchStore.listSubreddits(COUNT_LIMIT, scope));
    stages.push(subs.ok ? subredditsStage(subs.data) : inline(cannotTell('creators', subs.error, null)));
  } else {
    stages.push(stage('creators', 'not_started',
      'There is no list of chosen subreddits yet. Reddit posts are added one link at a time.',
      go('Paste a Reddit link', screen)));
  }

  const items = await read('The Reddit comments list', () => redditCommentsStore.listItems(COUNT_LIMIT, scope));
  const canon = await read('The Dane of Earth canon', () => canonStore.listCanon(100, scope));
  const linkNext = go('Paste a Reddit link', screen);
  if (!items.ok) {
    stages.push(cannotTell('conversations', items.error, linkNext));
    stages.push(cannotTell('replies', items.error, go('Review Reddit comments', screen)));
  } else {
    const rows = Array.isArray(items.data) ? items.data : [];
    if (deps.redditConversations) {
      // Outreach wizard 18/19: the ranked list the Mini's watch fills.
      stages.push(await redditConversationsStage(deps.redditConversations, scope));
    } else if (!rows.length) {
      stages.push(stage('conversations', 'needs_you', 'No Reddit posts added yet: 0 links pasted.', linkNext));
    } else {
      stages.push(stage('conversations', 'done', `${countText(rows.length)} Reddit ${rows.length === 1 ? 'post' : 'posts'} added by link.`, linkNext));
    }
    const repliesNext = go('Review Reddit comments', screen);
    if (!canon.ok) {
      stages.push(cannotTell('replies', canon.error, repliesNext));
    } else {
      const docs = Array.isArray(canon.data) ? canon.data : [];
      const replies = repliesStage(countBy(rows, 'status'), rows.length,
        { one: 'comment', many: 'comments', idea: 'post', ideas: 'posts' }, repliesNext);
      if (!docs.length) {
        stages.push(stage('replies', 'needs_you',
          `No canon documents have been copied in, so a draft has no voice to write from (0 documents). ${replies.sentence}`, repliesNext));
      } else {
        const times = docs.map((d) => Date.parse(d.syncedAt || '')).filter(Number.isFinite);
        const copied = times.length ? `, copied ${dayText(new Date(Math.max(...times)).toISOString())}` : '';
        stages.push({ ...replies, sentence: `${replies.sentence} Written from ${plural(docs.length, 'canon document')}${copied}.` });
      }
    }
  }

  stages.push(await learnStage(deps, 'reddit', scope));
  return { key: 'reddit', label: 'Reddit', stages, account: accountView(account) };
}

function defaultDeps() {
  return {
    youtubeOutreachStore: require('./youtubeOutreachStore'),
    youtubeOutreachCommentsStore: require('./youtubeOutreachCommentsStore'),
    substackNotesStore: require('./substackNotesStore'),
    substackMinerStore: require('./substackMinerStore'),
    youtubeCreatorsStore: require('./youtubeCreatorsStore'),
    redditCommentsStore: require('./redditCommentsStore'),
    canonStore: require('./canonStore'),
    outreachAccounts: require('./outreachAccounts'),
    substackConversations: require('./substackConversations'),
    redditWatchStore: require('./redditWatchStore'),
    redditConversations: require('./redditConversations'),
    youtubeConversations: require('./youtubeConversationFinder'),
    outreachLessons: require('./outreachLessons'),
  };
}

/**
 * The whole overview. Each channel is built on its own and a throw inside one
 * channel's builder is caught there, so a bug in one cannot blank the others.
 */
async function buildOverview(scope, { deps = defaultDeps(), now = Date.now() } = {}) {
  const builders = [
    ['youtube', 'YouTube', youtubeChannel, PAGES.youtube],
    ['substack', 'Substack', substackChannel, PAGES.substackNotes],
    ['reddit', 'Reddit', redditChannel, PAGES.reddit],
  ];
  const channels = [];
  for (const [key, label, build, page] of builders) {
    try {
      channels.push(await build(deps, scope, now));
    } catch (err) {
      const why = `The ${label} overview could not be put together: ${trimStop(err?.message) || 'unknown error'}.`;
      channels.push({ key, label, stages: STAGES.map((s) => cannotTell(s.key, why, go(`Open ${label}`, page))) });
    }
  }
  return { generatedAt: new Date(now).toISOString(), expectedAccount: EXPECTED_CHANNEL, channels };
}

module.exports = {
  youtubeCreatorsStage,
  subredditsStage,
  redditConversationsStage,
  conversationsStage,
  youtubeConversationsStage,
  STATES,
  STAGES,
  PAGES,
  MINI_STALE_MS,
  COUNT_LIMIT,
  agoText,
  connectStage,
  connectWithAccount,
  accountView,
  repliesStage,
  buildOverview,
};
