'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectContentHtml,
  extractPost,
  parseHumanDate,
  buildCandidate,
} = require('../../lib/blogImportExtract');
const { titlesLookAlike } = require('../../lib/blogImportStore');

/**
 * The source rows are Site Import's scrape of a 2018 WordPress site poured
 * whole into text modules — site chrome, byline and analytics beacon
 * included (docs/BLOG_BULK_IMPORT_HANDOFF.md §4). Each extraction step has a
 * break test: a fixture LACKING the thing it looks for must produce a "not
 * found" flag, never a silent empty string or an Invalid Date — six real
 * posts have no date and six no author, and those flags are what lets the
 * operator trust the run.
 */

const CHROME =
  '<p class="site-title"><a href="/imported-home">Delray Beach Tennis Center</a></p>' +
  '<p class="site-description">Delray Beach, FL</p>' +
  '<a href="https://facebook.example"><img src="https://cdn.example/Site_Import/facebook_11.png" width="24" height="24"></a>';

const ARTICLE_HTML =
  CHROME +
  '<h1>Summer Tennis Camp Fun</h1>' +
  '<p class="entry-meta"><time datetime="2018-06-06">June 6, 2018</time>' +
  '<span class="entry-author-name">Jeff Bingo</span></p>' +
  '<p>The junior players had a wonderful week of drills, games and match play at the camp.</p>' +
  '<img src="https://cdn.example/Site_Import/camp-photo.jpg">' +
  '<img src="https://pixel.wp.com/g.gif?v=ext&blog=1">';

test('the whole scraped page reduces to the article', () => {
  const post = extractPost(ARTICLE_HTML);
  assert.equal(post.title, 'Summer Tennis Camp Fun');
  assert.equal(post.titleFound, true);
  // Everything before the <h1> is chrome and must be gone from the body.
  assert.ok(!post.body.includes('site-title'), 'body still carries the site title chrome');
  assert.ok(!post.body.includes('facebook_11'), 'body still carries the social icon strip');
  assert.ok(post.body.includes('wonderful week'), 'body lost the article itself');
  assert.equal(post.publishedAt, '2018-06-06T12:00:00.000Z');
  assert.equal(post.author, 'Jeff Bingo');
  assert.equal(post.featuredImageUrl, 'https://cdn.example/Site_Import/camp-photo.jpg');
  assert.ok(post.excerpt.startsWith('The junior players'), `excerpt was: ${post.excerpt}`);
});

test('the byline block and the beacon are stripped from the body', () => {
  const post = extractPost(ARTICLE_HTML);
  assert.ok(!post.body.includes('entry-author-name'), 'byline survived into the body');
  assert.ok(!post.body.includes('<time'), 'time element survived into the body');
  assert.ok(!post.body.includes('pixel.wp.com'), 'analytics beacon survived into the body');
});

// ── Break tests: each field's absence must be reported, not papered over ──

test('no <h1> in the source: titleFound is false, nothing invented', () => {
  const post = extractPost('<p>Some page with no headline at all, just a paragraph of text.</p>');
  assert.equal(post.titleFound, false);
  assert.equal(post.title, '');
});

test('no <time> in the source: dateFound false and publishedAt null', () => {
  const post = extractPost('<h1>Title</h1><p>Body text with no date anywhere in it at all.</p>');
  assert.equal(post.dateFound, false);
  assert.equal(post.publishedAt, null);
});

test('an unparseable date reports not-found rather than Invalid Date', () => {
  const post = extractPost('<h1>T</h1><time>sometime in the spring</time><p>Body.</p>');
  assert.equal(post.dateFound, false);
  assert.equal(post.publishedAt, null);
});

test('no author span: authorFound false, author empty', () => {
  const post = extractPost('<h1>T</h1><p>Body with nobody credited for writing it anywhere.</p>');
  assert.equal(post.authorFound, false);
  assert.equal(post.author, '');
});

