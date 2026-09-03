'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  acceptsProjectAdminSession,
  isPublicTenantContentReadRoute,
} = require('../../lib/projectAdminApiAuth');

/**
 * Ticket 86bbu4qh5 - the admin-blog-links module.
 *
 * Two different callers reach this feature and they must NOT get the same
 * access:
 *
 *   - a tenant ADMIN, signed in on their own site, using the manager page to
 *     tidy tags and press "Relate Checked";
 *   - a VISITOR with no login at all, on a published page carrying the
 *     blog-related-posts module, whose browser has to read back the relations
 *     for the one post being viewed.
 *
 * The visitor opening is the one worth a test. Without it the Relate Checked
 * button writes rows that nothing on a live site can ever read - a save that
 * succeeds and changes nothing visible, which is the failure this whole
 * ticket exists to avoid. With it too wide, an unauthenticated caller can
 * enumerate the entire relation graph of a tenant.
 */

const asVisitor = (pathname, query = '', method = 'GET') =>
  isPublicTenantContentReadRoute(pathname, method, { url: `${pathname}${query}` });

const asTenantAdmin = (pathname, method = 'GET') =>
  acceptsProjectAdminSession(pathname, { method, req: { url: pathname } });

// ── The visitor: one post's related list, and nothing else ────────────────

test('a visitor may read the related list for ONE post', () => {
  assert.equal(
    asVisitor('/api/blog/relations', '?postId=post_123'),
    true,
    'the blog-related-posts module on a published page runs with no session'
  );
});

test('a visitor may NOT enumerate every relation in the project', () => {
  assert.equal(
    asVisitor('/api/blog/relations', ''),
    false,
    'leaving the filter off must not hand out the whole graph'
  );
  assert.equal(
    asVisitor('/api/blog/relations', '?postId='),
    false,
    'a blank postId is the unfiltered list wearing a filter'
  );
});

test('a visitor may not WRITE relations, only read them', () => {
  for (const method of ['POST', 'DELETE', 'PUT', 'PATCH']) {
    assert.equal(
      asVisitor('/api/blog/relations', '?postId=post_123', method),
      false,
      `${method} on relations must require a session`
    );
  }
});

test('a visitor may not reach the tag manager at all', () => {
  // Tags are an editing surface. Nothing on a public page reads this list -
  // a published post carries its own tags in its own record.
  assert.equal(asVisitor('/api/blog/tags', ''), false);
  assert.equal(asVisitor('/api/blog/tags/posts', '?tag=immigration'), false);
  assert.equal(asVisitor('/api/blog/tags/rename', '', 'POST'), false);
});

// ── The tenant admin: the whole manager ───────────────────────────────────

test('a tenant admin can reach every endpoint the blog links manager runs on', () => {
  const allowed = [
    ['/api/blog/tags', 'GET'],
    ['/api/blog/tags', 'DELETE'],
    ['/api/blog/tags/posts', 'GET'],
    ['/api/blog/tags/rename', 'POST'],
    ['/api/blog/relations', 'POST'],
    ['/api/blog/relations', 'DELETE'],
    ['/api/blog/categories', 'POST'],
  ];
  for (const [pathname, method] of allowed) {
    assert.equal(
      asTenantAdmin(pathname, method),
      true,
      `${method} ${pathname} is part of the manager and must be reachable`
    );
  }
});

test('the unfiltered relation list stays behind a session for the admin too', () => {
  // acceptsProjectAdminSession returns false for anything already public, so
  // this asserts the admin path is the one carrying the unfiltered read - it
  // is not public, therefore the admin session is what opens it.
  assert.equal(
    asTenantAdmin('/api/blog/relations', 'GET'),
    true,
    'a signed-in tenant admin reads the whole graph to build the manager view'
  );
});
