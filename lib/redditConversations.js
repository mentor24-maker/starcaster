'use strict';

/**
 * Reddit's "Find conversations" stage — Outreach wizard 18/19 (task
 * 86bcrmbwm). The posts the Mini's four-hourly watch kept from Dane's approved
 * subreddits (lib/acquire/RedditWatchDue.js), ranked best first
 * (lib/outreachRanking.js), each with who wrote it, its strongest comments
 * and their authors, the subreddit's stated self-promotion rule, and one
 * sentence on why it ranked where it did.
 *
 * Left out: posts from a subreddit no longer approved, posts Dane skipped,
 * posts over two weeks old, and posts he already replied to or decided a
 * reply for. A reply still waiting as an idea or a draft does NOT hide the
 * post: it is shown with `replyStatus`, and Write replies picks that comment
 * up rather than making a second one.
 *
 * "CANNOT TELL", NEVER "0 FOUND". An empty list is only "nothing new" when
 * every approved subreddit's last read came back. One the Mini read while
 * signed out makes the whole answer "the Mini is signed out" — whatever the
 * list holds — and one never read, failed, or overdue makes it "cannot tell",
 * naming the subreddits. The stored readings are the evidence (landmine 17).
 */

const watchStore = require('./redditWatchStore');
const commentsStore = require('./redditCommentsStore');
const feedbackStore = require('./outreachFeedbackStore');
const ranking = require('./outreachRanking');
const { readCanonDocs } = require('./canonPrompt');
const { SUBREDDITS_PER_PASS, FRESH_FOR_MS } = require('./acquire/RedditWatchDue');

const HOUR_MS = 60 * 60 * 1000;
/** launchd's interval for the watch (scripts/install_reddit_watch.sh). */
const PASS_MS = 4 * HOUR_MS;
const SKIP_ITEM_KIND = 'conversation';
const OPEN_REPLY_STATUSES = new Set(['idea', 'draft']);
const MAX_LISTED = 50;

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

function text(value, max = 2000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function names(list) {
  const shown = list.slice(0, 3).map((s) => `r/${s.name}`);
  const more = list.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ').replace(/, ([^,]*)$/, ' and $1');
}

/**
 * How long a subreddit may go unread before an empty list cannot be trusted:
 * each pass reads SUBREDDITS_PER_PASS, so with n approved each is read every
 * ceil(n / per pass) passes. Twice that, plus one pass of slack.
 */
function overdueAfterMs(approvedCount) {
  const passesPerRound = Math.max(1, Math.ceil(approvedCount / SUBREDDITS_PER_PASS));
  return (passesPerRound * 2 + 1) * PASS_MS;
}

function hoursText(ms) {
  const h = Math.round(ms / HOUR_MS);
  return `${h} hour${h === 1 ? '' : 's'}`;
}

/**
 * Can an empty list be trusted? `{ state: 'current' | 'signed_out' |
 * 'cannot_tell' | 'no_subreddits', sentence }`. Pure.
 */
function readingVerdict(approved, now) {
  if (!approved.length) {
    return { state: 'no_subreddits', sentence: 'No subreddits are approved yet, so the Mini has nothing to watch. Approve some in Find creators first.' };
  }
  const signedOut = approved.filter((s) => s.lastReadState === 'signed_out');
  if (signedOut.length) {
    const newest = Math.max(...signedOut.map((s) => Date.parse(s.lastReadAt || '') || 0));
    const when = newest ? ` at ${new Date(newest).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '';
    return {
      state: 'signed_out',
      sentence: `Cannot tell what there is to reply to: the Mini's browser was signed out of Reddit when it last tried to read${when}, `
        + 'so it could not see the subreddits. Sign it in at Connect above; the next read is within four hours.',
    };
  }
  const limit = overdueAfterMs(approved.length);
  const unread = [];
  const failed = [];
  const overdue = [];
  for (const s of approved) {
    const at = Date.parse(s.lastReadAt || '');
    if (!Number.isFinite(at) || !s.lastReadState) unread.push(s);
    else if (s.lastReadState === 'failed') failed.push(s);
    else if (now - at > limit) overdue.push(s);
  }
  if (!unread.length && !failed.length && !overdue.length) {
    const all = approved.length === 1 ? `r/${approved[0].name} was` : `All ${approved.length} approved subreddits were`;
    return { state: 'current', sentence: `${all} read in the last ${hoursText(limit)}.` };
  }
  const bits = [];
  if (unread.length) bits.push(`${names(unread)} ${unread.length === 1 ? 'has' : 'have'} not been read yet`);
  if (failed.length) bits.push(`the last read of ${names(failed)} failed (${text(failed[0].lastReadError, 200).replace(/\.$/, '')})`);
  if (overdue.length) bits.push(`${names(overdue)} ${overdue.length === 1 ? 'has' : 'have'} not been read for over ${hoursText(limit)}`);
  return {
    state: 'cannot_tell',
    sentence: `Cannot tell whether there is more to reply to: ${bits.join(', and ')}. The Mini reads ${SUBREDDITS_PER_PASS} subreddits every four hours; `
      + 'if this stays, its schedule is not running.',
  };
}