test('the featured image is never the tracking pixel, an icon, or a hotlink', () => {
  const post = extractPost(
    '<h1>T</h1>' +
    '<img src="https://pixel.wp.com/g.gif?v=ext&blog=158783199">' +
    '<img src="https://cdn.example/Site_Import/icon.png" width="24" height="24">' +
    '<img src="https://elsewhere.example/big-external.jpg">' +
    '<p>Body text long enough to be a real paragraph for the excerpt to use here.</p>'
  );
  assert.equal(post.featuredImageUrl, '');
});

test('chrome images BEFORE the h1 are never the featured image', () => {
  const post = extractPost(
    '<img src="https://cdn.example/Site_Import/header-banner.jpg">' +
    '<h1>T</h1><p>Body text long enough to be a real paragraph for the excerpt.</p>'
  );
  assert.equal(post.featuredImageUrl, '');
});

test('no usable paragraph: excerpt is empty, not a fragment of chrome', () => {
  const post = extractPost('<h1>T</h1><p>short</p>');
  assert.equal(post.excerpt, '');
});


test('the 2018 footer and sidebar are cut off the end of the article', () => {
  const post = extractPost(
    '<h1>T</h1><p>The article itself, long enough to read as a real paragraph of content.</p>' +
    '<h2 class="genesis-sidebar-title screen-reader-text">Primary Sidebar</h2>' +
    'Copyright &copy; 2026 Delray Beach Tennis Center All Rights Reserved.Powered by'
  );
  assert.equal(post.trailingChromeRemoved, true);
  assert.ok(post.body.includes('The article itself'));
  assert.ok(!/Primary Sidebar/.test(post.body), 'the sidebar heading survived into the body');
  assert.ok(!/Copyright/.test(post.body), 'the site copyright line survived into the body');
});

test('an article with no trailing furniture is not truncated', () => {
  // The cut must not fire on its own: a body that simply ends is left whole,
  // and says so, or a missing marker would silently shorten every post.
  const post = extractPost('<h1>T</h1><p>An article that ends where it ends, with nothing after it at all.</p>');
  assert.equal(post.trailingChromeRemoved, false);
  assert.ok(post.body.includes('ends where it ends'));
});

// ── parseHumanDate ──

test('parseHumanDate handles the human formats the scrape uses', () => {
  assert.equal(parseHumanDate('June 6, 2018'), '2018-06-06T12:00:00.000Z');
  assert.equal(parseHumanDate('February 20, 2018'), '2018-02-20T12:00:00.000Z');
  assert.equal(parseHumanDate('2018-06-06'), '2018-06-06T12:00:00.000Z');
  assert.equal(parseHumanDate('2018-06-06T09:30:00Z'), '2018-06-06T09:30:00.000Z');
  assert.equal(parseHumanDate('Junuary 6, 2018'), null);
  assert.equal(parseHumanDate(''), null);
  assert.equal(parseHumanDate('yesterday'), null);
});

// ── The frame filter is structural, and the flags are what carry it ──

function pageWith(sections) {
  return { name: 'A Page', layoutSections: sections };
}

const HEADER_SECTION = {
  title: 'Header',
  canonical: true,
  savedSectionId: 'saved_section_123',
  modules: [{ type: 'text', text: '<p>SITE NAV CHROME</p>' }],
};

const CONTENT_SECTION = {
  title: 'Imported: A Post',
  modules: [{ type: 'text', text: '<h1>A Post</h1><p>The article body, comfortably longer than the excerpt minimum.</p>' }],
};

test('template chrome is excluded by canonical + savedSectionId, not by title', () => {
  const { html } = collectContentHtml(pageWith([HEADER_SECTION, CONTENT_SECTION]));
  assert.ok(!html.includes('SITE NAV CHROME'), 'frame section leaked into the content');
  assert.ok(html.includes('The article body'));
});

test('BREAK TEST: flip canonical off and the header lands in the body', () => {
  // This is the assertion doing its job (handoff §7): a section that is not
  // a live link to a saved section is content, whatever its title says.
  const broken = { ...HEADER_SECTION, canonical: false };
  const { html } = collectContentHtml(pageWith([broken, CONTENT_SECTION]));
  assert.ok(html.includes('SITE NAV CHROME'), 'the frame filter is keying on something other than the flags');
});

