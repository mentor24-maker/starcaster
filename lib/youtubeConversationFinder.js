'use strict';

/**
 * YouTube's "Find conversations" stage — Outreach wizard 16/19 (task
 * 86bcrmbtn). The comments worth replying to on the newest videos of the
 * channels Dane approved, grouped by video, each ranked (lib/outreachRanking.js,
 * `kind: 'comment'`) with who wrote it and one sentence on why it ranked there.
 *
 * Until this existed, replying to one particular comment needed its YouTube
 * comment id typed by hand (lib/youtubeOutreachStore.js `replyToCommentId`).
 * Now Write replies fills it in from the comment clicked.
 *
 * WHERE THE COMMENTS COME FROM. The three-hourly read
 * (lib/acquire/YoutubeCommentsReadDue.js) keeps each approved channel's uploads
 * from the last 14 days and their top-level comments on the channel's row
 * (`recent_videos`). Nothing here calls YouTube except Write replies and
 * Comment on the video, which add a video to the outreach list — that reads
 * the video's title the way adding one by link always has.
 *
 * ONE TARGET PER VIDEO. youtube_outreach_targets allows one row per video per
 * account, so a reply to a comment re-points the video's target at that
 * comment — but only while nothing is waiting on it. A video whose reply is
 * already waiting (a draft, approved, being posted) refuses a second by name,
 * and a video already commented on leaves the list: Dane has said his piece
 * there. Every refusal says which video and why (landmine 17).
 *
 * "CANNOT TELL", NEVER "0 FOUND". An empty list is only "nothing new" when
 * every approved channel was read recently. A channel never read, read more
 * than READING_OVERDUE_HOURS ago, or whose last read failed (the reason is
 * kept on its row) makes the answer "Cannot tell", naming the channels.
 */

const creatorsStoreDefault = require('./youtubeCreatorsStore');
const targetsStoreDefault = require('./youtubeOutreachStore');
const commentsStoreDefault = require('./youtubeOutreachCommentsStore');
const feedbackStoreDefault = require('./outreachFeedbackStore');
const ranking = require('./outreachRanking');
const { readCanonDocs } = require('./canonPrompt');

const HOUR_MS = 60 * 60 * 1000;
/** The read runs every 3 hours; four missed passes and a reading is overdue. */
const READING_OVERDUE_HOURS = 12;
const READING_OVERDUE_MS = READING_OVERDUE_HOURS * HOUR_MS;
/** What a skipped comment is recorded as in outreach_feedback (the Substack list's own kind). */
const SKIP_ITEM_KIND = 'conversation';
/** A comment older than this is not a conversation worth joining, however new its video says it is. */
const FRESH_FOR_MS = 14 * 24 * HOUR_MS;
/** The most comments listed under one video; the count above says how many there are in all. */
const MAX_LISTED_PER_VIDEO = 8;
/** Comment rows that mean a reply is still on its way out. */
const WAITING = new Set(['draft', 'approved', 'posting']);
const CONTACT_SOURCE = 'youtube_outreach';

function refuse(error, status = 400) {
  return { ok: false, status, error };
}

