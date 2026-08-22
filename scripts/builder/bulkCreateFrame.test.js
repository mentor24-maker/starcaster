'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveTemplateSections } = require('../../lib/builder/template-frame');

/**
 * Bulk Create must build pages from the CURRENT shared sections.
 *
 * A template keeps its own copy of the header, menu and footer, and it never
 * receives canonical propagation — only pages do. So cloning a template raw
 * seeds every generated page with whatever those sections looked like on the
 * day the template was saved. On 2026-08-15 that produced 34 pages whose menu
 * was 41 minutes stale: two items the operator had just given real links were
 * still pointing at "/", so they landed on the bare domain instead of their
 * page. The menu master was correct the whole time.
 *
 * The newer template shape makes it worse rather than better: templates saved
 * since the frame/body split store shared sections as bare REFERENCES with no
 * modules at all, so a raw clone yields empty header and footer bands.
 *
 * This file guards the server half. The interactive editor already resolved
 * against live masters; these are the same rules, from the same source, now
 * generated into lib/builder/template-frame.js for the route to use.
 */

const MASTER_ID = 'saved_section_menu';

function master(hrefForAbout) {
  return {
    id: MASTER_ID,
    name: '2 - Menu Banner',
    section: {
      id: 'master-section',
      title: '2 - Menu Banner',
      layout: 'main',
      modules: [
        { id: 'm1', type: 'navigation', column: 'main', name: 'Main Menu', text: '',
          settings: { navItems: JSON.stringify([{ id: 'n1', label: 'About', href: hrefForAbout }]) } }
      ]
    }
  };
}

const aboutHref = (section) => {
  const nav = (section.modules || []).find((m) => m.type === 'navigation');
  return JSON.parse(nav.settings.navItems)[0].href;
};

test('a stale frozen copy in the template is replaced by the live master', () => {
  // The template still carries the old menu, exactly as template 47 did.
  const templateSections = [
    { id: 'tpl-1', title: '2 - Menu Banner', canonical: true, savedSectionId: MASTER_ID,
      modules: [
        { id: 'old', type: 'navigation', column: 'main', name: 'Main Menu', text: '',
          settings: { navItems: JSON.stringify([{ id: 'n1', label: 'About', href: '/' }]) } }
      ] },
    { id: 'tpl-2', title: 'PLACEHOLDER SECTION', modules: [] }
  ];

  const resolved = resolveTemplateSections(templateSections, [master('/about')], () => 'generated');

  assert.equal(resolved.length, 2, 'the body section still comes through');
  assert.equal(aboutHref(resolved[0]), '/about', 'the generated page must get the CURRENT link, not "/"');
  assert.equal(resolved[0].savedSectionId, MASTER_ID, 'it stays linked to the master');
  assert.equal(resolved[0].canonical, true, 'and keeps following it');
  assert.equal(resolved[0].id, 'tpl-1', "the instance keeps its own id");
});

test('a bare reference is filled in, not cloned as an empty band', () => {
  // The modern template shape: marker fields only, no modules.
  const templateSections = [
    { id: 'tpl-1', title: '2 - Menu Banner', canonical: true, savedSectionId: MASTER_ID, modules: [] }
  ];

  const resolved = resolveTemplateSections(templateSections, [master('/about')], () => 'generated');

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].modules.length, 1, 'an empty header band is the bug this prevents');
  assert.equal(aboutHref(resolved[0]), '/about');
});

test('body sections are never touched', () => {
  const body = { id: 'body-1', title: 'Hero', modules: [{ id: 'x', type: 'text', column: 'main', name: '', text: 'hi', settings: {} }] };
  const resolved = resolveTemplateSections([body], [master('/about')], () => 'generated');
  assert.deepEqual(resolved[0], body);
});

test('a reference whose master was deleted is dropped rather than left blank', () => {
  const templateSections = [
    { id: 'tpl-1', title: 'Gone', canonical: true, savedSectionId: 'saved_section_deleted', modules: [] },
    { id: 'tpl-2', title: 'Body', modules: [] }
  ];
  const resolved = resolveTemplateSections(templateSections, [master('/about')], () => 'generated');
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].id, 'tpl-2');
});

test('the bulk-create route still resolves before it clones', () => {
  // A source-level assertion on purpose: driving the real handler needs a
  // database, a project scope and a crawl run, so the property would go
  // untested in practice — and an untested property is how it came back.
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'builder.js'), 'utf8');

  const handler = source.slice(source.indexOf('bulk-create-with-model'));
  const resolveAt = handler.indexOf('resolveTemplateSections(');
  const cloneAt = handler.indexOf('JSON.parse(JSON.stringify(templateLayoutSections))');

  assert.ok(resolveAt > -1, 'bulk create must resolve shared sections against their live masters');
  assert.ok(cloneAt > -1, 'the per-item deep clone should still be there');
  assert.ok(
    resolveAt < cloneAt,
    'resolution has to happen BEFORE the clone, or every page gets the stale copy'
  );
});

test('with no masters loaded, an old-style copy is still better than nothing', () => {
  const templateSections = [
    { id: 'tpl-1', title: '2 - Menu Banner', canonical: true, savedSectionId: MASTER_ID,
      modules: [{ id: 'old', type: 'navigation', column: 'main', name: '', text: '', settings: { navItems: '[]' } }] }
  ];
  const resolved = resolveTemplateSections(templateSections, [], () => 'generated');
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].modules.length, 1);
});