test('module leakage from the mid-redesign page never reaches the body', () => {
  const { html } = collectContentHtml(pageWith([{
    title: 'Imported: x',
    modules: [
      { type: 'blog-search', text: '<div>SEARCH WIDGET</div>' },
      { type: 'tractor-nav', text: '<div>NAV WIDGET</div>' },
      { type: 'text', text: '<p>Real content</p>' },
    ],
  }]));
  assert.ok(!html.includes('SEARCH WIDGET'));
  assert.ok(!html.includes('NAV WIDGET'));
  assert.ok(html.includes('Real content'));
});

// ── Candidate classification ──

test('an empty or near-empty page is probably not a post — but is still listed', () => {
  const candidate = buildCandidate({
    page_id: 9, slug: 'test',
    payload: JSON.stringify(pageWith([{ title: 'Imported: test', modules: [] }])),
  });
  assert.equal(candidate.looksLikePost, false);
  assert.equal(candidate.pageId, '9');
});

test('a page with a headline and a real body is probably a post', () => {
  const body = `<h1>Real Post</h1><p>${'word '.repeat(80)}</p>`;
  const candidate = buildCandidate({
    page_id: 10, slug: 'real-post',
    payload: JSON.stringify(pageWith([{ title: 'Imported: Real Post', modules: [{ type: 'text', text: body }] }])),
  });
  assert.equal(candidate.looksLikePost, true);
  assert.equal(candidate.title, 'Real Post');
});

test('a page with no headline falls back to the page name and says so', () => {
  const candidate = buildCandidate({
    page_id: 11, slug: 'no-headline',
    payload: JSON.stringify({ name: 'The Page Name', layoutSections: [{ title: 'Imported: x', modules: [{ type: 'text', text: '<p>Body only.</p>' }] }] }),
  });
  assert.equal(candidate.titleFound, false);
  assert.equal(candidate.title, 'The Page Name');
});

// ── Duplicate flagging: title matching is exactly how 86bbqwupk went wrong ──

test('titles one word apart still flag as lookalikes', () => {
  assert.equal(titlesLookAlike(
    'Davis Cup at Delray Beach Tennis Center',
    'Davis Cup at Delray Beach Tennis Center 2025'
  ), true);
  assert.equal(titlesLookAlike(
    'US Open snapshot: how the Americans are faring',
    'US Open snapshot — how the Americans are faring this week'
  ), true);
  assert.equal(titlesLookAlike('Adult Clinics', 'Directions & Hours'), false);
  assert.equal(titlesLookAlike('', 'Anything'), false);
});

// ── Tags ────────────────────────────────────────────────────────────────────
//
// WordPress files the post's tags in the entry footer. That block sits inside
// the article region (before the sidebar marker `cutTrailingChrome` cuts at)
// and inside the `entry-meta` wrapper `cleanBody` deletes — so tag extraction
// is a race against the body clean, and these tests are what pin the order.

const TAGGED_ARTICLE =
  CHROME +
  '<h1>Summer Tennis Camp Fun</h1>' +
  '<p>The junior players had a wonderful week of drills at the camp.</p>' +
  '<p class="entry-meta"><span class="entry-categories">Filed Under: ' +
  '<a href="/category-junior-tennis" rel="category tag">Junior Tennis</a></span> ' +
  '<span class="entry-tags">Tagged With: ' +
  '<a href="/tag-junior-tennis" rel="tag">junior tennis</a>, ' +
  '<a href="/tag-summer-camp" rel="tag">Summer Camp</a>, ' +
  '<a href="/tag-junior-tennis" rel="tag">Junior Tennis</a></span></p>' +
  '<h2 class="genesis-sidebar-title">Primary Sidebar</h2>' +
  '<a href="/tag-not-a-post-tag" rel="tag">sidebar cloud tag</a>';

