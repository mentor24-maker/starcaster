'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Ticket 86bbuhph0 - LANDMINE 1, and it is the reason this file exists.
 *
 * `admin-related-articles` is a new builder module type. A new type has to be
 * registered TWICE: once in `lib/builder-client/builder-template.ts`, and once
 * in the server bundle `lib/builder/template.js` that
 * `npm run build:builder-template` generates from it. If the server bundle
 * does not know the type, `normalizeModuleType` coerces it to `"text"` on
 * EVERY page load - the module quietly becomes an empty text block, nothing
 * throws, nothing is logged, and the page just renders wrong.
 *
 * This test reads the GENERATED bundle rather than the TypeScript source, on
 * purpose: the source being right is exactly the state that hides the bug.
 * Editing the source and forgetting the rebuild is the failure, so a test that
 * reads the source cannot see it.
 *
 * That is also why this is a node-suite test and not a vitest one. CI runs
 * vitest BEFORE `npm run build`, so `lib/builder/template.js` does not exist
 * at that point - a vitest test reaching it passes locally forever and fails
 * CI forever (landmine 14, docs/DOCTRINE.md 5.18). The node suite runs after
 * the build, which is the only place this question can honestly be asked.
 */

const template = require('../../lib/builder/template');

const RELATED = 'admin-related-articles';
const TAGS = 'admin-blog-links';

test('the server bundle knows admin-related-articles', () => {
  assert.ok(
    template.BUILDER_MODULE_TYPES.includes(RELATED),
    `${RELATED} is missing from BUILDER_MODULE_TYPES in the GENERATED lib/builder/template.js. ` +
    'The TypeScript source may well be right - run `npm run build:builder-template`.'
  );
});

test('normalizeModuleType does not coerce admin-related-articles to text', () => {
  const got = template.normalizeModuleType(RELATED);
  assert.equal(
    got,
    RELATED,
    `the server coerced ${RELATED} to "${got}". If that is "text", this is landmine 1 exactly: ` +
    'every saved page carrying this module renders an empty text block, silently.'
  );
});

test('the type survives a round trip through a stored page', () => {
  /*
   * normalizeModuleType in isolation can be right while the path a real page
   * load takes is not, so this asks the question the way a page load asks it:
   * a stored document in, a normalized document out.
   */
  const page = template.normalizeBuilderDocument({
    sections: [
      {
        id: 's1',
        modules: [
          { id: 'm1', type: TAGS, settings: {} },
          { id: 'm2', type: RELATED, settings: {} },
        ],
      },
    ],
  });

  /*
   * It reads `sections` and answers with `layoutSections` - the write key and
   * the read key are not the same word (landmine 13). Reading `page.sections`
   * here returns undefined, and the loop below then finds no modules at all,
   * so the test fails with an EMPTY list rather than with "text". Asserting on
   * the whole list rather than on `types.includes(RELATED)` is what makes that
   * difference visible instead of silently passing for the wrong reason.
   */
  const sections = page.layoutSections;
  assert.ok(Array.isArray(sections) && sections.length === 1, 'the document should come back with its one section');

  const types = [];
  for (const section of sections) {
    for (const module of section.modules || []) types.push(module.type);
  }

  assert.deepEqual(
    types,
    [TAGS, RELATED],
    'a page carrying both modules came back with different types than it went in with; ' +
    `"text" in the second slot is the silent coercion landmine 1 describes`
  );
});

test('admin-blog-links kept its id, so pages saved before the split still load', () => {
  /*
   * The whole reason the split needed no page migration: the Tag Manager kept
   * the type id it always had. If someone renames or aliases it later, every
   * live tenant page carrying it breaks at once - hence a test rather than a
   * comment.
   */
  assert.ok(template.BUILDER_MODULE_TYPES.includes(TAGS), `${TAGS} must keep its type id`);
  assert.equal(template.normalizeModuleType(TAGS), TAGS);
});

test('the new module ships the relate settings, and the Tag Manager no longer does', () => {
  const related = template.createEmptyModule(RELATED);
  assert.equal(related.type, RELATED);
  assert.equal(
    related.settings.relateButtonLabel,
    'Relate Checked',
    'relateButtonLabel moved to this module with the rest of the relate half'
  );
  assert.ok(
    'articleStatus' in related.settings,
    'articleStatus chooses which articles the picker offers, so it belongs to this module'
  );

  const tags = template.createEmptyModule(TAGS);
  for (const moved of ['relateButtonLabel', 'articleStatus', 'showRelate']) {
    assert.ok(
      !(moved in tags.settings),
      `a NEW ${TAGS} module still defaults ${moved}; that setting moved to ${RELATED}. ` +
      '(Pages saved before the split still carry it, which is harmless - it is simply ignored.)'
    );
  }
});