/** The comment whose permalink a reply to it goes on. */
function commentUrl(post, commentId) {
  return `https://www.reddit.com/r/${post.subreddit}/comments/${post.postId}/comment/${commentId}/`;
}

/**
 * The ranked list for one project. `deps` replaces the stores and the clock
 * (tests). Answers `{ ok, data: { items, newCount, reading, canon, skippedCount } }`;
 * a store that cannot be read is a refusal naming it, never an empty list.
 */
async function listRedditConversations(scope, deps = {}) {
  const watch = deps.watchStore || watchStore;
  const comments = deps.commentsStore || commentsStore;
  const feedback = deps.feedbackStore || feedbackStore;
  const now = (deps.now || Date.now)();

  const subs = await watch.listSubreddits(1000, scope);
  if (!subs.ok) return { ...subs, error: `The subreddit list could not be read: ${subs.error}` };
  const posts = await watch.listPosts(1000, scope);
  if (!posts.ok) return { ...posts, error: `The posts found could not be read: ${posts.error}` };
  const items = await comments.listItems(1000, scope);
  if (!items.ok) return { ...items, error: `The Reddit comments list could not be read: ${items.error}` };
  const skipped = await feedback.listDecidedItemIds({ channel: 'reddit', itemKind: SKIP_ITEM_KIND }, scope);
  if (!skipped.ok) return { ...skipped, error: `The posts you skipped could not be read: ${skipped.error}` };
  const canon = await readCanonDocs(scope, { canonDocs: deps.canonDocs }, 'Not ranked');
  const terms = canon.ok ? ranking.canonTerms(canon.data) : [];

  const approved = subs.data.filter((s) => s.status === 'approved');
  const bySub = new Map(approved.map((s) => [s.name, s]));
  // A reply on this post — to the post or to one of its comments.
  const replyFor = new Map();
  for (const item of Array.isArray(items.data) ? items.data : []) {
    const key = text(item.postId, 20).toLowerCase();
    if (!key) continue;
    const prior = replyFor.get(key);
    if (!prior || !OPEN_REPLY_STATUSES.has(item.status)) replyFor.set(key, item);
  }
  const skippedSet = new Set(skipped.data);

  const fresh = posts.data.filter((p) => {
    if (!bySub.has(p.subreddit) || skippedSet.has(p.postId)) return false;
    const when = Date.parse(p.postedAt || p.foundAt || '');
    if (Number.isFinite(when) && now - when > FRESH_FOR_MS) return false;
    const reply = replyFor.get(p.postId);
    return !reply || OPEN_REPLY_STATUSES.has(reply.status);
  }).map((p) => {
    const reply = replyFor.get(p.postId);
    return {
      ...p,
      text: `${p.title}\n${p.body}`,
      replies: p.numComments,
      likes: p.score,
      approved: false,
      channel: 'reddit',
      promotionRule: bySub.get(p.subreddit).promotionRule,
      replyItemId: reply ? reply.id : '',
      replyStatus: reply ? reply.status : '',
    };
  });

  const allRanked = ranking.rankConversations(fresh, { terms, now })
    .map(({ text: _t, replies: _r, likes: _l, approved: _a, channel: _c, ...rest }) => rest);
  return {
    ok: true,
    status: 200,
    data: {
      items: allRanked.slice(0, MAX_LISTED),
      newCount: allRanked.length,
      reading: readingVerdict(approved, now),
      canon: canon.ok ? { ok: true, words: terms.length } : { ok: false, error: canon.error },
      skippedCount: skippedSet.size,
    },
  };
}

async function findListed(postId, scope, deps) {
  const id = text(postId, 20).toLowerCase();
  if (!/^[a-z0-9]{1,12}$/.test(id)) return refuse('postId must be a Reddit post id from the list.');
  const list = await listRedditConversations(scope, deps);
  if (!list.ok) return list;
  const hit = list.data.items.find((p) => p.postId === id);
  if (!hit) return refuse('That post is not on the list any more — it was skipped, replied to, or is over two weeks old. Reload the list.', 404);
  return { ok: true, data: hit };
}

/**
 * Write replies, to the post or (`commentId`) to one of its comments: the
 * comment to write is lined up on Engage › Comments from what the Mini
 * already read — no second visit — and its three options written. A reply
 * already drafted is left as it is.
 */
