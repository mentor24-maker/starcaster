'use strict';

const xClient = require('../xClient');

function safeText(value) {
  return String(value || '').trim();
}

function splitHashtags(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,\s]+/g);
  return source
    .map((item) => safeText(item).replace(/^#+/, ''))
    .filter(Boolean);
}

function normalizeIso(value) {
  const text = safeText(value);
  if (!text) return '';
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function normalizeInput(input = {}) {
  return {
    query: safeText(input.query),
    hashtags: splitHashtags(input.hashtags),
    lang: safeText(input.lang),
    start_time: normalizeIso(input.start_time || input.startTime),
    end_time: normalizeIso(input.end_time || input.endTime),
    max_tweets: Math.max(10, Math.min(Number(input.max_tweets || input.maxTweets || 25) || 25, 100)),
    max_replies_per_tweet: Math.max(1, Math.min(Number(input.max_replies_per_tweet || input.maxRepliesPerTweet || 10) || 10, 100)),
    include_replies: input.include_replies === true || input.includeReplies === true,
    exclude_retweets: input.exclude_retweets !== false && input.excludeRetweets !== false,
    exclude_replies: input.exclude_replies === true || input.excludeReplies === true,
  };
}

function mergeUsers(...userLists) {
  const byId = new Map();
  userLists.forEach((items) => {
    (Array.isArray(items) ? items : []).forEach((user) => {
      const id = safeText(user?.id);
      if (!id) return;
      if (!byId.has(id)) byId.set(id, user);
    });
  });
  return Array.from(byId.values());
}

async function runXAcquire(rawInput = {}) {
  const input = normalizeInput(rawInput);
  if (!input.query && !input.hashtags.length) {
    return { ok: false, status: 400, error: 'Provide at least one keyword query or hashtag.' };
  }

  const search = await xClient.searchRecentTweets({
    query: input.query,
    hashtags: input.hashtags,
    lang: input.lang,
    startTime: input.start_time,
    endTime: input.end_time,
    maxResults: input.max_tweets,
    excludeRetweets: input.exclude_retweets,
    excludeReplies: input.exclude_replies,
  });
  if (!search.ok) return search;

  const tweets = Array.isArray(search.data?.data) ? search.data.data : [];
  const includesUsers = Array.isArray(search.data?.includes?.users) ? search.data.includes.users : [];
  const errors = [];
  const replies = [];
  let allUsers = includesUsers.slice();
  let threadsScanned = 0;

  if (input.include_replies) {
    const visitedThreads = new Set();
    const seenReplyIds = new Set();
    for (let idx = 0; idx < tweets.length; idx += 1) {
      const tweet = tweets[idx];
      const tweetId = safeText(tweet?.id);
      const conversationId = safeText(tweet?.conversation_id || tweetId);
      if (!conversationId || visitedThreads.has(conversationId)) continue;
      visitedThreads.add(conversationId);
      threadsScanned += 1;
      const thread = await xClient.fetchConversationReplies(conversationId, {
        maxResults: input.max_replies_per_tweet,
        lang: input.lang,
        startTime: input.start_time,
        endTime: input.end_time,
      });
      if (!thread.ok) {
        errors.push({
          type: 'replies',
          conversation_id: conversationId,
          status: Number(thread.status || 0) || 0,
          error: String(thread.error || 'Failed to fetch replies'),
          endpoint: String(thread.endpoint || ''),
        });
        continue;
      }
      const threadTweets = Array.isArray(thread.data?.data) ? thread.data.data : [];
      threadTweets.forEach((item) => {
        const itemId = safeText(item?.id);
        if (!itemId || itemId === tweetId || seenReplyIds.has(itemId)) return;
        seenReplyIds.add(itemId);
        replies.push(item);
      });
      allUsers = mergeUsers(allUsers, thread.data?.includes?.users || []);
    }
  }

  return {
    ok: true,
    status: Number(search.status || 200) || 200,
    data: {
      query: search.data?.query || '',
      tweets,
      replies,
      users: allUsers,
      meta: {
        ...((search.data?.meta && typeof search.data.meta === 'object') ? search.data.meta : {}),
        threads_scanned: threadsScanned,
      },
      errors,
      endpoints: {
        tweets: String(search.endpoint || ''),
      },
    },
  };
}

module.exports = {
  runXAcquire,
  normalizeInput,
};

