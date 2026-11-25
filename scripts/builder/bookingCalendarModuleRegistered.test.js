'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

/**
 * SC-911 — landmine 1. `booking-calendar` is a new builder module type, and a
 * type the GENERATED server bundle does not know is coerced to "text" on every
 * page load: a client's booking page would quietly become an empty text block.
 * This reads lib/builder/template.js, the generated bundle, so it is a
 * node-suite test, run after the build (landmine 14).
 */

const template = require('../../lib/builder/template');

const TYPE = 'booking-calendar';

test('the server bundle knows booking-calendar and does not coerce it to text', () => {
  assert.ok(template.BUILDER_MODULE_TYPES.includes(TYPE), 'run `npm run build:builder-template`');
  assert.equal(template.normalizeModuleType(TYPE), TYPE);
});

test('a stored page carrying the module comes back carrying its calendar id', () => {
  const page = template.normalizeBuilderDocument({
    sections: [{ id: 's1', modules: [{ id: 'm1', type: TYPE, settings: { calendarId: 'cal_1', weekStartsOn: '1' } }] }],
  });
  const modules = page.layoutSections.flatMap((s) => s.modules || []);
  assert.deepEqual(modules.map((m) => m.type), [TYPE]);
  assert.equal(modules[0].settings.calendarId, 'cal_1');
  assert.equal(modules[0].settings.weekStartsOn, '1');
});

test('a new module shows the project\'s first calendar and follows the theme', () => {
  const made = template.createEmptyModule(TYPE);
  assert.equal(made.settings.calendarId, '');
  assert.equal(made.settings.accentColor, '');
});

test('it is a PUBLIC module: never stripped from a live page', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'builder-client', 'public-site-sections.ts'), 'utf8');
  const privateList = src.slice(src.indexOf('PRIVATE_ONLY_MODULE_TYPES'), src.indexOf(']);', src.indexOf('PRIVATE_ONLY_MODULE_TYPES')));
  assert.doesNotMatch(privateList, /"booking-calendar"/);
});