test('the tags come off the entry footer, in source order, de-duplicated', () => {
  const post = extractPost(TAGGED_ARTICLE);
  assert.deepEqual(post.tags, ['junior tennis', 'Summer Camp']);
  assert.equal(post.tagsFound, true);
});

test('a category is not a tag', () => {
  // WordPress marks category links rel="category tag". Matching rel loosely
  // would file every category into the tags column.
  const post = extractPost(TAGGED_ARTICLE);
  assert.ok(!post.tags.includes('Junior Tennis'), 'the category was filed as a tag');
});

test('a tag cloud below the article is not this post\'s tags', () => {
  // The cloud sits after the sidebar marker, so the trailing cut removes it
  // before the tags are read. Reading tags from the untrimmed HTML would file
  // the whole site's tag list onto one post.
  const post = extractPost(TAGGED_ARTICLE);
  assert.ok(!post.tags.includes('sidebar cloud tag'), 'a sidebar tag cloud leaked into the post tags');
});

test('the tag markup does not survive into the body', () => {
  const post = extractPost(TAGGED_ARTICLE);
  assert.ok(!post.body.includes('rel="tag"'), 'tag links survived into the body');
  assert.ok(!post.body.includes('Tagged With'), 'the "Tagged With" label survived into the body');
  assert.ok(!post.body.includes('Filed Under'), 'the "Filed Under" label survived into the body');
  assert.ok(post.body.includes('wonderful week'), 'the article itself was cut away');
});

test('a post with no tags says so rather than looking the same as a failure', () => {
  const post = extractPost(ARTICLE_HTML);
  assert.deepEqual(post.tags, []);
  assert.equal(post.tagsFound, false);
});

test('tags are found when the links carry rel="noopener" instead of rel="tag"', () => {
  // One real post in the Delray scrape is shaped this way: the only thing
  // marking the links as tags is the "Tagged With:" label and the /tag- href.
  // A rel-only matcher reports it as untagged, which is visibly wrong in the
  // picker — the tags are right there in the source.
  const html =
    CHROME +
    '<h1>Picklers Unite On July 4th</h1>' +
    '<p>A full house for the holiday social.</p>' +
    '<p>Filed Under: <a rel="noopener noreferrer" href="/category-pickleball">Pickleball</a> ' +
    'Tagged With: <a rel="noopener noreferrer" href="/tag-delray-beach">Delray Beach</a>, ' +
    '<a rel="noopener noreferrer" href="/tag-pickle-ball">pickle ball</a></p>';
  const post = extractPost(html);
  assert.deepEqual(post.tags, ['Delray Beach', 'pickle ball']);
  assert.equal(post.tagsFound, true);
  // And that unclassed meta paragraph must not be left sitting in the article.
  assert.ok(!post.body.includes('Tagged With'), 'the bare meta paragraph survived into the body');
  assert.ok(!post.body.includes('Filed Under'), 'the bare meta paragraph survived into the body');
});

test('the category link in the fallback route is not filed as a tag', () => {
  const html =
    '<h1>Picklers Unite</h1><p>Body.</p>' +
    '<p>Filed Under: <a rel="noopener noreferrer" href="/category-pickleball">Pickleball</a> ' +
    'Tagged With: <a rel="noopener noreferrer" href="/tag-pickle-ball">pickle ball</a></p>';
  const post = extractPost(html);
  assert.deepEqual(post.tags, ['pickle ball']);
});

test('a candidate carries its tags through to the import', () => {
  const candidate = buildCandidate({
    page_id: 77,
    slug: 'summer-tennis-camp-fun',
    payload: JSON.stringify({
      name: 'Summer Tennis Camp Fun',
      layoutSections: [{ title: 'Imported', modules: [{ type: 'text', text: TAGGED_ARTICLE }] }],
    }),
  });
  assert.deepEqual(candidate.tags, ['junior tennis', 'Summer Camp']);
  assert.equal(candidate.tagsFound, true);
});
