'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * SC-910 — landmine 1. `admin-booking-manager` is a new builder module type,
 * and a type the GENERATED server bundle does not know is coerced to "text" on
 * every page load: the admin page would quietly become an empty text block.
 * This reads lib/builder/template.js, the generated bundle, because the
 * TypeScript source being right is exactly the state that hides the bug — and
 * that is why it is a node-suite test, run after the build (landmine 14).
 */

const template = require('../../lib/builder/template');
const { ADMIN_PAGE_BLUEPRINTS, adminMenuFor } = require('../../lib/projectAdminScaffold');
const { LINK_SETTINGS } = require('../../lib/pageInboundLinks');

const TYPE = 'admin-booking-manager';

test('the server bundle knows admin-booking-manager and does not coerce it to text', () => {
  assert.ok(template.BUILDER_MODULE_TYPES.includes(TYPE), 'run `npm run build:builder-template`');
  assert.equal(template.normalizeModuleType(TYPE), TYPE);
});

test('a stored page carrying the module comes back carrying it', () => {
  const page = template.normalizeBuilderDocument({
    sections: [{ id: 's1', modules: [{ id: 'm1', type: TYPE, settings: { contactsPageUrl: '/people' } }] }],
  });
  const modules = page.layoutSections.flatMap((s) => s.modules || []);
  assert.deepEqual(modules.map((m) => m.type), [TYPE]);
  assert.equal(modules[0].settings.contactsPageUrl, '/people');
});

test('a new module links bookings to the scaffold\'s own Contact Manager page', () => {
  const made = template.createEmptyModule(TYPE);
  assert.equal(made.settings.contactsPageUrl, '/admin-contact-manager');
  assert.ok(
    ADMIN_PAGE_BLUEPRINTS.some((b) => b.slug === 'admin-contact-manager'),
    'the default points at a page the admin scaffold builds'
  );
});

test('the admin scaffold builds a private Booking Manager page that needs the CRM', () => {
  const blueprint = ADMIN_PAGE_BLUEPRINTS.find((b) => b.slug === 'admin-booking-manager');
  assert.ok(blueprint, 'admin-booking-manager is in the blueprint set');
  assert.equal(blueprint.isPrivate, true);
  assert.equal(blueprint.requires, 'crm');
  let n = 0;
  const [section] = blueprint.buildBody(() => `id${(n += 1)}`);
  assert.deepEqual(section.modules.map((m) => m.type), [TYPE]);
  assert.deepEqual(
    adminMenuFor(['admin-booking-manager']).map((i) => i.label),
    ['Booking Manager'],
    'the admin menu offers it once the page exists'
  );
});

test('the contact page setting is a page link, so renaming that page is caught', () => {
  assert.equal(LINK_SETTINGS?.[TYPE]?.contactsPageUrl, 'path');
});
