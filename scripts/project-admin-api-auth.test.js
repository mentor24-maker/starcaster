'use strict';

const assert = require('assert');
const {
  acceptsProjectAdminSession,
  isPublicCrmRoute,
  isPublicTenantContentReadRoute,
} = require('../lib/projectAdminApiAuth');

const publishedPostsReq = { url: 'https://benvin.org/api/blog/posts?status=published' };
const allPostsReq = { url: 'https://benvin.org/api/blog/posts?limit=50' };
const slugPostReq = { url: 'https://benvin.org/api/blog/posts/my-slug?by=slug' };

assert.equal(isPublicCrmRoute('/api/crm/contact-submit', 'POST'), true);
assert.equal(isPublicCrmRoute('/api/crm/forms/form-1', 'GET'), true);
assert.equal(isPublicCrmRoute('/api/crm/contacts', 'GET'), false);

assert.equal(isPublicTenantContentReadRoute('/api/blog/posts', 'GET', publishedPostsReq), true);
assert.equal(isPublicTenantContentReadRoute('/api/blog/posts', 'GET', allPostsReq), false);
assert.equal(isPublicTenantContentReadRoute('/api/blog/posts', 'POST', publishedPostsReq), false);
assert.equal(isPublicTenantContentReadRoute('/api/blog/posts/my-slug', 'GET', slugPostReq), true);
// Events — the public calendar's read path (Event Calendar 2/3).
const publishedEventsReq = { url: 'https://benvin.org/api/events?status=published' };
const allEventsReq = { url: 'https://benvin.org/api/events?limit=200' };
const draftEventsReq = { url: 'https://benvin.org/api/events?status=draft' };
const slugEventReq = { url: 'https://benvin.org/api/events/summer-gala?by=slug' };
const idEventReq = { url: 'https://benvin.org/api/events/evt_123' };

assert.equal(isPublicTenantContentReadRoute('/api/events', 'GET', publishedEventsReq), true);
// The unfiltered list is the ADMIN manager's call and must never be public —
// without this a visitor could read every draft by leaving the filter off.
assert.equal(isPublicTenantContentReadRoute('/api/events', 'GET', allEventsReq), false);
assert.equal(isPublicTenantContentReadRoute('/api/events', 'GET', draftEventsReq), false);
assert.equal(isPublicTenantContentReadRoute('/api/events', 'POST', publishedEventsReq), false);
assert.equal(isPublicTenantContentReadRoute('/api/events', 'DELETE', publishedEventsReq), false);
assert.equal(isPublicTenantContentReadRoute('/api/events/summer-gala', 'GET', slugEventReq), true);
// By id is the admin path; only a slug read is public.
assert.equal(isPublicTenantContentReadRoute('/api/events/evt_123', 'GET', idEventReq), false);
// A tenant admin still reaches the unfiltered list with their own session.
assert.equal(
  acceptsProjectAdminSession('/api/events', { isPublicCrmRoute: false, method: 'GET', req: allEventsReq }),
  true
);
assert.equal(
  acceptsProjectAdminSession('/api/events', { isPublicCrmRoute: false, method: 'POST' }),
  true
);

assert.equal(isPublicTenantContentReadRoute('/api/builder/themes', 'GET', {}), true);
assert.equal(isPublicTenantContentReadRoute('/api/community-assets', 'GET', {}), true);

assert.equal(
  acceptsProjectAdminSession('/api/blog/posts', { isPublicCrmRoute: false, method: 'POST' }),
  true
);
assert.equal(
  acceptsProjectAdminSession('/api/blog/posts', { isPublicCrmRoute: false, method: 'GET', req: allPostsReq }),
  true
);
assert.equal(
  acceptsProjectAdminSession('/api/crm/contacts', { isPublicCrmRoute: false, method: 'GET' }),
  true
);
assert.equal(
  acceptsProjectAdminSession('/api/assets/import-image', { isPublicCrmRoute: false, method: 'POST' }),
  true
);
assert.equal(
  acceptsProjectAdminSession('/api/messaging/tags', { isPublicCrmRoute: false, method: 'GET' }),
  false
);
assert.equal(
  acceptsProjectAdminSession('/api/messaging/tags', { isPublicCrmRoute: false, method: 'POST' }),
  true
);
assert.equal(
  acceptsProjectAdminSession('/api/crm/contact-submit', { isPublicCrmRoute: true, method: 'POST' }),
  false
);
assert.equal(
  acceptsProjectAdminSession('/api/auth/login', { isPublicCrmRoute: false, method: 'POST' }),
  false
);
assert.equal(
  acceptsProjectAdminSession('/api/projects/current', { isPublicCrmRoute: false, method: 'GET' }),
  false
);

console.log('project-admin-api-auth.test.js: ok');
