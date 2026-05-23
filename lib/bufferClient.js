'use strict';

const { getProviderValues } = require('./apiSettings');

function safeText(value) {
  return String(value || '').trim();
}

function getBufferCredentials() {
  const stored = getProviderValues('buffer') || {};
  return {
    apiKey: safeText(stored.api_key),
    organizationId: safeText(stored.organization_id),
    defaultChannelId: safeText(stored.default_channel_id),
    baseUrl: (safeText(stored.base_url) || 'https://api.buffer.com').replace(/\/+$/, ''),
  };
}

function isConfigured(creds = getBufferCredentials()) {
  return Boolean(creds.apiKey);
}

function isHttpUrl(value) {
  const text = safeText(value);
  if (!text) return false;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function bufferQueueLimit(options = {}) {
  const raw = safeText(options.queueLimit) || safeText(process.env.BUFFER_QUEUE_LIMIT) || '10';
  const limit = Number(raw);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
}

function graphQlErrorMessage(payload) {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const messages = errors
    .map((err) => safeText(err?.message))
    .filter(Boolean);
  return messages.join('; ');
}

async function graphql(query, variables = {}, creds = getBufferCredentials()) {
  if (!isConfigured(creds)) {
    return {
      ok: false,
      status: 400,
      error: 'Buffer API key is missing. Save API Key in Settings > APIs > Buffer.',
    };
  }

  const endpoint = creds.baseUrl || 'https://api.buffer.com';
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    return {
      ok: false,
      endpoint,
      status: 502,
      error: `Buffer request failed: ${safeText(err?.message) || 'request failed'}`,
    };
  }

  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }

  const gqlMessage = graphQlErrorMessage(payload);
  if (!response.ok || gqlMessage) {
    const detail = gqlMessage || safeText(payload?.message || raw || response.statusText) || 'Unknown Buffer API error';
    return {
      ok: false,
      endpoint,
      status: response.status || 502,
      error: `Buffer API error: ${detail}`,
      data: payload,
    };
  }

  return {
    ok: true,
    endpoint,
    status: response.status,
    data: payload?.data || {},
    raw: payload,
  };
}

async function listOrganizations(creds = getBufferCredentials()) {
  const query = `
    query GetOrganizations {
      account {
        organizations {
          id
          name
          ownerEmail
        }
      }
    }
  `;
  const result = await graphql(query, {}, creds);
  if (!result.ok) return result;
  const organizations = Array.isArray(result.data?.account?.organizations)
    ? result.data.account.organizations
    : [];
  return {
    ok: true,
    status: result.status,
    endpoint: result.endpoint,
    data: { organizations },
  };
}

async function resolveOrganizationId(creds = getBufferCredentials()) {
  if (safeText(creds.organizationId)) {
    return { ok: true, status: 200, data: { organizationId: safeText(creds.organizationId), source: 'configured' } };
  }
  const orgs = await listOrganizations(creds);
  if (!orgs.ok) return orgs;
  const organizations = Array.isArray(orgs.data?.organizations) ? orgs.data.organizations : [];
  const organization = organizations[0] || null;
  if (!organization?.id) {
    return {
      ok: false,
      status: 400,
      error: 'No Buffer organization found. Save organization_id in Settings > APIs > Buffer.',
      data: orgs.data,
    };
  }
  return {
    ok: true,
    status: 200,
    data: { organizationId: safeText(organization.id), source: 'account.organizations', organization },
  };
}

async function listChannels(options = {}, creds = getBufferCredentials()) {
  const organizationId = safeText(options.organizationId) || safeText(creds.organizationId);
  if (!organizationId) {
    const resolved = await resolveOrganizationId(creds);
    if (!resolved.ok) return resolved;
    return listChannels({ organizationId: resolved.data.organizationId }, creds);
  }

  const query = `
    query GetChannels($organizationId: OrganizationId!) {
      channels(input: { organizationId: $organizationId }) {
        id
        name
        displayName
        service
        avatar
        isQueuePaused
      }
    }
  `;
  const result = await graphql(query, { organizationId }, creds);
  if (!result.ok) return result;
  const channels = Array.isArray(result.data?.channels) ? result.data.channels : [];
  return {
    ok: true,
    status: result.status,
    endpoint: result.endpoint,
    data: { organizationId, channels },
  };
}

async function checkAuth(creds = getBufferCredentials()) {
  const orgs = await listOrganizations(creds);
  if (!orgs.ok) return orgs;
  return {
    ok: true,
    status: orgs.status,
    endpoint: orgs.endpoint,
    data: {
      organizations: Array.isArray(orgs.data?.organizations) ? orgs.data.organizations : [],
    },
  };
}