async function writeRepliesFor(input, scope, deps = {}) {
  const comments = deps.commentsStore || commentsStore;
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const found = await findListed(body.postId, scope, deps);
  if (!found.ok) return found;
  const post = found.data;
  const commentId = text(body.commentId, 40).toLowerCase();
  let parent = null;
  if (commentId) {
    parent = post.topComments.find((c) => c.id.toLowerCase() === commentId);
    if (!parent) return refuse('That comment is not one of the ones read for this post.', 404);
  }

  let itemId = post.replyItemId;
  let created = false;
  if (itemId && commentId) {
    // A reply is already lined up for this post; a second, to a comment, is a separate one.
    itemId = '';
  }
  if (!itemId) {
    const made = await comments.addItem({
      url: parent ? commentUrl(post, parent.id) : post.url,
      postTitle: post.title,
      postBody: post.body,
      ...(parent ? { parentCommentText: parent.body } : {}),
    }, scope);
    if (!made.ok) return { ...made, error: `The reply could not be lined up: ${made.error}` };
    itemId = made.data.id;
    created = true;
  }
  if (!created && post.replyStatus === 'draft') return { ok: true, status: 200, data: { itemId, created, drafted: false, status: 'draft' } };
  const written = await comments.writeDraftForItem(itemId, scope, { generate: deps.generate, canonDocs: deps.canonDocs });
  if (!written.ok) {
    return { ...written, error: `The reply is lined up on Engage › Comments, but its options were not written: ${written.error}` };
  }
  return { ok: true, status: 200, data: { itemId, created, drafted: true, status: written.data.status } };
}

/** Skip, with the reason picker's reason; the post leaves the list. */
async function skipConversation(input, scope, deps = {}) {
  const feedback = deps.feedbackStore || feedbackStore;
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const why = feedback.readRejectInput({ reasons: body.reasons, note: body.note });
  if (!why.ok) return why;
  const found = await findListed(body.postId, scope, deps);
  if (!found.ok) return found;
  const saved = await feedback.recordFeedback({
    channel: 'reddit',
    itemId: found.data.postId,
    itemKind: SKIP_ITEM_KIND,
    action: 'rejected',
    reasons: why.data.reasons,
    note: why.data.note,
    draftText: found.data.title,
  }, scope);
  if (!saved.ok) return { ...saved, error: `The post was NOT skipped: ${saved.error}` };
  return { ok: true, status: 200, data: { postId: found.data.postId, reasons: why.data.reasons } };
}

/**
 * Save a commenter (or the post's author) as a contact: a lead tagged
 * reddit, with their Reddit profile, and a note naming the post. Someone
 * already saved from Reddit is not saved twice — matched by profile link.
 */
async function saveContact(input, scope, deps = {}) {
  const contacts = deps.contactsStore || require('./ContactsStore');
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const found = await findListed(body.postId, scope, deps);
  if (!found.ok) return found;
  const post = found.data;
  const author = text(body.author, 100).replace(/^\/?u\//i, '');
  const known = [post.author, ...post.topComments.map((c) => c.author)].filter(Boolean);
  if (!author || !known.some((a) => a.toLowerCase() === author.toLowerCase())) {
    return refuse('That person did not write this post or one of the comments read under it.', 400);
  }
  if (['[deleted]', 'automoderator'].includes(author.toLowerCase())) return refuse(`u/${author} is not a person who can be saved as a contact.`);
  const profile = `https://www.reddit.com/user/${author}`;

  const listed = await contacts.listContacts({ limit: 5000, scope });
  if (!listed.ok) return { ...listed, error: `Contacts could not be read to check for u/${author}: ${listed.error}` };
  const rows = (Array.isArray(listed.data) ? listed.data : []).map((r) => contacts.rowToContact(r)).filter(Boolean);
  const existing = rows.find((c) => text(c.customFields?.reddit).toLowerCase() === profile.toLowerCase());
  if (existing) return { ok: true, status: 200, data: { contactId: existing.id, created: false, author } };

  const made = await contacts.createContact({
    id: `contact_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    contactType: 'lead',
    firstName: author,
    lastName: '',
    company: '',
    source: 'reddit_watch',
    status: 'new',
    notes: [`Found on Reddit by the Outreach watch, in r/${post.subreddit}.`, `Post: ${post.url}`, `Title: ${post.title}`].join('\n'),
    tags: ['reddit', 'outreach'],
    customFields: { reddit: profile },
  }, scope);
  if (!made.ok) return { ...made, error: `u/${author} was not saved as a contact: ${made.error}` };
  const row = Array.isArray(made.data) ? made.data[0] : made.data;
  return { ok: true, status: 201, data: { contactId: row?.id || '', created: true, author } };
}

module.exports = {
  listRedditConversations,
  writeRepliesFor,
  skipConversation,
  saveContact,
  readingVerdict,
  overdueAfterMs,
  commentUrl,
  SKIP_ITEM_KIND,
};
