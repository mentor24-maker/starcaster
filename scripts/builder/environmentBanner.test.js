'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { classify, bannerHtml, injectBanner } = require('../../lib/environmentBanner');

test('localhost and 127.0.0.1 are local', () => {
  assert.equal(classify('http://localhost:54421'), 'local');
  assert.equal(classify('http://127.0.0.1:54421'), 'local');
});

test('a real Supabase host is production', () => {
  assert.equal(classify('https://fyyovjhydjxvkbzzvmqq.supabase.co'), 'production');
});

test('missing or unparseable is unknown, never local', () => {
  // The dangerous default. "I could not tell" must never read as "safe".
  for (const value of ['', '   ', null, undefined, 'not a url', 'localhost:54421']) {
    assert.equal(classify(value), 'unknown', `${JSON.stringify(value)} should be unknown`);
  }
});

test('a host merely CONTAINING localhost is not local', () => {
  // localhost.evil.com and prod-localhost.supabase.co both used to pass a
  // naive substring check. Nothing about them is local.
  assert.equal(classify('https://localhost.evil.com'), 'production');
  assert.equal(classify('https://prod-localhost.supabase.co'), 'production');
  assert.equal(classify('https://127.0.0.1.evil.com'), 'production');
});

test('the production banner says what is at stake, not just where you are', () => {
  const html = bannerHtml('https://fyyovjhydjxvkbzzvmqq.supabase.co');
  assert.match(html, /Production/i);
  assert.match(html, /live tenant data/i);
});

test('the banner carries its own styling', () => {
  // styles.css is a build artifact and can be stale or missing in a fresh
  // worktree. A warning that loses its colour still has to read as a warning.
  assert.match(bannerHtml('http://localhost:1'), /style="[^"]*background:/);
});

test('it goes immediately after <body>, whatever attributes body carries', () => {
  const out = injectBanner('<html><body class="x" data-y="z"><main></main></body></html>', 'http://localhost:1');
  assert.match(out, /<body class="x" data-y="z"><div data-starcaster-env-banner/);
});

test('a document with no <body> is returned untouched', () => {
  // Guessing where to put things in a document you do not recognise is how
  // you corrupt a page.
  const input = '<h1>fragment</h1>';
  assert.equal(injectBanner(input, 'http://localhost:1'), input);
});

test('exactly one banner is injected', () => {
  const out = injectBanner('<body><p>a</p></body>', 'http://localhost:1');
  assert.equal(out.split('data-starcaster-env-banner').length - 1, 1);
});
