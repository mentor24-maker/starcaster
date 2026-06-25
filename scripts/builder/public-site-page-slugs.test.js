'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isPrivateSiteSlug,
  isPublicSiteSlug,
  filterPublicSitePages,
  filterPrivateSitePages,
} = require('../../lib/builder-client/public-site-page-slugs');

describe('public-site-page-slugs', () => {
  it('treats admin-* slugs as private except admin-login', () => {
    assert.equal(isPrivateSiteSlug('admin-dashboard'), true);
    assert.equal(isPrivateSiteSlug('admin-login'), false);
    assert.equal(isPrivateSiteSlug('admin'), true);
  });

  it('treats editor and CRM slugs as private', () => {
    assert.equal(isPrivateSiteSlug('blog-create-post'), true);
    assert.equal(isPrivateSiteSlug('blog-post-edit'), true);
    assert.equal(isPrivateSiteSlug('blog-post-manager'), true);
    assert.equal(isPrivateSiteSlug('blog-category-manager'), true);
    assert.equal(isPrivateSiteSlug('crm'), true);
  });

  it('treats home and marketing slugs as public', () => {
    assert.equal(isPrivateSiteSlug(''), false);
    assert.equal(isPrivateSiteSlug('home'), false);
    assert.equal(isPrivateSiteSlug('about'), false);
    assert.equal(isPublicSiteSlug('about'), true);
  });

  it('splits page lists for public vs private APIs', () => {
    const pages = [
      { slug: 'about' },
      { slug: 'blog-create-post' },
      { slug: 'admin-dashboard' },
      { slug: 'admin-login' },
    ];
    assert.deepEqual(
      filterPublicSitePages(pages).map((p) => p.slug),
      ['about', 'admin-login']
    );
    assert.deepEqual(
      filterPrivateSitePages(pages).map((p) => p.slug),
      ['blog-create-post', 'admin-dashboard']
    );
  });
});
