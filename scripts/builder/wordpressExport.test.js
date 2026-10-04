'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildWordPressExport,
  diviColumnTypes,
  splitFrame,
  escAttr,
  escContent,
} = require('../../lib/wordpressExport.js');
const { siteUrlFor } = require('../../routes/siteExport.js');

function mod(type, extra = {}) {
  return { id: `m-${type}-${Math.random().toString(36).slice(2, 7)}`, type, column: 'main', name: '', text: '', settings: {}, ...extra };
}

function section(modules, extra = {}) {
  return { id: `s-${Math.random().toString(36).slice(2, 7)}`, title: 'Section', layout: 'single', widthMode: 'contained', background: { mode: 'none' }, modules, ...extra };
}

const header = section([mod('navigation', { settings: { navItems: JSON.stringify([
  { id: 'n1', label: 'Home', href: '/' },
  { id: 'n2', label: 'About', href: '/about' },
  { id: 'n3', label: 'Team', href: '/about-team', parentId: 'n2' },
]) } })], { title: 'Header', canonical: true, savedSectionId: 'ss-head' });
const footer = section([mod('text', { text: '<p>© Club</p>' })], { title: 'Footer', canonical: true, savedSectionId: 'ss-foot' });

function sitePages() {
  return [
    {
      id: '1', name: 'Home', slug: '', isPublished: true, createdAt: '2026-01-01T00:00:00Z',
      layoutSections: [
        header,
        section([
          mod('heading', { text: 'Welcome', settings: { level: 'h1' } }),
          mod('image', { settings: { url: '/images/court.jpg', alt: 'Court "A"' } }),
          mod('button', { text: 'Book [now]', settings: { href: '/book' } }),
          mod('galaxy', { name: 'Spiral' }),
        ]),
        footer,
      ],
    },
    {
      id: '2', name: 'About', slug: 'about', isPublished: false, createdAt: '2026-01-02T00:00:00Z',
      layoutSections: [
        header,
        section([
          mod('text', { column: 'left', text: '<p>Left <img src="https://cdn.example.com/a.png"></p>' }),
          mod('text', { column: 'right', text: '<p>Right</p>' }),
        ], { layout: 'two-four' }),
        footer,
      ],
    },
    { id: '3', name: 'Admin', slug: 'admin-dashboard', layoutSections: [section([mod('admin-login')])] },
  ];
}

function run(extra = {}) {
  return buildWordPressExport({
    project: { name: 'Delray & Co', siteUrl: 'https://club.example.com' },
    assetOrigin: 'https://app.example.com',
    pages: sitePages(),
    posts: [{ id: 'p1', title: 'News', slug: 'news', status: 'published', body: '<p>Hi <img src="/images/n.png"></p>', tags: ['Junior Tennis'], featuredImageUrl: 'https://cdn.example.com/f.jpg', publishedAt: '2026-02-01T00:00:00Z' }],
    now: '2026-10-04T00:00:00Z',
    ...extra,
  });
}

test('every StarCaster layout maps to Divi column widths that add up to a full row', () => {
  assert.deepEqual(diviColumnTypes('single'), ['4_4']);
  assert.deepEqual(diviColumnTypes('two-four'), ['1_3', '2_3']);
  assert.deepEqual(diviColumnTypes('one-five'), ['1_6', '5_6']);
  assert.deepEqual(diviColumnTypes('one-two-one'), ['1_4', '1_2', '1_4']);
  assert.deepEqual(diviColumnTypes('three-one-one'), ['3_5', '1_5', '1_5']);
  assert.deepEqual(diviColumnTypes('six-column'), Array(6).fill('1_6'));
  assert.deepEqual(diviColumnTypes('nonsense'), ['4_4']);
});

test('shortcode attributes and content cannot break out of their shortcode', () => {
  assert.equal(escAttr('a "b" [c]'), 'a %22b%22 %91c%93');
  assert.equal(escContent('<p>[gallery]</p>'), '<p>&#91;gallery&#93;</p>');
});

test('header and footer come from the linked sections around the page body', () => {
  const frame = splitFrame(sitePages());
  assert.deepEqual(frame.header.map((s) => s.title), ['Header']);
  assert.deepEqual(frame.footer.map((s) => s.title), ['Footer']);
});

test('pages export as Divi pages without the header/footer, which go to the Theme Builder', () => {
  const { xml, report } = run();
  assert.equal(report.pages.length, 2);
  assert.deepEqual(report.pages.map((p) => [p.slug, p.status]), [['home', 'publish'], ['about', 'draft']]);
  assert.equal(report.homePageSlug, 'home');
  assert.deepEqual(report.pagesLeftOut, [{ name: 'Admin', slug: 'admin-dashboard', reason: 'admin page' }]);

  // The header's menu module is in the header layout, not in every page.
  const pageBlocks = xml.split('<item>').filter((b) => b.includes('<wp:post_type><![CDATA[page]]>'));
  assert.equal(pageBlocks.length, 2);
  for (const block of pageBlocks) {
    assert.ok(!block.includes('et_pb_menu'), 'page carries the header menu');
    assert.ok(block.includes('<wp:meta_key><![CDATA[_et_pb_use_builder]]></wp:meta_key>'));
  }
  assert.match(xml, /<wp:post_type><!\[CDATA\[et_header_layout\]\]><\/wp:post_type>/);
  assert.match(xml, /<wp:post_type><!\[CDATA\[et_footer_layout\]\]><\/wp:post_type>/);
  assert.match(xml, /_et_header_layout_id\]\]><\/wp:meta_key>\s*<wp:meta_value><!\[CDATA\[900003\]\]>/);
  assert.match(xml, /_et_template\]\]><\/wp:meta_key>\s*<wp:meta_value><!\[CDATA\[900002\]\]>/);
  assert.equal(report.header.modules, 1);
  assert.equal(report.footer.modules, 1);
});

