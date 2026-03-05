'use strict';

const { sendOk, sendErr, parseJsonBody } = require('./http');
const { logActivity } = require('../lib/activityLog');
const socialStore = require('../lib/engageSocialStore');
const xClient = require('../lib/xClient');

async function publishStoredPost(post) {
  if (!post) return { ok: false, status: 404, error: 'Post not found' };

  socialStore.updatePost(post.id, { status: 'publishing', error: '' });
  const result = await xClient.createPost(post.text);
  if (!result.ok) {
    const failed = socialStore.updatePost(post.id, {
      status: 'failed',
      error: String(result.error || 'Unknown publish error'),
    });
    return { ...result, post: failed };
  }

  const published = socialStore.updatePost(post.id, {
    status: 'published',
    publishedAt: new Date().toISOString(),
    remoteId: String(result.data?.id || ''),
    error: '',
  });

  logActivity({
    action: 'engage.social.x_posted',
    entityType: 'engage_social_post',
    entityId: published?.id || null,
    summary: `Published X post ${published?.id || ''}`,
    meta: { remoteId: published?.remoteId || '' },
  });

  return { ok: true, status: 200, data: { post: published, remote: result.data } };
}

async function handle(req, res, pathname, method) {
  const requestMethod = String(method || '').toUpperCase();

  if (pathname === '/api/engage/social/x/status' && requestMethod === 'GET') {
    const creds = xClient.getXCredentials();
    const payload = {
      configured: xClient.isConfigured(),
      accountName: creds.accountName || '',
      hasApiKey: Boolean(creds.apiKey),
      hasApiSecret: Boolean(creds.apiSecret),
      hasAccessToken: Boolean(creds.accessToken),
      hasAccessTokenSecret: Boolean(creds.accessTokenSecret),
    };
    return sendOk(res, 200, payload, payload), true;
  }

  if (pathname === '/api/engage/social/posts' && requestMethod === 'GET') {
    const posts = socialStore.listPosts();
    return sendOk(res, 200, posts, { posts }, { total: posts.length }), true;
  }

  if (pathname === '/api/engage/social/posts' && requestMethod === 'POST') {
    const body = await parseJsonBody(req);
    const text = String(body.text || '').trim();
    const publishNow = Boolean(body.publishNow);
    const scheduledFor = String(body.scheduledFor || '').trim();

    if (!text) return sendErr(res, 400, 'Post text is required', { code: 'VALIDATION_ERROR' }), true;
    if (text.length > 280) return sendErr(res, 400, 'X posts must be 280 characters or fewer', { code: 'VALIDATION_ERROR' }), true;

    const created = socialStore.createPost({
      text,
      scheduledFor: publishNow ? '' : scheduledFor,
      status: publishNow ? 'queued' : 'scheduled',
    });

    logActivity({
      action: publishNow ? 'engage.social.publish_now_requested' : 'engage.social.scheduled',
      entityType: 'engage_social_post',
      entityId: created.id,
      summary: publishNow ? 'Publish now requested for X post' : 'Scheduled X post',
      meta: { scheduledFor: created.scheduledFor || '' },
    });

    if (publishNow) {
      const publishResult = await publishStoredPost(created);
      if (!publishResult.ok) {
        return sendErr(res, publishResult.status || 500, publishResult.error, {
          code: 'X_PUBLISH_FAILED',
        }), true;
      }
      return sendOk(res, 201, publishResult.data, publishResult.data), true;
    }

    return sendOk(res, 201, { post: created }, { post: created }), true;
  }

  if (pathname === '/api/engage/social/posts/publish-due' && requestMethod === 'POST') {
    const duePosts = socialStore.listDuePosts();
    const results = [];
    for (const post of duePosts) {
      const result = await publishStoredPost(post);
      results.push({
        id: post.id,
        ok: !!result.ok,
        error: result.ok ? '' : String(result.error || 'Publish failed'),
      });
    }
    const posts = socialStore.listPosts();
    return sendOk(res, 200, { processed: results, posts }, { processed: results, posts }), true;
  }

  const publishMatch = String(pathname || '').match(/^\/api\/engage\/social\/posts\/([^/]+)\/publish\/?$/);
  if (publishMatch && requestMethod === 'POST') {
    const postId = decodeURIComponent(publishMatch[1] || '');
    const post = socialStore.getPost(postId);
    if (!post) return sendErr(res, 404, 'Post not found', { code: 'NOT_FOUND' }), true;
    const result = await publishStoredPost(post);
    if (!result.ok) return sendErr(res, result.status || 500, result.error, { code: 'X_PUBLISH_FAILED' }), true;
    return sendOk(res, 200, result.data, result.data), true;
  }

  const postMatch = String(pathname || '').match(/^\/api\/engage\/social\/posts\/([^/]+)\/?$/);
  if (postMatch && requestMethod === 'DELETE') {
    const postId = decodeURIComponent(postMatch[1] || '');
    const deleted = socialStore.deletePost(postId);
    if (!deleted) return sendErr(res, 404, 'Post not found', { code: 'NOT_FOUND' }), true;
    logActivity({
      action: 'engage.social.deleted',
      entityType: 'engage_social_post',
      entityId: deleted.id,
      summary: 'Deleted X post from queue',
    });
    return sendOk(res, 200, { post: deleted }, { post: deleted }), true;
  }

  return false;
}

const manifest = {
  id: 'engage',
  label: 'Engage',
  prefixes: ['/api/engage'],
};

module.exports = { handle, manifest };
