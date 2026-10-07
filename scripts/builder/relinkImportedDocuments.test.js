'use strict';

// Task 86bce5d2u: Delray's PDF links still pointed at the old WordPress site
// after the domain moved to StarCaster, so every one answered "not found".
// These tests cover the planning half of scripts/relink_imported_documents.js,
// which needs no database.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  findDocumentLinks,
  documentKey,
  buildCopyIndex,
  planRelink,
} = require('../relink_imported_documents.js');

const HOST = 'delraytennis.com';
const OLD = 'https://www.delraytennis.com/wp-content/uploads/sites/2829/2020/01/Maintenance-Job.pdf';
const COPY = 'https://blob.example/SiteImport/job/assets/aaa.pdf';

function page(html) {
  return { sections: [{ rows: [{ columns: [{ modules: [{ type: 'text', settings: { html } }] }] }] }] };
}

test('finds absolute, host-less and relative document links on the old host only', () => {
  const html =
    `<a href="${OLD}">job</a>` +
    '<a href="//delraytennis.com/wp-content/uploads/x/Waiver.PDF">w</a>' +
    '<a href="/wp-content/uploads/sites/2829/2022/08/Employment-Application.pdf">e</a>' +
    '<a href="https://example.org/other.pdf">elsewhere</a>' +
    '<img src="https://www.delraytennis.com/wp-content/uploads/pic.jpg">';
  const found = findDocumentLinks(page(html), HOST);
  assert.deepEqual(found, [
    OLD,
    '//delraytennis.com/wp-content/uploads/x/Waiver.PDF',
    '/wp-content/uploads/sites/2829/2022/08/Employment-Application.pdf',
  ]);
});

test('one document key regardless of www, scheme, query or relative form', () => {
  const key = documentKey(OLD, HOST);
  assert.equal(documentKey('http://delraytennis.com/wp-content/uploads/sites/2829/2020/01/Maintenance-Job.pdf?ver=2', HOST), key);
  assert.equal(documentKey('/wp-content/uploads/sites/2829/2020/01/Maintenance-Job.pdf', HOST), key);
});

test('the copy index only trusts finished downloads, newest first', () => {
  const index = buildCopyIndex(
    [
      { original_url: OLD, storage_url: '', status: 'pending', created_at: '2026-08-20' },
      { original_url: OLD, storage_url: 'https://blob.example/old.pdf', status: 'downloaded', created_at: '2026-08-01' },
      { original_url: OLD, storage_url: COPY, status: 'downloaded', created_at: '2026-08-10' },
      { original_url: 'https://www.delraytennis.com/wp-content/uploads/Broken.pdf', storage_url: '', status: 'failed' },
    ],
    HOST
  );
  assert.equal(index.get(documentKey(OLD, HOST)), COPY);
  assert.equal(index.size, 1);
});

test('rewrites drafts, published copies and posts; reports links with no copy', () => {
  const copyIndex = new Map([[documentKey(OLD, HOST), COPY]]);
  const missingUrl = 'https://www.delraytennis.com/wp-content/uploads/Gone.pdf';
  const targets = [
    { kind: 'draft', id: 1, label: 'job-opportunities', column: 'layout_sections', value: page(`<a href="${OLD}">a</a> <a href="${OLD}?ver=3">b</a>`) },
    { kind: 'published', id: 9, label: 'job-opportunities', column: 'payload', value: { page: page(`<a href="${OLD}">a</a>`) } },
    { kind: 'blog (draft)', id: 'p1', label: 'post body', column: 'body', value: `<p><a href="${missingUrl}">gone</a></p>` },
    { kind: 'draft', id: 2, label: 'home', column: 'layout_sections', value: page('<p>nothing here</p>') },
  ];
  const plan = planRelink(targets, copyIndex, HOST);

  assert.equal(plan.writes.length, 2, 'the draft and its published copy, nothing else');
  const draft = JSON.stringify(plan.writes[0].next);
  assert.ok(!draft.includes('delraytennis.com'), 'no old link left in the draft');
  // The ?ver= variant is swapped whole, not left with a dangling query.
  assert.ok(!draft.includes('?ver=3'), 'the longer variant was replaced whole');
  assert.equal(plan.writes[0].swapped, 2);
  assert.ok(JSON.stringify(plan.writes[1].next).includes(COPY), 'the published copy is fixed too');

  assert.deepEqual(plan.missing.map((l) => l.raw), [missingUrl]);
  assert.equal(targets[0].value.sections[0].rows[0].columns[0].modules[0].settings.html.includes(OLD), true, 'inputs are not mutated');
});

test('a second plan over the rewritten rows has nothing to do', () => {
  const copyIndex = new Map([[documentKey(OLD, HOST), COPY]]);
  const first = planRelink([{ kind: 'draft', id: 1, label: 'x', column: 'layout_sections', value: page(`<a href="${OLD}">a</a>`) }], copyIndex, HOST);
  const second = planRelink(first.writes.map((w) => ({ ...w, value: w.next })), copyIndex, HOST);
  assert.equal(second.writes.length, 0);
  assert.equal(second.links.length, 0);
});