async function getQueueStatus(options = {}, creds = getBufferCredentials()) {
  const channelId = safeText(options.channelId) || safeText(creds.defaultChannelId);
  const organizationId = safeText(options.organizationId) || safeText(creds.organizationId);
  const limit = bufferQueueLimit(options);
  if (!channelId) {
    return {
      ok: false,
      status: 400,
      error: 'Buffer channel_id is missing. Save Default Channel ID in Settings > APIs > Buffer.',
    };
  }
  if (!organizationId) {
    const resolved = await resolveOrganizationId(creds);
    if (!resolved.ok) return resolved;
    return getQueueStatus({ ...options, organizationId: resolved.data.organizationId, channelId }, creds);
  }

  const query = `
    query GetBufferScheduledPosts($organizationId: OrganizationId!, $channelIds: [ChannelId!], $first: Int) {
      posts(
        first: $first,
        input: {
          organizationId: $organizationId,
          filter: {
            status: [scheduled],
            channelIds: $channelIds
          }
        }
      ) {
        edges {
          node {
            id
            dueAt
            status
            channelId
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;
  const result = await graphql(query, {
    organizationId,
    channelIds: [channelId],
    first: limit,
  }, creds);
  if (!result.ok) return result;
  const edges = Array.isArray(result.data?.posts?.edges) ? result.data.posts.edges : [];
  const count = edges.length;
  const hasNextPage = Boolean(result.data?.posts?.pageInfo?.hasNextPage);
  return {
    ok: true,
    status: result.status,
    endpoint: result.endpoint,
    data: {
      organizationId,
      channelId,
      scheduledCount: count,
      limit,
      remaining: Math.max(0, limit - count),
      isFull: count >= limit || hasNextPage,
      hasNextPage,
      posts: edges.map((edge) => edge?.node).filter(Boolean),
    },
  };
}

async function createQueuedPost(textInput, options = {}, creds = getBufferCredentials()) {
  const text = safeText(textInput);
  if (!text) return { ok: false, status: 400, error: 'Post text is required' };
  if (!isConfigured(creds)) {
    return {
      ok: false,
      status: 400,
      error: 'Buffer API key is missing. Save API Key in Settings > APIs > Buffer.',
    };
  }

  const channelId = safeText(options.channelId) || safeText(creds.defaultChannelId);
  if (!channelId) {
    return {
      ok: false,
      status: 400,
      error: 'Buffer default_channel_id is missing. Save Default Channel ID in Settings > APIs > Buffer.',
    };
  }

  const imageUrl = safeText(options.imageUrl);
  if (imageUrl && !isHttpUrl(imageUrl)) {
    return { ok: false, status: 400, error: 'Buffer image URL must be a public http/https URL.' };
  }

  if (options.checkCapacity !== false) {
    const queue = await getQueueStatus({ channelId, queueLimit: options.queueLimit }, creds);
    if (!queue.ok) return queue;
    if (queue.data?.isFull) {
      return {
        ok: false,
        status: 409,
        error: `Buffer queue is full for channel ${channelId} (${queue.data.scheduledCount}/${queue.data.limit}).`,
        code: 'BUFFER_QUEUE_FULL',
        data: { queue: queue.data },
        attempts: [{
          endpoint: queue.endpoint || creds.baseUrl,
          ok: false,
          status: 409,
          message: 'Buffer queue full',
          payload: queue.data,
        }],
      };
    }
  }

  const variables = {
    input: {
      text,
      channelId,
      schedulingType: 'automatic',
      mode: 'addToQueue',
      ...(imageUrl ? { assets: [{ image: { url: imageUrl } }] } : {}),
    },
  };
  const query = `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess {
          post {
            id
            text
            dueAt
            status
            channelId
            assets {
              id
              mimeType
            }
          }
        }
        ... on MutationError {
          message
        }
      }
    }
  `;

  const result = await graphql(query, variables, creds);
  if (!result.ok) {
    return {
      ...result,
      attempts: [{
        endpoint: result.endpoint || creds.baseUrl,
        ok: false,
        status: result.status || 0,
        message: safeText(result.error),
        payload: result.data || null,
      }],
    };
  }

  const action = result.data?.createPost;
  const mutationMessage = safeText(action?.message);
  if (mutationMessage) {
    return {
      ok: false,
      endpoint: result.endpoint,
      status: 400,
      error: `Buffer API error: ${mutationMessage}`,
      data: result.data,
      attempts: [{
        endpoint: result.endpoint,
        ok: false,
        status: 400,
        message: mutationMessage,
        payload: result.data,
      }],
    };
  }

  const post = action?.post || null;
  if (!post?.id) {
    return {
      ok: false,
      endpoint: result.endpoint,
      status: 502,
      error: 'Buffer createPost response did not include a post id.',
      data: result.data,
    };
  }

  return {
    ok: true,
    endpoint: result.endpoint,
    status: result.status,
    data: {
      id: safeText(post.id),
      endpoint: result.endpoint,
      post,
      channelId,
      dueAt: safeText(post.dueAt),
      attempts: [{
        endpoint: result.endpoint,
        ok: true,
        status: result.status,
      }],
    },
  };
}

module.exports = {
  getBufferCredentials,
  isConfigured,
  graphql,
  listOrganizations,
  listChannels,
  checkAuth,
  getQueueStatus,
  createQueuedPost,
};
