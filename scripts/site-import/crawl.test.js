'use strict';

/**
 * Crawl planning unit tests — all offline (fetchText is injected). Covers
 * URL normalization/dedupe, same-registrable-domain scoping, robots.txt
 * verdicts (including the "name the blocking rule" requirement of ratified
 * decision 4), sitemap + sitemap-index discovery, link extraction, and the
 * BFS queue's caps.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeCrawlUrl,
  registrableDomain,
  sameSite,
  looksLikeHtmlUrl,
  parseRobots,
  robotsVerdict,
  fetchSitemapUrls,
  extractLinks,
  CrawlQueue,
} = require('../../lib/site-import/dist/crawl.js');

test('normalizeCrawlUrl: fragments, tracking params, slashes, case', () => {
  assert.equal(
    normalizeCrawlUrl('HTTPS://Example.com/About/?utm_source=x&fbclid=y#team'),
    'https://example.com/About'
  );
  assert.equal(
    normalizeCrawlUrl('https://example.com/page?id=3&utm_campaign=z'),
    'https://example.com/page?id=3'
  );
  assert.equal(normalizeCrawlUrl('https://example.com/'), 'https://example.com/');
  assert.equal(normalizeCrawlUrl('/contact', 'https://example.com/about'), 'https://example.com/contact');
  assert.equal(normalizeCrawlUrl('mailto:x@y.com'), null);
  assert.equal(normalizeCrawlUrl('javascript:void(0)'), null);
  assert.equal(normalizeCrawlUrl('not a url'), null);
});

test('registrable domain + sameSite: www, subdomains, co.uk', () => {
  assert.equal(registrableDomain('www.example.com'), 'example.com');
  assert.equal(registrableDomain('blog.shop.example.co.uk'), 'example.co.uk');
  assert.ok(sameSite('https://www.example.com/', 'https://blog.example.com/x'));
  assert.ok(!sameSite('https://example.com/', 'https://other.com/'));
});

test('looksLikeHtmlUrl filters asset extensions', () => {
  assert.ok(looksLikeHtmlUrl('https://x.com/about'));
  assert.ok(looksLikeHtmlUrl('https://x.com/page.html'));
  assert.ok(!looksLikeHtmlUrl('https://x.com/logo.png'));
  assert.ok(!looksLikeHtmlUrl('https://x.com/menu.pdf'));
});

test('robots: honored verdicts name the blocking rule', () => {
  const robots = parseRobots([
    'User-agent: *',
    'Disallow: /private/',
    'Allow: /private/press',
    '',
    'User-agent: badbot',
    'Disallow: /',
    '',
    'Sitemap: https://example.com/sitemap.xml',
  ].join('\n'));

  const ua = 'StarCaster-SiteImport/1.0 (+https://starcaster.pro)';
  assert.deepEqual(robotsVerdict(robots, ua, '/about'), { allowed: true, rule: null });
  // Blocked — and the rule is named, for the job's error message.
  assert.deepEqual(robotsVerdict(robots, ua, '/private/financials'), {
    allowed: false,
    rule: 'Disallow: /private/',
  });
  // Longest match wins: the more specific Allow overrides.
  assert.equal(robotsVerdict(robots, ua, '/private/press-kit').allowed, true);
  // Our token gets the * group, not badbot's.
  assert.equal(robotsVerdict(robots, ua, '/anything').allowed, true);
  assert.deepEqual(robots.sitemaps, ['https://example.com/sitemap.xml']);
});

test('robots: specific agent group, wildcards and anchors in paths', () => {
  const robots = parseRobots([
    'User-agent: starcaster-siteimport',
    'Disallow: /*.json$',
    'Disallow: /tmp*',
  ].join('\n'));
  const ua = 'StarCaster-SiteImport/1.0';
  assert.equal(robotsVerdict(robots, ua, '/data/feed.json').allowed, false);
  assert.equal(robotsVerdict(robots, ua, '/data/feed.jsonl').allowed, true);
  assert.equal(robotsVerdict(robots, ua, '/tmp/scratch').allowed, false);
  // No * group and no match for other agents → allowed.
  assert.equal(robotsVerdict(robots, 'SomeOtherBot', '/tmp/scratch').allowed, true);
});

test('empty or missing robots allows everything', () => {
  assert.equal(robotsVerdict(parseRobots(''), 'x', '/a').allowed, true);
});

test('sitemap: plain sitemap wins, index recursed across ALL subs, off-site dropped', async () => {
  const files = {
    'https://example.com/sitemap.xml': `
      <sitemapindex>
        <sitemap><loc>https://example.com/post-sitemap.xml</loc></sitemap>
        <sitemap><loc>https://example.com/page-sitemap.xml</loc></sitemap>
      </sitemapindex>`,
    'https://example.com/post-sitemap.xml': `
      <urlset>
        <url><loc>https://example.com/post-1</loc></url>
        <url><loc>https://evil.com/off-site</loc></url>
      </urlset>`,
    'https://example.com/page-sitemap.xml': `
      <urlset><url><loc>https://example.com/about</loc></url></urlset>`,
  };
  const fetchText = async (url) => {
    if (!files[url]) throw new Error('404');
    return files[url];
  };
  const urls = await fetchSitemapUrls(fetchText, 'https://example.com/', { limit: 50 });
  // Both sub-sitemaps contributed (directAcquire stops at the first —
  // this is the documented deviation), off-site loc filtered out.
  assert.deepEqual(urls, ['https://example.com/post-1', 'https://example.com/about']);
});

test('sitemap: robots-declared location is tried first; failures fall through', async () => {
  const calls = [];
  const fetchText = async (url) => {
    calls.push(url);
    if (url === 'https://example.com/custom-map.xml') {
      return '<urlset><url><loc>https://example.com/only</loc></url></urlset>';
    }
    throw new Error('404');
  };
  const urls = await fetchSitemapUrls(fetchText, 'https://example.com/', {
    limit: 10,
    robotsSitemaps: ['https://example.com/custom-map.xml'],
  });
  assert.deepEqual(urls, ['https://example.com/only']);
  assert.equal(calls[0], 'https://example.com/custom-map.xml');
});

test('extractLinks resolves and normalizes; garbage yields none', () => {
  const html = `<body>
    <a href='/about#team'>About</a>
    <a href='https://example.com/contact/?utm_source=nav'>Contact</a>
    <a href='mailto:hi@example.com'>Mail</a>
    <a href='https://other.com/x'>Elsewhere</a>
  </body>`;
  assert.deepEqual(extractLinks(html, 'https://example.com/'), [
    'https://example.com/about',
    'https://example.com/contact',
    'https://other.com/x', // scoping is the queue's job, not the extractor's
  ]);
  assert.deepEqual(extractLinks(null, 'https://example.com/'), []);
});

test('CrawlQueue: BFS order, dedupe, scoping, depth and page caps', () => {
  const q = new CrawlQueue({ seedUrl: 'https://example.com/', maxPages: 3, maxDepth: 2 });

  assert.deepEqual(q.next(), { url: 'https://example.com/', depth: 0 });
  q.add('https://example.com/a', 1);
  q.add('https://example.com/a#dup', 1); // same after normalization
  q.add('https://example.com/b', 1);
  q.add('https://other.com/off-site', 1);
  q.add('https://example.com/logo.png', 1);
  q.add('https://example.com/too-deep', 3);
  assert.equal(q.hitDepthCap, true);

  assert.deepEqual(q.next(), { url: 'https://example.com/a', depth: 1 });
  assert.deepEqual(q.next(), { url: 'https://example.com/b', depth: 1 });
  // Page cap (3) reached with work still queued → capped, and recorded.
  q.add('https://example.com/c', 2);
  assert.equal(q.next(), null);
  assert.equal(q.hitPageCap, true);
  assert.equal(q.captured, 3);
});
