'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolvePagesFrameSections } = require('../../lib/publicPageFrameResolve');

/**
 * Serving the public site's frame from the live master.
 *
 * The failure this prevents already happened twice. propagateCanonicalSection
 * rewrites every page's stored copy of a canonical section, and on 2026-07-22
 * the serverless function froze part-way through: 30 pages updated, 20 stale,
 * a different split each save. It reached the operator as "the footer won't
 * save". Resolving on the way out means a half-finished propagation cannot
 * reach a visitor at all.
 *
 * The other property, equally important: this must never make a page WORSE.
 * A missing master, an empty saved-sections table, junk input — all degrade to
 * exactly today's behaviour, never to a page with no header.
 */

const master = (id, text) => ({
  id,
  name: `Master ${id}`,
  section: {
    id: `m-${id}`,
    title: `Master ${id}`,
    modules: [{ id: `mod-${id}`, type: 'text', text, settings: {} }]
  }
});

const canonicalInstance = (instanceId, savedSectionId, staleText) => ({
  id: instanceId,
  title: 'Header',
  canonical: true,
  savedSectionId,
  modules: [{ id: `mod-${savedSectionId}`, type: 'text', text: staleText, settings: {} }]
});

const bodySection = (id, text) => ({
  id,
  title: 'Body',
  modules: [{ id: `b-${id}`, type: 'text', text }]
});

const textOf = (section) => section.modules[0].text;

test('a stale stored copy is replaced by what the master says now', () => {
  const pages = [
    { id: '1', layoutSections: [canonicalInstance('i1', 'ss1', 'STALE'), bodySection('b', 'body')] }
  ];
  const { pages: out, resolved } = resolvePagesFrameSections(pages, [master('ss1', 'LIVE')]);
  assert.equal(textOf(out[0].layoutSections[0]), 'LIVE');
  assert.equal(resolved, 1);
});

test('the page body is never touched', () => {
  const pages = [
    { id: '1', layoutSections: [canonicalInstance('i1', 'ss1', 'STALE'), bodySection('b', 'MY WORK')] }
  ];
  const { pages: out } = resolvePagesFrameSections(pages, [master('ss1', 'LIVE')]);
  assert.equal(out[0].layoutSections.length, 2);
  assert.equal(textOf(out[0].layoutSections[1]), 'MY WORK');
});

test('the instance keeps its own section id, so per-page styling and anchors survive', () => {
  const pages = [{ id: '1', layoutSections: [canonicalInstance('instance-42', 'ss1', 'STALE')] }];
  const { pages: out } = resolvePagesFrameSections(pages, [master('ss1', 'LIVE')]);
  assert.equal(out[0].layoutSections[0].id, 'instance-42');
  assert.equal(out[0].layoutSections[0].savedSectionId, 'ss1');
  assert.equal(out[0].layoutSections[0].canonical, true);
});

test('the half-finished-propagation case: stale and fresh pages both come out live', () => {
  // Exactly 2026-07-22 — some pages got the new content, some did not.
  const pages = [
    { id: 'updated', layoutSections: [canonicalInstance('a', 'ss1', 'LIVE')] },
    { id: 'stale', layoutSections: [canonicalInstance('b', 'ss1', 'STALE')] }
  ];
  const { pages: out } = resolvePagesFrameSections(pages, [master('ss1', 'LIVE')]);
  assert.deepEqual(out.map((p) => textOf(p.layoutSections[0])), ['LIVE', 'LIVE']);
});

test('a deleted master leaves the page exactly as it was — stale beats missing', () => {
  const pages = [{ id: '1', layoutSections: [canonicalInstance('i1', 'gone', 'STALE')] }];
  const { pages: out, resolved, unresolved } = resolvePagesFrameSections(pages, [master('ss1', 'LIVE')]);
  assert.equal(textOf(out[0].layoutSections[0]), 'STALE');
  assert.equal(resolved, 0);
  assert.equal(unresolved, 1);
});

test('a detached section is the page\'s own and is left alone', () => {
  const detached = { ...canonicalInstance('i1', 'ss1', 'MINE'), canonical: false };
  const { pages: out } = resolvePagesFrameSections(
    [{ id: '1', layoutSections: [detached] }],
    [master('ss1', 'LIVE')]
  );
  assert.equal(textOf(out[0].layoutSections[0]), 'MINE');
});

test('pages with no canonical section are returned by identity, not rebuilt', () => {
  const page = { id: '1', layoutSections: [bodySection('b', 'body')] };
  const { pages: out } = resolvePagesFrameSections([page], [master('ss1', 'LIVE')]);
  assert.equal(out[0], page, 'untouched pages should not be cloned');
});

test('no masters, no pages, or junk input all degrade to today\'s behaviour', () => {
  const page = { id: '1', layoutSections: [canonicalInstance('i1', 'ss1', 'STALE')] };
  assert.equal(resolvePagesFrameSections([page], []).pages[0], page);
  assert.equal(resolvePagesFrameSections([page], null).pages[0], page);
  assert.deepEqual(resolvePagesFrameSections([], [master('ss1', 'x')]).pages, []);
  assert.deepEqual(resolvePagesFrameSections(null, null).pages, []);
});

test('a page with no layoutSections is passed through untouched', () => {
  const page = { id: '1', name: 'No layout' };
  assert.equal(resolvePagesFrameSections([page], [master('ss1', 'x')]).pages[0], page);
});

test('every canonical section on a page resolves, not just the first', () => {
  const pages = [{
    id: '1',
    layoutSections: [
      canonicalInstance('h', 'ss1', 'STALE HEADER'),
      bodySection('b', 'body'),
      canonicalInstance('f', 'ss2', 'STALE FOOTER')
    ]
  }];
  const { pages: out, resolved } = resolvePagesFrameSections(
    pages,
    [master('ss1', 'LIVE HEADER'), master('ss2', 'LIVE FOOTER')]
  );
  assert.deepEqual(
    out[0].layoutSections.map((s) => (s.modules?.[0]?.text ?? '')),
    ['LIVE HEADER', 'body', 'LIVE FOOTER']
  );
  assert.equal(resolved, 2);
});

test('the shared resolver is the one from the generated server bundle', () => {
  // Landmine 1: lib/builder/template.js is generated from builder-template.ts.
  // If the regen is skipped, the server loses these and this file cannot load.
  const bundle = require('../../lib/builder/template.js');
  assert.equal(typeof bundle.resolveFrameSection, 'function');
  assert.equal(typeof bundle.isFrameSection, 'function');
});
