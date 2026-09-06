'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const {
  sanitizeForm,
  formInputToRow,
} = require('../../lib/crmFormsStore.js');
const { embedFormStylesMeta, publicFormFields } = require('../../lib/crmFormStyles.js');

const CRM_ADMIN_JS = path.join(__dirname, '..', '..', 'public', 'js', 'crm.js');

/**
 * A dropdown's choices have to survive the CRM form store.
 *
 * Task 86bbugd2e, round 3. The visible defect was the opposite one: a `select`
 * field with no options rendered "Option one / Option two" to visitors on a
 * published page, and they could submit either into the tenant's CRM. The fix
 * for that (#627) drops an option-less dropdown from a live form.
 *
 * Which exposed the real bug underneath. THREE separate places rebuilt a field
 * as `{key,label,type,required}` and threw `options` away — the read path
 * (`sanitize`), the write path (`inputToRow`) and the styles-meta write path
 * (`embedFormStylesMeta`) — so a field served to a published page could never
 * carry options at all. The live guard therefore deleted EVERY dropdown, not
 * only the empty ones: a tenant's real question ("How did you find us?" with
 * Referral / Search Engine / AI, which is a genuine row in production's
 * crm_configs) would vanish from the published form and its answer would never
 * be collected, with every save reporting success. Landmine 12's shape.
 *
 * No render-level test can catch this, because the render never sees the store.
 * This is the assertion that would have.
 */

const CONFIGURED_SELECT = {
  key: 'how_did_you_find_us',
  label: 'How did you find us?',
  type: 'select',
  required: true,
  options: ['Referral', 'Search Engine', 'AI'],
};

const PLAIN_FIELD = { key: 'email', label: 'Email', type: 'text', required: true };

function fieldByKey(fields, key) {
  return (Array.isArray(fields) ? fields : []).find((f) => f.key === key) || null;
}

test('a configured dropdown keeps its options through the store round trip', () => {
  const input = { id: 'crmf_1', name: 'Contact', fields: [PLAIN_FIELD, CONFIGURED_SELECT] };

  // WRITE: what actually goes to the crm_forms row on create/update.
  const row = formInputToRow(input, { includeStylesMeta: true });
  const written = fieldByKey(row.fields, CONFIGURED_SELECT.key);
  assert.ok(written, 'the dropdown reached the row at all');
  assert.deepEqual(written.options, ['Referral', 'Search Engine', 'AI']);

  // READ: what GET /api/crm/forms/:id hands the published page.
  const served = sanitizeForm({ ...input, fields: row.fields });
  const read = fieldByKey(served.fields, CONFIGURED_SELECT.key);
  assert.ok(read, 'the dropdown survived the read path');
  assert.deepEqual(read.options, ['Referral', 'Search Engine', 'AI']);
});

test('a style-only save does not wipe a dropdown\'s options', () => {
  // builder-crm-form-module-settings.tsx PUTs { styles } alone, so updateForm
  // re-serializes the EXISTING fields. That is the quietest way to lose them.
  const stored = sanitizeForm({ id: 'crmf_1', name: 'Contact', fields: [CONFIGURED_SELECT] });
  const resaved = sanitizeForm({
    ...stored,
    fields: embedFormStylesMeta(stored.fields, { headingColor: '#111111' }, ''),
  });
  assert.deepEqual(fieldByKey(resaved.fields, CONFIGURED_SELECT.key).options, [
    'Referral',
    'Search Engine',
    'AI',
  ]);
});

test('options are cleaned, not merely copied', () => {
  const served = sanitizeForm({
    id: 'crmf_1',
    fields: [{ key: 'pick', label: 'Pick', type: 'select', options: ['  Clay ', '', 'Hard', null] }],
  });
  assert.deepEqual(fieldByKey(served.fields, 'pick').options, ['Clay', 'Hard']);
});

test('a field with no options reads as an empty list, never undefined', () => {
  // crmSelectHasNothingToChoose asks Array.isArray(field.options) — an absent
  // key and a blank Options box must land on the same, honest answer.
  const served = sanitizeForm({ id: 'crmf_1', fields: [PLAIN_FIELD, { key: 'pick', type: 'select' }] });
  assert.deepEqual(fieldByKey(served.fields, 'pick').options, []);
  assert.deepEqual(fieldByKey(served.fields, 'email').options, []);
});

test('the row without styles-meta carries options too', () => {
  // The other branch of inputToRow. No caller passes includeStylesMeta:false
  // today, so nothing else would notice it drifting back.
  const row = formInputToRow({ id: 'crmf_1', fields: [CONFIGURED_SELECT] });
  assert.deepEqual(fieldByKey(row.fields, CONFIGURED_SELECT.key).options, [
    'Referral',
    'Search Engine',
    'AI',
  ]);
});

test('the styles-meta field is still excluded from the public field list', () => {
  const row = formInputToRow({ id: 'crmf_1', fields: [CONFIGURED_SELECT] }, { includeStylesMeta: true });
  assert.equal(publicFormFields(row.fields).length, 1);
  assert.equal(row.fields.length, 2, 'the meta field rides along in the row');
});

/**
 * The fourth place `options` was being dropped, and the one nothing else can
 * reach: `saveForm()` in the frozen vanilla-JS admin. It composes the payload
 * the API receives, so the three store fixes above are inert without it —
 * a field that leaves the browser with no options has none to carry.
 *
 * `public/js/` is bundled by nothing and imported by nothing (landmine 9), so
 * this reads the source. That proves the line is present, not that the page
 * works; the browser check is on the ticket.
 */
function saveFormFieldMapping() {
  const source = fs.readFileSync(CRM_ADMIN_JS, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const start = source.indexOf('async function saveForm()');
  assert.notEqual(start, -1, 'saveForm must still exist — it is the only CRM form writer');
  const mapStart = source.indexOf('formEditorFieldRows', start);
  assert.notEqual(mapStart, -1, 'saveForm must still build its fields from formEditorFieldRows');
  const body = source.slice(mapStart, source.indexOf('}));', mapStart) + 4);
  assert.ok(body.length > 20, 'the field mapping should be findable');
  return body;
}

test('the admin form editor sends each field\'s options to the API', () => {
  const mapping = saveFormFieldMapping();
  assert.match(
    mapping,
    /options:/,
    'saveForm drops the dropdown choices, so no published form can ever have any'
  );
  // The rows come from allConfigFields(), which carries the CRM config's own
  // options — so the value has to be row.options, not an invented default.
  assert.match(mapping, /row\.options/);
});