function text(value, max = 2000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function videoUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** A link to one comment: YouTube opens the video with it highlighted. */
function commentUrl(videoId, commentId) {
  return `${videoUrl(videoId)}&lc=${encodeURIComponent(commentId)}`;
}

function names(list) {
  const shown = list.slice(0, 3).map((c) => c.name || c.channelId);
  const more = list.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ').replace(/, ([^,]*)$/, ' and $1');
}

/**
 * Has every approved channel been read recently enough to trust the list?
 * `{ state: 'current' | 'cannot_tell' | 'no_creators', sentence }`.
 */
function readingVerdict(approved, now) {
  if (!approved.length) {
    return { state: 'no_creators', sentence: 'No YouTube channels are approved yet, so there are no comments to read. Approve channels in Find creators first.' };
  }
  const unread = [];
  const failed = [];
  const overdue = [];
  for (const c of approved) {
    const at = Date.parse(c.lastCommentsReadAt || '');
    if (c.commentsReadError) failed.push(c);
    else if (!Number.isFinite(at)) unread.push(c);
    else if (now - at > READING_OVERDUE_MS) overdue.push(c);
  }
  if (!unread.length && !failed.length && !overdue.length) {
    const all = approved.length === 1 ? 'The one approved channel was' : `All ${approved.length} approved channels were`;
    return { state: 'current', sentence: `${all} read in the last ${READING_OVERDUE_HOURS} hours.` };
  }
  const bits = [];
  if (unread.length) bits.push(`${unread.length} approved channel${unread.length === 1 ? ' has' : 's have'} not been read yet (${names(unread)})`);
  if (failed.length) {
    const why = failed[0].commentsReadError.replace(/[.\s]+$/, '');
    bits.push(`the last read of ${failed.length === 1 ? '' : `${failed.length} channels, `}${names(failed)} did not come back (${why})`);
  }
  if (overdue.length) bits.push(`${overdue.length} ${overdue.length === 1 ? 'has' : 'have'} not been read for over ${READING_OVERDUE_HOURS} hours (${names(overdue)})`);
  return {
    state: 'cannot_tell',
    sentence: `Cannot tell whether there is more to reply to: ${bits.join(', and ')}. The scheduled read runs every three hours; `
      + 'if this stays, YouTube refused it or the schedule is not running.',
  };
}

/**
 * Where one video stands on the outreach list: `{ state, sentence, pointer }`.
 *   open       nothing is waiting — every button works
 *   waiting    a reply is on its way out for `pointer` (a comment id, or
 *              'video'); only that one can be opened, the rest wait
 *   paused     the target is not active — resume it on the outreach screen
 *   commented  a comment was posted here — the video leaves the list
 */
function videoState(target, latest, statusWords, who) {
  if (!target) return { state: 'open', sentence: '', pointer: '' };
  const pointer = target.commentPlacement === 'reply_specific' ? target.replyToCommentId : (target.commentPlacement === 'top_level' ? 'video' : '');
  if (latest && latest.status === 'posted') return { state: 'commented', sentence: 'You have already commented on this video.', pointer };
  if (target.status !== 'active') {
    return { state: 'paused', sentence: `This video is ${target.status} on the YouTube outreach list, so nothing new can be written for it. Resume it there first.`, pointer };
  }
  if (latest && WAITING.has(latest.status)) {
    const what = pointer === 'video' ? 'the video itself' : (who(pointer) ? `${who(pointer)}'s comment` : 'another comment');
    return {
      state: 'waiting',
      sentence: `A reply to ${what} is ${statusWords[latest.status] || latest.status}. Finish or reject it on the YouTube outreach screen before writing another for this video.`,
      pointer,
    };
  }
  return { state: 'open', sentence: '', pointer };
}

/**
 * The ranked list for one project. `deps` replaces the stores and the clock
 * (tests). Answers `{ ok, data: { videos, newCount, reading, canon,
 * skippedCount, commentedCount } }`; a store that cannot be read is a refusal
 * naming it, never an empty list.
 */
async function listYoutubeConversations(scope, deps = {}) {
  const creators = deps.creatorsStore || creatorsStoreDefault;
  const targets = deps.targetsStore || targetsStoreDefault;
  const comments = deps.commentsStore || commentsStoreDefault;
  const feedback = deps.feedbackStore || feedbackStoreDefault;
  const now = (deps.now || Date.now)();
  const accountKey = targets.DEFAULT_ACCOUNT;

  const approvedRead = await creators.listCreators(500, scope, { status: 'approved' });
  if (!approvedRead.ok) return { ...approvedRead, error: `The approved YouTube channels could not be read: ${approvedRead.error}` };
  const approved = Array.isArray(approvedRead.data) ? approvedRead.data : [];
  const targetRead = await targets.listTargets(1000, scope, { accountKey });
  if (!targetRead.ok) return { ...targetRead, error: `The YouTube outreach video list could not be read: ${targetRead.error}` };
  const commentRead = await comments.listComments(1000, scope, { accountKey });
  if (!commentRead.ok) return { ...commentRead, error: `The YouTube replies already written could not be read: ${commentRead.error}` };
  const skipped = await feedback.listDecidedItemIds({ channel: 'youtube', itemKind: SKIP_ITEM_KIND }, scope);
  if (!skipped.ok) return { ...skipped, error: `The comments you skipped could not be read: ${skipped.error}` };
  const canon = await readCanonDocs(scope, { canonDocs: deps.canonDocs }, 'Not ranked');
  // No canon is not fatal: the ranking loses its canon part and says so.
  const terms = canon.ok ? ranking.canonTerms(canon.data) : [];

  const targetByVideo = new Map((targetRead.data || []).map((t) => [t.videoId, t]));
  // listComments is newest first, so the first row seen per target is its latest.
  const latestByTarget = new Map();
  for (const c of commentRead.data || []) if (!latestByTarget.has(c.targetId)) latestByTarget.set(c.targetId, c);
  const skippedSet = new Set(skipped.data);

  const videos = [];
  const flat = [];
  let commentedCount = 0;
  const seenVideos = new Set();
  for (const creator of approved) {
    for (const v of creator.recentVideos || []) {
      if (!v || !v.videoId || seenVideos.has(v.videoId)) continue;
      seenVideos.add(v.videoId);
      const target = targetByVideo.get(v.videoId) || null;
      const latest = target ? latestByTarget.get(target.id) || null : null;
      const byId = new Map((v.comments || []).map((c) => [c.commentId, c]));
      const state = videoState(target, latest, comments.STATUS_WORDS || {}, (id) => byId.get(id)?.authorName || '');
      if (state.state === 'commented') { commentedCount += 1; continue; }
      const replyStatusFor = (pointer) => (state.pointer === pointer ? (latest ? latest.status : 'lined_up') : '');
      const video = {
        videoId: v.videoId,
        videoUrl: videoUrl(v.videoId),
        title: text(v.title, 300),
        publishedAt: v.publishedAt || '',
        commentsDisabled: v.commentsDisabled === true,
        channel: { id: creator.id, channelId: creator.channelId, name: creator.name || creator.channelId, url: creator.channelUrl },
        targetId: target ? target.id : '',
        state: state.state,
        blocked: state.sentence,
        waitingOn: state.state === 'waiting' ? state.pointer : '',
        replyStatus: replyStatusFor('video'),
        comments: [],
      };
      for (const c of v.comments || []) {
        if (skippedSet.has(c.commentId)) continue;
        // YouTube lists an old upload as new when it is re-published or
        // premiered late; its months-old comments are not fresh conversations.
        const posted = Date.parse(c.publishedAt || '');
        if (Number.isFinite(posted) && now - posted > FRESH_FOR_MS) continue;
        const replyStatus = replyStatusFor(c.commentId);
        // Approved or on its way out: Dane is done with this one.
        if (replyStatus === 'approved' || replyStatus === 'posting') continue;
        flat.push({
          kind: 'comment',
          videoId: v.videoId,
          commentId: c.commentId,
          url: commentUrl(v.videoId, c.commentId),
          text: text(c.text, 2000),
          postedAt: c.publishedAt || '',
          likes: c.likes,
          replies: c.replies,
          author: { name: c.authorName || 'A YouTube viewer', channelUrl: c.authorChannelUrl || '', channelId: c.authorChannelId || '' },
          replyStatus,
        });
      }
      videos.push(video);
    }
  }

  // One ranking across every video, so "best" means the same thing everywhere.
  const ranked = ranking.rankConversations(flat, { terms, now });
  const byVideo = new Map(videos.map((v) => [v.videoId, v]));
  const best = new Map();
  for (const c of ranked) {
    const v = byVideo.get(c.videoId);
    if (!best.has(c.videoId)) best.set(c.videoId, c.score);
    if (v.comments.length < MAX_LISTED_PER_VIDEO) v.comments.push(c);
  }
  // Videos with the best comment first; a video with none to list goes last, newest first.
  videos.sort((a, b) => (best.get(b.videoId) ?? -1) - (best.get(a.videoId) ?? -1)
    || (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));

  return {
    ok: true,
    status: 200,
    data: {
      videos,
      newCount: ranked.length,
      reading: readingVerdict(approved, now),
      canon: canon.ok ? { ok: true, words: terms.length } : { ok: false, error: canon.error },
      skippedCount: skippedSet.size,
      commentedCount,
    },
  };
}

/** The video (and the comment, when one is named) among the ones listed — the buttons act on nothing else. */
async function findListed({ videoId, commentId }, scope, deps) {
  const wantVideo = text(videoId, 20);
  const wantComment = text(commentId, 200);
  if (!wantVideo && !wantComment) return refuse('Say which comment (commentId) or which video (videoId).');
  const list = await listYoutubeConversations(scope, deps);
  if (!list.ok) return list;
  for (const video of list.data.videos) {
    if (wantComment) {
      const comment = video.comments.find((c) => c.commentId === wantComment);
      if (comment) return { ok: true, data: { video, comment } };
    } else if (video.videoId === wantVideo) {
      return { ok: true, data: { video, comment: null } };
    }
  }
  return refuse(wantComment
    ? 'That comment is not on the list any more — it was skipped, replied to, or its video is over two weeks old. Reload the list.'
    : 'That video is not on the list any more — it was commented on, or is over two weeks old. Reload the list.', 404);
}

/**
 * Point the video's target at `placement` (+ the comment), creating it when
 * the video is not on the outreach list yet. Answers `{ target, created }`.
 */
async function lineUpTarget(video, placement, commentId, scope, deps) {
  const targets = deps.targetsStore || targetsStoreDefault;
  const settings = placement === 'reply_specific'
    ? { commentPlacement: 'reply_specific', replyToCommentId: commentId }
    : { commentPlacement: 'top_level' };
  if (!video.targetId) {
    const made = await targets.createTarget({ videoUrl: video.videoUrl, source: 'search', ...settings }, scope, { lookup: deps.lookup });
    if (!made.ok) return { ...made, error: `The video could not be added to the YouTube outreach list: ${made.error}` };
    return { ok: true, data: { target: made.data, created: true } };
  }
  const moved = await targets.updateTarget(video.targetId, settings, scope);
  if (!moved.ok) return { ...moved, error: `The video's outreach settings could not be pointed at this ${commentId ? 'comment' : 'video'}: ${moved.error}` };
  return { ok: true, data: { target: moved.data, created: false } };
}

/** Shared by Write replies and Comment on the video. */
async function writeFor(video, pointer, scope, deps) {
  const comments = deps.commentsStore || commentsStoreDefault;
  if (video.state !== 'open' && !(video.state === 'waiting' && video.waitingOn === pointer)) {
    return refuse(video.blocked || 'Nothing new can be written for this video right now.', 409);
  }
  const current = pointer === 'video' ? video.replyStatus : (video.comments.find((c) => c.commentId === pointer)?.replyStatus || '');
  // A draft already waiting is opened, not written twice.
  if (current === 'draft') {
    return { ok: true, status: 200, data: { targetId: video.targetId, created: false, drafted: false, status: 'draft' } };
  }
  const placement = pointer === 'video' ? 'top_level' : 'reply_specific';
  const lined = await lineUpTarget(video, placement, pointer === 'video' ? '' : pointer, scope, deps);
  if (!lined.ok) return lined;
  const { target, created } = lined.data;
  const written = await comments.writeDraftForTarget(target.id, scope, {
    onlyIfNoneWaiting: true, generate: deps.generate, canonDocs: deps.canonDocs, readVideo: deps.readVideo,
  });
  if (!written.ok) {
    return { ...written, error: `The video is lined up on the YouTube outreach screen, but its replies were not written: ${written.error}` };
  }
  return {
    ok: true,
    status: 200,
    data: { targetId: target.id, replyToCommentId: target.replyToCommentId, created, drafted: true, status: written.data.status, draftId: written.data.id },
  };
}

/**
 * Write replies: put the comment's video on the outreach list with
 * `replyToCommentId` set to THIS comment, and write its three options for the
 * chooser on the YouTube outreach screen.
 */
async function writeRepliesFor(input, scope, deps = {}) {
  const found = await findListed({ commentId: input?.commentId }, scope, deps);
  if (!found.ok) return found;
  return writeFor(found.data.video, found.data.comment.commentId, scope, deps);
}

/** Comment on the video: the same, as a top-level comment on the video itself. */
async function commentOnVideo(input, scope, deps = {}) {
  const found = await findListed({ videoId: input?.videoId }, scope, deps);
  if (!found.ok) return found;
  if (found.data.video.commentsDisabled) return refuse('Comments are turned off on this video, so there is nothing to post a comment into.', 409);
  return writeFor(found.data.video, 'video', scope, deps);
}

/**
 * Skip: record why (or "no reason given") and take the comment off the list.
 * The reason goes where every outreach rejection goes (outreach_feedback), so
 * the reason picker offers it next time and Learn can read it.
 */
async function skipConversation(input, scope, deps = {}) {
  const feedback = deps.feedbackStore || feedbackStoreDefault;
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const why = feedback.readRejectInput({ reasons: body.reasons, note: body.note });
  if (!why.ok) return why;
  const found = await findListed({ commentId: body.commentId }, scope, deps);
  if (!found.ok) return found;
  const { comment } = found.data;
  const saved = await feedback.recordFeedback({
    channel: 'youtube',
    itemId: comment.commentId,
    itemKind: SKIP_ITEM_KIND,
    action: 'rejected',
    reasons: why.data.reasons,
    note: why.data.note,
    draftText: comment.text,
  }, scope);
  if (!saved.ok) return { ...saved, error: `The comment was NOT skipped: ${saved.error}` };
  return { ok: true, status: 200, data: { commentId: comment.commentId, reasons: why.data.reasons } };
}

function sameChannel(a, b) {
  const norm = (u) => String(u || '').trim().replace(/\/+$/, '').toLowerCase();
  return Boolean(norm(a)) && norm(a) === norm(b);
}

/**
 * Save as contact: the commenter as a Contacts entry, source youtube_outreach.
 * Matched on their channel link first, so a second click finds the first
 * contact instead of making another. Answers `{ mode: 'created' | 'existing', contact: { id, firstName, youtube, … } }`.
 */
async function saveCommenterAsContact(input, scope, deps = {}) {
  const contacts = deps.contactsStore || require('./ContactsStore');
  const found = await findListed({ commentId: input?.commentId }, scope, deps);
  if (!found.ok) return found;
  const { video, comment } = found.data;
  if (!comment.author.channelUrl) return refuse('YouTube did not say which channel wrote this comment, so there is nothing to save as a contact.', 409);

  const listed = await contacts.listContacts({ limit: 5000, orderBy: 'updated_at', orderDir: 'desc', scope });
  if (!listed.ok) return { ...listed, error: `Your contacts could not be read to check for this person already: ${listed.error}` };
  const rows = (Array.isArray(listed.data) ? listed.data : []).map((r) => contacts.rowToContact(r)).filter(Boolean);
  const existing = rows.find((c) => sameChannel(c.youtube, comment.author.channelUrl));
  if (existing) return { ok: true, status: 200, data: { mode: 'existing', contact: existing } };

  const id = `contact_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const made = await contacts.createContact({
    id,
    contactType: 'lead',
    firstName: comment.author.name,
    youtube: comment.author.channelUrl,
    source: CONTACT_SOURCE,
    status: 'new',
    notes: `Commented on "${video.title || video.videoId}" by ${video.channel.name} (${comment.url}):\n"${text(comment.text, 500)}"`,
    tags: ['youtube', 'outreach'],
    customFields: comment.author.channelId ? { youtube_channel_id: comment.author.channelId } : {},
  }, scope);
  if (!made.ok) return { ...made, error: `${comment.author.name} was not saved as a contact: ${made.error}` };
  // createContact answers a raw row or an already-flattened contact depending
  // on the database's shape, so only what both carry is passed back.
  return { ok: true, status: 201, data: { mode: 'created', contact: { id, firstName: comment.author.name, youtube: comment.author.channelUrl, source: CONTACT_SOURCE } } };
}

module.exports = {
  listYoutubeConversations,
  writeRepliesFor,
  commentOnVideo,
  skipConversation,
  saveCommenterAsContact,
  readingVerdict,
  videoState,
  commentUrl,
  SKIP_ITEM_KIND,
  CONTACT_SOURCE,
  READING_OVERDUE_MS,
  FRESH_FOR_MS,
  MAX_LISTED_PER_VIDEO,
};