test('modules become the matching Divi modules, columns keep their widths', () => {
  const { xml } = run();
  assert.match(xml, /\[et_pb_text[^\]]*\]<h1>Welcome<\/h1>\[\/et_pb_text\]/);
  assert.match(xml, /\[et_pb_image[^\]]* src="https:\/\/app\.example\.com\/images\/court\.jpg" alt="Court %22A%22"/);
  assert.match(xml, /\[et_pb_button[^\]]* button_text="Book %91now%93" button_url="\/book"/);
  assert.match(xml, /column_structure="1_3,2_3"/);
  assert.match(xml, /\[et_pb_column[^\]]* type="1_3"\][^]*Left[^]*\[et_pb_column[^\]]* type="2_3"\][^]*Right/);
});

test('nothing is dropped silently: a module with no Divi equivalent is named in the report', () => {
  const { xml, report } = run();
  assert.ok(!xml.includes('Spiral'));
  assert.deepEqual(report.notExported, [
    { where: 'Home', module: 'Spiral', type: 'galaxy', reason: 'animated effect with no Divi equivalent' },
  ]);
});

test('every referenced image becomes an attachment, relative paths made absolute', () => {
  const { xml, report } = run();
  const urls = [...xml.matchAll(/<wp:attachment_url><!\[CDATA\[(.*?)\]\]><\/wp:attachment_url>/g)].map((m) => m[1]);
  assert.deepEqual(urls.sort(), [
    'https://app.example.com/images/court.jpg',
    'https://app.example.com/images/n.png',
    'https://cdn.example.com/a.png',
    'https://cdn.example.com/f.jpg',
  ]);
  assert.equal(report.images, 4);
  // The post's featured image points at its attachment.
  const featuredId = xml.match(/<wp:post_id>(\d+)<\/wp:post_id>(?:(?!<\/item>)[^])*cdn\.example\.com\/f\.jpg/)[1];
  assert.match(xml, new RegExp(`_thumbnail_id\\]\\]></wp:meta_key>\\s*<wp:meta_value><!\\[CDATA\\[${featuredId}\\]\\]>`));
});

test('blog posts, tags and the menu are exported, menu children after their parents', () => {
  const { xml, report } = run();
  assert.equal(report.posts.exported, 1);
  assert.match(xml, /<category domain="post_tag" nicename="junior-tennis"><!\[CDATA\[Junior Tennis\]\]><\/category>/);
  assert.equal(report.menu.items, 3);
  const menu = xml.split('<item>').filter((b) => b.includes('nav_menu_item'));
  assert.deepEqual(menu.map((b) => b.match(/<title>(.*?)<\/title>/)[1]), ['Home', 'About', 'Team']);
  const aboutId = menu[1].match(/<wp:post_id>(\d+)/)[1];
  assert.match(menu[2], new RegExp(`_menu_item_menu_item_parent\\]\\]></wp:meta_key>\\s*<wp:meta_value><!\\[CDATA\\[${aboutId}\\]\\]>`));
});

test('the file is well-formed XML: names escaped, CDATA terminators split, control characters dropped', () => {
  const { xml } = run({
    posts: [{ id: 'p', title: 'A <b> & c', status: 'draft', body: 'ends ]]> here \u0001' }],
  });
  assert.match(xml, /<title>Delray &amp; Co<\/title>/);
  assert.match(xml, /<title>A &lt;b&gt; &amp; c<\/title>/);
  assert.ok(xml.includes('ends ]]]]><![CDATA[> here'));
  assert.ok(!xml.includes('\u0001'));
});

test('social links are recognised by address when the label is a handle', () => {
  const { xml, report } = buildWordPressExport({
    pages: [{ id: '1', name: 'Home', slug: '', layoutSections: [section([mod('social', { settings: { socialItems: JSON.stringify([
      { label: 'DelrayTennis', href: 'https://www.facebook.com/DelrayTennis' },
      { label: 'Mastodon', href: 'https://mastodon.social/@x' },
    ]) } })])] }],
  });
  assert.match(xml, /social_network="facebook" url="https:\/\/www\.facebook\.com\/DelrayTennis"/);
  assert.equal(report.notExported.length, 1);
  assert.match(report.notExported[0].reason, /Mastodon/);
});

test('the site address prefers the custom domain', () => {
  assert.equal(siteUrlFor({ domain: 'delraytennis.com' }, 'https://app.x'), 'https://delraytennis.com');
  assert.equal(siteUrlFor({ siteUrl: 'https://a.b/' }, 'https://app.x'), 'https://a.b');
  assert.equal(siteUrlFor({}, 'https://app.x'), 'https://app.x');
});
