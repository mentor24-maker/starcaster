'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Task SC-863 - landmine 1 for the Table of Contents module.
 *
 * A new module type must be known to the GENERATED server bundle
 * (`lib/builder/template.js`, from `npm run build:builder-template`), or every
 * page load coerces it to "text" and the module silently becomes an empty text
 * block. This reads the generated bundle on purpose - the TypeScript source
 * being right is the state that hides the bug - and is a node-suite test
 * because CI runs vitest before the build (landmine 14).
 */

const template = require('../../lib/builder/template');

const TYPE = 'table-of-contents';

test('the server bundle knows table-of-contents', () => {
  assert.ok(
    template.BUILDER_MODULE_TYPES.includes(TYPE),
    `${TYPE} is missing from the GENERATED lib/builder/template.js - run \`npm run build:builder-template\`.`
  );
  assert.equal(template.normalizeModuleType(TYPE), TYPE);
});

test('a stored page carrying table-of-contents loads it back as table-of-contents, not text', () => {
  const page = template.normalizeBuilderDocument({
    sections: [
      {
        id: 's1',
        modules: [
          { id: 'toc', type: TYPE, settings: { title: 'Contents', headingLevels: 'h2' } },
          { id: 'body', type: 'text', text: '<h2>Juniors</h2>', settings: {} },
        ],
      },
    ],
  });
  // Reads `sections`, answers with `layoutSections` (landmine 13).
  const modules = page.layoutSections.flatMap((section) => section.modules || []);
  assert.deepEqual(modules.map((m) => m.type), [TYPE, 'text']);
  assert.equal(modules[0].settings.headingLevels, 'h2', 'its settings come back too');
  assert.equal(modules[0].settings.title, 'Contents');
});

test('a new table-of-contents starts with the panel defaults', () => {
  const fresh = template.createEmptyModule(TYPE);
  assert.equal(fresh.type, TYPE);
  assert.equal(fresh.settings.title, 'On this page');
  assert.equal(fresh.settings.headingLevels, 'h2-h3');
  assert.equal(fresh.settings.indentSubheadings, 'true');
});
