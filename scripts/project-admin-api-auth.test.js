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
